// ======================================================================
//  La page d'un jeu itch.io, lue et normalisée
// ======================================================================
//
// Le pendant de lib/steamStore.js. itch.io n'a pas d'API publique de
// catalogue, mais chaque jeu publie deux choses lisibles sans compte :
//
//   • `https://auteur.itch.io/jeu/data.json` — l'identifiant, le titre, la
//     jaquette, les captures, les tags, l'auteur ;
//   • la page elle-même — la description, et le tableau « More information »
//     (statut, plateformes, date de publication, genre).
//
// ⚠️ ON NE CHERCHE PAS SUR ITCH.IO. Leur robots.txt interdit `/search` aux
// robots : on ne lit qu'une page dont la personne a collé le lien, une fois,
// et on la garde en base. Un jeu introuvable par son nom s'ajoute par son lien.

import { createTtlCache } from "./ttlCache.js";

const UA = "MyPlayLog/1.0 (+https://myplaylog.fr)";

const pageCache = createTtlCache({ name: "itch:page", max: 200, ttl: 6 * 60 * 60 * 1000 });

/**
 * `{ user, slug, url }` pour un lien de page de jeu itch.io, ou `null`.
 * Accepte l'adresse avec ou sans `https://`, avec une ancre ou des paramètres.
 */
export function parseItchUrl(input) {
  const raw = String(input || "").trim();
  const m = raw.match(/^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.itch\.io\/([a-z0-9][a-z0-9_-]*)/i);
  if (!m) return null;
  const user = m[1].toLowerCase();
  const slug = m[2].toLowerCase();
  // `itch.io/…` sans sous-domaine n'est pas une page de jeu ; `www`, `static`
  // et compagnie ne sont pas des auteurs.
  if (["www", "static", "img", "api", "itch"].includes(user)) return null;
  return { user, slug, url: `https://${user}.itch.io/${slug}` };
}

function decode(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

async function get(url, accept = "text/html") {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, redirect: "follow" });
  return res;
}

/** Les lignes du tableau « More information » : { Status: "…", Platforms: "…" }. */
function infoTable(html) {
  const out = {};
  for (const m of html.matchAll(/<tr><td>([^<]+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)) {
    out[decode(m[1])] = {
      text: decode(m[2].replace(/<a[^>]*>/g, "").replace(/<\/a>\s*,?/g, ",")),
      // Les dates sont dans l'attribut `title` d'un <abbr> : « 05 December
      // 2025 @ 18:49 UTC ». Le texte visible, lui, dit « 15 days ago ».
      date: m[2].match(/<abbr title="([^"]+)"/)?.[1] || null,
    };
  }
  return out;
}

const list = (s) =>
  String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function toTimestamp(itchDate) {
  if (!itchDate) return null;
  const t = Date.parse(String(itchDate).replace(" @ ", " ").replace(" UTC", " GMT"));
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/**
 * La fiche d'un jeu itch.io, prête à ranger dans ItchGame — ou `null` si la
 * page n'existe pas (retirée, privée, ou réservée aux comptes connectés).
 */
export async function fetchItchGame(url, { fresh = false } = {}) {
  const parsed = parseItchUrl(url);
  if (!parsed) return null;
  // « Actualiser » relit vraiment la page, sans le cache de six heures.
  if (fresh) pageCache.delete(parsed.url);
  return pageCache.remember(parsed.url, async () => {
    const res = await get(parsed.url);
    if (res.status === 404 || res.status === 410) return undefined;
    if (!res.ok) {
      const err = new Error(`itch.io ne répond pas (${res.status}). Réessaie dans un moment.`);
      err.status = 502;
      throw err;
    }
    // Un jeu dont l'auteur a changé de pseudo redirige : c'est l'adresse
    // FINALE qui est la bonne (et celle qu'IGDB aura).
    const finalUrl = parseItchUrl(res.url)?.url || parsed.url;
    const html = await res.text();

    const idFromPage = Number(html.match(/<meta content="games\/(\d+)" name="itch:path"/)?.[1] || 0);
    let data = null;
    try {
      const r = await get(`${finalUrl}/data.json`, "application/json");
      if (r.ok) {
        const j = await r.json();
        if (!j?.errors) data = j;
      }
    } catch {
      /* la page suffit */
    }

    const itchId = Number(data?.id || idFromPage || 0);
    const name =
      decode(data?.title) ||
      decode(html.match(/<h1[^>]*class="game_title"[^>]*>([\s\S]*?)<\/h1>/)?.[1]) ||
      decode(html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]);
    if (!itchId || !name) return undefined;

    const info = infoTable(html);
    const og = (p) => html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`))?.[1];
    const fullShots = [...(html.match(/class="screenshot_list"[\s\S]*?<\/div>/)?.[0] || "").matchAll(
      /href="([^"]+)"/g
    )].map((m) => m[1]);
    const description = decode(
      html.match(/class="formatted_description user_formatted">([\s\S]*?)<\/div>/)?.[1]
    ).slice(0, 4000);

    // La date de SORTIE quand l'auteur l'a donnée, sinon celle de PUBLICATION
    // de la page — jamais « Updated », qui bouge à chaque correctif.
    const released = info["Release date"]?.date || info["Release date"]?.text || null;
    const published = info.Published?.date || null;

    const price = String(data?.price || "");
    return {
      itchId,
      url: finalUrl,
      name,
      shortDescription: decode(og("description")).slice(0, 300),
      description,
      cover: og("image") || data?.cover_image || null,
      screenshots: (fullShots.length ? fullShots : data?.screenshots || []).slice(0, 12),
      authors: (data?.authors || []).map((a) => decode(a.name)).filter(Boolean).length
        ? (data.authors || []).map((a) => decode(a.name)).filter(Boolean)
        : list(info.Author?.text || info.Authors?.text),
      tags: list(info.Tags?.text).slice(0, 20),
      genre: list(info.Genre?.text).join(", ") || null,
      platforms: list(info.Platforms?.text),
      status: list(info.Status?.text).join(", ") || null,
      releaseDate: toTimestamp(released) || toTimestamp(published),
      isFree: !price || /^\D*0(?:[.,]00)?$/.test(price),
    };
  });
}
