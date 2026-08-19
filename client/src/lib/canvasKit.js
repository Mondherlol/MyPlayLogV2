// ======================================================================
//  L'atelier — les gestes communs à toutes les faces qu'on peint
// ======================================================================
// CE FICHIER N'A AUCUNE OPINION SUR LES BOÎTIERS. Il ne connaît ni jaquette, ni
// dos, ni tranche : il sait charger une image sans souiller un canvas, poser du
// texte interlettré, dériver une teinte, fabriquer un champ de couleur à partir
// d'une affiche, et semer du grain de papier.
//
// Il existe parce que deux ateliers s'en servent maintenant :
//
//   • `collection.js` — les faces composées « à la maison » (tranche, papier,
//     boîte de jeu) ;
//   • `dvdSkin.js`    — le gabarit de jaquette vidéo, qui imite un vrai boîtier
//     de DVD et pèse à lui seul autant que tout le reste.
//
// Sans ce partage, l'un des deux aurait recopié l'autre — et deux copies de
// `trackedText` qui divergent, c'est un dos dont la typo ne ressemble plus à
// celle de sa tranche.

// ------------------------------------------------------- images / canvas --

export function canvasOf(width, height) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width));
  c.height = Math.max(2, Math.round(height));
  return c;
}

// Charge une image utilisable dans un canvas destiné à WebGL. `crossOrigin`
// est obligatoire : sans en-tête CORS, le canvas devient « souillé » et la
// texture échoue (boîtier de couleur unie sur le rayonnage).
function loadTag(src, cors) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = "anonymous";
    // Le décodage est demandé À PART, et hors du fil principal. Sans ça il a
    // lieu au premier `drawImage`, donc en plein milieu de la peinture : une
    // affiche de 1500 px décodée là, c'est une saccade, et quarante boîtiers
    // font quarante saccades pendant que l'étagère se garnit.
    img.decoding = "async";
    img.onload = () => {
      const done = () => resolve(img);
      if (img.decode) img.decode().then(done, done);
      else done();
    };
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
export function drawCover(ctx, img, x, y, w, h, ax = 0.5, ay = 0.5) {
  const ratio = Math.max(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  ctx.drawImage(img, x + (w - dw) * ax, y + (h - dh) * ay, dw, dh);
}

// Dessine une image ENTIÈRE dans un cadre, sans la recadrer ni la déformer, et
// centrée. C'est le geste d'un logo : un titre détouré dont on coupe un bout
// n'est plus un titre, et étiré il devient la marque de quelqu'un d'autre.
// Rend le rectangle réellement occupé — le reste de la composition en a besoin
// pour savoir où reprendre.
export function drawFit(ctx, img, x, y, w, h, align = 0.5) {
  const ratio = Math.min(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  const dx = x + (w - dw) * align;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
  return { x: dx, y: dy, w: dw, h: dh };
}

// Texte coupé en lignes qui tiennent dans `max`, `lines` au plus. Ce qui
// dépasse est signalé par des points de suspension SUR LA DERNIÈRE LIGNE —
// un résumé qui s'arrête net au milieu d'un mot fait bâclé.
export function wrapText(ctx, text, max, lines = 3) {
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
export function shade(hex, t) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return hex || "#f2b70b";
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const rgb = m.slice(1).map((v) => Math.round(parseInt(v, 16) * (1 - k) + to * k));
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return `rgba(242, 183, 11, ${a})`;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// La teinte du titre, ÉCLAIRCIE jusqu'à devenir une encre. Servie telle quelle,
// une couleur tirée d'une affiche (donc souvent saturée à bloc) tache le dos et
// se bat avec le texte ; éclaircie, elle reste reconnaissable, se pose sur du
// sombre sans crier, et sert de fil conducteur entre les trois faces.
export const accentInk = (color) => shade(color, 0.55);

// Clair ou sombre ? La luminance perçue (pas la moyenne des canaux : l'œil voit
// le vert deux fois plus que le rouge et six fois plus que le bleu — un bleu
// nuit et un vert pomme de « moyenne » identique n'ont rien à voir).
export function luminanceOf(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// L'ENCRE QUI SE LIT SUR CE FOND. Une couverture d'un jaune choisi à la main ne
// doit pas obliger à écrire en blanc dessus « parce que le gabarit fait comme
// ça » : on retourne le texte en noir, comme le ferait n'importe quel imprimeur.
// C'est ce qui permet d'offrir VRAIMENT le choix de la couleur, au lieu de
// n'accepter que les teintes sombres.
export const inkOn = (hex) => (luminanceOf(hex) > 0.56 ? "#14151a" : "#ffffff");

// Rectangle à coins arrondis — les pastilles, les fenêtres, les cartouches.
export function roundRect(ctx, x, y, w, h, r) {
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
export const SERIF = '"Playfair Display", "Times New Roman", Georgia, serif';
export const SANS = "Inter, system-ui, sans-serif";

// UN CANVAS NE DÉCLENCHE PAS LE CHARGEMENT D'UNE POLICE. `ctx.font` accepte
// n'importe quel nom et retombe sans rien dire sur un repli système si la fonte
// n'a jamais servi dans le DOM. La didone ne sert QUE sur les boîtiers : sans
// cette demande explicite, toutes les jaquettes sortiraient en Times — et
// `document.fonts.ready` seul ne le verrait même pas, puisqu'il n'attend que ce
// qui est DÉJÀ demandé.
// Toutes les familles que le studio peut désigner (voir FONTS dans dvdSkin) :
// une fonte jamais demandée dans le DOM n'est pas chargée, et `ctx.font`
// retombe alors en silence sur du Times. Les fontes système (Georgia, Impact,
// Courier) n'ont rien à faire ici — elles sont déjà sur la machine.
const FACES = [
  '600 40px "Playfair Display"',
  '700 40px "Playfair Display"',
  'italic 500 40px "Playfair Display"',
  "500 40px Inter",
  "700 40px Inter",
  '500 40px "Space Grotesk"',
  '700 40px "Space Grotesk"',
  "500 40px Fredoka",
  "600 40px Fredoka",
];
let fontsReady = null;
export function ensureFonts() {
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
export function trackedWidth(ctx, text, track) {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  let w = -track;
  for (const ch of chars) w += ctx.measureText(ch).width + track;
  return w;
}

export function trackedText(ctx, text, x, y, track, align = "left") {
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
export function rule(ctx, x, y, w, color, weight = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.max(1, Math.round(weight)));
}

// Même office que `fitOneLine`, mais pour du texte INTERLETTRÉ : la largeur
// d'une ligne espacée ne se mesure pas avec `measureText`, il faut l'additionner
// (voir `trackedWidth`). L'espacement suit la taille — le réduire seul donnerait
// des capitales serrées sur une tranche et aérées sur la suivante.
export function fitTracked(ctx, text, maxRun, font, size, min, ratio) {
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
export function fitOneLine(ctx, text, maxWidth, font, size, min) {
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
export function grain(ctx, w, h, amount = 0.05) {
  ctx.save();
  ctx.globalAlpha = amount;
  for (let i = 0; i < w * h * 0.004; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
  ctx.restore();
}

// Le carton d'un boîtier n'est jamais plat : ses deux arêtes sont pliées, donc
// plus sombres, et la lumière file au centre. Sans ça, une tranche ressemble à
// un rectangle de couleur. Dosé léger : la tranche est la face qu'on LIT, elle
// ne doit pas s'assombrir pour faire joli.
export function foldShading(ctx, w, h) {
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
// LE FOND DE TOUTES LES FACES. La couleur ne vient pas d'un champ de la base
// mais de L'AFFICHE elle-même : on la réduit à une poignée de pixels, on la
// réétale, et il ne reste que ses tons — une lumière, pas une image. Posée sur
// un aplat très sombre de la teinte, elle donne à chaque boîtier SES couleurs
// sans jamais menacer la lisibilité du texte qui viendra dessus.

// Flou fait main : réduction brutale puis remontée en deux paliers, le lissage
// du navigateur faisant le travail. `ctx.filter` ferait la même chose en une
// ligne, mais il manque encore à l'appel sur assez de navigateurs pour qu'on ne
// puisse pas bâtir le fond dessus.
export function blurUp(ctx, img, w, h, cover) {
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
// `bg` est LA COULEUR EXACTE du fond, quand quelqu'un l'a choisie. Sans elle, on
// retombe sur la teinte de la fiche fortement assombrie — c'est le bon réglage
// pour une couleur qui n'a JAMAIS été choisie pour couvrir une face entière (la
// pastille dorée par défaut, servie telle quelle, donnait les boîtiers fluo
// d'avant). Mais dès que l'admin pose une couleur dans le studio, on la sert au
// pixel près : un sélecteur de couleur qui rend autre chose que ce qu'on a
// désigné n'est pas un sélecteur de couleur.
export function makeField(
  w,
  h,
  color,
  img,
  { cover = false, light = 0.62, veil = 0.5, bg = null } = {}
) {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = bg || shade(color, -0.82);
  ctx.fillRect(0, 0, w, h);

  if (img) {
    ctx.save();
    ctx.globalAlpha = light;
    blurUp(ctx, img, w, h, cover);
    ctx.restore();
  } else {
    // PAS DE VISUEL : UN APLAT, ET RIEN D'AUTRE. Il y avait ici une descente en
    // diagonale « pour que la face garde un modelé » — en pratique, une coulée
    // de couleur qui virait au noir dans un coin, qu'on ne pouvait ni régler ni
    // éteindre, et qui se voyait d'autant plus que la face était nue. Une
    // couverture cartonnée unie, ça existe et c'est net ; un dégradé raté, non.
    ctx.fillStyle = bg || shade(color, -0.62);
    ctx.fillRect(0, 0, w, h);
    // Et on s'arrête là. Le voile et le vignettage qui suivent n'existent que
    // pour SAUVER LA LISIBILITÉ SUR UNE IMAGE (une affiche à fond blanc sous du
    // texte blanc) : sur un aplat, ils ne font que salir une couleur qu'on
    // vient précisément de choisir unie.
    return canvas;
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
// `up` renverse le sens : le champ recouvre le HAUT de la zone au lieu du bas.
// C'est ce qu'il faut à une vignette posée en pied de tranche — elle doit se
// perdre vers le haut, sinon la fondue mange précisément le bord qu'on voulait
// voir net.
export function fadeInto(ctx, field, x, y, w, h, up = false) {
  const patch = canvasOf(w, h);
  const p = patch.getContext("2d");
  p.drawImage(field, x, y, w, h, 0, 0, patch.width, patch.height);
  p.globalCompositeOperation = "destination-in";
  const g = p.createLinearGradient(0, 0, 0, patch.height);
  g.addColorStop(0, up ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
  g.addColorStop(1, up ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
  p.fillStyle = g;
  p.fillRect(0, 0, patch.width, patch.height);
  ctx.drawImage(patch, x, y, w, h);
}

// ----------------------------------------------------------- détourage --
//
// UN LOGO N'EST PAS UNE IMAGE, C'EST UNE FORME. Les logos de studios servis par
// TMDB sont presque tous NOIRS sur fond transparent : posés tels quels en pied
// d'un dos sombre, ils disparaissent — on croit à un bug d'affichage. Ceux des
// titres, eux, sont tantôt blancs (prévus pour une affiche) tantôt noirs
// (repris d'un dossier de presse), et rien dans le fichier ne le dit.
//
// On regarde donc la MATIÈRE : la luminance moyenne des pixels opaques. Sombre
// ? on repeint la forme en clair, en gardant sa silhouette exacte
// (`source-in`). Clair ? on ne touche à rien — un logo blanc est déjà à sa
// place sur une jaquette de nuit.
// `mode` dit QUAND repeindre :
//   • "ifDark"  — seulement si la forme est sombre (le cas par défaut : un logo
//                 déjà blanc est à sa place sur une jaquette de nuit) ;
//   • "ifLight" — seulement si elle est claire (une couverture d'une couleur
//                 vive choisie à la main : c'est le logo BLANC qui s'y perd) ;
//   • "always"  — sans se poser de question (les marques de support, qui
//                 circulent en noir comme en blanc).
export function tintLogo(img, color = "#ffffff", mode = "ifDark") {
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) return img;
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  if (mode !== "always") {
    let sum = 0;
    let seen = 0;
    // Combien la forme est COLORÉE. C'est la mesure qui manquait, et son
    // absence coûtait cher : un logo de série — deux couleurs, un contour noir,
    // un dégradé — passait le test de luminance (sa moyenne est sombre) et
    // ressortait en PÂTÉ BLANC, silhouette pleine, illisible. Un logo qui a des
    // couleurs a été dessiné avec elles ; on n'y touche pas, quel que soit le
    // fond. Le détourage n'est là que pour les logos MONOCHROMES, ceux qui ne
    // sont qu'une forme d'une seule encre.
    let chroma = 0;
    try {
      // Un échantillon suffit largement, et coûte cent fois moins qu'une
      // lecture pixel par pixel d'un PNG de 500 px : on saute de quatre en
      // quatre dans les deux sens.
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
          const i = (y * w + x) * 4;
          if (data[i + 3] < 40) continue; // transparent : pas de la forme
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          // L'écart entre le canal le plus fort et le plus faible : nul sur du
          // gris, du noir et du blanc ; élevé dès qu'il y a une couleur.
          chroma += Math.max(r, g, b) - Math.min(r, g, b);
          seen++;
        }
      }
    } catch {
      // Canvas souillé : on ne sait pas lire la matière, et repeindre à
      // l'aveugle abîmerait un logo couleur. On rend l'image telle quelle.
      return img;
    }
    if (!seen) return img;
    // Au-delà d'une trentaine de points d'écart moyen, la forme est colorée :
    // on la laisse telle quelle. En deçà, c'est un aplat d'une seule encre, et
    // le repeindre ne lui enlève rien.
    if (chroma / seen > 30) return img;
    const lit = sum / seen > 105;
    // La forme est déjà du bon côté : on ne la touche pas. Repeindre pour rien
    // aplatirait un logo en couleur (un logo bicolore deviendrait une
    // silhouette) — c'est le genre de dégât qui ne se voit que sur le titre
    // qu'on n'a pas regardé.
    if (mode === "ifDark" ? lit : !lit) return img;
  }

  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}
