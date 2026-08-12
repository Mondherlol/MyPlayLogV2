import { apiFetch } from "./api";
import { iceServers, makePeerId } from "./gbaStream";

export { makePeerId };

// ----------------------------------------------------------------------
//  Où se donner rendez-vous : STUN, et le relais quand rien d'autre ne marche
// ----------------------------------------------------------------------
// La liste vient du SERVEUR (routes/ice.js), pas d'une constante, parce qu'elle
// contient un identifiant de relais valable douze heures. Un identifiant fixe
// écrit dans le code du site serait public par construction : n'importe qui le
// recopierait pour faire passer son propre trafic sur la bande passante du VPS.
//
// GARDÉE EN MÉMOIRE le temps de sa validité : un aller-retour au serveur avant
// CHAQUE connexion, dans un appel de groupe où l'on ouvre cinq connexions à la
// seconde, c'est cinq requêtes pour la même réponse.
let iceCache = null;

export async function fetchIceServers(token) {
  if (iceCache && iceCache.until > Date.now()) return iceCache.servers;
  try {
    const d = await apiFetch("/ice", { token });
    const servers = d?.iceServers?.length ? d.iceServers : iceServers();
    iceCache = {
      servers,
      // On périme la liste bien AVANT l'expiration réelle des identifiants :
      // découvrir qu'ils sont morts au milieu d'un appel n'est pas rattrapable,
      // alors que redemander trop tôt ne coûte qu'une requête.
      until: Date.now() + Math.max(60, (d?.expiresIn || 3600) / 2) * 1000,
    };
    return servers;
  } catch {
    // Le serveur n'a pas répondu : on retombe sur les STUN publics. Sans relais
    // l'appel échouera peut-être, mais il sera TENTÉ — et il aboutit dans la
    // grande majorité des cas.
    return iceServers();
  }
}

// ======================================================================
//  L'appel vocal d'un salon — la plomberie
// ======================================================================
// LA VOIX NE PASSE PAS PAR LE SERVEUR : chaque navigateur est relié à chacun
// des autres, le serveur ne relaie que les poignées de main (voir
// server/src/routes/perroquetVersus.js). Les serveurs STUN et le numéro de
// session sont ceux de la diffusion GBA — c'est le même problème, on ne le
// résout pas deux fois (lib/gbaStream.js).
//
// UN MAILLAGE, PAS UNE ÉTOILE. La diffusion GBA a un centre (celui qui a
// l'image) ; un appel n'en a pas. Chacun tient donc une connexion vers chacun :
// à six, cinq flux montants par personne — de la voix, quelques dizaines de
// kilobits pièce, ce qui ne se compare pas à de la vidéo.
//
// QUI OFFRE À QUI : l'arrivant offre à tous ceux qui étaient déjà là, les
// anciens répondent. Jamais l'inverse. Si les deux côtés offraient sur la même
// paire, les deux offres se croiseraient (le « glare » de WebRTC) et la
// connexion ne s'établirait pas — le tout en silence, évidemment.

// ----------------------------------------------------------------------
//  Le micro de l'appel n'est PAS celui du jeu
// ----------------------------------------------------------------------
// Deux flux distincts sur le même micro, et c'est volontaire.
//
// L'imitation est captée BRUTE (lib/soundTake.js) : le correcteur de gain
// automatique aplatit l'enveloppe de volume, c'est-à-dire exactement ce que le
// barème mesure. Passer la voix de l'appel par le même flux serait le meilleur
// moyen de perdre des points à cause d'un traitement du navigateur.
//
// L'appel, lui, veut tout l'inverse : sans annulation d'écho, chacun renvoie aux
// autres ce qui sort de ses propres haut-parleurs, et six personnes dans un
// appel deviennent un larsen. D'où ces contraintes-ci, opposées à celles-là.
export function openCallMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

// Le journal de la plomberie, en développement seulement. Il suit ce que le
// hook ne voit pas : les candidats ICE qui partent, ceux qui arrivent, et les
// envois qui échouent.
const log = import.meta.env.DEV
  ? (...a) => console.info("%c[ice]", "color:#2563eb;font-weight:700", ...a)
  : () => {};

const newSession = () => Math.random().toString(36).slice(2, 10);

// Le bavardage avec le serveur. Les candidats ICE arrivent en rafale juste
// après l'offre : les envoyer un par un ferait une requête HTTP par candidat,
// soit une dizaine PAR PAIRE — donc jusqu'à trois cents dans une salle de six.
// On les groupe sur 120 ms, ce qui n'ajoute aucune latence perceptible (la
// connexion attend de toute façon la réponse d'en face).
export function makeVoiceSignaller({ base, token, peerId }) {
  const queues = new Map();
  const timers = new Map();

  // ⚠️ UN ENVOI QUI ÉCHOUE SE DIT. Il était avalé sans un mot, et c'est la
  // pire chose à taire ici : un refus du serveur (le pair a raccroché, la
  // session a expiré, l'autorisation est tombée) fait perdre des candidats,
  // donc la connexion — sans que rien nulle part ne le signale.
  const post = (to, data) =>
    apiFetch(`${base}/signal`, {
      method: "POST",
      token,
      body: { peerId, to, data },
    }).catch((e) => {
      log("ENVOI REFUSÉ vers", to, "·", e?.message || e);
    });

  return {
    send: post,
    ice(to, candidate, session) {
      const list = queues.get(to) || [];
      list.push(candidate);
      queues.set(to, list);
      if (timers.has(to)) return;
      timers.set(
        to,
        setTimeout(() => {
          timers.delete(to);
          const batch = queues.get(to) || [];
          queues.delete(to);
          if (batch.length) {
            // Le TYPE des candidats est ce qui explique la plupart des échecs :
            // `host` = même machine ou même réseau local, `srflx` = vu à travers
            // la box (STUN), `relay` = par un serveur TURN. N'avoir que des
            // `host` en `.local` (Chrome masque les adresses locales derrière du
            // mDNS) et rien d'autre, c'est la panne classique en développement.
            log(
              "j'envoie",
              batch.length,
              "candidat(s) à",
              to,
              "·",
              batch.map((c) => c.candidate?.split(" ")[7] || "?").join(", ")
            );
            post(to, { candidates: batch, session });
          }
        }, 120)
      );
    },
    stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      queues.clear();
    },
  };
}

// Une connexion, dans un sens ou dans l'autre. `offer` absent = c'est moi qui
// appelle ; `offer` présent = je réponds.
//
// LA PISTE EST TOUJOURS AJOUTÉE, même micro coupé : couper, ici, c'est
// `track.enabled = false`, ce qui envoie du silence sur une connexion qui reste
// debout. Retirer la piste obligerait à renégocier toute la connexion à chaque
// bascule du bouton — une seconde de blanc à chaque fois qu'on reprend la
// parole.
export function connectPeer({
  stream,
  to,
  offer,
  session,
  signal,
  servers,
  onStream,
  onState,
}) {
  const sid = session || newSession();
  const pc = new RTCPeerConnection({ iceServers: servers || iceServers() });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  // ----------------------------------------------------------------
  //  Les chemins réseau trouvés — et le cas où il n'y en a AUCUN
  // ----------------------------------------------------------------
  // Une collecte qui se termine sans le moindre candidat est une panne à part
  // entière, et elle était parfaitement muette : ICE ne démarre alors même pas,
  // donc aucun état ne change, donc rien ne signale l'échec. L'appel semble
  // établi — la piste arrive, la lecture démarre — et pas un son ne circule.
  //
  // On la nomme (`nocandidates`) pour que l'écran puisse enfin dire ce qui se
  // passe au lieu de laisser croire à une panne de micro.
  let found = 0;
  pc.onicecandidate = (e) => {
    if (!e.candidate) {
      log("fin de collecte pour", to, "·", found, "candidat(s) au total");
      if (!found) onState?.("nocandidates");
      return;
    }
    found += 1;
    signal.ice(to, e.candidate, sid);
  };
  pc.onconnectionstatechange = () => onState?.(pc.connectionState);
  // L'ÉTAT ICE EN PLUS DE L'ÉTAT DE CONNEXION, et ce n'est pas un doublon :
  // `connectionState` reste parfois muet sur les navigateurs plus anciens,
  // alors que `iceConnectionState` dit toujours si les deux machines ont trouvé
  // un chemin l'une vers l'autre. C'est LA question quand la piste arrive mais
  // qu'aucun son n'en sort : la négociation a réussi, le tuyau non.
  pc.oniceconnectionstatechange = () => {
    log("état ICE avec", to, "→", pc.iceConnectionState);
    onState?.(`ice:${pc.iceConnectionState}`);
  };
  pc.onicegatheringstatechange = () => log("collecte ICE", to, "→", pc.iceGatheringState);
  // `e.streams[0]` N'EST PAS GARANTI. Il n'existe que si le pair d'en face a
  // associé sa piste à un flux (`addTrack(track, stream)`) ; certaines piles —
  // un navigateur plus ancien, un client tiers, une renégociation — livrent une
  // piste toute seule. On reconstruit alors un flux autour d'elle, sinon
  // `srcObject` reçoit `undefined` et personne n'entend rien, sans la moindre
  // erreur nulle part.
  pc.ontrack = (e) => onStream?.(e.streams?.[0] || new MediaStream([e.track]));

  const go = offer
    ? pc
        .setRemoteDescription(new RTCSessionDescription(offer))
        // ⚠️ INDISPENSABLE : l'offre est posée ICI, sans passer par
        // `applyVoiceSignal` — c'est donc ici, et nulle part ailleurs, qu'il
        // faut rejouer les candidats arrivés entre-temps. Sans cette ligne, la
        // file d'attente du répondeur ne se vide jamais et la connexion échoue
        // exactement comme si elle n'existait pas.
        .then(() => flushParked(pc))
        .then(() => pc.createAnswer())
    : pc.createOffer();

  go.then((desc) => pc.setLocalDescription(desc))
    .then(() => signal.send(to, { sdp: pc.localDescription, session: sid }))
    .catch(() => onState?.("failed"));

  return { pc, session: sid };
}

// ----------------------------------------------------------------------
//  Appliquer un message reçu — et surtout NE PERDRE AUCUN CANDIDAT
// ----------------------------------------------------------------------
// C'EST LA PANNE CLASSIQUE DE WEBRTC, et elle est silencieuse : `addIceCandidate`
// refuse tout candidat tant que la description distante n'est pas posée. Le code
// d'origine avalait ce refus en se disant « les suivants passeront »… sauf que
// les candidats partent GROUPÉS (voir `makeVoiceSignaller`, qui les rassemble sur
// 120 ms pour ne pas faire dix requêtes). Une salve arrivée une fraction de
// seconde trop tôt, c'est donc la TOTALITÉ des chemins réseau perdue d'un coup :
// la connexion reste « connecting » puis tombe en « failed », sans une ligne
// d'erreur nulle part, et personne n'entend personne.
//
// Deux protections, et il faut les deux :
//
//   1. UNE FILE D'ATTENTE par connexion. Un candidat arrivé trop tôt est mis de
//      côté, puis rejoué dès que la description distante est là.
//   2. UN TRAITEMENT SÉQUENTIEL par connexion. Sans lui, deux messages traités
//      en parallèle se croisent : le second teste `remoteDescription` pendant
//      que le premier est encore en train de la poser, met ses candidats en
//      attente… et personne ne vient jamais vider cette attente-là.

// Les candidats en attente d'une description distante, par connexion.
const parked = new WeakMap();
// La chaîne de traitement de chaque connexion : un message à la fois, dans
// l'ordre d'arrivée.
const chains = new WeakMap();

export function applyVoiceSignal(pc, data) {
  if (!pc || !data) return Promise.resolve();
  const next = (chains.get(pc) || Promise.resolve())
    .then(() => applyOne(pc, data))
    .catch(() => {
      /* une description hors séquence ne doit pas bloquer la file */
    });
  chains.set(pc, next);
  return next;
}

async function applyOne(pc, data) {
  if (data.candidates?.length) log("je reçois", data.candidates.length, "candidat(s)");
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    // La description est là : on rejoue ce qu'on avait mis de côté.
    await flushParked(pc);
  }
  for (const c of data.candidates || []) {
    if (!pc.remoteDescription) {
      const list = parked.get(pc) || [];
      list.push(c);
      parked.set(pc, list);
      continue;
    }
    await addCandidate(pc, c);
  }
}

// Rejoue les candidats mis de côté. Appelée dès qu'une description distante
// vient d'être posée, d'où qu'elle vienne.
async function flushParked(pc) {
  const waiting = parked.get(pc) || [];
  parked.delete(pc);
  for (const c of waiting) await addCandidate(pc, c);
}

async function addCandidate(pc, c) {
  try {
    await pc.addIceCandidate(new RTCIceCandidate(c));
  } catch (e) {
    // Un candidat refusé n'est normalement pas grave (il est périmé, la
    // connexion a changé de route). Mais si TOUS le sont, c'est la panne — et
    // sans cette ligne, elle reste invisible.
    log("candidat refusé:", e?.message || e);
  }
}

// ----------------------------------------------------------------------
//  Qui parle
// ----------------------------------------------------------------------
// UN SEUL AudioContext ET UNE SEULE BOUCLE pour toute la salle : un analyseur
// par pair est indispensable (on veut savoir QUI parle), mais six boucles
// d'animation qui se réveillent chacune de leur côté à 60 images par seconde
// pour lire six octets, c'est du gâchis pur.
//
// Ce n'est pas de la décoration : dans un appel où l'on ne voit personne, savoir
// qui a la parole est ce qui remplace le fait de se regarder. Sans ça, on se
// coupe la parole en permanence.
export function makeSpeakingWatch(onSpeaking) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Le contexte naît suspendu quand il est créé après un `await` — donc après
  // l'autorisation du micro, ce qui est exactement notre cas. Sans ce réveil,
  // l'analyseur ne lit que du silence et aucune pastille ne s'allume jamais.
  ctx.resume?.().catch(() => {});
  const nodes = new Map(); // peerId → { source, analyser, buf, level }
  let raf = 0;

  const tick = () => {
    const out = {};
    for (const [id, n] of nodes) {
      n.analyser.getByteTimeDomainData(n.buf);
      let sum = 0;
      for (let i = 0; i < n.buf.length; i += 1) {
        const d = (n.buf[i] - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / n.buf.length);
      // Lissage asymétrique : la montée est immédiate (la pastille s'allume dès
      // la première syllabe), la descente traîne. Sans ce retard, l'indicateur
      // clignote entre chaque mot d'une même phrase.
      n.level = Math.max(rms, n.level * 0.82);
      out[id] = n.level > 0.045;
    }
    onSpeaking(out);
    raf = requestAnimationFrame(tick);
  };

  return {
    add(id, stream) {
      const tracks = stream?.getAudioTracks?.() || [];
      if (nodes.has(id) || !tracks.length) return;
      try {
        // ⚠️ ON ANALYSE UNE COPIE DU CONTENANT, PAS CELUI QUI JOUE.
        //
        // Le même objet MediaStream branché à la fois sur une balise <audio> et
        // sur un MediaStreamAudioSourceNode donne, sur certaines versions de
        // Chrome, une lecture qui se coupe par moments — l'indicateur « qui
        // parle » finissait par abîmer le son qu'il servait à illustrer. On
        // enveloppe donc les MÊMES pistes dans un autre MediaStream : c'est le
        // même son, mais l'élément qui le joue garde le sien pour lui.
        const source = ctx.createMediaStreamSource(new MediaStream(tracks));
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        nodes.set(id, {
          source,
          analyser,
          buf: new Uint8Array(analyser.frequencyBinCount),
          level: 0,
        });
        if (!raf) raf = requestAnimationFrame(tick);
      } catch {
        /* flux sans piste audio exploitable : pas d'indicateur, tant pis */
      }
    },
    remove(id) {
      const n = nodes.get(id);
      if (!n) return;
      try {
        n.source.disconnect();
      } catch {
        /* déjà détaché */
      }
      nodes.delete(id);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      for (const id of [...nodes.keys()]) this.remove(id);
      ctx.close().catch(() => {});
    },
  };
}
