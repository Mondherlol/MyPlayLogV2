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
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  timeAgo,
  LIST_SORTS,
  LIST_TYPE_FILTERS,
  LIST_KIND_FILTERS,
} from "../lib/lists";
import CreateListModal from "../components/CreateListModal";
import PlaylistCard from "../components/PlaylistCard";
import { Preview, Author } from "../components/ListPreview";

const SCOPES = [
  { value: "feed", label: "Découvrir" },
  { value: "popular", label: "Populaires" },
  { value: "playlists", label: "PlayLists" },
  { value: "mine", label: "Mes listes" },
];

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
        <h3 className="list-card-title">{list.title}</h3>
        {list.description && (
          <p className="list-card-desc">{list.description}</p>
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
  const setScope = (v) => setParam("sc", v, "feed");
  const setTypeFilter = (v) => setParam("type", v, "");
  const setKindFilter = (v) => setParam("kind", v, "");
  const setSort = (v) => setParam("sort", v, "recent");

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
    // L'onglet « Populaires » force le tri par likes ; sinon on suit le select.
    params.set("sort", scope === "popular" ? "likes" : sort);
    // L'onglet « PlayLists » ne montre que les playlists (filtres type/contenu ignorés).
    if (scope === "playlists") params.set("type", "playlist");
    else {
      if (typeFilter) params.set("type", typeFilter);
      if (kindFilter) params.set("itemKind", kindFilter);
    }
    if (query) params.set("q", query);
    apiFetch(`/lists?${params}`, { token })
      .then((d) => alive && setLists(d.lists || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, token, typeFilter, kindFilter, sort, query]);

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
        <select
          className="lists-select"
          value={scope === "playlists" ? "playlist" : typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          disabled={scope === "playlists"}
          aria-label="Filtrer par type"
          title={scope === "playlists" ? "L'onglet PlayLists ne montre que les playlists" : "Filtrer par type"}
        >
          {LIST_TYPE_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="lists-select"
          value={scope === "playlists" ? "" : kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          disabled={scope === "playlists"}
          aria-label="Filtrer par contenu"
        >
          {LIST_KIND_FILTERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="lists-select"
          value={scope === "popular" ? "likes" : sort}
          onChange={(e) => setSort(e.target.value)}
          disabled={scope === "popular"}
          aria-label="Trier"
          title={scope === "popular" ? "L'onglet Populaires trie par likes" : "Trier"}
        >
          {LIST_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

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
          {scope === "playlists" ? <Disc3 size={34} /> : <Layers size={34} />}
          <h3>
            {scope === "mine"
              ? "Tu n'as pas encore de liste"
              : scope === "playlists"
                ? "Aucune playlist pour l'instant"
                : "Rien par ici pour l'instant"}
          </h3>
          <p className="font-fun">
            {scope === "playlists"
              ? "Crée la première playlist d'OST !"
              : "Lance-toi et crée ta première liste !"}
          </p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} /> Créer une liste
          </button>
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
