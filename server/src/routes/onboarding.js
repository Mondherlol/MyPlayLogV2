// ======================================================================
//  Le parcours d'accueil — ce que le serveur doit lui fournir
// ======================================================================
//
// Le parcours (site et application) pose deux questions qui ont besoin du
// catalogue : « qu'est-ce qui te fait envie ? » et « à quoi as-tu déjà
// joué ? ». Pour qu'elles se répondent en dix secondes, il faut les visages que
// TOUT LE MONDE reconnaît — pas un champ de recherche vide.
//
// ⚠️ DEUX LISTES, PARCE QUE CE NE SONT PAS LES MÊMES JEUX.
//   • `games` — les jeux les plus JOUÉS de l'histoire (nombre de notes). C'est
//     la bonne réponse à « tu as déjà fini quoi ? » : Ocarina of Time y est
//     encore, les sorties du mois n'y sont pas.
//   • `awaited` — les jeux les plus ATTENDUS (`hypes` d'IGDB, sortie future).
//     C'est la bonne réponse à « qu'est-ce qui te tente ? » : proposer comme
//     envie un jeu sorti il y a quinze ans, c'est proposer quelque chose que
//     la plupart des gens ont déjà fait ou décidé de ne jamais faire.

import express from "express";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { createTtlCache } from "../lib/ttlCache.js";
import User from "../models/User.js";
import UserGame from "../models/UserGame.js";

const router = express.Router();

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
const cover = (imageId) => (imageId ? `${IMG_BASE}/t_cover_big/${imageId}.jpg` : null);

// Combien on ratisse, et combien on rend. Le ratissage est LARGE parce que les
// jeux sont dédoublonnés par saga (voir plus bas) : sur cent jeux on n'aurait
// qu'une vingtaine de licences différentes.
const SCAN = 500;
const GAMES = 42;
const AWAITED = 40;

// ⚠️ DOUZE HEURES, PAS UNE JOURNÉE. Les incontournables ne bougent pas, mais
// la liste des attendus contient une date : un jeu sort, et il n'a plus rien à
// faire parmi les envies à venir le lendemain matin.
//
// La réponse est la même pour tout le monde : l'immense majorité des
// inscriptions ne touche jamais IGDB.
const picksCache = createTtlCache({
  name: "onboarding:picks",
  max: 2,
  ttl: 12 * 60 * 60 * 1000,
});

// ⚠️ `total_rating_count`, PAS `popularity`. Le second mesure ce qu'on REGARDE
// cette semaine sur IGDB — donc les sorties du mois, qui ne disent rien de ce
// que quelqu'un a joué. Le nombre de notes mesure ce que les gens ont vraiment
// JOUÉ, depuis toujours.
const SCAN_QUERY =
  `fields name,cover.image_id,first_release_date,total_rating_count,` +
  `collections.id,franchises.id;` +
  ` where cover != null & version_parent = null & game_type = 0` +
  ` & total_rating_count != null;` +
  ` sort total_rating_count desc; limit ${SCAN};`;

// Même filtre que la découverte du fil d'accueil (cf. routes/feed.js) : un jeu
// principal, un remake ou un remaster, pas encore sorti, et assez attendu pour
// ne pas être une curiosité.
const awaitedQuery = (now) =>
  `fields name,cover.image_id,first_release_date,hypes;` +
  ` where cover != null & version_parent = null & game_type = (0,8,9)` +
  ` & first_release_date > ${now} & hypes > 5;` +
  ` sort hypes desc; limit ${AWAITED};`;

// La licence d'un jeu, pour dédoublonner. On préfère la COLLECTION (la série
// telle qu'on la nomme) à la franchise (souvent l'univers commercial entier).
function sagaKey(g) {
  const c = g.collections?.[0]?.id;
  if (c) return `c:${c}`;
  const f = g.franchises?.[0]?.id;
  return f ? `f:${f}` : null;
}

const yearOf = (ts) => (ts ? new Date(ts * 1000).getFullYear() : null);

async function buildPicks() {
  const now = Math.floor(Date.now() / 1000);
  const [rows, soon] = await Promise.all([
    igdbQuery("games", SCAN_QUERY),
    // Les attendus sont un bonus : s'ils manquent, les clients retombent sur
    // les incontournables, et l'étape reste faisable.
    igdbQuery("games", awaitedQuery(now)).catch(() => []),
  ]);

  // ⚠️ UN JEU PAR SAGA. Sans cette règle, les huit premières cartes seraient
  // huit Zelda : la roue aurait l'air fournie et ne proposerait qu'un goût.
  const usedSaga = new Set();
  const games = [];
  for (const g of rows || []) {
    if (!g.cover?.image_id) continue;
    const key = sagaKey(g);
    if (key && usedSaga.has(key)) continue;
    if (key) usedSaga.add(key);
    games.push({
      id: g.id,
      name: g.name,
      cover: cover(g.cover.image_id),
      year: yearOf(g.first_release_date),
    });
    if (games.length >= GAMES) break;
  }

  const awaited = (soon || [])
    .filter((g) => g.cover?.image_id)
    .map((g) => ({
      id: g.id,
      name: g.name,
      cover: cover(g.cover.image_id),
      year: yearOf(g.first_release_date),
    }));

  return { games, awaited };
}

// ----------------------------------------------------------------------
//  GET /api/onboarding/picks — les jeux à proposer sur la roue
// ----------------------------------------------------------------------
router.get("/picks", requireAuth, async (_req, res) => {
  try {
    res.json(await picksCache.remember("v2", buildPicks));
  } catch (err) {
    console.error("onboarding picks error:", err.message);
    // ⚠️ 200 AVEC DES LISTES VIDES, PAS UNE ERREUR. IGDB en panne ne doit pas
    // bloquer une inscription : le parcours propose alors sa recherche seule,
    // et « Passer » reste là.
    res.json({ games: [], awaited: [], degraded: true });
  }
});

// ----------------------------------------------------------------------
//  GET /api/onboarding/imports — ce qui a déjà été importé
// ----------------------------------------------------------------------
// Pour que les cartes Steam et Backloggd disent « 123 jeux importés » au lieu
// de proposer à nouveau un import déjà fait — qui rejoue souvent l'intro
// depuis les réglages a déjà tout ramené.
//
// ⚠️ ON COMPTE LES ENTRÉES CRÉÉES PAR L'IMPORT, PAS LA BIBLIOTHÈQUE. Les
// drapeaux `steamImported` / `backloggdImported` ne sont posés qu'à la
// création : un jeu déjà là et simplement complété par l'import n'est pas
// « importé », il était déjà à lui. (Backloggd ne pose son drapeau que depuis
// l'arrivée du parcours : un import plus ancien compte pour zéro, et la carte
// propose simplement d'importer — ce qui ne duplique rien.)
router.get("/imports", requireAuth, async (req, res) => {
  try {
    const [user, steam, backloggd] = await Promise.all([
      User.findById(req.userId).select("steam").lean(),
      UserGame.countDocuments({ user: req.userId, steamImported: true }),
      UserGame.countDocuments({ user: req.userId, backloggdImported: true }),
    ]);
    res.json({
      steam: { linked: !!user?.steam?.steamId, count: steam },
      backloggd: { count: backloggd },
    });
  } catch (err) {
    console.error("onboarding imports error:", err.message);
    // Des cartes sans compteur valent mieux qu'un écran en erreur.
    res.json({ steam: { linked: false, count: 0 }, backloggd: { count: 0 } });
  }
});

export default router;
