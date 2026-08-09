import "dotenv/config";
import mongoose from "mongoose";
import crypto from "node:crypto";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { geminiJson, isGeminiConfigured } from "../lib/gemini.js";
import { getFactPool } from "../lib/quizBank.js";
import { shuffle } from "../routes/blindtest.js";

// ======================================================================
//  Remplir la banque du Grand Quiz avec Gemini
// ======================================================================
//   npm run gen:quiz                 → 30 questions + 20 suites d'emojis
//   npm run gen:quiz -- --q=60 --e=0 → 60 questions, pas d'emojis
//
// HORS LIGNE, JAMAIS PENDANT UNE PARTIE. Trois raisons, déjà posées dans
// models/QuizQuestion.js : la latence, le quota, et surtout l'impossibilité de
// relire. Ici on a tout le temps de vérifier avant que ça touche un joueur.
//
// TOUT SORT `approved: false`. Le script ne met RIEN en service : il remplit
// une file d'attente que l'onglet Quiz du panneau d'admin permet de trier.
// C'est le point non négociable de ce fichier — un modèle de langage énonce des
// faits faux avec le même aplomb que des vrais, et une question fausse tombée
// en versus vole une manche à quelqu'un.
//
// ------------------------------------------------------- ce qu'on peut réduire
// On ne demande PAS à Gemini des faits qu'IGDB connaît déjà (dates, studios,
// plateformes) : lib/quizBank.js les fabrique gratuitement et sans erreur
// possible. On lui demande ce qu'aucune API ne donne — les anecdotes, les
// coulisses, les personnages, les phrases cultes, le vocabulaire du milieu.
// C'est là qu'il apporte quelque chose, et c'est aussi là qu'il faut le relire
// le plus attentivement.

const fingerprint = (text) =>
  crypto
    .createHash("sha1")
    .update(
      String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    )
    .digest("hex");

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
}

// On fabrique par petites fournées : un prompt qui demande soixante questions
// d'un coup produit de la répétition et des réponses tronquées.
const BATCH = 10;

// ============================================================
//  Les questions
// ============================================================
const THEMES = [
  "les anecdotes de développement (crunch, projets annulés, changements de direction)",
  "les personnages secondaires et les antagonistes marquants",
  "les répliques et phrases cultes",
  "les musiques et les compositeurs",
  "l'histoire du jeu vidéo avant 2000",
  "les studios et les rachats de l'industrie",
  "les échecs commerciaux et les jeux maudits",
  "le vocabulaire et les genres (speedrun, roguelite, souls-like…)",
  "les mondes ouverts et leurs lieux emblématiques",
  "l'esport et les compétitions",
  "les jeux indépendants et leurs créateurs",
  "les consoles portables et les accessoires oubliés",
];

function questionPrompt(theme, known) {
  return `Tu écris des questions de quiz de CULTURE GÉNÉRALE JEU VIDÉO, en FRANÇAIS, pour des joueurs français passionnés.

THÈME DE CETTE FOURNÉE : ${theme}

Produis ${BATCH} questions à choix multiples.

RÈGLES ABSOLUES :
- N'écris QUE des faits dont tu es certain. En cas de doute, change de sujet.
- Pas de question sur une date de sortie, un studio développeur ou une plateforme : ces questions-là sont déjà générées automatiquement ailleurs.
- Pas de question sur un événement postérieur à 2024.
- Exactement 4 propositions, toutes plausibles, une seule correcte.
- La bonne réponse est TOUJOURS en première position du tableau "choices".
- Les 3 mauvaises propositions doivent être incontestablement fausses, jamais "presque vraies".
- Français correct, tutoiement, ton vivant mais sans familiarité forcée.
- "explain" : une phrase courte qui apprend quelque chose de plus que la réponse.
- Ne repose aucune de ces questions déjà en banque :
${known.map((t) => `  - ${t}`).join("\n") || "  (banque vide)"}

Réponds UNIQUEMENT avec ce JSON :
{"questions":[{"text":"…","choices":["bonne","fausse","fausse","fausse"],"explain":"…","difficulty":1-5,"theme":"un mot"}]}`;
}

async function genQuestions(target) {
  if (target <= 0) return { created: 0, skipped: 0 };
  // On donne au modèle un échantillon de ce qui existe déjà : sans ça il
  // repropose invariablement les mêmes dix classiques.
  const known = (
    await QuizQuestion.aggregate([{ $sample: { size: 40 } }, { $project: { text: 1 } }])
  ).map((r) => r.text);

  let created = 0;
  let skipped = 0;
  const themes = shuffle(THEMES);

  for (let i = 0; created < target && i < Math.ceil(target / BATCH) + 3; i += 1) {
    const theme = themes[i % themes.length];
    let out;
    try {
      // eslint-disable-next-line no-await-in-loop
      out = await geminiJson(questionPrompt(theme, known), { temperature: 1 });
    } catch (err) {
      console.error(`  fournée « ${theme} » : ${err.message}`);
      continue;
    }
    const list = Array.isArray(out?.questions) ? out.questions : [];
    for (const q of list) {
      if (created >= target) break;
      // Contrôle de forme AVANT insertion. Un modèle rend régulièrement trois
      // propositions au lieu de quatre, ou deux fois la même : ces
      // questions-là ne doivent même pas atteindre la file de relecture.
      if (!q?.text || !Array.isArray(q.choices) || q.choices.length !== 4) {
        skipped += 1;
        continue;
      }
      const clean = q.choices.map((c) => String(c).trim()).filter(Boolean);
      if (clean.length !== 4 || new Set(clean).size !== 4) {
        skipped += 1;
        continue;
      }
      const fp = fingerprint(q.text);
      // eslint-disable-next-line no-await-in-loop
      const exists = await QuizQuestion.exists({ fingerprint: fp });
      if (exists) {
        skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await QuizQuestion.create({
        kind: "qcm",
        text: String(q.text).trim(),
        choices: clean,
        explain: String(q.explain || "").trim(),
        difficulty: Math.min(Math.max(Number(q.difficulty) || 3, 1), 5),
        theme: String(q.theme || "").slice(0, 40),
        source: "gemini",
        approved: false, // ← la relecture est obligatoire
        fingerprint: fp,
      });
      known.push(q.text);
      created += 1;
    }
    process.stdout.write(`  ${created}/${target}\r`);
  }
  return { created, skipped };
}

// ============================================================
//  Les suites d'emojis
// ============================================================
// On propose au modèle des jeux TIRÉS DU CATALOGUE (avec leur identifiant
// IGDB) plutôt que de le laisser choisir : il n'a plus qu'à écrire les emojis,
// et on n'a aucun titre à résoudre ensuite.
function emojiPrompt(games) {
  return `Pour chacun de ces jeux vidéo, écris 4 emojis qui permettent de le DEVINER.

RÈGLES :
- 4 emojis exactement, qui décrivent l'univers, un personnage, un objet ou une mécanique du jeu.
- Ne JAMAIS utiliser d'emoji générique de jeu vidéo (🎮 🕹️ 👾) : ils ne désignent rien.
- La suite doit désigner CE jeu et pas un autre du même genre. Si tu n'as rien de spécifique, mets "skip": true.
- Pas d'emoji-lettre ni de chiffre qui épellerait le titre.

Jeux :
${games.map((g) => `  ${g.id} — ${g.name}`).join("\n")}

Réponds UNIQUEMENT avec ce JSON :
{"items":[{"id":123,"emojis":["🗡️","🛡️","🌄","🪂"],"difficulty":1-5,"skip":false}]}`;
}

async function genEmojis(target) {
  if (target <= 0) return { created: 0, skipped: 0 };
  const pool = await getFactPool();
  if (!pool.length) {
    console.log("  vivier IGDB vide (clés Twitch absentes ?) — emojis sautés.");
    return { created: 0, skipped: 0 };
  }
  const have = new Set(
    (await QuizEmoji.find().select("gameId").lean()).map((r) => r.gameId)
  );
  const todo = shuffle(pool.filter((g) => !have.has(g.id)));

  let created = 0;
  let skipped = 0;
  for (let i = 0; created < target && i * BATCH < todo.length; i += 1) {
    const chunk = todo.slice(i * BATCH, (i + 1) * BATCH);
    if (!chunk.length) break;
    let out;
    try {
      // eslint-disable-next-line no-await-in-loop
      out = await geminiJson(emojiPrompt(chunk), { temperature: 1 });
    } catch (err) {
      console.error(`  fournée emojis : ${err.message}`);
      continue;
    }
    for (const item of Array.isArray(out?.items) ? out.items : []) {
      if (created >= target) break;
      const gameId = Number(item?.id);
      const list = Array.isArray(item?.emojis)
        ? item.emojis.map((e) => String(e).trim()).filter(Boolean)
        : [];
      // Le modèle a le droit de renoncer, et on l'y encourage : mieux vaut pas
      // d'énigme qu'une énigme qui ne désigne rien.
      if (item?.skip || list.length < 3 || !chunk.some((g) => g.id === gameId)) {
        skipped += 1;
        continue;
      }
      const game = chunk.find((g) => g.id === gameId);
      // eslint-disable-next-line no-await-in-loop
      await QuizEmoji.updateOne(
        { gameId },
        {
          $setOnInsert: {
            gameId,
            name: game.name,
            emojis: list.slice(0, 5),
            difficulty: Math.min(Math.max(Number(item.difficulty) || 3, 1), 5),
            source: "gemini",
            approved: false, // ← relecture obligatoire, ici aussi
          },
        },
        { upsert: true }
      );
      created += 1;
    }
    process.stdout.write(`  ${created}/${target}\r`);
  }
  return { created, skipped };
}

async function main() {
  if (!isGeminiConfigured()) {
    console.error("GEMINI_API_KEY manquant dans server/.env.");
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI manquant dans server/.env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Base connectée.\n");

  const wantQ = arg("q", 30);
  const wantE = arg("e", 20);

  console.log(`— Questions (objectif ${wantQ}) —`);
  const q = await genQuestions(wantQ);
  console.log(`  ${q.created} créée(s), ${q.skipped} écartée(s)          `);

  console.log(`\n— Emojis (objectif ${wantE}) —`);
  const e = await genEmojis(wantE);
  console.log(`  ${e.created} créée(s), ${e.skipped} écartée(s)          `);

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
