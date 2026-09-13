// ======================================================================
//  Le parcours d'accueil — ce que le serveur doit lui fournir
// ======================================================================
//
// Le parcours (site et application) pose UNE question qui a besoin du
// catalogue : « à quoi tu joues ? ». Pour qu'elle se réponde en dix secondes,
// il ne faut ni champ de recherche vide ni grille au hasard : il faut les
// visages que TOUT LE MONDE reconnaît — Mario, Zelda, GTA, Elden Ring — et les
// sagas derrière eux.
//
// ⚠️ UNE SEULE REQUÊTE IGDB POUR LES DEUX, ET C'EST TOUT L'INTÉRÊT. On demande
// les jeux les plus notés du catalogue AVEC leur licence, puis on en déduit les
// sagas côté serveur (grouper, compter, prendre la jaquette du chef de file).
// Demander les sagas séparément coûterait une requête par nom, pour un résultat
// moins bon : IGDB ne sait pas classer les licences par popularité, alors que
// leurs jeux, si.
//
// ⚠️ ET LA RÉPONSE EST LA MÊME POUR TOUT LE MONDE. Elle ne dépend d'aucun
// compte : on la garde donc une journée en mémoire, et l'immense majorité des
// inscriptions ne touche jamais IGDB.

import express from "express";
import { igdbQuery } from "../lib/igdb.js";
import { requireAuth } from "../middleware/auth.js";
import { createTtlCache } from "../lib/ttlCache.js";

const router = express.Router();

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
const cover = (imageId) => (imageId ? `${IMG_BASE}/t_cover_big/${imageId}.jpg` : null);

// Combien on ratisse, et combien on rend. On ratisse LARGE (500 jeux) parce que
// les sagas se déduisent de ce tas : avec cent jeux, on n'aurait que les dix
// licences les plus évidentes, et la rangée serait la même pour tout le monde
// à jamais.
const SCAN = 500;
const FRANCHISES = 20;
const GAMES = 42;

// Le catalogue des jeux célèbres ne change pas d'une heure à l'autre.
const picksCache = createTtlCache({
  name: "onboarding:picks",
  max: 2,
  ttl: 24 * 60 * 60 * 1000,
});

// ⚠️ `total_rating_count`, PAS `popularity`. Le second mesure ce qu'on REGARDE
// cette semaine sur IGDB — donc les sorties du mois, qui ne disent rien des
// goûts de quelqu'un. Le nombre de notes, lui, mesure ce que les gens ont
// vraiment JOUÉ, depuis toujours : c'est la seule liste où Ocarina of Time
// figure encore, et c'est précisément celle qu'on veut montrer.
const SCAN_QUERY =
  `fields name,cover.image_id,first_release_date,total_rating_count,` +
  `collections.id,collections.name,franchises.id,franchises.name;` +
  ` where cover != null & version_parent = null & game_type = 0` +
  ` & total_rating_count != null;` +
  ` sort total_rating_count desc; limit ${SCAN};`;

// La licence d'un jeu. On préfère la COLLECTION à la franchise : chez IGDB, la
// collection est la série telle qu'on la nomme (« The Legend of Zelda »), la
// franchise est souvent l'univers commercial plus large qui la contient
// (« Nintendo »). Montrer la seconde donnerait une rangée d'éditeurs.
function sagaOf(g) {
  const c = g.collections?.[0];
  if (c?.id && c.name) return { kind: "collection", id: c.id, name: c.name };
  const f = g.franchises?.[0];
  if (f?.id && f.name) return { kind: "franchise", id: f.id, name: f.name };
  return null;
}

async function buildPicks() {
  const rows = (await igdbQuery("games", SCAN_QUERY)) || [];

  // --- Les sagas, déduites du tas ---
  const bySaga = new Map();
  for (const g of rows) {
    const saga = sagaOf(g);
    if (!saga) continue;
    const key = `${saga.kind}:${saga.id}`;
    const seen = bySaga.get(key);
    if (seen) {
      seen.count++;
      seen.weight += g.total_rating_count || 0;
    } else {
      bySaga.set(key, {
        ...saga,
        // Le chef de file arrive en premier (le tas est déjà trié) : sa
        // jaquette EST l'image de la saga, une licence n'en ayant pas à elle.
        cover: cover(g.cover?.image_id),
        gameId: g.id,
        count: 1,
        weight: g.total_rating_count || 0,
      });
    }
  }

  // ⚠️ AU MOINS DEUX JEUX POUR ÊTRE UNE SAGA. Sans ce filtre, un très gros jeu
  // isolé (Elden Ring, Minecraft) se présenterait comme une licence, et
  // l'ouvrir ne montrerait que lui — une case qui ne mène nulle part.
  const franchises = [...bySaga.values()]
    .filter((s) => s.count >= 2 && s.cover)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, FRANCHISES)
    .map(({ weight, ...s }) => s);

  // --- Les jeux, UN PAR SAGA ---
  // Sans cette règle, les huit premières cases seraient huit Zelda : la grille
  // aurait l'air fournie et ne proposerait qu'un seul goût.
  const usedSaga = new Set();
  const games = [];
  for (const g of rows) {
    if (!g.cover?.image_id) continue;
    const saga = sagaOf(g);
    const key = saga ? `${saga.kind}:${saga.id}` : null;
    if (key && usedSaga.has(key)) continue;
    if (key) usedSaga.add(key);
    games.push({
      id: g.id,
      name: g.name,
      cover: cover(g.cover.image_id),
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getFullYear()
        : null,
      saga: saga?.name || null,
    });
    if (games.length >= GAMES) break;
  }

  return { franchises, games };
}

// ----------------------------------------------------------------------
//  GET /api/onboarding/picks — de quoi remplir l'étape « à quoi tu joues ? »
// ----------------------------------------------------------------------
router.get("/picks", requireAuth, async (_req, res) => {
  try {
    res.json(await picksCache.remember("v1", buildPicks));
  } catch (err) {
    console.error("onboarding picks error:", err.message);
    // ⚠️ 200 AVEC DES LISTES VIDES, PAS UNE ERREUR. IGDB en panne ne doit pas
    // bloquer une inscription : le parcours affiche alors son champ de
    // recherche seul, et l'étape reste franchissable.
    res.json({ franchises: [], games: [], degraded: true });
  }
});

export default router;
