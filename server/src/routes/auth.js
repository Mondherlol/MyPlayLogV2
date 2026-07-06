import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

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

// --- Récupérer l'utilisateur courant (à partir du token) ---
router.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  res.json({ user: user.toPublic() });
});

export default router;
