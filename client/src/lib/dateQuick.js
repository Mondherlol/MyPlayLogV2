// ======================================================================
//  Dater un jeu sans compter les jours
// ======================================================================
//
// UNE DATE DE JEU SE DIT RAREMENT AU JOUR PRÈS. « Je m'y suis mis à la sortie »,
// « je l'ai fini deux semaines après l'avoir commencé », « c'était il y a un
// an » — voilà comment on s'en souvient. Demander une date exacte dans un
// calendrier, c'est demander un calcul mental avant de pouvoir répondre : la
// plupart des gens renonçaient et laissaient le champ vide.
//
// Ces raccourcis sont ceux de la feuille mobile (QuickAddSheet + DateSheet),
// repris à l'identique pour que la même question se réponde pareil des deux
// côtés. Ils sont RANGÉS PAR ORIGINE — ce qui se compte depuis la sortie (ou
// depuis le jour où l'on a commencé) d'un côté, ce qui se compte depuis
// aujourd'hui de l'autre : en vrac, on ne voit pas qu'il y a deux façons de
// répondre.

/** Une date à midi : deux dates du même jour doivent être ÉGALES. */
export function day(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = day(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d, n) {
  const x = day(d);
  const target = x.getMonth() + n;
  x.setDate(1);
  x.setMonth(target);
  // Le 31 mars + 1 mois n'est pas le 31 avril : on retombe sur le dernier jour
  // du mois visé plutôt que de déborder sur le suivant.
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(new Date(d).getDate(), last));
  return x;
}

/** « 12 mars 2024 » — la date telle qu'on l'écrirait à la main. */
export function dateLabel(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/** La valeur d'un `<input type="date">` (AAAA-MM-JJ) pour cette date locale. */
export function toInputValue(d) {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  // ⚠️ PAS `toISOString()`. Il convertit en UTC, et une date du soir en France
  // y perd un jour : le raccourci « aujourd'hui » proposait hier.
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${dd}`;
}

// Les raccourcis hors de l'intervalle possible disparaissent au lieu d'être
// grisés : on ne commence pas un jeu avant sa sortie, et on ne le finit pas
// demain. Une pastille qu'on ne peut pas cliquer n'apprend rien.
const inRange = (list, today, min) =>
  list.filter((q) => day(q.date) <= today && (!min || day(q.date) >= day(min)));

// Chaque raccourci compté depuis une autre date porte SA date en dessous :
// « un mois après la sortie », on comprend, mais on ne sait pas de quel jour on
// parle. La rangée « depuis aujourd'hui » n'en a pas besoin.
const dated = (items) => items.map((q) => ({ ...q, hint: dateLabel(q.date) }));

/**
 * Les raccourcis du « commencé le ».
 * `release` : la sortie du jeu sur la console cochée (ou la plus ancienne).
 */
export function startShortcuts(release) {
  const today = day(new Date());
  const rel = release ? day(release) : null;
  return [
    rel && {
      key: "release",
      label: "Depuis la sortie",
      items: dated(
        inRange(
          [
            { key: "release", label: "À la sortie", date: rel },
            { key: "r7", label: "1 semaine après", date: addDays(rel, 7) },
            { key: "r30", label: "1 mois après", date: addMonths(rel, 1) },
            { key: "r180", label: "6 mois après", date: addMonths(rel, 6) },
            { key: "r365", label: "1 an après", date: addMonths(rel, 12) },
          ],
          today
        )
      ),
    },
    {
      key: "now",
      label: "Depuis aujourd'hui",
      items: inRange(
        [
          { key: "today", label: "Aujourd'hui", date: today },
          { key: "w1", label: "Il y a une semaine", date: addDays(today, -7) },
          { key: "m1", label: "Il y a un mois", date: addMonths(today, -1) },
          { key: "m6", label: "Il y a six mois", date: addMonths(today, -6) },
          { key: "y1", label: "Il y a un an", date: addMonths(today, -12) },
        ],
        today,
        rel
      ),
    },
  ].filter((r) => r && r.items.length);
}

/**
 * Les raccourcis du « terminé le ».
 *
 * Le point de départ est le jour où l'on a COMMENCÉ si on l'a dit, sinon la
 * sortie : c'est ce qui rend « un mois après » juste. Et rien avant ce
 * point — on ne finit pas un jeu avant de l'avoir commencé.
 */
export function endShortcuts(startedAt, release) {
  const today = day(new Date());
  const base = startedAt ? day(startedAt) : release ? day(release) : null;
  return [
    base && {
      key: "base",
      label: startedAt ? "Après l'avoir commencé" : "Depuis la sortie",
      items: dated(
        inRange(
          [
            { key: "same", label: "Le jour même", date: base },
            { key: "b7", label: "1 semaine après", date: addDays(base, 7) },
            { key: "b14", label: "2 semaines après", date: addDays(base, 14) },
            { key: "b30", label: "1 mois après", date: addMonths(base, 1) },
            { key: "b90", label: "3 mois après", date: addMonths(base, 3) },
            { key: "b365", label: "1 an après", date: addMonths(base, 12) },
          ],
          today,
          base
        )
      ),
    },
    {
      key: "now",
      label: "Depuis aujourd'hui",
      items: inRange(
        [
          { key: "today", label: "Aujourd'hui", date: today },
          { key: "w1", label: "Il y a une semaine", date: addDays(today, -7) },
          { key: "m1", label: "Il y a un mois", date: addMonths(today, -1) },
          { key: "y1", label: "Il y a un an", date: addMonths(today, -12) },
        ],
        today,
        base
      ),
    },
  ].filter((r) => r && r.items.length);
}
