// ======================================================================
//  Ce qu'une carte CACHE : consoles, thèmes, modes, vue, tags
// ======================================================================
// La carte montre son nom, ses types, ses PV. Tout le reste — l'année, les
// consoles, les tags — ne s'affiche jamais : c'est ce que le combat demande
// (« un jeu sorti sur Nintendo », « #Zombies ») et ce qu'il faut SAVOIR.
//
// Calculé une fois par carte au chargement du catalogue (lib/cards.js), rangé
// à part des cartes envoyées au client : le classeur n'en a pas besoin.

// Les familles de consoles (ids de plateformes IGDB).
export const FAMILIES = {
  nintendo: [4, 5, 18, 19, 20, 21, 22, 24, 33, 37, 41, 58, 87, 99, 130, 137, 159, 508],
  playstation: [7, 8, 9, 38, 46, 48, 165, 167, 390],
  xbox: [11, 12, 49, 169],
  pc: [3, 6, 13, 14],
  sega: [23, 29, 30, 32, 35, 64, 78, 84],
  mobile: [34, 39, 55, 74],
  arcade: [52],
};
export const FAMILY_LABELS = {
  nintendo: "Nintendo",
  playstation: "PlayStation",
  xbox: "Xbox",
  pc: "PC",
  sega: "Sega",
  mobile: "mobile",
  arcade: "borne d'arcade",
};
const PLATFORM_FAMILY = new Map();
for (const [fam, ids] of Object.entries(FAMILIES)) for (const id of ids) PLATFORM_FAMILY.set(id, fam);

// Thèmes IGDB gardés pour les objectifs (« Action » dit tout et rien).
export const THEMES = {
  17: "Fantasy",
  18: "Science-fiction",
  19: "Horreur",
  22: "Historique",
  38: "Monde ouvert",
  21: "Survie",
  43: "Mystère",
  39: "Guerre",
  27: "Comédie",
  23: "Infiltration",
  33: "Bac à sable",
  40: "Jeu de soirée",
};
// Modes (le solo, c'est presque tout le monde : pas un défi).
export const MODES = { 2: "Multijoueur", 3: "Coop", 4: "Écran partagé" };
// Perspectives.
export const PERSP = { 1: "Vue subjective", 4: "Vue de côté", 3: "Vue du dessus" };

// Les tags : des mots-clés IGDB (en anglais, en vrac) rangés sous une poignée
// d'étiquettes françaises qu'un joueur reconnaît. L'ordre ne compte pas : un
// jeu peut en porter plusieurs.
export const TAGS = [
  { key: "zombies", label: "Zombies", re: /zombie|undead|walking dead/ },
  { key: "dragons", label: "Dragons", re: /dragon/ },
  { key: "vampires", label: "Vampires", re: /vampire/ },
  { key: "fantomes", label: "Fantômes", re: /ghost|haunt|poltergeist/ },
  { key: "squelettes", label: "Squelettes", re: /skeleton/ },
  { key: "aliens", label: "Aliens", re: /\baliens?\b|alien invasion|extraterrestrial|\bufos?\b/ },
  { key: "robots", label: "Robots", re: /robot|android|cyborg/ },
  { key: "mechas", label: "Méchas", re: /\bmechs?\b|\bmecha\b|giant robot/ },
  { key: "dinosaures", label: "Dinosaures", re: /dinosaur/ },
  { key: "pirates", label: "Pirates", re: /pirate/ },
  { key: "ninjas", label: "Ninjas", re: /ninja/ },
  { key: "samourais", label: "Samouraïs", re: /samurai|katana|ronin/ },
  { key: "vikings", label: "Vikings", re: /viking/ },
  { key: "farwest", label: "Far West", re: /cowboy|western|wild west/ },
  { key: "superheros", label: "Super-héros", re: /superhero|super hero|superpower/ },
  { key: "magie", label: "Magie", re: /\bmagic\b|wizard|sorcer|spellcast|\bspells?\b/ },
  { key: "dieux", label: "Dieux", re: /\bgods?\b|mythology|deit(y|ies)/ },
  { key: "espace", label: "Espace", re: /\bspace\b|spaceship|spacecraft|astronaut|galaxy/ },
  { key: "temps", label: "Voyage dans le temps", re: /time travel|time manipulation|time loop/ },
  { key: "postapo", label: "Post-apo", re: /post-apocalyp|apocalypse|nuclear war|wasteland/ },
  { key: "cyberpunk", label: "Cyberpunk", re: /cyberpunk/ },
  { key: "steampunk", label: "Steampunk", re: /steampunk/ },
  { key: "medieval", label: "Médiéval", re: /medieval|\bknights?\b|castle/ },
  { key: "ww2", label: "Seconde Guerre mondiale", re: /world war ii|\bww2\b|\bwwii\b|nazi/ },
  { key: "militaire", label: "Militaire", re: /military|modern warfare|soldier/ },
  { key: "anime", label: "Anime", re: /\banime\b|manga/ },
  { key: "heroine", label: "Héroïne", re: /female protagonist/ },
  { key: "boss", label: "Boss", re: /boss fight|boss battle/ },
  { key: "martial", label: "Arts martiaux", re: /martial arts|kung[ -]fu|karate/ },
  { key: "detective", label: "Détective", re: /detective|investigation|crime scene/ },
  { key: "mafia", label: "Mafia", re: /mafia|organized crime|gangster|yakuza|mob boss|heist/ },
  { key: "chats", label: "Chats", re: /\bcats?\b|kitten/ },
  { key: "chiens", label: "Chiens", re: /\bdogs?\b|pupp(y|ies)/ },
  { key: "chevaux", label: "Chevaux", re: /\bhorses?\b|horseback/ },
  { key: "animaux", label: "Animaux qui parlent", re: /talking animals|anthropomorph/ },
  { key: "sousleau", label: "Sous l'eau", re: /underwater|submarine|scuba/ },
  { key: "neige", label: "Neige", re: /\bsnow|ice stage|winter/ },
  { key: "tanks", label: "Tanks", re: /\btanks?\b/ },
  { key: "avions", label: "Avions", re: /airplane|aircraft|fighter jet|dogfight|biplane|air combat/ },
  { key: "helicos", label: "Hélicoptères", re: /helicopter/ },
  { key: "motos", label: "Motos", re: /motorcycle|motorbike|motocross/ },
  { key: "foot", label: "Football", re: /soccer|\bfootball\b/ },
  { key: "pixelart", label: "Pixel art", re: /pixel art|pixel graphics|\b8-bit|\b16-bit/ },
  { key: "roguelike", label: "Roguelike", re: /rogue-?li(ke|te)/ },
  { key: "metroidvania", label: "Metroidvania", re: /metroidvania/ },
  { key: "craft", label: "Craft", re: /crafting|resource gathering/ },
  { key: "tpt", label: "Tour par tour", re: /turn-based/ },
  { key: "shmup", label: "Shoot'em up", re: /shoot 'em up|shmup|bullet hell/ },
  { key: "fins", label: "Fins multiples", re: /multiple endings|branching storyline/ },
  { key: "choix", label: "Choix moraux", re: /moral decision|moral choice|karma/ },
  { key: "grappin", label: "Grappin", re: /grappl/ },
  { key: "teleport", label: "Téléportation", re: /teleport/ },
  { key: "gravite", label: "Gravité", re: /gravity/ },
  { key: "princesse", label: "Princesse", re: /princess|damsel in distress/ },
  { key: "assassins", label: "Assassins", re: /assassin/ },
  { key: "egypte", label: "Égypte", re: /egypt|pharaoh|mumm(y|ies)/ },
  { key: "dystopie", label: "Dystopie", re: /dystopi/ },
  { key: "hacking", label: "Hacking", re: /hacking|hacker/ },
  { key: "film", label: "Tiré d'un film", re: /based on - movie|movie tie-in/ },
  { key: "comics", label: "Comics", re: /based on - comics|comic book/ },
  { key: "cuisine", label: "Cuisine", re: /cooking|\bchef\b|restaurant/ },
  { key: "peche", label: "Pêche", re: /fishing/ },
  { key: "ferme", label: "Ferme", re: /farming|\bfarm\b/ },
  { key: "journuit", label: "Jour et nuit", re: /day\/night|day-night|day and night/ },
  { key: "procedural", label: "Génération procédurale", re: /procedural/ },
  { key: "permadeath", label: "Mort permanente", re: /permadeath|permanent death/ },
  { key: "qte", label: "QTE", re: /quick time event/ },
  { key: "arc", label: "Arc et flèches", re: /bow and arrow|archery|crossbow/ },
];
export const TAG_LABEL = Object.fromEntries(TAGS.map((t) => [t.key, t.label]));

/** Les étiquettes (clés) qu'un mot-clé IGDB allume. */
export function tagsForKeyword(name) {
  const s = String(name || "").toLowerCase();
  const out = [];
  for (const t of TAGS) if (t.re.test(s)) out.push(t.key);
  return out;
}

/**
 * Les faits cachés d'un jeu (GameFeatures), prêts pour les objectifs.
 * `kwTags` : Map id de mot-clé → clés d'étiquettes.
 */
export function buildFacts(g, kwTags) {
  const fam = new Set();
  for (const p of g.platforms || []) {
    const f = PLATFORM_FAMILY.get(p);
    if (f) fam.add(f);
  }
  const tags = new Set();
  for (const k of g.keywords || []) for (const t of kwTags.get(k) || []) tags.add(t);
  return {
    year: g.date ? new Date(g.date * 1000).getUTCFullYear() : null,
    fam: [...fam],
    themes: (g.themes || []).filter((t) => THEMES[t]),
    modes: (g.modes || []).filter((m) => MODES[m]),
    persp: (g.persp || []).filter((p) => PERSP[p]),
    tags: [...tags],
  };
}
