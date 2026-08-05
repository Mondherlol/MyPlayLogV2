import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  X,
  Users,
  Bell,
  BellOff,
  LogOut,
  UserPlus,
  UserMinus,
  UserRound,
  Camera,
  Check,
  Loader2,
  Crown,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import NewChatModal from "./NewChatModal";

// Fiche d'une conversation : membres, photo & nom du groupe, mode silencieux,
// ajout / exclusion, départ.
export default function ChatInfoModal({ conversation, token, me, onClose, onChanged, onLeft }) {
  const [conv, setConv] = useState(conversation);
  const [name, setName] = useState(conversation.name || "");
  const [savingName, setSavingName] = useState(false);
  const [muted, setMuted] = useState(!!conversation.muted);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const isOwner = String(conv.ownerId) === String(me?.id || me?._id);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && !addOpen && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, addOpen]);

  function apply(next) {
    setConv(next);
    onChanged?.(next);
  }

  async function saveName() {
    if (name.trim() === (conv.name || "")) return;
    setSavingName(true);
    setError(null);
    try {
      const d = await apiFetch(`/chat/conversations/${conv.id}`, {
        method: "PATCH",
        token,
        body: { name: name.trim() },
      });
      apply(d.conversation);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("media", file);
      const up = await apiUpload("/chat/media", fd, token);
      const d = await apiFetch(`/chat/conversations/${conv.id}`, {
        method: "PATCH",
        token,
        body: { avatar: up.media.url },
      });
      apply(d.conversation);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function toggleMute() {
    try {
      const d = await apiFetch(`/chat/conversations/${conv.id}/mute`, {
        method: "POST",
        token,
      });
      setMuted(d.muted);
      apply({ ...conv, muted: d.muted });
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMember(userId) {
    setError(null);
    try {
      await apiFetch(`/chat/conversations/${conv.id}/members/${userId}`, {
        method: "DELETE",
        token,
      });
      if (String(userId) === String(me?.id)) {
        onLeft?.(conv.id);
        onClose();
        return;
      }
      const d = await apiFetch(`/chat/conversations/${conv.id}`, { token });
      apply(d.conversation);
    } catch (err) {
      setError(err.message);
    }
  }

  async function addMembers(userIds) {
    const d = await apiFetch(`/chat/conversations/${conv.id}/members`, {
      method: "POST",
      token,
      body: { userIds },
    });
    apply(d.conversation);
  }

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal chat-info-modal">
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
          <h2 className="modal-title">
            <Users size={18} /> {conv.isGroup ? "Le groupe" : "La discussion"}
          </h2>

          <div className="chat-info-head">
            <span className={`chat-info-av ${conv.isGroup ? "is-group" : ""}`}>
              {conv.avatar ? (
                <img src={conv.avatar} alt="" />
              ) : conv.isGroup ? (
                <Users size={26} />
              ) : (
                (conv.title || "?")[0].toUpperCase()
              )}
              {conv.isGroup && (
                <button
                  type="button"
                  className="chat-info-cam clickable"
                  onClick={() => fileRef.current?.click()}
                  title="Changer la photo du groupe"
                >
                  {uploading ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
                </button>
              )}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                uploadAvatar(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            {conv.isGroup ? (
              <div className="chat-info-name">
                <input
                  value={name}
                  maxLength={60}
                  placeholder="Nom du groupe"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveName()}
                />
                <button
                  type="button"
                  className="chat-info-save clickable"
                  onClick={saveName}
                  disabled={savingName || name.trim() === (conv.name || "")}
                  title="Enregistrer"
                >
                  {savingName ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                </button>
              </div>
            ) : (
              <Link to={`/u/${conv.title}`} className="chat-info-title" onClick={onClose}>
                {conv.title}
              </Link>
            )}
          </div>

          <div className="chat-info-actions">
            {/* DM : accès direct au profil de l'autre. */}
            {!conv.isGroup && conv.others?.[0] && (
              <Link
                to={`/u/${conv.others[0].username}`}
                className="chat-info-btn clickable"
                onClick={onClose}
              >
                <UserRound size={16} /> Voir le profil
              </Link>
            )}
            <button type="button" className="chat-info-btn clickable" onClick={toggleMute}>
              {muted ? <BellOff size={16} /> : <Bell size={16} />}
              {muted ? "Réactiver le son" : "Mettre en sourdine"}
            </button>
            {conv.isGroup && (
              <>
                <button
                  type="button"
                  className="chat-info-btn clickable"
                  onClick={() => setAddOpen(true)}
                >
                  <UserPlus size={16} /> Ajouter
                </button>
                <button
                  type="button"
                  className="chat-info-btn danger clickable"
                  onClick={() => removeMember(me?.id)}
                >
                  <LogOut size={16} /> Quitter
                </button>
              </>
            )}
          </div>

          {error && <p className="chat-error">{error}</p>}

          <div className="chat-info-members">
            <h3>
              {conv.participants?.length || 0} membre
              {(conv.participants?.length || 0) > 1 ? "s" : ""}
            </h3>
            {(conv.participants || []).map((p) => (
              <div className="chat-member" key={p.id}>
                <span className={`chat-member-av ${p.online ? "online" : ""}`}>
                  {p.avatar ? <img src={p.avatar} alt="" /> : p.username[0].toUpperCase()}
                </span>
                <Link to={`/u/${p.username}`} onClick={onClose} className="chat-member-name">
                  {p.username}
                </Link>
                {String(p.id) === String(conv.ownerId) && conv.isGroup && (
                  <Crown size={14} className="chat-member-crown" title="Créateur" />
                )}
                {isOwner && conv.isGroup && String(p.id) !== String(me?.id) && (
                  <button
                    type="button"
                    className="chat-member-kick clickable"
                    onClick={() => removeMember(p.id)}
                    title="Retirer du groupe"
                  >
                    <UserMinus size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {addOpen && (
        <NewChatModal
          token={token}
          mode="add"
          excludeIds={(conv.participants || []).map((p) => p.id)}
          onClose={() => setAddOpen(false)}
          onCreate={(ids) => addMembers(ids)}
        />
      )}
    </>,
    document.body
  );
}
