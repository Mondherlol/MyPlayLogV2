import { useRef } from "react";

// Un geste démarré dans un conteneur qui défile horizontalement (carrousels
// ScrollRow, barre d'onglets, listes d'OST/persos…) ne doit PAS changer d'onglet
// — on le laisse faire défiler ce conteneur.
function startedInHorizontalScroller(target, root) {
  let el = target;
  while (el && el !== root && el !== document.body) {
    if (el.nodeType === 1 && el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

// Détecte un swipe horizontal franc (mobile) pour naviguer entre onglets.
// À étaler sur le conteneur de page : `<div {...useTabSwipe({ onPrev, onNext })}>`.
// Ne fait rien sur un swipe vertical (scroll normal) ni dans un scroller horizontal.
export function useTabSwipe({ onPrev, onNext, threshold = 55 }) {
  const state = useRef(null);

  function onTouchStart(e) {
    if (e.touches.length !== 1) {
      state.current = null;
      return;
    }
    const t = e.touches[0];
    state.current = {
      x: t.clientX,
      y: t.clientY,
      // On ignore le geste s'il vient d'un scroller horizontal, OU d'un contenu
      // rendu hors de la racine via un portail (modale, lightbox…) : les
      // évènements React de ces portails « remontent » quand même jusqu'ici,
      // mais un swipe dans une modale ne doit pas changer d'onglet.
      ignore:
        !e.currentTarget.contains(e.target) ||
        startedInHorizontalScroller(e.target, e.currentTarget),
    };
  }

  function onTouchEnd(e) {
    const s = state.current;
    state.current = null;
    if (!s || s.ignore) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    // Swipe clairement horizontal et suffisamment ample.
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  }

  return { onTouchStart, onTouchEnd };
}
