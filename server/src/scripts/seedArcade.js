import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Reward from "../models/Reward.js";
import LootCase from "../models/LootCase.js";

// ======================================================================
//  Seed de départ de l'arcade : 8 curseurs pixel-art + une caisse.
// ======================================================================
//   npm run seed:arcade
//
// Rejouable : les lots déjà présents (même slug) sont laissés tels quels — tes
// retouches depuis le panel admin ne sont jamais écrasées.
//
// Les curseurs sont GÉNÉRÉS ici en SVG plutôt que commités comme assets : même
// silhouette que public/cursor.svg, déclinée en 8 couleurs. Modifier la palette
// ci-dessous et relancer suffit à en refaire une série.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../uploads/arcade");

// La flèche de public/cursor.svg, relevée pixel par pixel (grille de 2px) :
//   '#' = corps    '.' = contour    ' ' = rien
// L'aligner sur le curseur d'origine garde la famille cohérente : seules les
// couleurs changent d'un lot à l'autre.
const ARROW = [
  "...",
  ".#..",
  ".##..",
  ".###..",
  ".####..",
  ".#####..",
  ".######..",
  ".#######..",
  ".########..",
  ".#########.",
  ".#####.....",
  ".##.##.",
  ".#..##..",
  ".....##.",
  "    .##.",
  "    ....",
];

// Rendu d'une flèche : `fill` = corps, `stroke` = contour.
function arrowSvg(fill, stroke) {
  const rects = [];
  ARROW.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === " ") return;
      rects.push(
        `<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${
          ch === "#" ? fill : stroke
        }"/>`
      );
    });
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="32" viewBox="0 0 22 32"` +
    ` shape-rendering="crispEdges">${rects.join("")}</svg>`
  );
}

// Corps vif cerné d'un contour très foncé : chaque curseur reste lisible sur
// fond blanc COMME sur fond sombre (l'app a les deux thèmes).
//
// `key` est écrit à la main, jamais dérivé du nom : c'est l'identifiant que les
// inventaires des joueurs référencent à vie. Le renommer déposséderait tout le
// monde — le nom affiché, lui, reste libre de changer.
const CURSORS = [
  { key: "curseur-origine", name: "Curseur d'origine", rarity: "common",
    fill: "#f7f7f8", stroke: "#141414", desc: "Le bon vieux curseur de MyPlayLog." },
  { key: "curseur-ardoise", name: "Curseur ardoise", rarity: "common",
    fill: "#9aa3ad", stroke: "#1c1f24", desc: "Sobre, gris, efficace." },
  { key: "curseur-menthe", name: "Curseur menthe", rarity: "uncommon",
    fill: "#4ade80", stroke: "#0b3d21", desc: "Une pointe de fraîcheur." },
  { key: "curseur-cobalt", name: "Curseur cobalt", rarity: "uncommon",
    fill: "#4b69ff", stroke: "#0a1240", desc: "Bleu profond, façon caisse d'armes." },
  { key: "curseur-amethyste", name: "Curseur améthyste", rarity: "rare",
    fill: "#a855f7", stroke: "#2b0a47", desc: "Violet rare, pour les collectionneurs." },
  { key: "curseur-fuchsia", name: "Curseur fuchsia", rarity: "epic",
    fill: "#e879f9", stroke: "#3f0a48", desc: "Impossible de le rater." },
  { key: "curseur-braise", name: "Curseur braise", rarity: "legendary",
    fill: "#f97316", stroke: "#3d1403", desc: "Chauffé à blanc. Très peu en circulation." },
  { key: "curseur-dore", name: "Curseur doré", rarity: "mythic",
    fill: "#ffd24a", stroke: "#4a3402", desc: "L'or de MyPlayLog. Le plus rare de tous." },
];

// Les images sont servies par Express sur /uploads (en prod, Caddy y route
// /uploads/* — c'est donc le domaine public). Hors requête HTTP, on ne peut pas
// deviner ce domaine : PUBLIC_URL le donne, sinon on suppose du dev local.
function publicBase() {
  const env = process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const local = `http://localhost:${process.env.PORT || 4000}`;
  console.warn(
    `⚠️  PUBLIC_URL non défini → URLs des curseurs en ${local}\n` +
      `    En production, définis PUBLIC_URL=https://myplaylog.cc avant de lancer\n` +
      `    ce script (onglet Secrets du panel admin), sinon les curseurs seront\n` +
      `    introuvables pour les joueurs.`
  );
  return local;
}

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = publicBase();

  const ids = [];
  for (const c of CURSORS) {
    const file = `seed-${c.key}.svg`;
    fs.writeFileSync(path.join(OUT_DIR, file), arrowSvg(c.fill, c.stroke), "utf8");

    const existing = await Reward.findOne({ key: c.key });
    if (existing) {
      console.log(`↷ ${c.name} — déjà en base, laissé tel quel`);
      ids.push(existing._id);
      continue;
    }
    const doc = await Reward.create({
      key: c.key,
      type: "cursor",
      name: c.name,
      description: c.desc,
      rarity: c.rarity,
      // Hotspot 2,2 : la pointe de la flèche, comme le curseur d'origine.
      data: { url: `${base}/uploads/arcade/${file}`, hotspotX: 2, hotspotY: 2 },
    });
    ids.push(doc._id);
    console.log(`＋ ${c.name} (${c.rarity})`);
  }

  const caseKey = "caisse-de-depart";
  if (await LootCase.findOne({ key: caseKey })) {
    console.log("↷ Caisse de départ — déjà en base, laissée telle quelle");
  } else {
    await LootCase.create({
      key: caseKey,
      name: "Caisse de départ",
      description: "Huit curseurs pixel-art, du plus commun au doré mythique.",
      price: 1500,
      rewards: ids,
      order: 0,
    });
    console.log("＋ Caisse de départ (1500 points)");
  }

  await mongoose.disconnect();
  console.log(
    "\n🎰 Arcade prête. Joue un blind test pour gagner des points, puis file sur /arcade."
  );
}

run().catch((err) => {
  console.error("❌ Seed arcade échoué:", err);
  process.exit(1);
});
