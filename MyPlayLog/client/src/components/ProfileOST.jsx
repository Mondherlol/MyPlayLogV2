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
  Loader2,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { extractVideoId } from "../lib/youtube";
import { apiFetch } from "../lib/api";
import { usePlayer } from "../context/PlayerContext";
import OstCommentsModal from "./OstCommentsModal";
import PlaylistCard from "./PlaylistCard";
import CreateListModal from "./CreateListModal";

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

  // Sous-onglet : OST favorites (une par jeu) ou playlists du joueur.
  const [view, setView] = useState("ost"); // "ost" | "playlists"
  const [playlists, setPlaylists] = useState(null); // null = pas encore chargées
  const [plLoading, setPlLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  // Playlists du profil : chargées à la première ouverture de l'onglet.
  useEffect(() => {
    if (view !== "playlists" || playlists !== null || !ownerId) return;
    let alive = true;
    setPlLoading(true);
    apiFetch(`/lists?author=${ownerId}&type=playlist`, { token })
      .then((d) => alive && setPlaylists(d.lists || []))
      .catch(() => alive && setPlaylists([]))
      .finally(() => alive && setPlLoading(false));
    return () => {
      alive = false;
    };
  }, [view, playlists, ownerId, token]);

  async function deletePlaylist(list) {
    if (!confirm(`Supprimer la playlist « ${list.title} » ? Cette action est définitive.`))
      return;
    const prev = playlists;
    setPlaylists((ls) => (ls || []).filter((l) => l.id !== list.id));
    try {
      await apiFetch(`/lists/${list.id}`, { method: "DELETE", token });
    } catch (e) {
      alert(e.message);
      setPlaylists(prev); // rollback
    }
  }

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

  // --- Lecture déléguée au mini-lecteur global ---
  const player = usePlayer();

  function playable(t) {
    return !!(t.videoId || extractVideoId(t.url || ""));
  }

  // Lance/bascule la piste dans le lecteur global. La file = toutes les OST
  // affichées, chacune enrichie de son jeu (pour le lien du mini-lecteur).
  function toggle(item) {
    const withGame = (i) => ({ ...i.ost, gameId: i.gameId, gameName: i.gameName });
    player.toggleTrack(withGame(item), ordered.map(withGame), {});
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

  return (
    <section className="profile-section pfo">
      <div className="pfo-head">
        {/* Sous-onglets : OST favorites / Playlists */}
        <div className="pfo-views" role="group" aria-label="Contenu OST">
          <button
            className={`pfo-view clickable ${view === "ost" ? "active" : ""}`}
            onClick={() => setView("ost")}
          >
            <Music size={16} /> OST favorites
            {items.length > 0 && <span className="pfo-count">{items.length}</span>}
          </button>
          <button
            className={`pfo-view clickable ${view === "playlists" ? "active" : ""}`}
            onClick={() => setView("playlists")}
          >
            <Disc3 size={16} /> Playlists
            {(playlists?.length || 0) > 0 && (
              <span className="pfo-count">{playlists.length}</span>
            )}
          </button>
        </div>
        {view === "ost" && items.length > 0 && (
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
        )}
        {view === "playlists" && isMe && (
          <button className="ld-addbtn small clickable" onClick={() => setCreating(true)}>
            <Plus size={15} /> Créer une playlist
          </button>
        )}
      </div>

      {view === "playlists" ? (
        plLoading || playlists === null ? (
          <div className="pfo-empty font-fun">
            <Loader2 size={22} className="spin" />
          </div>
        ) : playlists.length === 0 ? (
          <div className="pfo-empty font-fun">
            <Disc3 size={34} />
            <p>
              {isMe
                ? "Aucune playlist pour l'instant — crée-en une et remplis-la d'OST !"
                : "Ce joueur n'a pas encore de playlist."}
            </p>
          </div>
        ) : (
          <div className="plc-grid">
            {playlists.map((l) => (
              <PlaylistCard
                key={l.id}
                list={l}
                onDelete={isMe ? deletePlaylist : undefined}
              />
            ))}
          </div>
        )
      ) : !items.length ? (
        <div className="pfo-empty font-fun">
          <Disc3 size={34} />
          <p>
            {isMe
              ? "Aucune OST favorite pour l'instant — choisis-en depuis l'onglet OST d'un jeu."
              : "Ce joueur n'a pas encore d'OST favorite."}
          </p>
        </div>
      ) : (
        <>
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
                    playing={player.isPlaying(item.ost)}
                    canPlay={playable(item.ost)}
                    commentCount={countOverride[item.gameId] ?? item.commentCount}
                    onToggle={() => toggle(item)}
                    onComment={() => setCommentFor(item)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

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

      {creating && (
        <CreateListModal
          fixedType="playlist"
          onClose={() => setCreating(false)}
          onCreated={(list) => {
            setCreating(false);
            navigate(`/lists/${list.id}`, { state: { edit: true } });
          }}
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
