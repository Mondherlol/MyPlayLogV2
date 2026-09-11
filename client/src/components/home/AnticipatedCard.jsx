import { Link } from "react-router-dom";
import { Bookmark, Gamepad2 } from "lucide-react";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Le décompte, découpé en trois.
 *
 * ⚠️ PAS DE SECONDES. Elles obligeraient la carte à se redessiner soixante fois
 * par minute pour un chiffre que personne ne surveille sur une sortie à
 * soixante-douze jours — et il y a douze cartes dans le rail. Les minutes
 * suffisent : c'est déjà plus précis que ce que l'on retient.
 */
function parts(ts, now) {
  const s = Math.max(0, Math.floor((ts - now) / 1000));
  return [
    { key: "jours", value: String(Math.floor(s / 86400)) },
    { key: "heures", value: pad(Math.floor((s % 86400) / 3600)) },
    { key: "min", value: pad(Math.floor((s % 3600) / 60)) },
  ];
}

/**
 * Un jeu très attendu, avec son compte à rebours.
 *
 * ⚠️ ICI LE TEXTE A LE DROIT D'ÊTRE SUR L'IMAGE — contrairement aux cartes
 * d'événement, où on l'a justement enlevé. La différence n'est pas une
 * inconséquence : une affiche de Direct EST du texte (son logo, sa date), et
 * superposer deux textes n'en laisse lire aucun. Le décor d'un jeu, lui, ne
 * porte rien à lire — c'est un fond, et un titre posé dessus derrière un
 * dégradé est exactement ce pour quoi il est fait.
 *
 * Le signet en haut à droite ajoute à la liste d'envies sans quitter l'accueil,
 * et les visages du bas disent qui, parmi les gens qu'on suit, guette la même
 * date. C'est ce qui transforme une sortie en rendez-vous.
 */
export default function AnticipatedCard({
  game,
  backdrop,
  now,
  wished,
  friends = [],
  onToggleWish,
}) {
  const art = backdrop || game.cover;
  const ts = game.releaseDate ? game.releaseDate * 1000 : null;
  const blocks = ts ? parts(ts, now || Date.now()) : null;
  const date = ts
    ? new Date(ts).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <article className="mh-antic">
      <Link to={`/game/${game.id}`} className="mh-antic-bg clickable" title={game.name}>
        {art ? (
          <img src={art} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-antic-noart">
            <Gamepad2 size={32} />
          </span>
        )}
        <span className="mh-antic-veil" />
        <span className="mh-antic-fade" />
      </Link>

      <button
        className={`mh-antic-wish clickable ${wished ? "on" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleWish?.(!wished);
        }}
        aria-pressed={!!wished}
        title={wished ? "Retirer de mes envies" : "Ajouter à mes envies"}
      >
        <Bookmark size={16} fill={wished ? "currentColor" : "none"} strokeWidth={2.3} />
      </button>

      <div className="mh-antic-body">
        <Link to={`/game/${game.id}`} className="mh-antic-name clickable">
          {game.name}
        </Link>
        {!!date && <span className="mh-antic-date">{date}</span>}

        {blocks ? (
          <div className="mh-antic-clock">
            {blocks.map((b) => (
              <span key={b.key} className="mh-antic-block">
                <b>{b.value}</b>
                <i>{b.key}</i>
              </span>
            ))}
          </div>
        ) : (
          // ⚠️ LA PLACE DE L'HORLOGE NE RESTE PAS VIDE. Un jeu sans date figure
          // dans ce rayon (c'est même souvent le plus attendu : il vient d'être
          // annoncé) — mais une carte muette au milieu de cartes qui décomptent
          // se lit comme une donnée qui n'a pas chargé.
          <span className="mh-antic-undated">Annoncé, pas encore daté</span>
        )}

        {friends.length > 0 && (
          <div className="mh-antic-friends">
            <span className="mh-faces">
              {friends.slice(0, 3).map((f) => (
                <span key={f.id} className="mh-face">
                  {f.avatar ? (
                    <img src={f.avatar} alt="" loading="lazy" />
                  ) : (
                    (f.username || "?").charAt(0).toUpperCase()
                  )}
                </span>
              ))}
            </span>
            <span className="mh-antic-friends-txt">
              {friends.length === 1
                ? "l'attend aussi"
                : `${friends.length} l'attendent aussi`}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
