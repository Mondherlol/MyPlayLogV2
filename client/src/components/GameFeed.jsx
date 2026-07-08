import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Radio,
  Palette,
  Video,
  MessageCircle,
  Play,
  ExternalLink,
  Eye,
  X,
  Sparkles,
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

// Feed communautaire d'un jeu, centré sur les fan arts (priorité). Twitch FR en
// direct et vidéos YouTube / posts sociaux sont relégués en rails horizontaux
// (drag-to-scroll) pour ne pas noyer les fan arts. Les avis Steam vivent dans
// l'onglet Reviews. Agrégé côté serveur (cache 30 min) + cache client SWR.
// v2 du préfixe : invalide les entrées empoisonnées écrites par l'ancien bug
// (contenu d'un jeu enregistré sous l'id d'un autre).
const feedCache = makeCache("mpl_feed2_", 30 * 60 * 1000);

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
    // Annule le clic (ouverture modal / lien) si l'utilisateur a fait glisser.
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

export default function GameFeed({ gameId, gameName, token }) {
  const cached = feedCache.get(String(gameId));
  const [data, setData] = useState(cached?.data || null);
  const [loading, setLoading] = useState(!cached);
  const [video, setVideo] = useState(null);
  const [stream, setStream] = useState(null);
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

  // Toggle repost (optimiste : le bouton réagit tout de suite, le serveur
  // télécharge l'image en fond ; on resynchronise / annule selon la réponse).
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

  useEffect(() => {
    let alive = true;
    const c = feedCache.get(String(gameId));
    if (c) {
      // Affiche immédiatement la donnée du BON jeu (fraîche ou périmée),
      // jamais celle du jeu précédent.
      setData(c.data);
      setLoading(false);
      if (c.fresh) return; // à jour : pas de revalidation
    } else {
      // Aucune donnée pour ce jeu : on repart du skeleton.
      setData(null);
      setLoading(true);
    }
    apiFetch(`/games/${gameId}/feed?name=${encodeURIComponent(gameName)}`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        feedCache.set(String(gameId), d);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, gameName, token]);

  if (loading) return <FeedSkeleton />;

  const streams = data?.streams || [];
  const fanart = data?.fanart || [];
  const posts = data?.posts || [];
  const videos = data?.videos || [];

  const empty = !streams.length && !fanart.length && !posts.length && !videos.length;

  if (empty) {
    return (
      <div className="gp-feed">
        <div className="gp-feed-empty">
          <Sparkles size={28} />
          <p className="font-fun">
            Rien à afficher dans le feed pour ce jeu pour l'instant — la
            communauté est peut-être discrète, reviens plus tard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="gp-feed">
      {/* Streams Twitch FR — rail horizontal en haut, lecture dans une modal */}
      {streams.length > 0 && (
        <Rail title="En direct sur Twitch" Icon={Radio} count={streams.length} live>
          {streams.map((s) => (
            <TwitchCard key={s.id} s={s} onPlay={setStream} />
          ))}
        </Rail>
      )}

      {/* Fan arts — la pièce maîtresse : fil vertical façon Twitter, une œuvre
          sous l'autre, révélées par lots au scroll. Clic = visionneuse. */}
      {fanart.length > 0 && (
        <section className="gp-fanart-sec">
          <h3 className="gp-feed-h3">
            <Palette size={16} /> Fan arts
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

      {/* Vidéos YouTube (FR, contenu travaillé) — rail horizontal */}
      {videos.length > 0 && (
        <Rail title="Vidéos" Icon={Video} count={videos.length}>
          {videos.map((v) => (
            <VideoCard key={`v-${v.videoId}`} c={v} onPlay={setVideo} />
          ))}
        </Rail>
      )}

      {/* Réactions Bluesky / Mastodon — rail horizontal */}
      {posts.length > 0 && (
        <Rail title="Réactions" Icon={MessageCircle} count={posts.length}>
          {posts.map((p) => (
            <PostCard key={p.id} c={p} />
          ))}
        </Rail>
      )}

      {video && <YouTubeModal videoId={video} onClose={() => setVideo(null)} />}
      {stream && <TwitchModal stream={stream} onClose={() => setStream(null)} />}
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
function Rail({ title, Icon, count, live, children }) {
  const ref = useDragScroll();
  const scroll = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  return (
    <section className="gp-rail-sec">
      <div className="gp-rail-head">
        <h3 className="gp-feed-h3">
          {live ? <span className="gp-live-dot" /> : Icon && <Icon size={16} />}
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

function TwitchCard({ s, onPlay }) {
  return (
    <button className="gp-tw-card gp-rail-item clickable" onClick={() => onPlay(s)}>
      <div className="gp-tw-thumb">
        <img src={s.thumbnail} alt="" loading="lazy" draggable="false" />
        <span className="gp-tw-shade" />
        <span className="gp-tw-live">
          <span className="gp-live-dot sm" /> EN DIRECT
        </span>
        <span className="gp-tw-viewers">
          <Eye size={12} /> {compact(s.viewers)}
        </span>
        <span className="gp-tw-playover">
          <Play size={20} fill="currentColor" strokeWidth={0} />
        </span>
      </div>
      <div className="gp-tw-info">
        <span className="gp-tw-title" title={s.title}>
          {s.title}
        </span>
        <span className="gp-tw-user">
          <span className="gp-tw-glyph">
            <Radio size={11} />
          </span>
          {s.user}
        </span>
      </div>
    </button>
  );
}

function VideoCard({ c, onPlay }) {
  return (
    <button className="gp-yt-card gp-rail-item clickable" onClick={() => onPlay(c.videoId)}>
      <div className="gp-yt-thumb">
        <img src={c.thumb} alt="" loading="lazy" draggable="false" />
        <span className="gp-yt-shade" />
        <span className="gp-yt-playover">
          <Play size={22} fill="currentColor" strokeWidth={0} />
        </span>
        {c.duration && <span className="gp-yt-dur">{c.duration}</span>}
      </div>
      <div className="gp-yt-info">
        <span className="gp-yt-title" title={c.title}>
          {c.title}
        </span>
        {c.author && (
          <span className="gp-yt-chan">
            <span className="gp-yt-dot" /> {c.author}
          </span>
        )}
      </div>
    </button>
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

// Fil vertical des fan arts : les œuvres sont déjà chargées côté données,
// mais on ne MONTE que `ART_BATCH` cartes à la fois — les images suivantes ne
// se chargent qu'en approchant de la sentinelle (fini le mur qui rame).
const ART_BATCH = 5;

function FanartFeed({ items, reposted, onRepost, onOpen }) {
  const [shown, setShown] = useState(ART_BATCH);
  const sentinelRef = useRef(null);

  // Changement de jeu / de données : on repart du premier lot.
  useEffect(() => setShown(ART_BATCH), [items]);

  // Recréé à chaque lot : si la sentinelle est encore visible après la
  // révélation, l'observer neuf redéclenche aussitôt le lot suivant.
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

// Une œuvre du fil, façon tweet : en-tête artiste/source, image au ratio
// réservé (zéro saut de mise en page), actions en pied de carte.
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

// Bouton « en faire ma couverture de profil » : applique l'image du fan art
// comme bannière du profil de l'utilisateur connecté (cadrage recentré).
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

// Visionneuse fan art plein écran : doom-scroll vertical avec accroche,
// chaque œuvre en grand + bouton vers le post original.
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

  // Positionne sur l'œuvre cliquée à l'ouverture (sans animation).
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

function TwitchModal({ stream, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const host = window.location.hostname;
  return createPortal(
    <div className="gp-feed-lightbox" onClick={onClose}>
      <button className="gp-feed-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <div className="gp-tw-lb" onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`https://player.twitch.tv/?channel=${stream.login}&parent=${host}&autoplay=true`}
          title={stream.title}
          allow="autoplay; fullscreen"
          allowFullScreen
        />
        <div className="gp-tw-lb-bar">
          <div className="gp-tw-lb-meta">
            <span className="gp-live-dot sm" />
            <b>{stream.user}</b>
            <span className="gp-tw-lb-title" title={stream.title}>
              {stream.title}
            </span>
          </div>
          <a className="gp-feed-lb-link clickable" href={stream.url} target="_blank" rel="noreferrer">
            Ouvrir sur Twitch <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}

function YouTubeModal({ videoId, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="gp-feed-lightbox" onClick={onClose}>
      <button className="gp-feed-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <div className="gp-feed-lb-inner" onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title="Vidéo"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
        <a
          className="gp-feed-lb-link clickable"
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noreferrer"
        >
          Ouvrir sur YouTube <ExternalLink size={14} />
        </a>
      </div>
    </div>,
    document.body
  );
}

function FeedSkeleton() {
  return (
    <div className="gp-feed" aria-busy="true">
      <div className="gp-rail">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="gp-tw-card gp-rail-item">
            <span
              style={{ aspectRatio: "16/9", display: "block", borderRadius: 16 }}
              className="gp-skel"
            />
            <div className="gp-tw-info">
              <span className="gp-skel gp-skel-bar" style={{ width: "85%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "45%" }} />
            </div>
          </div>
        ))}
      </div>
      <div className="gp-art-feed" style={{ marginTop: "1.5rem" }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="gp-artp">
            <div className="gp-artp-head">
              <span className="gp-skel" style={{ width: 40, height: 40, borderRadius: "50%" }} />
              <div className="gp-artp-who">
                <span className="gp-skel gp-skel-bar" style={{ width: "45%" }} />
                <span className="gp-skel gp-skel-bar sm" style={{ width: "28%" }} />
              </div>
            </div>
            <span
              className="gp-skel"
              style={{ display: "block", height: 320 + (i % 2) * 90, borderRadius: 14 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
