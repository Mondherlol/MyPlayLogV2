import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Heart,
  Plus,
  Trash2,
  Upload,
  ArrowLeft,
  Loader2,
  Clock,
  ImagePlus,
  ThumbsUp,
  ThumbsDown,
  Play,
  Pause,
  Trophy,
  Cloud,
  Disc,
  ListPlus,
  PenLine,
  EyeOff,
  AlertTriangle,
  Infinity as InfinityIcon,
  Gamepad2,
  CalendarDays,
  CalendarCheck,
  Sparkles,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useBackClose } from "../hooks/useBackClose";
import ScrollRow from "./ScrollRow";
import AddToListModal from "./AddToListModal";
import CharacterPicker from "./CharacterPicker";
import OstPicker from "./OstPicker";
import RatingGauge from "./RatingGauge";
import { Composer } from "./ListComments";

const STATUSES = [
  { value: "playing", label: "En cours", Icon: Play },
  { value: "finished", label: "Terminé", Icon: Trophy },
  { value: "paused", label: "En pause", Icon: Pause },
  { value: "dropped", label: "Abandonné", Icon: X },
];

// Statut spécial des jeux sans fin (multi/service : Rocket League, Overwatch…).
// Proposé automatiquement quand IGDB signale du multi/MMO/battle royale, et
// activable à la main sur n'importe quel jeu via le lien sous les statuts.
const ENDLESS = { value: "endless", label: "Sans fin", Icon: InfinityIcon };

const LETSPLAY = "Vu en let's play";
const PLAYED = ["playing", "finished", "paused", "dropped", "endless"];

// Plateformes 100 % dématérialisées : pas de choix digital/physique pour
// elles (PC, mobile, cloud…). Pour les consoles, on propose le format.
const DIGITAL_ONLY = /windows|\bpc\b|android|ios|linux|\bmac\b|browser|stadia|luna/i;

// Infos statiques du jeu (plateformes, jaquettes, persos, temps de jeu) : elles
// ne changent pas d'une ouverture à l'autre → cache mémoire + localStorage 24h,
// pour afficher la modale instantanément la 2e fois. (v3 : + bundleGames)
const detailsCache = makeCache("mpl_gamedetails3_", 24 * 60 * 60 * 1000);

const EMPTY_DETAILS = {
  platforms: [],
  covers: [],
  characters: [],
  timeToBeat: null,
  endlessHint: false,
  bundleGames: [],
};

// ⚠️ LA DATE SE COUPE, ELLE NE SE CONVERTIT PAS. Un `<input type="date">` parle
// en « AAAA-MM-JJ » sans fuseau, alors que le serveur renvoie un instant ISO en
// UTC. Passer par `new Date()` pour l'afficher ferait reculer d'un jour toute
// date enregistrée en soirée depuis la France — on lit donc les dix premiers
// caractères, et on renvoie midi UTC pour que l'aller-retour soit stable quel
// que soit le fuseau du navigateur.
const toDateInput = (iso) => (iso ? String(iso).slice(0, 10) : "");
const fromDateInput = (v) => (v ? new Date(`${v}T12:00:00.000Z`).toISOString() : null);

// Forme canonique des champs éditables, comparée par valeur (JSON) pour savoir
// si l'utilisateur a des modifications non enregistrées. On plie `hasRating`
// dans `rating` (null = pas de note) et on stringifie le temps de jeu pour que
// "" et 0 ne soient pas confondus à tort.
function normalizeState(s) {
  return {
    status: s.status || "",
    platform: s.platform || "",
    format: s.format || "digital",
    playtime: String(s.playtime ?? ""),
    favorite: !!s.favorite,
    rating: s.hasRating ? Number(s.rating) : null,
    review: (s.review || "").trim(),
    reviewMedia: s.reviewMedia || [],
    spoiler: !!s.spoiler,
    pros: s.pros || [],
    cons: s.cons || [],
    favChar: s.favChar || null,
    favoriteOst: s.favoriteOst || null,
    cover: s.cover || null,
    platinum: !!s.platinum,
    startedAt: toDateInput(s.startedAt),
    finishedAt: toDateInput(s.finishedAt),
    // Progression bundle : "id:statut" triés (forme canonique, indépendante
    // de l'ordre des clics).
    bundle: Object.entries(s.bundleStatus || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}:${v}`)
      .sort(),
  };
}

// Statut global du bundle déduit de ses jeux : tout terminé → « Terminé »,
// sinon « En cours » dès qu'un jeu est lancé ou fini, sinon pause/abandon.
function deriveBundleStatus(list) {
  const set = list.filter(Boolean);
  if (!set.length) return null;
  if (set.length === list.length && set.every((s) => s === "finished"))
    return "finished";
  if (set.some((s) => s === "playing" || s === "finished")) return "playing";
  if (set.some((s) => s === "paused")) return "paused";
  return "dropped";
}

// `onSaved` (optionnel) : appelé après un enregistrement réussi uniquement
// (pas à l'annulation) — ex. le deck de pépites passe au jeu suivant.
export default function PlayedModal({ game, onClose, onSaved, openReview = false }) {
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal, refresh } = useLibrary();

  const [saving, setSaving] = useState(false);
  // Infos statiques (plateformes, temps de jeu…) : préremplies depuis le cache
  // si on a déjà ouvert ce jeu → aucun chargement à afficher la 2e fois.
  const cachedDetails = detailsCache.get(String(game.id))?.data;
  const [details, setDetails] = useState(() => cachedDetails || EMPTY_DETAILS);
  // Deux chargements distincts : les infos du jeu (skeleton seulement au 1er
  // affichage, sinon cache) et l'entrée perso de l'utilisateur (préremplissage
  // du statut/note/review — bloque juste l'enregistrement le temps de charger).
  const [detailsLoading, setDetailsLoading] = useState(!cachedDetails);
  const [entryLoading, setEntryLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [favChar, setFavChar] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Instantané de TOUS les champs éditables au chargement, pour détecter une
  // modification non enregistrée et prévenir avant de fermer la modale.
  const initialSnapshot = useRef(null);

  // Statut/favori initialisés depuis la map locale de la bibliothèque : le bon
  // bouton est coché dès l'ouverture. Pour un jeu pas encore dans la
  // bibliothèque on ne présélectionne AUCUN statut — c'est à l'utilisateur de
  // choisir son avancement (pas de « Terminé » imposé par défaut).
  const [status, setStatus] = useState(() => {
    const s = map[game.id]?.status;
    return PLAYED.includes(s) ? s : "";
  });
  const [platform, setPlatform] = useState("");
  const [format, setFormat] = useState("digital"); // digital | physical
  const [playtime, setPlaytime] = useState("");
  const [favorite, setFavorite] = useState(() => !!map[game.id]?.favorite);
  const [hasRating, setHasRating] = useState(false);
  const [rating, setRating] = useState(50);
  const [review, setReview] = useState("");
  const [reviewMedia, setReviewMedia] = useState([]);
  const [spoiler, setSpoiler] = useState(false);
  const [pros, setPros] = useState([]);
  const [cons, setCons] = useState([]);
  const [favoriteOst, setFavoriteOst] = useState(null);
  // Terminé À 100 % : le statut « terminé » dit qu'on a vu la fin, pas qu'on a
  // tout fait. Beaucoup de joueurs distinguent les deux (même champ que la
  // feuille mobile, cf. QuickAddSheet).
  const [platinum, setPlatinum] = useState(false);
  // Quand je m'y suis mis, et quand je l'ai fini — deux dates saisies à la
  // main : le serveur ne les devine pas, un jeu ajouté aujourd'hui a très bien
  // pu être terminé il y a dix ans.
  const [startedAt, setStartedAt] = useState("");
  const [finishedAt, setFinishedAt] = useState("");
  const [showListModal, setShowListModal] = useState(false);
  const [cover, setCover] = useState(game.cover);
  const [existing, setExisting] = useState(false);
  const [manualEndless, setManualEndless] = useState(false);
  // Bundle : id IGDB du jeu inclus -> son statut (playing/finished/paused/
  // dropped) ou absent. Permet de finir un jeu du bundle sans finir les autres ;
  // chaque statut se reporte sur la fiche du jeu inclus à l'enregistrement.
  const [bundleStatus, setBundleStatus] = useState({});

  useEffect(() => {
    let alive = true;
    let pollTimer;
    // Le temps de jeu HLTB est scrapé en arrière-plan côté serveur : la 1re
    // réponse peut arriver sans valeurs (`timeToBeatPending`). On re-poll alors
    // l'endpoint jusqu'à récupérer les temps, pour les afficher sans avoir à
    // rouvrir la modale.
    async function pollTimeToBeat(attempt = 0) {
      if (attempt >= 8) return;
      await new Promise((r) => (pollTimer = setTimeout(r, 2500)));
      if (!alive) return;
      const d = await apiFetch(`/games/${game.id}/details`, { token }).catch(() => null);
      if (!alive || !d) return;
      setDetails((prev) => ({ ...prev, timeToBeat: d.timeToBeat }));
      if (d.timeToBeatPending) pollTimeToBeat(attempt + 1);
      else detailsCache.set(String(game.id), d);
    }
    Promise.all([
      apiFetch(`/games/${game.id}/details`, { token }).catch(() => EMPTY_DETAILS),
      apiFetch(`/library/${game.id}`, { token }).catch(() => ({ entry: null })),
    ]).then(([d, e]) => {
      if (!alive) return;
      setDetails(d);
      setDetailsLoading(false);
      // On ne met en cache que des détails « stables » : si un scrape HLTB est
      // en cours, on attend qu'il finisse (via le poll) pour ne pas figer un
      // temps de jeu vide pendant 24h.
      if (d.timeToBeatPending) pollTimeToBeat();
      else detailsCache.set(String(game.id), d);
      if (e.entry) {
        const en = e.entry;
        setExisting(true);
        setStatus(PLAYED.includes(en.status) ? en.status : "");
        setPlatform(en.platform || "");
        setFormat(en.format || "digital");
        setPlaytime(en.playtimeHours ?? "");
        setFavorite(!!en.favorite);
        if (en.rating != null) {
          setHasRating(true);
          setRating(en.rating);
        }
        setReview(en.review || "");
        setReviewMedia(en.reviewMedia || []);
        setSpoiler(!!en.spoiler);
        setPros(en.pros || []);
        setCons(en.cons || []);
        setFavChar(en.favoriteCharacter || null);
        setFavoriteOst(en.favoriteOst || null);
        setPlatinum(!!en.platinum);
        setStartedAt(toDateInput(en.startedAt));
        setFinishedAt(toDateInput(en.finishedAt));
        if (en.cover) setCover(en.cover);
        const bd = {};
        for (const g of en.bundleGames || []) {
          const st = g.status || (g.done ? "finished" : null); // rétrocompat V1
          if (st) bd[g.id] = st;
        }
        setBundleStatus(bd);
        initialSnapshot.current = normalizeState({
          status: PLAYED.includes(en.status) ? en.status : "",
          platform: en.platform || "",
          format: en.format || "digital",
          playtime: en.playtimeHours ?? "",
          favorite: !!en.favorite,
          hasRating: en.rating != null,
          rating: en.rating != null ? en.rating : 50,
          review: en.review || "",
          reviewMedia: en.reviewMedia || [],
          spoiler: !!en.spoiler,
          pros: en.pros || [],
          cons: en.cons || [],
          favChar: en.favoriteCharacter || null,
          favoriteOst: en.favoriteOst || null,
          platinum: !!en.platinum,
          startedAt: en.startedAt,
          finishedAt: en.finishedAt,
          cover: en.cover || game.cover,
          bundleStatus: bd,
        });
      } else {
        // Jeu pas encore dans la bibliothèque : l'état de référence est vierge.
        initialSnapshot.current = normalizeState({
          status: "",
          platform: "",
          format: "digital",
          playtime: "",
          favorite: false,
          hasRating: false,
          rating: 50,
          review: "",
          reviewMedia: [],
          spoiler: false,
          pros: [],
          cons: [],
          favChar: null,
          favoriteOst: null,
          platinum: false,
          startedAt: null,
          finishedAt: null,
          cover: game.cover,
          bundleStatus: {},
        });
      }
      setEntryLoading(false);
      // Ouverture directe sur l'éditeur de review (depuis « Modifier ma review »).
      if (openReview) setShowReview(true);
    });
    return () => {
      alive = false;
      clearTimeout(pollTimer);
    };
  }, [game.id, token, openReview]);

  // Échap et le bouton « retour » du téléphone font la même chose : refermer la
  // couche du dessus (confirmation, review, puis la modale elle-même). Sans ça,
  // « retour » quittait la page en laissant la saisie en cours.
  const closeTopLayer = () => {
    if (confirmClose) setConfirmClose(false);
    else if (showReview) setShowReview(false);
    else attemptClose();
  };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && closeTopLayer();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, showReview, confirmClose]); // eslint-disable-line react-hooks/exhaustive-deps

  useBackClose(closeTopLayer, "playedModal");

  // Reflet « live » de tous les champs éditables, pour un contrôle fiable du non
  // enregistré même depuis un handler capturé par un effet (touche Échap).
  const live = useRef(null);
  live.current = {
    status, platform, format, playtime, favorite, hasRating, rating,
    review, reviewMedia, spoiler, pros, cons, favChar, favoriteOst, cover,
    platinum, startedAt, finishedAt,
    bundleStatus,
  };

  // Choix du statut GLOBAL. Marquer un bundle « Terminé » passe évidemment
  // tous ses jeux inclus en terminé.
  function pickStatus(v) {
    setStatus(v);
    if (v === "finished" && details.bundleGames?.length) {
      const next = { ...bundleStatus };
      for (const b of details.bundleGames) next[b.id] = "finished";
      setBundleStatus(next);
    }
  }

  // Statut d'un jeu du bundle (re-cliquer la même icône = retirer). Le statut
  // global du bundle se déduit ensuite de celui de ses jeux.
  function setChildStatus(id, v) {
    const next = { ...bundleStatus, [id]: v };
    if (!v) delete next[id];
    setBundleStatus(next);
    const derived = deriveBundleStatus(
      details.bundleGames.map((b) => next[b.id] || null)
    );
    if (derived) setStatus(derived);
  }

  // Une modif est « non enregistrée » si l'état courant diffère de l'instantané
  // pris au chargement (ou de l'état vierge pour un jeu pas encore ajouté).
  function isDirty() {
    if (!initialSnapshot.current) return false;
    return (
      JSON.stringify(normalizeState(live.current)) !==
      JSON.stringify(initialSnapshot.current)
    );
  }

  // Fermeture de la modale : si des changements ne sont pas enregistrés, on
  // affiche un avertissement (le clic « Enregistrer » appelle onClose direct).
  function attemptClose() {
    if (isDirty()) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }

  async function save() {
    if (!status) return; // avancement obligatoire (bouton déjà désactivé)
    setSaving(true);
    try {
      const body = {
        name: game.name,
        cover,
        status,
        platform: platform || null,
        // Le format n'a de sens que sur console : on retombe sur digital sinon.
        format: showFormat ? format : "digital",
        playtimeHours: playtime === "" ? null : Number(playtime),
        favorite,
        rating: hasRating ? Number(rating) : null,
        review: review.trim(),
        reviewMedia,
        spoiler,
        pros,
        cons,
        favoriteCharacter: favChar,
        favoriteOst,
        // Le 100 % n'a de sens que sur un jeu mené au bout : on l'envoie à
        // faux ailleurs, plutôt que de laisser traîner un platine sur un jeu
        // repassé « en cours ».
        platinum: canComplete ? platinum : false,
        startedAt: fromDateInput(startedAt),
        // ⚠️ ON N'EFFACE PAS LA DATE DE FIN quand le statut n'est plus
        // « terminé » : repasser en cours pour un new game + ne doit pas faire
        // oublier la date de la première fin (même règle que sur mobile).
        ...(status === "finished" ? { finishedAt: fromDateInput(finishedAt) } : {}),
      };
      // Bundle : on n'envoie la progression que si on connaît les jeux inclus
      // (détails chargés) — sinon on ne touche pas à l'existant côté serveur.
      if (details.bundleGames?.length) {
        body.bundleGames = details.bundleGames.map((b) => ({
          id: b.id,
          name: b.name,
          cover: b.cover || null,
          status: bundleStatus[b.id] || null,
        }));
      }
      const data = await apiFetch(`/library/${game.id}`, { method: "PUT", token, body });
      upsertLocal(game.id, { status: data.entry.status, favorite: data.entry.favorite });
      // Les jeux du bundle ont maintenant leur propre entrée côté serveur :
      // reflet immédiat dans la carte locale, puis resynchro complète (elle
      // seule connaît les entrées supprimées par un statut décoché).
      if (details.bundleGames?.length) {
        for (const b of details.bundleGames) {
          if (bundleStatus[b.id]) upsertLocal(b.id, { status: bundleStatus[b.id] });
        }
        refresh?.();
      }
      onSaved?.();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Retirer complètement ce jeu de ton profil ?")) return;
    setSaving(true);
    try {
      await apiFetch(`/library/${game.id}`, { method: "DELETE", token });
      removeLocal(game.id);
      // Bundle : le serveur retire aussi les entrées héritées restées vierges.
      if (details.bundleGames?.length) refresh?.();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("cover", file);
      const data = await apiUpload(`/games/${game.id}/cover`, fd, token);
      setDetails((d) => ({ ...d, covers: [data.cover, ...d.covers] }));
      setCover(data.cover.url);
      setPicking(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }

  const ttb = details.timeToBeat || {};
  // On affiche toujours les 3 cards ; "—" si la valeur manque.
  const ttbChips = [
    { label: "Rapide", v: ttb.hastily },
    { label: "Normal", v: ttb.normally },
    { label: "100%", v: ttb.completely },
  ];

  const platformOptions = [...details.platforms.map((p) => p.name), LETSPLAY];
  // Choix digital/physique : uniquement pour une console « physique-capable »
  // (ni PC/mobile/cloud, ni let's play).
  const showFormat =
    !!platform && platform !== LETSPLAY && !DIGITAL_ONLY.test(platform);
  const hasReview = review.trim() || reviewMedia.length || pros.length || cons.length;
  // « Sans fin » visible si le jeu est multi/service (IGDB), déjà dans ce
  // statut, ou activé à la main via le lien sous les statuts.
  const showEndless = details.endlessHint || status === "endless" || manualEndless;
  // Le 100 % se pose à un jeu terminé — et à un jeu sans fin, qui n'a pas de
  // générique mais bien une liste de succès à vider.
  const canComplete = status === "finished" || status === "endless";
  const statusOptions = showEndless ? [...STATUSES, ENDLESS] : STATUSES;

  return createPortal(
    <>
      <div className="modal-overlay" onMouseDown={attemptClose} onClick={(e) => e.stopPropagation()}>
        <div className="modal played-modal" onMouseDown={(e) => e.stopPropagation()}>
          <button className="modal-close clickable" onClick={attemptClose} aria-label="Fermer">
            <X size={20} />
          </button>

          {picking ? (
            <div className="cover-picker">
              <button className="picker-back clickable" onClick={() => setPicking(false)}>
                <ArrowLeft size={16} /> Retour
              </button>
              <h3 className="picker-title">Choisir une jaquette</h3>
              <div className="picker-grid">
                <button
                  className="picker-upload clickable"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 size={22} className="spin" />
                  ) : (
                    <>
                      <Upload size={22} />
                      <span>Uploader</span>
                    </>
                  )}
                </button>
                {details.covers.map((c) => (
                  <button
                    key={c.id}
                    className={`picker-item clickable ${cover === c.url ? "active" : ""}`}
                    onClick={() => {
                      setCover(c.url);
                      setPicking(false);
                    }}
                  >
                    <img src={c.url} alt="" loading="lazy" />
                    {c.custom && <span className="picker-badge">custom</span>}
                    {cover === c.url && (
                      <span className="picker-check">
                        <Check size={16} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
            </div>
          ) : (
            <>
              <div className="modal-body">
                {/* Colonne gauche */}
                <div className="modal-cover-col">
                  <button
                    className="modal-cover clickable"
                    onClick={() => setPicking(true)}
                    title="Changer la jaquette"
                  >
                    {cover ? <img src={cover} alt={game.name} /> : <ImagePlus size={30} />}
                    <span className="modal-cover-edit">
                      <ImagePlus size={16} /> Modifier
                    </span>
                  </button>

                  <button
                    className={`fav-btn clickable ${favorite ? "active" : ""}`}
                    onClick={() => setFavorite((v) => !v)}
                  >
                    <Heart size={18} fill={favorite ? "currentColor" : "none"} />
                    Coup de cœur
                  </button>

                  <button
                    className="list-btn clickable"
                    onClick={() => setShowListModal(true)}
                    title="Ajouter à une liste"
                  >
                    <ListPlus size={17} /> Ajouter à une liste
                  </button>

                  <div className="rating-block">
                    <span className="rating-block-label">Ma note</span>
                    <RatingGauge
                      value={rating}
                      active={hasRating}
                      onEnable={() => {
                        setRating(50); // pastille au milieu au départ
                        setHasRating(true);
                      }}
                      onChange={setRating}
                      onClear={() => setHasRating(false)}
                    />
                  </div>

                  <button
                    className={`review-btn clickable ${hasReview ? "filled" : ""}`}
                    onClick={() => setShowReview(true)}
                  >
                    <PenLine size={16} /> {hasReview ? "Ma review" : "Écrire une review"}
                  </button>

                  {existing && (
                    <button className="btn-remove clickable" onClick={remove} disabled={saving}>
                      <Trash2 size={16} /> Retirer ce jeu
                    </button>
                  )}
                </div>

                {/* Colonne droite */}
                <div className="modal-form">
                  <h2 className="modal-title">{game.name}</h2>

                  <label className="field-label">
                    Avancement <span className="field-req">*</span>
                  </label>
                  <div className={`seg ${!status ? "unset" : ""}`}>
                    {statusOptions.map((s) => (
                      <button
                        key={s.value}
                        className={`seg-opt ${s.value === "endless" ? "endless" : ""} ${
                          status === s.value ? "active" : ""
                        }`}
                        onClick={() => pickStatus(s.value)}
                      >
                        <s.Icon size={16} />
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {!showEndless && !detailsLoading && (
                    <button
                      className="endless-link clickable"
                      onClick={() => {
                        setManualEndless(true);
                        setStatus("endless");
                      }}
                    >
                      <InfinityIcon size={13} /> Ce jeu n'a pas de fin ?
                    </button>
                  )}

                  {/* Bundle : un statut PAR jeu inclus (icônes en cours /
                      terminé / en pause / abandonné) — on peut finir un jeu du
                      bundle sans finir les autres. Statut + plateforme se
                      reportent sur la fiche de chaque jeu à l'enregistrement. */}
                  {details.bundleGames?.length > 0 && (
                    <div className="bundle-block">
                      <label className="field-label">
                        Jeux du bundle
                        <span className="bundle-count">
                          {
                            details.bundleGames.filter(
                              (b) => bundleStatus[b.id] === "finished"
                            ).length
                          }
                          /{details.bundleGames.length} terminés
                        </span>
                      </label>
                      <div className="bundle-list">
                        {details.bundleGames.map((b) => {
                          const cur = bundleStatus[b.id] || null;
                          return (
                            <div
                              key={b.id}
                              className={`bundle-item ${cur ? `st-${cur}` : ""}`}
                            >
                              <span className="bundle-cover">
                                {b.cover ? (
                                  <img src={b.cover} alt="" loading="lazy" draggable="false" />
                                ) : (
                                  <Gamepad2 size={15} />
                                )}
                              </span>
                              <span className="bundle-name" title={b.name}>
                                {b.name}
                              </span>
                              <span className="bundle-seg">
                                {STATUSES.map((s) => (
                                  <button
                                    key={s.value}
                                    type="button"
                                    className={`bundle-st clickable st-${s.value} ${
                                      cur === s.value ? "active" : ""
                                    }`}
                                    onClick={() =>
                                      setChildStatus(
                                        b.id,
                                        cur === s.value ? null : s.value
                                      )
                                    }
                                    title={
                                      cur === s.value
                                        ? `Retirer « ${s.label} »`
                                        : s.label
                                    }
                                  >
                                    <s.Icon size={13} />
                                  </button>
                                ))}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="bundle-hint">
                        Le statut et la plateforme se reportent sur la fiche de
                        chaque jeu du bundle.
                      </p>
                    </div>
                  )}

                  <label className="field-label">Plateforme</label>
                  {detailsLoading ? (
                    <span className="mf-sk-row" />
                  ) : (
                    <ScrollRow>
                      {platformOptions.map((p) => {
                        const active = platform === p;
                        return (
                          <button
                            key={p}
                            className={`plat-card clickable ${active ? "active" : ""}`}
                            onClick={() => setPlatform(active ? "" : p)}
                          >
                            {active && (
                              <span className="pick-check">
                                <Check size={13} strokeWidth={3} />
                              </span>
                            )}
                            {p}
                          </button>
                        );
                      })}
                    </ScrollRow>
                  )}

                  {/* Format d'achat (console uniquement) : démat ou boîte */}
                  {showFormat && (
                    <div className="format-row">
                      <label className="field-label">Format</label>
                      <div className="format-seg">
                        <button
                          type="button"
                          className={`format-opt clickable ${format === "digital" ? "active" : ""}`}
                          onClick={() => setFormat("digital")}
                        >
                          <Cloud size={16} />
                          <span>Digital</span>
                        </button>
                        <button
                          type="button"
                          className={`format-opt clickable ${format === "physical" ? "active" : ""}`}
                          onClick={() => setFormat("physical")}
                        >
                          <Disc size={16} />
                          <span>Physique</span>
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="time-ttb-row">
                    <div className="time-col">
                      <label className="field-label">Temps de jeu</label>
                      <div className="input-group">
                        <Clock size={17} className="input-icon" />
                        <input
                          className="modal-input"
                          type="number"
                          min="0"
                          placeholder="0"
                          value={playtime}
                          onChange={(e) => setPlaytime(e.target.value)}
                        />
                        <span className="input-suffix">h</span>
                      </div>
                    </div>
                    <div className="ttb-col">
                      <label className="field-label">Temps moyen des joueurs</label>
                      <div className="ttb-chips">
                        {ttbChips.map((c) => (
                          <button
                            key={c.label}
                            className={`ttb-chip ${!c.v ? "empty" : "clickable"} ${
                              c.v && String(c.v) === String(playtime) ? "active" : ""
                            }`}
                            onClick={() => c.v && setPlaytime(String(c.v))}
                            disabled={!c.v}
                          >
                            <span className="ttb-chip-label">{c.label}</span>
                            <span className="ttb-chip-val">{c.v ? `${c.v}h` : "—"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* --- Quand : deux dates saisies à la main ------------
                      Le serveur ne les devine pas, et il ne faut pas qu'il
                      essaie : un jeu ajouté aujourd'hui a très bien pu être
                      terminé il y a dix ans. */}
                  <div className="when-row">
                    <div className="when-col">
                      <label className="field-label" htmlFor="mpl-started">
                        Commencé le
                      </label>
                      <div className="input-group">
                        <CalendarDays size={17} className="input-icon" />
                        <input
                          id="mpl-started"
                          className="modal-input"
                          type="date"
                          value={startedAt}
                          max={finishedAt || undefined}
                          onChange={(e) => setStartedAt(e.target.value)}
                        />
                        {startedAt && (
                          <button
                            type="button"
                            className="when-clear clickable"
                            onClick={() => setStartedAt("")}
                            aria-label="Effacer la date de début"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* La date de fin ne se demande QU'À UN JEU TERMINÉ :
                        partout ailleurs, c'est une question sans réponse. */}
                    {status === "finished" && (
                      <div className="when-col">
                        <label className="field-label" htmlFor="mpl-finished">
                          Terminé le
                        </label>
                        <div className="input-group">
                          <CalendarCheck size={17} className="input-icon" />
                          <input
                            id="mpl-finished"
                            className="modal-input"
                            type="date"
                            value={finishedAt}
                            min={startedAt || undefined}
                            onChange={(e) => setFinishedAt(e.target.value)}
                          />
                          {finishedAt && (
                            <button
                              type="button"
                              className="when-clear clickable"
                              onClick={() => setFinishedAt("")}
                              aria-label="Effacer la date de fin"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Le 100 % ne se propose qu'à un jeu qu'on a MENÉ AU BOUT :
                      demander « l'as-tu complété ? » d'un jeu en cours n'a pas
                      de sens. Un jeu sans fin, si — c'est même là que le
                      platine demande le plus de travail. */}
                  {canComplete && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={platinum}
                      className={`hundred-btn clickable ${platinum ? "active" : ""}`}
                      onClick={() => setPlatinum((v) => !v)}
                    >
                      <Sparkles size={17} />
                      <span>Terminé à 100 %</span>
                      {platinum && <span className="hundred-tag">PLATINE</span>}
                    </button>
                  )}

                  <CharacterPicker
                    gameId={game.id}
                    token={token}
                    characters={details.characters}
                    favChar={favChar}
                    onSelect={setFavChar}
                    onCharsChange={(chars) =>
                      setDetails((d) => ({ ...d, characters: chars }))
                    }
                  />

                  <OstPicker
                    gameId={game.id}
                    gameName={game.name}
                    token={token}
                    favorite={favoriteOst}
                    onSelect={(t) =>
                      setFavoriteOst(
                        t
                          ? {
                              name: t.name,
                              artist: t.artist,
                              preview: t.preview || null,
                              artwork: t.artwork || null,
                              youtube: !!t.youtube,
                              url: t.url || null,
                            }
                          : null
                      )
                    }
                  />
                </div>
              </div>

              {/* Footer : actions tout en bas, à droite */}
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={attemptClose} disabled={saving}>
                  Annuler
                </button>
                <button
                  className="btn btn-primary"
                  onClick={save}
                  disabled={saving || entryLoading || !status}
                  title={!status ? "Choisis d'abord ton avancement" : undefined}
                >
                  {saving || entryLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Enregistrer
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Popup Review (par-dessus) */}
      {showReview && (
        <div
          className="modal-overlay sub"
          onMouseDown={() => setShowReview(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal review-modal" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="modal-close clickable"
              onClick={() => setShowReview(false)}
              aria-label="Fermer"
            >
              <X size={20} />
            </button>

            <div className="review-head">
              <span className="review-head-icon">
                <PenLine size={20} />
              </span>
              <div>
                <h2 className="modal-title">Ma review</h2>
                <p className="review-sub">{game.name}</p>
              </div>
            </div>

            {/* Éditeur riche identique à la section commentaires (emoji, GIF, image) */}
            <Composer
              token={token}
              big
              autoFocus
              maxChars={10000}
              placeholder="Partage ton avis sur le jeu…"
              initialText={review}
              initialMedia={reviewMedia}
              onLiveChange={({ text, media }) => {
                setReview(text);
                setReviewMedia(media);
              }}
              toolbarExtra={
                <button
                  type="button"
                  className={`spoiler-toggle clickable ${spoiler ? "on" : ""}`}
                  onClick={() => setSpoiler((v) => !v)}
                  title="Marquer la review comme spoiler"
                >
                  <EyeOff size={15} />
                  <span className="spoiler-toggle-label">Spoilers</span>
                </button>
              }
            />

            <div className="proscons">
              <ChipEditor label="Les points forts" Icon={ThumbsUp} tone="pro" items={pros} onChange={setPros} />
              <ChipEditor label="Les points faibles" Icon={ThumbsDown} tone="con" items={cons} onChange={setCons} />
            </div>

            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowReview(false)}>
                <Check size={16} /> Terminé
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avertissement de fermeture avec des modifications non enregistrées */}
      {confirmClose && (
        <div
          className="modal-overlay sub confirm-overlay"
          onMouseDown={() => setConfirmClose(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="confirm-card" onMouseDown={(e) => e.stopPropagation()}>
            <span className="confirm-icon">
              <AlertTriangle size={24} />
            </span>
            <h3 className="confirm-title">Modifications non enregistrées</h3>
            <p className="confirm-text">
              Tes changements ne sont pas encore enregistrés. Si tu fermes
              maintenant, ils seront perdus.
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmClose(false)}
              >
                Continuer l'édition
              </button>
              <button
                className="btn-discard clickable"
                onClick={() => {
                  setConfirmClose(false);
                  onClose();
                }}
              >
                Fermer sans enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* « Ajouter à une liste » : la même modale que depuis une vignette, en
          couche au-dessus (`sub`). Elle enregistre toute seule — rien à
          reprendre dans le corps d'enregistrement de la fiche. */}
      {showListModal && (
        <AddToListModal
          sub
          game={{ ...game, cover: cover || game.cover }}
          onClose={() => setShowListModal(false)}
        />
      )}
    </>,
    document.body
  );
}

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
