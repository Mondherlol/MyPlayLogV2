// ======================================================================
//  Un cache mémoire qui ne grossit pas indéfiniment
// ======================================================================
//
// Le serveur était plein de `new Map()` utilisées comme caches : avis Steam,
// feed d'un jeu, suggestions « pour toi », durées YouTube, succès Steam… Aucune
// n'avait de plafond. Elles ne faisaient que grandir, une entrée par jeu ou par
// utilisateur rencontré depuis le démarrage — une fuite lente, invisible tant
// qu'on est dix, gênante à mille.
//
// Ce module remplace ces Map par la même chose, en borné :
//   • une durée de vie par entrée (`ttl`) ;
//   • un nombre maximum d'entrées (`max`), la moins récemment lue partant en
//     premier — un vrai LRU, en O(1), grâce à l'ordre d'insertion des Map JS ;
//   • `remember()`, qui garantit UNE SEULE exécution simultanée par clé : dix
//     personnes qui demandent la même chose froide ne lancent qu'un travail.
//
// Ce n'est pas un cache partagé entre processus : chaque worker a le sien. Pour
// ce qui doit vraiment être commun (les fiches IGDB), c'est la base qui sert de
// cache — voir lib/gameIgdb.js.

export function createTtlCache({ max = 200, ttl = 60_000, name = "cache" } = {}) {
  const store = new Map(); // clé -> { at, exp, value }
  const inflight = new Map(); // clé -> promesse en cours
  let hits = 0;
  let misses = 0;

  function get(key) {
    const hit = store.get(key);
    if (!hit) {
      misses++;
      return undefined;
    }
    if (Date.now() > hit.exp) {
      store.delete(key);
      misses++;
      return undefined;
    }
    // Relecture = entrée « récente » : on la remet en queue de Map, qui est
    // l'ordre d'éviction. C'est tout ce que demande un LRU.
    store.delete(key);
    store.set(key, hit);
    hits++;
    return hit.value;
  }

  function set(key, value, entryTtl = ttl) {
    if (store.has(key)) store.delete(key);
    else if (store.size >= max) {
      // La plus ancienne LECTURE est la première clé de la Map.
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { at: Date.now(), exp: Date.now() + entryTtl, value });
    return value;
  }

  /**
   * La valeur si elle est fraîche, sinon `load()` — mais une seule fois : les
   * appels concurrents sur la même clé attendent la même promesse.
   */
  function remember(key, load, entryTtl = ttl) {
    const known = get(key);
    if (known !== undefined) return Promise.resolve(known);

    const running = inflight.get(key);
    if (running) return running;

    const task = Promise.resolve()
      .then(load)
      .then((value) => {
        if (value !== undefined) set(key, value, entryTtl);
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
  }

  return {
    name,
    get,
    set,
    remember,
    has: (key) => get(key) !== undefined,
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
    get size() {
      return store.size;
    },
    stats: () => ({ name, size: store.size, max, hits, misses }),
  };
}
