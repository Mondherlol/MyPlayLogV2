import express from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware/auth.js";

// ======================================================================
//  Les serveurs de rendez-vous des appels (STUN / TURN)
// ======================================================================
// Ce que le navigateur doit connaître pour établir un appel : où demander son
// adresse publique (STUN), et par où passer quand aucun chemin direct n'existe
// (TURN).
//
// -------------------------------------------- pourquoi une route, et pas une
// -------------------------------------------- variable dans le client
// PARCE QUE LE MOT DE PASSE DU RELAIS NE DOIT PAS EXISTER. Un identifiant fixe
// livré dans le code du site est public par construction : n'importe qui ouvre
// les outils de développement, le recopie, et se sert du relais pour son propre
// trafic. On paie la bande passante d'inconnus et l'adresse du serveur finit sur
// des listes noires.
//
// Le serveur fabrique donc un identifiant À DURÉE DE VIE COURTE, signé avec un
// secret que seuls lui et coturn connaissent, et ne le donne qu'aux comptes
// connectés. coturn revérifie la signature tout seul — il n'a aucune base
// d'utilisateurs à tenir, aucun compte à créer, aucune synchronisation à faire.
// Un identifiant qui fuite expire de lui-même.
//
// ------------------------------------------------------------ le format
// C'est la convention « TURN REST API », comprise par coturn depuis toujours :
//
//   username = <horodatage d'expiration>:<identifiant du compte>
//   password = base64( HMAC-SHA1( secret, username ) )
//
// L'identifiant du compte n'est pas décoratif : il apparaît dans les journaux du
// relais, donc un abus se remonte à quelqu'un plutôt qu'à « un utilisateur ».

const router = express.Router();

// Douze heures. Assez long pour qu'un appel commencé le soir ne se coupe pas au
// milieu, assez court pour qu'un identifiant recopié ne serve pas longtemps.
// La durée compte à partir de la DEMANDE, et le client redemande à chaque appel.
const TTL_SEC = 12 * 3600;

// Les serveurs publics de repli. Ils ne font que RÉVÉLER l'adresse publique
// (STUN) : ils ne relaient rien, ne coûtent rien, et suffisent dans la grande
// majorité des cas. Le relais n'entre en jeu que lorsqu'ils ne suffisent pas.
const PUBLIC_STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ----------------------------------------------------------------------
//  GET /api/ice
// ----------------------------------------------------------------------
router.get("/", requireAuth, (req, res) => {
  const host = process.env.TURN_HOST;
  const secret = process.env.TURN_SECRET;

  // Pas de relais configuré : on répond quand même. Le site marche sans TURN
  // pour la plupart des gens, et un appel qui échoue vaut mieux qu'une page qui
  // refuse de s'ouvrir parce qu'une variable d'environnement manque.
  if (!host || !secret) return res.json({ iceServers: PUBLIC_STUN, turn: false });

  const username = `${Math.floor(Date.now() / 1000) + TTL_SEC}:${req.userId}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  // DEUX ENTRÉES POUR LE MÊME RELAIS, et ce n'est pas de la redondance inutile :
  //
  //   udp  le chemin normal, et le seul qui donne une latence correcte ;
  //   tcp  pour les réseaux qui interdisent l'UDP sortant.
  //
  // Le navigateur les essaie et garde la première qui répond ; les proposer
  // toutes ne coûte rien à ceux dont la connexion directe fonctionne, puisqu'il
  // ne bascule sur le relais qu'en dernier recours.
  //
  // Pas d'entrée `turns:` (TLS) : elle exigerait un certificat côté coturn, que
  // nous n'avons pas encore branché (voir turnserver.conf, qui explique comment
  // l'ajouter). L'annoncer sans écouteur en face ne ferait que rallonger la
  // recherche d'un chemin de plusieurs secondes, pour rien.
  const iceServers = [
    ...PUBLIC_STUN,
    { urls: `stun:${host}:3478` },
    { urls: `turn:${host}:3478?transport=udp`, username, credential },
    { urls: `turn:${host}:3478?transport=tcp`, username, credential },
  ];

  res.json({
    iceServers,
    turn: true,
    // Le client s'en sert pour redemander des identifiants avant qu'ils
    // n'expirent, plutôt que de découvrir l'expiration en pleine conversation.
    expiresIn: TTL_SEC,
  });
});

export default router;
