import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Library,
  LayoutGrid,
  Rows3,
  Search,
  X,
  Play,
  Sparkles,
  Info,
  RotateCw,
  Unplug,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import useMediaQuery from "../hooks/useMediaQuery";
import CollectionCase from "../components/CollectionCase";
import { ShelfSkeleton, GridSkeleton } from "../components/CollectionSkeleton";
import { KINDS, resumeLabel } from "../lib/collection";

// L'étagère 3D (three.js + R3F) ne part que si on la demande : même politique
// que Playtopia, le bundle principal ne doit pas la porter.
const CollectionShelf = lazy(() => import("../components/CollectionShelf"));

// ======================================================================
//  Collection — l'étagère des médias qui tournent autour du jeu vidéo
// ======================================================================
// Séries, films, animés : ce qui se regarde librement et qui parle de nos
// jeux. Deux vues du même rayon — l'étagère 3D (par défaut sur grand écran,
// parce que c'est l'idée) et la grille de boîtiers (toujours disponible, et
// vue par défaut sur téléphone).

const VIEW_KEY = "mpl_collection_view";

const KIND_FILTERS = [
  { value: "", label: "Tout" },
  { value: "series", label: "Séries" },
  { value: "film", label: "Films" },
];

export default function Collection() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const compact = useMediaQuery("(max-width: 900px)");

  const [media, setMedia] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [attempt, setAttempt] = useState(0); // « Réessayer » : relance la requête

  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") || "";
  const query = params.get("q") || "";

  // La vue 3D est un choix qu'on garde d'une visite à l'autre, mais elle ne
  // s'impose jamais sur un petit écran.
  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return "shelf";
    return localStorage.getItem(VIEW_KEY) || "shelf";
  });
  const effectiveView = compact ? "grid" : view;

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function pickView(v) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* navigation privée : la préférence n'est pas vitale */
    }
  }

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    apiFetch("/collection", { token })
      .then((d) => {
        if (!alive) return;
        setMedia(d.media || []);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [token, attempt]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return media.filter((m) => {
      if (kind && m.kind !== kind) return false;
      if (
        q &&
        ![m.title, m.originalTitle, m.franchise, ...(m.genres || [])]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
  }, [media, kind, query]);

  // Rangée « Reprendre » : ce qui a été commencé, le plus récent d'abord.
  const resuming = useMemo(
    () =>
      media
        .filter((m) => m.progress && !m.progress.completed)
        .sort(
          (a, b) =>
            new Date(b.progress.lastWatchedAt) - new Date(a.progress.lastWatchedAt)
        )
        .slice(0, 4),
    [media]
  );

  const counts = useMemo(
    () => ({
      series: media.filter((m) => m.kind === "series").length,
      film: media.filter((m) => m.kind === "film").length,
      episodes: media.reduce((n, m) => n + (m.episodeCount || 0), 0),
    }),
    [media]
  );

  return (
    <div className="coll-page">
      {/* ---------------- en-tête ---------------- */}
      <header className="coll-head">
        <div className="coll-head-main">
          <span className="coll-head-icon">
            <Library size={22} strokeWidth={2.4} />
          </span>
          <div>
            <span className="coll-head-over">Rayon vidéo</span>
            <h1 className="coll-head-title">Collection</h1>
            <p className="coll-head-sub">
              Séries, films et animés tirés de nos jeux — libres d'accès, rangés
              comme au vidéoclub.
            </p>
          </div>
        </div>

        {/* Les compteurs ne se remplissent qu'une fois le rayon connu : d'ici
            là, trois pastilles vides plutôt que trois zéros — un « 0 film »
            fugace se lit comme une collection vide. */}
        <div className="coll-head-stats">
          {status === "loading" ? (
            <>
              <span className="coll-skel-pill" />
              <span className="coll-skel-pill" />
              <span className="coll-skel-pill wide" />
            </>
          ) : (
            <>
              <span>
                <strong>{counts.series}</strong> série{counts.series > 1 ? "s" : ""}
              </span>
              <span>
                <strong>{counts.film}</strong> film{counts.film > 1 ? "s" : ""}
              </span>
              <span>
                <strong>{counts.episodes}</strong> épisodes
              </span>
            </>
          )}
        </div>
      </header>

      {/* ---------------- filtres + bascule de vue ---------------- */}
      <div className="coll-toolbar">
        <div className="coll-chips">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              className={`coll-chip clickable ${kind === f.value ? "active" : ""}`}
              onClick={() => setParam("kind", f.value)}
            >
              {f.label}
            </button>
          ))}
          {/* Plus de filtre par support : tout est en boîtier DVD. */}
        </div>

        <div className="coll-toolbar-right">
          <label className="coll-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setParam("q", e.target.value)}
              placeholder="Chercher un titre, une saga…"
              aria-label="Chercher dans la collection"
            />
            {query && (
              <button
                className="clickable"
                onClick={() => setParam("q", "")}
                aria-label="Effacer"
              >
                <X size={14} />
              </button>
            )}
          </label>

          {!compact && (
            <div className="coll-views" role="group" aria-label="Affichage">
              <button
                className={`clickable ${view === "shelf" ? "active" : ""}`}
                onClick={() => pickView("shelf")}
                title="Étagère 3D"
              >
                <Rows3 size={15} /> Étagère
              </button>
              <button
                className={`clickable ${view === "grid" ? "active" : ""}`}
                onClick={() => pickView("grid")}
                title="Grille de boîtiers"
              >
                <LayoutGrid size={15} /> Grille
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- le rayon ----------------
          L'attente a la forme de ce qu'on attend : la rangée de tranches si
          l'on va vers l'étagère, la grille de boîtiers sinon. */}
      {status === "loading" &&
        (effectiveView === "shelf" ? <ShelfSkeleton /> : <GridSkeleton />)}

      {status === "error" && (
        <div className="coll-state">
          <span className="coll-state-icon">
            <Unplug size={22} />
          </span>
          <strong>La collection n'a pas voulu se charger.</strong>
          <p>Le rayon est bien là — c'est la liaison qui a lâché.</p>
          <button
            className="btn btn-ghost clickable"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCw size={15} /> Réessayer
          </button>
        </div>
      )}

      {status === "ready" && shown.length === 0 && (
        <div className="coll-state">
          <span className="coll-state-icon">
            <Sparkles size={22} />
          </span>
          <strong>
            {media.length === 0 ? "L'étagère est encore vide" : "Rien sous ce filtre"}
          </strong>
          <p>
            {media.length === 0
              ? "Les premiers titres arrivent bientôt."
              : "Aucun titre ne correspond à cette recherche."}
          </p>
          {media.length > 0 && (kind || query) && (
            <button
              className="btn btn-ghost clickable"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              <X size={15} /> Tout afficher
            </button>
          )}
        </div>
      )}

      {status === "ready" && shown.length > 0 && effectiveView === "shelf" && (
        <Suspense fallback={<ShelfSkeleton label="On monte l'étagère…" />}>
          <CollectionShelf
            media={shown}
            theme={theme}
            onSelect={(m) => navigate(`/collection/${m.slug}`)}
          />
        </Suspense>
      )}

      {status === "ready" && shown.length > 0 && effectiveView === "grid" && (
        <div className="coll-grid">
          {shown.map((m) => (
            <CollectionCase key={m.slug} media={m} />
          ))}
        </div>
      )}

      {/* ---------------- reprendre ----------------
          Placée APRÈS la collection : on vient d'abord sur cette page pour voir
          l'étagère. La reprise est un raccourci, pas l'entrée principale. */}
      {resuming.length > 0 && (
        <section className="coll-resume">
          <h2 className="coll-section-title">
            <Play size={15} /> Reprendre
          </h2>
          <div className="coll-resume-row">
            {resuming.map((m) => {
              const pct =
                m.progress.durationSeconds > 0
                  ? Math.min(
                      100,
                      (m.progress.positionSeconds / m.progress.durationSeconds) * 100
                    )
                  : 0;
              return (
                <Link
                  key={m.slug}
                  to={`/collection/${m.slug}?ep=${m.progress.episodeIndex}&play=1`}
                  className="coll-resume-card clickable"
                  style={{ "--tint": m.color }}
                >
                  {m.backdrop && <img src={m.backdrop} alt="" loading="lazy" />}
                  <span className="coll-resume-grad" />
                  <span className="coll-resume-play">
                    <Play size={16} fill="currentColor" />
                  </span>
                  <span className="coll-resume-info">
                    <strong>{m.title}</strong>
                    <em>{resumeLabel(m) || "Reprendre"}</em>
                  </span>
                  <span className="coll-resume-bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {status === "ready" && media.length > 0 && (
        <p className="coll-note">
          <Info size={13} />
          Chaque titre est lu depuis sa source d'origine (chaîne officielle,
          diffusion promotionnelle, œuvre du domaine public) — rien n'est
          rehébergé ici. {KINDS.series.plural} et {KINDS.film.plural.toLowerCase()}{" "}
          s'ouvrent dans le poste cathodique.
        </p>
      )}
    </div>
  );
}
