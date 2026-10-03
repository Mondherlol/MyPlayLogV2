import User from "../models/User.js";
import PointEntry from "../models/PointEntry.js";

// ======================================================================
//  Porte-monnaie : le SEUL endroit qui touche à User.points.
// ======================================================================
// Toute écriture passe par ici → le grand livre (PointEntry) reste le reflet
// fidèle du solde. Pour brancher une nouvelle façon de gagner des points, il
// suffit d'appeler grantPoints() depuis la route concernée.

// Taux de change score → points d'arcade, par jeu. Chaque mini-jeu garde son
// propre barème (classements, records, cartes du fil) ; seul ce qui tombe dans
// le porte-monnaie passe par ce taux. Repère : une bonne partie de cinq minutes
// rapporte ~800-1 200 points, deux boosters à peu près (500 pièce) — au taux 1
// d'origine, cinq parties de Pixel Rush en payaient une vingtaine.
export const ARCADE_RATE = {
  blindtest: 0.4, // ~2 000-4 000 par partie
  pixel: 0.4,
  geo: 0.4, // ~2 500, 5 000 au mieux
  btversus: 0.4,
  pxversus: 0.4,
  geoversus: 0.4,
  quiz: 1.8, // ~450, ~700 au mieux
  quizversus: 1.8,
  perroquet: 13, // une moyenne sur 100
  perroquetversus: 13,
  imposteur: 5, // 60-100 par manche, 3 manches par défaut
  mot: 0.6, // 1 000-3 000, une fois par jour
  // Barème brut : 8 par bonne réponse, 60 + 15 par adversaire au gagnant, 25
  // au deuxième. Sans taux, une victoire payait ~50 points, invisible à côté
  // des autres jeux ; au taux 4, une belle partie entre amis rapporte ~700.
  bombe: 4,
};

export function arcadePoints(source, score) {
  return Math.round((Number(score) || 0) * (ARCADE_RATE[source] ?? 1));
}

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
