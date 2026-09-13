import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { safeSetItem } from "./storage";

// ======================================================================
//  Les décors des jeux (une image large par jeu)
// ======================================================================
// ⚠️ PAS LA JAQUETTE ÉTIRÉE. Un portrait agrandi jusqu'à remplir un paysage ne
// montre plus qu'un bout de ciel : les grandes cartes de l'accueil (« tu joues
// à », « les plus attendus ») demandent donc au serveur l'artwork le mieux
// défini du catalogue — c'est ce que fait GET /games/backdrops.
//
// ⚠️ UNE SEULE REQUÊTE POUR TOUTE LA PAGE. Douze cartes qui demandent chacune
// leur décor, ce sont douze allers-retours et douze appels IGDB. Le cache de
// module garde ce qu'on a déjà vu pour toute la session : revenir sur l'accueil
// depuis une fiche de jeu ne redemande rien.

const cache = new Map(); // id (string) -> url | null
let inflight = null; // promesse du lot en cours, pour ne pas doubler l'appel

/**
 * Les décors d'une liste d'identifiants de jeux.
 *
 * Rend un objet `{ [gameId]: url }` qui se remplit à mesure — l'appelant peut
 * donc peindre tout de suite avec ce qu'il a (la jaquette en attendant) sans
 * jamais montrer un cadre vide.
 */
export function useGameBackdrops(ids, token) {
  const key = (ids || []).filter(Boolean).map(String).sort().join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    const wanted = key ? key.split(",") : [];
    const missing = wanted.filter((id) => !cache.has(id));
    if (!missing.length) return undefined;

    let alive = true;
    // Les lots se suivent plutôt qu'ils ne se croisent : deux rails qui se
    // montent dans la même image feraient sinon deux requêtes.
    const run = () =>
      apiFetch(`/games/backdrops?ids=${missing.join(",")}`, { token })
        .then((d) => {
          for (const id of missing) cache.set(id, d?.backdrops?.[id] ?? null);
        })
        .catch(() => {
          // Pas de décor : la carte garde sa jaquette, et on ne réessaie pas en
          // boucle à chaque rendu.
          for (const id of missing) cache.set(id, null);
        });

    inflight = (inflight || Promise.resolve()).then(run);
    inflight.then(() => alive && bump((n) => n + 1));

    return () => {
      alive = false;
    };
  }, [key, token]);

  const out = {};
  for (const id of key ? key.split(",") : []) {
    const url = cache.get(id);
    if (url) out[id] = url;
  }
  return out;
}

// ======================================================================
//  Le décor CHOISI pour un jeu, sur cet appareil
// ======================================================================
// La photo de couverture qu'on pose soi-même sur une fiche prime sur l'artwork
// du catalogue. Elle reste LOCALE (comme sur l'app mobile) : c'est un goût, pas
// une donnée du jeu, et rien ne justifie de l'imposer aux autres.
//
// La clé vit ici plutôt que dans la page : le menu contextuel d'une jaquette
// permet d'en changer sans ouvrir la fiche (cf. components/GameContextMenu),
// et deux définitions du même nom de clé, c'est un jour où l'une des deux
// écrit à côté.
export function backdropKey(id) {
  return `mpl_bg_${id}`;
}

export function readBackdrop(id) {
  try {
    return localStorage.getItem(backdropKey(id)) || null;
  } catch {
    return null;
  }
}

export function writeBackdrop(id, url) {
  safeSetItem(backdropKey(id), url);
}
