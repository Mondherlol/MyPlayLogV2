// La recherche Wikipédia est déjà écrite pour le rayon vidéo : c'est la même
// interrogation, avec un résumé plus long — un synopsis, pas une ligne de choix.
import { wikiSearch } from "./collection.js";

// ======================================================================
//  Métadonnées de comics et de mangas
// ======================================================================
// L'équivalent de TMDB pour le papier — sauf qu'il n'y a pas d'équivalent
// unique, alors on interroge quatre bases, chacune sur son terrain.
//
// ET LE FRANÇAIS PASSE DEVANT. L'app est francophone : un synopsis anglais
// recopié tel quel dans une fiche, c'est une fiche à retraduire à la main, et
// c'est le dos du boîtier qui le porte. Les deux sources qui savent répondre en
// français sont donc interrogées EN PREMIER et remontent en tête de liste ;
// les deux autres ne servent que si elles n'ont rien.
//
//   • MANGADEX (manga, manhwa). Sans clé, et surtout MULTILINGUE : les résumés
//     y sont traduits par la communauté, et le français y est fréquent. Donne
//     aussi la langue d'origine — dont on déduit le SENS DE LECTURE, qui décide
//     de tout dans le lecteur.
//
//   • WIKIPÉDIA FR. La seule source française d'un comic américain. Elle ne
//     connaît que ce qui est notable, mais quand elle répond, elle répond dans
//     la bonne langue et avec le bon vocabulaire.
//
//   • ANILIST (manga, manhwa, one-shots japonais). GraphQL, publique et sans
//     clé. Titres en trois graphies, genres, auteurs, couverture haute
//     définition — mais résumés en anglais.
//
//   • COMICVINE (comics américains). La référence du domaine, mais elle exige
//     une clé et rejette les requêtes sans en-tête d'agent. Optionnelle : sans
//     COMICVINE_API_KEY, la recherche continue sans elle.
//
// TOUTES RATERONT SOUVENT, et c'est normal : ce rayon-ci est fait de one-shots
// promotionnels — le manga Sonic d'un lancement de jeu, un tie-in Marvel — que
// personne ne catalogue. La recherche est donc une COMMODITÉ, pas un passage
// obligé : tout se saisit à la main, et l'archive fournit déjà la couverture.
// Aucun appel ici ne doit pouvoir empêcher de poser un titre.

// Combien on rapporte. Généreux à dessein : ces titres sont des tirages
// annexes noyés dans des catalogues de dizaines de milliers d'entrées, et le
// bon résultat est rarement dans les dix premiers — « Spider-Noir » sort
// derrière toute la série principale. On ratisse donc large et c'est l'œil qui
// tranche, plutôt que de rendre dix lignes dont aucune n'est la bonne.
//
// Une recherche = un appel par base, donc élargir ne coûte pas de requêtes
// supplémentaires : ComicVine plafonne à 200 appels par heure, on en fait un.
const PER_SOURCE = 60;
const MAX_RESULTS = 80;

const UA = "MyPlayLog/1.0 (collection de comics promotionnels)";
const ANILIST = "https://graphql.anilist.co";
const COMICVINE = "https://comicvine.gamespot.com/api";
const MANGADEX = "https://api.mangadex.org";

// Le résumé d'AniList arrive en HTML léger (<br>, <i>, parfois des balises de
// spoiler). On le ramène à du texte : il finira dans un paragraphe et sur le
// dos d'un boîtier peint au canvas, deux endroits qui ne lisent pas de balises.
function plain(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Toute requête sortante est bornée dans le temps. Une base tierce qui ne
// répond pas ne doit pas faire attendre l'admin devant un formulaire figé.
async function fetchJson(url, options = {}, ms = 9000) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  const res = await fetch(url, {
    ...options,
    signal: stop,
    headers: { "User-Agent": UA, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ------------------------------------------------------------- MangaDex ----

// LES ÉTIQUETTES DE MANGADEX SONT EN ANGLAIS, toutes, et elles finissent en
// GENRES sur le dos du boîtier. Le catalogue est fermé et court (une
// quarantaine d'entrées utiles) : le traduire une fois ici coûte moins qu'un
// service de traduction appelé à chaque recherche, et le résultat est
// exactement le mot qu'on aurait choisi. Ce qui manque à la table repasse tel
// quel — un genre inconnu en anglais vaut mieux qu'un trou.
const TAG_FR = {
  Action: "Action",
  Adventure: "Aventure",
  Comedy: "Comédie",
  Crime: "Policier",
  Drama: "Drame",
  Fantasy: "Fantasy",
  Historical: "Historique",
  Horror: "Horreur",
  Isekai: "Isekai",
  "Magical Girls": "Magical girls",
  Mecha: "Mecha",
  Medical: "Médical",
  Mystery: "Mystère",
  Philosophical: "Philosophique",
  Psychological: "Psychologique",
  Romance: "Romance",
  "Sci-Fi": "Science-fiction",
  "Slice of Life": "Tranche de vie",
  Sports: "Sport",
  Superhero: "Super-héros",
  Thriller: "Thriller",
  Tragedy: "Tragédie",
  Wuxia: "Wuxia",
  Oneshot: "One-shot",
  "Award Winning": "Primé",
  "School Life": "Vie scolaire",
  Military: "Militaire",
  Supernatural: "Surnaturel",
  Survival: "Survie",
  Ghosts: "Fantômes",
  Monsters: "Monstres",
  Music: "Musique",
  Cooking: "Cuisine",
  Animals: "Animaux",
  Delinquents: "Délinquance",
  "Post-Apocalyptic": "Post-apocalyptique",
  "Time Travel": "Voyage temporel",
  Villainess: "Vilaine",
  "Video Games": "Jeux vidéo",
  Demons: "Démons",
  Magic: "Magie",
  Samurai: "Samouraïs",
  Ninja: "Ninjas",
  Vampires: "Vampires",
  Zombies: "Zombies",
  Mafia: "Mafia",
  "Martial Arts": "Arts martiaux",
  Police: "Police",
  "Monster Girls": "Monster girls",
  Harem: "Harem",
  "Reverse Harem": "Harem inversé",
  Reincarnation: "Réincarnation",
  Gore: "Gore",
  Aliens: "Extraterrestres",
  Crossdressing: "Travestissement",
  Genderswap: "Changement de sexe",
  "Office Workers": "Monde du travail",
  "Traditional Games": "Jeux traditionnels",
  "Virtual Reality": "Réalité virtuelle",
  "Boys' Love": "Boys' love",
  "Girls' Love": "Girls' love",
  "Sexual Violence": "Violences sexuelles",
  Gyaru: "Gyaru",
  Adaptation: "Adaptation",
  Anthology: "Anthologie",
  "Full Color": "Couleur",
  "Web Comic": "Webcomic",
};

// Le champ multilingue de MangaDex : un objet { fr: "…", en: "…" }. On veut le
// français, sinon l'anglais, sinon ce qui existe — mais on veut aussi SAVOIR
// lequel on a pris, pour le dire à l'écran.
function pickLang(bag) {
  if (!bag || typeof bag !== "object") return { text: "", lang: null };
  if (bag.fr) return { text: bag.fr, lang: "fr" };
  const [lang, text] = Object.entries(bag).find(([, v]) => v) || [];
  return text ? { text, lang: lang === "en" ? "en" : lang } : { text: "", lang: null };
}

// Le titre français d'une œuvre, s'il existe : MangaDex le range tantôt dans le
// titre principal, tantôt dans les titres alternatifs (le principal étant alors
// le romaji). Un manga publié en France a presque toujours un titre français —
// et c'est celui qu'on veut sur le boîtier.
function mangaTitle(a) {
  if (a.title?.fr) return a.title.fr;
  const alt = (a.altTitles || []).find((t) => t.fr);
  if (alt) return alt.fr;
  return a.title?.en || pickLang(a.title).text || "";
}

// Les mangas se lisent de droite à gauche, les manhwas coréens et les manhuas
// chinois de gauche à droite, comme les comics. C'est LE réglage qu'il ne faut
// pas se tromper : à l'envers, le lecteur commence par la fin.
const RTL_LANGS = new Set(["ja"]);

async function searchMangaDex(q) {
  const url =
    `${MANGADEX}/manga?title=${encodeURIComponent(q)}&limit=${PER_SOURCE}` +
    `&includes[]=author&includes[]=artist&includes[]=cover_art` +
    // Sans ce filtre, MangaDex ne renvoie QUE le tout-public : les tirages
    // « suggestive » (la moitié des seinen) manqueraient à l'appel.
    `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
  const data = await fetchJson(url);
  return (data?.data || []).map((m) => {
    const a = m.attributes || {};
    const rel = m.relationships || [];
    const desc = pickLang(a.description);
    const cover = rel.find((r) => r.type === "cover_art")?.attributes?.fileName;
    const authors = rel
      .filter((r) => r.type === "author" || r.type === "artist")
      .map((r) => r.attributes?.name)
      .filter(Boolean);
    return {
      source: "mangadex",
      ref: `mangadex:${m.id}`,
      // La langue du RÉSUMÉ, pas celle de la fiche : c'est le seul champ assez
      // long pour qu'on tienne à savoir dans quelle langue il est.
      lang: desc.lang,
      title: mangaTitle(a),
      originalTitle: a.title?.ja || a.title?.["ja-ro"] || pickLang(a.title).text || "",
      year: a.year || null,
      endYear: null,
      synopsis: plain(desc.text),
      genres: (a.tags || [])
        .filter((t) => t.attributes?.group === "genre" || t.attributes?.group === "theme")
        .map((t) => {
          const en = t.attributes?.name?.en || "";
          return t.attributes?.name?.fr || TAG_FR[en] || en;
        })
        .filter(Boolean)
        .slice(0, 6),
      // 512 px : la couverture sert de vignette dans la liste de choix, pas de
      // jaquette — celle du volume est la première planche de l'archive.
      cover: cover ? `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg` : null,
      backdrop: null,
      authors: [...new Set(authors)].slice(0, 3),
      rating: null,
      readDirection: RTL_LANGS.has(a.originalLanguage) ? "rtl" : "ltr",
      publisher: "",
      link: `https://mangadex.org/title/${m.id}`,
      hint: [a.year, a.status].filter(Boolean).join(" · "),
    };
  });
}

// ------------------------------------------------------------ Wikipédia ----

// La seule source FRANÇAISE d'un comic américain. Elle ne connaît que ce qui
// est notable — inutile d'espérer y trouver un tirage promotionnel — mais quand
// elle répond, elle répond dans la bonne langue.
//
// Elle ne donne ni auteurs ni genres exploitables (l'infobox n'est pas dans
// l'API de résumé) : on ne prend donc que ce qu'elle fait bien, le TEXTE. Le
// reste se complète depuis une autre ligne de la liste, ou à la main.
//
// ET ON NE GARDE QUE CE QUI EST DU PAPIER DESSINÉ. Une recherche plein texte
// sur « Look Back » remonte un single d'Oasis et un album de Boston : ce sont
// de bonnes réponses à la question posée, et de très mauvaises à la question
// qu'on se pose. Le premier paragraphe d'un article dit toujours ce qu'est
// l'œuvre — on lui demande donc de le dire.
const PAPER_RE =
  /\b(manga|manhwa|manhua|comics?|bande dessinée|bandes dessinées|roman graphique|one[- ]shot|webtoon|shōnen|shonen|seinen|shōjo|shojo|josei)\b/i;

async function searchWikiFr(q) {
  const pages = await wikiSearch(q, "fr", 1200);
  return pages
    .filter((p) => PAPER_RE.test(`${p.title} ${p.summary || ""}`))
    .map((p) => ({
      source: "wikipedia",
      ref: `wikipedia:${p.ref}`,
      lang: "fr",
      title: p.title,
      originalTitle: "",
      year: null,
      endYear: null,
      synopsis: p.summary || "",
      genres: [],
      cover: p.poster || null,
      backdrop: null,
      authors: [],
      rating: null,
      readDirection: "",
      publisher: "",
      link: p.url || null,
      hint: "résumé français",
    }));
}

const ANILIST_QUERY = `
query ($q: String, $n: Int) {
  Page(perPage: $n) {
    media(search: $q, type: MANGA, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      description
      coverImage { extraLarge large }
      bannerImage
      startDate { year }
      endDate { year }
      chapters
      volumes
      genres
      countryOfOrigin
      format
      averageScore
      siteUrl
      staff(perPage: 4) { edges { role node { name { full } } } }
    }
  }
}`;

const RTL_ORIGINS = new Set(["JP"]);

async function searchAniList(q) {
  const data = await fetchJson(ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { q, n: PER_SOURCE } }),
  });
  return (data?.data?.Page?.media || []).map((m) => {
    const authors = (m.staff?.edges || [])
      .filter((e) => /story|art/i.test(e.role || ""))
      .map((e) => e.node?.name?.full)
      .filter(Boolean);
    return {
      source: "anilist",
      ref: `anilist:${m.id}`,
      lang: "en",
      title: m.title?.english || m.title?.romaji || m.title?.native || "",
      originalTitle: m.title?.native || m.title?.romaji || "",
      year: m.startDate?.year || null,
      endYear: m.endDate?.year || null,
      synopsis: plain(m.description),
      genres: m.genres || [],
      cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
      backdrop: m.bannerImage || null,
      authors: [...new Set(authors)].slice(0, 3),
      rating: m.averageScore ? Math.round(m.averageScore) / 10 : null,
      readDirection: RTL_ORIGINS.has(m.countryOfOrigin) ? "rtl" : "ltr",
      publisher: "",
      link: m.siteUrl || null,
      hint: [m.format, m.startDate?.year].filter(Boolean).join(" · "),
    };
  });
}

async function searchComicVine(q, key) {
  const url =
    `${COMICVINE}/search/?api_key=${encodeURIComponent(key)}&format=json` +
    `&limit=${PER_SOURCE}&resources=issue,volume&field_list=name,deck,description,image,start_year,cover_date,publisher,volume,issue_number,site_detail_url,id,resource_type` +
    `&query=${encodeURIComponent(q)}`;
  const data = await fetchJson(url);
  return (data?.results || []).map((r) => {
    const volume = r.volume?.name || "";
    const number = r.issue_number ? ` #${r.issue_number}` : "";
    return {
      source: "comicvine",
      ref: `comicvine:${r.resource_type || "issue"}:${r.id}`,
      lang: "en",
      title: r.resource_type === "issue" && volume ? `${volume}${number}` : r.name || "",
      originalTitle: "",
      year: r.start_year
        ? Number(r.start_year)
        : r.cover_date
          ? Number(String(r.cover_date).slice(0, 4))
          : null,
      endYear: null,
      synopsis: plain(r.deck || r.description),
      genres: [],
      cover: r.image?.super_url || r.image?.medium_url || null,
      backdrop: null,
      authors: [],
      rating: null,
      // Un comic se lit de gauche à droite, toujours.
      readDirection: "ltr",
      publisher: r.publisher?.name || "",
      link: r.site_detail_url || null,
      hint: [r.publisher?.name, r.resource_type].filter(Boolean).join(" · "),
    };
  });
}

// Deux listes entrelacées. Mises bout à bout, la première base occuperait tout
// l'écran et la seconde ne serait jamais vue, alors qu'on ne sait pas d'avance
// laquelle a raison.
function weave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

// Cherche dans les quatre bases EN PARALLÈLE, et ne laisse jamais l'échec de
// l'une emporter les autres : ComicVine sans clé, MangaDex en panne, ne doivent
// se traduire que par des résultats en moins.
export async function comicLookup(query) {
  const q = String(query || "").trim();
  // La MÊME forme que le cas nominal : un client qui lit `total` ou `failed`
  // ne doit pas tomber sur `undefined` selon la longueur de ce qu'on a tapé.
  if (q.length < 2)
    return { results: [], comicvine: !!process.env.COMICVINE_API_KEY, total: 0, failed: [] };

  const key = process.env.COMICVINE_API_KEY || "";
  const [dex, wiki, manga, comics] = await Promise.allSettled([
    searchMangaDex(q),
    searchWikiFr(q),
    searchAniList(q),
    key ? searchComicVine(q, key) : Promise.resolve([]),
  ]);
  const got = (r) => (r.status === "fulfilled" ? r.value : []);

  // L'ORDRE EST LA RÉPONSE À « POURQUOI C'EST EN ANGLAIS ». Ce qui parle
  // français d'abord — et à l'intérieur de MangaDex, les fiches qui ont un
  // résumé français avant celles qui n'en ont qu'un anglais. Le reste ensuite.
  // Rien n'est jeté : une base anglaise reste la seule à connaître certains
  // tirages, et c'est l'œil qui tranche.
  const dexFr = got(dex).filter((r) => r.lang === "fr");
  const dexRest = got(dex).filter((r) => r.lang !== "fr");
  const french = weave(dexFr, got(wiki));
  const rest = weave(dexRest, weave(got(manga), got(comics)));
  const out = [...french, ...rest];

  return {
    results: out.slice(0, MAX_RESULTS),
    comicvine: !!key,
    // Ce qui a été trouvé AVANT le plafond : sans ce chiffre, on ne sait pas
    // si la recherche est pauvre ou si l'affichage a coupé.
    total: out.length,
    // Combien parlent français : l'écran s'en sert pour dire « 4 fiches en
    // français » plutôt que de laisser chercher les pastilles à l'œil.
    french: french.length,
    failed: [
      dex.status === "rejected" ? "MangaDex" : null,
      wiki.status === "rejected" ? "Wikipédia" : null,
      manga.status === "rejected" ? "AniList" : null,
      key && comics.status === "rejected" ? "ComicVine" : null,
    ].filter(Boolean),
  };
}
