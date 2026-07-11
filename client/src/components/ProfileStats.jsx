import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  Loader2,
  Hourglass,
  Gamepad2,
  Trophy,
  Heart,
  Star,
  Layers,
  Building2,
  Crown,
  Joystick,
  Flame,
  HeartHandshake,
  CalendarRange,
  MessageSquareText,
  Info,
  ThumbsDown,
  X,
  Skull,
  Cloud,
  Disc,
  Tv,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { makeCache } from "../lib/cache";

// Cache stale-while-revalidate des stats (par pseudo) : réaffichage instantané,
// revalidation en fond — même pattern que le profil.
const statsCache = makeCache("mpl_stats_", 10 * 60 * 1000);

// Couleurs des statuts : palette catégorielle validée (script dataviz du
// design system) — les valeurs light/dark vivent dans le CSS (--ps-c-*).
const STATUS_META = [
  { key: "playing", label: "En cours" },
  { key: "endless", label: "Sans fin" },
  { key: "finished", label: "Terminés" },
  { key: "paused", label: "En pause" },
  { key: "dropped", label: "Abandonnés" },
  { key: "wishlist", label: "À jouer" },
];

const nf = new Intl.NumberFormat("fr-FR");

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function fmtHours(h) {
  if (h >= 1000) return `${nf.format(Math.round(h / 100) / 10)} k h`;
  return `${nf.format(Math.round(h))} h`;
}

// « 312 h » -> « soit 13 jours non-stop » (accroche du hero)
function heroSub(h) {
  if (!h) return "Renseigne tes heures de jeu pour voir le compteur grimper";
  const days = h / 24;
  if (days < 2) return "L'aventure ne fait que commencer";
  if (days < 60) return `soit ${nf.format(Math.round(days))} jours de jeu non-stop`;
  return `soit ${nf.format(Math.round((days / 30.44) * 10) / 10)} mois de jeu non-stop`;
}

// Compteur animé : le chiffre grimpe jusqu'à sa valeur au montage (ease-out).
function useCountUp(target, duration = 1100) {
  const [val, setVal] = useState(REDUCED_MOTION ? target : 0);
  useEffect(() => {
    if (REDUCED_MOTION) {
      setVal(target);
      return;
    }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function CountUp({ value, duration }) {
  const v = useCountUp(value, duration);
  return nf.format(Math.round(v));
}

function StatTile({ Icon, label, value, sub }) {
  return (
    <div className="ps-tile">
      <span className="ps-tile-icon">
        <Icon size={16} />
      </span>
      <span className="ps-tile-value">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </span>
      <span className="ps-tile-label">{label}</span>
      {sub && <span className="ps-tile-sub">{sub}</span>}
    </div>
  );
}

function Card({ Icon, title, sub, wide, actions, children }) {
  return (
    <section className={`ps-card ${wide ? "wide" : ""}`}>
      <header className="ps-card-head">
        <h3 className="ps-card-title">
          <span className="ps-card-icon">
            <Icon size={15} />
          </span>
          {title}
        </h3>
        {actions || (sub && <span className="ps-card-sub">{sub}</span>)}
      </header>
      {children}
    </section>
  );
}

// Liste de barres horizontales mono-série (doré) : rangée = libellé + piste +
// valeur directe en bout — chaque valeur est lisible sans tooltip.
// `logo` affiche une pastille logo (studios, consoles), `FallbackIcon` prend
// le relais quand IGDB n'a pas de logo.
function BarList({ items, onRowClick, FallbackIcon }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="ps-barlist">
      {items.map((it, idx) => (
        <li
          key={it.key}
          className={`ps-barrow ${onRowClick ? "clickable" : ""}`}
          style={{ "--d": `${idx * 55}ms` }}
          onClick={onRowClick ? () => onRowClick(it) : undefined}
          title={it.title || it.label}
        >
          {it.cover !== undefined &&
            (it.cover ? (
              <img className="ps-barrow-cover" src={it.cover} alt="" loading="lazy" />
            ) : (
              <span className="ps-barrow-cover ph" />
            ))}
          {it.logo !== undefined &&
            (it.logo ? (
              <span className="ps-barrow-logo">
                <img src={it.logo} alt="" loading="lazy" />
              </span>
            ) : (
              <span className="ps-barrow-logo ph">
                {FallbackIcon && <FallbackIcon size={15} />}
              </span>
            ))}
          <span className="ps-barrow-label">{it.label}</span>
          <span className="ps-barrow-track">
            <span
              className="ps-barrow-fill"
              style={{ width: `${Math.max((it.value / max) * 100, 2)}%` }}
            />
          </span>
          <span className="ps-barrow-value">{it.right}</span>
        </li>
      ))}
    </ul>
  );
}

// Histogramme en colonnes (mono-série doré) : pic étiqueté, le reste au survol.
// `onColClick` rend chaque colonne cliquable (ouvre la liste des jeux du palier).
function Columns({ data, tipOf, onColClick }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="ps-cols" role="img">
      {data.map((d, idx) => {
        const clickable = onColClick && d.value > 0;
        return (
          <div
            className={`ps-col ${clickable ? "clickable" : ""}`}
            key={d.key}
            tabIndex={0}
            aria-label={tipOf(d)}
            role={clickable ? "button" : undefined}
            onClick={clickable ? () => onColClick(d) : undefined}
            onKeyDown={
              clickable
                ? (e) => (e.key === "Enter" || e.key === " ") && onColClick(d)
                : undefined
            }
          >
            <span className="ps-col-tip">{tipOf(d)}</span>
            {d.value === max && d.value > 0 && (
              <span className="ps-col-peak">{nf.format(d.value)}</span>
            )}
            <span
              className={`ps-col-fill ${d.value === 0 ? "zero" : ""}`}
              style={{ height: `${(d.value / max) * 100}%`, "--d": `${idx * 40}ms` }}
            />
            <span className="ps-col-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Démat vs physique vs let's play : barre multicolore + légende (dans la card
// Consoles). La part « let's play » n'apparaît que s'il y a des jeux vus ainsi.
// `onPick` rend chaque part cliquable (ouvre la liste des jeux concernés).
function FormatSplit({ formats, onPick }) {
  const digital = formats?.digital || 0;
  const physical = formats?.physical || 0;
  const letsplay = formats?.letsplay || 0;
  const total = digital + physical + letsplay;
  if (!total) return null;
  const pctD = Math.round((digital / total) * 100);
  const pctL = Math.round((letsplay / total) * 100);
  const pctP = 100 - pctD - pctL;
  return (
    <div className="ps-formats">
      <div className="ps-formats-legend">
        <button
          type="button"
          className="ps-format-item digital clickable"
          title={`${nf.format(digital)} jeux en dématérialisé`}
          onClick={() => onPick?.("digital")}
        >
          <Cloud size={14} /> Démat
          <strong>{pctD} %</strong>
        </button>
        <button
          type="button"
          className="ps-format-item physical clickable"
          title={`${nf.format(physical)} jeux en physique`}
          onClick={() => onPick?.("physical")}
        >
          <Disc size={14} /> Physique
          <strong>{pctP} %</strong>
        </button>
        {letsplay > 0 && (
          <button
            type="button"
            className="ps-format-item letsplay clickable"
            title={`${nf.format(letsplay)} jeux vus en let's play`}
            onClick={() => onPick?.("letsplay")}
          >
            <Tv size={14} /> Let's play
            <strong>{pctL} %</strong>
          </button>
        )}
      </div>
      <div
        className="ps-formats-bar"
        role="img"
        aria-label={`${pctD} % dématérialisé, ${pctP} % physique${
          letsplay > 0 ? `, ${pctL} % vus en let's play` : ""
        }`}
      >
        <span className="ps-formats-digital" style={{ width: `${pctD}%` }} />
        <span className="ps-formats-physical" style={{ width: `${pctP}%` }} />
        {letsplay > 0 && (
          <span className="ps-formats-letsplay" style={{ width: `${pctL}%` }} />
        )}
      </div>
    </div>
  );
}

// Tooltip custom du donut (mêmes codes que les tooltips des colonnes)
function DonutTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="ps-donut-tip">
      <span className="ps-dot" style={{ background: d.payload.fill }} />
      {d.name} : <strong>{nf.format(d.value)}</strong>
    </div>
  );
}

// « Fromage » du backlog : donut animé + total au centre, légende à côté.
function StatusDonut({ statuses, total, onSlice }) {
  const data = useMemo(
    () =>
      STATUS_META.map((m) => {
        const s = statuses.find((x) => x.key === m.key);
        return s?.count
          ? {
              key: m.key,
              name: m.label,
              value: s.count,
              games: s.games || [],
              fill: `var(--ps-c-${m.key})`,
            }
          : null;
      }).filter(Boolean),
    [statuses]
  );
  return (
    <div className="ps-donut-wrap">
      <div className="ps-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<DonutTip />} cursor={false} />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="98%"
              paddingAngle={2}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={!REDUCED_MOTION}
              animationDuration={900}
              animationBegin={150}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="ps-donut-center">
          <span className="ps-donut-total">
            <CountUp value={total} />
          </span>
          <span className="ps-donut-caption">jeux</span>
        </div>
      </div>
      <ul className="ps-legend ps-legend-col">
        {data.map((d) => (
          <li
            key={d.key}
            className={onSlice ? "clickable" : ""}
            onClick={onSlice ? () => onSlice(d) : undefined}
            role={onSlice ? "button" : undefined}
            tabIndex={onSlice ? 0 : undefined}
            onKeyDown={
              onSlice
                ? (e) => (e.key === "Enter" || e.key === " ") && onSlice(d)
                : undefined
            }
          >
            <span className="ps-dot" style={{ background: d.fill }} />
            {d.name}
            <strong>{nf.format(d.value)}</strong>
            <span className="ps-legend-pct">{Math.round((d.value / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Modal « jeux en commun » : l'intersection complète des deux bibliothèques,
// coups de cœur partagés en tête (endpoint /users/:me/common/:other).
function CommonGamesModal({ me, soulmate, token, onClose }) {
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch(`/users/${me}/common/${soulmate.username}`, { token })
      .then((d) => alive && setGames(d.games))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [me, soulmate.username, token]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal ps-common-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          <HeartHandshake size={20} /> Jeux en commun avec {soulmate.username}
        </h2>
        {games && (
          <p className="ps-common-modal-sub">
            {nf.format(games.length)} jeux partagés
            {games.some((g) => g.myFav && g.theirFav) &&
              ` — dont ${nf.format(
                games.filter((g) => g.myFav && g.theirFav).length
              )} coups de cœur mutuels`}
          </p>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        {!games && !error && (
          <div className="lists-loading">
            <Loader2 size={18} className="spin" /> Chargement…
          </div>
        )}
        {games && (
          <div className="ps-common-grid">
            {games.map((g) => (
              <Link
                key={g.gameId}
                to={`/game/${g.gameId}`}
                className="ps-common-item"
                title={g.name}
                onClick={onClose}
              >
                {(g.myFav || g.theirFav) && (
                  <span
                    className={`ps-common-heart ${g.myFav && g.theirFav ? "both" : ""}`}
                    title={
                      g.myFav && g.theirFav
                        ? "Coup de cœur mutuel"
                        : g.myFav
                          ? "Ton coup de cœur"
                          : `Coup de cœur de ${soulmate.username}`
                    }
                  >
                    <Heart size={11} fill="currentColor" />
                  </span>
                )}
                {g.cover ? (
                  <img src={g.cover} alt={g.name} loading="lazy" />
                ) : (
                  <span className="ps-common-ph">{g.name}</span>
                )}
                <span className="ps-common-name">{g.name}</span>
                {(g.myRating != null || g.theirRating != null) && (
                  <span className="ps-common-ratings">
                    <span title="Ta note">{g.myRating ?? "—"}</span>
                    <span className="ps-common-vs">·</span>
                    <span title={`Note de ${soulmate.username}`}>
                      {g.theirRating ?? "—"}
                    </span>
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Pop-up générique « les jeux de cette stat » : ouverte au clic sur une barre,
// une colonne, une part du donut… Liste de jaquettes qui défile (scroll), chaque
// jaquette mène à la page du jeu. `total` = effectif réel de la facette (la liste
// peut être plafonnée côté serveur → on l'indique).
function FacetGamesModal({ title, Icon, games, total, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const capped = total != null && total > games.length;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal ps-common-modal ps-facet-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          {Icon && <Icon size={20} />} {title}
        </h2>
        <p className="ps-common-modal-sub">
          {nf.format(total != null ? total : games.length)} jeu
          {(total != null ? total : games.length) > 1 ? "x" : ""}
          {capped && ` — aperçu des ${nf.format(games.length)} premiers`}
        </p>
        {games.length ? (
          <div className="ps-common-grid ps-facet-grid">
            {games.map((g) => (
              <Link
                key={g.gameId}
                to={`/game/${g.gameId}`}
                className="ps-common-item"
                title={g.name}
                onClick={onClose}
              >
                {g.cover ? (
                  <img src={g.cover} alt={g.name} loading="lazy" />
                ) : (
                  <span className="ps-common-ph">{g.name}</span>
                )}
                <span className="ps-common-name">{g.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="ps-meter-note">Aucun jeu à afficher ici.</p>
        )}
      </div>
    </div>,
    document.body
  );
}

export default function ProfileStats({ username, token }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [companyTab, setCompanyTab] = useState("developers");
  const [commonOpen, setCommonOpen] = useState(false);
  // Pop-up « les jeux de cette stat » : { title, Icon, games, total } | null
  const [facet, setFacet] = useState(null);
  const openFacet = (title, Icon, games, total) =>
    setFacet({ title, Icon, games: games || [], total });

  useEffect(() => {
    if (!username) return;
    let alive = true;
    const cached = statsCache.get(username);
    if (cached) {
      setStats(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    apiFetch(`/users/${username}/stats`, { token })
      .then((d) => {
        if (!alive) return;
        setStats(d);
        statsCache.set(username, d);
      })
      .catch((e) => alive && !cached && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  if (loading && !stats)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Calcul des statistiques…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;
  if (!stats) return null;

  const t = stats.totals;
  if (!t.games)
    return (
      <div className="profile-empty font-fun">
        Pas encore de jeux, pas encore de stats — la légende reste à écrire.
      </div>
    );

  const statusTotal = stats.statuses.reduce((s, x) => s + x.count, 0) || 1;
  const goGame = (it) => navigate(`/game/${it.key}`);
  const goCompany = (name, role) =>
    navigate(`/company/${encodeURIComponent(name)}?role=${role}`);
  const soulmate = stats.soulmates[0];
  const others = stats.soulmates.slice(1);
  const topRated = stats.ratings.top;
  const flops = stats.ratings.flop || [];
  const companies =
    companyTab === "developers" ? stats.developers : stats.publishers || [];

  return (
    <div className="ps">
      {/* ---------- Hero : temps de jeu + KPI ---------- */}
      <section className="ps-hero">
        <div className="ps-hero-main">
          <span className="ps-hero-kicker">
            <Hourglass size={15} /> Temps de jeu total
          </span>
          <span className="ps-hero-value">
            <CountUp value={Math.round(t.hours)} duration={1500} />
            <span className="ps-hero-unit">h</span>
          </span>
          <span className="ps-hero-sub font-fun">{heroSub(t.hours)}</span>
        </div>
        <div className="ps-tiles">
          <StatTile Icon={Gamepad2} label="Jeux" value={t.games} />
          <StatTile
            Icon={Trophy}
            label="Terminés"
            value={t.finished}
            sub={t.completionRate != null ? `${t.completionRate} % des jeux lancés` : null}
          />
          <StatTile
            Icon={Star}
            label="Note moyenne"
            value={t.avgRating != null ? t.avgRating : "—"}
            sub={t.rated ? `sur ${nf.format(t.rated)} jeux notés` : "aucun jeu noté"}
          />
          {/* <StatTile Icon={Heart} label="Coups de cœur" value={t.favorites} /> */}
          <StatTile Icon={MessageSquareText} label="Reviews" value={t.reviews} />
        </div>
      </section>

      <div className="ps-grid">
        {/* ---------- Backlog : donut des statuts ---------- */}
        <Card Icon={Layers} title="État du backlog" sub={`${nf.format(t.games)} jeux`}>
          <StatusDonut
            statuses={stats.statuses}
            total={statusTotal}
            onSlice={(d) => openFacet(d.name, Layers, d.games, d.value)}
          />
          {t.completionRate != null && (
            <div className="ps-meter-block">
              <div className="ps-meter-line">
                <span>Taux de complétion</span>
                <strong>{t.completionRate} %</strong>
              </div>
              <div className="ps-meter">
                <span className="ps-meter-fill" style={{ width: `${t.completionRate}%` }} />
              </div>
              <p className="ps-meter-note">
                {t.completionRate} % des jeux que tu lances finissent au générique
                {t.droppedRate ? ` — ${t.droppedRate} % sont abandonnés en route.` : "."}
              </p>
            </div>
          )}
        </Card>

        {/* ---------- Marathon : jeux avec le plus d'heures ---------- */}
        {stats.topByHours.length > 0 && (
          <Card Icon={Flame} title="Les marathons" sub="jeux les plus joués">
            {stats.topByHours[0] && (
              <Link
                to={`/game/${stats.topByHours[0].gameId}`}
                className="ps-marathon-hero"
                title={stats.topByHours[0].name}
              >
                {stats.topByHours[0].cover ? (
                  <img src={stats.topByHours[0].cover} alt="" loading="lazy" />
                ) : (
                  <span className="ps-barrow-cover ph" />
                )}
                <span className="ps-marathon-hero-body">
                  <span className="ps-marathon-hero-badge">
                    <Flame size={11} /> N°1
                  </span>
                  <span className="ps-marathon-hero-name">
                    {stats.topByHours[0].name}
                  </span>
                </span>
                <span className="ps-marathon-hero-hours">
                  {fmtHours(stats.topByHours[0].hours)}
                </span>
              </Link>
            )}
            {stats.topByHours.length > 1 && (
              <BarList
                onRowClick={goGame}
                items={stats.topByHours.slice(1).map((g) => ({
                  key: g.gameId,
                  label: g.name,
                  cover: g.cover,
                  value: g.hours,
                  right: fmtHours(g.hours),
                  title: g.name,
                }))}
              />
            )}
          </Card>
        )}

        {/* ---------- Genres préférés ---------- */}
        {stats.genres.length > 0 && (
          <Card Icon={Gamepad2} title="Genres de prédilection" sub="part des jeux joués">
            <BarList
              onRowClick={(it) => openFacet(it.label, Gamepad2, it.games, it.value)}
              items={stats.genres.map((g) => ({
                key: g.name,
                label: g.name,
                value: g.count,
                games: g.games,
                right: `${g.pct} %`,
                title: `${g.name} : ${g.count} jeux — voir la liste`,
              }))}
            />
          </Card>
        )}

        {/* ---------- Studios / éditeurs (avec logos) ---------- */}
        {(stats.developers.length > 0 || (stats.publishers || []).length > 0) && (
          <Card
            Icon={Building2}
            title="Studios & éditeurs"
            actions={
              <span className="ps-seg">
                <button
                  className={`clickable ${companyTab === "developers" ? "active" : ""}`}
                  onClick={() => setCompanyTab("developers")}
                >
                  Studios
                </button>
                <button
                  className={`clickable ${companyTab === "publishers" ? "active" : ""}`}
                  onClick={() => setCompanyTab("publishers")}
                >
                  Éditeurs
                </button>
              </span>
            }
          >
            {companies.length ? (
              <BarList
                FallbackIcon={Building2}
                onRowClick={(it) =>
                  goCompany(it.key, companyTab === "developers" ? "dev" : "pub")
                }
                items={companies.map((d) => ({
                  key: d.name,
                  label: d.name,
                  logo: d.logo ?? null,
                  value: d.count,
                  right: `${d.pct} %`,
                  title: `${d.name} : ${d.count} jeux — ouvrir la fiche`,
                }))}
              />
            ) : (
              <p className="ps-meter-note">Pas encore de données de ce côté-là.</p>
            )}
          </Card>
        )}

        {/* ---------- Consoles (avec logos) ---------- */}
        {stats.platforms.length > 0 && (
          <Card Icon={Joystick} title="Consoles & supports" sub="jeux joués par support">
            <BarList
              FallbackIcon={Joystick}
              onRowClick={(it) => openFacet(it.label, Joystick, it.games, it.value)}
              items={stats.platforms.map((p) => ({
                key: p.name,
                label: p.name,
                logo: p.logo ?? null,
                value: p.count,
                games: p.games,
                right: p.hours
                  ? `${p.pct} % · ${fmtHours(p.hours)}`
                  : `${p.pct} %`,
                title: `${p.name} : ${p.count} jeux${p.hours ? `, ${fmtHours(p.hours)}` : ""} — voir la liste`,
              }))}
            />
            <FormatSplit
              formats={stats.formats}
              onPick={(kind) =>
                kind === "physical"
                  ? openFacet("Jeux physiques", Disc, stats.formats.physicalGames, stats.formats.physical)
                  : kind === "letsplay"
                    ? openFacet("Jeux vus en let's play", Tv, stats.formats.letsplayGames, stats.formats.letsplay)
                    : openFacet("Jeux dématérialisés", Cloud, stats.formats.digitalGames, stats.formats.digital)
              }
            />
          </Card>
        )}

        {/* ---------- Notes ---------- */}
        {t.rated > 0 && (
          <Card Icon={Star} title="À la loupe des notes" sub={`moyenne ${t.avgRating} / 100`}>
            <Columns
              data={stats.ratings.dist.map((v, i) => ({
                key: i,
                label: i === 0 ? "0" : `${i * 10}`,
                value: v,
                games: stats.ratings.distGames?.[i] || [],
              }))}
              tipOf={(d) =>
                `${d.label}–${Number(d.label) + 10} : ${nf.format(d.value)} jeu${d.value > 1 ? "x" : ""}`
              }
              onColClick={(d) =>
                openFacet(
                  `Notes de ${d.label} à ${Number(d.label) + 10}`,
                  Star,
                  d.games,
                  d.value
                )
              }
            />
            {topRated.length > 0 && (
              <>
                <div className="ps-subhead">Le panthéon</div>
                <div className="ps-podium">
                  {topRated.map((g, i) => (
                    <Link
                      key={g.gameId}
                      to={`/game/${g.gameId}`}
                      className={`ps-podium-item ${i === 0 ? "first" : ""}`}
                      title={`${g.name} — ${g.rating} / 100`}
                    >
                      {i === 0 && (
                        <span className="ps-podium-crown">
                          <Crown size={13} />
                        </span>
                      )}
                      {g.cover ? (
                        <img src={g.cover} alt={g.name} loading="lazy" />
                      ) : (
                        <span className="ps-podium-ph">{g.name}</span>
                      )}
                      <span className="ps-podium-note">{g.rating}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
        )}

        {/* ---------- Les mal-aimés : pires notes ---------- */}
        {flops.length > 0 && (
          <Card
            Icon={ThumbsDown}
            title="Les mal-aimés"
            sub="ils ne t'ont pas convaincu"
          >
            <ul className="ps-flops">
              {flops.map((g) => (
                <li key={g.gameId}>
                  <Link to={`/game/${g.gameId}`} className="ps-flop clickable" title={g.name}>
                    {g.cover ? (
                      <img className="ps-flop-cover" src={g.cover} alt="" loading="lazy" />
                    ) : (
                      <span className="ps-flop-cover ph" />
                    )}
                    <span className="ps-flop-body">
                      <span className="ps-flop-name">{g.name}</span>
                      {g.dropped && (
                        <span className="ps-flop-dropped">
                          <Skull size={11} /> Abandonné
                        </span>
                      )}
                    </span>
                    <span className="ps-flop-note">{g.rating}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ---------- Franchises ---------- */}
        {stats.franchises.length > 0 && (
          <Card Icon={Crown} title="Franchises fétiches" sub="sagas les plus présentes">
            <ul className="ps-franchises">
              {stats.franchises.map((f) => (
                <li
                  className="ps-franchise clickable"
                  key={f.name}
                  role="button"
                  tabIndex={0}
                  title={`${f.name} — voir les ${f.count} jeux`}
                  onClick={() => openFacet(f.name, Crown, f.games, f.count)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    openFacet(f.name, Crown, f.games, f.count)
                  }
                >
                  <span className="ps-franchise-covers">
                    {f.covers.map((c, i) => (
                      <img key={i} src={c} alt="" loading="lazy" style={{ "--i": i }} />
                    ))}
                  </span>
                  <span className="ps-franchise-name">{f.name}</span>
                  <span className="ps-franchise-count">×{f.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* ---------- Décennies ---------- */}
        {stats.decades.length > 1 && (
          <Card
            Icon={CalendarRange}
            title="Machine à remonter le temps"
            sub="jeux joués par décennie de sortie"
          >
            <Columns
              data={stats.decades.map((d) => ({
                key: d.decade,
                label: `${String(d.decade).slice(2)}s`,
                value: d.count,
                games: d.games,
              }))}
              tipOf={(d) => `Années ${d.key} : ${nf.format(d.value)} jeu${d.value > 1 ? "x" : ""}`}
              onColClick={(d) =>
                openFacet(`Jeux des années ${d.key}`, CalendarRange, d.games, d.value)
              }
            />
          </Card>
        )}

        {/* ---------- Âme sœur gaming ---------- */}
        {soulmate && (
          <Card Icon={HeartHandshake} title="Âme sœur gaming" sub="mêmes goûts, même manette">
            <Link to={`/u/${soulmate.username}`} className="ps-soulmate clickable">
              <span className="ps-soulmate-avatar">
                {soulmate.avatar ? (
                  <img src={soulmate.avatar} alt={soulmate.username} />
                ) : (
                  <span className="ps-soulmate-fallback">
                    {soulmate.username[0].toUpperCase()}
                  </span>
                )}
              </span>
              <span className="ps-soulmate-body">
                <span className="ps-soulmate-name">{soulmate.username}</span>
                <span className="ps-soulmate-common">
                  {nf.format(soulmate.common)} jeux en commun
                  {soulmate.sharedFavs
                    ? ` · ${nf.format(soulmate.sharedFavs)} coup${soulmate.sharedFavs > 1 ? "s" : ""} de cœur mutuel${soulmate.sharedFavs > 1 ? "s" : ""}`
                    : ""}
                </span>
              </span>
              <span className="ps-soulmate-match">
                <span className="ps-soulmate-num">
                  <CountUp value={soulmate.match} duration={1400} />
                  <span className="ps-soulmate-pct">%</span>
                </span>
                <span className="ps-soulmate-affin">d'affinité</span>
              </span>
            </Link>
            {soulmate.topCommon.length > 0 && (
              <div className="ps-common-covers">
                {soulmate.topCommon.map((g) => (
                  <Link key={g.gameId} to={`/game/${g.gameId}`} title={g.name}>
                    {g.cover ? (
                      <img src={g.cover} alt={g.name} loading="lazy" />
                    ) : (
                      <span className="ps-podium-ph">{g.name}</span>
                    )}
                  </Link>
                ))}
              </div>
            )}
            <button
              className="ps-common-all clickable"
              onClick={() => setCommonOpen(true)}
            >
              <Gamepad2 size={14} /> Voir les {nf.format(soulmate.common)} jeux en
              commun
            </button>
            {others.length > 0 && (
              <ul className="ps-runnerups">
                {others.map((s) => (
                  <li key={s.id}>
                    <Link to={`/u/${s.username}`} className="clickable">
                      <span className="ps-runnerup-avatar">
                        {s.avatar ? (
                          <img src={s.avatar} alt="" />
                        ) : (
                          <span>{s.username[0].toUpperCase()}</span>
                        )}
                      </span>
                      {s.username}
                      <strong>{s.match} %</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {stats.metaCoverage < 90 && (
        <p className="ps-coverage">
          <Info size={13} /> Genres, studios et franchises calculés sur{" "}
          {stats.metaCoverage} % de la bibliothèque (métadonnées en cours de
          récupération).
        </p>
      )}

      {commonOpen && soulmate && (
        <CommonGamesModal
          me={username}
          soulmate={soulmate}
          token={token}
          onClose={() => setCommonOpen(false)}
        />
      )}

      {facet && (
        <FacetGamesModal
          title={facet.title}
          Icon={facet.Icon}
          games={facet.games}
          total={facet.total}
          onClose={() => setFacet(null)}
        />
      )}
    </div>
  );
}
