import UserGame from "../models/UserGame.js";

// ======================================================================
//  Scripts de maintenance — onglet « Scripts » du panel admin
// ======================================================================
// Un script = une opération ponctuelle qu'on lançait jusqu'ici en SSH
// (`node src/scripts/…`). Ils sont déclarés une fois ici, et l'onglet admin
// les liste tout seul : ajouter un script = ajouter une entrée dans SCRIPTS.
//
// Contrat d'un `run(opts)` :
//   - il reçoit `{ dryRun }` et ne DOIT rien écrire quand `dryRun` est vrai —
//     c'est ce qui permet de simuler avant de lancer pour de vrai ;
//   - il renvoie `{ summary, log }` — `summary` s'affiche en une phrase,
//     `log` est la liste des lignes détaillées (facultative).

// Au-delà de ce seuil, un temps de jeu n'est plus une saisie mais un troll :
// 9999 h ≈ 416 jours de jeu non-stop sur un seul titre.
export const HOURS_LIMIT = 9999;

async function fixHours({ dryRun }) {
  const manual = { playtimeHours: { $gt: HOURS_LIMIT } };
  const psn = { psnPlaytimeHours: { $gt: HOURS_LIMIT } };
  const filter = { $or: [manual, psn] };

  // On lit les entrées AVANT d'écrire : le rapport doit pouvoir nommer qui a
  // triché et sur quel jeu, y compris en simulation.
  const rows = await UserGame.find(filter)
    .select("user gameId name playtimeHours psnPlaytimeHours")
    .populate("user", "username")
    .lean();

  const fmt = (n) =>
    n == null ? "—" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 });

  const log = rows.map(
    (r) =>
      `${r.user?.username || "compte supprimé"} — ${r.name || `jeu #${r.gameId}`} : ` +
      `${fmt(r.playtimeHours)} h` +
      (r.psnPlaytimeHours > HOURS_LIMIT ? ` (repère PSN ${fmt(r.psnPlaytimeHours)} h)` : "") +
      " → 0"
  );

  let modified = 0;
  if (!dryRun && rows.length) {
    const a = await UserGame.updateMany(manual, { $set: { playtimeHours: 0 } });
    // Le repère PSN n'est remis à zéro QUE s'il déraille lui aussi : c'est lui
    // qui dit à la synchro si la valeur a été saisie à la main (voir
    // routes/psn.js, nextPlaytime). L'écraser sur un repère sain ferait
    // repartir la prochaine synchro sur de mauvaises bases.
    const b = await UserGame.updateMany(psn, { $set: { psnPlaytimeHours: 0 } });
    modified = Math.max(a.modifiedCount || 0, b.modifiedCount || 0);
  }

  const players = new Set(rows.map((r) => String(r.user?._id || r.user))).size;
  const n = dryRun ? rows.length : modified;
  return {
    summary:
      `${n} entrée${n > 1 ? "s" : ""} au-dessus de ${HOURS_LIMIT} h ` +
      `chez ${players} joueur${players > 1 ? "s" : ""} — ` +
      (dryRun ? "rien n'a été modifié (simulation)." : `remise${n > 1 ? "s" : ""} à 0 h.`),
    log,
  };
}

export const SCRIPTS = [
  {
    key: "fixHours",
    label: "Corriger les temps de jeu aberrants",
    description: `Remet à 0 tout temps de jeu déclaré au-dessus de ${HOURS_LIMIT} h — les « 1 000 000 000 000 heures » des trolls. Les valeurs plausibles ne sont pas touchées.`,
    danger: true,
    run: fixHours,
  },
];

export function findScript(key) {
  return SCRIPTS.find((s) => s.key === key) || null;
}
