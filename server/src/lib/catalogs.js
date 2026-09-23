// ======================================================================
//  Les catalogues d'abonnement : Xbox Game Pass et GeForce NOW
// ======================================================================
//
// Deux sources publiques, sans clé :
//   - Game Pass : les listes du catalogue (catalog.gamepass.com/sigls) — tous
//     les jeux PC, console, les ajouts récents, les départs, les arrivées —,
//     puis leurs titres et visuels au Microsoft Store (displaycatalog) ;
//   - GeForce NOW : la liste publique des jeux jouables en streaming, avec le
//     lien Steam de chacun quand il y en a un.
//
// On en prend une photo deux fois par jour (cf. startCatalogSync) et on la
// range dans CatalogEntry — ce qui donne, en plus du catalogue du moment, les
// dates d'arrivée et de départ que les services ne publient pas.
//
// Chaque jeu est rattaché à sa fiche IGDB : par identifiant quand IGDB le
// connaît (appid Steam, id Microsoft Store), sinon par titre exact. Un titre
// approchant NE SUFFIT PAS : dire qu'un jeu est dans le Game Pass alors que
// c'est son homonyme serait pire que ne rien dire.

import CatalogEntry from "../models/CatalogEntry.js";
import { igdbQuery } from "./igdb.js";
import { simplifyName } from "./psn.js";

const UA = "MyPlayLog/1.0 (+https://myplaylog.cc)";
const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
const HOUR = 60 * 60 * 1000;
const SYNC_INTERVAL = 12 * HOUR;
const FIRST_RUN_DELAY = 60 * 1000;
// Un jeu non rattaché est retenté une fois par semaine : IGDB s'enrichit.
const REMATCH_AFTER = 7 * 24 * HOUR;

const GP_LISTS = {
  pc: "fdd9e2a7-0fee-49f6-ad69-4354098401ff",
  console: "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e",
  popular: "a884932a-f02b-40c8-a903-a008c23b1df1",
  recent: "f13cf6b4-57e6-4459-89df-6aec18cf0538",
  coming: "095bda36-f5cd-43f2-9ee1-0a72f371fb96",
  leaving: "393f05bf-e596-4ef6-9487-6d4fa0eab987",
  ea: "b8900d09-a491-44cc-916e-32b5acae621b",
};
// Les listes ORDONNÉES : leur ordre est une information (le plus populaire
// d'abord, le dernier arrivé d'abord).
const RANKED = ["popular", "recent"];
const GFN_URL =
  "https://static.nvidiagrid.net/supported-public-game-list/locales/gfnpc-en-US.json";

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

const chunked = (list, n) =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// ----------------------------------------------------------------------
//  Titres
// ----------------------------------------------------------------------
// Le Microsoft Store habille ses titres : « Standard Edition », « (PC) »,
// « for Windows 10 ». IGDB, lui, nomme le jeu. On retire l'habillage avant de
// comparer.
export function cleanTitle(title) {
  return String(title || "")
    .replace(/[™®©℠]/g, "")
    .replace(/\((pc|windows|game preview|xbox series x\|s|xbox one)\)/gi, "")
    .replace(/\s[-–—]\s*(pc|windows( 10)?( edition)?|xbox series x\|s|xbox one)\s*$/i, "")
    .replace(/\bfor windows( 10)?\b/gi, "")
    // « VALORANT PC », « Overwatch PC », « … - Cross-Gen Bundle ».
    .replace(/\s[-–—]\s*(cross-gen bundle|cross-gen edition|bundle)\s*$/i, "")
    .replace(/\s+pc\s*$/i, "")
    .replace(
      /\b(standard|deluxe|ultimate|gold|premium|complete|definitive|enhanced|game of the year|goty)\s+edition\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-–—:]\s*$/, "")
    .trim();
}

export const catalogKey = (title) => simplifyName(cleanTitle(title));

// ----------------------------------------------------------------------
//  Rattachement à IGDB
// ----------------------------------------------------------------------
async function igdbGames(ids) {
  const out = new Map();
  for (const chunk of chunked([...new Set(ids)], 400)) {
    const rows = await igdbQuery(
      "games",
      `fields name,cover.image_id,total_rating_count,hypes; where id = (${chunk.join(",")}); limit 500;`
    ).catch(() => []);
    for (const g of rows) out.set(g.id, g);
  }
  return out;
}

// uid externe (Steam, Microsoft) → id IGDB.
async function idsByExternal(sources, uids) {
  const out = new Map();
  for (const chunk of chunked([...new Set(uids)], 200)) {
    const list = chunk
      .flatMap((u) => [String(u), String(u).toLowerCase()])
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((u) => `"${u.replace(/["\\]/g, "")}"`)
      .join(",");
    const rows = await igdbQuery(
      "external_games",
      `fields game,uid; where external_game_source = (${sources.join(",")}) & uid = (${list}); limit 500;`
    ).catch(() => []);
    for (const r of rows) {
      const k = String(r.uid || "").toUpperCase();
      if (r.game && k && !out.has(k)) out.set(k, r.game);
    }
  }
  return out;
}

// Titre exact → id IGDB. Deux jeux du même nom : le plus connu gagne.
async function idsByName(titles) {
  const out = new Map();
  for (const chunk of chunked([...new Set(titles.filter(Boolean))], 150)) {
    const list = chunk.map((n) => `"${n.replace(/["\\]/g, "")}"`).join(",");
    const rows = await igdbQuery(
      "games",
      `fields name,total_rating_count; where name = (${list}); limit 500;`
    ).catch(() => []);
    for (const r of rows) {
      const k = simplifyName(r.name);
      const prev = out.get(k);
      if (!prev || (r.total_rating_count || 0) > prev.pop) {
        out.set(k, { id: r.id, pop: r.total_rating_count || 0 });
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.id]));
}

async function matchPending(service) {
  const now = Date.now();
  const pending = await CatalogEntry.find({
    service,
    gameId: null,
    leftAt: null,
    $or: [{ matchedAt: null }, { matchedAt: { $lt: new Date(now - REMATCH_AFTER) } }],
  })
    .select("key title steamAppId")
    .lean();
  if (!pending.length) return 0;

  const found = new Map(); // key → gameId
  if (service === "gamepass") {
    const byMs = await idsByExternal([11, 31, 54], pending.map((p) => p.key));
    for (const p of pending) {
      const id = byMs.get(String(p.key).toUpperCase());
      if (id) found.set(p.key, id);
    }
  } else {
    const withApp = pending.filter((p) => p.steamAppId);
    const bySteam = await idsByExternal([1], withApp.map((p) => p.steamAppId));
    for (const p of withApp) {
      const id = bySteam.get(String(p.steamAppId));
      if (id) found.set(p.key, id);
    }
  }
  const rest = pending.filter((p) => !found.has(p.key));
  const byName = await idsByName(rest.map((p) => cleanTitle(p.title)));
  for (const p of rest) {
    const id = byName.get(simplifyName(cleanTitle(p.title)));
    if (id) found.set(p.key, id);
  }

  const games = await igdbGames([...found.values()]);
  const at = new Date();
  const ops = pending.map((p) => {
    const g = games.get(found.get(p.key));
    return {
      updateOne: {
        filter: { service, key: p.key },
        update: {
          $set: g
            ? {
                gameId: g.id,
                name: g.name,
                cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
                popularity: (g.total_rating_count || 0) + (g.hypes || 0),
                matchedAt: at,
              }
            : { matchedAt: at },
        },
      },
    };
  });
  if (ops.length) await CatalogEntry.bulkWrite(ops, { ordered: false });
  return found.size;
}

// ----------------------------------------------------------------------
//  La photo du catalogue
// ----------------------------------------------------------------------
async function saveSnapshot(service, items) {
  const now = new Date();
  const active = await CatalogEntry.countDocuments({ service, leftAt: null });
  // Premier relevé de ce service : ce qui est là y était « déjà », sans date.
  const baseline = active === 0;
  const ops = items.map((it) => ({
    updateOne: {
      filter: { service, key: it.key },
      update: {
        $set: { ...it, lastSeen: now, leftAt: null },
        $setOnInsert: { firstSeen: now, baseline },
      },
      upsert: true,
    },
  }));
  for (const chunk of chunked(ops, 500)) await CatalogEntry.bulkWrite(chunk, { ordered: false });

  // ⚠️ UNE LISTE TRONQUÉE NE VIDE PAS LE CATALOGUE. Si le service a répondu
  // à moitié, marquer le reste « parti » ferait croire à un exode.
  if (items.length >= active * 0.7) {
    await CatalogEntry.updateMany(
      { service, leftAt: null, lastSeen: { $lt: now } },
      { $set: { leftAt: now } }
    );
  }
}

async function refreshGamePass() {
  const lists = {};
  for (const [name, id] of Object.entries(GP_LISTS)) {
    try {
      const j = await getJson(
        `https://catalog.gamepass.com/sigls/v2?id=${id}&language=en-us&market=FR`
      );
      lists[name] = j.filter((x) => x.id).map((x) => x.id);
    } catch (err) {
      console.error(`gamepass list ${name}:`, err.message);
      lists[name] = null;
    }
  }
  // Sans les deux catalogues complets, on ne sait pas ce qui est parti.
  if (!lists.pc || !lists.console) return;

  const byKey = new Map();
  for (const [name, ids] of Object.entries(lists)) {
    for (const [i, key] of (ids || []).entries()) {
      if (!byKey.has(key)) byKey.set(key, { key, lists: [], rank: null });
      const it = byKey.get(key);
      it.lists.push(name);
      if (RANKED.includes(name) && (it.rank == null || i < it.rank)) it.rank = i;
    }
  }

  // Titres et visuels : seulement pour les jeux qu'on ne connaît pas encore.
  const known = new Map(
    (await CatalogEntry.find({ service: "gamepass" }).select("key title image").lean()).map(
      (e) => [e.key, e]
    )
  );
  const unknown = [...byKey.keys()].filter((k) => !known.get(k)?.title);
  for (const chunk of chunked(unknown, 50)) {
    try {
      const j = await getJson(
        `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${chunk.join(",")}&market=FR&languages=en-us`
      );
      for (const p of j.Products || []) {
        const l = p.LocalizedProperties?.[0];
        const img = (l?.Images || []).find((i) => i.ImagePurpose === "Poster") ||
          (l?.Images || []).find((i) => i.ImagePurpose === "BoxArt");
        const it = byKey.get(p.ProductId);
        if (!it) continue;
        it.title = l?.ProductTitle || "";
        it.image = img?.Uri ? `https:${img.Uri}?w=300` : null;
      }
    } catch (err) {
      console.error("gamepass details:", err.message);
    }
  }

  const items = [...byKey.values()].map((it) => {
    const prev = known.get(it.key);
    const title = it.title ?? prev?.title ?? "";
    return {
      key: it.key,
      lists: it.lists,
      rank: it.rank,
      title,
      simple: catalogKey(title),
      image: it.image ?? prev?.image ?? null,
    };
  });
  await saveSnapshot("gamepass", items);
  await matchPending("gamepass");
}

async function refreshGeforceNow() {
  const raw = await getJson(GFN_URL);
  const items = (Array.isArray(raw) ? raw : [])
    .filter((g) => g && g.id && g.title && g.status === "AVAILABLE")
    .map((g) => ({
      key: String(g.id),
      title: g.title,
      simple: catalogKey(g.title),
      steamAppId: Number(String(g.steamUrl || "").match(/app\/(\d+)/)?.[1]) || null,
      store: g.store || null,
    }));
  if (!items.length) return;
  await saveSnapshot("geforcenow", items);
  await matchPending("geforcenow");
}

let running = null;
let lastRun = 0;

export function refreshCatalogs() {
  if (running) return running;
  running = (async () => {
    for (const [name, fn] of [
      ["gamepass", refreshGamePass],
      ["geforcenow", refreshGeforceNow],
    ]) {
      try {
        await fn();
      } catch (err) {
        console.error(`catalog ${name} refresh:`, err.message);
      }
    }
    lastRun = Date.now();
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startCatalogSync() {
  setTimeout(() => refreshCatalogs(), FIRST_RUN_DELAY);
  setInterval(() => refreshCatalogs(), SYNC_INTERVAL);
  console.log("🎮 Relevé des catalogues Game Pass / GeForce NOW activé");
}

// ----------------------------------------------------------------------
//  Lectures
// ----------------------------------------------------------------------
const card = (e, extra = {}) => ({
  id: e.gameId,
  name: e.name || e.title,
  cover: e.cover || e.image,
  ...extra,
});

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((e) => {
    if (!e.gameId || seen.has(e.gameId)) return false;
    seen.add(e.gameId);
    return true;
  });
}

/** Les rails de l'accueil. Vide tant que le premier relevé n'a pas eu lieu. */
export async function catalogHome() {
  // Serveur tout juste lancé et base vide : on lance le relevé sans l'attendre.
  if (!lastRun && !running) refreshCatalogs();

  const [gp, gfnRecent, gfnPopular, counts] = await Promise.all([
    CatalogEntry.find({
      service: "gamepass",
      leftAt: null,
      gameId: { $ne: null },
      lists: { $in: ["popular", "recent", "coming", "leaving"] },
    })
      .select("gameId name title cover image lists rank firstSeen")
      .lean(),
    CatalogEntry.find({
      service: "geforcenow",
      leftAt: null,
      baseline: false,
      gameId: { $ne: null },
      firstSeen: { $gte: new Date(Date.now() - 45 * 24 * HOUR) },
    })
      .sort({ firstSeen: -1 })
      .limit(60)
      .select("gameId name title cover image firstSeen store")
      .lean(),
    CatalogEntry.find({ service: "geforcenow", leftAt: null, gameId: { $ne: null } })
      .sort({ popularity: -1 })
      .limit(80)
      .select("gameId name title cover image store")
      .lean(),
    Promise.all([
      CatalogEntry.countDocuments({
        service: "gamepass",
        leftAt: null,
        lists: { $in: ["pc", "console"] },
      }),
      // Un même jeu figure une fois par boutique (Steam, Epic…) : on compte
      // les titres.
      CatalogEntry.distinct("simple", { service: "geforcenow", leftAt: null }),
    ]),
  ]);

  const inList = (name) =>
    dedupe(
      gp
        .filter((e) => e.lists.includes(name))
        .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    );

  return {
    gamepass: {
      total: counts[0],
      popular: inList("popular").slice(0, 20).map((e) => card(e)),
      recent: inList("recent").slice(0, 20).map((e) => card(e)),
      coming: inList("coming").slice(0, 20).map((e) => card(e)),
      leaving: inList("leaving").slice(0, 20).map((e) => card(e)),
    },
    geforcenow: {
      total: counts[1].filter(Boolean).length,
      recent: dedupe(gfnRecent)
        .slice(0, 20)
        .map((e) => card(e, { since: e.firstSeen })),
      popular: dedupe(gfnPopular).slice(0, 20).map((e) => card(e)),
    },
  };
}

/**
 * Où en est un jeu dans les deux catalogues.
 *
 * Par identifiant IGDB d'abord. Le titre ne sert de repli que pour les jeux du
 * catalogue qu'on n'a PAS su rattacher : un jeu rattaché à une AUTRE fiche du
 * même nom (un remake, un homonyme) ne doit pas déteindre sur celle-ci.
 */
export async function availabilityOf(gameId, name) {
  const simple = catalogKey(name);
  const rows = await CatalogEntry.find({
    $or: [{ gameId }, ...(simple ? [{ simple, gameId: null }] : [])],
  })
    .select("service gameId lists store firstSeen leftAt baseline")
    .lean();

  const pick = (service) => {
    const all = rows.filter((r) => r.service === service);
    const exact = all.filter((r) => r.gameId === gameId);
    return exact.length ? exact : all;
  };
  const since = (list) => {
    const dated = list.filter((r) => !r.baseline).map((r) => r.firstSeen);
    return dated.length ? new Date(Math.min(...dated.map(Number))) : null;
  };
  const leftAt = (list) => new Date(Math.max(...list.map((r) => Number(r.leftAt))));

  let gamepass = null;
  const gp = pick("gamepass");
  const gpOn = gp.filter((r) => !r.leftAt);
  if (gpOn.length) {
    const lists = new Set(gpOn.flatMap((r) => r.lists));
    const inCatalog = lists.has("pc") || lists.has("console") || lists.has("ea");
    gamepass = {
      status: lists.has("leaving") ? "leaving" : inCatalog ? "in" : lists.has("coming") ? "coming" : "in",
      pc: lists.has("pc"),
      console: lists.has("console"),
      ea: lists.has("ea") && !lists.has("pc") && !lists.has("console"),
      since: since(gpOn),
    };
  } else if (gp.length) {
    gamepass = { status: "left", leftAt: leftAt(gp) };
  }

  let geforcenow = null;
  const gfn = pick("geforcenow");
  const gfnOn = gfn.filter((r) => !r.leftAt);
  if (gfnOn.length) {
    geforcenow = {
      status: "in",
      stores: [...new Set(gfnOn.map((r) => r.store).filter(Boolean))],
      since: since(gfnOn),
    };
  } else if (gfn.length) {
    geforcenow = { status: "left", leftAt: leftAt(gfn) };
  }

  return { gamepass, geforcenow };
}
