import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CollectionMedia from "../models/CollectionMedia.js";

// ======================================================================
//  Transfert du catalogue de la Collection entre deux bases (local ↔ VPS)
// ======================================================================
//   npm run collection:export [-- --kind=comic] → dump la collection CollectionMedia
//   npm run collection:import [-- fichier.json] → recharge le dump (upsert)
//
// C'est le décalque de geoCatalog.js, et pour les mêmes raisons : aucune
// dépendance à mongodump (absent du conteneur), le même node que le serveur, et
// SEUL LE CATALOGUE voyage — jamais CollectionProgress, CollectionSave ni
// CollectionThread, qui sont l'historique propre à chaque base et n'ont aucun
// sens transplantés.
//
// Idempotent : upsert par `slug` (la clé unique du modèle). Le rejouer ne crée
// pas de doublon, il met à jour.
//
// ------------------------------------------------ le fichier de compagnie ----
// L'export écrit AUSSI, à côté du JSON, la liste des fichiers d'upload que le
// catalogue référence vraiment (jaquettes, planches de comics, cartouches).
// C'est ce qui permet à `upload-collection.bat` de n'envoyer QUE ces
// fichiers-là : sans elle, il faudrait pousser tout `uploads/` à l'aveugle,
// c'est-à-dire aussi les sauvegardes de jeu et les orphelins des imports ratés.
//
// Les chemins stockés dans les documents sont relatifs (« /uploads/… ») : rien
// n'est lié à un domaine, le même dump vaut donc en local comme en prod.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "../../collection-catalog.json");

// Les sauvegardes de jeu appartiennent au joueur, pas au catalogue : elles
// portent l'identifiant de leur propriétaire dans leur nom de fichier et
// n'auraient aucun sens dans l'autre base.
const SKIP_DIRS = ["/uploads/saves/", "/uploads/tmp/"];

const argv = process.argv.slice(2);
const mode = argv.includes("--export")
  ? "export"
  : argv.includes("--import")
    ? "import"
    : null;
const kind = (argv.find((a) => a.startsWith("--kind=")) || "").split("=")[1] || "";
const fileArg = argv.find((a) => !a.startsWith("--"));
const FILE = fileArg ? path.resolve(process.cwd(), fileArg) : DEFAULT_FILE;
// Même nom que le JSON, autre extension : les deux fichiers restent appariés
// même quand on passe un chemin à la main.
const LIST_FILE = FILE.replace(/\.json$/i, "") + "-files.txt";

// Tous les « /uploads/… » cachés quelque part dans un document, à n'importe
// quelle profondeur : une jaquette est à la racine, une planche de comic est
// dans `pages[].file`, une vignette d'épisode dans `episodes[].thumb`. Les
// chercher récursivement évite d'avoir à tenir une liste de champs à jour à
// chaque fois que le modèle gagne une image.
function collectFiles(node, out) {
  if (!node) return;
  if (typeof node === "string") {
    if (node.startsWith("/uploads/") && !SKIP_DIRS.some((d) => node.startsWith(d)))
      out.add(node.slice("/uploads/".length));
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectFiles(v, out);
    return;
  }
  if (typeof node === "object") for (const v of Object.values(node)) collectFiles(v, out);
}

async function run() {
  if (!mode) {
    console.error("Usage : collectionCatalog.js --export|--import [--kind=series|film|comic|game] [fichier.json]");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog");
  console.log("✅ Connecté à MongoDB");

  if (mode === "export") {
    const docs = await CollectionMedia.find(kind ? { kind } : {}).lean();
    // On retire _id et __v : l'import réinsère par slug, et un _id figé
    // pourrait entrer en collision avec un document existant côté cible.
    const clean = docs.map(({ _id, __v, ...rest }) => rest);
    fs.writeFileSync(FILE, JSON.stringify(clean));

    const files = new Set();
    collectFiles(clean, files);
    fs.writeFileSync(LIST_FILE, [...files].join("\n"));

    const mb = (fs.statSync(FILE).size / 1048576).toFixed(1);
    console.log(
      `📤 ${clean.length} fiches exportées${kind ? ` (${kind})` : ""} → ${path.basename(FILE)} (${mb} Mo)`
    );
    console.log(`🖼️  ${files.size} fichiers référencés → ${path.basename(LIST_FILE)}`);
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
      .filter((d) => d.slug)
      .map((d) => ({
        updateOne: { filter: { slug: d.slug }, update: { $set: d }, upsert: true },
      }));
    let upserted = 0;
    let modified = 0;
    for (let i = 0; i < ops.length; i += 500) {
      const res = await CollectionMedia.bulkWrite(ops.slice(i, i + 500), {
        ordered: false,
      });
      upserted += res.upsertedCount || 0;
      modified += res.modifiedCount || 0;
    }
    console.log(
      `📥 ${ops.length} fiches importées (${upserted} créées, ${modified} mises à jour).`
    );

    // Ce qui manque à l'arrivée. Une fiche dont la jaquette n'a pas suivi
    // s'affiche en boîte grise sans rien dire : mieux vaut le compter ici que
    // le découvrir sur l'étagère.
    const files = new Set();
    collectFiles(list, files);
    const uploads = path.join(__dirname, "../../uploads");
    const missing = [...files].filter((f) => !fs.existsSync(path.join(uploads, f)));
    if (missing.length) {
      console.log(`⚠️  ${missing.length} fichiers référencés absents de uploads/ :`);
      for (const f of missing.slice(0, 10)) console.log(`   - ${f}`);
      if (missing.length > 10) console.log(`   … et ${missing.length - 10} autres`);
    } else {
      console.log(`🖼️  Les ${files.size} fichiers référencés sont bien présents.`);
    }

    const total = await CollectionMedia.countDocuments();
    console.log(`📚 Catalogue côté base : ${total} fiches`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Échec :", err.message);
  process.exit(1);
});
