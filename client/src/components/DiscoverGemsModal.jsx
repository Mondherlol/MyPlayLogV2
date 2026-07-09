import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  X,
  Search,
  Loader2,
  Gem,
  Check,
  Gamepad2,
  Gamepad,
  Plus,
  ArrowLeft,
  Sparkles,
  Star,
  Clock,
  Calendar,
  Bookmark,
  Play,
  Pause,
  Music,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { loadPopularGames } from "../lib/popularGames";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import PlayedModal from "./PlayedModal";
import TrailerPlayer from "./TrailerPlayer";

const MAX_SEEDS = 3;
// Même cache que GamePage : une pépite ouverte ensuite en fiche est instantanée.
const gameCache = makeCache("mpl_gamefull_", 24 * 60 * 60 * 1000);

// Reprise de session : quand on ouvre la fiche d'une pépite, l'état du deck
// (résultats, position, jeux choisis) est stocké ici ; au retour sur l'accueil,
// Welcome rouvre la modale qui consomme cet état et reprend où on en était.
export const GEMS_RESUME_KEY = "mpl_gems_resume";

function readResume() {
  try {
    const raw = sessionStorage.getItem(GEMS_RESUME_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(GEMS_RESUME_KEY);
    const r = JSON.parse(raw);
    return Array.isArray(r?.items) && r.items.length ? r : null;
  } catch {
    return null;
  }
}

// Modale « Découvrir une pépite indé » : on épingle 3 jeux qu'on aime, on
// choisit ses plateformes, et le serveur renvoie des pépites indés proches
// (POST /api/feed/recommend) présentées une par une, façon deck à swiper.
// Sur desktop, un panneau latéral joue le trailer et fait défiler les médias.
// À ne pas confondre avec RecommendModal (recommander un jeu à un ami).
export default function DiscoverGemsModal({ token, onClose }) {
  const navigate = useNavigate();
  // État restauré après un aller-retour sur une fiche de jeu (une seule fois).
  const [resume] = useState(readResume);

  const [seeds, setSeeds] = useState(resume?.seeds || []); // [{id, name, cover}]
  const [platforms, setPlatforms] = useState([]); // liste IGDB {id, name, abbr}
  const [myPlatNames, setMyPlatNames] = useState(() => new Set()); // noms (minuscule) déjà joués
  const [favorites, setFavorites] = useState(null); // jeux favoris de la biblio
  const [selPlats, setSelPlats] = useState(() => new Set(resume?.plats || []));
  const [allPlats, setAllPlats] = useState(false); // « voir plus » plateformes
  const [results, setResults] = useState(resume?.items || null); // null = étape de choix
  const [genId, setGenId] = useState(0); // change à chaque fournée → remonte le deck
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Modale « J'y ai déjà joué » ouverte par-dessus (depuis une carte du deck).
  const [playedFor, setPlayedFor] = useState(null);

  useEffect(() => {
    // Tant que la sous-modale est ouverte, Escape lui revient (elle a son
    // propre handler) : la modale pépites ne doit pas se fermer en même temps.
    const onKey = (e) => e.key === "Escape" && !playedFor && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, playedFor]);

  // Plateformes IGDB (mises en cache serveur) + bibliothèque de l'utilisateur :
  // ses favoris alimentent la recherche par défaut, ses plateformes jouées
  // remontent en tête de la liste.
  useEffect(() => {
    apiFetch("/games/platforms", { token })
      .then((d) => setPlatforms(d.platforms || []))
      .catch(() => setPlatforms([]));
    apiFetch("/library", { token })
      .then((d) => {
        const entries = d.entries || [];
        setFavorites(
          entries
            .filter((e) => e.favorite)
            .map((e) => ({ id: e.gameId, name: e.name, cover: e.cover }))
        );
        setMyPlatNames(
          new Set(entries.map((e) => e.platform).filter(Boolean).map((p) => p.toLowerCase()))
        );
      })
      .catch(() => setFavorites([]));
  }, [token]);

  const seedIds = new Set(seeds.map((s) => s.id));

  function toggleSeed(g) {
    setSeeds((prev) => {
      if (prev.some((s) => s.id === g.id)) return prev.filter((s) => s.id !== g.id);
      if (prev.length >= MAX_SEEDS) return prev;
      return [...prev, { id: g.id, name: g.name, cover: g.cover }];
    });
  }

  function togglePlat(id) {
    setSelPlats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (seeds.length < MAX_SEEDS || loading) return;
    setLoading(true);
    setError("");
    try {
      const d = await apiFetch("/feed/recommend", {
        method: "POST",
        token,
        body: { gameIds: seeds.map((s) => s.id), platforms: [...selPlats] },
      });
      setResults(d.games || []);
      setGenId((n) => n + 1);
    } catch (err) {
      setError(err.message || "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }

  // Ouvre la fiche du jeu en sauvegardant le deck pour reprendre au retour.
  function openGame(gameId, deckState) {
    try {
      sessionStorage.setItem(
        GEMS_RESUME_KEY,
        JSON.stringify({ items: results, seeds, plats: [...selPlats], ...deckState })
      );
    } catch {
      /* stockage indisponible : tant pis, pas de reprise */
    }
    onClose();
    navigate(`/game/${gameId}`);
  }

  // Plateformes déjà jouées d'abord ; les autres derrière « Voir plus ».
  const played = platforms.filter((p) => myPlatNames.has(p.name.toLowerCase()));
  const others = platforms.filter((p) => !myPlatNames.has(p.name.toLowerCase()));
  const visiblePlats = allPlats ? [...played, ...others] : played.length ? played : others.slice(0, 8);
  const hiddenCount = platforms.length - visiblePlats.length;

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className={`modal dg-modal ${results !== null ? "deck" : ""}`}>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>

          {results === null ? (
            <>
              <div className="dg-body">
                <h2 className="modal-title">
                  <Gem size={20} /> Découvrir une pépite indé
                </h2>
                <p className="dg-intro">
                  Choisis {MAX_SEEDS} jeux que tu aimes, on te déniche des pépites du
                  même esprit.
                </p>

                {/* Jeux épinglés */}
                <div className="dg-seeds">
                  {Array.from({ length: MAX_SEEDS }).map((_, i) => {
                    const s = seeds[i];
                    return s ? (
                      <button
                        key={s.id}
                        className="dg-seed filled clickable"
                        onClick={() => toggleSeed(s)}
                        title={`${s.name} — retirer`}
                      >
                        {s.cover ? (
                          <img src={s.cover} alt="" draggable="false" />
                        ) : (
                          <span className="dg-seed-ph">
                            <Gamepad2 size={20} />
                          </span>
                        )}
                        <span className="dg-seed-x">
                          <X size={13} />
                        </span>
                        <span className="dg-seed-name">{s.name}</span>
                      </button>
                    ) : (
                      <div key={`empty-${i}`} className="dg-seed empty">
                        <Plus size={20} />
                      </div>
                    );
                  })}
                </div>

                <SeedSearch
                  token={token}
                  seedIds={seedIds}
                  favorites={favorites}
                  onToggle={toggleSeed}
                />

                {/* Plateformes : celles où l'utilisateur a déjà joué d'abord */}
                <div className="dg-plats-head">
                  <span className="dg-label">Plateformes</span>
                  <span className="dg-hint">
                    {selPlats.size ? `${selPlats.size} sélectionnée(s)` : "toutes"}
                  </span>
                </div>
                <div className="dg-plats">
                  {visiblePlats.map((p) => (
                    <button
                      key={p.id}
                      className={`dg-plat clickable ${selPlats.has(p.id) ? "on" : ""}`}
                      onClick={() => togglePlat(p.id)}
                      title={p.name}
                    >
                      {selPlats.has(p.id) && <Check size={12} />}
                      {p.abbr}
                    </button>
                  ))}
                  {!allPlats && hiddenCount > 0 && (
                    <button
                      className="dg-plat more clickable"
                      onClick={() => setAllPlats(true)}
                    >
                      Voir plus <ChevronDown size={12} />
                    </button>
                  )}
                </div>

                {error && <p className="dg-error">{error}</p>}
              </div>

              {/* Footer toujours visible */}
              <div className="dg-footer">
                <span className="dg-foot-count">
                  <b>{seeds.length}</b>/{MAX_SEEDS} jeux choisis
                </span>
                <button
                  className="btn btn-primary dg-go"
                  onClick={generate}
                  disabled={seeds.length < MAX_SEEDS || loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="spin" /> Recherche…
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} /> Trouver mes pépites
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <GemDeck
              key={genId}
              items={results}
              initialIndex={genId === 0 ? resume?.index || 0 : 0}
              initialWish={genId === 0 ? resume?.wishCount || 0 : 0}
              token={token}
              onBack={() => setResults(null)}
              onClose={onClose}
              onOpenGame={openGame}
              onPlayed={(g, advance) =>
                setPlayedFor({ id: g.id, name: g.name, cover: g.cover, advance })
              }
            />
          )}
        </div>
      </div>

      {/* « J'y ai déjà joué » : la modale bibliothèque par-dessus le deck.
          Enregistrer → le deck passe au jeu suivant ; annuler → on reste. */}
      {playedFor && (
        <PlayedModal
          game={playedFor}
          onSaved={playedFor.advance}
          onClose={() => setPlayedFor(null)}
        />
      )}
    </>,
    document.body
  );
}

// --- Recherche de jeux : auto (debounce), favoris par défaut, une ligne ---
function SeedSearch({ token, seedIds, favorites, onToggle }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [popular, setPopular] = useState([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  // Sans favoris, on retombe sur les jeux populaires (mis en cache 24 h).
  useEffect(() => {
    if (favorites !== null && !favorites.length) {
      loadPopularGames(token).then(setPopular).catch(() => {});
    }
  }, [favorites, token]);

  // Recherche à la frappe (debounce) — pas de bouton.
  useEffect(() => {
    const t = q.trim();
    const id = ++reqRef.current;
    if (!t) {
      setFound([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: 18, sort: "popularity" });
      params.set("search", t);
      apiFetch(`/games?${params}`, { token })
        .then((d) => id === reqRef.current && setFound(d.games || []))
        .catch(() => id === reqRef.current && setFound([]))
        .finally(() => id === reqRef.current && setLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [q, token]);

  const searching = !!q.trim();
  const list = searching ? found : favorites?.length ? favorites : popular;
  const label = searching
    ? "Résultats"
    : favorites?.length
      ? "Tes jeux favoris"
      : "Jeux populaires";

  return (
    <>
      <div className="dg-search">
        <Search size={17} />
        <input
          placeholder="Rechercher un jeu…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && <Loader2 size={15} className="spin" />}
      </div>
      <span className="dg-row-label">{label}</span>
      <div className="dg-picks" aria-busy={loading}>
        {loading &&
          Array.from({ length: 9 }).map((_, i) => (
            <span key={`skel-${i}`} className="gp-skel dg-pick-skel" />
          ))}
        {!loading && list.map((g) => {
          const picked = seedIds.has(g.id);
          return (
            <button
              key={g.id}
              className={`dg-pick clickable ${picked ? "picked" : ""}`}
              onClick={() => onToggle(g)}
              title={g.name}
            >
              {g.cover ? (
                <img src={g.cover} alt="" loading="lazy" draggable="false" />
              ) : (
                <span className="dg-pick-ph">
                  <Gamepad2 size={18} />
                </span>
              )}
              {picked && (
                <span className="dg-pick-check">
                  <Check size={13} />
                </span>
              )}
            </button>
          );
        })}
        {searching && !loading && !list.length && (
          <span className="dg-picks-empty font-fun">Aucun jeu trouvé.</span>
        )}
      </div>
    </>
  );
}

// ============================================================
//  Deck de résultats : une pépite à la fois, à swiper
//  (desktop : panneau latéral trailer + vidéos + images)
// ============================================================

function GemDeck({
  items,
  initialIndex = 0,
  initialWish = 0,
  token,
  onBack,
  onClose,
  onOpenGame,
  onPlayed,
}) {
  const [index, setIndex] = useState(() => Math.min(initialIndex, items.length));
  const [wishCount, setWishCount] = useState(initialWish);
  // Détails du jeu courant, partagés entre la carte et le panneau médias.
  const [details, setDetails] = useState({ forId: null, full: null, friends: [], ost: null });

  const current = items[index];
  const next = items[index + 1];

  useEffect(() => {
    if (!current) return;
    let alive = true;
    const id = current.id;
    const c = gameCache.get(String(id));
    setDetails({ forId: id, full: c?.data || null, friends: [], ost: null });
    if (!c?.fresh) {
      apiFetch(`/games/${id}/full`, { token })
        .then((d) => {
          gameCache.set(String(id), d);
          if (alive) setDetails((prev) => (prev.forId === id ? { ...prev, full: d } : prev));
        })
        .catch(() => {});
    }
    apiFetch(`/games/${id}/friends`, { token })
      .then((d) => {
        const fr = (d.friends || []).filter((f) => f.status !== "wishlist");
        if (alive) setDetails((prev) => (prev.forId === id ? { ...prev, friends: fr } : prev));
      })
      .catch(() => {});
    apiFetch(`/games/${id}/ost?q=${encodeURIComponent(current.name)}`, { token })
      .then((d) => {
        const t = d.tracks?.[0] || null;
        if (alive) setDetails((prev) => (prev.forId === id ? { ...prev, ost: t } : prev));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current, token]);

  // Préchauffe la fiche du jeu suivant pour un swipe fluide.
  useEffect(() => {
    if (!next || gameCache.get(String(next.id))?.fresh) return;
    apiFetch(`/games/${next.id}/full`, { token })
      .then((d) => gameCache.set(String(next.id), d))
      .catch(() => {});
  }, [next, token]);

  const advance = useCallback((wishlisted) => {
    if (wishlisted) setWishCount((n) => n + 1);
    setIndex((i) => i + 1);
  }, []);

  const forCurrent = current && details.forId === current.id;
  const full = forCurrent ? details.full : null;

  return (
    <div className={`dg-deck-wrap ${current ? "" : "done"}`}>
      <div className="dg-deck-main">
        <div className="dg-deck-head">
          <button className="dg-back clickable" onClick={onBack}>
            <ArrowLeft size={15} /> Mes jeux
          </button>
          {current && (
            <span className="dg-progress">
              {index + 1} / {items.length}
            </span>
          )}
        </div>
        <div className="dg-progress-bar">
          <span
            style={{ width: `${(Math.min(index, items.length) / items.length) * 100}%` }}
          />
        </div>

        {current ? (
          <div className="dg-deck">
            <GemCard
              key={current.id}
              game={current}
              full={full}
              friends={forCurrent ? details.friends : []}
              ost={forCurrent ? details.ost : null}
              token={token}
              onAdvance={advance}
              onOpen={() => onOpenGame(current.id, { index, wishCount })}
              onPlayed={() => onPlayed(current, () => advance(false))}
            />
          </div>
        ) : (
          <div className="dg-deck-end">
            <Gem size={34} />
            <h3>C'est tout pour cette fournée !</h3>
            <p className="font-fun">
              {wishCount
                ? `${wishCount} pépite${wishCount > 1 ? "s" : ""} ajoutée${
                    wishCount > 1 ? "s" : ""
                  } à ta wishlist.`
                : "Rien ne t'a tapé dans l'œil ? Essaie avec d'autres jeux."}
            </p>
            <div className="dg-deck-end-actions">
              <button className="btn btn-ghost" onClick={onBack}>
                <ArrowLeft size={16} /> Changer mes jeux
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                <Check size={16} /> Terminé
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Panneau médias (desktop) : trailer auto, autres vidéos, images */}
      {current && <GemAside key={current.id} full={full} />}
    </div>
  );
}

const SWIPE_THRESHOLD = 110;

// Une pépite : fiche riche (résumé complet, OST vinyle, durée, langues, amis)
// qu'on swipe à droite (wishlist) ou à gauche (passer).
function GemCard({ game, full, friends, ost, token, onAdvance, onOpen, onPlayed }) {
  const { upsertLocal } = useLibrary();
  const player = usePlayer();

  const [showTrailer, setShowTrailer] = useState(false);

  // Swipe : position en cours + direction de sortie (animation).
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(0); // -1 gauche, 1 droite
  const drag = useRef({ down: false, startX: 0, moved: false });
  const cardRef = useRef(null);

  function leave(dir, wishlisted) {
    setLeaving(dir);
    setTimeout(() => onAdvance(wishlisted), 230);
  }

  function skip() {
    if (leaving) return;
    // Swipe gauche = définitif : le serveur ne reproposera plus jamais ce jeu
    // dans les prochaines fournées (best-effort, en arrière-plan).
    apiFetch("/feed/gems/skip", {
      method: "POST",
      token,
      body: { gameId: game.id },
    }).catch(() => {});
    leave(-1, false);
  }

  function addWishlist() {
    if (leaving) return;
    // Optimiste : on avance tout de suite, la requête part en arrière-plan.
    apiFetch(`/library/${game.id}`, {
      method: "PUT",
      token,
      body: { status: "wishlist", name: game.name, cover: game.cover },
    })
      .then(() => upsertLocal(game.id, { status: "wishlist" }))
      .catch(() => {});
    leave(1, true);
  }

  // --- Drag (souris + tactile via pointer events) ---
  function onDown(e) {
    // On ne démarre pas un drag depuis un élément interactif.
    if (e.target.closest("button, a, iframe, input")) return;
    drag.current = { down: true, startX: e.clientX, moved: false };
    cardRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onMove(e) {
    if (!drag.current.down || leaving) return;
    const d = e.clientX - drag.current.startX;
    if (Math.abs(d) > 6) drag.current.moved = true;
    setDx(d);
  }

  function onUp() {
    if (!drag.current.down) return;
    drag.current.down = false;
    if (dx > SWIPE_THRESHOLD) addWishlist();
    else if (dx < -SWIPE_THRESHOLD) skip();
    else setDx(0);
  }

  // Après un drag, le relâchement génère quand même un click sur l'élément
  // survolé (résumé, OST…) : on l'avale en phase de capture (cf. DragCarousel).
  function onClickCapture(e) {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }

  // Piste OST jouable via le mini-lecteur global.
  const ostPlaying = ost && player?.isPlaying?.(ost);
  function toggleOst() {
    if (!ost) return;
    player?.toggleTrack?.(ost, [ost], { gameId: game.id, gameName: game.name });
  }

  const trailer = (full?.media || []).find((m) => m.type === "video");
  const ttb = full?.timeToBeat?.normally || full?.timeToBeat?.hastily || null;
  const langs = (full?.languages || []).filter((l) => l.cc && /^[a-z]{2}$/.test(l.cc));
  const genres = (game.genres || []).slice(0, 3);

  const style = leaving
    ? {
        transform: `translateX(${leaving * 640}px) rotate(${leaving * 16}deg)`,
        opacity: 0,
        transition: "transform 0.23s ease-in, opacity 0.23s ease-in",
      }
    : {
        transform: dx ? `translateX(${dx}px) rotate(${dx / 22}deg)` : "none",
        transition: drag.current.down ? "none" : "transform 0.2s ease",
      };

  return (
    <article
      className="dg-card"
      ref={cardRef}
      style={style}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={onClickCapture}
    >
      {/* Indices de swipe */}
      <span className="dg-stamp like" style={{ opacity: Math.min(1, Math.max(0, dx - 30) / 80) }}>
        <Bookmark size={15} /> Wishlist
      </span>
      <span className="dg-stamp nope" style={{ opacity: Math.min(1, Math.max(0, -dx - 30) / 80) }}>
        <X size={15} /> Passer
      </span>

      {/* Visuel de tête : trailer (à la demande, mobile) sinon screenshot + jaquette */}
      <div className="dg-card-hero">
        {showTrailer && trailer ? (
          <iframe
            src={`https://www.youtube.com/embed/${trailer.videoId}?autoplay=1`}
            title="Bande-annonce"
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
          />
        ) : (
          <>
            {full?.backdrop || game.screenshot || game.cover ? (
              <img
                className="dg-hero-bg"
                src={full?.backdrop || game.screenshot || game.cover}
                alt=""
                draggable="false"
              />
            ) : (
              <span className="dg-hero-fallback" />
            )}
            <span className="dg-hero-veil" />
            {trailer && (
              <button
                className="dg-trailer-btn clickable"
                onClick={() => {
                  player?.pause?.();
                  setShowTrailer(true);
                }}
              >
                <Play size={16} fill="currentColor" strokeWidth={0} /> Bande-annonce
              </button>
            )}
            <div className="dg-hero-id">
              {game.cover && <img className="dg-hero-cover" src={game.cover} alt="" draggable="false" />}
              <div className="dg-hero-txt">
                <h3 className="dg-hero-name">{game.name}</h3>
                <div className="dg-hero-meta">
                  {game.year && (
                    <span>
                      <Calendar size={12} /> {game.year}
                    </span>
                  )}
                  {game.rating != null && (
                    <span className="dg-hero-rating">
                      <Star size={12} fill="currentColor" strokeWidth={0} />
                      {Math.round((game.rating / 20) * 10) / 10}
                    </span>
                  )}
                  {ttb && (
                    <span>
                      <Clock size={12} /> ≈ {ttb} h
                    </span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="dg-card-body">
        {/* Genres + langues */}
        <div className="dg-tags">
          {genres.map((g) => (
            <span className="dg-tag" key={g}>
              {g}
            </span>
          ))}
          {langs.length > 0 && (
            <span className="dg-langs" title={langs.map((l) => l.name).join(", ")}>
              {langs.slice(0, 6).map((l) => (
                <img
                  key={l.cc}
                  src={`https://flagcdn.com/20x15/${l.cc}.png`}
                  alt={l.name}
                  loading="lazy"
                />
              ))}
              {langs.length > 6 && <i>+{langs.length - 6}</i>}
            </span>
          )}
        </div>

        {/* « Pourquoi ce jeu » : la phrase du moteur de reco, quand il y en a une */}
        {game.reason && (
          <p className="dg-why">
            <Gem size={13} />
            <span>{game.reason}</span>
          </p>
        )}

        {/* Résumé complet : seul ce bloc scrolle, l'OST reste toujours visible */}
        <div className="dg-summary-scroll">
          {full?.summary ? (
            <p className="dg-summary">{full.summary}</p>
          ) : (
            <div className="dg-summary-skel" aria-busy="true">
              <span className="gp-skel gp-skel-bar" />
              <span className="gp-skel gp-skel-bar" style={{ width: "86%" }} />
              <span className="gp-skel gp-skel-bar" style={{ width: "62%" }} />
            </div>
          )}
        </div>

        {/* OST (vinyle) + amis */}
        <div className="dg-extras">
          {ost && (
            <button
              className={`dg-ost clickable ${ostPlaying ? "playing" : ""}`}
              onClick={toggleOst}
              title={ost.name}
            >
              <span className="dg-ost-disc">
                <span className="dg-ost-disc-label">
                  {ost.artwork ? (
                    <img src={ost.artwork} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <Music size={13} />
                  )}
                  <span className="dg-ost-hole" />
                </span>
              </span>
              <span className="dg-ost-txt">
                <b>Écouter l'OST</b>
                <small>{ost.name}</small>
              </span>
              <span className="dg-ost-action">
                {ostPlaying ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} fill="currentColor" strokeWidth={0} />
                )}
              </span>
            </button>
          )}
          {friends.length > 0 && (
            <div className="dg-friends" title={friends.map((f) => f.user.username).join(", ")}>
              <span className="dg-friends-avs">
                {friends.slice(0, 3).map((f) => (
                  <span className="dg-friend-av" key={f.user.id}>
                    {f.user.avatar ? (
                      <img src={f.user.avatar} alt="" />
                    ) : (
                      (f.user.username || "?")[0].toUpperCase()
                    )}
                  </span>
                ))}
              </span>
              <small>
                {friends[0].user.username}
                {friends.length > 1 ? ` +${friends.length - 1}` : ""} y{" "}
                {friends.length > 1 ? "ont" : "a"} joué
              </small>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="dg-card-actions">
        <button className="dg-act nope clickable" onClick={skip} title="Passer au suivant">
          <X size={22} />
        </button>
        <button
          className="dg-act mid clickable"
          onClick={onPlayed}
          title="J'y ai déjà joué"
        >
          <Gamepad size={17} />
        </button>
        <button className="dg-act mid clickable" onClick={onOpen} title="Voir la fiche complète">
          <ExternalLink size={17} />
        </button>
        <button className="dg-act like clickable" onClick={addWishlist} title="Ajouter à ma wishlist">
          <Bookmark size={20} />
        </button>
      </div>
    </article>
  );
}

// --- Panneau médias (desktop) : trailer en autoplay (sans habillage YouTube),
// autres vidéos cliquables, et images du jeu qui défilent (auto + grab + flèches). ---
function GemAside({ full }) {
  const videos = (full?.media || []).filter((m) => m.type === "video");
  const images = (full?.media || []).filter((m) => m.type !== "video");
  const [activeVid, setActiveVid] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  const dragImg = useRef({ down: false, startX: 0 });

  const vid = activeVid || videos[0]?.videoId || null;
  const strip = images;

  const goImg = useCallback(
    (dir) => {
      if (strip.length < 2) return;
      setImgIdx((i) => (i + dir + strip.length) % strip.length);
    },
    [strip.length]
  );

  // Défilement automatique : le compte à rebours repart après chaque changement
  // (auto, flèche ou grab) — pas de saut juste après une action manuelle.
  useEffect(() => {
    if (strip.length < 2) return;
    const t = setTimeout(() => goImg(1), 3500);
    return () => clearTimeout(t);
  }, [imgIdx, goImg, strip.length]);

  // Grab : un glissement horizontal passe à l'image suivante / précédente.
  function onImgDown(e) {
    if (e.target.closest("button")) return;
    dragImg.current = { down: true, startX: e.clientX };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onImgUp(e) {
    if (!dragImg.current.down) return;
    dragImg.current.down = false;
    const d = e.clientX - dragImg.current.startX;
    if (d < -40) goImg(1);
    else if (d > 40) goImg(-1);
  }

  return (
    <aside className="dg-aside">
      {vid ? (
        <div className="dg-aside-video">
          <TrailerPlayer key={vid} videoId={vid} />
        </div>
      ) : full ? (
        images.length === 0 && (
          <div className="dg-aside-empty">
            <Gamepad2 size={26} />
            <p className="font-fun">Pas de médias pour ce jeu.</p>
          </div>
        )
      ) : (
        <div className="dg-aside-video">
          <span className="gp-skel" style={{ position: "absolute", inset: 0 }} />
        </div>
      )}

      {videos.length > 1 && (
        <div className="dg-aside-vids">
          {videos.map((v) => (
            <button
              key={v.videoId}
              className={`dg-aside-vid clickable ${vid === v.videoId ? "active" : ""}`}
              onClick={() => setActiveVid(v.videoId)}
              title={v.name}
            >
              <img src={v.thumb} alt="" loading="lazy" draggable="false" />
              <span className="dg-aside-vid-play">
                <Play size={13} fill="currentColor" strokeWidth={0} />
              </span>
            </button>
          ))}
        </div>
      )}

      {strip.length > 0 && (
        <div
          className="dg-aside-imgs"
          onPointerDown={onImgDown}
          onPointerUp={onImgUp}
          onPointerCancel={onImgUp}
        >
          {strip.map((m, i) => (
            <img
              key={m.id}
              src={m.thumb}
              alt=""
              loading="lazy"
              draggable="false"
              className={i === imgIdx ? "on" : ""}
            />
          ))}
          {strip.length > 1 && (
            <>
              <button
                className="dg-aside-arrow left clickable"
                onClick={() => goImg(-1)}
                aria-label="Image précédente"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="dg-aside-arrow right clickable"
                onClick={() => goImg(1)}
                aria-label="Image suivante"
              >
                <ChevronRight size={18} />
              </button>
              <span className="dg-aside-dots">
                {strip.slice(0, 8).map((m, i) => (
                  <i key={m.id} className={i === imgIdx % 8 ? "on" : ""} />
                ))}
              </span>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
