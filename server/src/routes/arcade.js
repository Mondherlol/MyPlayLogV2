import express from "express";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import Reward, { REWARD_TYPE_KEYS } from "../models/Reward.js";
import LootCase from "../models/LootCase.js";
import PointEntry from "../models/PointEntry.js";
import User from "../models/User.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { grantPoints, spendPoints } from "../lib/points.js";
import { RARITIES, isRarity, rewardWeight, duplicateRefund } from "../lib/rarity.js";

// ======================================================================
//  Arcade — les points gagnés en jouant s'échangent contre des cosmétiques.
// ======================================================================
// Le tirage est INTÉGRALEMENT serveur : le client reçoit le gagnant déjà décidé
// plus une bobine à faire défiler, et n'a aucun moyen d'influer sur le résultat.
// (Contrairement au blind test, où le client estime les points en direct : ici
// il y a un solde réel en jeu, donc zéro confiance accordée au client.)
const router = express.Router();

// --- Upload des visuels de lots / caisses (même schéma que les patch notes) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/arcade");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `ar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 Mo : un curseur, c'est minuscule
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    // « é » → « e » + accent combinant, qu'on retire : sans ça l'accent
    // deviendrait un tiret et « améthyste » donnerait « ame-thyste ».
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

// Slug libre : on suffixe -2, -3… tant que la place est prise.
async function uniqueKey(Model, base) {
  const root = slugify(base) || "lot";
  let key = root;
  for (let i = 2; await Model.exists({ key }); i++) key = `${root}-${i}`;
  return key;
}

// ======================================================================
//  Côté joueur
// ======================================================================

// Une caisse telle que le joueur la voit : son prix, et son contenu annoncé
// avec la CHANCE RÉELLE de chaque lot (calculée depuis les poids). On montre
// les probabilités : c'est plus honnête, et ça rend l'attente meilleure.
function publicCase(c, rewards) {
  const pool = rewards.filter((r) => r.enabled);
  const total = pool.reduce((a, r) => a + rewardWeight(r), 0);
  return {
    id: String(c._id),
    key: c.key,
    name: c.name,
    description: c.description || "",
    price: c.price,
    image: c.image || null,
    openable: pool.length > 0,
    rewards: pool
      .map((r) => ({
        ...r.toPublic(),
        chance: total > 0 ? rewardWeight(r) / total : 0,
      }))
      .sort((a, b) => a.chance - b.chance), // les plus rares en tête
  };
}

// GET /api/arcade — tout ce qu'il faut pour peindre la page en un appel :
// mon solde, les caisses ouvrables, et mon inventaire.
router.get("/", requireAuth, async (req, res) => {
  try {
    const [user, cases] = await Promise.all([
      User.findById(req.userId).select("points inventory equipped").lean(),
      LootCase.find({ enabled: true }).sort({ order: 1, createdAt: 1 }).populate("rewards"),
    ]);
    if (!user) return res.status(404).json({ error: "Compte introuvable." });

    const owned = new Map((user.inventory || []).map((i) => [i.rewardKey, i]));
    // L'inventaire garde des slugs : on résout ici pour renvoyer des lots
    // complets. Un lot désactivé depuis reste affiché — il a été gagné.
    const ownedRewards = owned.size
      ? await Reward.find({ key: { $in: [...owned.keys()] } })
      : [];

    res.json({
      points: user.points || 0,
      equipped: {
        cursor: user.equipped?.cursor || null,
        ornament: user.equipped?.ornament || null,
        badge: user.equipped?.badge || null,
      },
      cases: cases.map((c) => publicCase(c, c.rewards || [])),
      inventory: ownedRewards.map((r) => ({
        ...r.toPublic(),
        obtainedAt: owned.get(r.key)?.obtainedAt || null,
        count: owned.get(r.key)?.count || 1,
      })),
    });
  } catch (err) {
    console.error("arcade get error:", err.message);
    res.status(500).json({ error: "Impossible de charger l'arcade." });
  }
});

// GET /api/arcade/cosmetics — les lots ÉQUIPÉS, résolus (image, hotspot…).
// Appelé au démarrage de l'app par CosmeticsContext, qui applique le curseur.
// Volontairement minuscule et sans dépendance : il tourne à chaque chargement.
router.get("/cosmetics", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("equipped").lean();
    const keys = [
      user?.equipped?.cursor,
      user?.equipped?.ornament,
      user?.equipped?.badge,
    ].filter(Boolean);
    if (!keys.length) return res.json({ cosmetics: {} });
    const rewards = await Reward.find({ key: { $in: keys } });
    const byKey = new Map(rewards.map((r) => [r.key, r.toPublic()]));
    const cosmetics = {};
    for (const type of REWARD_TYPE_KEYS) {
      const k = user.equipped?.[type];
      if (k && byKey.has(k)) cosmetics[type] = byKey.get(k);
    }
    res.json({ cosmetics });
  } catch (err) {
    console.error("arcade cosmetics error:", err.message);
    res.json({ cosmetics: {} }); // jamais bloquant : au pire, apparence par défaut
  }
});

// Tirage pondéré : chaque lot occupe un segment proportionnel à son poids sur
// une règle de longueur `total`, et on plante une aiguille au hasard dessus.
function drawReward(pool) {
  const total = pool.reduce((a, r) => a + rewardWeight(r), 0);
  if (total <= 0) return null;
  let n = Math.random() * total;
  for (const r of pool) {
    n -= rewardWeight(r);
    if (n <= 0) return r;
  }
  return pool[pool.length - 1]; // filet de sécurité (arrondis flottants)
}

// La bobine que le client fait défiler. Purement décorative : le gagnant est
// déjà décidé, on l'assoit à une position FIXE et on remplit le reste au
// hasard (pondéré, pour que la bobine « ressemble » au contenu de la caisse).
const REEL_LENGTH = 64;
const REEL_WINNER_INDEX = 56; // le gagnant s'arrête ici, il reste du rab derrière

function buildReel(pool, winner) {
  const reel = [];
  for (let i = 0; i < REEL_LENGTH; i++) {
    reel.push(i === REEL_WINNER_INDEX ? winner : drawReward(pool) || winner);
  }
  return reel;
}

// POST /api/arcade/cases/:id/open — débite, tire, range dans l'inventaire.
router.post("/cases/:id/open", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Caisse introuvable." });
    const box = await LootCase.findById(req.params.id).populate("rewards");
    if (!box || !box.enabled)
      return res.status(404).json({ error: "Caisse introuvable." });

    const pool = (box.rewards || []).filter((r) => r.enabled);
    if (!pool.length)
      return res.status(422).json({ error: "Cette caisse est vide pour le moment." });

    // 1. On paie D'ABORD (atomique) : pas de tirage gratuit si le solde manque.
    let balance;
    try {
      balance = await spendPoints(req.userId, box.price, "case", {
        caseId: String(box._id),
        caseName: box.name,
      });
    } catch (e) {
      if (e.code === "INSUFFICIENT_POINTS")
        return res.status(402).json({ error: "Tu n'as pas assez de points." });
      throw e;
    }

    // 2. Le tirage.
    const winner = drawReward(pool);
    const reel = buildReel(pool, winner);

    // 3. Rangement. Doublon → on incrémente le compteur et on rembourse une
    //    part du prix, proportionnelle à la rareté (voir lib/rarity.js).
    const user = await User.findById(req.userId).select("inventory");
    const existing = (user.inventory || []).find((i) => i.rewardKey === winner.key);
    let refund = 0;
    if (existing) {
      refund = duplicateRefund(winner, box.price);
      existing.count = (existing.count || 1) + 1;
      await user.save({ timestamps: false });
      balance = (await grantPoints(req.userId, refund, "duplicate", {
        rewardKey: winner.key,
        rewardName: winner.name,
      })) ?? balance;
    } else {
      user.inventory.push({ rewardKey: winner.key, obtainedAt: new Date(), count: 1 });
      await user.save({ timestamps: false });
    }

    res.json({
      reward: winner.toPublic(),
      duplicate: !!existing,
      refund,
      points: balance,
      reel: reel.map((r) => r.toPublic()),
      winnerIndex: REEL_WINNER_INDEX,
    });
  } catch (err) {
    console.error("arcade open error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir la caisse." });
  }
});

// POST /api/arcade/equip — équipe (ou retire, si rewardKey est null) un lot.
router.post("/equip", requireAuth, async (req, res) => {
  try {
    const key = req.body?.rewardKey ? String(req.body.rewardKey) : null;
    const user = await User.findById(req.userId).select("inventory equipped");
    if (!user) return res.status(404).json({ error: "Compte introuvable." });

    // Retrait : le client dit quelle famille libérer.
    if (!key) {
      const type = String(req.body?.type || "");
      if (!REWARD_TYPE_KEYS.includes(type))
        return res.status(400).json({ error: "Type de lot inconnu." });
      user.equipped[type] = null;
      await user.save({ timestamps: false });
      return res.json({ equipped: user.equipped, cosmetic: null });
    }

    // On n'équipe que ce qu'on possède — la vérif est ici, pas côté client.
    if (!(user.inventory || []).some((i) => i.rewardKey === key))
      return res.status(403).json({ error: "Tu ne possèdes pas ce lot." });
    const reward = await Reward.findOne({ key });
    if (!reward) return res.status(404).json({ error: "Lot introuvable." });

    user.equipped[reward.type] = key;
    await user.save({ timestamps: false });
    res.json({ equipped: user.equipped, cosmetic: reward.toPublic() });
  } catch (err) {
    console.error("arcade equip error:", err.message);
    res.status(500).json({ error: "Impossible d'équiper ce lot." });
  }
});

// GET /api/arcade/history — d'où viennent mes points (30 dernières lignes).
router.get("/history", requireAuth, async (req, res) => {
  try {
    const rows = await PointEntry.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json({
      entries: rows.map((r) => ({
        id: String(r._id),
        amount: r.amount,
        source: r.source,
        balance: r.balance,
        meta: r.meta || {},
        date: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("arcade history error:", err.message);
    res.status(500).json({ error: "Impossible de charger l'historique." });
  }
});

// ======================================================================
//  Côté admin — gestion des lots et des caisses.
// ======================================================================

// GET /api/arcade/admin/data — lots + caisses + barème des raretés.
router.get("/admin/data", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rewards, cases] = await Promise.all([
      Reward.find().sort({ createdAt: -1 }),
      LootCase.find().sort({ order: 1, createdAt: 1 }).lean(),
    ]);
    res.json({
      rarities: RARITIES,
      rewards: rewards.map((r) => ({
        ...r.toPublic(),
        weight: r.weight ?? null,
        createdAt: r.createdAt,
      })),
      cases: cases.map((c) => ({
        id: String(c._id),
        key: c.key,
        name: c.name,
        description: c.description || "",
        price: c.price,
        image: c.image || null,
        enabled: c.enabled,
        order: c.order || 0,
        rewardIds: (c.rewards || []).map((id) => String(id)),
      })),
    });
  } catch (err) {
    console.error("arcade admin data error:", err.message);
    res.status(500).json({ error: "Impossible de charger les récompenses." });
  }
});

// POST /api/arcade/admin/upload — visuel d'un lot ou d'une caisse.
router.post(
  "/admin/upload",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    if (!req.file)
      return res.status(400).json({ error: "Image manquante ou invalide." });
    const url = `${req.protocol}://${req.get("host")}/uploads/arcade/${req.file.filename}`;
    res.json({ url });
  }
);

function readRewardBody(body) {
  const type = String(body?.type || "");
  if (!REWARD_TYPE_KEYS.includes(type)) throw new Error("Type de lot inconnu.");
  const name = String(body?.name || "").trim();
  if (!name) throw new Error("Le nom est obligatoire.");
  const rarity = isRarity(body?.rarity) ? String(body.rarity) : "common";
  const w = Number(body?.weight);
  return {
    type,
    name,
    rarity,
    description: String(body?.description || "").trim().slice(0, 200),
    weight: Number.isFinite(w) && w > 0 ? w : null,
    data: body?.data && typeof body.data === "object" ? body.data : {},
    enabled: body?.enabled !== false,
  };
}

// POST /api/arcade/admin/rewards — nouveau lot.
router.post("/admin/rewards", requireAuth, requireAdmin, async (req, res) => {
  try {
    const fields = readRewardBody(req.body);
    if (fields.type === "cursor" && !fields.data?.url)
      return res.status(400).json({ error: "Un curseur a besoin de son image." });
    const key = await uniqueKey(Reward, req.body?.key || fields.name);
    const doc = await Reward.create({ ...fields, key, createdBy: req.userId });
    res.status(201).json({ reward: doc.toPublic() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/arcade/admin/rewards/:id — modifie un lot (le slug ne bouge JAMAIS :
// il est référencé par les inventaires des joueurs).
router.put("/admin/rewards/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Lot introuvable." });
    const fields = readRewardBody(req.body);
    const doc = await Reward.findByIdAndUpdate(req.params.id, fields, { new: true });
    if (!doc) return res.status(404).json({ error: "Lot introuvable." });
    res.json({ reward: doc.toPublic() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/arcade/admin/rewards/:id — retire le lot des caisses ET des
// joueurs qui l'avaient. Pour le sortir des tirages sans déposséder personne,
// préférer `enabled: false`.
router.delete("/admin/rewards/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Lot introuvable." });
    const doc = await Reward.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Lot introuvable." });
    await Promise.all([
      LootCase.updateMany({ rewards: doc._id }, { $pull: { rewards: doc._id } }),
      User.updateMany(
        { "inventory.rewardKey": doc.key },
        { $pull: { inventory: { rewardKey: doc.key } } },
        { timestamps: false }
      ),
      User.updateMany(
        { [`equipped.${doc.type}`]: doc.key },
        { $set: { [`equipped.${doc.type}`]: null } },
        { timestamps: false }
      ),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("arcade reward delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

function readCaseBody(body) {
  const name = String(body?.name || "").trim();
  if (!name) throw new Error("Le nom est obligatoire.");
  const price = Number(body?.price);
  if (!Number.isFinite(price) || price < 0) throw new Error("Prix invalide.");
  const ids = Array.isArray(body?.rewardIds) ? body.rewardIds : [];
  return {
    name,
    price: Math.round(price),
    description: String(body?.description || "").trim().slice(0, 240),
    image: body?.image ? String(body.image) : null,
    rewards: ids.filter((id) => mongoose.isValidObjectId(id)),
    enabled: body?.enabled !== false,
    order: Number(body?.order) || 0,
  };
}

// POST /api/arcade/admin/cases — nouvelle caisse.
router.post("/admin/cases", requireAuth, requireAdmin, async (req, res) => {
  try {
    const fields = readCaseBody(req.body);
    const key = await uniqueKey(LootCase, req.body?.key || fields.name);
    const doc = await LootCase.create({ ...fields, key });
    res.status(201).json({ id: String(doc._id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/arcade/admin/cases/:id
router.put("/admin/cases/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Caisse introuvable." });
    const fields = readCaseBody(req.body);
    const doc = await LootCase.findByIdAndUpdate(req.params.id, fields, { new: true });
    if (!doc) return res.status(404).json({ error: "Caisse introuvable." });
    res.json({ id: String(doc._id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/arcade/admin/cases/:id — les lots gagnés dedans restent acquis.
router.delete("/admin/cases/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Caisse introuvable." });
    const doc = await LootCase.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Caisse introuvable." });
    res.json({ ok: true });
  } catch (err) {
    console.error("arcade case delete error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
  }
});

// POST /api/arcade/admin/grant — crédite un joueur à la main (dédommagement,
// test, événement…). Tracé dans le grand livre comme tout le reste.
router.post("/admin/grant", requireAuth, requireAdmin, async (req, res) => {
  try {
    const amount = Math.round(Number(req.body?.amount) || 0);
    const userId = String(req.body?.userId || "");
    if (!mongoose.isValidObjectId(userId))
      return res.status(400).json({ error: "Utilisateur invalide." });
    if (!amount) return res.status(400).json({ error: "Montant invalide." });
    const balance =
      amount > 0
        ? await grantPoints(userId, amount, "admin", { by: String(req.userId) })
        : await spendPoints(userId, -amount, "admin", { by: String(req.userId) });
    res.json({ points: balance });
  } catch (err) {
    if (err.code === "INSUFFICIENT_POINTS")
      return res.status(400).json({ error: "Solde insuffisant pour ce retrait." });
    console.error("arcade grant error:", err.message);
    res.status(500).json({ error: "Ajustement impossible." });
  }
});

export default router;
