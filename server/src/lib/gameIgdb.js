// ======================================================================
//  Tout ce qu'IGDB sait d'un jeu, demandé une fois pour tout le monde
// ======================================================================
//
// LE PROBLÈME QUE CE FICHIER RÈGLE. Une fiche de jeu tapait IGDB à chaque
// ouverture : la fiche, sa parenté, ses personnages, ses boutiques, ses temps
// de complétion, ses notes — une dizaine de requêtes, refaites à l'identique
// pour chaque visiteur. IGDB, lui, n'accepte que 4 requêtes par seconde et 8
// simultanées par identifiant. À vingt personnes sur la même fiche, la fiche ne
// s'affiche plus.
//
// LA RÈGLE DE FRAÎCHEUR EST L'ÂGE DU JEU, comme pour les notes de la presse
// (lib/gameScores.js). Un jeu qui sort le mois prochain change tous les jours :
// on le revoit toutes les 6 heures. Un jeu de 2004 ne changera plus jamais : on
// le garde six mois. Entre les deux, l'écart grandit avec l'âge.
//
// DEUX PROTECTIONS EN PLUS DU CACHE :
//   • une seule requête en vol par (jeu, morceau) — cinquante visiteurs qui
//     arrivent ensemble sur une fiche froide déclenchent UN appel, pas cinquante ;
//   • si IGDB tombe, on ressert l'entrée périmée plutôt qu'une erreur. Une
//     fiche d'hier vaut mieux qu'une page blanche.
//
// ⚠️ AJOUTER UN CHAMP À `CORE_FIELDS` OU `LINK_FIELDS` = BUMPER SON `VER`
// dans `VERSIONS`, sinon les entrées déjà en base répondront sans le champ.

import GameCache from "../models/GameCache.js";
import { igdbQuery } from "./igdb.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Combien de temps on garde une entrée, selon la date de sortie du jeu.
//   • pas encore sorti, ou sorti il y a moins d'un mois -> 6 h
//     (la date bouge encore, les notes arrivent, les captures changent) ;
//   • moins d'un an            -> 7 jours ;
//   • moins de trois ans       -> 30 jours ;
//   • au-delà                  -> 6 mois (plus rien ne bouge) ;
//   • date inconnue            -> 7 jours (prudence).
export function ttlFor(releaseDate) {
  if (releaseDate == null) return 7 * DAY;
  const nowSec = Date.now() / 1000;
  if (releaseDate > nowSec) return 6 * HOUR;
  const ageDays = (nowSec - releaseDate) / 86400;
  if (ageDays < 30) return 6 * HOUR;
  if (ageDays < 365) return 7 * DAY;
  if (ageDays < 3 * 365) return 30 * DAY;
  return 180 * DAY;
}

// Les requêtes en cours, par (morceau, jeu). C'est ce qui empêche une fiche
// froide ouverte par cinquante personnes à la même seconde de partir cinquante
// fois : les quarante-neuf autres attendent la même promesse.
const inflight = new Map();

/**
 * Rend le morceau `kind` du jeu `gameId`, depuis la base si elle est fraîche,
 * sinon en le rechargeant via `load()`.
 *
 * `releaseDate` sert à calculer la fraîcheur. Elle peut être une promesse :
 * les appelants qui la tiennent de la fiche (chargée EN PARALLÈLE) n'ont ainsi
 * pas à attendre celle-ci avant de démarrer. On ne l'attend qu'au moment
 * d'écrire — jamais sur le chemin chaud.
 *
 * `dateFrom` est l'autre cas : la fiche, elle, ne connaît sa date de sortie
 * qu'une fois chargée. On la lui laisse extraire de ce qu'elle vient de lire.
 *
 * ⚠️ NE JAMAIS MODIFIER L'OBJET RENDU. Les appelants qui tombent sur la même
 * requête en vol reçoivent LA MÊME instance : la retoucher retoucherait la
 * fiche des autres. Les routes en font des copies (`{ ...core }`) quand elles
 * ont besoin d'y ajouter quelque chose. On ne clone pas ici — ce serait payer
 * la copie d'une grosse réponse à chaque lecture, y compris sur le chemin chaud.
 */
async function remember({ kind, gameId, ver = 1, releaseDate = null, dateFrom, load }) {
  const key = `${kind}:${gameId}`;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async () => {
    let doc = null;
    try {
      doc = await GameCache.findOne({ gameId, kind }).lean();
    } catch {
      /* base indisponible : on ira droit à IGDB */
    }

    const fresh =
      doc &&
      doc.ver === ver &&
      Date.now() - new Date(doc.updatedAt).getTime() < ttlFor(doc.releaseDate);
    if (fresh) return doc.payload;

    try {
      const payload = await load();
      // On n'écrit pas un « rien » : un id inconnu ou une réponse vide ne doit
      // pas se figer en base pour six mois.
      if (payload != null) {
        const rd = dateFrom
          ? dateFrom(payload)
          : await Promise.resolve(releaseDate).catch(() => null);
        await GameCache.updateOne(
          { gameId, kind },
          {
            $set: {
              ver,
              payload,
              releaseDate: rd ?? doc?.releaseDate ?? null,
            },
          },
          { upsert: true }
        ).catch(() => {
          /* l'écriture du cache ne doit jamais faire échouer la réponse */
        });
      }
      return payload;
    } catch (err) {
      // IGDB en panne : mieux vaut la version d'hier que rien du tout.
      if (doc) return doc.payload;
      throw err;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, task);
  return task;
}

// Les champs qu'on demande d'un jeu lié (parent, remake, DLC, édition…) :
// juste de quoi dessiner sa vignette et sa ligne de sortie.
const REL_EXPAND = (rel) =>
  [
    `${rel}.id`,
    `${rel}.name`,
    `${rel}.cover.image_id`,
    `${rel}.total_rating`,
    `${rel}.first_release_date`,
    `${rel}.game_type`,
    `${rel}.platforms.name`,
    `${rel}.platforms.abbreviation`,
  ].join(",");

// LA fiche. C'est l'union de ce que demandaient séparément /full, /details,
// /ratings, /howlong, /patches, /translate… — qui posaient quatre fois la même
// question à IGDB pour le même jeu. Une seule requête, un seul cache.
//
// `parent_game` et `version_parent` sont ici (et pas dans LINK_FIELDS) parce
// que la fiche elle-même en a besoin pour sa phrase « remake de … ».
export const CORE_FIELDS = [
  "name",
  "summary",
  "storyline",
  "game_type",
  "cover.image_id",
  "artworks.image_id",
  "artworks.width",
  "artworks.height",
  "screenshots.image_id",
  "screenshots.width",
  "screenshots.height",
  "genres.id",
  "genres.name",
  "themes.id",
  "themes.name",
  "game_modes.id",
  "game_modes.name",
  "player_perspectives.name",
  "platforms.id",
  "platforms.name",
  "platforms.abbreviation",
  "release_dates.platform",
  "release_dates.date",
  "release_dates.human",
  "release_dates.region",
  "release_dates.status",
  "first_release_date",
  "rating",
  "rating_count",
  "total_rating",
  "total_rating_count",
  "aggregated_rating",
  "aggregated_rating_count",
  "language_supports.language.name",
  "language_supports.language.locale",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "videos.video_id",
  "videos.name",
  "websites.url",
  "websites.category",
  "game_engines.name",
  "franchises.name",
  "collections.name",
  "alternative_names.name",
  "alternative_names.comment",
  "similar_games.name",
  "similar_games.cover.image_id",
  "similar_games.total_rating",
  "similar_games.first_release_date",
  // Les boutiques ET l'appid Steam : c'était une requête `external_games`
  // séparée pour chacun des deux usages, alors qu'IGDB sait les joindre.
  "external_games.external_game_source",
  "external_games.url",
  "external_games.uid",
  REL_EXPAND("parent_game"),
  REL_EXPAND("version_parent"),
].join(",");

// La parenté large : elle ne sert qu'aux onglets « Éditions & versions » et
// « Sorties ». Séparée de la fiche exprès — onze relations développées, c'est
// une grosse réponse qu'on n'a aucune raison de payer quand on ouvre une fiche.
const LINK_RELATIONS = [
  "dlcs",
  "expansions",
  "standalone_expansions",
  "remakes",
  "remasters",
  "expanded_games",
  "ports",
  "bundles",
  "forks",
];

export const LINK_FIELDS = LINK_RELATIONS.map(REL_EXPAND).join(",");

// Les champs d'un jeu de la saga / d'une édition, dans les listes.
export const REL_SUBFIELDS = [
  "name",
  "cover.image_id",
  "total_rating",
  "first_release_date",
  "game_type",
];

// Bumper une de ces versions invalide le morceau correspondant, partout.
const VERSIONS = {
  core: 1,
  links: 1,
  chars: 1,
  ttb: 1,
  bundle: 1,
  editions: 1,
  series: 1,
};

const one = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

/** La fiche IGDB d'un jeu (ou null s'il n'existe pas). */
export async function gameCore(gameId) {
  const g = await remember({
    kind: "core",
    gameId,
    ver: VERSIONS.core,
    // La fiche apprend sa propre date de sortie en se chargeant.
    dateFrom: (payload) => payload?.first_release_date ?? null,
    load: async () =>
      one(await igdbQuery("games", `fields ${CORE_FIELDS}; where id = ${gameId};`)),
  });
  return g || null;
}

/** La date de sortie du jeu (secondes IGDB), pour dater les autres morceaux. */
export async function releaseDateOf(gameId) {
  try {
    const g = await gameCore(gameId);
    return g?.first_release_date ?? null;
  } catch {
    return null;
  }
}

/** La parenté large (DLC, remakes, portages, bundles…). */
export function gameLinks(gameId, releaseDate) {
  return remember({
    kind: "links",
    gameId,
    ver: VERSIONS.links,
    releaseDate,
    load: async () =>
      one(await igdbQuery("games", `fields ${LINK_FIELDS}; where id = ${gameId};`)) || {},
  });
}

/** Les personnages IGDB du jeu. */
export function gameCharacters(gameId, releaseDate) {
  return remember({
    kind: "chars",
    gameId,
    ver: VERSIONS.chars,
    releaseDate,
    load: () =>
      igdbQuery(
        "characters",
        `fields name,mug_shot.image_id; where games = (${gameId}); limit 50;`
      ),
  });
}

/** Les temps de complétion mesurés par IGDB (avant tout repli sur HLTB). */
export function gameTimeToBeat(gameId, releaseDate) {
  return remember({
    kind: "ttb",
    gameId,
    ver: VERSIONS.ttb,
    releaseDate,
    load: () =>
      igdbQuery(
        "game_time_to_beats",
        `fields hastily,normally,completely; where game_id = ${gameId};`
      ),
  });
}

/** Les jeux CONTENUS dans un bundle (ceux qui le citent dans leur champ `bundles`). */
export function gameBundleContents(gameId, releaseDate) {
  return remember({
    kind: "bundle",
    gameId,
    ver: VERSIONS.bundle,
    releaseDate,
    load: () =>
      igdbQuery(
        "games",
        `fields name,cover.image_id,total_rating,first_release_date; where bundles = (${gameId}); limit 50;`
      ),
  });
}

/** Les éditions de CE jeu (Deluxe, GOTY…) : celles dont il est le version_parent. */
export function gameEditions(gameId, releaseDate) {
  return remember({
    kind: "editions",
    gameId,
    ver: VERSIONS.editions,
    releaseDate,
    load: () =>
      igdbQuery(
        "games",
        `fields ${REL_SUBFIELDS.join(",")}; where version_parent = ${gameId}; limit 50;`
      ),
  });
}

/**
 * La saga : les jeux principaux de la même franchise (ou collection).
 * `whereRel` vient de l'appelant, qui sait laquelle des deux existe.
 */
export function gameSeries(gameId, whereRel, releaseDate) {
  return remember({
    kind: "series",
    gameId,
    ver: VERSIONS.series,
    releaseDate,
    load: () =>
      igdbQuery(
        "games",
        `fields ${REL_SUBFIELDS.join(",")}; where ${whereRel} & id != ${gameId} & version_parent = null & cover != null; sort first_release_date desc; limit 500;`
      ),
  });
}

/** Oublie tout ce qu'on sait d'un jeu (bouton « rafraîchir » du panel admin). */
export async function forgetGame(gameId) {
  const res = await GameCache.deleteMany({ gameId: Number(gameId) });
  return res.deletedCount || 0;
}
