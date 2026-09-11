import express from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { getProvider, configuredProviders } from "../lib/oauth.js";
import {
  resolveOauthLogin,
  linkProvider,
  unlinkProvider,
  canUnlink,
  loginMethods,
} from "../lib/oauthAccounts.js";
import { claimPendingPoints } from "../lib/discordPuzzle.js";
import { logEvent, ipOf } from "../lib/audit.js";

// ======================================================================
//  « Continuer avec Google » / « Continuer avec Discord »
// ======================================================================
// DEUX USAGES, UNE SEULE CHORÉGRAPHIE :
//
//   mode=login  personne n'est connecté. Au retour, on ouvre (ou on crée) le
//               compte et on renvoie le navigateur sur /auth/callback avec le
//               jeton de session.
//   mode=link   quelqu'un est déjà connecté et rattache une clé de plus à son
//               compte depuis les paramètres. Au retour, on le repose dans ses
//               paramètres avec un message.
//
// ⚠️ UNE REDIRECTION COMPLÈTE, PAS UNE POP-UP. La liaison Discord historique
// (routes/discord.js) ouvre une fenêtre et prévient la page par `postMessage` ;
// c'était bien pour un bouton perdu dans les réglages, c'est mauvais pour se
// CONNECTER : les bloqueurs de fenêtres, et surtout les navigateurs mobiles,
// avalent la pop-up — et l'écran de connexion est justement l'endroit où l'on
// ne peut pas se permettre de ne rien afficher.
//
// ⚠️ LE JETON REVIENT DANS LE FRAGMENT (#token=…), jamais dans la requête.
// Ce qui suit le « # » ne part pas au serveur, ne se retrouve pas dans les
// journaux d'accès, et ne fuit pas en `Referer` vers les images de la page.

const router = express.Router();

// Le `state` : un jeton signé, court, qui porte le contexte de l'aller. Signé
// parce qu'il DOIT nous revenir intact — c'est lui qui dit « c'est bien une
// autorisation que NOUS avons lancée », et sans ça n'importe quel site pourrait
// nous faire avaler un code d'autorisation obtenu ailleurs (CSRF de connexion).
const STATE_TTL = "10m";

function signState(payload) {
  return jwt.sign(
    { ...payload, kind: "oauth-state", nonce: crypto.randomBytes(8).toString("hex") },
    process.env.JWT_SECRET,
    { expiresIn: STATE_TTL }
  );
}

// `kind` vérifié explicitement : sans lui, un jeton de SESSION ferait un `state`
// valide, et les deux n'ont pas du tout les mêmes conséquences.
function readState(raw) {
  const data = jwt.verify(String(raw || ""), process.env.JWT_SECRET);
  if (data.kind !== "oauth-state") throw new Error("state inattendu");
  return data;
}

function signSession(userId, remember) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: remember ? "30d" : "1d",
  });
}

// Première origine autorisée = le site. Même règle que routes/auth.js.
function clientBaseUrl() {
  const first = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")[0]
    .trim();
  return first.replace(/\/$/, "");
}

// D'où le serveur se voit lui-même, pour fabriquer la redirect_uri. Derrière
// Caddy, `req.protocol` suit X-Forwarded-Proto (trust proxy est réglé).
const serverBaseUrl = (req) => `${req.protocol}://${req.get("host")}`;

// Un `next` LIBRE ferait de la connexion un tremplin vers n'importe quel site
// (« connecte-toi » → redirection vers un faux MyPlayLog). Chemin interne seul.
function safeNext(raw) {
  const value = String(raw || "");
  return value.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

// Rendre la main au site, toujours par une redirection — jamais une page
// d'erreur nue : quelqu'un bloqué sur une page blanche du domaine de l'API ne
// sait pas revenir, et croit le site cassé.
function backToClient(res, path, params) {
  const url = new URL(clientBaseUrl() + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  res.redirect(url.toString());
}

function failLogin(res, message, next) {
  backToClient(res, "/login", { oauth_error: message, next: next || undefined });
}

// ----------------------------------------------------------------------
//  L'application Android
// ----------------------------------------------------------------------
// L'app ouvre le même aller-retour dans un onglet de navigateur intégré, et
// attend d'être rappelée sur son schéma. L'adresse est FIXE, jamais lue dans
// la requête : sinon la connexion redeviendrait un tremplin vers n'importe où.
//
// ⚠️ PAS DE JETON DE SESSION DANS CE RAPPEL, MAIS UN CODE À ÉCHANGER. Un schéma
// d'URL n'appartient à personne : une autre app installée peut déclarer
// `myplaylog://` elle aussi et recevoir le rappel à notre place. On y met donc
// un code court qui ne vaut rien seul. Pour l'échanger, il faut le `nonce` que
// l'app a tiré au départ — il n'a transité que par le navigateur et notre
// serveur, jamais par le rappel — et qui n'est stocké ici que haché.
const APP_REDIRECT = "myplaylog://oauth";
const APP_CODE_TTL = "3m";

const hashNonce = (nonce) =>
  crypto.createHash("sha256").update(String(nonce)).digest("hex");

function backToApp(res, params) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") query.set(k, String(v));
  }
  res.redirect(`${APP_REDIRECT}?${query}`);
}

// Un échec rend la main à qui a lancé la demande : l'app, ou le site.
function fail(res, message, { app, next } = {}) {
  return app ? backToApp(res, { error: message }) : failLogin(res, message, next);
}

// ----------------------------------------------------------------------
//  GET /api/auth/oauth/providers — ce qui est réellement branché
// ----------------------------------------------------------------------
// Le client s'en sert pour n'afficher QUE les boutons utilisables : un
// « Continuer avec Google » qui mène à « Google non configuré » est une
// promesse qu'on ne tient pas.
router.get("/providers", (_req, res) => {
  res.json({ providers: configuredProviders() });
});

// ----------------------------------------------------------------------
//  GET /api/auth/oauth/:provider/start — le départ
// ----------------------------------------------------------------------
// `token` (facultatif) : le jeton de session, présent quand on RATTACHE une clé
// depuis les paramètres. Absent = on se connecte.
router.get("/:provider/start", (req, res) => {
  const name = String(req.params.provider || "");
  const provider = getProvider(name);
  const next = safeNext(req.query.next);
  // `app=1` : la demande vient de l'application, qui fournit son `nonce`.
  const app = req.query.app === "1";
  const nonce = String(req.query.nonce || "");

  if (!provider) return fail(res, "Fournisseur inconnu.", { app, next });
  if (!provider.isConfigured())
    return fail(res, `${provider.label} n'est pas configuré côté serveur.`, { app, next });
  if (app && (nonce.length < 16 || nonce.length > 128))
    return fail(res, "Demande de connexion invalide. Mets l'application à jour.", { app });

  // Mode liaison : il faut une session valide, et on la résout MAINTENANT — au
  // retour, le jeton pourrait avoir expiré pendant la visite chez le tiers.
  let uid = null;
  const sessionToken = String(req.query.token || "");
  if (sessionToken) {
    try {
      uid = jwt.verify(sessionToken, process.env.JWT_SECRET).sub;
    } catch {
      return failLogin(res, "Session expirée, reconnecte-toi.", next);
    }
  }

  const state = signState({
    p: name,
    mode: uid ? "link" : "login",
    uid,
    next,
    // Se souvenir de moi : coché par défaut sur les écrans de connexion, et un
    // aller-retour chez un tiers n'est pas le moment de redemander à l'écrit.
    remember: req.query.remember === "0" ? 0 : 1,
  });

  res.redirect(provider.buildAuthUrl(serverBaseUrl(req), state));
});

// ----------------------------------------------------------------------
//  GET /api/auth/oauth/:provider/callback — le retour
// ----------------------------------------------------------------------
router.get("/:provider/callback", async (req, res) => {
  const name = String(req.params.provider || "");
  const provider = getProvider(name);
  if (!provider) return failLogin(res, "Fournisseur inconnu.");

  // Le state d'abord : c'est lui qui dit où renvoyer les gens en cas d'échec.
  let state;
  try {
    state = readState(req.query.state);
  } catch {
    return failLogin(res, "Demande d'autorisation expirée ou invalide. Réessaie.");
  }
  const next = safeNext(state.next);
  const backToSettings = (params) =>
    backToClient(res, "/settings", { tab: "account", ...params });

  // Le fournisseur a dit non (bouton « Annuler »), ou le state ne correspond
  // pas au fournisseur qu'on rappelle : on ne va pas plus loin.
  if (req.query.error || state.p !== name) {
    const message = "Autorisation refusée.";
    return state.mode === "link"
      ? backToSettings({ link_error: message })
      : failLogin(res, message, next);
  }

  const code = String(req.query.code || "");
  if (!code) {
    const message = "Code d'autorisation manquant.";
    return state.mode === "link"
      ? backToSettings({ link_error: message })
      : failLogin(res, message, next);
  }

  try {
    const base = serverBaseUrl(req);
    const profile = await provider.fetchProfile(await provider.exchangeCode(code, base));

    // ---- Rattacher une clé à un compte déjà connecté ----
    if (state.mode === "link") {
      const me = await User.findById(state.uid);
      if (!me) return failLogin(res, "Compte introuvable.", next);
      await linkProvider(me, profile);
      if (name === "discord") await claimPendingPoints(profile.providerId, me._id);
      logEvent({
        kind: "auth",
        label: `a lié son compte ${provider.label}`,
        actor: me._id,
        actorName: me.username,
        ip: ipOf(req),
        ua: req.headers["user-agent"] || "",
      });
      return backToSettings({ linked: name });
    }

    // ---- Se connecter / s'inscrire ----
    const { user, created, merged } = await resolveOauthLogin(profile);

    // Les points gagnés aux mini-jeux Discord AVANT d'avoir lié son compte
    // tombent maintenant : c'est la promesse faite par le bot dans le salon.
    if (name === "discord") await claimPendingPoints(profile.providerId, user._id);

    const remember = state.remember !== 0;
    logEvent({
      kind: "auth",
      label: created
        ? `a créé son compte avec ${provider.label}`
        : `s'est connecté avec ${provider.label}`,
      actor: user._id,
      actorName: user.username,
      ip: ipOf(req),
      ua: req.headers["user-agent"] || "",
      meta: { provider: name, merged },
    });

    // Le fragment : ce qui suit le « # » reste dans le navigateur.
    const url = new URL(clientBaseUrl() + "/auth/callback");
    const hash = new URLSearchParams({
      token: signSession(user.id, remember),
      next,
      remember: remember ? "1" : "0",
      provider: name,
      status: created ? "created" : merged ? "merged" : "ok",
    });
    res.redirect(`${url.toString()}#${hash}`);
  } catch (err) {
    console.error(`oauth ${name} callback error:`, err.message);
    const message =
      err.code === "NO_EMAIL" || err.code === "CLASH"
        ? err.message
        : `La connexion avec ${provider.label} a échoué. Réessaie.`;
    return state.mode === "link"
      ? backToSettings({ link_error: message })
      : failLogin(res, message, next);
  }
});

// ----------------------------------------------------------------------
//  GET /api/auth/oauth/status — mes clés
// ----------------------------------------------------------------------
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("+passwordHash google discord email");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
    res.json({
      providers: configuredProviders(),
      methods: loginMethods(user),
      email: user.email,
      google: user.google?.googleId
        ? {
            email: user.google.email || null,
            name: user.google.name || null,
            avatar: user.google.avatar || null,
            connectedAt: user.google.connectedAt || null,
          }
        : null,
      discord: user.discord?.discordId
        ? {
            username: user.discord.username || null,
            globalName: user.discord.globalName || null,
            avatar: user.discord.avatar || null,
            connectedAt: user.discord.connectedAt || null,
          }
        : null,
    });
  } catch (err) {
    console.error("oauth status error:", err.message);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// ----------------------------------------------------------------------
//  DELETE /api/auth/oauth/:provider — retirer une clé
// ----------------------------------------------------------------------
router.delete("/:provider", requireAuth, async (req, res) => {
  try {
    const name = String(req.params.provider || "");
    if (!getProvider(name)) return res.status(400).json({ error: "Fournisseur inconnu." });

    const user = await User.findById(req.userId).select("+passwordHash");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    // Le garde-fou : personne ne se met dehors d'un clic. La sortie est
    // indiquée dans le message, sinon le refus est une impasse.
    if (!canUnlink(user, name)) {
      return res.status(409).json({
        error:
          "C'est ta seule façon de te connecter. Donne-toi d'abord un mot de passe (« Mot de passe oublié ») avant de la retirer.",
      });
    }

    await unlinkProvider(user, name);
    logEvent({
      kind: "auth",
      label: `a délié son compte ${name === "google" ? "Google" : "Discord"}`,
      actor: user._id,
      actorName: user.username,
      ip: ipOf(req),
      ua: req.headers["user-agent"] || "",
    });
    res.json({ ok: true, methods: loginMethods(user) });
  } catch (err) {
    console.error("oauth unlink error:", err.message);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

export default router;
