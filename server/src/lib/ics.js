// ======================================================================
//  Un lecteur d'agenda iCal, réduit à ce dont on se sert
// ======================================================================
// Le calendrier des événements vient de trois agendas Google publics, servis
// au format iCalendar (RFC 5545). C'est un format texte, stable depuis vingt
// ans, et infiniment plus solide qu'une page HTML : personne ne « refait le
// design » d'un flux .ics.
//
// On n'implémente PAS la norme entière — ni les fuseaux embarqués (VTIMEZONE),
// ni les récurrences (RRULE), ni les pièces jointes. Vérifié sur les trois
// flux : zéro RRULE, zéro TZID, zéro RECURRENCE-ID. Tout est soit en UTC
// (« 20260908T140000Z »), soit une date nue (« VALUE=DATE:20260917 »). Écrire
// un moteur de récurrence pour des données qui n'en contiennent pas serait du
// code mort le jour même.
//
// ⚠️ SI UN JOUR UN FLUX SE MET AUX RÉCURRENCES, ça ne plantera pas : les
// occurrences répétées seront simplement ignorées (on ne lira que la première).
// C'est le bon échec — silencieux et partiel plutôt que bruyant et total.

/**
 * Le « dépliage » des lignes, première étape obligatoire.
 *
 * iCalendar coupe toute ligne de plus de 75 octets et poursuit la suivante par
 * une espace ou une tabulation. Une description un peu longue arrive donc
 * hachée en dix morceaux — les recoller AVANT de parser est la seule façon de
 * ne pas lire des demi-URL.
 */
export function unfold(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "");
}

// Les caractères échappés du format : « \, » « \; » « \n » « \\ ».
export function unescapeIcs(value) {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Une date iCal → { ts, precision }.
 *
 * ⚠️ LA PRÉCISION SORT D'ICI, ET ELLE COMPTE. « VALUE=DATE:20260917 » veut dire
 * « le 17 septembre », pas « le 17 septembre à minuit » : un salon de trois
 * jours n'a pas d'heure de début. Confondre les deux, c'est afficher un compte
 * à rebours à la seconde sur une information qui n'en contient pas.
 */
export function parseIcsDate(raw, params = "") {
  const v = String(raw || "").trim();
  if (/VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? { ts: Date.UTC(+m[1], +m[2] - 1, +m[3]), precision: "day" } : null;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return {
    ts: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
    precision: "time",
  };
}

/**
 * Les VEVENT d'un flux, en objets simples.
 *
 * Chaque propriété devient `{ value, params }` : les paramètres portent parfois
 * l'information décisive (`VALUE=DATE`), les jeter reviendrait à perdre la
 * précision des dates.
 */
export function parseIcs(text) {
  const body = unfold(text);
  const events = [];

  for (const chunk of body.split("BEGIN:VEVENT").slice(1)) {
    const raw = chunk.split("END:VEVENT")[0];
    const props = {};
    for (const line of raw.split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const [name, ...params] = line.slice(0, colon).split(";");
      // Une propriété répétée (plusieurs ATTENDEE, par exemple) : on garde la
      // première. Aucune de celles qu'on lit n'est censée se répéter.
      const key = name.trim().toUpperCase();
      if (props[key]) continue;
      props[key] = { value: line.slice(colon + 1), params: params.join(";") };
    }
    if (Object.keys(props).length) events.push(props);
  }

  return events;
}

/** La valeur déséchappée d'une propriété, ou `""`. */
export const prop = (ev, key) => unescapeIcs(ev?.[key]?.value || "");

/** Le premier lien d'un fragment HTML — les descriptions en contiennent. */
export function firstHref(html) {
  const m = String(html || "").match(/href=["']([^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

/** Le texte d'un fragment HTML, balises et entités en moins. */
export function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
