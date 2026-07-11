import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Remet la page tout en haut à chaque navigation « avant » (clic sur un lien,
// ouverture d'un profil…), MAIS restaure la position précédente sur retour /
// avance arrière (POP), et ne touche à rien sur un simple remplacement d'URL
// (REPLACE : changement d'onglet ou de filtres, poussés via
// setSearchParams({ replace: true })).
export default function ScrollManager() {
  const { key } = useLocation();
  const navType = useNavigationType(); // "PUSH" | "POP" | "REPLACE"
  const positions = useRef(new Map());

  // On pilote nous-mêmes la restauration (sinon le navigateur se bat avec nous).
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (navType === "POP") {
      const y = positions.current.get(key) ?? 0;
      // rAF : on attend le rendu (les pages à cache s'affichent instantanément)
      // avant de restaurer la position mémorisée.
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else if (navType === "PUSH") {
      window.scrollTo(0, 0);
    }
    // REPLACE : on ne bouge pas (onglets / filtres vivent dans l'URL).

    // Mémorise en continu la position de défilement de l'entrée courante,
    // pour pouvoir la restaurer si on y revient plus tard (POP).
    const onScroll = () => positions.current.set(key, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [key, navType]);

  return null;
}
