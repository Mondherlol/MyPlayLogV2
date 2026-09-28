// ======================================================================
//  Combats de cartes — l'habillage (icônes des objectifs)
// ======================================================================
// Les règles vivent côté serveur (server/src/lib/cardBattle.js) : ici, rien
// que ce qu'il faut pour DESSINER une partie.
import {
  CalendarClock,
  CalendarRange,
  Hourglass,
  Sparkles,
  Lock,
  WandSparkles,
  Rocket,
  Skull,
  Landmark,
  Globe,
  Tent,
  Search,
  Swords,
  Laugh,
  EyeOff,
  Box,
  PartyPopper,
  Users,
  Handshake,
  Columns2,
  Eye,
  MoveHorizontal,
  Map as MapIcon,
  Hash,
  Joystick,
  Smartphone,
} from "lucide-react";
import { platformBrand } from "../../../lib/platformIcons";

// Un logo de console, teinté par la couleur du texte.
export function BrandGlyph({ name, className = "" }) {
  const b = platformBrand(name);
  if (!b) return null;
  return (
    <svg className={className} viewBox={b.viewBox} fill="currentColor" aria-hidden="true">
      <path d={b.d} />
    </svg>
  );
}

const THEME_ICONS = {
  17: WandSparkles,
  18: Rocket,
  19: Skull,
  22: Landmark,
  38: Globe,
  21: Tent,
  43: Search,
  39: Swords,
  27: Laugh,
  23: EyeOff,
  33: Box,
  40: PartyPopper,
};
const MODE_ICONS = { 2: Users, 3: Handshake, 4: Columns2 };
const PERSP_ICONS = { 1: Eye, 4: MoveHorizontal, 3: MapIcon };
const FAMILY_BRANDS = {
  nintendo: "nintendo",
  playstation: "playstation",
  xbox: "xbox",
  pc: "windows",
  sega: "sega",
};

// Les objectifs qui se jouent « au plus près » (année) plutôt qu'en oui/non.
export const isYearKind = (kind) => kind === "year" || kind === "oldest" || kind === "newest";

/** L'icône d'un objectif (type : sa pastille est dessinée à part). */
export function ObjectiveIcon({ o, className = "" }) {
  if (!o) return null;
  let Icon = null;
  switch (o.kind) {
    case "year":
      Icon = CalendarClock;
      break;
    case "era":
      Icon = CalendarRange;
      break;
    case "oldest":
      Icon = Hourglass;
      break;
    case "newest":
      Icon = Sparkles;
      break;
    case "exclu":
      Icon = Lock;
      break;
    case "platform":
      if (FAMILY_BRANDS[o.fam]) return <BrandGlyph name={FAMILY_BRANDS[o.fam]} className={className} />;
      Icon = o.fam === "mobile" ? Smartphone : Joystick;
      break;
    case "theme":
      Icon = THEME_ICONS[o.id] || Sparkles;
      break;
    case "mode":
      Icon = MODE_ICONS[o.id] || Users;
      break;
    case "persp":
      Icon = PERSP_ICONS[o.id] || Eye;
      break;
    case "tag":
      Icon = Hash;
      break;
    default:
      return null;
  }
  return <Icon className={className} strokeWidth={2.4} />;
}

export const other = (side) => (side === "you" ? "bot" : "you");
