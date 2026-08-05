import Activity from "../models/Activity.js";

// Enregistre une activité sociale (best-effort : ne casse jamais la requête
// principale). Voir models/Activity.js et routes/feed.js.
export async function recordActivity(data) {
  try {
    await Activity.create({
      ...data,
      gameName: String(data.gameName || "").slice(0, 160),
      snippet: String(data.snippet || "").slice(0, 160),
    });
  } catch (err) {
    console.error("activity error:", err.message);
  }
}

// Supprime les activités liées à une action annulée (unlike, suppression d'un
// commentaire…). `filter` est un filtre Mongo (ex. { actor, type, comment }).
export async function removeActivity(filter) {
  try {
    await Activity.deleteMany(filter);
  } catch (err) {
    console.error("activity remove error:", err.message);
  }
}

// Fenêtre de regroupement : plusieurs actions rapprochées sur un même jeu (ou
// une même liste) ne font qu'UNE carte dans le fil, dont les détails fusionnent.
const MERGE_WINDOW = 60 * 60 * 1000; // 1 h

// Journalise des changements réels sur une entrée de bibliothèque (statut,
// note, review, OST favorite…). Si une carte récente existe pour ce jeu, on y
// fusionne les changements (un changement de même nature remplace l'ancien).
export async function recordGameActivity({ actor, gameId, gameName, gameCover, changes }) {
  if (!changes || !changes.length) return;
  try {
    const since = new Date(Date.now() - MERGE_WINDOW);
    const recent = await Activity.findOne({
      actor,
      type: "game_update",
      game: gameId,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (recent) {
      const merged = [...(recent.meta?.changes || [])];
      for (const ch of changes) {
        const i = merged.findIndex((m) => m.kind === ch.kind);
        if (i >= 0) {
          // Un changement de même nature remplace l'ancien — SAUF la
          // progression bundle, dont les jeux terminés se cumulent (finir A
          // puis B dans l'heure doit lister les deux, pas seulement B).
          merged[i] =
            ch.kind === "bundle"
              ? {
                  ...ch,
                  names: [
                    ...new Set([...(merged[i].names || []), ...(ch.names || [])]),
                  ].slice(0, 4),
                }
              : ch;
        } else merged.push(ch);
      }
      // Driver natif : createdAt est immutable côté mongoose, or on veut
      // RE-DATER la carte fusionnée pour qu'elle remonte en tête du fil
      // (sinon la nouvelle action reste enterrée à la date de la première).
      const now = new Date();
      await Activity.collection.updateOne(
        { _id: recent._id },
        {
          $set: {
            meta: { ...(recent.meta || {}), changes: merged },
            gameName: String(gameName || recent.gameName || "").slice(0, 160),
            gameCover: gameCover ?? recent.gameCover ?? null,
            createdAt: now,
            updatedAt: now,
          },
        }
      );
      return;
    }

    await Activity.create({
      actor,
      type: "game_update",
      game: gameId,
      gameName: String(gameName || "").slice(0, 160),
      gameCover: gameCover || null,
      meta: { changes },
    });
  } catch (err) {
    console.error("activity game error:", err.message);
  }
}

// Journalise l'ajout d'éléments à une liste : les ajouts rapprochés se
// cumulent dans une seule carte (meta.added).
export async function recordListItemsActivity({ actor, list, added }) {
  if (!added) return;
  try {
    const since = new Date(Date.now() - MERGE_WINDOW);
    const recent = await Activity.findOne({
      actor,
      type: "list_items",
      list,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (recent) {
      // Même logique que les jeux : la carte fusionnée est re-datée pour
      // remonter en tête du fil (driver natif, createdAt immutable sinon).
      const now = new Date();
      await Activity.collection.updateOne(
        { _id: recent._id },
        {
          $set: {
            meta: { added: (recent.meta?.added || 0) + added },
            createdAt: now,
            updatedAt: now,
          },
        }
      );
      return;
    }

    await Activity.create({ actor, type: "list_items", list, meta: { added } });
  } catch (err) {
    console.error("activity list items error:", err.message);
  }
}
