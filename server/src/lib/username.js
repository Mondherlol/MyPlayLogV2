// ======================================================================
//  LE PSEUDO : ce qu'on a le droit d'écrire, et quand on peut le changer
// ======================================================================
//
// Le pseudo est l'adresse d'un profil (/u/pseudo) et le nom sous lequel on se
// mentionne (@pseudo). D'où trois règles :
//
//   - LISIBLE ET TAPABLE : lettres sans accent, chiffres, et trois séparateurs
//     (_ . -), jamais au début, à la fin, ni deux de suite. Un pseudo en
//     caractères invisibles ou en alphabets qui imitent le latin permettrait de
//     se faire passer pour quelqu'un d'autre.
//   - UNIQUE SANS LA CASSE : « Jean » et « jean » seraient deux comptes qu'on
//     confondrait partout.
//   - PAS À TOUT BOUT DE CHAMP : un changement tous les USERNAME_COOLDOWN_DAYS
//     jours. Changer de nom casse les liens qu'on a partagés et désoriente ceux
//     qui vous suivent ; le faire tous les jours servirait surtout à brouiller
//     les pistes. Changer seulement la casse (jean → Jean) reste libre.
//
// ⚠️ L'ANCIEN NOM RESTE RÉSERVÉ pendant la même durée : personne d'autre ne
// peut le prendre, sinon le premier venu récupérerait les liens et les
// mentions de quelqu'un d'autre le jour même. Son ancien propriétaire, lui,
// peut le reprendre.
//
// Ces règles ne s'appliquent qu'à un pseudo qu'on CHOISIT (inscription,
// changement). Les comptes existants gardent le leur tel quel.
import mongoose from "mongoose";

// Le modèle est lu au moment de l'appel, pas importé : models/User.js se sert
// de `nextUsernameChangeAt` pour sa fiche publique, et un import dans les deux
// sens ferait une boucle.
const User = () => mongoose.model("User");

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_COOLDOWN_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const ALLOWED = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|[._-](?=[a-zA-Z0-9]))*$/;

// Des noms qui ressembleraient à l'app elle-même ou à une page du site.
const RESERVED = new Set([
  "admin",
  "administrateur",
  "administrator",
  "moderateur",
  "moderator",
  "modo",
  "staff",
  "support",
  "system",
  "systeme",
  "myplaylog",
  "mpl",
  "official",
  "officiel",
  "root",
  "api",
  "settings",
  "parametres",
  "me",
  "moi",
  "null",
  "undefined",
  "anonymous",
  "anonyme",
  "deleted",
  "supprime",
]);

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Le format seul, sans base : rend la phrase d'erreur, ou null. */
export function usernameFormatError(raw) {
  const name = String(raw ?? "").trim();
  if (name.length < USERNAME_MIN)
    return `Ton pseudo doit faire au moins ${USERNAME_MIN} caractères.`;
  if (name.length > USERNAME_MAX)
    return `Ton pseudo ne peut pas dépasser ${USERNAME_MAX} caractères.`;
  if (!ALLOWED.test(name))
    return "Lettres sans accent et chiffres ; _ . - seulement au milieu, jamais deux de suite.";
  const bare = name.toLowerCase().replace(/[._-]/g, "");
  if (RESERVED.has(name.toLowerCase()) || RESERVED.has(bare) || bare.startsWith("myplaylog"))
    return "Ce pseudo est réservé.";
  return null;
}

/** La date à partir de laquelle ce compte pourra de nouveau changer de pseudo. */
export function nextUsernameChangeAt(user) {
  if (!user?.usernameChangedAt) return null;
  const at = new Date(user.usernameChangedAt).getTime() + USERNAME_COOLDOWN_DAYS * DAY;
  return at > Date.now() ? new Date(at) : null;
}

/**
 * Tout ce qui empêche `user` (null à l'inscription) de prendre `raw`.
 * Rend `{ error, status }` ou null.
 */
export async function usernameProblem(raw, user = null) {
  const name = String(raw ?? "").trim();
  const sameIgnoringCase =
    !!user && String(user.username || "").toLowerCase() === name.toLowerCase();

  // Son propre nom, à la casse près : rien à vérifier, pas de délai.
  if (sameIgnoringCase) return null;

  const format = usernameFormatError(name);
  if (format) return { error: format, status: 400 };

  if (user) {
    const next = nextUsernameChangeAt(user);
    if (next) {
      const days = Math.max(1, Math.ceil((next.getTime() - Date.now()) / DAY));
      return {
        error: `Tu pourras changer de pseudo dans ${days} jour${days > 1 ? "s" : ""}.`,
        status: 429,
        nextChangeAt: next,
      };
    }
  }

  const re = new RegExp(`^${escapeRegex(name)}$`, "i");
  const taken = await User().findOne({ username: re }).select("_id");
  if (taken && (!user || String(taken._id) !== String(user._id)))
    return { error: "Ce pseudo est déjà pris.", status: 409 };

  // Un nom quitté récemment par quelqu'un d'autre.
  const since = new Date(Date.now() - USERNAME_COOLDOWN_DAYS * DAY);
  const held = await User().findOne({
    previousUsernames: { $elemMatch: { name: re, changedAt: { $gt: since } } },
  }).select("_id");
  if (held && (!user || String(held._id) !== String(user._id)))
    return { error: "Ce pseudo est déjà pris.", status: 409 };

  return null;
}

/**
 * Pose le nouveau pseudo sur le document (sans l'enregistrer). Un changement
 * de casse seul ne compte pas dans le délai et ne réserve rien.
 */
export function applyUsername(user, raw) {
  const name = String(raw ?? "").trim();
  if (name === user.username) return false;
  const caseOnly = name.toLowerCase() === String(user.username || "").toLowerCase();
  if (!caseOnly) {
    const history = (user.previousUsernames || []).filter(
      (p) => p.name.toLowerCase() !== name.toLowerCase()
    );
    history.push({ name: user.username, changedAt: new Date() });
    user.previousUsernames = history.slice(-10);
    user.usernameChangedAt = new Date();
  }
  user.username = name;
  return true;
}
