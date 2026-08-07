import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";

// ======================================================================
//  Réduction des images envoyées (bannières, photos de profil).
// ======================================================================
// Un téléphone récent shoote en 4000 px et 8 Mo. Servie telle quelle, la
// bannière d'un profil mettait plusieurs secondes à apparaître — pour être
// affichée sur 400 px de large.
//
// On passe par FFMPEG plutôt que par `sharp` : il est DÉJÀ là (lib/audio.js et
// lib/videoEdit.js s'en servent), il tourne aussi bien en Docker alpine qu'en
// local, et ajouter une dépendance native au build pour redimensionner trois
// images serait disproportionné.
//
// Même résolution du binaire que partout ailleurs : binaire système en Docker,
// ffmpeg-static en local.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

const run = (args) =>
  new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout: 30000 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve()
    );
  });

/**
 * Réduit une image SUR PLACE : au plus `maxWidth` de large, ré-encodée en JPEG.
 *
 * Best-effort et volontairement silencieux : si ffmpeg n'est pas là ou refuse
 * le fichier, on garde l'original. Une bannière lourde vaut mieux qu'un upload
 * en échec.
 *
 * Renvoie le chemin final — il change quand l'extension change (un PNG devenu
 * JPEG), d'où l'appelant qui doit relire la valeur.
 */
export async function shrinkImage(filePath, { maxWidth = 1920, quality = 4 } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  // Un GIF est probablement animé : le ré-encoder en JPEG le figerait.
  if (ext === ".gif") return filePath;

  const out = filePath.replace(/\.[^.]+$/, "") + `.min.jpg`;
  try {
    await run([
      "-y",
      "-i", filePath,
      // `-2` garde la proportion en forçant une hauteur paire (exigence des
      // encodeurs) ; `min(iw,max)` n'agrandit JAMAIS une petite image.
      "-vf", `scale='min(iw,${maxWidth})':-2:flags=lanczos`,
      "-q:v", String(quality),
      "-map_metadata", "-1", // au passage : plus de GPS ni de modèle d'appareil
      out,
    ]);

    const before = fs.statSync(filePath).size;
    const after = fs.statSync(out).size;
    // Ré-encoder une image déjà légère peut l'alourdir : dans ce cas on garde
    // l'original et on jette le résultat.
    if (after >= before) {
      fs.unlink(out, () => {});
      return filePath;
    }

    const final = filePath.replace(/\.[^.]+$/, ".jpg");
    fs.renameSync(out, final);
    if (final !== filePath) fs.unlink(filePath, () => {});
    return final;
  } catch (err) {
    console.error("image resize:", err.message);
    fs.unlink(out, () => {});
    return filePath;
  }
}
