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
    const target = positions.current.get(key) ?? 0;
    let cancelled = false;
    let timer = null;
    // Pendant la restauration, nos propres `scrollTo` déclenchent des
    // évènements `scroll` : sans ce drapeau ils écraseraient la position
    // mémorisée par la valeur (plafonnée) du moment.
    let restoring = false;

    const stopRestore = () => {
      cancelled = true;
      restoring = false;
      clearTimeout(timer);
    };

    if (navType === "POP" && target > 0) {
      // La page se remplit APRÈS coup : données chargées en réseau, images qui
      // arrivent, détails d'une liste chargés au défilement… Tant qu'elle est
      // trop courte, `scrollTo` est plafonné et on atterrit en haut — c'est ce
      // qui faisait perdre sa place en revenant d'une fiche de jeu. On réessaie
      // donc jusqu'à toucher la cible, sans dépasser ~2,5 s.
      restoring = true;
      let tries = 0;
      const attempt = () => {
        if (cancelled) return;
        window.scrollTo(0, target);
        if (Math.abs(window.scrollY - target) < 4 || ++tries > 40) {
          restoring = false;
          return;
        }
        timer = setTimeout(attempt, 60);
      };
      requestAnimationFrame(attempt);
      // Le moindre geste de l'utilisateur reprend la main : on ne le ramène
      // pas de force là où il n'a pas décidé d'aller.
      window.addEventListener("wheel", stopRestore, { once: true, passive: true });
      window.addEventListener("touchstart", stopRestore, { once: true, passive: true });
    } else if (navType === "POP" || navType === "PUSH") {
      window.scrollTo(0, 0);
    }
    // REPLACE : on ne bouge pas (onglets / filtres vivent dans l'URL).

    // Mémorise en continu la position de défilement de l'entrée courante,
    // pour pouvoir la restaurer si on y revient plus tard (POP).
    const onScroll = () => {
      if (!restoring) positions.current.set(key, window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", stopRestore);
      window.removeEventListener("touchstart", stopRestore);
    };
  }, [key, navType]);

  return null;
}
