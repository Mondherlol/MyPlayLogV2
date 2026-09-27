import { lazy } from "react";

// ======================================================================
//  Une page chargée à la demande
// ======================================================================
// ⚠️ LE SITE ÉTAIT UN SEUL FICHIER DE 3 Mo. Toutes les pages (arcade, GBA,
// collection 3D, admin…) partaient avec la première visite, même pour lire
// l'accueil : 874 Ko compressés à télécharger avant d'afficher quoi que ce
// soit. Chaque page vit maintenant dans son propre morceau, chargé quand on
// l'ouvre.
//
// ⚠️ APRÈS UN DÉPLOIEMENT, LES ANCIENS MORCEAUX N'EXISTENT PLUS. Un onglet
// resté ouvert demande `GamePage-ancienhash.js`, qui n'est plus sur le
// serveur : l'import échoue. On recharge alors la page UNE fois (elle récupère
// le nouvel index), et on ne boucle pas si l'échec persiste (vraie panne
// réseau) — l'erreur remonte au garde-fou d'erreurs.

const RELOAD_KEY = "mpl_chunk_reload";

export default function lazyPage(load) {
  return lazy(() =>
    load()
      .then((mod) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* stockage indisponible */
        }
        return mod;
      })
      .catch((err) => {
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
          if (!reloaded) sessionStorage.setItem(RELOAD_KEY, "1");
        } catch {
          reloaded = true;
        }
        if (!reloaded) {
          window.location.reload();
          // La page se recharge : on ne rend rien d'ici là.
          return new Promise(() => {});
        }
        throw err;
      })
  );
}
