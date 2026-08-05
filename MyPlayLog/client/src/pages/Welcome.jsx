import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clapperboard,
  Settings,
  Check,
  Flame,
  CalendarDays,
  CalendarClock,
  Gift,
  Radar,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Gamepad2,
  Music2,
  Joystick,
  Coins,
  Clock,
  Compass,
  ExternalLink,
  Rss,
  Sprout,
  Disc3,
  Play,
  Pause,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { useClickOutside } from "../hooks/useClickOutside";
import useFollowingRail from "../hooks/useFollowingRail";
import useMediaQuery from "../hooks/useMediaQuery";
import { useTabSwipe } from "../hooks/useTabSwipe";
import { apiFetch } from "../lib/api";
import { extractVideoId } from "../lib/youtube";
import DocumentaryModal from "../components/DocumentaryModal";
import DiscoverGemsModal, { GEMS_RESUME_KEY } from "../components/DiscoverGemsModal";
import HomeFeed, { FeedUserFilter } from "../components/HomeFeed";
import { STORE_COLORS, freeEndsLabel } from "../components/FreeGameBanner";

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

// Sous ce seuil, la page n'a plus qu'une colonne : le rail de découverte
// passerait SOUS le fil, donc hors de portée (le fil est infini, et chaque
// paquet chargé le repoussait plus bas). On bascule alors en deux onglets.
// Même valeur que la bascule une colonne du CSS (app-06-home.css) : les deux
// doivent changer ensemble.
const COMPACT_QUERY = "(max-width: 1240px)";

// "12 juil." — date courte FR pour les sorties.
function shortDate(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export default function Welcome() {
  const { user, token } = useAuth();
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showDoc, setShowDoc] = useState(false);
  // Rouvre le deck de pépites là où on l'avait laissé si on revient d'une
  // fiche de jeu ouverte depuis le deck (état sauvé en sessionStorage).
  const [showGems, setShowGems] = useState(
    () => !!sessionStorage.getItem(GEMS_RESUME_KEY)
  );
  const [showSettings, setShowSettings] = useState(false);
  const [discover, setDiscover] = useState(null);
  // Filtre du fil : id du joueur suivi dont on veut voir l'activité (null = tous).
  const [feedUser, setFeedUser] = useState(null);
  const settingsRef = useRef(null);
  const railRef = useFollowingRail();
  useClickOutside(settingsRef, () => setShowSettings(false), showSettings);

  // --- Une colonne = deux onglets ---
  // Les deux panneaux restent MONTÉS (le CSS n'en cache qu'un) : revenir sur le
  // fil ne relance ni sa requête ni sa pagination. On mémorise en revanche la
  // position de défilement de chacun, sinon on retomberait au hasard dans un
  // fil dont la hauteur a été rétablie entre-temps.
  const compact = useMediaQuery(COMPACT_QUERY);
  const [tab, setTab] = useState("feed");
  const scrollMemo = useRef({ feed: 0, discover: 0 });
  // Restaurer la position n'a de sens qu'après un VRAI changement d'onglet :
  // au montage, on laisse la page où le navigateur l'a mise.
  const switched = useRef(false);

  const pickTab = useCallback((next) => {
    setTab((cur) => {
      if (cur === next) return cur;
      scrollMemo.current[cur] = window.scrollY;
      switched.current = true;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!compact || !switched.current) return;
    switched.current = false;
    // Le panneau qui réapparaît (fil virtualisé) ne retrouve sa hauteur qu'au
    // passage de layout suivant : restaurer tout de suite serait borné à zéro.
    const id = requestAnimationFrame(() =>
      window.scrollTo(0, scrollMemo.current[tab] || 0)
    );
    return () => cancelAnimationFrame(id);
  }, [tab, compact]);

  // Swipe horizontal entre les deux onglets (le hook ignore déjà les gestes
  // partis d'un carrousel ou d'une modale).
  const swipe = useTabSwipe({
    onNext: () => pickTab("discover"),
    onPrev: () => pickTab("feed"),
  });

  // Le CTA « Chercher mes pépites aussi » des cartes du fil ouvre la modale.
  useEffect(() => {
    const open = () => setShowGems(true);
    window.addEventListener("mpl:open-gems", open);
    return () => window.removeEventListener("mpl:open-gems", open);
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch("/feed/discover", { token })
      .then((d) => alive && setDiscover(d))
      .catch(() => alive && setDiscover({ hot: [], upcoming: [], forYou: [] }));
    return () => {
      alive = false;
    };
  }, [token]);

  function savePrefs(next) {
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  function toggleEn() {
    const hasEn = prefs.lang.includes("en");
    savePrefs({ ...prefs, lang: hasEn ? ["fr"] : ["fr", "en"] });
  }

  const panelProps = (name) =>
    compact
      ? { role: "tabpanel", id: `hf-panel-${name}`, "aria-labelledby": `hf-tab-${name}` }
      : {};

  return (
    // `data-tab` pilote l'affichage des deux panneaux : sous 1240 px le CSS en
    // masque un, au-dessus il les remet côte à côte et l'attribut ne sert plus.
    <div className="home" data-tab={tab} {...(compact ? swipe : null)}>
      {/* Colonne de gauche : le salut coiffe les deux onglets, donc il vit ici
          plutôt que dans le panneau du fil. Ce regroupement est aussi ce qui
          garde la grille sur UNE ligne (voir app-06-home.css). */}
      <div className="home-col">
        {/* --- En-tête : juste le salut. Points, mini-jeux, classements et
            curseurs vivent désormais sur la page /arcade. --- */}
        <header className="hf-hero">
          <div className="hf-hello">
            <h1 className="hf-hello-title">
              Salut <span className="grad-text">{user?.username}</span>
            </h1>
            <p className="hf-hello-sub">
              Voici ce qui se passe sur ton radar à jeux.
            </p>
          </div>
        </header>

        {compact && (
          <nav className="hf-tabs" role="tablist" aria-label="Sections de l'accueil">
            <span className="hf-tabs-ink" aria-hidden="true" />
            <button
              id="hf-tab-feed"
              className={`hf-tab clickable ${tab === "feed" ? "on" : ""}`}
              role="tab"
              aria-selected={tab === "feed"}
              aria-controls="hf-panel-feed"
              onClick={() => pickTab("feed")}
            >
              <Rss size={15} /> Fil
            </button>
            <button
              id="hf-tab-discover"
              className={`hf-tab clickable ${tab === "discover" ? "on" : ""}`}
              role="tab"
              aria-selected={tab === "discover"}
              aria-controls="hf-panel-discover"
              onClick={() => pickTab("discover")}
            >
              <Compass size={15} /> Découvrir
            </button>
          </nav>
        )}

        <div className="home-main" {...panelProps("feed")}>
          {/* --- Fil d'actualité --- */}
          <section className="hf-sec">
            <div className="hf-sec-head">
              <h2 className="hf-sec-title">
                <Sparkles size={17} /> Fil d'actualité
              </h2>
              {/* Avatars des joueurs suivis : filtre le fil sur un seul joueur */}
              <FeedUserFilter
                token={token}
                myId={user?.id}
                value={feedUser}
                onChange={setFeedUser}
              />
            </div>
            <HomeFeed token={token} me={user?.username} filterUser={feedUser} />
          </section>
        </div>
      </div>

      {/* --- Rail de droite : classement en tête, puis découverte ---
          Suit le scroll de la page et se fige sur son dernier widget
          (voir useFollowingRail). En une colonne, c'est l'onglet Découvrir. */}
      <div className="home-aside" {...panelProps("discover")}>
        <div className="hf-rail" ref={railRef}>
          {/* Porte d'entrée de l'arcade : le solde et un lien, rien de plus —
              les classements et la collection vivent sur /arcade. */}
          <ArcadeTeaser points={user?.points} />

          {/* Documentaire : juste sous le classement, avec ses réglages. */}
          <div className="doc-cta">
            <button className="doc-cta-btn clickable" onClick={() => setShowDoc(true)}>
              <Clapperboard size={19} /> Lancer un documentaire
            </button>
            <div className="doc-cta-settings" ref={settingsRef}>
              <button
                className={`doc-cta-gear clickable ${showSettings ? "active" : ""}`}
                onClick={() => setShowSettings((v) => !v)}
                aria-label="Réglages du feed"
                title="Réglages"
              >
                <Settings size={18} />
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
                    <label className="doc-settings-opt clickable" onClick={toggleEn}>
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

          {/* Radar wishlist : jeux voulus déjà sortis / sorties imminentes */}
          <WishlistRadar token={token} />

          <FreeGamesWidget token={token} />
          <UpcomingWidget games={discover?.upcoming} loading={discover === null} />
          <HotGamesWidget games={discover?.hot} loading={discover === null} />

          {/* La pépite indé ouvre le deck : juste avant « Pour toi », les deux
              répondent à la même envie (« qu'est-ce que je joue ensuite ? »). */}
          <button
            className="hf-gems-btn rail clickable"
            onClick={() => setShowGems(true)}
            title="3 jeux que tu aimes → des pépites indés sur mesure"
          >
            <Sparkles size={18} /> Découvrir une pépite indé
          </button>

          <ForYouWidget games={discover?.forYou} loading={discover === null} />
          <IndieReleasesWidget games={discover?.indies} loading={discover === null} />
          <RecentOstWidget token={token} />
        </div>
      </div>

      {showDoc && (
        <DocumentaryModal prefs={prefs} token={token} onClose={() => setShowDoc(false)} />
      )}
      {showGems && (
        <DiscoverGemsModal token={token} onClose={() => setShowGems(false)} />
      )}
    </div>
  );
}

// Tous les blocs du rail sont mémoïsés : ils ne dépendent que de props stables
// (jeton, listes figées une fois chargées), alors que la page, elle, se re-rend
// à chaque bascule d'onglet ou changement de filtre du fil. Sans ça, chaque
// clic repeignait les dix widgets de découverte pour rien.

// Widget « Jeux du moment » : les sorties chaudes, en jaquettes cliquables —
// même grille sobre que « Pour toi » (pas de bouton d'ajout : dans un rail de
// découverte, on veut ouvrir la fiche, pas remplir sa biblio en un clic).
const HotGamesWidget = memo(function HotGamesWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "55%" }} />
        <div className="hf-fy-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="gp-skel hf-fy-skel" />
          ))}
        </div>
      </div>
    );
  }
  if (!games?.length) return null;
  return (
    <div className="hf-widget card">
      <div className="hf-w-head">
        <h3 className="hf-w-title">
          <Flame size={15} /> Jeux du moment
        </h3>
        <Link to="/explore" className="hf-sec-link clickable">
          Explorer <ChevronRight size={14} />
        </Link>
      </div>
      <div className="hf-fy-grid">
        {games.slice(0, 6).map((g) => (
          <Link
            key={g.id}
            to={`/game/${g.id}`}
            className="hf-fy-item clickable"
            title={g.name}
          >
            {g.cover ? (
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-fy-ph">
                <Gamepad2 size={16} />
              </span>
            )}
            <span className="hf-fy-name">{g.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
});

// Widget « Sorties indés » : les meilleurs jeux indépendants tout juste sortis
// ET ceux qui arrivent (genre IGDB « Indie », voir fetchIndies côté serveur).
// Chaque jaquette porte une pastille : compte à rebours pour l'à-venir, date
// courte pour ce qui vient de sortir.
const IndieReleasesWidget = memo(function IndieReleasesWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "50%" }} />
        <div className="hf-fy-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="gp-skel hf-fy-skel" />
          ))}
        </div>
      </div>
    );
  }
  if (!games?.length) return null;
  const now = Date.now() / 1000;
  return (
    <div className="hf-widget card">
      <div className="hf-w-head">
        <h3 className="hf-w-title">
          <Sprout size={15} /> Sorties indés
        </h3>
        <Link to="/explore?gen=32" className="hf-sec-link clickable">
          Explorer <ChevronRight size={14} />
        </Link>
      </div>
      <p className="hf-w-sub">Le meilleur de l'indé, juste sorti ou tout proche</p>
      <div className="hf-fy-grid">
        {games.slice(0, 6).map((g) => {
          const soon = g.releaseDate && g.releaseDate > now;
          const days = soon ? Math.ceil((g.releaseDate - now) / 86400) : 0;
          return (
            <Link
              key={g.id}
              to={`/game/${g.id}`}
              className="hf-fy-item clickable"
              title={g.name}
            >
              {g.cover ? (
                <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
              ) : (
                <span className="hf-fy-ph">
                  <Gamepad2 size={16} />
                </span>
              )}
              {g.releaseDate && (
                <span className={`hf-indie-tag ${soon ? "soon" : ""}`}>
                  {soon ? `J-${days}` : shortDate(g.releaseDate)}
                </span>
              )}
              <span className="hf-fy-name">{g.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
});

// Widget « Coups de cœur OST » : les dernières bandes-son mises en favori par
// N'IMPORTE QUEL joueur. On reprend telles quelles les cards pochette + CD de
// l'onglet OST du profil (classes .pfo-*) — le CD sort au survol et tourne à
// la lecture, pilotée par le mini-lecteur global.
const RecentOstWidget = memo(function RecentOstWidget({ token }) {
  const [items, setItems] = useState(null);
  const player = usePlayer();

  useEffect(() => {
    let alive = true;
    apiFetch("/ost/recent?limit=4", { token })
      .then((d) => alive && setItems(d.items || []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [token]);

  if (items !== null && items.length === 0) return null;

  // Une piste n'est jouable que si on sait en tirer une vidéo YouTube.
  const playable = (t) => !!(t?.videoId || extractVideoId(t?.url || ""));
  // La file de lecture = les OST affichées, chacune enrichie de son jeu (le
  // mini-lecteur en a besoin pour son lien « voir la fiche »).
  const withGame = (i) => ({ ...i.ost, gameId: i.gameId, gameName: i.gameName });

  return (
    <div className="hf-widget card hf-ost">
      <div className="hf-w-head">
        <h3 className="hf-w-title">
          <Disc3 size={15} /> Coups de cœur OST
        </h3>
      </div>
      <p className="hf-w-sub">Les dernières bandes-son adoubées par la communauté</p>

      {items === null ? (
        <div className="pfo-grid" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="gp-skel hf-ost-skel" />
          ))}
        </div>
      ) : (
        <div className="pfo-grid">
          {items.map((item) => {
            const t = item.ost;
            const playing = player.isPlaying(t);
            const canPlay = playable(t);
            return (
              <div key={item.gameId} className={`pfo-card ${playing ? "playing" : ""}`}>
                <div className="pfo-sleeve">
                  <div className="pfo-cd">
                    <div className="pfo-disc">
                      <span className="pfo-disc-label">
                        {t.artwork ? (
                          <img src={t.artwork} alt="" loading="lazy" draggable="false" />
                        ) : (
                          <Music2 size={18} />
                        )}
                        <span className="pfo-disc-hole" />
                      </span>
                    </div>
                  </div>

                  <div className="pfo-album">
                    {item.cover ? (
                      <img
                        src={item.cover}
                        alt={item.gameName}
                        loading="lazy"
                        draggable="false"
                      />
                    ) : (
                      <span className="pfo-album-ph">{item.gameName?.[0] || "?"}</span>
                    )}
                    <span className="pfo-album-mouth" />
                  </div>

                  <button
                    className={`pfo-play clickable ${canPlay ? "" : "mute"}`}
                    onClick={
                      canPlay
                        ? () => player.toggleTrack(t, items.map(withGame), {})
                        : undefined
                    }
                    disabled={!canPlay}
                    title={
                      canPlay ? (playing ? "Pause" : "Écouter") : "Extrait indisponible"
                    }
                  >
                    {playing ? (
                      <Pause size={18} />
                    ) : (
                      <Play size={18} fill="currentColor" strokeWidth={0} />
                    )}
                  </button>
                </div>

                <div className="pfo-body">
                  <span className="pfo-name" title={t.name}>
                    {t.name}
                  </span>
                  {t.artist && (
                    <span className="pfo-artist" title={t.artist}>
                      {t.artist}
                    </span>
                  )}
                  <div className="pfo-foot">
                    <Link
                      to={`/game/${item.gameId}`}
                      className="pfo-game clickable"
                      title={item.gameName}
                    >
                      <Disc3 size={13} />
                      <span className="pfo-game-name">{item.gameName}</span>
                    </Link>
                    {/* Qui l'a mise en favori — le clin d'œil « communauté ». */}
                    <Link
                      to={`/u/${item.user.username}?tab=ost`}
                      className="hf-ost-by clickable"
                      title={`Choisie par ${item.user.username}`}
                    >
                      {item.user.avatar ? (
                        <img src={item.user.avatar} alt="" loading="lazy" />
                      ) : (
                        <span className="hf-ost-by-fb">
                          {item.user.username[0].toUpperCase()}
                        </span>
                      )}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// --- Radar wishlist ---
// Croise la liste « à jouer » avec les dates de sortie IGDB : les jeux voulus
// sortis ces 30 derniers jours (toujours pas lancés) et ceux qui sortent dans
// les 30 jours, affichés en cards directement — avec un compte à rebours en
// direct pour la sortie la plus proche. Masqué si rien à signaler.
const RADAR_WINDOW = 30 * 86400; // fenêtre (secondes) avant/après aujourd'hui

// « il y a 5 j » — recul depuis la sortie d'un jeu déjà dispo.
function agoDays(ts) {
  const d = Math.max(0, Math.floor((Date.now() - ts * 1000) / 86400000));
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "hier";
  return `il y a ${d} j`;
}

// Compte à rebours en direct (décrémente chaque seconde) jusqu'à un timestamp
// unix : « J-13 · 07:42:19 », puis « 07:42:19 » le jour J.
function LiveCountdown({ ts }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  let left = Math.max(0, Math.floor(ts - Date.now() / 1000));
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const two = (n) => String(n).padStart(2, "0");
  const clock = `${two(Math.floor(left / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
  return (
    <span className="hf-up-date hf-cd" title="Temps restant avant la sortie">
      {days > 0 ? `J-${days} · ${clock}` : clock}
    </span>
  );
}

const WishlistRadar = memo(function WishlistRadar({ token }) {
  const [radar, setRadar] = useState(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    // 1) ids de la wishlist → 2) dates de sortie (fenêtre : -30 j → futur).
    apiFetch("/library?status=wishlist", { token })
      .then((d) => {
        const ids = (d.entries || []).map((e) => e.gameId);
        if (!ids.length) return null;
        const from = Math.floor(Date.now() / 1000) - RADAR_WINDOW;
        return apiFetch(`/games/releases?ids=${ids.join(",")}&from=${from}`, { token });
      })
      .then((d) => {
        if (!alive || !d) return;
        const now = Math.floor(Date.now() / 1000);
        const soon = [];
        const out = [];
        for (const g of d.games || []) {
          if (!g.releaseDate) continue;
          if (g.releaseDate <= now) out.push(g);
          else if (g.releaseDate <= now + RADAR_WINDOW) soon.push(g);
        }
        soon.sort((a, b) => a.releaseDate - b.releaseDate);
        out.sort((a, b) => b.releaseDate - a.releaseDate);
        setRadar({ soon, out });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  if (!radar || (!radar.soon.length && !radar.out.length)) return null;
  const { soon, out } = radar;

  return (
    <div className="hf-widget card hf-radar">
      <h3 className="hf-w-title">
        <Radar size={15} /> Sur ton radar
      </h3>

      {out.length > 0 && (
        <>
          <p className="hf-radar-sec gold">
            <Gift size={12} /> Déjà dispo — toujours pas lancé…
          </p>
          <ul className="hf-up-list">
            {out.slice(0, 3).map((g) => (
              <li key={g.id}>
                <Link to={`/game/${g.id}`} className="hf-up-row clickable" title={g.name}>
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="hf-up-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="hf-up-info">
                    <span className="hf-up-name">{g.name}</span>
                    <span className="hf-radar-ago">sorti {agoDays(g.releaseDate)}</span>
                  </span>
                  <span className="hf-up-date hf-radar-out">Dispo !</span>
                </Link>
              </li>
            ))}
          </ul>
          {out.length > 3 && (
            <Link to="/profile?tab=allgames&st=wishlist" className="hf-radar-more clickable">
              +{out.length - 3} autre{out.length - 3 > 1 ? "s" : ""} dans ta wishlist
            </Link>
          )}
        </>
      )}

      {soon.length > 0 && (
        <>
          <p className="hf-radar-sec">
            <CalendarClock size={12} /> Sorties imminentes
          </p>
          <ul className="hf-up-list">
            {soon.slice(0, 4).map((g, i) => (
              <li key={g.id}>
                <Link to={`/game/${g.id}`} className="hf-up-row clickable" title={g.name}>
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="hf-up-ph">
                      <Gamepad2 size={14} />
                    </span>
                  )}
                  <span className="hf-up-info">
                    <span className="hf-up-name">{g.name}</span>
                    <span className="hf-radar-ago">{shortDate(g.releaseDate)}</span>
                  </span>
                  {/* La plus proche : compte à rebours en direct ; les autres : J-x */}
                  {i === 0 ? (
                    <LiveCountdown ts={g.releaseDate} />
                  ) : (
                    <span className="hf-up-date">
                      J-{Math.ceil((g.releaseDate * 1000 - Date.now()) / 86400000)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link to="/releases?wish=1" className="hf-w-more clickable">
        Calendrier des sorties <ChevronRight size={14} />
      </Link>
    </div>
  );
});

// --- Jeux gratuits de la semaine ---
// Giveaways de jeux à récupérer (Epic, Steam, GOG, Prime…), agrégés côté
// serveur depuis GamerPower (/free-games). Carrousel horizontal de cards
// paysage : image du magasin, pastille de la boutique, prix barré + « Gratuit »
// et le temps restant avant la fin de l'offre. Section masquée si rien en cours.

function FreeGameCard({ game }) {
  const ends = freeEndsLabel(game.endsAt);
  const color = STORE_COLORS[game.store.slug] || STORE_COLORS.pc;
  // Le serveur rattache le giveaway à sa fiche IGDB quand il reconnaît le
  // titre : on reste alors sur le site (la page du jeu affiche une banderole
  // flottante pour aller le récupérer). Sinon, lien direct vers l'offre.
  const inside = !!game.gameId;
  const body = (
    <>
      <div className="hf-free-thumb">
        {game.image ? (
          <img src={game.image} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="hf-free-noimg">
            <Gamepad2 size={24} />
          </span>
        )}
        <span className="hf-free-store" style={{ background: color }}>
          {game.store.label}
        </span>
        {ends && (
          <span className={`hf-free-ends ${ends.urgent ? "urgent" : ""}`}>
            <Clock size={11} /> {ends.text}
          </span>
        )}
        <span className="hf-free-get">
          {inside ? (
            <>
              <Gamepad2 size={14} /> Voir la fiche
            </>
          ) : (
            <>
              <ExternalLink size={14} /> Récupérer
            </>
          )}
        </span>
      </div>
      <div className="hf-free-body">
        <span className="hf-free-title">{game.title}</span>
        <span className="hf-free-meta">
          {game.worth && <span className="hf-free-was">{game.worth}</span>}
          <span className="hf-free-free">
            <Gift size={12} /> Gratuit
          </span>
        </span>
      </div>
    </>
  );

  const title = `${game.title} — gratuit sur ${game.store.label}`;
  return inside ? (
    <Link className="hf-free-card clickable" to={`/game/${game.gameId}`} title={title}>
      {body}
    </Link>
  ) : (
    <a
      className="hf-free-card clickable"
      href={game.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
    >
      {body}
    </a>
  );
}

const FreeGamesWidget = memo(function FreeGamesWidget({ token }) {
  const [games, setGames] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/free-games", { token })
      .then((d) => alive && setGames(d.games || []))
      .catch(() => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, [token]);

  // Rien en cours (ou API en carafe) : on masque tout le widget.
  if (games !== null && games.length === 0) return null;

  return (
    <div className="hf-widget card hf-free-w">
      <div className="hf-w-head">
        <h3 className="hf-w-title">
          <Gift size={15} /> Jeux gratuits à récupérer
        </h3>
      </div>
      <p className="hf-w-sub">Epic · Steam · GOG · Prime…</p>
      {games === null ? (
        <div className="hf-carousel" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="gp-skel hf-free-skel" />
          ))}
        </div>
      ) : (
        <DragCarousel>
          {games.map((g) => (
            <div className="hf-free-item" key={g.id}>
              <FreeGameCard game={g} />
            </div>
          ))}
        </DragCarousel>
      )}
    </div>
  );
});

// Porte d'entrée de l'arcade dans le rail : le solde et un lien. Tout le
// reste (mini-jeux, classements, caisses, curseurs) vit sur la page /arcade —
// l'accueil est un fil d'actualité, pas une salle de jeux.
const ArcadeTeaser = memo(function ArcadeTeaser({ points }) {
  return (
    <Link to="/arcade" className="hf-arcade clickable">
      <span className="hf-arcade-ic">
        <Joystick size={20} />
      </span>
      <span className="hf-arcade-body">
        <span className="hf-arcade-title">Arcade</span>
        <span className="hf-arcade-sub">Mini-jeux, classements et curseurs</span>
      </span>
      <span className="hf-arcade-points">
        <Coins size={13} />
        {Number(points || 0).toLocaleString("fr-FR")}
      </span>
    </Link>
  );
});

// Carrousel horizontal : drag à la souris + flèches gauche/droite.
// Le tactile scrolle nativement ; à la souris on translate le scroll et on
// avale le clic qui suit un drag pour ne pas ouvrir une fiche jeu par erreur.
function DragCarousel({ children }) {
  const ref = useRef(null);
  const drag = useRef({ down: false, startX: 0, left: 0, moved: false });
  const [dragging, setDragging] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  function onDown(e) {
    drag.current = {
      down: true,
      startX: e.pageX,
      left: ref.current.scrollLeft,
      moved: false,
    };
  }

  function onMove(e) {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.pageX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) {
      e.preventDefault();
      ref.current.scrollLeft = d.left - dx;
    }
  }

  function onUp() {
    drag.current.down = false;
    setDragging(false);
  }

  // Après un drag, le mouseup génère quand même un click sur la carte
  // survolée : on l'intercepte en phase de capture.
  function onClickCapture(e) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }

  const nudge = (dir) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.75,
      behavior: "smooth",
    });

  return (
    <div className="hf-carousel-wrap">
      <button
        className={`hf-car-arrow left clickable ${canLeft ? "" : "off"}`}
        onClick={() => nudge(-1)}
        aria-label="Défiler vers la gauche"
        tabIndex={canLeft ? 0 : -1}
      >
        <ChevronLeft size={20} />
      </button>
      <div
        className={`hf-carousel ${dragging ? "dragging" : ""}`}
        ref={ref}
        onScroll={update}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
      <button
        className={`hf-car-arrow right clickable ${canRight ? "" : "off"}`}
        onClick={() => nudge(1)}
        aria-label="Défiler vers la droite"
        tabIndex={canRight ? 0 : -1}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

// Widget « Prochaines sorties » : les sorties les plus attendues, par date.
const UpcomingWidget = memo(function UpcomingWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "60%" }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="hf-up-row">
            <span className="gp-skel" style={{ width: 38, height: 50, borderRadius: 8 }} />
            <div style={{ flex: 1, display: "grid", gap: 6 }}>
              <span className="gp-skel gp-skel-bar" style={{ width: "80%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "35%" }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!games?.length) return null;
  return (
    <div className="hf-widget card">
      <h3 className="hf-w-title">
        <CalendarDays size={15} /> Sorties à venir
      </h3>
      <ul className="hf-up-list">
        {games.slice(0, 6).map((g) => (
          <li key={g.id}>
            <Link to={`/game/${g.id}`} className="hf-up-row clickable" title={g.name}>
              {g.cover ? (
                <img src={g.cover} alt="" loading="lazy" draggable="false" />
              ) : (
                <span className="hf-up-ph">
                  <Gamepad2 size={14} />
                </span>
              )}
              <span className="hf-up-info">
                <span className="hf-up-name">{g.name}</span>
                <span className="hf-up-meta">
                  {g.hypes > 0 && (
                    <i className="hf-up-hype">
                      <Flame size={11} /> {g.hypes}
                    </i>
                  )}
                </span>
              </span>
              <span className="hf-up-date">{shortDate(g.releaseDate)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/releases" className="hf-w-more clickable">
        Calendrier des sorties <ChevronRight size={14} />
      </Link>
    </div>
  );
});

// Widget « Pour toi » : suggestions selon les genres de la bibliothèque.
const ForYouWidget = memo(function ForYouWidget({ games, loading }) {
  if (loading) {
    return (
      <div className="hf-widget card" aria-busy="true">
        <span className="gp-skel gp-skel-bar" style={{ width: "50%" }} />
        <div className="hf-fy-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="gp-skel hf-fy-skel" />
          ))}
        </div>
      </div>
    );
  }
  if (!games?.length) return null;
  return (
    <div className="hf-widget card">
      <h3 className="hf-w-title">
        <Sparkles size={15} /> Pour toi
      </h3>
      <p className="hf-w-sub">Selon les genres de ta bibliothèque</p>
      <div className="hf-fy-grid">
        {games.slice(0, 6).map((g) => (
          <Link
            key={g.id}
            to={`/game/${g.id}`}
            className="hf-fy-item clickable"
            title={g.name}
          >
            {g.cover ? (
              <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
            ) : (
              <span className="hf-fy-ph">
                <Gamepad2 size={16} />
              </span>
            )}
            <span className="hf-fy-name">{g.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
});
