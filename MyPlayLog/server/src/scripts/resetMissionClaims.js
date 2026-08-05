import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import PointEntry from "../models/PointEntry.js";
import MissionAward from "../models/MissionAward.js";

dotenv.config();

// ======================================================================
//  Remet les missions déjà « débloquées » en « à récupérer ».
// ======================================================================
// La première version des missions créditait les points automatiquement dès
// qu'une mission était remplie — y compris rétroactivement, si bien que des
// badges apparaissaient gagnés sans que le joueur ait rien réclamé. Les points
// se récupèrent désormais à la main (bouton « Récupérer »).
//
// Ce script répare l'existant : il repasse les attributions en statut "ready"
// ET reprend les points crédités automatiquement (sinon ils seraient comptés
// deux fois quand le joueur viendra les chercher). Les lignes de grand livre
// correspondantes sont supprimées pour que le solde reste le reflet exact du
// ledger.
//
//   node src/scripts/resetMissionClaims.js          → APERÇU (n'écrit rien)
//   node src/scripts/resetMissionClaims.js --apply  → applique
//
// Rejouable : une fois les attributions en "ready" et les lignes "mission"
// supprimées, un second passage ne trouve plus rien à faire.

const APPLY = process.argv.includes("--apply");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(APPLY ? "== APPLICATION ==" : "== APERÇU (rien ne sera écrit) ==");

  // Points crédités par l'ancien octroi automatique, par joueur.
  const ledger = await PointEntry.find({ source: "mission" }).lean();
  const byUser = new Map();
  for (const e of ledger) {
    const k = String(e.user);
    byUser.set(k, (byUser.get(k) || 0) + (e.amount || 0));
  }

  const awards = await MissionAward.countDocuments({});
  console.log(`Attributions de missions      : ${awards}`);
  console.log(`Lignes de points « mission »  : ${ledger.length}`);
  console.log(`Joueurs concernés             : ${byUser.size}`);

  for (const [userId, total] of byUser) {
    const u = await User.findById(userId).select("username points").lean();
    if (!u) continue;
    // On ne descend jamais sous zéro (le solde a pu être dépensé entre-temps).
    const take = Math.min(total, u.points || 0);
    console.log(
      `  ${u.username} : solde ${u.points} → ${u.points - take}` +
        (take < total ? `  (reprise plafonnée : ${total} crédités, déjà dépensés)` : "")
    );
    if (APPLY && take > 0) {
      await User.updateOne(
        { _id: userId },
        { $inc: { points: -take } },
        { timestamps: false }
      );
    }
  }

  if (APPLY) {
    const r = await MissionAward.updateMany(
      {},
      { $set: { status: "ready", points: 0, claimedAt: null } }
    );
    const d = await PointEntry.deleteMany({ source: "mission" });
    console.log(`\nAttributions repassées en « à récupérer » : ${r.modifiedCount}`);
    console.log(`Lignes de grand livre supprimées          : ${d.deletedCount}`);
    console.log("Terminé — les récompenses attendent d'être réclamées.");
  } else {
    console.log("\nRien écrit. Relance avec --apply pour appliquer.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("resetMissionClaims error:", err);
  await mongoose.disconnect();
  process.exit(1);
});
