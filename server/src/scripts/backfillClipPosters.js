import "dotenv/config";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import GameMedia from "../models/GameMedia.js";
import { makeVideoPoster } from "../lib/videoEdit.js";

// ======================================================================
//  Rattrapage : l'image d'attente des clips déjà publiés
// ======================================================================
//   npm run backfill:clip-posters          (aperçu, n'écrit rien)
//   npm run backfill:clip-posters -- --go  (fabrique et enregistre)
//
// Depuis peu, tout clip envoyé sur un mur média repart avec une image tirée de
// son propre fichier (voir lib/videoEdit.js) : c'est elle que le fil affiche
// pendant que la vidéo se charge, à la place du rectangle noir. Les clips
// publiés AVANT n'en ont pas — et ce sont justement ceux qu'on croise le plus
// dans le fil.
//
// Ce script relit les fichiers déjà sur le disque : rien n'est retéléchargé,
// aucune vidéo n'est ré-encodée. Rejouable sans risque — un clip qui a déjà sa
// vignette est sauté, et un fichier disparu (post ancien, purge) est signalé
// puis laissé tel quel.

const APPLY = process.argv.includes("--go");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "../../uploads/gamemedia");

// L'URL d'un média pointe vers /uploads/gamemedia/<fichier> : on remonte au
// fichier sur le disque, et on refabrique l'URL de la vignette sur le MÊME
// hôte que la vidéo (le script ne connaît pas le domaine public).
const fileOf = (url) => {
  const m = /\/uploads\/gamemedia\/([^/?#]+)$/.exec(String(url || ""));
  return m ? decodeURIComponent(m[1]) : null;
};

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  const posts = await GameMedia.find({ "media.kind": "video" }).select("media createdAt");
  const todo = posts.filter((p) =>
    (p.media || []).some((m) => m.kind === "video" && !m.thumbnail)
  );

  const clips = todo.reduce(
    (n, p) => n + p.media.filter((m) => m.kind === "video" && !m.thumbnail).length,
    0
  );
  console.log(`${posts.length} post(s) à clip, ${clips} clip(s) sans vignette\n`);
  if (!clips) {
    console.log("Rien à faire : tout le monde a son image d'attente.");
    return;
  }
  if (!APPLY) {
    console.log("Aperçu seulement — relance avec `-- --go` pour écrire.\n");
  }

  let made = 0;
  let missing = 0;
  let failed = 0;

  for (const post of todo) {
    let touched = false;
    for (const m of post.media) {
      if (m.kind !== "video" || m.thumbnail) continue;
      const name = fileOf(m.url);
      const src = name ? path.join(MEDIA_DIR, name) : null;
      if (!src || !fs.existsSync(src)) {
        console.log(`· ${post._id} — fichier introuvable (${name || m.url})`);
        missing++;
        continue;
      }
      if (!APPLY) {
        console.log(`· ${post._id} — ${name}`);
        made++;
        continue;
      }
      const outName = `${path.parse(name).name}-poster.jpg`;
      const out = await makeVideoPoster({
        videoPath: src,
        outPath: path.join(MEDIA_DIR, outName),
      });
      if (!out) {
        console.log(`· ${post._id} — ffmpeg n'a rien tiré de ${name}`);
        failed++;
        continue;
      }
      m.thumbnail = m.url.replace(/[^/]+$/, encodeURIComponent(outName));
      touched = true;
      made++;
      console.log(`✅ ${post._id} — ${outName}`);
    }
    if (touched) await post.save();
  }

  console.log(
    `\n${APPLY ? "Terminé" : "Aperçu"} : ${made} vignette(s)` +
      `${missing ? `, ${missing} fichier(s) absent(s)` : ""}` +
      `${failed ? `, ${failed} échec(s)` : ""}`
  );
}

run()
  .catch((e) => {
    console.error("❌", e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
