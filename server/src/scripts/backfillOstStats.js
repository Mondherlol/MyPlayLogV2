import "dotenv/config";
import mongoose from "mongoose";
import CustomOst from "../models/CustomOst.js";
import { ytPlaylistTracks } from "../lib/ostScrape.js";

// ======================================================================
//  Rattrapage : vues + durée des pistes d'OST déjà scrapées
// ======================================================================
// Les pistes enregistrées avant l'ajout de `views`/`durationSec` n'ont ni
// l'un ni l'autre. Or c'est le nombre de vues qui permet au blind test de ne
// tirer que dans les morceaux réellement écoutés (cf. `pickTrack` dans
// routes/blindtest.js) : sans lui, il retombe sur l'ancien tirage au hasard
// dans toute la playlist, jingles de menu compris.
//
// On re-scrape donc chaque playlist UNE FOIS (une requête HTTP par playlist,
// pas par piste) et on recopie les deux champs. Idempotent : relançable sans
// dommage, il ne touche que ce qui manque.
//
//   node src/scripts/backfillOstStats.js            (ce qui manque)
//   node src/scripts/backfillOstStats.js --all      (tout, même le déjà rempli)
//   node src/scripts/backfillOstStats.js --limit 50

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || Infinity;
// Politesse envers YouTube : une playlist à la fois, avec une pause.
const PAUSE_MS = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog");

// Les playlists concernées : celles qui ont au moins une piste sans chiffres.
const match = { source: "auto", playlistId: { $ne: null } };
if (!ALL) match.views = null;
const playlists = await CustomOst.distinct("playlistId", match);
console.log(`${playlists.length} playlist(s) à traiter${ALL ? " (--all)" : ""}.`);

let done = 0;
let updated = 0;
let empty = 0;

for (const playlistId of playlists) {
  if (done >= LIMIT) break;
  done += 1;
  try {
    const tracks = await ytPlaylistTracks(playlistId);
    if (!tracks.length) {
      empty += 1;
      console.log(`  [${done}/${playlists.length}] ${playlistId} — aucune piste lue`);
      await sleep(PAUSE_MS);
      continue;
    }
    const ops = tracks
      .filter((t) => t.views != null || t.durationSec != null)
      .map((t) => ({
        updateOne: {
          filter: { playlistId, videoId: t.videoId },
          update: { $set: { views: t.views ?? null, durationSec: t.durationSec ?? null } },
        },
      }));
    if (ops.length) {
      const res = await CustomOst.bulkWrite(ops, { ordered: false });
      updated += res.modifiedCount || 0;
    }
    console.log(
      `  [${done}/${playlists.length}] ${playlistId} — ${ops.length} piste(s) chiffrée(s)`
    );
  } catch (err) {
    console.error(`  [${done}/${playlists.length}] ${playlistId} — ${err.message}`);
  }
  await sleep(PAUSE_MS);
}

console.log(
  `\nTerminé : ${updated} piste(s) mise(s) à jour, ${empty} playlist(s) illisible(s).`
);
await mongoose.disconnect();
process.exit(0);
