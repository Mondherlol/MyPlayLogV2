// ======================================================================
//  Les personnages venus des sources OFFICIELLES du jeu
// ======================================================================
// ⚠️ IGDB EST UN CATALOGUE DE JEUX, PAS UN WIKI DE PERSONNAGES — ET ÇA SE VOIT
// PILE SUR LES JEUX AUXQUELS ON JOUE LE PLUS.
//
// Relevé fait sur les fiches réelles : Overwatch, 0 personnage. Valorant, 0.
// Marvel Rivals, 0. Elden Ring, 0. Pendant ce temps un visual novel obscur en
// aligne quarante avec portraits, parce que VNDB existe et qu'on s'y branche
// déjà. Le trou n'est pas aléatoire : les jeux-services n'ont pas de
// « personnages » au sens du catalogue, ils ont un ROSTER — et ce roster, leur
// éditeur le publie lui-même, illustré, à jour à chaque saison.
//
// C'est donc là qu'on va le chercher. Aucune de ces sources ne demande de clé,
// et les images sont les portraits officiels : rien de ce qu'on pourrait
// reconstituer ailleurs n'aurait cette tête-là.
//
// -------------------------------------------------------- le rattachement
// Par le NOM du jeu, pas par une recherche IGDB. La fiche connaît déjà son nom
// quand elle appelle ici : une table d'alias se lit, se corrige et ne coûte
// aucune requête, là où résoudre quatre jeux par recherche ferait payer huit
// appels IGDB à toutes les fiches du catalogue, y compris celles que ça ne
// concerne pas.

import { HERO_NAMES, heroThumb } from "./marvelRivalsData.js";
import { createTtlCache } from "./ttlCache.js";

// Les rosters bougent d'une saison à l'autre, pas d'une heure à l'autre.
const cache = createTtlCache({ max: 16, ttl: 24 * 3600_000, name: "game-characters" });

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// ----------------------------------------------------------------------
//  Valorant — l'API de contenu publique de Riot
// ----------------------------------------------------------------------
// La même que pour les actes (cf. lib/gameSeasons) : sans clé, et les visuels
// sont ceux du jeu.
async function valorantAgents() {
  const d = await getJson(
    "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=fr-FR"
  );
  return (d?.data || []).map((a) => ({
    key: a.uuid,
    name: a.displayName,
    image: a.displayIcon || a.bustPortrait || null,
  }));
}

// ----------------------------------------------------------------------
//  Overwatch — OverFast (miroir public de l'API Blizzard)
// ----------------------------------------------------------------------
async function overwatchHeroes() {
  const rows = await getJson("https://overfast-api.tekrop.fr/heroes");
  return (rows || []).map((h) => ({ key: h.key, name: h.name, image: h.portrait || null }));
}

// ----------------------------------------------------------------------
//  Marvel Rivals — la table qu'on a déjà
// ----------------------------------------------------------------------
// Zéro requête : les noms et les portraits des héros servent déjà aux écrans de
// suivi (cf. lib/marvelRivalsData). Le module qui les avait n'était pas celui
// qui en avait besoin, voilà tout.
async function marvelRivalsHeroes() {
  return Object.entries(HERO_NAMES).map(([id, name]) => ({
    key: id,
    name,
    image: heroThumb(id),
  }));
}

// ----------------------------------------------------------------------
//  League of Legends — Data Dragon
// ----------------------------------------------------------------------
// Le CDN officiel de Riot, versionné : on demande la dernière version publiée
// avant de lire le catalogue, sinon on sert les champions d'il y a deux ans.
async function lolChampions() {
  const versions = await getJson("https://ddragon.leagueoflegends.com/api/versions.json");
  const v = versions?.[0];
  if (!v) return [];
  const d = await getJson(`https://ddragon.leagueoflegends.com/cdn/${v}/data/fr_FR/champion.json`);
  return Object.values(d?.data || {}).map((c) => ({
    key: c.id,
    name: c.name,
    // L'écran de chargement plutôt que l'icône carrée : c'est un portrait, au
    // même format que les vignettes d'IGDB, et la grille reste régulière.
    image: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c.id}_0.jpg`,
  }));
}

// ----------------------------------------------------------------------
//  Dota 2 — les constantes publiques d'OpenDota
// ----------------------------------------------------------------------
// Sans clé ; les images sont celles du CDN de Steam (portrait paysage du héros).
async function dotaHeroes() {
  const d = await getJson("https://api.opendota.com/api/constants/heroes");
  return Object.values(d || {}).map((h) => ({
    key: h.id,
    name: h.localized_name,
    image: h.img ? `https://cdn.cloudflare.steamstatic.com${h.img.replace(/\?$/, "")}` : null,
  }));
}

// ----------------------------------------------------------------------
//  Super Smash Bros. Ultimate — les données du site officiel
// ----------------------------------------------------------------------
// Le site de Nintendo charge sa page des combattants depuis un JSON public :
// les 84 combattants numérotés (écho compris), nom localisé, et un fichier
// d'image par combattant. Le wiki, lui, mêlait la « Palette Swap », les
// « Mobs » et des doublons, et en ratait la moitié.
const SMASH = "https://www.smashbros.com/assets_v2";

// Les noms arrivent EN CAPITALES (« MR. GAME & WATCH »). Remis en casse de
// titre, sans casser les sigles (« R.O.B. ») ni les noms composés
// (« PAC-MAN » → « Pac-Man »).
const smashName = (s) =>
  String(s || "")
    // Le site coupe les noms longs avec un `<br>` pour sa mise en page.
    .replace(/\s*<br\s*\/?>\s*/gi, " ")
    .toLowerCase()
    .replace(/(^|[\s\-/(&])([\p{L}])/gu, (_, sep, c) => sep + c.toUpperCase())
    .replace(/\b((?:\p{L}\.){2,})/gu, (m) => m.toUpperCase())
    // « Dresseur de Pokémon », pas « Dresseur De Pokémon ».
    .replace(/ (De|Du|Des|La|Le|Les|Et) /g, (m) => m.toLowerCase());

async function smashFighters() {
  const d = await getJson(`${SMASH}/data/fighter.json`);
  return (d?.fighters || []).map((f) => ({
    key: f.file,
    name: smashName(f.displayName?.fr_FR || f.displayNameEn),
    // `thumb_a` : le visage, cadré serré — lisible en petite vignette.
    image: `${SMASH}/img/fighter/thumb_a/${f.file}.png`,
  }));
}

// ----------------------------------------------------------------------
//  Le registre
// ----------------------------------------------------------------------
// `names` : les noms IGDB du jeu, comparés à la casse et à la ponctuation près.
// Plusieurs par jeu quand le catalogue en tient plusieurs fiches (« Overwatch »
// et « Overwatch 2 » sont deux entrées, le roster est le même).
// `title` / `unit` : de quoi nommer la tier list du roster (cf. routes/lists,
// GET /suggest/tiers) — « Tier list des agents Valorant », « 28 agents à
// classer ».
export const PROVIDERS = [
  {
    slug: "valorant",
    names: ["Valorant"],
    fetch: valorantAgents,
    title: "Tier list des agents Valorant",
    unit: "agents",
  },
  {
    slug: "overwatch",
    names: ["Overwatch", "Overwatch 2"],
    fetch: overwatchHeroes,
    title: "Tier list des héros Overwatch",
    unit: "héros",
  },
  {
    slug: "marvel-rivals",
    names: ["Marvel Rivals"],
    fetch: marvelRivalsHeroes,
    title: "Tier list des héros Marvel Rivals",
    unit: "héros",
  },
  {
    slug: "league-of-legends",
    names: ["League of Legends"],
    fetch: lolChampions,
    title: "Tier list des champions de League of Legends",
    unit: "champions",
  },
  {
    slug: "smash-ultimate",
    names: ["Super Smash Bros. Ultimate"],
    fetch: smashFighters,
    title: "Tier list des combattants de Smash Ultimate",
    unit: "combattants",
  },
  {
    slug: "dota-2",
    names: ["Dota 2"],
    fetch: dotaHeroes,
    title: "Tier list des héros Dota 2",
    unit: "héros",
  },
];

const BY_NAME = new Map();
for (const p of PROVIDERS) for (const n of p.names) BY_NAME.set(norm(n), p);

/**
 * Le roster officiel du jeu, quand il en existe un.
 *
 * Rend un tableau vide pour tout le reste — c'est le cas courant, et ce n'est
 * pas une erreur : la fiche se rabat alors sur IGDB comme avant.
 */
export async function officialCharacters(gameName) {
  const provider = BY_NAME.get(norm(gameName));
  if (!provider) return [];

  try {
    const roster = await cache.remember(provider.slug, provider.fetch);
    return (roster || [])
      .filter((c) => c.name)
      .map((c) => ({
        // Préfixé par la source, comme les personnages IGDB (`igdb-…`) : deux
        // sources peuvent porter le même identifiant brut.
        id: `${provider.slug}-${c.key}`,
        name: c.name,
        image: c.image || null,
      }));
  } catch {
    // Source en panne : la fiche s'affiche avec ce qu'IGDB sait, comme avant.
    return [];
  }
}

/**
 * Le fournisseur de roster d'un jeu (`{ slug, title, unit }`), ou `null`.
 * Sert aux suggestions de tier lists : un jeu joué qui a un roster officiel
 * propose de classer ses personnages.
 */
export function rosterProvider(gameName) {
  const p = BY_NAME.get(norm(gameName));
  return p ? { slug: p.slug, title: p.title, unit: p.unit } : null;
}
