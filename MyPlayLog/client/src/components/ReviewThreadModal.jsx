import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X, Star, Gamepad2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import { ReviewItem } from "./GameReviews";

// Applique un toggle de réaction (cœur / bravo / rigolo) en local, façon
// optimiste — même logique que l'onglet Reviews.
function applyReaction(rv, type) {
  const counts = { heart: 0, clap: 0, funny: 0, ...(rv.reactions || {}) };
  const prev = rv.myReaction;
  let next;
  if (prev === type) {
    counts[type] = Math.max(0, (counts[type] || 0) - 1);
    next = null;
  } else {
    if (prev) counts[prev] = Math.max(0, (counts[prev] || 0) - 1);
    counts[type] = (counts[type] || 0) + 1;
    next = type;
  }
  return { ...rv, reactions: counts, myReaction: next };
}

// Modale ouverte depuis le fil quand on clique une carte « a réagi à / a
// commenté / a répondu à l'avis de … ». On y AFFICHE l'avis complet (note,
// texte, points forts/faibles, médias, réactions) — et de là on peut réagir ou
// répondre. Le fil de réponses s'ouvre déjà déplié, avec la réponse `commentId`
// mise en avant s'il y en a une.
export default function ReviewThreadModal({
  gameId,
  reviewUserId,
  gameName,
  ownerName,
  commentId,
  token,
  onClose,
}) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/games/${gameId}/reviews/${reviewUserId}`, { token })
      .then((d) => alive && setReview(d.review || null))
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

  async function reactTo(userId, type) {
    if (!userId || !token) return;
    setReview((rv) => (rv ? applyReaction(rv, type) : rv));
    try {
      const res = await apiFetch(`/games/${gameId}/reviews/${userId}/react`, {
        method: "POST",
        token,
        body: { type },
      });
      setReview((rv) =>
        rv ? { ...rv, reactions: res.reactions, myReaction: res.myReaction } : rv
      );
    } catch {
      /* on garde l'état optimiste */
    }
  }

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

        {loading ? (
          <div className="modal-loading">
            <Loader2 size={20} className="spin" /> Chargement…
          </div>
        ) : error ? (
          <p className="lc-error">{error}</p>
        ) : review ? (
          <div className="rp-cmodal-review">
            <ReviewItem
              r={review}
              gameId={gameId}
              token={token}
              isMine={review.isMe}
              viewerFinished
              forceReveal
              defaultThreadOpen
              highlightId={commentId}
              onReact={reactTo}
            />
          </div>
        ) : (
          <p className="lc-error">Avis introuvable.</p>
        )}
      </div>
    </div>,
    document.body
  );
}
