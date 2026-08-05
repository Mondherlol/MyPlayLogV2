import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import Patchnote from "../models/Patchnote.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

// --- Upload d'images de patch note (avant/après…) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/patchnotes");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `pn-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 }, // 6 Mo
  fileFilter: (req, file, cb) =>
    cb(null, /^image\//.test(file.mimetype)),
});

// ======================================================================
//  CÔTÉ UTILISATEUR
// ======================================================================

// Dernier patch note publié SI l'utilisateur ne l'a pas encore vu, sinon null.
// C'est ce qui déclenche la pop-up des nouveautés une seule fois.
router.get("/latest", requireAuth, async (req, res) => {
  try {
    const latest = await Patchnote.findOne({ published: true })
      .sort({ publishedAt: -1, createdAt: -1 })
      .exec();
    if (!latest) return res.json({ patchnote: null });

    const user = await User.findById(req.userId).select("seenPatchnote");
    if (user?.seenPatchnote === latest.version) {
      return res.json({ patchnote: null });
    }
    res.json({ patchnote: latest.toClient() });
  } catch (err) {
    console.error("patchnote latest error:", err.message);
    res.status(500).json({ error: "Erreur lors du chargement des nouveautés." });
  }
});

// Marque une version comme vue (appelé à la fermeture de la pop-up).
router.post("/seen", requireAuth, async (req, res) => {
  try {
    const version = String(req.body?.version || "").trim();
    if (!version) return res.status(400).json({ error: "Version manquante." });
    await User.findByIdAndUpdate(req.userId, { seenPatchnote: version });
    res.json({ ok: true });
  } catch (err) {
    console.error("patchnote seen error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// ======================================================================
//  CÔTÉ ADMIN (réservé à ADMIN_EMAIL)
// ======================================================================

// Liste complète (brouillons compris) pour l'éditeur.
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const notes = await Patchnote.find().sort({ createdAt: -1 }).exec();
    res.json({ patchnotes: notes.map((n) => n.toClient()) });
  } catch (err) {
    console.error("patchnote list error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Nettoie/valide le corps envoyé par l'éditeur.
function sanitize(body) {
  const items = Array.isArray(body?.items)
    ? body.items
        .map((it) => ({
          icon: String(it?.icon || "Sparkles").trim() || "Sparkles",
          title: String(it?.title || "").trim(),
          description: String(it?.description || "").trim(),
          images: Array.isArray(it?.images)
            ? it.images.filter((u) => typeof u === "string").slice(0, 2)
            : [],
        }))
        .filter((it) => it.title)
    : [];
  return {
    version: String(body?.version || "").trim(),
    title: String(body?.title || "").trim(),
    intro: String(body?.intro || "").trim(),
    items,
  };
}

// Création d'un brouillon.
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = sanitize(req.body);
    if (!data.version || !data.title) {
      return res.status(400).json({ error: "Version et titre sont requis." });
    }
    const exists = await Patchnote.findOne({ version: data.version });
    if (exists) {
      return res.status(409).json({ error: "Cette version existe déjà." });
    }
    const note = await Patchnote.create(data);
    res.status(201).json({ patchnote: note.toClient() });
  } catch (err) {
    console.error("patchnote create error:", err.message);
    res.status(500).json({ error: "Erreur lors de la création." });
  }
});

// Édition d'un patch note.
router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const note = await Patchnote.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Patch note introuvable." });
    const data = sanitize(req.body);
    if (!data.version || !data.title) {
      return res.status(400).json({ error: "Version et titre sont requis." });
    }
    // Collision de version avec un autre document ?
    const clash = await Patchnote.findOne({
      version: data.version,
      _id: { $ne: note._id },
    });
    if (clash) return res.status(409).json({ error: "Cette version existe déjà." });

    note.version = data.version;
    note.title = data.title;
    note.intro = data.intro;
    note.items = data.items;
    await note.save();
    res.json({ patchnote: note.toClient() });
  } catch (err) {
    console.error("patchnote update error:", err.message);
    res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

// Publier / dépublier. Publier (re)positionne publishedAt pour passer en tête.
router.post("/:id/publish", requireAuth, requireAdmin, async (req, res) => {
  try {
    const note = await Patchnote.findById(req.params.id);
    if (!note) return res.status(404).json({ error: "Patch note introuvable." });
    const publish = req.body?.published !== false;
    note.published = publish;
    note.publishedAt = publish ? new Date() : null;
    await note.save();
    res.json({ patchnote: note.toClient() });
  } catch (err) {
    console.error("patchnote publish error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await Patchnote.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("patchnote delete error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// Upload d'une image → renvoie l'URL à stocker dans un item.
router.post(
  "/upload",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file)
        return res.status(400).json({ error: "Image manquante ou invalide." });
      const url = `${req.protocol}://${req.get("host")}/uploads/patchnotes/${req.file.filename}`;
      res.json({ url });
    } catch (err) {
      console.error("patchnote upload error:", err.message);
      res.status(500).json({ error: "Échec de l'upload." });
    }
  }
);

export default router;
