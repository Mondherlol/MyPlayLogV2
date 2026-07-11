import express from "express";

// Réception des erreurs client (crashs JS/React remontés par le front). But :
// voir la stack + le User-Agent des bugs qui n'arrivent que sur l'appareil de
// certains utilisateurs, sans avoir à les reproduire soi-même. Les rapports
// apparaissent dans les logs du conteneur `server` (docker compose logs server).
//
// Pas d'auth (un crash peut survenir déconnecté) : endpoint public, donc on
// borne tout ce qui rentre et on plafonne le débit pour éviter tout abus.

const router = express.Router();

// Garde-fou anti-flood très simple, par IP (fenêtre glissante d'1 minute).
const hits = new Map();
const MAX_PER_MIN = 30;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > 60_000) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_MIN;
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

router.post("/", (req, res) => {
  // Toujours répondre 204 : le client ne doit jamais bloquer/échouer là-dessus.
  try {
    const ip = req.ip;
    if (rateLimited(ip)) return res.status(204).end();

    const b = req.body || {};
    const entry = {
      kind: clip(b.kind, 40) || "unknown",
      message: clip(b.message, 500),
      url: clip(b.url, 300),
      userAgent: clip(b.userAgent, 300),
      viewport: clip(b.viewport, 20),
      language: clip(b.language, 20),
      online: b.online === false ? false : true,
      ip,
      stack: clip(b.stack, 4000),
      componentStack: clip(b.componentStack, 4000),
    };

    // Une ligne compacte pour repérer + les stacks en dessous pour analyser.
    console.error(
      `🐛 [client-error] ${entry.kind} — "${entry.message}"\n` +
        `   url=${entry.url}\n` +
        `   ua=${entry.userAgent}\n` +
        `   viewport=${entry.viewport} lang=${entry.language} online=${entry.online} ip=${entry.ip}` +
        (entry.stack ? `\n   stack:\n${entry.stack}` : "") +
        (entry.componentStack ? `\n   componentStack:${entry.componentStack}` : "")
    );
  } catch {
    /* ne jamais faire échouer la remontée d'erreur */
  }
  res.status(204).end();
});

export default router;
