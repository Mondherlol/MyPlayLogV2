import CardOwn from "../models/CardOwn.js";
import CardTrade from "../models/CardTrade.js";
import CardShardLog from "../models/CardShardLog.js";
import User from "../models/User.js";
import { getCatalog, storeCards } from "./cards.js";

// ======================================================================
//  Recycler des cartes, forger celle qu'on veut
// ======================================================================
// Une carte recyclée devient des ÉCLATS ; avec assez d'Éclats, on FORGE une
// carte précise qu'on n'a pas. C'est le seul moyen de viser une carte : le
// reste du temps, on dépend du hasard des boosters ou d'un échange.
//
// Ce qui protège l'économie :
//   - les Éclats sont une monnaie à part, qui ne redevient jamais des points ;
//   - recycler rapporte ~20 fois moins que forger ne coûte (un booster
//     recyclé en entier rapporte ~90 Éclats en moyenne : une rare forgée
//     vaut ~4 boosters, une épique ~15, une légendaire ~50) ;
//   - le mythique ne se forge pas : il reste la vraie chance du booster ;
//   - les favoris ne se recyclent pas ;
//   - une carte engagée dans un échange en attente, ou reçue par échange il y
//     a moins de 7 jours, ne se recycle pas ; une carte forgée ne s'échange
//     pas pendant 7 jours (sinon des comptes secondaires ouvriraient des
//     boosters pour le compte principal, qui les recyclerait).
//
// Le set compte ~26 000 cartes : les doubles y sont RARES (140 cartes tirées
// → 2 doubles). Recycler seulement les doubles ne rapportait presque rien,
// d'où le droit de recycler aussi un dernier exemplaire — la carte quitte
// alors le classeur, et l'interface le dit.

export const RECYCLE = { common: 2, uncommon: 5, rare: 20, epic: 80, legendary: 300, mythic: 1000 };
export const FORGE = { common: 40, uncommon: 100, rare: 400, epic: 1400, legendary: 4500, mythic: null };
const HOLD_MS = 7 * 24 * 3600 * 1000;
// L'« Annuler » du toast : au-delà, c'est définitif.
const UNDO_MS = 15 * 60 * 1000;
const MAX_ITEMS = 300;

export class ShardError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function balance(userId) {
  const u = await User.findById(userId).select("shards").lean();
  return u?.shards || 0;
}

/**
 * Les cartes qu'on ne peut pas recycler pour l'instant, et pourquoi :
 * « trade » (dans un échange en attente) ou « recent » (reçue par échange il
 * y a moins de 7 jours). Rend une Map id → { why, until? }.
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
export async function shardsHome(userId) {
  const [shards, locks] = await Promise.all([balance(userId), recycleLocks(userId)]);
  return {
    shards,
    recycle: RECYCLE,
    forge: FORGE,
    locks: Object.fromEntries([...locks].map(([id, l]) => [id, l])),
  };
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
  if (!merged.size) throw new ShardError(400, "Choisis au moins une carte.");
  if (merged.size > MAX_ITEMS) throw new ShardError(400, `${MAX_ITEMS} cartes au plus d'un coup.`);

  const ids = [...merged.keys()];
  const [rows, locks] = await Promise.all([
    CardOwn.find({ user: userId, card: { $in: ids } }).lean(),
    recycleLocks(userId),
  ]);
  const own = new Map(rows.map((r) => [r.card, r]));
  for (const [id, n] of merged) {
    const o = own.get(id);
    const name = cat.byId.get(id).name;
    if (!o || o.count < n) throw new ShardError(409, `Tu n'as plus assez de « ${name} ».`);
    if (o.fav) throw new ShardError(409, `« ${name} » est en favori : retire le cœur pour la recycler.`);
    const lock = locks.get(id);
    if (lock) throw new ShardError(409, lock.why === "trade" ? `« ${name} » est dans un échange en cours.` : `« ${name} » vient d'un échange : recyclable dans quelques jours.`);
  }

  // Le retrait, carte par carte, sous condition (« s'il en reste assez ») ;
  // un échec au milieu est défait à la main (pas de transaction en local).
  const done = [];
  const undoTaken = async () => {
    for (const d of done) await restoreOne(userId, d);
  };
  for (const [id, n] of merged) {
    const r = await CardOwn.findOneAndUpdate(
      { user: userId, card: id, count: { $gte: n }, fav: { $ne: true } },
      { $inc: { count: -n } },
      { new: true }
    ).lean();
    if (!r) {
      await undoTaken();
      throw new ShardError(409, `Tu n'as plus assez de « ${cat.byId.get(id).name} ».`);
    }
    if (r.count <= 0) await CardOwn.deleteOne({ _id: r._id, count: { $lte: 0 } });
    done.push({ card: id, n, firstAt: own.get(id).firstAt || null, fav: false });
  }

  const gained = done.reduce((a, d) => a + RECYCLE[cat.byId.get(d.card).rarity] * d.n, 0);
  const u = await User.findByIdAndUpdate(userId, { $inc: { shards: gained } }, { new: true }).select("shards").lean();
  const log = await CardShardLog.create({ user: userId, kind: "recycle", cards: done, shards: gained });
  return {
    id: String(log._id),
    gained,
    shards: u?.shards || 0,
    cards: done.map((d) => ({ id: d.card, left: Math.max(0, (own.get(d.card).count || 0) - d.n) })),
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

/** Annuler un recyclage : les cartes reviennent, les Éclats repartent. */
export async function undoRecycle(userId, logId) {
  const log = await CardShardLog.findOneAndUpdate(
    { _id: logId, user: userId, kind: "recycle", undone: false, createdAt: { $gte: new Date(Date.now() - UNDO_MS) } },
    { $set: { undone: true } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!log) throw new ShardError(409, "Trop tard pour annuler.");
  // Les Éclats ont déjà servi (une forge entre-temps) : on ne rend rien.
  const u = await User.findOneAndUpdate(
    { _id: userId, shards: { $gte: log.shards } },
    { $inc: { shards: -log.shards } },
    { new: true }
  )
    .select("shards")
    .lean();
  if (!u) {
    await CardShardLog.updateOne({ _id: log._id }, { $set: { undone: false } });
    throw new ShardError(409, "Ces Éclats ont déjà servi.");
  }
  for (const d of log.cards) await restoreOne(userId, d);
  const rows = await CardOwn.find({ user: userId, card: { $in: log.cards.map((d) => d.card) } })
    .select("card count")
    .lean();
  return { shards: u.shards, cards: rows.map((r) => ({ id: r.card, count: r.count })) };
}

/** Forger une carte que je n'ai pas. */
export async function forgeCard(userId, cardRaw) {
  const cat = await getCatalog();
  const id = Number(cardRaw);
  const card = cat.byId.get(id);
  if (!card) throw new ShardError(404, "Carte introuvable.");
  const cost = FORGE[card.rarity];
  if (!cost) throw new ShardError(403, "Les cartes mythiques ne se forgent pas.");
  if (await CardOwn.exists({ user: userId, card: id, count: { $gte: 1 } }))
    throw new ShardError(409, "Tu as déjà cette carte.");
  const u = await User.findOneAndUpdate({ _id: userId, shards: { $gte: cost } }, { $inc: { shards: -cost } }, { new: true })
    .select("shards")
    .lean();
  if (!u) throw new ShardError(402, `Il te faut ${cost.toLocaleString("fr-FR")} Éclats.`);
  try {
    await storeCards(userId, [id]);
    await CardOwn.updateOne({ user: userId, card: id }, { $set: { forgedAt: new Date() } });
  } catch (e) {
    await User.updateOne({ _id: userId }, { $inc: { shards: cost } });
    throw e;
  }
  const log = await CardShardLog.create({ user: userId, kind: "forge", cards: [{ card: id, n: 1 }], shards: -cost });
  return { id: String(log._id), cost, shards: u.shards, card: { ...card, count: 1, fresh: true, firstAt: new Date() } };
}

/** Annuler une forge : la carte repart, les Éclats reviennent. */
export async function undoForge(userId, logId) {
  const log = await CardShardLog.findOneAndUpdate(
    { _id: logId, user: userId, kind: "forge", undone: false, createdAt: { $gte: new Date(Date.now() - UNDO_MS) } },
    { $set: { undone: true } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!log) throw new ShardError(409, "Trop tard pour annuler.");
  const id = log.cards[0].card;
  const r = await CardOwn.findOneAndUpdate(
    { user: userId, card: id, count: { $gte: 1 } },
    { $inc: { count: -1 } },
    { new: true }
  ).lean();
  if (!r) {
    await CardShardLog.updateOne({ _id: log._id }, { $set: { undone: false } });
    throw new ShardError(409, "Cette carte n'est plus dans ton classeur.");
  }
  if (r.count <= 0) await CardOwn.deleteOne({ _id: r._id, count: { $lte: 0 } });
  const u = await User.findByIdAndUpdate(userId, { $inc: { shards: -log.shards } }, { new: true }).select("shards").lean();
  return { shards: u?.shards || 0, card: id, left: Math.max(0, r.count) };
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
