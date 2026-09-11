// ======================================================================
//  Importer sa bibliothèque Backloggd
// ======================================================================
//
// Deux écrans, comme l'import Steam : on colle l'adresse de son profil, on
// regarde ce qui a été trouvé, on décoche ce qu'on ne veut pas, on valide.
//
// ⚠️ RIEN N'EST ÉCRIT AVANT LA VALIDATION. L'aperçu est une lecture pure — le
// serveur ne fait que lire les pages publiques du profil. C'est important ici
// plus qu'ailleurs : les données viennent de la mise en page d'un site tiers,
// donc il faut pouvoir constater ce qu'on a compris avant de l'enregistrer.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Check,
  Search,
  ExternalLink,
  Gamepad2,
  Star,
  PenLine,
  Sparkles,
  PartyPopper,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";

const STATUS_LABEL = {
  wishlist: "Envie",
  playing: "En cours",
  finished: "Terminé",
  paused: "En pause",
  dropped: "Abandonné",
  endless: "Sans fin",
};

export default function BackloggdImportModal({ onClose, onDone }) {
  const { token } = useAuth();
  const { refresh } = useLibrary();

  const [phase, setPhase] = useState("ask"); // ask | scan | review | importing | done
  const [url, setUrl] = useState("");
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { username, counts, games }
  const [picked, setPicked] = useState({}); // igdbId -> bool
  const [overwriteRatings, setOverwriteRatings] = useState(false);
  const [overwriteReviews, setOverwriteReviews] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && phase !== "importing" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  async function scan(e) {
    e?.preventDefault();
    if (!url.trim()) return;
    setPhase("scan");
    setError(null);
    try {
      const d = await apiFetch("/backloggd/preview", {
        method: "POST",
        token,
        body: { url: url.trim() },
      });
      setData(d);
      // Tout est coché d'avance : on vient pour importer, pas pour cocher
      // trois cents cases. Décocher reste possible ligne à ligne.
      setPicked(Object.fromEntries(d.games.map((g) => [g.igdbId, true])));
      setPhase("review");
    } catch (err) {
      setError(err.message);
      setPhase("ask");
    }
  }

  const chosen = useMemo(
    () => (data?.games || []).filter((g) => picked[g.igdbId]),
    [data, picked]
  );

  async function run() {
    setPhase("importing");
    try {
      const r = await apiFetch("/backloggd/import", {
        method: "POST",
        token,
        body: { items: chosen, overwriteRatings, overwriteReviews },
      });
      setResult(r);
      refresh?.();
      onDone?.();
      setPhase("done");
    } catch (err) {
      setError(err.message);
      setPhase("review");
    }
  }

  const allOn = data && chosen.length === data.games.length;

  return createPortal(
    <div
      className="steam-modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && phase !== "importing" && onClose()}
    >
      <div className="steam-modal bl-modal">
        {phase !== "importing" && (
          <button className="steam-modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        )}

        <div className="steam-modal-head">
          <div className="steam-modal-brand bl-brand">
            <Gamepad2 size={22} />
            <span>Import Backloggd</span>
          </div>
        </div>

        {/* --- 1. L'adresse du profil --- */}
        {phase === "ask" && (
          <form className="bl-body" onSubmit={scan}>
            <p className="bl-intro">
              Colle l'adresse de ta page Backloggd. On lit tes jeux, tes notes, ton
              avancement et tes avis — sans toucher à ton compte là-bas.
            </p>
            <div className="bl-field">
              <Search size={18} />
              <input
                type="text"
                inputMode="url"
                placeholder="https://backloggd.com/u/TonPseudo/games/"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                autoFocus
              />
            </div>
            {error && <p className="bl-error">{error}</p>}
            <button className="btn-steam-primary clickable" disabled={!url.trim()}>
              Lire mon profil
            </button>
            <p className="bl-hint">
              Ta bibliothèque doit être publique. La lecture prend quelques secondes :
              on parcourt tes pages une par une, sans brusquer leur serveur.
            </p>
          </form>
        )}

        {/* --- 2. La lecture --- */}
        {phase === "scan" && (
          <div className="steam-center">
            <Loader2 size={44} className="spin" />
            <h3>Lecture de ton profil…</h3>
            <p>On parcourt ta bibliothèque, tes rayons et tes avis.</p>
          </div>
        )}

        {/* --- 3. Ce qu'on a trouvé --- */}
        {phase === "review" && data && (
          <>
            <div className="bl-summary">
              <span>
                <b>{data.counts.total}</b> jeux
              </span>
              <span>
                <Star size={13} /> <b>{data.counts.rated}</b> notés
              </span>
              <span>
                <PenLine size={13} /> <b>{data.counts.reviewed}</b> avis
              </span>
              {data.counts.alreadyHere > 0 && (
                <span className="bl-already">
                  <Check size={13} /> {data.counts.alreadyHere} déjà chez toi
                </span>
              )}
            </div>

            {error && <p className="bl-error px">{error}</p>}

            <div className="bl-tools">
              <button
                className="bl-all clickable"
                onClick={() =>
                  setPicked(
                    allOn
                      ? {}
                      : Object.fromEntries(data.games.map((g) => [g.igdbId, true]))
                  )
                }
              >
                {allOn ? "Tout décocher" : "Tout cocher"}
              </button>
              <span className="bl-count">{chosen.length} sélectionné(s)</span>
            </div>

            <div className="bl-list">
              {data.games.map((g) => {
                const on = !!picked[g.igdbId];
                return (
                  <button
                    key={g.igdbId}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`bl-row clickable ${on ? "on" : ""}`}
                    onClick={() =>
                      setPicked((p) => ({ ...p, [g.igdbId]: !p[g.igdbId] }))
                    }
                  >
                    <span className="bl-cover">
                      {g.cover ? (
                        <img src={g.cover} alt="" loading="lazy" draggable="false" />
                      ) : (
                        <Gamepad2 size={15} />
                      )}
                    </span>
                    <span className="bl-text">
                      <span className="bl-name">{g.title || `Jeu #${g.igdbId}`}</span>
                      <span className="bl-meta">
                        <span className={`bl-status st-${g.status}`}>
                          {STATUS_LABEL[g.status]}
                        </span>
                        {g.rating != null && ` · ${g.rating}/100`}
                        {g.platinum && " · 100 %"}
                        {g.review && " · avis"}
                        {g.inLibrary && (
                          <span className="bl-here">
                            déjà chez toi
                            {g.currentStatus &&
                              g.currentStatus !== g.status &&
                              ` (${STATUS_LABEL[g.currentStatus]} → ${STATUS_LABEL[g.status]})`}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="bl-box">{on && <Check size={13} strokeWidth={3} />}</span>
                  </button>
                );
              })}
            </div>

            {/* ⚠️ LES ÉCRASEMENTS SE DEMANDENT, ILS NE SE SUPPOSENT PAS. Une
                note ou un avis déjà écrits ICI valent mieux qu'une reprise
                automatique : on complète les cases vides par défaut, et on ne
                remplace que si on le dit. */}
            {(data.games.some((g) => g.wouldOverwriteRating) ||
              data.games.some((g) => g.wouldOverwriteReview)) && (
              <div className="bl-overwrite">
                {data.games.some((g) => g.wouldOverwriteRating) && (
                  <label className="bl-check">
                    <input
                      type="checkbox"
                      checked={overwriteRatings}
                      onChange={(e) => setOverwriteRatings(e.target.checked)}
                    />
                    Remplacer mes notes existantes par celles de Backloggd
                  </label>
                )}
                {data.games.some((g) => g.wouldOverwriteReview) && (
                  <label className="bl-check">
                    <input
                      type="checkbox"
                      checked={overwriteReviews}
                      onChange={(e) => setOverwriteReviews(e.target.checked)}
                    />
                    Remplacer mes avis existants par ceux de Backloggd
                  </label>
                )}
              </div>
            )}

            <div className="bl-foot">
              <a
                className="bl-link"
                href={`https://backloggd.com/u/${data.username}/games/`}
                target="_blank"
                rel="noreferrer"
              >
                Voir le profil <ExternalLink size={12} />
              </a>
              <button
                className="btn-steam-primary clickable"
                onClick={run}
                disabled={!chosen.length}
              >
                <Sparkles size={15} /> Importer {chosen.length} jeu
                {chosen.length > 1 ? "x" : ""}
              </button>
            </div>
          </>
        )}

        {phase === "importing" && (
          <div className="steam-center">
            <Loader2 size={44} className="spin" />
            <h3>Import en cours…</h3>
            <p>On range tes jeux dans ta bibliothèque.</p>
          </div>
        )}

        {phase === "done" && result && (
          <div className="steam-center">
            <PartyPopper size={44} />
            <h3>C'est fait</h3>
            <p>
              {result.added} jeu{result.added > 1 ? "x" : ""} ajouté
              {result.added > 1 ? "s" : ""}
              {result.updated > 0 &&
                `, ${result.updated} mis à jour`}
              .
            </p>
            <button className="btn-steam-primary clickable" onClick={onClose}>
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
