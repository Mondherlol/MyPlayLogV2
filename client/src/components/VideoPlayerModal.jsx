import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Heart, MessageCircle, Clock, Repeat2, Check } from "lucide-react";
import { apiFetch } from "../lib/api";
import { loadYT } from "../lib/youtube";
import VideoCommentsPanel from "./VideoCommentsPanel";

// Seuils au-delà desquels une vidéo est comptée comme « regardée » (historique
// + évènement de fil). Cf. décision produit : ~30 s OU 10 % de la durée.
const WATCH_MIN_SECONDS = 30;
const WATCH_MIN_RATIO = 0.1;

// Snapshot de la vidéo pour l'API (le serveur valide/normalise videoId).
function toPayload(v) {
  return {
    videoId: v.videoId,
    title: v.title || "",
    author: v.author || "",
    thumb: v.thumb || null,
    duration: v.duration || null,
    gameId: v.game?.id || v.gameId || null,
    gameName: v.game?.name || v.gameName || null,
  };
}

// Lecteur YouTube en modale qui PISTE la progression (reprise, marquage
// « regardée », sauvegarde à la fermeture) ET porte les actions sociales :
// une barre flottante Like / Recommander / Plus tard / Commentaire, cette
// dernière ouvrant le fil de commentaires dans une colonne de droite.
//
// Piège respecté : YT.Player n'est jamais monté sur un nœud rendu par React
// (page blanche au démontage). On crée un enfant DOM à la main dans un conteneur
// stable ; React ne réconcilie que le conteneur, jamais l'iframe de YouTube.
// L'effet du lecteur ne dépend QUE du videoId : ouvrir/fermer les commentaires
// ne recrée jamais le player (sinon la lecture repartirait de zéro).
export default function VideoPlayerModal({ video, resumeAt = 0, token, onClose }) {
  const holderRef = useRef(null);
  const ytRef = useRef(null);
  const watchedSent = useRef(false);
  const progress = useRef({
    position: resumeAt || 0,
    duration: video?.durationSeconds || 0,
  });

  const vidParam = video?.id || video?.videoId;
  const [showComments, setShowComments] = useState(false);
  const [social, setSocial] = useState({
    liked: video?.liked ?? false,
    likeCount: video?.likeCount ?? 0,
    commentCount: video?.commentCount ?? 0,
    recommended: video?.recommended ?? false,
    later: video?.later ?? false,
  });
  const [busy, setBusy] = useState({}); // anti double-clic par action
  // Un calque (lightbox média / historique des commentaires) ouvert au-dessus :
  // Échap ne doit fermer que lui.
  const overlayOpen = useRef(false);

  const snapshot = () => toPayload(video);

  // État social + relation perso, à jour même quand la card ne les portait pas
  // (ex. carte « a regardé »). Rafraîchi à l'ouverture.
  useEffect(() => {
    if (!vidParam) return;
    let alive = true;
    apiFetch(`/videos/${vidParam}/social`, { token })
      .then((d) => alive && setSocial((s) => ({ ...s, ...d })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vidParam, token]);

  // --- Cycle de vie du lecteur YouTube (NE dépend que du videoId) ---
  useEffect(() => {
    document.body.style.overflow = "hidden";

    const saveProgress = (watched) => {
      if (!video?.videoId) return;
      const { position, duration } = progress.current;
      apiFetch("/videos/progress", {
        method: "POST",
        token,
        body: {
          video: toPayload(video),
          position: Math.floor(position),
          duration: Math.floor(duration),
          watched: !!watched,
        },
      }).catch(() => {});
    };

    let destroyed = false;
    const mount = document.createElement("div");
    holderRef.current?.appendChild(mount);

    loadYT().then((YT) => {
      if (destroyed) return;
      ytRef.current = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        videoId: video.videoId,
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          start: Math.floor(resumeAt || 0),
        },
        events: {
          onReady: (e) => {
            if (resumeAt > 0) {
              try {
                e.target.seekTo(resumeAt, true);
              } catch {
                /* ignore */
              }
            }
            try {
              e.target.playVideo();
            } catch {
              /* ignore */
            }
          },
        },
      });
    });

    const poll = setInterval(() => {
      const p = ytRef.current;
      if (!p?.getCurrentTime) return;
      let position = 0;
      let duration = 0;
      try {
        position = p.getCurrentTime() || 0;
        duration = p.getDuration() || 0;
      } catch {
        return;
      }
      progress.current = { position, duration };
      if (
        !watchedSent.current &&
        (position >= WATCH_MIN_SECONDS ||
          (duration > 0 && position / duration >= WATCH_MIN_RATIO))
      ) {
        watchedSent.current = true;
        saveProgress(true);
      }
    }, 1000);

    return () => {
      destroyed = true;
      document.body.style.overflow = "";
      clearInterval(poll);
      saveProgress(watchedSent.current);
      try {
        ytRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.videoId]);

  // Échap : ferme d'abord un calque (géré par le panneau), sinon les
  // commentaires, sinon la modale.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || overlayOpen.current) return;
      if (showComments) setShowComments(false);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showComments, onClose]);

  // Bascule optimiste d'une action de relation (like / recommander / plus tard).
  async function toggle(key, endpoint, extract) {
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: true }));
    const prev = { ...social };
    setSocial((s) => {
      if (key === "liked")
        return { ...s, liked: !s.liked, likeCount: s.likeCount + (s.liked ? -1 : 1) };
      return { ...s, [key]: !s[key] };
    });
    try {
      const d = await apiFetch(endpoint, { method: "POST", token, body: { video: snapshot() } });
      setSocial((s) => ({ ...s, ...extract(d) }));
    } catch {
      setSocial(prev);
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  const toggleLike = () =>
    toggle("liked", `/videos/${vidParam}/like`, (d) => ({
      liked: d.liked,
      likeCount: d.likeCount,
    }));
  const toggleRecommend = () =>
    toggle("recommended", "/videos/recommend", (d) => ({ recommended: d.recommended }));
  const toggleLater = () =>
    toggle("later", "/videos/later", (d) => ({ later: d.later }));

  return createPortal(
    <div className="modal-overlay doc-overlay vpm-overlay" onMouseDown={onClose}>
      <div
        className={`vpm-shell ${showComments ? "with-comments" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="vpm-main">
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>

          <div className="doc-stage">
            <div ref={holderRef} className="doc-player" />
          </div>

          {/* Barre d'actions horizontale, sous la vidéo */}
          <div className="vpm-bar">
            <button
              className={`vpm-act clickable ${social.liked ? "on like" : ""}`}
              onClick={toggleLike}
              title="J'aime"
            >
              <span className="vpm-act-ic">
                <Heart size={19} fill={social.liked ? "currentColor" : "none"} />
              </span>
              <span className="vpm-act-lb">
                J'aime{social.likeCount > 0 ? ` · ${social.likeCount}` : ""}
              </span>
            </button>

            <button
              className={`vpm-act clickable ${social.recommended ? "on reco" : ""}`}
              onClick={toggleRecommend}
              title={social.recommended ? "Retirer la recommandation" : "Recommander"}
            >
              <span className="vpm-act-ic">
                {social.recommended ? <Check size={19} /> : <Repeat2 size={19} />}
              </span>
              <span className="vpm-act-lb">
                {social.recommended ? "Recommandée" : "Recommander"}
              </span>
            </button>

            <button
              className={`vpm-act clickable ${social.later ? "on later" : ""}`}
              onClick={toggleLater}
              title={social.later ? "Retirer de « plus tard »" : "Regarder plus tard"}
            >
              <span className="vpm-act-ic">
                <Clock size={19} fill={social.later ? "currentColor" : "none"} />
              </span>
              <span className="vpm-act-lb">{social.later ? "Enregistrée" : "Plus tard"}</span>
            </button>

            <button
              className={`vpm-act clickable ${showComments ? "on comment" : ""}`}
              onClick={() => setShowComments((s) => !s)}
              title="Commentaires"
            >
              <span className="vpm-act-ic">
                <MessageCircle size={19} />
              </span>
              <span className="vpm-act-lb">
                Commenter{social.commentCount > 0 ? ` · ${social.commentCount}` : ""}
              </span>
            </button>
          </div>

          <div className="doc-info">
            <h3 className="doc-video-title">{video.title}</h3>
            {video.author && <span className="doc-chan">{video.author}</span>}
          </div>
        </div>

        {showComments && (
          <aside className="vpm-comments">
            <button
              className="vpm-comments-close clickable"
              onClick={() => setShowComments(false)}
              aria-label="Fermer les commentaires"
            >
              <X size={18} />
            </button>
            <VideoCommentsPanel
              video={video}
              token={token}
              compact
              onCountChange={(n) => setSocial((s) => ({ ...s, commentCount: n }))}
              onOverlayChange={(open) => (overlayOpen.current = open)}
            />
          </aside>
        )}
      </div>
    </div>,
    document.body
  );
}
