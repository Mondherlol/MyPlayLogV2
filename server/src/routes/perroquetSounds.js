import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import SoundClip, { cleanEffect } from "../models/SoundClip.js";
import PerroquetGame from "../models/PerroquetGame.js";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { contourOf } from "../lib/soundContour.js";
import { needsTranscode, toMp3 } from "../lib/audioConvert.js";
import { dropClipImage, storeClipImage } from "../lib/clipImage.js";

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
const IMG_DIR = path.join(__dirname, "../../uploads/perroquet/img");
fs.mkdirSync(USER_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

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
  // Les mémos vocaux de téléphone. Ils ne RESTENT pas en AMR : aucun navigateur
  // ne sait le décoder, donc le fichier est transcodé en mp3 juste après
  // l'arrivée (cf. plus bas). Sans cette conversion, le dépôt réussirait — le
  // serveur, lui, décode l'AMR sans problème — et le son serait muet en partie.
  "audio/amr": ".amr",
  "audio/amr-wb": ".amr",
  "audio/3gpp": ".3gp",
  "audio/3gpp2": ".3gp",
};

// Les mémos vocaux arrivent souvent SANS type utilisable : Android envoie un
// `.amr` en `application/octet-stream`, et certains explorateurs de fichiers ne
// déclarent rien du tout. Refuser sur cette base seule reviendrait à refuser le
// format qu'on est précisément en train d'accepter — on regarde donc aussi le
// nom du fichier.
const NAME_EXT = new Set([
  ".amr", ".3gp", ".3gpp", ".3g2", ".awb", ".wma", ".aif", ".aiff",
  ".wav", ".mp3", ".ogg", ".oga", ".opus", ".webm", ".m4a", ".mp4", ".aac", ".flac",
]);

// Le type déclaré, ou le nom à défaut. Rend l'extension sous laquelle stocker.
function extFor(file) {
  const mime = String(file.mimetype).split(";")[0];
  if (Object.hasOwn(EXT, mime)) return EXT[mime];
  const ext = path.extname(file.originalname || "").toLowerCase();
  return NAME_EXT.has(ext) ? ext : null;
}

// Cinq secondes de PCM tiennent largement dedans ; la borne est là pour le
// fichier « on a oublié de couper », pas pour l'usage normal.
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_MS = 5200; // 5 s + la marge d'arrondi du décodage
const MIN_MS = 250;
// De quoi composer plusieurs parties sans que la librairie devienne un disque
// dur. C'est aussi la borne qui empêche un compte de remplir le serveur.
const MAX_PER_USER = 40;

// L'illustration : facultative, et volontairement permissive côté format —
// c'est un visuel de confort, pas une pièce du jeu.
const IMG_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === "image" ? IMG_DIR : USER_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(
        null,
        file.fieldname === "image"
          ? `i-${stamp}${IMG_EXT[base] || ".png"}`
          : `u-${stamp}${extFor(file) || ".wav"}`
      );
    },
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype).split(";")[0];
    cb(null, file.fieldname === "image" ? Object.hasOwn(IMG_EXT, type) : !!extFor(file));
  },
}).fields([
  { name: "clip", maxCount: 1 },
  { name: "image", maxCount: 1 },
]);

const abs = (req, u) =>
  !u ? null : /^https?:/i.test(u) ? u : `${req.protocol}://${req.get("host")}${u}`;

const serialize = (req, c) => ({
  id: String(c._id),
  label: c.label,
  game: c.game || "",
  url: abs(req, c.url),
  image: abs(req, c.image) || "",
  difficulty: c.difficulty,
  active: c.active,
  effect: c.effect || "none",
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
//  POST /convert — rendre un fichier lisible par le navigateur
// ============================================================
// ⚠️ DÉCLARÉE AVANT `/:id` : sinon `PATCH/DELETE /:id` happerait « convert »
// comme un identifiant de son. Même piège que les routes `/demo` de l'admin.
//
// Le rogneur (client/src/components/AudioTrimmer.jsx) a besoin de DÉCODER le
// fichier pour dessiner sa forme d'onde et laisser choisir les cinq secondes.
// Il passe par `decodeAudioData`, qui ne sait pas lire l'AMR des mémos vocaux —
// et aucun navigateur ne le saura jamais.
//
// Deux issues possibles, et une seule tient : soit on transcode ici et le joueur
// rogne normalement, soit on rogne côté serveur — c'est-à-dire qu'on choisit à
// sa place quel bout du mémo garder, exactement la décision qu'on refuse de
// prendre pour lui (cf. l'en-tête du fichier). Donc on transcode.
//
// La réponse est le mp3 BRUT, pas du JSON : le client le remet dans un `File` et
// la suite du dépôt ne sait même pas qu'une conversion a eu lieu. Rien n'est
// gardé sur le disque — cette route ne dépose pas un son, elle rend un fichier
// lisible.
const convertUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) =>
      cb(null, `mpl-in-${Date.now()}-${Math.round(Math.random() * 1e6)}${
        path.extname(file.originalname || "").toLowerCase().slice(0, 8) || ".bin"
      }`),
  }),
  // Plus large que le dépôt : ici on reçoit le fichier D'ORIGINE, pas l'extrait
  // de cinq secondes. Un mémo vocal de trois minutes ou un mp3 arraché d'une
  // vidéo passent par là.
  limits: { fileSize: 30 * 1024 * 1024 },
}).single("clip");

router.post("/convert", convertUpload, async (req, res) => {
  const src = req.file?.path;
  // Les deux fichiers temporaires — celui reçu et le mp3 produit — sont effacés
  // ici, quoi qu'il arrive : cette route ne dépose rien, elle répond.
  let out = null;
  const cleanup = () => {
    for (const f of [src, out]) if (f) fs.promises.unlink(f).catch(() => {});
  };
  try {
    if (!src) return res.status(400).json({ error: "Aucun fichier reçu." });
    out = await toMp3(src, { maxSeconds: 180 });
    const buf = await fs.promises.readFile(out);
    res.type("audio/mpeg").send(buf);
  } catch (err) {
    console.error("perroquet convert error:", err.message);
    res.status(422).json({
      error:
        err.message === "aucune piste audio"
          ? "Ce fichier ne contient pas de son."
          : "Impossible de lire ce fichier audio.",
    });
  } finally {
    cleanup();
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
router.post("/", upload, async (req, res) => {
  const clipFile = req.files?.clip?.[0] || null;
  const imgFile = req.files?.image?.[0] || null;
  // Le chemin qu'on garde vraiment, et le nom sous lequel il est servi. Ils
  // changent si le fichier doit être transcodé, d'où ces deux variables plutôt
  // qu'un usage direct de `clipFile.filename` partout.
  let clipPath = clipFile?.path || null;
  let clipName = clipFile?.filename || null;
  const cleanup = () => {
    for (const f of [clipPath, imgFile?.path, clipFile?.path]) {
      if (f) fs.promises.unlink(f).catch(() => {});
    }
  };
  try {
    if (!clipFile) {
      cleanup();
      return res.status(400).json({ error: "Format audio non pris en charge." });
    }

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

    // ------------------------------------------------ le filet de sécurité AMR
    // Le client convertit normalement AVANT de rogner (cf. la route /convert),
    // et ce qui arrive ici est un wav sorti du rogneur. Mais rien ne garantit ce
    // chemin — l'app mobile, un vieux client, un envoi direct — et un .amr
    // stocké tel quel serait un son que PERSONNE ne peut écouter en partie,
    // alors que son dépôt aurait répondu « c'est bon » : le serveur, lui, décode
    // l'AMR sans broncher. On le convertit donc aussi ici, et on ne garde que le
    // mp3. Placé APRÈS les vérifications gratuites (nom, quota) : inutile de
    // payer un ffmpeg pour un dépôt qu'on va refuser de toute façon.
    if (
      needsTranscode(clipFile.originalname, clipFile.mimetype) ||
      needsTranscode(clipName)
    ) {
      try {
        const mp3 = await toMp3(clipPath, { maxSeconds: 30, outDir: USER_DIR });
        fs.promises.unlink(clipPath).catch(() => {});
        clipPath = mp3;
        clipName = path.basename(mp3);
      } catch {
        cleanup();
        return res
          .status(422)
          .json({ error: "Impossible de convertir ce fichier audio." });
      }
    }

    let contour;
    try {
      contour = await contourOf(clipPath);
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

    // Réduite et nommée par son contenu, comme côté admin : la même tête de
    // Pikachu déposée par trois joueurs ne fait qu'un fichier.
    const imgName = imgFile ? await storeClipImage(imgFile.path, IMG_DIR) : "";

    const me = await User.findById(req.userId).select("username").lean();
    const clip = await SoundClip.create({
      label,
      url: `/uploads/perroquet/user/${clipName}`,
      image: imgName ? `/uploads/perroquet/img/${imgName}` : "",
      contour,
      effect: cleanEffect(req.body?.effect),
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
    if (typeof req.body?.active === "boolean") clip.active = req.body.active;
    if (req.body?.effect !== undefined) clip.effect = cleanEffect(req.body.effect);

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
    // Jamais sans vérifier : depuis la déduplication, cette image est peut-être
    // aussi celle d'un autre son (le sien ou celui de quelqu'un d'autre).
    await dropClipImage(clip.image, IMG_DIR, clip._id);
    await clip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet library delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
