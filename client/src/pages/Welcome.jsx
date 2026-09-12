import { platformLabel } from "../lib/platforms";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight,
  Clapperboard,
  Smartphone,
  Compass,
  Joystick,
  Loader2,
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
// ⚠️ CE N'EST PAS UNE VITRINE, C'EST UN POINT DE REPRISE. La version
// précédente ouvrait sur un fil d'actualité — ce que les AUTRES ont fait —
// flanqué d'une colonne de dix widgets de découverte. On ouvrait donc le site
// sur ce qui concerne le moins le joueur qui le lance, et le fil avait entre
// temps gagné sa propre page (l'onglet Activité), où il vit beaucoup mieux :
// avec ses cartes, ses images, ses commentaires et son défilement infini.
//
// La page part maintenant de SA bibliothèque, et descend par cercles
// concentriques — la même progression que l'accueil du téléphone, dont elle
// reprend les rayons un à un :
//
//   1. ce qu'il joue en ce moment, avec les deux gestes du soir (+ des heures,
//      « terminé ») à portée de souris, sans ouvrir de fiche ;
//   2. ce qu'il a fait de sa semaine, en jaquettes ;
//   3. ce qui arrive — Directs et showcases, avec leur compte à rebours ;
//   4. ce qui sort AUJOURD'HUI, du plus attendu au moins attendu ;
//   5. ce qu'il attend déjà, croisé avec le calendrier (« sur ton radar ») ;
//   6. les sorties les plus attendues, avec leur compte à rebours, le signet
//      pour les mettre de côté et les visages de ceux qui les guettent aussi ;
//   7. le mot du jour — le rendez-vous quotidien ;
//   8. « tu joues à quoi ce soir ? », une proposition et un dé ;
//   9. ce qu'il a laissé en plan ;
//  10. le monde extérieur : les jeux offerts, ce que joue son cercle, ceux du
//      moment, ceux qui pourraient lui plaire, l'indé, les OST ;
//  11. « parce que tu as adoré … », la recommandation la plus lointaine de ce
//      qu'on est venu faire, donc l'avant-dernière ;
//  12. et tout en bas, cinq lignes de ce que font les autres, avec le chemin
//      vers le fil complet.
//
// Chaque rayon disparaît quand il n'a rien à dire. Une bibliothèque vide ouvre
// donc sur une invitation à ajouter un jeu, puis sur les rayons publics — et
// l'accueil se remplit à mesure qu'on s'en sert.

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

export default function Welcome() {
  const { user, token } = useAuth();
  const { upsertLocal, removeLocal } = useLibrary();

  const [library, setLibrary] = useState([]);
  const [discover, setDiscover] = useState(null);
  const [free, setFree] = useState([]);
  const [mot, setMot] = useState(null);
  const [events, setEvents] = useState([]);
  const [today, setToday] = useState([]);
  // Qui, parmi les gens qu'on suit, attend quoi. Une seule requête pour tout le
  // monde, et AUCUN appel IGDB — le serveur ne croise que des listes d'envies.
  const [awaitedBy, setAwaitedBy] = useState([]);
  const [similar, setSimilar] = useState([]);
  // Les listes officielles des derniers Directs et showcases : ce qui y a été
  // annoncé, jeu par jeu (cf. GET /lists?scope=events).
  const [eventLists, setEventLists] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Les trois portes de côté, gardées de l'ancienne colonne de droite.
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
  // Les huit sources partent ENSEMBLE. `allSettled` fait qu'un service en panne
  // (IGDB, Gemini) n'efface pas l'accueil entier — son rayon disparaît, le
  // reste s'affiche.
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;

    Promise.allSettled([
      apiFetch("/library", { token }),
      apiFetch("/feed/discover", { token }),
      apiFetch("/free-games", { token }),
      apiFetch("/mot/today", { token }),
      apiFetch(EVENTS_PATH, { token }),
      apiFetch("/games/releases/awaited", { token }),
      apiFetch(todayReleasesPath(), { token }),
    ]).then(([lib, disc, fg, m, evs, awa, rel]) => {
      if (!alive) return;
      if (lib.status === "fulfilled") setLibrary(lib.value.entries || []);
      if (disc.status === "fulfilled") setDiscover(disc.value);
      if (fg.status === "fulfilled") setFree(fg.value.games || []);
      if (m.status === "fulfilled") setMot(m.value);
      if (evs.status === "fulfilled") setEvents(evs.value.events || []);
      if (awa.status === "fulfilled") setAwaitedBy(awa.value.games || []);
      if (rel.status === "fulfilled") setToday(rel.value.games || []);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [token]);

  // Les dernières conférences. À part du grand chargement, et c'est voulu :
  // c'est un rayon de bas de bandeau, il n'a aucune raison de retarder
  // l'affichage des parties en cours.
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    apiFetch("/lists?scope=events&limit=12", { token })
      .then((d) => alive && setEventLists((d.lists || []).slice(0, 12)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

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
  const owned = useMemo(() => new Set(library.map((e) => String(e.gameId))), [library]);
  const wishlist = useMemo(
    () => new Set(library.filter((e) => e.status === "wishlist").map((e) => String(e.gameId))),
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
    return [...events].sort(
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
    for (const row of awaitedBy) map.set(String(row.gameId), row.users || []);
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
  // c'est elle qui porte les jeux voisins selon IGDB, et la demander ici
  // réchauffe au passage la page de ce jeu-là.
  const lovedId = loved?.gameId;
  useEffect(() => {
    if (!lovedId) {
      setSimilar([]);
      return undefined;
    }
    let alive = true;
    apiFetch(`/games/${lovedId}/full`, { token })
      .then((d) => {
        if (alive)
          setSimilar((d?.similar || []).filter((g) => !owned.has(String(g.id))).slice(0, 14));
      })
      .catch(() => {
        // Pas de voisins, pas de rayon : mieux que six cadres vides.
        if (alive) setSimilar([]);
      });
    return () => {
      alive = false;
    };
    // `owned` est volontairement hors dépendances : il change à chaque écriture
    // dans la bibliothèque, et relancer la requête pour retirer une jaquette du
    // rayon coûterait plus que de la laisser jusqu'au prochain passage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lovedId, token]);

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
      setLibrary((prev) => prev.map((e) => (e.gameId === entry.gameId ? next : e)));
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
        setLibrary((prev) => prev.map((e) => (e.gameId === entry.gameId ? entry : e)));
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
          prev.map((e) =>
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
              ...prev.filter((e) => e.gameId !== gameId),
            ]
          : prev.filter((e) => e.gameId !== gameId)
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

  if (loading) {
    return (
      <div className="mh-loading">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

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
      {/* --- L'en-tête. Deux lignes, pas plus : le nom de qui regarde, la date
          du jour, et les deux gestes qu'on vient faire sans avoir rien lu. --- */}
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
          remet chaque rayon à sa place dans le fil (cf. app-47-home.css). Le
          balisage, lui, ne bouge pas : c'est ce qui évite d'avoir deux
          accueils à maintenir. */}
      {/* ⚠️ LE BANDEAU DU HAUT TRAVERSE LES DEUX COLONNES. Ce qu'on est en
          train de jouer est la seule chose pour laquelle on ouvre la page : la
          colonne de droite n'a rien à faire par-dessus, et une rangée qui
          défile n'a pas de sens non plus quand on a deux parties en cours —
          c'est une GRILLE, elle occupe la largeur qu'elle a. */}
      <section className="mh-top">
        {playing.length > 0 ? (
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
            vérifier en ouvrant la page, juste après ce qu'on joue. Il ouvre
            donc la colonne, à côté des actions — le bandeau du dessus reste
            aux seules parties en cours, les seules à mériter toute la
            largeur. */}
      {sortedEvents.length > 0 && (
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
      )}

        {/* --- Les dernières conférences ----------------------------------
            ⚠️ JUSTE SOUS LES RENDEZ-VOUS, PARCE QUE C'EST LEUR SUITE. Le rail
            du dessus dit ce qui arrive ; celui-ci dit ce qui est arrivé — la
            liste de tous les jeux montrés au dernier Direct. Séparés, on
            n'avait jamais les deux sous les yeux. */}
        {eventLists.length > 0 && (
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
        )}

        {/* --- Tes envies ------------------------------------------------
            ⚠️ EN HAUT, ET PAS EN BAS AVEC LES RAYONS DE CATALOGUE. C'est une
            liste qu'on a écrite soi-même : elle a plus de raisons d'être lue
            que n'importe quelle recommandation, et c'est elle qui répond à
            « bon, je prends quoi ensuite ? ». Elle vient donc juste après ce
            qu'on est en train de jouer. */}
        {wanted.length > 0 && (
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
        )}

      {/* --- 4. Sorties du jour --------------------------------------- */}
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
            <GameTile key={g.id} game={g} sub={g.platforms?.[0] ? platformLabel(g.platforms[0]) : null} />
          ))}
        </Section>
      )}

      {/* --- 6. Les plus attendus ------------------------------------- */}
      {awaited.length > 0 && (
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
      )}

      {/* --- 9. Le placard -------------------------------------------- */}
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

      {/* --- 10. Le monde extérieur ----------------------------------- */}
      {free.length > 0 && (
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
          ⚠️ ILS ÉTAIENT TROIS RANGÉES DE JAQUETTES À LA SUITE — « du moment »,
          « pour toi », « indés » —, c'est-à-dire trois fois la même image :
          quarante-deux jaquettes empilées qu'on fait défiler sans les voir. Ce
          sont trois RÉPONSES À LA MÊME QUESTION (« je joue à quoi d'autre ? »),
          donc un seul rayon, et on choisit d'où vient la réponse. Trois écrans
          de défilement en moins, et un rail qu'on regarde vraiment. */}
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

      <OstRail token={token} />

        {/* --- Tes derniers terminés -------------------------------------
            ⚠️ LE BAS DE PAGE EST FAIT POUR REGARDER EN ARRIÈRE. Le haut sert à
            reprendre une partie, le milieu à en trouver une nouvelle ; ici, on
            ne cherche plus rien — on fait défiler ce qu'on a fait, et c'est
            exactement ce qui donne envie de continuer à noter ses jeux. */}
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
              <GameTile
                key={e.gameId}
                game={e}
                sub={sinceLabel(e.finishedAt || e.updatedAt)}
              />
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

      {/* --- 11. Parce que tu as adoré … (le fond du rayon) ------------ */}
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
          La colonne de droite : ce qui se lit d'un coup d'œil
          ==================================================================
          ⚠️ CE N'EST PAS UN DÉBARRAS. Un écran large laissait quatre cents
          pixels de vide de chaque côté pendant que le radar, le mot du jour et
          la proposition du soir descendaient le fil — on les découvrait après
          douze rangées de jaquettes, c'est-à-dire jamais.

          ⚠️ QUE DES ACTIONS. Tout ce qui vient ici est un GESTE à faire —
          jouer au mot du jour, lancer la proposition du soir, un documentaire,
          une pépite, l'arcade, l'app. Ce qui se LIT (le cercle, le fil des
          autres) en est sorti : mélangé aux boutons, on ne savait plus ce qui
          se cliquait et ce qui se regardait. Les rayons de jaquettes, eux,
          restent à gauche. */}
      <aside className="mh-side">
        {/* --- Le rendez-vous du jour ----------------------------------- */}
        {!!mot && <MotStrip mot={mot} />}

        {/* --- Quoi jouer ce soir --------------------------------------- */}
        {!!pick && (
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
            <TonightCard
              entry={pick}
              busy={busyId === pick.gameId}
              onStart={() => patch(pick, { status: "playing" })}
              onReroll={() => setReroll((n) => n + 1)}
            />
          </section>
        )}

        {/* --- Les portes de côté ---------------------------------------
            Trois envies qui ne sont pas des jeux à ouvrir : regarder un
            documentaire, se faire sortir une pépite indé, aller jouer à
            l'arcade. */}
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
            qu'elle existe. Elle a sa place parmi les actions — c'est un geste,
            pas une information. */}
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
