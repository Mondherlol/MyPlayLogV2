import { useEffect, useState } from "react";

// ======================================================================
//  Les rendez-vous à venir (Directs, showcases)
// ======================================================================
// Port web de myplaylog-mobile/src/lib/events.js.
//
// Le serveur envoie une date et une PRÉCISION (cf. server/lib/eventCalendar) :
// « time » quand il connaît l'heure à la seconde, « day » quand sa source — le
// tableau d'une page Wikipédia — ne donnait qu'un jour.
//
// ⚠️ CETTE DISTINCTION N'EST PAS UN DÉTAIL D'AFFICHAGE. Un compte à rebours
// « 14 h 03 min 12 s » sur un Direct dont on ne sait que la date est un chiffre
// inventé : il serait faux de plusieurs heures, et il serait faux avec
// l'assurance d'une horloge. On écrit « J-3 » dans ce cas — c'est moins
// spectaculaire, et c'est vrai.

const DAY = 86400000;

// ⚠️ CES BORNES SONT LES MÊMES QUE CELLES DU SERVEUR (cf. server/lib/
// eventCalendar) : si elles divergent, le site affiche « en direct » sur un
// événement que le serveur ne suit plus.
const LIVE_MAX_MS = 12 * 3600 * 1000;
// Ce que dure un Direct quand la source ne le dit pas. Un Nintendo Direct tient
// en 40 minutes, un State of Play en 30, une conférence d'E3 en deux heures :
// 90 minutes se trompe toujours un peu, jamais beaucoup.
const DEFAULT_DURATION_MIN = 90;

/**
 * L'instant où le rendez-vous est réputé terminé, en millisecondes.
 *
 * ⚠️ `null` QUAND ON NE SAIT PAS. Sur une entrée datée au jour près
 * (enregistrée à minuit UTC), l'heure de début est déjà une convention : lui
 * ajouter une durée donnerait une heure de fin inventée, et c'est précisément
 * ce qui ferait écrire « TERMINÉ » sur un salon qui ouvre dans deux heures.
 */
export function eventEndMs(event) {
  if (!event || event.precision !== "time") return null;
  const start = new Date(event.startsAt).getTime();
  if (Number.isNaN(start)) return null;
  const declared = event.endsAt
    ? new Date(event.endsAt).getTime()
    : start + (event.durationMin || DEFAULT_DURATION_MIN) * 60000;
  return Math.min(declared, start + LIVE_MAX_MS);
}

// La couleur d'une marque. Deux teintes : la carte de repli est un dégradé, et
// c'est ce dégradé qui fait reconnaître un Direct d'un State of Play avant même
// d'avoir lu le titre.
export const BRANDS = {
  nintendo: { label: "Nintendo", from: "#e60012", to: "#6d0009" },
  playstation: { label: "PlayStation", from: "#0072ce", to: "#00204d" },
  xbox: { label: "Xbox", from: "#107c10", to: "#042d04" },
  sega: { label: "Sega", from: "#0089cf", to: "#002a52" },
  steam: { label: "Steam", from: "#2a475e", to: "#0f1620" },
};

// Sans marque reconnue — un showcase indé, une remise de prix — on retombe sur
// un gris profond neutre : mieux vaut pas de signal qu'un faux signal.
export const NEUTRAL_BRAND = { label: null, from: "#2b2f3a", to: "#12141a" };

export function brandTheme(brand) {
  return BRANDS[brand] || NEUTRAL_BRAND;
}

/** Minuit LOCAL d'un instant : c'est en journées qu'on compte les jours. */
const startOfDay = (ms) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const pad = (n) => String(n).padStart(2, "0");

/**
 * Ce qu'on écrit en gros sur la carte.
 *
 * Rend `{ big, small, live, over, past, ticking }` :
 *   • `big` — « J-3 », « DEMAIN », « 02:14:09 »… la ligne qu'on lit de loin ;
 *   • `small` — la date en toutes lettres, qui lève l'ambiguïté ;
 *   • `live` / `over` — en train de se dérouler, ou passé ;
 *   • `ticking` — vrai quand `big` change chaque seconde, et donc quand la
 *     page doit battre à ce rythme.
 */
export function countdown(event, now = Date.now()) {
  const { startsAt, precision = "day" } = event || {};
  const ts = new Date(startsAt).getTime();
  const small = Number.isNaN(ts)
    ? ""
    : new Date(ts).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        ...(precision === "time" ? { hour: "2-digit", minute: "2-digit" } : null),
      });
  const blank = {
    big: "",
    small: "",
    live: false,
    over: false,
    past: false,
    ticking: false,
  };
  if (Number.isNaN(ts)) return blank;

  const diff = ts - now;
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);

  // ⚠️ « EN COURS » N'EST DIT QUE QUAND ON CONNAÎT L'HEURE. Une date au jour
  // près est enregistrée à minuit UTC : sans cette condition, un Direct annoncé
  // pour le 8 septembre passerait « en cours » à 2 h du matin.
  if (precision === "time") {
    const end = eventEndMs(event);
    if (end !== null && now >= end)
      return { ...blank, big: "Terminé", small, over: true, past: true };
    if (diff <= 0)
      return { ...blank, big: "En direct", small, live: true, past: true };
    if (diff < DAY) {
      const s = Math.floor(diff / 1000);
      return {
        big: `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`,
        small,
        live: false,
        over: false,
        past: false,
        ticking: true,
      };
    }
  }

  const flat = { small, live: false, over: false, past: false, ticking: false };
  if (days < 0) return { ...flat, big: "Terminé", over: true, past: true };
  if (days === 0) return { ...flat, big: "Aujourd'hui" };
  if (days === 1) return { ...flat, big: "Demain" };
  return { ...flat, big: `J-${days}` };
}

/**
 * Une horloge partagée, qui ne tourne que si quelqu'un la regarde.
 *
 * ⚠️ UN `setInterval` PAR CARTE EST UNE MAUVAISE IDÉE. Huit cartes qui battent
 * chacune de leur côté, ce sont huit réveils par seconde et huit rendus — sur
 * une page qui porte déjà des rails d'images. Ici, un seul intervalle, et
 * seulement quand au moins une carte affiche vraiment des secondes.
 */
export function useSecondsTicker(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : null;
}

/**
 * Le décompte complet : « 2 j 04:12:09 ».
 *
 * ⚠️ IL N'EXISTE QUE SI L'HEURE EST CONNUE — sinon il serait faux de plusieurs
 * heures, et faux avec l'air d'être exact. On rend `null`, et l'appelant
 * retombe sur « J-3 ».
 */
export function preciseCountdown(startsAt, precision, now = Date.now()) {
  if (precision !== "time") return null;
  const ts = new Date(startsAt).getTime();
  if (Number.isNaN(ts)) return null;
  const diff = ts - now;
  if (diff <= 0) return null;

  const total = Math.floor(diff / 1000);
  const days = Math.floor(total / 86400);
  const clock = `${pad(Math.floor((total % 86400) / 3600))}:${pad(
    Math.floor((total % 3600) / 60)
  )}:${pad(total % 60)}`;
  return days ? `${days} j ${clock}` : clock;
}

/**
 * Faut-il une horloge à la seconde pour CE lot d'événements ?
 *
 * ⚠️ COCHER « ÇA M'INTÉRESSE » ALLUME L'HORLOGE, MÊME À TROIS MOIS : un
 * événement suivi affiche son décompte complet, c'est ce qu'on vient revoir.
 * Les autres se contentent de « J-3 » et ne réveillent personne.
 */
export function needsTicker(events, now = Date.now()) {
  return (events || []).some(
    (e) =>
      countdown(e, now).ticking ||
      (e.interested && preciseCountdown(e.startsAt, e.precision, now) !== null)
  );
}

/** « lun. 8 sept. » — court, pour une ligne de liste. */
export function shortWhen(startsAt) {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** « 16:00 » dans le fuseau du navigateur, ou `null` si la source l'ignore. */
export function localTime(startsAt, precision) {
  if (precision !== "time") return null;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** « 30 min » / « 1 h 30 ». */
export function durationLabel(minutes) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** « 12 juil. » — date courte d'une sortie (timestamp unix en secondes). */
export function shortDate(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

/** « il y a 3 min » — l'âge d'une activité, pour le fil d'aperçu. */
export function agoLabel(date) {
  const ms = new Date(date || 0).getTime();
  if (!ms || Number.isNaN(ms)) return "";
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** « lundi 8 septembre, 16:00 » — la ligne complète d'une fiche. */
export function fullWhen(startsAt, precision) {
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = localTime(startsAt, precision);
  return time ? `${date}, ${time}` : date;
}

/**
 * L'événement est-il dans sa fenêtre de diffusion ?
 *
 * ⚠️ PLUS LARGE QUE LE `live` DE `countdown()`, ET C'EST VOULU. Celui-ci dit
 * « le serveur relève encore les annonces » — il commence cinq minutes avant
 * l'heure et déborde d'une heure sur la fin, parce qu'un Direct déborde
 * toujours un peu. Celui de `countdown()` dit ce qu'on ÉCRIT sur la carte, et
 * là il ne faut pas déborder : « EN COURS » sur une émission finie est un
 * mensonge.
 */
export function isEventLive(event, now = Date.now()) {
  const end = eventEndMs(event);
  if (end === null) return false;
  const start = new Date(event.startsAt).getTime();
  return now >= start - 5 * 60 * 1000 && now <= Math.min(end + 3600000, start + 12 * 3600000);
}

/** « Direct », « Conférence », « Saison » — ce que c'est, en un mot. */
export function kindLabel(kind) {
  if (kind === "conference") return "Conférence";
  if (kind === "season") return "Saison";
  return "Direct";
}

/**
 * Depuis combien de minutes une annonce est tombée.
 *
 * Rend `null` au-delà d'une heure : passé ce délai, « il y a 73 min » n'aide
 * plus personne, et la fraîcheur n'est plus l'information.
 */
export function announcedAgo(addedAt, now = Date.now()) {
  const ts = new Date(addedAt || 0).getTime();
  if (!ts || Number.isNaN(ts)) return null;
  const mins = Math.floor((now - ts) / 60000);
  return mins >= 0 && mins <= 60 ? mins : null;
}

/** « 12 intéressés » — et rien du tout quand personne ne l'est encore. */
export function interestLabel(count) {
  if (!count) return null;
  return `${count} intéressé${count > 1 ? "s" : ""}`;
}
