import { Disc3 } from "lucide-react";

// ======================================================================
// Pochette générée & personnalisable — rendu partagé (card, disque, éditeur).
// Une pochette = un objet `design` : fond (dégradé/uni), motif, titre et une
// liste d'« éléments » (images posées : avatar, artworks de pistes, jaquettes).
// Le même composant sert partout pour garantir un rendu identique (WYSIWYG).
// ======================================================================

// Teinte déterministe tirée du titre : couleur stable et unique par playlist.
export function titleHue(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

// hsl(0-360, %, %) → hex, pour alimenter les <input type="color"> par défaut.
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export const MOTIFS = ["none", "rings", "dots", "stripes", "grid"];
export const SHAPES = ["circle", "rounded", "square"];
export const SHAPE_RADIUS = { circle: "50%", rounded: "16%", square: "3%" };

// Quelques dégradés prêts à l'emploi pour l'éditeur.
export const BG_PRESETS = [
  ["#f2b70b", "#b26a00"],
  ["#e0559c", "#5b2a86"],
  ["#3dd68c", "#146b5a"],
  ["#4aa8ff", "#1f3a8a"],
  ["#ff5470", "#7a1f3d"],
  ["#20242e", "#0b0d12"],
];

// Pochette par défaut (le look « généré » d'origine), dérivée du titre.
export function defaultCoverDesign(title = "") {
  const h = titleHue(title);
  return {
    bg1: hslToHex(h, 62, 47),
    bg2: hslToHex((h + 42) % 360, 56, 30),
    angle: 150,
    motif: "rings",
    motifOpacity: 1,
    titleShow: true,
    titlePos: "center",
    titleColor: "#ffffff",
    mark: true,
    elements: [],
  };
}

// Style de position d'un élément posé (coordonnées normalisées 0→1, centre).
export function coverElementStyle(el) {
  return {
    left: `${(el.x ?? 0.5) * 100}%`,
    top: `${(el.y ?? 0.5) * 100}%`,
    width: `${(el.size ?? 0.3) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${el.rot || 0}deg)`,
  };
}

export function coverBackground(d) {
  return !d.bg2 || d.bg1 === d.bg2
    ? d.bg1
    : `linear-gradient(${d.angle ?? 150}deg, ${d.bg1}, ${d.bg2} 82%)`;
}

// Rendu d'une pochette. `hideElements` sert à l'éditeur, qui superpose sa
// propre couche interactive d'éléments par-dessus le fond.
export default function CoverArt({ design, title = "", className = "", hideElements = false }) {
  const d = design || defaultCoverDesign(title);
  return (
    <span className={`cvr ${className}`} style={{ background: coverBackground(d) }}>
      {d.motif && d.motif !== "none" && (
        <span
          className={`cvr-motif m-${d.motif}`}
          style={{ opacity: d.motifOpacity ?? 1 }}
          aria-hidden="true"
        />
      )}
      {d.mark !== false && (
        <span className="cvr-mark" aria-hidden="true">
          <Disc3 />
        </span>
      )}
      {!hideElements &&
        (d.elements || []).map((el, i) => (
          <span key={i} className="cvr-el" style={coverElementStyle(el)}>
            <img
              src={el.src}
              alt=""
              draggable="false"
              style={{ borderRadius: SHAPE_RADIUS[el.shape] || SHAPE_RADIUS.rounded }}
            />
          </span>
        ))}
      {d.titleShow !== false && title && (
        <span
          className={`cvr-title pos-${d.titlePos || "center"}`}
          style={{ color: d.titleColor || "#fff" }}
        >
          {title}
        </span>
      )}
    </span>
  );
}
