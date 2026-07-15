// ---------------------------------------------------------------------------
// WORKER PSN MAISON — à lancer sur TON PC (IP résidentielle).
//
// Pourquoi : Sony/Akamai bloque l'IP du VPS (« Access Denied »). Le VPS ne parle
// donc jamais à PlayStation : il empile les demandes de synchro, et CE worker,
// lancé depuis chez toi, les traite (résout le compte, récupère jeux + temps +
// trophées) puis renvoie le résultat au VPS, qui l'écrit en base.
//
// Utilisation : double-clique sur run-psn-worker.bat (ou `node psn-worker.mjs`).
// Il traite toutes les demandes en attente puis s'arrête.
//
// Config (dans server/.env, sur ce PC) :
//   PSN_NPSSO           ton token NPSSO (comme dans le panel Admin)
//   PSN_WORKER_URL      URL du site, ex https://myplaylog.cc
//   PSN_WORKER_SECRET   même valeur que sur le VPS
//   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET  (déjà là pour IGDB)
// ---------------------------------------------------------------------------
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // server/tools
// Charge server/.env quel que soit le dossier de lancement.
config({ path: path.join(HERE, "..", ".env") });

const BASE = String(process.env.PSN_WORKER_URL || "").replace(/\/+$/, "");
const SECRET = String(process.env.PSN_WORKER_SECRET || "").trim();
const NPSSO = String(process.env.PSN_NPSSO || "").trim();

function fail(msg) {
  console.error("\n❌ " + msg + "\n");
  process.exit(1);
}
if (!BASE) fail("PSN_WORKER_URL manquant dans server/.env (ex: https://myplaylog.cc)");
if (!SECRET) fail("PSN_WORKER_SECRET manquant dans server/.env (même valeur que sur le VPS)");
if (!NPSSO) fail("PSN_NPSSO manquant dans server/.env (ton token NPSSO)");

// Import APRÈS le chargement du .env (psn.js lit l'env au fil de l'eau).
const { getServiceAccessToken, resolveOnlineId, checkTrophiesPublic, buildPsnImportData } =
  await import("../src/lib/psn.js");

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      "x-psn-worker-secret": SECRET,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${data.error || ""}`);
  return data;
}

async function processJob(job) {
  console.log(`\n▶️  ${job.username || "?"}${job.psnId ? ` (${job.psnId})` : " (re-synchro)"}`);
  const accessToken = await getServiceAccessToken();

  let account = null;
  let accountId = job.accountId;
  if (!accountId) {
    // Première liaison : on résout le PSN ID → accountId.
    const resolved = await resolveOnlineId(accessToken, job.psnId);
    if (!resolved) throw new Error(`Profil PSN introuvable : ${job.psnId}`);
    const isPublic = await checkTrophiesPublic(accessToken, resolved.accountId);
    if (!isPublic) throw new Error(`Trophées non publics pour ${job.psnId}`);
    account = resolved;
    accountId = resolved.accountId;
    console.log(`   compte résolu : ${resolved.onlineId}`);
  }

  const data = await buildPsnImportData(accessToken, accountId, (done, total) => {
    process.stdout.write(`\r   trophées ${done}/${total}   `);
  });
  process.stdout.write("\n");

  await api("POST", `/api/psn/worker/jobs/${job.id}/result`, {
    account,
    games: data.games,
    unmatched: data.unmatched,
  });
  console.log(
    `   ✅ ${data.games.length} jeux matchés, ${data.unmatched.length} à reconnaître`
  );
}

async function main() {
  console.log(`🎮 Worker PSN — ${BASE}`);
  let handled = 0;
  for (let i = 0; i < 50; i++) {
    let job;
    try {
      ({ job } = await api("GET", "/api/psn/worker/jobs"));
    } catch (e) {
      fail(`Impossible de joindre le serveur : ${e.message}`);
    }
    if (!job) break;
    try {
      await processJob(job);
      handled++;
    } catch (e) {
      console.error(`\n   ❌ ${e.message}`);
      await api("POST", `/api/psn/worker/jobs/${job.id}/error`, { error: e.message }).catch(
        () => {}
      );
    }
  }
  console.log(
    handled ? `\n✨ Terminé — ${handled} demande(s) traitée(s).` : "\n👌 Aucune demande en attente."
  );
}

main().catch((e) => fail(e.message));
