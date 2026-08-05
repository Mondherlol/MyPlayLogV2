// ======================================================================
//  Lecture / écriture du fichier .env (panel Admin → onglet Secrets).
//  On préserve l'ordre, les commentaires et les lignes vides : seules les
//  lignes d'affectation « KEY=VALUE » ciblées sont modifiées. Toute écriture
//  met AUSSI à jour process.env en mémoire → effet immédiat pour le code qui
//  lit process.env à chaque requête (les valeurs lues au démarrage, elles,
//  nécessitent un redémarrage du serveur).
// ======================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Emplacements candidats du .env, dans l'ordre de préférence.
function candidatePaths() {
  const list = [];
  if (process.env.ENV_FILE_PATH) list.push(process.env.ENV_FILE_PATH);
  list.push(path.resolve(process.cwd(), ".env"));
  list.push(path.resolve(__dirname, "../../.env")); // racine du serveur
  return [...new Set(list)];
}

// Chemin effectif : le premier .env existant, sinon le premier candidat (créé
// à la première écriture).
export function envFilePath() {
  for (const p of candidatePaths()) {
    if (fs.existsSync(p)) return p;
  }
  return candidatePaths()[0];
}

// Une clé est « sensible » (valeur masquée par défaut côté client) si son nom
// évoque un secret. Purement cosmétique : l'admin peut toujours la révéler.
export function isSecretKey(key) {
  return /(SECRET|KEY|PASS|PASSWORD|TOKEN|NPSSO|URI|URL|DSN|PRIVATE|CREDENTIAL|AUTH|HASH)/i.test(
    key
  );
}

const KV_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Retire d'éventuels guillemets encadrants pour l'affichage.
function unquote(raw) {
  let v = String(raw ?? "").trim();
  if (
    v.length >= 2 &&
    ((v[0] === '"' && v[v.length - 1] === '"') ||
      (v[0] === "'" && v[v.length - 1] === "'"))
  ) {
    const q = v[0];
    v = v.slice(1, -1);
    if (q === '"') v = v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return v;
}

// Formate une valeur pour le fichier : brute si « simple », sinon entre
// guillemets doubles échappés.
function formatValue(value) {
  const v = String(value ?? "");
  if (v === "") return "";
  if (/^[^\s#"'`\\]+$/.test(v)) return v;
  const esc = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${esc}"`;
}

function readRaw() {
  const p = envFilePath();
  let raw = "";
  let exists = false;
  try {
    raw = fs.readFileSync(p, "utf8");
    exists = true;
  } catch {
    raw = "";
  }
  return { p, raw, exists };
}

// Le .env est-il inscriptible ? (En prod Docker, le fichier peut être absent ou
// en lecture seule ; on prévient l'admin côté UI.)
function isWritable(p) {
  try {
    if (fs.existsSync(p)) {
      fs.accessSync(p, fs.constants.W_OK);
      return true;
    }
    // Le fichier n'existe pas : peut-on écrire dans son dossier ?
    fs.accessSync(path.dirname(p), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Liste les entrées du .env (clé + valeur + drapeau « sensible »), dans l'ordre
// d'apparition, la dernière affectation d'une clé faisant foi (comme dotenv).
export function listEnv() {
  const { p, raw, exists } = readRaw();
  const order = [];
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(KV_RE);
    if (!m) continue;
    const key = m[1];
    if (!map.has(key)) order.push(key);
    map.set(key, unquote(m[2]));
  }
  return {
    path: p,
    exists,
    writable: isWritable(p),
    entries: order.map((key) => ({
      key,
      value: map.get(key),
      secret: isSecretKey(key),
    })),
  };
}

// Crée / met à jour une clé : remplace la dernière ligne d'affectation existante
// (en préservant tout le reste) ou l'ajoute à la fin. Met aussi à jour
// process.env. Renvoie l'entrée écrite.
export function setEnvVar(key, value) {
  if (!KEY_RE.test(key)) throw new Error("Nom de variable invalide.");
  const { p, raw } = readRaw();
  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const formatted = `${key}=${formatValue(value)}`;

  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(KV_RE);
    if (m && m[1] === key) lastIdx = i;
  }

  if (lastIdx >= 0) {
    lines[lastIdx] = formatted;
  } else {
    // Ajout propre en fin de fichier (une seule ligne vide de séparation max).
    if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(formatted);
  }

  fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  process.env[key] = String(value ?? "");
  return { key, value: String(value ?? ""), secret: isSecretKey(key) };
}

// Supprime toutes les lignes d'affectation d'une clé (commentaires préservés).
export function deleteEnvVar(key) {
  if (!KEY_RE.test(key)) throw new Error("Nom de variable invalide.");
  const { p, raw } = readRaw();
  if (!raw) return false;
  const kept = raw.split(/\r?\n/).filter((line) => {
    const m = line.match(KV_RE);
    return !(m && m[1] === key);
  });
  fs.writeFileSync(p, kept.join("\n"), "utf8");
  delete process.env[key];
  return true;
}
