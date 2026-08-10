import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import multer from "multer";
import ffmpegStatic from "ffmpeg-static";
import SoundClip, { cleanEffect } from "../models/SoundClip.js";
import PerroquetGame from "../models/PerroquetGame.js";
import PerroquetTake from "../models/PerroquetTake.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { contourOf } from "../lib/soundContour.js";
import {
  dropClipImage,
  isStoredClipImage,
  knownClipImage,
  storeClipImage,
} from "../lib/clipImage.js";

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

// L'édition d'une fiche ne remplace que L'IMAGE, jamais l'audio (cf. le PATCH
// plus bas). D'où un middleware séparé plutôt que le `upload` ci-dessus : il
// n'accepte qu'un champ, donc un `clip` glissé dans le formulaire d'édition est
// refusé au lieu d'être écrit sur le disque puis oublié.
//
// Il traverse sans rien faire les requêtes JSON (multer ne regarde que le
// multipart) : l'interrupteur « éteindre / rallumer » continue d'envoyer du JSON.
const editUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMG_DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(null, `i-${Date.now()}-${Math.round(Math.random() * 1e6)}${IMG_EXT[base] || ".png"}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(IMG_EXT, String(file.mimetype).split(";")[0])),
}).single("image");

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
  // L'effet appliqué à la voix du joueur à la révélation (« voix de robot »).
  effect: c.effect || "none",
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

    // L'illustration : réduite et nommée par son contenu (lib/clipImage.js).
    // `imageUrl` est l'autre chemin — celui du dépôt en lot, où les extraits
    // suivants ne renvoient que le nom de l'image que le premier a téléversée.
    let imgName = "";
    if (imgFile) imgName = await storeClipImage(imgFile.path, IMG_DIR);
    else if (req.body?.imageUrl) imgName = knownClipImage(req.body.imageUrl, IMG_DIR) || "";

    const clip = await SoundClip.create({
      label,
      url: `/uploads/perroquet/bank/${clipFile.filename}`,
      image: imgName ? `/uploads/perroquet/img/${imgName}` : "",
      contour,
      // L'effet de la révélation. Filtré par le modèle plutôt que cru sur
      // parole : c'est du multipart, donc du texte libre.
      effect: cleanEffect(req.body?.effect),
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
//  POST /api/admin/perroquet/optimize-images — reprendre les illustrations
// ============================================================
// ⚠️ AVANT `/:id`, comme les autres routes nommées.
//
// La réduction et la déduplication (lib/clipImage.js) s'appliquent à l'envoi,
// donc seulement aux sons déposés APRÈS. Une banque garnie avant gardait ses
// captures d'écran de 3 Mo servies pour être affichées sur 72 px, et ses copies
// octet pour octet de la même tête de personnage. Ce bouton refait le travail sur
// l'existant.
//
// Idempotent par construction : une image déjà réduite ressort identique
// (shrinkImage rend l'original quand le ré-encodage l'alourdirait), donc même
// empreinte, donc même nom — la deuxième exécution ne touche à rien.
router.post("/optimize-images", async (req, res) => {
  try {
    const rows = await SoundClip.find({ image: /^\/uploads\/perroquet\/img\// })
      .select("image")
      .lean();
    let done = 0;
    let freed = 0;
    for (const c of rows) {
      const name = path.basename(c.image);
      const full = path.join(IMG_DIR, name);
      // Fichier absent, ou déjà déplacé par un tour précédent de cette même
      // boucle (plusieurs fiches partagent une image) : rien à faire.
      // eslint-disable-next-line no-continue
      if (!fs.existsSync(full)) continue;
      // Déjà passée par la chaîne : on n'y touche PAS. Ré-encoder un JPEG déjà
      // réduit le rend un peu plus petit et un peu plus abîmé — donc sous un
      // nouveau nom — et la reprise dégraderait les images à chaque clic au lieu
      // de ne rien faire (cf. lib/clipImage.js).
      // eslint-disable-next-line no-await-in-loop, no-continue
      if (await isStoredClipImage(name, IMG_DIR)) continue;

      const before = fs.statSync(full).size;
      // storeClipImage CONSOMME le fichier qu'on lui donne (il le déplace) : on
      // travaille sur une copie, sinon un échec en cours de route laisserait la
      // fiche sans illustration.
      const tmp = path.join(IMG_DIR, `tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(name)}`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.promises.copyFile(full, tmp);
        // eslint-disable-next-line no-await-in-loop
        const out = await storeClipImage(tmp, IMG_DIR);
        const url = `/uploads/perroquet/img/${out}`;
        if (url !== c.image) {
          // TOUTES les fiches qui pointaient sur l'ancienne, pas seulement
          // celle-ci : c'est justement le cas des doublons qu'on vient de
          // fusionner. Migrer une fiche à la fois laisserait les autres sur un
          // fichier qu'on est en train d'effacer.
          // eslint-disable-next-line no-await-in-loop
          await SoundClip.updateMany({ image: c.image }, { image: url });
          // eslint-disable-next-line no-await-in-loop
          await dropClipImage(c.image, IMG_DIR);
          freed += Math.max(0, before - fs.statSync(path.join(IMG_DIR, out)).size);
          done += 1;
        }
      } catch (e) {
        fs.promises.unlink(tmp).catch(() => {});
        console.error("perroquet image optimize:", name, e.message);
      }
    }
    res.json({ done, total: rows.length, freedKb: Math.round(freed / 1024) });
  } catch (err) {
    console.error("perroquet optimize images error:", err.message);
    res.status(500).json({ error: "Optimisation impossible." });
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

// ======================================================================
//  Les essais des joueurs
// ======================================================================
// ⚠️ Comme `/demo`, ces routes PASSENT AVANT `/:id` : « attempts » se ferait
// happer comme un identifiant de son sinon.
//
// CE QU'ON REGARDE ICI n'a rien à voir avec la banque : ce sont les
// ENREGISTREMENTS DES JOUEURS, un par manche jouée, archivés dans
// models/PerroquetTake.js au moment où l'imitation est notée. Deux usages, et
// c'est le second qui a motivé la collection :
//
//   1. tout de suite — écouter, télécharger, effacer. Un joueur qui a crié
//      autre chose que le son laisse un fichier sur le disque, et il faut
//      pouvoir le retirer sans aller chercher dans quelle partie il était ;
//   2. plus tard — le wrapped annuel. « Ton meilleur cri de l'année » suppose
//      qu'on ait gardé les cris, et qu'ils soient interrogeables par joueur et
//      par date, ce que des tableaux imbriqués dans des parties ne sont pas.
const takeOf = (req, t) => ({
  id: String(t._id),
  mode: t.mode,
  url: abs(req, t.url),
  label: t.label || "un son",
  // Le son d'origine, pour pouvoir comparer d'une écoute à l'autre : sans lui on
  // entend un cri sans savoir ce qu'il visait.
  clipUrl: abs(req, t.clipUrl),
  image: abs(req, t.imageUrl) || "",
  score: t.score || 0,
  band: t.band || "miss",
  at: t.createdAt,
});

// ------------------------------------------------------------
//  GET /api/admin/perroquet/attempts — un joueur par ligne
// ------------------------------------------------------------
// Groupé côté base : rendre les essais à plat, c'est des milliers de lignes dont
// on ne veut voir qu'une poignée. On déplie joueur par joueur, à la demande.
router.get("/attempts", async (req, res) => {
  try {
    const rows = await PerroquetTake.aggregate([
      {
        $group: {
          _id: "$user",
          takes: { $sum: 1 },
          best: { $max: "$score" },
          avg: { $avg: "$score" },
          last: { $max: "$createdAt" },
        },
      },
      { $sort: { last: -1 } },
      { $limit: 300 },
    ]);

    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("username avatar")
      .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      // Un compte supprimé garde ses lignes : ses fichiers sont toujours sur le
      // disque, donc il faut pouvoir les retrouver pour les effacer. Le masquer
      // ferait exactement l'inverse de ce que cet écran sert à faire.
      users: rows.map((r) => {
        const u = byId.get(String(r._id));
        return {
          id: String(r._id),
          username: u?.username || "compte supprimé",
          avatar: abs(req, u?.avatar) || null,
          gone: !u,
          takes: r.takes,
          best: r.best || 0,
          avg: Math.round(r.avg || 0),
          last: r.last,
        };
      }),
      total: await PerroquetTake.estimatedDocumentCount(),
    });
  } catch (err) {
    console.error("perroquet attempts list error:", err.message);
    res.status(500).json({ error: "Essais illisibles." });
  }
});

// ------------------------------------------------------------
//  GET /api/admin/perroquet/attempts/:userId — les essais d'un joueur
// ------------------------------------------------------------
router.get("/attempts/:userId", async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const rows = await PerroquetTake.find({ user: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items: rows.map((t) => takeOf(req, t)), limit });
  } catch (err) {
    console.error("perroquet attempts read error:", err.message);
    res.status(500).json({ error: "Essais illisibles." });
  }
});

// ------------------------------------------------------------
//  DELETE /api/admin/perroquet/attempts/:id — effacer un essai
// ------------------------------------------------------------
// Suppression réelle, fichier compris. Contrairement à un son de la banque, il
// n'y a rien à préserver : personne ne rejoue l'imitation d'un inconnu depuis un
// classement.
//
// EN SOLO IL Y A UNE SECONDE RÉFÉRENCE. La manche de la partie pointe sur le
// même fichier (models/PerroquetGame.js) et son récap le rejoue : effacer le
// fichier sans couper cette référence donnerait un lecteur muet dans
// l'historique du joueur. On la met donc à `null`, ce qui est exactement l'état
// « manche passée » que le récap sait déjà afficher.
async function dropTake(t) {
  const f = fileOf({ url: t.url });
  if (f) await fs.promises.unlink(f).catch(() => {});
  if (t.game && t.roundIndex != null) {
    await PerroquetGame.updateOne(
      { _id: t.game },
      { $set: { [`rounds.${t.roundIndex}.attemptUrl`]: null } }
    ).catch(() => {});
  }
}

router.delete("/attempts/user/:userId", async (req, res) => {
  try {
    const rows = await PerroquetTake.find({ user: req.params.userId }).lean();
    for (const t of rows) {
      // eslint-disable-next-line no-await-in-loop
      await dropTake(t);
    }
    const r = await PerroquetTake.deleteMany({ user: req.params.userId });
    res.json({ removed: r.deletedCount });
  } catch (err) {
    console.error("perroquet attempts purge error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

router.delete("/attempts/:id", async (req, res) => {
  try {
    const t = await PerroquetTake.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: "Essai introuvable." });
    await dropTake(t);
    await PerroquetTake.deleteOne({ _id: t._id });
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet attempt delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

// ============================================================
//  PATCH /api/admin/perroquet/:id — corriger une fiche
// ============================================================
// L'AUDIO NE SE REMPLACE PAS : on change le nom, le jeu, la difficulté,
// l'image, ou on éteint. Pour un autre son, on en ajoute un et on retire
// l'ancien — sinon il faudrait recalculer le contour, et les statistiques de
// terrain accumulées (« jouée 40×, moyenne 62 ») porteraient sur un son qui
// n'est plus celui qu'on écoute.
//
// L'image, elle, se change : c'est de l'habillage montré à la révélation, elle
// n'entre dans aucun calcul. Sans ça un son ajouté sans illustration restait nu
// à vie, et la seule façon de lui en donner une était de le supprimer pour le
// redéposer — c'est-à-dire de perdre ses statistiques.
//
// Deux formats d'entrée, et c'est voulu : du JSON pour l'interrupteur
// éteindre/rallumer (une ligne de la liste), du multipart quand un fichier
// accompagne la correction. `editUpload` laisse passer le premier sans y toucher.
router.patch("/:id", editUpload, async (req, res) => {
  // Le fichier est déjà sur le disque quand on arrive ici : tout retour en
  // erreur doit le balayer, sinon IMG_DIR accumule les images d'éditions
  // abandonnées que plus rien ne référence.
  const cleanup = () => {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
  };
  try {
    const clip = await SoundClip.findById(req.params.id);
    if (!clip) {
      cleanup();
      return res.status(404).json({ error: "Son introuvable." });
    }

    if (typeof req.body?.label === "string") {
      const v = req.body.label.trim();
      if (!v) {
        cleanup();
        return res.status(400).json({ error: "Le nom ne peut pas être vide." });
      }
      clip.label = v;
    }
    if (typeof req.body?.game === "string") clip.game = req.body.game.trim();
    // L'effet se corrige après coup, contrairement à l'audio : il ne touche ni
    // le contour ni les statistiques, il ne vit qu'à la lecture. C'est aussi le
    // réglage qu'on a le plus envie d'essayer une fois le son entendu en jeu.
    if (req.body?.effect !== undefined) clip.effect = cleanEffect(req.body.effect);
    if (req.body?.difficulty != null)
      clip.difficulty = Math.max(1, Math.min(5, Number(req.body.difficulty) || 2));
    // En multipart tout arrive en texte : « false » est une chaîne, et une
    // chaîne non vide est vraie. D'où les deux lectures.
    if (typeof req.body?.active === "boolean") clip.active = req.body.active;
    else if (req.body?.active === "true" || req.body?.active === "false")
      clip.active = req.body.active === "true";
    if (req.body?.gameId !== undefined) clip.gameId = Number(req.body.gameId) || null;

    // ---------- l'image ----------
    // Nouvelle image ou retrait : dans les deux cas l'ancienne quitte le disque.
    // Elle n'est partagée avec rien — un clip a la sienne — donc la garder ne
    // ferait qu'engraisser `uploads/` de fichiers que rien ne sert plus.
    const wantsRemove = req.body?.removeImage === "1" || req.body?.removeImage === true;
    if (req.file || wantsRemove) {
      const old = clip.image;
      const name = req.file ? await storeClipImage(req.file.path, IMG_DIR) : "";
      clip.image = name ? `/uploads/perroquet/img/${name}` : "";
      // L'ancienne peut être PARTAGÉE avec d'autres sons depuis que les images
      // sont dédoublonnées (lib/clipImage.js) : on ne l'efface que si plus
      // personne ne l'affiche. Et si la nouvelle est la même (même contenu, donc
      // même nom), il n'y a rien à effacer du tout.
      if (old && old !== clip.image) await dropClipImage(old, IMG_DIR, clip._id);
    }

    await clip.save();
    res.json({ item: serialize(req, clip) });
  } catch (err) {
    cleanup();
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

    const audio = fileOf(clip);
    if (audio) fs.promises.unlink(audio).catch(() => {});
    // L'image, elle, est peut-être celle de quatorze autres sons de la même
    // fournée : c'est le prix de la déduplication, et l'oublier rendrait ces
    // quatorze-là aveugles.
    await dropClipImage(clip.image, IMG_DIR, clip._id);
    await clip.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("perroquet admin delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
