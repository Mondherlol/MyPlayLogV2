import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  Trophy,
  Star,
  Gem,
  Award,
  Lock,
  X,
  Sparkles,
  Clock,
  Gamepad2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  ArrowUpDown,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import SteamIcon from "./SteamIcon";
import PsnIcon from "./PsnIcon";

// Petit logo de la plateforme d'origine d'un succès (Steam / PlayStation).
function PlatformIcon({ platform, size = 13 }) {
  if (platform === "psn") return <PsnIcon size={size} />;
  if (platform === "steam") return <SteamIcon size={size} />;
  return <Trophy size={size} />;
}

// Couleur de rareté d'un succès (façon "or / argent / bronze" par pourcentage).
function rarityClass(pct) {
  if (pct == null) return "";
  if (pct < 5) return "r-legendary";
  if (pct < 15) return "r-epic";
  if (pct < 40) return "r-rare";
  return "r-common";
}
function fmtDate(d) {
  return d
    ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : "";
}
// Temps de jeu court : "1 250 h" (espace fine comme séparateur de milliers).
function fmtHours(h) {
  if (h == null) return null;
  return `${Math.round(h).toLocaleString("fr-FR")} h`;
}
// Libellé de palier de rareté (aligné sur rarityClass).
function rarityLabel(pct) {
  if (pct == null) return null;
  if (pct < 5) return "Légendaire";
  if (pct < 15) return "Épique";
  if (pct < 40) return "Rare";
  return "Commun";
}

// Options de tri de la grille « par jeu ».
const SORTS = [
  { key: "completion", label: "Complétion", Icon: Award, get: (g) => g.percent * 1000 + g.unlocked },
  { key: "playtime", label: "Temps de jeu", Icon: Clock, get: (g) => g.playtime ?? -1 },
  { key: "unlocked", label: "Succès débloqués", Icon: Trophy, get: (g) => g.unlocked },
  { key: "recent", label: "Activité récente", Icon: Sparkles, get: (g) => (g.lastUnlock ? new Date(g.lastUnlock).getTime() : 0) },
  { key: "rating", label: "Note", Icon: Star, get: (g) => g.rating ?? -1 },
  { key: "name", label: "Nom", Icon: ArrowUpDown, get: (g) => g.name.toLowerCase() },
];

export default function ProfileAchievements({ username, token, isMe }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openGame, setOpenGame] = useState(null);
  const [openAch, setOpenAch] = useState(null);

  // Contrôles de la grille par jeu.
  const [sort, setSort] = useState("completion");
  const [dir, setDir] = useState("desc");
  const [platform, setPlatform] = useState("all");
  const [perfectOnly, setPerfectOnly] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/users/${username}/achievements`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  const visibleGames = useMemo(() => {
    if (!data?.games) return [];
    const sorter = SORTS.find((s) => s.key === sort) || SORTS[0];
    const needle = q.trim().toLowerCase();
    let list = data.games.filter((g) => {
      if (platform !== "all" && g.platform !== platform) return false;
      if (perfectOnly && !g.perfect) return false;
      if (needle && !g.name.toLowerCase().includes(needle)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      const va = sorter.get(a);
      const vb = sorter.get(b);
      if (va < vb) return dir === "asc" ? -1 : 1;
      if (va > vb) return dir === "asc" ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [data, sort, dir, platform, perfectOnly, q]);

  if (loading)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement des succès…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;
  if (!data) return null;

  if (!data.games.length) {
    return (
      <div className="ach-empty">
        <Trophy size={40} />
        {isMe ? (
          <>
            <h3>Aucun succès importé</h3>
            <p>
              Relie ton compte Steam ou PlayStation pour importer tes succès et
              voir tes stats ici.
            </p>
            <Link to="/settings" className="btn-steam-primary clickable">
              <SettingsIcon size={16} /> Aller dans Paramètres
            </Link>
          </>
        ) : (
          <>
            <h3>Aucun succès</h3>
            <p>Ce joueur n'a pas encore importé de succès.</p>
          </>
        )}
      </div>
    );
  }

  const s = data.stats;
  const platforms = Object.keys(s.byPlatform || {});

  return (
    <div className="ach-tab">
      {/* ---- Hero : anneau de complétion globale + stats clés ---- */}
      <div className="ach-hero">
        <div className="ach-hero-ring">
          <ProgressRing value={s.globalCompletion} />
          <div className="ach-hero-ring-label">
            <strong>{s.globalCompletion}%</strong>
            <span>complétion</span>
          </div>
        </div>
        <div className="ach-hero-body">
          <div className="ach-hero-head">
            <Trophy size={15} />
            <span>{s.totalUnlocked.toLocaleString("fr-FR")} succès débloqués</span>
            <em>/ {s.totalAchievements.toLocaleString("fr-FR")}</em>
          </div>
          <div className="ach-hero-stats">
            <StatTile Icon={Award} value={`${s.avgCompletion}%`} label="Complétion moyenne" />
            <StatTile Icon={Star} value={s.perfectGames} label="Jeux à 100 %" accent />
            <StatTile Icon={Gem} value={s.legendaryUnlocked} label="Succès légendaires" />
            <StatTile Icon={Gamepad2} value={s.games} label="Jeux suivis" />
          </div>
        </div>
      </div>

      {/* Succès les plus rares */}
      {data.rarest.length > 0 && (
        <section className="ach-rail">
          <h3 className="ach-rail-title">
            <Gem size={16} /> Tes succès les plus rares
          </h3>
          <Rail>
            {data.rarest.map((a, i) => (
              <div
                key={i}
                className={`ach-rare-card clickable ${rarityClass(a.rarity)}`}
                role="button"
                tabIndex={0}
                onClick={() => setOpenAch(a)}
              >
                <div className="ach-rare-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={20} />}
                </div>
                <div className="ach-rare-info">
                  <strong>{a.name}</strong>
                  <span>{a.gameName}</span>
                </div>
                <div className="ach-rare-pct">{a.rarity}%</div>
              </div>
            ))}
          </Rail>
        </section>
      )}

      {/* Succès récents */}
      {data.recent.length > 0 && (
        <section className="ach-rail">
          <h3 className="ach-rail-title">
            <Sparkles size={16} /> Débloqués récemment
          </h3>
          <Rail>
            {data.recent.map((a, i) => (
              <div
                key={i}
                className="ach-recent-card clickable"
                role="button"
                tabIndex={0}
                onClick={() => setOpenAch(a)}
              >
                <div className="ach-recent-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={18} />}
                </div>
                <div className="ach-rare-info">
                  <strong>{a.name}</strong>
                  <span>
                    {a.gameName} · {fmtDate(a.unlockedAt)}
                  </span>
                </div>
              </div>
            ))}
          </Rail>
        </section>
      )}

      {/* ---- Grille par jeu + barre d'outils ---- */}
      <section className="ach-lib">
        <div className="ach-toolbar">
          <h3 className="ach-rail-title" style={{ margin: 0 }}>
            <Trophy size={16} /> Par jeu
            <span className="ach-count-chip">{visibleGames.length}</span>
          </h3>
          <div className="ach-tools">
            <div className="ach-search">
              <Search size={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un jeu…"
              />
            </div>
            {platforms.length > 1 && (
              <div className="ach-chips">
                <button
                  className={`ach-chip clickable ${platform === "all" ? "on" : ""}`}
                  onClick={() => setPlatform("all")}
                >
                  Tout
                </button>
                {platforms.map((p) => (
                  <button
                    key={p}
                    className={`ach-chip clickable ${platform === p ? "on" : ""}`}
                    onClick={() => setPlatform(p)}
                  >
                    <PlatformIcon platform={p} size={13} />
                    {s.byPlatform[p]}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`ach-chip clickable ${perfectOnly ? "on" : ""}`}
              onClick={() => setPerfectOnly((v) => !v)}
              title="Jeux complétés à 100 %"
            >
              <Star size={13} /> 100 %
            </button>
            <SortMenu sort={sort} setSort={setSort} dir={dir} setDir={setDir} />
          </div>
        </div>

        {visibleGames.length === 0 ? (
          <div className="ach-noresult">Aucun jeu ne correspond à ce filtre.</div>
        ) : (
          <div className="ach-games">
            {visibleGames.map((g) => (
              <button
                key={`${g.platform}-${g.gameId}`}
                className="ach-game-card clickable"
                onClick={() => setOpenGame(g)}
              >
                <div className="ach-game-cover">
                  {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : null}
                  <span className="ach-plat-badge" title={g.platform}>
                    <PlatformIcon platform={g.platform} size={13} />
                  </span>
                  {g.perfect && (
                    <span className="ach-perfect-badge">
                      <Star size={11} /> 100%
                    </span>
                  )}
                </div>
                <div className="ach-game-info">
                  <div className="ach-game-name">{g.name}</div>
                  <div className="ach-game-meta">
                    <span className={`ach-game-pct ${g.perfect ? "done" : ""}`}>{g.percent}%</span>
                    <span className="ach-game-count">
                      {g.unlocked}/{g.total}
                    </span>
                    {g.playtime != null && g.playtime > 0 && (
                      <span className="ach-game-time">
                        <Clock size={12} /> {fmtHours(g.playtime)}
                      </span>
                    )}
                  </div>
                  <div className="ach-progress">
                    <div className="ach-progress-fill" style={{ width: `${g.percent}%` }} />
                  </div>
                  {g.rarest && (
                    <div className={`ach-game-rarest ${rarityClass(g.rarest.rarity)}`}>
                      <Gem size={11} />
                      <span>{g.rarest.name}</span>
                      <em>{g.rarest.rarity}%</em>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {openGame && (
        <GameAchievementsModal
          username={username}
          token={token}
          game={openGame}
          onClose={() => setOpenGame(null)}
        />
      )}

      {openAch && <AchievementModal ach={openAch} onClose={() => setOpenAch(null)} />}
    </div>
  );
}

// Carrousel horizontal : glissé-déposé à la souris + flèches (sans scrollbar).
function Rail({ children }) {
  const ref = useRef(null);
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false });
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 4,
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);

    // Drag piloté au niveau window : le geste continue même si le curseur
    // sort de la piste, et on ne touche pas au setPointerCapture (qui pouvait
    // avaler le clic sur une carte).
    const onMove = (e) => {
      const d = drag.current;
      if (!d.down) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) > 6) {
        d.moved = true;
        el.classList.add("dragging");
      }
      if (d.moved) {
        el.scrollLeft = d.startScroll - dx;
        e.preventDefault();
      }
    };
    const onUp = () => {
      if (!drag.current.down) return;
      drag.current.down = false;
      el.classList.remove("dragging");
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const nudge = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = ref.current;
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
  };
  // Supprime UNIQUEMENT le clic « fantôme » qui suit un vrai glisser.
  const onClickCapture = (e) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  };

  return (
    <div className="ach-rail-wrap">
      {edges.left && (
        <button
          className="ach-rail-arrow left clickable"
          onClick={() => nudge(-1)}
          aria-label="Précédent"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      <div
        ref={ref}
        className="ach-rail-row"
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      {edges.right && (
        <button
          className="ach-rail-arrow right clickable"
          onClick={() => nudge(1)}
          aria-label="Suivant"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
}

// Anneau SVG de progression avec dégradé doré (thème clair & sombre).
function ProgressRing({ value, size = 128, stroke = 13 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  const gid = "ach-ring-grad";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ach-ring">
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#eaa908" />
          <stop offset="100%" stopColor="#ffcf3a" />
        </linearGradient>
      </defs>
      <circle
        className="ach-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        fill="none"
        stroke={`url(#${gid})`}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.7s ease" }}
      />
    </svg>
  );
}

function StatTile({ Icon, value, label, accent }) {
  return (
    <div className={`ach-stat-tile ${accent ? "accent" : ""}`}>
      <Icon size={18} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// Petit menu de tri (déroulant + inversion du sens).
function SortMenu({ sort, setSort, dir, setDir }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = SORTS.find((s) => s.key === sort) || SORTS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="ach-sort" ref={ref}>
      <button className="ach-chip clickable" onClick={() => setOpen((v) => !v)}>
        <active.Icon size={13} />
        <span className="ach-sort-label">{active.label}</span>
        <ChevronDown size={14} />
      </button>
      <button
        className="ach-chip ach-dir clickable"
        onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))}
        title={dir === "desc" ? "Décroissant" : "Croissant"}
      >
        <ArrowUpDown size={14} />
      </button>
      {open && (
        <div className="ach-sort-menu">
          {SORTS.map((o) => (
            <button
              key={o.key}
              className={`ach-sort-item clickable ${o.key === sort ? "on" : ""}`}
              onClick={() => {
                setSort(o.key);
                setDir(o.key === "name" ? "asc" : "desc");
                setOpen(false);
              }}
            >
              <o.Icon size={14} />
              <span>{o.label}</span>
              {o.key === sort && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Modale de détail d'UN succès (ouverte depuis les rails rares / récents).
function AchievementModal({ ach, onClose }) {
  const cls = rarityClass(ach.rarity);
  const label = rarityLabel(ach.rarity);
  return (
    <div className="ach-modal-overlay" onClick={onClose}>
      <div className={`ach-single ${cls}`} onClick={(e) => e.stopPropagation()}>
        <button className="steam-modal-close clickable" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="ach-single-icon">
          {ach.icon ? <img src={ach.icon} alt="" /> : <Trophy size={40} />}
        </div>
        {label && (
          <span className={`ach-single-tier ${cls}`}>
            <Gem size={13} /> {label}
            {ach.rarity != null && <em> · {ach.rarity}% des joueurs</em>}
          </span>
        )}
        <h3 className="ach-single-name">{ach.name}</h3>
        {ach.description && <p className="ach-single-desc">{ach.description}</p>}

        <Link to={`/game/${ach.gameId}`} className="ach-single-game clickable">
          {ach.cover && <img src={ach.cover} alt="" />}
          <div>
            <span className="ach-single-game-label">
              <PlatformIcon platform={ach.platform} size={12} /> Succès de
            </span>
            <strong>{ach.gameName}</strong>
          </div>
        </Link>

        {ach.unlockedAt && (
          <div className="ach-single-date">Débloqué le {fmtDate(ach.unlockedAt)}</div>
        )}
      </div>
    </div>
  );
}

function GameAchievementsModal({ username, token, game, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all"); // all | unlocked | locked

  useEffect(() => {
    let alive = true;
    apiFetch(`/users/${username}/achievements/${game.gameId}`, { token })
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ achievements: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token, game.gameId]);

  const all = data?.achievements || [];
  // Fond illustré (artwork paysage) façon page jeu ; repli sur la jaquette
  // tant que le détail n'est pas chargé ou si le jeu n'a pas d'artwork.
  const backdrop = data?.backdrop || game.cover;
  const shown =
    tab === "unlocked"
      ? all.filter((a) => a.unlocked)
      : tab === "locked"
      ? all.filter((a) => !a.unlocked)
      : all;

  return (
    <div className="ach-modal-overlay" onClick={onClose}>
      <div className="ach-modal" onClick={(e) => e.stopPropagation()}>
        <button className="steam-modal-close clickable" onClick={onClose}>
          <X size={18} />
        </button>
        <div
          className="ach-modal-head"
          style={backdrop ? { "--ach-modal-bg": `url(${backdrop})` } : undefined}
        >
          {game.cover && <img src={game.cover} alt="" className="ach-modal-cover" />}
          <div className="ach-modal-head-info">
            <h3>{game.name}</h3>
            <div className="ach-modal-badges">
              <span className="ach-mb">
                <PlatformIcon platform={game.platform} size={13} />
                {game.platform === "psn" ? "PlayStation" : game.platform === "steam" ? "Steam" : "Succès"}
              </span>
              <span className="ach-mb">
                <Trophy size={13} /> {game.unlocked}/{game.total}
              </span>
              {game.playtime != null && game.playtime > 0 && (
                <span className="ach-mb">
                  <Clock size={13} /> {fmtHours(game.playtime)}
                </span>
              )}
              {game.perfect && (
                <span className="ach-mb gold">
                  <Star size={13} /> Complété
                </span>
              )}
            </div>
            <div className="ach-modal-progress">
              <div className="ach-progress big">
                <div className="ach-progress-fill" style={{ width: `${game.percent}%` }} />
              </div>
              <span className="ach-modal-pct">{game.percent}%</span>
            </div>
          </div>
        </div>

        <div className="ach-modal-tabs">
          {[
            { k: "all", l: `Tous (${all.length})` },
            { k: "unlocked", l: `Débloqués (${all.filter((a) => a.unlocked).length})` },
            { k: "locked", l: `Restants (${all.filter((a) => !a.unlocked).length})` },
          ].map((t) => (
            <button
              key={t.k}
              className={`ach-modal-tab clickable ${tab === t.k ? "on" : ""}`}
              onClick={() => setTab(t.k)}
            >
              {t.l}
            </button>
          ))}
        </div>

        <div className="ach-modal-list">
          {loading ? (
            <div className="lists-loading">
              <Loader2 size={18} className="spin" /> Chargement…
            </div>
          ) : (
            shown.map((a) => (
              <div
                key={a.apiName}
                className={`ach-row ${a.unlocked ? "unlocked" : "locked"} ${rarityClass(a.rarity)}`}
              >
                <div className="ach-row-icon">
                  {a.icon ? <img src={a.icon} alt="" /> : <Trophy size={20} />}
                  {!a.unlocked && (
                    <span className="ach-row-lock">
                      <Lock size={12} />
                    </span>
                  )}
                </div>
                <div className="ach-row-body">
                  <strong>{a.hidden && !a.unlocked ? "Succès caché" : a.name}</strong>
                  <span>
                    {a.hidden && !a.unlocked
                      ? "Débloque-le pour révéler sa description."
                      : a.description}
                  </span>
                  {a.unlocked && a.unlockedAt && (
                    <span className="ach-row-date">Débloqué le {fmtDate(a.unlockedAt)}</span>
                  )}
                </div>
                {a.rarity != null && (
                  <div className="ach-row-rarity" title="% de joueurs">
                    {a.rarity}%
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
