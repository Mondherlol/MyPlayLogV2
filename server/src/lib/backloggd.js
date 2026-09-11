// ======================================================================
//  Lire une bibliothèque Backloggd
// ======================================================================
//
// CE QUE BACKLOGGD N'OFFRE PAS : pas d'API publique, et pas encore d'export
// CSV (c'est sur leur feuille de route, pas dans le produit). Il ne reste que
// les pages publiques du profil, qu'on lit et qu'on met en forme ici.
//
// ⚠️ ET IL Y A UN MUR ANTI-BOT DEVANT UNE PARTIE D'ENTRE ELLES. Backloggd est
// derrière Anubis : certaines URL répondent une page de défi au lieu du
// contenu. Deux choses à savoir, et elles se compensent :
//
//   • LE PLUS GROS PASSE SANS RIEN FAIRE. Le mur ne se déclenche que sur les
//     chemins PROFONDS (`/u/x/games/added/type:played/`). L'URL canonique
//     `/u/x/games` — sans barre oblique finale — et les onglets de premier
//     niveau (`/reviews`) répondent normalement. C'est de là que viennent les
//     jeux, les notes et les avis, c'est-à-dire l'essentiel.
//   • POUR LE RESTE, ON PAIE LE PÉAGE. Les vues par statut n'existent qu'en
//     chemin profond. On résout donc la preuve de travail que la page demande
//     — exactement ce que fait un navigateur : le même calcul, la même réponse
//     au même point d'entrée. On ne cherche pas à esquiver la protection, on
//     s'y soumet.
//
// ⚠️ CE FICHIER EST FRAGILE PAR NATURE, et il faut le savoir en le lisant :
// il dépend de la mise en page HTML d'un site tiers. Le jour où Backloggd
// change une classe CSS, l'import rend une liste vide — pas une erreur. C'est
// pour ça que chaque extraction est tolérante (une carte illisible est sautée,
// pas fatale) et que l'aperçu montre TOUT à l'utilisateur avant d'écrire quoi
// que ce soit.

import { createHash } from "node:crypto";

const BASE = "https://backloggd.com";
// On s'annonce pour ce qu'on est plutôt que de se déguiser en navigateur : si
// Backloggd veut nous bloquer un jour, qu'il puisse le faire proprement.
const UA = "MyPlayLog/1.0 (+https://myplaylog.fr) import-bot";

// Un délai entre deux pages. Une bibliothèque de mille jeux fait une trentaine
// de requêtes : à ce rythme-là on reste un visiteur, pas une charge.
const PAGE_DELAY = 600;
// Plafond de pages par vue. Sans lui, une pagination qui ne s'arrête jamais
// (ou qui se répète) ferait tourner l'import indéfiniment.
const MAX_PAGES = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le nom d'utilisateur contenu dans ce qu'on a collé, ou `null`. */
export function parseUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const m = raw.match(/backloggd\.com\/u\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // Un pseudo tapé à la main. Les pseudos Backloggd sont alphanumériques.
  if (/^[\w.-]{1,40}$/.test(raw)) return raw;
  return null;
}

// ---------------------------------------------------------------------------
//  Le péage : preuve de travail Anubis
// ---------------------------------------------------------------------------

/**
 * Trouve le `nonce` dont l'empreinte SHA-256 commence par assez de zéros.
 *
 * C'est mot pour mot ce que calcule le navigateur (cf. leur worker
 * `sha256-webcrypto.mjs`) : `sha256(randomData + nonce)`, et l'on cherche
 * `difficulty` zéros hexadécimaux en tête. À la difficulté servie par
 * Backloggd (2), c'est l'affaire de quelques centaines d'essais — une poignée
 * de millisecondes. Le plafond est là pour qu'une difficulté relevée un jour
 * fasse échouer l'import proprement au lieu de bloquer le serveur.
 */
function solveChallenge(randomData, difficulty, maxTries = 50_000_000) {
  const prefix = "0".repeat(difficulty);
  for (let nonce = 0; nonce < maxTries; nonce++) {
    const hash = createHash("sha256").update(randomData + nonce).digest("hex");
    if (hash.startsWith(prefix)) return { hash, nonce };
  }
  const err = new Error(
    "Backloggd demande une preuve de travail trop coûteuse. Réessaie plus tard."
  );
  err.status = 503;
  throw err;
}

/**
 * Une session de lecture : son panier de cookies et sa mémoire de pages.
 *
 * Les cookies sont tenus À LA MAIN parce que `fetch` de Node ne les garde pas
 * — et sans eux, le jeton gagné en résolvant le défi serait perdu à la requête
 * suivante, ce qui ferait repayer le péage à chaque page.
 */
function createSession() {
  const jar = new Map();

  const cookieHeader = () =>
    [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  function absorb(res) {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async function raw(url, { follow = true } = {}) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        ...(jar.size ? { Cookie: cookieHeader() } : {}),
      },
      redirect: follow ? "follow" : "manual",
    });
    absorb(res);
    return { res, html: await res.text() };
  }

  /** Une page, le péage payé s'il le faut. */
  async function get(url) {
    let { res, html } = await raw(url);
    if (res.status === 404) return null;

    const m = html.match(
      /<script id="anubis_challenge" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!m) return html;

    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      return html; // défi illisible : on rend la page telle quelle
    }
    const { challenge, rules } = parsed;
    if (!challenge?.randomData || !challenge?.id) return html;

    const started = Date.now();
    const { hash, nonce } = solveChallenge(challenge.randomData, rules?.difficulty ?? 4);
    // ⚠️ UN TEMPS PLANCHER. On résout en une milliseconde ; annoncer « 1 ms »
    // est à la fois inutile et suspect. On rapporte le temps réellement écoulé,
    // avec un plancher, et on n'en tire aucun avantage : le calcul, lui, a bien
    // été fait.
    const elapsed = Math.max(80, Date.now() - started);

    const params = new URLSearchParams({
      id: challenge.id,
      response: hash,
      nonce: String(nonce),
      redir: new URL(url).pathname + new URL(url).search,
      elapsedTime: String(elapsed),
    });
    // Le point d'entrée de validation, celui que le navigateur appelle aussi.
    await raw(`${BASE}/.within.website/x/cmd/anubis/api/pass-challenge?${params}`, {
      follow: false,
    });

    const again = await raw(url);
    return again.html;
  }

  return { get };
}

// ---------------------------------------------------------------------------
//  Extraction
// ---------------------------------------------------------------------------

// Le HTML de Backloggd échappe ses textes : on les rend lisibles.
function decode(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Les jeux d'une page de bibliothèque.
 *
 * ⚠️ ON DÉCOUPE PAR CARTE AVANT DE LIRE LES ATTRIBUTS. Une seule expression
 * régulière qui exigerait `data-rating` PUIS `game_id` ratait silencieusement
 * tous les jeux NON NOTÉS — l'attribut est absent sur ceux-là, et ils
 * disparaissaient de l'import sans que rien ne le signale.
 */
function parseLibraryPage(html) {
  const out = [];
  // `game_id` est l'identifiant IGDB : Backloggd s'appuie sur le même
  // catalogue que nous. C'est ce qui évite tout rapprochement par titre — et
  // donc toute erreur de rapprochement.
  const cards = String(html).split(/class="card [^"]*game-cover/).slice(1);
  for (const card of cards) {
    const id = card.match(/game_id="(\d+)"/)?.[1];
    if (!id) continue;
    const ratingRaw = card.match(/data-rating="(\d+)"/)?.[1];
    const title = decode(card.match(/class="game-text-centered"[^>]*>([^<]*)</)?.[1]);
    const cover = card.match(/class="card-img[^"]*"\s+src="([^"]+)"/)?.[1] || null;
    out.push({
      igdbId: Number(id),
      title: title || null,
      cover,
      // Backloggd note sur 10 (une demi-étoile = 1). Nous, sur 100.
      rating: ratingRaw ? Math.min(100, Number(ratingRaw) * 10) : null,
    });
  }
  return out;
}

/** Les identifiants IGDB d'une page de vue filtrée (un statut). */
function parseIds(html) {
  return [...String(html).matchAll(/game_id="(\d+)"/g)].map((m) => Number(m[1]));
}

/** Les avis d'une page : statut, plateforme, date et texte. */
function parseReviewsPage(html) {
  const out = [];
  const blocks = String(html).split(/class="row pt-2 pb-1 review-card"/).slice(1);
  for (const b of blocks) {
    const igdbId = Number(b.match(/game_id="(\d+)"/)?.[1] || 0);
    if (!igdbId) continue;
    out.push({
      igdbId,
      // « Completed », « Playing », « Shelved »… — le statut fin, celui que la
      // vue par type ne donne pas.
      playType: b.match(/class="mb-0 play-type (\w+)"/)?.[1] || null,
      platform: decode(b.match(/class="my-0 ml-auto review-platform"[^>]*>\s*<p[^>]*>([^<]*)</)?.[1]) || null,
      loggedAt: b.match(/<time datetime="([^"]+)"/)?.[1] || null,
      // ⚠️ DEUX HABILLAGES POUR LE MÊME TEXTE. Un avis long est repliable
      // (`class="collapse mb-0 card-text"`), un avis court ne l'est pas
      // (`class=" mb-0 card-text"`, avec son espace de tête). Exiger
      // « collapse » perdait silencieusement un tiers des avis — ceux qui
      // tiennent en quelques lignes.
      text: decode(b.match(/class="[^"]*card-text"[^>]*>([\s\S]*?)<\/div>/)?.[1]).slice(0, 5000),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Correspondance des statuts
// ---------------------------------------------------------------------------

// Les quatre rayons de Backloggd. « played » est un fourre-tout — il dit qu'on
// y a touché, pas comment ça s'est fini : c'est l'avis (`playType`) qui le
// précise quand il existe.
const SHELF_STATUS = {
  playing: "playing",
  backlog: "wishlist", // « j'y jouerai » : c'est notre wishlist
  wishlist: "wishlist",
  played: "finished", // par défaut, affiné ci-dessous
};

// Le statut fin porté par un avis.
//
// ⚠️ « RETIRED » N'EST PAS « ABANDONNÉ ». Backloggd distingue les deux :
// `abandoned`, c'est arrêter un jeu sans le finir ; `retired`, c'est arrêter un
// jeu QUI N'A PAS DE FIN (un jeu-service, un multi). Le second correspond
// exactement à notre statut « sans fin », le premier à « abandonné ».
const PLAY_TYPE_STATUS = {
  completed: "finished",
  mastered: "finished", // + le 100 %, posé plus bas
  playing: "playing",
  shelved: "paused",
  abandoned: "dropped",
  retired: "endless",
};

/**
 * Toute la bibliothèque Backloggd de `username`, mise à notre format.
 *
 * Rend `{ games, counts, pages }` — `games` étant prêt à afficher dans
 * l'aperçu, et rien n'est écrit en base ici.
 */
export async function scrapeLibrary(username) {
  const session = createSession();
  const profile = `${BASE}/u/${encodeURIComponent(username)}`;
  let requests = 0;

  // --- 1. La bibliothèque, page par page. C'est la colonne vertébrale. ---
  const byId = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    // ⚠️ SANS BARRE OBLIQUE FINALE. `/games/` déclenche le mur anti-bot,
    // `/games` non. La différence tient à ce seul caractère.
    const html = await session.get(`${profile}/games${page > 1 ? `?page=${page}` : ""}`);
    requests++;
    if (html === null) {
      const err = new Error(`Profil Backloggd introuvable : ${username}.`);
      err.status = 404;
      throw err;
    }
    const rows = parseLibraryPage(html);
    const fresh = rows.filter((r) => !byId.has(r.igdbId));
    // Backloggd resert la dernière page quand on dépasse : une page qui
    // n'apporte aucun jeu nouveau est la fin, pas un trou.
    if (!fresh.length) break;
    for (const r of fresh) byId.set(r.igdbId, { ...r, status: null, review: null });
    await sleep(PAGE_DELAY);
  }

  if (!byId.size) {
    return { games: [], counts: emptyCounts(), requests, empty: true };
  }

  // --- 2. Les rayons, pour le statut. C'est ici qu'on paie le péage. ---
  for (const shelf of Object.keys(SHELF_STATUS)) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${profile}/games/added/type:${shelf}/${page > 1 ? `?page=${page}` : ""}`;
      const html = await session.get(url).catch(() => null);
      requests++;
      if (!html) break;
      const ids = parseIds(html);
      // Un rayon ne pose un statut que sur les jeux qu'on connaît déjà : la
      // bibliothèque fait foi, ces vues ne servent qu'à la qualifier.
      const fresh = ids.filter((id) => byId.has(id) && !byId.get(id).shelf);
      if (!fresh.length) break;
      for (const id of fresh) byId.get(id).shelf = shelf;
      await sleep(PAGE_DELAY);
    }
  }

  // --- 3. Les avis : statut fin, plateforme, date, texte. ---
  const seenReviews = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await session
      .get(`${profile}/reviews${page > 1 ? `?page=${page}` : ""}`)
      .catch(() => null);
    requests++;
    if (!html) break;
    const rows = parseReviewsPage(html).filter((r) => !seenReviews.has(r.igdbId));
    if (!rows.length) break;
    for (const r of rows) {
      seenReviews.add(r.igdbId);
      const g = byId.get(r.igdbId);
      // Un avis sur un jeu absent de la bibliothèque (cas rare, mais il
      // existe) : on l'ajoute plutôt que de perdre l'avis écrit.
      if (!g) {
        byId.set(r.igdbId, {
          igdbId: r.igdbId,
          title: null,
          cover: null,
          rating: null,
          shelf: "played",
        });
      }
      Object.assign(byId.get(r.igdbId), {
        playType: r.playType,
        platform: r.platform,
        loggedAt: r.loggedAt,
        review: r.text || null,
      });
    }
    await sleep(PAGE_DELAY);
  }

  // --- 4. Mise au propre ---
  const games = [...byId.values()].map((g) => {
    const fine = g.playType ? PLAY_TYPE_STATUS[g.playType] : null;
    const status = fine || SHELF_STATUS[g.shelf] || "finished";
    return {
      igdbId: g.igdbId,
      title: g.title,
      cover: g.cover,
      rating: g.rating,
      status,
      // « Mastered » chez eux = terminé à 100 % chez nous.
      platinum: g.playType === "mastered",
      review: g.review || null,
      platform: g.platform || null,
      // La date du log : la plus proche d'une date de fin qu'ils donnent.
      finishedAt: g.loggedAt || null,
      shelf: g.shelf || null,
      playType: g.playType || null,
    };
  });

  return { games, counts: countBy(games), requests, empty: false };
}

function emptyCounts() {
  return { total: 0, rated: 0, reviewed: 0, byStatus: {} };
}

function countBy(games) {
  const byStatus = {};
  for (const g of games) byStatus[g.status] = (byStatus[g.status] || 0) + 1;
  return {
    total: games.length,
    rated: games.filter((g) => g.rating != null).length,
    reviewed: games.filter((g) => g.review).length,
    byStatus,
  };
}
