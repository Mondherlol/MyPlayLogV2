import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Panorama from "../models/Panorama.js";

// ======================================================================
//  Transfert du catalogue GeoGamer entre deux bases (local ↔ VPS)
// ======================================================================
//   npm run geo:export [-- fichier.json]   → dump la collection Panorama
//   npm run geo:import [-- fichier.json]   → recharge le dump (upsert)
//
// Pourquoi ce script plutôt que mongodump : il ne dépend d'AUCUN outil externe
// (mongodump/mongorestore ne sont pas toujours dans le PATH, encore moins dans
// le conteneur du serveur), il s'exécute avec le même node que le serveur, et
// il transfère UNIQUEMENT le catalogue — jamais l'historique de jeu (GeoSeen,
// GeoGame), qui doit rester propre à chaque base.
//
// Idempotent : l'import fait un upsert par `sourceKey` (l'identité stable d'un
// lieu chez la source). Le rejouer ne crée pas de doublon, il met à jour.
//
// Les chemins d'image stockés sont RELATIFS (« /uploads/… ») : rien n'est lié
// à un domaine, donc le même dump vaut en local comme en prod — à condition
// que les fichiers images soient présents au même endroit (cf. la doc de
// déploiement : les dossiers uploads/panoramas et uploads/geomaps se copient
// séparément dans le volume du VPS).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "../../geo-catalog.json");

const argv = process.argv.slice(2);
const mode = argv.includes("--export")
  ? "export"
  : argv.includes("--import")
    ? "import"
    : null;
// Le premier argument qui n'est pas un drapeau est le chemin du fichier.
const fileArg = argv.find((a) => !a.startsWith("--"));
const FILE = fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_FILE;

async function run() {
  if (!mode) {
    console.error("Usage : geoCatalog.js --export|--import [fichier.json]");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog");
  console.log("✅ Connecté à MongoDB");

  if (mode === "export") {
    const docs = await Panorama.find({}).lean();
    // On retire _id et __v : l'import réinsère par sourceKey, et un _id figé
    // pourrait entrer en collision avec des documents existants côté cible.
    const clean = docs.map(({ _id, __v, ...rest }) => rest);
    fs.writeFileSync(FILE, JSON.stringify(clean));
    const mb = (fs.statSync(FILE).size / 1048576).toFixed(1);
    console.log(`📤 ${clean.length} lieux exportés → ${FILE} (${mb} Mo)`);
  } else {
    if (!fs.existsSync(FILE)) {
      console.error(`❌ Fichier introuvable : ${FILE}`);
      process.exit(1);
    }
    const list = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!Array.isArray(list)) {
      console.error("❌ Le dump n'est pas un tableau.");
      process.exit(1);
    }
    const ops = list
      .filter((d) => d.sourceKey)
      .map((d) => ({
        updateOne: {
          filter: { sourceKey: d.sourceKey },
          update: { $set: d },
          upsert: true,
        },
      }));
    let upserted = 0;
    let modified = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const res = await Panorama.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      upserted += res.upsertedCount || 0;
      modified += res.modifiedCount || 0;
    }
    const jouables = await Panorama.countDocuments({
      active: true,
      gameId: { $ne: null },
    });
    console.log(
      `📥 ${ops.length} lieux importés (${upserted} créés, ${modified} mis à jour).`
    );
    console.log(`🎮 Catalogue jouable côté base : ${jouables} lieux`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Échec :", err.message);
  process.exit(1);
});
