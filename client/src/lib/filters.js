import { platformLabel } from "./platforms";
import { apiFetch } from "./api";

// Charge les listes de filtres UNE SEULE FOIS (mémoire + localStorage),
// pour ne pas refaire les requêtes à chaque visite d'Explorer.
const KEY = "mpl_filters_v2";
let mem = null;

// Les options de plateforme portent le nom d'archiviste d'IGDB (« PC (Microsoft
// Windows) »). On le raccourcit AU MOMENT DE SERVIR, pas dans le cache : un
// cache déjà écrit chez quelqu'un doit s'afficher raccourci lui aussi, et la
// sélection se fait par identifiant — le nom n'est qu'un libellé.
// ⚠️ SEULEMENT LES PLATEFORMES : le raccourcisseur coupe aux « / » et retire
// les parenthèses, ce qui abîmerait « Hack and slash/Beat 'em up » ou « Real
// Time Strategy (RTS) » chez les genres.
function withShortPlatforms(m) {
  return {
    ...m,
    platforms: (m.platforms || []).map((p) => ({ ...p, name: platformLabel(p.name) })),
  };
}

export async function loadFilters(token) {
  if (mem) return mem;
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || "null");
    if (cached && cached.genres?.length && cached.languages?.length) {
      mem = withShortPlatforms(cached);
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
  const raw = { platforms, genres, modes, themes, languages };
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* quota / privé : tant pis */
  }
  mem = withShortPlatforms(raw);
  return mem;
}
