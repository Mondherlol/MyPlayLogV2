import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";

// ======================================================================
//  Dispenser les comptes DÉJÀ INSCRITS du tour du propriétaire
// ======================================================================
//   node src/scripts/skipOnboardingForExisting.js          (aperçu, n'écrit rien)
//   node src/scripts/skipOnboardingForExisting.js --go     (applique)
//
// ⚠️ À LANCER (OU NON) AU MOMENT DE LA MISE EN LIGNE, ET C'EST UN CHOIX.
// Le parcours d'accueil se déclenche sur `onboardedAt === null` — ce que
// valent TOUS les comptes créés avant lui. Sans rien faire, chacun le verra
// une fois à sa prochaine visite : c'est une façon honnête de présenter la
// nouveauté (et l'import Steam, que beaucoup n'ont jamais remarqué).
//
// Ce script est là pour l'autre décision : réserver le parcours aux VRAIS
// nouveaux venus. Il pose la date d'inscription comme date de tour — pas
// « maintenant » : `onboardedAt` dit quand le compte a fait le tour, et
// prétendre que tout le monde l'a fait aujourd'hui rendrait le champ inutile
// le jour où l'on voudra remontrer une version mise à jour du parcours aux
// plus anciens.
//
// Rejouable sans risque : il ne touche QUE les comptes dont la date est vide,
// donc jamais quelqu'un qui a vraiment fait (ou passé) le tour.

const APPLY = process.argv.includes("--go");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log("✅ Connecté à MongoDB\n");

  const rows = await User.find({ onboardedAt: null })
    .select("username createdAt")
    .sort({ createdAt: 1 })
    .lean();

  if (!rows.length) {
    console.log("Aucun compte en attente : tout le monde a déjà fait le tour.");
    return;
  }

  for (const u of rows) {
    console.log(
      `• ${String(u.username).padEnd(20)} inscrit le ${
        u.createdAt ? new Date(u.createdAt).toISOString().slice(0, 10) : "?"
      }`
    );
  }
  console.log(`\n${rows.length} compte(s) verraient le parcours à leur prochaine visite.`);

  if (!APPLY) {
    console.log("\nAperçu seulement. Relance avec --go pour les en dispenser.");
    return;
  }

  let done = 0;
  for (const u of rows) {
    await User.updateOne(
      { _id: u._id },
      { $set: { onboardedAt: u.createdAt || new Date() } }
    );
    done += 1;
  }
  console.log(`\n✅ ${done} compte(s) dispensés du parcours.`);
}

run()
  .catch((err) => {
    console.error("❌", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
