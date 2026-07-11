import { Link, useSearchParams } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Lock,
  Globe,
  Trash2,
  LayoutGrid,
  Disc3,
} from "lucide-react";
import { typeMeta, timeAgo } from "../lib/lists";
import { Preview } from "./ListPreview";
import PlaylistCard from "./PlaylistCard";

// Sous-onglets de filtrage (par type) — « Playlists » inclus.
const FILTERS = [
  { key: "all", label: "Toutes", Icon: LayoutGrid },
  { key: "classic", label: "Listes", Icon: typeMeta("classic").Icon },
  { key: "ranked", label: "Classées", Icon: typeMeta("ranked").Icon },
  { key: "tier", label: "Tier lists", Icon: typeMeta("tier").Icon },
  { key: "playlist", label: "Playlists", Icon: Disc3 },
];

const SORTS = [
  { key: "recent", label: "Plus récentes" },
  { key: "liked", label: "Plus aimées" },
];

// Carte de liste (jeux/persos) sur un profil : le même aperçu que le feed, mais
// avec le type + la visibilité affichés dans le corps (pas sur l'image).
function ProfileListCard({ list, isMe, onDelete }) {
  const meta = typeMeta(list.type);
  return (
    <Link to={`/lists/${list.id}`} className="list-card clickable">
      {isMe && (
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
      <Preview list={list} overlayTag={false} />
      <div className="list-card-body">
        <div className="list-card-badges">
          <span className={`list-type-badge t-${list.type}`}>
            <meta.Icon size={13} /> {meta.label}
          </span>
          {isMe ? (
            <span className={`list-vis-badge ${list.visibility}`}>
              {list.visibility === "private" ? (
                <><Lock size={12} /> Privée</>
              ) : (
                <><Globe size={12} /> Publique</>
              )}
            </span>
          ) : (
            list.visibility === "private" && (
              <span className="list-priv-badge" title="Privée">
                <Lock size={12} />
              </span>
            )
          )}
        </div>
        <h3 className="list-card-title">{list.title}</h3>
        <div className="list-card-foot">
          <span className={`list-stat ${list.liked ? "liked" : ""}`}>
            <Heart size={14} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
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

// Onglet « Listes » d'un profil : sous-onglets par type (dont Playlists), tri,
// et grille mixte de cartes (playlists en cartes-disques, le reste en cartes
// d'aperçu). Filtre/tri persistés dans l'URL (lf / ls).
export default function ProfileLists({ lists, isMe, onDelete }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("lf") || "all";
  const sort = searchParams.get("ls") || "recent";
  const setParam = (key, value, def) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === def) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true }
    );

  if (!lists.length) {
    return (
      <section className="profile-section">
        <div className="profile-empty font-fun">
          {isMe ? (
            <>
              Aucune liste pour l'instant.{" "}
              <Link to="/lists" className="pf-inline-link">En créer une</Link>
            </>
          ) : (
            "Aucune liste publique."
          )}
        </div>
      </section>
    );
  }

  const shown = (filter === "all" ? lists : lists.filter((l) => l.type === filter))
    .slice()
    .sort((a, b) =>
      sort === "liked"
        ? b.likeCount - a.likeCount
        : new Date(b.updatedAt) - new Date(a.updatedAt)
    );

  return (
    <section className="profile-section">
      <div className="act-head">
        <div className="act-subtabs">
          {FILTERS.map((f) => {
            const n =
              f.key === "all"
                ? lists.length
                : lists.filter((l) => l.type === f.key).length;
            if (f.key !== "all" && n === 0) return null;
            return (
              <button
                key={f.key}
                className={`act-subtab clickable ${filter === f.key ? "active" : ""}`}
                onClick={() => setParam("lf", f.key, "all")}
              >
                <f.Icon size={16} /> {f.label}
                <span className="act-subtab-count">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="act-head-tools">
          <label className="act-sort">
            <span className="act-sort-label">Trier</span>
            <select value={sort} onChange={(e) => setParam("ls", e.target.value, "recent")}>
              {SORTS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="profile-empty font-fun">Aucune liste de ce type.</div>
      ) : (
        <div className="lists-grid">
          {shown.map((l) =>
            l.type === "playlist" ? (
              <PlaylistCard
                key={l.id}
                list={{ ...l, mine: isMe }}
                onDelete={onDelete}
              />
            ) : (
              <ProfileListCard key={l.id} list={l} isMe={isMe} onDelete={onDelete} />
            )
          )}
        </div>
      )}
    </section>
  );
}
