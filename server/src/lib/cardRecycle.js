import CardOwn from "../models/CardOwn.js";
import CardTrade from "../models/CardTrade.js";
import CardRecycleLog from "../models/CardRecycleLog.js";
import { getCatalog, storeCards } from "./cards.js";
import { grantPoints, spendPoints, getBalance } from "./points.js";

// ======================================================================
//  Recycler des cartes contre des points, forger celle qu'on veut
// ======================================================================
// Une carte recyclée rapporte des POINTS D'ARCADE (les mêmes qui achètent les
// boosters). Avec des points, on peut aussi FORGER une carte précise qu'on
// n'a pas : le seul moyen de viser une carte, hors échange.
//
// Ce qui protège l'économie :
//   - recycler un booster entier rend ~110 points en moyenne pour 500 payés :
//     ouvrir pour recycler fait toujours PERDRE des points, jamais en gagner ;
//   - forger coûte bien plus que recycler ne rapporte (une rare = 2 boosters,
//     une épique 6, une légendaire 20) ; le mythique ne se forge pas ;
//   - les favoris ne se recyclent pas ;
//   - une carte engagée dans un échange en attente, ou reçue par échange il y
//     a moins de 7 jours, ne se recycle pas ; une carte forgée ne s'échange
//     pas pendant 7 jours (sinon des comptes secondaires ouvriraient des
//     boosters pour qu'un compte principal les change en points).
//
// Le set compte ~26 000 cartes : les doubles y sont RARES. On peut donc
// recycler n'importe quel exemplaire, le dernier compris — la carte quitte
// alors le classeur, et l'interface le dit.

export const RECYCLE = { common: 4, uncommon: 8, rare: 25, epic: 80, legendary: 300, mythic: 1200 };
export const FORGE = { common: 150, uncommon: 300, rare: 1000, epic: 3000, legendary: 10000, mythic: null };
const HOLD_MS = 7 * 24 * 3600 * 1000;
// L'« Annuler » du toast : au-delà, c'est définitif.
const UNDO_MS = 15 * 60 * 1000;
const MAX_ITEMS = 300;

export class RecycleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Les cartes qu'on ne peut pas recycler pour l'instant, et pourquoi :
 * « trade » (dans un échange en attente) ou « recent » (reçue par échange il y
 * a moins de 7 jours). Rend une Map id → { why, until? }.
 */
export async function recycleLocks(userId) {
  const since = new Date(Date.now() - HOLD_MS);
  const [open, got] = await Promise.all([
    CardTrade.find({ $or: [{ from: userId }, { to: userId }], status: { $in: ["pending", "accepting"] } })
      .select("from give want")
      .lean(),
    CardTrade.find({ $or: [{ from: userId }, { to: userId }], status: "accepted", decidedAt: { $gte: since } })
      .select("from give want decidedAt")
      .lean(),
  ]);
  const out = new Map();
  for (const t of got) {
    const mine = String(t.from) === String(userId);
    // Ce que j'ai REÇU : ce que je demandais (proposeur) ou ce qu'on me donnait.
    for (const id of mine ? t.want : t.give) {
      const until = new Date(new Date(t.decidedAt).getTime() + HOLD_MS);
      const prev = out.get(id);
      if (!prev || (prev.until && prev.until < until)) out.set(id, { why: "recent", until });
    }
  }
  for (const t of open) {
    const mine = String(t.from) === String(userId);
    for (const id of mine ? t.give : t.want) out.set(id, { why: "trade" });
  }
  return out;
}

/** Mon solde, les barèmes, et ce qui est verrouillé. */
export async function workshopHome(userId) {
  const [points, locks] = await Promise.all([getBalance(userId), recycleLocks(userId)]);
  return {
    points,
    recycle: RECYCLE,
    forge: FORGE,
    locks: Object.fromEntries([...locks].map(([id, l]) => [id, l])),
  };
}

// Rend n exemplaires d'une carte (annulation), à sa date d'arrivée d'origine.
async function restoreOne(userId, d) {
  await CardOwn.updateOne(
    { user: userId, card: d.card },
    {
      $inc: { count: d.n },
      $setOnInsert: { firstAt: d.firstAt || new Date(), lastAt: new Date(), fresh: false, fav: !!d.fav },
    },
    { upsert: true }
  );
}

/**
 * Recycler : `items` = [{ card, n }]. Tout ou rien : une seule carte refusée
 * (favori, verrouillée, plus assez d'exemplaires) et rien n'est recyclé.
 */
export async function recycleCards(userId, rawItems) {
  const cat = await getCatalog();
  const merged = new Map();
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const id = Number(it?.card);
    const n = Math.floor(Number(it?.n) || 0);
    if (!cat.byId.has(id) || n < 1) continue;
    merged.set(id, (merged.get(id) || 0) + n);
  }
  if (!merged.size) throw new RecycleError(400, "Choisis au moins une carte.");
  if (merged.size > MAX_ITEMS) throw new RecycleError(400, `${MAX_ITEMS} cartes au plus d'un coup.`);

  const ids = [...merged.keys()];
  const [rows, locks] = await Promise.all([
    CardOwn.find({ user: userId, card: { $in: ids } }).lean(),
    recycleLocks(userId),
  ]);
  const own = new Map(rows.map((r) => [r.card, r]));
  for (const [id, n] of merged) {
    const o = own.get(id);
    const name = cat.byId.get(id).name;
    if (!o || o.count < n) throw new RecycleError(409, `Tu n'as plus assez de « ${name} ».`);
    if (o.fav) throw new RecycleError(409, `« ${name} » est en favori : retire le cœur pour la recycler.`);
    const lock = locks.get(id);
    if (lock)
      throw new RecycleError(
        409,
        lock.why === "trade"
          ? `« ${name} » est dans un échange en cours.`
          : `« ${name} » vient d'un échange : recyclable dans quelques jours.`
      );
  }

  // Le retrait, carte par carte, sous condition (« s'il en reste assez ») ;
  // un échec au milieu est défait à la main (pas de transaction en local).
  const done = [];
  for (const [id, n] of merged) {
    const r = await CardOwn.findOneAndUpdate(
      { user: userId, card: id, count: { $gte: n }, fav: { $ne: true } },
      { $inc: { count: -n } },
      { new: true }
    ).lean();
    if (!r) {
      for (const d of done) await restoreOne(userId, d);
      throw new RecycleError(409, `Tu n'as plus assez de « ${cat.byId.get(id).name} ».`);
    }
    if (r.count <= 0) await CardOwn.deleteOne({ _id: r._id, count: { $lte: 0 } });
    done.push({ card: id, n, firstAt: own.get(id).firstAt || null, fav: false });
  }

  const gained = done.reduce((a, d) => a + RECYCLE[cat.byId.get(d.card).rarity] * d.n, 0);
  const count = done.reduce((a, d) => a + d.n, 0);
  const points = await grantPoints(userId, gained, "cardrecycle", { cards: count });
  const log = await CardRecycleLog.create({ user: userId, kind: "recycle", cards: done, points: gained });
  return {
    id: String(log._id),
    gained,
    points: points ?? (await getBalance(userId)),
    cards: done.map((d) => ({ id: d.card, left: Math.max(0, (own.get(d.card).count || 0) - d.n) })),
  };
}

/** Annuler un recyclage : les cartes reviennent, les points repartent. */
export async function undoRecycle(userId, logId) {
  const log = await CardRecycleLog.findOneAndUpdate(
    { _id: logId, user: userId, kind: "recycle", undone: false, createdAt: { $gte: new Date(Date.now() - UNDO_MS) } },
    { $set: { undone: true } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!log) throw new RecycleError(409, "Trop tard pour annuler.");
  // Les points ont déjà servi (un booster entre-temps) : on ne rend rien.
  let points;
  try {
    points = await spendPoints(userId, log.points, "cardrecycle", { undo: true });
  } catch {
    await CardRecycleLog.updateOne({ _id: log._id }, { $set: { undone: false } });
    throw new RecycleError(409, "Ces points ont déjà été dépensés.");
  }
  for (const d of log.cards) await restoreOne(userId, d);
  const rows = await CardOwn.find({ user: userId, card: { $in: log.cards.map((d) => d.card) } })
    .select("card count")
    .lean();
  return { points, cards: rows.map((r) => ({ id: r.card, count: r.count })) };
}

/** Forger une carte que je n'ai pas, avec des points. */
export async function forgeCard(userId, cardRaw) {
  const cat = await getCatalog();
  const id = Number(cardRaw);
  const card = cat.byId.get(id);
  if (!card) throw new RecycleError(404, "Carte introuvable.");
  const cost = FORGE[card.rarity];
  if (!cost) throw new RecycleError(403, "Les cartes mythiques ne se forgent pas.");
  if (await CardOwn.exists({ user: userId, card: id, count: { $gte: 1 } }))
    throw new RecycleError(409, "Tu as déjà cette carte.");
  let points;
  try {
    points = await spendPoints(userId, cost, "cardforge", { card: id });
  } catch {
    throw new RecycleError(402, `Il te faut ${cost.toLocaleString("fr-FR")} points.`);
  }
  try {
    await storeCards(userId, [id]);
    await CardOwn.updateOne({ user: userId, card: id }, { $set: { forgedAt: new Date() } });
  } catch (e) {
    await grantPoints(userId, cost, "cardforge", { card: id, refund: true });
    throw e;
  }
  const log = await CardRecycleLog.create({ user: userId, kind: "forge", cards: [{ card: id, n: 1 }], points: -cost });
  return { id: String(log._id), cost, points, card: { ...card, count: 1, fresh: true, firstAt: new Date() } };
}

/** Annuler une forge : la carte repart, les points reviennent. */
export async function undoForge(userId, logId) {
  const log = await CardRecycleLog.findOneAndUpdate(
    { _id: logId, user: userId, kind: "forge", undone: false, createdAt: { $gte: new Date(Date.now() - UNDO_MS) } },
    { $set: { undone: true } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!log) throw new RecycleError(409, "Trop tard pour annuler.");
  const id = log.cards[0].card;
  const r = await CardOwn.findOneAndUpdate(
    { user: userId, card: id, count: { $gte: 1 } },
    { $inc: { count: -1 } },
    { new: true }
  ).lean();
  if (!r) {
    await CardRecycleLog.updateOne({ _id: log._id }, { $set: { undone: false } });
    throw new RecycleError(409, "Cette carte n'est plus dans ton classeur.");
  }
  if (r.count <= 0) await CardOwn.deleteOne({ _id: r._id, count: { $lte: 0 } });
  const points = await grantPoints(userId, -log.points, "cardforge", { card: id, undo: true });
  return { points: points ?? (await getBalance(userId)), card: id, left: Math.max(0, r.count) };
}

/** Pour les échanges : les cartes forgées il y a moins de 7 jours. */
export async function recentlyForged(userId, cards) {
  const rows = await CardOwn.find({
    user: userId,
    card: { $in: cards },
    forgedAt: { $gte: new Date(Date.now() - HOLD_MS) },
  })
    .select("card")
    .lean();
  return rows.map((r) => r.card);
}
