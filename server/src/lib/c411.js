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

// --- Téléchargement + réécriture d'un .torrent pour le compte de l'utilisateur.
// On récupère le .torrent via NOTRE clé API partagée (récupérer le *fichier*
// .torrent ne consomme aucun ratio — seul le leech des *données* via BitTorrent
// compte, et il utilisera le passkey qu'on incruste). Puis on remplace l'URL
// d'annonce par celle du passkey de l'utilisateur → son ratio. ---

// Cache mémoire des .torrent bruts (statiques par infohash) : évite de
// re-solliciter C411 à chaque clic.
const torrentCache = new Map(); // id -> { at, buf }
const TORRENT_TTL = 6 * 60 * 60 * 1000; // 6 h

export async function fetchC411Torrent(id) {
  const key = String(id || "").toLowerCase();
  if (!/^[a-f0-9]{20,64}$/.test(key)) throw new Error("Torrent introuvable.");

  const hit = torrentCache.get(key);
  if (hit && Date.now() - hit.at < TORRENT_TTL) return hit.buf;

  const url = `${C411_API}?t=get&id=${key}&apikey=${C411_KEY}`;
  const resp = await fetch(url, { headers: { "User-Agent": "MyPlayLog/1.0" } });
  if (!resp.ok) throw new Error("Téléchargement du .torrent impossible.");
  const buf = Buffer.from(await resp.arrayBuffer());
  // Garde-fou : un vrai .torrent bencodé commence par 'd' (dictionnaire).
  if (buf[0] !== 0x64 /* 'd' */) throw new Error("Réponse C411 invalide.");

  torrentCache.set(key, { at: Date.now(), buf });
  return buf;
}

// Remplace l'URL d'annonce C411 (announce + announce-list) par celle du passkey
// donné, SANS toucher au reste. On opère par substitution de tokens bencodés
// « <len>:<url> » : le dict `info` (donc l'infohash) reste identique à l'octet
// près — indispensable pour que le tracker reconnaisse le torrent.
export function rewriteAnnounce(buf, passkey) {
  const pk = String(passkey || "").trim();
  if (!/^[a-f0-9]{16,64}$/i.test(pk)) throw new Error("Passkey invalide.");

  // On lit la valeur de la clé bencodée `8:announce` en respectant sa longueur
  // préfixée « <len>:<url> » — surtout PAS par regex : l'URL est suivie de
  // `13:announce-list`, et un match gourmand happerait ces chiffres.
  const s = buf.toString("latin1");
  const key = "8:announce";
  let i = s.indexOf(key);
  if (i === -1) return buf; // pas d'announce → rien à faire
  i += key.length;
  let digits = "";
  while (i < s.length && s[i] >= "0" && s[i] <= "9") digits += s[i++];
  if (s[i] !== ":" || !digits) return buf;
  i++; // saute ':'
  const oldUrl = s.substr(i, parseInt(digits, 10));
  if (!/^https?:\/\//i.test(oldUrl)) return buf;

  const newUrl = `https://c411.org/announce/${pk}`;
  if (oldUrl === newUrl) return buf;

  // Token bencodé exact (identique dans announce et chaque entrée announce-list).
  const oldTok = Buffer.from(`${oldUrl.length}:${oldUrl}`, "latin1");
  const newTok = Buffer.from(`${newUrl.length}:${newUrl}`, "latin1");

  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(oldTok, start)) !== -1) {
    parts.push(buf.subarray(start, idx), newTok);
    start = idx + oldTok.length;
  }
  parts.push(buf.subarray(start));
  return Buffer.concat(parts);
}
