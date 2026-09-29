import CardTrade from "../models/CardTrade.js";
import CardOwn from "../models/CardOwn.js";
import User from "../models/User.js";
import { getCatalog } from "./cards.js";
import { viewContext } from "./privacy.js";
import { notify } from "./notify.js";
import { recentlyForged } from "./cardShards.js";

// ======================================================================
//  Les échanges de cartes entre joueurs
// ======================================================================
// Je propose : « je te donne ces cartes, tu me donnes celles-là » (1 à 3 de
// chaque côté). L'autre accepte ou refuse ; tant que rien n'est accepté, les
// cartes restent où elles sont. À l'acceptation, tout est revérifié (on a pu
// ouvrir, échanger ou perdre une carte entre-temps) puis les cartes changent
// de classeur.
//
// Pas de transaction Mongo (la base locale n'est pas un replica set) : la
// requête qui passe l'échange de « pending » à « accepting » est la seule à
// le traiter, et un échec au milieu du transfert est défait à la main.

const MAX_SIDE = 3;
const MAX_PENDING = 10;

export class TradeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const who = (u) => (u ? { id: String(u._id), username: u.username, avatar: u.avatar || null } : null);
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Boolean))];

async function owns(userId, cards) {
  const rows = await CardOwn.find({ user: userId, card: { $in: cards }, count: { $gte: 1 } })
    .select("card")
    .lean();
  const have = new Set(rows.map((r) => r.card));
  return cards.every((c) => have.has(c));
}

function view(t, cat, users, me) {
  const card = (id) => cat.byId.get(id) || null;
  return {
    id: String(t._id),
    status: t.status,
    mine: String(t.from) === String(me),
    from: who(users.get(String(t.from))),
    to: who(users.get(String(t.to))),
    give: t.give.map(card).filter(Boolean),
    want: t.want.map(card).filter(Boolean),
    createdAt: t.createdAt,
    decidedAt: t.decidedAt,
    reply: !!t.reply,
    seen: String(t.from) === String(me) ? !!t.seenFrom : true,
  };
}

async function viewAll(list, me) {
  const cat = await getCatalog();
  const uids = [...new Set(list.flatMap((t) => [String(t.from), String(t.to)]))];
  const users = new Map(
    (await User.find({ _id: { $in: uids } }).select("username avatar").lean()).map((u) => [String(u._id), u])
  );
  return list.map((t) => view(t, cat, users, me));
}

/** Mes échanges : reçus, proposés, et les derniers conclus. */
export async function listTrades(userId) {
  const [open, recent] = await Promise.all([
    CardTrade.find({ $or: [{ from: userId }, { to: userId }], status: "pending" }).sort({ createdAt: -1 }).lean(),
    CardTrade.find({ $or: [{ from: userId }, { to: userId }], status: { $in: ["accepted", "declined", "failed"] } })
      .sort({ decidedAt: -1 })
      .limit(12)
      .lean(),
  ]);
  const all = await viewAll([...open, ...recent], userId);
  return {
    incoming: all.filter((t) => t.status === "pending" && !t.mine),
    outgoing: all.filter((t) => t.status === "pending" && t.mine),
    // Conclus pendant mon absence : l'animation m'attend.
    unseen: all.filter((t) => t.status === "accepted" && t.mine && !t.seen),
    recent: all.filter((t) => t.status !== "pending"),
  };
}

/** Proposer un échange à quelqu'un. */
export async function proposeTrade(userId, body = {}) {
  const cat = await getCatalog();
  const target = await User.findOne({ username: String(body.to || "") }).select("username privacy").lean();
  if (!target) throw new TradeError(404, "Joueur introuvable.");
  if (String(target._id) === String(userId)) throw new TradeError(400, "Pas d'échange avec soi-même.");
  const { locked } = await viewContext(target, userId);
  if (locked) throw new TradeError(403, "Ce classeur est privé.");

  const give = ids(body.give).filter((id) => cat.byId.has(id));
  const want = ids(body.want).filter((id) => cat.byId.has(id));
  if (!give.length || !want.length) throw new TradeError(400, "Choisis au moins une carte de chaque côté.");
  if (give.length > MAX_SIDE || want.length > MAX_SIDE)
    throw new TradeError(400, `${MAX_SIDE} cartes au plus de chaque côté.`);
  if (!(await owns(userId, give))) throw new TradeError(409, "Tu n'as plus une des cartes proposées.");
  if (!(await owns(target._id, want))) throw new TradeError(409, "Il n'a plus une des cartes demandées.");
  // Une carte forgée ne s'échange pas pendant 7 jours (lib/cardShards.js).
  if ((await recentlyForged(userId, give)).length)
    throw new TradeError(409, "Une carte forgée ne s'échange qu'au bout de 7 jours.");

  // Remplacer une proposition : celle qu'il m'a faite (contre-proposition), ou
  // la mienne (retouchée). Elle sort du jeu AVANT que la nouvelle n'entre —
  // une seule requête y arrive — et revient si la création échoue.
  let old = null;
  if (body.replaces) {
    old = await CardTrade.findOneAndUpdate(
      {
        _id: body.replaces,
        status: "pending",
        $or: [
          { from: target._id, to: userId },
          { from: userId, to: target._id },
        ],
      },
      { $set: { status: "declined", decidedAt: new Date() } },
      { new: false }
    )
      .lean()
      .catch(() => null);
    if (!old) throw new TradeError(409, "Cette proposition a changé entre-temps.");
    // Ma propre offre retouchée : elle est annulée, pas refusée.
    if (String(old.from) === String(userId))
      await CardTrade.updateOne({ _id: old._id }, { $set: { status: "cancelled" } });
  }
  const reply = !!old && String(old.from) === String(target._id);
  const pending = await CardTrade.countDocuments({ from: userId, status: "pending" });
  if (pending >= MAX_PENDING) {
    if (old) await CardTrade.updateOne({ _id: old._id }, { $set: { status: "pending", decidedAt: null } });
    throw new TradeError(400, `${MAX_PENDING} propositions en attente au plus.`);
  }

  let t;
  try {
    t = await CardTrade.create({ from: userId, to: target._id, give, want, replaces: old?._id || null, reply });
  } catch (e) {
    if (old) await CardTrade.updateOne({ _id: old._id }, { $set: { status: "pending", decidedAt: null } });
    throw e;
  }
  if (old) await CardTrade.updateOne({ _id: old._id }, { $set: { counter: t._id } });
  notify({
    user: target._id,
    type: "card_trade",
    actor: userId,
    gameName: cat.byId.get(want[0])?.name || "",
    snippet: give.map((id) => cat.byId.get(id)?.name).filter(Boolean).join(", "),
  });
  return (await viewAll([t.toObject()], userId))[0];
}

// Déplace une carte (une unité) d'un joueur à l'autre. Rend false si le
// donneur ne l'a plus.
async function takeOne(userId, card) {
  const r = await CardOwn.findOneAndUpdate(
    { user: userId, card, count: { $gte: 1 } },
    { $inc: { count: -1 } },
    { new: true }
  ).lean();
  if (!r) return false;
  if (r.count <= 0) await CardOwn.deleteOne({ _id: r._id, count: { $lte: 0 } });
  return true;
}
async function giveOne(userId, card) {
  const now = new Date();
  await CardOwn.updateOne(
    { user: userId, card },
    { $inc: { count: 1 }, $set: { lastAt: now, fresh: true }, $setOnInsert: { firstAt: now } },
    { upsert: true }
  );
}

/** Accepter : les cartes changent de classeur, et les deux voient l'échange. */
export async function acceptTrade(userId, id) {
  const t = await CardTrade.findOneAndUpdate(
    { _id: id, to: userId, status: "pending" },
    { $set: { status: "accepting" } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!t) throw new TradeError(409, "Cet échange n'est plus en attente.");

  const fail = async (msg) => {
    await CardTrade.updateOne({ _id: t._id }, { $set: { status: "failed", decidedAt: new Date() } });
    throw new TradeError(409, msg);
  };
  if (!(await owns(t.from, t.give))) await fail("Il n'a plus une des cartes qu'il proposait.");
  if (!(await owns(t.to, t.want))) await fail("Tu n'as plus une des cartes demandées.");
  if ((await recentlyForged(t.to, t.want)).length)
    await fail("Une carte forgée ne s'échange qu'au bout de 7 jours.");

  // Le transfert : on retire d'abord (ce qui peut échouer), on donne ensuite.
  const taken = [];
  const moves = [...t.give.map((c) => ({ from: t.from, to: t.to, c })), ...t.want.map((c) => ({ from: t.to, to: t.from, c }))];
  for (const m of moves) {
    if (await takeOne(m.from, m.c)) taken.push(m);
    else {
      for (const back of taken) await giveOne(back.from, back.c);
      await fail("Une des cartes n'est plus disponible.");
    }
  }
  for (const m of moves) await giveOne(m.to, m.c);

  const done = await CardTrade.findOneAndUpdate(
    { _id: t._id },
    { $set: { status: "accepted", decidedAt: new Date() } },
    { new: true }
  ).lean();
  const cat = await getCatalog();
  notify({
    user: t.from,
    type: "card_trade_done",
    actor: userId,
    gameName: cat.byId.get(t.want[0])?.name || "",
  });
  return (await viewAll([done], userId))[0];
}

export async function declineTrade(userId, id) {
  const t = await CardTrade.findOneAndUpdate(
    { _id: id, to: userId, status: "pending" },
    { $set: { status: "declined", decidedAt: new Date() } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!t) throw new TradeError(409, "Cet échange n'est plus en attente.");
  return (await viewAll([t], userId))[0];
}

// `restore` : c'est le « Annuler » du toast juste après une contre-proposition
// (ou une retouche) — la proposition remplacée revient telle quelle.
export async function cancelTrade(userId, id, { restore = false } = {}) {
  const t = await CardTrade.findOneAndUpdate(
    { _id: id, from: userId, status: "pending" },
    { $set: { status: "cancelled", decidedAt: new Date() } },
    { new: true }
  )
    .lean()
    .catch(() => null);
  if (!t) throw new TradeError(409, "Cet échange n'est plus en attente.");
  if (restore && t.replaces)
    await CardTrade.updateOne(
      { _id: t.replaces, counter: t._id, status: { $in: ["declined", "cancelled"] } },
      { $set: { status: "pending", decidedAt: null, counter: null } }
    );
  return { id: String(t._id), status: t.status };
}

/** Le proposeur a vu son échange se faire (l'animation est passée). */
export async function markTradeSeen(userId, id) {
  await CardTrade.updateOne({ _id: id, from: userId }, { $set: { seenFrom: true } }).catch(() => {});
  return { ok: true };
}
