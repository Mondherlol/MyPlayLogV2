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
const IMG_DIR = path.join(__dirname, "../../uploads/perroquet/img");
const UPLOADS_DIR = path.join(__dirname, "../../uploads");
fs.mkdirSync(BANK_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

// Le fichier d'un clip sur le disque. Deux dossiers coexistent désormais :
// `bank/` pour les sons officiels et `user/` pour les librairies des joueurs
// (routes/perroquetSounds.js). L'admin voit et modère les deux, donc il ne peut
// plus supposer BANK_DIR — d'où le chemin dérivé de l'URL, borné à `uploads/`
// pour qu'une URL trafiquée en base ne fasse pas sortir du dossier.
function fileOf(clip) {
  const rel = String(clip?.url || "");
  if (!rel.startsWith("/uploads/perroquet/")) return null;
  const full = path.join(UPLOADS_DIR, rel.slice("/uploads/".length));
  return full.startsWith(UPLOADS_DIR) ? full : null;
}

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

// L'illustration facultative du son, montrée à la révélation seulement. Elle
// vit dans le même dossier que celles des joueurs : c'est le même objet, seul
// le déposant change.
const IMG_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, file.fieldname === "image" ? IMG_DIR : BANK_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(
        null,
        file.fieldname === "image"
          ? `i-${stamp}${IMG_EXT[base] || ".png"}`
          : `c-${stamp}${EXT[base] || ".mp3"}`
      );
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const type = String(file.mimetype).split(";")[0];
    cb(null, file.fieldname === "image" ? Object.hasOwn(IMG_EXT, type) : Object.hasOwn(EXT, type));
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
  gameId: c.gameId || null,
  url: abs(req, c.url),
  image: abs(req, c.image) || "",
  difficulty: c.difficulty,
  active: c.active,
  // Qui l'a déposé : vide pour la banque officielle, le pseudo du joueur pour
  // un son de librairie. C'est ce qui distingue les deux mondes dans l'écran.
  owner: c.owner ? c.ownerName || "un joueur" : "",
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
    // Les sons de la communauté sont dans la MÊME collection mais forment une
    // liste à part : les mélanger noierait la banque officielle sous les dépôts
    // des joueurs, alors qu'ils n'ont pas le même statut (les uns sortent
    // partout, les autres seulement sur les tables qui les ont demandés).
    const scope = filter === "community" ? { owner: { $ne: null } } : { owner: null };
    const q =
      filter === "active" ? { ...scope, active: true } :
      filter === "off" ? { ...scope, active: false } :
      scope;
    const rows = await SoundClip.find(q).sort({ difficulty: 1, createdAt: -1 }).lean();
    const [active, off, community] = await Promise.all([
      SoundClip.countDocuments({ active: true, owner: null }),
      SoundClip.countDocuments({ active: false, owner: null }),
      SoundClip.countDocuments({ owner: { $ne: null } }),
    ]);
    res.json({
      items: rows.map((c) => serialize(req, c)),
      counts: { active, off, community, total: active + off },
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
router.post("/", upload, async (req, res) => {
  const clipFile = req.files?.clip?.[0] || null;
  const imgFile = req.files?.image?.[0] || null;
  const cleanup = () => {
    for (const f of [clipFile, imgFile]) {
      if (f) fs.promises.unlink(f.path).catch(() => {});
    }
  };
  try {
    if (!clipFile) {
      cleanup();
      return res.status(400).json({ error: "Format audio non pris en charge." });
    }

    const label = String(req.body?.label || "").trim();
    if (!label) {
      cleanup();
      return res.status(400).json({ error: "Il faut un nom (la réponse affichée après coup)." });
    }

    let contour;
    try {
      contour = await contourOf(clipFile.path);
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
      url: `/uploads/perroquet/bank/${clipFile.filename}`,
      image: imgFile ? `/uploads/perroquet/img/${imgFile.filename}` : "",
      contour,
      active: req.body?.active !== "false",
    });

    res.status(201).json({ item: serialize(req, clip) });
  } catch (err) {
    cleanup();
    console.error("perroquet admin add error:", err.message);
    res.status(500).json({ error: "Impossible d'ajouter ce son." });
  }
});


// ============================================================
//  POST /api/admin/perroquet/recompute — refaire tous les contours
// ============================================================
// Les contours sont calculés UNE FOIS, à l'envoi, et stockés (cf.
// models/SoundClip.js) : c'est ce qui évite de redécoder le son de référence à
// chaque manche. Le revers, c'est qu'ils vieillissent — dès qu'on touche à
// lib/soundContour.js, la banque garde des mesures faites par l'ancienne
// version, et les scores se calculent contre des cibles périmées.
//
// Ce bouton existe pour ça. C'est arrivé dès le premier réglage : le plafond de
// détection est passé de 1000 à 1400 Hz, et tous les sons aigus déjà en banque
// portaient un contour faux jusqu'à ce recalcul.
router.post("/recompute", async (req, res) => {
  try {
    const rows = await SoundClip.find().lean();
    let done = 0;
    const failed = [];
    for (const c of rows) {
      const file = fileOf(c);
      if (!file || !fs.existsSync(file)) {
        failed.push(c.label);
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        const contour = await contourOf(file);
        // eslint-disable-next-line no-await-in-loop
        await SoundClip.updateOne({ _id: c._id }, { contour });
        done += 1;
      } catch {
        failed.push(c.label);
      }
    }
    res.json({ done, failed });
  } catch (err) {
    console.error("perroquet recompute error:", err.message);
    res.status(500).json({ error: "Recalcul impossible." });
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
  // --- Faciles : un seul mouvement, deux notes au plus ---
  { key: "montee", label: "La montée", notes: [220, 440], dur: 0.8, difficulty: 1 },
  { key: "descente", label: "La descente", notes: [520, 200], dur: 0.8, difficulty: 1 },
  { key: "coucou", label: "Le coucou", notes: [520, 415], dur: 0.7, style: "steps", difficulty: 1 },
  { key: "soupir", label: "Le soupir", notes: [480, 250], dur: 1.1, difficulty: 1 },
  { key: "reveil", label: "Le réveil", notes: [660, 660], dur: 0.5, style: "steps", difficulty: 1 },

  // --- Deux syllabes ---
  { key: "saut", label: "Le saut", notes: [260, 260, 620], dur: 0.7, difficulty: 2 },
  { key: "piece", label: "La pièce", notes: [988, 1319], dur: 0.5, style: "steps", difficulty: 2 },
  { key: "appel", label: "L'appel", notes: [400, 600, 400], dur: 0.9, style: "steps", difficulty: 2 },
  { key: "ressort", label: "Le ressort", notes: [200, 800], dur: 0.45, difficulty: 2 },
  { key: "porte", label: "La sonnette", notes: [660, 523], dur: 0.9, style: "steps", difficulty: 2 },

  // --- Une inflexion à négocier ---
  { key: "vague", label: "La vague", notes: [300, 560, 300, 560], dur: 1.2, difficulty: 3 },
  { key: "plongeon", label: "Le plongeon", notes: [640, 300, 180], dur: 1.0, difficulty: 3 },
  { key: "miaou", label: "Le miaulement", notes: [350, 700, 420], dur: 1.0, vibrato: 5, difficulty: 3 },
  { key: "rebond", label: "Le rebond", notes: [300, 620, 440, 700], dur: 1.0, style: "steps", difficulty: 3 },
  { key: "fusee", label: "La fusée", notes: [180, 300, 900], dur: 0.9, difficulty: 3 },
  { key: "bulle", label: "La bulle", notes: [700, 300, 700], dur: 0.8, difficulty: 3 },

  // --- Une vraie mélodie ---
  { key: "question", label: "La question", notes: [300, 280, 500], dur: 0.9, difficulty: 4 },
  { key: "fanfare", label: "La fanfare", notes: [392, 523, 659, 784], dur: 1.1, style: "steps", difficulty: 4 },
  { key: "hoquet", label: "Le hoquet", notes: [520, 300, 520, 300], dur: 0.8, style: "steps", difficulty: 4 },
  { key: "sirene", label: "La sirène", notes: [320, 620, 320, 620], dur: 1.4, vibrato: 3, difficulty: 4 },
  { key: "victoire", label: "La victoire", notes: [523, 523, 523, 698], dur: 1.0, style: "steps", difficulty: 4 },

  // --- Tordu ---
  { key: "grandhuit", label: "Le grand huit", notes: [250, 700, 300, 650, 350], dur: 1.5, difficulty: 5 },
  { key: "zigzag", label: "Le zigzag", notes: [600, 300, 750, 260, 850], dur: 1.3, style: "steps", difficulty: 5 },
  { key: "cascade", label: "La cascade", notes: [900, 700, 550, 420, 300, 220], dur: 1.2, style: "steps", difficulty: 5 },
  { key: "gargouille", label: "La gargouille", notes: [180, 420, 200, 380, 170], dur: 1.4, vibrato: 8, difficulty: 5 },
];

// Écrit une mélodie en PCM puis l'encapsule en WAV.
//
// Trois styles, parce qu'une seule forme d'attaque rendait tous les sons
// interchangeables — et un banc de sons interchangeables ne teste rien :
//
//   glide (défaut) : on GLISSE d'une note à l'autre. C'est ce que fait une voix
//     humaine, donc la cible reste imitable telle quelle ; et une transition
//     franche entre deux sinus produit un clic désagréable.
//   steps : chaque note est réattaquée, avec son propre fondu. Donne des sons
//     « à syllabes » (une sonnette, une fanfare) — que l'oreille compte, et que
//     le barème note sur l'enveloppe autant que sur la hauteur.
//   vibrato : une modulation lente de la hauteur. Difficile à imiter
//     proprement, d'où les difficultés élevées.
function writeMelody(file, spec, sr = 16000) {
  const { notes, dur, style = "glide", vibrato = 0 } = spec;
  return new Promise((resolve, reject) => {
    const n = Math.round(sr * dur);
    const buf = Buffer.alloc(n * 2);
    let phase = 0;

    for (let i = 0; i < n; i += 1) {
      const x = i / n;
      let f;
      let env;

      if (style === "steps") {
        // Une note par tranche égale, chacune avec son attaque et sa chute.
        const k = Math.min(notes.length - 1, Math.floor(x * notes.length));
        f = notes[k];
        const seg = n / notes.length;
        const inSeg = i - k * seg;
        env =
          Math.min(1, inSeg / (sr * 0.012)) *
          Math.min(1, (seg - inSeg) / (sr * 0.05));
      } else {
        const t = x * (notes.length - 1);
        const k = Math.min(notes.length - 2, Math.floor(t));
        // Interpolation logarithmique : c'est ainsi qu'on perçoit la hauteur,
        // et c'est l'échelle du barème (des demi-tons).
        f = notes[k] * (notes[k + 1] / notes[k]) ** (t - k);
        env =
          Math.min(1, i / (sr * 0.03)) * Math.min(1, (n - i) / (sr * 0.08));
      }

      if (vibrato) f *= 1 + 0.035 * Math.sin((2 * Math.PI * vibrato * i) / sr);

      phase += (2 * Math.PI * f) / sr;
      // Une harmonique de plus : un sinus pur sonne comme un test auditif, et
      // surtout il donne peu de prise à la détection de hauteur du barème.
      const wave = Math.sin(phase) * 0.75 + Math.sin(phase * 2) * 0.25;
      buf.writeInt16LE(Math.round(wave * env * (1 - x * 0.25) * 20000), i * 2);
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
      await writeMelody(full, d);
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

    for (const f of [fileOf(clip), fileOf({ url: clip.image })]) {
      if (f) fs.promises.unlink(f).catch(() => {});
    }
    await clip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet admin delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
