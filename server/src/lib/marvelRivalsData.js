// Données statiques Marvel Rivals (héros + rangs) — indispensables pour la
// source rivalsmeta.com, qui renvoie des `hero_id` numériques et des rangs sous
// forme de niveaux (pas de noms ni d'images inline). Marvel Rivals API v2, elle,
// fournit déjà noms/images/tiers ; ce module ne sert donc qu'à enrichir les
// données brutes de rivalsmeta.
//
// Table héros : source communautaire tenue à jour (github RegularLunar/
// MR-Character-IDS). À compléter à chaque nouvelle saison.

export const HERO_NAMES = {
  1011: "Hulk",
  1014: "The Punisher",
  1015: "Storm",
  1016: "Loki",
  1017: "Human Torch",
  1018: "Doctor Strange",
  1020: "Mantis",
  1021: "Hawkeye",
  1022: "Captain America",
  1023: "Rocket Raccoon",
  1024: "Hela",
  1025: "Cloak & Dagger",
  1026: "Black Panther",
  1027: "Groot",
  1028: "Ultron",
  1029: "Magik",
  1030: "Moon Knight",
  1031: "Luna Snow",
  1032: "Squirrel Girl",
  1033: "Black Widow",
  1034: "Iron Man",
  1035: "Venom",
  1036: "Spider-Man",
  1037: "Magneto",
  1038: "Scarlet Witch",
  1039: "Thor",
  1040: "Mister Fantastic",
  1041: "Winter Soldier",
  1042: "Peni Parker",
  1043: "Star-Lord",
  1044: "Blade",
  1045: "Namor",
  1046: "Adam Warlock",
  1047: "Jeff the Land Shark",
  1048: "Psylocke",
  1049: "Wolverine",
  1050: "Invisible Woman",
  1051: "The Thing",
  1052: "Iron Fist",
  1053: "Emma Frost",
  1054: "Phoenix",
  1055: "Angela",
  1056: "Daredevil",
  1057: "Deadpool",
  1058: "Gambit",
  1059: "Elsa Bloodstone",
  1060: "White Fox",
  1061: "Black Cat",
  1065: "Rogue",
};

// Portrait carré du héros (page joueur rivalsmeta). Format d'URL stable :
// /images/heroes/SelectHero/img_selecthero_{heroId}001.png
export function heroThumb(heroId) {
  if (!heroId) return null;
  return `https://rivalsmeta.com/images/heroes/SelectHero/img_selecthero_${heroId}001.png`;
}

export function heroInfo(heroId) {
  const id = Number(heroId);
  return {
    id,
    name: HERO_NAMES[id] || `Héros #${id}`,
    thumb: heroThumb(id),
  };
}

// --- Rangs ---------------------------------------------------------------
// Marvel Rivals encode le rang par un `level` numérique croissant : chaque tier
// (hors sommet) a 3 divisions (III, II, I). level 1 = Bronze III … level 16 =
// Grandmaster III (vérifié sur des données réelles). Les tiers « apex »
// (Eternity, One Above All) n'ont pas de division.
const RANK_TIERS = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Grandmaster",
  "Celestial",
  "Eternity",
  "One Above All",
];
const APEX_FROM = 7; // Eternity et au-delà : pas de division affichée.

function tierIndex(level) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1) return -1;
  return Math.min(Math.floor((lvl - 1) / 3), RANK_TIERS.length - 1);
}

export function rankLabel(level) {
  const idx = tierIndex(level);
  if (idx < 0) return null;
  const tier = RANK_TIERS[idx];
  if (idx >= APEX_FROM) return tier;
  const division = 3 - ((Number(level) - 1) % 3); // 3 → 2 → 1
  return `${tier} ${division}`;
}

// Badge de rang (rivalsmeta) : /images/DanIcon/img_rank_dan_{NN}.png où NN =
// index du tier + 1 (Bronze=01, Silver=02, … Grandmaster=06, … One Above All=09).
export function rankImage(level) {
  const idx = tierIndex(level);
  if (idx < 0) return null;
  const dan = String(idx + 1).padStart(2, "0");
  return `https://rivalsmeta.com/images/DanIcon/img_rank_dan_${dan}.png`;
}

// Modes de jeu (game_mode_id rivalsmeta) — best-effort, libellé null si inconnu.
export const GAME_MODES = {
  0: "Match rapide",
  1: "Match rapide",
  2: "Compétitif",
  3: "Personnalisée",
  6: "Conquête",
  7: "Entraînement",
};

// Saisons rivalsmeta (valeur du <select> → libellé affiché). Le numéro interne
// diffère du libellé (value 18 = « Season 9 », courante). À compléter à chaque
// nouvelle saison.
export const SEASONS = [
  { value: 18, label: "Season 9" },
  { value: 17, label: "Season 8.5" },
  { value: 16, label: "Season 8" },
  { value: 15, label: "Season 7.5" },
  { value: 14, label: "Season 7" },
  { value: 13, label: "Season 6.5" },
  { value: 12, label: "Season 6" },
  { value: 11, label: "Season 5.5" },
  { value: 10, label: "Season 5" },
  { value: 9, label: "Season 4.5" },
  { value: 8, label: "Season 4" },
  { value: 7, label: "Season 3.5" },
  { value: 6, label: "Season 3" },
  { value: 5, label: "Season 2.5" },
  { value: 4, label: "Season 2" },
  { value: 3, label: "Season 1.5" },
  { value: 2, label: "Season 1" },
  { value: 1, label: "Season 0" },
];
export const CURRENT_SEASON_VALUE = 18;
export const seasonLabel = (v) =>
  SEASONS.find((s) => s.value === Number(v))?.label || null;

// Table des maps (match_map_id → { n: nom, i: slug d'image, q: file/queue }).
// Un même lieu a plusieurs ids (map × mode × file) ; l'id encode donc aussi la
// file (rapide / classée / arcade / événement). Table extraite du front
// rivalsmeta (chunk joueur) ; le détail dégrade proprement si un id est inconnu.
// q ∈ { quick, comp, arcade, event } ; le nom d'image sert à construire l'URL
// de la vignette carrousel. À compléter à chaque nouvelle saison.
export const MAP_META = {
  1032: { n: "Yggsgard", i: "img_map_yggdrasil", q: "quick" },
  1034: { n: "Tokyo 2099", i: "img_map_tokyowebworld_metropolis", q: "quick" },
  1101: { n: "Intergalactic Empire of Wakanda", i: "img_map_hallofdialia", q: "quick" },
  1118: { n: "Empire of Eternal Night", i: "img_map_sanctumsanctorum", q: "arcade" },
  1148: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "quick" },
  1154: { n: "Yggsgard", i: "img_map_archive", q: "quick" },
  1155: { n: "Yggsgard", i: "img_map_yggdrasil_garden", q: "quick" },
  1156: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "quick" },
  1161: { n: "Intergalactic Empire of Wakanda", i: "img_map_golden_city", q: "quick" },
  1162: { n: "Intergalactic Empire of Wakanda", i: "img_map_wakanda", q: "quick" },
  1169: { n: "Intergalactic Empire of Wakanda", i: "img_map_goldencitywarriorfalls", q: "quick" },
  1170: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "quick" },
  1201: { n: "Empire of Eternal Night", i: "img_map_midtown", q: "quick" },
  1217: { n: "Empire of Eternal Night", i: "img_map_centralpark", q: "quick" },
  1230: { n: "Tokyo 2099", i: "img_map_tokyowebworld_metropolis", q: "comp" },
  1231: { n: "Yggsgard", i: "img_map_yggdrasil", q: "comp" },
  1235: { n: "Intergalactic Empire of Wakanda", i: "img_map_practicerance", q: "quick" },
  1236: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "comp" },
  1240: { n: "Klyntar", i: "img_map_klyntar_ruins", q: "quick" },
  1243: { n: "Hydra Charteris Base", i: "img_map_hydraerebusbase", q: "quick" },
  1244: { n: "Hydra Charteris Base", i: "img_map_practicerance", q: "quick" },
  1245: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "comp" },
  1246: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "arcade" },
  1254: { n: "Yggsgard", i: "img_map_yggdrasil_garden", q: "event" },
  1267: { n: "Intergalactic Empire of Wakanda", i: "img_map_hallofdialia", q: "comp" },
  1272: { n: "Intergalactic Empire of Wakanda", i: "img_map_practicerance", q: "comp" },
  1273: { n: "Hellfire Gala", i: "img_map_krakoa_grove", q: "quick" },
  1281: { n: "Hellfire Gala", i: "img_map_krakoa_carousel", q: "quick" },
  1286: { n: "Hellfire Gala", i: "img_map_hellfiregala_arakko", q: "quick" },
  1287: { n: "Hydra Charteris Base", i: "img_map_hydracharterisbase", q: "quick" },
  1288: { n: "Hydra Charteris Base", i: "img_map_hydracharterisbase", q: "comp" },
  1290: { n: "Klyntar", i: "img_map_klyntar_ruins", q: "comp" },
  1291: { n: "Empire of Eternal Night", i: "img_map_midtown", q: "comp" },
  1292: { n: "Empire of Eternal Night", i: "img_map_centralpark", q: "comp" },
  1294: { n: "Klyntar", i: "img_map_thorny_jungle", q: "quick" },
  1295: { n: "Klyntar", i: "img_map_celestial_heart", q: "quick" },
  1296: { n: "Klyntar", i: "img_map_celestial_hand", q: "quick" },
  1302: { n: "Intergalactic Empire of Wakanda", i: "img_map_practicerance", q: "arcade" },
  1304: { n: "Hellfire Gala", i: "img_map_krakoa_cradle", q: "quick" },
  1307: { n: "Klyntar", i: "img_map_klyntar_abyssthrone", q: "quick" },
  1309: { n: "Hellfire Gala", i: "img_map_krakoa_carousel", q: "quick" },
  1310: { n: "Hellfire Gala", i: "img_map_krakoa_carousel", q: "comp" },
  1311: { n: "Hellfire Gala", i: "img_map_hellfiregala_arakko", q: "comp" },
  1312: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "arcade" },
  1313: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "arcade" },
  1314: { n: "Age of Ultron", i: "", q: "quick" },
  1317: { n: "Klyntar", i: "img_map_celestial_heart", q: "quick" },
  1318: { n: "Klyntar", i: "img_map_celestial_heart", q: "comp" },
  1320: { n: "Klyntar", i: "img_map_klyntar_abyssthrone", q: "comp" },
  1321: { n: "Yggsgard", i: "img_map_archive", q: "arcade" },
  1322: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "arcade" },
  1371: { n: "Hellfire Gala", i: "img_map_krakoa_carousel", q: "arcade" },
  1373: { n: "Yggsgard", i: "img_map_yggdrasil_garden", q: "arcade" },
  1374: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "arcade" },
  1375: { n: "Hellfire Gala", i: "img_map_krakoa_grove", q: "arcade" },
  1376: { n: "Intergalactic Empire of Wakanda", i: "img_map_golden_city", q: "arcade" },
  1377: { n: "Intergalactic Empire of Wakanda", i: "img_map_wakanda", q: "arcade" },
  1378: { n: "Klyntar", i: "img_map_thorny_jungle", q: "arcade" },
  1379: { n: "Klyntar", i: "img_map_celestial_heart", q: "arcade" },
  1380: { n: "Klyntar", i: "img_map_celestial_hand", q: "arcade" },
  1381: { n: "Intergalactic Empire of Wakanda", i: "img_map_goldencitywarriorfalls", q: "arcade" },
  1382: { n: "Hellfire Gala", i: "img_map_krakoa_cradle", q: "arcade" },
  1383: { n: "Hydra Charteris Base", i: "img_map_hydrabase_altar", q: "arcade" },
  1384: { n: "Hydra Charteris Base", i: "img_map_hydraerebusbase", q: "arcade" },
  1385: { n: "Hydra Charteris Base", i: "img_map_hydrabase_arsenal", q: "arcade" },
  1388: { n: "Tokyo 2099", i: "img_map_tokyowebworld_metropolis", q: "arcade" },
  1389: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "arcade" },
  1391: { n: "Intergalactic Empire of Wakanda", i: "img_map_practicerance", q: "arcade" },
  1392: { n: "Hydra Charteris Base", i: "img_map_hydracharterisbase", q: "arcade" },
  1393: { n: "Klyntar", i: "img_map_klyntar_ruins", q: "arcade" },
  1394: { n: "Empire of Eternal Night", i: "img_map_midtown", q: "arcade" },
  1395: { n: "Empire of Eternal Night", i: "img_map_centralpark", q: "arcade" },
  1396: { n: "Hellfire Gala", i: "img_map_krakoa_carousel", q: "arcade" },
  1397: { n: "Hellfire Gala", i: "img_map_hellfiregala_arakko", q: "arcade" },
  1398: { n: "Klyntar", i: "img_map_celestial_heart", q: "arcade" },
  1399: { n: "Grand Garden", i: "img_map_grandgarden", q: "arcade" },
  1400: { n: "Yggsgard", i: "img_map_yggdrasil", q: "arcade" },
  1401: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "arcade" },
  1402: { n: "Intergalactic Empire of Wakanda", i: "img_map_hallofdialia", q: "arcade" },
  1403: { n: "Midtown", i: "img_map_midtown", q: "event" },
  1404: { n: "K'un-Lun", i: "img_map_kunlun_heartoftiandu", q: "arcade" },
  1405: { n: "Midtown", i: "img_map_midtown", q: "event" },
  1406: { n: "Museum of Contemplation", i: "img_map_practicerance", q: "arcade" },
  1408: { n: "Jeffland", i: "img_map_jeffland", q: "event" },
  1411: { n: "Lower Manhattan", i: "img_map_kunlun_heartoftiandu", q: "quick" },
  1413: { n: "Museum of Contemplation", i: "img_map_museum_collectorpark", q: "quick" },
  1418: { n: "Museum of Contemplation", i: "img_map_museum_collectorpark", q: "comp" },
  1425: { n: "Yggsgard", i: "img_map_yggdrasil_throne", q: "event" },
  1426: { n: "Intergalactic Empire of Wakanda", i: "img_map_practicerance", q: "event" },
  1427: { n: "Hydra Charteris Base", i: "img_map_hydracharterisbase", q: "event" },
  1428: { n: "Klyntar", i: "img_map_klyntar_ruins", q: "event" },
  1429: { n: "Hellfire Gala", i: "img_map_hellfiregala_arakko", q: "event" },
  2041: { n: "K'un-Lun", i: "img_map_kunlun_heartoftiandu", q: "quick" },
  2042: { n: "K'un-Lun", i: "img_map_kunlun_heartoftiandu", q: "comp" },
  2100: { n: "Tokyo 2099", i: "img_map_tokyowebworld_spiderisland", q: "event" },
};

// Vignette carrousel d'une map (URL _ipx rivalsmeta, redimensionnée/optimisée).
export function mapImage(id) {
  const slug = MAP_META[Number(id)]?.i;
  return slug ? `https://rivalsmeta.com/_ipx/w_125&q_70/images/Map/${slug}.png` : null;
}
export const mapName = (id) => MAP_META[Number(id)]?.n || null;

// File réelle d'une partie. La map SEULE ne suffit pas : une partie perso peut se
// jouer sur une map « classée » (l'id de map encode une file par défaut, alors
// fausse — c'est ce qui faisait passer les customs pour des classées). On se fie
// donc d'abord au mode rivalsmeta : game_mode_id 1 = rapide, 2 = classée, 3 =
// perso, 6 = conquête ; play_mode_id 1 confirme le lobby perso. La map ne sert
// plus qu'à distinguer arcade / événement au sein d'une partie rapide.
export function matchQueue(gameModeId, playModeId, mapId) {
  const g = Number(gameModeId);
  const p = Number(playModeId);
  if (p === 1 || g === 3) return "custom";
  if (g === 2) return "comp";
  if (g === 6 || g === 7) return "arcade";
  const mq = MAP_META[Number(mapId)]?.q;
  if (g === 1 || g === 0) return mq === "arcade" || mq === "event" ? mq : "quick";
  return mq || "quick";
}
