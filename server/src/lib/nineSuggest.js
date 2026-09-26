// ======================================================================
//  Le principe des 9 — ce qu'on propose en premier, thème par thème
// ======================================================================
// « Ces 9 jeux où j'ai englouti des heures » et « Ces 9 jeux de mon enfance »
// ne se remplissent pas avec les mêmes jeux : la fenêtre de choix ouvre donc
// sur un rayon propre au thème, tiré de TA bibliothèque, avant les rayons
// de toujours (coups de cœur, mieux notés…).
//
// Chaque thème est une règle : un filtre (facultatif) et un score. Les deux
// lisent l'entrée de bibliothèque (note, heures, coup de cœur, statut) et la
// fiche du jeu (date, note du public, popularité, thèmes, genres, modes,
// mots-clés), prise dans le catalogue local du moteur de recommandations —
// ou, pour les jeux qu'il ne couvre pas, demandée à IGDB.
//
// ⚠️ UN RAYON QUI NE TROUVE RIEN N'EST PAS UNE ERREUR. Quelqu'un qui n'a aucun
// jeu d'horreur n'a pas de rayon « Horreur et frissons » : on ne renvoie rien,
// et la fenêtre ouvre sur les rayons habituels.

import GameFeatures from "../models/GameFeatures.js";
import UserGame from "../models/UserGame.js";
import { igdbQuery } from "./igdb.js";

const YEAR_S = 365.25 * 86400;

// Identifiants IGDB (thèmes, genres, modes, mots-clés) qu'utilisent les règles.
const TH = { fantasy: 17, scifi: 18, horror: 19, thriller: 20, survival: 21, drama: 31, openWorld: 38, romance: 44 };
const GENRE = {
  fighting: 4,
  shooter: 5,
  music: 7,
  platform: 8,
  racing: 10,
  rpg: 12,
  sport: 14,
  hackSlash: 25,
  arcade: 33,
  adventure: 31,
  visualNovel: 34,
};
const TH_ACTION = 1;
const TH_PARTY = 40;
const MODES_GROUP = [2, 3, 4, 5]; // multi, coop, écran partagé, MMO
const KW = {
  emotional: [2202, 51415, 2426],
  hard: [905, 38908, 17872, 17326, 27086, 54748, 578, 416],
  soundtrack: [3403],
  villain: [5587],
  cozy: [2084, 24685, 23931],
  world: [6456],
};

const has = (list, ids) => (list || []).some((x) => ids.includes(x));
const isStory = (f) =>
  has(f?.themes, [TH.drama, TH.romance]) ||
  has(f?.keywords, KW.emotional) ||
  has(f?.genres, [GENRE.rpg, GENRE.adventure, GENRE.visualNovel]);

// La note qu'on prête à l'entrée quand il n'y en a pas : un coup de cœur vaut
// une très bonne note, un jeu fini une bonne, le reste un « bof » neutre.
const userScore = (e) =>
  e.rating != null ? e.rating : e.favorite ? 88 : e.status === "finished" ? 70 : 55;
const hoursOf = (e) => e.playtimeHours || e.psnPlaytimeHours || 0;
const ageOf = (f) => (f?.date ? (Date.now() / 1000 - f.date) / YEAR_S : null);

export const NINE_SUGGEST = {
  personality: {
    label: "Tes coups de cœur de longue date",
    score: (e, f) => userScore(e) + (e.favorite ? 40 : 0) + Math.min(20, (ageOf(f) || 0) * 1.5),
  },
  childhood: {
    label: "Sortis il y a plus de 12 ans",
    filter: (e, f) => (ageOf(f) || 0) >= 12,
    score: (e, f) => userScore(e) + (e.favorite ? 30 : 0) + Math.min(25, (ageOf(f) || 0) - 12),
  },
  cried: {
    label: "Des histoires qui touchent",
    filter: (e, f) => has(f?.themes, [TH.drama, TH.romance]) || has(f?.keywords, KW.emotional),
    score: (e) => userScore(e) + (e.favorite ? 25 : 0),
  },
  island: {
    label: "Ceux que tu garderais toujours",
    score: (e) => userScore(e) + (e.favorite ? 30 : 0) + Math.log2(1 + hoursOf(e)) * 2,
  },
  mustplay: {
    label: "Adorés par toi et par le public",
    filter: (e) => userScore(e) >= 75 || e.favorite,
    score: (e, f) => userScore(e) * 0.6 + (f?.rating ?? 70) * 0.4 + (e.status === "finished" ? 8 : 0),
  },
  comfort: {
    label: "Ceux où tu reviens toujours",
    score: (e, f) =>
      Math.log2(1 + hoursOf(e)) * 12 +
      (e.status === "endless" ? 30 : e.status === "playing" ? 10 : 0) +
      (has(f?.keywords, KW.cozy) ? 20 : 0) +
      userScore(e) * 0.3,
  },
  underrated: {
    label: "Aimés par toi, boudés par le public",
    filter: (e, f) => (userScore(e) >= 70 || e.favorite) && f != null,
    score: (e, f) =>
      userScore(e) -
      (f.rating ?? 72) +
      (f.ratingCount < 30 ? 30 : f.ratingCount < 150 ? 15 : f.ratingCount < 600 ? 5 : -10) +
      (e.favorite ? 10 : 0),
  },
  soundtrack: {
    label: "Tes OST favorites d'abord",
    score: (e, f) =>
      (e.favoriteOst?.name ? 60 : 0) +
      (has(f?.genres, [GENRE.music]) ? 30 : 0) +
      (has(f?.keywords, KW.soundtrack) ? 25 : 0) +
      userScore(e) * 0.5,
  },
  firsttime: {
    label: "Terminés et adorés",
    filter: (e) => e.status === "finished" || e.favorite,
    score: (e) => userScore(e) + (e.favorite ? 20 : 0),
  },
  scared: {
    label: "Horreur et frissons",
    filter: (e, f) => has(f?.themes, [TH.horror, TH.thriller, TH.survival]),
    score: (e, f) => userScore(e) + (has(f?.themes, [TH.horror]) ? 15 : 0),
  },
  worlds: {
    label: "Des univers à part",
    filter: (e, f) =>
      has(f?.themes, [TH.fantasy, TH.scifi, TH.openWorld]) || has(f?.keywords, KW.world),
    score: (e) => userScore(e) + (e.favorite ? 20 : 0) + Math.log2(1 + hoursOf(e)) * 3,
  },
  villains: {
    label: "Des histoires et leurs méchants",
    filter: (e, f) =>
      has(f?.keywords, KW.villain) || has(f?.themes, [TH.drama, TH.fantasy, TH.scifi, TH.thriller]),
    score: (e, f) => userScore(e) + (has(f?.keywords, KW.villain) ? 25 : 0) + (e.favoriteCharacter?.name ? 10 : 0),
  },
  coop: {
    label: "Jouables à plusieurs",
    filter: (e, f) => has(f?.modes, MODES_GROUP),
    score: (e, f) => userScore(e) + (has(f?.modes, [3, 4]) ? 15 : 0) + Math.log2(1 + hoursOf(e)) * 4,
  },
  rage: {
    label: "Les plus exigeants",
    filter: (e, f) => has(f?.keywords, KW.hard) || has(f?.genres, [GENRE.fighting]),
    score: (e) => userScore(e) + Math.log2(1 + hoursOf(e)) * 4,
  },
  hours: {
    label: "Tes plus longues parties",
    filter: (e) => hoursOf(e) > 0,
    score: (e) => hoursOf(e),
  },
  // --- Les cases de « Ma carte de joueur » (cf. lib/boards) ------------
  favorites: {
    label: "Tes coups de cœur",
    score: (e) => userScore(e) + (e.favorite ? 50 : 0) + Math.log2(1 + hoursOf(e)),
  },
  story: {
    label: "Des jeux à histoire",
    filter: (e, f) => isStory(f),
    score: (e, f) => userScore(e) + (e.favorite ? 20 : 0) + (has(f?.keywords, KW.emotional) ? 15 : 0),
  },
  art: {
    label: "Tes mieux notés",
    score: (e, f) => userScore(e) + (e.favorite ? 20 : 0) + (f?.rating ?? 70) * 0.2,
  },
  combat: {
    label: "Ça se bat",
    filter: (e, f) =>
      has(f?.genres, [GENRE.fighting, GENRE.hackSlash, GENRE.shooter]) ||
      (has(f?.themes, [TH_ACTION]) && has(f?.keywords, KW.hard)),
    score: (e) => userScore(e) + Math.log2(1 + hoursOf(e)) * 3,
  },
  // Populaire, mal-aimé du public, et toi tu l'aimes : l'injustice qu'on défend.
  overhated: {
    label: "Aimés par toi, détestés par beaucoup",
    filter: (e, f) => (userScore(e) >= 70 || e.favorite) && f?.rating != null && f.ratingCount >= 100,
    score: (e, f) => userScore(e) - f.rating + Math.min(20, Math.log2(f.ratingCount) * 2),
  },
  // Adoré du public, et toi pas tant que ça.
  overrated: {
    label: "Encensés par le public, pas par toi",
    filter: (e, f) => e.rating != null && f?.rating != null && f.rating - e.rating >= 10,
    score: (e, f) => f.rating - e.rating + Math.min(15, Math.log2(1 + f.ratingCount)),
  },
  remake: {
    label: "Des classiques qui ont vieilli",
    filter: (e, f) => (ageOf(f) || 0) >= 15,
    score: (e, f) => userScore(e) + (e.favorite ? 20 : 0) + Math.min(20, (ageOf(f) || 0) - 15),
  },
  overlooked: {
    label: "Aimés par toi, connus de peu",
    filter: (e, f) => (userScore(e) >= 70 || e.favorite) && (f == null || f.ratingCount < 80),
    score: (e, f) => userScore(e) + (f ? 40 - Math.min(40, f.ratingCount / 2) : 30),
  },
  // « Pas mon style, mais… » : un jeu aimé dans un genre rare de ta bibliothèque.
  notmything: {
    label: "Hors de tes genres habituels",
    filter: (e) => userScore(e) >= 65 || e.favorite,
    score: (e, f, ctx) => {
      const g = f?.genres || [];
      if (!g.length) return userScore(e) - 40;
      const common = Math.max(...g.map((id) => ctx.genreShare.get(id) || 0));
      return userScore(e) - common * 150;
    },
  },
  brainoff: {
    label: "Pour débrancher le cerveau",
    filter: (e, f) =>
      has(f?.genres, [GENRE.arcade, GENRE.racing, GENRE.platform, GENRE.sport, GENRE.hackSlash]) ||
      has(f?.themes, [TH_PARTY]) ||
      has(f?.keywords, KW.cozy),
    score: (e) => userScore(e) + Math.log2(1 + hoursOf(e)) * 4,
  },
  multiplayer: {
    label: "Du multi, surtout en ligne",
    filter: (e, f) => has(f?.modes, [2, 5, 6]),
    score: (e, f) =>
      userScore(e) + (has(f?.modes, [5, 6]) ? 20 : 0) + Math.log2(1 + hoursOf(e)) * 6 - (has(f?.modes, [1]) ? 10 : 0),
  },
  retro: {
    label: "Sortis il y a plus de 20 ans",
    filter: (e, f) => (ageOf(f) || 0) >= 20,
    score: (e) => userScore(e) + (e.favorite ? 25 : 0),
  },
  disappointed: {
    label: "Ceux qui t'ont déçu",
    filter: (e) => (e.rating != null && e.rating <= 65) || e.status === "dropped",
    score: (e, f) =>
      100 - (e.rating ?? 50) + (e.status === "dropped" ? 15 : 0) + ((f?.rating ?? 0) >= 80 ? 20 : 0) + Math.min(20, (f?.hypes || 0) / 10),
  },
};

// ----------------------------------------------------------------------
//  Les fiches des jeux : catalogue local d'abord, IGDB pour le reste
// ----------------------------------------------------------------------
// Les jeux hors catalogue (ni notés ni attendus par assez de monde) sont
// justement ceux d'une bibliothèque un peu pointue : on les demande à IGDB,
// par paquets, et on les garde une journée.
const DAY_MS = 86400000;
const extraCache = new Map(); // id → { at, f }

async function featuresFor(ids) {
  const out = new Map();
  const rows = await GameFeatures.find({ _id: { $in: ids } })
    .select("date rating ratingCount hypes themes genres modes keywords")
    .lean()
    .catch(() => []);
  for (const r of rows) out.set(r._id, r);

  const now = Date.now();
  const missing = [];
  for (const id of ids) {
    if (out.has(id)) continue;
    const hit = extraCache.get(id);
    if (hit && now - hit.at < DAY_MS) out.set(id, hit.f);
    else if (id > 0) missing.push(id);
  }
  for (let i = 0; i < missing.length && i < 1500; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const got = await igdbQuery(
      "games",
      `fields first_release_date,total_rating,total_rating_count,hypes,themes,genres,game_modes,keywords; where id = (${chunk.join(",")}); limit 500;`
    ).catch(() => []);
    for (const g of got || []) {
      const f = {
        date: g.first_release_date ?? null,
        rating: g.total_rating ?? null,
        ratingCount: g.total_rating_count || 0,
        hypes: g.hypes || 0,
        themes: g.themes || [],
        genres: g.genres || [],
        modes: g.game_modes || [],
        keywords: g.keywords || [],
      };
      out.set(g.id, f);
      extraCache.set(g.id, { at: now, f });
    }
  }
  if (extraCache.size > 20000) extraCache.clear();
  return out;
}

/**
 * Le rayon d'un thème pour une personne : `{ label, games }`, ou `null` quand
 * le thème n'a pas de règle (thème inventé) ou que rien ne correspond.
 */
export async function nineSuggestions(userId, theme, limit = 60) {
  const rule = Object.hasOwn(NINE_SUGGEST, theme) ? NINE_SUGGEST[theme] : null;
  if (!rule) return null;
  const entries = await UserGame.find({ user: userId, status: { $ne: "wishlist" } })
    .select("gameId name cover status favorite rating playtimeHours psnPlaytimeHours favoriteOst favoriteCharacter")
    .lean();
  if (!entries.length) return null;

  const feats = await featuresFor(entries.map((e) => e.gameId));
  // Le contexte de la bibliothèque entière : la part de chaque genre (pour
  // « pas mon style, mais… », qui cherche ce qui sort de l'ordinaire).
  const genreCount = new Map();
  for (const e of entries)
    for (const g of feats.get(e.gameId)?.genres || []) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  const ctx = {
    genreShare: new Map([...genreCount].map(([g, n]) => [g, n / entries.length])),
  };
  const scored = [];
  for (const e of entries) {
    const f = feats.get(e.gameId) || null;
    if (rule.filter && !rule.filter(e, f, ctx)) continue;
    scored.push({ e, f, s: rule.score(e, f, ctx) });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);

  return {
    label: rule.label,
    games: scored.slice(0, limit).map(({ e, f }) => ({
      id: e.gameId,
      name: e.name,
      cover: e.cover || null,
      year: f?.date ? new Date(f.date * 1000).getFullYear() : null,
    })),
  };
}
