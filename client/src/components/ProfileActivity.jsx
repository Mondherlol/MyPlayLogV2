import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Loader2,
  Star,
  MessageSquareText,
  Images,
  MessageCircle,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Play,
  Pause,
  Trophy,
  Ban,
  EyeOff,
  Eye,
  User,
  Music,
  CornerDownRight,
  X,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Pencil,
  Repeat2,
  Infinity as InfinityIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo, typeMeta } from "../lib/lists";
import { renderMessage, CommentThreadModal } from "./ListComments";
import { ReviewItem, ReviewModal } from "./GameReviews";
import OstCommentsModal from "./OstCommentsModal";
import RepostCommentsModal from "./RepostCommentsModal";

const STATUS_META = {
  playing: { label: "En cours", Icon: Play },
  finished: { label: "Terminé", Icon: Trophy },
  paused: { label: "En pause", Icon: Pause },
  dropped: { label: "Abandonné", Icon: Ban },
  endless: { label: "Sans fin", Icon: InfinityIcon },
  wishlist: { label: "À jouer", Icon: Clock },
};

const SUBTABS = [
  { key: "reviews", label: "Reviews", Icon: Star },
  { key: "comments", label: "Commentaires", Icon: MessageSquareText },
  { key: "media", label: "Médias", Icon: Images },
];

const REVIEW_SORTS = [
  { key: "recent", label: "Plus récentes" },
  { key: "old", label: "Plus anciennes" },
  { key: "best", label: "Mieux notées" },
  { key: "worst", label: "Moins bien notées" },
];
const COMMENT_SORTS = [
  { key: "recent", label: "Plus récents" },
  { key: "old", label: "Plus anciens" },
  { key: "liked", label: "Plus aimés" },
];
const MEDIA_SORTS = [
  { key: "recent", label: "Plus récents" },
  { key: "old", label: "Plus anciens" },
];

const ratingColor = (v) =>
  v == null ? "var(--text-soft)" : v < 40 ? "#e0483f" : v < 70 ? "#f2b70b" : "#22a35a";

// Anneau de note (0–100) coloré.
function ScoreRing({ value }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <div className="rv-ring" style={{ "--rc": ratingColor(value) }} title={`${value}/100`}>
      <svg viewBox="0 0 48 48">
        <circle className="rv-ring-bg" cx="24" cy="24" r={R} />
        <circle
          className="rv-ring-fg"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - value / 100)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="rv-ring-num">{value}</span>
    </div>
  );
}

// Chip OST favorite : lecture de l'extrait audio si dispo, sinon lien externe.
function OstChip({ ost }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  function toggle() {
    if (!ost.preview) {
      if (ost.url) window.open(ost.url, "_blank", "noopener");
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch(() => {});
    }
  }

  return (
    <button className="rv-ost clickable" onClick={toggle} title={ost.preview ? "Écouter l'extrait" : ost.url ? "Ouvrir" : ost.name}>
      <span className="rv-ost-art">
        {ost.artwork ? <img src={ost.artwork} alt="" loading="lazy" /> : <Music size={15} />}
        {ost.preview && (
          <span className="rv-ost-play">
            {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
          </span>
        )}
      </span>
      <span className="rv-ost-txt">
        <span className="rv-ost-name">{ost.name}</span>
        {ost.artist && <span className="rv-ost-artist">{ost.artist}</span>}
      </span>
      {ost.preview && <audio ref={audioRef} src={ost.preview} onEnded={() => setPlaying(false)} preload="none" />}
    </button>
  );
}

// Grille de médias (réutilise le style des commentaires).
function MediaGrid({ media, onOpen }) {
  if (!media?.length) return null;
  return (
    <div className={`lc-media-grid n-${Math.min(media.length, 4)}`}>
      {media.map((m, i) => (
        <button type="button" key={i} className="lc-media" onClick={() => onOpen(i)}>
          <img src={m.url} alt={m.type === "gif" ? "GIF" : "image"} loading="lazy" />
          {m.type === "gif" && <span className="lc-media-tag">GIF</span>}
        </button>
      ))}
    </div>
  );
}

// Carte d'une review.
function ReviewCard({ review, isMe, viewerStatus, showSpoilers, onOpenGame, onEditReview, onOpenMedia }) {
  const [revealed, setRevealed] = useState(false);
  const sm = STATUS_META[review.status] || STATUS_META.finished;
  const viewerFinished = viewerStatus === "finished";
  // Masqué tant que : marqué spoiler, pas mon profil, je n'ai pas fini le jeu,
  // pas de reveal global ni local.
  const hidden =
    review.spoiler && !isMe && !viewerFinished && !showSpoilers && !revealed;

  const hasBody =
    review.review.trim() ||
    review.media.length ||
    review.pros.length ||
    review.cons.length ||
    review.favoriteCharacter ||
    review.favoriteOst;

  return (
    <article className="rv-card">
      <button className="rv-cover clickable" onClick={() => onOpenGame(review)} title={review.name}>
        {review.cover ? (
          <img src={review.cover} alt={review.name} loading="lazy" />
        ) : (
          <span className="rv-cover-ph">
            <Gamepad2 size={26} />
          </span>
        )}
      </button>

      <div className="rv-main">
        <div className="rv-head">
          <div className="rv-titlewrap">
            <h3 className="rv-game clickable" onClick={() => onOpenGame(review)}>
              {review.name}
            </h3>
            <div className="rv-meta">
              <span className={`rv-status s-${review.status}`}>
                <sm.Icon size={12} /> {sm.label}
              </span>
              {review.playtimeHours != null && (
                <span className="rv-meta-dot">
                  <Clock size={12} /> {review.playtimeHours}h
                </span>
              )}
              {review.platform && <span className="rv-meta-dot">{review.platform}</span>}
              <span className="rv-meta-time">{timeAgo(review.updatedAt)}</span>
              {review.spoiler && (
                <span className="rv-spoiler-tag" title="Cette review dévoile l'intrigue">
                  <EyeOff size={11} /> Spoiler
                </span>
              )}
            </div>
          </div>
          <div className="rv-head-right">
            {review.rating != null && <ScoreRing value={review.rating} />}
            {isMe && (
              <button
                className="rv-edit clickable"
                onClick={() => onEditReview(review)}
                title="Modifier ma review"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="rv-bodywrap">
          <div className={`rv-body ${hidden ? "is-hidden" : ""}`}>
            {review.review.trim() && (
              <p className="rv-text">{renderMessage(review.review, [])}</p>
            )}

            <MediaGrid media={review.media} onOpen={(i) => onOpenMedia(review, i)} />

            {(review.pros.length > 0 || review.cons.length > 0) && (
              <div className="rv-pc">
                {review.pros.map((p, i) => (
                  <span className="pc-chip pro" key={`p${i}`}>
                    <ThumbsUp size={12} /> {p}
                  </span>
                ))}
                {review.cons.map((c, i) => (
                  <span className="pc-chip con" key={`c${i}`}>
                    <ThumbsDown size={12} /> {c}
                  </span>
                ))}
              </div>
            )}

            {(review.favoriteCharacter || review.favoriteOst) && (
              <div className="rv-favs">
                {review.favoriteCharacter && (
                  <span className="rv-fav-chip" title="Personnage favori">
                    <span className="rv-fav-av">
                      {review.favoriteCharacter.image ? (
                        <img src={review.favoriteCharacter.image} alt="" loading="lazy" />
                      ) : (
                        <User size={14} />
                      )}
                    </span>
                    {review.favoriteCharacter.name}
                  </span>
                )}
                {review.favoriteOst && <OstChip ost={review.favoriteOst} />}
              </div>
            )}

            {!hasBody && <p className="rv-text muted font-fun">Pas de texte, juste une note.</p>}
          </div>

          {hidden && (
            <button className="rv-reveal clickable" onClick={() => setRevealed(true)}>
              <Eye size={17} />
              <span>Afficher le spoiler</span>
              <small>Tu n'as pas encore terminé ce jeu</small>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// Mini-card de la liste à laquelle se rattache le commentaire : reprend le
// visuel de la vraie carte (jaquettes en éventail) en version compacte.
function CommentListCard({ list }) {
  const meta = typeMeta(list.type);
  const preview = (list.preview || []).slice(0, 4);
  const noun = list.itemKind === "character" ? "personnage" : "jeu";
  return (
    <Link
      to={`/lists/${list.id}`}
      className="cm-lc clickable"
      onClick={(e) => e.stopPropagation()}
      title={list.title}
    >
      <div className={`cm-lc-preview ${preview.length ? "" : "empty"}`}>
        {preview.length ? (
          preview.map((src, i) => (
            <span className="cm-lc-cover" key={i} style={{ "--i": i, "--n": preview.length }}>
              <img src={src} alt="" loading="lazy" draggable="false" />
            </span>
          ))
        ) : (
          <meta.Icon size={22} />
        )}
      </div>

      <div className="cm-lc-info">
        <div className="cm-lc-titlerow">
          <span className={`list-type-badge t-${list.type}`}>
            <meta.Icon size={11} /> {meta.label}
          </span>
          <span className="cm-lc-title">{list.title}</span>
        </div>

        <div className="cm-lc-meta">
          {list.author?.username && (
            <>
              <span className="cm-lc-author">@{list.author.username}</span>
              <span className="cm-lc-dot">·</span>
            </>
          )}
          <span>
            {list.itemCount} {noun}
            {list.itemCount > 1 ? "s" : ""}
          </span>
        </div>

        <div className="cm-lc-stats">
          <span className="cm-lc-stat liked">
            <Heart size={12} fill="currentColor" /> {list.likeCount ?? 0}
          </span>
          <span className="cm-lc-stat">
            <MessageCircle size={12} /> {list.commentCount ?? 0}
          </span>
        </div>
      </div>
    </Link>
  );
}

// Carte d'un commentaire / réponse. Cliquable → ouvre le fil complet.
function CommentCard({ comment, onOpenThread, onOpenMedia }) {
  return (
    <article className="cm-card clickable" onClick={() => onOpenThread(comment)}>
      <div className="cm-head">
        <MessageCircle size={15} className="cm-head-icon" />
        <span className="cm-on">commentaire</span>
        <span className="cm-time">{timeAgo(comment.createdAt)}</span>
        {comment.likeCount > 0 && (
          <span className="cm-likes">
            <Heart size={12} fill="currentColor" /> {comment.likeCount}
          </span>
        )}
      </div>

      <CommentListCard list={comment.list} />

      {comment.replyTo && (
        <div className="cm-replyto">
          <CornerDownRight size={13} />
          <span>
            En réponse à <strong>@{comment.replyTo.username || "?"}</strong>
            {comment.replyTo.text && <em> « {comment.replyTo.text} »</em>}
          </span>
        </div>
      )}

      {comment.text && (
        <div className="cm-text">{renderMessage(comment.text, comment.mentions)}</div>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        <MediaGrid media={comment.media} onOpen={(i) => onOpenMedia(comment, i)} />
      </div>

      <span className="cm-open-hint">
        <MessageCircle size={13} /> Voir le fil
      </span>
    </article>
  );
}

// Carte d'une réponse laissée sous la review d'un joueur. Cliquable → page du jeu.
function ReviewCommentCard({ comment, onOpen, onOpenMedia }) {
  const g = comment.game || {};
  return (
    <article className="cm-card clickable" onClick={onOpen}>
      <div className="cm-head">
        <Star size={15} className="cm-head-icon" />
        <span className="cm-on">réponse à une review</span>
        <span className="cm-time">{timeAgo(comment.createdAt)}</span>
        {comment.likeCount > 0 && (
          <span className="cm-likes">
            <Heart size={12} fill="currentColor" /> {comment.likeCount}
          </span>
        )}
      </div>

      <div className="cm-rv">
        <span className="cm-rv-cover">
          {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : <Gamepad2 size={20} />}
        </span>
        <div className="cm-rv-info">
          <span className="cm-rv-title">{g.name}</span>
          {g.author?.username && (
            <span className="cm-rv-sub">sur la review de @{g.author.username}</span>
          )}
        </div>
      </div>

      {comment.replyTo && (
        <div className="cm-replyto">
          <CornerDownRight size={13} />
          <span>
            En réponse à <strong>@{comment.replyTo.username || "?"}</strong>
            {comment.replyTo.text && <em> « {comment.replyTo.text} »</em>}
          </span>
        </div>
      )}

      {comment.text && (
        <div className="cm-text">{renderMessage(comment.text, comment.mentions)}</div>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        <MediaGrid media={comment.media} onOpen={onOpenMedia} />
      </div>

      <span className="cm-open-hint">
        <Star size={13} /> Voir la review
      </span>
    </article>
  );
}

// Carte d'un commentaire laissé sous une OST favorite. Cliquable → fil de l'OST.
function OstCommentCard({ comment, onOpen, onOpenMedia }) {
  const ost = comment.ost;
  const g = comment.game || {};
  return (
    <article className="cm-card clickable" onClick={onOpen}>
      <div className="cm-head">
        <Music size={15} className="cm-head-icon" />
        <span className="cm-on">commentaire sur une OST</span>
        <span className="cm-time">{timeAgo(comment.createdAt)}</span>
        {comment.likeCount > 0 && (
          <span className="cm-likes">
            <Heart size={12} fill="currentColor" /> {comment.likeCount}
          </span>
        )}
      </div>

      <div className="cm-ost">
        <span className="cm-ost-art">
          {ost?.artwork ? <img src={ost.artwork} alt="" loading="lazy" /> : <Music size={18} />}
        </span>
        <div className="cm-ost-info">
          <span className="cm-ost-name">{ost?.name || "OST"}</span>
          <span className="cm-ost-sub">
            {ost?.artist ? `${ost.artist} · ` : ""}
            {g.name}
            {comment.owner?.username ? ` · @${comment.owner.username}` : ""}
          </span>
        </div>
      </div>

      {comment.replyTo && (
        <div className="cm-replyto">
          <CornerDownRight size={13} />
          <span>
            En réponse à <strong>@{comment.replyTo.username || "?"}</strong>
            {comment.replyTo.text && <em> « {comment.replyTo.text} »</em>}
          </span>
        </div>
      )}

      {comment.text && (
        <div className="cm-text">{renderMessage(comment.text, comment.mentions)}</div>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        <MediaGrid media={comment.media} onOpen={onOpenMedia} />
      </div>

      <span className="cm-open-hint">
        <MessageCircle size={13} /> Voir le fil
      </span>
    </article>
  );
}

// Carte d'un commentaire laissé sous une republication de fan art.
// Cliquable → fil de commentaires du repost.
function RepostCommentCard({ comment, onOpen, onOpenMedia }) {
  const g = comment.game || {};
  const rp = comment.repost || {};
  return (
    <article className="cm-card clickable" onClick={onOpen}>
      <div className="cm-head">
        <Repeat2 size={15} className="cm-head-icon" />
        <span className="cm-on">commentaire sur un fan art</span>
        <span className="cm-time">{timeAgo(comment.createdAt)}</span>
        {comment.likeCount > 0 && (
          <span className="cm-likes">
            <Heart size={12} fill="currentColor" /> {comment.likeCount}
          </span>
        )}
      </div>

      <div className="cm-rv">
        <span className="cm-rv-cover">
          {rp.image ? <img src={rp.image} alt="" loading="lazy" /> : <Gamepad2 size={20} />}
        </span>
        <div className="cm-rv-info">
          <span className="cm-rv-title">Fan art {g.name || ""}</span>
          <span className="cm-rv-sub">
            {rp.source}
            {comment.owner?.username ? ` · republié par @${comment.owner.username}` : ""}
          </span>
        </div>
      </div>

      {comment.replyTo && (
        <div className="cm-replyto">
          <CornerDownRight size={13} />
          <span>
            En réponse à <strong>@{comment.replyTo.username || "?"}</strong>
            {comment.replyTo.text && <em> « {comment.replyTo.text} »</em>}
          </span>
        </div>
      )}

      {comment.text && (
        <div className="cm-text">{renderMessage(comment.text, comment.mentions)}</div>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        <MediaGrid media={comment.media} onOpen={onOpenMedia} />
      </div>

      <span className="cm-open-hint">
        <MessageCircle size={13} /> Voir le fil
      </span>
    </article>
  );
}

// Lightbox média (simple, avec navigation).
function Lightbox({ items, index, onClose, onNav }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onNav(-1);
      else if (e.key === "ArrowRight") onNav(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, onNav]);

  const cur = items[index];
  if (!cur) return null;

  return createPortal(
    <div className="mv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="mv-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <div className="mv-media" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {items.length > 1 && (
          <button className="mv-nav mv-prev clickable" onClick={() => onNav(-1)} aria-label="Précédent">
            <ChevronLeft size={26} />
          </button>
        )}
        <img className="mv-img" src={cur.url} alt="" />
        {items.length > 1 && (
          <button className="mv-nav mv-next clickable" onClick={() => onNav(1)} aria-label="Suivant">
            <ChevronRight size={26} />
          </button>
        )}
        {cur.label && <div className="mv-caption">{cur.label}</div>}
      </div>
    </div>,
    document.body
  );
}

export default function ProfileActivity({ username, token, isMe, libraryMap, onOpenGame }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { items, index } — média de review (profil d'autrui)
  const [thread, setThread] = useState(null); // { listId, commentId, focusMedia }
  const [ostThread, setOstThread] = useState(null); // { ownerId, gameId, ost, gameName }
  const [repostThread, setRepostThread] = useState(null); // repost dont on ouvre le fil
  const [editReview, setEditReview] = useState(null); // review en cours d'édition (modal)
  const [tick, setTick] = useState(0); // force le rechargement de l'activité
  const reload = () => setTick((t) => t + 1);

  // Sous-onglet, tri et affichage des spoilers persistés dans l'URL (survivent
  // au refresh). On fusionne avec les params existants (ex : `tab` du profil).
  const [searchParams, setSearchParams] = useSearchParams();
  const sub = searchParams.get("sub") || "reviews";
  const showSpoilers = searchParams.get("sp") === "1";
  const sorts = sub === "reviews" ? REVIEW_SORTS : sub === "comments" ? COMMENT_SORTS : MEDIA_SORTS;
  const rawSort = searchParams.get("so") || "recent";
  const sort = sorts.some((o) => o.key === rawSort) ? rawSort : "recent";

  const updateParams = (changes) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v == null || v === "") p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true }
    );
  const setSort = (v) => updateParams({ so: v === "recent" ? null : v });
  const toggleSpoilers = () => updateParams({ sp: showSpoilers ? null : "1" });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/users/${username}/activity`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token, tick]);

  // Réaction à une review (met à jour la review du bon jeu).
  function applyReaction(rv, type) {
    const counts = { ...(rv.reactions || { heart: 0, clap: 0, funny: 0 }) };
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

  async function reactTo(gameId, userId, type) {
    if (!userId) return;
    setData((d) => ({
      ...d,
      reviews: d.reviews.map((rv) => (rv.gameId === gameId ? applyReaction(rv, type) : rv)),
    }));
    try {
      const res = await apiFetch(`/games/${gameId}/reviews/${userId}/react`, {
        method: "POST",
        token,
        body: { type },
      });
      setData((d) => ({
        ...d,
        reviews: d.reviews.map((rv) =>
          rv.gameId === gameId
            ? { ...rv, reactions: res.reactions, myReaction: res.myReaction }
            : rv
        ),
      }));
    } catch {
      reload();
    }
  }

  // Supprime le contenu d'une de mes reviews (garde le jeu en bibliothèque).
  async function deleteReview(r) {
    if (!confirm("Supprimer définitivement ta review pour ce jeu ?")) return;
    try {
      await apiFetch(`/library/${r.gameId}`, {
        method: "PUT",
        token,
        body: {
          name: r.name,
          cover: r.cover,
          review: "",
          reviewMedia: [],
          spoiler: false,
          pros: [],
          cons: [],
          rating: null,
        },
      });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  // Le tri par défaut redevient « récent » à chaque changement de sous-onglet.
  function switchSub(key) {
    updateParams({ sub: key === "reviews" ? null : key, so: null });
  }

  const reviews = useMemo(() => data?.reviews || [], [data]);
  const comments = useMemo(() => data?.comments || [], [data]);

  const sortedReviews = useMemo(() => {
    const arr = [...reviews];
    if (sort === "old") arr.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    else if (sort === "best") arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    else if (sort === "worst") arr.sort((a, b) => (a.rating ?? 101) - (b.rating ?? 101));
    else arr.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return arr;
  }, [reviews, sort]);

  const sortedComments = useMemo(() => {
    const arr = [...comments];
    if (sort === "old") arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sort === "liked") arr.sort((a, b) => b.likeCount - a.likeCount);
    else arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return arr;
  }, [comments, sort]);

  const media = useMemo(() => {
    const items = [];
    reviews.forEach((r) =>
      (r.media || []).forEach((m, idx) =>
        items.push({ url: m.url, type: m.type, at: r.updatedAt, label: r.name, kind: "review", review: r, mediaIndex: idx })
      )
    );
    comments.forEach((cm) => {
      // Les réponses de review n'ont pas de fil média dédié ici — on les ignore.
      if (cm.kind === "review") return;
      const isOst = cm.kind === "ost";
      const isRepost = cm.kind === "repost";
      const label = isOst || isRepost ? cm.game?.name : cm.list?.title;
      (cm.media || []).forEach((m, idx) =>
        items.push({
          url: m.url,
          type: m.type,
          at: cm.createdAt,
          label,
          kind: isOst ? "ostcomment" : isRepost ? "repostcomment" : "comment",
          comment: cm,
          mediaIndex: idx,
        })
      );
    });
    items.sort((a, b) =>
      sort === "old" ? new Date(a.at) - new Date(b.at) : new Date(b.at) - new Date(a.at)
    );
    return items;
  }, [reviews, comments, sort]);

  const spoilerCount = useMemo(
    () => reviews.filter((r) => r.spoiler).length,
    [reviews]
  );

  const counts = { reviews: reviews.length, comments: comments.length, media: media.length };

  // Ouvre le fil complet d'un commentaire (esprit Twitter), éventuellement
  // directement sur un média (comme sur la page d'une liste).
  function openThread(comment, focusMedia) {
    setThread({ listId: comment.list.id, commentId: comment.id, focusMedia });
  }
  function openCommentMedia(comment, index) {
    openThread(comment, { commentId: comment.id, index });
  }
  // Ouvre le fil de commentaires d'une OST (réutilise la modale de l'onglet OST).
  function openOstThread(comment) {
    setOstThread({
      ownerId: comment.owner?.id,
      gameId: comment.game?.id,
      ost: comment.ost,
      gameName: comment.game?.name,
    });
  }
  // Ouvre le fil de commentaires d'une republication de fan art.
  function openRepostThread(comment) {
    setRepostThread({
      id: comment.repost?.id,
      image: comment.repost?.image,
      source: comment.repost?.source,
      author: comment.repost?.author,
      game: comment.game,
    });
  }
  // Média d'une review : chez moi → éditeur de review (là où vit le média),
  // sinon simple visionneuse.
  function openReviewMedia(review, index) {
    if (isMe) return onOpenGame(review, { review: true });
    setLightbox({ items: review.media.map((m) => ({ url: m.url, label: review.name })), index });
  }
  function navLightbox(dir) {
    setLightbox((lb) =>
      lb ? { ...lb, index: (lb.index + dir + lb.items.length) % lb.items.length } : lb
    );
  }

  if (loading)
    return (
      <div className="act-loading">
        <Loader2 size={20} className="spin" /> Chargement de l'activité…
      </div>
    );
  if (error)
    return <div className="profile-empty font-fun">{error}</div>;

  return (
    <div className="act">
      {/* Sous-onglets + tri (aligné à droite) */}
      <div className="act-head">
        <div className="act-subtabs">
          {SUBTABS.map((s) => (
            <button
              key={s.key}
              className={`act-subtab clickable ${sub === s.key ? "active" : ""}`}
              onClick={() => switchSub(s.key)}
            >
              <s.Icon size={16} /> {s.label}
              <span className="act-subtab-count">{counts[s.key]}</span>
            </button>
          ))}
        </div>

        <div className="act-head-tools">
          {sub === "reviews" && spoilerCount > 0 && !isMe && (
            <button
              className={`act-spoiler-btn clickable ${showSpoilers ? "on" : ""}`}
              onClick={() => setShowSpoilers((v) => !v)}
            >
              {showSpoilers ? <Eye size={15} /> : <EyeOff size={15} />}
              {showSpoilers ? "Spoilers affichés" : "Afficher les spoilers"}
            </button>
          )}
          <label className="act-sort">
            <span className="act-sort-label">Trier</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {sorts.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Contenu */}
      {sub === "reviews" &&
        (sortedReviews.length === 0 ? (
          <div className="profile-empty font-fun">
            {isMe ? "Tu n'as pas encore écrit de review." : "Aucune review pour l'instant."}
          </div>
        ) : (
          <div className="grv-list">
            {sortedReviews.map((r) => (
              <ReviewItem
                key={r.gameId}
                r={r}
                variant="game"
                gameId={r.gameId}
                token={token}
                isMine={isMe}
                viewerFinished={libraryMap?.[r.gameId]?.status === "finished"}
                forceReveal={showSpoilers}
                onOpenGame={() => navigate(`/game/${r.gameId}`)}
                onOpenReview={() => navigate(`/game/${r.gameId}?tab=reviews`)}
                onEdit={() => setEditReview(r)}
                onDelete={() => deleteReview(r)}
                onReact={(userId, type) => reactTo(r.gameId, userId, type)}
              />
            ))}
          </div>
        ))}

      {sub === "comments" &&
        (sortedComments.length === 0 ? (
          <div className="profile-empty font-fun">
            {isMe ? "Tu n'as pas encore commenté." : "Aucun commentaire pour l'instant."}
          </div>
        ) : (
          <div className="cm-list">
            {sortedComments.map((cm) =>
              cm.kind === "review" ? (
                <ReviewCommentCard
                  key={cm.id}
                  comment={cm}
                  onOpen={() => navigate(`/game/${cm.game.id}?tab=reviews`)}
                  onOpenMedia={(i) =>
                    setLightbox({
                      items: cm.media.map((m) => ({ url: m.url, label: cm.game.name })),
                      index: i,
                    })
                  }
                />
              ) : cm.kind === "ost" ? (
                <OstCommentCard
                  key={cm.id}
                  comment={cm}
                  onOpen={() => openOstThread(cm)}
                  onOpenMedia={() => openOstThread(cm)}
                />
              ) : cm.kind === "repost" ? (
                <RepostCommentCard
                  key={cm.id}
                  comment={cm}
                  onOpen={() => openRepostThread(cm)}
                  onOpenMedia={() => openRepostThread(cm)}
                />
              ) : (
                <CommentCard
                  key={cm.id}
                  comment={cm}
                  onOpenThread={(c) => openThread(c)}
                  onOpenMedia={openCommentMedia}
                />
              )
            )}
          </div>
        ))}

      {sub === "media" &&
        (media.length === 0 ? (
          <div className="profile-empty font-fun">Aucun média partagé pour l'instant.</div>
        ) : (
          <div className="act-media-grid">
            {media.map((m, i) => (
              <button
                key={i}
                className="act-media-tile clickable"
                onClick={() =>
                  m.kind === "comment"
                    ? openCommentMedia(m.comment, m.mediaIndex)
                    : m.kind === "ostcomment"
                    ? openOstThread(m.comment)
                    : m.kind === "repostcomment"
                    ? openRepostThread(m.comment)
                    : openReviewMedia(m.review, m.mediaIndex)
                }
                title={m.label}
              >
                <img src={m.url} alt="" loading="lazy" />
                {m.type === "gif" && <span className="lc-media-tag">GIF</span>}
                <span className="act-media-src">
                  {m.kind === "review" ? <Star size={11} /> : <MessageCircle size={11} />}
                </span>
              </button>
            ))}
          </div>
        ))}

      {lightbox && (
        <Lightbox
          items={lightbox.items}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNav={navLightbox}
        />
      )}

      {thread && (
        <CommentThreadModal
          listId={thread.listId}
          commentId={thread.commentId}
          focusMedia={thread.focusMedia}
          token={token}
          onClose={() => setThread(null)}
        />
      )}

      {ostThread && (
        <OstCommentsModal
          ownerId={ostThread.ownerId}
          gameId={ostThread.gameId}
          ost={ostThread.ost}
          gameName={ostThread.gameName}
          token={token}
          onClose={() => setOstThread(null)}
        />
      )}

      {repostThread && (
        <RepostCommentsModal
          repost={repostThread}
          token={token}
          onClose={() => setRepostThread(null)}
        />
      )}

      {editReview && (
        <ReviewModal
          game={{ id: editReview.gameId, name: editReview.name, cover: editReview.cover }}
          token={token}
          initial={editReview}
          isNew={false}
          onClose={() => setEditReview(null)}
          onSaved={() => {
            setEditReview(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
