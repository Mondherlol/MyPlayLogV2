import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { agoLabel } from "../../lib/homeEvents";

// ======================================================================
//  Un aperçu du fil, et rien de plus
// ======================================================================
// ⚠️ CE N'EST PAS LE FIL. Le fil complet a sa page — l'onglet Activité —, avec
// ses cartes, ses images, ses commentaires et son défilement infini. Le poser
// au milieu de l'accueil, c'était lui faire manger tout le bas de la page : une
// liste sans fin repousse indéfiniment ce qui vient après elle, donc plus rien
// ne venait après elle.
//
// Ce qu'il reste ici est la seule chose qu'un accueil a à en dire : « il s'est
// passé des choses, en voici cinq, la suite est là ». Une ligne par activité,
// lisible en diagonale, et un chemin vers la vraie page.

// Ce qu'on écrit selon le type d'événement. Le fil en compte une trentaine ;
// on nomme les plus fréquents et on retombe sur une phrase honnête pour le
// reste — un aperçu n'a pas à réimplémenter le fil.
const STATUS_VERB = {
  playing: "a commencé",
  finished: "a terminé",
  paused: "a mis en pause",
  dropped: "a abandonné",
  endless: "joue sans fin à",
  wishlist: "veut jouer à",
};

function describe(item) {
  switch (item.type) {
    case "game":
      return { verb: STATUS_VERB[item.status] || "a mis à jour", game: item.game };
    case "gamegroup":
      return {
        verb: `${STATUS_VERB[item.status] || "a mis à jour"} ${item.games?.length || 0} jeux`,
        game: item.games?.[0] || null,
      };
    case "follow":
      return { verb: "suit maintenant", tail: item.target?.username };
    case "list":
      return { verb: "a créé la liste", tail: item.list?.title };
    case "listadd":
      return { verb: "a enrichi la liste", tail: item.list?.title };
    case "repost":
      return { verb: "a republié un fan art" };
    case "video":
      return { verb: "a publié une vidéo", game: item.game };
    case "gamemediapost":
      return { verb: "a posté sur le mur", game: item.game };
    case "mot":
      return { verb: "a trouvé le mot du jour" };
    case "blindtest":
      return { verb: "a fait un blind test" };
    case "pixel":
      return { verb: "a joué à Pixel Rush" };
    case "quiz":
      return { verb: "a fait un quiz" };
    case "geo":
      return { verb: "a joué à GeoGamer" };
    case "perroquet":
      return { verb: "a joué au Perroquet" };
    case "caseopen":
    case "caseopengroup":
      return { verb: "a ouvert une caisse" };
    case "gems":
      return { verb: "a cherché des pépites" };
    default:
      return { verb: "a fait quelque chose", game: item.game || null };
  }
}

/**
 * Les cinq dernières activités des joueurs suivis.
 *
 * Masqué tant qu'il n'y a rien : un bloc « Activité » vide en bas d'un accueil
 * bien rempli ne dit qu'une chose, et c'est que la page est cassée.
 */
export default function ActivityPeek({ token }) {
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/feed/home?limit=6", { token })
      .then((d) => alive && setItems(d.items || []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!items?.length) return null;

  return (
    <section className="mh-acty">
      <div className="mh-acty-head">
        <span className="mh-kicker">
          <Sparkles size={12} /> Pendant ce temps
        </span>
        <h2 className="mh-head-title">Ce que font les autres</h2>
        <Link to="/activity" className="mh-head-more clickable">
          Tout le fil <ChevronRight size={15} />
        </Link>
      </div>

      <ul className="mh-acty-list">
        {items.slice(0, 5).map((item) => {
          const { verb, tail, game } = describe(item);
          return (
            <li key={item.id} className="mh-acty-row">
              <Link
                to={`/u/${item.user?.username}`}
                className="mh-acty-av clickable"
                title={item.user?.username}
              >
                {item.user?.avatar ? (
                  <img src={item.user.avatar} alt="" loading="lazy" />
                ) : (
                  (item.user?.username || "?").charAt(0).toUpperCase()
                )}
              </Link>

              <span className="mh-acty-txt">
                <Link to={`/u/${item.user?.username}`} className="mh-acty-who clickable">
                  {item.user?.username}
                </Link>{" "}
                {verb}{" "}
                {game ? (
                  <Link to={`/game/${game.id}`} className="mh-acty-what clickable">
                    {game.name}
                  </Link>
                ) : (
                  !!tail && <b className="mh-acty-what">{tail}</b>
                )}
              </span>

              <span className="mh-acty-ago">{agoLabel(item.date)}</span>

              {!!game?.cover && (
                <Link to={`/game/${game.id}`} className="mh-acty-cover clickable">
                  <img src={game.cover} alt="" loading="lazy" draggable="false" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
