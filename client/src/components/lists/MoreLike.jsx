import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";

import ListGameCard from "../ListGameCard";
import { apiCached } from "../../lib/query";

// ======================================================================
//  « T'en veux plus ? » — sous le top d'une saga
// ======================================================================
// Kingdom Hearts, Ace Attorney, Touhou : peu d'épisodes, et on reste sur sa
// faim une fois le top lu. En descendant, la page enchaîne sur les jeux dans
// l'esprit de la saga (cf. server GET /lists/:id/more) — calculés par le
// moteur de recommandation, ou repris d'un top « -like » écrit à la main
// quand il existe (lien « Voir le top » alors).

export default function MoreLike({ listId, token }) {
  const [more, setMore] = useState(null);

  useEffect(() => {
    let alive = true;
    apiCached(`/lists/${listId}/more`, { token, maxAge: 60 * 60 * 1000 })
      .then((d) => alive && setMore(d?.more || null))
      .catch(() => alive && setMore(null));
    return () => {
      alive = false;
    };
  }, [listId, token]);

  if (!more?.games?.length) return null;
  const n = more.games.length;

  return (
    <section className="ml">
      <header className="ml-head">
        <span className="ml-kicker">
          <Sparkles size={15} /> T'en veux plus ?
        </span>
        <h2 className="ml-title">
          Top <b>{n}</b> des jeux dans l'esprit de {more.subject}
        </h2>
        {more.listId && (
          <Link to={`/lists/${more.listId}`} className="ml-more clickable">
            Voir le top <ChevronRight size={15} />
          </Link>
        )}
      </header>
      <div className="ld-grid rich ranked">
        {more.games.map((g, i) => (
          <ListGameCard key={g.id} item={{ gameId: g.id, name: g.name, image: g.cover }} rank={i + 1} />
        ))}
      </div>
    </section>
  );
}
