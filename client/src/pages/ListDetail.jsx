import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  MessageCircle,
  CopyPlus,
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
  ImageDown,
  Play,
  MonitorPlay,
  BadgeCheck,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
} from "lucide-react";
import { createPortal } from "react-dom";
import AwardsBoard from "../components/AwardsBoard";
import MoreLike from "../components/lists/MoreLike";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
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
import { useToast } from "../context/ToastContext";
import {
  typeMeta,
  timeAgo,
  DEFAULT_TIERS,
  localId,
  GAME_LIST_TYPES,
  DRAFT_ID,
  readListDraft,
  clearListDraft,
} from "../lib/lists";
import PlaylistDetail from "./PlaylistDetail";
import NineDetail from "./NineDetail";
import BoardDetail from "./BoardDetail";
import AddItemsModal from "../components/AddItemsModal";
import ItemEditModal from "../components/ItemEditModal";
import ListComments from "../components/ListComments";
import ListGameCard from "../components/ListGameCard";
import ListCharacterCard from "../components/ListCharacterCard";
import ListRowsView from "../components/ListRowsView";
import ListExportModal from "../components/ListExportModal";
import useMediaQuery from "../hooks/useMediaQuery";
import { scrollRailBy } from "../lib/railScroll";
import { useScrollLock } from "../hooks/useScrollLock";

const TIER_COLORS = [
  "#ff5470", "#ff8b3d", "#f2b70b", "#3dd68c", "#4aa8ff", "#a879ff", "#8b93a7",
];

const fmtEventDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Rediffusion d'une conférence, en tête des listes officielles d'événements.
// Façade avant tout : on affiche la vignette YouTube, et l'iframe (lourde, et
// qui pose ses cookies) n'arrive QUE si on décide de regarder.
function EventReplay({ event }) {
  const [playing, setPlaying] = useState(false);
  if (!event?.videoId) {
    // Live hébergé ailleurs (Twitch…) : on ne sait pas l'intégrer, on donne
    // au moins le lien.
    if (!event?.videoUrl) return null;
    return (
      <a
        className="ld-replay ld-replay-link clickable"
        href={event.videoUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        <MonitorPlay size={18} /> Revoir la conférence
      </a>
    );
  }

  if (playing) {
    return (
      <div className="ld-replay is-playing">
        <div className="ld-replay-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${event.videoId}?autoplay=1`}
            title={event.name || "Rediffusion"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <button
          type="button"
          className="ld-replay-close clickable"
          onClick={() => setPlaying(false)}
          aria-label="Fermer la vidéo"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <button type="button" className="ld-replay clickable" onClick={() => setPlaying(true)}>
      <span className="ld-replay-thumb">
        <img
          src={`https://i.ytimg.com/vi/${event.videoId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          draggable="false"
        />
        <span className="ld-replay-play">
          <Play size={22} fill="currentColor" strokeWidth={0} />
        </span>
      </span>
      <span className="ld-replay-body">
        <span className="ld-replay-kicker">
          <MonitorPlay size={13} /> Rediffusion
        </span>
        <strong className="ld-replay-title">Revoir la conférence</strong>
        <span className="ld-replay-sub">
          {event.name}
          {event.startTime ? ` · ${fmtEventDate.format(new Date(event.startTime))}` : ""}
        </span>
      </span>
    </button>
  );
}

// Tags de la liste en mode édition : Entrée (ou virgule) ajoute, Retour
// arrière sur un champ vide retire le dernier. 8 au plus, comme le serveur.
function TagEditor({ tags, onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
    setDraft("");
    if (!t || tags.length >= 8 || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    onChange([...tags, t]);
  };
  return (
    <div className="ld-tags editing">
      {tags.map((t) => (
        <span key={t} className="ld-tag">
          {t}
          <button
            type="button"
            className="ld-tag-x clickable"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            aria-label={`Retirer le tag ${t}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {tags.length < 8 && (
        <input
          className="ld-tag-input"
          value={draft}
          maxLength={24}
          placeholder={tags.length ? "Ajouter un tag" : "Ajouter des tags"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
        />
      )}
    </div>
  );
}

// Conteneur virtuel pour les éléments non classés (tier list) / la liste simple.
const POOL = "__pool__";
const tierOf = (containerId) => (containerId === POOL ? null : containerId);
const containerOfItem = (it) => it.tier ?? POOL;

// ======================================================================
//  Le brouillon : une liste qui n'existe pas encore
// ======================================================================
// « Tier list des jeux Yakuza » (cf. components/lists/TierIdea) s'ouvre ICI,
// sur /lists/draft, avec ses jeux dans le vivier — mais sans rien créer.
// Cliquer par curiosité ne doit pas laisser une tier list vide sur son profil.
// La liste naît au premier jeu posé dans un palier : c'est là qu'elle devient
// la sienne. Quitter la page avant, c'est l'abandonner, sans trace
// (cf. lib/lists, `openListDraft`).

// Ce qui fait qu'un brouillon mérite d'exister : un jeu classé dans un palier
// (tier list), un élément tout court ailleurs.
const draftWorthSaving = (list, items) =>
  list.type === "tier" ? items.some((i) => i.tier) : items.length > 0;

export default function ListDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(id === DRAFT_ID ? "draft" : "idle"); // draft|idle|saving|saved
  const [adding, setAdding] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [activeId, setActiveId] = useState(null); // drag en cours (dnd-kit)
  const [poolCollapsed, setPoolCollapsed] = useState(false); // vivier replié
  const [exporting, setExporting] = useState(false); // modale d'export PNG
  // Cartes (jaquettes) ou liste détaillée (une ligne par jeu). Le choix suit
  // le joueur d'une liste à l'autre : c'est une préférence de lecture.
  const [view, setView] = useState(
    () => localStorage.getItem("mpl_list_view") || "cards"
  );
  const setViewMode = (v) => {
    setView(v);
    localStorage.setItem("mpl_list_view", v);
  };
  // Mode édition : activé uniquement à la création (state de navigation) ou
  // via le bouton « Modifier ». À l'ouverture normale, on est en lecture.
  const [editing, setEditing] = useState(!!location.state?.edit);

  const isOwner = list?.mine;
  const editable = isOwner && editing; // droits d'écriture ET mode édition actif
  // Un admin peut changer l'image d'une liste publiée par le site (top,
  // conférence, palmarès) sans en être l'auteur — et rien d'autre. Le serveur
  // vérifie de son côté (cf. routes/lists `adminOnOfficial`).
  const adminCover =
    !isOwner && !!(user?.isAdmin || user?.isSuperAdmin) && !!(list?.official || list?.event);

  // --- Téléphone ---
  // L'en-tête de bureau (titre, type, description, tags, auteur, sept boutons)
  // mangeait les trois quarts de l'écran avant le premier jeu. Sur téléphone :
  // une ligne de titre avec le retour et les actions en icônes, et tout le
  // réglage de la liste (type, description, tags, couverture, visibilité,
  // suppression) dans une feuille, comme dans l'appli.
  const phone = useMediaQuery("(max-width: 620px)");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // En édition, la barre d'onglets du bas s'efface : elle recouvrait le vivier
  // des éléments à classer (cf. `body.ld-editing` dans app-03-lists.css).
  useEffect(() => {
    if (!editable) return undefined;
    document.body.classList.add("ld-editing");
    return () => document.body.classList.remove("ld-editing");
  }, [editable]);

  // Revenir d'où l'on vient (profil, feed, recherche…) quand on y est arrivé
  // depuis l'app ; sinon la page des listes (accès direct, lien partagé).
  const goBack = (e) => {
    if (location.key !== "default") {
      e?.preventDefault();
      navigate(-1);
    }
  };

  // Brouillon enregistré pour de bon : son identifiant, et la création en vol
  // (deux sauvegardes rapprochées ne doivent pas créer deux listes).
  const createdId = useRef(null);
  const creating = useRef(null);

  // --- Chargement ---
  useEffect(() => {
    // On vient de créer cette liste depuis son brouillon : elle est déjà à
    // l'écran, la recharger ferait clignoter la page (et couperait le drag).
    if (createdId.current && createdId.current === id) return undefined;
    if (id === DRAFT_ID) {
      const d = readListDraft(location.state);
      if (!d || !user) {
        setError(d ? "Connecte-toi pour faire ta tier list." : "Ce brouillon n'existe plus.");
      } else {
        const type = d.type || "tier";
        setList({
          id: null,
          draft: true,
          mine: true,
          title: d.title,
          description: "",
          type,
          itemKind: d.itemKind || "game",
          visibility: "public",
          tags: [],
          cover: null,
          likeCount: 0,
          liked: false,
          comments: [],
          author: { username: user.username, avatar: user.avatar },
          updatedAt: new Date().toISOString(),
        });
        setItems(
          (d.items || []).map((it) => ({
            note: "",
            media: [],
            rating: null,
            ...it,
            tier: null,
            key: localId("it"),
          }))
        );
        setTiers(type === "tier" ? DEFAULT_TIERS : []);
        setEditing(true);
        setError(null);
      }
      setLoading(false);
      return undefined;
    }
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
    // `user?.id` : la session peut arriver après la page (brouillon ouvert à froid).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, user?.id]);

  // --- Sauvegarde (debounce) ---
  const saveTimer = useRef(null);
  const latest = useRef({});
  latest.current = { list, items, tiers };

  const scheduleSave = useCallback(
    (patch) => {
      if (!latest.current.list?.mine) return;
      if (!latest.current.list.draft) setSaveStatus("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const { list: l, items: its, tiers: trs } = latest.current;
        const body = {
          title: l.title,
          description: l.description,
          visibility: l.visibility,
          // Sans elle, « Retirer l'image » ne quittait jamais l'écran :
          // le serveur gardait l'ancienne couverture.
          cover: l.cover || null,
          tags: l.tags || [],
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
        };
        try {
          // Brouillon : rien ne part tant qu'aucun jeu n'est classé. Au premier,
          // la liste est CRÉÉE (et rejoint le profil) ; l'adresse prend son
          // vrai identifiant sans recharger la page.
          if (l.draft && !createdId.current) {
            if (!draftWorthSaving(l, its)) {
              setSaveStatus("draft");
              return;
            }
            setSaveStatus("saving");
            if (!creating.current) {
              creating.current = apiFetch("/lists", {
                method: "POST",
                token,
                body: { ...body, itemKind: l.itemKind },
              })
                .then((d) => d.list.id)
                .catch((e) => {
                  creating.current = null;
                  throw e;
                });
            }
            const newId = await creating.current;
            if (!createdId.current) {
              createdId.current = newId;
              clearListDraft();
              setList((prev) => ({ ...prev, id: newId, draft: false }));
              navigate(`/lists/${newId}`, { replace: true, state: { edit: true } });
              toast.show({
                title: "Tier list enregistrée",
                text: "Elle est maintenant sur ton profil.",
                undo: async () => {
                  await apiFetch(`/lists/${newId}`, { method: "DELETE", token });
                  navigate("/lists");
                },
              });
            }
            setSaveStatus("saved");
            return;
          }
          await apiFetch(`/lists/${createdId.current || id}`, {
            method: "PUT",
            token,
            body,
          });
          setSaveStatus("saved");
          setList((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
        } catch {
          setSaveStatus(l.draft && !createdId.current ? "draft" : "idle");
        }
      }, 700);
    },
    [id, token, navigate, toast]
  );

  // --- Drag & drop (dnd-kit) ---
  // Souris : le drag démarre dès 6 px de déplacement. Tactile : appui long
  // (220 ms) avant de saisir, sinon un simple glissé du doigt fait défiler la
  // page / le vivier au lieu de déclencher un drag (indispensable sur mobile).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } })
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

  // --- Un top officiel comme modèle ---
  // « Top 100 des meilleurs jeux Switch » → « Mon top 100 des meilleurs jeux
  // Switch » ; « Les 25 meilleurs Zelda » → « Mes 25 meilleurs Zelda ».
  function myTopTitle(title) {
    const t = String(title || "").trim();
    if (/^les\s/i.test(t)) return `Mes ${t.slice(4)}`;
    return `Mon ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  }
  const [forking, setForking] = useState(false);
  // L'en-tête est-il sorti de l'écran ? La barre collée du haut affiche alors
  // le titre de la liste.
  const headerRef = useRef(null);
  const [headerGone, setHeaderGone] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([e]) => setHeaderGone(!e.isIntersecting), {
      rootMargin: "-120px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list?.id, loading]);
  /**
   * Faire SON top à partir d'un top officiel : une copie à soi, mêmes jeux
   * dans le même ordre, ouverte directement en édition — on réordonne, on
   * retire, on ajoute. Les notes de la liste d'origine ne suivent pas : ce
   * sont celles du site, pas les siennes.
   */
  async function useAsTemplate() {
    if (!token) return navigate("/login");
    if (forking) return;
    setForking(true);
    try {
      const body = {
        title: myTopTitle(list.title).slice(0, 120),
        type: list.type,
        itemKind: list.itemKind || "game",
        tags: (list.tags || []).filter((t) => t !== "Saga" && t !== "Thème"),
        items: items.map(({ key, _id, note, media, ...it }) => ({ ...it, note: "", media: [] })),
      };
      const { list: made } = await apiFetch("/lists", { method: "POST", token, body });
      navigate(`/lists/${made.id}`, { state: { edit: true } });
      toast.show({
        title: "Ton top est prêt",
        text: "Réordonne, retire ou ajoute des jeux : il est à toi.",
        cover: items[0]?.image || null,
        undo: async () => {
          await apiFetch(`/lists/${made.id}`, { method: "DELETE", token });
          navigate(`/lists/${id}`);
        },
      });
    } catch (e) {
      alert(e.message || "Impossible de créer ton top.");
    } finally {
      setForking(false);
    }
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
  async function removeCover() {
    if (!adminCover) return patchList({ cover: null });
    setCoverBusy(true);
    try {
      await apiFetch(`/lists/${id}/cover`, { method: "DELETE", token });
      setList((prev) => ({ ...prev, cover: null }));
    } catch (e) {
      alert(e.message);
    } finally {
      setCoverBusy(false);
    }
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
    // Un brouillon n'existe nulle part : l'abandonner, c'est juste partir.
    if (list?.draft) {
      clearTimeout(saveTimer.current);
      navigate("/lists");
      return;
    }
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

  // Les PlayLists d'OST ont leur propre page (CD + pistes en arc). On garde la
  // même route /lists/:id : la donnée chargée décide du rendu.
  if (list.type === "playlist")
    return <PlaylistDetail key={list.id} id={id} initial={list} />;

  // Les cartes de joueur (un jeu par case) aussi : une grille de vingt cases.
  if (list.board)
    return (
      <BoardDetail
        key={list.id}
        list={list}
        items={items}
        token={token}
        onLike={toggleLike}
        onChanged={(l) => {
          setList((prev) => ({ ...prev, ...l }));
          setItems((l.items || []).map((it) => ({ ...it, key: it._id || localId("it") })));
        }}
      />
    );

  // Les listes des 9 ont leur page à elles : une affiche, une grille 3 × 3.
  if (list.nine)
    return (
      <NineDetail
        key={list.id}
        list={list}
        items={items}
        token={token}
        onLike={toggleLike}
        onDelete={deleteList}
        onChanged={(l) => {
          setList((prev) => ({ ...prev, ...l }));
          setItems((l.items || []).map((it) => ({ ...it, key: it._id || localId("it") })));
        }}
      />
    );

  const meta = typeMeta(list.type);
  const ranked = list.type === "ranked";
  const isTier = list.type === "tier";
  const isGameList = (list.itemKind || "game") === "game";
  const pool = isTier ? items.filter((i) => !i.tier) : items;
  // La vue détaillée n'a de sens que sur une liste de JEUX en lecture : elle
  // s'appuie sur les fiches IGDB, et le réordonnancement se fait en cartes.
  const canRows = isGameList && !isTier && !editable && items.length > 0;
  const rowsView = canRows && view === "rows";

  return (
    <div className="ld-page">
      {/* --- La barre du haut : collée sous la barre de l'app en défilant.
          Le titre de la liste y apparaît quand l'en-tête est sorti de l'écran
          (on sait toujours où l'on est, et « Retour » reste à un clic). --- */}
      {phone ? (
        <PhoneHeader
          headerRef={headerRef}
          list={list}
          meta={meta}
          items={items}
          isGameList={isGameList}
          isOwner={isOwner}
          editable={editable}
          editing={editing}
          token={token}
          adminCover={adminCover}
          coverBusy={coverBusy}
          forking={forking}
          onBack={goBack}
          onTitle={(title) => patchList({ title })}
          onEdit={() => setEditing(true)}
          onDone={() => setEditing(false)}
          onSettings={() => setSettingsOpen(true)}
          onLike={toggleLike}
          onExport={() => (token ? setExporting(true) : navigate("/login"))}
          onTemplate={useAsTemplate}
          onPickCover={() => coverInputRef.current?.click()}
          onRemoveCover={removeCover}
        />
      ) : (
      <>
      <div className={`ld-topbar ${headerGone ? "is-stuck" : ""}`}>
        <Link to="/lists" className="ld-back clickable" onClick={goBack}>
          <ArrowLeft size={18} /> Retour
        </Link>
        <span className="ld-topbar-title" aria-hidden={!headerGone}>
          {list.title}
        </span>
        {editable && saveStatus !== "idle" && (
          <span className={`ld-save save-${saveStatus}`}>
            {saveStatus === "draft" ? (
              <><CloudOff size={14} /> Classe un jeu pour l'enregistrer</>
            ) : saveStatus === "saving" ? (
              <><Loader2 size={14} className="spin" /> Enregistrement…</>
            ) : (
              <><Cloud size={14} /> Enregistré</>
            )}
          </span>
        )}
      </div>

      {/* --- L'en-tête : compact. À gauche ce qu'est la liste (titre, type,
          description, tags) ; à droite QUI l'a faite et ce qu'on peut en
          faire (aimer, commenter, exporter…). --- */}
      <header ref={headerRef} className={`ld-header card ${list.cover ? "has-cover" : ""}`}>
        {list.cover && (
          <div className="ld-cover">
            <img src={list.cover} alt="" draggable="false" />
            {adminCover && (
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
            <span className={`list-type-badge t-${list.type}`}>
              <meta.Icon size={13} /> {meta.long}
            </span>
          </div>

          {/* ⚠️ EN ÉDITION AUSSI, L'EN-TÊTE RESTE EN LECTURE. Le sélecteur de
              type, la zone de description et l'éditeur de tags doublaient sa
              hauteur : tout ça vit maintenant dans la fenêtre « Réglages »
              (cf. ListSettingsSheet), et seul le titre s'édite sur place. */}
          {list.description && <p className="ld-desc">{list.description}</p>}

          {list.tags?.length > 0 && (
              <div className="ld-tags">
                {list.tags.map((t) => (
                  <Link
                    key={t}
                    className="ld-tag clickable"
                    to={`/lists?${new URLSearchParams({
                      ...(list.official?.kind === "top" ? { sc: "tops" } : {}),
                      tag: t,
                    })}`}
                  >
                    {t}
                  </Link>
                ))}
              </div>
          )}

          <div className="ld-meta">
            <span>
              {items.length} {isGameList ? "jeu" : "élément"}
              {items.length > 1 ? (isGameList ? "x" : "s") : ""}
            </span>
            <span className="dot">·</span>
            <span>màj {timeAgo(list.updatedAt)}</span>
          </div>
        </div>

        <aside className="ld-side">
          {list.author?.username ? (
            <Link to={`/u/${list.author.username}`} className="ld-by clickable">
              <span className="ld-by-pp">
                {list.author.avatar ? (
                  <img src={list.author.avatar} alt="" draggable="false" />
                ) : (
                  list.author.username[0]?.toUpperCase()
                )}
              </span>
              <span className="ld-by-text">
                <span className="ld-by-label">par</span>
                <span className="ld-by-name">
                  {list.author.username}
                  {/* Compte officiel du site : la pastille évite qu'on prenne
                      une liste système pour celle d'un joueur homonyme. */}
                  {list.author.isSystem && (
                    <BadgeCheck size={14} className="ld-author-check" aria-label="Compte officiel" />
                  )}
                </span>
              </span>
            </Link>
          ) : null}

          <div className="ld-header-actions">
            {!list.draft && (
              <button
                className={`ld-like clickable ${list.liked ? "liked" : ""}`}
                onClick={toggleLike}
                title="J'aime"
              >
                <Heart size={17} fill={list.liked ? "currentColor" : "none"} />
                {list.likeCount}
              </button>
            )}
            {!editing && (
              <button
                className="ld-comments-btn clickable"
                onClick={() =>
                  document.getElementById("ld-comments")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                title="Commentaires"
              >
                <MessageCircle size={17} />
                {list.comments?.length || 0}
              </button>
            )}
            {!editing && items.length > 0 && (
              <button
                className="ld-icon-btn clickable"
                onClick={() => (token ? setExporting(true) : navigate("/login"))}
                title="Exporter en image"
                aria-label="Exporter en image"
              >
                <ImageDown size={17} />
              </button>
            )}
            {/* Un top officiel sert de modèle : on repart de ses jeux pour faire
                le sien. */}
            {list.official?.kind === "top" && !isOwner && items.length > 0 && (
              <button
                className="ld-template clickable"
                onClick={useAsTemplate}
                disabled={forking}
                title="Créer ton propre top à partir de celui-ci"
              >
                {forking ? <Loader2 size={16} className="spin" /> : <CopyPlus size={16} />}
                Faire mon top
              </button>
            )}
          {adminCover && !list.cover && (
            <button
              className="ld-vis clickable"
              onClick={() => coverInputRef.current?.click()}
              disabled={coverBusy}
              title="Choisir l'image de cette liste officielle (admin)"
            >
              {coverBusy ? <Loader2 size={16} className="spin" /> : <ImagePlus size={16} />}
              Image
            </button>
          )}
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
              <button
                className="ld-vis clickable"
                onClick={() => setSettingsOpen(true)}
                title="Type, description, tags, couverture, visibilité…"
              >
                <SlidersHorizontal size={16} /> Réglages
              </button>
              {!list.draft && (
                <button
                  className="ld-edit done clickable"
                  onClick={() => setEditing(false)}
                  title="Terminer l'édition"
                >
                  <Check size={16} /> Terminé
                </button>
              )}
            </>
          )}
          </div>
        </aside>
      </header>
      </>
      )}

      {/* Le fichier de couverture : partagé par l'en-tête de bureau, celui du
          téléphone et la feuille de réglages. */}
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

      {settingsOpen && editable && (
        <ListSettingsSheet
          list={list}
          coverBusy={coverBusy}
          onClose={() => setSettingsOpen(false)}
          onType={changeType}
          onPatch={patchList}
          onPickCover={() => coverInputRef.current?.click()}
          onRemoveCover={removeCover}
          onDelete={deleteList}
        />
      )}

      {/* Liste officielle d'une conférence : la rediff se regarde ici, sans
          quitter la liste des jeux annoncés. */}
      {list.event && <EventReplay event={list.event} />}

      {/* Cérémonie : le palmarès d'abord, puis tous les jeux (lauréats en
          tête, suivis des jeux montrés pendant le show). */}
      {list.awards?.length > 0 && !editable && (
        <>
          <AwardsBoard awards={list.awards} items={items} />
          <h2 className="ld-section-title">Tous les jeux de la cérémonie</h2>
        </>
      )}

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

            {/* Cartes ou liste détaillée : deux façons de lire la même liste —
                les jaquettes pour parcourir, les lignes pour se décider. */}
            {canRows && (
              <div className="ld-viewswitch" role="group" aria-label="Affichage">
                <button
                  type="button"
                  className={`ld-view-opt clickable ${view === "cards" ? "active" : ""}`}
                  onClick={() => setViewMode("cards")}
                  title="Afficher en cartes"
                >
                  <LayoutGrid size={14} /> Cartes
                </button>
                <button
                  type="button"
                  className={`ld-view-opt clickable ${view === "rows" ? "active" : ""}`}
                  onClick={() => setViewMode("rows")}
                  title="Afficher en liste détaillée"
                >
                  <Rows3 size={14} /> Liste
                </button>
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
            ) : rowsView ? (
              <ListRowsView items={items} ranked={ranked} token={token} />
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

        {/* --- « T'en veux plus ? » : sous le top d'une saga, les jeux dans
            son esprit (cf. components/lists/MoreLike). --- */}
        {!editing && list.official?.kind === "top" && list.official.group === "series" && (
          <MoreLike listId={id} token={token} />
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
      {!editing && !list.draft && (
        <div id="ld-comments" className="ld-comments-anchor">
          <ListComments listId={id} list={list} token={token} />
        </div>
      )}

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
      {exporting && (
        <ListExportModal
          list={list}
          items={items}
          tiers={tiers}
          token={token}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

// ======================================================================
//  Téléphone : l'en-tête compact
// ======================================================================
// Une ligne : le retour, le titre, et les actions en icônes. Sous elle, le
// type et le compte, puis — en lecture seulement — la description (repliée à
// deux lignes, un appui la déplie), les tags et la rangée auteur / réactions.
// En édition, il ne reste que le titre : le reste est dans la feuille de
// réglages (cf. ListSettingsSheet), pour que les jeux à classer commencent
// tout de suite.
function PhoneHeader({
  headerRef,
  list,
  meta,
  items,
  isGameList,
  isOwner,
  editable,
  adminCover,
  coverBusy,
  forking,
  onBack,
  onTitle,
  onEdit,
  onDone,
  onSettings,
  onLike,
  onExport,
  onTemplate,
  onPickCover,
  onRemoveCover,
}) {
  const [descOpen, setDescOpen] = useState(false);
  const n = items.length;
  const count = `${n} ${isGameList ? "jeu" : "élément"}${n > 1 ? (isGameList ? "x" : "s") : ""}`;
  const showCover = list.cover && !editable;

  return (
    <header ref={headerRef} className={`ld-mh ${showCover ? "has-cover" : ""}`}>
      {showCover && (
        <div className="ld-mh-cover">
          <img src={list.cover} alt="" draggable="false" />
          {adminCover && (
            <div className="ld-cover-actions">
              <button type="button" className="ld-cover-btn clickable" onClick={onPickCover} disabled={coverBusy}>
                {coverBusy ? <Loader2 size={14} className="spin" /> : <ImagePlus size={14} />}
              </button>
              <button type="button" className="ld-cover-btn danger clickable" onClick={onRemoveCover}>
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="ld-mh-row">
        <Link to="/lists" className="ld-mh-icon clickable" onClick={onBack} aria-label="Retour">
          <ArrowLeft size={19} />
        </Link>
        {editable ? (
          <input
            className="ld-mh-title-input"
            value={list.title}
            maxLength={120}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Titre de la liste"
          />
        ) : (
          <h1 className="ld-mh-title">{list.title}</h1>
        )}
        {editable ? (
          <>
            <button
              type="button"
              className="ld-mh-icon clickable"
              onClick={onSettings}
              aria-label="Réglages de la liste"
              title="Type, description, couverture…"
            >
              <SlidersHorizontal size={18} />
            </button>
            {!list.draft && (
              <button type="button" className="ld-mh-icon gold clickable" onClick={onDone} aria-label="Terminer">
                <Check size={19} strokeWidth={2.6} />
              </button>
            )}
          </>
        ) : (
          isOwner && (
            <button type="button" className="ld-mh-icon clickable" onClick={onEdit} aria-label="Modifier la liste">
              <Pencil size={17} />
            </button>
          )
        )}
      </div>

      <div className="ld-mh-meta">
        {!editable && (
          <span className={`list-type-badge t-${list.type}`}>
            <meta.Icon size={11} /> {meta.long}
          </span>
        )}
        <span>{count}</span>
        {list.visibility === "private" && (
          <span className="ld-mh-private">
            <Lock size={11} /> Privée
          </span>
        )}
        {list.draft && <span className="ld-mh-draft">Classe un élément pour l'enregistrer</span>}
      </div>

      {!editable && list.description && (
        <p
          className={`ld-mh-desc clickable ${descOpen ? "open" : ""}`}
          onClick={() => setDescOpen((v) => !v)}
        >
          {list.description}
        </p>
      )}

      {!editable && list.tags?.length > 0 && (
        <div className="ld-mh-tags">
          {list.tags.map((t) => (
            <Link
              key={t}
              className="ld-tag clickable"
              to={`/lists?${new URLSearchParams({
                ...(list.official?.kind === "top" ? { sc: "tops" } : {}),
                tag: t,
              })}`}
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {!editable && (
        <div className="ld-mh-foot">
          {list.author?.username && (
            <Link to={`/u/${list.author.username}`} className="ld-mh-by clickable">
              <span className="ld-by-pp">
                {list.author.avatar ? (
                  <img src={list.author.avatar} alt="" draggable="false" />
                ) : (
                  list.author.username[0]?.toUpperCase()
                )}
              </span>
              <span className="ld-mh-by-name">{list.author.username}</span>
              {list.author.isSystem && (
                <BadgeCheck size={13} className="ld-author-check" aria-label="Compte officiel" />
              )}
            </Link>
          )}
          <div className="ld-mh-acts">
            <button
              type="button"
              className={`ld-mh-pill clickable ${list.liked ? "liked" : ""}`}
              onClick={onLike}
              aria-label="J'aime"
            >
              <Heart size={15} fill={list.liked ? "currentColor" : "none"} />
              {list.likeCount}
            </button>
            <button
              type="button"
              className="ld-mh-pill clickable"
              onClick={() =>
                document.getElementById("ld-comments")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              aria-label="Commentaires"
            >
              <MessageCircle size={15} />
              {list.comments?.length || 0}
            </button>
            {n > 0 && (
              <button type="button" className="ld-mh-pill icon clickable" onClick={onExport} aria-label="Exporter en image">
                <ImageDown size={15} />
              </button>
            )}
            {adminCover && !list.cover && (
              <button type="button" className="ld-mh-pill icon clickable" onClick={onPickCover} aria-label="Image (admin)">
                {coverBusy ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* « Faire mon top » : le geste principal d'un top officiel, en clair. */}
      {!editable && list.official?.kind === "top" && !isOwner && n > 0 && (
        <button type="button" className="ld-mh-template clickable" onClick={onTemplate} disabled={forking}>
          {forking ? <Loader2 size={16} className="spin" /> : <CopyPlus size={16} />}
          Faire mon top
        </button>
      )}
    </header>
  );
}

// ======================================================================
//  Téléphone : les réglages de la liste, dans une feuille
// ======================================================================
// Tout ce qui ne sert qu'une fois — le type, la description, les tags, la
// couverture, la visibilité, la suppression — sort de l'en-tête et se range
// ici, derrière l'icône de réglages. Chaque changement s'enregistre aussitôt,
// comme dans l'en-tête de bureau.
function ListSettingsSheet({ list, coverBusy, onClose, onType, onPatch, onPickCover, onRemoveCover, onDelete }) {
  useScrollLock();
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ld-sheet">
        <button type="button" className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="ld-sheet-title">Réglages de la liste</h2>

        <section className="ld-sheet-sec">
          <h3>Type</h3>
          <div className="ld-typeswitch" role="group" aria-label="Type de liste">
            {GAME_LIST_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`ld-type-opt clickable ${list.type === t.value ? "active" : ""}`}
                onClick={() => onType(t.value)}
              >
                <t.Icon size={13} /> {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="ld-sheet-sec">
          <h3>Description</h3>
          <textarea
            className="ld-desc-input"
            value={list.description}
            maxLength={2000}
            rows={3}
            placeholder="Ajoute une description…"
            onChange={(e) => onPatch({ description: e.target.value })}
          />
        </section>

        <section className="ld-sheet-sec">
          <h3>Tags</h3>
          <TagEditor tags={list.tags || []} onChange={(tags) => onPatch({ tags })} />
        </section>

        {!list.draft && (
          <section className="ld-sheet-sec">
            <h3>Couverture</h3>
            <div className="ld-sheet-cover">
              {list.cover && <img src={list.cover} alt="" draggable="false" />}
              <button type="button" className="ld-vis clickable" onClick={onPickCover} disabled={coverBusy}>
                {coverBusy ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}
                {list.cover ? "Changer" : "Ajouter une image"}
              </button>
              {list.cover && (
                <button type="button" className="ld-del clickable" onClick={onRemoveCover} aria-label="Retirer la couverture">
                  <X size={15} />
                </button>
              )}
            </div>
          </section>
        )}

        <section className="ld-sheet-sec">
          <h3>Visibilité</h3>
          <div className="ld-typeswitch" role="group" aria-label="Visibilité">
            <button
              type="button"
              className={`ld-type-opt clickable ${list.visibility === "public" ? "active" : ""}`}
              onClick={() => onPatch({ visibility: "public" })}
            >
              <Globe size={13} /> Publique
            </button>
            <button
              type="button"
              className={`ld-type-opt clickable ${list.visibility === "private" ? "active" : ""}`}
              onClick={() => onPatch({ visibility: "private" })}
            >
              <Lock size={13} /> Privée
            </button>
          </div>
        </section>

        <button
          type="button"
          className="ld-sheet-del clickable"
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          <Trash2 size={16} /> {list.draft ? "Abandonner cette liste" : "Supprimer la liste"}
        </button>
      </div>
    </div>,
    document.body
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
      // Une marge de quelques pixels : l'accroche (scroll-snap) peut laisser
      // la rangée à 1 ou 2 px de son bord sans qu'il y ait rien à voir.
      left: n.scrollLeft > 8,
      right: n.scrollLeft + n.clientWidth < n.scrollWidth - 8,
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
    scrollRailBy(node, direction);
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
                <Plus size={15} /> <span className="ld-addbtn-label">Ajouter</span>
              </button>
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="tier-pool-scroll-wrap">
          {/* ⚠️ LES FLÈCHES SONT À CÔTÉ DE LA RANGÉE, PAS DESSUS. Posées sur
              les cartes, un clic un peu à côté saisissait le perso dessous.
              Toujours présentes (grisées en bout de course) : la rangée ne
              change pas de largeur, rien ne bouge sous le pointeur. */}
          <button
            type="button"
            className="tier-pool-arrow tier-pool-arrow-left"
            onClick={() => scrollByCards(-1)}
            disabled={!scrollState.left}
            aria-label="Faire défiler vers la gauche"
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            className="tier-pool-arrow tier-pool-arrow-right"
            onClick={() => scrollByCards(1)}
            disabled={!scrollState.right}
            aria-label="Faire défiler vers la droite"
          >
            <ArrowLeft size={17} />
          </button>

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
                // Empêche le blur de l'input du label (qui refermerait tier-tools
                // avant que le onClick ne se déclenche).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onUpdateTier(tier.id, { color: c })}
                aria-label="Couleur"
              />
            ))}
          </div>
          <button
            className="tier-remove clickable"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemoveTier(tier.id)}
          >
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
      data-game-id={linkable ? item.gameId : undefined}
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
