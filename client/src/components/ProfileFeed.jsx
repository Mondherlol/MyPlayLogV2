import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  Repeat2,
  ExternalLink,
  Loader2,
  X,
  Gamepad2,
  BarChart3,
  Images,
  Camera,
  Check,
  LayoutGrid,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import RepostCommentsModal from "./RepostCommentsModal";
import VideoCommentsModal from "./VideoCommentsModal";
import GameMediaCommentsModal from "./GameMediaCommentsModal";
import { Lightbox as GameMediaLightbox } from "./GameMediaWall";
import VideoPlayerModal from "./VideoPlayerModal";
import GemsFeedModal from "./GemsFeedModal";
import BlindTestResultsModal from "./BlindTestResultsModal";
import { FeedCard, FeedCardsSkeleton, isPostItem } from "./FeedCards";

// Onglet « Feed » du profil : TOUTE l'activité du joueur, façon Twitter —
// actions de bibliothèque (terminé, noté, OST choisie…), listes créées,
// abonnements, réactions aux avis, fan arts republiés, documentaires
// recommandés, pépites. Mêmes cartes que le fil d'accueil (FeedCards.jsx).
// Deux sous-onglets : « Tout » (fil complet) et « Médias » (fan arts seuls).
// Le rail latéral (stats + bento) est alimenté indépendamment du fil pour
// être visible dès l'arrivée, quel que soit le contenu déjà scrollé.
const SUBTABS = [
  { key: "all", label: "Tout", Icon: LayoutGrid },
  { key: "media", label: "Médias", Icon: Images },
];

export default function ProfileFeed({ username, isMe, token, onSetCover }) {
  const { user: viewer } = useAuth();
  const me = viewer?.username || null;

  // Sous-onglet persisté dans l'URL (survit au refresh, partageable).
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("fsub") || "all";
  const tab = SUBTABS.some((t) => t.key === rawTab) ? rawTab : "all";
  const setTab = (t) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (t === "all") p.delete("fsub");
        else p.set("fsub", t);
        return p;
      },
      { replace: true }
    );

  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Rail latéral, indépendant du fil : stats fan arts + dernières images.
  const [stats, setStats] = useState(null);
  const [bento, setBento] = useState([]);
  const [lightbox, setLightbox] = useState(null); // repost affiché en grand
  const [playing, setPlaying] = useState(null); // vidéo en lecture (objet video)
  const [commentsFor, setCommentsFor] = useState(null); // repost → modale commentaires
  const [commentsForVideo, setCommentsForVideo] = useState(null); // vidéo → modale
  const [commentsForPost, setCommentsForPost] = useState(null); // post mur média → modale
  const [mediaViewer, setMediaViewer] = useState(null); // { item, index } — images d'un post en grand
  const [gemsFor, setGemsFor] = useState(null); // découverte de pépites → modale
  const [blindTestFor, setBlindTestFor] = useState(null); // blind test → modale résultats
  // La modale de réponses doit lire l'item À JOUR (un like posé dedans doit se
  // voir tout de suite) : on garde l'id et on relit la liste.
  const postItem = commentsForPost
    ? items.find((i) => i.id === commentsForPost.id) || commentsForPost
    : null;
  const sentinelRef = useRef(null);
  // Refs miroirs pour que l'observer (créé une fois) lise l'état courant.
  const stateRef = useRef({ cursor: null, busy: false });
  stateRef.current = { cursor, busy: loading || loadingMore };

  const feedUrl = (extra) =>
    `/feed/user/${username}?limit=12${tab === "media" ? "&only=media" : ""}${extra || ""}`;

  // Première page du fil (réinitialisée si on change de profil ou d'onglet).
  useEffect(() => {
    let alive = true;
    setItems([]);
    setCursor(null);
    setLoading(true);
    apiFetch(feedUrl(), { token })
      .then((d) => {
        if (!alive) return;
        setItems(d.items || []);
        setCursor(d.nextCursor || null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token, tab]);

  // Rail latéral : récupéré une fois par profil, indépendamment du fil (le
  // bento doit être plein dès l'arrivée, sans attendre de scroller le feed).
  useEffect(() => {
    let alive = true;
    setStats(null);
    setBento([]);
    apiFetch(`/feed/user/${username}?limit=6&only=media`, { token })
      .then((d) => {
        if (!alive) return;
        setStats(d.stats || null);
        setBento(d.items || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [username, token]);

  async function loadMore() {
    const { cursor: c, busy } = stateRef.current;
    if (!c || busy) return;
    setLoadingMore(true);
    try {
      const d = await apiFetch(feedUrl(`&before=${encodeURIComponent(c)}`), { token });
      setItems((prev) => {
        // Dédoublonnage par id : un évènement ajouté entre deux pages peut
        // décaler le curseur et faire réapparaître un élément déjà affiché.
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
  }, [loading, tab]);

  const patchRepost = (id, patch) => {
    const apply = (list) =>
      list.map((i) =>
        i.id === id ? { ...i, repost: { ...i.repost, ...patch } } : i
      );
    setItems(apply);
    setBento(apply);
  };

  const patchVideo = (id, patch) =>
    setItems((list) =>
      list.map((i) => (i.id === id ? { ...i, video: { ...i.video, ...patch } } : i))
    );

  const patchPost = (id, patch) =>
    setItems((list) =>
      list.map((i) => (i.id === id ? { ...i, post: { ...i.post, ...patch } } : i))
    );

  // Like optimiste d'un post du mur média.
  async function togglePostLike(item) {
    const p = item.post;
    const was = { liked: p.liked, likeCount: p.likeCount };
    patchPost(item.id, { liked: !p.liked, likeCount: p.likeCount + (p.liked ? -1 : 1) });
    try {
      const d = await apiFetch(`/game-media/${p.id}/like`, { method: "POST", token });
      patchPost(item.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchPost(item.id, was);
    }
  }

  // Like optimiste d'une vidéo recommandée.
  async function toggleVideoLike(item) {
    const v = item.video;
    const was = { liked: v.liked, likeCount: v.likeCount };
    patchVideo(item.id, { liked: !v.liked, likeCount: (v.likeCount || 0) + (v.liked ? -1 : 1) });
    try {
      const d = await apiFetch(`/videos/${v.id}/like`, { method: "POST", token });
      patchVideo(item.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchVideo(item.id, was);
    }
  }

  // « Regarder plus tard » : bascule la vidéo dans MA liste privée.
  async function toggleVideoLater(item) {
    const v = item.video;
    const was = v.later;
    patchVideo(item.id, { later: !was });
    try {
      const d = await apiFetch("/videos/later", {
        method: "POST",
        token,
        body: {
          video: {
            videoId: v.videoId,
            title: v.title,
            author: v.author,
            thumb: v.thumb,
            duration: v.duration,
            gameId: item.game?.id || null,
            gameName: item.game?.name || null,
          },
        },
      });
      patchVideo(item.id, { later: d.later });
    } catch {
      patchVideo(item.id, { later: was });
    }
  }

  // Like optimiste d'une republication.
  async function toggleLike(item) {
    const r = item.repost;
    const was = { liked: r.liked, likeCount: r.likeCount };
    patchRepost(item.id, {
      liked: !r.liked,
      likeCount: r.likeCount + (r.liked ? -1 : 1),
    });
    try {
      const d = await apiFetch(`/reposts/${r.id}/like`, { method: "POST", token });
      patchRepost(item.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchRepost(item.id, was);
    }
  }

  // Republier sur MON feed un fan art vu sur le feed d'un autre joueur
  // (toggle optimiste ; le serveur copie l'image locale du repost source).
  async function toggleRepost(item) {
    const was = item.repost.repostedByMe;
    patchRepost(item.id, { repostedByMe: !was });
    try {
      const d = await apiFetch("/reposts", {
        method: "POST",
        token,
        body: { fromRepostId: item.repost.id },
      });
      patchRepost(item.id, { repostedByMe: !!d.reposted });
    } catch {
      patchRepost(item.id, { repostedByMe: was });
    }
  }

  // Retirer un de MES fan arts republiés (fil + rail mis à jour).
  async function removeRepost(item) {
    if (!window.confirm("Retirer ce fan art de ton feed ?")) return;
    const prev = { items, bento, stats };
    setItems((list) => list.filter((i) => i.id !== item.id));
    setBento((list) => list.filter((i) => i.id !== item.id));
    setStats((s) =>
      s
        ? {
            ...s,
            total: s.total - 1,
            sources: s.sources
              .map((x) => (x.source === item.repost.source ? { ...x, n: x.n - 1 } : x))
              .filter((x) => x.n > 0),
            topGames: s.topGames
              .map((g) => (g.id === item.game?.id ? { ...g, n: g.n - 1 } : g))
              .filter((g) => g.n > 0),
          }
        : s
    );
    try {
      await apiFetch(`/reposts/${item.repost.id}`, { method: "DELETE", token });
    } catch (err) {
      setItems(prev.items);
      setBento(prev.bento);
      setStats(prev.stats);
      alert(err.message);
    }
  }

  const emptyText =
    tab === "media"
      ? isMe
        ? "Aucun fan art republié — republie-en depuis l'onglet Feed d'un jeu, ils s'afficheront ici."
        : "Aucun fan art republié pour l'instant."
      : isMe
        ? "Ton feed est vide — joue, note, crée des listes ou republie des fan arts : toute ton activité s'affichera ici."
        : "Aucune activité pour l'instant.";

  return (
    <section className="pff">
      {/* Sous-onglets : tout le fil / fan arts seulement */}
      <div className="act-head pff-subhead">
        <div className="act-subtabs">
          {SUBTABS.map((s) => (
            <button
              key={s.key}
              className={`act-subtab clickable ${tab === s.key ? "active" : ""}`}
              onClick={() => setTab(s.key)}
            >
              <s.Icon size={16} /> {s.label}
              {s.key === "media" && stats?.total > 0 && (
                <span className="act-subtab-count">{stats.total}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="pff-layout">
        <div className="pff-main">
          {loading ? (
            <FeedCardsSkeleton />
          ) : !items.length ? (
            <div className="pff-empty">
              <span className="pff-empty-icon">
                <Repeat2 size={26} />
              </span>
              <p className="font-fun">{emptyText}</p>
            </div>
          ) : (
            <div className="hf-feed pff-col">
              {items.map((item) => (
                <FeedCard
                  key={item.id}
                  item={item}
                  me={me}
                  token={token}
                  onLike={() =>
                    item.type === "video"
                      ? toggleVideoLike(item)
                      : isPostItem(item)
                        ? togglePostLike(item)
                        : toggleLike(item)
                  }
                  onComments={() =>
                    item.type === "video" || item.type === "videoact"
                      ? setCommentsForVideo(item)
                      : isPostItem(item)
                        ? setCommentsForPost(item)
                        : setCommentsFor(item)
                  }
                  onLater={() => toggleVideoLater(item)}
                  onRepost={() => toggleRepost(item)}
                  onOpenImage={(i) =>
                    item.type === "gamemediapost"
                      ? setMediaViewer({ item, index: i })
                      : setLightbox(item)
                  }
                  onPlay={(v) => setPlaying(v)}
                  onOpenGems={() => setGemsFor(item)}
                  onOpenBlindTest={() => setBlindTestFor(item)}
                  onRemove={isMe ? () => removeRepost(item) : undefined}
                />
              ))}
            </div>
          )}

          {/* Sentinelle de scroll infini + indicateur de chargement */}
          <div ref={sentinelRef} className="pff-sentinel" aria-hidden="true" />
          {loadingMore && (
            <div className="pff-more">
              <Loader2 size={18} className="spin" /> Chargement…
            </div>
          )}
          {!loading && !cursor && items.length > 5 && (
            <p className="pff-end font-fun">C'est tout pour l'instant ✦</p>
          )}
        </div>

        {/* Rail latéral : stats fan arts + bento médias (masqué sur mobile) */}
        <aside className="pff-rail">
          <StatsWidget stats={stats} isMe={isMe} />
          <MediaBento
            items={bento}
            total={stats?.total ?? null}
            onOpen={setLightbox}
            onOpenAll={() => setTab("media")}
          />
        </aside>
      </div>

      {lightbox && (
        <RepostLightbox
          item={lightbox}
          onSetCover={onSetCover}
          onClose={() => setLightbox(null)}
        />
      )}
      {playing && (
        <VideoPlayerModal
          video={playing}
          resumeAt={playing.positionSeconds || 0}
          token={token}
          onClose={() => setPlaying(null)}
        />
      )}
      {commentsFor && (
        <RepostCommentsModal
          repost={{ ...commentsFor.repost, game: commentsFor.game }}
          token={token}
          onCountChange={(n) => patchRepost(commentsFor.id, { commentCount: n })}
          onClose={() => setCommentsFor(null)}
        />
      )}
      {commentsForVideo && (
        <VideoCommentsModal
          video={commentsForVideo.video}
          token={token}
          onCountChange={(n) => patchVideo(commentsForVideo.id, { commentCount: n })}
          onClose={() => setCommentsForVideo(null)}
        />
      )}
      {postItem && (
        <GameMediaCommentsModal
          post={postItem.post}
          game={postItem.game}
          token={token}
          focusCommentId={postItem.commentId || null}
          onLike={() => togglePostLike(postItem)}
          onCountChange={(n) => patchPost(postItem.id, { commentCount: n })}
          onClose={() => setCommentsForPost(null)}
        />
      )}
      {mediaViewer && (
        <GameMediaLightbox
          media={mediaViewer.item.post.media}
          index={mediaViewer.index}
          post={mediaViewer.item.post}
          onIndex={(i) => setMediaViewer((v) => ({ ...v, index: i }))}
          onClose={() => setMediaViewer(null)}
          onLike={() => togglePostLike(mediaViewer.item)}
        />
      )}
      {gemsFor && <GemsFeedModal item={gemsFor} onClose={() => setGemsFor(null)} />}
      {blindTestFor && (
        <BlindTestResultsModal
          item={blindTestFor}
          token={token}
          onClose={() => setBlindTestFor(null)}
        />
      )}
    </section>
  );
}

// Widget stats : total, répartition par source (barres), jeux les plus republiés.
// Toujours affiché, même à zéro : le rail ne doit pas disparaître d'un profil
// à l'autre — une colonne qui apparaît/disparaît décale toute la page.
function StatsWidget({ stats, isMe }) {
  if (!stats || !stats.total) {
    return (
      <div className="pff-widget">
        <h3 className="pff-w-title">
          <BarChart3 size={15} /> Fan arts
        </h3>
        <p className="pff-w-empty">
          {isMe
            ? "Aucun fan art republié — republies-en depuis l'onglet Feed d'un jeu et tes statistiques s'afficheront ici."
            : "Aucun fan art republié pour l'instant."}
        </p>
      </div>
    );
  }
  const max = Math.max(...stats.sources.map((s) => s.n), 1);
  return (
    <div className="pff-widget">
      <h3 className="pff-w-title">
        <BarChart3 size={15} /> Fan arts
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

// Bento « Médias » : mosaïque des dernières republications (images locales),
// alimentée indépendamment du fil. La tuile « +N » bascule vers l'onglet
// Médias (tous les fan arts).
function MediaBento({ items, total, onOpen, onOpenAll }) {
  const shown = items.slice(0, 6);
  // Vide : on garde la carte (avec sa mosaïque fantôme) pour que le rail ait
  // la même silhouette sur tous les profils.
  if (!shown.length) {
    return (
      <div className="pff-widget">
        <h3 className="pff-w-title">
          <Images size={15} /> Médias
        </h3>
        <div className="pff-bento empty" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="pff-bento-ph" />
          ))}
        </div>
      </div>
    );
  }
  const rest = (total ?? items.length) - shown.length;
  return (
    <div className="pff-widget">
      <h3 className="pff-w-title">
        <Images size={15} /> Médias
      </h3>
      <div className="pff-bento">
        {shown.map((item, i) => {
          const isMore = rest > 0 && i === shown.length - 1;
          return (
            <button
              key={item.id}
              className="pff-bento-item clickable"
              onClick={() => (isMore ? onOpenAll() : onOpen(item))}
              title={isMore ? "Voir tous les fan arts" : item.game?.name}
            >
              <img src={item.repost.image} alt="" loading="lazy" draggable="false" />
              {isMore && <span className="pff-bento-more">+{rest}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Visionneuse plein écran d'un repost (image locale, grande) — garde le bouton
// « En faire ma couverture » propre au profil.
function RepostLightbox({ item, onSetCover, onClose }) {
  const r = item.repost;
  const [coverState, setCoverState] = useState("idle"); // idle | busy | done

  async function useAsCover() {
    if (coverState !== "idle" || !onSetCover) return;
    setCoverState("busy");
    try {
      await onSetCover(r.image);
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
        <img src={r.image} alt="" draggable="false" />
        <figcaption className="pff-lb-bar">
          <span className={`gp-feed-src-badge static src-${r.source.toLowerCase()}`}>
            {r.source}
          </span>
          {r.author && <span className="pff-lb-author">par {r.author}</span>}
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
          {r.url && (
            <a
              className="gp-feed-lb-link clickable"
              href={r.url}
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
