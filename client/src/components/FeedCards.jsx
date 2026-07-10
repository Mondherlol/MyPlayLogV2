import { useEffect, useState } from "react";
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
  Pause,
  Clapperboard,
  Eye,
  EyeOff,
  Layers,
  ListOrdered,
  Rows3,
  BookmarkPlus,
  Gamepad,
  CircleCheck,
  CirclePause,
  CircleX,
  ThumbsUp,
  ThumbsDown,
  CornerDownRight,
  Gem,
  Music,
  User as UserIcon,
  UserPlus,
  Clock,
  PartyPopper,
  Laugh,
  ListPlus,
  Trash2,
  Infinity as InfinityIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/lists";
import { extractVideoId } from "../lib/youtube";
import { usePlayer } from "../context/PlayerContext";
import ReviewComments from "./ReviewComments";

// Cards du fil social — partagées entre le fil d'accueil (HomeFeed) et
// l'onglet Feed du profil (ProfileFeed). Chaque évènement reflète une VRAIE
// action journalisée côté serveur (models/Activity.js) : passage en
// « terminé », note posée, OST favorite choisie, liste créée, abonnement…
// Les actions rapprochées sur un même jeu sont regroupées en une seule carte.

// Verbe de l'évènement selon le statut de l'entrée de bibliothèque.
export const STATUS_META = {
  wishlist: { verb: "a envie de jouer à", label: "à jouer", Icon: BookmarkPlus, cls: "wishlist" },
  playing: { verb: "joue à", label: "en cours", Icon: Gamepad, cls: "playing" },
  finished: { verb: "a terminé", label: "terminé", Icon: CircleCheck, cls: "finished" },
  paused: { verb: "a mis en pause", label: "en pause", Icon: CirclePause, cls: "paused" },
  dropped: { verb: "a abandonné", label: "abandonné", Icon: CircleX, cls: "dropped" },
  endless: { verb: "enchaîne les parties sur", label: "sans fin", Icon: InfinityIcon, cls: "endless" },
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

// Réactions possibles sur un avis (mêmes clés que l'onglet Reviews).
const REACTIONS = [
  { key: "heart", label: "Coup de cœur", Icon: Heart, color: "#e0483f" },
  { key: "clap", label: "Bravo", Icon: PartyPopper, color: "#9a6bff" },
  { key: "funny", label: "Rigolo", Icon: Laugh, color: "#f2b70b" },
];

// Ordre de priorité pour choisir le VERBE principal d'une carte jeu quand
// plusieurs actions sont regroupées (le reste devient chips / lignes détail).
const CHANGE_PRIORITY = ["status", "added", "review", "rating", "ost", "character", "favorite", "time"];

// ============================================================
//  Dispatcher
// ============================================================
export function FeedCard(props) {
  const { item } = props;
  if (item.type === "game") return <GameEvent {...props} />;
  if (item.type === "gamegroup") return <GameGroupEvent {...props} />;
  if (item.type === "list") return <ListEvent {...props} />;
  if (item.type === "listadd") return <ListAddEvent {...props} />;
  if (item.type === "follow") return <FollowEvent {...props} />;
  if (item.type === "interaction") return <InteractionEvent {...props} />;
  if (item.type === "repost") return <RepostEvent {...props} />;
  if (item.type === "video") return <VideoEvent {...props} />;
  if (item.type === "gems") return <GemsEvent {...props} />;
  return null;
}

// En-tête commun : avatar + « pseudo <action> » + date relative.
export function EventHead({ user, date, children, badge }) {
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

// ============================================================
//  Évènement bibliothèque : les VRAIES actions, regroupées
// ============================================================

// Verbe principal (le plus « fort ») + icône de badge, à partir des changements.
function primaryChange(changes, status) {
  const byKind = new Map((changes || []).map((c) => [c.kind, c]));
  for (const kind of CHANGE_PRIORITY) {
    if (!byKind.has(kind)) continue;
    const c = byKind.get(kind);
    if (kind === "status" || kind === "added") {
      const meta = STATUS_META[c.to || c.status || status] || STATUS_META.playing;
      return { kind, verb: meta.verb, Icon: meta.Icon, cls: meta.cls };
    }
    if (kind === "review")
      return { kind, verb: "a partagé son avis sur", Icon: Star, cls: "review" };
    if (kind === "rating")
      return { kind, verb: "a noté", Icon: Star, cls: "review" };
    if (kind === "ost")
      return { kind, verb: "a choisi sa musique favorite sur", Icon: Music, cls: "ost" };
    if (kind === "character")
      return { kind, verb: "a élu son personnage favori dans", Icon: UserIcon, cls: "character" };
    if (kind === "favorite")
      return { kind, verb: "a eu un coup de cœur pour", Icon: Heart, cls: "favorite" };
    if (kind === "time")
      return { kind, verb: "a mis à jour son temps de jeu sur", Icon: Clock, cls: "time" };
  }
  const meta = STATUS_META[status] || STATUS_META.playing;
  return { kind: "status", verb: meta.verb, Icon: meta.Icon, cls: meta.cls };
}

// Chip OST favorite : lecture via le mini-lecteur global si c'est du YouTube.
function FeedOstChip({ ost, game }) {
  const player = usePlayer();
  const videoId = ost.url ? extractVideoId(ost.url) : ost.videoId || null;
  const canPlay = !!(player && videoId);
  const playing = canPlay ? player.isPlaying(ost) : false;

  function toggle(e) {
    e.stopPropagation();
    if (canPlay) {
      const track = { ...ost, gameId: game?.id, gameName: game?.name };
      player.toggleTrack(track, [track], {});
    } else if (ost.url) {
      window.open(ost.url, "_blank", "noopener");
    }
  }

  return (
    <button
      className={`hf-ost clickable ${playing ? "playing" : ""}`}
      onClick={toggle}
      title={canPlay ? (playing ? "Pause" : "Écouter") : ost.url ? "Ouvrir" : ost.name}
    >
      <span className="hf-ost-art">
        {ost.artwork ? (
          <img src={ost.artwork} alt="" loading="lazy" draggable="false" />
        ) : (
          <Music size={16} />
        )}
        {(canPlay || ost.url) && (
          <span className="hf-ost-play">
            {playing ? (
              <Pause size={12} fill="currentColor" />
            ) : (
              <Play size={12} fill="currentColor" />
            )}
          </span>
        )}
      </span>
      <span className="hf-ost-txt">
        <span className="hf-ost-label">
          <Music size={11} /> OST favorite
        </span>
        <span className="hf-ost-name">{ost.name}</span>
        {ost.artist && <span className="hf-ost-artist">{ost.artist}</span>}
      </span>
      {playing && (
        <span className="hf-ost-eq" aria-hidden="true">
          <i /><i /><i />
        </span>
      )}
    </button>
  );
}

// Barre de réactions (cœur / bravo / rigolo) — mêmes endpoints que l'onglet
// Reviews de la fiche jeu, utilisable directement depuis le fil.
function FeedReactions({ reactions, myReaction, readOnly, onReact }) {
  return (
    <div className={`rvc-reacts hf-reacts ${readOnly ? "readonly" : ""}`}>
      {REACTIONS.map((rc) => {
        const n = reactions?.[rc.key] || 0;
        const on = myReaction === rc.key;
        if (readOnly && !n) return null;
        return (
          <button
            key={rc.key}
            className={`rvc-react clickable ${on ? "on" : ""}`}
            style={{ "--react-c": rc.color }}
            onClick={readOnly ? undefined : () => onReact(rc.key)}
            disabled={readOnly}
            title={rc.label}
          >
            <rc.Icon size={15} fill={on ? "currentColor" : "none"} />
            {n > 0 && <span className="rvc-react-n">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

// --- La carte jeu : verbe réel, chips, OST jouable, review, réactions, fil ---
function GameEvent({ item, me, token }) {
  const navigate = useNavigate();
  const [revealed, setRevealed] = useState(false);
  const [reactions, setReactions] = useState(item.reactions || null);
  const [myReaction, setMyReaction] = useState(item.myReaction || null);
  const [commentCount, setCommentCount] = useState(item.commentCount || 0);
  const [showThread, setShowThread] = useState(false);
  const [thread, setThread] = useState(null); // null | "loading" | comments[]

  const changes = item.changes || [];
  const kinds = new Set(changes.map((c) => c.kind));
  const primary = primaryChange(changes, item.status);
  const statusMeta = STATUS_META[item.status] || null;
  const g = item.game;
  const isMine = me && item.user.username === me;
  const hidden = item.spoiler && item.hasReview && !revealed;
  const gameUrl = item.hasReview ? `/game/${g.id}?tab=reviews` : `/game/${g.id}`;

  // Sous-actions affichées en plus du verbe principal (regroupement).
  const timeChange = changes.find((c) => c.kind === "time");
  const ratingChange = changes.find((c) => c.kind === "rating");

  async function react(type) {
    if (!token || isMine) return;
    const prev = { reactions, myReaction };
    // MAJ optimiste (toggle / remplacement).
    const counts = { heart: 0, clap: 0, funny: 0, ...(reactions || {}) };
    if (myReaction === type) {
      counts[type] = Math.max(0, (counts[type] || 0) - 1);
      setMyReaction(null);
    } else {
      if (myReaction) counts[myReaction] = Math.max(0, (counts[myReaction] || 0) - 1);
      counts[type] = (counts[type] || 0) + 1;
      setMyReaction(type);
    }
    setReactions(counts);
    try {
      const res = await apiFetch(`/games/${g.id}/reviews/${item.user.id}/react`, {
        method: "POST",
        token,
        body: { type },
      });
      setReactions(res.reactions);
      setMyReaction(res.myReaction);
    } catch {
      setReactions(prev.reactions);
      setMyReaction(prev.myReaction);
    }
  }

  async function toggleThread() {
    const opening = !showThread;
    setShowThread(opening);
    if (opening && thread == null) {
      setThread("loading");
      try {
        const d = await apiFetch(`/games/${g.id}/reviews/${item.user.id}`, { token });
        setThread(d.review?.comments || []);
      } catch {
        setThread([]);
      }
    }
  }

  const setThreadComments = (updater) => {
    setThread((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      const next = typeof updater === "function" ? updater(arr) : updater;
      setCommentCount(next.length);
      return next;
    });
  };

  return (
    <article className={`hf-card hf-game st-${primary.cls}`}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-status-badge st-${primary.cls}`}>
            <primary.Icon size={13} />
          </span>
        }
      >
        {primary.verb}{" "}
        <Link to={gameUrl} className="hf-game-link clickable">
          {g.name}
        </Link>
      </EventHead>

      <div className="hf-game-body clickable" onClick={() => navigate(gameUrl)}>
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
              <span className={`hf-rating ${ratingChange ? "new" : ""}`}>
                <Star size={12} fill="currentColor" strokeWidth={0} />
                {item.rating}%
              </span>
            )}
            {statusMeta && primary.kind !== "status" && primary.kind !== "added" && (
              <span className={`hf-chip st-chip st-${statusMeta.cls}`}>
                <statusMeta.Icon size={11} /> {statusMeta.label}
              </span>
            )}
            {item.platform && <span className="hf-chip">{item.platform}</span>}
            {item.playtimeHours != null && (
              <span className={`hf-chip ${timeChange ? "new" : ""}`}>
                <Clock size={11} /> {item.playtimeHours} h
              </span>
            )}
            {(item.favorite || kinds.has("favorite")) && (
              <span className="hf-chip fav">
                <Heart size={11} fill="currentColor" /> coup de cœur
              </span>
            )}
          </div>

          {/* Sous-actions regroupées : OST choisie, personnage élu */}
          {item.ost && (
            <div onClick={(e) => e.stopPropagation()}>
              <FeedOstChip ost={item.ost} game={g} />
            </div>
          )}
          {item.character && (
            <span className="hf-chara">
              <span className="hf-chara-av">
                {item.character.image ? (
                  <img src={item.character.image} alt="" loading="lazy" draggable="false" />
                ) : (
                  <UserIcon size={14} />
                )}
              </span>
              <span className="hf-chara-txt">
                <span className="hf-chara-label">Personnage favori</span>
                <span className="hf-chara-name">{item.character.name}</span>
              </span>
            </span>
          )}

          {item.hasReview && (
            <div className={`hf-review ${hidden ? "spoiler" : ""}`}>
              {item.review && <p className="hf-review-text">{item.review}</p>}
              {(item.pros?.length > 0 || item.cons?.length > 0) && (
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

      {/* Réagir / répondre à l'avis directement depuis le fil */}
      {item.canReact && (
        <footer className="hf-game-foot">
          <FeedReactions
            reactions={reactions}
            myReaction={myReaction}
            readOnly={!!isMine}
            onReact={react}
          />
          <button
            className={`hf-reply-btn clickable ${showThread ? "on" : ""}`}
            onClick={toggleThread}
          >
            <MessageCircle size={15} />
            {commentCount > 0
              ? `${commentCount} répons${commentCount > 1 ? "es" : "e"}`
              : "Répondre"}
          </button>
        </footer>
      )}

      {showThread && (
        <div className="hf-thread">
          {thread === "loading" ? (
            <div className="hf-thread-loading">
              <Loader2 size={16} className="spin" /> Chargement des réponses…
            </div>
          ) : (
            <ReviewComments
              gameId={g.id}
              reviewUserId={item.user.id}
              token={token}
              comments={Array.isArray(thread) ? thread : []}
              setComments={setThreadComments}
            />
          )}
        </div>
      )}
    </article>
  );
}

// ============================================================
//  Groupe de jeux : rafale d'ajouts au même statut → une seule carte
// ============================================================
const GROUP_VERBS = {
  wishlist: (n) => `a ajouté ${n} jeux à sa liste de souhaits`,
  playing: (n) => `a lancé ${n} jeux`,
  finished: (n) => `a terminé ${n} jeux`,
  paused: (n) => `a mis ${n} jeux en pause`,
  dropped: (n) => `a abandonné ${n} jeux`,
  endless: (n) => `enchaîne les parties sur ${n} jeux`,
};

function GameGroupEvent({ item }) {
  const meta = STATUS_META[item.status] || STATUS_META.playing;
  const verb = (GROUP_VERBS[item.status] || GROUP_VERBS.playing)(item.games.length);
  const names = item.games.map((g) => g.name);
  return (
    <article className={`hf-card hf-game hf-gamegroup st-${meta.cls}`}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-status-badge st-${meta.cls}`}>
            <meta.Icon size={13} />
          </span>
        }
      >
        {verb}
      </EventHead>

      <div className="hf-group-covers">
        {item.games.map((g) => (
          <Link
            key={g.id}
            to={`/game/${g.id}`}
            className="hf-group-cover clickable"
            title={g.name}
          >
            {g.cover ? (
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-group-cover-ph">
                <Gamepad2 size={18} />
              </span>
            )}
          </Link>
        ))}
      </div>

      <p className="hf-group-names">
        {names.slice(0, -1).join(", ")}
        {names.length > 1 ? " et " : ""}
        {names[names.length - 1]}
      </p>
    </article>
  );
}

// ============================================================
//  Listes
// ============================================================
export function ListMini({ list }) {
  const navigate = useNavigate();
  const meta = LIST_TYPE_META[list.type] || LIST_TYPE_META.classic;
  const kind = list.itemKind === "character" ? "personnage" : "jeu";
  return (
    <div className="hf-list-body clickable" onClick={() => navigate(`/lists/${list.id}`)}>
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
          {list.likeCount > 0 && (
            <>
              {" · "}
              <Heart size={11} /> {list.likeCount}
            </>
          )}
          {list.commentCount > 0 && (
            <>
              {" · "}
              <MessageCircle size={11} /> {list.commentCount}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// --- Liste créée ---
function ListEvent({ item }) {
  return (
    <article className="hf-card hf-list">
      <EventHead user={item.user} date={item.date}>
        a créé une liste
      </EventHead>
      <ListMini list={item.list} />
    </article>
  );
}

// --- Jeux ajoutés à une liste ---
function ListAddEvent({ item }) {
  const kind = item.list.itemKind === "character" ? "personnage" : "jeu";
  return (
    <article className="hf-card hf-list">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className="hf-status-badge st-listadd">
            <ListPlus size={13} />
          </span>
        }
      >
        a ajouté {item.count > 1 ? `${item.count} ${kind}s` : `un ${kind}`} à sa liste
      </EventHead>
      <ListMini list={item.list} />
    </article>
  );
}

// ============================================================
//  Abonnement
// ============================================================
function FollowEvent({ item }) {
  const t = item.target;
  if (!t) return null;
  return (
    <article className="hf-card hf-follow">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className="hf-status-badge st-follow">
            <UserPlus size={13} />
          </span>
        }
      >
        s'est abonné à{" "}
        <Link to={`/u/${t.username}`} className="hf-game-link clickable">
          {t.username}
        </Link>
      </EventHead>
      <Link to={`/u/${t.username}`} className="hf-follow-target clickable">
        <span className="hf-follow-av">
          {t.avatar ? (
            <img src={t.avatar} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="hf-avatar-fb">{t.username[0].toUpperCase()}</span>
          )}
        </span>
        <span className="hf-follow-name">{t.username}</span>
        <span className="hf-follow-cta">Voir le profil</span>
      </Link>
    </article>
  );
}

// ============================================================
//  Interactions (commentaires / réponses / likes / réactions)
// ============================================================

// Un avis sans texte ni +/− n'est qu'une note : on adapte le vocabulaire
// (« a réagi à la NOTE de » plutôt qu'« à l'avis de »).
const reviewIsJustARating = (review) =>
  !!review &&
  !review.text &&
  !(review.pros?.length > 0) &&
  !(review.cons?.length > 0);

// Aperçu de l'avis visé par une interaction : jaquette + note + extrait
// (avec l'avatar de l'auteur à côté de SON texte), cliquable vers l'onglet
// Reviews de la fiche jeu.
function ReviewPreview({ review, game, owner }) {
  const hidden = review.spoiler;
  const isNote = reviewIsJustARating(review);
  return (
    <Link to={`/game/${game.id}?tab=reviews`} className="hf-rvprev clickable">
      <span className="hf-rvprev-cover">
        {review.gameCover ? (
          <img src={review.gameCover} alt={game.name} loading="lazy" draggable="false" />
        ) : (
          <span className="hf-rvprev-cover-ph">
            <Gamepad2 size={18} />
          </span>
        )}
      </span>
      <span className="hf-rvprev-main">
        <span className="hf-rvprev-head">
          <span className="hf-rvprev-title">
            {isNote ? "Note" : "Avis"} {owner?.username ? `de ${owner.username} ` : ""}
            sur {game.name}
          </span>
          {review.rating != null && (
            <span className="hf-rating sm">
              <Star size={11} fill="currentColor" strokeWidth={0} />
              {review.rating}%
            </span>
          )}
        </span>
        {review.text ? (
          <span className="hf-rvprev-quote">
            <span className="hf-rvprev-av" title={owner?.username}>
              {owner?.avatar ? (
                <img src={owner.avatar} alt="" loading="lazy" draggable="false" />
              ) : (
                <span className="hf-rvprev-av-fb">
                  {(owner?.username || "?")[0].toUpperCase()}
                </span>
              )}
            </span>
            <span className={`hf-rvprev-text ${hidden ? "blur" : ""}`}>
              {review.text}
            </span>
          </span>
        ) : (
          (review.pros?.length > 0 || review.cons?.length > 0) && (
            <span className="hf-proscons">
              {review.pros.map((p, i) => (
                <span key={`p${i}`} className="hf-pro">
                  <ThumbsUp size={11} /> {p}
                </span>
              ))}
              {review.cons.map((c, i) => (
                <span key={`c${i}`} className="hf-con">
                  <ThumbsDown size={11} /> {c}
                </span>
              ))}
            </span>
          )
        )}
        {hidden && (
          <span className="hf-rvprev-spoiler">
            <EyeOff size={11} /> Spoiler — voir sur la fiche du jeu
          </span>
        )}
      </span>
      <ExternalLink size={14} className="hf-rvprev-go" />
    </Link>
  );
}

// Icône de la réaction posée (le type est stocké dans snippet).
const REACT_BADGES = {
  heart: { Icon: Heart, color: "#e0483f" },
  clap: { Icon: PartyPopper, color: "#9a6bff" },
  funny: { Icon: Laugh, color: "#f2b70b" },
};

function InteractionEvent({ item }) {
  const meta = ACTION_META[item.action];
  if (!meta) return null;
  const target = item.target?.username;
  const reviewUrl = item.game ? `/game/${item.game.id}?tab=reviews` : null;
  // Réaction à un avis : la pastille montre LA réaction posée (cœur/bravo/rigolo).
  const reactBadge =
    item.action === "review_react" ? REACT_BADGES[item.snippet] : null;
  const BadgeIcon = reactBadge?.Icon || meta.Icon;
  // « l'avis de » devient « la note de » quand l'avis visé n'a ni texte ni +/−.
  const verb =
    meta.ctx === "review" && reviewIsJustARating(item.review)
      ? meta.verb.replace("l'avis de", "la note de")
      : meta.verb;

  return (
    <article className="hf-card hf-interaction">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span
            className={`hf-int-badge act-${item.action}`}
            style={reactBadge ? { color: reactBadge.color } : undefined}
          >
            <BadgeIcon size={13} fill={reactBadge ? "currentColor" : "none"} />
          </span>
        }
      >
        {verb}
        {target && (
          <>
            {" "}
            <Link to={`/u/${target}`} className="hf-int-target clickable">
              {target}
            </Link>
          </>
        )}
      </EventHead>

      {meta.quote && item.snippet && <p className="hf-int-quote">{item.snippet}</p>}

      {item.list && <ListMini list={item.list} />}

      {meta.ctx === "review" &&
        item.game &&
        reviewUrl &&
        (item.review ? (
          <ReviewPreview review={item.review} game={item.game} owner={item.target} />
        ) : (
          <Link to={reviewUrl} className="hf-int-gamechip clickable">
            <Star size={13} fill="currentColor" strokeWidth={0} />
            <span>Avis sur {item.game.name}</span>
            <ExternalLink size={13} />
          </Link>
        ))}
    </article>
  );
}

// ============================================================
//  Repost : fan art republié (image locale)
// ============================================================
function RepostEvent({ item, me, onLike, onComments, onRepost, onOpenImage, onRemove }) {
  const r = item.repost;
  const g = item.game;
  const isMine = me && item.user.username === me;
  return (
    <article className="hf-card hf-repost">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          isMine && onRemove ? (
            <button
              className="hf-del clickable"
              onClick={onRemove}
              title="Retirer de mon feed"
              aria-label="Retirer de mon feed"
            >
              <Trash2 size={15} />
            </button>
          ) : null
        }
      >
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

// ============================================================
//  Pépites indés — cliquer la carte ouvre la liste des trouvailles
// ============================================================
function GemsEvent({ item, onOpenGems }) {
  const names = item.seeds.map((s) => s.name);
  return (
    <article className="hf-card hf-gems">
      <EventHead user={item.user} date={item.date}>
        <Gem size={13} className="hf-inline-ic" /> est parti à la chasse aux
        pépites indés
      </EventHead>

      <div className="hf-gems-body clickable" onClick={onOpenGems} title="Voir ses pépites">
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

// ============================================================
//  Documentaire recommandé
// ============================================================
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

// ============================================================
//  Lightboxes (fan art plein écran, lecture d'un documentaire)
// ============================================================
export function FanartLightbox({ item, onClose }) {
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

export function VideoLightbox({ item, onClose }) {
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

// Squelette de chargement commun aux deux fils.
export function FeedCardsSkeleton({ count = 3 }) {
  return (
    <div className="hf-feed" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
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
