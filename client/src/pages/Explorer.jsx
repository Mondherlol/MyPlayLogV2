import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { useSearchParams } from "react-router-dom";
import {
  Compass,
  AlertTriangle,
  Loader2,
  Search,
  X,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  SlidersHorizontal,
  LayoutGrid,
  List,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { loadFilters } from "../lib/filters";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import GameCard from "../components/GameCard";
import FilterSection from "../components/FilterSection";

const PAGE_SIZE = 24;

const SORT_OPTIONS = [
  { value: "popularity", label: "Popularité" },
  { value: "rating", label: "Note" },
  { value: "release", label: "Date de sortie" },
  { value: "name", label: "Nom" },
];

const EMPTY = { ids: [], mode: "or" };

// Pied des listes virtualisées : spinner de chargement « append » et message de
// fin. Défini hors composant → référence stable (sinon Virtuoso remonte la
// liste). L'état vivant est lu via le `context` de Virtuoso.
function ExplorerFooter({ context }) {
  return (
    <>
      {context.loading && context.count > 0 && (
        <div className="explorer-loading">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      )}
      {!context.hasMore && context.count > 0 && (
        <div className="explorer-end font-fun">
          Tu as tout exploré pour l'instant.
        </div>
      )}
    </>
  );
}
const explorerComponents = { Footer: ExplorerFooter };

// Cache des résultats de l'Explorer (mémoire + localStorage, 24h) : les jeux
// populaires ne bougent pas d'un jour à l'autre, inutile de relancer IGDB à
// chaque ouverture. Clé = signature complète des filtres/tri/recherche.
const gamesCache = makeCache("mpl_explorer_", 24 * 60 * 60 * 1000);

// game_type IGDB — coché par défaut sur Jeu principal + Remake
const GAME_TYPES = [
  { id: 0, name: "Jeu principal" },
  { id: 8, name: "Remake" },
  { id: 9, name: "Remaster" },
  { id: 2, name: "Extension" },
  { id: 4, name: "Extension standalone" },
  { id: 10, name: "Jeu étendu" },
  { id: 3, name: "Bundle" },
  { id: 1, name: "DLC" },
  { id: 13, name: "Pack / Add-on" },
  { id: 11, name: "Portage" },
  { id: 5, name: "Mod" },
  { id: 6, name: "Épisode" },
  { id: 7, name: "Saison" },
  { id: 12, name: "Fork" },
  { id: 14, name: "Mise à jour" },
];
const DEFAULT_TYPES = [0, 8];

export default function Explorer() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") || "";

  const [sort, setSort] = useState("popularity");
  const [dir, setDir] = useState("desc");
  const [filters, setFilters] = useState({
    type: { ids: [...DEFAULT_TYPES], mode: "or" },
    platform: { ...EMPTY },
    genre: { ...EMPTY },
    gameMode: { ...EMPTY },
    theme: { ...EMPTY },
    language: { ...EMPTY },
  });

  // Options des filtres
  const [opts, setOpts] = useState({
    platforms: [],
    genres: [],
    modes: [],
    themes: [],
    languages: [],
  });

  const [games, setGames] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile
  const [filterSearch, setFilterSearch] = useState(""); // recherche dans les filtres
  const [filterSearchOpen, setFilterSearchOpen] = useState(false);
  const [view, setView] = useState(
    () => localStorage.getItem("mpl_explorer_view") || "grid"
  ); // "grid" | "list"

  function changeView(v) {
    setView(v);
    localStorage.setItem("mpl_explorer_view", v);
  }

  const loadingRef = useRef(false);
  const reqIdRef = useRef(0);
  const gamesRef = useRef([]); // miroir de `games` pour construire le cache
  const gridRef = useRef(null);
  const [cols, setCols] = useState(6);

  // Nombre de colonnes réellement affichées (pour 2 lignes de skeletons)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const n = getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      if (n > 0) setCols(n);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Charge les listes de filtres UNE SEULE FOIS (cache mémoire + localStorage)
  useEffect(() => {
    loadFilters(token).then(setOpts).catch(() => {});
  }, [token]);

  useEffect(() => setSearchInput(q), [q]);

  // Panneau de filtres mobile (bottom sheet) : bloque le scroll de la page
  // derrière et se ferme avec Échap.
  useEffect(() => {
    if (!filtersOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && setFiltersOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  // clé qui déclenche un rechargement complet
  const filtersKey = useMemo(
    () => JSON.stringify({ q, sort, dir, filters }),
    [q, sort, dir, filters]
  );

  const fetchGames = useCallback(
    async (pageToLoad, replace, silent = false) => {
      // On ne bloque que les chargements "append" (scroll infini) ;
      // un changement de filtre (replace) doit toujours passer.
      if (!replace && loadingRef.current) return;
      const myId = ++reqIdRef.current;
      loadingRef.current = true;
      // En mode silencieux (revalidation d'un cache déjà affiché) on ne montre
      // pas les skeletons : la mise à jour se fait sans clignotement.
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: pageToLoad, limit: PAGE_SIZE });
        if (q) params.set("search", q);
        params.set("sort", sort);
        params.set("dir", dir);
        const map = {
          type: "type",
          platform: "platform",
          genre: "genre",
          gameMode: "mode",
          theme: "theme",
          language: "language",
        };
        for (const [key, param] of Object.entries(map)) {
          const f = filters[key];
          if (f.ids.length) {
            params.set(param, f.ids.join(","));
            params.set(`${param}Mode`, f.mode);
          }
        }
        const data = await apiFetch(`/games?${params}`, { token });
        if (myId !== reqIdRef.current) return; // requête périmée : on ignore
        const base = replace ? [] : gamesRef.current;
        const seen = new Set(base.map((g) => g.id));
        const merged = [...base, ...data.games.filter((g) => !seen.has(g.id))];
        gamesRef.current = merged;
        setGames(merged);
        setHasMore(data.hasMore);
        setPage(pageToLoad);
        gamesCache.set(filtersKey, { games: merged, page: pageToLoad, hasMore: data.hasMore });
      } catch (err) {
        if (myId === reqIdRef.current) {
          setError(err.message);
          setHasMore(false);
        }
      } finally {
        if (myId === reqIdRef.current) {
          if (!silent) setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [token, q, sort, dir, filters, filtersKey]
  );

  useEffect(() => {
    loadingRef.current = false; // libère un éventuel fetch en cours
    // Cache présent → on affiche instantanément (même périmé), puis on
    // revalide en silence si le TTL est dépassé.
    const cached = gamesCache.get(filtersKey);
    if (cached) {
      gamesRef.current = cached.data.games;
      setGames(cached.data.games);
      setPage(cached.data.page);
      setHasMore(cached.data.hasMore);
      setLoading(false);
      window.scrollTo({ top: 0 });
      if (!cached.fresh) fetchGames(1, true, true);
      return;
    }
    gamesRef.current = [];
    setGames([]);
    setHasMore(true);
    fetchGames(1, true);
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

  // Scroll infini : Virtuoso appelle `loadNext` quand on approche du bas.
  const loadNext = useCallback(() => {
    if (hasMore && !loadingRef.current) fetchGames(page + 1, false);
  }, [hasMore, page, fetchGames]);

  // Helpers de mutation des filtres
  function toggleOption(key, id) {
    setFilters((prev) => {
      const cur = prev[key];
      const ids = cur.ids.includes(id)
        ? cur.ids.filter((x) => x !== id)
        : [...cur.ids, id];
      return { ...prev, [key]: { ...cur, ids } };
    });
  }
  function setMode(key, mode) {
    setFilters((prev) => ({ ...prev, [key]: { ...prev[key], mode } }));
  }
  function resetAll() {
    setFilters({
      type: { ids: [...DEFAULT_TYPES], mode: "or" },
      platform: { ...EMPTY },
      genre: { ...EMPTY },
      gameMode: { ...EMPTY },
      theme: { ...EMPTY },
      language: { ...EMPTY },
    });
    setSort("popularity");
    setDir("desc");
    setSearchInput("");
    setSearchParams(new URLSearchParams());
  }

  function onSearchSubmit(e) {
    e.preventDefault();
    const next = new URLSearchParams(searchParams);
    const term = searchInput.trim();
    if (term) next.set("q", term);
    else next.delete("q");
    setSearchParams(next);
  }

  const activeCount =
    filters.platform.ids.length +
    filters.genre.ids.length +
    filters.gameMode.ids.length +
    filters.theme.ids.length +
    filters.language.ids.length;
  const typeChanged =
    filters.type.ids.length !== DEFAULT_TYPES.length ||
    !DEFAULT_TYPES.every((t) => filters.type.ids.includes(t));
  const hasAny =
    activeCount > 0 ||
    typeChanged ||
    q ||
    sort !== "popularity" ||
    dir !== "desc";

  return (
    <div className="explorer">

      <div className="explorer-layout">
        {/* Voile derrière le bottom sheet des filtres (mobile) */}
        {filtersOpen && (
          <div
            className="filter-backdrop"
            onClick={() => setFiltersOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* PANNEAU DE FILTRES (desktop : colonne sticky / mobile : bottom sheet) */}
        <aside className={`filter-panel ${filtersOpen ? "open" : ""}`}>
          <div className="filter-panel-head">
            <span className="filter-panel-title">
              <SlidersHorizontal size={17} /> Filtres
              {activeCount > 0 && (
                <span className="filter-count">{activeCount}</span>
              )}
            </span>
            <div className="filter-head-actions">
              <div className={`filter-global-search ${filterSearchOpen ? "open" : ""}`}>
                <input
                  className="filter-global-input"
                  placeholder="Chercher un filtre…"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                />
                <button
                  className="filter-global-btn clickable"
                  onClick={() => {
                    setFilterSearchOpen((v) => !v);
                    if (filterSearchOpen) setFilterSearch("");
                  }}
                  aria-label="Chercher dans les filtres"
                >
                  {filterSearchOpen ? <X size={15} /> : <Search size={15} />}
                </button>
              </div>
              {hasAny && (
                <button className="filter-clear clickable" onClick={resetAll}>
                  Effacer
                </button>
              )}
              <button
                className="filter-close-mobile clickable"
                onClick={() => setFiltersOpen(false)}
                aria-label="Fermer les filtres"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          <FilterSection
            title="Type de jeu"
            options={GAME_TYPES}
            selected={filters.type.ids}
            mode={filters.type.mode}
            onToggleOption={(id) => toggleOption("type", id)}
            onSetMode={() => {}}
            searchable={false}
            noMode
            defaultOpen={false}
            search={filterSearch}
          />
          <FilterSection
            title="Console"
            options={opts.platforms}
            selected={filters.platform.ids}
            mode={filters.platform.mode}
            onToggleOption={(id) => toggleOption("platform", id)}
            onSetMode={(m) => setMode("platform", m)}
            defaultOpen={true}
            search={filterSearch}
          />
          <FilterSection
            title="Genre"
            options={opts.genres}
            selected={filters.genre.ids}
            mode={filters.genre.mode}
            onToggleOption={(id) => toggleOption("genre", id)}
            onSetMode={(m) => setMode("genre", m)}
            defaultOpen={true}
            search={filterSearch}
          />
          <FilterSection
            title="Mode de jeu"
            options={opts.modes}
            selected={filters.gameMode.ids}
            mode={filters.gameMode.mode}
            onToggleOption={(id) => toggleOption("gameMode", id)}
            onSetMode={(m) => setMode("gameMode", m)}
            searchable={false}
            noMode
            defaultOpen={false}
            search={filterSearch}
          />
          <FilterSection
            title="Thème"
            options={opts.themes}
            selected={filters.theme.ids}
            mode={filters.theme.mode}
            onToggleOption={(id) => toggleOption("theme", id)}
            onSetMode={(m) => setMode("theme", m)}
            defaultOpen={false}
            search={filterSearch}
          />
          <FilterSection
            title="Langue"
            options={opts.languages}
            selected={filters.language.ids}
            mode={filters.language.mode}
            onToggleOption={(id) => toggleOption("language", id)}
            onSetMode={(m) => setMode("language", m)}
            defaultOpen={false}
            search={filterSearch}
          />

          <button
            className="filter-apply-mobile clickable"
            onClick={() => setFiltersOpen(false)}
          >
            Voir les résultats
          </button>
        </aside>

        {/* CONTENU (droite) */}
        <div className="explorer-main">
          <div className="explorer-toolbar">
            <form className="explorer-search" onSubmit={onSearchSubmit}>
              <Search size={18} className="explorer-search-icon" />
              <input
                type="text"
                placeholder="Rechercher un jeu…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button
                  type="button"
                  className="explorer-search-clear clickable"
                  onClick={() => {
                    setSearchInput("");
                    const next = new URLSearchParams(searchParams);
                    next.delete("q");
                    setSearchParams(next);
                  }}
                  aria-label="Effacer"
                >
                  <X size={16} />
                </button>
              )}
            </form>

            <div className="explorer-sort">
              <select
                className="explorer-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Trier par"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                className="sort-dir clickable"
                onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
                title={dir === "desc" ? "Décroissant" : "Croissant"}
                aria-label="Sens du tri"
              >
                {dir === "desc" ? (
                  <ArrowDownWideNarrow size={18} />
                ) : (
                  <ArrowUpWideNarrow size={18} />
                )}
              </button>
            </div>

            <div className="explorer-view" role="group" aria-label="Affichage">
              <button
                className={`view-btn clickable ${view === "grid" ? "active" : ""}`}
                onClick={() => changeView("grid")}
                title="Vue grille"
                aria-label="Vue grille"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                className={`view-btn clickable ${view === "list" ? "active" : ""}`}
                onClick={() => changeView("list")}
                title="Vue liste"
                aria-label="Vue liste"
              >
                <List size={18} />
              </button>
            </div>

          </div>

          {error ? (
            <div className="explorer-error card">
              <AlertTriangle size={26} />
              <h3>Impossible de charger les jeux</h3>
              <p>{error}</p>
              {!games.length && (
                <p className="explorer-hint">
                  Astuce : ajoute tes clés <code>TWITCH_CLIENT_ID</code> et{" "}
                  <code>TWITCH_CLIENT_SECRET</code> dans <code>server/.env</code>.
                </p>
              )}
            </div>
          ) : (
            <>
              {!loading && games.length === 0 && (
                <div className="explorer-empty font-fun">
                  Aucun jeu ne correspond à ces critères.
                </div>
              )}

              {/* Résultats virtualisés : seules les cartes visibles (± une marge)
                  sont montées. VirtuosoGrid pour la vue grille (classe .game-grid),
                  Virtuoso pour la vue liste. `useWindowScroll` car la page défile
                  sur le body ; `endReached` remplace la sentinelle de scroll. */}
              {games.length > 0 &&
                (view === "list" ? (
                  <Virtuoso
                    useWindowScroll
                    data={games}
                    computeItemKey={(_, g) => g.id}
                    endReached={loadNext}
                    increaseViewportBy={{ top: 400, bottom: 800 }}
                    context={{ loading, hasMore, count: games.length }}
                    components={explorerComponents}
                    itemContent={(_, g) => (
                      <div className="game-list-item">
                        <GameCard game={g} variant="list" />
                      </div>
                    )}
                  />
                ) : (
                  <VirtuosoGrid
                    useWindowScroll
                    data={games}
                    computeItemKey={(_, g) => g.id}
                    endReached={loadNext}
                    listClassName="game-grid"
                    increaseViewportBy={{ top: 400, bottom: 800 }}
                    context={{ loading, hasMore, count: games.length }}
                    components={explorerComponents}
                    itemContent={(_, g) => <GameCard game={g} variant="grid" />}
                  />
                ))}

              {/* Skeletons du tout premier chargement (aucun jeu encore affiché) :
                  une grille simple, non virtualisée, le temps de la 1re page. */}
              {loading && games.length === 0 && (
                <div
                  className={view === "list" ? "game-list" : "game-grid"}
                  ref={gridRef}
                >
                  {Array.from({ length: view === "list" ? 6 : cols * 2 }).map((_, i) => (
                    <div
                      className={view === "list" ? "game-row-skeleton" : "game-skeleton"}
                      key={`sk-${i}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Bouton flottant d'ouverture des filtres (mobile uniquement) */}
      <button
        className="filter-fab clickable"
        onClick={() => setFiltersOpen(true)}
        aria-label="Ouvrir les filtres"
      >
        <SlidersHorizontal size={18} /> Filtres
        {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
      </button>
    </div>
  );
}
