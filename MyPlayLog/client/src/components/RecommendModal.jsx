import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Check, Send, User } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Choisir un utilisateur à qui recommander un jeu. La reco arrive désormais
// dans sa messagerie privée : on ne propose donc que les gens qui peuvent
// recevoir nos messages (nos abonnés), fournis par /chat/contacts.
export default function RecommendModal({ game, onClose }) {
  const { token } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(true);
  const [done, setDone] = useState({}); // userId -> true
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const reqRef = useRef(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    const id = ++reqRef.current;
    setSearching(true);
    const t = setTimeout(() => {
      apiFetch(`/chat/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, {
        token,
      })
        .then((d) => id === reqRef.current && setContacts(d.contacts || []))
        .catch(() => id === reqRef.current && setContacts([]))
        .finally(() => id === reqRef.current && setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  async function recommend(u) {
    const uid = u.id;
    if (busyId || done[uid]) return;
    setBusyId(uid);
    try {
      await apiFetch("/recommendations", {
        method: "POST",
        token,
        body: {
          toUserId: uid,
          gameId: game.id,
          name: game.name,
          cover: game.cover,
          message: message.trim() || undefined,
        },
      });
      setDone((d) => ({ ...d, [uid]: true }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const list = contacts;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">Recommander ce jeu</h2>
        <p className="additems-hint font-fun" style={{ marginTop: 0 }}>
          Envoie <strong>{game.name}</strong> en message privé à quelqu'un.
        </p>

        <textarea
          className="reco-msg-input"
          placeholder="Un petit mot (optionnel) — pourquoi tu le recommandes ?"
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 280))}
          rows={2}
        />

        <div className="additems-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Chercher parmi tes abonnés…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && <Loader2 size={16} className="spin" />}
        </div>

        {!q.trim() && list.length > 0 && (
          <p className="reco-pick-label">Peuvent recevoir ta reco</p>
        )}

        <div className="reco-pick-list">
          {list.map((u) => (
            <div className="reco-pick-row" key={u.id}>
              <span className="reco-pick-av">
                {u.avatar ? <img src={u.avatar} alt="" /> : <User size={18} />}
              </span>
              <span className="reco-pick-name">{u.username}</span>
              <button
                className={`reco-pick-btn clickable ${done[u.id] ? "done" : ""}`}
                onClick={() => recommend(u)}
                disabled={busyId === u.id || done[u.id]}
              >
                {busyId === u.id ? (
                  <Loader2 size={15} className="spin" />
                ) : done[u.id] ? (
                  <><Check size={15} /> Recommandé</>
                ) : (
                  <><Send size={15} /> Recommander</>
                )}
              </button>
            </div>
          ))}
          {!searching && list.length === 0 && (
            <p className="additems-hint font-fun">
              {q.trim()
                ? "Aucun abonné à ce nom."
                : "Aucun abonné pour l'instant : seuls tes abonnés peuvent recevoir une reco."}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
