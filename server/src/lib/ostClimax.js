import OstClimax from "../models/OstClimax.js";

// ======================================================================
//  Le climax d'une piste d'OST
// ======================================================================
// Voir l'en-tête de models/OstClimax.js pour le pourquoi. Les analyses ne sont
// plus lancées (elles téléchargeaient l'audio avec yt-dlp) : on ne fait que
// relire celles déjà en base. Une piste jamais analysée garde l'estimation du
// blind test.

// Les climax déjà connus pour un lot de pistes. Map(videoId → doc).
export async function climaxFor(videoIds) {
  const ids = [...new Set(videoIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await OstClimax.find({ videoId: { $in: ids }, ok: true })
    .select("videoId startSec durationSec")
    .lean()
    .catch(() => []);
  return new Map(rows.map((r) => [r.videoId, r]));
}
