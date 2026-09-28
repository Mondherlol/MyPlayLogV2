import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Swords } from "lucide-react";
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

const TTL = 60000;

export default function DuelInvites() {
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  const [list, setList] = useState([]); // [{ code, by, at }]
  const timers = useRef(new Map());

  const drop = (code) => {
    clearTimeout(timers.current.get(code));
    timers.current.delete(code);
    setList((l) => l.filter((x) => x.code !== code));
  };

  useEffect(() => {
    if (!subscribe || !user) return undefined;
    return subscribe((event, data) => {
      if (event !== "cardduel" || !data?.code) return;
      // Le défi ne tient plus (salon fermé, quelqu'un d'autre défié).
      if (data.kind === "withdrawn") return drop(data.code);
      if (data.kind !== "invite") return;
      // Déjà dans ce salon : rien à annoncer.
      if (window.location.pathname === `/cartes/duel/${data.code}`) return;
      setList((l) => [{ code: data.code, by: data.by, at: Date.now() }, ...l.filter((x) => x.code !== data.code)].slice(0, 3));
      playMessageSound();
      clearTimeout(timers.current.get(data.code));
      timers.current.set(
        data.code,
        setTimeout(() => drop(data.code), TTL)
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
        <div key={x.code} className="dinv" role="alertdialog" aria-label={`${x.by?.username} te défie en duel`}>
          <span className="dinv-art">
            <FriendFace u={x.by} size={46} />
            <i className="dinv-badge">
              <Swords />
            </i>
          </span>
          <span className="dinv-txt">
            <b>{x.by?.username}</b>
            <span>te défie en duel</span>
          </span>
          <span className="dinv-actions">
            <button
              className="dinv-btn ghost clickable"
              onClick={() => {
                drop(x.code);
                apiFetch(`/cards/duel/${x.code}/decline`, { method: "POST", token }).catch(() => {});
              }}
            >
              Refuser
            </button>
            <button
              className="dinv-btn gold clickable"
              onClick={() => {
                drop(x.code);
                navigate(`/cartes/duel/${x.code}?rejoindre`);
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
