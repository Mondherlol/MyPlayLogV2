import { apiFetch } from "./api";

// Cache des jeux "populaires" (recherche vide) : mémoire + localStorage 24h,
// pour ne pas relancer la requête IGDB à chaque ouverture de la modale d'ajout.
const KEY = "mpl_popular_games_v1";
const TTL = 24 * 60 * 60 * 1000; // 24h
let mem = null;

export async function loadPopularGames(token) {
  if (mem) return mem;
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    if (c && c.games?.length && Date.now() - c.ts < TTL) {
      mem = c.games;
      return mem;
    }
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams({ limit: 24, sort: "popularity" });
  const d = await apiFetch(`/games?${params}`, { token });
  mem = d.games || [];
  try {
    localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), games: mem }));
  } catch {
    /* quota / privé : tant pis */
  }
  return mem;
}
