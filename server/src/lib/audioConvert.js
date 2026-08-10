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
