// Feed communautaire d'un jeu, agrégé côté serveur (cache mémoire 30 min) :
//  - Twitch  : streams FR en direct        (réutilise l'OAuth d'IGDB)
//  - Fan arts: DeviantArt + Danbooru + Tumblr
//  - Réactions: Bluesky + Mastodon (posts des gens)
//  - Clips   : YouTube (shorts / moments drôles, scraping public)
//  - Avis    : reviews joueurs Steam (officiel, sans clé)
//
// Chaque source échoue silencieusement en [] / null : si une clé manque ou
// qu'un service est indispo, le reste du feed s'affiche quand même.

import { getTwitchToken, igdbQuery } from "./igdb.js";

const YT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Slug tag pour DeviantArt/Mastodon (un seul token, sans espace ni ponctuation)
function tagSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Twitch — streams FR en direct sur le jeu
// ---------------------------------------------------------------------------
async function helix(path, token) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`Twitch Helix ${res.status}`);
  return res.json();
}

async function fetchTwitchStreams(name) {
  try {
    if (!process.env.TWITCH_CLIENT_ID) return [];
    const token = await getTwitchToken();
    let cat = await helix(`games?name=${encodeURIComponent(name)}`, token);
    let game = cat?.data?.[0];
    if (!game) {
      const loose = name.replace(/[^\w\s]/g, "").trim();
      if (loose && loose !== name) {
        cat = await helix(`games?name=${encodeURIComponent(loose)}`, token);
        game = cat?.data?.[0];
      }
    }
    if (!game) return [];
    // language=fr : uniquement les streams francophones.
    const streams = await helix(
      `streams?game_id=${game.id}&language=fr&first=12`,
      token
    );
    return (streams?.data || []).map((s) => ({
      id: s.id,
      title: s.title,
      user: s.user_name,
      login: s.user_login,
      viewers: s.viewer_count,
      url: `https://www.twitch.tv/${s.user_login}`,
      thumbnail: s.thumbnail_url.replace("{width}", "440").replace("{height}", "248"),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fan arts — DeviantArt + Danbooru + Tumblr
// ---------------------------------------------------------------------------
let daToken = null;
let daExpiry = 0;
async function getDeviantToken() {
  if (!process.env.DEVIANTART_CLIENT_ID || !process.env.DEVIANTART_CLIENT_SECRET)
    return null;
  if (daToken && Date.now() < daExpiry - 60_000) return daToken;
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.DEVIANTART_CLIENT_ID,
      client_secret: process.env.DEVIANTART_CLIENT_SECRET,
    });
    const r = await fetch("https://www.deviantart.com/oauth2/token", {
      method: "POST",
      body,
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.access_token) return null;
    daToken = j.access_token;
    daExpiry = Date.now() + (j.expires_in || 3600) * 1000;
    return daToken;
  } catch {
    return null;
  }
}

async function fetchDeviantArt(name) {
  const token = await getDeviantToken();
  if (!token) return [];
  const tag = tagSlug(name);
  if (!tag) return [];
  try {
    const r = await fetch(
      `https://www.deviantart.com/api/v1/oauth2/browse/tags?tag=${encodeURIComponent(tag)}` +
        `&limit=24&mature_content=false&access_token=${token}`
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || [])
      .filter((d) => !d.is_mature && d.content?.src)
      .map((d) => ({
        id: `da-${d.deviationid}`,
        source: "DeviantArt",
        image: d.content.src,
        w: d.content.width || null,
        h: d.content.height || null,
        author: d.author?.username || "",
        url: d.url,
      }));
  } catch {
    return [];
  }
}

// Safebooru.org : booru 100 % SFW (le grand frère Danbooru est passé derrière
// Cloudflare et bloque les requêtes serveur). Contenu fan art style anime/manga.
async function fetchSafebooru(name) {
  const tag = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!tag) return [];
  try {
    const r = await fetch(
      `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=24` +
        `&tags=${encodeURIComponent(tag)}`,
      { headers: { "User-Agent": YT_UA } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (Array.isArray(j) ? j : [])
      .filter((p) => p.image && p.directory != null)
      .filter((p) => /\.(jpe?g|png|webp)$/i.test(p.image))
      .map((p) => ({
        id: `sb-${p.id}`,
        source: "Safebooru",
        image: `https://safebooru.org/images/${p.directory}/${p.image}`,
        w: Number(p.width) || null,
        h: Number(p.height) || null,
        author: "",
        url: `https://safebooru.org/index.php?page=post&s=view&id=${p.id}`,
      }));
  } catch {
    return [];
  }
}

// Un post Tumblr parle-t-il bien du JEU ? Le tag seul est ambigu (« sleeping
// dogs » → photos de chiens) : on exige un signal gaming dans les tags ou le
// résumé (fanart, gaming, le nom du jeu collé, screenshot…).
const GAMING_SIGNAL =
  /fan ?arts?|game|gaming|jeu ?vid|videojuego|screenshot|playthrough|ps[2-5]|xbox|nintendo|steam/i;
function tumblrLooksGaming(p, name) {
  const tags = (p.tags || []).join(" ");
  const hay = `${tags} ${p.summary || ""}`.toLowerCase();
  const slug = tagSlug(name);
  if (slug && hay.replace(/[^a-z0-9]/g, "").includes(slug)) {
    // Le nom complet du jeu apparaît : on demande AUSSI un signal gaming pour
    // écarter les homonymes littéraux (« sleeping dogs » : les vrais chiens
    // sont taggés pareil). Un seul mot-clé suffit.
    return GAMING_SIGNAL.test(hay);
  }
  return GAMING_SIGNAL.test(hay);
}

async function fetchTumblr(name) {
  const key = process.env.TUMBLR_API_KEY;
  if (!key) return [];
  try {
    // npf=true : Tumblr renvoie les posts au format NPF (blocs `content`), sinon
    // les posts récents arrivent en legacy `type:"text"` sans `photos[]` et on
    // ne récupère plus aucune image.
    const r = await fetch(
      `https://api.tumblr.com/v2/tagged?tag=${encodeURIComponent(name)}&api_key=${key}&limit=20&npf=true`
    );
    if (!r.ok) return [];
    const j = await r.json();
    const out = [];
    for (const p of j?.response || []) {
      if (!tumblrLooksGaming(p, name)) continue;
      // Images dans le post lui-même + dans le trail (pour les reblogs).
      const blocks = [
        ...(Array.isArray(p.content) ? p.content : []),
        ...(p.trail || []).flatMap((t) => (Array.isArray(t.content) ? t.content : [])),
      ];
      const img = blocks.find((b) => b?.type === "image" && b.media?.length);
      if (!img) continue;
      // media[] est trié du plus grand au plus petit : on prend une taille
      // raisonnable (≤ 1280px) pour ne pas charger l'original énorme.
      const m = img.media.find((x) => x.url && (x.width || 0) <= 1280) || img.media[0];
      if (!m?.url) continue;
      out.push({
        id: `tb-${p.id_string || p.id}`,
        source: "Tumblr",
        image: m.url,
        w: m.width || null,
        h: m.height || null,
        author: p.blog_name || "",
        url: p.post_url,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchFanart(name) {
  const [da, sb, tb] = await Promise.all([
    fetchDeviantArt(name),
    fetchSafebooru(name),
    fetchTumblr(name),
  ]);
  // Entrelacement des 3 sources pour la variété, dédoublonné par URL d'image.
  const seen = new Set();
  const out = [];
  const max = Math.max(da.length, sb.length, tb.length);
  for (let i = 0; i < max; i++) {
    for (const arr of [da, sb, tb]) {
      const item = arr[i];
      if (!item || seen.has(item.image)) continue;
      seen.add(item.image);
      out.push(item);
    }
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------------------
// Nettoyage du nom de jeu pour la recherche de fan arts.
// « Yuppie Psycho Deluxe Edition » → « Yuppie Psycho » ; « Ace Attorney
// Trilogy » → « Ace Attorney » ; « Le sanglot des cigales R ~…~ : Tome 8 » →
// on préfère le nom ORIGINAL (international) fourni par le client.
// ---------------------------------------------------------------------------
const EDITION_RE = new RegExp(
  "[\\s:\\-–—]*\\b(" +
    [
      "deluxe",
      "definitive",
      "complete",
      "goty",
      "game of the year",
      "remastered?",
      "enhanced",
      "special",
      "collector'?s?",
      "gold",
      "ultimate",
      "premium",
      "legendary",
      "anniversary",
      "digital",
      "standard",
      "hd",
      "trilogy",
      "collection",
      "bundle",
      "director'?s cut",
    ].join("|") +
    ")\\b( edition| cut| version)?\\s*$",
  "i"
);

export function cleanFanartName(raw) {
  let n = String(raw || "").trim();
  // Blocs « ~sous-titre~ » (jeux japonais localisés) : retirés.
  n = n.replace(/~[^~]*~/g, " ");
  // Suffixes d'édition, appliqués en boucle (« HD Remastered Edition »).
  let prev;
  do {
    prev = n;
    n = n.replace(EDITION_RE, "").trim();
  } while (n !== prev && n.length > 3);
  return n.replace(/\s{2,}/g, " ").replace(/[\s:\-–—]+$/, "").trim();
}

// Candidats de recherche, du plus précis au plus large : nom original nettoyé
// (international — décisif pour les titres localisés en français), nom affiché
// nettoyé, puis leur segment principal avant « : » / « - » (saga).
export function fanartCandidates(name, altName) {
  const out = [];
  const push = (v) => {
    const c = cleanFanartName(v);
    if (c && c.length >= 3 && !out.some((x) => x.toLowerCase() === c.toLowerCase()))
      out.push(c);
  };
  push(altName);
  push(name);
  for (const base of [altName, name]) {
    const seg = cleanFanartName(String(base || "").split(/\s*(?::|—|–| - )\s*/)[0]);
    if (seg && seg.split(/\s+/).length >= 2) push(seg);
  }
  // Ultime repli : premier mot du nom original s'il est assez distinctif
  // (« Higurashi … » → « Higurashi »). Jamais atteint si un candidat précédent
  // a déjà donné assez de résultats.
  const first = String(altName || "").trim().split(/\s+/)[0] || "";
  if (first.length >= 8) push(first);
  return out.slice(0, 5);
}

// Essaie chaque candidat jusqu'à avoir assez d'œuvres (≥ 5), sinon garde la
// meilleure moisson rencontrée.
async function fetchFanartSmart(name, altName) {
  let best = [];
  for (const cand of fanartCandidates(name, altName)) {
    const arts = await fetchFanart(cand);
    if (arts.length >= 5) return arts;
    if (arts.length > best.length) best = arts;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Réactions — Bluesky + Mastodon
// ---------------------------------------------------------------------------
let bskyJwt = null;
let bskyExpiry = 0;
async function getBskyToken() {
  if (!process.env.BLUESKY_IDENTIFIER || !process.env.BLUESKY_APP_PASSWORD)
    return null;
  if (bskyJwt && Date.now() < bskyExpiry) return bskyJwt;
  try {
    const r = await fetch(
      "https://bsky.social/xrpc/com.atproto.server.createSession",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: process.env.BLUESKY_IDENTIFIER,
          password: process.env.BLUESKY_APP_PASSWORD,
        }),
      }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.accessJwt) return null;
    bskyJwt = j.accessJwt;
    bskyExpiry = Date.now() + 90 * 60 * 1000; // le token dure ~2h, on renouvelle à 90 min
    return bskyJwt;
  } catch {
    return null;
  }
}

async function fetchBluesky(name) {
  const token = await getBskyToken();
  if (!token) return [];
  try {
    const r = await fetch(
      `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(
        `"${name}"`
      )}&limit=25&sort=top`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j.posts || [])
      .map((p) => {
        const rkey = p.uri.split("/").pop();
        const imgs = p.embed?.images || p.embed?.media?.images;
        return {
          id: `bs-${p.cid}`,
          source: "Bluesky",
          author: p.author?.displayName || p.author?.handle,
          handle: p.author?.handle,
          avatar: p.author?.avatar || null,
          text: p.record?.text || "",
          image: imgs?.[0]?.thumb || imgs?.[0]?.fullsize || null,
          likes: p.likeCount || 0,
          replies: p.replyCount || 0,
          url: `https://bsky.app/profile/${p.author?.handle}/post/${rkey}`,
          createdAt: p.record?.createdAt || p.indexedAt || null,
        };
      })
      .filter((x) => x.text || x.image);
  } catch {
    return [];
  }
}

// Instances francophones : leur flux LOCAL (local=true) est quasi 100 % FR,
// contrairement au flux fédéré de mastodon.social noyé d'anglais.
const MASTODON_FR_HOSTS = ["piaille.fr", "mamot.fr"];

async function fetchMastodonHost(host, tag) {
  try {
    const r = await fetch(
      `https://${host}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=20&local=true`,
      { headers: { "User-Agent": YT_UA } }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (Array.isArray(j) ? j : [])
      // Sécurité : on écarte tout post dont la langue déclarée n'est pas le FR.
      .filter((p) => !p.language || p.language === "fr")
      .map((p) => ({
        id: `ms-${host}-${p.id}`,
        source: "Mastodon",
        author: p.account?.display_name || p.account?.username,
        handle: p.account?.acct,
        avatar: p.account?.avatar || null,
        text: stripHtml(p.content),
        image:
          (p.media_attachments || []).find(
            (m) => m.type === "image" || m.type === "gifv"
          )?.preview_url || null,
        likes: p.favourites_count || 0,
        replies: p.replies_count || 0,
        url: p.url || p.uri,
        createdAt: p.created_at || null,
      }))
      .filter((x) => (x.text || x.image) && x.url);
  } catch {
    return [];
  }
}

async function fetchMastodon(name) {
  const tag = tagSlug(name);
  if (!tag) return [];
  const lists = await Promise.all(
    MASTODON_FR_HOSTS.map((h) => fetchMastodonHost(h, tag))
  );
  // Fusion + dédoublonnage par URL de post.
  const seen = new Set();
  const out = [];
  for (const item of lists.flat()) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

async function fetchSocial(name) {
  const [bs, ms] = await Promise.all([fetchBluesky(name), fetchMastodon(name)]);
  const all = [...bs, ...ms];
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return all.slice(0, 30);
}

// ---------------------------------------------------------------------------
// Avis joueurs — reviews Steam (officiel, sans clé)
// ---------------------------------------------------------------------------
// Résolution de l'appid Steam depuis IGDB (même logique que les succès Steam).
async function resolveSteamAppId(gameId) {
  try {
    let rows = await igdbQuery(
      "external_games",
      `fields uid,url; where game = ${gameId} & external_game_source = 1;`
    );
    if (!rows.length) {
      const all = await igdbQuery(
        "external_games",
        `fields uid,url; where game = ${gameId}; limit 50;`
      );
      rows = all.filter((r) => /steampowered\.com\/app\//.test(String(r.url || "")));
    }
    for (const r of rows) {
      const m = String(r.url || "").match(/app\/(\d+)/);
      if (m) return m[1];
      if (r.uid && /^\d+$/.test(String(r.uid))) return String(r.uid);
    }
  } catch {
    /* IGDB indispo */
  }
  return null;
}

// Cache dédié (les avis Steam ne font plus partie du feed : ils alimentent
// désormais l'onglet Reviews, appelé indépendamment).
const steamCache = new Map(); // gameId -> { ts, data }
const STEAM_TTL = 30 * 60 * 1000;

export async function fetchSteamReviews(gameId) {
  const key = String(gameId);
  const hit = steamCache.get(key);
  if (hit && Date.now() - hit.ts < STEAM_TTL) return hit.data;
  const data = await buildSteamReviews(gameId);
  steamCache.set(key, { ts: Date.now(), data });
  return data;
}

async function buildSteamReviews(gameId) {
  const appid = await resolveSteamAppId(gameId);
  if (!appid) return null;
  try {
    const r = await fetch(
      `https://store.steampowered.com/appreviews/${appid}?json=1&filter=all&language=french` +
        `&num_per_page=20&purchase_type=all&review_type=all&day_range=365&filter_offtopic_activity=0`
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (j.success !== 1) return null;
    const s = j.query_summary || {};
    const list = (j.reviews || [])
      .map((rv) => ({
        id: rv.recommendationid,
        up: rv.voted_up,
        text: (rv.review || "").trim(),
        playtimeH: Math.round((rv.author?.playtime_forever || 0) / 60),
        helpful: rv.votes_up || 0,
        funny: rv.votes_funny || 0,
        date: rv.timestamp_created ? rv.timestamp_created * 1000 : null,
        url: rv.author?.steamid
          ? `https://steamcommunity.com/profiles/${rv.author.steamid}/recommended/${appid}/`
          : `https://store.steampowered.com/app/${appid}/`,
      }))
      .filter((x) => x.text)
      .sort((a, b) => b.helpful - a.helpful);
    if (!s.total_reviews && !list.length) return null;
    return {
      appid,
      scoreDesc: s.review_score_desc || null,
      positive: s.total_positive || 0,
      negative: s.total_negative || 0,
      total: s.total_reviews || 0,
      storeUrl: `https://store.steampowered.com/app/${appid}/#app_reviews_hash`,
      list,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// YouTube — shorts et clips rigolos (scraping de ytInitialData)
// ---------------------------------------------------------------------------
function pickThumb(thumbs) {
  const arr = thumbs?.thumbnails || [];
  return arr[arr.length - 1]?.url || arr[0]?.url || null;
}

export async function ytSearch(query, { sp = "" } = {}) {
  try {
    const spParam = sp ? `&sp=${sp}` : "";
    const html = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${spParam}`,
      // Accept-Language FR : biaise les résultats vers du contenu francophone.
      { headers: { "User-Agent": YT_UA, "Accept-Language": "fr-FR,fr;q=0.9" } }
    ).then((r) => r.text());
    const raw = html.split("ytInitialData = ")[1]?.split(";</script>")[0];
    if (!raw) return [];
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
    const out = [];
    const seen = new Set();
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      const v = o.videoRenderer;
      if (v?.videoId && !seen.has(v.videoId)) {
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText;
        if (title) {
          seen.add(v.videoId);
          out.push({
            videoId: v.videoId,
            title,
            author:
              v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "",
            thumb: pickThumb(v.thumbnail),
            duration: v.lengthText?.simpleText || null,
            isShort: !v.lengthText,
          });
        }
      }
      const lm = o.shortsLockupViewModel;
      const sid = lm?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (sid && !seen.has(sid)) {
        const title =
          lm.overlayMetadata?.primaryText?.content || lm.accessibilityText || "Short";
        seen.add(sid);
        out.push({
          videoId: sid,
          title,
          author: "",
          thumb: `https://i.ytimg.com/vi/${sid}/hqdefault.jpg`,
          duration: null,
          isShort: true,
        });
      }
      for (const k in o) walk(o[k]);
    })(data);
    return out;
  } catch {
    return [];
  }
}

async function fetchYouTube(name) {
  // Uniquement du contenu FR travaillé : documentaires, essais/analyses et
  // tests. Pas de shorts (on filtre explicitement les vidéos sans durée).
  const [docu, analyse, tests] = await Promise.all([
    ytSearch(`${name} documentaire`),
    ytSearch(`${name} analyse`),
    ytSearch(`${name} test fr`),
  ]);
  const seen = new Set();
  const out = [];
  // Ordre = priorité d'affichage : documentaires, analyses, tests.
  for (const v of [...docu, ...analyse, ...tests]) {
    // isShort (pas de lengthText) => on écarte : on ne veut que des vraies vidéos.
    if (!v.videoId || v.isShort || !v.duration || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
  }
  return out.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Agrégation + cache mémoire (30 min)
// ---------------------------------------------------------------------------
const cache = new Map(); // gameId -> { ts, data }
const TTL = 30 * 60 * 1000;

// v2 : plus de Twitch ni de YouTube (l'onglet Feed est désormais posts des
// joueurs + fan arts). `altName` = nom original/international du jeu (IGDB),
// décisif pour la recherche quand le titre affiché est localisé.
export async function buildGameFeed(gameId, name, altName = null) {
  const key = `v2-${gameId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const [fanart, posts] = await Promise.all([
    fetchFanartSmart(name, altName),
    fetchSocial(name),
  ]);

  const data = { streams: [], fanart, posts, videos: [] };
  cache.set(key, { ts: Date.now(), data });
  return data;
}
