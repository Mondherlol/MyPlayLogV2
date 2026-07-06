import { useEffect } from "react";

// Ferme un menu quand on clique en dehors de `ref` ou qu'on appuie sur Échap.
export function useClickOutside(ref, handler, active = true) {
  useEffect(() => {
    if (!active) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) handler();
    }
    function onKey(e) {
      if (e.key === "Escape") handler();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, handler, active]);
}
