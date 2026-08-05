import { useEffect, useRef } from "react";

// Le bouton « retour » (téléphone, ou geste de bord) doit refermer la modale
// ouverte, pas quitter la page qui est derrière. On empile une entrée
// d'historique à l'ouverture — sans toucher à l'URL, `pushState` sans 3ᵉ
// argument — et un « retour » la dépile : on ferme au lieu de naviguer.
//
// `key` marque notre entrée pour la reconnaître parmi les autres :
//
//  - au « retour », on ne ferme QUE si notre clé n'est plus l'entrée courante.
//    Sans ça, deux modales empilées (une fiche + sa visionneuse plein écran)
//    se fermeraient toutes les deux d'un coup, puisque l'évènement `popstate`
//    est diffusé à tout le monde ;
//  - fermée autrement (croix, fond, Échap), on retire nous-mêmes l'entrée
//    empilée — sinon elle resterait à consommer et le « retour » suivant ne
//    ferait rien de visible.
export function useBackClose(onClose, key = "modal") {
  // L'effet ne doit tourner qu'au montage : une fermeture recréée à chaque
  // rendu du parent empilerait une entrée d'historique par rendu.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    // L'entrée est empilée au tick SUIVANT, et non tout de suite. React en
    // mode strict (développement) monte, démonte puis remonte chaque composant
    // dans la foulée : en empilant sur-le-champ, le nettoyage du premier
    // montage déclenchait un `history.back()` — asynchrone — qui atterrissait
    // APRÈS l'empilement du second, sur une entrée sans notre clé. Le nouvel
    // écouteur y voyait un vrai « retour » et refermait la modale à peine
    // ouverte. Différer l'empilement fait que ce cycle s'annule proprement :
    // le minuteur est annulé avant d'avoir rien empilé, donc rien à dépiler.
    let pushed = false;
    const timer = setTimeout(() => {
      window.history.pushState({ [key]: true }, "");
      pushed = true;
    }, 0);

    const onPop = () => {
      if (!window.history.state?.[key]) closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      if (pushed && window.history.state?.[key]) window.history.back();
    };
  }, [key]);
}
