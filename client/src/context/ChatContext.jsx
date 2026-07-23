import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { MessageCircle, X } from "lucide-react";
import { useAuth } from "./AuthContext";
import { apiFetch, API_BASE } from "../lib/api";
import { playMessageSound } from "../lib/sfx";

const ChatContext = createContext(null);

// Durée d'affichage d'une bulle « X t'a écrit » (ms).
const TOAST_MS = 6000;
// Un « … est en train d'écrire » s'efface tout seul si plus rien n'arrive.
const TYPING_MS = 4500;
// Nombre de fenêtres flottantes ouvertes côte à côte (les suivantes se replient).
const MAX_WINDOWS = 3;

// Aperçu (liste + panneau) d'un message reçu en direct, cartes comprises.
function previewOf(m) {
  if (m.game) return m.text || `Jeu : ${m.game.name}`;
  if (m.ost) return m.text || `OST : ${m.ost.name}`;
  if (m.text) return m.text;
  if (m.media?.length) return m.media[0].kind === "gif" ? "GIF" : "Photo";
  return "";
}
function kindOf(m) {
  if (m.game) return "game";
  if (m.ost) return "ost";
  if (m.media?.length) return m.media[0].kind;
  return "text";
}
// Texte de la pop-up de notification.
function toastTextOf(m) {
  if (m.game) return m.text || `t'a recommandé ${m.game.name}`;
  if (m.ost) return m.text || `t'a partagé « ${m.ost.name} »`;
  if (m.text) return m.text;
  if (m.media?.length)
    return m.media[0].kind === "gif" ? "a envoyé un GIF" : "a envoyé une photo";
  return "";
}

export function ChatProvider({ children }) {
  const { token, user } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [online, setOnline] = useState(() => new Set());
  const [typing, setTyping] = useState({}); // convId -> { [username]: expiresAt }
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);
  // Fenêtres de discussion flottantes : [{ id, minimized }].
  const [docks, setDocks] = useState([]);

  // Conversations actuellement VISIBLES à l'écran (page /messages et fenêtres
  // flottantes) : ni son, ni pop-up pour elles. C'est un ensemble, car
  // plusieurs fils peuvent être ouverts en même temps.
  const activeRef = useRef(new Set());
  // La fenêtre du navigateur est-elle réellement AU PREMIER PLAN ? (onglet
  // visible ET fenêtre focalisée). Un fil « ouvert » dans un onglet en arrière-
  // plan ne compte pas comme lu, et reçoit quand même son pop-up.
  const focusedRef = useRef(
    typeof document === "undefined" ||
      (document.visibilityState !== "hidden" && document.hasFocus())
  );
  const isWindowFocused = useCallback(() => focusedRef.current, []);
  // Abonnés aux évènements de messages (la page /messages s'y branche).
  const listeners = useRef(new Set());
  // Miroir de la liste : les handlers SSE vivent dans un effet qui ne se
  // relance pas (sinon on rouvrirait le flux à chaque message) — ils liraient
  // donc une version figée de l'état. Ce ref leur donne toujours l'actuelle.
  const convRef = useRef([]);
  convRef.current = conversations;

  const unread = useMemo(
    () => conversations.reduce((n, c) => n + (c.unread || 0), 0),
    [conversations]
  );

  const emit = useCallback((event, payload) => {
    for (const fn of [...listeners.current]) {
      try {
        fn(event, payload);
      } catch {
        /* un abonné qui plante ne doit pas casser les autres */
      }
    }
  }, []);

  // Abonnement d'un composant au flux (retourne sa fonction de désinscription).
  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  // Suit le passage au premier plan / en arrière-plan. Au retour au premier
  // plan, on prévient les fils ouverts (évènement « focus ») pour qu'ils
  // marquent enfin comme lus les messages arrivés en arrière-plan.
  useEffect(() => {
    const update = () => {
      const next =
        document.visibilityState !== "hidden" && document.hasFocus();
      const gained = next && !focusedRef.current;
      focusedRef.current = next;
      if (gained) emit("focus", {});
    };
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [emit]);

  // Un fil affiché se déclare ici et se retire en partant (fonction rendue).
  const registerActive = useCallback((id) => {
    if (!id) return () => {};
    const key = String(id);
    activeRef.current.add(key);
    return () => activeRef.current.delete(key);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const d = await apiFetch("/chat/conversations", { token });
      setConversations(d.conversations || []);
      setOnline(
        new Set(
          (d.conversations || [])
            .flatMap((c) => c.participants || [])
            .filter((p) => p.online)
            .map((p) => String(p.id))
        )
      );
    } catch {
      /* silencieux : le badge se remettra à jour au prochain passage */
    }
  }, [token]);

  // Range une conversation en tête de liste (ou l'y insère).
  const upsertConversation = useCallback((conv, patch) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => String(c.id) === String(conv.id));
      const next = { ...conv, ...(patch || {}) };
      const list = idx >= 0 ? prev.map((c, i) => (i === idx ? next : c)) : [next, ...prev];
      return [...list].sort(
        (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
      );
    });
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- Flux temps réel (SSE) ---
  // `EventSource` gère seul la reconnexion : pas de boucle de retry maison.
  useEffect(() => {
    if (!token) {
      setConversations([]);
      setConnected(false);
      return;
    }
    refresh();

    const es = new EventSource(
      `${API_BASE}/chat/stream?token=${encodeURIComponent(token)}`
    );

    es.addEventListener("ready", () => {
      setConnected(true);
      // Reconnexion après une coupure : on rattrape ce qu'on a manqué.
      refresh();
    });

    es.addEventListener("message", (e) => {
      const { conversationId, message } = JSON.parse(e.data);
      emit("message", { conversationId, message });

      // « En train de le voir » = le fil est ouvert ET la fenêtre est au
      // premier plan. Un onglet en arrière-plan ne « lit » rien.
      const seeing =
        activeRef.current.has(String(conversationId)) && focusedRef.current;
      const conv = convRef.current.find((c) => String(c.id) === String(conversationId));

      setConversations((prev) =>
        prev.map((c) =>
          String(c.id) === String(conversationId)
            ? {
                ...c,
                lastMessageAt: message.createdAt,
                lastMessage: {
                  text: previewOf(message),
                  authorId: message.author?.id || null,
                  authorName: message.author?.username || "",
                  kind: kindOf(message),
                  at: message.createdAt,
                },
                unread: seeing || message.mine ? 0 : (c.unread || 0) + 1,
              }
            : c
        )
      );

      if (message.mine || message.system) return;
      if (conv?.muted) return;
      // Pop-up + son SAUF si on est déjà en train de regarder ce fil au premier
      // plan.
      if (!seeing) {
        playMessageSound();
        const toast = {
          id: `${message.id}-${Date.now()}`,
          conversationId: String(conversationId),
          title: conv?.isGroup ? conv.title : message.author?.username || "Message",
          author: message.author?.username || "",
          avatar: message.author?.avatar || null,
          text: toastTextOf(message),
          group: !!conv?.isGroup,
        };
        setToasts((prev) => [...prev.slice(-2), toast]);
        setTimeout(() => dismissToast(toast.id), TOAST_MS);
      }
    });

    es.addEventListener("message:update", (e) => {
      emit("message:update", JSON.parse(e.data));
    });

    es.addEventListener("conversation", (e) => {
      const { conversation } = JSON.parse(e.data);
      // Le fil est ouvert sous nos yeux : le serveur a pu calculer son compteur
      // avant que notre accusé de lecture ne lui parvienne — on force à zéro.
      upsertConversation(
        conversation,
        activeRef.current.has(String(conversation.id)) && focusedRef.current
          ? { unread: 0 }
          : null
      );
    });

    es.addEventListener("conversation:gone", (e) => {
      const { conversationId } = JSON.parse(e.data);
      setConversations((prev) => prev.filter((c) => String(c.id) !== String(conversationId)));
      emit("conversation:gone", { conversationId });
    });

    es.addEventListener("typing", (e) => {
      const { conversationId, user: who, stopped } = JSON.parse(e.data);
      if (!who?.username) return;
      setTyping((prev) => {
        const forConv = { ...(prev[conversationId] || {}) };
        if (stopped) delete forConv[who.username];
        else forConv[who.username] = Date.now() + TYPING_MS;
        return { ...prev, [conversationId]: forConv };
      });
    });

    es.addEventListener("read", (e) => {
      const { conversationId, userId, at } = JSON.parse(e.data);
      setConversations((prev) =>
        prev.map((c) =>
          String(c.id) === String(conversationId)
            ? {
                ...c,
                reads: [
                  ...(c.reads || []).filter((r) => String(r.user) !== String(userId)),
                  { user: String(userId), at },
                ],
              }
            : c
        )
      );
      emit("read", { conversationId, userId, at });
    });

    es.addEventListener("presence", (e) => {
      const { userId, online: isOn } = JSON.parse(e.data);
      setOnline((prev) => {
        const next = new Set(prev);
        if (isOn) next.add(String(userId));
        else next.delete(String(userId));
        return next;
      });
    });

    es.onerror = () => setConnected(false);

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Les « en train d'écrire » expirent tout seuls (l'émetteur peut se
  // déconnecter sans jamais envoyer son « stopped »).
  useEffect(() => {
    const id = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let changed = false;
        const next = {};
        for (const [convId, users] of Object.entries(prev)) {
          const kept = {};
          for (const [name, exp] of Object.entries(users)) {
            if (exp > now) kept[name] = exp;
            else changed = true;
          }
          next[convId] = kept;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // Filet de sécurité : si le flux est tombé (proxy, veille longue), on
  // resynchronise la liste à intervalle lâche.
  useEffect(() => {
    if (!token || connected) return;
    const id = setInterval(refresh, 45000);
    return () => clearInterval(id);
  }, [token, connected, refresh]);

  // ============================================================
  //  Fenêtres flottantes (façon Facebook : on discute sans quitter la page)
  // ============================================================
  // Sur petit écran, une fenêtre flottante n'a pas de place : on bascule sur
  // la page /messages, qui est déjà pensée plein écran.
  const isNarrow = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 760px)")?.matches;

  const openDock = useCallback((id, minimized = false) => {
    const key = String(id);
    setDocks((prev) => {
      const known = prev.some((d) => d.id === key);
      const next = known
        ? prev.map((d) => (d.id === key ? { ...d, minimized } : d))
        : [...prev, { id: key, minimized }];
      // Au-delà de trois fenêtres ouvertes, les plus anciennes se replient en
      // pastilles plutôt que de disparaître.
      const open = next.filter((d) => !d.minimized);
      if (open.length <= MAX_WINDOWS) return next;
      const toFold = new Set(open.slice(0, open.length - MAX_WINDOWS).map((d) => d.id));
      return next.map((d) => (toFold.has(d.id) ? { ...d, minimized: true } : d));
    });
  }, []);

  const closeDock = useCallback((id) => {
    setDocks((prev) => prev.filter((d) => d.id !== String(id)));
  }, []);

  const toggleDock = useCallback((id) => {
    setDocks((prev) =>
      prev.map((d) => (d.id === String(id) ? { ...d, minimized: !d.minimized } : d))
    );
  }, []);

  // Point d'entrée unique : « montre-moi cette conversation », d'où qu'on
  // clique (pop-up, panneau de la topbar, profil).
  const focusConversation = useCallback(
    (id) => {
      if (isNarrow()) navigate(`/messages?c=${id}`);
      else openDock(id);
    },
    [navigate, openDock]
  );

  // Marque une conversation comme lue (optimiste + serveur).
  const markRead = useCallback(
    async (conversationId) => {
      setConversations((prev) =>
        prev.map((c) => (String(c.id) === String(conversationId) ? { ...c, unread: 0 } : c))
      );
      try {
        await apiFetch(`/chat/conversations/${conversationId}/read`, {
          method: "POST",
          token,
        });
      } catch {
        /* best-effort */
      }
    },
    [token]
  );

  // Ouvre (ou retrouve) la conversation à deux avec quelqu'un et l'affiche.
  const openWith = useCallback(
    async (userId) => {
      const d = await apiFetch("/chat/conversations", {
        method: "POST",
        token,
        body: { userIds: [String(userId)] },
      });
      upsertConversation(d.conversation);
      focusConversation(d.conversation.id);
      return d.conversation;
    },
    [token, upsertConversation, focusConversation]
  );

  const value = {
    conversations,
    setConversations,
    upsertConversation,
    unread,
    online,
    typing,
    connected,
    refresh,
    markRead,
    openWith,
    subscribe,
    registerActive,
    isWindowFocused,
    docks,
    openDock,
    closeDock,
    toggleDock,
    focusConversation,
    me: user,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
      {/* Pop-up de message : disponibles partout dans l'app, hors du flux du
          document (portail) pour ne dépendre d'aucun conteneur. */}
      {toasts.length > 0 &&
        createPortal(
          <div className="chat-toasts">
            {toasts.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chat-toast clickable"
                onClick={() => {
                  dismissToast(t.id);
                  focusConversation(t.conversationId);
                }}
              >
                <span className="chat-toast-av">
                  {t.avatar ? (
                    <img src={t.avatar} alt="" />
                  ) : (
                    (t.author || "?")[0].toUpperCase()
                  )}
                  <span className="chat-toast-badge">
                    <MessageCircle size={10} />
                  </span>
                </span>
                <span className="chat-toast-body">
                  <span className="chat-toast-title">{t.title}</span>
                  <span className="chat-toast-text">
                    {t.group && t.author ? `${t.author} : ` : ""}
                    {t.text}
                  </span>
                </span>
                <span
                  className="chat-toast-x"
                  role="button"
                  tabIndex={-1}
                  aria-label="Fermer"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissToast(t.id);
                  }}
                >
                  <X size={14} />
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </ChatContext.Provider>
  );
}

// Hors des pages connectées (landing, login…), le provider n'est pas monté :
// on renvoie un objet inerte plutôt que de faire planter l'appelant.
const EMPTY = {
  conversations: [],
  unread: 0,
  online: new Set(),
  typing: {},
  connected: false,
  refresh: () => {},
  markRead: () => {},
  openWith: async () => {},
  subscribe: () => () => {},
  isWindowFocused: () => true,
  registerActive: () => () => {},
  docks: [],
  openDock: () => {},
  closeDock: () => {},
  toggleDock: () => {},
  focusConversation: () => {},
  upsertConversation: () => {},
  setConversations: () => {},
  me: null,
};

export const useChat = () => useContext(ChatContext) || EMPTY;
