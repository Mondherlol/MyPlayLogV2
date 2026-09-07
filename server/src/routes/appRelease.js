import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

// ======================================================================
//  La distribution de l'APK Android
// ======================================================================
// MyPlayLog n'est pas sur le Play Store : l'app s'installe depuis le site, et
// se met à jour toute seule en interrogeant `/api/app/latest`. Ce fichier est
// donc les deux bouts de cette chaîne — celui qui REÇOIT le build (envoyé par
// le `npm run update` du dépôt mobile) et celui qui le SERT (au site, et à
// l'app elle-même).
//
// ⚠️ POURQUOI UN FICHIER JSON ET PAS UNE COLLECTION MONGO. Le manifeste doit
// décrire EXACTEMENT l'APK posé à côté de lui. Rangé ailleurs que dans le même
// dossier, il survivrait à un fichier effacé — et l'app irait alors télécharger
// un 404 en boucle. Ici, les deux vivent et meurent ensemble dans le volume
// `uploads_data`, qui survit aux redéploiements.
const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(__dirname, "../../uploads/app");
const MANIFEST = path.join(APP_DIR, "latest.json");
fs.mkdirSync(APP_DIR, { recursive: true });

// On garde les précédents : un build qui s'avère cassé se remplace en une
// minute par celui d'avant, sans rien recompiler.
const KEEP = 3;

const APK_MIME = "application/vnd.android.package-archive";

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
}

function writeManifest(data) {
  fs.writeFileSync(MANIFEST, JSON.stringify(data, null, 2));
}

// L'empreinte du fichier, calculée EN FLUX : un APK fait 60 à 90 Mo, le lire
// d'un bloc en mémoire pour le hacher ferait un pic inutile sur un petit VPS.
function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (c) => hash.update(c))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// Comparaison à durée constante : un `===` sur un secret laisse deviner le
// nombre de caractères justes en chronométrant les refus.
function tokenOk(given) {
  const expected = process.env.APP_RELEASE_TOKEN || "";
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Le manifeste tel que le voient l'app et le site : sans les chemins disque.
function publicManifest(m, req) {
  const base = `${req.protocol}://${req.get("host")}`;
  return {
    available: true,
    version: m.version,
    versionCode: m.versionCode,
    // En dessous de ce numéro, on ne PROPOSE plus la mise à jour, on l'impose :
    // c'est le levier pour couper les versions trop vieilles pour l'API.
    minVersionCode: m.minVersionCode || 0,
    notes: m.notes || "",
    size: m.size,
    sha256: m.sha256,
    publishedAt: m.publishedAt,
    downloads: m.downloads || 0,
    filename: m.filename,
    url: `${base}/api/app/download`,
  };
}

// ----------------------------------------------------------------------
//  GET /api/app/latest — « y a-t-il plus récent que moi ? »
// ----------------------------------------------------------------------
// Public, et volontairement bavard : cette réponse remplit à la fois l'écran
// « Mise à jour » de l'app et la page /download du site.
//
// N'avoir aucun build publié n'est PAS une erreur (le jour de la mise en
// service, il n'y en a pas) : on répond 200 avec `available: false`, ce qui
// évite à l'app d'annoncer une panne réseau pour une situation normale.
router.get("/latest", (req, res) => {
  const m = readManifest();
  if (!m || !fs.existsSync(path.join(APP_DIR, m.filename || ""))) {
    return res.json({ available: false });
  }
  res.json(publicManifest(m, req));
});

// ----------------------------------------------------------------------
//  GET /api/app/download — l'APK lui-même
// ----------------------------------------------------------------------
// Une URL STABLE, jamais horodatée : c'est elle qu'on met sur le site, dans un
// QR code, dans un message. Elle sert toujours le dernier build.
router.get("/download", (req, res) => {
  const m = readManifest();
  const file = m?.filename ? path.join(APP_DIR, m.filename) : null;
  if (!file || !fs.existsSync(file)) {
    return res.status(404).json({ error: "Aucune version publiée pour le moment." });
  }

  // Le type MIME compte : sans lui, Android range le fichier en « inconnu » et
  // le gestionnaire de téléchargement refuse de l'ouvrir au clic.
  res.setHeader("Content-Type", APK_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${m.filename}"`);
  // Contrairement à /uploads, l'URL est stable et son contenu change à chaque
  // publication : pas de cache long ici, sinon un navigateur resservirait
  // l'ancien APK après une mise à jour.
  res.setHeader("Cache-Control", "no-cache");

  // Compteur best-effort, pour la page /download. Écrit AVANT l'envoi : après,
  // la réponse est close et une erreur d'écriture n'aurait plus où aller.
  try {
    writeManifest({ ...m, downloads: (m.downloads || 0) + 1 });
  } catch {
    /* le compteur n'est pas une raison de refuser le téléchargement */
  }

  res.sendFile(file);
});

// ----------------------------------------------------------------------
//  POST /api/app/release — publier un build
// ----------------------------------------------------------------------
// Appelé par le `npm run update` du dépôt mobile. Authentifié par un secret
// dédié (`APP_RELEASE_TOKEN` dans server/.env) plutôt que par un compte admin :
// le script tourne sur une machine de build, sans session ouverte.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, APP_DIR),
    // Nom provisoire : le nom définitif dépend de la version, qui n'est
    // connue de façon sûre qu'une fois le corps de la requête entièrement lu.
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}.part`),
  }),
  limits: { fileSize: 400 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.apk$/i.test(file.originalname || "")),
});

router.post(
  "/release",
  (req, res, next) => {
    // Le jeton se vérifie AVANT multer : sinon n'importe qui pourrait nous
    // faire écrire 400 Mo sur le disque avant d'être refusé.
    const given =
      req.get("x-release-token") || (req.get("authorization") || "").replace(/^Bearer /i, "");
    if (!process.env.APP_RELEASE_TOKEN) {
      return res
        .status(503)
        .json({ error: "APP_RELEASE_TOKEN n'est pas configuré sur le serveur." });
    }
    if (!tokenOk(given)) return res.status(401).json({ error: "Jeton de publication invalide." });
    next();
  },
  upload.single("apk"),
  async (req, res) => {
    const temp = req.file?.path;
    try {
      if (!temp) return res.status(400).json({ error: "Fichier .apk manquant." });

      const version = String(req.body?.version || "").trim();
      const versionCode = Number(req.body?.versionCode);
      const notes = String(req.body?.notes || "").trim().slice(0, 4000);
      const minVersionCode = Number(req.body?.minVersionCode) || 0;
      const force = req.body?.force === "1" || req.body?.force === "true";

      if (!version || !Number.isInteger(versionCode) || versionCode < 1) {
        fs.rmSync(temp, { force: true });
        return res.status(400).json({ error: "version et versionCode sont obligatoires." });
      }

      // ⚠️ LE NUMÉRO DE BUILD DOIT MONTER, ET C'EST LE SEUL GARDE-FOU QU'ON A.
      // L'app compare des entiers pour savoir si elle est à jour ; republier le
      // même numéro avec un autre contenu laisse tous les téléphones persuadés
      // d'avoir déjà la nouveauté, et rien ne leur dira jamais le contraire.
      const current = readManifest();
      if (current && versionCode <= current.versionCode && !force) {
        fs.rmSync(temp, { force: true });
        return res.status(409).json({
          error: `Le build ${versionCode} n'est pas plus récent que le ${current.versionCode} déjà publié.`,
        });
      }

      const filename = `MyPlayLog-${version}-${versionCode}.apk`;
      const dest = path.join(APP_DIR, filename);
      fs.renameSync(temp, dest);

      const manifest = {
        version,
        versionCode,
        minVersionCode,
        notes,
        filename,
        size: fs.statSync(dest).size,
        sha256: await sha256(dest),
        publishedAt: new Date().toISOString(),
        downloads: 0,
      };
      writeManifest(manifest);

      // Ménage : on ne garde que les derniers APK (les plus récents d'abord).
      const olds = fs
        .readdirSync(APP_DIR)
        .filter((f) => f.endsWith(".apk") && f !== filename)
        .map((f) => ({ f, at: fs.statSync(path.join(APP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.at - a.at)
        .slice(KEEP - 1);
      for (const { f } of olds) fs.rmSync(path.join(APP_DIR, f), { force: true });

      res.json({ ok: true, ...publicManifest(manifest, req) });
    } catch (err) {
      if (temp) fs.rmSync(temp, { force: true });
      console.error("app release error:", err.message);
      res.status(500).json({ error: "Erreur pendant la publication." });
    }
  }
);

export default router;
