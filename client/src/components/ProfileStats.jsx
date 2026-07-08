import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  { key: "finished", label: "Terminés" },
  { key: "paused", label: "En pause" },
  { key: "dropped", label: "Abandonnés" },
  { key: "wishlist", label: "À jouer" },
];

const nf = new Intl.NumberFormat("fr-FR");

function fmtHours(h) {
  if (h >= 1000) return `${nf.format(Math.round(h / 100) / 10).replace(",", ",")} k h`;
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

function StatTile({ Icon, label, value, sub }) {
  return (
    <div className="ps-tile">
      <span className="ps-tile-icon">
        <Icon size={17} />
      </span>
      <span className="ps-tile-value">{value}</span>
      <span className="ps-tile-label">{label}</span>
      {sub && <span className="ps-tile-sub">{sub}</span>}
    </div>
  );
}

function Card({ Icon, title, sub, wide, children }) {
  return (
    <section className={`ps-card ${wide ? "wide" : ""}`}>
      <header className="ps-card-head">
        <h3 className="ps-card-title">
          <Icon size={17} /> {title}
        </h3>
        {sub && <span className="ps-card-sub">{sub}</span>}
      </header>
      {children}
    </section>
  );
}

// Liste de barres horizontales mono-série (doré) : rangée = libellé + piste +
// valeur directe en bout — chaque valeur est lisible sans tooltip.
function BarList({ items, onRowClick }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="ps-barlist">
      {items.map((it) => (
        <li
          key={it.key}
          className={`ps-barrow ${onRowClick ? "clickable" : ""}`}
          onClick={onRowClick ? () => onRowClick(it) : undefined}
          title={it.title || it.label}
        >
          {it.cover !== undefined &&
            (it.cover ? (
              <img className="ps-barrow-cover" src={it.cover} alt="" loading="lazy" />
            ) : (
              <span className="ps-barrow-cover ph" />
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
function Columns({ data, tipOf }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="ps-cols" role="img">
      {data.map((d) => (
        <div className="ps-col" key={d.key} tabIndex={0} aria-label={tipOf(d)}>
          <span className="ps-col-tip">{tipOf(d)}</span>
          {d.value === max && d.value > 0 && (
            <span className="ps-col-peak">{nf.format(d.value)}</span>
          )}
          <span
            className={`ps-col-fill ${d.value === 0 ? "zero" : ""}`}
            style={{ height: `${(d.value / max) * 100}%` }}
          />
          <span className="ps-col-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function ProfileStats({ username, token }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  if (error)
    return <div className="profile-empty font-fun">{error}</div>;
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
  const soulmate = stats.soulmates[0];
  const others = stats.soulmates.slice(1);
  const topRated = stats.ratings.top;

  return (
    <div className="ps">
      {/* ---------- Hero : temps de jeu + KPI ---------- */}
      <section className="ps-hero">
        <div className="ps-hero-main">
          <span className="ps-hero-kicker">
            <Hourglass size={15} /> Temps de jeu total
          </span>
          <span className="ps-hero-value">
            {nf.format(Math.round(t.hours))}
            <span className="ps-hero-unit">h</span>
          </span>
          <span className="ps-hero-sub font-fun">{heroSub(t.hours)}</span>
        </div>
        <div className="ps-tiles">
          <StatTile Icon={Gamepad2} label="Jeux" value={nf.format(t.games)} />
          <StatTile
            Icon={Trophy}
            label="Terminés"
            value={nf.format(t.finished)}
            sub={t.completionRate != null ? `${t.completionRate} % des jeux lancés` : null}
          />
          <StatTile
            Icon={Star}
            label="Note moyenne"
            value={t.avgRating != null ? `${t.avgRating}` : "—"}
            sub={t.rated ? `sur ${nf.format(t.rated)} jeux notés` : "aucun jeu noté"}
          />
          <StatTile Icon={Heart} label="Coups de cœur" value={nf.format(t.favorites)} />
          <StatTile Icon={MessageSquareText} label="Reviews" value={nf.format(t.reviews)} />
        </div>
      </section>

      <div className="ps-grid">
        {/* ---------- Backlog : répartition des statuts ---------- */}
        <Card Icon={Layers} title="État du backlog" sub={`${nf.format(t.games)} jeux`}>
          <div className="ps-stack" role="img" aria-label="Répartition des statuts">
            {stats.statuses
              .filter((s) => s.count > 0)
              .map((s) => (
                <span
                  key={s.key}
                  className={`ps-stack-seg c-${s.key}`}
                  style={{ width: `${(s.count / statusTotal) * 100}%` }}
                  title={`${STATUS_META.find((m) => m.key === s.key)?.label} : ${s.count}`}
                />
              ))}
          </div>
          <ul className="ps-legend">
            {STATUS_META.map((m) => {
              const s = stats.statuses.find((x) => x.key === m.key);
              if (!s?.count) return null;
              return (
                <li key={m.key}>
                  <span className={`ps-dot c-${m.key}`} />
                  {m.label}
                  <strong>{nf.format(s.count)}</strong>
                  <span className="ps-legend-pct">
                    {Math.round((s.count / statusTotal) * 100)} %
                  </span>
                </li>
              );
            })}
          </ul>
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
            <BarList
              onRowClick={goGame}
              items={stats.topByHours.map((g) => ({
                key: g.gameId,
                label: g.name,
                cover: g.cover,
                value: g.hours,
                right: fmtHours(g.hours),
                title: g.name,
              }))}
            />
          </Card>
        )}

        {/* ---------- Genres préférés ---------- */}
        {stats.genres.length > 0 && (
          <Card Icon={Gamepad2} title="Genres de prédilection" sub="part des jeux joués">
            <BarList
              items={stats.genres.map((g) => ({
                key: g.name,
                label: g.name,
                value: g.count,
                right: `${g.pct} %`,
                title: `${g.name} : ${g.count} jeux`,
              }))}
            />
          </Card>
        )}

        {/* ---------- Studios préférés ---------- */}
        {stats.developers.length > 0 && (
          <Card Icon={Building2} title="Studios de cœur" sub="part des jeux joués">
            <BarList
              items={stats.developers.map((d) => ({
                key: d.name,
                label: d.name,
                value: d.count,
                right: `${d.pct} %`,
                title: `${d.name} : ${d.count} jeux`,
              }))}
            />
          </Card>
        )}

        {/* ---------- Consoles ---------- */}
        {stats.platforms.length > 0 && (
          <Card Icon={Joystick} title="Consoles & supports" sub="jeux joués par support">
            <BarList
              items={stats.platforms.map((p) => ({
                key: p.name,
                label: p.name,
                value: p.count,
                right: p.hours
                  ? `${nf.format(p.count)} · ${fmtHours(p.hours)}`
                  : nf.format(p.count),
                title: `${p.name} : ${p.count} jeux${p.hours ? `, ${fmtHours(p.hours)}` : ""}`,
              }))}
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
              }))}
              tipOf={(d) =>
                `${d.label}–${Number(d.label) + 10} : ${nf.format(d.value)} jeu${d.value > 1 ? "x" : ""}`
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

        {/* ---------- Franchises ---------- */}
        {stats.franchises.length > 0 && (
          <Card Icon={Crown} title="Franchises fétiches" sub="sagas les plus présentes">
            <ul className="ps-franchises">
              {stats.franchises.map((f) => (
                <li className="ps-franchise" key={f.name}>
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
              }))}
              tipOf={(d) => `Années ${d.key} : ${nf.format(d.value)} jeu${d.value > 1 ? "x" : ""}`}
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
                </span>
              </span>
              <span className="ps-soulmate-match">
                <span className="ps-soulmate-num">
                  {soulmate.match}
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
    </div>
  );
}
