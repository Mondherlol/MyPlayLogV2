import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import { useTheme } from "../context/ThemeContext";

// Chargé à la demande (grosse lib) : n'alourdit pas le bundle initial.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

// Catégories du picker, libellées en français (valeurs = enum Categories).
const EMOJI_CATEGORIES = [
  { category: "suggested", name: "Récemment utilisés" },
  { category: "smileys_people", name: "Smileys & personnes" },
  { category: "animals_nature", name: "Animaux & nature" },
  { category: "food_drink", name: "Nourriture & boissons" },
  { category: "travel_places", name: "Voyages & lieux" },
  { category: "activities", name: "Activités" },
  { category: "objects", name: "Objets" },
  { category: "symbols", name: "Symboles" },
  { category: "flags", name: "Drapeaux" },
];

// Panneau émojis partagé (style Twitter, FR) — identique aux commentaires.
export default function EmojiPanel({ onPick, height = 360 }) {
  const { theme } = useTheme();
  return (
    <div className="lc-emoji-wrap">
      <Suspense
        fallback={
          <div className="lc-emoji-loading">
            <Loader2 size={18} className="spin" />
          </div>
        }
      >
        <EmojiPicker
          onEmojiClick={(d) => onPick(d.emoji)}
          emojiStyle="twitter"
          theme={theme === "dark" ? "dark" : "light"}
          categories={EMOJI_CATEGORIES}
          searchPlaceHolder="Rechercher un émoji…"
          previewConfig={{ showPreview: false }}
          lazyLoadEmojis
          width="100%"
          height={height}
        />
      </Suspense>
    </div>
  );
}
