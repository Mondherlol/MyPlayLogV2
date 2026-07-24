import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import Panorama from "../models/Panorama.js";
import { igdbQuery } from "../lib/igdb.js";

// ======================================================================
//  Import du catalogue de lieux de GeoGamer
// ======================================================================
//   npm run import:geo -- [options]
//
// Trois étapes, dans cet ordre :
//   1. LIRE le catalogue source (un module JS qui expose `export const
//      gameData = [...]` — on le lit comme du texte, on ne l'importe pas :
//      voir parseGameData()).
//   2. RAPPROCHER chaque titre d'un jeu IGDB. C'est l'étape qui décide de
//      tout : un lieu sans gameId n'est jamais tiré en partie, et un lieu
//      MAL rapproché produit une manche impossible (la bonne réponse
//      n'étant pas celle attendue). D'où le rapport de fin.
//   3. TÉLÉCHARGER les panoramas, un par un, lentement.
//
// Entièrement REPRENABLE : l'idempotence tient à `sourceKey`. Un fichier
// déjà sur le disque n'est pas re-téléchargé, un lieu déjà en base est mis
// à jour et non dupliqué. On peut donc couper le script à tout moment
// (Ctrl+C) et le relancer : il repart où il en était.
//
// Options :
//   --file <chemin>   catalogue source (défaut : AUTRES/SCRAP_gameguessr/gameData.js)
//   --limit <n>       n'importer que n jeux, tirés au hasard (phase de test)
//   --max-per-game <n>  au plus n lieux par jeu (défaut : tous). Indispensable
//                     en test : un seul jeu du catalogue compte 85 lieux, et
//                     un --limit sur les jeux ne protège pas de ce cas-là.
//   --no-download     n'écrit que les métadonnées, en pointant les URLs distantes
//   --delay <ms>      pause entre deux téléchargements (défaut : 1500)
//   --relink          re-tente le rapprochement des titres restés SANS gameId
//   --relink-all      re-rapproche TOUT ce qui est déjà en base (à lancer après
//                     avoir amélioré searchTerms/scoreCandidate). Les
//                     rapprochements posés à la main (--fix) sont épargnés.
//   --maps            télécharge les CARTES de la manche bonus « où sur la
//                     carte ? » (663 fichiers, ~330 Mo) et relève leurs
//                     dimensions. Séparé de l'import principal : il se lance
//                     après coup sans retoucher aux panoramas.
//   --list-unmatched  écrit la liste des titres non rapprochés dans un fichier
//                     PRÊT À REMPLIR (un « titre = » par ligne, triés par
//                     nombre de lieux : on mappe d'abord ce qui rapporte le
//                     plus de manches). Ne touche à rien d'autre.
//   --fix-file <chemin>  applique un fichier de ce format une fois rempli.
//                     C'est la voie normale pour mapper à la main : les titres
//                     du catalogue source comportent des coquilles qu'aucune
//                     règle ne rattrape (« aragmi 2 » = Aragami 2).
//   --fix "<titre source>=<gameId IGDB>"   force un rapprochement, répétable.
//                     Pour les titres qu'aucune variante ne trouve : IGDB
//                     connaît « T.Rex Game (Dinosaur Game) » sous « Chrome
//                     Dino » (id 133890), rien ne permet de le deviner.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../uploads/panoramas");
const MAP_DIR = path.join(__dirname, "../../uploads/geomaps");
const DEFAULT_SRC = path.join(
  __dirname,
  "../../../AUTRES/SCRAP_gameguessr/gameData.js"
);

const SOURCE = "gameguessr";
const SOURCE_BASE = "https://gameguessr.io";
const IMG = "https://images.igdb.com/igdb/image/upload";

// --- Lecture des options ---
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// Options répétables (--fix peut être passé plusieurs fois d'affilée).
const optAll = (name) =>
  argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const OPTS = {
  file: opt("--file", DEFAULT_SRC),
  limit: Number(opt("--limit", 0)) || 0,
  maxPerGame: Number(opt("--max-per-game", 0)) || 0,
  download: !flag("--no-download"),
  delay: Number(opt("--delay", 1500)),
  relink: flag("--relink"),
  relinkAll: flag("--relink-all"),
  fixes: optAll("--fix"),
  fixFile: opt("--fix-file", ""),
  listUnmatched: flag("--list-unmatched"),
  maps: flag("--maps"),
};

// Fichier de mappage par défaut, à côté du catalogue source.
const UNMATCHED_FILE = path.join(
  __dirname,
  "../../../AUTRES/SCRAP_gameguessr/mappage-manuel.txt"
);

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ======================================================================
//  Résistance aux coupures réseau
// ======================================================================
// Un import complet dure des heures. Sur une connexion domestique, « fetch
// failed » n'est pas une erreur définitive : c'est une micro-coupure, un
// changement de Wi-Fi, un DNS qui bafouille. Sans reprise, chaque hoquet
// transforme un titre parfaitement trouvable en « aucun jeu IGDB trouvé » et
// laisse ses panoramas sur le carreau — un faux négatif qu'on ne distingue
// plus, au rapport final, d'un vrai titre introuvable.

// Erreur réseau (transitoire) plutôt qu'erreur applicative (404, 401…) : seules
// les premières méritent qu'on réessaie.
function isNetworkError(err) {
  const m = String(err?.message || "").toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("econn") ||
    m.includes("enotfound") ||
    m.includes("eai_again") ||
    m.includes("socket")
  );
}

// Compteur d'échecs réseau CONSÉCUTIFS. Au-delà du seuil, ce n'est plus un
// hoquet : la connexion est tombée. On arrête net plutôt que de brûler les
// 300 entrées restantes en les marquant toutes en échec.
let networkStreak = 0;
const NETWORK_GIVE_UP = 10;

class ConnectionLost extends Error {}

function noteNetwork(ok) {
  if (ok) {
    networkStreak = 0;
    return;
  }
  networkStreak += 1;
  if (networkStreak >= NETWORK_GIVE_UP) {
    throw new ConnectionLost(
      `${NETWORK_GIVE_UP} échecs réseau d'affilée — la connexion semble coupée.`
    );
  }
}

// Réessaie avec un recul croissant. Les pauses sont volontairement longues :
// une coupure Wi-Fi met quelques secondes à se rétablir, réessayer trois fois
// en 300 ms ne sert à rien.
const RETRY_WAITS = [2000, 6000, 15000];

async function withRetry(fn, label) {
  let last;
  for (let attempt = 0; attempt <= RETRY_WAITS.length; attempt += 1) {
    try {
      const out = await fn();
      noteNetwork(true);
      return out;
    } catch (err) {
      last = err;
      if (!isNetworkError(err) || attempt === RETRY_WAITS.length) break;
      const wait = RETRY_WAITS[attempt];
      console.log(`      ⟳ ${label} : ${err.message} — nouvelle tentative dans ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  if (isNetworkError(last)) noteNetwork(false); // peut lever ConnectionLost
  throw last;
}

// ======================================================================
//  1. Lire le catalogue source
// ======================================================================
// Le fichier est un module ESM (`export const gameData = [...]`). On ne
// l'`import()` PAS : ce serait exécuter du code tiers dans notre process,
// pour un fichier qui n'est de toute façon qu'un tableau JSON déguisé. On
// enlève l'habillage et on passe par JSON.parse, qui ne peut rien exécuter.
function parseGameData(file) {
  const raw = fs.readFileSync(file, "utf8");
  const json = raw
    .replace(/^﻿/, "")
    .replace(/^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*/, "")
    .replace(/;?\s*$/, "");
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("Le catalogue source n'est pas un tableau.");
  return data;
}

// ======================================================================
//  2. Rapprochement IGDB
// ======================================================================
// Les titres de la source sont approximatifs : « Zelda Breath of the Wild »
// pour « The Legend of Zelda: Breath of the Wild », « Star Wars Jedi Fallen
// Order » sans les deux-points. Une recherche IGDB sur le nom seul renvoie
// donc souvent un DLC, un portage ou un homonyme.
//
// On départage avec ce que la source fournit en plus : l'année de sortie et
// les plateformes. Un candidat qui tombe à l'année pile prend une avance
// décisive — c'est ce qui rend ce rapprochement bien plus fiable que celui
// de l'import PSN, qui n'a que le titre.

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Familles de plateformes : la source écrit « PS5 », « PlayStation 5 »,
// « Switch », « Nintendo Switch »… IGDB a ses propres libellés. On compare
// des familles, pas des chaînes.
const PLATFORM_FAMILY = [
  [/playstation|ps ?[1-5]|psx|vita|psp/, "playstation"],
  [/xbox|x ?box|series ?[xs]|360/, "xbox"],
  [/switch|wii|game ?cube|nintendo|3ds|\bds\b|game ?boy|n64/, "nintendo"],
  [/pc|windows|mac|linux|steam/, "pc"],
  [/android|ios|mobile/, "mobile"],
];
function families(list) {
  const out = new Set();
  for (const p of list || []) {
    const s = norm(p);
    for (const [re, fam] of PLATFORM_FAMILY) if (re.test(s)) out.add(fam);
  }
  return out;
}

// Titres candidats envoyés à IGDB. La source omet souvent le préfixe de
// licence ou la ponctuation : on tente le titre tel quel, puis des variantes
// de plus en plus permissives.
function searchTerms(name) {
  const terms = [name];
  // « Zelda X » → « The Legend of Zelda X » (le cas le plus fréquent, et
  // celui qui échoue systématiquement sans aide).
  if (/^zelda\b/i.test(name)) terms.push(name.replace(/^zelda\b/i, "The Legend of Zelda"));
  if (/^pokemon\b/i.test(name)) terms.push(name.replace(/^pokemon/i, "Pokémon"));

  // Parenthèses : la source y met souvent l'AUTRE nom du jeu, parfois le seul
  // que connaisse IGDB. On tente donc le titre sans la parenthèse ET son
  // contenu seul — « T.Rex Game (Dinosaur Game) » donne les deux pistes.
  const bare = name.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (bare && bare !== name) terms.push(bare);
  const paren = name.match(/\(([^)]+)\)/);
  if (paren?.[1]?.trim()) terms.push(paren[1].trim());

  // Ponctuation collée : « T.Rex » se cherche mieux en « T Rex ». La
  // recherche IGDB est floue mais pas au point de recoller les mots.
  const spaced = name.replace(/[.\-_/]+/g, " ").replace(/\s+/g, " ").trim();
  if (spaced && spaced !== name) terms.push(spaced);

  // Sans le sous-titre : « Star Wars Jedi Fallen Order » → « Star Wars Jedi »
  const words = bare.split(/\s+/);
  if (words.length > 3) terms.push(words.slice(0, 3).join(" "));

  // --- Rattrapage des coquilles de la source ---
  // Ces variantes ne servent que si tout ce qui précède n'a rien donné, mais
  // elles récupèrent une bonne part des « introuvables » : le catalogue est
  // saisi à la main, avec les fautes d'usage que ça implique.

  // Année collée au titre : « Doom 1993 » → « Doom ». L'année n'est pas perdue,
  // elle vient de la source et c'est le scoreur qui s'en sert ensuite pour
  // départager — sans quoi une recherche « Doom » ramène celui de 2016.
  const noYear = bare.replace(/\s+(19|20)\d{2}\s*$/, "").trim();
  if (noYear && noYear !== bare) terms.push(noYear);

  // Espace EN TROP dans un nom accolé : « Arche Age Unchained » →
  // « ArcheAge Unchained », « Flow Scape » → « FlowScape ».
  if (words.length >= 2) terms.push([words[0] + words[1], ...words.slice(2)].join(" "));

  // Espace MANQUANT dans un mot composé : « Farcry 4 » → « Far cry 4 »,
  // « Dragonquest 11 » → « Dragon quest 11 ». On ne sait pas où couper, donc on
  // essaie les points de coupe plausibles du premier mot. C'est le cas le plus
  // coûteux en requêtes, d'où sa place en dernier : matchOnIgdb s'arrête dès
  // qu'un titre exact tombe à la bonne année, et ne descend jusqu'ici que pour
  // les titres réellement en échec.
  const first = words[0] || "";
  if (first.length >= 6 && /^[a-z]+$/i.test(first)) {
    for (let cut = 3; cut <= first.length - 3; cut += 1) {
      terms.push(
        [first.slice(0, cut) + " " + first.slice(cut), ...words.slice(1)].join(" ")
      );
    }
  }

  // Plafond : au-delà, on brûle du quota IGDB pour un gain marginal, et
  // l'utilisateur a de toute façon --fix-file pour le reliquat.
  return [...new Set(terms.filter(Boolean))].slice(0, 9);
}

// Mots de remplissage : leur présence en trop dans le titre IGDB ne veut rien
// dire (« Pokémon White » vs « Pokémon White Version » désignent le même jeu).
const FILLER = new Set([
  "the", "of", "a", "an", "and", "or", "to", "in", "version", "edition",
  "hd", "remastered", "remaster", "deluxe", "complete", "goty", "definitive",
  "game", "collection", "bundle",
]);
// Chiffres romains : « II » en trop trahit une suite au même titre que « 2 ».
const ROMAN_SEQ = new Set(["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);

function scoreCandidate(cand, entry) {
  const target = norm(entry.name);
  const cname = norm(cand.name);
  let score = 0;

  // Proximité du titre.
  if (cname === target) score += 100;
  else if (cname.includes(target) || target.includes(cname)) score += 55;
  else {
    const tw = new Set(target.split(" "));
    const shared = cname.split(" ").filter((w) => tw.has(w)).length;
    score += Math.min(40, shared * 12);
  }

  // Année : le discriminant le plus fort. IGDB donne un timestamp Unix.
  if (entry.year && cand.first_release_date) {
    const y = new Date(cand.first_release_date * 1000).getUTCFullYear();
    const gap = Math.abs(y - entry.year);
    if (gap === 0) score += 45;
    else if (gap === 1) score += 20; // décalage de région / fin d'année
    else if (gap > 4) score -= 25;
  }

  // Plateformes.
  const want = families(entry.platforms);
  if (want.size) {
    const got = families((cand.platforms || []).map((p) => p.name));
    const hits = [...want].filter((f) => got.has(f)).length;
    score += Math.min(25, hits * 10);
    if (hits === 0 && got.size) score -= 15;
  }

  // Jetons présents chez le candidat mais ABSENTS du titre source. C'est le
  // signal qui distingue un jeu de sa suite : « Pokemon White » face à
  // « Pokémon White Version 2 » et « Pokémon White Version », tout le reste
  // (année à ±1, plateforme, notoriété) est rigoureusement à égalité — sans
  // ce critère c'est l'ordre de renvoi d'IGDB qui tranche, donc le hasard.
  const targetWords = new Set(target.split(" "));
  for (const w of cname.split(" ")) {
    if (!w || targetWords.has(w)) continue;
    // Un numéro en trop est presque toujours une suite : lourdement puni.
    if (/^\d+$/.test(w) || ROMAN_SEQ.has(w)) score -= 18;
    else if (!FILLER.has(w)) score -= 4;
  }

  // Un jeu principal plutôt qu'un DLC / bundle / édition (game_type 0 = main).
  if (cand.game_type === 0) score += 12;
  // La notoriété départage deux homonymes plausibles.
  score += Math.min(8, Math.log10((cand.total_rating_count || 0) + 1) * 4);
  return score;
}

async function matchOnIgdb(entry) {
  const seen = new Map();
  for (const term of searchTerms(entry.name)) {
    let rows = [];
    try {
      rows = await withRetry(
        () =>
          igdbQuery(
            "games",
            `search "${term.replace(/"/g, "")}";` +
              " fields name,cover.image_id,first_release_date,platforms.name,game_type,total_rating_count;" +
              " where version_parent = null;" +
              " limit 20;"
          ),
        `IGDB "${term}"`
      );
    } catch (err) {
      if (err instanceof ConnectionLost) throw err;
      console.error(`   ! IGDB "${term}" : ${err.message}`);
      await sleep(500);
      continue;
    }
    for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
    await sleep(260); // IGDB plafonne à 4 requêtes/seconde
    // Un titre exact à la bonne année : inutile d'essayer les variantes.
    if ([...seen.values()].some((c) => scoreCandidate(c, entry) >= 140)) break;
  }
  if (!seen.size) return null;

  const ranked = [...seen.values()]
    .map((c) => ({ c, s: scoreCandidate(c, entry) }))
    .sort((a, b) => b.s - a.s);
  const best = ranked[0];
  const runnerUp = ranked[1];

  return {
    gameId: best.c.id,
    gameName: best.c.name,
    cover: best.c.cover?.image_id ? `${IMG}/t_cover_big/${best.c.cover.image_id}.jpg` : null,
    score: best.s,
    // Un écart faible avec le second signale un choix douteux : c'est ce qui
    // alimente la liste « à vérifier » du rapport final.
    margin: runnerUp ? best.s - runnerUp.s : 999,
    runnerUp: runnerUp?.c.name || null,
  };
}

// ======================================================================
//  3. Téléchargement des panoramas
// ======================================================================
// Un fichier pèse 0,6 à 3,3 Mo et le serveur source est lent : on y va un
// par un, avec une pause entre chaque. Ce n'est pas de la prudence
// excessive, c'est la seule façon d'aspirer ~1,8 Go sans matraquer une
// machine qui ne nous a rien demandé.
async function downloadTo(url, dest, label) {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Referer: SOURCE_BASE + "/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error("fichier suspect (trop petit)");
    // Écriture atomique : un Ctrl+C au mauvais moment laisserait sinon un
    // fichier tronqué que la reprise prendrait pour un téléchargement réussi.
    const tmp = `${dest}.part`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, dest);
    return buf.length;
  }, label);
}

// Les 64 premiers octets d'un fichier, sans le charger en entier. À la reprise
// on repasse sur des centaines de fichiers déjà présents juste pour relire leur
// en-tête : lire 1,5 Go de disque pour en exploiter 40 Ko serait absurde.
async function readHead(file, n = 64) {
  const fh = await fsp.open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

// Dimensions d'une image, lues dans l'en-tête (pas de décodage, pas de
// dépendance). Sert à deux choses : repérer les panoramas qui ne sont PAS en
// 2:1 (ils s'afficheront déformés), et mesurer les cartes — indispensable
// puisqu'une distance en pixels ne veut rien dire sans la taille de la carte.
//
// Multi-format volontairement : chez la source, l'EXTENSION MENT. Des fichiers
// en .webp sont en réalité des PNG (la carte de Zelda BotW, 7,75 Mo). Le
// navigateur s'en sort en reniflant le contenu, pas un parseur naïf.
//
// NB : le cas JPEG exige le buffer complet (il faut parcourir les segments) ;
// les autres se contentent des premiers octets.
function imageSize(buf) {
  try {
    // PNG : signature 8 octets, puis IHDR (largeur/hauteur en big-endian).
    if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // GIF : « GIF87a » / « GIF89a », dimensions en little-endian.
    if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF") {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    // WebP : conteneur RIFF, trois variantes de bloc.
    if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF") {
      const fourcc = buf.toString("ascii", 12, 16);
      if (fourcc === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
      if (fourcc === "VP8 ")
        return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fourcc === "VP8L") {
        const v = buf.readUInt32LE(21);
        return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    // JPEG : on saute de segment en segment jusqu'à un marqueur SOF.
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        // SOF0..SOF15, en excluant DHT (C4), JPG (C8) et DAC (CC).
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* en-tête illisible : on s'en passe */
  }
  return null;
}

// ======================================================================
//  Programme principal
// ======================================================================
async function run() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog");
  console.log("✅ Connecté à MongoDB\n");

  // --- Modes utilitaires : prioritaires, et rien d'autre ne tourne ---
  if (OPTS.maps) {
    await importMaps();
    await mongoose.disconnect();
    return;
  }
  if (OPTS.listUnmatched) {
    await listUnmatched();
    await mongoose.disconnect();
    return;
  }
  if (OPTS.fixFile) {
    await applyFixFile(OPTS.fixFile);
    await mongoose.disconnect();
    return;
  }
  if (OPTS.fixes.length) {
    await applyFixes(OPTS.fixes);
    await mongoose.disconnect();
    return;
  }

  // --- Mode « rattrapage » : on ne touche qu'au rapprochement IGDB ---
  if (OPTS.relink || OPTS.relinkAll) {
    await relinkOnly();
    await mongoose.disconnect();
    return;
  }

  if (!fs.existsSync(OPTS.file)) {
    console.error(`❌ Catalogue source introuvable : ${OPTS.file}`);
    console.error("   Récupère-le puis relance, ou passe --file <chemin>.");
    process.exit(1);
  }
  let games = parseGameData(OPTS.file);
  console.log(`📖 ${games.length} jeux dans le catalogue source.`);
  if (OPTS.limit) {
    // Échantillon ALÉATOIRE et non les n premiers : le fichier est trié par
    // ordre alphabétique, prendre la tête donnerait un catalogue de test
    // entièrement bloqué dans les A.
    games = games.sort(() => Math.random() - 0.5).slice(0, OPTS.limit);
    console.log(`   → limité à ${games.length} jeux (échantillon aléatoire).`);
  }
  if (OPTS.download) await fsp.mkdir(OUT_DIR, { recursive: true });

  const report = { matched: 0, unmatched: [], doubtful: [], places: 0, skipped: 0, bytes: 0 };

  // Coupure réseau franche : on sort de la boucle mais on imprime QUAND MÊME le
  // rapport de ce qui a été acquis, et on le dit clairement. Une pile
  // d'exception ne dirait pas à l'utilisateur où il en est.
  let lost = null;
  try {
  for (const [i, entry] of games.entries()) {
    // On garde les lieux les plus FACILES en priorité quand on plafonne :
    // pour un premier essai, mieux vaut des décors reconnaissables que les
    // recoins obscurs qui font douter de la qualité du rapprochement IGDB.
    let shots = entry.screenshots || [];
    if (OPTS.maxPerGame && shots.length > OPTS.maxPerGame) {
      shots = [...shots]
        .sort((a, b) => (Number(a.difficulty) || 3) - (Number(b.difficulty) || 3))
        .slice(0, OPTS.maxPerGame);
    }
    if (!shots.length) continue;
    const head = `[${i + 1}/${games.length}] ${entry.name}`;

    // --- Rapprochement (une fois par JEU, pas par lieu) ---
    // On regarde d'abord si un lieu de ce jeu est déjà en base : le titre est
    // alors déjà rapproché, inutile de re-solliciter IGDB.
    const known = await Panorama.findOne({
      source: SOURCE,
      sourceName: entry.name,
      gameId: { $ne: null },
    })
      .select("gameId gameName cover")
      .lean();

    let match = known
      ? { gameId: known.gameId, gameName: known.gameName, cover: known.cover, margin: 999 }
      : await matchOnIgdb(entry);

    if (!match) {
      console.log(`${head} → ❓ aucun jeu IGDB trouvé`);
      report.unmatched.push(entry.name);
    } else {
      if (!known) {
        console.log(`${head} → ✔ ${match.gameName} (${match.gameId})`);
        report.matched += 1;
        if (match.margin < 15) {
          report.doubtful.push(
            `${entry.name} → ${match.gameName}  (second : ${match.runnerUp})`
          );
        }
      }
    }

    // --- Les lieux de ce jeu ---
    for (const [n, shot] of shots.entries()) {
      const rel = String(shot.file || "").replace(/^\//, "");
      if (!rel) continue;
      const sourceKey = `${SOURCE}:${rel}`;
      // Nom de fichier plat et sans collision : le chemin d'origine sert d'id.
      const fileName = rel.replace(/^public\/games\//, "").replace(/[\/\\]/g, "__");
      const dest = path.join(OUT_DIR, fileName);

      let image = `${SOURCE_BASE}/${rel}`;
      let bytes = null;
      let dims = null;

      if (OPTS.download) {
        if (fs.existsSync(dest)) {
          bytes = (await fsp.stat(dest)).size;
          dims = imageSize(await readHead(dest));
          report.skipped += 1;
        } else {
          try {
            bytes = await downloadTo(`${SOURCE_BASE}/${rel}`, dest, fileName);
            dims = imageSize(await readHead(dest));
            report.bytes += bytes;
            const ratio = dims ? (dims.w / dims.h).toFixed(2) : "?";
            console.log(
              `      ↓ ${fileName} — ${(bytes / 1048576).toFixed(2)} Mo` +
                (dims ? ` — ${dims.w}×${dims.h} (ratio ${ratio})` : "")
            );
            if (dims && Math.abs(dims.w / dims.h - 2) > 0.15) {
              console.log(
                `        ⚠ ratio ${ratio} au lieu de 2:1 — ce lieu s'affichera déformé.`
              );
            }
            await sleep(OPTS.delay);
          } catch (err) {
            // Connexion franchement tombée : on remonte, inutile de défiler les
            // 300 entrées restantes en les marquant toutes en échec.
            if (err instanceof ConnectionLost) throw err;
            console.log(`      ✗ ${fileName} : ${err.message}`);
            continue; // pas d'image = pas de lieu en base
          }
        }
        image = `/uploads/panoramas/${fileName}`;
      }

      await Panorama.updateOne(
        { sourceKey },
        {
          $set: {
            gameId: match?.gameId ?? null,
            gameName: match?.gameName || entry.name,
            cover: match?.cover || null,
            image,
            width: dims?.w ?? null,
            height: dims?.h ?? null,
            bytes,
            difficulty: Math.min(Math.max(Number(shot.difficulty) || 3, 1), 5),
            source: SOURCE,
            sourceName: entry.name,
            year: entry.year || null,
            platforms: entry.platforms || [],
            mapImage: shot.map ? `${SOURCE_BASE}${shot.map}` : null,
            mapCoords: shot.coords || "",
          },
          // `active` n'est posé qu'à la création : si tu as désactivé un lieu à
          // la main, un ré-import ne doit pas le réactiver dans ton dos.
          $setOnInsert: { active: true },
        },
        { upsert: true }
      );
      report.places += 1;
      if (n === shots.length - 1 && !OPTS.download) await sleep(50);
    }
  }
  } catch (err) {
    if (!(err instanceof ConnectionLost)) throw err;
    lost = err;
  }

  // --- Rapport ---
  const total = await Panorama.countDocuments({ active: true, gameId: { $ne: null } });
  console.log("\n" + "═".repeat(58));
  if (lost) {
    console.log(`🔌 IMPORT INTERROMPU — ${lost.message}`);
    console.log("   Rien n'est perdu : relance la MÊME commande quand la");
    console.log("   connexion est revenue, elle reprendra où elle s'est arrêtée.");
    console.log("─".repeat(58));
  }
  console.log(`📍 ${report.places} lieux traités — ${report.matched} jeux rapprochés`);
  if (OPTS.download) {
    console.log(
      `💾 ${(report.bytes / 1048576).toFixed(1)} Mo téléchargés` +
        (report.skipped ? ` (${report.skipped} déjà présents, ignorés)` : "")
    );
  }
  console.log(`🎮 Catalogue jouable : ${total} lieux`);

  if (report.doubtful.length) {
    console.log(`\n⚠️  ${report.doubtful.length} rapprochements SERRÉS, à vérifier :`);
    for (const d of report.doubtful) console.log(`   · ${d}`);
  }
  if (report.unmatched.length) {
    console.log(`\n❓ ${report.unmatched.length} titres sans jeu IGDB (lieux inactifs) :`);
    for (const u of report.unmatched) console.log(`   · ${u}`);
    console.log("   → corrige le gameId à la main en base, ou relance avec --relink.");
  }
  console.log("═".repeat(58));

  await mongoose.disconnect();
  console.log(
    lost
      ? "\n⏸️  Reprends avec la même commande dès que le réseau est stable."
      : "\n🌍 GeoGamer est prêt. File sur /geo."
  );
}

// Force un rapprochement décidé par un humain. On va quand même chercher le
// jeu sur IGDB : c'est ce qui donne le nom canonique et la jaquette, et ça
// vérifie au passage que l'id existe vraiment (une coquille passerait sinon
// inaperçue jusqu'à ce qu'une manche affiche un jeu vide).
// Dimensions d'un fichier sur disque. On lit le buffer COMPLET (un JPEG oblige
// à parcourir ses segments) et, si le format n'est pas de ceux qu'on sait
// parser, on demande à ffmpeg — qui est déjà une dépendance du serveur, donc
// ça ne coûte rien. Ce repli n'est pas théorique : la carte de Valorant est un
// AVIF déguisé en .webp.
let ffmpegBin = null;
async function probeSize(file) {
  const direct = imageSize(await fsp.readFile(file));
  if (direct) return direct;
  try {
    if (!ffmpegBin) ffmpegBin = (await import("ffmpeg-static")).default;
    // ffmpeg sans fichier de sortie sort TOUJOURS en erreur après avoir décrit
    // l'entrée : c'est donc dans le `catch` qu'on lit ce qui nous intéresse.
    await execFileAsync(ffmpegBin, ["-hide_banner", "-i", file]);
  } catch (err) {
    const m = /,\s(\d{2,6})x(\d{2,6})[\s,]/.exec(String(err?.stderr || ""));
    if (m) return { w: Number(m[1]), h: Number(m[2]) };
  }
  return null;
}

// ======================================================================
//  Cartes de la manche bonus « où sur la carte ? »
// ======================================================================

// Côté source, les cartes sont affichées dans un Leaflet en CRS.Simple dont
// les bornes sont codées en dur :
//
//     let i = l.mapWidth || 2100,
//         a = [[0, 0], [l.mapHeight || 2100, i]];
//     L.imageOverlay(l.map, a)
//
// Leur catalogue ne fournit JAMAIS mapWidth/mapHeight (vérifié sur les 712
// entrées), donc le repère est toujours ce carré de 2100×2100 — sans aucun
// rapport avec la taille du fichier de carte. Les 712 coordonnées y tiennent
// toutes, aucune ne dépasse.
const MAP_FRAME = 2100;

// Convertit « latitude;longitude » en fractions [0,1] depuis le coin HAUT
// GAUCHE. Deux pièges cumulés :
//   • l'ordre est lat (vertical) PUIS lng (horizontal), pas x;y ;
//   • en CRS.Simple la latitude croît vers le HAUT, d'où l'inversion en Y.
function normalizeCoords(raw) {
  const [lat, lng] = String(raw || "").split(";").map((v) => parseFloat(v));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const x = lng / MAP_FRAME;
  const y = 1 - lat / MAP_FRAME;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

// Recalcule le point normalisé de tous les lieux cartographiés. Séparé du
// téléchargement : c'est du pur calcul, rejouable sans toucher au réseau.
async function normalizeMapAnswers() {
  const docs = await Panorama.find({ mapCoords: { $nin: ["", null] } })
    .select("mapCoords")
    .lean();
  let ok = 0;
  let ko = 0;
  const ops = [];
  for (const d of docs) {
    const p = normalizeCoords(d.mapCoords);
    if (!p) {
      ko += 1;
      continue;
    }
    ops.push({
      updateOne: { filter: { _id: d._id }, update: { $set: { mapAnswerX: p.x, mapAnswerY: p.y } } },
    });
    ok += 1;
  }
  for (let i = 0; i < ops.length; i += 500) await Panorama.bulkWrite(ops.slice(i, i + 500));
  console.log(`📐 Points de réponse normalisés : ${ok}` + (ko ? ` (${ko} illisibles)` : ""));
}

// 712 lieux savent aussi OÙ ils se situent sur une carte du jeu, et la source
// livre le point de réponse en pixels bruts. On rapatrie donc les cartes, et
// surtout on relève leurs DIMENSIONS : sans elles une distance en pixels ne
// veut rien dire (les cartes vont de 928×928 à 2402×1914).
//
// On ne redimensionne SURTOUT PAS les cartes : le point de réponse est exprimé
// dans le repère de l'image d'origine, le réduire invaliderait toutes les
// coordonnées déjà en base.
//
// Beaucoup de lieux partagent la même carte (663 fichiers pour 712 lieux), d'où
// le parcours par URL distincte plutôt que par lieu.
async function importMaps() {
  await normalizeMapAnswers();
  await fsp.mkdir(MAP_DIR, { recursive: true });
  const remotes = await Panorama.distinct("mapImage", {
    mapImage: { $regex: "^https?://" },
    mapCoords: { $nin: ["", null] },
  });
  console.log(`🗺️  ${remotes.length} cartes à rapatrier.\n`);

  let done = 0;
  let skipped = 0;
  let bytes = 0;
  const failed = [];

  for (const [i, url] of remotes.entries()) {
    const rel = url.replace(`${SOURCE_BASE}/`, "");
    const fileName = rel.replace(/^public\/games\//, "").replace(/[/\\]/g, "__");
    const dest = path.join(MAP_DIR, fileName);
    const head = `[${i + 1}/${remotes.length}] ${fileName}`;

    try {
      if (fs.existsSync(dest)) {
        skipped += 1;
      } else {
        const n = await downloadTo(url, dest, fileName);
        bytes += n;
        await sleep(Math.min(OPTS.delay, 800)); // les cartes sont légères
      }
      const dims = await probeSize(dest);
      if (!dims) {
        failed.push(`${fileName} (dimensions illisibles)`);
        continue;
      }
      const res = await Panorama.updateMany(
        { mapImage: url },
        {
          $set: {
            mapImage: `/uploads/geomaps/${fileName}`,
            mapWidth: dims.w,
            mapHeight: dims.h,
          },
        }
      );
      done += 1;
      console.log(`${head} — ${dims.w}×${dims.h}, ${res.modifiedCount} lieu(x)`);
    } catch (err) {
      if (err instanceof ConnectionLost) throw err;
      console.log(`${head} ✗ ${err.message}`);
      failed.push(`${fileName} (${err.message})`);
    }
  }

  const jouables = await Panorama.countDocuments({
    active: true,
    gameId: { $ne: null },
    mapWidth: { $ne: null },
    mapAnswerX: { $ne: null },
  });
  console.log("\n" + "═".repeat(58));
  console.log(
    `🗺️  ${done} cartes prêtes` +
      (skipped ? ` (${skipped} déjà présentes)` : "") +
      ` — ${(bytes / 1048576).toFixed(1)} Mo téléchargés`
  );
  console.log(`🎯 Lieux avec manche carte : ${jouables}`);
  if (failed.length) {
    console.log(`\n⚠️  ${failed.length} en échec :`);
    for (const f of failed.slice(0, 20)) console.log(`   · ${f}`);
  }
  console.log("═".repeat(58));
}

// ======================================================================
//  Mappage manuel en lot
// ======================================================================
// Certains titres du catalogue source ne sont trouvables sous aucune variante
// automatique : « aragmi 2 » est Aragami 2, « T.Rex Game (Dinosaur Game) » est
// Chrome Dino. Aucune règle ne devine ça — il faut un humain. Autant lui donner
// un fichier à remplir plutôt que 200 commandes à taper.

// Écrit la liste des titres à mapper, triés par nombre de lieux DÉCROISSANT :
// mapper un titre qui porte 24 panoramas rapporte 24 manches, un titre qui en
// porte un seul n'en rapporte qu'une. On commence par ce qui compte.
async function listUnmatched() {
  const rows = await Panorama.aggregate([
    { $match: { gameId: null } },
    { $group: { _id: "$sourceName", places: { $sum: 1 } } },
    { $sort: { places: -1, _id: 1 } },
  ]);
  if (!rows.length) {
    console.log("✅ Aucun titre à mapper : tout le catalogue est rapproché.");
    return;
  }
  const total = rows.reduce((a, r) => a + r.places, 0);
  const lines = [
    "# Mappage manuel des titres que le rapprochement automatique n'a pas su",
    "# identifier. Complète l'id IGDB après le « = », puis applique avec :",
    "#",
    "#   npm run import:geo -- --fix-file ../AUTRES/SCRAP_gameguessr/mappage-manuel.txt",
    "#",
    "# L'id se trouve dans l'URL d'une fiche IGDB, ou via la recherche du site.",
    "# Les lignes laissées vides et les lignes « # » sont ignorées : tu peux",
    "# remplir en plusieurs fois et relancer autant de fois que nécessaire.",
    `# ${rows.length} titres · ${total} lieux en attente.`,
    "",
  ];
  for (const r of rows) {
    lines.push(`# ${r.places} lieu${r.places > 1 ? "x" : ""}`);
    lines.push(`${r._id} = `);
  }
  await fsp.mkdir(path.dirname(UNMATCHED_FILE), { recursive: true });
  await fsp.writeFile(UNMATCHED_FILE, lines.join("\n") + "\n", "utf8");
  console.log(`📝 ${rows.length} titres (${total} lieux) à mapper.`);
  console.log(`   → ${UNMATCHED_FILE}`);
  console.log("\n   Les 12 plus rentables :");
  for (const r of rows.slice(0, 12)) {
    const unit = `lieu${r.places > 1 ? "x" : ""}`;
    console.log(`   · ${String(r.places).padStart(3)} ${unit.padEnd(5)} — ${r._id}`);
  }
}

// Applique un fichier de mappage. Tolérant : les commentaires, les lignes
// vides et les entrées sans id sont ignorés, donc on peut remplir le fichier
// progressivement et le relancer sans rien casser.
async function applyFixFile(file) {
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error(`❌ Fichier de mappage introuvable : ${abs}`);
    console.error("   Génère-le d'abord avec --list-unmatched.");
    process.exit(1);
  }
  const pairs = [];
  let blank = 0;
  for (const raw of (await fsp.readFile(abs, "utf8")).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.lastIndexOf("=");
    if (cut < 1) continue;
    const id = line.slice(cut + 1).trim();
    if (!id) {
      blank += 1; // pas encore rempli, ce n'est pas une erreur
      continue;
    }
    pairs.push(`${line.slice(0, cut).trim()}=${id}`);
  }
  console.log(
    `📄 ${pairs.length} mappage(s) à appliquer` +
      (blank ? ` (${blank} ligne(s) encore vide(s), ignorées).` : ".")
  );
  if (!pairs.length) return;
  await applyFixes(pairs);
}

async function applyFixes(entries) {
  for (const raw of entries) {
    const cut = raw.lastIndexOf("=");
    if (cut < 1) {
      console.log(`✗ "${raw}" — attendu : --fix "Titre source=123456"`);
      continue;
    }
    const name = raw.slice(0, cut).trim();
    const gameId = Number(raw.slice(cut + 1).trim());
    if (!Number.isInteger(gameId) || gameId <= 0) {
      console.log(`✗ "${raw}" — l'id IGDB doit être un entier.`);
      continue;
    }
    const known = await Panorama.countDocuments({ sourceName: name });
    if (!known) {
      console.log(`✗ "${name}" — aucun lieu de ce titre en base (vérifie l'orthographe exacte).`);
      continue;
    }
    let game = null;
    try {
      const rows = await igdbQuery(
        "games",
        `fields name,cover.image_id; where id = ${gameId}; limit 1;`
      );
      game = rows?.[0] || null;
    } catch (err) {
      console.log(`✗ "${name}" — IGDB injoignable : ${err.message}`);
      continue;
    }
    if (!game) {
      console.log(`✗ "${name}" — aucun jeu IGDB avec l'id ${gameId}.`);
      continue;
    }
    const res = await Panorama.updateMany(
      { sourceName: name },
      {
        $set: {
          gameId: game.id,
          gameName: game.name,
          cover: game.cover?.image_id
            ? `${IMG}/t_cover_big/${game.cover.image_id}.jpg`
            : null,
          manualMatch: true,
        },
      }
    );
    console.log(`✔ ${name} → ${game.name} (${game.id}) — ${res.modifiedCount} lieu(x) mis à jour`);
    await sleep(300);
  }
  const total = await Panorama.countDocuments({ active: true, gameId: { $ne: null } });
  console.log(`\n🎮 Catalogue jouable : ${total} lieux`);
}

// Repasse le rapprochement sans rien retélécharger.
//   --relink      → seulement les titres restés sans gameId
//   --relink-all  → tout, SAUF ce qui a été corrigé à la main : un
//                   rapprochement humain ne doit jamais être défait par une
//                   heuristique, même améliorée.
async function relinkOnly() {
  const filter = OPTS.relinkAll ? { manualMatch: { $ne: true } } : { gameId: null };
  const names = await Panorama.distinct("sourceName", filter);
  console.log(
    `🔁 ${names.length} titres à re-rapprocher` +
      (OPTS.relinkAll ? " (tout, hors corrections manuelles).\n" : " (sans gameId).\n")
  );
  let ok = 0;
  let changed = 0;
  let lost = null;
  for (const [i, name] of names.entries()) {
    const one = await Panorama.findOne({ sourceName: name })
      .select("year platforms gameId gameName")
      .lean();
    let match;
    try {
      match = await matchOnIgdb({
        name,
        year: one?.year || null,
        platforms: one?.platforms || [],
      });
    } catch (err) {
      // Même règle que l'import : on s'arrête net plutôt que de marquer en
      // échec des titres qu'on n'a simplement pas pu interroger.
      if (!(err instanceof ConnectionLost)) throw err;
      lost = err;
      break;
    }
    if (!match) {
      console.log(`[${i + 1}/${names.length}] ${name} → ❓ toujours rien`);
      continue;
    }
    const before = one?.gameId ?? null;
    await Panorama.updateMany(
      { sourceName: name, manualMatch: { $ne: true } },
      { $set: { gameId: match.gameId, gameName: match.gameName, cover: match.cover } }
    );
    ok += 1;
    // On signale les CHANGEMENTS d'avis à part : c'est la seule ligne qu'on
    // relit vraiment quand on repasse sur 470 titres.
    if (before && before !== match.gameId) {
      changed += 1;
      console.log(
        `[${i + 1}/${names.length}] ${name} → ⇄ ${one.gameName} (${before}) ` +
          `devient ${match.gameName} (${match.gameId})`
      );
    } else {
      console.log(`[${i + 1}/${names.length}] ${name} → ✔ ${match.gameName} (${match.gameId})`);
    }
  }
  if (lost) {
    console.log(`\n🔌 INTERROMPU — ${lost.message}`);
    console.log("   Relance --relink quand la connexion est revenue.");
  }
  console.log(
    `\n✅ ${ok}/${names.length} titres rapprochés` + (changed ? `, dont ${changed} corrigés.` : ".")
  );
}

run().catch((err) => {
  console.error("❌ Import GeoGamer échoué:", err);
  process.exit(1);
});
