import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, Loader2, Search, Swords, UserPlus, X } from "lucide-react";
import { apiFetch } from "../../../lib/api";
import { useScrollLock } from "../../../hooks/useScrollLock";

// ======================================================================
//  Défier un pote : la liste, un clic, c'est parti
// ======================================================================
// Mes potes (ceux qui me suivent — la règle de la messagerie), ceux qui sont
// en ligne en tête. Un clic sur « Défier » envoie le défi : en ligne, une
// fenêtre s'ouvre chez lui ; sinon, il le trouvera dans ses messages. Pas de
// case à cocher ni de bouton « Envoyer » à retrouver en bas.
//
// Grisés : ceux qui n'ont pas encore 15 cartes, et ceux déjà en plein duel.
// Pour tous les autres, il y a le lien du salon (en bas).

export function FriendFace({ u, size = 40, dot = false }) {
  return (
    <span className="df-face" style={{ width: size, height: size }}>
      {u?.avatar ? <img src={u.avatar} alt="" draggable="false" /> : <b>{(u?.username || "?")[0]}</b>}
      {dot && <i className="df-dot" />}
    </span>
  );
}

// `endpoint` : la liste à demander (La Bombe a la sienne, sans minimum de
// cartes — cf. server/src/routes/bomb.js, GET /friends).
export default function DuelFriends({
  token,
  title = "Défier un pote",
  action = "Défier",
  endpoint = "/cards/duel/friends",
  onPick,
  onLink,
  onClose,
}) {
  useScrollLock(true);
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch(endpoint, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && (setData({ friends: [] }), setErr(e.message)));
    return () => {
      alive = false;
    };
  }, [token, endpoint]);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (data?.friends || []).filter((f) => !n || f.username.toLowerCase().includes(n));
  }, [data, q]);

  async function pick(f) {
    if (busy) return;
    setBusy(f.id);
    setErr("");
    try {
      await onPick(f);
    } catch (e) {
      setErr(e.message);
      setBusy(null);
    }
  }
  async function link() {
    if (busy) return;
    setBusy("link");
    try {
      await onLink();
    } catch (e) {
      setErr(e.message);
      setBusy(null);
    }
  }

  const min = data?.minCards || 15;
  return createPortal(
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-sheet df">
        <header className="bd-sheet-head">
          <h3>{title}</h3>
          <button className="bd-x clickable" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>

        {(data?.friends?.length || 0) > 6 && (
          <label className="bd-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher" autoFocus />
          </label>
        )}

        <div className="df-list">
          {!data ? (
            <p className="bd-none">
              <Loader2 size={16} className="spin" />
            </p>
          ) : list.length === 0 ? (
            <p className="bd-none">{q ? "Personne à ce nom." : "Aucun pote à défier pour l'instant : envoie le lien."}</p>
          ) : (
            list.map((f) => {
              const off = !f.ready || f.busy;
              return (
                <div key={f.id} className={`df-row ${off ? "off" : ""}`}>
                  <FriendFace u={f} dot={f.online} />
                  <span className="df-who">
                    <b>{f.username}</b>
                    <small className={f.online && !off ? "on" : ""}>
                      {f.busy ? (endpoint === "/cards/duel/friends" ? "En duel" : "En partie") : !f.ready ? `Moins de ${min} cartes` : f.online ? "En ligne" : "Hors ligne"}
                    </small>
                  </span>
                  <button className="df-go clickable" disabled={off || !!busy} onClick={() => pick(f)}>
                    {busy === f.id ? <Loader2 className="spin" /> : action === "Défier" ? <Swords /> : <UserPlus />}
                    <span>{action}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {err && <p className="bd-err">{err}</p>}
        {onLink && (
          <footer className="df-foot">
            <button className="bd-btn ghost clickable" onClick={link} disabled={!!busy}>
              {busy === "link" ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />}
              Copier un lien d'invitation
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}
