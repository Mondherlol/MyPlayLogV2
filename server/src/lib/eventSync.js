import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import User from "../models/User.js";
import List from "../models/List.js";
import {
  MIN_GAMES,
  eventDescription,
  eventTitle,
  fetchEvents,
  fetchGames,
  isTrackedEvent,
  resolveEventCover,
  toListEvent,
  toListItems,
} from "./gameEvents.js";

// ======================================================================
//  Synchro des listes officielles d'événements
// ======================================================================
// Appelée par le script (`npm run sync:events`) ET par le panel admin
// (POST /api/admin/events/sync) : la logique vit ici pour que les deux
// chemins fassent exactement la même chose.

export const SYSTEM_USERNAME = "MyPlayLog";
const SYSTEM_EMAIL = process.env.SYSTEM_ACCOUNT_EMAIL || "system@myplaylog.cc";

// Le compte de service, créé au premier passage. Mot de passe aléatoire jamais
// affiché : ce compte n'est pas fait pour qu'on s'y connecte. Pour en prendre
// la main un jour, passer par « mot de passe oublié » avec son adresse.
export async function ensureSystemUser({ dry = false, log = () => {} } = {}) {
  let user = await User.findOne({ username: SYSTEM_USERNAME });
  if (user) {
    if (!user.isSystem && !dry) {
      user.isSystem = true;
      await user.save();
      log(`· compte « ${SYSTEM_USERNAME} » marqué comme compte système`);
    }
    return user;
  }
  if (dry) {
    log(`· compte système « ${SYSTEM_USERNAME} » serait créé`);
    return { _id: null };
  }
  user = await User.create({
    username: SYSTEM_USERNAME,
    email: SYSTEM_EMAIL,
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
    isSystem: true,
    bio: "Compte officiel du site. Je publie les listes des conférences et showcases du jeu vidéo.",
  });
  log(`✓ compte système « ${SYSTEM_USERNAME} » créé (${SYSTEM_EMAIL})`);
  return user;
}

// Rien à réécrire si le contenu est identique : évite de faire remonter les
// listes dans les fils triés par date de mise à jour à chaque synchro.
function isUnchanged(list, { title, items, event, cover }) {
  if (list.title !== title) return false;
  if ((list.cover || null) !== (cover || null)) return false;
  if ((list.items || []).length !== items.length) return false;
  const before = (list.items || []).map((i) => i.refId).join(",");
  if (before !== items.map((i) => i.refId).join(",")) return false;
  return (
    (list.event?.videoId || null) === (event.videoId || null) &&
    (list.event?.name || null) === (event.name || null)
  );
}

// Le 1er janvier de l'année en cours, borne par défaut.
export const defaultSince = () =>
  Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);

export async function syncEventLists({
  since = defaultSince(),
  all = false,
  dry = false,
  baseUrl = "http://localhost:4000",
  log = () => {},
} = {}) {
  const system = await ensureSystemUser({ dry, log });

  const events = await fetchEvents({ since });
  const kept = events.filter(
    (e) => (e.games || []).length >= MIN_GAMES && (all || isTrackedEvent(e.name))
  );
  log(`→ ${events.length} événements IGDB, ${kept.length} retenus`);

  const summary = { scanned: events.length, kept: kept.length, created: 0, updated: 0, skipped: 0, failed: 0 };

  for (const ev of kept) {
    const title = eventTitle(ev.name, ev.start_time);
    let games;
    try {
      games = await fetchGames(ev.games);
    } catch (err) {
      summary.failed += 1;
      log(`  ! ${title} — IGDB a refusé les jeux (${err.message})`);
      continue;
    }
    const items = toListItems(games);
    if (items.length < MIN_GAMES) {
      log(`  · ${title} — ignoré (${items.length} jeux exploitables)`);
      continue;
    }
    const event = toListEvent(ev);
    const cover = await resolveEventCover(ev, baseUrl);

    const existing = await List.findOne({ "event.igdbId": ev.id });
    if (existing) {
      if (isUnchanged(existing, { title, items, event, cover })) {
        summary.skipped += 1;
        continue;
      }
      if (!dry) {
        existing.title = title;
        existing.description = eventDescription();
        existing.cover = cover;
        existing.items = items;
        existing.event = event;
        await existing.save();
      }
      summary.updated += 1;
      log(`  ~ ${title} (${items.length} jeux)`);
      continue;
    }

    if (!dry) {
      await List.create({
        user: system._id,
        title,
        description: eventDescription(),
        cover,
        type: "classic",
        itemKind: "game",
        visibility: "public",
        items,
        event,
      });
    }
    summary.created += 1;
    log(`  + ${title} (${items.length} jeux)${event.videoId ? " ▶" : ""}`);
  }

  return summary;
}
