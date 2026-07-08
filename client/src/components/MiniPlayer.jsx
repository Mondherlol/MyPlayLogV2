import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Music,
  Disc3,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

function fmt(sec) {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Barre de lecture flottante, présente sur toute l'app connectée. N'apparaît
// que lorsqu'une OST est lancée (depuis la page jeu, le profil ou l'aperçu).
export default function MiniPlayer() {
  const player = usePlayer();
  const { current, playing, progress, hasNext, hasPrev } = player;
  const barRef = useRef(null);

  // Décale le contenu pour ne pas le masquer derrière la barre.
  useEffect(() => {
    document.body.classList.toggle("mpl-open", !!current);
    return () => document.body.classList.remove("mpl-open");
  }, [current]);

  if (!current) return null;

  const pct = progress.duration
    ? Math.min(100, (progress.current / progress.duration) * 100)
    : 0;

  function onSeek(e) {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    player.seekFraction((e.clientX - rect.left) / rect.width);
  }

  return (
    <div className="mini-player" role="region" aria-label="Lecteur de musique">
      <div className={`mp-disc ${playing ? "spin" : ""}`}>
        {current.artwork ? (
          <img src={current.artwork} alt="" draggable="false" />
        ) : (
          <Music size={20} />
        )}
        <span className="mp-disc-hole" />
      </div>

      <div className="mp-meta">
        <span className="mp-name" title={current.name}>
          {current.name}
        </span>
        <span className="mp-sub">
          {current.artist && <span className="mp-artist">{current.artist}</span>}
          {current.gameId && (
            <Link to={`/game/${current.gameId}`} className="mp-game clickable">
              <Disc3 size={12} />
              <span>{current.gameName || "Voir le jeu"}</span>
            </Link>
          )}
        </span>
      </div>

      <div className="mp-controls">
        <button
          className="mp-btn clickable"
          onClick={player.prev}
          disabled={!hasPrev && progress.current < 3}
          title="Précédent"
          aria-label="Précédent"
        >
          <SkipBack size={18} fill="currentColor" strokeWidth={0} />
        </button>
        <button
          className="mp-btn mp-play clickable"
          onClick={player.toggle}
          title={playing ? "Pause" : "Lecture"}
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? (
            <Pause size={20} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play size={20} fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <button
          className="mp-btn clickable"
          onClick={player.next}
          disabled={!hasNext}
          title="Suivant"
          aria-label="Suivant"
        >
          <SkipForward size={18} fill="currentColor" strokeWidth={0} />
        </button>
      </div>

      <div className="mp-seek">
        <span className="mp-time">{fmt(progress.current)}</span>
        <div className="mp-bar" ref={barRef} onClick={onSeek}>
          <div className="mp-bar-fill" style={{ width: `${pct}%` }}>
            <span className="mp-bar-knob" />
          </div>
        </div>
        <span className="mp-time">{fmt(progress.duration)}</span>
      </div>

      <button
        className="mp-close clickable"
        onClick={player.close}
        title="Fermer le lecteur"
        aria-label="Fermer le lecteur"
      >
        <X size={16} />
      </button>
    </div>
  );
}
