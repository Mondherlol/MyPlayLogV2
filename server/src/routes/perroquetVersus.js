import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import mongoose from "mongoose";
import PerroquetVersus, {
  MAX_PLAYERS,
  LISTEN_SEC,
  RECORD_SEC,
  REVEAL_SEC,
} from "../models/PerroquetVersus.js";
import SoundClip from "../models/SoundClip.js";
import PerroquetTake from "../models/PerroquetTake.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { emitTo, onlineAmong } from "../lib/realtime.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { contourOf, compare } from "../lib/soundContour.js";
import { person } from "./blindtest.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import {
  makeCode,
  makeRoomQueue,
  makeClock,
  makeBaseStore,
  idOf,
  isHost,
  activePlayers,
  playerIds,
  allIds,
  findPlayer,
} from "../lib/versusRoom.js";

// ======================================================================
//  Le Perroquet — salons de versus
// ======================================================================
// Tout le monde entend le même son, tout le monde enregistre pendant la MÊME
// fenêtre, puis on écoute les six tentatives classées.
//
// -------------------------------------- pourquoi le chrono et pas les joueurs
// Les phases s'enchaînent toutes seules côté serveur (lib/versusRoom.js). Il
// serait plus simple de faire cliquer l'hôte sur « suivant » — mais alors la
// partie dépendrait d'un navigateur resté ouvert, et surtout la fenêtre
// d'enregistrement ne serait plus commune : celui qui rend sa copie en premier
// attendrait indéfiniment que l'hôte se réveille. Une fenêtre commune EST la
// règle du jeu ici, elle ne peut pas dépendre de quelqu'un.
//
// ------------------------------------------------- ce qui n'est pas une course
// Contrairement aux autres versus du site, aucune manche ne se clôt « parce que
// quelqu'un a gagné ». Elle se clôt quand la fenêtre expire, ou quand tout le
// monde a rendu — et dans ce dernier cas on n'attend pas le chrono pour rien.

const router = express.Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SND_DIR = path.join(__dirname, "../../uploads/perroquet");
fs.mkdirSync(SND_DIR, { recursive: true });

const EXT = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, SND_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(null, `v-${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[base] || ".webm"}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(EXT, String(file.mimetype).split(";")[0])),
});

const clock = makeClock("pqversus");
const bases = makeBaseStore();
const POPULATE = [
  { path: "host", select: "username avatar" },
  { path: "players.user", select: "username avatar" },
];
const withRoom = makeRoomQueue((code) =>
  PerroquetVersus.findOne({ code: String(code) }).populate(POPULATE)
);

const touch = (room) => {
  room.lastActiveAt = new Date();
};

// Les diffusions n'ont pas de `req` : l'origine est retenue au lancement.
const absFor = (code, u) =>
  !u ? null : /^https?:/i.test(u) ? u : `${bases.get(code)}${u}`;

// ============================================================
//  Sérialisation
// ============================================================
// LA RÈGLE : `label` et `game` — la réponse — ne sortent QU'EN PHASE `reveal`.
// Pendant qu'on enregistre, savoir qu'on imite Yoshi ne donne aucun avantage
// mécanique, mais la découverte fait partie du plaisir et l'annoncer d'avance
// la brûle. Les tentatives des autres, elles, sont un vrai secret : les
// entendre pendant qu'on cherche son propre cri influencerait le sien.
function roundView(room, meId) {
  const r = room.rounds[room.index];
  if (!r || room.phase === "lobby") return null;
  const revealing = room.phase === "reveal";
  const mine = r.takes.find((t) => idOf(t.user) === String(meId));

  return {
    index: room.index,
    total: room.rounds.length,
    clipUrl: absFor(room.code, r.clipUrl),
    difficulty: r.difficulty,
    // La réponse, seulement à la révélation.
    label: revealing ? r.label : null,
    game: revealing ? r.game || null : null,
    // L'illustration ne sort qu'avec la réponse : la montrer pendant qu'on
    // imite reviendrait à afficher la solution en grand.
    image: revealing ? absFor(room.code, r.imageUrl) || "" : "",
    addedBy: revealing ? r.addedBy || "" : "",
    // Comme la réponse : l'effet ne sort qu'à la révélation. C'est là qu'on
    // entend les six imitations passées au robot, et c'est tout le plaisir de
    // cette phase.
    effect: revealing ? r.effect || "none" : "none",
    contour: revealing ? clipContour(r) : null,
    // Qui a déjà rendu : affiché pendant l'enregistrement (sans les scores).
    // C'est ce qui dit « plus que toi » et évite d'attendre bêtement.
    done: r.takes.filter((t) => t.submitted).map((t) => idOf(t.user)),
    // Ma propre note, dès qu'elle est calculée : je peux la voir avant la
    // révélation générale, ça n'apprend rien sur les autres.
    mine: mine?.submitted
      ? {
          score: mine.score,
          band: mine.band,
          pitch: mine.pitchScore,
          energy: mine.energyScore,
          duration: mine.durationScore,
          attemptUrl: absFor(room.code, mine.attemptUrl),
          contour: mine.contour,
        }
      : null,
    // Le palmarès de la manche : à la révélation seulement, et c'est tout
    // l'écran de cette phase.
    takes: revealing
      ? [...r.takes]
          .sort((a, b) => (a.rank || 99) - (b.rank || 99))
          .map((t) => ({
            userId: idOf(t.user),
            score: t.score,
            band: t.band,
            rank: t.rank,
            submitted: t.submitted,
            attemptUrl: absFor(room.code, t.attemptUrl),
            contour: t.contour,
          }))
      : null,
  };
}

// Le contour du son de référence, chargé paresseusement : il ne sert qu'à la
// révélation, inutile de le traîner dans chaque diffusion.
const clipContours = new Map();
function clipContour(round) {
  return clipContours.get(String(round.clip)) || null;
}

function serializeRoom(room, meId) {
  const ids = allIds(room);
  const online = onlineAmong(ids);
  const hostId = idOf(room.host);
  return {
    code: room.code,
    hostId,
    isHost: hostId === String(meId),
    roundCount: room.roundCount,
    customSounds: !!room.customSounds,
    phase: room.phase,
    index: room.index,
    phaseStartsAt: room.phaseStartsAt,
    phaseEndsAt: room.phaseEndsAt,
    // L'heure du serveur : le client corrige l'écart avec la sienne, sinon une
    // machine en avance de 30 s ouvrirait sa fenêtre d'enregistrement trop tôt
    // et raterait le début du son.
    now: Date.now(),
    timings: { listen: LISTEN_SEC, record: RECORD_SEC, reveal: REVEAL_SEC },
    players: room.players.map((p) => {
      const id = idOf(p.user);
      return {
        ...person(p.user),
        id,
        score: p.score || 0,
        wins: p.wins || 0,
        armed: !!p.armed,
        online: online.has(id),
        isHost: id === hostId,
        isMe: id === String(meId),
        left: !!p.leftAt,
      };
    }),
    round: roundView(room, meId),
    started: !!room.startedAt,
    endedAt: room.endedAt,
  };
}

// Chacun reçoit SA vue (sa note, sa fiche de manche).
function toEachRoom(room, kind, payload = {}) {
  for (const id of playerIds(room)) {
    emitTo([id], "pqversus", {
      code: room.code,
      kind,
      room: serializeRoom(room, id),
      ...payload,
    });
  }
}

// ============================================================
//  Machine à phases
// ============================================================
const at = (sec) => new Date(Date.now() + sec * 1000);

async function beginListen(room) {
  room.phase = "listen";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(LISTEN_SEC);
  touch(room);
  await room.save();
  toEachRoom(room, "round");
  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, (r) => (r && r.phase === "listen" ? beginRecord(r) : null))
  );
}

async function beginRecord(room) {
  room.phase = "record";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(RECORD_SEC);
  touch(room);
  await room.save();
  toEachRoom(room, "record");
  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, (r) => (r && r.phase === "record" ? beginReveal(r) : null))
  );
}

// Le classement de la manche, puis la révélation.
async function beginReveal(room) {
  const round = room.rounds[room.index];
  if (!round) return finish(room);

  // Ceux qui n'ont rien rendu ont une ligne à zéro : sans elle ils
  // disparaîtraient du tableau, et on ne saurait pas s'ils ont raté la fenêtre
  // ou quitté la partie.
  for (const id of playerIds(room)) {
    if (!round.takes.some((t) => idOf(t.user) === id))
      round.takes.push({ user: id, score: 0, band: "miss", submitted: false });
  }

  const ordered = [...round.takes].sort((a, b) => b.score - a.score);
  ordered.forEach((t, i) => {
    t.rank = i + 1;
  });
  const winner = ordered[0];
  // Une manche où personne n'a rien rendu n'a pas de vainqueur : sans ce
  // garde-fou, le premier de la liste raflerait la manche avec 0.
  if (winner?.score > 0) {
    const p = findPlayer(room, idOf(winner.user));
    if (p) p.wins = (p.wins || 0) + 1;
  }
  for (const t of round.takes) {
    const p = findPlayer(room, idOf(t.user));
    if (p) p.score = (p.score || 0) + (t.score || 0);
  }

  // Le contour du son de référence, pour les courbes superposées.
  if (!clipContours.has(String(round.clip))) {
    const clip = await SoundClip.findById(round.clip).select("contour").lean();
    if (clip?.contour)
      clipContours.set(String(round.clip), {
        pitch: clip.contour.pitch,
        energy: clip.contour.energy,
        voiced: clip.contour.voiced || null,
      });
  }

  room.phase = "reveal";
  room.phaseStartsAt = new Date();
  room.phaseEndsAt = at(REVEAL_SEC);
  touch(room);
  await room.save();
  toEachRoom(room, "reveal");

  clock.at(room.code, room.phaseEndsAt.getTime(), () =>
    withRoom(room.code, (r) => {
      if (!r || r.phase !== "reveal") return null;
      if (r.index + 1 >= r.rounds.length) return finish(r);
      r.index += 1;
      return beginListen(r);
    })
  );
}

async function finish(room) {
  room.phase = "done";
  room.endedAt = new Date();
  room.phaseEndsAt = null;
  touch(room);
  await room.save();
  clock.stop(room.code);
  toEachRoom(room, "done");

  // Points et fil : la MOYENNE, comme en solo — le total dépendrait du nombre
  // de manches et ne se comparerait pas d'une partie à l'autre. Le vainqueur
  // touche un petit supplément : c'est la seule chose qui distingue une
  // victoire d'un bon score, et sans elle le mode n'a pas d'enjeu.
  const table = [...activePlayers(room)].sort((a, b) => b.score - a.score);
  const n = room.rounds.length || 1;
  for (let i = 0; i < table.length; i += 1) {
    const p = table[i];
    const avg = Math.round((p.score || 0) / n);
    const pts = avg + (i === 0 && avg > 0 ? 20 : 0);
    if (pts > 0)
      grantPoints(idOf(p.user), pts, "perroquetversus", {
        code: room.code,
        rank: i + 1,
        average: avg,
      }).catch(() => {});

    // Une entrée PAR JOUEUR (chacun a son rang et ses points), mais le fil n'en
    // montrera qu'une : routes/feed.js dédoublonne par meta.versusId, comme
    // pour les autres versus.
    recordActivity({
      actor: idOf(p.user),
      type: "pqversus",
      meta: {
        versusId: room.code,
        rank: i + 1,
        players: table.length,
        average: avg,
        rounds: n,
        total: n,
        // `players` et non `table` : la carte de versus du fil est PARTAGÉE par
        // les cinq modes (routes/feed.js) et lit ce nom-là. Réutiliser sa forme
        // exacte évite d'ajouter une branche pour dire la même chose.
        players: table.map((q, j) => ({
          id: idOf(q.user),
          username: q.user?.username || "",
          avatar: q.user?.avatar || null,
          average: Math.round((q.score || 0) / n),
          wins: q.wins || 0,
          rank: j + 1,
        })),
      },
    });
  }
}

// ============================================================
//  Tirage
// ============================================================
// `ownerIds` : les joueurs dont la librairie personnelle entre dans le tirage.
// Vide (le défaut) = sons officiels seulement. La liste vient TOUJOURS des
// joueurs présents au moment du lancement — c'est ce qui fait qu'on ne tombe
// jamais sur le son d'un inconnu, cf. routes/perroquetSounds.js.
async function drawRounds(count, ownerIds = []) {
  const ids = ownerIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const rows = await SoundClip.aggregate([
    {
      $match: {
        active: true,
        ...(ids.length ? { $or: [{ owner: null }, { owner: { $in: ids } }] } : { owner: null }),
      },
    },
    { $sample: { size: count * 3 } },
  ]);
  const seen = new Set();
  const picked = [];
  for (const r of rows) {
    const k = String(r._id);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(r);
  }
  return picked
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, count)
    .map((c) => ({
      clip: c._id,
      label: c.label,
      game: c.game || "",
      clipUrl: c.url,
      imageUrl: c.image || "",
      difficulty: c.difficulty,
      addedBy: c.owner ? c.ownerName || "" : "",
      effect: c.effect || "none",
    }));
}

// ============================================================
//  Routes
// ============================================================

// POST / — créer un salon
router.post("/", async (req, res) => {
  try {
    // Les sons officiels seulement : c'est le tirage par défaut d'un salon
    // neuf. Compter aussi les librairies personnelles laisserait créer un salon
    // qui n'a en réalité rien à jouer si l'hôte ne coche pas les sons perso.
    const active = await SoundClip.countDocuments({ active: true, owner: null });
    if (active < 3)
      return res.status(503).json({
        error:
          "Pas assez de sons en banque pour un versus. Un administrateur doit la garnir (onglet « Perroquet »).",
      });

    let code;
    for (let i = 0; i < 6; i += 1) {
      code = makeCode();
      if (!(await PerroquetVersus.exists({ code }))) break;
    }
    const roundCount = Math.max(3, Math.min(8, Number(req.body?.rounds) || 5));
    const room = await PerroquetVersus.create({
      code,
      host: req.userId,
      roundCount,
      players: [{ user: req.userId }],
    });
    bases.set(code, `${req.protocol}://${req.get("host")}`);
    await room.populate(POPULATE);
    res.status(201).json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("pqversus create error:", err.message);
    res.status(500).json({ error: "Impossible de créer le salon." });
  }
});

// GET /:code — l'état du salon
router.get("/:code", async (req, res) => {
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.status(404).json({ error: "Salon introuvable." });
    // L'origine se réapprend à chaque visite : si le process a redémarré, le
    // magasin est vide et les URLs d'audio sortiraient relatives.
    if (!bases.has(room.code))
      bases.set(room.code, `${req.protocol}://${req.get("host")}`);
    res.json({ room: serializeRoom(room, req.userId) });
  } catch (err) {
    console.error("pqversus get error:", err.message);
    res.status(500).json({ error: "Erreur de chargement." });
  }
});

// POST /:code/join
router.post("/:code/join", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (room.phase === "done")
        return { status: 410, body: { error: "Cette partie est terminée." } };

      const existing = findPlayer(room, req.userId);
      if (existing) {
        // Retour après une déconnexion : on le remet en jeu plutôt que de le
        // refuser. Un tunnel qui saute ne doit pas exclure de la partie.
        existing.leftAt = null;
      } else {
        if (room.startedAt)
          return { status: 409, body: { error: "La partie a déjà commencé." } };
        if (activePlayers(room).length >= MAX_PLAYERS)
          return { status: 409, body: { error: "Le salon est complet." } };
        room.players.push({ user: req.userId });
      }
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("pqversus join error:", err.message);
    res.status(500).json({ error: "Impossible de rejoindre." });
  }
});

// POST /:code/armed — « mon micro est prêt »
// Exigé avant le départ : découvrir au premier son que deux joueurs n'ont pas
// autorisé leur micro gâche la manche pour tout le monde, sans rattrapage.
router.post("/:code/armed", async (req, res) => {
  try {
    await withRoom(req.params.code, async (room) => {
      if (!room) return;
      const p = findPlayer(room, req.userId);
      if (!p) return;
      p.armed = req.body?.armed !== false;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("pqversus armed error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ============================================================
//  POST /:code/options — les réglages de l'hôte (avant le départ)
// ============================================================
// Un seul réglage pour l'instant : les sons personnalisés. Il est diffusé à
// tout le salon plutôt que gardé côté hôte, parce qu'il change ce que les
// autres vont jouer — et parce que c'est LUI qui donne envie d'aller remplir sa
// librairie avant que la partie ne parte.
router.post("/:code/options", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (!isHost(room, req.userId))
        return { status: 403, body: { error: "Seul l'hôte change les réglages." } };
      if (room.startedAt)
        return { status: 409, body: { error: "La partie a déjà commencé." } };

      if (typeof req.body?.customSounds === "boolean")
        room.customSounds = req.body.customSounds;
      touch(room);
      await room.save();
      await room.populate(POPULATE);
      toEachRoom(room, "lobby");
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("pqversus options error:", err.message);
    res.status(500).json({ error: "Réglage impossible." });
  }
});

// ============================================================
//  GET /:code/pool — ce que les joueurs présents apportent
// ============================================================
// Le décompte affiché sous l'interrupteur de l'hôte. Séparé de la
// sérialisation du salon parce qu'il coûte une requête : la diffuser à chaque
// évènement du salon (donc à chaque copie rendue) reviendrait à compter la
// banque six fois par manche pour un chiffre qui n'intéresse que le lobby.
router.get("/:code/pool", async (req, res) => {
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) })
      .select("players")
      .lean();
    if (!room) return res.status(404).json({ error: "Salon introuvable." });
    const ids = (room.players || [])
      .filter((p) => !p.leftAt)
      .map((p) => new mongoose.Types.ObjectId(String(p.user)));

    const rows = await SoundClip.aggregate([
      { $match: { active: true, owner: { $in: ids } } },
      { $group: { _id: "$ownerName", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]);
    res.json({
      custom: rows.reduce((s, r) => s + r.n, 0),
      contributors: rows.map((r) => ({ name: r._id || "?", count: r.n })),
    });
  } catch (err) {
    console.error("pqversus pool error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// POST /:code/start — l'hôte lance
router.post("/:code/start", async (req, res) => {
  try {
    const out = await withRoom(req.params.code, async (room) => {
      if (!room) return { status: 404, body: { error: "Salon introuvable." } };
      if (!isHost(room, req.userId))
        return { status: 403, body: { error: "Seul l'hôte lance la partie." } };
      if (room.startedAt)
        return { status: 409, body: { error: "La partie a déjà commencé." } };
      if (activePlayers(room).length < 2)
        return { status: 409, body: { error: "Il faut être au moins deux." } };

      // Les librairies des joueurs PRÉSENTS, et seulement si l'hôte a coché.
      // La liste est figée ici, au lancement : quelqu'un qui rejoindrait après
      // (reconnexion mise à part, impossible) n'ajouterait rien en cours de
      // route, et les manches resteraient celles qu'on a annoncées au départ.
      const rounds = await drawRounds(
        room.roundCount,
        room.customSounds ? activePlayers(room).map((p) => idOf(p.user)) : []
      );
      if (rounds.length < 1)
        return { status: 503, body: { error: "Banque de sons vide." } };

      room.rounds = rounds;
      room.index = 0;
      room.startedAt = new Date();
      bases.set(room.code, `${req.protocol}://${req.get("host")}`);
      await beginListen(room);
      return { status: 200, body: { room: serializeRoom(room, req.userId) } };
    });
    if (!out) return res.status(404).json({ error: "Salon introuvable." });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error("pqversus start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer." });
  }
});

// POST /:code/take — rendre son imitation
//
// Le fichier est décodé et noté AVANT de prendre le verrou du salon : une
// analyse ffmpeg dure une centaine de millisecondes, et six joueurs qui rendent
// leur copie à la même seconde sérialiseraient six décodages derrière la file
// du salon. On ne garde le verrou que pour l'écriture.
router.post("/:code/take", upload.single("attempt"), async (req, res) => {
  const cleanup = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  };
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) }).lean();
    if (!room) {
      cleanup();
      return res.status(404).json({ error: "Salon introuvable." });
    }
    if (room.phase !== "record") {
      cleanup();
      return res.status(409).json({ error: "Ce n'est pas le moment d'enregistrer." });
    }
    const round = room.rounds[room.index];
    if (!round) {
      cleanup();
      return res.status(409).json({ error: "Manche inconnue." });
    }
    if (round.takes.some((t) => idOf(t.user) === String(req.userId))) {
      cleanup();
      return res.status(409).json({ error: "Tu as déjà rendu ta copie." });
    }

    let result = null;
    let contour = null;
    if (req.file) {
      try {
        contour = await contourOf(req.file.path);
        const clip = await SoundClip.findById(round.clip).select("contour").lean();
        result = compare(clip?.contour, contour);
      } catch {
        // Silence, souffle, fichier illisible : la manche compte, à zéro. On ne
        // renvoie pas d'erreur — le joueur ne peut rien y faire, la fenêtre est
        // déjà passée.
        cleanup();
        result = null;
      }
    }

    const rel = req.file && result ? `/uploads/perroquet/${req.file.filename}` : null;
    if (req.file && !result) cleanup();

    const out = await withRoom(req.params.code, async (r) => {
      if (!r || r.phase !== "record") return null;
      const rd = r.rounds[r.index];
      if (!rd || rd.takes.some((t) => idOf(t.user) === String(req.userId))) return null;
      rd.takes.push({
        user: req.userId,
        attemptUrl: rel,
        score: result?.score || 0,
        pitchScore: result?.pitch || 0,
        energyScore: result?.energy || 0,
        durationScore: result?.duration || 0,
        band: result?.band || "miss",
        contour: contour
          ? { pitch: contour.pitch, energy: contour.energy, voiced: contour.voiced }
          : null,
        submitted: true,
      });
      touch(r);
      await r.save();
      await r.populate(POPULATE);
      toEachRoom(r, "took");

      // Tout le monde a rendu : on n'attend pas la fin du chrono pour rien.
      // C'est la SEULE clôture anticipée du mode — et elle ne dépend de la
      // performance de personne, juste du fait que plus rien n'arrivera.
      if (rd.takes.filter((t) => t.submitted).length >= playerIds(r).length) {
        clock.stop(r.code);
        await beginReveal(r);
      }
      return true;
    });

    if (!out) return res.status(409).json({ error: "Copie non retenue." });

    // L'archive des essais (models/PerroquetTake.js). ELLE COMPTE DOUBLE ICI :
    // le salon porte un TTL de six heures, donc sans cette ligne les
    // enregistrements d'une soirée à six disparaissent de la base pendant la
    // nuit — en laissant leurs fichiers sur le disque. Écrite après le verrou,
    // pour n'archiver que les copies effectivement retenues.
    if (rel)
      PerroquetTake.create({
        user: req.userId,
        mode: "versus",
        url: rel,
        clip: round.clip,
        label: round.label || "",
        clipUrl: round.clipUrl || "",
        imageUrl: round.imageUrl || "",
        score: result?.score || 0,
        band: result?.band || "miss",
        versusCode: room.code,
      }).catch(() => {});

    res.json({
      score: result?.score || 0,
      band: result?.band || "miss",
      ...(result || {}),
    });
  } catch (err) {
    cleanup();
    console.error("pqversus take error:", err.message);
    res.status(500).json({ error: "Impossible d'envoyer l'imitation." });
  }
});

// POST /:code/leave
router.post("/:code/leave", async (req, res) => {
  try {
    await withRoom(req.params.code, async (room) => {
      if (!room) return;
      const p = findPlayer(room, req.userId);
      if (!p) return;
      p.leftAt = new Date();
      touch(room);
      // L'hôte s'en va avant le départ : le salon n'a plus de raison d'être.
      // En cours de partie on continue — les autres jouent, la partie se
      // termine normalement.
      if (!room.startedAt && isHost(room, req.userId) && activePlayers(room).length) {
        room.host = activePlayers(room)[0].user;
      }
      await room.save();
      await room.populate(POPULATE);
      if (!activePlayers(room).length) {
        clock.stop(room.code);
      } else {
        toEachRoom(room, "lobby");
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("pqversus leave error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /:code/results — le tableau final (carte du fil, partage)
router.get("/:code/results", async (req, res) => {
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) })
      .populate(POPULATE)
      .lean();
    if (!room) return res.status(404).json({ error: "Salon introuvable." });
    const n = room.rounds.length || 1;
    const table = [...room.players]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((p, i) => ({
        ...person(p.user),
        rank: i + 1,
        average: Math.round((p.score || 0) / n),
        wins: p.wins || 0,
      }));
    res.json({ code: room.code, rounds: n, endedAt: room.endedAt, table });
  } catch (err) {
    console.error("pqversus results error:", err.message);
    res.status(500).json({ error: "Erreur de chargement." });
  }
});

// ============================================================
//  POST /:code/invite — la carte d'invitation en message privé
// ============================================================
// Même forme que les quatre autres salons : on n'invente rien, la carte de la
// messagerie est partagée et attend exactement ces champs.
//
// Le filtre sur les abonnés n'est pas de la politesse : sans lui, n'importe qui
// pourrait déposer une carte dans le fil de n'importe qui. On n'écrit qu'à ceux
// qui suivent déjà l'expéditeur — les autres ressortent dans `skipped`, et
// l'interface le dit plutôt que de faire semblant d'avoir envoyé.
router.post("/:code/invite", async (req, res) => {
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.status(404).json({ error: "Ce salon n'existe plus." });
    if (!allIds(room).includes(String(req.userId)))
      return res.status(403).json({ error: "Rejoins le salon avant d'inviter." });
    if (room.startedAt)
      return res.status(409).json({ error: "La partie a déjà commencé." });

    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [...new Set((req.body?.conversationIds || []).map(String))].slice(0, 10);
    if (!userIds.length && !conversationIds.length)
      return res.status(400).json({ error: "Personne à inviter." });

    const [me, targets] = await Promise.all([
      User.findById(req.userId).select("username").lean(),
      User.find({ _id: { $in: userIds } }).select("username following").lean(),
    ]);

    const card = {
      kind: "perroquet",
      code: room.code,
      hostName: me?.username || "",
      players: activePlayers(room).length,
      maxPlayers: MAX_PLAYERS,
      rounds: room.roundCount,
    };
    const text = String(req.body?.text || "").slice(0, 300);

    const sent = [];
    const skipped = [];
    for (const target of targets) {
      const allowed = (target.following || []).some((id) => String(id) === String(req.userId));
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await deliverCard({ fromId: req.userId, toId: target._id, text, versus: card });
      sent.push({ id: String(target._id), username: target.username });
    }

    const groups = [];
    for (const cid of conversationIds) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await deliverCardToConversation({
        fromId: req.userId,
        conversationId: cid,
        text,
        versus: card,
      });
      if (ok) groups.push(cid);
    }

    res.json({ sent, skipped, groups: groups.length });
  } catch (err) {
    console.error("pqversus invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

// ============================================================
//  GET /:code/card — l'état du salon pour la carte de la messagerie
// ============================================================
// Séparé de `GET /:code`, qui répondrait la manche en cours — donc l'URL du son
// à imiter. Une carte relue dans un fil de discussion n'a aucune raison de
// distribuer la réponse de la manche que les autres sont en train de jouer.
//
// Un salon disparu n'est PAS une erreur : c'est l'issue normale d'une carte
// relue trois jours plus tard. On répond « gone » en 200 pour que le client
// l'affiche au lieu de le traiter comme une panne.
router.get("/:code/card", async (req, res) => {
  try {
    const room = await PerroquetVersus.findOne({ code: String(req.params.code) }).populate(
      POPULATE
    );
    if (!room) return res.json({ state: "gone" });
    const active = activePlayers(room);
    const done = room.phase === "done" || !!room.endedAt;
    const champ = done
      ? [...room.players].filter((p) => !p.leftAt).sort((a, b) => (b.score || 0) - (a.score || 0))[0]
      : null;
    res.json({
      state: done ? "done" : room.startedAt ? "live" : "lobby",
      players: active.map((p) => person(p.user)),
      count: active.length,
      max: MAX_PLAYERS,
      rounds: room.roundCount,
      index: room.index,
      mine: allIds(room).includes(String(req.userId)),
      winner: champ ? person(champ.user)?.username || null : null,
    });
  } catch (err) {
    console.error("pqversus card error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
