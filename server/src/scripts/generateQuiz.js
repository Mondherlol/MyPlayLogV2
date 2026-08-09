import "dotenv/config";
import mongoose from "mongoose";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { generateWithGemini } from "../lib/quizSeed.js";

// ======================================================================
//  npm run gen:quiz — fournée de contenu écrit par Gemini
// ======================================================================
//   npm run gen:quiz                 → 30 questions + 20 suites d'emojis
//   npm run gen:quiz -- --q=60 --e=0 → 60 questions, pas d'emojis
//
// Comme seedQuiz.js, ce n'est qu'une porte d'entrée : le travail vit dans
// lib/quizSeed.js, partagé avec l'onglet Quiz du panneau d'admin.
//
// TOUT SORT EN ATTENTE DE RELECTURE. Le script ne met rien en service.
function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI manquant dans server/.env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Base connectée.\n");

  const out = await generateWithGemini({
    questions: arg("q", 30),
    emojis: arg("e", 20),
    onProgress: ({ step, done, total }) =>
      process.stdout.write(`  ${step} : ${done}/${total}\r`),
  });

  console.log(`\n— Questions — ${out.questions.created} créée(s), ${out.questions.skipped} écartée(s)`);
  console.log(`— Emojis — ${out.emojis.created} créée(s), ${out.emojis.skipped} écartée(s)`);
  for (const e of out.errors) console.log(`  ⚠ ${e}`);

  const pending =
    (await QuizQuestion.countDocuments({ approved: false })) +
    (await QuizEmoji.countDocuments({ approved: false }));
  console.log(
    `\nRien n'est encore jouable : ${pending} entrée(s) attendent ta relecture` +
      " dans le panneau d'admin, onglet Quiz."
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("gen:quiz a échoué :", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
