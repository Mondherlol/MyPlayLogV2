import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ImagePlus,
  Send,
  X,
  Heart,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  Flame,
  Clock3,
  Play,
  Search,
  ChevronLeft,
  ChevronRight,
  Camera,
  MessageCircle,
  Smile,
  Share2,
  Check,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { CommentThread, EmojiPanel, renderMessage, renderHighlight } from "./ListComments";
import VideoEditorModal from "./VideoEditorModal";
import GameVideoPlayer from "./GameVideoPlayer";

const MAX_TEXT = 1000;
const MAX_MEDIA = 8;

// ============================================================
//  Marques de plateforme (SVG inline — lucide n'a plus les logos)
// ============================================================
function XMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function TikTokMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.1v12.6a2.6 2.6 0 1 1-2.6-2.6c.27 0 .53.04.78.12v-3.2a5.75 5.75 0 0 0-.78-.05A5.75 5.75 0 1 0 15.6 15.6V9.42a7.35 7.35 0 0 0 4.32 1.38V7.7a4.28 4.28 0 0 1-3.32-1.88z" />
    </svg>
  );
}
function YouTubeMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.11-2.13C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.39.52A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.11 2.13c1.89.52 9.39.52 9.39.52s7.5 0 9.39-.52a3 3 0 0 0 2.11-2.13A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.55 15.57V8.43L15.82 12z" />
    </svg>
  );
}

// ============================================================
//  Détection des embeds à partir des URLs du texte (façon Twitter)
// ============================================================
const URL_RE = /(https?:\/\/[^\s]+)/g;
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
const TW_RE = /(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/;
const TK_RE = /tiktok\.com\/(?:@[^/]+\/video|v|embed)\/(\d+)/;

function classifyUrl(url) {
  let m;
  if ((m = url.match(YT_RE))) return { kind: "youtube", id: m[1] };
  if ((m = url.match(TW_RE))) return { kind: "twitter", url };
  if ((m = url.match(TK_RE))) return { kind: "tiktok", url, id: m[1] };
  return null;
}

// Renvoie les embeds détectés + l'ensemble des URLs à retirer du texte affiché.
export function extractEmbeds(text) {
  const urls = String(text || "").match(URL_RE) || [];
  const embeds = [];
  const hide = new Set();
  const seen = new Set();
  for (const raw of urls) {
    const url = raw.replace(/[).,!?;:]+$/, ""); // ponctuation collée
    const c = classifyUrl(url);
    if (!c) continue;
    hide.add(raw);
    const key = `${c.kind}:${c.id || c.url}`;
    if (seen.has(key) || embeds.length >= 4) continue;
    seen.add(key);
    embeds.push(c);
  }
  return { embeds, hide };
}

// ============================================================
//  Chargement paresseux des scripts d'embed (X / TikTok)
// ============================================================
const scriptPromises = new Map();
function loadScriptOnce(src) {
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script"));
    document.body.appendChild(s);
  });
  scriptPromises.set(src, p);
  return p;
}
function reloadTikTok() {
  return new Promise((resolve, reject) => {
    document.getElementById("tiktok-embed-script")?.remove();
    const s = document.createElement("script");
    s.id = "tiktok-embed-script";
    s.src = "https://www.tiktok.com/embed.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("tiktok"));
    document.body.appendChild(s);
  });
}

function LinkCard({ url }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* garde l'url brute */
  }
  return (
    <a className="gm-linkcard" href={url} target="_blank" rel="noreferrer noopener">
      <span className="gm-linkcard-ic">
        <XMark size={20} />
      </span>
      <span className="gm-linkcard-txt">
        <b>Voir le post</b>
        <span>{host}</span>
      </span>
    </a>
  );
}

function EmbedSkeleton() {
  return (
    <div className="gm-embed-skel">
      <Loader2 size={18} className="spin" />
    </div>
  );
}

function TwitterEmbed({ url }) {
  const { theme } = useTheme();
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = `<blockquote class="twitter-tweet" data-dnt="true" data-theme="${
      theme === "dark" ? "dark" : "light"
    }"><a href="${url}"></a></blockquote>`;
    let cancelled = false;
    loadScriptOnce("https://platform.twitter.com/widgets.js")
      .then(() => {
        if (cancelled) return;
        if (window.twttr?.widgets?.load) {
          window.twttr.widgets.load(node);
          setTimeout(() => !cancelled && setReady(true), 400);
        } else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [url, theme]);
  if (failed) return <LinkCard url={url} />;
  return (
    <div className="gm-embed gm-embed-tw">
      <div ref={ref} className="gm-embed-host" />
      {!ready && <EmbedSkeleton />}
    </div>
  );
}

function TikTokEmbed({ url, videoId }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = `<blockquote class="tiktok-embed" cite="${url}" data-video-id="${videoId}" style="max-width:100%;min-width:280px;margin:0;"><section></section></blockquote>`;
    let cancelled = false;
    reloadTikTok().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [url, videoId]);
  if (failed) return <LinkCard url={url} />;
  return (
    <div className="gm-embed gm-embed-tk">
      <div ref={ref} className="gm-embed-host" />
    </div>
  );
}

function YouTubeEmbed({ id }) {
  const [play, setPlay] = useState(false);
  if (play)
    return (
      <div className="gm-yt">
        <iframe
          src={`https://www.youtube.com/embed/${id}?autoplay=1`}
          title="YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  return (
    <button type="button" className="gm-yt gm-yt-preview" onClick={() => setPlay(true)} aria-label="Lire la vidéo">
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
      <span className="gm-yt-play">
        <Play size={26} fill="currentColor" />
      </span>
    </button>
  );
}

export function PostEmbed({ embed }) {
  if (embed.kind === "youtube") return <YouTubeEmbed id={embed.id} />;
  if (embed.kind === "twitter") return <TwitterEmbed url={embed.url} />;
  if (embed.kind === "tiktok") return <TikTokEmbed url={embed.url} videoId={embed.id} />;
  return null;
}

// Texte d'un post : liens cliquables, URLs d'embed retirées, sauts de ligne gardés.
export function PostText({ text, hide, mentions }) {
  if (!text) return null;
  let t = text;
  hide.forEach((u) => {
    t = t.split(u).join("");
  });
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) return null;
  return <p className="gm-text">{renderMessage(t, mentions)}</p>;
}

// ============================================================
//  Composant principal — fil vertical façon Twitter
// ============================================================
export default function GameMediaWall({ gameId, gameName, gameCover, token }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("recent"); // recent | top
  const [revealAll, setRevealAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/game-media/game/${gameId}`, { token })
      .then((d) => alive && setPosts(d.posts || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  const requireLogin = useCallback(() => {
    if (user) return true;
    navigate("/login");
    return false;
  }, [user, navigate]);

  const addPost = (post) => setPosts((prev) => [post, ...(prev || [])]);
  const removePost = (id) => setPosts((prev) => (prev || []).filter((p) => p.id !== id));
  const patchPost = (id, patch) =>
    setPosts((prev) => (prev || []).map((p) => (p.id === id ? { ...p, ...patch } : p)));

  async function toggleLike(id) {
    if (!requireLogin()) return;
    const cur = (posts || []).find((p) => p.id === id);
    if (!cur) return;
    patchPost(id, { liked: !cur.liked, likeCount: cur.likeCount + (cur.liked ? -1 : 1) });
    try {
      const d = await apiFetch(`/game-media/${id}/like`, { method: "POST", token });
      patchPost(id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchPost(id, { liked: cur.liked, likeCount: cur.likeCount });
    }
  }

  async function deletePost(id) {
    if (!confirm("Supprimer ce post ?")) return;
    removePost(id);
    try {
      await apiFetch(`/game-media/${id}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  const shown = useMemo(() => {
    const list = [...(posts || [])];
    if (sort === "top")
      list.sort((a, b) => b.likeCount - a.likeCount || new Date(b.createdAt) - new Date(a.createdAt));
    else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }, [posts, sort]);

  const hasSpoilers = (posts || []).some((p) => p.media?.some((m) => m.spoiler));

  return (
    <div className="gm-wall">
      <Composer
        gameId={gameId}
        gameName={gameName}
        gameCover={gameCover}
        token={token}
        user={user}
        requireLogin={requireLogin}
        onPosted={addPost}
      />

      {(posts?.length > 0 || loading) && (
        <div className="gm-toolbar">
          {hasSpoilers ? (
            <button
              className={`gm-chip clickable ${revealAll ? "active" : ""}`}
              onClick={() => setRevealAll((v) => !v)}
              title={revealAll ? "Re-masquer les spoilers" : "Afficher les spoilers"}
            >
              {revealAll ? <Eye size={14} /> : <EyeOff size={14} />} Spoilers
            </button>
          ) : (
            <span />
          )}
          <div className="gm-sort">
            <button
              className={`gm-sort-opt clickable ${sort === "recent" ? "active" : ""}`}
              onClick={() => setSort("recent")}
            >
              <Clock3 size={14} /> Récents
            </button>
            <button
              className={`gm-sort-opt clickable ${sort === "top" ? "active" : ""}`}
              onClick={() => setSort("top")}
            >
              <Flame size={14} /> Populaires
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="gm-loading">
          <Loader2 size={22} className="spin" />
        </div>
      ) : error ? (
        <div className="gm-empty">
          <AlertTriangle size={26} />
          <p className="font-fun">{error}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="gm-empty">
          <Camera size={30} />
          <p className="font-fun">
            Rien ici pour l'instant — lance la discussion avec un screen, un clip ou juste un mot !
          </p>
        </div>
      ) : (
        <div className="gm-feed">
          {shown.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              token={token}
              forceReveal={revealAll}
              onLike={() => toggleLike(post.id)}
              onLikeById={toggleLike}
              onDelete={() => deletePost(post.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Composer d'un post
// ============================================================
function Composer({ gameId, gameName, gameCover, token, user, requireLogin, onPosted }) {
  const [text, setText] = useState("");
  const [mediaList, setMediaList] = useState([]); // {kind,url,thumbnail?,width?,height?,spoiler}
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [videoEdit, setVideoEdit] = useState(null); // fichier vidéo en cours d'édition
  // Autocomplétion des mentions @ (même logique que le composer des commentaires).
  const [mention, setMention] = useState(null); // { start, query }
  const [suggestions, setSuggestions] = useState([]);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [validMentions, setValidMentions] = useState(() => new Set());
  const mentionCache = useRef(new Map());
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const hlRef = useRef(null); // calque de coloration des liens/mentions, derrière le textarea

  const slotsLeft = MAX_MEDIA - mediaList.length;
  const full = slotsLeft <= 0;
  const canSend = (text.trim() || mediaList.length) && !busy && !uploading;

  // Auto-agrandissement du champ + synchro du calque de liens.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    if (hlRef.current) hlRef.current.scrollTop = el.scrollTop;
  }, [text]);

  function syncScroll() {
    if (hlRef.current && inputRef.current)
      hlRef.current.scrollTop = inputRef.current.scrollTop;
  }

  const liveEmbeds = useMemo(() => extractEmbeds(text).embeds, [text]);

  // Mémorise l'existence d'un pseudo (et le colore si existant).
  const markMention = useCallback((name, exists) => {
    const key = name.toLowerCase();
    if (mentionCache.current.get(key) === exists) return;
    mentionCache.current.set(key, exists);
    if (exists) setValidMentions((prev) => new Set(prev).add(key));
  }, []);

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
          (d.users || []).forEach((u) => markMention(u.username, true));
        })
        .catch(() => setSuggestions([]));
    }, 180);
    return () => clearTimeout(t);
  }, [mentionQuery, token, markMention]);

  // Valide (débouncé) tous les @tokens du texte pour ne colorer que les
  // pseudos existants — y compris ceux collés directement.
  useEffect(() => {
    const tokens = [
      ...new Set([...text.matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)].map((m) => m[1])),
    ].filter((tk) => !mentionCache.current.has(tk.toLowerCase()));
    if (!tokens.length) return;
    const timer = setTimeout(() => {
      tokens.forEach(async (tk) => {
        try {
          const d = await apiFetch(`/users/search/mentions?q=${encodeURIComponent(tk)}`, {
            token,
          });
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

  async function uploadFiles(fileList) {
    if (!requireLogin()) return;
    const files = [...(fileList || [])]
      .filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))
      .slice(0, slotsLeft);
    if (!files.length) return;
    setError(null);
    setUploading(true);
    setEmojiOpen(false);
    setGifOpen(false);
    try {
      const uploaded = await Promise.all(
        files.map(async (f) => {
          const fd = new FormData();
          fd.append("media", f);
          const { media } = await apiUpload("/game-media/upload", fd, token);
          return { ...media, spoiler: false };
        })
      );
      setMediaList((prev) => [...prev, ...uploaded].slice(0, MAX_MEDIA));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

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

  // Une vidéo seule → passe par le mini-éditeur (rogner / son / musique /
  // compression) avant l'upload. Sinon (images, ou sélection multiple) : direct.
  function onFilesChosen(fileList) {
    const files = [...(fileList || [])];
    if (files.length === 1 && files[0].type.startsWith("video/")) {
      if (!requireLogin()) return;
      setVideoEdit(files[0]);
      return;
    }
    uploadFiles(files);
  }

  function toggleSpoiler(i) {
    setMediaList((prev) => prev.map((m, k) => (k === i ? { ...m, spoiler: !m.spoiler } : m)));
  }
  function removeMedia(i) {
    setMediaList((prev) => prev.filter((_, k) => k !== i));
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

  async function submit() {
    if (!canSend) return;
    if (!requireLogin()) return;
    setBusy(true);
    setError(null);
    try {
      const { post } = await apiFetch(`/game-media/game/${gameId}`, {
        method: "POST",
        token,
        body: { text: text.trim(), media: mediaList, gameName, gameCover },
      });
      onPosted(post);
      setText("");
      setMediaList([]);
      setEmojiOpen(false);
      setGifOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const initial = (user?.username || "?")[0]?.toUpperCase();

  return (
    <div className="gm-composer">
      <div className="gm-composer-row">
        <div className="gm-composer-av">{user?.avatar ? <img src={user.avatar} alt="" /> : initial}</div>
        <div className="gm-composer-main">
          {/* Calque derrière le textarea : mentions et liens s'affichent
              colorés pendant la frappe (le texte du textarea est transparent). */}
          <div className="gm-input-field">
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
                      {u.avatar ? <img src={u.avatar} alt="" /> : (u.username[0] || "?").toUpperCase()}
                    </span>
                    <span className="lc-mention-name">{u.username}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="gm-input-hl" ref={hlRef} aria-hidden="true">
              {renderHighlight(text, validMentions)}
              {"​"}
            </div>
            <textarea
              ref={inputRef}
              className="gm-composer-input"
              value={text}
              maxLength={MAX_TEXT}
              rows={1}
              placeholder="Quelque chose à partager ? Un screenshot, un clip, ou même un lien... Fais vivre ce thread pour garder un souvenir de ton aventure sur ce jeu !"
              onChange={onChangeText}
              onPaste={onPaste}
              onScroll={syncScroll}
              onKeyDown={(e) => {
                if (!mentionOpen) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIdx((i) => (i + 1) % suggestions.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(suggestions[mentionIdx]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                }
              }}
            />
          </div>

          {/* Médias attachés — chacun avec son toggle spoiler */}
          {(mediaList.length > 0 || uploading) && (
            <div className="gm-attach">
              {mediaList.map((m, i) => (
                <div className={`gm-attach-item ${m.spoiler ? "spoiler" : ""}`} key={i}>
                  {m.kind === "video" ? (
                    <video src={m.url} muted playsInline />
                  ) : (
                    <img src={m.url} alt="" />
                  )}
                  <div className="gm-attach-actions">
                    <button
                      type="button"
                      className={`gm-attach-btn ${m.spoiler ? "on" : ""}`}
                      onClick={() => toggleSpoiler(i)}
                      title={m.spoiler ? "Retirer le spoiler" : "Marquer comme spoiler"}
                    >
                      {m.spoiler ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      type="button"
                      className="gm-attach-btn"
                      onClick={() => removeMedia(i)}
                      title="Retirer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {m.spoiler && <span className="gm-attach-tag">Spoiler</span>}
                  {m.kind === "video" && <span className="gm-attach-play"><Play size={14} fill="currentColor" /></span>}
                </div>
              ))}
              {uploading && (
                <div className="gm-attach-item gm-attach-loading">
                  <Loader2 size={18} className="spin" />
                </div>
              )}
            </div>
          )}

          {/* Aperçu discret des liens qui deviendront des embeds */}
          {liveEmbeds.length > 0 && (
            <div className="gm-embed-hint">
              {liveEmbeds.map((e, i) => (
                <span className="gm-embed-chip" key={i}>
                  {e.kind === "youtube" ? <YouTubeMark size={13} /> : e.kind === "tiktok" ? <TikTokMark size={13} /> : <XMark size={13} />}
                  {e.kind === "youtube" ? "YouTube" : e.kind === "tiktok" ? "TikTok" : "Post X"} intégré
                </span>
              ))}
            </div>
          )}

          {error && <p className="gm-error">{error}</p>}

          {emojiOpen && (
            <div className="gm-pop">
              <EmojiPanel onPick={insertEmoji} />
            </div>
          )}
          {gifOpen && (
            <GifPicker
              token={token}
              onPick={(g) => {
                setMediaList((prev) =>
                  [...prev, { kind: "gif", url: g.url, width: g.width, height: g.height, spoiler: false }].slice(0, MAX_MEDIA)
                );
                setGifOpen(false);
              }}
              onClose={() => setGifOpen(false)}
            />
          )}

          <div className="gm-composer-bar">
            <div className="gm-composer-tools">
              <button
                type="button"
                className="gm-tool clickable"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || full}
                title={full ? "8 médias maximum" : "Image ou vidéo"}
              >
                {uploading ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
              </button>
              <button
                type="button"
                className={`gm-tool gm-tool-gif clickable ${gifOpen ? "on" : ""}`}
                onClick={() => {
                  setGifOpen((v) => !v);
                  setEmojiOpen(false);
                }}
                disabled={full}
                title={full ? "8 médias maximum" : "GIF"}
              >
                GIF
              </button>
              <button
                type="button"
                className={`gm-tool clickable ${emojiOpen ? "on" : ""}`}
                onClick={() => {
                  setEmojiOpen((v) => !v);
                  setGifOpen(false);
                }}
                title="Émoji"
              >
                <Smile size={18} />
              </button>
              {mediaList.length > 0 && <span className="gm-media-count">{mediaList.length}/{MAX_MEDIA}</span>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  onFilesChosen(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <button type="button" className="gm-post clickable" onClick={submit} disabled={!canSend}>
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={15} />}
              <span>Publier</span>
            </button>
          </div>
        </div>
      </div>

      {videoEdit && (
        <VideoEditorModal
          file={videoEdit}
          token={token}
          onCancel={() => setVideoEdit(null)}
          onDone={(f) => {
            setVideoEdit(null);
            uploadFiles([f]);
          }}
          onRendered={(m) => {
            // Le serveur a déjà monté/compressé le clip : on l'attache tel quel.
            setVideoEdit(null);
            setMediaList((prev) => [...prev, { ...m, spoiler: false }].slice(0, MAX_MEDIA));
          }}
        />
      )}
    </div>
  );
}

// ============================================================
//  Bouton « Partager » d'un post à clip : copie le lien public /clip/:id.
//  Collé sur Discord & co, le lien s'embed avec le lecteur vidéo (balises
//  Open Graph rendues côté serveur, cf. server/src/routes/share.js).
//  Exporté : les cards du fil d'accueil (FeedCards) l'utilisent aussi.
// ============================================================
export function SharePostButton({ post, className = "gm-act", size = 17 }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}/clip/${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Repli (vieux navigateurs / contexte non sécurisé)
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      className={`${className} clickable ${copied ? "on" : ""}`}
      onClick={share}
      title="Copier le lien du clip"
    >
      {copied ? <Check size={size} /> : <Share2 size={size} />}
      {copied && <span>Copié !</span>}
    </button>
  );
}

// ============================================================
//  Carte d'un post
// ============================================================
function PostCard({ post, token, forceReveal, onLike, onLikeById, onDelete }) {
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.commentCount || 0);
  const [lightbox, setLightbox] = useState(null); // index dans post.media

  const { embeds, hide } = useMemo(() => extractEmbeds(post.text), [post.text]);
  const media = post.media || [];

  return (
    <article className="gm-postcard">
      <div className="gm-post-av">
        {post.author?.username ? (
          <Link to={`/u/${post.author.username}`}>
            {post.author.avatar ? <img src={post.author.avatar} alt="" /> : (post.author.username[0] || "?").toUpperCase()}
          </Link>
        ) : post.author?.avatar ? (
          <img src={post.author.avatar} alt="" />
        ) : (
          "?"
        )}
      </div>
      <div className="gm-post-main">
        <div className="gm-post-head">
          {post.author?.username ? (
            <Link to={`/u/${post.author.username}`} className="gm-post-name">
              {post.author.username}
            </Link>
          ) : (
            <span className="gm-post-name">—</span>
          )}
          <span className="gm-post-dot">·</span>
          <span className="gm-post-time">{timeAgo(post.createdAt)}</span>
          {post.mine && (
            <button className="gm-post-del clickable" onClick={onDelete} title="Supprimer">
              <Trash2 size={15} />
            </button>
          )}
        </div>

        <PostText text={post.text} hide={hide} mentions={post.mentions} />

        {media.length > 0 && (
          <MediaGrid media={media} forceReveal={forceReveal} onOpen={(i) => setLightbox(i)} />
        )}

        {embeds.map((e, i) => (
          <PostEmbed key={i} embed={e} />
        ))}

        <div className="gm-post-actions">
          <button className={`gm-act clickable ${post.liked ? "liked" : ""}`} onClick={onLike} title="J'aime">
            <Heart size={17} fill={post.liked ? "currentColor" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
          <button
            className={`gm-act clickable ${showComments ? "on" : ""}`}
            onClick={() => setShowComments((v) => !v)}
            title="Répondre"
          >
            <MessageCircle size={17} />
            {commentCount > 0 && <span>{commentCount}</span>}
          </button>
          {media.some((m) => m.kind === "video") && <SharePostButton post={post} />}
        </div>

        {showComments && (
          <div className="gm-post-comments">
            <CommentThread
              base={`/game-media/${post.id}`}
              comments={post.comments || []}
              moderatorMine={post.mine}
              token={token}
              title={null}
              placeholder="Écris une réponse…"
              emptyText="Aucune réponse — sois le premier !"
              onCountChange={setCommentCount}
            />
          </div>
        )}
      </div>

      {lightbox != null && media[lightbox] && (
        <Lightbox
          media={media}
          index={lightbox}
          post={post}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          onLike={() => onLikeById(post.id)}
        />
      )}
    </article>
  );
}

// Grille des médias d'un post (façon Twitter) — spoiler par média.
// Exportée : le fil d'accueil (FeedCards) rend les posts pareil.
export function MediaGrid({ media, forceReveal, onOpen }) {
  const n = media.length;
  const cls = n === 1 ? "n-1" : n === 2 ? "n-2" : n === 3 ? "n-3" : "n-4";
  return (
    <div className={`gm-media-grid ${cls}`}>
      {media.map((m, i) => (
        <MediaTile key={i} m={m} forceReveal={forceReveal} onOpen={() => onOpen(i)} />
      ))}
    </div>
  );
}

function MediaTile({ m, forceReveal, onOpen }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = m.spoiler && !revealed && !forceReveal;
  const blur = hidden ? { filter: "blur(24px)", pointerEvents: "none" } : undefined;

  return (
    <div className={`gm-tile ${hidden ? "is-hidden" : ""}`}>
      {m.kind === "video" ? (
        <div style={blur} className="gm-tile-video">
          <GameVideoPlayer src={m.url} poster={m.thumbnail || undefined} />
        </div>
      ) : (
        <button type="button" className="gm-tile-btn" onClick={() => !hidden && onOpen()} tabIndex={hidden ? -1 : 0}>
          <img src={m.url} alt="" loading="lazy" style={blur} />
          {m.kind === "gif" && !hidden && <span className="gm-gif-tag">GIF</span>}
        </button>
      )}
      {hidden && (
        <button type="button" className="gm-spoiler-veil clickable" onClick={() => setRevealed(true)}>
          <EyeOff size={20} />
          <b>Spoiler</b>
          <span>Révéler</span>
        </button>
      )}
    </div>
  );
}

// ============================================================
//  Recherche de GIF (proxy GIPHY des listes)
// ============================================================
function GifPicker({ token, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const id = ++reqRef.current;
      setLoading(true);
      const path = q.trim() ? `/lists/gifs?q=${encodeURIComponent(q.trim())}` : "/lists/gifs";
      apiFetch(path, { token })
        .then((d) => id === reqRef.current && setGifs(d.gifs || []))
        .catch(() => id === reqRef.current && setGifs([]))
        .finally(() => id === reqRef.current && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, token]);

  return (
    <div className="gm-gifpanel">
      <div className="gm-gifpanel-head">
        <label className="gm-gifsearch">
          <Search size={15} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un GIF…" />
          {loading && <Loader2 size={14} className="spin" />}
        </label>
        <button className="gm-gifclose clickable" onClick={onClose} aria-label="Fermer">
          <X size={16} />
        </button>
      </div>
      <div className="gm-gifgrid">
        {gifs.map((g) => (
          <button key={g.id} type="button" className="gm-gif clickable" onClick={() => onPick(g)}>
            <img src={g.preview} alt={g.desc} loading="lazy" />
          </button>
        ))}
        {!loading && gifs.length === 0 && <p className="gm-gifempty">Aucun GIF.</p>}
      </div>
    </div>
  );
}

// ============================================================
//  Lightbox (médias d'un post) — exportée : réutilisée par FeedCards
//  (fil d'accueil / profil) pour ouvrir les images en grand.
// ============================================================
export function Lightbox({ media, index, post, onIndex, onClose, onLike }) {
  const item = media[index];
  const step = useCallback(
    (dir) => {
      if (media.length < 2) return;
      onIndex((index + dir + media.length) % media.length);
    },
    [media.length, index, onIndex]
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, step]);

  if (!item) return null;

  return createPortal(
    <div className="gm-lb" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="gm-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      {media.length > 1 && (
        <button className="gm-lb-nav prev clickable" onClick={() => step(-1)} aria-label="Précédent">
          <ChevronLeft size={28} />
        </button>
      )}
      <div className="gm-lb-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {item.kind === "video" ? (
          <GameVideoPlayer className="gm-lb-media gm-lb-player" src={item.url} autoPlay />
        ) : (
          <img className="gm-lb-media" src={item.url} alt="" />
        )}
        <div className="gm-lb-bar">
          <div className="gm-lb-user">
            {post.author?.username && (
              <Link to={`/u/${post.author.username}`} onClick={onClose} className="gm-lb-name">
                @{post.author.username}
              </Link>
            )}
            {media.length > 1 && <span className="gm-lb-caption">{index + 1} / {media.length}</span>}
          </div>
          <button className={`gm-act clickable ${post.liked ? "liked" : ""}`} onClick={onLike}>
            <Heart size={16} fill={post.liked ? "currentColor" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
        </div>
      </div>
      {media.length > 1 && (
        <button className="gm-lb-nav next clickable" onClick={() => step(1)} aria-label="Suivant">
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body
  );
}
