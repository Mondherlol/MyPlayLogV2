import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { brandOf, steamVerdict } from "../lib/scoreBrands";
import StoreIcon from "./StoreIcon";

// ======================================================================
//  TOUTES les notes d'un jeu
// ======================================================================
// ⚠️ DEUX JAUGES DANS L'EN-TÊTE, ET SIX SOURCES DANS LA BASE. La fiche
// n'affichait que « Joueurs » et « Critiques » (IGDB), alors que la route
// /games/:id/ratings rend aussi Metacritic, OpenCritic, IGN, jeuxvideo.com,
// les avis Steam et la moyenne d'ici — des notes déjà calculées, déjà en
// cache, que personne ne pouvait voir. Cliquer une jauge ouvre donc la liste
// complète, comme la feuille de l'app mobile.
//
// La note d'ICI passe devant : c'est la seule que ce site est seul à avoir.
function Row({ brandKey, score, max = 100, count, sub, url }) {
  const b = brandOf(brandKey);
  const pct = Math.round((score / max) * 100);
  return (
    <li className="grm-row">
      <span className="grm-mark" style={{ background: b.color, color: b.ink }}>
        {b.icon ? (
          <svg width="17" height="17" viewBox={b.icon.viewBox} fill="currentColor" aria-hidden="true">
            <path d={b.icon.d} />
          </svg>
        ) : b.platform ? (
          <StoreIcon store={b.platform} size={16} />
        ) : (
          <b>{b.mono}</b>
        )}
      </span>

      <span className="grm-id">
        <b>{b.label}</b>
        <small>{sub ?? b.sub}</small>
      </span>

      <span className="grm-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: b.color }} />
      </span>

      <span className="grm-score">
        {score}
        <small>/{max}</small>
        {count ? <em>{count.toLocaleString("fr-FR")}</em> : null}
      </span>

      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="grm-go clickable" aria-label={`Ouvrir ${b.label}`}>
          <ExternalLink size={14} />
        </a>
      )}
    </li>
  );
}

export default function GameRatingsModal({ gameId, gameName, token, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useScrollLock();
  useBackClose(onClose, "gameRatings");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    let alive = true;
    apiFetch(`/games/${gameId}/ratings`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [gameId, token, onClose]);

  const rows = [];
  if (data) {
    const { community, igdb, steam, external } = data;
    if (community?.avg != null)
      rows.push({ brandKey: "community", score: community.avg, count: community.count });
    if (igdb?.players)
      rows.push({ brandKey: "igdb", score: igdb.players.score, count: igdb.players.count });
    if (igdb?.critics)
      rows.push({ brandKey: "igdbCritics", score: igdb.critics.score, count: igdb.critics.count });
    if (steam?.percent != null)
      rows.push({
        brandKey: "steam",
        score: steam.percent,
        count: steam.total,
        sub: steamVerdict(steam.scoreDesc, steam.percent),
        url: steam.url,
      });
    for (const s of external || [])
      rows.push({ brandKey: s.key, score: s.score, max: s.max, count: s.count, url: s.url });
  }

  return createPortal(
    <div className="grm-back" onMouseDown={onClose} role="presentation">
      <div
        className="grm"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Notes de ${gameName}`}
      >
        <header className="grm-head">
          <div>
            <span className="grm-kicker">Toutes les notes</span>
            <h3>{gameName}</h3>
          </div>
          <button className="grm-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        {error ? (
          <p className="grm-empty">{error}</p>
        ) : !data ? (
          <div className="grm-load">
            <Loader2 size={22} className="spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="grm-empty">Personne n'a encore noté ce jeu.</p>
        ) : (
          <ul className="grm-list">
            {rows.map((r) => (
              <Row key={r.brandKey} {...r} />
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  );
}
