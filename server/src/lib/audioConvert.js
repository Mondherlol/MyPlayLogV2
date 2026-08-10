import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

// ======================================================================
//  Transcodage vers un format que le NAVIGATEUR sait lire
// ======================================================================
// Pourquoi ce fichier existe : un son déposé dans le Perroquet doit être lu par
// DEUX moteurs, et ils n'ont pas les mêmes capacités.
//
//   ffmpeg, côté serveur, décode à peu près tout — y compris l'AMR des mémos
//   vocaux de téléphone (le décodeur est intégré depuis toujours).
//
//   Le navigateur, lui, ne décode PAS l'AMR. Aucun ne l'a jamais fait. Et il en
//   a besoin deux fois : pour dessiner la forme d'onde du rogneur
//   (client/src/components/AudioTrimmer.jsx passe par decodeAudioData), et pour
//   rejouer le son en partie.
//
// Accepter un .amr sans le convertir donnerait donc un dépôt qui a l'air de
// marcher — le serveur mesure son contour sans broncher — et un son INAUDIBLE
// en partie. D'où la règle : ce qui entre dans la librairie est toujours
// converti d'abord.
//
// Le mp3 comme cible : c'est le seul format qu'absolument tous les navigateurs
// décodent, et libmp3lame est présent dans le ffmpeg qu'on embarque.

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

// Les extensions et types que le navigateur ne sait pas décoder, et qu'il faut
// donc convertir. Liste volontairement courte : on ne transcode pas ce qui
// marche déjà, chaque conversion est une perte de qualité et un ffmpeg de plus.
//
//   amr / 3gp / awb : les mémos vocaux Android et les vieux téléphones ;
//   wma             : Windows Media, jamais implémenté hors d'Internet Explorer ;
//   aiff            : lu par Safari seulement.
const OPAQUE_EXT = new Set([".amr", ".3gp", ".3gpp", ".3g2", ".awb", ".wma", ".aif", ".aiff"]);
const OPAQUE_MIME = new Set([
  "audio/amr",
  "audio/amr-wb",
  "audio/3gpp",
  "audio/3gpp2",
  "audio/x-ms-wma",
  "audio/aiff",
  "audio/x-aiff",
]);

// ======================================================================
//  Monter le niveau d'un son trop faible
// ======================================================================
// Un son déposé par un joueur sort de son micro de téléphone, à deux mètres :
// les clips de la communauté plafonnent couramment à -19 dB alors que les sons
// officiels sont à -1. En partie, on n'entend pas ce qu'on doit imiter, et le
// réflexe est de monter le volume du système — donc d'exploser au clip suivant.
//
// ------------------------------------------------------- ce que ça NE change PAS
// Le SCORE. Le barème est insensible au niveau, par construction (cf.
// lib/soundContour.js) : l'enveloppe est ramenée à son propre pic, la hauteur est
// relative à sa médiane, et le seuil de silence est un ratio du pic. Monter un
// son ne le rend donc ni plus facile ni plus dur à imiter — ça le rend audible.
//
// -------------------------------------------- pourquoi ON RÉÉCRIT LE FICHIER
// L'alternative serait de stocker un gain et de l'appliquer à la lecture. Ça
// voudrait dire router chaque `<audio>` du site (manche, révélation, récap, fil,
// panneau d'admin, app mobile) dans un graphe Web Audio, pour un réglage qui n'a
// aucune raison de varier. On corrige le fichier une fois pour toutes.
//
// LE NOM NE CHANGE PAS, et c'est une contrainte dure : les parties déjà jouées
// gardent un instantané de l'URL du clip (models/PerroquetGame.js) et leur récap
// rejoue ce chemin. Renommer — ne serait-ce que l'extension — rendrait muets des
// récaps de l'historique. On réencode donc dans le même conteneur.

// Un pic à -1 dBFS : le maximum sans risquer l'écrêtage à la lecture.
const TARGET_DB = -1;
// En deçà de ce gain, on ne touche à rien : réencoder pour un demi-décibel
// n'apporte rien et coûte une génération de perte sur un format compressé.
const MIN_GAIN_DB = 1;
// Un son quasi muet (souffle à -50 dB) ne doit pas devenir un rugissement de
// bruit de fond. Au-delà, c'est que le fichier n'a rien à sauver.
const MAX_GAIN_DB = 30;

// L'encodeur est choisi par le CONTENEUR, pas par le codec d'origine : c'est
// l'extension qui doit rester valide, et un mp3 dans un .webm ne se lit nulle
// part.
const ENCODER = {
  ".wav": ["-c:a", "pcm_s16le"],
  ".mp3": ["-c:a", "libmp3lame", "-q:a", "3"],
  ".ogg": ["-c:a", "libopus", "-b:a", "96k"],
  ".oga": ["-c:a", "libopus", "-b:a", "96k"],
  ".webm": ["-c:a", "libopus", "-b:a", "96k"],
  ".m4a": ["-c:a", "aac", "-b:a", "128k"],
  ".mp4": ["-c:a", "aac", "-b:a", "128k"],
  ".aac": ["-c:a", "aac", "-b:a", "128k"],
  ".flac": ["-c:a", "flac"],
};

/** Le pic du fichier, en dBFS (0 = plein niveau). `null` si illisible. */
export function peakDb(file) {
  return new Promise((resolve) => {
    execFile(
      FFMPEG,
      ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
      { timeout: CONVERT_TIMEOUT_MS },
      (err, _out, stderr) => {
        // `volumedetect` écrit sur la sortie d'erreur, et ffmpeg sort en échec
        // parce qu'il n'y a pas de fichier de sortie : les deux sont normaux.
        const m = /max_volume:\s*(-?\d+(?:\.\d+)?) dB/.exec(String(stderr || ""));
        resolve(m ? Number(m[1]) : null);
      }
    );
  });
}

/**
 * Remonte le pic du fichier à -1 dBFS, SUR PLACE et sans changer son nom.
 *
 * Rend { applied, before, gainDb }. `applied: false` veut dire « il était déjà
 * au niveau » — ce n'est pas une erreur, c'est la réponse à afficher.
 */
export async function boostAudio(file) {
  const before = await peakDb(file);
  if (before == null) throw new Error("niveau illisible");

  const gainDb = Math.min(MAX_GAIN_DB, TARGET_DB - before);
  if (gainDb < MIN_GAIN_DB) return { applied: false, before, gainDb: 0 };

  const ext = path.extname(file).toLowerCase();
  const tmp = `${file}.boost${ext}`;
  await new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      [
        "-y", "-hide_banner", "-nostats", "-loglevel", "error",
        "-i", file,
        "-af", `volume=${gainDb.toFixed(2)}dB`,
        ...(ENCODER[ext] || ["-c:a", "libmp3lame"]),
        "-map_metadata", "-1",
        tmp,
      ],
      { timeout: CONVERT_TIMEOUT_MS },
      (err) => (err ? reject(new Error(String(err.message).slice(0, 200))) : resolve())
    );
  });

  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 128) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw new Error("réencodage vide");
  }
  // Remplacement en place : le nom, donc l'URL, ne bouge pas.
  await fs.promises.rename(tmp, file);
  return { applied: true, before, gainDb };
}

/**
 * Ce fichier a-t-il besoin d'être converti pour être lisible dans un navigateur ?
 * On regarde l'extension ET le type déclaré : les téléphones envoient volontiers
 * un mémo vocal en `application/octet-stream`, auquel cas seul le nom parle.
 */
export function needsTranscode(name = "", mime = "") {
  const ext = path.extname(String(name)).toLowerCase();
  const type = String(mime).split(";")[0].toLowerCase();
  return OPAQUE_EXT.has(ext) || OPAQUE_MIME.has(type);
}

const CONVERT_TIMEOUT_MS = 60000;

/**
 * Transcode n'importe quel audio en mp3 mono, et rend le chemin du résultat.
 *
 * `maxSeconds` borne la SORTIE, pas l'entrée : on accepte qu'on nous envoie un
 * fichier de trois minutes (c'est le cas normal — on cherche un cri dedans,
 * c'est le rogneur qui choisira lesquelles des cinq secondes garder), mais on
 * refuse de fabriquer un mp3 sans fin à partir d'un flux cassé.
 *
 * Le résultat porte le nom du fichier d'entrée, extension changée, et vit à côté
 * de lui (ou dans `outDir`). PAS de dossier temporaire dédié : sous Windows, un
 * `rm -r` juste après avoir lu le fichier échoue une fois sur deux (le
 * répertoire est encore tenu quelques millisecondes) et on accumulait des
 * dossiers vides. Un fichier, un `unlink` — l'appelant est propriétaire.
 */
export function toMp3(input, { maxSeconds = 180, outDir } = {}) {
  const dir = outDir || os.tmpdir();
  const out = path.join(dir, `${path.basename(input, path.extname(input))}.mp3`);
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      [
        "-y",
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-i",
        input,
        // Pas de piste vidéo : un .3gp est un conteneur, il peut en porter une,
        // et libmp3lame refuserait le flux.
        "-vn",
        "-ac",
        "1",
        // 32 kHz : l'AMR est échantillonné à 8 kHz, le suréchantillonnage
        // n'invente rien, mais mp3 n'accepte pas 8 kHz en MPEG-1. C'est ça ou un
        // fichier que le navigateur refuse — le tour complet du problème.
        "-ar",
        "32000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-t",
        String(maxSeconds),
        out,
      ],
      { timeout: CONVERT_TIMEOUT_MS },
      (err) => {
        if (err) {
          fs.promises.unlink(out).catch(() => {});
          return reject(new Error(String(err.message).slice(0, 200)));
        }
        // ffmpeg peut sortir en code 0 sur un fichier qui n'a aucune piste
        // audio : le mp3 existe alors et pèse zéro. On le traite comme un échec
        // plutôt que de laisser un fichier vide entrer dans la librairie.
        if (!fs.existsSync(out) || fs.statSync(out).size < 128) {
          fs.promises.unlink(out).catch(() => {});
          return reject(new Error("aucune piste audio"));
        }
        resolve(out);
      }
    );
  });
}
