// ======================================================================
//  Rapprocher une identité tierce et un compte du site
// ======================================================================
// LE CŒUR DE LA FUSION. Trois cas, dans cet ordre, et l'ordre est la seule
// chose importante de ce fichier :
//
//   1. CE COMPTE GOOGLE/DISCORD EST DÉJÀ LIÉ → c'est lui, on ouvre. Ce test
//      passe AVANT l'email : quelqu'un qui change l'adresse de son compte
//      Google doit continuer d'atterrir sur SON compte, et non s'en voir
//      fabriquer un second.
//   2. UNE ADRESSE VÉRIFIÉE QUI EXISTE DÉJÀ → on RATTACHE la clé au compte
//      existant. C'est la fusion promise : mot de passe, Google et Discord
//      deviennent trois façons d'ouvrir la même porte.
//   3. SINON → on crée le compte, sans mot de passe (il pourra s'en donner un
//      via « mot de passe oublié », son adresse est déjà vérifiée chez le
//      fournisseur).
//
// ⚠️ UN EMAIL NON VÉRIFIÉ NE FUSIONNE JAMAIS. Sinon il suffirait de déclarer
// l'adresse de quelqu'un d'autre chez un fournisseur laxiste pour hériter de sa
// bibliothèque. Sans email utilisable, on refuse plutôt que de créer un doublon
// silencieux.
import crypto from "node:crypto";
import User from "../models/User.js";

// Où vit l'identifiant du fournisseur dans le document utilisateur.
const ID_PATH = { google: "google.googleId", discord: "discord.discordId" };

export const idPathOf = (provider) => ID_PATH[provider] || null;

const labelOf = (provider) => (provider === "google" ? "Google" : "Discord");

// L'instantané d'identité rangé sous le compte. On garde le strict nécessaire
// à l'affichage (pseudo, avatar) : aucun jeton, aucune portée, rien à révoquer.
function snapshotFor(profile) {
  if (profile.provider === "google") {
    return {
      google: {
        googleId: profile.providerId,
        email: profile.email || null,
        name: profile.displayName || null,
        avatar: profile.avatar || null,
        connectedAt: new Date(),
      },
    };
  }
  return {
    discord: {
      discordId: profile.providerId,
      username: profile.username || null,
      globalName: profile.displayName || null,
      avatar: profile.avatar || null,
      connectedAt: new Date(),
    },
  };
}

// ----------------------------------------------------------------------
//  Fabriquer un pseudo libre à partir de ce que le fournisseur nous donne
// ----------------------------------------------------------------------
// Le pseudo est unique sur le site, et celui d'un compte Google ne l'est pas :
// il y a des milliers de « Jean ». On part de la graine, on la rabote, et on y
// accroche un suffixe tant que la place est prise.
function slugifyUsername(seed) {
  const base = String(seed || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 20);
  return base.length >= 3 ? base : "";
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function uniqueUsername(...seeds) {
  const base = seeds.map(slugifyUsername).find(Boolean) || "joueur";
  // Recherche insensible à la casse : « Jean » et « jean » seraient deux
  // comptes qu'on confondrait partout ailleurs.
  const taken = async (name) =>
    Boolean(
      await User.findOne({
        username: new RegExp(`^${escapeRegex(name)}$`, "i"),
      }).select("_id")
    );

  if (!(await taken(base))) return base;
  // Quelques essais courts et lisibles (jean2, jean3…), puis on tranche avec du
  // hasard : mieux vaut « jean-a4f1 » qu'une boucle qui compte jusqu'à mille.
  const stem = base.slice(0, 16);
  for (let n = 2; n <= 9; n++) {
    const candidate = `${stem}${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = `${stem}-${crypto.randomBytes(2).toString("hex")}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${stem}-${crypto.randomBytes(4).toString("hex")}`;
}

// ----------------------------------------------------------------------
//  Le compte déjà lié à cette identité tierce
// ----------------------------------------------------------------------
export function findByProvider(provider, providerId) {
  const path = idPathOf(provider);
  if (!path) return null;
  return User.findOne({ [path]: String(providerId) });
}

// Un autre compte que `selfId` porte-t-il déjà cette identité ? Une clé ne peut
// ouvrir qu'une porte : sans ça, deux comptes se partageraient les points des
// mini-jeux Discord, et « me connecter avec Google » deviendrait ambigu.
export function findClash(provider, providerId, selfId) {
  const path = idPathOf(provider);
  if (!path) return null;
  return User.findOne({ [path]: String(providerId), _id: { $ne: selfId } }).select(
    "_id username"
  );
}

// ----------------------------------------------------------------------
//  Le rapprochement complet (connexion / inscription par un tiers)
// ----------------------------------------------------------------------
// Rend `{ user, created, merged }` : `created` = un compte vient de naître,
// `merged` = la clé vient d'être rattachée à un compte qui existait déjà. Les
// deux servent au message affiché au retour — « bienvenue » et « c'est bien
// ton compte » ne se disent pas de la même façon.
export async function resolveOauthLogin(profile) {
  // 1. Déjà lié : c'est lui.
  const linked = await findByProvider(profile.provider, profile.providerId);
  if (linked) {
    Object.assign(linked, snapshotFor(profile));
    await linked.save();
    return { user: linked, created: false, merged: false };
  }

  // Sans adresse utilisable, on ne peut ni fusionner ni créer : le compte du
  // site est indexé par email, et en inventer un fabriquerait un orphelin.
  if (!profile.email || !profile.emailVerified) {
    throw Object.assign(
      new Error(
        `Ton compte ${labelOf(profile.provider)} n'a pas d'adresse email vérifiée. ` +
          `Vérifie-la chez ${labelOf(profile.provider)}, ou connecte-toi par email.`
      ),
      { code: "NO_EMAIL" }
    );
  }

  // 2. Même adresse, vérifiée chez le fournisseur : on rattache.
  const byEmail = await User.findOne({ email: profile.email });
  if (byEmail) {
    Object.assign(byEmail, snapshotFor(profile));
    // Un compte sans photo hérite de celle du fournisseur : c'est l'occasion,
    // et un avatar déjà choisi ne doit évidemment jamais être écrasé.
    if (!byEmail.avatar && profile.avatar) byEmail.avatar = profile.avatar;
    await byEmail.save();
    return { user: byEmail, created: false, merged: true };
  }

  // 3. Personne : on crée.
  const username = await uniqueUsername(
    profile.username,
    profile.displayName,
    profile.email.split("@")[0]
  );
  const user = await User.create({
    email: profile.email,
    username,
    // Pas de mot de passe : ce compte s'ouvre avec sa clé tierce. Il pourra
    // s'en donner un quand il voudra (« mot de passe oublié » sait le poser).
    passwordHash: null,
    avatar: profile.avatar || null,
    ...snapshotFor(profile),
  });
  return { user, created: true, merged: false };
}

// Rattacher une identité à un compte DÉJÀ connecté (depuis les paramètres).
export async function linkProvider(user, profile) {
  const clash = await findClash(profile.provider, profile.providerId, user._id);
  if (clash) {
    throw Object.assign(
      new Error(
        `Ce compte ${labelOf(profile.provider)} est déjà lié à un autre compte MyPlayLog.`
      ),
      { code: "CLASH" }
    );
  }
  Object.assign(user, snapshotFor(profile));
  if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
  await user.save();
  return user;
}

// ----------------------------------------------------------------------
//  Délier — et le garde-fou qui évite de se mettre dehors
// ----------------------------------------------------------------------
// Retirer sa dernière clé, c'est se condamner à ne plus jamais rentrer. On
// refuse, en disant quoi faire : se donner un mot de passe d'abord.
export function loginMethods(user) {
  return {
    password: Boolean(user.passwordHash),
    google: Boolean(user.google?.googleId),
    discord: Boolean(user.discord?.discordId),
  };
}

export function canUnlink(user, provider) {
  const methods = loginMethods(user);
  return Object.entries(methods).some(([key, on]) => on && key !== provider);
}

export function unlinkProvider(user, provider) {
  if (provider === "google") {
    user.google = {
      googleId: null,
      email: null,
      name: null,
      avatar: null,
      connectedAt: null,
    };
  } else {
    user.discord = {
      discordId: null,
      username: null,
      globalName: null,
      avatar: null,
      connectedAt: null,
    };
  }
  return user.save();
}
