import { Link } from "react-router-dom";
import { Clock, Gamepad2, Heart, Loader2, Pause, Trophy, X } from "lucide-react";
import { hoursLabel, sinceLabel } from "../../lib/home";

/**
 * La grande carte d'un jeu en cours.
 *
 * C'EST LE PREMIER ÉCRAN DU SITE, et donc la seule carte qui a le droit d'être
 * grande. Elle porte le DÉCOR du jeu — pas sa jaquette étirée — et, posées
 * dessus, les deux seules choses qu'on vient y faire un soir de semaine :
 *
 *   • dire combien on a joué ;
 *   • dire qu'on l'a fini — ou qu'on le met de côté, ou qu'on laisse tomber.
 *
 * ⚠️ LES DEUX DERNIERS SONT DES ICÔNES NUES, ET C'EST VOULU. « Terminé » est ce
 * qu'on vient faire ; mettre en pause et abandonner sont ce qu'on finit par
 * faire, un jour, sans enthousiasme. Leur donner la même taille qu'au bouton
 * doré mettrait trois décisions sur le même plan et transformerait une carte
 * qui donne envie de jouer en formulaire de sortie.
 *
 * Tout le reste — la note, l'avis, la plateforme, les dates — reste sur la
 * fiche du jeu, à un clic de là.
 */
export default function NowPlayingCard({
  entry,
  backdrop,
  busy = false,
  onHours,
  onFinish,
  onPause,
  onDrop,
  onFavorite,
}) {
  // Le décor si on en a un, la jaquette en attendant : un cadre vide le temps
  // d'un aller-retour réseau se remarque plus qu'une jaquette floue.
  const art = backdrop || entry.cover;
  const hours = hoursLabel(entry.playtimeHours);
  const favorite = !!entry.favorite;

  // Un bouton d'action posé sur la carte ne doit pas suivre le lien qui la
  // recouvre : chacun coupe la propagation, une fois, ici.
  const act = (fn) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn?.();
  };

  return (
    <article className="mh-np">
      <Link to={`/game/${entry.gameId}`} className="mh-np-bg clickable" title={entry.name}>
        {art ? (
          <img src={art} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-np-noart">
            <Gamepad2 size={40} />
          </span>
        )}
        {/* Deux voiles, pas un. Le premier assombrit toute l'image d'un cran —
            sans lui, un décor clair (un ciel, une plage) rendrait illisibles
            les pastilles du haut. Le second, dégradé, creuse le bas pour y
            poser le titre. */}
        <span className="mh-np-veil" />
        <span className="mh-np-fade" />
      </Link>

      {/* ⚠️ LES SORTIES SONT EN HAUT, L'ACTION EST EN BAS. Mettre en pause et
          abandonner sont des décisions qu'on prend rarement et sans joie : les
          aligner avec « Terminé » les mettrait sur le même plan. */}
      <div className="mh-np-tools">
        <button
          className="mh-np-tool clickable"
          onClick={act(onPause)}
          disabled={busy}
          title="Mettre en pause"
          aria-label={`Mettre ${entry.name} en pause`}
        >
          <Pause size={14} fill="currentColor" strokeWidth={2.6} />
        </button>
        <button
          className="mh-np-tool clickable"
          onClick={act(onDrop)}
          disabled={busy}
          title="Abandonner"
          aria-label={`Abandonner ${entry.name}`}
        >
          <X size={15} strokeWidth={2.8} />
        </button>
        <button
          className={`mh-np-tool heart clickable ${favorite ? "on" : ""}`}
          onClick={act(() => onFavorite?.(!favorite))}
          disabled={busy}
          aria-pressed={favorite}
          title={favorite ? "Retirer des coups de cœur" : "Coup de cœur"}
        >
          <Heart size={17} fill={favorite ? "currentColor" : "none"} strokeWidth={2.3} />
        </button>
      </div>

      <div className="mh-np-body">
        <div className="mh-np-row">
          {!!entry.cover && (
            <img className="mh-np-cover" src={entry.cover} alt="" loading="lazy" draggable="false" />
          )}
          <div className="mh-np-text">
            <Link to={`/game/${entry.gameId}`} className="mh-np-name clickable">
              {entry.name}
            </Link>
            <span className="mh-np-meta">
              {!!entry.platform && (
                <>
                  <span className="mh-np-plat">{entry.platform}</span>
                  <span className="mh-np-dot">·</span>
                </>
              )}
              {hours ? `${hours} au compteur` : "Pas encore de temps noté"}
            </span>
            <span className="mh-np-since">
              Dernier point {sinceLabel(entry.updatedAt)}
            </span>
          </div>
        </div>

        <div className="mh-np-actions">
          <button className="mh-pill clickable" onClick={act(onHours)}>
            <Clock size={14} /> {hours || "Ajouter des heures"}
          </button>
          <button
            className="mh-pill gold clickable"
            onClick={act(onFinish)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <>
                <Trophy size={14} /> Terminé
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
