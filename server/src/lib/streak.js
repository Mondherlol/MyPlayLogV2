import User from "../models/User.js";
import { triggerMissionCheck } from "./missions.js";

// ======================================================================
//  Série de connexions — « X jours d'affilée »
// ======================================================================
// Aucun ping dédié : on se greffe sur la présence déjà notée à chaque requête
// authentifiée (cf. middleware/auth.js). Un jour = un jour CIVIL français, pas
// 24 h glissantes : venir à 23 h puis le lendemain à 8 h fait bien deux jours.

// Jour civil du joueur, "2026-07-24". Le serveur tourne en UTC ; sans ce
// décalage la journée basculerait à 1 h ou 2 h du matin, en plein pic d'usage.
export function dayKey(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

// La veille d'un jour civil. On passe par midi UTC : à cette heure-là, aucun
// changement d'heure ne peut faire glisser la date d'un cran.
export function previousDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Note le passage du jour et fait avancer la série. Appelée au plus une fois
// par joueur et par jour dans un processus donné (l'appelant mémorise le jour
// déjà traité) — d'où la lecture, qu'on ne peut pas se permettre à chaque
// requête. Renvoie la série à jour, ou null si rien n'a bougé.
export async function touchStreak(userId, today = dayKey()) {
  const user = await User.findById(userId).select("streak");
  if (!user) return null;

  const last = user.streak?.lastDay || null;
  const set = { lastSeenAt: new Date() };

  // Déjà vu aujourd'hui (autre processus, ou redémarrage du serveur) : on ne
  // recompte pas — sinon la série grimperait à chaque redémarrage.
  if (last !== today) {
    const current = last === previousDay(today) ? (user.streak?.current || 0) + 1 : 1;
    set.streak = {
      current,
      best: Math.max(current, user.streak?.best || 0),
      lastDay: today,
    };
  }

  // timestamps: false → la présence ne doit pas rajeunir le profil.
  await User.updateOne({ _id: userId }, { $set: set }, { timestamps: false });
  if (!set.streak) return null;

  // Missions « Connecte-toi N jours d'affilée » : la notif tombe au moment où
  // la série s'allonge, pas à la prochaine ouverture de l'onglet Badges.
  triggerMissionCheck(userId);
  return set.streak;
}
