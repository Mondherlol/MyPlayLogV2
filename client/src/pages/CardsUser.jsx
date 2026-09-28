import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftRight, ChevronLeft, Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { cardCover } from "../lib/cards";
import { useToast } from "../context/ToastContext";
import CardCollection from "../components/cards/CardCollection";
import TradeComposer from "../components/cards/TradeComposer";

// ======================================================================
//  Le classeur d'un autre joueur, en lecture seule
// ======================================================================
// Mêmes chiffres et même classeur que le mien, sans boutique ni chances de
// tirage. Un compte privé ne s'ouvre qu'à ses abonnés (le serveur tranche).
// Les cartes que JE cherche (celles de mes classeurs que je n'ai pas) y sont
// marquées, et on peut lui proposer un échange.

export default function CardsUser() {
  const { username } = useParams();
  const { token, user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [lite, setLite] = useState(null);
  const [compose, setCompose] = useState(null); // null | { want }
  const toast = useToast();

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

  // Ce que j'ai et ce que je cherche : pour marquer ses cartes.
  useEffect(() => {
    if (!token || isMe) return;
    let alive = true;
    apiFetch("/cards/lite", { token })
      .then((d) => alive && setLite(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, isMe]);
  const wants = useMemo(() => (lite ? new Set(lite.wants) : null), [lite]);

  function onSent(t) {
    setCompose(null);
    toast.show({
      title: username,
      cover: cardCover(t.want?.[0]?.cover, "t_cover_small"),
      text: "Proposition d'échange envoyée",
      undo: async () => {
        await apiFetch(`/cards/trades/${t.id}/cancel`, { method: "POST", token });
      },
    });
  }

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
        {!isMe && data && (
          <button className="cd-trade-btn clickable" onClick={() => setCompose({ want: null })}>
            <ArrowLeftRight size={17} />
            <span className="long">Proposer un échange</span>
            <span className="short">Échanger</span>
          </button>
        )}
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
          wants={isMe ? null : wants}
          onRequest={isMe ? null : (card) => setCompose({ want: card })}
        />
      )}

      {compose && data && (
        <TradeComposer
          token={token}
          friend={data.user}
          theirCards={data.cards}
          wants={wants}
          initialWant={compose.want}
          onClose={() => setCompose(null)}
          onSent={onSent}
        />
      )}
    </div>
  );
}
