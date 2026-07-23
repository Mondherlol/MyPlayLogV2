import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const MAX_SCALE = 5;
const MIN_SCALE = 1;

// Visionneuse plein écran d'une image du chat.
// L'image est bornée aux dimensions de l'ÉCRAN (elle ne déborde jamais), et se
// zoome au pincement sur mobile / à la molette sur PC. Double-tap ou
// double-clic : bascule entre taille normale et zoom 2×.
export default function ChatLightbox({ url, onClose }) {
  const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef(null);
  // Repères du geste en cours (pincement ou glissement).
  const gesture = useRef(null);
  const lastTap = useRef(0);

  const reset = useCallback(() => setT({ scale: 1, x: 0, y: 0 }), []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Empêche le déplacement de sortir complètement l'image de l'écran.
  const clamp = useCallback((next) => {
    const el = stageRef.current;
    if (!el) return next;
    const r = el.getBoundingClientRect();
    // Marge de débattement = ce qui dépasse de l'écran, une fois zoomé.
    const maxX = Math.max(0, (r.width * next.scale - window.innerWidth) / 2 + 40);
    const maxY = Math.max(0, (r.height * next.scale - window.innerHeight) / 2 + 40);
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      gesture.current = {
        kind: "pinch",
        d0: dist(e.touches[0], e.touches[1]),
        s0: t.scale,
      };
    } else if (e.touches.length === 1) {
      // Double-tap : zoom / dézoom rapide.
      const now = Date.now();
      if (now - lastTap.current < 280) {
        setT((cur) => (cur.scale > 1 ? { scale: 1, x: 0, y: 0 } : { ...cur, scale: 2 }));
        lastTap.current = 0;
        gesture.current = null;
        return;
      }
      lastTap.current = now;
      gesture.current = {
        kind: "pan",
        x0: e.touches[0].clientX,
        y0: e.touches[0].clientY,
        tx: t.x,
        ty: t.y,
      };
    }
  }

  function onTouchMove(e) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const ratio = dist(e.touches[0], e.touches[1]) / (g.d0 || 1);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.s0 * ratio));
      setT((cur) => clamp({ ...cur, scale }));
    } else if (g.kind === "pan" && e.touches.length === 1) {
      // À l'échelle 1 on laisse le glissement tranquille (pas de déplacement).
      if (t.scale <= 1) return;
      e.preventDefault();
      const x = g.tx + (e.touches[0].clientX - g.x0);
      const y = g.ty + (e.touches[0].clientY - g.y0);
      setT((cur) => clamp({ ...cur, x, y }));
    }
  }

  function onTouchEnd() {
    gesture.current = null;
  }

  // PC : molette pour zoomer, glisser pour déplacer une fois zoomé.
  function onWheel(e) {
    e.preventDefault();
    setT((cur) =>
      clamp({
        ...cur,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, cur.scale - e.deltaY * 0.0016)),
      })
    );
  }

  function onMouseDown(e) {
    if (t.scale <= 1) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    const move = (ev) =>
      setT((cur) =>
        clamp({ ...cur, x: start.tx + (ev.clientX - start.x), y: start.ty + (ev.clientY - start.y) })
      );
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const zoomed = t.scale > 1;

  return createPortal(
    <div
      className="chat-lightbox"
      onMouseDown={(e) => {
        // Clic sur le fond = fermer (sauf si on est en train de déplacer).
        if (e.target === e.currentTarget && !zoomed) onClose();
      }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <button
        className="chat-lightbox-x clickable"
        onClick={onClose}
        aria-label="Fermer"
      >
        <X size={22} />
      </button>

      <div
        ref={stageRef}
        className="chat-lightbox-stage"
        style={{
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
          cursor: zoomed ? "grab" : "auto",
        }}
        onMouseDown={onMouseDown}
        onDoubleClick={() => (zoomed ? reset() : setT((c) => ({ ...c, scale: 2 })))}
      >
        <img src={url} alt="" draggable="false" />
      </div>

      {zoomed && (
        <span className="chat-lightbox-hint">
          {Math.round(t.scale * 100)}% · double-tap pour réinitialiser
        </span>
      )}
    </div>,
    document.body
  );
}
