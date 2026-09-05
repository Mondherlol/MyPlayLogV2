// ======================================================================
//  Listes officielles « Événements » — construites depuis IGDB
// ======================================================================
// IGDB tient un endpoint `events` qui recense les conférences et showcases du
// jeu vidéo, avec pour chacun : la date, le lien du live, un logo, et surtout
// la LISTE DES JEUX qui y ont été montrés. C'est exactement le contenu d'une
// liste MyPlayLog — d'où cette synchro, qui évite toute curation à la main et
// se remet à jour toute seule après chaque conférence.
//
// Les listes produites appartiennent au compte de service « MyPlayLog »
// (User.isSystem), donc personne ne peut les modifier : `mine` est faux pour
// tout le monde, l'API refuse déjà l'édition.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { igdbQuery } from "./igdb.js";

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Les couvertures générées vivent avec les autres images de listes, servies par
// Express sur /uploads (Caddy y route /uploads/* en production).
export const EVENT_COVERS_DIR = path.join(__dirname, "../../uploads/lists/events");

// Événements retenus. IGDB en référence des centaines par an, dont une longue
// traîne de micro-showcases : sans filtre, la page Listes devient illisible.
// On garde les grandes conférences et les showcases indés qui comptent
// vraiment. Ajouter une ligne ici suffit à en faire entrer un nouveau.
export const EVENT_PATTERNS = [
  // --- Constructeurs ---
  { re: /nintendo direct/i, tag: "major" },
  { re: /nintendo treehouse/i, tag: "major" },
  { re: /indie world/i, tag: "major" },
  { re: /partner (showcase|direct)/i, tag: "major" },
  { re: /state of play/i, tag: "major" },
  { re: /playstation (showcase|presents)/i, tag: "major" },
  { re: /xbox games showcase/i, tag: "major" },
  { re: /developer[_ ]direct/i, tag: "major" },
  { re: /xbox partner preview/i, tag: "major" },
  // --- Grands rendez-vous ---
  // Ancré en début d'intitulé : une dizaine de showcases satellites portent
  // « … : Summer Game Fest 2026 Edition » et rempliraient la page à eux seuls.
  { re: /^summer game fest/i, tag: "major" },
  { re: /the game awards/i, tag: "major" },
  { re: /opening night live/i, tag: "major" },
  { re: /pc gaming show/i, tag: "major" },
  { re: /future games show/i, tag: "major" },
  { re: /ea play/i, tag: "major" },
  // --- Éditeurs ---
  { re: /capcom (spotlight|showcase|highlights)/i, tag: "major" },
  { re: /ubisoft forward/i, tag: "major" },
  { re: /square enix presents/i, tag: "major" },
  { re: /sega (showcase|fes)/i, tag: "major" },
  { re: /bandai namco/i, tag: "major" },
  { re: /devolver/i, tag: "major" },
  { re: /annapurna/i, tag: "major" },
  { re: /thq nordic/i, tag: "major" },
  { re: /nacon connect/i, tag: "major" },
  { re: /warhammer skulls/i, tag: "major" },
  { re: /arc system works/i, tag: "major" },
  // --- Indés notables ---
  { re: /day of the devs/i, tag: "indie" },
  { re: /wholesome direct/i, tag: "indie" },
  { re: /triple-?i/i, tag: "indie" },
  { re: /bitsummit/i, tag: "indie" },
  { re: /guerrilla collective/i, tag: "indie" },
  { re: /realms deep/i, tag: "indie" },
  { re: /six one indie/i, tag: "indie" },
  { re: /\bthe mix\b/i, tag: "indie" },
  { re: /ag french direct/i, tag: "indie" }, // le rendez-vous francophone
  { re: /kinda funny games/i, tag: "indie" },
  { re: /id@xbox/i, tag: "indie" },
];

// Un événement sans jeux (annoncé mais pas encore passé, ou mal renseigné) ne
// donnerait qu'une liste vide.
export const MIN_GAMES = 5;

const fmtDateFr = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Id YouTube d'un lien de live. Les événements pointent presque tous vers
// YouTube ; ceux qui renvoient ailleurs (Twitch) gardent juste leur lien.
export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// Titre lisible à partir de l'intitulé IGDB, qui embarque souvent la date et
// une rallonge : « Nintendo Direct 2026.06.09 + Nintendo Treehouse Live: July
// 2026 » ou « State of Play | June 2, 2026 ». On coupe à la première rallonge,
// on retire la date déjà présente, et on rajoute la nôtre en français.
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|" +
  "janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre";

// Intitulé nettoyé, sans date ni rallonge : « Nintendo Direct 2026.06.09 +
// Nintendo Treehouse Live: July 2026 » → « Nintendo Direct ». Sert au titre de
// la liste, à sa description et au libellé de la rediff.
export function cleanEventName(name) {
  let base = String(name || "").trim();
  // Rallonges : tout ce qui suit un séparateur fort.
  base = base.split(/\s+\+\s+|\s*[|:–—]\s+/)[0].trim();
  // Dates collées à l'intitulé, sous leurs formes courantes : « 2026.06.09 »,
  // « 3.3.2026 », « - May 21st, 2026 », « April 2026 » au milieu, « 2026 » à la
  // fin. Notre propre date prend le relais juste après.
  base = base
    .replace(/[-–—]?\s*\d{4}[.\/]\d{1,2}[.\/]\d{1,2}\.?\s*$/, "")
    .replace(/[-–—]?\s*\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\.?\s*$/, "")
    .replace(
      new RegExp(
        `[\\s,–—-]*(?:${MONTHS})\\s*\\d{0,2}(?:st|nd|rd|th)?,?\\s*(?:19|20)\\d{2}\\s*$`,
        "i"
      ),
      ""
    )
    .replace(/\s*(19|20)\d{2}\s*$/, "")
    .replace(/\s*[-–—,:]\s*$/, "")
    .trim();

  // Date PRISE EN SANDWICH (« ID@Xbox April 2026 Showcase ») : on ne la retire
  // que s'il reste de quoi nommer l'événement.
  const unsandwiched = base
    .replace(new RegExp(`\\s\\b(?:${MONTHS})\\s+(?:19|20)\\d{2}\\b`, "i"), "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (unsandwiched.length >= 3) base = unsandwiched;
  // Filet : si le nettoyage a tout mangé, on garde l'intitulé d'origine.
  return base.length >= 3 ? base : String(name || "").trim();
}

// Titre de la liste : l'intitulé nettoyé, daté en français.
export function eventTitle(name, startTime) {
  const base = cleanEventName(name);
  const date = startTime ? fmtDateFr.format(new Date(startTime * 1000)) : null;
  return (date ? `${base} — ${date}` : base).slice(0, 120);
}

// Pas de description : le titre daté, le compteur d'éléments et la rediff en
// tête disent déjà tout. Une phrase générée en plus n'apportait que du bruit.
export const eventDescription = () => "";

// Un événement mérite-t-il sa liste ?
export function isTrackedEvent(name) {
  return EVENT_PATTERNS.some((p) => p.re.test(String(name || "")));
}

/**
 * La FAMILLE d'un événement — ce qui relie ses éditions successives.
 *
 * « Nintendo Direct - September », « Nintendo Direct 2026.06.09 » et
 * « Nintendo Direct » sont trois écritures du même rendez-vous récurrent. Pour
 * afficher « les jeux annoncés à la dernière édition », il faut pouvoir les
 * rapprocher — et les rapprocher SANS se tromper : un State of Play n'est pas
 * un Nintendo Direct, et « Xbox Partner Preview » n'est pas « Xbox Games
 * Showcase ».
 *
 * On se sert des motifs qui servent déjà à trier les événements : celui qui
 * accroche DONNE la famille. C'est stable (le motif ne change pas quand
 * l'intitulé varie) et ça ne demande aucune liste de plus à tenir.
 *
 * ⚠️ PAS DE RATTRAPAGE APPROXIMATIF, ET C'EST UNE CORRECTION DE BUG.
 *
 * La première version rattachait tout ce qui contenait « Direct » à la famille
 * des Nintendo Direct, en se disant que c'était « la série dont il fait
 * partie ». Résultat : la fiche du Legend of Zelda 40th Anniversary Direct
 * annonçait « la dernière fois : 72 jeux annoncés » et alignait les jaquettes
 * du Direct généraliste de juin — Stellar Blade, Onimusha, Lords of the Fallen.
 * Aucun de ces jeux n'a jamais été montré à un Direct Zelda, et il n'y a jamais
 * eu de Direct Zelda avant celui-ci.
 *
 * Un rapprochement à peu près juste est PIRE que pas de rapprochement du tout :
 * il n'a pas l'air d'une erreur, il a l'air d'une information. Un événement
 * thématique n'a pas d'édition précédente — c'est la vérité, et la fiche doit
 * la dire en n'affichant rien.
 *
 * Rend donc `null` dès qu'aucun motif connu n'accroche.
 */
export function eventFamily(name) {
  const hit = EVENT_PATTERNS.find((p) => p.re.test(String(name || "")));
  return hit ? hit.re.source : null;
}

// --- Récupération IGDB ------------------------------------------------

// Les événements d'une période, du plus récent au plus ancien.
export async function fetchEvents({ since, until = Math.floor(Date.now() / 1000) }) {
  return igdbQuery(
    "events",
    `fields name, description, slug, start_time, end_time, live_stream_url,
            event_logo.image_id, games;
     where start_time >= ${Math.floor(since)} & start_time <= ${Math.floor(until)};
     sort start_time desc; limit 500;`
  );
}

// Les jeux d'un événement, en lots (IGDB plafonne à 500 par requête).
export async function fetchGames(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250);
    const rows = await igdbQuery(
      "games",
      `fields name, cover.image_id, hypes, total_rating_count, first_release_date;
       where id = (${chunk.join(",")});
       limit ${chunk.length};`
    );
    out.push(...rows);
  }
  return out;
}

// Items de liste prêts à enregistrer, les annonces marquantes en tête.
//
// On trie par HYPE d'abord, pas par popularité : une conférence sert à montrer
// ce qui arrive, et pondérer avec le nombre de notes ferait remonter les gros
// jeux du catalogue (Minecraft, FF XIV…) simplement parce qu'ils sont anciens
// et très notés. La popularité ne sert qu'à départager les jeux sans hype.
export function toListItems(games) {
  return games
    .map((g) => ({
      kind: "game",
      refId: String(g.id),
      gameId: g.id,
      gameName: null,
      name: String(g.name || "").slice(0, 200),
      image: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
      note: "",
      media: [],
      rating: null,
      tier: null,
      _hype: g.hypes || 0,
      _pop: g.total_rating_count || 0,
    }))
    .filter((i) => i.name)
    .sort(
      (a, b) =>
        b._hype - a._hype ||
        b._pop - a._pop ||
        a.name.localeCompare(b.name, "fr")
    )
    .map(({ _hype, _pop, ...item }) => item);
}

// --- Couverture de la liste ------------------------------------------

// La miniature YouTube du live : c'est l'image la plus reconnaissable d'une
// conférence. `maxresdefault` n'existe pas pour toutes les vidéos (elle dépend
// de la définition d'origine) — on la teste, et on retombe sur `hqdefault`, qui
// est toujours là.
export async function youtubeThumb(videoId) {
  if (!videoId) return null;
  const max = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const res = await fetch(max, { method: "HEAD" });
    if (res.ok) return max;
  } catch {
    /* réseau capricieux : la valeur sûre fera l'affaire */
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

const escapeXml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]
  );

// Teinte stable dérivée du nom : deux conférences différentes n'ont jamais la
// même couverture, et la même conférence garde la sienne d'une synchro à l'autre.
function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// Découpe un titre en deux lignes au plus, à la coupure de mot la plus proche
// du milieu — un titre centré sur deux lignes équilibrées se lit bien mieux
// qu'une ligne pleine suivie d'un mot orphelin.
function wrapTitle(name, maxPerLine = 22) {
  if (name.length <= maxPerLine) return [name];
  const words = name.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const score = Math.abs(a.length - b.length) + Math.max(0, a.length - maxPerLine) * 3;
    if (!best || score < best.score) best = { a, b, score };
  }
  return best ? [best.a, best.b] : [name];
}

// Couverture de repli, dessinée en SVG : aucune dépendance d'image côté serveur
// (pas de canvas ni de sharp), et le fichier reste minuscule. Même esprit que
// les curseurs de l'arcade, générés plutôt que commités.
export function eventCoverSvg({ name, dateLabel }) {
  const hue = hueOf(name);
  const lines = wrapTitle(name);
  const fontSize = lines.length > 1 ? 86 : 104;
  const firstY = lines.length > 1 ? 330 : 380;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 42% 20%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 40) % 360} 48% 9%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.12" r="0.75">
      <stop offset="0" stop-color="#f2b70b" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#f2b70b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2">
    ${[220, 330, 440, 550].map((r) => `<circle cx="640" cy="360" r="${r}"/>`).join("\n    ")}
  </g>
  <g font-family="Trebuchet MS, Verdana, Geneva, sans-serif" text-anchor="middle">
    ${lines
      .map(
        (l, i) =>
          `<text x="640" y="${firstY + i * (fontSize + 14)}" font-size="${fontSize}" font-weight="bold" fill="#ffffff">${escapeXml(l)}</text>`
      )
      .join("\n    ")}
    ${
      dateLabel
        ? `<text x="640" y="${firstY + lines.length * (fontSize + 14) + 26}" font-size="42" fill="#f2b70b" letter-spacing="2">${escapeXml(dateLabel)}</text>`
        : ""
    }
    <text x="640" y="672" font-size="26" fill="#ffffff" fill-opacity="0.45" letter-spacing="6">MYPLAYLOG</text>
  </g>
</svg>`;
}

// Couverture définitive d'un événement : miniature du live si on en a une,
// sinon une image générée. `baseUrl` = domaine public qui sert /uploads.
export async function resolveEventCover(ev, baseUrl) {
  const thumb = await youtubeThumb(youtubeId(ev.live_stream_url));
  if (thumb) return thumb;

  fs.mkdirSync(EVENT_COVERS_DIR, { recursive: true });
  const file = `ev-${ev.id}.svg`;
  fs.writeFileSync(
    path.join(EVENT_COVERS_DIR, file),
    eventCoverSvg({
      name: cleanEventName(ev.name),
      dateLabel: ev.start_time
        ? fmtDateFr.format(new Date(ev.start_time * 1000))
        : null,
    })
  );
  return `${String(baseUrl).replace(/\/+$/, "")}/uploads/lists/events/${file}`;
}

// Bloc `event` du document List.
export function toListEvent(ev) {
  return {
    igdbId: ev.id,
    slug: ev.slug || null,
    // Intitulé nettoyé : c'est lui qui s'affiche sous la rediff.
    name: cleanEventName(ev.name).slice(0, 200),
    startTime: ev.start_time ? new Date(ev.start_time * 1000) : null,
    logo: ev.event_logo?.image_id
      ? `${IMG_BASE}/t_logo_med/${ev.event_logo.image_id}.png`
      : null,
    videoUrl: ev.live_stream_url || null,
    videoId: youtubeId(ev.live_stream_url),
  };
}
