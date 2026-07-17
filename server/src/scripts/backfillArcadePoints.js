import "dotenv/config";
import mongoose from "mongoose";
import BlindTest from "../models/BlindTest.js";
import PointEntry from "../models/PointEntry.js";
import User from "../models/User.js";
import { grantPoints } from "../lib/points.js";

// ======================================================================
//  Rattrapage : créditer les blind tests joués AVANT l'arcade.
// ======================================================================
//   npm run backfill:arcade          (aperçu, n'écrit rien)
//   npm run backfill:arcade -- --go  (applique)
//
// L'arcade ne crédite que les parties finies depuis sa mise en ligne : sans ce
// script, un joueur avec 1452 points au classement en verrait 0 dans son
// porte-monnaie.
//
// Rejouable sans risque : on ne calcule PAS « combien ajouter » mais « combien
// il DEVRAIT y avoir », et on ne comble que l'écart. Relancer deux fois ne
// double donc rien, et une exécution interrompue se termine proprement.
// Les points déjà dépensés en caisses ne faussent rien : on compare des GAINS
// d'origine blind test, jamais le solde courant.

const APPLY = process.argv.includes("--go");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  // Ce que chaque joueur a marqué au total (= le score cumulé du classement).
  const scored = await BlindTest.aggregate([
    { $group: { _id: "$user", total: { $sum: "$score" }, games: { $sum: 1 } } },
  ]);

  // Ce qui lui a DÉJÀ été crédité au titre du blind test (parties récentes
  // créditées en direct + un éventuel rattrapage précédent).
  const granted = await PointEntry.aggregate([
    { $match: { source: { $in: ["blindtest", "backfill"] } } },
    { $group: { _id: "$user", total: { $sum: "$amount" } } },
  ]);
  const grantedBy = new Map(granted.map((g) => [String(g._id), g.total]));

  const users = await User.find({ _id: { $in: scored.map((s) => s._id) } })
    .select("username points")
    .lean();
  const userBy = new Map(users.map((u) => [String(u._id), u]));

  let touched = 0;
  let totalGiven = 0;

  for (const row of scored) {
    const id = String(row._id);
    const u = userBy.get(id);
    if (!u) continue; // compte supprimé, parties orphelines
    const already = grantedBy.get(id) || 0;
    const missing = row.total - already;

    if (missing <= 0) {
      console.log(
        `↷ ${u.username.padEnd(18)} à jour (${row.total} marqués, ${already} crédités)`
      );
      continue;
    }

    console.log(
      `＋ ${u.username.padEnd(18)} +${String(missing).padStart(6)} pts  ` +
        `(${row.games} partie${row.games > 1 ? "s" : ""}, ${row.total} marqués, ` +
        `${already} déjà crédités, solde ${u.points || 0} → ${(u.points || 0) + missing})`
    );
    touched++;
    totalGiven += missing;

    if (APPLY) {
      await grantPoints(row._id, missing, "backfill", {
        games: row.games,
        scoredTotal: row.total,
      });
    }
  }

  console.log(
    `\n${APPLY ? "✅ Appliqué" : "👀 Aperçu"} : ${touched} joueur${
      touched > 1 ? "s" : ""
    } à créditer, ${totalGiven} points au total.`
  );
  if (!APPLY && touched)
    console.log("   Relance avec --go pour écrire : npm run backfill:arcade -- --go");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Backfill échoué:", err);
  process.exit(1);
});
