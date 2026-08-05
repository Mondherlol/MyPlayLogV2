import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Loader2,
  Volume2,
  VolumeX,
  Music,
  Play,
  Pause,
  Check,
  Film,
} from "lucide-react";
import { API_BASE } from "../lib/api";

// ======================================================================
//  Mini éditeur vidéo (avant upload d'un post).
// ======================================================================
// Timeline multipiste façon Vegas/Resolve : rogner la vidéo, deux pistes audio
// (son d'origine + musique déplaçable/rognable), volumes. L'APERÇU est joué
// dans le navigateur (Web Audio) ; le RENDU final est fait CÔTÉ SERVEUR par
// ffmpeg (rapide, pas de réencodage temps réel) : on envoie la vidéo brute, la
// musique et les paramètres, le serveur renvoie l'URL du mp4 monté/compressé.

const MAX_CLIP = 60; // au-delà, l'export est bloqué (mais on laisse rogner)

const QUALITIES = {
  high: { label: "Haute", h: 720, vbr: 3000 },
  medium: { label: "Moyenne", h: 480, vbr: 1400 },
  low: { label: "Légère", h: 360, vbr: 700 },
};

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function fmtTime(s) {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

// Upload multipart avec progression (fetch ne sait pas suivre l'envoi).
function uploadRender(fd, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/game-media/render`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* réponse sans JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error || "Le montage a échoué."));
    };
    xhr.onerror = () => reject(new Error("Réseau indisponible."));
    xhr.send(fd);
  });
}

export default function VideoEditorModal({ file, token, onCancel, onDone, onRendered }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null); // { ctx, gainV, gainM, videoSource, musicNode }
  const musicBufRef = useRef(null); // AudioBuffer (aperçu)
  const musicFileRef = useRef(null); // File original (envoyé au serveur)
  const tlRef = useRef(null);
  const rafRef = useRef(0);

  const [srcUrl, setSrcUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [cur, setCur] = useState(0); // tête de lecture
  const [muteOriginal, setMuteOriginal] = useState(false);
  const [originalVol, setOriginalVol] = useState(1);
  const [musicVol, setMusicVol] = useState(0.8);
  const [music, setMusic] = useState(null); // { name, clipStart, clipEnd, inPoint }
  const [musicLoading, setMusicLoading] = useState(false);
  const [quality, setQuality] = useState("medium");

  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState(null); // null | "upload" | "render"
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const processing = phase !== null;
  const clip = Math.max(0, trimEnd - trimStart);
  const tooLong = clip > MAX_CLIP;
  const pct = (t) => (duration ? (t / duration) * 100 : 0);

  // URL blob (gérée par effet — StrictMode révoquerait un useRef).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Métadonnées.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      const d = v.duration || 0;
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(Math.min(d, MAX_CLIP));
      setCur(0);
    };
    v.addEventListener("loadedmetadata", onMeta);
    if (v.readyState >= 1 && v.duration) onMeta();
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [srcUrl]);

  // Échap = fermer. Espace = lecture/pause (sur le document : la modale n'a pas
  // de champ texte). togglePreview change à chaque rendu → on passe par un ref.
  const toggleRef = useRef(() => {});
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape" && !processing) onCancel();
      else if ((e.code === "Space" || e.key === " ") && !processing) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onCancel, processing]);
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      const a = audioRef.current;
      if (a) {
        try {
          a.musicNode?.stop();
          a.ctx.close();
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  // --- Graphe audio de l'APERÇU (créé une seule fois) ---
  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const gainV = ctx.createGain();
    const videoSource = ctx.createMediaElementSource(videoRef.current);
    videoSource.connect(gainV);
    gainV.connect(ctx.destination);
    const gainM = ctx.createGain();
    gainM.connect(ctx.destination);
    audioRef.current = { ctx, gainV, gainM, videoSource, musicNode: null };
    return audioRef.current;
  }, []);

  // Volumes appliqués en direct.
  useEffect(() => {
    const a = audioRef.current;
    if (a?.gainV) a.gainV.gain.value = muteOriginal ? 0 : originalVol;
  }, [muteOriginal, originalVol]);
  useEffect(() => {
    const a = audioRef.current;
    if (a?.gainM) a.gainM.gain.value = musicVol;
  }, [musicVol]);

  function applyGains(a) {
    a.gainV.gain.value = muteOriginal ? 0 : originalVol;
    a.gainM.gain.value = musicVol;
  }

  // Programme la musique selon sa position (clipStart) et son point d'entrée
  // (inPoint), via start(when, offset, duration).
  function scheduleMusic(a, playFrom) {
    stopMusic(a);
    if (!music || !musicBufRef.current) return;
    const { clipStart, clipEnd, inPoint } = music;
    if (playFrom >= clipEnd) return;
    const node = a.ctx.createBufferSource();
    node.buffer = musicBufRef.current;
    node.connect(a.gainM);
    const now = a.ctx.currentTime;
    if (clipStart >= playFrom) {
      node.start(now + (clipStart - playFrom), inPoint, clipEnd - clipStart);
    } else {
      node.start(now, inPoint + (playFrom - clipStart), clipEnd - playFrom);
    }
    a.musicNode = node;
  }
  function stopMusic(a) {
    try {
      a.musicNode?.stop();
    } catch {
      /* déjà arrêtée */
    }
    a.musicNode = null;
  }

  function seek(t) {
    const v = videoRef.current;
    const c = clamp(t, 0, duration || 0);
    if (v) v.currentTime = c;
    setCur(c);
  }

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current);
    videoRef.current?.pause();
    if (audioRef.current) stopMusic(audioRef.current);
    setPlaying(false);
  }

  // Lecture depuis la tête de lecture (si elle est dans la zone), sinon depuis
  // le début du clip — pause/play ne ramène plus au début.
  async function togglePreview() {
    if (playing) return stopPlayback();
    setError(null);
    const a = ensureAudio();
    applyGains(a);
    try {
      await a.ctx.resume();
    } catch {
      /* ignore */
    }
    const v = videoRef.current;
    const from = cur >= trimStart && cur < trimEnd - 0.05 ? cur : trimStart;
    v.currentTime = from;
    setCur(from);
    await v.play().catch(() => {});
    scheduleMusic(a, from);
    setPlaying(true);
    const tick = () => {
      setCur(v.currentTime);
      if (v.currentTime >= trimEnd || v.ended) {
        stopPlayback();
        seek(trimStart); // fin de clip : on se replace au début pour rejouer
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }
  toggleRef.current = togglePreview;

  async function onPickMusic(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setMusicLoading(true);
    try {
      const a = ensureAudio();
      const buf = await f.arrayBuffer();
      const audioBuf = await decodeAudio(a.ctx, buf);
      musicBufRef.current = audioBuf;
      musicFileRef.current = f;
      const len = Math.min(audioBuf.duration, Math.max(clip || audioBuf.duration, 0.5));
      const cs = trimStart;
      setMusic({
        name: f.name,
        clipStart: cs,
        clipEnd: Math.min(duration, cs + len),
        inPoint: 0,
      });
    } catch {
      setError("Impossible de lire ce fichier audio.");
    } finally {
      setMusicLoading(false);
    }
  }
  function removeMusic() {
    musicBufRef.current = null;
    musicFileRef.current = null;
    setMusic(null);
    if (audioRef.current) stopMusic(audioRef.current);
  }

  // Rendu CÔTÉ SERVEUR : envoi de la vidéo brute + musique + paramètres, ffmpeg
  // fait le montage et renvoie l'URL du mp4 final.
  async function exportClip() {
    if (processing || tooLong) return;
    stopPlayback();
    setError(null);
    setPhase("upload");
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append("video", file);
      if (music && musicFileRef.current) fd.append("music", musicFileRef.current);
      fd.append(
        "edit",
        JSON.stringify({
          start: trimStart,
          end: trimEnd,
          muteOriginal,
          originalVol,
          quality,
          music: music
            ? {
                clipStart: music.clipStart,
                clipEnd: music.clipEnd,
                inPoint: music.inPoint,
                vol: musicVol,
              }
            : null,
        })
      );
      const data = await uploadRender(fd, token, (p) => {
        setProgress(p);
        if (p >= 1) setPhase("render"); // envoi fini → ffmpeg travaille
      });
      onRendered(data.media);
    } catch (e) {
      setError(e.message || "Le montage a échoué.");
      setPhase(null);
    }
  }

  // --- Drag helpers (px → temps) ---
  function beginDrag(e, onMove) {
    e.preventDefault();
    e.stopPropagation();
    const w = tlRef.current?.clientWidth || 1;
    const startX = e.clientX;
    const move = (ev) => onMove(((ev.clientX - startX) / w) * duration);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function scrubTo(clientX) {
    const r = tlRef.current?.getBoundingClientRect();
    if (!r) return;
    seek(clamp(((clientX - r.left) / r.width) * duration, 0, duration));
  }
  function rulerDown(e) {
    e.preventDefault();
    if (playing) stopPlayback();
    scrubTo(e.clientX);
    const move = (ev) => scrubTo(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Trim
  const trimLeftDown = (e) => {
    const s0 = trimStart;
    beginDrag(e, (dt) => {
      const ns = clamp(s0 + dt, 0, trimEnd - 0.3);
      setTrimStart(ns);
      seek(ns);
    });
  };
  const trimRightDown = (e) => {
    const e0 = trimEnd;
    beginDrag(e, (dt) => {
      const ne = clamp(e0 + dt, trimStart + 0.3, duration);
      setTrimEnd(ne);
      seek(ne);
    });
  };

  // Musique
  const musicBodyDown = (e) => {
    if (!music) return;
    const cs0 = music.clipStart;
    const len = music.clipEnd - music.clipStart;
    beginDrag(e, (dt) => {
      const ns = clamp(cs0 + dt, 0, duration - len);
      setMusic((m) => ({ ...m, clipStart: ns, clipEnd: ns + len }));
    });
  };
  const musicLeftDown = (e) => {
    if (!music) return;
    const cs0 = music.clipStart;
    const ip0 = music.inPoint;
    const ce = music.clipEnd;
    const low = Math.max(0, cs0 - ip0); // ne pas révéler avant le début du son
    beginDrag(e, (dt) => {
      const ns = clamp(cs0 + dt, low, ce - 0.3);
      setMusic((m) => ({ ...m, clipStart: ns, inPoint: ip0 + (ns - cs0) }));
    });
  };
  const musicRightDown = (e) => {
    if (!music) return;
    const ce0 = music.clipEnd;
    const cs = music.clipStart;
    const ip = music.inPoint;
    const md = musicBufRef.current?.duration || 0;
    const maxEnd = Math.min(duration, cs + (md - ip));
    beginDrag(e, (dt) => {
      setMusic((m) => ({ ...m, clipEnd: clamp(ce0 + dt, cs + 0.3, maxEnd) }));
    });
  };

  const estMB = ((QUALITIES[quality].vbr + 128) * 1000 * clip) / 8 / 1e6;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !processing && onCancel()}>
      <div className="modal ve-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={() => !processing && onCancel()} aria-label="Fermer" disabled={processing}>
          <X size={20} />
        </button>
        <h2 className="modal-title">
          <Film size={18} /> Éditer la vidéo
        </h2>

        <div className="ve-body">
          <div className="ve-stage">
            <video ref={videoRef} src={srcUrl || undefined} className="ve-video" playsInline preload="metadata" />
            <button className="ve-playbtn clickable" onClick={togglePreview} aria-label="Aperçu (Espace)" title="Espace">
              {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
            </button>
          </div>

          {/* Timeline multipiste */}
          <div className="ve-tl">
            <div className="ve-gutter">
              <div className="ve-glabel ve-glabel-ruler">
                <span className={`ve-dur ${tooLong ? "over" : ""}`}>{fmtTime(clip)}</span>
              </div>
              <div className="ve-glabel">
                <Film size={13} /> Vidéo
              </div>
              <div className="ve-glabel">
                <button
                  className={`ve-mini ${muteOriginal ? "off" : ""}`}
                  onClick={() => setMuteOriginal((v) => !v)}
                  title={muteOriginal ? "Réactiver le son" : "Couper le son"}
                >
                  {muteOriginal ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
                Son d'origine
              </div>
              <div className="ve-glabel">
                {musicLoading ? <Loader2 size={13} className="spin" /> : <Music size={13} />} Musique
              </div>
            </div>

            <div className="ve-lanes" ref={tlRef}>
              <div className="ve-ruler" onPointerDown={rulerDown}>
                <div className="ve-ruler-cur" style={{ left: `${pct(cur)}%` }} />
              </div>

              {/* Piste vidéo (rognage) */}
              <div className="ve-lane">
                <div className="ve-clip ve-clip-video" style={{ left: `${pct(trimStart)}%`, width: `${pct(clip)}%` }}>
                  <span className="ve-handle left" onPointerDown={trimLeftDown} />
                  <span className="ve-clip-name">{fmtTime(trimStart)} → {fmtTime(trimEnd)}</span>
                  <span className="ve-handle right" onPointerDown={trimRightDown} />
                </div>
              </div>

              {/* Piste son d'origine (suit le rognage) */}
              <div className="ve-lane">
                <div
                  className={`ve-clip ve-clip-audio ${muteOriginal ? "muted" : ""}`}
                  style={{ left: `${pct(trimStart)}%`, width: `${pct(clip)}%` }}
                >
                  <span className="ve-wave" />
                </div>
              </div>

              {/* Piste musique (déplaçable + rognable) */}
              <div className="ve-lane">
                {music ? (
                  <div
                    className="ve-clip ve-clip-music"
                    style={{ left: `${pct(music.clipStart)}%`, width: `${pct(music.clipEnd - music.clipStart)}%` }}
                    onPointerDown={musicBodyDown}
                  >
                    <span className="ve-handle left" onPointerDown={musicLeftDown} />
                    <span className="ve-clip-name">
                      <Music size={11} /> {music.name}
                    </span>
                    <span className="ve-handle right" onPointerDown={musicRightDown} />
                  </div>
                ) : musicLoading ? (
                  <div className="ve-addmusic is-loading">
                    <Loader2 size={14} className="spin" /> Import de l'audio…
                  </div>
                ) : (
                  <label className="ve-addmusic clickable">
                    <Music size={14} /> Ajouter une piste audio
                    <input type="file" accept="audio/*" hidden onChange={onPickMusic} disabled={processing} />
                  </label>
                )}
              </div>

              <div className="ve-playhead" style={{ left: `${pct(cur)}%` }} />
            </div>
          </div>

          {/* Mixer (volumes) */}
          <div className="ve-mixer">
            <div className="ve-mix-row">
              <span className="ve-mix-name">
                {muteOriginal ? <VolumeX size={15} /> : <Volume2 size={15} />} Son d'origine
              </span>
              <input
                type="range"
                className="ve-vol"
                min={0}
                max={1}
                step={0.02}
                value={muteOriginal ? 0 : originalVol}
                style={{ "--val": `${Math.round((muteOriginal ? 0 : originalVol) * 100)}%` }}
                onChange={(e) => {
                  setOriginalVol(Number(e.target.value));
                  if (muteOriginal) setMuteOriginal(false);
                }}
                disabled={processing}
              />
            </div>
            {music && (
              <div className="ve-mix-row">
                <span className="ve-mix-name ve-mix-music">
                  <Music size={15} /> Musique
                </span>
                <input
                  type="range"
                  className="ve-vol music"
                  min={0}
                  max={1}
                  step={0.02}
                  value={musicVol}
                  style={{ "--val": `${Math.round(musicVol * 100)}%` }}
                  onChange={(e) => setMusicVol(Number(e.target.value))}
                  disabled={processing}
                />
                <button className="ve-mini danger" onClick={removeMusic} disabled={processing} title="Retirer la musique">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Qualité */}
          <div className="ve-section">
            <div className="ve-section-head">
              <span className="ve-label">Qualité (compression)</span>
              <span className="ve-times">~{estMB < 0.1 ? "0,1" : estMB.toFixed(1)} Mo</span>
            </div>
            <div className="ve-quality">
              {Object.entries(QUALITIES).map(([k, q]) => (
                <button key={k} className={`ve-q clickable ${quality === k ? "active" : ""}`} onClick={() => setQuality(k)} disabled={processing}>
                  {q.label}
                  <em>{q.h}p</em>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="ve-error">{error}</p>}
          {tooLong && !processing && (
            <p className="ve-error">Le clip dépasse 1 min ({fmtTime(clip)}) — raccourcis-le pour pouvoir publier.</p>
          )}

          {processing ? (
            <div className="ve-progress">
              <div className={`ve-progress-bar ${phase === "render" ? "indeterminate" : ""}`}>
                <span style={phase === "upload" ? { width: `${Math.round(progress * 100)}%` } : undefined} />
              </div>
              <span className="ve-progress-txt">
                <Loader2 size={14} className="spin" />
                {phase === "upload"
                  ? `Envoi de la vidéo… ${Math.round(progress * 100)}%`
                  : "Montage sur le serveur…"}
              </span>
            </div>
          ) : (
            <div className="ve-foot">
              <button className="btn btn-ghost" onClick={onCancel}>
                Annuler
              </button>
              <button className="btn btn-ghost-link" onClick={() => onDone(file)} title="Publier sans éditer">
                Publier tel quel
              </button>
              <button className="btn btn-primary" onClick={exportClip} disabled={clip < 0.3 || tooLong}>
                <Check size={16} /> Appliquer & publier
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
