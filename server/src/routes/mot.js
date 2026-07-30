import express from "express";
import mongoose from "mongoose";
import MotDuJour from "../models/MotDuJour.js";
import MotPlay from "../models/MotPlay.js";
import MotSession from "../models/MotSession.js";
import User from "../models/User.js";
// Le générateur de codes de la watchparty : même besoin (une adresse courte,
// sans caractères ambigus, qui se dicte à voix haute), donc même outil.
import { makeCode } from "../models/WatchParty.js";
import { emitTo } from "../lib/realtime.js";
import { deliverCard } from "./chat.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { igdbQuery } from "../lib/igdb.js";
import { geminiJson, isGeminiConfigured } from "../lib/gemini.js";
import { IMG, person } from "./blindtest.js";
import {
  isReady,
  load,
  resolve,
  cos,
  calibrate,
  temperature,
  heatBand,
  sameWord,
  pickWord,
  gameDay,
  msUntilNextDay,
  NEIGHBOURS,
  MOT_TZ,
} from "../lib/mots.js";

// ======================================================================
//  Mot du jour — un mot à deviner par la proximité de sens.
// ======================================================================
// Le joueur propose des mots ; chacun revient avec une TEMPÉRATURE (0-100 °) et,
// s'il fait partie des 1000 mots les plus proches, son RANG. Le but est de
// trouver le mot exact. Un seul mot pour tous, de minuit à minuit dans le fuseau
// du jeu (MOT_TZ, cf. lib/mots.js).
//
// Rien de tout cela ne passe par une IA : la proximité sort d'un dictionnaire
// vectoriel local (lib/mots.js), donc elle est identique pour tous les joueurs
// et stable dans le temps. C'est la condition d'un classement honnête — un LLM
// aurait donné un nombre légèrement différent à chaque appel.
//
// La SEULE exception est l'anecdote de fin de partie, où l'indéterminisme n'a
// aucune importance : un appel par jour, hors du chemin critique, mis en cache.
const router = express.Router();

// La réponse ne quitte JAMAIS le serveur avant d'être trouvée : contrairement au
// Blind Test et à Pixel Rush (qui envoient la solution au client pour révéler la
// manche), ici tout le monde joue la même énigme toute la journée. Un mot lisible
// dans les devtools se propagerait à tous les amis en une capture d'écran.
// Chaque essai fait donc un aller-retour.

// --- Cache mémoire du moteur d'un jour ---
// Le calibrage et les 1000 voisins sont dérivés du seul mot : 30 ms de calcul,
// donc inutile de les stocker en base (cf. l'en-tête de models/MotDuJour.js).
// On garde une semaine en mémoire, ce qui couvre l'archive consultable.
const engines = new Map(); // date → { word, index, calib, ranks }
const ENGINE_KEEP = 7;

function engineFor(date, word) {
  const hit = engines.get(date);
  if (hit && hit.word === word) return hit;

  const { index } = load();
  const idx = index.get(word);
  if (idx == null) {
    const err = new Error(`Le mot du jour « ${word} » est absent du dictionnaire.`);
    err.status = 500;
    throw err;
  }
  const calib = calibrate(idx);
  const ranks = new Map(calib.neighbours.map((n, i) => [n.w, i + 1]));
  const engine = { word, index: idx, calib, ranks };

  engines.set(date, engine);
  // Purge des jours les plus anciens (les clés sont des dates ISO, donc l'ordre
  // alphabétique est l'ordre chronologique).
  if (engines.size > ENGINE_KEEP) {
    const oldest = [...engines.keys()].sort()[0];
    engines.delete(oldest);
  }
  return engine;
}

// --- Le jour courant, créé à la volée ---
// Pas de tâche planifiée : le premier joueur de la journée déclenche la création.
// `findOneAndUpdate` en upsert plutôt qu'un `findOne` suivi d'un `create` — deux
// joueurs qui arrivent à minuit pile ne doivent pas créer deux mots.
async function dayFor(date) {
  const existing = await MotDuJour.findOne({ date });
  if (existing) return existing;

  // Les mots déjà sortis ne ressortent pas.
  const used = new Set((await MotDuJour.find().select("word").lean()).map((d) => d.word));
  const { word } = pickWord(date, used);

  const doc = await MotDuJour.findOneAndUpdate(
    { date },
    { $setOnInsert: { date, word } },
    { new: true, upsert: true }
  );
  // Course perdue : l'autre requête a inséré son mot, on prend le sien.
  if (doc.word === word) fetchAnecdote(doc._id, word);
  return doc;
}

// ----------------------------------------------------------------------
//  L'anecdote « En parlant de {mot}… »
// ----------------------------------------------------------------------
// Le lien entre le mot du jour et l'univers du jeu vidéo : c'est ce qui fait
// que le jeu appartient à MyPlayLog et pas à un site de mots croisés.
//
// Volontairement NON BLOQUANTE : lancée sans await à la création du jour, elle
// se posera dans le document quand elle arrivera. Si Gemini ne répond pas (le
// cas fréquent), la partie se joue quand même et on retente au prochain appel,
// dans la limite de MAX_ANECDOTE_TRIES pour ne pas marteler l'API.
const MAX_ANECDOTE_TRIES = 5;

// Verrou d'appel en cours, par jour. Sans lui, la relance opportuniste de
// /today part à chaque requête pendant les quinze secondes que met Gemini à
// répondre : trois joueurs qui ouvrent la page en même temps déclenchent trois
// appels concurrents, l'API gratuite les rejette tous, et le quota de
// tentatives est consommé pour rien. Le compteur en base borne les tentatives
// dans le temps ; ce verrou-ci les borne dans l'instant.
const anecdoteInFlight = new Set();

function anecdotePrompt(word) {
  return [
    `Le mot du jour d'un jeu de devinettes francophone est « ${word} ».`,
    "",
    "Trouve UN lien réel et intéressant entre ce mot et l'univers du jeu vidéo :",
    "un jeu marquant, un studio, un genre, un record, une scène compétitive.",
    "",
    "Réponds en JSON strict :",
    '{"titre": "…", "texte": "…", "jeu": "…", "annee": 1998}',
    "",
    "Règles impératives :",
    "- \"titre\" : 4 à 8 mots, accrocheur, sans point final.",
    "- \"texte\" : 2 ou 3 phrases en français, ton complice de joueur, 320 caractères maximum.",
    "- Uniquement des faits dont tu es certain. Aucun chiffre de ventes ni record inventé :",
    "  s'il y a le moindre doute sur un nombre, écris la phrase sans le nombre.",
    "- \"jeu\" : le titre d'un jeu existant lié au mot, ou null si aucun ne s'impose.",
    "  Donne-le sous sa forme INTERNATIONALE (celle de la boîte d'origine, en anglais",
    "  le cas échéant) et sans sous-titre traduit : c'est ce titre qui sert à retrouver",
    "  la jaquette dans IGDB, dont le catalogue n'est pas francophone.",
    "- \"annee\" : année de sortie du jeu cité (nombre), ou null.",
    "- Ne commence pas \"texte\" par « En parlant de » : cette formule est déjà affichée avant.",
  ].join("\n");
}

async function fetchAnecdote(dayId, word) {
  if (!isGeminiConfigured()) return;
  const lock = String(dayId);
  if (anecdoteInFlight.has(lock)) return;
  anecdoteInFlight.add(lock);
  try {
    // On incrémente AVANT l'appel : un plantage ne doit pas rendre la tentative
    // gratuite, sinon un mot qui fait systématiquement échouer Gemini
    // relancerait un appel à chaque requête de chaque joueur.
    const claimed = await MotDuJour.findOneAndUpdate(
      { _id: dayId, "anecdote.at": null, "anecdote.tries": { $lt: MAX_ANECDOTE_TRIES } },
      { $inc: { "anecdote.tries": 1 } },
      { new: true }
    );
    if (!claimed) return; // déjà obtenue, ou quota de tentatives épuisé

    const out = await geminiJson(anecdotePrompt(word), {
      timeoutMs: 20_000,
      // Une anecdote factuelle ne veut pas d'imagination : température basse,
      // comme pour les traductions (cf. lib/gameText.js).
      temperature: 0.4,
    });

    const title = String(out?.titre || "").trim().slice(0, 120);
    const text = String(out?.texte || "").trim().slice(0, 400);
    if (!text) {
      // Réponse hors format : à tracer, sinon la tentative se consomme en
      // silence et l'anecdote manquante reste inexplicable.
      console.warn(`mot anecdote « ${word} » : réponse sans texte`, JSON.stringify(out).slice(0, 200));
      return;
    }

    const game = { name: "", igdbId: null, cover: null, year: null };
    const gameName = String(out?.jeu || "").trim();
    if (gameName && gameName.toLowerCase() !== "null") {
      game.name = gameName.slice(0, 120);
      game.year = Number.isFinite(Number(out?.annee)) ? Number(out.annee) : null;
      // Jaquette réelle : l'anecdote devient une carte cliquable vers la fiche.
      // Best-effort — une anecdote sans jaquette reste une bonne anecdote.
      try {
        const found = await igdbQuery(
          "games",
          `search "${gameName.replace(/"/g, "")}"; fields name,cover.image_id,first_release_date; limit 1;`
        );
        const g = found?.[0];
        if (g) {
          game.igdbId = g.id;
          game.name = g.name || game.name;
          if (g.cover?.image_id) game.cover = `${IMG}/t_cover_big/${g.cover.image_id}.jpg`;
          if (!game.year && g.first_release_date)
            game.year = new Date(g.first_release_date * 1000).getFullYear();
        }
      } catch {
        /* IGDB indisponible : on garde le nom brut */
      }
    }

    await MotDuJour.updateOne(
      { _id: dayId },
      { $set: { "anecdote.title": title, "anecdote.text": text, "anecdote.game": game, "anecdote.at": new Date() } }
    );
    console.log(`mot: anecdote obtenue pour « ${word} »`);
  } catch (err) {
    console.warn(`mot anecdote « ${word} » :`, err.message);
  } finally {
    anecdoteInFlight.delete(lock);
  }
}

// Forme publique de l'anecdote (null tant qu'elle n'est pas arrivée).
function publicAnecdote(day) {
  const a = day?.anecdote;
  if (!a?.at || !a.text) {
    return {
      pending: Boolean(isGeminiConfigured() && (a?.tries ?? 0) < MAX_ANECDOTE_TRIES),
      title: "",
      text: "",
      game: null,
    };
  }
  return {
    pending: false,
    title: a.title || "",
    text: a.text,
    game: a.game?.name
      ? {
          name: a.game.name,
          igdbId: a.game.igdbId ?? null,
          cover: a.game.cover || null,
          year: a.game.year ?? null,
        }
      : null,
  };
}

// ----------------------------------------------------------------------
//  Score
// ----------------------------------------------------------------------
// Décroissance douce sur le nombre d'essais, petit malus de temps.
//
// Le temps compté est celui écoulé depuis le PREMIER essai du joueur, jamais
// depuis minuit : ouvrir le jeu au petit-déjeuner ou juste avant de se coucher
// ne doit rien changer. Et il pèse peu (120 points au maximum) — on récompense
// la déduction, pas la frénésie.
const SCORE_MAX = 1000;
const TRIES_DECAY = 22; // essais pour diviser le score par e
const TIME_MALUS_MAX = 120;
const SCORE_FLOOR = 100;

function scoreFor(tries, timeMs) {
  const t = Math.max(1, Number(tries) || 1);
  let pts = SCORE_MAX * Math.exp(-(t - 1) / TRIES_DECAY);
  const minutes = Math.max(0, Number(timeMs) || 0) / 60000;
  pts -= Math.min(TIME_MALUS_MAX, minutes * 4);
  return Math.max(SCORE_FLOOR, Math.round(pts));
}

// Essais renvoyés au client : triés du plus chaud au plus froid, comme sur la
// page. Le tri est fait ici pour que le client n'ait qu'à afficher.
function publicGuesses(play) {
  return [...(play.guesses || [])]
    .sort((a, b) => b.temp - a.temp)
    .map((g) => ({
      word: g.w,
      temp: g.temp,
      band: heatBand(g.temp),
      rank: g.rank ?? null,
      at: g.at,
    }));
}

function playState(play, day, { reveal = false } = {}) {
  const solved = !!play?.solved;
  const done = solved || !!play?.gaveUp;
  return {
    tries: play?.tries || 0,
    solved,
    gaveUp: !!play?.gaveUp,
    score: play?.score || 0,
    timeMs: play?.timeMs ?? null,
    guesses: play ? publicGuesses(play) : [],
    // Le mot n'est révélé qu'une fois la partie finie (trouvé ou abandonné), ou
    // sur un jour passé de l'archive.
    word: done || reveal ? day.word : null,
    anecdote: done || reveal ? publicAnecdote(day) : null,
  };
}

function dayStats(day) {
  const s = day.stats || {};
  return {
    players: s.players || 0,
    solved: s.solved || 0,
    bestTries: s.bestTries ?? null,
    avgTries: s.solved ? Math.round((s.totalTries / s.solved) * 10) / 10 : null,
  };
}

// Toutes les routes ont besoin du dictionnaire : sans lui, autant le dire
// clairement plutôt que de renvoyer une erreur 500 opaque.
function requireDict(res) {
  if (isReady()) return true;
  res.status(503).json({
    error:
      "Le dictionnaire du Mot du jour n'est pas installé sur ce serveur. " +
      "Lance : npm run build:mots -- --src <cc.fr.300.vec.gz>",
  });
  return false;
}

// GET /api/mot/today — l'état de MA partie du jour.
router.get("/today", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const date = gameDay();
    const day = await dayFor(date);
    engineFor(date, day.word); // préchauffe le cache (30 ms, une fois par jour)

    // Anecdote pas encore arrivée : on relance discrètement. C'est ici que se
    // rattrape un Gemini qui n'avait pas répondu à la création du jour.
    if (!day.anecdote?.at && (day.anecdote?.tries ?? 0) < MAX_ANECDOTE_TRIES) {
      fetchAnecdote(day._id, day.word);
    }

    const play = await MotPlay.findOne({ user: req.userId, date }).lean();

    // Partie à plusieurs en cours : la page bascule directement dessus, sans
    // que le joueur ait à re-cliquer sur un lien après un rechargement.
    let session = null;
    if (play?.session) {
      const s = await MotSession.findById(play.session).populate(SESSION_POPULATE);
      if (s && !s.solved && s.date === date) session = publicSession(s, day, req.userId);
    }

    res.json({
      date,
      session,
      msUntilNext: msUntilNextDay(),
      // Le fuseau de référence accompagne le compte à rebours : le client peut
      // ainsi dire « minuit à Paris, 23 h chez toi » au lieu d'afficher une
      // durée que rien n'explique quand le joueur n'est pas dans ce fuseau.
      tz: MOT_TZ,
      neighbours: NEIGHBOURS,
      stats: dayStats(day),
      ...playState(play, day),
    });
  } catch (err) {
    console.error("mot today error:", err.message);
    res.status(err.status || 500).json({ error: "Impossible de charger le mot du jour." });
  }
});

// POST /api/mot/guess { word } — un essai.
router.post("/guess", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const date = gameDay();
    const day = await dayFor(date);
    const engine = engineFor(date, day.word);

    let play = await MotPlay.findOne({ user: req.userId, date });
    if (play?.solved || play?.gaveUp) {
      return res.status(409).json({ error: "Partie déjà terminée pour aujourd'hui." });
    }
    // À une table : les essais doivent passer par la session, sinon ils
    // n'entreraient pas dans le pot commun et n'apparaîtraient chez personne.
    if (play?.session) {
      return res
        .status(409)
        .json({ error: "Tu joues à plusieurs — propose ton mot dans la partie.", code: "in_session" });
    }

    const raw = String(req.body?.word || "");
    const found = resolve(raw);
    if (!found) {
      // Mot inconnu : ce n'est PAS un essai (aucune pénalité), et ça ne démarre
      // même pas une partie. Un joueur ne doit être puni ni pour une faute de
      // frappe, ni pour avoir tenté un mot hors dictionnaire.
      // Le message part dans `error` : c'est ce champ que lib/api.js remonte
      // dans Error.message, donc c'est lui que le joueur lit. Le code machine
      // va à côté, pour que le client puisse distinguer ce cas sans analyser
      // du texte.
      return res.status(422).json({
        error: `Je ne connais pas « ${raw.trim().slice(0, 30)} ».`,
        code: "unknown_word",
      });
    }

    // Première proposition VALIDE de la journée : la partie commence ici, et
    // c'est ici qu'on compte un joueur de plus. L'index unique (user, date) rend
    // l'opération sûre même si deux essais partaient en même temps — le perdant
    // de la course récupère simplement le document de l'autre.
    if (!play) {
      try {
        play = await MotPlay.create({
          user: req.userId,
          date,
          word: day.word,
          startedAt: new Date(),
        });
        await MotDuJour.updateOne({ _id: day._id }, { $inc: { "stats.players": 1 } });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        play = await MotPlay.findOne({ user: req.userId, date });
      }
    }

    // Déjà proposé : on le renvoie tel quel, toujours sans consommer d'essai.
    const already = (play.guesses || []).find((g) => g.w === found.word);
    if (already) {
      return res.json({
        repeat: true,
        word: already.w,
        temp: already.temp,
        band: heatBand(already.temp),
        rank: already.rank ?? null,
        solved: false,
        tries: play.tries,
      });
    }

    // Victoire : le mot lui-même, mais aussi son pluriel ou sa forme sans
    // accent (cf. sameWord). « donjons » pour « donjon » doit gagner.
    const win = sameWord(found.word, day.word);
    const sim = win ? 1 : cos(engine.index, found.index);
    // Le rang se calcule AVANT la température : c'est lui qui la commande dès
    // qu'on est dans le voisinage (cf. lib/mots.js → temperature).
    const rank = win ? 0 : engine.ranks.get(found.word) ?? null;
    const temp = win ? 100 : temperature(sim, engine.calib, rank);

    const now = new Date();
    const guess = {
      w: win ? day.word : found.word,
      sim: Math.round(sim * 10000) / 10000,
      temp,
      rank,
      at: now,
    };

    const update = { $push: { guesses: guess }, $inc: { tries: 1 } };
    let score = 0;
    let timeMs = null;
    let balance = null; // nouveau solde de points, pour recaler le client

    if (win) {
      timeMs = Math.max(0, now - new Date(play.startedAt || now));
      score = scoreFor((play.tries || 0) + 1, timeMs);
      update.$set = { solved: true, solvedAt: now, timeMs, score };
    }

    play = await MotPlay.findOneAndUpdate({ _id: play._id }, update, { new: true });

    if (win) {
      // Compteurs du jour (une seule écriture, atomique).
      const tries = play.tries;
      await MotDuJour.updateOne({ _id: day._id }, [
        {
          $set: {
            "stats.solved": { $add: [{ $ifNull: ["$stats.solved", 0] }, 1] },
            "stats.totalTries": { $add: [{ $ifNull: ["$stats.totalTries", 0] }, tries] },
            "stats.bestTries": {
              $cond: [
                { $or: [{ $eq: ["$stats.bestTries", null] }, { $gt: ["$stats.bestTries", tries] }] },
                tries,
                "$stats.bestTries",
              ],
            },
          },
        },
      ]);

      // Points, une seule fois — le drapeau est posé de façon conditionnelle
      // pour rester idempotent même si deux requêtes gagnantes se croisaient.
      const claim = await MotPlay.updateOne(
        { _id: play._id, pointsGranted: false },
        { $set: { pointsGranted: true } }
      );
      if (claim.modifiedCount) {
        balance = await grantPoints(req.userId, score, "mot", {
          motPlayId: String(play._id),
          date,
          tries,
        });
        recordActivity({
          actor: req.userId,
          type: "mot",
          meta: {
            motPlayId: String(play._id),
            date,
            score,
            tries,
            timeMs,
            // Surtout PAS le mot : la carte du fil ne doit rien divulguer aux
            // amis qui n'ont pas encore joué.
          },
        });
        triggerMissionCheck(req.userId);
      }
    }

    res.json({
      word: guess.w,
      temp,
      band: heatBand(temp),
      rank,
      solved: win,
      tries: play.tries,
      ...(win
        ? {
            score,
            timeMs,
            points: balance,
            anecdote: publicAnecdote(day),
            stats: dayStats(await MotDuJour.findById(day._id).lean()),
          }
        : {}),
    });
  } catch (err) {
    console.error("mot guess error:", err.message);
    res.status(err.status || 500).json({ error: "Impossible d'enregistrer l'essai." });
  }
});

// POST /api/mot/giveup — abandonner : révèle le mot, aucun point.
router.post("/giveup", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const date = gameDay();
    const day = await dayFor(date);
    // Abandonner après avoir trouvé n'a aucun sens : on renvoie l'état tel quel
    // plutôt que d'écraser une victoire.
    let play = await MotPlay.findOne({ user: req.userId, date });
    if (play?.solved) {
      return res.json({ ...playState(play, day), stats: dayStats(day) });
    }

    if (!play) {
      // Abandon sans avoir joué : ça compte quand même comme une participation.
      try {
        play = await MotPlay.create({
          user: req.userId,
          date,
          word: day.word,
          startedAt: new Date(),
        });
        await MotDuJour.updateOne({ _id: day._id }, { $inc: { "stats.players": 1 } });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        play = await MotPlay.findOne({ user: req.userId, date });
      }
    }
    play = await MotPlay.findOneAndUpdate(
      { _id: play._id },
      { $set: { gaveUp: true, score: 0 } },
      { new: true }
    );
    res.json({ ...playState(play, day), stats: dayStats(day) });
  } catch (err) {
    console.error("mot giveup error:", err.message);
    res.status(500).json({ error: "Impossible d'abandonner la partie." });
  }
});

// GET /api/mot/board — le classement DU JOUR (moi + mes suivis).
// C'est le vrai enjeu du jeu : tout le monde a eu la même énigme aujourd'hui.
router.get("/board", requireAuth, async (req, res) => {
  try {
    const date = String(req.query.date || gameDay()).slice(0, 10);
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await MotPlay.find({ date, user: { $in: ids }, solved: true })
      .select("user tries timeMs score solvedAt wonWith")
      .sort({ tries: 1, timeMs: 1 })
      .limit(50)
      .lean();

    // Une victoire à plusieurs ne fait qu'UNE ligne, avec toute l'équipe. Les
    // coéquipiers sont récupérés sans filtre de cercle : si j'ai joué avec
    // quelqu'un que je ne suis pas, il doit quand même apparaître sur la photo.
    const sessionIds = [...new Set(rows.filter((r) => r.wonWith).map((r) => String(r.wonWith)))];
    const mates = sessionIds.length
      ? await MotPlay.find({ date, wonWith: { $in: sessionIds } })
          .select("user wonWith")
          .lean()
      : [];
    const teamOf = new Map(); // session → [userId]
    for (const m of mates) {
      const k = String(m.wonWith);
      if (!teamOf.has(k)) teamOf.set(k, []);
      teamOf.get(k).push(String(m.user));
    }

    const everyone = new Set(rows.map((r) => String(r.user)));
    for (const list of teamOf.values()) for (const u of list) everyone.add(u);
    const users = await User.find({ _id: { $in: [...everyone] } })
      .select("username avatar")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const seen = new Set(); // sessions déjà sorties : une seule ligne par équipe
    const entries = [];
    for (const r of rows) {
      const key = r.wonWith ? String(r.wonWith) : null;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const memberIds = key ? teamOf.get(key) || [String(r.user)] : [String(r.user)];
      const team = memberIds.map((id) => byId.get(id)).filter(Boolean).map(person);
      if (!team.length) continue;
      entries.push({
        team,
        // `user` reste rempli avec le premier : le rail droit et les anciens
        // appels qui n'attendent qu'une personne continuent de fonctionner.
        user: team[0],
        solo: !key,
        tries: r.tries,
        timeMs: r.timeMs ?? null,
        score: r.score,
        date: r.solvedAt,
        isMe: memberIds.includes(String(req.userId)),
      });
    }

    res.json({ date, entries });
  } catch (err) {
    console.error("mot board error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement du jour." });
  }
});

// GET /api/mot/leaderboard — cumul et record.
// MÊME CONTRAT que /blindtest, /pixel et /geo : le rail de l'arcade bascule de
// « Record » à « Total » sans savoir de quel jeu il parle.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await MotPlay.aggregate([
      { $match: { user: { $in: ids }, solved: true } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$user",
          score: { $sum: "$score" },
          games: { $sum: 1 },
          bestScore: { $max: "$score" },
          bestTries: { $min: "$tries" },
          totalTries: { $sum: "$tries" },
          date: { $max: "$solvedAt" },
        },
      },
      { $sort: { score: -1, date: -1 } },
      { $limit: 30 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("username avatar")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      entries: rows
        .map((r) => {
          const u = byId.get(String(r._id));
          if (!u) return null;
          return {
            user: person(u),
            score: r.score,
            games: r.games,
            bestScore: r.bestScore,
            bestTries: r.bestTries,
            avgTries: r.games ? Math.round((r.totalTries / r.games) * 10) / 10 : null,
            date: r.date,
            isMe: String(r._id) === String(req.userId),
          };
        })
        .filter(Boolean),
    });
  } catch (err) {
    console.error("mot leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

// GET /api/mot/archive — les jours passés : le mot, son anecdote, mon résultat.
// C'est la mémoire du jeu : les anecdotes ont coûté un appel chacune, elles ne
// doivent pas disparaître au tour de minuit.
router.get("/archive", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 90);
    const today = gameDay();
    const days = await MotDuJour.find({ date: { $lt: today } })
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    const mine = await MotPlay.find({
      user: req.userId,
      date: { $in: days.map((d) => d.date) },
    })
      .select("date tries solved gaveUp score timeMs")
      .lean();
    const byDate = new Map(mine.map((p) => [p.date, p]));

    res.json({
      entries: days.map((d) => {
        const p = byDate.get(d.date);
        return {
          date: d.date,
          word: d.word, // le jour est passé : plus rien à cacher
          anecdote: publicAnecdote(d),
          stats: dayStats(d),
          me: p
            ? {
                solved: !!p.solved,
                gaveUp: !!p.gaveUp,
                tries: p.tries,
                score: p.score,
                timeMs: p.timeMs ?? null,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error("mot archive error:", err.message);
    res.status(500).json({ error: "Impossible de charger l'archive." });
  }
});

// ======================================================================
//  Parties à plusieurs
// ======================================================================
// Voir models/MotSession.js pour la règle de cumul des essais, qui gouverne
// tout ce qui suit. Ici on n'écrit que les gestes : créer, rejoindre, proposer,
// partir, inviter.
//
// Le temps réel emprunte le tunnel SSE de la messagerie (lib/realtime.js), sous
// un seul nom d'évènement `mot` dont le `kind` porte la nature :
//   guess    un mot vient d'être proposé (par qui, quelle température)
//   members  quelqu'un est entré ou sorti (le total d'essais a pu bouger)
//   typing   ce que quelqu'un est en train de taper, lettre à lettre
//   solved   le mot a été trouvé — la partie se fige
//
// C'est la même économie que la watchparty : un tunnel déjà ouvert, déjà géré
// par Caddy, et aucun écouteur à ajouter côté client pour chaque geste inventé.

// Diffusion à tous les membres ENCORE présents (les partis n'ont plus à suivre).
function broadcast(session, kind, payload = {}) {
  const ids = activeMembers(session).map((m) => String(m.user?._id || m.user));
  if (ids.length) emitTo(ids, "mot", { code: session.code, kind, ...payload });
}

function activeMembers(session) {
  return (session.members || []).filter((m) => !m.leftAt);
}

function memberOf(session, userId) {
  return (session.members || []).find(
    (m) => String(m.user?._id || m.user) === String(userId)
  );
}

// Vue publique d'une session. Comme en solo, LE MOT N'EN SORT JAMAIS tant qu'il
// n'est pas trouvé : la partie est la même pour tout le monde toute la journée.
function publicSession(session, day, meId) {
  const me = memberOf(session, meId);
  return {
    code: session.code,
    date: session.date,
    host: person(session.host),
    isHost: String(session.host?._id || session.host) === String(meId),
    joined: Boolean(me && !me.leftAt),
    members: (session.members || [])
      .filter((m) => m.user)
      .map((m) => ({
        user: person(m.user),
        active: !m.leftAt,
        broughtTries: m.broughtTries || 0,
      })),
    // Triés du plus chaud au plus froid, comme en solo — avec leur auteur.
    guesses: [...(session.guesses || [])]
      .sort((a, b) => b.temp - a.temp)
      .map((g) => ({
        word: g.w,
        temp: g.temp,
        band: heatBand(g.temp),
        rank: g.rank ?? null,
        by: g.by ? person(g.by) : null,
        at: g.at,
      })),
    tries: session.tries || 0,
    solved: !!session.solved,
    solvedBy: session.solvedBy ? person(session.solvedBy) : null,
    score: session.score || 0,
    timeMs: session.timeMs ?? null,
    word: session.solved ? session.word : null,
    anecdote: session.solved ? publicAnecdote(day) : null,
  };
}

const SESSION_POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "members.user", select: "username avatar" },
  { path: "guesses.by", select: "username avatar" },
  { path: "solvedBy", select: "username avatar" },
];

function loadSession(code) {
  return MotSession.findOne({ code: String(code || "").toLowerCase().trim() }).populate(
    SESSION_POPULATE
  );
}

// La partie solo du jour, créée si besoin. C'est le point de contact entre les
// deux modes : une session ne fait que mettre en commun des parties solo.
async function playFor(userId, day) {
  let play = await MotPlay.findOne({ user: userId, date: day.date });
  if (play) return play;
  try {
    play = await MotPlay.create({
      user: userId,
      date: day.date,
      word: day.word,
      startedAt: new Date(),
    });
    await MotDuJour.updateOne({ _id: day._id }, { $inc: { "stats.players": 1 } });
    return play;
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return MotPlay.findOne({ user: userId, date: day.date });
  }
}

// Recopie l'état du groupe dans une partie solo. Sert au départ volontaire ET à
// la victoire : dans les deux cas le joueur repart avec TOUT ce que le groupe
// avait accumulé — les essais comme les mots.
function absorbSession(play, session) {
  play.tries = session.tries;
  const have = new Set();
  play.guesses = (session.guesses || [])
    .filter((g) => (have.has(g.w) ? false : have.add(g.w)))
    .map((g) => ({ w: g.w, sim: g.sim, temp: g.temp, rank: g.rank ?? null, at: g.at }));
}

// POST /api/mot/session — ouvrir une partie à plusieurs depuis sa partie solo.
router.post("/session", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const date = gameDay();
    const day = await dayFor(date);
    const play = await playFor(req.userId, day);

    if (play.solved)
      return res.status(409).json({ error: "Tu as déjà trouvé le mot du jour." });

    // Déjà dans une partie en cours : on y renvoie plutôt que d'en ouvrir une
    // deuxième (sinon les essais se dispersent entre deux tables).
    if (play.session) {
      const current = await MotSession.findById(play.session).populate(SESSION_POPULATE);
      if (current && !current.solved)
        return res.json({ session: publicSession(current, day, req.userId) });
    }

    const session = await MotSession.create({
      code: makeCode(),
      date,
      word: day.word,
      host: req.userId,
      // L'hôte apporte sa partie solo : ses essais ET ses mots ouvrent la table.
      tries: play.tries || 0,
      members: [{ user: req.userId, broughtTries: play.tries || 0 }],
      guesses: (play.guesses || []).map((g) => ({
        w: g.w,
        sim: g.sim,
        temp: g.temp,
        rank: g.rank ?? null,
        by: req.userId,
        at: g.at,
      })),
      startedAt: new Date(),
    });

    play.session = session._id;
    await play.save();

    const full = await MotSession.findById(session._id).populate(SESSION_POPULATE);
    res.json({ session: publicSession(full, day, req.userId) });
  } catch (err) {
    console.error("mot session create error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir la partie." });
  }
});

// GET /api/mot/session/:code — l'état de la table (avant ou après y être entré).
router.get("/session/:code", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const session = await loadSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Cette partie n'existe plus." });

    const date = gameDay();
    if (session.date !== date)
      return res.status(410).json({ error: "Cette partie portait sur le mot d'un autre jour." });

    const day = await dayFor(date);
    const play = await MotPlay.findOne({ user: req.userId, date }).lean();
    res.json({
      session: publicSession(session, day, req.userId),
      // De quoi afficher le bon bouton sans deviner : « Rejoindre » ou pourquoi
      // c'est impossible.
      canJoin: !play?.solved && !session.solved,
      alreadySolved: !!play?.solved,
      myTries: play?.tries || 0,
    });
  } catch (err) {
    console.error("mot session get error:", err.message);
    res.status(500).json({ error: "Impossible de charger la partie." });
  }
});

// POST /api/mot/session/:code/join
router.post("/session/:code/join", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const session = await loadSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Cette partie n'existe plus." });

    const date = gameDay();
    if (session.date !== date)
      return res.status(410).json({ error: "Cette partie portait sur le mot d'un autre jour." });
    if (session.solved)
      return res
        .status(409)
        .json({ error: "Cette partie a déjà trouvé le mot — il est trop tard pour la rejoindre." });

    const day = await dayFor(date);
    const play = await playFor(req.userId, day);
    if (play.solved)
      return res
        .status(409)
        .json({ error: "Tu as déjà trouvé le mot du jour, tu ne peux plus rejoindre de partie." });

    // On quitte proprement une éventuelle autre table avant d'entrer ici.
    if (play.session && String(play.session) !== String(session._id)) {
      const prev = await MotSession.findById(play.session).populate(SESSION_POPULATE);
      if (prev) await leaveSession(prev, req.userId, play, { save: false });
    }

    const existing = memberOf(session, req.userId);
    if (!existing || existing.leftAt) {
      // Cumul des essais. Un nouvel arrivant apporte tout ; un revenant
      // n'apporte que ce qu'il a joué depuis son départ (cf. `sharedTries`
      // dans models/MotSession.js), sans quoi l'aller-retour compterait double.
      const already = existing?.sharedTries || 0;
      const brought = Math.max(0, (play.tries || 0) - already);
      session.tries += brought;

      // Les mots suivent les essais : sans ça, le groupe afficherait un total
      // gonflé pour une liste vide, et retenterait des mots déjà éliminés.
      const have = new Set(session.guesses.map((g) => g.w));
      for (const g of play.guesses || []) {
        if (have.has(g.w)) continue;
        have.add(g.w);
        session.guesses.push({
          w: g.w,
          sim: g.sim,
          temp: g.temp,
          rank: g.rank ?? null,
          by: req.userId,
          at: g.at,
        });
      }

      if (existing) {
        existing.leftAt = null;
        existing.joinedAt = new Date();
        existing.broughtTries = (existing.broughtTries || 0) + brought;
      } else {
        session.members.push({ user: req.userId, broughtTries: brought });
      }
      await session.save();
    }

    play.session = session._id;
    await play.save();

    const full = await MotSession.findById(session._id).populate(SESSION_POPULATE);
    const me = await User.findById(req.userId).select("username avatar").lean();
    broadcast(full, "members", { joined: person(me), tries: full.tries });
    res.json({ session: publicSession(full, day, req.userId) });
  } catch (err) {
    console.error("mot session join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre la partie." });
  }
});

// Sortie de table, partagée par /leave et par le nettoyage d'un changement de
// partie. Le joueur repart avec le total du groupe — essais ET mots.
async function leaveSession(session, userId, play, { save = true } = {}) {
  const member = memberOf(session, userId);
  // GARDE-FOU INDISPENSABLE : sans lui, « quitter » une table où l'on n'a
  // jamais mis les pieds recopie quand même l'état du groupe dans la partie
  // solo — et écrase des essais qu'on avait faits tout seul. C'est exactement
  // ce qui est arrivé au premier essai de cette fonction : un joueur avec 13
  // essais s'est retrouvé à 4.
  if (!member || member.leftAt) return false;

  member.leftAt = new Date();
  member.sharedTries = session.tries;
  await session.save();

  absorbSession(play, session);
  play.session = null;
  if (save) await play.save();

  // Le nom part avec l'évènement : une notification « quelqu'un est parti »
  // n'apprend rien, « Marine est repartie en solo » si.
  const who = await User.findById(userId).select("username avatar").lean();
  broadcast(session, "members", { left: person(who) });
  return true;
}

// POST /api/mot/session/:code/leave — repartir en solo.
router.post("/session/:code/leave", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const session = await loadSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Cette partie n'existe plus." });
    const date = gameDay();
    const day = await dayFor(date);
    const play = await playFor(req.userId, day);
    const left = await leaveSession(session, req.userId, play);
    if (!left)
      return res.status(409).json({ error: "Tu n'es pas dans cette partie." });
    res.json({ left: true, tries: play.tries });
  } catch (err) {
    console.error("mot session leave error:", err.message);
    res.status(500).json({ error: "Impossible de quitter la partie." });
  }
});

// POST /api/mot/session/:code/guess — proposer un mot à la table.
// Personne n'attend son tour : c'est un envoi libre, arbitré par l'ordre
// d'arrivée au serveur.
router.post("/session/:code/guess", requireAuth, async (req, res) => {
  try {
    if (!requireDict(res)) return;
    const session = await loadSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Cette partie n'existe plus." });

    const date = gameDay();
    if (session.date !== date)
      return res.status(410).json({ error: "Cette partie portait sur le mot d'un autre jour." });

    const member = memberOf(session, req.userId);
    if (!member || member.leftAt)
      return res.status(403).json({ error: "Rejoins la partie avant de proposer un mot." });
    if (session.solved)
      return res.status(409).json({ error: "Le mot a déjà été trouvé." });

    const day = await dayFor(date);
    const engine = engineFor(date, day.word);

    const raw = String(req.body?.word || "");
    const found = resolve(raw);
    if (!found)
      return res.status(422).json({
        error: `Je ne connais pas « ${raw.trim().slice(0, 30)} ».`,
        code: "unknown_word",
      });

    const already = session.guesses.find((g) => g.w === found.word);
    if (already) {
      return res.json({
        repeat: true,
        word: already.w,
        temp: already.temp,
        band: heatBand(already.temp),
        rank: already.rank ?? null,
        by: already.by ? person(already.by) : null,
        solved: false,
        tries: session.tries,
      });
    }

    const win = sameWord(found.word, session.word);
    const sim = win ? 1 : cos(engine.index, found.index);
    // Le rang d'abord : c'est lui qui commande la température dans le
    // voisinage (cf. lib/mots.js → temperature).
    const rank = win ? 0 : engine.ranks.get(found.word) ?? null;
    const temp = win ? 100 : temperature(sim, engine.calib, rank);
    const now = new Date();

    session.guesses.push({
      w: win ? session.word : found.word,
      sim: Math.round(sim * 10000) / 10000,
      temp,
      rank,
      by: req.userId,
      at: now,
    });
    session.tries += 1;

    let payload = {
      word: win ? session.word : found.word,
      temp,
      band: heatBand(temp),
      rank,
      solved: win,
      tries: session.tries,
    };

    if (win) {
      session.solved = true;
      session.solvedBy = req.userId;
      session.solvedAt = now;
      session.timeMs = Math.max(0, now - new Date(session.startedAt || now));
      session.score = scoreFor(session.tries, session.timeMs);
    }
    await session.save();

    const full = await MotSession.findById(session._id).populate(SESSION_POPULATE);

    if (win) {
      await settleWin(full, day);
      payload = {
        ...payload,
        score: full.score,
        timeMs: full.timeMs,
        anecdote: publicAnecdote(day),
      };
      broadcast(full, "solved", payload);
    } else {
      broadcast(full, "guess", {
        ...payload,
        by: person(await User.findById(req.userId).select("username avatar").lean()),
      });
    }

    res.json({ ...payload, session: publicSession(full, day, req.userId) });
  } catch (err) {
    console.error("mot session guess error:", err.message);
    res.status(err.status || 500).json({ error: "Impossible d'enregistrer l'essai." });
  }
});

// Victoire collective : chaque membre ENCORE PRÉSENT repart avec le résultat du
// groupe — mêmes essais, même score, mêmes points. Celui qui était parti avant
// n'y a pas droit : il joue toujours, en solo.
async function settleWin(session, day) {
  const members = activeMembers(session);
  const ids = members.map((m) => String(m.user?._id || m.user));
  const team = members
    .map((m) => m.user)
    .filter(Boolean)
    .map((u) => ({ id: String(u._id), username: u.username, avatar: u.avatar || null }));

  for (const uid of ids) {
    // eslint-disable-next-line no-await-in-loop
    const play = await MotPlay.findOne({ user: uid, date: session.date });
    if (!play || play.solved) continue;
    absorbSession(play, session);
    play.solved = true;
    play.solvedAt = session.solvedAt;
    play.timeMs = session.timeMs;
    play.score = session.score;
    play.wonWith = session._id;
    play.session = null; // la partie est finie : plus de table
    // eslint-disable-next-line no-await-in-loop
    await play.save();

    // Points, une seule fois par joueur (même garde-fou qu'en solo).
    // eslint-disable-next-line no-await-in-loop
    const claim = await MotPlay.updateOne(
      { _id: play._id, pointsGranted: false },
      { $set: { pointsGranted: true } }
    );
    if (!claim.modifiedCount) continue;
    // eslint-disable-next-line no-await-in-loop
    await grantPoints(uid, session.score, "mot", {
      motPlayId: String(play._id),
      date: session.date,
      tries: session.tries,
      session: session.code,
    });
    recordActivity({
      actor: uid,
      type: "mot",
      meta: {
        motPlayId: String(play._id),
        date: session.date,
        score: session.score,
        tries: session.tries,
        timeMs: session.timeMs,
        // L'équipe voyage avec l'évènement : le fil regroupe les cartes d'une
        // même session en une seule (cf. routes/feed.js).
        session: session.code,
        team,
      },
    });
    triggerMissionCheck(uid);
  }

  // Compteurs du jour : une victoire collective, c'est UNE énigme résolue par
  // autant de joueurs.
  await MotDuJour.updateOne({ _id: day._id }, [
    {
      $set: {
        "stats.solved": { $add: [{ $ifNull: ["$stats.solved", 0] }, ids.length] },
        "stats.totalTries": {
          $add: [{ $ifNull: ["$stats.totalTries", 0] }, session.tries * ids.length],
        },
        "stats.bestTries": {
          $cond: [
            {
              $or: [
                { $eq: ["$stats.bestTries", null] },
                { $gt: ["$stats.bestTries", session.tries] },
              ],
            },
            session.tries,
            "$stats.bestTries",
          ],
        },
      },
    },
  ]);
}

// POST /api/mot/session/:code/typing — ce que je suis en train de taper.
//
// LE PLAISIR DU JEU EST LÀ : voir « C… A… R… » se former chez l'autre, c'est
// savoir qu'il tient une piste, et parfois se retenir de proposer le même mot.
// Rien n'est stocké : l'évènement traverse et disparaît.
router.post("/session/:code/typing", requireAuth, async (req, res) => {
  try {
    const session = await loadSession(req.params.code);
    if (!session || session.solved) return res.json({ ok: true });
    const member = memberOf(session, req.userId);
    if (!member || member.leftAt) return res.json({ ok: true });

    const me = await User.findById(req.userId).select("username avatar").lean();
    const text = String(req.body?.text || "").slice(0, 24);
    // On diffuse à tout le monde SAUF soi-même : se voir taper n'apprend rien.
    const others = activeMembers(session)
      .map((m) => String(m.user?._id || m.user))
      .filter((id) => id !== String(req.userId));
    if (others.length)
      emitTo(others, "mot", { code: session.code, kind: "typing", by: person(me), text });
    res.json({ ok: true });
  } catch {
    // Un indicateur de frappe qui échoue ne doit jamais remonter à l'écran.
    res.json({ ok: true });
  }
});

// POST /api/mot/session/:code/invite — carte d'invitation en message privé.
// Même règle que la messagerie : on n'écrit qu'à qui est abonné à soi. Pour les
// autres, il y a le lien (le code EST la clé).
router.post("/session/:code/invite", requireAuth, async (req, res) => {
  try {
    const session = await loadSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Cette partie n'existe plus." });
    if (session.solved)
      return res.status(409).json({ error: "Le mot a été trouvé : la partie est close." });
    const member = memberOf(session, req.userId);
    if (!member || member.leftAt)
      return res.status(403).json({ error: "Rejoins la partie avant d'inviter." });

    const ids = [...new Set((req.body?.userIds || []).map(String))].slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: "Personne à inviter." });

    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: ids } }).select("username following").lean(),
    ]);

    const card = {
      code: session.code,
      date: session.date,
      hostName: me?.username || "",
      players: activeMembers(session).length,
      tries: session.tries || 0,
    };

    const sent = [];
    const skipped = [];
    for (const target of targets) {
      const allowed = (target.following || []).some(
        (id) => String(id) === String(req.userId)
      );
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await deliverCard({
        fromId: req.userId,
        toId: target._id,
        text: String(req.body?.text || "").slice(0, 300),
        mot: card,
      });
      sent.push({ id: String(target._id), username: target.username });
    }
    res.json({ sent, skipped });
  } catch (err) {
    console.error("mot session invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// GET /api/mot/sessions — les tables ouvertes chez les joueurs que je suis.
// C'est le « bouton pour rejoindre la session d'un user qui joue » : pas besoin
// d'attendre une invitation, on voit qui cherche en ce moment.
router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const date = gameDay();
    const me = await User.findById(req.userId).select("following").lean();
    const circle = new Set((me?.following || []).map(String));
    if (!circle.size) return res.json({ sessions: [] });

    const play = await MotPlay.findOne({ user: req.userId, date }).select("solved").lean();
    if (play?.solved) return res.json({ sessions: [] }); // plus rien à y chercher

    const open = await MotSession.find({ date, solved: false })
      .populate([{ path: "host", select: "username avatar" }, { path: "members.user", select: "username avatar" }])
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean();

    const sessions = open
      .map((s) => {
        const actives = (s.members || []).filter((m) => !m.leftAt && m.user);
        // Au moins un joueur que je suis, et je n'y suis pas déjà.
        const mine = actives.some((m) => String(m.user._id) === String(req.userId));
        if (mine) return null;
        if (!actives.some((m) => circle.has(String(m.user._id)))) return null;
        return {
          code: s.code,
          host: person(s.host),
          players: actives.map((m) => person(m.user)),
          tries: s.tries || 0,
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    res.json({ sessions });
  } catch (err) {
    console.error("mot sessions error:", err.message);
    res.status(500).json({ error: "Impossible de lister les parties." });
  }
});

export default router;
