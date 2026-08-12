import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Loader2,
  Users,
  Gamepad2,
  Hand,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Unplug,
  ArrowLeft,
  Radio,
  WifiOff,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useScrollLock } from "../hooks/useScrollLock";
import GbaPad from "../components/GbaPad";
import { loadView } from "../lib/gbaView";
import { answerTo, applySignal, makePeerId, makeSignaller } from "../lib/gbaStream";

// ======================================================================
//  Regarder quelqu'un jouer — et parfois prendre la manette
// ======================================================================
// C'est l'autre bout de la diffusion (voir GbaBroadcast et routes/gbaStream.js).
// L'image arrive EN DIRECT du navigateur de l'hôte, sans passer par le serveur.
//
// -------------------------------------------------------------- le son
// LA VIDÉO DÉMARRE MUETTE, et ce n'est pas un oubli : un navigateur refuse de
// lancer un son que personne n'a demandé, et le refus se solde par une vidéo qui
// ne démarre pas DU TOUT. On l'allume donc muette (ce qui marche toujours) et
// l'on propose un bouton — un clic, et le son arrive.
//
// -------------------------------------------------------- prendre la manette
// On lève la main, l'hôte donne. À partir de là, les appuis partent par le
// CANAL DIRECT de la connexion (quelques millisecondes) ; si ce canal n'est pas
// ouvert, on retombe sur le serveur, plus lent mais toujours jouable. Dans les
// deux cas la même manette à l'écran que sur la console (GbaPad) : elle n'a rien
// eu à savoir de tout ça, elle appuie sur des boutons.

export default function GbaWatch() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();

  const [room, setRoom] = useState(null);
  const [state, setState] = useState("loading"); // loading | live | ended | error
  const [error, setError] = useState("");
  const [link, setLink] = useState("new"); // état de la connexion directe
  const [muted, setMuted] = useState(true);
  const [full, setFull] = useState(false);

  // Renouvelé à CHAQUE entrée dans le salon (voir l'effet plus bas).
  const peerId = useRef(null);
  const signal = useRef(null);
  const pc = useRef(null);
  // Le numéro de la poignée de main en cours (voir lib/gbaStream.js). Tout ce
  // qui arrive sous un autre numéro appartient à une connexion abandonnée.
  const session = useRef(null);
  const chan = useRef(null);
  const video = useRef(null);
  const shell = useRef(null);

  useScrollLock(true);

  const me = room?.viewers?.find((v) => v.peerId === peerId.current);
  const hasPad = !!me?.pad;
  const handUp = !!me?.hand;

  // ------------------------------------------------------------- entrer --
  //
  // UN NOUVEAU PEER À CHAQUE ENTRÉE, et c'est LA correction du bogue « ça reste
  // sur on récupère l'image ».
  //
  // Entrer, ressortir et rentrer (un rechargement, un changement de réseau, ou
  // le double montage de React en développement) envoyait trois requêtes dans le
  // même souffle : `join`, `leave`, `join`. Elles arrivent au serveur dans un
  // ordre arbitraire — et quand le `leave` arrivait EN DERNIER, il fermait chez
  // l'hôte la connexion que le second `join` venait d'ouvrir. Plus personne ne
  // parlait, sans la moindre erreur pour l'expliquer.
  //
  // Un identifiant de pair désigne UNE TENTATIVE DE CONNEXION, pas un onglet
  // pour la vie : le `leave` de la précédente ne peut alors plus rien contre la
  // suivante, quel que soit l'ordre d'arrivée.
  useEffect(() => {
    let alive = true;
    const mine = makePeerId();
    peerId.current = mine;
    signal.current = makeSignaller({ code, token, peerId: mine });

    apiFetch(`/gba-stream/${code}/join`, {
      method: "POST",
      token,
      body: { peerId: mine },
    })
      .then((d) => {
        if (!alive) return;
        setRoom(d.room);
        setState("live");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message || "Cette diffusion est terminée.");
        setState(e.status === 404 ? "ended" : "error");
      });

    return () => {
      alive = false;
      // On prévient : sinon l'hôte garde une connexion morte et une ligne de
      // spectateur fantôme jusqu'à ce que le navigateur veuille bien la couper.
      apiFetch(`/gba-stream/${code}/leave`, {
        method: "POST",
        token,
        body: { peerId: mine },
        keepalive: true,
      }).catch(() => {});
      pc.current?.close();
      pc.current = null;
      chan.current = null;
      signal.current?.stop();
      signal.current = null;
    };
  }, [code, token]);

  // Le battement du spectateur : sans lui, un onglet fermé brutalement (crash,
  // veille, téléphone qui verrouille) resterait affiché en « Connexion… » chez
  // l'hôte et occuperait une des six places. Le « je m'en vais » part au pire
  // moment possible — celui où l'onglet meurt — il ne suffit donc pas.
  useEffect(() => {
    if (state !== "live") return undefined;
    const id = setInterval(() => {
      apiFetch(`/gba-stream/${code}/ping`, {
        method: "POST",
        token,
        body: { peerId: peerId.current },
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [state, code, token]);

  // ------------------------------------------------- la poignée de main --
  useEffect(() => {
    return subscribe((event, payload) => {
      if (event !== "gbastream" || payload?.code !== code) return;
      if (payload.kind === "room") return setRoom(payload.room);
      if (payload.kind === "end") {
        pc.current?.close();
        pc.current = null;
        return setState("ended");
      }
      if (payload.kind !== "signal" || payload.to !== peerId.current) return;

      // UNE OFFRE REMPLACE TOUT : elle ouvre une connexion neuve et son numéro
      // devient le seul valable. C'est ce qui répare le cas « le spectateur
      // entre, ressort et rentre » — sans quoi les restes de la poignée de main
      // abandonnée venaient tuer la nouvelle en silence.
      if (payload.data?.sdp?.type === "offer") {
        pc.current?.close();
        session.current = payload.data.session || null;
        pc.current = answerTo({
          from: payload.from,
          offer: payload.data.sdp,
          session: session.current,
          signal: signal.current,
          onState: setLink,
          onStream: (stream) => {
            if (!video.current || video.current.srcObject === stream) return;
            video.current.srcObject = stream;
            video.current.play?.().catch(() => {
              /* le navigateur attend un geste : la vidéo est muette, ça passera */
            });
          },
          onChannel: (channel) => {
            chan.current = channel;
          },
        });
        return;
      }
      if (payload.data?.session && payload.data.session !== session.current) return;
      applySignal(pc.current, payload.data).catch(() => {});
    });
  }, [code, subscribe]);

  // ------------------------------------------------------- la manette --
  //
  // LE CANAL DIRECT D'ABORD. Un appui qui passe par le serveur, c'est un
  // aller-retour vers le VPS puis un évènement en retour : Mario saute deux
  // dixièmes de seconde trop tard, ce qui est injouable. Le repli HTTP n'existe
  // que pour les quelques secondes où le canal n'est pas encore ouvert.
  const press = useCallback(
    (index, down) => {
      const dc = chan.current;
      if (dc?.readyState === "open") {
        try {
          dc.send(JSON.stringify({ index, down }));
          return;
        } catch {
          /* canal tombé : on repasse par le serveur */
        }
      }
      apiFetch(`/gba-stream/${code}/input`, {
        method: "POST",
        token,
        body: { peerId: peerId.current, index, down },
      }).catch(() => {});
    },
    [code, token]
  );

  const raiseHand = () =>
    apiFetch(`/gba-stream/${code}/hand`, {
      method: "POST",
      token,
      body: { peerId: peerId.current, up: !handUp },
    }).catch((e) => setError(e.message));

  function toggleSound() {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) v.play?.().catch(() => {});
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else shell.current?.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ------------------------------------------------------------ rendus --
  if (state === "loading")
    return (
      <div className="gbw-state">
        <Loader2 size={26} className="spin" />
        <p>On te connecte à la partie…</p>
      </div>
    );

  if (state === "ended" || state === "error")
    return (
      <div className="gbw-state">
        <Unplug size={26} />
        <strong>
          {state === "ended" ? "La console est éteinte." : "Diffusion inaccessible"}
        </strong>
        <p>
          {state === "ended"
            ? "L'hôte a arrêté de diffuser. La partie, elle, est sauvegardée sur son compte."
            : error}
        </p>
        <Link to="/activity" className="btn btn-ghost clickable">
          <ArrowLeft size={15} /> Retour à l'activité
        </Link>
      </div>
    );

  const viewers = room?.viewers?.length || 0;
  const holder = room?.viewers?.find((v) => v.pad);
  const waiting = link !== "connected";

  return (
    <div className={`gbw ${hasPad ? "playing" : ""}`} ref={shell}>
      <header className="gbw-top">
        <Link to="/activity" className="gbw-back clickable" aria-label="Retour">
          <ArrowLeft size={18} />
        </Link>
        <span className="gbw-live">
          <span className="gbx-live-dot" aria-hidden="true" /> EN DIRECT
        </span>
        <div className="gbw-id">
          <strong>{room?.title}</strong>
          <em>
            par{" "}
            <Link to={`/u/${room?.host?.username}`} className="clickable">
              {room?.host?.username}
            </Link>
          </em>
        </div>
        <span className="gbw-count" title="Spectateurs">
          <Users size={14} /> {viewers}
        </span>
        <button className="gbw-btn clickable" onClick={toggleSound} aria-label="Son">
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <button className="gbw-btn clickable" onClick={toggleFull} aria-label="Plein écran">
          {full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </header>

      <div className="gbw-screen">
        {/* `playsInline` : sans lui, un iPhone ouvre son lecteur plein écran et
            sort de la page. `muted` au départ, sinon la lecture est refusée. */}
        <video
          ref={video}
          className="gbw-video"
          autoPlay
          playsInline
          muted={muted}
        />

        {waiting && (
          <div className="gbw-wait">
            {link === "failed" ? (
              <>
                <WifiOff size={22} />
                <strong>La liaison directe n'a pas pu s'établir.</strong>
                <span>
                  Vos deux réseaux se refusent l'un l'autre. Un partage de
                  connexion, un autre wifi, et ça passe presque toujours.
                </span>
              </>
            ) : (
              <>
                <Loader2 size={22} className="spin" />
                <strong>On récupère l'image…</strong>
                <span>Elle vient directement de la console de {room?.host?.username}.</span>
              </>
            )}
          </div>
        )}

        {muted && !waiting && (
          <button className="gbw-unmute clickable" onClick={toggleSound}>
            <Volume2 size={15} /> Activer le son
          </button>
        )}
      </div>

      {/* LA MANETTE N'APPARAÎT QUE QUAND ON L'A. Un pad affiché en permanence,
          inerte, ferait croire à une panne à chaque appui. */}
      {hasPad ? (
        <>
          <p className="gbw-yours">
            <Gamepad2 size={15} /> Tu as la manette — c'est toi qui joues.
          </p>
          <GbaPad onPress={press} stick={loadView().stick} />
        </>
      ) : (
        <div className="gbw-ask">
          {holder ? (
            <span className="gbw-holder">
              <Gamepad2 size={14} /> <strong>{holder.username}</strong> tient la
              manette
            </span>
          ) : (
            <span className="gbw-holder">
              <Radio size={14} /> {room?.host?.username} joue
            </span>
          )}
          {/* On ne demande pas la manette à soi-même. */}
          {room?.host?.id !== user?.id && (
            <button
              className={`gbw-hand clickable ${handUp ? "on" : ""}`}
              onClick={raiseHand}
            >
              <Hand size={15} />
              {handUp ? "Main levée — j'attends" : "Demander la manette"}
            </button>
          )}
        </div>
      )}

      {error && <p className="gbw-err">{error}</p>}
    </div>
  );
}
