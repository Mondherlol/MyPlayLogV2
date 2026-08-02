import "dotenv/config";
import mongoose from "mongoose";
import CustomOst from "../models/CustomOst.js";
import OstClimax from "../models/OstClimax.js";
import { analyzeClimax } from "../lib/ostClimax.js";

// ======================================================================
//  Pré-calcul des climax d'OST
// ======================================================================
// Le blind test recale ses extraits sur le climax du morceau (cf.
// models/OstClimax.js). L'analyse se fait toute seule en tâche de fond au fil
// des parties, mais elle ne rattrape son retard qu'au rythme où l'on joue —
// et les premières parties après une mise en service tombent toutes sur
// l'estimation.
//
// Ce script prend les devants : il analyse les pistes les plus écoutées, en
// commençant par les plus vues (donc celles qui ont le plus de chances de
// sortir). À lancer une fois après un déploiement, puis de temps en temps.
//
//   node src/scripts/warmOstClimax.js               (200 pistes)
//   node src/scripts/warmOstClimax.js --limit 1000
//   node src/scripts/warmOstClimax.js --top 5       (top 5 par jeu, défaut 3)
//
// ATTENTION : chaque piste = un téléchargement audio + un décodage complet.
// Comptez quelques secondes par piste et de la bande passante. Le cache audio
// est partagé avec le mini-lecteur et purgé en LRU (routes/audio.js), donc ça
// ne fait pas gonfler le disque indéfiniment.

const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 200;
const TOP = Number(args[args.indexOf("--top") + 1]) || 3;
const CLIP_SEC = 15;

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog");

// Les mêmes pistes que celles que le blind test peut tirer : le top N par jeu.
// Analyser au-delà serait du travail pur perte — elles ne sortiront jamais.
const rows = await CustomOst.find({ views: { $ne: null } })
  .select("gameId videoId name views")
  .sort({ views: -1 })
  .lean();

const perGame = new Map();
const wanted = [];
for (const r of rows) {
  const n = perGame.get(r.gameId) || 0;
  if (n >= TOP) continue;
  perGame.set(r.gameId, n + 1);
  wanted.push(r);
}

const known = new Set(
  (await OstClimax.find({ videoId: { $in: wanted.map((w) => w.videoId) } })
    .select("videoId")
    .lean()).map((k) => k.videoId)
);
const todo = wanted.filter((w) => !known.has(w.videoId)).slice(0, LIMIT);

console.log(
  `${rows.length} piste(s) chiffrée(s), ${wanted.length} dans le top ${TOP} par jeu, ` +
    `${known.size} déjà analysée(s) → ${todo.length} à faire.`
);
if (!todo.length) {
  await mongoose.disconnect();
  process.exit(0);
}

let ok = 0;
let ko = 0;
for (let i = 0; i < todo.length; i += 1) {
  const t = todo[i];
  const r = await analyzeClimax(t.videoId, CLIP_SEC);
  if (r?.ok) {
    ok += 1;
    const pct = r.durationSec ? Math.round((r.startSec / r.durationSec) * 100) : "?";
    console.log(
      `  [${i + 1}/${todo.length}] ✓ ${t.name?.slice(0, 48)} — climax à ${r.startSec}s / ` +
        `${r.durationSec}s (${pct}%)`
    );
  } else {
    ko += 1;
    console.log(`  [${i + 1}/${todo.length}] ✗ ${t.name?.slice(0, 48)} — ${r?.error || "échec"}`);
  }
}

console.log(`\nTerminé : ${ok} analysée(s), ${ko} en échec.`);
await mongoose.disconnect();
process.exit(0);
