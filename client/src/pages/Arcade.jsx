import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Coins,
  Loader2,
  Sparkles,
  PackageOpen,
  MousePointer2,
  Check,
  X,
  Music2,
  Grid2x2,
  Mic2,
  Globe2,
  Trophy,
  Crown,
  Swords,
  ArrowRight,
  ChevronDown,
  Users,
  VenetianMask,
  Thermometer,
  Library,
  Lock,
  Layers,
  Bot,
  Flame,
  Gift,
  Store,
  Clock,
  User,
  Construction,
  MapPin,
} from "lucide-react";
import { GiParrotHead, GiPerspectiveDiceSixFacesRandom } from "react-icons/gi";
import { useAuth } from "../context/AuthContext";
import { useCosmetics } from "../context/CosmeticsContext";
import { apiFetch, API_BASE } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { applyGeoGlobe } from "../lib/geoGlobe";
import { makeCache } from "../lib/cache";
import { rarityColor, rarityLabel, rarityRank } from "../lib/rarity";
import RewardArt from "../components/RewardArt";
import CaseOpeningModal from "../components/CaseOpeningModal";
import FriendsCollectionModal from "../components/FriendsCollectionModal";
import GachaModal from "../components/GachaModal";
import PixelCanvas from "../components/PixelCanvas";
import BoosterPack from "../components/cards/BoosterPack";
import BombArt from "../components/bomb/BombArt";
import TcgCard from "../components/cards/TcgCard";
import { CARD_RARITIES } from "../lib/cards";

// ======================================================================
//  Arcade — la salle de jeux : mini-jeux, classements, cagnotte, curseurs
// ======================================================================
// Tout ce qui tourne autour des points vit ici, et nulle part ailleurs :
// l'accueil ne garde qu'une porte d'entrée.
//
// Troisième version (octobre 2026, styles/app-69-arcade-v2.css, préfixe .ax) :
//   - en-tête : le titre, et à droite la cagnotte (qui déroule l'historique),
//     les curseurs et la BOUTIQUE — qui n'occupe plus une section entière mais
//     s'ouvre en modale ;
//   - LE MOT DU JOUR en tête, un bandeau qui change selon où on en est
//     (pas commencé, en cours avec sa température, trouvé, abandonné) ;
//   - DÉFIS (Pixel Rush, GeoGamer, Grand Quiz, Blind Test…) puis ENTRE POTES,
//     La Party en dernier ;
//   - les CLASSEMENTS : un tableau, un onglet par jeu.

// Les jeux à score : leur classement est un onglet, leur record s'affiche sur
// la tuile. L'ordre est celui des onglets.
const GAMES = [
  {
    key: "mot",
    color: "#2f7de1",
    name: "Mot du jour",
    pitch:
      "Un mot, le même pour tout le monde jusqu'à minuit. Propose des mots proches : ça chauffe.",
    Icon: Thermometer,
    path: "/mot",
    api: "/mot/leaderboard",
    // Pas de bouton « Défier » ici : tout le monde joue DÉJÀ la même énigme le
    // même jour, il n'y a pas de set à rejouer. D'où l'absence d'identifiant.
    idOf: () => null,
  },
  {
    key: "pixel",
    color: "#7e60ff",
    name: "Pixel Rush",
    pitch: "Des captures noyées sous les pixels. Reconnais le jeu avant qu'elles se précisent.",
    Icon: Grid2x2,
    path: "/pixel",
    api: "/pixel/leaderboard",
    idOf: (e) => e.gameId,
  },
  {
    key: "geo",
    color: "#1f9d63",
    name: "GeoGamer",
    pitch: "Lâché quelque part dans un jeu, tu as 60 secondes pour trouver où tu es.",
    Icon: Globe2,
    path: "/geo",
    api: "/geo/leaderboard",
    idOf: (e) => e.geoGameId,
  },
  {
    key: "quiz",
    color: "#4f5ee8",
    name: "Le Grand Quiz",
    pitch:
      "Huit épreuves tirées au sort : questions, emojis, anagrammes, studios, duels de cartes, piles à trier. Seul ou à six.",
    Icon: Trophy,
    path: "/quiz",
    api: "/quiz/leaderboard",
    idOf: (e) => e.quizGameId,
  },
  {
    key: "blindtest",
    color: "#e84393",
    name: "Blind Test",
    pitch: "Un extrait d'OST tiré au sort. Devine le jeu avant la fin du morceau.",
    Icon: Music2,
    path: "/blindtest",
    api: "/blindtest/leaderboard",
    // Les classements partagent le même contrat, seul l'id de défi diffère.
    idOf: (e) => e.blindTestId,
  },
  {
    key: "perroquet",
    color: "#f0761c",
    name: "Le Perroquet",
    pitch:
      "Un bruit de jeu, et ta voix pour le refaire. Le plus proche marque — comme au bon vieux micro de la console.",
    Icon: Mic2,
    path: "/perroquet",
    api: "/perroquet/leaderboard",
    idOf: (e) => e.perroquetId,
  },
  {
    key: "imposteur",
    color: "#8b3fd9",
    name: "L'Imposteur",
    pitch:
      "Tout le monde a le même jeu, sauf un — qui l'ignore. Un mot chacun, puis on vote. À partir de 3 joueurs.",
    Icon: VenetianMask,
    path: "/imposteur",
    api: "/imposteur/leaderboard",
    // Aucun bouton « Défier » : il n'y a pas de set à rejouer, une partie est
    // une soirée avec des gens. Comme le Mot du jour, pas d'identifiant.
    idOf: () => null,
  },
];
const GAME = Object.fromEntries(GAMES.map((g) => [g.key, g]));

// Les deux rangées de tuiles. Le Mot du jour n'y est pas : il a le bandeau.
const SOLO = ["pixel", "geo", "quiz", "blindtest", "perroquet"]; // + Combat de cartes
const GROUP = ["imposteur"]; // + La Bombe, puis La Party en dernier

// Comment se joue chaque jeu : le badge de sa carte, une icône de perso par
// façon de jouer (seul, en duel, contre le bot, à plusieurs).
const SOLO_VS = [
  [User, "Solo"],
  [Swords, "Versus"],
];
const PLAY = {
  blindtest: SOLO_VS,
  pixel: SOLO_VS,
  geo: SOLO_VS,
  quiz: [[Users, "1 à 6"]],
  perroquet: SOLO_VS,
  imposteur: [[Users, "3 et +"]],
  battle: [
    [Bot, "Bot"],
    [Swords, "Duel"],
    [Users, "2v2"],
  ],
  bombe: [[Users, "2 à 8"]],
  party: [[Users, "2 à 4"]],
  mystery: [[Lock, "Secret"]],
};

// Les jeux pas encore ouverts : carte grisée, « Bientôt », pas de lien.
const SOON = new Set(["perroquet"]);

// Libellés des lignes du grand livre (miroir de POINT_SOURCES,
// server/src/models/PointEntry.js). Une source inconnue s'affiche telle quelle.
const SOURCE_LABELS = {
  blindtest: "Blind test",
  pixel: "Pixel Rush",
  geo: "GeoGamer",
  quiz: "Grand Quiz",
  quizversus: "Grand Quiz — versus",
  mot: "Mot du jour",
  perroquet: "Le Perroquet",
  imposteur: "L'Imposteur",
  bombe: "La Bombe",
  case: "Ouverture de caisse",
  cards: "Booster de cartes",
  cardbattle: "Combat de cartes",
  cardduel: "Duel de cartes",
  cardteam: "Combat de cartes à 2 contre 2",
  cardrecycle: "Cartes recyclées",
  cardforge: "Carte forgée",
  duplicate: "Doublon reconverti",
  admin: "Ajustement admin",
  backfill: "Parties d'avant l'arcade",
};

const MODES = [
  { key: "best", label: "Record", pick: (e) => e.bestScore ?? 0, hint: "Meilleur score en une partie" },
  { key: "total", label: "Total", pick: (e) => e.score ?? 0, hint: "Total cumulé de toutes les parties" },
];

// La porte d'entrée des caisses de collection, masquée pour l'instant.
// RIEN N'EST SUPPRIMÉ : le bandeau, la modale et toute la mécanique serveur
// restent en place — repasser cette constante à `true` les fait réapparaître
// (dans la Boutique). C'est aussi ce drapeau qui évite d'aller interroger
// /collection/gacha pour un bandeau qui ne s'affichera pas.
const SHOW_GACHA = false;

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// --- Caches stale-while-revalidate (mémoire + localStorage) ---
// On réaffiche la dernière version connue instantanément, puis on revalide en
// fond — le solde, l'inventaire et le bandeau du mot se recalent sans que rien
// ne clignote. Clés préfixées par l'id du compte : changer d'utilisateur ne
// montre jamais l'inventaire du précédent.
const arcadeCache = makeCache("mpl_arcade_", 10 * 60 * 1000);
const boardCache = makeCache("mpl_arcboard_", 5 * 60 * 1000);
const motCache = makeCache("mpl_arcmot_", 10 * 60 * 1000);

// Une modale de l'arcade : Échap ferme, la page derrière ne défile plus.
function useModal(onClose) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

export default function Arcade() {
  const { token, user, updateUser, hasFeature } = useAuth();
  const { setCosmetic } = useCosmetics();

  // « Traîne à l'arcade » : c'est le hall, donc l'endroit où l'on se croise
  // avant de lancer quoi que ce soit. C'est justement là qu'un ami qui passe
  // peut décider de jouer AVEC — d'où le lien.
  useLiveStatus("arcade", "", { token, path: "/arcade" });

  // Clé de cache : le compte courant. `null` tant que /auth/me n'a pas répondu —
  // et dans ce cas on ne lit ni n'écrit RIEN : une entrée « anonyme » partagée
  // montrerait l'inventaire du compte précédent au suivant.
  const meId = user?.id || null;

  // /arcade : solde, caisses, inventaire — amorcé depuis le cache s'il existe.
  const [data, setData] = useState(() => (meId && arcadeCache.get(meId)?.data) || null);
  // Classement par jeu. Une clé absente = « pas encore chargé » (squelette).
  const [boards, setBoards] = useState(() => {
    const b = {};
    if (!meId) return b;
    for (const g of GAMES) {
      const c = boardCache.get(`${meId}-${g.key}`);
      if (c) b[g.key] = c.data;
    }
    return b;
  });
  const [history, setHistory] = useState(null);
  const [showHist, setShowHist] = useState(false);
  const [openingBox, setOpeningBox] = useState(null);
  const [showShop, setShowShop] = useState(false);
  const [showCursors, setShowCursors] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [gacha, setGacha] = useState(null); // état du dôme (bandeau + modale)
  const [showGacha, setShowGacha] = useState(false);
  const [equipping, setEquipping] = useState(null);
  const [err, setErr] = useState("");

  // Toute écriture de `data` passe par ici : l'état ET le cache restent alignés.
  const commitData = useCallback(
    (next) =>
      setData((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (value && meId) arcadeCache.set(meId, value);
        return value;
      }),
    [meId]
  );

  useEffect(() => {
    // On attend de savoir QUI est connecté : c'est la clé du cache.
    if (!token || !meId) return;
    let alive = true;
    // L'image du globe choisie par l'admin (var CSS --geo-globe).
    applyGeoGlobe(token);
    apiFetch("/arcade", { token })
      .then((d) => {
        if (!alive) return;
        setErr("");
        commitData(d);
      })
      // Une revalidation ratée ne doit pas effacer un affichage valide.
      .catch((e) => alive && !arcadeCache.get(meId) && setErr(e.message));
    // Tous les classements en parallèle : les records s'affichent sur les
    // tuiles, inutile de les charger à la demande.
    for (const g of GAMES) {
      apiFetch(g.api, { token })
        .then((d) => {
          if (!alive) return;
          const entries = d.entries || [];
          boardCache.set(`${meId}-${g.key}`, entries);
          setBoards((b) => ({ ...b, [g.key]: entries }));
        })
        .catch(() => alive && setBoards((b) => (b[g.key] ? b : { ...b, [g.key]: [] })));
    }
    return () => {
      alive = false;
    };
  }, [token, meId, commitData]);

  // L'état des caisses de collection — seulement si la section est ouverte.
  const gachaOn = SHOW_GACHA && hasFeature("collection");
  const loadGacha = useCallback(() => {
    if (!token || !gachaOn) return;
    apiFetch("/collection/gacha", { token })
      .then(setGacha)
      .catch(() => {
        /* la machine ne s'affiche pas, le reste de l'arcade tourne */
      });
  }, [token, gachaOn]);
  useEffect(loadGacha, [loadGacha]);

  // L'historique se ferme d'un clic ailleurs, comme n'importe quel menu.
  const walletRef = useRef(null);
  useEffect(() => {
    if (!showHist) return;
    const onDown = (e) => walletRef.current && !walletRef.current.contains(e.target) && setShowHist(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showHist]);

  function toggleHistory() {
    setShowHist((v) => !v);
    if (history) return;
    apiFetch("/arcade/history", { token })
      .then((d) => setHistory(d.entries || []))
      .catch(() => setHistory([]));
  }

  // Résultat d'une ouverture : on recale solde + inventaire sans refetch.
  function applyResult(res) {
    commitData((d) => {
      if (!d) return d;
      const has = d.inventory.some((r) => r.key === res.reward.key);
      return {
        ...d,
        points: res.points,
        inventory: has
          ? d.inventory.map((r) =>
              r.key === res.reward.key ? { ...r, count: (r.count || 1) + 1 } : r
            )
          : [
              ...d.inventory,
              { ...res.reward, obtainedAt: new Date().toISOString(), count: 1 },
            ],
      };
    });
    updateUser({ points: res.points });
    setHistory(null); // l'historique a une ligne de plus
  }

  async function toggleEquip(reward) {
    if (equipping) return; // une bascule à la fois
    const isOn = data.equipped[reward.type] === reward.key;
    setEquipping(reward.key);
    try {
      const d = await apiFetch("/arcade/equip", {
        method: "POST",
        token,
        body: isOn ? { rewardKey: null, type: reward.type } : { rewardKey: reward.key },
      });
      commitData((prev) => (prev ? { ...prev, equipped: d.equipped } : prev));
      updateUser({ equipped: d.equipped });
      // Effet immédiat : le curseur change sous les yeux, sans recharger.
      setCosmetic(reward.type, isOn ? null : reward);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEquipping(null);
    }
  }

  const points = data?.points ?? user?.points ?? 0;
  const covers = data?.covers || [];
  const tileCover = (i) => (covers.length ? covers[i % covers.length] : null);

  // Les caisses encore utiles : celles qui distribuent des curseurs (les
  // thèmes ne se gagnent plus).
  const crates = (data?.cases || []).filter((c) => (c.rewards || []).some((r) => r.type === "cursor"));
  const byRarity = (a, b) =>
    rarityRank(b.rarity) - rarityRank(a.rarity) ||
    new Date(b.obtainedAt || 0) - new Date(a.obtainedAt || 0);
  const cursors = (data?.inventory || []).filter((r) => r.type === "cursor").sort(byRarity);
  const cursorTotal = new Set(
    crates.flatMap((c) => (c.rewards || []).filter((r) => r.type === "cursor").map((r) => r.key))
  ).size;

  const mineOf = (key) => (boards[key] || []).find((e) => e.isMe);
  const scoreTile = (key, i) => {
    const g = GAME[key];
    const mine = mineOf(key);
    return (
      <Tile
        key={key}
        k={key}
        to={g.path}
        soon={SOON.has(key)}
        name={g.name}
        pitch={g.pitch}
        art={<GameArt game={g} cover={tileCover(i)} cover2={tileCover(i + 1)} />}
        stat={
          mine ? (
            <>
              <Trophy size={13} /> <b>{fmt(mine.bestScore)}</b>
            </>
          ) : null
        }
      />
    );
  };

  return (
    <div className="ax">
      {/* ---------- En-tête : titre · cagnotte · curseurs · boutique ---------- */}
      <header className="ax-head">
        <h1 className="ax-title">Arcade</h1>
        <div className="ax-tools">
          <div className="ax-wallet-wrap" ref={walletRef}>
            <button
              className={`ax-wallet clickable ${showHist ? "on" : ""}`}
              onClick={toggleHistory}
              title="Historique des points"
              aria-expanded={showHist}
            >
              <span className="ax-coin">
                <Coins size={16} />
              </span>
              <b>{fmt(points)}</b>
              <ChevronDown size={15} className="ax-caret" />
            </button>
            {showHist && (
              <div className="ax-hist">
                {history === null ? (
                  <div className="arc-state" style={{ minHeight: 80 }}>
                    <Loader2 size={18} className="spin" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="ax-hist-empty">Aucun mouvement pour l'instant.</p>
                ) : (
                  <ul className="ax-hist-list">
                    {history.map((h) => (
                      <li className="ax-hist-row" key={h.id}>
                        <span className="ax-hist-src">{SOURCE_LABELS[h.source] || h.source}</span>
                        <span className="ax-hist-date">
                          {new Date(h.date).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className={`ax-hist-amt ${h.amount >= 0 ? "up" : "down"}`}>
                          {h.amount >= 0 ? `+${fmt(h.amount)}` : fmt(h.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            className="ax-round clickable"
            onClick={() => setShowCursors(true)}
            title="Mes curseurs"
            aria-label="Mes curseurs"
          >
            <MousePointer2 size={18} />
          </button>
          <button className="ax-shop-btn clickable" onClick={() => setShowShop(true)} title="Boutique">
            <Store size={18} />
            <span>Boutique</span>
          </button>
        </div>
      </header>

      {err && <p className="arc-err">{err}</p>}

      {/* ---------- Le Mot du jour, à la une ---------- */}
      <MotHero token={token} meId={meId} />

      {/* ---------- Les défis ---------- */}
      <section className="ax-sec">
        <h2 className="ax-h">Défis</h2>
        <div className="ax-grid">
          {SOLO.map((k, i) => scoreTile(k, i))}
          <BattleTile token={token} />
        </div>
      </section>

      {/* ---------- Entre potes — La Party ferme la marche ---------- */}
      <section className="ax-sec">
        <h2 className="ax-h">Entre potes</h2>
        <div className="ax-grid">
          {GROUP.map((k, i) => scoreTile(k, SOLO.length + 3 + i))}
          <BombTile />
          <Tile
            k="party"
            to="/party"
            name="La Party"
            soon
            art={
              <span className="arc-game-art ax-art-icon" aria-hidden="true">
                <GiPerspectiveDiceSixFacesRandom />
              </span>
            }
          />
          <MysteryTile n={1} />
          <MysteryTile n={2} />
          <MysteryTile n={3} />
        </div>
      </section>

      {/* ---------- Les classements : un tableau, un onglet par jeu ---------- */}
      <section className="ax-sec">
        <h2 className="ax-h">Classements</h2>
        <Boards boards={boards} />
      </section>

      {showShop && (
        <ShopModal
          points={points}
          crates={crates}
          cursorsLabel={cursorTotal > 0 ? `${cursors.length}/${cursorTotal}` : null}
          gacha={gachaOn && gacha?.total > 0 ? gacha : null}
          onOpenCrate={(c) => {
            setShowShop(false);
            setOpeningBox(c);
          }}
          onCursors={() => {
            setShowShop(false);
            setShowCursors(true);
          }}
          onFriends={() => {
            setShowShop(false);
            setShowFriends(true);
          }}
          onGacha={() => {
            setShowShop(false);
            setShowGacha(true);
          }}
          onClose={() => setShowShop(false)}
        />
      )}

      {showCursors && (
        <CursorsModal
          items={cursors}
          total={cursorTotal}
          points={points}
          crate={crates[0] || null}
          onOpenCrate={(c) => setOpeningBox(c)}
          onClose={() => setShowCursors(false)}
          equippedOf={(r) => data?.equipped?.[r.type] === r.key}
          equipping={equipping}
          onEquip={toggleEquip}
        />
      )}

      {showFriends && (
        <FriendsCollectionModal token={token} onClose={() => setShowFriends(false)} />
      )}

      {openingBox && (
        <CaseOpeningModal
          box={openingBox}
          token={token}
          onClose={() => setOpeningBox(null)}
          onResult={applyResult}
        />
      )}

      {showGacha && (
        <GachaModal
          token={token}
          onClose={() => setShowGacha(false)}
          onDrawn={(res) => {
            updateUser({ points: res.points });
            commitData((d) => (d ? { ...d, points: res.points } : d));
            setGacha((g) =>
              g
                ? {
                    ...g,
                    points: res.points,
                    owned: res.owned,
                    balls: g.balls.map((b) =>
                      b.slug === res.media?.slug ? { ...b, owned: true } : b
                    ),
                  }
                : g
            );
            setHistory(null); // l'historique des points a une ligne de plus
          }}
        />
      )}
    </div>
  );
}

// ======================================================================
//  Le Mot du jour, à la une
// ======================================================================
// Le bandeau raconte MA journée sur le mot, dans une couleur qui change avec
// elle : bleu tant que rien n'est joué (des cases « ? » qui attendent), la
// couleur de la température en cours de partie, or une fois trouvé (le mot en
// tuiles qui se retournent, et des confettis), gris après un abandon. La
// pastille octogonale résume l'état ; toujours : le compte à rebours jusqu'au
// prochain mot et les amis qui l'ont déjà trouvé.
//
// Les émojis de palier sont ceux de la page du jeu (pages/MotDuJour.jsx).
const BANDS = {
  glacial: { emoji: "🧊", label: "Glacial" },
  frais: { emoji: "❄️", label: "Frais" },
  tiede: { emoji: "🌡️", label: "Tiède" },
  chaud: { emoji: "🔥", label: "Chaud" },
  bouillant: { emoji: "🌋", label: "Bouillant" },
};
// La tête qu'on fait à chaque palier : à gauche de la jauge.
const MOODS = {
  glacial: "🥶",
  frais: "😬",
  tiede: "🙂",
  chaud: "🥵",
  bouillant: "🤯",
};
function bandOf(temp) {
  if (temp >= 90) return "bouillant";
  if (temp >= 75) return "chaud";
  if (temp >= 50) return "tiede";
  if (temp >= 25) return "frais";
  return "glacial";
}

function fmtLeft(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// Ce que le bandeau garde de /mot/today et /mot/board : pas la liste des
// essais (des centaines), juste de quoi raconter la journée.
function motSummary(d, b) {
  const entries = b?.entries || [];
  const seen = new Set();
  const friends = [];
  for (const e of entries) {
    if (e.isMe) continue;
    for (const u of e.team || [e.user]) {
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id);
      friends.push({ id: u.id, username: u.username, avatar: u.avatar || null });
    }
  }
  const rank = entries.findIndex((e) => e.isMe);
  return {
    until: Date.now() + (d.msUntilNext || 0),
    tries: d.tries || 0,
    solved: !!d.solved,
    gaveUp: !!d.gaveUp,
    word: d.word || null,
    pointsEarned: d.pointsEarned || 0,
    best: d.guesses?.length ? Math.round(d.guesses[0].temp) : null,
    players: d.stats?.players || 0,
    friends,
    rank: rank >= 0 ? rank + 1 : null,
  };
}

function MotHero({ token, meId }) {
  const [s, setS] = useState(() => (meId && motCache.get(meId)?.data) || null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!token || !meId) return;
    let alive = true;
    Promise.all([
      apiFetch("/mot/today", { token }),
      apiFetch("/mot/board", { token }).catch(() => null),
    ])
      .then(([d, b]) => {
        if (!alive) return;
        const v = motSummary(d, b);
        motCache.set(meId, v);
        setS(v);
      })
      .catch(() => {
        /* dictionnaire absent, réseau : le bandeau reste en « à jouer » */
      });
    return () => {
      alive = false;
    };
  }, [token, meId]);

  // Le compte à rebours avance tout seul, à la minute près.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Minuit passé (ou cache de la veille) : un nouveau mot attend, l'état
  // connu ne vaut plus rien.
  const live = s && now < s.until ? s : null;
  const st = !live ? "fresh" : live.solved ? "won" : live.gaveUp ? "lost" : live.tries > 0 ? "hot" : "fresh";
  const band = st === "hot" && live.best != null ? bandOf(live.best) : "glacial";
  const left = live ? live.until - now : null;
  const friends = live?.friends || [];
  const cta = { fresh: "Jouer", hot: "Continuer", won: "Le tableau", lost: "Le tableau" }[st];
  const essais = live ? `${fmt(live.tries)} essai${live.tries > 1 ? "s" : ""}` : "";
  // Où j'en suis sur l'échelle de chaleur : 0 tant que rien n'est joué, mon
  // meilleur essai en cours de partie, le sommet une fois trouvé.
  const heat = st === "won" ? 100 : st === "hot" ? Math.max(3, Math.min(100, live.best ?? 0)) : 0;

  return (
    <Link to="/mot" className={`ax-mot st-${st} b-${band} clickable`}>
      <span className="ax-rays" aria-hidden="true" />
      {st === "won" && <Confetti />}

      {/* L'icône : deux tuiles de lettres posées l'une sur l'autre, celle de
          devant résume la journée d'un coup d'œil. */}
      <span className="ax-motic" aria-hidden="true">
        <span className="back">M</span>
        <span className="front">
          {st === "won" ? (
            <Trophy size={28} strokeWidth={2.6} />
          ) : st === "hot" ? (
            <em>{BANDS[band].emoji}</em>
          ) : st === "lost" ? (
            <X size={30} strokeWidth={3} />
          ) : (
            <b>?</b>
          )}
        </span>
      </span>

      <span className="ax-mot-body">
        <span className="ax-mot-title">Mot du jour</span>
        <span className="ax-mot-line">
          {st === "won" || st === "lost" ? (
            <WordTiles word={live.word || "?"} />
          ) : st === "hot" ? (
            <span className="ax-mot-heat">
              {BANDS[band].label} <b>{live.best ?? 0}°</b>
            </span>
          ) : (
            <WordTiles word="?????" mystery />
          )}
        </span>
        <span className="ax-mot-meta">
          {st === "won" ? (
            <>
              <span>{essais}</span>
              {live.pointsEarned > 0 && (
                <span>
                  <Coins size={13} /> +{fmt(live.pointsEarned)}
                </span>
              )}
              {live.rank && friends.length > 0 && (
                <span>
                  <Crown size={13} /> {live.rank === 1 ? "1er" : `${live.rank}e`} du cercle
                </span>
              )}
            </>
          ) : st === "lost" ? (
            <span>Abandonné après {essais}</span>
          ) : st === "hot" ? (
            <span>{essais}</span>
          ) : live?.players ? (
            <span>
              <Users size={13} /> {fmt(live.players)} joueur{live.players > 1 ? "s" : ""} aujourd'hui
            </span>
          ) : null}
          {friends.length > 0 && st !== "won" && (
            <span>
              <span className="ax-avs">
                {friends.slice(0, 4).map((f) =>
                  f.avatar ? (
                    <img key={f.id} src={f.avatar} alt="" title={f.username} loading="lazy" />
                  ) : (
                    <i key={f.id} title={f.username}>
                      {f.username[0].toUpperCase()}
                    </i>
                  )
                )}
              </span>
              {friends.length === 1 ? `${friends[0].username} l'a trouvé` : `${friends.length} amis l'ont trouvé`}
            </span>
          )}
        </span>
      </span>

      {st !== "lost" && (
        <span className={`ax-gauge ${st}`} style={{ "--t": `${heat}%` }} aria-label={`${heat}°`}>
          <span className="ax-gauge-mood" key={st === "won" ? "won" : band}>
            {st === "won" ? "🥳" : MOODS[st === "fresh" ? "glacial" : band]}
          </span>
          <span className="ax-gauge-meter">
          <span className="ax-gauge-track">
            <i className="fill" />
          </span>
          <span className="ax-gauge-dot">
            <em>{st === "fresh" ? "🧊" : st === "won" ? "🌋" : BANDS[band].emoji}</em>
            {st !== "fresh" && <b>{heat}°</b>}
          </span>
          <span className="ax-gauge-ends">
            <span>Glacial</span>
            <span>Bouillant</span>
          </span>
          </span>
        </span>
      )}

      {/* L'appel à l'action, seul et centré ; le temps qui reste dessous. */}
      <span className="ax-mot-side">
        <span className="ax-mot-cta">
          {cta} <ArrowRight size={18} strokeWidth={2.8} />
        </span>
        {left > 0 && (
          <span className="ax-mot-clock">
            <Clock size={12} /> {st === "won" || st === "lost" ? "Prochain mot dans" : "Encore"} {fmtLeft(left)}
          </span>
        )}
      </span>
    </Link>
  );
}

// Le mot en tuiles de lettres, qui se retournent l'une après l'autre. Un mot
// composé passe à la ligne ENTRE ses mots, jamais au milieu ; les tuiles
// rétrécissent pour que le plus long tienne sur une ligne (--n, voir le CSS).
function WordTiles({ word, mystery }) {
  const parts = word.toUpperCase().split(/[\s-]+/).filter(Boolean);
  const n = Math.max(5, ...parts.map((p) => [...p].length));
  let i = 0;
  return (
    <span
      className={`ax-word ${mystery ? "mystery" : ""}`}
      style={{ "--n": n }}
      aria-label={mystery ? "Mot à trouver" : word}
    >
      {parts.map((p, j) => (
        <span key={j} className="ax-word-grp">
          {[...p].map((c) => (
            <span key={i} className="ax-word-l" style={{ "--i": i++ }}>
              {c}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

// Une poignée de confettis plats qui tombent une fois, à l'arrivée.
const CONFETTI = ["#f2b70b", "#ff5470", "#2fa8f5", "#3ddc84", "#7e60ff"];
function Confetti() {
  return (
    <span className="ax-confetti" aria-hidden="true">
      {Array.from({ length: 18 }, (_, i) => (
        <i
          key={i}
          style={{
            "--x": `${(i * 37) % 100}%`,
            "--d": `${(i % 6) * 0.12}s`,
            "--r": `${(i % 2 ? 1 : -1) * (180 + i * 25)}deg`,
            background: CONFETTI[i % CONFETTI.length],
          }}
        />
      ))}
    </span>
  );
}

// ======================================================================
//  Les cartes de jeu
// ======================================================================
// Des cartes portrait façon jaquette d'arcade : un aplat vif dans la couleur
// du jeu, des rayons qui tournent au survol, l'art d'origine au centre et le
// titre en grosses lettres blanches en bas. Pas de paragraphe : le pitch reste
// en infobulle. Les classes .arc-game g-* gardent les animations de survol de
// chaque art.
function Tile({ k, to, name, pitch, art, stat, cta = "Jouer", fresh, soon, mystery, hover }) {
  const inner = (
    <>
      <span className="ax-rays" aria-hidden="true" />
      <span className="ax-card-art">{art}</span>
      <span className="ax-badge">
        {PLAY[k].map(([Icon, label]) => (
          <span key={label}>
            <Icon size={11} strokeWidth={2.6} />
            {label}
          </span>
        ))}
      </span>
      {soon || mystery ? (
        <span className="ax-kick soon">
          <Construction size={12} strokeWidth={2.6} /> Bientôt
        </span>
      ) : (
        fresh && <span className="ax-kick">Nouveau</span>
      )}
      <span className="ax-card-name">{name}</span>
      {stat && !soon && !mystery && <span className="ax-card-stat">{stat}</span>}
    </>
  );
  // Pas encore jouable : la carte est là, grisée, mais ne mène nulle part.
  if (soon || mystery)
    return (
      <span
        className={`arc-game g-${k} ax-card ${soon ? "soon" : "mystery"}`}
        title={mystery ? "Un nouveau jeu arrive…" : `${name} — bientôt`}
        aria-disabled="true"
      >
        {inner}
      </span>
    );
  return (
    <Link
      to={to}
      className={`arc-game g-${k} ax-card clickable`}
      title={pitch}
      aria-label={`${name} — ${cta}`}
      {...hover}
    >
      {inner}
    </Link>
  );
}

// Les jeux à venir : une boîte mystère, rien d'autre. Chacune dans sa couleur.
function MysteryTile({ n }) {
  return (
    <Tile
      k="mystery"
      name="???"
      mystery
      art={
        <span className={`arc-game-art ax-art-box m${n}`} aria-hidden="true">
          <span className="ax-box">
            <b>?</b>
          </span>
        </span>
      }
    />
  );
}

// La Bombe : mèche éteinte au repos, elle s'allume (et la bombe clignote)
// quand la souris passe dessus.
function BombTile() {
  const [lit, setLit] = useState(false);
  return (
    <Tile
      k="bombe"
      to="/bombe"
      name="La Bombe"
      fresh
      pitch="Un studio, une console, des lettres : tape un jeu qui colle et passe la bombe avant qu'elle explose."
      hover={{ onMouseEnter: () => setLit(true), onMouseLeave: () => setLit(false) }}
      art={
        <span className="arc-game-art ax-art-bomb" aria-hidden="true">
          <span className={`ax-bomb ${lit ? "on" : ""}`}>
            <BombArt lit={lit} />
          </span>
        </span>
      }
    />
  );
}

// Le Combat de cartes : un duel contre le bot plutôt qu'un score à battre —
// pas de record, mais le niveau du bot, la série en cours, le booster à
// récupérer. L'art : deux vraies jaquettes qui se croisent comme deux lames.
function BattleTile({ token }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch("/cards/battle", { token })
      .then(
        (d) =>
          alive &&
          setInfo({
            ...d.stats,
            live: !!d.live && !d.live.end,
            locked: (d.cards ?? 0) < (d.minCards || 15),
            min: d.minCards || 15,
            showcase: d.showcase || [],
          })
      )
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);
  const stat = info?.locked ? (
    <>
      <Lock size={13} /> Dès <b>{info.min}</b> cartes
    </>
  ) : info?.claimable > 0 ? (
    <span className="arc-battle-gift">
      <Gift size={13} /> Booster à récupérer
    </span>
  ) : info?.streak > 0 ? (
    <>
      <Flame size={13} /> Série <b>{fmt(info.streak)}</b>
    </>
  ) : info ? (
    <>
      <Bot size={13} /> Bot niv. <b>{info.level}</b>
    </>
  ) : null;
  return (
    <Tile
      k="battle"
      to="/cartes/combat"
      name="Combat de cartes"
      pitch="Un défi tombe, tu poses ta carte face cachée, on retourne. Bats le bot avec ton classeur."
      cta={info?.live ? "Reprendre" : "Jouer"}
      stat={stat}
      art={
        // Les deux plus belles cartes du classeur, des VRAIES cartes du jeu ;
        // sans classeur, deux dos de cartes.
        <span className="arc-game-art ax-art-duel" aria-hidden="true">
          <span className="ax-duel-card a">
            <TcgCard card={info?.showcase?.[0] || null} size={62} tilt={false} lite />
          </span>
          <span className="ax-duel-card b">
            <TcgCard card={info?.showcase?.[1] || null} size={62} tilt={false} lite />
          </span>
          <span className="ax-duel-vs">VS</span>
        </span>
      }
    />
  );
}

// ======================================================================
//  La Boutique (modale)
// ======================================================================
// Les boosters de cartes, les caisses de curseurs, et les portes vers « Mes
// curseurs » et les collections des amis. Ouvrir une caisse ferme la boutique :
// l'ouverture prend tout l'écran.
function ShopModal({ points, crates, cursorsLabel, gacha, onOpenCrate, onCursors, onFriends, onGacha, onClose }) {
  useModal(onClose);
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="abar-modal ax-shop-modal">
        <div className="abar-modal-head">
          <div className="abar-modal-title">
            <h2>Boutique</h2>
          </div>
          <span className="ax-shop-bal">
            <Coins size={14} /> {fmt(points)}
          </span>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="abar-modal-body">
          <div className="ax-shop">
            <CardsDoor points={points} />
            {crates.map((c) => (
              <Crate key={c.id} crate={c} points={points} onOpen={() => onOpenCrate(c)} />
            ))}
          </div>
          {gacha && <GachaBanner gacha={gacha} points={points} onOpen={onGacha} />}
          <div className="ax-shop-links">
            <button className="ax-chip clickable" onClick={onCursors}>
              <MousePointer2 size={15} /> Mes curseurs
              {cursorsLabel && <em>{cursorsLabel}</em>}
            </button>
            <button className="ax-chip clickable" onClick={onFriends}>
              <Users size={15} /> Les collections
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Format du canvas de la jaquette pixelisée : 3/4, comme une jaquette.
const ART_CV_W = 186;
const ART_CV_H = 248;

function GameArt({ game, cover, cover2 }) {
  // GeoGamer ne dépend PAS de la bibliothèque du joueur : son art est un
  // panorama fixe, le même pour tout le monde. D'où ce branchement avant le
  // garde-fou ci-dessous — la carte a son globe même sur un compte vide.
  if (game.key === "geo") {
    // Une carte dépliée en trois volets (le panorama du jeu comme papier), et
    // la punaise qui tombe dessus au survol : « trouve où tu es ».
    return (
      <span className="arc-game-art ax-art-map" aria-hidden="true">
        <span className="ax-map">
          <i />
          <i />
          <i />
        </span>
        <span className="ax-pin">
          <MapPin size={34} strokeWidth={2.2} />
        </span>
        <span className="ax-pin-ring" />
      </span>
    );
  }
  // Le Mot du jour ne dépend pas non plus de la bibliothèque : son art est
  // l'instrument lui-même. Une fiche d'essais au gabarit d'une jaquette (pour
  // rester dans la grammaire des autres cartes) et, posé derrière comme le
  // vinyle du Blind Test, le thermomètre dont le mercure monte en boucle
  // lente. On lit la règle — des mots, une température — sans avoir cliqué.
  if (game.key === "mot") {
    return (
      <span className="arc-game-art" aria-hidden="true">
        <span className="arc-art-mot">
          <span className="arc-art-mot-thermo">
            <span className="arc-art-mot-fill" />
          </span>
          <span className="arc-art-mot-bulb" />
          <span className="arc-art-mot-sheet">
            <i className="cold" />
            <i className="warm" />
            <i className="hot" />
          </span>
        </span>
      </span>
    );
  }
  // Le Perroquet ne dépend pas non plus de la bibliothèque : ce qu'on imite est
  // un son, pas un jeu. Son art est donc l'instrument — un micro de studio sur
  // sa suspension, et les ondes qui en partent. C'est la carte la plus sobre de
  // la grille, et c'est voulu : les autres montrent ce qu'on doit RECONNAÎTRE,
  // celle-ci montre ce avec quoi on va JOUER.
  if (game.key === "perroquet") {
    return (
      <span className="arc-game-art ax-art-icon" aria-hidden="true">
        <GiParrotHead />
      </span>
    );
  }
  // L'Imposteur ne dépend pas non plus de la bibliothèque : ce qu'on cherche
  // n'est pas un jeu mais une PERSONNE. Son art est donc la règle elle-même,
  // jouée avec la paire d'exemple du jeu — DEUX fois Animal Crossing, UNE fois
  // Tomodachi Life. On comprend le mode sans avoir lu une ligne : trois cartes
  // qui se ressemblent, et une qui n'est pas la bonne.
  //
  // Les deux jaquettes sont servies depuis /public (client/public/arcade) et
  // non depuis IGDB : c'est le seul art de la grille qui ne vient pas de la
  // bibliothèque du joueur, donc rien ne le fournirait à l'exécution — et deux
  // fichiers de 14 Ko posés à côté de l'app coûtent moins qu'un aller-retour
  // vers un CDN externe à chaque affichage de l'arcade. La première carte et
  // la deuxième pointent le MÊME fichier : le navigateur ne le charge qu'une
  // fois, et c'est aussi ce qui rend les deux « pareilles » au pixel près.
  if (game.key === "imposteur") {
    return (
      <span className="arc-game-art" aria-hidden="true">
        <span className="arc-art-imp">
          <span className="arc-art-imp-card a">
            <img src="/arcade/imposteur-a.jpg" alt="" loading="lazy" draggable="false" />
          </span>
          <span className="arc-art-imp-card b">
            <img src="/arcade/imposteur-a.jpg" alt="" loading="lazy" draggable="false" />
          </span>
          <span className="arc-art-imp-card c odd">
            <img src="/arcade/imposteur-b.jpg" alt="" loading="lazy" draggable="false" />
            <i className="arc-art-imp-mask">
              <VenetianMask size={11} />
            </i>
          </span>
        </span>
      </span>
    );
  }
  // Le Grand Quiz : sa règle n'est pas « reconnais ce jeu » mais « choisis ».
  // D'où DEUX jaquettes côte à côte, A et B, et le buzzer par-dessus qu'on
  // écrase au survol — la bonne réponse se cerne alors de vert. Rien du
  // vinyle-dans-sa-pochette du Blind Test, qu'il reprenait jusqu'ici par
  // défaut. Il faut DEUX jaquettes DIFFÉRENTES : un choix entre deux fois la
  // même image n'aurait aucun sens, donc sur une bibliothèque trop courte on
  // retombe sur la pastille plutôt que sur l'art d'un autre jeu.
  if (game.key === "quiz") {
    if (!cover?.cover || !cover2?.cover || cover2.cover === cover.cover) {
      return (
        <span className="arc-game-art fallback" aria-hidden="true">
          <game.Icon size={30} />
        </span>
      );
    }
    return (
      <span className="arc-game-art" aria-hidden="true">
        {/* Au survol, on buzze : A s'éteint (grisée), B s'allume en vert. */}
        <span className="arc-art-quiz ax-quiz">
          <span className="arc-art-quiz-pick a bad">
            <img src={cover.cover} alt="" loading="lazy" draggable="false" />
            <b>A</b>
          </span>
          <span className="arc-art-quiz-pick b good">
            <img src={cover2.cover} alt="" loading="lazy" draggable="false" />
            <b>B</b>
            <em>
              <Check size={18} strokeWidth={3.4} />
            </em>
          </span>
          <span className="ax-buzz">
            <i className="dome" />
            <i className="base" />
          </span>
        </span>
      </span>
    );
  }
  // Bibliothèque vide ou jaquette manquante : on retombe sur la pastille.
  if (!cover?.cover) {
    return (
      <span className="arc-game-art fallback" aria-hidden="true">
        <game.Icon size={30} />
      </span>
    );
  }
  if (game.key === "pixel") {
    // Une jaquette pixelisée, un « ? » devant. Au survol, elle se précise par
    // paliers (de gros blocs, puis plus fins, puis nette) — comme une manche
    // du jeu en accéléré.
    const px = (blocks) => (
      <PixelCanvas src={cover.cover} blocks={blocks} reveal={false} label="" w={ART_CV_W} h={ART_CV_H} />
    );
    return (
      <span className="arc-game-art ax-art-px" aria-hidden="true">
        <span className="ax-px">
          <span className="ax-px-l l0">{px(7)}</span>
          <span className="ax-px-l l1">{px(14)}</span>
          <span className="ax-px-l l2">{px(30)}</span>
          <img className="ax-px-l l3" src={cover.cover} alt="" loading="lazy" draggable="false" />
        </span>
        <b className="ax-px-q">?</b>
      </span>
    );
  }
  return <DiscArt cover={cover} />;
}

// ---------- Le Blind Test : un vinyle, le logo du jeu sur l'étiquette ----------
// Le logo détouré vient de GET /games/backdrops (Steam) ; sans logo, le nom du
// jeu est imprimé à sa place. Le disque tourne au survol.
const logoCache = new Map(); // gameId -> url | null
function DiscArt({ cover }) {
  const id = cover?.gameId ? String(cover.gameId) : null;
  const [logo, setLogo] = useState(() => (id ? logoCache.get(id) : undefined));
  useEffect(() => {
    if (!id || logoCache.has(id)) {
      setLogo(id ? logoCache.get(id) : null);
      return;
    }
    let alive = true;
    apiFetch(`/games/backdrops?ids=${id}`)
      .then((d) => {
        const path = d?.logos?.[id];
        logoCache.set(id, path ? `${API_BASE}${path}` : null);
      })
      .catch(() => logoCache.set(id, null))
      .finally(() => alive && setLogo(logoCache.get(id)));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <span className="arc-game-art ax-art-vinyl" aria-hidden="true">
      {/* Le reflet est HORS du disque : la lumière ne tourne pas avec lui. */}
      <i className="ax-vinyl-sheen" />
      <span className="ax-vinyl">
        <span className="ax-vinyl-label">
          {logo ? (
            <img src={logo} alt="" draggable="false" onError={() => setLogo(null)} />
          ) : (
            <b>{cover?.name || "OST"}</b>
          )}
          <i className="ax-vinyl-hole" />
        </span>
      </span>
    </span>
  );
}

// ---------- La modale « Mes curseurs » ----------
// La collection vit dans une modale plutôt qu'en pleine page : elle grandit à
// chaque caisse et ne se consulte que ponctuellement, pour équiper. Le bouton
// qui l'ouvre est dans l'en-tête, et dans la Boutique.
function CursorsModal({
  items,
  total,
  points,
  crate,
  equippedOf,
  equipping,
  onEquip,
  onOpenCrate,
  onClose,
}) {
  useModal(onClose);

  const afford = crate ? points >= crate.price : false;
  const missing = crate ? crate.price - points : 0;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="abar-modal">
        <div className="abar-modal-head">
          <div className="abar-modal-title">
            <h2>Mes curseurs</h2>
            {total > 0 && (
              <span className="abar-count">
                {items.length} / {total}
              </span>
            )}
          </div>

          {/* Solde insuffisant : on laisse cliquable (voir le contenu de la
              caisse a de l'intérêt) mais on ne le fait plus briller. */}
          {crate?.openable && (
            <button
              className={`abar-get clickable ${afford ? "" : "poor"}`}
              onClick={() => onOpenCrate(crate)}
              title={
                afford
                  ? `Ouvrir une caisse — ${fmt(crate.price)} points`
                  : `Il te manque ${fmt(missing)} points`
              }
            >
              <Sparkles size={15} />
              Nouveau curseur
              <b>
                <Coins size={12} /> {fmt(crate.price)}
              </b>
            </button>
          )}

          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="abar-modal-body">
          {items.length === 0 ? (
            <p className="arc-inv-empty">
              Aucun curseur pour l'instant — ouvre une caisse pour en débloquer.
            </p>
          ) : (
            <>
              <div className="arc-inv-grid">
                {items.map((r) => {
                  const on = equippedOf(r);
                  return (
                    <article
                      className={`arc-inv-card ${on ? "equipped" : ""}`}
                      key={r.key}
                      style={{ "--arc-rarity": rarityColor(r.rarity) }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={on}
                      title={on ? "Cliquer pour retirer" : "Cliquer pour équiper"}
                      onClick={() => onEquip(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onEquip(r);
                        }
                      }}
                    >
                      <span className="arc-inv-aura" aria-hidden="true" />
                      {r.count > 1 && <span className="arc-inv-count">×{r.count}</span>}
                      <div className="arc-inv-art">
                        <RewardArt reward={r} size={54} />
                      </div>
                      <span className="arc-inv-rarity">{rarityLabel(r.rarity)}</span>
                      <h3 className="arc-inv-name">{r.name}</h3>
                      <span className={`arc-equip ${on ? "on" : ""}`}>
                        {equipping === r.key ? (
                          <Loader2 size={13} className="spin" />
                        ) : on ? (
                          <>
                            <Check size={13} /> Équipé
                          </>
                        ) : (
                          "Équiper"
                        )}
                      </span>
                    </article>
                  );
                })}
              </div>
              <p className="arc-inv-note">
                Le curseur équipé s'applique partout dans l'app, sur ordinateur
                uniquement.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- La caisse de collection, vue depuis l'arcade ----------
// Une PORTE, pas la caisse : la vraie, celle qui tremble et qui claque, vit
// dans la modale (GachaModal) et prend tout l'écran parce que c'est un moment.
// Ici on montre juste de quoi donner envie de pousser la porte — une caisse en
// miniature, entrebâillée sur les boules qu'elle contient encore, et les
// dernières jaquettes qui manquent.
function GachaBanner({ gacha, points, onOpen }) {
  const { owned, total, price, balls = [] } = gacha;
  const left = Math.max(0, total - owned);
  const afford = points >= price;
  const complete = left === 0;
  // Les manquants d'abord : c'est eux qu'on vient chercher. À collection
  // complète, on montre ce qu'on a — il n'y a plus rien à convoiter.
  const teaser = (complete ? balls : balls.filter((b) => !b.owned)).slice(0, 5);

  return (
    <article className={`arc-gacha ${complete ? "done" : ""} ${afford ? "" : "poor"}`}>
      <span className="arc-gacha-glow" aria-hidden="true" />

      {/* LA CAISSE EN MINIATURE, entrebâillée. Le couvercle est soulevé, la
          couture rougeoie, et cinq boules dépassent de l'ouverture : celles
          qu'on n'a pas encore. Tout est en CSS — c'est un aperçu, il n'a pas à
          coûter une scène 3D de plus dans la page. */}
      <div className="arc-gacha-box" aria-hidden="true">
        <span className="arc-gacha-lid" />
        <span className="arc-gacha-balls">
          {(complete ? balls : balls.filter((b) => !b.owned)).slice(0, 5).map((b, i) => (
            <i key={b.slug} style={{ "--i": i }} />
          ))}
        </span>
        <span className="arc-gacha-body-box">
          <span className="arc-gacha-seam" />
        </span>
      </div>

      <div className="arc-gacha-body">
        <span className="arc-gacha-kicker">
          <Library size={12} /> La collection
        </span>
        <h3 className="arc-gacha-name">Caisse de collection</h3>
        <p className="arc-gacha-pitch">
          {complete
            ? "Tu as sorti tous les boîtiers du rayon. L'étagère est complète."
            : "Une caisse, une boule — série, film, comic ou cartouche. Jamais deux fois la même."}
        </p>

        <div className="arc-gacha-progress">
          <span className="arc-gacha-gauge">
            <i style={{ width: total ? `${(owned / total) * 100}%` : 0 }} />
          </span>
          <em>
            <strong>{fmt(owned)}</strong> / {fmt(total)} boîtiers
            {!complete && ` · ${fmt(left)} encore en caisse`}
          </em>
        </div>

        {teaser.length > 0 && (
          <div className="arc-gacha-teaser">
            {teaser.map((b) => (
              <span
                key={b.slug}
                className={b.owned ? "got" : ""}
                title={complete ? b.title : `${b.title} — pas encore dans ta collection`}
              >
                {b.poster ? <img src={b.poster} alt="" loading="lazy" /> : <Library size={14} />}
              </span>
            ))}
            {!complete && left > teaser.length && (
              <em className="arc-gacha-more">+{fmt(left - teaser.length)}</em>
            )}
          </div>
        )}
      </div>

      <div className="arc-gacha-action">
        {complete ? (
          <Link to="/collection" className="arc-gacha-btn clickable">
            <Library size={15} /> Voir l'étagère
          </Link>
        ) : (
          <>
            {/* Solde insuffisant : on laisse cliquable (voir ce qu'il reste
                dedans a de l'intérêt) mais on ne le fait plus briller. */}
            <button className="arc-gacha-btn clickable" onClick={onOpen}>
              <PackageOpen size={15} /> Ouvrir
              <span className="arc-gacha-price">
                <Coins size={12} /> {fmt(price)}
              </span>
            </button>
            {!afford && (
              <span className="arc-gacha-need">− {fmt(price - points)} points</span>
            )}
          </>
        )}
      </div>
    </article>
  );
}

// ---------- La caisse : art, contenu teasé, bouton d'ouverture ----------
function Crate({ crate, points, onOpen }) {
  const afford = points >= crate.price;
  const missing = crate.price - points;
  const pips = (crate.rewards || [])
    .slice()
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))
    .slice(0, 3);

  return (
    <article className={`arc-crate ${afford ? "" : "poor"}`}>
      <span className="arc-crate-glow" aria-hidden="true" />
      <div className="arc-crate-art">
        {crate.image ? (
          <img src={crate.image} alt="" draggable="false" />
        ) : (
          <PackageOpen size={46} />
        )}
      </div>
      <div className="arc-crate-body">
        <span className="arc-crate-kicker">
          <PackageOpen size={12} /> La caisse
        </span>
        <h3 className="arc-crate-name">{crate.name}</h3>
        <div className="arc-crate-teaser">
          {pips.map((r) => (
            <span
              key={r.key}
              className="arc-crate-pip"
              style={{ "--arc-rarity": rarityColor(r.rarity) }}
              title={rarityLabel(r.rarity)}
            />
          ))}
          <span className="arc-crate-count">
            {(crate.rewards || []).length} curseur
            {(crate.rewards || []).length > 1 ? "s" : ""} à débloquer
          </span>
        </div>
      </div>
      <div className="arc-crate-action">
        <button
          className="arc-crate-btn clickable"
          onClick={onOpen}
          disabled={!afford || !crate.openable}
        >
          <Sparkles size={15} /> Ouvrir
          <span className="arc-crate-price">
            <Coins size={12} /> {fmt(crate.price)}
          </span>
        </button>
        {!afford && (
          <span className="arc-crate-need">− {fmt(missing)} points</span>
        )}
      </div>
    </article>
  );
}

// ---------- La porte des cartes à collectionner ----------
// Même gabarit qu'une caisse, mais le bouton mène à la page des cartes : c'est
// là que se trouvent les boosters et le classeur.
const PACK_PRICE = 500;
function CardsDoor({ points }) {
  const afford = points >= PACK_PRICE;
  return (
    <article className={`arc-crate arc-cards-door ${afford ? "" : "poor"}`}>
      <span className="arc-crate-glow" aria-hidden="true" />
      <div className="arc-crate-art">
        <span className="arc-cards-pack">
          <BoosterPack />
        </span>
      </div>
      <div className="arc-crate-body">
        <span className="arc-crate-kicker">
          <Layers size={12} /> Boosters
        </span>
        <h3 className="arc-crate-name">Cartes</h3>
        <div className="arc-crate-teaser">
          {["mythic", "legendary", "epic"].map((r) => (
            <span
              key={r}
              className="arc-crate-pip"
              style={{ "--arc-rarity": CARD_RARITIES[r].color }}
              title={CARD_RARITIES[r].label}
            />
          ))}
          <span className="arc-crate-count">5 cartes par booster</span>
        </div>
      </div>
      <div className="arc-crate-action">
        <Link to="/cartes" className="arc-crate-btn clickable">
          <Sparkles size={15} /> Ouvrir
          <span className="arc-crate-price">
            <Coins size={12} /> {fmt(PACK_PRICE)}
          </span>
        </Link>
      </div>
    </article>
  );
}

// ---------- Les classements : un tableau, un onglet par jeu ----------
// Le top 3 sur un podium (or, argent, bronze), les places 4 à 10 en liste à
// côté. Chaque onglet porte la couleur de son jeu.
function Boards({ boards }) {
  const [sel, setSel] = useState(GAMES[0].key);
  const [mode, setMode] = useState("best");
  const game = GAMES.find((g) => g.key === sel) || GAMES[0];
  return (
    <div className="ax-lb" style={{ "--g": game.color }}>
      <div className="ax-lb-head">
        <div className="ax-lb-tabs" role="tablist" aria-label="Choisir un jeu">
          {GAMES.map((g) => (
            <button
              key={g.key}
              role="tab"
              aria-selected={g.key === sel}
              className={`ax-lb-tab clickable ${g.key === sel ? "on" : ""}`}
              style={{ "--g": g.color }}
              onClick={() => setSel(g.key)}
            >
              <span className="ic">
                <g.Icon size={13} strokeWidth={2.4} />
              </span>
              {g.name}
            </button>
          ))}
        </div>
        <div className="ax-lb-modes" role="group" aria-label="Type de classement">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`clickable ${mode === m.key ? "on" : ""}`}
              onClick={() => setMode(m.key)}
              title={m.hint}
              aria-pressed={mode === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Leaderboard key={game.key} game={game} entries={boards[game.key]} mode={mode} />
    </div>
  );
}

function Avatar({ user, size }) {
  return user.avatar ? (
    <img className="ax-av" src={user.avatar} alt="" loading="lazy" draggable="false" style={{ width: size, height: size }} />
  ) : (
    <span className="ax-av" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {user.username[0].toUpperCase()}
    </span>
  );
}

function Leaderboard({ game, entries, mode }) {
  const active = MODES.find((m) => m.key === mode) || MODES[0];
  const other = MODES.find((m) => m.key !== active.key);

  const top = [...(entries || [])]
    .sort(
      (a, b) =>
        active.pick(b) - active.pick(a) ||
        other.pick(b) - other.pick(a) ||
        new Date(b.date) - new Date(a.date)
    )
    .slice(0, 10);

  if (entries === undefined)
    return (
      <div className="arc-state" style={{ minHeight: 220 }}>
        <Loader2 size={20} className="spin" />
      </div>
    );
  if (top.length === 0)
    return (
      <div className="ax-lb-empty">
        <Crown size={30} />
        <p>Personne n'a encore joué.</p>
        <Link to={game.path} className="ax-lb-cta clickable">
          Prendre la 1re place <ArrowRight size={14} />
        </Link>
      </div>
    );

  const title = (e) =>
    e.games != null
      ? `Record ${fmt(e.bestScore ?? 0)} · total ${fmt(e.score)} sur ${e.games} partie${e.games > 1 ? "s" : ""}`
      : undefined;
  // Le bouton « Défier » : rejouer le même set que lui (pas pour soi-même, ni
  // pour les jeux sans set à rejouer).
  const fight = (e) => {
    const target = game.idOf(e);
    if (e.isMe || !target) return null;
    return (
      <Link
        to={`${game.path}?challenge=${target}`}
        className="ax-lb-fight clickable"
        title={`Défier ${e.user.username} sur le même set`}
      >
        <Swords size={13} />
      </Link>
    );
  };

  return (
    <div className="ax-lb-body">
      <div className="ax-podium">
        {[1, 0, 2].map((i) => {
          const e = top[i];
          if (!e) return <span key={i} className={`ax-pod p${i + 1} empty`} />;
          return (
            <div key={i} className={`ax-pod p${i + 1} ${e.isMe ? "me" : ""}`}>
              <Link to={`/u/${e.user.username}`} className="ax-pod-who clickable">
                {i === 0 && (
                  <span className="ax-pod-crown">
                    <Crown size={20} fill="currentColor" />
                  </span>
                )}
                <Avatar user={e.user} size={i === 0 ? 64 : 52} />
                <span className="ax-pod-name">{e.user.username}</span>
              </Link>
              <span className="ax-pod-score" title={title(e)}>
                {fmt(active.pick(e))}
                {fight(e)}
              </span>
              <span className="ax-pod-step">{i + 1}</span>
            </div>
          );
        })}
      </div>

      {top.length > 3 && (
        <ol className="ax-lb-list">
          {top.slice(3).map((e, j) => (
            <li key={game.idOf(e) || e.user.id} className={e.isMe ? "me" : ""}>
              <span className="ax-lb-rank">{j + 4}</span>
              <Link to={`/u/${e.user.username}`} className="ax-lb-user clickable">
                <Avatar user={e.user} size={30} />
                <span>{e.user.username}</span>
              </Link>
              {fight(e)}
              <span className="ax-lb-score" title={title(e)}>
                {fmt(active.pick(e))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
