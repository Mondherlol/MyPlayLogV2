import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { loadYT } from "../lib/youtube";

// ======================================================================
//  Lecteur YouTube habillé maison — mêmes commandes que le lecteur du mur
//  média (GameVideoPlayer), mais sur une vidéo YouTube.
// ======================================================================
// Pourquoi ne pas garder l'iframe nue : YouTube n'offre aucun réglage pour
// masquer son habillage (titre, « partager », « regarder plus tard »), et ses
// contrôles ne suivent pas les couleurs de l'app. On reprend donc l'astuce du
// lecteur de trailer : l'iframe est rendue PLUS HAUTE que son cadre, la vidéo
// 16/9 reste entière, et le titre (en haut) comme la barre YouTube (en bas)
// tombent dans les bandes rognées. Par-dessus, nos propres commandes.
//
// Volume, barre scrubbable, plein écran, ±10 s aux flèches ou en double-tapant
// une moitié de l'écran : tout ce que fait GameVideoPlayer, avec les mêmes
// classes CSS pour un rendu identique.
//
// Piège respecté : YT.Player n'est jamais monté sur un nœud rendu par React
// (page blanche au démontage). On crée un enfant DOM à la main dans un
// conteneur stable ; React ne réconcilie que le conteneur.

const SEEK_STEP = 10;
const CROP = 62; // bandes rognées en haut et en bas (px)

function fmt(s) {
  if (!s || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function YouTubePlayer({
  videoId,
  autoPlay = true,
  className = "",
  title = "Vidéo",
}) {
  const wrapRef = useRef(null);
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  const barRef = useRef(null);
  const hideTimer = useRef(null);
  const tapRef = useRef({ time: 0, zone: null, timer: null });

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [ripple, setRipple] = useState(null);

  // --- Cycle de vie du lecteur YouTube ---
  useEffect(() => {
    let destroyed = false;
    let fallback = null;
    const holder = holderRef.current;
    if (!holder) return;
    // Nœud créé à la main : YouTube le REMPLACE par son iframe, ce que React
    // ne doit jamais découvrir sur un nœud qu'il gère.
    const mount = document.createElement("div");
    holder.appendChild(mount);

    loadYT().then((YT) => {
      if (destroyed) return;
      playerRef.current = new YT.Player(mount, {
        videoId,
        playerVars: {
          autoplay: autoPlay ? 1 : 0,
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          disablekb: 1,
          modestbranding: 1,
          fs: 0,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            setReady(true);
            setDuration(e.target.getDuration?.() || 0);
            e.target.setVolume?.(100);
            if (autoPlay) {
              e.target.playVideo?.();
              // Autoplay sonore refusé par le navigateur ? On repart en muet,
              // le bouton son rend la main d'un clic.
              fallback = setTimeout(() => {
                try {
                  if (playerRef.current?.getPlayerState?.() !== 1) {
                    playerRef.current?.mute?.();
                    playerRef.current?.playVideo?.();
                    setMuted(true);
                  }
                } catch {
                  /* ignore */
                }
              }, 1400);
            }
          },
          onStateChange: (e) => {
            if (destroyed) return;
            setIsPlaying(e.data === 1);
            if (e.data === 1) setDuration(e.target.getDuration?.() || 0);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      clearTimeout(fallback);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      // Le nœud a été remplacé par l'iframe : on vide le conteneur à la main.
      while (holder.firstChild) holder.removeChild(holder.firstChild);
    };
  }, [videoId, autoPlay]);

  // Progression : YouTube n'émet pas d'évènement de temps, on l'interroge.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setCur(p.getCurrentTime() || 0);
        setLoaded((p.getVideoLoadedFraction?.() || 0) * (p.getDuration?.() || 0));
      } catch {
        /* le lecteur est en train de mourir */
      }
    }, 250);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Auto-masquage des commandes pendant la lecture.
  const poke = useCallback(() => {
    setControlsShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playerRef.current?.getPlayerState?.() === 1) setControlsShown(false);
    }, 2200);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (isPlaying) poke();
    else setControlsShown(true);
  }, [isPlaying, poke]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState?.() === 1) p.pauseVideo?.();
    else p.playVideo?.();
  }, []);

  const seekBy = useCallback(
    (delta, side) => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      const next = Math.max(0, Math.min(p.getCurrentTime() + delta, p.getDuration?.() || 0));
      p.seekTo?.(next, true);
      setCur(next);
      if (side) setRipple({ side, id: Date.now() });
      poke();
    },
    [poke]
  );

  // Flèches ← / → : ±10 s. Espace : lecture/pause. Le lecteur ne prend le
  // clavier que s'il est le dernier élément touché — sinon deux lecteurs sur
  // la même page se battraient pour les mêmes touches.
  useEffect(() => {
    const onKey = (e) => {
      const el = wrapRef.current;
      if (!el) return;
      // Champ de saisie au premier plan : le clavier ne nous appartient pas.
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      if (!el.contains(document.activeElement) && !el.matches(":hover") && !fullscreen)
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekBy(-SEEK_STEP, "left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekBy(SEEK_STEP, "right");
      } else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seekBy, togglePlay, fullscreen]);

  // Tap / double-tap : centre = lecture/pause, double-tap sur une moitié = ±10 s.
  function onSurface(e) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const zone = x < 0.35 ? "left" : x > 0.65 ? "right" : "center";
    const now = Date.now();
    const t = tapRef.current;

    if (zone !== "center" && now - t.time < 300 && t.zone === zone) {
      clearTimeout(t.timer);
      t.time = 0;
      seekBy(zone === "left" ? -SEEK_STEP : SEEK_STEP, zone);
      return;
    }
    t.time = now;
    t.zone = zone;
    if (zone === "center") togglePlay();
    else {
      clearTimeout(t.timer);
      t.timer = setTimeout(togglePlay, 280);
    }
    poke();
  }

  function barSeek(clientX) {
    const r = barRef.current?.getBoundingClientRect();
    const p = playerRef.current;
    if (!r || !p || !duration) return;
    const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    p.seekTo?.(ratio * duration, true);
    setCur(ratio * duration);
  }

  function barDown(e) {
    e.preventDefault();
    e.stopPropagation();
    barSeek(e.clientX);
    const el = barRef.current;
    if (!el) return;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const move = (ev) => barSeek(ev.clientX);
    const up = (ev) => {
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    poke();
  }

  function setVol(val) {
    const p = playerRef.current;
    setVolume(val);
    setMuted(val === 0);
    if (p) {
      p.setVolume?.(Math.round(val * 100));
      if (val === 0) p.mute?.();
      else p.unMute?.();
    }
  }

  function toggleMute() {
    const p = playerRef.current;
    const next = !muted;
    setMuted(next);
    if (p) next ? p.mute?.() : p.unMute?.();
    if (!next && volume === 0) setVol(0.6);
  }

  function toggleFullscreen(e) {
    e.stopPropagation();
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  }

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pctCur = duration ? (cur / duration) * 100 : 0;
  const pctBuf = duration ? Math.min(100, (loaded / duration) * 100) : 0;

  return (
    <div
      ref={wrapRef}
      className={`gvp gvp-yt ${controlsShown ? "show-ui" : ""} ${fullscreen ? "is-fs" : ""} ${className}`}
      onPointerMove={poke}
      tabIndex={-1}
    >
      {/* L'iframe déborde en haut et en bas : l'habillage YouTube passe hors cadre. */}
      <div
        className="gvp-yt-crop"
        ref={holderRef}
        style={{ top: `-${CROP}px`, height: `calc(100% + ${CROP * 2}px)` }}
        aria-label={title}
      />

      <div className="gvp-surface" onPointerUp={onSurface} />

      {ripple && (
        <span key={ripple.id} className={`gvp-ripple ${ripple.side}`}>
          {ripple.side === "left" ? <RotateCcw size={20} /> : <RotateCw size={20} />}
          {ripple.side === "left" ? "-10 s" : "+10 s"}
        </span>
      )}

      {!isPlaying && (
        <span className="gvp-bigplay" aria-hidden="true">
          <Play size={26} fill="currentColor" />
        </span>
      )}

      <div className="gvp-ui">
        <div className="gvp-bar" ref={barRef} onPointerDown={barDown}>
          <span className="gvp-bar-buf" style={{ width: `${pctBuf}%` }} />
          <span className="gvp-bar-cur" style={{ width: `${pctCur}%` }} />
          <span className="gvp-bar-thumb" style={{ left: `${pctCur}%` }} />
        </div>
        <div className="gvp-row">
          <button
            className="gvp-btn clickable"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Lecture"}
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
          </button>
          <div className="gvp-volume">
            <button className="gvp-btn clickable" onClick={toggleMute} aria-label="Volume">
              <VolIcon size={17} />
            </button>
            <input
              type="range"
              className="gvp-vol"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              style={{ "--val": `${Math.round((muted ? 0 : volume) * 100)}%` }}
              onChange={(e) => setVol(Number(e.target.value))}
              aria-label="Niveau du volume"
            />
          </div>
          <span className="gvp-time">
            {fmt(cur)} <em>/ {fmt(duration)}</em>
          </span>
          <span className="gvp-spacer" />
          <button
            className="gvp-btn clickable"
            onClick={toggleFullscreen}
            aria-label="Plein écran"
          >
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
