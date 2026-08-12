import { apiFetch } from "./api";

// ======================================================================
//  Diffuser une partie GBA — la plomberie WebRTC
// ======================================================================
// L'IMAGE NE PASSE PAS PAR LE SERVEUR. Le canvas du cœur d'émulation est capté
// tel quel (`captureStream`) et envoyé de navigateur à navigateur ; le serveur
// ne relaie que les poignées de main (voir routes/gbaStream.js). C'est ce qui
// rend le mode tenable : un VPS qui relaierait la vidéo tomberait au troisième
// spectateur.
//
// UNE ÉTOILE, PAS UN MAILLAGE : l'hôte tient une connexion par spectateur. À
// cinq personnes c'est cinq fois son débit montant, ce qui est déjà beaucoup
// pour une ligne domestique — d'où la limite plus bas, qui n'est pas une
// contrainte technique mais une politesse envers la connexion de l'hôte.
//
// UNE GBA EST LE CAS IDÉAL POUR ÇA : 240 × 160, soit un trentième d'une image
// 1080p. Le flux tient dans quelques centaines de kilobits — on peut se
// permettre 60 images par seconde là où un film demanderait de choisir.

// Le plafond de spectateurs. Au-delà il faudrait un relais (SFU), c'est-à-dire
// une machine qui reçoit une fois et renvoie N fois — un autre métier, une autre
// facture. Mieux vaut une limite claire qu'une diffusion qui se dégrade pour
// tout le monde sans que l'hôte comprenne pourquoi.
export const MAX_VIEWERS = 6;

// Les serveurs qui aident deux navigateurs à se trouver derrière leurs box.
// STUN suffit dans la grande majorité des cas ; les réseaux les plus fermés
// (4G d'entreprise, certains hôtels) demandent un TURN, qui lui fait TRANSITER
// le flux — d'où l'absence par défaut : c'est un service à héberger et à payer.
// `VITE_ICE_SERVERS` accepte un JSON pour en ajouter un le jour venu.
export function iceServers() {
  try {
    const raw = import.meta.env.VITE_ICE_SERVERS;
    if (raw) return JSON.parse(raw);
  } catch {
    /* réglage illisible : on retombe sur les serveurs publics */
  }
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
}

// L'identifiant de CET onglet. Pas du compte : le même compte peut avoir deux
// onglets ouverts, et une réponse SDP destinée à l'un ferait s'effondrer la
// connexion de l'autre.
export function makePeerId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ----------------------------------------------------------------------
//  Le son
// ----------------------------------------------------------------------
// `captureStream()` ne rend QUE l'image : le son du jeu vit dans un
// AudioContext, ailleurs. On va donc le chercher là où les cœurs le posent —
// et ces chemins dépendent de la version d'EmulatorJS et d'Emscripten, d'où les
// trois tentatives et le repli silencieux.
//
// UNE DIFFUSION MUETTE RESTE UNE DIFFUSION : si rien ne marche, on envoie
// l'image seule et on le DIT dans l'interface, plutôt que de refuser de
// diffuser pour une piste audio.
export function grabAudio(win) {
  try {
    const emu = win?.EJS_emulator;
    const ctx =
      emu?.audioContext ||
      emu?.audio?.ctx ||
      emu?.gameManager?.Module?.SDL2?.audioContext ||
      null;
    if (!ctx?.createMediaStreamDestination) return null;

    const dest = ctx.createMediaStreamDestination();
    // Le nœud par lequel le cœur sort son son. On s'y BRANCHE EN PARALLÈLE
    // (`connect` en ajoute une, il ne remplace pas) : la sortie vers les
    // haut-parleurs de l'hôte reste intacte.
    const node =
      emu?.gameManager?.Module?.SDL2?.audio?.scriptProcessorNode ||
      emu?.gainNode ||
      emu?.audio?.gain ||
      null;
    if (!node?.connect) return null;
    node.connect(dest);
    return dest.stream.getAudioTracks()[0] || null;
  } catch {
    return null;
  }
}

// Le flux à diffuser : l'image du canvas, plus le son si on a su l'attraper.
export function captureConsole(win, fps = 30) {
  const canvas = win?.EJS_emulator?.canvas;
  if (!canvas?.captureStream) throw new Error("Cet écran ne peut pas être capté.");
  const stream = canvas.captureStream(fps);
  const audio = grabAudio(win);
  if (audio) stream.addTrack(audio);
  return { stream, hasAudio: !!audio };
}

// ----------------------------------------------------------------------
//  Une connexion, et son bavardage avec le serveur
// ----------------------------------------------------------------------
// Les candidats ICE arrivent en rafale juste après l'offre. Les envoyer un par
// un ferait une requête HTTP par candidat, soit une dizaine par spectateur ;
// on les GROUPE sur 120 ms, ce qui n'ajoute aucune latence perceptible (la
// connexion attend de toute façon la réponse d'en face) et divise le trafic de
// signalisation par dix.
export function makeSignaller({ code, token, peerId }) {
  const queues = new Map(); // destinataire → candidats en attente
  const timers = new Map();

  const post = (to, data) =>
    apiFetch(`/gba-stream/${code}/signal`, {
      method: "POST",
      token,
      body: { peerId, to, data },
    }).catch(() => {
      /* le pair est parti, ou le salon est clos : la connexion s'éteindra */
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
          if (batch.length) post(to, { candidates: batch, session });
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

// ----------------------------------------------------------------------
//  La manette passe par le CANAL DIRECT, pas par le serveur
// ----------------------------------------------------------------------
// Un appui de bouton en HTTP, c'est un aller-retour vers le VPS puis un
// évènement SSE en retour : cent à deux cents millisecondes avant que Mario
// saute. Injouable. Le canal de données de la connexion déjà ouverte va en
// ligne droite d'un navigateur à l'autre — quelques millisecondes.
//
// ORDONNÉ ET FIABLE, contrairement à l'intuition « c'est du temps réel, tant pis
// si ça se perd » : un appui perdu n'est pas grave, un RELÂCHEMENT perdu laisse
// le personnage courir contre un mur pour toujours.
//
// L'AUTORISATION RESTE CHEZ L'HÔTE : c'est sa console, il n'écoute que le peer
// qui tient la manette d'après le serveur. Le canal direct ne fait pas de lui
// une machine ouverte à tous les vents.
const CHANNEL = "pad";

// ----------------------------------------------------------------------
//  Pourquoi chaque connexion porte un NUMÉRO DE SESSION
// ----------------------------------------------------------------------
// C'EST LE BOGUE QUI FAISAIT RESTER LE SPECTATEUR SUR « on récupère l'image ».
//
// Un spectateur qui entre, ressort et rentre — un rechargement de page, un
// changement de réseau, ou simplement le double montage de React en
// développement — fait fabriquer à l'hôte une SECONDE connexion pour le même
// pair. Les deux poignées de main sont alors en vol en même temps, et la
// réponse de la PREMIÈRE arrive après que la seconde a été créée : l'hôte
// l'applique sur la mauvaise connexion (les mots de passe ICE ne correspondent
// pas, rien ne s'établira jamais), puis la BONNE réponse est refusée parce que
// la connexion n'est plus en attente de réponse. Le tout en silence.
//
// Chaque connexion porte donc un numéro tiré au sort. Tout ce qui arrive sous
// un autre numéro appartient à une connexion périmée : on le jette.
const newSession = () => Math.random().toString(36).slice(2, 10);

// Une connexion sortante vers un spectateur (côté hôte). Rend la connexion ET
// son numéro : c'est l'appelant qui les range ensemble et qui filtrera.
export function offerTo({ stream, to, signal, onState, onInput }) {
  const session = newSession();
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  // Le canal est créé AVANT l'offre : créé après, il faudrait renégocier toute
  // la connexion pour l'annoncer.
  const dc = pc.createDataChannel(CHANNEL);
  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      onInput?.(to, Number(msg.index), !!msg.down);
    } catch {
      /* charge illisible : on ne pousse rien */
    }
  };

  pc.onicecandidate = (e) => e.candidate && signal.ice(to, e.candidate, session);
  pc.onconnectionstatechange = () => onState?.(pc.connectionState);

  // L'offre part dès maintenant : le spectateur attend devant un écran noir, et
  // chaque aller-retour se voit.
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer).then(() => offer))
    .then((offer) => signal.send(to, { sdp: pc.localDescription || offer, session }))
    .catch(() => onState?.("failed"));

  return { pc, session };
}

// La connexion entrante (côté spectateur). L'hôte fait l'offre, on répond — sous
// le MÊME numéro de session, sans quoi l'hôte ne saurait pas à quelle poignée de
// main cette réponse appartient (voir plus haut).
export function answerTo({ from, offer, session, signal, onStream, onState, onChannel }) {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });

  pc.ondatachannel = (e) => {
    if (e.channel?.label === CHANNEL) onChannel?.(e.channel);
  };
  pc.onicecandidate = (e) => e.candidate && signal.ice(from, e.candidate, session);
  pc.onconnectionstatechange = () => onState?.(pc.connectionState);
  // `ontrack` peut tomber deux fois (image puis son) : on rend le flux complet
  // à chaque fois, la balise vidéo s'en accommode.
  pc.ontrack = (e) => onStream?.(e.streams[0]);

  pc.setRemoteDescription(new RTCSessionDescription(offer))
    .then(() => pc.createAnswer())
    .then((answer) => pc.setLocalDescription(answer).then(() => answer))
    .then(() => signal.send(from, { sdp: pc.localDescription, session }))
    .catch(() => onState?.("failed"));

  return pc;
}

// Un message de signalisation reçu, appliqué à la bonne connexion. Les
// candidats arrivent souvent AVANT la description distante : `addIceCandidate`
// lève alors, et c'est sans conséquence — le navigateur retrouve le chemin avec
// les suivants. D'où le `catch` muet plutôt qu'une file d'attente maison.
export async function applySignal(pc, data) {
  if (!pc || !data) return;
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
  for (const c of data.candidates || []) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch {
      /* candidat arrivé trop tôt ou périmé : les autres suffiront */
    }
  }
}
