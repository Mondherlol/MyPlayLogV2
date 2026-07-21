import BlindTest from "../models/BlindTest.js";
import PointEntry from "../models/PointEntry.js";
import User from "../models/User.js";
import { grantPoints } from "./points.js";

// ======================================================================
//  Rattrapage des points : créditer les blind tests joués AVANT l'arcade.
// ======================================================================
// L'arcade ne crédite que les parties terminées depuis sa mise en ligne. Sans
// rattrapage, un joueur avec 1452 points au classement en voit 0 dans son
// porte-monnaie — le symptôme classique après un premier déploiement.
//
// Rejouable sans risque : on ne calcule PAS « combien ajouter » mais « combien
// il DEVRAIT y avoir », et on ne comble que l'écart. Relancer ne double donc
// rien, et une exécution interrompue se termine proprement. On compare des
// GAINS d'origine blind test, jamais le solde courant : les points déjà
// dépensés en caisses ne faussent pas le calcul.
//
// Vit ici plutôt que dans le script pour que le bouton du panel admin et la
// ligne de commande partagent exactement le même calcul.

// Qui doit combien ? Renvoie une ligne par joueur ayant joué au blind test.
export async function planArcadeBackfill() {
  // Ce que chaque joueur a marqué au total (= le score cumulé du classement).
  const scored = await BlindTest.aggregate([
    { $group: { _id: "$user", total: { $sum: "$score" }, games: { $sum: 1 } } },
  ]);
  if (!scored.length) return [];

  // Ce qui lui a DÉJÀ été crédité au titre du blind test (parties récentes
  // créditées en direct + un éventuel rattrapage précédent).
  const granted = await PointEntry.aggregate([
    { $match: { source: { $in: ["blindtest", "backfill"] } } },
    { $group: { _id: "$user", total: { $sum: "$amount" } } },
  ]);
  const grantedBy = new Map(granted.map((g) => [String(g._id), g.total]));

  const users = await User.find({ _id: { $in: scored.map((s) => s._id) } })
    .select("username points")
    .lean();
  const userBy = new Map(users.map((u) => [String(u._id), u]));

  const rows = [];
  for (const row of scored) {
    const u = userBy.get(String(row._id));
    if (!u) continue; // compte supprimé, parties orphelines
    const already = grantedBy.get(String(row._id)) || 0;
    rows.push({
      userId: row._id,
      username: u.username,
      points: u.points || 0,
      games: row.games,
      scoredTotal: row.total,
      already,
      missing: row.total - already,
    });
  }
  rows.sort((a, b) => b.missing - a.missing);
  return rows;
}

// Applique le plan. Renvoie le total réellement crédité.
export async function runArcadeBackfill(rows) {
  let given = 0;
  for (const r of rows) {
    if (r.missing <= 0) continue;
    await grantPoints(r.userId, r.missing, "backfill", {
      games: r.games,
      scoredTotal: r.scoredTotal,
    });
    given += r.missing;
  }
  return given;
}
