import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { isAdminEmail } from "../lib/admin.js";

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
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }
}

// À chaîner APRÈS requireAuth : réserve la route à l'admin (ADMIN_EMAIL).
export async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("email");
    if (!user || !isAdminEmail(user.email)) {
      return res.status(403).json({ error: "Accès réservé à l'administrateur." });
    }
    next();
  } catch {
    return res.status(500).json({ error: "Erreur d'authentification admin." });
  }
}
