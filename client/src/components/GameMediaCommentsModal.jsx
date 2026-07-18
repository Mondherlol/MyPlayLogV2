import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { CommentThread } from "./ListComments";

// Modale de réponses d'un post du mur média, ouverte depuis le fil d'accueil.
// Réutilise le fil de commentaires des listes (base /game-media/:postId).
export default function GameMediaCommentsModal({ post, game, token, onCountChange, onClose }) {
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
        <CommentThread
          base={`/game-media/${post.id}`}
          comments={post.comments || []}
          moderatorMine={post.mine}
          token={token}
          title={null}
          placeholder="Écris une réponse…"
          emptyText="Aucune réponse — sois le premier !"
          onCountChange={onCountChange}
        />
      </div>
    </div>,
    document.body
  );
}
