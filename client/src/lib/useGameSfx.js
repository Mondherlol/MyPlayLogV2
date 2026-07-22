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
        default:
          break;
      }
    },
    [tone]
  );

  const setMuted = useCallback((v) => {
    mutedRef.current = v;
  }, []);
  const setLevel = useCallback((v) => {
    levelRef.current = v;
  }, []);

  return { resume, play, setMuted, setLevel };
}
