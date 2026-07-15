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
  rectSortingStrategy,
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
  X,
  Clock,
  Joystick,
  Type,
  GripVertical,
  Check,
  SlidersHorizontal,
  ArrowRight,
  Infinity as InfinityIcon,
  CalendarClock,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import GameAddFan from "./GameAddFan";
import ProfileOverviewAside from "./ProfileOverviewAside";

// Les « sections » de l'aperçu (favoris + statuts) que l'utilisateur peut
// réordonner par glisser-déposer. L'ordre par défaut place les favoris et les
// jeux en cours en tête, puis à jouer / en pause / abandonnés.
// « upcoming » est une section dérivée : les jeux « à jouer » pas encore
// sortis (date IGDB future) y sont déplacés automatiquement.
const BLOCK_META = {
  favorites: { label: "Jeux favoris", Icon: Heart },
  playing: { label: "En cours", Icon: Gamepad2 },
  endless: { label: "Sans fin", Icon: InfinityIcon },
  finished: { label: "Terminés", Icon: Trophy },
  wishlist: { label: "À jouer", Icon: ListChecks },
  upcoming: { label: "Jeux attendus", Icon: CalendarClock },
  paused: { label: "En pause", Icon: PauseCircle },
  dropped: { label: "Abandonnés", Icon: X },
};
const DEFAULT_ORDER = [
  "favorites",
  "playing",
  "endless",
  "finished",
  "wishlist",
  "upcoming",
  "paused",
  "dropped",
];

// « Aujourd'hui », « Demain », « J-12 », « 3 mois », « 2027 » — délai avant la
// sortie d'un jeu attendu, volontairement compact pour tenir sur la jaquette.
function releaseCountdown(ts) {
  const days = Math.ceil((ts * 1000 - Date.now()) / 86400000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  if (days <= 30) return `J-${days}`;
  if (days < 365) return `${Math.round(days / 30)} mois`;
  return String(new Date(ts * 1000).getFullYear());
}

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
function CoverTile({ entry, fav, fields, editing, releaseTs }) {
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
        {releaseTs != null && (
          <span className="cover-release" title="Date de sortie prévue">
            <CalendarClock size={11} /> {releaseCountdown(releaseTs)}
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

// Jaquette réordonnable À L'INTÉRIEUR d'une section (tri manuel des jeux). On
// arrête la propagation du pointerdown pour que saisir un jeu ne déclenche PAS
// aussi le glissé de la section entière (qui est elle-même une poignée). Le
// clic (< 6px) passe quand même vers la navigation grâce à la contrainte de
// distance du capteur.
function SortableGameTile({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
    touchAction: "none",
  };
  const composed = {
    ...listeners,
    onPointerDown: (e) => {
      listeners?.onPointerDown?.(e);
      e.stopPropagation();
    },
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pf-game-sortable ${isDragging ? "dragging" : ""}`}
      {...attributes}
      {...composed}
    >
      {children}
    </div>
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
  // Édition de la colonne latérale : masque les jeux et laisse l'aside occuper
  // toute la largeur (boîte à outils des cards à côté des cards actives).
  const [asideEditing, setAsideEditing] = useState(false);
  const [order, setOrder] = useState(() => resolveOrder(profile.overviewOrder));
  const [cards, setCards] = useState(() => resolveCards(profile.overviewCards));
  // Ordre manuel des jeux par section : { sectionKey: [gameId,…] }. Une section
  // présente ⇒ tri manuel (drag & drop) ; absente ⇒ tri « récemment modifié ».
  const [gameOrder, setGameOrder] = useState(() => profile.overviewGameOrder || {});

  // Resynchronise avec le serveur quand on n'édite pas (revalidation en fond).
  const savedOrderKey = (profile.overviewOrder || []).join("|");
  const savedCardsKey = (profile.overviewCards || []).join("|");
  const savedGameOrderKey = JSON.stringify(profile.overviewGameOrder || {});
  useEffect(() => {
    if (!editing) setOrder(resolveOrder(profile.overviewOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrderKey]);
  useEffect(() => {
    if (!editing) setCards(resolveCards(profile.overviewCards));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCardsKey]);
  useEffect(() => {
    if (!editing) setGameOrder(profile.overviewGameOrder || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedGameOrderKey]);

  const showAside = library.length > 0;
  const PREVIEW = 6;
  // Nombre max de jaquettes rendues glissables d'un coup (mode édition des
  // favoris) : au-delà, réordonner à la main n'a plus de sens et rendre des
  // centaines de tuiles plomberait les perfs — le surplus suit en « récent ».
  const MANUAL_MAX = 60;

  // Dates de sortie des jeux « à jouer » : non stockées en base, on interroge
  // /games/releases avec les ids de la wishlist (l'endpoint ne renvoie que les
  // sorties futures → la map ne contient que les jeux pas encore sortis).
  const wishIdsKey = useMemo(
    () =>
      library
        .filter((e) => e.status === "wishlist")
        .map((e) => e.gameId)
        .sort((a, b) => a - b)
        .join(","),
    [library]
  );
  const [releaseMap, setReleaseMap] = useState({});
  useEffect(() => {
    if (!wishIdsKey || !token) {
      setReleaseMap({});
      return;
    }
    let alive = true;
    apiFetch(`/games/releases?ids=${wishIdsKey}`, { token })
      .then((d) => {
        if (!alive) return;
        const map = {};
        for (const g of d.games || []) if (g.releaseDate) map[g.id] = g.releaseDate;
        setReleaseMap(map);
      })
      .catch(() => alive && setReleaseMap({}));
    return () => {
      alive = false;
    };
  }, [wishIdsKey, token]);

  // Les jeux « à jouer » pas encore sortis migrent dans « Jeux attendus »
  // (triés par date de sortie), le reste de la wishlist n'en garde que les
  // jeux déjà disponibles.
  const listOf = (key) => {
    if (key === "favorites") return favorites;
    if (key === "upcoming")
      return library
        .filter((e) => e.status === "wishlist" && releaseMap[e.gameId])
        .sort((a, b) => releaseMap[a.gameId] - releaseMap[b.gameId]);
    if (key === "wishlist")
      return library.filter((e) => e.status === "wishlist" && !releaseMap[e.gameId]);
    return library.filter((e) => e.status === key);
  };

  // Seule la section « favoris » est ordonnée manuellement (glisser-déposer) ;
  // les autres restent toujours en tri « récemment modifié ».
  // Applique l'ordre manuel enregistré des favoris : les jeux absents de l'ordre
  // (fraîchement ajoutés en favori) retombent à la fin, du plus récent au plus
  // ancien — comme le tri par défaut.
  const sortedFavorites = () => {
    const ord = gameOrder.favorites;
    if (!Array.isArray(ord)) return favorites;
    const rank = new Map(ord.map((id, i) => [id, i]));
    return favorites.slice().sort((a, b) => {
      const ra = rank.has(a.gameId) ? rank.get(a.gameId) : Infinity;
      const rb = rank.has(b.gameId) ? rank.get(b.gameId) : Infinity;
      if (ra !== rb) return ra - rb;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  };
  // Chez soi : toutes les sections (même vides, pour pouvoir ajouter). Chez les
  // autres : on masque les sections sans jeu. « Jeux attendus » est dérivée
  // (pas d'ajout manuel possible) : masquée dès qu'elle est vide.
  const visibleOrder = useMemo(
    () =>
      order.filter((key) =>
        key === "upcoming" ? listOf(key).length > 0 : isMe || listOf(key).length > 0
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, isMe, favorites, library, releaseMap]
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

  // Réordonne les favoris (drag & drop). On repart de l'ordre AFFICHÉ (complet,
  // via sortedFavorites) et non du seul tableau enregistré : ainsi les jeux mis
  // en favori après coup (rangés à la fin) restent déplaçables et l'ordre complet
  // est réenregistré.
  function onGameDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const cur = sortedFavorites().map((x) => x.gameId);
    const from = cur.indexOf(active.id);
    const to = cur.indexOf(over.id);
    if (from < 0 || to < 0) return;
    const next = { ...gameOrder, favorites: arrayMove(cur, from, to) };
    setGameOrder(next);
    onSavePrefs?.({ overviewGameOrder: next });
  }

  function renderBlockInner(key, isFirst) {
    const meta = BLOCK_META[key];
    const isFav = key === "favorites";
    const isUpcoming = key === "upcoming";
    // Favoris : toujours rangés manuellement (glissables en édition). Les autres
    // sections restent en tri « récemment modifié ».
    const list = isFav ? sortedFavorites() : listOf(key);
    // En édition, les favoris sont glissables : on montre jusqu'à MANUAL_MAX
    // jaquettes (pour pouvoir en remonter n'importe laquelle) ; le surplus suit
    // en récent. Hors favoris (ou hors édition), simple aperçu de 6.
    const draggable = isFav && editing;
    const preview = draggable ? list.slice(0, MANUAL_MAX) : list.slice(0, PREVIEW);
    const rest = draggable ? [] : list.slice(PREVIEW);
    const overflow = draggable ? list.length - preview.length : 0;

    const tiles = preview.map((e) => {
      const tile = (
        <CoverTile
          key={e.gameId}
          entry={e}
          fav={isFav}
          fields={cards}
          editing={editing}
          releaseTs={isUpcoming ? releaseMap[e.gameId] : null}
        />
      );
      return draggable ? (
        <SortableGameTile key={e.gameId} id={e.gameId}>
          {tile}
        </SortableGameTile>
      ) : (
        tile
      );
    });
    const rowExtras = (
      <>
        {rest.length > 0 && (
          <ShowMoreTile
            rest={rest}
            onClick={() => goAllGames(isFav ? { fav: "1" } : { st: isUpcoming ? "wishlist" : key })}
          />
        )}
        {/* Trop de favoris pour tout ranger à la main : le reste suit en récent. */}
        {overflow > 0 && (
          <span className="pf-order-more" title="Ces jeux suivent l'ordre récent, après ceux que tu ranges">
            +{overflow} à la suite
          </span>
        )}
        {!draggable &&
          isMe &&
          !isUpcoming &&
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
      </>
    );

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
        {draggable && (
          <p className="pf-order-hint font-fun">
            <GripVertical size={13} /> Glisse les jaquettes pour choisir l'ordre de tes favoris.
          </p>
        )}
        {draggable ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGameDragEnd}>
            <SortableContext items={preview.map((e) => e.gameId)} strategy={rectSortingStrategy}>
              <div className="cover-row">
                {tiles}
                {rowExtras}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="cover-row">
            {tiles}
            {rowExtras}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className={`pf-overview ${showAside ? "has-aside" : ""} ${
        asideEditing ? "aside-editing" : ""
      }`}
    >
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
          isMe={isMe}
          profile={profile}
          library={library}
          lists={lists}
          onSavePrefs={onSavePrefs}
          onEditingChange={setAsideEditing}
          onOpenTab={onOpenTab}
        />
      )}
    </div>
  );
}
