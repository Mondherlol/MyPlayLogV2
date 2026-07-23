import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { X, Minus, Users, Maximize2, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { presenceText } from "../lib/presence";
import ChatThread from "./ChatThread";

// Fenêtres de discussion flottantes, façon Facebook : on répond depuis
// n'importe quelle page, sans quitter ce qu'on est en train de faire.
// Repliées, elles deviennent des pastilles rondes empilées à droite.
export default function ChatDock() {
  const { token, user } = useAuth();
  const { docks, closeDock, toggleDock, conversations, online } = useChat();
  const location = useLocation();

  // Sur /messages, tout est déjà à l'écran : les fenêtres feraient doublon.
  if (!token || !user || location.pathname.startsWith("/messages") || !docks.length)
    return null;

  const windows = docks.filter((d) => !d.minimized);
  const bubbles = docks.filter((d) => d.minimized);

  return createPortal(
    <div className="chat-dock">
      {windows.map((d) => (
        <DockWindow
          key={d.id}
          id={d.id}
          token={token}
          conversations={conversations}
          online={online}
          onMinimize={() => toggleDock(d.id)}
          onClose={() => closeDock(d.id)}
        />
      ))}
      {bubbles.length > 0 && (
        <div className="chat-dock-bubbles">
          {bubbles.map((d) => (
            <DockBubble
              key={d.id}
              id={d.id}
              conversations={conversations}
              online={online}
              onOpen={() => toggleDock(d.id)}
              onClose={() => closeDock(d.id)}
            />
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

// Retrouve la conversation dans la liste, et va la chercher si elle n'y est
// pas encore (lien direct, fil tout juste créé).
function useDockConversation(id, conversations, token) {
  const known = conversations.find((c) => String(c.id) === String(id)) || null;
  const [fetched, setFetched] = useState(null);

  useEffect(() => {
    if (known || !token) return;
    let alive = true;
    apiFetch(`/chat/conversations/${id}`, { token })
      .then((d) => alive && setFetched(d.conversation))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, known, token]);

  return known || fetched;
}

function Avatar({ conv, online, className = "" }) {
  const other = conv?.others?.[0];
  const isOnline = conv && !conv.isGroup && other && online.has(String(other.id));
  return (
    <span className={`${className} ${isOnline ? "online" : ""}`}>
      {conv?.avatar ? (
        <img src={conv.avatar} alt="" />
      ) : conv?.isGroup ? (
        <Users size={18} />
      ) : (
        (conv?.title || "?")[0].toUpperCase()
      )}
    </span>
  );
}

function DockWindow({ id, token, conversations, online, onMinimize, onClose }) {
  const { registerActive, markRead, typing } = useChat();
  const conv = useDockConversation(id, conversations, token);

  // Fenêtre ouverte = fil lu, et plus de son ni de pop-up pour lui.
  useEffect(() => registerActive(id), [registerActive, id]);
  useEffect(() => {
    if (conv?.unread) markRead(id);
  }, [conv?.unread, id, markRead]);

  const names = Object.keys(typing[String(id)] || {});
  const other = conv?.others?.[0];
  const sub = names.length
    ? "écrit…"
    : conv?.isGroup
    ? `${conv.participants?.length || 0} membres`
    : presenceText(other, online);

  return (
    <section className="chat-win">
      <header className="chat-win-head">
        {conv && !conv.isGroup && other ? (
          <Link to={`/u/${other.username}`} title={`Profil de ${other.username}`}>
            <Avatar conv={conv} online={online} className="chat-win-av" />
          </Link>
        ) : (
          <Avatar conv={conv} online={online} className="chat-win-av" />
        )}
        <span className="chat-win-info">
          <strong>{conv?.title || "…"}</strong>
          {sub && <span className="chat-win-sub">{sub}</span>}
        </span>
        <button
          type="button"
          className="chat-win-btn clickable"
          onClick={onMinimize}
          title="Réduire"
          aria-label="Réduire"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="chat-win-btn clickable"
          onClick={onClose}
          title="Fermer"
          aria-label="Fermer"
        >
          <X size={16} />
        </button>
      </header>

      {conv ? (
        <ChatThread conversation={conv} token={token} compact autoFocus />
      ) : (
        <div className="chat-win-loading">
          <Loader2 size={20} className="spin" />
        </div>
      )}
    </section>
  );
}

function DockBubble({ id, conversations, online, onOpen, onClose }) {
  const conv = conversations.find((c) => String(c.id) === String(id)) || null;
  return (
    <div className="chat-bubble-head">
      <button
        type="button"
        className="chat-bubble-btn clickable"
        onClick={onOpen}
        title={conv?.title || "Discussion"}
        aria-label={`Ouvrir la discussion avec ${conv?.title || ""}`}
      >
        <Avatar conv={conv} online={online} className="chat-bubble-av" />
        {conv?.unread > 0 && (
          <span className="chat-bubble-badge">
            {conv.unread > 9 ? "9+" : conv.unread}
          </span>
        )}
        <span className="chat-bubble-open">
          <Maximize2 size={13} />
        </span>
      </button>
      <button
        type="button"
        className="chat-bubble-x clickable"
        onClick={onClose}
        aria-label="Fermer"
      >
        <X size={11} />
      </button>
    </div>
  );
}
