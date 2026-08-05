import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ThumbsUp,
  Clock,
  Loader2,
  Play,
  X,
  Trash2,
  Gamepad2,
  Film,
  History,
  Plus,
  Link2,
  Heart,
  MessageCircle,
  Repeat2,
  RotateCcw,
  Check,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import VideoPlayerModal from "./VideoPlayerModal";
import VideoCommentsModal from "./VideoCommentsModal";

// Onglet « Vidéos » du profil : recommandations (public), historique de
// visionnage (public, avec reprise) et « à regarder plus tard » (privé). Une
// seule card riche est partagée par les trois onglets ; likes & commentaires
// sont GLOBAUX par vidéo (couche VideoSocial) — les mêmes partout où la vidéo
// apparaît (fil d'accueil compris).
export default function ProfileVideos({ username, isMe, token }) {
  const TABS = [
    { key: "recommended", label: "Recommandations", Icon: ThumbsUp },
    { key: "history", label: "Historique", Icon: History },
    ...(isMe ? [{ key: "later", label: "Regarder plus tard", Icon: Clock }] : []),
  ];
  const [sub, setSub] = useState("recommended");
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(null); // vidéo en lecture (lightbox)
  const [commentsFor, setCommentsFor] = useState(null); // vidéo → modale commentaires
  const [showAdd, setShowAdd] = useState(false); // modale « Recommander une vidéo »

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/videos/user/${username}?type=${sub}`, { token })
      .then((d) => alive && setVideos(d.videos || []))
      .catch(() => alive && setVideos([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, sub, token]);

  useEffect(() => load(), [load]);

  // Patch optimiste d'une vidéo de la liste (par id de card).
  const patch = (id, up) =>
    setVideos((list) =>
      list.map((v) => (v.id === id ? { ...v, ...(typeof up === "function" ? up(v) : up) } : v))
    );

  // Snapshot pour les endpoints de relation (later / recommend).
  const snapshot = (v) => ({
    videoId: v.videoId,
    title: v.title,
    author: v.author,
    thumb: v.thumb,
    duration: v.duration,
    gameId: v.game?.id || null,
    gameName: v.game?.name || null,
  });

  // Like GLOBAL (toggle optimiste).
  async function toggleLike(v) {
    const was = { liked: v.liked, likeCount: v.likeCount };
    patch(v.id, { liked: !v.liked, likeCount: (v.likeCount || 0) + (v.liked ? -1 : 1) });
    try {
      const d = await apiFetch(`/videos/${v.id}/like`, { method: "POST", token });
      patch(v.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patch(v.id, was);
    }
  }

  // « Regarder plus tard » (toggle). Sur l'onglet later, retirer = enlever la card.
  async function toggleLater(v) {
    const was = v.later;
    patch(v.id, { later: !was });
    try {
      const d = await apiFetch("/videos/later", {
        method: "POST",
        token,
        body: { video: snapshot(v) },
      });
      if (sub === "later" && !d.later) {
        setVideos((list) => list.filter((x) => x.id !== v.id));
      } else {
        patch(v.id, { later: d.later });
      }
    } catch {
      patch(v.id, { later: was });
    }
  }

  // Recommander / retirer la recommandation (toggle). Sur l'onglet recommended
  // (mon profil), retirer = enlever la card.
  async function toggleRecommend(v) {
    const was = v.recommended;
    patch(v.id, { recommended: !was });
    try {
      const d = await apiFetch("/videos/recommend", {
        method: "POST",
        token,
        body: { video: snapshot(v) },
      });
      if (sub === "recommended" && isMe && !d.recommended) {
        setVideos((list) => list.filter((x) => x.id !== v.id));
      } else {
        patch(v.id, { recommended: d.recommended });
      }
    } catch {
      patch(v.id, { recommended: was });
    }
  }

  // Retirer une vidéo de l'onglet courant (recommended / later).
  async function remove(v) {
    setVideos((list) => list.filter((x) => x.id !== v.id));
    try {
      await apiFetch(`/videos/${v.id}?type=${sub}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  // Vidéo recommandée par URL : on l'ajoute côté recommandations.
  function onRecommended(card) {
    setShowAdd(false);
    if (sub === "recommended") {
      setVideos((list) => [card, ...list.filter((v) => v.id !== card.id)]);
    } else {
      setSub("recommended");
    }
  }

  // Fermer le lecteur : rafraîchit l'onglet Historique (barres de progression).
  function closePlayer() {
    setPlaying(null);
    if (sub === "history") load();
  }

  return (
    <section className="profile-section">
      <div className="act-head">
        <div className="act-subtabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`act-subtab clickable ${sub === t.key ? "active" : ""}`}
              onClick={() => setSub(t.key)}
            >
              <t.Icon size={16} /> {t.label}
            </button>
          ))}
        </div>
        {isMe && (
          <button className="vid-add-btn clickable" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Recommander une vidéo
          </button>
        )}
      </div>

      {loading ? (
        <div className="doc-state">
          <Loader2 size={22} className="spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="profile-empty font-fun">
          <Film size={26} style={{ marginBottom: 8 }} />
          <div>
            {sub === "recommended"
              ? isMe
                ? "Tu n'as recommandé aucune vidéo. Colle une URL ou lances-en depuis l'accueil !"
                : "Aucune vidéo recommandée pour l'instant."
              : sub === "history"
                ? "Aucune vidéo regardée pour l'instant."
                : "Aucune vidéo à regarder plus tard."}
          </div>
        </div>
      ) : (
        <div className="pv-list">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              v={v}
              sub={sub}
              isMe={isMe}
              onPlay={() => setPlaying(v)}
              onLike={() => toggleLike(v)}
              onLater={() => toggleLater(v)}
              onRecommend={() => toggleRecommend(v)}
              onComments={() => setCommentsFor(v)}
              onRemove={() => remove(v)}
            />
          ))}
        </div>
      )}

      {playing && (
        <VideoPlayerModal
          video={playing}
          resumeAt={playing.positionSeconds || 0}
          token={token}
          onClose={closePlayer}
        />
      )}

      {commentsFor && (
        <VideoCommentsModal
          video={commentsFor}
          token={token}
          onCountChange={(n) => patch(commentsFor.id, { commentCount: n })}
          onClose={() => setCommentsFor(null)}
        />
      )}

      {showAdd && (
        <RecommendVideoModal
          token={token}
          onDone={onRecommended}
          onClose={() => setShowAdd(false)}
        />
      )}
    </section>
  );
}

// Pile d'avatars des amis ayant regardé ou liké la vidéo (preuve sociale).
function FriendsRow({ friends, total }) {
  if (!friends?.length) return null;
  return (
    <div className="pv-friends" title="Des amis ont regardé ou liké cette vidéo">
      <div className="pv-friends-av-stack">
        {friends.map((f, i) => (
          <Link
            key={f.username}
            to={`/u/${f.username}`}
            className="pv-friends-av clickable"
            style={{ zIndex: friends.length - i }}
            title={f.username}
          >
            {f.avatar ? (
              <img src={f.avatar} alt={f.username} loading="lazy" draggable="false" />
            ) : (
              <span className="pv-friends-fb">{f.username[0].toUpperCase()}</span>
            )}
          </Link>
        ))}
      </div>
      <span className="pv-friends-txt">
        <b>{friends[0].username}</b>
        {total > 1 && ` et ${total - 1} autre${total - 1 > 1 ? "s" : ""}`} ont vu
      </span>
    </div>
  );
}

// Card vidéo unique — partagée par les 3 onglets. Miniature avec reprise,
// titre lisible (clair/sombre), infos, amis, et barre d'actions sociales.
function VideoCard({ v, sub, isMe, onPlay, onLike, onLater, onRecommend, onComments, onRemove }) {
  const pct =
    v.durationSeconds > 0
      ? Math.min(100, Math.round((v.positionSeconds / v.durationSeconds) * 100))
      : v.positionSeconds > 0
        ? 6
        : 0;
  const resuming = pct > 0 && pct < 100;

  return (
    <article className="pv-card">
      <button className="pv-thumb clickable" onClick={onPlay} title={v.title}>
        <img src={v.thumb} alt="" loading="lazy" draggable="false" />
        <span className="pv-thumb-play">
          <Play size={22} fill="currentColor" />
        </span>
        {v.duration && <span className="pv-thumb-dur">{v.duration}</span>}
        {resuming && (
          <span className="pv-thumb-chip">
            <RotateCcw size={11} /> Reprendre
          </span>
        )}
        {pct > 0 && (
          <span className="pv-thumb-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>

      <div className="pv-body">
        <div className="pv-top">
          <h4 className="pv-title" title={v.title}>
            {v.title}
          </h4>
          {isMe && (sub === "recommended" || sub === "later") && (
            <button className="pv-remove clickable" onClick={onRemove} title="Retirer">
              <Trash2 size={15} />
            </button>
          )}
        </div>

        <div className="pv-meta">
          {v.author && <span className="pv-chan">{v.author}</span>}
          {v.game && (
            <Link to={`/game/${v.game.id}`} className="pv-game clickable">
              <Gamepad2 size={12} /> {v.game.name}
            </Link>
          )}
          {sub === "history" && (
            <span className="pv-resume-tag">
              {resuming ? `Vu à ${pct}%` : "Terminée"}
            </span>
          )}
        </div>

        <FriendsRow friends={v.friends} total={v.friendCount} />

        <div className="pv-actions">
          <button
            className={`pv-act like clickable ${v.liked ? "on" : ""}`}
            onClick={onLike}
            title="J'aime"
          >
            <Heart size={16} fill={v.liked ? "currentColor" : "none"} />
            {v.likeCount > 0 && <span>{v.likeCount}</span>}
          </button>
          <button className="pv-act clickable" onClick={onComments} title="Commenter">
            <MessageCircle size={16} />
            {v.commentCount > 0 && <span>{v.commentCount}</span>}
          </button>
          <button
            className={`pv-act reco clickable ${v.recommended ? "on" : ""}`}
            onClick={onRecommend}
            title={v.recommended ? "Retirer la recommandation" : "Recommander cette vidéo"}
          >
            {v.recommended ? <Check size={16} /> : <Repeat2 size={16} />}
            <span>{v.recommended ? "Recommandée" : "Recommander"}</span>
          </button>
          <button
            className={`pv-act later clickable ${v.later ? "on" : ""}`}
            onClick={onLater}
            title={v.later ? "Retirer de « à regarder plus tard »" : "Regarder plus tard"}
          >
            <Clock size={16} />
            <span>{v.later ? "Enregistrée" : "Plus tard"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

// Modale « Recommander une vidéo » : on colle une URL YouTube, le serveur en
// résout les métadonnées (oEmbed) et l'ajoute aux recommandations publiques.
function RecommendVideoModal({ token, onDone, onClose }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch("/videos/recommend-url", {
        method: "POST",
        token,
        body: { url: url.trim() },
      });
      onDone(d.video);
    } catch (err) {
      setError(err.message || "Impossible de recommander cette vidéo.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal vid-add-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">
          <ThumbsUp size={18} /> Recommander une vidéo
        </h2>
        <p className="vid-add-sub font-fun">
          Colle l'URL d'une vidéo YouTube : elle apparaîtra dans tes
          recommandations et dans le pool « Lancer un documentaire ».
        </p>
        <form onSubmit={submit} className="vid-add-form">
          <div className="vid-add-input">
            <Link2 size={16} />
            <input
              type="url"
              autoFocus
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          {error && <p className="lc-error">{error}</p>}
          <div className="vid-add-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
              Recommander
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
