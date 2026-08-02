// ======================================================================
//  Machinerie commune des salons « versus »
// ======================================================================
// Partagée par GeoGamer (routes/geoVersus.js) et le blind test
// (routes/blindtestVersus.js). On n'y met QUE ce qui est identique dans les
// deux et dont une divergence silencieuse serait un bug :
//
//   - la sérialisation des écritures d'un salon (deux réponses à la même
//     milliseconde) ;
//   - le chrono qui enchaîne les phases tout seul ;
//   - le code d'invitation ;
//   - l'origine des URL pour les diffusions temps réel.
//
// Ce qui distingue les deux jeux — le tirage des manches, le barème, les
// phases, ce que le client a le droit de voir — reste dans chaque routeur.
// C'était le piège à éviter : une abstraction qui aurait aussi avalé les règles
// du jeu aurait rendu les deux modes impossibles à faire évoluer séparément.

// L'adresse du salon : ce qui s'écrit dans le lien qu'on copie. Alphabet sans
// caractères ambigus (ni 0/O, ni 1/l/I) — un code se dicte à voix haute dans un
// vocal pendant qu'on lance la partie.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function makeCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i += 1)
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

// ============================================================
//  Accès concurrent : un salon ne se modifie qu'à la queue leu leu
// ============================================================
// DEUX RÉPONSES À LA MÊME MILLISECONDE, C'EST LE CŒUR DU MODE. Sans
// sérialisation, deux requêtes chargent le même document, se croient toutes
// deux « premières », puis s'écrasent l'une l'autre à la sauvegarde : deux
// vainqueurs, ou pire, un vainqueur qui disparaît.
//
// `load(code)` doit renvoyer le document PEUPLÉ (les diffusions ont besoin des
// têtes de joueurs) ou `null`.
export function makeRoomQueue(load) {
  const queues = new Map();
  return function withRoom(code, fn) {
    const prev = queues.get(code) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(async () => {
        const room = await load(code);
        if (!room) return null;
        return fn(room);
      });
    // La file retient une version « qui n'échoue pas » : une opération ratée ne
    // doit pas bloquer toutes les suivantes.
    queues.set(
      code,
      next.catch(() => {})
    );
    return next;
  };
}

// ============================================================
//  Le chrono du salon
// ============================================================
// Un seul minuteur à la fois par salon : chaque phase programme la suivante, et
// reprogrammer écrase toujours le précédent — une manche close en avance ne doit
// pas se refermer une seconde fois à l'heure initialement prévue.
//
// Les parties ne survivent pas à un redémarrage du process : c'est assumé (elles
// durent dix minutes et les documents portent leur propre TTL). Ce qui NE devait
// pas l'être, c'est qu'une partie dépende d'un navigateur resté ouvert — d'où le
// minuteur côté serveur plutôt qu'un « suivant » cliqué par l'hôte.
export function makeClock(label = "versus") {
  const clocks = new Map();
  return {
    at(code, atMs, fn) {
      clearTimeout(clocks.get(code));
      const t = setTimeout(
        () => {
          clocks.delete(code);
          Promise.resolve(fn()).catch((e) =>
            console.error(`${label} clock error:`, e?.message)
          );
        },
        Math.max(0, atMs - Date.now())
      );
      // Un minuteur en attente ne doit pas retenir le process à l'arrêt.
      t.unref?.();
      clocks.set(code, t);
    },
    stop(code) {
      clearTimeout(clocks.get(code));
      clocks.delete(code);
    },
  };
}

// ============================================================
//  L'origine des URL
// ============================================================
// Les diffusions temps réel n'ont pas de `req` sous la main pour absolutiser un
// chemin d'upload. On retient donc l'origine au lancement de la partie. En
// production Caddy sert l'API et /uploads sur le même domaine, donc le repli sur
// le chemin relatif reste valide — c'est en développement (front 5173, API 4000)
// que la valeur compte vraiment.
export function makeBaseStore() {
  const bases = new Map();
  return {
    set: (code, base) => bases.set(code, base),
    has: (code) => bases.has(code),
    get: (code) => bases.get(code) || "",
  };
}

// ============================================================
//  Petits communs
// ============================================================
// Le document est TOUJOURS peuplé (cf. makeRoomQueue), donc `room.host` est un
// document User et non un ObjectId : `String(room.host)` rendrait le document
// entier. Toute comparaison d'identité passe donc par ici — c'est exactement le
// bug qui avait fait rejeter l'hôte par son propre salon.
export const idOf = (v) => String(v?._id || v);
export const hostIdOf = (room) => idOf(room.host);
export const isHost = (room, userId) => hostIdOf(room) === String(userId);

export const activePlayers = (room) => room.players.filter((p) => !p.leftAt);
export const playerIds = (room) => activePlayers(room).map((p) => idOf(p.user));
export const allIds = (room) => room.players.map((p) => idOf(p.user));
export const findPlayer = (room, userId) =>
  room.players.find((p) => idOf(p.user) === String(userId));
