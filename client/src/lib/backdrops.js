import { useEffect, useState } from "react";
import { apiFetch } from "./api";

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
