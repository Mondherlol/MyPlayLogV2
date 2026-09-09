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
import List from "../models/List.js";
import {
  cleanEventName,
  eventDescription,
  eventFamily,
  eventTitle,
  fetchEvents,
  fetchGames,
  isTrackedEvent,
  youtubeId,
  youtubeThumb,
} from "./gameEvents.js";
import { ensureSystemUser } from "./eventSync.js";
import { igdbQuery } from "./igdb.js";
import { pushToUsers } from "./push.js";
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

// ======================================================================
//  Reconnaître DEUX DESCRIPTIONS DU MÊME RENDEZ-VOUS
// ======================================================================
// ⚠️ « MÊME NOM, MÊME JOUR » NE SUFFIT PAS, ET ÇA A PRODUIT DES DOUBLONS.
//
// La règle d'origine comparait le nom nettoyé et la date au jour près. Le jour
// où IGDB a fini par renseigner les Nintendo Direct de septembre, les deux
// fournisseurs se sont mis à décrire les mêmes soirées avec :
//
//   • des NOMS différents — l'agenda dit « Nintendo Direct - September »,
//     IGDB dit « Nintendo Direct 2026.09.09 + Nintendo Treehouse Live:
//     September 2026 ». Nettoyés, ça donne « nintendo-direct-september » d'un
//     côté et « nintendo-direct » de l'autre ;
//   • et parfois des DATES différentes — le PLAYISM Game Show est daté du 10
//     par l'agenda et du 11 par IGDB. Vingt-quatre heures d'écart : aucune
//     comparaison au jour près ne les rapprochera jamais.
//
// D'où deux critères indépendants, et il suffit que l'un des deux accroche :
// la FAMILLE (le motif d'événement récurrent, cf. lib/gameEvents), ou le fait
// qu'un nom soit contenu dans l'autre. Le tout dans une fenêtre de trente
// heures, qui absorbe le décalage d'un jour sans marier deux éditions
// distinctes.

// Trente heures : assez pour rattraper un jour d'écart entre deux sources,
// trop peu pour confondre deux rendez-vous d'une même série à deux jours près.
const SAME_EVENT_MS = 30 * 3600 * 1000;

const normName = (name) =>
  slugify(cleanEventName(name)).replace(/-/g, " ").trim();

/** Ces deux descriptions parlent-elles du même rendez-vous ? */
export function sameEvent(a, b) {
  const gap = Math.abs(new Date(a.startsAt) - new Date(b.startsAt));
  if (gap > SAME_EVENT_MS) return false;

  // La famille d'abord : c'est le critère le plus sûr, puisqu'il vient de
  // motifs écrits à la main pour désigner des séries précises.
  const fa = eventFamily(a.name);
  const fb = eventFamily(b.name);
  if (fa && fb) return fa === fb;

  // Sinon, l'un des deux noms contient l'autre. « playism game show » et
  // « playism game show tgs 2026 preview » sont le même showcase ; « nintendo
  // direct » et « the legend of zelda 40th anniversary direct » ne le sont pas.
  const na = normName(a.name);
  const nb = normName(b.name);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

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

  // ⚠️ ON NE FILTRE PLUS ICI, ON MARQUE. Le filtre « événement connu » servait
  // à écarter la longue traîne de micro-showcases d'IGDB — mais il jetait aussi
  // le Direct des 40 ans de Zelda, dont le nom ne correspond à aucun motif. Or
  // l'entrée IGDB de cet événement-là porte quelque chose d'irremplaçable : son
  // IDENTIFIANT, sans lequel on ne peut pas relever ses jeux pendant la
  // diffusion. On garde donc tout le monde comme candidat à la fusion, et
  // `mergeSources` ne fera entrer au calendrier, parmi ceux qui n'ont pas
  // trouvé de jumeau, que les événements reconnus.
  const kept = rows.filter((e) => e.start_time);
  const tracked = kept.filter((e) => isTrackedEvent(e.name)).length;
  log(`· IGDB : ${rows.length} événements à venir, ${tracked} reconnus (${kept.length} candidats)`);

  return kept.map((e) => ({
    key: `igdb:${e.id}`,
    source: "igdb",
    // Gardé quoi qu'il arrive : c'est la clé du relevé en direct.
    igdbEventId: e.id,
    // Seuls les événements RECONNUS ont le droit d'entrer au calendrier par
    // eux-mêmes ; les autres ne servent qu'à enrichir une entrée de l'agenda.
    tracked: isTrackedEvent(e.name),
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

  await resolveImages(out, log);
  return out;
}

// ----------------------------------------------------------------------
//  L'affiche d'un événement, en trois recours
// ----------------------------------------------------------------------
// Un showcase sur trois n'est pas une vidéo YouTube : le Capcom Spotlight
// renvoie vers capcom-games.com, la diffusion Xbox vers une CHAÎNE (pas une
// vidéo). Ces cartes-là restaient sur le dégradé de marque pendant que leurs
// voisines portaient une affiche — l'irrégularité se voyait plus que le
// dégradé lui-même.
//
// D'où trois recours, du plus fidèle au plus approximatif :
//
//   1. la miniature de la vidéo programmée — l'affiche officielle ;
//   2. l'`og:image` de la page de l'événement — c'est l'image que ses
//      organisateurs ont choisie pour qu'on la partage, donc exactement une
//      affiche (Capcom sert « share2026.png ») ;
//   3. l'affiche de la DERNIÈRE ÉDITION du même rendez-vous, qu'on possède
//      déjà (cf. lib/eventSync, qui garde la miniature de chaque conférence
//      passée). Le Capcom Spotlight de septembre porte alors celle de juin.
//
// ⚠️ ET SURTOUT PAS DE QUATRIÈME RECOURS PAR MARQUE. Coller l'affiche du
// dernier Xbox Games Showcase sur une diffusion Xbox au Tokyo Game Show ferait
// croire que c'est le même rendez-vous. Sans famille, on garde le dégradé :
// c'est honnête, et le logo entier y est propre.

const OG_TIMEOUT = 6000;

/** L'image de partage déclarée par une page. */
export async function ogImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OG_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; MyPlayLogBot/1.0; +https://myplaylog.cc)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    // Les balises `meta` sont dans l'en-tête : lire deux cent mille caractères
    // suffit, et évite d'avaler une page de trois mégaoctets pour une URL.
    const html = (await res.text()).slice(0, 200000);
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const found = m?.[1];
    if (!found) return null;
    return found.startsWith("//") ? `https:${found}` : new URL(found, url).toString();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Une couverture générée par nos soins (le SVG de repli des listes
// d'événements) n'est pas une affiche : c'est un rectangle coloré avec un
// titre dessus. Sur une carte, le dégradé de marque fait mieux.
const isRealArtwork = (url) => !!url && !/\.svg(\?|$)/i.test(String(url));

async function resolveImages(events, log) {
  // Les deux premiers recours ne dépendent que de l'événement : tous en même
  // temps, sinon la synchro coûte un aller-retour par carte.
  await Promise.all(
    events.map(async (ev) => {
      const vid = youtubeId(ev.liveUrl);
      if (vid) {
        ev.image = await youtubeThumb(vid).catch(() => null);
        if (ev.image) return;
      }
      ev.image = await ogImage(ev.liveUrl);
    })
  );

  const orphans = events.filter((e) => !e.image && eventFamily(e.name));
  if (!orphans.length) return;

  // UNE seule requête pour tout le monde : on range les affiches des
  // conférences passées par famille, la plus récente gagne.
  const lists = await List.find({
    "event.igdbId": { $ne: null },
    "event.startTime": { $ne: null, $lt: new Date() },
  })
    .sort({ "event.startTime": -1 })
    .select("cover event")
    .limit(200)
    .lean()
    .catch(() => []);

  const byFamily = new Map();
  for (const l of lists) {
    const family = eventFamily(l.event?.name);
    if (family && !byFamily.has(family) && isRealArtwork(l.cover)) byFamily.set(family, l.cover);
  }

  let reused = 0;
  for (const ev of orphans) {
    const hit = byFamily.get(eventFamily(ev.name));
    if (hit) {
      ev.image = hit;
      reused += 1;
    }
  }
  if (reused) log(`· ${reused} affiche(s) reprise(s) de l'édition précédente`);
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
  const out = [...gcg];

  for (const e of igdb) {
    const known = out.find((k) => sameEvent(k, e));
    if (!known) {
      // Pas de jumeau : il n'entre que si c'est un rendez-vous qu'on sait
      // nommer. Sinon on le laisse tomber — c'est le filtre d'origine, déplacé
      // ici pour que les autres aient quand même servi à quelque chose.
      if (e.tracked) out.push(e);
      continue;
    }
    // ⚠️ L'AGENDA GARDE LA MAIN SUR TOUT CE QUI S'AFFICHE — nom, heure, durée,
    // affiche, lien pour regarder. Sa version est tenue par des humains et
    // s'est révélée plus juste (IGDB date le PLAYISM d'un jour de trop, et
    // nomme le Direct « Nintendo Direct 2026.09.09 + Nintendo Treehouse
    // Live… »). D'IGDB on ne prend que ce qu'il est SEUL à avoir.
    if (!known.igdbEventId && e.igdbEventId) known.igdbEventId = e.igdbEventId;
    if (!known.image && e.image) known.image = e.image;
    if (!known.logo && e.logo) known.logo = e.logo;
    if (!known.gameIds?.length && e.gameIds?.length) known.gameIds = e.gameIds;
    if (!known.liveUrl && e.liveUrl) known.liveUrl = e.liveUrl;
  }

  return out.sort((a, b) => a.startsAt - b.startsAt);
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
    // ⚠️ « manual » N'EST PLUS LE SEUL INTOUCHABLE. Les saisons sont écrites par
    // une AUTRE synchro (cf. lib/gameSeasons), qui a ses propres sources et son
    // propre élagage : celle-ci ne les voit jamais passer, donc sans cette
    // exclusion elle les prendrait toutes pour des annulations et les
    // effacerait à chaque passage.
    source: { $nin: ["manual", "seasons"] },
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

  const events = mergeSources(gcg, igdb).map(({ tracked, ...ev }) => ev);
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

// ======================================================================
//  Le relevé EN DIRECT — ce qui est annoncé pendant la diffusion
// ======================================================================
// Un Nintendo Direct dure quarante minutes et sort quinze jeux. IGDB rattache
// ces jeux à son événement au fil de l'eau : la liste, vide à 16 h, se remplit
// pendant l'émission. On la relève donc toutes les deux minutes tant que le
// direct est en cours, et une heure après pour attraper les retardataires.
//
// ⚠️ CE QUE ÇA VAUT DÉPEND D'IGDB, PAS DE NOUS. S'ils saisissent pendant la
// diffusion, la liste se remplit en direct ; s'ils saisissent le lendemain, on
// ne fera que la récupérer plus tôt que la synchro quotidienne. Le mécanisme
// est écrit pour ne rien coûter dans le second cas : quand rien n'est en cours,
// c'est une requête Mongo indexée toutes les deux minutes, et zéro appel IGDB.

// On ouvre cinq minutes avant : les diffusions commencent rarement à la
// seconde, et être déjà en place quand ça démarre vaut mieux que de rater les
// deux premières annonces.
export const LIVE_LEAD_MS = 5 * 60 * 1000;
// Et on reste une heure après la fin : c'est le moment où les bases se mettent
// à jour, une fois que tout le monde a vu ce qui a été montré.
export const LIVE_TAIL_MS = 60 * 60 * 1000;
// Faute de durée annoncée, on table sur une heure et demie.
const DEFAULT_DURATION_MIN = 90;
// ⚠️ ET UN PLAFOND. Un salon de quatre jours a une `endsAt` à quatre jours :
// sans borne, on interrogerait IGDB toutes les deux minutes pendant tout le
// week-end. Douze heures couvrent n'importe quelle conférence réelle.
const LIVE_MAX_MS = 12 * 3600 * 1000;

const LIVE_POLL_MS = 2 * 60 * 1000;

/** La fenêtre pendant laquelle on suit un événement minute par minute. */
export function liveWindow(ev) {
  const start = new Date(ev.startsAt).getTime();
  const declared = ev.endsAt
    ? new Date(ev.endsAt).getTime()
    : start + (ev.durationMin || DEFAULT_DURATION_MIN) * 60000;
  const end = Math.min(declared + LIVE_TAIL_MS, start + LIVE_MAX_MS);
  return { start: start - LIVE_LEAD_MS, end };
}

export function isLive(ev, now = Date.now()) {
  const { start, end } = liveWindow(ev);
  return now >= start && now <= end;
}

/** Les jeux qu'IGDB rattache à CET événement, à l'instant présent. */
async function fetchEventGames(igdbEventId) {
  const rows = await igdbQuery("events", `fields games; where id = ${Number(igdbEventId)}; limit 1;`);
  return rows?.[0]?.games || [];
}

/**
 * Un passage de relevé.
 *
 * Rend le nombre de jeux NOUVELLEMENT vus, tous événements confondus.
 */
// ----------------------------------------------------------------------
//  La liste officielle, écrite PENDANT l'émission
// ----------------------------------------------------------------------
// ⚠️ ELLE N'ARRIVAIT QU'AU LENDEMAIN, ET C'ÉTAIT UN TROU. Le relevé en direct
// remplissait `liveGames` — l'accueil et la fiche du rendez-vous montraient les
// annonces tomber au fil de l'eau — mais l'onglet « Événements » de l'explorateur
// restait vide jusqu'au passage de nuit de `syncEventLists`. Deux écrans de la
// même application racontaient donc deux états du même Direct, à douze heures
// d'écart, sans que rien n'explique pourquoi.
//
// La liste est écrite ici, au même moment et depuis les mêmes données. Elle est
// posée sous LA MÊME CLÉ que la synchro de nuit (`event.igdbId`) : celle-ci la
// retrouve, la complète avec ce qu'IGDB sait faire de mieux — le tri par hype,
// les jeux qu'elle seule voit — et la corrige au lieu d'en créer une seconde.
//
// ⚠️ ET PAS DE SEUIL DE JEUX, contrairement à la synchro de nuit. Ses cinq jeux
// minimum écartent les centaines de micro-événements mal renseignés du
// catalogue IGDB ; ici l'événement est déjà retenu (il est au calendrier, on
// suit sa diffusion à la minute), et attendre le cinquième jeu rendrait la
// liste en retard sur l'accueil — soit exactement le décalage qu'on corrige.
async function upsertLiveEventList(ev, { log = () => {} } = {}) {
  if (!ev.igdbEventId) return;

  const games = (ev.liveGames || []).filter((g) => g.name);
  if (!games.length) return;

  // L'ORDRE DE L'ANTENNE, pas un classement. Pendant un direct, « ce qui vient
  // d'être montré » est l'information ; trier par popularité ferait remonter le
  // gros jeu de la fin au-dessus de celui qu'on regarde à l'instant.
  const items = games.slice(0, 200).map((g) => ({
    kind: "game",
    refId: String(g.id),
    gameId: g.id,
    gameName: null,
    name: String(g.name).slice(0, 200),
    image: g.cover || null,
    note: "",
    media: [],
    rating: null,
    tier: null,
  }));

  const startSec = ev.startsAt ? Math.floor(new Date(ev.startsAt).getTime() / 1000) : null;
  const title = eventTitle(ev.name, startSec);
  const event = {
    igdbId: ev.igdbEventId,
    slug: null,
    name: cleanEventName(ev.name).slice(0, 200),
    startTime: ev.startsAt || null,
    logo: ev.logo || null,
    videoUrl: ev.liveUrl || null,
    videoId: youtubeId(ev.liveUrl),
  };

  const existing = await List.findOne({ "event.igdbId": ev.igdbEventId });
  if (existing) {
    // ⚠️ ON N'ÉCRASE QUE CE QU'ON APPORTE. Si la synchro de nuit est déjà
    // passée, elle a une liste PLUS COMPLÈTE que le relevé en direct (IGDB
    // rattache après coup des jeux qu'aucun relevé n'a vus) : la réécrire avec
    // nos seules annonces la ferait rétrécir.
    if ((existing.items || []).length >= items.length) return;
    existing.items = items;
    // La couverture et le titre ne se posent que s'ils manquent : la synchro de
    // nuit sait faire mieux que nous (miniature testée, affiche générée).
    if (!existing.cover && ev.image) existing.cover = ev.image;
    await existing.save();
    log(`  ≡ liste « ${existing.title} » portée à ${items.length} jeu(x)`);
    return;
  }

  const system = await ensureSystemUser();
  if (!system?._id) return;

  const list = await List.create({
    user: system._id,
    title,
    description: eventDescription(),
    cover: ev.image || null,
    type: "classic",
    itemKind: "game",
    visibility: "public",
    items,
    event,
  });
  log(`  + liste « ${list.title} » créée en direct (${items.length} jeu(x))`);
}

export async function pollLiveEvents({ log = () => {} } = {}) {
  const now = Date.now();

  // Pré-filtre en base, large mais indexé : tout ce qui a un identifiant IGDB
  // et dont l'heure de début est dans les douze dernières heures ou l'heure qui
  // vient. Le tri fin (la vraie fenêtre) se fait ensuite en mémoire, sur une
  // poignée de documents.
  const candidates = await GameEvent.find({
    igdbEventId: { $ne: null },
    hidden: { $ne: true },
    startsAt: { $gte: new Date(now - LIVE_MAX_MS), $lte: new Date(now + LIVE_LEAD_MS) },
  }).limit(20);

  const live = candidates.filter((ev) => isLive(ev, now));
  if (!live.length) return 0;

  let discovered = 0;
  for (const ev of live) {
    let ids;
    try {
      ids = await fetchEventGames(ev.igdbEventId);
    } catch (err) {
      log(`  ! ${ev.name} — IGDB a refusé (${err.message})`);
      continue;
    }

    const seen = new Set((ev.liveGames || []).map((g) => g.id));
    const fresh = ids.filter((id) => !seen.has(id));

    // Rien de neuf : on note quand même le passage, pour que le client sache
    // que le direct est bien suivi.
    if (!fresh.length) {
      ev.liveCheckedAt = new Date();
      await ev.save();
      continue;
    }

    let details = [];
    try {
      details = await fetchGames(fresh);
    } catch {
      // IGDB connaît les identifiants mais pas encore les fiches : on garde
      // quand même les ids, la prochaine synchro complétera les noms.
      details = fresh.map((id) => ({ id, name: "", cover: null }));
    }

    const at = new Date();
    for (const g of details) {
      ev.liveGames.push({
        id: g.id,
        name: String(g.name || "").slice(0, 200),
        cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
        addedAt: at,
      });
    }
    // `gameIds` reste le reflet complet de ce qu'IGDB rattache : c'est lui que
    // lisent les écrans qui ne s'intéressent pas au direct.
    ev.gameIds = [...new Set([...(ev.gameIds || []), ...ids])].slice(0, 200);
    ev.liveCheckedAt = at;
    await ev.save();

    discovered += details.length;
    log(`  ▶ ${ev.name} : ${details.length} jeu(x) de plus (${ev.liveGames.length} au total)`);

    // La liste de l'explorateur suit le même battement que l'accueil. Elle ne
    // fait pas échouer le relevé : les annonces sont enregistrées, c'est
    // l'essentiel — la synchro de nuit rattraperait la liste de toute façon.
    await upsertLiveEventList(ev, { log }).catch((err) =>
      log(`  ! ${ev.name} — liste non écrite (${err.message})`)
    );
  }

  return discovered;
}

async function pollQuietly() {
  try {
    const n = await pollLiveEvents({ log: (l) => console.log(l) });
    if (n) console.log(`🔴 Direct : ${n} jeu(x) relevé(s)`);
  } catch (err) {
    console.error("live event poll error:", err.message);
  }
}

export function startLiveEventWatch() {
  setInterval(pollQuietly, LIVE_POLL_MS);
  console.log("🔴 Relevé des annonces en direct activé");
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

// ----------------------------------------------------------------------
//  Le rappel avant le début : « ça commence dans un quart d'heure »
// ----------------------------------------------------------------------
// ⚠️ COCHER « ÇA M'INTÉRESSE » NE SERVAIT À RIEN JUSQU'ICI. L'événement était
// noté, le compte à rebours tournait sur l'accueil — mais il fallait penser à
// ouvrir l'app pile au bon moment. Un rendez-vous qu'on doit se rappeler tout
// seul n'est pas un rendez-vous noté.
//
// Le rappel part donc du serveur, pas du téléphone : une notification locale
// programmée à l'installation se perdrait au premier report de date, au premier
// changement d'appareil, et ne saurait rien des événements cochés depuis le
// site.

// Un quart d'heure : de quoi lancer la diffusion sur la télé sans que la
// notification arrive si tôt qu'on l'oublie avant le début.
export const REMIND_LEAD_MS = 15 * 60 * 1000;

// ⚠️ ET UNE BORNE BASSE. Si le serveur redémarre ou traîne, on ne veut pas
// annoncer « ça commence » sur un événement commencé depuis vingt minutes :
// passé le début, la notification n'est plus un rappel, c'est un regret. On
// tolère la minute de retard d'un passage de boucle, pas plus.
const REMIND_LATE_MS = 60 * 1000;

const REMIND_POLL_MS = 60 * 1000;

/**
 * Un passage de rappel.
 *
 * Rend le nombre d'événements pour lesquels une notification est partie.
 */
export async function sendEventReminders({ log = () => {} } = {}) {
  const now = Date.now();

  const due = await GameEvent.find({
    hidden: { $ne: true },
    // ⚠️ SEULEMENT CE QUI A UNE HEURE. Un salon connu au jour près n'a pas de
    // « dans quinze minutes » : son `startsAt` est un minuit de convention, et
    // prévenir à 23 h 45 la veille serait un mensonge poli.
    precision: "time",
    startsAt: { $gte: new Date(now - REMIND_LATE_MS), $lte: new Date(now + REMIND_LEAD_MS) },
    "interested.0": { $exists: true },
  })
    .select("name subtitle startsAt interested remindedFor")
    .limit(20);

  let sent = 0;
  for (const ev of due) {
    const start = new Date(ev.startsAt).getTime();
    // Déjà prévenu POUR CETTE heure-là (cf. `remindedFor` dans le modèle).
    if (ev.remindedFor && new Date(ev.remindedFor).getTime() === start) continue;

    // Marqué AVANT l'envoi : si Expo est lent et que le passage suivant arrive
    // entre-temps, mieux vaut un rappel perdu que le même rappel deux fois.
    ev.remindedFor = ev.startsAt;
    await ev.save();

    const minutes = Math.max(0, Math.round((start - now) / 60000));
    const when = minutes <= 1 ? "Ça commence maintenant" : `Ça commence dans ${minutes} min`;

    const accepted = await pushToUsers(ev.interested, {
      title: ev.name,
      body: ev.subtitle ? `${when} — ${ev.subtitle}` : when,
      // `path` : la fiche de l'événement s'ouvre d'une touche, c'est tout
      // l'intérêt du rappel (cf. le routage des notifications côté mobile).
      data: { type: "event", eventId: String(ev._id), path: `/event/${ev._id}` },
      channelId: "events",
    });

    sent += 1;
    log(`  ⏰ ${ev.name} — ${ev.interested.length} intéressé(s), ${accepted} appareil(s) touché(s)`);
  }

  return sent;
}

async function remindQuietly() {
  try {
    await sendEventReminders({ log: (l) => console.log(l) });
  } catch (err) {
    console.error("event reminder error:", err.message);
  }
}

export function startEventReminders() {
  setInterval(remindQuietly, REMIND_POLL_MS);
  console.log("⏰ Rappels des événements cochés activés");
}
