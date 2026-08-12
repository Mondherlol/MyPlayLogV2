import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// ======================================================================
//  Une fenêtre qu'on déplace
// ======================================================================
// Un panneau flottant posé à un endroit fixe finit TOUJOURS par tomber sur ce
// qu'on veut lire — le bouton d'envoi d'un message, le bas d'une liste, la
// manette d'une console. La réponse n'est pas de bien choisir le coin, c'est de
// laisser déplacer.
//
// ------------------------------------------------------ le seuil de 4 pixels
// La poignée de déplacement porte souvent AUSSI un clic (replier le panneau).
// Sans seuil, tout clic devient un micro-déplacement de deux pixels et le
// panneau dérive à chaque fois qu'on le replie ; avec un seuil trop grand, un
// déplacement lent semble bloqué au départ. Quatre pixels : en dessous c'est un
// clic, au-dessus c'est un geste. `didDrag` le dit à l'appelant, qui en fait ce
// qu'il veut (typiquement : ne pas replier si l'on vient de déplacer).
//
// ---------------------------------------------------- pourquoi Pointer Events
// Un seul jeu d'évènements pour la souris, le doigt et le stylet — au lieu de
// doubler tout en `touch*`. `setPointerCapture` est ce qui rend le geste solide :
// le panneau continue de suivre le doigt même s'il sort de la fenêtre ou passe
// au-dessus d'une iframe (celle d'un lecteur YouTube, par exemple), ce qui
// autrement coupe net le déplacement.
//
// LA POSITION SURVIT AU RECHARGEMENT (localStorage). Quelqu'un qui a rangé sa
// fenêtre en haut à gauche l'a rangée pour de bon ; la remettre en bas à droite
// à chaque appel serait la lui reprendre.

const MARGIN = 10; // on ne colle jamais tout à fait au bord
const THRESHOLD = 4;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function useDraggable({ storageKey, width = 300, height = 260 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null); // null = pas encore placé
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const didDragRef = useRef(false);

  // Le coin en bas à droite, dans les coordonnées de la fenêtre. C'est la place
  // par défaut : celle des fenêtres de discussion, donc celle où l'œil la
  // cherche la première fois.
  const defaultPos = useCallback(() => {
    const w = ref.current?.offsetWidth || width;
    const h = ref.current?.offsetHeight || height;
    return {
      x: Math.max(MARGIN, window.innerWidth - w - 18),
      y: Math.max(MARGIN, window.innerHeight - h - 18),
    };
  }, [width, height]);

  // Placement initial AVANT la peinture : une fenêtre qui apparaît en haut à
  // gauche puis saute à sa place se voit, et fait cheap.
  useLayoutEffect(() => {
    let saved = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {
      /* réglage illisible : on retombe sur le coin par défaut */
    }
    const w = ref.current?.offsetWidth || width;
    const h = ref.current?.offsetHeight || height;
    const base = saved && Number.isFinite(saved.x) ? saved : defaultPos();
    setPos({
      x: clamp(base.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      y: clamp(base.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
    });
  }, [storageKey, defaultPos, width, height]);

  // Une fenêtre réduite, un téléphone qu'on tourne : le panneau doit revenir
  // dans l'écran. Sans ça, il devient inatteignable — et avec lui le bouton
  // pour raccrocher.
  useEffect(() => {
    const onResize = () => {
      setPos((cur) => {
        if (!cur) return cur;
        const w = ref.current?.offsetWidth || width;
        const h = ref.current?.offsetHeight || height;
        return {
          x: clamp(cur.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
          y: clamp(cur.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width, height]);

  const onPointerDown = useCallback(
    (e) => {
      // Le bouton du milieu, le clic droit, et surtout les VRAIS boutons posés
      // dans la poignée (replier, raccrocher) ne déplacent rien.
      if (e.button !== 0) return;
      if (e.target.closest("button,a,input")) return;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = {
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        x0: e.clientX,
        y0: e.clientY,
      };
      didDragRef.current = false;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    []
  );

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!didDragRef.current) {
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < THRESHOLD) return;
      didDragRef.current = true;
      setDragging(true);
    }
    const w = ref.current?.offsetWidth || 0;
    const h = ref.current?.offsetHeight || 0;
    setPos({
      x: clamp(e.clientX - d.dx, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      y: clamp(e.clientY - d.dy, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN)),
    });
  }, []);

  const onPointerUp = useCallback(
    (e) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDragging(false);
      if (!didDragRef.current) return;
      setPos((cur) => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(cur));
        } catch {
          /* stockage plein ou privé : la position vaut pour cette session */
        }
        return cur;
      });
    },
    [storageKey]
  );

  return {
    ref,
    dragging,
    // `didDrag()` se lit dans le onClick de la poignée : « ce clic est-il la fin
    // d'un déplacement ? ». Si oui, on ne replie pas.
    didDrag: () => didDragRef.current,
    style: pos
      ? { left: `${pos.x}px`, top: `${pos.y}px` }
      : // Tant que la mesure n'est pas faite, on ne peint pas : mieux vaut une
        // image de moins qu'un panneau qui saute d'un coin à l'autre.
        { left: 0, top: 0, visibility: "hidden" },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      // Sans ça, le navigateur fait défiler la page au lieu de suivre le doigt.
      style: { touchAction: "none" },
    },
  };
}
