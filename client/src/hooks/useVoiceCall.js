import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import {
  playCallEndSound,
  playCallJoinSound,
  playCallLeaveSound,
  playCallStartSound,
  playMicToggleSound,
} from "../lib/sfx";
import {
  applyVoiceSignal,
  connectPeer,
  fetchIceServers,
  makePeerId,
  makeSpeakingWatch,
  makeVoiceSignaller,
  openCallMic,
} from "../lib/voiceCall";

// ======================================================================
//  Un appel vocal — de salon de jeu, de messagerie
// ======================================================================
// Ce hook tient le maillage (lib/voiceCall.js), la liste de qui est en ligne,
// et une règle que la messagerie n'utilise pas mais qui est la raison d'être de
// l'appel du Perroquet :
//
//   `silent` — un temps de la partie où PERSONNE ne s'entend.
//
// C'est la raison d'être du mode. Sur Discord, imiter un son à six demande de se
// couper le micro, imiter, se remettre, écouter les autres, recommencer : soixante
// gestes dans une partie de dix minutes, et il suffit d'un joueur qui oublie
// pour que la manche soit gâchée — soit qu'on entende son cri d'avance, soit que
// son commentaire couvre l'original. Ici la coupure suit la phase de jeu, donc
// personne n'a rien à faire, et personne ne peut oublier.
//
// LA COUPURE SE FAIT AUX DEUX BOUTS, et ce n'est pas de la ceinture-bretelles :
//   - on coupe SA PISTE SORTANTE  → les autres ne nous entendent pas ;
//   - on coupe LES SONS ENTRANTS → nos haut-parleurs se taisent, et c'est
//     indispensable pour une raison propre à ce jeu : le micro de l'imitation
//     capte la pièce. Un participant dont le client n'aurait pas coupé sa piste
//     se retrouverait dans NOTRE fichier, et le serveur noterait un mélange de
//     deux voix.
//
// LA COUPURE N'EST PAS UN MUTE : `track.enabled = false` envoie du silence sur
// une connexion qui reste debout. Retirer la piste demanderait de renégocier
// toute la connexion à chaque manche — une seconde de blanc à chaque reprise de
// parole, cinq fois par partie, pour six personnes.

const PING_MS = 30_000;

// Débranche l'émission audio d'une connexion, sans la démonter. `replaceTrack`
// est le seul geste de WebRTC qui coupe le son SANS renégociation — retirer la
// piste rouvrirait une poignée de main à chaque manche. Utilisé pendant un
// emprunt du micro (voir plus bas) : la piste continue de tourner pour le
// MediaRecorder, mais plus rien ne part vers les autres.
function holdSenders(pc, held) {
  for (const s of pc?.getSenders?.() || []) {
    if (s.track?.kind !== "audio") continue;
    held.add(s);
    s.replaceTrack(null).catch(() => {});
  }
}

// ======================================================================
//  LE VOLUME DE CHAQUE PERSONNE
// ======================================================================
// Tout le monde n'a pas le même micro ni la même voix : quelqu'un qu'on entend
// à peine gâche un appel entier, et monter le volume général monte aussi ceux
// qui étaient déjà trop forts. D'où un réglage PAR PERSONNE.
//
// ------------------------------------------------------ DEUX CHEMINS, ET POURQUOI
// Une balise <audio> plafonne à 100 % : `volume` ne dépasse pas 1. Amplifier
// au-delà oblige à passer par WebAudio — or c'est exactement ce qui avait rendu
// les appels muets (brancher une piste distante dans un AudioContext fait
// détourner le son par Chrome, cf. `attachAudio`).
//
// On ne prend donc ce risque QUE SI ON LE DEMANDE :
//
//   jusqu'à 100 %  la balise et rien d'autre. C'est le cas de tout le monde par
//                  défaut, et ce chemin reste intact.
//   au-delà        un amplificateur WebAudio s'intercale, la balise est coupée
//                  pour ne pas jouer deux fois. Réversible : redescendre sous
//                  100 % démonte l'amplificateur et rend la main à la balise.
//
// Ainsi, si l'amplification se comporte mal sur un navigateur, elle n'affecte
// que la personne pour qui on l'a explicitement demandée — et il suffit de
// redescendre le curseur.
const MAX_GAIN = 2;
const VOL_KEY = "mpl_call_volumes";

// Le réglage SURVIT AUX APPELS. Quelqu'un qui parle trop bas parle trop bas à
// chaque fois : refaire le geste à chaque appel serait une corvée.
function loadVolumes() {
  try {
    return JSON.parse(localStorage.getItem(VOL_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

// ----------------------------------------------------------------------
//  Le journal de l'appel
// ----------------------------------------------------------------------
// Un appel qui ne marche pas ne dit RIEN : les connexions échouent en silence,
// et il n'y a aucun endroit où regarder. Ces lignes sont le seul moyen de
// répondre à « je ne l'entends pas » autrement qu'en devinant — elles nomment
// l'étape exacte qui a manqué (l'offre est-elle partie ? la piste est-elle
// arrivée ? la connexion est-elle passée en `failed` ?).
//
// Elles ne sortent qu'en développement : en production, ce serait du bruit dans
// la console de tout le monde, et elles n'apprendraient rien à personne.
const log = import.meta.env.DEV
  ? (...a) => console.info("%c[appel]", "color:#16a34a;font-weight:700", ...a)
  : () => {};

// Pourquoi le micro n'a pas marché, en une phrase qui dit quoi FAIRE. « Erreur :
// NotAllowedError » n'aide personne ; les trois cas ci-dessous couvrent la
// quasi-totalité des échecs réels et appellent trois gestes différents.
function micProblem(e) {
  if (e.name === "NotFoundError")
    return "Aucun micro détecté. Branche un casque ou un micro, puis réessaie.";
  if (e.name === "NotReadableError")
    return "Le micro est déjà pris par une autre application (Discord, un autre onglet…).";
  return "Micro refusé. Clique sur l'icône de caméra ou de cadenas dans la barre d'adresse pour l'autoriser.";
}

// ----------------------------------------------------------------------
//  Un seul maillage, deux usages
// ----------------------------------------------------------------------
// Ce hook sert l'appel d'un salon du Perroquet ET les appels de la messagerie
// (privés et de groupe). Rien de ce qui suit ne connaît l'un ou l'autre : ce
// qui change entre les deux tient en trois valeurs.
//
//   base     le préfixe des routes (`/calls/<id>`, `/perroquet/versus/X/voice`)
//   channel  le nom de l'évènement SSE à écouter (`call`, `pqvoice`)
//   room     la valeur que porte le champ `code` des messages, pour ne pas
//            appliquer à un appel les poignées de main d'un autre — deux appels
//            ouverts en même temps dans deux onglets, c'est courant.
//
// `base` à `null` = pas d'appel : le hook existe (les règles de React
// l'exigent) mais ne fait rien. C'est ce qui permet à la messagerie de le
// monter une fois pour toutes, au-dessus des routes, sans savoir d'avance à qui
// l'on parlera.
export default function useVoiceCall({
  base,
  room,
  channel = "pqvoice",
  token,
  subscribe,
  silent = false,
}) {
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // L'AUTORISATION DU MICRO EST UN ÉTAT À PART, pas un simple « ça charge ».
  // C'est le seul moment où l'app attend un geste dans une fenêtre qu'elle ne
  // dessine pas et qui n'est parfois même pas visible (elle s'ouvre en haut du
  // navigateur, loin du bouton qu'on vient de cliquer). Sans le distinguer, on
  // affiche un rond qui tourne pendant que l'utilisateur attend que l'app
  // fasse quelque chose, et les deux s'attendent.
  //   asking  la fenêtre du navigateur est ouverte, on attend le clic
  //   denied  refusé (ou aucun micro) : il faut le rouvrir à la main
  const [micState, setMicState] = useState("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [roster, setRoster] = useState([]); // les AUTRES : [{ peerId, userId, username, avatar, muted, state }]
  // « QUI PARLE » VIENT DE DEUX ENDROITS, et il faut les séparer.
  //
  //   MOI       un analyseur WebAudio sur mon propre micro. C'est une piste
  //             LOCALE, l'y brancher ne pose aucun problème.
  //   LES AUTRES  les statistiques de la connexion (`getStats`), PAS WebAudio.
  //
  // Cette distinction n'est pas une élégance : brancher une piste DISTANTE dans
  // un AudioContext est un cas de figure où Chrome détourne le son de la balise
  // <audio> qui devait le jouer. L'indicateur « qui parle » rendait donc muet le
  // son qu'il servait à illustrer — la balise jouait bel et bien, à plein
  // volume, dans le vide. Les statistiques donnent la même information sans
  // jamais toucher au flux.
  const [volumes, setVolumes] = useState(() => loadVolumes());
  const [localSpeaking, setLocalSpeaking] = useState({});
  const [remoteSpeaking, setRemoteSpeaking] = useState({});

  const meRef = useRef(makePeerId());
  const streamRef = useRef(null);
  const signalRef = useRef(null);
  const peersRef = useRef(new Map()); // peerId → { pc, session, info, audio }
  const watchRef = useRef(null);
  // peerId → { username, avatar, userId } : l'annuaire de la salle.
  //
  // Il existe parce que les deux informations n'arrivent pas par le même canal
  // et pas dans l'ordre qui arrange : le SERVEUR annonce qui décroche (avec son
  // nom et sa tête), le PAIR envoie son offre juste après. Sans annuaire, la
  // connexion se crée sur l'offre — donc sans nom — et l'écran afficherait un
  // rond gris anonyme jusqu'au battement suivant, trente secondes plus tard.
  const idsRef = useRef(new Map());
  // Les serveurs de rendez-vous, chargés UNE FOIS à l'entrée dans l'appel. Les
  // charger au moment de chaque connexion ferait une requête par pair, et
  // surtout retarderait la poignée de main du temps de l'aller-retour.
  const iceRef = useRef(null);
  // userId → facteur de volume (1 = normal). Lu au montage, écrit à chaque
  // changement.
  const volRef = useRef(loadVolumes());
  // L'amplificateur WebAudio, monté à la demande seulement (voir MAX_GAIN).
  const boostRef = useRef({ ctx: null, nodes: new Map() });
  const silentRef = useRef(silent);
  const mutedRef = useRef(false);
  const inCallRef = useRef(false);
  // ---------- LE PRÊT DU MICRO ----------
  // Voir `oneMicAtATime` dans lib/soundTake.js : sur téléphone, le jeu ne peut
  // pas ouvrir sa propre capture pendant que l'appel tient la sienne. Il
  // emprunte donc celle-ci le temps d'une imitation.
  //   borrowRef  combien d'emprunts en cours (un seul en pratique, mais un
  //              compteur ne se désynchronise pas si deux se chevauchent).
  //   heldRef    les émetteurs qu'on a débranchés pendant l'emprunt.
  const borrowRef = useRef(0);
  const heldRef = useRef(new Set());
  // Les arrivées des premières secondes ne font PAS de bruit : entrer dans un
  // appel où trois personnes discutent déclencherait trois « quelqu'un est
  // arrivé » d'affilée, alors que personne n'est arrivé — c'est nous.
  const settledAtRef = useRef(0);

  // La liste affichée est reconstruite depuis la table des connexions : une
  // seule source de vérité, sinon un pair fermé reste à l'écran en « Connexion… »
  // pour toujours.
  const sync = useCallback(() => {
    setRoster(
      [...peersRef.current.entries()].map(([peerId, p]) => ({
        peerId,
        ...(idsRef.current.get(peerId) || {}),
        ...p.info,
        state: p.state || "new",
      }))
    );
  }, []);

  // L'annuaire se remplit dès qu'une identité passe, d'où qu'elle vienne.
  const remember = useCallback((peer) => {
    if (!peer?.peerId) return;
    idsRef.current.set(peer.peerId, {
      userId: peer.userId,
      username: peer.username,
      avatar: peer.avatar,
      muted: !!peer.muted,
    });
  }, []);

  // Applique le réglage à UNE connexion. Appelée à chaque changement, et à
  // l'arrivée d'un flux — sans quoi une personne qui se reconnecte reviendrait
  // au volume par défaut alors qu'on l'avait montée.
  const applyVolume = useCallback((peerId) => {
    const p = peersRef.current.get(peerId);
    if (!p?.audio) return;
    const el = p.audio;
    const userId = String(idsRef.current.get(peerId)?.userId || "");
    const wanted = Math.min(MAX_GAIN, Math.max(0, volRef.current[userId] ?? 1));
    const boost = boostRef.current;
    const node = boost.nodes.get(peerId);

    // --- chemin simple : la balise suffit ---
    if (wanted <= 1) {
      if (node) {
        try {
          node.src.disconnect();
          node.gain.disconnect();
        } catch {
          /* déjà détaché */
        }
        boost.nodes.delete(peerId);
      }
      el.muted = silentRef.current;
      el.volume = wanted;
      return;
    }

    // --- amplification : un gain s'intercale, la balise se tait ---
    if (!boost.ctx) {
      try {
        boost.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        // Pas de WebAudio : on fait au mieux, c'est-à-dire 100 %.
        el.volume = 1;
        return;
      }
    }
    boost.ctx.resume?.().catch(() => {});
    let n = node;
    if (!n && el.srcObject) {
      try {
        const src = boost.ctx.createMediaStreamSource(el.srcObject);
        const gain = boost.ctx.createGain();
        src.connect(gain).connect(boost.ctx.destination);
        n = { src, gain };
        boost.nodes.set(peerId, n);
      } catch {
        el.volume = 1;
        return;
      }
    }
    if (!n) return;
    // La coupure du jeu (Perroquet) passe AUSSI par ici : le `muted` de la
    // balise ne coupe plus rien quand le son sort de l'amplificateur.
    n.gain.gain.value = silentRef.current ? 0 : wanted;
    el.muted = true;
    el.volume = 1;
  }, []);

  // Le réglage d'une personne, quel que soit le nombre d'onglets qu'elle a
  // ouverts : on l'applique à toutes ses connexions.
  const setUserVolume = useCallback(
    (userId, value) => {
      const v = Math.min(MAX_GAIN, Math.max(0, Number(value) || 0));
      const id = String(userId);
      volRef.current = { ...volRef.current, [id]: v };
      setVolumes(volRef.current);
      try {
        localStorage.setItem(VOL_KEY, JSON.stringify(volRef.current));
      } catch {
        /* stockage plein : le réglage vaut pour cet appel */
      }
      for (const [peerId] of peersRef.current)
        if (String(idsRef.current.get(peerId)?.userId || "") === id) applyVolume(peerId);
    },
    [applyVolume]
  );

  // ---------- Le son entrant ----------
  // Une balise par pair, posée dans le document. `new Audio()` détaché suffit
  // sur Chrome mais pas partout : une balise réellement attachée est le seul
  // montage que tous les navigateurs jouent sans discuter.
  const attachAudio = useCallback((peerId, stream) => {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    let el = p.audio;
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.playsInline = true;
      el.style.display = "none";
      document.body.appendChild(el);
      p.audio = el;
    }
    const first = !el.srcObject;
    log("piste reçue de", peerId, "· pistes audio:", stream?.getAudioTracks?.().length);
    el.srcObject = stream;
    el.muted = silentRef.current;
    if (first && Date.now() > settledAtRef.current) playCallJoinSound();
    el.play()
      .then(() => log("lecture démarrée pour", peerId, "· volume:", el.volume))
      .catch(() => {
      // L'autoplay est normalement acquis (on entre dans un appel par un clic),
      // mais un onglet en arrière-plan au moment où le flux arrive peut le
      // refuser. Le prochain geste sur la page relance la lecture — sans ce
      // rattrapage, la personne reste muette jusqu'à ce qu'on raccroche.
      const retry = () => {
        el.play().catch(() => {});
        document.removeEventListener("pointerdown", retry);
      };
      document.addEventListener("pointerdown", retry, { once: true });
    });
    applyVolume(peerId);
    // ⚠️ AUCUN ANALYSEUR SUR CE FLUX, et c'était LA panne : brancher une piste
    // distante dans un AudioContext fait détourner le son par Chrome, qui ne
    // sort alors plus de la balise <audio> — laquelle affiche pourtant qu'elle
    // joue, à plein volume. Le niveau sonore des autres se lit désormais dans
    // les statistiques de la connexion, qui ne touchent pas au flux.
  }, [applyVolume]);

  const dropPeer = useCallback(
    (peerId) => {
      const p = peersRef.current.get(peerId);
      if (!p) return;
      log("je retire", peerId, "· dernier état:", p.state);
      try {
        p.pc.close();
      } catch {
        /* déjà fermée */
      }
      const node = boostRef.current.nodes.get(peerId);
      if (node) {
        try {
          node.src.disconnect();
          node.gain.disconnect();
        } catch {
          /* déjà détaché */
        }
        boostRef.current.nodes.delete(peerId);
      }
      if (p.audio) {
        // Le son de départ ne se joue que pour quelqu'un qu'on ENTENDAIT :
        // une connexion qui échoue avant d'aboutir n'est pas un départ.
        if (p.audio.srcObject && inCallRef.current) playCallLeaveSound();
        p.audio.srcObject = null;
        p.audio.remove();
      }
      peersRef.current.delete(peerId);
      sync();
    },
    [sync]
  );

  // ---------- Une connexion vers quelqu'un ----------
  const link = useCallback(
    (info, offer = null, session = null) => {
      const to = info.peerId;
      if (!streamRef.current || !signalRef.current) return;
      if (info.username) remember(info);
      const existing = peersRef.current.get(to);
      if (existing) {
        // Une offre sous le MÊME numéro est un doublon (l'évènement est passé
        // deux fois) : la rejouer ferait tomber une connexion qui marche.
        if (!offer || existing.session === session) return;
        // Sous un AUTRE numéro, c'est le même pair qui revient (rechargement,
        // changement de réseau) : l'ancienne est morte, on ne la sauve pas.
        dropPeer(to);
      }

      // Pas d'identité recopiée dans l'entrée : `sync` la relit dans l'annuaire
      // à chaque passage, donc un nom qui arrive après la connexion apparaît
      // tout seul.
      // `initiator` : est-ce NOUS qui avons lancé cette connexion ? C'est ce
      // qui décide qui a le droit de retenter en cas d'échec (voir plus bas).
      log(offer ? "je réponds à" : "j'appelle", to);
      const entry = { info: {}, state: "connecting", audio: null, initiator: !offer };
      peersRef.current.set(to, entry);
      const { pc, session: sid } = connectPeer({
        stream: streamRef.current,
        to,
        offer,
        session,
        signal: signalRef.current,
        servers: iceRef.current,
        onStream: (stream) => attachAudio(to, stream),
        onState: (state) => {
          const cur = peersRef.current.get(to);
          if (!cur) return;
          log("connexion avec", to, "→", state);

          // AUCUN CHEMIN RÉSEAU. Ce n'est pas un incident passager : sans
          // candidat, la connexion ne sera jamais tentée. On le DIT, parce que
          // le symptôme (tout a l'air branché, personne ne s'entend) envoie
          // chercher du côté du micro pendant une demi-heure.
          if (state === "nocandidates") {
            cur.state = "failed";
            setError(
              "Aucun chemin réseau trouvé : ton navigateur ou ton réseau bloque les connexions directes."
            );
            sync();
            return;
          }

          // Les états ICE ne servent QU'AU JOURNAL : les mêler à l'état affiché
          // ferait apparaître « ice:checking » sur une tuile.
          if (String(state).startsWith("ice:")) return;
          cur.state = state;

          // ⚠️ UNE CONNEXION QUI ÉCHOUE NE FAIT PLUS DISPARAÎTRE LA PERSONNE.
          //
          // On la retirait, et c'était le pire choix possible : à l'écran, elle
          // repassait en « pas encore décroché » alors qu'elle avait décroché,
          // et on cherchait pourquoi on ne l'entendait pas sans le moindre
          // indice. Elle reste maintenant affichée, marquée en échec — et on
          // retente UNE fois.
          //
          // Seul CELUI QUI A APPELÉ retente : si les deux côtés refaisaient une
          // offre, elles se croiseraient et la réparation empêcherait la
          // reconnexion qu'elle cherche à obtenir.
          if (state === "failed" && cur.initiator && !cur.retried) {
            cur.retried = true;
            const info = idsRef.current.get(to);
            setTimeout(() => {
              if (!inCallRef.current || !peersRef.current.has(to)) return;
              dropPeer(to);
              link({ peerId: to, ...(info || {}) });
            }, 1200);
          }
          // « closed » est notre propre fermeture (on a raccroché avec ce pair) :
          // là, la ligne n'a plus de raison d'être.
          if (state === "closed") dropPeer(to);
          else sync();
        },
      });
      entry.pc = pc;
      entry.session = sid;
      // Une connexion ouverte PENDANT une imitation ne doit pas être la seule à
      // la diffuser : elle naît avec la piste (vivante, puisqu'on enregistre).
      if (borrowRef.current) holdSenders(pc, heldRef.current);
      sync();
    },
    [attachAudio, dropPeer, sync]
  );

  // ---------- Décrocher ----------
  const join = useCallback(async () => {
    if (inCallRef.current || connecting || !base) return;
    setConnecting(true);
    setError("");
    // L'ÉCRAN « AUTORISE TON MICRO » NE S'AFFICHE PAS TOUT DE SUITE, et c'est
    // tout l'intérêt de ce minuteur : quand l'autorisation est DÉJÀ accordée,
    // `getUserMedia` répond en quelques dizaines de millisecondes et le
    // navigateur n'affiche rien du tout. Passer en « asking » sans attendre
    // faisait clignoter un panneau d'explication d'une demi-seconde à chaque
    // appel, pour une fenêtre qui ne s'est jamais ouverte.
    //
    // Au-delà de ce délai, en revanche, c'est que le navigateur POSE la
    // question — et là il faut dire où regarder.
    const ask = setTimeout(() => setMicState("asking"), 400);
    try {
      streamRef.current = await openCallMic();
      clearTimeout(ask);
      setMicState("ready");
      // AVANT d'entrer dans la salle : la première offre part dans la seconde
      // qui suit, et elle a besoin de cette liste. La charger après, c'est
      // ouvrir la première connexion sans relais.
      iceRef.current = await fetchIceServers(token);
      // Le micro de l'appel démarre coupé si la partie est déjà dans une phase
      // silencieuse : décrocher au milieu d'une fenêtre d'enregistrement ne doit
      // pas lâcher un « allô ? » dans le fichier de cinq personnes.
      for (const t of streamRef.current.getAudioTracks()) t.enabled = !silentRef.current;

      signalRef.current = makeVoiceSignaller({
        base,
        token,
        peerId: meRef.current,
      });
      watchRef.current = makeSpeakingWatch(setLocalSpeaking);
      watchRef.current.add(meRef.current, streamRef.current);

      const d = await apiFetch(`${base}/join`, {
        method: "POST",
        token,
        body: { peerId: meRef.current },
      });
      log("entré dans l'appel · pairs déjà présents:", (d.peers || []).length);
      inCallRef.current = true;
      // Une seconde et demie de grâce : le temps que les connexions déjà en
      // place s'ouvrent sans être annoncées comme des arrivées.
      settledAtRef.current = Date.now() + 1500;
      setInCall(true);
      playCallStartSound();
      // C'est L'ARRIVANT qui offre, à chacun de ceux qui étaient déjà là.
      for (const peer of d.peers || []) {
        remember(peer);
        link(peer);
      }
    } catch (e) {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
      streamRef.current = null;
      signalRef.current?.stop();
      signalRef.current = null;
      watchRef.current?.stop();
      watchRef.current = null;
      clearTimeout(ask);
      const refused =
        e.name === "NotAllowedError" ||
        e.name === "NotFoundError" ||
        e.name === "NotReadableError";
      setMicState(refused ? "denied" : "idle");
      setError(
        refused
          ? micProblem(e)
          : e.message || "Impossible de rejoindre l'appel."
      );
    } finally {
      setConnecting(false);
    }
  }, [base, token, connecting, link, remember]);

  // ---------- Raccrocher ----------
  const leave = useCallback(() => {
    if (!inCallRef.current || !base) return;
    inCallRef.current = false;
    // Le mot de départ part sans qu'on attende la réponse : on est peut-être en
    // train de fermer l'onglet, et de toute façon le battement finirait par
    // faire le ménage (server/src/lib/voiceRooms.js).
    apiFetch(`${base}/leave`, {
      method: "POST",
      token,
      body: { peerId: meRef.current },
    }).catch(() => {});
    for (const peerId of [...peersRef.current.keys()]) dropPeer(peerId);
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
    streamRef.current = null;
    signalRef.current?.stop();
    signalRef.current = null;
    watchRef.current?.stop();
    watchRef.current = null;
    boostRef.current.ctx?.close().catch(() => {});
    boostRef.current = { ctx: null, nodes: new Map() };
    // Un emprunt en cours meurt avec l'appel : les émetteurs viennent d'être
    // fermés, il n'y a plus rien à leur rendre.
    borrowRef.current = 0;
    heldRef.current.clear();
    setInCall(false);
    setLocalSpeaking({});
    setRemoteSpeaking({});
    // Le micro coupé ne se garde PAS d'un appel à l'autre : arriver muet dans
    // l'appel suivant sans l'avoir demandé, c'est parler deux minutes dans le
    // vide avant de comprendre.
    mutedRef.current = false;
    setMuted(false);
    setMicState("idle");
    playCallEndSound();
  }, [base, token, dropPeer]);

  // On raccroche en quittant la page : un onglet qui garde le micro ouvert
  // après qu'on soit parti est un comportement qu'on n'accepterait de personne.
  useEffect(() => () => leave(), [leave]);

  // ---------- L'état de MA piste ----------
  // Un seul endroit qui décide, parce qu'il y a maintenant trois raisons de se
  // taire et qu'elles se contredisent :
  //
  //   la phase du jeu (`silent`) et le bouton de micro coupent la piste ;
  //   un EMPRUNT, lui, exige l'inverse — une piste coupée n'enregistre que du
  //   silence, et c'était exactement la panne du téléphone.
  //
  // Pendant un emprunt la piste reste donc VIVANTE, et c'est l'ÉMISSION qu'on
  // débranche (`replaceTrack(null)`, sans renégociation) : personne n'entend
  // l'imitation en direct, mais le MediaRecorder, lui, la capte.
  const applyMic = useCallback(() => {
    const borrowed = borrowRef.current > 0;
    const on = !silentRef.current && !mutedRef.current;
    for (const t of streamRef.current?.getAudioTracks?.() || [])
      t.enabled = on || borrowed;
  }, []);

  const borrowMic = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return null;
    borrowRef.current += 1;
    for (const p of peersRef.current.values()) holdSenders(p.pc, heldRef.current);
    applyMic();
    return stream;
  }, [applyMic]);

  const releaseMic = useCallback(() => {
    if (!borrowRef.current) return;
    borrowRef.current -= 1;
    if (borrowRef.current) return;
    const track = streamRef.current?.getAudioTracks?.()[0] || null;
    for (const s of heldRef.current) if (track) s.replaceTrack(track).catch(() => {});
    heldRef.current.clear();
    applyMic();
  }, [applyMic]);

  // ---------- La coupure, et le bouton de micro ----------
  useEffect(() => {
    silentRef.current = silent;
    applyMic();
    // `applyVolume` remet chaque connexion d'aplomb : il sait couper la balise
    // OU l'amplificateur selon le chemin emprunté par cette personne-là.
    for (const [peerId] of peersRef.current) applyVolume(peerId);
  }, [silent, applyMic, applyVolume]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    playMicToggleSound(!next);
    applyMic();
    apiFetch(`${base}/mute`, {
      method: "POST",
      token,
      body: { peerId: meRef.current, muted: next },
    }).catch(() => {
      /* l'état partagé n'a pas suivi : ma piste, elle, est bien coupée */
    });
  }, [base, token, applyMic]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !room) return undefined;
    return subscribe((event, data) => {
      if (event !== channel || String(data?.code) !== String(room)) return;
      if (!inCallRef.current) return;

      if (data.kind === "joined") {
        // On n'offre PAS : c'est l'arrivant qui appelle. On retient juste son
        // nom, qui arrive AVANT son offre — c'est tout l'objet de l'annuaire.
        if (data.peer?.peerId !== meRef.current) {
          remember(data.peer);
          sync();
        }
        return;
      }

      if (data.kind === "left") {
        if (data.peerId !== meRef.current) {
          idsRef.current.delete(data.peerId);
          dropPeer(data.peerId);
        }
        return;
      }

      if (data.kind === "peers") {
        for (const peer of data.peers || []) remember(peer);
        sync();
        return;
      }

      if (data.kind !== "signal" || data.to !== meRef.current) return;
      const from = data.from;
      const payload = data.data || {};
      const existing = peersRef.current.get(from);

      if (payload.sdp?.type === "offer") {
        link({ peerId: from }, payload.sdp, payload.session);
        return;
      }
      // Réponse ou candidats : ils n'ont de sens que sur la connexion en cours.
      // Tout ce qui porte un autre numéro de session appartient à une poignée de
      // main périmée — l'appliquer casserait la bonne, en silence.
      if (!existing || (payload.session && existing.session !== payload.session)) return;
      applyVoiceSignal(existing.pc, payload).catch(() => {
        // Description arrivée dans un état qui ne l'attend plus : la connexion
        // se rétablira au battement suivant plutôt que de laisser tomber une
        // promesse dans le vide.
      });
    });
  }, [subscribe, room, channel, link, dropPeer, sync, remember]);

  // ---------- Qui parle, chez les autres ----------
  // `getStats` rend le niveau sonore reçu pour chaque pair, sans jamais toucher
  // au flux. Quatre fois par seconde : assez pour que la pastille suive la
  // parole, assez peu pour ne rien coûter.
  //
  // Ces mêmes statistiques répondent à LA question qu'on ne pouvait pas trancher
  // autrement — « le son circule-t-il vraiment ? ». `packetsReceived` à zéro
  // après plusieurs secondes, c'est un tuyau qui n'est pas passé ; on le dit une
  // fois dans le journal plutôt que de laisser chercher.
  useEffect(() => {
    if (!inCall) return undefined;
    const warned = new Set();
    const since = Date.now();

    const id = setInterval(async () => {
      const out = {};
      for (const [peerId, p] of peersRef.current) {
        if (!p.pc) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const stats = await p.pc.getStats();
          let level = 0;
          let packets = 0;
          stats.forEach((r) => {
            if (r.type === "inbound-rtp" && r.kind === "audio") {
              packets = r.packetsReceived || 0;
              if (typeof r.audioLevel === "number") level = Math.max(level, r.audioLevel);
            }
            // Les navigateurs plus anciens rangent le niveau sur le rapport de
            // piste : on lit les deux plutôt que d'avoir un indicateur mort
            // selon la version.
            if (r.type === "track" && typeof r.audioLevel === "number")
              level = Math.max(level, r.audioLevel);
          });
          out[peerId] = level > 0.006;

          if (!warned.has(peerId) && Date.now() - since > 4000) {
            warned.add(peerId);
            log(
              packets > 0
                ? `le son circule avec ${peerId} · ${packets} paquets reçus`
                : `AUCUN PAQUET reçu de ${peerId} après 4 s — le flux ne passe pas`
            );
          }
        } catch {
          /* connexion fermée entre-temps : le tour suivant l'aura oubliée */
        }
      }
      setRemoteSpeaking(out);
    }, 250);
    return () => clearInterval(id);
  }, [inCall]);

  // ---------- Le chien de garde de la lecture ----------
  // UNE BALISE <audio> PEUT S'ARRÊTER TOUTE SEULE, et sans rien dire : onglet
  // passé en arrière-plan, système qui reprend la main sur la sortie audio,
  // périphérique débranché, politique d'économie d'énergie. La piste continue
  // d'arriver, l'indicateur « qui parle » s'allume — et on n'entend rien.
  // C'est exactement le « par moments on n'entend plus » qu'on ne sait jamais
  // reproduire.
  //
  // Trois secondes : assez rare pour ne rien coûter, assez fréquent pour que le
  // trou ne dure pas plus d'une phrase.
  useEffect(() => {
    if (!inCall) return undefined;
    const id = setInterval(() => {
      for (const p of peersRef.current.values()) {
        if (p.audio?.srcObject && p.audio.paused) p.audio.play().catch(() => {});
      }
    }, 3000);
    return () => clearInterval(id);
  }, [inCall]);

  // ---------- Le battement ----------
  // Il dit « je suis toujours là » ET sert de rattrapage : si un pair est dans
  // la salle sans qu'on soit reliés (un évènement perdu, une connexion tombée
  // au mauvais moment), on rétablit. UN SEUL DES DEUX appelle — celui dont
  // l'identifiant est le plus grand — sinon les deux offres se croiseraient et
  // la réparation ne réparerait rien.
  useEffect(() => {
    if (!inCall) return undefined;
    const id = setInterval(async () => {
      try {
        const d = await apiFetch(`${base}/ping`, {
          method: "POST",
          token,
          body: { peerId: meRef.current },
        });
        for (const peer of d.peers || []) {
          if (peer.peerId === meRef.current) continue;
          remember(peer);
          if (!peersRef.current.has(peer.peerId) && meRef.current > peer.peerId) link(peer);
        }
        sync();
      } catch {
        /* le salon est clos ou le réseau a sauté : le prochain battement dira */
      }
    }, PING_MS);
    return () => clearInterval(id);
  }, [inCall, base, token, link, sync, remember]);

  // Ce qu'on affiche : moi d'abord, puis les autres. Un micro coupé ne « parle »
  // jamais, quoi que dise l'analyseur — pendant la coupure, l'indicateur
  // continuerait sinon à s'allumer sur quelqu'un que personne n'entend, ce qui
  // est exactement le contresens que ce mode vient corriger.
  const participants = useMemo(() => {
    const quiet = silent || muted;
    return [
      {
        peerId: meRef.current,
        isMe: true,
        muted,
        state: "connected",
        speaking: !quiet && !!localSpeaking[meRef.current],
      },
      ...roster.map((p) => ({
        ...p,
        isMe: false,
        speaking: !silent && !p.muted && !!remoteSpeaking[p.peerId],
      })),
    ];
  }, [roster, localSpeaking, remoteSpeaking, muted, silent]);

  return {
    volumes,
    setUserVolume,
    maxGain: MAX_GAIN,
    inCall,
    connecting,
    micState,
    error,
    muted,
    silent,
    participants,
    others: roster.length,
    join,
    leave,
    toggleMute,
    // Le prêt du micro : la page du Perroquet s'en sert sur téléphone, où une
    // seconde capture n'est pas possible (lib/soundTake.js).
    borrowMic,
    releaseMic,
  };
}
