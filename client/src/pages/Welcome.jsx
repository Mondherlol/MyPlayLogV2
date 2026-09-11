import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clapperboard,
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
import Section from "../components/home/Rail";
import NowPlayingCard from "../components/home/NowPlayingCard";
import AnticipatedCard from "../components/home/AnticipatedCard";
import EventCard from "../components/home/EventCard";
import HoursModal from "../components/home/HoursModal";
import OstRail from "../components/home/OstRail";
import RadarStrip from "../components/home/RadarStrip";
import ActivityPeek from "../components/home/ActivityPeek";
import { MotStrip, TonightCard, WeekStrip } from "../components/home/Strips";
import { CircleTile, FreeCard, GameTile } from "../components/home/Tiles";
import { useGameBackdrops } from "../lib/backdrops";
import {
  dustyGames,
  greeting,
  lovedPoolSize,
  lovedSeed,
  nowPlaying,
  sinceLabel,
  todayLabel,
  todayReleasesPath,
  tonightPick,
  weekRecap,
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
  const [circle, setCircle] = useState([]);
  const [today, setToday] = useState([]);
  // Qui, parmi les gens qu'on suit, attend quoi. Une seule requête pour tout le
  // monde, et AUCUN appel IGDB — le serveur ne croise que des listes d'envies.
  const [awaitedBy, setAwaitedBy] = useState([]);
  const [similar, setSimilar] = useState([]);
  const [loading, setLoading] = useState(true);

  // Le jeu dont une écriture est en vol, pour que son bouton dise qu'il
  // travaille au lieu de rester inerte.
  const [busyId, setBusyId] = useState(null);
  const [hoursFor, setHoursFor] = useState(null);
  // Le coup de dé. Il ne change QUE la proposition du soir : le reste de la
  // page n'a aucune raison de bouger parce qu'on cherche quoi lancer.
  const [reroll, setReroll] = useState(0);
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
      apiFetch("/feed/circle", { token }),
      apiFetch("/games/releases/awaited", { token }),
      apiFetch(todayReleasesPath(), { token }),
    ]).then(([lib, disc, fg, m, evs, circ, awa, rel]) => {
      if (!alive) return;
      if (lib.status === "fulfilled") setLibrary(lib.value.entries || []);
      if (disc.status === "fulfilled") setDiscover(disc.value);
      if (fg.status === "fulfilled") setFree(fg.value.games || []);
      if (m.status === "fulfilled") setMot(m.value);
      if (evs.status === "fulfilled") setEvents(evs.value.events || []);
      if (circ.status === "fulfilled") setCircle(circ.value.items || []);
      if (awa.status === "fulfilled") setAwaitedBy(awa.value.games || []);
      if (rel.status === "fulfilled") setToday(rel.value.games || []);
      setLoading(false);
    });

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
  const recap = useMemo(() => weekRecap(library), [library]);
  const owned = useMemo(() => new Set(library.map((e) => String(e.gameId))), [library]);
  const wishlist = useMemo(
    () => new Set(library.filter((e) => e.status === "wishlist").map((e) => String(e.gameId))),
    [library]
  );
  const wishIds = useMemo(() => [...wishlist], [wishlist]);

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

      {/* --- 1. Tes jeux en cours ------------------------------------- */}
      {playing.length > 0 ? (
        <Section
          kicker="Tu joues à"
          title={
            playing.length > 1 ? `${playing.length} parties en cours` : "Ta partie en cours"
          }
          className="mh-sec-np"
          snap
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

      {/* --- 2. Ce qu'on a fait de sa semaine -------------------------- */}
      <WeekStrip recap={recap} />

      {/* --- 3. Ce qui arrive ----------------------------------------- */}
      {sortedEvents.length > 0 && (
        <Section
          kicker="Ce qui arrive"
          title="Directs et showcases"
          hint="Les rendez-vous à ne pas manquer"
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

      {/* --- 4. Sorties du jour --------------------------------------- */}
      {todayOut.length > 0 && (
        <Section
          kicker="Aujourd'hui"
          title="Ça sort maintenant"
          hint="Les sorties du jour, du plus attendu au moins attendu"
          moreTo="/releases"
          moreLabel="Calendrier"
        >
          {todayOut.map((g) => (
            <GameTile key={g.id} game={g} sub={g.platforms?.[0] || null} />
          ))}
        </Section>
      )}

      {/* --- 5. Sur ton radar (mes envies × le calendrier) ------------- */}
      <RadarStrip wishIds={wishIds} token={token} />

      {/* --- 6. Les plus attendus ------------------------------------- */}
      {awaited.length > 0 && (
        <Section
          kicker="Compte à rebours"
          title="Les plus attendus"
          hint="Mets-les de côté, tu seras prévenu"
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

      {/* --- 7. Le rendez-vous du jour -------------------------------- */}
      {!!mot && <MotStrip mot={mot} />}

      {/* --- 8. Quoi jouer ce soir ------------------------------------ */}
      {!!pick && (
        <section className="mh-sec">
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

      {/* --- 9. Le placard -------------------------------------------- */}
      {dusty.length > 0 && (
        <Section
          kicker="Le placard"
          title="Tu les avais commencés"
          hint="Plus touchés depuis un moment"
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
        >
          {free.map((g) => (
            <FreeCard key={g.id} game={g} />
          ))}
        </Section>
      )}

      {/* Le seul rail de l'accueil qui parle de GENS. Il se retire tout seul
          quand on ne suit personne : « ce que jouent tes abonnements » rempli
          d'inconnus serait un mensonge. */}
      {circle.length > 0 && (
        <Section
          kicker="Ton cercle"
          title="Ils y jouent en ce moment"
          hint="Les parties en cours des joueurs que tu suis"
          moreTo="/activity"
          moreLabel="L'activité"
        >
          {circle.slice(0, 14).map((g) => (
            <CircleTile key={g.id} game={g} />
          ))}
        </Section>
      )}

      {hot.length > 0 && (
        <Section
          kicker="En ce moment"
          title="Les jeux du moment"
          moreTo="/explore"
          moreLabel="Explorer"
        >
          {hot.slice(0, 14).map((g) => (
            <GameTile
              key={g.id}
              game={g}
              sub={g.rating ? `${g.rating} %` : null}
              subGold={!!g.rating && g.rating >= 85}
            />
          ))}
        </Section>
      )}

      {forYou.length > 0 && (
        <Section
          kicker="Pour toi"
          title="Ça devrait te plaire"
          hint="Selon les genres de ta bibliothèque"
        >
          {forYou.slice(0, 14).map((g) => (
            <GameTile key={g.id} game={g} sub={g.year ? String(g.year) : null} />
          ))}
        </Section>
      )}

      {indies.length > 0 && (
        <Section
          kicker="Hors des radars"
          title="Sorties indés"
          hint="Le meilleur de l'indé, juste sorti ou tout proche"
          moreTo="/explore?gen=32"
          moreLabel="Explorer"
        >
          {indies.slice(0, 14).map((g) => {
            const soon = g.releaseDate && g.releaseDate > now;
            return (
              <GameTile
                key={g.id}
                game={g}
                badge={
                  g.releaseDate
                    ? soon
                      ? `J-${Math.ceil((g.releaseDate - now) / 86400)}`
                      : shortDate(g.releaseDate)
                    : null
                }
              />
            );
          })}
        </Section>
      )}

      <OstRail token={token} />

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

      {/* --- Les portes de côté ---------------------------------------
          Trois envies qui ne sont pas des jeux à ouvrir : regarder un
          documentaire, se faire sortir une pépite indé, aller jouer à l'arcade.
          Elles vivaient dans la colonne de droite ; elles tiennent très bien en
          une rangée, juste avant le fil. */}
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
      </section>

      {/* --- 12. Et pendant ce temps, les autres ----------------------- */}
      <ActivityPeek token={token} />

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
