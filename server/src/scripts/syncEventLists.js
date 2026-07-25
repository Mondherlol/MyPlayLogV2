import "dotenv/config";
import mongoose from "mongoose";
import { defaultSince, syncEventLists } from "../lib/eventSync.js";

// ======================================================================
//  Synchro des listes « Événements » (Nintendo Direct, Summer Game Fest…)
// ======================================================================
//   npm run sync:events                  → l'année en cours
//   npm run sync:events -- --since=2025-01-01
//   npm run sync:events -- --all         → sans filtre d'événements (tout IGDB)
//   npm run sync:events -- --dry         → montre ce qui serait fait
//
// Le même travail est disponible depuis le panel admin (onglet Système), ce
// qui évite d'avoir à se connecter en SSH au VPS après chaque conférence.
// Toute la logique vit dans lib/eventSync.js — ici, juste la ligne de commande.

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => process.argv.includes(`--${name}`);

// Les couvertures générées sont servies par Express sur /uploads : hors requête
// HTTP, on ne peut pas deviner le domaine public — PUBLIC_URL le donne.
function publicBase() {
  const env = process.env.PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const local = `http://localhost:${process.env.PORT || 4000}`;
  console.warn(
    `⚠️  PUBLIC_URL non défini → couvertures générées en ${local}\n` +
      `    En production, définis PUBLIC_URL=https://myplaylog.cc (onglet Secrets)\n` +
      `    avant de lancer ce script, sinon elles seront introuvables.`
  );
  return local;
}

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myplaylog";
  await mongoose.connect(uri);
  console.log(`→ MongoDB : ${uri}`);

  const sinceArg = arg("since");
  const since = sinceArg ? Math.floor(new Date(sinceArg).getTime() / 1000) : defaultSince();
  const dry = flag("dry");
  console.log(
    `→ événements depuis le ${new Date(since * 1000).toISOString().slice(0, 10)}` +
      (flag("all") ? " (sans filtre)" : "") +
      (dry ? " — essai à blanc" : "")
  );

  const s = await syncEventLists({
    since,
    all: flag("all"),
    dry,
    baseUrl: publicBase(),
    log: (line) => console.log(line),
  });

  console.log(
    `\n✓ ${s.created} liste(s) créée(s), ${s.updated} mise(s) à jour, ` +
      `${s.skipped} inchangée(s)${s.failed ? `, ${s.failed} en échec` : ""}.`
  );
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Échec de la synchro :", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
