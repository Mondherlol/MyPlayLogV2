// ======================================================================
//  Les tops officiels, habillés — la couleur et le visuel de chaque carte
// ======================================================================
// Un top officiel (« Top 100 des meilleurs jeux Switch ») n'est pas une liste
// de joueur : sa carte a son propre aplat de couleur et, à droite du titre, ce
// qui le dit d'un coup d'œil — la console détourée, ou le héros de la saga.
//
// `art` : un PNG détouré dans /public/tops/<clé>.webp (consoles : photos
// Evan-Amos du domaine public ; héros : rendus officiels repris de Wikipédia).
// Sans `art`, la carte montre ses trois premières jaquettes en éventail — c'est
// voulu pour les genres, où aucune image seule ne résume tout.
//
// Les tops THÈMES (enquête, jeux drôles…) ont une icône à la place : un
// emoji Twemoji en SVG (/public/tops/<clé>.svg, CC-BY 4.0), une loupe pour
// l'enquête, une fusée pour l'espace — `icon: true`, posé un peu plus petit.
//
// ⚠️ LES IMAGES SONT RECADRÉES AU PIXEL PRÈS (plus aucune marge vide autour du
// sujet) : c'est ce qui les aligne toutes sur le même coin de la carte.
//
// ⚠️ LA CLÉ EST CELLE DU SERVEUR (server/src/data/officialLists/*.js,
// `official.key`). Un top ajouté là-bas sans entrée ici prend une couleur de
// la palette par défaut et l'éventail : il reste présentable.

const ART = new Set([
  "top-3ds", "top-assassins-creed", "top-atelier", "top-castlevania", "top-crash",
  "top-danganronpa", "top-devil-may-cry", "top-donkey-kong", "top-dragon-ball",
  "top-dragon-quest", "top-dreamcast", "top-ds", "top-fallout", "top-final-fantasy",
  "top-fire-emblem", "top-gameboy", "top-gamecube", "top-gba", "top-god-of-war", "top-gta",
  "top-halo", "top-kingdom-hearts", "top-kirby", "top-mario", "top-mega-man",
  "top-megadrive", "top-metal-gear", "top-metal-slug", "top-metroid", "top-monster-hunter",
  "top-mortal-kombat", "top-n64", "top-nes", "top-persona", "top-pokemon",
  "top-professor-layton", "top-ps1", "top-ps2", "top-ps3", "top-ps4", "top-ps5", "top-psp",
  "top-ratchet", "top-resident-evil", "top-saturn", "top-silent-hill", "top-smt",
  "top-snes", "top-sonic", "top-star-wars", "top-street-fighter", "top-suikoden",
  "top-switch", "top-tekken", "top-tomb-raider", "top-touhou", "top-trails",
  "top-uncharted", "top-vita", "top-wii", "top-wiiu", "top-xbox", "top-xbox360",
  "top-xeno", "top-yakuza", "top-ys", "top-zelda",
]);

// Une icône (SVG) plutôt qu'un personnage : les thèmes, les genres, et les
// sagas sans héros détourable (FromSoftware, Tales of, Elder Scrolls…).
const ICONS = new Set([
  "top-ace-attorney", "top-ace-attorney-like", "top-action-rpg", "top-art", "top-beatemup",
  "top-board", "top-character-action", "top-couch-coop", "top-cozy", "top-crpg",
  "top-detective", "top-elder-scrolls", "top-emotional", "top-escape", "top-fighting",
  "top-fps", "top-free-to-play", "top-fromsoftware", "top-funny", "top-gacha", "top-hard",
  "top-immersive-sim", "top-indie", "top-jrpg", "top-mana", "top-manga-anime",
  "top-mario-rpg", "top-metroidvania", "top-monster-collecting", "top-monster-hunting",
  "top-mystery-dungeon", "top-narrative", "top-open-world", "top-pc", "top-persona-like",
  "top-platformer", "top-point-and-click", "top-postapo", "top-puzzle", "top-racing",
  "top-remakes", "top-rhythm", "top-roguelike", "top-scary", "top-shmup", "top-short",
  "top-soulslike", "top-soundtrack", "top-space", "top-stealth", "top-survival-horror",
  "top-tactical-rpg", "top-tales-of", "top-visual-novel", "top-zelda-like",
]);

// Un aplat par top : la couleur de la console ou celle qu'on associe à la
// saga. Assez soutenue pour porter du texte blanc.
const COLORS = {
  "top-switch": "#e4202e",
  "top-ds": "#3d8fe0",
  "top-3ds": "#1ea5c7",
  "top-snes": "#6f5bd6",
  "top-n64": "#1f9d55",
  "top-gamecube": "#6a4fc9",
  "top-wii": "#3aa7ee",
  "top-wiiu": "#1a9fd6",
  "top-gba": "#7b5ce0",
  "top-gameboy": "#6f9a1b",
  "top-nes": "#d7263d",
  "top-megadrive": "#2457d6",
  "top-saturn": "#3565c8",
  "top-dreamcast": "#f06a1d",
  "top-xbox": "#2f9e44",
  "top-xbox360": "#56a51c",
  "top-pc": "#4b5563",
  "top-ps1": "#5a6378",
  "top-ps2": "#2451c6",
  "top-ps3": "#2d3f8f",
  "top-ps4": "#1f5fd1",
  "top-ps5": "#2b6de8",
  "top-psp": "#3f3f46",
  "top-vita": "#1f4fbf",

  "top-zelda": "#2e8b57",
  "top-mario": "#e52521",
  "top-final-fantasy": "#3553c9",
  "top-pokemon": "#e3350d",
  "top-metroid": "#ea6a12",
  "top-resident-evil": "#8e1b1b",
  "top-castlevania": "#5b21b6",
  "top-dragon-quest": "#2f80ed",
  "top-kingdom-hearts": "#2745a8",
  "top-sonic": "#1d5fd8",
  "top-yakuza": "#b91c1c",
  "top-fromsoftware": "#57534e",
  "top-fire-emblem": "#1e40af",
  "top-kirby": "#ec5f9f",
  "top-metal-gear": "#4d6b1f",
  "top-street-fighter": "#e0561b",
  "top-tales-of": "#0e7490",
  "top-mega-man": "#0c93d6",
  "top-silent-hill": "#5c5552",
  "top-touhou": "#d8263a",
  "top-trails": "#0f766e",
  "top-persona": "#e11d48",
  "top-smt": "#44403c",
  "top-xeno": "#0284c7",
  "top-ys": "#b45309",
  "top-ace-attorney": "#1d4ed8",
  "top-danganronpa": "#db2777",
  "top-professor-layton": "#9a4a14",
  "top-monster-hunter": "#a16207",
  "top-donkey-kong": "#b8621b",
  "top-mario-rpg": "#e11d48",
  "top-mana": "#15803d",
  "top-suikoden": "#8a2c12",
  "top-atelier": "#d9591c",
  "top-god-of-war": "#991b1b",
  "top-uncharted": "#a66a10",
  "top-ratchet": "#e0620f",
  "top-crash": "#f07316",
  "top-halo": "#4d7c0f",
  "top-devil-may-cry": "#9f1239",
  "top-tomb-raider": "#0f766e",
  "top-assassins-creed": "#4b5563",
  "top-gta": "#16a34a",
  "top-elder-scrolls": "#57534e",
  "top-fallout": "#1d56c4",
  "top-tekken": "#b91c1c",
  "top-mortal-kombat": "#b45309",
  "top-dragon-ball": "#f07316",
  "top-star-wars": "#27272f",
  "top-metal-slug": "#5f8f10",

  "top-detective": "#2c5f8a",
  "top-funny": "#f08c00",
  "top-emotional": "#3d7fd6",
  "top-narrative": "#8a4b2e",
  "top-scary": "#4c2a7a",
  "top-couch-coop": "#e0561b",
  "top-short": "#0e9384",
  "top-hard": "#8e1b1b",
  "top-art": "#d6336c",
  "top-soundtrack": "#7048e8",
  "top-space": "#1b2a5e",
  "top-postapo": "#6b7d1f",
  "top-remakes": "#0b7285",
  "top-escape": "#5f3dc4",
  "top-board": "#2b8a3e",
  "top-free-to-play": "#1971c2",
  "top-gacha": "#c2255c",

  "top-platformer": "#e03131",
  "top-metroidvania": "#5f3dc4",
  "top-jrpg": "#1c7ed6",
  "top-roguelike": "#0c8599",
  "top-soulslike": "#5c4033",
  "top-survival-horror": "#5c1a1a",
  "top-visual-novel": "#d6336c",
  "top-fighting": "#e8590c",
  "top-shmup": "#364fc7",
  "top-beatemup": "#c92a2a",
  "top-mystery-dungeon": "#7048e8",
  "top-manga-anime": "#f03e3e",
  "top-persona-like": "#c2255c",
  "top-ace-attorney-like": "#1864ab",
  "top-point-and-click": "#2f9e44",
  "top-tactical-rpg": "#495057",
  "top-monster-hunting": "#a16207",
  "top-monster-collecting": "#f59f00",
  "top-open-world": "#2b8a3e",
  "top-stealth": "#343a40",
  "top-rhythm": "#ae3ec9",
  "top-puzzle": "#1098ad",
  "top-fps": "#c92a2a",
  "top-zelda-like": "#2e8b57",
  "top-cozy": "#66a80f",
  "top-crpg": "#8a4b2e",
  "top-racing": "#e03131",
  "top-indie": "#f08c00",
  "top-immersive-sim": "#3b5bdb",
  "top-action-rpg": "#9c36b5",
  "top-character-action": "#e8590c",
};

// Les tops sans couleur attitrée (les genres, surtout) : une teinte de cette
// palette, toujours la même pour un même top.
const FALLBACK = ["#3aa7ee", "#2f9e44", "#6f5bd6", "#e0561b", "#0e7490", "#db2777", "#2457d6", "#b45309"];

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * `{ color, art, icon }` d'un top officiel — `art` null : l'éventail de
 * jaquettes ; `icon` : l'image est une icône de thème, pas un personnage.
 */
export function topTheme(key) {
  const k = String(key || "");
  const icon = ICONS.has(k);
  return {
    color: COLORS[k] || FALLBACK[hash(k) % FALLBACK.length],
    art: icon ? `/tops/${k}.svg` : ART.has(k) ? `/tops/${k}.webp` : null,
    icon,
  };
}

/**
 * « Top 100 des meilleurs jeux Switch » → { n: 100, subject: "Jeux Switch" }.
 * « Les 25 meilleurs Zelda » → { n: 25, subject: "Zelda" }. Un titre qui ne
 * suit aucune des deux formes est rendu tel quel, sans nombre.
 */
export function splitTopTitle(title, fallbackN = null) {
  const t = String(title || "").trim();
  // « Top 50 des jeux les plus drôles » → « Jeux les plus drôles ».
  const m =
    t.match(/^top\s+(\d+)\s+des\s+meilleur(?:e?s)\s+(.+)$/i) ||
    t.match(/^les\s+(\d+)\s+meilleur(?:e?s)\s+(.+)$/i) ||
    t.match(/^top\s+(\d+)\s+des\s+(.+)$/i);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // La parenthèse du titre complet (« RPG Mario (Paper Mario, Mario &
  // Luigi…) ») précise la liste, pas l'affiche : elle y serait coupée.
  if (m) return { n: Number(m[1]), subject: cap(m[2].replace(/\s*\([^)]*\)\s*$/, "")) };
  return { n: fallbackN, subject: t };
}
