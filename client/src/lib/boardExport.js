// ======================================================================
//  Export d'une carte de joueur en image
// ======================================================================
// Même esprit que sa page (cf. components/board/PlayerCard) : cinq colonnes,
// quatre rangées, le libellé SOUS chaque jaquette, et pour le protagoniste /
// l'antagoniste le personnage en petite carte sur la jaquette. En français ou
// en anglais (`opts.lang`). En
// tête, l'identité du joueur ; en pied, la marque. Fond plat.
//
// Les images passent par le même chargement que les autres exports (proxy →
// blob, cf. lib/listExport), pour que le canvas reste exportable.
import { boardOf, itemsBySlot } from "./boards";

const W = 1200;
const PAD = 64;
const GAP = 18;
const COLS = 5;
const SCALE = 2;
const LABEL_H = 64;

const THEMES = {
  dark: { bg: "#121316", text: "#f4f4f6", soft: "#9a9dab", tile: "#1c1e24", line: "#2a2c33", gold: "#f2b70b" },
  light: { bg: "#f6f6f7", text: "#15161a", soft: "#6b6c76", tile: "#e7e8ec", line: "#d9dae0", gold: "#e0a800" },
};

const font = (weight, size, family = "Inter") => `${weight} ${size}px "${family}", system-ui, sans-serif`;

/** Les URL à charger : jaquettes ET portraits des personnages. */
export const boardImageUrls = (items) =>
  (items || []).flatMap((i) => [i.image, i.charImage]).filter(Boolean);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// L'image en « cover » dans la case ; `top` cadre sur le haut (un visage).
function drawCover(ctx, img, x, y, w, h, top = false) {
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
    sy = top ? 0 : (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function ellipsize(ctx, text, max) {
  let t = String(text || "");
  if (ctx.measureText(t).width <= max) return t;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Dessine la carte de joueur dans `canvas`. */
export function renderBoard(canvas, { list, items, opts, imageMap }) {
  const theme = THEMES[opts.theme === "light" ? "light" : "dark"];
  const board = boardOf(list.board);
  const by = itemsBySlot(items);
  const filled = board.slots.filter((s) => by[s.key]).length;
  // La langue de l'image (FR / EN) : le titre et les libellés des cases.
  const en = opts.lang === "en";
  const labelOf = (s) => (en ? s.en || s.label : s.label);

  const cellW = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
  const cellH = Math.round(cellW * (4 / 3));
  const rows = Math.ceil(board.slots.length / COLS);
  const headH = 108;
  const gridTop = PAD + headH + 28;
  const gridH = rows * (cellH + LABEL_H) + (rows - 1) * GAP;
  const footH = opts.showWatermark ? 72 : 0;
  const H = gridTop + gridH + footH + PAD * 0.8;

  canvas.width = W * SCALE;
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // --- L'identité ------------------------------------------------------
  ctx.fillStyle = theme.gold;
  ctx.font = font(800, 22);
  ctx.letterSpacing = "4px";
  ctx.fillText(en ? "PLAYER CARD" : "CARTE DE JOUEUR", PAD, PAD + 24);
  ctx.letterSpacing = "0px";
  if (opts.showAuthor !== false) {
    ctx.fillStyle = theme.text;
    ctx.font = font(700, 66, "Space Grotesk");
    ctx.fillText(ellipsize(ctx, list.author?.username || "", W - PAD * 2 - 220), PAD, PAD + 94);
  }
  ctx.textAlign = "right";
  const tot = `/${board.slots.length}`;
  ctx.font = font(700, 30, "Space Grotesk");
  const totW = ctx.measureText(tot).width;
  ctx.fillStyle = theme.soft;
  ctx.fillText(tot, W - PAD, PAD + 94);
  ctx.fillStyle = theme.gold;
  ctx.font = font(700, 58, "Space Grotesk");
  ctx.fillText(String(filled), W - PAD - totW - 4, PAD + 94);
  ctx.textAlign = "left";

  ctx.fillStyle = theme.line;
  ctx.fillRect(PAD, PAD + headH + 6, W - PAD * 2, 2);

  // --- La grille -------------------------------------------------------
  board.slots.forEach((s, i) => {
    const it = by[s.key];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (cellW + GAP);
    const y = gridTop + row * (cellH + LABEL_H + GAP);
    const cover = it?.image ? imageMap.get(it.image) : null;
    const char = it?.charImage ? imageMap.get(it.charImage) : null;

    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 14);
    ctx.clip();
    ctx.fillStyle = theme.tile;
    ctx.fillRect(x, y, cellW, cellH);
    if (cover) drawCover(ctx, cover, x, y, cellW, cellH);
    else if (it) {
      // Jeu sans image : son nom au centre. (Une case vide reste vide : son
      // libellé est dessous, comme partout.)
      ctx.fillStyle = theme.soft;
      ctx.font = font(700, 21);
      ctx.textAlign = "center";
      const text = it.name;
      const words = text.split(" ");
      const lines = [];
      let line = "";
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (line && ctx.measureText(next).width > cellW - 24) {
          lines.push(line);
          line = w;
        } else line = next;
      }
      if (line) lines.push(line);
      lines.slice(0, 4).forEach((l, li) =>
        ctx.fillText(l, x + cellW / 2, y + cellH / 2 - ((lines.length - 1) * 26) / 2 + li * 26 + 7)
      );
      ctx.textAlign = "left";
    }
    ctx.restore();

    // Le personnage (protagoniste, antagoniste), en petite carte à droite.
    if (char) {
      const iw = Math.round(cellW * 0.38);
      const ih = Math.round(iw * (4 / 3));
      const ix = x + cellW - iw - 8;
      const iy = y + cellH - ih - 8;
      ctx.save();
      roundRect(ctx, ix - 3, iy - 3, iw + 6, ih + 6, 8);
      ctx.fillStyle = theme.gold;
      ctx.fill();
      roundRect(ctx, ix, iy, iw, ih, 6);
      ctx.clip();
      ctx.fillStyle = theme.tile;
      ctx.fillRect(ix, iy, iw, ih);
      drawCover(ctx, char, ix, iy, iw, ih, true);
      ctx.restore();
    }

    // Le libellé, sous la case, sur deux lignes au plus — grisé si vide.
    {
      ctx.fillStyle = it ? theme.text : theme.soft;
      ctx.font = font(700, 19);
      const words = labelOf(s).toUpperCase().split(" ");
      let first = "";
      let i2 = 0;
      for (; i2 < words.length; i2++) {
        const next = first ? `${first} ${words[i2]}` : words[i2];
        if (first && ctx.measureText(next).width > cellW) break;
        first = next;
      }
      ctx.fillText(first, x, y + cellH + 28);
      const rest = words.slice(i2).join(" ");
      if (rest) ctx.fillText(ellipsize(ctx, rest, cellW), x, y + cellH + 52);
    }
  });

  // --- La marque -------------------------------------------------------
  if (footH) {
    const fy = gridTop + gridH + 56;
    ctx.textAlign = "right";
    ctx.fillStyle = theme.soft;
    ctx.font = font(500, 24);
    const dom = "  ·  myplaylog.cc";
    ctx.fillText(dom, W - PAD, fy);
    const dw = ctx.measureText(dom).width;
    ctx.fillStyle = theme.gold;
    ctx.font = font(700, 32, "Space Grotesk");
    ctx.fillText("MyPlayLog", W - PAD - dw, fy);
    ctx.textAlign = "left";
  }

  return { width: W, height: H };
}
