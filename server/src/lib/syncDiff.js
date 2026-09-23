// ======================================================================
//  CE QUI A BOUGÉ DEPUIS LA DERNIÈRE SYNCHRO
// ======================================================================
//
// ⚠️ UNE RESYNCHRO NE DOIT PAS REPOSER TOUTE LA BIBLIOTHÈQUE. Chaque jeu déjà
// chez nous repassait dans l'étape « mise à jour », qu'on y ait joué ou non
// depuis la fois d'avant : trois cents cartes à faire défiler pour en trouver
// deux qui avaient changé. On compare donc chaque jeu à ce que la plateforme
// en disait lors de la dernière synchro VALIDÉE — le document appliqué garde
// ses jeux (cf. models/PlatformSync) — et seuls ceux qui ont bougé restent
// dans l'étape. Les autres restent dans le récap, décochés et marqués
// `changed: false` : l'application les range dans une feuille à part, d'où
// on peut toujours les remettre.
//
// Commun à Steam et PlayStation : même modèle, même question.
import PlatformSync from "../models/PlatformSync.js";

/**
 * Ce que la dernière synchro validée savait de chaque jeu, par clé.
 * `null` s'il n'y en a jamais eu : tout est alors nouveau.
 */
export async function lastSnapshot(userId, platform) {
  const last = await PlatformSync.findOne({ user: userId, platform, state: "applied" })
    .sort({ appliedAt: -1 })
    .select("items.key items.playtimeMinutes items.trophyProgress")
    .lean();
  if (!last) return null;
  return new Map((last.items || []).map((it) => [String(it.key), it]));
}

/**
 * Ce jeu a-t-il bougé depuis ? Du temps de jeu en plus, ou (PlayStation) une
 * progression de trophées différente. Un jeu absent de la dernière synchro est
 * nouveau pour elle : il compte comme changé.
 */
export function hasChanged(snapshot, key, { playtimeMinutes = 0, trophyProgress = null } = {}) {
  if (!snapshot) return true;
  const prev = snapshot.get(String(key));
  if (!prev) return true;
  if (Math.round(prev.playtimeMinutes || 0) !== Math.round(playtimeMinutes || 0)) return true;
  if ((prev.trophyProgress ?? null) !== (trophyProgress ?? null)) return true;
  return false;
}

/** Un jeu qui demande qu'on le regarde : tout sauf une mise à jour inchangée. */
export const needsLook = (it) =>
  !it.ignored && (it.category !== "update" || it.changed !== false);

/**
 * Une synchro « calme » : rien de neuf, rien de coché, rien à reconnaître.
 *
 * ⚠️ CE N'EST PAS UNE SYNCHRO EN ATTENTE. Les réglages l'annonçaient pourtant
 * comme telle (« synchro en attente »), et le récap s'ouvrait sur « tout est à
 * jour » sans rien à valider. On ne l'annonce donc plus, et la refermer la
 * supprime au lieu de l'inscrire « annulée » dans l'historique : il ne s'est
 * rien passé. Elle existe seulement pour qu'on puisse, depuis le récap,
 * remettre à jour un jeu inchangé.
 */
export const isQuiet = (sync) =>
  !(sync?.unmatched || []).length &&
  !(sync?.items || []).some((it) => !it.ignored && (it.include || needsLook(it)));
