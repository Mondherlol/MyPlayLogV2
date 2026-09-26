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

/**
 * Ouvre SA carte : la retrouve, ou la crée vide puis l'ouvre.
 *
 * ⚠️ PAS DE FENÊTRE DE CRÉATION. La carte se remplit directement sur sa page,
 * case par case, et chaque choix est enregistré aussitôt : fermer une fenêtre
 * par mégarde ne fait plus rien perdre. La créer vide d'entrée, c'est ce qui
 * rend ça possible — il faut un id pour enregistrer la première case.
 */
export async function openMyBoard({ token, navigate, apiFetch, boardKey = DEFAULT_BOARD }) {
  const board = boardOf(boardKey);
  try {
    const d = await apiFetch(`/lists?scope=mine&board=${board.key}&limit=1`, { token });
    if (d.lists?.[0]) return navigate(`/lists/${d.lists[0].id}`);
    const res = await apiFetch("/lists", {
      method: "POST",
      token,
      body: { title: board.title, board: board.key, type: "classic", itemKind: "game", items: [] },
    });
    navigate(`/lists/${res.list.id}`);
  } catch (err) {
    // Créée entre-temps (autre onglet) : le serveur donne son id.
    if (err.status === 409 && err.data?.id) navigate(`/lists/${err.data.id}`);
    else alert(err.message || "Impossible d'ouvrir ta carte.");
  }
}
