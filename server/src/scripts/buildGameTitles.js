import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { igdbQuery } from "../lib/igdb.js";

// ======================================================================
//  Le lexique des titres — de quoi corriger une faute de frappe
// ======================================================================
//   npm run build:titles [-- --max 60000] [-- --out fichier.json]
//
// IGDB ne pardonne RIEN. « minecrft » ne rend pas Minecraft : ni le `~ *"…"*`
// du catalogue (une sous-chaîne, au caractère près) ni la commande `search`
// ne tolèrent la lettre en trop ou en moins — vérifié, les deux rendent zéro.
// Et comme il n'existe aucun point d'entrée « à peu près », la seule façon de
// proposer « vouliez-vous dire… » est d'avoir la liste des titres CHEZ NOUS,
// et d'y chercher le plus proche (cf. lib/gameSpell.js).
//
// Ce script produit cette liste. Il ne tourne pas au démarrage : c'est un
// fichier, versionné, qu'on régénère quand on veut (une fois par trimestre
// suffit — un jeu sorti hier ne s'écrit pas différemment).
//
// ⚠️ ON NE PREND PAS LES 309 000 JEUX À JAQUETTE D'IGDB. On prend ceux qui ont
// reçu au moins une note (~38 000). Le reste, c'est la longue traîne des
// prototypes et des rééditions obscures : ça triplerait le fichier et le temps
// de recherche pour corriger des titres que personne ne tape. Le jour où l'on
// veut tout : `--all`.
//
// Les titres alternatifs (VF, acronymes, noms japonais) sont pris aussi, mais
// ils ne servent qu'à RECONNAÎTRE la faute : la suggestion affichée reste le
// titre principal, le seul dont on sait qu'il sortira quelque chose.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(__dirname, "../data/game-titles.json");

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
const ALL = argv.includes("--all");
const MAX = parseInt(flag("max", ALL ? "120000" : "60000"), 10);
const OUT = flag("out", null) ? path.resolve(process.cwd(), flag("out")) : DEFAULT_OUT;

// IGDB plafonne à 500 résultats par requête. Le rythme, lui, n'est pas notre
// affaire : `igdbQuery` fait déjà passer tout le monde par sa file (≤ 4/s).
const PAGE = 500;

const WHERE = ALL
  ? "cover != null & version_parent = null"
  : "cover != null & version_parent = null & total_rating_count != null";

async function run() {
  const total = (await igdbQuery("games/count", `where ${WHERE};`))?.count ?? 0;
  const target = Math.min(total, MAX);
  console.log(`IGDB annonce ${total} jeux ; on en prend ${target}.`);

  const names = []; // [titre, popularité]
  const alts = []; // [variante, index du titre principal]
  const seen = new Set(); // dédoublonnage sur le titre brut

  for (let offset = 0; offset < target; offset += PAGE) {
    const rows = await igdbQuery(
      "games",
      `fields name,total_rating_count,alternative_names.name;
       where ${WHERE};
       sort total_rating_count desc;
       limit ${PAGE}; offset ${offset};`
    );
    if (!rows?.length) break;

    for (const g of rows) {
      const name = String(g.name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const i = names.push([name, g.total_rating_count || 0]) - 1;
      for (const a of g.alternative_names || []) {
        const alt = String(a?.name || "").trim();
        // Une variante qui répète le titre principal n'apprend rien.
        if (alt && alt.length > 2 && alt !== name) alts.push([alt, i]);
      }
    }

    if (offset % (PAGE * 10) === 0) {
      process.stdout.write(`\r  ${names.length} titres, ${alts.length} variantes…`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ v: 1, builtAt: new Date().toISOString(), names, alts })
  );
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(
    `\n${names.length} titres + ${alts.length} variantes → ${OUT} (${kb} ko)`
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Échec :", err.message);
    process.exit(1);
  });
