import { useEffect, useMemo, useState } from "react";
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
  Gift,
  Plus,
  Flame,
  Infinity as InfinityIcon,
  Disc3,
  Headphones,
  Trophy,
  Swords,
  Music2,
  Grid2x2,
  Download,
  Megaphone,
  Cherry,
  Skull,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  VenetianMask,
} from "lucide-react";
import { PackageOpen, Sparkles as SparklesIc, Copy as CopyIc } from "lucide-react";
import { rarityColor, rarityLabel } from "../lib/rarity";
import RewardArt from "./RewardArt";
import { apiFetch } from "../lib/api";
import { downloadImage } from "../lib/download";
import { timeAgo, fmtDuration } from "../lib/lists";
import { usePlayPlaylist } from "../lib/usePlayPlaylist";
import { extractVideoId } from "../lib/youtube";
import { usePlayer } from "../context/PlayerContext";
import ReviewComments from "./ReviewComments";
import ReviewThreadModal from "./ReviewThreadModal";
import { CommentThreadModal } from "./ListComments";
import { MediaGrid, PostText, PostEmbed, extractEmbeds, SharePostButton } from "./GameMediaWall";
import { WantedModal } from "./WantedPoster";

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
  playlist: { label: "PlayList", Icon: Disc3 },
};

// Mot (au bon pluriel) pour le contenu d'une liste : jeux, personnages ou OST.
const kindWord = (itemKind, n) =>
  itemKind === "character"
    ? n > 1
      ? "personnages"
      : "personnage"
    : itemKind === "ost"
      ? "OST"
      : n > 1
        ? "jeux"
        : "jeu";

// Interactions sociales : verbe + icône + contexte (liste ou avis) + faut-il
// afficher l'extrait (le texte commenté / liké). `target` = à qui appartient
// le contenu visé (propriétaire de la liste, auteur du commentaire répondu…).
const ACTION_META = {
  list_comment: { Icon: MessageCircle, verb: "a commenté la liste de", ctx: "list", quote: true },
  comment_reply: { Icon: CornerDownRight, verb: "a répondu à", ctx: "list", quote: true },
  list_like: { Icon: Heart, verb: "a aimé la liste de", ctx: "list", quote: false },
  comment_like: { Icon: Heart, verb: "a aimé un commentaire de", ctx: "list", quote: true },
  playlist_listen: { Icon: Headphones, verb: "écoute la playlist de", ctx: "list", quote: false },
  review_comment: { Icon: MessageCircle, verb: "a commenté l'avis de", ctx: "review", quote: true },
  review_comment_reply: { Icon: CornerDownRight, verb: "a répondu à", ctx: "review", quote: true },
  review_comment_like: { Icon: Heart, verb: "a aimé une réponse de", ctx: "review", quote: true },
  review_react: { Icon: Heart, verb: "a réagi à l'avis de", ctx: "review", quote: false },
  // Recommandations de jeux (target = destinataire) — cf. routes/recommendations.js
  recommendation: { Icon: Gift, verb: "a recommandé un jeu à", ctx: "reco", quote: true },
  recommendation_boost: { Icon: ThumbsUp, verb: "a soutenu une recommandation faite à", ctx: "reco", quote: false },
  recommendation_comment: { Icon: MessageCircle, verb: "a commenté une recommandation faite à", ctx: "reco", quote: true },
};

// Réactions possibles sur un avis (mêmes clés que l'onglet Reviews).
const REACTIONS = [
  { key: "heart", label: "Coup de cœur", Icon: Heart, color: "#e0483f" },
  { key: "clap", label: "Bravo", Icon: PartyPopper, color: "#9a6bff" },
  { key: "funny", label: "Rigolo", Icon: Laugh, color: "#f2b70b" },
];

// Ordre de priorité pour choisir le VERBE principal d'une carte jeu quand
// plusieurs actions sont regroupées (le reste devient chips / lignes détail).
const CHANGE_PRIORITY = ["status", "added", "bundle", "review", "rating", "ost", "character", "favorite", "time"];

// ============================================================
//  Dispatcher
// ============================================================
// Évènements portant un post du mur média : le post lui-même, ou un
// commentaire dessus — mêmes actions (like du post, fil de réponses), donc
// même aiguillage côté fils (HomeFeed / ProfileFeed).
export const isPostItem = (i) =>
  i?.type === "gamemediapost" || i?.type === "gamemediacomment";

export function FeedCard(props) {
  const { item } = props;
  if (item.type === "game") return <GameEvent {...props} />;
  if (item.type === "gamegroup") return <GameGroupEvent {...props} />;
  if (item.type === "list") return <ListEvent {...props} />;
  if (item.type === "listadd") return <ListAddEvent {...props} />;
  if (item.type === "follow") return <FollowEvent {...props} />;
  if (item.type === "interaction") return <InteractionEvent {...props} />;
  if (item.type === "repost") return <RepostEvent {...props} />;
  if (item.type === "gamemediapost") return <GameMediaPostEvent {...props} />;
  if (item.type === "gamemediacomment") return <GameMediaCommentEvent {...props} />;
  if (item.type === "video") return <VideoEvent {...props} />;
  if (item.type === "videoact") return <VideoActivityEvent {...props} />;
  if (item.type === "videoactgroup") return <VideoActivityGroupEvent {...props} />;
  // Rétro-compat : anciens noms d'évènements « vidéo regardée ».
  if (item.type === "videowatch")
    return <VideoActivityEvent {...props} item={{ ...item, kind: "watch" }} />;
  if (item.type === "videowatchgroup")
    return <VideoActivityGroupEvent {...props} item={{ ...item, kind: "watch" }} />;
  if (item.type === "download") return <DownloadEvent {...props} />;
  if (item.type === "gems") return <GemsEvent {...props} />;
  if (item.type === "blindtest") return <BlindTestEvent {...props} />;
  if (item.type === "blindtestgroup") return <BlindTestGroupEvent {...props} />;
  if (item.type === "pixel") return <PixelRushEvent {...props} />;
  if (item.type === "pixelgroup") return <PixelRushGroupEvent {...props} />;
  if (item.type === "caseopen") return <CaseOpenEvent {...props} />;
  if (item.type === "caseopengroup") return <CaseOpenGroupEvent {...props} />;
  if (item.type === "trackermatch") return <TrackerMatchEvent {...props} />;
  if (item.type === "trackermatchgroup") return <TrackerMatchGroupEvent {...props} />;
  if (item.type === "rankchange") return <RankChangeEvent {...props} />;
  return null;
}

// En-tête commun : avatar + « pseudo <action> » + date relative.
export function EventHead({ user, date, children, badge }) {
  return (
    <header className="hf-head">
      <Link
        to={`/u/${user.username}`}
        className="hf-avatar clickable"
        onClick={(e) => e.stopPropagation()}
      >
        {user.avatar ? (
          <img src={user.avatar} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="hf-avatar-fb">{user.username[0].toUpperCase()}</span>
        )}
      </Link>
      <div className="hf-who">
        <span className="hf-line">
          <Link
            to={`/u/${user.username}`}
            className="hf-user clickable"
            onClick={(e) => e.stopPropagation()}
          >
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
    // Progression bundle : « a terminé <jeu inclus> dans <bundle> » — le
    // bundle lui-même n'est PAS marqué terminé pour autant.
    if (kind === "bundle") {
      const names = c.names || [];
      const verb =
        names.length === 1
          ? `a terminé ${names[0]} dans`
          : names.length > 1
            ? `a terminé ${names.length} jeux de`
            : "a progressé dans";
      return { kind, verb, Icon: CircleCheck, cls: "finished" };
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
            <rc.Icon size={15} fill={on && rc.key === "heart" ? "currentColor" : "none"} />
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

  // Carte « nue » : rien à montrer d'autre que la jaquette (aucune note, avis,
  // OST, personnage, plateforme, temps, chip…) — typiquement « a envie de jouer
  // à X ». On passe alors sur une seule ligne (petite jaquette + nom) plutôt que
  // de gaspiller deux lignes juste pour l'image.
  const hasChip =
    item.rating != null ||
    (statusMeta && primary.kind !== "status" && primary.kind !== "added") ||
    !!item.platform ||
    !!item.bundle ||
    item.playtimeHours != null ||
    item.favorite ||
    kinds.has("favorite");
  const bare = !item.hasReview && !item.ost && !item.character && !hasChip;

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

      <div
        className={`hf-game-body clickable ${bare ? "bare" : ""}`}
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
        {bare ? (
          <span className="hf-game-bare-name">{g.name}</span>
        ) : (
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
            {item.bundle && (
              <span className={`hf-chip bundle ${kinds.has("bundle") ? "new" : ""}`}>
                <Layers size={11} /> {item.bundle.done}/{item.bundle.total} terminés
              </span>
            )}
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

          {/* Mini-jaquettes des jeux inclus dans le bundle (terminés en couleur) */}
          {item.bundle?.games?.length > 0 && (
            <div className="hf-bundle-games" onClick={(e) => e.stopPropagation()}>
              {item.bundle.games.map((bg) => (
                <Link
                  key={bg.id}
                  to={`/game/${bg.id}`}
                  className={`hf-bundle-g clickable ${bg.done ? "done" : ""}`}
                  title={bg.done ? `${bg.name} — terminé` : bg.name}
                >
                  {bg.cover ? (
                    <img src={bg.cover} alt={bg.name} loading="lazy" draggable="false" />
                  ) : (
                    <span className="hf-bundle-g-ph">
                      <Gamepad2 size={13} />
                    </span>
                  )}
                  {bg.done && (
                    <span className="hf-bundle-g-check">
                      <CircleCheck size={12} strokeWidth={2.6} />
                    </span>
                  )}
                </Link>
              ))}
              {item.bundle.total > item.bundle.games.length && (
                <span className="hf-bundle-g-more">
                  +{item.bundle.total - item.bundle.games.length}
                </span>
              )}
            </div>
          )}

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
        )}
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
export function ListMini({ list, showTracks = false }) {
  const navigate = useNavigate();
  // Les playlists d'OST ont leur propre mini-carte (CD écoutable).
  if (list.type === "playlist")
    return <PlaylistMini list={list} showTracks={showTracks} />;
  const meta = LIST_TYPE_META[list.type] || LIST_TYPE_META.classic;
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
          {list.itemCount} {kindWord(list.itemKind, list.itemCount)}
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

// Mini-carte PlayList du fil : un CD (la pochette, ou la première piste) qui
// tourne si c'est la playlist en cours d'écoute, écoutable directement.
// `showTracks` : affiche en plus les miniatures des premières OST, chacune
// écoutable d'un clic (cartes « a créé / a ajouté des OST »).
function PlaylistMini({ list, showTracks = false }) {
  const navigate = useNavigate();
  const player = usePlayer();
  const { launching, playPlaylist } = usePlayPlaylist(list);
  const isActive = player.source?.href === `/lists/${list.id}`;
  const spinning = isActive && player.playing;
  const discArt = list.cover || list.preview?.[0] || null;
  const tracks = list.tracks || [];

  // Écoute express d'une miniature : file = les pistes embarquées dans la carte.
  function playTrack(e, t) {
    e.stopPropagation();
    const toTrack = (x) => ({
      id: x.refId,
      videoId: x.videoId,
      url: x.url,
      name: x.name,
      artist: x.artist,
      artwork: x.image,
      gameId: x.gameId,
      gameName: x.gameName,
    });
    player.toggleTrack(toTrack(t), tracks.map(toTrack), {
      source: { href: `/lists/${list.id}`, label: list.title },
    });
  }

  return (
    <div
      className="hf-pl clickable"
      onClick={() => navigate(`/lists/${list.id}`)}
      title={list.title}
    >
      <div className="hf-pl-row">
        <span className={`hf-pl-cd ${spinning ? "spinning" : ""}`}>
          <span className="hf-pl-cd-face">
            {discArt ? (
              <img src={discArt} alt="" loading="lazy" draggable="false" />
            ) : (
              <Music size={18} />
            )}
            <span className="hf-pl-cd-grooves" />
            <span className="hf-pl-cd-hole" />
          </span>
        </span>

        <div className="hf-pl-info">
          <span className="hf-pl-type">
            <Disc3 size={12} /> PlayList
          </span>
          <h4 className="hf-pl-title">
            {isActive && (
              <span className={`pld-eq ${player.playing ? "" : "paused"}`} aria-hidden="true">
                <i /><i /><i />
              </span>
            )}
            {list.title}
          </h4>
          <span className="hf-pl-meta">
            {list.itemCount} piste{list.itemCount > 1 ? "s" : ""}
            {list.durationSec > 0 && (
              <>
                {" · "}
                {list.durationEstimated ? "≈ " : ""}
                {fmtDuration(list.durationSec)}
              </>
            )}
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

        {list.itemCount > 0 && (
          <button
            className="hf-pl-play clickable"
            title={spinning ? "Pause" : "Écouter la playlist"}
            aria-label="Écouter la playlist"
            onClick={(e) => {
              if (isActive) {
                e.stopPropagation();
                player.toggle();
              } else {
                playPlaylist(e);
              }
            }}
          >
            {launching ? (
              <Loader2 size={16} className="spin" />
            ) : spinning ? (
              <Pause size={16} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={16} fill="currentColor" strokeWidth={0} />
            )}
          </button>
        )}
      </div>

      {/* Miniatures des OST, écoutables en un clic */}
      {showTracks && tracks.length > 0 && (
        <div className="hf-pl-tracks">
          {tracks.map((t) => {
            const cur = player.isCurrent(t);
            const isPlaying = player.isPlaying(t);
            return (
              <button
                key={t.refId}
                className={`hf-pl-track clickable ${cur ? "current" : ""}`}
                onClick={(e) => playTrack(e, t)}
                title={`${t.name}${t.gameName ? ` — ${t.gameName}` : ""}`}
              >
                <span className="hf-pl-track-art">
                  {t.image ? (
                    <img src={t.image} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <Music size={14} />
                  )}
                  <span className={`hf-pl-track-play ${isPlaying ? "on" : ""}`}>
                    {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                  </span>
                </span>
                <span className="hf-pl-track-name">{t.name}</span>
              </button>
            );
          })}
          {list.itemCount > tracks.length && (
            <span className="hf-pl-track-more">+{list.itemCount - tracks.length}</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- Liste / playlist créée ---
function ListEvent({ item }) {
  const isPlaylist = item.list.type === "playlist";
  return (
    <article className="hf-card hf-list">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          isPlaylist ? (
            <span className="hf-status-badge st-playlist">
              <Disc3 size={13} />
            </span>
          ) : undefined
        }
      >
        {isPlaylist ? "a créé une playlist" : "a créé une liste"}
      </EventHead>
      <ListMini list={item.list} showTracks />
    </article>
  );
}

// --- Éléments ajoutés à une liste / des OST ajoutées à une playlist ---
function ListAddEvent({ item }) {
  const isPlaylist = item.list.type === "playlist";
  const kind = kindWord(item.list.itemKind, item.count);
  const what = item.count > 1 ? `${item.count} ${kind}` : `${item.list.itemKind === "ost" ? "une" : "un"} ${kind}`;
  return (
    <article className="hf-card hf-list">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-status-badge ${isPlaylist ? "st-playlist" : "st-listadd"}`}>
            {isPlaylist ? <Disc3 size={13} /> : <ListPlus size={13} />}
          </span>
        }
      >
        a ajouté {what} à sa {isPlaylist ? "playlist" : "liste"}
      </EventHead>
      <ListMini list={item.list} showTracks />
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

function InteractionEvent({ item, token }) {
  const meta = ACTION_META[item.action];
  const [thread, setThread] = useState(null); // "list" | "review" | null
  if (!meta) return null;
  const target = item.target?.username;
  const reviewUrl = item.game ? `/game/${item.game.id}?tab=reviews` : null;
  // Contexte recommandation : le lien du destinataire mène à son onglet Reco.
  const targetUrl = meta.ctx === "reco" ? `/u/${target}?tab=reco` : `/u/${target}`;
  // Réaction à un avis : la pastille montre LA réaction posée (cœur/bravo/rigolo).
  const reactBadge =
    item.action === "review_react" ? REACT_BADGES[item.snippet] : null;
  const BadgeIcon = reactBadge?.Icon || meta.Icon;
  // « l'avis de » devient « la note de » quand l'avis visé n'a ni texte ni +/−.
  let verb =
    meta.ctx === "review" && reviewIsJustARating(item.review)
      ? meta.verb.replace("l'avis de", "la note de")
      : meta.verb;
  // Contexte playlist : le vocabulaire suit (« a aimé la playlist de… »).
  if (item.list?.type === "playlist") verb = verb.replace("la liste de", "la playlist de");

  // Clic sur la carte → ouvre le fil focalisé sur le commentaire/réponse visé
  // (modale liste réutilisée pour les listes, modale d'avis pour les reviews).
  // Sur du contenu ancien sans commentId/propriétaire, on garde la navigation.
  const commentId = item.commentId || null;
  const listThread = meta.ctx === "list" && item.list && commentId;
  const reviewThread = meta.ctx === "review" && item.game && item.reviewOwnerId;
  const openable = listThread || reviewThread;
  const open = () => setThread(reviewThread ? "review" : "list");
  // Intercepte AVANT la navigation propre du contenu (Link / ListMini).
  const intercept = openable
    ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
    : undefined;
  // Nom du propriétaire de l'avis à afficher : seulement s'il coïncide avec la
  // cible (commentaire racine / réaction) — pour une réponse, la cible n'est
  // pas le propriétaire.
  const reviewOwnerName =
    item.reviewOwnerId && item.target?.id === item.reviewOwnerId
      ? item.target.username
      : null;

  return (
    <>
      <article
        className={`hf-card hf-interaction ${openable ? "clickable" : ""}`}
        onClick={openable ? open : undefined}
      >
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
              <Link
                to={targetUrl}
                className="hf-int-target clickable"
                onClick={(e) => e.stopPropagation()}
              >
                {target}
              </Link>
            </>
          )}
        </EventHead>

        {meta.quote && item.snippet && <p className="hf-int-quote">{item.snippet}</p>}

        {item.list && (
          <div onClickCapture={intercept}>
            <ListMini list={item.list} />
          </div>
        )}

        {/* Contexte recommandation : mini-carte du jeu recommandé + bouton +1 */}
        {meta.ctx === "reco" && item.game && (
          <RecoPreview item={item} token={token} />
        )}

        {meta.ctx === "review" && item.game && reviewUrl && (
          <div onClickCapture={intercept}>
            {item.review ? (
              <ReviewPreview review={item.review} game={item.game} owner={item.target} />
            ) : (
              <Link to={reviewUrl} className="hf-int-gamechip clickable">
                <Star size={13} fill="currentColor" strokeWidth={0} />
                <span>Avis sur {item.game.name}</span>
                <ExternalLink size={13} />
              </Link>
            )}
          </div>
        )}
      </article>

      {thread === "list" && (
        <CommentThreadModal
          listId={item.list.id}
          commentId={commentId}
          token={token}
          onClose={() => setThread(null)}
        />
      )}
      {thread === "review" && (
        <ReviewThreadModal
          gameId={item.game.id}
          reviewUserId={item.reviewOwnerId}
          gameName={item.game.name}
          ownerName={reviewOwnerName}
          commentId={commentId}
          token={token}
          onClose={() => setThread(null)}
        />
      )}
    </>
  );
}

// Mini-carte du jeu recommandé : jaquette + infos (année, genre, note) +
// bouton +1 — mêmes règles que l'onglet Recommandations du profil : un
// recommandeur ne peut pas +1 (flamme), sinon toggle optimiste sur l'endpoint
// /recommendations/:id/boost. `item.reco` est absent si la reco a été retirée
// depuis : la carte reste mais sans bouton.
function RecoPreview({ item, token }) {
  const navigate = useNavigate();
  const g = item.game;
  const [reco, setReco] = useState(item.reco || null);
  const [busy, setBusy] = useState(false);

  async function boost(e) {
    e.stopPropagation();
    if (!reco || busy || reco.iRecommended || !token) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/recommendations/${reco.id}/boost`, {
        method: "POST",
        token,
      });
      setReco((r) => ({ ...r, iBoosted: !!d.boosted, count: d.count }));
    } catch {
      /* le +1 retentera au prochain clic */
    } finally {
      setBusy(false);
    }
  }

  const metaLine = [g.year, ...(g.genres || []).slice(0, 1)].filter(Boolean);

  return (
    <div
      className="hf-reco clickable"
      onClick={() => navigate(`/game/${g.id}`)}
      title={g.name}
    >
      <span className="hf-reco-cover">
        {g.cover ? (
          <img src={g.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="hf-reco-ph">
            <Gamepad2 size={18} />
          </span>
        )}
      </span>
      <span className="hf-reco-info">
        <span className="hf-reco-name">{g.name}</span>
        <span className="hf-reco-meta">
          {metaLine.length > 0 && <span>{metaLine.join(" · ")}</span>}
          {g.rating != null && (
            <span className="hf-rating sm">
              <Star size={11} fill="currentColor" strokeWidth={0} />
              {g.rating}%
            </span>
          )}
        </span>
      </span>
      {reco && (
        <button
          className={`reco-plus clickable ${reco.iBoosted ? "on" : ""} ${
            reco.iRecommended ? "mine" : ""
          }`}
          onClick={boost}
          disabled={busy || reco.iRecommended}
          title={
            reco.iRecommended
              ? "Tu as recommandé ce jeu"
              : reco.iBoosted
                ? "Retirer ton +1"
                : "Faire +1"
          }
        >
          {reco.iRecommended ? <Flame size={14} /> : <Plus size={14} />}
          <b>{reco.count}</b>
        </button>
      )}
    </div>
  );
}

// ============================================================
//  Repost : fan art republié (image locale)
// ============================================================
// ============================================================
//  « X a posté <un clip / deux screens / un tweet…> sur <jeu> » : post du mur
//  média d'un jeu, rendu comme sur la fiche (texte + médias avec flou spoiler
//  + embeds), likable / commentable directement depuis le fil.
// ============================================================

// Ce qui a été posté, en français : clips (vidéos), screens (images/GIF),
// mélange → « des médias » ; sinon les liens (tweet / vidéo / TikTok) ;
// texte seul → rien (« a posté sur … »).
function postKindLabel(media, embeds) {
  const vids = (media || []).filter((m) => m.kind === "video").length;
  const imgs = (media || []).length - vids;
  const n = (count, one, plural) =>
    count === 1 ? one : count === 2 ? `deux ${plural}` : `${count} ${plural}`;
  if (vids && imgs) return "des médias";
  if (vids) return n(vids, "un clip", "clips");
  if (imgs) return n(imgs, "un screen", "screens");
  if (embeds.length) {
    const kinds = new Set(embeds.map((e) => e.kind));
    if (kinds.size > 1) return "des liens";
    const k = embeds[0].kind;
    if (k === "twitter") return n(embeds.length, "un tweet", "tweets");
    if (k === "youtube") return n(embeds.length, "une vidéo", "vidéos");
    if (k === "tiktok") return n(embeds.length, "un TikTok", "TikToks");
    return "des liens";
  }
  return null;
}

function GameMediaPostEvent({ item, onLike, onComments, onOpenImage }) {
  const p = item.post;
  const g = item.game;
  const { embeds, hide } = useMemo(() => extractEmbeds(p.text), [p.text]);
  const kindLabel = postKindLabel(p.media, embeds);
  return (
    <article className="hf-card hf-gmpost">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          g?.cover ? (
            <Link
              to={`/game/${g.id}?tab=feed`}
              className="hf-gmpost-cover clickable"
              title={g.name}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            </Link>
          ) : null
        }
      >
        <Flame size={13} className="hf-inline-ic" /> a posté
        {kindLabel ? ` ${kindLabel}` : ""}
        {g?.id ? (
          <>
            {" "}
            sur{" "}
            <Link
              to={`/game/${g.id}?tab=feed`}
              className="hf-gmpost-game clickable"
              onClick={(e) => e.stopPropagation()}
            >
              {g.name}
            </Link>
          </>
        ) : null}
      </EventHead>

      <div className="hf-gmpost-body">
        <PostText text={p.text} hide={hide} mentions={p.mentions} />
        {p.media?.length > 0 && (
          <MediaGrid media={p.media} forceReveal={false} onOpen={(i) => onOpenImage?.(i)} />
        )}
        {embeds.map((e, i) => (
          <PostEmbed key={i} embed={e} />
        ))}
      </div>

      <div className="hf-actions">
        <button
          className={`hf-act like clickable ${p.liked ? "on" : ""}`}
          onClick={onLike}
          title="J'aime"
        >
          <Heart size={16} fill={p.liked ? "currentColor" : "none"} />
          <span>{p.likeCount > 0 ? p.likeCount : ""}</span>
        </button>
        <button className="hf-act clickable" onClick={onComments} title="Répondre">
          <MessageCircle size={16} />
          <span>{p.commentCount > 0 ? p.commentCount : ""}</span>
        </button>
        {(p.media || []).some((m) => m.kind === "video") && (
          <SharePostButton post={p} className="hf-act" size={16} />
        )}
      </div>
    </article>
  );
}

// Commentaire / réponse sur un post du mur média. Carte volontairement sobre :
// la citation du commentaire + un rappel compact du post visé. Le clic ouvre le
// post et ses réponses en modale (like, réponse, like des réponses).
function GameMediaCommentEvent({ item, onComments }) {
  const p = item.post;
  const g = item.game;
  const isReply = item.action === "gamemedia_comment_reply";
  const Icon = isReply ? CornerDownRight : MessageCircle;
  // Aperçu du post visé : son texte, sinon la nature de son contenu.
  const { embeds } = useMemo(() => extractEmbeds(p?.text), [p?.text]);
  const thumb = (p?.media || []).find((m) => !m.spoiler);
  const preview =
    (p?.text || "").trim() || postKindLabel(p?.media, embeds) || "un post";

  return (
    <article className="hf-card hf-gmcom clickable" onClick={onComments}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className="hf-int-badge act-gamemedia_comment">
            <Icon size={13} />
          </span>
        }
      >
        {isReply ? "a répondu à" : "a commenté le post de"}
        {item.target?.username && (
          <>
            {" "}
            <Link
              to={`/u/${item.target.username}`}
              className="hf-int-target clickable"
              onClick={(e) => e.stopPropagation()}
            >
              {item.target.username}
            </Link>
          </>
        )}
        {g?.id && (
          <>
            {" "}
            sur{" "}
            <Link
              to={`/game/${g.id}?tab=feed`}
              className="hf-gmpost-game clickable"
              onClick={(e) => e.stopPropagation()}
            >
              {g.name}
            </Link>
          </>
        )}
      </EventHead>

      {item.snippet && <p className="hf-int-quote">{item.snippet}</p>}

      <div className="hf-gmcom-src">
        {thumb ? (
          <span className="hf-gmcom-thumb">
            <img
              src={thumb.kind === "video" ? thumb.thumbnail || "" : thumb.url}
              alt=""
              loading="lazy"
              draggable="false"
            />
            {thumb.kind === "video" && (
              <span className="hf-gmcom-play">
                <Play size={11} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </span>
        ) : g?.cover ? (
          <span className="hf-gmcom-thumb">
            <img src={g.cover} alt="" loading="lazy" draggable="false" />
          </span>
        ) : null}
        <span className="hf-gmcom-src-txt">
          <strong>{p?.author?.username || "?"}</strong> {preview}
        </span>
        <span className="hf-gmcom-counts">
          <Heart size={13} fill={p?.liked ? "currentColor" : "none"} className={p?.liked ? "on" : ""} />
          {p?.likeCount > 0 ? p.likeCount : ""}
          <MessageCircle size={13} />
          {p?.commentCount > 0 ? p.commentCount : ""}
        </span>
      </div>
    </article>
  );
}

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
//  Délit de téléchargement — « X a téléchargé Y depuis Z » (card moqueuse)
// ============================================================

// Réactions moqueuses (toggles indépendants) — endpoint /downloads/:id/react.
const DL_REACTIONS = [
  { key: "boo", label: "Huez le", Icon: Megaphone, color: "#e0483f" },
  { key: "tomato", label: "Lui jeter une tomate", Icon: Cherry, color: "#d63a3a" },
  { key: "monster", label: "T'es un monstre !", Icon: Skull, color: "#7b61ff" },
];

// Emplacements pseudo-aléatoires (stables, indexés) où éclaboussent les tomates
// pourries lancées sur le post — autant de tomates que de réactions « tomate ».
const SPLAT_SPOTS = [
  { top: "14%", left: "16%", r: -18, s: 1 },
  { top: "60%", left: "9%", r: 12, s: 0.82 },
  { top: "26%", left: "74%", r: 24, s: 1.12 },
  { top: "72%", left: "63%", r: -9, s: 0.9 },
  { top: "43%", left: "38%", r: 30, s: 1.06 },
  { top: "13%", left: "52%", r: -26, s: 0.78 },
  { top: "80%", left: "30%", r: 16, s: 0.96 },
  { top: "36%", left: "88%", r: -14, s: 0.88 },
  { top: "55%", left: "82%", r: 20, s: 0.84 },
  { top: "84%", left: "48%", r: -20, s: 1.04 },
  { top: "22%", left: "33%", r: 8, s: 0.9 },
  { top: "48%", left: "58%", r: -30, s: 1 },
];

// Enveloppe positionnée d'une décoration jetée sur le post (position + rotation
// figées ici ; l'élément interne gère sa propre animation d'apparition).
function SplatWrap({ spot, wrap, extraRotate = 0, children }) {
  return (
    <span
      className="hf-dl-splat"
      style={{
        top: spot.top,
        left: spot.left,
        transform: `translate(-50%, -50%) rotate(${spot.r + wrap * 15 + extraRotate}deg) scale(${spot.s})`,
      }}
    >
      {children}
    </span>
  );
}

// Une tomate pourrie écrasée (SVG maison — pas d'emoji). Éclaboussure + pépins.
function TomatoSplat({ spot, wrap, delay }) {
  return (
    <SplatWrap spot={spot} wrap={wrap}>
      <svg
        className="hf-dl-tomato"
        viewBox="0 0 100 100"
        style={{ animationDelay: delay }}
        aria-hidden="true"
      >
      <g fill="#7c1414">
        <circle cx="14" cy="30" r="6" />
        <circle cx="86" cy="42" r="7" />
        <circle cx="72" cy="82" r="5" />
        <circle cx="24" cy="80" r="6.5" />
        <circle cx="50" cy="12" r="5" />
      </g>
      <path
        fill="#a51d1d"
        d="M50 20c16 0 30 12 30 29 0 19-15 31-30 31S20 68 20 49c0-17 14-29 30-29z"
      />
      <path
        fill="#c62d2d"
        d="M50 27c13 0 24 10 24 23 0 15-12 24-24 24s-24-9-24-24c0-13 11-23 24-23z"
      />
      <g fill="#e9b7b7" opacity="0.85">
        <ellipse cx="42" cy="44" rx="3.4" ry="2.4" transform="rotate(-25 42 44)" />
        <ellipse cx="57" cy="41" rx="3.2" ry="2.2" transform="rotate(20 57 41)" />
        <ellipse cx="52" cy="56" rx="3.2" ry="2.2" transform="rotate(-8 52 56)" />
      </g>
      <path
        fill="#4c7a2e"
        d="M50 22l-6-8 6 3 6-3-6 8z"
        transform="translate(0 4)"
      />
      </svg>
    </SplatWrap>
  );
}

// Bulle de BD « HOU ! » qui jaillit (effet du bouton « Huez le »).
function BooBubble({ spot, wrap, delay }) {
  return (
    <SplatWrap spot={spot} wrap={wrap} extraRotate={-spot.r - wrap * 15}>
      <span className="hf-dl-boo" style={{ animationDelay: delay }}>
        HOU&nbsp;!
      </span>
    </SplatWrap>
  );
}

// Petit crâne qui rôde (effet du bouton « T'es un monstre ! »).
function SkullMark({ spot, wrap, delay }) {
  return (
    <SplatWrap spot={spot} wrap={wrap}>
      <Skull className="hf-dl-skull" size={30} style={{ animationDelay: delay }} />
    </SplatWrap>
  );
}

function DownloadEvent({ item, token }) {
  const g = item.game;
  const gameUrl = `/game/${g.id}?tab=patches`;
  const [counts, setCounts] = useState(
    item.reactions || { boo: 0, tomato: 0, monster: 0 }
  );
  const [mine, setMine] = useState(item.myReactions || []);
  const [busy, setBusy] = useState(false);
  const [wantedOpen, setWantedOpen] = useState(false); // avis de recherche agrandi

  async function react(type) {
    if (!token || busy) return;
    const had = mine.includes(type);
    setMine((m) => (had ? m.filter((t) => t !== type) : [...m, type]));
    setCounts((c) => ({
      ...c,
      [type]: Math.max(0, (c[type] || 0) + (had ? -1 : 1)),
    }));
    setBusy(true);
    try {
      const d = await apiFetch(`/downloads/${item.downloadId}/react`, {
        method: "POST",
        token,
        body: { type },
      });
      setCounts(d.counts);
      setMine(d.mine);
    } catch {
      // Rollback en cas d'échec réseau.
      setMine((m) => (had ? [...m, type] : m.filter((t) => t !== type)));
      setCounts((c) => ({
        ...c,
        [type]: Math.max(0, (c[type] || 0) + (had ? 1 : -1)),
      }));
    } finally {
      setBusy(false);
    }
  }

  // Une décoration par réaction (plafonnée pour ne pas tout recouvrir) : des
  // tomates pourries, des « HOU ! » et des crânes jetés sur le post.
  const tomatoes = Math.min(counts.tomato || 0, 30);
  const boos = Math.min(counts.boo || 0, 24);
  const skulls = Math.min(counts.monster || 0, 24);

  return (
    <article className="hf-card hf-download">
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className="hf-status-badge st-download">
            <Download size={13} />
          </span>
        }
      >
        a téléchargé{" "}
        <Link to={gameUrl} className="hf-game-link clickable">
          {g.name}
        </Link>{" "}
        sur <b className="hf-dl-src">{item.source}</b>
      </EventHead>

      <div className="hf-dl-row">
        <Link to={gameUrl} className="hf-dl-body clickable">
          <div className="hf-cover">
            {g.cover ? (
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-cover-ph">
                <Gamepad2 size={20} />
              </span>
            )}
          </div>
          <div className="hf-dl-info">
            <span className="hf-dl-name">{g.name}</span>
            <span className="hf-dl-caught">
              <Download size={12} /> Butin récupéré sur {item.source}
            </span>
          </div>
        </Link>

        {/* Prime : chaque jeu piraté ajoute 60 $ à la rançon. Clic → avis. */}
        <button
          className="hf-dl-bounty clickable"
          onClick={() => setWantedOpen(true)}
          title={`Voir l'avis de recherche de ${item.user?.username || "ce joueur"}`}
        >
          <span className="hf-dl-bounty-amount">+60&nbsp;$</span>
          <span className="hf-dl-bounty-link">Voir l'avis de recherche</span>
        </button>
      </div>

      <div className="hf-dl-reacts" role="group" aria-label="Réagir au délit">
        {DL_REACTIONS.map((rc) => {
          const on = mine.includes(rc.key);
          const n = counts[rc.key] || 0;
          return (
            <button
              key={rc.key}
              className={`hf-dl-react clickable ${on ? "on" : ""}`}
              style={{ "--dl-c": rc.color }}
              onClick={() => react(rc.key)}
              title={rc.label}
            >
              <rc.Icon size={15} />
              <span>{rc.label}</span>
              {n > 0 && <b className="hf-dl-react-n">{n}</b>}
            </button>
          );
        })}
      </div>

      {wantedOpen && (
        <WantedModal
          username={item.user?.username}
          token={token}
          onClose={() => setWantedOpen(false)}
        />
      )}

      {/* Décorations jetées sur le post, une par réaction. Chaque type démarre à
          un offset différent dans les emplacements pour ne pas se superposer. */}
      {(tomatoes > 0 || boos > 0 || skulls > 0) && (
        <div className="hf-dl-splats" aria-hidden="true">
          {Array.from({ length: tomatoes }).map((_, i) => (
            <TomatoSplat
              key={`t${i}`}
              spot={SPLAT_SPOTS[i % SPLAT_SPOTS.length]}
              wrap={Math.floor(i / SPLAT_SPOTS.length)}
              delay={`${(i % SPLAT_SPOTS.length) * 40}ms`}
            />
          ))}
          {Array.from({ length: boos }).map((_, i) => {
            const j = i + 4; // offset : évite de recouvrir les tomates
            return (
              <BooBubble
                key={`b${i}`}
                spot={SPLAT_SPOTS[j % SPLAT_SPOTS.length]}
                wrap={Math.floor(j / SPLAT_SPOTS.length)}
                delay={`${(i % SPLAT_SPOTS.length) * 45}ms`}
              />
            );
          })}
          {Array.from({ length: skulls }).map((_, i) => {
            const j = i + 8; // offset différent des deux autres
            return (
              <SkullMark
                key={`s${i}`}
                spot={SPLAT_SPOTS[j % SPLAT_SPOTS.length]}
                wrap={Math.floor(j / SPLAT_SPOTS.length)}
                delay={`${(i % SPLAT_SPOTS.length) * 45}ms`}
              />
            );
          })}
        </div>
      )}
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
//  Blind test terminé — « Voir les résultats » ouvre la modale de détail
//  (manches, réponses, écoute), d'où on peut aussi tenter le même défi
// ============================================================
function BlindTestEvent({ item, onOpenBlindTest }) {
  const pct = item.total ? Math.round((item.correct / item.total) * 100) : 0;
  const ch = item.challenge;
  return (
    <article className="hf-card hf-blindtest">
      <EventHead user={item.user} date={item.date}>
        <Music2 size={13} className="hf-inline-ic" />{" "}
        {ch ? (
          <>
            a défié <b>{ch.username}</b> au blind test
          </>
        ) : (
          "a fait un blind test musical"
        )}
      </EventHead>

      <div className="hf-bt-body">
        <div className="hf-bt-scorebox">
          <span className="hf-bt-score-num">{item.score}</span>
          <span className="hf-bt-score-lbl">points</span>
        </div>
        <div className="hf-bt-meta">
          <span className="hf-bt-stat">
            <Trophy size={13} /> {item.correct}/{item.total} trouvés · {pct}%
          </span>
          {ch && (
            <span className={`hf-bt-versus ${ch.beaten ? "win" : "lose"}`}>
              <Swords size={12} />
              {ch.beaten
                ? `bat ${ch.username} (${ch.score})`
                : `${ch.username} garde la tête (${ch.score})`}
            </span>
          )}
        </div>
      </div>

      <button
        className="hf-bt-challenge-cta clickable"
        onClick={() => onOpenBlindTest()}
      >
        <Disc3 size={15} /> Voir les résultats
      </button>
    </article>
  );
}

// ============================================================
//  Caisse ouverte — le lot obtenu, mis en scène par sa rareté
// ============================================================
// La couleur de rareté pilote toute la carte (aura, liseré, étiquette) : on
// reconnaît une belle prise avant même d'avoir lu le nom du lot.
function CaseOpenEvent({ item }) {
  const color = rarityColor(item.rarity);
  const reward = { type: item.rewardType || "cursor", data: item.art || {} };
  return (
    <article className="hf-card hf-drop" style={{ "--drop-rarity": color }}>
      <EventHead user={item.user} date={item.date}>
        <PackageOpen size={13} className="hf-inline-ic" /> a ouvert une caisse
      </EventHead>

      <div className="hf-drop-body">
        <span className="hf-drop-aura" aria-hidden="true" />
        <span className="hf-drop-art">
          <RewardArt reward={reward} size={52} />
        </span>
        <span className="hf-drop-info">
          <span className="hf-drop-rarity">{rarityLabel(item.rarity)}</span>
          <strong className="hf-drop-name">{item.rewardName}</strong>
          {item.duplicate ? (
            <span className="hf-drop-dup">
              <CopyIc size={11} /> doublon, reconverti en points
            </span>
          ) : (
            <span className="hf-drop-new">
              <SparklesIc size={11} /> nouveau dans sa collection
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

// Plusieurs caisses d'affilée → une seule carte. La plus belle prise tient la
// vedette, les autres défilent en petites vignettes sous elle.
function CaseOpenGroupEvent({ item }) {
  const best = item.best;
  // Vignette sous le curseur (ou épinglée d'un clic, seul geste possible au
  // doigt) : c'est ELLE que la vedette affiche, pour détailler chaque lot du
  // lot sans quitter la carte. `null` → retour à la plus belle prise.
  const [peek, setPeek] = useState(null);
  const shown = peek || best;
  const color = rarityColor(shown.rarity);
  const shownReward = { type: shown.rewardType || "cursor", data: shown.art || {} };

  return (
    <article className="hf-card hf-drop hf-dropg" style={{ "--drop-rarity": color }}>
      <EventHead user={item.user} date={item.date}>
        <PackageOpen size={13} className="hf-inline-ic" /> a ouvert {item.count}{" "}
        caisses
      </EventHead>

      <div className="hf-drop-body">
        <span className="hf-drop-aura" aria-hidden="true" />
        <span className="hf-drop-art">
          <RewardArt reward={shownReward} size={52} />
        </span>
        <span className="hf-drop-info">
          <span className="hf-drop-rarity">
            {rarityLabel(shown.rarity)}
            {shown === best && " · plus belle prise"}
          </span>
          <strong className="hf-drop-name">{shown.rewardName}</strong>
          {/* Au survol on décrit CE lot ; au repos, le bilan de la série. */}
          {peek ? (
            peek.duplicate ? (
              <span className="hf-drop-dup">
                <CopyIc size={11} /> doublon, reconverti en points
              </span>
            ) : (
              <span className="hf-drop-new">
                <SparklesIc size={11} /> nouveau dans sa collection
              </span>
            )
          ) : (
            <span className="hf-drop-new">
              <SparklesIc size={11} /> {item.count} lots obtenus
            </span>
          )}
        </span>
      </div>

      <ul className="hf-dropg-list">
        {item.drops.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className={`hf-dropg-chip clickable ${d === best ? "best" : ""} ${
                d === peek ? "peek" : ""
              }`}
              style={{ "--drop-rarity": rarityColor(d.rarity) }}
              title={`${d.rewardName} · ${rarityLabel(d.rarity)}${
                d.duplicate ? " (doublon)" : ""
              }`}
              onMouseEnter={() => setPeek(d)}
              onMouseLeave={() => setPeek((p) => (p === d ? null : p))}
              onFocus={() => setPeek(d)}
              onBlur={() => setPeek((p) => (p === d ? null : p))}
              onClick={() => setPeek((p) => (p === d ? null : d))}
            >
              <RewardArt
                reward={{ type: d.rewardType || "cursor", data: d.art || {} }}
                size={26}
              />
              {d.duplicate && <i className="hf-dropg-dup" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

// Plusieurs blind tests d'affilée du même joueur → une seule carte avec la
// liste des parties (chacune ouvrant ses résultats). Le score le mieux réussi
// est mis en avant.
function BlindTestGroupEvent({ item, onOpenBlindTest }) {
  return (
    <article className="hf-card hf-blindtest hf-btg">
      <EventHead user={item.user} date={item.date}>
        <Music2 size={13} className="hf-inline-ic" /> a fait {item.count} blind
        tests musicaux
      </EventHead>

      <div className="hf-btg-summary">
        <div className="hf-bt-scorebox">
          <span className="hf-bt-score-num">{item.bestScore}</span>
          <span className="hf-bt-score-lbl">meilleur</span>
        </div>
        <span className="hf-btg-summary-txt">
          {item.count} parties · {item.best.correct}/{item.best.total} au top
        </span>
      </div>

      <ul className="hf-btg-list">
        {item.games.map((g) => {
          const pct = g.total ? Math.round((g.correct / g.total) * 100) : 0;
          const best = g.score === item.bestScore;
          return (
            <li key={g.id} className={`hf-btg-row ${best ? "best" : ""}`}>
              <span className="hf-btg-pts">
                <b>{g.score}</b> pts
              </span>
              <span className="hf-btg-stat">
                <Trophy size={12} /> {g.correct}/{g.total} · {pct}%
              </span>
              {g.challenge && (
                <span className={`hf-btg-vs ${g.challenge.beaten ? "win" : "lose"}`}>
                  <Swords size={11} /> {g.challenge.username}
                </span>
              )}
              <span className="hf-btg-time">{timeAgo(g.date)}</span>
              <button
                className="hf-btg-see clickable"
                onClick={() => onOpenBlindTest({ ...g, user: item.user })}
              >
                <Disc3 size={14} /> Voir
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ============================================================
//  Pixel Rush terminé — mêmes cartes que le blind test (le contrat des
//  évènements est identique), à l'accent et au vocabulaire près : ici on
//  « reconnaît » des captures, on n'« écoute » pas des extraits.
// ============================================================
function PixelRushEvent({ item, onOpenPixel }) {
  const pct = item.total ? Math.round((item.correct / item.total) * 100) : 0;
  const ch = item.challenge;
  return (
    <article className="hf-card hf-blindtest hf-pixel">
      <EventHead user={item.user} date={item.date}>
        <Grid2x2 size={13} className="hf-inline-ic" />{" "}
        {ch ? (
          <>
            a défié <b>{ch.username}</b> à Pixel Rush
          </>
        ) : (
          "a fait une partie de Pixel Rush"
        )}
      </EventHead>

      <div className="hf-bt-body">
        <div className="hf-bt-scorebox">
          <span className="hf-bt-score-num">{item.score}</span>
          <span className="hf-bt-score-lbl">points</span>
        </div>
        <div className="hf-bt-meta">
          <span className="hf-bt-stat">
            <Trophy size={13} /> {item.correct}/{item.total} reconnus · {pct}%
          </span>
          {ch && (
            <span className={`hf-bt-versus ${ch.beaten ? "win" : "lose"}`}>
              <Swords size={12} />
              {ch.beaten
                ? `bat ${ch.username} (${ch.score})`
                : `${ch.username} garde la tête (${ch.score})`}
            </span>
          )}
        </div>
      </div>

      <button className="hf-bt-challenge-cta clickable" onClick={() => onOpenPixel()}>
        <Grid2x2 size={15} /> Voir les captures
      </button>
    </article>
  );
}

// Plusieurs parties d'affilée du même joueur → une seule carte.
function PixelRushGroupEvent({ item, onOpenPixel }) {
  return (
    <article className="hf-card hf-blindtest hf-pixel hf-btg">
      <EventHead user={item.user} date={item.date}>
        <Grid2x2 size={13} className="hf-inline-ic" /> a fait {item.count} parties
        de Pixel Rush
      </EventHead>

      <div className="hf-btg-summary">
        <div className="hf-bt-scorebox">
          <span className="hf-bt-score-num">{item.bestScore}</span>
          <span className="hf-bt-score-lbl">meilleur</span>
        </div>
        <span className="hf-btg-summary-txt">
          {item.count} parties · {item.best.correct}/{item.best.total} au top
        </span>
      </div>

      <ul className="hf-btg-list">
        {item.games.map((g) => {
          const pct = g.total ? Math.round((g.correct / g.total) * 100) : 0;
          const best = g.score === item.bestScore;
          return (
            <li key={g.id} className={`hf-btg-row ${best ? "best" : ""}`}>
              <span className="hf-btg-pts">
                <b>{g.score}</b> pts
              </span>
              <span className="hf-btg-stat">
                <Trophy size={12} /> {g.correct}/{g.total} · {pct}%
              </span>
              {g.challenge && (
                <span className={`hf-btg-vs ${g.challenge.beaten ? "win" : "lose"}`}>
                  <Swords size={11} /> {g.challenge.username}
                </span>
              )}
              <span className="hf-btg-time">{timeAgo(g.date)}</span>
              <button
                className="hf-btg-see clickable"
                onClick={() => onOpenPixel({ ...g, user: item.user })}
              >
                <Grid2x2 size={14} /> Voir
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// ============================================================
//  Parties de jeux trackés (Marvel Rivals…)
// ============================================================
// Couleurs sémantiques du KDA (alignées sur l'onglet Tracking du profil).
const TRK_GREEN = "#1b9d55";
const TRK_GOLD = "#eaa908";
const TRK_RED = "#d8524a";
const trkKdaColor = (k) => (k >= 3 ? TRK_GREEN : k >= 2 ? TRK_GOLD : TRK_RED);

// Pastille de saison (jaquette IGDB) posée dans le coin de l'en-tête de carte.
function SeasonChip({ image, label }) {
  if (!image && !label) return null;
  return (
    <span className="hf-trk-season" title={label || "Saison"}>
      {image ? (
        <img src={image} alt="" loading="lazy" draggable="false" />
      ) : (
        <Trophy size={12} />
      )}
      {label && <span className="hf-trk-season-lbl">{label}</span>}
    </span>
  );
}

// Un « clic n'importe où » sur la carte mène à l'onglet Tracking du profil.
// Les liens internes (avatar / pseudo) coupent la propagation de leur côté.
function useTrackingNav(username) {
  const navigate = useNavigate();
  const go = () => navigate(`/u/${username}?tab=tracking`);
  return {
    className: "clickable",
    role: "link",
    tabIndex: 0,
    onClick: go,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    },
  };
}

// Pastille « Smurf » des cartes de tracking : la partie / montée de rang vient
// d'un compte secondaire (slot > 0), on affiche son pseudo pour lever le doute.
function SmurfChip({ account }) {
  if (!account?.smurf) return null;
  return (
    <span className="hf-trk-tag smurf" title="Compte secondaire (smurf)">
      <VenetianMask size={11} />
      {account.name || "Smurf"}
    </span>
  );
}

// Ligne K/D/A colorée + issue de la partie (réutilisée simple / groupe).
function TrkKda({ m }) {
  return (
    <span className="hf-trk-kda" style={{ color: trkKdaColor(m.kda) }}>
      <b>
        {m.k}/{m.d}/{m.a}
      </b>
      <em>{m.kda} KDA</em>
    </span>
  );
}

// Points de classement gagnés/perdus sur une partie classée (« +34 » / « -25 »).
// Rien à afficher hors classée (scoreDelta null).
function TrkDelta({ v, unit }) {
  if (v == null) return null;
  const up = v >= 0;
  return (
    <span className={`hf-trk-delta ${up ? "up" : "down"}`}>
      {up ? "+" : "−"}
      {Math.abs(v)}
      {unit && <i>RS</i>}
    </span>
  );
}

// Une seule partie : héros joué + K/D/A + issue.
function TrackerMatchEvent({ item }) {
  const m = item.match;
  const nav = useTrackingNav(item.user.username);
  return (
    <article {...nav} className={`hf-card hf-trk clickable ${m.win ? "win" : "loss"}`}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={<SeasonChip image={item.seasonImage} label={item.seasonLabel} />}
      >
        <Swords size={13} className="hf-inline-ic" /> a joué une partie de{" "}
        <b>{item.game}</b> <SmurfChip account={item.account} />
      </EventHead>

      <div className="hf-trk-single">
        <div className="hf-trk-hero">
          {m.hero?.thumb ? (
            <img src={m.hero.thumb} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="hf-trk-hero-fb">{(m.hero?.name || "?")[0]}</span>
          )}
        </div>
        <div className="hf-trk-single-info">
          <span className="hf-trk-hero-name">
            {m.hero?.name || "Héros"}
            {m.ranked && <span className="hf-trk-tag ranked">Classé</span>}
          </span>
          <span className="hf-trk-kda-line">
            <TrkKda m={m} />
            <TrkDelta v={m.scoreDelta} unit />
          </span>
        </div>
        <span className={`hf-trk-res ${m.win ? "win" : "loss"}`}>
          {m.win ? <Trophy size={12} /> : <X size={12} />}
          {m.win ? "Victoire" : "Défaite"}
        </span>
      </div>
    </article>
  );
}

// Plusieurs parties d'affilée → « a enchaîné N parties » : héros le plus joué en
// grand, bilan V/D + KDA moyen, puis la liste des parties.
function TrackerMatchGroupEvent({ item }) {
  const total = item.count;
  const wr = total ? Math.round((item.wins / total) * 100) : 0;
  const nav = useTrackingNav(item.user.username);
  return (
    <article {...nav} className="hf-card hf-trk hf-trkg clickable">
      <EventHead
        user={item.user}
        date={item.date}
        badge={<SeasonChip image={item.seasonImage} label={item.seasonLabel} />}
      >
        <Swords size={13} className="hf-inline-ic" /> a enchaîné{" "}
        <b>{item.count} parties</b> sur <b>{item.game}</b>{" "}
        <SmurfChip account={item.account} />
      </EventHead>

      <div className="hf-trkg-summary">
        <div className="hf-trk-hero big">
          {item.topHero?.thumb ? (
            <img src={item.topHero.thumb} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="hf-trk-hero-fb">{(item.topHero?.name || "?")[0]}</span>
          )}
        </div>
        <div className="hf-trkg-stats">
          {item.topHero?.name && (
            <span className="hf-trkg-hero">{item.topHero.name}</span>
          )}
          <div className="hf-trkg-nums">
            <span className="hf-trkg-wl">
              <b className="win">{item.wins}V</b> · <b className="loss">{item.losses}D</b>
            </span>
            <span className="hf-trkg-sep">·</span>
            <span>{wr}% WR</span>
            <span className="hf-trkg-sep">·</span>
            <span>
              <b style={{ color: trkKdaColor(item.avgKda) }}>{item.avgKda}</b> KDA moy.
            </span>
            {item.rankedCount > 0 && (
              <span className="hf-trk-tag ranked">
                {item.rankedCount} classée{item.rankedCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="hf-trkg-list">
        {item.matches.slice(0, 6).map((m) => (
          <li key={m.matchUid} className={`hf-trkg-row ${m.win ? "win" : "loss"}`}>
            <span
              className={`hf-trkg-res ${m.win ? "win" : "loss"}`}
              title={m.win ? "Victoire" : "Défaite"}
            />
            <span className="hf-trkg-row-hero">
              {m.hero?.thumb && (
                <img src={m.hero.thumb} alt="" loading="lazy" draggable="false" />
              )}
              <span className="hf-trkg-row-name">{m.hero?.name || "Héros"}</span>
              {m.ranked && <span className="hf-trk-tag ranked sm">Classé</span>}
            </span>
            <span className="hf-trkg-row-kda" style={{ color: trkKdaColor(m.kda) }}>
              {m.k}/{m.d}/{m.a}
            </span>
            <span className="hf-trkg-row-delta">
              <TrkDelta v={m.scoreDelta} />
            </span>
            <span className="hf-trkg-row-time">{timeAgo(m.date)}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ============================================================
//  Montée / descente de rang classé (session) — avec réactions
// ============================================================
// Vignette d'un rang : badge + libellé de palier (+ RS sur le grand).
function RankBadge({ r, big }) {
  return (
    <span className={`hf-rank-badge ${big ? "big" : "small"}`}>
      {r.image ? (
        <img src={r.image} alt="" loading="lazy" draggable="false" />
      ) : (
        <Trophy size={big ? 22 : 15} />
      )}
      <span className="hf-rank-txt">
        <span className="hf-rank-tier">{r.tier || "Non classé"}</span>
        {big && r.score != null && (
          <span className="hf-rank-rs">{r.score.toLocaleString("fr-FR")} RS</span>
        )}
      </span>
    </span>
  );
}

// « X est passé Grandmaster 2 » (montée) / « X est descendu … » (descente).
// Réactions single-select (féliciter / soutenir), comme les avis.
function RankChangeEvent({ item, me, token }) {
  const up = item.direction === "up";
  const [reactions, setReactions] = useState(item.reactions || null);
  const [myReaction, setMyReaction] = useState(item.myReaction || null);
  const isMine = me && item.user.username === me;

  async function react(type) {
    if (!token || isMine) return;
    const prev = { reactions, myReaction };
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
      const res = await apiFetch(`/trackers/rank-changes/${item.rankChangeId}/react`, {
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

  return (
    <article className={`hf-card hf-rank ${up ? "up" : "down"}`}>
      <EventHead
        user={item.user}
        date={item.date}
        badge={
          <span className={`hf-rank-dir ${up ? "up" : "down"}`}>
            {up ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          </span>
        }
      >
        {up ? (
          <>
            <TrendingUp size={13} className="hf-inline-ic" /> est passé{" "}
            <b>{item.current.tier}</b> sur <b>{item.game}</b>{" "}
            <SmurfChip account={item.account} />
          </>
        ) : (
          <>
            <TrendingDown size={13} className="hf-inline-ic" /> est descendu{" "}
            <b>{item.current.tier}</b> sur <b>{item.game}</b>{" "}
            <SmurfChip account={item.account} />
          </>
        )}
      </EventHead>

      <Link
        to={`/u/${item.user.username}?tab=tracking`}
        className="hf-rank-body clickable"
      >
        <RankBadge r={item.old} />
        <ArrowRight size={20} className="hf-rank-arrow" />
        <RankBadge r={item.current} big />
        {item.hero?.thumb && (
          <span className="hf-rank-hero" title={item.hero.name}>
            <img src={item.hero.thumb} alt="" loading="lazy" draggable="false" />
          </span>
        )}
      </Link>

      <p className="hf-rank-caption">
        {up
          ? "Belle grimpette — envoie-lui un peu d'amour."
          : "Petite descente… un soutien fait toujours du bien."}
      </p>

      <FeedReactions
        reactions={reactions}
        myReaction={myReaction}
        readOnly={isMine || !token}
        onReact={react}
      />
    </article>
  );
}

// ============================================================
//  Vidéo recommandée (like / regarder plus tard / commenter / lire)
// ============================================================
function VideoEvent({ item, onPlay, onLike, onLater, onComments }) {
  const v = item.video;
  return (
    <article className="hf-card hf-video">
      <EventHead user={item.user} date={item.date}>
        <Clapperboard size={13} className="hf-inline-ic" /> recommande une vidéo
      </EventHead>

      <button className="hf-video-thumb clickable" onClick={() => onPlay(v)} title={v.title}>
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

      <div className="hf-actions">
        <button
          className={`hf-act like clickable ${v.liked ? "on" : ""}`}
          onClick={onLike}
          title="J'aime"
        >
          <Heart size={16} fill={v.liked ? "currentColor" : "none"} />
          <span>{v.likeCount > 0 ? v.likeCount : ""}</span>
        </button>
        <button className="hf-act clickable" onClick={onComments} title="Commentaires">
          <MessageCircle size={16} />
          <span>{v.commentCount > 0 ? v.commentCount : ""}</span>
        </button>
        <button
          className={`hf-act clickable ${v.later ? "on" : ""}`}
          onClick={onLater}
          title={v.later ? "Retirer de « à regarder plus tard »" : "Regarder plus tard"}
        >
          <Clock size={16} />
          <span>{v.later ? "Ajouté" : "Plus tard"}</span>
        </button>
      </div>
    </article>
  );
}

// ============================================================
//  Activité vidéo : regardée / aimée / commentée / « plus tard »
//  (cartes génériques pilotées par item.kind, groupées côté serveur)
// ============================================================
const VIDEO_ACT_META = {
  watch: {
    Icon: Play,
    filled: true,
    one: "a regardé une vidéo",
    many: (n) => `a regardé ${n} vidéos`,
  },
  like: {
    Icon: Heart,
    filled: true,
    one: "a aimé une vidéo",
    many: (n) => `a aimé ${n} vidéos`,
  },
  comment: {
    Icon: MessageCircle,
    filled: false,
    one: "a commenté une vidéo",
    many: (n) => `a commenté ${n} vidéos`,
  },
  // Pas de « à regarder plus tard » : le serveur n'en fait plus d'évènement
  // (file d'attente privée, cf. routes/feed.js).
};

// Barre de reprise (visionnage) : proportion vue si on a la durée.
function resumePct(v) {
  if (v.durationSeconds > 0)
    return Math.min(100, Math.round((v.positionSeconds / v.durationSeconds) * 100));
  return v.positionSeconds > 0 ? 6 : 0;
}

function VideoActivityEvent({ item, onPlay, onComments }) {
  const v = item.video;
  const meta = VIDEO_ACT_META[item.kind] || VIDEO_ACT_META.watch;
  const pct = item.kind === "watch" ? resumePct(v) : 0;

  // « A commenté une vidéo » : ce qui compte c'est le message, pas la vidéo —
  // carte compacte façon tweet (citation + miniature réduite en pied), et le
  // tout ouvre le fil de commentaires de la vidéo.
  if (item.kind === "comment") {
    return (
      <article className="hf-card hf-video hf-vact hf-vmini k-comment">
        <EventHead user={item.user} date={item.date}>
          <span className="hf-vact-ic k-comment">
            <MessageCircle size={13} />
          </span>{" "}
          a commenté une vidéo
        </EventHead>

        <div className="hf-vcom">
          {v.comment && (
            <button
              className="hf-vcom-quote clickable"
              onClick={onComments}
              title="Voir les commentaires"
            >
              <p className="hf-int-quote">{v.comment}</p>
            </button>
          )}
          {/* La miniature lance la vidéo, le reste ouvre le fil : deux boutons
              côte à côte (imbriquer des <button> serait invalide). */}
          <div className="hf-vmini-row">
            <button
              className="hf-vmini-thumb clickable"
              onClick={() => onPlay(v)}
              title="Lire la vidéo"
            >
              <img src={v.thumb} alt="" loading="lazy" draggable="false" />
              <span className="hf-vmini-play">
                <Play size={15} fill="currentColor" />
              </span>
              {v.duration && <span className="hf-video-dur">{v.duration}</span>}
            </button>
            <button
              className="hf-vmini-info clickable"
              onClick={onComments}
              title="Voir les commentaires"
            >
              <span className="hf-vmini-title">{v.title}</span>
              {v.author && <span className="hf-vmini-by">{v.author}</span>}
              <span className="hf-vcom-cta">
                <MessageCircle size={13} />
                {v.commentCount > 1
                  ? `${v.commentCount} commentaires`
                  : "Voir le fil"}
              </span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  // « A aimé une vidéo » = a aimé la recommandation d'un autre joueur. Carte
  // compacte : verbe adapté (« a aimé une recommandation de X »), avatar du
  // recommandeur sur la miniature réduite, le tout cliquable pour lire.
  if (item.kind === "like") {
    const rec =
      v.recommender && v.recommender.id !== item.user.id ? v.recommender : null;
    return (
      <article className="hf-card hf-video hf-vact hf-vmini k-like">
        <EventHead user={item.user} date={item.date}>
          <span className="hf-vact-ic k-like">
            <Heart size={13} fill="currentColor" />
          </span>{" "}
          {rec ? (
            <>
              a aimé une recommandation de{" "}
              <Link to={`/u/${rec.username}`} className="hf-user clickable">
                {rec.username}
              </Link>
            </>
          ) : (
            "a aimé une vidéo"
          )}
        </EventHead>

        <button
          className="hf-vmini-row clickable"
          onClick={() => onPlay(v)}
          title={v.title}
        >
          <span className="hf-vmini-thumb">
            <img src={v.thumb} alt="" loading="lazy" draggable="false" />
            <span className="hf-vmini-play">
              <Play size={15} fill="currentColor" />
            </span>
            {v.duration && <span className="hf-video-dur">{v.duration}</span>}
            {rec && (
              <span
                className="hf-vmini-rec"
                title={`Recommandé par ${rec.username}`}
              >
                {rec.avatar ? (
                  <img src={rec.avatar} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="hf-vmini-rec-fb">
                    {rec.username[0].toUpperCase()}
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="hf-vmini-info">
            <span className="hf-vmini-title">{v.title}</span>
            {v.author && <span className="hf-vmini-by">{v.author}</span>}
          </span>
        </button>
      </article>
    );
  }

  return (
    <article className={`hf-card hf-video hf-vact k-${item.kind}`}>
      <EventHead user={item.user} date={item.date}>
        <span className={`hf-vact-ic k-${item.kind}`}>
          <meta.Icon size={13} fill={meta.filled ? "currentColor" : "none"} />
        </span>{" "}
        {meta.one}
      </EventHead>

      <button className="hf-video-thumb clickable" onClick={() => onPlay(v)} title={v.title}>
        <img src={v.thumb} alt="" loading="lazy" draggable="false" />
        <span className="hf-video-play">
          <Play size={22} fill="currentColor" />
        </span>
        {v.duration && <span className="hf-video-dur">{v.duration}</span>}
        {pct > 0 && pct < 100 && (
          <span className="hf-video-bar" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>

      <div className="hf-video-info">
        <h4 className="hf-video-title">{v.title}</h4>
        <span className="hf-video-meta">
          {v.author && <span>{v.author}</span>}
          {v.game && (
            <Link to={`/game/${v.game.id}`} className="hf-video-game clickable">
              <Gamepad2 size={12} /> {v.game.name}
            </Link>
          )}
        </span>
      </div>
    </article>
  );
}

function VideoActivityGroupEvent({ item, onPlay }) {
  const videos = item.videos || [];
  const meta = VIDEO_ACT_META[item.kind] || VIDEO_ACT_META.watch;
  return (
    <article className={`hf-card hf-video hf-vact-group k-${item.kind}`}>
      <EventHead user={item.user} date={item.date}>
        <span className={`hf-vact-ic k-${item.kind}`}>
          <meta.Icon size={13} fill={meta.filled ? "currentColor" : "none"} />
        </span>{" "}
        {meta.many(videos.length)}
      </EventHead>

      <div className="hf-vact-grid">
        {videos.map((v) => (
          <button
            key={v.id}
            className="hf-vact-item clickable"
            onClick={() => onPlay(v)}
            title={v.title}
          >
            <span className="hf-vact-thumb">
              <img src={v.thumb} alt="" loading="lazy" draggable="false" />
              <span className="hf-vact-play">
                <Play size={16} fill="currentColor" />
              </span>
              {v.duration && <span className="hf-video-dur">{v.duration}</span>}
            </span>
            <span className="hf-vact-cap">{v.title}</span>
          </button>
        ))}
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
      <button
        className="gp-feed-lb-dl clickable"
        onClick={(e) => {
          e.stopPropagation();
          downloadImage(r.image, `fanart-${item.game?.name || r.source || "art"}`);
        }}
        aria-label="Télécharger"
        title="Télécharger"
      >
        <Download size={20} />
      </button>
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
