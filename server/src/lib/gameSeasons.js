// ======================================================================
//  Les SAISONS des jeux qu'on joue
// ======================================================================
// ⚠️ CE N'EST PAS UN RENDEZ-VOUS DU JEU VIDÉO, ET ÇA NE SE MONTRE PAS AU MÊME
// ENDROIT. Un Nintendo Direct s'adresse à tout le monde : on le met sur
// l'accueil de tous. Une saison de Marvel Rivals ne parle qu'à ceux qui y
// jouent — pour les autres c'est du bruit, et c'est exactement pour ça que la
// route qui les sert croise la BIBLIOTHÈQUE (cf. GET /api/events/seasons).
//
// Le manque était pourtant simple : un jeu-service change de saison toutes les
// six semaines, l'app en connaissait la fiche, les heures de jeu, les succès —
// et pas la seule date qui fasse rouvrir le jeu.
//
// ---------------------------------------------------------------- le stockage
// Aucun modèle en plus : une saison EST un `GameEvent` (`kind: "season"`,
// `gameId` renseigné). Ce n'est pas une économie de paresse — le modèle porte
// déjà exactement ce qu'il faut : une date, une précision, une image, un
// « ça m'intéresse »… et donc, gratuitement, le RAPPEL PUSH un quart d'heure
// avant (cf. lib/eventCalendar, `sendEventReminders`). Cocher une saison et
// être prévenu quand elle tombe marche du premier coup, sans une ligne.
//
// ------------------------------------------------------------- les sources
// Il n'existe aucune source universelle : personne ne publie « les saisons à
// venir de tous les jeux-services ». On fait donc du cas par cas, un
// fournisseur par jeu, et le registre ci-dessous est fait pour qu'en ajouter un
// tienne en une entrée. Ce qu'un fournisseur ne sait pas, l'admin peut toujours
// le saisir à la main (`source: "manual"`, que la synchro ne touche jamais).

import GameEvent from "../models/GameEvent.js";
import { resolveIgdbGame } from "./igdbLookup.js";

// Au-delà, ce n'est plus une saison qui arrive, c'est une feuille de route.
const HORIZON_MS = 200 * 86400000;

// Le fournisseur donne des heures à la seconde ou rien du tout ; on ne prétend
// pas savoir mieux (cf. `precision` dans le modèle).

// ----------------------------------------------------------------------
//  Valorant — les actes, par l'API de contenu publique
// ----------------------------------------------------------------------
// valorant-api.com sert le catalogue du jeu tel que Riot le publie, sans clé et
// sans compte : les actes y sont datés à la seconde, début ET fin. C'est la
// seule source de saison qu'on ait qui ne demande ni clé ni identifiants — et
// donc la seule qu'on puisse allumer sans rien configurer.
//
// ⚠️ À NE PAS CONFONDRE AVEC LA BOUTIQUE (cf. lib/valorantStore) : le catalogue
// est public, le magasin d'un joueur ne l'est pas.
const VALORANT_SEASONS = "https://valorant-api.com/v1/seasons?language=fr-FR";

async function fromValorant() {
  const res = await fetch(VALORANT_SEASONS, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`valorant-api ${res.status}`);
  const rows = (await res.json())?.data || [];

  // Un acte porte l'uuid de son épisode, pas son nom. Sans cette table, la
  // carte dirait « ACTE II » sans dire de quel épisode — ce qui ne situe rien.
  const episodes = new Map(
    rows
      .filter((r) => !r.parentUuid && r.displayName)
      .map((r) => [r.uuid, String(r.displayName).trim()])
  );

  return rows
    .filter((r) => String(r.type || "").includes("Act") && r.startTime)
    .map((r) => {
      const startsAt = new Date(r.startTime);
      return {
        key: `season:valorant:${r.uuid}`,
        label: String(r.displayName || "").trim(),
        episode: episodes.get(r.parentUuid) || "",
        startsAt,
        endsAt: r.endTime ? new Date(r.endTime) : null,
        // ⚠️ MINUIT PILE N'EST PAS UNE HEURE, C'EST UNE ABSENCE D'HEURE. La
        // source date tous ses actes à 00:00:00Z — Riot déploie en réalité
        // dans la journée, au patch. Annoncer un décompte à la seconde vers
        // minuit UTC serait faux avec l'aplomb d'une horloge, et ferait partir
        // le rappel push au milieu de la nuit. On dit « J-3 » (cf. la même
        // règle dans le modèle GameEvent, champ `precision`).
        precision:
          startsAt.getUTCHours() || startsAt.getUTCMinutes() || startsAt.getUTCSeconds()
            ? "time"
            : "day",
      };
    });
}

// ----------------------------------------------------------------------
//  Le registre
// ----------------------------------------------------------------------
// `igdbName` sert au rattachement (donc au filtrage par bibliothèque) ET à
// l'image de la carte. `fetch` rend des saisons brutes ; la mise en forme est
// commune, plus bas, pour que deux fournisseurs ne racontent pas la même chose
// de deux façons.
export const PROVIDERS = [{ slug: "valorant", igdbName: "Valorant", fetch: fromValorant }];

/**
 * Une saison, telle qu'elle sera stockée.
 *
 * Le nom porte le jeu : la notification de rappel n'affiche que lui, et
 * « ACTE II » tout seul, sur un écran de verrouillage, ne dit pas à quoi.
 */
function toEvent(raw, game, slug) {
  return {
    key: raw.key,
    source: "seasons",
    kind: "season",
    gameId: game?.id || null,
    name: `${game?.name || slug} — ${raw.label}`.slice(0, 160),
    subtitle: raw.episode.slice(0, 240),
    startsAt: raw.startsAt,
    endsAt: raw.endsAt,
    precision: raw.precision || "day",
    image: game?.cover || null,
    seenAt: new Date(),
  };
}

/**
 * Un passage de synchro des saisons.
 *
 * Rend `{ kept, created, updated, pruned }`.
 */
export async function syncGameSeasons({ log = () => {} } = {}) {
  const runAt = new Date();
  const now = Date.now();
  const summary = { kept: 0, created: 0, updated: 0, pruned: 0 };

  for (const provider of PROVIDERS) {
    let raws;
    try {
      raws = await provider.fetch();
    } catch (err) {
      // ⚠️ ON SORT SANS RIEN TOUCHER. Un fournisseur en panne n'est pas une
      // saison annulée : élaguer ici effacerait les saisons de ce jeu à la
      // première coupure réseau, et le rail disparaîtrait de l'accueil.
      log(`  ! ${provider.slug} — source indisponible (${err.message})`);
      continue;
    }

    const game = await resolveIgdbGame(provider.igdbName);
    if (!game) log(`  ! ${provider.slug} — fiche IGDB introuvable, saisons sans jeu rattaché`);

    // Seulement ce qui est DEVANT. Les actes passés sont l'histoire du jeu, pas
    // une nouvelle : la source les renvoie tous depuis 2020.
    const upcoming = raws.filter((r) => {
      const t = new Date(r.startsAt).getTime();
      return t > now && t < now + HORIZON_MS;
    });

    for (const raw of upcoming) {
      const doc = toEvent(raw, game, provider.slug);
      const before = await GameEvent.findOne({ key: doc.key }).select("_id startsAt").lean();
      await GameEvent.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
      if (!before) summary.created += 1;
      else if (new Date(before.startsAt).getTime() !== doc.startsAt.getTime()) summary.updated += 1;
      summary.kept += 1;
    }

    // Élagage, et SEULEMENT sur les saisons de CE fournisseur : une saison
    // encore à venir que la source ne renvoie plus a été repoussée ou annulée.
    const pruned = await GameEvent.deleteMany({
      source: "seasons",
      key: new RegExp(`^season:${provider.slug}:`),
      startsAt: { $gt: new Date() },
      seenAt: { $lt: runAt },
    });
    summary.pruned += pruned.deletedCount || 0;

    log(`  · ${provider.slug} : ${upcoming.length} saison(s) à venir`);
  }

  return summary;
}

// ----------------------------------------------------------------------
//  La boucle
// ----------------------------------------------------------------------
// Une date de saison bouge rarement, et quand elle bouge c'est des semaines à
// l'avance : six heures suffisent largement. Même forme que la synchro du
// calendrier (cf. lib/eventCalendar) — un intervalle dans le processus, et un
// premier passage différé pour laisser le serveur démarrer.
const SYNC_INTERVAL = 6 * 3600 * 1000;
const FIRST_RUN_DELAY = 60 * 1000;

async function runQuietly() {
  try {
    const s = await syncGameSeasons({ log: (l) => console.log(l) });
    console.log(
      `🎯 Saisons : ${s.kept} à venir (${s.created} nouvelles, ${s.updated} déplacées, ${s.pruned} retirées)`
    );
  } catch (err) {
    console.error("game seasons sync error:", err.message);
  }
}

export function startGameSeasonSync() {
  setTimeout(runQuietly, FIRST_RUN_DELAY);
  setInterval(runQuietly, SYNC_INTERVAL);
  console.log("🎯 Synchro des saisons des jeux-services activée");
}
