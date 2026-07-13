import * as cheerio from "cheerio";

// --- Recherche de packs / torrents de jeux sur C411 (tracker FR) via son API
// Torznab (flux XML façon RSS). On s'en sert pour l'onglet « Pack HD » de la
// fiche jeu : pour n'importe quel jeu, on liste les torrents correspondants,
// regroupés par plateforme, avec poids / seeders / lien torrent. ---

const C411_API = "https://c411.org/api";
const C411_KEY =
  process.env.C411_API_KEY ||
  "076a2466932ddb16946ec28f920b19f3a0cd560d32cea0af738aced9f2167d56";

// On NE filtre PAS par catégorie côté API : `cat=4050` ne renvoie que les jeux
// PC et exclut toutes les consoles (Switch, WiiU…), et l'API n'accepte pas une
// liste de catégories. On récupère donc tout et on garde les catégories jeux
// dans le code : Console (1000-1999) + PC (4000-4099). Exclut PDF/audio/vidéo.
function isGameCategory(cat) {
  const c = Number(cat);
  return (c >= 1000 && c < 2000) || (c >= 4000 && c < 4100);
}

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

// La recherche C411 est très permissive (elle remonte quantité de torrents sans
// rapport). On ne garde que ceux dont le titre contient TOUS les mots
// significatifs du nom du jeu → élimine Half-Life, films, autres jeux, etc.
function isRelevant(title, tokens) {
  if (!tokens.length) return true;
  const t = strip(title);
  return tokens.every((tok) => t.includes(tok));
}

// Détection de plateforme depuis le titre (les torrents la balisent : [SWITCH],
// NSP/XCI = Switch, WUA = WiiU, [PS4], [GOG]/WIN/repack = PC…). Premier match.
const PLATFORM_RULES = [
  [/nsp|xci|nsz|\bswitch\b/, "Switch"],
  [/\bwii\s?u\b|\bwua\b/, "Wii U"],
  [/\bwii\b/, "Wii"],
  [/\bps5\b/, "PS5"],
  [/\bps4\b/, "PS4"],
  [/\bps3\b/, "PS3"],
  [/\bps2\b/, "PS2"],
  [/\bpsp\b/, "PSP"],
  [/\bvita\b|psvita/, "PS Vita"],
  [/\b3ds\b/, "3DS"],
  [/\bnds\b|nintendo ds/, "DS"],
  [/xbox\s?360/, "Xbox 360"],
  [/xbox\s?(one|series)/, "Xbox"],
  [/\bxbox\b/, "Xbox"],
  [/\bvr\b|quest|oculus/, "VR"],
  [/macos|mac os/, "Mac"],
];
function detectPlatform(title) {
  const t = strip(title);
  for (const [re, label] of PLATFORM_RULES) if (re.test(t)) return label;
  return "PC"; // par défaut (repacks PC non balisés)
}

// Cache mémoire (les recherches C411 sont lentes et le catalogue bouge peu).
const cache = new Map(); // name -> { at, packs }
const TTL = 60 * 60 * 1000; // 1 h

export async function fetchC411Packs(name, limit = 60) {
  const q = String(name || "").trim();
  if (!q) return [];

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.packs;

  const url =
    `${C411_API}?t=search&q=${encodeURIComponent(q)}` +
    `&apikey=${C411_KEY}&limit=${limit}`;

  let packs = [];
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "MyPlayLog/1.0" } });
    if (resp.ok) {
      const xml = await resp.text();
      packs = parseTorznab(xml, nameTokens(q));
    }
  } catch (err) {
    console.error("c411 fetch error:", err.message);
    // On garde la dernière réponse valide si on en a une, sinon liste vide.
    if (hit) return hit.packs;
    return [];
  }

  cache.set(key, { at: Date.now(), packs });
  return packs;
}

function parseTorznab(xml, tokens) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, el) => {
    const item = $(el);
    const attr = (n) =>
      item.find(`torznab\\:attr[name="${n}"], attr[name="${n}"]`).attr("value");

    // On ignore tout ce qui n'est pas un jeu (PDF, OST, films…).
    if (!isGameCategory(attr("category"))) return;

    const title = item.find("title").first().text().trim() || "Sans titre";
    if (!isRelevant(title, tokens)) return;

    // `link` = page torrent (lisible). On NE renvoie PAS l'URL de l'enclosure :
    // elle embarque notre clé API partagée (= passkey), et distribuer ce lien
    // ferait compter tous les téléchargements sur ce seul compte (ratio flingué
    // + ban). On renvoie juste l'`id` (infohash) : le client reconstruit l'URL
    // .torrent avec la clé API PERSO de l'utilisateur, s'il en a saisi une.
    const page = item.find("link").first().text().trim() || null;
    const encId = (item.find("enclosure").attr("url") || "").match(/[?&]id=([a-f0-9]+)/i);
    const id =
      (encId && encId[1]) ||
      item.find("guid").first().text().trim() ||
      (page && page.match(/\/([a-f0-9]{20,})$/i)?.[1]) ||
      null;
    const sizeRaw = item.find("size").first().text().trim() || attr("size");
    const size = sizeRaw && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : null;
    const seeders = attr("seeders");
    const pubDate = item.find("pubDate").first().text().trim() || null;

    out.push({
      title,
      platform: detectPlatform(title),
      page,
      id, // infohash : sert à construire le lien .torrent côté client
      size, // en octets, ou null
      seeders: seeders != null ? Number(seeders) : null,
      pubDate,
    });
  });
  // Les mieux seedés d'abord (les plus « vivants » / téléchargeables).
  out.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  return out;
}
