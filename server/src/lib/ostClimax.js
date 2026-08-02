import fs from "node:fs";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import OstClimax from "../models/OstClimax.js";
import { download, fileFor } from "../routes/audio.js";

// ======================================================================
//  Trouver le climax d'une piste d'OST
// ======================================================================
// Voir l'en-tête de models/OstClimax.js pour le pourquoi. Ici, le comment.
//
// On demande à ffmpeg de mesurer le VOLUME PERÇU du morceau avec le filtre
// `ebur128`, qui écrit sur sa sortie d'erreur une ligne toutes les 100 ms :
//
//     [Parsed_ebur128_0 @ …] t: 12.3  TARGET:-23 LUFS  M:-18.4  S:-19.1  I: -21.0 …
//
// DEUX PIÈGES, tous deux vérifiés à la main sur un vrai fichier :
//   - ces lignes ne sortent QU'EN `-loglevel verbose`. Au niveau par défaut,
//     `framelog=verbose` ne suffit pas et la sortie est vide ;
//   - `TARGET:` s'intercale entre `t:` et `M:`, donc la lecture doit sauter
//     par-dessus au lieu d'attendre les deux collés.
//
// `M` (momentary) est le volume perçu sur les 400 dernières millisecondes. On
// récupère toute la courbe, puis on fait glisser une fenêtre de la longueur
// d'un extrait et on garde celle dont la moyenne est la plus forte.
//
// POURQUOI LE VOLUME PERÇU ET PAS L'AMPLITUDE BRUTE : une nappe de cordes
// grave peut avoir une amplitude énorme sans rien donner à entendre, alors que
// le thème principal joué aux cuivres ressort. `ebur128` pondère les fréquences
// comme l'oreille le fait (courbe K), donc il suit ce qu'on ENTEND — c'est
// exactement le critère qu'on cherche.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";

// Un morceau ne se juge pas sur ses premières ni ses dernières secondes : les
// OST commencent souvent par un silence ou une montée, et finissent en fondu.
// On exclut donc les bords de la recherche — sauf si le morceau est si court
// qu'il n'en resterait rien.
const EDGE_HEAD = 8; // secondes ignorées au début
const EDGE_TAIL = 5; // secondes ignorées à la fin

// Au-delà, on considère que ffmpeg est parti en vrille (fichier corrompu, flux
// interminable) et on abandonne : l'analyse est un bonus, jamais un blocage.
const ANALYZE_TIMEOUT_MS = 120000;

// Analyses simultanées. Chaque analyse = un téléchargement yt-dlp + un décodage
// complet ; en lancer dix à la fois saturerait la bande passante du VPS et
// ferait ramer la lecture du mini-lecteur, qui partage le même cache.
const MAX_PARALLEL = 2;
let running = 0;
const waiting = [];

function slot() {
  if (running < MAX_PARALLEL) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  running -= 1;
  const next = waiting.shift();
  if (next) {
    running += 1;
    next();
  }
}

// Relève la courbe de volume perçu, en [{ t, m }] toutes les ~100 ms.
function loudnessCurve(file) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      [
        "-hide_banner",
        "-nostats",
        // Indispensable : sans lui, ebur128 ne relève rien (cf. l'en-tête).
        "-loglevel",
        "verbose",
        "-i",
        file,
        "-af",
        "ebur128=framelog=verbose",
        "-f",
        "null",
        "-",
      ],
      { timeout: ANALYZE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        // ffmpeg écrit ses mesures SUR STDERR et sort en 0 : une erreur ici est
        // une vraie erreur, mais on tente quand même de lire ce qui est arrivé.
        const text = String(stderr || "");
        const points = [];
        const re = /t:\s*([\d.]+)[^\n]*?M:\s*(-?[\d.]+|-inf)/g;
        let m;
        while ((m = re.exec(text))) {
          const t = Number(m[1]);
          // Un silence numérique sort en « -inf » ou en « -120.7 » selon les
          // versions : on le plancherise plutôt que de le jeter, sinon un
          // morceau qui commence par du silence verrait sa courbe décalée dans
          // le temps — et donc son climax situé au mauvais endroit.
          const v = m[2] === "-inf" ? -70 : Math.max(-70, Number(m[2]));
          if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, m: v });
        }
        if (!points.length)
          return reject(new Error(err ? String(err.message).slice(0, 200) : "aucune mesure"));
        resolve(points);
      }
    );
  });
}

// La fenêtre de `clipSec` secondes dont le volume perçu moyen est le plus haut.
// Somme glissante : la courbe fait quelques milliers de points, autant ne pas
// la reparcourir à chaque position.
function bestWindow(points, clipSec) {
  const total = points[points.length - 1].t;
  if (total <= clipSec) return { start: 0, peak: null, mean: null };

  const mean = points.reduce((s, p) => s + p.m, 0) / points.length;

  // Bornes de recherche : on écarte l'intro et la fin, sauf si le morceau est
  // trop court pour se le permettre.
  let lo = 0;
  let hi = Math.max(0, total - clipSec);
  if (hi > EDGE_HEAD + EDGE_TAIL + clipSec) {
    lo = EDGE_HEAD;
    hi = total - clipSec - EDGE_TAIL;
  }

  const step = points.length > 1 ? total / points.length : 0.1;
  const win = Math.max(1, Math.round(clipSec / step));

  let sum = 0;
  for (let i = 0; i < win && i < points.length; i += 1) sum += points[i].m;

  let best = -Infinity;
  let bestStart = lo;
  for (let i = 0; i + win < points.length; i += 1) {
    if (i > 0) sum += points[i + win - 1].m - points[i - 1].m;
    const t = points[i].t;
    if (t < lo || t > hi) continue;
    const avg = sum / win;
    if (avg > best) {
      best = avg;
      bestStart = t;
    }
  }
  if (!Number.isFinite(best)) return { start: lo, peak: null, mean };
  return { start: bestStart, peak: best, mean };
}

// Analyse une piste et retient le résultat. Idempotent : si l'analyse existe
// déjà (réussie OU ratée), on ne recommence pas.
export async function analyzeClimax(videoId, clipSec = 15, { force = false } = {}) {
  if (!/^[\w-]{11}$/.test(String(videoId || ""))) return null;
  const existing = await OstClimax.findOne({ videoId }).lean();
  if (existing && !force) return existing;

  await slot();
  try {
    const file = fileFor(videoId);
    if (!fs.existsSync(file)) await download(videoId);
    const points = await loudnessCurve(file);
    const duration = points[points.length - 1].t;
    const { start, peak, mean } = bestWindow(points, clipSec);
    const doc = {
      durationSec: Math.round(duration),
      startSec: Math.round(start * 10) / 10,
      peakLufs: peak != null ? Math.round(peak * 10) / 10 : null,
      meanLufs: mean != null ? Math.round(mean * 10) / 10 : null,
      ok: true,
      error: null,
      analyzedAt: new Date(),
    };
    await OstClimax.updateOne({ videoId }, { $set: doc }, { upsert: true });
    return { videoId, ...doc };
  } catch (err) {
    const doc = {
      ok: false,
      error: String(err?.message || err).slice(0, 300),
      analyzedAt: new Date(),
    };
    await OstClimax.updateOne({ videoId }, { $set: doc }, { upsert: true }).catch(() => {});
    return { videoId, ...doc };
  } finally {
    release();
  }
}

// Les climax déjà connus pour un lot de pistes. Map(videoId → doc).
export async function climaxFor(videoIds) {
  const ids = [...new Set(videoIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await OstClimax.find({ videoId: { $in: ids }, ok: true })
    .select("videoId startSec durationSec")
    .lean()
    .catch(() => []);
  return new Map(rows.map((r) => [r.videoId, r]));
}

// Met en file l'analyse des pistes qu'on ne connaît pas encore, SANS attendre.
// Appelé au montage d'une partie : la partie en cours n'en profite pas, les
// suivantes oui. Comme le blind test ne pioche que dans les trois pistes les
// plus écoutées de chaque jeu, l'ensemble à analyser est petit et se remplit
// vite — c'est ce qui rend cette approche paresseuse viable.
export function warmClimax(videoIds, clipSec = 15) {
  (async () => {
    const ids = [...new Set(videoIds)].filter(Boolean);
    if (!ids.length) return;
    const known = await OstClimax.find({ videoId: { $in: ids } })
      .select("videoId")
      .lean()
      .catch(() => []);
    const seen = new Set(known.map((k) => k.videoId));
    for (const id of ids) {
      if (seen.has(id)) continue;
      // eslint-disable-next-line no-await-in-loop
      await analyzeClimax(id, clipSec).catch(() => {});
    }
  })().catch(() => {});
}
