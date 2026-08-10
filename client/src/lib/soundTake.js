import { pickMimeType, canRecord } from "./voiceRecorder";

export { canRecord };

// ======================================================================
//  Prises de son du Perroquet
// ======================================================================
// Proche de lib/voiceRecorder.js, mais avec une différence qui justifie un
// fichier à part : ICI, LE FLUX MICRO SURVIT À LA PRISE.
//
// Le recorder des messages vocaux ouvre `getUserMedia` au début et coupe tout à
// la fin — parfait pour un vocal qu'on enregistre une fois. Le Perroquet
// enchaîne cinq prises d'une seconde, et rouvrir le micro à chaque manche coûte
// 100 à 300 ms pendant lesquelles RIEN N'EST CAPTÉ. Comme le joueur crie dès
// qu'il appuie, c'est l'attaque du son qui disparaît — c'est-à-dire exactement
// ce que le barème mesure (l'enveloppe de volume, cf. server/src/lib/
// soundContour.js). On perdrait des points à cause d'une latence technique.
//
// On ouvre donc le micro UNE FOIS pour toute la partie, et chaque manche ne
// fait qu'attacher un MediaRecorder à un flux déjà chaud. Effet de bord
// bienvenu : la demande d'autorisation n'apparaît qu'au lancement, jamais au
// milieu d'une manche.

// Ouvre le micro pour la partie. `raw` coupe les traitements du navigateur :
// voir l'explication dans lib/voiceRecorder.js — le correcteur de gain
// automatique aplatit l'enveloppe qu'on veut justement mesurer.
export function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

export function closeMic(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

// Une prise. Rend une poignée { stop(), cancel(), levels }.
//
// `stop()` rend { blob, mimeType, duration } — ou null si rien n'a été capté.
// On ne calcule PAS de silhouette ici, contrairement aux vocaux : le serveur
// mesure de toute façon le son bien plus finement pour le noter, et il renvoie
// les deux courbes. En redessiner une approximative côté client ne servirait
// qu'à afficher, pendant une seconde, une forme qui ne correspond pas à celle
// du résultat.
export function startTake(stream, { onLevel } = {}) {
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.addEventListener("dataavailable", (e) => {
    if (e.data?.size) chunks.push(e.data);
  });

  // Un analyseur juste pour le retour visuel pendant qu'on crie : sans lui, on
  // ne sait pas si le micro capte quoi que ce soit, et on découvre au résultat
  // qu'on a soufflé dans le vide.
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const levels = [];
  let raf = 0;

  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const d = (buf[i] - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / buf.length);
    const level = Math.max(0, Math.min(100, Math.round(Math.sqrt(rms) * 160)));
    levels.push(level);
    onLevel?.(level);
    raf = requestAnimationFrame(tick);
  };

  const startedAt = Date.now();
  // Pas de découpage périodique : voir lib/voiceRecorder.js. Un seul morceau à
  // l'arrêt = un fichier bien formé, que `decodeAudioData` (et ffmpeg côté
  // serveur) relisent jusqu'au bout.
  rec.start();
  raf = requestAnimationFrame(tick);

  const teardown = () => {
    cancelAnimationFrame(raf);
    try {
      source.disconnect();
      ctx.close();
    } catch {
      /* ignore */
    }
    // ⚠️ On ne touche PAS aux pistes du flux : il sert aux manches suivantes.
    // C'est toute la raison d'être de ce fichier.
  };

  return {
    levels,
    stop() {
      return new Promise((resolve) => {
        const done = () => {
          teardown();
          if (!chunks.length) return resolve(null);
          resolve({
            blob: new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }),
            mimeType: rec.mimeType || mimeType || "audio/webm",
            duration: (Date.now() - startedAt) / 1000,
          });
        };
        if (rec.state === "inactive") return done();
        rec.addEventListener("stop", done, { once: true });
        rec.stop();
      });
    },
    cancel() {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* ignore */
      }
      teardown();
    },
  };
}

// Le nom d'un son, deviné depuis le nom du fichier déposé.
//
// C'est presque toujours le bon : on télécharge « yoshi-cri.mp3 », pas
// « audio_47.mp3 ». Le pré-remplir évite le champ vide devant lequel on hésite,
// et il reste modifiable — c'est une proposition, pas une décision.
export function niceSoundName(filename = "") {
  const base = String(filename).replace(/\.[a-z0-9]+$/i, "");
  const clean = base
    .replace(/[_+]+/g, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return clean ? clean[0].toUpperCase() + clean.slice(1) : "";
}
