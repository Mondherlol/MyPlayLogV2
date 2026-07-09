import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Repeat2,
  ExternalLink,
  Loader2,
  X,
  Gamepad2,
  Heart,
  MessageCircle,
  Star,
  Play,
  Clapperboard,
  Eye,
  EyeOff,
  Layers,
  ListOrdered,
  Rows3,
  Users,
  Sparkles,
  BookmarkPlus,
  Gamepad,
  CircleCheck,
  CirclePause,
  CircleX,
  ThumbsUp,
  ThumbsDown,
  CornerDownRight,
  Gem,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import RepostCommentsModal from "./RepostCommentsModal";
import GemsFeedModal from "./GemsFeedModal";

// Fil d'actualité de la page d'accueil : timeline fusionnée (jeux joués,
// reviews, listes, fan arts republiés, documentaires recommandés) des joueurs
// suivis. Pagination par curseur + chargement automatique au scroll, comme
// l'onglet Feed du profil (ProfileFeed.jsx).

// Verbe de l'évènement selon le statut de l'entrée de bibliothèque.
const STATUS_META = {
  wishlist: { verb: "a envie de jouer à", Icon: BookmarkPlus, cls: "wishlist" },
  playing: { verb: "joue à", Icon: Gamepad, cls: "playing" },
  finished: { verb: "a terminé", Icon: CircleCheck, cls: "finished" },
  paused: { verb: "a mis en pause", Icon: CirclePause, cls: "paused" },
  dropped: { verb: "a abandonné", Icon: CircleX, cls: "dropped" },
};

const LIST_TYPE_META = {
  classic: { label: "Liste", Icon: Rows3 },
  ranked: { label: "Top classé", Icon: ListOrdered },
  tier: { label: "Tier list", Icon: Layers },
};

// Interactions sociales : verbe + icône + contexte (liste ou avis) + faut-il
// afficher l'extrait (le texte commenté / liké). `target` = à qui appartient
// le contenu visé (propriétaire de la liste, auteur du commentaire répondu…).
const ACTION_META = {
  list_comment: { Icon: MessageCircle, verb: "a commenté la liste de", ctx: "list", quote: true },
  comment_reply: { Icon: CornerDownRight, verb: "a répondu à", ctx: "list", quote: true },
  list_like: { Icon: Heart, verb: "a aimé la liste de", ctx: "list", quote: false },
  comment_like: { Icon: Heart, verb: "a aimé un commentaire de", ctx: "list", quote: true },
  review_comment: { Icon: MessageCircle, verb: "a commenté l'avis de", ctx: "review", quote: true },
  review_comment_reply: { Icon: CornerDownRight, verb: "a répondu à", ctx: "review", quote: true },
  review_comment_like: { Icon: Heart, verb: "a aimé une réponse de", ctx: "review", quote: true },
  review_react: { Icon: Heart, verb: "a réagi à l'avis de", ctx: "review", quote: false },
};

export default function HomeFeed({ token, me }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [community, setCommunity] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightbox, setLightbox] = useState(null); // repost affiché en grand
  const [playing, setPlaying] = useState(null); // documentaire en lecture
  const [commentsFor, setCommentsFor] = useState(null); // repost → modale commentaires
  const [gemsFor, setGemsFor] = useState(null); // découverte de pépites → modale liste
  const sentinelRef = useRef(null);
  // Refs miroirs pour que l'observer (créé une fois) lise l'état courant.
  const stateRef = useRef({ cursor: null, busy: false });
  stateRef.current = { cursor, busy: loading || loadingMore };

  useEffect(() => {
    let alive = true;
    apiFetch("/feed/home?limit=12", { token })
      .then((d) => {
        if (!alive) return;
        setItems(d.items || []);
        setCursor(d.nextCursor || null);
        setCommunity(!!d.community);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token]);

  async function loadMore() {
    const { cursor: c, busy } = stateRef.current;
    if (!c || busy) return;
    setLoadingMore(true);
    try {
      const d = await apiFetch(
        `/feed/home?limit=12&before=${encodeURIComponent(c)}`,
        { token }
      );
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...(d.items || []).filter((i) => !seen.has(i.id))];
      });
      setCursor(d.nextCursor || null);
    } catch {
      /* on retentera au prochain passage de la sentinelle */
    } finally {
      setLoadingMore(false);
    }
  }

  // Sentinelle de scroll infini (comme ProfileFeed).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "700px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const patchRepost = (id, patch) =>
    setItems((list) =>
      list.map((i) =>
        i.id === id ? { ...i, repost: { ...i.repost, ...patch } } : i
      )
    );

  // Like optimiste d'une republication.
  async function toggleLike(item) {
    const r = item.repost;
    const was = { liked: r.liked, likeCount: r.likeCount };
    patchRepost(item.id, {
      liked: !r.liked,
      likeCount: r.likeCount + (r.liked ? -1 : 1),
    });
    try {
      const d = await apiFetch(`/reposts/${r.id}/like`, { method: "POST", token });
      patchRepost(item.id, { liked: d.liked, likeCount: d.likeCount });
    } catch {
      patchRepost(item.id, was);
    }
  }

  // Republier sur MON feed (toggle optimiste).
  async function toggleRepost(item) {
    const was = item.repost.repostedByMe;
    patchRepost(item.id, { repostedByMe: !was });
    try {
      const d = await apiFetch("/reposts", {
        method: "POST",
        token,
        body: { fromRepostId: item.repost.id },
      });
      patchRepost(item.id, { repostedByMe: !!d.reposted });
    } catch {
      patchRepost(item.id, { repostedByMe: was });
    }
  }

  if (loading) return <HomeFeedSkeleton />;

  if (!items.length) {
    return (
      <div className="hf-empty card">
        <span className="hf-empty-icon">
          <Users size={26} />
        </span>
        <p className="font-fun">
          C'est calme par ici… Suis d'autres joueurs pour remplir ton fil, ou
          ajoute des jeux à ton journal pour lancer la machine !
        </p>
      </div>
    );
  }

  return (
    <div className="hf-feed">
      {community && (
        <div className="hf-community">
          <Sparkles size={14} />
          Tu ne suis personne pour l'instant : voici l'activité de toute la
          communauté.
        </div>
      )}

      {items.map((item) => (
        <FeedCard
          key={item.id}
          item={item}
          me={me}
          onLike={() => toggleLike(item)}
          onComments={() => setCommentsFor(item)}
          onRepost={() => toggleRepost(item)}
          onOpenImage={() => setLightbox(item)}
          onPlay={() => setPlaying(item)}
          onOpenGems={() => setGemsFor(item)}
        />
      ))}

      <div ref={sentinelRef} className="hf-sentinel" aria-hidden="true" />
      {loadingMore && (
        <div className="hf-more">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      )}
      {!cursor && items.length > 6 && (
        <p className="hf-end font-fun">Tu es à jour ✦</p>
      )}

      {lightbox && (
        <FanartLightbox item={lightbox} onClose={() => setLightbox(null)} />
      )}
      {playing && (
        <VideoLightbox item={playing} onClose={() => setPlaying(null)} />
      )}
      {commentsFor && (
        <RepostCommentsModal
          repost={{ ...commentsFor.repost, game: commentsFor.game }}
          token={token}
          onCountChange={(n) => patchRepost(commentsFor.id, { commentCount: n })}
          onClose={() => setCommentsFor(null)}
        />
      )}
      {gemsFor && <GemsFeedModal item={gemsFor} onClose={() => setGemsFor(null)} />}
    </div>
  );
}

function FeedCard(props) {
  const { item } = props;
  if (item.type === "game") return <GameEvent {...props} />;
  if (item.type === "list") return <ListEvent {...props} />;
  if (item.type === "interaction") return <InteractionEvent {...props} />;
  if (item.type === "repost") return <RepostEvent {...props} />;
  if (item.type === "video") return <VideoEvent {...props} />;
  if (item.type === "gems") return <GemsEvent {...props} />;
  return null;
}

// En-tête commun : avatar + « pseudo <action> » + date relative.
function EventHead({ user, date, children, badge }) {
  return (
    <header className="hf-head">
      <Link to={`/u/${user.username}`} className="hf-avatar clickable">
        {user.avatar ? (
          <img src={user.avatar} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="hf-avatar-fb">{user.username[0].toUpperCase()}</span>
        )}
      </Link>
      <div className="hf-who">
        <span className="hf-line">
          <Link to={`/u/${user.username}`} className="hf-user clickable">
            {user.username}
          </Link>{" "}
          <span className="hf-action">{children}</span>
        </span>
        <span className="hf-time" title={new Date(date).toLocaleString()}>
          {timeAgo(date)}
        </span>
      </div>
      {badge}
    </header>
  );
}

// --- Évènement bibliothèque : joué / terminé / review / note ---
function GameEvent({ item }) {
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(false);
  const meta = STATUS_META[item.status] || STATUS_META.playing;
  const g = item.game;
  const hidden = item.spoiler && !revealed;
  // Une review mène directement à l'onglet Reviews de la fiche jeu.
  const gameUrl = item.hasReview ? `/game/${g.id}?tab=reviews` : `/game/${g.id}`;

  return (
    <article className={`hf-card hf-game st-${meta.cls}`}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-status-badge st-${meta.cls}`}>
            <meta.Icon size={13} />
          </span>
        }
      >
        {item.hasReview ? "a partagé son avis sur" : meta.verb}{" "}
        <Link to={gameUrl} className="hf-game-link clickable">
          {g.name}
        </Link>
      </EventHead>

      <div
        className="hf-game-body clickable"
        onClick={() => navigate(gameUrl)}
      >
        <div className="hf-cover">
          {g.cover ? (
            <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
          ) : (
            <span className="hf-cover-ph">
              <Gamepad2 size={20} />
            </span>
          )}
        </div>
        <div className="hf-game-info">
          <div className="hf-game-tags">
            {item.rating != null && (
              <span className="hf-rating">
                <Star size={12} fill="currentColor" strokeWidth={0} />
                {item.rating}%
              </span>
            )}
            {item.platform && <span className="hf-chip">{item.platform}</span>}
            {item.playtimeHours != null && (
              <span className="hf-chip">{item.playtimeHours} h</span>
            )}
            {item.favorite && (
              <span className="hf-chip fav">
                <Heart size={11} fill="currentColor" /> coup de cœur
              </span>
            )}
          </div>

          {item.hasReview && (
            <div className={`hf-review ${hidden ? "spoiler" : ""}`}>
              {item.review && <p className="hf-review-text">{item.review}</p>}
              {(item.pros.length > 0 || item.cons.length > 0) && (
                <div className="hf-proscons">
                  {item.pros.map((p, i) => (
                    <span key={`p${i}`} className="hf-pro">
                      <ThumbsUp size={11} /> {p}
                    </span>
                  ))}
                  {item.cons.map((c, i) => (
                    <span key={`c${i}`} className="hf-con">
                      <ThumbsDown size={11} /> {c}
                    </span>
                  ))}
                </div>
              )}
              {item.reviewImage && (
                <img
                  className="hf-review-img"
                  src={item.reviewImage}
                  alt=""
                  loading="lazy"
                  draggable="false"
                />
              )}
              {hidden && (
                <button
                  className="hf-spoiler-veil clickable"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRevealed(true);
                  }}
                >
                  <EyeOff size={16} />
                  <span>Spoilers — clique pour révéler</span>
                  <Eye size={16} className="hf-spoiler-eye" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {(item.reactionCount > 0 || item.commentCount > 0) && (
        <footer className="hf-foot-counts">
          {item.reactionCount > 0 && (
            <span>
              <Heart size={13} /> {item.reactionCount}
            </span>
          )}
          {item.commentCount > 0 && (
            <span>
              <MessageCircle size={13} /> {item.commentCount}
            </span>
          )}
        </footer>
      )}
    </article>
  );
}

// --- Évènement liste : créée ou mise à jour ---
function ListEvent({ item }) {
  const navigate = useNavigate();
  const l = item.list;
  const meta = LIST_TYPE_META[l.type] || LIST_TYPE_META.classic;
  const kind = l.itemKind === "character" ? "personnage" : "jeu";

  return (
    <article className="hf-card hf-list">
      <EventHead user={item.user} date={item.date}>
        {item.created ? "a créé une liste" : "a mis à jour sa liste"}
      </EventHead>

      <div
        className="hf-list-body clickable"
        onClick={() => navigate(`/lists/${l.id}`)}
      >
        <div className="hf-list-mosaic">
          {l.preview.length ? (
            l.preview.slice(0, 5).map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                loading="lazy"
                draggable="false"
                style={{ zIndex: 5 - i }}
              />
            ))
          ) : (
            <span className="hf-list-mosaic-ph">
              <meta.Icon size={20} />
            </span>
          )}
        </div>
        <div className="hf-list-info">
          <span className="hf-list-type">
            <meta.Icon size={12} /> {meta.label}
          </span>
          <h4 className="hf-list-title">{l.title}</h4>
          <span className="hf-list-meta">
            {l.itemCount} {kind}
            {l.itemCount > 1 ? "s" : ""}
            {l.likeCount > 0 && (
              <>
                {" · "}
                <Heart size={11} /> {l.likeCount}
              </>
            )}
            {l.commentCount > 0 && (
              <>
                {" · "}
                <MessageCircle size={11} /> {l.commentCount}
              </>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

// --- Petite carte « liste » réutilisée dans les interactions ---
function ListMini({ list }) {
  const navigate = useNavigate();
  const meta = LIST_TYPE_META[list.type] || LIST_TYPE_META.classic;
  const kind = list.itemKind === "character" ? "personnage" : "jeu";
  return (
    <div
      className="hf-list-body clickable"
      onClick={() => navigate(`/lists/${list.id}`)}
    >
      <div className="hf-list-mosaic">
        {list.preview.length ? (
          list.preview.slice(0, 5).map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              loading="lazy"
              draggable="false"
              style={{ zIndex: 5 - i }}
            />
          ))
        ) : (
          <span className="hf-list-mosaic-ph">
            <meta.Icon size={20} />
          </span>
        )}
      </div>
      <div className="hf-list-info">
        <span className="hf-list-type">
          <meta.Icon size={12} /> {meta.label}
        </span>
        <h4 className="hf-list-title">{list.title}</h4>
        <span className="hf-list-meta">
          {list.itemCount} {kind}
          {list.itemCount > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// --- Évènement interaction : commentaire / réponse / like sur liste ou avis ---
function InteractionEvent({ item }) {
  const meta = ACTION_META[item.action];
  if (!meta) return null;
  const target = item.target?.username;
  const reviewUrl = item.game ? `/game/${item.game.id}?tab=reviews` : null;

  return (
    <article className="hf-card hf-interaction">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-int-badge act-${item.action}`}>
            <meta.Icon size={13} />
          </span>
        }
      >
        {meta.verb}
        {target && (
          <>
            {" "}
            <Link to={`/u/${target}`} className="hf-int-target clickable">
              {target}
            </Link>
          </>
        )}
      </EventHead>

      {meta.quote && item.snippet && (
        <p className="hf-int-quote">{item.snippet}</p>
      )}

      {item.list && <ListMini list={item.list} />}

      {meta.ctx === "review" && item.game && reviewUrl && (
        <Link to={reviewUrl} className="hf-int-gamechip clickable">
          <Star size={13} fill="currentColor" strokeWidth={0} />
          <span>Avis sur {item.game.name}</span>
          <ExternalLink size={13} />
        </Link>
      )}
    </article>
  );
}

// --- Évènement repost : fan art republié (image locale) ---
function RepostEvent({ item, me, onLike, onComments, onRepost, onOpenImage }) {
  const r = item.repost;
  const g = item.game;
  const isMine = me && item.user.username === me;
  return (
    <article className="hf-card hf-repost">
      <EventHead user={item.user} date={item.date}>
        <Repeat2 size={13} className="hf-inline-ic" /> a republié un fan art
      </EventHead>

      <button className="hf-media clickable" onClick={onOpenImage}>
        <img
          src={r.image}
          alt={`Fan art ${g.name || ""}`}
          loading="lazy"
          draggable="false"
          style={r.w && r.h ? { aspectRatio: `${r.w} / ${r.h}` } : undefined}
        />
      </button>

      <footer className="hf-repost-foot">
        <Link to={`/game/${g.id}`} className="hf-repost-game clickable" title={g.name}>
          {g.cover ? (
            <img src={g.cover} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="hf-repost-game-ph">
              <Gamepad2 size={13} />
            </span>
          )}
          <span>{g.name}</span>
        </Link>
        <span className="hf-spacer" />
        <span className={`pff-tag src-${r.source.toLowerCase()}`}>{r.source}</span>
        {r.author && <span className="hf-credit">par {r.author}</span>}
      </footer>

      <div className="hf-actions">
        <button
          className={`hf-act like clickable ${r.liked ? "on" : ""}`}
          onClick={onLike}
          title="J'aime"
        >
          <Heart size={16} fill={r.liked ? "currentColor" : "none"} />
          <span>{r.likeCount > 0 ? r.likeCount : ""}</span>
        </button>
        <button className="hf-act clickable" onClick={onComments} title="Commentaires">
          <MessageCircle size={16} />
          <span>{r.commentCount > 0 ? r.commentCount : ""}</span>
        </button>
        {!isMine && (
          <button
            className={`hf-act repost clickable ${r.repostedByMe ? "on" : ""}`}
            onClick={onRepost}
            title={r.repostedByMe ? "Retirer de mon feed" : "Republier sur mon feed"}
          >
            <Repeat2 size={16} />
            <span>{r.repostedByMe ? "Republié" : "Republier"}</span>
          </button>
        )}
      </div>
    </article>
  );
}

// --- Évènement pépites : un joueur a utilisé la découverte de pépites indés.
// Cliquer la carte ouvre la liste de ses trouvailles (GemsFeedModal). ---
function GemsEvent({ item, onOpenGems }) {
  const names = item.seeds.map((s) => s.name);
  return (
    <article className="hf-card hf-gems">
      <EventHead user={item.user} date={item.date}>
        <Gem size={13} className="hf-inline-ic" /> est parti à la chasse aux
        pépites indés
      </EventHead>

      <div
        className="hf-gems-body clickable"
        onClick={onOpenGems}
        title="Voir ses pépites"
      >
        <div className="hf-gems-covers">
          {item.seeds.map((s) => (
            <span key={s.id} className="hf-gems-cover" title={s.name}>
              {s.cover ? (
                <img src={s.cover} alt={s.name} loading="lazy" draggable="false" />
              ) : (
                <span className="hf-gems-cover-ph">
                  <Gamepad2 size={16} />
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="hf-gems-info">
          <p className="hf-gems-txt">
            À partir de <b>{names.slice(0, -1).join(", ") || names[0]}</b>
            {names.length > 1 && (
              <>
                {" "}
                et <b>{names[names.length - 1]}</b>
              </>
            )}
            {item.count > 1 && (
              <span className="hf-gems-count"> · {item.count} fournées</span>
            )}
          </p>
          {item.gameCount > 0 && (
            <span className="hf-gems-open">
              <Gem size={13} /> Voir ses {item.gameCount} pépites
            </span>
          )}
        </div>
      </div>

      <button
        className="hf-gems-cta clickable"
        onClick={() => window.dispatchEvent(new CustomEvent("mpl:open-gems"))}
      >
        <Gem size={14} /> Chercher mes pépites aussi
      </button>
    </article>
  );
}

// --- Évènement vidéo : documentaire recommandé ---
function VideoEvent({ item, onPlay }) {
  const v = item.video;
  return (
    <article className="hf-card hf-video">
      <EventHead user={item.user} date={item.date}>
        <Clapperboard size={13} className="hf-inline-ic" /> recommande un
        documentaire
      </EventHead>

      <button className="hf-video-thumb clickable" onClick={onPlay} title={v.title}>
        <img src={v.thumb} alt="" loading="lazy" draggable="false" />
        <span className="hf-video-play">
          <Play size={22} fill="currentColor" />
        </span>
        {v.duration && <span className="hf-video-dur">{v.duration}</span>}
      </button>

      <div className="hf-video-info">
        <h4 className="hf-video-title">{v.title}</h4>
        <span className="hf-video-meta">
          {v.author && <span>{v.author}</span>}
          {item.game && (
            <Link to={`/game/${item.game.id}`} className="hf-video-game clickable">
              <Gamepad2 size={12} /> {item.game.name}
            </Link>
          )}
        </span>
      </div>
    </article>
  );
}

// Visionneuse plein écran d'un fan art (réutilise les styles du feed de jeu).
function FanartLightbox({ item, onClose }) {
  const r = item.repost;
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="gp-feed-lightbox" onClick={onClose}>
      <button className="gp-feed-lb-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <figure className="pff-lb" onClick={(e) => e.stopPropagation()}>
        <img src={r.image} alt="" draggable="false" />
        <figcaption className="pff-lb-bar">
          <span className={`gp-feed-src-badge static src-${r.source.toLowerCase()}`}>
            {r.source}
          </span>
          {r.author && <span className="pff-lb-author">par {r.author}</span>}
          {r.url && (
            <a
              className="gp-feed-lb-link clickable"
              href={r.url}
              target="_blank"
              rel="noreferrer"
            >
              Voir le post original <ExternalLink size={14} />
            </a>
          )}
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}

// Lecture d'un documentaire recommandé (mêmes styles que l'onglet Vidéos).
function VideoLightbox({ item, onClose }) {
  const v = item.video;
  return createPortal(
    <div className="modal-overlay doc-overlay" onMouseDown={onClose}>
      <div className="doc-lightbox" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <div className="doc-stage">
          <iframe
            className="doc-player"
            src={`https://www.youtube.com/embed/${v.videoId}?autoplay=1&rel=0&modestbranding=1`}
            title={v.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="doc-info">
          <h3 className="doc-video-title">{v.title}</h3>
          {v.author && <span className="doc-chan">{v.author}</span>}
        </div>
      </div>
    </div>,
    document.body
  );
}

function HomeFeedSkeleton() {
  return (
    <div className="hf-feed" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="hf-card">
          <div className="hf-head">
            <span className="gp-skel" style={{ width: 42, height: 42, borderRadius: "50%" }} />
            <div className="hf-who">
              <span className="gp-skel gp-skel-bar" style={{ width: "52%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "22%" }} />
            </div>
          </div>
          <span
            className="gp-skel"
            style={{ display: "block", height: 130 + (i % 2) * 110, borderRadius: 14 }}
          />
        </div>
      ))}
    </div>
  );
}
