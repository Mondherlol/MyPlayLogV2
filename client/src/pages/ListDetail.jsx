import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Heart,
  Globe,
  Lock,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  Gamepad2,
  User,
  Cloud,
  CloudOff,
  Pencil,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ImagePlus,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { typeMeta, timeAgo, DEFAULT_TIERS, localId, LIST_TYPES } from "../lib/lists";
import AddItemsModal from "../components/AddItemsModal";
import ItemEditModal from "../components/ItemEditModal";
import ListComments from "../components/ListComments";
import ListGameCard from "../components/ListGameCard";
import ListCharacterCard from "../components/ListCharacterCard";

const TIER_COLORS = [
  "#ff5470", "#ff8b3d", "#f2b70b", "#3dd68c", "#4aa8ff", "#a879ff", "#8b93a7",
];

// Conteneur virtuel pour les éléments non classés (tier list) / la liste simple.
const POOL = "__pool__";
const tierOf = (containerId) => (containerId === POOL ? null : containerId);
const containerOfItem = (it) => it.tier ?? POOL;

export default function ListDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle|saving|saved
  const [adding, setAdding] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [activeId, setActiveId] = useState(null); // drag en cours (dnd-kit)
  const [poolCollapsed, setPoolCollapsed] = useState(false); // vivier replié
  // Mode édition : activé uniquement à la création (state de navigation) ou
  // via le bouton « Modifier ». À l'ouverture normale, on est en lecture.
  const [editing, setEditing] = useState(!!location.state?.edit);

  const isOwner = list?.mine;
  const editable = isOwner && editing; // droits d'écriture ET mode édition actif

  // --- Chargement ---
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/lists/${id}`, { token })
      .then((d) => {
        if (!alive) return;
        const l = d.list;
        setList(l);
        setItems(
          l.items.map((it) => ({ ...it, key: it._id || localId("it") }))
        );
        setTiers(l.type === "tier" ? (l.tiers?.length ? l.tiers : DEFAULT_TIERS) : []);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, token]);

  // --- Sauvegarde (debounce) ---
  const saveTimer = useRef(null);
  const latest = useRef({});
  latest.current = { list, items, tiers };

  const scheduleSave = useCallback(
    (patch) => {
      if (!latest.current.list?.mine) return;
      setSaveStatus("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const { list: l, items: its, tiers: trs } = latest.current;
        try {
          await apiFetch(`/lists/${id}`, {
            method: "PUT",
            token,
            body: {
              title: l.title,
              description: l.description,
              visibility: l.visibility,
              tiers: trs,
              type: l.type,
              items: its.map((i) => ({
                kind: i.kind,
                refId: i.refId,
                gameId: i.gameId,
                gameName: i.gameName,
                name: i.name,
                image: i.image,
                note: i.note,
                media: i.media,
                rating: i.rating,
                tier: i.tier,
              })),
              ...patch,
            },
          });
          setSaveStatus("saved");
          setList((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
        } catch {
          setSaveStatus("idle");
        }
      }, 700);
    },
    [id, token]
  );

  // --- Drag & drop (dnd-kit) ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Détection de collision : `pointerWithin` d'abord (le conteneur RÉELLEMENT
  // sous le curseur — indispensable pour passer d'un tier à l'autre), avec
  // repli sur `rectIntersection` quand le curseur est dans un interstice.
  const collisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    return pointer.length ? pointer : rectIntersection(args);
  }, []);

  // Conteneur d'un id (item ou zone), calculé sur une liste donnée pour rester
  // exact même pendant les mutations successives d'un drag.
  const findContainerIn = useCallback(
    (list, key) => {
      if (key === POOL) return POOL;
      if (tiers.some((t) => t.id === key)) return key;
      const it = list.find((i) => i.key === key);
      return it ? containerOfItem(it) : null;
    },
    [tiers]
  );

  function handleDragStart(e) {
    setActiveId(e.active.id);
  }

  // Déplacement entre conteneurs (tier list) : on ne mute qu'au changement de
  // zone ; le décalage à l'intérieur d'une zone est géré visuellement par
  // dnd-kit (pas de mutation d'état -> pas d'oscillation).
  function handleDragOver(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    setItems((prev) => {
      const from = findContainerIn(prev, active.id);
      const to = findContainerIn(prev, over.id);
      if (!from || !to || from === to) return prev;

      const activeIdx = prev.findIndex((i) => i.key === active.id);
      if (activeIdx < 0) return prev;
      const moved = { ...prev[activeIdx], tier: tierOf(to) };
      const without = prev.filter((_, k) => k !== activeIdx);

      let insertAt = without.findIndex((i) => i.key === over.id);
      if (insertAt < 0) {
        // Déposé sur la zone elle-même (vide) : on ajoute à la fin de la zone.
        let last = -1;
        without.forEach((i, k) => {
          if (containerOfItem(i) === to) last = k;
        });
        insertAt = last + 1;
      }
      return [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];
    });
  }

  function handleDragEnd(e) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    setItems((prev) => {
      const to = findContainerIn(prev, over.id);
      const activeIdx = prev.findIndex((i) => i.key === active.id);
      if (activeIdx < 0) return prev;
      let next = prev;
      // Assure le bon conteneur (dépôt sur une zone vide).
      if (to && containerOfItem(prev[activeIdx]) !== to) {
        next = prev.map((i, k) => (k === activeIdx ? { ...i, tier: tierOf(to) } : i));
      }
      const overIdx = next.findIndex((i) => i.key === over.id);
      const fromIdx = next.findIndex((i) => i.key === active.id);
      if (overIdx >= 0 && fromIdx >= 0 && fromIdx !== overIdx) {
        next = arrayMove(next, fromIdx, overIdx);
      }
      return next;
    });
    scheduleSave();
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const activeItem = activeId ? items.find((i) => i.key === activeId) : null;

  // --- Mutations d'items ---
  const existingRefIds = useMemo(() => new Set(items.map((i) => i.refId)), [items]);

  function toggleItem(raw) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.refId === raw.refId);
      if (idx >= 0) return prev.filter((_, k) => k !== idx);
      return [
        ...prev,
        { ...raw, note: "", media: [], rating: null, tier: null, key: localId("it") },
      ];
    });
    scheduleSave();
  }
  function removeItem(key) {
    setItems((prev) => prev.filter((i) => i.key !== key));
    scheduleSave();
  }
  function updateItem(key, patch) {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    scheduleSave();
  }

  // --- Champs de la liste ---
  function patchList(patch) {
    setList((prev) => ({ ...prev, ...patch }));
    scheduleSave();
  }

  // Change le type de la liste en conservant les items. Entrer en tier list
  // pose des paliers par défaut ; en sortir déclasse tous les items.
  function changeType(next) {
    if (!list || next === list.type) return;
    if (next === "tier") {
      setTiers((prev) => (prev.length ? prev : DEFAULT_TIERS));
    } else {
      setTiers([]);
      setItems((prev) => prev.map((i) => (i.tier ? { ...i, tier: null } : i)));
    }
    setList((prev) => ({ ...prev, type: next }));
    scheduleSave();
  }

  // --- Couverture ---
  const coverInputRef = useRef(null);
  const [coverBusy, setCoverBusy] = useState(false);
  async function uploadCover(file) {
    if (!file) return;
    setCoverBusy(true);
    try {
      const fd = new FormData();
      fd.append("cover", file);
      const { cover } = await apiUpload(`/lists/${id}/cover`, fd, token);
      setList((prev) => ({ ...prev, cover }));
    } catch (e) {
      alert(e.message);
    } finally {
      setCoverBusy(false);
    }
  }
  function removeCover() {
    patchList({ cover: null });
  }

  // --- Tiers ---
  function addTier() {
    const color = TIER_COLORS[tiers.length % TIER_COLORS.length];
    setTiers((prev) => [...prev, { id: localId("tier"), label: "Nouveau", color }]);
    scheduleSave();
  }
  function updateTier(tid, patch) {
    setTiers((prev) => prev.map((t) => (t.id === tid ? { ...t, ...patch } : t)));
    scheduleSave();
  }
  function removeTier(tid) {
    setItems((prev) => prev.map((i) => (i.tier === tid ? { ...i, tier: null } : i)));
    setTiers((prev) => prev.filter((t) => t.id !== tid));
    scheduleSave();
  }

  // --- Like ---
  async function toggleLike() {
    if (!list) return;
    const optimistic = {
      liked: !list.liked,
      likeCount: list.likeCount + (list.liked ? -1 : 1),
    };
    setList((prev) => ({ ...prev, ...optimistic }));
    try {
      const d = await apiFetch(`/lists/${id}/like`, { method: "POST", token });
      setList((prev) => ({ ...prev, liked: d.liked, likeCount: d.likeCount }));
    } catch {
      setList((prev) => ({
        ...prev,
        liked: !optimistic.liked,
        likeCount: prev.likeCount + (optimistic.liked ? -1 : 1),
      }));
    }
  }

  async function deleteList() {
    if (!confirm("Supprimer cette liste ? Cette action est définitive.")) return;
    try {
      await apiFetch(`/lists/${id}`, { method: "DELETE", token });
      navigate("/lists");
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement…
      </div>
    );
  if (error)
    return (
      <div className="explorer-error card" style={{ maxWidth: 520, margin: "3rem auto" }}>
        <h3>Impossible d'ouvrir la liste</h3>
        <p>{error}</p>
        <Link to="/lists" className="btn btn-ghost">
          <ArrowLeft size={18} /> Retour aux listes
        </Link>
      </div>
    );
  if (!list) return null;

  const meta = typeMeta(list.type);
  const ranked = list.type === "ranked";
  const isTier = list.type === "tier";
  const isGameList = (list.itemKind || "game") === "game";
  const pool = isTier ? items.filter((i) => !i.tier) : items;

  return (
    <div className="ld-page">
      {/* --- En-tête --- */}
      <div className="ld-topbar">
        <Link to="/lists" className="ld-back clickable">
          <ArrowLeft size={18} /> Listes
        </Link>
        {editable && (
          <span className={`ld-save save-${saveStatus}`}>
            {saveStatus === "saving" ? (
              <><Loader2 size={14} className="spin" /> Enregistrement…</>
            ) : saveStatus === "saved" ? (
              <><Cloud size={14} /> Enregistré</>
            ) : (
              <><CloudOff size={14} /> Modifs locales</>
            )}
          </span>
        )}
      </div>

      <header className={`ld-header card ${list.cover ? "has-cover" : ""}`}>
        {list.cover && (
          <div className="ld-cover">
            <img src={list.cover} alt="" draggable="false" />
            {editable && (
              <div className="ld-cover-actions">
                <button
                  type="button"
                  className="ld-cover-btn clickable"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverBusy}
                >
                  {coverBusy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <ImagePlus size={15} />
                  )}
                  Changer
                </button>
                <button
                  type="button"
                  className="ld-cover-btn danger clickable"
                  onClick={removeCover}
                >
                  <X size={15} /> Retirer
                </button>
              </div>
            )}
          </div>
        )}
        {/* input fichier partagé (banner + bouton dans les actions) */}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            uploadCover(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <div className="ld-header-main">
          <div className="ld-title-row">
            {editable ? (
              <input
                className="ld-title-input"
                value={list.title}
                maxLength={120}
                onChange={(e) => patchList({ title: e.target.value })}
                placeholder="Titre de la liste"
              />
            ) : (
              <h1 className="ld-title">{list.title}</h1>
            )}
            {editable ? (
              <div className="ld-typeswitch" role="group" aria-label="Type de liste">
                {Object.values(LIST_TYPES).map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`ld-type-opt clickable ${list.type === t.value ? "active" : ""}`}
                    onClick={() => changeType(t.value)}
                    title={t.desc}
                  >
                    <t.Icon size={13} /> {t.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`list-type-badge t-${list.type}`}>
                <meta.Icon size={13} /> {meta.long}
              </span>
            )}
          </div>

          {editable ? (
            <textarea
              className="ld-desc-input"
              value={list.description}
              maxLength={2000}
              rows={2}
              placeholder="Ajoute une description…"
              onChange={(e) => patchList({ description: e.target.value })}
            />
          ) : (
            list.description && <p className="ld-desc">{list.description}</p>
          )}

          <div className="ld-meta">
            <span className="ld-author">
              par{" "}
              {list.author?.username ? (
                <Link to={`/u/${list.author.username}`} className="ld-author-link">
                  <strong>@{list.author.username}</strong>
                </Link>
              ) : (
                <strong>—</strong>
              )}
            </span>
            <span className="dot">·</span>
            <span>{items.length} élément{items.length > 1 ? "s" : ""}</span>
            <span className="dot">·</span>
            <span>màj {timeAgo(list.updatedAt)}</span>
          </div>
        </div>

        <div className="ld-header-actions">
          <button
            className={`ld-like clickable ${list.liked ? "liked" : ""}`}
            onClick={toggleLike}
            title="J'aime"
          >
            <Heart size={18} fill={list.liked ? "currentColor" : "none"} />
            {list.likeCount}
          </button>
          {isOwner && !editing && (
            <>
              <button
                className="ld-edit clickable"
                onClick={() => setEditing(true)}
                title="Modifier la liste"
              >
                <Pencil size={16} /> Modifier
              </button>
              <button
                className="ld-del clickable"
                onClick={deleteList}
                title="Supprimer la liste"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
          {editable && (
            <>
              {!list.cover && (
                <button
                  className="ld-vis clickable"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverBusy}
                  title="Ajouter une couverture"
                >
                  {coverBusy ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <ImagePlus size={16} />
                  )}
                  Couverture
                </button>
              )}
              <button
                className="ld-vis clickable"
                onClick={() =>
                  patchList({
                    visibility: list.visibility === "public" ? "private" : "public",
                  })
                }
                title="Changer la visibilité"
              >
                {list.visibility === "public" ? (
                  <><Globe size={16} /> Publique</>
                ) : (
                  <><Lock size={16} /> Privée</>
                )}
              </button>
              <button className="ld-del clickable" onClick={deleteList} title="Supprimer">
                <Trash2 size={16} />
              </button>
              <button
                className="ld-edit done clickable"
                onClick={() => setEditing(false)}
                title="Terminer l'édition"
              >
                <Check size={16} /> Terminé
              </button>
            </>
          )}
        </div>
      </header>

      {/* --- Corps --- */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {isTier ? (
          <div
            className={`tier-board ${editable ? "has-dock" : ""} ${
              editable && poolCollapsed ? "dock-collapsed" : ""
            }`}
          >
            {tiers.map((t) => (
              <TierRow
                key={t.id}
                tier={t}
                items={items.filter((i) => i.tier === t.id)}
                editable={editable}
                onEdit={setEditItem}
                onRemove={removeItem}
                onUpdateTier={updateTier}
                onRemoveTier={removeTier}
              />
            ))}
            {editable && (
              <button className="tier-add clickable" onClick={addTier}>
                <Plus size={16} /> Ajouter un palier
              </button>
            )}

            {/* Vivier des éléments non classés */}
            <PoolZone
              items={pool}
              totalCount={items.length}
              editable={editable}
              docked={editable}
              collapsed={poolCollapsed}
              onToggleCollapse={() => setPoolCollapsed((v) => !v)}
              onAdd={() => setAdding(true)}
              onEdit={setEditItem}
              onRemove={removeItem}
            />
          </div>
        ) : (
          <>
            {editable && (
              <div className="ld-toolbar">
                <button className="ld-addbtn clickable" onClick={() => setAdding(true)}>
                  <Plus size={17} /> Ajouter des jeux
                </button>
                <span className="ld-hint font-fun">Glisse les cartes pour les réorganiser</span>
              </div>
            )}
            {items.length === 0 ? (
              <div className="ld-empty card">
                <meta.Icon size={30} />
                <p className="font-fun">Cette liste est vide pour l'instant.</p>
                {editable && (
                  <button className="btn btn-primary" onClick={() => setAdding(true)}>
                    <Plus size={18} /> Ajouter des jeux
                  </button>
                )}
              </div>
            ) : !editable ? (
              // Lecture : cards riches (lien jeu, menu d'actions, bulle
              // d'annotation). Pas de drag en lecture.
              <div className={`ld-grid rich ${ranked ? "ranked" : ""}`}>
                {items.map((it, i) =>
                  isGameList ? (
                    <ListGameCard
                      key={it.key}
                      item={it}
                      rank={ranked ? i + 1 : null}
                    />
                  ) : (
                    <ListCharacterCard
                      key={it.key}
                      item={it}
                      rank={ranked ? i + 1 : null}
                    />
                  )
                )}
              </div>
            ) : (
              <SortableContext
                items={items.map((i) => i.key)}
                strategy={rectSortingStrategy}
              >
                <div className={`ld-grid ${ranked ? "ranked" : ""}`}>
                  {items.map((it, i) => (
                    <SortableItemCard
                      key={it.key}
                      item={it}
                      rank={ranked ? i + 1 : null}
                      editable={editable}
                      onEdit={setEditItem}
                      onRemove={removeItem}
                    />
                  ))}
                </div>
              </SortableContext>
            )}
          </>
        )}

        {/* --- Fantôme de drag --- */}
        <DragOverlay dropAnimation={null}>
          {activeItem ? (
            <div className="drag-overlay-card">
              <div className="ic-cover">
                {activeItem.image ? (
                  <img src={activeItem.image} alt="" draggable="false" />
                ) : activeItem.kind === "character" ? (
                  <User size={22} />
                ) : (
                  <Gamepad2 size={22} />
                )}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* --- Commentaires (masqués en mode édition) --- */}
      {!editing && <ListComments listId={id} list={list} token={token} />}

      {adding && (
        <AddItemsModal
          kind={list.itemKind || "game"}
          existing={existingRefIds}
          onToggle={toggleItem}
          onClose={() => setAdding(false)}
        />
      )}
      {editItem && (
        <ItemEditModal
          item={editItem}
          onSave={(patch) => {
            updateItem(editItem.key, patch);
            setEditItem(null);
          }}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}

// --- Vivier (éléments non classés d'une tier list) ---
function PoolZone({
  items,
  totalCount,
  editable,
  docked,
  collapsed,
  onToggleCollapse,
  onAdd,
  onEdit,
  onRemove,
}) {
  const { setNodeRef } = useDroppable({ id: POOL });
  const scrollRef = useRef(null);
  const [query, setQuery] = useState("");
  // Défilement possible à gauche / à droite (pilote l'affichage des flèches).
  const [scrollState, setScrollState] = useState({ left: false, right: false });

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const haystack = `${it.name || ""} ${it.gameName || ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const updateScroll = useCallback(() => {
    const n = scrollRef.current;
    if (!n) return setScrollState({ left: false, right: false });
    setScrollState({
      left: n.scrollLeft > 2,
      right: n.scrollLeft + n.clientWidth < n.scrollWidth - 2,
    });
  }, []);

  // Recalcule quand le contenu change (ajout/retrait, filtre, repli) + au resize.
  useEffect(() => {
    updateScroll();
    window.addEventListener("resize", updateScroll);
    return () => window.removeEventListener("resize", updateScroll);
  }, [updateScroll, visibleItems.length, collapsed]);

  function scrollByCards(direction) {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * 420, behavior: "smooth" });
  }

  return (
    <div className={`tier-pool ${docked ? "is-docked" : ""} ${collapsed ? "is-collapsed" : ""}`}>
      <div
        className="tier-pool-head"
        onClick={collapsed ? onToggleCollapse : undefined}
      >
        <button
          type="button"
          className="tier-pool-title clickable"
          onClick={collapsed ? undefined : onToggleCollapse}
          title={collapsed ? "Déplier le vivier" : "Réduire le vivier"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          <span>Non classés</span>
          <span className="tier-pool-count">{items.length}</span>
        </button>
        {!collapsed && (
          <div className="tier-pool-head-actions">
            {items.length > 8 && (
              <label className="tier-pool-search">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un jeu ou perso"
                />
              </label>
            )}
            {editable && (
              <button className="ld-addbtn small clickable" onClick={onAdd}>
                <Plus size={15} /> Ajouter
              </button>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="tier-pool-scroll-wrap">
          {scrollState.left && (
            <button
              type="button"
              className="tier-pool-arrow tier-pool-arrow-left"
              onClick={() => scrollByCards(-1)}
              aria-label="Faire défiler vers la gauche"
            >
              <ArrowLeft size={15} />
            </button>
          )}
          {scrollState.right && (
            <button
              type="button"
              className="tier-pool-arrow tier-pool-arrow-right"
              onClick={() => scrollByCards(1)}
              aria-label="Faire défiler vers la droite"
            >
              <ArrowLeft size={15} />
            </button>
          )}

          <SortableContext items={visibleItems.map((i) => i.key)} strategy={horizontalListSortingStrategy}>
            <div
              className="tier-pool-items"
              onScroll={updateScroll}
              ref={(node) => {
                setNodeRef(node);
                scrollRef.current = node;
              }}
            >
              {visibleItems.map((it) => (
                <SortableItemCard
                  key={it.key}
                  item={it}
                  editable={editable}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  compact
                />
              ))}
              {visibleItems.length === 0 &&
                (query.trim() ? (
                  <p className="tier-pool-empty font-fun">Aucun résultat.</p>
                ) : !editable ? (
                  <p className="tier-pool-empty font-fun">Rien ici.</p>
                ) : totalCount === 0 ? (
                  <button className="tier-pool-cta clickable" onClick={onAdd}>
                    <Plus size={16} /> Ajouter un premier élément
                  </button>
                ) : (
                  <p className="tier-pool-empty font-fun">
                    Tout est classé — glisse un élément ici pour le déclasser.
                  </p>
                ))}
            </div>
          </SortableContext>
        </div>
      )}
    </div>
  );
}

// --- Rangée de palier (tier list) ---
function TierRow({
  tier, items, editable, onEdit, onRemove, onUpdateTier, onRemoveTier,
}) {
  const [editingTier, setEditingTier] = useState(false);
  const { setNodeRef } = useDroppable({ id: tier.id });
  return (
    <div className="tier-row">
      <div
        className="tier-label"
        style={{ background: tier.color }}
        onClick={() => editable && setEditingTier((v) => !v)}
        title={editable ? "Modifier le palier" : undefined}
      >
        {editingTier ? (
          <input
            className="tier-label-input"
            autoFocus
            value={tier.label}
            maxLength={24}
            onChange={(e) => onUpdateTier(tier.id, { label: e.target.value })}
            onBlur={() => setEditingTier(false)}
            onKeyDown={(e) => e.key === "Enter" && setEditingTier(false)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tier-label-text">{tier.label || "—"}</span>
        )}
      </div>

      <SortableContext items={items.map((i) => i.key)} strategy={rectSortingStrategy}>
        <div className="tier-drop" ref={setNodeRef}>
          {items.map((it) => (
            <SortableItemCard
              key={it.key}
              item={it}
              editable={editable}
              onEdit={onEdit}
              onRemove={onRemove}
              compact
            />
          ))}
        </div>
      </SortableContext>

      {editable && editingTier && (
        <div className="tier-tools">
          <div className="tier-colors">
            {TIER_COLORS.map((c) => (
              <button
                key={c}
                className="tier-color-dot clickable"
                style={{ background: c }}
                onClick={() => onUpdateTier(tier.id, { color: c })}
                aria-label="Couleur"
              />
            ))}
          </div>
          <button className="tier-remove clickable" onClick={() => onRemoveTier(tier.id)}>
            <Trash2 size={14} /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

// --- Élément triable : branche dnd-kit sur la carte présentational ---
function SortableItemCard({ item, editable, ...rest }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.key, disabled: !editable });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ItemCard
      item={item}
      editable={editable}
      innerRef={setNodeRef}
      style={style}
      dragging={isDragging}
      dragProps={editable ? { ...attributes, ...listeners } : {}}
      {...rest}
    />
  );
}

// --- Carte d'un élément (jeu ou perso) ---
function ItemCard({
  item, rank, editable, dragging, onEdit, onRemove, compact, palette,
  innerRef, style, dragProps,
}) {
  const isChar = item.kind === "character";
  const navigate = useNavigate();
  // En lecture, la carte est cliquable vers la page du jeu (y compris pour les
  // personnages, qui pointent vers leur jeu d'origine).
  const linkable = !editable && !!item.gameId;
  return (
    <div
      ref={innerRef}
      style={style}
      title={compact ? item.name : undefined}
      className={`ic-card ${compact ? "compact" : ""} ${palette ? "palette" : ""} ${dragging ? "dragging" : ""} ${editable ? "grab" : ""} ${linkable ? "clickable" : ""}`}
      onClick={linkable ? () => navigate(`/game/${item.gameId}`) : undefined}
      {...dragProps}
    >
      {rank != null && <span className="ic-rank">{rank}</span>}
      <div className="ic-cover">
        {item.image ? (
          <img src={item.image} alt={item.name} loading="lazy" draggable="false" />
        ) : isChar ? (
          <User size={24} />
        ) : (
          <Gamepad2 size={24} />
        )}
        {item.rating != null && <span className="ic-rating">{item.rating}</span>}
      </div>

      {!compact && (
        <div className="ic-body">
          <span className="ic-name">{item.name}</span>
          {isChar && item.gameName && (
            <span className="ic-sub">{item.gameName}</span>
          )}
          {item.note ? (
            <p className="ic-note">{item.note}</p>
          ) : (
            item.media?.length > 0 && (
              <p className="ic-note ic-note-media">
                <ImagePlus size={12} /> Média joint
              </p>
            )
          )}
        </div>
      )}
      {compact && palette && (
        <div className="ic-body compact-body">
          <span className="ic-name">{item.name}</span>
          {isChar && item.gameName && (
            <span className="ic-sub">{item.gameName}</span>
          )}
        </div>
      )}
      {compact && item.note && <span className="ic-note-dot" title={item.note} />}

      {editable && (
        <div className="ic-actions">
          {/* Pas d'annotation sur les tier lists (tuiles compactes) : seul le
              retrait est proposé. L'annotation reste dispo sur les cards pleines. */}
          {!compact && (
            <button
              className="ic-btn clickable"
              title="Annotation"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onEdit(item)}
            >
              <Pencil size={13} />
            </button>
          )}
          <button
            className="ic-btn danger clickable"
            title="Retirer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onRemove(item.key)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {editable && !compact && (
        <span className="ic-grip" title="Glisser">
          <GripVertical size={15} />
        </span>
      )}
    </div>
  );
}
