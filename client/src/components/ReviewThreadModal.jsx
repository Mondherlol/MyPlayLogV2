import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Loader2, X, Star, Gamepad2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import ReviewComments from "./ReviewComments";

// Modale du fil de réponses sous un avis, ouverte depuis le fil d'accueil quand
// on clique une carte « a répondu à / a commenté l'avis de … ». Charge l'avis
// visé (celui de `reviewUserId`) et met en avant la réponse `commentId`.
export default function ReviewThreadModal({
  gameId,
  reviewUserId,
  gameName,
  ownerName,
  commentId,
  token,
  onClose,
}) {
  const [comments, setComments] = useState([]);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/games/${gameId}/reviews/${reviewUserId}`, { token })
      .then((d) => {
        if (!alive) return;
        setReview(d.review || null);
        setComments(d.review?.comments || []);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, reviewUserId, token]);

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
      <div className="modal thread-modal rp-cmodal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>

        <div className="rp-cmodal-head">
          <span className="rp-cmodal-art">
            {review?.gameCover ? (
              <img src={review.gameCover} alt="" draggable="false" />
            ) : (
              <Gamepad2 size={22} />
            )}
          </span>
          <div className="rp-cmodal-info">
            <span className="rp-cmodal-name">
              <Star size={14} /> Avis sur {gameName || "ce jeu"}
            </span>
            {ownerName && <span className="rp-cmodal-sub">de {ownerName}</span>}
          </div>
        </div>

        <h2 className="modal-title ost-cmodal-title">
          <MessageCircle size={18} /> Réponses
          {comments.length > 0 && (
            <span className="ld-comments-count">{comments.length}</span>
          )}
        </h2>

        {loading ? (
          <div className="modal-loading">
            <Loader2 size={20} className="spin" /> Chargement…
          </div>
        ) : error ? (
          <p className="lc-error">{error}</p>
        ) : (
          <ReviewComments
            gameId={gameId}
            reviewUserId={reviewUserId}
            token={token}
            comments={comments}
            setComments={setComments}
            highlightId={commentId}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
