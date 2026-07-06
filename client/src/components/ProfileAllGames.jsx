import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Search,
  X,
  Star,
  Heart,
  Clock,
  SlidersHorizontal,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Gamepad2,
} from "lucide-react";
import { loadFilters } from "../lib/filters";
import { useAuth } from "../context/AuthContext";
import FilterSection from "./FilterSection";
import GameAddFan from "./GameAddFan";

const STATUSES = [
  { key: "playing", label: "En cours" },
  { key: "finished", label: "Terminés" },
  { key: "paused", label: "En pause" },
  { key: "dropped", label: "Abandonnés" },
  { key: "wishlist", label: "À jouer" },
];
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

const SORTS = [
  { value: "recent", label: "Récemment mis à jour" },
  { value: "rating", label: "Note" },
  { value: "playtime", label: "Temps de jeu" },
  { value: "name", label: "Nom" },
];

const EMPTY = { ids: [], mode: "or" };

function matchCat(entryIds, sel) {
  if (!sel.ids.length) return true;
  const arr = entryIds || [];
  return sel.mode === "and"
    ? sel.ids.every((id) => arr.includes(id))
    : sel.ids.some((id) => arr.includes(id));
}

function GameTile({ entry }) {
  const navigate = useNavigate();
  return (
    <div
      className="pg-tile clickable"
      onClick={() => navigate(`/game/${entry.gameId}`)}
      title={entry.name}
    >
      <div className="pg-tile-cover">
        {entry.cover ? (
          <img src={entry.cover} alt={entry.name} loading="lazy" />
        ) : (
          <div className="pg-tile-ph">
            <Gamepad2 size={26} />
          </div>
        )}
        {entry.favorite && (
          <span className="pg-tile-fav">
            <Star size={12} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        {entry.rating != null && <span className="pg-tile-rating">{entry.rating}</span>}
        <span className={`pg-tile-status s-${entry.status}`}>
          {STATUS_LABEL[entry.status]}
        </span>
        <GameAddFan
          game={{ id: entry.gameId, name: entry.name, cover: entry.cover }}
          hoverOnly
        />
      </div>
      <span className="pg-tile-name">{entry.name}</span>
      {entry.playtimeHours != null && (
        <span className="pg-tile-time">
          <Clock size={12} /> {entry.playtimeHours} h
        </span>
      )}
    </div>
  );
}

// Petits helpers de (dé)sérialisation des filtres dans l'URL.
const csvNums = (s) =>
  s ? s.split(",").map(Number).filter((n) => Number.isFinite(n)) : [];
const catFromParam = (sp, idsKey, modeKey) => ({
  ids: csvNums(sp.get(idsKey)),
  mode: sp.get(modeKey) === "and" ? "and" : "or",
});

export default function ProfileAllGames({ library, onOpen }) {
  const { token } = useAuth();
  // Filtres persistés dans l'URL : survivent au refresh et au retour arrière
  // après avoir ouvert un jeu (on retrouve exactement les mêmes filtres).
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [statuses, setStatuses] = useState(
    () => new Set((searchParams.get("st") || "").split(",").filter(Boolean))
  );
  const [favOnly, setFavOnly] = useState(() => searchParams.get("fav") === "1");
  const [ratingOp, setRatingOp] = useState(
    () => (searchParams.get("rop") === "lte" ? "lte" : "gte")
  ); // "gte" (≥) | "lte" (≤)
  const [ratingVal, setRatingVal] = useState(() => searchParams.get("rv") || ""); // "" = toutes les notes
  const [sort, setSort] = useState(() => searchParams.get("sort") || "recent");
  const [dir, setDir] = useState(() => searchParams.get("dir") || "desc");
  const [panelOpen, setPanelOpen] = useState(false);

  const [opts, setOpts] = useState({ platforms: [], genres: [], modes: [], themes: [] });
  const [filters, setFilters] = useState(() => ({
    platform: catFromParam(searchParams, "plat", "platm"),
    genre: catFromParam(searchParams, "gen", "genm"),
    gameMode: catFromParam(searchParams, "mod", "modm"),
    theme: catFromParam(searchParams, "thm", "thmm"),
  }));

  useEffect(() => {
    loadFilters(token).then(setOpts).catch(() => {});
  }, [token]);

  // Réécrit l'état des filtres dans l'URL (replace : pas d'entrée d'historique
  // par frappe). On ne touche qu'à nos clés, les autres (tab, lf…) sont conservées.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
        set("q", search.trim());
        set("st", [...statuses].join(","));
        set("fav", favOnly ? "1" : "");
        set("rv", ratingVal);
        set("rop", ratingVal !== "" && ratingOp === "lte" ? "lte" : "");
        set("sort", sort !== "recent" ? sort : "");
        set("dir", dir !== "desc" ? dir : "");
        set("plat", filters.platform.ids.join(","));
        set("platm", filters.platform.mode === "and" ? "and" : "");
        set("gen", filters.genre.ids.join(","));
        set("genm", filters.genre.mode === "and" ? "and" : "");
        set("mod", filters.gameMode.ids.join(","));
        set("modm", filters.gameMode.mode === "and" ? "and" : "");
        set("thm", filters.theme.ids.join(","));
        set("thmm", filters.theme.mode === "and" ? "and" : "");
        return p;
      },
      { replace: true }
    );
  }, [search, statuses, favOnly, ratingOp, ratingVal, sort, dir, filters, setSearchParams]);

  function toggleStatus(key) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = library.filter((e) => {
      if (term && !e.name.toLowerCase().includes(term)) return false;
      if (statuses.size && !statuses.has(e.status)) return false;
      if (favOnly && !e.favorite) return false;
      if (ratingVal !== "") {
        const n = Number(ratingVal);
        if (e.rating == null) return false;
        if (ratingOp === "gte" ? e.rating < n : e.rating > n) return false;
      }
      if (!matchCat(e.platforms, filters.platform)) return false;
      if (!matchCat(e.genres, filters.genre)) return false;
      if (!matchCat(e.modes, filters.gameMode)) return false;
      if (!matchCat(e.themes, filters.theme)) return false;
      return true;
    });
    const mul = dir === "asc" ? 1 : -1;
    list = list.slice().sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "fr") * (dir === "asc" ? 1 : -1);
      let av, bv;
      if (sort === "rating") {
        av = a.rating ?? -1;
        bv = b.rating ?? -1;
      } else if (sort === "playtime") {
        av = a.playtimeHours ?? -1;
        bv = b.playtimeHours ?? -1;
      } else {
        av = new Date(a.updatedAt).getTime();
        bv = new Date(b.updatedAt).getTime();
      }
      return (av - bv) * mul;
    });
    return list;
  }, [library, search, statuses, favOnly, ratingOp, ratingVal, filters, sort, dir]);

  const catCount =
    filters.platform.ids.length +
    filters.genre.ids.length +
    filters.gameMode.ids.length +
    filters.theme.ids.length;
  const activeCount =
    statuses.size + (favOnly ? 1 : 0) + (ratingVal !== "" ? 1 : 0) + catCount;

  function resetAll() {
    setSearch("");
    setStatuses(new Set());
    setFavOnly(false);
    setRatingOp("gte");
    setRatingVal("");
    setSort("recent");
    setDir("desc");
    setFilters({
      platform: { ...EMPTY },
      genre: { ...EMPTY },
      gameMode: { ...EMPTY },
      theme: { ...EMPTY },
    });
  }

  return (
    <div className="pg-layout">
      {/* Panneau de filtres */}
      <aside className={`pg-panel ${panelOpen ? "open" : ""}`}>
        <div className="pg-panel-head">
          <span className="pg-panel-title">
            <SlidersHorizontal size={16} /> Filtres
            {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </span>
          {(activeCount > 0 || search) && (
            <button className="filter-clear clickable" onClick={resetAll}>
              Effacer
            </button>
          )}
        </div>

        <div className="pg-filter-block">
          <label className="pg-filter-label">Statut</label>
          <div className="pg-chips">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                className={`pg-chip clickable ${statuses.has(s.key) ? "active" : ""}`}
                onClick={() => toggleStatus(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pg-filter-block">
          <label className="pg-filter-label">
            <Heart size={13} style={{ verticalAlign: "-2px" }} /> Favoris
          </label>
          <div className="pg-chips">
            <button
              className={`pg-chip clickable ${favOnly ? "active" : ""}`}
              onClick={() => setFavOnly((v) => !v)}
            >
              <Heart
                size={13}
                fill={favOnly ? "currentColor" : "none"}
                style={{ verticalAlign: "-2px", marginRight: "0.25rem" }}
              />
              Coups de cœur
            </button>
          </div>
        </div>

        <div className="pg-filter-block">
          <label className="pg-filter-label">
            <Star size={13} style={{ verticalAlign: "-2px" }} /> Note
          </label>
          <div className="pg-rating-filter">
            <div className="pg-rating-ops">
              <button
                type="button"
                className={`pg-rating-op clickable ${ratingOp === "gte" ? "active" : ""}`}
                onClick={() => setRatingOp("gte")}
                title="Au moins"
              >
                ≥
              </button>
              <button
                type="button"
                className={`pg-rating-op clickable ${ratingOp === "lte" ? "active" : ""}`}
                onClick={() => setRatingOp("lte")}
                title="Au plus"
              >
                ≤
              </button>
            </div>
            <input
              type="number"
              className="pg-rating-input"
              min="0"
              max="100"
              placeholder="Toutes"
              value={ratingVal}
              onChange={(e) => {
                let v = e.target.value.replace(/[^0-9]/g, "");
                if (v !== "") v = String(Math.max(0, Math.min(100, parseInt(v, 10))));
                setRatingVal(v);
              }}
            />
            {ratingVal !== "" && (
              <button
                type="button"
                className="pg-rating-clear clickable"
                onClick={() => setRatingVal("")}
                title="Toutes les notes"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <FilterSection
          title="Console"
          options={opts.platforms}
          selected={filters.platform.ids}
          mode={filters.platform.mode}
          onToggleOption={(id) => toggleOption("platform", id)}
          onSetMode={(m) => setMode("platform", m)}
          defaultOpen={false}
        />
        <FilterSection
          title="Genre"
          options={opts.genres}
          selected={filters.genre.ids}
          mode={filters.genre.mode}
          onToggleOption={(id) => toggleOption("genre", id)}
          onSetMode={(m) => setMode("genre", m)}
          defaultOpen={false}
        />
        <FilterSection
          title="Mode de jeu"
          options={opts.modes}
          selected={filters.gameMode.ids}
          mode={filters.gameMode.mode}
          onToggleOption={(id) => toggleOption("gameMode", id)}
          onSetMode={(m) => setMode("gameMode", m)}
          searchable={false}
          defaultOpen={false}
        />
        <FilterSection
          title="Thème"
          options={opts.themes}
          selected={filters.theme.ids}
          mode={filters.theme.mode}
          onToggleOption={(id) => toggleOption("theme", id)}
          onSetMode={(m) => setMode("theme", m)}
          defaultOpen={false}
        />
      </aside>

      {/* Contenu */}
      <div className="pg-main">
        <div className="pg-toolbar">
          <div className="pg-search">
            <Search size={17} />
            <input
              placeholder="Rechercher dans ces jeux…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="pg-search-clear clickable" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </div>
          <div className="pg-sort">
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="explorer-select">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              className="sort-dir clickable"
              onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={dir === "desc" ? "Décroissant" : "Croissant"}
            >
              {dir === "desc" ? <ArrowDownWideNarrow size={18} /> : <ArrowUpWideNarrow size={18} />}
            </button>
          </div>
          <button className="pg-filter-toggle clickable" onClick={() => setPanelOpen((v) => !v)}>
            <SlidersHorizontal size={16} /> Filtres
            {activeCount > 0 && <span className="filter-count">{activeCount}</span>}
          </button>
        </div>

        <div className="pg-count">
          {filtered.length} jeu{filtered.length > 1 ? "x" : ""}
        </div>

        {filtered.length === 0 ? (
          <div className="profile-empty font-fun">Aucun jeu ne correspond à ces filtres.</div>
        ) : (
          <div className="pg-grid">
            {filtered.map((e) => (
              <GameTile key={e.gameId} entry={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
