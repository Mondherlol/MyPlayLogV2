import User from "../models/User.js";
import PointEntry from "../models/PointEntry.js";

// ======================================================================
//  Porte-monnaie : le SEUL endroit qui touche à User.points.
// ======================================================================
// Toute écriture passe par ici → le grand livre (PointEntry) reste le reflet
// fidèle du solde. Pour brancher une nouvelle façon de gagner des points, il
// suffit d'appeler grantPoints() depuis la route concernée.

// Crédite un joueur. Best-effort par défaut : un gain de points ne doit jamais
// faire échouer l'action qui l'a produit (finir un blind test, par exemple).
// Retourne le nouveau solde, ou null si l'écriture a échoué.
export async function grantPoints(userId, amount, source, meta = {}) {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return null;
  try {
    const doc = await User.findByIdAndUpdate(
      userId,
      { $inc: { points: amt } },
      { new: true, timestamps: false, select: "points" }
    );
    if (!doc) return null;
    await PointEntry.create({
      user: userId,
      amount: amt,
      source,
      balance: doc.points,
      meta,
    });
    return doc.points;
  } catch (err) {
    console.error("grantPoints error:", err.message);
    return null;
  }
}

// Débite un joueur, de façon ATOMIQUE : le filtre exige un solde suffisant, donc
// deux ouvertures de caisse lancées en même temps ne peuvent pas passer toutes
// les deux avec le solde d'une seule. Lève si le solde est insuffisant — c'est
// une transaction d'achat, elle DOIT échouer bruyamment.
export async function spendPoints(userId, amount, source, meta = {}) {
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error("Montant invalide.");
  const doc = await User.findOneAndUpdate(
    { _id: userId, points: { $gte: amt } },
    { $inc: { points: -amt } },
    { new: true, timestamps: false, select: "points" }
  );
  if (!doc) {
    const err = new Error("Points insuffisants.");
    err.code = "INSUFFICIENT_POINTS";
    throw err;
  }
  // Le ledger est secondaire : le débit a eu lieu, on ne le rembourse pas parce
  // qu'une ligne d'historique n'a pas pu s'écrire.
  PointEntry.create({
    user: userId,
    amount: -amt,
    source,
    balance: doc.points,
    meta,
  }).catch((e) => console.error("spendPoints ledger error:", e.message));
  return doc.points;
}

// Solde courant (0 si le compte n'existe plus).
export async function getBalance(userId) {
  const u = await User.findById(userId).select("points").lean();
  return u?.points || 0;
}
