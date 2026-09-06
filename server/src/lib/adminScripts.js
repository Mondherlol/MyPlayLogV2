import GameTrivia from "../models/GameTrivia.js";
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

// ----------------------------------------------------------------------
//  Purger les anecdotes de la première génération
// ----------------------------------------------------------------------
// La V1 du mode Trivia demandait les anecdotes à Gemini DE MÉMOIRE : pas
// d'image, pas de source, et une part d'invention qu'on ne pouvait pas
// distinguer du vrai. La V2 va chercher du texte écrit par des humains
// (Wikipédia, Fandom…) et n'en garde que ce qui s'y trouve (cf. lib/gameLore).
//
// Un document déjà écrit ne se réécrit jamais tout seul — c'est ce qui évite de
// refaire le tour des wikis à chaque ouverture d'une fiche. Les paquets de la
// V1 resteraient donc en place indéfiniment : ce script les efface, et ils se
// réécrivent au format complet à la prochaine ouverture du mode Trivia.
//
// ⚠️ ON NE TOUCHE PAS AUX PAQUETS DÉJÀ REFAITS. Le repère est simple et sûr :
// la V1 était INCAPABLE de produire une image ou une source. Un paquet qui n'en
// a aucune est donc de la V1 — et un paquet qui en a une est de la V2, on le
// laisse tranquille. Sans ce tri, relancer le script deux fois de suite
// rebrûlerait tout le quota Gemini pour rien.
//
// Les réactions posées sur ces cartes partent avec elles, et c'est
// inévitable : les cartes sont identifiées par l'empreinte de leur TEXTE, et
// les nouvelles seront écrites autrement.
function isLegacy(doc) {
  // Un paquet vide compte aussi : c'était un « on ne sait rien sur ce jeu »
  // prononcé sans avoir consulté la moindre source. Wikipédia, elle, a
  // peut-être trois pages dessus.
  if (!doc.facts?.length) return true;
  return !doc.facts.some((f) => f.image?.url || f.sourceLabel);
}

async function purgeLegacyTrivia({ dryRun }) {
  const docs = await GameTrivia.find()
    .select("gameId gameName facts.image.url facts.sourceLabel facts.reactions")
    .lean();

  const stale = docs.filter(isLegacy);

  const log = stale.map((d) => {
    const cards = d.facts?.length || 0;
    const reactions = (d.facts || []).reduce((n, f) => n + (f.reactions?.length || 0), 0);
    return (
      `${d.gameName || `jeu #${d.gameId}`} — ` +
      (cards ? `${cards} carte${cards > 1 ? "s" : ""}` : "aucune carte") +
      (reactions ? `, ${reactions} réaction${reactions > 1 ? "s" : ""} perdue${reactions > 1 ? "s" : ""}` : "") +
      " → à réécrire"
    );
  });

  let removed = 0;
  if (!dryRun && stale.length) {
    const res = await GameTrivia.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
    removed = res.deletedCount || 0;
  }

  const kept = docs.length - stale.length;
  const n = dryRun ? stale.length : removed;
  return {
    summary:
      `${n} paquet${n > 1 ? "s" : ""} de la première génération sur ${docs.length} — ` +
      (dryRun
        ? "rien n'a été supprimé (simulation)."
        : `effacé${n > 1 ? "s" : ""}, ils se réécriront à la prochaine ouverture. ` +
          `${kept} paquet${kept > 1 ? "s" : ""} déjà au format complet, laissé${kept > 1 ? "s" : ""} intact${kept > 1 ? "s" : ""}.`),
    log,
  };
}

export const SCRIPTS = [
  {
    key: "purgeLegacyTrivia",
    label: "Réécrire les anecdotes Trivia de la première génération",
    description:
      "Efface les paquets d'anecdotes écrits avant que le mode Trivia n'aille lire " +
      "Wikipédia et les wikis de jeu : ceux-là n'ont ni image ni source. Ils se " +
      "réécriront au format complet à la prochaine ouverture du mode Trivia, sur " +
      "les vraies sources. Les paquets déjà refaits ne sont pas touchés. " +
      "⚠️ Les réactions posées sur les anciennes cartes sont perdues.",
    danger: true,
    run: purgeLegacyTrivia,
  },
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
