import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useChat } from "../context/ChatContext";
import {
  MAX_VIEWERS,
  applySignal,
  captureConsole,
  makePeerId,
  makeSignaller,
  offerTo,
} from "../lib/gbaStream";

// ======================================================================
//  Diffuser sa partie — côté hôte
// ======================================================================
// Une connexion par spectateur, toutes alimentées par LE MÊME flux capté une
// seule fois : capter le canvas deux fois coûterait deux encodages.
//
// TOUT VIT EN RÉFS, PAS EN ÉTAT. Les connexions, le flux, le signaleur : ce sont
// des objets vivants, pas des données à afficher. Les mettre dans `useState`
// relancerait l'abonnement SSE à chaque arrivée de spectateur — et un
// abonnement relancé au milieu d'une poignée de main, c'est une poignée de main
// perdue et un spectateur devant un écran noir.
//
// L'ÉTAT DU SALON, LUI, VIENT DU SERVEUR (`kind: room`) et n'est jamais deviné
// ici : qui tient la manette est une décision, elle ne peut pas avoir deux
// versions.

const BEAT = 30000;

export function useGbaBroadcast({ token, slug, win, onInput }) {
  const [room, setRoom] = useState(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);
  const [hasAudio, setHasAudio] = useState(true);
  const [links, setLinks] = useState({}); // peerId → état de la connexion

  const peerId = useRef(makePeerId());
  const stream = useRef(null);
  const peers = useRef(new Map()); // peerId → RTCPeerConnection
  const signal = useRef(null);
  const codeRef = useRef(null);
  const roomRef = useRef(null);
  const input = useRef(onInput);
  input.current = onInput;

  const { subscribe } = useChat();

  const shut = useCallback(() => {
    for (const { pc } of peers.current.values()) {
      try {
        pc.close();
      } catch {
        /* déjà fermée */
      }
    }
    peers.current.clear();
    signal.current?.stop();
    signal.current = null;
    // Les pistes se coupent, mais le canvas continue de vivre : on ne fait
    // qu'arrêter de le regarder.
    for (const t of stream.current?.getTracks() || []) t.stop();
    stream.current = null;
    codeRef.current = null;
    roomRef.current = null;
    setLinks({});
    setRoom(null);
  }, []);

  const start = useCallback(async () => {
    if (codeRef.current || starting) return;
    setStarting(true);
    setError(null);
    try {
      const { stream: s, hasAudio: audio } = captureConsole(win(), 30);
      stream.current = s;
      setHasAudio(audio);
      const d = await apiFetch("/gba-stream", {
        method: "POST",
        token,
        body: { slug, peerId: peerId.current },
      });
      codeRef.current = d.room.code;
      roomRef.current = d.room;
      signal.current = makeSignaller({
        code: d.room.code,
        token,
        peerId: peerId.current,
      });
      setRoom(d.room);
    } catch (e) {
      shut();
      setError(e.message || "La diffusion n'a pas pu s'ouvrir.");
    } finally {
      setStarting(false);
    }
  }, [slug, starting, token, win, shut]);

  const stop = useCallback(async () => {
    const code = codeRef.current;
    shut();
    if (!code) return;
    // `keepalive` : l'arrêt part souvent au moment où l'on ferme la console,
    // donc où le composant disparaît. Sans lui, les spectateurs resteraient
    // devant une image figée jusqu'à l'expiration du battement.
    apiFetch(`/gba-stream/${code}/end`, {
      method: "POST",
      token,
      keepalive: true,
    }).catch(() => {});
  }, [shut, token]);

  // Le battement : tant qu'il bat, le salon vit (voir lib/gbaRooms.js).
  useEffect(() => {
    if (!room) return undefined;
    const id = setInterval(() => {
      const code = codeRef.current;
      if (!code) return;
      apiFetch(`/gba-stream/${code}/beat`, {
        method: "POST",
        token,
        body: { peerId: peerId.current },
      }).catch(() => {});
    }, BEAT);
    return () => clearInterval(id);
  }, [room, token]);

  // Une offre par spectateur qui entre.
  //
  // ON RANGE LA CONNEXION AVEC SON NUMÉRO DE SESSION (voir lib/gbaStream.js) :
  // un spectateur qui entre, ressort et rentre laisse une poignée de main en
  // vol, et sa réponse périmée appliquée sur la nouvelle connexion la tuait sans
  // un mot — c'est ce qui laissait le spectateur sur « on récupère l'image ».
  const welcome = useCallback((to) => {
    if (!stream.current || !signal.current) return;
    if (peers.current.size >= MAX_VIEWERS) return;
    peers.current.get(to)?.pc.close();
    const { pc, session } = offerTo({
      stream: stream.current,
      to,
      signal: signal.current,
      onState: (state) => setLinks((l) => ({ ...l, [to]: state })),
      // L'APPUI DISTANT PREND LA MÊME PORTE QUE LE CLAVIER de l'hôte
      // (`pressButton`) — c'est ce qui rend ce mode presque gratuit. Mais on ne
      // l'écoute QUE s'il tient la manette d'après le serveur : le canal est
      // direct, il ne doit pas devenir une porte ouverte.
      onInput: (from, index, down) => {
        if (roomRef.current?.controller !== from) return;
        input.current?.(index, down);
      },
    });
    peers.current.set(to, { pc, session });
  }, []);

  // Le flux d'évènements du salon.
  //
  // L'ABONNEMENT DÉPEND D'UN BOOLÉEN, PAS DE L'OBJET SALON : `room` change à
  // chaque main levée et à chaque passage de manette, et se réabonner à ce
  // rythme finirait par jeter une poignée de main au mauvais moment.
  const live = !!room;
  useEffect(() => {
    if (!live) return undefined;
    return subscribe((event, payload) => {
      if (event !== "gbastream" || payload?.code !== codeRef.current) return;
      switch (payload.kind) {
        case "joined":
          welcome(payload.peerId);
          break;
        case "left": {
          peers.current.get(payload.peerId)?.pc.close();
          peers.current.delete(payload.peerId);
          setLinks((l) => {
            const next = { ...l };
            delete next[payload.peerId];
            return next;
          });
          break;
        }
        // UNE RÉPONSE PÉRIMÉE EST JETÉE, pas appliquée. Sans ce filtre, la
        // réponse d'une poignée de main abandonnée venait s'écraser sur la
        // connexion en cours et la condamnait en silence.
        case "signal": {
          const link = peers.current.get(payload.from);
          if (!link) break;
          if (payload.data?.session && payload.data.session !== link.session) break;
          applySignal(link.pc, payload.data).catch(() => {});
          break;
        }
        case "room":
          roomRef.current = payload.room;
          setRoom(payload.room);
          break;
        // Le repli quand le canal direct n'est pas (encore) ouvert : l'appui
        // est passé par le serveur, qui a déjà vérifié qui tient la manette.
        case "input":
          if (roomRef.current?.controller === payload.from)
            input.current?.(payload.index, payload.down);
          break;
        default:
          break;
      }
    });
  }, [live, subscribe, welcome]);

  // On n'éteint PAS au démontage sans le dire au serveur : une console fermée
  // laisse sinon un salon fantôme le temps du battement.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);

  const grantPad = useCallback(
    (peer) => {
      const code = codeRef.current;
      if (!code) return;
      apiFetch(`/gba-stream/${code}/pad`, {
        method: "POST",
        token,
        body: { peerId: peerId.current, peer: peer || null },
      }).catch((e) => setError(e.message));
    },
    [token]
  );

  return {
    live,
    room,
    links,
    error,
    hasAudio,
    starting,
    start,
    stop,
    grantPad,
    max: MAX_VIEWERS,
  };
}
