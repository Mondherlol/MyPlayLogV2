import { sameGame } from "../routes/blindtest.js";

// ======================================================================
//  La correction : un seul juge pour les huit épreuves
// ======================================================================
// Solo et versus corrigent EXACTEMENT pareil, parce que c'est le même fichier
// qui tranche. C'était le principal risque de la fonctionnalité : sept
// épreuves × deux modes, ça fait seize occasions d'écrire une règle un peu
// différemment, et un joueur qui voit une réponse acceptée en solo puis
// refusée en versus n'a aucune raison de faire confiance au reste.
//
// `checkRound()` rend toujours la même chose, quelle que soit l'épreuve :
//
//   { correct, ratio, detail }
//
// — `correct` : la réussite pleine.
// — `ratio`   : la part réussie (0→1), pour les épreuves à points partiels.
// — `detail`  : ce dont lib/quizScore.js a besoin pour chiffrer, plus ce que
//               le client affiche à la révélation (quels jeux du studio ont
//               été acceptés, quelles cartes étaient mal placées…).

// ------------------------------------------------------------------ QCM
function checkQcm(round, given) {
  const choice = Number(given?.choice);
  const correct = Number.isInteger(choice) && choice === Number(round.answerIndex);
  return { correct, ratio: correct ? 1 : 0, detail: { choice } };
}

// --------------------------------------------------------------- EMOJIS
// Même comparateur que les trois autres mini-jeux : `sameGame` gère l'égalité
// par identifiant IGDB, la casse, la ponctuation et les suffixes d'édition.
function checkGuessGame(round, given) {
  const gameId = given?.gameId != null ? Number(given.gameId) : null;
  const name = String(given?.name || "").slice(0, 160);
  const correct = !!(gameId != null || name) && sameGame(round, gameId, name);
  return {
    correct,
    ratio: correct ? 1 : 0,
    detail: { name, gameId, misses: Math.max(0, Number(given?.misses) || 0) },
  };
}

// -------------------------------------------------------------- STUDIO
// Trois jeux à citer. On accepte tout ce qu'IGDB attribue au studio (cf.
// gamesOfCompany dans lib/quizRounds.js), et on refuse les doublons — citer
// trois fois le même jeu ne vaut pas un triplé.
function checkStudio(round, given) {
  const accept = round.accept || [];
  const raw = Array.isArray(given?.answers) ? given.answers.slice(0, 12) : [];
  const need = round.need || 3;

  const hit = [];
  const missed = [];
  const already = new Set();
  for (const a of raw) {
    const gameId = a?.gameId != null ? Number(a.gameId) : null;
    const name = String(a?.name || "").slice(0, 160);
    if (!name && gameId == null) continue;
    const match = accept.find((g) =>
      sameGame({ gameId: g.gameId, gameName: g.name }, gameId, name)
    );
    if (match && !already.has(match.gameId)) {
      already.add(match.gameId);
      hit.push({ gameId: match.gameId, name: match.name, cover: match.cover || null });
    } else if (!match) {
      missed.push({ name, gameId });
    }
  }
  const found = Math.min(hit.length, need);
  return {
    correct: found >= need,
    ratio: need ? found / need : 0,
    detail: { found, hit, missed },
  };
}

// ---------------------------------------------------------------- DUEL
// `given.placement` = { cardId: index du jeu }. Une carte non déposée n'est ni
// juste ni fausse : elle ne rapporte simplement rien.
function checkDuel(round, given) {
  const solution = round.solution || {};
  const placement = given?.placement && typeof given.placement === "object" ? given.placement : {};
  const total = (round.cards || []).length;
  let placed = 0;
  const wrong = [];
  for (const card of round.cards || []) {
    const mine = placement[card.id];
    if (mine == null) continue;
    if (Number(mine) === Number(solution[card.id])) placed += 1;
    else wrong.push(card.id);
  }
  return {
    correct: total > 0 && placed === total,
    ratio: total ? placed / total : 0,
    detail: { placed, total, wrong, placement },
  };
}

// --------------------------------------------------------------- SWIPE
// La pile est corrigée CARTE PAR CARTE contre le verdict du serveur : en
// versus, le client ne l'a jamais eu (cf. publicRound), et en solo on ne fait
// pas confiance à un total envoyé par le navigateur.
function checkSwipe(round, given) {
  const byId = new Map((round.deck || []).map((c) => [Number(c.gameId), c.yes]));
  const raw = Array.isArray(given?.answers) ? given.answers.slice(0, 200) : [];
  let good = 0;
  let bad = 0;
  const seen = new Set();
  const detailRows = [];
  for (const a of raw) {
    const id = Number(a?.gameId);
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    const expected = byId.get(id);
    const said = !!a?.yes;
    if (said === expected) good += 1;
    else bad += 1;
    detailRows.push({ gameId: id, said, expected });
  }
  const total = good + bad;
  return {
    correct: good >= 8 && total > 0 && good / total >= 0.75,
    ratio: total ? good / total : 0,
    detail: { good, bad, rows: detailRows },
  };
}

// ------------------------------------------------------------- ANAGRAMME
// La réponse attendue est un TITRE DE JEU : on la compare donc comme partout
// ailleurs, avec `sameGame`, qui gère l'identifiant IGDB, la ponctuation et les
// suffixes d'édition. Un joueur qui a trouvé « Bloodborne » à partir de ses
// lettres ne doit pas se faire refuser sa réponse pour une apostrophe.
function checkAnagram(round, given) {
  return checkGuessGame(round, given);
}

// ----------------------------------------------------------------- MOTUS
// Le pavage d'une proposition, règle classique du genre :
//   exact   la lettre est au bon endroit ;
//   present la lettre est dans le titre, mais ailleurs ;
//   absent  elle n'y est pas.
//
// LE DEUXIÈME PASSAGE N'EST PAS UN DÉTAIL. Sur un titre comme HADES, proposer
// SSSSS doit donner UN seul « present » et quatre « absent » — pas cinq. On
// décompte donc les lettres déjà consommées par les correspondances exactes
// avant de distribuer les « present », sinon une lettre du titre serait
// signalée autant de fois qu'on la propose, ce qui donne de fausses pistes.
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

function checkMotus(round, given) {
  const answer = String(round.answer || "").toUpperCase();
  const guess = String(given?.guess || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  // Une proposition de la mauvaise longueur n'est pas une erreur de jeu, c'est
  // une saisie incomplète : elle ne consomme rien et ne colore rien.
  if (guess.length !== answer.length)
    return { correct: false, ratio: 0, detail: { guess, marks: [], short: true } };

  const marks = markGuess(guess, answer);
  const correct = guess === answer;
  const exact = marks.filter((m) => m === "exact").length;
  return {
    correct,
    ratio: correct ? 1 : 0,
    detail: {
      guess,
      marks,
      // Combien d'essais ont été brûlés : c'est ce qui pilote le barème.
      tries: Math.max(1, Number(given?.tries) || 1),
      exact,
    },
  };
}

const CHECKERS = {
  qcm: checkQcm,
  emoji: checkGuessGame,
  pixel: checkGuessGame,
  studio: checkStudio,
  duel: checkDuel,
  swipe: checkSwipe,
  anagram: checkAnagram,
  motus: checkMotus,
};

export function checkRound(round, given) {
  const fn = CHECKERS[round?.type];
  if (!fn) return { correct: false, ratio: 0, detail: {} };
  try {
    return fn(round, given || {});
  } catch (err) {
    console.error("quiz check error:", err.message);
    return { correct: false, ratio: 0, detail: {} };
  }
}

// Traduit le résultat d'une correction dans la forme qu'attend
// lib/quizScore.js. Les deux fichiers pourraient n'en faire qu'un ; ils sont
// séparés parce que le barème est MIROIRÉ CÔTÉ CLIENT (pour l'affichage des
// points en direct) alors que la correction, elle, ne doit jamais l'être.
export function toScoreInput(round, res) {
  switch (round.type) {
    case "qcm":
      return { choice: res.detail.choice };
    case "emoji":
    case "pixel":
    case "anagram":
      return { correct: res.correct, misses: res.detail.misses || 0 };
    case "motus":
      return { correct: res.correct, tries: res.detail.tries || 1 };
    case "studio":
      return { found: res.detail.found || 0 };
    case "duel":
      return { placed: res.detail.placed || 0 };
    case "swipe":
      return { good: res.detail.good || 0, bad: res.detail.bad || 0 };
    default:
      return {};
  }
}
