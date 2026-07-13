// Scraper nxbrew.net — patchs de traduction FR pour jeux Nintendo Switch.
// Beaucoup de jeux traduits en FR sur PC ne le sont pas sur Switch (ou le sont
// avec une trad censurée) : ce site héberge les patchs FR d'origine. Portage
// fidèle du scraper Python (get_patch_details / search) avec cheerio.
//
// Convention de retour, pour distinguer « site injoignable » de « rien trouvé » :
//   - `undefined` : impossible de joindre le site (on NE met PAS en cache → on
//                   réessaiera au prochain appel, utile tant que le site est down)
//   - `null`      : site joignable mais aucun patch exploitable (mise en cache)
//   - objet       : patch trouvé

import * as cheerio from "cheerio";

const BASE = "https://nxbrew.net";
const HOSTS = ["DataNodes", "1Fichier", "MultiUp"];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Récupère le HTML d'une page. Renvoie null si injoignable (réseau / statut ≠ 200).
// Logs de diagnostic : sur le VPS, nxbrew.net (derrière Cloudflare) répond
// probablement 403/503 aux IP de datacenter alors qu'il renvoie 200 en local
// (IP résidentielle). Ces logs confirment le status exact côté serveur.
async function getHtml(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      console.warn(
        `[nxbrew] HTTP ${r.status} (${r.statusText || "?"}) en ${Date.now() - t0}ms · cf-ray=${
          r.headers.get("cf-ray") || "-"
        } server=${r.headers.get("server") || "-"} → ${url}`
      );
      return null;
    }
    return await r.text();
  } catch (e) {
    console.warn(`[nxbrew] fetch échoué en ${Date.now() - t0}ms: ${e.message} → ${url}`);
    return null;
  }
}

// Recherche des patchs FR. Renvoie null si le site est injoignable, sinon la
// liste (éventuellement vide) des résultats [{ title, link }].
export async function searchnxbrewPatches(query) {
  const url = `${BASE}/?s=${encodeURIComponent(query).replace(/%20/g, "+")}`;
  const html = await getHtml(url);
  if (html === null) return null; // injoignable
  const $ = cheerio.load(html);
  const results = [];
  $("article").each((_, art) => {
    const titleTag = $(art).find("h2.post-title").first();
    if (!titleTag.length) return;
    const title = titleTag.text().trim();
    const linkTag = titleTag.find("a").first();
    if (!linkTag.length) return;
    let link = linkTag.attr("href");
    if (!link) return;
    if (!/^https?:\/\//.test(link)) link = new URL(link, BASE).href;
    results.push({ title, link });
  });
  return results;
}

// Détaille un patch : sépare BASE / UPDATE / DLC avec leurs liens par hébergeur.
// Renvoie null si la page est injoignable.
export async function getPatchDetails(patchUrl) {
  const html = await getHtml(patchUrl);
  if (html === null) return null;
  const $ = cheerio.load(html);

  // --- 1. Taille du titre ---
  let size = "N/A";
  $("strong").each((_, el) => {
    if (size !== "N/A") return;
    if ($(el).text().trim() === "Title Size:") {
      const m = $(el).closest("p").text().match(/Title Size:\s*([\d.]+)\s*(MB|GB)/i);
      if (m) size = `${m[1]} ${m[2]}`;
    }
  });
  if (size === "N/A") {
    const mt = $("div.wp-block-media-text").first();
    if (mt.length) {
      const m = mt.text().match(/Title Size:\s*([\d.]+)\s*(MB|GB)/i);
      if (m) size = `${m[1]} ${m[2]}`;
    }
  }

  const entry = $("div.entry").first();
  if (!entry.length) return { size, base: {}, update: {}, dlc: {}, updateVersion: "" };

  const base = {};
  const update = {};
  const dlc = {};
  let updateVersion = "";

  entry.find("div.wp-block-columns").each((_, colBlock) => {
    const $cb = $(colBlock);
    const blockText = $cb.text();

    const isBase = blockText.includes("Base Game");
    const isUpdate = blockText.includes("Update") && !isBase;
    const isDlc = blockText.includes("DLC") && !isBase && !isUpdate;
    if (!(isBase || isUpdate || isDlc)) return;

    if (isUpdate) {
      const strong = $cb.find("div.wp-block-column").first().find("strong").first();
      if (strong.length) updateVersion = strong.text().trim().replace(/^Update\s+/, "");
    }

    const columns = $cb.find("div.wp-block-column");
    if (columns.length < 2) return;
    const linksColumn = $(columns[1]);

    const sectionData = {};

    // Extraction des liens (hébergeur en <strong>, ou hébergeur = texte du <a>)
    linksColumn.find("p").each((_, p) => {
      const $p = $(p);
      const strong = $p.find("strong").first();
      if (strong.length) {
        const host = strong.text().trim();
        if (HOSTS.includes(host)) {
          const links = [];
          $p.find("a[href]").each((_, a) => {
            const href = $(a).attr("href");
            if (href && href.startsWith("http") && href.includes("ouo.io")) links.push(href);
          });
          if (links.length) sectionData[host] = links;
        }
      } else {
        $p.find("a[href]").each((_, a) => {
          const host = $(a).text().trim();
          const href = $(a).attr("href");
          if (HOSTS.includes(host) && href && href.startsWith("http") && href.includes("ouo.io")) {
            if (!sectionData[host]) sectionData[host] = [];
            if (!sectionData[host].includes(href)) sectionData[host].push(href);
          }
        });
      }
    });

    // Méthode fallback (aucun hébergeur nommé identifié)
    if (Object.keys(sectionData).length === 0) {
      const allLinks = linksColumn.find("a[href]").toArray();
      if (allLinks.length) {
        if (allLinks.length >= 3) {
          HOSTS.forEach((host, i) => {
            if (i < allLinks.length) {
              const href = $(allLinks[i]).attr("href");
              if (href && href.startsWith("http") && href.includes("ouo.io")) sectionData[host] = [href];
            }
          });
        } else {
          allLinks.forEach((a, i) => {
            const href = $(a).attr("href");
            if (href && href.startsWith("http") && href.includes("ouo.io")) {
              sectionData[`Part ${i + 1}`] = [href];
            }
          });
        }
      }
    }

    if (isBase) Object.assign(base, sectionData);
    else if (isUpdate) Object.assign(update, sectionData);
    else if (isDlc) {
      let dlcName = "DLC";
      const strong = $cb.find("div.wp-block-column").first().find("strong").first();
      if (strong.length) dlcName = strong.text().trim();
      dlc[dlcName] = sectionData;
    }
  });

  return { size, base, update, dlc, updateVersion };
}

// Normalisation d'un nom pour la comparaison tolérante (casse, accents,
// ponctuation, et parties entre crochets type « [Patch FR] »).
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

// Choisit le résultat de recherche qui correspond vraiment au jeu, pour éviter
// d'attraper un patch voisin (autre épisode d'une série, faux positif).
function pickBestMatch(results, name) {
  const target = norm(name);
  if (!target) return null;
  const exact = results.find((r) => norm(r.title) === target);
  if (exact) return exact;
  return (
    results.find((r) => {
      const t = norm(r.title);
      return t.length >= 6 && (t.includes(target) || target.includes(t));
    }) || null
  );
}

// { host: [links] } -> [{ host, links }]
function hostsToArr(dict) {
  return Object.entries(dict)
    .filter(([, links]) => links?.length)
    .map(([host, links]) => ({ host, links }));
}

// Met les détails scrappés en forme prête pour le front (sections ordonnées).
function normalizePatch(best, d) {
  const sections = [];
  if (Object.keys(d.base).length) {
    sections.push({ kind: "base", label: "Jeu de base", hosts: hostsToArr(d.base) });
  }
  if (Object.keys(d.update).length) {
    sections.push({
      kind: "update",
      label: d.updateVersion ? `Mise à jour (v${d.updateVersion})` : "Mise à jour",
      hosts: hostsToArr(d.update),
    });
  }
  for (const [dlcName, hosts] of Object.entries(d.dlc)) {
    if (Object.keys(hosts).length) {
      sections.push({ kind: "dlc", label: dlcName, hosts: hostsToArr(hosts) });
    }
  }
  // On ne garde que les sections qui ont au moins un lien exploitable.
  const usable = sections.filter((s) => s.hosts.length);
  if (!usable.length) return null;
  return {
    title: best.title,
    pageUrl: best.link,
    size: d.size && d.size !== "N/A" ? d.size : null,
    updateVersion: d.updateVersion || null,
    sections: usable,
  };
}

// Point d'entrée : cherche le patch FR Switch d'un jeu par son nom.
//   undefined = site injoignable · null = rien trouvé · objet = patch
export async function fetchSwitchFrPatch(name) {
  const results = await searchnxbrewPatches(name);
  if (results === null) return undefined; // site injoignable
  if (!results.length) return null;
  const best = pickBestMatch(results, name);
  if (!best) return null;
  const details = await getPatchDetails(best.link);
  if (details === null) return undefined; // page injoignable
  return normalizePatch(best, details);
}
