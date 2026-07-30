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
  BookOpen,
  Gamepad2,
  Power,
  Clock3,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import useMediaQuery from "../hooks/useMediaQuery";
import CollectionCase from "../components/CollectionCase";
import { ShelfSkeleton, GridSkeleton } from "../components/CollectionSkeleton";
import { KINDS, isComic, resumeLabel, fmtDuration } from "../lib/collection";

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
  { value: "comic", label: "Comics & mangas" },
  { value: "game", label: "Jeux GBA" },
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

  // LES REPRISES, EN TROIS RAYONS SÉPARÉS. Une seule rangée mélangée mentait
  // sur ce qu'elle proposait : « Reprendre » à côté d'un manga veut dire ouvrir
  // un volume, à côté d'une cartouche rallumer une console, et les trois gestes
  // n'ont ni la même unité de progression (minutes / planches / heures de jeu)
  // ni la même promesse. Chaque support a donc sa section, sa formulation et
  // son objet — et elles suivent le filtre du rayon, pour qu'un rayon « Séries »
  // ne propose pas de reprendre une partie.
  const resuming = useMemo(() => {
    const started = shown
      .filter((m) => m.progress && !m.progress.completed)
      .sort(
        (a, b) =>
          new Date(b.progress.lastWatchedAt) - new Date(a.progress.lastWatchedAt)
      );
    return {
      // `episodeCount` est ici une CONDITION, pas une décoration. Le rayon vidéo
      // ne s'héberge pas lui-même : quand tous les hébergeurs d'un titre ont
      // fermé, le vérificateur de liens retire les sources mortes (panneau
      // d'admin) et il ne reste parfois plus rien à lire. Proposer « Reprendre »
      // sur un boîtier vide, c'est promettre une séance qui s'ouvre sur du noir.
      watch: started
        .filter((m) => (m.kind === "series" || m.kind === "film") && m.episodeCount > 0)
        .slice(0, 4),
      read: started.filter((m) => m.kind === "comic").slice(0, 4),
      play: started.filter((m) => m.kind === "game").slice(0, 4),
    };
  }, [shown]);

  const counts = useMemo(
    () => ({
      series: media.filter((m) => m.kind === "series").length,
      film: media.filter((m) => m.kind === "film").length,
      comic: media.filter((m) => m.kind === "comic").length,
      game: media.filter((m) => m.kind === "game").length,
      episodes: media.reduce((n, m) => n + (m.episodeCount || 0), 0),
      // Les planches sont comptées SUR LE PAPIER seulement. Un titre entré comme
      // manga puis rebasculé en film garde ses planches dans sa fiche : elles ne
      // s'affichent plus nulle part, mais elles gonflaient ce compteur-là — le
      // rayon annonçait des centaines de planches pour des films.
      pages: media.reduce((n, m) => n + (isComic(m) ? m.pageCount || 0 : 0), 0),
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
              Séries, films, animés, comics et boîtiers de jeu — rangés comme au
              vidéoclub, et jouables sur place.
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
              {counts.comic > 0 && (
                <span>
                  <strong>{counts.comic}</strong> comic{counts.comic > 1 ? "s" : ""}
                </span>
              )}
              {counts.game > 0 && (
                <span>
                  <strong>{counts.game}</strong> jeu{counts.game > 1 ? "x" : ""} DS
                </span>
              )}
              <span>
                <strong>{counts.episodes}</strong> épisodes
                {counts.pages > 0 && ` · ${counts.pages} planches`}
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
        <Suspense fallback={<ShelfSkeleton label="Chargement de l'étagère…" />}>
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
          Placées APRÈS la collection : on vient d'abord sur cette page pour
          voir l'étagère. La reprise est un raccourci, pas l'entrée principale.
          Et une section par support, de haut en bas : ce qui se regarde, ce qui
          se lit, ce qui se joue. */}

      {/* 1. L'ÉCRAN. Une vignette large, comme l'arrêt sur image d'une cassette
             qu'on remet en marche : c'est le seul des trois qui reprend à la
             SECONDE près, donc le seul qui porte une jauge de temps. */}
      {resuming.watch.length > 0 && (
        <section className="coll-resume">
          <h2 className="coll-section-title">
            <Play size={15} /> Reprendre <em>Séries &amp; films</em>
          </h2>
          <div className="coll-resume-row">
            {resuming.watch.map((m) => {
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

      {/* 2. LE PAPIER. Rien à voir avec une vignette d'écran : une fiche de
             papier crème, la couverture debout à gauche, un ruban de
             marque-page qui pend du haut. La progression se compte en PLANCHES,
             jamais en minutes. */}
      {resuming.read.length > 0 && (
        <section className="coll-resume coll-read">
          <h2 className="coll-section-title">
            <BookOpen size={15} /> Marque-pages <em>Comics &amp; mangas</em>
          </h2>
          <div className="coll-read-row">
            {resuming.read.map((m) => {
              const page = (m.progress.page || 0) + 1;
              const pct = m.pageCount
                ? Math.min(100, (page / m.pageCount) * 100)
                : 0;
              return (
                <Link
                  key={m.slug}
                  // `play=1` rouvre le volume à la planche enregistrée (voir la
                  // reprise automatique dans CollectionDetail).
                  to={`/collection/${m.slug}?play=1`}
                  className="coll-read-card clickable"
                  style={{ "--tint": m.color }}
                >
                  <span className="coll-read-cover">
                    {m.poster ? (
                      <img src={m.poster} alt="" loading="lazy" />
                    ) : (
                      <BookOpen size={18} />
                    )}
                  </span>
                  <span className="coll-read-body">
                    {m.franchise && (
                      <span className="coll-read-saga">{m.franchise}</span>
                    )}
                    <strong>{m.title}</strong>
                    <span className="coll-read-gauge" aria-hidden="true">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <em>
                      Planche {page}
                      {m.pageCount ? ` sur ${m.pageCount}` : ""}
                    </em>
                  </span>
                  {/* Le ruban : la seule chose qui dépasse d'un livre fermé. */}
                  <span className="coll-read-mark" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. LA CARTOUCHE. Ni vignette ni fiche : la carte de jeu elle-même,
             coin biseauté et contacts dorés. On la RALLUME, et ce qu'on affiche
             dessous est le temps déjà passé dessus — c'est lui qui SITUE la
             cartouche dans la rangée, là où une barre de progression ne voudrait
             rien dire. La partie, elle, est reprise par la console au démarrage
             (voir GbaPlayer). */}
      {resuming.play.length > 0 && (
        <section className="coll-resume coll-play">
          <h2 className="coll-section-title">
            <Gamepad2 size={15} /> Console encore chaude <em>Jeux GBA</em>
          </h2>
          <div className="coll-play-row">
            {resuming.play.map((m) => (
              <Link
                key={m.slug}
                to={`/collection/${m.slug}?play=1`}
                className="coll-play-card clickable"
                style={{ "--tint": m.color }}
              >
                <span className="coll-play-cart" aria-hidden="true">
                  <span className="coll-play-label">
                    {m.poster ? (
                      <img src={m.poster} alt="" loading="lazy" />
                    ) : (
                      <Gamepad2 size={16} />
                    )}
                  </span>
                  <span className="coll-play-teeth" />
                </span>
                <span className="coll-play-body">
                  <strong>{m.title}</strong>
                  <em>
                    <Clock3 size={11} />
                    {m.progress.playSeconds > 60
                      ? `${fmtDuration(m.progress.playSeconds)} de jeu`
                      : "Partie entamée"}
                  </em>
                  <span className="coll-play-cta">
                    <Power size={12} /> Rallumer
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {status === "ready" && media.length > 0 && (
        <p className="coll-note">
          <Info size={13} />
          Chaque titre est lu depuis sa source d'origine (chaîne officielle,
          diffusion promotionnelle, œuvre du domaine public) — rien n'est
          rehébergé ici. {KINDS.series.plural} et {KINDS.film.plural.toLowerCase()}{" "}
          s'ouvrent dans le poste cathodique ; les {KINDS.game.plural.toLowerCase()}{" "}
          se lancent dans une console émulée, directement dans le navigateur.
        </p>
      )}
    </div>
  );
}
