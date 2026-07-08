import mongoose from "mongoose";

// Sentinelle : marque qu'on a déjà tenté le scraping auto de l'OST d'un jeu
// (même si aucune playlist trouvée) pour ne pas re-scraper à chaque ouverture.
const gameOstScrapeSchema = new mongoose.Schema(
  {
    gameId: { type: Number, required: true, unique: true },
    playlistId: { type: String, default: null },
    playlistTitle: { type: String, default: null },
    count: { type: Number, default: 0 },
    scrapedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model("GameOstScrape", gameOstScrapeSchema);
