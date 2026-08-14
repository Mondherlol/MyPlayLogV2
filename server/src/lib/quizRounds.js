import UserGame from "../models/UserGame.js";
import User from "../models/User.js";
import GameTime from "../models/GameTime.js";
import QuizEmoji from "../models/QuizEmoji.js";
import { igdbQuery } from "./igdb.js";
import { buildQuestions, getFactPool, seenByType, seenQuestionIds } from "./quizBank.js";
import {
  IMG,
  shuffle,
  sample,
  getFamousPool,
  keepRealGames,
  attachAltNames,
} from "../routes/blindtest.js";
import { shotsForGames } from "../routes/pixel.js";

// ======================================================================
//  Le moteur d'épreuves du Grand Quiz
// ======================================================================
// Huit façons de poser une question, et une seule promesse tenue vis-à-vis du
// reste du code : `buildQuizRounds()` rend un tableau de manches qui portent
// TOUTES leur type, leur durée, leur énigme et leur solution. Ce que la route
// solo, la route versus et le récap en font ensuite ne dépend que de `type`.
//
// ------------------------------------------------- pourquoi un moteur commun
// La tentation était d'écrire huit petits jeux côte à côte. On aurait alors eu
// huit fois le même travail ingrat — aller chercher des jeux crédibles, écarter
// les bundles, éviter de reposer deux fois le même titre dans la partie, tenir
// une liste de recherche unique — avec huit occasions de le faire un peu
// différemment. Le tirage des jeux, l'exclusion des doublons et la liste de
// candidats sont donc mutualisés ici ; il ne reste dans chaque `build*` que ce
// qui fait la singularité de l'épreuve.
//
// ------------------------------------------------------------ la solution
// Chaque manche transporte sa réponse. Ce qui en sort au client dépend du
// mode, et c'est la SEULE différence de traitement entre solo et versus :
//
//   • en SOLO, on envoie tout (cf. `publicRound(r, { reveal: true })`). C'est
//     le choix déjà assumé par le blind test et Pixel Rush : la triche par
//     console est possible, elle ne lèse que le tricheur, et l'alternative
//     (un aller-retour serveur par réponse) rendrait le jeu poussif ;
//   • en VERSUS, la réponse reste au serveur jusqu'à la révélation, parce
//     qu'un tricheur y vole la manche des autres.

// ============================================================
//  Les huit épreuves
// ============================================================
// `mode` décide de la mécanique du versus (cf. models/QuizVersus.js) :
// « buzzer » = le premier bon clôt la manche ; « parallel » = tout le monde
// joue jusqu'au bout et marque au prorata.
//
// Les durées ne sont pas interchangeables. Un QCM se tranche en quinze
// secondes ; un duel de cartes demande de lire six étiquettes, de les
// comprendre et de les déposer — à vingt secondes il devient un jeu de rapidité
// au clic, ce qu'il n'est pas censé être.
export const TYPE_META = {
  qcm: { label: "Question", durationSec: 20, mode: "buzzer", icon: "list" },
  emoji: { label: "Emojis", durationSec: 40, mode: "buzzer", icon: "smile" },
  studio: { label: "Le studio", durationSec: 50, mode: "parallel", icon: "building" },
  duel: { label: "Duel", durationSec: 55, mode: "parallel", icon: "swords" },
  pixel: { label: "Pixels", durationSec: 30, mode: "buzzer", icon: "grid" },
  swipe: { label: "Le tri", durationSec: 30, mode: "parallel", icon: "layers" },
  // Une minute trente, et autant d'essais qu'on veut : une anagramme se
  // travaille en essayant des combinaisons à voix haute, pas en jouant sa vie
  // sur trois propositions. La sanction reste dans le barème (chaque essai raté
  // rogne les points), pas dans une élimination.
  anagram: { label: "Lettres mêlées", durationSec: 90, mode: "buzzer", icon: "shuffle" },
  // La plus longue du lot, et de loin : cinq essais successifs, chacun demandant
  // de relire la grille avant de retenter. À trente secondes on n'en place que
  // deux, et l'épreuve se joue au hasard plutôt qu'à la déduction.
  motus: { label: "Le mot", durationSec: 70, mode: "buzzer", icon: "keyboard" },
};

// Essais autorisés sur le Motus. Cinq, comme la plupart des jeux du genre : en
// dessous on ne déduit rien, au-dessus on finit par tomber dessus par
// épuisement et la grille perd son intérêt.
export const MOTUS_TRIES = 5;

// L'anagramme n'élimine pas : on peut proposer autant de titres qu'on veut
// dans le temps imparti. Un plafond existe quand même, uniquement pour borner
// ce qu'un client malveillant peut envoyer.
export const ANAGRAM_TRIES = 40;

export const ROUND_TYPES = Object.keys(TYPE_META);

// ============================================================
//  QUELS TITRES ON ACCEPTE DE FAIRE DEVINER
// ============================================================
// Quatre épreuves demandent de retrouver un jeu à partir d'un indice : les
// emojis, la capture pixelisée, l'anagramme et le Motus. Toutes butaient sur le
// même écueil — le catalogue regorge de titres à rallonge.
//
// « Ace Attorney: Trials and Tribulations » n'est pas une énigme difficile,
// c'est une énigme PÉNIBLE : on a reconnu le jeu en deux secondes et on passe
// les vingt suivantes à taper un sous-titre exact. Et « Diablo II » demande de
// deviner non pas un jeu mais un NUMÉRO D'ÉPISODE, ce qui ne teste plus rien.
//
// On ne garde donc que des noms de SAGA ou de jeu unique : Bloodborne, Hades,
// Minecraft, Animal Crossing, Prince of Persia. Concrètement, sont écartés :
//
//   • les sous-titres — tout ce qui suit « : », « – » ou « - » entouré
//     d'espaces (Half-Life garde son trait d'union, il n'est pas un sous-titre) ;
//   • les numéros d'épisode en fin de titre, en chiffres arabes ou romains.
//     La limite à trois chiffres est délibérée : elle écarte « Portal 2 » et
//     « Far Cry 3 » tout en gardant « Cyberpunk 2077 », dont le nombre fait
//     partie du nom et non d'une numérotation ;
//   • les mentions d'édition, qui désignent le même jeu sous un autre emballage ;
//   • ce qui est simplement trop long à taper (plus de quatre mots ou de
//     vingt-deux lettres).
const SUBTITLE_RE = /[:–—]|\s-\s/;
const SEQUEL_RE = /\s+(\d{1,3}|[IVXLCDM]+)$/;
const EDITION_RE =
  /\b(edition|remaster(ed)?|remake|goty|deluxe|definitive|collection|anthology|trilogy|complete|bundle|hd)\b/i;

export function isGuessableTitle(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  if (SUBTITLE_RE.test(raw)) return false;
  if (SEQUEL_RE.test(raw)) return false;
  if (EDITION_RE.test(raw)) return false;
  if (raw.split(/\s+/).length > 4) return false;
  const letters = raw.replace(/[^\p{L}\p{N}]/gu, "").length;
  return letters >= 3 && letters <= 22;
}

// ============================================================
//  Matière première commune
// ============================================================
// Le vivier dans lequel toutes les épreuves puisent : les jeux du ou des
// joueurs d'abord (on reconnaît mieux ce qu'on a joué, et c'est ce qui rend une
// partie personnelle), complétés par les gros jeux du catalogue.
async function gatherGames(userIds) {
  const ids = (userIds || []).filter(Boolean);
  const played = ids.length
    ? await UserGame.find({ user: { $in: ids }, status: { $ne: "wishlist" } })
        .select("gameId name cover")
        .lean()
    : [];

  const byId = new Map();
  for (const g of played) {
    if (!g.gameId || byId.has(g.gameId)) continue;
    byId.set(g.gameId, { gameId: g.gameId, name: g.name, cover: g.cover || null });
  }
  // Bundles, DLC et packs dehors : ils rendent toutes les épreuves absurdes
  // (deviner « The Orange Box » en emojis, placer la date de sortie d'une
  // compilation…). Même garde-fou que le blind test et Pixel Rush.
  const mine = await keepRealGames([...byId.values()]);
  const famous = await getFamousPool();
  const mineSet = new Set(mine.map((g) => g.gameId));

  return {
    mine,
    famous: famous
      .filter((g) => !mineSet.has(g.id))
      .map((g) => ({ gameId: g.id, name: g.name, cover: g.cover })),
  };
}

// La liste de recherche des épreuves à saisie libre (emojis, pixel, studio).
// UNE SEULE pour toute la partie, et en versus IDENTIQUE POUR TOUTE LA TABLE —
// même exigence d'équité qu'au blind test : un joueur dont la liste
// contiendrait un titre absent chez les autres le taperait plus vite.
async function buildCandidates(pools, rounds) {
  const map = new Map();
  // LE NOM EST OBLIGATOIRE. Une entrée sans titre n'est pas seulement inutile
  // (on ne peut pas la taper) : elle fait tomber toute la page de recherche,
  // parce que la déduplication compare les longueurs de noms entre candidats
  // (dedupeCandidates, client/src/lib/guessGame.js).
  //
  // Le cas se produit vraiment : une manche « qcm » porte un
  // `gameId` — le jeu SUR LEQUEL porte la question, qui sert à l'illustrer et à
  // ne pas le reprendre ailleurs dans la partie — mais aucun `gameName`, parce
  // que la réponse attendue n'est pas un titre de jeu.
  const add = (id, name, cover) => {
    if (!id || !name || map.has(id)) return;
    map.set(id, { id, name, cover: cover || null });
  };
  for (const g of pools.mine) add(g.gameId, g.name, g.cover);
  for (const g of pools.famous) add(g.gameId, g.name, g.cover);
  // Filet de sécurité : toute réponse attendue DOIT être proposable, même si
  // elle vient d'un vivier que les deux boucles au-dessus ne couvrent pas.
  // (`add` ignore de lui-même les manches sans titre attendu.)
  for (const r of rounds) {
    if (r.gameId) add(r.gameId, r.gameName, r.cover);
    for (const g of r.games || []) add(g.gameId, g.name, g.cover);
    for (const c of r.deck || []) add(c.gameId, c.name, c.cover);
  }
  return attachAltNames([...map.values()]);
}

// ============================================================
//  1. QCM — la question de culture générale
// ============================================================
async function buildQcm(count, ctx) {
  const qs = await buildQuestions(count, {
    excludeQuestionIds: seenQuestionIds(ctx.seen),
    excludeGames: ctx.usedGames,
  });
  return qs.map((q) => ({
    type: "qcm",
    durationSec: TYPE_META.qcm.durationSec,
    text: q.text,
    choices: q.choices,
    answerIndex: q.answerIndex,
    explain: q.explain,
    theme: q.theme,
    cover: q.cover || null,
    gameId: q.gameId || null,
    questionId: q.questionId || null,
    seenRef: q.key,
  }));
}

// ============================================================
//  2. EMOJIS — devine le jeu, lettre après lettre
// ============================================================
// L'énigme tient en quatre emojis. Le titre est masqué, et des lettres
// apparaissent au fil du chrono : sans ça, une suite d'emojis qu'on ne « voit »
// pas laisse trente secondes de blocage total, et une manche bloquée n'est pas
// difficile, elle est morte.
//
// Le motif (`pattern`) décrit la FORME du titre sans le donner : les
// séparateurs (espaces, apostrophes, deux-points, chiffres) sont visibles — ils
// ne disent rien qu'on ne devine déjà —, les lettres sont des cases vides.
// C'est ce découpage qui permet au versus de n'envoyer que ça.
const REVEAL_FRACS = [0.35, 0.5, 0.62, 0.72, 0.8, 0.87];

function maskTitle(name, durationSec) {
  const chars = [...String(name || "")];
  const pattern = chars.map((c) => (/[a-zA-ZÀ-ÿ]/.test(c) ? { h: true } : { c }));
  // On ne dévoile que des lettres, jamais deux fois la même position, et on
  // s'arrête à un tiers du titre : au-delà, il se lit et l'épreuve s'annule.
  const hidden = pattern.map((p, i) => (p.h ? i : -1)).filter((i) => i >= 0);
  const budget = Math.max(1, Math.min(REVEAL_FRACS.length, Math.floor(hidden.length / 3)));
  const picks = shuffle(hidden).slice(0, budget);
  const reveals = picks.map((index, i) => ({
    index,
    letter: chars[index],
    atMs: Math.round(REVEAL_FRACS[i] * durationSec * 1000),
  }));
  return { pattern, reveals };
}

async function buildEmoji(count, ctx) {
  if (count <= 0) return [];
  let rows = [];
  try {
    rows = await QuizEmoji.aggregate([
      {
        $match: {
          approved: true,
          // Les jeux déjà consommés par la partie en cours ET ceux déjà vus
          // en emojis par ce joueur (la même suite d'emojis ne se redevine
          // pas). Un jeu vu ici reste tirable en capture pixelisée : ce n'est
          // pas la même énigme.
          gameId: { $nin: [...ctx.usedGames, ...ctx.seenGames("emoji")] },
          emojis: { $ne: [] },
        },
      },
      // On tire large : beaucoup d'entrées seront écartées par le filtre de
      // titre (cf. isGuessableTitle), qui ne peut s'appliquer qu'une fois les
      // noms résolus auprès d'IGDB.
      { $sample: { size: count * 8 } },
    ]);
  } catch (err) {
    console.error("quiz emoji draw error:", err.message);
    return [];
  }

  // La jaquette ne sert qu'à la RÉVÉLATION (montrer le jeu qu'on cherchait) :
  // elle ne part jamais avant, sans quoi l'énigme se lirait dans l'image.
  const covers = new Map();
  const ids = rows.map((r) => r.gameId);
  if (ids.length) {
    try {
      const raw = await igdbQuery(
        "games",
        `fields name, cover.image_id; where id = (${ids.join(",")}); limit ${ids.length};`
      );
      for (const g of raw)
        covers.set(g.id, {
          name: g.name,
          cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
        });
    } catch {
      /* la manche se joue très bien sans jaquette */
    }
  }

  const out = [];
  for (const r of rows) {
    if (out.length >= count) break;
    if (ctx.usedGames.has(r.gameId)) continue;
    const meta = covers.get(r.gameId);
    const name = meta?.name || r.name;
    if (!name || !isGuessableTitle(name)) continue;
    ctx.usedGames.add(r.gameId);
    const dur = TYPE_META.emoji.durationSec;
    out.push({
      type: "emoji",
      durationSec: dur,
      emojis: r.emojis,
      gameId: r.gameId,
      gameName: name,
      cover: meta?.cover || null,
      ...maskTitle(name, dur),
      emojiId: String(r._id),
      seenRef: `g:${r.gameId}`,
    });
  }
  return out;
}

// ============================================================
//  3. LE STUDIO — trois de ses jeux, à toi de jouer
// ============================================================
// Un nom de studio s'affiche ; il faut en citer trois jeux. C'est l'épreuve la
// plus exigeante côté données : accepter une réponse suppose de connaître TOUT
// le catalogue du studio, pas seulement les trois titres auxquels on pensait.
// Refuser « Okami » à quelqu'un qui répond Capcom serait la pire chose que ce
// jeu puisse faire.
//
// On va donc chercher la liste complète chez IGDB, via l'endpoint
// `involved_companies` — l'inverse de la requête habituelle : on part de
// l'entreprise et on remonte aux jeux.
const companyCache = new Map(); // nom → { id, games: [{gameId, name, cover}] }

export async function gamesOfCompany(name) {
  const key = String(name).toLowerCase();
  if (companyCache.has(key)) return companyCache.get(key);
  const entry = { id: null, logo: null, games: [] };
  try {
    // Le logo en plus du nom : un studio se reconnaît à son logo bien avant de
    // se reconnaître à son nom écrit. Sur l'épreuve, c'est la différence entre
    // « Ryu Ga Gotoku Studio » — qui ne dit rien à personne — et une image que
    // beaucoup ont vue cent fois au lancement d'un jeu.
    const found = await igdbQuery(
      "companies",
      `fields id,name,logo.image_id; where name ~ "${String(name).replace(/"/g, "")}"; limit 3;`
    );
    const co = found[0];
    if (co) {
      entry.id = co.id;
      // `t_logo_med` : les logos d'IGDB sont des PNG à fond transparent, donc
      // ils se posent aussi bien sur le thème clair que sur le sombre.
      entry.logo = co.logo?.image_id ? `${IMG}/t_logo_med/${co.logo.image_id}.png` : null;
      const rows = await igdbQuery(
        "involved_companies",
        "fields game.id, game.name, game.cover.image_id, game.game_type," +
          ` game.version_parent; where company = ${co.id} & developer = true; limit 500;`
      );
      const seen = new Set();
      for (const r of rows) {
        const g = r.game;
        if (!g?.id || !g.name || seen.has(g.id)) continue;
        // Mêmes exclusions que partout : pas de bundle, pas de DLC, pas de
        // version dérivée. « Resident Evil 4 » compte, « Resident Evil 4 —
        // Separate Ways » non : ce n'est pas un jeu de plus à citer.
        if (g.version_parent) continue;
        if (![0, 4, 8, 9, 10, 11].includes(g.game_type ?? 0)) continue;
        seen.add(g.id);
        entry.games.push({
          gameId: g.id,
          name: g.name,
          cover: g.cover?.image_id ? `${IMG}/t_cover_big/${g.cover.image_id}.jpg` : null,
        });
      }
    }
  } catch (err) {
    console.error("quiz company error:", err.message);
  }
  companyCache.set(key, entry);
  return entry;
}

async function buildStudio(count, ctx) {
  if (count <= 0) return [];
  const pool = await getFactPool();
  // Un studio n'est éligible que s'il est REPRÉSENTÉ dans le vivier notoire :
  // demander trois jeux d'un studio dont personne ne peut en nommer un est une
  // manche perdue d'avance pour tout le monde.
  const byStudio = new Map();
  for (const g of pool) {
    if (!g.studio) continue;
    if (!byStudio.has(g.studio)) byStudio.set(g.studio, []);
    byStudio.get(g.studio).push(g);
  }
  const eligible = shuffle(
    [...byStudio.entries()]
      .filter(
        ([name, gs]) =>
          gs.length >= 4 && !ctx.usedStudios.has(name) && !ctx.seenHas("studio", `s:${name}`)
      )
      .map(([name, gs]) => ({ name, known: gs }))
  );

  const out = [];
  for (const cand of eligible) {
    if (out.length >= count) break;
    // eslint-disable-next-line no-await-in-loop
    const co = await gamesOfCompany(cand.name);
    // Il faut de quoi accepter large : sous une dizaine de jeux connus d'IGDB,
    // le risque de refuser une bonne réponse devient trop élevé.
    if (co.games.length < 8) continue;
    ctx.usedStudios.add(cand.name);
    out.push({
      type: "studio",
      durationSec: TYPE_META.studio.durationSec,
      studio: cand.name,
      logo: co.logo || null,
      need: 3,
      // La liste d'acceptation : toute la ludothèque du studio selon IGDB.
      accept: co.games,
      // Ce qu'on montrera à la révélation : les plus notoires, pour que le
      // joueur qui a séché voie des titres qu'il aurait pu trouver.
      examples: cand.known.slice(0, 6).map((g) => ({
        gameId: g.id,
        name: g.name,
        cover: g.cover,
      })),
      seenRef: `s:${cand.name}`,
    });
  }
  return out;
}

// ============================================================
//  4. LE DUEL — deux jeux, des affirmations à attribuer
// ============================================================
// « JEU A vs JEU B », et une pile d'affirmations à déposer sur celui qu'elles
// désignent : « est sorti en premier », « a la meilleure note », « est sorti
// sur Switch », « a été joué par Léa ».
//
// ------------------------------------------ pourquoi ce ne sont plus des VALEURS
// La première version distribuait des valeurs par paires : « 2015 » et « 2020 »
// à ranger sous le bon jeu, « Capcom » et « FromSoftware », etc. C'était un
// mauvais jeu, pour une raison structurelle : les cartes allant par deux et les
// jeux étant deux, POSER L'UNE DÉTERMINAIT L'AUTRE. Six cartes ne posaient donc
// que trois vraies questions, et la seconde moitié de la manche se jouait
// mécaniquement. Le genre était pire encore : deux jeux d'action partagent leurs
// genres, la carte n'avait souvent aucune bonne réponse — il a disparu.
//
// Une affirmation, elle, est INDÉPENDANTE. Six affirmations, ce sont six
// décisions, et chacune peut désigner n'importe lequel des deux jeux : on ne
// déduit rien de ce qu'on a déjà placé. C'est aussi beaucoup plus parlant —
// « a le plus d'avis » se raisonne, « 2015 » se récite.
//
// -------------------------------------------------------------- la règle d'or
// Une affirmation n'est retenue que si elle est VRAIE POUR EXACTEMENT UN des
// deux jeux, et si l'écart est franc. Une note de 84 contre 82 n'est pas une
// question, c'est un piège : d'où les marges imposées ci-dessous.
const RATING_GAP = 6;
const VOTES_RATIO = 1.7;
const HLTB_RATIO = 1.4;

function duelClaims(a, b, extra = {}) {
  const out = [];
  // `owner` : l'index du jeu que l'affirmation désigne. `why` : ce qu'on montre
  // à la révélation — sans lui, on apprend qu'on s'est trompé mais pas pourquoi.
  const push = (kind, label, owner, why) =>
    out.push({ id: `c${out.length}`, kind, label, owner, why });

  // --- La sortie ---
  if (a.year && b.year && a.year !== b.year) {
    push("first", "Est sorti en premier", a.year < b.year ? 0 : 1, `${a.year} contre ${b.year}`);
  }

  // --- Une machine exclusive. Le côté est tiré au sort quand les deux jeux ont
  //     chacun une exclusivité : sinon l'affirmation désignerait toujours le
  //     même, et on finirait par le remarquer. ---
  const platA = a.platforms.find((p) => !b.platforms.includes(p));
  const platB = b.platforms.find((p) => !a.platforms.includes(p));
  const platSide = platA && platB ? (Math.random() < 0.5 ? 0 : 1) : platA ? 0 : platB ? 1 : null;
  if (platSide !== null) {
    const plat = platSide === 0 ? platA : platB;
    push("platform", `Est sorti sur ${plat}`, platSide, `Seul des deux à être sorti sur ${plat}`);
  }

  // --- La note ---
  if (a.rating != null && b.rating != null && Math.abs(a.rating - b.rating) >= RATING_GAP) {
    push(
      "rating",
      "A la meilleure note",
      a.rating > b.rating ? 0 : 1,
      `${a.rating}/100 contre ${b.rating}/100`
    );
  }

  // --- La notoriété ---
  if (a.votes && b.votes && Math.min(a.votes, b.votes) > 0) {
    if (Math.max(a.votes, b.votes) / Math.min(a.votes, b.votes) >= VOTES_RATIO) {
      push(
        "votes",
        "A le plus d'avis de joueurs",
        a.votes > b.votes ? 0 : 1,
        `${a.votes} avis contre ${b.votes}`
      );
    }
  }

  // --- Le studio, en affirmation plutôt qu'en étiquette ---
  if (a.studio && b.studio && a.studio !== b.studio) {
    const side = Math.random() < 0.5 ? 0 : 1;
    push(
      "studio",
      `A été développé par ${side === 0 ? a.studio : b.studio}`,
      side,
      `${a.name} : ${a.studio} · ${b.name} : ${b.studio}`
    );
  }

  // --- L'éditeur, seulement s'il apporte autre chose que le développeur ---
  if (
    a.publisher &&
    b.publisher &&
    a.publisher !== b.publisher &&
    (a.publisher !== a.studio || b.publisher !== b.studio)
  ) {
    const side = Math.random() < 0.5 ? 0 : 1;
    push(
      "publisher",
      `A été édité par ${side === 0 ? a.publisher : b.publisher}`,
      side,
      `${a.name} : ${a.publisher} · ${b.name} : ${b.publisher}`
    );
  }

  // --- Le mode de jeu ---
  const soloOnly = (g) => (g.modes || []).length === 1 && /single/i.test(g.modes[0]);
  const hasMulti = (g) => (g.modes || []).some((m) => /multi|co-?op/i.test(m));
  if (hasMulti(a) && soloOnly(b)) push("modes", "Se joue à plusieurs", 0, `${b.name} est purement solo`);
  else if (hasMulti(b) && soloOnly(a)) push("modes", "Se joue à plusieurs", 1, `${a.name} est purement solo`);

  // --- La durée, quand on la connaît (HowLongToBeat, déjà en cache en base) ---
  const ta = extra.times?.get(a.id);
  const tb = extra.times?.get(b.id);
  if (ta > 0 && tb > 0 && Math.max(ta, tb) / Math.min(ta, tb) >= HLTB_RATIO) {
    push(
      "time",
      "Est le plus court à terminer",
      ta < tb ? 0 : 1,
      `${Math.round(ta)} h contre ${Math.round(tb)} h`
    );
  }

  // --- Le volet social ---
  // L'affirmation la plus savoureuse du lot, parce qu'elle ne se déduit d'AUCUNE
  // donnée publique : il faut connaître la personne. Elle n'apparaît que si le
  // jeu est dans la ludothèque d'un seul des deux côtés.
  const pa = extra.players?.get(a.id);
  const pb = extra.players?.get(b.id);
  if (pa && !pb) push("player", `A été joué par ${pa}`, 0, `${pa} l'a dans sa ludothèque`);
  else if (pb && !pa) push("player", `A été joué par ${pb}`, 1, `${pb} l'a dans sa ludothèque`);

  return out;
}

// Combien d'affirmations par manche. Six est le maximum lisible sur un
// téléphone ; en dessous de quatre, le duel se plie trop vite.
const DUEL_MIN = 4;
const DUEL_MAX = 6;

// ------------------------------------------------------------- l'équilibre
// Un tirage à plat peut sortir six affirmations qui désignent toutes le même
// jeu — et ça arrive vraiment, parce que les faits sont corrélés : le jeu le
// plus ancien est souvent aussi le plus connu, le mieux noté et le plus court.
// La manche devient alors triviale (« je pose tout à gauche »).
//
// On alterne donc les deux camps tant qu'on peut, avant de compléter avec ce
// qui reste. Le résultat garde le hasard du tirage mais jamais son cas
// dégénéré.
function balancedPick(claims, max) {
  const sides = [shuffle(claims.filter((c) => c.owner === 0)), shuffle(claims.filter((c) => c.owner === 1))];
  const out = [];
  // On commence par le camp le mieux fourni : à nombre impair, c'est lui qui
  // doit avoir la voix de plus.
  let side = sides[0].length >= sides[1].length ? 0 : 1;
  while (out.length < max && (sides[0].length || sides[1].length)) {
    if (sides[side].length) out.push(sides[side].shift());
    else if (sides[1 - side].length) out.push(sides[1 - side].shift());
    side = 1 - side;
  }
  return shuffle(out);
}

async function buildDuel(count, ctx) {
  if (count <= 0) return [];
  const pool = shuffle((await getFactPool()).filter((g) => !ctx.usedGames.has(g.id)));
  const extra = { times: ctx.times, players: ctx.playerOf };
  const out = [];
  const used = new Set();

  for (let i = 0; i < pool.length && out.length < count; i += 1) {
    const a = pool[i];
    if (used.has(a.id)) continue;
    // On cherche un adversaire qui donne assez d'affirmations franches. Deux
    // épisodes de la même saga partagent presque tout : ils ne passeront pas ce
    // seuil, et c'est très bien — il n'y aurait rien à départager.
    let b = null;
    let claims = [];
    for (const cand of pool) {
      if (cand.id === a.id || used.has(cand.id)) continue;
      const c = duelClaims(a, cand, extra);
      if (c.length >= DUEL_MIN) {
        b = cand;
        claims = c;
        break;
      }
    }
    if (!b) continue;
    used.add(a.id);
    used.add(b.id);
    ctx.usedGames.add(a.id);
    ctx.usedGames.add(b.id);

    const kept = balancedPick(claims, DUEL_MAX);
    out.push({
      type: "duel",
      durationSec: TYPE_META.duel.durationSec,
      games: [
        { gameId: a.id, name: a.name, cover: a.cover },
        { gameId: b.id, name: b.name, cover: b.cover },
      ],
      cards: kept.map((c) => ({ id: c.id, kind: c.kind, label: c.label })),
      solution: Object.fromEntries(kept.map((c) => [c.id, c.owner])),
      // Le pourquoi de chaque affirmation, montré à la révélation.
      why: Object.fromEntries(kept.map((c) => [c.id, c.why])),
      seenRef: `d:${a.id}-${b.id}`,
    });
  }
  return out;
}

// ============================================================
//  5. PIXEL — une capture, noyée
// ============================================================
// Exactement l'épreuve de Pixel Rush, en une manche : même façon d'aller
// chercher la capture (shotsForGames, importée du jeu lui-même), même coin
// laissé net, même pixelisation côté client. C'est délibéré — deux
// pixelisations légèrement différentes seraient perçues comme un bug.
const CORNERS = ["tl", "tr", "bl", "br"];

async function buildPixel(count, ctx, pools) {
  if (count <= 0) return [];
  // Les jeux du joueur d'abord : reconnaître une capture d'un jeu qu'on a fini
  // est une joie, la reconnaître d'un jeu qu'on n'a jamais lancé est un test.
  const wanted = shuffle([
    ...shuffle(pools.mine).slice(0, count * 3),
    ...shuffle(pools.famous).slice(0, count * 3),
  ]).filter(
    (g) =>
      isGuessableTitle(g.name) &&
      !ctx.usedGames.has(g.gameId) &&
      !ctx.seenHas("pixel", `g:${g.gameId}`)
  );

  const shots = await shotsForGames(wanted.map((g) => g.gameId));
  const out = [];
  for (const g of wanted) {
    if (out.length >= count) break;
    const urls = shots.get(g.gameId);
    if (!urls?.length) continue;
    ctx.usedGames.add(g.gameId);
    out.push({
      type: "pixel",
      durationSec: TYPE_META.pixel.durationSec,
      shot: sample(urls),
      clearCorner: sample(CORNERS),
      gameId: g.gameId,
      gameName: g.name,
      cover: g.cover || null,
      seenRef: `g:${g.gameId}`,
    });
  }
  return out;
}

// ============================================================
//  6. LE TRI — trente secondes, une pile, une seule question
// ============================================================
// « Ce jeu est-il sorti sur Switch ? » et on balaie la pile. C'est la seule
// épreuve qui ne demande AUCUNE réflexion sur une seule carte : tout se joue
// sur la cadence, et c'est ce qui la rend jouissive à plusieurs.
//
// Les critères sont tous VÉRIFIABLES MÉCANIQUEMENT depuis IGDB. On n'invente
// pas de critère d'appréciation (« ce jeu est bon ») : dans une épreuve où le
// joueur a une seconde par carte, une réponse discutable est vécue comme un vol.
function swipeCriteria(pool) {
  const out = [];

  // — Plateformes. On ne retient qu'une machine réellement discriminante :
  //   « sorti sur PC » serait vrai pour les trois quarts de la pile.
  const platCount = new Map();
  for (const g of pool) for (const p of new Set(g.platforms)) platCount.set(p, (platCount.get(p) || 0) + 1);
  for (const [plat, n] of platCount) {
    const share = n / pool.length;
    if (share < 0.2 || share > 0.6) continue;
    out.push({
      key: `plat:${plat}`,
      label: `Ce jeu est sorti sur ${plat}`,
      yes: "Sorti dessus",
      no: "Jamais sorti dessus",
      test: (g) => g.platforms.includes(plat),
    });
  }

  // — Studios / éditeurs. « Ce jeu est un jeu Capcom » : l'exemple donné au
  //   départ, et le critère le plus amusant du lot.
  const houseCount = new Map();
  for (const g of pool) {
    for (const h of new Set([g.studio, g.publisher].filter(Boolean)))
      houseCount.set(h, (houseCount.get(h) || 0) + 1);
  }
  for (const [house, n] of houseCount) {
    if (n < 6) continue;
    out.push({
      key: `house:${house}`,
      label: `Ce jeu est un jeu ${house}`,
      yes: `C'est ${house}`,
      no: "Non",
      test: (g) => g.studio === house || g.publisher === house,
    });
  }

  // — Époque.
  for (const year of [2010, 2015, 2020]) {
    const n = pool.filter((g) => g.year < year).length;
    const share = n / pool.length;
    if (share < 0.2 || share > 0.7) continue;
    out.push({
      key: `year:${year}`,
      label: `Ce jeu est sorti avant ${year}`,
      yes: `Avant ${year}`,
      no: `${year} ou après`,
      test: (g) => g.year < year,
    });
  }

  // — Genres.
  const genreCount = new Map();
  for (const g of pool) for (const x of new Set(g.genres)) genreCount.set(x, (genreCount.get(x) || 0) + 1);
  for (const [genre, n] of genreCount) {
    const share = n / pool.length;
    if (share < 0.15 || share > 0.55) continue;
    out.push({
      key: `genre:${genre}`,
      label: `Ce jeu est un ${genre}`,
      yes: "Oui",
      no: "Non",
      test: (g) => g.genres.includes(genre),
    });
  }

  return out;
}

// La pile : moitié de « oui », moitié de « non », mélangée. Une pile
// déséquilibrée s'exploite (« je réponds oui à tout ») et cesse d'être un test.
const DECK_SIZE = 24;

async function buildSwipe(count, ctx) {
  if (count <= 0) return [];
  const pool = await getFactPool();
  if (pool.length < DECK_SIZE * 2) return [];
  const criteria = shuffle(swipeCriteria(pool)).filter(
    (c) => !ctx.usedCriteria.has(c.key) && !ctx.seenHas("swipe", `c:${c.key}`)
  );

  const out = [];
  for (const crit of criteria) {
    if (out.length >= count) break;
    const yes = shuffle(pool.filter((g) => crit.test(g)));
    const no = shuffle(pool.filter((g) => !crit.test(g)));
    const half = Math.floor(DECK_SIZE / 2);
    if (yes.length < half || no.length < half) continue;
    ctx.usedCriteria.add(crit.key);
    const deck = shuffle([...yes.slice(0, half), ...no.slice(0, half)]).map((g) => ({
      gameId: g.id,
      name: g.name,
      cover: g.cover,
      yes: crit.test(g),
    }));
    out.push({
      type: "swipe",
      durationSec: TYPE_META.swipe.durationSec,
      criterion: { label: crit.label, yes: crit.yes, no: crit.no },
      deck,
      seenRef: `c:${crit.key}`,
    });
  }
  return out;
}

// ============================================================
//  7. LETTRES MÊLÉES — l'anagramme
// ============================================================
// Le titre d'un jeu, lettres dans le désordre : MINECRAFT devient CARFTEMIN.
// On le retape pour marquer.
//
// C'est une énigme AUTOPORTÉE : la grille de lettres EST la question, et elle
// contient déjà tout ce qu'il faut pour répondre. D'où deux conséquences
// agréables — elle ne coûte aucune donnée supplémentaire (pas de capture à
// charger, pas d'emoji à écrire à la main), et elle est parfaitement équitable
// en versus puisque tout le monde voit exactement la même chose.
//
// La longueur est bornée : sous six lettres une anagramme se résout d'un coup
// d'œil ; au-delà de quatorze elle devient un exercice de patience et non plus
// un jeu de culture. On garde aussi la STRUCTURE du titre (son découpage en
// mots) — elle ne révèle aucune lettre, mais transforme une bouillie de
// quatorze signes en « deux mots de six et huit », ce qui est autrement jouable.
const ANAGRAM_MIN = 6;
const ANAGRAM_MAX = 14;

// Les lettres d'un titre, sans accent ni ponctuation, en capitales.
// Exportée avec `scramble` : le même jeu se joue sur Discord (lib/discordPuzzle.js),
// et deux fabriques d'anagrammes finiraient par ne plus mélanger pareil.
export const lettersOf = (name) =>
  [
    ...String(name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase(),
  ].filter((c) => /[A-Z0-9]/.test(c));

// Mélange qui garantit de NE PAS retomber sur l'ordre d'origine : une
// « anagramme » qui affiche le titre en clair est le seul résultat inacceptable.
export function scramble(letters) {
  const joined = letters.join("");
  for (let i = 0; i < 12; i += 1) {
    const out = shuffle(letters);
    if (out.join("") !== joined) return out;
  }
  return letters;
}

async function buildAnagram(count, ctx, pools) {
  if (count <= 0) return [];
  const candidates = shuffle([
    ...shuffle(pools.mine).slice(0, count * 6),
    ...shuffle(pools.famous).slice(0, count * 6),
  ]);
  const out = [];
  for (const g of candidates) {
    if (out.length >= count) break;
    if (ctx.usedGames.has(g.gameId) || ctx.seenHas("anagram", `g:${g.gameId}`)) continue;
    if (!isGuessableTitle(g.name)) continue;
    const letters = lettersOf(g.name);
    if (letters.length < ANAGRAM_MIN || letters.length > ANAGRAM_MAX) continue;
    ctx.usedGames.add(g.gameId);
    out.push({
      type: "anagram",
      durationSec: TYPE_META.anagram.durationSec,
      letters: scramble(letters),
      // Le découpage en mots : la forme du titre, sans ses lettres.
      words: String(g.name)
        .split(/\s+/)
        .map((w) => lettersOf(w).length)
        .filter((n) => n > 0),
      gameId: g.gameId,
      gameName: g.name,
      cover: g.cover || null,
      seenRef: `g:${g.gameId}`,
    });
  }
  return out;
}

// ============================================================
//  8. LE MOT — à la Motus
// ============================================================
// Un titre de jeu à trouver en cinq essais. Chaque proposition se colore :
// vert = bonne lettre au bon endroit, orange = bonne lettre ailleurs, gris =
// lettre absente du titre.
//
// ------------------------------------------------------- pourquoi UN SEUL MOT
// Le titre doit tenir dans une grille, donc en un mot : DOOM, HADES, CELESTE,
// BLOODBORNE. « The Legend of Zelda: Breath of the Wild » ne se joue pas comme
// ça. C'est une contrainte forte, mais le catalogue en regorge — et ce sont
// justement les titres les plus connus.
//
// ------------------------------------------------------- l'indice, à retardement
// L'indice n'apparaît QU'À LA MI-TEMPS, et il se limite à l'année de sortie.
//
// Donné d'emblée et complet (« un jeu de 2016, par Blizzard Entertainment »),
// il ne laissait plus grand-chose à trouver : sur une poignée de titres
// possibles, la grille devenait une formalité. Il redevient ce qu'il doit être
// — un coup de pouce pour qui sèche, pas une réponse offerte à qui n'a pas
// encore cherché.
//
// La première lettre N'EST PAS offerte. Elle l'était — amorce classique du
// genre — mais cumulée à l'indice elle ne laissait plus rien à trouver : on
// connaissait la longueur, l'initiale et l'année, ce qui suffit souvent à
// nommer le jeu sans jouer. La grille se mérite en entier.
const MOTUS_MIN = 4;
const MOTUS_MAX = 10;

async function buildMotus(count, ctx, pools) {
  if (count <= 0) return [];
  const pool = await getFactPool();
  // On croise le vivier notoire avec la bibliothèque du joueur : l'année et le
  // studio ne viennent que du vivier, et sans eux l'indice serait vide.
  const byId = new Map(pool.map((g) => [g.id, g]));
  const candidates = shuffle([
    ...shuffle(pools.mine).filter((g) => byId.has(g.gameId)),
    ...pool.map((g) => ({ gameId: g.id, name: g.name, cover: g.cover })),
  ]);

  const out = [];
  const usedNames = new Set();
  for (const g of candidates) {
    if (out.length >= count) break;
    if (ctx.usedGames.has(g.gameId) || ctx.seenHas("motus", `g:${g.gameId}`)) continue;
    // Un seul mot, sans chiffre ni ponctuation : la grille ne sait afficher que
    // des lettres.
    if (/[^A-Za-z]/.test(String(g.name).trim())) continue;
    if (!isGuessableTitle(g.name)) continue;
    const letters = lettersOf(g.name);
    if (letters.length < MOTUS_MIN || letters.length > MOTUS_MAX) continue;
    const word = letters.join("");
    if (usedNames.has(word)) continue;
    usedNames.add(word);
    const meta = byId.get(g.gameId);
    ctx.usedGames.add(g.gameId);
    out.push({
      type: "motus",
      durationSec: TYPE_META.motus.durationSec,
      length: letters.length,
      tries: MOTUS_TRIES,
      // L'année seule, et pas avant la mi-temps (cf. l'en-tête).
      hint: meta?.year ? `Sorti en ${meta.year}` : "",
      hintAtMs: Math.round(TYPE_META.motus.durationSec * 1000 * 0.5),
      answer: word,
      gameId: g.gameId,
      gameName: g.name,
      cover: g.cover || null,
      seenRef: `g:${g.gameId}`,
    });
  }
  return out;
}

// ============================================================
//  Deux jeux de données pour le duel
// ============================================================
// Les durées de complétion (HowLongToBeat), déjà mises en cache en base par le
// reste du site : on ne va pas les rechercher, on lit ce qui est là. Un jeu
// absent de la table ne produira simplement pas d'affirmation « le plus court ».
async function completionTimes() {
  const map = new Map();
  try {
    const rows = await GameTime.find({ normally: { $gt: 0 } })
      .select("gameId normally")
      .lean();
    for (const r of rows) map.set(r.gameId, r.normally);
  } catch (err) {
    console.error("quiz hltb error:", err.message);
  }
  return map;
}

// Qui, dans l'entourage, a joué à quoi → Map(gameId → pseudo).
//
// En SOLO on regarde les comptes suivis : « a été joué par Léa » n'a de sel que
// si on connaît Léa. En VERSUS on regarde LA TABLE, ce qui est encore mieux —
// l'affirmation porte sur quelqu'un qui est en train de jouer avec vous.
//
// On ne garde qu'UN nom par jeu (le premier trouvé) : l'affirmation doit
// désigner une personne, pas énumérer une liste.
async function playedByEntourage(userIds) {
  const map = new Map();
  try {
    const ids = (userIds || []).filter(Boolean);
    if (!ids.length) return map;

    let people = ids;
    if (ids.length === 1) {
      const me = await User.findById(ids[0]).select("following").lean();
      people = (me?.following || []).slice(0, 40);
      if (!people.length) return map;
    }
    const users = await User.find({ _id: { $in: people } })
      .select("username")
      .lean();
    const nameOf = new Map(users.map((u) => [String(u._id), u.username]));

    const rows = await UserGame.find({
      user: { $in: people },
      status: { $ne: "wishlist" },
    })
      .select("gameId user")
      .lean();
    for (const r of rows) {
      if (!r.gameId || map.has(r.gameId)) continue;
      const name = nameOf.get(String(r.user));
      if (name) map.set(r.gameId, name);
    }
  } catch (err) {
    console.error("quiz entourage error:", err.message);
  }
  return map;
}

// ============================================================
//  L'assemblage
// ============================================================
// On veut un PANACHAGE, pas un tirage à plat : sur huit manches, tomber trois
// fois sur le QCM et jamais sur le duel gâche le principal argument du jeu.
// On distribue donc en tourniquet sur les types demandés, puis on mélange
// l'ordre — en s'assurant seulement que deux manches consécutives ne soient
// pas du même type quand on peut l'éviter.
function interleave(rounds) {
  const byType = new Map();
  for (const r of rounds) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(r);
  }
  const out = [];
  let last = null;
  while (out.length < rounds.length) {
    // À chaque pas, on pioche dans le type le mieux fourni qui n'est pas celui
    // qu'on vient de poser. Ça suffit à casser les séries sans jamais bloquer.
    const buckets = [...byType.entries()].filter(([, v]) => v.length);
    if (!buckets.length) break;
    const usable = buckets.filter(([t]) => t !== last);
    const [type, list] = (usable.length ? usable : buckets).sort(
      (a, b) => b[1].length - a[1].length
    )[0];
    out.push(list.shift());
    last = type;
  }
  return out;
}

// Combien de manches de chaque type. Le QCM est le liant du jeu (c'est LUI le
// quiz) : il pèse plus que les autres, sans jamais dépasser un tiers de la
// partie.
function quota(count, types) {
  const list = types.filter((t) => ROUND_TYPES.includes(t));
  const use = list.length ? list : ROUND_TYPES;
  const want = Object.fromEntries(use.map((t) => [t, 0]));
  const qcmShare = use.includes("qcm") ? Math.max(1, Math.round(count * 0.3)) : 0;
  if (qcmShare) want.qcm = qcmShare;
  // MÉLANGÉ, et ce n'est pas cosmétique : sur une partie courte, le tourniquet
  // n'atteint pas le bout de la liste. À l'ordre fixe, une partie de cinq
  // épreuves servait donc TOUJOURS les trois premières du tableau et jamais les
  // trois dernières — trois épreuves du jeu devenaient invisibles pour qui joue
  // court.
  const others = shuffle(use.filter((t) => t !== "qcm"));
  let left = count - qcmShare;
  // Tourniquet sur le reste : chacun son tour, jusqu'à épuisement du quota.
  for (let i = 0; left > 0 && others.length; i += 1) {
    want[others[i % others.length]] += 1;
    left -= 1;
  }
  return want;
}

// ----------------------------------------------------------------------------
// `userIds` : un seul en solo, toute la table en versus (le vivier réunit alors
// les bibliothèques de tout le monde, comme au blind test).
export async function buildQuizRounds({ userIds = [], count = 8, types = ROUND_TYPES } = {}) {
  const pools = await gatherGames(userIds);

  // `count: 0` n'est pas un cas dégénéré, c'est un usage : le mode défi rejoue
  // les manches de quelqu'un d'autre et ne veut d'ici QUE la liste de
  // recherche, reconstruite pour la bibliothèque du joueur courant.
  if (count <= 0) return { rounds: [], candidates: await buildCandidates(pools, []) };

  // Le contexte partagé : c'est lui qui garantit qu'un même jeu, un même
  // studio ou un même critère ne revient pas deux fois dans la partie. Chaque
  // `build*` y ajoute ce qu'il consomme.
  // La mémoire du joueur : ce qu'il a déjà vu, et qui n'est pas encore périmé
  // (cf. models/QuizSeen.js). En versus on ne la charge PAS — la table doit
  // jouer les mêmes manches, et filtrer sur l'historique d'un seul des six
  // joueurs n'aurait aucun sens.
  const seen = userIds.length === 1 ? await seenByType(userIds[0]) : new Map();
  // Ce que le duel a besoin de savoir en plus du catalogue : combien d'heures
  // pour finir chaque jeu, et qui de l'entourage y a joué. Les deux sont
  // best-effort — une affirmation qui manque de matière ne se fabrique pas,
  // c'est tout.
  const [times, playerOf] = await Promise.all([
    completionTimes(),
    playedByEntourage(userIds),
  ]);
  const ctx = {
    userIds,
    seen,
    times,
    playerOf,
    seenGames: (type) =>
      [...(seen.get(type) || [])]
        .filter((r) => r.startsWith("g:"))
        .map((r) => Number(r.slice(2)))
        .filter(Number.isFinite),
    seenHas: (type, ref) => !!seen.get(type)?.has(ref),
    usedGames: new Set(),
    usedStudios: new Set(),
    usedCriteria: new Set(),
  };

  const want = quota(count, types);
  // En série : les épreuves se partagent `ctx`, et les faire en parallèle
  // ferait choisir le même jeu à deux d'entre elles. Le surcoût est celui de
  // quelques requêtes IGDB, toutes déjà mises en cache pour la journée.
  const built = [];
  const runners = [
    ["qcm", () => buildQcm(want.qcm || 0, ctx)],
    ["emoji", () => buildEmoji(want.emoji || 0, ctx)],
    ["pixel", () => buildPixel(want.pixel || 0, ctx, pools)],
    ["duel", () => buildDuel(want.duel || 0, ctx)],
    ["swipe", () => buildSwipe(want.swipe || 0, ctx)],
    ["studio", () => buildStudio(want.studio || 0, ctx)],
    ["anagram", () => buildAnagram(want.anagram || 0, ctx, pools)],
    ["motus", () => buildMotus(want.motus || 0, ctx, pools)],
  ];
  for (const [, run] of runners) {
    try {
      // eslint-disable-next-line no-await-in-loop
      built.push(...(await run()));
    } catch (err) {
      // Une épreuve qui n'a pas pu se construire (IGDB muet, banque vide) ne
      // doit pas emporter la partie : les autres suffisent à jouer.
      console.error("quiz round build error:", err.message);
    }
  }

  // Le compte n'y est pas ? On complète avec du QCM : c'est le seul type qui
  // ne dépend ni des screenshots, ni des emojis relus, ni d'un studio bien
  // fourni — il répond toujours présent.
  if (built.length < count) {
    try {
      built.push(...(await buildQcm(count - built.length, ctx)));
    } catch {
      /* on jouera plus court */
    }
  }

  const rounds = interleave(built).slice(0, count);
  const candidates = await buildCandidates(pools, rounds);
  return { rounds, candidates };
}

// ============================================================
//  Ce que le client a le droit de voir
// ============================================================
// `reveal: false` est le mode versus : l'énigme part, la solution reste. C'est
// le pendant exact du `roundView` de Pixel Rush, généralisé à huit formes.
//
// Le détail qui compte : pour l'épreuve emoji, on filtre AUSSI les lettres
// dévoilées selon le temps écoulé — sinon tout le titre partirait dès la
// première milliseconde, et le masque ne masquerait plus rien.
// ============================================================
//  Ce qu'on garde en base, et ce qu'on refabrique
// ============================================================
// La manche est archivée telle quelle dans QuizGame pour pouvoir être rejouée
// en défi — sauf UNE chose : la liste d'acceptation du studio, qui pèse à elle
// seule tout le catalogue IGDB de l'entreprise (plusieurs centaines de titres).
// L'archiver reviendrait à stocker quarante kilo-octets par manche de studio,
// dans une collection qui grossit d'un document à chaque partie de chaque
// joueur.
//
// Elle se refabrique en un appel (mis en cache pour le process), donc on la
// retire à l'écriture et on la remet au chargement d'un défi.
export function packRound(r) {
  if (r.type !== "studio") return r;
  const { accept, ...rest } = r;
  return rest;
}

export async function unpackRound(r) {
  if (r.type !== "studio" || r.accept?.length) return r;
  const co = await gamesOfCompany(r.studio).catch(() => ({ games: [], logo: null }));
  return { ...r, accept: co.games, logo: r.logo || co.logo || null };
}

export function publicRound(r, { reveal = false, elapsedMs = 0, index = 0, total = 1 } = {}) {
  const base = {
    id: index,
    index,
    total,
    type: r.type,
    durationSec: r.durationSec,
    label: TYPE_META[r.type]?.label || r.type,
    mode: TYPE_META[r.type]?.mode || "buzzer",
  };

  switch (r.type) {
    case "qcm":
      return {
        ...base,
        text: r.text,
        choices: r.choices,
        theme: r.theme,
        ...(reveal ? { answerIndex: r.answerIndex, explain: r.explain, cover: r.cover } : {}),
      };

    case "emoji":
      return {
        ...base,
        emojis: r.emojis,
        pattern: r.pattern,
        // En versus, une lettre n'existe qu'une fois son heure venue.
        reveals: reveal ? r.reveals : r.reveals.filter((x) => x.atMs <= elapsedMs),
        ...(reveal
          ? { gameId: r.gameId, gameName: r.gameName, cover: r.cover }
          : {}),
      };

    case "studio":
      return {
        ...base,
        studio: r.studio,
        logo: r.logo || null,
        need: r.need,
        // La liste d'acceptation EST la réponse : elle ne sort qu'en solo.
        ...(reveal ? { accept: r.accept, examples: r.examples } : {}),
      };

    case "duel":
      return {
        ...base,
        games: r.games,
        cards: r.cards,
        ...(reveal ? { solution: r.solution, why: r.why || {} } : {}),
      };

    case "pixel":
      return {
        ...base,
        shot: r.shot,
        clearCorner: r.clearCorner,
        ...(reveal ? { gameId: r.gameId, gameName: r.gameName, cover: r.cover } : {}),
      };

    case "swipe":
      return {
        ...base,
        criterion: r.criterion,
        // Le verdict de chaque carte ne part qu'en solo ; en versus le serveur
        // corrige à la réception (cf. routes/quizVersus.js).
        deck: r.deck.map((c) => ({
          gameId: c.gameId,
          name: c.name,
          cover: c.cover,
          ...(reveal ? { yes: c.yes } : {}),
        })),
      };

    case "anagram":
      return {
        ...base,
        // Les lettres SONT l'énigme : elles partent toujours. Le titre, lui, ne
        // sort qu'à la révélation.
        letters: r.letters,
        words: r.words,
        ...(reveal ? { gameId: r.gameId, gameName: r.gameName, cover: r.cover } : {}),
      };

    case "motus":
      return {
        ...base,
        length: r.length,
        tries: r.tries,
        hintAtMs: r.hintAtMs,
        // En versus, l'indice n'existe pas tant que son heure n'est pas venue —
        // même logique que les lettres qui tombent dans l'épreuve emoji. En
        // solo il part avec la manche, et c'est le client qui le retient
        // jusqu'à la mi-temps.
        hint: reveal || elapsedMs >= (r.hintAtMs ?? 0) ? r.hint : "",
        ...(reveal
          ? { answer: r.answer, gameId: r.gameId, gameName: r.gameName, cover: r.cover }
          : {}),
      };

    default:
      return base;
  }
}
