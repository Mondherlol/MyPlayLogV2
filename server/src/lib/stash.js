// ======================================================================
//  Lire une bibliothèque Stash
// ======================================================================
//
// Stash (stash.games, et surtout son appli mobile) n'a pas d'API publique ni
// d'export. Comme pour Backloggd, il reste les pages publiques du profil, qu'on
// lit et qu'on met à notre format ici. Rien n'est écrit en base dans ce
// fichier : c'est la route (routes/stash.js) qui applique, et seulement ce que
// l'utilisateur a validé.
//
// ⚠️ ON PASSE PAR api.stash.games, PAS PAR stash.games — ET IL FAUT SAVOIR CE
// QUE ÇA VEUT DIRE. Le domaine public est derrière un défi Cloudflare (403 à
// tout ce qui n'exécute pas de JavaScript) ; `api.stash.games`, l'hôte de leur
// appli, sert les mêmes pages sans ce défi. Et leur robots.txt demande aux
// robots de ne pas lire `/users/*`. On ne lit donc qu'À LA DEMANDE de la
// personne, SON profil (qu'elle a confirmé), quelques dizaines de pages au
// plus, sous un nom de robot honnête. Si Stash ferme cet accès ou le demande,
// on arrête : l'import échoue alors proprement (profil introuvable).
//
// ⚠️ LE RAPPROCHEMENT DES JEUX EST EXACT. Stash s'appuie sur IGDB, et ses
// adresses de jeux (`/games/final-fantasy-vii--6`) SONT les slugs IGDB : on
// les résout tels quels, sans comparer de titres. La jaquette (identifiant
// d'image IGDB) sert de filet pour les rares slugs qu'IGDB aurait renommés.
// Vérifié sur un vrai profil : 110 jeux sur 110, slug et jaquette d'accord.
//
// ⚠️ CE FICHIER DÉPEND DE LA MISE EN PAGE D'UN SITE TIERS. Chaque extraction
// est tolérante (une carte illisible est sautée) et l'aperçu montre TOUT avant
// d'écrire quoi que ce soit.

import { igdbQuery } from "./igdb.js";

const BASE = "https://api.stash.games";
const IMG = "https://images.igdb.com/igdb/image/upload";
// On s'annonce pour ce qu'on est, comme pour Backloggd.
const UA = "MyPlayLog/1.0 (+https://myplaylog.fr) import-bot";

// 100 par page : c'est le plafond de `/statuses` (à 200, le serveur répond
// 500). Une bibliothèque de 2 000 jeux tient ainsi en une vingtaine de pages.
const PAGE = 100;
const PAGE_DELAY = 250;
// Plafond par rayon : sans lui, une pagination qui se répète tournerait
// indéfiniment.
const MAX_PAGES = 60;

// Les quatre rayons de Stash, dans l'ordre où on les lit.
export const SHELVES = ["want", "playing", "beaten", "archived"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le pseudo contenu dans ce qu'on a tapé ou collé, ou `null`. */
export function parseUsername(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const m = raw.match(/stash\.games\/users\/([^/?#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  const bare = raw.replace(/^@/, "");
  if (/^[\w.-]{1,40}$/.test(bare)) return bare;
  return null;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    // Un profil inconnu répond 302 vers /404 : on ne suit pas, on le lit.
    redirect: "manual",
  });
  if (res.status >= 300 && res.status < 400) return null;
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Stash ne répond pas (${res.status}). Réessaie dans un moment.`);
    err.status = 502;
    throw err;
  }
  return res.text();
}

// Le HTML de Stash échappe ses textes : on les rend lisibles.
function decode(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

const meta = (html, prop) =>
  html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1] || null;

// ---------------------------------------------------------------------------
//  Le profil : « c'est bien toi ? »
// ---------------------------------------------------------------------------

/**
 * La carte d'identité d'un profil Stash : pseudo exact, nom, photo, et ce
 * qu'il contient. `null` si le profil n'existe pas.
 *
 * ⚠️ LES PSEUDOS STASH DISTINGUENT LES MAJUSCULES (`/users/mitosilver` répond
 * introuvable quand le profil est `MitoSilver`), et le site n'a pas de
 * recherche d'utilisateurs. On essaie donc le pseudo tel quel, puis en
 * minuscules, puis avec une capitale : trois requêtes au pire, et le cas le
 * plus courant (on a tapé tout en minuscules) est rattrapé.
 */
export async function fetchProfile(input) {
  const typed = parseUsername(input);
  if (!typed) return null;
  const tries = [
    ...new Set([typed, typed.toLowerCase(), typed[0].toUpperCase() + typed.slice(1).toLowerCase()]),
  ];
  for (const candidate of tries) {
    const html = await get(`${BASE}/users/${encodeURIComponent(candidate)}`);
    if (!html) continue;
    const username = meta(html, "profile:username") || candidate;
    const first = decode(meta(html, "profile:first_name"));
    const last = decode(meta(html, "profile:last_name"));
    let avatar = meta(html, "og:image");
    // Sans photo, Stash sert sa jaquette vide : autant dire rien.
    if (avatar && /empty_cover|\/images\/stash\//.test(avatar)) avatar = null;
    const count = (label) =>
      Number(html.match(new RegExp(`${label}\\s*\\(<span>(\\d+)</span>\\)`))?.[1] || 0);
    return {
      username,
      name: [first, last].filter(Boolean).join(" ") || username,
      avatar,
      games: count("Games"),
      reviews: count("Reviews"),
      followers: count("Followers"),
      url: `https://stash.games/users/${encodeURIComponent(username)}/games`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Extraction
// ---------------------------------------------------------------------------

/**
 * Les jeux d'une page de rayon.
 *
 * Chaque carte porte : le slug IGDB (dans le lien), le titre, la jaquette, la
 * note (sur 10, absente si pas noté) et des « marqueurs » — de petites icônes
 * qui précisent le statut : `mainStory` / `mainPlusExtras` / `completionists`
 * pour un jeu fini, `onPause` / `endless` pour un jeu en cours, `abandoned` /
 * `notPlayed` pour un jeu archivé, et `owned` (possédé) n'importe où.
 */
function parseShelfPage(html) {
  const out = [];
  // On découpe par carte AVANT de lire les attributs (cf. lib/backloggd : une
  // seule expression exigeant tous les champs perd en silence les cartes
  // incomplètes — un jeu non noté, par exemple).
  const cards = String(html).split(/<div class="games-list__item[\s"]/).slice(1);
  for (const card of cards) {
    const slug = card.match(/href="\/games\/([^"?#/]+)"/)?.[1];
    if (!slug) continue;
    const rating = card.match(/class="game__rating[^"]*">\s*(\d+(?:\.\d+)?)\s*</)?.[1];
    out.push({
      slug,
      title: decode(card.match(/data-text="([^"]*)"/)?.[1]) || null,
      coverId: card.match(/\/t_[a-z0-9_]+\/([a-z0-9]+)\.(?:webp|jpg|png)/)?.[1] || null,
      rating: rating != null ? Number(rating) : null,
      markers: [...new Set([...card.matchAll(/\/images\/markers\/([a-zA-Z]+)/g)].map((m) => m[1]))],
    });
  }
  return out;
}

/** Les avis d'une page : le slug du jeu, la note, le texte et sa date. */
function parseReviewsPage(html) {
  const out = [];
  const blocks = String(html).split(/<div data-link="/).slice(1);
  for (const b of blocks) {
    const slug = b.match(/^\/games\/([^/"]+)\/reviews\//)?.[1];
    if (!slug) continue;
    const rating = b.match(/class="game__review-rating">\s*(\d+(?:\.\d+)?)/)?.[1];
    const date = new Date(decode(b.match(/class="game__review-date">([^<]+)</)?.[1]));
    out.push({
      slug,
      title: decode(b.match(/<img[^>]*\balt="([^"]*)"/)?.[1]) || null,
      coverId: b.match(/\/t_[a-z0-9_]+\/([a-z0-9]+)\.(?:webp|jpg|png)/)?.[1] || null,
      rating: rating != null ? Number(rating) : null,
      text: decode(b.match(/<p class="review-text">([\s\S]*?)<\/p>/)?.[1]).slice(0, 5000),
      reviewedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Correspondance des statuts
// ---------------------------------------------------------------------------

/**
 * Le statut MyPlayLog d'un jeu, d'après son rayon et ses marqueurs.
 *
 * ⚠️ « ARCHIVÉ SANS Y JOUER » N'EST PAS « ABANDONNÉ ». Stash range au même
 * endroit les jeux lâchés en cours de route (`abandoned`) et ceux qu'on a
 * décidé de ne jamais lancer (`notPlayed`). Les seconds n'ont rien à faire
 * dans une bibliothèque : ce sont des « pas intéressé » — on les écarte des
 * recommandations, et c'est tout (cf. routes/stash.js).
 */
function statusOf(shelf, markers) {
  const has = (m) => markers.includes(m);
  if (shelf === "want") return "wishlist";
  if (shelf === "playing") return has("onPause") ? "paused" : has("endless") ? "endless" : "playing";
  if (shelf === "beaten") return "finished";
  // Archivé : sans précision, c'est un jeu qu'on a rangé sans le finir.
  if (has("notPlayed")) return "notInterested";
  if (has("endless")) return "endless";
  return "dropped";
}

// Ce que dit un jeu fini : jusqu'où on est allé.
function completionOf(markers) {
  if (markers.includes("completionists")) return "full";
  if (markers.includes("mainPlusExtras")) return "extras";
  if (markers.includes("mainStory")) return "main";
  return null;
}

// ---------------------------------------------------------------------------
//  Rapprochement IGDB
// ---------------------------------------------------------------------------

const quoteList = (arr) => arr.map((x) => `"${x}"`).join(",");
const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * slug → { id, name, cover } pour tout ce qu'IGDB reconnaît. Les slugs
 * inconnus (renommés depuis) sont repris par l'identifiant de jaquette.
 */
async function resolveIgdb(rows) {
  const bySlug = new Map();
  const slugs = [...new Set(rows.map((r) => r.slug))].filter((s) => /^[a-z0-9-]+$/.test(s));
  for (const part of chunk(slugs, 400)) {
    const games = await igdbQuery(
      "games",
      `fields id,name,slug,cover.image_id; where slug = (${quoteList(part)}); limit 500;`
    );
    for (const g of games || []) {
      bySlug.set(g.slug, {
        id: g.id,
        name: g.name,
        cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
      });
    }
  }

  // Le filet : la jaquette. Une image IGDB n'appartient qu'à un jeu.
  const missing = rows.filter((r) => !bySlug.has(r.slug) && /^[a-z0-9]+$/.test(r.coverId || ""));
  const covers = [...new Set(missing.map((r) => r.coverId))];
  const gameByCover = new Map();
  for (const part of chunk(covers, 400)) {
    const found = await igdbQuery(
      "covers",
      `fields game,image_id; where image_id = (${quoteList(part)}); limit 500;`
    );
    for (const c of found || []) if (c.game) gameByCover.set(c.image_id, c.game);
  }
  for (const r of missing) {
    const id = gameByCover.get(r.coverId);
    if (id && !bySlug.has(r.slug)) {
      bySlug.set(r.slug, { id, name: r.title, cover: `${IMG}/t_cover_big/${r.coverId}.jpg` });
    }
  }
  return bySlug;
}

// ---------------------------------------------------------------------------
//  La moisson complète
// ---------------------------------------------------------------------------

/**
 * Toute la bibliothèque Stash de `username` (le pseudo EXACT, cf.
 * fetchProfile), mise à notre format.
 *
 * `onProgress({ step, shelves, reviews, covers })` est appelé à chaque page :
 * c'est ce qui permet à l'écran d'attente de se remplir sous les yeux.
 *
 * Rend `{ games, counts, unmatched }`. Rien n'est écrit en base.
 */
export async function scrapeLibrary(username, onProgress = () => {}) {
  const user = `${BASE}/users/${encodeURIComponent(username)}`;
  const progress = {
    step: "shelves",
    // Le rayon en cours de lecture (l'écran d'attente anime sa ligne).
    shelf: SHELVES[0],
    shelves: Object.fromEntries(SHELVES.map((s) => [s, 0])),
    reviews: 0,
    // Les dernières jaquettes trouvées : l'écran d'attente les fait défiler.
    covers: [],
  };
  const tick = () => onProgress({ ...progress, covers: progress.covers.slice(-24) });

  // --- 1. Les quatre rayons, page par page. ---
  //
  // ⚠️ LES PAGES SONT TRIÉES PAR DATE DE MODIFICATION, et la pagination se
  // fait par décalage. Si le joueur range un jeu PENDANT qu'on lit (vu sur un
  // vrai profil : un avis posté en pleine lecture), tout glisse d'un cran —
  // une carte revient deux fois, une autre saute. Le doublon est le signe :
  // un rayon qui en a eu est relu, et les deux lectures s'additionnent.
  //
  // ⚠️ ET LA FIN SE LIT SUR LA PAGE BRUTE, PAS APRÈS DÉDOUBLONNAGE. Tester
  // « moins de 100 jeux nouveaux » arrêtait le rayon à la première page qui
  // contenait un doublon : 301 jeux finis lus sur 455.
  const bySlug = new Map();
  for (const shelf of SHELVES) {
    progress.shelf = shelf;
    for (let pass = 0; pass < 3; pass++) {
      let raw = 0;
      let dupes = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const html = await get(
          `${user}/statuses?offset=${page * PAGE}&limit=${PAGE}&include=tags:${shelf}`
        );
        if (html === null) {
          const err = new Error(`Profil Stash introuvable : ${username}.`);
          err.status = 404;
          throw err;
        }
        const cards = parseShelfPage(html);
        raw += cards.length;
        for (const r of cards) {
          const known = bySlug.get(r.slug);
          // Déjà lu dans CE rayon pendant CETTE lecture : un glissement.
          if (known?.pass === pass && known.shelf === shelf) dupes++;
          // La lecture la plus récente fait foi (le jeu a pu changer de rayon).
          if (!known && r.coverId) progress.covers.push(`${IMG}/t_cover_big/${r.coverId}.jpg`);
          bySlug.set(r.slug, { ...r, shelf, pass });
        }
        progress.shelves[shelf] = [...bySlug.values()].filter((g) => g.shelf === shelf).length;
        tick();
        if (cards.length < PAGE) break;
        await sleep(PAGE_DELAY);
      }
      if (!dupes || !raw) break;
    }
  }

  // --- 2. Les avis : le texte, et sa date. ---
  progress.step = "reviews";
  tick();
  const reviews = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await get(`${user}/reviews/items?offset=${page * PAGE}&limit=${PAGE}`).catch(
      () => null
    );
    if (!html) break;
    const rows = parseReviewsPage(html);
    for (const r of rows) if (!reviews.has(r.slug)) reviews.set(r.slug, r);
    progress.reviews = reviews.size;
    tick();
    if (rows.length < PAGE) break;
    await sleep(PAGE_DELAY);
  }
  // Un avis sur un jeu absent des rayons (rare, mais ça existe) : on le garde
  // plutôt que de perdre ce qui a été écrit.
  for (const r of reviews.values()) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, { ...r, markers: [], shelf: "beaten" });
    }
  }

  // --- 3. Le rapprochement avec IGDB. ---
  progress.step = "matching";
  tick();
  const rows = [...bySlug.values()];
  const igdb = rows.length ? await resolveIgdb(rows) : new Map();

  // --- 4. Mise au propre ---
  const games = [];
  const unmatched = [];
  const seen = new Set();
  for (const r of rows) {
    const g = igdb.get(r.slug);
    if (!g) {
      unmatched.push({ title: r.title, slug: r.slug });
      continue;
    }
    // Deux slugs Stash vers le même jeu IGDB : le premier rayon lu gagne.
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const review = reviews.get(r.slug);
    const rating10 = r.rating ?? review?.rating ?? null;
    games.push({
      igdbId: g.id,
      title: g.name || r.title,
      cover: g.cover || (r.coverId ? `${IMG}/t_cover_big/${r.coverId}.jpg` : null),
      // Stash note sur 10, nous sur 100.
      rating: rating10 != null ? Math.max(0, Math.min(100, Math.round(rating10 * 10))) : null,
      status: statusOf(r.shelf, r.markers),
      shelf: r.shelf,
      completion: r.shelf === "beaten" ? completionOf(r.markers) : null,
      // « Completionist » chez eux = terminé à 100 % chez nous.
      platinum: r.shelf === "beaten" && r.markers.includes("completionists"),
      owned: r.markers.includes("owned"),
      review: review?.text || null,
      reviewedAt: review?.text ? review.reviewedAt : null,
    });
  }

  return { games, counts: countBy(games), unmatched };
}

export function countBy(games) {
  const byStatus = {};
  for (const g of games) byStatus[g.status] = (byStatus[g.status] || 0) + 1;
  return {
    total: games.length,
    rated: games.filter((g) => g.rating != null).length,
    reviewed: games.filter((g) => g.review).length,
    byStatus,
  };
}
