import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import SoundClip from "../models/SoundClip.js";
import { shrinkImage } from "./imageResize.js";

// ======================================================================
//  L'illustration d'un son du Perroquet
// ======================================================================
// Une image par son, montrée À LA RÉVÉLATION (la tête du personnage, la
// jaquette, le mème). Deux problèmes réels, tous les deux dus au dépôt en lot :
//
//  1. LE POIDS. On dépose une capture d'écran ou une image sortie d'un moteur de
//     recherche : 2000 px et 3 Mo, pour être affichée sur une vignette de 40 px
//     et une pastille de 72 px. Tout ce poids voyage à chaque révélation.
//
//  2. LE DOUBLON. Quinze cris de Yoshi tirés du même fichier veulent la même
//     tête de Yoshi. Stockée quinze fois, c'était quinze copies OCTET POUR OCTET
//     du même fichier sur le disque, et quinze URLs différentes — donc quinze
//     téléchargements côté joueur, là où le cache du navigateur aurait suffi.
//
// D'où les deux mesures ci-dessous, et surtout la conséquence qu'elles
// entraînent : UNE IMAGE PEUT ÊTRE PARTAGÉE, donc on ne l'efface plus avec le
// son qui la portait sans vérifier que personne d'autre ne s'en sert
// (`dropClipImage`). C'est le piège de la déduplication, et il est silencieux :
// sans ce garde-fou, supprimer un clip rendrait aveugles les quatorze autres.

// 640 px de large : la plus grande utilisation est la pastille de la révélation,
// qui fait 72 px de côté (144 sur un écran à deux fois la densité). 640 laisse de
// la marge pour un futur affichage plus grand sans rien payer aujourd'hui.
const MAX_WIDTH = 640;
// Qualité JPEG au sens de ffmpeg (2 = quasi sans perte, 31 = charcuterie). 5 est
// invisible sur une image de cette taille.
const QUALITY = 5;

// Le nom d'un fichier d'après ses octets. C'est LA convention de ce module : un
// nom `i-<empreinte>.<ext>` ne peut venir que d'ici.
async function hashedName(file) {
  const bytes = await fs.promises.readFile(file);
  const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  return `i-${hash}${path.extname(file).toLowerCase()}`;
}

/**
 * Cette image est-elle DÉJÀ passée par ici ? — c'est-à-dire son nom est-il
 * l'empreinte de son propre contenu.
 *
 * Sert à la reprise de l'existant (la route `optimize-images` de l'admin), et
 * elle en a absolument besoin. Sans ce test, chaque passe ré-encode une image
 * déjà réduite : le JPEG ressort un peu plus petit et un peu plus abîmé, donc
 * sous une empreinte différente, donc sous un nouveau nom — la reprise n'était
 * pas idempotente, elle dégradait les images un peu plus à chaque clic tout en
 * affirmant avoir « repris 2 illustrations ».
 */
export async function isStoredClipImage(nameOrUrl, dir) {
  const base = path.basename(String(nameOrUrl || ""));
  if (!/^i-[0-9a-f]{16}\.[a-z0-9]+$/i.test(base)) return false;
  const full = path.join(dir, base);
  if (!fs.existsSync(full)) return false;
  return base === (await hashedName(full));
}

/**
 * Range l'image déposée : réduite, puis nommée PAR SON CONTENU.
 *
 * Le nom est l'empreinte des octets finaux, ce qui rend la déduplication
 * automatique et sans état : deux dépôts de la même image aboutissent au même
 * nom, donc au même fichier — on jette le second et on renvoie le premier. Pas
 * de table à tenir, pas de compteur de références à maintenir juste.
 *
 * Rend le nom de fichier à stocker (jamais le chemin absolu).
 */
export async function storeClipImage(tmpPath, dir) {
  const shrunk = await shrinkImage(tmpPath, { maxWidth: MAX_WIDTH, quality: QUALITY });
  const name = await hashedName(shrunk);
  const final = path.join(dir, name);

  if (fs.existsSync(final)) {
    // Déjà là, à l'octet près : on garde celui du disque. Le nôtre est un
    // doublon, il n'a rien à apporter. Le ménage est ATTENDU — un `unlink` lancé
    // sans être attendu laisse le temporaire visible derrière la fonction, et
    // c'est un fichier orphelin que plus personne ne réclamera.
    await fs.promises.unlink(shrunk).catch(() => {});
    return name;
  }
  await fs.promises.rename(shrunk, final);
  return name;
}

/**
 * Efface l'image d'un son — SEULEMENT si aucun autre son ne la référence.
 *
 * `exceptId` est le clip qu'on est en train de supprimer ou de modifier : il ne
 * doit pas se compter lui-même comme utilisateur de l'image qu'il abandonne.
 */
export async function dropClipImage(imageUrl, dir, exceptId = null) {
  if (!imageUrl) return;
  const name = path.basename(String(imageUrl));
  if (!name || name.includes("..")) return;
  const q = { image: imageUrl };
  if (exceptId) q._id = { $ne: exceptId };
  const shared = await SoundClip.countDocuments(q);
  if (shared > 0) return; // quelqu'un d'autre l'affiche : on n'y touche pas
  fs.promises.unlink(path.join(dir, name)).catch(() => {});
}

/**
 * Valide une image DÉJÀ EN PLACE, désignée par son URL ou son nom de fichier.
 *
 * C'est ce qui permet au dépôt en lot de n'envoyer les octets qu'une fois : le
 * premier son de la fournée téléverse l'image, les suivants ne renvoient que son
 * nom. On ne fait donc confiance à rien ici — un nom traversant (`../`) ou un
 * fichier absent rend `null`, et l'appelant se passe d'illustration.
 */
export function knownClipImage(value, dir) {
  const name = path.basename(String(value || ""));
  if (!name || name === "." || name.includes("..")) return null;
  return fs.existsSync(path.join(dir, name)) ? name : null;
}
