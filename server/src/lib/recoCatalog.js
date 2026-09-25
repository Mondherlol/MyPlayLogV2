// ======================================================================
//  Le catalogue local des recommandations — la synchro depuis IGDB
// ======================================================================
//
// Recopie dans GameFeatures les traits de tous les jeux « recommandables »
// d'IGDB (cf. models/GameFeatures.js pour le pourquoi). Les chiffres, relevés
// en septembre 2026 :
//   - 376 000 fiches chez IGDB, 320 000 une fois ôtés DLC, bundles, éditions ;
//   - ~45 000 qui ont au moins une note OU de la hype : c'est le pool.
// À 500 jeux par requête, un passage complet coûte ~90 requêtes de jeux, ~90
// pour les appids Steam et une vingtaine pour les noms (mots-clés, genres…) :
// environ deux minutes, une fois par jour.
//
// ⚠️ TOUT PASSE PAR LA FILE D'IGDB (lib/igdb.js), ET UNE REQUÊTE À LA FOIS.
// C'est ce qui rend la synchro inoffensive : elle attend la réponse avant de
// reposer une question, donc n'occupe jamais plus d'une place dans la file —
// les visiteurs gardent le reste du débit, même en plein passage.
//
// On refait un passage COMPLET à chaque fois plutôt qu'un incrémental sur
// `updated_at` : IGDB ne bouge pas `updated_at` quand seule la note moyenne
// change, et un jeu qui reçoit sa première note entrerait alors dans le pool…
// jamais. Deux minutes par jour, c'est le prix de ne pas avoir à y penser.

import AppSetting from "../models/AppSetting.js";
import GameFeatures from "../models/GameFeatures.js";
import IgdbTerm from "../models/IgdbTerm.js";
import UserGame from "../models/UserGame.js";
import { igdbQuery } from "./igdb.js";

const HOUR = 60 * 60 * 1000;
const PAGE = 500;
const STATE_KEY = "recoCatalog";
// On relance quand le dernier passage réussi a plus de 20 h : la vérification
// tourne toutes les 6 h, le catalogue a donc au pire un jour et quelques heures.
const STALE_AFTER = 20 * HOUR;
const CHECK_EVERY = 6 * HOUR;
const FIRST_CHECK_DELAY = 3 * 60 * 1000; // laisser le serveur démarrer au calme

// Jeu principal (0), extension autonome (4), remake (8), remaster (9), édition
// augmentée (10), portage (11). Pas de DLC, de bundle, de mod ni d'épisode.
const GAME_TYPES = "(0,4,8,9,10,11)";
const POOL_WHERE = `version_parent = null & game_type = ${GAME_TYPES} & (total_rating_count > 0 | hypes > 0)`;

const GAME_FIELDS = [
  "name",
  "slug",
  "cover.image_id",
  "first_release_date",
  "game_type",
  "parent_game",
  "genres",
  "themes",
  "keywords",
  "game_modes",
  "player_perspectives",
  "franchises.name",
  "collections.name",
  "involved_companies.company.name",
  "involved_companies.developer",
  "involved_companies.publisher",
  "platforms",
  "total_rating",
  "total_rating_count",
  "hypes",
  "alternative_names.name",
  "alternative_names.comment",
  "updated_at",
].join(",");

// ----------------------------------------------------------------------
//  Qui écoute la fin d'une synchro (le moteur, pour recharger son index)
// ----------------------------------------------------------------------
const listeners = new Set();
export function onRecoCatalogSynced(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emitSynced() {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error("recoCatalog listener:", err.message);
    }
  }
}

// ----------------------------------------------------------------------
//  Conversion d'une fiche IGDB
// ----------------------------------------------------------------------
const ids = (list) => (list || []).map((x) => (typeof x === "object" ? x.id : x)).filter(Number.isInteger);

function toFeatures(g, terms) {
  const devs = [];
  const pubs = [];
  for (const ic of g.involved_companies || []) {
    const c = ic.company;
    if (!c?.id) continue;
    if (c.name) terms.set(`company:${c.id}`, { kind: "company", id: c.id, name: c.name });
    if (ic.developer) devs.push(c.id);
    if (ic.publisher) pubs.push(c.id);
  }
  for (const f of g.franchises || [])
    if (f?.name) terms.set(`franchise:${f.id}`, { kind: "franchise", id: f.id, name: f.name });
  for (const c of g.collections || [])
    if (c?.name) terms.set(`collection:${c.id}`, { kind: "collection", id: c.id, name: c.name });

  const fr = (g.alternative_names || []).find((a) => /french/i.test(a.comment || ""));
  return {
    name: g.name,
    fr: fr?.name && fr.name !== g.name ? fr.name : null,
    slug: g.slug || null,
    cover: g.cover?.image_id || null,
    date: g.first_release_date || null,
    type: g.game_type ?? 0,
    parent: typeof g.parent_game === "number" ? g.parent_game : null,
    genres: ids(g.genres),
    themes: ids(g.themes),
    keywords: ids(g.keywords),
    modes: ids(g.game_modes),
    persp: ids(g.player_perspectives),
    franchises: ids(g.franchises),
    collections: ids(g.collections),
    devs: [...new Set(devs)],
    pubs: [...new Set(pubs)],
    platforms: ids(g.platforms),
    rating: typeof g.total_rating === "number" ? Math.round(g.total_rating * 10) / 10 : null,
    ratingCount: g.total_rating_count || 0,
    hypes: g.hypes || 0,
    igdbUpdatedAt: g.updated_at || null,
  };
}

async function saveTerms(terms) {
  if (!terms.size) return;
  await IgdbTerm.bulkWrite(
    [...terms.values()].map((t) => ({
      updateOne: {
        filter: { kind: t.kind, id: t.id },
        update: { $set: { name: t.name, abbr: t.abbr ?? null } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
}

// Les appids Steam d'une page de jeux. Un jeu peut en avoir plusieurs (démo,
// version « Definitive »…) : on garde le plus petit, en général l'original.
async function steamIds(gameIds) {
  const out = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const rows = await igdbQuery(
      "external_games",
      `fields game,uid; where external_game_source = 1 & game = (${gameIds.join(",")}); limit ${PAGE}; offset ${offset};`
    );
    for (const r of rows) {
      const appid = Number(r.uid);
      if (!r.game || !Number.isInteger(appid) || appid <= 0) continue;
      const prev = out.get(r.game);
      if (!prev || appid < prev) out.set(r.game, appid);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function saveGames(games, { pool, seenAt }) {
  if (!games.length) return;
  const terms = new Map();
  const steam = await steamIds(games.map((g) => g.id)).catch(() => new Map());
  await GameFeatures.bulkWrite(
    games.map((g) => {
      const set = { ...toFeatures(g, terms), steam: steam.get(g.id) ?? null };
      if (pool) {
        set.pool = true;
        set.seenAt = seenAt;
      }
      return {
        updateOne: {
          filter: { _id: g.id },
          // Un jeu de bibliothèque ajouté hors pool ne doit pas faire sortir du
          // pool une ligne que la synchro complète y a mise : `pool` n'est posé
          // à false qu'à la création.
          update: pool ? { $set: set } : { $set: set, $setOnInsert: { pool: false } },
          upsert: true,
        },
      };
    }),
    { ordered: false }
  );
  await saveTerms(terms);
}

// ----------------------------------------------------------------------
//  Les listes de noms (genres, mots-clés…)
// ----------------------------------------------------------------------
const TERM_ENDPOINTS = [
  { endpoint: "genres", kind: "genre" },
  { endpoint: "themes", kind: "theme" },
  { endpoint: "game_modes", kind: "mode" },
  { endpoint: "player_perspectives", kind: "persp" },
  { endpoint: "platforms", kind: "platform", abbr: true },
  { endpoint: "keywords", kind: "keyword" },
];

async function syncTerms(log) {
  let total = 0;
  for (const { endpoint, kind, abbr } of TERM_ENDPOINTS) {
    let lastId = 0;
    for (;;) {
      const rows = await igdbQuery(
        endpoint,
        `fields name${abbr ? ",abbreviation" : ""}; where id > ${lastId}; sort id asc; limit ${PAGE};`
      );
      const terms = new Map();
      for (const r of rows)
        if (r.name) terms.set(r.id, { kind, id: r.id, name: r.name, abbr: r.abbreviation || null });
      await saveTerms(terms);
      total += rows.length;
      if (rows.length < PAGE) break;
      lastId = rows[rows.length - 1].id;
    }
  }
  log(`noms : ${total} (genres, thèmes, mots-clés, plateformes…)`);
}

// ----------------------------------------------------------------------
//  Le pool
// ----------------------------------------------------------------------
async function syncPool(log) {
  const seenAt = new Date();
  let lastId = 0;
  let count = 0;
  for (;;) {
    const rows = await igdbQuery(
      "games",
      `fields ${GAME_FIELDS}; where id > ${lastId} & ${POOL_WHERE}; sort id asc; limit ${PAGE};`
    );
    await saveGames(rows, { pool: true, seenAt });
    count += rows.length;
    if (count % 5000 < PAGE) log(`pool : ${count} jeux…`);
    if (rows.length < PAGE) break;
    lastId = rows[rows.length - 1].id;
  }

  // Ce que ce passage complet n'a pas revu sort du pool (il reste en base comme
  // point de départ possible). Garde-fou : un passage anormalement court — IGDB
  // qui répond vide à mi-course — ne doit pas vider le catalogue.
  const before = await GameFeatures.countDocuments({ pool: true, seenAt: { $lt: seenAt } });
  if (count > 1000 && before < count * 0.2) {
    await GameFeatures.updateMany({ pool: true, seenAt: { $lt: seenAt } }, { $set: { pool: false } });
    if (before) log(`pool : ${before} jeu(x) sorti(s) du catalogue`);
  } else if (before) {
    log(`pool : ${before} jeu(x) non revu(s), laissés en place par prudence`);
  }
  log(`pool : ${count} jeux recommandables`);
  return count;
}

/**
 * S'assure que ces jeux ont leur ligne dans GameFeatures (hors pool s'ils n'y
 * sont pas). Sert aux jeux de bibliothèque qu'IGDB ne classe pas dans le pool —
 * un petit jeu jamais noté reste un excellent indice de goût.
 * Rend le nombre de fiches ajoutées.
 */
export async function ensureGameFeatures(gameIds) {
  const wanted = [...new Set(gameIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!wanted.length) return 0;
  const have = await GameFeatures.find({ _id: { $in: wanted } }).select("_id").lean();
  const known = new Set(have.map((d) => d._id));
  const missing = wanted.filter((id) => !known.has(id));
  let added = 0;
  for (let i = 0; i < missing.length; i += PAGE) {
    const chunk = missing.slice(i, i + PAGE);
    const rows = await igdbQuery(
      "games",
      `fields ${GAME_FIELDS}; where id = (${chunk.join(",")}); limit ${PAGE};`
    );
    await saveGames(rows, { pool: false });
    added += rows.length;
  }
  return added;
}

async function syncLibraryGames(log) {
  const ids = await UserGame.distinct("gameId", { gameId: { $gt: 0 } });
  const added = await ensureGameFeatures(ids);
  log(`bibliothèques : ${ids.length} jeux distincts, ${added} fiche(s) ajoutée(s) hors pool`);
}

// ----------------------------------------------------------------------
//  Le passage complet
// ----------------------------------------------------------------------
let running = null;

export async function getRecoCatalogState() {
  const [row, pool, total] = await Promise.all([
    AppSetting.findOne({ key: STATE_KEY }).lean(),
    GameFeatures.countDocuments({ pool: true }),
    GameFeatures.estimatedDocumentCount(),
  ]);
  return { ...(row?.value || {}), pool, total, running: Boolean(running) };
}

/**
 * Lance un passage complet (noms, pool, jeux de bibliothèque). Un seul à la
 * fois : un second appel pendant qu'il tourne reçoit la même promesse.
 */
export function runRecoCatalogSync({ log = console.log } = {}) {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    const lines = [];
    const say = (l) => {
      lines.push(l);
      log(`📚 reco : ${l}`);
    };
    let state;
    try {
      await syncTerms(say);
      const pool = await syncPool(say);
      await syncLibraryGames(say);
      state = { lastRun: new Date(), ok: true, pool, durationMs: Date.now() - started, error: null };
      say(`terminé en ${Math.round(state.durationMs / 1000)} s`);
    } catch (err) {
      state = { lastRun: new Date(), ok: false, durationMs: Date.now() - started, error: err.message };
      say(`échec : ${err.message}`);
    }
    // On garde la date du dernier SUCCÈS à part : un échec ne doit pas faire
    // croire au planificateur que le catalogue est frais.
    const prev = (await AppSetting.findOne({ key: STATE_KEY }).lean())?.value || {};
    const value = { ...prev, ...state, lastOk: state.ok ? state.lastRun : prev.lastOk || null };
    await AppSetting.updateOne({ key: STATE_KEY }, { $set: { value } }, { upsert: true });
    if (state.ok) emitSynced();
    return { ...value, log: lines };
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncIfStale() {
  try {
    const row = await AppSetting.findOne({ key: STATE_KEY }).lean();
    const lastOk = row?.value?.lastOk ? new Date(row.value.lastOk).getTime() : 0;
    if (Date.now() - lastOk < STALE_AFTER) return;
    await runRecoCatalogSync();
  } catch (err) {
    console.error("recoCatalog:", err.message);
  }
}

export function startRecoCatalogSync() {
  if (!process.env.TWITCH_CLIENT_ID) return;
  setTimeout(syncIfStale, FIRST_CHECK_DELAY);
  setInterval(syncIfStale, CHECK_EVERY);
  console.log("📚 Catalogue de recommandations : synchro quotidienne activée");
}
