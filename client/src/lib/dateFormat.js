// ======================================================================
//  Dates en français, sans recréer le formateur à chaque fois
// ======================================================================
// `date.toLocaleDateString("fr-FR", {…})` construit un `Intl.DateTimeFormat`
// complet à CHAQUE appel — des centaines de microsecondes. Sur l'accueil, les
// comptes à rebours des évènements le faisaient chaque seconde, pour chaque
// carte ; le fil d'activité, pour chaque ligne. On garde un formateur par jeu
// d'options.

const cache = new Map();

function formatter(opts) {
  const key = opts ? JSON.stringify(opts) : "";
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("fr-FR", opts || undefined);
    cache.set(key, f);
  }
  return f;
}

/** Équivaut à `new Date(d).toLocaleDateString("fr-FR", opts)`. */
export function frDate(d, opts) {
  return formatter(opts || { year: "numeric", month: "numeric", day: "numeric" }).format(
    d instanceof Date ? d : new Date(d)
  );
}

/** Équivaut à `new Date(d).toLocaleTimeString("fr-FR", opts)`. */
export function frTime(d, opts) {
  return formatter(opts || { hour: "numeric", minute: "numeric", second: "numeric" }).format(
    d instanceof Date ? d : new Date(d)
  );
}
