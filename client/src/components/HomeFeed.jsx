import { useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { Loader2, Users, Sparkles } from "lucide-react";
import { apiFetch } from "../lib/api";
import RepostCommentsModal from "./RepostCommentsModal";
import VideoCommentsModal from "./VideoCommentsModal";
import GameMediaCommentsModal from "./GameMediaCommentsModal";
import { Lightbox as GameMediaLightbox } from "./GameMediaWall";
import VideoPlayerModal from "./VideoPlayerModal";
import GemsFeedModal from "./GemsFeedModal";
import BlindTestResultsModal from "./BlindTestResultsModal";
import { FeedCard, FanartLightbox, FeedCardsSkeleton } from "./FeedCards";

// Rangée d'avatars des joueurs suivis : filtre le fil sur UN joueur (clic),
// re-clic sur l'actif → retour à tout le monde. Affichée à droite du titre
// « Fil d'actualité » (Welcome.jsx), état porté par le parent.
export function FeedUserFilter({ token, myId, value, onChange }) {
  const [people, setPeople] = useState([]);

  useEffect(() => {
    if (!myId) return;
    let alive = true;
    apiFetch(`/users/${myId}/following`, { token })
      .then((d) => alive && setPeople(d.users || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [myId, token]);

  if (!people.length) return null;

  return (
    <div className="hf-flt" role="group" aria-label="Filtrer le fil par joueur">
      {people.map((u) => {
        const active = value === u.id;
        const dimmed = value && !active;
        return (
          <button
            key={u.id}
            className={`hf-flt-av clickable ${active ? "on" : ""} ${dimmed ? "off" : ""}`}
            onClick={() => onChange(active ? null : u.id)}
            title={active ? `Ne plus filtrer sur ${u.username}` : `Voir uniquement ${u.username}`}
            aria-pressed={active}
          >
            {u.avatar ? (
              <img src={u.avatar} alt={u.username} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-flt-fb">{u.username[0].toUpperCase()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// En-tête et pied du fil virtualisé (définis hors composant → références
// stables, sinon Virtuoso remonte la liste à chaque render). L'état vivant
// (bannière communauté, chargement, fin) est lu via le `context` de Virtuoso.
function FeedHeader({ context }) {
  if (!context.community) return null;
  return (
    <div className="hf-community">
      <Sparkles size={14} />
      Tu ne suis personne pour l'instant : voici l'activité de toute la
      communauté.
    </div>
  );
}

function FeedFooter({ context }) {
  return (
    <>
      {context.loadingMore && (
        <div className="hf-more">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      )}
      {context.atEnd && <p className="hf-end font-fun">Tu es à jour ✦</p>}
    </>
  );
}

const feedComponents = { Header: FeedHeader, Footer: FeedFooter };

// Fil d'actualité de la page d'accueil : timeline des VRAIES actions des
// joueurs suivis (statuts, notes, reviews, OST choisies, listes, abonnements,
// fan arts republiés, documentaires, pépites) — voir routes/feed.js et
// FeedCards.jsx. Pagination par curseur + chargement automatique au scroll.
// `filterUser` (id) restreint le fil à un seul joueur (avatars du titre).
export default function HomeFeed({ token, me, filterUser = null }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [community, setCommunity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState(null); // repost affiché en grand
  const [playing, setPlaying] = useState(null); // vidéo en lecture (objet video)
  const [commentsFor, setCommentsFor] = useState(null); // repost → modale commentaires
  const [commentsForVideo, setCommentsForVideo] = useState(null); // vidéo → modale
  const [commentsForPost, setCommentsForPost] = useState(null); // post mur média → modale
  const [mediaViewer, setMediaViewer] = useState(null); // { item, index } — images d'un post en grand
  const [gemsFor, setGemsFor] = useState(null); // découverte de pépites → modale liste
  const [blindTestFor, setBlindTestFor] = useState(null); // blind test → modale résultats
  // Refs miroirs pour que le chargement (déclenché par Virtuoso) lise l'état courant.
  const stateRef = useRef({ cursor: null, busy: false });
  stateRef.current = { cursor, busy: loading || loadingMore };

  const feedUrl = (extra) =>
    `/feed/home?limit=12${filterUser ? `&u=${filterUser}` : ""}${extra || ""}`;

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
        setCommunity(!!d.community);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterUser]);

  async function loadMore() {
    const { cursor: c, busy } = stateRef.current;
    if (!c || busy) return;
    setLoadingMore(true);
    try {
      const d = await apiFetch(feedUrl(`&before=${encodeURIComponent(c)}`), { token });
      setItems((prev) => {
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

  const patchRepost = (id, patch) =>
    setItems((list) =>
      list.map((i) =>
        i.id === id ? { ...i, repost: { ...i.repost, ...patch } } : i
      )
    );

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

  // Republier sur MON feed (toggle optimiste).
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

  if (loading) return <FeedCardsSkeleton />;

  if (!items.length) {
    return (
      <div className="hf-empty card">
        <span className="hf-empty-icon">
          <Users size={26} />
        </span>
        <p className="font-fun">
          {filterUser
            ? "Ce joueur n'a encore rien fait par ici… Re-clique sur son avatar pour revoir tout le fil."
            : "C'est calme par ici… Suis d'autres joueurs pour remplir ton fil, ou ajoute des jeux à ton journal pour lancer la machine !"}
        </p>
      </div>
    );
  }

  return (
    <div className="hf-feed">
      {/* Fil virtualisé (react-virtuoso) : seules les cartes visibles (± une
          marge) sont montées dans le DOM → scroll fluide même sur un très long
          fil. `useWindowScroll` : la page scrolle sur le body, pas dans un
          conteneur interne (indispensable pour garder les barres sticky). */}
      <Virtuoso
        useWindowScroll
        data={items}
        computeItemKey={(_, item) => item.id}
        endReached={loadMore}
        increaseViewportBy={{ top: 400, bottom: 900 }}
        context={{ community, loadingMore, atEnd: !cursor && items.length > 6 }}
        components={feedComponents}
        itemContent={(_, item) => (
          <div className="hf-item">
            <FeedCard
              item={item}
              me={me}
              token={token}
              onLike={() =>
                item.type === "video"
                  ? toggleVideoLike(item)
                  : item.type === "gamemediapost"
                    ? togglePostLike(item)
                    : toggleLike(item)
              }
              onComments={() =>
                item.type === "video"
                  ? setCommentsForVideo(item)
                  : item.type === "gamemediapost"
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
              onOpenBlindTest={(payload) => setBlindTestFor(payload || item)}
            />
          </div>
        )}
      />

      {lightbox && (
        <FanartLightbox item={lightbox} onClose={() => setLightbox(null)} />
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
      {commentsForPost && (
        <GameMediaCommentsModal
          post={commentsForPost.post}
          game={commentsForPost.game}
          token={token}
          onCountChange={(n) => patchPost(commentsForPost.id, { commentCount: n })}
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
    </div>
  );
}
