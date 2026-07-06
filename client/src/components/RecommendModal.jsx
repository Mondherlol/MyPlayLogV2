import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Check, Send, User } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Choisir un utilisateur à qui recommander un jeu. Par défaut : mes
// abonnements ; on peut aussi chercher n'importe quel membre.
export default function RecommendModal({ game, onClose }) {
  const { user, token } = useAuth();
  const [following, setFollowing] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
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
    if (!user?.id) return;
    apiFetch(`/users/${user.id}/following`, { token })
      .then((d) => setFollowing((d.users || []).filter((u) => !u.isMe)))
      .catch(() => {});
  }, [user, token]);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const id = ++reqRef.current;
    setSearching(true);
    const t = setTimeout(() => {
      apiFetch(`/users/search/mentions?q=${encodeURIComponent(term)}`, { token })
        .then((d) => id === reqRef.current && setResults((d.users || []).filter((u) => String(u.id) !== String(user?.id))))
        .catch(() => id === reqRef.current && setResults([]))
        .finally(() => id === reqRef.current && setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, token, user]);

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

  const list = q.trim() ? results : following;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">Recommander ce jeu</h2>
        <p className="additems-hint font-fun" style={{ marginTop: 0 }}>
          À qui veux-tu recommander <strong>{game.name}</strong> ?
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
            placeholder="Chercher un membre…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {searching && <Loader2 size={16} className="spin" />}
        </div>

        {!q.trim() && (
          <p className="reco-pick-label">
            {following.length ? "Tes abonnements" : "Cherche un membre ci-dessus."}
          </p>
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
          {list.length === 0 && (
            <p className="additems-hint font-fun">
              {q.trim() ? "Aucun membre trouvé." : "Tu ne suis personne pour l'instant."}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
