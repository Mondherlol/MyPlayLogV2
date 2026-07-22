// Filet de sécurité global : retire la photo de profil des comptes privés qui
// ont coché « masquer ma photo » de TOUTES les réponses JSON de l'API.
//
// Pourquoi en middleware plutôt qu'endpoint par endpoint : un avatar est
// sérialisé à une quarantaine d'endroits (recherche de joueurs, abonnés /
// abonnements, coups de cœur OST, auteurs de commentaires, notifications,
// cartes du fil…), avec des formes toutes différentes — { id, username,
// avatar }, { _id, … }, ou même { username, avatar } sans identifiant. Les
// patcher un par un laisse forcément passer le prochain endpoint ajouté.
//
// Coût : nul tant que personne n'active l'option (avatarMaskFor renvoie null
// et on ne parcourt rien). Sinon, un parcours de l'objet déjà en mémoire.
import { avatarMaskFor } from "../lib/privacy.js";

// Un nœud porte-t-il l'avatar d'un compte masqué ? On accepte les deux formes
// d'identification rencontrées dans l'API : par id (id/_id/user/userId) ou, à
// défaut, par pseudo — /ost/recent renvoie par exemple { username, avatar }.
function isMaskedUserNode(node, mask) {
  if (typeof node.avatar !== "string" || !node.avatar) return false;
  for (const key of ["id", "_id", "user", "userId"]) {
    const v = node[key];
    if ((typeof v === "string" || typeof v === "number") && mask.ids.has(String(v)))
      return true;
  }
  return typeof node.username === "string" && mask.names.has(node.username);
}

// Parcours en largeur, avec garde-fous : cycles (Set de visités) et taille
// (un profil renvoie des milliers de nœuds — inutile d'aller à l'infini).
const MAX_NODES = 200000;

export function scrub(root, mask) {
  const seen = new Set();
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < MAX_NODES) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    visited++;

    if (Array.isArray(node)) {
      for (const v of node) if (v && typeof v === "object") stack.push(v);
      continue;
    }
    if (isMaskedUserNode(node, mask)) node.avatar = null;
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

export function avatarPrivacy(req, res, next) {
  const json = res.json.bind(res);
  // `req.userId` n'existe pas encore ici (requireAuth/optionalAuth tournent
  // plus tard, au niveau de la route) — on le lit au moment de l'envoi.
  res.json = (body) => {
    if (!body || typeof body !== "object") return json(body);
    avatarMaskFor(req.userId)
      .then((mask) => {
        if (mask) scrub(body, mask);
      })
      .catch(() => {
        /* best-effort : jamais au prix d'une réponse perdue */
      })
      .finally(() => json(body));
    return res;
  };
  next();
}
