// ======================================================================
//  Les prix : où acheter un jeu, combien, et combien il a déjà coûté
// ======================================================================
//
// Deux étages :
//   - STEAM, sans clé : le prix en euros (store.steampowered.com, cc=fr), les
//     joueurs connectés en ce moment et la note des avis. Toujours là pour un
//     jeu vendu sur Steam.
//   - ISTHEREANYDEAL, avec une clé (ITAD_API_KEY dans server/.env) : le prix
//     chez chaque boutique suivie (Steam, GOG, Epic, Humble, Fanatical…), le
//     plus bas jamais vu, et l'historique qui trace la courbe. Sans clé, cet
//     étage se tait et la fiche garde le premier.
//
// Et, pour l'accueil, les promos du moment : les meilleures ventes Steam
// actuellement en réduction.

import { createTtlCache } from "./ttlCache.js";
import { matchAppsToIgdb } from "./steam.js";
import { simplifyName } from "./psn.js";

const UA = "MyPlayLog/1.0 (+https://myplaylog.cc)";
const ITAD = "https://api.isthereanydeal.com";
const COUNTRY = "FR";
const STEAM_SHOP = 61; // l'id de Steam chez IsThereAnyDeal
const HOUR = 60 * 60 * 1000;

const cache = createTtlCache({ name: "prices", max: 3000, ttl: HOUR });

// ⚠️ UNE PANNE NE SE MET PAS EN CACHE. Seule une vraie réponse (même « rien
// trouvé ») est gardée : une erreur réseau remonte à l'appelant, et la
// prochaine visite redemande.
async function cached(key, ttl, run) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await run();
  cache.set(key, value, ttl);
  return value;
}

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

const cents = (n) => (n == null ? null : Math.round(Number(n)) / 100);

// ----------------------------------------------------------------------
//  Steam
// ----------------------------------------------------------------------
export function steamOffer(appid) {
  return cached(`steam:${appid}`, HOUR, async () => {
    const j = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=fr&l=french&filters=basic,price_overview,release_date`
    );
    const d = j?.[appid]?.success ? j[appid].data : null;
    if (!d) return null;
    const p = d.price_overview;
    return {
      appid: Number(appid),
      url: `https://store.steampowered.com/app/${appid}`,
      free: !!d.is_free,
      comingSoon: !!d.release_date?.coming_soon,
      price: p ? cents(p.final) : d.is_free ? 0 : null,
      regular: p ? cents(p.initial) : null,
      cut: p?.discount_percent || 0,
      currency: p?.currency || "EUR",
    };
  });
}

export function steamPlayers(appid) {
  return cached(`players:${appid}`, 10 * 60 * 1000, async () => {
    const j = await getJson(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`
    );
    return j?.response?.result === 1 ? j.response.player_count ?? null : null;
  });
}

export function steamReviews(appid) {
  return cached(`reviews:${appid}`, 12 * HOUR, async () => {
    const j = await getJson(
      `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`
    );
    const s = j?.query_summary;
    if (!s?.total_reviews) return null;
    return {
      total: s.total_reviews,
      pct: Math.round((s.total_positive / s.total_reviews) * 100),
      desc: s.review_score_desc || null,
    };
  });
}

// ----------------------------------------------------------------------
//  IsThereAnyDeal
// ----------------------------------------------------------------------
export const itadEnabled = () => !!process.env.ITAD_API_KEY;

function itad(path, body) {
  return getJson(`${ITAD}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "ITAD-API-Key": process.env.ITAD_API_KEY,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const money = (m) => (m && m.amount != null ? m.amount : null);

/**
 * L'identifiant IsThereAnyDeal d'un jeu : par son appid Steam, sinon par son
 * titre — mais seulement si le titre trouvé est EXACTEMENT le nôtre (une
 * recherche approchante renverrait volontiers le prix d'un autre jeu).
 */
export function itadIdOf({ appid, title }) {
  if (!itadEnabled()) return Promise.resolve(null);
  const key = appid ? `itad:app:${appid}` : `itad:title:${simplifyName(title)}`;
  return cached(key, 7 * 24 * HOUR, async () => {
    const q = appid ? `appid=${appid}` : `title=${encodeURIComponent(title || "")}`;
    const j = await itad(`/games/lookup/v1?${q}`);
    const g = j?.found ? j.game : null;
    if (!g) return null;
    if (!appid && simplifyName(g.title) !== simplifyName(title)) return null;
    return g.id;
  });
}

/** Le prix chez chaque boutique, et les plus bas historiques. */
export function itadPrices(id) {
  return cached(`itad:prices:${id}`, HOUR, async () => {
    const j = await itad(`/games/prices/v3?country=${COUNTRY}`, [id]);
    const row = Array.isArray(j) ? j[0] : null;
    if (!row) return null;
    const shops = (row.deals || [])
      .map((d) => ({
        shop: d.shop?.name || "",
        shopId: d.shop?.id ?? null,
        price: money(d.price),
        regular: money(d.regular),
        cut: d.cut || 0,
        url: d.url || null,
        storeLow: money(d.storeLow),
        voucher: d.voucher || null,
      }))
      .filter((d) => d.price != null && d.url)
      .sort((a, b) => a.price - b.price);
    return {
      shops,
      lows: {
        all: money(row.historyLow?.all),
        y1: money(row.historyLow?.y1),
        m3: money(row.historyLow?.m3),
      },
    };
  });
}

/**
 * L'historique des prix, boutique par boutique : une ligne par CHANGEMENT de
 * prix (IsThereAnyDeal ne note que les variations). Rendu du plus ancien au
 * plus récent, en millisecondes.
 */
export function itadHistory(id, shops = [STEAM_SHOP]) {
  return cached(`itad:history:${id}:${shops.join(",")}`, 12 * HOUR, async () => {
    const q = shops.length ? `&shops=${shops.join(",")}` : "";
    const j = await itad(`/games/history/v2?id=${id}&country=${COUNTRY}${q}`);
    if (!Array.isArray(j)) return null;
    return j
      .filter((h) => h.deal && h.timestamp)
      .map((h) => ({
        t: Date.parse(h.timestamp),
        price: money(h.deal.price),
        regular: money(h.deal.regular),
        cut: h.deal.cut || 0,
        shop: h.shop?.name || "",
      }))
      .filter((h) => Number.isFinite(h.t) && h.price != null)
      .sort((a, b) => a.t - b.t);
  });
}

// ----------------------------------------------------------------------
//  Les promos du moment (accueil)
// ----------------------------------------------------------------------
// Les meilleures ventes Steam actuellement en réduction : ce qui est à la fois
// soldé ET joué — un -90 % sur un jeu que personne ne connaît n'intéresse
// personne. Rattachées à IGDB pour ouvrir la fiche dans l'app.
export function steamDeals() {
  return cached("steam:deals", HOUR, async () => {
    const j = await getJson(
      "https://store.steampowered.com/search/results/?specials=1&json=1&cc=fr&l=french&count=60&filter=topsellers&category1=998"
    );
    const appids = [
      ...new Set(
        (j?.items || [])
          .map((it) => Number(String(it.logo || "").match(/\/apps\/(\d+)\//)?.[1]))
          .filter(Boolean)
      ),
    ];
    if (!appids.length) return [];

    const [prices, igdb] = await Promise.all([
      getJson(
        `https://store.steampowered.com/api/appdetails?appids=${appids.join(",")}&cc=fr&filters=price_overview`
      ).catch(() => ({})),
      matchAppsToIgdb(appids).catch(() => new Map()),
    ]);

    const seen = new Set();
    const out = [];
    for (const appid of appids) {
      const p = prices?.[appid]?.data?.price_overview;
      const g = igdb.get(appid);
      if (!p || !p.discount_percent || !g || seen.has(g.gameId)) continue;
      seen.add(g.gameId);
      out.push({
        id: g.gameId,
        name: g.name,
        cover: g.cover,
        appid,
        price: cents(p.final),
        regular: cents(p.initial),
        cut: p.discount_percent,
        url: `https://store.steampowered.com/app/${appid}`,
      });
      if (out.length >= 24) break;
    }
    return out;
  });
}
