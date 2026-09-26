// ======================================================================
//  Les grilles « un jeu par case » — Ma carte de joueur
// ======================================================================
// Le pendant de server/lib/boards.js : mêmes clés de cases, dans le même
// ordre. Ici vivent ce que le serveur n'a pas besoin de connaître — le libellé
// de chaque case et son icône.
//
// ⚠️ LA CLÉ EST CE QUI VOYAGE. Reformuler un libellé ne touche aucune grille
// publiée ; changer une clé les vide de cette case.
import {
  Award,
  BookOpen,
  EyeOff,
  Gamepad2,
  Gem,
  Globe,
  Heart,
  Music,
  Palette,
  RefreshCw,
  Shield,
  Shuffle,
  Skull,
  Sofa,
  Sparkles,
  Swords,
  ToyBrick,
  TrendingDown,
  User,
  Users,
} from "lucide-react";

export const BOARDS = {
  gamer: {
    key: "gamer",
    title: "Ma carte de joueur",
    // `char` : la case prend aussi un personnage du jeu, en médaillon.
    slots: [
      { key: "favorite", label: "Mon jeu préféré", Icon: Heart },
      { key: "story", label: "Meilleure histoire", Icon: BookOpen },
      { key: "art", label: "Plus belle direction artistique", Icon: Palette },
      { key: "impact", label: "Le plus marquant pour moi", Icon: Sparkles },
      { key: "combat", label: "Meilleurs combats", Icon: Swords },
      { key: "overhated", label: "Injustement détesté", Icon: Shield },
      { key: "underrated", label: "Sous-coté", Icon: Gem },
      { key: "overrated", label: "Surcoté", Icon: TrendingDown },
      { key: "remake", label: "Mérite un remake", Icon: RefreshCw },
      { key: "overlooked", label: "Passé inaperçu", Icon: EyeOff },
      { key: "protagonist", label: "Protagoniste préféré", Icon: User, char: "Choisis le héros" },
      { key: "antagonist", label: "Antagoniste préféré", Icon: Skull, char: "Choisis le méchant" },
      { key: "soundtrack", label: "Meilleure bande-son", Icon: Music },
      { key: "multiplayer", label: "Meilleur multijoueur", Icon: Globe },
      { key: "notmything", label: "Pas mon style, mais…", Icon: Shuffle },
      { key: "brainoff", label: "Pour débrancher le cerveau", Icon: Sofa },
      { key: "friends", label: "À faire entre potes", Icon: Users },
      { key: "retro", label: "Meilleur jeu rétro", Icon: Gamepad2 },
      { key: "nostalgia", label: "Nostalgie d'enfance", Icon: ToyBrick },
      { key: "everyone", label: "Tout le monde devrait y jouer", Icon: Award },
    ],
  },
};

export const DEFAULT_BOARD = "gamer";

export const boardOf = (key) => BOARDS[key] || BOARDS[DEFAULT_BOARD];

export const boardSlot = (board, slot) =>
  boardOf(board).slots.find((s) => s.key === slot) || null;

/** Les éléments d'une liste rangés par case : `{ [slot]: item }`. */
export function itemsBySlot(items) {
  const out = {};
  for (const it of items || []) if (it.slot) out[it.slot] = it;
  return out;
}
