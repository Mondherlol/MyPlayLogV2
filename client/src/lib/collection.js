// ======================================================================
//  Collection — repères d'affichage et peinture des boîtiers
// ======================================================================
// Deux vues montrent les mêmes objets : le rayonnage 3D (boîtiers debout,
// TRANCHE vers nous, comme dans un vrai vidéoclub) et la grille 2D (jaquettes
// CSS). Les libellés, la mise en forme des durées et le dessin des boîtiers
// vivent donc ici, pour que les deux racontent la même chose.
//
// Le dessin passe par un <canvas> : c'est la seule façon de peindre une
// jaquette sur une face de boîte WebGL. Et comme le rayonnage montre les
// tranches, c'est la TRANCHE qui reçoit le plus de soin — capuchon de format
// en haut, titre à la verticale, bandeau d'année en bas, plis de carton sur
// les arêtes. C'est elle qu'on lit, pas l'affiche.

// Un seul support pour l'instant. Le champ `format` reste en base (un jour il y
// aura peut-être des cartouches ou des Blu-ray), mais l'interface n'offre plus
// de choix : tout est en boîtier DVD.
export const FORMATS = {
  dvd: { label: "DVD", hint: "Boîtier DVD" },
  // Le papier a son support. Sans cette entrée, un manga retombait sur le
  // gabarit DVD et s'annonçait « DVD » jusque sur sa propre fiche.
  book: { label: "Volume", hint: "Volume broché" },
  // Et le jeu le sien : la boîte de cartouche GBA, étroite et deux fois plus
  // épaisse qu'un DVD. C'est la SEULE chose qui le distingue de loin sur
  // l'étagère, avant même qu'on ait lu sa tranche.
  gba: { label: "Cartouche", hint: "Boîte de jeu Game Boy Advance" },
};

// La machine du rayon jeu, écrite une fois. Elle s'imprime sur la tranche du
// boîtier, à son dos, dans la bulle de l'étagère, sur la carte de la grille et
// sur la fiche : recopiée à la main dans six fichiers, elle finissait par ne
// plus dire partout la même chose.
export const CONSOLE = "Game Boy Advance";

// La provenance, assumée sur la jaquette : on ne range sur l'étagère que ce
// qui se regarde librement là où c'est hébergé.
export const LICENCES = {
  official: { label: "Officiel", hint: "Mis en ligne par l'ayant droit" },
  "public-domain": { label: "Domaine public", hint: "Œuvre du domaine public" },
  fan: { label: "Fan-trad", hint: "Version de fans, jamais éditée en France" },
};

export const KINDS = {
  series: { label: "Série", plural: "Séries" },
  film: { label: "Film", plural: "Films" },
  comic: { label: "Comic", plural: "Comics & mangas" },
  game: { label: "Jeu", plural: "Jeux GBA" },
};

// Un titre de papier se LIT : pages, lecteur, progression en planches. Le test
// vit ici plutôt que d'être réécrit dans chaque composant — c'est la bascule la
// plus fréquente de toute la section.
export const isComic = (media) => media?.kind === "comic";

// LE SENS DE LECTURE N'APPARTIENT QU'AU PAPIER, et ce test-ci existe parce que
// la donnée, elle, ne le sait pas : `readDirection` est un champ de la fiche
// comme un autre, et il SURVIT à un changement de nature. Un titre entré comme
// manga puis rebasculé en film garde son « rtl » — plus rien ne l'affiche, mais
// la scène 3D, elle, s'en sert pour décider de quel côté présenter l'objet, et
// le film se retournait donc à l'envers.
//
// Aucun composant ne lit donc `readDirection` en direct : un boîtier de DVD n'a
// pas de sens de lecture, quelle qu'ait été sa vie d'avant.
export const isRtl = (media) => isComic(media) && media?.readDirection === "rtl";

// ------------------------------------------------------- les doubles pages --
//
// UNE DOUBLE PAGE SE RECONNAÎT AUX AUTRES, PAS DANS L'ABSOLU. Un scan qui tient
// sur deux pages fait très exactement le double de large — mais « le double de
// quoi » dépend du volume : tel manga est scanné en 0,68, tel comic en 0,74, et
// un album à l'italienne monte à 0,9 sans qu'aucune de ses planches ne soit
// double. Le seul repère qui vaille est donc la planche COURANTE du titre, sa
// médiane, à laquelle on compare tout le reste.
//
// Le seuil est posé à mi-chemin (1,5 fois la médiane) : au-delà il n'y a plus
// rien qui puisse être une planche simple, en deçà on couperait en deux des
// planches qui n'ont qu'une marge un peu large. Et il ne descend jamais sous
// 1,2 : une planche plus large que haute n'est simple dans aucun format.
//
// Renvoie un TEST, pas un booléen : la médiane se calcule une fois pour tout le
// volume, et les deux lecteurs (le volume 3D et la lecture à plat) doivent
// répondre exactement la même chose sur la même planche — sans quoi la
// pagination saute au changement de mode.
export function spreadTest(pages) {
  const limit = Math.max(1.2, pageRatio(pages) * 1.5);
  return (p) => p?.w > 0 && p?.h > 0 && p.w / p.h >= limit;
}

// LE FORMAT DE PAGE DU VOLUME — la médiane de ses planches, et 0 si aucune ne
// porte ses dimensions.
//
// Un volume n'a qu'UN format de page : le papier est coupé au massicot, toutes
// ses pages font la même taille. Les scans, eux, varient de quelques pixels —
// un cadrage refait à la main, une marge rognée de travers. Dimensionner chaque
// page sur SON scan, c'est une hauteur de page qui change d'une planche à
// l'autre : un décrochement au pli entre les deux pages, et une feuille qui se
// pose à une taille différente de celle qu'elle recouvrait.
//
// La médiane est le bon repère : insensible aux doubles pages (deux fois plus
// larges) comme aux planches mal rognées, du moment qu'elles sont minoritaires.
// Les écarts de quelques pour cent se rattrapent ensuite au placage — la
// planche est plaquée sur la page, pas la page taillée sur la planche.
export function pageRatio(pages) {
  const ratios = (pages || [])
    .map((p) => (p?.w > 0 && p?.h > 0 ? p.w / p.h : 0))
    .filter(Boolean)
    .sort((a, b) => a - b);
  return ratios.length ? ratios[ratios.length >> 1] : 0;
}

// Un jeu SE JOUE : pas d'épisodes, pas de planches, pas de position à
// reprendre — une cartouche, une console, et du temps passé dessus. Même règle
// que pour le papier : le test vit ici, pas recopié dans six composants.
export const isGame = (media) => media?.kind === "game";

// Les trois natures de lecteur. `piloted` dit si l'on tient VRAIMENT la lecture
// (position, pause, volume) : c'est ce qui décide de la barre du bas, puisqu'un
// rail de progression sur un lecteur qu'on ne pilote pas est un mensonge — la
// visionneuse ne l'affiche donc pas du tout (voir CollectionViewer).
export const PROVIDERS = {
  youtube: { label: "YouTube", hint: "Lecteur YouTube", piloted: true },
  file: {
    label: "Fichier vidéo",
    hint: "Lien direct vers une vidéo (mp4, webm, m3u8)",
    piloted: true,
  },
  embed: {
    label: "Lecteur externe",
    hint: "Le lecteur du site d'origine, dans un cadre",
    piloted: false,
  },
};

// ------------------------------------------------------------- le lecteur --
//
// IL Y A EU DEUX DÉCORS, PUIS PLUS AUCUN. Un poste cathodique à molettes, une
// salle de projection à rideau, et un réglage `theater` sur chaque fiche pour
// choisir entre les deux. Tout est retiré, et la leçon vaut d'être écrite parce
// qu'elle est contre-intuitive : ON NE REGARDE PAS UN DÉCOR, ON REGARDE
// L'IMAGE. Le tube imposait en plus un cadre 4/3 qui ROGNAIT les lecteurs
// tiers — un décor qui coupe le film qu'il entoure a perdu d'avance.
//
// Ne pas les retenter. Ce qui reste (voir CollectionViewer) : l'image au
// centre, un titre en haut, une barre en bas.
//
// Les sources d'un épisode, dans l'ordre : la principale puis ses miroirs.
// Un épisode d'avant les lecteurs multiples n'a qu'un videoId — il reste
// lisible sans migration.
export function episodeSources(ep) {
  if (!ep) return [];
  const provider = ep.provider || (ep.videoId ? "youtube" : "embed");
  const main = {
    provider,
    videoId: ep.videoId || null,
    // UNE SOURCE A TOUJOURS UNE ADRESSE, même une vidéo YouTube qui n'est
    // enregistrée que par son identifiant : c'est elle qui donne le NOM D'HÔTE,
    // et le nom d'hôte est ce qui identifie un lecteur d'un bout à l'autre de
    // l'application — l'étoile du lecteur par défaut, la suppression d'un
    // hébergeur mort, le décompte du vérificateur de liens. Sans elle, YouTube
    // était le seul lecteur qu'on ne pouvait ni retenir ni retirer.
    url:
      ep.url ||
      (provider === "youtube" && ep.videoId
        ? `https://www.youtube.com/watch?v=${ep.videoId}`
        : ""),
    // L'étiquette, elle, reste le nom d'usage : « YouTube », pas
    // « youtube.com ».
    label: ep.url ? hostOf(ep.url) : "YouTube",
  };
  return [
    main,
    ...(ep.mirrors || []).map((m) => ({
      provider: "embed",
      videoId: null,
      url: m.url,
      label: m.label || hostOf(m.url),
    })),
  ];
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

// Dimensions du boîtier DEBOUT, tranche face à nous (unités du monde, à
// l'échelle d'environ 1 unité = 16 cm — un boîtier DVD fait 19 cm de haut).
//   w = épaisseur de la tranche (ce qu'on voit)
//   h = hauteur du boîtier
//   d = profondeur (la jaquette, qui s'enfonce dans l'étagère)
//
// L'épaisseur est un poil généreuse (17 mm au lieu de 14) : c'est la largeur
// dans laquelle doivent tenir la fenêtre d'affiche et le titre de la tranche.
export const BOX = {
  dvd: { w: 0.105, h: 1.18, d: 0.86 },
  // Un volume relié, au format tankôbon : 17,6 cm de haut, 11,3 de large, et
  // une tranche d'un centimètre. Un one-shot promotionnel de vingt planches est
  // plus mince que ça dans la vraie vie, mais en dessous du centimètre il n'y a
  // plus rien à lire sur la tranche — et c'est la tranche qu'on voit quand les
  // volumes sont rangés.
  book: { w: 0.0625, h: 1.1, d: 0.706 },
  // La boîte de jeu GBA : 13,5 cm de haut, 9,5 de large, 2,5 d'épaisseur. Haute,
  // ÉTROITE et de loin la plus épaisse du rayon — c'est du carton, pas du
  // plastique fin. Rangée entre deux DVD, elle ressort toute seule : exactement
  // ce que fait une boîte de jeu dans une vraie collection.
  gba: { w: 0.156, h: 0.844, d: 0.594 },
};

// Échelle du monde : 1 unité ≈ 16 cm. Sert à passer des centimètres (ce que
// l'admin connaît d'un boîtier : « un Blu-ray fait 17,2 cm ») aux unités de la
// scène, et retour.
export const CM = 16;

// LES DIMENSIONS D'UN BOÎTIER DONNÉ. Un titre peut porter les siennes, relevées
// sur sa jaquette dépliée par l'outil d'alignement : c'est ce qui permet à un
// Blu-ray d'être plus court qu'un DVD et à un coffret d'être épais, au lieu de
// forcer toute l'étagère dans un seul gabarit.
//
// Rien de tel ? On retombe sur le gabarit du format. Aucune migration n'est
// donc nécessaire : les boîtiers d'avant continuent de sortir exactement pareil.
export function boxOf(media) {
  const b = media?.box;
  if (b && b.w > 0 && b.h > 0 && b.d > 0) return b;
  // Le genre l'emporte sur le format : un comic importé avant que le champ
  // `format` n'existe reste un livre, et se range comme tel.
  return (
    BOX[media?.format] ||
    (isComic(media) ? BOX.book : isGame(media) ? BOX.gba : BOX.dvd)
  );
}

// « 1276 » → « 21 min », « 3720 » → « 1 h 02 ».
export function fmtDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

// « 0 » → « 0:00 » (compteur du téléviseur).
export function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// Années d'exploitation : « 2003 – 2006 », « 1986 ».
export function fmtYears(media) {
  if (!media?.year) return "";
  if (media.kind === "film" || !media.endYear || media.endYear === media.year)
    return String(media.year);
  return `${media.year} – ${media.endYear}`;
}

// Où reprendre : l'épisode en cours et le temps déjà écoulé.
export function resumeLabel(media) {
  const p = media?.progress;
  if (!p) return null;
  // UN JEU SE REPREND MAINTENANT VRAIMENT. Du temps du rayon DS, la sauvegarde
  // vivait dans le navigateur du joueur : on ne pouvait promettre que le temps
  // passé dessus. Depuis, la partie est sur le serveur (voir CollectionSave) — et
  // le temps de jeu reste ce qu'on affiche, parce que c'est ce qui SITUE la
  // cartouche dans la rangée. Sous la minute, on ne dit rien du tout.
  if (isGame(media))
    return p.playSeconds > 60 ? `${fmtDuration(p.playSeconds)} de jeu` : null;
  if (isComic(media)) return p.page > 0 ? `Page ${p.page + 1}` : null;
  const ep = media.episodes?.[p.episodeIndex];
  const num = (ep?.number ?? p.episodeIndex + 1) || 1;
  if (media.kind === "film") return p.positionSeconds > 30 ? "Reprendre" : null;
  return `Ép. ${num}`;
}

// ------------------------------------------------------- images / canvas --

// Charge une image utilisable dans un canvas destiné à WebGL. `crossOrigin`
// est obligatoire : sans en-tête CORS, le canvas devient « souillé » et la
// texture échoue (boîtier de couleur unie sur le rayonnage).
function loadTag(src, cors) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Deux tentatives, parce qu'un échec ici est INVISIBLE (le boîtier se peint
// alors en couleur unie) et qu'on ne saurait pas pourquoi :
//   1. la balise <img crossOrigin> — le chemin normal ;
//   2. un fetch + blob: URL en repli. Une blob: URL est de notre origine, donc
//      elle ne peut jamais souiller le canvas — ça sauve les cas tordus, comme
//      une image déjà en cache navigateur depuis une requête SANS CORS (une
//      vignette de la grille 2D), que Chrome ressort parfois telle quelle.
export async function loadImage(src) {
  if (!src) return null;
  const direct = await loadTag(src, true);
  if (direct) return direct;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    const img = await loadTag(url, false);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

// Dessine une image en « cover » (remplit le cadre, recadre le débord).
// `ax` / `ay` disent QUELLE part on garde quand ça déborde : 0,5 recadre au
// centre, 0 colle en haut à gauche. Sur une affiche, le sujet est presque
// toujours dans le haut — un recadrage centré lui coupe la tête.
function drawCover(ctx, img, x, y, w, h, ax = 0.5, ay = 0.5) {
  const ratio = Math.max(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  ctx.drawImage(img, x + (w - dw) * ax, y + (h - dh) * ay, dw, dh);
}

// Texte coupé en lignes qui tiennent dans `max`, `lines` au plus. Ce qui
// dépasse est signalé par des points de suspension SUR LA DERNIÈRE LIGNE —
// un résumé qui s'arrête net au milieu d'un mot fait bâclé.
function wrap(ctx, text, max, lines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = words[i];
      if (out.length === lines) break;
    } else line = next;
  }
  // Sortie normale de la boucle : tout est passé, la dernière ligne se pose
  // telle quelle. Sortie par `break` : il reste du texte, donc et seulement
  // donc on signale la coupe.
  //
  // L'ancienne version ajoutait les points de suspension dès que le compte de
  // lignes était atteint — même quand le texte tombait juste. Résultat : TOUT
  // titre tenant pile en deux lignes s'affichait tronqué (« Castlevania:
  // Nocturne… »), ce qui donnait l'air bâclé à des faces parfaitement calées.
  if (out.length < lines) {
    if (line) out.push(line);
    return out;
  }
  const rest = line || i < words.length;
  if (rest && out.length) {
    let last = out[out.length - 1];
    while (last.length > 4 && ctx.measureText(`${last}…`).width > max) {
      last = last.slice(0, -1).trim();
    }
    out[out.length - 1] = `${last}…`;
  }
  return out.slice(0, lines);
}

// ------------------------------------------------------ boîte à couleurs --

// Un ton de la teinte du titre, éclairci (t > 0) ou assombri (t < 0). Toute la
// tranche est bâtie là-dessus : une seule couleur servie par l'API, déclinée en
// bandeaux, ombres et filets — c'est ce qui fait qu'un boîtier a l'air imprimé
// plutôt que colorié.
// Le résultat sort en HEXA, et pas en `rgb(…)` : un ton dérivé est presque
// toujours repassé à `alpha()` juste après (une encre d'accent, un filet), et
// celui-ci ne sait lire que de l'hexa — il retombait sinon sur le doré par
// défaut, donc TOUS les boîtiers avaient les mêmes accents dorés.
function shade(hex, t) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return hex || "#f2b70b";
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const rgb = m.slice(1).map((v) => Math.round(parseInt(v, 16) * (1 - k) + to * k));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return `rgba(242, 183, 11, ${a})`;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Rectangle à coins arrondis — les pastilles, les fenêtres, les cartouches.
function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// ------------------------------------------------------------ typographie --
//
// DEUX familles, deux rôles, et rien d'autre — c'est la règle qui sépare une
// édition soignée d'une jaquette de supermarché :
//
//   • une didone à fort contraste pour les TITRES. Un titre de film gravé dans
//     une grotesque géométrique fait « application » ; en didone, il fait
//     « objet imprimé » ;
//   • une grotesque neutre, en petites capitales espacées, pour TOUT le reste
//     (mentions, cartouche, résumé). La petite typo d'un dos de boîtier se lit,
//     elle ne s'admire pas.
const SERIF = '"Playfair Display", "Times New Roman", Georgia, serif';
const SANS = "Inter, system-ui, sans-serif";

// UN CANVAS NE DÉCLENCHE PAS LE CHARGEMENT D'UNE POLICE. `ctx.font` accepte
// n'importe quel nom et retombe sans rien dire sur un repli système si la fonte
// n'a jamais servi dans le DOM. La didone ne sert QUE sur les boîtiers : sans
// cette demande explicite, toutes les jaquettes sortiraient en Times — et
// `document.fonts.ready` seul ne le verrait même pas, puisqu'il n'attend que ce
// qui est DÉJÀ demandé.
const FACES = [
  '600 40px "Playfair Display"',
  '700 40px "Playfair Display"',
  'italic 500 40px "Playfair Display"',
  "500 40px Inter",
  "700 40px Inter",
];
let fontsReady = null;
function ensureFonts() {
  if (!fontsReady) {
    fontsReady = (async () => {
      try {
        await Promise.all(FACES.map((f) => document.fonts.load(f)));
        await document.fonts.ready;
      } catch {
        /* pas d'API de polices : on peint avec ce qui est disponible */
      }
    })();
  }
  return fontsReady;
}

// Capitales espacées, tracées lettre à lettre. `ctx.letterSpacing` existe mais
// `measureText` L'IGNORE dans plusieurs navigateurs : un texte centré partait
// alors de travers, et une ligne calée à droite débordait. En traçant
// nous-mêmes, la largeur est connue au pixel — et l'interlettrage marche
// partout, y compris dans un repère tourné (les tranches).
function trackedWidth(ctx, text, track) {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  let w = -track;
  for (const ch of chars) w += ctx.measureText(ch).width + track;
  return w;
}

function trackedText(ctx, text, x, y, track, align = "left") {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  const total = trackedWidth(ctx, text, track);
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  ctx.textAlign = prev;
  return total;
}

// Le filet : le trait fin qui sépare deux blocs. Tout le dos tient sur des
// filets et des marges plutôt que sur des cadres et des aplats — un encadré de
// couleur autour de chaque chose, c'est exactement ce qui fait « bon marché ».
function rule(ctx, x, y, w, color, weight = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(1, Math.round(weight)));
}

// La teinte du titre, ÉCLAIRCIE jusqu'à devenir une encre. Servie telle quelle,
// une couleur tirée d'une affiche (donc souvent saturée à bloc) tache le dos et
// se bat avec le texte ; éclaircie, elle reste reconnaissable, se pose sur du
// sombre sans crier, et sert de fil conducteur entre les trois faces.
const accentInk = (color) => shade(color, 0.55);

// Même office que `fitOneLine`, mais pour du texte INTERLETTRÉ : la largeur
// d'une ligne espacée ne se mesure pas avec `measureText`, il faut l'additionner
// (voir `trackedWidth`). L'espacement suit la taille — le réduire seul donnerait
// des capitales serrées sur une tranche et aérées sur la suivante.
function fitTracked(ctx, text, maxRun, font, size, min, ratio) {
  let s = size;
  let t = String(text || "");
  ctx.font = font(s);
  while (trackedWidth(ctx, t, s * ratio) > maxRun && s > min) {
    s -= 1;
    ctx.font = font(s);
  }
  while (trackedWidth(ctx, t, s * ratio) > maxRun && t.length > 3) {
    t = `${t.slice(0, -2).trim()}…`;
  }
  return { text: t, track: s * ratio };
}

// Réduit la police jusqu'à ce que le texte tienne, puis coupe si vraiment
// nécessaire. Sert aux titres de tranche, où la longueur disponible est fixe.
function fitOneLine(ctx, text, maxWidth, font, size, min) {
  let s = size;
  let t = String(text || "");
  ctx.font = font(s);
  while (ctx.measureText(t).width > maxWidth && s > min) {
    s -= 1;
    ctx.font = font(s);
  }
  while (ctx.measureText(t).width > maxWidth && t.length > 4) {
    t = `${t.slice(0, -2).trim()}…`;
  }
  return t;
}

// Grain de papier : quelques milliers de points translucides. Une jaquette
// imprimée n'est jamais lisse, et c'est ce qui vend le côté « vieux boîtier ».
function grain(ctx, w, h, amount = 0.05) {
  ctx.save();
  ctx.globalAlpha = amount;
  for (let i = 0; i < w * h * 0.004; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.restore();
}

// LE CHANT D'UN BLOC DE PAGES. Une bande de fils crème, irréguliers : c'est la
// seule chose qui distingue vraiment du papier d'un savon beige, et sur un
// volume rangé c'est ce qu'on voit dépasser de la couverture.
//
// La bande n'a que quatre pixels de haut : le motif ne varie que dans un sens
// (celui de l'empilement), l'autre n'a rien à dire. Les groupes plus sombres
// sont les cahiers — un bloc broché n'a jamais un chant régulier.
export function paintPageEdge(width = 256) {
  const canvas = canvasOf(width, 4);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f0e8d6";
  ctx.fillRect(0, 0, width, 4);
  for (let x = 0; x < width; x += 1) {
    const t = Math.random();
    if (t < 0.42) continue; // toutes les pages ne marquent pas
    ctx.fillStyle = `rgba(122, 104, 76, ${0.05 + t * 0.2})`;
    ctx.fillRect(x, 0, 1, 4);
  }
  // Les cahiers : un creux plus marqué tous les seize fils environ.
  for (let x = Math.round(Math.random() * 16); x < width; x += 13 + Math.round(Math.random() * 6)) {
    ctx.fillStyle = "rgba(96, 80, 56, 0.34)";
    ctx.fillRect(x, 0, 1, 4);
  }
  return canvas;
}

// ---------------------------------------------------------------- planche --

// LE FIL D'UNE TABLETTE. Une carte de MODULATION, pas une couleur : du blanc à
// peine sali, que chaque pièce de la planche multiplie par SA teinte (voir
// PLANK dans CollectionShelf). Un seul dessin sert donc au thème clair comme au
// sombre, au chant comme au dessus.
//
// Ce qu'on cherche n'est pas « du bois » : c'est que la planche cesse d'être un
// aplat. Vue de face — et c'est presque tout ce qu'on en voit — une tablette n'a
// que ça à montrer : de très légères variations qui courent sur sa longueur.
//
// LE MOTIF SE RACCORDE. La texture se répète le long de la planche (une tablette
// fait plusieurs mètres, le dessin quelques dizaines de centimètres) : chaque
// fibre ondule donc sur un nombre ENTIER de périodes, sinon la couture se verrait
// à chaque carreau.
export function paintPlankFibres(w = 512, h = 64) {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f8f7f4";
  ctx.fillRect(0, 0, w, h);

  const fibre = (y, amp, periods, thickness, color) => {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const at = y + Math.sin((x / w) * periods * Math.PI * 2) * amp;
      if (x === 0) ctx.moveTo(x, at);
      else ctx.lineTo(x, at);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.stroke();
  };

  // Les veines larges : invisibles une à une, c'est leur superposition qui donne
  // à la planche son fil.
  for (let i = 0; i < 7; i++) {
    fibre(
      Math.random() * h,
      1 + Math.random() * 3,
      1 + Math.floor(Math.random() * 2),
      4 + Math.random() * 7,
      `rgba(104, 86, 62, ${(0.018 + Math.random() * 0.022).toFixed(3)})`
    );
  }
  // Les fibres fines : le détail qu'on ne voit qu'en s'approchant du chant. Une
  // sur trois est CLAIRE — sans elles le fil ne fait que salir la teinte.
  for (let i = 0; i < 30; i++) {
    fibre(
      Math.random() * h,
      0.5 + Math.random() * 2,
      1 + Math.floor(Math.random() * 3),
      0.6 + Math.random() * 0.9,
      Math.random() > 0.32
        ? `rgba(92, 76, 54, ${(0.03 + Math.random() * 0.05).toFixed(3)})`
        : `rgba(255, 255, 255, ${(0.16 + Math.random() * 0.2).toFixed(3)})`
    );
  }
  grain(ctx, w, h, 0.04);
  return canvas;
}

// L'OMBRE, EN UNE COLONNE DE PIXELS. Deux endroits en ont besoin sur la planche
// — le liseré au pied des boîtiers et l'ombre que la tablette pose sur la page —
// et c'est le même dégradé, couché une fois à plat et une fois debout.
//
// Du noir dont SEUL L'ALPHA compte : le canvas de la scène est transparent,
// l'ombre s'applique donc sur la page elle-même, comme celle d'une vraie
// étagère posée dessus.
export function paintShade(h = 64) {
  const canvas = canvasOf(4, h);
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // Serrée au contact, longue à s'éteindre : la courbe d'une ombre douce. Une
  // rampe linéaire donne un bord franc à mi-hauteur, qu'on lit comme un trait.
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.12, "rgba(0,0,0,0.72)");
  g.addColorStop(0.3, "rgba(0,0,0,0.38)");
  g.addColorStop(0.58, "rgba(0,0,0,0.14)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, h);
  return canvas;
}

// Le carton d'un boîtier n'est jamais plat : ses deux arêtes sont pliées, donc
// plus sombres, et la lumière file au centre. Sans ça, une tranche ressemble à
// un rectangle de couleur. Dosé léger : la tranche est la face qu'on LIT, elle
// ne doit pas s'assombrir pour faire joli.
function foldShading(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.34)");
  g.addColorStop(0.16, "rgba(0,0,0,0.05)");
  g.addColorStop(0.44, "rgba(255,255,255,0.07)");
  g.addColorStop(0.7, "rgba(255,255,255,0.02)");
  g.addColorStop(0.9, "rgba(0,0,0,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ------------------------------------------------------------- le champ --
//
// LE FOND DE TOUTES LES FACES, ET LE CŒUR DE LA REFONTE. Avant, une face non
// illustrée était un aplat de `media.color` : une couleur brute, servie à
// pleine saturation sur toute la hauteur — d'où ces boîtiers fluo qui faisaient
// « imprimé chez soi ».
//
// Ici, la couleur ne vient plus d'un champ de la base mais de L'AFFICHE
// elle-même : on la réduit à une poignée de pixels, on la réétale, et il ne
// reste que ses tons — une lumière, pas une image. Posée sur un aplat très
// sombre de la teinte, elle donne à chaque boîtier SES couleurs sans jamais
// menacer la lisibilité du texte qui viendra dessus.

// Flou fait main : réduction brutale puis remontée en deux paliers, le lissage
// du navigateur faisant le travail. `ctx.filter` ferait la même chose en une
// ligne, mais il manque encore à l'appel sur assez de navigateurs pour qu'on ne
// puisse pas bâtir le fond dessus.
function blurUp(ctx, img, w, h, cover) {
  const small = canvasOf(cover ? 28 : 10, 28);
  const sc = small.getContext("2d");
  // Hors « cover », l'image est ÉTIRÉE sans égard pour ses proportions : sur
  // une tranche de 90 px de large, un recadrage ne garderait qu'une lichette de
  // l'affiche, donc une seule de ses couleurs.
  if (cover) drawCover(sc, img, 0, 0, small.width, small.height);
  else sc.drawImage(img, 0, 0, small.width, small.height);

  const mid = canvasOf(Math.max(8, w / 8), Math.max(8, h / 8));
  const mc = mid.getContext("2d");
  mc.imageSmoothingEnabled = true;
  mc.imageSmoothingQuality = "high";
  mc.drawImage(small, 0, 0, mid.width, mid.height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, w, h);
}

// Le champ complet, rendu dans son propre canvas : il sert de fond, mais AUSSI
// de matière pour fondre l'affiche dedans (voir `fadeInto`) — il faut donc
// pouvoir le redessiner à l'identique après coup.
function makeField(w, h, color, img, { cover = false, light = 0.62, veil = 0.5 } = {}) {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = shade(color, -0.82);
  ctx.fillRect(0, 0, w, h);

  if (img) {
    ctx.save();
    ctx.globalAlpha = light;
    blurUp(ctx, img, w, h, cover);
    ctx.restore();
  } else {
    // Pas de visuel : une descente en diagonale plutôt qu'un aplat, pour que la
    // face garde un modelé.
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, shade(color, -0.5));
    g.addColorStop(0.55, shade(color, -0.76));
    g.addColorStop(1, "#0a0b10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Le voile de nuit : c'est lui qui garantit qu'un texte blanc passera, quelle
  // que soit l'affiche en dessous. Plus dense en bas, où vivent les mentions.
  const scrim = ctx.createLinearGradient(0, 0, 0, h);
  scrim.addColorStop(0, `rgba(8,9,14,${veil * 0.82})`);
  scrim.addColorStop(0.55, `rgba(8,9,14,${Math.min(1, veil * 1.1)})`);
  scrim.addColorStop(1, `rgba(6,7,11,${Math.min(1, veil * 1.35)})`);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, h);

  // Vignettage : les bords rentrent dans l'ombre, le regard va au centre. Un
  // fond parfaitement uniforme n'existe sur aucun objet imprimé.
  const vig = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(0.65, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

// Fond une image DANS le champ : on redessine le champ par-dessus, en dégradé
// d'opacité. Recouvrir avec un dégradé « couleur du fond » approché laissait
// toujours une couture — ici c'est le fond lui-même qui remonte, donc le
// raccord est invisible par construction.
function fadeInto(ctx, field, x, y, w, h) {
  const patch = canvasOf(w, h);
  const p = patch.getContext("2d");
  p.drawImage(field, x, y, w, h, 0, 0, patch.width, patch.height);
  p.globalCompositeOperation = "destination-in";
  const g = p.createLinearGradient(0, 0, 0, patch.height);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,1)");
  p.fillStyle = g;
  p.fillRect(0, 0, patch.width, patch.height);
  ctx.drawImage(patch, x, y, w, h);
}

function canvasOf(width, height) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width));
  c.height = Math.max(2, Math.round(height));
  return c;
}

// ---------------------------------------------------------------- tranche --
// LA face qu'on voit dans le rayon — 90 px de large pour 1024 de haut. Il n'y a
// pas plus contraint comme format : tout ce qu'on y pose de trop se lit comme
// du bruit, et c'est exactement ce qui perdait l'ancienne version (bandeau de
// couleur pleine, capuchon sombre, pastille de disque, mention « DVD » en gras).
//
// Le parti pris tient en une phrase : UNE IMAGE, UN TITRE, UNE DATE. Le reste
// n'est que filets et marges.
//
//   ┌──────┐
//   │ IMG  │  l'affiche à fond perdu, fondue dans le champ — la seule image
//   │ ░░░░ │  du rayon quand les boîtiers sont rangés
//   │  ──  │  filet
//   │ SAGA │  la saga, minuscules capitales espacées
//   │      │
//   │TITRE │  le titre en didone, à la verticale, plein champ
//   │      │
//   │  ──  │  filet
//   │ 2026 │  année (et volume)
//   │ ···· │  la marque, en fine mention
//   └──────┘
//
// Et le fond n'est plus la teinte brute : c'est le champ tiré de l'affiche
// (voir `makeField`). Sur une étagère, les tranches s'alignent donc en une
// suite de tons sourds, chacun venant de SON visuel — au lieu d'une rangée de
// rectangles fluo.
function paintSpine(media, img, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = media.color || "#f2b70b";
  const accent = accentInk(color);
  const px = (v) => Math.max(1, Math.round(v));
  const mid = w / 2;
  const HAIR = "rgba(255,255,255,0.15)";

  // --- Le champ, gardé sous la main : c'est lui qui remontera par-dessus le
  //     bas de l'affiche pour l'y fondre sans couture. Le voile est dosé pour le
  //     CAS DÉFAVORABLE — une affiche à fond blanc : sans lui, la tranche
  //     virait au gris clair et le titre blanc s'y noyait.
  const field = makeField(w, h, color, img, { light: 0.62, veil: 0.52 });
  ctx.drawImage(field, 0, 0);

  // --- 0. LE CAPUCHON DE CONSOLE. Un boîtier de jeu porte, en haut de sa
  //     tranche, un bandeau blanc où court le nom de la machine : c'est ce qui
  //     fait qu'on repère une rangée de jeux d'un bout à l'autre d'une étagère,
  //     sans lire un seul titre. Il n'appartient qu'aux jeux — sur un film, ce
  //     serait une décoration de plus.
  //
  //     Sa hauteur n'est pas décorative : le nom de la machine est TOURNÉ comme
  //     le reste, donc sa longueur court à la verticale. Un bandeau court le
  //     ferait rétrécir puis tronquer (« NINTEND… »), ce qui est pire que pas
  //     de bandeau du tout.
  const capH = isGame(media) ? h * 0.15 : 0;

  // --- 1. L'affiche, à fond perdu en tête. Aucun voile par-dessus : c'est la
  //     seule chose qu'on reconnaît de loin. Elle s'éteint dans le champ sur son
  //     dernier tiers, comme une impression qui se perd dans le fond.
  //
  //     PAS SUR UN JEU. Une tranche de boîte de jeu ne porte pas de vignette :
  //     le bandeau de la console, le titre, et c'est tout. Et la boîte GBA est
  //     déjà d'un tiers plus courte qu'un DVD — lui prendre en plus un quart de
  //     sa hauteur laisserait au titre une course où plus rien ne tient.
  const artH = img && !isGame(media) ? h * 0.22 : 0;
  if (artH) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, capH, w, artH);
    ctx.clip();
    // Cadrée haut : sur une affiche portrait réduite à une colonne, le sujet
    // est dans le premier tiers.
    drawCover(ctx, img, 0, capH, w, artH, 0.5, 0.3);
    ctx.restore();
    fadeInto(ctx, field, 0, capH + artH * 0.6, w, artH * 0.4);
  }

  if (capH) paintSpineCap(ctx, w, capH);

  // --- LE PARTAGE DE LA HAUTEUR. Sur une tranche, TOUT LE TEXTE EST TOURNÉ :
  //     sa longueur court à la VERTICALE, sa taille de caractère à
  //     l'horizontale. Un « bandeau de 50 px de haut » ne veut donc rien dire
  //     pour une ligne tournée — il lui faut une COURSE, et une saga centrée
  //     dans un bandeau trop court débordait des deux côtés, par-dessus le
  //     titre. C'est ce qui faisait la bouillie de l'ancienne tranche.
  //
  //     On alloue donc à chaque bloc sa course en pixels, du haut vers le bas,
  //     et chaque texte est RÉDUIT pour y tenir. Le titre prend tout le reste —
  //     et récupère la course de la saga quand il n'y en a pas.
  const hasSaga =
    media.franchise && media.franchise.toLowerCase() !== media.title.toLowerCase();
  const topRule = capH + artH + h * 0.026;
  const sagaTop = topRule + h * 0.022;
  const sagaRun = hasSaga ? h * 0.115 : 0;
  const markY = h - h * 0.028; // le losange de collection, tout en bas
  const yearRun = h * 0.09;
  const yearTop = markY - h * 0.022 - yearRun;
  const footRule = yearTop - h * 0.024;
  const titleTop = sagaTop + sagaRun;
  const titleRun = footRule - h * 0.028 - titleTop;

  // --- 2. Le filet de tête et la saga. Le filet ne barre pas toute la largeur :
  //     un trait qui touche les deux bords ferme la tranche, un trait court la
  //     rythme.
  rule(ctx, w * 0.3, topRule, w * 0.4, HAIR, px(h * 0.0014));

  if (hasSaga) {
    ctx.save();
    ctx.translate(mid, sagaTop + sagaRun / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillStyle = alpha(accent, 0.88);
    const saga = fitTracked(
      ctx,
      media.franchise.toUpperCase(),
      sagaRun,
      (s) => `700 ${s}px ${SANS}`,
      px(w * 0.145),
      px(w * 0.1),
      0.34
    );
    trackedText(ctx, saga.text, 0, 0, saga.track, "center");
    ctx.restore();
  }

  // --- 3. Le titre, plein champ, en didone. C'est LUI qu'on cherche des yeux
  //     en passant devant l'étagère.
  ctx.save();
  ctx.translate(mid, titleTop + titleRun / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const title = fitOneLine(
    ctx,
    media.title,
    titleRun,
    (s) => `600 ${s}px ${SERIF}`,
    px(w * 0.52),
    px(w * 0.24)
  );
  // Une ombre COURTE et sombre : la didone a des déliés fins, il leur faut de
  // quoi se détacher du champ sans qu'on voie l'ombre elle-même.
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowOffsetX = px(w * 0.015);
  ctx.shadowBlur = px(w * 0.07);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title, 0, 0);
  ctx.restore();

  // --- 4. Le pied : un filet, la date. Plus de bandeau sombre — c'est le
  //     vignettage du champ qui assied déjà l'objet sur la planche.
  rule(ctx, w * 0.3, footRule, w * 0.4, HAIR, px(h * 0.0014));

  // La date seule. Le nombre d'épisodes vivait ici avant : à cette course, les
  // deux mentions bout à bout sortaient de la tranche — et le compte se lit de
  // toute façon dans la bulle de survol comme au dos.
  const foot =
    fmtYears(media) ||
    (isComic(media)
      ? media.pageCount
        ? `${media.pageCount} PLANCHES`
        : ""
      : isGame(media)
        ? media.cartridge?.region?.toUpperCase() || ""
        : media.episodeCount
          ? `${media.episodeCount} ÉPISODES`
          : "");
  if (foot) {
    ctx.save();
    ctx.translate(mid, yearTop + yearRun / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    const year = fitTracked(
      ctx,
      foot,
      yearRun,
      (s) => `600 ${s}px ${SANS}`,
      px(w * 0.16),
      px(w * 0.1),
      0.2
    );
    trackedText(ctx, year.text, 0, 0, year.track, "center");
    ctx.restore();
  }

  // La marque de collection : un losange, pas un mot. Un nom d'éditeur écrit là
  // demanderait une course de 100 px de plus, qu'on volerait au titre — et à
  // cette taille il ne serait de toute façon qu'un trait gris. Le losange, lui,
  // se pose en 6 px et suffit à ranger l'objet dans une série.
  ctx.save();
  ctx.translate(mid, markY);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = alpha(accent, 0.7);
  const m = w * 0.075;
  ctx.fillRect(-m / 2, -m / 2, m, m);
  ctx.restore();

  foldShading(ctx, w, h);
  grain(ctx, w, h, 0.03);
  return canvas;
}

// LE BANDEAU DE CONSOLE, en haut de la tranche d'un boîtier de jeu.
//
// Blanc cassé, le nom de la machine à la verticale, et un liseré sombre pour
// l'asseoir sur le champ. C'est un détail minuscule — quatre-vingts pixels sur
// mille — mais c'est LE signe qui range l'objet : sans lui, un jeu n'est qu'un
// boîtier court et épais de plus.
//
// Le texte est tourné comme le reste de la tranche, donc sa longueur court à la
// verticale : le bandeau doit être assez HAUT pour la contenir, jamais assez
// large — c'est le même piège que la saga, et il se paie de la même façon
// (des lettres qui débordent sur l'affiche).
function paintSpineCap(ctx, w, capH) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "#c9c8c4");
  g.addColorStop(0.2, "#f7f6f3");
  g.addColorStop(0.62, "#ffffff");
  g.addColorStop(1, "#bfbeba");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, capH);

  ctx.save();
  ctx.translate(w / 2, capH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1b1c22";
  const fit = fitTracked(
    ctx,
    CONSOLE.toUpperCase(),
    capH * 0.86,
    (s) => `700 ${s}px ${SANS}`,
    Math.max(1, Math.round(w * 0.17)),
    Math.max(1, Math.round(w * 0.1)),
    0.2
  );
  trackedText(ctx, fit.text, 0, 0, fit.track, "center");
  ctx.restore();

  // L'ombre portée du bandeau sur ce qui suit : sans elle, le blanc est posé
  // sur l'image comme un autocollant.
  const drop = ctx.createLinearGradient(0, capH, 0, capH + w * 0.35);
  drop.addColorStop(0, "rgba(0,0,0,0.45)");
  drop.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = drop;
  ctx.fillRect(0, capH, w, w * 0.35);
}

// ---------------------------------------------------------------- jaquette --
// LA COUVERTURE, ET RIEN D'AUTRE. Pas de titre ajouté, pas de bandeau de
// support, pas de voile : l'affiche a été composée par quelqu'un dont c'est le
// métier, et tout ce qu'on pose dessus lui passe devant. Le titre se lit sur la
// tranche, les informations au dos — chaque face son rôle.
//
// Seule exception : quand le visuel n'est pas arrivé. Là, mieux vaut une
// couverture dessinée qu'un rectangle vide.
function paintSleeve(media, img, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = media.color || "#f2b70b";

  if (img) {
    drawCover(ctx, img, 0, 0, w, h);
    // Le papier de la jaquette, et lui seul : de quoi tuer l'effet « photo
    // collée sur une boîte » sans rien ajouter de lisible.
    grain(ctx, w, h, 0.035);
    return canvas;
  }

  // --- Repli : pas d'affiche. On ne bricole pas une fausse image — on assume
  //     une couverture de TEXTE, comme une édition sans jaquette : champ sombre,
  //     double filet, titre en didone centré. C'est sobre, donc ça ne se
  //     dénonce pas comme un pis-aller.
  const px = (v) => Math.max(1, Math.round(v));
  ctx.drawImage(makeField(w, h, color, null, {}), 0, 0);

  // Le double filet d'encadrement : le geste d'imprimeur qui, à lui seul, fait
  // la différence entre « une face vide » et « une couverture ».
  const inset = w * 0.07;
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = px(w * 0.004);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.strokeStyle = alpha(accentInk(color), 0.32);
  ctx.lineWidth = px(w * 0.002);
  const inner = inset + w * 0.016;
  ctx.strokeRect(inner, inner, w - inner * 2, h - inner * 2);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if (media.franchise) {
    ctx.font = `700 ${px(w * 0.032)}px ${SANS}`;
    ctx.fillStyle = alpha(accentInk(color), 0.9);
    trackedText(ctx, media.franchise.toUpperCase(), w / 2, h * 0.38, px(w * 0.014), "center");
  }

  const size = px(media.title.length > 26 ? w * 0.1 : w * 0.14);
  ctx.font = `600 ${size}px ${SERIF}`;
  ctx.fillStyle = "#fff";
  const lines = wrap(ctx, media.title, w * 0.78, 3);
  let y = h * 0.5 - ((lines.length - 1) * size * 1.14) / 2;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += size * 1.14;
  }

  const years = fmtYears(media);
  if (years) {
    ctx.font = `600 ${px(w * 0.03)}px ${SANS}`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    trackedText(ctx, years, w / 2, y + h * 0.02, px(w * 0.02), "center");
  }

  ctx.font = `600 ${px(w * 0.024)}px ${SANS}`;
  ctx.fillStyle = "rgba(255,255,255,0.34)";
  trackedText(ctx, "MYPLAYLOG", w / 2, h - inset - h * 0.035, px(w * 0.03), "center");

  grain(ctx, w, h, 0.045);
  return canvas;
}

// -------------------------------------------------------------------- dos --
// LE VRAI DOS D'UN BOÎTIER. On le voit dès que l'objet pivote dans la vitrine,
// donc il est lu de PRÈS : c'est la face où la moindre approximation se voit.
//
// La règle de composition tient en trois points :
//
//   1. AUCUN APLAT DE COULEUR. Ni bandeau de tête, ni encadré autour du
//      cartouche, ni pastille de genre : rien que des filets et des marges. Un
//      cadre coloré autour de chaque bloc, c'est la signature du bon marché.
//   2. LA COULEUR VIENT DE L'IMAGE. Le fond est le bandeau du titre réduit à
//      ses tons, sous un voile de nuit ; le seul accent est cette même teinte
//      éclaircie en encre (`accentInk`), qui ne sert qu'aux petites mentions.
//   3. UNE SEULE HIÉRARCHIE, de haut en bas : mention · titre · accroche ·
//      résumé · images · cartouche · pied. Chaque bloc n'apparaît que si la
//      donnée existe, et le pied est posé DEPUIS LE BAS — c'est lui qui borne
//      le résumé, jamais l'inverse.
//
// Et pas de code-barres : un faux numéro sur un objet qui ne s'achète nulle
// part, c'est du décor qui ment, et ça tire toute la face vers le gadget.
function paintBack(media, img, backdrop, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = media.color || "#f2b70b";
  const accent = accentInk(color);
  const px = (v) => Math.max(1, Math.round(v));
  // Marge large — c'est le premier signe extérieur du soin. Une face bien
  // remplie jusqu'aux bords fait tract ; une face qui respire fait édition.
  const pad = w * 0.085;
  const inner = w - pad * 2;
  const shot = backdrop || img;
  const HAIR = "rgba(255,255,255,0.13)";

  // --- Le champ : le bandeau du titre réduit à ses tons, noyé de nuit.
  ctx.drawImage(makeField(w, h, color, shot, { cover: true, light: 0.5, veil: 0.86 }), 0, 0);

  // ---------------------------------------------------------------- tête --
  // Une seule ligne de mention, puis un filet. Pas de bandeau, et RIEN à
  // droite : c'est ce vide qui donne le ton du reste de la face. La marge du
  // haut vaut celle des côtés — un dos qui commence trop haut fait tract.
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${px(w * 0.023)}px ${SANS}`;
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  trackedText(
    ctx,
    [
      // Sur un dos de boîtier de jeu, ce n'est pas le mot « jeu » qu'on imprime
      // en tête : c'est la MACHINE. C'est la première chose qu'on cherche quand
      // on retourne la boîte.
      isGame(media)
        ? CONSOLE.toUpperCase()
        : KINDS[media.kind]?.label?.toUpperCase() || "",
      fmtYears(media),
    ]
      .filter(Boolean)
      .join("   ·   "),
    pad,
    h * 0.066,
    px(w * 0.01)
  );
  rule(ctx, pad, h * 0.082, inner, HAIR, px(h * 0.0014));

  // -------------------------------------------------------------- titre --
  // La taille se choisit en MESURANT, pas en comptant les lettres : un titre de
  // 20 caractères larges déborde là où 26 étroits passent. On tente la grande,
  // on retombe sur la petite si elle ne tient pas d'un seul tenant.
  let y = h * 0.162;
  let tSize = px(w * 0.098);
  ctx.font = `600 ${tSize}px ${SERIF}`;
  if (ctx.measureText(media.title).width > inner) {
    tSize = px(w * 0.076);
    ctx.font = `600 ${tSize}px ${SERIF}`;
  }
  ctx.fillStyle = "#fff";
  for (const line of wrap(ctx, media.title, inner, 2)) {
    ctx.fillText(line, pad, y);
    y += tSize * 1.16;
  }
  y -= tSize * 0.28;

  if (media.originalTitle && media.originalTitle !== media.title) {
    y += h * 0.032;
    const oSize = px(w * 0.034);
    ctx.font = `italic 500 ${oSize}px ${SERIF}`;
    ctx.fillStyle = "rgba(255,255,255,0.46)";
    ctx.fillText(
      fitOneLine(
        ctx,
        media.originalTitle,
        inner,
        (s) => `italic 500 ${s}px ${SERIF}`,
        oSize,
        px(w * 0.026)
      ),
      pad,
      y
    );
  }

  // --- L'accroche. Une phrase, en italique, dans la teinte éclaircie : c'est
  //     la ligne qui donne un ton au boîtier. Elle n'existe pas toujours, et on
  //     n'en invente pas.
  if (media.tagline) {
    y += h * 0.04;
    const gSize = px(w * 0.036);
    ctx.font = `italic 500 ${gSize}px ${SERIF}`;
    ctx.fillStyle = alpha(accent, 0.92);
    for (const line of wrap(ctx, media.tagline, inner * 0.92, 2)) {
      ctx.fillText(line, pad, y);
      y += gSize * 1.3;
    }
    y -= gSize * 0.3;
  }

  // --- Les genres : des mots séparés par des points, pas des pastilles. Trois
  //     gélules cerclées de couleur, c'était l'aveu du modèle tout fait.
  const genres = (media.genres || []).filter(Boolean).slice(0, 3);
  if (genres.length) {
    y += h * 0.036;
    ctx.font = `700 ${px(w * 0.024)}px ${SANS}`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const track = px(w * 0.014);
    let line = genres.map((g) => g.toUpperCase()).join("   ·   ");
    while (genres.length > 1 && trackedWidth(ctx, line, track) > inner) {
      genres.pop();
      line = genres.map((g) => g.toUpperCase()).join("   ·   ");
    }
    trackedText(ctx, line, pad, y, track);
  }

  // ------------------------------------------------- le pied, posé d'abord --
  // Tout ce qui suit est calé DEPUIS LE BAS. C'est le seul moyen d'avoir un dos
  // qui ne se disloque jamais : le résumé prend la place qui reste, et non
  // l'inverse — un synopsis à rallonge poussait le cartouche hors de la face.
  const footRule = h - h * 0.125;
  const footCy = footRule + h * 0.052;

  const facts = [];
  // Le papier ne se compte pas en épisodes ni en minutes : au dos d'un volume
  // on lit des planches, des auteurs, un éditeur et un sens de lecture — c'est
  // exactement ce qu'imprime un quatrième de couverture.
  if (isComic(media)) {
    if (media.pageCount) facts.push(["Planches", String(media.pageCount)]);
    if (media.authors?.length) facts.push(["Auteurs", media.authors.slice(0, 2).join(", ")]);
    if (media.publisher) facts.push(["Éditeur", media.publisher]);
    if (isRtl(media)) facts.push(["Lecture", "Droite à gauche"]);
    // Le dos d'une boîte de jeu, c'est un autre cartouche : la machine, le
    // nombre de joueurs, la région, qui l'a fait. Ni durée ni langues — ce sont
    // les mentions d'un support vidéo, et elles sonneraient faux ici.
  } else if (isGame(media)) {
    facts.push(["Console", CONSOLE]);
    const players = media.cartridge?.players;
    if (players) facts.push(["Joueurs", players > 1 ? `1 à ${players}` : "1 joueur"]);
    if (media.cartridge?.region) facts.push(["Région", media.cartridge.region]);
    if (media.authors?.length)
      facts.push(["Développement", media.authors.slice(0, 2).join(", ")]);
    if (media.publisher) facts.push(["Éditeur", media.publisher]);
  } else if (media.kind === "series" && media.episodeCount) {
    facts.push([
      "Épisodes",
      media.runtime
        ? `${media.episodeCount} × ${media.runtime} min`
        : `${media.episodeCount}`,
    ]);
  } else if (media.runtime) {
    facts.push(["Durée", fmtDuration(media.runtime * 60)]);
  }
  const langs = isComic(media) || isGame(media) ? "" : audioTracks(media);
  if (langs) facts.push(["Langues", langs]);
  // Virgule décimale : le reste de la face est en français, un « 7.8 » y sonne
  // comme une valeur de base de données.
  if (media.rating)
    facts.push(["Note", `${String(media.rating).replace(".", ",")} / 10`]);
  if (media.network) facts.push(["Diffusion", media.network]);
  if (media.studio && facts.length < 4) facts.push(["Réalisation", media.studio]);

  const rows = Math.ceil(facts.length / 2);
  const rowH = h * 0.052;
  const factsBottom = footRule - h * 0.038;
  const factsTop = factsBottom - rows * rowH;

  const gap = w * 0.016;
  const tw = (inner - gap * 2) / 3;
  const th = (tw * 9) / 16;
  const stillsBottom = (facts.length ? factsTop - h * 0.03 : factsBottom) - h * 0.008;
  const stillsTop = stillsBottom - th;

  // -------------------------------------------------------------- résumé --
  // Le bloc qu'on lit vraiment. Il s'arrête net où commencent les images :
  // mieux vaut une phrase coupée qu'un dos qui se marche dessus.
  if (media.synopsis) {
    y += h * 0.04;
    const size = px(w * 0.033);
    const lineH = size * 1.62;
    const room = (shot ? stillsTop : factsTop) - h * 0.035 - y;
    const max = Math.max(0, Math.min(8, Math.floor(room / lineH) + 1));
    if (max > 0) {
      ctx.font = `400 ${size}px ${SANS}`;
      ctx.fillStyle = "rgba(255,255,255,0.76)";
      for (const line of wrap(ctx, media.synopsis, inner, max)) {
        ctx.fillText(line, pad, y);
        y += lineH;
      }
    }
  }

  // ------------------------------------------------------------- images --
  // Trois cadrages successifs du bandeau — gauche, centre, droite : trois
  // morceaux distincts de l'œuvre, comme les captures qu'on imprimait au dos.
  // Coins presque vifs et filet clair : une photo d'édition, pas une vignette
  // d'application.
  if (shot) {
    const radius = w * 0.006;
    for (let i = 0; i < 3; i++) {
      const x = pad + i * (tw + gap);
      ctx.save();
      roundRect(ctx, x, stillsTop, tw, th, radius);
      ctx.clip();
      const ratio = Math.max((tw * 3) / shot.width, th / shot.height);
      const dw = shot.width * ratio;
      const dh = shot.height * ratio;
      ctx.drawImage(shot, x - (i * (dw - tw)) / 2, stillsTop + (th - dh) / 2, dw, dh);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = px(w * 0.002);
      roundRect(ctx, x, stillsTop, tw, th, radius);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------- cartouche --
  // Deux colonnes, un filet au-dessus, rien d'autre. Le libellé en toutes
  // petites capitales dans la teinte, la valeur en blanc : c'est la mise en
  // page d'un dos de disque, et elle n'a pas besoin d'être encadrée.
  if (facts.length) {
    rule(ctx, pad, factsTop - h * 0.024, inner, HAIR, px(h * 0.0012));
    const colW = inner / 2;
    facts.forEach(([label, value], i) => {
      const cx = pad + (i % 2) * colW;
      const top = factsTop + Math.floor(i / 2) * rowH;
      ctx.font = `700 ${px(w * 0.021)}px ${SANS}`;
      ctx.fillStyle = alpha(accent, 0.85);
      trackedText(ctx, label.toUpperCase(), cx, top + h * 0.016, px(w * 0.008));
      const vSize = px(w * 0.03);
      ctx.font = `600 ${vSize}px ${SANS}`;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(
        fitOneLine(
          ctx,
          value,
          colW - w * 0.04,
          (s) => `600 ${s}px ${SANS}`,
          vSize,
          px(w * 0.021)
        ),
        cx,
        top + h * 0.042
      );
    });
  }

  // --------------------------------------------------------------- pied --
  // Visa d'âge et provenance à gauche, la marque à droite. Le visa est CERCLÉ,
  // pas rempli : la pastille blanche pleine était la tache la plus voyante de
  // toute la face, alors qu'elle ne porte qu'une mention légale.
  rule(ctx, pad, footRule, inner, HAIR, px(h * 0.0014));
  ctx.textBaseline = "middle";

  let footX = pad;
  const visa = media.certification;
  if (visa) {
    const label = visa.length > 4 ? visa.toUpperCase() : visa;
    const vSize = px(label.length > 4 ? w * 0.023 : w * 0.036);
    ctx.font = `700 ${vSize}px ${SANS}`;
    const vw = Math.max(w * 0.085, ctx.measureText(label).width + w * 0.048);
    const vh = h * 0.048;
    ctx.strokeStyle = "rgba(255,255,255,0.48)";
    ctx.lineWidth = px(w * 0.0026);
    roundRect(ctx, footX, footCy - vh / 2, vw, vh, w * 0.008);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.fillText(label, footX + vw / 2, footCy + h * 0.001);
    ctx.textAlign = "left";
    footX += vw + w * 0.028;
  }

  // La marque, MESURÉE D'ABORD : c'est elle qui borne la place laissée à la
  // provenance. Sans cette borne, « DOMAINE PUBLIC » (la plus longue des trois)
  // venait buter dans le M de MyPlayLog — deux mentions collées, et tout le
  // soin du pied tombait à l'eau.
  const markTrack = px(w * 0.018);
  ctx.font = `600 ${px(w * 0.029)}px ${SERIF}`;
  const markW = trackedWidth(ctx, "MYPLAYLOG", markTrack);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  trackedText(ctx, "MYPLAYLOG", w - pad, footCy + h * 0.002, markTrack, "right");

  const licence = LICENCES[media.licence]?.label?.toUpperCase() || "";
  if (licence) {
    const room = w - pad - markW - w * 0.05 - footX;
    const fit = fitTracked(
      ctx,
      licence,
      room,
      (s) => `700 ${s}px ${SANS}`,
      px(w * 0.019),
      px(w * 0.013),
      0.42
    );
    ctx.fillStyle = alpha(accent, 0.78);
    trackedText(ctx, fit.text, footX, footCy + h * 0.002, fit.track);
  }

  grain(ctx, w, h, 0.035);
  return canvas;
}

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
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out.slice(0, 2).join(" · ");
}
// ------------------------------------------------------------- assemblage --

// Peint les trois faces utiles d'un boîtier, à l'aspect EXACT de chacune
// (calculé depuis BOX) : sans ça, l'affiche est étirée et le titre de tranche
// penche. L'affiche n'est chargée qu'une fois pour les trois.
//
// `artwork` dit si le visuel est bien arrivé : le boîtier se peint correctement
// sans lui (dégradé + titre), donc l'appelant a besoin de ce drapeau pour
// signaler un problème plutôt que de laisser croire à un choix de design.
//
// LE RÉSULTAT EST UNE SEULE FEUILLE, jamais trois faces séparées. C'est une
// contrainte du rendu, et elle est structurante : le boîtier 3D n'est plus un
// cube portant trois images, c'est une surface continue qui fait le tour de
// l'objet en épousant ses arêtes arrondies (voir CollectionShelf). Trois
// textures distinctes y laisseraient trois coutures, précisément au seul
// endroit où l'œil les cherche.
//
// `cuts` dit où tombent les deux plis dans cette feuille, en fraction de sa
// largeur : mesurés à la main sur une jaquette fournie, déduits des panneaux
// quand on l'a composée nous-mêmes.
export async function paintCase(media, quality = 1024) {
  const box = boxOf(media);

  // Les faces sont composées AVEC la typo maison : peindre avant que les
  // polices soient chargées figerait un repli système dans la texture, et le
  // boîtier garderait cette typo jusqu'au rechargement de la page.
  await ensureFonts();

  // Une jaquette complète fournie à la main l'emporte sur tout : c'est l'objet
  // que quelqu'un a dessiné, on ne compose rien par-dessus — et on ne la
  // redécoupe même plus, elle part telle quelle.
  const wrap = await loadImage(media.wrap);
  if (wrap) return { artwork: true, ...trimSheet(wrap, box) };

  // Le bandeau part avec l'affiche : il sert de fond et de vignettes au dos.
  // Chargé seulement s'il existe et diffère — deux requêtes par boîtier, ce
  // n'est pas rien sur une grande étagère.
  const [img, backdrop] = await Promise.all([
    loadImage(media.poster),
    media.backdrop && media.backdrop !== media.poster ? loadImage(media.backdrop) : null,
  ]);
  // Les trois faces sont peintes séparément — chacune a sa composition, ses
  // proportions et ses règles — puis COUSUES bout à bout dans l'ordre de la
  // jaquette dépliée. Ce qui en sort est indiscernable d'une jaquette fournie,
  // et suit donc exactement le même chemin ensuite.
  const back = paintBack(media, img, backdrop, (quality * box.d) / box.h, quality);
  const spine = paintSpine(media, img, (quality * box.w) / box.h, quality);
  const sleeve = paintSleeve(media, img, (quality * box.d) / box.h, quality);
  return { artwork: !!img, ...stitchSheet(back, spine, sleeve) };
}

// Une jaquette fournie n'est presque jamais cadrée sur son illustration : un
// PDF d'impression arrive avec du fond perdu, des marges de coupe et parfois
// une page entière autour. La FENÊTRE UTILE, relevée à la main dans l'outil de
// mesure, est donc découpée ici — et les plis, notés en fractions de l'image
// d'origine, sont recalculés en fractions de ce qui reste.
//
// Le plafond de définition n'est pas un détail : une jaquette d'impression fait
// couramment 5000 px de large, et au-delà de 4096 la texture est refusée par
// une bonne part des GPU mobiles — le boîtier sortirait tout noir, sans erreur.
const MAX_TEX = 4096;

function trimSheet(img, box) {
  const total = box.d * 2 + box.w;
  const cut =
    box.spineW > 0 && box.spineX >= 0
      ? { x: box.spineX, w: box.spineW }
      : { x: box.d / total, w: box.w / total };

  const cx = box.cropX ?? 0;
  const cy = box.cropY ?? 0;
  const cw = box.cropW ?? 1;
  const ch = box.cropH ?? 1;
  const whole = cx === 0 && cy === 0 && cw === 1 && ch === 1;
  const srcW = Math.max(1, Math.round(img.width * cw));
  const srcH = Math.max(1, Math.round(img.height * ch));

  // Rien à rogner ET une image que le GPU digère : on la sert telle quelle,
  // sans la recopier dans un canvas pour rien.
  if (whole && Math.max(img.width, img.height) <= MAX_TEX)
    return { sheet: img, cuts: cut };

  const scale = Math.min(1, MAX_TEX / Math.max(srcW, srcH));
  const canvas = canvasOf(srcW * scale, srcH * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    img.width * cx,
    img.height * cy,
    srcW,
    srcH,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return {
    sheet: canvas,
    // Les plis étaient repérés sur l'image ENTIÈRE : rapportés à la fenêtre.
    cuts: { x: (cut.x - cx) / cw, w: cut.w / cw },
  };
}

// Coud les trois faces en une seule feuille et dit où sont les plis.
//
// Les traits de coupe se déduisent des LARGEURS RÉELLES des canvas, pas des
// proportions théoriques du boîtier : chacune a été arrondie au pixel de son
// côté, et rejouer le calcul en fractions décalerait les plis d'un demi-pixel —
// assez pour qu'un liseré de la face voisine apparaisse sur l'arête.
function stitchSheet(back, spine, sleeve) {
  const width = back.width + spine.width + sleeve.width;
  const canvas = canvasOf(width, back.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(back, 0, 0);
  ctx.drawImage(spine, back.width, 0);
  ctx.drawImage(sleeve, back.width + spine.width, 0);
  return {
    sheet: canvas,
    cuts: { x: back.width / width, w: spine.width / width },
  };
}

// Part de la jaquette dépliée occupée par la couverture : sert à cadrer la
// couverture seule dans une vignette CSS, sans redécouper l'image.
export function wrapCoverInset(media) {
  const box = boxOf(media);
  const share =
    box.spineW > 0 && box.spineX >= 0
      ? 1 - box.spineX - box.spineW
      : box.d / (box.d * 2 + box.w);
  return { zoom: 100 / share, ratio: box.d / box.h };
}
