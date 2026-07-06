import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Music,
  Disc3,
  Play,
  Pause,
  GripVertical,
  Clock,
  Trophy,
  MessageCircle,
  ExternalLink,
} from "lucide-react";
import { loadYT, extractVideoId } from "../lib/youtube";
import OstCommentsModal from "./OstCommentsModal";

// Onglet OST du profil : toutes les OST favorites de l'utilisateur (une par jeu)
// sous forme de cards « pochette + CD » (la pochette = le jeu, le CD = l'OST).
// Le CD dépasse de la pochette, sort davantage au survol et tourne à la lecture.
// Tri « récemment ajoutées » ou classement manuel par préférence (drag & drop),
// et commentaires par OST (mêmes fils que les listes) dans une modale.

const SORTS = [
  { key: "preference", label: "Ordre de préférence", Icon: Trophy },
  { key: "recent", label: "Ajoutées récemment", Icon: Clock },
];

// Classe les items selon l'ordre manuel (ostOrder = liste d'ids de jeux) ; les
// jeux non classés sont renvoyés à la fin, du plus récent au plus ancien.
function byPreference(items, order) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items.slice().sort((a, b) => {
    const ra = rank.has(a.gameId) ? rank.get(a.gameId) : Infinity;
    const rb = rank.has(b.gameId) ? rank.get(b.gameId) : Infinity;
    if (ra !== rb) return ra - rb;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function byRecent(items) {
  return items.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export default function ProfileOST({
  library,
  isMe,
  ownerId,
  token,
  ostOrder,
  onOrderChange,
  openGameId,
  onOpenConsumed,
}) {
  // OST favorites = entrées de bibliothèque qui portent une favoriteOst.
  const items = useMemo(
    () =>
      library
        .filter((e) => e.favoriteOst?.name)
        .map((e) => ({
          gameId: e.gameId,
          gameName: e.name,
          cover: e.cover,
          updatedAt: e.updatedAt,
          ost: e.favoriteOst,
          commentCount: e.ostCommentCount || 0,
        })),
    [library]
  );

  const [sort, setSort] = useState("preference");
  // Liste ordonnée localement (permet le réordonnancement optimiste au drag).
  const [order, setOrder] = useState(() => byPreference(items, ostOrder || []).map((i) => i.gameId));
  const [commentFor, setCommentFor] = useState(null); // item dont la modale de commentaires est ouverte
  // Compteurs de commentaires rafraîchis après ouverture d'une modale (par gameId).
  const [countOverride, setCountOverride] = useState({});

  useEffect(() => {
    setOrder(byPreference(items, ostOrder || []).map((i) => i.gameId));
  }, [items, ostOrder]);

  // Deep-link (depuis une notification) : ouvre le fil de commentaires de l'OST.
  const consumedOpen = useRef(false);
  useEffect(() => {
    if (consumedOpen.current || openGameId == null) return;
    const target = items.find((i) => i.gameId === openGameId);
    if (target) {
      consumedOpen.current = true;
      setCommentFor(target);
      onOpenConsumed?.();
    }
  }, [openGameId, items, onOpenConsumed]);

  const byId = useMemo(() => new Map(items.map((i) => [i.gameId, i])), [items]);
  const ordered =
    sort === "recent"
      ? byRecent(items)
      : order.map((id) => byId.get(id)).filter(Boolean);

  // --- Lecture audio (extraits iTunes) + YouTube caché, comme l'onglet OST du jeu ---
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);
  const ytRef = useRef(null);
  const ytDivRef = useRef(null);

  useEffect(() => {
    let destroyed = false;
    loadYT().then((YT) => {
      if (destroyed || !ytDivRef.current) return;
      ytRef.current = new YT.Player(ytDivRef.current, {
        height: "0",
        width: "0",
        playerVars: { autoplay: 0, playsinline: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) setPlayingId(null);
          },
        },
      });
    });
    return () => {
      destroyed = true;
      try {
        ytRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audio) audio.pause();
      try {
        ytRef.current?.stopVideo?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  function playable(t) {
    return !!t.preview || (t.youtube && extractVideoId(t.url));
  }

  function toggle(item) {
    const t = item.ost;
    const id = item.gameId;
    const vid = t.youtube ? extractVideoId(t.url) : null;
    if (vid) {
      audioRef.current?.pause();
      if (playingId === id) {
        ytRef.current?.pauseVideo?.();
        setPlayingId(null);
        return;
      }
      ytRef.current?.loadVideoById?.(vid);
      setPlayingId(id);
      return;
    }
    if (!t.preview) return;
    try {
      ytRef.current?.pauseVideo?.();
    } catch {
      /* ignore */
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = t.preview;
    audio.play().catch(() => {});
    setPlayingId(id);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const draggable = isMe && sort === "preference";

  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id);
    const to = order.indexOf(over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    onOrderChange?.(next);
  }

  if (!items.length) {
    return (
      <div className="pfo-empty font-fun">
        <Disc3 size={34} />
        <p>
          {isMe
            ? "Aucune OST favorite pour l'instant — choisis-en depuis l'onglet OST d'un jeu."
            : "Ce joueur n'a pas encore d'OST favorite."}
        </p>
      </div>
    );
  }

  return (
    <section className="profile-section pfo">
      <div ref={ytDivRef} style={{ display: "none" }} />
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} hidden />

      <div className="pfo-head">
        <div className="pfo-title">
          <Music size={18} />
          <span>OST favorites</span>
          <span className="pfo-count">{items.length}</span>
        </div>
        <div className="pfo-sorts">
          {SORTS.map((s) => (
            <button
              key={s.key}
              className={`pfo-sort clickable ${sort === s.key ? "active" : ""}`}
              onClick={() => setSort(s.key)}
            >
              <s.Icon size={15} /> {s.label}
            </button>
          ))}
        </div>
      </div>

      {draggable && (
        <p className="pfo-hint font-fun">
          <GripVertical size={14} /> Glisse les cards pour les classer par ordre de préférence.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered.map((i) => i.gameId)} strategy={rectSortingStrategy}>
          <div className="pfo-grid">
            {ordered.map((item, i) => (
              <OstCard
                key={item.gameId}
                item={item}
                rank={i + 1}
                showRank={sort === "preference"}
                draggable={draggable}
                playing={playingId === item.gameId}
                canPlay={playable(item.ost)}
                commentCount={countOverride[item.gameId] ?? item.commentCount}
                onToggle={() => toggle(item)}
                onComment={() => setCommentFor(item)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {commentFor && (
        <OstCommentsModal
          ownerId={ownerId}
          gameId={commentFor.gameId}
          ost={commentFor.ost}
          gameName={commentFor.gameName}
          token={token}
          onCountChange={(n) =>
            setCountOverride((m) => ({ ...m, [commentFor.gameId]: n }))
          }
          onClose={() => setCommentFor(null)}
        />
      )}
    </section>
  );
}

function OstCard({ item, rank, showRank, draggable, playing, canPlay, commentCount, onToggle, onComment }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.gameId, disabled: !draggable });
  // La card entière est saisissable. On coupe la transition CSS pendant le drag
  // pour que le vinyle suive le curseur sans latence (sinon il « rame »).
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
  };
  const dragProps = draggable ? { ...attributes, ...listeners } : {};
  const t = item.ost;
  const medal = rank <= 3 ? `m${rank}` : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pfo-card ${playing ? "playing" : ""} ${isDragging ? "dragging" : ""} ${
        draggable ? "grab" : ""
      }`}
      {...dragProps}
    >
      <div className="pfo-sleeve">
        {/* Le CD dépasse de la pochette (sort au survol, tourne à la lecture) */}
        <div className="pfo-cd">
          <div className="pfo-disc">
            <span className="pfo-disc-label">
              {t.artwork ? (
                <img src={t.artwork} alt="" loading="lazy" draggable="false" />
              ) : (
                <Music size={20} />
              )}
              <span className="pfo-disc-hole" />
            </span>
          </div>
        </div>

        {/* La pochette = la jaquette du jeu */}
        <div className="pfo-album">
          {item.cover ? (
            <img src={item.cover} alt={item.gameName} loading="lazy" draggable="false" />
          ) : (
            <span className="pfo-album-ph">{item.gameName?.[0] || "?"}</span>
          )}
          <span className="pfo-album-mouth" />
        </div>

        {showRank && <span className={`pfo-rank ${medal}`}>{rank}</span>}

        {draggable && (
          <span className="pfo-grabtag" title="Glisse pour classer">
            <GripVertical size={15} />
          </span>
        )}

        <button
          className={`pfo-play clickable ${canPlay ? "" : "mute"}`}
          onClick={canPlay ? onToggle : undefined}
          disabled={!canPlay}
          title={canPlay ? (playing ? "Pause" : "Écouter") : "Extrait indisponible"}
        >
          {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
        </button>
      </div>

      <div className="pfo-body">
        <span className="pfo-name" title={t.name}>
          {t.name}
        </span>
        {t.artist && (
          <span className="pfo-artist" title={t.artist}>
            {t.artist}
          </span>
        )}

        <div className="pfo-foot">
          <Link to={`/game/${item.gameId}`} className="pfo-game clickable" title={item.gameName}>
            <Disc3 size={13} />
            <span className="pfo-game-name">{item.gameName}</span>
          </Link>
          <div className="pfo-foot-actions">
            {t.url && (
              <a
                href={t.url}
                target="_blank"
                rel="noreferrer"
                className="pfo-icon-btn clickable"
                title="Ouvrir la source"
              >
                <ExternalLink size={15} />
              </a>
            )}
            <button
              className="pfo-icon-btn clickable"
              onClick={onComment}
              title="Commentaires"
            >
              <MessageCircle size={15} />
              {commentCount > 0 && <span className="pfo-cmt-count">{commentCount}</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
