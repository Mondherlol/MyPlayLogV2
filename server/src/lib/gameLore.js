import * as cheerio from "cheerio";

import { gameBundleContents, gameCore } from "./gameIgdb.js";

// ======================================================================
//  Où l'on va CHERCHER les histoires, au lieu de les inventer
// ======================================================================
//
// ⚠️ CE FICHIER EXISTE POUR UNE SEULE RAISON : une anecdote inventée est pire
// qu'une anecdote absente. Elle se raconte, elle se répète, et elle finit par
// passer pour vraie.
//
// La première version du mode Trivia demandait les anecdotes à Gemini DE
// MÉMOIRE. Ça marche pour Zelda et ça part en fiction pour tout le reste — et
// on ne voit pas la différence, c'est bien le problème. Ici on va donc chercher
// du TEXTE ÉCRIT PAR DES HUMAINS, et le modèle n'a plus qu'à le découper.
//
// Quatre sources, de la plus fiable à la plus bavarde :
//
//   • Wikipédia — sections « Développement », « Conception », « Réception ».
//     C'est là que vivent exactement les histoires qu'on cherche, et c'est
//     sourcé. FR et EN : l'anglais est presque toujours plus fourni.
//   • Fandom — la section « Trivia » du wiki du jeu, déjà en puces.
//   • MobyGames — sa page « Trivia », écrite à la main depuis vingt-cinq ans.
//   • Giant Bomb — sa fiche encyclopédique, si la clé est configurée.
//
// ⚠️ ON NE DEVINE PAS LES URL DE WIKIPÉDIA ET DE FANDOM : IGDB les donne
// (`websites`, catégorie 3 et 2). Une recherche par nom se trompe de jeu une
// fois sur cinq — et se tromper de jeu, ici, c'est raconter l'histoire d'un
// autre en la donnant pour celle-ci.

const UA =
  "Mozilla/5.0 (compatible; MyPlayLog/1.0; +https://myplaylog.cc) trivia-collector";

// Chaque source a droit à dix secondes et pas une de plus. Elles sont
// interrogées en parallèle et le paquet part avec ce qui est revenu : une
// anecdote de moins vaut mieux qu'un écran qui attend MobyGames.
const TIMEOUT = 10_000;

async function getText(url, extra = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...(extra.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return res.text();
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return res.json();
}

// Le HTML d'une section de wiki, réduit à sa prose. On jette AVANT de lire :
// les appels de note (« [12] »), les encadrés, les tableaux, les galeries et
// les sommaires n'apportent rien au modèle et lui mangent sa fenêtre.
function wikiHtmlToText(html) {
  const $ = cheerio.load(html);
  $(
    "sup.reference, .reference, .mw-editsection, table, .infobox, .navbox, " +
      ".thumb, .gallery, .toc, style, script, .mw-empty-elt, .noprint"
  ).remove();
  return $.root()
    .text()
    .replace(/\[\d+\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ----------------------------------------------------------------------
//  Le jeu D'ORIGINE
// ----------------------------------------------------------------------
// ⚠️ ON CHERCHE LES ANECDOTES DU JEU SOUCHE, PAS DE L'ÉDITION OÙ L'ON SE
// TROUVE. Ouvrir « Resident Evil 4 (2023) » ou « The Last of Us Part I » et
// recevoir les coulisses du remake, c'est passer à côté de toute l'histoire :
// les vraies anecdotes de fabrication sont celles de 2005 et de 2013. Wikipédia
// et Fandom, d'ailleurs, n'ont souvent qu'une page — celle de l'original.
//
// On remonte donc la chaîne : l'édition remonte à son jeu (`version_parent`),
// le remake / portage / DLC remonte au sien (`parent_game`).
const DERIVED = new Set([
  1, // DLC
  2, // extension
  4, // extension autonome
  6, // épisode
  7, // saison
  8, // remake
  9, // remaster
  10, // version enrichie
  11, // portage
  14, // mise à jour
]);

// Les recueils : bundle et pack. Eux ne se remontent pas, ils se DESCENDENT
// (cf. firstOfBundle).
const BUNDLES = new Set([3, 13]);

const MAX_HOPS = 3;

/**
 * Le jeu souche de `game` : l'original dont il est l'édition, le remake ou le
 * portage. Rend `game` lui-même quand il EST l'original.
 */
export async function originalGame(game) {
  let cur = game;

  // ⚠️ UN RECUEIL, ON Y ENTRE. Sa page d'encyclopédie ne raconte que le
  // portage — « sorti sur 3DS puis sur Switch » — pendant que les articles des
  // jeux qu'il contient, eux, sont pleins d'histoires. Et comme il n'a aucun
  // parent, la remontée ci-dessous ne peut rien pour lui : c'est ce qui faisait
  // répondre « pas d'anecdote » sur Ace Attorney Trilogy.
  //
  // On descend AVANT de remonter : le jeu trouvé à l'intérieur peut lui-même
  // être un remaster qui a son propre original.
  if (BUNDLES.has(cur.game_type)) {
    const inside = await firstOfBundle(cur);
    if (inside) cur = inside;
  }

  for (let i = 0; i < MAX_HOPS; i++) {
    // Une édition (« Game of the Year », « Definitive ») pend sous
    // `version_parent` ; un remake ou un DLC sous `parent_game`.
    const up =
      cur.version_parent?.id ||
      (DERIVED.has(cur.game_type) ? cur.parent_game?.id : null);
    if (!up || up === cur.id) break;

    // La fiche du parent est nécessaire pour continuer de remonter : IGDB
    // n'aplatit la parenté que d'un cran.
    const parent = await gameCore(up).catch(() => null);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/**
 * Le premier jeu d'un recueil — trilogie, compilation, intégrale.
 *
 * ⚠️ CEUX-LÀ NE SE REMONTENT PAS, ILS SE DESCENDENT. Un recueil n'a pas de
 * parent : il a des contenus. « Phoenix Wright: Ace Attorney Trilogy » n'est
 * donc l'enfant de personne, et sa propre page d'encyclopédie ne raconte que
 * son portage — pendant que trois articles entiers dorment un cran plus bas.
 * Résultat vu en vrai : « pas d'anecdote » sur une trilogie qui en regorge.
 *
 * On prend le PREMIER paru : c'est là que commence l'histoire du recueil, et
 * c'est presque toujours celui dont on a le plus écrit.
 */
export async function firstOfBundle(game) {
  const members = await gameBundleContents(game.id).catch(() => null);
  if (!Array.isArray(members) || !members.length) return null;

  const first = members
    .filter((m) => m?.id && m.id !== game.id)
    .sort((a, b) => (a.first_release_date || Infinity) - (b.first_release_date || Infinity))[0];

  return first ? gameCore(first.id).catch(() => null) : null;
}

// ----------------------------------------------------------------------
//  Wikipédia
// ----------------------------------------------------------------------
// Les sections qui racontent quelque chose. Tout le reste d'un article de jeu
// (le gameplay, le scénario, la liste des plateformes) est déjà sur la fiche —
// le redonner au modèle, c'est l'inviter à paraphraser la fiche.
const WANTED = /d[ée]veloppement|development|conception|design|cr[ée]ation|production|[ée]criture|writing|musique|music|bande[- ]son|soundtrack|casting|doublage|voice|r[ée]ception|reception|accueil|post[ée]rit[ée]|legacy|h[ée]ritage|ventes|sales|controvers|anecdote|trivia/i;

async function wikiSections(api, title) {
  const url = `${api}?action=parse&page=${encodeURIComponent(
    title
  )}&prop=sections&format=json&redirects=1`;
  const json = await getJson(url);
  return json?.parse?.sections || [];
}

async function wikiSectionText(api, title, index) {
  const url = `${api}?action=parse&page=${encodeURIComponent(
    title
  )}&section=${index}&prop=text&format=json&redirects=1`;
  const json = await getJson(url);
  const html = json?.parse?.text?.["*"];
  return html ? wikiHtmlToText(html) : "";
}

// Les titres de section arrivent en HTML (« <i>Turnabout Sisters</i> ») : sans
// ça, le filtre passe à côté d'une section dont le nom est en italique.
const plain = (s) => String(s || "").replace(/<[^>]+>/g, "").trim();

// Le titre de page, extrait de l'URL que donne IGDB.
function titleOf(url) {
  const m = String(url || "").match(/\/wiki\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function wikipediaLore(pageUrl, name) {
  let host = "en.wikipedia.org";
  let title = titleOf(pageUrl);

  if (pageUrl) {
    const h = String(pageUrl).match(/^https?:\/\/([^/]+)/);
    if (h) host = h[1];
  }

  // Pas de lien dans IGDB : on cherche, mais en exigeant que ce soit un jeu —
  // « Battlefront » tout court tombe sinon sur un film ou une bataille.
  if (!title) {
    const found = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        `${name} video game`
      )}&srlimit=1&format=json`
    );
    title = found?.query?.search?.[0]?.title || null;
  }
  if (!title) return null;

  const api = `https://${host}/w/api.php`;
  const sections = await wikiSections(api, title);
  const picked = sections
    .filter((s) => WANTED.test(plain(s.line)))
    // Les sections de niveau 2 emportent leurs sous-sections : prendre les
    // deux, c'est se donner le même texte deux fois.
    .filter((s) => Number(s.toclevel) <= 2)
    .slice(0, 4);

  const blocks = [];
  for (const s of picked) {
    const text = await wikiSectionText(api, title, s.index).catch(() => "");
    if (text.length > 200) blocks.push(`## ${plain(s.line)}\n${text.slice(0, 6000)}`);
  }
  if (!blocks.length) return null;

  return {
    source: "wikipedia",
    label: "Wikipédia",
    url: `https://${host}/wiki/${encodeURIComponent(title)}`,
    text: blocks.join("\n\n"),
  };
}

// ----------------------------------------------------------------------
//  Fandom — le wiki du jeu, tenu par ses fans
// ----------------------------------------------------------------------
// C'est une mine, et pas seulement la section « Trivia » : les wikis de jeu ont
// des sections « Development », « Unused content », « Beta » où sont consignés
// des détails qu'aucune encyclopédie ne garde — la piste musicale jamais
// utilisée, le personnage coupé, le nom de code du projet.
//
// C'est aussi la source la moins sûre : de la spéculation de fan y passe pour
// un fait. On le DIT au modèle (cf. le prompt de lib/gameTrivia.js).
const FANDOM_WANTED =
  /trivia|anecdote|curiosit|d[ée]veloppement|development|unused|cut content|beta|behind the scenes|production|conception|cr[ée]ation/i;

async function fandomLore(pageUrl) {
  const m = String(pageUrl || "").match(/^https?:\/\/([^/]+)\/wiki\/([^?#]+)/);
  if (!m) return null;
  const [, host, raw] = m;
  const title = decodeURIComponent(raw);
  const api = `https://${host}/api.php`;

  const sections = await wikiSections(api, title);
  const picked = sections.filter((s) => FANDOM_WANTED.test(plain(s.line))).slice(0, 3);
  if (!picked.length) return null;

  const blocks = [];
  for (const s of picked) {
    const text = await wikiSectionText(api, title, s.index).catch(() => "");
    if (text.length > 120) blocks.push(`## ${plain(s.line)}\n${text.slice(0, 5000)}`);
  }
  if (!blocks.length) return null;

  return {
    source: "fandom",
    label: "Fandom",
    url: pageUrl,
    text: blocks.join("\n\n"),
  };
}

// ----------------------------------------------------------------------
//  MobyGames — sa page « Trivia »
// ----------------------------------------------------------------------
// Vingt-cinq ans d'anecdotes écrites à la main, déjà en puces : sur le papier,
// la meilleure source du lot. L'API v1 ne les expose pas, c'est donc la page
// HTML qu'on lit.
//
// ⚠️ MESURÉ EN 2026 : Cloudflare répond 403 à tout, quel que soit l'en-tête —
// ce n'est pas une question d'User-Agent, c'est l'adresse IP qui est jugée. Le
// code reste (l'adresse du serveur de prod n'est peut-être pas logée à la même
// enseigne, et ça peut rouvrir), mais avec un COUPE-CIRCUIT : après trois
// refus, on arrête de frapper à la porte pour la durée du processus. Sans lui,
// chaque jeu jamais vu paie une seconde d'attente pour un 403 certain.
let mobyRefusals = 0;

async function mobyLore(name) {
  if (mobyRefusals >= 3) return null;

  const html = await getText(
    `https://www.mobygames.com/search/?q=${encodeURIComponent(name)}&type=game`
  ).catch((err) => {
    if (/^40[13]/.test(err.message)) mobyRefusals += 1;
    throw err;
  });
  const $ = cheerio.load(html);
  const href = $('a[href*="/game/"]').first().attr("href");
  if (!href) return null;

  const base = href.startsWith("http") ? href : `https://www.mobygames.com${href}`;
  // On garde /game/<id>/<slug>/ et on y accroche l'onglet trivia.
  const clean = base.split("?")[0].replace(/\/+$/, "");
  const url = `${clean}/trivia/`;

  const page = await getText(url);
  const $$ = cheerio.load(page);
  $$("script, style, nav, header, footer, .ad, aside").remove();
  const text = $$("#main, main, article")
    .first()
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length < 200) return null;
  return {
    source: "mobygames",
    label: "MobyGames",
    url,
    text: text.slice(0, 8000),
  };
}

// ----------------------------------------------------------------------
//  Giant Bomb — la fiche encyclopédique
// ----------------------------------------------------------------------
// De la prose, pas des anecdotes : c'est la source d'appoint. Muette sans clé
// (GIANTBOMB_API_KEY dans server/.env), et ce n'est pas grave.
async function giantBombLore(name) {
  const key = process.env.GIANTBOMB_API_KEY;
  if (!key) return null;

  const found = await getJson(
    `https://www.giantbomb.com/api/search/?api_key=${key}&format=json&limit=1&resources=game&query=${encodeURIComponent(
      name
    )}`
  );
  const hit = found?.results?.[0];
  if (!hit?.guid) return null;

  const detail = await getJson(
    `https://www.giantbomb.com/api/game/${hit.guid}/?api_key=${key}&format=json&field_list=description,site_detail_url`
  );
  const html = detail?.results?.description;
  if (!html) return null;

  const text = wikiHtmlToText(html);
  if (text.length < 300) return null;
  return {
    source: "giantbomb",
    label: "Giant Bomb",
    url: detail.results.site_detail_url || hit.site_detail_url,
    text: text.slice(0, 6000),
  };
}

/**
 * Tout ce qu'on a trouvé sur ce jeu, en parallèle et sans jamais échouer.
 *
 * Rend un tableau de `{ source, label, url, text }`. Vide = personne n'a rien
 * écrit sur ce jeu, et c'est une information : le modèle travaillera alors de
 * mémoire, en le sachant (cf. lib/gameTrivia.js).
 */
export async function collectLore(game) {
  const sites = game.websites || [];
  // IGDB range Wikipédia en 3 et Fandom (« wikia ») en 2, dans `websites.type`
  // (cf. lib/gameIgdb : le champ s'appelait `category` et le renommage était
  // passé inaperçu, faute d'erreur).
  const wiki = sites.find((w) => w.type === 3)?.url || null;
  const fandom = sites.find((w) => w.type === 2)?.url || null;
  const name = game.name || "";

  const settled = await Promise.allSettled([
    wikipediaLore(wiki, name),
    fandom ? fandomLore(fandom) : Promise.resolve(null),
    mobyLore(name),
    giantBombLore(name),
  ]);

  return settled
    .map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      console.warn(`lore ${name} [${i}] :`, r.reason?.message || r.reason);
      return null;
    })
    .filter(Boolean);
}
