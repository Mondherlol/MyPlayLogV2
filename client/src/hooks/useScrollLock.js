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
let previousPad = "";

export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      previous = document.body.style.overflow;
      previousPad = document.body.style.paddingRight;
      // Bloquer le défilement fait disparaître la barre de scroll, donc la page
      // S'ÉLARGIT d'autant et tout se décale d'un coup — au pire moment, celui
      // où une modale s'ouvre par-dessus. On rend cette largeur en marge : rien
      // ne bouge derrière. (Mesuré AVANT de bloquer, évidemment, et ajouté à la
      // marge existante plutôt que posé à sa place.)
      const gap = window.innerWidth - document.documentElement.clientWidth;
      if (gap > 0) {
        const pad = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
        document.body.style.paddingRight = `${pad + gap}px`;
      }
      document.body.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.body.style.overflow = previous;
        document.body.style.paddingRight = previousPad;
      }
    };
  }, [active]);
}
