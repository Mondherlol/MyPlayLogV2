import Card from "../models/Card.js";
import CardOwn from "../models/CardOwn.js";
import GameFeatures from "../models/GameFeatures.js";
import IgdbTerm from "../models/IgdbTerm.js";
import AppSetting from "../models/AppSetting.js";
import { onRecoCatalogSynced } from "./recoCatalog.js";
import { igdbQuery } from "./igdb.js";
import { rulesForKeyword, movesFromRules } from "./cardMoves.js";
import { coverFocus } from "./cardFocus.js";
import { buildFacts, tagsForKeyword } from "./cardFacts.js";

// ======================================================================
//  Cartes à collectionner — le set, les boosters, le tirage
// ======================================================================
// Une carte = un JEU (jamais un DLC, un bundle, un portage ou une édition) :
// on prend le catalogue local des recommandations (GameFeatures), déjà nettoyé
// par IGDB, et on n'y garde que les jeux principaux, extensions autonomes,
// remakes et remasters. Les portages (type 11) et éditions augmentées (10)
// sont écartés : ils pointent vers leur jeu d'origine, qui porte la carte.
//
// Le tirage est INTÉGRALEMENT serveur, comme les caisses de l'arcade : le
// client reçoit les cinq cartes déjà décidées et ne fait que les mettre en scène.

// Prix d'un booster, en points d'arcade. Une partie rapporte quelques
// centaines de points ; une caisse de curseurs en coûte 1000.
export const PACK_PRICE = 500;
export const PACK_SIZE = 5;
export const CURRENT_SET = 1;

// Jeu principal (0), extension autonome (4), remake (8), remaster (9).
const CARD_TYPES = [0, 4, 8, 9];

// Combien de cartes par rareté, des plus populaires aux moins populaires. La
// dernière ligne prend TOUT le reste : le set contient chaque jeu sorti qui a
// été noté au moins une fois (~26 000 en septembre 2026). Les raretés hautes,
// elles, restent une élite de taille fixe — un mythique doit rester un mythe.
export const TIERS = [
  { key: "mythic", count: 25 },
  { key: "legendary", count: 125 },
  { key: "epic", count: 500 },
  { key: "rare", count: 1500 },
  { key: "uncommon", count: 5000 },
  { key: "common", count: Infinity },
];
// À monter quand la composition du set change (TIERS, critères) : le serveur
// recalcule alors numéros et raretés une fois, au chargement suivant.
// v1 : 3 000 cartes. v2 : tous les jeux notés.
const SET_VERSION = 2;
const SET_VERSION_KEY = "cards.setVersion";
export const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

// Les trois boosters : chacun ne tire QUE dans ses familles de jeux (ids de
// genres IGDB, les mêmes familles que les types des cartes côté client). Un
// jeu de deux familles est dans les deux ; un jeu sans genre, dans les trois.
export const PACK_EDITIONS = {
  braise: { label: "Action", genres: [4, 25, 5, 10, 14] }, // combat, tir, course, sport
  neon: { label: "Arcade & indé", genres: [33, 30, 32, 7, 9, 26, 35, 8] }, // arcade, indé, rythme, réflexion, plateforme
  origines: { label: "Aventure & RPG", genres: [12, 31, 2, 11, 15, 16, 24, 36, 13, 34] }, // rpg, aventure, stratégie, simulation, récit
};
export const EDITION_KEYS = Object.keys(PACK_EDITIONS);

// Les chances de chaque emplacement du booster (en %), façon Pokémon : trois
// cartes « de base », une un cran au-dessus, et la dernière — celle qu'on
// retourne en dernier — garantie rare ou mieux.
const SLOT_ODDS = {
  base: { common: 72, uncommon: 23.5, rare: 3.8, epic: 0.6, legendary: 0.09, mythic: 0.01 },
  plus: { uncommon: 72, rare: 21, epic: 5.4, legendary: 1.3, mythic: 0.3 },
  hit: { rare: 73, epic: 20, legendary: 5.7, mythic: 1.3 },
  // Le booster doré : chaque carte est tirée comme un « hit » gonflé.
  gold: { epic: 60, legendary: 30, mythic: 10 },
};
const SLOTS = ["base", "base", "base", "plus", "hit"];
// Un booster sur 250 est doré — le client le sait AVANT de déchirer.
export const GOLDEN_CHANCE = 0.004;

// ----------------------------------------------------------------------
//  La composition du set (créée une fois, recalculée si SET_VERSION monte)
// ----------------------------------------------------------------------
// Les numéros et raretés suivent la popularité (votes IGDB). Ils sont FIGÉS
// entre deux versions : une carte tirée ne change pas de rareté parce qu'un
// autre jeu a gagné des votes. Un recalcul garde le cadrage et l'illustration
// déjà calculés (seuls `no` et `rarity` bougent) et ne touche jamais aux
// cartes des joueurs (CardOwn), qui sont rangées par id de jeu.
async function syncSet(set) {
  const now = Math.floor(Date.now() / 1000);
  const games = await GameFeatures.find({
    pool: true,
    type: { $in: CARD_TYPES },
    cover: { $ne: null },
    date: { $ne: null, $lte: now },
    ratingCount: { $gte: 1 },
  })
    .select("_id")
    .sort({ ratingCount: -1, hypes: -1, _id: 1 })
    .lean();
  if (games.length < 500) return 0; // catalogue pas encore synchronisé

  const rows = [];
  let i = 0;
  for (const tier of TIERS) {
    for (let k = 0; k < tier.count && i < games.length; k++, i++) {
      rows.push({ _id: games[i]._id, no: i + 1, rarity: tier.key });
    }
  }
  // Les numéros sont uniques dans un set : on écarte d'abord les anciens
  // (+1 000 000), sinon deux cartes qui échangent leur place se heurtent.
  await Card.updateMany({ set }, [{ $set: { no: { $add: ["$no", 1000000] } } }]);
  for (let j = 0; j < rows.length; j += 2000) {
    await Card.bulkWrite(
      rows.slice(j, j + 2000).map((r) => ({
        updateOne: {
          filter: { _id: r._id },
          update: { $set: { set, no: r.no, rarity: r.rarity } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  // Un jeu sorti du catalogue : sa carte disparaît si personne ne l'a ; sinon
  // elle reste (numérotée après les autres), on ne reprend rien à un joueur.
  const kept = new Set(rows.map((r) => r._id));
  const stale = (await Card.find({ set, no: { $gt: 1000000 } }).select("_id").lean())
    .map((c) => c._id)
    .filter((id) => !kept.has(id));
  if (stale.length) {
    const owned = new Set(await CardOwn.distinct("card", { card: { $in: stale } }));
    await Card.deleteMany({ _id: { $in: stale.filter((id) => !owned.has(id)) } });
  }
  await AppSetting.updateOne({ key: SET_VERSION_KEY }, { $set: { value: SET_VERSION } }, { upsert: true });
  console.log(`🃏 Cartes : set ${set} v${SET_VERSION} — ${rows.length} cartes`);
  return rows.length;
}

// ----------------------------------------------------------------------
//  Les illustrations (une fois pour tout le set, en tâche de fond)
// ----------------------------------------------------------------------
// La fenêtre d'une carte est en PAYSAGE ; la jaquette est en portrait. On va
// donc chercher chez IGDB un vrai visuel large, dans cet ordre :
//   key art sans logo (2) → artwork (1) → key art avec logo (3) →
//   artwork historique (15) → concept art (4) → à défaut, une capture.
// Jamais un logo, une icône, une jaquette alternative, ni une image à fond
// transparent (un personnage détouré flotterait dans le vide).
const ART_RANK = { 2: 0, 1: 1, 3: 2, 15: 3, 4: 4 };
const ART_CHUNK = 100;

function landscape(a) {
  const r = (a.width || 0) / (a.height || 1);
  return r >= 1.2 && r <= 2.4;
}

async function pickArtworks(ids) {
  const best = new Map(); // gameId → { rank, area, id }
  for (let i = 0; i < ids.length; i += ART_CHUNK) {
    const chunk = ids.slice(i, i + ART_CHUNK);
    for (let offset = 0; ; offset += 500) {
      const rows = await igdbQuery(
        "artworks",
        `fields game,image_id,width,height,artwork_type,alpha_channel; where game = (${chunk.join(",")}); limit 500; offset ${offset};`
      );
      for (const a of rows) {
        const rank = ART_RANK[a.artwork_type ?? 1];
        if (rank == null || !a.image_id || a.alpha_channel === true || !landscape(a)) continue;
        const area = (a.width || 0) * (a.height || 0);
        const prev = best.get(a.game);
        if (!prev || rank < prev.rank || (rank === prev.rank && area > prev.area))
          best.set(a.game, { rank, area, id: a.image_id });
      }
      if (rows.length < 500) break;
    }
  }
  return new Map([...best].map(([g, v]) => [g, v.id]));
}

async function pickScreenshots(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += ART_CHUNK) {
    const chunk = ids.slice(i, i + ART_CHUNK);
    const rows = await igdbQuery(
      "screenshots",
      `fields game,image_id,width,height; where game = (${chunk.join(",")}); limit 500;`
    );
    for (const s of rows) if (s.image_id && !out.has(s.game)) out.set(s.game, s.image_id);
  }
  return out;
}

let artRunning = null;
export function ensureCardArt() {
  if (artRunning || !process.env.TWITCH_CLIENT_ID) return artRunning;
  artRunning = (async () => {
    const todo = (await Card.find({ artAt: null }).select("_id").lean()).map((c) => c._id);
    if (!todo.length) return 0;
    const arts = await pickArtworks(todo);
    const shots = await pickScreenshots(todo.filter((id) => !arts.has(id)));
    const now = new Date();
    await Card.bulkWrite(
      todo.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { art: arts.get(id) || shots.get(id) || null, artAt: now } },
        },
      })),
      { ordered: false }
    );
    console.log(`🃏 Cartes : illustrations — ${arts.size} key arts, ${shots.size} captures, ${todo.length - arts.size - shots.size} sans`);
    loadedAt = 0; // le catalogue se recharge avec les illustrations
    return todo.length;
  })()
    .catch((err) => console.error("cards art:", err.message))
    .finally(() => {
      artRunning = null;
    });
  return artRunning;
}

// ----------------------------------------------------------------------
//  Le cadrage des jaquettes (une fois par carte, en tâche de fond)
// ----------------------------------------------------------------------
// Huit à la fois : ce sont des images du CDN d'IGDB (pas son API, qui a sa
// propre file), et l'analyse d'une vignette prend quelques millisecondes.
let focusRunning = null;
export function ensureCardFocus() {
  if (focusRunning) return focusRunning;
  focusRunning = (async () => {
    const todo = await Card.find({ focusAt: null }).select("_id rarity").lean();
    if (!todo.length) return 0;
    const covers = new Map(
      (await GameFeatures.find({ _id: { $in: todo.map((c) => c._id) } }).select("cover").lean()).map((g) => [g._id, g.cover])
    );
    let done = 0;
    let framed = 0;
    const queue = [...todo];
    const worker = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const cover = covers.get(c._id);
        let focus = null;
        // Les pleines illustrations (légendaire, mythique) montrent la jaquette
        // entière sur toute la carte : rien à cadrer.
        if (cover && !["legendary", "mythic"].includes(c.rarity)) {
          focus = await coverFocus(cover).catch(() => undefined);
          if (focus === undefined) continue; // réessayé au prochain passage
        }
        if (focus) framed++;
        done++;
        await Card.updateOne({ _id: c._id }, { $set: { focus, focusAt: new Date() } });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    console.log(`🃏 Cartes : cadrage — ${framed} jaquettes cadrées, ${done - framed} entières`);
    loadedAt = 0;
    return done;
  })()
    .catch((err) => console.error("cards focus:", err.message))
    .finally(() => {
      focusRunning = null;
    });
  return focusRunning;
}

// ----------------------------------------------------------------------
//  Le catalogue en mémoire : chaque carte prête à être envoyée
// ----------------------------------------------------------------------
let catalog = null; // { byId: Map, byRarity: {rarity: [id]}, size }
let loading = null;
let loadedAt = 0;
const TTL = 6 * 60 * 60 * 1000;

onRecoCatalogSynced(() => {
  loadedAt = 0; // la prochaine lecture recharge (jaquettes, notes à jour)
});

async function loadCatalog() {
  const version = (await AppSetting.findOne({ key: SET_VERSION_KEY }).lean())?.value || 0;
  if (version < SET_VERSION || (await Card.estimatedDocumentCount()) === 0) await syncSet(CURRENT_SET);
  const cards = await Card.find({}).lean();
  const ids = cards.map((c) => c._id);
  const games = await GameFeatures.find({ _id: { $in: ids } })
    .select("name slug cover date type parent genres themes keywords devs rating ratingCount platforms modes persp franchises collections")
    .lean();
  const gById = new Map(games.map((g) => [g._id, g]));
  const companyIds = [...new Set(games.map((g) => g.devs?.[0]).filter(Boolean))];
  const keywordIds = [...new Set(games.flatMap((g) => g.keywords || []))];
  const [terms, kwTerms] = await Promise.all([
    IgdbTerm.find({ kind: "company", id: { $in: companyIds } }).select("id name").lean(),
    // Les tags (mots-clés IGDB) : c'est d'eux que viennent les attaques.
    IgdbTerm.find({ kind: "keyword", id: { $in: keywordIds } }).select("id name").lean(),
  ]);
  const company = new Map(terms.map((t) => [t.id, t.name]));
  // Mot-clé → règles d'attaque touchées, calculé une fois par mot-clé.
  const kwRules = new Map();
  // … et les étiquettes des combats (#Zombies, #Pixel art), jamais affichées.
  const kwTags = new Map();
  for (const t of kwTerms) {
    const r = rulesForKeyword(t.name);
    if (r.length) kwRules.set(t.id, r);
    const tags = tagsForKeyword(t.name);
    if (tags.length) kwTags.set(t.id, tags);
  }

  const byId = new Map();
  // Ce que la carte cache (année, consoles, tags…) : pour les combats, jamais
  // envoyé avec la carte (cf. lib/cardFacts.js).
  const facts = new Map();
  // Les séries (franchises et collections IGDB) → leurs cartes : de quoi
  // remplir un classeur « Ace Attorney » d'un coup. Clés « f:<id> », « c:<id> ».
  const series = new Map();
  const inSeries = (key, id) => {
    const list = series.get(key);
    if (list) list.push(id);
    else series.set(key, [id]);
  };
  const byRarity = Object.fromEntries(RARITY_ORDER.map((r) => [r, []]));
  const editions = Object.fromEntries(
    EDITION_KEYS.map((k) => [k, { byRarity: Object.fromEntries(RARITY_ORDER.map((r) => [r, []])), size: 0 }])
  );
  for (const c of cards) {
    const g = gById.get(c._id);
    if (!g?.cover) continue; // jeu disparu du catalogue : la carte dort
    const card = {
      id: c._id,
      set: c.set,
      no: c.no,
      rarity: c.rarity,
      name: g.name,
      slug: g.slug || null,
      cover: g.cover,
      art: c.art || null,
      focus: c.focus || null,
      year: g.date ? new Date(g.date * 1000).getUTCFullYear() : null,
      rating: g.rating ?? null,
      votes: g.ratingCount || 0,
      genres: (g.genres || []).slice(0, 4),
      themes: (g.themes || []).slice(0, 3),
      studio: company.get(g.devs?.[0]) || null,
      moves: movesFromRules(
        c._id,
        new Set((g.keywords || []).flatMap((k) => kwRules.get(k) || [])),
        g.genres || []
      ),
      // Remake = EX, remaster = HD : la mention qui se colle au nom.
      variant: g.type === 8 ? "ex" : g.type === 9 ? "hd" : null,
    };
    byId.set(c._id, card);
    facts.set(c._id, buildFacts(g, kwTags));
    for (const f of g.franchises || []) inSeries(`f:${f}`, c._id);
    for (const s of g.collections || []) inSeries(`c:${s}`, c._id);
    byRarity[c.rarity]?.push(c._id);
    const gs = g.genres || [];
    let placed = false;
    for (const k of EDITION_KEYS) {
      if (!PACK_EDITIONS[k].genres.some((id) => gs.includes(id))) continue;
      editions[k].byRarity[c.rarity]?.push(c._id);
      editions[k].size++;
      placed = true;
    }
    if (!placed)
      for (const k of EDITION_KEYS) {
        editions[k].byRarity[c.rarity]?.push(c._id);
        editions[k].size++;
      }
  }
  return { byId, byRarity, editions, facts, series, size: byId.size };
}

export async function getCatalog() {
  if (catalog && Date.now() - loadedAt < TTL) return catalog;
  if (!loading) {
    loading = loadCatalog()
      .then((c) => {
        catalog = c;
        // Set vide (catalogue IGDB pas encore synchronisé) : on réessaiera à
        // la prochaine requête plutôt que de le garder six heures.
        loadedAt = c.size ? Date.now() : 0;
        // Des cartes encore sans illustration : on va les chercher, en fond.
        if (c.size) {
          ensureCardArt();
          ensureCardFocus();
        }
        return c;
      })
      .finally(() => {
        loading = null;
      });
  }
  // Un catalogue un peu vieux vaut mieux qu'une attente : on sert l'ancien
  // pendant que le nouveau se charge.
  return catalog || loading;
}

// ----------------------------------------------------------------------
//  Le tirage
// ----------------------------------------------------------------------
function rollRarity(odds, available) {
  const entries = Object.entries(odds).filter(([r]) => available[r]?.length);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = Math.random() * total;
  for (const [r, w] of entries) {
    x -= w;
    if (x <= 0) return r;
  }
  return entries[entries.length - 1][0];
}

/**
 * Tire un booster d'une édition : 5 ids de cartes distinctes, de la moins
 * rare à la plus rare, pris dans les seules familles de l'édition.
 */
// `forceGolden` : le dernier palier de la passe des combats donne un booster
// doré, pas une chance sur 250.
export function drawPack(cat, edition, forceGolden) {
  const golden = forceGolden ?? Math.random() < GOLDEN_CHANCE;
  const pools = cat.editions?.[edition]?.byRarity || cat.byRarity;
  const picked = new Set();
  const out = [];
  for (const slot of SLOTS) {
    const rarity = rollRarity(golden ? SLOT_ODDS.gold : SLOT_ODDS[slot], pools);
    const pool = pools[rarity];
    let id;
    for (let tries = 0; tries < 20; tries++) {
      id = pool[Math.floor(Math.random() * pool.length)];
      if (!picked.has(id)) break;
    }
    picked.add(id);
    out.push(id);
  }
  // La plus belle en dernier : c'est elle qu'on retourne pour finir.
  const rank = (id) => RARITY_ORDER.indexOf(cat.byId.get(id).rarity);
  out.sort((a, b) => rank(a) - rank(b));
  return { ids: out, golden };
}

// Chance d'avoir AU MOINS une carte de cette rareté dans un booster.
export function packChances() {
  const oddsOf = (slot, r) => {
    const o = SLOT_ODDS[slot];
    const tot = Object.values(o).reduce((a, b) => a + b, 0);
    return (o[r] || 0) / tot;
  };
  const out = {};
  for (const r of RARITY_ORDER) {
    const normalMiss = SLOTS.reduce((a, s) => a * (1 - oddsOf(s, r)), 1);
    const goldMiss = Math.pow(1 - oddsOf("gold", r), PACK_SIZE);
    out[r] = 1 - ((1 - GOLDEN_CHANCE) * normalMiss + GOLDEN_CHANCE * goldMiss);
  }
  return out;
}

/** Range les cartes tirées chez le joueur ; rend l'ensemble des ids NOUVEAUX. */
export async function storeCards(userId, ids) {
  const had = await CardOwn.find({ user: userId, card: { $in: ids } })
    .select("card count")
    .lean();
  const before = new Map(had.map((h) => [h.card, h.count]));
  const now = new Date();
  await CardOwn.bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { user: userId, card: id },
        update: {
          $inc: { count: 1 },
          $set: { lastAt: now },
          $setOnInsert: { firstAt: now, fresh: true },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return new Map(ids.map((id) => [id, (before.get(id) || 0) + 1]));
}
