import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  X,
  Check,
  Grid2x2,
  Loader2,
  Gamepad2,
  Trophy,
  Swords,
  Timer,
  CircleHelp,
  Images,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import ShotViewer from "./ShotViewer";

// Modale « résultats d'une partie de Pixel Rush » : ouverte depuis la carte du
// fil, elle détaille chaque manche — le jeu à trouver, la réponse donnée, et
// SURTOUT les captures. Cliquer une manche ouvre ses captures en grand : c'est
// là qu'on juge si le type pouvait vraiment reconnaître le jeu, ou pas.
//
// Le pendant musical est BlindTestResultsModal, dont on reprend la coquille
// (.btr-*) : même contrat serveur, même en-tête, seule la ligne change.
export default function PixelResultsModal({ item, token, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null); // manche dont on regarde les captures

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Échap ferme la modale — sauf quand la visionneuse est ouverte par-dessus :
  // là c'est ELLE que la touche doit fermer (elle a son propre écouteur), sinon
  // les deux se fermeraient d'un coup.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !viewer) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, viewer]);

  useEffect(() => {
    let alive = true;
    apiFetch(`/pixel/${item.pixelGameId}/results`, { token })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message || "Erreur de chargement."));
    return () => {
      alive = false;
    };
  }, [item.pixelGameId, token]);

  const u = data?.user || item.user;
  const score = data?.score ?? item.score;
  const correct = data?.correctCount ?? item.correct;
  const total = data?.roundCount ?? item.total;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const ch = data?.challenge;

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal btr-modal pxr-modal">
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>

          <header className="btr-head">
            <Link to={`/u/${u.username}`} className="btr-avatar clickable" onClick={onClose}>
              {u.avatar ? (
                <img src={u.avatar} alt="" draggable="false" />
              ) : (
                (u.username || "?")[0].toUpperCase()
              )}
            </Link>
            <div className="btr-head-txt">
              <h2 className="btr-title">
                <Grid2x2 size={16} /> Pixel Rush de {u.username}
              </h2>
              <span className="btr-sub">
                <Trophy size={12} /> {correct}/{total} reconnus · {pct}%
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
              {data.rounds.map((r, i) => (
                <li key={i} className={`btr-row ${r.correct ? "good" : "bad"}`}>
                  <span className="btr-num">{i + 1}</span>

                  {/* La vignette ouvre TOUTES les captures de la manche. */}
                  <button
                    className={`pxr-shot ${r.shots?.length ? "clickable" : ""}`}
                    onClick={r.shots?.length ? () => setViewer(r) : undefined}
                    disabled={!r.shots?.length}
                    title={
                      r.shots?.length
                        ? `Revoir les captures de ${r.gameName}`
                        : "Captures indisponibles"
                    }
                  >
                    {r.shots?.[0] || r.cover ? (
                      <img
                        src={r.shots?.[0] || r.cover}
                        alt=""
                        loading="lazy"
                        draggable="false"
                      />
                    ) : (
                      <span className="pxr-shot-ph">
                        <Gamepad2 size={14} />
                      </span>
                    )}
                    {r.shots?.length > 1 && (
                      <span className="pxr-shot-count">
                        <Images size={10} /> {r.shots.length}
                      </span>
                    )}
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
              ))}
            </ul>
          )}
        </div>
      </div>

      {viewer && <ShotViewer round={viewer} onClose={() => setViewer(null)} />}
    </>,
    document.body
  );
}
