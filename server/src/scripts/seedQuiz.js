import "dotenv/config";
import mongoose from "mongoose";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { seedFromFiles } from "../lib/quizSeed.js";

// ======================================================================
//  npm run seed:quiz — import du contenu local dans la banque
// ======================================================================
// Ce script n'est plus qu'une PORTE D'ENTRÉE : tout le travail vit dans
// lib/quizSeed.js, que l'onglet Quiz du panneau d'admin appelle aussi. Les deux
// chemins font donc rigoureusement la même chose.
//
// L'interface reste le moyen normal de remplir la banque ; ce script existe
// pour les cas où l'on préfère la ligne de commande (premier déploiement,
// débogage, réimport en masse).
async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI manquant dans server/.env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Base connectée.\n");

  let last = "";
  const out = await seedFromFiles({
    onProgress: ({ step, done, total }) => {
      const line = `  ${step} : ${done}/${total}`;
      if (line !== last) {
        process.stdout.write(line + "\r");
        last = line;
      }
    },
  });

  console.log(
    `\n— Questions — ${out.questions.total} lues · ${out.questions.created} créées · ${out.questions.updated} mises à jour`
  );
  for (const p of out.problems) console.log(`  ⚠ ${p}`);

  console.log(
    `— Emojis — ${out.emojis.total} lus · ${out.emojis.created} créés · ${out.emojis.updated} mis à jour`
  );
  if (out.unresolved.length) {
    console.log(`  ⚠ ${out.unresolved.length} titres non résolus (à corriger dans le JSON) :`);
    for (const u of out.unresolved) console.log(`      ${u}`);
  }

  const approved = await QuizQuestion.countDocuments({ approved: true });
  const pending = await QuizQuestion.countDocuments({ approved: false });
  const emo = await QuizEmoji.countDocuments({ approved: true });
  console.log(
    `\nBanque : ${approved} question(s) jouable(s), ${emo} emoji(s), ${pending} en attente de relecture.`
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("seed:quiz a échoué :", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
