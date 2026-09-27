import { igdbQuery } from "./igdb.js";
import { createTtlCache } from "./ttlCache.js";

// ======================================================================
//  Les tendances du moment (tri par défaut de l'Explorer)
// ======================================================================
// ⚠️ « POPULARITÉ » N'EST PAS « TENDANCE ». L'Explorer triait par nombre total
// d'avis IGDB : un classement de TOUS LES TEMPS, donc The Witcher 3, GTA V et
// Skyrim en tête, tous les jours, pour toujours. Ce qu'on veut voir en ouvrant
// l'Explorer, c'est ce dont on parle AUJOURD'HUI : ce qui vient de sortir et
// cartonne, ce qui arrive et qu'on attend, ce qui vient d'être annoncé.
//
// IGDB publie des « primitives de popularité » recalculées chaque jour. Aucune
// ne suffit seule — les visites remontent Roblox et Minecraft, les ventes
// Steam des éditions GOTY de 2010 — alors on les MÉLANGE :
//
//   • visites de la fiche IGDB du jour          (ce qui intrigue)
//   • meilleures ventes Steam                   (ce qui se vend)
//   • les plus ajoutés en wishlist, à venir     (ce qu'on attend)
//   • heures regardées sur Twitch en 24 h       (ce qu'on regarde)
//
// Chaque source donne des points selon le RANG (pas la valeur brute : visites
// et heures de stream ne se comparent pas), puis l'âge du jeu module le tout :
// sorti il y a moins d'un mois et demi, gros coup de pouce ; à venir dans
// l'année, coup de pouce ; vieux de plus de trois ans, fortement freiné — un
// classique ne disparaît pas, il laisse la place. Un jeu entré chez IGDB il y
// a moins de trois mois (fraîchement annoncé) est aussi poussé.
//
// Enfin une petite variation propre à la JOURNÉE (±10 %, la même pour tout le
// monde) : deux jeux au coude-à-coude ne restent pas figés dans le même ordre.

const DAY = 86400;
const SOURCES = [
  { type: 1, weight: 1.0, limit: 400 }, // visites IGDB
  { type: 9, weight: 0.8, limit: 150 }, // meilleures ventes Steam
  { type: 10, weight: 0.75, limit: 150 }, // plus attendus (wishlists Steam)
  { type: 34, weight: 0.6, limit: 150 }, // heures regardées sur Twitch (24 h)
];
// Jeux de base, remakes, remasters, jeux étendus — pas les DLC, packs, mods…
const KEPT_TYPES = new Set([0, 8, 9, 10]);
// Thème IGDB « Érotique » : les ventes Steam en remontent, pas l'Explorer.
const EROTIC = 42;

// ⚠️ LA NOTORIÉTÉ PÈSE AUSSI. Sans elle, les meilleures ventes Steam du jour
// remplissaient la tête de petits jeux à 2 € que personne ne connaît. Les
// suivis d'avant-sortie (`hypes`) et les avis (`total_rating_count`) disent si
// un jeu compte au-delà d'une journée : de ×0,45 (inconnu) à ×1,3 (très suivi),
// sur une échelle logarithmique — Wolverine ne doit pas écraser tout le reste.
function renown(g) {
  const n = (g.hypes || 0) + (g.total_rating_count || 0);
  return Math.min(1.3, 0.45 + Math.log10(1 + n) / 3);
}

const cache = createTtlCache({ name: "games:trending", max: 2, ttl: 3 * 3600 * 1000 });

// Nombre pseudo-aléatoire stable pour un couple (jeu, jour), dans [0, 1).
function dayNoise(id, day) {
  let h = (id * 2654435761 + day * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return (h % 10000) / 10000;
}

function ageFactor(g, now) {
  const d = g.first_release_date;
  let f;
  if (!d) f = 1.1; // annoncé, pas daté
  else if (d > now) f = d - now < 400 * DAY ? 1.45 : 1.0;
  else {
    const age = (now - d) / DAY;
    if (age <= 45) f = 2.3;
    else if (age <= 180) f = 1.5;
    else if (age <= 365) f = 1.0;
    else if (age <= 3 * 365) f = 0.55;
    else f = 0.28;
  }
  if (g.created_at && now - g.created_at < 90 * DAY) f *= 1.5;
  return f;
}

async function compute() {
  const lists = await Promise.all(
    SOURCES.map((s) =>
      igdbQuery(
        "popularity_primitives",
        `fields game_id,value; where popularity_type = ${s.type}; sort value desc; limit ${s.limit};`
      ).catch(() => [])
    )
  );

  const score = new Map();
  SOURCES.forEach((s, i) => {
    const rows = lists[i] || [];
    rows.forEach((r, rank) => {
      const pts = (1 - rank / rows.length) * s.weight;
      score.set(r.game_id, (score.get(r.game_id) || 0) + pts);
    });
  });

  const ids = [...score.keys()];
  const meta = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await igdbQuery(
      "games",
      `fields first_release_date,created_at,game_type,version_parent,hypes,total_rating_count,themes; where id = (${chunk.join(",")}); limit 500;`
    ).catch(() => []);
    meta.push(...rows);
  }

  const now = Math.floor(Date.now() / 1000);
  const day = Math.floor(now / DAY);
  return meta
    .filter((g) => !g.version_parent && KEPT_TYPES.has(g.game_type ?? 0))
    .filter((g) => !(g.themes || []).includes(EROTIC))
    .map((g) => ({
      id: g.id,
      score:
        score.get(g.id) * ageFactor(g, now) * renown(g) * (0.9 + 0.2 * dayNoise(g.id, day)),
    }))
    .sort((a, b) => b.score - a.score);
}

/** Les ids IGDB des jeux tendance, du plus au moins, gardés trois heures. */
export async function trendingIds() {
  const ranked = await cache.remember("pool", compute);
  return ranked.map((r) => r.id);
}
