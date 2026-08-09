// ======================================================================
//  Le barème du Grand Quiz
// ======================================================================
// Les trois autres mini-jeux ont un barème d'une ligne (une bonne réponse,
// plus ou moins vite). Ici, huit épreuves qui ne se réussissent pas de la même
// façon : on trouve un QCM ou on ne le trouve pas, mais on place trois cartes
// sur quatre dans un duel et on classe dix-sept jeux sur vingt-trois en trente
// secondes de swipe.
//
// D'où deux notions au lieu d'une :
//   • `correct` — la réussite PLEINE (le QCM juste, les 4 cartes bien placées,
//     les 3 jeux du studio trouvés). C'est ce que compte le « 5/8 » du récap.
//   • `ratio`   — la part réussie, de 0 à 1. C'est ce qui paie.
//
// -------------------------------------------------------------- l'équilibrage
// UNE MANCHE PARFAITE VAUT ~85 POINTS, quelle que soit l'épreuve. Une partie
// de douze manches sans faute plafonne donc autour de 1000, et une bonne partie
// tourne entre 400 et 700.
//
// Le premier jeu de valeurs était dix fois trop généreux (une partie ordinaire
// rapportait 3000 points). Ça cassait deux choses : l'économie de l'arcade, où
// une seule partie payait plusieurs caisses, et la comparaison avec les trois
// autres mini-jeux, dont les scores tiennent dans le même ordre de grandeur.
//
// Le plafond commun n'est pas cosmétique. Une partie enchaîne des épreuves
// tirées au hasard : si le duel rapportait le double du QCM, deux joueurs
// n'auraient pas joué la même partie et le classement ne comparerait plus rien.
// Les écarts qui subsistent (quelques points) reflètent la difficulté réelle,
// pas une hiérarchie entre les épreuves.
export const ROUND_MAX = 85;
//
// La part de vitesse est plus faible sur les épreuves longues (duel, studio,
// swipe) : y courir après le chrono n'a pas de sens quand la manche consiste
// justement à réfléchir posément.

// Fraction de temps restant, bornée : 1 = instantané, 0 = à la sonnerie.
export function speedFrac(timeMs, durationSec) {
  const dur = Math.max(1, durationSec) * 1000;
  if (timeMs == null) return 0;
  const t = Math.min(Math.max(timeMs, 0), dur);
  return (dur - t) / dur;
}

// Malus d'essais ratés sur les épreuves à saisie libre (emoji, pixel, anagramme) :
// trouver du premier coup vaut plein pot, ensuite ça descend vite. Miroir de
// MISS_FACTOR du versus de Pixel Rush, pour que les deux se ressemblent.
const MISS_FACTOR = [1, 0.7, 0.4];

// Le facteur du Motus, un cran par essai. Il descend moins brutalement que
// MISS_FACTOR : cinq essais font partie du jeu, ce ne sont pas cinq échecs.
// Trouver au dernier coup reste honorable et doit rester payant.
const MOTUS_LADDER = [1, 0.86, 0.72, 0.58, 0.45];
export const missFactor = (m) =>
  MISS_FACTOR[Math.min(Math.max(m || 0, 0), MISS_FACTOR.length - 1)];

// ------------------------------------------------------------------ le calcul
// `given` a la forme propre à chaque épreuve — voir chaque branche. Renvoie
// TOUJOURS { correct, ratio, points } : c'est le seul contrat que connaissent
// la route solo, la route versus et le miroir client.
export function scoreRound(round, given, timeMs) {
  const dur = round.durationSec || 20;
  const frac = speedFrac(timeMs, dur);
  const misses = Math.max(0, Number(given?.misses) || 0);

  switch (round.type) {
    // ---------------------------------------------------------------- QCM
    // Tout ou rien, et la vitesse compte beaucoup : sur une question à quatre
    // propositions, hésiter vingt secondes ou répondre en deux, ce n'est pas
    // le même niveau de connaissance.
    case "qcm": {
      const correct = Number(given?.choice) === Number(round.answerIndex);
      if (!correct) return { correct: false, ratio: 0, points: 0 };
      return { correct: true, ratio: 1, points: 30 + Math.round(55 * frac) };
    }

    // -------------------------------------------------------------- EMOJIS
    // Saisie libre : la vitesse compte, les essais ratés coûtent.
    case "emoji": {
      const correct = !!given?.correct;
      if (!correct) return { correct: false, ratio: 0, points: 0 };
      const raw = 32 + Math.round(53 * frac);
      return { correct: true, ratio: 1, points: Math.round(raw * missFactor(misses)) };
    }

    // -------------------------------------------------------------- STUDIO
    // Trois jeux à trouver. Chacun paie, et le triplé décroche un bonus : sans
    // lui, l'épreuve se jouerait à « j'en donne un, je passe ».
    case "studio": {
      const need = round.need || 3;
      const found = Math.min(Number(given?.found) || 0, need);
      const ratio = need ? found / need : 0;
      if (!found) return { correct: false, ratio: 0, points: 0 };
      const base = 22 * found;
      const bonus = found >= need ? 12 + Math.round(7 * frac) : 0;
      return { correct: found >= need, ratio, points: base + bonus };
    }

    // ---------------------------------------------------------------- DUEL
    // Une carte bien déposée paie ; le sans-faute décroche un bonus. Une carte
    // mal placée ne coûte rien de plus que le point qu'elle ne rapporte pas :
    // l'épreuve se joue à la déduction, punir l'essai découragerait le seul
    // raisonnement qui la rend intéressante.
    case "duel": {
      const total = round.cards?.length || 0;
      const ok = Math.min(Number(given?.placed) || 0, total);
      const ratio = total ? ok / total : 0;
      const base = Math.round((65 * ok) / Math.max(1, total));
      const bonus = total && ok === total ? 10 + Math.round(10 * frac) : 0;
      return { correct: total > 0 && ok === total, ratio, points: base + bonus };
    }

    // --------------------------------------------------------------- PIXEL
    case "pixel": {
      const correct = !!given?.correct;
      if (!correct) return { correct: false, ratio: 0, points: 0 };
      return { correct: true, ratio: 1, points: 32 + Math.round(53 * frac) };
    }

    // --------------------------------------------------------------- SWIPE
    // Trente secondes, une pile, une seule question. Ici la vitesse n'entre
    // PAS dans la formule : elle est déjà dans le nombre de cartes traitées.
    // Une pile de 24 entièrement bien triée vaut 84 — le plafond commun.
    // Une erreur coûte, sinon la stratégie gagnante serait de balayer la pile
    // au hasard le plus vite possible.
    case "swipe": {
      const good = Math.max(0, Number(given?.good) || 0);
      const bad = Math.max(0, Number(given?.bad) || 0);
      const seen = good + bad;
      const ratio = seen ? good / seen : 0;
      const points = Math.max(0, Math.round(3.5 * good - 2 * bad));
      // « Réussie » = au moins huit bonnes et pas plus d'un quart d'erreurs.
      return { correct: good >= 8 && ratio >= 0.75, ratio, points };
    }

    // ----------------------------------------------------------- ANAGRAMME
    // Même barème que les emojis : une saisie libre, la vitesse compte, les
    // essais ratés coûtent.
    case "anagram": {
      const correct = !!given?.correct;
      if (!correct) return { correct: false, ratio: 0, points: 0 };
      const raw = 32 + Math.round(53 * frac);
      return { correct: true, ratio: 1, points: Math.round(raw * missFactor(misses)) };
    }

    // --------------------------------------------------------------- MOTUS
    // C'est le NOMBRE D'ESSAIS qui paie, pas le chrono. Trouver en deux coups
    // relève de la déduction ; trouver en cinq relève de l'élimination. La
    // vitesse n'entre que pour une petite part — l'épreuve se joue en
    // réfléchissant devant sa grille, la presser n'aurait pas de sens.
    case "motus": {
      const correct = !!given?.correct;
      if (!correct) return { correct: false, ratio: 0, points: 0 };
      const tries = Math.max(1, Math.min(Number(given?.tries) || 1, MOTUS_LADDER.length));
      const raw = 60 + Math.round(25 * frac);
      return { correct: true, ratio: 1, points: Math.round(raw * MOTUS_LADDER[tries - 1]) };
    }

    default:
      return { correct: false, ratio: 0, points: 0 };
  }
}

// ============================================================
//  Le barème du versus
// ============================================================
// Deux régimes, comme dans models/QuizVersus.js :
//
//   • BUZZER (qcm, emoji, pixel, anagramme, motus) — le premier bon rafle la
//     manche. Même
//     enveloppe que Pixel Rush versus, pour que les deux modes se vaillent à
//     la cagnotte. Les suivants ne marquent rien : c'est ce qui fait le sel du
//     buzzer, et c'est déjà la règle des trois autres salons.
//   • PARALLÈLE (studio, duel, swipe) — tout le monde joue la manche entière
//     et marque au prorata. On y ajoute une prime au meilleur de la manche,
//     sinon une épreuve parallèle rapporterait moins qu'un buzzer gagné et
//     personne ne voudrait les voir tomber.
// Mêmes ordres de grandeur qu'en solo : une manche gagnée au buzzer vaut
// ~85 points, une manche parallèle parfaite ~85 avec la prime. Sans cet
// alignement, jouer à plusieurs rapporterait dix fois plus que jouer seul.
export const BUZZER_POINTS = 55;
export const BUZZER_SPEED = 30;
export const PARALLEL_MAX = 65;
export const PARALLEL_BEST_BONUS = 20;

export function scoreVersusBuzzer(atMs, durationSec, misses) {
  const frac = speedFrac(atMs, durationSec);
  return Math.round((BUZZER_POINTS + BUZZER_SPEED * frac) * missFactor(misses));
}

export function scoreVersusParallel(ratio) {
  return Math.round(PARALLEL_MAX * Math.max(0, Math.min(1, ratio || 0)));
}

// Série de bonnes réponses : le multiplicateur du plateau. Plafonné à +50 % —
// au-delà, un joueur en forme creuse un écart que personne ne rattrape, et les
// quatre dernières manches ne servent plus à rien.
export function streakMult(streak) {
  return 1 + Math.min(Math.max(streak - 1, 0), 5) * 0.1;
}
