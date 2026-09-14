// ======================================================================
//  Listes officielles « Tops » et palmarès des Game Awards
// ======================================================================
// Deux familles de listes publiées par le compte de service « MyPlayLog » :
//
//   · les TOPS — des classements de synthèse (Top 100 Switch, meilleurs
//     Metroidvania, tous les Zelda classés…), écrits à la main dans
//     data/officialLists/*.js ;
//   · les GAME AWARDS — une liste par cérémonie, avec son palmarès, rattachée
//     à l'événement IGDB (même document que la synchro des événements).
//
// ⚠️ LES JEUX SONT ÉCRITS PAR LEUR NOM, PAS PAR LEUR IDENTIFIANT. Un nom se
// relit et se corrige ; un identifiant IGDB recopié à la main se trompe en
// silence. La correspondance nom → identifiant est calculée UNE fois
// (`npm run resolve:official`, qui écrit data/officialLists/resolved.json) et
// relue ici : la publication depuis le panel admin n'a donc plus qu'à aller
// chercher les jaquettes, en quelques requêtes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import List from "../models/List.js";
import { igdbQuery } from "./igdb.js";
import { ensureSystemUser } from "./eventSync.js";
import {
  eventTitle,
  fetchGames,
  resolveEventCover,
  toListEvent,
  toListItems,
} from "./gameEvents.js";
import nintendo from "../data/officialLists/nintendo.js";
import sony from "../data/officialLists/sony.js";
import segaXboxPc from "../data/officialLists/sega-xbox-pc.js";
import genresA from "../data/officialLists/genres-a.js";
import genresB from "../data/officialLists/genres-b.js";
import series from "../data/officialLists/series.js";
import gameAwards from "../data/officialLists/gameAwards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

export const RESOLVED_FILE = path.join(__dirname, "../data/officialLists/resolved.json");
export const TOP_DEFINITIONS = [...nintendo, ...sony, ...segaXboxPc, ...genresA, ...genresB, ...series];
export const AWARD_DEFINITIONS = gameAwards;

// Les trois rayons de l'onglet « Tops ».
export const TOP_GROUPS = ["platform", "genre", "series"];

const GROUP_DESCRIPTIONS = {
  platform:
    "Classement de synthèse des jeux les plus acclamés de la console, établi d'après les notes de la presse et des joueurs (Metacritic, OpenCritic, IGN, Edge, JV.com, Gamekult…).",
  genre:
    "Classement de synthèse des références du genre, établi d'après les notes de la presse et des joueurs et les classements des sites spécialisés.",
  series:
    "Les épisodes de la saga classés du meilleur au moins bon, d'après les notes de la presse et des joueurs.",
};

// ----------------------------------------------------------------------
//  Lecture des définitions
// ----------------------------------------------------------------------

/** « Resident Evil 4 @2023 » → { name: "Resident Evil 4", year: 2023 }. */
export function parseEntry(line) {
  const raw = String(line || "").trim();
  const m = raw.match(/^(.*?)\s*@\s*(\d{4})$/);
  return m ? { name: m[1].trim(), year: Number(m[2]) } : { name: raw, year: null };
}

export const entriesOfTop = (def) =>
  String(def.games || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseEntry);

/** Les jeux cités par une cérémonie (gagnants et nommés), dans l'ordre d'affichage. */
export function entriesOfAwards(def) {
  const names = [def.goty.winner, ...(def.goty.nominees || []), ...(def.awards || []).map((a) => a[1])];
  return names.map(parseEntry);
}

// La clé porte le support : « Hades » dans le top Switch et « Hades » dans le
// top PS4 sont le même jeu, mais « Doom » sur NES n'est pas « Doom » sur PC.
export const entryKey = ({ name, year }, platforms = []) =>
  `${name}${year ? ` @${year}` : ""}${platforms.length ? ` #${platforms.join(",")}` : ""}`;

/** Toutes les entrées à résoudre, dédoublonnées par clé. */
export function allEntries() {
  const out = new Map();
  for (const def of TOP_DEFINITIONS) {
    const platforms = def.platforms || [];
    for (const e of entriesOfTop(def)) out.set(entryKey(e, platforms), { ...e, platforms });
  }
  for (const def of AWARD_DEFINITIONS) {
    for (const e of entriesOfAwards(def)) out.set(entryKey(e), { ...e, platforms: [] });
  }
  return out;
}

export function loadResolved() {
  try {
    return JSON.parse(fs.readFileSync(RESOLVED_FILE, "utf8"));
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------
//  Nom → fiche IGDB
// ----------------------------------------------------------------------

export function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CANDIDATE_FIELDS =
  "fields name, alternative_names.name, first_release_date, platforms, total_rating_count, version_parent, game_type, category;";

// Types IGDB qui ne sont pas « un jeu » au sens d'une liste : DLC, pack, mod,
// épisode, saison, mise à jour… (même numérotation pour `category` et `game_type`).
const MINOR_TYPES = new Set([1, 3, 5, 6, 7, 12, 13, 14]);

function scoreCandidate(c, entry) {
  const want = normName(entry.name);
  let score = 0;
  const exact = normName(c.name) === want;
  const alias = !exact && (c.alternative_names || []).some((a) => normName(a.name) === want);
  if (exact) score += 100;
  else if (alias) score += 70;

  const year = c.first_release_date ? new Date(c.first_release_date * 1000).getUTCFullYear() : null;
  if (entry.year) {
    if (year === entry.year) score += 80;
    else if (year && Math.abs(year - entry.year) === 1) score += 40;
    else score -= 40;
  }
  if (entry.platforms?.length && (c.platforms || []).some((p) => entry.platforms.includes(p))) score += 35;
  if (c.version_parent) score -= 60;
  const type = typeof c.game_type === "number" ? c.game_type : c.category;
  if (MINOR_TYPES.has(type)) score -= 25;
  score += Math.log10((c.total_rating_count || 0) + 1) * 12;
  return { score, exact: exact || alias, year };
}

function pickBest(candidates, entry) {
  let best = null;
  for (const c of candidates) {
    const s = scoreCandidate(c, entry);
    if (!best || s.score > best.score) best = { ...s, game: c };
  }
  return best;
}

const quote = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Résout une série d'entrées `{ key, name, year, platforms }` en fiches IGDB.
 * D'abord par nom exact, en lots (quelques requêtes pour des centaines de
 * jeux), puis par recherche plein texte pour les restes. Rend
 * `Map<key, { id, name, year, exact }>` — `exact: false` = à relire.
 */
export async function resolveEntries(entries, { log = () => {} } = {}) {
  const out = new Map();
  const byName = new Map(); // nom normalisé -> candidats
  const names = [...new Set(entries.map((e) => e.name))];

  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    const rows = await igdbQuery(
      "games",
      `${CANDIDATE_FIELDS} where name = (${chunk.map(quote).join(",")}); limit 500;`
    );
    for (const r of rows) {
      const k = normName(r.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(r);
    }
    log(`  · noms exacts : ${Math.min(i + 40, names.length)}/${names.length}`);
  }

  const searched = new Map(); // nom -> résultats de recherche
  let n = 0;
  for (const e of entries) {
    let best = pickBest(byName.get(normName(e.name)) || [], e);
    // Pas de nom exact, ou une année demandée que les homonymes ne tiennent
    // pas : on élargit à la recherche.
    if (!best || (e.year && best.year !== e.year)) {
      if (!searched.has(e.name)) {
        const q = e.name.replace(/"/g, "");
        const rows = await igdbQuery("games", `search ${quote(q)}; ${CANDIDATE_FIELDS} limit 25;`).catch(() => []);
        searched.set(e.name, rows);
        n += 1;
        if (n % 25 === 0) log(`  · recherches : ${n}`);
      }
      const alt = pickBest([...(byName.get(normName(e.name)) || []), ...searched.get(e.name)], e);
      if (alt && (!best || alt.score > best.score)) best = alt;
    }
    if (best) {
      out.set(e.key, { id: best.game.id, name: best.game.name, year: best.year, exact: best.exact });
    }
  }
  return out;
}

// ----------------------------------------------------------------------
//  Jaquettes
// ----------------------------------------------------------------------

async function fetchGameCards(ids) {
  const out = new Map();
  const list = [...new Set(ids)];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const rows = await igdbQuery(
      "games",
      `fields name, cover.image_id; where id = (${chunk.join(",")}); limit ${chunk.length};`
    );
    for (const g of rows) {
      out.set(g.id, {
        name: String(g.name || "").slice(0, 200),
        image: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
      });
    }
  }
  return out;
}

const toItem = (id, card) => ({
  kind: "game",
  refId: String(id),
  gameId: id,
  gameName: null,
  name: card.name,
  image: card.image,
  note: "",
  media: [],
  rating: null,
  tier: null,
});

// Les entrées restées sans identifiant (ajoutées après le dernier
// `resolve:official`) sont cherchées en direct, dans une limite raisonnable
// pour que la requête du panel admin ne tienne pas la ligne des minutes.
const LIVE_RESOLVE_CAP = 60;

async function idsFor(pairs, resolved, log) {
  const missing = pairs.filter(({ key }) => !resolved[key]);
  if (missing.length) {
    const batch = missing.slice(0, LIVE_RESOLVE_CAP);
    log(`→ ${missing.length} jeu(x) sans identifiant enregistré — recherche IGDB en direct (${batch.length})`);
    const found = await resolveEntries(batch);
    for (const [key, hit] of found) resolved[key] = hit;
    for (const { key } of missing) if (!resolved[key]) log(`  ! introuvable : ${key}`);
  }
}

const sameStrings = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);

// ----------------------------------------------------------------------
//  Publication des tops
// ----------------------------------------------------------------------

export async function publishOfficialTops({ dryRun = false, log = () => {} } = {}) {
  const system = await ensureSystemUser({ dry: dryRun, log });
  const resolved = loadResolved();

  const plans = TOP_DEFINITIONS.map((def, order) => {
    const platforms = def.platforms || [];
    return {
      def,
      order,
      pairs: entriesOfTop(def).map((e) => ({ key: entryKey(e, platforms), ...e, platforms })),
    };
  });
  await idsFor(plans.flatMap((p) => p.pairs), resolved, log);

  const cards = await fetchGameCards(
    plans.flatMap((p) => p.pairs.map(({ key }) => resolved[key]?.id).filter(Boolean))
  );

  const summary = { created: 0, updated: 0, skipped: 0, games: 0 };
  for (const { def, order, pairs } of plans) {
    const seen = new Set();
    const items = [];
    for (const { key } of pairs) {
      const id = resolved[key]?.id;
      if (!id || seen.has(id) || !cards.has(id)) continue;
      seen.add(id);
      items.push(toItem(id, cards.get(id)));
      if (items.length >= def.size) break;
    }
    if (!items.length) {
      log(`  ! ${def.key} — aucun jeu exploitable, ignoré`);
      continue;
    }
    summary.games += items.length;

    const doc = {
      title: def.title.replace("{n}", items.length).slice(0, 120),
      description: (def.description || GROUP_DESCRIPTIONS[def.group] || "").slice(0, 2000),
      tags: def.tags || [],
      official: { key: def.key, kind: "top", group: def.group, order },
    };

    const existing = await List.findOne({ "official.key": def.key });
    if (existing) {
      const unchanged =
        existing.title === doc.title &&
        existing.description === doc.description &&
        existing.type === "ranked" &&
        sameStrings(existing.tags, doc.tags) &&
        existing.official?.order === order &&
        existing.official?.group === def.group &&
        sameStrings(existing.items.map((i) => i.refId), items.map((i) => i.refId));
      if (unchanged) {
        summary.skipped += 1;
        continue;
      }
      if (!dryRun) {
        Object.assign(existing, doc, { type: "ranked", items });
        await existing.save();
      }
      summary.updated += 1;
      log(`  ~ ${doc.title}`);
      continue;
    }

    if (!dryRun) {
      await List.create({
        user: system._id,
        ...doc,
        type: "ranked",
        itemKind: "game",
        visibility: "public",
        items,
      });
    }
    summary.created += 1;
    log(`  + ${doc.title}`);
  }

  if (!dryRun) persistResolved(resolved);
  return summary;
}

// Les résolutions faites en direct sont gardées pour la fois suivante (le
// fichier vit dans l'image Docker : il repart de la version du dépôt au
// prochain déploiement, ce qui est voulu — le dépôt reste la référence).
function persistResolved(resolved) {
  try {
    fs.writeFileSync(RESOLVED_FILE, `${JSON.stringify(sortKeys(resolved), null, 1)}\n`);
  } catch {
    /* système de fichiers en lecture seule : sans conséquence */
  }
}

export const sortKeys = (obj) =>
  Object.fromEntries(Object.keys(obj).sort((a, b) => a.localeCompare(b)).map((k) => [k, obj[k]]));

// ----------------------------------------------------------------------
//  Publication des Game Awards
// ----------------------------------------------------------------------

export async function publishGameAwards({ dryRun = false, baseUrl = "http://localhost:4000", log = () => {} } = {}) {
  const system = await ensureSystemUser({ dry: dryRun, log });
  const resolved = loadResolved();

  const pairs = AWARD_DEFINITIONS.flatMap((def) =>
    entriesOfAwards(def).map((e) => ({ key: entryKey(e), ...e, platforms: [] }))
  );
  await idsFor(pairs, resolved, log);
  const idOf = (name) => resolved[entryKey(parseEntry(name))]?.id || null;

  const events = await igdbQuery(
    "events",
    `fields name, slug, start_time, live_stream_url, event_logo.image_id, games;
     where id = (${AWARD_DEFINITIONS.map((d) => d.igdbEventId).join(",")}); limit 50;`
  );
  const eventById = new Map(events.map((e) => [e.id, e]));
  const cards = await fetchGameCards(pairs.map(({ key }) => resolved[key]?.id).filter(Boolean));

  const summary = { created: 0, updated: 0, skipped: 0, games: 0 };
  for (const def of AWARD_DEFINITIONS) {
    const ev = eventById.get(def.igdbEventId);
    if (!ev) {
      log(`  ! ${def.year} — événement IGDB ${def.igdbEventId} introuvable`);
      continue;
    }

    // Le palmarès : le Jeu de l'année en tête, puis les autres catégories.
    const gotyWinner = idOf(def.goty.winner);
    const awards = [
      {
        category: "Jeu de l'année",
        main: true,
        winner: gotyWinner ? String(gotyWinner) : null,
        person: null,
        nominees: (def.goty.nominees || []).map(idOf).filter(Boolean).map(String),
      },
      ...(def.awards || []).map(([category, game, person]) => ({
        category,
        main: false,
        winner: idOf(game) ? String(idOf(game)) : null,
        person: person || null,
        nominees: [],
      })),
    ].filter((a) => a.winner);

    // Les jeux du palmarès d'abord, puis ceux montrés pendant la cérémonie.
    const seen = new Set();
    const items = [];
    const push = (item) => {
      if (!item || seen.has(item.refId)) return;
      seen.add(item.refId);
      items.push(item);
    };
    for (const a of awards) {
      for (const ref of [a.winner, ...a.nominees]) {
        const id = Number(ref);
        if (cards.has(id)) push(toItem(id, cards.get(id)));
      }
    }
    try {
      toListItems(await fetchGames(ev.games || [])).forEach(push);
    } catch (err) {
      log(`  ! ${def.year} — jeux du show indisponibles (${err.message})`);
    }
    summary.games += items.length;

    const doc = {
      title: eventTitle(def.name || ev.name, ev.start_time),
      tags: def.vga ? ["Spike VGA", "Cérémonie"] : ["The Game Awards", "Cérémonie"],
      official: { key: `awards-${def.year}`, kind: "awards", group: "awards", order: def.year },
      awards,
      event: toListEvent(ev),
    };

    const existing = await List.findOne({ "event.igdbId": ev.id });
    if (existing) {
      const unchanged =
        existing.title === doc.title &&
        sameStrings(existing.tags, doc.tags) &&
        existing.official?.key === doc.official.key &&
        JSON.stringify((existing.awards || []).map((a) => [a.category, a.winner, a.person, [...a.nominees]])) ===
          JSON.stringify(awards.map((a) => [a.category, a.winner, a.person, a.nominees])) &&
        sameStrings(existing.items.map((i) => i.refId), items.map((i) => i.refId));
      if (unchanged) {
        summary.skipped += 1;
        continue;
      }
      if (!dryRun) {
        Object.assign(existing, doc, { items });
        if (!existing.cover) existing.cover = await resolveEventCover(ev, baseUrl);
        await existing.save();
      }
      summary.updated += 1;
      log(`  ~ ${doc.title} (${awards.length} prix, ${items.length} jeux)`);
      continue;
    }

    if (!dryRun) {
      await List.create({
        user: system._id,
        ...doc,
        description: "",
        cover: await resolveEventCover(ev, baseUrl),
        type: "classic",
        itemKind: "game",
        visibility: "public",
        items,
      });
    }
    summary.created += 1;
    log(`  + ${doc.title} (${awards.length} prix, ${items.length} jeux)`);
  }

  if (!dryRun) persistResolved(resolved);
  return summary;
}
