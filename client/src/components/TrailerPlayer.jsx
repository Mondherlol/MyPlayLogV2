import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX } from "lucide-react";
import { loadYT } from "../lib/youtube";

// Lecteur de trailer « propre » : YouTube n'offre aucun paramètre pour cacher
// son habillage (titre, partage, à regarder plus tard) — même via les libs
// react-player & co, c'est le même iframe. Astuce : l'iframe est rendu plus
// HAUT que son cadre (letterbox) → la vidéo 16:9 reste entière, mais le titre
// (en haut) et les contrôles (en bas) tombent dans les bandes croppées. On
// dessine nos propres contrôles (play, barre de progression, muet) au survol.
const CROP = 60; // hauteur croppée en haut et en bas (px)

function fmt(s) {
  if (!s || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function TrailerPlayer({ videoId }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [prog, setProg] = useState({ cur: 0, dur: 0 });

  useEffect(() => {
    let destroyed = false;
    let fallbackTimer = null;
    loadYT().then((YT) => {
      if (destroyed || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          disablekb: 1,
          fs: 0,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            e.target.playVideo?.();
            // Autoplay sonore bloqué par le navigateur ? On repart en muet
            // (le bouton son permet de réactiver d'un clic).
            fallbackTimer = setTimeout(() => {
              try {
                if (playerRef.current?.getPlayerState?.() !== 1) {
                  playerRef.current?.mute?.();
                  playerRef.current?.playVideo?.();
                  setMuted(true);
                }
              } catch {
                /* ignore */
              }
            }, 1500);
          },
          onStateChange: (e) => !destroyed && setPlaying(e.data === 1),
        },
      });
    });
    return () => {
      destroyed = true;
      clearTimeout(fallbackTimer);
      try {
        playerRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  // Progression (pendant la lecture uniquement).
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const p = playerRef.current;
      try {
        setProg({ cur: p.getCurrentTime() || 0, dur: p.getDuration() || 0 });
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearInterval(t);
  }, [playing]);

  function toggle() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch {
      /* ignore */
    }
  }

  function toggleMute(e) {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p) return;
    try {
      if (muted) {
        p.unMute();
        setMuted(false);
      } else {
        p.mute();
        setMuted(true);
      }
    } catch {
      /* ignore */
    }
  }

  function seek(e) {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p?.getDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    try {
      const d = p.getDuration() || 0;
      p.seekTo(f * d, true);
      setProg((pr) => ({ ...pr, cur: f * d }));
    } catch {
      /* ignore */
    }
  }

  const frac = prog.dur ? prog.cur / prog.dur : 0;

  return (
    <div className="trp" onClick={toggle} style={{ "--trp-crop": `${CROP}px` }}>
      <div className="trp-crop">
        <div ref={hostRef} />
      </div>

      {/* Nos contrôles, visibles au survol */}
      <div className="trp-ui" onClick={(e) => e.stopPropagation()}>
        <button className="trp-btn clickable" onClick={toggle} title={playing ? "Pause" : "Lecture"}>
          {playing ? (
            <Pause size={15} />
          ) : (
            <Play size={15} fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <span className="trp-time">{fmt(prog.cur)}</span>
        <div className="trp-track clickable" onClick={seek}>
          <span className="trp-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <span className="trp-time">{fmt(prog.dur)}</span>
        <button
          className="trp-btn clickable"
          onClick={toggleMute}
          title={muted ? "Activer le son" : "Couper le son"}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>
    </div>
  );
}
