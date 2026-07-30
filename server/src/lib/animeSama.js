// ======================================================================
//  Lecture d'une fiche anime-sama — un RÉPERTOIRE de liens
// ======================================================================
// Le site n'héberge aucune vidéo : chaque saison est une liste d'adresses
// d'hébergeurs tiers, tenue dans un fichier `episodes.js` posé à côté de la
// page. On lit donc exactement ce qu'un navigateur lirait, et on n'en retient
// que ce qui nous sert : le titre, l'affiche, le synopsis, les saisons, et pour
// chaque épisode ses adresses (la première + ses miroirs).
//
// Rien n'est téléchargé ni rehébergé : le résultat de cet import est du TEXTE
// posé dans la zone de liste du panneau d'admin, que l'humain relit et corrige
// avant d'enregistrer. C'est le même geste que coller les liens à la main, en
// moins fastidieux — la curation reste entière.
//
// TOUT EST BEST-EFFORT. Le jour où la page change de forme, chaque étape
// renvoie vide plutôt que de lever : on récupère alors ce qui a marché, et
// l'admin complète.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Le domaine change de suffixe au gré des saisies (.to, .fr, .org…). On accepte
// la famille, et RIEN d'autre : cet import ne doit pas devenir un proxy vers
// n'importe quelle adresse (le serveur irait chercher ce qu'on lui dit).
const HOST_RE = /^(?:[a-z0-9-]+\.)*anime-sama\.[a-z]{2,6}$/i;

// Langues connues du site, dans l'ordre où on les essaie par défaut : l'app est
// francophone, la VF passe donc devant.
export const LANGS = ["vf", "vostfr", "va", "vf1", "vf2", "vkr", "vcn", "vqc"];

const MAX_SEASONS = 24;
const TIMEOUT = 9000;

// La signature d'un mur anti-robots Cloudflare. Le site peut l'allumer du
// jour au lendemain sans rien changer d'autre : les adresses restent valides,
// les pages restent en ligne pour un navigateur, et TOUT devient inaccessible
// depuis un serveur. C'est un cas assez fréquent, et assez déroutant, pour
// mériter d'être reconnu plutôt que confondu avec une page disparue.
// Exporté : l'import de films (lib/filmIndex.js) va chercher des pages sur
// d'autres sites, et se heurte exactement au même mur — une seule définition,
// sinon l'un des deux finira par ne plus le reconnaître.
export const CHALLENGE_RE =
  /Just a moment\.\.\.|challenge-platform|cf-browser-verification|__cf_chl|cf_chl_opt/i;

// Le mur est mémorisé le temps d'un import : une fiche de douze saisons
// enverrait sinon vingt-cinq requêtes qui se feront toutes refouler, et
// l'admin attendrait pour rien.
export class BlockedError extends Error {
  constructor() {
    super("blocked");
    this.blocked = true;
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "fr,en" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    // 403 et 503 sont les codes du mur ; on ne se fie pas au seul code, un
    // vrai 403 existe aussi — c'est le corps de la réponse qui tranche.
    if (r.status === 403 || r.status === 503) {
      const body = await r.text().catch(() => "");
      if (CHALLENGE_RE.test(body)) throw new BlockedError();
      return null;
    }
    if (!r.ok) return null;
    const body = await r.text();
    // Le mur peut aussi répondre 200 avec la page d'attente à la place du
    // contenu : sans ce test, on parserait le challenge et on conclurait
    // « aucune saison trouvée ».
    if (CHALLENGE_RE.test(body.slice(0, 4000))) throw new BlockedError();
    return body;
  } catch (err) {
    if (err?.blocked) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------- l'URL --

// « https://anime-sama.xx/catalogue/among-us/ » ou une page de saison précise.
// Renvoie null si ce n'est pas une fiche du site — l'appelant refuse alors.
export function parseUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !HOST_RE.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("catalogue");
  if (at < 0 || !parts[at + 1]) return null;
  return {
    origin: u.origin,
    slug: parts[at + 1],
    // Page de saison passée directement : on n'importera que celle-là.
    season: parts[at + 2] || null,
    lang: parts[at + 3] || null,
  };
}

// ------------------------------------------------------------- la fiche --

const strip = (s) =>
  String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/\s{2,}/g, " ")
    .trim();

// Les blocs de script portent des exemples en commentaire (`/* … */`) juste à
// côté des vraies déclarations : les lire ferait apparaître dix saisons qui
// n'existent pas. On les retire AVANT toute recherche.
const uncomment = (js) =>
  String(js || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

// « saison1 » → 1. « film », « oav », « hors-serie » n'ont pas de rang : ils
// prendront la suite, après la dernière vraie saison.
function seasonRank(path) {
  const m = String(path).match(/^saison\s*(\d{1,2})$/i);
  return m ? Number(m[1]) : null;
}

// Métadonnées de la page de catalogue. Le site range tout dans des classes
// utilitaires (Tailwind), donc on s'accroche aux ANCRES STABLES : les id
// (`synopsisText`, `titreAlter`), les balises meta, et les libellés visibles.
export function parseCatalogue(html) {
  const meta = (prop) =>
    html.match(
      new RegExp(`<meta[^>]+(?:property|name|itemprop)="${prop}"[^>]+content="([^"]*)"`, "i")
    )?.[1] || null;

  const title =
    strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ||
    strip(meta("og:title")) ||
    strip(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.split("|")[0]);

  // Fiche technique : des paires libellé / valeur qui se suivent.
  const facts = {};
  const factRe =
    /class="info-lbl"[^>]*>([\s\S]*?)<\/span>\s*<span class="info-val[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  for (const m of html.matchAll(factRe)) {
    const key = strip(m[1]).toLowerCase();
    const value = strip(m[2]);
    if (key && value) facts[key] = value;
  }
  const year = Number(String(facts["année"] || facts.annee || "").match(/\d{4}/)?.[0]) || null;

  return {
    title,
    altTitles: strip(html.match(/id="titreAlter"[^>]*>([\s\S]*?)<\/h2>/i)?.[1])
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    synopsis: strip(html.match(/id="synopsisText"[^>]*>([\s\S]*?)<\/p>/i)?.[1]) ||
      strip(meta("description")),
    genres: [...html.matchAll(/class="genre-pill"[^>]*>([^<]+)</gi)]
      .map((m) => strip(m[1]))
      .filter(Boolean),
    cover: meta("og:image") || meta("image"),
    year,
    creator: facts["créateur"] || facts.createur || facts.studio || "",
    status: facts["état"] || facts.etat || "",
  };
}

// Les saisons vivent dans des appels `panneauAnime("Saison 1", "saison1/vostfr")`
// écrits dans un <script> (le site les rend en JS, il n'y a pas de liste HTML
// à lire côté serveur). On lit aussi les ancres, au cas où la page changerait
// de méthode — et on déduplique sur le chemin.
export function parseSeasons(html) {
  const js = uncomment(html);
  const found = new Map();

  for (const m of js.matchAll(
    /panneauAnime\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/gi
  )) {
    const [path, lang] = m[2].split("/").filter(Boolean);
    if (path) found.set(path, { label: strip(m[1]) || path, path, lang: lang || null });
  }

  for (const m of html.matchAll(
    /href="(?:\.\/)?((?:saison[^"/\s]*|film|oav|special|hors-serie)[^"/\s]*)\/([a-z0-9]+)\/?"/gi
  )) {
    const path = m[1];
    if (!found.has(path)) found.set(path, { label: path, path, lang: m[2] });
  }

  // Les vraies saisons d'abord, dans l'ordre ; les à-côtés (film, OAV) ensuite.
  return [...found.values()]
    .sort((a, b) => (seasonRank(a.path) ?? 99) - (seasonRank(b.path) ?? 99))
    .slice(0, MAX_SEASONS);
}

// --------------------------------------------------------- les épisodes --

// `episodes.js` déclare un tableau d'adresses PAR HÉBERGEUR (`eps1`, `eps2`, …)
// où la position dit l'épisode : eps1[3] et eps2[3] sont le même épisode 4 chez
// deux hôtes. On les recroise donc par index — c'est exactement ce que fait le
// sélecteur de lecteur du site.
export function parseEpisodesJs(js) {
  const clean = uncomment(js);
  const lists = [];
  for (const m of clean.matchAll(/var\s+eps[A-Za-z0-9_]*\s*=\s*\[([\s\S]*?)\]/g)) {
    const urls = [...m[1].matchAll(/['"]\s*(https?:\/\/[^'"\s]+)\s*['"]/g)].map((u) => u[1]);
    if (urls.length) lists.push(urls);
  }
  if (!lists.length) return [];

  const count = Math.max(...lists.map((l) => l.length));
  const episodes = [];
  for (let i = 0; i < count; i++) {
    const seen = new Set();
    const urls = [];
    for (const list of lists) {
      const url = list[i];
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    if (urls.length) episodes.push({ number: i + 1, urls });
  }
  return episodes;
}

// Une saison, dans la langue demandée. On essaie les langues dans l'ordre et on
// garde la PREMIÈRE qui donne des épisodes : une saison peut n'exister qu'en
// VOSTFR alors qu'on demandait la VF, et rien ne le dit avant d'avoir regardé.
async function fetchSeason({ origin, slug, path }, langs) {
  for (const lang of langs) {
    const base = `${origin}/catalogue/${slug}/${path}/${lang}`;
    const js = await fetchText(`${base}/episodes.js`);
    if (!js) continue;
    const episodes = parseEpisodesJs(js);
    if (episodes.length) return { lang, url: `${base}/`, episodes };
  }
  return null;
}

// Qui héberge, et combien de fois. C'est le premier chiffre qu'on regarde sur
// un import : un hébergeur qui n'apparaît que trois fois sur vingt épisodes
// trahit une liste incomplète. Partagé par les deux imports — le panneau
// d'admin l'affiche sans savoir d'où vient le résultat, et une forme
// manquante le faisait planter.
function countHosts(episodes) {
  const tally = new Map();
  for (const url of episodes.flatMap((e) => e.urls)) {
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    tally.set(host, (tally.get(host) || 0) + 1);
  }
  return [...tally.entries()].map(([host, count]) => ({ host, count }));
}

// La forme attendue par la zone de texte du panneau d'admin :
// « S01E02 Titre — lien | miroir ». Partagée par les deux imports (le
// téléchargé et le collé) : deux écritures divergeraient au premier réglage,
// et c'est ce texte qui devient les épisodes en base.
function toList(episodes) {
  return episodes
    .map(
      (e) =>
        `S${String(e.season).padStart(2, "0")}E${String(e.number).padStart(2, "0")}` +
        `${e.title ? ` ${e.title}` : ""} — ${e.urls.join(" | ")}`
    )
    .join("\n");
}

// ------------------------------------------------------------- l'import --

// Renvoie de quoi remplir le formulaire d'ajout : les métadonnées, le détail
// des saisons trouvées, et surtout la LISTE au format de la zone de texte
// (`S01E02 Titre — lien | miroir`), prête à être relue puis enregistrée.
export async function importFromUrl(rawUrl, { lang } = {}) {
  const ref = parseUrl(rawUrl);
  if (!ref) throw new Error("Ce lien n'est pas une fiche anime-sama.");

  let html;
  try {
    html = await fetchText(`${ref.origin}/catalogue/${ref.slug}/`);
  } catch (err) {
    if (!err?.blocked) throw err;
    throw new Error(
      "anime-sama est passé derrière un filtre anti-robots (Cloudflare) : le " +
        "serveur ne peut plus lire la page, alors qu'elle s'ouvre normalement " +
        "dans ton navigateur. Ouvre la fiche, puis colle la source ici — " +
        "l'import fera le reste."
    );
  }
  if (!html) throw new Error("Fiche introuvable (page inaccessible).");
  const info = parseCatalogue(html);

  // Page de saison collée directement : on s'en tient à celle-là.
  const seasons = ref.season
    ? [{ label: ref.season, path: ref.season, lang: ref.lang }]
    : parseSeasons(html);
  if (!seasons.length) throw new Error("Aucune saison trouvée sur cette fiche.");

  // Ordre d'essai des langues : celle demandée, celle du lien, puis le reste.
  const order = (s) => [
    ...new Set([lang, s.lang, ref.lang, ...LANGS].filter(Boolean)),
  ];

  const out = [];
  const report = [];
  let extra = seasons.filter((s) => seasonRank(s.path) != null).length;

  for (const season of seasons) {
    const got = await fetchSeason({ ...ref, path: season.path }, order(season));
    if (!got) {
      report.push({ ...season, count: 0, lang: null });
      continue;
    }
    // Les à-côtés (film, OAV) n'ont pas de rang : ils prennent la suite plutôt
    // que d'écraser la saison 1.
    const rank = seasonRank(season.path) ?? ++extra;
    for (const ep of got.episodes) {
      out.push({
        season: rank,
        number: ep.number,
        // Un titre d'épisode n'existe pas dans le répertoire : on met le
        // strict nécessaire, l'enrichissement TVmaze/Wikipédia fera mieux.
        title: seasonRank(season.path) == null ? season.label : "",
        urls: ep.urls,
      });
    }
    report.push({ ...season, rank, lang: got.lang, count: got.episodes.length, url: got.url });
  }

  if (!out.length)
    throw new Error(
      "Aucun épisode lisible — la fiche existe mais ses listes sont vides dans cette langue."
    );

  const list = toList(out);

  return {
    slug: ref.slug,
    sourceUrl: `${ref.origin}/catalogue/${ref.slug}/`,
    title: info.title || ref.slug,
    altTitles: info.altTitles,
    synopsis: info.synopsis,
    genres: info.genres,
    year: info.year,
    creator: info.creator,
    status: info.status,
    cover: info.cover,
    seasons: report,
    count: out.length,
    hosts: countHosts(out),
    list,
  };
}

// ======================================================================
//  Import à partir d'une source COLLÉE
// ======================================================================
// Quand le site se ferme aux robots, il reste ouvert aux navigateurs — et
// l'admin en a un. Il ouvre la page, copie la source, la colle ici : c'est LUI
// qui va chercher, l'app se contente de lire. Aucune barrière n'est contournée,
// et le travail fastidieux (démêler quarante adresses d'hébergeurs et les
// mettre en forme) reste fait par la machine.
//
// Deux natures de collage, reconnues à ce qu'elles CONTIENNENT plutôt qu'à ce
// qu'on déclare — personne ne sait dire s'il vient de copier « du HTML » ou
// « du JS », mais tout le monde sait faire Ctrl+A :
//
//   • la PAGE d'une fiche → titre, affiche, synopsis et la liste des saisons,
//     donc de quoi savoir quels fichiers d'épisodes aller chercher ensuite ;
//   • un fichier EPISODES.JS → les épisodes d'une saison, mis en forme pour la
//     zone de texte.
export function importFromSource(text, { season = 1, label = "" } = {}) {
  const raw = String(text || "").trim();
  if (raw.length < 40)
    throw new Error("Colle la source de la page, ou le contenu d'un episodes.js.");

  // La signature d'un episodes.js : une ou plusieurs listes « var epsX = [ … ] ».
  if (/var\s+eps[A-Za-z0-9_]*\s*=\s*\[/.test(raw)) {
    const episodes = parseEpisodesJs(raw);
    if (!episodes.length)
      throw new Error("Ce fichier ne contient aucune adresse d'épisode lisible.");
    const rank = Number(season) > 0 ? Number(season) : 1;
    const out = episodes.map((ep) => ({
      season: rank,
      number: ep.number,
      title: "",
      urls: ep.urls,
    }));
    return {
      kind: "episodes",
      title: "",
      // La MÊME forme que l'import par URL, champ pour champ : le panneau
      // d'admin affiche un rapport sans savoir d'où vient le résultat, et le
      // moindre champ manquant y devient une erreur de rendu.
      seasons: [
        { label: label || "Saison " + rank, path: "collage-" + rank, rank, count: episodes.length },
      ],
      hosts: countHosts(out),
      list: toList(out),
      count: episodes.length,
    };
  }

  // Sinon, une page. On n'exige pas qu'elle soit entière : un collage partiel
  // donne ce qu'il donne, et le reste se saisit à la main.
  if (!/<\w/.test(raw))
    throw new Error(
      "Source non reconnue : attendu la page d'une fiche, ou un fichier episodes.js."
    );

  const info = parseCatalogue(raw);
  const seasons = parseSeasons(raw);
  if (!info.title && !seasons.length)
    throw new Error("Rien de reconnaissable ici — est-ce bien la page d'une fiche ?");

  return {
    kind: "catalogue",
    ...info,
    seasons: seasons.map((x, i) => ({ ...x, rank: seasonRank(x.path) ?? i + 1, count: 0 })),
    hosts: [],
    list: "",
    count: 0,
  };
}
