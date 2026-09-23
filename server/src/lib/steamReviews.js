// ======================================================================
//  Les avis Steam d'un joueur, lus sur son profil communautaire
// ======================================================================
//
// ⚠️ VALVE N'EXPOSE PAS LES AVIS D'UN JOUEUR. La Web API sait tout dire de sa
// bibliothèque et de ses succès, rien de ses avis : il n'existe aucun endpoint
// pour « les recommandations écrites par ce SteamID ». La seule source est la
// page publique du profil, `steamcommunity.com/<profil>/recommended/`, qu'on
// lit donc au format HTML.
//
// Conséquences, tenues ici :
//   • ON NE PROPOSE JAMAIS DE PUBLIER TOUT SEUL. Ce qui sort d'ici est une
//     LISTE À COCHER : l'utilisateur relit chaque avis, choisit ceux qu'il
//     reprend, et rien n'est écrit sans lui. Un scraping ne mérite pas plus
//     de confiance que ça.
//   • On force `l=english` : le libellé « Recommended / Not Recommended » est
//     traduit dans la langue du visiteur, et c'est lui qui nous dit le pouce.
//   • Un profil privé, ou une page dont le gabarit a changé, rend une liste
//     vide — jamais une erreur bruyante : l'import des avis est un bonus.

import * as cheerio from "cheerio";

const BASE = "https://steamcommunity.com";
const MAX_PAGES = 4; // ~40 avis : au-delà, personne ne relit sa liste.

async function getHtml(url) {
  const res = await fetch(url, {
    headers: {
      // Sans en-tête de navigateur, la communauté Steam sert une page vide.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) return null;
  return res.text();
}

// L'appid d'un avis : il apparaît soit dans le lien de l'avis lui-même
// (`/recommended/440/`), soit dans la capsule du jeu (`/app/440`).
function appIdIn($box) {
  const hrefs = $box
    .find("a[href]")
    .map((_, a) => a.attribs.href || "")
    .get();
  for (const h of hrefs) {
    const m = h.match(/\/recommended\/(\d+)/) || h.match(/\/app\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

// « 12.3 hrs on record » → 12.3. Steam sépare les milliers par une virgule.
function hoursIn(text) {
  const m = String(text || "").match(/([\d.,]+)\s*hrs/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// « Posted: 12 March » / « Posted: 3 January, 2023 » → une date, ou null.
function postedIn(text) {
  const m = String(text || "").match(/Posted:\s*([^\n]+)/i);
  if (!m) return null;
  const raw = m[1].split("Last edited")[0].trim();
  const d = new Date(/\d{4}/.test(raw) ? raw : `${raw}, ${new Date().getFullYear()}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Les avis publics écrits par ce SteamID64.
 *
 * Renvoie `[{ appid, gameName, recommended, hours, text, postedAt }]`, du plus
 * récent au plus ancien. Liste vide si le profil est privé ou sans avis.
 */
export async function fetchUserReviews(steamId) {
  const out = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await getHtml(
      `${BASE}/profiles/${steamId}/recommended/?l=english&p=${page}`
    ).catch(() => null);
    if (!html) break;

    const $ = cheerio.load(html);
    const boxes = $(".review_box");
    if (!boxes.length) break;

    boxes.each((_, el) => {
      const $box = $(el);
      const appid = appIdIn($box);
      if (!appid || seen.has(appid)) return; // un seul avis par jeu, le plus récent
      const text = $box.find(".content").first().text().trim();
      if (!text) return; // une note « recommandé » sans texte n'est pas un avis

      const title = $box.find(".title").first().text().trim();
      seen.add(appid);
      out.push({
        appid,
        gameName: $box.find(".game_capsule").attr("alt")?.trim() || null,
        // Le titre dit « Recommended » ou « Not Recommended » : on lit la
        // négation, pas le mot, sans quoi les deux contiennent « Recommended ».
        recommended: !/not\s+recommended/i.test(title),
        hours: hoursIn($box.find(".hours").first().text()),
        text,
        postedAt: postedIn($box.find(".posted").first().text()),
      });
    });

    // Dernière page : Steam sert moins d'avis que la pleine page (10).
    if (boxes.length < 10) break;
  }

  return out;
}
