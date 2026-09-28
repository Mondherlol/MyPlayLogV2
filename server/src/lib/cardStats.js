// ======================================================================
//  Les chiffres d'une carte, côté serveur (types, PV, dégâts)
// ======================================================================
// ⚠️ COPIE FIDÈLE de client/src/lib/cards.js (cardTypes + cardStats), sans les
// noms d'attaques. Le combat se décide ici ; la carte, elle, se dessine chez le
// client avec SES calculs. Une formule changée d'un côté doit l'être de
// l'autre, sinon la carte afficherait 70 et frapperait 80.

export const TYPE_GENRES = {
  combat: [4, 25],
  tir: [5],
  plateforme: [8],
  aventure: [31, 2],
  rpg: [12],
  strategie: [11, 15, 16, 24, 36],
  reflexion: [9, 26, 35],
  course: [10],
  sport: [14],
  simulation: [13],
  rythme: [7],
  arcade: [33, 30],
  inde: [32],
  recit: [34],
};

const GENRE_TO_TYPE = new Map();
for (const [key, genres] of Object.entries(TYPE_GENRES)) for (const g of genres) GENRE_TO_TYPE.set(g, key);

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

const r10 = (v) => Math.max(10, Math.round(v / 10) * 10);

/** Types, PV et les deux attaques (type + dégâts) d'une carte du catalogue. */
export function cardStats(card) {
  const types = cardTypes(card);
  const rating = card.rating ?? 60;
  const fame = Math.log10(Math.max(10, card.votes || 10));
  const hp = Math.min(300, Math.max(30, r10(Math.pow(rating / 100, 2) * 300)));
  const t1 = types[0];
  const t2 = types[1] || types[0];
  return {
    types,
    hp,
    moves: [
      { type: t1, dmg: r10(fame * 14) },
      { type: t2, dmg: r10(rating * 1.4 + fame * 12 - 40) },
    ],
  };
}
