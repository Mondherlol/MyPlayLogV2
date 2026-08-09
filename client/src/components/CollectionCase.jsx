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
// tenir debout toute seule.
//
// CE QUI A CHANGÉ, et pourquoi : le titre était imprimé SUR la jaquette, dans
// une plaque de papier posée en bas de l'affiche. Deux affiches sur trois
// finissaient donc à moitié cachées par une étiquette crème, et la grille
// n'était plus qu'un mur de pavés clairs. Le texte est désormais SOUS le
// boîtier, comme l'étiquette de casier d'un vidéoclub : l'affiche est rendue
// entière, et la ligne de titre est enfin lisible (elle n'est plus contrainte
// à la largeur de la jaquette moins ses marges).
//
// Reste de la carrosserie : la tranche à gauche, le film plastique, le disque
// qui glisse dehors au survol. C'est ce qui en fait un OBJET et pas une carte.

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
  const bar = done || pct;

  // Le support, en un mot : c'est la seule ligne de métadonnée de la carte,
  // elle doit donc dire ce que l'objet est et non ce que la base contient.
  const support = comic
    ? `${media.pageCount || 0} planches`
    : game
      ? CONSOLE
      : media.kind === "series"
        ? `${media.episodeCount} ép.`
        : media.runtime
          ? `${media.runtime} min`
          : "Film";

  const SupportIcon = comic
    ? BookOpen
    : game
      ? Gamepad2
      : media.kind === "series"
        ? Tv
        : Film;

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
          {/* Le voile du bas ne sert plus à porter un pavé de texte : juste à
              asseoir les pastilles et la jauge sur une affiche claire. */}
          <span className="coll-case-scrim" aria-hidden="true" />

          <span className="coll-case-tags">
            <span className="coll-case-fmt">{format.label}</span>
            {/* Un titre officiel est le cas ORDINAIRE : l'annoncer sur chaque
                jaquette ne fait que du bruit. Seule la provenance qui étonne
                mérite sa pastille. */}
            {media.licence && media.licence !== "official" && (
              <span
                className={`coll-case-lic lic-${media.licence}`}
                title={licence.hint}
              >
                {licence.label}
              </span>
            )}
          </span>

          <span className="coll-case-play" aria-hidden="true">
            {game ? <Gamepad2 size={20} /> : <Play size={20} fill="currentColor" />}
          </span>

          {/* Un jeu n'a pas d'avancement mesurable de notre côté : la jauge
              serait toujours à zéro, ce qui dirait le contraire du temps de
              jeu affiché juste à côté. */}
          {!game && bar > 0 && (
            <span className="coll-case-line" aria-hidden="true">
              <i style={{ width: `${bar}%` }} />
            </span>
          )}
        </div>
      </div>

      {/* L'étiquette de casier, sous l'objet. */}
      <div className="coll-case-cap">
        {media.franchise && (
          <span className="coll-case-franchise">{media.franchise}</span>
        )}
        <strong className="coll-case-title">{media.title}</strong>
        <span className="coll-case-meta">
          <SupportIcon size={11} />
          {support}
          {fmtYears(media) && <em>· {fmtYears(media)}</em>}
        </span>
        {(resume || done > 0) && (
          <span className="coll-case-resume">
            {done > 0 && media.kind === "series"
              ? `${p.watched.length}/${media.episodeCount} vus`
              : resume}
          </span>
        )}
      </div>
    </Link>
  );
}
