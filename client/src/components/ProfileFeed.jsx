import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Repeat2,
  ExternalLink,
  Trash2,
  Loader2,
  X,
  Gamepad2,
  BarChart3,
  Images,
  Heart,
  MessageCircle,
  Camera,
  Check,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import RepostCommentsModal from "./RepostCommentsModal";

// Onglet « Feed » du profil : les fan arts republiés, façon Twitter.
// Les images sont servies par NOTRE serveur (téléchargées au repost) : zéro
// requête vers les APIs externes, même avec des centaines de posts.
// Pagination par curseur + chargement automatique au scroll (sentinelle
// IntersectionObserver), comme une timeline.
export default function ProfileFeed({ username, isMe, token, profile, onSetCover }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [stats, setStats] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [commentsFor, setCommentsFor] = useState(null); // repost dont la modale de commentaires est ouverte
  const sentinelRef = useRef(null);
  // Refs miroirs pour que l'observer (créé une fois) lise l'état courant.
  const stateRef = useRef({ cursor: null, busy: false });
  stateRef.current = { cursor, busy: loading || loadingMore };

  // Première page (réinitialisée si on change de profil).
  useEffect(() => {
    let alive = true;
    setItems([]);
    setCursor(null);
    setTotal(null);
    setStats(null);
    setLoading(true);
    apiFetch(`/reposts/user/${username}?limit=15`, { token })
      .then((d) => {
        if (!alive) return;
        setItems(d.items || []);
        setCursor(d.nextCursor || null);
        setTotal(d.total ?? null);
        setStats(d.stats || null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  async function loadMore() {
    const { cursor: c, busy } = stateRef.current;
    if (!c || busy) return;
    setLoadingMore(true);
    try {
      const d = await apiFetch(
        `/reposts/user/${username}?limit=15&before=${encodeURIComponent(c)}`,
        { token }
      );
      setItems((prev) => {
        // Dédoublonnage par id : un repost ajouté entre deux pages peut décaler
        // le curseur et faire réapparaître un élément déjà affiché.
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...(d.items || []).filter((i) => !seen.has(i.id))];
      });
      setCursor(d.nextCursor || null);
    } catch {
      /* on retentera au prochain passage de la sentinelle */
    } finally {
      setLoadingMore(false);
    }
  }

  // Sentinelle en bas de liste : dès qu'elle approche du viewport, page suivante.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const patchItem = (id, patch) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // Like optimiste d'une republication.
  async function toggleItemLike(item) {
    const was = { liked: item.liked, likeCount: item.likeCount };
    patchItem(item.id, {
      liked: !item.liked,
      likeCount: item.likeCount + (item.liked ? -1 : 1),
    });
    try {
      const d = await apiFetch(`/reposts/${item.id}/like`, { method: "POST", token });
      patchItem(item.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchItem(item.id, was);
    }
  }

  // Republier sur MON feed un fan art vu sur le feed d'un autre joueur
  // (toggle optimiste ; le serveur copie l'image locale du repost source).
  async function toggleItemRepost(item) {
    const was = item.repostedByMe;
    patchItem(item.id, { repostedByMe: !was });
    try {
      const d = await apiFetch("/reposts", {
        method: "POST",
        token,
        body: { fromRepostId: item.id },
      });
      patchItem(item.id, { repostedByMe: !!d.reposted });
    } catch {
      patchItem(item.id, { repostedByMe: was });
    }
  }

  async function removeRepost(item) {
    if (!window.confirm("Retirer ce fan art de ton feed ?")) return;
    // Snapshots pour restaurer à l'identique si le serveur refuse.
    const prev = { items, total, stats };
    setItems((list) => list.filter((i) => i.id !== item.id));
    setTotal((t) => (t != null ? t - 1 : t));
    setStats((s) =>
      s
        ? {
            ...s,
            total: s.total - 1,
            sources: s.sources
              .map((x) => (x.source === item.source ? { ...x, n: x.n - 1 } : x))
              .filter((x) => x.n > 0),
            topGames: s.topGames
              .map((g) => (g.id === item.game?.id ? { ...g, n: g.n - 1 } : g))
              .filter((g) => g.n > 0),
          }
        : s
    );
    try {
      await apiFetch(`/reposts/${item.id}`, { method: "DELETE", token });
    } catch (err) {
      setItems(prev.items);
      setTotal(prev.total);
      setStats(prev.stats);
      alert(err.message);
    }
  }

  if (loading) return <FeedSkeleton />;

  if (!items.length) {
    return (
      <div className="pff-empty">
        <span className="pff-empty-icon">
          <Repeat2 size={26} />
        </span>
        <p className="font-fun">
          {isMe
            ? "Ton feed est vide — republie des fan arts depuis l'onglet Feed d'un jeu, ils s'afficheront ici."
            : "Aucun fan art republié pour l'instant."}
        </p>
      </div>
    );
  }

  return (
    <section className="pff">
      <div className="pff-layout">
        <div className="pff-main">
          <div className="pff-col">
            {items.map((item) => (
              <RepostCard
                key={item.id}
                item={item}
                profile={profile}
                isMe={isMe}
                onOpen={() => setLightbox(item)}
                onRemove={() => removeRepost(item)}
                onLike={() => toggleItemLike(item)}
                onComments={() => setCommentsFor(item)}
                onRepost={() => toggleItemRepost(item)}
              />
            ))}
          </div>

          {/* Sentinelle de scroll infini + indicateur de chargement */}
          <div ref={sentinelRef} className="pff-sentinel" aria-hidden="true" />
          {loadingMore && (
            <div className="pff-more">
              <Loader2 size={18} className="spin" /> Chargement…
            </div>
          )}
          {!cursor && items.length > 5 && (
            <p className="pff-end font-fun">C'est tout pour l'instant ✦</p>
          )}
        </div>

        {/* Rail latéral : stats + bento médias */}
        <aside className="pff-rail">
          <StatsWidget stats={stats} />
          <MediaBento items={items} total={total} onOpen={setLightbox} />
        </aside>
      </div>

      {lightbox && (
        <RepostLightbox
          item={lightbox}
          onSetCover={onSetCover}
          onClose={() => setLightbox(null)}
        />
      )}

      {commentsFor && (
        <RepostCommentsModal
          repost={commentsFor}
          token={token}
          onCountChange={(n) => patchItem(commentsFor.id, { commentCount: n })}
          onClose={() => setCommentsFor(null)}
        />
      )}
    </section>
  );
}

// Widget stats : total, répartition par source (barres), jeux les plus republiés.
function StatsWidget({ stats }) {
  if (!stats || !stats.total) return null;
  const max = Math.max(...stats.sources.map((s) => s.n), 1);
  return (
    <div className="pff-widget">
      <h3 className="pff-w-title">
        <BarChart3 size={15} /> Statistiques
      </h3>
      <div className="pff-stat-hero">
        <span className="pff-stat-n">{stats.total}</span>
        <span className="pff-stat-label">
          fan art{stats.total > 1 ? "s" : ""} republié{stats.total > 1 ? "s" : ""}
        </span>
      </div>
      <ul className="pff-bars">
        {stats.sources.map((s) => (
          <li key={s.source} className="pff-bar-row">
            <span className="pff-bar-name">{s.source}</span>
            <span className="pff-bar-track">
              <span
                className={`pff-bar-fill src-${s.source.toLowerCase()}`}
                style={{ width: `${Math.round((s.n / max) * 100)}%` }}
              />
            </span>
            <span className="pff-bar-n">{s.n}</span>
          </li>
        ))}
      </ul>
      {stats.topGames.length > 0 && (
        <>
          <h4 className="pff-w-sub">Jeux les plus republiés</h4>
          <ul className="pff-topgames">
            {stats.topGames.map((g) => (
              <li key={g.id}>
                <Link to={`/game/${g.id}`} className="pff-topgame clickable" title={g.name}>
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="pff-topgame-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="pff-topgame-name">{g.name}</span>
                  <span className="pff-topgame-n">{g.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Bento « Médias » : mosaïque des dernières republications (images locales).
function MediaBento({ items, total, onOpen }) {
  const shown = items.slice(0, 6);
  if (!shown.length) return null;
  const rest = (total ?? items.length) - shown.length;
  return (
    <div className="pff-widget">
      <h3 className="pff-w-title">
        <Images size={15} /> Médias
      </h3>
      <div className="pff-bento">
        {shown.map((item, i) => (
          <button
            key={item.id}
            className="pff-bento-item clickable"
            onClick={() => onOpen(item)}
            title={item.game?.name}
          >
            <img src={item.image} alt="" loading="lazy" draggable="false" />
            {rest > 0 && i === shown.length - 1 && (
              <span className="pff-bento-more">+{rest}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function RepostCard({ item, profile, isMe, onOpen, onRemove, onLike, onComments, onRepost }) {
  const g = item.game || {};
  return (
    <article className="pff-card">
      <header className="pff-head">
        <span className="pff-avatar">
          {profile?.avatar ? (
            <img src={profile.avatar} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="pff-avatar-fb">
              {(profile?.username || "?")[0].toUpperCase()}
            </span>
          )}
        </span>
        <div className="pff-who">
          <span className="pff-line">
            <b>{profile?.username}</b>
            <span className="pff-action">
              <Repeat2 size={13} /> a republié un fan art
            </span>
          </span>
          <span className="pff-time" title={new Date(item.createdAt).toLocaleString()}>
            {timeAgo(item.createdAt)}
          </span>
        </div>
        {isMe && (
          <button
            className="pff-del clickable"
            onClick={onRemove}
            title="Retirer de mon feed"
            aria-label="Retirer de mon feed"
          >
            <Trash2 size={15} />
          </button>
        )}
      </header>

      <button className="pff-media clickable" onClick={onOpen}>
        <img
          src={item.image}
          alt={`Fan art ${g.name || ""}`}
          loading="lazy"
          draggable="false"
          style={item.w && item.h ? { aspectRatio: `${item.w} / ${item.h}` } : undefined}
        />
      </button>

      <footer className="pff-foot">
        <Link to={`/game/${g.id}`} className="pff-game clickable" title={g.name}>
          {g.cover ? (
            <img src={g.cover} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="pff-game-ph">
              <Gamepad2 size={13} />
            </span>
          )}
          <span className="pff-game-name">{g.name}</span>
        </Link>
        <span className="pff-foot-spacer" />
        <span className={`pff-tag src-${item.source.toLowerCase()}`}>{item.source}</span>
        {item.author && <span className="pff-credit">par {item.author}</span>}
        {item.url && (
          <a
            className="pff-orig clickable"
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title="Voir le post original"
          >
            Original <ExternalLink size={13} />
          </a>
        )}
      </footer>

      {/* Actions sociales : like, commentaires, republier (feed d'un autre) */}
      <div className="pff-actions">
        <button
          className={`pff-act pff-act-like clickable ${item.liked ? "on" : ""}`}
          onClick={onLike}
          title="J'aime"
        >
          <span className="pff-act-ic">
            <Heart size={17} fill={item.liked ? "currentColor" : "none"} />
          </span>
          <span className="pff-act-n">{item.likeCount > 0 ? item.likeCount : ""}</span>
        </button>
        <button
          className="pff-act pff-act-comment clickable"
          onClick={onComments}
          title="Commentaires"
        >
          <span className="pff-act-ic">
            <MessageCircle size={17} />
          </span>
          <span className="pff-act-n">{item.commentCount > 0 ? item.commentCount : ""}</span>
        </button>
        {!isMe && (
          <button
            className={`pff-act pff-act-repost clickable ${item.repostedByMe ? "on" : ""}`}
            onClick={onRepost}
            title={item.repostedByMe ? "Retirer de mon feed" : "Republier sur mon feed"}
          >
            <span className="pff-act-ic">
              <Repeat2 size={17} />
            </span>
            <span className="pff-act-label">
              {item.repostedByMe ? "Republié" : "Republier"}
            </span>
          </button>
        )}
      </div>
    </article>
  );
}

// Visionneuse plein écran d'un repost (image locale, grande).
function RepostLightbox({ item, onSetCover, onClose }) {
  const [coverState, setCoverState] = useState("idle"); // idle | busy | done

  async function useAsCover() {
    if (coverState !== "idle" || !onSetCover) return;
    setCoverState("busy");
    try {
      await onSetCover(item.image);
      setCoverState("done");
    } catch (err) {
      setCoverState("idle");
      alert(err.message);
    }
  }

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
    <div className="gp-feed-lightbox" onClick={onClose}>
      <button className="gp-feed-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <figure className="pff-lb" onClick={(e) => e.stopPropagation()}>
        <img src={item.image} alt="" draggable="false" />
        <figcaption className="pff-lb-bar">
          <span className={`gp-feed-src-badge static src-${item.source.toLowerCase()}`}>
            {item.source}
          </span>
          {item.author && <span className="pff-lb-author">par {item.author}</span>}
          {onSetCover && (
            <button
              className={`fanart-cover-btn clickable ${coverState === "done" ? "done" : ""}`}
              onClick={useAsCover}
              disabled={coverState !== "idle"}
              title="Utiliser ce fan art comme couverture de mon profil"
            >
              {coverState === "busy" ? (
                <Loader2 size={14} className="spin" />
              ) : coverState === "done" ? (
                <Check size={14} />
              ) : (
                <Camera size={14} />
              )}
              {coverState === "done" ? "Couverture mise à jour" : "En faire ma couverture"}
            </button>
          )}
          {item.url && (
            <a
              className="gp-feed-lb-link clickable"
              href={item.url}
              target="_blank"
              rel="noreferrer"
            >
              Voir le post original <ExternalLink size={14} />
            </a>
          )}
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}

function FeedSkeleton() {
  return (
    <div className="pff" aria-busy="true">
      <div className="pff-col">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="pff-card">
            <div className="pff-head">
              <span className="gp-skel" style={{ width: 40, height: 40, borderRadius: "50%" }} />
              <div className="pff-who">
                <span className="gp-skel gp-skel-bar" style={{ width: "55%" }} />
                <span className="gp-skel gp-skel-bar sm" style={{ width: "25%" }} />
              </div>
            </div>
            <span
              className="gp-skel"
              style={{ display: "block", height: 300 + (i % 2) * 80, borderRadius: 14 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
