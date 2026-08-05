import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Palette,
  MessageCircle,
  ExternalLink,
  X,
  Heart,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Repeat2,
  Camera,
  Check,
  Loader2,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import GameMediaWall from "./GameMediaWall";

// Onglet « Feed » d'un jeu : le fil des POSTS DES JOUEURS (GameMediaWall,
// texte + screens + clips + embeds) d'abord, puis « Découvrez quelques fan
// arts » (DeviantArt/Safebooru/Tumblr, agrégé côté serveur, cache 30 min) et
// les réactions Bluesky/Mastodon en rail. Les lives Twitch et vidéos YouTube
// ont été retirés (v3 du cache : nouvelle forme de données).
const feedCache = makeCache("mpl_feed3_", 30 * 60 * 1000);

function compact(n) {
  if (n == null) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function initial(s) {
  return (s || "?").trim()[0]?.toUpperCase() || "?";
}

// Hook : défilement horizontal à la souris (drag-to-scroll) + inertie native.
// Empêche le clic parasite en fin de drag.
function useDragScroll() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.pageX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e) => {
      if (!down) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 5) {
        moved = true;
        el.classList.add("dragging");
      }
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      down = false;
      el.classList.remove("dragging");
    };
    const onClick = (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
    };
  }, []);
  return ref;
}

export default function GameFeed({ gameId, gameName, altName, gameCover, token }) {
  const cached = feedCache.get(String(gameId));
  const [data, setData] = useState(cached?.data || null);
  const [artIndex, setArtIndex] = useState(null);
  // Fan arts déjà republiés sur mon feed (ids source), pour l'état des boutons.
  const [reposted, setReposted] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    setReposted(new Set());
    apiFetch(`/reposts/ids?gameId=${gameId}`, { token })
      .then((d) => alive && setReposted(new Set(d.ids || [])))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  // Toggle repost (optimiste).
  async function toggleRepost(item) {
    const was = reposted.has(item.id);
    const apply = (on) =>
      setReposted((s) => {
        const n = new Set(s);
        if (on) n.add(item.id);
        else n.delete(item.id);
        return n;
      });
    apply(!was);
    try {
      const r = await apiFetch("/reposts", {
        method: "POST",
        token,
        body: {
          item: {
            id: item.id,
            source: item.source,
            image: item.image,
            author: item.author,
            url: item.url,
            w: item.w,
            h: item.h,
          },
          game: { id: gameId, name: gameName },
        },
      });
      apply(!!r.reposted);
    } catch {
      apply(was);
    }
  }

  // Fan arts + réactions (agrégés côté serveur), chargés en fond : le fil des
  // posts s'affiche sans attendre.
  useEffect(() => {
    let alive = true;
    const c = feedCache.get(String(gameId));
    if (c) {
      setData(c.data);
      if (c.fresh) return;
    } else {
      setData(null);
    }
    const alt = altName && altName !== gameName ? `&alt=${encodeURIComponent(altName)}` : "";
    apiFetch(`/games/${gameId}/feed?name=${encodeURIComponent(gameName)}${alt}`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        feedCache.set(String(gameId), d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [gameId, gameName, altName, token]);

  const fanart = data?.fanart || [];
  const posts = data?.posts || [];

  return (
    <div className="gp-feed">
      {/* Les posts des joueurs — la pièce maîtresse de l'onglet */}
      <GameMediaWall gameId={gameId} gameName={gameName} gameCover={gameCover} token={token} />

      {/* Fin des posts : découverte de fan arts */}
      {fanart.length > 0 && (
        <section className="gp-fanart-sec gp-fanart-after">
          <h3 className="gp-feed-h3">
            <Palette size={16} /> Découvrez quelques fan arts
            <span className="gp-feed-count">{fanart.length}</span>
          </h3>
          <FanartFeed
            items={fanart}
            reposted={reposted}
            onRepost={toggleRepost}
            onOpen={setArtIndex}
          />
        </section>
      )}

      {/* Réactions Bluesky / Mastodon — rail horizontal en pied */}
      {posts.length > 0 && (
        <Rail title="Réactions" Icon={MessageCircle} count={posts.length}>
          {posts.map((p) => (
            <PostCard key={p.id} c={p} />
          ))}
        </Rail>
      )}

      {artIndex != null && (
        <FanartViewer
          items={fanart}
          start={artIndex}
          onClose={() => setArtIndex(null)}
          reposted={reposted}
          onRepost={toggleRepost}
          token={token}
        />
      )}
    </div>
  );
}

// Rail horizontal : en-tête + flèches + drag-to-scroll.
function Rail({ title, Icon, count, children }) {
  const ref = useDragScroll();
  const scroll = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className="gp-rail-sec">
      <div className="gp-rail-head">
        <h3 className="gp-feed-h3">
          {Icon && <Icon size={16} />}
          {title}
          {count > 0 && <span className="gp-feed-count">{count}</span>}
        </h3>
        <div className="gp-rail-nav">
          <button className="gp-rail-arrow clickable" onClick={() => scroll(-1)} aria-label="Précédent">
            <ChevronLeft size={18} />
          </button>
          <button className="gp-rail-arrow clickable" onClick={() => scroll(1)} aria-label="Suivant">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="gp-rail" ref={ref}>
        {children}
      </div>
    </section>
  );
}

function PostCard({ c }) {
  return (
    <a
      href={c.url}
      target="_blank"
      rel="noreferrer"
      className="gp-feed-card gp-feed-post gp-rail-item clickable"
    >
      <div className="gp-post-head">
        {c.avatar ? (
          <img className="gp-post-avatar" src={c.avatar} alt="" loading="lazy" />
        ) : (
          <span className="gp-post-avatar fb">{initial(c.author)}</span>
        )}
        <div className="gp-post-who">
          <span className="gp-post-author">{c.author}</span>
          {c.handle && <span className="gp-post-handle">@{c.handle}</span>}
        </div>
        <span className={`gp-post-src src-${c.source.toLowerCase()}`}>{c.source}</span>
      </div>
      {c.text && <p className="gp-post-text">{c.text}</p>}
      {c.image && (
        <div className="gp-post-img">
          <img src={c.image} alt="" loading="lazy" draggable="false" />
        </div>
      )}
      <div className="gp-post-foot">
        <span>
          <Heart size={13} /> {compact(c.likes)}
        </span>
        <span>
          <MessageCircle size={13} /> {compact(c.replies)}
        </span>
      </div>
    </a>
  );
}

// Fil vertical des fan arts : on ne MONTE que `ART_BATCH` cartes à la fois.
const ART_BATCH = 5;

function FanartFeed({ items, reposted, onRepost, onOpen }) {
  const [shown, setShown] = useState(ART_BATCH);
  const sentinelRef = useRef(null);

  useEffect(() => setShown(ART_BATCH), [items]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || shown >= items.length) return;
    const io = new IntersectionObserver(
      (entries) =>
        entries[0].isIntersecting &&
        setShown((n) => Math.min(n + ART_BATCH, items.length)),
      { rootMargin: "900px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, shown]);

  return (
    <div className="gp-art-feed">
      {items.slice(0, shown).map((a, i) => (
        <FanartPost
          key={a.id}
          c={a}
          onOpen={() => onOpen(i)}
          reposted={reposted.has(a.id)}
          onRepost={onRepost}
        />
      ))}
      <div ref={sentinelRef} className="gp-art-sentinel" aria-hidden="true" />
      {shown < items.length && (
        <div className="gp-art-feed-more">
          <Loader2 size={18} className="spin" />
        </div>
      )}
    </div>
  );
}

// Une œuvre du fil, façon tweet.
function FanartPost({ c, onOpen, reposted, onRepost }) {
  const src = c.source.toLowerCase();
  return (
    <article className="gp-artp">
      <header className="gp-artp-head">
        <span className={`gp-artp-avatar src-${src}`}>{initial(c.author || c.source)}</span>
        <div className="gp-artp-who">
          <span className="gp-artp-author" title={c.author}>
            {c.author || "Artiste mystère"}
          </span>
          <span className="gp-artp-sub">
            <Palette size={11} /> Fan art · {c.source}
          </span>
        </div>
        {c.url && (
          <a
            className="gp-artp-orig clickable"
            href={c.url}
            target="_blank"
            rel="noreferrer"
            title="Voir le post original"
            aria-label="Voir le post original"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </header>

      <button
        className={`gp-artp-media clickable ${c.w && c.h ? "ratio" : ""}`}
        onClick={onOpen}
        style={c.w && c.h ? { aspectRatio: `${c.w} / ${c.h}` } : undefined}
        aria-label="Agrandir le fan art"
      >
        <img
          src={c.image}
          alt={c.author ? `Fan art par ${c.author}` : "Fan art"}
          loading="lazy"
          decoding="async"
          draggable="false"
        />
        <span className="gp-artp-zoom">
          <Maximize2 size={17} />
        </span>
      </button>

      <footer className="gp-artp-actions">
        <button
          className={`gp-artp-act repost clickable ${reposted ? "on" : ""}`}
          onClick={() => onRepost(c)}
          title={reposted ? "Retirer de mon feed" : "Republier sur mon feed"}
        >
          <Repeat2 size={16} />
          {reposted ? "Republié" : "Republier"}
        </button>
        <span className="gp-artp-spacer" />
        <span className={`gp-artp-src src-${src}`}>{c.source}</span>
      </footer>
    </article>
  );
}

// Bouton « en faire ma couverture de profil ».
function CoverButton({ image, token }) {
  const { updateUser } = useAuth();
  const [state, setState] = useState("idle"); // idle | busy | done

  async function apply() {
    if (state !== "idle") return;
    setState("busy");
    try {
      const { user: u } = await apiFetch("/users/me", {
        method: "PUT",
        token,
        body: { cover: image, coverPos: null },
      });
      updateUser({ cover: u.cover, coverPos: u.coverPos });
      setState("done");
    } catch (err) {
      setState("idle");
      alert(err.message);
    }
  }

  return (
    <button
      className={`fanart-cover-btn clickable ${state === "done" ? "done" : ""}`}
      onClick={apply}
      disabled={state !== "idle"}
      title="Utiliser ce fan art comme couverture de mon profil"
    >
      {state === "busy" ? (
        <Loader2 size={14} className="spin" />
      ) : state === "done" ? (
        <Check size={14} />
      ) : (
        <Camera size={14} />
      )}
      {state === "done" ? "Couverture mise à jour" : "En faire ma couverture"}
    </button>
  );
}

// Visionneuse fan art plein écran : doom-scroll vertical avec accroche.
function FanartViewer({ items, start, onClose, reposted, onRepost, token }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = start * el.clientHeight;
  }, [start]);

  const nudge = (dir) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight, behavior: "smooth" });
  };

  return createPortal(
    <div className="gp-art-viewer">
      <button className="gp-art-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <button className="gp-art-nav up clickable" onClick={() => nudge(-1)} aria-label="Précédent">
        <ChevronUp size={22} />
      </button>
      <button className="gp-art-nav down clickable" onClick={() => nudge(1)} aria-label="Suivant">
        <ChevronDown size={22} />
      </button>

      <div className="gp-art-scroll" ref={scrollRef}>
        {items.map((a) => (
          <figure className="gp-art-slide" key={a.id}>
            <img className="gp-art-img" src={a.image} alt="" draggable="false" />
            <figcaption className="gp-art-caption">
              <div className="gp-art-cap-info">
                <span className={`gp-feed-src-badge static src-${a.source.toLowerCase()}`}>
                  {a.source}
                </span>
                {a.author && <span className="gp-art-cap-author">par {a.author}</span>}
              </div>
              <div className="gp-art-cap-actions">
                <button
                  className={`gp-art-cap-repost clickable ${reposted?.has(a.id) ? "on" : ""}`}
                  onClick={() => onRepost(a)}
                >
                  <Repeat2 size={15} />
                  {reposted?.has(a.id) ? "Republié" : "Republier"}
                </button>
                <CoverButton image={a.image} token={token} />
                <a
                  className="gp-art-cap-link clickable"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Voir le post original <ExternalLink size={14} />
                </a>
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>,
    document.body
  );
}
