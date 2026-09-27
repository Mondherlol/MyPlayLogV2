import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Layers,
  Search,
  X,
  Disc3,
  CalendarDays,
  ListOrdered,
  Tag,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  LIST_SORTS,
  LIST_TYPE_FILTERS,
  LIST_KIND_FILTERS,
  TOP_GROUPS,
} from "../lib/lists";
import CreateListModal from "../components/CreateListModal";
import PlaylistCard from "../components/PlaylistCard";
import ListTile, { ListTileSkeleton } from "../components/lists/ListTile";
import ListsDiscover from "../components/lists/ListsDiscover";

const SCOPES = [
  { value: "feed", label: "Découvrir" },
  { value: "tops", label: "Tops" },
  { value: "events", label: "Événements" },
  { value: "playlists", label: "PlayLists" },
  { value: "mine", label: "Mes listes" },
];

// Les onglets qui ont déjà un contenu bien défini ignorent les filtres
// type / contenu : « PlayLists » ne montre que des playlists, « Événements »
// que les listes officielles de conférences, « Tops » que les classements
// officiels (filtrés, eux, par rayon et par tag).
const FIXED_SCOPES = ["playlists", "events", "tops"];

// Le nombre de listes par page (défilement infini).
const PAGE = 24;

export default function Lists() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  // Le défilement infini : la requête de la page courante (sans offset), s'il
  // reste des listes après, et si la page suivante est en route.
  const [pageQuery, setPageQuery] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef(null);
  const [error, setError] = useState(null);
  // `false` fermé ; sinon le type imposé à la création (tuiles « Créer » de
  // la vitrine), ou `true` pour laisser choisir.
  const [creating, setCreating] = useState(false);

  // Filtres / tri / recherche persistés dans l'URL : on retrouve son écran
  // (onglet, filtres, tri, recherche) en revenant depuis une liste.
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = searchParams.get("sc") || "feed";
  const typeFilter = searchParams.get("type") || "";
  const kindFilter = searchParams.get("kind") || "";
  const sort = searchParams.get("sort") || "recent";
  const query = searchParams.get("q") || "";
  const group = searchParams.get("group") || "";
  const tag = searchParams.get("tag") || "";
  // ⚠️ UNE RECHERCHE PORTE SUR TOUTES LES LISTES. La barre du haut ne cherche
  // pas « dans l'onglet » : un mot-clé traverse tops, conférences, palmarès,
  // cartes de joueur et listes des gens. Tant qu'elle est remplie, l'onglet ne
  // filtre plus rien ; en cliquer un vide la recherche.
  const searching = !!query;
  // L'onglet effectif : « Découvrir » pendant une recherche.
  const eff = searching ? "feed" : scope;
  const setParam = (key, value, def) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (!value || value === def) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true }
    );
  // Changer d'onglet repart sans rayon ni tag : ceux des Tops n'ont pas de
  // sens ailleurs.
  const setScope = (v) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (v === "feed") p.delete("sc");
        else p.set("sc", v);
        p.delete("group");
        p.delete("tag");
        p.delete("q");
        return p;
      },
      { replace: true }
    );
  // Cliquer un onglet sort de la recherche : le champ se vide aussi, sinon
  // le report (debounce) la remettrait dans l'adresse.
  const pickScope = (v) => {
    setSearchInput("");
    setScope(v);
  };
  const setTypeFilter = (v) => setParam("type", v, "");
  const setKindFilter = (v) => setParam("kind", v, "");
  const setSort = (v) => setParam("sort", v, "recent");
  const setTag = (v) => setParam("tag", v, "");
  const setGroup = (v) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (v) p.set("group", v);
        else p.delete("group");
        p.delete("tag");
        return p;
      },
      { replace: true }
    );

  // Pastilles de tags de l'onglet Tops (celles du rayon choisi).
  const [tagOptions, setTagOptions] = useState([]);
  useEffect(() => {
    if (scope !== "tops") return;
    let alive = true;
    const params = new URLSearchParams({ scope: "tops" });
    if (group) params.set("group", group);
    apiFetch(`/lists/tags?${params}`)
      .then((d) => alive && setTagOptions(d.tags || []))
      .catch(() => alive && setTagOptions([]));
    return () => {
      alive = false;
    };
  }, [scope, group]);

  // Champ de recherche local (frappe fluide), débouncé vers l'URL.
  const [searchInput, setSearchInput] = useState(query);

  async function handleDelete(list) {
    if (!confirm(`Supprimer la liste « ${list.title} » ? Cette action est définitive.`))
      return;
    const prev = lists;
    setLists((ls) => ls.filter((l) => l.id !== list.id));
    try {
      await apiFetch(`/lists/${list.id}`, { method: "DELETE", token });
    } catch (e) {
      alert(e.message);
      setLists(prev); // rollback
    }
  }

  // Débounce de la recherche (300 ms) → écrit dans l'URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput.trim() !== query) setParam("q", searchInput.trim(), "");
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (eff === "mine") params.set("scope", "mine");
    // Listes officielles de conférences : le serveur les range par date
    // d'événement, la plus récente en tête.
    if (eff === "events") params.set("scope", "events");
    // Classements officiels, dans l'ordre éditorial (consoles, genres, sagas).
    if (eff === "tops") {
      params.set("scope", "tops");
      if (group) params.set("group", group);
    }
    params.set("sort", sort);
    // L'onglet « PlayLists » ne montre que les playlists (filtres type/contenu ignorés).
    if (eff === "playlists") params.set("type", "playlist");
    else if (!FIXED_SCOPES.includes(eff)) {
      if (typeFilter) params.set("type", typeFilter);
      if (kindFilter) params.set("itemKind", kindFilter);
    }
    if (tag) params.set("tag", tag);
    if (query) params.set("q", query);
    // ⚠️ PAR PAGES. On demandait tout (jusqu'à 200 listes) et on dessinait tout :
    // l'onglet Tops, c'était 185 affiches et des milliers d'images avant le
    // premier défilement. On en prend PAGE, les suivantes arrivent en
    // descendant (cf. `loadMore`).
    params.set("limit", String(PAGE));
    const q = params.toString();
    setPageQuery(null);
    setHasMore(false);
    apiFetch(`/lists?${q}`, { token })
      .then((d) => {
        if (!alive) return;
        setLists(d.lists || []);
        setHasMore(!!d.hasMore);
        setPageQuery(q);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [eff, token, typeFilter, kindFilter, sort, query, group, tag]);

  // La page suivante, quand le bas de la grille approche.
  const loadMore = useCallback(() => {
    if (!pageQuery || !hasMore || loadingMore) return;
    setLoadingMore(true);
    const q = pageQuery;
    apiFetch(`/lists?${q}&offset=${lists.length}`, { token })
      .then((d) => {
        // Les filtres ont changé entre-temps : cette page ne sert plus à rien.
        if (q !== pageQuery) return;
        setLists((prev) => {
          const seen = new Set(prev.map((l) => String(l.id)));
          return [...prev, ...(d.lists || []).filter((l) => !seen.has(String(l.id)))];
        });
        setHasMore(!!d.hasMore);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  }, [pageQuery, hasMore, loadingMore, lists.length, token]);

  // Le guetteur : une ligne invisible sous la grille. Elle entre dans l'écran
  // (avec une avance de 600 px) → on charge la suite.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return undefined;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className="lists-page">
      {/* Le titre, la recherche globale, le bouton : une seule ligne. La
          recherche est au-dessus des onglets parce qu'elle ne dépend d'aucun
          d'eux. */}
      <header className="lists-header">
        <h1 className="lists-title">Listes</h1>
        <div className="lists-search lists-search-global">
          <Search size={17} className="lists-search-icon" />
          <input
            type="text"
            placeholder="Chercher dans toutes les listes : titre, jeu, pseudo…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="lists-search-clear clickable"
              onClick={() => setSearchInput("")}
              aria-label="Effacer"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={18} /> Créer
        </button>
      </header>

      <div className="lists-tabs">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            className={`lists-tab clickable ${!searching && scope === s.value ? "active" : ""}`}
            onClick={() => pickScope(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* La vitrine : seulement sur « Découvrir », tant qu'on ne cherche ni ne
          filtre rien — une recherche veut des résultats, pas des rayons. */}
      {searching && <h2 className="lists-all-title">Résultats pour « {query} »</h2>}

      {scope === "feed" && !query && !tag && !typeFilter && !kindFilter && (
        <>
          <ListsDiscover
            token={token}
            renderCard={(l) =>
              l.type === "playlist" ? (
                <PlaylistCard list={l} onDelete={handleDelete} />
              ) : (
                <ListTile list={l} onDelete={handleDelete} />
              )
            }
          />
          <h2 className="lists-all-title">Toutes les listes</h2>
        </>
      )}

      <div className="lists-toolbar">
        {eff === "tops" ? (
          <div className="lists-seg" role="group" aria-label="Rayon">
            {TOP_GROUPS.map((g) => (
              <button
                key={g.value}
                type="button"
                className={`lists-seg-opt clickable ${group === g.value ? "active" : ""}`}
                onClick={() => setGroup(g.value)}
              >
                {g.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <select
              className="lists-select"
              value={
                eff === "playlists" ? "playlist" : eff === "events" ? "" : typeFilter
              }
              onChange={(e) => setTypeFilter(e.target.value)}
              disabled={FIXED_SCOPES.includes(eff)}
              aria-label="Filtrer par type"
              title={
                eff === "playlists"
                  ? "L'onglet PlayLists ne montre que les playlists"
                  : eff === "events"
                    ? "L'onglet Événements ne montre que les listes officielles"
                    : "Filtrer par type"
              }
            >
              {LIST_TYPE_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="lists-select"
              value={FIXED_SCOPES.includes(eff) ? "" : kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              disabled={FIXED_SCOPES.includes(eff)}
              aria-label="Filtrer par contenu"
            >
              {LIST_KIND_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
        <select
          className="lists-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Trier"
          title="Trier"
        >
          {LIST_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {eff === "tops" && o.value === "recent" ? "Ordre du site" : o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tags : toutes les pastilles du rayon dans l'onglet Tops ; ailleurs,
          seulement le tag actif (arrivé depuis une liste) pour pouvoir l'ôter. */}
      {(eff === "tops" ? tagOptions.length > 0 : !!tag) && (
        <div className="lists-tagbar" role="group" aria-label="Tags">
          {eff === "tops" ? (
            tagOptions.map(({ tag: t, count }) => {
              const on = tag.toLowerCase() === t.toLowerCase();
              return (
                <button
                  key={t}
                  type="button"
                  className={`lists-tagchip clickable ${on ? "active" : ""}`}
                  onClick={() => setTag(on ? "" : t)}
                >
                  {t}
                  <span className="lists-tagchip-n">{count}</span>
                </button>
              );
            })
          ) : (
            <button
              type="button"
              className="lists-tagchip active clickable"
              onClick={() => setTag("")}
              title="Retirer le filtre"
            >
              <Tag size={12} /> {tag} <X size={12} />
            </button>
          )}
        </div>
      )}

      {loading ? (
        // Des cartes en attente plutôt qu'une roue : la page a déjà sa forme.
        <div className="lists-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <ListTileSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="explorer-error card">
          <h3>Oups</h3>
          <p>{error}</p>
        </div>
      ) : lists.length === 0 ? (
        <div className="lists-empty card">
          {eff === "playlists" ? (
            <Disc3 size={34} />
          ) : eff === "events" ? (
            <CalendarDays size={34} />
          ) : eff === "tops" ? (
            <ListOrdered size={34} />
          ) : (
            <Layers size={34} />
          )}
          <h3>
            {eff === "mine"
              ? "Tu n'as pas encore de liste"
              : eff === "playlists"
                ? "Aucune playlist pour l'instant"
                : eff === "events"
                  ? "Aucune conférence pour l'instant"
                  : eff === "tops"
                    ? "Aucun top ne correspond"
                    : "Rien par ici pour l'instant"}
          </h3>
          {!["events", "tops"].includes(eff) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} /> Créer une liste
            </button>
          )}
        </div>
      ) : (
        <div className={eff === "playlists" ? "plc-grid" : "lists-grid"}>
          {lists.map((l) =>
            l.type === "playlist" ? (
              <PlaylistCard key={l.id} list={l} onDelete={handleDelete} />
            ) : (
              <ListTile key={l.id} list={l} onDelete={handleDelete} />
            )
          )}
          {loadingMore &&
            scope !== "playlists" &&
            Array.from({ length: 4 }, (_, i) => <ListTileSkeleton key={`more-${i}`} />)}
        </div>
      )}
      {!loading && hasMore && <div ref={sentinel} className="lists-sentinel" aria-hidden="true" />}

      {creating && (
        <CreateListModal
          fixedType={typeof creating === "string" ? creating : null}
          onClose={() => setCreating(false)}
          onCreated={(list) => {
            setCreating(false);
            navigate(`/lists/${list.id}`, { state: { edit: true } });
          }}
        />
      )}
    </div>
  );
}
