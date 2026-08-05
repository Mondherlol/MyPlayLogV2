import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Loader2, Clapperboard, Film } from "lucide-react";
import { apiFetch } from "../lib/api";
import {
  Composer,
  CommentItem,
  MediaViewer,
  HistoryModal,
  useCommentActions,
} from "./ListComments";

// Fil de commentaires d'une vidéo, réutilisable : dans la modale dédiée
// (VideoCommentsModal) comme dans le lecteur (VideoPlayerModal, colonne de
// droite). Réutilise tout le système de commentaires des listes (Composer,
// fils à un niveau, médias, likes, édition, lightbox, historique) branché sur
// les routes /videos/:id — likes & commentaires sont GLOBAUX par vidéo.
export default function VideoCommentsPanel({
  video, // { id, videoId, title, author, thumb }
  token,
  onCountChange,
  onOverlayChange, // (open) => void : lightbox média / historique ouvert au-dessus
  compact = false, // masque l'en-tête « vignette + titre » (lecteur : déjà visible)
}) {
  const base = `/videos/${video.id}`;
  const [comments, setComments] = useState([]);
  const [mine, setMine] = useState(false); // le lecteur a recommandé la vidéo → modère tout
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replyFor, setReplyFor] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);

  const { editComment, postComment, remove, toggleLike } = useCommentActions(
    base,
    token,
    setComments
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`${base}/comments`, { token })
      .then((d) => {
        if (!alive) return;
        setComments(d.comments || []);
        setMine(!!d.mine);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [base, token]);

  // Remonte le nombre de commentaires au parent (compteur des boutons).
  const reportedCount = useRef(null);
  useEffect(() => {
    if (loading) return;
    if (reportedCount.current === comments.length) return;
    reportedCount.current = comments.length;
    onCountChange?.(comments.length);
  }, [comments.length, loading, onCountChange]);

  // Signale au parent qu'un calque (lightbox média / historique) est ouvert :
  // il doit alors ignorer sa propre touche Échap (sinon Échap ferme tout).
  useEffect(() => {
    onOverlayChange?.(!!viewer || !!historyOf);
  }, [viewer, historyOf, onOverlayChange]);

  const openViewer = useCallback((c, index) => setViewer({ commentId: c.id, index }), []);
  const canModerate = (c) => c.mine || mine;
  const toggleReply = (id) => setReplyFor((cur) => (cur === id ? null : id));

  // Racines + réponses regroupées par racine (un seul niveau d'imbrication).
  const roots = comments.filter((c) => !c.parent);
  const repliesByRoot = {};
  comments
    .filter((c) => c.parent)
    .forEach((r) => {
      (repliesByRoot[r.parent] ||= []).push(r);
    });
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
        await postComment({ text, media, parent: rootId });
        setReplyFor(null);
      }}
    />
  );

  return (
    <div className="vc-panel">
      {!compact && (
        <div className="rp-cmodal-head">
          <span className="rp-cmodal-art vid">
            {video.thumb ? (
              <img src={video.thumb} alt="" draggable="false" />
            ) : (
              <Film size={22} />
            )}
          </span>
          <div className="rp-cmodal-info">
            <span className="rp-cmodal-name">
              <Clapperboard size={14} /> {video.title || "Vidéo"}
            </span>
            {video.author && <span className="rp-cmodal-sub">{video.author}</span>}
          </div>
        </div>
      )}

      <h2 className="modal-title ost-cmodal-title vc-panel-title">
        <MessageCircle size={18} /> Commentaires
        <span className="ld-comments-count">{comments.length}</span>
      </h2>

      <Composer
        token={token}
        placeholder="Laisse un commentaire sur cette vidéo…"
        onSubmit={async ({ text, media }) => {
          await postComment({ text, media, parent: null });
        }}
      />

      {loading ? (
        <div className="modal-loading">
          <Loader2 size={20} className="spin" /> Chargement…
        </div>
      ) : error ? (
        <p className="lc-error">{error}</p>
      ) : (
        <div className="ld-comment-list ost-cmodal-list vc-panel-list">
          {comments.length === 0 && (
            <p className="ld-comments-empty font-fun">
              Sois le premier à commenter cette vidéo.
            </p>
          )}

          {[...roots].reverse().map((root) => {
            const replies = repliesByRoot[root.id] || [];
            return (
              <div className="lc-thread" key={root.id}>
                <CommentItem
                  c={root}
                  token={token}
                  canDelete={canModerate(root)}
                  onDelete={remove}
                  onLike={toggleLike}
                  onReply={() => toggleReply(root.id)}
                  onOpenMedia={openViewer}
                  onEditSubmit={editComment}
                  onShowHistory={setHistoryOf}
                />
                {replyFor === root.id && inlineComposer(root, root.id)}

                {replies.length > 0 && (
                  <div className="lc-replies">
                    {replies.map((r) => (
                      <Fragment key={r.id}>
                        <CommentItem
                          c={r}
                          reply
                          token={token}
                          canDelete={canModerate(r)}
                          onDelete={remove}
                          onLike={toggleLike}
                          onReply={() => toggleReply(r.id)}
                          onOpenMedia={openViewer}
                          onEditSubmit={editComment}
                          onShowHistory={setHistoryOf}
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

      {viewer && comments.length > 0 && (
        <MediaViewer
          viewer={viewer}
          comments={comments}
          listMine={mine}
          token={token}
          onClose={() => setViewer(null)}
          onNavigate={setViewer}
          onOpenMedia={openViewer}
          onLike={toggleLike}
          onDelete={remove}
          onReplySubmit={postComment}
          onEditSubmit={editComment}
          onShowHistory={setHistoryOf}
        />
      )}
      {historyOf && <HistoryModal comment={historyOf} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}
