// ======================================================================
//  Les personnages tirés du WIKI du jeu
// ======================================================================
// ⚠️ POURQUOI UNE QUATRIÈME SOURCE, ET POURQUOI CELLE-LÀ.
//
// Relevé sur les vraies fiches : Super Smash Bros. Ultimate, 0 personnage chez
// IGDB. Persona 5, 0. The Last of Us Part II, 0. Et là où IGDB en a, il n'a
// presque jamais l'image : GTA V, 3 portraits sur 209 ; Red Dead Redemption 2,
// 4 sur 100.
//
// Les rosters officiels (cf. lib/gameCharacters) règlent le cas des
// jeux-services parce que leur éditeur publie le roster lui-même. Mais Naughty
// Dog ne publie pas d'API des personnages de The Last of Us, et Nintendo encore
// moins pour Smash. Pour ces jeux-là — les jeux solo à casting — il faut une
// source encyclopédique. Les autres ont été essayées et MESURÉES :
//
//   • Giant Bomb, le choix évident sur le papier : son API wiki est DÉPRÉCIÉE.
//     `/api/characters` répond « This API endpoint has been deprecated », et la
//     nouvelle API publique ne couvre plus que les vidéos, les shows et les
//     reviews — plus un seul jeu, plus un seul personnage.
//   • Wikidata : donne parfois les bons noms (les trois protagonistes de GTA V)
//     mais quasiment aucune image — un portrait de personnage n'est pas libre
//     de droits, donc pas sur Commons.
//
// Restent les wikis Fandom : ils ont les images, et leur API MediaWiki est
// ouverte, sans clé. Le prix à payer est qu'ils ne sont pas normalisés — d'où
// tout ce qui suit.
//
// -------------------------------------------------- le tri, et c'est le point
// ⚠️ LA TAILLE DE L'ARTICLE FAIT OFFICE DE POPULARITÉ, ET ÇA MARCHE MIEUX QUE
// TOUT LE RESTE. Une liste alphabétique de cent personnages ne vaut pas mieux
// que la liste non triée d'IGDB : ce qu'on veut, c'est les protagonistes en
// premier. Aucun wiki n'expose sa fréquentation (`prop=pageviews` n'existe pas
// chez Fandom), mais les gens écrivent long sur les personnages qui comptent.
// Vérifié avant d'être retenu : sur The Last of Us, le classement par taille
// donne Ellie, Joel, Tommy, Riley, Tess, Marlene, David, Henry — soit
// exactement l'ordre qu'un joueur donnerait.

import GameCache from "../models/GameCache.js";
import { ttlFor } from "./gameIgdb.js";

const KIND = "wikichars";
// À incrémenter quand la forme stockée ou les règles de nettoyage changent.
const VERSION = 6; // v6 : rosters des jeux-services (Genshin, Apex, HSR…), sous-pages écartées
const MAX = 60;

// ----------------------------------------------------------------------
//  Les wikis connus
// ----------------------------------------------------------------------
// ⚠️ UNE TABLE, PARCE QUE LA DEVINETTE SE TROMPE EN SILENCE. Chaque wiki range
// ses personnages autrement : sur celui de The Last of Us, « Characters » ne
// contient que des sous-catégories ; sur celui de Smash, il en contient 540
// tous épisodes confondus ; celui de Red Dead les appelle « Characters in
// Redemption 2 » et celui de Stardew Valley « Villagers ». Une catégorie mal
// devinée ne rate pas bruyamment — elle affiche le casting de la série HBO à la
// place de celui du jeu, et personne ne s'en aperçoit.
//
// Les entrées ci-dessous ont toutes été vérifiées contre le wiki réel. Ajouter
// un jeu, c'est une ligne. Ce que la table ne couvre pas passe par la
// découverte automatique, plus bas, qui refuse de répondre quand elle n'est pas
// sûre.
const KNOWN = [
  { names: ["The Last of Us", "The Last of Us Part I"], host: "thelastofus.fandom.com", category: "The Last of Us Part I characters" },
  { names: ["The Last of Us Part II", "The Last of Us Part II Remastered"], host: "thelastofus.fandom.com", category: "The Last of Us Part II characters" },
  { names: ["Super Smash Bros. Ultimate"], host: "supersmashbros.fandom.com", category: "Characters (SSBU)" },
  { names: ["Persona 5", "Persona 5 Royal"], host: "megamitensei.fandom.com", category: "Persona 5 Characters" },
  { names: ["Grand Theft Auto V"], host: "gta.fandom.com", category: "Characters in GTA V" },
  { names: ["Red Dead Redemption 2"], host: "reddead.fandom.com", category: "Characters in Redemption 2" },
  { names: ["Stardew Valley"], host: "stardewvalley.fandom.com", category: "Villagers" },
  // ⚠️ LES JEUX DE COMBAT : LE ROSTER DE L'ÉPISODE, PAS CELUI DE LA SÉRIE. La
  // découverte automatique tombait sur « Characters », qui mélange trente ans
  // de Tekken (Tekken 8 affichait Kuma, Wang, Mokujin… absents du jeu). Chaque
  // wiki a sa catégorie par épisode ; celle de Street Fighter 6 compte aussi
  // les PNJ du mode World Tour, d'où `playable` (la page doit AUSSI être dans
  // cette catégorie-là). `exclude` écarte l'avatar du joueur et les
  // figurants. `roster` nomme la tier list que ces jeux proposent
  // (cf. routes/lists, GET /suggest/tiers).
  {
    names: ["Tekken 8"],
    host: "tekken.fandom.com",
    category: "Tekken 8 Fighters",
    exclude: /^(avatar|tekken monks)/i,
    roster: { slug: "tekken-8", title: "Tier list des personnages de Tekken 8", unit: "combattants" },
  },
  {
    names: ["Tekken 7"],
    host: "tekken.fandom.com",
    category: "Tekken 7 Fighters",
    roster: { slug: "tekken-7", title: "Tier list des personnages de Tekken 7", unit: "combattants" },
  },
  {
    names: ["Street Fighter 6"],
    host: "streetfighter.fandom.com",
    category: "Street Fighter 6 Characters",
    playable: "Playable Characters",
    exclude: /^avatar/i,
    roster: { slug: "street-fighter-6", title: "Tier list des personnages de Street Fighter 6", unit: "combattants" },
  },
  {
    names: ["Street Fighter V", "Street Fighter V: Champion Edition"],
    host: "streetfighter.fandom.com",
    category: "Street Fighter V Characters",
    playable: "Playable Characters",
    roster: { slug: "street-fighter-5", title: "Tier list des personnages de Street Fighter V", unit: "combattants" },
  },
  // Les jeux-services dont l'éditeur ne publie pas d'API ouverte : leur wiki
  // a une catégorie « jouables » propre et illustrée. `max` : leur roster
  // dépasse les 60 personnages gardés d'habitude, et une tier list amputée
  // de la moitié du roster ne sert à rien.
  {
    names: ["Genshin Impact"],
    host: "genshin-impact.fandom.com",
    category: "Playable Characters",
    max: 160,
    roster: { slug: "genshin", title: "Tier list des personnages de Genshin Impact", unit: "personnages" },
  },
  {
    names: ["Honkai: Star Rail"],
    host: "honkai-star-rail.fandom.com",
    category: "Playable Characters",
    max: 160,
    roster: { slug: "honkai-star-rail", title: "Tier list des personnages de Honkai: Star Rail", unit: "personnages" },
  },
  {
    names: ["Zenless Zone Zero"],
    host: "zenless-zone-zero.fandom.com",
    category: "Playable Agents",
    max: 120,
    roster: { slug: "zzz", title: "Tier list des agents de Zenless Zone Zero", unit: "agents" },
  },
  {
    names: ["Apex Legends"],
    host: "apexlegends.fandom.com",
    category: "Legends",
    exclude: /^legends?$/i,
    roster: { slug: "apex", title: "Tier list des légendes d'Apex Legends", unit: "légendes" },
  },
  {
    names: ["Mortal Kombat 1"],
    host: "mortalkombat.fandom.com",
    category: "Mortal Kombat 1 Characters",
    roster: { slug: "mk1", title: "Tier list des personnages de Mortal Kombat 1", unit: "combattants" },
  },
  {
    names: ["Hades"],
    host: "hades.fandom.com",
    category: "Characters",
    roster: { slug: "hades", title: "Tier list des personnages de Hades", unit: "personnages" },
  },
];

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");

const BY_NAME = new Map();
for (const w of KNOWN) for (const n of w.names) BY_NAME.set(norm(n), w);

// Ni un personnage, ni une page d'article : les pages de liste, les pages
// d'index (« Characters in Redemption 2 », qui porte le nom de sa propre
// catégorie) et les galeries d'images que les wikis rangent au milieu des
// personnages.
const NOT_A_CHARACTER =
  /^(list of|category:|template:|file:|characters?\b)|character (deaths|images)|^unnamed/i;

// « Kazuya (Super Smash Bros. Ultimate) » → « Kazuya ». Le wiki désambiguïse
// dans le titre ; sur une vignette, la parenthèse est du bruit.
const stripDisambig = (title) => String(title).replace(/\s*\([^)]*\)\s*$/, "").trim();

async function mediawiki(host, params) {
  const res = await fetch(`https://${host}/api.php?format=json&${params}`, {
    headers: { Accept: "application/json", "User-Agent": "MyPlayLog/1.0 (+https://myplaylog.fr)" },
  });
  if (!res.ok) throw new Error(`${host} → ${res.status}`);
  return res.json();
}

// ⚠️ ON PAGINE LARGE, SINON LE TRI NE SERT À RIEN. MediaWiki rend les membres
// d'une catégorie par ORDRE ALPHABÉTIQUE : trier par taille d'article ce qu'on
// a lu de A à J, c'est classer un demi-casting. Mesuré sur « Characters in
// GTA V », qui compte plus de 500 entrées : à cent par requête, Michael De
// Santa et Trevor Philips tombaient hors de la fenêtre et n'apparaissaient
// nulle part sur la fiche de leur propre jeu.
//
// 500 par requête (le maximum), trois requêtes : 1500 membres, de quoi couvrir
// les catégories les plus fournies. Et c'est mis en cache pour des mois, donc
// payé une fois.
const PER_PAGE = 500;
const MAX_PAGES = 3;

/**
 * Les pages d'une catégorie, avec leur vignette et la taille de leur article.
 *
 * `generator=categorymembers` plutôt que deux requêtes : la liste ET les
 * images arrivent ensemble, sinon il faudrait redemander page par page.
 */
async function categoryPages(host, category, maxPages = MAX_PAGES, playable = null) {
  // Pas de `pilimit` : Fandom ne le reconnaît pas (il le signale en warning) et
  // rend de toute façon une vignette par page.
  // `playable` : on demande en plus si chaque page est AUSSI dans cette
  // catégorie (`clcategories`) — un seul aller, le filtre se fait ensuite.
  const base =
    `action=query&generator=categorymembers&gcmtitle=Category:${encodeURIComponent(category)}` +
    `&gcmlimit=${PER_PAGE}&gcmtype=page&piprop=thumbnail&pithumbsize=400` +
    (playable
      ? `&prop=pageimages|info|categories&cllimit=max&clcategories=Category:${encodeURIComponent(playable)}`
      : "&prop=pageimages|info");

  const out = [];
  let cont = null;
  for (let i = 0; i < maxPages; i += 1) {
    const body = await mediawiki(host, cont ? `${base}&${cont}` : base);
    // Les continuations peuvent rendre une même page en deux fois (une avec sa
    // vignette, l'autre avec ses catégories) : on fusionne par identifiant.
    for (const pg of Object.values(body?.query?.pages || {})) {
      const prev = out.find((x) => x.pageid === pg.pageid);
      if (prev) Object.assign(prev, Object.fromEntries(Object.entries(pg).filter(([, v]) => v != null)));
      else out.push(pg);
    }
    // La continuation se rend telle quelle : elle porte plusieurs curseurs
    // (les membres de la catégorie ET les vignettes), et n'en renvoyer qu'un
    // ferait boucler la requête sur elle-même.
    if (!body?.continue) break;
    cont = new URLSearchParams(body.continue).toString();
  }
  return out;
}

/**
 * À défaut d'entrée dans la table : on essaie, et on n'accepte que du solide.
 *
 * Le garde-fou est le point important. Une catégorie qui rend trois pages, ou
 * dont la moitié n'a pas d'image, n'est pas la bonne : mieux vaut ne rien
 * afficher que d'afficher le mauvais casting avec assurance.
 */
async function discover(host, gameName) {
  const candidates = [
    `Characters in ${gameName}`,
    `${gameName} characters`,
    `${gameName} Characters`,
    "Characters",
    "Playable characters",
  ];
  for (const category of candidates) {
    // Une seule page pour SONDER : cinq candidates à quatre pages chacune, ce
    // serait vingt requêtes sur un wiki qui, la plupart du temps, n'a aucune
    // de ces catégories. On ne pagine que celle qui a répondu.
    const probe = await categoryPages(host, category, 1).catch(() => []);
    const withImage = probe.filter((p) => p.thumbnail).length;
    if (probe.length >= 8 && withImage / probe.length >= 0.6) {
      return probe.length < PER_PAGE ? probe : categoryPages(host, category).catch(() => probe);
    }
  }
  return [];
}

/** Le wiki du jeu : celui qu'on connaît, celui qu'IGDB indique, ou une devinette. */
function hostFor(gameName, websites) {
  const known = BY_NAME.get(norm(gameName));
  if (known) return known.host;
  // IGDB range le wiki du jeu dans ses liens (type 2 = wikia/fandom). Quand il
  // l'a, c'est mieux que n'importe quelle devinette.
  for (const w of websites || []) {
    const url = String(w?.url || "");
    if (!/fandom\.com|wikia\.com/i.test(url)) continue;
    const host = url.replace(/^https?:\/\//, "").split("/")[0];
    // Les vieilles entrées pointent encore sur wikia.com, qui redirige — on
    // vise fandom.com directement, l'API ne suit pas toujours.
    if (host) return host.replace(/\.wikia\.com$/i, ".fandom.com");
  }
  const slug = norm(gameName);
  return slug ? `${slug}.fandom.com` : null;
}

async function fetchFromWiki(gameName, websites) {
  const host = hostFor(gameName, websites);
  if (!host) return [];

  const known = BY_NAME.get(norm(gameName));
  const pages = known
    ? await categoryPages(host, known.category, MAX_PAGES, known.playable).catch(() => [])
    : await discover(host, gameName);

  return cleanPages(pages, known);
}

// Le tri des pages d'une catégorie en personnages : pas d'index, pas de
// sous-pages (« Pathfinder/ru » : les traductions du wiki), le filtre
// « jouable » et les exclusions de la table, puis les plus longs articles
// d'abord (voir l'en-tête du module).
function cleanPages(pages, known) {
  return pages
    .filter((p) => p?.title && !NOT_A_CHARACTER.test(p.title))
    .filter((p) => !p.title.includes("/") || known?.slashOk)
    .filter((p) => !known?.playable || p.categories?.length)
    .filter((p) => !known?.exclude?.test(p.title))
    .sort((a, b) => (b.length || 0) - (a.length || 0))
    .slice(0, known?.max || MAX)
    .map((p) => ({
      id: `wiki-${p.pageid}`,
      name: stripDisambig(p.title).slice(0, 120),
      image: p.thumbnail?.source || null,
    }))
    .filter((c) => c.name);
}

/**
 * Les personnages du wiki du jeu, avec cache en base.
 *
 * Le cache est celui d'IGDB (`GameCache`), même table et même règle de
 * fraîcheur : c'est l'âge du jeu qui décide, et le casting d'un jeu de 2013 ne
 * bouge plus. Sans lui, chaque ouverture de fiche irait taper le wiki.
 */
export async function wikiCharacters(gameId, gameName, websites, releaseDate = null) {
  if (!gameId || !gameName) return [];

  try {
    const doc = await GameCache.findOne({ gameId, kind: KIND }).lean();
    if (
      doc &&
      doc.ver === VERSION &&
      Date.now() - new Date(doc.updatedAt).getTime() < ttlFor(doc.releaseDate)
    ) {
      return doc.payload || [];
    }

    const characters = await fetchFromWiki(gameName, websites);
    // On écrit même une liste vide : la plupart des jeux n'ont pas de wiki
    // exploitable, et reposer la question à chaque ouverture de leur fiche
    // serait une requête pour rien, à chaque fois.
    await GameCache.updateOne(
      { gameId, kind: KIND },
      { $set: { ver: VERSION, releaseDate, payload: characters } },
      { upsert: true }
    ).catch(() => {});
    return characters;
  } catch (err) {
    console.error("wiki characters error:", err.message);
    return [];
  }
}

/**
 * La tier list de roster qu'un jeu propose (`{ slug, title, unit }`), quand
 * son wiki en donne un fiable — les jeux de combat de la table plus haut.
 */
export function wikiRoster(gameName) {
  return BY_NAME.get(norm(gameName))?.roster || null;
}

/**
 * Les pages illustrées d'une catégorie de wiki, triées comme les personnages
 * (les plus longs articles d'abord). Sert aux tier lists qui ne sont pas des
 * personnages — les boss d'Elden Ring, les monstres de Monster Hunter, les
 * armes 5★ de Genshin (cf. lib/tierSets). Pas de cache ici : c'est l'appelant
 * qui garde le résultat.
 */
export async function wikiCategoryItems(host, category, { max = 80, exclude = null, slashOk = false } = {}) {
  const pages = await categoryPages(host, category).catch(() => []);
  return cleanPages(pages, { max, exclude, slashOk })
    .filter((c) => c.image)
    .map((c) => ({ key: c.id.replace(/^wiki-/, ""), name: c.name, image: c.image }));
}
