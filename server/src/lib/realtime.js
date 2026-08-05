// ======================================================================
//  Hub temps réel « maison » — Server-Sent Events (SSE)
// ======================================================================
// Pas de socket.io : un simple flux HTTP qui reste ouvert, géré nativement
// par Express ET par Caddy (qui détecte `text/event-stream` et coupe son
// buffering tout seul). Côté navigateur, `EventSource` se reconnecte de
// lui-même si le lien tombe (tunnel, veille du téléphone, redéploiement).
//
// Le chat n'a besoin que d'un sens serveur → client : tout ce que le client
// envoie (message, « écrit… », lecture) passe par des POST normaux, qui
// rediffusent ensuite via ce hub.

// userId -> Set<res>. Un même compte peut avoir plusieurs onglets/appareils.
const clients = new Map();

export function addClient(userId, res) {
  const key = String(userId);
  let set = clients.get(key);
  if (!set) {
    set = new Set();
    clients.set(key, set);
  }
  set.add(res);
  return set.size;
}

export function removeClient(userId, res) {
  const key = String(userId);
  const set = clients.get(key);
  if (!set) return 0;
  set.delete(res);
  if (!set.size) clients.delete(key);
  return set.size;
}

// Un flux mort (onglet fermé sans `close`, réseau coupé) fait lever `write` :
// on le retire alors du hub plutôt que de laisser fuir la connexion.
function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

// Diffuse un évènement à une liste d'utilisateurs (ceux qui sont connectés).
export function emitTo(userIds, event, data) {
  for (const id of userIds || []) {
    const key = String(id);
    const set = clients.get(key);
    if (!set) continue;
    for (const res of [...set]) {
      if (!send(res, event, data)) removeClient(key, res);
    }
  }
}

export function isOnline(userId) {
  return clients.has(String(userId));
}

// Sous-ensemble en ligne parmi une liste d'ids (statut « en ligne » des
// pastilles vertes). Renvoie un Set de chaînes.
export function onlineAmong(userIds) {
  const out = new Set();
  for (const id of userIds || []) {
    const key = String(id);
    if (clients.has(key)) out.add(key);
  }
  return out;
}
