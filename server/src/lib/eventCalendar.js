// ======================================================================
//  Le calendrier des rendez-vous À VENIR
// ======================================================================
// ⚠️ IGDB NE SERT PRESQUE À RIEN ICI, ET C'EST TOUT LE PROBLÈME.
//
// Le premier réflexe était d'appeler l'endpoint `events` d'IGDB, déjà branché
// pour les listes de conférences (cf. lib/gameEvents). Vérification faite : il
// ne connaît qu'UN SEUL événement futur à un instant donné. IGDB renseigne ses
// événements APRÈS coup, une fois qu'on sait quels jeux y ont été montrés —
// c'est une archive, pas un agenda. Un Nintendo Direct annoncé pour la semaine
// prochaine n'y est pas.
//
// D'où deux fournisseurs, dans cet ordre de confiance :
//
//   1. IGDB — rare, mais quand il a l'événement il a TOUT : l'heure à la
//      seconde, le logo, le lien du live, les jeux.
//   2. gameconfguide.com — LA source de l'agenda. Le site n'a pas d'API, mais
//      sa page calendrier embarque des agendas Google publics, donc des flux
//      iCal : un format normalisé, avec l'heure à la seconde, la durée, le lieu
//      et le lien pour regarder. C'est lui qui porte la fonctionnalité.
//
//   3. Et le filet : une entrée `manual`, posée depuis l'admin, que la synchro
//      ne touche jamais. Aucune source automatique ne connaît tout ; un
//      calendrier qui ne peut pas être corrigé à la main est un calendrier
//      qu'on finit par ne plus regarder.
//
// La synchro est IDEMPOTENTE : elle tourne tous les jours et réécrit les mêmes
// clés. Ce qu'elle ne revoit plus et qui est encore à venir a été annulé ou
// corrigé à la source — on le retire (cf. `pruneStale`).

import GameEvent from "../models/GameEvent.js";
import { cleanEventName, fetchEvents, isTrackedEvent } from "./gameEvents.js";
import { firstHref, parseIcs, parseIcsDate, prop, stripHtml, unescapeIcs } from "./ics.js";

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";
const DAY = 86400000;

// Jusqu'où on regarde devant. Au-delà d'un an et demi, on n'a plus des
// rendez-vous mais des marronniers (« le TGA se tient en décembre »), et un
// compte à rebours de 400 jours ne donne envie de rien.
export const HORIZON_DAYS = 550;

// ⚠️ UN ÉVÉNEMENT NE DISPARAÎT PAS À LA SECONDE OÙ IL COMMENCE. C'est même le
// moment où l'on vient le plus le voir : « ça a dit quoi ? ». Il reste donc
// affiché un temps après son heure — mais pas le même selon ce qu'on sait de
// lui :
//
//   • heure connue → une demi-journée après, largement de quoi couvrir la
//     diffusion et la soirée qui suit ;
//   • jour seulement → l'entrée est enregistrée à MINUIT UTC, qui n'est pas le
//     début de l'événement mais le début de sa journée. Douze heures le
//     faisaient disparaître à midi, en plein pendant le jour J. Vingt-huit
//     heures couvrent la journée entière sous tous les fuseaux d'Europe et
//     d'Amérique.
export const GRACE_TIME_MS = 12 * 3600 * 1000;
export const GRACE_DAY_MS = 28 * 3600 * 1000;

/** La borne basse d'une requête « ce qui arrive », précision par précision. */
export function upcomingFilter(now = Date.now()) {
  return {
    $or: [
      { precision: "time", startsAt: { $gte: new Date(now - GRACE_TIME_MS) } },
      { precision: { $ne: "time" }, startsAt: { $gte: new Date(now - GRACE_DAY_MS) } },
    ],
  };
}

// La plus large des deux : ce que la synchro doit encore considérer comme
// « à venir » et ne surtout pas effacer (cf. pruneStale).
export const GRACE_MS = GRACE_DAY_MS;

// ----------------------------------------------------------------------
//  Les marques
// ----------------------------------------------------------------------
// Le client a déjà les logos en SVG (cf. mobile lib/platformIcons) : on ne lui
// envoie que la clé, il choisit le dessin et la couleur.
const BRAND_RULES = [
  [/nintendo|zelda|mario|pok[ée]mon|splatoon|fire emblem|indie world/i, "nintendo"],
  [/playstation|state of play|\bps5\b|\bpsvr\b|sony/i, "playstation"],
  [/xbox|bethesda|activision|microsoft/i, "xbox"],
  [/\bsega\b|sonic|atlus/i, "sega"],
  [/steam|valve/i, "steam"],
];

export function brandOf(name) {
  for (const [re, key] of BRAND_RULES) if (re.test(String(name || ""))) return key;
  return null;
}

// Un slug court et stable, pour composer les clés.
const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

// Deux fournisseurs peuvent décrire le MÊME rendez-vous. On les rapproche sur
// « le même nom, le même jour » — c'est ce qui distingue deux Directs à un jour
// d'écart, et ce qui réunit la version IGDB et la version Wikipédia du même.
const dedupeKey = (name, startsAt) =>
  `${slugify(cleanEventName(name))}@${new Date(startsAt).toISOString().slice(0, 10)}`;

// ----------------------------------------------------------------------
//  Fournisseur 1 — IGDB
// ----------------------------------------------------------------------
export async function fromIgdb({ log = () => {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  let rows = [];
  try {
    rows = await fetchEvents({ since: now, until: now + HORIZON_DAYS * 86400 });
  } catch (err) {
    log(`  ! IGDB indisponible (${err.message})`);
    return [];
  }

  const kept = rows.filter((e) => e.start_time && isTrackedEvent(e.name));
  log(`· IGDB : ${rows.length} événements à venir, ${kept.length} retenus`);

  return kept.map((e) => ({
    key: `igdb:${e.id}`,
    source: "igdb",
    name: cleanEventName(e.name),
    subtitle: "",
    startsAt: new Date(e.start_time * 1000),
    endsAt: e.end_time ? new Date(e.end_time * 1000) : null,
    // IGDB horodate à la seconde : c'est le seul fournisseur qui autorise un
    // vrai décompte heures/minutes/secondes.
    precision: "time",
    brand: brandOf(e.name),
    logo: e.event_logo?.image_id
      ? `${IMG_BASE}/t_logo_med/${e.event_logo.image_id}.png`
      : null,
    liveUrl: e.live_stream_url || null,
    sourceUrl: e.slug ? `https://www.igdb.com/events/${e.slug}` : null,
    gameIds: (e.games || []).slice(0, 60),
  }));
}
// ----------------------------------------------------------------------
//  Fournisseur 2 — Game Conference Guide (le vrai agenda)
// ----------------------------------------------------------------------
// ⚠️ CE FOURNISSEUR A REMPLACÉ UN SCRAPER WIKIPÉDIA, ET C'EST UN BON DÉBARRAS.
//
// La première version lisait les tableaux des pages « Nintendo Direct »,
// « State of Play »… en HTML. Ça marchait, mais : un parseur par forme de
// tableau, aucune heure (Wikipédia ne donne que le jour), aucun lien pour
// regarder, et une page de plus à surveiller à chaque nouvelle marque.
//
// gameconfguide.com tient le même agenda — en mieux. Le site n'a pas d'API,
// mais sa page calendrier embarque TROIS AGENDAS GOOGLE PUBLICS, et un agenda
// Google public expose un flux iCal. On ne scrape donc rien du tout : on lit un
// format normalisé (RFC 5545) qui donne l'heure à la seconde, la durée, le lieu
// et le lien pour regarder.
//
// Trois agendas, dont on n'en garde que deux :
//   • « Showcases Calendar » — les Directs, State of Play, Spotlights. Heure
//     exacte, durée, lien YouTube. C'est le cœur de la fonctionnalité.
//   • « Game Conference Guide » — les salons (gamescom, TGS, BlizzCon, le
//     Game Awards). Dates à la journée, avec un lieu.
//   • « Events + Deadlines » — ÉCARTÉ. Ce sont les dates limites de dépôt de
//     candidature pour les développeurs (soumettre un jeu à un festival, une
//     compétition). Rien à y faire dans une application de joueur.
const GCG_FEEDS = [
  {
    kind: "showcase",
    id: "c_6796064a82632176ae9f0dfbfc261f0987279483d8a98be357703c30a9d48785@group.calendar.google.com",
  },
  {
    kind: "conference",
    id: "c_6fptt3lh5ju30nkvf0oa402dhk@group.calendar.google.com",
  },
];

export const GCG_SITE = "https://gameconfguide.com/calendar/";

// ⚠️ TOUS LES SALONS NE SONT PAS POUR LES JOUEURS. L'agenda des conférences en
// compte cent soixante à venir, et l'écrasante majorité sont professionnelles :
// sommets d'investisseurs, journées de recrutement, colloques universitaires.
// Noyer deux Nintendo Direct sous « Live Service Gaming Summit — Europe », ce
// serait rendre la section inutilisable.
//
// Ceux-ci, en revanche, comptent pour un joueur : on les remonte au même rang
// que les showcases (l'accueil ne montre que ça, cf. routes/events).
const MAJOR_CONFERENCES =
  /\b(gamescom|tokyo game show|blizzcon|the game awards|pax\b|e3\b|evo\b|twitchcon|comic-?con|summer game fest|dreamhack)\b/i;

// Les salons satellites destinés aux professionnels portent le nom du grand
// salon : « gamescom dev », « gamescom congress », « gamescom dev leadership
// summit ». Ils passeraient le filtre ci-dessus par la seule présence du mot.
const PRO_SUFFIX = /\b(dev|congress|summit|b2b|business|leadership|asia|latam|lan)\b/i;

function isMajorConference(name) {
  return MAJOR_CONFERENCES.test(name) && !PRO_SUFFIX.test(name);
}

// Les descriptions de l'agenda sont du HTML avec des étiquettes régulières :
//
//   Watch The Legend of Zelda 40th Anniversary Direct…
//   TYPE: Showcase
//   DURATION: 30 min
//   WHERE TO WATCH: <a href="https://www.youtube.com/watch?v=…">Watch</a>
//   Brought to you by: GAME CONFERENCE GUIDE
//
// On en tire le résumé (tout ce qui précède les étiquettes), la durée, et
// surtout le LIEN — c'est lui qui transforme « il y a un Direct jeudi » en
// « voilà où le regarder ».
export function parseGcgDescription(rawIcs) {
  // ⚠️ DEUX COUCHES D'ÉCHAPPEMENT, DANS CET ORDRE. La valeur est d'abord
  // échappée par iCalendar (une virgule s'y écrit précédée d'une barre
  // oblique inverse, un saut de ligne aussi), et ce qu'on trouve dessous est du
  // HTML. Sauter la première couche laissait « …Anniversary Direct\, containing
  // a variety… » s'afficher tel quel dans l'application.
  const raw = unescapeIcs(rawIcs);
  const text = stripHtml(raw);

  const durationMin = Number(text.match(/DURATION:\s*(\d+)\s*min/i)?.[1]) || null;

  // Le lien est cherché dans le HTML D'ORIGINE : `stripHtml` a mangé les
  // balises, et donc les href.
  const watchBlock = String(raw || "").match(
    /(?:WHERE TO WATCH|WEBSITE|SUBMISSION)\s*:\s*(.*?)(?:<br|\\n|\n|$)/is
  );
  const watchUrl = firstHref(watchBlock?.[1] || "") || firstHref(raw);

  // Le résumé s'arrête à la première étiquette en capitales : au-delà, ce sont
  // des métadonnées, pas de la prose.
  const summary = text
    .split(/\n?(?:EVENT DATE|TYPE|DURATION|WHERE TO WATCH|WEBSITE|SUBMISSION|SUBMISSION FEE|Brought to you by)\s*:/i)[0]
    .trim();

  return { summary, durationMin, watchUrl };
}

async function fetchIcs(id) {
  const url = `https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`;
  const res = await fetch(url, {
    headers: {
      "user-agent": "MyPlayLogBot/1.0 (https://myplaylog.cc; contact@myplaylog.cc)",
      "accept-encoding": "gzip",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fromGameConfGuide({ log = () => {} } = {}) {
  const now = Date.now();
  const floor = now - GRACE_MS;
  const ceil = now + HORIZON_DAYS * DAY;
  const out = [];

  for (const feed of GCG_FEEDS) {
    let ics;
    try {
      ics = await fetchIcs(feed.id);
    } catch (err) {
      log(`  ! gameconfguide (${feed.kind}) — ${err.message}`);
      continue;
    }

    let kept = 0;
    for (const ev of parseIcs(ics)) {
      // Un événement retiré de l'agenda reste dans le flux, marqué annulé.
      if (/CANCELLED/i.test(prop(ev, "STATUS"))) continue;

      const start = parseIcsDate(ev.DTSTART?.value, ev.DTSTART?.params);
      if (!start || start.ts < floor || start.ts > ceil) continue;

      const name = prop(ev, "SUMMARY").replace(/\s+/g, " ").trim();
      if (!name) continue;
      if (feed.kind === "conference" && !isMajorConference(name)) continue;

      const end = parseIcsDate(ev.DTEND?.value, ev.DTEND?.params);
      const { summary, durationMin, watchUrl } = parseGcgDescription(ev.DESCRIPTION?.value);
      const location = prop(ev, "LOCATION").replace(/\s+/g, " ").trim();

      out.push({
        // ⚠️ L'UID iCal EST LA MEILLEURE CLÉ QU'ON PUISSE ESPÉRER : il ne
        // change pas quand l'événement est déplacé. Un Direct repoussé de deux
        // jours garde donc son identité — et les « ça m'intéresse » avec elle,
        // là où une clé bâtie sur la date les aurait tous perdus.
        key: `gcg:${prop(ev, "UID") || `${feed.kind}:${name}:${start.ts}`}`,
        source: "gameconfguide",
        kind: feed.kind,
        name,
        subtitle: "",
        description: summary.slice(0, 900),
        startsAt: new Date(start.ts),
        endsAt: end ? new Date(end.ts) : null,
        precision: start.precision,
        durationMin,
        location: location.slice(0, 120),
        brand: brandOf(`${name} ${summary}`),
        logo: null,
        liveUrl: watchUrl,
        sourceUrl: GCG_SITE,
        gameIds: [],
      });
      kept += 1;
    }
    log(`· gameconfguide (${feed.kind}) : ${kept} à venir`);
  }

  return out;
}

// ----------------------------------------------------------------------
//  La synchro
// ----------------------------------------------------------------------
/**
 * Rapproche les deux fournisseurs.
 *
 * ⚠️ C'EST L'AGENDA QUI GAGNE, PAS IGDB. gameconfguide donne l'heure, la durée,
 * le lieu et le lien pour regarder ; IGDB, sur un événement à venir, ne donne
 * en général qu'un nom et une date. Mais IGDB a deux choses que l'agenda n'a
 * jamais — le LOGO officiel et la liste des JEUX — alors on les lui emprunte
 * quand il connaît le même rendez-vous.
 */
export function mergeSources(gcg, igdb) {
  const byDedupe = new Map();
  for (const e of gcg) byDedupe.set(dedupeKey(e.name, e.startsAt), e);
  for (const e of igdb) {
    const k = dedupeKey(e.name, e.startsAt);
    const known = byDedupe.get(k);
    if (!known) {
      byDedupe.set(k, e);
      continue;
    }
    if (!known.logo && e.logo) known.logo = e.logo;
    if (!known.gameIds?.length && e.gameIds?.length) known.gameIds = e.gameIds;
    if (!known.liveUrl && e.liveUrl) known.liveUrl = e.liveUrl;
  }
  return [...byDedupe.values()].sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * Ce qui a disparu de sa source.
 *
 * ⚠️ ON NE TOUCHE NI AU PASSÉ NI AU MANUEL. Un événement dont la date est
 * derrière nous n'est plus « revu » par la synchro (les fournisseurs ne
 * regardent que devant) : le supprimer effacerait l'historique et les « ça
 * m'intéresse » de tout le monde à chaque passage. Et une entrée posée à la
 * main n'a par définition aucune source qui la confirmera jamais.
 */
async function pruneStale(runAt) {
  const res = await GameEvent.deleteMany({
    source: { $ne: "manual" },
    startsAt: { $gt: new Date(Date.now() - GRACE_MS) },
    seenAt: { $lt: runAt },
  });
  return res.deletedCount || 0;
}

export async function syncEventCalendar({ dry = false, log = () => {} } = {}) {
  const runAt = new Date();
  const summary = { gcg: 0, igdb: 0, kept: 0, created: 0, updated: 0, pruned: 0 };

  // Les deux fournisseurs partent ENSEMBLE, et l'un en panne ne fait pas tomber
  // l'autre.
  const [gcgRes, igdbRes] = await Promise.allSettled([
    fromGameConfGuide({ log }),
    fromIgdb({ log }),
  ]);
  const gcg = gcgRes.status === "fulfilled" ? gcgRes.value : [];
  const igdb = igdbRes.status === "fulfilled" ? igdbRes.value : [];
  summary.gcg = gcg.length;
  summary.igdb = igdb.length;

  const events = mergeSources(gcg, igdb);
  summary.kept = events.length;
  log(`→ ${events.length} rendez-vous retenus`);

  for (const ev of events) {
    if (dry) {
      log(`  · ${ev.startsAt.toISOString().slice(0, 10)} — ${ev.name}${ev.subtitle ? ` — ${ev.subtitle}` : ""}`);
      continue;
    }
    const existing = await GameEvent.findOne({ key: ev.key });
    if (existing) {
      // ⚠️ ON NE RÉÉCRIT PAS `interested` NI `hidden`. Ils appartiennent aux
      // gens, pas à la source : une synchro qui les écrase décoche tout le
      // monde toutes les nuits.
      Object.assign(existing, ev, { seenAt: runAt });
      await existing.save();
      summary.updated += 1;
    } else {
      await GameEvent.create({ ...ev, seenAt: runAt });
      summary.created += 1;
      log(`  + ${ev.startsAt.toISOString().slice(0, 10)} — ${ev.name}${ev.subtitle ? ` — ${ev.subtitle}` : ""}`);
    }
  }

  // ⚠️ ON NE FAIT PAS LE MÉNAGE LES YEUX FERMÉS. `pruneStale` efface tout ce
  // que la synchro n'a pas revu — c'est le bon comportement quand la source a
  // répondu et qu'un événement en a disparu. Mais si l'agenda est injoignable
  // (panne Google, DNS, coupure réseau), « rien vu » ne veut PAS dire « tout a
  // été annulé » : sans ce garde-fou, une minute d'indisponibilité viderait le
  // calendrier de tout le monde, « ça m'intéresse » compris.
  if (!dry) {
    if (events.length) summary.pruned = await pruneStale(runAt);
    else log("  ! aucune source n'a répondu — ménage annulé, on garde l'existant");
  }
  return summary;
}

// ----------------------------------------------------------------------
//  La boucle quotidienne
// ----------------------------------------------------------------------
// Même principe que l'auto-synchro des trackers (cf. routes/trackers.js) : pas
// de cron système, pas de dépendance en plus — un intervalle dans le processus,
// et un premier passage différé pour laisser le serveur démarrer.
const SYNC_INTERVAL = 12 * 3600 * 1000; // deux fois par jour
const FIRST_RUN_DELAY = 45 * 1000;

async function runQuietly() {
  try {
    const s = await syncEventCalendar();
    console.log(
      `📅 Calendrier : ${s.kept} rendez-vous (${s.created} nouveaux, ${s.updated} mis à jour, ${s.pruned} retirés)`
    );
  } catch (err) {
    console.error("event calendar sync error:", err.message);
  }
}

export function startEventCalendarSync() {
  setTimeout(runQuietly, FIRST_RUN_DELAY);
  setInterval(runQuietly, SYNC_INTERVAL);
  console.log("🔁 Synchro du calendrier des événements activée");
}
