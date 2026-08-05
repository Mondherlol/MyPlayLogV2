import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// ============================================================
//  Le canvas pixelisé
// ============================================================
// On réduit l'image à `blocks` pixels de large sur un canvas hors écran (le
// navigateur moyenne les couleurs, ce qui donne de vrais gros pixels propres),
// puis on la ré-étire SANS lissage. Avec `reveal`, on dessine l'image nette.
//
// Partagé par Pixel Rush (captures 16/9, carte d'accueil au format jaquette)
// et par la carte du jeu dans l'arcade. Les styles vivent dans
// styles/app-22-pixel.css (.px-canvas*).

// Résolution par défaut : le 16/9 des captures. L'image est dessinée dans le
// canvas puis étirée par le CSS — `w`/`h` ne font que fixer le CADRAGE.
const CV_W = 960;
const CV_H = 540;

export default function PixelCanvas({ src, blocks, reveal, label, w = CV_W, h = CV_H }) {
  const canvasRef = useRef(null);
  const offRef = useRef(null);
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    if (!cv || !img || !img.naturalWidth) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    // Cadrage « cover » : on garde le centre de l'image dans le format du canvas.
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;

    ctx.clearRect(0, 0, w, h);
    if (reveal) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return;
    }

    const bw = Math.max(4, Math.round(blocks));
    const bh = Math.max(3, Math.round((bw * h) / w));
    const off = (offRef.current ||= document.createElement("canvas"));
    off.width = bw;
    off.height = bh;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.imageSmoothingEnabled = true; // réduction lissée = moyenne des blocs
    octx.clearRect(0, 0, bw, bh);
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
    ctx.imageSmoothingEnabled = false; // agrandissement en gros carrés nets
    ctx.drawImage(off, 0, 0, bw, bh, 0, 0, w, h);
  }, [blocks, reveal, w, h]);

  useEffect(() => {
    setLoaded(false);
    imgRef.current = null;
    if (!src) return;
    const img = new Image();
    // Pas de lecture de pixels (getImageData) : le canvas « teinté » ne pose
    // aucun problème, on ne fait que dessiner.
    img.decoding = "async";
    let alive = true;
    img.onload = () => {
      if (!alive) return;
      imgRef.current = img;
      setLoaded(true);
    };
    img.src = src;
    return () => {
      alive = false;
      img.onload = null;
    };
  }, [src]);

  useEffect(() => {
    if (loaded) draw();
  }, [loaded, draw]);

  return (
    <div className="px-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        className={`px-canvas ${reveal ? "sharp" : ""}`}
        aria-label={label}
      />
      {!loaded && (
        <span className="px-canvas-loading" aria-hidden="true">
          <Loader2 size={26} className="spin" />
        </span>
      )}
    </div>
  );
}
