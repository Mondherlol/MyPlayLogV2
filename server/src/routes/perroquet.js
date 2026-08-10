import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import multer from "multer";
import SoundClip from "../models/SoundClip.js";
import PerroquetGame from "../models/PerroquetGame.js";
import PerroquetTake from "../models/PerroquetTake.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { grantPoints } from "../lib/points.js";
import { triggerMissionCheck } from "../lib/missions.js";
import { contourOf, compare } from "../lib/soundContour.js";
import { person } from "./blindtest.js";

// ======================================================================
//  Le Perroquet — imite le son, le plus proche gagne
// ======================================================================
// Une partie : ROUNDS sons tirés au sort, un enregistrement par manche, un
// score de 0 à 100 par manche calculé serveur (lib/soundContour.js).
//
// LE SCORE SE CALCULE ICI ET NULLE PART AILLEURS. Le navigateur saurait le
// faire (la Web Audio API a tout ce qu'il faut) et ça éviterait de téléverser
// l'audio — mais un score calculé par le client est un score que le client peut
// écrire. Et comme on garde de toute façon les enregistrements pour les
// rejouer, le fichier monte : autant mesurer là où c'est incontestable.

const router = express.Router();

const ROUNDS = 5;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SND_DIR = path.join(__dirname, "../../uploads/perroquet");
fs.mkdirSync(SND_DIR, { recursive: true });

// Ce que les navigateurs savent produire (cf. client/src/lib/voiceRecorder.js) :
// webm/opus sur Chrome et Firefox, mp4/AAC sur Safari, ogg sur les vieux
// Firefox. L'extension vient du TYPE MIME et jamais du nom envoyé par le client.
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
      cb(null, `a-${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[base] || ".webm"}`);
    },
  }),
  // Une imitation dure deux secondes. 4 Mo est déjà dix fois trop généreux —
  // c'est la borne « quelqu'un a laissé tourner », pas la taille attendue.
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(EXT, String(file.mimetype).split(";")[0])),
});

// Les URLs de fichiers sont stockées RELATIVES en base (« /uploads/… ») et
// rendues absolues ici, à la sérialisation.
//
// Ce n'est pas un détail de confort : en développement le client tourne sur le
// port de Vite et parle à l'API sur le 4000, donc une URL relative servie telle
// quelle pointerait sur le mauvais serveur. Et stocker l'absolu figerait le
// domaine du jour dans chaque partie — un changement d'adresse rendrait muets
// tous les enregistrements de l'historique.
const abs = (req, u) =>
  !u ? null : /^https?:/i.test(u) ? u : `${req.protocol}://${req.get("host")}${u}`;

// Ce qu'on montre du clip AVANT que la manche soit jouée.
//
// Le CONTOUR reste interdit : il dessine littéralement la mélodie à imiter,
// l'envoyer d'avance reviendrait à donner la solution en clair. Le NOM aussi —
// c'est la réponse, et elle se découvre au verdict.
//
// L'IMAGE, elle, part maintenant avec le son. Choix assumé et discutable : elle
// en dit long (une tête de Yoshi, c'est la réponse en image), mais l'écran
// d'imitation était nu — on écoutait un son sorti de nulle part, sans savoir
// quoi se mettre en tête. Voir qui on imite pendant qu'on imite aide à viser, et
// le verdict garde ce qui compte vraiment : le nom, le score et la comparaison
// des courbes. Pour revenir en arrière, il suffit de retirer cette ligne (le
// client sait se passer d'image, il affiche alors une pastille sonore).
const clipTeaser = (req, c) => ({
  id: String(c._id),
  url: abs(req, c.url),
  difficulty: c.difficulty,
  image: abs(req, c.image) || "",
});

// Le clip une fois la manche jouée : là, tout.
const clipFull = (req, c) => ({
  id: String(c._id),
  url: abs(req, c.url),
  label: c.label,
  game: c.game || null,
  gameId: c.gameId || null,
  difficulty: c.difficulty,
  // L'illustration, s'il y en a une : elle n'arrive qu'ICI, avec la réponse.
  image: abs(req, c.image) || "",
  // Le crédit du déposant, pour les sons de librairie. C'est la contrepartie du
  // dépôt libre : on a envie de savoir de qui vient le cri qu'on vient d'imiter.
  addedBy: c.owner ? c.ownerName || "" : "",
  // L'effet à passer sur la voix du joueur à la révélation. Il n'arrive qu'ICI,
  // avec la réponse : annoncé avant, « voix de robot » soufflerait à moitié de
  // quel personnage il s'agit.
  effect: c.effect || "none",
  contour: c.contour
    ? {
        pitch: c.contour.pitch,
        energy: c.contour.energy,
        // Le masque de voisement part au client : c'est lui qui permet au
        // graphique de rompre le trait dans les silences au lieu de dessiner
        // l'interpolation comme si c'était une mélodie.
        voiced: c.contour.voiced || null,
      }
    : null,
});

// ============================================================
//  Tirage d'une partie
// ============================================================
// On veut une COURBE DE DIFFICULTÉ, pas cinq sons au hasard : commencer par un
// « wahoo » de deux syllabes met en confiance, finir sur une mélodie tordue
// donne envie de recommencer. Tirer uniformément produit régulièrement des
// parties toutes faciles ou toutes infaisables, ce qui est le meilleur moyen de
// faire lâcher un joueur à la deuxième partie.
// `mineId` : l'identifiant du joueur quand il a coché « ajouter mes sons ».
// Sans lui, seuls les sons officiels (owner absent) sortent — c'est la règle
// générale des sons de librairie, cf. routes/perroquetSounds.js.
async function drawClips(excludeIds = [], mineId = null) {
  const match = {
    active: true,
    _id: { $nin: excludeIds },
    ...(mineId
      ? { $or: [{ owner: null }, { owner: new mongoose.Types.ObjectId(mineId) }] }
      : { owner: null }),
  };
  // Un échantillon par palier, puis on trie du plus facile au plus dur.
  const picked = [];
  const seen = new Set();
  for (const tier of [[1, 2], [2, 3], [3, 4], [4, 5]]) {
    const rows = await SoundClip.aggregate([
      { $match: { ...match, difficulty: { $gte: tier[0], $lte: tier[1] } } },
      { $sample: { size: 3 } },
    ]);
    for (const r of rows) {
      const id = String(r._id);
      if (!seen.has(id)) {
        seen.add(id);
        picked.push(r);
      }
    }
  }
  // Complément si la banque est trop maigre pour remplir les paliers.
  if (picked.length < ROUNDS) {
    const rest = await SoundClip.aggregate([
      { $match: { ...match, _id: { $nin: [...seen].map((i) => new mongoose.Types.ObjectId(i)) } } },
      { $sample: { size: ROUNDS * 2 } },
    ]);
    for (const r of rest) {
      if (picked.length >= ROUNDS * 2) break;
      if (!seen.has(String(r._id))) {
        seen.add(String(r._id));
        picked.push(r);
      }
    }
  }
  return picked
    .sort((a, b) => a.difficulty - b.difficulty)
    .slice(0, ROUNDS);
}

// ============================================================
//  POST /api/perroquet/start
// ============================================================
// Crée la partie et rend les manches SANS les réponses. `challenge` rejoue le
// set d'une partie existante, comme le blind test.
router.post("/start", requireAuth, async (req, res) => {
  try {
    let clips;
    let challenge = null;

    if (req.body?.challenge) {
      const src = await PerroquetGame.findById(req.body.challenge)
        .populate("user", "username avatar")
        .lean();
      if (!src) return res.status(404).json({ error: "Défi introuvable." });
      const ids = src.rounds.map((r) => r.clip);
      const rows = await SoundClip.find({ _id: { $in: ids } }).lean();
      const byId = new Map(rows.map((c) => [String(c._id), c]));
      // L'ordre du défi, pas celui de la base : on rejoue la MÊME partie.
      clips = ids.map((id) => byId.get(String(id))).filter(Boolean);
      challenge = src;
    } else {
      // « Ajouter mes sons » : en solo, le joueur est son propre hôte. Ses
      // clips rejoignent le tirage à côté des officiels — jamais à leur place,
      // sinon une librairie de trois sons ferait une partie de trois sons.
      clips = await drawClips([], req.body?.mine ? req.userId : null);
    }

    if (clips.length < 1)
      return res.status(503).json({
        error:
          "La banque de sons est vide. Un administrateur doit la garnir depuis l'onglet « Perroquet » du panneau d'admin.",
      });

    const game = await PerroquetGame.create({
      user: req.userId,
      roundCount: clips.length,
      rounds: clips.map((c) => ({
        clip: c._id,
        label: c.label,
        game: c.game || "",
        clipUrl: c.url,
        imageUrl: c.image || "",
        addedBy: c.owner ? c.ownerName || "" : "",
        effect: c.effect || "none",
      })),
      challengeOf: challenge?._id || null,
      challengedUser: challenge?.user?._id || null,
      challengedScore: challenge?.score ?? null,
    });

    res.status(201).json({
      gameId: String(game._id),
      rounds: clips.map((c) => clipTeaser(req, c)),
      challenge: challenge
        ? {
            user: person(challenge.user),
            score: challenge.score,
            average: challenge.average,
          }
        : null,
    });
  } catch (err) {
    console.error("perroquet start error:", err.message);
    res.status(500).json({ error: "Impossible de lancer la partie." });
  }
});

// ============================================================
//  POST /api/perroquet/:id/round/:index
// ============================================================
// L'enregistrement d'une manche. Multipart : le fichier sous `attempt`.
// Répond avec le score ET les deux contours, pour que le client dessine
// immédiatement la superposition — c'est elle qui rend le score acceptable.
router.post(
  "/:id/round/:index",
  requireAuth,
  upload.single("attempt"),
  async (req, res) => {
    const cleanup = () => {
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    };
    try {
      const game = await PerroquetGame.findById(req.params.id);
      if (!game || String(game.user) !== String(req.userId)) {
        cleanup();
        return res.status(404).json({ error: "Partie introuvable." });
      }
      const i = Number(req.params.index);
      const round = game.rounds[i];
      if (!round) {
        cleanup();
        return res.status(400).json({ error: "Manche inconnue." });
      }
      // Une manche ne se rejoue pas : sans ça, on retente jusqu'au 100.
      if (round.attemptUrl || round.skipped) {
        cleanup();
        return res.status(409).json({ error: "Manche déjà jouée." });
      }

      const clip = await SoundClip.findById(round.clip).lean();
      if (!clip) {
        cleanup();
        return res.status(410).json({ error: "Son introuvable." });
      }

      // --- Manche passée ---
      if (!req.file) {
        round.skipped = true;
        round.score = 0;
        round.band = "miss";
        await game.save();
        return res.json({
          skipped: true,
          score: 0,
          band: "miss",
          clip: clipFull(req, clip),
        });
      }

      // --- Mesure ---
      let contour;
      try {
        contour = await contourOf(req.file.path);
      } catch (e) {
        // Silence, souffle, fichier illisible : ce n'est PAS une erreur
        // serveur. La manche compte, à zéro, et on le dit clairement — sinon le
        // joueur reste bloqué sur une manche qu'il ne peut pas valider.
        cleanup();
        round.skipped = true;
        round.band = "miss";
        await game.save();
        return res.json({
          skipped: true,
          score: 0,
          band: "miss",
          reason:
            e.message === "silence"
              ? "On n'a rien entendu — vérifie ton micro."
              : "Enregistrement trop court.",
          clip: clipFull(req, clip),
        });
      }

      const result = compare(clip.contour, contour);
      // Relatif en base, absolu dans la réponse (cf. `abs` plus haut).
      const rel = `/uploads/perroquet/${req.file.filename}`;
      const url = abs(req, rel);

      round.attemptUrl = rel;
      round.score = result.score;
      round.pitchScore = result.pitch;
      round.energyScore = result.energy;
      round.durationScore = result.duration;
      round.band = result.band;
      round.contour = { pitch: contour.pitch, energy: contour.energy };
      game.score = game.rounds.reduce((s, r) => s + (r.score || 0), 0);
      await game.save();

      // Statistiques du clip, best-effort : sert à repérer les sons injouables.
      SoundClip.updateOne(
        { _id: clip._id },
        { $inc: { timesPlayed: 1, scoreSum: result.score } }
      ).catch(() => {});

      // L'archive des essais (models/PerroquetTake.js). La tentative est déjà
      // dans la manche juste au-dessus : cette ligne-là ne sert pas à rejouer la
      // partie, elle sert à retrouver « tous les cris de ce joueur » sans
      // déplier les parties de tout le monde. Best-effort, comme les
      // statistiques : une archive manquante ne doit pas coûter une manche.
      PerroquetTake.create({
        user: req.userId,
        mode: "solo",
        url: rel,
        clip: clip._id,
        label: clip.label,
        clipUrl: clip.url,
        imageUrl: clip.image || "",
        score: result.score,
        band: result.band,
        game: game._id,
        roundIndex: i,
      }).catch(() => {});

      res.json({
        ...result,
        attemptUrl: url,
        clip: clipFull(req, clip),
        contour: { pitch: contour.pitch, energy: contour.energy, voiced: contour.voiced },
      });
    } catch (err) {
      cleanup();
      console.error("perroquet round error:", err.message);
      res.status(500).json({ error: "Impossible de noter cette imitation." });
    }
  }
);

// ============================================================
//  POST /api/perroquet/:id/finish
// ============================================================
router.post("/:id/finish", requireAuth, async (req, res) => {
  try {
    const game = await PerroquetGame.findById(req.params.id);
    if (!game || String(game.user) !== String(req.userId))
      return res.status(404).json({ error: "Partie introuvable." });
    // Idempotent : un double clic (ou un renvoi réseau) ne doit pas créditer
    // les points deux fois ni republier la partie dans le fil.
    if (game.finished) return res.json(serializeGame(req, game));

    const played = game.rounds.filter((r) => r.attemptUrl);
    // La manche la mieux réussie, pour la carte du fil.
    const best = played.reduce(
      (b, r) => (!b || r.score > b.score ? r : b),
      null
    );
    game.score = game.rounds.reduce((s, r) => s + (r.score || 0), 0);
    game.average = game.rounds.length
      ? Math.round(game.score / game.rounds.length)
      : 0;
    game.bestBand = game.rounds.reduce(
      (best, r) => (BAND_RANK[r.band] > BAND_RANK[best] ? r.band : best),
      "miss"
    );
    game.finished = true;
    await game.save();

    // Points : la MOYENNE, pas le total — sinon allonger la partie suffirait à
    // grimper au classement. Un sans-faute rapporte 100, une partie moyenne 60.
    const pts = Math.round(game.average);
    if (pts > 0)
      grantPoints(req.userId, pts, "perroquet", {
        gameId: String(game._id),
        average: game.average,
      }).catch(() => {});

    if (played.length)
      recordActivity({
        actor: req.userId,
        type: "perroquet",
        meta: {
          perroquetId: String(game._id),
          average: game.average,
          rounds: game.rounds.length,
          bestBand: game.bestBand,
          // Le meilleur enregistrement de la partie : c'est LUI que la carte du
          // fil fait écouter. Une carte qui annonce un score sans donner le cri
          // à entendre raterait tout l'intérêt du jeu.
          bestClip: best?.label || null,
          bestUrl: best?.attemptUrl || null,
        },
      });

    // Signature à un seul argument, et synchrone (cf. lib/missions.js) : elle
    // ne rend pas de promesse, un .catch() ici planterait la requête.
    triggerMissionCheck(req.userId);

    res.json(serializeGame(req, game));
  } catch (err) {
    console.error("perroquet finish error:", err.message);
    res.status(500).json({ error: "Impossible de clore la partie." });
  }
});

const BAND_RANK = { miss: 0, meh: 1, close: 2, great: 3, perfect: 4 };

const serializeGame = (req, g) => ({
  gameId: String(g._id),
  score: g.score,
  average: g.average,
  bestBand: g.bestBand,
  rounds: g.rounds.map((r) => ({
    label: r.label,
    game: r.game || null,
    image: abs(req, r.imageUrl) || "",
    addedBy: r.addedBy || "",
    effect: r.effect || "none",
    clipUrl: abs(req, r.clipUrl),
    attemptUrl: abs(req, r.attemptUrl),
    score: r.score,
    band: r.band,
    skipped: r.skipped,
  })),
});

// ============================================================
//  GET /api/perroquet/:id/results
// ============================================================
// Le récap d'une partie — la sienne ou celle d'un autre (pour la carte du fil
// et l'écran de défi). Public au même titre que les autres mini-jeux : c'est
// fait pour s'écouter les uns les autres.
router.get("/:id/results", requireAuth, async (req, res) => {
  try {
    const game = await PerroquetGame.findById(req.params.id)
      .populate("user", "username avatar")
      .lean();
    if (!game) return res.status(404).json({ error: "Partie introuvable." });
    res.json({ ...serializeGame(req, game), user: person(game.user) });
  } catch (err) {
    console.error("perroquet results error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement." });
  }
});

// ============================================================
//  GET /api/perroquet/leaderboard
// ============================================================
// Même contrat que /blindtest/leaderboard et /pixel/leaderboard : le widget de
// l'arcade bascule de l'un à l'autre sans savoir de quel jeu il parle.
//
// `bestScore` est la MEILLEURE MOYENNE et non le meilleur total : le total
// dépend du nombre de manches, la moyenne est la seule mesure comparable.
router.get("/leaderboard", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const ids = [
      new mongoose.Types.ObjectId(req.userId),
      ...(me?.following || []).map((id) => new mongoose.Types.ObjectId(id)),
    ];
    const rows = await PerroquetGame.aggregate([
      { $match: { user: { $in: ids }, finished: true } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$user",
          score: { $sum: "$average" },
          games: { $sum: 1 },
          gameDocId: { $first: "$_id" },
          bestScore: { $max: "$average" },
          date: { $max: "$createdAt" },
        },
      },
      { $sort: { score: -1, date: -1 } },
      { $limit: 30 },
    ]);
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("username avatar")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const entries = rows
      .map((r) => {
        const u = byId.get(String(r._id));
        if (!u) return null;
        return {
          user: person(u),
          score: r.score,
          games: r.games,
          bestScore: r.bestScore,
          perroquetId: String(r.gameDocId), // cible du bouton « Défier »
          date: r.date,
          isMe: String(r._id) === String(req.userId),
        };
      })
      .filter(Boolean);
    res.json({ entries });
  } catch (err) {
    console.error("perroquet leaderboard error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement du classement." });
  }
});

export default router;
