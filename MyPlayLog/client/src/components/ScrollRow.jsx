import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Rangée à défilement horizontal : scrollbar cachée, flèches ‹ › conditionnelles,
// et drag-to-scroll à la souris (comme un écran tactile).
export default function ScrollRow({ children, className = "" }) {
  const ref = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [dragging, setDragging] = useState(false);

  // état du drag (refs pour ne pas re-render pendant le mouvement)
  const isDown = useRef(false);
  const moved = useRef(false);
  const startX = useRef(0);
  const startScroll = useRef(0);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setAtStart(scrollLeft <= 1);
    setAtEnd(scrollLeft + clientWidth >= scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update, children]);

  // Déplacement / relâchement gérés sur window (le drag continue hors de la zone)
  useEffect(() => {
    function onMove(e) {
      if (!isDown.current) return;
      const el = ref.current;
      if (!el) return;
      const dx = e.pageX - startX.current;
      if (Math.abs(dx) > 4) moved.current = true;
      el.scrollLeft = startScroll.current - dx;
      e.preventDefault();
    }
    function onUp() {
      if (!isDown.current) return;
      isDown.current = false;
      setDragging(false);
      // laisse le clic (déclenché juste après) se faire annuler si on a bougé
      setTimeout(() => (moved.current = false), 0);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function onMouseDown(e) {
    if (e.button !== 0) return; // clic gauche uniquement
    const el = ref.current;
    if (!el) return;
    isDown.current = true;
    moved.current = false;
    startX.current = e.pageX;
    startScroll.current = el.scrollLeft;
    setDragging(true);
  }

  // Après un drag, on annule le clic (pour ne pas déclencher play/select)
  function onClickCapture(e) {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function scrollBy(dir) {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <div
      className={`scroll-row-wrap ${!atStart ? "has-left" : ""} ${
        !atEnd ? "has-right" : ""
      }`}
    >
      {!atStart && (
        <button
          type="button"
          className="scroll-arrow left clickable"
          onClick={() => scrollBy(-1)}
          aria-label="Précédent"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div
        className={`pick-row ${className} ${dragging ? "dragging" : ""}`}
        ref={ref}
        onMouseDown={onMouseDown}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      {!atEnd && (
        <button
          type="button"
          className="scroll-arrow right clickable"
          onClick={() => scrollBy(1)}
          aria-label="Suivant"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}
