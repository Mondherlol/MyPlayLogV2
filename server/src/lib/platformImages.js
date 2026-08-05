// Vraies photos de consoles (source Wikipedia, la même image que la fiche
// console /platform/:id) — par NOM de plateforme, TÉLÉCHARGÉES UNE FOIS sur le
// serveur (dossier uploads/platforms, servi par /uploads) puis mises en cache
// (EntityLogo, kind "platform-photo" → nom de fichier local). On ne re-scrape
// jamais une photo déjà rapatriée. Best-effort de bout en bout.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EntityLogo from "../models/EntityLogo.js";
import PlatformProfile from "../models/PlatformProfile.js";
import { fetchWikiSummary } from "./platformProfile.js";

const KIND = "platform-photo";
// Réessai des entrées « introuvable » (image null) — une photo déjà téléchargée
// n'est JAMAIS re-scrappée. Court, pour qu'un échec réseau ponctuel se soigne vite.
const RETRY_MS = 6 * 60 * 60 * 1000;
// Wikipedia/Wikimedia limitent les rafales : on rapatrie en série (1 à la fois),
// c'est un enrichissement ponctuel mis en cache définitivement ensuite.
const CONCURRENCY = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../uploads/platforms");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 24 * 1024 * 1024; // 24 Mo max (rendus PNG transparents haute déf)
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

// Garde-fou SSRF : seulement du http(s) public (l'URL vient de Wikipedia, mais
// on reste prudent), jamais une adresse locale/privée.
function isSafeImageUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host.includes(":")) return false; // IPv6 littérale : on écarte
  return true;
}

// Applique `fn` avec une concurrence bornée (évite les rafales de requêtes
// Wikipedia qui déclenchent du rate-limiting → échecs intermittents).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "platform";

// Télécharge une image vers uploads/platforms et renvoie le nom de fichier local
// (ou null en cas d'échec / de contenu non-image).
async function downloadToDisk(url, name) {
  if (!isSafeImageUrl(url)) return null;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const mime = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_MIME[mime];
    if (!ext) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const filename = `${slugify(name)}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buf);
    return filename;
  } catch {
    return null;
  }
}

// URL source de la photo. On privilégie la VIGNETTE Wikipedia telle quelle
// (~330 px, petit fichier, téléchargement fiable — Wikimedia ne sert que des
// largeurs précises, inutile de la réécrire) ; repli sur l'image du profil
// console déjà construit, puis sur un éventuel ancien hotlink en cache.
async function resolveSourceUrl(name, cachedImage, fromProfile) {
  if (cachedImage && /^https?:/i.test(cachedImage)) return cachedImage;
  try {
    const wiki = await fetchWikiSummary(name);
    if (wiki?.thumbnail) return wiki.thumbnail;
    if (wiki?.image) return wiki.image;
  } catch {
    /* transitoire : on tentera le repli / un nouvel essai */
  }
  if (fromProfile.has(name)) return fromProfile.get(name);
  return null;
}

// Garantit la présence locale des photos demandées et renvoie une Map
// name -> filename|null (le nom de fichier, pas l'URL : la route construit l'URL).
export async function ensurePlatformImages(names) {
  const wanted = [
    ...new Set(names.map((n) => String(n || "").trim()).filter(Boolean)),
  ];
  const out = new Map();
  if (!wanted.length) return out;

  const existing = await EntityLogo.find({ kind: KIND, name: { $in: wanted } }).lean();
  const byName = new Map(existing.map((e) => [e.name, e]));
  const now = Date.now();
  const isLocalFile = (v) => v && !/^https?:/i.test(v);
  const missing = wanted.filter((n) => {
    const e = byName.get(n);
    if (!e) return true; // jamais résolu
    if (isLocalFile(e.image)) return false; // photo déjà rapatriée → jamais re-scrappée
    if (e.image) return true; // ancien hotlink http → à rapatrier localement
    return now - new Date(e.updatedAt).getTime() > RETRY_MS; // « introuvable » → réessai rare
  });

  if (missing.length) {
    // Profils console déjà en cache : leur `image` est la même photo Wikipedia.
    const profiles = await PlatformProfile.find({ name: { $in: missing } })
      .select("name image")
      .lean();
    const fromProfile = new Map(profiles.map((p) => [p.name, p.image || null]));

    const resolved = await mapLimit(missing, CONCURRENCY, async (name) => {
      // Deux tentatives : un échec Wikipedia/Wikimedia ponctuel ne fige pas la
      // photo à « introuvable » pour la fenêtre de réessai.
      for (let attempt = 0; attempt < 2; attempt++) {
        const srcUrl = await resolveSourceUrl(name, byName.get(name)?.image, fromProfile);
        const file = srcUrl ? await downloadToDisk(srcUrl, name) : null;
        if (file) return [name, file];
        if (attempt === 0) await sleep(450);
      }
      return [name, null];
    });

    const ops = resolved.map(([name, image]) => {
      byName.set(name, { name, image });
      return {
        updateOne: {
          filter: { kind: KIND, name },
          update: { $set: { image } },
          upsert: true,
        },
      };
    });
    try {
      await EntityLogo.bulkWrite(ops, { ordered: false });
    } catch (err) {
      console.error("platform image cache error:", err.message);
    }
  }

  for (const n of wanted) out.set(n, byName.get(n)?.image ?? null);
  return out;
}
