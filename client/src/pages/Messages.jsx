import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  MessagesSquare,
  UserPlus,
  Search,
  ChevronLeft,
  Users,
  Info,
  BellOff,
  Image as ImageIcon,
  Gamepad2,
  Music,
  Loader2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { presenceText } from "../lib/presence";
import ChatThread from "../components/ChatThread";
import NewChatModal from "../components/NewChatModal";
import ChatInfoModal from "../components/ChatInfoModal";

export default function Messages() {
  const { token, user } = useAuth();
  const {
    conversations,
    setConversations,
    upsertConversation,
    online,
    typing,
    markRead,
    registerActive,
    isWindowFocused,
    refresh,
  } = useChat();

  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const activeId = params.get("c");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [loadingOne, setLoadingOne] = useState(false);

  const active = useMemo(
    () => conversations.find((c) => String(c.id) === String(activeId)) || null,
    [conversations, activeId]
  );

  const select = useCallback(
    (id) => {
      setParams(id ? { c: String(id) } : {}, { replace: false });
    },
    [setParams]
  );

  // Ouvre une discussion de la liste. Les fils « prêts » avec un abonné sont
  // virtuels (aucune ligne en base) : on matérialise la vraie conversation au
  // moment où on l'ouvre, puis on bascule dessus.
  const openConversation = useCallback(
    async (c) => {
      if (!c.virtual) return select(c.id);
      try {
        const d = await apiFetch("/chat/conversations", {
          method: "POST",
          token,
          body: { userIds: [c.peerId] },
        });
        // On remplace l'entrée virtuelle par la vraie (même personne).
        setConversations((prev) => [
          d.conversation,
          ...prev.filter((x) => String(x.id) !== String(c.id)),
        ]);
        select(d.conversation.id);
      } catch {
        /* silencieux : on réessaiera au prochain clic */
      }
    },
    [token, select, setConversations]
  );

  // La conversation ciblée par l'URL peut ne pas être dans la liste (lien
  // direct, fil tout juste ouvert depuis un profil) : on va la chercher.
  useEffect(() => {
    if (!activeId || active || loadingOne) return;
    let alive = true;
    setLoadingOne(true);
    apiFetch(`/chat/conversations/${activeId}`, { token })
      .then((d) => alive && upsertConversation(d.conversation))
      .catch(() => alive && select(null))
      .finally(() => alive && setLoadingOne(false));
    return () => {
      alive = false;
    };
  }, [activeId, active, loadingOne, token, upsertConversation, select]);

  // Fil ouvert = fil lu (et plus de son ni de pop-up pour lui).
  useEffect(() => registerActive(activeId), [activeId, registerActive]);

  // Marque lu à l'ouverture — mais pas si l'onglet est en arrière-plan (le
  // ChatThread s'en chargera au retour au premier plan).
  useEffect(() => {
    if (active?.unread && isWindowFocused()) markRead(active.id);
  }, [active?.id, active?.unread, markRead, isWindowFocused]);

  // Arrivée sur la page : on repart d'une liste fraîche (l'app a pu tourner
  // longtemps avec un flux temps réel coupé en arrière-plan).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // --- Plein écran mobile + clavier virtuel ---------------------------------
  // `chat-open` retire le padding de .app-content (le chat prend tout l'écran
  // sur téléphone). `--chat-vh` suit la hauteur RÉELLEMENT visible : quand le
  // clavier s'ouvre, la zone se réduit au lieu de passer sous le clavier — et
  // `chat-kb` masque la bottom bar pour récupérer sa place.
  useEffect(() => {
    document.body.classList.add("chat-open");
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv?.height || window.innerHeight;
      document.documentElement.style.setProperty("--chat-vh", `${h}px`);
      const overlap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      document.body.classList.toggle("chat-kb", overlap > 120);
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      document.body.classList.remove("chat-open", "chat-kb");
      document.documentElement.style.removeProperty("--chat-vh");
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (c.participants || []).some((p) => p.username.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  async function createConversation(userIds, name, force) {
    const d = await apiFetch("/chat/conversations", {
      method: "POST",
      token,
      body: { userIds, name: name || undefined, force: force || undefined },
    });
    upsertConversation(d.conversation);
    select(d.conversation.id);
  }

  function onLeft(id) {
    setConversations((prev) => prev.filter((c) => String(c.id) !== String(id)));
    select(null);
  }

  // Sous-titre de l'en-tête : « écrit… » > présence > nombre de membres.
  function headerSub(c) {
    const names = Object.keys(typing[String(c.id)] || {});
    if (names.length)
      return names.length === 1 ? `${names[0]} écrit…` : "plusieurs personnes écrivent…";
    if (c.isGroup) return `${c.participants?.length || 0} membres`;
    return presenceText(c.others?.[0], online);
  }

  return (
    <div className={`chat-page ${activeId ? "on-thread" : ""}`}>
      {/* ---------------- Colonne des conversations ---------------- */}
      <aside className="chat-aside">
        <header className="chat-aside-head">
          <h1>
            <MessagesSquare size={20} /> Messages
          </h1>
          <button
            type="button"
            className="chat-new clickable"
            onClick={() => setNewOpen(true)}
            title="Nouveau groupe"
            aria-label="Nouveau groupe"
          >
            <UserPlus size={17} />
          </button>
        </header>

        <label className="chat-aside-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher…"
          />
        </label>

        <div className="chat-list">
          {filtered.length === 0 && (
            <div className="chat-list-empty font-fun">
              {query.trim() ? (
                "Aucune discussion à ce nom."
              ) : (
                <>
                  <MessagesSquare size={26} />
                  <p>Pas encore de message.</p>
                  <button
                    type="button"
                    className="btn btn-primary clickable"
                    onClick={() => setNewOpen(true)}
                  >
                    <Users size={15} /> Créer un groupe
                  </button>
                </>
              )}
            </div>
          )}

          {filtered.map((c) => {
            const other = c.others?.[0];
            const isOnline = !c.isGroup && other && online.has(String(other.id));
            const names = Object.keys(typing[String(c.id)] || {});
            return (
              <button
                type="button"
                key={c.id}
                className={`chat-item clickable ${
                  String(c.id) === String(activeId) ? "active" : ""
                } ${c.unread ? "unread" : ""}`}
                onClick={() => openConversation(c)}
              >
                <span
                  className={`chat-item-av ${isOnline ? "online" : ""}`}
                  role={!c.isGroup && other ? "link" : undefined}
                  onClick={
                    !c.isGroup && other
                      ? (e) => {
                          // La photo ouvre le profil ; le reste de la ligne
                          // ouvre la discussion.
                          e.stopPropagation();
                          navigate(`/u/${other.username}`);
                        }
                      : undefined
                  }
                >
                  {c.avatar ? (
                    <img src={c.avatar} alt="" />
                  ) : c.isGroup ? (
                    <Users size={18} />
                  ) : (
                    (c.title || "?")[0].toUpperCase()
                  )}
                </span>
                <span className="chat-item-body">
                  <span className="chat-item-top">
                    <span className="chat-item-title">{c.title}</span>
                    <span className="chat-item-time">
                      {c.lastMessage?.at ? timeAgo(c.lastMessage.at) : ""}
                    </span>
                  </span>
                  <span className="chat-item-preview">
                    {names.length ? (
                      <em className="chat-item-typing">écrit…</em>
                    ) : c.lastMessage ? (
                      <>
                        {c.lastMessage.authorName && c.lastMessage.kind !== "system" && (
                          <b>
                            {String(c.lastMessage.authorId) === String(user?.id)
                              ? "Toi : "
                              : c.isGroup
                              ? `${c.lastMessage.authorName} : `
                              : ""}
                          </b>
                        )}
                        {c.lastMessage.kind === "image" || c.lastMessage.kind === "gif" ? (
                          <>
                            <ImageIcon size={13} />{" "}
                            {c.lastMessage.kind === "gif" ? "GIF" : "Photo"}
                          </>
                        ) : c.lastMessage.kind === "game" ? (
                          <>
                            <Gamepad2 size={13} /> {c.lastMessage.text}
                          </>
                        ) : c.lastMessage.kind === "ost" ? (
                          <>
                            <Music size={13} /> {c.lastMessage.text}
                          </>
                        ) : (
                          c.lastMessage.text
                        )}
                      </>
                    ) : (
                      <em>Dis bonjour 👋</em>
                    )}
                  </span>
                </span>
                {c.muted && <BellOff size={13} className="chat-item-muted" />}
                {c.unread > 0 && (
                  <span className="chat-item-badge">{c.unread > 9 ? "9+" : c.unread}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ---------------- Fil de discussion ---------------- */}
      <section className="chat-main">
        {!active ? (
          <div className="chat-placeholder">
            {loadingOne ? (
              <Loader2 size={24} className="spin" />
            ) : (
              <>
                <MessagesSquare size={40} />
                <h2 className="font-fun">Tes messages</h2>
                <p>Choisis une discussion, ou lance-en une nouvelle.</p>
                <button
                  type="button"
                  className="btn btn-primary clickable"
                  onClick={() => setNewOpen(true)}
                >
                  <Users size={15} /> Nouveau groupe
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            <header className="chat-head">
              <button
                type="button"
                className="chat-back clickable"
                onClick={() => select(null)}
                aria-label="Retour"
              >
                <ChevronLeft size={20} />
              </button>
              {(() => {
                const other = active.others?.[0];
                const av = (
                  <span
                    className={`chat-head-av ${
                      !active.isGroup && other && online.has(String(other.id))
                        ? "online"
                        : ""
                    }`}
                  >
                    {active.avatar ? (
                      <img src={active.avatar} alt="" />
                    ) : active.isGroup ? (
                      <Users size={18} />
                    ) : (
                      (active.title || "?")[0].toUpperCase()
                    )}
                  </span>
                );
                // Une photo de profil mène toujours au profil.
                return !active.isGroup && other ? (
                  <Link to={`/u/${other.username}`} title={`Profil de ${other.username}`}>
                    {av}
                  </Link>
                ) : (
                  av
                );
              })()}
              <div className="chat-head-info">
                {!active.isGroup && active.others?.[0] ? (
                  <Link to={`/u/${active.others[0].username}`} className="chat-head-name">
                    {active.title}
                  </Link>
                ) : (
                  <strong>{active.title}</strong>
                )}
                <span className="chat-head-sub">{headerSub(active)}</span>
              </div>
              {active.muted && <BellOff size={15} className="chat-head-muted" />}
              <button
                type="button"
                className="chat-head-btn clickable"
                onClick={() => setInfoOpen(true)}
                title="Infos"
                aria-label="Infos"
              >
                <Info size={18} />
              </button>
            </header>

            <ChatThread key={active.id} conversation={active} token={token} />
          </>
        )}
      </section>

      {newOpen && (
        <NewChatModal
          token={token}
          onClose={() => setNewOpen(false)}
          onCreate={createConversation}
          onOpenExisting={(id) => select(id)}
        />
      )}
      {infoOpen && active && (
        <ChatInfoModal
          conversation={active}
          token={token}
          me={user}
          onClose={() => setInfoOpen(false)}
          onChanged={(next) => upsertConversation(next)}
          onLeft={onLeft}
        />
      )}
    </div>
  );
}
