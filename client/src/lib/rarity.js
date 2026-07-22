// Miroir de server/src/lib/rarity.js — les libellés et couleurs des raretés.
// Le SERVEUR reste seul maître des poids et du tirage : ce qui est ici n'est
// que de l'habillage (couleur d'aura, nom affiché, ordre de tri).
export const RARITIES = {
  common: { label: "Commun", color: "#8b98a5" },
  uncommon: { label: "Peu commun", color: "#4b69ff" },
  rare: { label: "Rare", color: "#8847ff" },
  epic: { label: "Épique", color: "#d32ce6" },
  legendary: { label: "Légendaire", color: "#eb4b4b" },
  mythic: { label: "Mythique", color: "#f2b70b" },
};

// Du plus commun au plus rare : sert à trier l'inventaire et les listes admin.
export const RARITY_ORDER = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];

export const rarityRank = (r) => {
  const i = RARITY_ORDER.indexOf(r);
  return i === -1 ? 0 : i;
};

export const rarityLabel = (r) => RARITIES[r]?.label || "Commun";
export const rarityColor = (r) => RARITIES[r]?.color || RARITIES.common.color;

// Les familles de lots. Aligné sur REWARD_TYPES côté serveur.
export const REWARD_TYPES = {
  cursor: { label: "Curseur", plural: "Curseurs" },
  ornament: { label: "Ornement", plural: "Ornements" },
  badge: { label: "Badge", plural: "Badges" },
  theme: { label: "Thème", plural: "Thèmes" },
};

// Chance affichée : « 0,4 % » plutôt que « 0 % » pour les lots très rares.
export function formatChance(p) {
  if (!p) return "—";
  const pct = p * 100;
  const s = pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : Math.round(pct);
  return `${String(s).replace(".", ",")} %`;
}
