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

// ======================================================================
//  Lecteur vidéo custom du mur média — remplace les contrôles natifs.
// ======================================================================
// Habillé aux couleurs de l'app (accent doré), contrôles auto-masqués pendant
// la lecture, barre de progression scrubbable (+ tampon), volume, plein écran,
// et DOUBLE-TAP mobile : moitié gauche = -10 s, moitié droite = +10 s (avec
// une pastille animée façon YouTube). Un seul lecteur actif à la fois : jouer
// une vidéo met les autres en pause.

const SEEK_STEP = 10; // secondes par double-tap / flèche
const playing = new Set(); // instances en lecture (pause mutuelle)

function fmt(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function GameVideoPlayer({ src, poster, autoPlay = false, className = "" }) {
  const wrapRef = useRef(null);
  const videoRef = useRef(null);
  const barRef = useRef(null);
  const hideTimer = useRef(null);
  const tapRef = useRef({ time: 0, zone: null, timer: null });

  const [isPlaying, setIsPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [ripple, setRipple] = useState(null); // { side: "left"|"right", id }

  // --- Synchro avec l'élément vidéo ---
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setCur(v.currentTime);
      try {
        if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
      } catch {
        /* ignore */
      }
    };
    const onMeta = () => setDuration(v.duration || 0);
    const onPlay = () => {
      setIsPlaying(true);
      // Pause les autres lecteurs du fil.
      playing.forEach((other) => other !== v && other.pause());
      playing.add(v);
    };
    const onPause = () => {
      setIsPlaying(false);
      playing.delete(v);
    };
    const onEnd = () => {
      setIsPlaying(false);
      setControlsShown(true);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      playing.delete(v);
    };
  }, []);

  // Plein écran : suit l'état réel (Échap natif compris).
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Auto-masquage des contrôles pendant la lecture.
  const poke = useCallback(() => {
    setControlsShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused) setControlsShown(false);
    }, 2200);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (isPlaying) poke();
    else setControlsShown(true);
  }, [isPlaying, poke]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seekBy(delta, side) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), v.duration || 0);
    setCur(v.currentTime);
    setRipple({ side, id: Date.now() });
    poke();
  }

  // Tap / double-tap sur la surface : centre = play/pause, double-tap sur une
  // moitié = ±10 s. Un simple tap sur une moitié attend 260 ms (fenêtre du
  // double) avant de basculer lecture, pour ne pas jouer/pauser par erreur.
  function onSurface(e) {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const zone = x < 0.35 ? "left" : x > 0.65 ? "right" : "center";
    const now = Date.now();
    const t = tapRef.current;

    if (zone !== "center" && now - t.time < 300 && t.zone === zone) {
      // Double-tap sur une moitié → seek.
      clearTimeout(t.timer);
      t.time = 0;
      seekBy(zone === "left" ? -SEEK_STEP : SEEK_STEP, zone);
      return;
    }
    t.time = now;
    t.zone = zone;
    if (zone === "center") {
      togglePlay();
    } else {
      clearTimeout(t.timer);
      t.timer = setTimeout(togglePlay, 280);
    }
    poke();
  }

  // Scrub de la barre de progression (pointer capture pour suivre le drag).
  function barSeek(clientX) {
    const r = barRef.current?.getBoundingClientRect();
    const v = videoRef.current;
    if (!r || !v || !duration) return;
    const p = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    v.currentTime = p * duration;
    setCur(v.currentTime);
  }
  function barDown(e) {
    e.preventDefault();
    e.stopPropagation();
    barSeek(e.clientX);
    // Pointer capture : move/up sont re-ciblés sur la barre elle-même, même si
    // le curseur sort du lecteur — et un simple clic se termine proprement
    // (un listener window serait bloqué par des stopPropagation en amont).
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
    const v = videoRef.current;
    setVolume(val);
    setMuted(val === 0);
    if (v) {
      v.volume = val;
      v.muted = val === 0;
    }
  }
  function toggleMute() {
    const v = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (v) v.muted = next;
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
  const pctBuf = duration ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={wrapRef}
      className={`gvp ${controlsShown ? "show-ui" : ""} ${fullscreen ? "is-fs" : ""} ${className}`}
      onPointerMove={poke}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster || undefined}
        preload="metadata"
        playsInline
        autoPlay={autoPlay}
        onClick={(e) => e.preventDefault()}
      />

      {/* Surface de tap (play/pause + double-tap seek) */}
      <div className="gvp-surface" onPointerUp={onSurface} />

      {/* Pastilles ±10 s */}
      {ripple && (
        <span key={ripple.id} className={`gvp-ripple ${ripple.side}`}>
          {ripple.side === "left" ? <RotateCcw size={20} /> : <RotateCw size={20} />}
          {ripple.side === "left" ? "-10 s" : "+10 s"}
        </span>
      )}

      {/* Gros play central quand en pause */}
      {!isPlaying && (
        <span className="gvp-bigplay" aria-hidden="true">
          <Play size={26} fill="currentColor" />
        </span>
      )}

      {/* Barre de contrôles (sœur de la surface de tap : pas besoin de
          stopPropagation, qui bloquerait les listeners de drag) */}
      <div className="gvp-ui">
        <div className="gvp-bar" ref={barRef} onPointerDown={barDown}>
          <span className="gvp-bar-buf" style={{ width: `${pctBuf}%` }} />
          <span className="gvp-bar-cur" style={{ width: `${pctCur}%` }} />
          <span className="gvp-bar-thumb" style={{ left: `${pctCur}%` }} />
        </div>
        <div className="gvp-row">
          <button className="gvp-btn clickable" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Lecture"}>
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
          <button className="gvp-btn clickable" onClick={toggleFullscreen} aria-label="Plein écran">
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
