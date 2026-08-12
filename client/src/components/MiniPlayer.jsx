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
  Radio,
  Eraser,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { usePlayer, usePlayerProgress } from "../context/PlayerContext";
import { useListenParty } from "../context/ListenPartyContext";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import AddToPlaylistModal from "./AddToPlaylistModal";
import ListenPartyPanel from "./ListenPartyPanel";
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
  // L'écoute en groupe. QUAND ON SUIT QUELQU'UN, LES COMMANDES SE VERROUILLENT :
  // c'est l'hôte qui mène, et un bouton qui répond à moitié (on met en pause,
  // le recalage relance trois secondes plus tard) serait pire qu'un bouton
  // désactivé. Le bouton « quitter » est juste à côté, à un clic.
  const listen = useListenParty();
  const party = listen.party;
  const following = listen.following;
  const listeners = party?.listeners || [];
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
  // Le panneau de la séance d'écoute (démarrer, inviter, partager le lien).
  const [panel, setPanel] = useState(false);

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
            {/* La séance passe AVANT l'artiste : quand on écoute avec quelqu'un,
                c'est l'information qui explique tout le reste — pourquoi la
                piste a changé toute seule, pourquoi les boutons ne répondent
                plus. */}
            {party && (
              <span className={`mp-party-tag ${following ? "guest" : ""}`}>
                <Radio size={11} />
                {following
                  ? `Avec ${party.host?.username || "quelqu'un"}`
                  : listeners.length
                  ? `${listeners.length} à l'écoute`
                  : "Séance ouverte"}
              </span>
            )}
            {current.artist && <span className="mp-artist">{current.artist}</span>}
            {current.gameId && (
              <Link to={`/game/${current.gameId}`} className="mp-game clickable">
                <Disc3 size={12} />
                <span>{current.gameName || "Voir le jeu"}</span>
              </Link>
            )}
          </span>
        </div>

        <div className={`mp-controls ${following ? "locked" : ""}`}>
          <button
            className="mp-btn clickable"
            onClick={player.prev}
            disabled={following || (!hasPrev && progress.current < 3)}
            title={following ? "C'est l'hôte qui mène" : "Précédent"}
            aria-label="Précédent"
          >
            <SkipBack size={18} fill="currentColor" strokeWidth={0} />
          </button>
          {/* SUIVEUR : le bouton reste VIVANT tant que le son n'est pas parti.
              C'est le rattrapage du « je n'entends rien » — un navigateur qui a
              refusé de démarrer tout seul ne changera d'avis que sur un vrai
              clic (voir `prime` dans PlayerContext). Une fois la musique
              lancée, il se verrouille : mettre en pause de son côté n'aurait
              aucun sens, le recalage relancerait deux secondes plus tard. */}
          <button
            className="mp-btn mp-play clickable"
            onClick={following ? listen.resync : player.toggle}
            disabled={following && playing}
            title={
              following
                ? playing
                  ? `C'est ${party?.host?.username || "l'hôte"} qui mène la séance`
                  : "Reprendre l'écoute"
                : playing
                ? "Pause"
                : loading
                ? "Chargement…"
                : "Lecture"
            }
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
            disabled={following || !hasNext}
            title={following ? "C'est l'hôte qui mène" : "Suivant"}
            aria-label="Suivant"
          >
            <SkipForward size={18} fill="currentColor" strokeWidth={0} />
          </button>
        </div>

        <div className={`mp-seek ${following ? "locked" : ""}`}>
          <span className="mp-time">{fmt(progress.current)}</span>
          <div
            className="mp-bar"
            ref={barRef}
            onClick={following ? undefined : onSeek}
          >
            <div className="mp-bar-fill" style={{ width: `${pct}%` }}>
              <span className="mp-bar-knob" />
            </div>
          </div>
          <span className="mp-time">{fmt(progress.duration)}</span>
        </div>

        <div className="mp-actions">
          {/* ---------------------- ÉCOUTER À PLUSIEURS ----------------------
              Un seul bouton, trois états : ouvrir ma séance, la fermer (avec le
              nombre de gens branchés dessus), ou quitter celle où je suis. Il
              est ICI et pas ailleurs parce que la question ne se pose qu'une
              fois la musique lancée — et que c'est le seul endroit de l'app qui
              existe sur toutes les pages en même temps qu'elle. */}
          {token && (
            <button
              className={`mp-icon-btn mp-party clickable ${party ? "on" : ""} ${
                following ? "guest" : ""
              }`}
              onClick={() => setPanel((v) => !v)}
              title={
                following
                  ? `Séance de ${party.host?.username || "l'hôte"}`
                  : party
                    ? `Ta séance · ${listeners.length} à l'écoute`
                    : "Écouter à plusieurs"
              }
              aria-label="Séance d'écoute"
              aria-expanded={panel}
            >
              <Radio size={17} />
              {party && listeners.length > 0 && (
                <em className="mp-party-n">{listeners.length}</em>
              )}
            </button>
          )}

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

      {panel && <ListenPartyPanel onClose={() => setPanel(false)} />}

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

// ======================================================================
//  Modale « File de lecture » — et enfin de quoi la TENIR
// ======================================================================
// ELLE ÉTAIT EN LECTURE SEULE : une liste de titres où l'on ne pouvait que
// sauter d'un morceau à l'autre. Pas de « celui-là, non », pas de « remonte
// celui-ci », pas de « repars propre » — la seule façon de corriger une file
// était de relancer une autre playlist par-dessus.
//
// TROIS GESTES, TOUS À PORTÉE DE POUCE : retirer, déplacer, vider. Le
// glisser-déposer natif ne marche pas au doigt, d'où les flèches — elles ne
// sont pas un repli pour le mobile, c'est le seul moyen qui marche PARTOUT, et
// le glissé vient en plus pour ceux qui ont une souris.
//
// EN SÉANCE D'ÉCOUTE INVITÉE, TOUT SE VERROUILLE : la file affichée est celle
// de l'hôte, la modifier de son côté ne changerait rien chez personne et le
// prochain repère l'écraserait deux secondes plus tard. On le dit, plutôt que
// de laisser des boutons mentir.
function QueueModal({ player, onClose }) {
  const { queue, source, playing, current, index } = player;
  const listen = useListenParty();
  const locked = listen.following;
  const activeRef = useRef(null);
  const [drag, setDrag] = useState(null); // index en cours de glissé
  const [over, setOver] = useState(null); // index survolé
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fait apparaître la piste en cours à l'ouverture.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "center" });
  }, []);

  // La file vidée pendant que la question était posée : plus rien à confirmer.
  useEffect(() => {
    if (queue.length <= 1) setConfirmClear(false);
  }, [queue.length]);

  function drop(to) {
    if (drag === null || drag === to) return;
    player.moveTrack(drag, to);
    setDrag(null);
    setOver(null);
  }

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
              {index < queue.length - 1 && ` · ${queue.length - index - 1} à venir`}
            </span>
          </div>
          {source?.href && (
            <Link to={source.href} className="mpq-open clickable" onClick={onClose}>
              <span>Voir la playlist</span>
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>

        {/* « Vider » demande confirmation : c'est le seul geste d'ici qu'on ne
            peut pas défaire, et il est à deux centimètres de « retirer une
            piste ». La question remplace le bouton plutôt que d'ouvrir une
            seconde fenêtre par-dessus la première. */}
        {locked ? (
          <p className="mpq-locked">
            C'est {listen.party?.host?.username || "l'hôte"} qui tient la file.
            {listen.party?.openQueue
              ? " Tu peux lui proposer des morceaux depuis les pages de jeu."
              : ""}
          </p>
        ) : (
          queue.length > 1 && (
            <div className="mpq-tools">
              {confirmClear ? (
                <>
                  <span className="mpq-tools-ask">
                    Vider la file ? La piste en cours reste.
                  </span>
                  <button
                    className="mpq-tool danger clickable"
                    onClick={() => {
                      player.clearQueue();
                      setConfirmClear(false);
                    }}
                  >
                    Vider
                  </button>
                  <button
                    className="mpq-tool clickable"
                    onClick={() => setConfirmClear(false)}
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  className="mpq-tool clickable"
                  onClick={() => setConfirmClear(true)}
                >
                  <Eraser size={14} /> Vider la file
                </button>
              )}
            </div>
          )
        )}

        <div className="mpq-list">
          {queue.map((t, i) => {
            const active = current?.videoId === t.videoId;
            return (
              <div
                key={t.id || t.videoId || i}
                ref={active ? activeRef : null}
                className={`mpq-row ${active ? "active" : ""} ${
                  over === i && drag !== null && drag !== i ? "over" : ""
                } ${drag === i ? "dragging" : ""}`}
                draggable={!locked}
                onDragStart={() => setDrag(i)}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDragOver={(e) => {
                  if (locked || drag === null) return;
                  e.preventDefault();
                  setOver(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(i);
                }}
              >
                <button
                  type="button"
                  className="mpq-play clickable"
                  onClick={() =>
                    active ? player.toggle() : player.playFromList(t, queue, { source })
                  }
                  disabled={locked && !active}
                  title={active ? (playing ? "Pause" : "Lecture") : "Écouter"}
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

                {!locked && (
                  <span className="mpq-acts">
                    <button
                      className="mpq-act clickable"
                      onClick={() => player.moveTrack(i, i - 1)}
                      disabled={i === 0}
                      title="Monter"
                      aria-label="Monter"
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      className="mpq-act clickable"
                      onClick={() => player.moveTrack(i, i + 1)}
                      disabled={i === queue.length - 1}
                      title="Descendre"
                      aria-label="Descendre"
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      className="mpq-act del clickable"
                      onClick={() => player.removeAt(i)}
                      title={active ? "Retirer (passe à la suivante)" : "Retirer de la file"}
                      aria-label="Retirer de la file"
                    >
                      <X size={15} />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
