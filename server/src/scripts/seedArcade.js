import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Reward from "../models/Reward.js";
import LootCase from "../models/LootCase.js";

// ======================================================================
//  Seed de départ de l'arcade : 8 curseurs pixel-art + 7 thèmes + 2 caisses.
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

// ======================================================================
//  Thèmes : repeignent tout le site (variables CSS appliquées sur <html> par
//  CosmeticsContext). `mode` bascule le clair/sombre ; `vars` surcharge la
//  palette et le fond ; `swatch` sert d'aperçu (RewardArt).
// ======================================================================

// Motif de fond « pois » (façon ciel étoilé / bloc-note discret).
function dotsBg(color) {
  return `radial-gradient(${color} 1px, transparent 1.6px)`;
}
// Motif de fond « petits cœurs » (thèmes girly), en SVG inline (zéro asset).
function heartsBg(color) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='54' height='54' viewBox='0 0 54 54'>` +
    `<path d='M27 37s-10-6.4-10-14.2C17 17.6 20.4 14.4 24.6 15.6c1.4.4 2.4 1.6 2.4 1.6s1-1.2 2.4-1.6c4.2-1.2 7.6 2 7.6 7.2C37 30.6 27 37 27 37z' fill='${color}'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Construit la palette complète d'un thème à partir d'une spec compacte.
// `side` (optionnel) recolore la barre latérale ; par défaut elle garde son
// look sombre d'origine (les variables --side-* ne sont alors pas posées).
function mkTheme(mode, s) {
  const grad = `linear-gradient(135deg, ${s.accent2 || s.accent}, ${s.accent})`;
  const vars = {
    "--bg": s.bg,
    "--surface": s.surface,
    "--surface-2": s.surface2,
    "--border": s.border,
    "--border-strong": s.borderStrong,
    "--text": s.text,
    "--text-soft": s.textSoft,
    "--grid-line": s.grid,
    "--orange": s.accent,
    "--amber": s.accent2 || s.accent,
    "--accent-grad": grad,
    "--accent-ink": s.ink,
    "--brand-grad": grad,
    "--ring": s.ring,
    "--app-halo": s.halo,
    "--app-bg-image": s.bgImage,
    "--app-bg-size": s.bgSize || "26px 26px",
  };
  const side = s.side;
  if (side) {
    const sideBrand = `linear-gradient(100deg, ${side.accent}, ${side.accent})`;
    Object.assign(vars, {
      "--side-bg": side.bg,
      "--side-surface": side.surface,
      "--side-surface-2": side.surface2 || side.surface,
      "--side-border": side.border || "rgba(255,255,255,0.09)",
      "--side-border-strong": side.borderStrong || "rgba(255,255,255,0.16)",
      "--side-text": side.text,
      "--side-text-soft": side.textSoft,
      "--side-accent": side.accent,
      "--side-brand": sideBrand,
    });
  }
  return {
    mode,
    // Aperçu (RewardArt / mockup) : les tons clés, dont la barre latérale.
    swatch: {
      bg: s.bg,
      surface: s.surface,
      accent: s.accent,
      accent2: s.accent2 || s.accent,
      text: s.text,
      side: s.side?.bg || null,
      sideText: s.side?.text || null,
    },
    vars,
  };
}

const THEMES = [
  // Le graal des connaisseurs : la palette du tout premier MyPlayLog.
  {
    key: "theme-og",
    name: "MyPlayLog Origine",
    rarity: "legendary",
    desc: "La palette du tout premier MyPlayLog. Indigo profond, or et rouge. Pour les OG.",
    data: mkTheme("dark", {
      bg: "#110F32",
      surface: "#191552",
      surface2: "#221c66",
      border: "#2c2670",
      borderStrong: "#392f8a",
      text: "#f3f2ff",
      textSoft: "#a9a7d6",
      grid: "rgba(255,255,255,0.05)",
      accent: "#FDC500",
      accent2: "#ffe066",
      ink: "#FDC500",
      ring: "rgba(253,197,0,0.4)",
      halo:
        "radial-gradient(760px 380px at 78% -12%, rgba(253,197,0,0.16), transparent 60%)," +
        " radial-gradient(600px 380px at 6% 122%, rgba(59,42,140,0.55), transparent 62%)",
      bgImage: dotsBg("rgba(255,255,255,0.05)"),
      bgSize: "24px 24px",
      side: {
        bg: "#0c0a22",
        surface: "#191552",
        surface2: "#221c66",
        text: "#f3f2ff",
        textSoft: "#a9a7d6",
        accent: "#FDC500",
      },
    }),
  },
  // Girly pastel façon Sanrio.
  {
    key: "theme-sakura",
    name: "Sakura",
    rarity: "epic",
    desc: "Rose poudré, petits cœurs et douceur pastel. Kawaii à souhait.",
    data: mkTheme("light", {
      bg: "#fff5f8",
      surface: "#ffffff",
      surface2: "#fdeef4",
      border: "#fbdde8",
      borderStrong: "#f6c7d8",
      text: "#4a2b38",
      textSoft: "#a97d8c",
      grid: "rgba(214,63,124,0.06)",
      accent: "#ff6fa5",
      accent2: "#ffa6c9",
      ink: "#d63f7c",
      ring: "rgba(255,111,165,0.35)",
      halo: "radial-gradient(720px 360px at 80% -10%, rgba(255,111,165,0.18), transparent 60%)",
      bgImage: heartsBg("rgba(255,111,165,0.10)"),
      bgSize: "54px 54px",
      // Sidebar « mauve profond » : chaude et girly, tranche joliment sur le rose.
      side: {
        bg: "#3a1f2b",
        surface: "#4a2a38",
        surface2: "#582f42",
        border: "rgba(255,255,255,0.1)",
        text: "#ffeaf1",
        textSoft: "#d6a9ba",
        accent: "#ff6fa5",
      },
    }),
  },
  // Girly goth, façon Kuromi.
  {
    key: "theme-kuromi",
    name: "Kuromi",
    rarity: "epic",
    desc: "Nuit violette, cœurs et néon rose. Le girly qui a du caractère.",
    data: mkTheme("dark", {
      bg: "#16121d",
      surface: "#1f1929",
      surface2: "#271f34",
      border: "#342a45",
      borderStrong: "#443759",
      text: "#f3eef9",
      textSoft: "#b3a6c6",
      grid: "rgba(255,255,255,0.045)",
      accent: "#c264ff",
      accent2: "#ff5fbf",
      ink: "#d79bff",
      ring: "rgba(194,100,255,0.4)",
      halo:
        "radial-gradient(700px 360px at 78% -10%, rgba(194,100,255,0.22), transparent 60%)," +
        " radial-gradient(560px 340px at 6% 122%, rgba(255,95,191,0.14), transparent 62%)",
      bgImage: heartsBg("rgba(194,100,255,0.12)"),
      bgSize: "54px 54px",
      side: {
        bg: "#120e18",
        surface: "#241c30",
        surface2: "#2e243f",
        text: "#f3eef9",
        textSoft: "#b3a6c6",
        accent: "#c264ff",
      },
    }),
  },
  // Bleu nuit + cyan.
  {
    key: "theme-midnight",
    name: "Minuit",
    rarity: "rare",
    desc: "Bleu de nuit et cyan électrique. Sobre et racé.",
    data: mkTheme("dark", {
      bg: "#0a1120",
      surface: "#0f1a2e",
      surface2: "#142338",
      border: "#1e3350",
      borderStrong: "#29405f",
      text: "#eaf2fb",
      textSoft: "#93a6be",
      grid: "rgba(255,255,255,0.04)",
      accent: "#38bdf8",
      accent2: "#22d3ee",
      ink: "#67d3f7",
      ring: "rgba(56,189,248,0.4)",
      halo: "radial-gradient(720px 380px at 78% -12%, rgba(56,189,248,0.18), transparent 60%)",
      bgImage: dotsBg("rgba(255,255,255,0.04)"),
      bgSize: "24px 24px",
      side: {
        bg: "#060b16",
        surface: "#0f1a2e",
        surface2: "#142338",
        text: "#eaf2fb",
        textSoft: "#93a6be",
        accent: "#38bdf8",
      },
    }),
  },
  // Vert menthe frais.
  {
    key: "theme-matcha",
    name: "Matcha",
    rarity: "rare",
    desc: "Vert menthe, clair et reposant. Une bouffée de fraîcheur.",
    data: mkTheme("light", {
      bg: "#f2fbf6",
      surface: "#ffffff",
      surface2: "#eaf6ef",
      border: "#d8ece1",
      borderStrong: "#c2e0d0",
      text: "#1e3b2f",
      textSoft: "#6b8a7c",
      grid: "rgba(16,185,129,0.06)",
      accent: "#10b981",
      accent2: "#34d399",
      ink: "#0f9c6e",
      ring: "rgba(16,185,129,0.32)",
      halo: "radial-gradient(720px 360px at 80% -10%, rgba(16,185,129,0.16), transparent 60%)",
      bgImage: "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
      bgSize: "28px 28px",
      side: {
        bg: "#12271e",
        surface: "#1c3a2c",
        surface2: "#234534",
        text: "#eafaf1",
        textSoft: "#a9cbb9",
        accent: "#34d399",
      },
    }),
  },
  // Coucher de soleil, chaud.
  {
    key: "theme-sunset",
    name: "Coucher de soleil",
    rarity: "uncommon",
    desc: "Pêche et orange doux. La chaleur d'une fin de journée.",
    data: mkTheme("light", {
      bg: "#fff8f2",
      surface: "#ffffff",
      surface2: "#fdefe4",
      border: "#f7ddc9",
      borderStrong: "#f0c8a9",
      text: "#402a1c",
      textSoft: "#9a7c66",
      grid: "rgba(217,105,31,0.06)",
      accent: "#ff8a3c",
      accent2: "#ffb056",
      ink: "#d9691f",
      ring: "rgba(255,138,60,0.32)",
      halo: "radial-gradient(720px 360px at 80% -10%, rgba(255,138,60,0.16), transparent 60%)",
      bgImage: "linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)",
      bgSize: "28px 28px",
      side: {
        bg: "#2e1b12",
        surface: "#43291b",
        surface2: "#4f3223",
        text: "#fbeade",
        textSoft: "#d3b199",
        accent: "#ff8a3c",
      },
    }),
  },
  // Noir & blanc chic.
  {
    key: "theme-noir",
    name: "Noir",
    rarity: "uncommon",
    desc: "Noir profond, blanc net, zéro couleur. Élégance minimale.",
    data: mkTheme("dark", {
      bg: "#0b0b0d",
      surface: "#141416",
      surface2: "#1c1c1f",
      border: "#262629",
      borderStrong: "#34343a",
      text: "#f5f5f6",
      textSoft: "#9a9a9f",
      grid: "rgba(255,255,255,0.04)",
      accent: "#e8e8ec",
      accent2: "#ffffff",
      ink: "#d0d0d6",
      ring: "rgba(255,255,255,0.28)",
      halo: "radial-gradient(760px 380px at 78% -12%, rgba(255,255,255,0.06), transparent 62%)",
      bgImage: dotsBg("rgba(255,255,255,0.035)"),
      bgSize: "24px 24px",
      side: {
        bg: "#050506",
        surface: "#141416",
        surface2: "#1c1c1f",
        text: "#f5f5f6",
        textSoft: "#9a9a9f",
        accent: "#e8e8ec",
      },
    }),
  },
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

  // --- Thèmes (aucun fichier à générer : tout est dans data.vars) ---
  // Contrairement aux curseurs, la PALETTE d'un thème n'est pas éditable au
  // panel admin : on la RÉ-APPLIQUE à chaque seed pour pouvoir la peaufiner
  // (nouvelles variables sidebar, retouches de couleurs…). Le nom / la rareté /
  // la disponibilité, eux, restent tels que l'admin les a laissés.
  const themeIds = [];
  for (const t of THEMES) {
    const existing = await Reward.findOne({ key: t.key });
    if (existing) {
      existing.data = t.data;
      await existing.save();
      themeIds.push(existing._id);
      console.log(`↻ ${t.name} — palette mise à jour`);
      continue;
    }
    const doc = await Reward.create({
      key: t.key,
      type: "theme",
      name: t.name,
      description: t.desc,
      rarity: t.rarity,
      data: t.data,
    });
    themeIds.push(doc._id);
    console.log(`＋ ${t.name} (${t.rarity})`);
  }

  const themeCaseKey = "caisse-de-themes";
  if (await LootCase.findOne({ key: themeCaseKey })) {
    console.log("↷ Caisse de thèmes — déjà en base, laissée telle quelle");
  } else {
    await LootCase.create({
      key: themeCaseKey,
      name: "Caisse de thèmes",
      description: "Repeins tout le site : du pastel Sakura au légendaire thème d'origine.",
      price: 2500,
      rewards: themeIds,
      order: 1,
    });
    console.log("＋ Caisse de thèmes (2500 points)");
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
