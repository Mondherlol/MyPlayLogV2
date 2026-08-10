import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Scissors, X } from "lucide-react";

// ======================================================================
//  Le rogneur d'extrait
// ======================================================================
// Un joueur qui veut déposer le cri de Yoshi arrive avec un fichier de trois
// minutes. Lui répondre « cinq secondes maximum » et le renvoyer chercher
// Audacity, c'est perdre neuf déposants sur dix — la contrainte de durée n'a de
// sens que si l'outil pour la respecter est DANS l'écran d'envoi.
//
// ------------------------------------------------------- pourquoi côté client
// Le découpage se fait dans le navigateur, et le fichier envoyé est déjà le
// bon. Deux raisons :
//   - on téléverse cinq secondes au lieu de trois minutes ;
//   - surtout, on voit ce qu'on coupe. Un rognage serveur devrait deviner
//     quelles cinq secondes garder — c'est exactement la décision qu'on ne peut
//     pas prendre à la place du joueur.
// Le serveur revérifie la durée à l'arrivée (routes/perroquetSounds.js) : un
// client peut mentir, et la borne est une règle de jeu, pas une politesse.
//
// ------------------------------------------------------------------ le format
// On réencode en WAV 16 bits mono, à la main. C'est le seul format qu'on sache
// écrire sans embarquer d'encodeur : MediaRecorder ne sait pas réencoder un
// AudioBuffer, et un ffmpeg-wasm pèse plus lourd que tout le reste de la page.
// Cinq secondes de PCM font ~150 Ko une fois en mono à 22 kHz — c'est moins que
// la jaquette affichée à côté.

const MIN_SEC = 0.25;

export default function AudioTrimmer({ file, maxSeconds = 5, onCancel, onConfirm }) {
  const [buffer, setBuffer] = useState(null);
  const [peaks, setPeaks] = useState(null);
  const [range, setRange] = useState({ start: 0, end: maxSeconds });
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(null); // position de lecture, en secondes
  const [busy, setBusy] = useState(false);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);   // AudioContext, partagé lecture + décodage
  const srcRef = useRef(null);   // la source en cours de lecture
  const rafRef = useRef(0);
  const dragRef = useRef(null);  // { mode, grabSec }

  // ---------- Décodage ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error("no-audio");
        const ctx = new Ctx();
        ctxRef.current = ctx;
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        if (!alive) return;
        setBuffer(buf);
        setPeaks(computePeaks(buf));
        // La sélection de départ commence au PREMIER SON, pas à zéro : les
        // fichiers arrachés d'une vidéo ont presque toujours une demi-seconde
        // de blanc devant, et cadrer dessus par défaut ferait déposer des
        // extraits qui commencent par du vide.
        const from = firstOnset(buf);
        setRange({
          start: from,
          end: Math.min(buf.duration, from + maxSeconds),
        });
      } catch (e) {
        if (!alive) return;
        setErr(
          e.message === "no-audio"
            ? "Ce navigateur ne sait pas lire l'audio."
            : "Fichier illisible : essaie un mp3, un wav ou un m4a."
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, maxSeconds]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      try {
        srcRef.current?.stop();
      } catch {
        /* déjà arrêtée */
      }
      ctxRef.current?.close().catch(() => {});
    },
    []
  );

  // ---------- Dessin ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !buffer) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }
    const g = canvas.getContext("2d");
    const w = rect.width;
    const h = rect.height;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const x = (sec) => (sec / buffer.duration) * w;
    const mid = h / 2;

    // La forme d'onde entière, en gris : ce qui sera coupé reste visible, sinon
    // on ne sait pas ce qu'on laisse de côté.
    const bars = peaks.length;
    for (let i = 0; i < bars; i += 1) {
      const px = (i / bars) * w;
      const inSel =
        px >= x(range.start) - 0.5 && px <= x(range.end) + 0.5;
      const amp = Math.max(1, peaks[i] * (h / 2) * 0.94);
      g.fillStyle = inSel
        ? "rgba(240, 185, 60, 0.95)"
        : "rgba(255, 255, 255, 0.16)";
      g.fillRect(px, mid - amp, Math.max(1, w / bars - 0.5), amp * 2);
    }

    // Le voile sur les parties écartées.
    g.fillStyle = "rgba(6, 8, 14, 0.45)";
    g.fillRect(0, 0, x(range.start), h);
    g.fillRect(x(range.end), 0, w - x(range.end), h);

    // La tête de lecture.
    if (cursor != null) {
      g.fillStyle = "#fff";
      g.fillRect(x(cursor), 0, 1.5, h);
    }
  }, [peaks, buffer, range, cursor]);

  useLayoutEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // ---------- Les poignées ----------
  // Tout se joue au pointeur, sur la piste elle-même : poignée gauche, poignée
  // droite, et la sélection entière qu'on fait glisser. Des champs « début » et
  // « fin » en secondes seraient plus simples à écrire et infiniment plus
  // pénibles à utiliser — on cherche un cri à l'oreille, pas un horodatage.
  const secAt = useCallback(
    (clientX) => {
      const rect = wrapRef.current.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return p * (buffer?.duration || 0);
    },
    [buffer]
  );

  const onPointerDown = (mode) => (e) => {
    if (!buffer) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, grabSec: secAt(e.clientX) - range.start };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d || !buffer) return;
    const t = secAt(e.clientX);
    setRange((r) => {
      const dur = buffer.duration;
      if (d.mode === "start") {
        const start = Math.min(Math.max(0, t), r.end - MIN_SEC);
        // La borne de durée se règle EN TIRANT : plutôt que de bloquer la
        // poignée, on pousse l'autre bout. Le geste ne se coince jamais.
        return { start, end: Math.min(r.end, start + maxSeconds) };
      }
      if (d.mode === "end") {
        const end = Math.max(Math.min(dur, t), r.start + MIN_SEC);
        return { start: Math.max(r.start, end - maxSeconds), end };
      }
      const len = r.end - r.start;
      const start = Math.min(Math.max(0, t - d.grabSec), dur - len);
      return { start, end: start + len };
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // ---------- Écoute de la sélection ----------
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    try {
      srcRef.current?.stop();
    } catch {
      /* déjà arrêtée */
    }
    srcRef.current = null;
    setPlaying(false);
    setCursor(null);
  }, []);

  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !buffer) return;
    stop();
    ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const len = range.end - range.start;
    src.start(0, range.start, len);
    srcRef.current = src;
    setPlaying(true);
    const t0 = ctx.currentTime;
    const tick = () => {
      const el = ctx.currentTime - t0;
      if (el >= len) {
        stop();
        return;
      }
      setCursor(range.start + el);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    src.onended = () => stop();
  }, [buffer, range, stop]);

  // ---------- Validation ----------
  async function confirm() {
    if (!buffer) return;
    setBusy(true);
    try {
      stop();
      const blob = encodeWav(buffer, range.start, range.end);
      await onConfirm(blob, range.end - range.start);
    } catch (e) {
      setErr(e.message || "Découpe impossible.");
    } finally {
      setBusy(false);
    }
  }

  const len = range.end - range.start;
  const pct = (sec) => `${(sec / (buffer?.duration || 1)) * 100}%`;

  return (
    <div className="pq-trim">
      {err ? (
        <p className="pq-err">{err}</p>
      ) : !buffer ? (
        <p className="pq-trim-load">
          <Loader2 size={16} className="spin" /> Lecture du fichier…
        </p>
      ) : (
        <>
          <p className="pq-trim-help">
            Fais glisser les poignées pour garder le passage à imiter.
            <b> {maxSeconds} secondes maximum.</b>
          </p>

          <div
            className="pq-trim-track"
            ref={wrapRef}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <canvas ref={canvasRef} className="pq-trim-wave" />
            <span
              className="pq-trim-sel"
              style={{ left: pct(range.start), width: pct(len) }}
              onPointerDown={onPointerDown("move")}
            />
            <span
              className="pq-trim-handle h-start"
              style={{ left: pct(range.start) }}
              onPointerDown={onPointerDown("start")}
              role="slider"
              aria-label="Début de l'extrait"
              aria-valuenow={Math.round(range.start * 10) / 10}
            />
            <span
              className="pq-trim-handle h-end"
              style={{ left: pct(range.end) }}
              onPointerDown={onPointerDown("end")}
              role="slider"
              aria-label="Fin de l'extrait"
              aria-valuenow={Math.round(range.end * 10) / 10}
            />
          </div>

          <div className="pq-trim-scale">
            <span>0 s</span>
            <span>{buffer.duration.toFixed(1)} s</span>
          </div>

          <div className="pq-trim-actions">
            <button
              className="pq-trim-play clickable"
              onClick={playing ? stop : play}
              type="button"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
              {playing ? "Stop" : "Écouter la sélection"}
            </button>
            <span className={`pq-trim-len ${len > maxSeconds + 0.01 ? "over" : ""}`}>
              {len.toFixed(2)} s
            </span>
            <button className="pq-trim-cancel clickable" onClick={onCancel} type="button">
              <X size={15} /> Annuler
            </button>
            <button
              className="pq-trim-ok clickable"
              onClick={confirm}
              disabled={busy || len < MIN_SEC}
              type="button"
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Scissors size={15} />}
              Garder cet extrait
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//  Mesures et encodage
// ============================================================

// Une amplitude par colonne d'affichage. On mixe les canaux : la forme d'onde
// sert à repérer un cri, la stéréo n'y ajoute rien.
function computePeaks(buffer, bars = 420) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) chans.push(buffer.getChannelData(c));
  const step = Math.max(1, Math.floor(buffer.length / bars));
  const out = new Float32Array(bars);
  let max = 0.0001;
  for (let i = 0; i < bars; i += 1) {
    const from = i * step;
    const to = Math.min(buffer.length, from + step);
    let peak = 0;
    for (let j = from; j < to; j += 1) {
      let v = 0;
      for (const ch of chans) v += Math.abs(ch[j]);
      v /= chans.length;
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  // Normalisé : un extrait enregistré bas afficherait sinon une ligne plate,
  // et on ne verrait pas où couper.
  for (let i = 0; i < bars; i += 1) out[i] /= max;
  return out;
}

// Le premier instant où ça sonne vraiment, pour cadrer la sélection de départ.
function firstOnset(buffer) {
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor(buffer.sampleRate * 0.01));
  let max = 0;
  for (let i = 0; i < data.length; i += win) max = Math.max(max, Math.abs(data[i]));
  const gate = max * 0.08;
  for (let i = 0; i < data.length; i += win) {
    if (Math.abs(data[i]) > gate) return Math.max(0, i / buffer.sampleRate - 0.05);
  }
  return 0;
}

// AudioBuffer → WAV mono 16 bits. Le taux d'échantillonnage est plafonné à
// 24 kHz : au-delà, on paie des octets pour des fréquences que ni la voix ni le
// barème (lib/soundContour.js travaille bien en dessous) n'exploitent.
function encodeWav(buffer, startSec, endSec) {
  const TARGET = Math.min(buffer.sampleRate, 24000);
  const ratio = buffer.sampleRate / TARGET;
  const from = Math.floor(startSec * buffer.sampleRate);
  const to = Math.min(buffer.length, Math.floor(endSec * buffer.sampleRate));
  const outLen = Math.max(1, Math.floor((to - from) / ratio));

  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c += 1) chans.push(buffer.getChannelData(c));

  const bytes = new ArrayBuffer(44 + outLen * 2);
  const view = new DataView(bytes);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + outLen * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, TARGET, true);
  view.setUint32(28, TARGET * 2, true); // octets par seconde
  view.setUint16(32, 2, true);          // alignement de bloc
  view.setUint16(34, 16, true);         // bits par échantillon
  str(36, "data");
  view.setUint32(40, outLen * 2, true);

  // Un fondu de 5 ms aux deux bouts : une coupe franche au milieu d'une onde
  // fait un « clac » que l'analyse de contour prend pour une attaque.
  const fade = Math.min(Math.floor(outLen / 8), Math.floor(TARGET * 0.005));
  for (let i = 0; i < outLen; i += 1) {
    const src = from + Math.floor(i * ratio);
    let v = 0;
    for (const ch of chans) v += ch[src] || 0;
    v /= chans.length;
    if (i < fade) v *= i / fade;
    else if (i > outLen - fade) v *= (outLen - i) / fade;
    const s = Math.max(-1, Math.min(1, v));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
