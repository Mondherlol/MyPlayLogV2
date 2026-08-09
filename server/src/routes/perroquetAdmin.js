import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import multer from "multer";
import ffmpegStatic from "ffmpeg-static";
import SoundClip from "../models/SoundClip.js";
import PerroquetGame from "../models/PerroquetGame.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { contourOf } from "../lib/soundContour.js";

// ======================================================================
//  La banque de sons du Perroquet — administration
// ======================================================================
// LE SEUL ENDROIT où la banque se garnit. Il a existé un `npm run seed:
// perroquet` qui lisait un manifeste JSON et des fichiers déposés à la main sur
// le serveur ; il a été retiré au profit de cet écran. Deux chemins pour peupler
// la même collection, c'était deux comportements à garder d'accord (le calcul
// du contour, le refus des sons non mélodiques, la nomenclature des fichiers) —
// et surtout un chemin qui exigeait un accès SSH à la production pour ajouter
// un cri de Yoshi.
//
// Ce que cet écran fait et que le script ne faisait pas : il ÉCOUTE avant
// d'accepter. Le contour est calculé à l'envoi et rendu dans la réponse, donc
// on voit immédiatement si le son est exploitable — sans attendre de tomber
// dessus en partie.
const router = express.Router();

router.use(requireAuth, requireAdmin);

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BANK_DIR = path.join(__dirname, "../../uploads/perroquet/bank");
fs.mkdirSync(BANK_DIR, { recursive: true });

// Formats acceptés à l'envoi. Plus large que ce qu'un navigateur enregistre :
// ici on téléverse des fichiers trouvés ailleurs (mp3, wav, ogg, flac…).
const EXT = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, BANK_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(null, `c-${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[base] || ".mp3"}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(EXT, String(file.mimetype).split(";")[0])),
});

const abs = (req, u) =>
  !u ? null : /^https?:/i.test(u) ? u : `${req.protocol}://${req.get("host")}${u}`;

const serialize = (req, c) => ({
  id: String(c._id),
  label: c.label,
  game: c.game || "",
  gameId: c.gameId || null,
  url: abs(req, c.url),
  difficulty: c.difficulty,
  active: c.active,
  durationMs: c.contour?.durationMs || 0,
  voicedRatio: c.contour?.voicedRatio || 0,
  timesPlayed: c.timesPlayed || 0,
  // La moyenne des scores obtenus : le seul signal de terrain qui dise si un
  // son est imitable. Un clip que personne ne dépasse 30 est mal découpé ou pas
  // mélodique — c'est ce chiffre qui le révèle, pas l'écoute en cabine.
  avgScore: c.timesPlayed ? Math.round(c.scoreSum / c.timesPlayed) : null,
});

// ============================================================
//  GET /api/admin/perroquet — la banque
// ============================================================
router.get("/", async (req, res) => {
  try {
    const filter = req.query.filter || "all";
    const q =
      filter === "active" ? { active: true } :
      filter === "off" ? { active: false } :
      {};
    const rows = await SoundClip.find(q).sort({ difficulty: 1, createdAt: -1 }).lean();
    const [active, off] = await Promise.all([
      SoundClip.countDocuments({ active: true }),
      SoundClip.countDocuments({ active: false }),
    ]);
    res.json({
      items: rows.map((c) => serialize(req, c)),
      counts: { active, off, total: active + off },
    });
  } catch (err) {
    console.error("perroquet admin list error:", err.message);
    res.status(500).json({ error: "Banque illisible." });
  }
});

// ============================================================
//  POST /api/admin/perroquet — ajouter un son
// ============================================================
// Multipart : le fichier sous `clip`, plus label / game / difficulty.
//
// Le contour est calculé ICI, une fois pour toutes, et stocké avec le clip.
// C'est ce qui fait qu'une manche de jeu ne redécode jamais le son de
// référence : elle compare la voix du joueur à une centaine de nombres déjà en
// base (cf. models/SoundClip.js).
router.post("/", upload.single("clip"), async (req, res) => {
  const cleanup = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  };
  try {
    if (!req.file)
      return res.status(400).json({ error: "Format audio non pris en charge." });

    const label = String(req.body?.label || "").trim();
    if (!label) {
      cleanup();
      return res.status(400).json({ error: "Il faut un nom (la réponse affichée après coup)." });
    }

    let contour;
    try {
      contour = await contourOf(req.file.path);
    } catch (e) {
      cleanup();
      return res.status(422).json({
        error:
          e.message === "silence"
            ? "Ce fichier est muet."
            : `Fichier illisible ou trop court (${e.message}).`,
      });
    }

    // LE GARDE-FOU QUI COMPTE. Un son sans hauteur franche — un fracas, un
    // cliquetis de menu, une explosion — n'a rien à imiter avec la gorge, et le
    // barème (qui compare des courbes de hauteur) n'aurait littéralement rien à
    // mesurer : il distribuerait des points au hasard. On refuse à l'entrée,
    // parce qu'en partie le problème ne se voit pas — il se traduit juste par
    // des scores « bizarres » qu'on met des semaines à imputer au bon clip.
    if (contour.voicedRatio < 0.25) {
      cleanup();
      return res.status(422).json({
        error: `Pas assez mélodique (${Math.round(contour.voicedRatio * 100)} % de son voisé). Il faut un cri ou une mélodie, pas un bruit.`,
      });
    }
    // Trop long : personne ne retient la mélodie, et l'imitation devient une
    // performance de mémoire plutôt qu'un réflexe.
    if (contour.durationMs > 4000) {
      cleanup();
      return res.status(422).json({
        error: `Trop long (${(contour.durationMs / 1000).toFixed(1)} s). Vise entre 0,3 et 2 secondes.`,
      });
    }

    const clip = await SoundClip.create({
      label,
      game: String(req.body?.game || "").trim(),
      gameId: Number(req.body?.gameId) || null,
      url: `/uploads/perroquet/bank/${req.file.filename}`,
      contour,
      difficulty: Math.max(1, Math.min(5, Number(req.body?.difficulty) || 2)),
      active: req.body?.active !== "false",
    });

    res.status(201).json({ item: serialize(req, clip) });
  } catch (err) {
    cleanup();
    console.error("perroquet admin add error:", err.message);
    res.status(500).json({ error: "Impossible d'ajouter ce son." });
  }
});

// ⚠️ LES ROUTES `/demo` PASSENT AVANT `/:id`, ET CE N'EST PAS COSMÉTIQUE.
// Express essaie les routes dans l'ordre de déclaration : placé après,
// `DELETE /:id` happerait `DELETE /demo` en croyant que « demo » est un
// identifiant. On chercherait ensuite longtemps pourquoi le bouton « retirer
// les sons de démonstration » répond « Son introuvable ». Même piège que les
// salons de versus dans src/index.js.
// ============================================================
//  POST /api/admin/perroquet/demo — six sons de synthèse
// ============================================================
// De quoi jouer AVANT d'avoir sourcé le moindre vrai clip. Ils ne ressemblent à
// aucun jeu : leur seul rôle est de rendre la boucle complète testable — micro,
// téléversement, barème, récap — sans avoir à réunir quinze fichiers d'abord.
// `DELETE /demo` les retire quand la vraie banque est prête.
const DEMO = [
  { key: "montee", label: "La montée", notes: [220, 440], dur: 0.8, difficulty: 1 },
  { key: "descente", label: "La descente", notes: [520, 200], dur: 0.8, difficulty: 1 },
  { key: "saut", label: "Le saut", notes: [260, 260, 620], dur: 0.7, difficulty: 2 },
  { key: "vague", label: "La vague", notes: [300, 560, 300, 560], dur: 1.2, difficulty: 3 },
  { key: "plongeon", label: "Le plongeon", notes: [640, 300, 180], dur: 1.0, difficulty: 3 },
  { key: "question", label: "La question", notes: [300, 280, 500], dur: 0.9, difficulty: 4 },
];

// Écrit une mélodie en PCM puis l'encapsule en WAV. On GLISSE entre les notes
// plutôt que de les juxtaposer : une transition franche produit un clic, et
// surtout une voix humaine glisse — la cible doit être imitable telle quelle.
function writeMelody(file, notes, dur, sr = 16000) {
  return new Promise((resolve, reject) => {
    const n = Math.round(sr * dur);
    const buf = Buffer.alloc(n * 2);
    let phase = 0;
    for (let i = 0; i < n; i += 1) {
      const t = (i / n) * (notes.length - 1);
      const k = Math.min(notes.length - 2, Math.floor(t));
      // Interpolation logarithmique : c'est ainsi qu'on perçoit la hauteur, et
      // c'est l'échelle du barème (des demi-tons).
      const f = notes[k] * (notes[k + 1] / notes[k]) ** (t - k);
      phase += (2 * Math.PI * f) / sr;
      const x = i / n;
      const env = Math.min(1, i / (sr * 0.03)) * Math.min(1, (n - i) / (sr * 0.08));
      const wave = Math.sin(phase) * 0.75 + Math.sin(phase * 2) * 0.25;
      buf.writeInt16LE(Math.round(wave * env * (1 - x * 0.3) * 20000), i * 2);
    }
    const raw = `${file}.raw`;
    fs.writeFileSync(raw, buf);
    execFile(
      FFMPEG,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le",
        "-ar", String(sr), "-ac", "1", "-i", raw, file],
      (err) => {
        fs.promises.unlink(raw).catch(() => {});
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

router.post("/demo", async (req, res) => {
  try {
    let added = 0;
    for (const d of DEMO) {
      const name = `demo-${d.key}.wav`;
      const url = `/uploads/perroquet/bank/${name}`;
      if (await SoundClip.exists({ url })) continue;
      const full = path.join(BANK_DIR, name);
      await writeMelody(full, d.notes, d.dur);
      const contour = await contourOf(full);
      await SoundClip.create({
        label: d.label,
        game: "Démonstration",
        url,
        contour,
        difficulty: d.difficulty,
        active: true,
      });
      added += 1;
    }
    res.json({ added });
  } catch (err) {
    console.error("perroquet demo error:", err.message);
    res.status(500).json({ error: "Impossible de fabriquer les sons de démonstration." });
  }
});

router.delete("/demo", async (req, res) => {
  try {
    const rows = await SoundClip.find({ url: /\/bank\/demo-/ }).lean();
    for (const c of rows) {
      fs.promises.unlink(path.join(BANK_DIR, path.basename(c.url))).catch(() => {});
    }
    const r = await SoundClip.deleteMany({ url: /\/bank\/demo-/ });
    res.json({ removed: r.deletedCount });
  } catch (err) {
    console.error("perroquet demo delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

// ============================================================
//  PATCH /api/admin/perroquet/:id — corriger une fiche
// ============================================================
// Le fichier ne se remplace pas : on change le nom, le jeu, la difficulté, ou
// on éteint. Pour un autre son, on en ajoute un et on retire l'ancien — sinon
// il faudrait recalculer le contour et les statistiques de terrain accumulées
// ne voudraient plus rien dire.
router.patch("/:id", async (req, res) => {
  try {
    const set = {};
    if (typeof req.body?.label === "string") {
      const v = req.body.label.trim();
      if (!v) return res.status(400).json({ error: "Le nom ne peut pas être vide." });
      set.label = v;
    }
    if (typeof req.body?.game === "string") set.game = req.body.game.trim();
    if (req.body?.difficulty != null)
      set.difficulty = Math.max(1, Math.min(5, Number(req.body.difficulty) || 2));
    if (typeof req.body?.active === "boolean") set.active = req.body.active;
    if (req.body?.gameId !== undefined) set.gameId = Number(req.body.gameId) || null;

    const clip = await SoundClip.findByIdAndUpdate(req.params.id, set, { new: true });
    if (!clip) return res.status(404).json({ error: "Son introuvable." });
    res.json({ item: serialize(req, clip) });
  } catch (err) {
    console.error("perroquet admin patch error:", err.message);
    res.status(500).json({ error: "Modification impossible." });
  }
});

// ============================================================
//  DELETE /api/admin/perroquet/:id
// ============================================================
// Suppression RÉELLE, fichier compris — mais refusée si le son a déjà été
// joué. Les parties gardent une référence vers lui et leur récap rejoue son
// audio : l'effacer rendrait muettes des parties de l'historique. Dans ce cas
// on éteint (`active: false`), ce qui le retire du tirage sans casser le passé.
router.delete("/:id", async (req, res) => {
  try {
    const clip = await SoundClip.findById(req.params.id);
    if (!clip) return res.status(404).json({ error: "Son introuvable." });

    const used = await PerroquetGame.countDocuments({ "rounds.clip": clip._id });
    if (used > 0 && req.query.force !== "1") {
      return res.status(409).json({
        error: `Ce son a été joué dans ${used} partie(s) : le supprimer les rendrait muettes. Éteins-le plutôt.`,
        used,
      });
    }

    if (clip.url?.startsWith("/uploads/perroquet/bank/")) {
      fs.promises
        .unlink(path.join(BANK_DIR, path.basename(clip.url)))
        .catch(() => {});
    }
    await clip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet admin delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
