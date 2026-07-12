import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  X,
  Check,
  Play,
  Pause,
  Music,
  Music2,
  Loader2,
  Gamepad2,
  Trophy,
  Swords,
  Timer,
  CircleHelp,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { usePlayer } from "../context/PlayerContext";
import { timeAgo } from "../lib/lists";

// Modale « résultats d'un blind test » : ouverte depuis la carte du fil, elle
// détaille chaque manche de la partie — la bonne réponse et la réponse donnée.
// Chaque manche est une mini-pochette + CD (même esprit que l'onglet OST du
// profil, en plus petit) : cliquer lance l'extrait dans le mini-lecteur global,
// le CD tourne pendant la lecture.
export default function BlindTestResultsModal({ item, token, onClose }) {
  const player = usePlayer();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch(`/blindtest/${item.blindTestId}/results`, { token })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message || "Erreur de chargement."));
    return () => {
      alive = false;
    };
  }, [item.blindTestId, token]);

  // File du mini-lecteur : toutes les bonnes réponses de la partie (lancer une
  // piste permet d'enchaîner les autres avec suivant/précédent).
  const tracks = useMemo(
    () =>
      (data?.rounds || [])
        .filter((r) => r.videoId)
        .map((r) => ({
          id: `btr-${r.gameId}-${r.videoId}`,
          videoId: r.videoId,
          name: r.ostName || r.gameName,
          artist: r.gameName,
          artwork: r.cover || null,
          gameId: r.gameId,
          gameName: r.gameName,
        })),
    [data]
  );
  const trackFor = (r) => tracks.find((t) => t.videoId === r.videoId) || null;

  const source = { label: `Blind test de ${item.user.username}` };
  const u = data?.user || item.user;
  const score = data?.score ?? item.score;
  const correct = data?.correctCount ?? item.correct;
  const total = data?.roundCount ?? item.total;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const ch = data?.challenge;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal btr-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <header className="btr-head">
          <Link
            to={`/u/${u.username}`}
            className="btr-avatar clickable"
            onClick={onClose}
          >
            {u.avatar ? (
              <img src={u.avatar} alt="" draggable="false" />
            ) : (
              (u.username || "?")[0].toUpperCase()
            )}
          </Link>
          <div className="btr-head-txt">
            <h2 className="btr-title">
              <Music2 size={16} /> Blind test de {u.username}
            </h2>
            <span className="btr-sub">
              <Trophy size={12} /> {correct}/{total} trouvés · {pct}%
              {data?.date && <i> · {timeAgo(data.date)}</i>}
            </span>
            {ch && (
              <span className={`btr-versus ${ch.beaten ? "win" : "lose"}`}>
                <Swords size={12} />
                {ch.beaten
                  ? `a battu ${ch.user?.username || "?"} (${ch.score})`
                  : `${ch.user?.username || "?"} garde la tête (${ch.score})`}
              </span>
            )}
          </div>
          <div className="btr-scorebox">
            <span className="btr-score-num">{score}</span>
            <span className="btr-score-lbl">points</span>
          </div>
        </header>

        {error ? (
          <p className="btr-empty font-fun">{error}</p>
        ) : !data ? (
          <div className="btr-loading" aria-busy="true">
            <Loader2 size={22} className="spin" />
          </div>
        ) : (
          <ul className="btr-list">
            {data.rounds.map((r, i) => {
              const t = trackFor(r);
              const on = t && player?.isPlaying?.(t);
              return (
                <li
                  key={i}
                  className={`btr-row ${r.correct ? "good" : "bad"} ${on ? "playing" : ""}`}
                >
                  <span className="btr-num">{i + 1}</span>

                  {/* Mini pochette + CD : clic = lecture, le CD tourne. */}
                  <button
                    className={`btr-sleeve ${t ? "clickable" : ""}`}
                    onClick={t ? () => player?.toggleTrack?.(t, tracks, { source }) : undefined}
                    disabled={!t}
                    title={
                      !t
                        ? "Extrait indisponible"
                        : on
                          ? "Mettre en pause"
                          : "Écouter l'extrait"
                    }
                  >
                    <span className="btr-cd" aria-hidden="true">
                      <span className="btr-disc">
                        <span className="btr-disc-label">
                          {r.cover ? (
                            <img src={r.cover} alt="" loading="lazy" draggable="false" />
                          ) : (
                            <Music size={12} />
                          )}
                          <span className="btr-disc-hole" />
                        </span>
                      </span>
                    </span>
                    <span className="btr-album">
                      {r.cover ? (
                        <img src={r.cover} alt="" loading="lazy" draggable="false" />
                      ) : (
                        <span className="btr-album-ph">
                          <Gamepad2 size={14} />
                        </span>
                      )}
                      <span className="btr-album-mouth" />
                      {t && (
                        <span className="btr-sleeve-play">
                          {on ? (
                            <Pause size={13} fill="currentColor" strokeWidth={0} />
                          ) : (
                            <Play size={13} fill="currentColor" strokeWidth={0} />
                          )}
                        </span>
                      )}
                    </span>
                    <span className="btr-verdict">
                      {r.correct ? <Check size={11} /> : <X size={11} />}
                    </span>
                  </button>

                  <span className="btr-info">
                    <Link
                      to={`/game/${r.gameId}`}
                      className="btr-game clickable"
                      onClick={onClose}
                    >
                      {r.gameName}
                    </Link>
                    <span className="btr-meta">
                      {r.correct && r.timeMs != null && (
                        <span className="btr-time">
                          <Timer size={11} /> en{" "}
                          {(r.timeMs / 1000).toFixed(1).replace(".", ",")} s
                        </span>
                      )}
                    </span>

                    {/* Manche ratée : la réponse donnée. */}
                    {!r.correct &&
                      (r.guessed || r.guessedName ? (
                        <span className="btr-guess">
                          <span className="btr-guess-cover">
                            {r.guessed?.cover ? (
                              <img
                                src={r.guessed.cover}
                                alt=""
                                loading="lazy"
                                draggable="false"
                              />
                            ) : (
                              <Gamepad2 size={11} />
                            )}
                          </span>
                          <span className="btr-guess-txt">
                            a répondu <b>{r.guessed?.name || r.guessedName}</b>
                          </span>
                        </span>
                      ) : (
                        <span className="btr-guess none">
                          <CircleHelp size={12} /> pas de réponse
                        </span>
                      ))}
                  </span>

                  <span className="btr-side">
                    <span className={`btr-pts ${r.points >= 0 ? "up" : "down"}`}>
                      {r.points >= 0 ? `+${r.points}` : r.points}
                    </span>
                    {!r.owned && <span className="btr-tag">Jamais joué</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
