import express from "express";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ffmpegStatic from "ffmpeg-static";

import { requireAuth, requireAdmin } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ======================================================================
//  Flux audio des OST (mini-lecteur web + lecteur de l'appli mobile)
// ======================================================================
// Une iframe YouTube est coupée par le navigateur mobile dès qu'il passe en
// arrière-plan (lecture en arrière-plan = YouTube Premium). On sert donc l'audio
// (m4a) en vrai flux, qu'un <audio> / expo-audio peut continuer à jouer écran
// éteint. Endpoints publics, comme /uploads : un videoId YouTube est public.
//
// DEUX CHOSES ONT CHANGÉ ICI, et il faut comprendre pourquoi avant d'y toucher.
//
// 1. ON NE TÉLÉCHARGE PLUS AVANT DE RÉPONDRE.
//    L'ancienne version lançait `yt-dlp` et n'écrivait la réponse qu'une fois
//    le fichier ENTIER sur le disque : 10 à 30 s d'écran de chargement à la
//    première écoute d'une piste, et un lecteur mobile qui abandonne avant.
//    Maintenant on demande à yt-dlp la seule chose dont on a besoin — l'URL
//    directe du flux chez Google — et on relaie ce flux immédiatement, en
//    recopiant au passage les octets dans le cache (« tee »). La lecture part
//    en ~1 s, et la piste est en cache pour les fois suivantes malgré tout.
//
//    À NOTER : ces URLs googlevideo sont verrouillées sur l'IP qui les a
//    demandées (paramètre `ip=` dans l'URL). Impossible donc de rediriger le
//    client dessus : c'est bien le serveur qui doit relayer.
//
// 2. L'EXTRACTION SE RÉPARE TOUTE SEULE.
//    En prod l'extraction tombait en panne alors qu'elle marchait en local. Deux
//    causes, cumulables, toutes deux traitées ici :
//      - le binaire yt-dlp est figé dans une couche Docker (donc vieux de
//        plusieurs mois), et YouTube casse régulièrement les vieux extracteurs
//        -> en cas d'échec on tente un `yt-dlp -U` puis on rejoue UNE fois ;
//      - depuis une IP de datacenter, le client « web » de YouTube réclame un
//        PO token et répond « Sign in to confirm you're not a bot »
//        -> on demande explicitement des clients qui n'en ont pas besoin
//        (tv_simply, android_vr…), et on accepte des cookies en secours.

const router = express.Router();

const CACHE_DIR = path.join(__dirname, "../../cache/audio");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
// Même résolution que lib/videoEdit.js : binaire système en Docker (alpine),
// ffmpeg-static en local.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const MAX_CACHE_BYTES =
  Number(process.env.AUDIO_CACHE_MAX_MB || 500) * 1024 * 1024;

// Clients de lecture YouTube tentés dans l'ordre par yt-dlp. Volontairement
// surchargeable par .env : quand YouTube en casse un, on peut changer l'ordre
// depuis le panel Admin sans redéployer (juste un restart du conteneur).
const CLIENTS =
  process.env.YTDLP_CLIENTS || "default,tv_simply,android_vr,web_safari";
// Fichier cookies.txt facultatif (dernier recours si YouTube durcit encore).
const COOKIES = process.env.YTDLP_COOKIES || "";
// Proxy facultatif, même logique que pour l'API PSN : si l'IP du VPS finit par
// être bloquée pour de bon, on fait sortir yt-dlp ET le relais par ailleurs.
const YT_PROXY = process.env.YTDLP_PROXY || "";
// Générateur de PO token (service `potoken` du docker-compose). Sans lui,
// YouTube répond « Sign in to confirm you're not a bot » à une requête sur deux
// depuis l'IP du VPS — vérifié en prod, c'est LA panne d'origine.
const POT_URL = (process.env.POT_PROVIDER_URL || "").replace(/\/+$/, "");

// Le format 140 (m4a 128k) existe sur quasiment toutes les vidéos : pas de
// conversion, donc rien à ré-encoder, donc un flux qu'on peut relayer tel quel.
const FORMAT = "140/bestaudio[ext=m4a]/bestaudio";

// Un UA de navigateur : certains front googlevideo boudent les clients sans.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const VIDEO_ID = /^[\w-]{11}$/;

export const fileFor = (id) => path.join(CACHE_DIR, `${id}.m4a`);

// ----------------------------------------------------------------------
//  Appel de yt-dlp
// ----------------------------------------------------------------------

function baseArgs() {
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--extractor-args",
    `youtube:player_client=${CLIENTS}`,
    "--retries",
    "3",
    "--socket-timeout",
    "15",
  ];
  // Une clé d'extracteur par option : les cumuler dans un seul `--extractor-args`
  // écraserait la précédente.
  if (POT_URL)
    args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${POT_URL}`);
  if (COOKIES && fs.existsSync(COOKIES)) args.push("--cookies", COOKIES);
  if (YT_PROXY) args.push("--proxy", YT_PROXY);
  return args;
}

function run(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err)
          return reject(
            new Error(String(stderr || err.message).trim().slice(0, 800))
          );
        resolve(String(stdout));
      }
    );
  });
}

// Comme `run`, mais rend TOUT ce que yt-dlp a écrit, y compris quand il
// réussit. Réservé au diagnostic : c'est le seul moyen de lire les lignes
// `[debug]` du mode bavard, qui n'apparaissent que sur la sortie d'erreur.
function runVerbose(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(
      YTDLP,
      args,
      { timeout, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const all = `${stdout}\n${stderr}`;
        if (err && !all.includes("[pot]"))
          return reject(new Error(String(stderr || err.message).trim().slice(0, 500)));
        resolve(all);
      }
    );
  });
}

// Mise à jour du binaire, tentée au plus une fois par heure : c'est la panne la
// plus fréquente en prod (extracteur périmé) et la seule qu'on puisse réparer
// sans intervention humaine.
let lastSelfUpdate = 0;
let updating = null;
function selfUpdate() {
  if (process.env.YTDLP_AUTO_UPDATE === "0") return Promise.resolve(false);
  if (Date.now() - lastSelfUpdate < 3600000) return Promise.resolve(false);
  if (updating) return updating;
  lastSelfUpdate = Date.now();
  updating = run(["-U"], 120000)
    .then((out) => {
      console.log("audio: yt-dlp -U →", out.trim().split("\n").pop());
      return true;
    })
    .catch((err) => {
      console.error("audio: yt-dlp -U a échoué —", err.message);
      return false;
    })
    .finally(() => {
      updating = null;
    });
  return updating;
}

// Rejoue une commande yt-dlp après une tentative de mise à jour. Sans ce
// filet, une panne d'extracteur exige un rebuild Docker sans cache.
async function runWithRepair(args, timeout) {
  try {
    return await run(args, timeout);
  } catch (err) {
    const updated = await selfUpdate();
    if (!updated) throw err;
    return run(args, timeout);
  }
}

// ----------------------------------------------------------------------
//  Résolution de l'URL directe du flux
// ----------------------------------------------------------------------

// Les URLs googlevideo portent leur propre péremption (`expire=`, ~6 h). On les
// garde en mémoire jusque-là : la 2e écoute d'une piste non encore mise en
// cache démarre alors sans repasser par yt-dlp (4 s économisées).
const urlCache = new Map(); // id -> { url, size, expires }
const resolving = new Map(); // id -> Promise

function expiryOf(url) {
  const m = /[?&]expire=(\d+)/.exec(url);
  // Marge d'une minute, et jamais plus de 5 h même si YouTube annonce plus.
  const fromUrl = m ? Number(m[1]) * 1000 - 60000 : 0;
  const max = Date.now() + 5 * 3600 * 1000;
  return Math.min(fromUrl || max, max);
}

async function resolveUrl(id) {
  const hit = urlCache.get(id);
  if (hit && hit.expires > Date.now()) return hit;
  if (resolving.has(id)) return resolving.get(id);

  const p = (async () => {
    const out = await runWithRepair(
      [
        ...baseArgs(),
        "-f",
        FORMAT,
        "--print",
        "%(urls)s",
        "--print",
        "%(filesize,filesize_approx)s",
        `https://www.youtube.com/watch?v=${id}`,
      ],
      60000
    );
    const lines = out.trim().split("\n").filter(Boolean);
    const url = lines.find((l) => l.startsWith("http"));
    if (!url) throw new Error("yt-dlp n'a renvoyé aucune URL de flux.");
    const entry = {
      url,
      size: Number(lines[lines.indexOf(url) + 1]) || 0,
      expires: expiryOf(url),
    };
    urlCache.set(id, entry);
    return entry;
  })().finally(() => resolving.delete(id));

  resolving.set(id, p);
  return p;
}

// ----------------------------------------------------------------------
//  Téléchargement complet (secours + préchauffage + blind test)
// ----------------------------------------------------------------------

// Téléchargements en cours, dédupliqués par videoId (si deux clients demandent
// la même piste, un seul yt-dlp tourne et les deux attendent la même promesse).
const inflight = new Map();

// Exporté pour l'analyse de climax du blind test (lib/ostClimax.js) : elle a
// besoin du MÊME fichier local, et surtout du même cache — analyser une piste
// la met du coup à disposition du mini-lecteur, et inversement.
export function download(id) {
  if (fs.existsSync(fileFor(id))) return Promise.resolve(fileFor(id));
  if (inflight.has(id)) return inflight.get(id);
  const tmp = path.join(CACHE_DIR, `${id}.dl`);
  const p = runWithRepair(
    [
      ...baseArgs(),
      "-f",
      FORMAT,
      "-x",
      "--audio-format",
      "m4a",
      "--ffmpeg-location",
      FFMPEG,
      "-o",
      `${tmp}.%(ext)s`,
      `https://www.youtube.com/watch?v=${id}`,
    ],
    180000
  )
    .then(() => {
      try {
        fs.renameSync(`${tmp}.m4a`, fileFor(id));
      } catch {
        cleanupTmp(id);
        throw new Error("yt-dlp n'a pas produit de fichier m4a.");
      }
      pruneCache();
      return fileFor(id);
    })
    .catch((err) => {
      cleanupTmp(id);
      throw err;
    })
    .finally(() => inflight.delete(id));
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

// ----------------------------------------------------------------------
//  Relais du flux distant
// ----------------------------------------------------------------------

// Vrai quand la requête réclame la piste ENTIÈRE : soit aucun Range, soit le
// « bytes=0- » que posent d'office ExoPlayer (Android) et AVPlayer (iOS). Ce
// sont les seuls cas où le corps relayé vaut le fichier complet, donc les seuls
// où on peut le recopier dans le cache au passage.
function isFullRequest(range) {
  if (!range) return true;
  return /^bytes=0-$/.test(range.trim());
}

// Recopie le flux relayé dans le cache pendant qu'il part vers le client. Le
// fichier n'est promu en `.m4a` que si on a bien reçu tous les octets annoncés :
// un client qui coupe au bout de 10 s ne doit pas laisser un fichier tronqué
// que les écoutes suivantes serviraient tel quel.
function teeToCache(id, source, expectedSize) {
  if (!expectedSize) return;
  const tmp = path.join(CACHE_DIR, `${id}.tee`);
  let written = 0;
  let out;
  try {
    out = fs.createWriteStream(tmp);
  } catch {
    return;
  }
  const abort = () => {
    out.destroy();
    fs.unlink(tmp, () => {});
  };
  source.on("data", (chunk) => {
    written += chunk.length;
    if (!out.destroyed) out.write(chunk);
  });
  source.on("error", abort);
  source.on("aborted", abort);
  source.on("end", () => {
    out.end(() => {
      if (written !== expectedSize) return fs.unlink(tmp, () => {});
      fs.rename(tmp, fileFor(id), (err) => {
        if (err) return fs.unlink(tmp, () => {});
        pruneCache();
      });
    });
  });
  source.on("close", () => {
    if (!out.writableEnded) abort();
  });
  out.on("error", () => {
    fs.unlink(tmp, () => {});
  });
}

async function streamRemote(id, req, res) {
  const src = await resolveUrl(id);
  const range = req.headers.range;

  const upstream = await fetch(src.url, {
    headers: { "user-agent": UA, ...(range ? { range } : {}) },
    redirect: "follow",
  });
  if (upstream.status !== 200 && upstream.status !== 206) {
    // URL périmée ou refusée : on la jette pour que l'essai suivant en
    // redemande une fraîche à yt-dlp.
    urlCache.delete(id);
    throw new Error(`googlevideo a répondu ${upstream.status}`);
  }

  res.status(upstream.status);
  res.setHeader("Content-Type", "audio/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  // Le contenu d'un videoId ne change jamais → cache client long.
  res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (req.method === "HEAD") {
    upstream.body?.cancel?.().catch(() => {});
    return res.end();
  }

  const body = Readable.fromWeb(upstream.body);
  if (isFullRequest(range))
    teeToCache(id, body, Number(upstream.headers.get("content-length")) || 0);
  await pipeline(body, res);
}

// ----------------------------------------------------------------------
//  Routes
// ----------------------------------------------------------------------

// GET /api/audio/diag/:videoId — pourquoi une piste ne se lit pas (admin).
// Renvoie la version de yt-dlp et, en cas d'échec, sa sortie d'erreur brute :
// c'est la seule façon de distinguer un extracteur périmé d'un blocage d'IP
// sans aller lire les logs du conteneur.
router.get("/diag/:videoId", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.videoId;
  if (!VIDEO_ID.test(id))
    return res.status(400).json({ error: "videoId invalide." });
  const out = {
    videoId: id,
    cached: fs.existsSync(fileFor(id)),
    clients: CLIENTS,
    cookies: !!(COOKIES && fs.existsSync(COOKIES)),
    proxy: !!YT_PROXY,
  };
  try {
    out.version = (await run(["--version"], 20000)).trim();
  } catch (err) {
    out.version = `introuvable (${err.message})`;
  }

  // Le générateur de PO token répond-il ? Trois choses peuvent clocher
  // indépendamment : le conteneur ne tourne pas, il tourne mais yt-dlp ne
  // connaît pas le plugin, ou les deux vont bien. On les distingue ici.
  out.potUrl = POT_URL || null;
  if (!POT_URL) out.potProvider = "non configuré";
  else {
    try {
      const r = await fetch(`${POT_URL}/ping`, {
        signal: AbortSignal.timeout(5000),
      });
      out.potProvider = r.ok ? "joignable" : `répond ${r.status}`;
    } catch (err) {
      out.potProvider = `injoignable — ${err.message}`;
    }
    // yt-dlp annonce ses fournisseurs de jeton en mode bavard :
    //   [debug] [youtube] [pot] PO Token Providers: bgutil:http-1.3.1 (external)
    // Absent = le plugin n'est pas installé dans l'image, et le conteneur ne
    // sert alors à rien même s'il tourne.
    try {
      const log = await runVerbose(
        [...baseArgs(), "-f", FORMAT, "--simulate", "-q", "-v",
         `https://www.youtube.com/watch?v=${id}`],
        60000
      );
      const line = /\[pot\][^\n]*/.exec(log);
      out.potPlugin = line ? line[0].trim() : "plugin non détecté par yt-dlp";
    } catch (err) {
      out.potPlugin = `indéterminé (${err.message.slice(0, 120)})`;
    }
  }
  const t0 = Date.now();
  try {
    const src = await resolveUrl(id);
    out.ok = true;
    out.ms = Date.now() - t0;
    out.size = src.size;
    out.streamHost = new URL(src.url).host;
  } catch (err) {
    out.ok = false;
    out.ms = Date.now() - t0;
    out.error = err.message;
  }
  res.json(out);
});

// GET /api/audio/:videoId — le flux m4a de la piste. Servi depuis le cache
// quand on l'a, relayé depuis YouTube sinon (et mis en cache au passage). Les
// requêtes Range sont honorées dans les deux cas → déplacement dans la piste.
router.get("/:videoId", async (req, res) => {
  const id = req.params.videoId;
  if (!VIDEO_ID.test(id))
    return res.status(400).json({ error: "videoId invalide." });

  const file = fileFor(id);
  if (fs.existsSync(file)) {
    // Marque la piste comme récemment écoutée (pour la purge LRU).
    fs.utimes(file, new Date(), new Date(), () => {});
    return res.sendFile(file, {
      headers: {
        "Content-Type": "audio/mp4",
        "Cache-Control": "public, max-age=2592000, immutable",
      },
    });
  }

  try {
    await streamRemote(id, req, res);
  } catch (err) {
    // Relais déjà commencé : le client a raccroché (changement de piste, appli
    // fermée) ou la connexion a lâché en route. Rien à répondre, rien à logger.
    if (res.headersSent) return res.destroy();
    console.error(`audio ${id}: relais impossible —`, err.message);
    // Dernier recours : l'ancien chemin, téléchargement complet puis envoi.
    // Plus lent, mais il rattrape les cas où seul le relais direct coince.
    try {
      await download(id);
      return res.sendFile(file, {
        headers: {
          "Content-Type": "audio/mp4",
          "Cache-Control": "public, max-age=2592000, immutable",
        },
      });
    } catch (err2) {
      console.error(`audio ${id}: extraction impossible —`, err2.message);
      return res.status(502).json({ error: "Extraction audio impossible." });
    }
  }
});

// GET /api/audio/:videoId/prefetch — prépare la piste suivante de la file. On
// ne fait plus que résoudre l'URL (quelques secondes) : le flux relayé démarre
// ensuite instantanément, sans avoir occupé le disque ni la bande passante
// pour une piste que l'auditeur va peut-être sauter.
router.get("/:videoId/prefetch", (req, res) => {
  const id = req.params.videoId;
  if (!VIDEO_ID.test(id))
    return res.status(400).json({ error: "videoId invalide." });
  if (!fs.existsSync(fileFor(id))) {
    resolveUrl(id).catch((err) =>
      console.error(`audio ${id}: prefetch raté —`, err.message)
    );
  }
  res.status(202).json({ ok: true });
});

export default router;
