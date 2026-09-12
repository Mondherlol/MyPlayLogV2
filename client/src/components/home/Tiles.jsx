import { Link } from "react-router-dom";
import { Clock, ExternalLink, Gamepad2, Gift, Heart, Play, Tv } from "lucide-react";
import { STORE_COLORS, freeEndsLabel } from "../FreeGameBanner";

// ======================================================================
//  Les petites briques des rails
// ======================================================================
// Une jaquette et sa légende, une jaquette et des visages, une offre gratuite.
// Rien de plus : tout ce qui demande une grande carte a son propre fichier.

/**
 * Une jaquette de rail, avec sa légende.
 *
 * La LÉGENDE est le sujet : le titre, et une ligne d'appoint qui dit pourquoi
 * ce jeu est là (« il y a 4 mois », « 92 % », « PS5 »). Sans elle, un rail de
 * jaquettes n'est qu'un mur d'images — joli, muet.
 */
export function GameTile({ game, sub, subGold = false, badge = null }) {
  const id = game.gameId ?? game.id;
  return (
    <Link to={`/game/${id}`} className="mh-tile clickable" title={game.name}>
      <span className="mh-tile-art">
        {game.cover ? (
          <img src={game.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-tile-ph">
            <Gamepad2 size={20} />
          </span>
        )}
        {!!badge && <span className="mh-tile-badge">{badge}</span>}
        {!!game.favorite && (
          <span className="mh-tile-fav" title="Coup de cœur">
            <Heart size={12} fill="currentColor" strokeWidth={0} />
          </span>
        )}
      </span>
      <span className="mh-tile-name">{game.name}</span>
      {!!sub && <span className={`mh-tile-sub ${subGold ? "gold" : ""}`}>{sub}</span>}
    </Link>
  );
}

/**
 * Une offre gratuite.
 *
 * ⚠️ ELLE MÈNE À LA FICHE, PAS AU MAGASIN — quand le serveur a reconnu le titre
 * (`gameId`). La fiche porte sa banderole « gratuit en ce moment » : on reste
 * sur le site, et le magasin est à un clic. Titre non reconnu : on retombe sur
 * l'offre, puisqu'il n'y a pas de fiche où aller.
 */
export function FreeCard({ game }) {
  const ends = freeEndsLabel(game.endsAt);
  const color = STORE_COLORS[game.store.slug] || STORE_COLORS.pc;
  const inside = !!game.gameId;

  const body = (
    <>
      <span className="mh-free-art">
        {game.image ? (
          <img src={game.image} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-tile-ph">
            <Gamepad2 size={22} />
          </span>
        )}
        <span className="mh-free-store" style={{ background: color }}>
          {game.store.label}
        </span>
        {!!ends && (
          <span className={`mh-free-ends ${ends.urgent ? "urgent" : ""}`}>
            <Clock size={11} /> {ends.text}
          </span>
        )}
        <span className="mh-free-go">
          {inside ? (
            <>
              <Gamepad2 size={13} /> Voir la fiche
            </>
          ) : (
            <>
              <ExternalLink size={13} /> Récupérer
            </>
          )}
        </span>
      </span>
      <span className="mh-free-title">{game.title}</span>
      <span className="mh-free-meta">
        {!!game.worth && <s>{game.worth}</s>}
        <b>
          <Gift size={12} /> Gratuit
        </b>
      </span>
    </>
  );

  const title = `${game.title} — gratuit sur ${game.store.label}`;
  return inside ? (
    <Link className="mh-free clickable" to={`/game/${game.gameId}`} title={title}>
      {body}
    </Link>
  ) : (
    <a
      className="mh-free clickable"
      href={game.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
    >
      {body}
    </a>
  );
}

/**
 * La liste officielle d'un Direct ou d'un showcase passé.
 *
 * ⚠️ ON MONTRE LES JEUX, PAS UN TITRE. « Nintendo Direct — 9 juin 2026 » ne dit
 * rien de ce qui s'y est passé ; quatre jaquettes côte à côte, si. C'est
 * l'aperçu que rend déjà le serveur (`preview`, les premières images de la
 * liste) : on en fait une affiche plutôt qu'un montage en éventail, parce que
 * dans une rangée, des affiches alignées se lisent d'un regard.
 */
export function EventListCard({ list }) {
  const imgs = (list.preview || []).slice(0, 4);
  const date = list.event?.startTime
    ? new Date(list.event.startTime).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <Link to={`/lists/${list.id}`} className="mh-elist clickable" title={list.title}>
      <span className="mh-elist-art">
        {list.cover ? (
          <img className="mh-elist-cover" src={list.cover} alt="" loading="lazy" draggable="false" />
        ) : imgs.length ? (
          <span className="mh-elist-strip">
            {imgs.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" draggable="false" />
            ))}
          </span>
        ) : (
          <span className="mh-tile-ph">
            <Tv size={26} />
          </span>
        )}
        <span className="mh-elist-count">
          {list.itemCount} jeu{list.itemCount > 1 ? "x" : ""}
        </span>
        {!!list.event?.videoId && (
          <span className="mh-elist-replay">
            <Play size={10} fill="currentColor" strokeWidth={0} /> Rediff
          </span>
        )}
      </span>
      <span className="mh-elist-title">{list.title}</span>
      {!!date && <span className="mh-elist-date">{date}</span>}
    </Link>
  );
}
