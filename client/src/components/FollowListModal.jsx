import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X, Loader2, UserPlus, UserCheck } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Modal listant les abonnés ou les abonnements d'un utilisateur.
export default function FollowListModal({ userId, mode, title, onClose }) {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch(`/users/${userId}/${mode}`, { token })
      .then((d) => alive && setUsers(d.users || []))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId, mode, token]);

  async function toggleFollow(u) {
    setUsers((prev) =>
      prev.map((x) => (x.id === u.id ? { ...x, isFollowing: !x.isFollowing } : x))
    );
    try {
      await apiFetch(`/users/${u.id}/follow`, { method: "POST", token });
    } catch {
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, isFollowing: u.isFollowing } : x))
      );
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal follow-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">{title}</h2>

        {loading ? (
          <div className="additems-loading">
            <Loader2 size={18} className="spin" /> Chargement…
          </div>
        ) : users.length === 0 ? (
          <p className="additems-hint font-fun">Personne pour l'instant.</p>
        ) : (
          <div className="follow-list">
            {users.map((u) => (
              <div className="follow-row" key={u.id}>
                <Link
                  to={`/u/${u.username}`}
                  className="follow-user clickable"
                  onClick={onClose}
                >
                  <span className="follow-avatar">
                    {u.avatar ? (
                      <img src={u.avatar} alt={u.username} />
                    ) : (
                      (u.username || "?")[0].toUpperCase()
                    )}
                  </span>
                  <span className="follow-info">
                    <strong>@{u.username}</strong>
                    {u.bio && <span className="follow-bio">{u.bio}</span>}
                  </span>
                </Link>
                {!u.isMe && (
                  <button
                    className={`follow-btn small clickable ${u.isFollowing ? "following" : ""}`}
                    onClick={() => toggleFollow(u)}
                  >
                    {u.isFollowing ? (
                      <><UserCheck size={15} /> Suivi</>
                    ) : (
                      <><UserPlus size={15} /> Suivre</>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
