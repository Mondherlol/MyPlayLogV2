import { Link } from "react-router-dom";
import { BadgeCheck, Heart, Lock, Play, Trash2 } from "lucide-react";
import { typeMeta } from "../../lib/lists";

// ======================================================================
//  La carte de liste de la page Listes : l'image d'abord
// ======================================================================
// L'ancienne carte empilait date, titre, tags, auteur, nombre d'éléments,
// visibilité, « 0 ♥ 0 💬 » et « màj il y a… » sous un petit montage : on
// lisait avant de voir. Ici l'image porte la carte, et dessous il ne reste que
// le titre et qui l'a faite, posés sur l'image elle-même.

// Les images du montage. Une liste classée garde son podium secret (même
// principe que l'éventail de ListPreview) : on montre la suite du classement.
function mosaicOf(list) {
  if (list.type === "tier" && list.tierPreview?.length) {
    return list.tierPreview.flatMap((t) => t.images).slice(0, 3);
  }
  const imgs = list.preview || [];
  if (list.type === "ranked" && imgs.length > 3) return imgs.slice(3, 6);
  return imgs.slice(0, 3);
}

export default function ListTile({ list, onDelete }) {
  const meta = typeMeta(list.type);
  const imgs = list.cover ? [] : mosaicOf(list);
  const author = list.author;

  return (
    <Link to={`/lists/${list.id}`} className="lt clickable">
      <span className="lt-media">
        {list.cover ? (
          <img className="lt-cover" src={list.cover} alt="" loading="lazy" draggable="false" />
        ) : imgs.length ? (
          <span className="lt-mosaic" style={{ "--n": imgs.length }}>
            {imgs.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" draggable="false" />
            ))}
          </span>
        ) : (
          <span className="lt-empty">
            <meta.Icon size={28} />
          </span>
        )}

        {list.type !== "classic" && (
          <span className="lt-type" title={meta.long}>
            <meta.Icon size={13} />
          </span>
        )}
        <span className="lt-badges">
          {list.mine && onDelete && (
            <button
              type="button"
              className="lt-pill lt-del clickable"
              title="Supprimer la liste"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(list);
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
          {list.event?.videoId && (
            <span className="lt-pill" title="Rediffusion disponible">
              <Play size={11} fill="currentColor" strokeWidth={0} />
            </span>
          )}
          {list.visibility === "private" && (
            <span className="lt-pill" title="Privée">
              <Lock size={11} />
            </span>
          )}
          <span className="lt-pill">{list.itemCount}</span>
        </span>

        {/* Le nom de la liste, posé sur l'image. */}
        <span className="lt-caption">
          <span className="lt-title">{list.title}</span>
          <span className="lt-meta">
            <span className="lt-pp" aria-hidden="true">
              {author?.avatar ? (
                <img src={author.avatar} alt="" loading="lazy" draggable="false" />
              ) : (
                author?.username?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <span className="lt-author">{author?.username || "—"}</span>
            {author?.isSystem && <BadgeCheck size={12} className="lt-check" aria-label="Compte officiel" />}
            {list.likeCount > 0 && (
              <span className={`lt-likes ${list.liked ? "on" : ""}`}>
                <Heart size={12} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
              </span>
            )}
          </span>
        </span>
      </span>
    </Link>
  );
}
