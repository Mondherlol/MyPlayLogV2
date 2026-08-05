import "dotenv/config";
import mongoose from "mongoose";
import CollectionMedia from "../models/CollectionMedia.js";
import { makeThumbs } from "../lib/comicArchive.js";

// ======================================================================
//  Rattrapage : les vignettes des volumes déjà importés
// ======================================================================
//   npm run backfill:comic-thumbs          (aperçu, n'écrit rien)
//   npm run backfill:comic-thumbs -- --go  (fabrique et enregistre)
//
// Les planches-contact (fiche du volume, panneau du lecteur à plat) affichaient
// les planches en pleine définition : cent scans de deux mégaoctets décodés
// pour être montrés larges de cent pixels, et l'onglet à genoux. Depuis, chaque
// import fabrique une vignette de 240 px par planche (voir lib/comicArchive.js).
//
// Les titres importés AVANT n'en ont pas. Ce script les leur donne, en relisant
// les planches déjà sur le disque — rien n'est retéléchargé, rien n'est
// réextrait, et les planches elles-mêmes ne sont pas touchées.
//
// Rejouable sans risque : une planche qui a déjà sa vignette est sautée, et une
// vignette qui échoue laisse simplement la planche telle quelle (l'affichage
// retombe dessus, comme aujourd'hui).

const APPLY = process.argv.includes("--go");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  const comics = await CollectionMedia.find({ kind: "comic" }).select("slug title pages");
  const todo = comics.filter((m) => (m.pages || []).some((p) => !p.thumb));

  console.log(`${comics.length} volume(s) de papier, ${todo.length} à rattraper\n`);
  if (!todo.length) {
    console.log("Rien à faire : tout le monde a ses vignettes.");
    return;
  }

  for (const media of todo) {
    const missing = media.pages.filter((p) => !p.thumb).length;
    if (!APPLY) {
      console.log(`· ${media.title} — ${missing} vignette(s) à fabriquer`);
      continue;
    }

    process.stdout.write(`· ${media.title} — ${missing} vignette(s)… `);
    // `makeThumbs` remplit `thumb` en place sur les planches qui n'en ont pas ;
    // les sous-documents mongoose se laissent modifier comme des objets, mais
    // il faut le dire au document pour qu'il enregistre le tableau.
    await makeThumbs(media.pages, media.slug);
    media.markModified("pages");
    await media.save();
    const done = media.pages.filter((p) => p.thumb).length;
    console.log(`ok (${done}/${media.pages.length})`);
  }

  if (!APPLY) console.log("\n(aperçu — relance avec `-- --go` pour appliquer)");
}

run()
  .catch((err) => {
    console.error("❌", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
