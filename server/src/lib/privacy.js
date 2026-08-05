// Confidentialité des profils : compte privé + sous-options (photo, bannière,
// reviews). Partagé par les routes /users, /games et /feed.
//
// ⚠️ Toutes les fonctions lisent `owner.privacy` : une route qui charge son
// utilisateur avec un `.select(…)` DOIT y inclure "privacy", sinon le profil
// sera considéré public (et le contenu fuiterait).
import User from "../models/User.js";

// Réglages effectifs : les options fines ne s'appliquent QUE si le compte est
// privé — ce sont des sous-options de « compte privé », pas des réglages
// indépendants. Repasser public rend donc tout visible d'un coup.
export function privacyOf(owner) {
  const p = owner?.privacy || {};
  const isPrivate = !!p.isPrivate;
  return {
    isPrivate,
    hideAvatar: isPrivate && !!p.hideAvatar,
    hideCover: isPrivate && !!p.hideCover,
    hideReviews: isPrivate && !!p.hideReviews,
  };
}

// Le lecteur est-il abonné à ce profil ? (une requête ciblée, sans charger la
// liste d'abonnements complète du lecteur)
export async function isFollower(ownerId, viewerId) {
  if (!viewerId || !ownerId) return false;
  if (String(ownerId) === String(viewerId)) return true;
  return !!(await User.exists({ _id: viewerId, following: ownerId }));
}

// Contexte de lecture d'un profil : moi / abonné / verrouillé.
export async function viewContext(owner, viewerId) {
  const isMe = !!viewerId && String(owner._id) === String(viewerId);
  const following = isMe ? false : await isFollower(owner._id, viewerId);
  const { isPrivate } = privacyOf(owner);
  return { isMe, isFollowing: following, locked: isPrivate && !isMe && !following };
}

// Garde à poser en tête des routes d'un profil : répond 403 et renvoie true
// quand le compte est privé et que le lecteur n'y a pas accès.
export async function blockIfPrivate(res, owner, viewerId) {
  const { locked } = await viewContext(owner, viewerId);
  if (!locked) return false;
  res.status(403).json({ error: "Ce compte est privé.", locked: true });
  return true;
}

// Le lecteur a-t-il déjà une demande d'abonnement en attente ici ?
export function hasPendingRequest(owner, viewerId) {
  if (!viewerId) return false;
  return (owner?.followRequests || []).some(
    (r) => String(r.user?._id || r.user) === String(viewerId)
  );
}

// ============================================================
//  Masquage global des photos de profil
// ============================================================
// La photo d'un compte privé qui a coché « masquer ma photo » est sérialisée
// par des dizaines d'endpoints (recherche, abonnés, OST, commentaires,
// notifications, fil…). Plutôt que de patcher chaque endroit — et d'en oublier
// au prochain ajout —, on filtre la RÉPONSE JSON en sortie (middleware
// avatarPrivacy). Ces deux fonctions fournissent la liste à masquer.

// Cache des comptes concernés : minuscule, et VIDE tant que personne n'active
// l'option — auquel cas le middleware ne fait strictement rien.
const MASK_TTL = 30 * 1000;
let maskCache = { at: 0, users: null };

export function invalidateAvatarMask() {
  maskCache = { at: 0, users: null };
}

export async function maskedAvatarUsers() {
  if (maskCache.users && Date.now() - maskCache.at < MASK_TTL) return maskCache.users;
  const users = await User.find({
    "privacy.isPrivate": true,
    "privacy.hideAvatar": true,
  })
    .select("_id username")
    .lean();
  maskCache = { at: Date.now(), users };
  return users;
}

// Ensembles (ids + pseudos) à masquer POUR CE LECTEUR : ses propres photos et
// celles des comptes auxquels il est abonné restent visibles. Renvoie null
// quand il n'y a rien à masquer — le middleware saute alors le parcours.
export async function avatarMaskFor(viewerId) {
  const all = await maskedAvatarUsers();
  if (!all.length) return null;
  const me = viewerId
    ? await User.findById(viewerId).select("following").lean()
    : null;
  const follows = new Set((me?.following || []).map(String));
  const ids = new Set();
  const names = new Set();
  for (const u of all) {
    const id = String(u._id);
    if (id === String(viewerId) || follows.has(id)) continue;
    ids.add(id);
    if (u.username) names.add(u.username);
  }
  return ids.size ? { ids, names } : null;
}

// Reviews visibles hors du profil (page d'un jeu, fil…) : construit un
// prédicat `(author) => bool` à partir des abonnements du lecteur. Une seule
// requête, quel que soit le nombre de reviews à filtrer.
export async function reviewVisibility(viewerId) {
  const me = viewerId
    ? await User.findById(viewerId).select("following").lean()
    : null;
  const follows = new Set((me?.following || []).map(String));
  return (author) => {
    if (!author) return true; // entrée orpheline : laissée aux routes appelantes
    const id = String(author._id || author);
    if (viewerId && id === String(viewerId)) return true; // toujours mes reviews
    if (follows.has(id)) return true; // abonné : accès complet
    return !privacyOf(author).hideReviews;
  };
}
