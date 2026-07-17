// ======================================================================
//  Lecture des fichiers curseur Windows (.cur) et animés (.ani).
// ======================================================================
// Les navigateurs ne savent PAS afficher un `.ani`, et n'affichent le `.cur`
// que de façon inégale. On lit donc le binaire nous-mêmes et on convertit
// chaque image en PNG (universellement accepté par `cursor: url()`), en
// récupérant au passage le point actif (hotspot) et, pour les `.ani`, la
// séquence + les durées d'animation.
//
// Découpage :
//  - fonctions PURES (aucun DOM) qui décodent le binaire → RGBA / séquence.
//    Testables sous Node.
//  - couche DOM (canvas) qui transforme le RGBA en data URL PNG.
//
// Formats gérés : ICO/CUR à images DIB (1/4/8/24/32 bpp + masque AND) ou PNG
// embarqué ; ANI (conteneur RIFF « ACON »).

const CURSOR_MAX = 128; // au-delà, les navigateurs ignorent le curseur

// ---------------------------------------------------------------------
//  PUR — décodage binaire
// ---------------------------------------------------------------------

function fourcc(dv, off) {
  return String.fromCharCode(
    dv.getUint8(off),
    dv.getUint8(off + 1),
    dv.getUint8(off + 2),
    dv.getUint8(off + 3)
  );
}

// Décode une image DIB (BITMAPINFOHEADER) d'un ICO/CUR → { width, height, rgba }.
function decodeDib(buf, off) {
  const dv = new DataView(buf);
  const headerSize = dv.getUint32(off, true);
  const width = dv.getInt32(off + 4, true);
  const heightFull = dv.getInt32(off + 8, true);
  const bpp = dv.getUint16(off + 14, true);
  const compression = dv.getUint32(off + 16, true);
  const clrUsed = dv.getUint32(off + 32, true);

  // BI_RGB (0) partout ; BI_BITFIELDS (3) toléré en 32 bpp (traité en BGRA).
  if (compression !== 0 && !(bpp === 32 && compression === 3)) {
    throw new Error("Compression de curseur non prise en charge.");
  }

  const topDown = heightFull < 0;
  const height = Math.abs(heightFull) >> 1; // l'entête compte XOR + masque AND
  if (width <= 0 || height <= 0) throw new Error("Dimensions de curseur invalides.");

  // Palette (BGRA) pour les profondeurs indexées.
  const palCount = bpp <= 8 ? clrUsed || 1 << bpp : 0;
  const palOff = off + headerSize;
  const palette = new Array(palCount);
  for (let i = 0; i < palCount; i++) {
    const p = palOff + i * 4;
    palette[i] = [dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2)]; // B,G,R
  }

  const rowXor = (((width * bpp + 31) >> 5) << 2) | 0; // aligné 4 octets
  const rowAnd = (((width + 31) >> 5) << 2) | 0;
  const xorOff = palOff + palCount * 4;
  const andOff = xorOff + rowXor * height;

  const rgba = new Uint8ClampedArray(width * height * 4);
  let maxAlpha = 0;

  const andBitAt = (srcY, px) => {
    const idx = andOff + srcY * rowAnd + (px >> 3);
    if (idx >= buf.byteLength) return 0;
    return (dv.getUint8(idx) >> (7 - (px & 7))) & 1;
  };

  for (let py = 0; py < height; py++) {
    const srcY = topDown ? py : height - 1 - py;
    for (let px = 0; px < width; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (bpp === 32) {
        const p = xorOff + srcY * rowXor + px * 4;
        b = dv.getUint8(p);
        g = dv.getUint8(p + 1);
        r = dv.getUint8(p + 2);
        a = dv.getUint8(p + 3);
      } else if (bpp === 24) {
        const p = xorOff + srcY * rowXor + px * 3;
        b = dv.getUint8(p);
        g = dv.getUint8(p + 1);
        r = dv.getUint8(p + 2);
        a = andBitAt(srcY, px) ? 0 : 255;
      } else {
        let ci = 0;
        if (bpp === 8) ci = dv.getUint8(xorOff + srcY * rowXor + px);
        else if (bpp === 4) {
          const byte = dv.getUint8(xorOff + srcY * rowXor + (px >> 1));
          ci = px & 1 ? byte & 0x0f : byte >> 4;
        } else if (bpp === 1) {
          const byte = dv.getUint8(xorOff + srcY * rowXor + (px >> 3));
          ci = (byte >> (7 - (px & 7))) & 1;
        }
        const c = palette[ci] || [0, 0, 0];
        b = c[0];
        g = c[1];
        r = c[2];
        a = andBitAt(srcY, px) ? 0 : 255;
      }
      const di = (py * width + px) * 4;
      rgba[di] = r;
      rgba[di + 1] = g;
      rgba[di + 2] = b;
      rgba[di + 3] = a;
      if (a > maxAlpha) maxAlpha = a;
    }
  }

  // 32 bpp sans canal alpha exploitable (mal fabriqué) : on retombe sur le
  // masque AND pour la transparence.
  if (bpp === 32 && maxAlpha === 0) {
    for (let py = 0; py < height; py++) {
      const srcY = topDown ? py : height - 1 - py;
      for (let px = 0; px < width; px++) {
        rgba[(py * width + px) * 4 + 3] = andBitAt(srcY, px) ? 0 : 255;
      }
    }
  }

  return { width, height, rgba };
}

// Choisit la meilleure image d'un ICO/CUR (≤128 px et la plus grande) et la
// décode. Renvoie soit { rgba, width, height, hotspotX, hotspotY }, soit
// { png: Uint8Array, hotspotX, hotspotY } si l'image est un PNG embarqué.
export function decodeIconFile(buf) {
  const dv = new DataView(buf);
  const type = dv.getUint16(2, true); // 1 = ICO, 2 = CUR
  const count = dv.getUint16(4, true);
  if (count < 1) throw new Error("Fichier curseur vide.");

  let best = null;
  const score = (w) => (w <= CURSOR_MAX ? w : CURSOR_MAX - w); // ≤128 préféré, gros mieux
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const e = {
      width: dv.getUint8(o) || 256,
      height: dv.getUint8(o + 1) || 256,
      hotspotX: type === 2 ? dv.getUint16(o + 4, true) : 0,
      hotspotY: type === 2 ? dv.getUint16(o + 6, true) : 0,
      bytes: dv.getUint32(o + 8, true),
      offset: dv.getUint32(o + 12, true),
    };
    if (!best || score(e.width) > score(best.width)) best = e;
  }

  const head = new Uint8Array(buf, best.offset, Math.min(8, best.bytes));
  const isPng =
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (isPng) {
    return {
      png: new Uint8Array(buf, best.offset, best.bytes).slice(),
      hotspotX: best.hotspotX,
      hotspotY: best.hotspotY,
    };
  }
  const dib = decodeDib(buf, best.offset);
  return { ...dib, hotspotX: best.hotspotX, hotspotY: best.hotspotY };
}

// Découpe un conteneur ANI (RIFF/ACON) en images + séquence + durées.
// Renvoie { icons: [ArrayBuffer], seq: [i…], durationsMs: [ms…] }.
export function parseAni(buf) {
  const dv = new DataView(buf);
  if (fourcc(dv, 0) !== "RIFF" || fourcc(dv, 8) !== "ACON")
    throw new Error("Fichier .ani invalide.");

  const icons = [];
  let nFrames = 0;
  let nSteps = 0;
  let dispRate = 6; // jiffies (1/60 s) par défaut
  let seq = null;
  let rates = null;

  let pos = 12;
  while (pos + 8 <= buf.byteLength) {
    const id = fourcc(dv, pos);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "anih") {
      nFrames = dv.getUint32(body + 4, true);
      nSteps = dv.getUint32(body + 8, true);
      dispRate = dv.getUint32(body + 28, true) || 6;
    } else if (id === "rate") {
      rates = [];
      for (let p = body; p + 4 <= body + size; p += 4) rates.push(dv.getUint32(p, true));
    } else if (id === "seq ") {
      seq = [];
      for (let p = body; p + 4 <= body + size; p += 4) seq.push(dv.getUint32(p, true));
    } else if (id === "LIST" && fourcc(dv, body) === "fram") {
      let p = body + 4;
      while (p + 8 <= body + size) {
        const sid = fourcc(dv, p);
        const ssize = dv.getUint32(p + 4, true);
        if (sid === "icon") icons.push(buf.slice(p + 8, p + 8 + ssize));
        p += 8 + ssize + (ssize & 1); // chunks alignés sur un mot
      }
    }
    pos = body + size + (size & 1);
  }

  if (!icons.length) throw new Error("Aucune image dans le .ani.");

  const steps = nSteps || seq?.length || nFrames || icons.length;
  const order = [];
  const durationsMs = [];
  const JIFFY = 1000 / 60;
  for (let i = 0; i < steps; i++) {
    const iconIdx = seq ? seq[i] : i;
    order.push(Math.min(iconIdx ?? 0, icons.length - 1));
    const jiffies = rates ? rates[i] ?? dispRate : dispRate;
    durationsMs.push(Math.max(16, Math.round(jiffies * JIFFY)));
  }
  return { icons, seq: order, durationsMs };
}

// ---------------------------------------------------------------------
//  DOM — conversion en PNG (data URL)
// ---------------------------------------------------------------------

// Facteur d'échelle pour ramener une image sous CURSOR_MAX.
function fitScale(w, h) {
  const m = Math.max(w, h);
  return m > CURSOR_MAX ? CURSOR_MAX / m : 1;
}

// RGBA brut → data URL PNG (via canvas), redimensionné si trop grand.
function rgbaToDataUrl({ rgba, width, height }) {
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  const scale = fitScale(width, height);
  if (scale === 1) return { url: src.toDataURL("image/png"), width, height };
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const dst = document.createElement("canvas");
  dst.width = w;
  dst.height = h;
  dst.getContext("2d").drawImage(src, 0, 0, w, h);
  return { url: dst.toDataURL("image/png"), width: w, height: h };
}

// Charge un PNG embarqué (rare) via <img> et le normalise en data URL PNG ≤128.
function pngBytesToDataUrl(bytes) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = fitScale(img.width, img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve({ url: c.toDataURL("image/png"), width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image de curseur illisible."));
    };
    img.src = url;
  });
}

// Convertit une image ICO/CUR (ArrayBuffer) en { url, width, height, hotspotX, hotspotY }.
async function iconFileToFrame(buf) {
  const dec = decodeIconFile(buf);
  const out = dec.png
    ? await pngBytesToDataUrl(dec.png)
    : rgbaToDataUrl(dec);
  return { ...out, hotspotX: dec.hotspotX, hotspotY: dec.hotspotY };
}

const readArrayBuffer = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Lecture du fichier impossible."));
    fr.readAsArrayBuffer(file);
  });

// Détecte .ani vs .cur/.ico (par la signature, pas seulement l'extension).
function looksLikeAni(buf) {
  if (buf.byteLength < 12) return false;
  const dv = new DataView(buf);
  return fourcc(dv, 0) === "RIFF" && fourcc(dv, 8) === "ACON";
}

// ---------------------------------------------------------------------
//  API publique (DOM)
// ---------------------------------------------------------------------
// Lit un fichier .cur / .ani (ou .ico) et renvoie un descripteur de curseur :
//   { animated, frames: [dataUrl…], durationsMs: [ms…], hotspotX, hotspotY }
// `frames` est déjà dans l'ordre de lecture (séquence dépliée pour un .ani).
export async function parseCursorFile(file) {
  const buf = await readArrayBuffer(file);

  if (looksLikeAni(buf)) {
    const { icons, seq, durationsMs } = parseAni(buf);
    // Décode chaque image UNIQUE une seule fois, puis déplie la séquence.
    const decoded = [];
    for (const ico of icons) decoded.push(await iconFileToFrame(ico));
    const frames = seq.map((i) => decoded[i]?.url).filter(Boolean);
    if (!frames.length) throw new Error("Aucune image exploitable dans le .ani.");
    const hs = decoded[seq[0]] || decoded[0];
    return {
      animated: frames.length > 1,
      frames,
      durationsMs: durationsMs.slice(0, frames.length),
      hotspotX: hs?.hotspotX || 0,
      hotspotY: hs?.hotspotY || 0,
    };
  }

  const frame = await iconFileToFrame(buf);
  return {
    animated: false,
    frames: [frame.url],
    durationsMs: [100],
    hotspotX: frame.hotspotX || 0,
    hotspotY: frame.hotspotY || 0,
  };
}

// Un data URL → Blob (pour l'upload multipart des images générées).
export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(head)?.[1] || "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
