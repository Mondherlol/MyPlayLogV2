// ======================================================================
//  Le co-jeu côté serveur : l'import du fichier, et le calcul de la nuit
// ======================================================================
//
// Deux sources de « ceux qui ont aimé X ont aimé Y » (models/GameNeighbors.js) :
//
//   • `ext` — les avis publics (Amazon toutes consoles, Steam), calculés sur
//     ton PC par scripts/buildCoPlay.js et livrés dans data/coplay.json.gz. Au
//     démarrage, si le fichier est plus récent que ce qui est en base, on
//     l'importe. Rien d'autre à faire pour le mettre en prod : le commiter.
//
//   • `local` — les bibliothèques de MyPlayLog, recalculées chaque nuit. Petit
//     aujourd'hui, c'est la source qui grandit avec le site, et la seule qui
//     connaît les goûts de TES joueurs, toutes plateformes confondues.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import AppSetting from "../models/AppSetting.js";
import GameNeighbors from "../models/GameNeighbors.js";
import UserGame from "../models/UserGame.js";
import { calibrate, computeCoPlay } from "./coPlay.js";
import { ratingStats, reloadCoPlay, seedWeight } from "./recoEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "../data/coplay.json.gz");
const STATE_KEY = "recoCoPlay";
const HOUR = 60 * 60 * 1000;
const BATCH = 1000;
// « Aimé » pour le co-jeu : un poids de profil nettement positif (terminé et
// bien noté, coup de cœur, beaucoup d'heures). Posséder ne suffit pas.
const LIKED = 0.8;
// Le nombre de joueurs à partir duquel le co-jeu MyPlayLog a plein crédit.
const TRUSTED_USERS = 200;

async function getState() {
  return (await AppSetting.findOne({ key: STATE_KEY }).lean())?.value || {};
}
async function setState(patch) {
  const value = { ...(await getState()), ...patch };
  await AppSetting.updateOne({ key: STATE_KEY }, { $set: { value } }, { upsert: true });
  return value;
}

// Écrit un champ (`ext` ou `local`) pour tous les jeux donnés, et vide ce champ
// chez les jeux qui n'y sont plus.
async function writeField(field, games) {
  const ids = Object.keys(games).map(Number);
  for (let k = 0; k < ids.length; k += BATCH)
    await GameNeighbors.bulkWrite(
      ids.slice(k, k + BATCH).map((id) => ({
        updateOne: { filter: { _id: id }, update: { $set: { [field]: games[id] } }, upsert: true },
      })),
      { ordered: false }
    );
  await GameNeighbors.updateMany(
    { _id: { $nin: ids }, [`${field}.0`]: { $exists: true } },
    { $set: { [field]: [] } }
  );
  return ids.length;
}

/** Importe data/coplay.json.gz s'il est plus récent que la version en base. */
export async function importCoPlayFile({ force = false } = {}) {
  if (!fs.existsSync(FILE)) return { imported: false, reason: "pas de fichier" };
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)));
  const state = await getState();
  if (!force && state.extVersion === data.version) return { imported: false, reason: "déjà à jour" };
  const n = await writeField("ext", data.games || {});
  await setState({ extVersion: data.version, extGames: n, extSources: data.sources || {}, extImportedAt: new Date() });
  console.log(`🤝 co-jeu : ${n} jeux importés (version ${data.version})`);
  return { imported: true, games: n, version: data.version };
}

/**
 * Le co-jeu entre joueurs de MyPlayLog : même calcul que pour les avis
 * publics (lib/coPlay.js), seuils abaissés — la communauté est petite, un lien
 * vu chez deux joueurs vaut déjà quelque chose, et le rétrécissement le garde
 * modeste tant qu'il n'est pas confirmé.
 */
export async function computeLocalCoPlay() {
  const t0 = Date.now();
  const rows = await UserGame.find({ gameId: { $gt: 0 } })
    .select("user gameId status rating favorite playtimeHours platinum")
    .lean();
  const byUser = new Map();
  for (const r of rows) {
    const key = String(r.user);
    let list = byUser.get(key);
    if (!list) byUser.set(key, (list = []));
    list.push(r);
  }

  const dense = new Map(); // gameId -> indice
  const ids = [];
  const users = [];
  const items = [];
  const strength = [];
  let u = 0;
  for (const lib of byUser.values()) {
    const stats = ratingStats(lib);
    for (const e of lib) {
      const w = seedWeight(e, stats);
      if (w < LIKED) continue;
      let k = dense.get(e.gameId);
      if (k === undefined) {
        k = ids.length;
        dense.set(e.gameId, k);
        ids.push(e.gameId);
      }
      users.push(u);
      items.push(k);
      strength.push(w);
    }
    u++;
  }

  const { neighbors, users: useful } = computeCoPlay(users, items, ids.length, {
    strength,
    minItemUsers: 2,
    minCo: 2,
    shrink: 5,
    top: 40,
  });
  if (neighbors.size) calibrate(neighbors); // même échelle que les avis publics
  // ⚠️ MAIS PAS LE MÊME CRÉDIT. Calibré, le lien typique vaut 0,5 quelle que
  // soit la taille de la foule — or neuf joueurs qui ont Braid et Minish Cap
  // en commun, c'est une coïncidence, pas un goût partagé. Le co-jeu MyPlayLog
  // ne pèse donc qu'à proportion de ses joueurs, pleinement à partir de 200.
  const trust = Math.min(1, useful / TRUSTED_USERS);
  const games = {};
  for (const [k, list] of neighbors) {
    const flat = [];
    for (const [j, s] of list) {
      const v = Math.round(s * trust * 1000);
      if (v > 0) flat.push(ids[j], v);
    }
    if (flat.length) games[ids[k]] = flat;
  }
  const n = await writeField("local", games);
  const state = await setState({
    localAt: new Date(),
    localGames: n,
    localUsers: useful,
    localPairs: users.length,
    localMs: Date.now() - t0,
  });
  console.log(`🤝 co-jeu MyPlayLog : ${useful} joueurs, ${users.length} jeux aimés, voisins pour ${n} jeux`);
  return state;
}

export async function getCoPlayState() {
  const [state, total] = await Promise.all([getState(), GameNeighbors.estimatedDocumentCount()]);
  return { ...state, rows: total, file: fs.existsSync(FILE) };
}

/** Import du fichier puis calcul local, et le moteur recharge son co-jeu. */
export async function refreshCoPlay({ forceImport = false } = {}) {
  const imp = await importCoPlayFile({ force: forceImport });
  const local = await computeLocalCoPlay();
  await reloadCoPlay();
  return { import: imp, local };
}

export function startRecoCoPlay() {
  const run = () => refreshCoPlay().catch((err) => console.error("recoCoPlay:", err.message));
  // Une minute après le démarrage : le fichier livré avec une nouvelle version
  // est en base avant que quiconque ait le temps d'ouvrir ses recommandations.
  setTimeout(run, 60 * 1000);
  setInterval(() => computeLocalCoPlay().then(reloadCoPlay).catch((err) => console.error("recoCoPlay:", err.message)), 24 * HOUR);
  console.log("🤝 Co-jeu : import du fichier au démarrage, calcul MyPlayLog chaque nuit");
}
