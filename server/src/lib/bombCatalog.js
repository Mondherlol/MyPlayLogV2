// ======================================================================
//  La Bombe — le dictionnaire et les défis
// ======================================================================
// La Bombe est un BombParty où le dictionnaire est le catalogue de jeux : un
// défi s'affiche (« Capcom », « Jeu de course », « Sorti sur GameCube », « le
// titre contient ZEL »), le joueur qui tient la bombe tape un jeu qui colle, et
// la bombe passe au suivant. Ce fichier fait les deux moitiés du travail :
//
//   1. RECONNAÎTRE CE QUI EST TAPÉ. Au clavier, sous pression, personne n'écrit
//      « The Legend of Zelda: Ocarina of Time ». On accepte donc le titre, le
//      titre français, le titre sans sous-titre (« Batman »), les abréviations
//      du lexique (« GTA 5 », « RDR2 », « Skyrim »), les chiffres romains
//      écrits en chiffres (« Final Fantasy 7 ») et une faute de frappe ou deux
//      selon la longueur. Ce qui n'est PAS accepté : un bout de titre au
//      hasard (« mario » ne vaut que s'il existe un jeu, ou un titre court,
//      qui s'appelle comme ça).
//
//   2. TIRER DES DÉFIS JOUABLES. Un défi n'a d'intérêt que si la table connaît
//      des réponses. On compte donc, pour chaque défi, les jeux CONNUS qui y
//      répondent (≥ KNOWN_VOTES votes IGDB — ~5 000 jeux sur 44 000), et la
//      difficulté de la partie n'est rien d'autre que le nombre de réponses
//      connues qu'on exige encore, une fois retirés les jeux déjà joués.
//
// Tout vit en mémoire : le catalogue local (GameFeatures, cf. lib/recoCatalog.js)
// est lu une fois, à la première partie, puis toutes les six heures.

import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";
import GameFeatures from "../models/GameFeatures.js";
import IgdbTerm from "../models/IgdbTerm.js";
import { brandOf } from "./companyBrands.js";
import { THEMES, TAGS, tagsForKeyword } from "./cardFacts.js";
import { normalizeTitle, distance } from "./gameSpell.js";
import { ensureEntityLogos } from "./entityLogos.js";
import { onRecoCatalogSynced } from "./recoCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TITLES_FILE = path.join(__dirname, "../data/game-titles.json");

const IMG = "https://images.igdb.com/igdb/image/upload";
export const coverUrl = (id) => (id ? `${IMG}/t_cover_big/${id}.jpg` : null);

// Un jeu « connu » : de quoi espérer que quelqu'un autour de la table y ait
// joué ou en ait entendu parler.
const KNOWN_VOTES = 30;
// Un défi qui n'a pas au moins ça de réponses connues n'est jamais tiré.
const MIN_KNOWN = 10;
// Un studio doit en plus être reconnaissable à son logo : on lui demande plus.
const MIN_KNOWN_STUDIO = 14;
const TTL = 6 * 60 * 60 * 1000;

// ------------------------------------------------------------------ libellés
const GENRES = {
  2: "Point & click",
  4: "Jeu de combat",
  5: "Jeu de tir",
  7: "Jeu musical",
  8: "Jeu de plateforme",
  9: "Jeu de réflexion",
  10: "Jeu de course",
  11: "Stratégie en temps réel",
  12: "RPG",
  13: "Simulation",
  14: "Jeu de sport",
  15: "Stratégie",
  16: "Tour par tour",
  24: "Tactique",
  25: "Beat'em all",
  31: "Aventure",
  32: "Jeu indé",
  33: "Jeu d'arcade",
  34: "Visual novel",
  35: "Cartes & plateau",
  36: "MOBA",
};

// Les consoles : une par une, pas par famille (« Nintendo » serait un défi
// gratuit). Le libellé est le nom qu'on dit, pas celui d'IGDB.
const PLATFORMS = {
  7: "PlayStation",
  8: "PlayStation 2",
  9: "PlayStation 3",
  48: "PlayStation 4",
  167: "PlayStation 5",
  38: "PSP",
  46: "PS Vita",
  18: "NES",
  19: "Super Nintendo",
  4: "Nintendo 64",
  21: "GameCube",
  5: "Wii",
  41: "Wii U",
  130: "Nintendo Switch",
  33: "Game Boy",
  22: "Game Boy Color",
  24: "Game Boy Advance",
  20: "Nintendo DS",
  37: "Nintendo 3DS",
  64: "Master System",
  29: "Mega Drive",
  32: "Saturn",
  23: "Dreamcast",
  11: "Xbox",
  12: "Xbox 360",
  49: "Xbox One",
  169: "Xbox Series",
  52: "Borne d'arcade",
};

const MODES = { 3: "Coop", 4: "Écran partagé" };
const PERSP = { 1: "Vue subjective", 4: "Vue de côté", 3: "Vue du dessus" };
const DECADES = { 1980: "Années 80", 1990: "Années 90", 2000: "Années 2000", 2010: "Années 2010", 2020: "Années 2020" };

// Les sociétés qu'on ne montre pas : des maisons de portage ou de
// distribution qui signent des centaines de jeux sans que personne ne sache
// lesquels. « Feral Interactive » n'est pas un défi, c'est une colle.
const STUDIO_DENY = [
  // Les antennes d'un studio déjà présent : un seul « BioWare ».
  "bioware edmonton",
  "bioware austin",
  "feral interactive",
  "aspyr",
  "virtuos",
  "nightdive",
  "mastertronic",
  "u s gold",
  "ocean software",
  "acclaim",
  "midway",
  "majesco",
  "atari",
  "devolver digital",
  "annapurna",
  "humble",
  "team17",
  "505 games",
  "headup",
  "ratalaika",
  "eastasiasoft",
  "nicalis",
  "limited run",
  "digital eclipse",
  "xseed",
  "nis america",
  "rising star",
  "ziggurat",
  "pqube",
  "idea factory",
  "kemco",
  "d3 publisher",
  "dotemu",
  "red art games",
  // Distributeurs régionaux et filiales de portage : des centaines de jeux à
  // leur nom, aucun qu'on leur attribue.
  "playtronic",
  "gradiente",
  "tec toy",
  "ique",
  "hyundai",
  "macsoft",
  "macplay",
  "netflix",
  "mindscape",
  "gt interactive",
  "virgin interactive",
  "tose",
  "dimps",
  "curve digital",
  "tinybuild",
];

// Des studios qu'on reconnaît au premier coup d'œil, même avec peu de jeux au
// catalogue : on leur demande moins de réponses connues.
const STUDIO_CULT = [
  "fromsoftware",
  "remedy",
  "cd projekt",
  "supergiant",
  "bungie",
  "guerrilla",
  "sucker punch",
  "retro studios",
  "rocksteady",
  "kojima productions",
  "naughty dog",
  "platinumgames",
  "obsidian",
  "valve",
  "rockstar",
  "blizzard",
  "bioware",
  "insomniac",
  "id software",
  "game freak",
  "hal laboratory",
  "rare",
  "team ninja",
  "atlus",
  "level 5",
  "media molecule",
  "quantic dream",
  "dontnod",
  "ubisoft montpellier",
  "arkane",
  "respawn",
  "mojang",
  "riot",
  "epic games",
  "treyarch",
  "infinity ward",
  "dice",
  "criterion",
  "polyphony",
  "camelot",
  "monolith soft",
  "nintendo ead",
];
const MIN_KNOWN_CULT = 6;

// LA liste des studios qu'on montre, et rien d'autre. Le tri automatique (« tous
// les studios qui ont assez de jeux connus ») laissait passer des éditeurs
// que personne ne connaît (« Machin Entertainment ») : retour utilisateur,
// « contente-toi de quelques gros studios ». Des noms qu'un joueur reconnaît
// au logo, et dont il peut citer des jeux sans réfléchir.
const STUDIO_ALLOW = [
  "nintendo",
  "capcom",
  "sega",
  "sony",
  "microsoft",
  "square enix",
  "konami",
  "ubisoft",
  "electronic arts",
  "activision",
  "bandai namco",
  "rockstar",
  "bethesda",
  "fromsoftware",
  "naughty dog",
  "valve",
  "blizzard",
  "atlus",
  "koei tecmo",
  "snk",
  "game freak",
  "hal laboratory",
  "rare",
  "id software",
  "bioware",
  "cd projekt",
  "insomniac",
  "bungie",
  "epic games",
  "riot",
  "platinumgames",
  "2k",
  "warner bros",
  "lucasarts",
  "telltale",
  "level 5",
  "team ninja",
  "remedy",
  "kojima productions",
  "hudson",
  "taito",
  "sonic team",
  "retro studios",
  "mojang",
  "quantic dream",
  "naughty dog",
  "rocksteady",
  "infinity ward",
  "treyarch",
  "ryu ga gotoku",
];

// Combien chaque famille de défis pèse au tirage : de la variété, mais les
// défis les plus « BombParty » (logos, consoles, syllabes) reviennent le plus.
const KIND_WEIGHT = {
  studio: 3,
  platform: 2.4,
  genre: 2,
  tag: 2,
  syllable: 2,
  theme: 1,
  decade: 1,
  mode: 0.5,
  persp: 0.5,
  fav: 1.6,
};

export const KIND_CAPTION = {
  studio: "Un jeu de",
  platform: "Sorti sur",
  genre: "Genre",
  tag: "Tag",
  syllable: "Le titre contient",
  theme: "Thème",
  decade: "Sorti dans les",
  mode: "Jouable en",
  persp: "Vue",
  fav: "Un jeu favori de",
};

// ------------------------------------------------------------ normalisation
// Le texte réduit à ce qui compte pour comparer deux titres. Au-delà de
// normalizeTitle (accents, casse, ponctuation) : les chiffres romains valent
// leurs chiffres arabes, « the » en tête et les « and / et » disparaissent —
// « final fantasy vii » et « Final Fantasy 7 » sont la même clé, « Ratchet &
// Clank » et « ratchet and clank » aussi.
const ROMAN = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
  xiii: "13",
  xiv: "14",
  xv: "15",
  xvi: "16",
};
export function titleKey(s) {
  const words = normalizeTitle(s)
    .split(" ")
    .filter((w) => w && w !== "and" && w !== "et")
    .map((w) => ROMAN[w] || w);
  if (words[0] === "the" && words.length > 1) words.shift();
  return words.join(" ");
}

// Une écriture dans un autre alphabet (japonais, coréen, cyrillique…) : la
// normalisation n'en garderait que les bouts latins — « 大乱闘スマッシュブラザーズ
// SPECIAL » devenait « special », tapable pour Smash Bros. On ne l'indexe pas.
const FOREIGN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
const foreign = (s) => FOREIGN_SCRIPT.test(String(s || ""));

// Le sous-titre retiré : « Batman: Arkham City » → « Batman », « Halo 3 -
// ODST » → « Halo 3 ». Seulement si ce qui reste est un vrai nom.
function headOf(name) {
  const m = String(name || "").split(/\s*(?::| - | – | — )\s*/)[0];
  return m && m !== name ? m : null;
}

// --------------------------------------------------------------- chargement
let cat = null;
let loading = null;
let loadedAt = 0;

onRecoCatalogSynced(() => {
  loadedAt = 0;
});

export async function getBombCatalog() {
  if (cat && Date.now() - loadedAt < TTL) return cat;
  if (!loading) {
    loading = build()
      .then((c) => {
        cat = c;
        loadedAt = Date.now();
        return c;
      })
      .finally(() => {
        loading = null;
      });
  }
  // Un catalogue un peu vieux vaut mieux qu'une partie qui attend.
  if (cat) return cat;
  return loading;
}

async function build() {
  const t0 = Date.now();
  // TOUT le catalogue local, pas seulement le « pool » des recommandations :
  // les compilations (« Phoenix Wright: Ace Attorney Trilogy ») et les jeux
  // venus des ludothèques n'y sont pas, mais on les tape — et ce sont souvent
  // des favoris (défi « un jeu favori de X »).
  const games = await GameFeatures.find({})
    .select("name fr cover date genres themes keywords modes persp franchises collections devs pubs platforms ratingCount")
    .lean();

  const companyIds = new Set();
  const keywordIds = new Set();
  const seriesIds = new Set();
  const franchiseIds = new Set();
  for (const g of games) {
    // Les licences de TOUT le catalogue : « pokémon » doit couvrir aussi les
    // épisodes peu votés.
    for (const s of g.collections || []) seriesIds.add(s);
    for (const f of g.franchises || []) franchiseIds.add(f);
    if ((g.ratingCount || 0) < KNOWN_VOTES) continue;
    for (const c of g.devs || []) companyIds.add(c);
    for (const c of g.pubs || []) companyIds.add(c);
    for (const k of g.keywords || []) keywordIds.add(k);
  }
  const [companies, keywords, collections, franchises, platforms] = await Promise.all([
    IgdbTerm.find({ kind: "company", id: { $in: [...companyIds] } }).select("id name").lean(),
    IgdbTerm.find({ kind: "keyword", id: { $in: [...keywordIds] } }).select("id name").lean(),
    IgdbTerm.find({ kind: "collection", id: { $in: [...seriesIds] } }).select("id name").lean(),
    IgdbTerm.find({ kind: "franchise", id: { $in: [...franchiseIds] } }).select("id name").lean(),
    IgdbTerm.find({ kind: "platform", id: { $in: Object.keys(PLATFORMS).map(Number) } })
      .select("id name")
      .lean(),
  ]);
  const companyName = new Map(companies.map((t) => [t.id, t.name]));
  const kwTags = new Map();
  for (const t of keywords) {
    const tags = tagsForKeyword(t.name);
    if (tags.length) kwTags.set(t.id, tags);
  }
  const tagLabel = Object.fromEntries(TAGS.map((t) => [t.key, t.label]));
  const platformName = new Map(platforms.map((t) => [t.id, t.name]));

  // Les jeux, du plus connu au moins connu : le rang sert aux bots (un bot
  // « facile » ne connaît que le haut du classement).
  games.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0));
  const byId = new Map();
  const names = new Map(); // clé de titre → [ids]
  const addName = (key, id) => {
    if (!key || key.length < 2) return;
    const list = names.get(key);
    if (!list) names.set(key, [id]);
    else if (!list.includes(id)) list.push(id);
  };

  // Les licences (franchises et collections IGDB) : id → jeux.
  const licenseIds = new Map();
  const inLicense = (k, id) => {
    const set = licenseIds.get(k);
    if (set) set.add(id);
    else licenseIds.set(k, new Set([id]));
  };

  // Défis candidats : clé → { kind, label, ids:Set, known:[] }.
  const cands = new Map();
  const studioNames = new Map(); // clé de marque → Map(nom brut → nb)
  const touch = (key, kind, label, g, known) => {
    let c = cands.get(key);
    if (!c) {
      c = { key, kind, label, ids: new Set(), known: [] };
      cands.set(key, c);
    }
    if (c.ids.has(g._id)) return;
    c.ids.add(g._id);
    if (known) c.known.push(g._id);
  };

  games.forEach((g, rank) => {
    const known = (g.ratingCount || 0) >= KNOWN_VOTES;
    const year = g.date ? new Date(g.date * 1000).getUTCFullYear() : null;
    byId.set(g._id, {
      id: g._id,
      name: g.name,
      fr: g.fr || null,
      cover: g.cover || null,
      year,
      votes: g.ratingCount || 0,
      rank,
      key: titleKey(g.name),
      frKey: g.fr && !foreign(g.fr) ? titleKey(g.fr) : null,
    });
    addName(titleKey(g.name), g._id);
    if (g.fr && !foreign(g.fr)) addName(titleKey(g.fr), g._id);
    const head = headOf(g.name);
    if (head && titleKey(head).length >= 4) addName(titleKey(head), g._id);
    // Le sous-titre seul : « Minish Cap », « Wild Hunt », « Breath of the
    // Wild ». Personne ne tape le nom de la licence devant, sous pression.
    const tail = tailOf(g.name);
    if (tail) addName(tail, g._id);
    for (const id of g.collections || []) inLicense(`c:${id}`, g._id);
    for (const id of g.franchises || []) inLicense(`f:${id}`, g._id);

    // Studios : développeurs ET éditeurs, regroupés par marque (« Capcom
    // Production Studio 4 » est un Capcom).
    for (const cid of new Set([...(g.devs || []), ...(g.pubs || [])])) {
      const raw = companyName.get(cid);
      if (!raw) continue;
      const brand = brandOf(raw);
      const key = `s:${brand.key}`;
      touch(key, "studio", brand.name, g, known);
      const counts = studioNames.get(key) || new Map();
      counts.set(raw, (counts.get(raw) || 0) + (known ? 1 : 0));
      studioNames.set(key, counts);
      if (brand.logo) cands.get(key).logoName = brand.logo;
    }
    for (const id of g.genres || []) if (GENRES[id]) touch(`g:${id}`, "genre", GENRES[id], g, known);
    for (const id of g.themes || []) if (THEMES[id]) touch(`t:${id}`, "theme", THEMES[id], g, known);
    for (const id of g.platforms || [])
      if (PLATFORMS[id]) touch(`p:${id}`, "platform", PLATFORMS[id], g, known);
    for (const id of g.modes || []) if (MODES[id]) touch(`m:${id}`, "mode", MODES[id], g, known);
    for (const id of g.persp || []) if (PERSP[id]) touch(`v:${id}`, "persp", PERSP[id], g, known);
    if (year) {
      const dec = Math.floor(year / 10) * 10;
      if (DECADES[dec]) touch(`d:${dec}`, "decade", DECADES[dec], g, known);
    }
    const tags = new Set();
    for (const k of g.keywords || []) for (const t of kwTags.get(k) || []) tags.add(t);
    for (const t of tags) touch(`k:${t}`, "tag", tagLabel[t], g, known);
  });

  // Les variantes du lexique (abréviations, titres alternatifs) : rattachées
  // aux jeux qui portent exactement le titre principal correspondant.
  try {
    const raw = JSON.parse(fs.readFileSync(TITLES_FILE, "utf8"));
    const primary = (raw.names || []).map(([n]) => titleKey(n));
    for (const [alt, i] of raw.alts || []) {
      if (/\.exe$/i.test(alt) || foreign(alt)) continue;
      const k = titleKey(alt);
      if (k.length < 3) continue;
      const ids = names.get(primary[i]);
      if (ids) for (const id of ids) addName(k, id);
    }
  } catch {
    /* pas de lexique : on se contente des titres */
  }

  // ---- Les licences, tapables telles quelles ----
  // « pokémon », « fifa », « ace attorney », « zelda » : le nom de la
  // licence vaut n'importe lequel de ses jeux. Une même licence existe souvent
  // deux fois chez IGDB (franchise + collection) : on fusionne par nom.
  const licenses = new Map(); // clé → { name, ids:Set }
  const addLicense = (key, name, ids) => {
    if (!key || key.length < 3) return;
    const l = licenses.get(key);
    if (l) for (const id of ids) l.ids.add(id);
    else licenses.set(key, { name, ids: new Set(ids) });
  };
  for (const [kind, term] of [...collections.map((x) => ["c", x]), ...franchises.map((x) => ["f", x])]) {
    const ids = licenseIds.get(`${kind}:${term.id}`);
    if (!ids?.size) continue;
    const key = titleKey(term.name);
    addLicense(key, term.name, ids);
    // « The Legend of Zelda » → « zelda », « Super Mario » → « mario »,
    // « Tom Clancy's Splinter Cell » → « splinter cell ».
    const short = key.replace(LICENSE_PREFIX, "");
    if (short !== key) addLicense(short, term.name, ids);
  }
  // La licence d'un jeu, pour l'indice : celle dont le nom est DANS son titre
  // (la plus longue — « Metal Gear Solid » plutôt que « Metal Gear »). Un jeu
  // rangé dans une franchise sans en porter le nom (Smash Bros. chez Fire
  // Emblem) n'en a pas.
  const gameLicense = new Map();
  for (const [key, l] of licenses) {
    for (const id of l.ids) {
      const g = byId.get(id);
      if (!g || !g.key.includes(key)) continue;
      const prev = gameLicense.get(id);
      if (!prev || key.length > prev.key.length) gameLicense.set(id, { key, name: l.name });
    }
  }

  // Un seul mot qui désigne une licence (« zelda », « kirby ») : seulement s'il
  // n'est pas un mot de tous les jours.
  const licenseWords = new Map();
  for (const key of licenses.keys())
    for (const w of new Set(key.split(" "))) {
      if (w.length < 4 || LICENSE_STOP.has(w) || /^\d+$/.test(w)) continue;
      if (!licenseWords.has(w)) licenseWords.set(w, new Set());
      licenseWords.get(w).add(key);
    }

  // ---- On ne garde que les défis jouables ----
  const prompts = [];
  for (const c of cands.values()) {
    if (c.kind === "studio") {
      // Le nom affiché : celui de la marque, sinon la variante la plus vue,
      // débarrassée de ses mentions juridiques (« MicroProse Software, Inc. »).
      const counts = studioNames.get(c.key);
      const top = counts ? [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] : null;
      const display = c.label || cleanCompany(top);
      if (!display) continue;
      const flat = normalizeTitle(display);
      if (STUDIO_DENY.some((d) => flat.startsWith(d))) continue;
      if (!STUDIO_ALLOW.some((d) => flat === d || flat.startsWith(`${d} `))) continue;
      if (c.known.length < MIN_KNOWN_CULT) continue;
      c.label = display;
      if (!c.logoName) c.logoName = top;
    } else if (c.known.length < MIN_KNOWN) continue;
    if (c.kind === "platform") c.logoName = platformName.get(Number(c.key.slice(2))) || null;
    prompts.push(c);
  }

  // ---- Les syllabes, à la BombParty ----
  // Deux ou trois lettres qu'on retrouve dans des titres connus. On les tire du
  // catalogue lui-même plutôt que d'une liste écrite à la main : « ZEL » ou
  // « KART » n'existent que parce que des jeux les portent.
  const sylCount = new Map();
  for (const g of byId.values()) {
    if (g.votes < KNOWN_VOTES) continue;
    const seen = new Set();
    for (const w of g.key.split(" ")) {
      if (!/^[a-z]+$/.test(w)) continue;
      for (let n = 2; n <= 3; n += 1)
        for (let i = 0; i + n <= w.length; i += 1) seen.add(w.slice(i, i + n));
    }
    for (const s of seen) sylCount.set(s, (sylCount.get(s) || 0) + 1);
  }
  for (const [syl, n] of sylCount) {
    // Trop rare : personne ne trouve. Trop courant (« er », « an ») : ce n'est
    // plus un défi. Les deux lettres doivent être nettement plus rares.
    // Et au moins une voyelle : « NR » ou « TC » ne se prononcent pas, on ne
    // les « voit » pas dans un titre.
    if (!/[aeiouy]/.test(syl)) continue;
    const [min, max] = syl.length === 2 ? [30, 220] : [18, 300];
    if (n < min || n > max) continue;
    const known = [];
    for (const g of byId.values()) if (g.votes >= KNOWN_VOTES && hasSyllable(g, syl)) known.push(g.id);
    prompts.push({ key: `y:${syl}`, kind: "syllable", label: syl.toUpperCase(), syl, ids: null, known });
  }

  const byKey = new Map(prompts.map((p) => [p.key, p]));
  const byKind = new Map();
  for (const p of prompts) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }

  // Les mots des titres (principaux et français) : « zelda breath of the
  // wild » n'est l'écriture d'aucun jeu, mais tous ses mots sont dans celle de
  // The Legend of Zelda: Breath of the Wild.
  const words = new Map();
  for (const g of byId.values()) {
    for (const k of [g.key, g.frKey]) {
      if (!k) continue;
      for (const w of new Set(k.split(" "))) {
        if (!words.has(w)) words.set(w, new Set());
        words.get(w).add(k);
      }
    }
  }

  // Un mot seul ne vaut une licence que s'il la DÉSIGNE : la plupart des
  // titres qui le contiennent doivent en faire partie. « mario », « zelda »
  // passent ; « special » (CT Special Forces… et cent « Special Edition ») non.
  for (const [w, keys] of licenseWords) {
    const titles = words.get(w);
    if (!titles?.size) continue;
    const ids = new Set();
    for (const k of keys) for (const id of licenses.get(k).ids) ids.add(id);
    let inside = 0;
    for (const k of titles) if ((names.get(k) || []).some((id) => ids.has(id))) inside += 1;
    if (inside / titles.size < 0.6) licenseWords.delete(w);
  }

  // Les longueurs de clés, pour la faute de frappe : on ne compare qu'aux
  // titres de longueur voisine.
  const byLen = new Map();
  for (const k of names.keys()) {
    if (!byLen.has(k.length)) byLen.set(k.length, []);
    byLen.get(k.length).push(k);
  }

  const top = games.slice(0, 400).map((g) => g._id);
  const out = {
    byId,
    names,
    words,
    byLen,
    top,
    licenses,
    licenseWords,
    gameLicense,
    prompts,
    byKey,
    byKind,
    logos: new Map(),
    logoModes: new Map(),
  };
  console.log(
    `[bombe] catalogue : ${byId.size} jeux, ${names.size} écritures, ${prompts.length} défis (${Date.now() - t0} ms)`
  );
  fetchLogos(out).catch(() => {});
  return out;
}

// Les logos des studios et des consoles, demandés à IGDB une fois (puis gardés
// en base, cf. lib/entityLogos.js). En tâche de fond : un défi sans logo
// s'affiche en toutes lettres en attendant.
async function fetchLogos(c) {
  for (const kind of ["company", "platform"]) {
    const want = c.prompts.filter(
      (p) => p.logoName && (kind === "company" ? p.kind === "studio" : p.kind === "platform")
    );
    for (let i = 0; i < want.length; i += 40) {
      const chunk = want.slice(i, i + 40);
      // eslint-disable-next-line no-await-in-loop
      const got = await ensureEntityLogos(kind, chunk.map((p) => p.logoName));
      for (const p of chunk) {
        const url = got.get(p.logoName);
        if (!url) continue;
        c.logos.set(p.key, url);
        // eslint-disable-next-line no-await-in-loop
        c.logoModes.set(p.key, await logoMode(url));
      }
    }
  }
}

// Les préfixes qu'on ne tape jamais devant une licence.
const LICENSE_PREFIX = /^(legend of |super |tom clancys |sid meiers |disneys |marvels |lego )/;
// Des mots trop communs pour désigner une licence à eux seuls.
const LICENSE_STOP = new Set(
  (
    "super legend world game games battle dark star stars final dead city night land life story tales quest " +
    "hero heroes king kingdom kingdoms dragon dragons fantasy space racing soccer football sports party adventure " +
    "adventures edition collection chronicles legends origins warriors fighter fighters house time rise blood " +
    "black white shadow shadows wars ball league total grand theft souls simulator tycoon heart hearts magic " +
    "street road last little mega metal ninja crash"
  ).split(" ")
);
// Les sous-titres qui n'en sont pas : des éditions.
const EDITION =
  /^(remastered|remaster|definitive edition|deluxe edition|complete edition|game of the year edition|goty edition|enhanced edition|special edition|anniversary edition|director s cut|directors cut|hd|remake|reloaded|redux|ultimate edition)$/;

// Ce qui suit le premier « : » (ou « - ») d'un titre, s'il ressemble à un vrai
// nom : au moins six lettres, et pas une simple mention d'édition.
function tailOf(name) {
  const m = String(name || "").match(/(?::| - | – | — )\s*(.+)$/);
  if (!m) return null;
  const k = titleKey(m[1]);
  if (k.length < 6 || EDITION.test(k)) return null;
  return k;
}

// Un logo détouré (fond transparent) peut passer en blanc sur la plaque
// sombre ; un logo sur fond plein (Valve : texte noir sur blanc) deviendrait un
// rectangle blanc — celui-là s'affiche tel quel. On regarde les pixels une
// fois, au chargement du catalogue.
async function logoMode(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return "cut";
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .ensureAlpha()
      .resize(64, 64, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let clear = 0;
    const n = info.width * info.height;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 200) clear += 1;
    return clear / n > 0.08 ? "cut" : "box";
  } catch {
    return "cut";
  }
}

// L'indice : la jaquette d'un jeu qui colle (floutée côté client), et dessous
// des lettres — la première et des tirets. Si le jeu porte le nom de sa
// licence, ce sont les lettres de la LICENCE (« Z____ ») : la saga suffit,
// et elle se tape (cf. resolveTitle).
const lettersOf = (name) =>
  String(name)
    .split(/\s+/)
    .map((w, wi) =>
      [...w].map((ch, i) => (wi === 0 && i === 0) || !/[\p{L}\p{N}]/u.test(ch) ? ch : "_").join("")
    )
    .join(" ");

export function hintFor(c, p, used) {
  const ids = p.known.filter((id) => !used.ids.has(id) && c.byId.get(id)?.cover).slice(0, 8);
  if (!ids.length) return null;
  const g = c.byId.get(ids[Math.floor(Math.random() * ids.length)]);
  if (!g) return null;
  // Pour des lettres (« BLA »), le titre du jeu : le nom de sa saga peut ne
  // pas les contenir (Splinter Cell: Blacklist).
  const lic = p.kind === "syllable" ? null : c.gameLicense?.get(g.id);
  return {
    cover: coverUrl(g.cover),
    text: lettersOf(lic ? lic.name : headOf(g.name) || g.name),
    saga: !!lic,
  };
}

function cleanCompany(name) {
  if (!name) return null;
  return String(name)
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/,?\s+(inc|ltd|llc|co|corp|corporation|gmbh|s\.?a|limited|k\.?k)\.?(\s|$)/gi, " ")
    .replace(/,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSyllable(g, syl) {
  return g.key.includes(syl) || (!!g.frKey && g.frKey.includes(syl));
}

// ------------------------------------------------------------ reconnaître
/**
 * Ce que la frappe désigne : { ids, key, typo } ou null.
 * - `ids` : tous les jeux qui portent cette écriture (un remake et son
 *   original partagent souvent le même titre) ;
 * - `typo` : vrai si on a dû corriger une faute.
 */
export function resolveTitle(c, text) {
  const key = titleKey(text);
  if (!key) return null;
  const exact = c.names.get(key);
  const lic = licenseOf(c, key);
  if (exact || lic)
    return {
      ids: [...new Set([...(exact || []), ...(lic?.ids || [])])],
      key,
      typo: false,
      license: lic ? lic.name : null,
      // Les jeux qui portent EXACTEMENT ce titre (« Fire Emblem » est aussi un
      // jeu GBA) : si c'est l'un d'eux qui valide, on affiche le jeu ; sinon,
      // c'est la licence qui a répondu.
      exact: exact || [],
    };
  // Les mots dans le désordre, ou un titre amputé de quelques mots : il faut
  // au moins deux mots, tous présents dans le titre, et la moitié de ses mots.
  const typed = [...new Set(key.split(" "))];
  if (typed.length >= 2) {
    const sets = typed.map((w) => c.words.get(w));
    if (sets.every(Boolean)) {
      sets.sort((a, b) => a.size - b.size);
      const hits = [...sets[0]].filter((k) => {
        if (!sets.every((s) => s.has(k))) return false;
        return typed.length / new Set(k.split(" ")).size >= 0.5;
      });
      if (hits.length) {
        const ids = [...new Set(hits.flatMap((k) => c.names.get(k) || []))];
        if (ids.length) return { ids, key, typo: false };
      }
    }
  }
  // Faute de frappe : rien sous six lettres, sinon tout ressemble à tout
  // (« crain » passait pour « chain »).
  if (key.length < 6) return null;
  const max = key.length < 9 ? 1 : key.length < 14 ? 2 : 3;
  let best = max + 1;
  let hits = [];
  for (let len = key.length - max; len <= key.length + max; len += 1) {
    for (const k of c.byLen.get(len) || []) {
      // La première lettre juste : la faute est rarement là, et ça divise le
      // parcours par vingt.
      if (k[0] !== key[0]) continue;
      const d = distance(key, k, Math.min(max, best));
      if (d < best) {
        best = d;
        hits = [k];
      } else if (d === best && d <= max) hits.push(k);
    }
  }
  if (best > max) return null;
  const ids = [...new Set(hits.flatMap((k) => c.names.get(k) || []))];
  return { ids, key: hits[0], typo: true };
}

// La licence que désigne une frappe : son nom exact (« ace attorney »), ou un
// seul mot assez rare (« zelda », « kirby »). Plusieurs licences pour un même
// mot (« mario » : Mario, Super Mario, Mario Kart…) : on les prend toutes.
function licenseOf(c, key) {
  const full = c.licenses.get(key);
  if (full) return { name: full.name, ids: [...full.ids] };
  if (key.includes(" ")) return null;
  const keys = c.licenseWords.get(key);
  // Le mot est déjà vérifié au chargement (il désigne bien ses licences) :
  // « sonic » en compte une vingtaine, toutes valables.
  if (!keys || keys.size > 30) return null;
  const ids = new Set();
  let name = null;
  for (const k of keys) {
    const l = c.licenses.get(k);
    for (const id of l.ids) ids.add(id);
    if (!name || l.name.length < name.length) name = l.name;
  }
  return { name, ids: [...ids] };
}

/** Ce jeu répond-il au défi ? (`typedKey` : la frappe, pour les syllabes.) */
export function fits(c, prompt, id, typedKey = "") {
  if (!prompt) return false;
  if (prompt.kind === "syllable") {
    const g = c.byId.get(id);
    return !!g && (hasSyllable(g, prompt.syl) || typedKey.includes(prompt.syl));
  }
  return prompt.ids.has(id);
}

/**
 * Juger une réponse. Rend { ok, reason, game } :
 *  - reason « unknown » : aucun jeu ne s'appelle comme ça ;
 *  - reason « used »    : le jeu (ou cette écriture) est déjà sorti ;
 *  - reason « nope »    : le jeu existe mais ne répond pas au défi.
 */
export function judge(c, prompt, text, used) {
  const found = resolveTitle(c, text);
  if (!found) return { ok: false, reason: "unknown" };
  const typedKey = titleKey(text);
  const games = found.ids
    .map((id) => c.byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);
  if (!games.length) return { ok: false, reason: "unknown" };
  const fitting = games.filter((g) => fits(c, prompt, g.id, typedKey));
  // Pour une licence, d'abord les jeux qui en portent le nom (« fire emblem »
  // → un Fire Emblem, pas Smash Bros. qui fait aussi partie de la franchise).
  if (found.license)
    fitting.sort(
      (a, b) =>
        Number(b.key.includes(typedKey)) - Number(a.key.includes(typedKey)) ||
        Number(!!b.cover) - Number(!!a.cover) ||
        a.rank - b.rank
    );
  if (!fitting.length)
    return {
      ok: false,
      reason: "nope",
      // Une licence tapée qui ne colle pas : on le dit de la licence entière
      // (« Aucun Metal Gear ne colle »), pas du premier épisode venu.
      game: found.license ? { name: found.license, license: true } : games[0],
    };
  if (used.keys.has(found.key)) return { ok: false, reason: "used", game: fitting[0] };
  const fresh = fitting.find((g) => !used.ids.has(g.id));
  if (!fresh) return { ok: false, reason: "used", game: fitting[0] };
  // `license` : on a tapé une licence (« fire emblem »), pas un titre — c'est
  // elle qu'on affiche, pas l'épisode qui a servi à valider.
  const viaLicense = !!found.license && !(found.exact || []).includes(fresh.id);
  return { ok: true, game: fresh, key: found.key, typo: found.typo, license: viaLicense ? found.license : null };
}

// --------------------------------------------------------------- tirer
// Combien de réponses connues un défi doit encore offrir, selon la difficulté
// et l'avancée de la partie : ça se resserre au fil des tours, comme les
// syllabes de BombParty qui deviennent plus vicieuses.
const FLOOR = { easy: 60, normal: 25, hard: 9 };
export function threshold(difficulty, turn) {
  const base = FLOOR[difficulty] || FLOOR.normal;
  return Math.max(MIN_KNOWN - 2, Math.round(base * Math.max(0.35, 1 - turn * 0.025)));
}

const remaining = (p, used) => p.known.reduce((n, id) => n + (used.ids.has(id) ? 0 : 1), 0);

// `extra` : des défis propres à la table (« un jeu favori de X »), tirés
// comme les autres — avec leur propre minimum, une liste de favoris est courte.
export function pickPrompt(c, { difficulty = "normal", turn = 0, recent = [], used, extra = [] }) {
  const min = threshold(difficulty, turn);
  const recentSet = new Set(recent);
  const pools = [];
  for (const [kind, list] of c.byKind) {
    const ok = list.filter((p) => !recentSet.has(p.key) && remaining(p, used) >= min);
    if (ok.length) pools.push([kind, ok]);
  }
  const favs = extra.filter((p) => !recentSet.has(p.key) && remaining(p, used) >= 3);
  if (favs.length) pools.push(["fav", favs]);
  if (!pools.length) {
    // Plus rien d'assez riche : on prend le défi le plus fourni qui reste.
    const all = c.prompts.filter((p) => !recentSet.has(p.key));
    all.sort((a, b) => remaining(b, used) - remaining(a, used));
    return all[0] || c.prompts[0];
  }
  const total = pools.reduce((s, [k]) => s + (KIND_WEIGHT[k] || 1), 0);
  let r = Math.random() * total;
  for (const [kind, list] of pools) {
    r -= KIND_WEIGHT[kind] || 1;
    if (r <= 0) return list[Math.floor(Math.random() * list.length)];
  }
  const last = pools[pools.length - 1][1];
  return last[Math.floor(Math.random() * last.length)];
}

/** Ce que le client voit d'un défi. */
export function promptView(c, p) {
  if (!p) return null;
  return {
    key: p.key,
    kind: p.kind,
    label: p.label,
    caption: KIND_CAPTION[p.kind] || "",
    logo: c.logos.get(p.key) || null,
    // « cut » : logo détouré (on le passe en blanc) ; « box » : logo sur son
    // propre fond (on l'affiche tel quel, dans une vignette).
    logoMode: c.logoModes?.get(p.key) || "cut",
    avatar: p.avatar || null,
    count: p.known.length,
  };
}

/** Des réponses qu'il était possible de donner (après l'explosion). */
export function examples(c, p, used, n = 3) {
  const pool = p.known.filter((id) => !used.ids.has(id)).slice(0, 14);
  const out = [];
  while (pool.length && out.length < n) {
    const i = Math.floor(Math.random() * pool.length);
    const g = c.byId.get(pool.splice(i, 1)[0]);
    if (g) out.push({ id: g.id, name: g.name, cover: coverUrl(g.cover), year: g.year });
  }
  return out;
}

/**
 * La réponse d'un bot : un jeu connu, pas encore joué, qu'il « connaît » —
 * c'est-à-dire classé avant `reach` au palmarès des votes. Rend null s'il
 * sèche.
 */
export function botPick(c, p, used, reach) {
  const pool = [];
  for (const id of p.known) {
    if (used.ids.has(id)) continue;
    const g = c.byId.get(id);
    if (!g || g.rank >= reach || used.keys.has(g.key)) continue;
    pool.push(g);
    if (pool.length >= 10) break;
  }
  if (!pool.length) return null;
  // Le haut de la liste revient plus souvent : on pense d'abord aux évidences.
  const i = Math.floor(Math.random() ** 1.6 * pool.length);
  return pool[i];
}

/** Le nom qu'on tape pour ce jeu : le français s'il existe et qu'il est plus court. */
export function typedName(g) {
  if (g.fr && g.fr.length < g.name.length) return g.fr;
  return g.name;
}
