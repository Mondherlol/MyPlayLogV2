// ======================================================================
//  Les grilles « un jeu par case » — Ma carte de joueur
// ======================================================================
// Le pendant des 9 (lib/nineSuggest, models/List `nine`), dans l'autre sens :
// au lieu de neuf jeux sur UN thème, UN jeu pour chaque case — « mon jeu
// préféré », « meilleure histoire », « pas mon style, mais… ». C'est le format
// qui circule sur les réseaux, en grille de vingt.
//
// Une grille est une liste (models/List) avec `board` = la clé du modèle ;
// chaque élément porte sa case (`slot`). Deux cases demandent en plus un
// personnage du jeu (`char`) : le protagoniste et l'antagoniste, affichés en
// médaillon par-dessus la jaquette.
//
// ⚠️ LA CLÉ DE CASE EST CE QUI EST STOCKÉ, pas son libellé : on peut
// reformuler une case sans toucher aux grilles publiées. Retirer une case, en
// revanche, fait disparaître ce qu'on y avait mis (les éléments dont la case
// n'existe plus sont ignorés à l'enregistrement suivant). Le même tableau vit
// côté client (client/src/lib/boards.js).
//
// `suggest` : la règle de lib/nineSuggest qui ouvre la fenêtre de choix.

export const BOARDS = {
  gamer: {
    title: "Ma carte de joueur",
    slots: [
      { key: "favorite", suggest: "favorites" },
      { key: "story", suggest: "story" },
      { key: "art", suggest: "art" },
      { key: "impact", suggest: "personality" },
      { key: "combat", suggest: "combat" },
      { key: "overhated", suggest: "overhated" },
      { key: "underrated", suggest: "underrated" },
      { key: "overrated", suggest: "overrated" },
      { key: "remake", suggest: "remake" },
      { key: "overlooked", suggest: "overlooked" },
      { key: "protagonist", suggest: "story", char: true },
      { key: "antagonist", suggest: "villains", char: true },
      { key: "soundtrack", suggest: "soundtrack" },
      { key: "multiplayer", suggest: "multiplayer" },
      { key: "notmything", suggest: "notmything" },
      { key: "brainoff", suggest: "brainoff" },
      { key: "friends", suggest: "coop" },
      { key: "retro", suggest: "retro" },
      { key: "nostalgia", suggest: "childhood" },
      { key: "everyone", suggest: "mustplay" },
    ],
  },
};

export const boardKey = (raw) => (BOARDS[raw] ? raw : null);

export function boardSlot(board, slot) {
  return BOARDS[board]?.slots.find((s) => s.key === slot) || null;
}

/**
 * Les éléments d'une grille, remis en ordre : des jeux seulement, une case
 * connue chacun, un seul jeu par case (le dernier envoyé gagne), et le
 * personnage retiré des cases qui n'en prennent pas.
 */
export function cleanBoardItems(board, items) {
  const bySlot = new Map();
  for (const it of items || []) {
    if (it.kind !== "game") continue;
    const slot = boardSlot(board, it.slot);
    if (!slot) continue;
    bySlot.set(slot.key, {
      ...it,
      slot: slot.key,
      charName: slot.char ? it.charName || null : null,
      charImage: slot.char ? it.charImage || null : null,
    });
  }
  // Dans l'ordre de la grille : c'est aussi l'ordre de l'aperçu.
  return BOARDS[board].slots.map((s) => bySlot.get(s.key)).filter(Boolean);
}
