import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

// ======================================================================
//  Le vocal qu'on vient d'enregistrer : écoute + rognage
// ======================================================================
// SÉPARÉ DE `VoiceBubble` À DESSEIN. La bulle du fil est en lecture seule et
// doit le rester — y greffer des poignées de découpe pour les cinq secondes qui
// précèdent l'envoi encombrerait tous les messages déjà envoyés.
//
// LE ROGNAGE SE PENSE EN FRACTIONS (0..1), jamais en secondes : changer d'effet
// change la durée du message (le canard parle plus vite), et des bornes en
// secondes se retrouveraient à côté de la plaque. En fractions, « je coupe le
// dernier quart » reste vrai quelle que soit la voix choisie.
//
// LES POIGNÉES SONT LARGES ET DÉBORDENT DE LA BANDE. C'est le seul moyen de les
// attraper au pouce ; une poignée dessinée à sa taille visuelle est intouchable.

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const FALLBACK = Array.from({ length: 40 }, (_, i) => 22 + Math.round(18 * Math.sin(i)));

// `trimming` : les poignées n'existent que quand on a demandé à rogner. Par
// défaut on ne fait qu'écouter — une barre couverte de poignées suggérerait
// qu'il FAUT découper son message avant de l'envoyer, alors que c'est l'affaire
// d'une fois sur dix.
export default function VoiceDraft({ url, duration, waveform, trim, onTrim, trimming }) {
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const audioRef = useRef(null);
  const barsRef = useRef(null);
  const dragRef = useRef(null); // "a" | "b" | "seek"

  const bars = waveform?.length ? waveform : FALLBACK;
  const { a, b } = trim;
  const kept = Math.max(0, (b - a) * duration);

  // Un seul élément pour toute la relecture : on ne le recrée pas à chaque
  // déplacement de poignée.
  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    el.src = url;
    audioRef.current = el;
    const onTime = () => setAt(el.currentTime || 0);
    const onEnd = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    return () => {
      el.pause();
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeAttribute("src");
      audioRef.current = null;
    };
  }, [url]);

  // La lecture reste DANS les bornes : elle démarre au début gardé et s'arrête
  // à la fin gardée. C'est ce qui permet d'entendre exactement le message qui
  // partira, sans avoir à le rendre à chaque déplacement de poignée.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !playing) return undefined;
    const stopAt = b * duration;
    const iv = setInterval(() => {
      if (el.currentTime >= stopAt) {
        el.pause();
        el.currentTime = a * duration;
        setAt(a * duration);
      }
    }, 60);
    return () => clearInterval(iv);
  }, [playing, a, b, duration]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    const from = a * duration;
    // Hors zone gardée (ou fini) : on repart du début de ce qu'on garde.
    if (el.currentTime < from || el.currentTime >= b * duration) el.currentTime = from;
    el.play().catch(() => {});
  }, [a, b, duration]);

  // --- Poignées ----------------------------------------------------------
  const fracAt = (clientX) => {
    const el = barsRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const onDown = (which) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = which;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (which === "seek") {
      const p = fracAt(e.clientX);
      const el = audioRef.current;
      const t = Math.min(Math.max(p, a), b) * duration;
      if (el) el.currentTime = t;
      setAt(t);
    }
  };

  const onMove = (e) => {
    const which = dragRef.current;
    if (!which) return;
    const p = fracAt(e.clientX);
    if (which === "a") {
      // On garde toujours au moins un demi-seconde de message.
      const min = 0.5 / Math.max(duration, 0.5);
      onTrim({ a: Math.min(p, b - min), b });
    } else if (which === "b") {
      const min = 0.5 / Math.max(duration, 0.5);
      onTrim({ a, b: Math.max(p, a + min) });
    } else {
      const el = audioRef.current;
      const t = Math.min(Math.max(p, a), b) * duration;
      if (el) el.currentTime = t;
      setAt(t);
    }
  };

  const onUp = () => {
    dragRef.current = null;
  };

  const progress = duration > 0 ? Math.min(1, at / duration) : 0;

  return (
    <div className="vdraft">
      <button
        type="button"
        className="voice-play clickable"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Écouter"}
      >
        {playing ? (
          <Pause size={17} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play size={17} fill="currentColor" strokeWidth={0} />
        )}
      </button>

      <div className="vdraft-body">
        <div
          className="vdraft-bars"
          ref={barsRef}
          onPointerDown={onDown("seek")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {bars.map((h, i) => {
            const at1 = i / bars.length;
            const out = trimming && (at1 < a || at1 >= b); // hors de ce qu'on garde
            return (
              <i
                key={i}
                className={`${out ? "out" : ""} ${!out && at1 < progress ? "done" : ""}`}
                style={{ height: `${Math.max(12, h)}%` }}
              />
            );
          })}

          {/* Les zones coupées sont grisées ET voilées : on voit d'un coup
              d'œil ce qui reste, sans avoir à comparer des couleurs de barres. */}
          {trimming && (
            <>
          <span className="vdraft-veil left" style={{ width: `${a * 100}%` }} />
          <span className="vdraft-veil right" style={{ width: `${(1 - b) * 100}%` }} />

          <span
            className="vdraft-grip left"
            style={{ left: `${a * 100}%` }}
            onPointerDown={onDown("a")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="slider"
            aria-label="Début du message"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(a * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onTrim({ a: Math.max(0, a - 0.02), b });
              if (e.key === "ArrowRight") onTrim({ a: Math.min(b - 0.05, a + 0.02), b });
            }}
          />
          <span
            className="vdraft-grip right"
            style={{ left: `${b * 100}%` }}
            onPointerDown={onDown("b")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="slider"
            aria-label="Fin du message"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(b * 100)}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onTrim({ a, b: Math.max(a + 0.05, b - 0.02) });
              if (e.key === "ArrowRight") onTrim({ a, b: Math.min(1, b + 0.02) });
            }}
          />
            </>
          )}
        </div>

        <div className="vdraft-meta">
          <span>{fmt(kept)}</span>
          {/* La durée retirée n'apparaît que si l'on a coupé : sinon c'est une
              information qui ne dit rien. */}
          {kept < duration - 0.15 && (
            <em className="vdraft-cut">−{fmt(duration - kept)} coupé</em>
          )}
        </div>
      </div>
    </div>
  );
}
