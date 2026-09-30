// ======================================================================
//  Le « cercle » des stats : le profil au centre, ses sagas (ou studios,
//  genres, consoles…) en bulles autour, rangées en anneaux concentriques.
// ======================================================================
// Dessiné au Canvas 2D pour pouvoir être téléchargé tel quel en PNG. Les
// images distantes passent par le proxy du serveur (comme l'export des
// listes) : un blob est same-origin, le canvas n'est donc pas « souillé » et
// `toBlob()` fonctionne.
import { API_BASE } from "./api";

export const CIRCLE_SIZE = 1080;
const SCALE = 2; // rendu ×2 : net sur écran HiDPI et à l'export
const CENTER_R = 118;
const GAP = 16;
// Rayon des bulles de chaque anneau, de l'intérieur vers l'extérieur.
const RING_R = [74, 58, 46, 38];
// Rayon extérieur maximal : assez court pour que les deux cartouches du bas
// (pseudo, site) tiennent dans les coins sans mordre sur les bulles.
const MAX_OUTER = 474;
const CENTER_Y = CIRCLE_SIZE / 2 - 16;

// Fonds proposés. Aplats, pas de dégradé : l'or et le rose du site, la nuit
// du thème sombre, et un gris craie pour le clair.
export const CIRCLE_THEMES = {
  nuit: {
    label: "Nuit",
    bg: "#1b1b20",
    ring: "#34343d",
    pill: "#0e0e11",
    pillInk: "#ffffff",
    pillSoft: "#a3a3ad",
    badge: "#f2b70b",
    badgeInk: "#16161a",
    tile: "#2a2a31",
    tileInk: "#f2b70b",
  },
  or: {
    label: "Or",
    bg: "#f2b70b",
    ring: "#ffffff",
    pill: "#16161a",
    pillInk: "#ffffff",
    pillSoft: "#b5b5bd",
    badge: "#ffffff",
    badgeInk: "#16161a",
    tile: "#16161a",
    tileInk: "#f2b70b",
  },
  rose: {
    label: "Rose",
    bg: "#ff5470",
    ring: "#ffffff",
    pill: "#16161a",
    pillInk: "#ffffff",
    pillSoft: "#b5b5bd",
    badge: "#f2b70b",
    badgeInk: "#16161a",
    tile: "#16161a",
    tileInk: "#ff5470",
  },
  craie: {
    label: "Craie",
    bg: "#ecebe7",
    // Contour sombre : sur ce fond clair, un liseré blanc laisserait les
    // pastilles de logos (blanches) se fondre dans le décor.
    ring: "#16161a",
    pill: "#16161a",
    pillInk: "#ffffff",
    pillSoft: "#b5b5bd",
    badge: "#f2b70b",
    badgeInk: "#16161a",
    tile: "#16161a",
    tileInk: "#f2b70b",
  },
};

// ---------------------------------------------------------------------
//  Disposition : anneaux concentriques
// ---------------------------------------------------------------------
/**
 * Place `n` bulles autour du centre, rang 1 en haut, dans le sens horaire,
 * anneau après anneau. Chaque anneau prend autant de bulles qu'il en tient ;
 * le dernier, souvent incomplet, les répartit à égale distance. Le tout est
 * ensuite mis à l'échelle pour remplir l'image : peu de bulles = grosses
 * bulles.
 * Rend { center: {x, y, r}, bubbles: [{x, y, r, ring}] } en px logiques.
 */
export function layoutCircle(n) {
  const rings = [];
  let left = n;
  let inner = CENTER_R;
  for (let k = 0; left > 0; k++) {
    const r = RING_R[Math.min(k, RING_R.length - 1)];
    const d = inner + GAP + r;
    const cap = Math.max(1, Math.floor((2 * Math.PI * d) / (2 * r + GAP)));
    const count = Math.min(cap, left);
    rings.push({ r, d, count });
    left -= count;
    inner = d + r;
  }
  const outer = rings.length ? inner : CENTER_R;
  const scale = Math.min(MAX_OUTER / outer, 1.45);
  const cx = CIRCLE_SIZE / 2;
  const cy = CENTER_Y;
  const bubbles = [];
  rings.forEach((ring, k) => {
    // Décalage d'une demi-case d'un anneau à l'autre : les bulles
    // s'intercalent au lieu de s'aligner en rayons.
    const step = (2 * Math.PI) / ring.count;
    const start = -Math.PI / 2 + (k % 2 ? step / 2 : 0);
    for (let i = 0; i < ring.count; i++) {
      const a = start + i * step;
      bubbles.push({
        x: cx + Math.cos(a) * ring.d * scale,
        y: cy + Math.sin(a) * ring.d * scale,
        r: ring.r * scale,
        ring: k,
      });
    }
  });
  return { center: { x: cx, y: cy, r: CENTER_R * scale }, bubbles };
}

// ---------------------------------------------------------------------
//  Images : proxy → blob → HTMLImageElement (cache mémoire)
// ---------------------------------------------------------------------
const imgCache = new Map(); // url -> Promise<HTMLImageElement|null>

function blobToImage(blob) {
  return new Promise((resolve) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(u);
      resolve(null);
    };
    img.src = u;
  });
}

async function fetchImage(url, token) {
  // Nos propres fichiers (photos de profil, jaquettes perso) : servis avec
  // les en-têtes CORS du site, pas besoin du relais — qui refuse d'ailleurs
  // localhost en dev.
  if (url.includes("/uploads/")) {
    const res = await fetch(url);
    return res.ok ? blobToImage(await res.blob()) : null;
  }
  if (token) {
    const res = await fetch(`${API_BASE}/lists/proxy-image?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return blobToImage(await res.blob());
  }
  // Visiteur déconnecté (le relais demande un compte) : on tente en direct.
  const res = await fetch(url, { mode: "cors" });
  return res.ok ? blobToImage(await res.blob()) : null;
}

export function loadCircleImage(url, token) {
  if (!url) return Promise.resolve(null);
  if (!imgCache.has(url)) {
    imgCache.set(
      url,
      fetchImage(url, token).catch(() => null)
    );
  }
  return imgCache.get(url);
}

// Un logo clair (blanc sur transparent, fréquent chez IGDB) disparaîtrait sur
// une pastille blanche : on mesure sa luminosité pour choisir le fond.
const logoTone = new WeakMap();
function isLightLogo(img) {
  if (logoTone.has(img)) return logoTone.get(img);
  let light = false;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    let n = 0;
    let opaque = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (a < 0.2) continue;
      opaque++;
      sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a;
      n += a;
    }
    // Un logo « plein » (fond opaque déjà dessiné) garde sa pastille blanche.
    light = n > 0 && opaque < 32 * 32 * 0.9 && sum / n > 200;
  } catch {
    light = false;
  }
  logoTone.set(img, light);
  return light;
}

// ---------------------------------------------------------------------
//  Primitives
// ---------------------------------------------------------------------
function font(weight, size) {
  const family =
    (typeof document !== "undefined" && getComputedStyle(document.body).fontFamily) ||
    "system-ui, sans-serif";
  return `${weight} ${Math.round(size)}px ${family}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ellipsize(ctx, text, maxW) {
  let t = String(text || "");
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

function initials(name) {
  const words = String(name || "?")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

// Jaquette recadrée en disque : on garde le haut-milieu, là où vivent le
// titre et le héros sur la plupart des jaquettes.
function drawDiscImage(ctx, img, x, y, r) {
  const s = Math.min(img.width, img.height);
  const sx = (img.width - s) / 2;
  const sy = (img.height - s) * 0.3;
  ctx.drawImage(img, sx, sy, s, s, x - r, y - r, 2 * r, 2 * r);
}

function drawLogo(ctx, img, x, y, r) {
  const box = r * 1.25;
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k;
  const h = img.height * k;
  ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
}

function drawBubble(ctx, b, img, item, theme, isLogo) {
  const { x, y, r } = b;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  if (img && isLogo) {
    ctx.fillStyle = isLightLogo(img) ? "#16161a" : "#ffffff";
    ctx.fill();
    ctx.clip();
    drawLogo(ctx, img, x, y, r);
  } else if (img) {
    ctx.clip();
    drawDiscImage(ctx, img, x, y, r);
  } else {
    ctx.fillStyle = theme.tile;
    ctx.fill();
    ctx.fillStyle = theme.tileInk;
    ctx.font = font(800, r * 0.62);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(item?.name), x, y + r * 0.02);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2.5, r * 0.06);
  ctx.strokeStyle = theme.ring;
  ctx.stroke();
}

// Étiquette sous la bulle : le nom, et la mesure pour le premier anneau.
function drawPill(ctx, b, name, value, theme) {
  const size = Math.max(11, Math.min(19, b.r * 0.24));
  const withValue = value && b.ring === 0;
  ctx.font = font(700, size);
  const maxW = b.r * 2.1;
  const label = ellipsize(ctx, name, maxW - size);
  let textW = ctx.measureText(label).width;
  if (withValue) {
    ctx.font = font(600, size * 0.8);
    textW = Math.max(textW, ctx.measureText(value).width);
    ctx.font = font(700, size);
  }
  const w = Math.min(maxW, textW + size * 1.1);
  const h = withValue ? size * 2.55 : size * 1.6;
  const top = b.y + b.r * (withValue ? 0.42 : 0.62);
  ctx.fillStyle = theme.pill;
  roundRect(ctx, b.x - w / 2, top, w, h, size * 0.55);
  ctx.fill();
  ctx.fillStyle = theme.pillInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, b.x, top + size * 0.82);
  if (withValue) {
    ctx.font = font(600, size * 0.8);
    ctx.fillStyle = theme.pillSoft;
    ctx.fillText(value, b.x, top + size * 1.85);
  }
}

function drawBadge(ctx, b, rank, theme) {
  const rr = Math.max(12, Math.min(22, b.r * 0.26));
  const a = -Math.PI / 4;
  const x = b.x + Math.cos(a) * b.r * 0.92;
  const y = b.y + Math.sin(a) * b.r * 0.92;
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.fillStyle = theme.badge;
  ctx.fill();
  ctx.lineWidth = Math.max(2, rr * 0.14);
  ctx.strokeStyle = theme.pill;
  ctx.stroke();
  ctx.fillStyle = theme.badgeInk;
  ctx.font = font(800, rr * (rank > 9 ? 0.95 : 1.1));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(rank), x, y + rr * 0.06);
}

function drawFooter(ctx, { username, caption, site }, theme) {
  const pad = 26;
  // Bas gauche : le pseudo et ce que montre le cercle.
  ctx.font = font(800, 26);
  const nameW = ctx.measureText(`@${username}`).width;
  ctx.font = font(600, 17);
  const capW = ctx.measureText(caption).width;
  const w = Math.max(nameW, capW) + 40;
  const h = 76;
  const y = CIRCLE_SIZE - pad - h;
  ctx.fillStyle = theme.pill;
  roundRect(ctx, pad, y, w, h, 14);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.pillInk;
  ctx.font = font(800, 26);
  ctx.fillText(`@${username}`, pad + 20, y + 34);
  ctx.fillStyle = theme.pillSoft;
  ctx.font = font(600, 17);
  ctx.fillText(caption, pad + 20, y + 60);

  // Bas droite : le site, avec le point d'or.
  ctx.font = font(800, 20);
  const sw = ctx.measureText(site).width;
  const bw = sw + 58;
  const bh = 44;
  const bx = CIRCLE_SIZE - pad - bw;
  const by = CIRCLE_SIZE - pad - bh;
  ctx.fillStyle = theme.pill;
  roundRect(ctx, bx, by, bw, bh, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx + 22, by + bh / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#f2b70b";
  ctx.fill();
  ctx.fillStyle = theme.pillInk;
  ctx.textBaseline = "middle";
  ctx.fillText(site, bx + 38, by + bh / 2 + 1);
}

// ---------------------------------------------------------------------
//  Rendu complet
// ---------------------------------------------------------------------
/**
 * Dessine le cercle dans `canvas`.
 * - `items` : bulles déjà classées ({ name, image, logo?: bool, value }).
 * - `avatar` : image du centre (ou null → initiale).
 * - `images` : Map url → HTMLImageElement|null.
 * Rend la liste des bulles placées (pour le survol et le clic).
 */
export function renderCircle(canvas, { items, avatar, username, caption, site, theme, images }) {
  canvas.width = CIRCLE_SIZE * SCALE;
  canvas.height = CIRCLE_SIZE * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CIRCLE_SIZE, CIRCLE_SIZE);

  const { center, bubbles } = layoutCircle(items.length);
  const placed = bubbles.map((b, i) => ({ ...b, item: items[i], rank: i + 1 }));

  // Du plus loin au plus proche : les étiquettes du premier anneau passent
  // par-dessus les bulles voisines, jamais l'inverse.
  const order = [...placed].reverse();
  for (const b of order) drawBubble(ctx, b, images.get(b.item.image) || null, b.item, theme, b.item.logo);

  // Centre : la photo de profil.
  const av = avatar ? images.get(avatar) : null;
  drawBubble(ctx, center, av, { name: username }, theme, false);
  ctx.beginPath();
  ctx.arc(center.x, center.y, center.r, 0, Math.PI * 2);
  ctx.lineWidth = center.r * 0.07;
  ctx.strokeStyle = theme.ring;
  ctx.stroke();

  for (const b of order) drawPill(ctx, b, b.item.name, b.item.value, theme);
  for (const b of order) drawBadge(ctx, b, b.rank, theme);

  drawFooter(ctx, { username, caption, site }, theme);
  return placed;
}

export function circleToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
