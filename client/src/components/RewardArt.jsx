import { useEffect, useState } from "react";
import { MousePointer2, Frame, Award, Palette, HelpCircle } from "lucide-react";

// Visuel d'un lot, quelle que soit sa famille. C'est le SEUL endroit qui sait
// comment dessiner un `type` donné : pour ajouter une famille de lots, il
// suffit d'ajouter son cas ici (et son entrée dans lib/rarity.js).
const FALLBACK_ICON = {
  cursor: MousePointer2,
  ornament: Frame,
  badge: Award,
  theme: Palette,
};

// Aperçu d'un thème : un mini-écran de l'app (barre latérale + carte + accent).
// Donne l'ambiance d'un coup d'œil, sans image. Fonctionne du 40px au 76px.
function ThemeSwatch({ data, size }) {
  const s = data?.swatch || {};
  const v = data?.vars || {};
  const bg = s.bg || v["--bg"] || "#111";
  const surface = s.surface || v["--surface"] || bg;
  const accent = s.accent || v["--orange"] || "#f2b70b";
  const accent2 = s.accent2 || accent;
  const text = s.text || v["--text"] || "#fff";
  const side = s.side || v["--side-bg"] || surface;
  return (
    <span
      className="rw-theme-swatch"
      style={{ width: size, height: size, background: bg }}
      aria-hidden="true"
    >
      <span className="rw-theme-side" style={{ background: side }} />
      <span className="rw-theme-card" style={{ background: surface }}>
        <span className="rw-theme-line" style={{ background: text, opacity: 0.75 }} />
        <span
          className="rw-theme-pill"
          style={{ background: `linear-gradient(120deg, ${accent2}, ${accent})` }}
        />
      </span>
    </span>
  );
}

export default function RewardArt({ reward, size = 56 }) {
  const data = reward?.data || {};
  const animated =
    !!data.animated && Array.isArray(data.frames) && data.frames.length > 1;

  // Thème : pas d'image, on peint une vignette de la palette.
  if (reward?.type === "theme") return <ThemeSwatch data={data} size={size} />;

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
