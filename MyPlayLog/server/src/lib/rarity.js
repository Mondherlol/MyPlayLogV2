// ======================================================================
//  Raretés — la source de vérité, partagée par les lots et les caisses.
// ======================================================================
// Esprit « caisse CS:GO » : plus c'est rare, plus la couleur monte en
// température, et le tirage est pondéré par `weight`. Le doré (mythic) est
// l'accent de l'app : c'est volontairement le palier le plus haut.
//
// `weight` = poids RELATIF du tirage à l'intérieur d'une caisse. Il n'est
// utilisé que comme défaut : un lot peut surcharger le sien (Reward.weight),
// ce qui permet de truquer une caisse événementielle sans toucher au code.
export const RARITIES = {
  common: { label: "Commun", color: "#8b98a5", weight: 100 },
  uncommon: { label: "Peu commun", color: "#4b69ff", weight: 40 },
  rare: { label: "Rare", color: "#8847ff", weight: 16 },
  epic: { label: "Épique", color: "#d32ce6", weight: 6 },
  legendary: { label: "Légendaire", color: "#eb4b4b", weight: 2 },
  mythic: { label: "Mythique", color: "#f2b70b", weight: 0.4 },
};

export const RARITY_KEYS = Object.keys(RARITIES);

// Remboursement d'un doublon, en % du prix de la caisse. Plus le lot est rare,
// plus le lot en double « vaut » cher — un légendaire en double reste une
// bonne nouvelle. (Le client affiche ce montant dans la carte de résultat.)
export const DUPLICATE_REFUND = {
  common: 0.15,
  uncommon: 0.25,
  rare: 0.45,
  epic: 0.8,
  legendary: 1.5,
  mythic: 3,
};

export const isRarity = (r) => Object.hasOwn(RARITIES, String(r));

// Poids effectif d'un lot : le sien s'il en a un, sinon celui de sa rareté.
export function rewardWeight(reward) {
  const own = Number(reward?.weight);
  if (Number.isFinite(own) && own > 0) return own;
  return RARITIES[reward?.rarity]?.weight ?? 1;
}

// Remboursement d'un doublon, arrondi, plancher à 1 point (on ne repart
// jamais totalement les mains vides).
export function duplicateRefund(reward, casePrice) {
  const pct = DUPLICATE_REFUND[reward?.rarity] ?? 0.15;
  return Math.max(1, Math.round((casePrice || 0) * pct));
}
