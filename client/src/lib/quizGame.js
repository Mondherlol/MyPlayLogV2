import { sameGame } from "./guessGame";

// ======================================================================
//  Boîte à outils du Grand Quiz, côté navigateur
// ======================================================================
// Deux choses, et il faut bien voir qu'elles n'ont pas le même statut :
//
//   1. LE BARÈME EN MIROIR de server/src/lib/quizScore.js. Il sert à afficher
//      « +540 » dès la fin d'une manche, sans attendre le /finish. C'est une
//      COPIE ASSUMÉE : les deux fichiers doivent bouger ensemble, exactement
//      comme estimatePoints() l'est déjà pour le blind test et Pixel Rush.
//      Le score qui compte reste celui que le serveur recalcule.
//
//   2. LA CORRECTION LOCALE, réservée au solo. En solo le serveur envoie la
//      solution avec la manche (choix assumé, cf. routes/quiz.js), donc le
//      navigateur peut trancher tout de suite et enchaîner sans aller-retour.
//      En VERSUS rien de tout ça n'existe : la solution n'arrive jamais avant
//      la révélation, et c'est le serveur qui corrige. Les fonctions
//      `checkLocal*` ne doivent donc JAMAIS être appelées en versus — elles
//      n'auraient rien à comparer.

// ============================================================
//  Le barème (miroir)
// ============================================================
export function speedFrac(timeMs, durationSec) {
  const dur = Math.max(1, durationSec) * 1000;
  if (timeMs == null) return 0;
  const t = Math.min(Math.max(timeMs, 0), dur);
  return (dur - t) / dur;
}

const MISS_FACTOR = [1, 0.7, 0.4];
// Miroir de MOTUS_LADDER (server/src/lib/quizScore.js) : un cran par essai.
const MOTUS_LADDER = [1, 0.86, 0.72, 0.58, 0.45];
const missFactor = (m) => MISS_FACTOR[Math.min(Math.max(m || 0, 0), MISS_FACTOR.length - 1)];

export function estimateQuizPoints(round, given, timeMs) {
  const dur = round.durationSec || 20;
  const frac = speedFrac(timeMs, dur);
  const misses = Math.max(0, Number(given?.misses) || 0);

  switch (round.type) {
    case "qcm":
      return given?.correct ? 220 + Math.round(380 * frac) : 0;
    case "emoji":
      return given?.correct ? Math.round((260 + Math.round(380 * frac)) * missFactor(misses)) : 0;
    case "studio": {
      const need = round.need || 3;
      const found = Math.min(Number(given?.found) || 0, need);
      if (!found) return 0;
      return 150 * found + (found >= need ? 100 + Math.round(120 * frac) : 0);
    }
    case "duel": {
      const total = round.cards?.length || 0;
      const ok = Math.min(Number(given?.placed) || 0, total);
      return 110 * ok + (total && ok === total ? 120 + Math.round(120 * frac) : 0);
    }
    case "pixel":
      return given?.correct ? 240 + Math.round(400 * frac) : 0;
    case "swipe": {
      const good = Math.max(0, Number(given?.good) || 0);
      const bad = Math.max(0, Number(given?.bad) || 0);
      return Math.max(0, 70 * good - 35 * bad);
    }
    case "anagram":
      return given?.correct ? Math.round((250 + Math.round(370 * frac)) * missFactor(misses)) : 0;
    case "motus": {
      if (!given?.correct) return 0;
      const tries = Math.max(1, Math.min(Number(given?.tries) || 1, MOTUS_LADDER.length));
      return Math.round((340 + Math.round(160 * frac)) * MOTUS_LADDER[tries - 1]);
    }
    default:
      return 0;
  }
}

// ============================================================
//  La correction locale — SOLO UNIQUEMENT
// ============================================================
// Miroir de server/src/lib/quizCheck.js. Même normalisation permissive sur la
// saisie clavier : accents, casse et ponctuation ne doivent jamais faire
// refuser une bonne réponse.
export const normText = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ============================================================
//  Le pavage d'une proposition du Motus
// ============================================================
// MIROIR EXACT de `markGuess` (server/src/lib/quizCheck.js). En solo c'est lui
// qui colore la grille ; en versus, le serveur envoie déjà les couleurs et
// cette fonction ne sert pas — mais les deux doivent dire la même chose, sinon
// la même proposition se colorerait différemment selon le mode.
//
// Le deuxième passage n'est pas un détail : sur HADES, proposer SSSSS doit
// donner UN « present » et quatre « absent », pas cinq. On décompte donc les
// lettres déjà prises par les correspondances exactes.
export function markGuess(guess, answer) {
  const g = [...String(guess || "").toUpperCase()];
  const a = [...String(answer || "").toUpperCase()];
  const marks = new Array(g.length).fill("absent");
  const left = new Map();
  for (let i = 0; i < g.length; i += 1) {
    if (g[i] === a[i]) marks[i] = "exact";
    else if (a[i] !== undefined) left.set(a[i], (left.get(a[i]) || 0) + 1);
  }
  for (let i = 0; i < g.length; i += 1) {
    if (marks[i] === "exact") continue;
    const n = left.get(g[i]) || 0;
    if (n > 0) {
      marks[i] = "present";
      left.set(g[i], n - 1);
    }
  }
  return marks;
}

export function checkLocal(round, given) {
  switch (round.type) {
    case "qcm": {
      const correct = Number(given?.choice) === Number(round.answerIndex);
      return { correct, ratio: correct ? 1 : 0, detail: {} };
    }
    case "emoji":
    case "pixel":
    case "anagram": {
      const correct = sameGame(round, given?.gameId ?? null, given?.name || "");
      return { correct, ratio: correct ? 1 : 0, detail: {} };
    }
    case "motus": {
      const answer = String(round.answer || "").toUpperCase();
      const guess = String(given?.guess || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (guess.length !== answer.length)
        return { correct: false, ratio: 0, detail: { guess, marks: [], short: true } };
      const correct = guess === answer;
      return {
        correct,
        ratio: correct ? 1 : 0,
        detail: { guess, marks: markGuess(guess, answer) },
      };
    }
    case "studio": {
      const need = round.need || 3;
      const hit = acceptedStudioGames(round, given?.answers || []);
      return {
        correct: hit.length >= need,
        ratio: need ? Math.min(hit.length, need) / need : 0,
        detail: { hit },
      };
    }
    case "duel": {
      const total = (round.cards || []).length;
      let placed = 0;
      for (const c of round.cards || [])
        if (given?.placement?.[c.id] != null &&
            Number(given.placement[c.id]) === Number(round.solution?.[c.id]))
          placed += 1;
      return { correct: total > 0 && placed === total, ratio: total ? placed / total : 0, detail: { placed } };
    }
    case "swipe": {
      const byId = new Map((round.deck || []).map((c) => [Number(c.gameId), c.yes]));
      let good = 0;
      let bad = 0;
      for (const a of given?.answers || []) {
        if (!byId.has(Number(a.gameId))) continue;
        if (!!a.yes === byId.get(Number(a.gameId))) good += 1;
        else bad += 1;
      }
      const total = good + bad;
      return {
        correct: good >= 8 && total > 0 && good / total >= 0.75,
        ratio: total ? good / total : 0,
        detail: { good, bad },
      };
    }
    default:
      return { correct: false, ratio: 0, detail: {} };
  }
}

// Quels jeux proposés font partie du catalogue du studio. Utilisé pour le
// retour immédiat de l'épreuve « studio » en solo (le serveur fait le même
// travail en versus, cf. checkStudio).
export function acceptedStudioGames(round, answers) {
  const accept = round.accept || [];
  const out = [];
  const seen = new Set();
  for (const a of answers) {
    const match = accept.find((g) =>
      sameGame({ gameId: g.gameId, gameName: g.name }, a?.gameId ?? null, a?.name || "")
    );
    if (match && !seen.has(match.gameId)) {
      seen.add(match.gameId);
      out.push(match);
    }
  }
  return out;
}

// ============================================================
//  Le titre masqué de l'épreuve « emojis »
// ============================================================
// Le serveur envoie la FORME du titre (`pattern`) et le calendrier des lettres
// qui se dévoilent (`reveals`). On assemble ici ce qui doit s'afficher à
// l'instant `elapsedMs`.
//
// En versus, `reveals` est DÉJÀ filtré par le serveur (il ne contient que les
// lettres dont l'heure est passée) : le filtre ci-dessous ne fait alors rien,
// et c'est très bien — un seul composant pour les deux modes.
export function maskCells(pattern, reveals, elapsedMs) {
  const shown = new Map(
    (reveals || []).filter((r) => (r.atMs ?? 0) <= elapsedMs).map((r) => [r.index, r.letter])
  );
  return (pattern || []).map((p, i) => {
    if (!p.h) return { kind: "sep", char: p.c };
    const letter = shown.get(i);
    return letter ? { kind: "shown", char: letter } : { kind: "blank", char: "" };
  });
}

// Nombre de lettres encore cachées : sert à l'indice « il reste 12 lettres ».
export const hiddenCount = (cells) => cells.filter((c) => c.kind === "blank").length;

// ============================================================
//  Petits communs d'affichage
// ============================================================
// Le libellé d'une épreuve est envoyé par le serveur avec la manche (`label`),
// mais l'icône et la couleur sont une affaire d'interface : elles vivent ici.
// `label` fait double emploi avec celui que le serveur envoie dans la manche
// (TYPE_META, lib/quizRounds.js) — et c'est voulu : les cartes du fil ne
// reçoivent que des CLÉS d'épreuve (`meta.types`), pas des manches. Sans copie
// locale, il faudrait une requête au serveur pour afficher trois pastilles.
export const TYPE_UI = {
  qcm: { label: "Question", color: "#f5c451", hint: "Une bonne réponse sur quatre." },
  emoji: { label: "Emojis", color: "#7ad0ff", hint: "Devine le jeu derrière les emojis." },
  studio: { label: "Le studio", color: "#b493ff", hint: "Cite trois jeux de ce studio." },
  duel: { label: "Duel", color: "#ff9a6c", hint: "Dépose chaque carte sous le bon jeu." },
  pixel: { label: "Pixels", color: "#6ce3a6", hint: "Reconnais le jeu derrière les pixels." },
  swipe: { label: "Le tri", color: "#ff7fa8", hint: "Trie la pile le plus vite possible." },
  anagram: {
    label: "Lettres mêlées",
    color: "#9fd8c8",
    hint: "Remets les lettres dans l'ordre pour retrouver le jeu.",
  },
  motus: {
    label: "Le mot",
    color: "#ffb56b",
    hint: "Trouve le jeu en cinq essais. Vert : bien placé. Orange : mal placé.",
  },
};

export const typeColor = (type) => TYPE_UI[type]?.color || "#f5c451";
export const typeHint = (type) => TYPE_UI[type]?.hint || "";
export const typeLabel = (type) => TYPE_UI[type]?.label || type;

// Essais autorisés par épreuve. MIROIR de `attemptsAllowed` dans
// server/src/routes/quizVersus.js — le solo doit se verrouiller aux mêmes
// moments que le versus, sinon la même épreuve se joue différemment selon le
// mode et plus personne ne sait combien d'essais il a.
export function triesFor(type) {
  if (type === "studio") return 6;
  if (type === "motus") return MOTUS_LADDER.length;
  if (type === "qcm" || type === "duel" || type === "swipe") return 1;
  return 3;
}
