/**
 * Remplit l'étagère de la page Collection.
 *
 *   npm run seed:collection            (depuis /server)
 *   npm run seed:collection -- --force  → ré-enrichit ce qui existe déjà
 *
 * Chaque entrée n'est qu'une URL + quelques choix de curation : le reste
 * (synopsis, affiche, casting, liste des épisodes) est récupéré à la volée
 * par lib/collection.js auprès de YouTube, TVmaze et Wikipédia/Wikidata.
 * Rien n'est copié dans ce fichier — il ne contient que des liens.
 *
 * Règle du catalogue : uniquement des contenus regardables librement là où
 * ils sont hébergés (chaînes officielles des éditeurs, diffusions
 * promotionnelles, œuvres du domaine public). Le champ `licence` l'affiche
 * en clair sur la jaquette.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CollectionMedia from "../models/CollectionMedia.js";
import { buildMedia, localizeCast } from "../lib/collection.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";

const CATALOG = [
  {
    slug: "sonic-x",
    title: "Sonic X",
    url: "https://www.youtube.com/watch?v=9CGih4gMRlk&list=PLPklMlGd9gwLRxf-3TJ-6GWsKUpgtQpss",
    kind: "series",
    format: "dvd",
    licence: "official",
    animated: true,
    franchise: "Sonic",
    color: "#2f6bf2",
    tagline: "Le hérisson supersonique débarque chez les humains.",
    // TVmaze ne renseigne aucun genre pour cette série : on les pose.
    genres: ["Animation", "Aventure", "Action"],
    // Indices de recherche : le titre exact des bases externes.
    tvmazeQuery: "Sonic X",
    wikiTitle: "Sonic X",
    games: [{ igdbId: 1029, name: "Sonic Adventure 2" }],
    order: 0,
    featured: true,
  },
  {
    slug: "super-mario-peach-1986",
    title: "Super Mario Bros. : La grande mission pour sauver la princesse Peach",
    url: "https://www.youtube.com/watch?v=gFCCRxkeiIk",
    kind: "film",
    format: "dvd",
    licence: "official",
    animated: true,
    franchise: "Super Mario",
    color: "#e0342b",
    tagline: "Le tout premier film Mario, sorti au Japon en 1986.",
    wikiTitle: "Super Mario Bros.: Peach-Hime Kyushutsu Dai Sakusen!",
    games: [{ igdbId: 358, name: "Super Mario Bros." }],
    order: 1,
    featured: true,
  },
];

const force = process.argv.includes("--force");

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("✅ Connecté à MongoDB");

  for (const entry of CATALOG) {
    const existing = await CollectionMedia.findOne({ slug: entry.slug }).lean();
    if (existing && !force) {
      console.log(`⏭️  ${entry.title} — déjà en base (--force pour ré-enrichir)`);
      continue;
    }
    process.stdout.write(`📼 ${entry.title} … `);
    try {
      const built = await buildMedia(entry);
      built.cast = await localizeCast(built);
      await CollectionMedia.findOneAndUpdate({ slug: built.slug }, built, {
        upsert: true,
        setDefaultsOnInsert: true,
      });
      console.log(
        `ok — ${built.episodes.length} épisode(s), ${built.cast.length} au casting` +
          ` [${built.sources.join(", ")}]`
      );
    } catch (err) {
      console.log(`échec : ${err.message}`);
    }
  }

  await mongoose.disconnect();
  console.log("🎬 Étagère prête.");
}

run().catch((err) => {
  console.error("❌ seed:collection", err);
  process.exit(1);
});
