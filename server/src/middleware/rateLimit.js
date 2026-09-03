// ======================================================================
//  Les garde-fous de débit
// ======================================================================
// Deux surfaces méritaient une limite, pour deux raisons différentes.
//
//   • /api/auth : c'est la porte. Sans limite, on peut essayer des mots de
//     passe à la chaîne, ou demander mille mails de réinitialisation.
//   • /api/games : c'est la seule surface qui coûte de l'ARGENT ET DU QUOTA à
//     quelqu'un d'autre. Une boucle sur la recherche vide notre budget IGDB
//     (4 requêtes/seconde pour toute l'application) — et donc casse les fiches
//     de tout le monde, pas seulement celles de l'auteur de la boucle.
//
// ⚠️ CES LIMITES COMPTENT PAR ADRESSE IP, ET UNE IP N'EST PAS UNE PERSONNE :
// un opérateur mobile place des milliers d'abonnés derrière la même. D'où des
// plafonds larges — ils arrêtent une boucle, pas un utilisateur pressé.
//
// ⚠️ ELLES DÉPENDENT DE `trust proxy` (voir src/index.js). Réglé sur `true`,
// n'importe qui peut se déclarer une IP au hasard dans un en-tête et passer à
// travers ; c'est pour ça qu'il vaut `1` — le nombre exact de proxys devant
// nous (Caddy). Si tu ajoutes un Cloudflare devant, passe-le à 2.
import rateLimit from "express-rate-limit";

const common = {
  standardHeaders: "draft-7", // en-têtes RateLimit-* standard
  legacyHeaders: false,
};

// La porte d'entrée. Ne compte QUE les écritures : /auth/me est un GET que
// l'application appelle à chaque démarrage, et il n'a rien à faire ici.
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skip: (req) => req.method !== "POST",
  message: { error: "Trop de tentatives. Réessaie dans quelques minutes." },
});

// Le catalogue, la recherche, les fiches. Large : quelqu'un qui tape dans la
// recherche produit environ trois requêtes par seconde, et ouvrir une fiche en
// déclenche une poignée. Une boucle automatique, elle, dépasse largement.
export const gamesLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 300,
  message: { error: "Trop de requêtes. Ralentis un peu." },
});
