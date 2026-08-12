import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthContext";
import { useChat } from "./ChatContext";
import { apiFetch } from "../lib/api";
import { playCallLeaveSound } from "../lib/sfx";
import useVoiceCall from "../hooks/useVoiceCall";
import IncomingCall from "../components/IncomingCall";
import CallPanel from "../components/CallPanel";

// ======================================================================
//  S'appeler — le chef d'orchestre
// ======================================================================
// Le maillage vocal lui-même est déjà écrit (hooks/useVoiceCall.js, partagé
// avec le Perroquet). Ce contexte ajoute ce qui fait qu'un appel est un APPEL et
// pas une salle où l'on entre : quelqu'un sonne, quelqu'un décroche.
//
// ----------------------------------------------- pourquoi ici, et pas dans une page
// Un appel n'est PAS une page. On décroche depuis n'importe où — en pleine
// partie de Perroquet, sur une fiche de jeu, dans l'arcade — et surtout on
// CONTINUE À NAVIGUER pendant qu'on parle : c'est même tout l'intérêt d'un appel
// dans une app de jeux. Monté au-dessus des routes, à côté de la messagerie dont
// il emprunte le flux temps réel, l'appel survit à toute navigation.
//
// C'est aussi ce qui interdit de rendre l'appel en plein écran : il vit dans un
// panneau flottant, comme les fenêtres de discussion, parce qu'un appel qui
// masque l'app empêche exactement ce pour quoi on appelait.
//
// ------------------------------------------------------- UN APPEL À LA FOIS
// Rejoindre un appel raccroche le précédent. Ce n'est pas une limite technique
// (le maillage s'en moque) mais une limite de bon sens : deux appels en même
// temps, c'est deux salles qui parlent dans les mêmes oreilles, sans aucun
// moyen de savoir qui dit quoi.

const CallContext = createContext(null);
export const useCall = () => useContext(CallContext) || {};

// Combien de temps on laisse la modale sonner si plus rien n'arrive du serveur.
// Le serveur raccroche déjà tout seul au bout de 45 s (RING_MS dans
// lib/callRooms.js) ; ce délai-ci n'est là que pour le cas où son message de
// fin se perd — une sonnerie qui ne s'arrête jamais est la pire panne possible.
const RING_GIVEUP_MS = 55_000;

export function CallProvider({ children }) {
  const { token, user } = useAuth();
  const { subscribe, conversations } = useChat();

  const [incoming, setIncoming] = useState(null); // l'appel qui sonne
  const [activeId, setActiveId] = useState(null); // la conversation où je parle
  const [live, setLive] = useState({}); // convId → appel en cours (bandeaux)
  const [note, setNote] = useState(""); // « Untel a refusé »
  // Ce qui doit sonner chez MOI, résolu par le serveur (mon fichier, ma
  // sonnerie de la banque, ou celle de l'app). Chargé À L'AVANCE : au moment où
  // ça sonne, il est trop tard pour aller demander quoi jouer.
  const [ringtone, setRingtone] = useState(null);
  const wantJoinRef = useRef(null);

  const call = useVoiceCall({
    base: activeId ? `/calls/${activeId}` : null,
    room: activeId,
    channel: "call",
    token,
    subscribe,
  });
  const { join, leave, inCall } = call;

  // La conversation où l'on parle, telle que la messagerie la connaît : c'est
  // elle qui porte le nom du groupe et les têtes. On ne recopie rien.
  const activeConv = useMemo(
    () => conversations?.find((c) => String(c.id) === String(activeId)) || null,
    [conversations, activeId]
  );

  // ---------- Décrocher pour de bon ----------
  // Le passage par un effet n'est pas un détour : `join` a besoin de l'adresse
  // de l'appel, qui n'existe qu'une fois `activeId` posé et le rendu passé.
  // Appeler `join()` dans le même geste que `setActiveId` appellerait l'ancien
  // (ou aucun).
  useEffect(() => {
    if (!activeId || !wantJoinRef.current) return;
    if (wantJoinRef.current !== activeId) return;
    wantJoinRef.current = null;
    join();
  }, [activeId, join]);

  const enter = useCallback(
    (convId) => {
      const id = String(convId);
      // Un appel à la fois : le hook raccroche le précédent tout seul quand son
      // adresse change (son effet de nettoyage), il n'y a rien à faire ici.
      wantJoinRef.current = id;
      setNote("");
      setActiveId(id);
    },
    []
  );

  const hangUp = useCallback(() => {
    leave();
    wantJoinRef.current = null;
    setActiveId(null);
    setNote("");
  }, [leave]);

  const accept = useCallback(() => {
    if (!incoming) return;
    enter(incoming.conversationId);
    setIncoming(null);
  }, [incoming, enter]);

  const decline = useCallback(() => {
    if (!incoming) return;
    const id = incoming.conversationId;
    setIncoming(null);
    apiFetch(`/calls/${id}/decline`, { method: "POST", token }).catch(() => {
      /* l'appel s'est terminé entre-temps : la sonnerie est déjà éteinte */
    });
  }, [incoming, token]);

  // Rechargé quand le réglage change (l'écran des paramètres met le compte à
  // jour, cf. components/RingtonePicker.jsx) : changer de sonnerie et devoir
  // recharger la page pour l'entendre serait un réglage à moitié appliqué.
  useEffect(() => {
    if (!token) return;
    apiFetch("/ringtones/effective", { token })
      .then(setRingtone)
      .catch(() => {
        /* pas de sonnerie jouable : la modale prend l'écran et vibre quand même */
      });
  }, [token, user?.ringtone?.source, user?.ringtone?.url]);

  // ---------- Les appels déjà en cours ----------
  // Relu à l'ouverture de l'app : quelqu'un qui recharge sa page au milieu d'un
  // appel de groupe doit retrouver son bandeau « rejoindre » tout de suite, pas
  // au prochain évènement — qui pourrait ne jamais venir si personne ne bouge.
  useEffect(() => {
    if (!token) return;
    apiFetch("/calls/active", { token })
      .then((d) => {
        const map = {};
        for (const c of d.calls || []) map[c.conversationId] = c;
        setLive(map);
      })
      .catch(() => {
        /* pas d'appel en cours, ou pas de réseau : les bandeaux resteront vides */
      });
  }, [token]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "call" || !data?.conversationId) return;
      const id = String(data.conversationId);

      if (data.kind === "ring") {
        // Déjà dans cet appel (un deuxième onglet, un évènement en double) :
        // pas de sonnerie. Sinon on s'appellerait soi-même.
        if (String(activeId) === id) return;
        setIncoming({
          conversationId: id,
          from: data.from,
          group: !!data.group,
          title: data.title,
          avatar: data.avatar,
          members: data.members,
        });
        return;
      }

      if (data.kind === "dismiss") {
        // Décroché ou refusé ailleurs (un autre onglet, le téléphone).
        setIncoming((cur) => (cur?.conversationId === id ? null : cur));
        return;
      }

      if (data.kind === "ended") {
        setIncoming((cur) => (cur?.conversationId === id ? null : cur));
        setLive((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
        // C'était le mien : le dernier a raccroché, ou la sonnerie a expiré.
        if (String(activeId) === id) hangUp();
        return;
      }

      if (data.kind === "live" && data.call) {
        setLive((cur) => ({ ...cur, [id]: data.call }));
        return;
      }

      if (data.kind === "declined" && String(activeId) === id) {
        // Le refus S'ENTEND. On regarde rarement le panneau en attendant qu'on
        // décroche — sans son, on continue d'attendre quelqu'un qui a déjà dit
        // non.
        playCallLeaveSound();
        setNote(`${data.username || "Quelqu'un"} n'a pas décroché.`);
      }
    });
  }, [subscribe, activeId, hangUp]);

  // La sonnerie ne dure pas éternellement, même si le serveur se tait.
  useEffect(() => {
    if (!incoming) return undefined;
    const t = setTimeout(() => setIncoming(null), RING_GIVEUP_MS);
    return () => clearTimeout(t);
  }, [incoming]);

  const value = useMemo(
    () => ({
      call,
      inCall,
      activeId,
      live,
      startCall: enter,
      joinCall: enter,
      hangUp,
      // Y a-t-il un appel en cours dans cette conversation ? C'est ce que
      // demandent le bandeau du fil et le bouton d'appel de l'en-tête.
      callIn: (convId) => live[String(convId)] || null,
    }),
    [call, inCall, activeId, live, enter, hangUp]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {/* Hors du flux du document, comme les pop-up de message : un appel ne
          dépend d'aucun conteneur de page. */}
      {incoming &&
        createPortal(
          <IncomingCall
            call={incoming}
            ringtone={ringtone}
            onAccept={accept}
            onDecline={decline}
          />,
          document.body
        )}
      {activeId &&
        createPortal(
          <CallPanel
            call={call}
            conversation={activeConv}
            roster={live[String(activeId)]?.participants || null}
            note={note}
            me={user}
            onHangUp={hangUp}
          />,
          document.body
        )}
    </CallContext.Provider>
  );
}
