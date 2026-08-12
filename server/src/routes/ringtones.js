import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import multer from "multer";
import ffmpegStatic from "ffmpeg-static";
import Ringtone from "../models/Ringtone.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

// ======================================================================
//  Les sonneries d'appel
// ======================================================================
// Deux banques, et la distinction porte tout ce fichier :
//
//   LA BANQUE COMMUNE (models/Ringtone.js) — déposée par un administrateur,
//   proposée à tout le monde ;
//   LE FICHIER PERSONNEL — déposé par un joueur, visible de lui seul, rangé
//   sur son propre document.
//
// Un joueur ne peut donc PAS enrichir la liste que les autres parcourent. Ce
// n'est pas une méfiance de principe : une banque commune ouverte à l'envoi
// devient en trois jours une collection de sons désagréables qu'il faut
// modérer, pour un réglage qui n'a jamais eu besoin d'être social.
//
// ------------------------------------------------------ ce que le serveur vérifie
// LA DURÉE, avec ffprobe. La limite de taille ne suffit pas : un mp3 très
// compressé fait tenir une heure de musique dans deux mégaoctets, et une
// « sonnerie » d'une heure est surtout un moyen de faire jouer n'importe quoi
// dans les oreilles de quelqu'un qui n'a rien demandé.

const router = express.Router();

// FFMPEG SEUL, PAS FFPROBE. Le paquet `ffmpeg-static` n'embarque que le premier
// (voir server/package.json), et dériver le chemin du second en remplaçant
// « ffmpeg » par « ffprobe » donne un exécutable qui n'existe pas : la mesure
// échouerait silencieusement sur toutes les installations, donc la limite de
// durée ne serait jamais opposée. On lit la durée dans ce que ffmpeg raconte au
// démarrage, ce qui ne coûte rien puisqu'il n'encode rien (`-f null`).
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../../uploads/ringtones");
fs.mkdirSync(DIR, { recursive: true });

// Trente secondes. Au-delà ce n'est plus une sonnerie, et de toute façon la
// nôtre s'arrête au bout de 45 s (RING_MS, lib/callRooms.js).
const MAX_SEC = 30;

const EXT = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR),
    filename: (req, file, cb) => {
      const base = String(file.mimetype).split(";")[0];
      cb(null, `r-${Date.now()}-${Math.round(Math.random() * 1e6)}${EXT[base] || ".mp3"}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, Object.hasOwn(EXT, String(file.mimetype).split(";")[0])),
});

// L'URL est ABSOLUE en base, comme celle des photos de profil (routes/
// users.js). C'est ce qui permet au client de la donner telle quelle à une
// balise <audio> : le front et l'API ne vivent pas sur la même origine en
// développement, et une sonnerie qui ne joue que sur le serveur de production
// est un réglage qu'on ne peut pas essayer.
const absUrl = (req, filename) =>
  `${req.protocol}://${req.get("host")}/uploads/ringtones/${filename}`;

// Le chemin disque, retrouvé depuis l'URL. On ne garde que le nom de fichier :
// une URL est du texte venu de la base, et la faire entrer telle quelle dans un
// `path.join` invite les « ../.. » à se promener dans l'arborescence.
const diskPath = (url) => path.join(DIR, path.basename(String(url || "").split("?")[0]));

// La durée d'un fichier audio. `null` si ffprobe manque ou ne comprend pas : on
// accepte alors le fichier plutôt que de refuser un envoi pour un outil absent
// — la limite de taille reste, elle, toujours opposable.
function durationOf(file) {
  return new Promise((resolve) => {
    execFile(
      FFMPEG,
      ["-hide_banner", "-i", file, "-f", "null", "-"],
      { timeout: 15_000 },
      (err, stdout, stderr) => {
        // ffmpeg écrit ses informations sur la SORTIE D'ERREUR, y compris quand
        // tout va bien — et il sort en échec faute de fichier de destination.
        // On lit donc `stderr` dans les deux cas, sans regarder `err`.
        const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr || ""));
        if (!m) return resolve(null);
        const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        resolve(Number.isFinite(seconds) ? seconds : null);
      }
    );
  });
}

const drop = (url) => {
  if (!url || !String(url).includes("/uploads/ringtones/")) return;
  fs.promises.unlink(diskPath(url)).catch(() => {
    /* déjà parti, ou jamais écrit : rien à réparer */
  });
};

// Le fichier reçu, vérifié et rangé. Rend `{ url, duration }`, ou lève avec un
// message affichable tel quel.
async function accept(req, file) {
  const seconds = await durationOf(file.path);
  if (seconds !== null && seconds > MAX_SEC) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new Error(`Trop long : ${Math.round(seconds)} s (${MAX_SEC} s maximum).`);
  }
  return { url: absUrl(req, file.filename), duration: seconds || 0 };
}

const view = (r) => ({
  id: String(r._id),
  name: r.name,
  url: r.url,
  duration: r.duration || 0,
  active: !!r.active,
  isDefault: !!r.isDefault,
  order: r.order || 0,
});

// ----------------------------------------------------------------------
//  La sonnerie par défaut de l'app
// ----------------------------------------------------------------------
// Celle que l'administrateur a désignée ; à défaut, la première de la liste.
// Ce repli compte : il évite qu'oublier de cocher la case rende tout le monde
// silencieux, alors qu'une banque garnie contient forcément quelque chose de
// jouable.
//
// `null` si la banque est vide — et là, il n'y a rien à jouer. C'est le prix du
// retrait de la sonnerie synthétisée, et les deux écrans le disent.
async function defaultTone() {
  return (
    (await Ringtone.findOne({ active: true, isDefault: true }).lean()) ||
    (await Ringtone.findOne({ active: true }).sort({ order: 1, createdAt: 1 }).lean()) ||
    null
  );
}

// Ce qui doit RÉELLEMENT sonner chez quelqu'un. Résolu ICI et pas dans le
// navigateur : le client n'a alors qu'une URL à jouer, sans avoir à connaître
// la banque, la sonnerie par défaut ni l'ordre de préséance entre les deux.
async function effectiveFor(userId) {
  const me = await User.findById(userId).select("ringtone").lean();
  const source = me?.ringtone?.source === "synth" ? "default" : me?.ringtone?.source;
  if (source === "preset" || source === "custom") {
    if (me?.ringtone?.url) return { url: me.ringtone.url, name: me.ringtone.name || "" };
  }
  const tone = await defaultTone();
  return tone ? { url: tone.url, name: tone.name } : { url: null, name: "" };
}

// ----------------------------------------------------------------------
//  GET / — les sonneries proposées, et la mienne
// ----------------------------------------------------------------------
router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows, me, fallback] = await Promise.all([
      Ringtone.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean(),
      User.findById(req.userId).select("ringtone").lean(),
      defaultTone(),
    ]);
    res.json({
      presets: rows.map(view),
      // La sonnerie par défaut, à part : c'est la première ligne de l'écran de
      // réglage, et elle doit s'écouter comme les autres.
      fallback: fallback ? view(fallback) : null,
      mine: {
        source: me?.ringtone?.source === "synth" ? "default" : me?.ringtone?.source || "default",
        preset: me?.ringtone?.preset ? String(me.ringtone.preset) : null,
        url: me?.ringtone?.url || null,
        file: me?.ringtone?.file || null,
        name: me?.ringtone?.name || "",
      },
      maxSeconds: MAX_SEC,
    });
  } catch (err) {
    console.error("ringtones list error:", err.message);
    res.status(500).json({ error: "Impossible de charger les sonneries." });
  }
});

// ----------------------------------------------------------------------
//  GET /effective — ce qui doit sonner chez moi, tout résolu
// ----------------------------------------------------------------------
// Une URL, ou rien. C'est la seule chose dont la modale d'appel a besoin, et la
// lui donner toute faite évite de recopier dans le navigateur la préséance
// entre « mon fichier », « ma sonnerie de la banque » et « celle de l'app ».
router.get("/effective", requireAuth, async (req, res) => {
  try {
    res.json(await effectiveFor(req.userId));
  } catch (err) {
    console.error("ringtone effective error:", err.message);
    // Une erreur ici ne doit pas empêcher un appel d'arriver : on répond « pas
    // de son » plutôt qu'un échec que l'appelant devrait gérer.
    res.json({ url: null, name: "" });
  }
});

// ----------------------------------------------------------------------
//  PUT /mine — je choisis
// ----------------------------------------------------------------------
// L'URL de la sonnerie choisie est RECOPIÉE sur le compte. Voir le modèle
// User : c'est ce qui fait qu'une sonnerie retirée de la banque continue de
// sonner chez ceux qui l'avaient prise, plutôt que de les rendre muets sans
// prévenir.
router.put("/mine", requireAuth, async (req, res) => {
  try {
    const source = String(req.body?.source || "default");
    if (!["default", "preset", "custom"].includes(source))
      return res.status(400).json({ error: "Choix inconnu." });

    const me = await User.findById(req.userId).select("ringtone");
    if (!me) return res.status(404).json({ error: "Compte introuvable." });

    if (source === "default") {
      // On NE SUPPRIME PAS le fichier personnel (`file`) : essayer la sonnerie
      // par défaut puis revenir au sien ne doit pas obliger à le renvoyer. Il
      // se supprime par un geste explicite (DELETE /mine/file).
      me.ringtone.source = "default";
      me.ringtone.preset = null;
      me.ringtone.url = null;
      me.ringtone.name = "";
    } else if (source === "preset") {
      const preset = await Ringtone.findById(String(req.body?.presetId || "")).lean();
      if (!preset) return res.status(404).json({ error: "Sonnerie introuvable." });
      me.ringtone.source = "preset";
      me.ringtone.preset = preset._id;
      me.ringtone.url = preset.url;
      me.ringtone.name = preset.name;
    } else {
      if (!me.ringtone?.file)
        return res.status(409).json({ error: "Envoie d'abord ton fichier." });
      me.ringtone.source = "custom";
      me.ringtone.preset = null;
      me.ringtone.url = me.ringtone.file;
    }

    await me.save();
    res.json({ ringtone: me.toPublic().ringtone });
  } catch (err) {
    console.error("ringtone choose error:", err.message);
    res.status(500).json({ error: "Réglage impossible." });
  }
});

// ----------------------------------------------------------------------
//  POST /mine — ma sonnerie à moi
// ----------------------------------------------------------------------
// Envoyer SÉLECTIONNE dans la foulée : on ne dépose pas un fichier pour ensuite
// devoir penser à cocher une case. C'est manifestement ce qu'on voulait.
router.post("/mine", requireAuth, upload.single("ringtone"), async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ error: "Fichier audio attendu (mp3, m4a, ogg, wav — 3 Mo max)." });

    let stored;
    try {
      stored = await accept(req, req.file);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const me = await User.findById(req.userId).select("ringtone username");
    if (!me) return res.status(404).json({ error: "Compte introuvable." });

    // L'ANCIEN FICHIER PART. Sans ça, chaque essai laisse un mp3 orphelin sur
    // le disque, et le rayon des sonneries grossit sans que personne ne le
    // regarde jamais (cf. l'onglet Système du panel admin).
    drop(me.ringtone?.file);

    me.ringtone.source = "custom";
    me.ringtone.preset = null;
    me.ringtone.file = stored.url;
    me.ringtone.url = stored.url;
    me.ringtone.name = String(req.body?.name || req.file.originalname || "Ma sonnerie")
      .replace(/\.[a-z0-9]+$/i, "")
      .slice(0, 60);
    await me.save();
    res.json({ ringtone: me.toPublic().ringtone });
  } catch (err) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    console.error("ringtone upload error:", err.message);
    res.status(500).json({ error: "Envoi impossible." });
  }
});

// DELETE /mine/file — je retire ma sonnerie et je reviens au défaut
router.delete("/mine/file", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("ringtone");
    if (!me) return res.status(404).json({ error: "Compte introuvable." });
    drop(me.ringtone?.file);
    me.ringtone.source = "default";
    me.ringtone.preset = null;
    me.ringtone.url = null;
    me.ringtone.file = null;
    me.ringtone.name = "";
    await me.save();
    res.json({ ringtone: me.toPublic().ringtone });
  } catch (err) {
    console.error("ringtone delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

// ======================================================================
//  Administration de la banque
// ======================================================================
router.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await Ringtone.find().sort({ order: 1, createdAt: 1 }).lean();
    res.json({ items: rows.map(view), maxSeconds: MAX_SEC });
  } catch (err) {
    console.error("ringtone admin list error:", err.message);
    res.status(500).json({ error: "Erreur de chargement." });
  }
});

router.post(
  "/admin",
  requireAuth,
  requireAdmin,
  upload.single("ringtone"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Fichier audio attendu." });
      let stored;
      try {
        stored = await accept(req, req.file);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      // Le nom du fichier fait un titre par défaut correct dans la quasi-
      // totalité des cas (« nokia-tune.mp3 ») : le champ reste modifiable, mais
      // on ne force personne à le remplir pour déposer trois sonneries.
      const name =
        String(req.body?.name || req.file.originalname || "Sonnerie")
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/[-_]+/g, " ")
          .trim()
          .slice(0, 60) || "Sonnerie";

      const last = await Ringtone.findOne().sort({ order: -1 }).select("order").lean();
      // LA PREMIÈRE DÉPOSÉE DEVIENT LA SONNERIE PAR DÉFAUT. Sans ça, déposer une
      // sonnerie ne changerait rien tant qu'on n'a pas trouvé l'étoile à cocher
      // — et l'app resterait silencieuse alors qu'on vient de la garnir.
      const none = !(await Ringtone.exists({}));
      const doc = await Ringtone.create({
        name,
        url: stored.url,
        duration: stored.duration,
        order: (last?.order || 0) + 1,
        isDefault: none,
        createdBy: req.userId,
      });
      res.status(201).json({ item: view(doc) });
    } catch (err) {
      if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
      console.error("ringtone admin upload error:", err.message);
      res.status(500).json({ error: "Envoi impossible." });
    }
  }
);

router.patch("/admin/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await Ringtone.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Sonnerie introuvable." });
    if (typeof req.body?.name === "string") doc.name = req.body.name.trim().slice(0, 60);
    if (typeof req.body?.active === "boolean") doc.active = req.body.active;
    if (req.body?.isDefault === true) {
      // UNE SEULE par défaut : on démarque les autres dans le même geste, sinon
      // deux sonneries se disputent la place et c'est l'ordre de la requête qui
      // tranche — donc au hasard.
      await Ringtone.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
      doc.isDefault = true;
      // Une sonnerie par défaut désactivée n'aurait aucun sens : c'est celle que
      // tout le monde entend.
      doc.active = true;
    } else if (req.body?.isDefault === false) {
      doc.isDefault = false;
    }
    if (Number.isFinite(Number(req.body?.order))) doc.order = Number(req.body.order);
    await doc.save();
    res.json({ item: view(doc) });
  } catch (err) {
    console.error("ringtone admin patch error:", err.message);
    res.status(500).json({ error: "Modification impossible." });
  }
});

// La suppression est DÉFINITIVE et emporte le fichier : ceux qui l'avaient
// choisie gardent l'URL sur leur compte et se retrouveraient devant un 404.
// C'est pour ça que la désactivation existe, et que l'écran d'admin la propose
// en premier — celle-ci est là pour les erreurs d'envoi, pas pour le ménage.
router.delete("/admin/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await Ringtone.findByIdAndDelete(req.params.id);
    if (doc) drop(doc.url);
    // Ceux qui l'avaient reviennent à la sonnerie par défaut plutôt qu'à un
    // fichier absent : muet sans explication est le pire des deux.
    if (doc)
      await User.updateMany(
        { "ringtone.preset": doc._id },
        {
          $set: {
            "ringtone.source": "default",
            "ringtone.preset": null,
            "ringtone.url": null,
            "ringtone.name": "",
          },
        }
      );
    res.json({ ok: true });
  } catch (err) {
    console.error("ringtone admin delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

export default router;
