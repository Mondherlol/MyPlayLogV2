import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { CommentThread } from "./ListComments";
import {
  Lightbox,
  MediaGrid,
  PostText,
  PostEmbed,
  extractEmbeds,
} from "./GameMediaWall";
import { timeAgo } from "../lib/lists";

// Modale de réponses d'un post du mur média, ouverte depuis le fil d'accueil,
// le feed de profil ou une carte « a commenté un post ». On y retrouve le post
// original (texte, médias, like) puis son fil de réponses complet.
// `focusCommentId` met en évidence le commentaire à l'origine de l'ouverture.
export default function GameMediaCommentsModal({
  post,
  game,
  token,
  focusCommentId = null,
  onLike,
  onCountChange,
  onClose,
}) {
  const [lightbox, setLightbox] = useState(null); // index du média agrandi
  const { embeds, hide } = useMemo(() => extractEmbeds(post.text), [post.text]);
  const media = post.media || [];

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal thread-modal" onMouseDown={(e) => e.stopPropagation()}>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
          <h2 className="modal-title">
            <MessageCircle size={18} /> Réponses
          </h2>
          {game?.id && (
            <p className="thread-sub">
              sur{" "}
              <Link to={`/game/${game.id}?tab=feed`} onClick={onClose}>
                {game.name}
              </Link>
            </p>
          )}

          {/* Le post original, pour répondre en contexte */}
          <article className="gmc-post">
            <div className="gmc-post-head">
              <span className="gmc-post-av">
                {post.author?.avatar ? (
                  <img src={post.author.avatar} alt="" />
                ) : (
                  (post.author?.username || "?")[0].toUpperCase()
                )}
              </span>
              {post.author?.username ? (
                <Link
                  to={`/u/${post.author.username}`}
                  className="gmc-post-name clickable"
                  onClick={onClose}
                >
                  {post.author.username}
                </Link>
              ) : (
                <span className="gmc-post-name">—</span>
              )}
              <span className="gmc-post-time">{timeAgo(post.createdAt)}</span>
            </div>

            <PostText text={post.text} hide={hide} mentions={post.mentions} />
            {media.length > 0 && (
              <MediaGrid media={media} forceReveal={false} onOpen={setLightbox} />
            )}
            {embeds.map((e, i) => (
              <PostEmbed key={i} embed={e} />
            ))}

            {onLike && (
              <div className="gmc-post-actions">
                <button
                  className={`gmc-like clickable ${post.liked ? "on" : ""}`}
                  onClick={onLike}
                  title="J'aime"
                >
                  <Heart size={16} fill={post.liked ? "currentColor" : "none"} />
                  {post.likeCount > 0 && <span>{post.likeCount}</span>}
                </button>
              </div>
            )}
          </article>

          <CommentThread
            base={`/game-media/${post.id}`}
            comments={post.comments || []}
            moderatorMine={post.mine}
            token={token}
            title={null}
            highlightId={focusCommentId}
            placeholder="Écris une réponse…"
            emptyText="Aucune réponse — sois le premier !"
            onCountChange={onCountChange}
          />
        </div>
      </div>

      {lightbox != null && media[lightbox] && (
        <Lightbox
          media={media}
          index={lightbox}
          post={post}
          onIndex={setLightbox}
          // La visionneuse relâche le scroll du body en se démontant : on le
          // re-verrouille, la modale est toujours ouverte derrière.
          onClose={() => {
            setLightbox(null);
            document.body.style.overflow = "hidden";
          }}
          onLike={onLike}
        />
      )}
    </>,
    document.body
  );
}
