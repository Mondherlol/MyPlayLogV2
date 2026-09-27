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
  "top-3ds", "top-ace-attorney", "top-animal-crossing", "top-arcade-classics",
  "top-assassins-creed", "top-atelier", "top-bayonetta", "top-bioshock", "top-bioware",
  "top-blizzard", "top-borderlands", "top-castlevania", "top-crash", "top-danganronpa",
  "top-devil-may-cry", "top-disgaea", "top-donkey-kong", "top-dragon-ball",
  "top-dragon-quest", "top-dreamcast", "top-ds", "top-elder-scrolls", "top-fallout",
  "top-final-fantasy", "top-fire-emblem", "top-fromsoftware", "top-gacha", "top-gameboy",
  "top-gamecube", "top-gba", "top-gears", "top-god-of-war", "top-gta", "top-halo",
  "top-id-software", "top-jak-sly", "top-kingdom-hearts", "top-kirby", "top-mana",
  "top-mario", "top-mario-kart", "top-mega-man", "top-megadrive", "top-metal-gear",
  "top-metal-slug", "top-metroid", "top-monster-hunter", "top-mortal-kombat", "top-n64",
  "top-nes", "top-nier", "top-nintendo-others", "top-persona", "top-pokemon",
  "top-prince-of-persia", "top-professor-layton", "top-ps1", "top-ps2", "top-ps3",
  "top-ps4", "top-ps5", "top-psp", "top-ratchet", "top-rayman", "top-resident-evil",
  "top-saturn", "top-silent-hill", "top-smt", "top-snes", "top-sonic", "top-spyro",
  "top-star-wars", "top-street-fighter", "top-suikoden", "top-switch", "top-tales-of",
  "top-tekken", "top-tomb-raider", "top-touhou", "top-trails", "top-uncharted",
  "top-valve", "top-vita", "top-wii", "top-wiiu", "top-xbox", "top-xbox360", "top-xeno",
  "top-yakuza", "top-ys", "top-zelda",
]);

// Une icône (SVG) plutôt qu'un personnage — SEULEMENT pour la courte liste
// retenue (enquête, drôles, espace…). Ailleurs, pas d'emoji : un visuel
// détouré, ou à défaut l'éventail de jaquettes.
const ICONS = new Set([
  "top-art", "top-beatemup", "top-board", "top-detective", "top-fighting", "top-funny",
  "top-hard", "top-monster-collecting", "top-postapo", "top-remakes", "top-scary",
  "top-short", "top-soundtrack", "top-space", "top-stealth", "top-visual-novel",
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
  "top-deduction": "#1864ab",
  "top-sims-like": "#37b24d",
  "top-simulators": "#1c7ed6",
  "top-parkour": "#e8590c",
  "top-survival": "#5c7f2a",
  "top-city-builder": "#1c7ed6",
  "top-strategy": "#7a5c2e",
  "top-sports": "#2b8a3e",
  "top-superheroes": "#c92a2a",
  "top-samurai": "#a61e4d",
  "top-pirates": "#1b4f72",
  "top-mechas": "#495057",
  "top-western": "#b0632b",
  "top-zombies": "#5c6b2a",
  "top-call-of-duty": "#3f4a3c",
  "top-battlefield": "#d9480f",
  "top-far-cry": "#e67700",
  "top-borderlands": "#f59f00",
  "top-bioshock": "#1f6f78",
  "top-bioware": "#343a40",
  "top-witcher": "#6b1d1d",
  "top-batman": "#212529",
  "top-spider-man": "#c92a2a",
  "top-hitman": "#a61e2d",
  "top-splinter-cell": "#2f5130",
  "top-prince-of-persia": "#b7791f",
  "top-rayman": "#7048e8",
  "top-spyro": "#7b3fb5",
  "top-jak-sly": "#1971c2",
  "top-mario-kart": "#e03131",
  "top-smash": "#c92a2a",
  "top-animal-crossing": "#40c057",
  "top-nintendo-others": "#0c8599",
  "top-yoshi-wario": "#37b24d",
  "top-mario-party": "#f76707",
  "top-bayonetta": "#5f3dc4",
  "top-fighting-sagas": "#e8590c",
  "top-gran-turismo-forza": "#1864ab",
  "top-nfs-burnout": "#f08c00",
  "top-tony-hawk": "#d6336c",
  "top-blizzard": "#1c4f9c",
  "top-civilization": "#8a6d1f",
  "top-total-war": "#8b2323",
  "top-age-of-empires": "#9c6b30",
  "top-xcom": "#1d4e89",
  "top-id-software": "#9b2c2c",
  "top-valve": "#e8590c",
  "top-gears": "#7a1f1f",
  "top-ace-combat": "#1b6ca8",
  "top-nier": "#6c757d",
  "top-disgaea": "#c2255c",
  "top-saga": "#7048e8",
  "top-star-ocean": "#1864ab",
  "top-breath-of-fire": "#c05621",
  "top-harvest-moon": "#66a80f",
  "top-lego": "#e8590c",
  "top-harry-potter": "#7b1f2e",
  "top-naruto-one-piece": "#f08c00",
  "top-musou": "#a61e4d",
  "top-dead-rising-onimusha": "#6b3a1f",
  "top-mafia-saints": "#5f3dc4",
  "top-arkane": "#3b3b58",
  "top-phantasy-star": "#1c7ed6",
  "top-arcade-classics": "#1c1c7a",
  "top-contra-metal": "#c92a2a",
};

// Les images coupées net en bas (un buste, un personnage sans ses pieds) :
// posées sur le bord bas de la carte, la coupe s'y confond. Centrées comme les
// autres, elles flottaient avec une tranche bien droite sous elles.
const BLEED = new Set([
  "top-elder-scrolls", "top-fromsoftware", "top-mortal-kombat", "top-star-wars", "top-bioware",
]);

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
    bleed: BLEED.has(k),
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
