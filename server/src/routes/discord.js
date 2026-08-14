import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { isConfigured, buildAuthUrl, exchangeCode, fetchMe } from "../lib/discord.js";

// ======================================================================
//  Liaison du compte Discord
// ======================================================================
// Même chorégraphie que la liaison Steam (routes/steam.js) : une pop-up part
// vers le fournisseur, revient sur /return, et prévient la page parente par
// `postMessage` avant de se fermer. Rien à recharger côté app.
//
// Le jeton de session voyage en `state` — c'est ce que ce paramètre est fait
// pour transporter, et il nous revient signé par nous-mêmes : impossible de
// rattacher un Discord au compte de quelqu'un d'autre sans son jeton.

const router = express.Router();

// Petite page servie dans la pop-up : prévient l'app parente puis se ferme.
function closerPage(ok, error) {
  const payload = JSON.stringify({ type: "mpl-discord", ok, error: error || null });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Discord</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0c0d11;color:#f2f3f6;font-family:system-ui,Arial,sans-serif;text-align:center}
.box{max-width:340px;padding:28px}.dot{width:44px;height:44px;border-radius:50%;margin:0 auto 16px;
background:${ok ? "#5865F2" : "#c0392b"};display:flex;align-items:center;justify-content:center;font-size:24px}
</style></head><body><div class="box"><div class="dot">${ok ? "✓" : "!"}</div>
<h2 style="margin:.2em 0">${ok ? "Compte Discord lié" : "Échec de la liaison"}</h2>
<p style="color:#9a9dab">${ok ? "Tu peux fermer cette fenêtre." : error || "Réessaie depuis les paramètres."}</p></div>
<script>try{window.opener&&window.opener.postMessage(${payload},"*");}catch(e){}
setTimeout(function(){window.close();},${ok ? 800 : 2500});</script></body></html>`;
}

const publicDiscord = (d) =>
  d?.discordId
    ? {
        username: d.username || null,
        globalName: d.globalName || null,
        avatar: d.avatar || null,
        connectedAt: d.connectedAt || null,
      }
    : null;

// GET /api/discord/status — l'état de la liaison.
router.get("/status", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("discord");
    res.json({
      configured: isConfigured(),
      connected: !!user?.discord?.discordId,
      discord: publicDiscord(user?.discord),
    });
  } catch (err) {
    console.error("discord status error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

// GET /api/discord/login?token=… — départ vers Discord (ouvert en pop-up).
router.get("/login", (req, res) => {
  try {
    if (!isConfigured())
      return res.status(503).send(closerPage(false, "Discord non configuré côté serveur."));
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send(closerPage(false, "Session manquante."));
    try {
      jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).send(closerPage(false, "Session invalide."));
    }
    const base = `${req.protocol}://${req.get("host")}`;
    res.redirect(buildAuthUrl(base, token));
  } catch (err) {
    console.error("discord login error:", err.message);
    res.status(500).send(closerPage(false, "Erreur serveur."));
  }
});

// GET /api/discord/return — retour d'autorisation.
router.get("/return", async (req, res) => {
  try {
    if (req.query.error)
      return res.status(400).send(closerPage(false, "Autorisation refusée."));

    let userId = null;
    try {
      userId = jwt.verify(String(req.query.state || ""), process.env.JWT_SECRET).sub;
    } catch {
      return res.status(401).send(closerPage(false, "Session invalide."));
    }

    const code = String(req.query.code || "");
    if (!code) return res.status(400).send(closerPage(false, "Code manquant."));

    const base = `${req.protocol}://${req.get("host")}`;
    const profile = await fetchMe(await exchangeCode(code, base));

    // Un compte Discord ne peut être lié qu'à un seul compte du site : sans
    // ça, deux personnes se partageraient les points du bot Discord.
    const clash = await User.findOne({
      "discord.discordId": profile.discordId,
      _id: { $ne: userId },
    }).select("_id");
    if (clash)
      return res.status(409).send(closerPage(false, "Ce compte Discord est déjà lié ailleurs."));

    const user = await User.findById(userId);
    if (!user) return res.status(404).send(closerPage(false, "Utilisateur introuvable."));

    user.discord = { ...profile, connectedAt: new Date() };
    await user.save();
    res.send(closerPage(true));
  } catch (err) {
    console.error("discord return error:", err.message);
    res.status(500).send(closerPage(false, "Erreur serveur."));
  }
});

// POST /api/discord/link-manual — repli : coller son identifiant Discord.
// Volontairement RÉSERVÉ AUX ADMINS : à la différence de Steam (où l'on vérifie
// l'existence du profil auprès de Steam), rien ici ne prouve que l'id collé est
// le sien. Ouvert à tous, n'importe qui s'attribuerait le Discord d'un autre et
// récolterait ses points.
router.post("/link-manual", requireAuth, async (req, res) => {
  try {
    const me = await User.findById(req.userId);
    if (!me) return res.status(404).json({ error: "Utilisateur introuvable." });
    if (!me.isAdmin && !me.isSuperAdmin)
      return res.status(403).json({ error: "Passe par le bouton « Lier mon Discord »." });

    const id = String(req.body?.discordId || "").trim();
    if (!/^\d{17,20}$/.test(id))
      return res.status(400).json({ error: "Identifiant Discord invalide." });

    const clash = await User.findOne({
      "discord.discordId": id,
      _id: { $ne: req.userId },
    }).select("_id");
    if (clash) return res.status(409).json({ error: "Ce compte Discord est déjà lié ailleurs." });

    me.discord = {
      discordId: id,
      username: String(req.body?.username || "").slice(0, 40) || null,
      globalName: null,
      avatar: null,
      connectedAt: new Date(),
    };
    await me.save();
    res.json({ connected: true, discord: publicDiscord(me.discord) });
  } catch (err) {
    console.error("discord link-manual error:", err.message);
    res.status(500).json({ error: "Erreur lors de la liaison." });
  }
});

// DELETE /api/discord — délier.
router.delete("/", requireAuth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.userId, {
      $set: {
        discord: {
          discordId: null,
          username: null,
          globalName: null,
          avatar: null,
          connectedAt: null,
        },
      },
    });
    res.json({ connected: false, discord: null });
  } catch (err) {
    console.error("discord unlink error:", err.message);
    res.status(500).json({ error: "Erreur." });
  }
});

export default router;
