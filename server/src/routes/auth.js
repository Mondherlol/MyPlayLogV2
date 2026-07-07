import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { sendMail } from "../lib/mailer.js";

const router = express.Router();

// Durée de validité d'un lien de réinitialisation.
const RESET_TTL_MS = 60 * 60 * 1000; // 1 heure

// Première origine autorisée = base des liens envoyés par email.
function clientBaseUrl() {
  const first = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")[0]
    .trim();
  return first.replace(/\/$/, "");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Durée du token : plus longue si "se souvenir de moi" est coché
function signToken(userId, remember) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: remember ? "30d" : "1d",
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- Inscription : email + identifiant + mot de passe ---
router.post("/register", async (req, res) => {
  try {
    let { email, username, password } = req.body || {};
    email = (email || "").trim().toLowerCase();
    username = (username || "").trim();

    if (!email || !username || !password) {
      return res.status(400).json({ error: "Tous les champs sont requis." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Email invalide." });
    }
    if (password.length < 3) {
      return res
        .status(400)
        .json({ error: "Le mot de passe doit faire au moins 3 caractères." });
    }

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) {
      const field = exists.email === email ? "email" : "identifiant";
      return res.status(409).json({ error: `Cet ${field} est déjà utilisé.` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, username, passwordHash });

    const token = signToken(user.id, false);
    res.status(201).json({ token, user: user.toPublic() });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// --- Connexion : identifiant OU email + mot de passe (+ remember) ---
router.post("/login", async (req, res) => {
  try {
    let { identifier, password, remember } = req.body || {};
    identifier = (identifier || "").trim();

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ error: "Identifiant/email et mot de passe requis." });
    }

    const query = identifier.includes("@")
      ? { email: identifier.toLowerCase() }
      : { username: identifier };
    const user = await User.findOne(query);

    if (!user) {
      return res.status(401).json({ error: "Identifiants incorrects." });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Identifiants incorrects." });
    }

    const token = signToken(user.id, !!remember);
    res.json({ token, user: user.toPublic() });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// --- Mot de passe oublié : envoie un lien de réinitialisation par email ---
router.post("/forgot-password", async (req, res) => {
  try {
    let { email } = req.body || {};
    email = (email || "").trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Email invalide." });
    }

    const user = await User.findOne({ email });

    // On ne révèle jamais si l'email existe (anti-énumération) : même réponse.
    if (user) {
      // Token en clair envoyé par mail, hash stocké en base.
      const token = crypto.randomBytes(32).toString("hex");
      user.resetTokenHash = hashToken(token);
      user.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
      await user.save();

      const link = `${clientBaseUrl()}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Réinitialise ton mot de passe MyPlayLog",
        text:
          `Salut ${user.username},\n\n` +
          `Tu as demandé à réinitialiser ton mot de passe.\n` +
          `Ouvre ce lien (valable 1 heure) : ${link}\n\n` +
          `Si tu n'es pas à l'origine de cette demande, ignore cet email.`,
        html: resetEmailHtml(user.username, link),
      });
    }

    res.json({
      ok: true,
      message:
        "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé.",
    });
  } catch (err) {
    console.error("forgot-password error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// --- Réinitialisation : consomme le token et fixe le nouveau mot de passe ---
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};

    if (!token || !password) {
      return res
        .status(400)
        .json({ error: "Token et nouveau mot de passe requis." });
    }
    if (password.length < 3) {
      return res
        .status(400)
        .json({ error: "Le mot de passe doit faire au moins 3 caractères." });
    }

    const user = await User.findOne({
      resetTokenHash: hashToken(token),
      resetTokenExpires: { $gt: new Date() },
    }).select("+resetTokenHash +resetTokenExpires");

    if (!user) {
      return res
        .status(400)
        .json({ error: "Lien invalide ou expiré. Refais une demande." });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    await user.save();

    // Connexion directe après réinitialisation.
    const authToken = signToken(user.id, false);
    res.json({ token: authToken, user: user.toPublic() });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// Gabarit HTML de l'email de réinitialisation (couleurs MyPlayLog).
function resetEmailHtml(username, link) {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#0c0d11;padding:32px;color:#f2f3f6">
    <div style="max-width:480px;margin:0 auto;background:#14161c;border:1px solid #23262f;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(100deg,#eaa908,#ffcf3a);padding:20px 24px;color:#1a1204;font-size:20px;font-weight:700">
        MyPlayLog
      </div>
      <div style="padding:24px">
        <h1 style="font-size:20px;margin:0 0 12px">Salut ${username} 👋</h1>
        <p style="color:#9a9dab;line-height:1.6;margin:0 0 20px">
          Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton
          ci-dessous pour en choisir un nouveau. Ce lien expire dans 1 heure.
        </p>
        <a href="${link}" style="display:inline-block;background:linear-gradient(100deg,#eaa908,#ffcf3a);color:#1a1204;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">
          Choisir un nouveau mot de passe
        </a>
        <p style="color:#6b6c76;font-size:13px;line-height:1.6;margin:24px 0 0">
          Si tu n'es pas à l'origine de cette demande, ignore simplement cet
          email : ton mot de passe reste inchangé.
        </p>
      </div>
    </div>
  </div>`;
}

// --- Récupérer l'utilisateur courant (à partir du token) ---
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  res.json({ user: user.toPublic() });
});

export default router;
