import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { createExtractorFromFile } from "node-unrar-js";
import ffmpegStatic from "ffmpeg-static";

// ======================================================================
//  Ouvrir un CBZ / CBR et en sortir des pages
// ======================================================================
// Un comic numérique n'est pas un format : c'est une ARCHIVE d'images numérotées.
// Un `.cbz` est un zip renommé, un `.cbr` un rar renommé — rien d'autre. Tout
// le travail tient donc en trois gestes : ouvrir, trier, écrire.
//
// L'EXTRACTION SE FAIT ICI, sur le serveur, et une seule fois. L'alternative
// (garder l'archive et la déballer dans le navigateur à chaque lecture)
// obligerait chaque lecteur à télécharger les vingt pages d'un coup avant la
// première, et interdirait toute vignette. Déballées, les pages sont des
// fichiers ordinaires : le navigateur les charge à la demande, les met en
// cache, et la couverture sert de miniature partout ailleurs.
//
// LE TRI EST LE PIÈGE. Les pages s'appellent « 1.jpg, 2.jpg … 10.jpg », et
// l'ordre alphabétique met 10 avant 2. Un comic lu dans le désordre est
// illisible, et personne ne pense à vérifier ça avant de le publier — d'où un
// tri NATUREL (les nombres comparés comme des nombres), obligatoire.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, "../../uploads/comics");
fs.mkdirSync(PAGES_DIR, { recursive: true });

// Ce qu'on accepte comme page. Le webp et l'avif sont courants sur les scans
// récents ; le gif ne l'est pas, mais il ne coûte rien.
const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;

// Ce qu'on ignore SANS discuter : les métadonnées des logiciels de rangement
// (ComicRack écrit un ComicInfo.xml), les résidus macOS, les vignettes Windows.
const JUNK_RE = /(^|\/)(__MACOSX\/|\._|\.DS_Store|Thumbs\.db|ComicInfo\.xml)/i;

// Plafond de sécurité. Ces archives sont des one-shots promotionnels de vingt
// pages ; au-delà de 400, on n'a plus affaire à ce qu'on croit, et il vaut
// mieux le dire que remplir le disque.
const MAX_PAGES = 400;

// ----------------------------------------------------------------------
//  Les vignettes
// ----------------------------------------------------------------------
// LA PLANCHE-CONTACT D'UN VOLUME, C'EST CENT IMAGES D'UN COUP. Servies en
// pleine définition — 1600 × 2400 pixels et un ou deux mégaoctets chacune — le
// navigateur les décode TOUTES pour les afficher larges de cent pixels. Ce
// n'est pas un problème de bande passante mais de mémoire de décodage : une
// centaine de planches, c'est plusieurs giga-octets de bitmaps, et l'onglet
// tombe à genoux. Une vignette de 240 pixels pèse une quinzaine de kilo-octets
// et se décode en rien.
//
// Elles sont donc fabriquées À L'IMPORT, une fois pour toutes, à côté des
// planches. Et sans nouvelle dépendance : ffmpeg est déjà installé (le montage
// vidéo du mur média s'en sert, cf. lib/videoEdit.js et le Dockerfile), il est
// natif, et redimensionner une image lui coûte quelques millisecondes.
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const THUMB_W = 240;
const THUMB_JOBS = 4; // quatre à la fois : au-delà on se dispute le disque

// Une vignette. Un échec ne remonte JAMAIS : sans ffmpeg (ou sur une image
// qu'il refuse), le titre s'importe quand même et la fiche retombe sur la
// planche en pleine définition — c'est-à-dire exactement ce qu'elle faisait
// avant. Une planche sans vignette est un désagrément, pas une panne.
function makeThumb(src, out) {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      src,
      // `-1` garde les proportions ; `force_divisible_by=2` évite l'erreur des
      // hauteurs impaires sur certains encodeurs.
      "-vf",
      `scale=${THUMB_W}:-1:flags=lanczos:force_divisible_by=2`,
      "-frames:v",
      "1", // un gif animé n'a qu'une vignette
      "-q:v",
      "6",
      out,
    ]);
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

// Les vignettes de tout un volume, quatre par quatre. Les planches déjà pourvues
// sont sautées : c'est ce qui permet de repasser sur un titre existant sans tout
// refaire (voir le script de rattrapage).
export async function makeThumbs(pages, slug) {
  const dir = path.join(PAGES_DIR, slug, "thumbs");
  await fs.promises.mkdir(dir, { recursive: true });
  const queue = pages.filter((pg) => !pg.thumb && pg.file);

  const worker = async () => {
    for (let pg = queue.shift(); pg; pg = queue.shift()) {
      const name = `${path.basename(pg.file, path.extname(pg.file))}.jpg`;
      const src = path.join(PAGES_DIR, slug, path.basename(pg.file));
      if (!fs.existsSync(src)) continue;
      if (await makeThumb(src, path.join(dir, name)))
        pg.thumb = `/uploads/comics/${slug}/thumbs/${name}`;
    }
  };
  await Promise.all(Array.from({ length: THUMB_JOBS }, worker));
  return pages;
}

// Tri naturel : « page2 » avant « page10 ». Les segments de chiffres sont
// comparés comme des nombres, le reste comme du texte.
export function naturalCompare(a, b) {
  const split = (s) => String(s).split(/(\d+)/);
  const A = split(a.toLowerCase());
  const B = split(b.toLowerCase());
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] ?? "";
    const y = B[i] ?? "";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "")
      return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

// UNE ENTRÉE, VUE PAR L'INGESTION, c'est un nom et l'une de ces deux choses :
//   • `read()` — elle sait se donner en mémoire (zip) ;
//   • `at`     — elle est DÉJÀ sur le disque (rar, qu'on fait écrire lui-même).
// Le reste du travail — trier, renommer, mesurer — ne connaît que ce contrat et
// ne sait pas de quel format il vient.

// Les entrées d'un zip. `adm-zip` charge l'archive en mémoire, chemin ou pas
// (il fait un `readFileSync` sur le nom qu'on lui donne) : on ne gagne donc
// rien à lui passer un flux. En revanche il ne DÉCOMPRESSE qu'à la demande —
// une page à la fois, ce qui est tout ce qui compte.
function readZip(filePath) {
  const zip = new AdmZip(filePath);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && IMAGE_RE.test(e.entryName) && !JUNK_RE.test(e.entryName))
    .map((e) => ({ name: e.entryName, read: () => e.getData() }));
}

// Les entrées d'un rar. `node-unrar-js` est du WebAssembly : aucun binaire à
// installer dans l'image Docker, ce qui est la seule raison de ne pas avoir
// choisi `unrar` en ligne de commande.
//
// ON LE FAIT ÉCRIRE DIRECTEMENT SUR LE DISQUE (`targetPath`). Il extrayait tout
// d'un coup EN MÉMOIRE, ce qui allait très bien pour les vingt planches d'un
// one-shot promotionnel — mais un tome de quatre cents mégaoctets, c'était
// l'archive copiée pour le décodeur PLUS toutes ses images décompressées, soit
// près d'un gigaoctet et demi d'un coup. De quoi coucher un VPS à deux
// gigaoctets, et pour un fichier qu'on ne garde même pas.
async function readRar(filePath, stage) {
  await fs.promises.mkdir(stage, { recursive: true });
  const extractor = await createExtractorFromFile({ filepath: filePath, targetPath: stage });
  const names = [...extractor.getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && IMAGE_RE.test(h.name) && !JUNK_RE.test(h.name))
    .map((h) => h.name);
  if (!names.length) return [];

  // Le générateur DOIT être parcouru : c'est lui qui déclenche l'écriture.
  [...extractor.extract({ files: names }).files];
  return names
    .map((name) => ({ name, at: path.join(stage, name) }))
    .filter((e) => fs.existsSync(e.at));
}

// Les premiers octets d'un fichier, sans le charger. Deux cent cinquante ko
// couvrent largement l'en-tête d'un JPEG, même précédé d'une vignette EXIF.
async function head(file, n = 256 * 1024) {
  const fd = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fd.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

// L'archive est reconnue à sa SIGNATURE, pas à son extension : un « .cbr »
// renommé qui contient en réalité un zip est un grand classique du partage de
// scans, et l'ouvrir avec le mauvais lecteur donnerait une erreur incompréhensible.
async function sniff(filePath) {
  const buffer = await head(filePath, 4);
  if (buffer.length < 4) return null;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "zip"; // « PK »
  if (buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72) return "rar"; // « Rar! »
  return null;
}

// Lit la taille d'une image dans ses premiers octets, sans la décoder. On ne
// s'en sert pas pour l'affichage (le navigateur la connaîtra) mais pour SAVOIR :
// une double page fait deux fois la largeur des autres, et c'est ce qui permet
// au lecteur de ne pas la couper en deux en mode double page.
function imageSize(buf) {
  // PNG : la taille est dans l'en-tête IHDR, à position fixe.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };

  // JPEG : il faut parcourir les segments jusqu'à un marqueur de trame (SOFn).
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, sauf les marqueurs qui n'en sont pas (DHT, JPG, DAC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }

  // WebP (VP8X) : dimensions sur 24 bits, moins un.
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    if (buf.toString("ascii", 12, 16) === "VP8X")
      return {
        w: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
        h: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
      };
  }
  return null;
}

// Déballe une archive dans son propre dossier et renvoie la liste des pages,
// dans l'ordre. Le dossier est VIDÉ d'abord : remplacer l'archive d'un titre
// ne doit pas laisser traîner les pages de la précédente, qui se mélangeraient
// à la lecture.
export async function extractComic(filePath, slug) {
  const kind = await sniff(filePath);
  if (!kind)
    throw new Error("Archive non reconnue : attendu un CBZ (zip) ou un CBR (rar).");

  const dir = path.join(PAGES_DIR, slug);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  // Le vestiaire du rar : il y dépose ses images sous leurs noms d'origine, et
  // on les range de là. Il est effacé quoi qu'il arrive.
  const stage = path.join(dir, ".rar");

  try {
    let entries;
    try {
      entries = kind === "zip" ? readZip(filePath) : await readRar(filePath, stage);
    } catch (err) {
      throw new Error(`Archive illisible (${err.message}).`);
    }
    if (!entries.length) throw new Error("Aucune image dans l'archive.");
    if (entries.length > MAX_PAGES)
      throw new Error(`${entries.length} pages : c'est au-delà de ce qu'on héberge ici.`);

    entries.sort((a, b) => naturalCompare(a.name, b.name));

    const pages = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ext = path.extname(e.name).toLowerCase() || ".jpg";
      // Renommées par leur RANG, sur quatre chiffres : le nom du fichier porte
      // alors l'ordre de lecture, et plus aucun tri n'est nécessaire ensuite.
      const file = `${String(i + 1).padStart(4, "0")}${ext}`;
      const dest = path.join(dir, file);
      let size = null;
      if (e.at) {
        // Déjà sur le disque : on ne la relit pas pour la réécrire, on la
        // déplace. Seul son en-tête est lu, pour ses dimensions.
        size = imageSize(await head(e.at));
        await fs.promises.rename(e.at, dest);
      } else {
        const data = e.read();
        if (!data?.length) continue;
        await fs.promises.writeFile(dest, data);
        size = imageSize(data);
      }
      const bytes = (await fs.promises.stat(dest)).size;
      pages.push({
        index: pages.length,
        file: `/uploads/comics/${slug}/${file}`,
        thumb: null,
        w: size?.w || null,
        h: size?.h || null,
        bytes,
      });
    }
    if (!pages.length) throw new Error("Aucune page exploitable dans l'archive.");
  // Les vignettes dans la foulée : c'est le seul moment où l'on tient toutes
    // les planches d'un titre sous la main, et l'import est déjà un geste long.
    await makeThumbs(pages, slug);
    return pages;
  } finally {
    // Le vestiaire disparaît DANS TOUS LES CAS — succès, archive illisible,
    // plafond de pages dépassé. Il vit sous le dossier des planches : oublié
    // là, il servirait le double du volume à chaque titre en rar.
    await fs.promises.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

// Efface les pages d'un titre — appelé quand le titre lui-même disparaît.
export async function dropComic(slug) {
  await fs.promises
    .rm(path.join(PAGES_DIR, slug), { recursive: true, force: true })
    .catch(() => {});
}

// Une page est « large » quand elle est plus large que haute : c'est une double
// page, et le lecteur doit la présenter seule plutôt que de l'apparier avec sa
// voisine — sinon tout le reste du volume se retrouve décalé d'une page.
export const isSpread = (page) => !!(page?.w && page?.h && page.w > page.h * 1.2);
