// Persistance (locale pour l'instant) de l'apparence du personnage Playtopia.
// Backend à brancher plus tard. Volontairement sans dépendance à three.js pour
// rester dans le bundle principal (le bouton perso doit être léger).

export const DEFAULT_CHAR = { color: "#f2a65a", hat: "none", eyes: "dots" };

function keyFor(userId) {
  return `mpl_pt_char_${userId || "guest"}`;
}

export function loadChar(userId) {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return { ...DEFAULT_CHAR };
    return { ...DEFAULT_CHAR, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CHAR };
  }
}

export function saveChar(userId, config) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(config));
  } catch {
    /* ignore (quota / mode privé) */
  }
}
