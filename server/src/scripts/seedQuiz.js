import "dotenv/config";
import mongoose from "mongoose";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { igdbQuery } from "../lib/igdb.js";
import { IMG } from "../routes/blindtest.js";

// ======================================================================
//  Seed du Grand Quiz : les questions et les emojis écrits à la main
// ======================================================================
//   npm run seed:quiz
//
// Rejouable sans risque. Les deux jeux de données sont UPSERTÉS :
//
//   • les questions, sur l'empreinte de leur texte — relancer le script met à
//     jour une explication corrigée ou une difficulté réajustée, sans jamais
//     créer de doublon ni toucher aux compteurs de terrain (timesAsked…) ;
//   • les emojis, sur le gameId résolu.
//
// Les questions et emojis venus de Gemini ou saisis dans l'admin ne sont
// JAMAIS touchés : le filtre d'upsert porte sur `source: "seed"`. On peut donc
// relancer le seed sur une base vivante sans écraser le travail de relecture.
//
// ---------------------------------------------------- la résolution des titres
// Le fichier d'emojis désigne les jeux par leur NOM (écrire des identifiants
// IGDB à la main serait intenable). Le script les résout donc par recherche
// IGDB, une fois, et signale en fin d'exécution tous les titres qu'il n'a pas
// su placer — ce sont ceux qu'il faut corriger dans le JSON.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");

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

function readJson(name) {
  const raw = fs.readFileSync(path.join(DATA_DIR, name), "utf8");
  return JSON.parse(raw);
}

// ------------------------------------------------------------------ questions
async function seedQuestions() {
  const { questions } = readJson("quizQuestions.fr.json");
  let created = 0;
  let updated = 0;
  const problems = [];

  for (const q of questions) {
    // Garde-fous : une question mal formée dans le JSON doit être signalée, pas
    // insérée. Une réponse manquante produirait une manche impossible.
    if (!q.text) {
      problems.push("question sans texte");
      continue;
    }
    if (q.kind === "truefalse") {
      if (typeof q.answer !== "boolean") {
        problems.push(`vrai/faux sans réponse : « ${q.text} »`);
        continue;
      }
    } else if (!Array.isArray(q.choices) || q.choices.length < 2) {
      problems.push(`QCM sans propositions : « ${q.text} »`);
      continue;
    } else if (new Set(q.choices).size !== q.choices.length) {
      problems.push(`QCM avec une proposition en double : « ${q.text} »`);
      continue;
    }

    const fp = fingerprint(q.text);
    const res = await QuizQuestion.updateOne(
      { fingerprint: fp },
      {
        $set: {
          kind: q.kind || "qcm",
          text: q.text,
          choices: q.kind === "truefalse" ? [] : q.choices,
          answer: q.kind === "truefalse" ? q.answer : null,
          explain: q.explain || "",
          difficulty: q.difficulty || 3,
          theme: q.theme || "",
          gameId: q.gameId || null,
          source: "seed",
          // Le seed est relu par construction : il part approuvé, contrairement
          // à tout ce qui sort d'un modèle de langage.
          approved: true,
          fingerprint: fp,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  return { created, updated, problems, total: questions.length };
}

// -------------------------------------------------------------------- emojis
// Résolution des titres par lots. IGDB n'a pas de recherche « plusieurs noms
// d'un coup » : on interroge donc titre par titre, mais seulement pour ceux
// qu'on n'a pas déjà en base (une relance du seed ne recherche rien).
async function resolveGame(name) {
  const safe = String(name).replace(/"/g, "");
  try {
    const raw = await igdbQuery(
      "games",
      `search "${safe}"; fields id,name,cover.image_id,game_type,version_parent;` +
        " where version_parent = null & game_type = (0,4,8,9,10,11); limit 5;"
    );
    if (!raw.length) return null;
    // La recherche IGDB classe par pertinence, mais un titre court (« Portal »)
    // remonte parfois d'abord une suite ou un portage. On préfère la
    // correspondance EXACTE quand elle existe.
    const exact = raw.find((g) => g.name?.toLowerCase() === safe.toLowerCase());
    const g = exact || raw[0];
    return {
      gameId: g.id,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    };
  } catch (err) {
    console.error(`  IGDB « ${name} » :`, err.message);
    return null;
  }
}

async function seedEmojis() {
  const { emojis } = readJson("quizEmojis.fr.json");
  let created = 0;
  let updated = 0;
  const unresolved = [];

  // Ce qui est déjà résolu : on ne réinterroge pas IGDB pour rien.
  const known = new Map(
    (await QuizEmoji.find({ source: "seed" }).select("gameId name").lean()).map((r) => [
      String(r.name || "").toLowerCase(),
      r.gameId,
    ])
  );

  for (const e of emojis) {
    if (!e.game || !Array.isArray(e.emojis) || e.emojis.length < 3) {
      unresolved.push(`${e.game || "?"} (moins de 3 emojis)`);
      continue;
    }
    let gameId = known.get(String(e.game).toLowerCase()) || null;
    let name = e.game;
    if (!gameId) {
      // eslint-disable-next-line no-await-in-loop
      const found = await resolveGame(e.game);
      if (!found) {
        unresolved.push(e.game);
        continue;
      }
      gameId = found.gameId;
      name = found.name;
      // IGDB limite à 4 requêtes/seconde : on s'y tient plutôt que de se faire
      // couper au milieu du lot.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 280));
    }

    // eslint-disable-next-line no-await-in-loop
    const res = await QuizEmoji.updateOne(
      { gameId },
      {
        $set: {
          gameId,
          name,
          emojis: e.emojis,
          difficulty: e.difficulty || 3,
          source: "seed",
          approved: true,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) updated += 1;
  }
  return { created, updated, unresolved, total: emojis.length };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGODB_URI manquant dans server/.env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log("Base connectée.\n");

  console.log("— Questions —");
  const q = await seedQuestions();
  console.log(`  ${q.total} lues · ${q.created} créées · ${q.updated} mises à jour`);
  for (const p of q.problems) console.log(`  ⚠ ${p}`);

  console.log("\n— Emojis —");
  const e = await seedEmojis();
  console.log(`  ${e.total} lus · ${e.created} créés · ${e.updated} mis à jour`);
  if (e.unresolved.length) {
    console.log(`  ⚠ ${e.unresolved.length} titres non résolus (à corriger dans le JSON) :`);
    for (const u of e.unresolved) console.log(`      ${u}`);
  }

  const approved = await QuizQuestion.countDocuments({ approved: true });
  const pending = await QuizQuestion.countDocuments({ approved: false });
  console.log(
    `\nBanque : ${approved} question(s) jouable(s), ${pending} en attente de relecture.`
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("seed:quiz a échoué :", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
