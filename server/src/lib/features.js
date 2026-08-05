import AppSetting from "../models/AppSetting.js";
import User from "../models/User.js";
import { isUserAdmin } from "./admin.js";

// ======================================================================
//  Drapeaux de fonctionnalités
// ======================================================================
// Des pages qu'on peut allumer ou éteindre depuis le panneau d'admin, sans
// redéploiement. Deux règles tiennent tout :
//
//   1. LE DÉFAUT EST CELUI DE LA DÉCLARATION — une page nouvelle arrive
//      éteinte, et il faut un geste conscient pour la montrer à tout le monde ;
//   2. L'ADMIN VOIT TOUT, toujours. Éteindre une page, c'est la cacher aux
//      autres, pas se couper la main : sinon on ne pourrait plus la préparer.
//
// Les valeurs sont mises en cache quelques secondes : ce drapeau est lu à
// chaque requête de la Collection, on ne va pas interroger Mongo pour ça.

export const FEATURES = {
  collection: {
    label: "Collection",
    hint: "Le rayon vidéo : séries, films et animés liés aux jeux.",
    // Cachée par défaut : le rayon se garnit avant de s'ouvrir.
    default: false,
  },
};

const TTL = 10_000;
let cache = null;
let cachedAt = 0;

// L'état de tous les drapeaux, défauts compris. Un réglage inconnu en base
// (drapeau supprimé du code) est simplement ignoré.
export async function readFeatures() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const rows = await AppSetting.find({ key: { $regex: /^feature\./ } })
    .select("key value")
    .lean()
    .catch(() => []);
  const stored = new Map(rows.map((r) => [r.key.slice("feature.".length), r.value]));
  const out = {};
  for (const [name, def] of Object.entries(FEATURES)) {
    out[name] = stored.has(name) ? !!stored.get(name) : def.default;
  }
  cache = out;
  cachedAt = Date.now();
  return out;
}

export async function isEnabled(name) {
  const all = await readFeatures();
  return !!all[name];
}

export async function setFeature(name, on, userId = null) {
  if (!FEATURES[name]) throw new Error(`Fonctionnalité inconnue : ${name}`);
  await AppSetting.findOneAndUpdate(
    { key: `feature.${name}` },
    { value: !!on, updatedBy: userId },
    { upsert: true }
  );
  cache = null; // le prochain lecteur relit la vérité
  return readFeatures();
}

// Barrage d'une route entière derrière un drapeau. L'admin passe toujours :
// c'est lui qui prépare la page pendant qu'elle est éteinte.
export function requireFeature(name) {
  return async (req, res, next) => {
    try {
      if (await isEnabled(name)) return next();
      // Éteinte : seul un administrateur passe. La vérification ne coûte une
      // lecture que sur ce chemin-là — page allumée, on ne regarde même pas.
      const user = req.userId
        ? await User.findById(req.userId).select("isAdmin isSuperAdmin")
        : null;
      if (isUserAdmin(user)) return next();
      // 404 et non 403 : pour qui n'y a pas droit, la page n'existe pas.
      return res.status(404).json({ error: "Cette section n'est pas disponible." });
    } catch {
      return next();
    }
  };
}
