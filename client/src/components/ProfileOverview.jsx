import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Star,
  Heart,
  Trophy,
  Gamepad2,
  ListChecks,
  PauseCircle,
  Ban,
  Clock,
  Joystick,
  Type,
  GripVertical,
  Check,
  SlidersHorizontal,
  ArrowRight,
  Infinity as InfinityIcon,
} from "lucide-react";
import GameAddFan from "./GameAddFan";
import ProfileOverviewAside from "./ProfileOverviewAside";

// Les 6 « sections » de l'aperçu (favoris + 5 statuts) que l'utilisateur peut
// réordonner par glisser-déposer. L'ordre par défaut place les favoris et les
// jeux en cours en tête, puis à jouer / en pause / abandonnés.
const BLOCK_META = {
  favorites: { label: "Jeux favoris", Icon: Heart },
  playing: { label: "En cours", Icon: Gamepad2 },
  endless: { label: "Sans fin", Icon: InfinityIcon },
  finished: { label: "Terminés", Icon: Trophy },
  wishlist: { label: "À jouer", Icon: ListChecks },
  paused: { label: "En pause", Icon: PauseCircle },
  dropped: { label: "Abandonnés", Icon: Ban },
};
const DEFAULT_ORDER = ["favorites", "playing", "endless", "finished", "wishlist", "paused", "dropped"];

// Détails optionnels affichés en surimpression des jaquettes.
const CARD_FIELDS = [
  { key: "rating", label: "Note", Icon: Star },
  { key: "hours", label: "Temps de jeu", Icon: Clock },
  { key: "platform", label: "Plateforme", Icon: Joystick },
  { key: "title", label: "Titre", Icon: Type },
];
const DEFAULT_CARDS = ["rating"];

// Repart de l'ordre sauvegardé (nettoyé) et complète avec les sections manquantes
// pour qu'une nouvelle section apparaisse toujours même sur un ordre ancien.
function resolveOrder(saved) {
  const base = (saved?.length ? saved : DEFAULT_ORDER).filter((k) => BLOCK_META[k]);
  for (const k of DEFAULT_ORDER) if (!base.includes(k)) base.push(k);
  return base;
}
function resolveCards(saved) {
  return saved?.length ? saved.filter((k) => CARD_FIELDS.some((f) => f.key === k)) : DEFAULT_CARDS;
}

// Jaquette d'un jeu avec surimpression optionnelle (note, heures, plateforme…).
function CoverTile({ entry, fav, fields, editing }) {
  const navigate = useNavigate();
  const showRating = fields.includes("rating") && entry.rating != null;
  const showHours = fields.includes("hours") && entry.playtimeHours != null;
  const showPlatform = fields.includes("platform") && !!entry.platform;
  const showTitle = fields.includes("title");
  const hasMeta = showRating || showHours || showPlatform;
  return (
    <div className="cover-tile-wrap">
      <div
        className="cover-tile clickable"
        onClick={() => navigate(`/game/${entry.gameId}`)}
        title={entry.name}
      >
        {entry.cover ? (
          <img src={entry.cover} alt={entry.name} loading="lazy" draggable="false" />
        ) : (
          <div className="cover-ph">{entry.name}</div>
        )}
        {fav && (
          <span className="cover-fav">
            <Star size={13} fill="currentColor" strokeWidth={0} />
          </span>
        )}
        {hasMeta && (
          <div className="cover-meta">
            {showRating && (
              <span className="cover-meta-rating">
                <Star size={10} fill="currentColor" strokeWidth={0} /> {entry.rating}
              </span>
            )}
            {showHours && (
              <span className="cover-meta-chip">
                <Clock size={10} /> {entry.playtimeHours}h
              </span>
            )}
            {showPlatform && (
              <span className="cover-meta-chip" title={entry.platform}>
                {entry.platform}
              </span>
            )}
          </div>
        )}
        {!editing && (
          <GameAddFan
            game={{ id: entry.gameId, name: entry.name, cover: entry.cover }}
            hoverOnly
          />
        )}
      </div>
      {showTitle && (
        <span className="cover-caption" title={entry.name}>
          {entry.name}
        </span>
      )}
    </div>
  );
}

// Dernière tuile d'une rangée quand la liste dépasse la limite d'aperçu.
function ShowMoreTile({ rest, onClick }) {
  const preview = rest.slice(0, 3);
  return (
    <button className="cover-more clickable" onClick={onClick} title="Voir le reste des jeux">
      <span className="cover-more-stack" aria-hidden="true">
        {preview.map((e) => (
          <span className="cover-more-cover" key={e.gameId}>
            {e.cover ? (
              <img src={e.cover} alt="" loading="lazy" draggable="false" />
            ) : (
              <span className="cover-more-ph" />
            )}
          </span>
        ))}
      </span>
      <span className="cover-more-veil" aria-hidden="true" />
      <span className="cover-more-body">
        <span className="cover-more-count">+{rest.length}</span>
        <span className="cover-more-text">
          Voir le reste <ArrowRight size={13} />
        </span>
      </span>
    </button>
  );
}

// Section réordonnable (en mode édition). Toute la section est saisissable :
// grâce à la contrainte de distance du capteur, un clic (< 6px) laisse passer la
// navigation vers un jeu tandis qu'un vrai glissé déclenche le réordonnancement.
function SortableBlock({ id, editing, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
  };
  const dragProps = editing ? { ...attributes, ...listeners } : {};
  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`profile-section pf-block ${editing ? "editing" : ""} ${
        isDragging ? "dragging" : ""
      }`}
      {...dragProps}
    >
      {editing && (
        <span className="pf-block-grip" title="Glisser pour réordonner" aria-hidden="true">
          <GripVertical size={16} />
        </span>
      )}
      {children}
    </section>
  );
}

export default function ProfileOverview({
  favorites,
  library,
  lists,
  profile,
  isMe,
  username,
  token,
  onAddFavorite,
  onAddStatus,
  goAllGames,
  onSavePrefs,
  onOpenTab,
}) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(() => resolveOrder(profile.overviewOrder));
  const [cards, setCards] = useState(() => resolveCards(profile.overviewCards));

  // Resynchronise avec le serveur quand on n'édite pas (revalidation en fond).
  const savedOrderKey = (profile.overviewOrder || []).join("|");
  const savedCardsKey = (profile.overviewCards || []).join("|");
  useEffect(() => {
    if (!editing) setOrder(resolveOrder(profile.overviewOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrderKey]);
  useEffect(() => {
    if (!editing) setCards(resolveCards(profile.overviewCards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCardsKey]);

  const showAside = library.length > 0;
  const PREVIEW = 6;

  const countOf = (key) =>
    key === "favorites" ? favorites.length : library.filter((e) => e.status === key).length;
  // Chez soi : toutes les sections (même vides, pour pouvoir ajouter). Chez les
  // autres : on masque les sections sans jeu.
  const visibleOrder = useMemo(
    () => order.filter((key) => isMe || countOf(key) > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, isMe, favorites, library]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id);
    const to = order.indexOf(over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    onSavePrefs?.({ overviewOrder: next });
  }

  function toggleField(k) {
    setCards((prev) => {
      const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      onSavePrefs?.({ overviewCards: next });
      return next;
    });
  }

  function renderBlockInner(key, isFirst) {
    const meta = BLOCK_META[key];
    const isFav = key === "favorites";
    const list = isFav ? favorites : library.filter((e) => e.status === key);
    const preview = list.slice(0, PREVIEW);
    const rest = list.slice(PREVIEW);
    return (
      <>
        <h2 className="profile-section-title">
          <span className="pf-section-title-txt">
            <meta.Icon size={18} /> {meta.label}
            {list.length > 0 && <span className="section-count">{list.length}</span>}
          </span>
          {isFirst && isMe && (
            <button
              className={`pf-edit-btn clickable ${editing ? "on" : ""}`}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? (
                <>
                  <Check size={15} /> Terminé
                </>
              ) : (
                <>
                  <SlidersHorizontal size={15} /> Personnaliser
                </>
              )}
            </button>
          )}
        </h2>
        <div className="cover-row">
          {preview.map((e) => (
            <CoverTile key={e.gameId} entry={e} fav={isFav} fields={cards} editing={editing} />
          ))}
          {rest.length > 0 && (
            <ShowMoreTile
              rest={rest}
              onClick={() => goAllGames(isFav ? { fav: "1" } : { st: key })}
            />
          )}
          {isMe &&
            list.length <= PREVIEW &&
            Array.from({ length: Math.max(1, PREVIEW - list.length) }).map((_, i) => (
              <button
                key={`add-${i}`}
                className="cover-add clickable"
                onClick={() => (isFav ? onAddFavorite() : onAddStatus(key, meta.label))}
                title={isFav ? "Ajouter un favori" : `Ajouter à ${meta.label}`}
              >
                <Plus size={26} />
              </button>
            ))}
          {isFav && !favorites.length && !isMe && (
            <p className="pf-section-empty font-fun">Aucun favori pour l'instant.</p>
          )}
        </div>
      </>
    );
  }

  return (
    <div className={`pf-overview ${showAside ? "has-aside" : ""}`}>
      <div className="pf-overview-main">
        {editing && (
          <div className="pf-edit-panel">
            <p className="pf-edit-hint">
              <GripVertical size={14} /> Glisse les sections pour choisir leur ordre.
            </p>
            <div className="pf-edit-fields">
              <span className="pf-edit-fields-label">Sur les jaquettes</span>
              {CARD_FIELDS.map((f) => (
                <button
                  key={f.key}
                  className={`pf-field-toggle clickable ${cards.includes(f.key) ? "on" : ""}`}
                  onClick={() => toggleField(f.key)}
                >
                  <f.Icon size={14} /> {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {editing ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
              {visibleOrder.map((key, i) => (
                <SortableBlock key={key} id={key} editing>
                  {renderBlockInner(key, i === 0)}
                </SortableBlock>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          visibleOrder.map((key, i) => (
            <section className="profile-section pf-block" key={key}>
              {renderBlockInner(key, i === 0)}
            </section>
          ))
        )}

        {library.length === 0 && !isMe && (
          <div className="profile-empty font-fun">Ce joueur n'a pas encore de jeux.</div>
        )}
      </div>

      {showAside && (
        <ProfileOverviewAside
          username={username}
          token={token}
          library={library}
          lists={lists}
          onOpenTab={onOpenTab}
        />
      )}
    </div>
  );
}
