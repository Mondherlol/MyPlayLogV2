import "dotenv/config";
import mongoose from "mongoose";
import { planArcadeBackfill, runArcadeBackfill } from "../lib/arcadeBackfill.js";

// ======================================================================
//  Rattrapage : créditer les blind tests joués AVANT l'arcade.
// ======================================================================
//   npm run backfill:arcade          (aperçu, n'écrit rien)
//   npm run backfill:arcade -- --go  (applique)
//
// Le calcul vit dans lib/arcadeBackfill.js, partagé avec le bouton du panel
// admin (onglet Récompenses) : les deux chemins donnent le même résultat.
// Rejouable sans risque — voir la lib pour le détail.

const APPLY = process.argv.includes("--go");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  const rows = await planArcadeBackfill();
  const pending = rows.filter((r) => r.missing > 0);

  for (const r of rows) {
    if (r.missing <= 0) {
      console.log(
        `↷ ${r.username.padEnd(18)} à jour (${r.scoredTotal} marqués, ${r.already} crédités)`
      );
      continue;
    }
    console.log(
      `＋ ${r.username.padEnd(18)} +${String(r.missing).padStart(6)} pts  ` +
        `(${r.games} partie${r.games > 1 ? "s" : ""}, ${r.scoredTotal} marqués, ` +
        `${r.already} déjà crédités, solde ${r.points} → ${r.points + r.missing})`
    );
  }

  const totalGiven = pending.reduce((a, r) => a + r.missing, 0);
  if (APPLY) await runArcadeBackfill(pending);

  console.log(
    `\n${APPLY ? "✅ Appliqué" : "👀 Aperçu"} : ${pending.length} joueur${
      pending.length > 1 ? "s" : ""
    } à créditer, ${totalGiven} points au total.`
  );
  if (!APPLY && pending.length)
    console.log("   Relance avec --go pour écrire : npm run backfill:arcade -- --go");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Backfill échoué:", err);
  process.exit(1);
});
