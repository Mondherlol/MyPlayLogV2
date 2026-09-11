import { Link } from "react-router-dom";
import { Clock, ExternalLink, Gamepad2, Gift, Heart } from "lucide-react";
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
 * Une jaquette, et dessous les visages de ceux qui y jouent.
 *
 * ⚠️ LES VISAGES SONT LE SUJET, pas une décoration. C'est la seule chose qui
 * distingue ce rail des cinq autres rails de jaquettes de l'accueil : ici on ne
 * montre pas un jeu, on montre QUI y est. D'où leur place — juste sous la
 * pochette, avant même le titre, comme sur les affiches de séries que se
 * partagent les gens.
 */
export function CircleTile({ game }) {
  const players = game.players || [];
  const extra = (game.count || players.length) - players.length;

  // La légende dit ce qui se passe VRAIMENT, au présent quand c'est le cas :
  // une partie en cours n'est pas un souvenir.
  const nowCount = players.filter((p) => p.status === "playing").length;
  const who =
    players.length === 1
      ? players[0].username
      : nowCount > 1
        ? `${nowCount} y jouent en ce moment`
        : `${game.count} y sont passés`;

  return (
    <div className="mh-circle">
      <Link to={`/game/${game.id}`} className="mh-tile-art clickable" title={game.name}>
        {game.cover ? (
          <img src={game.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-tile-ph">
            <Gamepad2 size={20} />
          </span>
        )}
      </Link>
      <span className="mh-faces">
        {players.slice(0, 4).map((u) => (
          <Link
            key={u.id}
            to={`/u/${u.username}`}
            className="mh-face clickable"
            title={u.username}
          >
            {u.avatar ? (
              <img src={u.avatar} alt="" loading="lazy" />
            ) : (
              (u.username || "?").charAt(0).toUpperCase()
            )}
          </Link>
        ))}
        {extra > 0 && <span className="mh-face-extra">+{extra}</span>}
      </span>
      <Link to={`/game/${game.id}`} className="mh-tile-name clickable">
        {game.name}
      </Link>
      <span className="mh-tile-sub">{who}</span>
    </div>
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
