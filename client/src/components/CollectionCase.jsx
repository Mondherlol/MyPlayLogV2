import { Link } from "react-router-dom";
import { Play, Film, Tv, BookOpen, Gamepad2 } from "lucide-react";
import {
  CONSOLE,
  FORMATS,
  LICENCES,
  fmtYears,
  resumeLabel,
  isComic,
  isGame,
} from "../lib/collection";

// ======================================================================
//  Boîtier de collection, en 2D — la vue « grille »
// ======================================================================
// Le même objet que sur l'étagère 3D, mais en CSS : c'est cette vue qui sert
// sur téléphone (et partout où la 3D n'est pas souhaitable), donc elle doit
// tenir debout toute seule. La jaquette est l'affiche ; autour d'elle, la
// carrosserie du boîtier — tranche, plaque de titre, et le disque qui dépasse
// au survol.

export default function CollectionCase({ media }) {
  const comic = isComic(media);
  const game = isGame(media);
  const format = FORMATS[media.format] || FORMATS.dvd;
  const licence = LICENCES[media.licence] || LICENCES.official;
  const resume = resumeLabel(media);
  const p = media.progress;
  const pct =
    p?.durationSeconds > 0
      ? Math.min(100, (p.positionSeconds / p.durationSeconds) * 100)
      : 0;
  const done = media.kind === "series" && media.episodeCount
    ? Math.round(((p?.watched?.length || 0) / media.episodeCount) * 100)
    : 0;

  return (
    <Link
      to={`/collection/${media.slug}`}
      className={`coll-case fmt-${media.format} clickable`}
      style={{ "--tint": media.color || "var(--orange)" }}
      title={media.title}
    >
      <div className="coll-case-body">
        {/* Tranche : le petit bord sombre qui donne l'épaisseur. */}
        <span className="coll-case-spine" aria-hidden="true">
          <span className="coll-case-spine-label">{media.title}</span>
        </span>


        <div className="coll-case-art">
          {media.poster ? (
            <img src={media.poster} alt="" loading="lazy" />
          ) : (
            <span className="coll-case-noart">{media.title}</span>
          )}
          <span className="coll-case-shine" aria-hidden="true" />

          <span className="coll-case-fmt">{format.label}</span>
          <span className={`coll-case-lic lic-${media.licence}`} title={licence.hint}>
            {licence.label}
          </span>

          <span className="coll-case-play" aria-hidden="true">
            {game ? <Gamepad2 size={20} /> : <Play size={20} fill="currentColor" />}
          </span>

          <div className="coll-case-plate">
            {media.franchise && (
              <span className="coll-case-franchise">{media.franchise}</span>
            )}
            <strong className="coll-case-title">{media.title}</strong>
            <span className="coll-case-meta">
              {/* Le papier se compte en planches, jamais en minutes : un manga
                  annoncé « Film » ici, c'est la même confusion que le boîtier
                  DVD sur l'étagère. */}
              {comic ? (
                <BookOpen size={11} />
              ) : game ? (
                <Gamepad2 size={11} />
              ) : media.kind === "series" ? (
                <Tv size={11} />
              ) : (
                <Film size={11} />
              )}
              {comic
                ? `${media.pageCount || 0} planches`
                : game
                  ? CONSOLE
                  : media.kind === "series"
                    ? `${media.episodeCount} ép.`
                    : media.runtime
                      ? `${media.runtime} min`
                      : "Film"}
              {fmtYears(media) && <em>· {fmtYears(media)}</em>}
            </span>
          </div>

        </div>
      </div>

      {(resume || done > 0) && (
        <div className="coll-case-progress">
          {/* Un jeu n'a pas d'avancement mesurable de notre côté : la jauge
              serait toujours à zéro, ce qui dirait le contraire du temps de jeu
              affiché juste à côté. */}
          {!game && (
            <span className="coll-case-progress-bar">
              <span style={{ width: `${done || pct}%` }} />
            </span>
          )}
          <span className="coll-case-progress-label">
            {done > 0 && media.kind === "series"
              ? `${p.watched.length}/${media.episodeCount} vus`
              : resume}
          </span>
        </div>
      )}
    </Link>
  );
}
