// ======================================================================
//  Export d'une liste des 9 en image — une affiche, pas une liste
// ======================================================================
// L'export des listes ordinaires (lib/listExport) aligne un titre et une
// grille réglable. Une liste des 9 a sa propre forme, et son image doit la
// garder : la PHRASE du thème en tête, composée comme sur le site (« Ces 9
// jeux qui m'ont fait » puis le mot-clé dans la police du thème, sa couleur,
// penché, surligné), puis TROIS JAQUETTES PAR LIGNE, numérotées — la grille
// 3 × 3 est le principe même. Un grand 9 en filigrane, l'auteur, la marque.
//
// Les images passent par le même chargement que l'export ordinaire (proxy →
// blob), pour que le canvas reste exportable.
import { NINE_CUSTOM, nineEnding, nineKeyLayout, nineSegments, nineTheme } from "./nines";

const W = 1080;
const PAD = 72;
const SCALE = 2;
const GAP = 20;
const COLS = 3;

const THEMES = {
  dark: { bg: "#121316", text: "#f4f4f6", soft: "#9a9dab", tile: "#1e2026", gold: "#f2b70b" },
  light: { bg: "#f6f6f7", text: "#15161a", soft: "#6b6c76", tile: "#e7e8ec", gold: "#e0a800" },
};

const LEAD_SIZE = 52;
const LEAD_FONT = (size) => `700 ${size}px "Space Grotesk", "Inter", system-ui, sans-serif`;

/** Les polices du thème doivent être prêtes AVANT de mesurer et de dessiner. */
export async function ensureNineFonts(themeKey) {
  const meta = nineTheme(themeKey);
  try {
    await Promise.all([
      document.fonts.load(LEAD_FONT(LEAD_SIZE)),
      document.fonts.load(`${meta.italic ? "italic " : ""}700 60px ${meta.font}`),
      document.fonts.load('600 22px "Inter"'),
    ]);
  } catch {
    /* police de repli */
  }
}

// Coupe un texte en lignes qui tiennent dans `max` pixels.
function wrap(ctx, text, max) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// L'image en « cover » dans la case (recadrée, jamais déformée).
function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const cr = w / h;
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (ir > cr) {
    sw = img.height * cr;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / cr;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** La phrase, découpée en morceaux : { text, hi } (hi = le mot-clé). */
function phraseOf(list, en) {
  const custom = list.nine === NINE_CUSTOM;
  if (custom) {
    // Un thème inventé reste dans la langue où on l'a écrit.
    const ending = nineEnding(list.title);
    return [{ text: en ? "games" : "jeux", hi: false }, ...(ending ? [{ text: ending, hi: true }] : [])];
  }
  const meta = nineTheme(list.nine);
  return nineSegments(en ? meta.cardEn || meta.card : meta.card);
}

/**
 * Prépare la composition de la phrase : des lignes de « lead » et le bloc du
 * mot-clé, avec leurs hauteurs. Rend `{ blocks, height }`.
 */
function planPhrase(ctx, list, en) {
  const meta = nineTheme(list.nine);
  const inner = W - PAD * 2;
  const segs = phraseOf(list, en);
  // « Ces 9 » en français, « 9 » tout court en anglais (« 9 games that… »).
  const prefix = en ? "9" : "Ces 9";
  const blocks = [];
  ctx.font = LEAD_FONT(LEAD_SIZE);
  const leadFirst = segs[0] && !segs[0].hi;
  if (!leadFirst) blocks.push({ kind: "lead", lines: [prefix], first: true });
  segs.forEach((seg, i) => {
    if (!seg.hi) {
      const text = i === 0 && leadFirst ? `${prefix} ${seg.text}` : seg.text;
      blocks.push({ kind: "lead", lines: wrap(ctx, text, inner), first: i === 0 && leadFirst });
    } else {
      // Le mot-clé : jusqu'à trois fois le corps du texte, sur deux lignes au
      // plus (cf. nineKeyLayout), mesuré dans SA police.
      const { size, lines } = nineKeyLayout(meta, seg.text, inner * 0.96, Math.min(150, meta.size * 3));
      blocks.push({ kind: "key", lines, size });
    }
  });
  let height = 0;
  for (const b of blocks)
    height += b.kind === "lead" ? b.lines.length * LEAD_SIZE * 1.18 : b.lines.length * b.size * 1.02 + 14;
  return { blocks, height, meta, prefix };
}

function drawPhrase(ctx, plan, theme, top) {
  const { meta } = plan;
  let y = top;
  for (const b of plan.blocks) {
    if (b.kind === "lead") {
      b.lines.forEach((line, li) => {
        y += LEAD_SIZE;
        ctx.font = LEAD_FONT(LEAD_SIZE);
        ctx.fillStyle = theme.text;
        // « Ces 9 » / « 9 » : le 9 en or, plus gros, comme sur le site.
        if (b.first && li === 0 && line.startsWith(plan.prefix)) {
          const before = plan.prefix.slice(0, -1);
          ctx.fillText(before, PAD, y);
          let x = PAD + ctx.measureText(before).width;
          ctx.font = LEAD_FONT(Math.round(LEAD_SIZE * 1.45));
          ctx.fillStyle = theme.gold;
          ctx.fillText("9", x, y + 4);
          x += ctx.measureText("9").width + ctx.measureText(" ").width * 0.6;
          ctx.font = LEAD_FONT(LEAD_SIZE);
          ctx.fillStyle = theme.text;
          ctx.fillText(line.slice(plan.prefix.length).trim(), x, y);
        } else ctx.fillText(line, PAD, y);
        y += LEAD_SIZE * 0.18;
      });
    } else {
      const font = `${meta.italic ? "italic " : ""}700 ${b.size}px ${meta.font}`;
      y += 8;
      b.lines.forEach((raw) => {
        const line = meta.upper ? raw.toUpperCase() : raw;
        y += b.size;
        ctx.save();
        ctx.translate(PAD, y);
        ctx.rotate((meta.rotate * 0.55 * Math.PI) / 180);
        ctx.font = font;
        const w = ctx.measureText(line).width;
        // Le surligneur : une bande de la couleur du thème sous le bas du mot.
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = meta.color;
        ctx.fillRect(-b.size * 0.06, -b.size * 0.36, w + b.size * 0.12, b.size * 0.36);
        ctx.globalAlpha = 1;
        ctx.fillStyle = meta.color;
        ctx.fillText(line, 0, 0);
        if (meta.strike) {
          ctx.fillRect(0, -b.size * 0.34, w, Math.max(3, b.size * 0.06));
        }
        ctx.restore();
        y += b.size * 0.02;
      });
      y += 6;
    }
  }
}

/** Dessine l'affiche des 9 dans `canvas`. */
export function renderNine(canvas, { list, items, opts, imageMap }) {
  const theme = THEMES[opts.theme === "light" ? "light" : "dark"];
  const measure = canvas.getContext("2d");
  const en = opts.lang === "en";
  const phrase = planPhrase(measure, list, en);

  const cellW = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
  const cellH = Math.round(cellW * (4 / 3));
  const nameH = opts.showNames ? 48 : 0;
  const rows = 3;
  const gridH = rows * (cellH + nameH) + (rows - 1) * GAP;
  const footH = opts.showAuthor || opts.showWatermark ? 70 : 0;
  const H = Math.round(PAD + phrase.height + 44 + gridH + (footH ? 40 + footH : 0) + PAD * 0.8);

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.textBaseline = "alphabetic";

  // Fond plat, et le grand 9 en filigrane dans le coin.
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = opts.theme === "light" ? 0.08 : 0.07;
  ctx.fillStyle = phrase.meta.color;
  ctx.font = `700 760px "Space Grotesk", sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText("9", W + 60, 560);
  ctx.restore();

  drawPhrase(ctx, phrase, theme, PAD);

  // La grille : trois par ligne, neuf cases, numérotées.
  const top = PAD + phrase.height + 44;
  for (let i = 0; i < 9; i++) {
    const it = items[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (cellW + GAP);
    const y = top + row * (cellH + nameH + GAP);
    const img = it?.image ? imageMap.get(it.image) : null;

    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 18);
    ctx.clip();
    ctx.fillStyle = theme.tile;
    ctx.fillRect(x, y, cellW, cellH);
    if (img) drawCover(ctx, img, x, y, cellW, cellH);
    else if (it) {
      ctx.fillStyle = theme.soft;
      ctx.font = '600 22px "Inter", sans-serif';
      ctx.textAlign = "center";
      wrap(ctx, it.name, cellW - 30)
        .slice(0, 4)
        .forEach((l, li) => ctx.fillText(l, x + cellW / 2, y + cellH / 2 + li * 28 - 20));
      ctx.textAlign = "left";
    }
    ctx.restore();

    // Le numéro, en pastille dorée.
    const r = 25;
    ctx.beginPath();
    ctx.arc(x + 14 + r, y + 14 + r, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.gold;
    ctx.fill();
    ctx.fillStyle = "#2a1c00";
    ctx.font = LEAD_FONT(28);
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), x + 14 + r, y + 14 + r + 10);
    ctx.textAlign = "left";

    if (opts.showNames && it) {
      ctx.fillStyle = theme.text;
      ctx.font = '700 27px "Inter", sans-serif';
      let name = it.name;
      while (name.length > 1 && ctx.measureText(name).width > cellW) name = name.slice(0, -2);
      if (name !== it.name) name = `${name.trimEnd()}…`;
      ctx.fillText(name, x, y + cellH + 36);
    }
  }

  // Le pied : l'auteur à gauche, la marque à droite.
  if (footH) {
    const fy = top + gridH + 40 + 34;
    if (opts.showAuthor && list.author?.username) {
      ctx.fillStyle = theme.soft;
      const by = en ? "by " : "par ";
      ctx.font = '500 28px "Inter", sans-serif';
      ctx.fillText(by, PAD, fy);
      const w = ctx.measureText(by).width;
      ctx.fillStyle = theme.text;
      ctx.font = '700 28px "Inter", sans-serif';
      ctx.fillText(list.author.username, PAD + w, fy);
    }
    if (opts.showWatermark) {
      ctx.textAlign = "right";
      ctx.fillStyle = theme.soft;
      ctx.font = '500 24px "Inter", sans-serif';
      const dom = "  ·  myplaylog.cc";
      ctx.fillText(dom, W - PAD, fy);
      const dw = ctx.measureText(dom).width;
      ctx.fillStyle = theme.gold;
      ctx.font = LEAD_FONT(32);
      ctx.fillText("MyPlayLog", W - PAD - dw, fy);
      ctx.textAlign = "left";
    }
  }

  return { width: W, height: H };
}
