// ======================================================================
//  Export d'une liste en PNG « poster », dessiné au Canvas 2D.
// ======================================================================
// Rendu maison (aucune dépendance) pour un contrôle total du visuel et pour
// éviter les écueils d'html2canvas. Deux mises en page : grille (liste simple /
// classement) et paliers (tier list). Les images distantes (jaquettes IGDB…)
// passent par notre proxy → blob → objectURL : un blob est same-origin, donc le
// canvas n'est pas « souillé » et `toBlob()` fonctionne.
import { API_BASE } from "./api";

export const EXPORT_WIDTH = 1200;
const SCALE = 2; // rendu ×2 (net sur écrans HiDPI / à l'agrandissement)
const PAD = 56;

const TYPE_BADGE = {
  classic: "LISTE",
  ranked: "CLASSEMENT",
  tier: "TIER LIST",
};

// Palettes d'export (indépendantes du thème live, pour un rendu constant).
const THEMES = {
  dark: {
    bg1: "#0c0d11",
    bg2: "#161922",
    surface: "#1b1e27",
    surfaceSoft: "#20242f",
    border: "rgba(255,255,255,0.08)",
    text: "#f3f4f7",
    textSoft: "#9aa0ad",
    gold: "#f2b70b",
    goldInk: "#ffd24a",
    onGold: "#2a1c00",
    glow: "rgba(242,183,11,0.16)",
    tileBg: "#232733",
  },
  light: {
    bg1: "#ffffff",
    bg2: "#f4f5f8",
    surface: "#ffffff",
    surfaceSoft: "#f6f6f8",
    border: "#e6e6ea",
    text: "#14151a",
    textSoft: "#6b6c76",
    gold: "#eaa908",
    goldInk: "#97680a",
    onGold: "#2a1c00",
    glow: "rgba(242,183,11,0.14)",
    tileBg: "#eceef2",
  },
};

const MEDALS = ["#f2b70b", "#c7ccd6", "#cd7f32"]; // or / argent / bronze

// --- Chargement des polices (le canvas a besoin qu'elles soient prêtes) ---
export async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 46px "Space Grotesk"'),
      document.fonts.load('600 24px "Space Grotesk"'),
      document.fonts.load('400 22px "Inter"'),
      document.fonts.load('600 20px "Inter"'),
      document.fonts.load('700 18px "Inter"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* on dessinera avec la police de repli */
  }
}

// --- Images : proxy → blob → HTMLImageElement (cache mémoire) ---
const imgCache = new Map(); // url -> Promise<HTMLImageElement|null>

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(u);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(u);
      reject(new Error("img"));
    };
    img.src = u;
  });
}

function loadOne(url, token) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = (async () => {
    try {
      if (!url) return null;
      if (url.startsWith("data:")) return await blobToImage(await (await fetch(url)).blob());
      const res = await fetch(`${API_BASE}/lists/proxy-image?url=${encodeURIComponent(url)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return await blobToImage(await res.blob());
    } catch {
      return null;
    }
  })();
  imgCache.set(url, p);
  return p;
}

// Charge toutes les images nécessaires ; renvoie une Map url -> img|null.
export async function loadImages(urls, token) {
  const uniq = [...new Set(urls.filter(Boolean))];
  const map = new Map();
  await Promise.all(
    uniq.map(async (u) => {
      map.set(u, await loadOne(u, token));
    })
  );
  return map;
}

export function collectImageUrls(list, items) {
  const urls = items.map((i) => i.image).filter(Boolean);
  if (list.cover) urls.push(list.cover);
  return urls;
}

// ---------------------------------------------------------------------
//  Primitives de dessin
// ---------------------------------------------------------------------
function setFont(ctx, weight, size, family = "Inter") {
  ctx.font = `${weight} ${size}px "${family}", system-ui, sans-serif`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Découpe le texte en lignes tenant dans maxW (ellipsis sur la dernière).
function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  const pushEllipsis = (s) => {
    let t = s;
    while (t.length && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  };
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width <= maxW) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = words[i];
      // Mot seul trop long : on le tronque.
      if (ctx.measureText(line).width > maxW) {
        line = pushEllipsis(line);
      }
      if (lines.length === maxLines - 1) {
        // Il reste peut-être des mots : on remplit puis ellipse.
        let rest = words.slice(i).join(" ");
        while (rest.length && ctx.measureText(rest + "…").width > maxW) rest = rest.slice(0, -1);
        lines.push(ctx.measureText(words.slice(i).join(" ")).width > maxW ? rest + "…" : words.slice(i).join(" "));
        return lines;
      }
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawImageCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const tr = w / h;
  let sw, sh, sx, sy;
  if (ir > tr) {
    sh = img.height;
    sw = sh * tr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / tr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

// Une tuile (jaquette) avec coins arrondis + repli si pas d'image.
function drawTile(ctx, img, x, y, w, h, r, theme, fallbackText) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  if (img) {
    drawImageCover(ctx, img, x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, theme.surfaceSoft);
    g.addColorStop(1, theme.tileBg);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = theme.textSoft;
    setFont(ctx, 700, Math.min(w, h) * 0.42, "Space Grotesk");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.5;
    ctx.fillText((fallbackText || "?")[0].toUpperCase(), x + w / 2, y + h / 2);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // Fin liseré
  ctx.save();
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// Pastille de rang (médaille pour 1-3, sinon jeton doré).
function drawRankBadge(ctx, rank, x, y, theme) {
  const d = 40;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, d / 2, 0, Math.PI * 2);
  const medal = MEDALS[rank - 1];
  ctx.fillStyle = medal || theme.gold;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = medal ? "#2a1c00" : theme.onGold;
  setFont(ctx, 800, rank > 99 ? 15 : 19, "Space Grotesk");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(rank), x, y + 1);
}

// ---------------------------------------------------------------------
//  Plans de mise en page (mesure) + rendu
// ---------------------------------------------------------------------
const CW = EXPORT_WIDTH - PAD * 2;

function planHeader(ctx, list, opts, theme, coverImg) {
  const showCover = opts.showCover && list.cover && coverImg;
  const coverW = 132;
  const coverH = 176;
  const textX = showCover ? PAD + coverW + 28 : PAD;
  const textW = EXPORT_WIDTH - PAD - textX;

  let y = 0;
  const badge = TYPE_BADGE[list.type] || "LISTE";

  setFont(ctx, 700, 46, "Space Grotesk");
  const titleLines = opts.showTitle ? wrapText(ctx, list.title || "Sans titre", textW, 2) : [];
  const titleH = titleLines.length * 54;

  setFont(ctx, 400, 21, "Inter");
  const descLines =
    opts.showDescription && list.description ? wrapText(ctx, list.description, textW, 2) : [];
  const descH = descLines.length * 30;

  const metaBits = [];
  if (opts.showAuthor && list.author?.username) metaBits.push(`par @${list.author.username}`);
  metaBits.push(`${list.itemCount ?? "?"} élément${(list.itemCount ?? 0) > 1 ? "s" : ""}`);
  if (opts.showDate && list.updatedAt)
    metaBits.push(
      new Date(list.updatedAt).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    );
  const metaText = metaBits.join("   ·   ");

  // Hauteur du bloc texte : badge(28) + titre + desc + meta(26), avec espacements.
  let textH = 28 + 12;
  textH += titleH;
  if (descLines.length) textH += 10 + descH;
  textH += 14 + 26;

  const height = Math.max(showCover ? coverH : 0, textH);
  return {
    height,
    showCover,
    coverW,
    coverH,
    coverImg,
    textX,
    textW,
    badge,
    titleLines,
    descLines,
    metaText,
    y,
  };
}

function drawHeader(ctx, p, list, theme, originY) {
  let x = p.textX;
  let y = originY;

  if (p.showCover) {
    drawTile(ctx, p.coverImg, PAD, originY, p.coverW, p.coverH, 16, theme);
  }

  // Badge type (pastille dorée)
  setFont(ctx, 800, 14, "Inter");
  const bw = ctx.measureText(p.badge).width + 26;
  roundRectPath(ctx, x, y, bw, 28, 14);
  ctx.fillStyle = theme.gold;
  ctx.fill();
  ctx.fillStyle = theme.onGold;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(p.badge, x + 13, y + 15);
  y += 28 + 12;

  // Titre
  ctx.fillStyle = theme.text;
  setFont(ctx, 700, 46, "Space Grotesk");
  ctx.textBaseline = "alphabetic";
  for (const line of p.titleLines) {
    y += 44;
    ctx.fillText(line, x, y);
    y += 10;
  }

  // Description
  if (p.descLines.length) {
    y += 6;
    ctx.fillStyle = theme.textSoft;
    setFont(ctx, 400, 21, "Inter");
    for (const line of p.descLines) {
      y += 24;
      ctx.fillText(line, x, y);
      y += 6;
    }
  }

  // Meta
  y += 20;
  ctx.fillStyle = theme.textSoft;
  setFont(ctx, 600, 19, "Inter");
  ctx.fillText(p.metaText, x, y);
}

// Grille (classic / ranked)
function planGrid(ctx, items, opts, list) {
  const ranked = list.type === "ranked";
  const GAP = 22;
  const target = 190;
  let cols = Math.max(3, Math.min(8, Math.round((CW + GAP) / (target + GAP))));
  cols = Math.min(cols, Math.max(1, items.length));
  const tileW = (CW - (cols - 1) * GAP) / cols;
  const coverH = tileW * (4 / 3);

  setFont(ctx, 700, 17, "Inter");
  const nameH = opts.showNames ? 46 : 0;
  const noteH = opts.showNotes ? 40 : 0;
  const cellH = coverH + (nameH ? 8 + nameH : 0) + (noteH ? noteH : 0);
  const rowGap = 30;
  const rows = Math.ceil(items.length / cols);
  const height = rows * cellH + (rows - 1) * rowGap;
  return { ranked, cols, tileW, coverH, nameH, noteH, cellH, rowGap, GAP, height };
}

function drawGrid(ctx, items, imageMap, p, theme, opts, originY) {
  items.forEach((it, i) => {
    const col = i % p.cols;
    const row = Math.floor(i / p.cols);
    const x = PAD + col * (p.tileW + p.GAP);
    const y = originY + row * (p.cellH + p.rowGap);
    drawTile(ctx, imageMap.get(it.image), x, y, p.tileW, p.coverH, 14, theme, it.name);

    if (p.ranked && opts.showRank) drawRankBadge(ctx, i + 1, x + 24, y + 24, theme);
    if (it.rating != null) drawRatingChip(ctx, it.rating, x + p.tileW - 8, y + 8, theme);

    let ty = y + p.coverH;
    if (p.nameH) {
      ty += 8;
      ctx.fillStyle = theme.text;
      setFont(ctx, 700, 17, "Inter");
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const lines = wrapText(ctx, it.name || "", p.tileW, 2);
      let ly = ty;
      for (const line of lines) {
        ctx.fillText(line, x + p.tileW / 2, ly);
        ly += 22;
      }
      ty += p.nameH;
    }
    if (p.noteH && it.note) {
      ctx.fillStyle = theme.textSoft;
      setFont(ctx, 400, 15, "Inter");
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const lines = wrapText(ctx, it.note, p.tileW, 2);
      let ly = ty;
      for (const line of lines) {
        ctx.fillText(line, x + p.tileW / 2, ly);
        ly += 19;
      }
    }
  });
  ctx.textAlign = "left";
}

function drawRatingChip(ctx, rating, xRight, y, theme) {
  setFont(ctx, 800, 15, "Inter");
  const txt = String(rating);
  const w = ctx.measureText(txt).width + 18;
  roundRectPath(ctx, xRight - w, y, w, 26, 13);
  ctx.fillStyle = theme.gold;
  ctx.fill();
  ctx.fillStyle = theme.onGold;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, xRight - w / 2, y + 14);
  ctx.textAlign = "left";
}

// Paliers (tier list)
function planTier(ctx, items, tiers, opts) {
  const labelW = 132;
  const innerPad = 16;
  const innerGap = 10;
  const tileW = 92;
  const tileH = tileW * (4 / 3);
  const areaW = CW - labelW;
  const perRow = Math.max(1, Math.floor((areaW - innerPad * 2 + innerGap) / (tileW + innerGap)));
  const rowGap = 14;

  const groups = tiers.map((t) => ({
    tier: t,
    items: items.filter((i) => i.tier === t.id),
  }));
  if (opts.showPool) {
    const pool = items.filter((i) => !i.tier);
    if (pool.length) groups.push({ tier: { id: "__pool__", label: "Non classés", color: null }, items: pool });
  }

  let height = 0;
  const rows = groups.map((g) => {
    const n = g.items.length;
    const nRows = Math.max(1, Math.ceil(n / perRow));
    const rowH = Math.max(tileH + innerPad * 2, innerPad * 2 + nRows * tileH + (nRows - 1) * innerGap);
    const plan = { ...g, rowH, nRows };
    height += rowH + rowGap;
    return plan;
  });
  if (rows.length) height -= rowGap;
  return { labelW, innerPad, innerGap, tileW, tileH, perRow, rowGap, rows, height };
}

function drawTier(ctx, imageMap, p, theme, opts, originY) {
  let y = originY;
  for (const row of p.rows) {
    // Fond de la rangée
    roundRectPath(ctx, PAD, y, CW, row.rowH, 14);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Chip de label
    const color = row.tier.color || theme.surfaceSoft;
    ctx.save();
    roundRectPath(ctx, PAD, y, p.labelW, row.rowH, 14);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(PAD, y, p.labelW, row.rowH);
    ctx.restore();

    const onLabel = row.tier.color ? "#ffffff" : theme.text;
    ctx.fillStyle = onLabel;
    setFont(ctx, 800, 26, "Space Grotesk");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = row.tier.color ? "rgba(0,0,0,0.25)" : "transparent";
    ctx.shadowBlur = 4;
    const labelLines = wrapText(ctx, row.tier.label || "—", p.labelW - 16, 2);
    let lly = y + row.rowH / 2 - (labelLines.length - 1) * 15;
    for (const line of labelLines) {
      ctx.fillText(line, PAD + p.labelW / 2, lly);
      lly += 30;
    }
    if (opts.showCounts) {
      ctx.shadowBlur = 0;
      setFont(ctx, 700, 14, "Inter");
      ctx.globalAlpha = 0.85;
      ctx.fillText(`${row.items.length}`, PAD + p.labelW / 2, y + row.rowH - 16);
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;

    // Tuiles
    const gx0 = PAD + p.labelW + p.innerPad;
    const gy0 = y + p.innerPad;
    row.items.forEach((it, i) => {
      const c = i % p.perRow;
      const r = Math.floor(i / p.perRow);
      const tx = gx0 + c * (p.tileW + p.innerGap);
      const ty = gy0 + r * (p.tileH + p.innerGap);
      drawTile(ctx, imageMap.get(it.image), tx, ty, p.tileW, p.tileH, 10, theme, it.name);
    });

    y += row.rowH + p.rowGap;
  }
  ctx.textAlign = "left";
}

function drawFooter(ctx, theme, y) {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, 700, 22, "Space Grotesk");
  const label = "MyPlayLog";
  const wLabel = ctx.measureText(label).width;
  setFont(ctx, 500, 16, "Inter");
  const wDom = ctx.measureText("  ·  myplaylog.cc").width;
  const total = wLabel + wDom;
  const cx = EXPORT_WIDTH / 2 - total / 2;
  ctx.fillStyle = theme.goldInk;
  setFont(ctx, 700, 22, "Space Grotesk");
  ctx.textAlign = "left";
  ctx.fillText(label, cx, y);
  ctx.fillStyle = theme.textSoft;
  setFont(ctx, 500, 16, "Inter");
  ctx.fillText("  ·  myplaylog.cc", cx + wLabel, y + 1);
  ctx.textAlign = "left";
}

// ---------------------------------------------------------------------
//  Rendu principal
// ---------------------------------------------------------------------
export function renderList(canvas, { list, items, tiers, opts, imageMap }) {
  const theme = THEMES[opts.theme === "light" ? "light" : "dark"];
  // Contexte de mesure (mêmes réglages que le rendu final).
  const mctx = canvas.getContext("2d");

  const coverImg = list.cover ? imageMap.get(list.cover) : null;
  const isTier = list.type === "tier";

  const headerPlan = planHeader(mctx, list, opts, theme, coverImg);
  const bodyPlan = isTier
    ? planTier(mctx, items, tiers, opts)
    : planGrid(mctx, items, opts, list);

  const headGap = 30;
  const footGap = 34;
  const footH = 26;
  const totalH = Math.round(
    PAD + headerPlan.height + headGap + bodyPlan.height + footGap + footH + PAD
  );

  // Dimensionne le canvas (×SCALE) puis on travaille en px logiques. On borne
  // la hauteur physique (les navigateurs plafonnent le canvas ~16 k px : au-delà,
  // il resterait blanc), en réduisant le facteur d'échelle pour les très longues
  // listes plutôt que de tronquer le contenu.
  const scale = Math.min(SCALE, 16000 / totalH);
  canvas.width = Math.round(EXPORT_WIDTH * scale);
  canvas.height = Math.round(totalH * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = "high";

  // Fond : dégradé + halo doré + fine grille « bloc-note ».
  const bg = ctx.createLinearGradient(0, 0, 0, totalH);
  bg.addColorStop(0, theme.bg1);
  bg.addColorStop(1, theme.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, EXPORT_WIDTH, totalH);

  const glow = ctx.createRadialGradient(EXPORT_WIDTH * 0.5, -80, 40, EXPORT_WIDTH * 0.5, -80, 620);
  glow.addColorStop(0, theme.glow);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, EXPORT_WIDTH, 360);

  ctx.strokeStyle = opts.theme === "light" ? "rgba(20,20,40,0.035)" : "rgba(255,255,255,0.025)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= EXPORT_WIDTH; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, totalH);
    ctx.stroke();
  }
  for (let gy = 0; gy <= totalH; gy += 40) {
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(EXPORT_WIDTH, gy + 0.5);
    ctx.stroke();
  }

  // Header
  drawHeader(ctx, headerPlan, list, theme, PAD);

  // Séparateur
  const sepY = PAD + headerPlan.height + headGap / 2;
  ctx.strokeStyle = theme.border;
  ctx.beginPath();
  ctx.moveTo(PAD, sepY);
  ctx.lineTo(EXPORT_WIDTH - PAD, sepY);
  ctx.stroke();

  // Corps
  const bodyTop = PAD + headerPlan.height + headGap;
  if (isTier) drawTier(ctx, imageMap, bodyPlan, theme, opts, bodyTop);
  else drawGrid(ctx, items, imageMap, bodyPlan, theme, opts, bodyTop);

  // Footer
  if (opts.showWatermark) drawFooter(ctx, theme, bodyTop + bodyPlan.height + footGap);

  return { width: EXPORT_WIDTH, height: totalH };
}

// Options par défaut selon le type de liste.
export function defaultExportOpts(list) {
  return {
    theme: "dark",
    showTitle: true,
    showDescription: !!list.description,
    showAuthor: true,
    showDate: true,
    showCover: !!list.cover,
    showWatermark: true,
    // grille
    showNames: true,
    showNotes: false,
    showRank: list.type === "ranked",
    // tier
    showPool: true,
    showCounts: false,
  };
}
