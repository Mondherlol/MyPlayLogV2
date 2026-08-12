import {
  accentInk,
  alpha,
  inkOn,
  luminanceOf,
  shade,
  tintLogo,
  canvasOf,
  drawCover,
  drawFit,
  fitOneLine,
  fitTracked,
  grain,
  makeField,
  roundRect,
  rule,
  SANS,
  SERIF,
  trackedText,
  trackedWidth,
  wrapText,
} from "./canvasKit";
import { fmtDuration, fmtYears, LICENCES } from "./collection";

// ======================================================================
//  Le mini-studio — fabriquer une jaquette de DVD, pas un rectangle
// ======================================================================
// CE QUI CLOCHAIT. Une face sans jaquette dépliée était composée avec le seul
// matériel d'une fiche : une affiche, un bandeau, du texte. Ça donnait une
// couverture = l'affiche recadrée, et un dos = un mur de paragraphes avec trois
// fois le même bandeau découpé en vignettes. Techniquement propre, et pourtant
// laid — parce que ce n'est pas comme ça qu'un DVD est fait.
//
// UN VRAI BOÎTIER SE LIT EN TROIS SECONDES, et il tient sur cinq objets :
//
//   1. LE LOGO DU TITRE, détouré. C'est l'identité graphique de l'œuvre ; un
//      titre recomposé dans notre didone, si soigné soit-il, reste une
//      approximation de quelqu'un d'autre ;
//   2. UNE IMAGE DE L'ŒUVRE en fond, pas son affiche à nouveau. Le dos d'un DVD
//      montre des PHOTOS D'EXPLOITATION — des instants différents, pas trois
//      recadrages du même ;
//   3. LE SOMMAIRE. C'est LA raison pour laquelle on retourne un coffret de
//      série : savoir ce qu'il y a dedans. Les titres d'épisodes, ou les
//      saisons quand il y en a trop ;
//   4. LE CARTOUCHE TECHNIQUE — format d'image, son, zone, durée, langues.
//      Personne ne le lit vraiment, et son absence se voit tout de suite : ce
//      sont ces mentions qui font « objet édité » plutôt que « visuel » ;
//   5. LE CODE-BARRES et la marque de l'éditeur en pied. Le pied d'un dos est
//      dense et administratif, et c'est ce contraste avec le haut illustré qui
//      donne toute sa crédibilité à la face.
//
// Le matériel des points 1 et 2 vient de TMDB (voir `fetchCaseMeta` côté
// serveur) ; les points 3 à 5 se déduisent de la fiche. RIEN N'EST OBLIGATOIRE :
// chaque bloc s'efface s'il n'a pas sa matière, et la composition se resserre.
//
// ----------------------------------------------------------------------
// UN MOT SUR LES RÉGLAGES. Il y en a six, et il n'y en aura pas plus. Chaque
// bouton ajouté au studio est un aveu : celui d'un gabarit qui ne sait pas
// décider tout seul. Ceux qui restent ne servent qu'à rattraper ce que la
// machine ne PEUT pas voir — un logo blanc perdu sur une image blanche, un
// sommaire illisible sur une série-fleuve. Tout le reste est composé.

// ---------------------------------------------------------------- repères --

// Le format d'image d'un DVD de série ou de film moderne. Écrit en clair parce
// qu'il s'imprime sur la face : on ne le devine nulle part dans la fiche, et
// c'est vrai de tout ce que le rayon héberge.
const RATIO_MARK = "16:9";
const ZONE = "2"; // Europe — la zone du rayon, comme le visa d'âge est le visa français

// Combien d'épisodes tiennent au dos. Le serveur en envoie vingt-deux au plus
// (voir CASE_EPISODES) ; au-delà, le sommaire bascule sur les saisons.
const MAX_LIST = 22;

const upper = (s) => String(s || "").toUpperCase();

// L'ENCRE DU BOÎTIER. La teinte de la fiche (`media.color`) sert de défaut,
// mais elle a été choisie pour l'étiquette de la grille 2D et ne convient pas
// toujours à un objet imprimé. Le studio peut donc en poser une autre, PROPRE À
// LA JAQUETTE, sans toucher au reste de l'application.
const inkOf = (media) => media.caseArt?.color || media.color || "#f2b70b";

// LA COULEUR EXACTE D'UNE FACE SANS IMAGE. `null` tant que personne n'a choisi :
// le champ retombe alors sur la teinte de la fiche fortement assombrie, qui est
// le bon réglage pour une couleur qu'on n'a JAMAIS choisie pour couvrir une
// face entière. Dès qu'un humain en pose une dans le studio, elle est servie
// telle quelle — un sélecteur de couleur qui rend autre chose que la couleur
// désignée n'est pas un sélecteur de couleur.
const flatBg = (media) => media.caseArt?.color || null;

// L'accent sur un aplat choisi : la même teinte poussée du côté OPPOSÉ au fond.
// `accentInk` éclaircit toujours — sur un fond crème, l'accent éclairci est
// blanc sur blanc.
const flatAccent = (bg) =>
  bg ? shade(bg, luminanceOf(bg) > 0.56 ? -0.55 : 0.55) : "#f2b70b";

// ------------------------------------------------------------- typographie --
//
// LA TYPO N'EST PLUS FIGÉE. Le gabarit imposait une didone pour les titres et
// une grotesque neutre pour le reste : c'est un choix défendable, ce n'est pas
// LE choix — une comédie potache et un documentaire n'ont rien à faire dans la
// même fonte, et personne ne pouvait en changer.
//
// Le catalogue reste COURT et il est fermé : ce sont les familles que
// l'application charge déjà (voir l'import de polices dans index.css) plus
// quelques fontes présentes sur toutes les machines. Proposer un champ libre
// n'aurait servi à rien — une fonte que le navigateur n'a pas retombe en
// silence sur du Times, et la jaquette part comme ça dans la texture.
export const FONTS = {
  didone: { label: "Didone (Playfair)", stack: '"Playfair Display", Georgia, serif' },
  grotesk: { label: "Grotesque (Space Grotesk)", stack: '"Space Grotesk", Inter, sans-serif' },
  inter: { label: "Neutre (Inter)", stack: "Inter, system-ui, sans-serif" },
  fredoka: { label: "Ronde (Fredoka)", stack: "Fredoka, Inter, sans-serif" },
  georgia: { label: "Classique (Georgia)", stack: 'Georgia, "Times New Roman", serif' },
  impact: { label: "Massive (Impact)", stack: 'Impact, "Arial Black", sans-serif' },
  courier: { label: "Machine (Courier)", stack: '"Courier New", monospace' },
};

// Les deux fontes d'une jaquette : celle des TITRES (le titre composé, la
// marque, les accroches) et celle du TEXTE (mentions, sommaire, cartouche).
// Deux, jamais trois : c'est la règle qui sépare une édition d'un tract.
function fontsOf(media) {
  const c = media.caseArt || {};
  return {
    title: FONTS[c.fontTitle]?.stack || SERIF,
    text: FONTS[c.fontText]?.stack || SANS,
  };
}

// ------------------------------------------------------------- le cadrage --
//
// OÙ L'IMAGE EST COUPÉE. Un visuel paysage recadré en portrait perd les deux
// tiers de sa largeur, et un cadrage centré coupe les têtes une fois sur deux.
// Le réglage est une fraction de la HAUTEUR de l'image d'origine qu'on garde en
// tête : 0 colle en haut, 1 colle en bas.
function imageAnchor(media, face) {
  const set = media.caseArt?.[face === "front" ? "frontCrop" : "backCrop"];
  if (set === undefined || set === null || set === "") return face === "front" ? 0.28 : 0.4;
  return Math.min(1, Math.max(0, Number(set) / 100));
}

// ---------------------------------------------------------------- le logo --
//
// LE LOGO TEL QU'IL SERA POSÉ : celui qu'on a désigné, teinté (ou pas) selon ce
// qu'on a demandé. Le détourage automatique est le bon réglage neuf fois sur
// dix, et un désastre la dixième — d'où le réglage explicite.
function frontLogo(media, art, ink) {
  if (!art.logo || media.caseArt?.logo === false) return null;
  const tint = media.caseArt?.logoTint || "auto";
  if (tint === "none") return art.logo;
  if (tint === "white") return tintLogo(art.logo, "#ffffff", "always");
  if (tint === "black") return tintLogo(art.logo, "#14151a", "always");
  // « auto » : on ne repeint que ce qui se perdrait — un logo sombre sur une
  // face sombre, un logo clair sur une face claire. Et jamais un logo en
  // couleur (voir `tintLogo`, qui refuse d'aplatir une forme colorée).
  return tintLogo(art.logo, ink, ink === "#ffffff" ? "ifDark" : "ifLight");
}

// ------------------------------------------------------------ les photos --
//
// LES TROIS VIGNETTES DU DOS. On veut trois images DIFFÉRENTES, et surtout pas
// celle qui est déjà en bandeau juste au-dessus : le dos montrait la même photo
// deux fois, en grand puis en petit, ce qui se remarque immédiatement.
//
// Le fonds fournit la matière ; à défaut, on retombe sur trois cadrages du
// bandeau, ce qui reste mieux qu'une rangée vide.
function backShots(media, art) {
  const head = imageFor(media.caseArt?.back, art, [art.stills?.[0], art.backdrop, art.poster]);
  const seen = new Set(head ? [head] : []);
  const out = [];
  for (const img of [...(art.stills || []), ...(art.pool || []), art.backdrop, art.poster]) {
    if (!img || seen.has(img)) continue;
    seen.add(img);
    out.push(img);
    if (out.length === 3) break;
  }
  return out;
}

// ------------------------------------------------------- les vraies marques --
//
// LES LOGOS DE SUPPORT SONT DES FICHIERS, PAS DES DESSINS. Ils étaient tracés à
// la main ici (une ellipse, trois lettres) : ça tenait de loin, et ça ne tient
// plus dès qu'on approche le boîtier — un logo officiel a un tracé qu'on
// reconnaît, et une approximation se voit exactement comme une faute
// d'orthographe.
//
// OÙ LES DÉPOSER : `client/public/case/`. Le dossier `public` est servi tel
// quel, donc à NOTRE origine — c'est la condition pour qu'un canvas destiné à
// WebGL ne soit pas « souillé » (voir loadImage). Des PNG à fond transparent,
// blancs ou noirs indifféremment : ils sont détourés en blanc à la peinture.
//
// Chaque fichier est FACULTATIF : celui qui manque laisse la place au tracé
// maison, et rien ne casse.
export const MARK_FILES = {
  dvd: "/case/dvd-video.png",
  bluray: "/case/blu-ray.png",
  audio: "/case/dolby-digital.png",
  zone: "/case/zone-2.png",
  widescreen: "/case/16-9.png",
};

// Le support d'un titre, tel qu'il s'imprime. Le rayon est tout en DVD ; le
// champ existe pour le jour où un Blu-ray s'y range.
const supportMark = (media) => (media.format === "bluray" ? "bluray" : "dvd");

// Pose une marque : le vrai logo s'il a été déposé, le tracé maison sinon.
// Rend la largeur occupée, pour que l'appelant enchaîne.
//
// `ink` n'est là que pour les faces d'une couleur claire choisie à la main : les
// marques sont détourées en blanc au chargement, et un logo blanc sur un fond
// crème n'existe pas. On les repeint alors de l'encre de la face — c'est une
// silhouette, elle n'a pas de couleur propre à trahir.
function drawMark(ctx, art, key, x, y, boxW, boxH, fallback, ink) {
  let img = art.marks?.[key];
  if (img) {
    if (ink && ink !== "#ffffff") img = tintLogo(img, ink, "always");
    const put = drawFit(ctx, img, x, y, boxW, boxH, 0);
    return put.w;
  }
  return fallback ? fallback() : 0;
}

// Un nombre stable tiré du slug. Le code-barres ne doit PAS changer d'une
// peinture à l'autre : la même jaquette est repeinte en basse définition pour
// le rayon puis en haute pour la vitrine, et deux codes différents sur le même
// boîtier, ça se voit au moment où l'objet s'approche.
function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ------------------------------------------------------------- les marques --

// LE LOGO « DVD VIDEO ». Dessiné, pas importé : c'est une forme simple (une
// ellipse, trois lettres, un bandeau) et la faire à la main évite de traîner un
// fichier dans le paquet pour vingt pixels de haut. Ce n'est pas le logo
// officiel au tracé près — c'en est la SILHOUETTE, et c'est elle qu'on
// reconnaît en bas d'une jaquette sans jamais la lire.
function dvdMark(ctx, x, y, w, ink = "#ffffff") {
  const h = w * 0.62;
  const ovalH = h * 0.66;
  ctx.save();
  ctx.strokeStyle = alpha(ink, 0.72);
  ctx.lineWidth = Math.max(1, w * 0.028);

  // L'ellipse.
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + ovalH / 2, w / 2, ovalH / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // « DVD », en capitales serrées : c'est un monogramme, pas un mot.
  ctx.fillStyle = alpha(ink, 0.95);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(4, Math.round(ovalH * 0.62))}px ${SANS}`;
  ctx.fillText("DVD", x + w / 2, y + ovalH / 2 + ovalH * 0.03);

  // Le bandeau « VIDEO » sous l'ellipse, en négatif.
  const bh = h - ovalH;
  const bw = w * 0.66;
  ctx.fillStyle = alpha(ink, 0.82);
  ctx.fillRect(x + (w - bw) / 2, y + ovalH + bh * 0.16, bw, bh * 0.68);
  ctx.fillStyle = "#0a0b10";
  ctx.font = `700 ${Math.max(3, Math.round(bh * 0.46))}px ${SANS}`;
  trackedText(
    ctx,
    "VIDEO",
    x + w / 2,
    y + ovalH + bh * 0.52,
    Math.max(0.5, bh * 0.1),
    "center"
  );
  ctx.restore();
}

// LA PASTILLE DE ZONE : un disque cerclé, le chiffre au milieu. Sur un vrai
// boîtier c'est un globe stylisé ; à quinze pixels de haut, le globe n'est plus
// qu'une tache — le cercle et le chiffre disent la même chose et se lisent.
function zoneMark(ctx, cx, cy, r, ink = "#ffffff", font = SANS) {
  ctx.save();
  ctx.strokeStyle = alpha(ink, 0.6);
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  // Les deux méridiens : ce qui reste d'un globe quand on n'a plus la place.
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.42, r, 0, 0, Math.PI * 2);
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = alpha(ink, 0.95);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.max(4, Math.round(r * 1.15))}px ${font}`;
  ctx.fillText(ZONE, cx, cy + r * 0.04);
  ctx.restore();
}

// Une mention technique dans son cadre : « 16:9 », « COULEUR », « STÉRÉO ».
// Cerclée et jamais remplie — un aplat clair au milieu d'un pied sombre serait
// la tache la plus voyante de la face, pour la mention la moins importante.
// Rend la largeur occupée : les puces se posent à la suite.
function chip(ctx, x, y, h, text, ink, font = SANS) {
  const size = Math.max(4, Math.round(h * 0.46));
  const track = size * 0.12;
  ctx.font = `700 ${size}px ${font}`;
  const w = trackedWidth(ctx, text, track) + h * 0.72;
  ctx.strokeStyle = alpha(ink, 0.42);
  ctx.lineWidth = Math.max(1, h * 0.05);
  roundRect(ctx, x, y, w, h, h * 0.22);
  ctx.stroke();
  ctx.fillStyle = alpha(ink, 0.86);
  ctx.textBaseline = "middle";
  trackedText(ctx, text, x + w / 2, y + h / 2 + h * 0.02, track, "center");
  return w;
}

// LE CODE-BARRES. La face en avait été privée volontairement : « un faux numéro
// sur un objet qui ne s'achète nulle part, c'est du décor qui ment ». L'argument
// s'est retourné à l'usage — sans lui, le pied du dos est un vide blanc que
// l'œil lit comme une composition inachevée, et c'est précisément ce vide qui
// faisait « fiche imprimée » plutôt que « boîtier ». Le numéro n'est plus tiré
// au hasard : il DÉRIVE DU SLUG, donc il est stable, propre au titre, et ne
// prétend correspondre à rien d'autre qu'à lui.
//
// Le tracé n'encode pas vraiment l'EAN-13 (les tables de parité pour un dessin
// de 60 px de large, c'est du zèle) : ce sont des barres de largeur variable,
// avec les gardes plus hautes aux extrémités et au centre — la silhouette exacte
// d'un code-barres, chiffres compris.
function barcode(ctx, x, y, w, h, seed) {
  const digits = `3${String(seed).padStart(12, "0").slice(-12)}`;
  const quiet = w * 0.06;
  const digitH = h * 0.24;
  const barsH = h - digitH;
  const inner = w - quiet * 2;

  ctx.save();
  // Le papier blanc du code : il lui faut son fond, sinon les barres noires
  // disparaissent dans le pied sombre.
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(x, y, w, h);

  let cx = x + quiet;
  let n = seed;
  const unit = inner / 95; // 95 modules, comme un vrai EAN-13
  let i = 0;
  ctx.fillStyle = "#14151a";
  while (cx < x + w - quiet - unit) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    const width = unit * (1 + (n % 3));
    // Les gardes : début, milieu, fin. Elles descendent plus bas que les
    // autres, et c'est ce détail qui fait qu'on reconnaît un code-barres.
    const guard = i < 3 || Math.abs(cx - (x + w / 2)) < unit * 2;
    if (i % 2 === 0) ctx.fillRect(cx, y, width, barsH + (guard ? digitH * 0.62 : 0));
    cx += width;
    i++;
  }

  ctx.fillStyle = "#14151a";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const size = Math.max(4, Math.round(digitH * 0.8));
  ctx.font = `500 ${size}px ${SANS}`;
  trackedText(
    ctx,
    `${digits.slice(0, 1)} ${digits.slice(1, 7)} ${digits.slice(7)}`,
    x + w / 2,
    y + h - digitH * 0.14,
    size * 0.08,
    "center"
  );
  ctx.restore();
}

// ------------------------------------------------------- ce qui s'imprime --

// Les pistes annoncées, telles qu'on les connaît VRAIMENT : celles relevées à
// l'import (« vf », « vostfr ») d'abord, la langue d'origine de la fiche
// ensuite. Rien n'est déduit — un dos de boîtier qui promet une VF absente est
// pire qu'un dos muet.
const LANG_LABELS = {
  vf: "Français",
  vf1: "Français",
  vf2: "Français",
  vostfr: "VO · ST français",
  va: "Anglais",
  vqc: "Français (QC)",
  vkr: "Coréen",
  vcn: "Chinois",
  fr: "Français",
  en: "Anglais",
  ja: "Japonais",
  ko: "Coréen",
  zh: "Chinois",
  es: "Espagnol",
  de: "Allemand",
  it: "Italien",
  pt: "Portugais",
  ru: "Russe",
};

function audioTracks(media) {
  const from = media.langs?.length ? media.langs : media.language ? [media.language] : [];
  const seen = new Set();
  const out = [];
  for (const raw of from) {
    const label = LANG_LABELS[String(raw).toLowerCase()];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.slice(0, 3).join(", ");
}

// La durée totale annoncée : celle du film, ou celle du coffret entier. Un dos
// de coffret annonce toujours le total — c'est ce qu'on cherche quand on
// retourne la boîte (« j'en ai pour combien de temps ? »).
function totalRuntime(media) {
  if (!media.runtime) return "";
  if (media.kind === "film") return fmtDuration(media.runtime * 60);
  const count = media.episodeCount || 0;
  if (!count) return `${media.runtime} min`;
  return `env. ${fmtDuration(media.runtime * 60 * count)}`;
}

// Le nombre de disques du coffret. Six épisodes par galette, c'est le compte
// d'une édition ordinaire — et c'est une mention de boîtier, pas une donnée de
// fiche : on la déduit, ou l'admin la pose.
function discCount(media) {
  const set = media.caseArt?.discs;
  if (set > 0) return set;
  // Un film d'un seul tenant tient sur une galette ; un diptyque en a deux, une
  // par partie — c'est ainsi que ces éditions se vendent.
  if (media.kind === "film") return Math.max(1, media.episodeCount || 1);
  return Math.max(1, Math.ceil((media.episodeCount || 1) / 6));
}

// LA MENTION D'ÉDITION, celle qui court en tête de couverture. Elle dit ce
// qu'il y a DANS la boîte, et rien d'autre : pas d'« édition collector » ni de
// « version remasterisée » inventées pour faire joli — un boîtier qui ment sur
// son contenu, c'est le premier signe du faux.
function editionLine(media) {
  const set = media.caseArt?.edition?.trim();
  if (set) return upper(set);
  if (media.kind === "film") {
    // Un film n'annonce rien — sauf quand la boîte en contient deux : ce qu'il y
    // a DANS le boîtier, c'est justement l'œuvre entière, ses deux volets.
    const parts = media.episodeCount || 0;
    return parts > 1 ? `L'ŒUVRE COMPLÈTE · ${parts} PARTIES` : "";
  }
  const seasons = media.seasons?.length || 0;
  if (seasons > 1) return `COFFRET · ${seasons} SAISONS`;
  const count = media.episodeCount || 0;
  return count ? `L'INTÉGRALE · ${count} ÉPISODES` : "";
}

// Quel sommaire au dos. « auto » choisit ce que ferait un vrai éditeur : les
// titres d'épisodes tant qu'ils tiennent, les saisons quand la série est trop
// longue, des photos pour un film.
function backMode(media) {
  const wanted = media.caseArt?.summary || "auto";
  const eps = media.caseEpisodes || [];
  const seasons = media.seasons || [];
  if (wanted === "episodes") return eps.length ? "episodes" : "stills";
  if (wanted === "seasons") return seasons.length ? "seasons" : "stills";
  if (wanted === "stills") return "stills";
  if (media.kind !== "series") return "stills";
  if (eps.length && (media.episodeCount || 0) <= MAX_LIST) return "episodes";
  if (seasons.length > 1) return "seasons";
  return "stills";
}

// ------------------------------------------------- désigner une image --
//
// CHAQUE FACE CHOISIT LA SIENNE. Au début, le gabarit décidait seul : l'affiche
// ici, le bandeau là, la première photo au dos. C'était intenable dès qu'on
// regardait vraiment le résultat — telle série a un bandeau superbe et une
// affiche fade, telle autre l'inverse, et sur telle troisième c'est la
// troisième photo qui fait la couverture.
//
// Le réglage n'est PAS une URL mais un DÉSIGNATEUR (« poster », « still:2 ») :
// une adresse enregistrée en base vieillit dès qu'on récupère à nouveau le
// matériel — les photos changent de nom de fichier — alors qu'un rang ne bouge
// pas. Et ça évite de stocker une URL absolue avec le nom d'hôte dedans.
export const IMAGE_SPECS = ["auto", "none", "poster", "backdrop"];

export function pickImage(spec, art) {
  if (!spec || spec === "auto") return null; // à l'appelant de dire son défaut
  if (spec === "none") return "none";
  if (spec === "poster") return art.poster || null;
  if (spec === "backdrop") return art.backdrop || null;
  const still = /^still:(\d+)$/.exec(spec);
  if (still) return art.stills?.[Number(still[1])] || null;
  // Le FONDS : tout ce que le titre a jamais eu comme visuel, désigné par son
  // rang. C'est le seul désignateur qui survive à un rafraîchissement — les
  // autres pointent des cases (« l'affiche du moment ») dont le contenu change.
  const pooled = /^pool:(\d+)$/.exec(spec);
  if (pooled) return art.pool?.[Number(pooled[1])] || null;
  return null;
}

// Le même choix, résolu avec son repli : `auto` et un désignateur qui ne
// ramène rien (une photo effacée depuis) retombent sur la liste de défaut.
function imageFor(spec, art, fallbacks) {
  const got = pickImage(spec, art);
  if (got === "none") return null;
  if (got) return got;
  return fallbacks.find(Boolean) || null;
}

// L'IMAGE DE FOND DE LA COUVERTURE, et la règle la plus utile de ce fichier.
//
// Une affiche PORTE DÉJÀ SON TITRE : elle a été composée pour lui. Y reposer le
// logo par-dessus, c'est écrire le titre deux fois, décalé — le défaut le plus
// voyant qu'on puisse mettre sur une jaquette. Un vrai DVD ne colle d'ailleurs
// pas son affiche sur sa boîte : il compose autour d'une IMAGE de l'œuvre, et
// c'est le bandeau qui s'en rapproche chez nous.
//
// D'où l'automatique : le bandeau QUAND ON A UN LOGO À POSER, l'affiche telle
// quelle sinon. Les deux cas donnent une face avec un titre, et un seul.
function frontImage(media, art) {
  const spec = media.caseArt?.front || "auto";
  const withLogo = art.logo && media.caseArt?.logo !== false;
  const img =
    spec === "auto"
      ? withLogo && art.backdrop
        ? art.backdrop
        : art.poster || art.backdrop
      : imageFor(spec, art, []);
  // « Sur une affiche, on n'écrit rien » : encore faut-il savoir que c'en est
  // une. La comparaison se fait sur l'OBJET image, pas sur le désignateur — un
  // « still » n'est pas une affiche, mais `poster` choisi à la main en est une.
  return { img, poster: !!img && img === art.poster };
}
// ======================================================================
//  LA COUVERTURE
// ======================================================================
// Une image, un logo, une phrase, un pied. Rien d'autre — et surtout pas de
// cadre décoratif : la couverture est la face qu'on voit en entier dans la
// vitrine, tout ce qu'on y pose en trop se remarque immédiatement.
//
//   ┌───────────────────┐
//   │ ─ ÉDITION         │  la mention d'édition, filet court
//   │                   │
//   │      (image)      │  le visuel à fond perdu
//   │                   │
//   │       SAGA        │
//   │      ██LOGO██     │  le logo, POSÉ OÙ ON VEUT (voir logoBox)
//   │     l'accroche    │
//   │───────────────────│
//   │ ⬭DVD  studio  -12 │  le pied administratif
//   └───────────────────┘
//
// SAUF si l'image désignée est une COUVERTURE COMPLÈTE (`frontFull`) : on ne
// compose alors rien du tout. C'est le cas d'une jaquette trouvée toute faite,
// ou dessinée ailleurs — la coller sous notre pied et notre mention d'édition
// serait la gâcher.
export function paintDvdSleeve(media, art, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = inkOf(media);
  const px = (v) => Math.max(1, Math.round(v));
  const pad = w * 0.078;
  const inner = w - pad * 2;
  const { img, poster: onPoster } = frontImage(media, art);
  const F = fontsOf(media);

  // UNE FACE NUE EST UNE COULEUR, PAS UNE AMBIANCE. Quand aucune image ne vient,
  // la couverture est l'aplat choisi dans le studio — servi au pixel près — et
  // tout ce qu'on pose dessus s'y adapte : l'encre du texte bascule au noir sur
  // une couleur claire, l'accent s'assombrit au lieu de s'éclaircir. Sans ça,
  // « choisir sa couleur » voulait dire « choisir parmi les teintes sombres ».
  const flat = !img;
  const bg = flatBg(media);
  const ink = flat ? inkOn(bg) : "#ffffff";
  const accent = flat ? flatAccent(bg) : accentInk(color);
  const W = (a) => alpha(ink, a);

  // --- Le fond, à fond perdu. Le champ en dessous rattrape le débord d'un
  //     bandeau paysage recadré en portrait.
  ctx.drawImage(
    makeField(w, h, color, img, { cover: true, light: 0.7, veil: 0.2, bg }),
    0,
    0
  );
  if (img) drawCover(ctx, img, 0, 0, w, h, 0.5, imageAnchor(media, "front"));

  // UNE COUVERTURE COMPLÈTE SE POSE ET ON N'Y TOUCHE PAS. C'est tout l'intérêt
  // d'en déposer une : elle a été composée ailleurs, avec son titre, ses
  // mentions et son pied. Le grain du papier est la seule chose qu'on ajoute.
  if (media.caseArt?.frontFull && img) {
    grain(ctx, w, h, 0.03);
    return canvas;
  }

  // --- Le voile du bas, ET RIEN QUE LE BAS. Un voile ne sert qu'à porter le
  //     texte qui vient dessus : il commence là où le texte commence, et il
  //     s'arrête à ce qu'il faut pour qu'un blanc passe — pas au noir.
  if (!flat) {
    const scrim = ctx.createLinearGradient(0, h * 0.46, 0, h);
    scrim.addColorStop(0, "rgba(6,7,11,0)");
    scrim.addColorStop(0.45, "rgba(6,7,11,0.4)");
    scrim.addColorStop(0.82, "rgba(6,7,11,0.78)");
    scrim.addColorStop(1, "rgba(6,7,11,0.88)");
    ctx.fillStyle = scrim;
    ctx.fillRect(0, h * 0.46, w, h * 0.54);
  }

  // ------------------------------------------------------------- la tête --
  const edition = editionLine(media);
  if (edition) {
    if (!flat) {
      const top = ctx.createLinearGradient(0, 0, 0, h * 0.14);
      top.addColorStop(0, "rgba(6,7,11,0.5)");
      top.addColorStop(1, "rgba(6,7,11,0)");
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, w, h * 0.14);
    }
    ctx.textBaseline = "middle";
    ctx.fillStyle = alpha(accent, 0.95);
    const fit = fitTracked(
      ctx,
      edition,
      inner - w * 0.05,
      (s) => `700 ${s}px ${F.text}`,
      px(w * 0.03),
      px(w * 0.02),
      0.22
    );
    trackedText(ctx, fit.text, pad, h * 0.052, fit.track);
    rule(ctx, pad, h * 0.072, inner * 0.34, alpha(accent, 0.5), px(h * 0.0022));
  }

  // ------------------------------------------- le pied, posé avant le titre --
  // Le pied est une bande de hauteur FIXE, et c'est lui qui borne le titre.
  // Poser le titre d'abord, c'était le laisser descendre dans le pied dès qu'il
  // était long, et le rattraper à coups de marges au jugé.
  const bandH = h * 0.082;
  const bandY = h - bandH;
  ctx.fillStyle = flat ? W(0.08) : "rgba(6,7,11,0.66)";
  ctx.fillRect(0, bandY, w, bandH);
  rule(ctx, 0, bandY, w, W(0.16), px(h * 0.0012));

  const markW = w * 0.15;
  drawMark(
    ctx,
    art,
    supportMark(media),
    pad,
    bandY + bandH * 0.2,
    markW,
    bandH * 0.6,
    () => dvdMark(ctx, pad, bandY + (bandH - markW * 0.62) / 2, markW, ink),
    ink
  );

  // Le visa d'âge, à droite du pied : cerclé, jamais rempli.
  let rightX = w - pad;
  if (media.certification) {
    const label =
      media.certification.length > 4 ? upper(media.certification) : media.certification;
    const vSize = px(label.length > 4 ? w * 0.024 : w * 0.036);
    ctx.font = `700 ${vSize}px ${F.text}`;
    const vw = Math.max(w * 0.082, ctx.measureText(label).width + w * 0.044);
    const vh = bandH * 0.56;
    ctx.strokeStyle = W(0.5);
    ctx.lineWidth = px(w * 0.0026);
    roundRect(ctx, rightX - vw, bandY + (bandH - vh) / 2, vw, vh, w * 0.008);
    ctx.stroke();
    ctx.fillStyle = W(0.92);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rightX - vw / 2, bandY + bandH / 2 + h * 0.001);
    ctx.textAlign = "left";
    rightX -= vw + w * 0.03;
  }

  // La marque du studio, au centre du pied.
  const studio = art.studios?.[0];
  if (studio) {
    const room = rightX - (pad + markW + w * 0.05);
    if (room > w * 0.1) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      const mark = ink === "#ffffff" ? studio : tintLogo(studio, ink, "always");
      drawFit(ctx, mark, pad + markW + w * 0.05, bandY + bandH * 0.28, room, bandH * 0.44, 0);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ le titre --
  const logo = frontLogo(media, art, ink);
  const bareposter = onPoster && !logo;

  // LE LOGO SE PLACE À LA MAIN. Le premier jet le collait au-dessus du pied,
  // centré, et c'était réglé — sauf que le bon endroit dépend entièrement de
  // l'image dessous : un visuel avec un ciel en haut veut son logo en haut, un
  // gros plan veut le sien tout en bas. Trois curseurs (x, y, taille) suffisent
  // à s'en sortir, et rendent enfin la face composable.
  if (logo) {
    const boxW = inner * (media.caseArt?.logoSize ?? 100) / 100;
    const boxH = h * 0.2 * ((media.caseArt?.logoSize ?? 100) / 100);
    const cx = (w * (media.caseArt?.logoX ?? 50)) / 100;
    const cy = (h * (media.caseArt?.logoY ?? 72)) / 100;
    drawFit(ctx, logo, cx - boxW / 2, cy - boxH / 2, boxW, boxH);
  }

  // L'accroche et la saga se rangent AUTOUR du logo quand il y en a un, et
  // prennent sa place quand il n'y en a pas.
  let base = logo
    ? Math.min(bandY - h * 0.03, (h * (media.caseArt?.logoY ?? 72)) / 100 + h * 0.115)
    : bandY - h * 0.055;

  if (!logo && !bareposter) {
    const size = px(media.title.length > 26 ? w * 0.098 : w * 0.135);
    ctx.font = `600 ${size}px ${F.title}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const lines = wrapText(ctx, media.title, inner * 0.96, 3);
    let ty = base - (lines.length - 1) * size * 1.1;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = px(w * 0.045);
    ctx.shadowOffsetY = px(h * 0.004);
    ctx.fillStyle = ink;
    for (const line of lines) {
      ctx.fillText(line, w / 2, ty);
      ty += size * 1.1;
    }
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    base -= (lines.length - 1) * size * 1.1 + size * 1.05;
    ctx.textAlign = "left";
  }

  // L'accroche, sous le bloc de titre — et jamais dans le pied : `base` a été
  // borné plus haut pour ça (un logo poussé tout en bas par les curseurs ne doit
  // pas emmener l'accroche avec lui par-dessus le code du support).
  if (media.tagline && !bareposter) {
    const gSize = px(w * 0.036);
    ctx.font = `italic 500 ${gSize}px ${F.title}`;
    ctx.fillStyle = W(0.82);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let ty = base;
    for (const line of wrapText(ctx, media.tagline, inner * 0.94, 2)) {
      if (ty > bandY - h * 0.012) break;
      ctx.fillText(line, w / 2, ty);
      ty += gSize * 1.26;
    }
    ctx.textAlign = "left";
  }

  grain(ctx, w, h, 0.032);
  return canvas;
}

// ======================================================================
//  LE DOS
// ======================================================================
// La face la plus dense de l'objet, et la plus lue : c'est elle qu'on regarde
// en tenant le boîtier. Elle se compose en BANDES, du bas vers le haut — le
// pied administratif est posé en premier, le sommaire ensuite, et le résumé
// prend ce qui reste.
//
// ON MET TOUT CE QU'ON A. C'est la règle, et elle a remplacé un « ou bien » qui
// ne tenait pas debout : le dos montrait le sommaire OU les photos, jamais les
// deux, si bien qu'un coffret de série n'avait aucune image et qu'un film
// n'avait aucun texte. Un vrai dos de DVD porte les trois — un résumé court,
// des photos, la liste de ce qu'il y a dans la boîte — et c'est justement leur
// empilement qui le rend crédible.
//
// Ce qui ne rentre pas se retire dans un ORDRE FIXE (le résumé raccourcit, puis
// les photos partent, puis le sommaire se resserre), pour qu'une face trop
// pleine reste composée au lieu de se marcher dessus.
//
//   ┌──────────────────────┐
//   │       (photo)        │  une image de l'œuvre, coupée net
//   │  ██LOGO██            │
//   │  SÉRIE · 2011 · …    │
//   │  résumé court…       │
//   │  ▭ ▭ ▭               │  trois photos
//   │  ── AU SOMMAIRE ──   │
//   │  1 Titre   7 Titre   │
//   │  ─────────────       │
//   │  ▭16:9 ▭COULEUR ⬤2   │
//   │  studio        ▮▯▮▯  │
//   └──────────────────────┘
export function paintDvdBack(media, art, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = inkOf(media);
  const px = (v) => Math.max(1, Math.round(v));
  const pad = w * 0.075;
  const inner = w - pad * 2;
  const bg = flatBg(media);
  const F = fontsOf(media);

  const shot = imageFor(media.caseArt?.back, art, [
    art.stills?.[0],
    art.backdrop,
    art.poster,
  ]);

  // LE FOND DU DOS EST UN APLAT, PAS UNE PHOTO FLOUE. Il a longtemps été le
  // bandeau du titre agrandi, flouté et noyé de nuit : ça donnait une bouillie
  // brunâtre derrière le texte, et surtout un RACCORD VISIBLE avec la photo
  // nette du haut — deux versions de la même image l'une sur l'autre, l'une
  // piquée, l'autre baveuse. Un vrai dos de DVD est d'une couleur unie sombre,
  // avec une bande photo posée dessus. C'est plus net, et c'est plus juste.
  ctx.fillStyle = bg || shade(color, -0.86);
  ctx.fillRect(0, 0, w, h);

  const ink = inkOn(bg || shade(color, -0.86));
  const accent = bg ? flatAccent(bg) : accentInk(color);
  const W = (a) => alpha(ink, a);
  const HAIR = W(0.14);

  // UNE COUVERTURE COMPLÈTE POUR LE DOS AUSSI : un dos trouvé tout fait se pose
  // tel quel, sans qu'on écrive rien dessus.
  if (media.caseArt?.backFull && shot) {
    drawCover(ctx, shot, 0, 0, w, h, 0.5, imageAnchor(media, "back"));
    grain(ctx, w, h, 0.03);
    return canvas;
  }

  // ------------------------------------------------------- la photo de tête --
  // Coupée NET, et soulignée d'un filet. Elle se fondait avant dans le fond par
  // un dégradé : sur un aplat, ce dégradé n'a plus lieu d'être, et une bande
  // franche se lit comme un choix de maquette plutôt que comme un raccord raté.
  const headH = shot ? h * 0.2 : 0;
  if (headH) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, headH);
    ctx.clip();
    drawCover(ctx, shot, 0, 0, w, headH, 0.5, imageAnchor(media, "back"));
    // Un dernier tiers assombri : la bande finit dans la couleur du fond, donc
    // la coupe ne fait pas « photo collée ».
    const foot = ctx.createLinearGradient(0, headH * 0.55, 0, headH);
    foot.addColorStop(0, "rgba(0,0,0,0)");
    foot.addColorStop(1, alpha(bg || shade(color, -0.86), 0.92));
    ctx.fillStyle = foot;
    ctx.fillRect(0, headH * 0.55, w, headH * 0.45);
    ctx.restore();
    rule(ctx, 0, headH, w, W(0.18), px(h * 0.0014));
  }

  // ============================ LE PIED, POSÉ EN PREMIER =====================

  const bottom = h - pad * 0.6;
  const barW = w * 0.3;
  const barH = h * 0.052;
  if (media.caseArt?.barcode !== false) {
    barcode(ctx, w - pad - barW, bottom - barH, barW, barH, hashOf(media.slug || media.title));
  }

  const footCy = bottom - barH / 2;
  let footX = pad;
  const studio = art.studios?.[0];
  if (studio) {
    ctx.save();
    ctx.globalAlpha = 0.68;
    const mark = ink === "#ffffff" ? studio : tintLogo(studio, ink, "always");
    const put = drawFit(ctx, mark, footX, footCy - barH * 0.34, w * 0.2, barH * 0.68, 0);
    ctx.restore();
    footX = put.x + put.w + w * 0.035;
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const markTrack = px(w * 0.016);
  ctx.font = `600 ${px(w * 0.028)}px ${F.title}`;
  ctx.fillStyle = W(0.72);
  trackedText(ctx, "MYPLAYLOG", footX, footCy - barH * 0.24, markTrack);

  const licence = LICENCES[media.licence]?.label?.toUpperCase() || "";
  if (licence) {
    ctx.fillStyle = alpha(accent, 0.72);
    const fit = fitTracked(
      ctx,
      licence,
      w - pad - barW - footX - w * 0.05,
      (s) => `700 ${s}px ${F.text}`,
      px(w * 0.018),
      px(w * 0.012),
      0.4
    );
    trackedText(ctx, fit.text, footX, footCy + barH * 0.3, fit.track);
  }

  // ------------------------------------------------ le cartouche technique --
  const footRule = bottom - barH - h * 0.028;
  rule(ctx, pad, footRule, inner, HAIR, px(h * 0.0014));

  const chipH = h * 0.032;
  const chipsY = footRule - h * 0.026 - chipH;
  let chipX = pad;
  const chips = [
    { key: "widescreen", text: RATIO_MARK },
    { key: null, text: "COULEUR" },
    audioTracks(media) ? { key: "audio", text: "STÉRÉO" } : null,
  ].filter(Boolean);
  for (const c of chips) {
    const used = c.key
      ? drawMark(
          ctx,
          art,
          c.key,
          chipX,
          chipsY,
          w * 0.14,
          chipH,
          () => chip(ctx, chipX, chipsY, chipH, c.text, ink, F.text),
          ink
        )
      : chip(ctx, chipX, chipsY, chipH, c.text, ink, F.text);
    chipX += used + w * 0.022;
  }
  drawMark(
    ctx,
    art,
    "zone",
    chipX,
    chipsY,
    chipH * 1.1,
    chipH,
    () => zoneMark(ctx, chipX + chipH * 0.5, chipsY + chipH / 2, chipH * 0.5, ink, F.text),
    ink
  );

  const discs = discCount(media);
  if (discs > 1) {
    ctx.font = `700 ${px(w * 0.023)}px ${F.text}`;
    ctx.fillStyle = W(0.62);
    ctx.textBaseline = "middle";
    trackedText(ctx, `${discs} DISQUES`, w - pad, chipsY + chipH / 2, px(w * 0.009), "right");
  }

  const facts = [];
  if (media.kind === "series" && media.episodeCount)
    facts.push([
      "Épisodes",
      media.runtime ? `${media.episodeCount} × ${media.runtime} min` : `${media.episodeCount}`,
    ]);
  const duration = totalRuntime(media);
  if (duration) facts.push([media.kind === "film" ? "Durée" : "Durée totale", duration]);
  const langs = audioTracks(media);
  if (langs) facts.push(["Langues", langs]);
  if (media.rating) facts.push(["Note", `${String(media.rating).replace(".", ",")} / 10`]);
  if (media.network && facts.length < 4) facts.push(["Diffusion", media.network]);
  if (media.studio && facts.length < 4) facts.push(["Réalisation", media.studio]);
  facts.length = Math.min(facts.length, 4);

  const rows = Math.ceil(facts.length / 2);
  const rowH = h * 0.05;
  const factsBottom = chipsY - h * 0.026;
  const factsTop = factsBottom - rows * rowH;
  if (facts.length) {
    const colW = inner / 2;
    facts.forEach(([label, value], i) => {
      const cx = pad + (i % 2) * colW;
      const top = factsTop + Math.floor(i / 2) * rowH;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = `700 ${px(w * 0.02)}px ${F.text}`;
      ctx.fillStyle = alpha(accent, 0.85);
      trackedText(ctx, upper(label), cx, top + h * 0.015, px(w * 0.008));
      const vSize = px(w * 0.029);
      ctx.font = `600 ${vSize}px ${F.text}`;
      ctx.fillStyle = W(0.92);
      ctx.fillText(
        fitOneLine(ctx, value, colW - w * 0.04, (s) => `600 ${s}px ${F.text}`, vSize, px(w * 0.02)),
        cx,
        top + h * 0.04
      );
    });
  }

  // ====================== LA TÊTE, MESURÉE AVANT D'ÊTRE ÉCRITE ===============
  // Il faut savoir OÙ elle s'arrête avant de répartir ce qui suit. On la pose
  // donc tout de suite, et on retient sa fin.
  let y = headH + h * 0.05;

  const logo = frontLogo(media, art, ink);
  if (logo) {
    const put = drawFit(ctx, logo, pad, y - h * 0.012, inner * 0.55, h * 0.075, 0);
    y = put.y + put.h + h * 0.026;
  } else {
    let tSize = px(w * 0.09);
    ctx.font = `600 ${tSize}px ${F.title}`;
    if (ctx.measureText(media.title).width > inner) {
      tSize = px(w * 0.07);
      ctx.font = `600 ${tSize}px ${F.title}`;
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = ink;
    for (const line of wrapText(ctx, media.title, inner, 2)) {
      ctx.fillText(line, pad, y + tSize * 0.75);
      y += tSize * 1.08;
    }
    y += h * 0.006;
  }

  const stamp = [
    media.kind === "film" ? "FILM" : "SÉRIE",
    fmtYears(media),
    ...(media.genres || []).slice(0, 2).map(upper),
  ]
    .filter(Boolean)
    .join("   ·   ");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = W(0.55);
  const stampFit = fitTracked(
    ctx,
    stamp,
    inner,
    (s) => `700 ${s}px ${F.text}`,
    px(w * 0.021),
    px(w * 0.016),
    0.42
  );
  trackedText(ctx, stampFit.text, pad, y, stampFit.track);
  y += h * 0.026;

  if (media.tagline) {
    const gSize = px(w * 0.032);
    ctx.font = `italic 500 ${gSize}px ${F.title}`;
    ctx.fillStyle = alpha(accent, 0.92);
    for (const line of wrapText(ctx, media.tagline, inner * 0.94, 1)) {
      ctx.fillText(line, pad, y + gSize * 0.8);
      y += gSize * 1.2;
    }
  }

  // ===================== LE PARTAGE DE CE QUI RESTE ==========================
  // Une seule hauteur à distribuer entre trois blocs qui la veulent tous. Ils
  // se servent dans cet ordre, et c'est l'inverse qui se retire quand ça coince :
  //
  //   1. LE SOMMAIRE — c'est la raison d'être du dos d'un coffret ;
  //   2. LES PHOTOS  — trois vignettes, ou rien (deux, ça fait dépareillé) ;
  //   3. LE RÉSUMÉ   — le plus élastique des trois : il prend ce qui reste,
  //                    entre deux et six lignes, et disparaît sous deux.
  const room = (facts.length ? factsTop : factsBottom) - h * 0.028 - y;
  const mode = backMode(media);

  const shots = backShots(media, art);
  const gap = w * 0.016;
  const tw = (inner - gap * 2) / 3;
  const th = (tw * 9) / 16;

  const eps = mode === "episodes" ? (media.caseEpisodes || []).slice(0, MAX_LIST) : [];
  const seasons = mode === "seasons" ? (media.seasons || []).slice(0, 8) : [];
  const listRows = eps.length ? Math.ceil(eps.length / 2) : seasons.length;
  const listMin = listRows ? listRows * h * 0.0175 + h * 0.04 : 0;
  const listWant = listRows
    ? listRows * (eps.length ? h * 0.0235 : h * 0.031) + h * 0.04
    : 0;

  const lineSize = px(w * 0.03);
  const lineH = lineSize * 1.5;

  // On sert le minimum vital à chacun, puis on redistribue le reste dans
  // l'ordre de priorité. Un bloc qui n'a même pas son minimum ne s'affiche pas.
  let left = room;
  const showList = listRows > 0 && left >= listMin;
  if (showList) left -= listMin;
  const showShots = shots.length >= 3 && left >= th + h * 0.02;
  if (showShots) left -= th + h * 0.02;

  const summaryLines = Math.max(0, Math.min(6, Math.floor((left - h * 0.01) / lineH)));
  const showSummary = media.synopsis && summaryLines >= 2;
  if (showSummary) left -= summaryLines * lineH + h * 0.01;

  // Ce qui reste après le minimum de chacun revient au sommaire : c'est lui qui
  // respire le mieux, et un sommaire aéré est ce qui distingue un coffret d'une
  // liste imprimée à l'économie.
  const listH = showList ? Math.min(listWant, listMin + Math.max(0, left)) : 0;

  if (showSummary) {
    ctx.font = `400 ${lineSize}px ${F.text}`;
    ctx.fillStyle = W(0.76);
    for (const line of wrapText(ctx, media.synopsis, inner, summaryLines)) {
      ctx.fillText(line, pad, y + lineSize * 0.8);
      y += lineH;
    }
    y += h * 0.01;
  }

  if (showShots) {
    const radius = w * 0.006;
    for (let i = 0; i < 3; i++) {
      const x = pad + i * (tw + gap);
      ctx.save();
      roundRect(ctx, x, y, tw, th, radius);
      ctx.clip();
      drawCover(ctx, shots[i], x, y, tw, th);
      ctx.restore();
      ctx.strokeStyle = W(0.22);
      ctx.lineWidth = px(w * 0.002);
      roundRect(ctx, x, y, tw, th, radius);
      ctx.stroke();
    }
    y += th + h * 0.02;
  }

  if (showList) {
    const listGap = w * 0.03;
    const headRoom = h * 0.04;
    drawHeading(
      ctx,
      eps.length ? "AU SOMMAIRE" : "LE COFFRET",
      pad,
      y,
      inner,
      accent,
      w,
      h,
      HAIR,
      F.text
    );
    const bodyTop = y + headRoom;
    const bodyH = listH - headRoom;

    if (eps.length) {
      const step = bodyH / listRows;
      const colW = (inner - listGap) / 2;
      const numSize = px(Math.min(w * 0.021, step * 0.78));
      const txtSize = px(Math.min(w * 0.0235, step * 0.86));
      eps.forEach((ep, i) => {
        const col = Math.floor(i / listRows);
        const rowAt = i % listRows;
        const x = pad + col * (colW + listGap);
        const ly = bodyTop + rowAt * step + step * 0.72;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `700 ${numSize}px ${F.text}`;
        ctx.fillStyle = alpha(accent, 0.9);
        ctx.fillText(String(ep.n).padStart(2, "0"), x, ly);
        const numW = ctx.measureText("00").width + w * 0.014;
        ctx.font = `500 ${txtSize}px ${F.text}`;
        ctx.fillStyle = W(0.8);
        ctx.fillText(
          fitOneLine(
            ctx,
            ep.t || `Épisode ${ep.n}`,
            colW - numW,
            (s) => `500 ${s}px ${F.text}`,
            txtSize,
            px(w * 0.017)
          ),
          x + numW,
          ly
        );
      });
    } else {
      const step = bodyH / Math.max(1, seasons.length);
      seasons.forEach((s, i) => {
        const ly = bodyTop + i * step + step * 0.72;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.font = `700 ${px(w * 0.024)}px ${F.text}`;
        ctx.fillStyle = alpha(accent, 0.9);
        trackedText(ctx, `SAISON ${s.number}`, pad, ly, px(w * 0.006));
        ctx.font = `500 ${px(w * 0.024)}px ${F.text}`;
        ctx.fillStyle = W(0.78);
        const tail = [
          s.name && s.name !== `Saison ${s.number}` ? s.name : "",
          `${s.episodeCount} épisodes`,
          s.year || "",
        ]
          .filter(Boolean)
          .join("  ·  ");
        ctx.fillText(
          fitOneLine(
            ctx,
            tail,
            inner - w * 0.24,
            (s2) => `500 ${s2}px ${F.text}`,
            px(w * 0.024),
            px(w * 0.018)
          ),
          pad + w * 0.24,
          ly
        );
      });
    }
  }

  grain(ctx, w, h, 0.035);
  return canvas;
}

// L'intitulé d'un bloc : deux petites capitales et un filet qui court jusqu'au
// bord. Le filet part APRÈS le mot et va jusqu'à la marge — c'est ce qui donne
// à la ligne son air de titre courant plutôt que d'étiquette.
function drawHeading(ctx, text, x, y, width, accent, w, h, hair, font = SANS) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const size = Math.max(1, Math.round(w * 0.02));
  ctx.font = `700 ${size}px ${font}`;
  ctx.fillStyle = alpha(accent, 0.9);
  const track = Math.max(1, Math.round(w * 0.01));
  const used = trackedText(ctx, text, x, y + size * 0.4, track);
  rule(
    ctx,
    x + used + w * 0.022,
    y + size * 0.1,
    width - used - w * 0.022,
    hair || "rgba(255,255,255,0.13)",
    Math.max(1, Math.round(h * 0.0012))
  );
}

// La TRANCHE d'un boîtier vidéo porte le logo quand il existe : c'est ce qu'on
// voit dans le rayon, et un logo tourné à la verticale se reconnaît de bien
// plus loin qu'un titre composé. Rendu vrai/faux : la tranche retombe sur sa
// didone quand il n'y a pas de logo, ou qu'il est trop large pour la course
// disponible (un logo écrasé est pire qu'un titre bien posé).
export function paintSpineLogo(ctx, logo, midX, top, run, spineW) {
  if (!logo) return false;
  const ratio = logo.width / logo.height;

  // PIÈGE CORRIGÉ — LE LOGO NE S'AFFICHAIT JAMAIS. Le premier jet exigeait que
  // le logo REMPLISSE au moins 35 % de la course une fois tourné, sinon il
  // rendait la main à la didone. Or une tranche de DVD fait 55 px de large pour
  // 620 de haut : à 62 % de la largeur, un logo au rapport habituel (3 ou 4
  // pour 1) mesure une centaine de pixels de long contre une course de 340 —
  // il échouait au test à tous les coups, sur tous les titres.
  //
  // Le seuil était de toute façon une mauvaise idée : un logo de tranche EST
  // court, c'est même à ça qu'on le reconnaît sur une étagère. On le pose donc
  // centré, aussi grand que la tranche le permet, et on ne refuse plus que
  // l'absurde (un logo si étiré qu'il déborderait de la course).
  const boxH = spineW * 0.74;
  const drawW = boxH * ratio;
  if (drawW > run) return false;

  ctx.save();
  ctx.translate(midX, top + run / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(logo, -drawW / 2, -boxH / 2, drawW, boxH);
  ctx.restore();
  return true;
}

// LA MARQUE DE SUPPORT EN PIED DE TRANCHE. Sur une étagère de DVD, c'est ce
// petit logo répété d'un bout à l'autre de la rangée qui dit « ceci est une
// collection » — bien avant qu'on ait lu un seul titre. Il remplace le losange
// qui tenait cette place faute de mieux.
export function paintSpineMark(ctx, art, media, midX, cy, spineW, ink) {
  let img = art.marks?.[supportMark(media)];
  if (img && ink && ink !== "#ffffff") img = tintLogo(img, ink, "always");
  const boxH = spineW * 0.52;
  if (!img) return false;
  const ratio = img.width / img.height;
  const drawW = boxH * ratio;
  ctx.save();
  ctx.translate(midX, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(img, -drawW / 2, -boxH / 2, drawW, boxH);
  ctx.restore();
  return true;
}

