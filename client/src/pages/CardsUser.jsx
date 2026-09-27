import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import CardCollection from "../components/cards/CardCollection";

// ======================================================================
//  Le classeur d'un autre joueur, en lecture seule
// ======================================================================
// Mêmes chiffres et même classeur que le mien, sans boutique ni chances de
// tirage. Un compte privé ne s'ouvre qu'à ses abonnés (le serveur tranche).

export default function CardsUser() {
  const { username } = useParams();
  const { token, user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setData(null);
    setErr(null);
    apiFetch(`/cards/u/${encodeURIComponent(username)}`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [token, username]);

  const isMe = user?.username === username;

  return (
    <div className="cd-page">
      <header className="cd-head">
        <div className="cd-owner">
          <Link to="/cartes" className="cd-back clickable" aria-label="Mes cartes">
            <ChevronLeft size={20} />
          </Link>
          <Link to={`/u/${username}`} className="cd-owner-who clickable">
            {data?.user?.avatar ? (
              <img src={data.user.avatar} alt="" draggable="false" />
            ) : (
              <span className="cd-friend-ph">{username.slice(0, 1).toUpperCase()}</span>
            )}
            <h1 className="cd-title">{isMe ? "Mes cartes" : username}</h1>
          </Link>
        </div>
      </header>

      {err ? (
        <div className="cd-locked">
          {err.data?.locked ? <Lock size={22} /> : null}
          <p>{err.message}</p>
        </div>
      ) : (
        <CardCollection
          cards={data?.cards || []}
          rarities={data?.rarities || []}
          setSize={data?.setSize || 0}
          loading={!data}
        />
      )}
    </div>
  );
}
