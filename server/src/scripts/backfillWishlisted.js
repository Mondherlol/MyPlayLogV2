import "dotenv/config";
import mongoose from "mongoose";
import UserGame from "../models/UserGame.js";
import Activity from "../models/Activity.js";

// ======================================================================
//  Rattrapage : marquer les jeux passés par la wishlist AVANT le drapeau.
// ======================================================================
//   npm run backfill:wishlisted          (aperçu, n'écrit rien)
//   npm run backfill:wishlisted -- --go  (applique)
//
// UserGame.wasWishlisted est né avec les missions « Souhait exaucé » : les
// entrées créées avant ne l'ont pas. On le reconstitue de deux façons —
//   1. les jeux ENCORE en wishlist (évident) ;
//   2. les jeux qui l'ont QUITTÉE, retrouvés dans le journal du fil, qui garde
//      chaque changement de statut ({ kind: "status", from: "wishlist" }).
// Ce qui échappe aux deux (wishlist quittée avant le journal du fil) reste
// perdu — sans trace en base, il n'y a rien à retrouver.
//
// Rejouable sans risque : on n'écrit que des drapeaux à true, jamais l'inverse.

const APPLY = process.argv.includes("--go");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  // 1. Encore dans la wishlist.
  const stillWishlist = { status: "wishlist", wasWishlisted: { $ne: true } };
  const nStill = await UserGame.countDocuments(stillWishlist);
  console.log(`① ${nStill} entrée(s) encore en wishlist`);

  // 2. Sorties de la wishlist, d'après le journal du fil.
  const rows = await Activity.find({
    type: "game_update",
    "meta.changes": { $elemMatch: { kind: "status", from: "wishlist" } },
  })
    .select("actor game")
    .lean();
  // Une paire (joueur, jeu) peut revenir plusieurs fois : on dédoublonne.
  const pairs = new Map();
  for (const a of rows) {
    if (!a.actor || a.game == null) continue;
    pairs.set(`${a.actor}:${a.game}`, { user: a.actor, gameId: a.game });
  }
  console.log(`② ${pairs.size} jeu(x) sorti(s) de la wishlist dans le fil`);

  if (!APPLY) {
    console.log("\n👀 Aperçu — relance avec --go pour écrire :");
    console.log("   npm run backfill:wishlisted -- --go");
    await mongoose.disconnect();
    return;
  }

  const a = await UserGame.updateMany(stillWishlist, { $set: { wasWishlisted: true } });
  let b = 0;
  for (const { user, gameId } of pairs.values()) {
    const r = await UserGame.updateOne(
      { user, gameId, wasWishlisted: { $ne: true } },
      { $set: { wasWishlisted: true } }
    );
    b += r.modifiedCount || 0;
  }

  console.log(
    `\n✅ Appliqué : ${a.modifiedCount} + ${b} = ${a.modifiedCount + b} entrée(s) marquées.`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Backfill échoué:", err);
  process.exit(1);
});
