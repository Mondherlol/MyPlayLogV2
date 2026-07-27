import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw, Check, X, Move } from "lucide-react";
import { BOX, loadImage } from "../lib/collection";

// ======================================================================
//  Alignement d'une jaquette dépliée
// ======================================================================
// Une jaquette trouvée en ligne est rarement d'équerre : scannée de travers,
// rognée trop court, ou avec la tranche décalée de quelques pour cent. Or c'est
// la tranche qui compte — c'est la seule face visible quand les boîtiers sont
// rangés, et un décalage de 1 % s'y voit comme un défaut d'impression.
//
// Cet outil ne « recadre » donc pas au sens habituel : il pose l'image dans un
// gabarit aux proportions EXACTES du boîtier, avec les deux traits de pliage
// affichés là où ils tomberont vraiment. On déplace, on zoome, on redresse
// jusqu'à ce que la tranche se glisse entre les deux traits.
//
// Le rendu final est refait dans un canvas à la taille cible et renvoyé en
// fichier : le serveur reçoit une image déjà alignée, et le découpage en trois
// faces (lib/collection.js) tombe juste sans réglage supplémentaire.

const OUT_W = 1825; // largeur de sortie (mêmes proportions que le boîtier)

export default function WrapCropModal({ src, onCancel, onApply }) {
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [angle, setAngle] = useState(0); // degrés
  const [pan, setPan] = useState({ x: 0, y: 0 }); // en fraction de la largeur
  const frameRef = useRef(null);
  const drag = useRef(null);

  // Proportions du boîtier déplié : dos + tranche + couverture.
  const geom = useMemo(() => {
    const total = BOX.dvd.d * 2 + BOX.dvd.w;
    return {
      ratio: total / BOX.dvd.h,
      foldA: (BOX.dvd.d / total) * 100,
      foldB: ((BOX.dvd.d + BOX.dvd.w) / total) * 100,
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadImage(src).then((i) => {
      if (!alive) return;
      if (i) setImg(i);
      else setError("Image illisible (ou refusée par son hébergeur).");
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // --- Déplacement à la souris ---
  function onPointerDown(e) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, w: rect.width, start: { ...pan } };
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    setPan({
      x: d.start.x + (e.clientX - d.x) / d.w,
      y: d.start.y + (e.clientY - d.y) / d.w,
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  function onWheel(e) {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.4, z - Math.sign(e.deltaY) * 0.06)));
  }

  function reset() {
    setZoom(1);
    setAngle(0);
    setPan({ x: 0, y: 0 });
  }

  // Applique la même transformation que l'aperçu, mais dans un canvas à la
  // taille de sortie. Les décalages sont exprimés en fraction de la largeur,
  // donc ils se transposent tels quels d'une échelle à l'autre.
  async function apply() {
    if (!img) return;
    setBusy(true);
    try {
      const outH = Math.round(OUT_W / geom.ratio);
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, OUT_W, outH);

      ctx.translate(OUT_W / 2 + pan.x * OUT_W, outH / 2 + pan.y * OUT_W);
      ctx.rotate((angle * Math.PI) / 180);
      // Échelle 1 = l'image couvre le gabarit (comme un `background-size: cover`).
      const cover = Math.max(OUT_W / img.width, outH / img.height) * zoom;
      ctx.drawImage(
        img,
        (-img.width * cover) / 2,
        (-img.height * cover) / 2,
        img.width * cover,
        img.height * cover
      );

      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("Rendu impossible.");
      await onApply(blob);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const cover = img
    ? Math.max(1 / (img.width / img.height / geom.ratio), 1) // pour l'aperçu CSS
    : 1;

  return (
    <div className="wrapcrop" onClick={onCancel}>
      <div className="wrapcrop-sheet" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Aligner la jaquette</h3>
          <button className="adm-coll-icon clickable" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>

        <p className="wrapcrop-help">
          <Move size={13} /> Fais glisser l'image, molette pour zoomer. La{" "}
          <strong>tranche</strong> doit tomber entre les deux traits.
        </p>

        <div
          className="wrapcrop-frame"
          ref={frameRef}
          style={{ aspectRatio: geom.ratio }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {img ? (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                transform: `translate(-50%, -50%) translate(${pan.x * 100}%, ${
                  pan.y * 100
                }%) rotate(${angle}deg) scale(${zoom * cover})`,
              }}
            />
          ) : (
            <span className="wrapcrop-load">
              {error || <Loader2 size={22} className="spin" />}
            </span>
          )}

          {/* Traits de pliage : la tranche du boîtier vit entre les deux. */}
          <span className="wrapcrop-fold" style={{ left: `${geom.foldA}%` }} />
          <span className="wrapcrop-fold" style={{ left: `${geom.foldB}%` }} />
          <span
            className="wrapcrop-spine"
            style={{ left: `${geom.foldA}%`, width: `${geom.foldB - geom.foldA}%` }}
          />
          <span className="wrapcrop-tag back">Dos</span>
          <span className="wrapcrop-tag front">Couverture</span>
        </div>

        <div className="wrapcrop-controls">
          <label>
            <span>Zoom</span>
            <input
              type="range"
              min={0.4}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <label>
            <span>Redresser</span>
            <input
              type="range"
              min={-8}
              max={8}
              step={0.1}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
            />
            <em>{angle.toFixed(1)}°</em>
          </label>
          <button className="adm-coll-icon clickable" onClick={reset} title="Réinitialiser">
            <RotateCcw size={15} />
          </button>
        </div>

        {error && img && <p className="adm-coll-error">{error}</p>}

        <footer className="adm-coll-foot">
          <button className="btn btn-ghost clickable" onClick={onCancel}>
            Annuler
          </button>
          <button
            className="btn btn-primary clickable"
            onClick={apply}
            disabled={!img || busy}
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            Utiliser cette jaquette
          </button>
        </footer>
      </div>
    </div>
  );
}
