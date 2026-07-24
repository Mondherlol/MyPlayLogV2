import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Minus,
  Music,
  Disc3,
  ListMusic,
  ListPlus,
  Heart,
  Share2,
  ArrowUpRight,
  Loader2,
  Volume2,
  Volume1,
  VolumeX,
} from "lucide-react";
import { usePlayer, usePlayerProgress } from "../context/PlayerContext";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import AddToPlaylistModal from "./AddToPlaylistModal";
import ShareOstModal from "./ShareOstModal";

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
  const { token } = useAuth();
  const {
    current,
    playing,
    loading,
    hasNext,
    hasPrev,
    queue,
    volume,
    muted,
  } = player;
  // Contexte séparé : le mini-lecteur est le seul à se re-rendre au rythme de
  // la lecture (voir PlayerContext).
  const progress = usePlayerProgress();
  const barRef = useRef(null);
  const [showQueue, setShowQueue] = useState(false);
  // Réduit en « bulle » façon Messenger : le son continue, on rouvre au clic.
  const [minimized, setMinimized] = useState(false);

  // OST favorite du jeu de la piste courante (pour l'état du cœur + l'avertir
  // qu'un like va remplacer un favori existant).
  const [fav, setFav] = useState(null); // { name, artist, ... } | null
  const [favBusy, setFavBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const gameId = current?.gameId || null;
  const canLike = !!token && !!gameId;

  // Charge l'OST favorite du jeu quand la piste (donc le jeu) change.
  useEffect(() => {
    if (!canLike) {
      setFav(null);
      return;
    }
    let alive = true;
    apiFetch(`/library/${gameId}`, { token })
      .then((d) => alive && setFav(d.entry?.favoriteOst || null))
      .catch(() => alive && setFav(null));
    return () => {
      alive = false;
    };
  }, [gameId, canLike, token]);

  const isFav =
    !!fav && !!current && fav.name === current.name && fav.artist === (current.artist || "");
  // Un favori DIFFÉRENT existe déjà → liker celui-ci le remplacera.
  const replaces = !!fav && !isFav;

  // Écrit (ou retire) l'OST favorite du jeu côté serveur.
  const saveFavorite = useCallback(
    async (track) => {
      if (!current || !gameId) return;
      const favoriteOst = track
        ? {
            name: track.name,
            artist: track.artist || "",
            artwork: track.artwork || null,
            youtube: true,
            url: track.videoId
              ? `https://www.youtube.com/watch?v=${track.videoId}`
              : null,
            preview: null,
          }
        : null;
      setFav(favoriteOst); // optimiste
      setFavBusy(true);
      try {
        await apiFetch(`/library/${gameId}`, {
          method: "PUT",
          token,
          body: { favoriteOst, name: current.gameName || current.name },
        });
      } catch (err) {
        alert(err.message);
        // Rechargement pour retrouver l'état réel en cas d'échec.
        apiFetch(`/library/${gameId}`, { token })
          .then((d) => setFav(d.entry?.favoriteOst || null))
          .catch(() => {});
      } finally {
        setFavBusy(false);
      }
    },
    [current, gameId, token]
  );

  function onLike() {
    if (!canLike || favBusy) return;
    if (isFav) return saveFavorite(null); // déjà favori → on retire
    if (replaces) return setConfirmReplace(true); // remplace un autre favori → on confirme
    saveFavorite(current);
  }

  // Décale le contenu pour ne pas le masquer derrière la barre (sauf en bulle,
  // qui flotte dans un coin sans réserver d'espace).
  useEffect(() => {
    document.body.classList.toggle("mpl-open", !!current && !minimized);
    return () => document.body.classList.remove("mpl-open");
  }, [current, minimized]);

  // Player fermé → on repart déplié et sans la file ouverte au prochain lancement.
  useEffect(() => {
    if (!current) {
      setMinimized(false);
      setShowQueue(false);
    }
  }, [current]);

  if (!current) return null;

  const pct = progress.duration
    ? Math.min(100, (progress.current / progress.duration) * 100)
    : 0;

  const volPct = muted ? 0 : Math.round(volume * 100);
  const VolumeIcon = volPct === 0 ? VolumeX : volPct < 50 ? Volume1 : Volume2;

  function onSeek(e) {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    player.seekFraction((e.clientX - rect.left) / rect.width);
  }

  // --- Bulle réduite ---
  if (minimized) {
    return (
      <div className="mp-bubble" role="region" aria-label="Lecteur réduit">
        <button
          className="mp-bubble-main clickable"
          onClick={() => setMinimized(false)}
          title="Rouvrir le lecteur"
          aria-label="Rouvrir le lecteur"
        >
          <span className={`mp-bubble-disc ${playing ? "spin" : ""}`}>
            {current.artwork ? (
              <img src={current.artwork} alt="" draggable="false" />
            ) : (
              <Music size={18} />
            )}
            <span className="mp-bubble-hole" />
          </span>
        </button>
        <button
          className="mp-bubble-play clickable"
          onClick={player.toggle}
          title={playing ? "Pause" : loading ? "Chargement…" : "Lecture"}
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" strokeWidth={0} />
          ) : loading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Play size={15} fill="currentColor" strokeWidth={0} />
          )}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mini-player" role="region" aria-label="Lecteur de musique">
        {/* Le disque qui tourne ouvre la file de lecture (surtout sur mobile,
            où les boutons de la file sont masqués pour rester compact). */}
        <button
          type="button"
          className={`mp-disc ${playing ? "spin" : ""} ${
            queue.length > 1 ? "mp-disc-btn clickable" : ""
          }`}
          onClick={() => queue.length > 1 && setShowQueue(true)}
          title={queue.length > 1 ? "Voir la file de lecture" : current.name}
          aria-label={queue.length > 1 ? "Voir la file de lecture" : "Pochette"}
        >
          {current.artwork ? (
            <img src={current.artwork} alt="" draggable="false" />
          ) : (
            <Music size={20} />
          )}
          <span className="mp-disc-hole" />
        </button>

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
            title={playing ? "Pause" : loading ? "Chargement…" : "Lecture"}
            aria-label={playing ? "Pause" : loading ? "Chargement" : "Lecture"}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" strokeWidth={0} />
            ) : loading ? (
              <Loader2 size={20} className="spin" />
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

        <div className="mp-actions">
          {/* Cœur : définir cette piste comme OST favorite du jeu. */}
          {canLike && (
            <button
              className={`mp-icon-btn mp-like clickable ${isFav ? "on" : ""}`}
              onClick={onLike}
              disabled={favBusy}
              title={
                isFav
                  ? "Retirer des favoris"
                  : replaces
                  ? "Définir comme OST favorite (remplace l'actuelle)"
                  : "Définir comme OST favorite"
              }
              aria-label="OST favorite"
            >
              <Heart size={17} fill={isFav ? "currentColor" : "none"} />
            </button>
          )}
          {/* Ajouter la piste à une playlist. */}
          {token && (
            <button
              className="mp-icon-btn clickable"
              onClick={() => setPlaylistOpen(true)}
              title="Ajouter à une playlist"
              aria-label="Ajouter à une playlist"
            >
              <ListPlus size={17} />
            </button>
          )}
          {/* Partager la piste en message privé. */}
          {token && (
            <button
              className="mp-icon-btn clickable"
              onClick={() => setShareOpen(true)}
              title="Partager en message"
              aria-label="Partager en message"
            >
              <Share2 size={16} />
            </button>
          )}

          {/* Volume : PC uniquement (masqué en CSS sur mobile, où les boutons
              physiques font le travail). Clic sur l'icône = sourdine. */}
          <div className="mp-volume" style={{ "--vol": `${volPct}%` }}>
            <button
              className="mp-icon-btn clickable"
              onClick={player.toggleMute}
              title={muted ? "Rétablir le son" : "Couper le son"}
              aria-label={muted ? "Rétablir le son" : "Couper le son"}
            >
              <VolumeIcon size={18} />
            </button>
            <input
              type="range"
              className="mp-vol-range clickable"
              min="0"
              max="100"
              step="1"
              value={volPct}
              onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
              aria-label="Volume"
              title="Volume"
            />
          </div>
          {/* File de lecture : ouvre la playlist en cours dans une modale
              (au lieu de quitter la page). Icône seule pour rester compact. */}
          {queue.length > 1 && (
            <button
              className="mp-icon-btn mp-queue-btn clickable"
              onClick={() => setShowQueue(true)}
              title="Voir la file de lecture"
              aria-label="Voir la file de lecture"
            >
              <ListMusic size={18} />
            </button>
          )}
          <button
            className="mp-icon-btn clickable"
            onClick={() => setMinimized(true)}
            title="Réduire le lecteur"
            aria-label="Réduire le lecteur"
          >
            <Minus size={18} />
          </button>
          <button
            className="mp-icon-btn clickable"
            onClick={player.close}
            title="Fermer le lecteur"
            aria-label="Fermer le lecteur"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {showQueue && (
        <QueueModal player={player} onClose={() => setShowQueue(false)} />
      )}

      {playlistOpen && current && (
        <AddToPlaylistModal
          track={{
            id: current.id,
            name: current.name,
            artist: current.artist,
            artwork: current.artwork,
            videoId: current.videoId,
            youtube: true,
            url: current.videoId
              ? `https://www.youtube.com/watch?v=${current.videoId}`
              : null,
          }}
          gameId={current.gameId}
          gameName={current.gameName}
          onClose={() => setPlaylistOpen(false)}
        />
      )}

      {shareOpen && current && (
        <ShareOstModal track={current} onClose={() => setShareOpen(false)} />
      )}

      {confirmReplace && current && (
        <ConfirmReplaceModal
          fav={fav}
          gameName={current.gameName}
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => {
            setConfirmReplace(false);
            saveFavorite(current);
          }}
        />
      )}
    </>
  );
}

// Confirme le remplacement de l'OST favorite déjà définie pour ce jeu.
function ConfirmReplaceModal({ fav, gameName, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal mp-confirm-modal">
        <button className="modal-close clickable" onClick={onCancel} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <Heart size={18} /> Remplacer l'OST favorite ?
        </h2>
        <p className="mp-confirm-text">
          Tu as déjà une OST favorite
          {gameName ? (
            <>
              {" "}
              pour <strong>{gameName}</strong>
            </>
          ) : (
            " pour ce jeu"
          )}{" "}
          : <strong>« {fav?.name} »</strong>
          {fav?.artist ? ` — ${fav.artist}` : ""}. Elle sera remplacée par la piste
          en cours.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost clickable" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" className="btn btn-primary clickable" onClick={onConfirm}>
            <Heart size={15} /> Remplacer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Modale « File de lecture » : liste des pistes de la playlist en cours ---
function QueueModal({ player, onClose }) {
  const { queue, source, playing, current } = player;
  const activeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fait apparaître la piste en cours à l'ouverture.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal mpq-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <div className="mpq-head">
          <span className="mpq-head-icon">
            <ListMusic size={20} />
          </span>
          <div className="mpq-head-txt">
            <span className="mpq-head-kicker">File de lecture</span>
            <h2 className="mpq-head-title">{source?.label || "Lecture en cours"}</h2>
            <span className="mpq-head-count">
              {queue.length} piste{queue.length > 1 ? "s" : ""}
            </span>
          </div>
          {source?.href && (
            <Link to={source.href} className="mpq-open clickable" onClick={onClose}>
              <span>Voir la playlist</span>
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>

        <div className="mpq-list">
          {queue.map((t, i) => {
            const active = current?.videoId === t.videoId;
            return (
              <button
                key={t.id || t.videoId || i}
                ref={active ? activeRef : null}
                className={`mpq-row clickable ${active ? "active" : ""}`}
                onClick={() =>
                  active
                    ? player.toggle()
                    : player.playFromList(t, queue, { source })
                }
              >
                <span className="mpq-index">
                  {active ? (
                    playing ? (
                      <span className="mpq-eq" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <Play size={14} fill="currentColor" strokeWidth={0} />
                    )
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="mpq-thumb">
                  {t.artwork ? (
                    <img src={t.artwork} alt="" draggable="false" />
                  ) : (
                    <Music size={16} />
                  )}
                </span>
                <span className="mpq-info">
                  <span className="mpq-name">{t.name}</span>
                  {t.artist && <span className="mpq-artist">{t.artist}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
