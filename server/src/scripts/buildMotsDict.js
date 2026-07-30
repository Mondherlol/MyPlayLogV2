import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { MOTS_POOL } from "../data/motsPool.js";

// ======================================================================
//  Construction du dictionnaire vectoriel français du « Mot du jour ».
// ======================================================================
//   npm run build:mots -- --src <chemin/vers/cc.fr.300.vec.gz>
//
// Le jeu a besoin de mesurer la PROXIMITÉ DE SENS entre deux mots français.
// On n'utilise volontairement AUCUN LLM pour ça : il faut que « zombie » vaille
// exactement la même chose pour tous les joueurs, aujourd'hui et dans six mois,
// sinon le classement ne veut rien dire. La réponse classique (celle de
// Semantle et de Cémantix) : des vecteurs de mots pré-calculés, où la similarité
// cosinus entre deux vecteurs EST la proximité de sens. Un produit scalaire,
// rien de plus.
//
// Source : les vecteurs français de fastText (Common Crawl + Wikipédia),
// 2 millions de mots en 300 dimensions.
//   https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.fr.300.vec.gz
//   (CC BY-SA 3.0 — la mention est affichée en pied de la page du jeu.)
//
// Trois raisons pour lesquelles ce script existe au lieu d'embarquer le fichier :
//
//   1. TAILLE. Le .vec fait 4,5 Go décompressé. On n'en garde que les ~50 000
//      mots français les plus courants, quantifiés en int8 : ~15 Mo, qui
//      tiennent dans le dépôt et voyagent avec l'image Docker (COPY . . du
//      server/Dockerfile) — donc rien à faire au déploiement.
//
//   2. TÉLÉCHARGEMENT PARTIEL. Le .vec est trié par FRÉQUENCE DÉCROISSANTE.
//      Les mots courants sont donc tous au début : une requête HTTP Range sur
//      les 300 premiers Mo suffit, pas besoin des 1,3 Go. Le flux gzip se
//      termine alors par une erreur « unexpected end of file » — attendue, et
//      traitée comme une fin de fichier normale (voir readVectors).
//
//   3. FILTRAGE. Un dictionnaire de jeu ne veut ni noms propres, ni sigles, ni
//      mots d'une lettre : voir `acceptable()`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../data");
const OUT_VEC = path.join(OUT_DIR, "mots-fr.vec.bin");
const OUT_WORDS = path.join(OUT_DIR, "mots-fr.words.json");

// Cible de vocabulaire. 50 000 mots, c'est le point d'équilibre : assez large
// pour qu'un joueur tape rarement un mot inconnu, assez serré pour que le
// classement des 1000 plus proches reste pertinent (au-delà, on accumule des
// formes fléchies rares qui polluent le voisinage).
const TARGET_WORDS = 50_000;
// Garde-fou : si le filtre laisse passer moins de mots que prévu, on ne lit pas
// le fichier entier pour rien. 400 000 lignes ≈ les 400 000 mots les plus
// fréquents, très au-delà de ce dont on a besoin.
const MAX_LINES = 400_000;
const MIN_WORDS = 20_000; // en dessous, le build est considéré comme raté

// Mots outils : ils sont ultra-fréquents (donc tout en haut du fichier) et
// n'ont aucun voisinage sémantique exploitable — « de », « que », « avoir »
// n'aident personne à chauffer. On les écarte du dictionnaire.
const STOPWORDS = new Set(
  `le la les un une des du de au aux ce cet cette ces mon ma mes ton ta tes son
   sa ses notre nos votre vos leur leurs et ou mais donc or ni car que qui quoi
   dont ou si comme quand lors alors puis ensuite enfin aussi encore deja plus
   moins tres trop peu tout tous toute toutes meme memes autre autres tel telle
   je tu il elle on nous vous ils elles me te se lui leur moi toi soi eux
   etre avoir faire dire aller voir savoir pouvoir vouloir devoir falloir
   est sont etait etaient sera seront suis es sommes etes ete etant
   ai as avons avez ont avait avaient aura auront eu ayant
   fait fais faisons faites font faisait faisaient
   dit dis disons dites disent disait disaient
   pas non oui ne nul aucun aucune rien personne jamais toujours
   par pour sans sous sur dans vers chez entre avec contre depuis pendant
   avant apres devant derriere dessus dessous dedans dehors ici la bas
   oui bon bien mal mieux pire beaucoup assez presque environ selon
   cela ceci celui celle ceux celles quel quelle quels quelles
   afin ainsi cependant neanmoins toutefois pourtant puisque lorsque
   etc via cf ibid
   janvier fevrier mars avril mai juin juillet aout septembre octobre novembre
   decembre lundi mardi mercredi jeudi vendredi samedi dimanche
   deux trois quatre cinq six sept huit neuf dix cent mille million milliard
   premier premiere deuxieme troisieme dernier derniere`
    .split(/\s+/)
    .filter(Boolean)
);

// Un mot est retenu s'il est écrit tout en minuscules, uniquement avec des
// lettres françaises, et long de 3 à 16 caractères.
//
// Le « tout en minuscules » fait le gros du travail gratuitement : il élimine
// d'un coup les noms propres (Paris, Zidane, Nintendo), les sigles (SNCF) et
// les débuts de phrase mal nettoyés du corpus. Le refus des traits d'union et
// des apostrophes écarte « c'est », « aujourd'hui », « porte-monnaie » — dont
// la saisie serait ambiguë pour le joueur.
const WORD_RE = /^[a-zàâäçéèêëîïôöùûüÿœæ]{3,16}$/;

function acceptable(word) {
  return WORD_RE.test(word) && !STOPWORDS.has(stripAccents(word));
}

// Comparaison tolérante aux accents, utilisée pour les mots outils ici et pour
// le rattrapage des saisies côté runtime (lib/mots.js).
export function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ----------------------------------------------------------------------
//  Lecture du .vec (éventuellement tronqué)
// ----------------------------------------------------------------------
// Format fastText : une ligne d'en-tête « <nb_mots> <dim> », puis une ligne par
// mot : « mot v1 v2 ... v300 », valeurs séparées par des espaces.
//
// Optimisation qui change tout sur 400 000 lignes : on découpe d'abord LE MOT
// seul (indexOf) et on ne parse les 300 flottants QUE si le mot passe le
// filtre. Comme ~85 % des lignes sont rejetées, on évite autant de split() sur
// des chaînes de 2 Ko.
async function readVectors(src) {
  const words = [];
  const vectors = []; // Float32Array normalisés, dans l'ordre de `words`
  const seen = new Set();
  let dim = 0;
  let lines = 0;
  let truncated = false;

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(src).pipe(zlib.createGunzip());
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const done = () => {
      rl.close();
      stream.destroy();
      resolve();
    };

    rl.on("line", (line) => {
      lines += 1;

      // En-tête : « 2000000 300 ».
      if (lines === 1) {
        const parts = line.trim().split(/\s+/);
        if (parts.length === 2) {
          dim = Number(parts[1]);
          return;
        }
        // Pas d'en-tête (certains dumps n'en ont pas) : on traite la ligne.
      }

      const sp = line.indexOf(" ");
      if (sp <= 0) return;
      const word = line.slice(0, sp);
      if (!acceptable(word) || seen.has(word)) {
        if (lines >= MAX_LINES || words.length >= TARGET_WORDS) done();
        return;
      }

      const raw = line.slice(sp + 1).split(" ");
      if (!dim) dim = raw.length;
      // Ligne tronquée (fin de téléchargement partiel) : on l'abandonne.
      if (raw.length !== dim) return;

      // L2-normalisation à la construction : au runtime, la similarité cosinus
      // se réduit alors à un simple produit scalaire, sans aucune division.
      const v = new Float32Array(dim);
      let norm = 0;
      for (let i = 0; i < dim; i += 1) {
        const x = Number(raw[i]);
        if (!Number.isFinite(x)) return; // ligne corrompue
        v[i] = x;
        norm += x * x;
      }
      norm = Math.sqrt(norm);
      if (!norm) return;
      for (let i = 0; i < dim; i += 1) v[i] /= norm;

      seen.add(word);
      words.push(word);
      vectors.push(v);

      if (lines >= MAX_LINES || words.length >= TARGET_WORDS) done();
    });

    rl.on("close", resolve);

    // Fin de fichier abrupte : c'est le cas NORMAL avec un téléchargement
    // partiel (HTTP Range). Tant qu'on a récolté de quoi jouer, ce n'est pas
    // une erreur — juste la fin de ce qu'on a demandé.
    stream.on("error", (err) => {
      if (words.length >= MIN_WORDS) {
        truncated = true;
        resolve();
      } else {
        reject(err);
      }
    });
  });

  return { words, vectors, dim, lines, truncated };
}

// ----------------------------------------------------------------------
//  Quantification int8
// ----------------------------------------------------------------------
// 50 000 × 300 flottants, c'est 60 Mo en float32. En int8 : 15 Mo, avec une
// échelle par vecteur pour utiliser toute la plage [-127, 127].
//
//   cos(a, b) = (Σ qa_i · qb_i) × échelle_a × échelle_b
//
// (exact parce que les vecteurs sont déjà normalisés). L'erreur de
// quantification sur le cosinus est de l'ordre de 0,1 % : invisible dans un jeu
// où l'on affiche des degrés arrondis et un rang.
function quantize(vectors, dim) {
  const count = vectors.length;
  const data = new Int8Array(count * dim);
  const scales = new Float32Array(count);

  for (let w = 0; w < count; w += 1) {
    const v = vectors[w];
    let max = 0;
    for (let i = 0; i < dim; i += 1) {
      const a = Math.abs(v[i]);
      if (a > max) max = a;
    }
    const scale = max / 127 || 1e-9;
    scales[w] = scale;
    const off = w * dim;
    for (let i = 0; i < dim; i += 1) {
      // Math.round + bornage : une valeur pile à ±max donnerait ±127.
      let q = Math.round(v[i] / scale);
      if (q > 127) q = 127;
      else if (q < -127) q = -127;
      data[off + i] = q;
    }
  }
  return { data, scales };
}

// Format du .bin, lu par lib/mots.js :
//   magic  "MPLMOT01"   8 octets
//   count  uint32 LE
//   dim    uint32 LE
//   data   int8   [count * dim]
//   scales float32 [count]
const MAGIC = "MPLMOT01";

function writeBin(data, scales, count, dim) {
  const head = Buffer.alloc(16);
  head.write(MAGIC, 0, "ascii");
  head.writeUInt32LE(count, 8);
  head.writeUInt32LE(dim, 12);
  const buf = Buffer.concat([
    head,
    Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    Buffer.from(scales.buffer, scales.byteOffset, scales.byteLength),
  ]);
  fs.writeFileSync(OUT_VEC, buf);
  return buf.length;
}

// ----------------------------------------------------------------------
//  Contrôle de qualité
// ----------------------------------------------------------------------
// Un dictionnaire silencieusement pourri (mauvais fichier source, colonnes
// décalées) donnerait un jeu injouable sans qu'aucune erreur ne remonte. On
// vérifie donc que la géométrie a du SENS : des paires proches doivent scorer
// haut, des paires sans rapport doivent scorer bas.
const CHECKS = [
  ["roi", "reine", "proche"],
  ["chien", "chat", "proche"],
  ["epee", "bouclier", "proche"],
  ["foret", "arbre", "proche"],
  ["voiture", "moteur", "proche"],
  ["musique", "chanson", "proche"],
  ["banane", "ordinateur", "lointain"],
  ["pierre", "grammaire", "lointain"],
];

function sanityCheck(index, data, scales, dim) {
  const cos = (a, b) => {
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia == null || ib == null) return null;
    let dot = 0;
    const oa = ia * dim;
    const ob = ib * dim;
    for (let i = 0; i < dim; i += 1) dot += data[oa + i] * data[ob + i];
    return dot * scales[ia] * scales[ib];
  };

  console.log("\n  Contrôle de cohérence sémantique :");
  let near = [];
  let far = [];
  for (const [a, b, kind] of CHECKS) {
    // Les mots du contrôle sont écrits sans accent : on retrouve la forme
    // accentuée réellement présente dans le dictionnaire.
    const fa = index.has(a) ? a : findAccented(index, a);
    const fb = index.has(b) ? b : findAccented(index, b);
    const s = fa && fb ? cos(fa, fb) : null;
    if (s == null) {
      console.log(`    ? ${a} / ${b} — mot absent du dictionnaire`);
      continue;
    }
    (kind === "proche" ? near : far).push(s);
    console.log(`    ${kind === "proche" ? "≈" : "≠"} ${fa} / ${fb} → ${s.toFixed(3)}`);
  }
  const avg = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
  const ok = near.length && far.length && avg(near) > avg(far) + 0.15;
  console.log(
    `    moyenne proches ${avg(near).toFixed(3)} vs lointains ${avg(far).toFixed(3)} → ${
      ok ? "COHÉRENT" : "SUSPECT"
    }`
  );
  return ok;
}

// Cache accent-insensible construit à la volée pour le contrôle ci-dessus.
let accentMap = null;
function findAccented(index, plain) {
  if (!accentMap) {
    accentMap = new Map();
    for (const w of index.keys()) {
      const k = stripAccents(w);
      if (!accentMap.has(k)) accentMap.set(k, w);
    }
  }
  return accentMap.get(plain) || null;
}

// ----------------------------------------------------------------------
//  Programme principal
// ----------------------------------------------------------------------
async function main() {
  const argIdx = process.argv.indexOf("--src");
  const src = argIdx > -1 ? process.argv[argIdx + 1] : process.env.MOTS_VEC_SRC;
  if (!src || !fs.existsSync(src)) {
    console.error(
      [
        "Fichier source manquant.",
        "",
        "  1. Télécharge les vecteurs français de fastText (les 300 premiers Mo",
        "     suffisent : le fichier est trié par fréquence) —",
        "",
        "     curl -r 0-314572799 -o cc.fr.300.head.vec.gz \\",
        "       https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.fr.300.vec.gz",
        "",
        "  2. npm run build:mots -- --src ./cc.fr.300.head.vec.gz",
      ].join("\n")
    );
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`Lecture de ${src}…`);
  const { words, vectors, dim, lines, truncated } = await readVectors(src);
  console.log(
    `  ${lines.toLocaleString("fr-FR")} lignes lues → ${words.length.toLocaleString(
      "fr-FR"
    )} mots retenus (dim ${dim})${truncated ? " — flux tronqué, attendu" : ""}`
  );

  if (words.length < MIN_WORDS) {
    console.error(
      `\nSeulement ${words.length} mots : dictionnaire trop pauvre pour jouer.\n` +
        "Le fichier source est-il bien le .vec.gz français de fastText ?"
    );
    process.exit(1);
  }

  const { data, scales } = quantize(vectors, dim);
  const index = new Map(words.map((w, i) => [w, i]));

  // Couverture du vivier de mots du jour : un mot absent du dictionnaire ne
  // pourra jamais être tiré, autant le savoir maintenant.
  const missing = MOTS_POOL.filter((w) => !index.has(w));
  const poolOk = MOTS_POOL.length - missing.length;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const bytes = writeBin(data, scales, words.length, dim);
  fs.writeFileSync(OUT_WORDS, JSON.stringify({ dim, words }));

  const coherent = sanityCheck(index, data, scales, dim);

  console.log("\n  Écrit :");
  console.log(`    ${OUT_VEC}  (${(bytes / 1024 / 1024).toFixed(1)} Mo)`);
  console.log(
    `    ${OUT_WORDS}  (${(fs.statSync(OUT_WORDS).size / 1024 / 1024).toFixed(1)} Mo)`
  );
  console.log(
    `\n  Vivier des mots du jour : ${poolOk} / ${MOTS_POOL.length} présents` +
      ` (~${Math.floor(poolOk / 365)} ans de parties)`
  );
  if (missing.length) {
    console.log(
      `    absents (${missing.length}) : ${missing.slice(0, 30).join(", ")}${
        missing.length > 30 ? "…" : ""
      }`
    );
  }
  console.log(`\nTerminé en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  if (!coherent) {
    console.error(
      "\nATTENTION : le contrôle de cohérence a échoué. Ne déploie pas ce" +
        " dictionnaire sans comprendre pourquoi."
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("build:mots —", err);
  process.exit(1);
});
