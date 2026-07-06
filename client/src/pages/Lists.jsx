import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Heart,
  MessageCircle,
  Lock,
  Loader2,
  Layers,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { typeMeta, timeAgo } from "../lib/lists";
import CreateListModal from "../components/CreateListModal";

const SCOPES = [
  { value: "feed", label: "Découvrir" },
  { value: "popular", label: "Populaires" },
  { value: "mine", label: "Mes listes" },
];

// Montage d'aperçu : quelques covers empilées en éventail, avec le type de
// liste en tag posé sur l'image.
function Preview({ list }) {
  const meta = typeMeta(list.type);
  const images = list.preview;
  const overlay = (
    <>
      <span className={`list-tag t-${list.type}`}>
        <meta.Icon size={12} /> {meta.label}
      </span>
      {list.visibility === "private" && (
        <span className="list-tag-priv" title="Privée">
          <Lock size={12} />
        </span>
      )}
    </>
  );
  if (!images || images.length === 0) {
    return (
      <div className="list-preview empty">
        {overlay}
        <meta.Icon size={30} />
      </div>
    );
  }
  return (
    <div className="list-preview">
      {overlay}
      {images.slice(0, 5).map((src, i) => (
        <span className="list-preview-cover" key={i} style={{ "--i": i }}>
          <img src={src} alt="" loading="lazy" draggable="false" />
        </span>
      ))}
    </div>
  );
}

function ListCard({ list }) {
  return (
    <Link to={`/lists/${list.id}`} className="list-card clickable">
      <Preview list={list} />
      <div className="list-card-body">
        <h3 className="list-card-title">{list.title}</h3>
        {list.description && (
          <p className="list-card-desc">{list.description}</p>
        )}
        <div className="list-card-meta">
          <span className="list-card-author">
            {list.author ? `@${list.author.username}` : "—"}
          </span>
          <span className="dot">·</span>
          <span>{list.itemCount} élément{list.itemCount > 1 ? "s" : ""}</span>
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
  const [scope, setScope] = useState("feed");
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (scope === "mine") params.set("scope", "mine");
    if (scope === "popular") params.set("sort", "likes");
    apiFetch(`/lists?${params}`, { token })
      .then((d) => alive && setLists(d.lists || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, token]);

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
            Crée tes tops, tier lists et collections — et découvre celles des autres.
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
          <Layers size={34} />
          <h3>{scope === "mine" ? "Tu n'as pas encore de liste" : "Rien par ici pour l'instant"}</h3>
          <p className="font-fun">Lance-toi et crée ta première liste !</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} /> Créer une liste
          </button>
        </div>
      ) : (
        <div className="lists-grid">
          {lists.map((l) => (
            <ListCard key={l.id} list={l} />
          ))}
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
