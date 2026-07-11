// Remontée des erreurs client vers le backend (POST /api/client-errors).
// Objectif : capturer les crashs qui n'arrivent QUE sur certains appareils
// (navigateur/OS/mode privé/bundle en cache) alors qu'on ne les reproduit pas.
// Best-effort et silencieux : reporter une erreur ne doit jamais en lever une.
import { API_BASE } from "./api";

// Anti-flood : on ignore les doublons (même signature) et on plafonne le débit.
const seen = new Set();
let sentInWindow = 0;
let windowStart = Date.now();
const MAX_PER_MINUTE = 8;

function throttled(signature) {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (seen.has(signature)) return true;
  if (sentInWindow >= MAX_PER_MINUTE) return true;
  seen.add(signature);
  sentInWindow += 1;
  return false;
}

export function reportClientError(kind, error, extra = {}) {
  try {
    const message =
      (error && (error.message || String(error))) || "Erreur inconnue";
    const stack = (error && error.stack) || null;
    // Signature grossière pour dédupliquer (kind + début du message + 1re ligne
    // de stack) : évite de spammer si l'erreur se relève à chaque rendu.
    const signature = `${kind}|${message}|${(stack || "").slice(0, 120)}`;
    if (throttled(signature)) return;

    const payload = JSON.stringify({
      kind,
      message: String(message).slice(0, 500),
      stack: stack ? String(stack).slice(0, 4000) : null,
      componentStack: extra.componentStack
        ? String(extra.componentStack).slice(0, 4000)
        : null,
      url: location.href,
      userAgent: navigator.userAgent,
      // Indices utiles pour un bug device-spécifique.
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      online: navigator.onLine,
      ts: new Date().toISOString(),
    });

    const endpoint = `${API_BASE}/client-errors`;
    // sendBeacon survit à un unload/navigation ; repli sur fetch keepalive.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([payload], { type: "application/json" }));
    } else {
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* on n'aggrave jamais un crash en essayant de le reporter */
  }
}

// Handlers globaux : erreurs JS non-rattrapées + promesses rejetées.
// À appeler une fois au démarrage (main.jsx).
let installed = false;
export function installGlobalErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    // Les erreurs de chargement de ressource (img/script) ont e.error null :
    // on capture ce qu'on peut (utile pour un chunk/bundle manquant en cache).
    reportClientError("window.error", e.error || { message: e.message }, {});
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportClientError("unhandledrejection", e.reason || { message: "rejet non géré" }, {});
  });
}
