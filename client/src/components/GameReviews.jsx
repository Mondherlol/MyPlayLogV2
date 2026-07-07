import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Loader2,
  Star,
  ThumbsUp,
  ThumbsDown,
  Heart,
  PartyPopper,
  Laugh,
  Plus,
  X,
  Trash2,
  EyeOff,
  Eye,
  Play,
  Pause,
  Trophy,
  Ban,
  Clock,
  Gamepad,
  Check,
  PenLine,
  Gamepad2,
  SlidersHorizontal,
  MessageCircle,
  ExternalLink,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { timeAgo } from "../lib/lists";
import { Composer, renderMessage } from "./ListComments";
import ReviewComments from "./ReviewComments";

const PLAYED = ["playing", "finished", "paused", "dropped"];

const STATUS_META = {
  playing: { label: "En cours", Icon: Play },
  finished: { label: "Terminé", Icon: Trophy },
  paused: { label: "En pause", Icon: Pause },
  dropped: { label: "Abandonné", Icon: Ban },
  wishlist: { label: "À jouer", Icon: Clock },
};

const SORTS = [
  { key: "recent", label: "Plus récentes" },
  { key: "best", label: "Mieux notées" },
  { key: "worst", label: "Moins bien notées" },
];

const SENTIMENTS = [
  { key: "all", label: "Toutes", Icon: Gamepad2 },
  { key: "positive", label: "Positives", Icon: ThumbsUp },
  { key: "negative", label: "Négatives", Icon: ThumbsDown },
];

// Seuil au-dessus duquel une review notée est considérée « positive ».
const POSITIVE_MIN = 60;

const REACTIONS = [
  { key: "heart", label: "Coup de cœur", Icon: Heart, color: "#e0483f" },
  { key: "clap", label: "Bravo", Icon: PartyPopper, color: "#9a6bff" },
  { key: "funny", label: "Rigolo", Icon: Laugh, color: "#f2b70b" },
];

const ratingColor = (v) =>
  v == null ? "var(--text-soft)" : v < 40 ? "#e0483f" : v < 70 ? "#f2b70b" : "#22a35a";

function ScoreRing({ value }) {
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <div className="rv-ring" style={{ "--rc": ratingColor(value) }} title={`${value}/100`}>
      <svg viewBox="0 0 48 48">
        <circle className="rv-ring-bg" cx="24" cy="24" r={R} />
        <circle
          className="rv-ring-fg"
          cx="24"
          cy="24"
          r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - value / 100)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="rv-ring-num">{value}</span>
    </div>
  );
}

// Jauge de note semi-circulaire — reprise à l'identique de PlayedModal.
function RatingGauge({ value, active, onEnable, onChange, onClear }) {
  const R = 56;
  const CX = 70;
  const CY = 66;
  const SW = 12;
  const L = Math.PI * R;
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const offset = L * (1 - (active ? value : 0) / 100);
  const color =
    !active ? "var(--border-strong)" : value < 40 ? "#e0483f" : value < 70 ? "#f2b70b" : "#22a35a";
  const inputRef = useRef(null);
  const [txt, setTxt] = useState(String(value));

  useEffect(() => {
    setTxt(String(value));
  }, [value]);
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  function onInput(e) {
    let v = e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    if (v === "") {
      setTxt("");
      return;
    }
    const n = Math.max(0, Math.min(100, parseInt(v, 10)));
    setTxt(String(n));
    onChange(n);
  }

  return (
    <div className="rating-gauge">
      <div className="gauge-vis">
        <svg viewBox="0 0 140 78" className="gauge-svg">
          <path d={arc} fill="none" stroke="var(--border-strong)" strokeWidth={SW} strokeLinecap="round" />
          {active && (
            <path
              d={arc}
              fill="none"
              stroke={color}
              strokeWidth={SW}
              strokeLinecap="round"
              strokeDasharray={L}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 0.3s ease, stroke 0.3s ease" }}
            />
          )}
        </svg>
        <div className="gauge-center">
          {active ? (
            <input
              ref={inputRef}
              type="number"
              min="0"
              max="100"
              value={txt}
              onChange={onInput}
              onFocus={(e) => e.target.select()}
              onBlur={() => txt === "" && setTxt(String(value))}
              className="gauge-input"
              style={{ color }}
            />
          ) : (
            <button className="gauge-noter clickable" onClick={onEnable}>
              Noter
            </button>
          )}
        </div>
      </div>
      {active && (
        <button className="gauge-clear clickable" onClick={onClear}>
          <X size={12} /> retirer la note
        </button>
      )}
    </div>
  );
}

// Éditeur de listes de points forts / faibles.
function ChipEditor({ label, Icon, tone, items, onChange }) {
  const [val, setVal] = useState("");
  function add() {
    const v = val.trim();
    if (!v) return;
    onChange([...items, v]);
    setVal("");
  }
  return (
    <div className={`chip-editor ${tone}`}>
      <div className="chip-editor-head">
        <Icon size={15} /> {label}
      </div>
      <div className="chip-input">
        <input
          type="text"
          placeholder="Ajouter…"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <button className="chip-add clickable" onClick={add} type="button">
          <Plus size={15} />
        </button>
      </div>
      {items.length > 0 && (
        <div className="chip-list">
          {items.map((it, i) => (
            <span className={`pc-chip ${tone}`} key={i}>
              {it}
              <button
                className="clickable"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                aria-label="Retirer"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Interrupteur « spoiler » (switch à bascule).
function SpoilerSwitch({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`grv-switch clickable ${on ? "on" : ""}`}
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      title="Marquer la review comme spoiler"
    >
      <EyeOff size={14} />
      <span className="grv-switch-label">Spoilers</span>
      <span className="grv-switch-track">
        <span className="grv-switch-knob" />
      </span>
    </button>
  );
}

// Formulaire complet de review (affiché dans la modal).
function ReviewEditor({ game, token, initial, isNew, onSaved }) {
  const [review, setReview] = useState(initial?.review || "");
  const [media, setMedia] = useState(initial?.media || []);
  const [spoiler, setSpoiler] = useState(!!initial?.spoiler);
  const [pros, setPros] = useState(initial?.pros || []);
  const [cons, setCons] = useState(initial?.cons || []);
  const [rating, setRating] = useState(initial?.rating ?? null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const { entry } = await apiFetch(`/library/${game.id}`, {
        method: "PUT",
        token,
        body: {
          name: game.name,
          cover: game.cover,
          review: review.trim(),
          reviewMedia: media,
          spoiler,
          pros,
          cons,
          rating,
          ...(isNew ? { status: "finished" } : {}),
        },
      });
      onSaved(entry);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grv-editor">
      <div className="grv-editor-head">
        <div className="grv-editor-headmain">
          <span className="grv-editor-cover">
            {game.cover ? <img src={game.cover} alt="" /> : <PenLine size={18} />}
          </span>
          <div className="grv-editor-headtxt">
            <h3 className="grv-editor-title">
              {initial ? "Modifier ma review" : "Écris ta review"}
            </h3>
            <p className="grv-editor-sub">{game.name}</p>
          </div>
        </div>
        <div className="rating-block grv-rating-block">
          <span className="rating-block-label">Ma note</span>
          <RatingGauge
            value={rating ?? 75}
            active={rating != null}
            onEnable={() => setRating(75)}
            onChange={setRating}
            onClear={() => setRating(null)}
          />
        </div>
      </div>

      <Composer
        token={token}
        big
        maxChars={2000}
        placeholder="Qu'as-tu pensé du jeu ?…"
        initialText={initial?.review || ""}
        initialMedia={initial?.media || []}
        onLiveChange={({ text, media: m }) => {
          setReview(text);
          setMedia(m);
        }}
        toolbarExtra={<SpoilerSwitch on={spoiler} onToggle={() => setSpoiler((v) => !v)} />}
      />

      <div className="proscons">
        <ChipEditor label="Les points forts" Icon={ThumbsUp} tone="pro" items={pros} onChange={setPros} />
        <ChipEditor label="Les points faibles" Icon={ThumbsDown} tone="con" items={cons} onChange={setCons} />
      </div>

      <div className="grv-editor-foot">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {initial ? "Enregistrer" : "Publier ma review"}
        </button>
      </div>
    </div>
  );
}

// Modal qui accueille l'éditeur de review.
export function ReviewModal({ game, token, initial, isNew, onClose, onSaved }) {
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
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal grv-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <ReviewEditor game={game} token={token} initial={initial} isNew={isNew} onSaved={onSaved} />
      </div>
    </div>,
    document.body
  );
}

// Bandeau compact qui invite à écrire (ouvre la modal au clic).
function ReviewPrompt({ game, onOpen }) {
  return (
    <button className="grv-prompt clickable" onClick={onOpen}>
      <span className="grv-prompt-cover">
        {game.cover ? <img src={game.cover} alt="" /> : <PenLine size={18} />}
      </span>
      <span className="grv-prompt-main">
        <span className="grv-prompt-title">Écris ta review</span>
        <span className="grv-prompt-fake">Qu'as-tu pensé de {game.name} ?…</span>
      </span>
      <span className="grv-prompt-cta">
        <PenLine size={15} /> Rédiger
      </span>
    </button>
  );
}

// Barre de réactions (like / dislike / rigolo) sous une review.
function ReviewReactions({ r, readOnly, onReact }) {
  return (
    <div className={`rvc-reacts ${readOnly ? "readonly" : ""}`}>
      {REACTIONS.map((rc) => {
        const n = r.reactions?.[rc.key] || 0;
        const on = r.myReaction === rc.key;
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

// Carte d'une review — avatar en dehors, contenu dans une bulle.
// variant "user" (page du jeu) : avatar = auteur. variant "game" (profil) :
// avatar = jaquette du jeu (→ page du jeu), titre = nom du jeu (→ onglet reviews).
// Texte d'une review : on écrase les retours à la ligne successifs (un seul
// suffit) et on tronque avec un bouton « Afficher plus » si c'est trop long.
function ReviewText({ text }) {
  const clean = useMemo(
    () => text.replace(/[ \t]*\r?\n(?:[ \t]*\r?\n){2,}/g, "\n\n").trim(),
    [text]
  );
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 4);
  }, [clean]);
  return (
    <div className="rv-textwrap">
      <p ref={ref} className={`rv-text ${expanded ? "" : "rv-clamp"}`}>
        {renderMessage(clean, [])}
      </p>
      {clamped && (
        <button
          type="button"
          className="rv-more clickable"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Afficher moins" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}

export function ReviewItem({
  r,
  gameId,
  token,
  viewerFinished,
  forceReveal,
  isMine,
  variant = "user",
  onEdit,
  onDelete,
  onReact,
  onOpenGame,
  onOpenReview,
}) {
  const [revealed, setRevealed] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [comments, setComments] = useState(r.comments || []);
  const sm = STATUS_META[r.status] || STATUS_META.finished;
  const hidden = r.spoiler && !isMine && !viewerFinished && !forceReveal && !revealed;
  const hasBody = r.review.trim() || r.media.length || r.pros.length || r.cons.length;
  const isGame = variant === "game";

  return (
    <article className={`rvc ${isMine ? "is-mine" : ""}`}>
      {isGame ? (
        <button
          className="rvc-av rvc-av-game clickable"
          onClick={onOpenGame}
          title={r.name}
          aria-label={r.name}
        >
          {r.cover ? (
            <img src={r.cover} alt="" loading="lazy" />
          ) : (
            <Gamepad2 size={20} />
          )}
        </button>
      ) : (
        <Link to={r.user ? `/u/${r.user.username}` : "#"} className="rvc-av clickable">
          {r.user?.avatar ? (
            <img src={r.user.avatar} alt="" loading="lazy" />
          ) : (
            <span className="rvc-av-fb">{(r.user?.username || "?")[0].toUpperCase()}</span>
          )}
        </Link>
      )}

      <div className="rvc-bubble">
        <header className="rvc-top">
          <div className="rvc-id">
            {isGame ? (
              <button className="rvc-user rvc-user-btn clickable" onClick={onOpenReview}>
                {r.name}
              </button>
            ) : (
              <Link to={r.user ? `/u/${r.user.username}` : "#"} className="rvc-user clickable">
                {r.user?.username || "?"}
              </Link>
            )}
            <span className="rvc-time">{timeAgo(r.updatedAt)}</span>
          </div>
          <div className="rvc-top-right">
            <div className="rvc-tags">
              <span className={`rv-status s-${r.status}`}>
                <sm.Icon size={12} /> {sm.label}
              </span>
              {r.playtimeHours != null && (
                <span className="rvc-tag">
                  <Clock size={12} /> {r.playtimeHours}h
                </span>
              )}
              {r.platform && (
                <span className="rvc-tag">
                  <Gamepad size={12} /> {r.platform}
                </span>
              )}
              {r.spoiler && (
                <span className="rv-spoiler-tag">
                  <EyeOff size={11} /> Spoiler
                </span>
              )}
            </div>
            {r.rating != null && <ScoreRing value={r.rating} />}
            {isMine && (
              <div className="rvc-mine-actions">
                <button className="rvc-edit clickable" onClick={onEdit} title="Modifier ma review">
                  <PenLine size={15} />
                </button>
                <button
                  className="rvc-edit rvc-del clickable"
                  onClick={onDelete}
                  title="Supprimer ma review"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
        </header>

        <div
          className={`rv-bodywrap ${isGame ? "rvc-openable" : ""}`}
          onClick={
            isGame
              ? (e) => {
                  if (!e.target.closest("a, button")) onOpenReview?.();
                }
              : undefined
          }
        >
          <div className={`rv-body ${hidden ? "is-hidden" : ""}`}>
            {r.review.trim() && <ReviewText text={r.review} />}

            {r.media.length > 0 && (
              <div className={`lc-media-grid n-${Math.min(r.media.length, 4)}`}>
                {r.media.map((m, i) => (
                  <a key={i} href={m.url} target="_blank" rel="noreferrer" className="lc-media">
                    <img src={m.url} alt="" loading="lazy" />
                    {m.type === "gif" && <span className="lc-media-tag">GIF</span>}
                  </a>
                ))}
              </div>
            )}

            {(r.pros.length > 0 || r.cons.length > 0) && (
              <div className="rv-pc">
                {r.pros.map((p, i) => (
                  <span className="pc-chip pro" key={`p${i}`}>
                    <ThumbsUp size={12} /> {p}
                  </span>
                ))}
                {r.cons.map((c, i) => (
                  <span className="pc-chip con" key={`c${i}`}>
                    <ThumbsDown size={12} /> {c}
                  </span>
                ))}
              </div>
            )}

            {!hasBody && <p className="rv-text muted font-fun">Pas de texte, juste une note.</p>}
          </div>

          {hidden && (
            <button className="rv-reveal clickable" onClick={() => setRevealed(true)}>
              <Eye size={17} />
              <span>Afficher le spoiler</span>
              <small>Tu n'as pas encore terminé ce jeu</small>
            </button>
          )}
        </div>

        {!hidden && (
          <>
            <footer className="rvc-foot">
              <ReviewReactions r={r} readOnly={isMine} onReact={(type) => onReact(r.user?.id, type)} />
              <button
                className={`rvc-reply-btn clickable ${showThread ? "on" : ""}`}
                onClick={() => setShowThread((v) => !v)}
              >
                <MessageCircle size={15} />
                {comments.length > 0
                  ? `${comments.length} répons${comments.length > 1 ? "es" : "e"}`
                  : "Répondre"}
              </button>
            </footer>

            {showThread && (
              <ReviewComments
                gameId={gameId}
                reviewUserId={r.user?.id}
                token={token}
                comments={comments}
                setComments={setComments}
              />
            )}
          </>
        )}
      </div>
    </article>
  );
}

function compactNum(n) {
  if (n == null) return "";
  return n.toLocaleString("fr-FR");
}

// Avis publics Steam, importés côté serveur. Affichés SOUS les reviews de nos
// joueurs (qui restent prioritaires), clairement identifiés comme venant de Steam.
function SteamReviews({ steam }) {
  const [expanded, setExpanded] = useState(false);
  if (!steam || (!steam.list?.length && !steam.total)) return null;

  const pos = steam.positive;
  const neg = steam.negative;
  const pct = pos + neg > 0 ? Math.round((pos / (pos + neg)) * 100) : null;
  const tone = pct == null ? "" : pct >= 70 ? "good" : pct >= 40 ? "mixed" : "bad";
  const list = expanded ? steam.list : steam.list.slice(0, 6);

  return (
    <div className="grv-steam">
      <div className="grv-steam-head">
        <span className="grv-steam-badge">
          <Gamepad2 size={14} /> Steam
        </span>
        <h3 className="grv-section-title">
          Avis des joueurs Steam
          {steam.total > 0 && <span className="section-count">{compactNum(steam.total)}</span>}
        </h3>
      </div>
      <p className="grv-steam-note">
        Avis publics importés depuis Steam — ils complètent ceux de la communauté MyPlayLog.
      </p>

      <div className={`gp-rev-summary ${tone}`}>
        <div className="gp-rev-score">
          {steam.scoreDesc && <b>{steam.scoreDesc}</b>}
          {pct != null && (
            <span className="gp-rev-pct">
              {pct}% d'avis positifs · {compactNum(pos + neg)} évaluations
            </span>
          )}
        </div>
        {pct != null && (
          <div className="gp-rev-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        )}
        {steam.storeUrl && (
          <a className="gp-rev-store clickable" href={steam.storeUrl} target="_blank" rel="noreferrer">
            Voir sur Steam <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div className="gp-rev-list">
        {list.map((r) => (
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="gp-rev-card clickable"
          >
            <div className={`gp-rev-verdict ${r.up ? "up" : "down"}`}>
              {r.up ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}
              {r.up ? "Recommandé" : "Pas recommandé"}
            </div>
            <p className="gp-rev-text">{r.text}</p>
            <div className="gp-rev-meta">
              <span>
                <Clock size={12} /> {r.playtimeH} h de jeu
              </span>
              {r.helpful > 0 && <span>{compactNum(r.helpful)} ont trouvé ça utile</span>}
            </div>
          </a>
        ))}
      </div>

      {!expanded && steam.list.length > 6 && (
        <button className="gp-rev-more clickable" onClick={() => setExpanded(true)}>
          Voir plus d'avis ({steam.list.length})
        </button>
      )}
    </div>
  );
}

export default function GameReviews({ game, viewerStatus, upcoming, onWantPlay }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(false);
  const [sort, setSort] = useState("recent");
  const [sentiment, setSentiment] = useState("all");
  const [platform, setPlatform] = useState("");
  const reqRef = useRef(0);

  function load() {
    const id = ++reqRef.current;
    apiFetch(`/games/${game.id}/reviews`, { token })
      .then((d) => id === reqRef.current && setData(d))
      .catch((e) => id === reqRef.current && setError(e.message))
      .finally(() => id === reqRef.current && setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    setModal(false);
    setSentiment("all");
    setPlatform("");
    load();
    // viewerStatus : recharge quand le jeu passe « joué » (review écrite via la modal Jouer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, token, viewerStatus]);

  // Réaction à une review : mise à jour optimiste puis synchro serveur.
  function applyReaction(rv, type) {
    const counts = { ...(rv.reactions || { heart: 0, clap: 0, funny: 0 }) };
    const prev = rv.myReaction;
    let next;
    if (prev === type) {
      counts[type] = Math.max(0, (counts[type] || 0) - 1);
      next = null;
    } else {
      if (prev) counts[prev] = Math.max(0, (counts[prev] || 0) - 1);
      counts[type] = (counts[type] || 0) + 1;
      next = type;
    }
    return { ...rv, reactions: counts, myReaction: next };
  }

  async function reactTo(userId, type) {
    if (!userId) return;
    setData((d) => ({
      ...d,
      reviews: d.reviews.map((rv) => (rv.user?.id === userId ? applyReaction(rv, type) : rv)),
    }));
    try {
      const res = await apiFetch(`/games/${game.id}/reviews/${userId}/react`, {
        method: "POST",
        token,
        body: { type },
      });
      setData((d) => ({
        ...d,
        reviews: d.reviews.map((rv) =>
          rv.user?.id === userId
            ? { ...rv, reactions: res.reactions, myReaction: res.myReaction }
            : rv
        ),
      }));
    } catch {
      load(); // en cas d'échec, on resynchronise
    }
  }

  // Supprime le contenu de ma review (sans retirer le jeu de la bibliothèque).
  async function deleteReview() {
    if (!confirm("Supprimer définitivement ta review pour ce jeu ?")) return;
    try {
      await apiFetch(`/library/${game.id}`, {
        method: "PUT",
        token,
        body: {
          name: game.name,
          cover: game.cover,
          review: "",
          reviewMedia: [],
          spoiler: false,
          pros: [],
          cons: [],
          rating: null,
        },
      });
      setLoading(true);
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading)
    return (
      <div className="act-loading">
        <Loader2 size={20} className="spin" /> Chargement des reviews…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;

  const mine = data.mine;
  const mineHasContent =
    mine &&
    (mine.review.trim() || mine.pros.length || mine.cons.length || mine.media.length || mine.rating != null);
  const others = data.reviews.filter((r) => !r.isMe);

  const platforms = [...new Set(others.map((r) => r.platform).filter(Boolean))];

  const filtered = others.filter((r) => {
    if (sentiment === "positive" && !(r.rating != null && r.rating >= POSITIVE_MIN)) return false;
    if (sentiment === "negative" && !(r.rating != null && r.rating < POSITIVE_MIN)) return false;
    if (platform && r.platform !== platform) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "best") return (b.rating ?? -1) - (a.rating ?? -1);
    if (sort === "worst") return (a.rating ?? 101) - (b.rating ?? 101);
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  const viewerFinished = viewerStatus === "finished";
  const hasFilters = others.length > 1;
  const canReview = PLAYED.includes(viewerStatus);

  return (
    <div className="grv">
      {/* Ma review : carte si déjà écrite, sinon invite (verrouillée si jeu non
          joué, ou pas encore sorti) */}
      {mineHasContent ? (
        <div className="grv-mine">
          <h3 className="grv-section-title">
            <Star size={16} /> Ma review
          </h3>
          <ReviewItem
            r={mine}
            gameId={game.id}
            token={token}
            isMine
            viewerFinished
            onEdit={() => setModal(true)}
            onDelete={deleteReview}
            onReact={reactTo}
          />
        </div>
      ) : upcoming ? (
        <div className="grv-locked">
          <span className="grv-locked-ic">
            <Clock size={20} />
          </span>
          <div className="grv-locked-txt">
            <b>Pas encore sorti</b>
            <p>Les reviews s'ouvriront à la sortie du jeu.</p>
          </div>
        </div>
      ) : canReview ? (
        <ReviewPrompt game={game} onOpen={() => setModal(true)} />
      ) : (
        <div className="grv-locked">
          <span className="grv-locked-ic">
            <Gamepad2 size={20} />
          </span>
          <div className="grv-locked-txt">
            <b>Marque ce jeu comme joué pour écrire ta review</b>
            <p>Ajoute-le à ta bibliothèque (En cours, Terminé…) pour partager ton avis.</p>
          </div>
          {onWantPlay && (
            <button className="btn btn-primary" onClick={onWantPlay}>
              <Gamepad size={16} /> J'y ai joué
            </button>
          )}
        </div>
      )}

      {/* Reviews de la communauté */}
      <div className="grv-others">
        <div className="grv-others-head">
          <h3 className="grv-section-title">
            <Gamepad2 size={16} /> Reviews des joueurs
            <span className="section-count">{others.length}</span>
          </h3>
        </div>

        {hasFilters && (
          <div className="grv-filters">
            <div className="grv-seg">
              {SENTIMENTS.map((s) => (
                <button
                  key={s.key}
                  className={`grv-seg-opt clickable ${sentiment === s.key ? "active" : ""}`}
                  onClick={() => setSentiment(s.key)}
                >
                  <s.Icon size={14} /> {s.label}
                </button>
              ))}
            </div>
            <div className="grv-selects">
              {platforms.length > 1 && (
                <label className="grv-select">
                  <Gamepad size={14} />
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                    <option value="">Toutes plateformes</option>
                    {platforms.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="grv-select">
                <SlidersHorizontal size={14} />
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {others.length === 0 ? (
          <div className="profile-empty font-fun">
            Personne n'a encore écrit de review. Sois le premier !
          </div>
        ) : sorted.length === 0 ? (
          <div className="profile-empty font-fun">Aucune review ne correspond à ces filtres.</div>
        ) : (
          <div className="grv-list">
            {sorted.map((r) => (
              <ReviewItem
                key={r.user?.id || r.updatedAt}
                r={r}
                gameId={game.id}
                token={token}
                viewerFinished={viewerFinished}
                onReact={reactTo}
              />
            ))}
          </div>
        )}

        {/* Avis Steam — sous les reviews de nos joueurs */}
        <SteamReviews steam={data.steam} />
      </div>

      {modal && (
        <ReviewModal
          game={game}
          token={token}
          initial={mineHasContent ? mine : null}
          isNew={!mine}
          onClose={() => setModal(false)}
          onSaved={() => {
            setModal(false);
            setLoading(true);
            load();
          }}
        />
      )}
    </div>
  );
}
