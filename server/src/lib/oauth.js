// ======================================================================
//  Connexion par un tiers — Google et Discord
// ======================================================================
// UN SEUL COMPTE PAR ADRESSE EMAIL, quelle que soit la porte empruntée. Le
// mot de passe, Google et Discord ne sont pas trois comptes : ce sont trois
// CLÉS de la même porte. Quelqu'un qui s'est inscrit au mot de passe puis
// revient par Google doit retomber sur sa bibliothèque, pas sur un compte vide
// — c'est la seule règle qui compte ici, et tout le reste en découle.
//
// Ce module ne connaît que les fournisseurs : fabriquer l'URL de départ,
// échanger le code, et rendre une identité NORMALISÉE (même forme pour tous).
// Le rapprochement avec un compte du site vit dans lib/oauthAccounts.js.
//
// ⚠️ ON DEMANDE L'EMAIL, ET ON REGARDE S'IL EST VÉRIFIÉ. Sans cette
// vérification, n'importe qui créerait un compte Discord portant l'email d'un
// autre et récupérerait sa bibliothèque en un clic. Un email non vérifié est
// donc traité comme absent : on ne fusionne pas dessus.
//
// Configuration (server/.env) :
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  (console.cloud.google.com)
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET  (discord.com/developers)
//
// URLs de redirection à DÉCLARER chez les fournisseurs :
//   https://<domaine>/api/auth/oauth/google/callback
//   https://<domaine>/api/auth/oauth/discord/callback
// (la liaison Discord historique garde la sienne : /api/discord/return)

const TIMEOUT = 12_000;

export const redirectUriFor = (base, provider) =>
  `${base}/api/auth/oauth/${provider}/callback`;

// Lit une réponse de fournisseur en disant CE QUI a échoué : « Google a refusé
// l'échange (400) » se diagnostique, « erreur serveur » non.
async function readJson(res, what) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${what} (${res.status}). ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ----------------------------------------------------------------------
//  Google
// ----------------------------------------------------------------------
const google = {
  id: "google",
  label: "Google",
  isConfigured: () =>
    Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),

  buildAuthUrl(base, state) {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUriFor(base, "google"),
      response_type: "code",
      scope: "openid email profile",
      state,
      // `select_account` : sans lui, quelqu'un déjà connecté à un compte Google
      // sur sa machine est renvoyé dessus sans qu'on lui demande rien — et se
      // retrouve à lier le mauvais compte sans comprendre pourquoi.
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code, base) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUriFor(base, "google"),
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const json = await readJson(res, "Google a refusé l'échange");
    if (!json.access_token) throw new Error("Google n'a pas renvoyé de jeton.");
    return json.access_token;
  },

  async fetchProfile(accessToken) {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const u = await readJson(res, "Profil Google illisible");
    return {
      provider: "google",
      providerId: String(u.sub),
      email: (u.email || "").trim().toLowerCase() || null,
      emailVerified: u.email_verified === true || u.email_verified === "true",
      // `given_name` d'abord : « Jean » fait un meilleur pseudo de départ que
      // « Jean Dupont », qu'il faudrait de toute façon raboter.
      username: u.given_name || u.name || null,
      displayName: u.name || null,
      avatar: u.picture || null,
    };
  },
};

// ----------------------------------------------------------------------
//  Discord
// ----------------------------------------------------------------------
// Portées `identify email` : l'identité publique + l'adresse, rien d'autre.
// Aucun jeton n'est conservé après l'échange — le bot parle aux gens avec son
// propre jeton, en les désignant par leur id Discord (cf. lib/discord.js).
const discord = {
  id: "discord",
  label: "Discord",
  isConfigured: () =>
    Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),

  buildAuthUrl(base, state) {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUriFor(base, "discord"),
      response_type: "code",
      scope: "identify email",
      state,
      prompt: "consent",
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  },

  async exchangeCode(code, base) {
    const res = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUriFor(base, "discord"),
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const json = await readJson(res, "Discord a refusé l'échange");
    if (!json.access_token) throw new Error("Discord n'a pas renvoyé de jeton.");
    return json.access_token;
  },

  async fetchProfile(accessToken) {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const u = await readJson(res, "Profil Discord illisible");
    return {
      provider: "discord",
      providerId: String(u.id),
      email: (u.email || "").trim().toLowerCase() || null,
      emailVerified: u.verified === true,
      username: u.username || null,
      displayName: u.global_name || u.username || null,
      // Avatar par défaut si le compte n'en a pas : l'index se calcule sur l'id
      // (règle Discord depuis les pseudos sans discriminateur).
      avatar: u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${
            u.avatar.startsWith("a_") ? "gif" : "png"
          }?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(u.id) >> 22n) % 6n}.png`,
    };
  },
};

export const PROVIDERS = { google, discord };

export const getProvider = (name) =>
  Object.prototype.hasOwnProperty.call(PROVIDERS, name) ? PROVIDERS[name] : null;

// Ce que le client a le droit d'afficher : un bouton « Continuer avec X » qui
// mène à une page d'erreur parce que la clé manque est pire que pas de bouton.
export function configuredProviders() {
  const out = {};
  for (const [key, p] of Object.entries(PROVIDERS)) out[key] = p.isConfigured();
  return out;
}
