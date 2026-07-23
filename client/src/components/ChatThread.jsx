import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Loader2,
  Smile,
  Reply,
  Pencil,
  Trash2,
  ArrowDown,
  Copy,
  MessagesSquare,
  Gamepad2,
  Play,
  Pause,
  Music,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { renderMessage, extractYouTubeIds, YouTubeEmbed } from "./ListComments";
import EmojiPanel from "./EmojiPanel";
import ChatComposer from "./ChatComposer";
import ChatLightbox from "./ChatLightbox";
import { useChat } from "../context/ChatContext";
import { usePlayer } from "../context/PlayerContext";
import { playSentSound } from "../lib/sfx";
import { useClickOutside } from "../hooks/useClickOutside";

// Réactions proposées d'un clic ; le picker complet reste accessible à côté.
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

// Découpe en graphèmes (pour compter les emojis composés comme UN seul).
const GRAPHEMES =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("fr", { granularity: "grapheme" })
    : null;

// Un message composé UNIQUEMENT d'emojis (1 à 6) s'affiche en plus gros, sans
// bulle — comme sur Messenger/WhatsApp. Renvoie 0 (normal), ou 1/2/3 = tailles.
function emojiOnlyLevel(text) {
  const t = (text || "").trim();
  if (!t) return 0;
  if (!/\p{Extended_Pictographic}/u.test(t)) return 0; // aucun emoji
  if (/[\p{L}\p{N}]/u.test(t)) return 0; // contient lettres/chiffres → texte
  const count = GRAPHEMES
    ? [...GRAPHEMES.segment(t)].filter((s) => s.segment.trim()).length
    : [...t].filter((c) => c.trim()).length;
  if (!count || count > 6) return 0;
  return count <= 2 ? 3 : count <= 4 ? 2 : 1;
}

// Deux messages du même auteur à moins de 5 min se collent (un seul avatar).
const GROUP_WINDOW = 5 * 60 * 1000;

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "Aujourd'hui";
  if (sameDay(d, yesterday)) return "Hier";
  return dayFmt.format(d);
}

// Phrase d'un message de service, composée côté client (le serveur ne stocke
// que le type + les noms concernés).
function systemText(m) {
  const who = m.author?.username || "Quelqu'un";
  const d = m.systemData || {};
  const names = (d.names || []).join(", ");
  switch (m.system) {
    case "created":
      return `${who} a créé le groupe avec ${names}.`;
    case "join":
      return `${who} a ajouté ${names}.`;
    case "leave":
      return d.kicked
        ? `${who} a retiré ${d.name} du groupe.`
        : `${d.name} a quitté le groupe.`;
    case "rename":
      return `${who} a renommé le groupe en « ${d.name} ».`;
    case "avatar":
      return `${who} a changé la photo du groupe.`;
    default:
      return "";
  }
}

// `compact` : rendu resserré pour les fenêtres flottantes (ChatDock).
// `autoFocus` : place le curseur dans le champ à l'ouverture (fenêtres
// flottantes — on veut écrire tout de suite).
export default function ChatThread({ conversation, token, compact, autoFocus }) {
  const { subscribe, typing, markRead, me, isWindowFocused } = useChat();
  const convId = String(conversation.id);
  // Chef de groupe : peut supprimer n'importe quel message du fil.
  const iOwnGroup =
    conversation.isGroup && String(conversation.ownerId) === String(me?.id);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [reactMenu, setReactMenu] = useState(null); // { id, x, y } — palette de réactions (portail)
  const [fullPicker, setFullPicker] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { url }
  const [newBelow, setNewBelow] = useState(false); // message reçu alors qu'on lit plus haut
  const [jumpTo, setJumpTo] = useState(null); // message cité qu'on veut rejoindre
  const [flash, setFlash] = useState(null); // message mis en évidence à l'arrivée
  const [ctxMenu, setCtxMenu] = useState(null); // { message, x, y } — clic droit
  // Barre « Nouveaux messages » : id du premier message non lu à l'ouverture.
  const [divider, setDivider] = useState(null);
  // Dernier message arrivé : joue une petite animation d'entrée (une seule
  // bulle animée à la fois — pas de cascade au chargement d'une page).
  const [freshId, setFreshId] = useState(null);

  // Miroir de la conversation : l'effet de chargement lit l'état de lecture au
  // moment de l'ouverture SANS se relancer quand la conversation se met à jour.
  const convSnapRef = useRef(conversation);
  convSnapRef.current = conversation;

  const scrollRef = useRef(null);
  const stickRef = useRef(true); // le fil est-il collé en bas ?
  const rowRefs = useRef(new Map()); // id du message -> son élément

  const closeReact = useCallback(() => {
    setReactMenu(null);
    setFullPicker(false);
  }, []);

  const scrollToBottom = useCallback((behavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    stickRef.current = true;
    setNewBelow(false);
  }, []);

  // Collage au bas FIABLE à l'ouverture : dans une fenêtre flottante (ou avec
  // des images qui arrivent après coup), la hauteur du fil n'est pas encore
  // stable au premier rendu — un seul scroll rate le bas. On répète sur
  // quelques frames tant qu'on est censé rester collé.
  const pinToBottom = useCallback(() => {
    scrollToBottom();
    requestAnimationFrame(() => scrollToBottom());
    for (const d of [60, 160, 320]) {
      setTimeout(() => stickRef.current && scrollToBottom(), d);
    }
  }, [scrollToBottom]);

  // Une image du fil finit de charger → sa hauteur apparaît : si on était collé
  // au bas, on s'y recolle (sinon le dernier message repasse sous le pli).
  const onMediaLoad = useCallback(() => {
    if (stickRef.current) scrollToBottom();
  }, [scrollToBottom]);

  // --- Chargement de la dernière page à l'ouverture du fil ---
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setReplyTo(null);
    setEditing(null);
    setDivider(null);
    // Instantané AVANT que l'ouverture ne marque le fil comme lu : où en
    // étais-je resté ? (figé pour toute la durée d'ouverture, comme Discord.)
    const snapReadAt = convSnapRef.current.myReadAt
      ? new Date(convSnapRef.current.myReadAt)
      : null;
    const snapUnread = convSnapRef.current.unread || 0;
    apiFetch(`/chat/conversations/${convId}/messages`, { token })
      .then((d) => {
        if (!alive) return;
        const msgs = d.messages || [];
        setMessages(msgs);
        setHasMore(!!d.hasMore);
        // Barre « Nouveaux messages » : posée avant le premier message reçu
        // depuis mon dernier passage. (Si les non-lus dépassent la page, toute
        // la page est plus récente → la barre se pose en haut.)
        if (snapUnread > 0) {
          const first = msgs.find(
            (msg) =>
              !msg.mine &&
              !msg.system &&
              (!snapReadAt || new Date(msg.createdAt) > snapReadAt)
          );
          setDivider(first ? first.id : null);
        }
        stickRef.current = true;
        requestAnimationFrame(() => pinToBottom());
      })
      .catch(() => alive && setMessages([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [convId, token, pinToBottom]);

  // --- Temps réel : nouveaux messages, corrections, suppressions ---
  useEffect(
    () =>
      subscribe((event, payload) => {
        // Retour de la fenêtre au premier plan : on lit ENFIN ce qui est
        // arrivé pendant qu'on était ailleurs (pas de conversationId ici).
        if (event === "focus") {
          markRead(convId);
          return;
        }
        if (String(payload.conversationId) !== convId) return;
        if (event === "message") {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.message.id)
              ? prev
              : [...prev, payload.message]
          );
          setFreshId(payload.message.id);
          // On ne « lit » que si la fenêtre est au premier plan ; sinon le
          // badge reste et on lira au retour (évènement « focus » ci-dessus).
          if (!payload.message.mine && isWindowFocused()) markRead(convId);
          if (!stickRef.current && !payload.message.mine) setNewBelow(true);
        } else if (event === "message:update") {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.message.id ? payload.message : m))
          );
        }
      }),
    [subscribe, convId, markRead, isWindowFocused]
  );

  // Le fil suit le bas TANT QU'ON Y EST : si on lit plus haut, on ne saute pas.
  // Le tout premier positionnement est instantané (on ouvre déjà en bas) ;
  // ensuite, l'arrivée d'un message se fait en douceur.
  const settledRef = useRef(false);
  useEffect(() => {
    if (!stickRef.current) return;
    scrollToBottom(settledRef.current ? "smooth" : "auto");
    if (messages.length) settledRef.current = true;
  }, [messages, scrollToBottom]);

  useEffect(() => {
    settledRef.current = false;
  }, [convId]);

  // Clavier virtuel : la zone visible se réduit → on se recolle au bas pour que
  // le dernier message ne passe pas sous le clavier.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (stickRef.current) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  // --- Pagination : on remonte le temps quand on atteint le haut ---
  const loadMore = useCallback(async () => {
    const el = scrollRef.current;
    if (!el || loadingMore || !hasMore || !messages.length) return;
    setLoadingMore(true);
    const before = messages[0].createdAt;
    const prevHeight = el.scrollHeight;
    try {
      const d = await apiFetch(
        `/chat/conversations/${convId}/messages?before=${encodeURIComponent(before)}`,
        { token }
      );
      setMessages((prev) => [...(d.messages || []), ...prev]);
      setHasMore(!!d.hasMore);
      // On restaure la position de lecture : sans ça, insérer 30 bulles en tête
      // ferait « sauter » le fil sous les yeux.
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      /* on réessaiera au prochain scroll */
    } finally {
      setLoadingMore(false);
    }
  }, [convId, token, messages, hasMore, loadingMore]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stickRef.current) setNewBelow(false);
    if (el.scrollTop < 80) loadMore();
    // Le fil bouge : menus et palettes (positionnés en fixed) ne sont plus en face.
    if (ctxMenu) setCtxMenu(null);
    if (reactMenu) closeReact();
  }

  // Ouvre le menu contextuel (clic droit sur PC, appui long au doigt), ancré
  // au point d'appui. `e` peut être un vrai évènement ou un point simulé.
  const openContext = useCallback((e, m) => {
    if (m.deleted || m.system) return;
    e.preventDefault?.();
    setCtxMenu({ message: m, x: e.clientX, y: e.clientY });
  }, []);

  // Clic sur une citation : on remonte au message d'origine. S'il est encore
  // plus haut que ce qui est chargé, on remonte page par page jusqu'à le
  // trouver (l'effet se relance à chaque page ajoutée).
  useEffect(() => {
    if (!jumpTo) return;
    const el = rowRefs.current.get(jumpTo);
    if (el) {
      stickRef.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(jumpTo);
      setJumpTo(null);
      const t = setTimeout(() => setFlash(null), 1800);
      return () => clearTimeout(t);
    }
    if (hasMore && !loadingMore) loadMore();
    else setJumpTo(null); // introuvable (message supprimé de la base)
  }, [jumpTo, messages, hasMore, loadingMore, loadMore]);

  // --- Actions ---
  const send = useCallback(
    async ({ text, media }) => {
      const d = await apiFetch(`/chat/conversations/${convId}/messages`, {
        method: "POST",
        token,
        body: { text, media, replyTo: replyTo?.id || undefined },
      });
      setMessages((prev) =>
        prev.some((m) => m.id === d.message.id) ? prev : [...prev, d.message]
      );
      setFreshId(d.message.id);
      setReplyTo(null);
      stickRef.current = true;
      playSentSound();
    },
    [convId, token, replyTo]
  );

  const edit = useCallback(
    async (id, text) => {
      const d = await apiFetch(`/chat/messages/${id}`, {
        method: "PUT",
        token,
        body: { text },
      });
      setMessages((prev) => prev.map((m) => (m.id === id ? d.message : m)));
      setEditing(null);
    },
    [token]
  );

  const remove = useCallback(
    async (id) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, deleted: true, text: "", media: [] } : m))
      );
      try {
        await apiFetch(`/chat/messages/${id}`, { method: "DELETE", token });
      } catch {
        /* best-effort */
      }
    },
    [token]
  );

  const react = useCallback(
    async (id, emoji) => {
      setReactMenu(null);
      setFullPicker(false);
      try {
        const d = await apiFetch(`/chat/messages/${id}/react`, {
          method: "POST",
          token,
          body: { emoji },
        });
        setMessages((prev) => prev.map((m) => (m.id === id ? d.message : m)));
      } catch {
        /* best-effort */
      }
    },
    [token]
  );

  const ping = useCallback(
    (stopped) => {
      apiFetch(`/chat/conversations/${convId}/typing`, {
        method: "POST",
        token,
        body: { stopped },
      }).catch(() => {});
    },
    [convId, token]
  );

  // --- Accusés de lecture : la pastille de chaque lecteur se pose sous le
  //     DERNIER message qu'il a vu (façon Messenger). -> messageId -> [lecteurs]
  const readMarkers = useMemo(() => {
    const map = {};
    const parts = conversation.participants || [];
    for (const r of conversation.reads || []) {
      if (!r.at) continue;
      const at = new Date(r.at);
      // Dernier message envoyé avant (ou à) son accusé de lecture.
      let target = null;
      for (const m of messages) {
        if (m.system) continue;
        if (new Date(m.createdAt) <= at) target = m;
        else break;
      }
      if (!target) continue;
      const p = parts.find((x) => String(x.id) === String(r.user));
      if (p) (map[target.id] ||= []).push(p);
    }
    return map;
  }, [messages, conversation.reads, conversation.participants]);

  const typingNames = Object.keys(typing[convId] || {});

  // Les @pseudos des participants se colorent pendant la frappe.
  const mentionNames = useMemo(
    () =>
      new Set(
        (conversation.participants || []).map((p) => p.username.toLowerCase())
      ),
    [conversation.participants]
  );

  return (
    <div className={`chat-thread ${compact ? "is-compact" : ""}`}>
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {loadingMore && (
          <div className="chat-more">
            <Loader2 size={16} className="spin" />
          </div>
        )}

        {loading ? (
          <div className="chat-state">
            <Loader2 size={22} className="spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-state chat-empty">
            <MessagesSquare size={30} />
            <p className="font-fun">
              {conversation.isGroup
                ? "Le groupe est tout neuf. Lance la discussion !"
                : `C'est le tout début avec ${conversation.title}.`}
            </p>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay =
              !prev || !sameDay(new Date(prev.createdAt), new Date(m.createdAt));
            const grouped =
              !newDay &&
              !m.system &&
              m.id !== divider && // sous la barre « Nouveaux », on réaffiche l'avatar
              prev &&
              !prev.system &&
              prev.author?.id === m.author?.id &&
              new Date(m.createdAt) - new Date(prev.createdAt) < GROUP_WINDOW;

            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="chat-day">
                    <span>{dayLabel(m.createdAt)}</span>
                  </div>
                )}
                {/* Barre « Nouveaux messages » (style Discord) : marque d'où
                    reprendre la lecture, figée à l'ouverture du fil. */}
                {m.id === divider && (
                  <div className="chat-unread-bar" role="separator">
                    <span className="chat-unread-pill">Nouveaux messages</span>
                  </div>
                )}
                {m.system ? (
                  <div className="chat-sys">{systemText(m)}</div>
                ) : (
                  <MessageRow
                    m={m}
                    grouped={grouped}
                    isGroup={conversation.isGroup}
                    canModerate={iOwnGroup}
                    flash={flash === m.id}
                    fresh={freshId === m.id}
                    onJumpTo={setJumpTo}
                    onContext={openContext}
                    onMediaLoad={onMediaLoad}
                    rowRefs={rowRefs}
                    onToggleReact={(e) => {
                      // Ancre = le bouton sourire : le popover (portail fixed)
                      // s'ouvre juste au-dessus, jamais rogné par un overflow.
                      const r = e.currentTarget.getBoundingClientRect();
                      setFullPicker(false);
                      setReactMenu((cur) =>
                        cur?.id === m.id
                          ? null
                          : { id: m.id, x: r.left + r.width / 2, y: r.top }
                      );
                    }}
                    onReact={react}
                    onReply={() => setReplyTo(m)}
                    onEdit={() => setEditing(m)}
                    onDelete={() => remove(m.id)}
                    onOpenImage={(url) => setLightbox({ url })}
                  />
                )}
                {/* Accusés de lecture : les pastilles des gens dont c'est le
                    dernier message vu se posent juste dessous. */}
                {readMarkers[m.id]?.length > 0 && (
                  <div className="chat-read-row">
                    {readMarkers[m.id].slice(0, 6).map((p) => (
                      <span className="chat-read-av" key={p.id} title={`Vu par ${p.username}`}>
                        {p.avatar ? (
                          <img src={p.avatar} alt="" />
                        ) : (
                          p.username[0].toUpperCase()
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })
        )}

        {typingNames.length > 0 && (
          <div className="chat-typing">
            <span className="chat-typing-dots">
              <i />
              <i />
              <i />
            </span>
            {typingNames.length === 1
              ? `${typingNames[0]} écrit…`
              : `${typingNames.slice(0, 2).join(", ")} écrivent…`}
          </div>
        )}
      </div>

      {newBelow && (
        <button className="chat-jump clickable" onClick={() => scrollToBottom("smooth")}>
          <ArrowDown size={15} /> Nouveau message
        </button>
      )}

      <ChatComposer
        token={token}
        conversationId={convId}
        mentionNames={mentionNames}
        autoFocus={autoFocus}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSend={send}
        onEdit={edit}
        onTyping={ping}
      />

      {lightbox && (
        <ChatLightbox url={lightbox.url} onClose={() => setLightbox(null)} />
      )}

      {ctxMenu && (
        <ChatMessageMenu
          menu={ctxMenu}
          canModerate={iOwnGroup}
          onClose={() => setCtxMenu(null)}
          onReact={react}
          onReply={setReplyTo}
          onEdit={setEditing}
          onDelete={remove}
        />
      )}

      {reactMenu && (
        <ReactionPopover
          menu={reactMenu}
          fullPicker={fullPicker}
          onOpenFull={() => setFullPicker(true)}
          onReact={react}
          onClose={closeReact}
        />
      )}
    </div>
  );
}

// --- Menu contextuel (clic droit sur un message) ---
function ChatMessageMenu({ menu, canModerate, onClose, onReact, onReply, onEdit, onDelete }) {
  const { message: m } = menu;
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [fullPicker, setFullPicker] = useState(false);

  useClickOutside(ref, onClose, true);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recale le menu pour qu'il tienne dans la fenêtre AVANT la peinture
  // (useLayoutEffect) : pas de saut visible entre le point de clic et la
  // position finale.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(menu.x, window.innerWidth - r.width - 8);
    const top = Math.min(menu.y, window.innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [menu.x, menu.y, fullPicker]);

  const canEdit = m.mine && !m.deleted && !m.system;
  const canDelete = m.mine || canModerate;

  return createPortal(
    <div
      ref={ref}
      className="chat-ctxmenu"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="chat-ctxmenu-reacts">
        {QUICK_REACTIONS.map((emo) => (
          <button
            type="button"
            key={emo}
            className="chat-ctxmenu-emoji clickable"
            onClick={() => {
              onReact(m.id, emo);
              onClose();
            }}
          >
            {emo}
          </button>
        ))}
        <button
          type="button"
          className="chat-ctxmenu-emoji chat-ctxmenu-more clickable"
          onClick={() => setFullPicker((v) => !v)}
          title="Plus d'émojis"
        >
          <Smile size={16} />
        </button>
      </div>

      {fullPicker ? (
        <div className="chat-ctxmenu-picker">
          <EmojiPanel
            onPick={(emo) => {
              onReact(m.id, emo);
              onClose();
            }}
            height={280}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            className="chat-ctxmenu-item clickable"
            onClick={() => {
              onReply(m);
              onClose();
            }}
          >
            <Reply size={15} /> Répondre
          </button>
          {m.text && (
            <button
              type="button"
              className="chat-ctxmenu-item clickable"
              onClick={() => {
                navigator.clipboard?.writeText(m.text).catch(() => {});
                onClose();
              }}
            >
              <Copy size={15} /> Copier le texte
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="chat-ctxmenu-item clickable"
              onClick={() => {
                onEdit(m);
                onClose();
              }}
            >
              <Pencil size={15} /> Modifier
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="chat-ctxmenu-item danger clickable"
              onClick={() => {
                onDelete(m.id);
                onClose();
              }}
            >
              <Trash2 size={15} /> Supprimer
            </button>
          )}
        </>
      )}
    </div>,
    document.body
  );
}

// --- Une bulle ---
function MessageRow({
  m,
  grouped,
  isGroup,
  flash,
  fresh,
  onJumpTo,
  onContext,
  onMediaLoad,
  rowRefs,
  onToggleReact,
  onReact,
  onReply,
  onEdit,
  onDelete,
  onOpenImage,
}) {
  const ytIds = m.deleted ? [] : extractYouTubeIds(m.text);
  // Message « que des emojis » (sans média ni carte) → rendu géant, sans bulle.
  const emojiLvl =
    m.deleted || m.media?.length || m.game || m.ost ? 0 : emojiOnlyLevel(m.text);

  // Le fil garde un annuaire id -> élément pour pouvoir sauter à un message cité.
  const register = useCallback(
    (el) => {
      if (el) rowRefs.current.set(m.id, el);
      else rowRefs.current.delete(m.id);
    },
    [rowRefs, m.id]
  );

  // Au doigt, il n'y a pas de survol : l'appui long (450 ms) ouvre le même menu
  // que le clic droit. Un glissement (scroll) annule l'appui.
  const pressRef = useRef(null);
  const cancelPress = useCallback(() => {
    clearTimeout(pressRef.current);
    pressRef.current = null;
  }, []);
  const onTouchStart = useCallback(
    (e) => {
      const t = e.touches?.[0];
      if (!t) return;
      const { clientX, clientY } = t;
      clearTimeout(pressRef.current);
      pressRef.current = setTimeout(() => {
        pressRef.current = null;
        navigator.vibrate?.(12); // petit retour haptique
        onContext({ clientX, clientY }, m);
      }, 450);
    },
    [onContext, m]
  );
  useEffect(() => cancelPress, [cancelPress]);

  return (
    <div
      ref={register}
      className={`chat-row ${m.mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${
        flash ? "is-flash" : ""
      } ${fresh ? "is-fresh" : ""}`}
      onContextMenu={(e) => onContext(e, m)}
      onTouchStart={onTouchStart}
      onTouchMove={cancelPress}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
    >
      {!m.mine && (
        <span className="chat-row-av">
          {!grouped &&
            (m.author?.username ? (
              <Link to={`/u/${m.author.username}`} title={m.author.username}>
                {m.author.avatar ? (
                  <img src={m.author.avatar} alt="" />
                ) : (
                  m.author.username[0].toUpperCase()
                )}
              </Link>
            ) : (
              "?"
            ))}
        </span>
      )}

      <div className="chat-bubble-wrap">
        {!grouped && isGroup && !m.mine && (
          <Link to={`/u/${m.author?.username || ""}`} className="chat-row-name">
            {m.author?.username || "—"}
          </Link>
        )}

        {m.replyTo && (
          <button
            type="button"
            className="chat-quote clickable"
            onClick={() => onJumpTo(m.replyTo.id)}
            title="Aller au message d'origine"
          >
            <strong>{m.replyTo.author?.username || "—"}</strong>
            <span>
              {m.replyTo.deleted
                ? "Message supprimé"
                : m.replyTo.text || (m.replyTo.kind === "gif" ? "GIF" : "Photo")}
            </span>
          </button>
        )}

        <div
          className={`chat-bubble ${m.deleted ? "is-deleted" : ""} ${
            m.game || m.ost ? "has-card" : ""
          } ${emojiLvl ? `chat-emoji-only lvl-${emojiLvl}` : ""}`}
        >
          {m.deleted ? (
            <em>Message supprimé</em>
          ) : (
            <>
              {m.game && <GameCard game={m.game} />}
              {m.ost && <OstCard ost={m.ost} />}
              {m.text && <p>{renderMessage(m.text, m.mentions)}</p>}
              {m.media?.length > 0 && (
                <div className={`chat-media n-${Math.min(m.media.length, 4)}`}>
                  {m.media.map((md, i) => (
                    <button
                      type="button"
                      key={i}
                      className="chat-media-item clickable"
                      onClick={() => onOpenImage(md.url)}
                    >
                      <img src={md.url} alt="" loading="lazy" onLoad={onMediaLoad} />
                    </button>
                  ))}
                </div>
              )}
              {ytIds.map((id) => (
                <YouTubeEmbed key={id} id={id} />
              ))}
            </>
          )}
          <span className="chat-time">
            {timeFmt.format(new Date(m.createdAt))}
            {m.edited && <em> · modifié</em>}
          </span>
        </div>

        {m.reactions?.length > 0 && (
          <div className="chat-reacts">
            {m.reactions.map((r) => (
              <button
                type="button"
                key={r.emoji}
                className={`chat-react clickable ${r.mine ? "mine" : ""}`}
                onClick={() => onReact(m.id, r.emoji)}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <b>{r.count}</b>}
              </button>
            ))}
          </div>
        )}
      </div>

      {!m.deleted && (
        <div className="chat-actions">
          <button
            type="button"
            className="chat-act clickable"
            onClick={onToggleReact}
            title="Réagir"
          >
            <Smile size={15} />
          </button>
          <button
            type="button"
            className="chat-act clickable"
            onClick={onReply}
            title="Répondre"
          >
            <Reply size={15} />
          </button>
          {m.mine && (
            <>
              <button
                type="button"
                className="chat-act clickable"
                onClick={onEdit}
                title="Modifier"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="chat-act clickable"
                onClick={onDelete}
                title="Supprimer"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}

        </div>
      )}
    </div>
  );
}

// --- Palette de réactions (portail fixed : jamais rognée par un overflow,
//     même dans les fenêtres de chat flottantes) ---
function ReactionPopover({ menu, fullPicker, onOpenFull, onReact, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useClickOutside(ref, onClose, true);

  // Centré au-dessus du bouton, recalé AVANT la peinture pour tenir à l'écran.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.x - r.width / 2, window.innerWidth - r.width - 8));
    let top = menu.y - r.height - 8; // au-dessus du bouton
    if (top < 8) top = Math.min(menu.y + 34, window.innerHeight - r.height - 8);
    setPos({ left, top: Math.max(8, top) });
  }, [menu.x, menu.y, fullPicker]);

  return createPortal(
    <div
      ref={ref}
      className={`chat-react-pop ${fullPicker ? "full" : ""}`}
      style={{ left: pos.left, top: pos.top }}
    >
      {fullPicker ? (
        <EmojiPanel onPick={(emo) => onReact(menu.id, emo)} height={300} />
      ) : (
        <>
          {QUICK_REACTIONS.map((emo) => (
            <button
              type="button"
              key={emo}
              className="chat-react-pick clickable"
              onClick={() => onReact(menu.id, emo)}
            >
              {emo}
            </button>
          ))}
          <button
            type="button"
            className="chat-react-pick chat-react-more clickable"
            onClick={onOpenFull}
            title="Plus d'émojis"
          >
            <Smile size={15} />
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

// --- Carte « jeu recommandé » dans une bulle ---
function GameCard({ game }) {
  return (
    <Link to={`/game/${game.gameId}`} className="chat-card chat-card-game clickable">
      <span className="chat-card-cover">
        {game.cover ? <img src={game.cover} alt="" /> : <Gamepad2 size={22} />}
      </span>
      <span className="chat-card-body">
        <span className="chat-card-kicker">
          <Gamepad2 size={12} /> Jeu recommandé
        </span>
        <span className="chat-card-title">{game.name}</span>
        <span className="chat-card-cta">Voir la fiche →</span>
      </span>
    </Link>
  );
}

// --- Carte « OST partagée » : jouable directement dans le fil ---
function OstCard({ ost }) {
  const player = usePlayer();
  const track = {
    id: ost.videoId ? `v-${ost.videoId}` : ost.url,
    videoId: ost.videoId,
    url: ost.url,
    name: ost.name,
    artist: ost.artist,
    artwork: ost.artwork,
    gameId: ost.gameId,
    gameName: ost.gameName,
  };
  const playable = !!(ost.videoId || ost.url);
  const isPlaying = playable && player?.isPlaying?.(track);

  return (
    <div className="chat-card chat-card-ost">
      <button
        type="button"
        className="chat-card-cover chat-card-play clickable"
        onClick={() =>
          playable &&
          player.toggleTrack(track, [track], {
            source: ost.gameName ? { label: ost.gameName } : undefined,
          })
        }
        disabled={!playable}
        aria-label={isPlaying ? "Pause" : "Écouter"}
      >
        {ost.artwork ? <img src={ost.artwork} alt="" /> : <Music size={22} />}
        {playable && (
          <span className="chat-card-play-icon">
            {isPlaying ? (
              <Pause size={18} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={18} fill="currentColor" strokeWidth={0} />
            )}
          </span>
        )}
      </button>
      <div className="chat-card-body">
        <span className="chat-card-kicker">
          <Music size={12} /> OST partagée
        </span>
        <span className="chat-card-title">{ost.name}</span>
        {ost.artist && <span className="chat-card-sub">{ost.artist}</span>}
        {ost.gameId && (
          <Link to={`/game/${ost.gameId}`} className="chat-card-game-link clickable">
            {ost.gameName || "Voir le jeu"}
          </Link>
        )}
      </div>
    </div>
  );
}
