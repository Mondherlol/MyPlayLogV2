import { BlockedError, CHALLENGE_RE } from "./animeSama.js";

// ======================================================================
//  Lecture d'une fiche de FILM — un répertoire de lecteurs
// ======================================================================
// Même geste que l'import anime-sama, et pour la même raison : ces sites
// n'hébergent aucune vidéo, ils ALIGNENT DES LECTEURS TIERS. Une fiche de film
// n'a pas de saisons ni d'épisodes — elle a un seul programme et cinq boutons
// (Uqload, Voe, Dood…), qui sont exactement ce que notre poste appelle des
// MIROIRS. L'import consiste donc à retrouver ces adresses et à les poser sur
// une seule ligne, prête à être relue dans le panneau d'admin.
//
// RIEN N'EST TÉLÉCHARGÉ NI REHÉBERGÉ. La sortie est du texte ; c'est l'admin
// qui relit, corrige et enregistre. L'import fait la frappe, pas le choix.
//
// ON NE CONNAÎT PAS LES SITES, ON RECONNAÎT LES LECTEURS. Écrire un lecteur par
// site (french-stream, puis le suivant, puis celui d'après) aurait tenu jusqu'au
// premier changement de gabarit. On ratisse donc TOUT le document — attributs,
// iframes, et jusqu'au contenu des scripts — à la recherche de ce qui a la forme
// d'une adresse d'hébergeur vidéo, et on écarte le reste (images, polices,
// régies publicitaires, liens de téléchargement). Un intrus qui passe est une
// ligne à effacer dans la zone de texte ; un lecteur manqué se rattrape à la
// main. Les métadonnées suivent le même principe : plusieurs ancres possibles,
// et ce qui manque restera vide.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT = 12000;

// --------------------------------------------------- tri des adresses --

// Ce qui n'est JAMAIS un lecteur, même quand la forme y ressemble.
//
// YouTube en fait partie, et ce n'est pas une évidence : sur ces fiches, une
// vidéo YouTube est la BANDE-ANNONCE, pas le film. Un film réellement servi par
// YouTube s'ajoute par l'autre mode du panneau, qui sait le piloter.
// Les hébergeurs de FICHIERS (1fichier, mega…) sont écartés pour la raison
// inverse : ce sont des liens de téléchargement, pas des lecteurs — les fiches
// en alignent des dizaines dans leur bloc « releases ».
const DENY_RE =
  /(?:^|\.)(?:google|gstatic|googleapis|googletagmanager|googlesyndication|doubleclick|youtube|youtu\.be|ytimg|facebook|fbcdn|twitter|x\.com|instagram|tiktok|pinterest|reddit|telegram|t\.me|whatsapp|vk\.com|disqus|gravatar|cloudflare|cloudflareinsights|jsdelivr|unpkg|bootstrapcdn|fontawesome|jquery|tmdb\.org|themoviedb\.org|imdb\.com|allocine|wikipedia|w3\.org|schema\.org|paypal|histats|statcounter|yandex|bing|adservice|popads|propellerads|exoclick|juicyads|1fichier|uptobox|mega\.nz|rapidgator|turbobit|nitroflare|mediafire|1dl\.net|uploady|fikper|katfile)\./i;

// Fichiers qui ne sont pas des pages : inutile de les proposer comme lecteur.
const ASSET_RE =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|json|xml|txt|woff2?|ttf|eot|zip|rar|pdf)(?:$|[?#])/i;

// Une vidéo servie telle quelle : c'est un lecteur « fichier », lu par la
// balise <video> du poste.
const FILE_RE = /\.(?:mp4|m4v|webm|mkv|m3u8|mpd)(?:$|[?#])/i;

// La forme d'une page de lecteur. Deux familles, et la distinction compte :
//
//   • les mots longs (embed, player, watch…) se cherchent N'IMPORTE OÙ dans le
//     chemin — « /dood/newPlayer.php?id=… » est un lecteur, et exiger que le
//     mot commence le segment le laissait passer à travers ;
//   • les mots d'UNE LETTRE (/e/, /v/, /d/) doivent, eux, être un segment
//     entier suivi d'un identifiant : sans cette exigence, la moitié des
//     adresses du web ressemblerait à un lecteur.
const EMBED_WORD_RE = /(?:embed|player|watch|stream|iframe|video|getlink|hls)/i;
const EMBED_SHORT_RE = /(?:^|\/)[evdfp]\/[\w-]{4,}/i;

// Les hébergeurs qu'on sait reconnaître de nom. Cette liste ne SÉLECTIONNE pas
// (la forme de l'adresse suffit le plus souvent) : elle repêche ceux dont
// l'adresse ne ressemble à rien de standard.
const KNOWN_RE =
  /(?:^|\.)(?:uqload|vidzy|dood|d0o0d|doodstream|voe|netu|waaw|hqq|vidmoly|streamtape|streamsb|mixdrop|filemoon|luluvdo|lulustream|streamwish|vidhide|hglink|bigwarp|sibnet|upstream|vidoza|fembed|vudeo|savefiles|filelions|turbovid|vidsrc|frembed|smoothpre|movearnpre|listeamed|abcvideo|flaswish|swishsrv|streamvid|megamax|dhtpre|vinovo|okru|ok\.ru|dailymotion|archive\.org)\./i;

const clean = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
    // Une adresse ramassée dans du script traîne souvent une virgule, un point
    // ou une parenthèse de fin de ligne.
    .replace(/[),;'"`\\]+$/, "");

const strip = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/\s{2,}/g, " ")
    .trim();

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

function isPlayerUrl(raw, pageHost) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!host.includes(".")) return false;
  // Le site lui-même n'est pas un lecteur : ses propres pages, ses images, ses
  // scripts et ses bandeaux internes sortent d'un coup.
  if (pageHost && (host === pageHost || host.endsWith(`.${pageHost}`))) return false;
  if (DENY_RE.test(`.${host}`)) return false;
  if (ASSET_RE.test(u.pathname)) return false;
  if (KNOWN_RE.test(`.${host}`)) return true;
  if (FILE_RE.test(u.pathname)) return true;
  const path = u.pathname + u.search;
  return EMBED_WORD_RE.test(path) || EMBED_SHORT_RE.test(path);
}

// Les attributs où dort une adresse de lecteur. `src` pour l'iframe montée,
// les `data-*` pour les lecteurs que le site n'allume qu'au clic.
const ATTR_RE =
  /\b(?:src|data-src|data-url|data-link|data-embed|data-player|data-player-url|data-file|data-video|data-frame|data-iframe)\s*=\s*["']([^"']+)["']/gi;

// Et tout le reste : une adresse écrite dans un script, un tableau JSON, un
// attribut qu'on n'a pas prévu. C'est le filet de sécurité — d'où le tri sévère
// qui suit.
const RAW_RE = /https?:\/\/[^\s"'`<>()\\]{14,}/gi;

// Les lecteurs ANNONCÉS par la page : « ViDZY, Uqload, Dood, Voe, Netu ». Ces
// noms n'ont pas d'adresse à eux — ils servent à nommer ce qu'on a trouvé, et
// surtout à DIRE CE QUI MANQUE quand le site va chercher ses lecteurs à la
// volée (l'admin sait alors qu'il en manque, plutôt que de croire le film
// complet avec une seule source).
function announcedPlayers(html) {
  const names = new Set();
  for (const m of html.matchAll(/data-player\s*=\s*["']([^"'/]{2,24})["']/gi))
    names.add(strip(m[1]));
  const block = html.match(/id=["']player-options["'][\s\S]{0,6000}?<\/div>/i)?.[0];
  if (block)
    for (const m of block.matchAll(/>([^<>{}]{2,24})<\/(?:button|a|li|span)>/gi)) {
      const name = strip(m[1]);
      if (name && !/^\d+$/.test(name)) names.add(name);
    }
  return [...names].filter(Boolean).slice(0, 20);
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Le nom du bouton quand il correspond à l'hôte (« Uqload » ↔ uqload.is), le
// nom d'hôte sinon : mieux vaut « vidmoly.to » qu'une étiquette inventée.
function labelFor(host, announced) {
  const h = norm(host);
  const hit = announced.find((n) => {
    const k = norm(n);
    return k.length >= 3 && h.includes(k);
  });
  return hit || host;
}

// Combien de lecteurs on garde. Un film en aligne cinq ou six ; au-delà, c'est
// le ratissage qui a mordu sur autre chose. La borne PAR HÉBERGEUR existe pour
// le cas inverse : deux lecteurs différents passent parfois par le même relais
// (un site qui proxifie Dood et Voe sous son propre nom de domaine), donc on ne
// peut pas se contenter d'un par hôte.
const MAX_PER_HOST = 3;
const MAX_PLAYERS = 12;

// Toutes les adresses de lecteur du document, dans l'ordre où elles y
// apparaissent.
export function harvestPlayers(html, { pageUrl = "", extraNames = [] } = {}) {
  const pageHost = hostOf(pageUrl);
  const announced = [...new Set([...announcedPlayers(html), ...extraNames])];
  const found = [];
  const seen = new Set();

  const take = (raw) => {
    const url = clean(raw);
    if (seen.has(url) || !isPlayerUrl(url, pageHost)) return;
    seen.add(url);
    found.push({ url, host: hostOf(url), label: "" });
  };

  // Les attributs d'abord : ce sont les adresses posées EXPRÈS pour un lecteur,
  // donc les plus sûres. Le ratissage brut ne fait que compléter.
  for (const m of html.matchAll(ATTR_RE)) take(m[1]);
  for (const m of html.matchAll(RAW_RE)) take(m[0]);

  const players = capPlayers(found).map((p) => ({
    ...p,
    label: labelFor(p.host, announced),
  }));
  return { players, announced, missing: missingFrom(announced, players) };
}

// Le JSON nommé passe DEVANT le ratissage : mêmes adresses le plus souvent,
// mais avec la bonne étiquette. Le ratissage n'apporte plus que ce qu'il est
// seul à avoir vu.
function mergePlayers(named, harvested) {
  const seen = new Set(named.players.map((p) => p.url));
  const players = capPlayers([
    ...named.players,
    ...harvested.players.filter((p) => !seen.has(p.url)),
  ]);
  const announced = [...new Set([...named.names, ...harvested.announced])];
  return { players, announced, missing: missingFrom(announced, players) };
}

function capPlayers(list) {
  const perHost = new Map();
  const out = [];
  for (const p of list) {
    const n = perHost.get(p.host) || 0;
    if (n >= MAX_PER_HOST || out.length >= MAX_PLAYERS) continue;
    perHost.set(p.host, n + 1);
    out.push(p);
  }
  return out;
}

// Annoncés, mais aucune adresse en face : le site va les chercher au clic, ou
// ne les stocke que sous forme d'identifiant. On ne peut pas les inventer — on
// les nomme, pour que l'admin sache que le film n'est pas complet.
function missingFrom(announced, players) {
  return announced.filter((n) => {
    const k = norm(n);
    return (
      k.length >= 3 &&
      !players.some((p) => norm(p.label) === k || norm(p.url).includes(k))
    );
  });
}

// ------------------------------------------------------ les métadonnées --

// « 1h35 » / « 95 min » → 95.
function parseRuntime(text) {
  const s = String(text || "");
  const hm = s.match(/(\d{1,2})\s*h\s*(\d{1,2})?/i);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
  const min = s.match(/(\d{2,3})\s*(?:min|mn|')/i);
  return min ? Number(min[1]) : null;
}

// La fiche technique de ces gabarits : des `<li><span>Libellé :</span> valeur`.
// C'est la forme la plus stable de toutes ces pages, et la seule qui donne le
// titre original et la version.
function parseFacts(html) {
  const facts = {};
  const re = /<li[^>]*>\s*<span[^>]*>\s*([^<]{2,40}?)\s*:?\s*<\/span>([\s\S]{0,500}?)<\/li>/gi;
  for (const m of html.matchAll(re)) {
    const key = strip(m[1]).toLowerCase().replace(/\s*:$/, "");
    const value = strip(m[2]);
    if (key && value && !facts[key]) facts[key] = value;
  }
  return facts;
}

// « TrueFrench », « VF », « VOSTFR » → les pistes qu'on imprime au dos du
// boîtier. Seulement ce que la page annonce : on n'invente pas une VF.
function parseLangs(text) {
  const s = String(text || "").toLowerCase();
  const out = [];
  if (/\b(?:truefrench|french|vff?|vf)\b/.test(s)) out.push("vf");
  if (/vostfr|vost\b|sous-titr/.test(s)) out.push("vostfr");
  return out;
}

export function parseFilmPage(html, { pageUrl = "" } = {}) {
  const meta = (prop) =>
    html.match(
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")
    )?.[1] || null;
  const dataAttr = (name) =>
    html.match(new RegExp(`data-${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || null;

  const facts = parseFacts(html);

  // Le <h1> porte souvent l'année dans une balise à part (« — 1957 ») : on la
  // retire du titre plutôt que de la laisser s'imprimer sur la jaquette.
  const h1 = html.match(/<h1[^>]*>([\s\S]{0,400}?)<\/h1>/i)?.[1] || "";
  const title =
    strip(dataAttr("title")) ||
    strip(h1.replace(/<span[\s\S]*?<\/span>/gi, "")) ||
    strip(meta("og:title")) ||
    strip(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.split(/[|–—]/)[0]);

  // L'année : celle de la fiche technique, celle de la ligne de sous-titre
  // (« -TV-14 - 2011 - Drame… », la seule que portent les fiches de série),
  // celle du <h1>, ou celle qui traîne dans l'adresse de la page
  // (« …-12-hommes-en-colre-1957.html »).
  const yearText =
    facts["date de sortie"] ||
    facts["année"] ||
    facts.annee ||
    strip(html.match(/class=["']release["'][^>]*>([^<]{0,40})</i)?.[1]) ||
    strip(h1) ||
    pageUrl;
  const year = Number(String(yearText).match(/\b(19|20)\d{2}\b/)?.[0]) || null;

  // Le résumé s'ouvre sur une ligne de référencement (« Résumé du film X en
  // streaming complet vf et vostfr hd… ») qui n'a rien à faire sur une fiche :
  // c'est écrit pour un moteur de recherche, pas pour un spectateur.
  const descBlock =
    html.match(/id=["']s-desc["'][^>]*>([\s\S]{0,4000}?)<\/div>/i)?.[1] ||
    html.match(/class=["'][^"']*fdesc[^"']*["'][^>]*>([\s\S]{0,4000}?)<\/div>/i)?.[1] ||
    "";
  const synopsis =
    strip(descBlock.replace(/<p[^>]*class=["'][^"']*desc-text[^"']*["'][\s\S]*?<\/p>/i, "")) ||
    strip(meta("og:description")) ||
    "";

  // Les genres sont tantôt des liens (« <a>Action</a><a>Drame</a> »), tantôt
  // une simple énumération posée dans le bloc — et sur les fiches de série,
  // toujours la seconde forme. On lit les liens s'il y en a, la ponctuation
  // sinon ; à défaut de bloc, la fiche technique.
  const genreBlock = html.match(/class=["']genres["'][^>]*>([\s\S]{0,600}?)<\/span>/i)?.[1];
  const tagged = genreBlock ? [...genreBlock.matchAll(/>([^<>]{2,30})</g)] : [];
  const genres = [
    ...new Set(
      (tagged.length
        ? tagged.map((m) => strip(m[1]))
        : String(genreBlock || facts.genre || facts.genres || "")
            .split(/[,·|]/)
            .map((s) => strip(s))
      ).filter((g) => g && g.length > 1)
    ),
  ].slice(0, 8);

  return {
    title,
    originalTitle: facts["titre original"] || facts["titre originale"] || "",
    year,
    synopsis,
    genres,
    runtime:
      parseRuntime(html.match(/class=["']runtime["'][^>]*>([^<]{0,30})</i)?.[1]) ||
      parseRuntime(facts["durée"] || facts.duree) ||
      null,
    director: facts["réalisateur"] || facts.realisateur || "",
    cover: dataAttr("affiche") || meta("og:image") || null,
    backdrop: dataAttr("affiche2") || meta("og:image:secondary") || null,
    langs: parseLangs(
      `${facts.version || ""} ${strip(html.match(/id=["']film_lang["'][^>]*>([\s\S]{0,200}?)<\/span>/i)?.[1])}`
    ),
  };
}

// La ligne que lira la zone de liste du panneau d'admin. Un film = UNE ligne :
// le titre, puis toutes ses adresses. La première est le lecteur par défaut,
// les suivantes ses miroirs — c'est exactement ce que le poste appelle
// « source suivante ».
const toLine = (title, urls) =>
  urls.length ? `${title ? `${title} — ` : ""}${urls.join(" | ")}` : "";

// LA PISTE D'UN FILM NE SE DEVINE QUE SI LA PAGE EN ANNONCE UNE SEULE. Ces
// fiches donnent une version par page (« … en TrueFrench », « … VOSTFR ») et
// leurs lecteurs sont ceux de celle-là : on peut donc étiqueter les adresses,
// et deux imports successifs (la page VF, puis la page VOSTFR) remplissent le
// même boîtier avec deux pistes distinctes — c'est exactement ce que fait
// `mergeFilmLine` côté panneau.
//
// Quand la page en annonce deux, on ne sait pas laquelle sert quel lecteur : on
// n'étiquette rien plutôt que de mentir, et les adresses restent visibles dans
// toutes les langues.
const tagFilm = (url, langs) => (langs?.length === 1 ? `${langs[0]}@${url}` : url);

function shape(page, players, extra) {
  return {
    kind: "film",
    ...page,
    players: players.players,
    announced: players.announced,
    missing: players.missing,
    hosts: players.players.map((p) => ({ host: p.host, count: 1 })),
    count: players.players.length,
    list: toLine(
      page.title,
      players.players.map((p) => tagFilm(p.url, page.langs))
    ),
    // Le rapport du panneau d'admin est commun aux deux imports : un champ
    // absent y devient une erreur de rendu (voir AdminCollection).
    seasons: [],
    ...extra,
  };
}

// ------------------------------------------------------------ l'import --

// LE SERVEUR IRA CHERCHER CE QU'ON LUI DIT — donc pas n'importe quoi. L'import
// anime-sama s'en tenait à un seul domaine ; ici on ne peut pas (c'est tout
// l'intérêt), alors on garde le strict nécessaire : http(s), un vrai nom de
// domaine public, et rien qui pointe vers l'intérieur de la machine ou du
// réseau qui l'héberge.
const PRIVATE_RE =
  /^(?:localhost|[^.]*\.local|0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i;

export function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("Ce n'est pas une adresse valide.");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Seules les adresses http(s) sont lues.");
  if (PRIVATE_RE.test(u.hostname) || !u.hostname.includes("."))
    throw new Error("Cette adresse pointe à l'intérieur du réseau du serveur.");
  if (u.port && !["80", "443"].includes(u.port))
    throw new Error("Port non standard : seuls 80 et 443 sont lus.");
  return u;
}

// Exportée : la lecture des fiches de SÉRIE (lib/serieIndex.js) va chercher ses
// pages sur les mêmes sites, avec les mêmes en-têtes et le même mur anti-robots
// à reconnaître.
export async function fetchIndexPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "fr,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (r.status === 403 || r.status === 503) {
      const body = await r.text().catch(() => "");
      if (CHALLENGE_RE.test(body)) throw new BlockedError();
      return null;
    }
    if (!r.ok) return null;
    const body = await r.text();
    // Le mur anti-robots répond parfois 200 avec sa page d'attente : sans ce
    // test on lirait le challenge et on conclurait « aucun lecteur ».
    if (CHALLENGE_RE.test(body.slice(0, 4000))) throw new BlockedError();
    return body;
  } catch (err) {
    if (err?.blocked) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const BLOCKED_MSG =
  "Ce site est passé derrière un filtre anti-robots : le serveur ne peut plus " +
  "lire la page, alors qu'elle s'ouvre normalement dans ton navigateur. Ouvre " +
  "la fiche, fais Ctrl+U puis Ctrl+A / Ctrl+C, et colle la source ici.";

// LA PAGE NE PORTE PAS TOUJOURS SES LECTEURS. Beaucoup de ces fiches livrent un
// squelette et vont chercher leurs adresses juste après, en JSON, avec l'
// identifiant d'article posé dans la page (`data-newsid`) : servie à un serveur,
// la page n'a alors PAS UN SEUL lien, alors qu'un navigateur en montre cinq.
//
// On refait donc l'appel que le navigateur ferait — même adresse, même
// identifiant, rien de plus. Le chemin est celui d'un gabarit répandu ; s'il ne
// répond pas, on n'a rien perdu et l'admin garde le recours du collage.
const API_PATHS = ["/engine/ajax/film_api.php?id={id}"];

async function fetchPlayerApi(pageUrl, html) {
  const id = html.match(/data-newsid\s*=\s*["'](\d{1,12})["']/i)?.[1];
  if (!id) return null;
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  for (const path of API_PATHS) {
    const body = await fetchIndexPage(`${origin}${path.replace("{id}", id)}`).catch(() => null);
    if (body && /https?:\/\//.test(body)) return body;
  }
  return null;
}

// LÀ, ON NE DEVINE PLUS. Cette réponse range ses adresses SOUS LE NOM DU
// LECTEUR (`"players":{"uqload":{"default":"https://…"}}`) : chaque adresse
// arrive donc avec son étiquette exacte, au lieu d'être rapprochée d'un nom
// d'hôte au jugé — « voe » servi par un relais maison ne s'appelle pas
// « kakaflix.lol ». Et ce qui n'est PAS une adresse (certains lecteurs n'y
// figurent que par un identifiant nu) se voit tout aussi nettement.
function playersFromApi(text, pageUrl) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const src = data?.players;
  if (!src || typeof src !== "object") return null;

  const pageHost = hostOf(pageUrl);
  const players = [];
  const names = [];
  const seen = new Set();

  for (const [name, entry] of Object.entries(src)) {
    names.push(name);
    // Une entrée peut être une adresse, ou un objet de versions (VF, VOSTFR…) :
    // on descend jusqu'aux chaînes, sans présumer de la profondeur.
    const walk = (v) => {
      if (typeof v === "string") {
        const url = clean(v);
        if (!seen.has(url) && isPlayerUrl(url, pageHost)) {
          seen.add(url);
          players.push({ url, host: hostOf(url), label: name });
        }
      } else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(entry);
  }
  return { players, names };
}

// `html` : la page DÉJÀ lue. L'aiguillage qui distingue une fiche de série
// d'une fiche de film (lib/serieIndex.js) doit forcément l'avoir sous les yeux
// pour trancher — la lui faire redemander serait un aller-retour de plus sur
// chaque film, pour la même page.
export async function importFilmFromUrl(rawUrl, { html: given } = {}) {
  const u = assertPublicUrl(rawUrl);

  let html = given;
  try {
    if (!html) html = await fetchIndexPage(u.href);
  } catch (err) {
    if (!err?.blocked) throw err;
    throw new Error(BLOCKED_MSG);
  }
  if (!html) throw new Error("Page inaccessible (le site n'a rien renvoyé de lisible).");

  const page = parseFilmPage(html, { pageUrl: u.href });
  const api = await fetchPlayerApi(u.href, html);
  const named = api ? playersFromApi(api, u.href) : null;

  // Les deux passes se complètent : le JSON nomme ses lecteurs (on lui fait
  // confiance, il vient du site), la page ratisse ce qu'il n'aurait pas dit.
  const fromPage = harvestPlayers(api ? `${html}\n${api}` : html, {
    pageUrl: u.href,
    extraNames: named?.names || [],
  });
  const players = named
    ? mergePlayers(named, fromPage)
    : fromPage;

  if (!page.title && !players.players.length)
    throw new Error("Rien de reconnaissable ici — est-ce bien la fiche d'un film ?");

  return shape(page, players, { sourceUrl: u.href });
}

// La même lecture, sur une source COLLÉE. C'est le recours quand le site refuse
// les robots — et le seul moyen d'attraper les lecteurs qu'une fiche ne monte
// qu'au clic : on choisit le lecteur dans son navigateur, on recopie la source,
// et l'adresse vient s'ajouter aux précédentes.
export function importFilmFromSource(text, { pageUrl = "" } = {}) {
  const raw = String(text || "");
  const page = parseFilmPage(raw, { pageUrl });
  const players = harvestPlayers(raw, { pageUrl });
  if (!page.title && !players.players.length)
    throw new Error("Aucun lecteur ni titre reconnaissable dans cette source.");
  return shape(page, players, { sourceUrl: pageUrl || "" });
}

// Est-ce la page d'un film plutôt qu'une fiche anime-sama ? Reconnu à ce que la
// source CONTIENT, jamais à ce qu'on déclare : personne ne sait dire s'il vient
// de copier « une fiche » ou « un episodes.js », mais tout le monde sait faire
// Ctrl+A.
export function looksLikeFilmPage(html) {
  const raw = String(html || "");
  // Les signatures anime-sama passent devant : elles ont leur propre lecture.
  if (/var\s+eps[A-Za-z0-9_]*\s*=\s*\[|panneauAnime\s*\(/.test(raw)) return false;
  return harvestPlayers(raw).players.length > 0;
}
