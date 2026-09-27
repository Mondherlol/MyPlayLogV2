
// ======================================================================
//  Cartes à collectionner — tout l'habillage d'une carte
// ======================================================================
// Le serveur envoie les VRAIS chiffres du jeu (note, votes, année, genres) ;
// ce fichier les transforme en carte : un type par famille de genres, des PV
// tirés de la note, deux attaques dont les dégâts suivent la popularité.
// Tout est déterministe (même jeu → même carte, partout, pour tout le monde).

// --- Les types : une famille de genres IGDB, une couleur, une icône ---------
// (Plus tard : faiblesses et résistances entre types.)
export const TYPES = {
  combat: { label: "Combat", color: "#ec6a50", genres: [4, 25] },
  tir: { label: "Tir", color: "#f39a3d", genres: [5] },
  plateforme: { label: "Plateforme", color: "#82c957", genres: [8] },
  aventure: { label: "Aventure", color: "#3dbba6", genres: [31, 2] },
  rpg: { label: "RPG", color: "#a97cea", genres: [12] },
  strategie: { label: "Stratégie", color: "#6194ea", genres: [11, 15, 16, 24, 36] },
  reflexion: { label: "Réflexion", color: "#f085bd", genres: [9, 26, 35] },
  course: { label: "Course", color: "#3cc4e4", genres: [10] },
  sport: { label: "Sport", color: "#aad24a", genres: [14] },
  simulation: { label: "Simulation", color: "#a3aebd", genres: [13] },
  rythme: { label: "Rythme", color: "#e077d9", genres: [7] },
  arcade: { label: "Arcade", color: "#f2b70b", genres: [33, 30] },
  inde: { label: "Indé", color: "#cf9d70", genres: [32] },
  recit: { label: "Récit", color: "#b7a8f2", genres: [34] },
};
export const TYPE_KEYS = Object.keys(TYPES);

const GENRE_TO_TYPE = new Map();
for (const [key, t] of Object.entries(TYPES)) for (const g of t.genres) GENRE_TO_TYPE.set(g, key);

// Les types d'une carte (deux au plus). « Indé » ne passe devant que s'il est
// seul : c'est une façon de faire, pas un genre de jeu.
export function cardTypes(card) {
  const seen = [];
  for (const g of card.genres || []) {
    const t = GENRE_TO_TYPE.get(g);
    if (t && !seen.includes(t)) seen.push(t);
  }
  const main = seen.filter((t) => t !== "inde");
  const out = main.length ? [...main.slice(0, 2)] : seen.slice(0, 1);
  if (out.length < 2 && main.length && seen.includes("inde")) out.push("inde");
  return out.length ? out : ["arcade"];
}

// --- Raretés : symboles façon TCG Pocket ---------------------------------
export const CARD_RARITIES = {
  common: { label: "Commune", color: "#9aa3ad", symbol: "◆", n: 1 },
  uncommon: { label: "Peu commune", color: "#5b7cff", symbol: "◆", n: 2 },
  rare: { label: "Rare", color: "#9a5cff", symbol: "◆", n: 3 },
  epic: { label: "Épique", color: "#e040f0", symbol: "★", n: 1 },
  legendary: { label: "Légendaire", color: "#ff4d4d", symbol: "★", n: 2 },
  mythic: { label: "Mythique", color: "#f2b70b", symbol: "♛", n: 1 },
};
export const CARD_RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
export const cardRarityRank = (r) => Math.max(0, CARD_RARITY_ORDER.indexOf(r));
export const raritySymbol = (r) => {
  const x = CARD_RARITIES[r] || CARD_RARITIES.common;
  return x.symbol.repeat(x.n);
};
// Holo sur l'illustration dès « rare », sur toute la carte dès « épique »,
// pleine illustration (la jaquette couvre la carte) pour les deux derniers.
export const isHolo = (r) => cardRarityRank(r) >= 2;
export const isFullArt = (r) => cardRarityRank(r) >= 4;

// --- Les attaques ------------------------------------------------------------
// La signature vient des TAGS du jeu (serveur, lib/cardMoves.js : « Horde
// affamée » pour les zombies, « Paradoxe » pour le voyage dans le temps). La
// seconde marie un mot du GENRE à un tag : « Rafale » + « des morts-vivants ».
// Sans tag parlant, on retombe sur les attaques de genre ci-dessous.
const NOUNS = {
  combat: ["Frappe", "Combo", "Uppercut", "Riposte"],
  tir: ["Rafale", "Salve", "Tir", "Balle"],
  plateforme: ["Saut", "Bond", "Rebond", "Glissade"],
  aventure: ["Quête", "Expédition", "Relique", "Piste"],
  rpg: ["Sort", "Rituel", "Invocation", "Malédiction"],
  strategie: ["Assaut", "Siège", "Manœuvre", "Offensive"],
  reflexion: ["Énigme", "Casse-tête", "Déduction", "Combinaison"],
  course: ["Dérapage", "Turbo", "Virage", "Sprint"],
  sport: ["Smash", "Passe", "Frappe", "Contre"],
  simulation: ["Chantier", "Récolte", "Plan", "Routine"],
  rythme: ["Refrain", "Solo", "Riff", "Tempo"],
  arcade: ["Combo", "Bonus", "Power-up", "Coup"],
  inde: ["Élan", "Songe", "Éclat", "Écho"],
  recit: ["Chapitre", "Souvenir", "Serment", "Récit"],
};

const MOVES = {
  combat: ["Combo furie", "Uppercut", "Coup chargé", "Garde brisée"],
  tir: ["Rafale", "Headshot", "Tir de barrage", "Visée laser"],
  plateforme: ["Double saut", "Rebond", "Écrasement", "Glissade"],
  aventure: ["Exploration", "Coup d'épée", "Énigme ancienne", "Grappin"],
  rpg: ["Boule de feu", "Coup critique", "Level up", "Invocation"],
  strategie: ["Rush", "Encerclement", "Siège", "Contre-attaque"],
  reflexion: ["Eurêka", "Tetris", "Déduction", "Casse-tête"],
  course: ["Turbo", "Dérapage", "Aspiration", "Nitro"],
  sport: ["Frappe enroulée", "Smash", "Contre", "Sprint final"],
  simulation: ["Optimisation", "Grand chantier", "Pilote auto", "Récolte"],
  rythme: ["Perfect", "Combo x100", "Crescendo", "Fever"],
  arcade: ["Insert coin", "High score", "Continue ?", "Bonus stage"],
  inde: ["Pixel art", "Coup de cœur", "Game jam", "Culte"],
  recit: ["Choix cornélien", "Fin cachée", "Monologue", "Rebondissement"],
};

// Petit hachage stable : le même jeu choisit toujours les mêmes attaques.
function hash(n) {
  let x = Number(n) | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  return ((x >>> 16) ^ x) >>> 0;
}
const r10 = (v) => Math.max(10, Math.round(v / 10) * 10);

/** Tout ce que la carte affiche, dérivé des vrais chiffres du jeu. */
export function cardStats(card) {
  const types = cardTypes(card);
  const rating = card.rating ?? 60;
  const fame = Math.log10(Math.max(10, card.votes || 10)); // ~1.7 → ~3.8
  const h = hash(card.id);
  // PV : la note, au carré pour creuser l'écart entre un bon jeu et un chef-d'œuvre.
  const hp = Math.min(300, Math.max(30, r10(Math.pow(rating / 100, 2) * 300)));
  const t1 = types[0];
  const t2 = types[1] || types[0];
  const m1 = MOVES[t1] || MOVES.arcade;
  const m2 = MOVES[t2] || MOVES.arcade;
  const i1 = h % m1.length;
  let i2 = (h >>> 5) % m2.length;
  if (t1 === t2 && i2 === i1) i2 = (i1 + 1) % m2.length;
  // Les noms : d'abord les tags, à défaut le genre.
  let name1 = m1[i1];
  let name2 = m2[i2];
  const tag = card.moves;
  if (tag?.a) {
    name2 = tag.a.name;
    const nouns = NOUNS[t1] || NOUNS.arcade;
    const noun = nouns[(h >>> 13) % nouns.length];
    const other = tag.b || tag.a;
    // Une fois sur deux, le second tag donne sa propre signature ; sinon on
    // greffe son complément sur un mot du genre.
    if (tag.b && (h >>> 17) % 2) name1 = tag.b.name;
    else if (tag.b || (h >>> 19) % 2) name1 = `${noun} ${other.of}`;
    if (name1 === name2) name1 = m1[i1];
  }
  const moves = [
    { type: t1, cost: 1 + ((h >>> 9) % 2), name: name1, dmg: r10(fame * 14) },
    {
      type: t2,
      cost: 2 + ((h >>> 11) % 2),
      name: name2,
      dmg: r10(rating * 1.4 + fame * 12 - 40),
      plus: rating >= 85,
    },
  ];
  return { types, hp, moves };
}

// --- Les éditions de boosters ------------------------------------------------
// Même contenu, même taux : c'est l'habillage qu'on choisit (pour l'instant).
export const EDITIONS = [
  { key: "origines", name: "Origines", no: "01" },
  { key: "neon", name: "Néon", no: "02" },
  { key: "braise", name: "Braise", no: "03" },
];

// --- Images -------------------------------------------------------------------
export const cardCover = (id, size = "t_cover_big_2x") =>
  id ? `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg` : null;
// L'illustration paysage de la fenêtre (key art ou capture, cf. serveur).
export const cardArt = (id, big = false) =>
  id
    ? `https://images.igdb.com/igdb/image/upload/${big ? "t_screenshot_big" : "t_screenshot_med"}/${id}.jpg`
    : null;

export const fmtVotes = (n) => {
  const v = Number(n || 0);
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(".", ",")}k`;
  return String(v);
};

export const fmtChance = (p) => {
  if (!p) return "—";
  const pct = p * 100;
  const s = pct < 1 ? pct.toFixed(1) : pct < 10 ? pct.toFixed(1) : Math.round(pct);
  return `${String(s).replace(".", ",")} %`;
};

// « 1 booster sur 14 » : plus parlant qu'un pourcentage pour les raretés hautes.
export const oneIn = (p) => (p > 0 ? Math.max(1, Math.round(1 / p)) : null);
