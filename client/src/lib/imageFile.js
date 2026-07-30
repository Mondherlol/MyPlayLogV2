// ======================================================================
//  Alléger une image avant de l'envoyer
// ======================================================================
// Une jaquette d'impression pèse couramment quinze mégaoctets. Le serveur les
// refuse, et il aurait tort de les accepter : la texture finale est de toute
// façon ramenée à 4096 px (voir MAX_TEX), donc tout ce qui dépasse est du
// stockage et de la bande passante dépensés pour des pixels que personne ne
// verra jamais.
//
// On réduit donc ICI, dans le navigateur, avant l'envoi — et de la façon la
// moins destructrice possible :
//
//   1. si le fichier tient déjà dans le budget ET dans la définition utile, il
//      part TEL QUEL. Pas de ré-encodage gratuit d'un PNG propre ;
//   2. sinon on lâche d'abord sur la COMPRESSION, qui ne se voit pas ;
//   3. et seulement en dernier recours sur la DÉFINITION, qui se voit.

// Budget d'envoi. Le serveur accepte davantage (il faut bien une marge pour ce
// qui traverse sans être ré-encodé), mais on vise nettement en dessous : c'est
// ce qui restera sur le disque du VPS, une jaquette par titre.
export const MAX_UPLOAD = 8 * 1024 * 1024;

// Plafond de définition. La feuille servie au boîtier est bornée à 4096 px ;
// on garde de la marge parce qu'une jaquette est souvent RECADRÉE ensuite —
// n'en conserver que 60 % suppose d'avoir importé large.
export const MAX_SIDE = 7000;

// Décode un fichier image. `createImageBitmap` fait le travail hors du fil
// principal quand il existe ; le repli par balise couvre le reste.
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* format exotique : on tente la balise */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Image illisible."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Encode un canvas en JPEG sous un poids donné. On lâche d'abord sur la
// compression (ce qui ne se voit pas), et seulement ensuite sur la définition
// (ce qui se voit) : une jaquette un peu plus compressée reste une jaquette,
// une jaquette réduite de moitié perd le texte de son dos.
export async function canvasToJpegUnder(canvas, maxBytes) {
  const encode = (c, q) => new Promise((res) => c.toBlob(res, "image/jpeg", q));
  let source = canvas;
  for (const quality of [0.94, 0.86, 0.78]) {
    const blob = await encode(source, quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  for (let shrink = 0.8; shrink >= 0.4; shrink -= 0.2) {
    source = redraw(canvas, Math.round(canvas.width * shrink), Math.round(canvas.height * shrink));
    const blob = await encode(source, 0.86);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return encode(source, 0.7);
}

// Redessine à une autre taille, sur fond blanc. Le fond n'est pas décoratif :
// un canvas garde une couche alpha que le JPEG n'a pas, et toute zone restée
// transparente ressortirait NOIRE à la conversion.
function redraw(source, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Renvoie le fichier à envoyer, et ce qu'il est devenu — l'appelant peut ainsi
// le DIRE plutôt que de rétrécir l'image d'un utilisateur en silence.
export async function shrinkImageFile(
  file,
  { maxBytes = MAX_UPLOAD, maxSide = MAX_SIDE } = {}
) {
  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    // Illisible ici ne veut pas dire illisible partout (un TIFF, un AVIF que
    // ce navigateur ignore) : on laisse passer, le serveur tranchera.
    return { file, changed: false, from: file.size, to: file.size };
  }

  // Les dimensions sont relevées AVANT toute libération : fermer un
  // `ImageBitmap` remet sa largeur et sa hauteur à zéro, et les lire ensuite
  // renverrait 0 × 0 sans la moindre erreur.
  const w = bitmap.width;
  const h = bitmap.height;
  const side = Math.max(w, h);

  if (file.size <= maxBytes && side <= maxSide) {
    bitmap.close?.();
    return { file, changed: false, from: file.size, to: file.size, w, h };
  }

  const scale = Math.min(1, maxSide / side);
  const canvas = redraw(bitmap, Math.round(w * scale), Math.round(h * scale));
  bitmap.close?.();

  const blob = await canvasToJpegUnder(canvas, maxBytes);
  if (!blob) return { file, changed: false, from: file.size, to: file.size };

  const name = `${(file.name || "image").replace(/\.[^.]+$/, "")}.jpg`;
  return {
    file: new File([blob], name, { type: "image/jpeg" }),
    changed: true,
    from: file.size,
    to: blob.size,
    w: canvas.width,
    h: canvas.height,
  };
}

// « 15728640 » → « 15 Mo ».
export const fmtBytes = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",").replace(",0", "")} Mo`
    : `${Math.round(n / 1024)} ko`;
