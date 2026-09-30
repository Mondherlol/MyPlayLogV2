import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  Cpu,
  Loader2,
  MemoryStick,
  Radio,
  RefreshCw,
  ServerCrash,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Onglet Statistiques du panel Admin — l'activité du site et l'histoire
//  du serveur, en courbes. Serveur : lib/siteStats.js.
// ======================================================================

// Les couleurs des séries, dans cet ordre (validé : jaune/rose/bleu restent
// distincts pour les daltoniens). Le texte, lui, ne prend jamais ces couleurs.
const C1 = "#f2b70b";
const C2 = "#ff5470";
const C3 = "#3987e5";
const CRIT = "#d03b3b";

const SITE_RANGES = [
  [7, "7 j"],
  [30, "30 j"],
  [90, "90 j"],
  [365, "1 an"],
];
const SERVER_RANGES = [
  [6, "6 h"],
  [24, "24 h"],
  [168, "7 j"],
  [720, "30 j"],
];
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("fr-FR"));
const fmt1 = (n) => (n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString("fr-FR"));
function fmtBytes(b) {
  if (b == null) return "—";
  const u = ["o", "Ko", "Mo", "Go"];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${u[i]}`;
}
function fmtDuration(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d} j ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}
const dayDate = (d) => new Date(`${d}T12:00:00`);
const fmtDay = (d) => dayDate(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const fmtDayLong = (d) => dayDate(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtTime = (t, long) =>
  new Date(t).toLocaleString(
    "fr-FR",
    long ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }
  );

// Sur un an, un point par semaine (sommes ; les actifs en moyenne par jour).
function byWeek(series) {
  const out = [];
  for (const r of series) {
    const d = dayDate(r.day);
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    let w = out.at(-1);
    if (!w || w.day !== key) {
      w = { day: key, week: true, n: 0, signups: 0, users: 0, active: 0, activity: 0, messages: 0, games: 0 };
      out.push(w);
    }
    w.n += 1;
    w.signups += r.signups;
    w.users = r.users;
    w.active += r.active;
    w.activity += r.activity;
    w.messages += r.messages;
    w.games += r.games;
  }
  return out.map((w) => ({ ...w, active: Math.round((w.active / w.n) * 10) / 10 }));
}

// ----------------------------------------------------------------------
//  Petites pièces
// ----------------------------------------------------------------------
function Tile({ Icon, label, value, delta, sub }) {
  return (
    <div className="st-tile">
      <span className="st-tile-label">
        <Icon size={14} /> {label}
      </span>
      <strong className="st-tile-value">{value}</strong>
      {delta != null && (
        <span className={`st-delta ${delta > 0 ? "up" : delta < 0 ? "down" : ""}`}>
          {delta > 0 ? <ArrowUpRight size={13} /> : delta < 0 ? <ArrowDownRight size={13} /> : null}
          {delta > 0 ? "+" : ""}
          {fmt(delta)} {sub}
        </span>
      )}
      {delta == null && sub && <span className="st-tile-sub">{sub}</span>}
    </div>
  );
}

// L'infobulle commune : la date en tête, une ligne par série (pastille de
// couleur + nom + valeur en encre normale).
function Tip({ active, payload, label, title, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="st-tip">
      <b>{title ? title(label, p) : label}</b>
      {rows.map(([key, name, color, f = fmt]) =>
        p[key] == null ? null : (
          <span key={key}>
            {color ? <i style={{ background: color }} /> : <i className="none" />}
            {name}
            <em>{f(p[key])}</em>
          </span>
        )
      )}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="st-legend">
      {items.map(([name, color]) => (
        <span key={name}>
          <i style={{ background: color }} />
          {name}
        </span>
      ))}
    </div>
  );
}

function Card({ title, aside, children, wide }) {
  return (
    <section className={`st-card ${wide ? "wide" : ""}`}>
      <header className="st-card-head">
        <h3>{title}</h3>
        {aside && <span className="st-card-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

const AXIS = { tickLine: false, axisLine: false, fontSize: 11, className: "st-axis" };
const CURSOR = { stroke: "var(--text-soft)", strokeWidth: 1, strokeOpacity: 0.4 };
const BAR_CURSOR = { fill: "var(--text)", fillOpacity: 0.05 };

// ----------------------------------------------------------------------
//  La carte de chaleur : jour de la semaine × heure
// ----------------------------------------------------------------------
function Heatmap({ heat }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...heat.flat());
  const total = heat.flat().reduce((a, b) => a + b, 0);
  // Le créneau le plus chargé, écrit en clair (la carte ne doit pas être la
  // seule à le dire).
  let peak = null;
  heat.forEach((row, w) => row.forEach((n, h) => (!peak || n > peak.n) && (peak = { w, h, n })));
  return (
    <div className="st-heat-wrap">
      <div className="st-heat" onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="st-heat-h">
            {h % 3 === 0 ? `${h}h` : ""}
          </span>
        ))}
        {heat.map((row, w) => (
          <div className="st-heat-row" key={w}>
            <span className="st-heat-d">{WEEKDAYS[w]}</span>
            {row.map((n, h) => (
              <span
                key={h}
                className={`st-heat-cell ${n ? "" : "zero"} ${hover?.w === w && hover?.h === h ? "on" : ""}`}
                style={n ? { "--a": 0.12 + 0.88 * (n / max) } : null}
                onMouseEnter={() => setHover({ w, h, n })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="st-heat-foot">
        <span className="st-heat-read">
          {hover
            ? `${WEEKDAYS[hover.w]} ${hover.h}h–${hover.h + 1}h · ${fmt(hover.n)} action${hover.n > 1 ? "s" : ""}`
            : peak && total
              ? `Pic : ${WEEKDAYS[peak.w]} ${peak.h}h–${peak.h + 1}h (${fmt(peak.n)})`
              : "Pas encore d'activité sur la période"}
        </span>
        <span className="st-heat-scale">
          moins
          {[0.12, 0.34, 0.56, 0.78, 1].map((a) => (
            <i key={a} style={{ "--a": a }} />
          ))}
          plus
        </span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
//  Le site
// ----------------------------------------------------------------------
function SiteView({ data }) {
  const weekly = data.days > 90;
  const series = useMemo(() => (weekly ? byWeek(data.series) : data.series), [data, weekly]);
  const k = data.kpi;
  const label = (d, p) => (p?.week ? `Semaine du ${fmtDay(d)}` : fmtDayLong(d));
  const avgActive = data.series.length ? data.series.reduce((n, r) => n + r.active, 0) / data.series.length : 0;
  const maxFam = Math.max(1, ...data.families.map((f) => f.n));
  const per = weekly ? "/ sem." : "/ jour";

  return (
    <>
      <div className="st-tiles">
        <Tile Icon={Users} label="Joueurs" value={fmt(k.users)} />
        <Tile Icon={UserPlus} label="Nouveaux" value={fmt(k.newUsers)} delta={k.newUsers - k.prevNewUsers} sub="vs période d'avant" />
        <Tile Icon={Zap} label="Aujourd'hui" value={fmt(k.today)} sub="joueurs actifs" />
        <Tile Icon={Activity} label="Actifs 7 j" value={fmt(k.week)} />
        <Tile Icon={Activity} label="Actifs 30 j" value={fmt(k.month)} />
        <Tile Icon={Radio} label="En ligne" value={fmt(k.online)} />
      </div>

      <div className="st-grid">
        <Card title="Joueurs actifs" aside={`${fmt1(avgActive)} en moyenne par jour`} wide>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                cursor={CURSOR}
                content={<Tip title={label} rows={[["active", weekly ? "Actifs (moy. / jour)" : "Actifs", C1, fmt1]]} />}
              />
              <Area
                type="linear"
                dataKey="active"
                stroke={C1}
                strokeWidth={2}
                fill={C1}
                fillOpacity={0.1}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2, fill: C1 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Inscriptions" aside={`${fmt(k.newUsers)} sur la période`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                cursor={BAR_CURSOR}
                content={
                  <Tip
                    title={label}
                    rows={[
                      ["signups", "Nouveaux", C1],
                      ["users", "Total des joueurs", null],
                    ]}
                  />
                }
              />
              <Bar dataKey="signups" fill={C1} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Total des joueurs" aside={fmt(k.users)}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} domain={["dataMin", "auto"]} {...AXIS} />
              <Tooltip cursor={CURSOR} content={<Tip title={label} rows={[["users", "Joueurs", C1]]} />} />
              <Line
                type="linear"
                dataKey="users"
                stroke={C1}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2, fill: C1 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Activité ${per}`} wide>
          <Legend
            items={[
              ["Actions du fil", C1],
              ["Messages", C2],
              ["Jeux ajoutés", C3],
            ]}
          />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                cursor={CURSOR}
                content={
                  <Tip
                    title={label}
                    rows={[
                      ["activity", "Actions du fil", C1],
                      ["messages", "Messages", C2],
                      ["games", "Jeux ajoutés", C3],
                    ]}
                  />
                }
              />
              {[
                ["activity", C1],
                ["messages", C2],
                ["games", C3],
              ].map(([key, color]) => (
                <Line
                  key={key}
                  type="linear"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: color }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Pics d'activité" wide>
          <Heatmap heat={data.heat} />
        </Card>

        <Card title="Ce que font les joueurs">
          {data.families.length === 0 ? (
            <p className="st-empty">Rien sur la période.</p>
          ) : (
            <div className="st-bars">
              {data.families.map((f) => (
                <div className="st-bar-row" key={f.label}>
                  <span className="st-bar-name">{f.label}</span>
                  <span className="st-bar-track">
                    <span className="st-bar-fill" style={{ width: `${(f.n / maxFam) * 100}%` }} />
                  </span>
                  <b>{fmt(f.n)}</b>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Les plus actifs">
          {data.top.length === 0 ? (
            <p className="st-empty">Personne sur la période.</p>
          ) : (
            <ol className="st-top">
              {data.top.map((u, i) => (
                <li key={u.id}>
                  <span className="st-top-rank">{i + 1}</span>
                  <span className="au-avatar sm">
                    {u.avatar ? (
                      <img src={u.avatar} alt="" />
                    ) : (
                      <span className="au-avatar-fallback">{(u.username || "?")[0].toUpperCase()}</span>
                    )}
                  </span>
                  <Link to={`/u/${u.username}`} className="clickable">
                    {u.username}
                  </Link>
                  <b>{fmt(u.n)}</b>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------
//  Le serveur
// ----------------------------------------------------------------------
function ServerView({ data }) {
  const k = data.kpi;
  const long = data.hours > 24;
  const tick = (t) =>
    long ? new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : fmtTime(t);
  const title = (t) => fmtTime(t, true);
  const pts = data.points;

  if (!data.samples) {
    return (
      <div className="st-card wide st-wait">
        <Loader2 size={18} className="spin" />
        Premier relevé du serveur dans moins de 5 minutes : les courbes se remplissent au fil du temps.
      </div>
    );
  }

  const chart = (children, height = 220) => (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  );
  // Sur plusieurs jours, une graduation par jour à minuit (sinon la même date
  // revenait deux fois) ; sur 30 jours, une tous les 5 jours.
  let ticks;
  if (long && pts.length) {
    ticks = [];
    const d = new Date(pts[0].t);
    d.setHours(24, 0, 0, 0);
    for (; d.getTime() <= pts.at(-1).t; d.setDate(d.getDate() + 1)) ticks.push(d.getTime());
    const step = Math.ceil(ticks.length / 8);
    ticks = ticks.filter((_, i) => i % step === 0);
  }
  const x = (
    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={ticks} tickFormatter={tick} minTickGap={long ? 8 : 36} {...AXIS} />
  );
  const dot = (color) => ({ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: color });

  return (
    <>
      <div className="st-tiles">
        <Tile Icon={Cpu} label="CPU" value={k.cpu == null ? "—" : `${fmt(k.cpu)} %`} sub="charge de la machine" />
        <Tile Icon={MemoryStick} label="Mémoire" value={k.mem == null ? "—" : `${fmt(k.mem)} %`} sub={`API : ${fmtBytes(k.rss)}`} />
        <Tile Icon={Clock} label="Réponse" value={k.p95 == null ? "—" : `${fmt(k.p95)} ms`} sub="95 % des requêtes sous ce temps" />
        <Tile Icon={Zap} label="Requêtes" value={fmt(k.requests)} sub="sur la période" />
        <Tile Icon={ServerCrash} label="Erreurs" value={fmt(k.errors)} sub={`${fmt(k.errors4)} refus (4xx)`} />
        <Tile Icon={Radio} label="Pic" value={fmt(k.peakOnline)} sub={`en ligne en même temps · API relancée il y a ${fmtDuration(k.uptime)}`} />
      </div>

      <div className="st-grid">
        <Card title="Processeur et mémoire" wide>
          <Legend
            items={[
              ["Processeur (machine)", C1],
              ["Mémoire (machine)", C2],
              ["Processeur (API)", C3],
            ]}
          />
          {chart(
            <LineChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              {x}
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit=" %" {...AXIS} />
              <Tooltip
                cursor={CURSOR}
                content={
                  <Tip
                    title={title}
                    rows={[
                      ["cpu", "Processeur", C1, (v) => `${fmt1(v)} %`],
                      ["mem", "Mémoire", C2, (v) => `${fmt1(v)} %`],
                      ["proc", "API", C3, (v) => `${fmt1(v)} %`],
                      ["rss", "Mémoire de l'API", null, fmtBytes],
                    ]}
                  />
                }
              />
              {[
                ["cpu", C1],
                ["mem", C2],
                ["proc", C3],
              ].map(([key, color]) => (
                <Line key={key} type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} activeDot={dot(color)} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>,
            240
          )}
        </Card>

        <Card title="Requêtes par minute">
          {chart(
            <AreaChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              {x}
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip cursor={CURSOR} content={<Tip title={title} rows={[["rpm", "Requêtes / min", C1, fmt1]]} />} />
              <Area type="monotone" dataKey="rpm" stroke={C1} strokeWidth={2} fill={C1} fillOpacity={0.1} activeDot={dot(C1)} isAnimationActive={false} />
            </AreaChart>
          )}
        </Card>

        <Card title="Temps de réponse">
          <Legend
            items={[
              ["Médian", C1],
              ["95 %", C2],
            ]}
          />
          {chart(
            <LineChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              {x}
              <YAxis unit=" ms" {...AXIS} />
              <Tooltip
                cursor={CURSOR}
                content={
                  <Tip
                    title={title}
                    rows={[
                      ["p50", "Médian", C1, (v) => `${fmt(v)} ms`],
                      ["p95", "95 %", C2, (v) => `${fmt(v)} ms`],
                      ["lag", "Retard boucle", null, (v) => `${fmt1(v)} ms`],
                    ]}
                  />
                }
              />
              <Line type="monotone" dataKey="p50" stroke={C1} strokeWidth={2} dot={false} activeDot={dot(C1)} connectNulls isAnimationActive={false} />
              <Line type="monotone" dataKey="p95" stroke={C2} strokeWidth={2} dot={false} activeDot={dot(C2)} connectNulls isAnimationActive={false} />
            </LineChart>,
            196
          )}
        </Card>

        <Card title="Joueurs sur le site">
          <Legend
            items={[
              ["Connectés", C1],
              ["Actifs sur 5 min", C2],
            ]}
          />
          {chart(
            <LineChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              {x}
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                cursor={CURSOR}
                content={
                  <Tip
                    title={title}
                    rows={[
                      ["online", "Connectés", C1],
                      ["users", "Actifs sur 5 min", C2],
                    ]}
                  />
                }
              />
              <Line type="stepAfter" dataKey="online" stroke={C1} strokeWidth={2} dot={false} activeDot={dot(C1)} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="users" stroke={C2} strokeWidth={2} dot={false} activeDot={dot(C2)} isAnimationActive={false} />
            </LineChart>,
            196
          )}
        </Card>

        <Card title="Erreurs serveur (5xx)" aside={fmt(k.errors)}>
          {chart(
            <BarChart data={pts} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} />
              {x}
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                cursor={BAR_CURSOR}
                content={
                  <Tip
                    title={title}
                    rows={[
                      ["err", "Erreurs 5xx", CRIT],
                      ["err4", "Refus 4xx", null],
                    ]}
                  />
                }
              />
              <Bar dataKey="err" fill={CRIT} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>,
            196
          )}
        </Card>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------
//  L'onglet
// ----------------------------------------------------------------------
export default function StatsPanel({ token }) {
  const [view, setView] = useState("site");
  const [days, setDays] = useState(30);
  const [hours, setHours] = useState(24);
  const [site, setSite] = useState(null);
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(
    (silent) => {
      if (!silent) setLoading(true);
      const req =
        view === "site"
          ? apiFetch(`/admin/stats?days=${days}`, { token }).then(setSite)
          : apiFetch(`/admin/stats/server?hours=${hours}`, { token }).then(setServer);
      req
        .then(() => setErr(null))
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    },
    [token, view, days, hours]
  );

  // Rafraîchi toute seule toutes les minutes tant que l'onglet est ouvert.
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 60000);
    return () => clearInterval(t);
  }, [load]);

  const data = view === "site" ? site : server;
  const fresh = view === "site" ? site?.days === days : server?.hours === hours;
  const ranges = view === "site" ? SITE_RANGES : SERVER_RANGES;
  const value = view === "site" ? days : hours;
  const setValue = view === "site" ? setDays : setHours;

  return (
    <div className="admin-stack st-panel">
      <div className="st-bar">
        <div className="st-seg">
          {[
            ["site", "Site"],
            ["server", "Serveur"],
          ].map(([key, name]) => (
            <button key={key} className={`clickable ${view === key ? "on" : ""}`} onClick={() => setView(key)}>
              {name}
            </button>
          ))}
        </div>
        <div className="st-seg">
          {ranges.map(([v, name]) => (
            <button key={v} className={`clickable ${value === v ? "on" : ""}`} onClick={() => setValue(v)}>
              {name}
            </button>
          ))}
        </div>
        <button className="st-refresh clickable" onClick={() => load()} disabled={loading} title="Rafraîchir">
          {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {err && <p className="psn-err">{err}</p>}

      {!data ? (
        <div className="st-card wide st-wait">
          <Loader2 size={18} className="spin" /> Calcul des statistiques…
        </div>
      ) : (
        <div className={`st-body ${loading && !fresh ? "is-loading" : ""}`}>
          {view === "site" ? <SiteView data={data} /> : <ServerView data={data} />}
        </div>
      )}
    </div>
  );
}
