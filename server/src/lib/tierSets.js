import { createTtlCache } from "./ttlCache.js";
import { wikiCategoryItems } from "./gameWiki.js";

// ======================================================================
//  Les autres choses à classer : armes, boss, monstres, cartes…
// ======================================================================
// Les rosters (cf. lib/gameCharacters et lib/gameWiki) donnent les
// PERSONNAGES d'un jeu — ils s'affichent aussi sur sa fiche. Ce qui suit ne
// s'y affiche pas : ce n'est pas un casting, c'est un débat de joueurs. « Le
// meilleur boss d'Elden Ring », « la meilleure arme de Valorant », « le
// meilleur starter » : des tier lists qu'on propose à qui a joué au jeu
// (cf. routes/lists, GET /suggest/tiers).
//
// Chaque ensemble : les noms IGDB du jeu (ou un motif), un titre, une unité,
// et de quoi remplir le bac. Ajouter un ensemble, c'est une entrée ici.

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

// --- Valorant : les armes (même API publique que les agents) ---
async function valorantWeapons() {
  const d = await getJson("https://valorant-api.com/v1/weapons?language=fr-FR");
  return (d?.data || []).map((w) => ({
    key: w.uuid,
    name: w.displayName,
    // L'image de la boutique : l'arme de profil, sur fond transparent.
    image: w.shopData?.newImage || w.displayIcon || null,
  }));
}

// --- Clash Royale : les cartes (données publiques de RoyaleAPI) ---
async function clashCards() {
  const d = await getJson("https://royaleapi.github.io/cr-api-data/json/cards.json");
  return (d || []).map((c) => ({
    key: c.key,
    name: c.name,
    image: `https://cdn.royaleapi.com/static/img/cards-150/${c.key}.png`,
  }));
}

// --- Pokémon : les starters des neuf générations ---
// Une liste fixe (elle ne bouge qu'à chaque génération) : les noms français
// et les illustrations officielles du dépôt de PokéAPI, sans une requête.
const STARTERS = [
  [1, "Bulbizarre"], [4, "Salamèche"], [7, "Carapuce"],
  [152, "Germignon"], [155, "Héricendre"], [158, "Kaiminus"],
  [252, "Arcko"], [255, "Poussifeu"], [258, "Gobou"],
  [387, "Tortipouss"], [390, "Ouisticram"], [393, "Tiplouf"],
  [495, "Vipélierre"], [498, "Gruikui"], [501, "Moustillon"],
  [650, "Marisson"], [653, "Feunnec"], [656, "Grenousse"],
  [722, "Brindibou"], [725, "Flamiaou"], [728, "Otaquin"],
  [810, "Ouistempo"], [813, "Flambino"], [816, "Larméléon"],
  [906, "Poussacha"], [909, "Chochodile"], [912, "Coiffeton"],
];
async function pokemonStarters() {
  return STARTERS.map(([id, name]) => ({
    key: id,
    name,
    image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
  }));
}

const wiki = (host, category, opts) => () => wikiCategoryItems(host, category, opts);

const SETS = [
  {
    slug: "valorant-weapons",
    names: ["Valorant"],
    title: "Tier list des armes de Valorant",
    unit: "armes",
    fetch: valorantWeapons,
  },
  {
    slug: "genshin-weapons",
    names: ["Genshin Impact"],
    title: "Tier list des armes 5★ de Genshin Impact",
    unit: "armes",
    fetch: wiki("genshin-impact.fandom.com", "5-Star Weapons", { max: 120 }),
  },
  {
    slug: "elden-ring-bosses",
    names: ["Elden Ring"],
    title: "Tier list des boss d'Elden Ring",
    unit: "boss",
    // Les plus longs articles d'abord : les boss majeurs, pas les mini-boss
    // de catacombes.
    fetch: wiki("eldenring.fandom.com", "Bosses", { max: 60 }),
  },
  {
    slug: "mhw-monsters",
    names: ["Monster Hunter: World", "Monster Hunter: World - Iceborne"],
    title: "Tier list des monstres de Monster Hunter: World",
    unit: "monstres",
    fetch: wiki("monsterhunter.fandom.com", "MHWI Monsters", { max: 70 }),
  },
  {
    slug: "mhwilds-monsters",
    names: ["Monster Hunter Wilds"],
    title: "Tier list des monstres de Monster Hunter Wilds",
    unit: "monstres",
    fetch: wiki("monsterhunter.fandom.com", "MHWilds Monsters", { max: 60 }),
  },
  {
    slug: "clash-royale-cards",
    names: ["Clash Royale"],
    title: "Tier list des cartes de Clash Royale",
    unit: "cartes",
    fetch: clashCards,
  },
  {
    slug: "pokemon-starters",
    // Tous les Pokémon de la série principale : le débat des starters
    // concerne tout joueur de Pokémon, pas un épisode.
    match: /^pok[eé]mon\b/i,
    title: "Tier list des starters Pokémon",
    unit: "starters",
    fetch: pokemonStarters,
  },
];

const BY_NAME = new Map();
for (const s of SETS) for (const n of s.names || []) BY_NAME.set(norm(n), s);

// Les listes bougent au rythme des mises à jour des jeux, pas d'une heure à
// l'autre.
const cache = createTtlCache({ name: "tier-sets", max: 32, ttl: 24 * 3600 * 1000 });

/** Les ensembles à classer qu'un jeu propose : `[{ slug, title, unit }]`. */
export function tierSetsFor(gameName) {
  const out = [];
  const byName = BY_NAME.get(norm(gameName));
  if (byName) out.push(byName);
  for (const s of SETS) if (s.match?.test(String(gameName || "")) && !out.includes(s)) out.push(s);
  return out.map(({ slug, title, unit }) => ({ slug, title, unit }));
}

/** Les éléments d'un ensemble : `[{ id, name, image }]`, illustrés seulement. */
export async function tierSetItems(slug) {
  const set = SETS.find((s) => s.slug === slug);
  if (!set) return [];
  try {
    const items = await cache.remember(slug, set.fetch);
    return (items || [])
      .filter((i) => i.name && i.image)
      .map((i) => ({ id: `${slug}-${i.key}`, name: i.name, image: i.image }));
  } catch {
    return [];
  }
}
