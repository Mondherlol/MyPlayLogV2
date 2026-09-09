import GameCredits from "../models/GameCredits.js";
import { igdbQuery } from "./igdb.js";
import { gameCore } from "./gameIgdb.js";
import { originalGame } from "./gameLore.js";

// ======================================================================
//  Qui a fait ce jeu — les gens, pas les studios
// ======================================================================
//
// La fiche sait dire « développé par Capcom ». Elle ne sait pas dire qui l'a
// réalisé, qui en a écrit les dialogues, qui a composé le thème qu'on a dans la
// tête depuis quinze ans, ni quel acteur prête sa voix au héros. Or c'est ça
// qu'on veut savoir quand on aime un jeu — et c'est ça qu'on suit d'un jeu à
// l'autre.
//
// ⚠️ IGDB N'A QUE DES SOCIÉTÉS. Pas une seule personne, à aucun endroit de son
// catalogue. Il a donc fallu aller ailleurs, et le duo qui marche est celui-ci :
//
//   • L'INFOBOX DE WIKIPÉDIA pour l'équipe — réalisation, scénario, musique,
//     direction artistique, game design, programmation, production. C'est de
//     loin la source la plus fournie pour un jeu, et elle est tenue à jour.
//   • WIKIDATA pour la distribution (propriété P725, « doublé par ») — la seule
//     qui la porte, avec en prime une photo et une phrase de présentation.
//
// Les deux sont gratuites, sans clé, et le résultat est mis en cache pour tout
// le monde : ces faits-là ne changent plus une fois le jeu sorti.

// La version du format. ⚠️ LA BUMPER quand on change ce qu'on extrait, sinon
// les fiches déjà en base répondront à l'ancienne pour toujours.
const VER = 3; // v3 : l'identifiant Wikidata de chaque personne

const UA = "MyPlayLog/1.0 (credits; +https://myplaylog.cc)";
const TIMEOUT = 10_000;

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return res.json();
}

// ----------------------------------------------------------------------
//  Lire une infobox
// ----------------------------------------------------------------------
// Le wikitexte n'est pas un format de données : c'est de la mise en page. Trois
// pièges, rencontrés en vrai sur les quatre premiers jeux essayés :
//
//   • des commentaires d'éditeur au milieu des noms
//     (« Yoichi Yamada<!--game system director--> ») ;
//   • des gabarits imbriqués dont il ne faut garder QUE certains — `{{ubl|A|B}}`
//     est une liste dont on veut les éléments, `{{nihongo|…}}` est une note dont
//     on ne veut rien, et le second se cache parfois dans le premier ;
//   • des liens dont le libellé contient une barre verticale
//     (« [[Christopher Larkin (composer)|Christopher Larkin]] »), qui coupait
//     le nom en deux si on découpait avant de résoudre les liens.
//
// D'où l'ordre, qui est tout l'algorithme : commentaires, puis gabarits (en
// comptant les accolades), puis liens, et le découpage EN DERNIER.

// L'index juste après le `}}` qui ferme le `{{` ouvert en `start`.
function closeBraces(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

// Découpe sur les `|` de PREMIER niveau : ceux d'un gabarit ou d'un lien
// imbriqué appartiennent à ce dernier, pas à nous.
function splitTop(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{{", i) || text.startsWith("[[", i)) {
      depth += 1;
      i += 1;
    } else if (text.startsWith("}}", i) || text.startsWith("]]", i)) {
      depth -= 1;
      i += 1;
    } else if (text[i] === "|" && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

// Les gabarits de LISTE : on garde leurs éléments. Tous les autres sont des
// notes, des drapeaux, des dates — on les jette en entier.
const LIST_TEMPLATE = /^(ubl|unbulleted list|plainlist|plain list|hlist|flatlist|ublist)$/i;

function unwrapTemplates(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("{{", i)) {
      const end = closeBraces(text, i);
      const parts = splitTop(text.slice(i + 2, end - 2));
      const head = (parts[0] || "").trim();
      if (LIST_TEMPLATE.test(head)) {
        out += parts.slice(1).map(unwrapTemplates).join("\n|");
      }
      i = end;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

// Un nom, et la page Wikipédia qui lui correspond quand le lien existe : c'est
// elle qui donnera sa photo.
function readLinks(chunk) {
  let page = null;
  const name = chunk
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, target, label) => {
      page = page || target.trim();
      return label;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
      page = page || target.trim();
      return target;
    })
    .replace(/''+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name, page };
}

// Ce qui n'est pas un nom de personne. Les infobox contiennent des « Various »,
// des dates, des notes de bas de page.
const NOT_A_NAME = /^(various|multiple|n\/?a|none|uncredited|see below|\d)/i;

function peopleFrom(raw) {
  if (!raw) return [];
  const cleaned = unwrapTemplates(
    String(raw)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
      .replace(/<ref[^>]*\/>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n|")
  );

  const seen = new Set();
  return splitTop(cleaned)
    .flatMap((part) => part.split("\n"))
    .map((part) => part.replace(/^\s*[*|]\s*/, ""))
    .map(readLinks)
    .filter(({ name }) => {
      if (name.length < 3 || name.length > 60) return false;
      if (NOT_A_NAME.test(name)) return false;
      // Un « = » restant trahit un champ d'infobox qu'on a ramassé par erreur.
      if (/=/.test(name)) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Les champs qu'on lit, dans l'ordre où on les montrera. Le libellé français
// est celui qui s'affiche sur la carte.
const ROLES = [
  ["director", "Réalisation"],
  ["writer", "Scénario"],
  ["composer", "Musique"],
  ["artist", "Direction artistique"],
  ["designer", "Game design"],
  ["programmer", "Programmation"],
  ["producer", "Production"],
];

// ⚠️ L'INFOBOX S'ARRÊTE, PAS LE TEXTE. Sans cette borne, le DERNIER champ de
// l'infobox avalait tout ce qui suit — c'est-à-dire le premier paragraphe de
// l'article. Vu en vrai sur Breath of the Wild, où la ligne « compositeur »
// finissait par créditer « Zelda timeline]], it follows [[Link... ». On coupe
// donc au `}}` qui ferme l'infobox avant de lire quoi que ce soit.
function infoboxOnly(wikitext) {
  const text = String(wikitext || "");
  const at = text.search(/\{\{\s*infobox/i);
  return at < 0 ? text : text.slice(at, closeBraces(text, at));
}

// Découpe l'infobox d'un article en `{ champ: valeur }`.
function infoboxFields(wikitext) {
  const text = infoboxOnly(wikitext);
  const out = {};
  const marks = [...text.matchAll(/^\s*\|\s*([a-z_ ]+?)\s*=\s*/gim)];
  marks.forEach((m, i) => {
    const key = m[1].trim().toLowerCase();
    const start = m.index + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    if (!out[key]) out[key] = text.slice(start, end).trim();
  });
  return out;
}

// ----------------------------------------------------------------------
//  Les sources
// ----------------------------------------------------------------------
const titleOf = (url) => {
  const m = String(url || "").match(/\/wiki\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

// ----------------------------------------------------------------------
//  Trouver le BON article
// ----------------------------------------------------------------------
//
// ⚠️ VU EN VRAI SUR ACE ATTORNEY TRILOGY : la fiche affichait les réalisateurs
// du FILM. Quand IGDB ne donne pas de lien Wikipédia, on cherchait par nom et
// on prenait le premier résultat sans jamais vérifier ce qu'il était — or « Ace
// Attorney » tout court, sur Wikipédia, c'est le long-métrage de Takashi Miike.
// Une fiche de jeu créditant une équipe de cinéma, ce n'est pas une donnée
// approximative : c'est une donnée fausse, et elle a l'air vraie.
//
// Deux garde-fous, et il faut les deux :
//
//   • LE TITRE doit parler du même jeu — sinon la recherche part au loin (vu
//     aussi : « List of video games listed among the best ») ;
//   • L'INFOBOX doit être celle d'un jeu vidéo — c'est ce qui sépare le film de
//     l'adaptation, la série télé du jeu, l'album de la bande originale.
//
// Le second est le plus sûr : un article de film porte `{{Infobox film}}`, et
// aucun jeu ne porte ça.

const GAME_INFOBOX = /\{\{\s*infobox[ _]+(video[ _]*game|vg\b|jeu vidéo)/i;

const isGameArticle = (wikitext) => GAME_INFOBOX.test(String(wikitext || ""));

// Les mots qui ne distinguent rien : ils sont dans un titre de jeu sur deux.
const FILLER = /^(the|a|of|and|le|la|les|des|du|edition|remastered|hd|deluxe|definitive|complete|collection|trilogy|remake|remaster)$/i;

const words = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !FILLER.test(w));

// Le titre trouvé parle-t-il bien de ce jeu ? On demande la moitié des mots
// significatifs — un jeu s'appelle rarement pareil qu'un article sans rapport,
// et une édition (« Definitive ») ne doit pas faire échouer la comparaison.
function sameTitle(name, title) {
  const want = words(name);
  if (!want.length) return true;
  const have = new Set(words(title));
  const hits = want.filter((w) => have.has(w)).length;
  return hits * 2 >= want.length;
}

// La section 0 d'un article : c'est là qu'est l'infobox, et donc l'équipe.
async function sectionZero(host, title) {
  const parsed = await getJson(
    `https://${host}/w/api.php?action=parse&page=${encodeURIComponent(
      title
    )}&prop=wikitext&section=0&format=json&redirects=1`
  ).catch(() => null);
  return parsed?.parse?.wikitext?.["*"] || null;
}

/**
 * L'article du jeu, ou rien.
 *
 * Rien est une réponse acceptable : la section disparaît de la fiche, ce qui
 * vaut infiniment mieux que d'y afficher l'équipe de quelqu'un d'autre.
 */
async function findArticle(wikiUrl, name) {
  // Le lien que porte la fiche IGDB, quand il y en a un. Il est presque
  // toujours bon — mais « presque » se vérifie, comme le reste.
  const linked = titleOf(wikiUrl);
  if (linked) {
    const host = String(wikiUrl).match(/^https?:\/\/([^/]+)/)?.[1] || "en.wikipedia.org";
    const text = await sectionZero(host, linked);
    if (text && isGameArticle(text)) return { host, title: linked, text };
  }

  // Sinon on cherche — et on regarde ce qu'on a trouvé avant de le croire.
  const host = "en.wikipedia.org";
  const found = await getJson(
    `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      `${name} video game`
    )}&srlimit=5&format=json`
  ).catch(() => null);

  const hits = (found?.query?.search || [])
    .map((r) => r.title)
    .filter((title) => sameTitle(name, title))
    .slice(0, 3);

  for (const title of hits) {
    const text = await sectionZero(host, title);
    if (text && isGameArticle(text)) return { host, title, text };
  }
  return null;
}

async function crewFromWikipedia(wikiUrl, name) {
  const article = await findArticle(wikiUrl, name);
  if (!article) return { people: [], url: null, host: "en.wikipedia.org", title: null };

  const { host, title, text } = article;
  const fields = infoboxFields(text);

  const people = [];
  ROLES.forEach(([field, label], rank) => {
    for (const p of peopleFrom(fields[field])) {
      people.push({ ...p, role: label, rank });
    }
  });

  return {
    people,
    url: `https://${host}/wiki/${encodeURIComponent(title)}`,
    host,
    title,
  };
}

// Le fichier Commons d'une photo, en vignette web.
const commons = (file) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    file
  )}?width=320`;

// La distribution, via Wikidata. C'est la seule source qui la porte pour un
// jeu — et elle arrive avec la photo et la phrase de présentation.
async function castFromWikidata(host, title) {
  if (!title) return [];

  const summary = await getJson(
    `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  ).catch(() => null);
  const qid = summary?.wikibase_item;
  if (!qid) return [];

  const entity = await getJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`
  ).catch(() => null);
  const claims = entity?.entities?.[qid]?.claims;
  if (!claims) return [];

  const ids = (claims.P725 || [])
    .map((c) => c.mainsnak?.datavalue?.value?.id)
    .filter(Boolean)
    .slice(0, 30);
  if (!ids.length) return [];

  const res = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join(
      "|"
    )}&props=labels|descriptions|claims|sitelinks&languages=fr|en&sitefilter=frwiki|enwiki&format=json`
  ).catch(() => null);

  return ids
    .map((id) => {
      const e = res?.entities?.[id];
      if (!e) return null;
      // Le libellé français quand il existe, l'anglais sinon, et à défaut
      // n'importe lequel : une personne sans nom ne sert à rien, mais une
      // personne dont le nom n'est pas traduit reste une personne.
      const labels = e.labels || {};
      const name = (labels.fr || labels.en || Object.values(labels)[0])?.value;
      if (!name) return null;
      const file = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      const page =
        e.sitelinks?.frwiki?.title || e.sitelinks?.enwiki?.title || null;
      const wikiHost = e.sitelinks?.frwiki ? "fr.wikipedia.org" : "en.wikipedia.org";
      return {
        name,
        qid: id,
        role: "Voix",
        // Après la réalisation et le scénario : ce sont les visages qu'on
        // reconnaît, et la raison pour laquelle on ouvre cette section.
        rank: 1.5,
        note: (e.descriptions?.fr || e.descriptions?.en)?.value || null,
        image: file ? commons(file) : null,
        link: page ? `https://${wikiHost}/wiki/${encodeURIComponent(page)}` : null,
      };
    })
    .filter(Boolean);
}

// Les portraits des gens de l'équipe : une seule requête pour tout le monde,
// sur les seuls noms que l'infobox a pris la peine de lier.
async function portraits(host, people) {
  const titles = [...new Set(people.map((p) => p.page).filter(Boolean))].slice(0, 45);
  if (!titles.length) return new Map();

  // `pageprops` vient en prime : c'est le pont vers Wikidata, et il ne coûte
  // rien de plus — c'est la MÊME requête. Sans lui, on ne saurait jamais
  // demander « quels autres jeux a-t-il faits ? » (cf. `creditsWorks`).
  const res = await getJson(
    `https://${host}/w/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(
      titles.join("|")
    )}&prop=pageimages|description|pageprops&ppprop=wikibase_item&piprop=thumbnail&pithumbsize=320&inprop=url`
  ).catch(() => null);

  const out = new Map();
  for (const page of Object.values(res?.query?.pages || {})) {
    if (page.missing !== undefined) continue;
    out.set(page.title, {
      image: page.thumbnail?.source || null,
      note: page.description || null,
      qid: page.pageprops?.wikibase_item || null,
      link: `https://${host}/wiki/${encodeURIComponent(page.title)}`,
    });
  }
  // Les redirections : la clé demandée n'est pas toujours celle qui revient.
  for (const r of res?.query?.redirects || []) {
    const hit = out.get(r.to);
    if (hit) out.set(r.from, hit);
  }
  return out;
}

/**
 * Toute l'équipe d'un jeu, rassemblée et rangée.
 *
 * Une personne n'apparaît QU'UNE FOIS, avec tous ses rôles : Hideo Kojima est
 * à la fois réalisateur, producteur, game designer et scénariste de Death
 * Stranding — quatre cartes identiques à la suite, ce serait absurde.
 */
async function build(game) {
  const wikiUrl = (game.websites || []).find((w) => w.type === 3)?.url || null;
  const { people: crew, url, host, title } = await crewFromWikipedia(wikiUrl, game.name);

  const [cast, photos] = await Promise.all([
    castFromWikidata(host, title).catch(() => []),
    portraits(host, crew).catch(() => new Map()),
  ]);

  const merged = new Map();
  for (const p of [...crew, ...cast]) {
    const key = p.name.toLowerCase();
    const shot = p.page ? photos.get(p.page) : null;
    const found = merged.get(key);
    if (found) {
      if (!found.roles.includes(p.role)) found.roles.push(p.role);
      found.rank = Math.min(found.rank, p.rank);
      found.image = found.image || p.image || shot?.image || null;
      found.link = found.link || p.link || shot?.link || null;
      found.note = found.note || p.note || shot?.note || null;
      found.qid = found.qid || p.qid || shot?.qid || null;
      continue;
    }
    merged.set(key, {
      name: p.name,
      roles: [p.role],
      rank: p.rank,
      image: p.image || shot?.image || null,
      link: p.link || shot?.link || null,
      note: p.note || shot?.note || null,
      qid: p.qid || shot?.qid || null,
    });
  }

  // ⚠️ LES VISAGES D'ABORD, le rôle ensuite. Une liste qui s'ouvre sur six
  // jetons d'initiales a l'air vide même quand elle ne l'est pas — alors que
  // les mêmes six lignes, menées par trois portraits, se lisent comme une
  // équipe. Le rang de rôle départage à photo égale, donc la réalisation reste
  // devant la programmation.
  const people = [...merged.values()]
    .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || a.rank - b.rank)
    .map(({ rank, ...p }) => p);

  // Pas de source affichée si on n'a trouvé personne : quand IGDB ne donne pas
  // le lien Wikipédia, on cherche par nom, et cette recherche tombe parfois à
  // côté (vu en vrai : « List of video games listed among the best »). Créditer
  // une page qui n'a rien donné, ce serait donner du sérieux à une erreur.
  return {
    people,
    source: url && people.length ? { label: "Wikipédia", url } : null,
  };
}

/**
 * L'équipe du jeu, depuis la base si on l'a déjà, sinon en allant la chercher.
 *
 * Bloquant, contrairement aux anecdotes : c'est une poignée de requêtes vers
 * des wikis (une à deux secondes), pas un modèle de langage. La fiche peut
 * l'attendre — et une fois écrite, elle est servie à tout le monde.
 */
export async function gameCredits(gameId) {
  const cached = await GameCredits.findOne({ gameId }).lean();
  if (cached && cached.ver === VER) {
    return { people: cached.people || [], source: cached.source || null };
  }

  const game = await gameCore(gameId);
  if (!game) {
    const err = new Error("Jeu introuvable.");
    err.status = 404;
    throw err;
  }

  // Une édition « Definitive » ou un portage n'a pas d'article à lui : c'est
  // l'original qui porte l'équipe, comme pour les anecdotes (cf. gameLore.js).
  const og = await originalGame(game);
  const built = await build(og);

  await GameCredits.updateOne(
    { gameId },
    { $set: { ...built, ver: VER, gameName: game.name || og.name } },
    { upsert: true }
  );
  return built;
}

// ======================================================================
//  « Il a aussi fait… » — les autres jeux d'une personne
// ======================================================================
//
// C'est la question qui vient juste après « qui a fait ce jeu ». On lit
// « Hidetaka Miyazaki, réalisation » et on veut savoir tout de suite quoi
// d'autre — c'est comme ça qu'on remonte une filmographie, et c'est comme ça
// qu'on trouve son prochain jeu.
//
// ⚠️ CALCULÉ À PART, ET APRÈS. La section « Qui l'a fait » de la fiche ne doit
// pas attendre ça : Wikidata met une à trois secondes à répondre, parfois
// davantage. L'équipe s'affiche donc avec `gameCredits`, et cette page-ci
// demande le complément quand elle s'ouvre (cf. GET /games/:id/credits/works).
//
// ⚠️ ON INTERROGE PAR IDENTIFIANT, JAMAIS PAR NOM. Il existe deux Ryan
// Reynolds, trois Chris Lee et un nombre déraisonnable de Tanaka : croiser des
// crédits sur une chaîne de caractères, c'est attribuer à quelqu'un le travail
// d'un homonyme. Le `qid` de chaque personne est écrit avec elle
// (cf. `portraits` et `castFromWikidata`) ; sans lui, on ne propose rien.

const WORKS_VER = 1;

// Combien de jaquettes sous une carte. Au-delà, la ligne devient un rail qu'on
// pousse du doigt — or ce n'est pas la question posée ici : on veut la
// silhouette d'une carrière, pas son catalogue.
const WORKS_PER_PERSON = 8;

// Les liens qui font qu'on « a fait » un jeu, du plus déterminant au moins.
// P178 (développeur) est volontairement absente : c'est une société.
const MADE_BY = [
  "wdt:P57", // réalisation
  "wdt:P58", // scénario
  "wdt:P86", // musique
  "wdt:P162", // production
  "wdt:P170", // création
  "wdt:P287", // game design
  "wdt:P725", // voix
].join("|");

const SPARQL = "https://query.wikidata.org/sparql";

/** Les jeux liés à ces personnes, en UNE requête pour toute la page. */
async function worksFromWikidata(qids) {
  if (!qids.length) return new Map();

  const query = `SELECT ?p ?gLabel WHERE {
  VALUES ?p { ${qids.map((q) => `wd:${q}`).join(" ")} }
  ?g wdt:P31/wdt:P279* wd:Q7889 .
  ?g (${MADE_BY}) ?p .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
} LIMIT 1500`;

  const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    // Le service public de Wikidata coupe lui-même à 60 s ; on n'attend pas
    // si longtemps pour une section secondaire.
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${res.status} sur Wikidata`);
  const json = await res.json();

  const out = new Map();
  for (const row of json?.results?.bindings || []) {
    const qid = String(row.p?.value || "").split("/").pop();
    const name = row.gLabel?.value;
    // Sans libellé, le service rend le Q brut : ce n'est pas un titre de jeu,
    // et ça ne trouvera jamais sa jaquette.
    if (!qid || !name || /^Q\d+$/.test(name)) continue;
    if (!out.has(qid)) out.set(qid, new Set());
    out.get(qid).add(name);
  }
  return out;
}

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
const quote = (s) => `"${String(s).replace(/["\\]/g, "")}"`;

/**
 * Les jaquettes de ces titres, par nom.
 *
 * Wikidata donne des NOMS, l'app affiche des JAQUETTES : il faut donc les
 * retrouver dans le catalogue. `~` est l'égalité insensible à la casse
 * d'apicalypse — pas une recherche floue : on ne veut surtout pas qu'un
 * « Halo » ramène « Halo Wars 2 ».
 */
async function coversByName(names) {
  const found = new Map();
  const list = [...names];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const rows =
      (await igdbQuery(
        "games",
        `fields name,cover.image_id,first_release_date,total_rating_count;` +
          ` where (${chunk.map((n) => `name ~ ${quote(n)}`).join(" | ")})` +
          ` & version_parent = null & cover != null;` +
          ` limit 500;`
      ).catch(() => [])) || [];
    for (const g of rows) {
      const key = String(g.name).toLowerCase();
      const prev = found.get(key);
      // Deux jeux portent parfois le même nom (l'original et son remake muet).
      // On garde le plus commenté : c'est celui que la personne qui lit
      // reconnaîtra.
      if (prev && (prev.count || 0) >= (g.total_rating_count || 0)) continue;
      found.set(key, {
        id: g.id,
        name: g.name,
        cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
        count: g.total_rating_count || 0,
      });
    }
  }
  return found;
}

/**
 * « Il a aussi fait… », pour toute l'équipe d'un jeu.
 *
 * Rend `{ works: [{ qid, games: [...] }] }` — la carte d'une personne y pioche
 * par son `qid`. Une personne sans identifiant Wikidata, ou dont on ne trouve
 * aucun autre jeu, n'y figure tout simplement pas : sa carte s'affiche alors
 * sans rangée de jaquettes, ce qui est la bonne façon de ne rien dire.
 */
export async function creditsWorks(gameId) {
  const doc = await GameCredits.findOne({ gameId }).lean();
  if (doc?.worksVer === WORKS_VER) return { works: doc.works || [] };

  // L'équipe d'abord : c'est elle qui porte les identifiants. Elle est presque
  // toujours déjà en base — la fiche l'a demandée avant d'ouvrir cette page.
  const { people } = doc?.ver === VER ? doc : await gameCredits(gameId);

  // Trente personnes au plus. Au-delà, la requête Wikidata devient longue pour
  // des cartes que personne ne fera défiler jusqu'au bout.
  const qids = [...new Set((people || []).map((p) => p.qid).filter(Boolean))].slice(0, 30);

  const byPerson = await worksFromWikidata(qids).catch(() => new Map());
  const titles = new Set();
  for (const set of byPerson.values()) for (const n of set) titles.add(n);

  const covers = await coversByName(titles).catch(() => new Map());

  const works = [];
  for (const [qid, names] of byPerson) {
    const games = [...names]
      .map((n) => covers.get(n.toLowerCase()))
      .filter((g) => g && g.id !== gameId)
      // Les plus connus devant : sous une vignette, huit jaquettes doivent
      // dire « ah oui, lui », pas dérouler une bibliographie exhaustive.
      .sort((a, b) => b.count - a.count)
      .slice(0, WORKS_PER_PERSON)
      .map(({ count, ...g }) => g);
    if (games.length) works.push({ qid, games });
  }

  // ⚠️ ON N'ENTERRE PAS UNE PANNE. Wikidata tombe, met vingt-cinq secondes à
  // répondre, ou renvoie une erreur de service : dans ces cas-là on n'a rien,
  // et écrire ce rien avec le tampon `worksVer` le figerait pour toujours. On
  // ne grave le résultat que quand la question a VRAIMENT reçu une réponse.
  const answered = !qids.length || byPerson.size > 0;
  if (answered) {
    await GameCredits.updateOne({ gameId }, { $set: { works, worksVer: WORKS_VER } });
  }
  return { works };
}
