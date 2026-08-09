import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { igdbQuery } from "./igdb.js";
import { geminiJson, isGeminiConfigured } from "./gemini.js";
import { getFactPool } from "./quizBank.js";
import { IMG, shuffle } from "../routes/blindtest.js";

// ======================================================================
//  Remplir la banque du Grand Quiz
// ======================================================================
// Ce fichier porte les deux façons d'alimenter la banque, et il est le SEUL à
// les porter : l'onglet Quiz du panneau d'admin et les scripts en ligne de
// commande (`npm run seed:quiz`, `npm run gen:quiz`) l'appellent tous les deux.
//
// C'était le point du refactor : la logique vivait dans les scripts, donc elle
// n'était atteignable qu'en SSH sur le serveur. Or remplir la banque n'est pas
// une opération d'installation, c'est une tâche courante d'administration —
// elle doit se faire depuis l'interface, comme la relecture qui la suit.
//
// Les deux fonctions acceptent un `onProgress` : elles tournent en tâche de
// fond côté admin (voir routes/quizAdmin.js), et sans retour en direct on
// regarde un bouton grisé pendant une minute sans savoir s'il se passe quelque
// chose.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");

// L'empreinte du texte d'une question : c'est elle qui rend l'import rejouable.
// Relancer met à jour une explication corrigée sans jamais créer de doublon.
const fingerprint = (text) =>
  crypto
    .createHash("sha1")
    .update(
      String(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    )
    .digest("hex");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
}

// ============================================================
//  1. L'import du contenu local
// ============================================================
// Les deux fichiers de src/data/, écrits à la main et versionnés avec le code.
// Tout ce qui en sort part APPROUVÉ : il a été relu par construction, à la
// différence de ce que produit un modèle de langage.
//
// Les entrées venues de Gemini ou saisies dans l'admin ne sont jamais touchées :
// on peut relancer l'import sur une base vivante sans écraser le travail de
// relecture.
export async function seedFromFiles({ onProgress = () => {} } = {}) {
  const out = {
    questions: { total: 0, created: 0, updated: 0 },
    emojis: { total: 0, created: 0, updated: 0, retired: 0 },
    problems: [],
    unresolved: [],
  };

  // ---------------------------------------------------------- questions
  const { questions } = readJson("quizQuestions.fr.json");
  out.questions.total = questions.length;
  onProgress({ step: "questions", done: 0, total: questions.length });

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    // Une question mal formée dans le fichier doit être SIGNALÉE, pas insérée :
    // sans réponse valide, elle produirait une manche impossible à gagner.
    if (!q.text) {
      out.problems.push("question sans texte");
      continue;
    }
    if (q.kind === "truefalse") {
      if (typeof q.answer !== "boolean") {
        out.problems.push(`vrai/faux sans réponse : « ${q.text} »`);
        continue;
      }
    } else if (!Array.isArray(q.choices) || q.choices.length < 2) {
      out.problems.push(`QCM sans propositions : « ${q.text} »`);
      continue;
    } else if (new Set(q.choices).size !== q.choices.length) {
      out.problems.push(`QCM avec une proposition en double : « ${q.text} »`);
      continue;
    }

    const fp = fingerprint(q.text);
    // eslint-disable-next-line no-await-in-loop
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
          approved: true,
          fingerprint: fp,
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) out.questions.created += 1;
    else if (res.modifiedCount) out.questions.updated += 1;
    if (i % 10 === 0) onProgress({ step: "questions", done: i + 1, total: questions.length });
  }

  // ------------------------------------------------------------- emojis
  // Le fichier désigne les jeux par leur NOM (écrire des identifiants IGDB à la
  // main serait intenable) : il faut donc les résoudre. C'est la partie lente,
  // d'où le rythme imposé plus bas.
  const { emojis } = readJson("quizEmojis.fr.json");
  out.emojis.total = emojis.length;
  onProgress({ step: "emojis", done: 0, total: emojis.length });

  // Les jeux que CE fichier couvre : sert au ménage, plus bas.
  const seen = new Set();

  const known = new Map(
    (await QuizEmoji.find({ source: "seed" }).select("gameId name").lean()).map((r) => [
      String(r.name || "").toLowerCase(),
      r.gameId,
    ])
  );

  for (let i = 0; i < emojis.length; i += 1) {
    const e = emojis[i];
    if (!e.game || !Array.isArray(e.emojis) || e.emojis.length < 3) {
      out.unresolved.push(`${e.game || "?"} (moins de 3 emojis)`);
      continue;
    }
    let gameId = known.get(String(e.game).toLowerCase()) || null;
    let name = e.game;
    if (!gameId) {
      // eslint-disable-next-line no-await-in-loop
      const found = await resolveGame(e.game);
      if (!found) {
        out.unresolved.push(e.game);
        continue;
      }
      gameId = found.gameId;
      name = found.name;
      // IGDB plafonne à quatre requêtes par seconde : on s'y tient plutôt que
      // de se faire couper au milieu du lot.
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
    if (res.upsertedCount) out.emojis.created += 1;
    else if (res.modifiedCount) out.emojis.updated += 1;
    seen.add(gameId);
    onProgress({ step: "emojis", done: i + 1, total: emojis.length });
  }

  // ------------------------------------------------- le ménage des anciennes
  // LE FICHIER FAIT AUTORITÉ sur ce qui vient de lui. Une entrée jadis importée
  // puis retirée du fichier — ou renommée, ce qui revient au même puisque la
  // clé est le jeu — resterait sinon en base et compterait comme jouable.
  //
  // C'est arrivé en renommant les emojis vers des noms de saga : les anciennes
  // versions à sous-titre sont restées, et le compteur annonçait plus d'énigmes
  // qu'il n'en existait réellement.
  //
  // On les RETIRE DU SERVICE sans les supprimer : si l'une d'elles avait été
  // corrigée à la main dans l'admin, l'effacer perdrait ce travail. Elles
  // réapparaissent dans la file « à relire », où l'on tranche.
  if (seen.size) {
    const stale = await QuizEmoji.updateMany(
      { source: "seed", approved: true, gameId: { $nin: [...seen] } },
      { $set: { approved: false } }
    );
    out.emojis.retired = stale.modifiedCount || 0;
  }

  return out;
}

// Retrouve un jeu à partir de son titre. La recherche d'IGDB classe par
// pertinence, mais un titre court (« Portal ») remonte parfois d'abord une
// suite ou un portage : on préfère la correspondance EXACTE quand elle existe.
async function resolveGame(name) {
  const safe = String(name).replace(/"/g, "");
  try {
    const raw = await igdbQuery(
      "games",
      `search "${safe}"; fields id,name,cover.image_id,game_type,version_parent;` +
        " where version_parent = null & game_type = (0,4,8,9,10,11); limit 5;"
    );
    if (!raw.length) return null;
    const exact = raw.find((g) => g.name?.toLowerCase() === safe.toLowerCase());
    const g = exact || raw[0];
    return {
      gameId: g.id,
      name: g.name,
      cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
    };
  } catch (err) {
    console.error(`quiz seed: IGDB « ${name} » : ${err.message}`);
    return null;
  }
}

// ============================================================
//  2. La génération par Gemini
// ============================================================
// TOUT SORT `approved: false`. Le modèle énonce des faits faux avec le même
// aplomb que des vrais : rien de ce qu'il produit n'atteint un joueur avant
// d'avoir été relu. C'est le point non négociable de cette fonction.
//
// On ne lui demande PAS des faits qu'IGDB connaît déjà (dates, studios,
// plateformes) : lib/quizBank.js les fabrique gratuitement et sans erreur. On
// lui demande ce qu'aucune API ne donne — anecdotes, coulisses, personnages,
// répliques, vocabulaire du milieu.
const BATCH = 10;

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

export async function generateWithGemini({
  questions: wantQ = 30,
  emojis: wantE = 20,
  onProgress = () => {},
} = {}) {
  if (!isGeminiConfigured()) {
    const err = new Error("GEMINI_API_KEY manquant : ajoute la clé dans l'onglet Secrets.");
    err.status = 503;
    throw err;
  }
  const out = {
    questions: { created: 0, skipped: 0 },
    emojis: { created: 0, skipped: 0 },
    errors: [],
  };

  // ---------------------------------------------------------- questions
  if (wantQ > 0) {
    // Un échantillon de l'existant : sans ça, le modèle repropose
    // invariablement les mêmes dix classiques.
    const known = (
      await QuizQuestion.aggregate([{ $sample: { size: 40 } }, { $project: { text: 1 } }])
    ).map((r) => r.text);
    const themes = shuffle(THEMES);

    for (let i = 0; out.questions.created < wantQ && i < Math.ceil(wantQ / BATCH) + 3; i += 1) {
      onProgress({ step: "questions", done: out.questions.created, total: wantQ });
      let batch;
      try {
        // eslint-disable-next-line no-await-in-loop
        batch = await geminiJson(questionPrompt(themes[i % themes.length], known), {
          temperature: 1,
        });
      } catch (err) {
        out.errors.push(err.message);
        continue;
      }
      for (const q of Array.isArray(batch?.questions) ? batch.questions : []) {
        if (out.questions.created >= wantQ) break;
        // Contrôle de forme AVANT insertion : un modèle rend régulièrement
        // trois propositions au lieu de quatre, ou deux fois la même. Ces
        // questions-là ne doivent même pas atteindre la file de relecture.
        if (!q?.text || !Array.isArray(q.choices) || q.choices.length !== 4) {
          out.questions.skipped += 1;
          continue;
        }
        const clean = q.choices.map((c) => String(c).trim()).filter(Boolean);
        if (clean.length !== 4 || new Set(clean).size !== 4) {
          out.questions.skipped += 1;
          continue;
        }
        const fp = fingerprint(q.text);
        // eslint-disable-next-line no-await-in-loop
        if (await QuizQuestion.exists({ fingerprint: fp })) {
          out.questions.skipped += 1;
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
          approved: false,
          fingerprint: fp,
        });
        known.push(q.text);
        out.questions.created += 1;
      }
    }
  }

  // ------------------------------------------------------------- emojis
  if (wantE > 0) {
    const pool = await getFactPool();
    if (!pool.length) {
      out.errors.push("Vivier IGDB vide (clés Twitch absentes ?) — emojis sautés.");
    } else {
      const have = new Set((await QuizEmoji.find().select("gameId").lean()).map((r) => r.gameId));
      const todo = shuffle(pool.filter((g) => !have.has(g.id)));

      for (let i = 0; out.emojis.created < wantE && i * BATCH < todo.length; i += 1) {
        onProgress({ step: "emojis", done: out.emojis.created, total: wantE });
        const chunk = todo.slice(i * BATCH, (i + 1) * BATCH);
        if (!chunk.length) break;
        let batch;
        try {
          // eslint-disable-next-line no-await-in-loop
          batch = await geminiJson(emojiPrompt(chunk), { temperature: 1 });
        } catch (err) {
          out.errors.push(err.message);
          continue;
        }
        for (const item of Array.isArray(batch?.items) ? batch.items : []) {
          if (out.emojis.created >= wantE) break;
          const gameId = Number(item?.id);
          const list = Array.isArray(item?.emojis)
            ? item.emojis.map((e) => String(e).trim()).filter(Boolean)
            : [];
          // Le modèle a le droit de renoncer, et on l'y encourage : mieux vaut
          // pas d'énigme qu'une énigme qui ne désigne rien.
          if (item?.skip || list.length < 3 || !chunk.some((g) => g.id === gameId)) {
            out.emojis.skipped += 1;
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
                approved: false,
              },
            },
            { upsert: true }
          );
          out.emojis.created += 1;
        }
      }
    }
  }

  return out;
}
