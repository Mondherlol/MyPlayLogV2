// ======================================================================
//  Discord — OAuth2 « identify »
// ======================================================================
// Lier son compte Discord à son compte MyPlayLog. On ne demande QUE la portée
// `identify` : le pseudo, l'id et l'avatar. Pas d'email, pas de liste de
// serveurs, aucun droit d'écrire à la place de l'utilisateur.
//
// LE JETON N'EST PAS CONSERVÉ. Une fois l'identité récupérée, il ne sert plus à
// rien : quand le bot Discord parlera aux gens, il le fera avec SON propre
// jeton de bot, en désignant les gens par leur id Discord. Garder des jetons
// d'utilisateurs serait un passif de sécurité pour un service qu'on n'utilise
// pas.
//
// Configuration (server/.env) — à créer sur https://discord.com/developers :
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
// et, dans l'onglet OAuth2 de l'application, déclarer l'URL de redirection :
//   https://<domaine>/api/discord/return

const API = "https://discord.com/api/v10";

export function isConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export const redirectUri = (base) => `${base}/api/discord/return`;

// L'URL vers laquelle envoyer la pop-up. `state` porte le jeton de session : il
// nous revient tel quel au retour, et c'est lui qui dit QUI est en train de
// lier son compte (même mécanique que la liaison Steam).
export function buildAuthUrl(base, state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(base),
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// Échange le code contre un jeton d'accès (utilisé une seule fois, jamais gardé).
export async function exchangeCode(code, base) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(base),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord a refusé l'échange (${res.status}). ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("Discord n'a pas renvoyé de jeton.");
  return json.access_token;
}

// L'identité publique du compte qui vient d'autoriser.
export async function fetchMe(accessToken) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Profil Discord illisible (${res.status}).`);
  const u = await res.json();
  return {
    discordId: String(u.id),
    username: u.username || null,
    globalName: u.global_name || null,
    // Avatar par défaut si le compte n'en a pas : l'index se calcule sur l'id
    // (règle Discord depuis les pseudos sans discriminateur).
    avatar: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${
          u.avatar.startsWith("a_") ? "gif" : "png"
        }?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${(BigInt(u.id) >> 22n) % 6n}.png`,
  };
}
