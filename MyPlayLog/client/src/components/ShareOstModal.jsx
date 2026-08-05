import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Check, Send, User, Music } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Partager une piste d'OST en message privé. Comme la recommandation d'un jeu,
// ça arrive dans le DM : on ne propose donc que les gens qui peuvent recevoir
// nos messages (nos abonnés), via /chat/contacts.
export default function ShareOstModal({ track, onClose }) {
  const { token } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    const t = setTimeout(() => {
      apiFetch(`/chat/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, {
        token,
      })
        .then((d) => id === reqRef.current && setContacts(d.contacts || []))
        .catch(() => id === reqRef.current && setContacts([]))
        .finally(() => id === reqRef.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, token]);

  async function share(u) {
    if (busyId || done[u.id]) return;
    setBusyId(u.id);
    try {
      await apiFetch("/chat/share", {
        method: "POST",
        token,
        body: {
          toUserId: u.id,
          message: message.trim() || undefined,
          ost: {
            name: track.name,
            artist: track.artist || "",
            artwork: track.artwork || null,
            videoId: track.videoId || null,
            url: track.url || null,
            gameId: track.gameId || null,
            gameName: track.gameName || null,
          },
        },
      });
      setDone((d) => ({ ...d, [u.id]: true }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">Partager cette OST</h2>

        <div className="share-ost-preview">
          <span className="share-ost-art">
            {track.artwork ? <img src={track.artwork} alt="" /> : <Music size={18} />}
          </span>
          <span className="share-ost-meta">
            <strong>{track.name}</strong>
            {track.artist && <span>{track.artist}</span>}
          </span>
        </div>

        <textarea
          className="reco-msg-input"
          placeholder="Un petit mot (optionnel)…"
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
          {loading && <Loader2 size={16} className="spin" />}
        </div>

        {!q.trim() && contacts.length > 0 && (
          <p className="reco-pick-label">Peuvent recevoir ton partage</p>
        )}

        <div className="reco-pick-list">
          {contacts.map((u) => (
            <div className="reco-pick-row" key={u.id}>
              <span className="reco-pick-av">
                {u.avatar ? <img src={u.avatar} alt="" /> : <User size={18} />}
              </span>
              <span className="reco-pick-name">{u.username}</span>
              <button
                className={`reco-pick-btn clickable ${done[u.id] ? "done" : ""}`}
                onClick={() => share(u)}
                disabled={busyId === u.id || done[u.id]}
              >
                {busyId === u.id ? (
                  <Loader2 size={15} className="spin" />
                ) : done[u.id] ? (
                  <>
                    <Check size={15} /> Envoyé
                  </>
                ) : (
                  <>
                    <Send size={15} /> Envoyer
                  </>
                )}
              </button>
            </div>
          ))}
          {!loading && contacts.length === 0 && (
            <p className="additems-hint font-fun">
              {q.trim()
                ? "Aucun abonné à ce nom."
                : "Seuls tes abonnés peuvent recevoir un partage."}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
