import os from "node:os";
import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import mongoose from "mongoose";
import ServerSample from "../models/ServerSample.js";
import ActiveDay from "../models/ActiveDay.js";
import User from "../models/User.js";
import Activity from "../models/Activity.js";
import Message from "../models/Message.js";
import UserGame from "../models/UserGame.js";
import ServerLog from "../models/ServerLog.js";
import { onlineCount } from "./realtime.js";

// ======================================================================
//  Les statistiques du site et du serveur (onglet « Statistiques » admin)
// ======================================================================
// Deux choses sont relevées au fil de l'eau, parce qu'on ne peut pas les
// retrouver après coup :
//   • chaque requête API passe par `statsMiddleware` : on compte, on mesure,
//     et on note qui est venu aujourd'hui (une ligne ActiveDay par joueur et
//     par jour, écrite une seule fois) ;
//   • toutes les 5 minutes, un relevé ServerSample (CPU, mémoire, requêtes,
//     temps de réponse, erreurs, joueurs) — l'histoire que l'onglet Système,
//     qui ne montre qu'un instantané, n'a pas.
// Tout le reste (inscriptions, activité, messages…) se recalcule depuis la
// base à la demande.

export const TZ = "Europe/Paris";
const SAMPLE_MS = 5 * 60 * 1000;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayKey = (d = new Date()) => dayFmt.format(d);

// ----------------------------------------------------------------------
//  Le compteur, à chaque requête
// ----------------------------------------------------------------------
let win = { req: 0, err: 0, err4: 0, ms: [], users: new Set() };
// Qui a déjà sa ligne ActiveDay aujourd'hui (évite une écriture par requête).
let seenDay = dayKey();
let seenToday = new Set();

function markActive(userId) {
  const key = String(userId);
  win.users.add(key);
  const today = dayKey();
  if (today !== seenDay) {
    seenDay = today;
    seenToday = new Set();
  }
  if (seenToday.has(key)) return;
  seenToday.add(key);
  if (!mongoose.isValidObjectId(key)) return;
  ActiveDay.updateOne(
    { day: today, user: key },
    { $setOnInsert: { at: new Date() } },
    { upsert: true }
  ).catch(() => seenToday.delete(key));
}

export function statsMiddleware(req, res, next) {
  const path = req.originalUrl.split("?")[0];
  if (!path.startsWith("/api/")) return next();
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    // Un flux temps réel (SSE) « dure » des heures : il fausserait les temps.
    if (String(res.getHeader("content-type") || "").includes("text/event-stream")) return;
    win.req += 1;
    if (res.statusCode >= 500) win.err += 1;
    else if (res.statusCode >= 400) win.err4 += 1;
    if (win.ms.length < 20000) win.ms.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (req.userId) markActive(req.userId);
  });
  next();
}

// ----------------------------------------------------------------------
//  Le relevé, toutes les 5 minutes
// ----------------------------------------------------------------------
function readMemory() {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
    if (m) available = Number(m[1]) * 1024;
  } catch {
    /* pas de /proc (Windows, macOS) */
  }
  return { total, used: total - available };
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

let lastCpu = process.cpuUsage();
let lastAt = Date.now();
let loop = null;

async function takeSample() {
  const w = win;
  win = { req: 0, err: 0, err4: 0, ms: [], users: new Set() };
  const now = Date.now();
  const cpu = process.cpuUsage();
  const spent = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000; // ms
  const proc = (spent / Math.max(1, now - lastAt)) * 100;
  lastCpu = cpu;
  lastAt = now;
  const cores = os.cpus().length || 1;
  const load = os.loadavg()[0];
  const mem = readMemory();
  const ms = w.ms.sort((a, b) => a - b);
  const lag = loop ? loop.percentile(99) / 1e6 : null;
  loop?.reset();
  await ServerSample.create({
    at: new Date(now),
    // loadavg vaut 0 sous Windows : pas de charge plutôt qu'un faux 0 %.
    cpu: load > 0 ? round1(Math.min(100, (load / cores) * 100)) : null,
    proc: round1(proc),
    mem: round1((mem.used / mem.total) * 100),
    rss: process.memoryUsage().rss,
    lag: round1(lag),
    req: w.req,
    err: w.err,
    err4: w.err4,
    p50: round1(quantile(ms, 0.5)),
    p95: round1(quantile(ms, 0.95)),
    users: w.users.size,
    online: onlineCount(),
  });
}

export function startServerSampler() {
  try {
    loop = monitorEventLoopDelay({ resolution: 20 });
    loop.enable();
  } catch {
    loop = null;
  }
  const tick = () => takeSample().catch((e) => console.warn("[stats] relevé :", e.message));
  // Relevés calés sur les multiples de 5 minutes (00:05, 00:10…).
  const wait = SAMPLE_MS - (Date.now() % SAMPLE_MS);
  setTimeout(() => {
    tick();
    setInterval(tick, SAMPLE_MS).unref();
  }, wait).unref();
}

// ----------------------------------------------------------------------
//  Les lectures du panel
// ----------------------------------------------------------------------
// Les grandes familles d'activité (types de lib Activity → une étiquette).
const FAMILIES = [
  ["Bibliothèque", ["game_update"]],
  ["Listes", ["list_create", "list_items", "list_like"]],
  [
    "Commentaires",
    [
      "list_comment",
      "comment_reply",
      "comment_like",
      "review_comment",
      "review_comment_reply",
      "review_comment_like",
      "review_react",
      "gamemedia_comment",
      "gamemedia_comment_reply",
      "collection_comment",
      "collection_comment_reply",
      "collection_comment_like",
    ],
  ],
  ["Recos & suivis", ["recommendation", "recommendation_boost", "recommendation_comment", "follow"]],
  [
    "Arcade",
    [
      "blindtest",
      "pixel",
      "geo",
      "perroquet",
      "btversus",
      "pxversus",
      "pqversus",
      "impversus",
      "bombe",
      "geoversus",
      "quiz",
      "quizversus",
      "mot",
      "case_open",
      "collection_drop",
    ],
  ],
  ["Cartes", ["card_pack", "card_battle"]],
  ["Musique", ["playlist_listen"]],
];
const FAMILY_OF = new Map(FAMILIES.flatMap(([label, types]) => types.map((t) => [t, label])));

const byDay = (field) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: TZ } });

// Minuit à Paris d'un jour AAAA-MM-JJ (le serveur, lui, tourne en UTC).
function parisMidnight(day) {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const d = new Date(guess);
  const offset =
    new Date(d.toLocaleString("en-US", { timeZone: TZ })) - new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - offset);
}

// Les jours de la période, du plus ancien au plus récent (clés AAAA-MM-JJ).
function dayList(days) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(new Date(now - i * 86400000)));
  return [...new Set(out)];
}

async function countByDay(Model, field, since, match = {}) {
  const rows = await Model.aggregate([
    { $match: { ...match, [field]: { $gte: since } } },
    { $group: { _id: byDay(field), n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

// Les joueurs « venus » chaque jour : leur ligne ActiveDay, et — pour les
// jours d'avant ce relevé — tout ce qu'ils ont laissé comme trace (activité,
// messages, écritures du journal).
async function activeByDay(since) {
  const pairs = async (Model, field, who, match = {}) =>
    Model.aggregate([
      { $match: { ...match, [field]: { $gte: since }, [who]: { $ne: null } } },
      { $group: { _id: { d: byDay(field), u: `$${who}` } } },
    ]);
  const [a, b, c, d] = await Promise.all([
    ActiveDay.aggregate([{ $match: { at: { $gte: since } } }, { $group: { _id: { d: "$day", u: "$user" } } }]),
    pairs(Activity, "createdAt", "actor"),
    pairs(Message, "createdAt", "author"),
    pairs(ServerLog, "at", "actor", { kind: { $in: ["action", "auth", "presence", "message"] } }),
  ]);
  const map = new Map();
  for (const r of [...a, ...b, ...c, ...d]) {
    const set = map.get(r._id.d) || new Set();
    set.add(String(r._id.u));
    map.set(r._id.d, set);
  }
  return map;
}

export async function siteStats(daysRaw) {
  const days = [7, 30, 90, 365].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
  const list = dayList(days);
  const since = parisMidnight(list[0]);
  const prevSince = new Date(since.getTime() - days * 86400000);

  const [totalUsers, usersBefore, prevSignups, signups, acts, msgs, games, active, typeRows, heatRows, topRows, week, month] =
    await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $lt: since } }),
      User.countDocuments({ createdAt: { $gte: prevSince, $lt: since } }),
      countByDay(User, "createdAt", since),
      countByDay(Activity, "createdAt", since),
      countByDay(Message, "createdAt", since, { system: null }),
      countByDay(UserGame, "createdAt", since),
      activeByDay(since),
      Activity.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: "$type", n: { $sum: 1 } } }]),
      // Les pics : chaque action datée (activité, message, écriture du
      // journal) rangée par jour de la semaine et heure, à Paris.
      Promise.all(
        [
          [Activity, "createdAt", {}],
          [Message, "createdAt", { system: null }],
          [ServerLog, "at", { kind: { $in: ["action", "auth"] } }],
        ].map(([M, f, m]) =>
          M.aggregate([
            { $match: { ...m, [f]: { $gte: since } } },
            {
              $group: {
                _id: { w: { $isoDayOfWeek: { date: `$${f}`, timezone: TZ } }, h: { $hour: { date: `$${f}`, timezone: TZ } } },
                n: { $sum: 1 },
              },
            },
          ])
        )
      ),
      Activity.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$actor", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 8 },
      ]),
      activeSince(7),
      activeSince(30),
    ]);

  let cum = usersBefore;
  const series = list.map((d) => {
    const s = signups.get(d) || 0;
    cum += s;
    return {
      day: d,
      signups: s,
      users: cum,
      active: active.get(d)?.size || 0,
      activity: acts.get(d) || 0,
      messages: msgs.get(d) || 0,
      games: games.get(d) || 0,
    };
  });

  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of heatRows.flat()) heat[r._id.w - 1][r._id.h] += r.n;

  const fam = new Map();
  for (const r of typeRows) {
    const label = FAMILY_OF.get(r._id) || "Autre";
    fam.set(label, (fam.get(label) || 0) + r.n);
  }

  const topUsers = await User.find({ _id: { $in: topRows.map((r) => r._id) } }, "username avatar").lean();
  const known = new Map(topUsers.map((u) => [String(u._id), u]));

  const newUsers = series.reduce((n, r) => n + r.signups, 0);
  return {
    days,
    generatedAt: new Date().toISOString(),
    kpi: {
      users: totalUsers,
      newUsers,
      prevNewUsers: prevSignups,
      today: series.at(-1)?.active || 0,
      week,
      month,
      online: onlineCount(),
      activity: series.reduce((n, r) => n + r.activity, 0),
      messages: series.reduce((n, r) => n + r.messages, 0),
      games: series.reduce((n, r) => n + r.games, 0),
    },
    series,
    heat,
    families: [...fam.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    top: topRows
      .map((r) => ({ id: String(r._id), n: r.n, username: known.get(String(r._id))?.username || null, avatar: known.get(String(r._id))?.avatar || null }))
      .filter((r) => r.username),
  };
}

// Joueurs distincts venus sur les N derniers jours (mêmes traces que par jour).
async function activeSince(n) {
  const map = await activeByDay(new Date(Date.now() - n * 86400000));
  const all = new Set();
  for (const s of map.values()) for (const u of s) all.add(u);
  return all.size;
}

// Les courbes du serveur : les relevés de la période, regroupés en ~200 points
// au plus (moyennes ; les compteurs sont ramenés « par minute »).
export async function serverStats(hoursRaw) {
  const hours = [6, 24, 168, 720].includes(Number(hoursRaw)) ? Number(hoursRaw) : 24;
  const since = new Date(Date.now() - hours * 3600000);
  const rows = await ServerSample.find({ at: { $gte: since } }).sort({ at: 1 }).lean();
  const bucketMs = Math.max(SAMPLE_MS, Math.ceil((hours * 3600000) / 200 / SAMPLE_MS) * SAMPLE_MS);
  const groups = new Map();
  for (const r of rows) {
    const k = Math.floor(r.at.getTime() / bucketMs) * bucketMs;
    const g = groups.get(k) || [];
    g.push(r);
    groups.set(k, g);
  }
  const avg = (g, f) => {
    const v = g.map((r) => r[f]).filter((x) => x != null);
    return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const max = (g, f) => {
    const v = g.map((r) => r[f]).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };
  const points = [...groups.entries()].map(([k, g]) => ({
    t: k,
    cpu: avg(g, "cpu"),
    proc: avg(g, "proc"),
    mem: avg(g, "mem"),
    rss: avg(g, "rss"),
    lag: avg(g, "lag"),
    rpm: round1(g.reduce((n, r) => n + r.req, 0) / ((g.length * SAMPLE_MS) / 60000)),
    err: g.reduce((n, r) => n + r.err, 0),
    err4: g.reduce((n, r) => n + r.err4, 0),
    p50: avg(g, "p50"),
    p95: max(g, "p95"),
    users: max(g, "users"),
    online: max(g, "online"),
  }));
  const sum = (f) => rows.reduce((n, r) => n + (r[f] || 0), 0);
  const last = rows.at(-1) || null;
  const p95s = rows.map((r) => r.p95).filter((x) => x != null).sort((a, b) => a - b);
  return {
    hours,
    bucketMin: bucketMs / 60000,
    first: rows[0]?.at || null,
    samples: rows.length,
    points,
    kpi: {
      cpu: last?.cpu ?? null,
      mem: last?.mem ?? null,
      rss: last?.rss ?? null,
      online: onlineCount(),
      requests: sum("req"),
      errors: sum("err"),
      errors4: sum("err4"),
      p95: quantile(p95s, 0.5),
      peakOnline: rows.reduce((m, r) => Math.max(m, r.online || 0), 0),
      uptime: process.uptime(),
    },
  };
}
