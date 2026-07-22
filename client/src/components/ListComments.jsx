import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  MessageCircle,
  Send,
  Loader2,
  Trash2,
  Heart,
  Reply,
  Smile,
  ImagePlus,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Play,
} from "lucide-react";
import twemoji from "@twemoji/api";
import { apiFetch, apiUpload } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { useTheme } from "../context/ThemeContext";

// Chargé à la demande (grosse lib) : n'alourdit pas le bundle initial.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

const MAX_MEDIA = 4;

// Catégories du picker, libellées en français (valeurs = enum Categories).
const EMOJI_CATEGORIES = [
  { category: "suggested", name: "Récemment utilisés" },
  { category: "smileys_people", name: "Smileys & personnes" },
  { category: "animals_nature", name: "Animaux & nature" },
  { category: "food_drink", name: "Nourriture & boissons" },
  { category: "travel_places", name: "Voyages & lieux" },
  { category: "activities", name: "Activités" },
  { category: "objects", name: "Objets" },
  { category: "symbols", name: "Symboles" },
  { category: "flags", name: "Drapeaux" },
];

// Échappe le HTML (le texte est du contenu utilisateur) avant twemoji.
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Rend un fragment de texte avec les emojis en style Twitter (twemoji).
function twemojiHtml(part) {
  return { __html: twemoji.parse(escapeHtml(part), { folder: "svg", ext: ".svg" }) };
}

// Tokenise le texte : mentions @pseudo, liens http(s), reste = texte (emojis).
const TOKEN_SPLIT = /(@[\p{L}\p{N}_.-]+|https?:\/\/[^\s<]+)/gu;
const isUrl = (s) => /^https?:\/\//.test(s);

// Extrait l'id d'une vidéo YouTube depuis une URL (watch, youtu.be, shorts, embed).
function youtubeId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  );
  return m ? m[1] : null;
}
function extractYouTubeIds(text) {
  const ids = [];
  (String(text || "").match(/https?:\/\/[^\s<]+/g) || []).forEach((u) => {
    const id = youtubeId(u);
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

// Affichage compact d'un lien (sans protocole, tronqué).
function prettyUrl(url) {
  const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return clean.length > 42 ? clean.slice(0, 40) + "…" : clean;
}

// Rend le texte d'un message : mentions colorées, liens bleus cliquables, emojis Twitter.
export function renderMessage(text, mentions) {
  if (!text) return null;
  const canon = {};
  (mentions || []).forEach((u) => {
    canon[u.toLowerCase()] = u;
  });
  return text.split(TOKEN_SPLIT).map((part, i) => {
    if (!part) return null;
    if (part[0] === "@") {
      const real = canon[part.slice(1).toLowerCase()];
      if (real)
        return (
          <Link key={i} to={`/u/${real}`} className="lc-mention">
            {part}
          </Link>
        );
      return <span key={i} dangerouslySetInnerHTML={twemojiHtml(part)} />;
    }
    if (isUrl(part)) {
      // Sépare la ponctuation finale collée à l'URL.
      const m = part.match(/^([\s\S]*?)([).,!?;:]*)$/);
      const url = m[1];
      const trail = m[2];
      return (
        <Fragment key={i}>
          <a className="lc-link" href={url} target="_blank" rel="noreferrer noopener">
            {prettyUrl(url)}
          </a>
          {trail}
        </Fragment>
      );
    }
    return <span key={i} dangerouslySetInnerHTML={twemojiHtml(part)} />;
  });
}

// Calque de surlignage derrière le textarea : mentions existantes + liens en bleu.
// Exportée : le composer du mur média (GameMediaWall) la réutilise.
export function renderHighlight(text, valid) {
  return text.split(TOKEN_SPLIT).map((part, i) => {
    if (!part) return null;
    if (part[0] === "@" && valid.has(part.slice(1).toLowerCase()))
      return (
        <span key={i} className="lc-input-mention">
          {part}
        </span>
      );
    if (isUrl(part))
      return (
        <span key={i} className="lc-input-link">
          {part}
        </span>
      );
    return <span key={i} dangerouslySetInnerHTML={twemojiHtml(part)} />;
  });
}

// Lecteur YouTube inline : aperçu cliquable → iframe (lecture dans les commentaires).
function YouTubeEmbed({ id }) {
  const [play, setPlay] = useState(false);
  if (play) {
    return (
      <div className="lc-yt">
        <iframe
          src={`https://www.youtube.com/embed/${id}?autoplay=1`}
          title="YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="lc-yt lc-yt-preview"
      onClick={() => setPlay(true)}
      aria-label="Lire la vidéo"
    >
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
      <span className="lc-yt-play">
        <Play size={26} fill="currentColor" />
      </span>
    </button>
  );
}

// Texte d'un message avec « Voir plus » si trop long.
function MessageText({ text, mentions }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 4);
  }, [text]);
  return (
    <div className="lc-textwrap">
      <p ref={ref} className={expanded ? "" : "lc-clamp"}>
        {renderMessage(text, mentions)}
      </p>
      {clamped && (
        <button
          type="button"
          className="lc-more clickable"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Voir moins" : "Voir plus"}
        </button>
      )}
    </div>
  );
}

// Actions CRUD sur un fil de commentaires. `base` est le préfixe d'API du fil
// (ex. `/lists/<id>` ou `/ost/<owner>/<gameId>`) : on y ajoute `/comments…`.
// Partagé entre les listes et les OST de profil.
export function useCommentActions(base, token, setComments) {
  const editComment = useCallback(
    async (cid, { text, media }) => {
      const { comment } = await apiFetch(`${base}/comments/${cid}`, {
        method: "PUT",
        token,
        body: { text, media },
      });
      setComments((prev) => prev.map((c) => (c.id === cid ? comment : c)));
    },
    [base, token, setComments]
  );

  const postComment = useCallback(
    async ({ text, media, parent }) => {
      const { comment } = await apiFetch(`${base}/comments`, {
        method: "POST",
        token,
        body: { text, media, parent: parent || undefined },
      });
      setComments((prev) => [...prev, comment]);
      return comment;
    },
    [base, token, setComments]
  );

  const remove = useCallback(
    async (cid) => {
      setComments((prev) => prev.filter((c) => c.id !== cid));
      try {
        await apiFetch(`${base}/comments/${cid}`, { method: "DELETE", token });
      } catch {
        /* best-effort */
      }
    },
    [base, token, setComments]
  );

  const toggleLike = useCallback(
    async (cid) => {
      setComments((prev) =>
        prev.map((c) =>
          c.id === cid
            ? { ...c, liked: !c.liked, likeCount: c.likeCount + (c.liked ? -1 : 1) }
            : c
        )
      );
      try {
        const d = await apiFetch(`${base}/comments/${cid}/like`, {
          method: "POST",
          token,
        });
        setComments((prev) =>
          prev.map((c) =>
            c.id === cid ? { ...c, liked: d.liked, likeCount: d.likeCount } : c
          )
        );
      } catch {
        /* le rechargement corrigera */
      }
    },
    [base, token, setComments]
  );

  return { editComment, postComment, remove, toggleLike };
}

// Fil de commentaires réutilisable (listes ET posts du mur média d'un jeu).
// `base` = préfixe d'API (`/lists/<id>` ou `/game-media/<id>`) ; `moderatorMine`
// = l'utilisateur possède l'objet parent (peut supprimer n'importe quel message).
export function CommentThread({
  base,
  comments: initialComments,
  moderatorMine,
  token,
  title = "Commentaires",
  emptyText = "Sois le premier à commenter.",
  placeholder = "Laisse un commentaire…",
  // Message à mettre en évidence (on arrive dessus depuis une carte du fil).
  highlightId = null,
  onCountChange,
}) {
  const [comments, setComments] = useState(initialComments || []);
  const [replyFor, setReplyFor] = useState(null); // id du message dont l'input inline est ouvert
  const [viewer, setViewer] = useState(null); // { commentId, index } — lightbox média
  const [historyOf, setHistoryOf] = useState(null); // commentaire dont on montre l'historique

  useEffect(() => setComments(initialComments || []), [initialComments]);

  // Remonte le nombre de commentaires au parent (compteur du bouton « répondre »).
  const countCb = useRef(onCountChange);
  countCb.current = onCountChange;
  useEffect(() => {
    countCb.current?.(comments.length);
  }, [comments.length]);

  const openViewer = useCallback((c, index) => setViewer({ commentId: c.id, index }), []);

  const { editComment, postComment, remove, toggleLike } = useCommentActions(
    base,
    token,
    setComments
  );

  function toggleReply(id) {
    setReplyFor((cur) => (cur === id ? null : id));
  }

  // Regroupe : racines + réponses par racine (un seul niveau).
  const roots = comments.filter((c) => !c.parent);
  const repliesByRoot = {};
  comments
    .filter((c) => c.parent)
    .forEach((r) => {
      (repliesByRoot[r.parent] ||= []).push(r);
    });
  Object.values(repliesByRoot).forEach((arr) =>
    arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  );

  const canModerate = (c) => c.mine || moderatorMine;

  // Composer inline d'une réponse (rattachée à la racine `rootId`).
  const inlineComposer = (target, rootId) => (
    <Composer
      token={token}
      autoFocus
      compact
      placeholder={`Répondre à @${target.author?.username || "?"}…`}
      initialText={target.parent ? `@${target.author?.username || ""} ` : ""}
      onCancel={() => setReplyFor(null)}
      onSubmit={async ({ text, media }) => {
        await postComment({ text, media, parent: rootId });
        setReplyFor(null);
      }}
    />
  );

  return (
    <section className="ld-comments card">
      {title && (
        <h3 className="ld-comments-title">
          <MessageCircle size={18} /> {title}
          <span className="ld-comments-count">{comments.length}</span>
        </h3>
      )}

      {/* Composer principal (nouveau fil) */}
      <Composer
        token={token}
        placeholder={placeholder}
        onSubmit={async ({ text, media }) => {
          await postComment({ text, media, parent: null });
        }}
      />

      {/* Fils */}
      <div className="ld-comment-list">
        {comments.length === 0 && (
          <p className="ld-comments-empty font-fun">{emptyText}</p>
        )}

        {[...roots].reverse().map((root) => {
          const replies = repliesByRoot[root.id] || [];
          return (
            <div className="lc-thread" key={root.id}>
              <CommentItem
                c={root}
                token={token}
                highlight={!!highlightId && root.id === highlightId}
                canDelete={canModerate(root)}
                onDelete={remove}
                onLike={toggleLike}
                onReply={() => toggleReply(root.id)}
                onOpenMedia={openViewer}
                onEditSubmit={editComment}
                onShowHistory={setHistoryOf}
              />
              {replyFor === root.id && inlineComposer(root, root.id)}

              {replies.length > 0 && (
                <div className="lc-replies">
                  {replies.map((r) => (
                    <Fragment key={r.id}>
                      <CommentItem
                        c={r}
                        reply
                        token={token}
                        canDelete={canModerate(r)}
                        onDelete={remove}
                        onLike={toggleLike}
                        onReply={() => toggleReply(r.id)}
                        onOpenMedia={openViewer}
                        onEditSubmit={editComment}
                        onShowHistory={setHistoryOf}
                        highlight={!!highlightId && r.id === highlightId}
                      />
                      {replyFor === r.id && inlineComposer(r, root.id)}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {viewer && (
        <MediaViewer
          viewer={viewer}
          comments={comments}
          listMine={moderatorMine}
          token={token}
          onClose={() => setViewer(null)}
          onNavigate={setViewer}
          onOpenMedia={openViewer}
          onLike={toggleLike}
          onDelete={remove}
          onReplySubmit={postComment}
          onEditSubmit={editComment}
          onShowHistory={setHistoryOf}
        />
      )}

      {historyOf && (
        <HistoryModal comment={historyOf} onClose={() => setHistoryOf(null)} />
      )}
    </section>
  );
}

// Fil de commentaires d'une liste : fine enveloppe autour de CommentThread.
export default function ListComments({ listId, list, token }) {
  return (
    <CommentThread
      base={`/lists/${listId}`}
      comments={list.comments || []}
      moderatorMine={list.mine}
      token={token}
      emptyText="Sois le premier à commenter cette liste."
    />
  );
}

// ============================================================
//  Modale « fil de discussion » (ouverte depuis le profil, esprit Twitter)
//  Charge la liste, isole la racine du commentaire ciblé + ses réponses,
//  et réutilise CommentItem / Composer / MediaViewer.
// ============================================================
export function CommentThreadModal({ listId, commentId, token, focusMedia, onClose }) {
  const [comments, setComments] = useState([]);
  const [listMine, setListMine] = useState(false);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replyFor, setReplyFor] = useState(null);
  const [viewer, setViewer] = useState(focusMedia || null);
  const [historyOf, setHistoryOf] = useState(null);

  const { editComment, postComment, remove, toggleLike } = useCommentActions(
    `/lists/${listId}`,
    token,
    setComments
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/lists/${listId}`, { token })
      .then((d) => {
        if (!alive) return;
        setComments(d.list.comments || []);
        setListMine(!!d.list.mine);
        setListTitle(d.list.title);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [listId, token]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && !viewer && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, viewer]);

  const openViewer = useCallback((c, index) => setViewer({ commentId: c.id, index }), []);
  const canModerate = (c) => c.mine || listMine;

  const focused = comments.find((c) => c.id === commentId);
  const root = focused
    ? focused.parent
      ? comments.find((c) => c.id === focused.parent) || focused
      : focused
    : null;
  const replies = root
    ? comments
        .filter((c) => c.parent === root.id)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    : [];

  const inlineComposer = (target, rootId) => (
    <Composer
      token={token}
      autoFocus
      compact
      placeholder={`Répondre à @${target.author?.username || "?"}…`}
      initialText={target.parent ? `@${target.author?.username || ""} ` : ""}
      onCancel={() => setReplyFor(null)}
      onSubmit={async ({ text, media }) => {
        await postComment({ text, media, parent: rootId });
        setReplyFor(null);
      }}
    />
  );

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal thread-modal" onMouseDown={(e) => e.stopPropagation()}>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
          <h2 className="modal-title">
            <MessageCircle size={18} /> Fil de discussion
          </h2>
          {listTitle && (
            <p className="thread-sub">
              sur{" "}
              <Link to={`/lists/${listId}`} onClick={onClose}>
                {listTitle}
              </Link>
            </p>
          )}

          {loading ? (
            <div className="modal-loading">
              <Loader2 size={20} className="spin" /> Chargement…
            </div>
          ) : error ? (
            <p className="lc-error">{error}</p>
          ) : !root ? (
            <p className="ld-comments-empty font-fun">Ce commentaire n'existe plus.</p>
          ) : (
            <div className="thread-body">
              <CommentItem
                c={root}
                token={token}
                canDelete={canModerate(root)}
                onDelete={remove}
                onLike={toggleLike}
                onReply={() => setReplyFor((v) => (v === root.id ? null : root.id))}
                onOpenMedia={openViewer}
                onEditSubmit={editComment}
                onShowHistory={setHistoryOf}
                highlight={root.id === commentId}
              />
              {replyFor === root.id && inlineComposer(root, root.id)}

              {replies.length > 0 && (
                <div className="lc-replies">
                  {replies.map((r) => (
                    <Fragment key={r.id}>
                      <CommentItem
                        c={r}
                        reply
                        token={token}
                        canDelete={canModerate(r)}
                        onDelete={remove}
                        onLike={toggleLike}
                        onReply={() => setReplyFor((v) => (v === r.id ? null : r.id))}
                        onOpenMedia={openViewer}
                        onEditSubmit={editComment}
                        onShowHistory={setHistoryOf}
                        highlight={r.id === commentId}
                      />
                      {replyFor === r.id && inlineComposer(r, root.id)}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {viewer && comments.length > 0 && (
        <MediaViewer
          viewer={viewer}
          comments={comments}
          listMine={listMine}
          token={token}
          onClose={() => setViewer(null)}
          onNavigate={setViewer}
          onOpenMedia={openViewer}
          onLike={toggleLike}
          onDelete={remove}
          onReplySubmit={postComment}
          onEditSubmit={editComment}
          onShowHistory={setHistoryOf}
        />
      )}
      {historyOf && <HistoryModal comment={historyOf} onClose={() => setHistoryOf(null)} />}
    </>,
    document.body
  );
}

// ============================================================
//  Composer réutilisable (fil principal ET réponses inline)
// ============================================================
const MAX_CHARS = 300;

export function Composer({
  token,
  onSubmit,
  onCancel,
  autoFocus,
  compact,
  big, // variante « grand champ » (ex : review)
  placeholder = "Laisse un commentaire…",
  initialText = "",
  initialMedia = [],
  submitLabel,
  maxChars = MAX_CHARS,
  onLiveChange, // mode « éditeur contrôlé » : remonte {text, media} en direct (sans bouton Envoyer)
  toolbarExtra, // contenu additionnel dans la barre d'outils (ex : toggle spoiler)
}) {
  const [text, setText] = useState(initialText);
  const [mediaList, setMediaList] = useState(initialMedia); // [{type,url,width,height}]
  const [panel, setPanel] = useState(null); // null | "emoji" | "gif"
  const [popUp, setPopUp] = useState(false); // popover vers le haut si pas de place en bas
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  // Autocomplétion des mentions @
  const [mention, setMention] = useState(null); // { start, query }
  const [suggestions, setSuggestions] = useState([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  // Pseudos validés (existants) — pour ne colorer QUE ceux-là dans l'input.
  const [validMentions, setValidMentions] = useState(() => new Set());
  const mentionCache = useRef(new Map()); // pseudoLower -> bool (existe ?)

  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const toolbarRef = useRef(null);
  const hlRef = useRef(null); // calque de surlignage aligné sur le textarea

  // Mode « éditeur contrôlé » : remonte le contenu au parent à chaque frappe.
  const liveRef = useRef(onLiveChange);
  liveRef.current = onLiveChange;
  useEffect(() => {
    liveRef.current?.({ text, media: mediaList });
  }, [text, mediaList]);

  // Mémorise l'existence d'un pseudo (et le colore si existant).
  const markMention = useCallback((name, exists) => {
    const key = name.toLowerCase();
    if (mentionCache.current.get(key) === exists) return;
    mentionCache.current.set(key, exists);
    if (exists) setValidMentions((prev) => new Set(prev).add(key));
  }, []);

  // Ferme le popover (émoji / gif) au clic à l'extérieur. On intercepte en
  // phase de CAPTURE et on stoppe la propagation : le premier clic hors du
  // popover ne fait que le fermer (il ne ferme pas la modale, ne clique pas
  // le bouton dessous, etc.) — comportement « popover » façon Twitter.
  useEffect(() => {
    if (!panel) return;
    function onDocDown(e) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        setPanel(null);
      }
    }
    document.addEventListener("mousedown", onDocDown, true);
    return () => document.removeEventListener("mousedown", onDocDown, true);
  }, [panel]);

  // À l'ouverture d'un popover : s'il n'y a pas assez de place en bas, on
  // l'ouvre vers le haut (ancré au bouton) plutôt que d'agrandir la page.
  useLayoutEffect(() => {
    if (!panel) return;
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estimated = 380; // hauteur approx. du popover (émoji/gif)
    const below = window.innerHeight - rect.bottom;
    setPopUp(below < estimated && rect.top > below);
  }, [panel]);

  const slotsLeft = MAX_MEDIA - mediaList.length;
  const full = slotsLeft <= 0;
  const canSend = (text.trim() || mediaList.length) && !busy && !uploading;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Auto-agrandissement du champ + synchro du calque de surlignage.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, big ? 320 : 140)}px`;
    if (hlRef.current) hlRef.current.scrollTop = el.scrollTop;
  }, [text, big]);

  function syncScroll() {
    if (hlRef.current && inputRef.current) {
      hlRef.current.scrollTop = inputRef.current.scrollTop;
      hlRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

  function addMedia(items) {
    setMediaList((prev) => [...prev, ...items].slice(0, MAX_MEDIA));
  }
  function removeMedia(i) {
    setMediaList((prev) => prev.filter((_, k) => k !== i));
  }

  const uploadFiles = useCallback(
    async (fileList) => {
      const files = [...fileList]
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, MAX_MEDIA - mediaList.length);
      if (!files.length) return;
      setError(null);
      setUploading(true);
      try {
        const uploaded = await Promise.all(
          files.map(async (f) => {
            const fd = new FormData();
            fd.append("media", f);
            const { media } = await apiUpload("/lists/comments/media", fd, token);
            return media; // { type:"image", url }
          })
        );
        addMedia(uploaded);
      } catch (err) {
        setError(err.message);
      } finally {
        setUploading(false);
      }
    },
    [mediaList.length, token]
  );

  function onPaste(e) {
    const imgs = [...(e.clipboardData?.items || [])]
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (imgs.length) {
      e.preventDefault();
      uploadFiles(imgs);
    }
  }

  function insertEmoji(emo) {
    const el = inputRef.current;
    if (!el) return setText((t) => t + emo);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText((t) => t.slice(0, start) + emo + t.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emo.length;
      el.setSelectionRange(pos, pos);
    });
  }

  // Détecte si le curseur est dans un token @… et met à jour l'état mention.
  function detectMention(val, caret) {
    const upto = val.slice(0, caret ?? val.length);
    const m = upto.match(/(?:^|\s)@([\p{L}\p{N}_.-]{0,32})$/u);
    setMention(m ? { start: (caret ?? val.length) - m[1].length - 1, query: m[1] } : null);
  }

  function onChangeText(e) {
    setText(e.target.value);
    detectMention(e.target.value, e.target.selectionStart);
  }

  // Cherche les users correspondants (débouncé).
  const mentionQuery = mention?.query ?? null;
  useEffect(() => {
    if (mentionQuery == null || mentionQuery.length < 1) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      apiFetch(`/users/search/mentions?q=${encodeURIComponent(mentionQuery)}`, { token })
        .then((d) => {
          setSuggestions(d.users || []);
          setMentionIdx(0);
          // Les users renvoyés existent → on les mémorise pour la coloration.
          (d.users || []).forEach((u) => markMention(u.username, true));
        })
        .catch(() => setSuggestions([]));
    }, 180);
    return () => clearTimeout(t);
  }, [mentionQuery, token, markMention]);

  // Valide (débouncé) tous les @tokens du texte pour ne colorer que les
  // pseudos existants — y compris ceux collés ou pré-remplis (réponses).
  useEffect(() => {
    const tokens = [
      ...new Set(
        [...text.matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)].map((m) => m[1])
      ),
    ].filter((t) => !mentionCache.current.has(t.toLowerCase()));
    if (!tokens.length) return;
    const timer = setTimeout(() => {
      tokens.forEach(async (tk) => {
        try {
          const d = await apiFetch(
            `/users/search/mentions?q=${encodeURIComponent(tk)}`,
            { token }
          );
          const exists = (d.users || []).some(
            (u) => u.username.toLowerCase() === tk.toLowerCase()
          );
          markMention(tk, exists);
          (d.users || []).forEach((u) => markMention(u.username, true));
        } catch {
          /* ignore */
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, token, markMention]);

  function pickMention(u) {
    if (!mention) return;
    const start = mention.start;
    const end = start + 1 + mention.query.length; // '@' + saisie
    const insert = `@${u.username} `;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    setMention(null);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  const mentionOpen = mention && suggestions.length > 0;

  async function submit(e) {
    e?.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ text: text.trim(), media: mediaList });
      setText("");
      setMediaList([]);
      setPanel(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lc-composer ${compact ? "compact" : ""} ${big ? "big" : ""}`}>
      <div className="lc-inputwrap">
        {/* Autocomplétion des mentions @ — flotte AU-DESSUS de l'input */}
        {mentionOpen && (
          <div className="lc-mention-list lc-mention-pop">
            {suggestions.map((u, i) => (
              <button
                type="button"
                key={u.id}
                className={`lc-mention-item ${i === mentionIdx ? "active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(u);
                }}
                onMouseEnter={() => setMentionIdx(i)}
              >
                <span className="lc-mention-av">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" />
                  ) : (
                    (u.username[0] || "?").toUpperCase()
                  )}
                </span>
                <span className="lc-mention-name">{u.username}</span>
              </button>
            ))}
          </div>
        )}

        <div className="lc-inputbox">
          <div className="lc-input-field">
            {/* Calque de surlignage (mentions en bleu) derrière le textarea */}
            <div className="lc-input-hl" ref={hlRef} aria-hidden="true">
              {renderHighlight(text, validMentions)}
              {"​"}
            </div>
            <textarea
              ref={inputRef}
              className="lc-input"
              placeholder={placeholder}
              value={text}
              maxLength={maxChars}
              rows={1}
              onChange={onChangeText}
              onPaste={onPaste}
              onScroll={syncScroll}
              onKeyDown={(e) => {
            if (mentionOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIdx((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(suggestions[mentionIdx]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
            }
            // Entrée = simple retour à la ligne (l'envoi passe par le bouton).
            if (e.key === "Escape" && onCancel) onCancel();
          }}
            />
          </div>

        {/* Médias joints — directement dans la zone de saisie */}
        {(mediaList.length > 0 || uploading) && (
          <div className="lc-attach">
            {mediaList.map((m, i) => (
              <div className="lc-attach-item" key={i}>
                <img src={m.url} alt="" />
                <span className="lc-attach-tag">{m.type === "gif" ? "GIF" : "IMG"}</span>
                <button
                  type="button"
                  className="lc-attach-remove"
                  onClick={() => removeMedia(i)}
                  aria-label="Retirer"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {uploading && (
              <div className="lc-attach-item lc-attach-loading">
                <Loader2 size={16} className="spin" />
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {error && <p className="lc-error">{error}</p>}

      {/* Barre d'outils SOUS l'input (esprit Twitter) + popovers flottants */}
      <div className="lc-toolbar-wrap" ref={toolbarRef}>
        {panel === "emoji" && (
          <div className={`lc-pop lc-pop-emoji ${popUp ? "up" : "down"}`}>
            <EmojiPanel onPick={insertEmoji} />
          </div>
        )}
        {panel === "gif" && (
          <div className={`lc-pop lc-pop-gif ${popUp ? "up" : "down"}`}>
            <GifPanel
              token={token}
              onPick={(g) => {
                addMedia([{ type: "gif", url: g.url, width: g.width, height: g.height }]);
                setPanel(null);
              }}
            />
          </div>
        )}
        <div className="lc-toolbar">
          <div className="lc-toolbar-left">
          <button
            type="button"
            className={`lc-tool clickable ${panel === "emoji" ? "on" : ""}`}
            onClick={() => setPanel((p) => (p === "emoji" ? null : "emoji"))}
            title="Émoji"
          >
            <Smile size={19} />
          </button>
          <button
            type="button"
            className={`lc-tool lc-tool-gif clickable ${panel === "gif" ? "on" : ""}`}
            onClick={() => setPanel((p) => (p === "gif" ? null : "gif"))}
            disabled={full}
            title={full ? "4 médias maximum" : "GIF"}
          >
            GIF
          </button>
          <button
            type="button"
            className="lc-tool clickable"
            onClick={() => fileRef.current?.click()}
            disabled={full}
            title={full ? "4 médias maximum" : "Image (ou colle avec Ctrl+V)"}
          >
            <ImagePlus size={19} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {mediaList.length > 0 && (
            <span className="lc-media-count">{mediaList.length}/{MAX_MEDIA}</span>
          )}
          {toolbarExtra}
        </div>
        <div className="lc-toolbar-right">
          {text.length > 0 && <CharCounter len={text.length} max={maxChars} />}
          {onCancel && (
            <button type="button" className="lc-cancel clickable" onClick={onCancel}>
              Annuler
            </button>
          )}
          {onSubmit && (
            <button
              type="button"
              className="lc-send clickable"
              onClick={submit}
              disabled={!canSend}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={15} />}
              <span>{submitLabel || (onCancel ? "Répondre" : "Envoyer")}</span>
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

// --- Compteur de caractères (anneau qui se remplit, façon Twitter) ---
function CharCounter({ len, max }) {
  const R = 9;
  const CIRC = 2 * Math.PI * R;
  const pct = Math.min(len / max, 1);
  const remaining = max - len;
  const near = remaining <= 60; // on affiche le nombre restant
  const full = remaining <= 0;
  return (
    <div className={`lc-count ${near ? "near" : ""} ${full ? "full" : ""}`} title={`${len}/${max}`}>
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle className="lc-count-bg" cx="11" cy="11" r={R} />
        <circle
          className="lc-count-fg"
          cx="11"
          cy="11"
          r={R}
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - pct)}
          transform="rotate(-90 11 11)"
        />
      </svg>
      {near && <span className="lc-count-num">{remaining}</span>}
    </div>
  );
}

// --- Un commentaire ---
export function CommentItem({
  c,
  reply,
  token,
  canDelete,
  onDelete,
  onLike,
  onReply,
  onOpenMedia,
  onEditSubmit,
  onShowHistory,
  highlight,
}) {
  const [editing, setEditing] = useState(false);
  const initial = (c.author?.username || "?")[0].toUpperCase();
  const canEdit = c.mine && (c.editCount || 0) < 2 && onEditSubmit;

  return (
    <div className={`ld-comment ${reply ? "is-reply" : ""} ${highlight ? "is-focused" : ""}`}>
      <div className="ld-comment-avatar">
        {c.author?.avatar ? <img src={c.author.avatar} alt="" /> : initial}
      </div>
      <div className="ld-comment-body">
        <div className="ld-comment-head">
          {c.author?.username ? (
            <Link to={`/u/${c.author.username}`}>
              <strong>{c.author.username}</strong>
            </Link>
          ) : (
            <strong>—</strong>
          )}
          <span className="ld-comment-time">{timeAgo(c.createdAt)}</span>
          {c.edited && (
            <button
              className="lc-edited clickable"
              onClick={() => onShowHistory?.(c)}
              title="Voir l'historique des modifications"
            >
              modifié
            </button>
          )}
          {(canEdit || canDelete) && !editing && (
            <span className="ld-comment-mod">
              {canEdit && (
                <button
                  className="ld-comment-del clickable"
                  onClick={() => setEditing(true)}
                  title="Modifier"
                >
                  <Pencil size={13} />
                </button>
              )}
              {canDelete && (
                <button
                  className="ld-comment-del clickable"
                  onClick={() => onDelete(c.id)}
                  title="Supprimer"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
          )}
        </div>

        {editing ? (
          <Composer
            token={token}
            autoFocus
            compact
            initialText={c.text || ""}
            initialMedia={c.media || []}
            placeholder="Modifier…"
            submitLabel="Enregistrer"
            onCancel={() => setEditing(false)}
            onSubmit={async (payload) => {
              await onEditSubmit(c.id, payload);
              setEditing(false);
            }}
          />
        ) : (
          <>
            {c.text && <MessageText text={c.text} mentions={c.mentions} />}

            {extractYouTubeIds(c.text).map((id) => (
              <YouTubeEmbed key={id} id={id} />
            ))}

            {c.media?.length > 0 && (
              <div className={`lc-media-grid n-${c.media.length}`}>
                {c.media.map((m, i) => (
                  <button
                    type="button"
                    key={i}
                    className="lc-media"
                    onClick={() => onOpenMedia?.(c, i)}
                  >
                    <img
                      src={m.url}
                      alt={m.type === "gif" ? "GIF" : "image"}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="lc-actions">
              <button
                className={`lc-act clickable ${c.liked ? "liked" : ""}`}
                onClick={() => onLike(c.id)}
                title="J'aime"
              >
                <Heart size={14} fill={c.liked ? "currentColor" : "none"} />
                {c.likeCount > 0 && <span>{c.likeCount}</span>}
              </button>
              <button className="lc-act clickable" onClick={onReply} title="Répondre">
                <Reply size={14} /> Répondre
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  Lightbox média (esprit Twitter) : image à gauche, fil + réponse à droite
// ============================================================
export function MediaViewer({
  viewer,
  comments,
  listMine,
  token,
  onClose,
  onNavigate,
  onOpenMedia,
  onLike,
  onDelete,
  onReplySubmit,
  onEditSubmit,
  onShowHistory,
}) {
  const [replyInit, setReplyInit] = useState("");

  const viewed = comments.find((c) => c.id === viewer.commentId);
  const media = viewed?.media || [];
  const index = Math.min(viewer.index, Math.max(0, media.length - 1));
  const current = media[index];

  const root = viewed
    ? viewed.parent
      ? comments.find((c) => c.id === viewed.parent) || viewed
      : viewed
    : null;
  const replies = root
    ? comments
        .filter((c) => c.parent === root.id)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    : [];

  const step = useCallback(
    (dir) => {
      if (media.length < 2) return;
      onNavigate({
        commentId: viewer.commentId,
        index: (index + dir + media.length) % media.length,
      });
    },
    [media.length, index, viewer.commentId, onNavigate]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  // Média/commentaire disparu (supprimé) → on ferme.
  useEffect(() => {
    if (!viewed || media.length === 0) onClose();
  }, [viewed, media.length, onClose]);

  if (!viewed || !current || !root) return null;

  const canModerate = (c) => c.mine || listMine;

  return createPortal(
    <div
      className="mv-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <button className="mv-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>

      <div
        className="mv-media"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        {media.length > 1 && (
          <button
            className="mv-nav mv-prev clickable"
            onClick={() => step(-1)}
            aria-label="Précédent"
          >
            <ChevronLeft size={26} />
          </button>
        )}
        <img className="mv-img" src={current.url} alt="" />
        {media.length > 1 && (
          <button
            className="mv-nav mv-next clickable"
            onClick={() => step(1)}
            aria-label="Suivant"
          >
            <ChevronRight size={26} />
          </button>
        )}
        {media.length > 1 && (
          <div className="mv-dots">
            {media.map((_, i) => (
              <button
                key={i}
                className={`mv-dot ${i === index ? "active" : ""}`}
                onClick={() => onNavigate({ commentId: viewer.commentId, index: i })}
                aria-label={`Image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="mv-side">
        <div className="mv-thread">
          <CommentItem
            c={root}
            token={token}
            canDelete={canModerate(root)}
            onDelete={onDelete}
            onLike={onLike}
            onReply={() => setReplyInit(`@${root.author?.username || ""} `)}
            onOpenMedia={onOpenMedia}
            onEditSubmit={onEditSubmit}
            onShowHistory={onShowHistory}
          />
          {replies.length > 0 && (
            <div className="lc-replies">
              {replies.map((r) => (
                <CommentItem
                  key={r.id}
                  c={r}
                  reply
                  token={token}
                  canDelete={canModerate(r)}
                  onDelete={onDelete}
                  onLike={onLike}
                  onReply={() => setReplyInit(`@${r.author?.username || ""} `)}
                  onOpenMedia={onOpenMedia}
                  onEditSubmit={onEditSubmit}
                  onShowHistory={onShowHistory}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mv-composer">
          <Composer
            key={replyInit}
            token={token}
            autoFocus={!!replyInit}
            compact
            initialText={replyInit}
            placeholder="Répondre…"
            onSubmit={async (payload) => {
              await onReplySubmit({
                text: payload.text,
                media: payload.media,
                parent: root.id,
              });
              setReplyInit("");
            }}
          />
        </div>
      </aside>
    </div>,
    document.body
  );
}

// --- Modale d'historique (versions précédentes d'un message modifié) ---
export function HistoryModal({ comment, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const versions = comment.history || [];

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal hist-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <Pencil size={18} /> Versions précédentes
        </h2>
        <div className="hist-list">
          {versions.map((v, i) => (
            <div className="hist-item" key={i}>
              <div className="hist-meta">
                Version {i + 1} · {timeAgo(v.at)}
              </div>
              {v.text && <p>{renderMessage(v.text, [])}</p>}
              {v.media?.length > 0 && (
                <div className="hist-media">
                  {v.media.map((m, k) => (
                    <img key={k} src={m.url} alt="" />
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="hist-item current">
            <div className="hist-meta">Version actuelle</div>
            {comment.text && <p>{renderMessage(comment.text, comment.mentions)}</p>}
            {comment.media?.length > 0 && (
              <div className="hist-media">
                {comment.media.map((m, k) => (
                  <img key={k} src={m.url} alt="" />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Panneau émojis (emoji-picker-react, style Twitter, FR) ---
export function EmojiPanel({ onPick }) {
  const { theme } = useTheme();
  return (
    <div className="lc-emoji-wrap">
      <Suspense
        fallback={
          <div className="lc-emoji-loading">
            <Loader2 size={18} className="spin" />
          </div>
        }
      >
        <EmojiPicker
          onEmojiClick={(d) => onPick(d.emoji)}
          emojiStyle="twitter"
          theme={theme === "dark" ? "dark" : "light"}
          categories={EMOJI_CATEGORIES}
          searchPlaceHolder="Rechercher un émoji…"
          previewConfig={{ showPreview: false }}
          lazyLoadEmojis
          width="100%"
          height={360}
        />
      </Suspense>
    </div>
  );
}

// --- Panneau recherche de GIF (GIPHY) ---
function GifPanel({ token, onPick }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const reqRef = useRef(0);

  const search = useCallback(
    (term) => {
      const id = ++reqRef.current;
      setLoading(true);
      setErr(null);
      const path = term.trim()
        ? `/lists/gifs?q=${encodeURIComponent(term.trim())}`
        : "/lists/gifs";
      apiFetch(path, { token })
        .then((d) => id === reqRef.current && setGifs(d.gifs || []))
        .catch((e) => id === reqRef.current && setErr(e.message))
        .finally(() => id === reqRef.current && setLoading(false));
    },
    [token]
  );

  useEffect(() => {
    const t = setTimeout(() => search(q), 350);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <div className="lc-panel lc-gif-panel">
      <label className="lc-gif-search">
        <Search size={15} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un GIF…"
        />
        {loading && <Loader2 size={14} className="spin" />}
      </label>
      {err ? (
        <p className="lc-gif-empty">{err}</p>
      ) : (
        <div className="lc-gif-grid">
          {gifs.map((g) => (
            <button
              key={g.id}
              type="button"
              className="lc-gif clickable"
              onClick={() => onPick(g)}
              title={g.desc}
            >
              <img src={g.preview} alt={g.desc} loading="lazy" />
            </button>
          ))}
          {!loading && gifs.length === 0 && <p className="lc-gif-empty">Aucun GIF.</p>}
        </div>
      )}
      <span className="lc-gif-credit">Propulsé par GIPHY</span>
    </div>
  );
}
