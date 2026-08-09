// ======================================================================
//  Enregistrement d'un message vocal
// ======================================================================
// Isolé de l'interface parce qu'il n'a rien de React : un micro, un encodeur,
// un analyseur de niveaux. Le composant ne veut savoir que trois choses — ça
// tourne depuis combien de temps, à quel volume on parle, et voilà le fichier.
//
// LA FORME D'ONDE SE MESURE PENDANT QU'ON PARLE, jamais après. L'analyseur de
// la Web Audio API donne le niveau instantané pour rien pendant qu'on
// enregistre ; le recalculer ensuite obligerait à décoder tout le fichier —
// côté client (lent sur mobile) ou côté serveur (ffmpeg pour redessiner ce
// qu'on avait déjà). C'est aussi ce qui permet d'afficher les barres qui
// bougent en direct : la même mesure sert à l'écran et au message.

// Ce que le navigateur sait produire, par ordre de préférence. Safari ne connaît
// que mp4 ; Chrome et Firefox préfèrent webm/opus, bien plus léger.
const CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

// L'enregistrement est-il seulement possible ici ? (Safari < 14, navigateur en
// http non sécurisé, appareil sans micro…)
export function canRecord() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

// Nombre de barres gardées dans le message. Peu, volontairement : au-delà, la
// silhouette ne se lit plus sur la largeur d'une bulle (cf. models/Message.js).
const WAVE_POINTS = 48;

// Démarre l'enregistrement. Renvoie une poignée :
//   .stop()   → { blob, mimeType, duration, waveform } (null si rien d'utile)
//   .cancel() → coupe tout, ne rend rien
//   .levels   → les niveaux mesurés jusqu'ici (0..100), pour l'affichage direct
export async function startRecording({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Un message vocal, ce n'est pas de la musique : on prend tout ce que le
      // navigateur sait faire pour rendre une voix intelligible dans le métro.
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.addEventListener("dataavailable", (e) => {
    if (e.data?.size) chunks.push(e.data);
  });

  // --- Mesure des niveaux ---
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
    // Écart quadratique moyen autour du zéro (128) = le volume perçu, en gros.
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const d = (buf[i] - 128) / 128;
      sum += d * d;
    }
    const rms = Math.sqrt(sum / buf.length);
    // Racine plutôt que linéaire : l'oreille est logarithmique, et sans ça une
    // conversation normale dessine des barres minuscules.
    const level = Math.max(0, Math.min(100, Math.round(Math.sqrt(rms) * 160)));
    levels.push(level);
    onLevel?.(level);
    raf = requestAnimationFrame(tick);
  };

  const startedAt = Date.now();
  // ⚠️ PAS DE DÉCOUPAGE PÉRIODIQUE (`rec.start(250)`).
  //
  // Il y en avait un, au motif qu'on perdrait moins si l'enregistrement
  // s'interrompait — sauf qu'on n'exploite JAMAIS les morceaux intermédiaires :
  // on les recolle tous à l'arrêt, et à l'arrêt seulement. Le découpage
  // n'apportait donc rien, et il coûtait cher : seul le premier morceau porte
  // l'en-tête du conteneur, si bien que le fichier recollé se termine par un
  // bloc partiel. Le navigateur le lit quand même en flux (d'où un vocal
  // « Normal » complet), mais `decodeAudioData` est plus strict et jette la
  // fin — c'est ce qui rabotait la dernière seconde des vocaux passés par un
  // effet, le « Monstre » en tête puisqu'il étire ce qui reste.
  //
  // Sans découpage, MediaRecorder rend UN fichier bien formé à l'arrêt.
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
    for (const track of stream.getTracks()) track.stop();
  };

  // Ramène les N mesures prises (une par frame, donc des centaines) aux
  // quelques dizaines de barres du message, en gardant le PIC de chaque
  // tranche : une moyenne aplatirait la parole en un trait uniforme.
  const condense = () => {
    if (!levels.length) return [];
    const out = [];
    const step = levels.length / WAVE_POINTS;
    for (let i = 0; i < WAVE_POINTS; i += 1) {
      const from = Math.floor(i * step);
      const to = Math.max(from + 1, Math.floor((i + 1) * step));
      let peak = 0;
      for (let k = from; k < to && k < levels.length; k += 1) {
        if (levels[k] > peak) peak = levels[k];
      }
      out.push(peak);
    }
    return out;
  };

  return {
    levels,
    stop() {
      return new Promise((resolve) => {
        const done = () => {
          teardown();
          const duration = (Date.now() - startedAt) / 1000;
          if (!chunks.length) return resolve(null);
          resolve({
            blob: new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" }),
            mimeType: rec.mimeType || mimeType || "audio/webm",
            duration,
            waveform: condense(),
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
