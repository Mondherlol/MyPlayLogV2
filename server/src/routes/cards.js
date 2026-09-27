import express from "express";
import CardOwn from "../models/CardOwn.js";
import User from "../models/User.js";
import { recordActivity } from "../lib/activity.js";
import { blockIfPrivate } from "../lib/privacy.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeature } from "../lib/features.js";
import { grantPoints, spendPoints } from "../lib/points.js";
import {
  PACK_PRICE,
  PACK_SIZE,
  CURRENT_SET,
  GOLDEN_CHANCE,
  RARITY_ORDER,
  getCatalog,
  drawPack,
  packChances,
  storeCards,
} from "../lib/cards.js";

// ======================================================================
//  /api/cards — le classeur et les boosters
// ======================================================================
const router = express.Router();
router.use(requireAuth, requireFeature("cards"));

// De quoi habiller les sachets : une vingtaine de jaquettes de grosses cartes,
// tirées au hasard à chaque visite (la mosaïque du fond et l'éventail).
function packCovers(cat) {
  const pool = [
    ...(cat.byRarity.mythic || []),
    ...(cat.byRarity.legendary || []),
    ...(cat.byRarity.epic || []).slice(0, 60),
  ];
  const out = [];
  while (out.length < 24 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(cat.byId.get(pool.splice(i, 1)[0]).cover);
  }
  return out;
}

// GET /api/cards — mon classeur, mon solde, les chiffres du set.
router.get("/", requireAuth, async (req, res) => {
  try {
    const [cat, user, owned] = await Promise.all([
      getCatalog(),
      User.findById(req.userId).select("points").lean(),
      CardOwn.find({ user: req.userId }).lean(),
    ]);
    if (!user) return res.status(404).json({ error: "Compte introuvable." });

    const chances = packChances();
    const ownedBy = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0]));
    const cards = [];
    for (const o of owned) {
      const c = cat.byId.get(o.card);
      if (!c) continue;
      ownedBy[c.rarity]++;
      cards.push({ ...c, count: o.count, firstAt: o.firstAt, fresh: !!o.fresh });
    }

    res.json({
      points: user.points || 0,
      price: PACK_PRICE,
      packSize: PACK_SIZE,
      set: CURRENT_SET,
      setSize: cat.size,
      goldenChance: GOLDEN_CHANCE,
      rarities: RARITY_ORDER.map((r) => ({
        key: r,
        total: cat.byRarity[r].length,
        owned: ownedBy[r],
        chance: chances[r],
      })),
      packCovers: packCovers(cat),
      cards,
    });
  } catch (err) {
    console.error("cards get error:", err.message);
    res.status(500).json({ error: "Impossible de charger les cartes." });
  }
});

// POST /api/cards/open — débite, tire cinq cartes, les range.
router.post("/open", requireAuth, async (req, res) => {
  try {
    const cat = await getCatalog();
    if (cat.size < PACK_SIZE)
      return res.status(503).json({ error: "Le set se prépare, reviens dans un instant." });

    let balance;
    try {
      balance = await spendPoints(req.userId, PACK_PRICE, "cards", { set: CURRENT_SET });
    } catch (e) {
      if (e.code === "INSUFFICIENT_POINTS")
        return res.status(402).json({ error: "Pas assez de points." });
      throw e;
    }

    let ids, golden, counts;
    try {
      ({ ids, golden } = drawPack(cat));
      counts = await storeCards(req.userId, ids);
    } catch (e) {
      // Payé mais rien rangé : on rend les points.
      await grantPoints(req.userId, PACK_PRICE, "cards", { refund: true });
      throw e;
    }

    // Le fil des abonnés : « a ouvert un booster » (best-effort — les cartes
    // sont déjà rangées, une panne ici ne doit rien lui reprendre).
    recordActivity({
      actor: req.userId,
      type: "card_pack",
      meta: {
        cards: ids,
        news: ids.filter((id) => counts.get(id) === 1),
        golden,
      },
    });

    res.json({
      points: balance,
      golden,
      cards: ids.map((id) => ({
        ...cat.byId.get(id),
        count: counts.get(id),
        isNew: counts.get(id) === 1,
      })),
    });
  } catch (err) {
    console.error("cards open error:", err.message);
    res.status(500).json({ error: "Impossible d'ouvrir le booster." });
  }
});

// Ce qu'on montre d'un joueur à côté de ses cartes.
const who = (u) => ({ id: String(u._id), username: u.username, avatar: u.avatar || null });

// Le rang d'une carte pour élire « la plus belle » : la plus rare, puis la
// plus connue (petit numéro).
const beauty = (c) => RARITY_ORDER.indexOf(c.rarity) * 1e6 - c.no;

// GET /api/cards/friends — les classeurs des gens que je suis : combien de
// cartes, et leur plus belle, pour la rangée « Amis » de la page Cartes.
router.get("/friends", async (req, res) => {
  try {
    const me = await User.findById(req.userId).select("following").lean();
    const following = me?.following || [];
    if (!following.length) return res.json({ friends: [] });
    const [cat, rows, users] = await Promise.all([
      getCatalog(),
      CardOwn.find({ user: { $in: following } }).select("user card").lean(),
      User.find({ _id: { $in: following } }).select("username avatar").lean(),
    ]);
    const byUser = new Map();
    for (const r of rows) {
      const c = cat.byId.get(r.card);
      if (!c) continue;
      const k = String(r.user);
      const cur = byUser.get(k) || { owned: 0, best: null };
      cur.owned++;
      if (!cur.best || beauty(c) > beauty(cur.best)) cur.best = c;
      byUser.set(k, cur);
    }
    const friends = users
      .filter((u) => byUser.has(String(u._id)))
      .map((u) => ({ user: who(u), ...byUser.get(String(u._id)) }))
      .sort((a, b) => b.owned - a.owned);
    res.json({ friends, setSize: cat.size });
  } catch (err) {
    console.error("cards friends error:", err.message);
    res.status(500).json({ error: "Impossible de charger les classeurs des amis." });
  }
});

// GET /api/cards/u/:username — le classeur d'un joueur, en lecture seule.
// Mêmes règles que le profil : un compte privé ne s'ouvre qu'à ses abonnés.
router.get("/u/:username", async (req, res) => {
  try {
    const owner = await User.findOne({ username: req.params.username })
      .select("username avatar privacy")
      .lean();
    if (!owner) return res.status(404).json({ error: "Joueur introuvable." });
    if (await blockIfPrivate(res, owner, req.userId)) return;
    const [cat, owned] = await Promise.all([
      getCatalog(),
      CardOwn.find({ user: owner._id }).lean(),
    ]);
    const chances = packChances();
    const ownedBy = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0]));
    const cards = [];
    for (const o of owned) {
      const c = cat.byId.get(o.card);
      if (!c) continue;
      ownedBy[c.rarity]++;
      cards.push({ ...c, count: o.count, firstAt: o.firstAt });
    }
    res.json({
      user: who(owner),
      setSize: cat.size,
      rarities: RARITY_ORDER.map((r) => ({
        key: r,
        total: cat.byRarity[r].length,
        owned: ownedBy[r],
        chance: chances[r],
      })),
      cards,
    });
  } catch (err) {
    console.error("cards user error:", err.message);
    res.status(500).json({ error: "Impossible de charger ce classeur." });
  }
});

// POST /api/cards/seen — le classeur a été regardé : plus de pastille « NEW ».
router.post("/seen", requireAuth, async (req, res) => {
  try {
    await CardOwn.updateMany({ user: req.userId, fresh: true }, { $set: { fresh: false } });
    res.json({ ok: true });
  } catch (err) {
    console.error("cards seen error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
