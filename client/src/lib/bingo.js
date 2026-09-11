// ======================================================================
//  LES GRILLES DE BINGO D'UN RENDEZ-VOUS
// ======================================================================
// Port web de myplaylog-mobile/src/lib/bingo.js.
//
// Avant un Direct, on écrit ce qu'on espère voir — « quelque chose Metroid »,
// « F-ZERO PLEASE NINTENDO » — et pendant l'émission, on coche.
//
// ⚠️ LA RÈGLE DU JEU TIENT EN UNE PHRASE, ET C'EST L'HORLOGE QUI L'APPLIQUE :
// tant que l'émission n'a pas commencé on compose sans rien cocher, une fois
// qu'elle a commencé on coche sans plus rien composer. Le serveur la fait
// respecter (cf. server/routes/bingo.js) ; ce fichier la REDIT côté site, pour
// que l'écran n'offre jamais un geste qui sera refusé.
//
// Les trois calculs doivent donc rester d'accord. Ils le sont parce qu'ils
// lisent la même chose : `startsAt`. Rien d'autre.

import { eventEndMs } from "./homeEvents";

export const SIZES = [2, 3, 4, 5];
export const DEFAULT_CELL_STYLE = "banner";

/** Le nombre de cases d'une grille. */
export const cellCount = (size) => size * size;

/**
 * L'index de la case offerte — celle du milieu.
 *
 * ⚠️ N'EXISTE QUE SUR LES GRILLES IMPAIRES. Une 4×4 n'a pas de centre : lui en
 * inventer un donnerait une case gratuite décalée d'une demi-case.
 */
export const freeIndex = (size) => (size % 2 === 1 ? Math.floor(cellCount(size) / 2) : -1);

/** Une grille vide, prête à être remplie. */
export function blankCells(size) {
  const free = freeIndex(size);
  return Array.from({ length: cellCount(size) }, (_, index) => ({
    index,
    text: "",
    image: null,
    gameId: null,
    gameName: "",
    saga: null,
    pos: null,
    textStyle: DEFAULT_CELL_STYLE,
    free: index === free,
    // ⚠️ PAS COCHÉE D'AVANCE. La case offerte est OFFERTE, elle n'est pas
    // gagnée : c'est son propriétaire qui la coche quand l'émission commence.
    checked: false,
  }));
}

/**
 * Rebâtit les cases pour une nouvelle taille, en gardant ce qui peut l'être.
 *
 * ⚠️ ON CONSERVE PAR POSITION (LIGNE, COLONNE), PAS PAR INDEX. Les cases sont
 * rangées à plat : l'index 3 est la quatrième case de la première ligne d'une
 * 4×4, mais la première case de la deuxième ligne d'une 3×3. Recopier index par
 * index en changeant de taille fait glisser toute la grille en diagonale — le
 * texte qu'on venait d'écrire se retrouve ailleurs, et on croit l'avoir perdu.
 */
export function resizeCells(cells, from, to) {
  const next = blankCells(to);
  const free = freeIndex(to);
  for (const cell of cells || []) {
    if (cell.free) continue; // la case offerte de l'ancienne taille ne suit pas
    const row = Math.floor(cell.index / from);
    const col = cell.index % from;
    if (row >= to || col >= to) continue; // ce qui sort du cadre est abandonné
    const index = row * to + col;
    if (index === free) continue; // et rien ne s'écrit sur la case offerte
    next[index] = { ...cell, index, free: false, checked: false };
  }
  return next;
}

/**
 * Rebat les cases, en laissant la case offerte où elle est.
 *
 * ⚠️ LES CASES VIDES PARTICIPENT AU TIRAGE. Ne mélanger que les cases écrites
 * les tasserait en haut de la grille à chaque tirage — ce n'est plus un
 * mélange, c'est un rangement.
 */
export function shuffleCells(cells) {
  const next = [...(cells || [])];
  const movable = next.map((_, i) => i).filter((i) => !next[i]?.free);
  // Fisher-Yates sur les EMPLACEMENTS déplaçables : chaque permutation est
  // équiprobable, contrairement à un tri sur `Math.random()`.
  for (let i = movable.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = movable[i];
    const b = movable[j];
    const tmp = next[a];
    next[a] = next[b];
    next[b] = tmp;
  }
  // L'index est une PROPRIÉTÉ de la case autant qu'une place dans le tableau :
  // il part au serveur (cf. `cellsForSave`), il faut donc le remettre d'aplomb.
  return next.map((c, i) => (c ? { ...c, index: i } : c));
}

export const cellFilled = (c) => !!(c && (c.text?.trim() || c.image || c.free));

/** Combien de cases sont remplies. */
export const filledCount = (cells) => (cells || []).filter(cellFilled).length;

/** Combien de cases sont cochées (la case offerte comprise). */
export const checkedCount = (cells) => (cells || []).filter((c) => c.checked).length;

// ----------------------------------------------------------------------
//  Les lignes complètes
// ----------------------------------------------------------------------
// ⚠️ C'EST LE SEUL ENDROIT OÙ « BINGO ! » SE DÉCIDE, et il ne compte QUE les
// cases remplies. Une grille à moitié composée a des cases vides : les traiter
// comme cochées offrirait un bingo à qui n'a rien écrit ; les traiter comme
// jamais cochées interdirait tout bingo à une grille clairsemée. Une ligne est
// complète quand TOUTES SES CASES REMPLIES sont cochées, et qu'il y en a au
// moins une.

function lineOf(cells, indexes) {
  const used = indexes.map((i) => cells[i]).filter(cellFilled);
  if (!used.length) return null;
  return used.every((c) => c.checked) ? indexes : null;
}

/** Toutes les lignes (horizontales, verticales, diagonales) déjà complétées. */
export function completedLines(cells, size) {
  if (!cells?.length) return [];
  const lines = [];
  for (let r = 0; r < size; r++)
    lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++)
    lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines.map((l) => lineOf(cells, l)).filter(Boolean);
}

/** Les index appartenant à au moins une ligne complète — pour les allumer. */
export function winningIndexes(cells, size) {
  return new Set(completedLines(cells, size).flat());
}

/** La grille entière est-elle cochée ? Le « carton plein ». */
export function isFullHouse(cells) {
  const used = (cells || []).filter(cellFilled);
  return used.length > 0 && used.every((c) => c.checked);
}

// ----------------------------------------------------------------------
//  Les deux âges d'une grille
// ----------------------------------------------------------------------

/** L'émission a-t-elle commencé ? C'est ce qui fige la composition. */
export function eventStarted(event, now = Date.now()) {
  const ts = new Date(event?.startsAt).getTime();
  return !Number.isNaN(ts) && now >= ts;
}

/** Et est-elle finie ? On coche encore après (les rediffusions existent). */
export function eventFinished(event, now = Date.now()) {
  const end = eventEndMs(event);
  return end !== null && now >= end;
}

/**
 * Ce qu'on a le droit de faire, à cet instant, sur cet événement.
 *
 * Un seul objet plutôt que trois appels dispersés : les écrans branchent leurs
 * boutons dessus, et il devient impossible d'en oublier un le jour où la règle
 * bouge.
 */
export function bingoPhase(event, now = Date.now()) {
  const started = eventStarted(event, now);
  return {
    started,
    canCompose: !started,
    canCheck: started,
    finished: eventFinished(event, now),
  };
}

// ----------------------------------------------------------------------
//  Ce qui part au serveur
// ----------------------------------------------------------------------
// On n'envoie que ce qui a un sens en base : les cases vides ne sont pas
// enregistrées (le serveur rend de toute façon un tableau dense), et `checked`
// n'est jamais posé par cette route — cocher a sa propre route, parce que ça ne
// se fait ni au même moment ni sous les mêmes règles.
export const cellsForSave = (cells) =>
  (cells || [])
    .filter(cellFilled)
    .map((c) => ({
      index: c.index,
      text: (c.text || "").trim(),
      image: c.image || null,
      gameId: c.gameId ?? null,
      gameName: c.gameName || "",
      saga: c.saga || null,
      pos: c.pos || null,
      textStyle: c.textStyle || DEFAULT_CELL_STYLE,
      free: !!c.free,
    }));
