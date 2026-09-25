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
export const NINE_THEMES = [
  { key: "personality", short: "qui ont forgé ma personnalité", Icon: FingerprintPattern, color: GOLD },
  { key: "childhood", short: "de mon enfance", Icon: ToyBrick, color: ORANGE },
  { key: "cried", short: "qui m'ont fait pleurer", Icon: Droplet, color: BLUE },
  { key: "island", short: "que j'emporterais sur une île déserte", Icon: TreePalm, color: GREEN },
  { key: "mustplay", short: "que tout le monde devrait faire", Icon: Award, color: GOLD },
  { key: "comfort", short: "que je relance sans jamais me lasser", Icon: Sofa, color: VIOLET },
  { key: "underrated", short: "sous-cotés que personne ne connaît", Icon: Gem, color: TEAL },
  { key: "soundtrack", short: "aux bandes-son inoubliables", Icon: Music, color: VIOLET },
  { key: "firsttime", short: "que j'aimerais oublier pour les redécouvrir", Icon: Sparkles, color: BLUE },
  { key: "scared", short: "qui m'ont fait peur", Icon: Ghost, color: VIOLET },
  { key: "worlds", short: "aux univers où j'aimerais vivre", Icon: Castle, color: GREEN },
  { key: "villains", short: "aux méchants inoubliables", Icon: Skull, color: ROSE },
  { key: "coop", short: "à faire entre potes", Icon: Users, color: ORANGE },
  { key: "rage", short: "qui m'ont fait rager", Icon: Angry, color: ROSE },
  { key: "hours", short: "où j'ai englouti le plus d'heures", Icon: Hourglass, color: GOLD },
  { key: "disappointed", short: "qui n'ont pas tenu leurs promesses", Icon: HeartCrack, color: ROSE },
];

const CUSTOM_META = { key: NINE_CUSTOM, short: "", Icon: PenLine, color: GOLD };

export const nineTheme = (key) => NINE_THEMES.find((t) => t.key === key) || CUSTOM_META;

/** Le titre complet d'un thème, tel qu'il sera écrit sur la liste. */
export const nineTitle = (key) => `${NINE_PREFIX} ${nineTheme(key).short}`;
