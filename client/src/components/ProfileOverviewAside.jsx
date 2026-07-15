import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
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
  Hourglass,
  Joystick,
  Play,
  Pause,
  Disc3,
  Music,
  Film,
  ListMusic,
  ListChecks,
  MessageSquareText,
  Star,
  ArrowRight,
  Building2,
  ScrollText,
  Gamepad2,
  Swords,
  Trophy,
  Users,
  Heart,
  GripVertical,
  Check,
  SlidersHorizontal,
  Plus,
  Settings,
  Crown,
  BarChart3,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { typeMeta, timeAgo } from "../lib/lists";
import { extractVideoId } from "../lib/youtube";
import { usePlayer } from "../context/PlayerContext";
import { WantedPosterCard, WantedModal } from "./WantedPoster";
import ProfileAsideCardModal, { isConfigurable } from "./ProfileAsideCardModal";

const nf = new Intl.NumberFormat("fr-FR");

function fmtHours(h) {
  if (!h) return "0 h";
  if (h >= 1000) return `${nf.format(Math.round(h / 100) / 10)} k h`;
  return `${nf.format(Math.round(h))} h`;
}

// --- Registre des widgets de la colonne latérale. L'ordre par défaut et la
//     liste des clés doivent rester alignés avec ASIDE_WIDGETS côté serveur
//     (routes/users.js). En mode édition, les cards actives vivent dans l'aside
//     et les cards disponibles dans une « boîte à outils » : on glisse de l'une
//     à l'autre (pas de bouton masquer). Un widget sans donnée n'apparaît nulle
//     part. ---
const WIDGET_META = {
  stats: { label: "Statistiques", Icon: BarChart3 },
  playtime: { label: "Temps de jeu", Icon: Hourglass },
  "tracking-lol": { label: "Tracking · LoL", Icon: Swords },
  "tracking-rivals": { label: "Tracking · Rivals", Icon: Swords },
  console: { label: "Console favorite", Icon: Joystick },
  characters: { label: "Personnages favoris", Icon: Users },
  studios: { label: "Studios favoris", Icon: Building2 },
  playlist: { label: "Playlist", Icon: ListMusic },
  ost: { label: "Dernière OST likée", Icon: Music },
  video: { label: "Dernière reco vidéo", Icon: Film },
  lists: { label: "Dernières listes", Icon: ListChecks },
  review: { label: "Dernière review", Icon: MessageSquareText },
  wanted: { label: "Avis de recherche", Icon: ScrollText },
};
const DEFAULT_ORDER = [
  "stats",
  "playtime",
  "tracking-lol",
  "tracking-rivals",
  "console",
  "characters",
  "studios",
  "playlist",
  "ost",
  "video",
  "lists",
  "review",
  "wanted",
];

// Cards rangées dans la boîte à outils par défaut (tant que le joueur n'a rien
// personnalisé) : secondaires / redondantes, pour que la boîte ne soit pas vide
// à la première ouverture. Dès qu'il glisse quoi que ce soit, ses choix priment.
const DEFAULT_HIDDEN = ["console", "characters", "playlist"];

// Repart de l'ordre sauvegardé (nettoyé) et complète avec les widgets manquants
// pour qu'un nouveau widget apparaisse toujours, même sur un ordre ancien.
function resolveOrder(saved) {
  const base = (saved?.length ? saved : DEFAULT_ORDER).filter((k) => WIDGET_META[k]);
  for (const k of DEFAULT_ORDER) if (!base.includes(k)) base.push(k);
  return base;
}
function resolveHidden(saved, configured) {
  if (Array.isArray(saved) && saved.length) return saved.filter((k) => WIDGET_META[k]);
  return configured ? [] : DEFAULT_HIDDEN.slice();
}

// Petite carte titrée réutilisée par tous les blocs de l'aside.
function AsideCard({ Icon, title, more, className = "", children }) {
  return (
    <section className={`pf-aside-card ${className}`}>
      <header className="pf-aside-head">
        <span className="pf-aside-title">
          <Icon size={14} /> {title}
        </span>
        {more}
      </header>
      {children}
    </section>
  );
}

// Zone déposable (aside active / boîte à outils) : permet de lâcher une card
// même quand la zone est vide (over.id = id de la zone).
function DropZone({ id, className, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? "is-over" : ""}`}>
      {children}
    </div>
  );
}

// Card déplaçable en mode édition : la card ENTIÈRE est la poignée (glissable de
// n'importe où). Son contenu passe en `pointer-events:none` (CSS `.pfa-slot`)
// pour désactiver les liens et laisser le pointeur déclencher le glissé.
function SortableCard({ id, onConfigure, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
  };
  const onContextMenu = onConfigure
    ? (e) => {
        e.preventDefault();
        onConfigure(id);
      }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`pfa-slot editing ${isDragging ? "dragging" : ""} ${
        onConfigure ? "configurable" : ""
      }`}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {onConfigure && (
        <button
          type="button"
          className="pfa-slot-cog clickable"
          title="Configurer cette carte"
          // Stoppe le glissé : un clic sur l'engrenage ouvre la config sans
          // déclencher le drag de la card (les listeners vivent sur le parent).
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onConfigure(id);
          }}
        >
          <Settings size={13} />
        </button>
      )}
      {children}
    </div>
  );
}

// Carte de tracking in-game « sexy » : jaquette du jeu en tête (pas d'icône), rang
// + total de parties inline, et portrait du héros/champion fétiche qui DÉBORDE de
// la carte (overflow visible) pour un effet « hors-cadre ». LoL & Marvel Rivals.
function TrackingCard({
  variant,
  cover,
  title,
  player,
  emblem,
  tier,
  games,
  hero,
  fallbackIcon: FB,
}) {
  return (
    <section className={`pf-aside-card pfa-trk-card ${variant}`}>
      <header className="pfa-trk-top">
        <span className="pfa-trk-gamecover">
          {cover ? <img src={cover} alt="" loading="lazy" /> : <FB size={16} />}
        </span>
        <span className="pfa-trk-titles">
          <span className="pfa-trk-game">{title}</span>
          {player && <span className="pfa-trk-player">{player}</span>}
        </span>
      </header>

      <div className={`pfa-trk-body ${hero?.name ? "has-splash" : ""}`}>
        <span className="pfa-trk-emblem">{emblem}</span>
        <span className="pfa-trk-rankinfo">
          <span className="pfa-trk-tier">{tier}</span>
          {games != null && (
            <span className="pfa-trk-games">
              <Gamepad2 size={12} /> {nf.format(games)} partie{games > 1 ? "s" : ""}
            </span>
          )}
          {hero?.name && <span className="pfa-trk-heroname">{hero.name}</span>}
        </span>
      </div>

      {hero?.name && (
        <span className="pfa-trk-hero-splash" title={hero.name}>
          {hero.thumb ? (
            <img src={hero.thumb} alt="" loading="lazy" />
          ) : (
            <span className="pfa-trk-hero-fb">
              <FB size={30} />
            </span>
          )}
        </span>
      )}
    </section>
  );
}

// Colonne latérale de l'onglet « Aperçu » (PC) : condensé de stats + contenus du
// joueur, entièrement personnalisable par le propriétaire. En mode édition, les
// jeux laissent place à une boîte à outils : on glisse les cards voulues dans
// l'aside, on les glisse dehors pour les retirer. Consultable publiquement.
export default function ProfileOverviewAside({
  username,
  token,
  isMe,
  profile,
  library,
  lists,
  onSavePrefs,
  onEditingChange,
  onOpenTab,
}) {
  const favoriteCompanies = profile?.favoriteCompanies || [];
  const counts = profile?.counts || {};
  const trackers = profile?.trackers || [];

  // ---- Personnalisation (ordre + masqués), synchronisée avec le serveur. ----
  // « Configuré » = le joueur a déjà touché à sa disposition (ordre non vide).
  const configured = (profile?.asideOrder || []).length > 0;
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(() => resolveOrder(profile?.asideOrder));
  const [hidden, setHidden] = useState(() => resolveHidden(profile?.asideHidden, configured));
  // Réglage par carte (auto vs épinglé) + carte en cours de configuration.
  const [config, setConfig] = useState(() => profile?.asideConfig || {});
  const [configModal, setConfigModal] = useState(null); // clé de widget

  const savedOrderKey = (profile?.asideOrder || []).join("|");
  const savedHiddenKey = (profile?.asideHidden || []).join("|");
  const savedConfigKey = JSON.stringify(profile?.asideConfig || {});
  useEffect(() => {
    if (!editing) setOrder(resolveOrder(profile?.asideOrder));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedOrderKey]);
  useEffect(() => {
    if (!editing) setHidden(resolveHidden(profile?.asideHidden, configured));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedHiddenKey, savedOrderKey]);
  useEffect(() => {
    setConfig(profile?.asideConfig || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConfigKey]);

  function openConfig(key) {
    if (isConfigurable(key)) setConfigModal(key);
  }
  function saveConfig(key, cfg) {
    const next = { ...config, [key]: cfg };
    setConfig(next);
    onSavePrefs?.({ asideConfig: next });
  }
  const cfg = (key) => config[key] || null;

  // Prévient le parent (Profile → ProfileOverview) pour qu'il masque les jeux et
  // laisse l'aside occuper toute la largeur pendant l'édition.
  useEffect(() => {
    onEditingChange?.(editing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // ---------- Données dérivées de la bibliothèque (aucune requête) ----------
  const totalHours = useMemo(
    () => library.reduce((s, e) => s + (e.playtimeHours || 0), 0),
    [library]
  );
  const topPlat = useMemo(() => {
    const m = new Map();
    for (const e of library) {
      if (!e.platform) continue;
      const cur = m.get(e.platform) || { count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += e.playtimeHours || 0;
      m.set(e.platform, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)[0] || null;
  }, [library]);

  const finishedCount = counts.finished ?? library.filter((e) => e.status === "finished").length;
  const gamesCount = counts.games ?? library.length;
  const favCount = counts.favorites ?? library.filter((e) => e.favorite).length;
  const playingCount = useMemo(
    () => library.filter((e) => e.status === "playing").length,
    [library]
  );
  const ostCount = useMemo(
    () => library.filter((e) => e.favoriteOst?.name).length,
    [library]
  );
  const completion = gamesCount ? Math.round((finishedCount / gamesCount) * 100) : 0;

  // Consoles jouées (toutes, récentes d'abord par nombre de jeux).
  const platforms = useMemo(() => {
    const m = new Map();
    for (const e of library) {
      if (!e.platform) continue;
      const cur = m.get(e.platform) || { platform: e.platform, count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += e.playtimeHours || 0;
      m.set(e.platform, cur);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [library]);

  // Playlists (récentes d'abord).
  const playlists = useMemo(
    () =>
      lists
        .filter((l) => l.type === "playlist" && (isMe || l.visibility === "public"))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [lists, isMe]
  );
  // Listes publiques hors playlist (candidates de la carte « Dernières listes »).
  const listCandidates = useMemo(
    () =>
      lists
        .filter((l) => l.visibility === "public" && l.type !== "playlist")
        .map((l) => ({ ...l, typeLabel: typeMeta(l.type).label }))
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [lists]
  );
  // Jeux avec une OST likée (candidats à épingler, récents d'abord).
  const ostGames = useMemo(
    () =>
      library
        .filter((e) => e.favoriteOst?.name)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    [library]
  );
  // Personnages favoris : pool complet unique (gameId::nom), récents d'abord.
  const characterPool = useMemo(() => {
    const src = library
      .filter((e) => e.favoriteCharacter?.name)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const seen = new Set();
    const out = [];
    for (const e of src) {
      const key = `${e.gameId}::${e.favoriteCharacter.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        gameId: e.gameId,
        name: e.favoriteCharacter.name,
        image: e.favoriteCharacter.image,
        game: e.name,
      });
    }
    return out;
  }, [library]);

  // Résolutions « ce qu'on affiche » selon la config (auto vs épinglé).
  const playlistPin = cfg("playlist");
  const playlistShown =
    playlistPin?.mode === "pin"
      ? playlists.find((p) => p.id === playlistPin.id) || playlists[0]
      : playlists[0];

  const ostPin = cfg("ost");
  const ostEntry =
    ostPin?.mode === "pin"
      ? ostGames.find((e) => e.gameId === ostPin.gameId) || ostGames[0] || null
      : ostGames[0] || null;

  const listsPin = cfg("lists");
  const listsPinned =
    listsPin?.mode === "pin" && listsPin.ids?.length
      ? listsPin.ids.map((id) => listCandidates.find((l) => l.id === id)).filter(Boolean).slice(0, 3)
      : null;
  const listsShown = listsPinned?.length ? listsPinned : listCandidates.slice(0, 3);

  const consolePin = cfg("console");
  const consoleShown =
    consolePin?.mode === "pin"
      ? platforms.find((p) => p.platform === consolePin.platform) || platforms[0] || null
      : platforms[0] || null;

  const charsPin = cfg("characters");
  const charsPinned =
    charsPin?.mode === "pin" && charsPin.keys?.length
      ? charsPin.keys
          .map((k) => characterPool.find((c) => c.key === k))
          .filter(Boolean)
          .slice(0, 4)
      : null;
  // Max 4 personnages favoris (auto : les 4 plus récents).
  const charactersShown = charsPinned?.length ? charsPinned : characterPool.slice(0, 4);

  // ---------- Contenus qui nécessitent une requête (best-effort) ----------
  const [videos, setVideos] = useState(undefined); // liste (pour l'épinglage)
  const [review, setReview] = useState(undefined);
  const [wanted, setWanted] = useState(null); // avis de recherche (délits de DL)
  const [wantedOpen, setWantedOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch(`/videos/user/${username}?type=recommended`, { token })
      .then((d) => alive && setVideos(d.videos || []))
      .catch(() => alive && setVideos([]));
    apiFetch(`/users/${username}/activity`, { token })
      .then((d) => alive && setReview(d.reviews?.[0] || null))
      .catch(() => alive && setReview(null));
    apiFetch(`/feed/wanted/${encodeURIComponent(username)}`, { token })
      .then((d) => alive && setWanted(d))
      .catch(() => alive && setWanted(null));
    return () => {
      alive = false;
    };
  }, [username, token]);

  // Tracking in-game : rang courant + pic + perso le plus joué. On ne récupère
  // que les jeux réellement liés (info immédiate via profile.trackers).
  const hasLol = trackers.some((t) => t.provider === "league-of-legends");
  const hasRivals = trackers.some((t) => t.provider === "marvel-rivals");
  const [lol, setLol] = useState(null);
  const [rivals, setRivals] = useState(null);
  useEffect(() => {
    let alive = true;
    if (hasLol)
      apiFetch(`/trackers/league-of-legends/${username}`, { token })
        .then((d) => alive && setLol(d))
        .catch(() => {});
    if (hasRivals)
      apiFetch(`/trackers/marvel-rivals/${username}`, { token })
        .then((d) => alive && setRivals(d))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [username, token, hasLol, hasRivals]);

  // Consoles (par nom) : vraie PHOTO de la console (Wikipedia, comme la fiche
  // console) pour l'affichage + logo IGDB en repli. Les deux alimentent la carte
  // « Console favorite » et sa modale.
  const [platformLogos, setPlatformLogos] = useState({});
  const [platformImages, setPlatformImages] = useState({});
  const platformNamesKey = platforms.map((p) => p.platform).join("|");
  useEffect(() => {
    const names = platforms.map((p) => p.platform);
    if (!names.length) return;
    let alive = true;
    apiFetch("/platforms/logos", { method: "POST", token, body: { names } })
      .then((d) => alive && setPlatformLogos(d.logos || {}))
      .catch(() => {});
    apiFetch("/platforms/images", { method: "POST", token, body: { names } })
      .then((d) => alive && setPlatformImages(d.images || {}))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformNamesKey, token]);

  // Vidéo reco à afficher : dernière (auto) ou épinglée. undefined = en cours.
  const videoPin = cfg("video");
  const video =
    videos === undefined
      ? undefined
      : videoPin?.mode === "pin"
        ? videos.find((v) => v.videoId === videoPin.videoId) || videos[0] || null
        : videos[0] || null;

  // ---- Lecture de l'OST mise en avant : déléguée au mini-lecteur global. ----
  const player = usePlayer();
  const ost = ostEntry?.favoriteOst;
  const ytVideoId = ost?.url ? extractVideoId(ost.url) : ost?.videoId || null;
  const canPlayOst = !!(ost && ytVideoId);
  const playing = ost ? player.isPlaying(ost) : false;
  function toggleOst() {
    if (!ost || !canPlayOst) return;
    player.toggleTrack(
      { ...ost, gameId: ostEntry.gameId, gameName: ostEntry.name },
      [{ ...ost, gameId: ostEntry.gameId, gameName: ostEntry.name }],
      {}
    );
  }

  // ======================================================================
  //  Rendu d'un widget par sa clé — renvoie null si rien à afficher (le
  //  widget se retire alors tout seul, y compris de la boîte à outils).
  // ======================================================================
  function widgetNode(key) {
    switch (key) {
      // -------- Statistiques (grille de tuiles) --------
      case "stats": {
        if (!gamesCount) return null;
        const tiles = [
          { Icon: Trophy, value: nf.format(finishedCount), label: "Terminés" },
          { Icon: Gamepad2, value: nf.format(playingCount), label: "En cours" },
          { Icon: BarChart3, value: `${completion}%`, label: "Complétion" },
          { Icon: Heart, value: nf.format(favCount), label: "Favoris" },
          { Icon: Hourglass, value: fmtHours(totalHours), label: "de jeu" },
          { Icon: Music, value: nf.format(ostCount), label: "OST likées" },
        ];
        return (
          <AsideCard Icon={BarChart3} title="Statistiques">
            <div className="pfa-stats-grid">
              {tiles.map((t) => (
                <div className="pfa-stat-tile" key={t.label}>
                  <span className="pfa-stat-tile-ic">
                    <t.Icon size={15} />
                  </span>
                  <span className="pfa-stat-tile-val">{t.value}</span>
                  <span className="pfa-stat-tile-lbl">{t.label}</span>
                </div>
              ))}
            </div>
          </AsideCard>
        );
      }

      // -------- Temps de jeu + console la plus jouée --------
      case "playtime":
        return (
          <AsideCard Icon={Hourglass} title="Temps de jeu">
            <div className="pfa-stat">
              <span className="pfa-stat-value">{fmtHours(totalHours)}</span>
              <span className="pfa-stat-label">passées manette en main</span>
            </div>
            {topPlat && (
              <div className="pfa-stat-plat">
                <span className="pfa-stat-plat-ic">
                  <Joystick size={15} />
                </span>
                <span className="pfa-stat-plat-body">
                  <span className="pfa-stat-plat-name">{topPlat[0]}</span>
                  <span className="pfa-stat-plat-sub">
                    console la plus jouée · {nf.format(topPlat[1].count)} jeu
                    {topPlat[1].count > 1 ? "x" : ""}
                  </span>
                </span>
              </div>
            )}
          </AsideCard>
        );

      // -------- Tracking League of Legends --------
      case "tracking-lol": {
        if (!hasLol) return null;
        const t = trackers.find((x) => x.provider === "league-of-legends");
        const snap = lol?.tracker?.snapshot;
        const rank = snap?.ranks?.find((r) => r.queue === "solo") || snap?.ranks?.[0];
        const champ = snap?.champions?.[0];
        const emblem = rank?.emblem ? (
          <span className="lol-rank-emblem" style={{ width: 46, height: 46 }}>
            <img className="lol-rank-emblem-img" src={rank.emblem} alt="" loading="lazy" />
          </span>
        ) : (
          <span className="pfa-trk-emblem-fb">
            <Crown size={20} />
          </span>
        );
        return (
          <TrackingCard
            variant="lol"
            cover={lol?.game?.cover}
            title="League of Legends"
            player={t?.externalName || "Invocateur"}
            emblem={emblem}
            tier={rank?.label || "Non classé"}
            games={rank?.games}
            hero={champ ? { name: champ.name, thumb: champ.thumb } : null}
            fallbackIcon={Crown}
          />
        );
      }

      // -------- Tracking Marvel Rivals --------
      case "tracking-rivals": {
        if (!hasRivals) return null;
        const t = trackers.find((x) => x.provider === "marvel-rivals");
        const snap = rivals?.tracker?.snapshot;
        const rank = snap?.rank;
        const hero = snap?.heroes?.[0];
        const emblem = rank?.image ? (
          <img className="pfa-trk-badge" src={rank.image} alt="" loading="lazy" />
        ) : (
          <span className="pfa-trk-emblem-fb">
            <Trophy size={20} />
          </span>
        );
        return (
          <TrackingCard
            variant="rivals"
            cover={rivals?.game?.cover}
            title="Marvel Rivals"
            player={t?.externalName || "Joueur"}
            emblem={emblem}
            tier={rank?.tier || "Non classé"}
            games={snap?.overall?.matches}
            hero={hero ? { name: hero.name, thumb: hero.thumb } : null}
            fallbackIcon={Trophy}
          />
        );
      }

      // -------- Console favorite --------
      case "console": {
        if (!consoleShown) return null;
        // Vraie photo de la console d'abord, logo IGDB en repli, icône sinon.
        const cphoto = platformImages[consoleShown.platform];
        const clogo = platformLogos[consoleShown.platform];
        return (
          <AsideCard Icon={Joystick} title="Console favorite">
            <div className="pfa-console">
              <span
                className={`pfa-console-ic ${
                  cphoto ? "has-photo" : clogo ? "has-logo" : ""
                }`}
              >
                {cphoto ? (
                  <img src={cphoto} alt="" loading="lazy" />
                ) : clogo ? (
                  <img src={clogo} alt="" loading="lazy" />
                ) : (
                  <Gamepad2 size={22} />
                )}
              </span>
              <span className="pfa-console-body">
                <span className="pfa-console-name">{consoleShown.platform}</span>
                <span className="pfa-console-sub">
                  {nf.format(consoleShown.count)} jeu{consoleShown.count > 1 ? "x" : ""}
                  {consoleShown.hours > 0 ? ` · ${fmtHours(consoleShown.hours)}` : ""}
                </span>
              </span>
            </div>
          </AsideCard>
        );
      }

      // -------- Personnages favoris --------
      case "characters": {
        if (!charactersShown.length) return null;
        return (
          <AsideCard Icon={Users} title="Personnages favoris">
            <div className="pfa-chars">
              {charactersShown.map((c) => (
                <Link
                  key={`${c.gameId}-${c.name}`}
                  to={`/game/${c.gameId}`}
                  className="pfa-char clickable"
                  title={`${c.name} · ${c.game}`}
                >
                  <span className="pfa-char-av">
                    {c.image ? (
                      <img src={c.image} alt="" loading="lazy" />
                    ) : (
                      (c.name || "?")[0].toUpperCase()
                    )}
                  </span>
                  <span className="pfa-char-name">{c.name}</span>
                </Link>
              ))}
            </div>
          </AsideCard>
        );
      }

      // -------- Studios favoris (favoris auto ou jusqu'à 3 épinglés) --------
      case "studios": {
        const studiosPin = cfg("studios");
        const studiosShown =
          studiosPin?.mode === "pin" && studiosPin.companies?.length
            ? studiosPin.companies
            : favoriteCompanies;
        // Vide : masqué pour les visiteurs, mais gardé (configurable) pour le
        // propriétaire, qui peut alors clic-droit → chercher des studios.
        if (!studiosShown.length) {
          if (!isMe) return null;
          return (
            <AsideCard Icon={Building2} title="Studios favoris">
              <p className="pfa-card-empty">Aucun studio épinglé pour l'instant.</p>
            </AsideCard>
          );
        }
        return (
          <AsideCard Icon={Building2} title="Studios favoris">
            <div className="pfa-studios">
              {studiosShown.slice(0, 6).map((c) => (
                <Link
                  key={c.name}
                  to={`/company/${encodeURIComponent(c.name)}`}
                  className="pfa-studio clickable"
                  title={c.name}
                >
                  <span className="pfa-studio-logo">
                    {c.logo ? <img src={c.logo} alt="" loading="lazy" /> : <Building2 size={16} />}
                  </span>
                  <span className="pfa-studio-body">
                    <span className="pfa-studio-name">{c.name}</span>
                    {c.country && <span className="pfa-studio-sub">{c.country}</span>}
                  </span>
                </Link>
              ))}
            </div>
          </AsideCard>
        );
      }

      // -------- Playlist mise en avant --------
      case "playlist": {
        const pl = playlistShown;
        if (!pl) return null;
        return (
          <AsideCard
            Icon={ListMusic}
            title="Playlist"
            more={
              playlists.length > 1 ? (
                <button className="pf-aside-more clickable" onClick={() => onOpenTab("lists")}>
                  Tout voir <ArrowRight size={12} />
                </button>
              ) : null
            }
          >
            <Link to={`/lists/${pl.id}`} className="pfa-playlist clickable">
              <span className="pfa-playlist-thumb">
                {pl.cover || pl.preview?.[0] ? (
                  <img src={pl.cover || pl.preview[0]} alt="" loading="lazy" />
                ) : (
                  <Music size={20} />
                )}
                <span className="pfa-playlist-play">
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </span>
              </span>
              <span className="pfa-playlist-body">
                <span className="pfa-playlist-title">{pl.title}</span>
                <span className="pfa-playlist-sub">
                  <ListMusic size={11} /> Playlist · màj {timeAgo(pl.updatedAt)}
                </span>
              </span>
            </Link>
          </AsideCard>
        );
      }

      // -------- OST mise en avant (dernière likée ou épinglée) --------
      case "ost": {
        if (!ostEntry) return null;
        return (
          <AsideCard
            Icon={Music}
            title="Dernière OST likée"
            more={
              <button className="pf-aside-more clickable" onClick={() => onOpenTab("ost")}>
                Tout voir <ArrowRight size={12} />
              </button>
            }
          >
            <div className="pfa-ost">
              <button
                className={`pfa-ost-disc clickable ${playing ? "spin" : ""} ${
                  canPlayOst ? "" : "mute"
                }`}
                onClick={canPlayOst ? toggleOst : undefined}
                disabled={!canPlayOst}
                title={canPlayOst ? (playing ? "Pause" : "Écouter") : "Extrait indisponible"}
              >
                <span className="pfa-ost-art">
                  {ost.artwork ? <img src={ost.artwork} alt="" loading="lazy" /> : <Disc3 size={22} />}
                </span>
                <span className="pfa-ost-hole" />
                <span className="pfa-ost-btn">
                  {playing ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} fill="currentColor" strokeWidth={0} />
                  )}
                </span>
              </button>
              <div className="pfa-ost-body">
                <span className="pfa-ost-name" title={ost.name}>
                  {ost.name}
                </span>
                {ost.artist && <span className="pfa-ost-artist">{ost.artist}</span>}
                <Link to={`/game/${ostEntry.gameId}`} className="pfa-ost-game clickable">
                  <Disc3 size={12} /> {ostEntry.name}
                </Link>
              </div>
            </div>
          </AsideCard>
        );
      }

      // -------- Dernière vidéo recommandée --------
      case "video": {
        if (!video) return null;
        return (
          <AsideCard
            Icon={Film}
            title="Dernière reco vidéo"
            more={
              <button className="pf-aside-more clickable" onClick={() => onOpenTab("videos")}>
                Tout voir <ArrowRight size={12} />
              </button>
            }
          >
            <a
              className="pfa-video clickable"
              href={`https://www.youtube.com/watch?v=${video.videoId}`}
              target="_blank"
              rel="noreferrer"
              title={video.title}
            >
              <span className="pfa-video-thumb">
                <img src={video.thumb} alt="" loading="lazy" />
                <span className="pfa-video-play">
                  <Play size={18} fill="currentColor" strokeWidth={0} />
                </span>
                {video.duration && <span className="pfa-video-dur">{video.duration}</span>}
              </span>
              <span className="pfa-video-body">
                <span className="pfa-video-title">{video.title}</span>
                {video.author && <span className="pfa-video-chan">{video.author}</span>}
              </span>
            </a>
          </AsideCard>
        );
      }

      // -------- Listes publiques (3 récentes ou épinglées) --------
      case "lists": {
        if (!listsShown.length) return null;
        return (
          <AsideCard
            Icon={ListChecks}
            title="Dernières listes"
            more={
              <button className="pf-aside-more clickable" onClick={() => onOpenTab("lists")}>
                Tout voir <ArrowRight size={12} />
              </button>
            }
          >
            <div className="pfa-lists">
              {listsShown.map((l) => {
                const meta = typeMeta(l.type);
                return (
                  <Link key={l.id} to={`/lists/${l.id}`} className="pfa-list-row clickable">
                    <span className="pfa-list-thumb">
                      {l.cover ? (
                        <img src={l.cover} alt="" loading="lazy" />
                      ) : l.preview?.[0] ? (
                        <img src={l.preview[0]} alt="" loading="lazy" />
                      ) : (
                        <meta.Icon size={16} />
                      )}
                    </span>
                    <span className="pfa-list-body">
                      <span className="pfa-list-title">{l.title}</span>
                      <span className="pfa-list-sub">
                        <meta.Icon size={11} /> {meta.label} · màj {timeAgo(l.updatedAt)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </AsideCard>
        );
      }

      // -------- Dernière review --------
      case "review": {
        if (!review || !(review.review?.trim() || review.rating != null)) return null;
        return (
          <AsideCard
            Icon={MessageSquareText}
            title="Dernière review"
            more={
              <button className="pf-aside-more clickable" onClick={() => onOpenTab("activity")}>
                Tout voir <ArrowRight size={12} />
              </button>
            }
          >
            <div className="pfa-review clickable" onClick={() => onOpenTab("activity")}>
              <span className="pfa-review-cover">
                {review.cover ? <img src={review.cover} alt="" loading="lazy" /> : <Disc3 size={18} />}
                {review.rating != null && (
                  <span className="pfa-review-note">
                    <Star size={9} fill="currentColor" strokeWidth={0} /> {review.rating}
                  </span>
                )}
              </span>
              <span className="pfa-review-body">
                <span className="pfa-review-game">{review.name}</span>
                {review.review?.trim() && (
                  <span className="pfa-review-text">{review.review.trim()}</span>
                )}
              </span>
            </div>
          </AsideCard>
        );
      }

      // -------- Avis de recherche (délits de téléchargement) --------
      case "wanted": {
        if (!wanted) return null;
        return (
          <AsideCard Icon={ScrollText} title="Avis de recherche">
            <button
              className="pfa-wanted clickable"
              onClick={() => setWantedOpen(true)}
              title="Voir l'avis de recherche en grand"
            >
              <WantedPosterCard username={username} wanted={wanted} />
            </button>
          </AsideCard>
        );
      }

      default:
        return null;
    }
  }

  // Nœud de chaque widget (calculé une fois) + disponibilité (contenu présent).
  const nodes = {};
  for (const key of order) nodes[key] = widgetNode(key);
  const isAvailable = (k) => !!nodes[k];
  const activeKeys = order.filter((k) => isAvailable(k) && !hidden.includes(k));
  const toolboxKeys = order.filter((k) => isAvailable(k) && hidden.includes(k));

  // ======================================================================
  //  Glisser-déposer à deux zones (aside active <-> boîte à outils).
  // ======================================================================
  const [cols, setCols] = useState({ active: [], toolbox: [] });
  const [dragId, setDragId] = useState(null);
  const colsRef = useRef(cols);
  colsRef.current = cols;
  const draggingRef = useRef(false);

  // (Re)synchronise les deux zones avec l'état sauvegardé — sauf en plein glissé,
  // pour ne pas écraser le déplacement en cours.
  const activeKey = activeKeys.join("|");
  const toolboxKey = toolboxKeys.join("|");
  useEffect(() => {
    if (!editing || draggingRef.current) return;
    setCols({ active: activeKeys, toolbox: toolboxKeys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, activeKey, toolboxKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const containerOf = (c, id) =>
    id === "active" || id === "toolbox"
      ? id
      : c.active.includes(id)
        ? "active"
        : c.toolbox.includes(id)
          ? "toolbox"
          : null;

  // Enregistre la disposition : l'ordre commence par les cards actives, les
  // masquées = boîte à outils (+ celles sans donnée qu'on avait déjà masquées).
  function persist(next) {
    const newOrder = [...next.active, ...order.filter((k) => !next.active.includes(k))];
    const unavailableHidden = hidden.filter((k) => !isAvailable(k));
    const newHidden = Array.from(new Set([...next.toolbox, ...unavailableHidden]));
    setOrder(newOrder);
    setHidden(newHidden);
    onSavePrefs?.({ asideOrder: newOrder, asideHidden: newHidden });
  }

  function onDragStart({ active }) {
    draggingRef.current = true;
    setDragId(active.id);
  }
  function onDragOver({ active, over }) {
    if (!over) return;
    const from = containerOf(colsRef.current, active.id);
    const to = containerOf(colsRef.current, over.id);
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const src = [...prev[from]];
      const dst = [...prev[to]];
      const i = src.indexOf(active.id);
      if (i < 0) return prev;
      src.splice(i, 1);
      let j = dst.indexOf(over.id);
      if (j < 0) j = dst.length;
      dst.splice(j, 0, active.id);
      return { ...prev, [from]: src, [to]: dst };
    });
  }
  function onDragEnd({ active, over }) {
    draggingRef.current = false;
    setDragId(null);
    const prev = colsRef.current;
    const from = containerOf(prev, active.id);
    const to = over ? containerOf(prev, over.id) : from;
    let next = prev;
    if (from && to && from === to && over && active.id !== over.id) {
      const arr = [...prev[from]];
      const oldI = arr.indexOf(active.id);
      const newI = arr.indexOf(over.id);
      if (oldI >= 0 && newI >= 0) next = { ...prev, [from]: arrayMove(arr, oldI, newI) };
    }
    setCols(next);
    persist(next);
  }
  function onDragCancel() {
    draggingRef.current = false;
    setDragId(null);
    setCols({ active: activeKeys, toolbox: toolboxKeys });
  }

  const shownKeys = activeKeys; // hors édition : uniquement les cards actives

  return (
    <aside className={`pf-overview-aside ${editing ? "editing" : ""}`}>
      {isMe && (
        <div className="pfa-edit-bar">
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
        </div>
      )}

      {editing ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="pfa-editor">
            {/* Zone active : les cards affichées sur le profil */}
            <div className="pfa-editor-active">
              <p className="pfa-editor-hint font-fun">
                <GripVertical size={13} /> Glisse pour organiser · <Settings size={12} /> l'engrenage
                pour configurer une card.
              </p>
              <SortableContext items={cols.active} strategy={verticalListSortingStrategy}>
                <DropZone id="active" className="pfa-dropzone">
                  {cols.active.length ? (
                    cols.active.map((key) => (
                      <SortableCard
                        key={key}
                        id={key}
                        onConfigure={isConfigurable(key) ? openConfig : undefined}
                      >
                        {nodes[key]}
                      </SortableCard>
                    ))
                  ) : (
                    <div className="pfa-dropzone-empty">
                      Glisse ici les cards de la boîte à outils pour les afficher sur ton profil.
                    </div>
                  )}
                </DropZone>
              </SortableContext>
            </div>

            {/* Boîte à outils : les cards disponibles à ajouter */}
            <div className="pfa-editor-toolbox">
              <h4 className="pfa-toolbox-title">
                <Plus size={14} /> Boîte à outils
              </h4>
              <SortableContext items={cols.toolbox} strategy={rectSortingStrategy}>
                <DropZone id="toolbox" className="pfa-toolbox-drop">
                  {cols.toolbox.length ? (
                    <div className="pfa-toolbox-grid">
                      {cols.toolbox.map((key) => (
                        <SortableCard
                          key={key}
                          id={key}
                          onConfigure={isConfigurable(key) ? openConfig : undefined}
                        >
                          {nodes[key]}
                        </SortableCard>
                      ))}
                    </div>
                  ) : (
                    <p className="pfa-toolbox-empty font-fun">
                      Toutes tes cards sont affichées. Glisse-en une hors de l'aside pour la ranger
                      ici.
                    </p>
                  )}
                </DropZone>
              </SortableContext>
            </div>
          </div>

          <DragOverlay>
            {dragId ? <div className="pfa-drag-overlay">{nodes[dragId]}</div> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        shownKeys.map((key) => <Fragment key={key}>{nodes[key]}</Fragment>)
      )}

      {configModal && (
        <ProfileAsideCardModal
          widget={configModal}
          config={config[configModal] || null}
          token={token}
          data={{
            playlists,
            ostGames,
            videos: videos || [],
            listCandidates,
            platforms,
            platformLogos,
            platformImages,
            characters: characterPool,
            favorites: favoriteCompanies,
          }}
          onSave={(cfgObj) => saveConfig(configModal, cfgObj)}
          onClose={() => setConfigModal(null)}
        />
      )}

      {wantedOpen && (
        <WantedModal
          username={username}
          wanted={wanted}
          token={token}
          onClose={() => setWantedOpen(false)}
        />
      )}
    </aside>
  );
}
