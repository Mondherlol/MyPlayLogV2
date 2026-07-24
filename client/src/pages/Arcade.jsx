import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Coins,
  Loader2,
  Sparkles,
  PackageOpen,
  MousePointer2,
  Palette,
  Check,
  X,
  Music2,
  Grid2x2,
  Trophy,
  Crown,
  Swords,
  ArrowRight,
  History,
  Joystick,
  ChevronDown,
  Eye,
  Gem,
  Flower2,
  Ghost,
  Moon,
  Leaf,
  Sunset,
  Contrast,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useCosmetics } from "../context/CosmeticsContext";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";
import { rarityColor, rarityLabel, rarityRank } from "../lib/rarity";
import RewardArt from "../components/RewardArt";
import CaseOpeningModal from "../components/CaseOpeningModal";
import FriendsCollectionModal from "../components/FriendsCollectionModal";
import PixelCanvas from "../components/PixelCanvas";

// ======================================================================
//  Arcade — la salle de jeux : mini-jeux, classements, cagnotte, curseurs
// ======================================================================
// Tout ce qui tourne autour des points vit ici, et nulle part ailleurs :
// l'accueil ne garde qu'une porte d'entrée. Les mini-jeux se lancent depuis de
// grosses cartes, chacun a SON classement (pas d'onglet qui les mélange), et
// la collection de curseurs s'équipe sur place.

const GAMES = [
  {
    key: "blindtest",
    name: "Blind Test",
    tag: "Quiz musical",
    pitch: "Un extrait d'OST tiré au sort. Devine le jeu avant la fin du morceau.",
    Icon: Music2,
    path: "/blindtest",
    api: "/blindtest/leaderboard",
    // Les deux classements partagent le même contrat, seul l'id de défi diffère.
    idOf: (e) => e.blindTestId,
  },
  {
    key: "pixel",
    name: "Pixel Rush",
    tag: "Quiz visuel",
    pitch: "Des captures noyées sous les pixels. Reconnais le jeu avant qu'elles se précisent.",
    Icon: Grid2x2,
    path: "/pixel",
    api: "/pixel/leaderboard",
    idOf: (e) => e.gameId,
  },
];

// Libellés des lignes du grand livre (miroir de POINT_SOURCES,
// server/src/models/PointEntry.js). Une source inconnue s'affiche telle quelle.
const SOURCE_LABELS = {
  blindtest: "Blind test",
  pixel: "Pixel Rush",
  case: "Ouverture de caisse",
  duplicate: "Doublon reconverti",
  admin: "Ajustement admin",
  backfill: "Parties d'avant l'arcade",
};

// Une icône par thème (par clé de lot) : donne à chaque carte un caractère.
const THEME_ICONS = {
  "theme-og": Gem,
  "theme-sakura": Flower2,
  "theme-kuromi": Ghost,
  "theme-midnight": Moon,
  "theme-matcha": Leaf,
  "theme-sunset": Sunset,
  "theme-noir": Contrast,
};

const MODES = [
  { key: "best", label: "Record", pick: (e) => e.bestScore ?? 0, hint: "Meilleur score en une partie" },
  { key: "total", label: "Total", pick: (e) => e.score ?? 0, hint: "Total cumulé de toutes les parties" },
];

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// --- Caches stale-while-revalidate (mémoire + localStorage) ---
// La page était intégralement reconstruite à chaque visite : squelettes des
// classements, et surtout les jaquettes des cartes Blind Test / Pixel Rush qui
// repartaient de zéro (re-téléchargées, re-pixelisées) alors qu'elles ne
// changent quasiment jamais. On réaffiche donc la dernière version connue
// instantanément, puis on revalide en fond — le solde et l'inventaire se
// recalent sans que rien ne clignote.
// Clés préfixées par l'id du compte : changer d'utilisateur ne montre jamais
// l'inventaire du précédent.
const arcadeCache = makeCache("mpl_arcade_", 10 * 60 * 1000);
const boardCache = makeCache("mpl_arcboard_", 5 * 60 * 1000);

export default function Arcade() {
  const { token, user, updateUser } = useAuth();
  const { setCosmetic, previewTheme, endPreview } = useCosmetics();

  // Clé de cache : le compte courant. `null` tant que /auth/me n'a pas répondu —
  // et dans ce cas on ne lit ni n'écrit RIEN : une entrée « anonyme » partagée
  // montrerait l'inventaire du compte précédent au suivant.
  const meId = user?.id || null;

  // /arcade : solde, caisses, inventaire — amorcé depuis le cache s'il existe.
  const [data, setData] = useState(() => (meId && arcadeCache.get(meId)?.data) || null);
  // Classement par jeu. Une clé absente = « pas encore chargé » (squelette) ;
  // le cache la remplit d'emblée, donc plus de squelette au retour sur la page.
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
  const [showCursors, setShowCursors] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [equipping, setEquipping] = useState(null);
  const [preview, setPreview] = useState(null); // thème essayé en direct (non équipé)
  const [err, setErr] = useState("");

  // Un aperçu de thème ne doit jamais « fuir » hors de la page : on le coupe en
  // quittant l'arcade. Ref pour lire l'état courant dans le cleanup.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => () => {
    if (previewRef.current) endPreview();
  }, [endPreview]);

  // Toute écriture de `data` passe par ici : l'état ET le cache restent alignés,
  // sinon un ajustement local (ouverture de caisse, équipement) serait perdu au
  // retour sur la page, qui réafficherait la version d'avant.
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
    // Revalidation systématique, sans vider l'affichage : le cache reste à
    // l'écran tant que la réponse n'est pas là.
    apiFetch("/arcade", { token })
      .then((d) => {
        if (!alive) return;
        setErr("");
        commitData(d);
      })
      // Une revalidation ratée ne doit pas effacer un affichage valide : on ne
      // remonte l'erreur que si on n'avait rien à montrer.
      .catch((e) => alive && !arcadeCache.get(meId) && setErr(e.message));
    // Les deux classements en parallèle : ils sont affichés côte à côte, pas
    // l'un derrière l'autre — inutile de les charger à la demande.
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
      // Effet immédiat : le curseur / thème change sous les yeux, sans recharger.
      setCosmetic(reward.type, isOn ? null : reward);
      // On équipe ce qu'on prévisualisait → l'aperçu n'a plus lieu d'être (le
      // thème est désormais réel), on ferme juste la barre sans re-basculer.
      if (preview && preview.key === reward.key) setPreview(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEquipping(null);
    }
  }

  // Aperçu en direct d'un thème : on applique sa palette à tout le site sans
  // rien enregistrer. Re-cliquer coupe l'aperçu.
  function togglePreview(reward) {
    if (preview && preview.key === reward.key) {
      endPreview();
      setPreview(null);
    } else {
      previewTheme(reward);
      setPreview(reward);
    }
  }
  function stopPreview() {
    endPreview();
    setPreview(null);
  }

  const points = data?.points ?? user?.points ?? 0;
  const covers = data?.covers || [];
  // La caisse à proposer DANS la modale des curseurs : celle qui en distribue.
  // `cases[0]` ne suffit plus depuis qu'il existe aussi une caisse de thèmes.
  const cursorCrate =
    (data?.cases || []).find((c) => (c.rewards || []).some((r) => r.type === "cursor")) ||
    null;

  // Inventaire par famille (les plus rares en tête, puis les plus récents).
  const byRarity = (a, b) =>
    rarityRank(b.rarity) - rarityRank(a.rarity) ||
    new Date(b.obtainedAt || 0) - new Date(a.obtainedAt || 0);
  const cursors = (data?.inventory || []).filter((r) => r.type === "cursor").sort(byRarity);
  const themes = (data?.inventory || []).filter((r) => r.type === "theme").sort(byRarity);

  // Progression : combien de lots tirables existent par famille (toutes caisses
  // confondues), pour afficher « 3 / 8 ».
  const catalog = { cursor: new Set(), theme: new Set() };
  for (const c of data?.cases || [])
    for (const r of c.rewards || [])
      if (catalog[r.type]) catalog[r.type].add(r.key);

  const equipProps = {
    equippedOf: (r) => data?.equipped?.[r.type] === r.key,
    equipping,
    onEquip: toggleEquip,
  };

  return (
    <div className="arc-page">
      <div className="arc-main">
        {/* ---------- Bannière : titre, cagnotte, historique ---------- */}
        <header className="arc-banner">
          <span className="arc-banner-glow" aria-hidden="true" />
          <span className="arc-banner-scan" aria-hidden="true" />

          <div className="arc-banner-top">
            <div className="arc-banner-id">
              <span className="arc-kicker">
                <Joystick size={13} /> Salle de jeux
              </span>
              <h1 className="arc-title">Arcade</h1>
              <p className="arc-sub">
                Joue, marque des points, dépense-les en curseurs.
              </p>
            </div>

            <div className="arc-wallet">
              <span className="arc-wallet-coin">
                <Coins size={22} />
              </span>
              <span className="arc-wallet-num">{fmt(points)}</span>
              <span className="arc-wallet-label">points</span>
              <button
                className={`arc-wallet-hist clickable ${showHist ? "on" : ""}`}
                onClick={toggleHistory}
              >
                <History size={13} /> Historique
                <ChevronDown size={13} className="arc-wallet-caret" />
              </button>
            </div>
          </div>

          {showHist && (
            <div className="arc-hist">
              {history === null ? (
                <div className="arc-state" style={{ minHeight: 80 }}>
                  <Loader2 size={18} className="spin" />
                </div>
              ) : history.length === 0 ? (
                <p className="arc-hist-empty">
                  Aucun mouvement pour l'instant — lance une partie&nbsp;!
                </p>
              ) : (
                <ul className="arc-hist-list">
                  {history.map((h) => (
                    <li className="arc-hist-row" key={h.id}>
                      <span className="arc-hist-src">
                        {SOURCE_LABELS[h.source] || h.source}
                      </span>
                      <span className="arc-hist-date">
                        {new Date(h.date).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className={`arc-hist-amt ${h.amount >= 0 ? "up" : "down"}`}>
                        {h.amount >= 0 ? `+${fmt(h.amount)}` : fmt(h.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </header>

        {err && <p className="arc-err">{err}</p>}

        {/* ---------- Les mini-jeux ---------- */}
        {/* Une jaquette différente par carte (à défaut, la même tourne). */}
        <div className="arc-games">
          {GAMES.map((g, i) => (
            <GameCard
              key={g.key}
              game={g}
              mine={(boards[g.key] || []).find((e) => e.isMe)}
              cover={covers.length ? covers[i % covers.length] : null}
            />
          ))}
        </div>

        {/* ---------- Les caisses ---------- */}
        {data?.cases?.length > 0 && (
          <div className="arc-crates">
            {data.cases.map((c) => (
              <Crate
                key={c.id}
                crate={c}
                points={points}
                onOpen={() => setOpeningBox(c)}
              />
            ))}
          </div>
        )}

        {/* ---------- Collection ----------
            Les curseurs ne sont plus ici mais dans leur modale (bouton du
            rail droit) : la liste peut être longue et on ne la consulte que
            pour équiper. Les thèmes restent en page, eux se choisissent à
            l'œil et ont besoin de leurs grands aperçus. */}
        {!data ? (
          <div className="arc-state">
            <Loader2 size={22} className="spin" />
          </div>
        ) : (
          <ThemesGroup
            items={themes}
            total={catalog.theme.size}
            equippedKey={data?.equipped?.theme || null}
            previewKey={preview?.key || null}
            equipping={equipping}
            onEquip={toggleEquip}
            onPreview={togglePreview}
          />
        )}
      </div>

      {/* ---------- Rail droit : collection + classements ---------- */}
      <aside className="arc-rail">
        {/* La porte d'entrée de la collection de curseurs, au-dessus des
            classements. */}
        <button
          className="arc-rail-cursors clickable"
          onClick={() => setShowCursors(true)}
        >
          <span className="arc-rail-cursors-ic">
            <MousePointer2 size={17} />
          </span>
          <span className="arc-rail-cursors-txt">
            Mes curseurs
            {catalog.cursor.size > 0 && (
              <em>
                {cursors.length} / {catalog.cursor.size}
              </em>
            )}
          </span>
          <ArrowRight size={16} className="arc-rail-cursors-arrow" />
        </button>

        {/* Et juste dessous, celles des autres : une collection se regarde en
            comparant. Même gabarit de bouton, ton plus discret — la sienne
            reste la porte principale. */}
        <button
          className="arc-rail-cursors friends clickable"
          onClick={() => setShowFriends(true)}
        >
          <span className="arc-rail-cursors-ic">
            <Users size={17} />
          </span>
          <span className="arc-rail-cursors-txt">
            Les collections
            <em>Ce que les joueurs suivis ont débloqué</em>
          </span>
          <ArrowRight size={16} className="arc-rail-cursors-arrow" />
        </button>

        <h2 className="arc-rail-title">
          <Crown size={16} /> Classements
        </h2>
        {GAMES.map((g) => (
          <Leaderboard key={g.key} game={g} entries={boards[g.key]} />
        ))}
      </aside>

      {/* Barre d'aperçu : flotte tant qu'on essaie un thème sans l'équiper. */}
      {preview && (
        <div className="arc-preview-bar" role="dialog" aria-label="Aperçu d'un thème">
          <span className="arc-preview-eye">
            <Eye size={16} />
          </span>
          <span className="arc-preview-txt">
            Aperçu&nbsp;: <b>{preview.name}</b>
          </span>
          <button
            className="arc-preview-equip clickable"
            onClick={() => toggleEquip(preview)}
            disabled={equipping === preview.key || data?.equipped?.theme === preview.key}
          >
            {equipping === preview.key ? (
              <Loader2 size={14} className="spin" />
            ) : data?.equipped?.theme === preview.key ? (
              <>
                <Check size={14} /> Équipé
              </>
            ) : (
              <>
                <Check size={14} /> Équiper
              </>
            )}
          </button>
          <button className="arc-preview-stop clickable" onClick={stopPreview}>
            Terminer
          </button>
        </div>
      )}

      {showCursors && (
        <CursorsModal
          items={cursors}
          total={catalog.cursor.size}
          points={points}
          crate={cursorCrate}
          onOpenCrate={(c) => setOpeningBox(c)}
          onClose={() => setShowCursors(false)}
          {...equipProps}
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
    </div>
  );
}

// ---------- La carte d'un mini-jeu ----------
// L'art n'est pas une icône décorative mais une VRAIE jaquette de la
// bibliothèque, traitée dans l'idiome du jeu : pixelisée sur une pile de
// cartes de quiz pour Pixel Rush, glissée dans une pochette d'où sort le
// vinyle pour le Blind Test. On saisit la règle avant même de cliquer.
function GameCard({ game, mine, cover }) {
  return (
    <Link to={game.path} className={`arc-game g-${game.key} clickable`}>
      <span className="arc-game-glow" aria-hidden="true" />
      <span className="arc-game-top">
        <GameArt game={game} cover={cover} />
        <span className="arc-game-tag">{game.tag}</span>
      </span>
      <span className="arc-game-name">{game.name}</span>
      <span className="arc-game-pitch">{game.pitch}</span>
      <span className="arc-game-foot">
        <span className="arc-game-stat">
          {mine ? (
            <>
              <Trophy size={13} /> Record <b>{fmt(mine.bestScore)}</b>
            </>
          ) : (
            <>
              <Sparkles size={13} /> Jamais joué
            </>
          )}
        </span>
        <span className="arc-game-cta">
          Jouer <ArrowRight size={16} className="arc-game-arrow" />
        </span>
      </span>
    </Link>
  );
}

// Format du canvas de la jaquette pixelisée : 3/4, comme une jaquette.
const ART_CV_W = 186;
const ART_CV_H = 248;

function GameArt({ game, cover }) {
  // Bibliothèque vide ou jaquette manquante : on retombe sur la pastille.
  if (!cover?.cover) {
    return (
      <span className="arc-game-art fallback" aria-hidden="true">
        <game.Icon size={30} />
      </span>
    );
  }
  if (game.key === "pixel") {
    // Une manche en miniature : jaquette pixelisée + « ? », et la carte se
    // retourne au survol pour donner la réponse — le même geste que sur
    // l'écran d'accueil du jeu. Tout en CSS (:hover), rien en JS.
    return (
      <span className="arc-game-art" aria-hidden="true">
        <span className="arc-art-deck" />
        <span className="arc-art-flip">
          <span className="arc-art-face back">
            <PixelCanvas
              src={cover.cover}
              blocks={9}
              reveal={false}
              label=""
              w={ART_CV_W}
              h={ART_CV_H}
            />
            <b>?</b>
          </span>
          <span className="arc-art-face front">
            <img src={cover.cover} alt="" loading="lazy" draggable="false" />
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="arc-game-art" aria-hidden="true">
      <span className="arc-art-disc" />
      <span className="arc-art-cover">
        <img src={cover.cover} alt="" loading="lazy" draggable="false" />
      </span>
    </span>
  );
}

// ---------- Aperçu miniature d'un thème : un mini-écran de l'app ----------
// Tout est dérivé de la palette (swatch + vars) : barre latérale, cartes, et
// le bouton d'accent. C'est LUI qui rend les cartes de thème jolies.
function ThemePreview({ data }) {
  const s = data?.swatch || {};
  const v = data?.vars || {};
  const bg = s.bg || v["--bg"] || "#111";
  const surface = s.surface || v["--surface"] || bg;
  const accent = s.accent || v["--orange"] || "#f2b70b";
  const accent2 = s.accent2 || accent;
  const text = s.text || v["--text"] || "#fff";
  const side = s.side || v["--side-bg"] || surface;
  const sideText = s.sideText || v["--side-text"] || text;
  const accentGrad = `linear-gradient(120deg, ${accent2}, ${accent})`;
  return (
    <div className="tp" style={{ background: bg }} aria-hidden="true">
      <div className="tp-side" style={{ background: side }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="tp-nav"
            style={{ background: i === 0 ? accent : sideText, opacity: i === 0 ? 1 : 0.4 }}
          />
        ))}
      </div>
      <div className="tp-main">
        <span className="tp-hello" style={{ background: accentGrad }} />
        <div className="tp-card" style={{ background: surface }}>
          <span className="tp-line" style={{ background: text, opacity: 0.7 }} />
          <span className="tp-line short" style={{ background: text, opacity: 0.4 }} />
          <span className="tp-btn" style={{ background: accentGrad }} />
        </div>
        <div className="tp-card" style={{ background: surface }}>
          <span className="tp-line" style={{ background: text, opacity: 0.55 }} />
        </div>
      </div>
    </div>
  );
}

// ---------- Une carte de thème (aperçu + icône + Aperçu/Équiper) ----------
function ThemeCard({ reward, equippedKey, previewKey, equipping, onEquip, onPreview }) {
  const on = equippedKey === reward.key;
  const previewing = previewKey === reward.key;
  const Icon = THEME_ICONS[reward.key] || Palette;
  return (
    <article
      className={`arc-theme ${on ? "equipped" : ""} ${previewing ? "previewing" : ""}`}
      style={{ "--arc-rarity": rarityColor(reward.rarity) }}
    >
      <div className="arc-theme-art">
        <ThemePreview data={reward.data} />
        <span className="arc-theme-icon">
          <Icon size={15} />
        </span>
        {reward.count > 1 && <span className="arc-theme-count">×{reward.count}</span>}
      </div>
      <div className="arc-theme-info">
        <span className="arc-theme-rarity">{rarityLabel(reward.rarity)}</span>
        <h3 className="arc-theme-name">{reward.name}</h3>
      </div>
      <div className="arc-theme-actions">
        <button
          className={`arc-theme-btn ghost clickable ${previewing ? "on" : ""}`}
          onClick={() => onPreview(reward)}
          title="Voir le site avec ce thème"
        >
          <Eye size={14} /> {previewing ? "Arrêter" : "Aperçu"}
        </button>
        <button
          className={`arc-theme-btn clickable ${on ? "on" : ""}`}
          onClick={() => onEquip(reward)}
          disabled={equipping === reward.key}
        >
          {equipping === reward.key ? (
            <Loader2 size={14} className="spin" />
          ) : on ? (
            <>
              <Check size={14} /> Équipé
            </>
          ) : (
            "Équiper"
          )}
        </button>
      </div>
    </article>
  );
}

// ---------- Le groupe « Mes thèmes » ----------
function ThemesGroup({ items, total, equippedKey, previewKey, equipping, onEquip, onPreview }) {
  if (!total && items.length === 0) return null;
  return (
    <section className="arc-collection">
      <div className="arc-inv-head">
        <h2 className="arc-h2">
          <Palette size={17} /> Mes thèmes
        </h2>
        {total > 0 && (
          <span className="arc-inv-progress">
            {items.length} / {total}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="arc-inv-empty">
          Aucun thème pour l'instant — ouvre la caisse de thèmes pour en débloquer.
        </p>
      ) : (
        <>
          <div className="arc-themes-grid">
            {items.map((r) => (
              <ThemeCard
                key={r.key}
                reward={r}
                equippedKey={equippedKey}
                previewKey={previewKey}
                equipping={equipping}
                onEquip={onEquip}
                onPreview={onPreview}
              />
            ))}
          </div>
          <p className="arc-inv-note">
            Le thème équipé repeint tout le site (y compris la barre latérale) et
            impose son mode clair ou sombre. Clique « Aperçu » pour l'essayer avant.
          </p>
        </>
      )}
    </section>
  );
}

// ---------- La modale « Mes curseurs » ----------
// La collection vit dans une modale plutôt qu'en pleine page : elle grandit à
// chaque caisse et ne se consulte que ponctuellement, pour équiper. Le bouton
// qui l'ouvre est en tête du rail droit.
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
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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

// ---------- Un classement, propre à un jeu ----------
function Leaderboard({ game, entries }) {
  const [mode, setMode] = useState("best");
  const active = MODES.find((m) => m.key === mode) || MODES[0];
  const other = MODES.find((m) => m.key !== active.key);

  const top = [...(entries || [])]
    .sort(
      (a, b) =>
        active.pick(b) - active.pick(a) ||
        other.pick(b) - other.pick(a) ||
        new Date(b.date) - new Date(a.date)
    )
    .slice(0, 8);

  return (
    <section className={`arc-board g-${game.key}`}>
      <header className="arc-board-head">
        <span className="arc-board-ic">
          <game.Icon size={16} />
        </span>
        <h3 className="arc-board-name">{game.name}</h3>
        <div className="arc-board-tabs" role="group" aria-label="Type de classement">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`arc-board-tab clickable ${mode === m.key ? "on" : ""}`}
              onClick={() => setMode(m.key)}
              title={m.hint}
              aria-pressed={mode === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      {entries === undefined ? (
        <div className="arc-state" style={{ minHeight: 140 }}>
          <Loader2 size={20} className="spin" />
        </div>
      ) : top.length === 0 ? (
        <div className="arc-board-empty">
          <Crown size={22} />
          <p>Personne n'a encore joué.</p>
          <Link to={game.path} className="arc-board-cta clickable">
            Prendre la 1re place <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <ol className="arc-board-list">
          {top.map((e, i) => {
            const target = game.idOf(e);
            return (
              <li key={target || e.user.id} className={`arc-board-row ${e.isMe ? "me" : ""}`}>
                <span className={`arc-rank r${i + 1}`}>{i + 1}</span>
                <Link to={`/u/${e.user.username}`} className="arc-board-user clickable">
                  {e.user.avatar ? (
                    <img src={e.user.avatar} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <span className="arc-board-av">{e.user.username[0].toUpperCase()}</span>
                  )}
                  <span className="arc-board-who">{e.user.username}</span>
                </Link>
                {!e.isMe && target && (
                  <Link
                    to={`${game.path}?challenge=${target}`}
                    className="arc-board-fight clickable"
                    title={`Défier ${e.user.username} sur le même set`}
                  >
                    <Swords size={13} />
                  </Link>
                )}
                <span
                  className="arc-board-score"
                  title={
                    e.games != null
                      ? `Record ${fmt(e.bestScore ?? 0)} · total ${fmt(e.score)} sur ${
                          e.games
                        } partie${e.games > 1 ? "s" : ""}`
                      : undefined
                  }
                >
                  {fmt(active.pick(e))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
