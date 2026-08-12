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

// ----------------------------------------------------------------------
//  UN SEUL MICRO À LA FOIS
// ----------------------------------------------------------------------
// Tout ce qui précède suppose qu'on peut tenir un flux micro ouvert pendant
// qu'un autre tourne ailleurs. C'EST FAUX SUR TÉLÉPHONE, et ça a coûté cher :
// le Perroquet en versus ouvre DEUX captures — celle de l'appel vocal
// (lib/voiceCall.js) et celle-ci, volontairement brute pour ne pas fausser la
// note. Sur un ordinateur les deux coexistent sans broncher ; sur iOS, et sur
// une bonne part d'Android, la seconde demande PREND le micro à la première,
// qui continue de se déclarer « live » en ne livrant plus que du silence.
//
// Le symptôme est parfaitement trompeur : le bouton s'enfonce, l'onde reste
// plate, le fichier part quand même, et le serveur note un silence. Et ça
// n'arrive QUE dans l'appel — c'est-à-dire précisément là où l'on ne pense pas
// à chercher une panne de micro.
//
// Sur ces appareils, la page emprunte donc le micro de l'appel au lieu d'en
// demander un second (voir pages/PerroquetVersus.jsx). On y perd la capture
// brute — l'appel corrige le gain et réduit le bruit, ce qui aplatit un peu
// l'enveloppe que le barème mesure — mais tout le monde subit le même
// traitement, et une imitation un peu lissée vaut infiniment mieux qu'une
// imitation muette.
export function oneMicAtATime() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS se présente comme un Mac de bureau depuis iOS 13 : l'écran tactile
  // est le seul indice qui reste.
  const iPad = /Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  return /iPhone|iPad|iPod|Android/i.test(ua) || iPad;
}

// ----------------------------------------------------------------------
//  Le son de la manche, sur un téléphone
// ----------------------------------------------------------------------
// `new Audio()` suivi de `.play()` depuis un effet, c'est ce qu'il y avait, et
// ça ne marche que sur ordinateur. iOS demande DEUX choses qu'un objet détaché
// déclenché par un minuteur ne peut pas donner :
//
//   1. que l'élément ait déjà joué UNE FOIS à la suite d'un geste. Toute
//      lecture ultérieure passe alors, y compris programmatique — mais la
//      première, jamais. C'est `prime()`, appelé sur les boutons de la page et,
//      en rattrapage, au premier contact avec l'écran.
//   2. que l'élément soit DANS le document et `playsInline` — même remarque
//      que pour les balises de l'appel (hooks/useVoiceCall.js).
//
// Sans ça, le son de la manche ne part jamais : personne n'entend ce qu'il doit
// imiter, et la fenêtre d'enregistrement s'ouvre quand même.
export function makeClipPlayer() {
  let el = null;
  let primed = false;
  let hooked = false;

  const ensure = () => {
    if (el) return el;
    el = document.createElement("audio");
    el.playsInline = true;
    el.preload = "auto";
    el.style.display = "none";
    document.body.appendChild(el);
    if (!hooked) {
      hooked = true;
      // Le rattrapage : le premier contact avec la page, où qu'il soit, sert
      // d'autorisation. On ne peut pas compter sur le seul bouton « Autoriser
      // le micro » — un joueur invité arrive parfois directement dans une
      // partie déjà lancée.
      document.addEventListener("pointerdown", () => prime(), { once: true });
    }
    return el;
  };

  // Un dixième de seconde de silence, fabriqué à la volée : il n'a pas besoin
  // d'être audible, seulement d'être une lecture réussie née d'un geste.
  const silence = () => {
    const n = 800; // échantillons
    const bytes = new Uint8Array(44 + n * 2);
    const dv = new DataView(bytes.buffer);
    const put = (off, s) => {
      for (let i = 0; i < s.length; i += 1) dv.setUint8(off + i, s.charCodeAt(i));
    };
    put(0, "RIFF");
    dv.setUint32(4, bytes.length - 8, true);
    put(8, "WAVEfmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true);
    dv.setUint32(28, 16000, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    put(36, "data");
    dv.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  };

  const prime = () => {
    const a = ensure();
    if (primed) return;
    const url = silence();
    a.src = url;
    a.play()
      .then(() => {
        primed = true;
        a.pause();
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        // Pas encore de geste valable : le prochain essai retentera.
        URL.revokeObjectURL(url);
      });
  };

  return {
    prime,
    play(url) {
      const a = ensure();
      a.src = url;
      a.currentTime = 0;
      a.play().catch(() => {
        // Refusé malgré tout : le prochain contact avec l'écran le lance. Sans
        // ce filet, la manche passe en silence et le joueur imite un son qu'il
        // n'a pas entendu.
        const retry = () => {
          primed = true;
          a.play().catch(() => {});
        };
        document.addEventListener("pointerdown", retry, { once: true });
      });
    },
    pause() {
      el?.pause();
    },
    destroy() {
      if (!el) return;
      el.pause();
      el.remove();
      el = null;
    },
  };
}

// ----------------------------------------------------------------------
//  Où sort le son quand un micro est ouvert
// ----------------------------------------------------------------------
// Sur iPhone, ouvrir un micro fait basculer tout l'appareil en mode « appel
// téléphonique » : le son part dans l'écouteur du haut, celui qu'on colle à
// l'oreille, à un volume minuscule. Le joueur entend donc à peine le son qu'il
// doit imiter, et croit que rien ne se lance.
//
// Safari 17 laisse enfin le dire (`navigator.audioSession`). Ailleurs, l'appel
// n'existe pas et la ligne ne fait rien.
export function preferSpeaker() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "play-and-record";
  } catch {
    /* type refusé : on garde celui que le navigateur a choisi */
  }
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
  // Sur iOS un contexte naît suspendu tant qu'un geste ne l'a pas réveillé :
  // sans ça l'analyseur ne lit que des zéros et l'onde reste plate pendant
  // qu'on crie — on croit alors que le micro ne capte rien.
  ctx.resume?.().catch(() => {});
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
