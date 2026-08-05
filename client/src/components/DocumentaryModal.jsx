import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Clapperboard,
  ThumbsUp,
  Clock,
  SkipForward,
  Gamepad2,
  Film,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { loadYT } from "../lib/youtube";

// Mini-feed de documentaires : on enchaîne des vidéos YouTube (docu / analyse)
// sur des jeux joués ou recommandées par la communauté. Lecteur YT intégré.
// 3 actions par vidéo : Recommander, Regarder plus tard, Passer.

// Traduit une vidéo du feed en payload d'action pour le serveur.
function toPayload(v) {
  return {
    videoId: v.videoId,
    title: v.title,
    author: v.author,
    thumb: v.thumb,
    duration: v.duration,
    gameId: v.game?.id || null,
    gameName: v.game?.name || null,
  };
}

export default function DocumentaryModal({ prefs, token, onClose }) {
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  // État des actions pour la vidéo courante (toggles optimistes).
  const [reco, setReco] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  const ytRef = useRef(null);
  const ytDivRef = useRef(null);
  const ready = useRef(false); // le player YT est prêt
  const autoplayTimer = useRef(null);
  const seenSent = useRef(new Set()); // videoIds déjà marqués « vus » cette session
  const fetching = useRef(false);
  const watchedSent = useRef(new Set()); // videoIds déjà marqués « regardés » (seuil)
  const progressRef = useRef({ videoId: null, position: 0, duration: 0 });
  const currentRef = useRef(null); // vidéo courante, lisible depuis les timers

  // Affiche la miniature puis lance la lecture après un court instant.
  const AUTOPLAY_DELAY = 1100;
  function showThenPlay(videoId) {
    clearTimeout(autoplayTimer.current);
    try {
      ytRef.current?.cueVideoById?.(videoId); // miniature (pas de lecture)
    } catch {
      /* player pas prêt : géré par onReady */
    }
    autoplayTimer.current = setTimeout(() => {
      try {
        ytRef.current?.playVideo?.();
      } catch {
        /* ignore */
      }
    }, AUTOPLAY_DELAY);
  }

  const current = queue[index] || null;
  currentRef.current = current;

  const query = `lang=${encodeURIComponent(prefs.lang.join(","))}&scope=${prefs.scope}`;

  // Chargement d'un lot de vidéos (append pour ne pas casser la lecture en cours).
  const loadBatch = useCallback(
    async (append) => {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const d = await apiFetch(`/videos/feed?${query}`, { token });
        const vids = d.videos || [];
        if (append) {
          setQueue((prev) => {
            const have = new Set(prev.map((v) => v.videoId));
            return [...prev, ...vids.filter((v) => !have.has(v.videoId))];
          });
        } else {
          setQueue(vids);
          setEmpty(vids.length === 0);
        }
      } catch {
        if (!append) setEmpty(true);
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    },
    [query, token]
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const k = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    loadBatch(false);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", k);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marque la vidéo courante comme vue (Passer OU lancement de lecture).
  const markSeen = useCallback(
    (v) => {
      if (!v || seenSent.current.has(v.videoId)) return;
      seenSent.current.add(v.videoId);
      apiFetch("/videos/seen", { method: "POST", token, body: { video: toPayload(v) } }).catch(
        () => {}
      );
    },
    [token]
  );

  // Sauvegarde de la position de lecture + « regardée » au seuil (~30 s / 10 %),
  // qui alimente l'onglet Historique et l'évènement « a regardé » du fil.
  const saveProgress = useCallback(
    (v, position, duration, watched) => {
      if (!v) return;
      apiFetch("/videos/progress", {
        method: "POST",
        token,
        body: {
          video: toPayload(v),
          position: Math.floor(position || 0),
          duration: Math.floor(duration || 0),
          watched: !!watched,
        },
      }).catch(() => {});
    },
    [token]
  );

  // Sondage de la position de lecture chaque seconde → seuil « regardée » +
  // mémorisation de la position courante (reprise / sauvegarde à la sortie).
  useEffect(() => {
    const poll = setInterval(() => {
      const p = ytRef.current;
      const v = currentRef.current;
      if (!p?.getCurrentTime || !v) return;
      let position = 0;
      let duration = 0;
      try {
        position = p.getCurrentTime() || 0;
        duration = p.getDuration() || 0;
      } catch {
        return;
      }
      if (position <= 0) return;
      progressRef.current = { videoId: v.videoId, position, duration };
      if (
        !watchedSent.current.has(v.videoId) &&
        (position >= 30 || (duration > 0 && position / duration >= 0.1))
      ) {
        watchedSent.current.add(v.videoId);
        saveProgress(v, position, duration, true);
      }
    }, 1000);
    return () => clearInterval(poll);
  }, [saveProgress]);

  // Player YouTube intégré (créé une fois la 1re vidéo connue).
  useEffect(() => {
    if (!current || ytRef.current) return;
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytDivRef.current || ytRef.current) return;
      ytRef.current = new YT.Player(ytDivRef.current, {
        videoId: current.videoId,
        playerVars: { autoplay: 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            ready.current = true;
            showThenPlay(current.videoId); // 1re vidéo : miniature puis lecture auto
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) markSeen(queue[index]);
            if (e.data === YT.PlayerState.ENDED) goNext();
          },
        },
      });
    });
    return () => {
      destroyed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Charge la vidéo courante dans le player + reset des toggles à chaque changement.
  useEffect(() => {
    if (!current) return;
    setReco(!!current.recommendedByMe);
    setLater(!!current.savedForLater);
    // La 1re vidéo est lancée par onReady ; les suivantes ici (player déjà prêt).
    if (ready.current) showThenPlay(current.videoId);
    // Précharge un nouveau lot quand on approche de la fin de la file.
    if (queue.length - index <= 3) loadBatch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.videoId]);

  // Coupe la lecture au démontage + sauvegarde la position de la vidéo courante.
  useEffect(() => {
    return () => {
      clearTimeout(autoplayTimer.current);
      const v = currentRef.current;
      const pr = progressRef.current;
      if (v && pr.videoId === v.videoId) {
        saveProgress(v, pr.position, pr.duration, watchedSent.current.has(v.videoId));
      }
      try {
        ytRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goNext() {
    const v = queue[index];
    if (v) {
      const pr = progressRef.current;
      const same = pr.videoId === v.videoId;
      saveProgress(
        v,
        same ? pr.position : 0,
        same ? pr.duration : 0,
        watchedSent.current.has(v.videoId)
      );
    }
    markSeen(queue[index]);
    setIndex((i) => i + 1);
  }

  async function toggleReco() {
    if (!current || busy) return;
    setBusy(true);
    const next = !reco;
    setReco(next);
    try {
      const d = await apiFetch("/videos/recommend", {
        method: "POST",
        token,
        body: { video: toPayload(current) },
      });
      setReco(d.recommended);
      if (d.recommended) seenSent.current.add(current.videoId);
    } catch {
      setReco(!next);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLater() {
    if (!current || busy) return;
    setBusy(true);
    const next = !later;
    setLater(next);
    try {
      const d = await apiFetch("/videos/later", {
        method: "POST",
        token,
        body: { video: toPayload(current) },
      });
      setLater(d.later);
      if (d.later) seenSent.current.add(current.videoId);
    } catch {
      setLater(!next);
    } finally {
      setBusy(false);
    }
  }

  const done = !loading && (empty || index >= queue.length);

  return createPortal(
    <div className="modal-overlay doc-overlay" onMouseDown={onClose}>
      <div className="doc-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>

        <div className="doc-modal-head">
          <span className="doc-modal-title">
            <Clapperboard size={20} /> Documentaires
          </span>
          {!loading && !done && (
            <span className="doc-modal-counter">
              {index + 1} / {queue.length}
            </span>
          )}
        </div>

        {loading ? (
          <div className="doc-state">
            <Loader2 size={26} className="spin" />
            <p>On te déniche des documentaires…</p>
          </div>
        ) : done ? (
          <div className="doc-state">
            <Film size={30} />
            <p>
              {empty
                ? "Aucun documentaire à te proposer pour l'instant. Ajoute des jeux à ta bibliothèque !"
                : "Tu as tout regardé pour le moment. Reviens plus tard 👀"}
            </p>
            <button className="btn btn-ghost" onClick={onClose}>
              Fermer
            </button>
          </div>
        ) : (
          <>
            <div className="doc-stage">
              <div ref={ytDivRef} className="doc-player" />
            </div>

            <div className="doc-info">
              <h3 className="doc-video-title" title={current.title}>
                {current.title}
              </h3>
              <div className="doc-video-meta">
                {current.author && <span className="doc-chan">{current.author}</span>}
                {current.recommendedBy ? (
                  <span className="doc-badge reco">
                    <ThumbsUp size={12} /> Recommandé par @{current.recommendedBy.username}
                  </span>
                ) : current.game ? (
                  <span className="doc-badge">
                    <Gamepad2 size={12} /> {current.game.name}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="doc-actions">
              <button
                className={`doc-act clickable ${reco ? "active" : ""}`}
                onClick={toggleReco}
                disabled={busy}
              >
                <ThumbsUp size={18} /> {reco ? "Recommandé" : "Recommander"}
              </button>
              <button
                className={`doc-act clickable ${later ? "active" : ""}`}
                onClick={toggleLater}
                disabled={busy}
              >
                <Clock size={18} /> {later ? "Ajouté" : "Regarder plus tard"}
              </button>
              <button className="doc-act next clickable" onClick={goNext}>
                <SkipForward size={18} /> Passer
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
