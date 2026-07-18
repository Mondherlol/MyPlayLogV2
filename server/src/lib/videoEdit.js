import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

// Chemin du binaire ffmpeg : en prod (Docker alpine) on utilise le ffmpeg
// système (FFMPEG_PATH=ffmpeg, cf. Dockerfile) ; en local, le binaire fourni
// par ffmpeg-static (Windows/Mac/Linux glibc).
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

const QUALITY = {
  high: { h: 720, vbr: 3000 },
  medium: { h: 480, vbr: 1400 },
  low: { h: 360, vbr: 700 },
};

const num = (v, d = 0) => {
  const n = Number(v);
  return isFinite(n) ? n : d;
};
const clampNum = (v, lo, hi, d) => Math.min(Math.max(num(v, d), lo), hi);

// Nettoie/borne les paramètres d'édition reçus du client.
export function sanitizeEdit(raw) {
  const start = Math.max(0, num(raw?.start, 0));
  let end = Math.max(start + 0.1, num(raw?.end, start + 1));
  if (end - start > 120) end = start + 120; // garde-fou serveur
  const quality = QUALITY[raw?.quality] ? raw.quality : "medium";
  const out = {
    start,
    end,
    muteOriginal: !!raw?.muteOriginal,
    originalVol: clampNum(raw?.originalVol, 0, 2, 1),
    quality,
    music: null,
  };
  if (raw?.music) {
    const clipStart = Math.max(0, num(raw.music.clipStart, 0));
    const clipEnd = Math.max(clipStart + 0.1, num(raw.music.clipEnd, clipStart + 1));
    out.music = {
      clipStart,
      clipEnd,
      inPoint: Math.max(0, num(raw.music.inPoint, 0)),
      vol: clampNum(raw.music.vol, 0, 2, 0.8),
    };
  }
  return out;
}

// La vidéo a-t-elle une piste audio ? (ffmpeg -i imprime les flux sur stderr)
function probeHasAudio(file) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, ["-hide_banner", "-i", file]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => resolve(/Stream #\d+:\d+.*: Audio:/.test(err)));
    p.on("error", () => resolve(false));
  });
}

function buildArgs(edit, { videoPath, musicPath, hasAudio, outPath }) {
  const q = QUALITY[edit.quality] || QUALITY.medium;
  const dur = Math.max(0.1, edit.end - edit.start);

  // Entrée 0 : la vidéo, déjà rognée (-ss/-t avant -i = seek rapide).
  const args = ["-y", "-ss", String(edit.start), "-t", String(dur), "-i", videoPath];
  let idx = 1;
  let musicIdx = -1;
  if (musicPath) {
    args.push("-i", musicPath);
    musicIdx = idx++;
  }

  // Source audio « d'origine » : la vraie piste, ou un silence si la vidéo n'en a pas.
  const wantAudio = !!musicPath || !edit.muteOriginal;
  let origLabel = null;
  if (wantAudio) {
    if (hasAudio) origLabel = "0:a";
    else {
      args.push("-f", "lavfi", "-t", String(dur), "-i", "anullsrc=r=44100:cl=stereo");
      origLabel = `${idx++}:a`;
    }
  }

  const filters = [`[0:v]scale=-2:${q.h}:flags=bicubic,format=yuv420p[v]`];
  let aout = null;

  if (musicPath && edit.music) {
    const { clipStart, clipEnd, inPoint, vol } = edit.music;
    const oS = Math.max(clipStart, edit.start);
    const oE = Math.min(clipEnd, edit.end);
    const mDur = Math.max(0, oE - oS);
    if (mDur > 0.05) {
      const mSeek = inPoint + Math.max(0, edit.start - clipStart);
      const delayMs = Math.round(Math.max(0, clipStart - edit.start) * 1000);
      const oVol = edit.muteOriginal ? 0 : edit.originalVol;
      filters.push(`[${origLabel}]volume=${oVol}[o]`);
      filters.push(
        `[${musicIdx}:a]atrim=start=${mSeek}:duration=${mDur},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs},volume=${vol}[m]`
      );
      // duration=first → l'audio couvre toute la longueur du clip (silence hors musique).
      filters.push(`[o][m]amix=inputs=2:normalize=0:duration=first[aout]`);
      aout = "[aout]";
    } else if (!edit.muteOriginal && origLabel) {
      filters.push(`[${origLabel}]volume=${edit.originalVol}[aout]`);
      aout = "[aout]";
    }
  } else if (!edit.muteOriginal && origLabel) {
    filters.push(`[${origLabel}]volume=${edit.originalVol}[aout]`);
    aout = "[aout]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", "[v]");
  if (aout) args.push("-map", aout);
  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", `${q.vbr}k`,
    "-maxrate", `${Math.round(q.vbr * 1.5)}k`,
    "-bufsize", `${q.vbr * 2}k`,
    "-movflags", "+faststart"
  );
  if (aout) args.push("-c:a", "aac", "-b:a", "128k", "-ac", "2");
  else args.push("-an");
  args.push(outPath);
  return args;
}

function runFfmpeg(args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}: ${err.slice(-600)}`));
    });
  });
}

// Rend la vidéo éditée (rognage + volumes + musique positionnée) en mp4 compressé.
export async function renderEditedVideo({ videoPath, musicPath, edit, outPath }) {
  const hasAudio = await probeHasAudio(videoPath);
  const args = buildArgs(edit, { videoPath, musicPath, hasAudio, outPath });
  await runFfmpeg(args);
  return outPath;
}
