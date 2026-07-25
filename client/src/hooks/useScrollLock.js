import { useEffect } from "react";

// Verrou de défilement de la page, PARTAGÉ entre toutes les modales qui
// l'utilisent.
//
// Chaque modale posait jusqu'ici son propre `document.body.style.overflow`.
// Ça marche tant qu'une seule est ouverte, mais dès qu'elles s'empilent (une
// modale qui ouvre une visionneuse plein écran, par exemple) la fermeture
// simultanée des deux laisse la page bloquée : React détruit les effets d'un
// sous-arbre supprimé du PARENT vers l'enfant, donc la modale libère le
// défilement… puis la visionneuse restaure le « hidden » qu'elle avait
// mémorisé en s'ouvrant. Plus moyen de scroller tant qu'on ne rouvre pas une
// modale pour la refermer seule.
//
// Ici un simple compteur : le premier verrou bloque, le dernier relâché rend
// la main — quel que soit l'ordre de montage et de démontage.
let locks = 0;
let previous = "";

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previous;
    };
  }, [active]);
}
