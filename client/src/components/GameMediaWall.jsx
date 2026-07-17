import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2,
  ImagePlus,
  Film,
  ImageIcon,
  Link2,
  Send,
  X,
  Heart,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  Sparkles,
  Flame,
  Clock3,
  AtSign,
  ExternalLink,
  Play,
  Search,
  ChevronLeft,
  ChevronRight,
  Camera,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

const MAX_CAPTION = 600;

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

const KIND_META = {
  youtube: { label: "YouTube", Mark: YouTubeMark, color: "#ff0033" },
  twitter: { label: "Post X", Mark: XMark, color: "#111" },
  tiktok: { label: "TikTok", Mark: TikTokMark, color: "#111" },
  link: { label: "Lien", Mark: () => <Link2 size={18} />, color: "#5b6472" },
};

// Filtres du mur (regroupent plusieurs `kind`).
const FILTERS = [
  { id: "all", label: "Tout", Icon: Sparkles },
  { id: "image", label: "Images", Icon: ImageIcon, kinds: ["image", "gif"] },
  { id: "video", label: "Vidéos", Icon: Film, kinds: ["video", "youtube"] },
  { id: "social", label: "Réseaux", Icon: AtSign, kinds: ["twitter", "tiktok", "link"] },
];

const LIGHTBOXABLE = new Set(["image", "gif", "video"]);

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
// TikTok : embed.js scanne le document AU chargement. On ré-injecte le script
// pour forcer un nouveau scan quand un embed est monté après coup.
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

// Carte de repli quand l'embed ne charge pas (ou pour le type « link »).
function LinkCard({ url, kind }) {
  const meta = KIND_META[kind] || KIND_META.link;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* garde l'url brute */
  }
  return (
    <a className="gm-linkcard" href={url} target="_blank" rel="noreferrer noopener">
      <span className="gm-linkcard-ic" style={{ background: meta.color }}>
        <meta.Mark size={20} />
      </span>
      <span className="gm-linkcard-txt">
        <b>{meta.label}</b>
        <span>{host}</span>
      </span>
      <ExternalLink size={16} className="gm-linkcard-go" />
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

// Tweet / post X embarqué.
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
  if (failed) return <LinkCard url={url} kind="twitter" />;
  return (
    <div className="gm-embed gm-embed-tw">
      <div ref={ref} className="gm-embed-host" />
      {!ready && <EmbedSkeleton />}
    </div>
  );
}

// Vidéo TikTok embarquée.
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
  if (failed) return <LinkCard url={url} kind="tiktok" />;
  return (
    <div className="gm-embed gm-embed-tk">
      <div ref={ref} className="gm-embed-host" />
    </div>
  );
}

// Aperçu YouTube cliquable → iframe (comme les commentaires).
function YouTubeEmbed({ id, blurred }) {
  const [play, setPlay] = useState(false);
  if (play && !blurred)
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
    <button
      type="button"
      className="gm-yt gm-yt-preview"
      onClick={() => !blurred && setPlay(true)}
      aria-label="Lire la vidéo"
      tabIndex={blurred ? -1 : 0}
    >
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
      <span className="gm-yt-play">
        <Play size={26} fill="currentColor" />
      </span>
    </button>
  );
}

// Légende : liens cliquables, reste en texte brut.
const URL_RE = /(https?:\/\/[^\s]+)/g;
function Caption({ text }) {
  if (!text) return null;
  return (
    <p className="gm-caption">
      {text.split(URL_RE).map((part, i) =>
        URL_RE.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="gm-caption-link">
            {part.replace(/^https?:\/\//, "").slice(0, 46)}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

// ============================================================
//  Composant principal
// ============================================================
export default function GameMediaWall({ gameId, gameName, token }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [posts, setPosts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("recent"); // recent | top
  const [filter, setFilter] = useState("all");
  const [revealAll, setRevealAll] = useState(false);
  const [viewer, setViewer] = useState(null); // { index } dans la liste lightboxable

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

  function addPost(post) {
    setPosts((prev) => [post, ...(prev || [])]);
  }
  function removePost(id) {
    setPosts((prev) => (prev || []).filter((p) => p.id !== id));
  }
  function patchPost(id, patch) {
    setPosts((prev) => (prev || []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function toggleLike(id) {
    if (!requireLogin()) return;
    const cur = posts.find((p) => p.id === id);
    if (!cur) return;
    patchPost(id, {
      liked: !cur.liked,
      likeCount: cur.likeCount + (cur.liked ? -1 : 1),
    });
    try {
      const d = await apiFetch(`/game-media/${id}/like`, { method: "POST", token });
      patchPost(id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchPost(id, { liked: cur.liked, likeCount: cur.likeCount });
    }
  }

  async function deletePost(id) {
    if (!confirm("Supprimer ce média ?")) return;
    removePost(id);
    try {
      await apiFetch(`/game-media/${id}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  // Tri + filtre en mémoire (snappy, pas de refetch).
  const shown = useMemo(() => {
    let list = [...(posts || [])];
    const f = FILTERS.find((x) => x.id === filter);
    if (f?.kinds) list = list.filter((p) => f.kinds.includes(p.media.kind));
    if (sort === "top")
      list.sort(
        (a, b) => b.likeCount - a.likeCount || new Date(b.createdAt) - new Date(a.createdAt)
      );
    else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }, [posts, filter, sort]);

  // Sous-ensemble ouvrable en lightbox (images / gifs / vidéos), dans l'ordre affiché.
  const lightboxList = useMemo(
    () => shown.filter((p) => LIGHTBOXABLE.has(p.media.kind)),
    [shown]
  );
  const openViewer = useCallback(
    (post) => {
      const idx = lightboxList.findIndex((p) => p.id === post.id);
      if (idx >= 0) setViewer({ index: idx });
    },
    [lightboxList]
  );

  const counts = useMemo(() => {
    const c = { all: (posts || []).length };
    FILTERS.forEach((f) => {
      if (f.kinds) c[f.id] = (posts || []).filter((p) => f.kinds.includes(p.media.kind)).length;
    });
    return c;
  }, [posts]);

  const hasSpoilers = (posts || []).some((p) => p.spoiler);

  return (
    <div className="gm-wall">
      <Composer
        gameId={gameId}
        gameName={gameName}
        token={token}
        user={user}
        requireLogin={requireLogin}
        onPosted={addPost}
      />

      {/* Barre d'outils : filtres + tri + spoilers */}
      {(posts?.length > 0 || loading) && (
        <div className="gm-toolbar">
          <div className="gm-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`gm-chip clickable ${filter === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                <f.Icon size={14} /> {f.label}
                {f.id !== "all" && counts[f.id] > 0 && (
                  <span className="gm-chip-count">{counts[f.id]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="gm-toolbar-right">
            {hasSpoilers && (
              <button
                className={`gm-chip clickable ${revealAll ? "active" : ""}`}
                onClick={() => setRevealAll((v) => !v)}
                title={revealAll ? "Re-masquer les spoilers" : "Afficher les spoilers"}
              >
                {revealAll ? <Eye size={14} /> : <EyeOff size={14} />}
                Spoilers
              </button>
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
            {posts?.length
              ? "Aucun média dans ce filtre."
              : "Aucun média pour l'instant — sois le premier à partager un screen ou un clip !"}
          </p>
        </div>
      ) : (
        <div className="gm-grid">
          {shown.map((post) => (
            <MediaCard
              key={post.id}
              post={post}
              forceReveal={revealAll}
              onLike={() => toggleLike(post.id)}
              onDelete={() => deletePost(post.id)}
              onOpen={() => openViewer(post)}
            />
          ))}
        </div>
      )}

      {viewer && lightboxList[viewer.index] && (
        <Lightbox
          list={lightboxList}
          index={viewer.index}
          onIndex={(i) => setViewer({ index: i })}
          onClose={() => setViewer(null)}
          onLike={toggleLike}
        />
      )}
    </div>
  );
}

// ============================================================
//  Composer (publier un média)
// ============================================================
function Composer({ gameId, gameName, token, user, requireLogin, onPosted }) {
  const [media, setMedia] = useState(null); // média attaché/détecté
  const [caption, setCaption] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  function reset() {
    setMedia(null);
    setCaption("");
    setSpoiler(false);
    setLinkOpen(false);
    setLinkUrl("");
    setGifOpen(false);
    setError(null);
  }

  async function onUpload(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    if (!requireLogin()) return;
    setError(null);
    setUploading(true);
    setGifOpen(false);
    setLinkOpen(false);
    try {
      const fd = new FormData();
      fd.append("media", file);
      const { media: m } = await apiUpload("/game-media/upload", fd, token);
      setMedia(m);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  // Détection du lien collé (débouncé).
  useEffect(() => {
    const url = linkUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    setDetecting(true);
    const t = setTimeout(() => {
      apiFetch(`/game-media/detect?url=${encodeURIComponent(url)}`, { token })
        .then((d) => {
          setMedia(d.media);
          setLinkOpen(false);
          setLinkUrl("");
        })
        .catch(() => setError("Lien non reconnu."))
        .finally(() => setDetecting(false));
    }, 500);
    return () => {
      clearTimeout(t);
      setDetecting(false);
    };
  }, [linkUrl, token]);

  async function submit() {
    if (!media || busy) return;
    if (!requireLogin()) return;
    setBusy(true);
    setError(null);
    try {
      const { post } = await apiFetch(`/game-media/game/${gameId}`, {
        method: "POST",
        token,
        body: { media, caption: caption.trim(), spoiler, gameName },
      });
      onPosted(post);
      reset();
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
        <div className="gm-composer-av">
          {user?.avatar ? <img src={user.avatar} alt="" /> : initial}
        </div>
        <div className="gm-composer-main">
          {/* Aperçu du média attaché */}
          {media && (
            <div className={`gm-preview ${spoiler ? "spoiler" : ""}`}>
              <ComposerPreview media={media} />
              {spoiler && <span className="gm-preview-spoiler">Spoiler</span>}
              <button
                type="button"
                className="gm-preview-remove clickable"
                onClick={() => setMedia(null)}
                aria-label="Retirer"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* Saisie de lien */}
          {linkOpen && !media && (
            <div className="gm-linkinput">
              <Link2 size={16} />
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Colle un lien YouTube, X, TikTok ou une image…"
              />
              {detecting && <Loader2 size={15} className="spin" />}
            </div>
          )}

          <textarea
            className="gm-composer-input"
            value={caption}
            maxLength={MAX_CAPTION}
            rows={media ? 2 : 1}
            placeholder={media ? "Ajoute une légende (optionnel)…" : "Partage un screen marrant, un clip rigolo…"}
            onChange={(e) => setCaption(e.target.value)}
          />

          {error && <p className="gm-error">{error}</p>}

          {gifOpen && (
            <GifPicker
              token={token}
              onPick={(g) => {
                setMedia({ kind: "gif", url: g.url, width: g.width, height: g.height });
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
                disabled={uploading}
                title="Image ou vidéo"
              >
                {uploading ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
              </button>
              <button
                type="button"
                className={`gm-tool clickable ${linkOpen ? "on" : ""}`}
                onClick={() => {
                  setLinkOpen((v) => !v);
                  setGifOpen(false);
                }}
                title="Coller un lien (YouTube, X, TikTok…)"
              >
                <Link2 size={18} />
              </button>
              <button
                type="button"
                className={`gm-tool gm-tool-gif clickable ${gifOpen ? "on" : ""}`}
                onClick={() => {
                  setGifOpen((v) => !v);
                  setLinkOpen(false);
                }}
                title="GIF"
              >
                GIF
              </button>
              <button
                type="button"
                className={`gm-tool gm-spoiler-toggle clickable ${spoiler ? "on" : ""}`}
                onClick={() => setSpoiler((v) => !v)}
                title="Marquer comme spoiler"
              >
                {spoiler ? <EyeOff size={16} /> : <Eye size={16} />}
                <span>Spoiler</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => {
                  onUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <button
              type="button"
              className="gm-post clickable"
              onClick={submit}
              disabled={!media || busy}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={15} />}
              <span>Publier</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Aperçu compact du média dans le composer.
function ComposerPreview({ media }) {
  if (media.kind === "image" || media.kind === "gif")
    return <img className="gm-preview-img" src={media.url} alt="" />;
  if (media.kind === "video")
    return <video className="gm-preview-img" src={media.url} muted playsInline />;
  if (media.kind === "youtube")
    return (
      <div className="gm-preview-embed">
        <img src={media.thumbnail || `https://i.ytimg.com/vi/${media.embedId}/hqdefault.jpg`} alt="" />
        <span className="gm-preview-badge" style={{ background: KIND_META.youtube.color }}>
          <YouTubeMark size={16} /> YouTube
        </span>
      </div>
    );
  const meta = KIND_META[media.kind] || KIND_META.link;
  return (
    <div className="gm-preview-chip">
      <span className="gm-preview-chip-ic" style={{ background: meta.color }}>
        <meta.Mark size={18} />
      </span>
      <span>{meta.label} prêt à publier</span>
    </div>
  );
}

// ============================================================
//  Carte d'un média
// ============================================================
function MediaCard({ post, forceReveal, onLike, onDelete, onOpen }) {
  const [revealed, setRevealed] = useState(false);
  const hidden = post.spoiler && !revealed && !forceReveal;

  return (
    <div className={`gm-card ${hidden ? "is-hidden" : ""}`}>
      <div className="gm-card-media">
        <MediaBody post={post} blurred={hidden} onOpen={onOpen} />
        {hidden && (
          <button
            type="button"
            className="gm-spoiler-veil clickable"
            onClick={() => setRevealed(true)}
          >
            <EyeOff size={22} />
            <b>Spoiler</b>
            <span>Cliquer pour révéler</span>
          </button>
        )}
      </div>

      <div className="gm-card-foot">
        <div className="gm-card-user">
          <div className="gm-card-av">
            {post.author?.avatar ? (
              <img src={post.author.avatar} alt="" />
            ) : (
              (post.author?.username || "?")[0]?.toUpperCase()
            )}
          </div>
          <div className="gm-card-meta">
            {post.author?.username ? (
              <Link to={`/u/${post.author.username}`} className="gm-card-name">
                {post.author.username}
              </Link>
            ) : (
              <span className="gm-card-name">—</span>
            )}
            <span className="gm-card-time">{timeAgo(post.createdAt)}</span>
          </div>
          <div className="gm-card-actions">
            <button
              className={`gm-like clickable ${post.liked ? "liked" : ""}`}
              onClick={onLike}
              title="J'aime"
            >
              <Heart size={16} fill={post.liked ? "currentColor" : "none"} />
              {post.likeCount > 0 && <span>{post.likeCount}</span>}
            </button>
            {post.mine && (
              <button className="gm-del clickable" onClick={onDelete} title="Supprimer">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
        {post.caption && <Caption text={post.caption} />}
      </div>
    </div>
  );
}

// Rendu du média selon son type.
function MediaBody({ post, blurred, onOpen }) {
  const { kind, url, embedId } = post.media;
  const style = blurred ? { filter: "blur(26px)", pointerEvents: "none" } : undefined;

  if (kind === "image" || kind === "gif")
    return (
      <button
        type="button"
        className="gm-imgbtn"
        onClick={() => !blurred && onOpen()}
        tabIndex={blurred ? -1 : 0}
      >
        <img src={url} alt={post.caption || ""} loading="lazy" style={style} />
        {kind === "gif" && !blurred && <span className="gm-gif-tag">GIF</span>}
      </button>
    );

  if (kind === "video")
    return (
      <div className="gm-video" style={style}>
        <video src={url} controls preload="metadata" playsInline />
      </div>
    );

  if (kind === "youtube")
    return (
      <div style={style}>
        <YouTubeEmbed id={embedId} blurred={blurred} />
      </div>
    );

  if (kind === "twitter")
    return (
      <div style={style}>
        <TwitterEmbed url={url} />
      </div>
    );

  if (kind === "tiktok")
    return (
      <div style={style}>
        <TikTokEmbed url={url} videoId={embedId} />
      </div>
    );

  return (
    <div style={style}>
      <LinkCard url={url} kind={kind} />
    </div>
  );
}

// ============================================================
//  Recherche de GIF (réutilise le proxy GIPHY des listes)
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
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un GIF…"
          />
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
//  Lightbox (images / gifs / vidéos)
// ============================================================
function Lightbox({ list, index, onIndex, onClose, onLike }) {
  const post = list[index];
  const step = useCallback(
    (dir) => {
      if (list.length < 2) return;
      onIndex((index + dir + list.length) % list.length);
    },
    [list.length, index, onIndex]
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

  if (!post) return null;
  const { kind, url } = post.media;

  return createPortal(
    <div className="gm-lb" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <button className="gm-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      {list.length > 1 && (
        <button className="gm-lb-nav prev clickable" onClick={() => step(-1)} aria-label="Précédent">
          <ChevronLeft size={28} />
        </button>
      )}
      <div className="gm-lb-stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {kind === "video" ? (
          <video className="gm-lb-media" src={url} controls autoPlay playsInline />
        ) : (
          <img className="gm-lb-media" src={url} alt={post.caption || ""} />
        )}
        <div className="gm-lb-bar">
          <div className="gm-lb-user">
            {post.author?.username && (
              <Link to={`/u/${post.author.username}`} onClick={onClose} className="gm-lb-name">
                @{post.author.username}
              </Link>
            )}
            {post.caption && <span className="gm-lb-caption">{post.caption}</span>}
          </div>
          <button
            className={`gm-like clickable ${post.liked ? "liked" : ""}`}
            onClick={() => onLike(post.id)}
          >
            <Heart size={16} fill={post.liked ? "currentColor" : "none"} />
            {post.likeCount > 0 && <span>{post.likeCount}</span>}
          </button>
        </div>
      </div>
      {list.length > 1 && (
        <button className="gm-lb-nav next clickable" onClick={() => step(1)} aria-label="Suivant">
          <ChevronRight size={28} />
        </button>
      )}
    </div>,
    document.body
  );
}
