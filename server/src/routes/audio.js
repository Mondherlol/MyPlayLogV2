import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import ffmpegStatic from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Flux audio des OST pour le mini-lecteur (voir client/context/PlayerContext).
// Une iframe YouTube est coupée par le navigateur mobile dès qu'il passe en
// arrière-plan (lecture en arrière-plan = YouTube Premium). On extrait donc
// l'audio (m4a) via yt-dlp, mis en cache sur disque, et servi en vrai flux
// qu'un <audio> peut continuer à jouer écran éteint.
// Endpoints publics, comme /uploads : un videoId YouTube est une donnée publique.

const router = express.Router();

const CACHE_DIR = path.join(__dirname, "../../cache/audio");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
// Même résolution que lib/videoEdit.js : binaire système en Docker (alpine),
// ffmpeg-static en local. yt-dlp s'en sert pour convertir en m4a si besoin.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const MAX_CACHE_BYTES =
  Number(process.env.AUDIO_CACHE_MAX_MB || 500) * 1024 * 1024;

const VIDEO_ID = /^[\w-]{11}$/;

const fileFor = (id) => path.join(CACHE_DIR, `${id}.m4a`);

// Téléchargements en cours, dédupliqués par videoId (si deux clients demandent
// la même piste, un seul yt-dlp tourne et les deux attendent la même promesse).
const inflight = new Map();

function download(id) {
  if (inflight.has(id)) return inflight.get(id);
  const tmp = path.join(CACHE_DIR, `${id}.dl`);
  const p = new Promise((resolve, reject) => {
    const args = [
      // 140 = m4a 128k, dispo sur quasi toutes les vidéos → pas de conversion.
      "-f", "140/bestaudio[ext=m4a]/bestaudio",
      "-x", "--audio-format", "m4a",
      "--no-playlist", "--no-progress", "--no-warnings",
      "--ffmpeg-location", FFMPEG,
      "-o", `${tmp}.%(ext)s`,
      `https://www.youtube.com/watch?v=${id}`,
    ];
    execFile(YTDLP, args, { timeout: 180000 }, (err, _stdout, stderr) => {
      if (err) {
        cleanupTmp(id);
        return reject(
          new Error(String(stderr || err.message).trim().slice(0, 500))
        );
      }
      const out = `${tmp}.m4a`;
      try {
        fs.renameSync(out, fileFor(id));
      } catch {
        cleanupTmp(id);
        return reject(new Error("yt-dlp n'a pas produit de fichier m4a."));
      }
      pruneCache();
      resolve(fileFor(id));
    });
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

// Restes d'un téléchargement raté (fichier partiel, .part, ext inattendue…).
function cleanupTmp(id) {
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(`${id}.dl`)) {
        try {
          fs.unlinkSync(path.join(CACHE_DIR, f));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

// Purge LRU : au-delà de la limite, on supprime les pistes les moins récemment
// écoutées (mtime, rafraîchi à chaque lecture) jusqu'à repasser dessous.
function pruneCache() {
  try {
    const files = fs
      .readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith(".m4a"))
      .map((f) => {
        const st = fs.statSync(path.join(CACHE_DIR, f));
        return { f, size: st.size, mtime: st.mtimeMs };
      });
    let total = files.reduce((s, x) => s + x.size, 0);
    if (total <= MAX_CACHE_BYTES) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const x of files) {
      if (total <= MAX_CACHE_BYTES) break;
      try {
        fs.unlinkSync(path.join(CACHE_DIR, x.f));
        total -= x.size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

// GET /api/audio/:videoId — le flux m4a de la piste (extrait à la volée au
// premier passage, servi depuis le cache ensuite). res.sendFile gère les
// requêtes Range → seek possible, et lecture OK sur iOS.
router.get("/:videoId", async (req, res) => {
  const id = req.params.videoId;
  if (!VIDEO_ID.test(id))
    return res.status(400).json({ error: "videoId invalide." });
  try {
    const file = fileFor(id);
    if (fs.existsSync(file)) {
      // Marque la piste comme récemment écoutée (pour la purge LRU).
      fs.utimes(file, new Date(), new Date(), () => {});
    } else {
      await download(id);
    }
    res.sendFile(file, {
      headers: {
        "Content-Type": "audio/mp4",
        // Le contenu d'un videoId ne change jamais → cache navigateur long.
        "Cache-Control": "public, max-age=2592000, immutable",
      },
    });
  } catch (err) {
    console.error(`audio ${id}: extraction impossible —`, err.message);
    res.status(502).json({ error: "Extraction audio impossible." });
  }
});

// GET /api/audio/:videoId/prefetch — lance l'extraction en tâche de fond (le
// client préchauffe la piste suivante de la file pour un enchaînement sans trou).
router.get("/:videoId/prefetch", (req, res) => {
  const id = req.params.videoId;
  if (!VIDEO_ID.test(id))
    return res.status(400).json({ error: "videoId invalide." });
  if (!fs.existsSync(fileFor(id))) {
    download(id).catch((err) =>
      console.error(`audio ${id}: prefetch raté —`, err.message)
    );
  }
  res.status(202).json({ ok: true });
});

export default router;
