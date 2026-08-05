import * as cheerio from "cheerio";

// --- Recherche de repacks FitGirl (jeux PC) via l'API REST WordPress du site
// (https://fitgirl-repacks.site/wp-json/wp/v2/posts). On s'en sert pour l'onglet
// « Patchs » de la fiche jeu, section « Téléchargement FitGirl » : pour un jeu
// PC, on liste les repacks correspondants avec poids (repack / original) et lien
// magnet. Réécrit en Node (le site n'expose qu'une API WordPress publique) →
// pas de dépendance Python en prod. ---

const FG_BASE = "https://fitgirl-repacks.site";
const FG_API = `${FG_BASE}/wp-json/wp/v2/posts`;

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

// La recherche FitGirl (WordPress) est permissive : on ne garde que les repacks
// dont le titre contient TOUS les mots significatifs du nom du jeu → élimine les
// « Updates Digest », les jeux voisins, etc.
function isRelevant(title, tokens) {
  if (!tokens.length) return true;
  const t = strip(title);
  return tokens.every((tok) => t.includes(tok));
}

// « Repack Size » / « Original Size » depuis le TEXTE de la page (les valeurs
// sont enveloppées de <strong> → on lit le texte aplati, pas le HTML brut).
function extractSize(text, label) {
  const re = new RegExp(
    `${label}:?\\s*((?:from\\s+)?\\d+(?:\\.\\d+)?\\s*(?:GB|MB|TB)(?:\\s*\\[Selective Download\\])?)`,
    "i"
  );
  const m = text.match(re);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

// Cache mémoire (l'API WordPress est lente et le catalogue bouge peu).
const cache = new Map(); // name -> { at, repacks }
const TTL = 60 * 60 * 1000; // 1 h

export async function fetchFitgirlRepacks(name, limit = 8) {
  const q = String(name || "").trim();
  if (!q) return [];

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.repacks;

  // `orderby=relevance` est INDISPENSABLE : sans lui l'API trie par date et
  // renvoie les derniers posts en ignorant la recherche.
  const url =
    `${FG_API}?search=${encodeURIComponent(q)}` +
    `&orderby=relevance&per_page=${limit}`;

  let repacks = [];
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "MyPlayLog/1.0" } });
    if (resp.ok) {
      const posts = await resp.json();
      const tokens = nameTokens(q);
      repacks = parsePosts(Array.isArray(posts) ? posts : [], tokens);
    }
  } catch (err) {
    console.error("fitgirl fetch error:", err.message);
    if (hit) return hit.repacks; // dernière réponse valide, sinon liste vide
    return [];
  }

  cache.set(key, { at: Date.now(), repacks });
  return repacks;
}

function parsePosts(posts, tokens) {
  const out = [];
  for (const post of posts) {
    const title = cheerio.load(post?.title?.rendered || "").root().text().trim();
    if (!title || !isRelevant(title, tokens)) continue;

    const $ = cheerio.load(post?.content?.rendered || "");
    const text = $.root().text();

    // Sans magnet, le repack n'est pas téléchargeable (posts d'annonce, FAQ…).
    const magnet = $('a[href^="magnet:"]').first().attr("href") || null;
    if (!magnet) continue;

    out.push({
      title,
      slug: post.slug || null,
      page: post.link || (post.slug ? `${FG_BASE}/${post.slug}/` : null),
      repackSize: extractSize(text, "Repack Size"),
      originalSize: extractSize(text, "Original Size"),
      magnet,
      date: post.date || null,
    });
  }
  return out;
}
