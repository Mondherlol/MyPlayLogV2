import GameCredits from "../models/GameCredits.js";
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
const VER = 1;

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

// Découpe la première section d'un article en `{ champ: valeur }`.
function infoboxFields(wikitext) {
  const text = String(wikitext || "");
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

async function crewFromWikipedia(wikiUrl, name) {
  let host = "en.wikipedia.org";
  let title = titleOf(wikiUrl);
  if (wikiUrl) {
    const h = String(wikiUrl).match(/^https?:\/\/([^/]+)/);
    if (h) host = h[1];
  }
  if (!title) {
    const found = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        `${name} video game`
      )}&srlimit=1&format=json`
    );
    title = found?.query?.search?.[0]?.title || null;
  }
  if (!title) return { people: [], url: null, host, title: null };

  const parsed = await getJson(
    `https://${host}/w/api.php?action=parse&page=${encodeURIComponent(
      title
    )}&prop=wikitext&section=0&format=json&redirects=1`
  );
  const fields = infoboxFields(parsed?.parse?.wikitext?.["*"]);

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

  const res = await getJson(
    `https://${host}/w/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(
      titles.join("|")
    )}&prop=pageimages|description&piprop=thumbnail&pithumbsize=320&inprop=url`
  ).catch(() => null);

  const out = new Map();
  for (const page of Object.values(res?.query?.pages || {})) {
    if (page.missing !== undefined) continue;
    out.set(page.title, {
      image: page.thumbnail?.source || null,
      note: page.description || null,
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
      continue;
    }
    merged.set(key, {
      name: p.name,
      roles: [p.role],
      rank: p.rank,
      image: p.image || shot?.image || null,
      link: p.link || shot?.link || null,
      note: p.note || shot?.note || null,
    });
  }

  const people = [...merged.values()]
    .sort((a, b) => a.rank - b.rank)
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
