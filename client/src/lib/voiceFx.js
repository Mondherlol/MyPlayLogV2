// ======================================================================
//  Effets de voix pour les messages vocaux
// ======================================================================
// COMMENT ÇA MARCHE, ET POURQUOI COMME ÇA.
//
// On ne transforme pas le son en direct : on enregistre normalement, puis on
// REJOUE l'enregistrement à travers une chaîne d'effets dans un contexte audio
// « hors-ligne ». Hors-ligne veut dire plus vite que le temps réel — un message
// de dix secondes se rend en une fraction de seconde — ce qui permet d'essayer
// les effets les uns après les autres sans jamais attendre.
//
// Deux conséquences assumées :
//
//   1. LE RÉSULTAT REPART EN WAV. Un navigateur sait décoder à peu près tout,
//      mais ne sait ré-encoder en opus/aac que via `MediaRecorder`, qui
//      travaille en temps réel — il faudrait donc attendre dix secondes pour
//      un message de dix secondes. Le WAV est brut, donc gros : on le rend
//      MONO à 16 kHz, largement suffisant pour une voix (c'est mieux que le
//      téléphone) et ça tient dans la limite d'envoi même pour un long
//      message.
//
//   2. SANS EFFET, ON NE TOUCHE À RIEN. Le fichier d'origine part tel quel,
//      dans son format compressé et sa qualité d'origine. On ne paie le WAV
//      que si on a demandé un effet.
//
// LES EFFETS EUX-MÊMES : deux jouent sur la VITESSE DE LECTURE, ce qui monte ou
// descend la hauteur de la voix en même temps que le débit. C'est exactement le
// « canard » et le « monstre » que tout le monde connaît (et que les dessins
// animés font depuis toujours en accélérant la bande). Décaler la hauteur SANS
// toucher au débit demanderait un vocodeur de phase — beaucoup de code pour un
// résultat moins drôle. Les deux autres ne touchent ni à la durée ni au débit :
// le ROBOT module l'amplitude par un oscillateur grave, le MÉGAPHONE sature le
// signal et le passe dans la bande étroite d'un porte-voix.

export const VOICE_EFFECTS = [
  { id: "none", label: "Normal", icon: "mic", hint: "Ta voix, telle quelle" },
  { id: "duck", label: "Canard", icon: "bird", rate: 1.55, hint: "Aiguë et pressée" },
  { id: "deep", label: "Monstre", icon: "ghost", rate: 0.72, hint: "Grave et lente" },
  { id: "robot", label: "Robot", icon: "bot", rate: 1, hint: "Métallique" },
  // Le dernier ne change ni la hauteur ni le débit : il SATURE. C'est la voix
  // qui force, celle du haut-parleur poussé trop loin — l'effet qu'on attend
  // quand on crie un cri de jeu vidéo, et le seul du lot qui rende une imitation
  // plus impressionnante au lieu de la déguiser.
  { id: "mega", label: "Mégaphone", icon: "mega", rate: 1, hint: "Saturée, poussée à fond" },
];

// Une voix reste parfaitement intelligible à 16 kHz — et un message de cinq
// minutes tient sous la limite d'envoi.
const FX_RATE = 16000;

// La courbe de saturation du mégaphone, échantillonnée une fois : un
// `WaveShaper` veut une table, pas une formule. tanh comprime en douceur —
// linéaire au centre, de plus en plus plate vers les bords, sans le coude franc
// d'un écrêtage.
let softCurve = null;
function softClipCurve(points = 1024) {
  if (softCurve) return softCurve;
  softCurve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = (i / (points - 1)) * 2 - 1;
    softCurve[i] = Math.tanh(x * 2.2);
  }
  return softCurve;
}

function ctxClass() {
  return typeof window !== "undefined"
    ? window.AudioContext || window.webkitAudioContext
    : null;
}

export function canApplyEffects() {
  return !!ctxClass() && typeof OfflineAudioContext !== "undefined";
}

// Encode un buffer audio en WAV mono 16 bits. Une quarantaine d'octets d'en-tête
// puis les échantillons : c'est le seul format qu'on peut écrire soi-même sans
// embarquer d'encodeur.
function toWav(buffer) {
  const pcm = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(bytes);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true); // taille du bloc de format
  view.setUint16(20, 1, true); // PCM non compressé
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true); // octets par seconde
  view.setUint16(32, 2, true); // octets par échantillon
  view.setUint16(34, 16, true); // bits par échantillon
  str(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    // Bornage avant conversion : un dépassement se replierait en craquement.
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

// La silhouette du morceau GARDÉ. Rogner sans elle enverrait le dessin du
// message entier avec un audio raccourci : la bulle montrerait des barres qui
// ne correspondent à rien de ce qu'on entend.
export function sliceWaveform(waveform, start, end, points = 48) {
  if (!waveform?.length) return [];
  const from = Math.max(0, Math.floor(start * waveform.length));
  const to = Math.max(from + 1, Math.ceil(end * waveform.length));
  const cut = waveform.slice(from, to);
  if (cut.length <= 1) return cut;
  // On réétire la portion sur toute la largeur de la bulle : elle occupera le
  // même espace, quel que soit ce qu'on a coupé.
  const out = [];
  for (let i = 0; i < points; i += 1) {
    out.push(cut[Math.min(cut.length - 1, Math.floor((i / points) * cut.length))]);
  }
  return out;
}

// Coupe le silence de fin. On rend volontairement un peu PLUS long que le
// calcul théorique (voir `TAIL_PAD`) : c'est ce qui répare la dernière seconde
// perdue sur les effets ralentis, où la longueur exacte tombait court d'un
// cheveu — la queue de la voix se faisait raboter. Le rendu généreux ne coûte
// rien puisqu'on retaille ici, à l'échantillon près, sur du VRAI silence.
function trimTail(buffer) {
  const pcm = buffer.getChannelData(0);
  const floor = 0.0025; // sous ce niveau, c'est du silence
  let end = pcm.length;
  while (end > 1 && Math.abs(pcm[end - 1]) < floor) end -= 1;
  // Un souffle de fin plutôt qu'une coupe nette au dernier échantillon.
  return Math.min(pcm.length, end + Math.round(buffer.sampleRate * 0.05));
}

// Marge de rendu, en secondes. Généreuse : elle n'apparaît jamais dans le
// résultat (on retaille juste après) et elle absorbe tout écart d'arrondi
// entre la durée annoncée du buffer et ce qu'il faut vraiment de place.
const TAIL_PAD = 0.6;

// Rend l'enregistrement avec un effet et/ou un rognage.
//
// `start` / `end` sont des FRACTIONS du message (0..1) : elles survivent au
// changement d'effet, qui modifie la durée. Renvoie `null` pour « rien à
// changer » (aucun effet, aucun rognage, ou navigateur incapable) — l'appelant
// garde alors le fichier d'origine, intact et compressé.
export async function renderVoice(blob, { effectId = "none", start = 0, end = 1 } = {}) {
  const fx = VOICE_EFFECTS.find((e) => e.id === effectId) || VOICE_EFFECTS[0];
  const trimmed = start > 0.001 || end < 0.999;
  if ((fx.id === "none" && !trimmed) || !canApplyEffects()) return null;

  const Ctx = ctxClass();
  let decoded;
  {
    const tmp = new Ctx();
    try {
      decoded = await tmp.decodeAudioData(await blob.arrayBuffer());
    } finally {
      tmp.close();
    }
  }

  const rate = fx.rate || 1;
  // Le rognage se pense dans le temps QU'ON ENTEND ; la source, elle, se lit
  // dans son propre temps — d'où la conversion par le facteur de vitesse.
  const from = Math.max(0, start) * decoded.duration;
  const span = Math.max(0.05, (Math.min(1, end) - Math.max(0, start))) * decoded.duration;
  const outSec = span / rate;

  const length = Math.max(1, Math.ceil((outSec + TAIL_PAD) * FX_RATE));
  const ctx = new OfflineAudioContext(1, length, FX_RATE);

  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.playbackRate.value = rate;

  if (fx.id === "mega") {
    // Saturation douce (tangente hyperbolique) : au-delà d'un certain niveau, le
    // signal cesse de monter et se déforme au lieu d'écrêter carré. Un simple
    // gain élevé ne donnerait rien — la lecture ramène tout à l'échelle — et un
    // écrêtage dur donnerait du bruit blanc, pas une voix qui force.
    const drive = ctx.createGain();
    drive.gain.value = 4;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "4x"; // sans quoi la distorsion replie des aigus faux
    // La bande d'un haut-parleur de mégaphone : rien sous 300 Hz (le corps de la
    // voix disparaît, c'est ce qui fait « porte-voix ») et rien au-dessus de
    // 3,5 kHz (la saturation y est agressive).
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 320;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3500;
    // La saturation remonte le niveau moyen : on redescend pour ne pas rendre un
    // fichier qui sature à la lecture par-dessus.
    const out = ctx.createGain();
    out.gain.value = 0.55;
    src.connect(drive);
    drive.connect(shaper);
    shaper.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    out.connect(ctx.destination);
  } else if (fx.id === "robot") {
    // Modulation en anneau : on multiplie le signal par un oscillateur grave.
    // Le gain part de 0 et c'est l'oscillateur (qui va de -1 à +1) qui le pilote
    // — d'où une multiplication, et non une simple addition de bourdon.
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    osc.connect(ring.gain);
    // La modulation divise le niveau perçu par deux : on le rattrape.
    const makeup = ctx.createGain();
    makeup.gain.value = 1.9;
    src.connect(ring);
    ring.connect(makeup);
    makeup.connect(ctx.destination);
    osc.start();
  } else {
    // Les voix accélérées deviennent sifflantes : un filtre passe-bas doux
    // rabote les aigus les plus agressifs sans rien enlever à la blague.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = rate > 1 ? 5200 : 7000;
    src.connect(tone);
    tone.connect(ctx.destination);
  }

  // La portion à lire, dans le temps de la source.
  src.start(0, from, span);
  const rendered = await ctx.startRendering();

  // On retire la marge de rendu (et le silence de fin qui traînait déjà).
  const frames = trimTail(rendered);
  const out =
    frames >= rendered.length
      ? rendered
      : (() => {
          const cut = new AudioBuffer({
            length: frames,
            numberOfChannels: 1,
            sampleRate: rendered.sampleRate,
          });
          cut.copyToChannel(rendered.getChannelData(0).subarray(0, frames), 0);
          return cut;
        })();

  return { blob: toWav(out), duration: out.duration, mimeType: "audio/wav" };
}
