import express from "express";
import CardOwn from "../models/CardOwn.js";
import User from "../models/User.js";
import { recordActivity } from "../lib/activity.js";
import { blockIfPrivate } from "../lib/privacy.js";
import { requireAuth } from "../middleware/auth.js";
import { grantPoints, spendPoints } from "../lib/points.js";
import {
  PACK_PRICE,
  PACK_SIZE,
  CURRENT_SET,
  GOLDEN_CHANCE,
  RARITY_ORDER,
  getCatalog,
  drawPack,
  EDITION_KEYS,
  packChances,
  storeCards,
} from "../lib/cards.js";
import {
  BattleError,
  battleHome,
  startBattle,
  playRound,
  rescueRound,
  quitBattle,
  claimPassTier,
  TO_WIN,
} from "../lib/cardBattle.js";
import {
  createDuel,
  getDuel,
  joinDuel,
  readyDuel,
  pickDuel,
  rescueDuel,
  quitDuel,
  rematchDuel,
  liveDuelOf,
  duelCard,
  duelStats,
  duelFriends,
  challengeDuel,
  declineDuel,
} from "../lib/cardDuel.js";
import {
  createTeam,
  getTeam,
  sitTeam,
  inviteTeam,
  startTeam,
  readyTeam,
  pickTeam,
  quitTeam,
  rematchTeam,
  liveTeamOf,
  teamStats,
} from "../lib/cardTeam.js";
import CardBattleStat from "../models/CardBattleStat.js";
import { deliverCard, deliverCardToConversation } from "./chat.js";
import {
  BinderError,
  listBinders,
  getBinder,
  createBinder,
  updateBinder,
  deleteBinder,
  setFav,
  searchSeries,
  searchCards,
} from "../lib/cardBinders.js";
import {
  TradeError,
  listTrades,
  proposeTrade,
  acceptTrade,
  declineTrade,
  cancelTrade,
  markTradeSeen,
} from "../lib/cardTrades.js";

// ======================================================================
//  /api/cards — le classeur et les boosters
// ======================================================================
const router = express.Router();
// Ouvert à tous, tout le temps (plus de drapeau « cards » depuis le 2026-09-28).
router.use(requireAuth);

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
      cards.push({ ...c, count: o.count, firstAt: o.firstAt, fresh: !!o.fresh, fav: !!o.fav });
    }
    const binders = await listBinders(req.userId, new Map(owned.map((o) => [o.card, o])));

    res.json({
      points: user.points || 0,
      binders,
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

    // L'édition choisie ; sans choix valable, une au hasard.
    const edition = EDITION_KEYS.includes(req.body?.edition)
      ? req.body.edition
      : EDITION_KEYS[Math.floor(Math.random() * EDITION_KEYS.length)];

    let balance;
    try {
      balance = await spendPoints(req.userId, PACK_PRICE, "cards", { set: CURRENT_SET, edition });
    } catch (e) {
      if (e.code === "INSUFFICIENT_POINTS")
        return res.status(402).json({ error: "Pas assez de points." });
      throw e;
    }

    let ids, golden, counts;
    try {
      ({ ids, golden } = drawPack(cat, edition));
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
        edition,
      },
    });

    res.json({
      points: balance,
      golden,
      edition,
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

// ----------------------------------------------------------------------
//  Favoris et classeurs perso (lib/cardBinders.js)
// ----------------------------------------------------------------------
const binder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof BinderError) return res.status(err.status).json({ error: err.message });
    console.error("cards binder error:", err.message);
    res.status(500).json({ error: "Impossible de modifier le classeur." });
  }
};

// POST /api/cards/fav { card, on } — le cœur.
router.post("/fav", binder((req) => setFav(req.userId, req.body?.card, req.body?.on)));
// GET /api/cards/find?q= — une carte du set, qu'on l'ait ou non.
router.get("/find", binder((req) => searchCards(req.userId, req.query.q)));
// GET /api/cards/series?q= — les séries qui ont des cartes (Ace Attorney…).
router.get("/series", binder((req) => searchSeries(req.userId, req.query.q)));
// Les classeurs.
router.get("/binders", binder(async (req) => ({ binders: await listBinders(req.userId) })));
router.post("/binders", binder((req) => createBinder(req.userId, req.body)));
router.get("/binders/:id", binder((req) => getBinder(req.userId, req.params.id)));
router.patch("/binders/:id", binder((req) => updateBinder(req.userId, req.params.id, req.body)));
router.delete("/binders/:id", binder((req) => deleteBinder(req.userId, req.params.id)));

// GET /api/cards/lite — ce que j'ai (id → nombre) et ce que je cherche (les
// cartes de mes classeurs que je n'ai pas) : pour repérer, chez un ami, les
// cartes qui m'intéressent.
router.get(
  "/lite",
  binder(async (req) => {
    const owned = await CardOwn.find({ user: req.userId }).select("card count").lean();
    const have = new Map(owned.map((o) => [o.card, o.count]));
    const binders = await listBinders(req.userId, new Map(owned.map((o) => [o.card, o])));
    const wants = [...new Set(binders.flatMap((b) => b.cards))].filter((id) => !have.has(id));
    return { owned: [...have], wants };
  })
);

// ----------------------------------------------------------------------
//  Les échanges entre joueurs (lib/cardTrades.js)
// ----------------------------------------------------------------------
const trade = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof TradeError) return res.status(err.status).json({ error: err.message });
    console.error("cards trade error:", err.message);
    res.status(500).json({ error: "L'échange a échoué." });
  }
};
router.get("/trades", trade((req) => listTrades(req.userId)));
router.post("/trades", trade((req) => proposeTrade(req.userId, req.body)));
router.post("/trades/:id/accept", trade((req) => acceptTrade(req.userId, req.params.id)));
router.post("/trades/:id/decline", trade((req) => declineTrade(req.userId, req.params.id)));
router.post(
  "/trades/:id/cancel",
  trade((req) => cancelTrade(req.userId, req.params.id, { restore: !!req.body?.restore }))
);
router.post("/trades/:id/seen", trade((req) => markTradeSeen(req.userId, req.params.id)));

// ----------------------------------------------------------------------
//  Les combats contre le bot (tout se décide dans lib/cardBattle.js)
// ----------------------------------------------------------------------
const battle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof BattleError) return res.status(err.status).json({ error: err.message });
    console.error("cards battle error:", err.message);
    res.status(500).json({ error: "Le combat a planté, réessaie." });
  }
};

// GET /api/cards/battle — mon palmarès, ma passe, et ma partie en cours
// (+ de quoi habiller les boosters de la passe).
router.get(
  "/battle",
  battle(async (req) => ({
    ...(await battleHome(req.userId)),
    duel: await liveDuelOf(req.userId),
    duels: duelStats(await CardBattleStat.findOne({ user: req.userId }).select("pvpWins pvpLosses pvpDraws").lean()),
    team: await liveTeamOf(req.userId),
    teams: teamStats(await CardBattleStat.findOne({ user: req.userId }).select("teamWins teamLosses teamDraws").lean()),
    packCovers: packCovers(await getCatalog()),
  }))
);
// POST /api/cards/battle/pass/claim { tier } — le booster d'un palier.
router.post("/battle/pass/claim", battle((req) => claimPassTier(req.userId, req.body?.tier)));
// POST /api/cards/battle — nouvelle partie.
router.post("/battle", battle((req) => startBattle(req.userId)));
// POST /api/cards/battle/:id/play { card } — je pose une carte.
router.post("/battle/:id/play", battle((req) => playRound(req.userId, req.params.id, req.body?.card)));
// POST /api/cards/battle/:id/rescue { card | null } — le sauvetage.
router.post("/battle/:id/rescue", battle((req) => rescueRound(req.userId, req.params.id, req.body?.card)));
// POST /api/cards/battle/:id/quit — j'abandonne.
router.post("/battle/:id/quit", battle((req) => quitBattle(req.userId, req.params.id)));

// ----------------------------------------------------------------------
//  Les duels entre joueurs, en temps réel (lib/cardDuel.js)
// ----------------------------------------------------------------------
// La carte « viens m'affronter » dans la messagerie — pour un pote hors ligne
// (en ligne, la fenêtre de défi suffit : pas de doublon).
async function inviteCard(fromId, room, toId) {
  await deliverCard({
    fromId,
    toId,
    text: "",
    versus: { kind: "cards", code: room.code, hostName: room.host?.username || "", players: 1, maxPlayers: 2, rounds: TO_WIN },
  });
}

// GET /api/cards/duel/friends — les potes à défier (en ligne, prêts, occupés).
router.get("/duel/friends", battle((req) => duelFriends(req.userId)));
// POST /api/cards/duel { invite? } — j'ouvre un salon (et je défie un pote).
router.post(
  "/duel",
  battle(async (req) => {
    const out = await createDuel(req.userId);
    if (!req.body?.invite) return out;
    const c = await challengeDuel(req.userId, out.room.code, req.body.invite);
    if (!c.online) await inviteCard(req.userId, c.room, req.body.invite).catch(() => {});
    return { room: c.room, target: c.target, online: c.online };
  })
);
// GET /api/cards/duel/:code — le salon (et ma partie si j'en suis).
router.get("/duel/:code", battle((req) => getDuel(req.userId, req.params.code)));
// GET /api/cards/duel/:code/card — pour la carte d'invitation de la messagerie.
router.get("/duel/:code/card", async (req, res) => {
  try {
    res.json(await duelCard(req.userId, req.params.code));
  } catch {
    res.json({ state: "gone" });
  }
});
// POST /api/cards/duel/:code/join — je rejoins : la partie commence.
router.post("/duel/:code/join", battle((req) => joinDuel(req.userId, req.params.code)));
// POST /api/cards/duel/:code/ready { n } — mes animations sont finies.
router.post("/duel/:code/ready", battle((req) => readyDuel(req.userId, req.params.code, req.body?.n)));
// POST /api/cards/duel/:code/pick { n, card } — je pose ma carte.
router.post(
  "/duel/:code/pick",
  battle((req) => pickDuel(req.userId, req.params.code, req.body?.n, req.body?.card))
);
// POST /api/cards/duel/:code/rescue { card | null } — le sauvetage.
router.post("/duel/:code/rescue", battle((req) => rescueDuel(req.userId, req.params.code, req.body?.card)));
// POST /api/cards/duel/:code/quit — fermer le salon, ou abandonner.
router.post("/duel/:code/quit", battle((req) => quitDuel(req.userId, req.params.code)));
// POST /api/cards/duel/:code/challenge { user } — défier un pote depuis le salon.
router.post(
  "/duel/:code/challenge",
  battle(async (req) => {
    const c = await challengeDuel(req.userId, req.params.code, req.body?.user);
    if (!c.online) await inviteCard(req.userId, c.room, req.body.user).catch(() => {});
    return c;
  })
);
// POST /api/cards/duel/:code/decline — je refuse le défi.
router.post("/duel/:code/decline", battle((req) => declineDuel(req.userId, req.params.code)));
// POST /api/cards/duel/:code/rematch — la revanche.
router.post("/duel/:code/rematch", battle((req) => rematchDuel(req.userId, req.params.code)));

// ----------------------------------------------------------------------
//  Le 2 contre 2, en temps réel (lib/cardTeam.js)
// ----------------------------------------------------------------------
// POST /api/cards/team — j'ouvre une table (et je m'y assois).
router.post("/team", battle((req) => createTeam(req.userId)));
// GET /api/cards/team/:code — la table (et ma partie si j'en suis).
router.get("/team/:code", battle((req) => getTeam(req.userId, req.params.code)));
// POST /api/cards/team/:code/sit { seat } — je m'assois (ou je change de place).
router.post("/team/:code/sit", battle((req) => sitTeam(req.userId, req.params.code, req.body?.seat)));
// POST /api/cards/team/:code/invite { user, seat } — j'invite un pote.
router.post(
  "/team/:code/invite",
  battle((req) => inviteTeam(req.userId, req.params.code, req.body?.user, req.body?.seat))
);
// POST /api/cards/team/:code/start — l'hôte lance (des bots aux places vides).
router.post("/team/:code/start", battle((req) => startTeam(req.userId, req.params.code)));
// POST /api/cards/team/:code/ready { n } — mes animations sont finies.
router.post("/team/:code/ready", battle((req) => readyTeam(req.userId, req.params.code, req.body?.n)));
// POST /api/cards/team/:code/pick { n, card, lane } — je pose ma carte sur une voie.
router.post(
  "/team/:code/pick",
  battle((req) => pickTeam(req.userId, req.params.code, req.body?.n, req.body?.card, req.body?.lane))
);
// POST /api/cards/team/:code/quit — me lever, fermer la table, ou abandonner.
router.post("/team/:code/quit", battle((req) => quitTeam(req.userId, req.params.code)));
// POST /api/cards/team/:code/rematch — la revanche.
router.post("/team/:code/rematch", battle((req) => rematchTeam(req.userId, req.params.code)));

// POST /api/cards/duel/:code/invite { userIds, conversationIds } — la carte
// « viens m'affronter » dans la messagerie, comme les autres versus.
router.post("/duel/:code/invite", async (req, res) => {
  try {
    const { room } = await getDuel(req.userId, req.params.code);
    if (!room.member) return res.status(403).json({ error: "Ce n'est pas ton duel." });
    if (room.status !== "lobby") return res.status(409).json({ error: "Le duel a déjà commencé." });
    const userIds = [...new Set((req.body?.userIds || []).map(String))].slice(0, 10);
    const conversationIds = [...new Set((req.body?.conversationIds || []).map(String))].slice(0, 10);
    if (!userIds.length && !conversationIds.length) return res.status(400).json({ error: "Personne à inviter." });

    const targets = await User.find({ _id: { $in: userIds } }).select("username following").lean();
    const card = {
      kind: "cards",
      code: room.code,
      hostName: room.host?.username || "",
      players: 1,
      maxPlayers: 2,
      rounds: TO_WIN,
    };
    const text = String(req.body?.text || "").slice(0, 300);
    const sent = [];
    const skipped = [];
    for (const target of targets) {
      // La règle de la messagerie : on n'écrit qu'à ses abonnés.
      const allowed = (target.following || []).some((id) => String(id) === String(req.userId));
      if (!allowed) {
        skipped.push({ id: String(target._id), username: target.username });
        continue;
      }
      await deliverCard({ fromId: req.userId, toId: target._id, text, versus: card });
      sent.push({ id: String(target._id), username: target.username });
    }
    const groups = [];
    for (const cid of conversationIds) {
      const ok = await deliverCardToConversation({ fromId: req.userId, conversationId: cid, text, versus: card });
      if (ok) groups.push(cid);
    }
    res.json({ sent, skipped, groups });
  } catch (err) {
    if (err instanceof BattleError) return res.status(err.status).json({ error: err.message });
    console.error("cards duel invite error:", err.message);
    res.status(500).json({ error: "Invitation non envoyée." });
  }
});

export default router;
