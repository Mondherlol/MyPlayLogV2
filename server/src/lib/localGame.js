// ======================================================================
//  Les fiches locales : un jeu Steam qui n'est pas (encore) chez IGDB
// ======================================================================
//
// LA CONVENTION, EN UNE LIGNE : un identifiant de jeu NÉGATIF désigne une fiche
// locale, et sa valeur absolue est l'appid Steam. `-4887440` est donc le jeu
// dont la page est store.steampowered.com/app/4887440.
//
// POURQUOI PAS UNE COLLECTION À PART AVEC SES PROPRES IDENTIFIANTS. Parce que
// `gameId` est un NOMBRE dans une douzaine de modèles (bibliothèque, listes,
// avis, succès, temps de complétion, activité…) et dans presque autant de
// routes. Changer son type, c'était toucher à tout et risquer de casser des
// index qui portent des collections entières. Un nombre négatif, lui, traverse
// tout ça sans que rien n'ait à le savoir : seuls les endroits qui PARLENT À
// IGDB doivent se poser la question, et ils la posent avec `isLocalId()`.
//
// CE QUI EN DÉCOULE, ET QU'IL FAUT ACCEPTER : une fiche locale est plus pauvre
// qu'une fiche IGDB. Pas de notes de la presse, pas d'OST, pas de personnages,
// pas de saga, pas de temps de complétion — ces sections n'ont simplement rien
// à afficher, et la fiche le dit au lieu de faire semblant.

import SteamGame from "../models/SteamGame.js";
import { storeUrl } from "./steamStore.js";

/** Vrai si cet identifiant désigne une fiche locale (et non un jeu IGDB). */
export const isLocalId = (id) => Number(id) < 0;

/** L'appid Steam derrière un identifiant local. */
export const appIdOf = (id) => Math.abs(Number(id));

/** L'identifiant de jeu à donner à la fiche locale d'un appid Steam. */
export const localIdOf = (appid) => -Math.abs(Number(appid));

// IGDB numérote ses plateformes : 6 = PC (Microsoft Windows), 14 = Mac,
// 3 = Linux. On réutilise SES identifiants exprès — les filtres, les icônes de
// plateforme et les libellés de l'app sont déjà écrits pour eux, donc une fiche
// locale s'affiche comme les autres sans une ligne de plus côté client.
const OS_TO_IGDB = {
  windows: { id: 6, name: "PC (Microsoft Windows)", abbreviation: "PC" },
  mac: { id: 14, name: "Mac", abbreviation: "Mac" },
  linux: { id: 3, name: "Linux", abbreviation: "Linux" },
};

// Le type de site IGDB pour « Steam ». Même numérotation que `websites.type`
// dans la fiche IGDB (cf. CORE_FIELDS dans lib/gameIgdb.js).
const WEBSITE_STEAM = 13;
const WEBSITE_OFFICIAL = 1;

/**
 * Une fiche `SteamGame` habillée en RÉPONSE IGDB.
 *
 * ⚠️ C'EST VOLONTAIREMENT UN DÉGUISEMENT, ET C'EST TOUT L'INTÉRÊT. Les 2 000
 * lignes de routes/games.js qui mettent une fiche en forme (les images, les
 * studios, les genres traduits, les liens boutique) n'ont pas à connaître
 * l'existence de Steam : elles reçoivent la même forme d'objet que d'habitude.
 *
 * La seule liberté prise sur le format : `image_id` contient ici une URL
 * ABSOLUE au lieu d'un identifiant d'image IGDB. Les constructeurs d'URL de
 * routes/games.js (`igdbImg`) laissent passer une URL absolue telle quelle —
 * c'est la seule concession, et elle tient en une ligne.
 */
export function coreFromSteam(doc) {
  if (!doc) return null;

  const url = storeUrl(doc.appid);
  const cover = doc.cover || doc.header || null;

  const shots = (doc.screenshots || [])
    .filter((s) => s.full || s.thumb)
    .map((s) => ({ image_id: s.full || s.thumb, width: s.w || null, height: s.h || null }));

  const companies = [
    ...(doc.developers || []).map((name) => ({
      company: { name },
      developer: true,
      publisher: false,
    })),
    ...(doc.publishers || [])
      // Un studio qui s'auto-édite (le cas de presque tous les jeux indés) est
      // dans les deux listes de Steam. Il ne doit apparaître qu'une fois.
      .filter((name) => !(doc.developers || []).includes(name))
      .map((name) => ({ company: { name }, developer: false, publisher: true })),
  ];

  return {
    id: localIdOf(doc.appid),
    name: doc.name,
    summary: doc.shortDescription || "",
    storyline: doc.description || "",
    game_type: 0, // « main game »
    cover: cover ? { image_id: cover } : null,
    // La bannière Steam fait un fond de page correct quand le jeu n'a aucune
    // capture (jeu tout juste annoncé) : on la range dans les artworks, que la
    // fiche préfère déjà aux captures pour son décor.
    artworks: doc.background ? [{ image_id: doc.background, width: null, height: null }] : [],
    screenshots: shots,
    genres: (doc.genres || []).map((name) => ({ id: 0, name })),
    themes: [],
    game_modes: [],
    player_perspectives: [],
    platforms: (doc.oses || []).map((os) => OS_TO_IGDB[os]).filter(Boolean),
    release_dates: doc.releaseDate
      ? [{ date: doc.releaseDate, human: doc.releaseHuman || null, platform: 6 }]
      : [],
    first_release_date: doc.releaseDate || null,
    // Aucune note : ni la nôtre (elle vient des utilisateurs, calculée
    // ailleurs), ni celle de la presse. `null` partout plutôt que 0, qui
    // s'afficherait comme une très mauvaise note.
    rating: null,
    rating_count: 0,
    total_rating: null,
    total_rating_count: 0,
    aggregated_rating: null,
    aggregated_rating_count: 0,
    language_supports: [],
    involved_companies: companies,
    videos: [], // Steam sert du mp4, la fiche attend des vidéos YouTube.
    websites: [
      { url, type: WEBSITE_STEAM },
      ...(doc.website ? [{ url: doc.website, type: WEBSITE_OFFICIAL }] : []),
    ],
    game_engines: [],
    franchises: [],
    collections: [],
    alternative_names: doc.nameOriginal
      ? [{ name: doc.nameOriginal, comment: "Titre original (Steam)" }]
      : [],
    similar_games: [],
    external_games: [{ external_game_source: 1, uid: String(doc.appid), url }],

    // --- Ce qui n'existe QUE sur une fiche locale ---
    // La fiche et l'app s'en servent pour dire ce qu'elles sont : une fiche
    // provisoire tirée de Steam, en attendant qu'IGDB connaisse le jeu.
    local: true,
    steamAppId: doc.appid,
    steamUrl: url,
    steamHeader: doc.header || null,
    steamVideos: doc.videos || [],
    comingSoon: !!doc.comingSoon,
    submittedToIgdb: !!doc.submittedAt,
  };
}

/** La fiche locale d'un identifiant négatif, au format IGDB — ou `null`. */
export async function localCore(gameId) {
  const doc = await SteamGame.findOne({ appid: appIdOf(gameId) }).lean();
  if (!doc) return null;
  return coreFromSteam(doc);
}
