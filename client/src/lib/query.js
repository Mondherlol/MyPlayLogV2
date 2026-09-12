import { apiFetch } from "./api";
import { safeSetItem } from "./storage";

// ======================================================================
//  Un écran qui s'ouvre ne doit pas commencer par attendre
// ======================================================================
// Port web de myplaylog-mobile/src/lib/query.js.
//
// L'accueil repartait du réseau à vide à chaque passage : sept requêtes, une
// roue plein écran, et plusieurs centaines de millisecondes à regarder le vide
// — à chaque retour depuis une fiche de jeu. Ce n'est pas React qui est lent,
// c'est qu'on ne lui donnait rien à dessiner.
//
//   1. on rend TOUT DE SUITE ce qu'on avait (mémoire, puis disque) ;
//   2. on ne redemande au serveur que si c'est périmé (`maxAge` par adresse) ;
//   3. on remplace quand la réponse arrive.
//
// ⚠️ POURQUOI PAS `lib/cache.js`. Il existe et il marche, mais il a UNE durée
// de vie par cache, et surtout il n'est PAS CLOISONNÉ PAR COMPTE. Pour l'accueil,
// c'est rédhibitoire : sur un ordinateur partagé, la personne suivante verrait
// la bibliothèque de la précédente le temps que le réseau corrige. Ici chaque
// clé porte l'identifiant du compte (`scope`).

const PREFIX = "mpl_q:";
const DEFAULT_MAX_AGE = 120000;

const mem = new Map(); // clé -> { ts, data }
const inflight = new Map(); // clé -> promesse en cours

const keyOf = (scope, path) => `${PREFIX}${scope || "anon"}:${path}`;

function readEntry(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (entry && typeof entry === "object" && "data" in entry) {
      mem.set(key, entry);
      return entry;
    }
  } catch {
    /* JSON abîmé, stockage bloqué : on repart du réseau */
  }
  return null;
}

/** Ce qu'on a sous la main pour cette adresse, sans rien attendre. */
export function peekApi(path, scope) {
  return readEntry(keyOf(scope, path))?.data ?? null;
}

/** L'entrée est-elle assez récente pour se passer du réseau ? */
export function isFreshApi(path, scope, maxAge = DEFAULT_MAX_AGE) {
  const hit = readEntry(keyOf(scope, path));
  return !!hit && Date.now() - hit.ts < maxAge;
}

/**
 * Écrire dans le dépôt.
 *
 * ⚠️ `keepAge` : GARDER L'ÂGE D'ORIGINE. Quand l'écran réécrit ce qu'il affiche
 * après une modification locale (un jeu marqué terminé), la donnée n'est pas
 * pour autant FRAÎCHE : le reste de la liste date toujours du dernier
 * chargement. Lui donner l'heure de maintenant ferait passer une bibliothèque
 * vieille de deux jours pour neuve, et on ne la redemanderait plus jamais.
 * Sans entrée préalable, l'âge vaut zéro — périmé d'office.
 */
export function writeApi(path, data, scope, { keepAge = false } = {}) {
  const key = keyOf(scope, path);
  const prev = keepAge ? readEntry(key) : null;
  const entry = { ts: keepAge ? prev?.ts ?? 0 : Date.now(), data };
  mem.set(key, entry);
  // Résilient : quota saturé → safeSetItem purge les caches régénérables puis
  // retente. Au pire, on garde la mémoire pour la session.
  safeSetItem(key, JSON.stringify(entry));
}

/**
 * Un GET, en se servant d'abord de ce qu'on a.
 *
 * Rend la donnée. `maxAge` dit à partir de quel âge on redemande ; `force`
 * court-circuite le dépôt.
 *
 * ⚠️ UNE SEULE DEMANDE À LA FOIS PAR ADRESSE. Deux composants qui veulent la
 * même chose dans la même image — ou le chargement et une resynchronisation
 * lancée au même instant — partagent la même promesse : le serveur n'en voit
 * qu'une.
 */
export async function apiCached(path, { token, scope, maxAge = DEFAULT_MAX_AGE, force = false } = {}) {
  const key = keyOf(scope, path);
  if (!force) {
    const hit = readEntry(key);
    if (hit && Date.now() - hit.ts < maxAge) return hit.data;
  }
  let running = inflight.get(key);
  if (!running) {
    running = apiFetch(path, { token }).finally(() => inflight.delete(key));
    inflight.set(key, running);
  }
  const data = await running;
  writeApi(path, data, scope);
  return data;
}
