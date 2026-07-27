import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Loader2,
  Check,
  Clock,
  Tv,
  Film,
  Gamepad2,
  ExternalLink,
  Users,
  MonitorPlay,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import CrtTv from "../components/CrtTv";
import {
  FORMATS,
  LICENCES,
  PROVIDERS,
  fmtDuration,
  fmtYears,
  hostOf,
} from "../lib/collection";

// ======================================================================
//  Fiche d'un média de la collection
// ======================================================================
// La fiche fait le service minimum et le fait bien : de quoi ça parle, qui
// joue dedans, quels épisodes, et le gros bouton qui allume le poste. Le
// visionnage lui-même vit dans CrtTv (plein écran, par-dessus la page).

export default function CollectionDetail() {
  const { slug } = useParams();
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();

  const [media, setMedia] = useState(null);
  const [status, setStatus] = useState("loading");
  const [watching, setWatching] = useState(null); // { index, at } | null
  const [season, setSeason] = useState(null);

  // Reprise demandée par l'URL (rangée « Reprendre » de la page Collection).
  const askedEpisode = Number(params.get("ep"));
  const autoPlay = params.get("play") === "1";
  const autoStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    apiFetch(`/collection/${slug}`, { token })
      .then((d) => {
        if (!alive) return;
        setMedia(d.media);
        setSeason(d.media.episodes?.[0]?.season ?? null);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [slug, token]);

  // Enregistrement de la progression : la télé nous prévient, on relaie à
  // l'API et on garde l'état local à jour (les coches de la liste d'épisodes).
  const saveProgress = useCallback(
    (payload) => {
      apiFetch(`/collection/${slug}/progress`, {
        method: "PUT",
        token,
        body: payload,
      })
        .then((d) => setMedia((m) => (m ? { ...m, progress: d.progress } : m)))
        .catch(() => {
          /* la reprise n'est pas critique : on ne dérange pas l'utilisateur */
        });
    },
    [slug, token]
  );

  function toggleWatched(index) {
    apiFetch(`/collection/${slug}/watched`, { method: "POST", token, body: { index } })
      .then((d) =>
        setMedia((m) =>
          m
            ? {
                ...m,
                progress: {
                  ...(m.progress || { episodeIndex: 0, positionSeconds: 0 }),
                  watched: d.watched,
                  completed: d.completed,
                },
              }
            : m
        )
      )
      .catch(() => {});
  }

  const watch = useCallback(
    (index, at = 0) => {
      setWatching({ index, at });
      // L'URL ne garde pas « play » : revenir en arrière ne doit pas rallumer
      // le poste tout seul.
      if (params.has("play")) {
        const next = new URLSearchParams(params);
        next.delete("play");
        setParams(next, { replace: true });
      }
    },
    [params, setParams]
  );

  // Lancement automatique quand on arrive depuis « Reprendre ».
  useEffect(() => {
    if (!media || autoStarted.current || !autoPlay) return;
    autoStarted.current = true;
    const index = Number.isFinite(askedEpisode) ? askedEpisode : 0;
    watch(index, media.progress?.positionSeconds || 0);
  }, [media, autoPlay, askedEpisode, watch]);

  const seasons = useMemo(() => {
    const set = [...new Set((media?.episodes || []).map((e) => e.season || 1))];
    return set.length > 1 ? set : [];
  }, [media]);

  const episodes = useMemo(() => {
    if (!media) return [];
    return season == null || !seasons.length
      ? media.episodes
      : media.episodes.filter((e) => (e.season || 1) === season);
  }, [media, season, seasons]);

  if (status === "loading")
    return (
      <div className="coll-state">
        <Loader2 size={26} className="coll-spin" />
        <p>Chargement de la fiche…</p>
      </div>
    );

  if (status === "error" || !media)
    return (
      <div className="coll-state">
        <p>Ce titre n'est pas (ou plus) sur l'étagère.</p>
        <Link to="/collection" className="btn btn-ghost clickable">
          Retour à la collection
        </Link>
      </div>
    );

  const licence = LICENCES[media.licence] || LICENCES.official;
  const format = FORMATS[media.format] || FORMATS.dvd;
  const isSeries = media.kind === "series" && media.episodes.length > 1;
  const watched = new Set(media.progress?.watched || []);
  const current = media.progress?.episodeIndex ?? 0;
  const resumePos = media.progress?.positionSeconds || 0;
  const hasResume = resumePos > 30 || watched.size > 0;

  return (
    <div className="coll-detail" style={{ "--tint": media.color || "var(--orange)" }}>
      {/* ---------------- bandeau ---------------- */}
      <header className="coll-hero">
        {media.backdrop && (
          <img className="coll-hero-bg" src={media.backdrop} alt="" />
        )}
        <span className="coll-hero-scrim" aria-hidden="true" />
        <span className="coll-hero-grain" aria-hidden="true" />

        <Link to="/collection" className="coll-hero-back clickable">
          <ArrowLeft size={16} /> Collection
        </Link>

        <div className="coll-hero-body">
          <div className="coll-hero-poster">
            {media.poster && <img src={media.poster} alt={media.title} />}
            <span className="coll-hero-fmt">{format.label}</span>
          </div>

          <div className="coll-hero-info">
            {media.franchise && (
              <span className="coll-hero-franchise">{media.franchise}</span>
            )}
            <h1>{media.title}</h1>
            {media.originalTitle && media.originalTitle !== media.title && (
              <p className="coll-hero-original">{media.originalTitle}</p>
            )}

            <div className="coll-hero-meta">
              <span className="coll-hero-kind">
                {isSeries ? <Tv size={13} /> : <Film size={13} />}
                {isSeries ? "Série" : "Film"}
              </span>
              {fmtYears(media) && <span>{fmtYears(media)}</span>}
              {isSeries && <span>{media.episodes.length} épisodes</span>}
              {media.runtime && (
                <span>
                  <Clock size={13} /> {fmtDuration(media.runtime * 60)}
                </span>
              )}
              {media.rating && <span className="coll-hero-rating">{media.rating}/10</span>}
              <span className={`coll-lic lic-${media.licence}`} title={licence.hint}>
                {licence.label}
              </span>
            </div>

            {media.genres?.length > 0 && (
              <div className="coll-hero-genres">
                {media.genres.slice(0, 5).map((g) => (
                  <span key={g}>{g}</span>
                ))}
              </div>
            )}

            {media.synopsis && <p className="coll-hero-syn">{media.synopsis}</p>}

            <div className="coll-hero-actions">
              <button
                className="btn btn-primary clickable"
                onClick={() => watch(hasResume ? current : 0, hasResume ? resumePos : 0)}
              >
                <Play size={17} fill="currentColor" />
                {hasResume ? "Reprendre" : isSeries ? "Lancer l'épisode 1" : "Regarder"}
              </button>
              {hasResume && (
                <button className="btn btn-ghost clickable" onClick={() => watch(0, 0)}>
                  Repartir du début
                </button>
              )}
              {media.source?.channel && (
                <a
                  className="coll-hero-channel clickable"
                  href={media.source.channelUrl || media.source.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Voir la source sur YouTube"
                >
                  <MonitorPlay size={15} /> {media.source.channel}
                </a>
              )}
              {/* Servi par un lecteur tiers : on le dit, et on donne le lien
                  vers le site d'origine quand il est connu. Rien n'est
                  rehébergé ici, la fiche doit l'assumer. */}
              {media.source?.provider && media.source.provider !== "youtube" && (
                <span className="coll-hero-channel" title={PROVIDERS[media.source.provider]?.hint}>
                  <MonitorPlay size={15} />
                  {media.source.url ? (
                    <a href={media.source.url} target="_blank" rel="noreferrer">
                      {hostOf(media.source.url)}
                    </a>
                  ) : (
                    PROVIDERS[media.source.provider]?.label
                  )}
                </span>
              )}
            </div>

            {media.games?.length > 0 && (
              <div className="coll-hero-games">
                <Gamepad2 size={14} />
                {media.games.map((g) => (
                  <Link key={g.igdbId} to={`/game/${g.igdbId}`} className="clickable">
                    {g.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="coll-detail-body">
        {/* ---------------- épisodes ---------------- */}
        <section className="coll-eps">
          <div className="coll-eps-head">
            <h2 className="coll-section-title">
              {isSeries ? "Épisodes" : "Le film"}
              {isSeries && (
                <em>
                  {watched.size}/{media.episodes.length} vus
                </em>
              )}
            </h2>
            {seasons.length > 1 && (
              <div className="coll-seasons">
                {seasons.map((s) => (
                  <button
                    key={s}
                    className={`clickable ${season === s ? "active" : ""}`}
                    onClick={() => setSeason(s)}
                  >
                    Saison {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ul className="coll-eps-list">
            {episodes.map((ep) => {
              const isWatched = watched.has(ep.index);
              return (
                <li
                  key={ep.index}
                  className={`coll-ep ${isWatched ? "seen" : ""} ${
                    ep.index === current && resumePos > 30 ? "current" : ""
                  }`}
                >
                  <button
                    className="coll-ep-main clickable"
                    onClick={() => watch(ep.index, ep.index === current ? resumePos : 0)}
                  >
                    {/* Un lecteur tiers ne sert pas de vignette : on retombe
                        sur le bandeau du titre, puis sur l'affiche. */}
                    <span className="coll-ep-thumb">
                      <img
                        src={ep.thumb || media.backdrop || media.poster}
                        alt=""
                        loading="lazy"
                      />
                      <i className="coll-ep-thumb-play">
                        <Play size={14} fill="currentColor" />
                      </i>
                      {ep.duration && (
                        <em className="coll-ep-dur">{fmtDuration(ep.duration)}</em>
                      )}
                      {ep.provider && ep.provider !== "youtube" && (
                        <em className="coll-ep-src" title={PROVIDERS[ep.provider]?.hint}>
                          {hostOf(ep.url)}
                          {ep.mirrors?.length > 0 ? ` +${ep.mirrors.length}` : ""}
                        </em>
                      )}
                    </span>
                    <span className="coll-ep-text">
                      <strong>
                        {isSeries && (
                          <span className="coll-ep-num">
                            {String(ep.number ?? ep.index + 1).padStart(2, "0")}
                          </span>
                        )}
                        {ep.title}
                      </strong>
                      {ep.synopsis && <span>{ep.synopsis}</span>}
                    </span>
                  </button>
                  <button
                    className={`coll-ep-check clickable ${isWatched ? "on" : ""}`}
                    onClick={() => toggleWatched(ep.index)}
                    title={isWatched ? "Marquer comme non vu" : "Marquer comme vu"}
                    aria-label={isWatched ? "Marquer comme non vu" : "Marquer comme vu"}
                  >
                    <Check size={14} strokeWidth={3} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------------- colonne latérale ---------------- */}
        <aside className="coll-aside">
          {media.cast?.length > 0 && (
            <section className="coll-cast card">
              <h3>
                <Users size={14} /> Casting
              </h3>
              <ul>
                {media.cast.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <span className="coll-cast-face">
                      {c.photo ? (
                        <img src={c.photo} alt="" loading="lazy" />
                      ) : (
                        <i>{c.name.slice(0, 1)}</i>
                      )}
                    </span>
                    <span className="coll-cast-text">
                      <strong>{c.character || c.name}</strong>
                      {c.character && <em>{c.name}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="coll-facts card">
            <h3>Fiche technique</h3>
            <dl>
              {media.studio && (
                <>
                  <dt>Réalisation</dt>
                  <dd>{media.studio}</dd>
                </>
              )}
              {media.network && (
                <>
                  <dt>Diffusion</dt>
                  <dd>{media.network}</dd>
                </>
              )}
              {media.country && (
                <>
                  <dt>Pays</dt>
                  <dd>{media.country}</dd>
                </>
              )}
              <dt>Support</dt>
              <dd>{format.hint}</dd>
              <dt>Accès</dt>
              <dd>{licence.hint}</dd>
            </dl>

            {media.sources?.length > 0 && (
              <p className="coll-sources">
                Métadonnées : {media.sources.join(", ")}
                {media.links?.wikipedia && (
                  <a href={media.links.wikipedia} target="_blank" rel="noreferrer">
                    Wikipédia <ExternalLink size={11} />
                  </a>
                )}
              </p>
            )}
          </section>
        </aside>
      </div>

      {watching && (
        <CrtTv
          media={media}
          startIndex={watching.index}
          startAt={watching.at}
          onClose={() => setWatching(null)}
          onProgress={saveProgress}
        />
      )}
    </div>
  );
}
