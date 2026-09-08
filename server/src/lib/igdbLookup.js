// ======================================================================
//  Retrouver un jeu IGDB par son NOM
// ======================================================================
// Trois fonctionnalités ont maintenant le même besoin : savoir si la fiche
// qu'on regarde (ou qu'on synchronise) est bien tel jeu précis — les saisons
// des jeux-services (lib/gameSeasons), la boutique du jour (routes/gameStore)
// et les rosters officiels de personnages (lib/gameCharacters).
//
// ⚠️ ET AUCUNE DES TROIS NE DOIT CODER D'IDENTIFIANT EN DUR. Le rattachement
// doit être le MÊME que celui de la bibliothèque, sinon la fonctionnalité ne
// s'affiche chez personne : une constante recopiée à la main est invérifiable
// et se trompe en silence.

import { igdbQuery } from "./igdb.js";

const IMG_BASE = "https://images.igdb.com/igdb/image/upload";

// Résolu une fois par jour, comme le fait déjà l'habillage des trackers
// (cf. lib/marvelRivals, `getGameAssets`).
const IGDB_TTL = 24 * 3600 * 1000;
const _igdb = new Map(); // nom recherché -> { at, data }

/** La fiche IGDB d'un jeu désigné par son nom : `{ id, name, cover }`. */
export async function resolveIgdbGame(name) {
  const hit = _igdb.get(name);
  if (hit && Date.now() - hit.at < IGDB_TTL) return hit.data;

  let data = null;
  try {
    const rows = await igdbQuery(
      "games",
      `search "${name.replace(/"/g, "")}"; fields name, cover.image_id; limit 20;`
    );
    // Le nom EXACT d'abord : « Valorant » cherché en toutes lettres remonte
    // aussi « Valorant: Champions », qui est une autre fiche et n'est dans la
    // bibliothèque de personne.
    const exact = (rows || []).find(
      (g) => String(g.name || "").toLowerCase() === name.toLowerCase()
    );
    const g = exact || (rows || [])[0];
    if (g?.id) {
      data = {
        id: g.id,
        name: g.name,
        cover: g.cover?.image_id ? `${IMG_BASE}/t_cover_big/${g.cover.image_id}.jpg` : null,
      };
    }
  } catch {
    // IGDB en panne : on garde le dernier rattachement connu plutôt que de
    // réécrire toutes les saisons du jeu sans image ni `gameId`.
    return hit?.data || null;
  }
  _igdb.set(name, { at: Date.now(), data });
  return data;
}
