import Notification from "../models/Notification.js";

// Crée une notification (best-effort). N'auto-notifie jamais l'acteur.
export async function notify({
  user,
  type,
  actor,
  list = null,
  comment = null,
  game = null,
  gameName = "",
  ostOwner = null,
  repostOwner = null,
  videoOwner = null,
  snippet = "",
}) {
  if (!user || !actor || String(user) === String(actor)) return;
  try {
    await Notification.create({
      user,
      type,
      actor,
      list,
      comment,
      game,
      gameName: String(gameName || "").slice(0, 160),
      ostOwner,
      repostOwner,
      videoOwner,
      snippet: String(snippet || "").slice(0, 120),
    });
  } catch (err) {
    console.error("notify error:", err.message);
  }
}
