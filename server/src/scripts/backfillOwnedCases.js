import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";
import CollectionMedia from "../models/CollectionMedia.js";
import CollectionProgress from "../models/CollectionProgress.js";
import CollectionSave from "../models/CollectionSave.js";

// ======================================================================
//  Rattrapage : rendre les boîtiers déjà entamés à ceux qui les regardaient
// ======================================================================
//   npm run backfill:owned-cases           (aperçu, n'écrit rien)
//   npm run backfill:owned-cases -- --go   (applique)
//   npm run backfill:owned-cases -- --all --go   (donne TOUT le rayon à tous)
//
// POURQUOI. Le rayon était commun : tout le monde voyait les vingt boîtiers, et
// certains ont commencé une série, posé un marque-page dans un manga, laissé
// une partie de GBA en cours. Depuis que les étagères sont personnelles, ces
// titres se sont verrouillés d'un coup — la progression est toujours en base
// (rien n'a été effacé), mais elle ne mène plus nulle part tant que la machine
// à capsules n'a pas rendu le boîtier.
//
// Ce script répare exactement ce cas, et RIEN D'AUTRE : on rend ce sur quoi
// quelqu'un a déjà passé du temps. Pas de cadeau général — l'intérêt de la
// machine tient à ce qu'il reste des boîtiers à sortir.
//
// `--all` existe pour le cas de figure inverse (relancer la fonctionnalité en
// donnant tout à tout le monde, ou remettre d'aplomb une base de test).
//
// Rejouable sans risque : on n'ajoute jamais un slug déjà présent.

const APPLY = process.argv.includes("--go");
const ALL = process.argv.includes("--all");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  const media = await CollectionMedia.find().select("slug title").lean();
  const slugById = new Map(media.map((m) => [String(m._id), m.slug]));
  console.log(`Rayon : ${media.length} boîtier(s)\n`);
  if (!media.length) {
    console.log("Rien à distribuer.");
    return;
  }

  // Ce que chacun a déjà touché : une progression (vidéo, planche, temps de
  // jeu) ou une sauvegarde de partie. Les deux comptent — une sauvegarde de GBA
  // sans progression enregistrée, c'est quand même quelqu'un qui a joué.
  const [progresses, saves] = await Promise.all([
    CollectionProgress.find().select("user media").lean(),
    CollectionSave.find().select("user media").lean(),
  ]);

  const wanted = new Map(); // userId -> Set(slug)
  const note = (userId, mediaId) => {
    const slug = slugById.get(String(mediaId));
    if (!slug) return; // titre supprimé du rayon depuis
    const key = String(userId);
    if (!wanted.has(key)) wanted.set(key, new Set());
    wanted.get(key).add(slug);
  };
  for (const p of progresses) note(p.user, p.media);
  for (const s of saves) note(s.user, s.media);

  const users = await User.find().select("username ownedCases").lean();
  const everySlug = media.map((m) => m.slug);

  let touched = 0;
  let granted = 0;

  for (const u of users) {
    const have = new Set((u.ownedCases || []).map((c) => c.slug));
    const target = ALL ? everySlug : [...(wanted.get(String(u._id)) || [])];
    const missing = target.filter((slug) => !have.has(slug));
    if (!missing.length) continue;

    touched += 1;
    granted += missing.length;
    console.log(
      `  ${u.username.padEnd(20)} +${String(missing.length).padStart(3)} → ${missing
        .slice(0, 4)
        .join(", ")}${missing.length > 4 ? "…" : ""}`
    );

    if (!APPLY) continue;
    // La date d'obtention est celle du rattrapage : on ne sait pas quand la
    // personne a commencé à regarder, et inventer une date la ferait remonter
    // au mauvais endroit dans un rangement « par obtention ».
    const now = new Date();
    await User.updateOne(
      { _id: u._id },
      { $push: { ownedCases: { $each: missing.map((slug) => ({ slug, obtainedAt: now })) } } },
      { timestamps: false }
    );
  }

  console.log(
    `\n${granted} boîtier(s) à rendre à ${touched} joueur(s)${
      ALL ? " (mode --all : tout le rayon)" : " (progression ou sauvegarde existante)"
    }`
  );
  console.log(
    APPLY
      ? "✅ Appliqué."
      : "ℹ️  Aperçu seulement — relance avec « -- --go » pour écrire."
  );
}

run()
  .catch((err) => {
    console.error("❌", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
