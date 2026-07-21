// ======================================================================
//  Bruitages courts, synthétisés à la volée (Web Audio) — aucun fichier.
// ======================================================================
// Pas de .mp3 à charger : les sons sont générés par oscillateurs, donc ils
// pèsent zéro octet, ne cassent jamais un déploiement et sonnent identiques
// hors ligne. Toujours déclenchés par un geste utilisateur (clic), ce qui
// satisfait les politiques d'autoplay des navigateurs.

const MUTE_KEY = "mpl_sfx_muted";

let ctx = null;

// L'AudioContext se crée paresseusement, au premier son : en créer un au
// chargement le laisse « suspended » et pollue la console.
function audio() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  // Revenu d'un onglet en arrière-plan : le contexte peut être suspendu.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function isSfxMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSfxMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// Une note : oscillateur + enveloppe douce (attaque courte, longue descente)
// pour éviter le « clic » d'un démarrage/arrêt brutal.
function note(ac, { freq, start, dur, gain = 0.16, type = "triangle" }) {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Récompense récupérée : petit arpège ascendant façon pièce ramassée, avec une
// quinte finale tenue pour la sensation de « ça y est, c'est à moi ».
export function playRewardSound() {
  if (isSfxMuted()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime + 0.01;
    // Mi5 → Sol#5 → Si5 → Mi6 (accord majeur qui monte)
    note(ac, { freq: 659.25, start: t, dur: 0.13 });
    note(ac, { freq: 830.61, start: t + 0.07, dur: 0.13 });
    note(ac, { freq: 987.77, start: t + 0.14, dur: 0.16 });
    note(ac, { freq: 1318.51, start: t + 0.22, dur: 0.42, gain: 0.13 });
    // Pointe de brillance très discrète, une octave au-dessus.
    note(ac, { freq: 2637.02, start: t + 0.22, dur: 0.3, gain: 0.035, type: "sine" });
  } catch {
    /* le son est un bonus : jamais bloquant */
  }
}
