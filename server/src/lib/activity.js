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
