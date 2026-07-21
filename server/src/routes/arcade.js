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
import { planArcadeBackfill, runArcadeBackfill } from "../lib/arcadeBackfill.js";
import { recordActivity } from "../lib/activity.js";
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

    // Journal pour le fil des abonnés (best-effort : une panne ici ne doit pas
    // priver le joueur de son lot, déjà acquis).
    recordActivity({
      actor: req.userId,
      type: "case_open",
      meta: {
        rewardKey: winner.key,
        rewardName: winner.name,
        rarity: winner.rarity,
        caseName: box.name,
        duplicate: !!existing,
      },
    });

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

// POST /api/arcade/admin/cases/:id/try — ouverture À BLANC (admin). Même tirage
// et même bobine que la vraie ouverture, mais ZÉRO effet : pas de débit, pas
// d'inventaire, pas de remboursement. Sert à sentir l'animation et la
// distribution d'une caisse (même désactivée) avant de la mettre en ligne.
router.post("/admin/cases/:id/try", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(404).json({ error: "Caisse introuvable." });
    const box = await LootCase.findById(req.params.id).populate("rewards");
    if (!box) return res.status(404).json({ error: "Caisse introuvable." });
    const pool = (box.rewards || []).filter((r) => r.enabled);
    if (!pool.length)
      return res.status(422).json({ error: "Cette caisse est vide pour le moment." });

    const winner = drawReward(pool);
    const reel = buildReel(pool, winner);
    res.json({
      reward: winner.toPublic(),
      reel: reel.map((r) => r.toPublic()),
      winnerIndex: REEL_WINNER_INDEX,
      dryRun: true,
    });
  } catch (err) {
    console.error("arcade try error:", err.message);
    res.status(500).json({ error: "Essai impossible." });
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

// --- Import d'un curseur depuis une page custom-cursor.com -----------------
// Le navigateur ne peut pas aller chercher custom-cursor.com (CORS) : c'est le
// serveur qui récupère la page, en extrait les images de curseur, les télécharge
// dans uploads/arcade, et renvoie chacune avec son rôle deviné. Convention du
// site : le fichier « …-cursor.png » est la flèche (normal), « …-pointer.png »
// la main de survol (pointer).
const CC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function ccFetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": CC_UA, "Accept-Language": "en" } });
  if (!r.ok) throw new Error(`Page inaccessible (${r.status}).`);
  return r.text();
}
async function ccFetchImage(url) {
  const r = await fetch(url, { headers: { "User-Agent": CC_UA } });
  if (!r.ok) throw new Error(`Image inaccessible (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) throw new Error("Image trop lourde.");
  if (buf.length < 8 || !(buf[0] === 0x89 && buf[1] === 0x50)) throw new Error("Ce n'est pas un PNG.");
  return buf;
}
function ccRoleFromSlug(slug) {
  if (/-pointer$/i.test(slug)) return "pointer"; // la main / le lien
  if (/-cursor$/i.test(slug)) return "normal"; // la flèche
  return null; // ambigu : l'admin tranchera dans la revue
}

router.post("/admin/cursor-from-url", requireAuth, requireAdmin, async (req, res) => {
  try {
    let u;
    try {
      u = new URL(String(req.body?.url || "").trim());
    } catch {
      throw new Error("URL invalide.");
    }
    if (!/(^|\.)custom-cursor\.com$/i.test(u.hostname))
      throw new Error("Seuls les liens custom-cursor.com sont pris en charge.");

    const page = await ccFetchText(u.href);

    // Le CDN est derrière Cloudflare : si une page de vérification nous est
    // servie, autant le dire clairement plutôt que de conclure « rien trouvé ».
    if (/Just a moment|cf_chl|Enable JavaScript and cookies/i.test(page))
      throw new Error(
        "custom-cursor.com a servi une page de vérification anti-bot au serveur. " +
          "Réessaie dans un instant, ou télécharge le curseur et importe le fichier."
      );

    // Images individuelles du pack : cdn.custom-cursor.com/db/{id}/{taille?}/{slug}.png.
    // Par id, on garde la plus grande variante ≤ 128 px (repli : l'originale).
    const re = /cdn\.custom-cursor\.com\/db\/(\d+)\/(?:(\d+)\/)?([a-z0-9-]+)\.png/gi;
    const byId = new Map();
    for (let m; (m = re.exec(page)); ) {
      const [full, id, sizeStr, slug] = m;
      const size = sizeStr ? Number(sizeStr) : 0;
      const eff = size > 128 ? -1 : size === 0 ? 1 : size; // originale = repli faible
      const prev = byId.get(id);
      if (eff >= 0 && (!prev || eff > prev.eff))
        byId.set(id, { slug, eff, url: `https://${full}` });
    }
    // Aucune image individuelle : le plus souvent parce que l'URL pointe une
    // COLLECTION (une liste de packs) et non la page d'un curseur. On distingue
    // les deux grâce aux vignettes de packs, pour donner la bonne consigne.
    if (!byId.size) {
      const isListing = /cdn\.custom-cursor\.com\/packs\//.test(page);
      throw new Error(
        isListing
          ? "Cette page est une collection (une liste de packs). Ouvre le curseur " +
            "qui t'intéresse et colle l'adresse de SA page."
          : "Aucun curseur trouvé sur cette page."
      );
    }

    const name = (page.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] || "")
      .replace(/\s*[–—-]\s*Custom Cursor.*$/i, "")
      .trim();

    const cursors = [];
    for (const { slug, url } of byId.values()) {
      const buf = await ccFetchImage(url);
      const filename = `ar-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
      cursors.push({
        role: ccRoleFromSlug(slug),
        slug,
        url: `${req.protocol}://${req.get("host")}/uploads/arcade/${filename}`,
      });
    }
    // Le rôle normal d'abord (c'est le requis).
    cursors.sort((a, b) => (a.role === "normal" ? -1 : b.role === "normal" ? 1 : 0));
    res.json({ name, cursors });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/arcade/admin/backfill — rattrapage des points de blind test gagnés
// avant la mise en ligne de l'arcade. Sans `apply: true`, c'est un APERÇU qui
// n'écrit rien : la même sécurité en deux temps que le script en ligne de
// commande (npm run backfill:arcade). Rejouable, ne double jamais un crédit.
router.post("/admin/backfill", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await planArcadeBackfill();
    const pending = rows.filter((r) => r.missing > 0);
    const apply = req.body?.apply === true;
    if (apply) await runArcadeBackfill(pending);
    res.json({
      applied: apply,
      total: pending.reduce((a, r) => a + r.missing, 0),
      upToDate: rows.length - pending.length,
      users: pending.map((r) => ({
        username: r.username,
        missing: r.missing,
        games: r.games,
        points: r.points,
      })),
    });
  } catch (err) {
    console.error("arcade backfill error:", err.message);
    res.status(500).json({ error: "Rattrapage impossible." });
  }
});

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

// PATCH /api/arcade/admin/rewards — édition rapide, en lot, des MÉTADONNÉES.
// Ne touche jamais à `data` : les images et les rôles restent la chasse gardée
// de l'éditeur complet. C'est tout l'intérêt d'avoir une route à part — le PUT
// reconstruit le document entier et effacerait `data` s'il arrivait sans lui.
router.patch("/admin/rewards", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    let updated = 0;
    for (const u of updates) {
      if (!mongoose.isValidObjectId(u?.id)) continue;
      const set = {};
      if (typeof u.name === "string" && u.name.trim()) set.name = u.name.trim();
      if (typeof u.description === "string")
        set.description = u.description.trim().slice(0, 200);
      if (isRarity(u.rarity)) set.rarity = String(u.rarity);
      if (typeof u.enabled === "boolean") set.enabled = u.enabled;
      if (u.weight === null || u.weight === "") set.weight = null;
      else if (u.weight !== undefined) {
        const w = Number(u.weight);
        if (Number.isFinite(w) && w > 0) set.weight = w;
      }
      if (!Object.keys(set).length) continue;
      const r = await Reward.updateOne({ _id: u.id }, { $set: set });
      if (r.matchedCount) updated++;
    }
    res.json({ updated });
  } catch (err) {
    console.error("arcade patch error:", err.message);
    res.status(500).json({ error: "Enregistrement impossible." });
  }
});

// DELETE /api/arcade/admin/rewards — vide TOUS les lots d'un coup, avec les
// mêmes conséquences que la suppression unitaire (pools de caisses vidés,
// inventaires et équipements des joueurs nettoyés). Irréversible : la sortie
// de secours est l'export de l'onglet Transfert, à faire AVANT.
router.delete("/admin/rewards", requireAuth, requireAdmin, async (req, res) => {
  try {
    const docs = await Reward.find().select("key").lean();
    if (!docs.length) return res.json({ deleted: 0 });
    const keys = docs.map((d) => d.key);
    await Promise.all([
      Reward.deleteMany({}),
      // Plus aucun lot n'existe : tous les pools deviennent vides.
      LootCase.updateMany({}, { $set: { rewards: [] } }),
      User.updateMany(
        { "inventory.rewardKey": { $in: keys } },
        { $pull: { inventory: { rewardKey: { $in: keys } } } },
        { timestamps: false }
      ),
      ...REWARD_TYPE_KEYS.map((t) =>
        User.updateMany(
          { [`equipped.${t}`]: { $in: keys } },
          { $set: { [`equipped.${t}`]: null } },
          { timestamps: false }
        )
      ),
    ]);
    res.json({ deleted: docs.length });
  } catch (err) {
    console.error("arcade wipe error:", err.message);
    res.status(500).json({ error: "Suppression impossible." });
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

// ======================================================================
//  Export / import de l'arcade — transfert local ⇄ prod.
// ======================================================================
// Deux pièges que ce format règle :
//  1. Les URLs d'images sont ABSOLUES et pointent sur l'instance qui les
//     héberge. Telles quelles, un export local donnerait des curseurs cassés
//     en prod. On EMBARQUE donc les fichiers (base64) et on remplace chaque
//     URL locale par une référence `asset:<fichier>`, ré-hébergée à l'import.
//  2. Les caisses référencent leurs lots par ObjectId, qui diffère d'une base
//     à l'autre. À l'export on écrit les CLÉS (slugs stables), résolues à
//     l'import contre la base d'arrivée.

const ASSET_PREFIX = "asset:";

// Transforme toutes les chaînes d'une valeur JSON (récursif, renvoie une copie).
// Permet de traiter url / frames[] / roles.* / base / library[] d'un coup, sans
// avoir à énumérer les chemins — donc rien à maintenir si `data` s'enrichit.
function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn);
    return out;
  }
  return value;
}

// « …/uploads/arcade/ar-123.png?x=1 » → « ar-123.png ». null si l'URL n'est pas
// un upload local (on la laisse alors telle quelle : elle reste peut-être
// joignable, par ex. un CDN externe).
function localUploadName(url) {
  const m = /\/uploads\/arcade\/([A-Za-z0-9._-]+)/.exec(String(url));
  return m ? m[1] : null;
}

// GET /api/arcade/admin/export — tout l'arcade dans un JSON autoportant.
router.get("/admin/export", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rewards, cases] = await Promise.all([
      Reward.find().sort({ createdAt: 1 }),
      LootCase.find().sort({ order: 1, createdAt: 1 }).populate("rewards"),
    ]);

    const assets = {};
    const grab = (url) => {
      const name = localUploadName(url);
      if (!name) return url;
      if (!assets[name]) {
        try {
          assets[name] = fs.readFileSync(path.join(UPLOAD_DIR, name)).toString("base64");
        } catch {
          return url; // fichier disparu : on garde l'URL d'origine
        }
      }
      return ASSET_PREFIX + name;
    };

    res.json({
      kind: "myplaylog-arcade",
      version: 1,
      exportedAt: new Date().toISOString(),
      rewards: rewards.map((r) => ({
        key: r.key,
        type: r.type,
        name: r.name,
        description: r.description || "",
        rarity: r.rarity,
        weight: r.weight ?? null,
        enabled: r.enabled,
        data: mapStrings(r.data || {}, grab),
      })),
      cases: cases.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description || "",
        price: c.price,
        image: c.image ? grab(c.image) : null,
        enabled: c.enabled,
        order: c.order || 0,
        rewardKeys: (c.rewards || []).map((r) => r.key).filter(Boolean),
      })),
      assets,
    });
  } catch (err) {
    console.error("arcade export error:", err.message);
    res.status(500).json({ error: "Export impossible." });
  }
});

// POST /api/arcade/admin/import — relit un export sur cette instance.
// `overwrite` décide du sort des clés déjà présentes (sinon : ignorées).
router.post("/admin/import", requireAuth, requireAdmin, async (req, res) => {
  try {
    const p = req.body?.payload ?? req.body;
    if (!p || p.kind !== "myplaylog-arcade")
      throw new Error("Fichier d'export non reconnu.");
    const overwrite = req.body?.overwrite === true;

    // 1. Ré-héberge les images embarquées, sous de NOUVEAUX noms (aucun risque
    //    d'écraser un fichier déjà là).
    const urlByAsset = {};
    let i = 0;
    for (const [name, b64] of Object.entries(p.assets || {})) {
      const ext = (name.split(".").pop() || "png").toLowerCase();
      const filename = `ar-${Date.now()}-${i++}-${Math.round(Math.random() * 1e6)}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(b64, "base64"));
      urlByAsset[name] = `${req.protocol}://${req.get("host")}/uploads/arcade/${filename}`;
    }
    const rehydrate = (s) =>
      typeof s === "string" && s.startsWith(ASSET_PREFIX)
        ? urlByAsset[s.slice(ASSET_PREFIX.length)] || s
        : s;

    const stats = {
      rewardsCreated: 0,
      rewardsUpdated: 0,
      rewardsSkipped: 0,
      casesCreated: 0,
      casesUpdated: 0,
      casesSkipped: 0,
    };

    // 2. Les lots, upsert par clé (c'est elle que les inventaires référencent :
    //    réimporter un lot existant ne dépossède donc personne).
    for (const r of p.rewards || []) {
      if (!r?.key || !REWARD_TYPE_KEYS.includes(r.type)) continue;
      const w = Number(r.weight);
      const fields = {
        type: r.type,
        name: String(r.name || "").trim() || r.key,
        description: String(r.description || "").slice(0, 200),
        rarity: isRarity(r.rarity) ? r.rarity : "common",
        weight: Number.isFinite(w) && w > 0 ? w : null,
        enabled: r.enabled !== false,
        data: mapStrings(r.data || {}, rehydrate),
      };
      const existing = await Reward.findOne({ key: r.key });
      if (!existing) {
        await Reward.create({ ...fields, key: r.key, createdBy: req.userId });
        stats.rewardsCreated++;
      } else if (overwrite) {
        await Reward.updateOne({ _id: existing._id }, fields);
        stats.rewardsUpdated++;
      } else stats.rewardsSkipped++;
    }

    // 3. Les caisses : leur pool est retrouvé par CLÉ dans la base d'arrivée.
    for (const c of p.cases || []) {
      if (!c?.key) continue;
      const keys = Array.isArray(c.rewardKeys) ? c.rewardKeys : [];
      const found = await Reward.find({ key: { $in: keys } }).select("_id key");
      const byKey = new Map(found.map((d) => [d.key, d._id]));
      const fields = {
        name: String(c.name || "").trim() || c.key,
        description: String(c.description || "").slice(0, 240),
        price: Math.max(0, Math.round(Number(c.price) || 0)),
        image: c.image ? rehydrate(c.image) : null,
        rewards: keys.map((k) => byKey.get(k)).filter(Boolean),
        enabled: c.enabled !== false,
        order: Number(c.order) || 0,
      };
      const existing = await LootCase.findOne({ key: c.key });
      if (!existing) {
        await LootCase.create({ ...fields, key: c.key });
        stats.casesCreated++;
      } else if (overwrite) {
        await LootCase.updateOne({ _id: existing._id }, fields);
        stats.casesUpdated++;
      } else stats.casesSkipped++;
    }

    res.json({ ok: true, ...stats });
  } catch (err) {
    console.error("arcade import error:", err.message);
    res.status(400).json({ error: err.message || "Import impossible." });
  }
});

export default router;
