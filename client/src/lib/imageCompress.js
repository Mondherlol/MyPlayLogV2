// ======================================================================
//  Compression d'image côté navigateur (avant envoi dans le chat)
// ======================================================================
// Une photo de téléphone pèse 4-8 Mo pour 4000 px de large : inutile dans une
// conversation, ça sature le disque du serveur et rame à l'affichage. On la
// redimensionne à une taille d'écran généreuse et on la ré-encode — sans que
// la différence se voie à l'usage.
//
// Les GIF sont laissés INTACTS : passer par un canvas ne garderait que la
// première image (adieu l'animation).

const MAX_DIM = 1920; // côté le plus long, en pixels
const QUALITY = 0.82; // compromis qualité/poids classique
const SKIP_UNDER = 320 * 1024; // sous ~320 ko, ça n'en vaut pas la peine

// Le WebP pèse ~30 % de moins que le JPEG à qualité égale. On vérifie qu'il
// est réellement encodable (vieux Safari) avant de s'en servir.
let webpOk = null;
function supportsWebp() {
  if (webpOk !== null) return webpOk;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpOk = false;
  }
  return webpOk;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image illisible"));
    };
    img.src = url;
  });
}

// Renvoie un File compressé, ou le fichier d'origine si la compression n'a
// rien à apporter (ou a échoué : on ne bloque jamais un envoi pour ça).
export async function compressImage(file) {
  if (!file || !file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // animation à préserver
  if (file.size < SKIP_UNDER) return file;

  try {
    const img = await loadImage(file);
    const { naturalWidth: w, naturalHeight: h } = img;
    if (!w || !h) return file;

    const ratio = Math.min(1, MAX_DIM / Math.max(w, h));
    const width = Math.round(w * ratio);
    const height = Math.round(h * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Rééchantillonnage de qualité (par défaut le navigateur va au plus vite).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const type = supportsWebp() ? "image/webp" : "image/jpeg";
    const blob = await new Promise((res) => canvas.toBlob(res, type, QUALITY));
    // Compression contre-productive (petite image déjà optimisée) → on garde
    // l'original.
    if (!blob || blob.size >= file.size) return file;

    const ext = type === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.${ext}`, { type, lastModified: Date.now() });
  } catch {
    return file; // au pire, on envoie l'original
  }
}
