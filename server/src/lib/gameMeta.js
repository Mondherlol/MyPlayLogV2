import GameMeta from "../models/GameMeta.js";
import { igdbQuery } from "./igdb.js";
import { GENRES_FR, frName } from "./translations.js";

const STALE_MS = 30 * 24 * 60 * 60 * 1000; // on re-rafraîchit passé 30 jours
const CHUNK = 400; // marge sous la limite IGDB (500 ids par requête)

const META_FIELDS =
  "fields name,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,franchises.name,collections.name,first_release_date,total_rating";

function toDoc(g) {
  const companies = g.involved_companies || [];
  return {
    name: g.name || "",
    genres: (g.genres || []).map((x) => frName(GENRES_FR, x.name)).filter(Boolean),
    developers: [
      ...new Set(companies.filter((c) => c.developer).map((c) => c.company?.name).filter(Boolean)),
    ],
    publishers: [
      ...new Set(companies.filter((c) => c.publisher).map((c) => c.company?.name).filter(Boolean)),
    ],
    franchise: g.franchises?.[0]?.name || g.collections?.[0]?.name || null,
    year: g.first_release_date
      ? new Date(g.first_release_date * 1000).getFullYear()
      : null,
    rating: g.total_rating ? Math.round(g.total_rating) : null,
  };
}

// Garantit la présence en cache des métadonnées des jeux demandés et renvoie
// une Map gameId -> meta. Seuls les ids absents (ou périmés) déclenchent une
// requête IGDB, batchée par tranche de 400 — donc au plus 1 requête pour une
// bibliothèque entière, et 0 aux visites suivantes. Best-effort : si IGDB est
// indisponible, on renvoie ce qu'on a déjà en base.
export async function ensureGameMeta(gameIds) {
  const ids = [...new Set(gameIds)].filter(Boolean);
  if (!ids.length) return new Map();

  const existing = await GameMeta.find({ gameId: { $in: ids } }).lean();
  const byId = new Map(existing.map((m) => [m.gameId, m]));
  const now = Date.now();
  const missing = ids.filter((id) => {
    const m = byId.get(id);
    return !m || now - new Date(m.updatedAt).getTime() > STALE_MS;
  });

  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    try {
      const raw = await igdbQuery(
        "games",
        `${META_FIELDS}; where id = (${chunk.join(",")}); limit ${chunk.length};`
      );
      const ops = raw.map((g) => {
        const doc = toDoc(g);
        byId.set(g.id, { gameId: g.id, ...doc });
        return {
          updateOne: { filter: { gameId: g.id }, update: { $set: doc }, upsert: true },
        };
      });
      if (ops.length) await GameMeta.bulkWrite(ops, { ordered: false });
    } catch (err) {
      console.error("game meta fetch error:", err.message);
    }
  }
  return byId;
}

// Pré-chauffe le cache pour un jeu (à l'ajout en bibliothèque), sans bloquer
// la réponse : la première visite de l'onglet Stats trouvera tout en base.
export function warmGameMeta(gameId) {
  ensureGameMeta([gameId]).catch(() => {});
}
