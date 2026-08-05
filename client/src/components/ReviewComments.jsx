import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Reply, Trash2, Heart } from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { Composer, renderMessage } from "./ListComments";

// Fil de réponses sous une review — un seul niveau d'imbrication, façon
// section commentaires des listes (texte, mentions, emoji, GIF, images).
// `highlightId` : id d'un commentaire/réponse à mettre en avant et vers lequel
// défiler (ouverture depuis le fil d'accueil sur une réponse précise).
export default function ReviewComments({
  gameId,
  reviewUserId,
  token,
  comments,
  setComments,
  highlightId = null,
}) {
  const [replyFor, setReplyFor] = useState(null); // id de la racine dont l'input est ouvert

  const base = `/games/${gameId}/reviews/${reviewUserId}/comments`;

  async function post({ text, media, parent }) {
    const { comment } = await apiFetch(base, {
      method: "POST",
      token,
      body: { text, media, parent: parent || undefined },
    });
    setComments((prev) => [...prev, comment]);
    return comment;
  }

  async function remove(id) {
    setComments((prev) => prev.filter((c) => c.id !== id && c.parent !== id));
    try {
      await apiFetch(`${base}/${id}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  async function toggleLike(id) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, liked: !c.liked, likeCount: c.likeCount + (c.liked ? -1 : 1) }
          : c
      )
    );
    try {
      const d = await apiFetch(`${base}/${id}/like`, { method: "POST", token });
      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, liked: d.liked, likeCount: d.likeCount } : c))
      );
    } catch {
      /* le rechargement corrigera */
    }
  }

  // Regroupe : racines + réponses par racine.
  const roots = comments.filter((c) => !c.parent);
  const repliesByRoot = {};
  comments
    .filter((c) => c.parent)
    .forEach((r) => (repliesByRoot[r.parent] ||= []).push(r));
  Object.values(repliesByRoot).forEach((arr) =>
    arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  );

  const inlineComposer = (target, rootId) => (
    <Composer
      token={token}
      autoFocus
      compact
      placeholder={`Répondre à @${target.author?.username || "?"}…`}
      initialText={target.parent ? `@${target.author?.username || ""} ` : ""}
      onCancel={() => setReplyFor(null)}
      onSubmit={async ({ text, media }) => {
        await post({ text, media, parent: rootId });
        setReplyFor(null);
      }}
    />
  );

  return (
    <div className="rvcm">
      <Composer
        token={token}
        compact
        placeholder="Écris une réponse…"
        onSubmit={async ({ text, media }) => post({ text, media, parent: null })}
      />

      {roots.length > 0 && (
        <div className="rvcm-list">
          {roots.map((root) => {
            const replies = repliesByRoot[root.id] || [];
            return (
              <div className="rvcm-thread" key={root.id}>
                <RvComment
                  c={root}
                  highlight={root.id === highlightId}
                  onReply={() => setReplyFor((v) => (v === root.id ? null : root.id))}
                  onDelete={remove}
                  onLike={toggleLike}
                />
                {replyFor === root.id && inlineComposer(root, root.id)}
                {replies.length > 0 && (
                  <div className="rvcm-replies">
                    {replies.map((r) => (
                      <Fragment key={r.id}>
                        <RvComment
                          c={r}
                          highlight={r.id === highlightId}
                          onReply={() => setReplyFor((v) => (v === r.id ? null : r.id))}
                          onDelete={remove}
                          onLike={toggleLike}
                        />
                        {replyFor === r.id && inlineComposer(r, root.id)}
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RvComment({ c, onReply, onDelete, onLike, highlight = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (highlight && ref.current)
      ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  return (
    <div ref={ref} className={`rvcm-item ${highlight ? "is-focused" : ""}`}>
      <Link to={c.author ? `/u/${c.author.username}` : "#"} className="rvcm-av clickable">
        {c.author?.avatar ? (
          <img src={c.author.avatar} alt="" loading="lazy" />
        ) : (
          <span className="rvcm-av-fb">{(c.author?.username || "?")[0].toUpperCase()}</span>
        )}
      </Link>
      <div className="rvcm-body">
        <div className="rvcm-head">
          {c.author?.username ? (
            <Link to={`/u/${c.author.username}`} className="rvcm-user clickable">
              {c.author.username}
            </Link>
          ) : (
            <span className="rvcm-user">—</span>
          )}
          <span className="rvcm-time">{timeAgo(c.createdAt)}</span>
          {c.canDelete && (
            <button
              className="rvcm-del clickable"
              onClick={() => onDelete(c.id)}
              title="Supprimer la réponse"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {c.text && <p className="rvcm-text">{renderMessage(c.text, c.mentions)}</p>}

        {c.media?.length > 0 && (
          <div className={`lc-media-grid n-${Math.min(c.media.length, 4)}`}>
            {c.media.map((m, i) => (
              <a key={i} href={m.url} target="_blank" rel="noreferrer" className="lc-media">
                <img src={m.url} alt="" loading="lazy" />
                {m.type === "gif" && <span className="lc-media-tag">GIF</span>}
              </a>
            ))}
          </div>
        )}

        <div className="rvcm-actions">
          <button
            className={`rvcm-act like clickable ${c.liked ? "on" : ""}`}
            onClick={() => onLike(c.id)}
          >
            <Heart size={13} fill={c.liked ? "currentColor" : "none"} />
            {c.likeCount > 0 && <span>{c.likeCount}</span>}
          </button>
          <button className="rvcm-act clickable" onClick={onReply}>
            <Reply size={13} /> Répondre
          </button>
        </div>
      </div>
    </div>
  );
}
