// Écriture localStorage résiliente. Les caches applicatifs (réponses d'API,
// jaquettes, jeux populaires…) s'accumulent et finissent par saturer le quota
// (~5 Mo) ; une écriture aussi vitale que le token de connexion ne doit JAMAIS
// échouer pour autant. En cas de quota dépassé, on purge les caches
// régénérables puis on retente une fois.

// Clés préservées lors d'une purge d'urgence : petites et importantes.
const KEEP = new Set(["mpl_token", "mpl_theme", "mpl_sidebar"]);

// Supprime les entrées régénérables du localStorage. `extraKeep` protège en
// plus la clé qu'on est justement en train d'écrire. Renvoie le nb de clés ôtées.
export function evictAppCaches(extraKeep = []) {
  const keep = new Set([...KEEP, ...extraKeep]);
  let removed = 0;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && !keep.has(k)) {
        localStorage.removeItem(k);
        removed += 1;
      }
    }
  } catch {
    /* localStorage indispo (mode privé) */
  }
  return removed;
}

// setItem qui ne plante jamais pour cause de quota : purge les caches puis
// retente. Renvoie true si la valeur a bien été écrite.
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    try {
      evictAppCaches([key]);
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}
