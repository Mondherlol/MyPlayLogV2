import { MousePointer2, Frame, Award, HelpCircle } from "lucide-react";

// Visuel d'un lot, quelle que soit sa famille. C'est le SEUL endroit qui sait
// comment dessiner un `type` donné : pour ajouter une famille de lots, il
// suffit d'ajouter son cas ici (et son entrée dans lib/rarity.js).
const FALLBACK_ICON = {
  cursor: MousePointer2,
  ornament: Frame,
  badge: Award,
};

export default function RewardArt({ reward, size = 56 }) {
  const url = reward?.data?.url;
  if (url) {
    return (
      <img
        className="rw-art-img"
        src={url}
        alt=""
        draggable="false"
        loading="lazy"
        style={{ maxWidth: size, maxHeight: size }}
      />
    );
  }
  // Pas d'image (badge purement iconographique, ou lot mal configuré) :
  // l'icône de sa famille fait un repli honnête.
  const Icon = FALLBACK_ICON[reward?.type] || HelpCircle;
  return <Icon size={Math.round(size * 0.6)} className="rw-art-fallback" />;
}
