import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  // Cette version de lucide n'a pas de logo YouTube (`Youtube`) : `Video` fait
  // le même travail — c'est l'onglet « une vidéo, par son lien ».
  Video,
  Library,
  Loader2,
  Play,
  Tv,
  Film,
  ChevronRight,
  Link2,
  Zap,
  Timer,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { episodeSources, PROVIDERS } from "../lib/collection";
import { useScrollLock } from "../hooks/useScrollLock";

// ======================================================================
//  « On regarde quoi ? » — le choix, en deux portes
// ======================================================================
// UNE ÉTAGÈRE, ET UN CHAMP. Ce sont les deux seules façons dont un titre arrive
// dans une séance :
//
//   1. LA COLLECTION — les boîtiers du rayon, en cartes. On choisit un titre,
//      puis son épisode s'il en a plusieurs : deux temps, parce qu'une grille
//      qui mélangerait « Cowboy Bebop » et ses 26 épisodes ne se lit plus ;
//   2. UN LIEN YOUTUBE — collé à la volée. C'est ce qui rend la salle utile en
//      dehors du rayon : un trailer qui vient de tomber, un Nintendo Direct, une
//      rétrospective de deux heures. Rien n'est enregistré nulle part, la vidéo
//      est jouée telle quelle.
//
// La séance annonce à chaque carte CE QU'ELLE PERMET : un titre servi par
// YouTube ou par un fichier se synchronise tout seul, un titre qui n'a que des
// hébergeurs opaques passera en synchro guidée. C'est l'information qui décide
// vraiment du choix quand on veut regarder à plusieurs, et elle se lit avant de
// cliquer, pas après.

export default function WatchPartyPicker({ token, current, onPick, onClose }) {
  const [tab, setTab] = useState("collection"); // collection | youtube
  const [media, setMedia] = useState([]);
  const [status, setStatus] = useState("loading");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null); // le titre déplié (choix de l'épisode)
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useScrollLock();

  useEffect(() => {
    let alive = true;
    apiFetch("/collection", { token })
      .then((d) => {
        if (!alive) return;
        // Le papier et les cartouches ne se regardent pas ensemble : un volume se
        // lit à son rythme, une partie de DS ne se pilote pas à distance.
        setMedia((d.media || []).filter((m) => m.kind === "series" || m.kind === "film"));
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return media;
    return media.filter((m) =>
      [m.title, m.originalTitle, m.franchise, ...(m.genres || [])]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [media, query]);

  async function pick(body) {
    setBusy(true);
    setError(null);
    try {
      await onPick(body);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="wp-modal" role="dialog" aria-label="Choisir ce qu'on regarde">
      <button className="wp-modal-veil" onClick={onClose} aria-label="Fermer" />
      <div className="wp-modal-box wp-pick">
        <header className="wp-modal-head">
          <div>
            <span className="wp-modal-over">Séance</span>
            <h2>On regarde quoi ?</h2>
          </div>
          <button className="wp-modal-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        <div className="wp-tabs">
          <button
            className={`clickable ${tab === "collection" ? "active" : ""}`}
            onClick={() => setTab("collection")}
          >
            <Library size={15} /> Ma collection
          </button>
          <button
            className={`clickable ${tab === "youtube" ? "active" : ""}`}
            onClick={() => setTab("youtube")}
          >
            <Video size={15} /> Lien YouTube
          </button>
        </div>

        {error && <p className="wp-modal-err">{error}</p>}

        {tab === "collection" ? (
          <>
            <label className="wp-pick-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Chercher un titre…"
                autoFocus
              />
              {query && (
                <button className="clickable" onClick={() => setQuery("")} aria-label="Effacer">
                  <X size={14} />
                </button>
              )}
            </label>

            {status === "loading" && (
              <div className="wp-pick-wait">
                <Loader2 size={20} className="spin" /> Ouverture de l'étagère…
              </div>
            )}

            {status === "ready" && shown.length === 0 && (
              <p className="wp-pick-empty">Aucun titre ne correspond.</p>
            )}

            <div className="wp-pick-grid">
              {shown.map((m) => (
                <Card
                  key={m.slug}
                  m={m}
                  current={current?.slug === m.slug}
                  busy={busy}
                  expanded={open === m.slug}
                  onExpand={() => setOpen(open === m.slug ? null : m.slug)}
                  onPick={(episodeIndex) => pick({ slug: m.slug, episodeIndex })}
                  token={token}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="wp-yt-form">
            <p className="wp-yt-hint">
              <Link2 size={14} /> Colle l'adresse d'une vidéo YouTube : trailer,
              conférence, rétrospective… Elle se lance pour toute la salle, en
              synchro automatique.
            </p>
            <div className="wp-yt-row">
              <Video size={18} />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && url.trim() && pick({ youtubeUrl: url })}
              />
            </div>
            <button
              className="btn btn-primary clickable wp-yt-go"
              disabled={!url.trim() || busy}
              onClick={() => pick({ youtubeUrl: url })}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              Lancer pour tout le monde
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// --------------------------------------------------------------------- la carte
// Un boîtier, son affiche, et LA PROMESSE DE SYNCHRO. Les séries se déplient
// pour choisir l'épisode ; un film part au clic.
function Card({ m, current, busy, expanded, onExpand, onPick, token }) {
  const [eps, setEps] = useState(null);
  const [loading, setLoading] = useState(false);
  const isSeries = m.kind === "series" && m.episodeCount > 1;

  // Les épisodes ne descendent qu'à l'ouverture : la liste de l'étagère ne les
  // porte pas (une série de 78 épisodes pèserait pour rien dans la grille).
  useEffect(() => {
    if (!expanded || eps || loading) return;
    setLoading(true);
    apiFetch(`/collection/${m.slug}`, { token })
      .then((d) => setEps(d.media?.episodes || []))
      .catch(() => setEps([]))
      .finally(() => setLoading(false));
  }, [expanded, eps, loading, m.slug, token]);

  // Ce que la synchro pourra faire dépend du LECTEUR du titre, connu dès la
  // carte : `provider` est celui de la source de référence.
  const auto = !!PROVIDERS[m.provider]?.piloted;

  return (
    <div className={`wp-card ${current ? "current" : ""} ${expanded ? "open" : ""}`}>
      <button
        className="wp-card-main clickable"
        disabled={busy}
        onClick={() => (isSeries ? onExpand() : onPick(0))}
        style={{ "--tint": m.color || "var(--orange)" }}
      >
        <span className="wp-card-art">
          {m.poster ? (
            <img src={m.poster} alt="" loading="lazy" />
          ) : (
            <span className="wp-card-noart">{isSeries ? <Tv size={20} /> : <Film size={20} />}</span>
          )}
          <span className={`wp-card-sync ${auto ? "auto" : "guided"}`}>
            {auto ? <Zap size={11} /> : <Timer size={11} />}
            {auto ? "auto" : "guidée"}
          </span>
          <span className="wp-card-go">
            {isSeries ? <ChevronRight size={18} /> : <Play size={18} fill="currentColor" />}
          </span>
        </span>
        <span className="wp-card-text">
          <strong>{m.title}</strong>
          <em>
            {isSeries ? `${m.episodeCount} épisodes` : "Film"}
            {m.year ? ` · ${m.year}` : ""}
          </em>
        </span>
      </button>

      {expanded && (
        <div className="wp-card-eps">
          {loading && (
            <p className="wp-card-wait">
              <Loader2 size={14} className="spin" /> Chargement…
            </p>
          )}
          {(eps || []).map((ep, i) => {
            const pilotedEp = episodeSources(ep).some((s) => PROVIDERS[s.provider]?.piloted);
            return (
              <button
                key={ep.index ?? i}
                className="wp-card-ep clickable"
                disabled={busy}
                onClick={() => onPick(ep.index ?? i)}
              >
                <span className="wp-card-ep-num">
                  {String(ep.number ?? i + 1).padStart(2, "0")}
                </span>
                <span className="wp-card-ep-title">{ep.title}</span>
                {pilotedEp ? <Zap size={11} /> : <Timer size={11} />}
              </button>
            );
          })}
          {eps && eps.length === 0 && !loading && (
            <p className="wp-card-wait">Aucune source disponible.</p>
          )}
        </div>
      )}
    </div>
  );
}
