// Intégration PSN (API non officielle, via la lib psn-api).
// Authentification par NPSSO (secret de session du compte PlayStation de
// l'utilisateur) → tokens access/refresh stockés sur son compte MyPlayLog.
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getUserTitles,
  getTitleTrophies,
  getUserTrophiesEarnedForTitle,
} from "psn-api";

const auth = (accessToken) => ({ accessToken });

// Transforme la réponse d'auth psn-api en objet stockable (dates absolues).
function toStored(a) {
  const now = Date.now();
  return {
    accessToken: a.accessToken,
    refreshToken: a.refreshToken,
    // On retire 60s de marge pour rafraîchir avant expiration réelle.
    expiresAt: now + (a.expiresIn - 60) * 1000,
    refreshExpiresAt: now + (a.refreshTokenExpiresIn - 60) * 1000,
  };
}

// Échange un NPSSO contre des tokens. Lève si le NPSSO est invalide/expiré.
export async function connectWithNpsso(npsso) {
  const accessCode = await exchangeNpssoForAccessCode(String(npsso).trim());
  const authTokens = await exchangeAccessCodeForAuthTokens(accessCode);
  return toStored(authTokens);
}

// Renvoie un accessToken valide (rafraîchit + persiste si besoin), ou null si
// non connecté / refresh token périmé (reconnexion requise).
export async function getValidAccessToken(user) {
  const psn = user.psn;
  if (!psn || !psn.refreshToken) return null;
  if (psn.accessToken && Date.now() < psn.expiresAt) return psn.accessToken;
  if (Date.now() >= psn.refreshExpiresAt) return null;

  const authTokens = await exchangeRefreshTokenForAuthTokens(psn.refreshToken);
  const stored = toStored(authTokens);
  user.psn.accessToken = stored.accessToken;
  user.psn.refreshToken = stored.refreshToken;
  user.psn.expiresAt = stored.expiresAt;
  user.psn.refreshExpiresAt = stored.refreshExpiresAt;
  await user.save();
  return stored.accessToken;
}

// Liste des titres (jeux) pour lesquels l'utilisateur a des trophées.
export async function fetchUserTitles(accessToken) {
  const all = [];
  let offset = 0;
  for (let i = 0; i < 8; i++) {
    const res = await getUserTitles(auth(accessToken), "me", { limit: 100, offset });
    const titles = res.trophyTitles || [];
    all.push(...titles);
    if (titles.length < 100 || all.length >= 800) break;
    offset += 100;
  }
  return all;
}

// Trophées d'un titre (définitions + statut gagné/pas gagné fusionnés).
export async function fetchTitleTrophies(accessToken, npCommunicationId, npServiceName) {
  const opts = npServiceName ? { npServiceName } : {};
  const [defs, earned] = await Promise.all([
    getTitleTrophies(auth(accessToken), npCommunicationId, "all", opts),
    getUserTrophiesEarnedForTitle(auth(accessToken), "me", npCommunicationId, "all", opts).catch(
      () => null
    ),
  ]);
  const earnedMap = new Map((earned?.trophies || []).map((t) => [t.trophyId, t]));
  return (defs.trophies || []).map((t) => {
    const e = earnedMap.get(t.trophyId) || {};
    return {
      id: t.trophyId,
      name: t.trophyName || "",
      detail: t.trophyDetail || "",
      icon: t.trophyIconUrl || null,
      type: t.trophyType || "bronze", // bronze|silver|gold|platinum
      hidden: !!t.trophyHidden,
      earned: !!e.earned,
      earnedAt: e.earnedDateTime || null,
      percent:
        e.trophyEarnedRate != null
          ? Math.round(Number(e.trophyEarnedRate) * 10) / 10
          : null,
    };
  });
}
