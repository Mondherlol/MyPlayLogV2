import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Heart,
  Globe,
  Lock,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  Cloud,
  CloudOff,
  Pencil,
  Check,
  X,
  ImagePlus,
  Play,
  Pause,
  Music,
  Disc3,
  Shuffle,
  Image,
  Sparkles,
} from "lucide-react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import {
  timeAgo,
  localId,
  playlistItemToTrack,
  fmtDuration,
  playlistDuration,
} from "../lib/lists";
import AddOstTracksModal from "../components/AddOstTracksModal";
import ItemEditModal from "../components/ItemEditModal";
import ListComments from "../components/ListComments";
import CoverArt from "../components/CoverArt";
import CoverEditorModal from "../components/CoverEditorModal";

// Page d'une PlayList d'OST : à gauche un gros CD qui tourne pendant la
// lecture, à droite les pistes disposées en arc autour du disque (l'arc suit
// le scroll). Même socle qu'une liste (likes, commentaires, visibilité), mais
// tout s'écoute dans le mini-lecteur global.

// Doit rester aligné avec le CSS : hauteur d'une rangée + son gap (px).
const ROW_H = 74;
// Profondeur de l'arc (px) : de combien la piste centrale s'écarte du CD.
const ARC_X = 110;
// Marge haute/basse de la scène (px), alignée sur le fondu CSS : les pistes
// commencent en dessous du fondu, donc la première (et la dernière) reste nette.
const ARC_PAD_Y = 44;

export default function PlaylistDetail({ id, initial }) {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const player = usePlayer();

  const [list, setList] = useState(initial);
  const [items, setItems] = useState(
    initial.items.map((it) => ({ ...it, key: it._id || localId("tr") }))
  );
  const [saveStatus, setSaveStatus] = useState("idle"); // idle|saving|saved
  const [adding, setAdding] = useState(false);
  const [editItem, setEditItem] = useState(null); // annotation d'une piste
  const [coverItem, setCoverItem] = useState(null); // choix de la vignette d'une piste
  const [editingCover, setEditingCover] = useState(false); // éditeur de pochette
  const [editing, setEditing] = useState(!!location.state?.edit);

  const isOwner = list?.mine;
  const editable = isOwner && editing;

  // --- Sauvegarde (debounce), même mécanique que ListDetail ---
  const saveTimer = useRef(null);
  const latest = useRef({});
  latest.current = { list, items };
  const enrichAfterSave = useRef(false);

  const scheduleSave = useCallback(() => {
    if (!latest.current.list?.mine) return;
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { list: l, items: its } = latest.current;
      try {
        await apiFetch(`/lists/${id}`, {
          method: "PUT",
          token,
          body: {
            title: l.title,
            description: l.description,
            visibility: l.visibility,
            cover: l.cover || null,
            coverDesign: l.coverDesign || null,
            items: its.map((i) => ({
              kind: "track",
              refId: i.refId,
              gameId: i.gameId,
              gameName: i.gameName,
              name: i.name,
              image: i.image,
              videoId: i.videoId,
              url: i.url,
              artist: i.artist,
              releaseYear: i.releaseYear,
              durationSec: i.durationSec,
              note: i.note,
              media: i.media,
            })),
          },
        });
        setSaveStatus("saved");
        setList((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
        if (enrichAfterSave.current) {
          enrichAfterSave.current = false;
          runEnrich();
        }
      } catch {
        setSaveStatus("idle");
      }
    }, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // --- Enrichissement (compositeur + année via iTunes, best-effort) ---
  // Fusionne uniquement artist/releaseYear par refId : ne touche pas au reste.
  const enriching = useRef(false);
  const runEnrich = useCallback(async () => {
    if (enriching.current || !latest.current.list?.mine) return;
    enriching.current = true;
    try {
      for (let pass = 0; pass < 5; pass++) {
        const d = await apiFetch(`/lists/${id}/enrich`, { method: "POST", token });
        const byRef = new Map((d.items || []).map((i) => [i.refId, i]));
        setItems((prev) =>
          prev.map((it) => {
            const e = byRef.get(it.refId);
            if (!e) return it;
            const artist = it.artist || e.artist;
            const releaseYear = it.releaseYear || e.releaseYear;
            const durationSec = it.durationSec || e.durationSec;
            return artist !== it.artist ||
              releaseYear !== it.releaseYear ||
              durationSec !== it.durationSec
              ? { ...it, artist, releaseYear, durationSec }
              : it;
          })
        );
        if (!d.remaining) break;
      }
    } catch {
      /* best-effort */
    } finally {
      enriching.current = false;
    }
  }, [id, token]);

  // Au premier affichage (propriétaire) : complète les infos manquantes.
  useEffect(() => {
    if (
      initial.mine &&
      initial.items.some((i) => !i.artist || !i.releaseYear || !i.durationSec)
    )
      runEnrich();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Lecture ---
  const playable = useMemo(
    () => items.filter((i) => i.videoId || i.url),
    [items]
  );
  // Le mini-lecteur affichera un lien de retour vers cette playlist.
  const playMeta = { source: { href: `/lists/${id}`, label: list.title } };
  // Piste de la playlist actuellement dans le mini-lecteur (ou -1).
  const activeIdx = useMemo(
    () => items.findIndex((it) => player.isCurrent(it)),
    [items, player]
  );
  const playingHere = activeIdx >= 0 && player.playing;

  // Signale l'écoute au serveur (notif + fil pour le propriétaire) — une seule
  // fois par visite de la page, best-effort.
  const listenSent = useRef(false);
  function pingListen() {
    if (listenSent.current) return;
    listenSent.current = true;
    apiFetch(`/lists/${id}/listen`, { method: "POST", token }).catch(() => {});
  }

  function playAll() {
    if (!playable.length) return;
    // Déjà en train de jouer cette playlist : simple play/pause.
    if (activeIdx >= 0) return player.toggle();
    const tracks = playable.map(playlistItemToTrack);
    player.playFromList(tracks[0], tracks, playMeta);
    pingListen();
  }

  function playShuffle() {
    if (!playable.length) return;
    const tracks = playable
      .map((it) => ({ it, r: Math.random() }))
      .sort((a, b) => a.r - b.r)
      .map(({ it }) => playlistItemToTrack(it));
    player.playFromList(tracks[0], tracks, playMeta);
    pingListen();
  }

  function playTrack(it) {
    if (player.isCurrent(it)) return player.toggle();
    player.playFromList(
      playlistItemToTrack(it),
      playable.map(playlistItemToTrack),
      playMeta
    );
    pingListen();
  }

  // --- Arc des pistes : suit le scroll du conteneur ---
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [boxH, setBoxH] = useState(0);
  const rafRef = useRef(0);

  const onTracksScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);

  useEffect(() => {
    const measure = () => setBoxH(scrollRef.current?.clientHeight || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(rafRef.current);
    };
  }, [editing, items.length]);

  // Position d'une rangée sur l'arc : les cartes ORBITENT autour du CD (qui
  // est à gauche) — à hauteur du centre du disque elles sont repoussées au
  // plus loin vers la droite (le ventre du cercle), et se replient vers le CD
  // en haut/bas de la scène, en rétrécissant.
  const arcStyle = useCallback(
    (i, current, count) => {
      if (!boxH) return undefined;
      const center = ARC_PAD_Y + i * ROW_H + ROW_H / 2 - scrollTop;
      // -1 (haut) → 0 (centre) → 1 (bas)
      const nd = Math.max(-1, Math.min(1, (center - boxH / 2) / (boxH / 2 + ROW_H / 2)));
      const a = Math.abs(nd);
      // Équation du cercle : x = R·√(1 − nd²) → ventre au centre, replié aux bords.
      const x = ARC_X * Math.sqrt(Math.max(0, 1 - a * a)) + (current ? 22 : 0);
      // La première et la dernière piste bordent la scène : on les garde
      // nettes (ni retrait ni fondu), l'effet ne s'installe qu'à partir de la 2e.
      const edge = i === 0 || i === count - 1;
      const scale = edge ? 1 : 1 - a * 0.1;
      const opacity = edge ? 1 : 1 - a * 0.5;
      return { transform: `translateX(${x}px) scale(${scale})`, opacity };
    },
    [boxH, scrollTop]
  );

  // Suit la lecture : centre la piste courante dans l'arc.
  const followRef = useRef(null);
  useEffect(() => {
    const vid = player.current?.videoId;
    if (!vid || vid === followRef.current || editing) return;
    followRef.current = vid;
    const idx = items.findIndex((it) => it.videoId === vid);
    const el = scrollRef.current;
    if (idx < 0 || !el) return;
    el.scrollTo({
      top: Math.max(0, ARC_PAD_Y + idx * ROW_H + ROW_H / 2 - el.clientHeight / 2),
      behavior: "smooth",
    });
  }, [player.current, items, editing]);

  // --- Drag & drop (édition) ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  function handleDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.key === active.id);
      const to = prev.findIndex((i) => i.key === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
    scheduleSave();
  }

  // --- Mutations ---
  const existingRefIds = useMemo(() => new Set(items.map((i) => i.refId)), [items]);

  function toggleTrackItem(raw) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.refId === raw.refId);
      if (idx >= 0) return prev.filter((_, k) => k !== idx);
      return [...prev, { ...raw, note: "", media: [], key: localId("tr") }];
    });
    enrichAfterSave.current = true;
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
  function patchList(patch) {
    setList((prev) => ({ ...prev, ...patch }));
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

  // --- Like / suppression ---
  async function toggleLike() {
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
    if (!confirm("Supprimer cette playlist ? Cette action est définitive.")) return;
    try {
      await apiFetch(`/lists/${id}`, { method: "DELETE", token });
      navigate("/lists");
    } catch (e) {
      alert(e.message);
    }
  }

  // Durée totale d'écoute (durées iTunes connues, estimation sinon).
  const totalDuration = useMemo(() => playlistDuration(items), [items]);

  // Pochette du CD : l'OST en cours (si lecture) ou l'image choisie par
  // l'auteur ; à défaut d'image, on affiche la pochette générée/personnalisée.
  const discImg = (activeIdx >= 0 && items[activeIdx]?.image) || list.cover || null;

  const isPublic = list.visibility === "public";

  return (
    <div className="pld-page">
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

      <div className="pld-main">
        {/* ---------- Colonne gauche : le CD ---------- */}
        <aside className="pld-left">
          {/* Nom + description, toujours AU-DESSUS du CD */}
          <div className="pld-edit-head">
            {editable ? (
              <>
                <input
                  className="ld-title-input pld-title-input"
                  value={list.title}
                  maxLength={120}
                  onChange={(e) => patchList({ title: e.target.value })}
                  placeholder="Titre de la playlist"
                />
                <textarea
                  className="ld-desc-input"
                  value={list.description}
                  maxLength={2000}
                  rows={2}
                  placeholder="Ajoute une description…"
                  onChange={(e) => patchList({ description: e.target.value })}
                />
              </>
            ) : (
              <>
                <h1 className="pld-title">{list.title}</h1>
                {list.description && <p className="pld-desc">{list.description}</p>}
                <div className="ld-meta pld-meta">
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
                  <span>{items.length} piste{items.length > 1 ? "s" : ""}</span>
                  {totalDuration.durationSec > 0 && (
                    <>
                      <span className="dot">·</span>
                      <span>
                        {totalDuration.durationEstimated ? "≈ " : ""}
                        {fmtDuration(totalDuration.durationSec)}
                      </span>
                    </>
                  )}
                  <span className="dot">·</span>
                  <span>màj {timeAgo(list.updatedAt)}</span>
                </div>
              </>
            )}
          </div>

          <div className="pld-disc-zone">
            <div className={`pld-disc ${playingHere ? "spinning" : ""}`}>
              <div className="pld-disc-face">
                {discImg ? (
                  <img src={discImg} alt="" draggable="false" />
                ) : (
                  <CoverArt design={list.coverDesign} title={list.title} className="pld-disc-cover" />
                )}
                <span className="pld-disc-grooves" />
                <span className="pld-disc-hole" />
              </div>
              <span className="pld-disc-sheen" />
            </div>

            <button
              className="pld-bigplay clickable"
              onClick={playAll}
              disabled={!playable.length}
              title={playingHere ? "Pause" : "Écouter la playlist"}
              aria-label={playingHere ? "Pause" : "Écouter la playlist"}
            >
              {playingHere ? (
                <Pause size={26} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={26} fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </div>

          {/* Piste en cours sous le CD */}
          {activeIdx >= 0 && (
            <div className="pld-nowplaying">
              <span className="pld-eq" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span className="pld-nowplaying-name" title={items[activeIdx].name}>
                {items[activeIdx].name}
              </span>
            </div>
          )}

          {editable ? (
            /* ----- Actions du mode édition (pas de social ici) ----- */
            <div className="pld-actions">
              <button
                className="ld-vis clickable"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverBusy}
                title="Changer la pochette de la playlist"
              >
                {coverBusy ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <ImagePlus size={16} />
                )}
                Photo
              </button>
              <button
                className="ld-vis clickable"
                onClick={() => setEditingCover(true)}
                title="Personnaliser la pochette générée"
              >
                <Sparkles size={16} /> Personnaliser
              </button>
              {list.cover && (
                <button
                  className="ld-vis clickable"
                  onClick={() => patchList({ cover: null })}
                  title="Retirer la pochette"
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="button"
                className={`vis-switch clickable ${isPublic ? "on" : ""}`}
                onClick={() =>
                  patchList({ visibility: isPublic ? "private" : "public" })
                }
                title={
                  isPublic
                    ? "Playlist publique — visible par tous"
                    : "Playlist privée — visible par toi seul·e"
                }
              >
                {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                Publique
                <span className="vis-switch-track" aria-hidden="true">
                  <span className="vis-switch-knob" />
                </span>
              </button>
              <button className="ld-del clickable" onClick={deleteList} title="Supprimer">
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
            /* ----- Actions du mode lecture ----- */
            <div className="pld-info">
              <div className="pld-actions">
                <button
                  className={`ld-like clickable ${list.liked ? "liked" : ""}`}
                  onClick={toggleLike}
                  title="J'aime"
                >
                  <Heart size={18} fill={list.liked ? "currentColor" : "none"} />
                  {list.likeCount}
                </button>
                <button
                  className="ld-vis clickable"
                  onClick={playShuffle}
                  disabled={!playable.length}
                  title="Lecture aléatoire"
                >
                  <Shuffle size={16} /> Aléatoire
                </button>
                {isOwner && (
                  <>
                    <button
                      className="ld-edit clickable"
                      onClick={() => setEditing(true)}
                      title="Modifier la playlist"
                    >
                      <Pencil size={16} /> Modifier
                    </button>
                    <button
                      className="ld-del clickable"
                      onClick={deleteList}
                      title="Supprimer la playlist"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

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
        </aside>

        {/* ---------- Colonne droite : les pistes ---------- */}
        <section className="pld-right">
          {editable && (
            <div className="pld-toolbar">
              <button className="ld-addbtn clickable" onClick={() => setAdding(true)}>
                <Plus size={17} /> Ajouter des OST
              </button>
              <span className="ld-hint font-fun">
                Glisse les pistes pour changer l'ordre d'écoute
              </span>
            </div>
          )}

          {items.length === 0 ? (
            <div className="ld-empty card">
              <Disc3 size={30} />
              <p className="font-fun">Cette playlist est vide pour l'instant.</p>
              {editable && (
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  <Plus size={18} /> Ajouter des OST
                </button>
              )}
            </div>
          ) : editable ? (
            // Édition : liste droite triable (drag depuis n'importe où sur la carte).
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((i) => i.key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="pld-tracks editing">
                  {items.map((it, i) => (
                    <SortableTrackRow
                      key={it.key}
                      item={it}
                      index={i}
                      current={activeIdx === i}
                      playing={activeIdx === i && player.playing}
                      onEdit={() => setEditItem(it)}
                      onCover={() => setCoverItem(it)}
                      onRemove={() => removeItem(it.key)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            // Lecture : l'arc autour du CD.
            <div
              className={`pld-tracks arc ${items.length > 6 ? "deep" : ""}`}
              ref={scrollRef}
              onScroll={onTracksScroll}
            >
              {items.map((it, i) => {
                const current = activeIdx === i;
                const isPlaying = current && player.playing;
                return (
                  <div
                    className={`pld-row clickable ${current ? "current" : ""}`}
                    key={it.key}
                    style={arcStyle(i, current, items.length)}
                    onClick={() => playTrack(it)}
                    title={it.name}
                  >
                    <span className="pld-row-num">
                      {isPlaying ? (
                        <span className="pld-eq" aria-hidden="true">
                          <i /><i /><i />
                        </span>
                      ) : (
                        String(i + 1).padStart(2, "0")
                      )}
                    </span>
                    <span className="pld-row-art">
                      {it.image ? (
                        <img src={it.image} alt="" loading="lazy" draggable="false" />
                      ) : (
                        <Music size={16} />
                      )}
                      <span className="pld-row-play">
                        {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                      </span>
                    </span>
                    <span className="pld-row-txt">
                      <span className="pld-row-name">{it.name}</span>
                      <span className="pld-row-sub">
                        {it.artist && <span className="pld-row-artist">{it.artist}</span>}
                        {it.artist && it.gameName && <span className="dot">·</span>}
                        {it.gameName && (
                          <Link
                            to={`/game/${it.gameId}`}
                            className="pld-row-game"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {it.gameName}
                          </Link>
                        )}
                      </span>
                      {it.note && <span className="pld-row-note">“{it.note}”</span>}
                    </span>
                    {it.releaseYear && (
                      <span className="pld-row-year">{it.releaseYear}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* --- Commentaires (masqués en mode édition) --- */}
      {!editing && <ListComments listId={id} list={list} token={token} />}

      {/* --- Terminer l'édition : bouton flottant --- */}
      {editable && (
        <button
          className="pld-done btn btn-primary clickable"
          onClick={() => setEditing(false)}
          title="Terminer l'édition"
        >
          <Check size={18} /> Terminé
        </button>
      )}

      {adding && (
        <AddOstTracksModal
          existing={existingRefIds}
          onToggle={toggleTrackItem}
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
      {editingCover && (
        <CoverEditorModal
          list={list}
          items={items}
          avatar={user?.avatar}
          token={token}
          onSave={(design) => {
            patchList({ coverDesign: design, cover: null });
            setEditingCover(false);
          }}
          onClose={() => setEditingCover(false)}
        />
      )}
      {coverItem && (
        <TrackCoverModal
          item={coverItem}
          token={token}
          onPick={(url) => {
            updateItem(coverItem.key, { image: url });
            setCoverItem(null);
          }}
          onClose={() => setCoverItem(null)}
        />
      )}
    </div>
  );
}

// --- Rangée triable (mode édition) : la carte entière se drague (la poignée
// à gauche n'est qu'un indice visuel) ---
function SortableTrackRow({ item, index, current, playing, onEdit, onCover, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.key });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`pld-row edit grab ${isDragging ? "dragging" : ""} ${current ? "current" : ""}`}
      {...attributes}
      {...listeners}
    >
      <span className="pld-row-grip" aria-hidden="true">
        <GripVertical size={15} />
      </span>
      <span className="pld-row-num">
        {current ? (
          <span className={`pld-eq ${playing ? "" : "paused"}`} aria-hidden="true">
            <i /><i /><i />
          </span>
        ) : (
          String(index + 1).padStart(2, "0")
        )}
      </span>
      <span className="pld-row-art">
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" draggable="false" />
        ) : (
          <Music size={16} />
        )}
      </span>
      <span className="pld-row-txt">
        <span className="pld-row-name">{item.name}</span>
        <span className="pld-row-sub">
          {item.artist && <span className="pld-row-artist">{item.artist}</span>}
          {item.artist && item.gameName && <span className="dot">·</span>}
          {item.gameName && <span className="pld-row-game">{item.gameName}</span>}
        </span>
        {item.note && <span className="pld-row-note">“{item.note}”</span>}
      </span>
      {item.releaseYear && <span className="pld-row-year">{item.releaseYear}</span>}
      <span className="pld-row-tools">
        <button
          className="ic-btn clickable"
          title="Choisir la vignette"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onCover}
        >
          <Image size={13} />
        </button>
        <button
          className="ic-btn clickable"
          title="Annotation"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          className="ic-btn danger clickable"
          title="Retirer"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          <X size={13} />
        </button>
      </span>
    </div>
  );
}

// --- Choix de la vignette d'une piste : artwork de l'OST ou visuels du jeu ---
function TrackCoverModal({ item, token, onPick, onClose }) {
  const [covers, setCovers] = useState([]);
  const [loading, setLoading] = useState(!!item.gameId);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!item.gameId) return;
    let alive = true;
    apiFetch(`/games/${item.gameId}/details`, { token })
      .then((d) => alive && setCovers(d.covers || []))
      .catch(() => alive && setCovers([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [item.gameId, token]);

  // L'artwork « d'origine » de l'OST se retrouve depuis la vidéo YouTube.
  const ostArt = item.videoId
    ? `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`
    : null;
  const options = [
    ...(ostArt ? [{ id: "__ost__", url: ostArt, ost: true }] : []),
    ...covers,
  ];

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal pld-cover-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <h2 className="modal-title">
          <Image size={20} /> Vignette de la piste
        </h2>
        <p className="pld-cover-sub">{item.name}</p>

        {loading ? (
          <div className="additems-loading">
            <Loader2 size={18} className="spin" /> Chargement des visuels…
          </div>
        ) : (
          <div className="pld-cover-grid">
            {options.map((c) => (
              <button
                key={c.id}
                className={`pld-cover-opt clickable ${c.url === item.image ? "active" : ""}`}
                onClick={() => onPick(c.url)}
                title={c.ost ? "Artwork de l'OST" : "Visuel du jeu"}
              >
                <img src={c.url} alt="" loading="lazy" draggable="false" />
                {c.ost && (
                  <span className="pld-cover-tag">
                    <Music size={11} /> OST
                  </span>
                )}
                {c.url === item.image && (
                  <span className="pld-cover-check">
                    <Check size={14} />
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && (
              <p className="additems-hint font-fun">Aucun visuel disponible.</p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
