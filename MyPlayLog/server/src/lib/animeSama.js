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
// UNE SAISON, PLUSIEURS PISTES. La page déclare `saison1/vf` ET `saison1/vostfr`
// comme deux entrées distinctes : les ranger par chemin en ne gardant qu'une
// langue (ce que faisait `found.set(path, …)`) effaçait l'autre avant même
// qu'on ait su qu'elle existait. Chaque chemin porte donc la LISTE de ses
// langues, et l'import ira les chercher toutes.
export function parseSeasons(html) {
  const js = uncomment(html);
  const found = new Map();

  const note = (path, label, lang) => {
    if (!path) return;
    const at = found.get(path) || { label: label || path, path, langs: [] };
    if (label && at.label === path) at.label = label;
    if (lang && !at.langs.includes(lang)) at.langs.push(lang);
    found.set(path, at);
  };

  for (const m of js.matchAll(
    /panneauAnime\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/gi
  )) {
    const [path, lang] = m[2].split("/").filter(Boolean);
    note(path, strip(m[1]), lang || null);
  }

  for (const m of html.matchAll(
    /href="(?:\.\/)?((?:saison[^"/\s]*|film|oav|special|hors-serie)[^"/\s]*)\/([a-z0-9]+)\/?"/gi
  )) {
    note(m[1], "", m[2]);
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

// UNE SAISON, TOUTES SES PISTES. On s'arrêtait à la première langue qui
// répondait — donc il fallait choisir VF ou VOSTFR avant de savoir ce que la
// fiche avait, réimporter pour l'autre, et de toute façon la liste n'en gardait
// qu'une. On les demande maintenant TOUTES, et chaque adresse repart avec le
// nom de la sienne : c'est le spectateur qui choisira, sur la fiche, parmi ce
// qui existe vraiment.
//
// Le coût est une requête par langue et par saison (deux ou trois en pratique,
// les langues exotiques n'étant demandées que si la page les déclare). Les
// langues qui ne répondent pas ne coûtent qu'un aller-retour à vide.
async function fetchSeason({ origin, slug, path }, langs) {
  const tracks = [];
  for (const lang of langs) {
    const base = `${origin}/catalogue/${slug}/${path}/${lang}`;
    const js = await fetchText(`${base}/episodes.js`);
    if (!js) continue;
    const episodes = parseEpisodesJs(js);
    if (episodes.length) tracks.push({ lang, url: `${base}/`, episodes });
  }
  if (!tracks.length) return null;

  // LES PISTES SE RECROISENT PAR NUMÉRO D'ÉPISODE : l'épisode 4 en VF et
  // l'épisode 4 en VOSTFR sont le MÊME épisode à deux endroits, pas deux
  // entrées de la liste. Ses adresses se suivent donc sur une seule ligne, la
  // piste préférée en tête (c'est elle qu'on branche par défaut).
  const byNumber = new Map();
  for (const track of tracks) {
    for (const ep of track.episodes) {
      const at = byNumber.get(ep.number) || [];
      for (const url of ep.urls)
        if (!at.some((s) => s.url === url)) at.push({ url, lang: track.lang });
      byNumber.set(ep.number, at);
    }
  }

  return {
    // La piste principale : celle qu'on a demandée si elle a répondu, sinon la
    // première qui l'a fait. Elle ne masque plus les autres — elle passe devant.
    lang: tracks[0].lang,
    langs: tracks.map((t) => t.lang),
    url: tracks[0].url,
    episodes: [...byNumber.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([number, urls]) => ({ number, urls })),
  };
}

// Qui héberge, et combien de fois. C'est le premier chiffre qu'on regarde sur
// un import : un hébergeur qui n'apparaît que trois fois sur vingt épisodes
// trahit une liste incomplète. Partagé par TOUS les imports — le panneau
// d'admin l'affiche sans savoir d'où vient le résultat, et une forme
// manquante le faisait planter.
// Une adresse d'épisode s'écrit de deux façons selon d'où elle vient : une
// chaîne nue (un collage, une fiche de film) ou une adresse ÉTIQUETÉE de sa
// piste (`{ url, lang }`, depuis que l'import prend toutes les langues). Tout ce
// qui manipule des adresses passe par ici plutôt que de connaître les deux —
// c'était le genre de détail qui finit par faire écrire « [object Object] »
// dans une liste d'épisodes.
const srcOf = (u) => (typeof u === "string" ? { url: u, lang: "" } : u || { url: "", lang: "" });

export function countHosts(episodes) {
  const tally = new Map();
  for (const raw of episodes.flatMap((e) => e.urls)) {
    let host = "";
    try {
      host = new URL(srcOf(raw).url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    tally.set(host, (tally.get(host) || 0) + 1);
  }
  return [...tally.entries()].map(([host, count]) => ({ host, count }));
}

// La forme attendue par la zone de texte du panneau d'admin :
// « S01E02 Titre — lien | miroir ». Partagée par TOUS les imports qui rendent
// des épisodes — anime-sama, le collage, les fiches de série des sites de
// streaming (lib/serieIndex.js) : deux écritures divergeraient au premier
// réglage, et c'est ce texte qui devient les épisodes en base.
// La piste voyage COLLÉE À L'ADRESSE (« vostfr@https://… ») : une même ligne
// porte désormais les deux versions du même épisode, il n'y avait donc pas de
// place pour un marqueur de ligne. Voir `parseEpisodeLines` (lib/collection.js),
// qui la relit — les deux formats ne doivent jamais diverger.
export function toList(episodes) {
  return episodes
    .map((e) => {
      const urls = e.urls
        .map(srcOf)
        .map(({ url, lang }) => (lang ? `${lang}@${url}` : url));
      return (
        `S${String(e.season).padStart(2, "0")}E${String(e.number).padStart(2, "0")}` +
        `${e.title ? ` ${e.title}` : ""} — ${urls.join(" | ")}`
      );
    })
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
    ? [{ label: ref.season, path: ref.season, langs: [ref.lang].filter(Boolean) }]
    : parseSeasons(html);
  if (!seasons.length) throw new Error("Aucune saison trouvée sur cette fiche.");

  // TOUTES LES LANGUES SONT DEMANDÉES, `lang` ne décide plus que de l'ORDRE —
  // c'est-à-dire de celle qu'on branchera par défaut. Les langues déclarées par
  // la fiche passent devant le catalogue complet : inutile d'aller frapper à la
  // porte d'une piste coréenne que la page n'annonce pas.
  const order = (s) => [
    ...new Set([lang, ...(s.langs || []), ref.lang, ...LANGS].filter(Boolean)),
  ];

  const out = [];
  const report = [];
  let extra = seasons.filter((s) => seasonRank(s.path) != null).length;

  const tracks = [];
  for (const season of seasons) {
    const got = await fetchSeason({ ...ref, path: season.path }, order(season));
    if (!got) {
      report.push({ ...season, count: 0, lang: null });
      continue;
    }
    for (const l of got.langs) if (!tracks.includes(l)) tracks.push(l);
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
    report.push({
      ...season,
      rank,
      // La saison a maintenant DES pistes : le rapport les montre toutes
      // (« VF · VOSTFR »), `lang` restant la principale pour l'affichage des
      // panneaux qui n'en attendent qu'une.
      lang: got.lang,
      langs: got.langs,
      count: got.episodes.length,
      url: got.url,
    });
  }

  if (!out.length)
    throw new Error(
      "Aucun épisode lisible — la fiche existe mais ses listes sont vides."
    );

  const list = toList(out);

  return {
    slug: ref.slug,
    // Les pistes réellement rapportées, toutes saisons confondues : c'est ce
    // qui remplira le sélecteur de la fiche, et le rapport d'import.
    langs: tracks,
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
