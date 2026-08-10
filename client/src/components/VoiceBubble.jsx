import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2 } from "lucide-react";

// ======================================================================
//  La bulle d'un message vocal
// ======================================================================
// UN VOCAL NE S'ÉCOUTE PAS COMME UNE CHANSON. On veut savoir en un coup d'œil
// combien de temps ça dure, pouvoir revenir deux secondes en arrière sur un mot
// mal compris, et accélérer quelqu'un qui parle lentement. Trois choses, donc,
// et rien d'autre : lire/pause, une silhouette où l'on peut poser le doigt, et
// une vitesse.
//
// UN SEUL VOCAL À LA FOIS DANS TOUTE LA PAGE. Deux personnes qui parlent en même
// temps, c'est du bruit : ouvrir une lecture coupe l'autre. Le registre est un
// simple ensemble de fonctions d'arrêt, partagé par le module — pas un contexte
// React, parce qu'aucun rendu ne dépend de cette information.
const stoppers = new Set();
function claimPlayback(stop) {
  for (const other of stoppers) if (other !== stop) other();
  stoppers.add(stop);
}

// Vitesses proposées, dans l'ordre du cycle. 1× d'abord : c'est le réglage par
// défaut et celui vers lequel on revient.
const SPEEDS = [1, 1.5, 2];

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Silhouette de repli quand l'enregistreur n'a rien mesuré (vieux message, ou
// navigateur sans analyseur) : une ondulation neutre vaut mieux qu'un trait
// plat, qui donnerait l'impression d'un fichier vide.
const FALLBACK = Array.from({ length: 32 }, (_, i) => 22 + Math.round(18 * Math.sin(i)));

// Place minimale d'une barre : 2 px de trait + 3 px d'écart (l'écart monte à
// 3 px au doigt, cf. la feuille de style). En dessous, les barres ne peuvent
// plus rétrécir et la silhouette DÉBORDE de la bulle — c'est ce qui arrivait
// dans la fenêtre flottante et sur les écrans étroits, où la bulle est bien
// plus serrée que les 48 points enregistrés ne le supposent.
const BAR_SLOT = 5;

// Moins de place que de points : on regroupe par paquets et on garde le PIC de
// chaque paquet. Une moyenne raboterait justement les crêtes qui font qu'on
// reconnaît une phrase d'un silence.
function condense(src, slots) {
  const out = new Array(slots);
  for (let i = 0; i < slots; i++) {
    const from = Math.floor((i * src.length) / slots);
    const to = Math.max(from + 1, Math.floor(((i + 1) * src.length) / slots));
    let peak = 0;
    for (let j = from; j < to; j++) if (src[j] > peak) peak = src[j];
    out[i] = peak;
  }
  return out;
}

export default function VoiceBubble({ voice, mine }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [at, setAt] = useState(0); // position de lecture, en secondes
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  const audioRef = useRef(null);
  const barsRef = useRef(null);
  const draggingRef = useRef(false);

  // Nombre de barres que la bande peut réellement tenir, mesuré sur place : la
  // largeur d'une bulle varie (fil plein écran, fenêtre flottante, groupe avec
  // avatar), donc aucune valeur fixe ne convient.
  const [slots, setSlots] = useState(0);
  useEffect(() => {
    const el = barsRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setSlots(Math.max(8, Math.floor(w / BAR_SLOT)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const source = voice.waveform?.length ? voice.waveform : FALLBACK;
  const bars = useMemo(
    () => (slots && source.length > slots ? condense(source, slots) : source),
    [source, slots]
  );
  // La durée du modèle fait autorité tant que le fichier n'est pas chargé :
  // c'est ce qui permet d'afficher « 0:12 » sans télécharger un seul octet.
  const total = voice.duration || audioRef.current?.duration || 0;
  const progress = total > 0 ? Math.min(1, at / total) : 0;

  // L'élément n'est créé qu'AU PREMIER CLIC : un fil de trente vocaux ne doit
  // pas ouvrir trente connexions pour des messages que personne n'écoutera.
  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = "metadata";
    a.src = voice.url;
    a.playbackRate = speed;
    a.addEventListener("timeupdate", () => {
      if (!draggingRef.current) setAt(a.currentTime || 0);
    });
    a.addEventListener("waiting", () => setLoading(true));
    a.addEventListener("playing", () => setLoading(false));
    a.addEventListener("play", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("ended", () => {
      setPlaying(false);
      // On revient au début : réécouter est le geste suivant le plus fréquent.
      setAt(0);
      a.currentTime = 0;
    });
    a.addEventListener("error", () => {
      setFailed(true);
      setLoading(false);
      setPlaying(false);
    });
    audioRef.current = a;
    return a;
  }, [voice.url, speed]);

  // Démontage (on quitte le fil, on remonte l'historique) : le son s'arrête
  // avec la bulle, il ne continue pas dans le vide.
  //
  // `removeAttribute` plutôt que `src = ""` : une source vide se résout en
  // l'adresse de LA PAGE, que le navigateur tente alors de décoder comme de
  // l'audio — et émet une erreur pour rien.
  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.removeAttribute("src");
        try {
          a.load();
        } catch {
          /* ignore */
        }
      }
      audioRef.current = null;
    },
    []
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const a = ensureAudio();
    if (!a.paused) return a.pause();
    claimPlayback(stop); // les autres vocaux se taisent
    setLoading(true);
    a.play()
      .then(() => setLoading(false))
      .catch(() => {
        setLoading(false);
        setFailed(true);
      });
  }, [ensureAudio, stop]);

  useEffect(() => () => stoppers.delete(stop), [stop]);

  const cycleSpeed = useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  // --- Déplacement dans le message ---------------------------------------
  // On vise la BANDE, pas une poignée de quelques pixels : au doigt, une
  // poignée fine est intouchable. Poser le doigt n'importe où sur la
  // silhouette déplace la lecture là, et on peut glisser sans lâcher.
  const seekTo = useCallback(
    (clientX) => {
      const el = barsRef.current;
      const a = ensureAudio();
      if (!el || !total) return;
      const r = el.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const t = p * total;
      setAt(t);
      try {
        a.currentTime = t;
      } catch {
        /* le fichier n'est pas encore assez chargé pour se déplacer */
      }
    },
    [ensureAudio, total]
  );

  const onPointerDown = (e) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekTo(e.clientX);
  };
  const onPointerMove = (e) => {
    if (draggingRef.current) seekTo(e.clientX);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div className={`voice ${mine ? "mine" : ""} ${playing ? "on" : ""}`}>
      <button
        type="button"
        className="voice-play clickable"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Écouter le message vocal"}
        disabled={failed}
      >
        {loading ? (
          <Loader2 size={17} className="spin" />
        ) : playing ? (
          <Pause size={17} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play size={17} fill="currentColor" strokeWidth={0} />
        )}
      </button>

      <div className="voice-body">
        <div
          className="voice-bars"
          ref={barsRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="slider"
          tabIndex={0}
          aria-label="Position dans le message"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(at)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const a = ensureAudio();
            const t = Math.max(0, Math.min(total, at + (e.key === "ArrowRight" ? 5 : -5)));
            setAt(t);
            try {
              a.currentTime = t;
            } catch {
              /* ignore */
            }
          }}
        >
          {bars.map((h, i) => (
            <i
              key={i}
              className={i / bars.length < progress ? "done" : ""}
              // 3 px de haut minimum : une barre à zéro disparaîtrait et
              // troue la silhouette là où la personne a repris son souffle.
              style={{ height: `${Math.max(12, h)}%` }}
            />
          ))}
        </div>

        <div className="voice-meta">
          <span className="voice-time">
            {failed ? "Vocal indisponible" : fmt(playing || at > 0 ? at : total)}
          </span>
          {/* La vitesse n'apparaît qu'une fois la lecture lancée : avant, elle
              n'est qu'un bouton de plus à comprendre. */}
          {(playing || at > 0) && !failed && (
            <button
              type="button"
              className="voice-speed clickable"
              onClick={cycleSpeed}
              title="Vitesse de lecture"
            >
              {speed}×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
