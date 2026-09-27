import * as cheerio from "cheerio";

// --- Recherche de fixs réseau Online-Fix (https://online-fix.me) : jeux PC
// multijoueurs rendus jouables en ligne (Steam/Epic émulés). On s'en sert pour
// l'onglet Téléchargements de la fiche jeu, section « Téléchargement Online-Fix ».
//
// Le site (DataLife Engine, encodé en windows-1251) n'a pas d'API : on scrape la
// recherche puis la page de chaque résultat. Pas besoin de compte : les liens
// sont présents dans le HTML même déconnecté (c'est un script anti-adblock qui
// les masque côté navigateur), la page « Hosters » et le .torrent sont publics.
// Seul le .rar direct du serveur `uploads` exige une session online-fix — on le
// propose quand même, pour ceux qui sont connectés au site dans leur navigateur. ---

const OF_BASE = "https://online-fix.me";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Normalise pour comparaison : sans accents, minuscule.
const strip = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Mots vides ignorés dans la comparaison de pertinence (FR + EN + bruit courant).
const STOP = new Set([
  "the", "of", "a", "an", "and", "or", "to", "in", "le", "la", "les", "de",
  "du", "des", "un", "une", "et", "for", "on", "edition", "deluxe", "complete",
]);

function nameTokens(name) {
  return strip(name)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Online-Fix écrit les titres sans ponctuation (« No Mans Sky ») : on compare
// sur le titre débarrassé de tout sauf lettres/chiffres, et on exige TOUS les
// mots significatifs du nom du jeu.
function isRelevant(title, tokens) {
  if (!tokens.length) return true;
  const t = strip(title).replace(/[^a-z0-9]+/g, "");
  return tokens.every((tok) => t.includes(tok));
}

// « Valheim по сети » / « Shift At Midnight Online » → « Valheim ».
function cleanTitle(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(по сети|online|онлайн)$/i, "");
}

// Le site sert du windows-1251 : on décode à la main (fetch().text() suppose UTF-8).
async function getHtml(url, init = {}) {
  const resp = await fetch(url, {
    ...init,
    headers: { "User-Agent": UA, Referer: `${OF_BASE}/`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`online-fix HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const charset = /charset=([\w-]+)/i.exec(resp.headers.get("content-type") || "")?.[1];
  const enc = charset && !/utf-?8/i.test(charset) ? charset : "windows-1251";
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return new TextDecoder("windows-1251").decode(buf);
  }
}

// Cache mémoire (recherche + pages = plusieurs requêtes lentes, catalogue stable).
const cache = new Map(); // name -> { at, games }
const TTL = 60 * 60 * 1000; // 1 h

export async function fetchOnlineFixGames(name, limit = 3) {
  // Le moteur DLE cherche mot à mot : l'apostrophe de « No Man's Sky » ferait
  // tout rater (le site écrit « No Mans Sky »).
  const q = String(name || "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!q) return [];

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.games;

  let games = [];
  try {
    const html = await getHtml(`${OF_BASE}/index.php?do=search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ do: "search", subaction: "search", story: q }).toString(),
    });
    const found = parseSearch(html, nameTokens(q)).slice(0, limit);
    // Détail de chaque résultat en parallèle (liens, version, joueurs).
    games = (
      await Promise.all(
        found.map((g) =>
          fetchDetail(g).catch((err) => {
            console.error("online-fix page error:", g.page, err.message);
            return null;
          })
        )
      )
    ).filter(Boolean);
  } catch (err) {
    console.error("online-fix fetch error:", err.message);
    if (hit) return hit.games; // dernière réponse valide, sinon liste vide
    return [];
  }

  cache.set(key, { at: Date.now(), games });
  return games;
}

function parseSearch(html, tokens) {
  const $ = cheerio.load(html);
  const out = [];
  $(".news-search .article").each((_, el) => {
    const a = $(el);
    const title = cleanTitle(a.find("h2.title").first().text());
    const page = a.find("a.big-link").attr("href") || a.find("h2.title").parent("a").attr("href");
    if (!title || !page || !/\/games\//.test(page) || !isRelevant(title, tokens)) return;
    const poster = a.find(".image img").attr("data-src") || a.find(".image img").attr("src") || null;
    out.push({
      title,
      page,
      poster: poster && poster.startsWith("/") ? OF_BASE + poster : poster,
      date: a.find("time[datetime]").attr("datetime") || null,
      // « Обновлено 22 сентября 2026, 13:48. Игра обновлена до версии 1.0.15. »
      version: /версии\s+([^\s]+?)\.?\s*$/i.exec(a.find(".edit").text().trim())?.[1] || null,
    });
  });
  return out;
}

async function fetchDetail(g) {
  const $ = cheerio.load(await getHtml(g.page));
  const body = $('[itemprop="articleBody"]');
  // Le texte est rythmé par des <br> : on en fait des lignes pour les regex.
  body.find("br").replaceWith("\n");
  const text = body.text();

  const links = { hosters: null, drive: null, server: null, torrentDir: null };
  body.find("div.quote a.btn").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (/\/\/hosters\./.test(href)) links.hosters ||= href;
    else if (/\/\/drive\./.test(href)) links.drive ||= href;
    else if (/\/torrents\//.test(href)) links.torrentDir ||= href;
    else if (/\/\/uploads\..*\/uploads\//.test(href)) links.server ||= href;
  });
  // Page sans aucun lien de téléchargement (news, programme…) : inutile.
  if (!links.hosters && !links.drive && !links.torrentDir && !links.server) return null;

  // Bloc « Информация о сетевых режимах » : <div class="coop1">КООПЕРАТИВ: 4</div>.
  // Le chiffre final de la classe dit si le mode existe, le texte donne le nombre
  // de joueurs (« ? » quand il est inconnu). → nombre | "?" | 0 | null (pas d'info).
  const mode = (kind) => {
    const el = body.find(`div[class^="${kind}"]`).first();
    if (!el.length) return null;
    if (!/1$/.test(el.attr("class") || "")) return 0;
    const n = /(\d+)/.exec(el.text())?.[1];
    return n ? Number(n) : "?";
  };

  return {
    ...g,
    version: /Версия игры:\s*([^\n]+?)\s*(?:\n|$)/i.exec(text)?.[1]?.trim() || g.version,
    via: /Игра через:\s*([^\n]+?)\s*(?:\n|$)/i.exec(text)?.[1]?.trim() || null,
    coop: mode("coop"),
    multi: mode("multi"),
    hosters: links.hosters,
    drive: links.drive,
    server: links.server,
    torrent: links.torrentDir ? await resolveTorrent(links.torrentDir) : null,
  };
}

// Le bouton « Torrent » pointe sur un index de dossier : on y prend le premier
// .torrent (lien direct, public). À défaut, on garde le dossier.
async function resolveTorrent(dir) {
  try {
    const $ = cheerio.load(await getHtml(dir));
    const file = $('a[href$=".torrent"]').first().attr("href");
    return file ? new URL(file, dir.endsWith("/") ? dir : `${dir}/`).href : dir;
  } catch {
    return dir;
  }
}
