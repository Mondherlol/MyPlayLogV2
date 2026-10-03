import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Bomb, Dices, Swords } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useChat } from "../../../context/ChatContext";
import { apiFetch } from "../../../lib/api";
import { playMessageSound } from "../../../lib/sfx";
import { FriendFace } from "./DuelFriends";

// ======================================================================
//  « X te défie en duel » — où qu'on soit sur le site
// ======================================================================
// Monté une fois au-dessus des routes (App.jsx). Un défi arrive par le direct
// (évènement « cardduel », kind « invite ») : une carte en haut à droite, qu'on
// ne peut pas rater, et qui se répond en un clic. Accepter mène au salon et y
// entre ; refuser prévient celui qui défie. Sans réponse, elle s'efface au bout
// d'une minute (le défi reste dans le salon, et l'autre peut relancer).
// Même fenêtre pour une invitation à une table de 2 contre 2 (« cardteam »).

const TTL = 60000;

export default function DuelInvites() {
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  const [list, setList] = useState([]); // [{ id, code, team, seat, by, at }]
  const timers = useRef(new Map());

  const drop = (id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setList((l) => l.filter((x) => x.id !== id));
  };

  useEffect(() => {
    if (!subscribe || !user) return undefined;
    return subscribe((event, data) => {
      if ((event !== "cardduel" && event !== "cardteam" && event !== "bombe" && event !== "party") || !data?.code)
        return;
      // La Bombe et La Party passent par la même fenêtre : une table qui t'attend.
      if (event === "bombe" || event === "party") {
        const base = event;
        if (data.kind !== "invite" || window.location.pathname === `/${base}/${data.code}`) return;
        const id = `${base}:${data.code}`;
        setList((l) =>
          [
            { id, code: data.code, bomb: base === "bombe", party: base === "party", by: data.by, at: Date.now() },
            ...l.filter((x) => x.id !== id),
          ].slice(0, 3)
        );
        playMessageSound();
        clearTimeout(timers.current.get(id));
        timers.current.set(
          id,
          setTimeout(() => drop(id), TTL)
        );
        return;
      }
      const team = event === "cardteam";
      const id = `${team ? "t" : "d"}:${data.code}`;
      // Le défi ne tient plus (salon fermé, quelqu'un d'autre défié).
      if (data.kind === "withdrawn" || (team && data.kind === "closed")) return drop(id);
      if (data.kind !== "invite") return;
      // Déjà dans ce salon : rien à annoncer.
      if (window.location.pathname === `/cartes/${team ? "equipe" : "duel"}/${data.code}`) return;
      const item = { id, code: data.code, team, seat: data.seat ?? null, by: data.by, at: Date.now() };
      setList((l) => [item, ...l.filter((x) => x.id !== id)].slice(0, 3));
      playMessageSound();
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => drop(id), TTL)
      );
    });
  }, [subscribe, user]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  if (!list.length) return null;
  return createPortal(
    <div className="dinv-stack">
      {list.map((x) => (
        <div key={x.id} className="dinv" role="alertdialog" aria-label={`${x.by?.username} ${x.team ? "t'invite en 2 contre 2" : "te défie en duel"}`}>
          <span className="dinv-art">
            <FriendFace u={x.by} size={46} />
            <i className="dinv-badge">{x.bomb ? <Bomb /> : x.party ? <Dices /> : <Swords />}</i>
          </span>
          <span className="dinv-txt">
            <b>{x.by?.username}</b>
            <span>{x.bomb ? "t'invite à La Bombe" : x.party ? "t'invite à La Party" : x.team ? "t'invite en 2 contre 2" : "te défie en duel"}</span>
          </span>
          <span className="dinv-actions">
            <button
              className="dinv-btn ghost clickable"
              onClick={() => {
                drop(x.id);
                if (!x.team && !x.bomb && !x.party) apiFetch(`/cards/duel/${x.code}/decline`, { method: "POST", token }).catch(() => {});
              }}
            >
              Refuser
            </button>
            <button
              className="dinv-btn gold clickable"
              onClick={() => {
                drop(x.id);
                navigate(
                  x.bomb
                    ? `/bombe/${x.code}`
                    : x.party
                    ? `/party/${x.code}`
                    : x.team
                    ? `/cartes/equipe/${x.code}${x.seat != null ? `?place=${x.seat}` : "?rejoindre"}`
                    : `/cartes/duel/${x.code}?rejoindre`
                );
              }}
            >
              Accepter
            </button>
          </span>
          <i className="dinv-timer" style={{ animationDuration: `${TTL}ms` }} />
        </div>
      ))}
    </div>,
    document.body
  );
}
