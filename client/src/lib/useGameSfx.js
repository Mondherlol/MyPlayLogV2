import { useCallback, useRef } from "react";

// --- Bruitages synthétisés (WebAudio, zéro asset externe) ---
// Partagés par les mini-jeux (blind test, Pixel Rush). `resume()` doit être
// appelé DANS un geste utilisateur (clic de lancement) : les navigateurs
// n'autorisent pas l'audio autrement.
export function useGameSfx() {
  const ctxRef = useRef(null);
  const mutedRef = useRef(false);
  const levelRef = useRef(1); // suit le slider de volume

  const resume = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    ctxRef.current?.resume?.();
  }, []);

  const tone = useCallback((freq, dur, type = "sine", gain = 0.14, when = 0) => {
    const ctx = ctxRef.current;
    if (!ctx || mutedRef.current) return;
    const g0 = Math.max(0.0001, gain * levelRef.current);
    if (g0 <= 0.0001) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(g0, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }, []);

  // Bruit blanc filtré : tout ce qui n'a pas de hauteur — un souffle, un
  // impact, une giclée. Le filtre balaie `from` → `to` pendant la durée, ce qui
  // suffit à faire entendre la différence entre un « fwoosh » (qui monte) et un
  // « splotch » (qui s'effondre vers les graves).
  const noise = useCallback((dur, opts = {}) => {
    const ctx = ctxRef.current;
    if (!ctx || mutedRef.current) return;
    const { gain = 0.12, from = 2400, to = 240, q = 1, when = 0, type = "lowpass" } = opts;
    const g0 = Math.max(0.0001, gain * levelRef.current);
    if (g0 <= 0.0001) return;
    const t0 = ctx.currentTime + when;
    const frames = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(from, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(g0, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }, []);

  const play = useCallback(
    (name) => {
      if (!ctxRef.current) return;
      switch (name) {
        case "start":
          tone(320, 0.12, "sawtooth", 0.06);
          tone(640, 0.16, "sine", 0.05, 0.05);
          break;
        case "tick":
          tone(880, 0.05, "square", 0.045);
          break;
        case "tick-hot":
          tone(1180, 0.06, "square", 0.06);
          break;
        case "hint":
          tone(740, 0.09, "triangle", 0.07);
          tone(1100, 0.12, "triangle", 0.06, 0.06);
          break;
        // Nouveau cliché débloqué : petit « bip » d'appareil photo.
        case "shot":
          tone(520, 0.06, "square", 0.05);
          tone(880, 0.08, "square", 0.045, 0.05);
          break;
        case "correct":
          [523, 659, 784, 1046].forEach((f, i) =>
            tone(f, 0.2, "triangle", 0.13, i * 0.07)
          );
          break;
        case "wrong":
          tone(196, 0.32, "sawtooth", 0.11);
          tone(146, 0.36, "sawtooth", 0.09, 0.05);
          break;
        case "finish":
          [523, 659, 784, 1046, 1318].forEach((f, i) =>
            tone(f, 0.3, "triangle", 0.13, i * 0.1)
          );
          break;

        // --- GeoGamer ---
        // Départ d'expédition : une montée franche, plus ample que le « start »
        // d'une simple manche — c'est le lancement de toute une partie.
        case "launch":
          [262, 392, 523, 784].forEach((f, i) =>
            tone(f, 0.26, "triangle", 0.1, i * 0.06)
          );
          tone(1046, 0.4, "sine", 0.06, 0.24);
          break;
        // Atterrissage : le panorama vient de s'afficher, on est arrivé.
        case "land":
          tone(180, 0.18, "sine", 0.09);
          tone(360, 0.22, "triangle", 0.06, 0.04);
          break;
        // Déploiement de la carte.
        case "map-open":
          tone(440, 0.1, "triangle", 0.07);
          tone(660, 0.13, "triangle", 0.06, 0.06);
          tone(880, 0.16, "sine", 0.05, 0.12);
          break;
        // Épingle posée : un « toc » sec et court, qu'on peut répéter sans
        // fatiguer l'oreille puisqu'on déplace souvent son épingle.
        case "pin":
          tone(700, 0.04, "square", 0.05);
          break;

        // --- Pixel Rush versus : les tomates ---
        // Le lancer, entendu par tout le monde : un souffle bref qui s'éloigne.
        // Il prépare l'impact — sans lui, la tomate arrive de nulle part.
        case "throw":
          noise(0.17, { from: 700, to: 3000, gain: 0.05, type: "bandpass", q: 0.7 });
          break;
        // L'impact. Trois couches, et il faut les trois : le CLAQUEMENT (bruit
        // aigu très court), la MATIÈRE qui s'écrase (le même bruit qui
        // s'effondre vers les graves sur un tiers de seconde), et le POIDS
        // (deux sinus très bas). Sans la couche grave ça fait « chhht » ; sans
        // la couche aiguë ça fait un coup de grosse caisse.
        case "splat":
          noise(0.08, { from: 5400, to: 800, gain: 0.17, type: "lowpass" });
          noise(0.34, { from: 1000, to: 110, gain: 0.1, type: "lowpass", when: 0.04 });
          tone(92, 0.22, "sine", 0.15);
          tone(56, 0.3, "sine", 0.1, 0.03);
          break;
        default:
          break;
      }
    },
    [tone, noise]
  );

  const setMuted = useCallback((v) => {
    mutedRef.current = v;
  }, []);
  const setLevel = useCallback((v) => {
    levelRef.current = v;
  }, []);

  return { resume, play, setMuted, setLevel };
}
