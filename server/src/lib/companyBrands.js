// La marque derrière un nom de société IGDB.
//
// IGDB éclate un même éditeur en dizaines de fiches : « Ubisoft Entertainment »,
// « Ubisoft Montreal », « Ubi Soft Paris », « Sega Games », « Sega
// Corporation », « Sony Computer Entertainment », « SIE Santa Monica
// Studio »… Pour le cercle des studios (développeurs et éditeurs confondus),
// tout ça doit faire UNE bulle « Ubisoft », « Sega », « Sony ».
//
// Deux étages :
//  1. les grandes marques, reconnues au DÉBUT du nom (préfixe) — une filiale
//     qui porte le nom de la maison mère y retourne ;
//  2. pour tout le reste, on retire seulement les suffixes juridiques
//     (« Co., Ltd. », « Inc. »…), pour fusionner les variantes d'écriture.
// Un studio racheté mais qui garde son propre nom (Naughty Dog, Rocksteady,
// Kojima Productions) reste lui-même.

// `logo` : le nom exact de la fiche IGDB dont on prend le logo.
const BRANDS = [
  { name: "Nintendo", logo: "Nintendo", prefixes: ["nintendo"] },
  {
    name: "Sony",
    logo: "Sony Interactive Entertainment",
    prefixes: ["sony", "sie", "scea", "scee", "scei", "sce", "playstation studios"],
  },
  { name: "Microsoft", logo: "Xbox Game Studios", prefixes: ["microsoft", "xbox"] },
  { name: "Sega", logo: "Sega", prefixes: ["sega"] },
  { name: "Ubisoft", logo: "Ubisoft Entertainment", prefixes: ["ubisoft"] },
  {
    name: "Bandai Namco",
    logo: "Bandai Namco Entertainment",
    prefixes: ["bandai namco", "namco bandai", "namco", "bandai"],
  },
  { name: "Square Enix", logo: "Square Enix", prefixes: ["square enix", "squaresoft", "square", "enix"] },
  { name: "Capcom", logo: "Capcom", prefixes: ["capcom"] },
  { name: "Konami", logo: "Konami", prefixes: ["konami", "kce"] },
  { name: "Koei Tecmo", logo: "Koei Tecmo", prefixes: ["koei tecmo", "koei", "tecmo"] },
  { name: "Electronic Arts", logo: "Electronic Arts", prefixes: ["electronic arts", "ea"] },
  { name: "Activision", logo: "Activision", prefixes: ["activision"] },
  { name: "Blizzard", logo: "Blizzard Entertainment", prefixes: ["blizzard"] },
  { name: "Rockstar", logo: "Rockstar Games", prefixes: ["rockstar"] },
  { name: "2K", logo: "2K", prefixes: ["2k"] },
  { name: "Take-Two", logo: "Take-Two Interactive", prefixes: ["take two"] },
  { name: "Bethesda", logo: "Bethesda Softworks", prefixes: ["bethesda"] },
  { name: "Warner Bros.", logo: "Warner Bros. Games", prefixes: ["warner bros", "wb games"] },
  { name: "Atlus", logo: "Atlus", prefixes: ["atlus"] },
  { name: "Level-5", logo: "Level-5", prefixes: ["level 5"] },
  { name: "Spike Chunsoft", logo: "Spike Chunsoft", prefixes: ["spike chunsoft"] },
  { name: "Nippon Ichi", logo: "Nippon Ichi Software", prefixes: ["nippon ichi", "nis america"] },
  { name: "Marvelous", logo: "Marvelous", prefixes: ["marvelous"] },
  { name: "Taito", logo: "Taito", prefixes: ["taito"] },
  { name: "SNK", logo: "SNK", prefixes: ["snk"] },
  { name: "Hudson Soft", logo: "Hudson Soft", prefixes: ["hudson"] },
  { name: "THQ", logo: "THQ Nordic", prefixes: ["thq"] },
  { name: "Codemasters", logo: "Codemasters", prefixes: ["codemasters"] },
  { name: "Deep Silver", logo: "Deep Silver", prefixes: ["deep silver"] },
  { name: "Focus Entertainment", logo: "Focus Entertainment", prefixes: ["focus home", "focus entertainment"] },
  { name: "Disney", logo: "Disney Interactive Studios", prefixes: ["disney", "buena vista"] },
  { name: "LucasArts", logo: "LucasArts", prefixes: ["lucasarts", "lucasfilm games"] },
  { name: "Riot Games", logo: "Riot Games", prefixes: ["riot"] },
  { name: "Tencent", logo: "Tencent Games", prefixes: ["tencent"] },
  { name: "NetEase", logo: "NetEase Games", prefixes: ["netease"] },
  { name: "Nexon", logo: "Nexon", prefixes: ["nexon"] },
  { name: "Epic Games", logo: "Epic Games", prefixes: ["epic games"] },
  { name: "Valve", logo: "Valve", prefixes: ["valve"] },
];

// Suffixes juridiques / génériques retirés pour comparer deux noms.
const SUFFIXES = new Set([
  "co", "ltd", "inc", "llc", "gmbh", "sa", "sas", "srl", "corp", "corporation",
  "limited", "company", "kk", "plc", "ab", "oy", "bv",
]);

function norm(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ubi soft/g, "ubisoft")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Les préfixes les plus longs d'abord : « bandai namco » avant « bandai ».
const PREFIXES = BRANDS.flatMap((b) => b.prefixes.map((p) => [norm(p), b])).sort(
  (a, b) => b[0].length - a[0].length
);

/**
 * La marque d'un nom de société : { key, name, logo }.
 * - `key` : ce qui regroupe (deux noms de même clé = une bulle) ;
 * - `name` : le nom affiché si c'est une grande marque, sinon null (on
 *   affichera la variante la plus fréquente chez le joueur) ;
 * - `logo` : la fiche IGDB à qui demander le logo, ou null.
 */
export function brandOf(companyName) {
  const n = norm(companyName);
  for (const [p, brand] of PREFIXES) {
    if (n === p || n.startsWith(p + " ")) return { key: `b:${brand.name}`, name: brand.name, logo: brand.logo };
  }
  const words = n.split(" ");
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return { key: `n:${words.join(" ")}`, name: null, logo: null };
}
