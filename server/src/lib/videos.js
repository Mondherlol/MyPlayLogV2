import { ytSearch } from "./feed.js";

// Recherche de vidéos type DOCUMENTAIRE / STORYTELLING sur le jeu vidéo
// (histoire de jeux, de studios, de consoles, de développeurs, genèses, essais…).
// Réutilise le scraper YouTube sans clé (ytSearch de feed.js), puis applique un
// filtre de qualité maison : on ne garde que ce qui ressemble vraiment à un docu.
//
// Le filtre repose sur 4 piliers :
//   1. mots-clés POSITIFS obligatoires (documentaire, histoire, genèse…) ;
//   2. mots-clés NÉGATIFS rédhibitoires (let's play, test, review, live…) ;
//   3. langue (FR strict par défaut, EN optionnel) ;
//   4. durée minimale (un docu, c'est long).

const cache = new Map(); // clé de requête -> { ts, data }
const TTL = 30 * 60 * 1000; // 30 min

const MIN_SECONDS = 300; // < 5 min : trop court pour un docu → écarté

// --- Vocabulaire ------------------------------------------------------------
// Signaux « c'est un documentaire / du storytelling ».
const POS_FR = [
  "documentaire", "docu", "histoire de", "l'histoire", "histoire du", "histoire des",
  "genèse", "genese", "la création", "coulisses", "rétrospective", "retrospective",
  "essai", "décryptage", "decryptage", "iceberg", "la saga", "aux origines",
  "aux racines", "naissance", "l'ascension", "la chute", "enquête", "enquete",
  "plongée", "plongee", "chronique", "le mythe", "la légende", "la legende",
  "il était une fois", "grande histoire", "l'incroyable histoire", "comment est né",
  "comment est ne", "qui a créé", "qui a cree", "storytelling",
];
const POS_EN = [
  "documentary", "the story of", "story of", "history of", "the making of",
  "making of", "behind the scenes", "retrospective", "rise and fall",
  "postmortem", "post mortem", "untold story", "untold", "deep dive",
  "the birth of", "the legend of ... story", "how ... was made", "iceberg",
];

// Signaux rédhibitoires : formats qu'on ne veut PAS.
const NEG = [
  "let's play", "lets play", "let s play", "let's", "lets ", "gameplay",
  "walkthrough", "soluce", "solution complète", "solution complete", "speedrun",
  "speed run", "no commentary", "longplay", "long play", "trailer",
  "bande-annonce", "bande annonce", "teaser", "réaction", "reaction", "react",
  "livestream", "en direct", "vlog", "unboxing", "tuto", "tutoriel", "tutorial",
  "astuce", "astuces", "top 10", "top10", "tier list", "classement", "défi",
  "challenge", "montage", "highlights", "best of", "épisode", "episode ",
  "part ", "gameplay fr", "let's go", "first look", "preview", "hands on",
  "hands-on", "all cutscenes", "cutscenes", "film complet", "the movie",
  "guide", "comment battre", "comment finir", "comment débloquer", "wtf",
  "je teste", "on teste",
];
// Tokens courts à matcher sur un mot entier (évite « greaTEST », « conTEST »…).
const NEG_WORDS = [
  "test", "review", "critique", "avis", "live", "stream", "gameplay",
  "vs", "top", "guide", "soluce", "mods", "build", "clip", "clips",
  "react", "preview", "teaser", "ost", "soundtrack", "asmr",
];
const POS_WORD_HINT_FR = ["documentaire", "histoire", "genèse", "genese", "coulisses", "rétrospective", "essai", "légende", "legende"];
const POS_WORD_HINT_EN = ["documentary", "history", "story", "making", "untold", "retrospective"];

// Petits mots très fréquents, utilisés comme détecteur de langue.
const FR_STOP = ["le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "où", "pour", "par", "sur", "dans", "avec", "comment", "pourquoi", "qui", "que", "quoi", "c'est", "l'", "d'", "à", "au", "aux", "son", "ses", "cette", "ce", "notre", "années", "plus", "tout", "toute", "jeu", "jeux", "vidéo", "vidéos"];
const EN_STOP = ["the", "of", "and", "how", "why", "story", "game", "games", "video", "behind", "making", "history", "best", "worst", "ever", "rise", "fall", "console", "gaming", "developer", "studio", "untold", "documentary", "was", "made", "this", "that", "greatest"];

// --- Helpers ----------------------------------------------------------------
function toSeconds(str) {
  if (!str) return 0;
  const parts = String(str).split(":").map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Match « phrase » (avec espaces/apostrophe) via includes ; « mot » seul via
// frontière de mot pour ne pas matcher au milieu d'un autre mot.
function hasPhrase(text, phrase) {
  return text.includes(phrase);
}
function hasWord(text, word) {
  return new RegExp(`(^|[^\\p{L}])${escapeRe(word)}([^\\p{L}]|$)`, "u").test(text);
}
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function countStops(text, list) {
  let n = 0;
  for (const w of list) {
    if (w.includes("'")) {
      if (text.includes(w)) n++;
    } else if (hasWord(text, w)) n++;
  }
  return n;
}

// Évalue une vidéo : renvoie { keep, score }.
function evaluate(v, { en }) {
  const title = (v.title || "").toLowerCase();
  const author = (v.author || "").toLowerCase();
  const hay = `${title} ${author}`;
  const sec = toSeconds(v.duration);

  // Durée : un docu est long.
  if (sec > 0 && sec < MIN_SECONDS) return { keep: false };

  // Rédhibitoire.
  for (const p of NEG) if (hasPhrase(hay, p)) return { keep: false };
  for (const w of NEG_WORDS) if (hasWord(hay, w)) return { keep: false };

  // Signaux positifs (obligatoire : au moins un).
  let pos = 0;
  for (const p of POS_FR) if (hasPhrase(title, p)) pos++;
  const posFr = pos;
  for (const p of POS_EN) if (!p.includes("...") && hasPhrase(title, p)) pos++;
  const posEn = pos - posFr;
  if (pos === 0) return { keep: false };

  // Langue.
  const hasAccent = /[àâäéèêëïîôöùûüçœ]/.test(title);
  const frStops = countStops(title, FR_STOP);
  const enStops = countStops(title, EN_STOP);
  const frHintPos = POS_WORD_HINT_FR.some((w) => title.includes(w));
  const enHintPos = POS_WORD_HINT_EN.some((w) => hasWord(title, w));
  const frSignal = hasAccent || frStops >= 1 || frHintPos || posFr > 0;
  const enSignal = enStops >= 1 || enHintPos || posEn > 0;

  if (!en) {
    // FR strict : on exige un signal français et pas de domination anglaise.
    if (!frSignal) return { keep: false };
    if (enSignal && !frSignal) return { keep: false };
    // Titre clairement anglais malgré tout (bcp de mots EN, aucun FR) → dehors.
    if (enStops >= 2 && frStops === 0 && !hasAccent && posFr === 0)
      return { keep: false };
  } else {
    // Bilingue : il faut au moins une langue identifiable.
    if (!frSignal && !enSignal) return { keep: false };
  }

  // Score : force du signal docu + bonus durée (les longues sont priorisées).
  let score = pos * 4;
  if (sec >= 2700) score += 8; // ≥ 45 min : vrai docu
  else if (sec >= 1200) score += 5; // ≥ 20 min
  else if (sec >= 600) score += 3; // ≥ 10 min
  else score += 1;
  if (frHintPos) score += 2; // titres très explicites

  return { keep: true, score };
}

async function cachedSearch(query) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  const data = await ytSearch(query);
  cache.set(query, { ts: Date.now(), data });
  return data;
}

// Lance plusieurs requêtes, agrège, filtre par qualité, dédoublonne, trie.
async function runQueries(queries, { en }) {
  const lists = await Promise.all(queries.map((q) => cachedSearch(q).catch(() => [])));
  const seen = new Set();
  const out = [];
  for (const v of lists.flat()) {
    if (!v.videoId || v.isShort || !v.duration || seen.has(v.videoId)) continue;
    const { keep, score } = evaluate(v, { en });
    if (!keep) continue;
    seen.add(v.videoId);
    out.push({
      videoId: v.videoId,
      title: v.title,
      author: v.author || "",
      thumb: v.thumb || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: v.duration,
      _score: score,
    });
  }
  return out.sort((a, b) => b._score - a._score);
}

// --- Documentaires ciblant un jeu précis -----------------------------------
export async function searchDocs(gameName, { en = false } = {}) {
  const name = String(gameName || "").trim();
  if (!name) return [];
  const queries = [
    `${name} documentaire`,
    `l'histoire de ${name}`,
    `${name} genèse`,
  ];
  if (en) queries.push(`${name} documentary`, `the making of ${name}`);
  return runQueries(queries, { en });
}

// --- Documentaires « culture jeu vidéo » (consoles, studios, devs, sagas) ---
// Pool tournant : on tire un sous-ensemble à chaque appel pour varier le feed
// et limiter la charge (le cache absorbe les répétitions).
const EVERGREEN_FR = [
  "documentaire histoire du jeu vidéo",
  "documentaire jeu vidéo culte",
  "l'histoire de Nintendo documentaire",
  "l'histoire de PlayStation documentaire",
  "l'histoire de Sega documentaire",
  "l'histoire de Xbox documentaire",
  "documentaire studio jeu vidéo histoire",
  "genèse d'un jeu vidéo documentaire",
  "documentaire développeur jeu vidéo",
  "rétrospective console rétro documentaire",
  "l'histoire d'une saga jeu vidéo",
  "coulisses développement jeu vidéo documentaire",
  "l'incroyable histoire jeu vidéo",
  "aux origines du jeu vidéo documentaire",
];
const EVERGREEN_EN = [
  "video game documentary",
  "history of video games documentary",
  "the making of a video game documentary",
  "gaming studio documentary",
  "console war documentary",
  "the rise and fall video game documentary",
];

function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export async function searchEvergreen({ en = false } = {}) {
  const queries = sample(EVERGREEN_FR, 5);
  if (en) queries.push(...sample(EVERGREEN_EN, 3));
  return runQueries(queries, { en });
}
