import "dotenv/config";
import fs from "node:fs";
import {
  RESOLVED_FILE,
  allEntries,
  loadResolved,
  normName,
  resolveEntries,
  sortKeys,
} from "../lib/officialLists.js";

// ======================================================================
//  Nom → identifiant IGDB pour les listes officielles (tops, Game Awards)
// ======================================================================
//   npm run resolve:official            → ne résout que les nouvelles entrées
//   npm run resolve:official -- --all   → repart de zéro
//
// Écrit data/officialLists/resolved.json, à committer : c'est lui qui rend la
// publication depuis le panel admin quasi instantanée. Pas de base de données
// ici, seulement IGDB. Le rapport final liste ce qu'il faut relire : les
// correspondances approximatives et les jeux introuvables.

const all = process.argv.includes("--all");
const previous = all ? {} : loadResolved();
const entries = allEntries();

const todo = [...entries].filter(([key]) => !previous[key]).map(([key, e]) => ({ key, ...e }));
console.log(`→ ${entries.size} entrées, ${todo.length} à résoudre`);

const found = todo.length ? await resolveEntries(todo, { log: (l) => console.log(l) }) : new Map();

const next = {};
for (const key of entries.keys()) {
  const hit = previous[key] || found.get(key);
  if (hit) next[key] = hit;
}
fs.writeFileSync(RESOLVED_FILE, `${JSON.stringify(sortKeys(next), null, 1)}\n`);

const approx = Object.entries(next).filter(
  ([key, v]) => !v.exact || normName(key.replace(/\s[@#].*$/, "")) !== normName(v.name)
);
const missing = [...entries.keys()].filter((k) => !next[k]);

console.log(`\n✓ ${Object.keys(next).length}/${entries.size} résolues`);
if (approx.length) {
  console.log(`\n~ ${approx.length} correspondance(s) à relire :`);
  for (const [key, v] of approx) console.log(`  ${key}  →  ${v.name} (${v.year ?? "?"}) #${v.id}`);
}
if (missing.length) {
  console.log(`\n! ${missing.length} introuvable(s) :`);
  for (const k of missing) console.log(`  ${k}`);
}
process.exit(0);
