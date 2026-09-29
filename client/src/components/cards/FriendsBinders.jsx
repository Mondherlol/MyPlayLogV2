import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import TcgCard from "./TcgCard";

// ======================================================================
//  Les classeurs des amis : qui collectionne, combien, et sa plus belle carte
// ======================================================================
// Une rangée qui défile. Un clic ouvre le classeur de l'ami (en lecture). La
// rangée n'existe pas tant qu'aucun des gens que je suis n'a de carte.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

export default function FriendsBinders({ token }) {
  const [friends, setFriends] = useState([]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch("/cards/friends", { token })
      .then((d) => alive && setFriends(d.friends || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  if (!friends.length) return null;
  return (
    <section className="cd-friends">
      <h2 className="cd-h2">Amis</h2>
      <div className="cd-friends-row">
        {friends.map((f) => (
          <Link key={f.user.id} to={`/cartes/u/${f.user.username}`} className="cd-friend clickable">
            <span className="cd-friend-card">
              {f.best && <TcgCard card={f.best} tilt={false} lite />}
            </span>
            <span className="cd-friend-info">
              <span className="cd-friend-who">
                {f.user.avatar ? (
                  <img src={f.user.avatar} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="cd-friend-ph">{f.user.username.slice(0, 1).toUpperCase()}</span>
                )}
                <b>{f.user.username}</b>
              </span>
              <span className="cd-friend-count">
                <b>{fmt(f.owned)}</b> cartes
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
