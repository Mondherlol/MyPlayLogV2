import * as cheerio from "cheerio";

// --- Recherche de jeux sur Ziperto (https://www.ziperto.com) via sa page de
// recherche WordPress (`?s=<query>`). On s'en sert pour l'onglet « Patchs » de la
// fiche jeu, section « Téléchargement Ziperto » : ROMs/NSP/XCI (Switch, 3DS,
// Wii U), jeux PC, VPK (PS Vita)… Le site n'expose pas d'API JSON propre à la
// recherche, donc on scrape le HTML des résultats (chaque résultat = un post avec
// titre, catégorie/plateforme, jaquette et lien vers la page du jeu). ---

const ZP_BASE = "https://www.ziperto.com";

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

// La recherche Ziperto est permissive : on ne garde que les posts dont le titre
// contient TOUS les mots significatifs du nom du jeu → élimine les jeux voisins,
// les listes (« NSP List »), etc.
function isRelevant(title, tokens) {
  if (!tokens.length) return true;
  const t = strip(title);
  return tokens.every((tok) => t.includes(tok));
}

// Cache mémoire (la page de recherche est lente et le catalogue bouge peu).
const cache = new Map(); // name -> { at, results }
const TTL = 60 * 60 * 1000; // 1 h

export async function fetchZipertoGames(name, limit = 8) {
  const q = String(name || "").trim();
  if (!q) return [];

  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.results;

  const url = `${ZP_BASE}/?s=${encodeURIComponent(q)}`;

  let results = [];
  try {
    const resp = await fetch(url, {
      headers: {
        // Ziperto renvoie une page vide/erreur sans User-Agent « navigateur ».
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      },
    });
    if (resp.ok) {
      const html = await resp.text();
      results = parseSearch(html, nameTokens(q), limit);
    }
  } catch (err) {
    console.error("ziperto fetch error:", err.message);
    if (hit) return hit.results; // dernière réponse valide, sinon liste vide
    return [];
  }

  cache.set(key, { at: Date.now(), results });
  return results;
}

function parseSearch(html, tokens, limit) {
  const $ = cheerio.load(html);
  const out = [];

  $(".post-list article").each((_, el) => {
    if (out.length >= limit) return false;
    const $el = $(el);

    const $link = $el.find(".post-title a").first();
    const title = $link.text().trim();
    const page = $link.attr("href") || null;
    if (!title || !page || !isRelevant(title, tokens)) return;

    // Jaquette : on privilégie la plus grande source du srcset (720w) sinon le src.
    const $img = $el.find(".post-thumbnail img").first();
    const srcset = $img.attr("srcset") || "";
    const big = srcset
      .split(",")
      .map((s) => s.trim().split(" ")[0])
      .filter(Boolean)
      .pop();
    const cover = big || $img.attr("src") || null;

    out.push({
      title,
      page,
      cover,
      // Plateforme / catégorie (ex. « Nintendo Switch NSP », « PC Games »).
      platform: $el.find(".post-category a").first().text().trim() || null,
      date: $el.find(".post-date").first().text().trim() || null,
    });
  });

  return out;
}
