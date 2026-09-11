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
 * Un jeu du cercle, en LIGNE.
 *
 * ⚠️ LES VISAGES SONT LE SUJET, PAS LA JAQUETTE. C'est la seule chose qui
 * distinguait ce bloc des cinq autres rangées de jaquettes de l'accueil : on
 * n'y montre pas un jeu, on montre QUI y est. En rangée, on lisait le jeu ; en
 * liste — la forme qu'ont toutes les listes d'amis du web —, on lit la
 * personne, et la jaquette devient ce qu'elle doit être : la réponse à « à quoi
 * il joue ? ».
 */
export function CircleRow({ game }) {
  const players = game.players || [];
  const extra = (game.count || players.length) - players.length;

  // La légende dit ce qui se passe VRAIMENT, au présent quand c'est le cas :
  // une partie en cours n'est pas un souvenir.
  const nowCount = players.filter((p) => p.status === "playing").length;
  const who =
    players.length === 1
      ? players[0].username
      : nowCount > 1
        ? `${nowCount} y jouent`
        : `${game.count} y sont passés`;

  return (
    <Link to={`/game/${game.id}`} className="mh-circle-row clickable" title={game.name}>
      <span className="mh-circle-art">
        {game.cover ? (
          <img src={game.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-tile-ph">
            <Gamepad2 size={16} />
          </span>
        )}
      </span>
      <span className="mh-circle-body">
        <span className="mh-circle-who">{who}</span>
        <span className="mh-circle-game">{game.name}</span>
      </span>
      <span className="mh-faces">
        {players.slice(0, 3).map((u) => (
          <span key={u.id} className="mh-face" title={u.username}>
            {u.avatar ? (
              <img src={u.avatar} alt="" loading="lazy" />
            ) : (
              (u.username || "?").charAt(0).toUpperCase()
            )}
          </span>
        ))}
        {extra > 0 && <span className="mh-face-extra">+{extra}</span>}
      </span>
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
