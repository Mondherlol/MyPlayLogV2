import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isUserAdmin } from "../lib/admin.js";

// Présence : on note le dernier passage de chaque utilisateur (affiché sur son
// profil). Throttlé en mémoire pour ne pas écrire en base à chaque requête.
const SEEN_THROTTLE = 3 * 60 * 1000; // 3 min
const lastSeenWrites = new Map(); // userId -> timestamp de la dernière écriture

function touchLastSeen(userId) {
  const now = Date.now();
  const prev = lastSeenWrites.get(userId) || 0;
  if (now - prev < SEEN_THROTTLE) return;
  lastSeenWrites.set(userId, now);
  // Fire-and-forget : la présence ne doit jamais ralentir ni casser une requête.
  User.updateOne({ _id: userId }, { $set: { lastSeenAt: new Date() } }, { timestamps: false }).catch(
    () => lastSeenWrites.delete(userId)
  );
}

// Vérifie le token JWT présent dans l'en-tête Authorization: Bearer <token>
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Non authentifié." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    touchLastSeen(payload.sub);
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }
}

// Variante « douce » : si un token valide est présent, on renseigne req.userId
// (le viewer est alors reconnu — isMe, likes, abonnements…). Sinon on laisse
// passer en invité (req.userId reste undefined). Sert aux pages publiques
// partageables (profils en lecture seule) où l'on ne veut PAS bloquer les
// visiteurs déconnectés.
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = payload.sub;
      touchLastSeen(payload.sub);
    } catch {
      /* token invalide/expiré : on continue en invité, sans 401. */
    }
  }
  next();
}

// À chaîner APRÈS requireAuth : réserve la route aux administrateurs (le
// super-admin ou tout compte promu isAdmin). Renseigne au passage
// req.isSuperAdmin pour les actions réservées au super-admin.
export async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("isAdmin isSuperAdmin");
    if (!isUserAdmin(user)) {
      return res.status(403).json({ error: "Accès réservé à l'administrateur." });
    }
    req.isSuperAdmin = !!user.isSuperAdmin;
    next();
  } catch {
    return res.status(500).json({ error: "Erreur d'authentification admin." });
  }
}
