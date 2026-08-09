import mongoose from "mongoose";
import QuizQuestion from "../models/QuizQuestion.js";
import QuizSeen from "../models/QuizSeen.js";
import { igdbQuery } from "./igdb.js";
import { IMG, shuffle, sample } from "../routes/blindtest.js";

// ======================================================================
//  La banque de questions : ce qu'on demande, et d'où ça sort
// ======================================================================
// Deux robinets, mélangés au tirage :
//
//   • LA BANQUE RÉDIGÉE (models/QuizQuestion.js) — le seed écrit à la main et
//     les questions Gemini relues. C'est la bonne matière : des questions qui
//     ont une tournure, une chute, une explication qui apprend quelque chose.
//     Son défaut est d'être FINIE, et de s'épuiser d'autant plus vite qu'on
//     joue souvent.
//   • LES FAITS IGDB — fabriqués ici même à partir des données du catalogue.
//     Leur tournure est mécanique (« En quelle année est sorti X ? ») mais ils
//     sont infinis, gratuits, et rigoureusement exacts. Ils servent de fond de
//     roulement : c'est eux qui garantissent qu'une partie démarre TOUJOURS,
//     même sur une base fraîchement installée où la banque est vide.
//
// La proportion visée est dans BANK_SHARE. On ne la tient pas à tout prix : si
// la banque n'a pas assez de questions inédites pour ce joueur, les faits
// comblent, et inversement. Une partie qui refuse de se lancer parce qu'il
// manque deux questions serait le pire des deux mondes.
const BANK_SHARE = 0.6;

// ============================================================
//  Le vivier de faits
// ============================================================
// Un lot de jeux notoires avec TOUT ce qu'il faut pour fabriquer une question :
// année, studio, genres, plateformes. Mis en cache pour la journée, comme le
// pool de gros jeux du blind test — ces données ne bougent pas d'une heure à
// l'autre, et une partie ne doit pas attendre IGDB pour démarrer.
//
// Le seuil de notoriété (`total_rating_count`) est plus haut que celui du blind
// test : une question de culture générale doit porter sur un jeu que le joueur
// a une chance de connaître SANS y avoir joué. Deviner l'année de sortie d'un
// jeu de niche n'est pas une question de culture, c'est un tirage au sort.
let factCache = { day: 0, games: [] };

// ============================================================
//  Les plateformes qu'on accepte de citer
// ============================================================
// IGDB renvoie l'abréviation quand elle existe, et son catalogue en compte de
// parfaitement illisibles : « fds » (Family Computer Disk System), « ngage »,
// « bbcm »… Une carte de duel qui annonce « Plateforme : fds » ne pose pas une
// question difficile, elle pose une question incompréhensible — le joueur ne
// sait même pas de quoi on parle.
//
// On travaille donc sur une LISTE BLANCHE, avec nos propres libellés. Ce qui
// n'y figure pas est simplement ignoré : mieux vaut un jeu sans carte
// « plateforme » qu'une carte que personne ne peut trancher.
//
// Elle sert aux trois endroits qui parlent de machines : la question à choix
// multiples (qPlatform), la carte de duel, et le critère de tri.
const PLATFORM_LABELS = new Map(
  Object.entries({
    "PC (Microsoft Windows)": "PC",
    Mac: "Mac",
    Linux: "Linux",
    "PlayStation 5": "PlayStation 5",
    "PlayStation 4": "PlayStation 4",
    "PlayStation 3": "PlayStation 3",
    "PlayStation 2": "PlayStation 2",
    PlayStation: "PlayStation",
    "PlayStation Portable": "PSP",
    "PlayStation Vita": "PS Vita",
    "Xbox Series X|S": "Xbox Series",
    "Xbox One": "Xbox One",
    "Xbox 360": "Xbox 360",
    Xbox: "Xbox",
    "Nintendo Switch": "Nintendo Switch",
    "Nintendo Switch 2": "Nintendo Switch 2",
    "Wii U": "Wii U",
    Wii: "Wii",
    "Nintendo GameCube": "GameCube",
    "Nintendo 64": "Nintendo 64",
    "Super Nintendo Entertainment System": "Super Nintendo",
    "Nintendo Entertainment System": "NES",
    "Nintendo 3DS": "Nintendo 3DS",
    "Nintendo DS": "Nintendo DS",
    "Game Boy Advance": "Game Boy Advance",
    "Game Boy Color": "Game Boy Color",
    "Game Boy": "Game Boy",
    "Sega Mega Drive/Genesis": "Mega Drive",
    "Sega Saturn": "Saturn",
    Dreamcast: "Dreamcast",
    "Sega Master System/Mark III": "Master System",
    Arcade: "Arcade",
    Android: "Android",
    iOS: "iOS",
  })
);

// Les plateformes présentables d'un jeu, dédoublonnées.
function cleanPlatforms(list) {
  const out = [];
  for (const p of list || []) {
    const label = PLATFORM_LABELS.get(p?.name);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export async function getFactPool() {
  const day = Math.floor(Date.now() / 86400000);
  if (factCache.day === day && factCache.games.length) return factCache.games;
  try {
    const q =
      "fields name, first_release_date, cover.image_id, genres.name," +
      // Le nom complet seulement : les abréviations d'IGDB sont illisibles
      // (cf. PLATFORM_LABELS), on ne s'en sert plus.
      " platforms.name," +
      " involved_companies.company.name, involved_companies.developer," +
      // `total_rating` et `game_modes` servent aux affirmations du duel
      // (« a la meilleure note », « se joue à plusieurs ») — cf. duelClaims
      // dans lib/quizRounds.js.
      " involved_companies.publisher, total_rating, total_rating_count, game_modes.name;" +
      " where cover != null & version_parent = null & game_type = (0,8,9)" +
      " & first_release_date != null & total_rating_count > 250;" +
      " sort total_rating_count desc; limit 400;";
    const raw = await igdbQuery("games", q);
    const games = raw
      .map((g) => {
        const dev = (g.involved_companies || []).find((c) => c.developer)?.company?.name;
        const pub = (g.involved_companies || []).find((c) => c.publisher)?.company?.name;
        return {
          id: g.id,
          name: g.name,
          cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
          year: g.first_release_date
            ? new Date(g.first_release_date * 1000).getUTCFullYear()
            : null,
          studio: dev || null,
          publisher: pub || null,
          genres: (g.genres || []).map((x) => x.name).filter(Boolean),
          platforms: cleanPlatforms(g.platforms),
          rating: g.total_rating != null ? Math.round(g.total_rating) : null,
          votes: g.total_rating_count || 0,
          modes: (g.game_modes || []).map((x) => x.name).filter(Boolean),
        };
      })
      .filter((g) => g.year);
    if (games.length) factCache = { day, games };
  } catch (err) {
    console.error("quiz fact pool error:", err.message);
  }
  return factCache.games;
}

// ============================================================
//  Les gabarits de questions factuelles
// ============================================================
// Chacun prend le vivier et rend une question complète, ou `null` s'il n'a pas
// la matière (un jeu sans studio connu, un genre trop rare pour trouver trois
// leurres…). C'est volontairement permissif : un gabarit qui renonce coûte un
// tirage de plus, un gabarit qui force produit une question fausse.
//
// RÈGLE COMMUNE DES LEURRES : ils doivent être PLAUSIBLES et INCONTESTABLEMENT
// FAUX. Un leurre invraisemblable rend la question gratuite ; un leurre qui
// pourrait aussi être vrai rend la question injuste. D'où les écarts imposés
// (deux ans minimum entre les années proposées) et les vérifications de
// non-appartenance (une plateforme leurre ne doit figurer sur AUCUNE édition).

// Quatre années distinctes autour de la bonne, écartées d'au moins deux ans :
// proposer 2014/2015/2016/2017 pour un jeu de 2015 se joue à la loterie.
function yearDecoys(year) {
  const out = new Set();
  let guard = 0;
  while (out.size < 3 && guard < 60) {
    guard += 1;
    const delta = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 6));
    const y = year + delta;
    // Pas d'année avant l'arcade, pas d'année dans le futur.
    if (y < 1975 || y > new Date().getFullYear()) continue;
    if (Math.abs(y - year) < 2) continue;
    if ([...out].some((o) => Math.abs(o - y) < 2)) continue;
    out.add(y);
  }
  return [...out];
}

function qYear(pool) {
  const g = sample(pool.filter((x) => x.year));
  if (!g) return null;
  const decoys = yearDecoys(g.year);
  if (decoys.length < 3) return null;
  return {
    kind: "qcm",
    text: `En quelle année est sorti ${g.name} ?`,
    choices: [String(g.year), ...decoys.map(String)],
    explain: `${g.name} est sorti en ${g.year}.`,
    theme: "dates",
    gameId: g.id,
    cover: g.cover,
    difficulty: 3,
  };
}

function qStudio(pool) {
  const withStudio = pool.filter((x) => x.studio);
  const g = sample(withStudio);
  if (!g) return null;
  // Leurres : d'autres studios du vivier, jamais celui du jeu.
  const others = [
    ...new Set(withStudio.map((x) => x.studio).filter((s) => s && s !== g.studio)),
  ];
  if (others.length < 3) return null;
  return {
    kind: "qcm",
    text: `Quel studio a développé ${g.name} ?`,
    choices: [g.studio, ...shuffle(others).slice(0, 3)],
    explain: `${g.name} a été développé par ${g.studio}${
      g.publisher && g.publisher !== g.studio ? `, édité par ${g.publisher}` : ""
    }.`,
    theme: "studios",
    gameId: g.id,
    cover: g.cover,
    difficulty: 3,
  };
}

function qPlatform(pool) {
  const g = sample(pool.filter((x) => x.platforms.length));
  if (!g) return null;
  const mine = new Set(g.platforms);
  // Leurres : des plateformes du catalogue sur lesquelles le jeu N'EST PAS.
  const all = [...new Set(pool.flatMap((x) => x.platforms))].filter((p) => !mine.has(p));
  if (all.length < 3) return null;
  return {
    kind: "qcm",
    text: `Sur laquelle de ces plateformes ${g.name} est-il sorti ?`,
    choices: [sample(g.platforms), ...shuffle(all).slice(0, 3)],
    explain: `${g.name} est sorti sur : ${g.platforms.slice(0, 5).join(", ")}.`,
    theme: "machines",
    gameId: g.id,
    cover: g.cover,
    difficulty: 2,
  };
}

// « Lequel est sorti en premier ? » — quatre jeux d'années franchement
// distinctes. C'est le gabarit le plus intéressant du lot : il ne teste pas
// une date apprise par cœur mais un ordre, ce qu'on sait vraiment quand on a
// suivi l'histoire du médium.
function qOldest(pool) {
  const picks = [];
  const used = new Set();
  const shuffled = shuffle(pool.filter((x) => x.year));
  for (const g of shuffled) {
    if (picks.length >= 4) break;
    // Au moins trois ans d'écart avec tous les autres : sinon la question se
    // joue sur un détail que même un connaisseur ne tranche pas.
    if (picks.some((p) => Math.abs(p.year - g.year) < 3)) continue;
    if (used.has(g.name)) continue;
    used.add(g.name);
    picks.push(g);
  }
  if (picks.length < 4) return null;
  const oldest = picks.reduce((a, b) => (a.year < b.year ? a : b));
  return {
    kind: "qcm",
    text: "Lequel de ces jeux est sorti en premier ?",
    choices: [oldest.name, ...picks.filter((p) => p !== oldest).map((p) => p.name)],
    explain: picks
      .slice()
      .sort((a, b) => a.year - b.year)
      .map((p) => `${p.name} (${p.year})`)
      .join(" · "),
    theme: "dates",
    gameId: oldest.id,
    cover: oldest.cover,
    difficulty: 3,
  };
}

// « Lequel N'A PAS été développé par X ? » — demande trois jeux du même studio,
// donc ne marche que pour les studios bien représentés dans le vivier.
function qNotByStudio(pool) {
  const byStudio = new Map();
  for (const g of pool) {
    if (!g.studio) continue;
    if (!byStudio.has(g.studio)) byStudio.set(g.studio, []);
    byStudio.get(g.studio).push(g);
  }
  const eligible = [...byStudio.entries()].filter(([, gs]) => gs.length >= 3);
  if (!eligible.length) return null;
  const [studio, games] = sample(eligible);
  const three = shuffle(games).slice(0, 3);
  const intruder = sample(pool.filter((g) => g.studio && g.studio !== studio));
  if (!intruder) return null;
  return {
    kind: "qcm",
    text: `Lequel de ces jeux n'a PAS été développé par ${studio} ?`,
    choices: [intruder.name, ...three.map((g) => g.name)],
    explain: `${intruder.name} est signé ${intruder.studio}. Les trois autres sont bien de ${studio}.`,
    theme: "studios",
    gameId: intruder.id,
    cover: intruder.cover,
    difficulty: 4,
  };
}

function qGenre(pool) {
  const g = sample(pool.filter((x) => x.genres.length));
  if (!g) return null;
  const mine = new Set(g.genres);
  const all = [...new Set(pool.flatMap((x) => x.genres))].filter((x) => !mine.has(x));
  if (all.length < 3) return null;
  return {
    kind: "qcm",
    text: `À quel genre appartient ${g.name} ?`,
    choices: [sample(g.genres), ...shuffle(all).slice(0, 3)],
    explain: `${g.name} : ${g.genres.join(", ")}.`,
    theme: "genres",
    gameId: g.id,
    cover: g.cover,
    difficulty: 2,
  };
}

const FACT_TEMPLATES = [qYear, qStudio, qPlatform, qOldest, qNotByStudio, qGenre];

// Fabrique jusqu'à `count` questions factuelles distinctes. On tire un gabarit
// au hasard à chaque tour plutôt que de les parcourir en boucle : sinon une
// partie de six questions donnerait toujours exactement un exemplaire de
// chaque, dans le même ordre.
export async function makeFactQuestions(count, { excludeGames = new Set() } = {}) {
  const pool = (await getFactPool()).filter((g) => !excludeGames.has(g.id));
  if (pool.length < 12) return [];
  const out = [];
  const usedText = new Set();
  const usedGames = new Set();
  for (let i = 0; i < count * 12 && out.length < count; i += 1) {
    const tpl = sample(FACT_TEMPLATES);
    const q = tpl(pool.filter((g) => !usedGames.has(g.id)));
    if (!q) continue;
    if (usedText.has(q.text)) continue;
    usedText.add(q.text);
    if (q.gameId) usedGames.add(q.gameId);
    out.push({ ...q, source: "igdb", key: `f:${q.text}` });
  }
  return out;
}

// ============================================================
//  Le tirage dans la banque rédigée
// ============================================================
// `$sample` de MongoDB plutôt qu'un tri aléatoire : sur une banque qui a
// vocation à grossir, trier tous les documents pour en garder huit serait du
// gâchis. Le filtre `approved` est non négociable — une question Gemini non
// relue ne doit jamais atteindre un joueur (cf. models/QuizQuestion.js).
export async function drawBankQuestions(count, { excludeIds = [], kinds } = {}) {
  if (count <= 0) return [];
  const match = { approved: true };
  if (kinds?.length) match.kind = { $in: kinds };
  if (excludeIds.length)
    match._id = { $nin: excludeIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  try {
    const rows = await QuizQuestion.aggregate([{ $match: match }, { $sample: { size: count } }]);
    return rows.map((r) => ({
      kind: r.kind,
      text: r.text,
      choices: r.choices || [],
      answer: r.answer,
      explain: r.explain || "",
      theme: r.theme || "",
      gameId: r.gameId || null,
      cover: null,
      difficulty: r.difficulty || 3,
      source: r.source || "seed",
      key: `q:${r._id}`,
      questionId: String(r._id),
    }));
  } catch (err) {
    console.error("quiz bank draw error:", err.message);
    return [];
  }
}

// ============================================================
//  Ce que ce joueur a déjà vu
// ============================================================
// Renvoie une Map `type d'épreuve → Set(références)`. Le découpage PAR ÉPREUVE
// est le point important : un jeu déjà tombé en emojis peut parfaitement
// revenir en capture pixelisée — ce n'est pas la même énigme. Le confondre
// reviendrait à brûler un jeu pour tout le quiz dès qu'il a servi une fois.
//
// Les références sont préfixées par nature (cf. models/QuizSeen.js) :
//   « q:<id> » une question de la banque, « g:<gameId> » un jeu,
//   « s:<studio> », « c:<critère> », « d:<duel> », « f:<réponse> ».
export async function seenByType(userId) {
  const out = new Map();
  if (!userId) return out;
  try {
    const rows = await QuizSeen.find({ user: userId }).select("ref type").lean();
    for (const r of rows) {
      if (!out.has(r.type)) out.set(r.type, new Set());
      out.get(r.type).add(r.ref);
    }
  } catch {
    /* pas de mémoire : on rejouera peut-être une question, ce n'est pas grave */
  }
  return out;
}

// Les identifiants de questions déjà posées, toutes épreuves confondues.
// Une question de culture est la même quelle que soit l'épreuve qui la sert,
// donc ici on ne découpe pas.
export function seenQuestionIds(seen) {
  const ids = [];
  for (const set of seen.values())
    for (const ref of set) if (ref.startsWith("q:")) ids.push(ref.slice(2));
  return ids;
}

// ============================================================
//  L'entrée publique : N questions prêtes à poser
// ============================================================
// Renvoie des questions NORMALISÉES : propositions déjà mélangées, index de la
// bonne réponse calculé après mélange. Le mélange se fait ICI, une fois, et
// jamais au client — c'est la seule façon d'être sûr que la réponse envoyée au
// navigateur (un index) désigne bien ce qu'il affiche.
//
// Un vrai/faux devient un QCM à deux propositions : côté client, une seule
// épreuve à écrire, avec deux boutons au lieu de quatre.
export async function buildQuestions(count, { excludeQuestionIds = [], excludeGames = new Set() } = {}) {
  const wantBank = Math.round(count * BANK_SHARE);
  const bank = await drawBankQuestions(wantBank, { excludeIds: excludeQuestionIds });
  // Ce que la banque n'a pas pu fournir, les faits le comblent — et
  // réciproquement si le vivier IGDB est indisponible.
  const facts = await makeFactQuestions(count - bank.length, { excludeGames });
  let all = [...bank, ...facts];
  if (all.length < count) {
    const more = await drawBankQuestions(count - all.length, {
      excludeIds: [...excludeQuestionIds, ...all.map((q) => q.questionId).filter(Boolean)],
    });
    all = [...all, ...more];
  }

  return shuffle(all)
    .slice(0, count)
    .map((q) => {
      // Vrai/faux → QCM à deux propositions, la bonne en tête.
      const raw =
        q.kind === "truefalse"
          ? q.answer
            ? ["Vrai", "Faux"]
            : ["Faux", "Vrai"]
          : q.choices;
      const correct = raw[0];
      const choices = shuffle(raw);
      return {
        kind: q.kind,
        text: q.text,
        choices,
        answerIndex: choices.indexOf(correct),
        explain: q.explain,
        theme: q.theme,
        gameId: q.gameId,
        cover: q.cover,
        difficulty: q.difficulty,
        source: q.source,
        key: q.key,
        questionId: q.questionId || null,
      };
    });
}

// Compteurs de terrain (cf. models/QuizQuestion.js) : le seul garde-fou APRÈS
// mise en service. Best-effort, jamais bloquant.
export function recordAnswers(stats) {
  const ops = [];
  for (const [questionId, { asked, correct }] of stats) {
    if (!questionId || !mongoose.isValidObjectId(questionId)) continue;
    ops.push({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(questionId) },
        update: { $inc: { timesAsked: asked, timesCorrect: correct } },
      },
    });
  }
  if (!ops.length) return;
  QuizQuestion.bulkWrite(ops, { ordered: false }).catch((e) =>
    console.error("quiz stats error:", e.message)
  );
}
