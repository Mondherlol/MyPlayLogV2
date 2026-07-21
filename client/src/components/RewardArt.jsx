import { useEffect, useState } from "react";
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
  const data = reward?.data || {};
  const animated =
    !!data.animated && Array.isArray(data.frames) && data.frames.length > 1;

  // Curseur animé (.ani) : on rejoue la séquence en cyclant l'image.
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!animated) return;
    setI(0);
    let idx = 0;
    let timer;
    const durs = data.durationsMs || [];
    const tick = () => {
      idx = (idx + 1) % data.frames.length;
      setI(idx);
      timer = setTimeout(tick, Math.max(16, durs[idx] || 100));
    };
    timer = setTimeout(tick, Math.max(16, durs[0] || 100));
    return () => clearTimeout(timer);
  }, [animated, data.frames, data.durationsMs]);

  const url = animated ? data.frames[i] : data.url;
  if (url) {
    return (
      <img
        className="rw-art-img"
        src={url}
        alt=""
        draggable="false"
        loading="lazy"
        style={{
          // Boîte carrée FIXE (et non un simple plafond) : les sources vont du
          // 32×32 au 350×350, donc borner par max-width donnerait des vignettes
          // de tailles très différentes. `object-fit: contain` (feuille de
          // style) met chaque visuel à l'échelle et le centre dans cette boîte.
          width: size,
          height: size,
          // Curseurs : rendu net (pixel art nostalgique) plutôt que lissé.
          imageRendering: reward?.type === "cursor" ? "pixelated" : undefined,
        }}
      />
    );
  }
  // Pas d'image (badge purement iconographique, ou lot mal configuré) :
  // l'icône de sa famille fait un repli honnête, dans la même boîte.
  const Icon = FALLBACK_ICON[reward?.type] || HelpCircle;
  return (
    <span className="rw-art-fallback" style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.6)} />
    </span>
  );
}
