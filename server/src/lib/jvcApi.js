// ======================================================================
//  L'API de jeuxvideo.com (v4)
// ======================================================================
// jeuxvideo.com renvoie 403 à tout serveur qui vient lire ses pages : leur
// anti-bot filtre les IP de datacenter, et aucun en-tête de navigateur n'y
// change rien. MAIS le site a une API — celle de son application Android — et
// elle, elle répond. C'est donc du JSON propre et stable qu'on lit, pas du HTML
// scrapé qui casserait à la première refonte.
//
// Elle n'est pas documentée officiellement : la clé partenaire, le secret HMAC
// et la façon de signer viennent de la rétro-ingénierie de l'application,
// publiée sur JVFlux (« Documentation de l'API Jeuxvideo.com ») et utilisée par
// la librairie JVClient. On ne lit ici que des données publiques — les notes
// des lecteurs, affichées sur chaque fiche du site — et une seule fois par jeu
// (cf. la règle de fraîcheur de gameScores.js).
//
// ⚠️ SIGNATURE : LES ESPACES SE CODENT EN %20, PAS EN « + ». La chaîne signée
// doit être exactement celle de l'URL envoyée. Avec `+`, l'API répond
// « Signature invalide » — c'est le seul piège de tout ce fichier.
import crypto from "node:crypto";

const PARTNER_KEY = "550c04bf5cb2b";
const HMAC_SECRET = "d84e9e5f191ea4ffc39c22d11c77dd6c";
const DOMAIN = "api.jeuxvideo.com";
const VERSION = 4;

// Encodage strict RFC 3986. `encodeURIComponent` laisse passer ! ' ( ) * ,
// que l'application, elle, encode : une apostrophe non codée (« Baldur's Gate »)
// suffit à faire répondre « Signature invalide ».
const enc = (v) =>
  encodeURIComponent(String(v)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );

// Les query strings sont triées par clé : c'est la chaîne que la signature couvre.
function queryString(query) {
  if (!query) return "";
  return Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
}

function authorization(path, qs, method = "GET") {
  // Format `isoformat()` de Python : sans le « Z » final.
  const date = new Date().toISOString().replace("Z", "");
  const parts = [PARTNER_KEY, date, method, DOMAIN, `/v${VERSION}/${path}`];
  // Sans query, la dernière ligne porte tout de même son saut de ligne — c'est
  // ce que fait l'application, et l'API le vérifie.
  if (qs) parts.push(qs);
  else parts[parts.length - 1] += "\n";
  const signature = crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(parts.join("\n"), "utf8")
    .digest("hex");
  return `PartnerKey=${PARTNER_KEY}, Signature=${signature}, Timestamp=${date}`;
}

async function jvcGet(path, query = null) {
  const qs = queryString(query);
  const res = await fetch(`https://${DOMAIN}/v${VERSION}/${path}${qs ? `?${qs}` : ""}`, {
    headers: {
      "Jvc-Authorization": authorization(path, qs),
      "Content-Type": "application/json",
      "jvc-app-platform": "Android",
      "jvc-app-version": "338",
      "user-agent": "JeuxVideo-Android/338",
    },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Deux titres se ressemblent-ils ? On compare des formes nues : sans accents ni
// ponctuation, et les chiffres romains ramenés en chiffres arabes — JVC écrit
// « Baldur's Gate III » là où IGDB écrit « Baldur's Gate 3 ».
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

function normalize(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (ROMAN[w] ? String(ROMAN[w]) : w))
    .join(" ");
}

/**
 * Le jeu de JVC qui correspond le mieux à un titre.
 *
 * La recherche renvoie aussi les DLC et les suites (« Shadow of the Erdtree »
 * quand on cherche « Elden Ring ») : on préfère donc, dans l'ordre, un titre
 * identique, puis un titre identique sorti la bonne année, puis à défaut le
 * premier résultat — mais seulement s'il commence par ce qu'on cherchait.
 */
function bestMatch(items, name, year) {
  const target = normalize(name);
  const scored = (items || []).map((it) => {
    const t = normalize(it.title);
    const sameYear =
      year && it.releaseDate ? String(it.releaseDate).includes(String(year)) : false;
    let score = 0;
    if (t === target) score += 10;
    else if (t.startsWith(target)) score += 4;
    else if (t.includes(target)) score += 2;
    if (sameYear) score += 3;
    return { it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= 2 ? best.it : null;
}

/**
 * La note des lecteurs de jeuxvideo.com pour un jeu, sur 20.
 *
 * ⚠️ C'EST LA NOTE DES LECTEURS, PAS CELLE DE LA RÉDACTION. L'API donne la
 * première sur la fiche du jeu ; la seconde vit dans l'article de test, qui
 * n'est rattaché au jeu par aucun champ exploitable — la deviner en cherchant
 * l'article par son titre donnerait parfois le test d'un autre jeu, et une note
 * fausse vaut moins que pas de note.
 *
 * Le site note PAR MACHINE : on rend la moyenne de toutes, pondérée par le
 * nombre d'avis de chacune (voir plus bas), et ce nombre total d'avis.
 */
export async function jvcGameScore({ name, year }) {
  if (!name) return null;

  const found = await jvcGet("search/games", { q: name, page: 1, perPage: 10 });
  const game = bestMatch(found?.items, name, year);
  if (!game?.id) return null;

  const reviews = await jvcGet(`games/${game.id}/any/reviews`);
  const perMachine = (reviews?.items || [])
    .map((r) => ({
      machine: r.machine,
      mark: r.userReviewAverageDecimal ?? r.userReviewAverage,
    }))
    .filter((r) => typeof r.mark === "number" && r.mark > 0 && r.machine != null);
  if (!perMachine.length) return null;

  // Le site note PAR MACHINE (17,1 sur PS5, 14,8 sur PS4…). On va chercher le
  // nombre d'avis de chacune — en parallèle, une page d'un seul élément suffit
  // puisqu'on ne veut que le total — pour pondérer la moyenne : sans ça, une
  // machine à trois votants pèserait autant que celle qui en a quatre cents.
  const counts = await Promise.all(
    perMachine.map((r) =>
      jvcGet(`games/${game.id}/${r.machine}/reviews/users`, { page: 1, perPage: 1 })
        .then((d) => d?.paging?.totalItemCount || 0)
        .catch(() => 0)
    )
  );
  const total = counts.reduce((s, n) => s + n, 0);
  const avg = total
    ? perMachine.reduce((s, r, i) => s + r.mark * counts[i], 0) / total
    : perMachine.reduce((s, r) => s + r.mark, 0) / perMachine.length;
  const count = total || null;

  return {
    score: Math.round(avg * 10) / 10,
    max: 20,
    count,
    url: `https://www.jeuxvideo.com/jeux/jeu-${game.id}/`,
  };
}
