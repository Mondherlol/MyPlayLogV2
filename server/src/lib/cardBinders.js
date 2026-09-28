import CardBinder from "../models/CardBinder.js";
import CardOwn from "../models/CardOwn.js";
import IgdbTerm from "../models/IgdbTerm.js";
import { getCatalog } from "./cards.js";

// ======================================================================
//  Les classeurs perso et les favoris
// ======================================================================
// Un favori : un cœur posé sur une carte qu'on possède (CardOwn.fav).
// Un classeur : une liste de cartes à réunir, remplie à la main ou d'un coup
// depuis une série (« Ace Attorney » → les 14 jeux de la série qui ont une
// carte). Les cartes qu'on n'a pas encore y figurent aussi : c'est un
// objectif de collection.

export const BINDER_COLORS = ["gold", "pink", "violet", "blue", "teal", "green", "orange", "grey"];
const MAX_BINDERS = 40;
const MAX_CARDS = 400;

export class BinderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function ownedMap(userId) {
  const rows = await CardOwn.find({ user: userId }).select("card count fav").lean();
  return new Map(rows.map((r) => [r.card, r]));
}

// Une série : ses cartes, de la plus ancienne à la plus récente.
function seriesCards(cat, key) {
  const ids = cat.series?.get(key) || [];
  return [...ids].sort(
    (a, b) => (cat.facts.get(a)?.year || 9999) - (cat.facts.get(b)?.year || 9999) || a - b
  );
}

function summary(b, owned, cat) {
  const cards = (b.cards || []).filter((id) => cat.byId.has(id));
  const mine = cards.filter((id) => owned.has(id));
  // La vignette : trois jaquettes, celles qu'on a d'abord.
  const pick = [...mine, ...cards.filter((id) => !owned.has(id))].slice(0, 3);
  return {
    id: String(b._id),
    name: b.name,
    color: b.color || "gold",
    total: cards.length,
    owned: mine.length,
    covers: pick.map((id) => cat.byId.get(id).cover),
    source: b.source?.key ? b.source : null,
    // Les ids : de quoi savoir, depuis une carte, dans quels classeurs elle est.
    cards,
  };
}

/** Les classeurs d'un joueur, en résumé (pour la rangée du classeur). */
export async function listBinders(userId, owned = null) {
  const [cat, rows, own] = await Promise.all([
    getCatalog(),
    CardBinder.find({ user: userId }).sort({ createdAt: 1 }).lean(),
    owned ? Promise.resolve(owned) : ownedMap(userId),
  ]);
  return rows.map((b) => summary(b, own, cat));
}

/** Un classeur en entier : ses cartes, possédées ou à trouver. */
export async function getBinder(userId, id) {
  const [cat, b, own] = await Promise.all([
    getCatalog(),
    CardBinder.findOne({ _id: id, user: userId }).lean().catch(() => null),
    ownedMap(userId),
  ]);
  if (!b) throw new BinderError(404, "Classeur introuvable.");
  return {
    binder: summary(b, own, cat),
    cards: (b.cards || [])
      .filter((id) => cat.byId.has(id))
      .map((cid) => {
        const o = own.get(cid);
        return { ...cat.byId.get(cid), owned: !!o, count: o?.count || 0, fav: !!o?.fav };
      }),
  };
}

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!n) throw new BinderError(400, "Donne un nom au classeur.");
  return n;
}

/** Nouveau classeur : vide, rempli d'une série, ou d'une liste de cartes. */
export async function createBinder(userId, body = {}) {
  const cat = await getCatalog();
  if ((await CardBinder.countDocuments({ user: userId })) >= MAX_BINDERS)
    throw new BinderError(400, `${MAX_BINDERS} classeurs au plus.`);
  let cards = [];
  let source = null;
  if (body.series) {
    cards = seriesCards(cat, String(body.series));
    if (!cards.length) throw new BinderError(400, "Cette série n'a aucune carte.");
    source = { key: String(body.series), name: String(body.seriesName || "").slice(0, 60) };
  }
  if (Array.isArray(body.cards))
    for (const id of body.cards.map(Number)) if (cat.byId.has(id) && !cards.includes(id)) cards.push(id);
  const doc = await CardBinder.create({
    user: userId,
    name: cleanName(body.name || source?.name),
    color: BINDER_COLORS.includes(body.color) ? body.color : "gold",
    cards: cards.slice(0, MAX_CARDS),
    source,
  });
  return summary(doc.toObject(), await ownedMap(userId), cat);
}

/** Renommer, recolorer, ajouter ou retirer des cartes. */
export async function updateBinder(userId, id, body = {}) {
  const cat = await getCatalog();
  const b = await CardBinder.findOne({ _id: id, user: userId }).catch(() => null);
  if (!b) throw new BinderError(404, "Classeur introuvable.");
  if (body.name != null) b.name = cleanName(body.name);
  if (body.color && BINDER_COLORS.includes(body.color)) b.color = body.color;
  if (Array.isArray(body.remove)) {
    const out = new Set(body.remove.map(Number));
    b.cards = b.cards.filter((c) => !out.has(c));
  }
  if (Array.isArray(body.add)) {
    for (const cid of body.add.map(Number))
      if (cat.byId.has(cid) && !b.cards.includes(cid) && b.cards.length < MAX_CARDS) b.cards.push(cid);
  }
  await b.save();
  return summary(b.toObject(), await ownedMap(userId), cat);
}

export async function deleteBinder(userId, id) {
  const b = await CardBinder.findOneAndDelete({ _id: id, user: userId }).lean().catch(() => null);
  if (!b) throw new BinderError(404, "Classeur introuvable.");
  // De quoi le recréer à l'identique (le « Annuler » du toast).
  return { name: b.name, color: b.color, cards: b.cards, source: b.source || null };
}

/** Le cœur sur une carte qu'on possède. */
export async function setFav(userId, card, on) {
  const r = await CardOwn.updateOne({ user: userId, card: Number(card) }, { $set: { fav: !!on } });
  if (!r.matchedCount) throw new BinderError(404, "Tu n'as pas cette carte.");
  return { card: Number(card), fav: !!on };
}

/**
 * Les séries (franchises et collections IGDB) qui ont des cartes, par nom.
 * Une franchise et une collection du même nom : on garde la plus fournie.
 */
export async function searchSeries(userId, q) {
  const needle = String(q || "").trim();
  if (needle.length < 2) return { series: [] };
  const [cat, terms, own] = await Promise.all([
    getCatalog(),
    IgdbTerm.find({ kind: { $in: ["franchise", "collection"] }, name: new RegExp(escapeRe(needle), "i") })
      .select("kind id name")
      .limit(80)
      .lean(),
    ownedMap(userId),
  ]);
  const byName = new Map();
  for (const t of terms) {
    const key = `${t.kind === "franchise" ? "f" : "c"}:${t.id}`;
    const ids = cat.series?.get(key) || [];
    if (!ids.length) continue;
    const row = {
      key,
      name: t.name,
      total: ids.length,
      owned: ids.filter((id) => own.has(id)).length,
      covers: seriesCards(cat, key)
        .slice(0, 3)
        .map((id) => cat.byId.get(id).cover),
    };
    const k = t.name.toLowerCase();
    if (!byName.has(k) || byName.get(k).total < row.total) byName.set(k, row);
  }
  const low = needle.toLowerCase();
  const series = [...byName.values()]
    .sort((a, b) => (b.name.toLowerCase().startsWith(low) ? 1 : 0) - (a.name.toLowerCase().startsWith(low) ? 1 : 0) || b.total - a.total)
    .slice(0, 12);
  return { series };
}

/** Chercher une carte dans TOUT le set (pour l'ajouter à un classeur). */
export async function searchCards(userId, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (needle.length < 2) return { cards: [] };
  const [cat, own] = await Promise.all([getCatalog(), ownedMap(userId)]);
  const hits = [];
  for (const c of cat.byId.values()) {
    const name = c.name.toLowerCase();
    const at = name.indexOf(needle);
    if (at < 0) continue;
    hits.push({ c, score: (at === 0 ? 0 : 1) * 1e6 + c.no });
  }
  hits.sort((a, b) => a.score - b.score);
  return {
    cards: hits.slice(0, 40).map(({ c }) => ({ ...c, owned: own.has(c.id), count: own.get(c.id)?.count || 0 })),
  };
}
