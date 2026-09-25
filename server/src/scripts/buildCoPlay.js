import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import GameFeatures from "../models/GameFeatures.js";
import { igdbQuery } from "../lib/igdb.js";
import { calibrate, computeCoPlay, mergeNeighbors } from "../lib/coPlay.js";
import { normName } from "../lib/recoEngine.js";

// ======================================================================
//  « Ceux qui ont aimé X ont aussi aimé Y » — construit sur ton PC
// ======================================================================
//   npm run build:coplay [-- --data=C:\chemin] [-- --only=amazon,steam]
//
// À lancer à la main, sur ton PC, de temps en temps (tous les quelques mois :
// ces jeux de données ne bougent pas). Il lit des millions d'avis publics, en
// tire les voisins de chaque jeu, et écrit server/src/data/coplay.json.gz —
// quelques Mo, livrés avec le serveur, que celui-ci importe tout seul au
// démarrage (cf. lib/recoCoPlay.js). Rien ne tourne en prod.
//
// Il a besoin du catalogue local (GameFeatures) : lance d'abord la synchro du
// catalogue sur ta base locale.
//
// ------------------------------------------------ les sources (--data)
// Dans le dossier de données (par défaut ~/myplaylog-data/reco, HORS OneDrive :
// 3 Go qu'on ne veut pas voir synchronisés) :
//
//   • Amazon Reviews'23, catégorie Video_Games (McAuley Lab, UCSD) — 4,6 M avis,
//     TOUTES LES CONSOLES : Switch, DS, GBA, NES, PS2… C'est la source qui
//     couvre ce que Steam ne voit pas.
//       Video_Games.jsonl        (2,7 Go)
//       meta_Video_Games.jsonl   (437 Mo)
//       https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023
//       (raw/review_categories/ et raw/meta_categories/)
//
//   • Steam, bibliothèques de 88 000 joueurs avec leur temps de jeu (UCSD).
//       australian_users_items.json.gz   (74 Mo)
//       https://huggingface.co/datasets/recommender-system/steam-review-and-bundle-dataset
//
//   • Facultatif — Steam, 41 M recommandations (Kaggle, demande un compte) :
//       recommendations.csv
//       https://www.kaggle.com/datasets/antonkozyriev/game-recommendations-on-steam
//
// Une source absente est simplement sautée.
//
// ------------------------------------------------ ce qu'on garde
// Uniquement des LIENS entre jeux et leur force — ni avis, ni pseudo, ni
// identifiant de joueur ne quittent ce script.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");
const DATA = arg("data") || process.env.RECO_DATA || path.join(os.homedir(), "myplaylog-data", "reco");
const OUT = arg("out") || path.join(__dirname, "../data/coplay.json.gz");
const ONLY = (arg("only") || "amazon,steam,kaggle").split(",");
const DEBUG = argv.includes("--debug");
const INSPECT = (arg("inspect") || "").split(",").filter(Boolean).map(Number);

const log = (...a) => console.log(`[${new Date().toLocaleTimeString("fr-FR")}]`, ...a);
const file = (name) => path.join(DATA, name);
const has = (name) => fs.existsSync(file(name));

// ----------------------------------------------------------------------
//  Des couples (joueur, jeu, force) qui grandissent sans copie à chaque ajout
// ----------------------------------------------------------------------
class Pairs {
  constructor() {
    this.n = 0;
    this.u = new Int32Array(1 << 20);
    this.i = new Int32Array(1 << 20);
    this.s = new Float32Array(1 << 20);
  }
  push(u, i, s) {
    if (this.n === this.u.length) {
      const grow = (A) => {
        const B = new A.constructor(A.length * 2);
        B.set(A);
        return B;
      };
      this.u = grow(this.u);
      this.i = grow(this.i);
      this.s = grow(this.s);
    }
    this.u[this.n] = u;
    this.i[this.n] = i;
    this.s[this.n] = s;
    this.n++;
  }
  view() {
    return { u: this.u.subarray(0, this.n), i: this.i.subarray(0, this.n), s: this.s.subarray(0, this.n) };
  }
}

// Un pseudo → un entier. 32 bits pour 3 M de joueurs : quelques centaines de
// collisions au pire, deux inconnus fondus en un — sans effet mesurable sur des
// similarités calculées sur des milliers de joueurs.
function hash32(str) {
  let h = 2166136261;
  for (let k = 0; k < str.length; k++) {
    h ^= str.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

async function* lines(name, gz = false) {
  let stream = fs.createReadStream(file(name));
  if (gz) stream = stream.pipe(zlib.createGunzip());
  yield* readline.createInterface({ input: stream, crlfDelay: Infinity });
}

// ----------------------------------------------------------------------
//  Le catalogue : de quoi rattacher un produit à sa fiche IGDB
// ----------------------------------------------------------------------
async function loadCatalogue() {
  const rows = await GameFeatures.find({})
    .select("name fr steam platforms pool ratingCount")
    .lean();
  const ids = rows.map((r) => r._id);
  const byId = new Map(ids.map((id, k) => [id, k]));
  const bySteam = new Map();
  const byName = new Map(); // nom nu -> [k]
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r.steam) bySteam.set(r.steam, k);
    for (const n of new Set([normName(r.name), r.fr ? normName(r.fr) : null])) {
      if (!n) continue;
      let list = byName.get(n);
      if (!list) byName.set(n, (list = []));
      list.push(k);
    }
  }
  log(`catalogue : ${rows.length} jeux, ${bySteam.size} appids Steam`);
  return { rows, ids, byId, bySteam, byName };
}

// ----------------------------------------------------------------------
//  Amazon
// ----------------------------------------------------------------------
// Les rayons Amazon → plateformes IGDB.
const AMAZON_PLATFORMS = [
  [/^PC$/, [6]],
  [/^Mac$/, [14]],
  [/^PlayStation 5$/, [167]],
  [/^PlayStation 4$/, [48]],
  [/PlayStation 3$/, [9]],
  [/PlayStation 2$/, [8]],
  [/PlayStation Systems > PlayStation$/, [7]],
  [/Sony PSP$/, [38]],
  [/PlayStation Vita$/, [46]],
  [/^Xbox Series X & S$/, [169]],
  [/^Xbox One$/, [49]],
  [/Xbox 360$/, [12]],
  [/Xbox Systems > Xbox$/, [11]],
  [/^Nintendo Switch$/, [130, 508]],
  [/Wii U$/, [41]],
  [/Nintendo Systems > Wii$/, [5]],
  [/GameCube$/, [21]],
  [/Nintendo 64$/, [4]],
  [/Super Nintendo$/, [19]],
  [/Nintendo NES$/, [18]],
  [/Nintendo 3DS & 2DS$/, [37, 137]],
  [/Nintendo DS$/, [20, 159]],
  [/Game Boy Advance$/, [24]],
  [/Game Boy Color$/, [22, 33]],
  [/Game Boy Systems > Game Boy$/, [33, 22]],
  [/Sega Genesis$/, [29]],
  [/Sega Saturn$/, [32]],
  [/Sega Dreamcast$/, [23]],
  [/Sega Game Gear$/, [35]],
  [/Sega Master System$/, [64]],
  [/Sega CD$/, [78]],
  [/TurboGrafx 16$/, [86]],
  [/Atari 2600$/, [59]],
  [/Atari 7800$/, [60]],
  [/Atari Lynx$/, [61]],
  [/Atari Jaguar$/, [62]],
  [/NEOGEO Pocket$/, [119, 120]],
  [/3DO$/, [50]],
];

// Quand le rayon manque (Amazon laisse les catégories vides sur certaines de
// ses plus grosses fiches : « Persona 5: The Royal », 2 288 avis), la
// plateforme se lit dans le titre. Du plus précis au moins précis.
const TITLE_PLATFORMS = [
  [/nintendo switch|\bswitch\b|\bnsw\b/i, [130, 508]],
  [/playstation 5|\bps5\b/i, [167]],
  [/playstation 4|\bps4\b/i, [48]],
  [/playstation 3|\bps3\b/i, [9]],
  [/playstation 2|\bps2\b/i, [8]],
  [/ps vita|playstation vita/i, [46]],
  [/\bpsp\b/i, [38]],
  [/xbox series/i, [169]],
  [/xbox one/i, [49]],
  [/xbox 360/i, [12]],
  [/wii u/i, [41]],
  [/\bwii\b/i, [5]],
  [/3ds/i, [37, 137]],
  [/nintendo ds|\bnds\b/i, [20, 159]],
  [/game ?boy advance|\bgba\b/i, [24]],
  [/gamecube/i, [21]],
  [/\bpc\b|windows/i, [6]],
];

// Ce qui ne peut pas être un jeu, même sans rayon.
const NOT_A_GAME = /Accessor|Consoles|Controllers|Cases|Cables|Chargers|Headsets|Batteries|Skins|Stands|Virtual Reality|Keyboards|Mice|Memory|Gift Cards/;

// Ce qui encombre un titre Amazon : la plateforme, l'édition, le format.
const AMAZON_NOISE =
  /\b(nintendo switch|switch|xbox series x( ?\| ?| and | ?& ?)?s|xbox one|xbox 360|xbox|playstation ?\d?|ps[1-5]|ps vita|psp|wii u|wii|nintendo 3ds|3ds|nintendo ds|nds|ds|game ?boy advance|gba|gamecube|pc|mac|standard edition|digital code|online game code|renewed|greatest hits|player'?s choice|nintendo selects|platinum hits|essentials|steelbook|launch|day (one|1)|limited|collector'?s|premium|signature|bonus|physical)\b/gi;
// Ce qui, après un deux-points, n'est pas un sous-titre mais un habillage :
// « Persona 5 Royal: Phantom Thieves Edition », « …: Steelbook Launch Edition ».
const EDITION_TAIL = /:\s*[^:]*\b(edition|steelbook|bundle|pack|thieves|collection)\b[^:]*$/i;

// Les variantes d'un titre Amazon, de la plus fidèle à la plus nettoyée.
// ⚠️ LA VERSION BRUTE PASSE D'ABORD : « Super Mario 64 DS » et « Nintendo
// Switch Sports » sont de vrais noms, que le nettoyage réduirait à
// « Super Mario 64 » et « Sports ».
function amazonTitles(title) {
  const raw = String(title || "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/™|®/g, "")
    .replace(/,\s*\d+\s*pieces?\b.*$/i, ""); // « …, 175 pieces »
  // « Halo 5: Guardians - Standard Edition - Xbox One » : le jeu est devant.
  const first = raw.split(/\s[-–—|]\s/)[0];
  const variants = [];
  for (const t of [first, raw]) {
    variants.push(t);
    variants.push(t.replace(AMAZON_NOISE, " "));
    // « Nintendo Super Mario Party » : l'éditeur collé devant le titre.
    variants.push(t.replace(/^\s*nintendo\s+/i, ""));
    if (EDITION_TAIL.test(t)) variants.push(t.replace(EDITION_TAIL, ""));
  }
  return [...new Set(variants.map(normName).filter((t) => t.length >= 3))];
}

async function amazonAsinMap() {
  const cache = file("asin-igdb.json");
  if (fs.existsSync(cache)) return new Map(JSON.parse(fs.readFileSync(cache, "utf8")));
  log("amazon : ASIN connus d'IGDB…");
  const map = new Map();
  let last = 0;
  for (;;) {
    const rows = await igdbQuery(
      "external_games",
      `fields uid,game; where external_game_source = 20 & id > ${last}; sort id asc; limit 500;`
    );
    for (const r of rows) if (r.uid && r.game) map.set(String(r.uid).trim(), r.game);
    if (rows.length < 500) break;
    last = rows[rows.length - 1].id;
  }
  fs.writeFileSync(cache, JSON.stringify([...map]));
  log(`amazon : ${map.size} ASIN rattachés par IGDB`);
  return map;
}

async function amazonProducts(cat) {
  const asinToGame = await amazonAsinMap();
  const product = new Map(); // parent_asin -> k
  const stats = { games: 0, byAsin: 0, byTitle: 0, missed: 0 };
  const perPlatform = new Map();
  const unmatched = []; // --debug : les jeux non rattachés, les plus notés d'abord
  for await (const line of lines("meta_Video_Games.jsonl")) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    // Accessoires, consoles, cartes cadeaux : dehors. Tout le reste est un jeu
    // possible — y compris les fiches SANS rayon, qui sont parfois les plus
    // vendues ; le rapprochement par nom écartera ce qui n'en est pas un.
    const cats = o.categories || [];
    if (cats.some((c) => NOT_A_GAME.test(c))) continue;
    stats.games++;
    const shelf = cats.slice(1).filter((c) => c !== "Games").join(" > ");
    const plats =
      (shelf && AMAZON_PLATFORMS.find(([re]) => re.test(shelf))?.[1]) ||
      TITLE_PLATFORMS.find(([re]) => re.test(o.title || ""))?.[1] ||
      null;

    let k;
    const g = asinToGame.get(o.parent_asin);
    if (g !== undefined && cat.byId.has(g)) {
      k = cat.byId.get(g);
      stats.byAsin++;
    } else {
      for (const t of amazonTitles(o.title)) {
        const all = cat.byName.get(t) || [];
        // La plateforme départage les homonymes (« Doom » 1993 et 2016). Sans
        // plateforme correspondante — Amazon range parfois Pokémon Jaune au
        // rayon GBA — on n'accepte qu'un nom sans ambiguïté.
        let cands = plats ? all.filter((c) => cat.rows[c].platforms?.some((p) => plats.includes(p))) : [];
        if (!cands.length && all.length === 1) cands = all;
        if (!cands.length) continue;
        k = cands.reduce((a, b) => ((cat.rows[b].ratingCount || 0) > (cat.rows[a].ratingCount || 0) ? b : a));
        stats.byTitle++;
        break;
      }
    }
    const key = shelf || "?";
    const pp = perPlatform.get(key) || [0, 0];
    pp[0]++;
    if (k === undefined) {
      stats.missed++;
      if (DEBUG) unmatched.push([o.rating_number || 0, shelf, o.title, amazonTitles(o.title).join(" / ")]);
    } else {
      pp[1]++;
      product.set(o.parent_asin, k);
    }
    perPlatform.set(key, pp);
  }
  log(
    `amazon : ${stats.games} jeux au catalogue Amazon — ${stats.byAsin} par ASIN, ${stats.byTitle} par titre, ${stats.missed} non rattachés`
  );
  for (const [shelf, [n, ok]] of [...perPlatform].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25))
    log(`   ${String(Math.round((100 * ok) / n)).padStart(3)} %  ${shelf} (${ok}/${n})`);
  if (DEBUG) {
    unmatched.sort((a, b) => b[0] - a[0]);
    fs.writeFileSync(file("amazon-unmatched.tsv"), unmatched.map((r) => r.join("\t")).join("\n"));
    log(`amazon : liste des non rattachés dans ${file("amazon-unmatched.tsv")}`);
  }
  return product;
}

// Lecture au plus court : la ligne commence par {"rating": X, et se termine
// par … "parent_asin": "…", "user_id": "…", … — on va chercher les champs sans
// désérialiser le texte des avis (2,7 Go).
const field = (line, key) => {
  const at = line.lastIndexOf(`"${key}": "`);
  if (at < 0) return null;
  const from = at + key.length + 5;
  return line.slice(from, line.indexOf('"', from));
};

async function amazonPairs(cat) {
  if (!has("Video_Games.jsonl") || !has("meta_Video_Games.jsonl")) return null;
  const product = await amazonProducts(cat);
  const pairs = new Pairs();
  let seen = 0;
  let mapped = 0;
  for await (const line of lines("Video_Games.jsonl")) {
    seen++;
    if (seen % 1_000_000 === 0) log(`amazon : ${seen / 1e6} M avis lus…`);
    const rating = Number(line.slice(11, line.indexOf(",")));
    const k = product.get(field(line, "parent_asin"));
    if (k === undefined) continue;
    mapped++;
    // Aimé = 4 ou 5 étoiles. Un 1 étoile d'un joueur ne dit rien de ce qui
    // lui ressemble — on ne s'en sert pas.
    if (!(rating >= 4)) continue;
    const user = field(line, "user_id");
    if (user) pairs.push(hash32(user), k, rating);
  }
  log(`amazon : ${seen} avis, ${mapped} sur un jeu rattaché, ${pairs.n} « aimés »`);
  return pairs;
}

// ----------------------------------------------------------------------
//  Steam (UCSD) — des dictionnaires Python, pas du JSON
// ----------------------------------------------------------------------
const MIN_STEAM_MINUTES = 180; // joué 3 h : essayé pour de bon, pas juste possédé

async function steamUcsdPairs(cat) {
  if (!has("australian_users_items.json.gz")) return null;
  const pairs = new Pairs();
  const itemRe = /'item_id': '(\d+)', 'item_name': (?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"), 'playtime_forever': (\d+)/g;
  let users = 0;
  for await (const line of lines("australian_users_items.json.gz", true)) {
    const uid = /'user_id': '([^']*)'/.exec(line)?.[1];
    if (!uid) continue;
    users++;
    const u = hash32(`s:${uid}`);
    for (const m of line.matchAll(itemRe)) {
      const minutes = Number(m[2]);
      if (minutes < MIN_STEAM_MINUTES) continue;
      const k = cat.bySteam.get(Number(m[1]));
      if (k !== undefined) pairs.push(u, k, minutes);
    }
  }
  log(`steam (UCSD) : ${users} bibliothèques, ${pairs.n} jeux joués 3 h ou plus`);
  return pairs;
}

// ----------------------------------------------------------------------
//  Steam (Kaggle, facultatif)
// ----------------------------------------------------------------------
async function steamKagglePairs(cat) {
  if (!has("recommendations.csv")) return null;
  const pairs = new Pairs();
  let header = null;
  let rows = 0;
  for await (const line of lines("recommendations.csv")) {
    const cols = line.split(",");
    if (!header) {
      header = Object.fromEntries(cols.map((c, k) => [c.trim(), k]));
      continue;
    }
    rows++;
    if (rows % 5_000_000 === 0) log(`kaggle : ${rows / 1e6} M lignes…`);
    if (cols[header.is_recommended] !== "true") continue;
    const hours = Number(cols[header.hours]);
    if (!(hours >= 2)) continue;
    const k = cat.bySteam.get(Number(cols[header.app_id]));
    if (k !== undefined) pairs.push(Number(cols[header.user_id]) | 0, k, hours);
  }
  log(`steam (Kaggle) : ${rows} recommandations, ${pairs.n} retenues`);
  return pairs;
}

// ----------------------------------------------------------------------
//  Le tout
// ----------------------------------------------------------------------
async function main() {
  log(`données : ${DATA}`);
  await mongoose.connect(process.env.MONGODB_URI);
  const cat = await loadCatalogue();
  if (cat.rows.length < 1000) throw new Error("Catalogue local vide : lance d'abord la synchro du catalogue.");

  const sources = {
    amazon: amazonPairs,
    steam: steamUcsdPairs,
    kaggle: steamKagglePairs,
  };
  const maps = [];
  const stats = {};
  for (const [name, read] of Object.entries(sources)) {
    if (!ONLY.includes(name)) continue;
    const pairs = await read(cat);
    if (!pairs) {
      log(`${name} : fichiers absents, source sautée`);
      continue;
    }
    const t0 = Date.now();
    const v = pairs.view();
    const { neighbors, users, itemUsers } = computeCoPlay(v.u, v.i, cat.rows.length, {
      strength: v.s,
      // Amazon est très clairsemé (1,6 avis par acheteur) : on accepte des
      // liens plus maigres, que le rétrécissement garde modestes.
      minItemUsers: name === "amazon" ? 4 : 5,
      minCo: name === "amazon" ? 2 : 3,
      beta: Number(arg("beta")) || undefined,
    });
    // Chaque source sur la même échelle (cf. calibrate) avant de les fondre.
    const typical = calibrate(neighbors);
    stats[name] = { pairs: pairs.n, users, games: neighbors.size, typical: Number(typical.toFixed(4)) };
    log(`${name} : ${users} joueurs utiles, voisins pour ${neighbors.size} jeux (${Date.now() - t0} ms)`);
    // --inspect=109462,1035 : ce que cette source dit de ces jeux, avant tout filtre.
    for (const id of INSPECT) {
      const k = cat.byId.get(id);
      if (k === undefined) continue;
      const list = neighbors.get(k) || [];
      log(
        `   ${cat.rows[k].name} : ${itemUsers[k]} joueurs, ${list.length} voisins — ` +
          list
            .slice(0, 8)
            .map(([j, s]) => `${cat.rows[j].name} ${s.toFixed(3)}`)
            .join(" | ")
      );
    }
    maps.push(neighbors);
  }
  if (!maps.length) throw new Error(`Aucune source trouvée dans ${DATA}.`);

  // On ne garde que des voisins proposables (le pool), mais pour tous les jeux
  // de départ possibles.
  const merged = mergeNeighbors(maps, 60);
  const games = {};
  let links = 0;
  for (const [k, list] of merged) {
    const flat = [];
    for (const [j, s] of list) {
      if (!cat.rows[j].pool || s < 0.01) continue;
      flat.push(cat.ids[j], Math.round(s * 1000));
      if (flat.length >= 80) break; // 40 voisins
    }
    if (flat.length) {
      games[cat.ids[k]] = flat;
      links += flat.length / 2;
    }
  }
  const out = {
    version: new Date().toISOString(),
    sources: stats,
    games,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
  log(
    `écrit ${OUT} — ${Object.keys(games).length} jeux, ${links} liens, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} Mo`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
