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
};

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
};

// Les trois lecteurs du poste. `piloted` dit si l'on tient VRAIMENT la lecture
// (position, pause, volume) : c'est ce qui décide de l'habillage du téléviseur,
// puisqu'une barre de progression sur un lecteur qu'on ne pilote pas est un
// mensonge — voir CrtTv.
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

// Les sources d'un épisode, dans l'ordre : la principale puis ses miroirs.
// Un épisode d'avant les lecteurs multiples n'a qu'un videoId — il reste
// lisible sans migration.
export function episodeSources(ep) {
  if (!ep) return [];
  const provider = ep.provider || (ep.videoId ? "youtube" : "embed");
  const main = {
    provider,
    videoId: ep.videoId || null,
    url: ep.url || "",
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
};

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
function drawCover(ctx, img, x, y, w, h) {
  const ratio = Math.max(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// Texte coupé en lignes qui tiennent dans `max`, `lines` au plus. Ce qui
// dépasse est signalé par des points de suspension SUR LA DERNIÈRE LIGNE —
// un résumé qui s'arrête net au milieu d'un mot fait bâclé.
function wrap(ctx, text, max, lines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  let cut = false;
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = words[i];
      if (out.length === lines) {
        cut = true;
        break;
      }
    } else line = next;
  }
  if (!cut && line && out.length < lines) out.push(line);
  if (cut || (line && out.length === lines)) {
    let last = out[lines - 1];
    while (last.length > 4 && ctx.measureText(`${last}…`).width > max) {
      last = last.slice(0, -1).trim();
    }
    out[lines - 1] = `${last}…`;
  }
  return out.slice(0, lines);
}

// ------------------------------------------------------ boîte à couleurs --

// Un ton de la teinte du titre, éclairci (t > 0) ou assombri (t < 0). Toute la
// tranche est bâtie là-dessus : une seule couleur servie par l'API, déclinée en
// bandeaux, ombres et filets — c'est ce qui fait qu'un boîtier a l'air imprimé
// plutôt que colorié.
function shade(hex, t) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return hex || "#f2b70b";
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const [r, g, b] = m.slice(1).map((v) => Math.round(parseInt(v, 16) * (1 - k) + to * k));
  return `rgb(${r}, ${g}, ${b})`;
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

// La pastille de support, en haut de la tranche : un DISQUE, pas un mot. Le
// dessin se lit à 30 px de large là où trois lettres deviennent une bouillie —
// et un disque optique dit « DVD » sans qu'on ait à l'écrire.
//
// `hole` reçoit la couleur du fond : on repeint le trou plutôt que de le
// découper (une découpe laisserait une zone transparente sur une texture dont
// le matériau n'est pas en mode transparent — donc un trou noir).
function drawDisc(ctx, cx, cy, r, ink, hole) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Le reflet du disque : un quartier plus pâle, comme la lumière qui court
  // sur la galette.
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, -Math.PI * 0.9, -Math.PI * 0.55);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.33, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
  ctx.globalAlpha = 0.5;
  ctx.stroke();
  ctx.restore();
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

// Le carton d'un boîtier n'est jamais plat : ses deux arêtes sont pliées, donc
// plus sombres, et la lumière file au centre. Sans ça, une tranche ressemble à
// un rectangle de couleur. Dosé léger : la tranche est la face qu'on LIT, elle
// ne doit pas s'assombrir pour faire joli.
function foldShading(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.4)");
  g.addColorStop(0.14, "rgba(0,0,0,0.07)");
  g.addColorStop(0.44, "rgba(255,255,255,0.1)");
  g.addColorStop(0.66, "rgba(255,255,255,0.03)");
  g.addColorStop(0.9, "rgba(0,0,0,0.1)");
  g.addColorStop(1, "rgba(0,0,0,0.44)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Encre lisible sur une couleur donnée : blanc sur teinte sombre, presque noir
// sur teinte claire. Sans ça, un titre blanc sur une tranche jaune disparaît.
function readableInk(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  // Luminance relative (WCAG), approchée sans la correction gamma exacte.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.58 ? "#17181f" : "#ffffff";
}

function canvasOf(width, height) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(width));
  c.height = Math.max(2, Math.round(height));
  return c;
}

// ---------------------------------------------------------------- tranche --
// LA face qu'on voit dans le rayon — 90 px de large pour 1024 de haut. C'est
// une AFFICHE VERTICALE, et elle se lit dans cet ordre :
//
//   ┌──────┐  pastille de support : un disque, pas le mot « DVD »
//   │  ◎   │  (trois lettres à cette largeur, c'est une bouillie)
//   ├──────┤  fenêtre d'affiche — la seule image du rayon
//   │ IMG  │
//   ├──────┤  la saga, en petites capitales espacées
//   │ SAGA │
//   │      │
//   │TITRE │  le titre, à la verticale, plein champ
//   │      │
//   ├──────┤  pied : année (et nombre d'épisodes)
//   │ 2026 │
//   └──────┘
//
// Toute la tranche est bâtie sur LA SEULE TEINTE du titre, déclinée en tons :
// bandeaux sombres, champ dégradé, filets clairs. C'est ce qui donne un objet
// imprimé plutôt qu'un rectangle colorié.
function paintSpine(media, img, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = media.color || "#f2b70b";
  const ink = readableInk(color);
  const dark = shade(color, -0.62); // bandeaux de tête et de pied
  const px = (v) => Math.max(1, Math.round(v));

  // --- Fond : la teinte, mais dégradée. Un aplat parfait fait autocollant ;
  //     une impression garde toujours une descente vers le bas.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, shade(color, 0.12));
  bg.addColorStop(0.45, color);
  bg.addColorStop(1, shade(color, -0.22));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const capH = h * 0.075;
  const artH = img ? h * 0.25 : 0;
  const footH = h * 0.115;
  const hasSaga =
    media.franchise && media.franchise.toLowerCase() !== media.title.toLowerCase();
  const sagaH = hasSaga ? h * 0.055 : 0;

  // --- 1. Capuchon : la pastille de support. Un DISQUE en blanc sur la teinte
  //     sombre — dessiné, pas écrit : trois lettres à cette largeur ne sont
  //     qu'une tache, et un disque optique se reconnaît de loin.
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, w, capH);
  drawDisc(ctx, w / 2, capH * 0.46, w * 0.29, "#ffffff", dark);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `800 ${px(w * 0.15)}px Inter, system-ui, sans-serif`;
  ctx.letterSpacing = `${px(w * 0.04)}px`;
  ctx.fillText(FORMATS[media.format]?.label || "DVD", w / 2 + w * 0.02, capH * 0.85);
  ctx.letterSpacing = "0px";
  ctx.restore();

  // --- 2. Fenêtre d'affiche : la seule image du rayon quand les boîtiers sont
  //     rangés. Surtout pas de voile par-dessus — l'ancienne version la noyait.
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, capH, w, artH);
    ctx.clip();
    drawCover(ctx, img, 0, capH, w, artH);
    // Un souffle de teinte en bas de la fenêtre : l'image entre dans la
    // couleur au lieu de s'arrêter sur une arête franche.
    const fade = ctx.createLinearGradient(0, capH + artH * 0.72, 0, capH + artH);
    fade.addColorStop(0, alpha(color, 0));
    fade.addColorStop(1, alpha(color, 0.85));
    ctx.fillStyle = fade;
    ctx.fillRect(0, capH + artH * 0.72, w, artH * 0.28);
    ctx.restore();
  }

  // --- 3. La saga, en petites capitales espacées, juste sous l'affiche.
  if (hasSaga) {
    ctx.save();
    ctx.translate(w * 0.5, capH + artH + sagaH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = alpha(ink === "#ffffff" ? "#ffffff" : "#17181f", 0.62);
    const saga = fitOneLine(
      ctx,
      media.franchise.toUpperCase(),
      h * 0.5,
      (s) => `800 ${s}px Inter, system-ui, sans-serif`,
      px(w * 0.155),
      px(w * 0.1)
    );
    ctx.letterSpacing = `${px(w * 0.035)}px`;
    ctx.fillText(saga, 0, 0);
    ctx.letterSpacing = "0px";
    ctx.restore();
  }

  // --- 4. Le titre, plein champ. Il occupe tout ce qui reste : c'est LUI
  //     qu'on cherche des yeux en passant devant l'étagère.
  const fieldTop = capH + artH + sagaH;
  const fieldH = h - fieldTop - footH;
  ctx.save();
  ctx.translate(w / 2, fieldTop + fieldH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const title = fitOneLine(
    ctx,
    media.title,
    fieldH * 0.94,
    (s) => `700 ${s}px "Space Grotesk", Inter, sans-serif`,
    px(w * 0.5),
    px(w * 0.22)
  );
  // Une ombre portée très courte : le titre se décolle de la couleur sans
  // qu'on voie d'ombre. Sur teinte claire, c'est une lumière.
  ctx.shadowColor = ink === "#ffffff" ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.35)";
  ctx.shadowOffsetX = px(w * 0.02);
  ctx.shadowBlur = px(w * 0.05);
  ctx.fillStyle = ink;
  ctx.fillText(title, 0, 0);
  ctx.restore();

  // --- 5. Pied : bandeau sombre, année et volume. Le contraste en bas assied
  //     l'objet sur la planche.
  ctx.fillStyle = dark;
  ctx.fillRect(0, h - footH, w, footH);
  ctx.fillStyle = alpha(color, 0.9);
  ctx.fillRect(0, h - footH, w, px(h * 0.004));
  ctx.save();
  ctx.translate(w / 2, h - footH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const foot = [
    fmtYears(media),
    media.kind === "series" && media.episodeCount ? `${media.episodeCount} ÉP.` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  ctx.font = `800 ${px(w * 0.2)}px Inter, system-ui, sans-serif`;
  ctx.letterSpacing = `${px(w * 0.02)}px`;
  ctx.fillText(foot, 0, 0);
  ctx.letterSpacing = "0px";
  ctx.restore();

  foldShading(ctx, w, h);
  grain(ctx, w, h, 0.035);
  return canvas;
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

  // --- Repli : pas d'affiche. On compose une couverture sobre plutôt que de
  //     laisser une face nue.
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, shade(color, 0.1));
  bg.addColorStop(1, "#12131a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  if (media.franchise) {
    ctx.font = `800 ${Math.round(w * 0.04)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.letterSpacing = `${Math.round(w * 0.012)}px`;
    ctx.fillText(media.franchise.toUpperCase(), w / 2, h * 0.42);
    ctx.letterSpacing = "0px";
  }
  const size = media.title.length > 26 ? w * 0.11 : w * 0.15;
  ctx.font = `700 ${Math.round(size)}px "Space Grotesk", Inter, sans-serif`;
  ctx.fillStyle = "#fff";
  let y = h * 0.5;
  for (const line of wrap(ctx, media.title, w * 0.84, 3)) {
    ctx.fillText(line, w / 2, y);
    y += size * 1.06;
  }
  grain(ctx, w, h, 0.05);
  return canvas;
}

// -------------------------------------------------------------------- dos --
// LE VRAI DOS D'UN BOÎTIER. On le voit dès que l'objet pivote dans la vitrine,
// et c'est là que vit tout ce qu'une jaquette ne dit pas :
//
//   • la couverture en fond, floutée et assombrie — le fond d'un dos de DVD
//     est toujours une déclinaison de la face avant ;
//   • le titre, le résumé ;
//   • trois vignettes prises dans le bandeau du titre, comme les captures
//     qu'on imprimait au dos ;
//   • le cartouche technique : épisodes, langues, note, diffusion ;
//   • le visa d'âge, la provenance et le code-barres.
//
// Rien n'y est inventé : chaque bloc n'apparaît que si la donnée existe.
function paintBack(media, img, backdrop, width, height) {
  const canvas = canvasOf(width, height);
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  const color = media.color || "#f2b70b";
  const pad = w * 0.075;
  const px = (v) => Math.max(1, Math.round(v));
  const shot = backdrop || img;

  // --- Fond : la couverture, floutée à outrance et noyée de sombre.
  ctx.fillStyle = "#0c0d13";
  ctx.fillRect(0, 0, w, h);
  if (shot) {
    ctx.save();
    // `filter` n'est pas garanti partout : sans lui, on agrandit franchement
    // l'image, ce qui donne un flou de pauvre mais fait le même office.
    const blurred = "filter" in ctx;
    if (blurred) ctx.filter = `blur(${px(w * 0.06)}px) saturate(1.2)`;
    const over = blurred ? 1.12 : 2.4;
    drawCover(ctx, shot, -w * (over - 1) / 2, -h * (over - 1) / 2, w * over, h * over);
    ctx.restore();
  }
  const scrim = ctx.createLinearGradient(0, 0, 0, h);
  scrim.addColorStop(0, "rgba(10,11,17,0.82)");
  scrim.addColorStop(0.5, "rgba(10,11,17,0.9)");
  scrim.addColorStop(1, "rgba(7,8,12,0.97)");
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, w, h);
  // Une lueur de la teinte dans l'angle haut : le dos appartient au même objet
  // que la tranche.
  const glow = ctx.createRadialGradient(w * 0.15, h * 0.08, 0, w * 0.15, h * 0.08, w * 0.9);
  glow.addColorStop(0, alpha(color, 0.3));
  glow.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // --- Bandeau de tête : nature de l'œuvre à gauche, support à droite.
  const bandH = h * 0.062;
  ctx.fillStyle = shade(color, -0.55);
  ctx.fillRect(0, 0, w, bandH);
  ctx.fillStyle = alpha(color, 0.95);
  ctx.fillRect(0, bandH - px(h * 0.003), w, px(h * 0.003));

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `800 ${px(w * 0.032)}px Inter, system-ui, sans-serif`;
  ctx.letterSpacing = `${px(w * 0.008)}px`;
  ctx.fillText(
    [KINDS[media.kind]?.label?.toUpperCase() || "", fmtYears(media)]
      .filter(Boolean)
      .join("  ·  "),
    pad,
    bandH / 2
  );
  ctx.letterSpacing = "0px";
  drawDisc(ctx, w - pad - w * 0.03, bandH / 2, w * 0.028, "#ffffff", shade(color, -0.55));

  // --- Titre + titre original.
  let y = bandH + h * 0.055;
  ctx.textAlign = "left";
  const tSize = media.title.length > 24 ? w * 0.072 : w * 0.092;
  ctx.font = `700 ${px(tSize)}px "Space Grotesk", Inter, sans-serif`;
  ctx.fillStyle = "#fff";
  for (const line of wrap(ctx, media.title, w - pad * 2, 2)) {
    ctx.fillText(line, pad, y);
    y += tSize * 1.05;
  }
  if (media.originalTitle && media.originalTitle !== media.title) {
    ctx.font = `italic 500 ${px(w * 0.034)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(
      fitOneLine(
        ctx,
        media.originalTitle,
        w - pad * 2,
        (s) => `italic 500 ${s}px Inter, system-ui, sans-serif`,
        px(w * 0.034),
        px(w * 0.026)
      ),
      pad,
      y + h * 0.006
    );
    y += h * 0.028;
  }

  // --- Genres, en pastilles cerclées de la teinte.
  const genres = (media.genres || []).slice(0, 3);
  if (genres.length) {
    y += h * 0.022;
    ctx.font = `700 ${px(w * 0.028)}px Inter, system-ui, sans-serif`;
    let x = pad;
    const pillH = h * 0.026;
    for (const g of genres) {
      const label = g.toUpperCase();
      const tw = ctx.measureText(label).width;
      const pw = tw + w * 0.045;
      if (x + pw > w - pad) break;
      ctx.strokeStyle = alpha(color, 0.55);
      ctx.lineWidth = px(w * 0.003);
      roundRect(ctx, x, y - pillH / 2, pw, pillH, pillH / 2);
      ctx.stroke();
      ctx.fillStyle = alpha(color, 0.14);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.textAlign = "center";
      ctx.fillText(label, x + pw / 2, y);
      ctx.textAlign = "left";
      x += pw + w * 0.018;
    }
    y += pillH;
  }

  // --- Résumé. Le bloc le plus haut du dos : c'est ce qu'on lit vraiment.
  if (media.synopsis) {
    y += h * 0.03;
    const size = px(w * 0.036);
    ctx.font = `400 ${size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    // Six lignes : au-delà, le cartouche technique et les vignettes n'ont plus
    // la place de tenir au-dessus du pied (visa, code-barres).
    for (const line of wrap(ctx, media.synopsis, w - pad * 2, 6)) {
      ctx.fillText(line, pad, y);
      y += size * 1.5;
    }
  }

  // --- Trois vignettes, prises à trois endroits du bandeau : le rappel des
  //     captures d'écran qu'on imprimait au dos des boîtiers.
  if (shot) {
    y += h * 0.028;
    const gap = w * 0.02;
    const tw = (w - pad * 2 - gap * 2) / 3;
    const th = (tw * 9) / 16;
    for (let i = 0; i < 3; i++) {
      const x = pad + i * (tw + gap);
      ctx.save();
      roundRect(ctx, x, y, tw, th, w * 0.012);
      ctx.clip();
      // Trois cadrages différents de la même image — la gauche, le centre, la
      // droite : ce sont bien trois morceaux distincts de l'œuvre.
      const ratio = Math.max((tw * 3) / shot.width, th / shot.height);
      const dw = shot.width * ratio;
      const dh = shot.height * ratio;
      ctx.drawImage(shot, x - i * (dw - tw) / 2, y + (th - dh) / 2, dw, dh);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = px(w * 0.0025);
      roundRect(ctx, x, y, tw, th, w * 0.012);
      ctx.stroke();
    }
    y += th;
  }

  // --- Cartouche technique. Deux colonnes de libellés, comme au dos d'un vrai
  //     boîtier — et uniquement ce qu'on sait : pas de ligne inventée.
  const facts = [];
  if (media.kind === "series" && media.episodeCount) {
    facts.push([
      "Épisodes",
      media.runtime
        ? `${media.episodeCount} × ${media.runtime} min`
        : `${media.episodeCount}`,
    ]);
  } else if (media.runtime) {
    facts.push(["Durée", fmtDuration(media.runtime * 60)]);
  }
  const langs = audioTracks(media);
  if (langs) facts.push(["Langues", langs]);
  if (media.rating) facts.push(["Note", `${media.rating}/10`]);
  if (media.network) facts.push(["Diffusion", media.network]);
  if (media.studio && facts.length < 4) facts.push(["Réalisation", media.studio]);

  if (facts.length) {
    const rows = Math.ceil(facts.length / 2);
    const boxH = h * 0.028 + rows * h * 0.048;
    const boxY = Math.min(y + h * 0.03, h - boxH - h * 0.145);
    roundRect(ctx, pad, boxY, w - pad * 2, boxH, w * 0.018);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = px(w * 0.002);
    ctx.stroke();

    const colW = (w - pad * 2) / 2;
    facts.forEach(([label, value], i) => {
      const cx = pad + w * 0.03 + (i % 2) * colW;
      const cy = boxY + h * 0.032 + Math.floor(i / 2) * h * 0.048;
      ctx.font = `800 ${px(w * 0.024)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = alpha(color, 0.95);
      ctx.letterSpacing = `${px(w * 0.006)}px`;
      ctx.fillText(label.toUpperCase(), cx, cy);
      ctx.letterSpacing = "0px";
      ctx.font = `600 ${px(w * 0.032)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(
        fitOneLine(
          ctx,
          value,
          colW - w * 0.06,
          (s) => `600 ${s}px Inter, system-ui, sans-serif`,
          px(w * 0.032),
          px(w * 0.022)
        ),
        cx,
        cy + h * 0.022
      );
    });
  }

  // --- Pied : visa d'âge, provenance, code-barres.
  const footY = h - h * 0.105;
  const visa = media.certification;
  if (visa) {
    const vw = w * 0.13;
    const vh = h * 0.055;
    roundRect(ctx, pad, footY, vw, vh, w * 0.012);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#14151b";
    ctx.textAlign = "center";
    ctx.font = `800 ${px(visa.length > 4 ? w * 0.026 : w * 0.05)}px Inter, system-ui, sans-serif`;
    ctx.fillText(
      visa.length > 4 ? visa.toUpperCase() : visa,
      pad + vw / 2,
      footY + vh / 2
    );
    ctx.textAlign = "left";
  }

  ctx.font = `700 ${px(w * 0.026)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.fillText(
    LICENCES[media.licence]?.label?.toUpperCase() || "",
    pad + (visa ? w * 0.16 : 0),
    footY + h * 0.014
  );
  ctx.font = `600 ${px(w * 0.024)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillText("MYPLAYLOG · RAYON VIDÉO", pad + (visa ? w * 0.16 : 0), footY + h * 0.04);

  // Code-barres : le détail qui achève de faire un objet du commerce.
  const bw = w * 0.26;
  const bh = h * 0.06;
  const bx = w - pad - bw;
  ctx.fillStyle = "#f4f1e8";
  roundRect(ctx, bx, footY - h * 0.004, bw, bh, w * 0.006);
  ctx.fill();
  ctx.fillStyle = "#14151b";
  let cursor = bx + bw * 0.06;
  // Largeurs tirées du SLUG et non au hasard : le même titre garde le même
  // code d'une peinture à l'autre.
  const seed = [...(media.slug || media.title || "x")].reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) % 9973,
    7
  );
  let roll = seed;
  while (cursor < bx + bw * 0.94) {
    roll = (roll * 1103515245 + 12345) % 2147483648;
    const barW = px(bw * (0.008 + ((roll >> 16) % 3) * 0.006));
    if ((roll >> 8) % 3) ctx.fillRect(cursor, footY + h * 0.004, barW, bh * 0.68);
    cursor += barW + px(bw * 0.008);
  }
  ctx.font = `600 ${px(w * 0.02)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#14151b";
  ctx.textAlign = "center";
  ctx.fillText(
    String(seed).padStart(4, "0") + " " + String(media.episodeCount || 1).padStart(3, "0"),
    bx + bw / 2,
    footY + bh * 0.86
  );
  ctx.textAlign = "left";

  grain(ctx, w, h, 0.04);
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
export async function paintCase(media, quality = 1024) {
  const box = BOX[media.format] || BOX.dvd;

  // Les faces sont composées AVEC la typo maison : peindre avant que la police
  // soit chargée figerait un repli système dans la texture, et le boîtier
  // garderait cette typo jusqu'au rechargement de la page.
  try {
    await document.fonts?.ready;
  } catch {
    /* pas d'API de polices : on peint avec ce qui est disponible */
  }

  // Une jaquette complète fournie à la main l'emporte sur tout : c'est l'objet
  // que quelqu'un a dessiné, on ne compose rien par-dessus.
  // `full` prévient le rendu 3D que les trois faces viennent d'une SEULE
  // feuille pliée : elle doit alors couvrir le boîtier d'une arête à l'autre,
  // sans le liseré de plastique qu'on laisse volontairement autour d'une
  // jaquette composée. Sinon le dessin se couperait à chaque pli.
  const wrap = await loadImage(media.wrap);
  if (wrap) return { artwork: true, full: true, ...sliceWrap(wrap, box, quality) };

  // Le bandeau part avec l'affiche : il sert de fond et de vignettes au dos.
  // Chargé seulement s'il existe et diffère — deux requêtes par boîtier, ce
  // n'est pas rien sur une grande étagère.
  const [img, backdrop] = await Promise.all([
    loadImage(media.poster),
    media.backdrop && media.backdrop !== media.poster ? loadImage(media.backdrop) : null,
  ]);
  return {
    artwork: !!img,
    spine: paintSpine(media, img, (quality * box.w) / box.h, quality),
    sleeve: paintSleeve(media, img, (quality * box.d) / box.h, quality),
    // Pleine définition : le dos porte maintenant du TEXTE à lire (résumé,
    // cartouche), il ne peut plus être peint à moitié comme un décor.
    back: paintBack(media, img, backdrop, (quality * box.d) / box.h, quality),
  };
}

// Découpe une jaquette dépliée en ses trois faces.
//
// Une jaquette de boîtier s'imprime à plat, vue de l'EXTÉRIEUR, dans cet ordre :
//
//     ┌──────────┬──┬──────────┐
//     │   DOS    │tr│COUVERTURE│      tr = tranche
//     └──────────┴──┴──────────┘
//
// Une fois pliée autour du boîtier, la tranche est au centre et regarde le
// lecteur ; le dos part à gauche, la couverture à droite. C'est exactement
// l'orientation des faces -X, +Z et +X d'une BoxGeometry, chacune lisible
// depuis l'extérieur sans miroir — donc une simple découpe suffit.
//
// Le partage se fait aux proportions DU BOÎTIER, pas de l'image : le rendu est
// ainsi sans raccord, quelle que soit la définition de la source.
function sliceWrap(img, box, quality) {
  const total = box.d * 2 + box.w;
  const cut = (startUnits, widthUnits) => {
    const canvas = canvasOf((quality * widthUnits) / box.h, quality);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(
      img,
      (startUnits / total) * img.width,
      0,
      (widthUnits / total) * img.width,
      img.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  };
  return {
    back: cut(0, box.d),
    spine: cut(box.d, box.w),
    sleeve: cut(box.d + box.w, box.d),
  };
}

// Part de la jaquette dépliée occupée par la couverture, en pourcentage : sert
// à cadrer la couverture seule dans une vignette CSS (vue grille), sans avoir à
// redécouper l'image côté serveur.
export function wrapCoverInset(format = "dvd") {
  const box = BOX[format] || BOX.dvd;
  const share = box.d / (box.d * 2 + box.w);
  return { zoom: 100 / share, ratio: box.d / box.h };
}
