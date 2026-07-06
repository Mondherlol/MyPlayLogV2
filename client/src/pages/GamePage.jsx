import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  Gamepad,
  ListPlus,
  Loader2,
  AlertTriangle,
  Star,
  Info,
  MessageSquareText,
  Trophy,
  Music,
  Users,
  Flame,
  Calendar,
  Building2,
  Cpu,
  Layers,
  Clock,
  Play,
  Plus,
  X,
  ImageOff,
  ExternalLink,
  Languages,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  UserRound,
  Check,
  Send,
  Lock,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import ScrollRow from "../components/ScrollRow";
import PlayedModal from "../components/PlayedModal";
import GameReviews from "../components/GameReviews";
import RecommendModal from "../components/RecommendModal";
import GameCharacters from "../components/GameCharacters";
import GameOst from "../components/GameOst";
import GameFeed from "../components/GameFeed";

const FRIEND_GROUPS = [
  { key: "played", label: "Y ont joué", match: (s) => s !== "wishlist" },
  { key: "wishlist", label: "Veulent y jouer", match: (s) => s === "wishlist" },
];

const PLAYED = ["playing", "finished", "paused", "dropped"];

// Détails complets du jeu (infos IGDB, médias, similaires…) : statiques → cache
// mémoire + localStorage 24h pour rouvrir la page instantanément.
const gameCache = makeCache("mpl_gamefull_", 24 * 60 * 60 * 1000);

// Trophées/succès : cache mémoire + localStorage. Évite de refaire l'appel API
// quand on quitte l'onglet Trophées puis qu'on y revient (TTL 30 min).
const achCache = makeCache("mpl_ach_", 30 * 60 * 1000);
const psnCache = makeCache("mpl_psn_", 30 * 60 * 1000);

const TABS = [
  { id: "infos", label: "Infos", Icon: Info, ready: true },
  { id: "feed", label: "Feed", Icon: Flame, ready: true },
  { id: "reviews", label: "Reviews", Icon: MessageSquareText, ready: true },
  { id: "trophies", label: "Trophées", Icon: Trophy, ready: true },
  { id: "ost", label: "OST", Icon: Music, ready: true },
  { id: "characters", label: "Personnages", Icon: Users, ready: true },
];

const TROPHY_TABS = [
  { id: "steam", label: "Succès Steam" },
  { id: "psn", label: "Trophées PSN" },
];

const WEBSITE_LABELS = {
  official: "Site officiel",
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  itch: "itch.io",
  youtube: "YouTube",
  twitch: "Twitch",
  twitter: "X / Twitter",
  reddit: "Reddit",
  discord: "Discord",
  wikipedia: "Wikipédia",
};

const MEDIA_LABELS = {
  video: "Bande-annonce",
  artwork: "Artwork",
  screenshot: "Capture d'écran",
};

function gaugeColor(v) {
  return v < 40 ? "#e0483f" : v < 70 ? "#f2b70b" : "#22a35a";
}

function bgKey(id) {
  return `mpl_bg_${id}`;
}

// Jauge circulaire (note en %)
function Gauge({ value, label, sub }) {
  const R = 25;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, value));
  const off = C * (1 - pct / 100);
  const color = gaugeColor(value);
  return (
    <div className="gp-gauge" title={label}>
      <div className="gp-gauge-vis">
        <svg viewBox="0 0 60 60" className="gp-gauge-svg">
          <circle cx="30" cy="30" r={R} className="gp-gauge-track" />
          <circle
            cx="30"
            cy="30"
            r={R}
            className="gp-gauge-arc"
            stroke={color}
            strokeDasharray={C}
            strokeDashoffset={off}
          />
        </svg>
        <span className="gp-gauge-num" style={{ color }}>
          {Math.round(value)}
        </span>
      </div>
      <span className="gp-gauge-label">{label}</span>
      {sub != null && <span className="gp-gauge-sub">{sub}</span>}
    </div>
  );
}

export default function GamePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, updateUser } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();

  const [game, setGame] = useState(null);
  const [fav, setFav] = useState(null); // entrée bibliothèque (OST/perso favoris…)
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("infos");
  const [showPlayed, setShowPlayed] = useState(false);
  const [showRecommend, setShowRecommend] = useState(false);
  const [wishBusy, setWishBusy] = useState(false);
  const [viewer, setViewer] = useState(null); // { images, index }
  const [bgOverride, setBgOverride] = useState(null);

  const entry = map[id];
  const isWishlist = entry?.status === "wishlist";
  const isPlayed = entry && PLAYED.includes(entry.status);

  function reloadEntry() {
    apiFetch(`/library/${id}`, { token })
      .then((e) => setFav(e.entry || null))
      .catch(() => setFav(null));
  }

  useEffect(() => {
    let alive = true;
    setError(null);
    // Onglet initial : « reviews » si demandé via l'URL (ex. depuis une notif), sinon « infos ».
    const wantTab = searchParams.get("tab");
    setTab(TABS.some((t) => t.id === wantTab && t.ready) ? wantTab : "infos");
    if (wantTab) setSearchParams({}, { replace: true });
    setFav(null);
    setFriends([]);
    setBgOverride(localStorage.getItem(bgKey(id)) || null);
    window.scrollTo({ top: 0 });
    // Affichage immédiat depuis le cache (jaquette, titre, infos), puis revalidation.
    const cached = gameCache.get(String(id));
    if (cached) {
      setGame(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    apiFetch(`/games/${id}/friends`, { token })
      .then((d) => alive && setFriends(d.friends || []))
      .catch(() => {});
    Promise.all([
      apiFetch(`/games/${id}/full`, { token }),
      apiFetch(`/library/${id}`, { token }).catch(() => ({ entry: null })),
    ])
      .then(([d, e]) => {
        if (!alive) return;
        setGame(d);
        gameCache.set(String(id), d);
        setFav(e.entry || null);
      })
      // On ne casse l'affichage que si on n'avait rien en cache.
      .catch((err) => alive && !cached && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, token]);

  async function toggleWishlist() {
    if (wishBusy || !game) return;
    setWishBusy(true);
    try {
      if (isWishlist) {
        await apiFetch(`/library/${id}`, { method: "DELETE", token });
        removeLocal(id);
        setFav(null);
      } else {
        await apiFetch(`/library/${id}`, {
          method: "PUT",
          token,
          body: { status: "wishlist", name: game.name, cover: game.cover },
        });
        upsertLocal(id, { status: "wishlist" });
        reloadEntry();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setWishBusy(false);
    }
  }

  // Choix (ou retrait) de l'OST favorite depuis l'onglet OST : persiste
  // directement dans la bibliothèque et rafraîchit la card « OST favori ».
  async function selectFavoriteOst(t) {
    const favoriteOst = t
      ? {
          name: t.name,
          artist: t.artist,
          preview: t.preview || null,
          artwork: t.artwork || null,
          youtube: !!t.youtube,
          url: t.url || null,
        }
      : null;
    // MAJ optimiste pour un retour immédiat sur le disque étoilé.
    setFav((f) => ({ ...(f || {}), favoriteOst }));
    try {
      await apiFetch(`/library/${id}`, {
        method: "PUT",
        token,
        body: { favoriteOst, name: game.name, cover: game.cover },
      });
      reloadEntry();
    } catch (err) {
      alert(err.message);
      reloadEntry();
    }
  }

  // Définit l'image affichée comme fond de la page (mémorisé localement)
  function setGameCover(url) {
    localStorage.setItem(bgKey(id), url);
    setBgOverride(url);
  }

  // Applique l'image comme couverture de profil (comme dans le profil)
  async function setProfileCover(url) {
    const { user: u } = await apiFetch("/users/me", {
      method: "PUT",
      token,
      body: { cover: url },
    });
    updateUser({ cover: u.cover });
  }

  if (loading) {
    return (
      <div className="gp-state">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }
  if (error || !game) {
    return (
      <div className="gp-state">
        <AlertTriangle size={30} />
        <h3>Impossible de charger ce jeu</h3>
        <p>{error || "Jeu introuvable."}</p>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Retour
        </button>
      </div>
    );
  }

  const backdrop = bgOverride || game.backdrop || null;
  const release = game.releaseDate
    ? new Date(game.releaseDate * 1000).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const ttb = game.timeToBeat || {};
  const ttbChips = [
    { label: "Rapide", v: ttb.hastily },
    { label: "Normal", v: ttb.normally },
    { label: "100 %", v: ttb.completely },
  ];
  const hasTtb = ttb.hastily || ttb.normally || ttb.completely;

  return (
    <div className="gamepage">
      {/* Fond flouté */}
      <div className="gp-backdrop">
        {backdrop ? (
          <img src={backdrop} alt="" draggable="false" />
        ) : (
          <div className="gp-backdrop-fallback" />
        )}
        <div className="gp-backdrop-veil" />
      </div>

      <button className="gp-back clickable" onClick={() => navigate(-1)}>
        <ArrowLeft size={18} /> Retour
      </button>

      {/* Feuille de contenu qui remonte */}
      <div className="gp-sheet">
        <div className="gp-grid">
          {/* ---------------- Colonne gauche (fixe) ---------------- */}
          <aside className="gp-left">
            <div className="gp-cover">
              {game.cover ? (
                <img src={game.cover} alt={game.name} draggable="false" />
              ) : (
                <div className="gp-cover-empty">
                  <ImageOff size={34} />
                </div>
              )}
            </div>

            {/* Boutons d'action côte à côte */}
            <div className="gp-actions">
              <button
                className={`gp-action ${isPlayed ? "active" : ""}`}
                onClick={() => setShowPlayed(true)}
                title="J'y ai joué"
              >
                <Gamepad size={18} />
                <span>{isPlayed ? "Joué" : "Jouer"}</span>
              </button>
              <button
                className={`gp-action ${isWishlist ? "active" : ""}`}
                onClick={toggleWishlist}
                disabled={wishBusy}
                title="Je veux y jouer"
              >
                <Bookmark size={18} fill={isWishlist ? "currentColor" : "none"} />
                <span>Wishlist</span>
              </button>
              <button
                className="gp-action disabled"
                disabled
                title="Ajouter à une liste (bientôt)"
              >
                <ListPlus size={18} />
                <span>Liste</span>
              </button>
            </div>

            <button className="gp-recommend clickable" onClick={() => setShowRecommend(true)}>
              <Send size={16} /> Recommander à un ami
            </button>

            {/* Temps moyen pour finir */}
            <div className="gp-left-card">
              <h3 className="gp-h3">
                <Clock size={14} /> Temps de jeu
              </h3>
              {hasTtb ? (
                <div className="gp-ttb">
                  {ttbChips.map((c) => (
                    <div className={`gp-ttb-chip ${!c.v ? "empty" : ""}`} key={c.label}>
                      <span className="gp-ttb-label">{c.label}</span>
                      <span className="gp-ttb-val">{c.v ? `${c.v} h` : "—"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="gp-muted">Indisponible pour l'instant.</p>
              )}
            </div>

            {/* OST favori */}
            <FavCard
              Icon={Music}
              title="OST favori"
              onAdd={() => setShowPlayed(true)}
              filled={!!fav?.favoriteOst}
            >
              {fav?.favoriteOst && (
                <div className="gp-fav">
                  {fav.favoriteOst.artwork && (
                    <img src={fav.favoriteOst.artwork} alt="" className="gp-fav-art" />
                  )}
                  <div className="gp-fav-txt">
                    <b>{fav.favoriteOst.name}</b>
                    {fav.favoriteOst.artist && <small>{fav.favoriteOst.artist}</small>}
                  </div>
                </div>
              )}
            </FavCard>

            {/* Personnage favori */}
            <FavCard
              Icon={Users}
              title="Personnage favori"
              onAdd={() => setShowPlayed(true)}
              filled={!!fav?.favoriteCharacter}
            >
              {fav?.favoriteCharacter && (
                <div className="gp-fav">
                  {fav.favoriteCharacter.image && (
                    <img
                      src={fav.favoriteCharacter.image}
                      alt=""
                      className="gp-fav-art round"
                    />
                  )}
                  <div className="gp-fav-txt">
                    <b>{fav.favoriteCharacter.name}</b>
                  </div>
                </div>
              )}
            </FavCard>
          </aside>

          {/* ---------------- Colonne droite (contenu) ---------------- */}
          <div className="gp-right">
            <header className="gp-rhead">
              <div className="gp-rhead-main">
                {game.franchise && <span className="gp-franchise">{game.franchise}</span>}
                <h1 className="gp-title">{game.name}</h1>
                <p className="gp-tagline">
                  {release && (
                    <span>
                      <Calendar size={14} /> {release}
                    </span>
                  )}
                  {game.developers?.[0] && (
                    <span>
                      <Building2 size={14} /> {game.developers[0]}
                    </span>
                  )}
                </p>
                <FriendsPlayed friends={friends} />
              </div>

              {(game.playerRating != null || game.criticRating != null) && (
                <div className="gp-gauges">
                  {game.playerRating != null && (
                    <Gauge
                      value={game.playerRating}
                      label="Joueurs"
                      sub={game.playerRatingCount ? `${game.playerRatingCount} avis` : null}
                    />
                  )}
                  {game.criticRating != null && (
                    <Gauge
                      value={game.criticRating}
                      label="Critiques"
                      sub={game.criticRatingCount ? `${game.criticRatingCount} tests` : null}
                    />
                  )}
                </div>
              )}
            </header>

            {/* Onglets */}
            <nav className="gp-tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`gp-tab ${tab === t.id ? "active" : ""} ${
                    t.ready ? "clickable" : "soon"
                  }`}
                  onClick={() => t.ready && setTab(t.id)}
                  disabled={!t.ready}
                  title={t.ready ? "" : "Bientôt"}
                >
                  <t.Icon size={16} />
                  {t.label}
                  {!t.ready && <span className="gp-soon">bientôt</span>}
                </button>
              ))}
            </nav>

            {tab === "infos" && (
              <InfosTab
                game={game}
                onOpenImage={(images, index) => setViewer({ images, index })}
                navigate={navigate}
              />
            )}

            {/* On n'affiche le feed que si l'objet `game` chargé correspond bien
                à l'id de la route : sinon, au changement de jeu, GameFeed partirait
                avec le nouvel id mais l'ancien nom (le feed est construit côté
                serveur d'après le NOM) → contenu de l'ancien jeu. key={id} force
                un remontage propre par jeu. */}
            {tab === "feed" && String(game.id) === String(id) && (
              <GameFeed key={id} gameId={id} gameName={game.name} token={token} />
            )}

            {tab === "reviews" && (
              <GameReviews
                game={{ id: Number(id), name: game.name, cover: game.cover }}
                viewerStatus={entry?.status}
                onWantPlay={() => setShowPlayed(true)}
              />
            )}

            {tab === "trophies" && (
              <TrophiesTab
                gameId={id}
                token={token}
                gameName={game.name}
                altName={game.originalName}
              />
            )}

            {tab === "ost" && (
              <GameOst
                gameId={id}
                gameName={game.name}
                token={token}
                favorite={fav?.favoriteOst}
                onFavorite={selectFavoriteOst}
              />
            )}

            {tab === "characters" && (
              <GameCharacters
                gameId={id}
                token={token}
                favoriteName={fav?.favoriteCharacter?.name}
              />
            )}
          </div>
        </div>
      </div>

      {showPlayed && (
        <PlayedModal
          game={{ id: Number(id), name: game.name, cover: game.cover }}
          onClose={() => {
            setShowPlayed(false);
            reloadEntry();
          }}
        />
      )}

      {showRecommend && (
        <RecommendModal
          game={{ id: Number(id), name: game.name, cover: game.cover }}
          onClose={() => setShowRecommend(false)}
        />
      )}

      {viewer && (
        <ImageViewer
          images={viewer.images}
          startIndex={viewer.index}
          currentBg={backdrop}
          onClose={() => setViewer(null)}
          onSetGameCover={setGameCover}
          onSetProfileCover={setProfileCover}
        />
      )}
    </div>
  );
}

// --- Onglet Trophées : sous-onglets Succès Steam / Trophées PSN ---
function TrophiesTab({ gameId, token, gameName, altName }) {
  const [sub, setSub] = useState("steam");
  return (
    <div className="gp-trophies">
      <div className="gp-subtabs">
        {TROPHY_TABS.map((t) => (
          <button
            key={t.id}
            className={`gp-subtab clickable ${sub === t.id ? "active" : ""}`}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === "steam" ? (
        <SteamAchievements gameId={gameId} token={token} />
      ) : (
        <PsnTrophies gameId={gameId} token={token} gameName={gameName} altName={altName} />
      )}
    </div>
  );
}

// Placeholder animé (shimmer) affiché pendant le chargement des trophées/succès.
function TrophySkeleton({ rows = 8 }) {
  return (
    <div className="gp-troph-skel" aria-busy="true" aria-label="Chargement des trophées">
      <div className="gp-troph-skel-head">
        <span className="gp-skel gp-skel-bar" style={{ width: 130 }} />
        <span className="gp-skel gp-skel-bar" style={{ width: 190 }} />
      </div>
      <div className="gp-troph-list">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="gp-troph gp-troph-skelrow" key={i}>
            <span className="gp-skel gp-troph-icon" />
            <div className="gp-troph-body">
              <span className="gp-skel gp-skel-bar" style={{ width: "58%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "82%" }} />
            </div>
            <span className="gp-skel gp-skel-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SteamAchievements({ gameId, token }) {
  const cached = achCache.get(String(gameId));
  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState(cached?.data || null);

  useEffect(() => {
    const c = achCache.get(String(gameId));
    // Donnée encore fraîche en cache : on l'affiche sans rappeler l'API.
    if (c?.fresh) {
      setData(c.data);
      setLoading(false);
      return;
    }
    let alive = true;
    if (c) setData(c.data); // périmé : on garde l'affichage pendant la revalidation
    else setLoading(true);
    apiFetch(`/games/${gameId}/achievements`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        achCache.set(String(gameId), d);
      })
      .catch(() => alive && !c && setData({ available: false, reason: "error" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  if (loading) return <TrophySkeleton />;

  if (!data?.available) {
    const msg =
      data?.reason === "no_key"
        ? "Les succès Steam ne sont pas configurés sur le serveur (clé API Steam manquante)."
        : data?.reason === "no_appid"
        ? "Ce jeu n'a pas de version Steam identifiée — pas de succès à afficher."
        : "Impossible de récupérer les succès Steam pour l'instant.";
    return (
      <div className="gp-troph-empty">
        <Trophy size={26} />
        <p className="font-fun">{msg}</p>
      </div>
    );
  }

  if (!data.achievements.length) {
    return (
      <div className="gp-troph-empty">
        <Trophy size={26} />
        <p className="font-fun">Ce jeu ne propose pas de succès Steam.</p>
      </div>
    );
  }

  return (
    <>
      <div className="gp-troph-head">
        <span className="gp-troph-count">
          <Trophy size={15} /> {data.count} succès
        </span>
        <span className="gp-troph-legend">Rareté : % de joueurs l'ayant débloqué</span>
      </div>
      <div className="gp-troph-list">
        {data.achievements.map((a) => (
          <div className={`gp-troph ${a.hidden ? "is-hidden" : ""}`} key={a.name}>
            <div className="gp-troph-icon">
              {a.icon ? (
                <img src={a.icon} alt="" loading="lazy" />
              ) : (
                <Trophy size={20} />
              )}
            </div>
            <div className="gp-troph-body">
              <span className="gp-troph-name">
                {a.hidden && <Lock size={12} />} {a.title}
              </span>
              <span className="gp-troph-desc">
                {a.hidden && !a.desc ? "Succès caché" : a.desc}
              </span>
            </div>
            {a.percent != null && (
              <span
                className={`gp-troph-rarity ${
                  a.percent < 5 ? "ultra" : a.percent < 20 ? "rare" : ""
                }`}
              >
                {a.percent}%
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function TrophyCount({ type, n }) {
  return (
    <span className="psn-count" title={type}>
      <span className={`psn-type psn-${type}`} /> {n}
    </span>
  );
}

function PsnTrophies({ gameId, token, gameName, altName }) {
  const { user } = useAuth();
  const cached = psnCache.get(String(gameId));
  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState(cached?.data || null);

  useEffect(() => {
    const c = psnCache.get(String(gameId));
    // Donnée encore fraîche en cache : on l'affiche sans rappeler l'API.
    if (c?.fresh) {
      setData(c.data);
      setLoading(false);
      return;
    }
    let alive = true;
    if (c) setData(c.data); // périmé : on garde l'affichage pendant la revalidation
    else setLoading(true);
    const params = new URLSearchParams();
    if (gameName) params.set("name", gameName);
    if (altName && altName !== gameName) params.set("altName", altName);
    apiFetch(`/games/${gameId}/psn-trophies?${params}`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        psnCache.set(String(gameId), d);
      })
      .catch(() => alive && !c && setData({ available: false, reason: "error" }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token, gameName, altName]);

  if (loading) return <TrophySkeleton />;

  if (!data?.available) {
    const notConnected = data?.reason === "not_connected";
    return (
      <div className="gp-troph-empty">
        <Trophy size={26} />
        <p className="font-fun">
          {notConnected
            ? "Les trophées PSN ne sont pas encore disponibles."
            : "Trophées PSN indisponibles pour ce jeu."}
        </p>
        {notConnected && user?.isAdmin && (
          <Link to="/admin" className="gp-inline-link">
            Connecter le compte PSN dans l'Admin
          </Link>
        )}
      </div>
    );
  }

  const t = data.title;
  const def = t.defined || {};
  return (
    <>
      <div className="psn-title-head">
        {t.icon && <img src={t.icon} alt="" className="psn-title-icon" />}
        <div className="psn-title-info">
          <span className="psn-title-name">
            {t.name}
            {t.platform ? ` · ${t.platform}` : ""}
          </span>
          <div className="psn-counts">
            {def.platinum > 0 && <TrophyCount type="platinum" n={def.platinum} />}
            <TrophyCount type="gold" n={def.gold || 0} />
            <TrophyCount type="silver" n={def.silver || 0} />
            <TrophyCount type="bronze" n={def.bronze || 0} />
          </div>
        </div>
      </div>
      <div className="gp-troph-list">
        {data.trophies.map((tr) => {
          const masked = tr.hidden;
          return (
            <div className={`gp-troph psn ${masked ? "is-hidden" : ""}`} key={tr.id}>
              <div className="gp-troph-icon">
                {tr.icon ? <img src={tr.icon} alt="" loading="lazy" /> : <Trophy size={20} />}
              </div>
              <div className="gp-troph-body">
                <span className="gp-troph-name">
                  <span className={`psn-type psn-${tr.type}`} title={tr.type} />
                  {masked ? "Trophée caché" : tr.name}
                </span>
                <span className="gp-troph-desc">{masked ? "" : tr.detail}</span>
              </div>
              {tr.percent != null && (
                <span
                  className={`gp-troph-rarity ${
                    tr.percent < 5 ? "ultra" : tr.percent < 20 ? "rare" : ""
                  }`}
                >
                  {tr.percent}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Amis (abonnements) qui ont ce jeu : groupés « y ont joué » / « veulent y jouer »
function FriendsPlayed({ friends }) {
  if (!friends.length) return null;
  return (
    <div className="gp-friends">
      {FRIEND_GROUPS.map((grp) => {
        const list = friends.filter((f) => grp.match(f.status));
        if (!list.length) return null;
        return (
          <div className="gp-friends-grp" key={grp.key}>
            <span className="gp-friends-label">{grp.label}</span>
            <div className="gp-friends-avs">
              {list.slice(0, 6).map((f) => (
                <Link
                  to={`/u/${f.user.username}`}
                  className="gp-friend-av clickable"
                  key={f.user.id}
                  title={f.user.username}
                >
                  {f.user.avatar ? (
                    <img src={f.user.avatar} alt={f.user.username} />
                  ) : (
                    <span className="gp-friend-fb">
                      {(f.user.username || "?")[0].toUpperCase()}
                    </span>
                  )}
                </Link>
              ))}
              {list.length > 6 && <span className="gp-friend-more">+{list.length - 6}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FavCard({ Icon, title, children, onAdd, filled }) {
  return (
    <div className="gp-left-card">
      <h3 className="gp-h3">
        <Icon size={14} /> {title}
      </h3>
      {filled ? (
        <button className="gp-fav-wrap clickable" onClick={onAdd} title="Modifier">
          {children}
        </button>
      ) : (
        <button className="gp-fav-add clickable" onClick={onAdd}>
          <Plus size={15} /> Choisir
        </button>
      )}
    </div>
  );
}

function InfosTab({ game, onOpenImage, navigate }) {
  const media = game.media || [];
  const videos = media.filter((m) => m.type === "video");
  const images = media.filter((m) => m.type !== "video");

  const [imgFilter, setImgFilter] = useState("all");
  const imgFilters = [
    { id: "all", label: "Tous" },
    { id: "artwork", label: "Art" },
    { id: "screenshot", label: "Capture" },
  ].filter((f) => f.id === "all" || images.some((m) => m.type === f.id));
  const shownImages =
    imgFilter === "all" ? images : images.filter((m) => m.type === imgFilter);

  const chipGroups = [
    { label: "Genres", items: game.genres },
    { label: "Thèmes", items: game.themes },
    { label: "Modes de jeu", items: game.gameModes },
    { label: "Plateformes", items: game.platforms.map((p) => p.name) },
  ].filter((g) => g.items?.length);

  const facts = [
    game.publishers?.length && {
      Icon: Building2,
      label: "Éditeur",
      value: game.publishers.join(", "),
    },
    game.engines?.length && { Icon: Cpu, label: "Moteur", value: game.engines.join(", ") },
    game.perspectives?.length && {
      Icon: Layers,
      label: "Vue",
      value: game.perspectives.join(", "),
    },
  ].filter(Boolean);

  const storyLong = game.storyline && game.storyline !== game.summary;

  return (
    <div className="gp-infos">
      {(game.summary || storyLong) && (
        <section className="gp-block">
          <h2 className="gp-h2">À propos</h2>
          {game.summary && <p className="gp-para">{game.summary}</p>}
          {storyLong && (
            <details className="gp-story">
              <summary className="clickable">Scénario</summary>
              <p className="gp-para">{game.storyline}</p>
            </details>
          )}
        </section>
      )}

      {videos.length > 0 && (
        <section className="gp-block">
          <h2 className="gp-h2">Bandes-annonces</h2>
          <VideoGallery videos={videos} />
        </section>
      )}

      {images.length > 0 && (
        <section className="gp-block">
          <div className="gp-media-head">
            <h2 className="gp-h2">Images</h2>
            {imgFilters.length > 2 && (
              <div className="gp-media-filters">
                {imgFilters.map((f) => (
                  <button
                    key={f.id}
                    className={`gp-media-filter clickable ${
                      imgFilter === f.id ? "active" : ""
                    }`}
                    onClick={() => setImgFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ScrollRow className="gp-media-row" key={imgFilter}>
            {shownImages.map((m, i) => (
              <button
                key={m.id}
                className="gp-media clickable"
                onClick={() => onOpenImage(shownImages, i)}
              >
                <img src={m.thumb} alt="" loading="lazy" draggable="false" />
                <span className={`gp-media-tag ${m.type}`}>
                  {m.type === "artwork" ? "Art" : "Capture"}
                </span>
              </button>
            ))}
          </ScrollRow>
        </section>
      )}

      {facts.length > 0 && (
        <section className="gp-block">
          <div className="gp-factgrid">
            {facts.map((f) => (
              <div className="gp-fact" key={f.label}>
                <span className="gp-fact-label">
                  <f.Icon size={13} /> {f.label}
                </span>
                <span className="gp-fact-value">{f.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {chipGroups.map((grp) => (
        <section className="gp-block" key={grp.label}>
          <h3 className="gp-h3">{grp.label}</h3>
          <div className="gp-chips">
            {grp.items.map((it) => (
              <span className="gp-chip" key={it}>
                {it}
              </span>
            ))}
          </div>
        </section>
      ))}

      {game.languages?.length > 0 && (
        <section className="gp-block">
          <h3 className="gp-h3">
            <Languages size={14} /> Langues disponibles
          </h3>
          <div className="gp-chips">
            {game.languages.map((l) => (
              <span className="gp-chip gp-lang" key={l.name}>
                {l.cc && /^[a-z]{2}$/.test(l.cc) && (
                  <img
                    className="gp-flag"
                    src={`https://flagcdn.com/20x15/${l.cc}.png`}
                    alt=""
                    loading="lazy"
                  />
                )}
                {l.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {game.websites?.length > 0 && (
        <section className="gp-block">
          <h3 className="gp-h3">Liens</h3>
          <div className="gp-links">
            {game.websites.map((w) => (
              <a
                key={w.url}
                href={w.url}
                target="_blank"
                rel="noreferrer"
                className="gp-link clickable"
              >
                {WEBSITE_LABELS[w.kind] || w.kind}
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </section>
      )}

      {game.similar?.length > 0 && (
        <section className="gp-block">
          <h2 className="gp-h2">Jeux similaires</h2>
          <ScrollRow className="gp-similar-row">
            {game.similar.map((s) => (
              <button
                key={s.id}
                className="gp-similar clickable"
                onClick={() => navigate(`/game/${s.id}`)}
              >
                <div className="gp-similar-cover">
                  <img src={s.cover} alt={s.name} loading="lazy" draggable="false" />
                  {s.rating != null && (
                    <span className="gp-similar-rating">
                      <Star size={11} fill="currentColor" strokeWidth={0} />
                      {Math.round(s.rating / 10)}
                    </span>
                  )}
                </div>
                <span className="gp-similar-name">{s.name}</span>
              </button>
            ))}
          </ScrollRow>
        </section>
      )}
    </div>
  );
}

// Galerie vidéos : un lecteur principal + les autres en miniatures à droite
function VideoGallery({ videos }) {
  const [active, setActive] = useState(videos[0].videoId);
  const solo = videos.length === 1;
  return (
    <div className={`gp-videos ${solo ? "solo" : ""}`}>
      <div className="gp-video-main">
        <iframe
          key={active}
          src={`https://www.youtube.com/embed/${active}`}
          title="Bande-annonce"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      </div>
      {videos.length > 1 && (
        <div className="gp-video-list">
          {videos.map((v) => (
            <button
              key={v.videoId}
              className={`gp-video-thumb clickable ${active === v.videoId ? "active" : ""}`}
              onClick={() => setActive(v.videoId)}
              title={v.name}
            >
              <div className="gp-video-thumb-img">
                <img src={v.thumb} alt="" loading="lazy" draggable="false" />
                <span className="gp-video-thumb-play">
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </span>
              </div>
              <span className="gp-video-thumb-name">{v.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Visionneuse d'images (plein écran) : flèches, filtres, miniatures, actions
function ImageViewer({
  images,
  startIndex,
  currentBg,
  onClose,
  onSetGameCover,
  onSetProfileCover,
}) {
  const [filter, setFilter] = useState("all");
  const [index, setIndex] = useState(startIndex || 0);
  const [done, setDone] = useState(""); // "game" | "profile"
  const [busy, setBusy] = useState(false);
  const thumbsRef = useRef(null);
  const drag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 });

  const list =
    filter === "all" ? images : images.filter((m) => m.type === filter);

  useEffect(() => {
    setDone("");
  }, [index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + list.length) % list.length);
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % list.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list.length, onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Drag-to-scroll (souris) sur la rangée de miniatures, comme la liste d'images.
  useEffect(() => {
    function onMove(e) {
      if (!drag.current.down) return;
      const el = thumbsRef.current;
      if (!el) return;
      const dx = e.pageX - drag.current.startX;
      if (Math.abs(dx) > 4) drag.current.moved = true;
      el.scrollLeft = drag.current.startScroll - dx;
      e.preventDefault();
    }
    function onUp() {
      if (!drag.current.down) return;
      drag.current.down = false;
      // laisse le clic suivant s'annuler si on a bougé
      setTimeout(() => (drag.current.moved = false), 0);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Recentre la miniature active pour qu'elle reste toujours visible.
  useEffect(() => {
    const el = thumbsRef.current;
    if (!el) return;
    const child = el.children[Math.min(index, list.length - 1)];
    if (!child) return;
    el.scrollTo({
      left: child.offsetLeft - el.clientWidth / 2 + child.clientWidth / 2,
      behavior: "smooth",
    });
  }, [index, list.length]);

  function onThumbsDown(e) {
    if (e.button !== 0) return; // clic gauche uniquement
    const el = thumbsRef.current;
    if (!el) return;
    drag.current = {
      down: true,
      moved: false,
      startX: e.pageX,
      startScroll: el.scrollLeft,
    };
  }

  // Après un drag, on annule le clic (pour ne pas changer d'image par erreur)
  function onThumbsClickCapture(e) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  if (!list.length) return null;
  const safeIndex = Math.min(index, list.length - 1);
  const cur = list[safeIndex];

  const available = [
    { id: "all", label: "Tout" },
    { id: "artwork", label: "Artworks" },
    { id: "screenshot", label: "Captures" },
  ].filter((f) => f.id === "all" || images.some((m) => m.type === f.id));

  function pickFilter(f) {
    setFilter(f);
    setIndex(0);
  }

  async function apply(kind) {
    if (kind === "game") {
      onSetGameCover(cur.full);
      setDone("game");
      return;
    }
    setBusy(true);
    try {
      await onSetProfileCover(cur.full);
      setDone("profile");
    } catch (err) {
      alert(err.message || "Échec.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="gp-viewer" onClick={onClose}>
      <button className="gp-viewer-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>

      <div className="gp-viewer-inner" onClick={(e) => e.stopPropagation()}>
        {available.length > 2 && (
          <div className="gp-viewer-filters">
            {available.map((f) => (
              <button
                key={f.id}
                className={`gp-vfilter clickable ${filter === f.id ? "active" : ""}`}
                onClick={() => pickFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className="gp-viewer-stage">
          {list.length > 1 && (
            <button
              className="gp-viewer-nav left clickable"
              onClick={() => setIndex((i) => (i - 1 + list.length) % list.length)}
              aria-label="Précédent"
            >
              <ChevronLeft size={26} />
            </button>
          )}

          <img className="gp-viewer-img" src={cur.full} alt="" />

          {list.length > 1 && (
            <button
              className="gp-viewer-nav right clickable"
              onClick={() => setIndex((i) => (i + 1) % list.length)}
              aria-label="Suivant"
            >
              <ChevronRight size={26} />
            </button>
          )}
        </div>

        <div className="gp-viewer-bar">
          <div className="gp-viewer-meta">
            <span className={`gp-viewer-type ${cur.type}`}>{MEDIA_LABELS[cur.type]}</span>
            <span className="gp-viewer-count">
              {safeIndex + 1} / {list.length}
            </span>
          </div>

          <div className="gp-viewer-actions">
            <button
              className={`gp-viewer-btn clickable ${
                currentBg === cur.full || done === "game" ? "on" : ""
              }`}
              onClick={() => apply("game")}
            >
              {currentBg === cur.full || done === "game" ? (
                <Check size={16} />
              ) : (
                <ImageIcon size={16} />
              )}
              Couverture de jeu
            </button>
            <button
              className={`gp-viewer-btn clickable ${done === "profile" ? "on" : ""}`}
              onClick={() => apply("profile")}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : done === "profile" ? (
                <Check size={16} />
              ) : (
                <UserRound size={16} />
              )}
              Couverture de profil
            </button>
          </div>
        </div>

        <div
          className="gp-viewer-thumbs"
          ref={thumbsRef}
          onMouseDown={onThumbsDown}
          onClickCapture={onThumbsClickCapture}
        >
          {list.map((m, i) => (
            <button
              key={m.id}
              className={`gp-viewer-thumb clickable ${i === safeIndex ? "active" : ""}`}
              onClick={() => setIndex(i)}
            >
              <img src={m.thumb} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
