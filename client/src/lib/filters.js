import { apiFetch } from "./api";

// Charge les listes de filtres UNE SEULE FOIS (mémoire + localStorage),
// pour ne pas refaire les requêtes à chaque visite d'Explorer.
const KEY = "mpl_filters_v2";
let mem = null;

export async function loadFilters(token) {
  if (mem) return mem;
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || "null");
    if (cached && cached.genres?.length && cached.languages?.length) {
      mem = cached;
      return mem;
    }
  } catch {
    /* ignore */
  }
  const [platforms, genres, modes, themes, languages] = await Promise.all([
    apiFetch("/games/platforms", { token }).then((d) => d.platforms || []),
    apiFetch("/games/genres", { token }).then((d) => d.genres || []),
    apiFetch("/games/modes", { token }).then((d) => d.modes || []),
    apiFetch("/games/themes", { token }).then((d) => d.themes || []),
    apiFetch("/games/languages", { token }).then((d) => d.languages || []),
  ]);
  mem = { platforms, genres, modes, themes, languages };
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* quota / privé : tant pis */
  }
  return mem;
}
