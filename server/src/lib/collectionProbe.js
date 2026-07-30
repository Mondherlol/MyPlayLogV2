import { detectProvider, extractVideoId, hostLabel } from "./collection.js";

// ======================================================================
//  Le vérificateur de liens — ce qui se lit encore, et ce qui est mort
// ======================================================================
// Un boîtier servi par un lecteur tiers vieillit mal : les hébergeurs de vidéo
// effacent, expirent, ferment. Six mois après avoir posé une série, la moitié
// des liens ne donne plus rien — et personne ne le sait avant qu'un spectateur
// tombe sur un cadre noir. Ce module va donc frapper à chaque porte et dit
// laquelle ne s'ouvre plus.
//
// TROIS VERDICTS, PAS DEUX. C'est tout l'enjeu : un lien qui ne répond pas
// n'est pas forcément un lien mort. Un hébergeur peut nous bloquer parce qu'on
// vient d'un datacenter (403), plier sous la charge (5xx), ou simplement ne pas
// répondre à temps — alors que la page marche très bien depuis un navigateur.
// Effacer sur ces signaux-là, ce serait vider le rayon à la première mauvaise
// journée du réseau. D'où :
//
//   • `alive`   — la page répond et ne dit nulle part que le fichier a disparu ;
//   • `dead`    — signal FRANC et seulement franc : 404/410/451, nom de domaine
//                 éteint, redirection vers l'accueil, ou un « file was deleted »
//                 écrit noir sur blanc dans la page ;
//   • `unknown` — tout le reste. Rapporté à l'admin, JAMAIS purgé.
//
// Seuls les `dead` sont retirés. C'est volontairement conservateur : un lien
// mort de trop coûte un clic sur « source suivante », un lien vivant effacé
// coûte un épisode.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const ALIVE = "alive";
export const DEAD = "dead";
export const UNKNOWN = "unknown";

const TIMEOUT_MS = 9000;
// Six requêtes en vol : de quoi sonder une série de 78 épisodes en une minute
// sans se faire prendre pour une attaque par l'hébergeur d'en face.
const POOL = 6;
// On ne lit que le début d'une page : le verdict se joue dans le titre et les
// premiers écrans, et certains « embed » renvoient une vidéo entière.
const MAX_BODY = 200 * 1024;
// Deux garde-fous, parce qu'un contrôle est une requête HTTP comme une autre et
// qu'elle doit RENDRE LA MAIN : une série de 80 épisodes à trois miroirs fait
// 240 portes, et si chacune met neuf secondes à ne pas répondre, on y passe le
// quart d'heure — le navigateur d'en face aura lâché bien avant. Passé le
// budget, ce qui n'a pas été sondé revient en « non vérifié », donc conservé,
// et l'admin relance le contrôle pour finir le travail.
const MAX_PROBES = 600;
const MAX_RUN_MS = 120000;
const UNCHECKED = "non vérifié (contrôle écourté — relance-le pour finir)";

// CE QU'UNE PAGE MORTE DIT D'ELLE-MÊME. Beaucoup d'hébergeurs répondent 200 sur
// un fichier effacé et l'écrivent dans la page : c'est le seul moyen de les
// distinguer d'un lecteur qui marche.
//
// Ces motifs ne sont cherchés que dans le TEXTE VISIBLE (voir `visibleText`) :
// le code du lecteur, lui, contient forcément « Video not found » quelque part —
// c'est le message qu'il affichera un jour. Le chercher dans le script, c'était
// déclarer mort tout lecteur qui prévoit de savoir mourir.
const DEAD_MARKERS = [
  [/\b(file|video|media)\s+(was\s+|has\s+been\s+)?(deleted|removed)\b/i, "supprimé chez l'hébergeur"],
  [/\b(video|file|media|stream)\s+not\s+found\b/i, "introuvable chez l'hébergeur"],
  [/\bno longer available\b/i, "plus disponible"],
  [/\b(this|the)\s+(video|file)\s+(is|was)\s+unavailable\b/i, "plus disponible"],
  [/\bdeleted by (the )?(owner|user|uploader|administrator)\b/i, "supprimé par son auteur"],
  [/\bpage not found\b/i, "page introuvable"],
  [/\b404\s*[-–—:]?\s*not found\b/i, "404"],
  [/n(?:'|’)est plus disponible/i, "plus disponible"],
  [/vid[ée]o\s+(supprim[ée]e?|introuvable|indisponible)/i, "vidéo supprimée"],
  [/fichier\s+(supprim[ée]|introuvable)/i, "fichier supprimé"],
  [/(cette\s+)?vid[ée]o\s+n(?:'|’)existe\s+(plus|pas)/i, "vidéo supprimée"],
];

// ---------------------------------------------------------------- outils --

// Les sources d'un épisode, dans l'ordre : la principale puis ses miroirs.
// C'est le pendant serveur de `episodeSources` côté client — même ordre, même
// repli sur `videoId` pour les épisodes d'avant les lecteurs multiples, sans
// quoi le vérificateur jugerait un autre lien que celui qu'on regarde.
//
// `synthetic` marque l'adresse RECONSTRUITE d'un épisode YouTube qui n'a qu'un
// identifiant : elle sert à sonder, mais ne doit jamais être réécrite dans la
// fiche (l'épisode y perdrait son étiquette « YouTube » pour un « youtube.com »).
export function sourcesOf(ep) {
  if (!ep) return [];
  const provider = ep.provider || (ep.videoId ? "youtube" : "embed");
  const synthetic = !ep.url && provider === "youtube" && !!ep.videoId;
  const url = ep.url || (synthetic ? `https://www.youtube.com/watch?v=${ep.videoId}` : "");
  const out = [
    {
      main: true,
      synthetic,
      provider,
      videoId: ep.videoId || (provider === "youtube" ? extractVideoId(url) : null),
      url,
      label: synthetic ? "YouTube" : hostLabel(url),
    },
  ];
  for (const m of ep.mirrors || []) {
    if (!m?.url) continue;
    // Un miroir n'est stocké qu'en (étiquette, adresse) : son lecteur se déduit
    // de l'adresse, exactement comme à la lecture de la liste collée.
    const p = detectProvider(m.url) || "embed";
    out.push({
      main: false,
      synthetic: false,
      provider: p,
      videoId: p === "youtube" ? extractVideoId(m.url) : null,
      url: m.url,
      label: m.label || hostLabel(m.url),
    });
  }
  return out;
}

async function ask(url, { method = "GET", headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "fr,en;q=0.8", ...headers },
    });
    return { res };
  } catch (err) {
    return { err };
  } finally {
    clearTimeout(timer);
  }
}

// Une panne de réseau ne vaut pas condamnation — sauf quand le nom de domaine
// lui-même n'existe plus : l'hébergeur a fermé boutique, et aucun de ses liens
// ne reviendra.
function netVerdict(err) {
  const code = err?.cause?.code || err?.code || "";
  if (err?.name === "AbortError" || /TIMEOUT/i.test(code))
    return { state: UNKNOWN, reason: `aucune réponse en ${TIMEOUT_MS / 1000} s` };
  if (code === "ENOTFOUND") return { state: DEAD, reason: "nom de domaine éteint" };
  return {
    state: UNKNOWN,
    reason: `connexion impossible${code ? ` (${String(code).toLowerCase()})` : ""}`,
  };
}

// Ce que dit le code de réponse, quand il dit quelque chose de net.
function statusVerdict(status) {
  if (status === 404 || status === 410) return { state: DEAD, reason: `disparu (${status})` };
  if (status === 451) return { state: DEAD, reason: "retiré pour raisons légales (451)" };
  if (status === 403 || status === 429)
    return { state: UNKNOWN, reason: `l'hébergeur nous a bloqués (${status})` };
  if (status >= 500) return { state: UNKNOWN, reason: `panne côté hébergeur (${status})` };
  if (status >= 400) return { state: UNKNOWN, reason: `réponse ${status}` };
  return null;
}

// LE LIEN MENAIT QUELQUE PART, ON ARRIVE À L'ACCUEIL. C'est la façon la plus
// répandue de dire « ça n'existe plus » chez les hébergeurs de vidéo : pas de
// 404, une redirection vers la page d'accueil.
function landedHome(asked, landed) {
  try {
    const a = new URL(asked);
    const b = new URL(landed || asked);
    const from = a.pathname.replace(/\/+$/, "");
    const to = b.pathname.replace(/\/+$/, "");
    return from.length > 1 && to === "" && !b.search;
  } catch {
    return false;
  }
}

// Le texte QU'UN HUMAIN VERRAIT : sans les scripts (où vivent les messages
// d'erreur que le lecteur n'a pas affichés) ni les styles.
function visibleText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

// Le début du corps, et rien de plus : certains « embed » sont en fait le flux
// vidéo lui-même, qu'on ne va pas télécharger pour le juger.
async function readSome(res) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text().catch(() => "");
    return text.slice(0, MAX_BODY);
  }
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    /* flux coupé en route : on juge sur ce qu'on a reçu */
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

// --------------------------------------------------------------- sondes --

// YouTube répond pour nous : oEmbed ne connaît que les vidéos encore en ligne
// et publiques. 404 = supprimée, 401 = passée en privé.
async function probeYoutube(videoId) {
  const { res, err } = await ask(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`
  );
  if (err) return netVerdict(err);
  if (res.ok) return { state: ALIVE, reason: "" };
  if (res.status === 404) return { state: DEAD, reason: "vidéo supprimée" };
  if (res.status === 401) return { state: DEAD, reason: "vidéo passée en privé" };
  if (res.status === 400) return { state: DEAD, reason: "identifiant refusé par YouTube" };
  return { state: UNKNOWN, reason: `YouTube a répondu ${res.status}` };
}

async function probeFile(url) {
  // Un HEAD suffit à savoir si le fichier est là, et ne coûte pas un octet de
  // vidéo. Beaucoup d'hébergeurs ne le servent pas : on retente alors en GET,
  // en ne réclamant que les deux premiers octets.
  let { res, err } = await ask(url, { method: "HEAD" });
  if (err || res.status === 405 || res.status === 501 || res.status === 400)
    ({ res, err } = await ask(url, { method: "GET", headers: { Range: "bytes=0-1" } }));
  if (err) return netVerdict(err);
  const verdict = statusVerdict(res.status);
  if (verdict) return verdict;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  // Un .mp4 qui répond du HTML n'est pas une vidéo : c'est la page d'erreur de
  // l'hébergeur, servie en 200 pour faire bonne figure.
  if (type.startsWith("text/html"))
    return { state: DEAD, reason: "page d'erreur au lieu de la vidéo" };
  return { state: ALIVE, reason: "" };
}

async function probeEmbed(url) {
  let referer = "";
  try {
    referer = new URL(url).origin;
  } catch {
    return { state: DEAD, reason: "adresse illisible" };
  }
  const { res, err } = await ask(url, { headers: { Referer: referer } });
  if (err) return netVerdict(err);
  const verdict = statusVerdict(res.status);
  if (verdict) return verdict;
  if (landedHome(url, res.url))
    return { state: DEAD, reason: "renvoyé vers l'accueil de l'hébergeur" };

  const type = (res.headers.get("content-type") || "").toLowerCase();
  // Ce n'est pas une page : c'est déjà l'image ou le flux. Rien à lire.
  if (type && !/(text\/html|application\/xhtml|text\/plain)/.test(type))
    return { state: ALIVE, reason: "" };

  const html = await readSome(res);
  const title = (html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1] || "").trim();
  const text = `${title} ${visibleText(html)}`;
  for (const [re, reason] of DEAD_MARKERS) if (re.test(text)) return { state: DEAD, reason };
  return { state: ALIVE, reason: "" };
}

export async function probeSource(src) {
  if (src.provider === "youtube") {
    const id = src.videoId || extractVideoId(src.url);
    if (!id) return { state: DEAD, reason: "identifiant YouTube illisible" };
    return probeYoutube(id);
  }
  if (!src.url) return { state: DEAD, reason: "aucun lien" };
  return src.provider === "file" ? probeFile(src.url) : probeEmbed(src.url);
}

// ------------------------------------------------------------ le passage --

// Un petit ordonnanceur : `n` tâches en vol, pas une de plus.
async function pool(items, n, fn) {
  let at = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (at < items.length) {
      const item = items[at++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

const keyOf = (at, src) => `${at}|${src.url}`;

// Sonde toutes les sources d'une liste d'épisodes et rend un COMPTE RENDU —
// rien n'est modifié ici. La purge, elle, est un second geste (voir
// `purgeEpisodes`), parce qu'un admin doit pouvoir lire ce qu'il s'apprête à
// perdre avant de le perdre.
export async function checkEpisodes(episodes = []) {
  const jobs = [];
  episodes.forEach((ep, at) => {
    for (const src of sourcesOf(ep)) jobs.push({ at, src });
  });

  const verdicts = new Map();
  // Le même lien peut servir deux épisodes (ou être le miroir de son propre
  // principal) : on ne le sonde qu'une fois. La PROMESSE est mise en cache, pas
  // son résultat — sinon deux sondes parallèles partiraient quand même.
  const seen = new Map();
  const deadline = Date.now() + MAX_RUN_MS;
  await pool(jobs.slice(0, MAX_PROBES), POOL, async ({ at, src }) => {
    if (Date.now() > deadline) return; // budget épuisé : le reste sera « non vérifié »
    const cacheKey = src.provider === "youtube" ? `yt:${src.videoId || src.url}` : src.url;
    if (!seen.has(cacheKey)) seen.set(cacheKey, probeSource(src));
    verdicts.set(keyOf(at, src), await seen.get(cacheKey));
  });

  const counts = { [ALIVE]: 0, [DEAD]: 0, [UNKNOWN]: 0 };
  const problems = [];
  const doomed = [];

  episodes.forEach((ep, at) => {
    const sources = sourcesOf(ep).map((src) => {
      const v = verdicts.get(keyOf(at, src)) || { state: UNKNOWN, reason: UNCHECKED };
      counts[v.state] = (counts[v.state] || 0) + 1;
      return {
        url: src.url,
        host: src.label || hostLabel(src.url) || "source",
        provider: src.provider,
        main: src.main,
        state: v.state,
        reason: v.reason,
      };
    });
    const left = sources.filter((s) => s.state !== DEAD).length;
    const card = {
      index: at,
      season: ep.season || 1,
      number: ep.number ?? at + 1,
      title: ep.title || "",
      sources,
      left,
    };
    // On ne remonte que ce qui cloche : une série saine tiendrait autrement en
    // deux cents lignes d'« tout va bien ».
    if (!left || sources.some((s) => s.state !== ALIVE)) problems.push(card);
    if (!left) doomed.push({ index: at, season: card.season, number: card.number, title: card.title });
  });

  return {
    at: new Date().toISOString(),
    total: jobs.length,
    checked: verdicts.size,
    alive: counts[ALIVE] || 0,
    dead: counts[DEAD] || 0,
    unknown: counts[UNKNOWN] || 0,
    episodes: problems,
    doomed,
  };
}

// ------------------------------------------------------------- la purge --

// Applique un compte rendu : les sources `dead` s'en vont, un miroir survivant
// prend la place du lecteur principal, et un épisode qui n'a plus AUCUNE source
// quitte la liste — il ne se regarde plus, le laisser ne ferait qu'un boîtier
// qui promet ce qu'il ne peut pas tenir.
//
// `kept` rend les index d'origine des épisodes conservés : c'est ce qui permet
// de faire suivre la progression des joueurs (voir la route), puisque leurs
// coches désignent des POSITIONS dans la liste.
export function purgeEpisodes(episodes = [], report) {
  const dead = new Set();
  for (const ep of report?.episodes || [])
    for (const s of ep.sources || []) if (s.state === DEAD) dead.add(`${ep.index}|${s.url}`);

  const kept = [];
  const out = [];
  let removedSources = 0;

  episodes.forEach((ep, at) => {
    const live = sourcesOf(ep).filter((src) => {
      const gone = dead.has(keyOf(at, src));
      if (gone) removedSources++;
      return !gone;
    });
    if (!live.length) return; // plus rien pour le lire : l'épisode s'en va
    const [main, ...mirrors] = live;
    const base = typeof ep.toObject === "function" ? ep.toObject() : { ...ep };
    kept.push(at);
    out.push({
      ...base,
      index: out.length,
      provider: main.provider,
      videoId: main.provider === "youtube" ? main.videoId : null,
      // L'adresse reconstruite d'un épisode YouTube ne s'écrit pas dans la
      // fiche : elle n'a jamais existé ailleurs qu'ici, le temps de la sonde.
      url: main.synthetic ? "" : main.url,
      mirrors: mirrors.map((m) => ({ label: m.label || hostLabel(m.url), url: m.url })),
    });
  });

  return {
    episodes: out,
    kept,
    removedSources,
    removedEpisodes: episodes.length - out.length,
  };
}
