import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import SoundClip from "../models/SoundClip.js";
import PerroquetGame from "../models/PerroquetGame.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { contourOf } from "../lib/soundContour.js";

// ======================================================================
//  La librairie de sons d'un joueur
// ======================================================================
// Le pendant communautaire de routes/perroquetAdmin.js : n'importe qui peut
// déposer ses propres sons, sans passer par un administrateur.
//
// ------------------------------------------- pourquoi ça ne casse pas le jeu
// Un dépôt libre dans la banque commune la ferait pourrir en une semaine : des
// sons trop longs, des bruits sans hauteur, des blagues. La règle qui rend
// l'ouverture possible est donc simple et tient en une ligne :
//
//   UN SON DE JOUEUR NE SORT JAMAIS TOUT SEUL.
//
// Il n'entre dans le tirage que si la partie a coché « sons personnalisés » —
// en solo c'est le joueur lui-même, en versus c'est l'hôte — et seuls les sons
// des joueurs PRÉSENTS à cette table sont ajoutés. Conséquence : un son bancal
// n'embête que ceux qui ont choisi de jouer avec, et personne ne tombe dessus
// dans une partie normale. C'est aussi ce qui rend l'auto-modération inutile :
// on ne modère pas ce que personne ne subit.
//
// --------------------------------------------------------------- la durée
// Cinq secondes, pas plus. Le découpage se fait DANS LE NAVIGATEUR (cf.
// client/src/components/AudioTrimmer.jsx) : le joueur voit sa forme d'onde et
// glisse deux poignées. Le serveur ne recoupe rien — il revérifie seulement, et
// refuse au-delà. Un rognage serveur choisirait à la place du joueur quelles
// cinq secondes garder, ce qui est exactement la décision qu'on ne peut pas
// prendre pour lui.
const router = express.Router();
router.use(requireAuth);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_DIR = path.join(__dirname, "../../uploads/perroquet/user");
fs.mkdirSync(USER_DIR, { recursive: true });

// Le trimmer rend toujours du WAV (c'est ce que la Web Audio API sait réencoder
// sans bibliothèque). Les autres types sont là pour les navigateurs qui
// enverraient le fichier d'origine faute de savoir le décoder.
const EXT = {
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
};

// Cinq secondes de PCM tiennent largement dedans ; la borne est là pour le
// fichier « on a oublié de couper », pas pour l'usage normal.
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_MS = 5200; // 5 s + la marge d'arrondi du décodage
const MIN_MS = 250;
// De quoi composer plusieurs parties sans que la librairie devienne un disque
// dur. C'est aussi la borne qui empêche un compte de remplir le serveur.
const MAX_PER_USER = 40;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, USER_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(null, `u-${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[base] || ".wav"}`);
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(EXT, String(file.mimetype).split(";")[0])),
});

const abs = (req, u) =>
  !u ? null : /^https?:/i.test(u) ? u : `${req.protocol}://${req.get("host")}${u}`;

const serialize = (req, c) => ({
  id: String(c._id),
  label: c.label,
  game: c.game || "",
  url: abs(req, c.url),
  difficulty: c.difficulty,
  active: c.active,
  durationMs: c.contour?.durationMs || 0,
  timesPlayed: c.timesPlayed || 0,
  avgScore: c.timesPlayed ? Math.round(c.scoreSum / c.timesPlayed) : null,
  createdAt: c.createdAt,
});

// ============================================================
//  GET / — ma librairie
// ============================================================
router.get("/", async (req, res) => {
  try {
    const rows = await SoundClip.find({ owner: req.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      items: rows.map((c) => serialize(req, c)),
      max: MAX_PER_USER,
      maxSeconds: 5,
    });
  } catch (err) {
    console.error("perroquet library list error:", err.message);
    res.status(500).json({ error: "Librairie illisible." });
  }
});

// ============================================================
//  POST / — déposer un son
// ============================================================
// Multipart : le fichier sous `clip`, plus label / game / difficulty.
//
// Les mêmes garde-fous qu'à l'admin, pour la même raison : le barème compare
// des COURBES DE HAUTEUR (cf. lib/soundContour.js). Un fracas n'a pas de
// hauteur, donc rien à mesurer — accepté, il distribuerait des points au hasard
// et on mettrait des semaines à comprendre pourquoi les scores de cette table
// sont absurdes. Mieux vaut refuser à l'entrée, en le disant.
router.post("/", upload.single("clip"), async (req, res) => {
  const cleanup = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  };
  try {
    if (!req.file)
      return res.status(400).json({ error: "Format audio non pris en charge." });

    const label = String(req.body?.label || "").trim().slice(0, 60);
    if (!label) {
      cleanup();
      return res
        .status(400)
        .json({ error: "Donne-lui un nom : c'est la réponse affichée après coup." });
    }

    const count = await SoundClip.countDocuments({ owner: req.userId });
    if (count >= MAX_PER_USER) {
      cleanup();
      return res.status(409).json({
        error: `Ta librairie est pleine (${MAX_PER_USER} sons). Retires-en un pour en ajouter un autre.`,
      });
    }

    let contour;
    try {
      contour = await contourOf(req.file.path);
    } catch (e) {
      cleanup();
      return res.status(422).json({
        error:
          e.message === "silence"
            ? "On n'entend rien dans cet extrait — vérifie ce que tu as sélectionné."
            : "Fichier illisible ou trop court.",
      });
    }

    if (contour.durationMs > MAX_MS) {
      cleanup();
      return res.status(422).json({
        error: `Trop long (${(contour.durationMs / 1000).toFixed(1)} s). Cinq secondes maximum : rogne l'extrait avant d'envoyer.`,
      });
    }
    if (contour.durationMs < MIN_MS) {
      cleanup();
      return res.status(422).json({ error: "Trop court : il faut au moins un quart de seconde." });
    }
    if (contour.voicedRatio < 0.25) {
      cleanup();
      return res.status(422).json({
        error: `Pas assez mélodique (${Math.round(contour.voicedRatio * 100)} % de son voisé). Il faut un cri ou une mélodie — un fracas ou un bruit sourd ne s'imite pas à la voix, et ne peut pas être noté.`,
      });
    }

    const me = await User.findById(req.userId).select("username").lean();
    const clip = await SoundClip.create({
      label,
      game: String(req.body?.game || "").trim().slice(0, 80),
      url: `/uploads/perroquet/user/${req.file.filename}`,
      contour,
      difficulty: Math.max(1, Math.min(5, Number(req.body?.difficulty) || 2)),
      active: true,
      owner: req.userId,
      ownerName: me?.username || "",
    });

    res.status(201).json({ item: serialize(req, clip) });
  } catch (err) {
    cleanup();
    console.error("perroquet library add error:", err.message);
    res.status(500).json({ error: "Impossible d'ajouter ce son." });
  }
});

// ============================================================
//  PATCH /:id — renommer, ou retirer du tirage
// ============================================================
// `active: false` ne supprime rien : le son reste dans la librairie mais ne
// part plus en partie. C'est le geste qu'on veut pour « celui-là est raté »
// sans perdre le fichier.
router.patch("/:id", async (req, res) => {
  try {
    const clip = await SoundClip.findOne({ _id: req.params.id, owner: req.userId });
    if (!clip) return res.status(404).json({ error: "Son introuvable." });

    if (typeof req.body?.label === "string") {
      const v = req.body.label.trim().slice(0, 60);
      if (!v) return res.status(400).json({ error: "Le nom ne peut pas être vide." });
      clip.label = v;
    }
    if (typeof req.body?.game === "string") clip.game = req.body.game.trim().slice(0, 80);
    if (req.body?.difficulty != null)
      clip.difficulty = Math.max(1, Math.min(5, Number(req.body.difficulty) || 2));
    if (typeof req.body?.active === "boolean") clip.active = req.body.active;

    await clip.save();
    res.json({ item: serialize(req, clip) });
  } catch (err) {
    console.error("perroquet library patch error:", err.message);
    res.status(500).json({ error: "Modification impossible." });
  }
});

// ============================================================
//  DELETE /:id
// ============================================================
// Même règle qu'à l'admin : un son déjà joué ne s'efface pas, sinon les récaps
// des parties où il est sorti deviendraient muets. Dans ce cas on l'éteint.
router.delete("/:id", async (req, res) => {
  try {
    const clip = await SoundClip.findOne({ _id: req.params.id, owner: req.userId });
    if (!clip) return res.status(404).json({ error: "Son introuvable." });

    const used = await PerroquetGame.countDocuments({ "rounds.clip": clip._id });
    if (used > 0) {
      clip.active = false;
      await clip.save();
      return res.json({
        ok: true,
        kept: true,
        message:
          "Ce son a déjà été joué : il est retiré du tirage, mais on le garde pour que les récaps où il est sorti restent audibles.",
        item: serialize(req, clip),
      });
    }

    if (clip.url?.startsWith("/uploads/perroquet/user/")) {
      fs.promises.unlink(path.join(USER_DIR, path.basename(clip.url))).catch(() => {});
    }
    await clip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet library delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
