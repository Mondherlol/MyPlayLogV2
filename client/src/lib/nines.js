// ======================================================================
//  Le principe des 9 — les thèmes
// ======================================================================
// Neuf jeux sur un thème : « Ces 9 jeux de mon enfance », « Ces 9 jeux qui
// m'ont fait pleurer ». Le pendant du téléphone (myplaylog-mobile/src/lib/
// nines.js + components/nine/nineIcons.js) : mêmes clés, mêmes icônes, mêmes
// couleurs.
//
// ⚠️ LA CLÉ EST CE QUI VOYAGE, pas la phrase. Le serveur range la clé dans la
// liste (`nine`) pour compter qui a fait quel thème ; le titre est écrit une
// fois pour toutes à la création. Changer une phrase ici ne touche aucune
// liste existante — changer une clé, si.
import {
  Angry,
  Award,
  Castle,
  Droplet,
  FingerprintPattern,
  Gem,
  Ghost,
  HeartCrack,
  Hourglass,
  Music,
  PenLine,
  Skull,
  Sofa,
  Sparkles,
  ToyBrick,
  TreePalm,
  Users,
} from "lucide-react";

export const NINE_MAX = 9;
export const NINE_CUSTOM = "custom";
export const NINE_PREFIX = "Ces 9 jeux";

const GOLD = "#f2b70b";
const ORANGE = "#ff8a3d";
const BLUE = "#4aa8ff";
const GREEN = "#3dd68c";
const TEAL = "#2fc6c6";
const VIOLET = "#b57bff";
const ROSE = "#ff5470";

// L'ordre compte : d'abord ceux qu'on remplit sans réfléchir, les plus
// personnels ; les plus pointus ensuite.
// `card` : la phrase de la carte, le mot qui compte entre *étoiles* — il est
// écrit en énorme, dans la police du thème (`font`), penché de `rotate` degrés.
// `size` est sa taille maximale en pixels (cf. nineKeySize).
export const NINE_THEMES = [
  { key: "personality", short: "qui ont forgé ma personnalité", card: "jeux qui ont forgé ma *personnalité*", Icon: FingerprintPattern, color: GOLD, font: "'Playfair Display', serif", italic: true, size: 40, rotate: -4 },
  { key: "childhood", short: "de mon enfance", card: "jeux de mon *enfance*", Icon: ToyBrick, color: ORANGE, font: "'Press Start 2P', monospace", size: 22, rotate: -3 },
  { key: "cried", short: "qui m'ont fait pleurer", card: "jeux qui m'ont fait *pleurer*", Icon: Droplet, color: BLUE, font: "'Caveat', cursive", size: 54, rotate: -6 },
  { key: "island", short: "que j'emporterais sur une île déserte", card: "jeux pour une *île déserte*", Icon: TreePalm, color: GREEN, font: "'Pacifico', cursive", size: 38, rotate: -5 },
  { key: "mustplay", short: "que tout le monde devrait faire", card: "jeux que *tout le monde* devrait faire", Icon: Award, color: GOLD, font: "'Anton', sans-serif", upper: true, size: 40, rotate: -2 },
  { key: "comfort", short: "que je relance sans jamais me lasser", card: "jeux que je relance *sans me lasser*", Icon: Sofa, color: VIOLET, font: "'Fredoka', sans-serif", size: 34, rotate: 3 },
  { key: "underrated", short: "sous-cotés que personne ne connaît", card: "jeux *sous-cotés* que personne ne connaît", Icon: Gem, color: TEAL, font: "'Permanent Marker', cursive", size: 34, rotate: -4 },
  { key: "soundtrack", short: "aux bandes-son inoubliables", card: "jeux aux *bandes-son* inoubliables", Icon: Music, color: VIOLET, font: "'Playfair Display', serif", italic: true, size: 38, rotate: -3 },
  { key: "firsttime", short: "que j'aimerais oublier pour les redécouvrir", card: "jeux à *oublier* pour les redécouvrir", Icon: Sparkles, color: BLUE, font: "'Caveat', cursive", size: 54, rotate: 4 },
  { key: "scared", short: "qui m'ont fait peur", card: "jeux qui m'ont fait *peur*", Icon: Ghost, color: VIOLET, font: "'Creepster', cursive", size: 54, rotate: -3 },
  { key: "worlds", short: "aux univers où j'aimerais vivre", card: "jeux aux *univers* où j'aimerais vivre", Icon: Castle, color: GREEN, font: "'Cinzel', serif", upper: true, size: 30, rotate: -2 },
  { key: "villains", short: "aux méchants inoubliables", card: "jeux aux *méchants* inoubliables", Icon: Skull, color: ROSE, font: "'Bangers', cursive", size: 46, rotate: -5 },
  { key: "coop", short: "à faire entre potes", card: "jeux à faire *entre potes*", Icon: Users, color: ORANGE, font: "'Fredoka', sans-serif", size: 38, rotate: -3 },
  { key: "rage", short: "qui m'ont fait rager", card: "jeux qui m'ont fait *rager*", Icon: Angry, color: ROSE, font: "'Anton', sans-serif", upper: true, size: 58, rotate: -7 },
  { key: "hours", short: "où j'ai englouti le plus d'heures", card: "jeux où j'ai englouti des *heures*", Icon: Hourglass, color: GOLD, font: "'Bungee', sans-serif", size: 34, rotate: -3 },
  { key: "disappointed", short: "qui n'ont pas tenu leurs promesses", card: "jeux qui n'ont pas tenu leurs *promesses*", Icon: HeartCrack, color: ROSE, font: "'Playfair Display', serif", italic: true, strike: true, size: 36, rotate: -2 },
];

const CUSTOM_META = {
  key: NINE_CUSTOM,
  short: "",
  card: "Invente *ton* thème",
  Icon: PenLine,
  color: GOLD,
  font: "'Caveat', cursive",
  size: 54,
  rotate: -5,
};

// Les polices des cartes, chargées à la demande (cf. home/NineRail) : elles ne
// servent qu'ici, inutile de les faire payer à toutes les pages.
export const NINE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Anton&family=Bangers&family=Bungee&family=Caveat:wght@700&family=Cinzel:wght@700&family=Creepster&family=Fredoka:wght@700&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:ital,wght@1,700&family=Press+Start+2P&display=swap";

/** « jeux qui ont forgé ma *personnalité* » → morceaux, le mot-clé marqué. */
export function nineSegments(phrase) {
  return String(phrase || "")
    .split("*")
    .map((text, i) => ({ text: text.trim(), hi: i % 2 === 1 }))
    .filter((s) => s.text);
}

// Le mot-clé se mesure pour de vrai, dans sa police, sur un canvas : une
// estimation « par caractère » laissait « personnalité » deux fois trop petit
// et faisait déborder « promesses ».
let ctx = null;
function textWidth(meta, text, px) {
  ctx ||= document.createElement("canvas").getContext("2d");
  ctx.font = `${meta.italic ? "italic " : ""}700 ${px}px ${meta.font}`;
  return ctx.measureText(meta.upper ? text.toUpperCase() : text).width;
}

/**
 * Où couper un mot long en deux lignes, façon affiche : à son trait d'union
 * (« sous- / cotés »), sinon entre deux consonnes doublées au plus près du
 * milieu (« person- / nalité », « promes- / ses »). `null` : on ne coupe pas.
 */
export function splitWord(word) {
  const dash = word.indexOf("-");
  if (dash > 1 && dash < word.length - 2) return [word.slice(0, dash + 1), word.slice(dash + 1)];
  if (word.length < 9) return null;
  let best = null;
  for (let i = 3; i <= word.length - 3; i++) {
    if (word[i] === word[i - 1] && !/[aeiouyéèêàâîïôûü]/i.test(word[i])) {
      if (best === null || Math.abs(i - word.length / 2) < Math.abs(best - word.length / 2)) best = i;
    }
  }
  return best === null ? null : [word.slice(0, best) + "-", word.slice(best)];
}

/**
 * Le mot-clé mis en page pour remplir `inner` pixels de large : plusieurs mots
 * en deux lignes équilibrées, un mot long coupé en deux s'il y gagne nettement
 * en taille. La taille est plafonnée à `meta.size`, pour qu'un mot court
 * (« ton », « peur ») ne mange pas la carte. Rend `{ size, lines }`.
 */
export function nineKeyLayout(meta, text, inner, cap = meta.size) {
  const words = text.split(/\s+/);
  const widthOf = (lines) => Math.max(...lines.map((l) => textWidth(meta, l, 100)));
  let lines = [text];
  let widest = widthOf(lines);
  // ⚠️ SUR UNE LIGNE DÈS QUE ÇA TIENT À TAILLE PLEINE. Couper ne sert qu'à
  // grossir un mot trop large ; quand la taille est de toute façon plafonnée,
  // « TOUT LE / MONDE » revenait à la ligne avec toute la place à côté.
  if ((widest * cap) / 100 <= inner * 0.94) return { size: Math.floor(cap), lines };
  for (let i = 1; i < words.length; i++) {
    const cand = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = widthOf(cand);
    if (w < widest) {
      widest = w;
      lines = cand;
    }
  }
  if (words.length === 1) {
    const cut = splitWord(text);
    // Couper un mot se paie en lisibilité : seulement s'il y gagne un tiers.
    if (cut && widthOf(cut) < widest * 0.75) {
      widest = widthOf(cut);
      lines = cut;
    }
  }
  // 0.94 : la place de l'inclinaison et du surlignage qui déborde.
  return { size: Math.floor(Math.min(cap, (inner * 0.94 * 100) / widest)), lines };
}

/** La fin de phrase d'une liste au thème inventé (« qui m'ont appris l'anglais »). */
export const nineEnding = (title) =>
  String(title || "").replace(/^\s*Ces\s+9\s+jeux\s*/i, "").trim();

export const nineTheme = (key) => NINE_THEMES.find((t) => t.key === key) || CUSTOM_META;

/** Le titre complet d'un thème, tel qu'il sera écrit sur la liste. */
export const nineTitle = (key) => `${NINE_PREFIX} ${nineTheme(key).short}`;
