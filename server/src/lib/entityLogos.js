import EntityLogo from "../models/EntityLogo.js";
import { igdbQuery } from "./igdb.js";

const STALE_MS = 90 * 24 * 60 * 60 * 1000; // les logos bougent rarement

// Endpoint + champ logo IGDB selon le type d'entité
const KINDS = {
  company: { endpoint: "companies", field: "logo.image_id", pick: (x) => x.logo?.image_id },
  platform: {
    endpoint: "platforms",
    field: "platform_logo.image_id",
    pick: (x) => x.platform_logo?.image_id,
  },
};

const logoUrl = (imageId) =>
  imageId ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${imageId}.png` : null;

// Garantit la présence en cache des logos demandés et renvoie une
// Map name -> url|null. Les noms viennent d'IGDB (via GameMeta / plateformes
// des jeux), donc le match exact par nom fonctionne. Best-effort : si IGDB
// est indisponible, on renvoie ce qu'on a déjà en base.
export async function ensureEntityLogos(kind, names) {
  const spec = KINDS[kind];
  const wanted = [...new Set(names)].filter(Boolean);
  const out = new Map();
  if (!spec || !wanted.length) return out;

  const existing = await EntityLogo.find({ kind, name: { $in: wanted } }).lean();
  const byName = new Map(existing.map((e) => [e.name, e]));
  const now = Date.now();
  const missing = wanted.filter((n) => {
    const e = byName.get(n);
    return !e || now - new Date(e.updatedAt).getTime() > STALE_MS;
  });

  if (missing.length) {
    try {
      const quoted = missing.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",");
      const raw = await igdbQuery(
        spec.endpoint,
        `fields name,${spec.field}; where name = (${quoted}); limit ${missing.length + 10};`
      );
      const found = new Map(raw.map((x) => [x.name, logoUrl(spec.pick(x))]));
      const ops = missing.map((name) => {
        const image = found.get(name) || null;
        byName.set(name, { name, image });
        return {
          updateOne: {
            filter: { kind, name },
            update: { $set: { image } },
            upsert: true,
          },
        };
      });
      await EntityLogo.bulkWrite(ops, { ordered: false });
    } catch (err) {
      console.error("entity logo fetch error:", err.message);
    }
  }

  for (const n of wanted) out.set(n, byName.get(n)?.image ?? null);
  return out;
}
