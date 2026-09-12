import { platformLabel } from "../lib/platforms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Clapperboard,
  Smartphone,
  Compass,
  Joystick,
  Plus,
  Settings,
  Check,
  Sparkles,
  Coins,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { apiFetch } from "../lib/api";
import { apiCached, isFreshApi, peekApi, writeApi } from "../lib/query";
import DocumentaryModal from "../components/DocumentaryModal";
import DiscoverGemsModal, { GEMS_RESUME_KEY } from "../components/DiscoverGemsModal";
import Section, { Rail } from "../components/home/Rail";
import NowPlayingCard from "../components/home/NowPlayingCard";
import AnticipatedCard from "../components/home/AnticipatedCard";
import EventCard from "../components/home/EventCard";
import HoursModal from "../components/home/HoursModal";
import OstRail from "../components/home/OstRail";
import { MotStrip, TonightCard } from "../components/home/Strips";
import { EventListCard, FreeCard, GameTile } from "../components/home/Tiles";
import {
  SkelAnticipated,
  SkelEvent,
  SkelEventList,
  SkelMot,
  SkelNowPlaying,
  SkelTile,
  SkelRepeat,
  SkelTonight,
} from "../components/home/Skeletons";
import { useGameBackdrops } from "../lib/backdrops";
import {
  dustyGames,
  favoriteGames,
  greeting,
  lovedPoolSize,
  lovedSeed,
  nowPlaying,
  recentlyFinished,
  sinceLabel,
  todayLabel,
  todayReleasesPath,
  tonightPick,
  wishlistGames,
} from "../lib/home";
import { countdown, needsTicker, shortDate, useSecondsTicker } from "../lib/homeEvents";

// ======================================================================
//  L'accueil
// ======================================================================
// ⚠️ CE N'EST PAS UNE VITRINE, C'EST UN POINT DE REPRISE. La page part de SA
// bibliothèque, et descend par cercles concentriques — la même progression que
// l'accueil du téléphone :
//
//   • en haut, toute la largeur : ce qu'il joue en ce moment ;
//   • à gauche : ce qui arrive (Directs, conférences), ses envies, les sorties
//     du jour, les plus attendus, puis le monde extérieur (placard, gratuits,
//     découverte, OST) et, tout en bas, ce qu'il a déjà fait (terminés, coups
//     de cœur, « parce que tu as adoré … ») ;
//   • à droite : que des ACTIONS (mot du jour, ce soir, documentaire, pépite,
//     arcade, app Android).
//
// Chaque rayon disparaît quand il n'a rien à dire.
//
// ⚠️ ET LA PAGE NE REPART PLUS DE ZÉRO. Elle s'ouvre avec ce qu'elle avait
// (cf. lib/query), ne redemande au serveur que ce qui est périmé, et n'affiche
// de squelette que pour ce qu'elle n'a encore jamais vu — jamais pour ce qui
// ne dépend de rien (le salut, les boutons, les titres, les raccourcis).

// Réglages par défaut du feed documentaire, persistés en localStorage.
const PREFS_KEY = "mpl_doc_prefs";
const DEFAULT_PREFS = { lang: ["fr"], scope: "played" };

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (p && Array.isArray(p.lang) && p.lang.length) return p;
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

// L'accueil ne montre que ce qui SE REGARDE. Les salons (gamescom, TGS) sont
// dans le calendrier complet : ils durent quatre jours et se visitent, ils n'ont
// rien à faire dans un rail de comptes à rebours.
const EVENTS_PATH = "/events/upcoming?kind=showcase&limit=8";
const LISTS_PATH = "/lists?scope=events&limit=12";
const OST_LIMIT = 8;

// ⚠️ UNE DURÉE DE FRAÎCHEUR PAR SOURCE, CALÉE SUR LE RYTHME OÙ ELLE CHANGE — les
// mêmes valeurs que le téléphone. La bibliothèque bouge quand on y touche ; les
// jeux offerts une fois par semaine ; les sorties d'une journée plus du tout une
// fois la journée commencée. Tout redemander au même rythme, c'est payer le
// réseau pour des réponses qu'on connaît déjà.
const MAX_AGE = {
  library: 60 * 1000,
  discover: 10 * 60 * 1000,
  free: 30 * 60 * 1000,
  mot: 5 * 60 * 1000,
  events: 15 * 60 * 1000,
  awaited: 15 * 60 * 1000,
  today: 60 * 60 * 1000,
  lists: 15 * 60 * 1000,
  similar: 24 * 60 * 60 * 1000,
};

export default function Welcome() {
  const { user, token } = useAuth();
  const { map: libraryMap, upsertLocal, removeLocal } = useLibrary();
  // Le dépôt est cloisonné par compte : sur un ordinateur partagé, personne ne
  // doit voir s'afficher la bibliothèque du précédent.
  const scope = user?.id || user?.username || "me";

  // ⚠️ `null` VEUT DIRE « PAS ENCORE VU », `[]` VEUT DIRE « VU, ET VIDE ». C'est
  // cette distinction qui décide entre un squelette (on attend quelque chose)
  // et un rayon absent (il n'y a rien à montrer). Chaque état part de ce que le
  // dépôt a déjà : un accueil déjà visité s'ouvre plein, sans une image de vide.
  const peek = (path, pick) => {
    const hit = peekApi(path, scope);
    return hit == null ? null : pick(hit);
  };
  const [library, setLibrary] = useState(() => peek("/library", (d) => d.entries || []));
  const [discover, setDiscover] = useState(() => peekApi("/feed/discover", scope));
  const [free, setFree] = useState(() => peek("/free-games", (d) => d.games || []));
  // Le mot du jour a TROIS états : `undefined` (pas encore vu, squelette),
  // `null` (indisponible, rien) et l'objet.
  const [mot, setMot] = useState(() => peekApi("/mot/today", scope) ?? undefined);
  const [events, setEvents] = useState(() => peek(EVENTS_PATH, (d) => d.events || []));
  const [today, setToday] = useState(() => peek(todayReleasesPath(), (d) => d.games || []));
  // Qui, parmi les gens qu'on suit, attend quoi. Une seule requête pour tout le
  // monde, et AUCUN appel IGDB — le serveur ne croise que des listes d'envies.
  const [awaitedBy, setAwaitedBy] = useState(
    () => peek("/games/releases/awaited", (d) => d.games || []) || []
  );
  const [similar, setSimilar] = useState([]);
  // Les listes officielles des derniers Directs et showcases : ce qui y a été
  // annoncé, jeu par jeu (cf. GET /lists?scope=events).
  const [eventLists, setEventLists] = useState(() =>
    peek(LISTS_PATH, (d) => (d.lists || []).slice(0, 12))
  );

  // Le jeu dont une écriture est en vol, pour que son bouton dise qu'il
  // travaille au lieu de rester inerte.
  const [busyId, setBusyId] = useState(null);
  const [hoursFor, setHoursFor] = useState(null);
  // Le coup de dé. Il ne change QUE la proposition du soir : le reste de la
  // page n'a aucune raison de bouger parce qu'on cherche quoi lancer.
  const [reroll, setReroll] = useState(0);
  // L'onglet ouvert du rayon « Découvrir ». Il ne tient que le temps de la
  // visite : un onglet de découverte mémorisé d'une session à l'autre finit par
  // figer la page sur un rayon qu'on avait ouvert par curiosité une fois.
  const [disc, setDisc] = useState("hot");
  // Le cran du rayon « parce que tu as adoré » : le bouton d'actualisation
  // avance d'un jeu dans la liste, sans changer la règle du jour.
  const [lovedShift, setLovedShift] = useState(0);

  // Les portes de côté, gardées de l'ancienne colonne de droite.
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showDoc, setShowDoc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGems, setShowGems] = useState(
    () => !!sessionStorage.getItem(GEMS_RESUME_KEY)
  );
  const settingsRef = useRef(null);
  useClickOutside(settingsRef, () => setShowSettings(false), showSettings);

  // ------------------------------------------------------------------
  //  Le chargement
  // ------------------------------------------------------------------
  // ⚠️ CHAQUE SOURCE REMPLIT SON RAYON DÈS QU'ELLE RÉPOND. La première version
  // attendait les sept réponses pour afficher quoi que ce soit : la page entière
  // allait au rythme de la plus lente (souvent IGDB, derrière /feed/discover),
  // alors que la bibliothèque était prête depuis longtemps.
  //
  // Une source en panne rend son rayon « vu et vide » : le squelette s'efface au
  // lieu de briller indéfiniment, et le reste de la page n'en sait rien.
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    const load = (path, maxAge, apply, onFail) =>
      apiCached(path, { token, scope, maxAge })
        .then((d) => alive && apply(d))
        .catch(() => alive && onFail?.());

    load("/library", MAX_AGE.library, (d) => setLibrary(d.entries || []), () =>
      setLibrary((v) => v ?? [])
    );
    load("/feed/discover", MAX_AGE.discover, setDiscover, () => setDiscover((v) => v ?? {}));
    load("/free-games", MAX_AGE.free, (d) => setFree(d.games || []), () =>
      setFree((v) => v ?? [])
    );
    load("/mot/today", MAX_AGE.mot, (d) => setMot(d ?? null), () =>
      setMot((v) => (v === undefined ? null : v))
    );
    load(EVENTS_PATH, MAX_AGE.events, (d) => setEvents(d.events || []), () =>
      setEvents((v) => v ?? [])
    );
    load("/games/releases/awaited", MAX_AGE.awaited, (d) => setAwaitedBy(d.games || []));
    load(todayReleasesPath(), MAX_AGE.today, (d) => setToday(d.games || []), () =>
      setToday((v) => v ?? [])
    );
    load(LISTS_PATH, MAX_AGE.lists, (d) => setEventLists((d.lists || []).slice(0, 12)), () =>
      setEventLists((v) => v ?? [])
    );

    return () => {
      alive = false;
    };
  }, [token, scope]);

  // ------------------------------------------------------------------
  //  Ce que l'écran modifie, le dépôt le retient
  // ------------------------------------------------------------------
  // Un jeu marqué terminé, une cloche cochée : sans ça, revenir sur l'accueil
  // dans la minute ré-afficherait l'ancien état, le temps que le réseau corrige.
  // `keepAge` : la liste modifiée n'en devient pas plus FRAÎCHE (cf. lib/query).
  useEffect(() => {
    if (library) writeApi("/library", { entries: library }, scope, { keepAge: true });
  }, [library, scope]);
  useEffect(() => {
    if (events) writeApi(EVENTS_PATH, { events }, scope, { keepAge: true });
  }, [events, scope]);

  // ------------------------------------------------------------------
  //  Quand la bibliothèque change AILLEURS sur le site
  // ------------------------------------------------------------------
  // ⚠️ LE CACHE NE DOIT PAS FAIRE MENTIR L'ACCUEIL. On marque un jeu terminé sur
  // sa fiche, on revient : la bibliothèque en dépôt (moins d'une minute, donc
  // « fraîche ») ne le sait pas. Mais la carte légère du contexte (`map`), elle,
  // est tenue à jour par toutes les pages. Si elle ne dit plus la même chose que
  // ce qu'on affiche, on redemande — sans attendre la fin de la minute.
  //
  // ⚠️ L'EFFET NE DÉPEND QUE DE `map`, JAMAIS DE `library`. Sinon : rechargement
  // → nouvelle bibliothèque → effet relancé → rechargement, en boucle. On lit la
  // bibliothèque par référence. Nos propres écritures, elles, tiennent les deux
  // d'accord (`upsertLocal` à chaque modification) : elles ne déclenchent rien.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    const lib = libraryRef.current;
    const keys = Object.keys(libraryMap || {});
    // Carte pas encore chargée, ou rien affiché : il n'y a rien à comparer.
    if (!token || !lib || !keys.length) return undefined;
    const same =
      keys.length === lib.length && lib.every((e) => libraryMap[e.gameId]?.status === e.status);
    if (same) return undefined;
    let alive = true;
    apiCached("/library", { token, scope, force: true })
      .then((d) => alive && setLibrary(d.entries || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryMap, token, scope]);

  // Le CTA « Chercher mes pépites aussi » des cartes du fil ouvre la modale.
  useEffect(() => {
    const open = () => setShowGems(true);
    window.addEventListener("mpl:open-gems", open);
    return () => window.removeEventListener("mpl:open-gems", open);
  }, []);

  function savePrefs(next) {
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  // ------------------------------------------------------------------
  //  Les lectures de la bibliothèque
  // ------------------------------------------------------------------
  const playing = useMemo(() => nowPlaying(library), [library]);
  const dusty = useMemo(() => dustyGames(library), [library]);
  const pick = useMemo(() => tonightPick(library, reroll), [library, reroll]);
  const loved = useMemo(() => lovedSeed(library, Date.now(), lovedShift), [library, lovedShift]);
  const lovedCount = useMemo(() => lovedPoolSize(library), [library]);
  // Trois bandes de plus, tirées de la MÊME liste déjà chargée : elles
  // s'affichent avant même qu'IGDB ait répondu (cf. lib/home).
  const wanted = useMemo(() => wishlistGames(library), [library]);
  const finished = useMemo(() => recentlyFinished(library), [library]);
  const favorites = useMemo(() => favoriteGames(library), [library]);
  const owned = useMemo(() => new Set((library || []).map((e) => String(e.gameId))), [library]);
  const wishlist = useMemo(
    () =>
      new Set(
        (library || []).filter((e) => e.status === "wishlist").map((e) => String(e.gameId))
      ),
    [library]
  );

  // Une seule horloge pour toute la page, et seulement si au moins une carte
  // affiche vraiment des secondes.
  const tick = useSecondsTicker(useMemo(() => needsTicker(events), [events]));

  // ⚠️ CE QUI EST FINI PASSE DERRIÈRE, MAIS NE DISPARAÎT PAS. Le serveur rend
  // les rendez-vous du jour même une fois passés — c'est justement l'heure où
  // l'on vient voir ce qui a été annoncé — et il les rend en tête, puisqu'il
  // trie par date. Un rail qui s'ouvre sur une émission terminée fait douter de
  // tout le reste : on la garde, marquée TERMINÉ, mais à la fin.
  const sortedEvents = useMemo(() => {
    const now = Date.now();
    return [...(events || [])].sort(
      (a, b) => Number(countdown(a, now).over) - Number(countdown(b, now).over)
    );
  }, [events]);

  // ⚠️ ON NE GARDE QUE LES DATES AU JOUR PRÈS. Quand IGDB ne connaît que le MOIS
  // de sortie, il date le jeu au dernier jour de ce mois : un 30 ou un 31,
  // « sorties du jour » se remplirait de jeux qui ne sortent pas aujourd'hui.
  const todayOut = useMemo(
    () =>
      (today || [])
        .filter((g) => g.precision === "day")
        .sort((a, b) => (b.hypes || 0) - (a.hypes || 0))
        .slice(0, 16),
    [today]
  );

  // ⚠️ LES DATÉS D'ABORD, ET SEULEMENT CEUX D'UN HORIZON RAISONNABLE. IGDB
  // laisse passer des jeux datés au 31 décembre d'une année lointaine — un
  // compte à rebours de 400 jours ne fait envie à personne.
  //
  // ⚠️ PUIS LES SANS-DATE, ET ILS ONT LEUR PLACE ICI : un jeu annoncé à un
  // showcase n'a pas de date le jour de son annonce, c'est-à-dire le jour où on
  // l'attend le plus fort.
  const awaited = useMemo(() => {
    const now = Date.now() / 1000;
    const horizon = now + 400 * 86400;
    const dated = (discover?.upcoming || []).filter(
      (g) => g.releaseDate && g.releaseDate > now && g.releaseDate < horizon
    );
    const undated = (discover?.upcomingUndated || []).filter((g) => !g.releaseDate);
    return [...dated, ...undated].slice(0, 14);
  }, [discover]);

  // Les visages, rangés par jeu : le composant ne doit pas fouiller un tableau
  // à chaque rendu de chaque carte.
  const awaitedFaces = useMemo(() => {
    const map = new Map();
    for (const row of awaitedBy || []) map.set(String(row.gameId), row.users || []);
    return map;
  }, [awaitedBy]);

  // Les décors des jeux en cours ET des sorties attendues, demandés en UNE
  // requête groupée.
  const backdrops = useGameBackdrops(
    useMemo(
      () => [...playing.map((e) => e.gameId), ...awaited.map((g) => g.id)],
      [playing, awaited]
    ),
    token
  );

  // « Parce que tu as adoré … ». On passe par la fiche complète du jeu adoré :
  // c'est elle qui porte les jeux voisins selon IGDB.
  //
  // ⚠️ ON NE MET EN DÉPÔT QUE LES VOISINS, PAS LA FICHE. La réponse complète
  // d'un jeu (médias, crédits, liens…) pèse lourd, et le disque du navigateur
  // n'a que quelques mégaoctets pour tout le site : on en garde la seule partie
  // que ce rayon affiche, sous une adresse à elle.
  const lovedId = loved?.gameId;
  useEffect(() => {
    if (!lovedId) {
      setSimilar([]);
      return undefined;
    }
    const key = `/games/${lovedId}/similar`;
    const ownedNow = owned;
    const keep = (list) => (list || []).filter((g) => !ownedNow.has(String(g.id))).slice(0, 14);

    const known = peekApi(key, scope);
    if (known) setSimilar(keep(known));
    if (known && isFreshApi(key, scope, MAX_AGE.similar)) return undefined;

    let alive = true;
    apiFetch(`/games/${lovedId}/full`, { token })
      .then((d) => {
        const list = (d?.similar || []).slice(0, 24);
        writeApi(key, list, scope);
        if (alive) setSimilar(keep(list));
      })
      .catch(() => {
        // Pas de voisins, pas de rayon : mieux que six cadres vides. Ce qu'on
        // avait en dépôt reste à l'écran.
        if (alive && !known) setSimilar([]);
      });
    return () => {
      alive = false;
    };
    // `owned` est volontairement hors dépendances : il change à chaque écriture
    // dans la bibliothèque, et relancer la requête pour retirer une jaquette du
    // rayon coûterait plus que de la laisser jusqu'au prochain passage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lovedId, token, scope]);

  // ------------------------------------------------------------------
  //  Écrire dans la bibliothèque, depuis l'accueil
  // ------------------------------------------------------------------
  /**
   * Un champ de suivi modifié, tout de suite à l'écran.
   *
   * ⚠️ ON PEINT AVANT DE DEMANDER. Marquer un jeu terminé fait partir sa carte
   * du haut de la page : attendre l'aller-retour serveur pour ça, c'est une
   * demi-seconde pendant laquelle le clic n'a servi à rien et où l'on
   * re-clique. En cas d'échec on remet la carte comme elle était — le seul cas
   * où l'écran recule, et il est rare.
   */
  const patch = useCallback(
    async (entry, body) => {
      const next = { ...entry, ...body, updatedAt: new Date().toISOString() };
      setBusyId(entry.gameId);
      setLibrary((prev) => (prev || []).map((e) => (e.gameId === entry.gameId ? next : e)));
      // Le reste du site lit la carte légère du contexte : la tenir à jour
      // évite qu'une fiche ouverte juste après affiche l'ancien statut.
      upsertLocal(entry.gameId, { status: next.status, favorite: !!next.favorite });
      try {
        await apiFetch(`/library/${entry.gameId}`, {
          method: "PUT",
          token,
          // Le nom est exigé à la création d'une entrée ; il ne coûte rien sur
          // une mise à jour et évite d'avoir à savoir laquelle des deux c'est.
          body: { name: entry.name, cover: entry.cover ?? null, ...body },
        });
      } catch {
        setLibrary((prev) => (prev || []).map((e) => (e.gameId === entry.gameId ? entry : e)));
        upsertLocal(entry.gameId, { status: entry.status, favorite: !!entry.favorite });
      }
      setBusyId(null);
    },
    [token, upsertLocal]
  );

  const finish = useCallback(
    (entry) =>
      patch(entry, {
        status: "finished",
        // Une date de fin qu'on n'a pas saisie vaut mieux que pas de date : le
        // profil range les jeux terminés par là, et « aujourd'hui » est vrai
        // dans l'écrasante majorité des cas où l'on appuie sur ce bouton.
        ...(entry.finishedAt ? null : { finishedAt: new Date().toISOString() }),
      }),
    [patch]
  );

  /**
   * « Ça m'intéresse », sur un rendez-vous à venir.
   *
   * ⚠️ ON ENVOIE L'ÉTAT VOULU, PAS « INVERSE ». Deux clics rapides envoient
   * `true` puis `false` : quel que soit l'ordre d'arrivée des réponses, le
   * serveur finit sur ce qu'on voit.
   */
  const toggleInterest = useCallback(
    async (event, want) => {
      const before = event.interested;
      const paint = (on, count) =>
        setEvents((prev) =>
          (prev || []).map((e) =>
            e.id === event.id ? { ...e, interested: on, interestedCount: count } : e
          )
        );
      paint(want, Math.max(0, (event.interestedCount || 0) + (want ? 1 : -1)));
      try {
        const res = await apiFetch(`/events/${event.id}/interest`, {
          method: "POST",
          token,
          body: { interested: want },
        });
        // Le serveur fait autorité sur le COMPTE : d'autres ont pu cocher
        // pendant ce temps, et notre + 1 local ne le savait pas.
        paint(res.interested, res.interestedCount ?? 0);
      } catch {
        paint(before, event.interestedCount || 0);
      }
    },
    [token]
  );

  /**
   * Le signet d'une sortie attendue.
   *
   * ⚠️ CE N'EST PAS `patch`. Celui-ci modifie une entrée QUI EXISTE ; ici le jeu
   * n'est en général pas encore dans la bibliothèque, et c'est justement ce
   * qu'on est en train de changer. Un `PUT` crée l'entrée au besoin, un `DELETE`
   * la retire entièrement — parce qu'un jeu retiré des envies n'a aucune autre
   * raison de rester.
   */
  const toggleWish = useCallback(
    async (game, want) => {
      const gameId = game.id;
      const before = library;
      setLibrary((prev) =>
        want
          ? [
              {
                gameId,
                name: game.name,
                cover: game.cover,
                status: "wishlist",
                updatedAt: new Date().toISOString(),
              },
              ...(prev || []).filter((e) => e.gameId !== gameId),
            ]
          : (prev || []).filter((e) => e.gameId !== gameId)
      );
      if (want) upsertLocal(gameId, { status: "wishlist" });
      else removeLocal(gameId);
      try {
        if (want) {
          await apiFetch(`/library/${gameId}`, {
            method: "PUT",
            token,
            body: { name: game.name, cover: game.cover || null, status: "wishlist" },
          });
        } else {
          await apiFetch(`/library/${gameId}`, { method: "DELETE", token });
        }
      } catch {
        setLibrary(before);
      }
    },
    [library, token, upsertLocal, removeLocal]
  );

  const hot = discover?.hot || [];
  const forYou = discover?.forYou || [];
  const indies = discover?.indies || [];
  const now = Date.now() / 1000;

  // Les trois façons de répondre à « je joue à quoi d'autre ? ». Un onglet qui
  // n'a rien à montrer n'existe pas : mieux vaut deux onglets pleins que trois
  // dont un ouvre sur du vide.
  const discoverTabs = [
    {
      key: "hot",
      label: "Du moment",
      title: "Les jeux du moment",
      hint: "Ce que tout le monde regarde en ce moment",
      more: "/explore",
      games: hot,
      sub: (g) => (g.rating ? `${g.rating} %` : null),
      badge: () => null,
    },
    {
      key: "forYou",
      label: "Pour toi",
      title: "Ça devrait te plaire",
      hint: "Selon les genres de ta bibliothèque",
      more: "/explore",
      games: forYou,
      sub: (g) => (g.year ? String(g.year) : null),
      badge: () => null,
    },
    {
      key: "indies",
      label: "Indés",
      title: "Sorties indés",
      hint: "Le meilleur de l'indé, juste sorti ou tout proche",
      more: "/explore?gen=32",
      games: indies,
      sub: () => null,
      badge: (g) =>
        g.releaseDate
          ? g.releaseDate > now
            ? `J-${Math.ceil((g.releaseDate - now) / 86400)}`
            : shortDate(g.releaseDate)
          : null,
    },
  ].filter((t) => t.games.length > 0);
  // L'onglet choisi peut avoir disparu entre deux chargements (un rayon qui se
  // vide) : on retombe sur le premier plutôt que sur rien.
  const current = discoverTabs.find((t) => t.key === disc) || discoverTabs[0];

  return (
    <div className="mh">
      {/* --- L'en-tête. Il ne dépend de rien : jamais de squelette ici. --- */}
      <header className="mh-hero">
        <div className="mh-hero-txt">
          <h1 className="mh-hero-title">
            {greeting()} <span className="grad-text">{user?.username}</span>
          </h1>
          <p className="mh-hero-sub">{todayLabel()}</p>
        </div>
        <div className="mh-hero-acts">
          <Link to="/explore" className="mh-pill ghost clickable">
            <Compass size={15} /> Explorer
          </Link>
          <Link to="/explore" className="mh-pill gold solid clickable">
            <Plus size={15} /> Ajouter un jeu
          </Link>
        </div>
      </header>

      {/* ⚠️ DEUX COLONNES, MAIS UN SEUL ORDRE DE LECTURE. Au-dessus de 1360 px,
          `.mh-side` devient une colonne de droite ; en dessous, les deux
          conteneurs passent en `display: contents` et la feuille de style
          remet chaque rayon à sa place dans le fil (cf. app-47-home.css). */}
      {/* --- Le bandeau du haut : ce qu'on joue, sur toute la largeur. --- */}
      <section className="mh-top">
        {library === null ? (
          // Le TITRE ne dépend de rien et s'affiche tel quel ; seules les cartes
          // attendent leur donnée.
          <Section kicker="Tu joues à" title="Tes parties en cours" className="mh-sec-np" snap={false}>
            <SkelRepeat of={SkelNowPlaying} count={3} />
          </Section>
        ) : playing.length > 0 ? (
          <Section
            kicker="Tu joues à"
            title={
              playing.length > 1 ? `${playing.length} parties en cours` : "Ta partie en cours"
            }
            className="mh-sec-np"
          >
            {playing.map((e) => (
              <NowPlayingCard
                key={e.gameId}
                entry={e}
                backdrop={backdrops[String(e.gameId)]}
                busy={busyId === e.gameId}
                onHours={() => setHoursFor(e)}
                onFinish={() => finish(e)}
                onPause={() => patch(e, { status: "paused" })}
                onDrop={() => patch(e, { status: "dropped" })}
                onFavorite={(want) => patch(e, { favorite: want })}
              />
            ))}
          </Section>
        ) : (
          <Link to="/explore" className="mh-empty clickable">
            <span className="mh-empty-ic">
              <Plus size={22} strokeWidth={2.8} />
            </span>
            <span className="mh-empty-txt">
              <b>Aucune partie en cours</b>
              <i>Ajoute un jeu à ta bibliothèque et il s'installera ici.</i>
            </span>
          </Link>
        )}
      </section>

      <div className="mh-col">
        {/* --- Directs et showcases, en tête de colonne ------------------
            Un rendez-vous a une heure : c'est la deuxième chose qu'on vient
            vérifier en ouvrant la page, juste après ce qu'on joue. */}
        {events === null ? (
          <Section
            kicker="Ce qui arrive"
            title="Directs et showcases"
            hint="Les rendez-vous à ne pas manquer"
            className="s-events"
            snap={false}
          >
            <SkelRepeat of={SkelEvent} count={4} />
          </Section>
        ) : (
          sortedEvents.length > 0 && (
            <Section
              kicker="Ce qui arrive"
              title="Directs et showcases"
              hint="Les rendez-vous à ne pas manquer"
              className="s-events"
            >
              {sortedEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  event={ev}
                  now={tick}
                  onToggleInterest={(want) => toggleInterest(ev, want)}
                />
              ))}
            </Section>
          )
        )}

        {/* --- Les dernières conférences ----------------------------------
            ⚠️ JUSTE SOUS LES RENDEZ-VOUS, PARCE QUE C'EST LEUR SUITE. Le rail
            du dessus dit ce qui arrive ; celui-ci dit ce qui est arrivé. */}
        {eventLists === null ? (
          <Section
            kicker="Ce qui a été annoncé"
            title="Les dernières conférences"
            hint="Chaque Direct, chaque showcase, et tous les jeux qu'on y a vus"
            moreTo="/lists"
            moreLabel="Toutes les listes"
            className="s-elists"
            snap={false}
          >
            <SkelRepeat of={SkelEventList} count={5} />
          </Section>
        ) : (
          eventLists.length > 0 && (
            <Section
              kicker="Ce qui a été annoncé"
              title="Les dernières conférences"
              hint="Chaque Direct, chaque showcase, et tous les jeux qu'on y a vus"
              moreTo="/lists"
              moreLabel="Toutes les listes"
              className="s-elists"
            >
              {eventLists.map((l) => (
                <EventListCard key={l.id} list={l} />
              ))}
            </Section>
          )
        )}

        {/* --- Tes envies ------------------------------------------------
            ⚠️ EN HAUT, ET PAS EN BAS AVEC LES RAYONS DE CATALOGUE. C'est une
            liste qu'on a écrite soi-même : elle répond à « bon, je prends quoi
            ensuite ? ». */}
        {library === null ? (
          <Section
            kicker="Tes envies"
            title="Ce que tu veux jouer"
            moreTo="/profile?tab=allgames&st=wishlist"
            moreLabel="Tout voir"
            className="s-wish"
            snap={false}
          >
            <SkelRepeat of={SkelTile} count={8} />
          </Section>
        ) : (
          wanted.length > 0 && (
            <Section
              kicker="Tes envies"
              title="Ce que tu veux jouer"
              hint={`${wanted.length} jeu${wanted.length > 1 ? "x" : ""} de côté`}
              moreTo="/profile?tab=allgames&st=wishlist"
              moreLabel="Tout voir"
              className="s-wish"
            >
              {wanted.map((e) => (
                <GameTile key={e.gameId} game={e} sub={sinceLabel(e.updatedAt)} />
              ))}
            </Section>
          )
        )}

        {/* --- Sorties du jour -------------------------------------------
            Pas de squelette : le rayon est souvent vide (peu de jeux datés au
            jour près), et un titre qui apparaît puis disparaît fait sauter la
            page plus qu'il ne rassure. */}
        {todayOut.length > 0 && (
          <Section
            kicker="Aujourd'hui"
            title="Ça sort maintenant"
            hint="Les sorties du jour, du plus attendu au moins attendu"
            moreTo="/releases"
            moreLabel="Calendrier"
            className="s-today"
          >
            {todayOut.map((g) => (
              <GameTile
                key={g.id}
                game={g}
                sub={g.platforms?.[0] ? platformLabel(g.platforms[0]) : null}
              />
            ))}
          </Section>
        )}

        {/* --- Les plus attendus ----------------------------------------- */}
        {discover === null ? (
          <Section
            kicker="Compte à rebours"
            title="Les plus attendus"
            hint="Mets-les de côté, tu seras prévenu"
            className="s-awaited"
            snap={false}
          >
            <SkelRepeat of={SkelAnticipated} count={4} />
          </Section>
        ) : (
          awaited.length > 0 && (
            <Section
              kicker="Compte à rebours"
              title="Les plus attendus"
              hint="Mets-les de côté, tu seras prévenu"
              className="s-awaited"
            >
              {awaited.map((g) => (
                <AnticipatedCard
                  key={g.id}
                  game={g}
                  backdrop={backdrops[String(g.id)]}
                  now={tick}
                  wished={wishlist.has(String(g.id))}
                  friends={awaitedFaces.get(String(g.id)) || []}
                  onToggleWish={(want) => toggleWish(g, want)}
                />
              ))}
            </Section>
          )
        )}

        {/* ⚠️ À PARTIR D'ICI, PLUS DE SQUELETTES. Ces rayons sont sous la ligne
            de flottaison : personne ne les voit charger, et les annoncer par
            des rectangles gris ne ferait qu'allonger la page d'attente. Ils
            apparaissent quand leur donnée est là. */}

        {/* --- Le placard ------------------------------------------------ */}
        {dusty.length > 0 && (
          <Section
            kicker="Le placard"
            title="Tu les avais commencés"
            hint="Plus touchés depuis un moment"
            className="s-dusty"
          >
            {dusty.map((e) => (
              <GameTile key={e.gameId} game={e} sub={sinceLabel(e.updatedAt)} />
            ))}
          </Section>
        )}

        {/* --- Le monde extérieur ---------------------------------------- */}
        {free?.length > 0 && (
          <Section
            kicker="À récupérer"
            title="Gratuit en ce moment"
            hint={`${free.length} offre${free.length > 1 ? "s" : ""} · Epic · Steam · GOG · Prime…`}
            className="s-free"
          >
            {free.map((g) => (
              <FreeCard key={g.id} game={g} />
            ))}
          </Section>
        )}

        {/* --- Découvrir : trois rayons, un seul rail -------------------
            ⚠️ TROIS RÉPONSES À LA MÊME QUESTION (« je joue à quoi d'autre ? »),
            donc un seul rayon, et on choisit d'où vient la réponse. */}
        {discoverTabs.length > 0 && (
          <section className="mh-sec s-discover">
            <div className="mh-head">
              <div className="mh-head-main">
                <span className="mh-head-text">
                  <span className="mh-kicker">Découvrir</span>
                  <span className="mh-head-title">{current.title}</span>
                  <span className="mh-head-hint">{current.hint}</span>
                </span>
              </div>

              <div className="mh-tabs" role="tablist" aria-label="Découvrir">
                {discoverTabs.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={t.key === current.key}
                    className={`mh-tab clickable ${t.key === current.key ? "on" : ""}`}
                    onClick={() => setDisc(t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <Link to={current.more} className="mh-head-more clickable">
                Explorer <ChevronRight size={15} />
              </Link>
            </div>

            <Rail>
              {current.games.slice(0, 16).map((g) => (
                <GameTile
                  key={g.id}
                  game={g}
                  sub={current.sub(g)}
                  subGold={current.key === "hot" && !!g.rating && g.rating >= 85}
                  badge={current.badge(g)}
                />
              ))}
            </Rail>
          </section>
        )}

        <OstRail token={token} limit={OST_LIMIT} />

        {/* --- Tes derniers terminés -------------------------------------
            ⚠️ LE BAS DE PAGE EST FAIT POUR REGARDER EN ARRIÈRE. */}
        {finished.length > 0 && (
          <Section
            kicker="Derrière toi"
            title="Tes derniers terminés"
            hint="Ce que tu as fini, du plus récent au plus ancien"
            moreTo="/profile?tab=allgames&st=finished"
            moreLabel="Tout voir"
            className="s-done"
          >
            {finished.map((e) => (
              <GameTile key={e.gameId} game={e} sub={sinceLabel(e.finishedAt || e.updatedAt)} />
            ))}
          </Section>
        )}

        {/* --- Tes coups de cœur ----------------------------------------- */}
        {favorites.length > 0 && (
          <Section
            kicker="Ton étagère"
            title="Tes coups de cœur"
            hint="Les jeux que tu as aimés au point de les marquer"
            moreTo="/profile"
            moreLabel="Ton profil"
            className="s-fav"
          >
            {favorites.map((e) => (
              <GameTile
                key={e.gameId}
                game={e}
                sub={e.rating ? `${e.rating} %` : null}
                subGold={!!e.rating && e.rating >= 85}
              />
            ))}
          </Section>
        )}

        {/* --- Parce que tu as adoré … (le fond du rayon) ---------------- */}
        {similar.length > 0 && !!loved && (
          <Section
            kicker="Parce que tu as adoré"
            title={loved.name}
            hint="Des jeux de la même famille"
            cover={loved.cover}
            titleTo={`/game/${loved.gameId}`}
            onRefresh={lovedCount > 1 ? () => setLovedShift((n) => n + 1) : null}
            refreshLabel="Un autre de mes coups de cœur"
            className="s-similar"
          >
            {similar.map((g) => (
              <GameTile
                key={g.id}
                game={g}
                sub={g.rating ? `${g.rating} %` : null}
                subGold={!!g.rating && g.rating >= 85}
              />
            ))}
          </Section>
        )}
      </div>

      {/* ==================================================================
          La colonne de droite : que des ACTIONS
          ==================================================================
          Mot du jour, proposition du soir, documentaire, pépite, arcade, app.
          Les quatre raccourcis du bas ne dépendent de rien : ils s'affichent
          tout de suite, sans squelette. */}
      <aside className="mh-side">
        {/* --- Le rendez-vous du jour ----------------------------------- */}
        {mot === undefined ? <SkelMot /> : mot ? <MotStrip mot={mot} /> : null}

        {/* --- Quoi jouer ce soir --------------------------------------- */}
        {(library === null || !!pick) && (
          <section className="mh-sec s-tonight">
            <div className="mh-head">
              <div className="mh-head-main">
                <span className="mh-head-text">
                  <span className="mh-kicker">Ce soir</span>
                  <span className="mh-head-title">Tu joues à quoi ?</span>
                  <span className="mh-head-hint">Une proposition, tirée de ce qui t'attend</span>
                </span>
              </div>
            </div>
            {library === null ? (
              <SkelTonight />
            ) : (
              <TonightCard
                entry={pick}
                busy={busyId === pick.gameId}
                onStart={() => patch(pick, { status: "playing" })}
                onReroll={() => setReroll((n) => n + 1)}
              />
            )}
          </section>
        )}

        {/* --- Les portes de côté --------------------------------------- */}
        <section className="mh-doors">
          <div className="mh-door doc">
            <button className="mh-door-main clickable" onClick={() => setShowDoc(true)}>
              <span className="mh-door-ic">
                <Clapperboard size={20} />
              </span>
              <span className="mh-door-txt">
                <b>Lancer un documentaire</b>
                <i>Sur les jeux que tu as joués</i>
              </span>
            </button>
            <div className="mh-door-gear" ref={settingsRef}>
              <button
                className={`mh-round small clickable ${showSettings ? "on" : ""}`}
                onClick={() => setShowSettings((v) => !v)}
                aria-label="Réglages du feed documentaire"
                title="Réglages"
              >
                <Settings size={16} />
              </button>
              {showSettings && (
                <div className="doc-settings card">
                  <div className="doc-settings-group">
                    <span className="doc-settings-label">Langue</span>
                    <label className="doc-settings-opt disabled">
                      <span className="doc-check on">
                        <Check size={13} />
                      </span>
                      Français
                    </label>
                    <label
                      className="doc-settings-opt clickable"
                      onClick={() =>
                        savePrefs({
                          ...prefs,
                          lang: prefs.lang.includes("en") ? ["fr"] : ["fr", "en"],
                        })
                      }
                    >
                      <span className={`doc-check ${prefs.lang.includes("en") ? "on" : ""}`}>
                        {prefs.lang.includes("en") && <Check size={13} />}
                      </span>
                      Anglais
                    </label>
                  </div>
                  <div className="doc-settings-group">
                    <span className="doc-settings-label">Jeux</span>
                    <label
                      className="doc-settings-opt clickable"
                      onClick={() => savePrefs({ ...prefs, scope: "played" })}
                    >
                      <span className={`doc-radio ${prefs.scope === "played" ? "on" : ""}`} />
                      Jeux joués uniquement
                    </label>
                    <label
                      className="doc-settings-opt clickable"
                      onClick={() => savePrefs({ ...prefs, scope: "all" })}
                    >
                      <span className={`doc-radio ${prefs.scope === "all" ? "on" : ""}`} />
                      Tous mes jeux
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button className="mh-door gems clickable" onClick={() => setShowGems(true)}>
            <span className="mh-door-ic">
              <Sparkles size={20} />
            </span>
            <span className="mh-door-txt">
              <b>Découvrir une pépite indé</b>
              <i>3 jeux que tu aimes → des pépites sur mesure</i>
            </span>
          </button>

          <Link to="/arcade" className="mh-door arcade clickable">
            <span className="mh-door-ic">
              <Joystick size={20} />
            </span>
            <span className="mh-door-txt">
              <b>Arcade</b>
              <i>Mini-jeux, classements et curseurs</i>
            </span>
            <span className="mh-door-points">
              <Coins size={13} />
              {Number(user?.points || 0).toLocaleString("fr-FR")}
            </span>
          </Link>

          {/* L'app Android n'est dans aucun magasin : cette porte est, avec la
              barre latérale, le seul endroit où un habitué du site apprend
              qu'elle existe. */}
          <Link to="/download" className="mh-door android clickable">
            <span className="mh-door-ic">
              <Smartphone size={20} />
            </span>
            <span className="mh-door-txt">
              <b>App Android</b>
              <i>Ta bibliothèque dans ta poche</i>
            </span>
          </Link>
        </section>
      </aside>

      {!!hoursFor && (
        <HoursModal
          entry={hoursFor}
          onClose={() => setHoursFor(null)}
          onSave={(hours) => {
            const target = hoursFor;
            setHoursFor(null);
            if (target) patch(target, { playtimeHours: hours });
          }}
        />
      )}

      {showDoc && (
        <DocumentaryModal prefs={prefs} token={token} onClose={() => setShowDoc(false)} />
      )}
      {showGems && <DiscoverGemsModal token={token} onClose={() => setShowGems(false)} />}
    </div>
  );
}
