import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import CollectionMedia from "../models/CollectionMedia.js";
import CollectionProgress from "../models/CollectionProgress.js";
import CollectionSave from "../models/CollectionSave.js";
import CollectionThread from "../models/CollectionThread.js";
import { removeActivity } from "../lib/activity.js";

// ======================================================================
//  Retirer le rayon Nintendo DS
// ======================================================================
//   npm run purge:ds          (aperçu, n'écrit rien)
//   npm run purge:ds -- --go  (supprime pour de bon)
//
// POURQUOI CE RAYON DISPARAÎT. Émuler une DS dans un navigateur demande une
// machine : deux écrans, un tactile, une puce 3D, le tout recopié image par
// image depuis le canvas du cœur. Sur un portable honnête, ça se traînait — et
// une console qui rame n'est pas une console, c'est une démonstration. Le rayon
// jeu tourne maintenant sur Game Boy Advance, que mGBA fait tourner à pleine
// vitesse jusque sur téléphone.
//
// CE QUE ÇA EFFACE, et il faut le dire franchement : les boîtiers DS, leurs
// ROMs, le temps de jeu accumulé dessus et les fils de discussion qui leur
// étaient attachés. Il n'y a pas de conversion possible — une cartouche DS ne
// devient pas une cartouche GBA, et prétendre migrer quoi que ce soit serait
// mentir sur ce qu'on garde.
//
// L'APERÇU EST LE MODE PAR DÉFAUT, exprès : on lit ce qui va partir avant de le
// faire partir. Rien ne s'écrit sans `--go`.
//
// Rejouable sans risque : une deuxième passe ne trouve plus rien.

const APPLY = process.argv.includes("--go");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_DIR = path.join(__dirname, "../../uploads/roms");
const SAVE_DIR = path.join(__dirname, "../../uploads/saves");

// Un fichier de `uploads/`, effacé s'il est là. Best-effort : un fichier déjà
// disparu n'est pas une erreur, c'est le résultat recherché.
async function drop(dir, stored) {
  if (!stored) return 0;
  const file = path.join(dir, path.basename(stored));
  try {
    const { size } = await fs.promises.stat(file);
    await fs.promises.rm(file, { force: true });
    return size;
  } catch {
    return 0;
  }
}

const mo = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  // LE CRITÈRE EST LE SYSTÈME DE LA CARTOUCHE, PAS LE FORMAT DU BOÎTIER. Un
  // titre a pu être reposé, corrigé, changé de format à la main : `format: "ds"`
  // dit comment on le RANGE, `cartridge.system` dit ce qu'il EST. On prend les
  // deux, en OU, pour ne pas laisser un boîtier bâtard derrière.
  const games = await CollectionMedia.find({
    kind: "game",
    $or: [{ "cartridge.system": "nds" }, { format: "ds" }],
  }).select("_id slug title format cartridge");

  if (!games.length) {
    console.log("Rien à retirer : aucun jeu DS dans le catalogue.");
    return;
  }

  const ids = games.map((m) => m._id);
  const [progresses, saves] = await Promise.all([
    CollectionProgress.countDocuments({ media: { $in: ids } }),
    CollectionSave.find({ media: { $in: ids } }).lean(),
  ]);

  const romBytes = games.reduce((n, m) => n + (m.cartridge?.bytes || 0), 0);
  console.log(`${games.length} jeu(x) DS à retirer :\n`);
  for (const m of games) {
    const size = m.cartridge?.bytes ? ` — ${mo(m.cartridge.bytes)}` : "";
    console.log(`  · ${m.title} (${m.slug})${size}`);
  }
  console.log(
    `\n  ${progresses} progression(s), ${saves.length} sauvegarde(s), ${mo(romBytes)} de ROMs`
  );

  if (!APPLY) {
    console.log("\nAperçu seulement. Relance avec « -- --go » pour supprimer.");
    return;
  }

  let freed = 0;
  for (const m of games) freed += await drop(ROM_DIR, m.cartridge?.file);
  for (const s of saves) {
    freed += await drop(SAVE_DIR, s.file);
    freed += await drop(SAVE_DIR, s.thumb);
  }

  await CollectionSave.deleteMany({ media: { $in: ids } });
  await CollectionProgress.deleteMany({ media: { $in: ids } });
  await CollectionThread.deleteMany({ media: { $in: ids } });
  // Les cartes du fil social qui renvoyaient à ces titres n'ont plus où aller.
  for (const m of games)
    await removeActivity({ "meta.slug": m.slug, type: /^collection_/ });
  await CollectionMedia.deleteMany({ _id: { $in: ids } });

  console.log(`\n✅ ${games.length} jeu(x) DS retiré(s) — ${mo(freed)} libérés sur le disque.`);
}

run()
  .catch((err) => {
    console.error("❌", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
