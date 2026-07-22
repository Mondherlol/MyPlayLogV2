import { safeSetItem } from "./storage";

// Petit cache "stale-while-revalidate" : mémoire + localStorage avec TTL.
// On garde la donnée en mémoire pour la session (instantané pendant la nav SPA)
// et en localStorage pour survivre à un refresh complet.
export function makeCache(keyPrefix, ttl) {
  const mem = new Map();

  function read(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const c = JSON.parse(localStorage.getItem(keyPrefix + key) || "null");
      if (c) {
        mem.set(key, c);
        return c;
      }
    } catch {
      /* JSON invalide / localStorage indispo */
    }
    return null;
  }

  return {
    // { data, fresh } si présent, sinon null. `fresh` = false si périmé (TTL dépassé).
    get(key) {
      const c = read(key);
      if (!c) return null;
      return { data: c.data, fresh: Date.now() - c.ts < ttl };
    },
    // Invalide une entrée : la prochaine lecture repartira du réseau (ex. un
    // profil qui vient de changer de visibilité).
    remove(key) {
      mem.delete(key);
      try {
        localStorage.removeItem(keyPrefix + key);
      } catch {
        /* localStorage indispo */
      }
    },
    set(key, data) {
      const entry = { ts: Date.now(), data };
      mem.set(key, entry);
      // Résilient : si le quota est saturé, safeSetItem purge les vieux caches
      // puis retente — sinon le cache disque se fige définitivement une fois plein.
      safeSetItem(keyPrefix + key, JSON.stringify(entry));
    },
  };
}
