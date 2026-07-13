import * as cheerio from "cheerio";

// --- Recherche de packs / torrents de jeux sur C411 (tracker FR) via son API
// Torznab (flux XML façon RSS). On s'en sert pour l'onglet « Pack HD » de la
// fiche jeu : pour n'importe quel jeu, on liste les torrents correspondants
// avec leur poids et le lien vers la page torrent. ---

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

// Cache mémoire (les recherches C411 sont lentes et le catalogue bouge peu).
const cache = new Map(); // name -> { at, packs }
const TTL = 60 * 60 * 1000; // 1 h

export async function fetchC411Packs(name, limit = 40) {
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
      packs = parseTorznab(xml);
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

function parseTorznab(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $("item").each((_, el) => {
    const item = $(el);
    const attr = (n) =>
      item.find(`torznab\\:attr[name="${n}"], attr[name="${n}"]`).attr("value");

    // On ignore tout ce qui n'est pas un jeu (PDF, OST, films…).
    if (!isGameCategory(attr("category"))) return;

    const title = item.find("title").first().text().trim() || "Sans titre";
    // `link` = page torrent (lisible) ; `enclosure` = .torrent direct (API get).
    const page = item.find("link").first().text().trim() || null;
    const download = item.find("enclosure").attr("url") || null;
    const sizeRaw = item.find("size").first().text().trim() || attr("size");
    const size = sizeRaw && /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : null;
    const seeders = attr("seeders");
    const pubDate = item.find("pubDate").first().text().trim() || null;

    out.push({
      title,
      page,
      download,
      size, // en octets, ou null
      seeders: seeders != null ? Number(seeders) : null,
      pubDate,
    });
  });
  // Les mieux seedés d'abord (les plus « vivants » / téléchargeables).
  out.sort((a, b) => (b.seeders || 0) - (a.seeders || 0));
  return out;
}
