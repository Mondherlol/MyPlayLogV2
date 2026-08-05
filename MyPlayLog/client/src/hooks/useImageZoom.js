import { useCallback, useRef, useState } from "react";

// Zoom d'une image plein écran : pincement au doigt, molette au PC, glissement
// pour se déplacer une fois zoomé, double-tap / double-clic pour basculer entre
// taille normale et 2×.
//
// Extrait de la visionneuse du chat, qui l'avait en premier : les trois autres
// visionneuses de l'app (fiche de jeu, listes, sorties) en avaient besoin à
// l'identique, et trois copies d'une gestion de gestes finissent toujours par
// diverger.
//
// Utilisation :
//   const zoom = useImageZoom();
//   <div {...zoom.surfaceProps}>                     ← capte molette et doigts
//     <div ref={zoom.stageRef} style={zoom.style} {...zoom.stageProps}>
//       <img … />
const MAX_SCALE = 5;
const MIN_SCALE = 1;

const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

export function useImageZoom({ maxScale = MAX_SCALE } = {}) {
  const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef(null);
  const gesture = useRef(null); // geste en cours : pincement ou glissement
  const lastTap = useRef(0);

  const reset = useCallback(() => setT({ scale: 1, x: 0, y: 0 }), []);

  // Empêche le déplacement de sortir complètement l'image de l'écran.
  const clamp = useCallback((next) => {
    const el = stageRef.current;
    if (!el) return next;
    const r = el.getBoundingClientRect();
    const maxX = Math.max(0, (r.width * next.scale - window.innerWidth) / 2 + 40);
    const maxY = Math.max(0, (r.height * next.scale - window.innerHeight) / 2 + 40);
    return {
      scale: next.scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, []);

  const zoomTo = useCallback(
    (scale) => setT((cur) => clamp({ ...cur, scale: Math.max(MIN_SCALE, Math.min(maxScale, scale)) })),
    [clamp, maxScale]
  );

  const toggleZoom = useCallback(
    () => setT((cur) => (cur.scale > 1 ? { scale: 1, x: 0, y: 0 } : { ...cur, scale: 2 })),
    []
  );

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      gesture.current = { kind: "pinch", d0: dist(e.touches[0], e.touches[1]), s0: t.scale };
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        toggleZoom();
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
      setT((cur) =>
        clamp({ ...cur, scale: Math.max(MIN_SCALE, Math.min(maxScale, g.s0 * ratio)) })
      );
    } else if (g.kind === "pan" && e.touches.length === 1) {
      // À l'échelle 1 le glissement appartient à la visionneuse (changer
      // d'image, fermer…) : on n'y touche pas.
      if (t.scale <= 1) return;
      e.preventDefault();
      setT((cur) =>
        clamp({
          ...cur,
          x: g.tx + (e.touches[0].clientX - g.x0),
          y: g.ty + (e.touches[0].clientY - g.y0),
        })
      );
    }
  }

  function onTouchEnd() {
    gesture.current = null;
  }

  function onWheel(e) {
    e.preventDefault();
    setT((cur) =>
      clamp({
        ...cur,
        scale: Math.max(MIN_SCALE, Math.min(maxScale, cur.scale - e.deltaY * 0.0016)),
      })
    );
  }

  function onMouseDown(e) {
    if (t.scale <= 1) return;
    e.preventDefault();
    e.stopPropagation();
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

  return {
    scale: t.scale,
    zoomed,
    reset,
    zoomTo,
    toggleZoom,
    stageRef,
    style: {
      transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
      cursor: zoomed ? "grab" : undefined,
    },
    // À poser sur le conteneur plein écran (il doit voir molette et doigts).
    surfaceProps: {
      onWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
    // À poser sur l'élément transformé (l'image et son cadre).
    stageProps: { onMouseDown, onDoubleClick: toggleZoom },
  };
}
