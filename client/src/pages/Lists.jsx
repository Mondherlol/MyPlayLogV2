import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Heart,
  MessageCircle,
  Lock,
  Globe,
  Loader2,
  Layers,
  Search,
  X,
  Trash2,
  Disc3,
  CalendarDays,
  PlayCircle,
  ListOrdered,
  Tag,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  timeAgo,
  LIST_SORTS,
  LIST_TYPE_FILTERS,
  LIST_KIND_FILTERS,
  TOP_GROUPS,
} from "../lib/lists";
import CreateListModal from "../components/CreateListModal";
import PlaylistCard from "../components/PlaylistCard";
import { Preview, Author } from "../components/ListPreview";

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

const fmtEventDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function ListCard({ list, onDelete }) {
  return (
    <Link to={`/lists/${list.id}`} className="list-card clickable">
      {list.mine && (
        <button
          className="list-card-del clickable"
          title="Supprimer la liste"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(list);
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
      <Preview list={list} />
      <div className="list-card-body">
        {/* Liste officielle d'un événement : sa date passe avant le titre, et
            on annonce la rediff quand elle existe. */}
        {list.event && (
          <div className="list-card-event">
            <CalendarDays size={12} />
            {list.event.startTime
              ? fmtEventDate.format(new Date(list.event.startTime))
              : "Événement"}
            {list.event.videoId && (
              <span className="list-card-replay" title="Rediffusion disponible">
                <PlayCircle size={12} /> Rediff
              </span>
            )}
          </div>
        )}
        <h3 className="list-card-title">{list.title}</h3>
        {/* Les tops officiels ont tous la même phrase de méthode : sur la
            carte, les tags disent mieux ce qui les distingue. */}
        {list.description && !list.official && (
          <p className="list-card-desc">{list.description}</p>
        )}
        {list.tags?.length > 0 && (
          <div className="list-card-tags">
            {list.tags.slice(0, 3).map((t) => (
              <span key={t} className="list-tag-chip">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="list-card-meta">
          <Author author={list.author} />
          <span className="dot">·</span>
          <span>{list.itemCount} élément{list.itemCount > 1 ? "s" : ""}</span>
          {list.mine && (
            <span className={`list-vis-badge ${list.visibility}`}>
              {list.visibility === "private" ? (
                <><Lock size={11} /> Privée</>
              ) : (
                <><Globe size={11} /> Publique</>
              )}
            </span>
          )}
        </div>
        <div className="list-card-foot">
          <span className={`list-stat ${list.liked ? "liked" : ""}`}>
            <Heart size={14} fill={list.liked ? "currentColor" : "none"} />
            {list.likeCount}
          </span>
          <span className="list-stat">
            <MessageCircle size={14} /> {list.commentCount}
          </span>
          <span className="list-stat time">màj {timeAgo(list.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Lists() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
        return p;
      },
      { replace: true }
    );
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
    if (scope === "mine") params.set("scope", "mine");
    // Listes officielles de conférences : le serveur les range par date
    // d'événement, la plus récente en tête.
    if (scope === "events") params.set("scope", "events");
    // Classements officiels, dans l'ordre éditorial (consoles, genres, sagas).
    if (scope === "tops") {
      params.set("scope", "tops");
      if (group) params.set("group", group);
    }
    params.set("sort", sort);
    // L'onglet « PlayLists » ne montre que les playlists (filtres type/contenu ignorés).
    if (scope === "playlists") params.set("type", "playlist");
    else if (!FIXED_SCOPES.includes(scope)) {
      if (typeFilter) params.set("type", typeFilter);
      if (kindFilter) params.set("itemKind", kindFilter);
    }
    if (tag) params.set("tag", tag);
    if (query) params.set("q", query);
    apiFetch(`/lists?${params}`, { token })
      .then((d) => alive && setLists(d.lists || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, token, typeFilter, kindFilter, sort, query, group, tag]);

  return (
    <div className="lists-page">
      <header className="lists-header">
        <div className="lists-header-text">
          <h1 className="lists-title">
            <span className="lists-title-icon">
              <Layers size={26} />
            </span>
            Listes
          </h1>
          <p className="lists-sub font-fun">
            Crée tes tops, tier lists et playlists d'OST — et découvre celles des autres.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={18} /> Créer une liste
        </button>
      </header>

      <div className="lists-tabs">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            className={`lists-tab clickable ${scope === s.value ? "active" : ""}`}
            onClick={() => setScope(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="lists-toolbar">
        <div className="lists-search">
          <Search size={17} className="lists-search-icon" />
          <input
            type="text"
            placeholder="Rechercher une liste…"
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
        {scope === "tops" ? (
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
                scope === "playlists" ? "playlist" : scope === "events" ? "" : typeFilter
              }
              onChange={(e) => setTypeFilter(e.target.value)}
              disabled={FIXED_SCOPES.includes(scope)}
              aria-label="Filtrer par type"
              title={
                scope === "playlists"
                  ? "L'onglet PlayLists ne montre que les playlists"
                  : scope === "events"
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
              value={FIXED_SCOPES.includes(scope) ? "" : kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              disabled={FIXED_SCOPES.includes(scope)}
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
              {scope === "tops" && o.value === "recent" ? "Ordre du site" : o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tags : toutes les pastilles du rayon dans l'onglet Tops ; ailleurs,
          seulement le tag actif (arrivé depuis une liste) pour pouvoir l'ôter. */}
      {(scope === "tops" ? tagOptions.length > 0 : !!tag) && (
        <div className="lists-tagbar" role="group" aria-label="Tags">
          {scope === "tops" ? (
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
        <div className="lists-loading">
          <Loader2 size={20} className="spin" /> Chargement…
        </div>
      ) : error ? (
        <div className="explorer-error card">
          <h3>Oups</h3>
          <p>{error}</p>
        </div>
      ) : lists.length === 0 ? (
        <div className="lists-empty card">
          {scope === "playlists" ? (
            <Disc3 size={34} />
          ) : scope === "events" ? (
            <CalendarDays size={34} />
          ) : scope === "tops" ? (
            <ListOrdered size={34} />
          ) : (
            <Layers size={34} />
          )}
          <h3>
            {scope === "mine"
              ? "Tu n'as pas encore de liste"
              : scope === "playlists"
                ? "Aucune playlist pour l'instant"
                : scope === "events"
                  ? "Aucune conférence pour l'instant"
                  : scope === "tops"
                    ? "Aucun top ne correspond"
                    : "Rien par ici pour l'instant"}
          </h3>
          <p className="font-fun">
            {scope === "playlists"
              ? "Crée la première playlist d'OST !"
              : scope === "events"
                ? "Les listes des Directs et showcases arrivent après chaque conférence."
                : scope === "tops"
                  ? "Essaie un autre rayon ou un autre tag."
                  : "Lance-toi et crée ta première liste !"}
          </p>
          {!["events", "tops"].includes(scope) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} /> Créer une liste
            </button>
          )}
        </div>
      ) : (
        <div className={scope === "playlists" ? "plc-grid" : "lists-grid"}>
          {lists.map((l) =>
            l.type === "playlist" ? (
              <PlaylistCard key={l.id} list={l} onDelete={handleDelete} />
            ) : (
              <ListCard key={l.id} list={l} onDelete={handleDelete} />
            )
          )}
        </div>
      )}

      {creating && (
        <CreateListModal
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
