import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useChat } from "../context/ChatContext";

// ======================================================================
//  La séance à plusieurs — l'état de la salle, et l'horloge commune
// ======================================================================
// Deux problèmes, et un seul est difficile.
//
// LE FACILE : l'état de la salle (qui est là, ce qu'on regarde, ce qui se dit).
// Il arrive par le flux SSE de la messagerie sous l'évènement `party` ; on le
// range, on le rend, terminé.
//
// LE DIFFICILE : L'HORLOGE. Deux navigateurs ne jouent JAMAIS une vidéo à la
// même vitesse — un tampon qui se vide, un onglet en arrière-plan que le
// navigateur ralentit, une publicité YouTube, et voilà dix secondes d'écart au
// bout d'un quart d'heure. Rejouer les ordres (« pause », « saut ») ne suffit
// donc pas : il faut RATTRAPER LA DÉRIVE en permanence.
//
// D'où le principe, qui tient en une phrase : L'HÔTE EST L'HORLOGE.
//
//   • l'hôte envoie sa position toutes les quatre secondes (`silent: true`) ;
//   • chaque invité en déduit où il DEVRAIT être — la position de l'hôte, plus
//     le temps écoulé depuis qu'il l'a envoyée, si ça joue ;
//   • au-delà d'un écart de tolérance, il se recale sans rien demander.
//
// Le décalage d'HORLOGE MURALE entre les machines est mesuré au passage (le
// serveur date chacune de ses réponses) : sans ça, un ordinateur réglé trente
// secondes en avance se croirait trente secondes en retard dans le film.
//
// L'ORDRE QU'ON VIENT DE DONNER EST APPLIQUÉ LOCALEMENT TOUT DE SUITE, et l'état
// de la salle est mis à jour dans la foulée sans attendre la réponse du serveur.
// Ce n'est pas de l'optimisme gratuit : sans ça, pendant les cent millisecondes
// où l'ordre est en vol, le lecteur de celui qui vient de cliquer diffère de
// l'état connu de la salle — et le rattrapage de dérive annulerait son geste.
//
// ------------------------------------------- et les lecteurs qu'on ne pilote pas
// Un hébergeur tiers dans une iframe ne se laisse ni mettre en pause ni déplacer
// (c'est une autre origine : il n'y a pas d'API, et il n'y en aura pas). Pour
// ceux-là, la synchronisation est GUIDÉE : un top de départ commun (« 3, 2, 1 »)
// que tout le monde voit à la même seconde, un chrono partagé pour se comparer,
// et les gestes de l'hôte annoncés à l'écran. C'est la seule chose honnête à
// faire — et c'est ce que font tous les sites de séance partagée.

// Tolérance avant recalage. En dessous, on ne touche à rien : un saut visible
// toutes les deux secondes est plus désagréable qu'une seconde de décalage que
// personne ne remarque.
const DRIFT_TOLERANCE = 2.2;
// Fréquence du battement de l'hôte (ms).
const BEAT_MS = 4000;
// Fréquence du contrôle de dérive chez l'invité (ms).
const CHECK_MS = 1500;
// Après un recalage, on laisse le lecteur respirer : YouTube met un instant à
// annoncer sa nouvelle position, et corriger dans cet intervalle ferait
// bégayer l'image.
const SETTLE_MS = 2200;
// Durée d'affichage d'un « X a mis en pause » et d'un « … écrit ».
const NOTE_MS = 4500;

export function useWatchParty({ code, token, me }) {
  const { subscribe } = useChat();

  const [party, setParty] = useState(null);
  const [media, setMedia] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error | gone
  const [error, setError] = useState(null);
  const [ended, setEnded] = useState(false);
  const [typing, setTyping] = useState({}); // userId -> { name, until }
  const [bursts, setBursts] = useState([]); // réactions qui s'envolent
  const [cue, setCue] = useState(null); // le décompte commun : { cueAt, at }
  // Le dernier geste reçu, pour l'annoncer à l'écran (« X a mis en pause ») —
  // et, en mode guidé, pour dire quoi faire à la main.
  const [note, setNote] = useState(null);
  // UN ORDRE VENU D'AILLEURS. Change d'identité à chaque réception : c'est ce qui
  // déclenche le recalage immédiat, y compris chez l'hôte (quand il a lâché la
  // télécommande, un invité peut mettre la séance en pause).
  const [order, setOrder] = useState(null);

  // L'état de l'hôte tel qu'on l'a reçu, gardé en ref : il est relu par la
  // boucle de dérive plusieurs fois par seconde, il n'a rien à faire dans un
  // state (chaque battement provoquerait un rendu de toute la page).
  const hostState = useRef({
    at: 0,
    playing: false,
    receivedAt: 0,
    sourceAt: 0,
    episodeIndex: 0,
  });
  // Écart entre l'horloge du serveur et la nôtre (ms) : serveur - nous.
  const clockSkew = useRef(0);

  const partyRef = useRef(null);
  partyRef.current = party;
  const meId = me?.id ? String(me.id) : null;

  // Range l'état reçu, en le ramenant dans NOTRE référentiel de temps.
  const applyHostState = useCallback((state) => {
    if (!state) return;
    if (state.now) clockSkew.current = state.now - Date.now();
    const age = state.updatedAt
      ? Math.max(0, Date.now() + clockSkew.current - state.updatedAt)
      : 0;
    hostState.current = {
      at: state.at || 0,
      playing: !!state.playing,
      sourceAt: state.sourceAt || 0,
      episodeIndex: state.episodeIndex || 0,
      // On antidate la réception de la valeur de son âge : un invité qui arrive
      // en cours de séance tombe ainsi à la bonne seconde, et pas à celle où
      // l'hôte a parlé pour la dernière fois.
      receivedAt: Date.now() - age,
    };
  }, []);

  // --- Charger la salle ------------------------------------------------------
  const load = useCallback(
    async (join = false) => {
      if (!token || !code) return null;
      try {
        const d = join
          ? await apiFetch(`/watchparty/${code}/join`, { method: "POST", token })
          : await apiFetch(`/watchparty/${code}`, { token });
        setParty(d.party);
        setMedia(d.media || null);
        setMessages(d.messages || []);
        applyHostState(d.party.state);
        setStatus("ready");
        return d;
      } catch (err) {
        setError(err.message);
        setStatus(err.status === 404 ? "gone" : "error");
        return null;
      }
    },
    [code, token, applyHostState]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  // --- Le flux ---------------------------------------------------------------
  useEffect(() => {
    if (!code) return undefined;
    return subscribe((event, payload) => {
      if (event !== "party" || payload?.code !== code) return;
      switch (payload.kind) {
        case "state":
        case "tick": {
          applyHostState(payload.state);
          // L'état de la salle sert à l'AFFICHAGE (le bouton lecture/pause, la
          // barre chez ceux qui ne pilotent pas). La position, elle, n'y passe
          // pas : elle changerait quatre fois par seconde pour rien.
          setParty((p) =>
            p
              ? {
                  ...p,
                  state: {
                    ...p.state,
                    playing: payload.state.playing,
                    episodeIndex: payload.state.episodeIndex,
                    sourceAt: payload.state.sourceAt,
                  },
                }
              : p
          );
          if (payload.kind === "state" && String(payload.by) !== meId) {
            setOrder({ id: `${Date.now()}`, by: payload.by, action: payload.action });
            if (payload.action)
              setNote({
                id: Date.now(),
                by: payload.by,
                action: payload.action,
                playing: payload.state.playing,
                at: payload.state.at,
                until: Date.now() + NOTE_MS,
              });
          }
          break;
        }
        case "cue":
          if (payload.cueAt) {
            if (payload.now) clockSkew.current = payload.now - Date.now();
            setCue({ cueAt: payload.cueAt, at: payload.at || 0 });
          }
          break;
        case "content":
          setParty((p) => (p ? { ...p, content: payload.content, state: payload.state } : p));
          setMedia(payload.media || null);
          applyHostState(payload.state);
          setCue(null);
          break;
        case "members":
          setParty((p) => (p ? { ...p, members: payload.members } : p));
          break;
        case "presence":
          // Un onglet fermé n'est pas un départ : la personne reste dans la
          // salle, sa tête s'éteint seulement (voir notifyPresence côté
          // serveur). Quitter vraiment passe par « members ».
          setParty((p) =>
            p
              ? {
                  ...p,
                  members: p.members.map((m) =>
                    String(m.id) === String(payload.userId)
                      ? { ...m, online: payload.online }
                      : m
                  ),
                }
              : p
          );
          break;
        case "mode":
          setParty((p) =>
            p
              ? {
                  ...p,
                  openControl: payload.openControl,
                  canControl: p.isHost || payload.openControl,
                }
              : p
          );
          break;
        case "chat":
          setMessages((prev) =>
            prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]
          );
          break;
        case "react":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
            )
          );
          break;
        case "burst":
          setBursts((prev) => [
            ...prev.slice(-14),
            { id: payload.id, emoji: payload.emoji, name: payload.name },
          ]);
          break;
        case "typing":
          setTyping((prev) => {
            const next = { ...prev };
            if (payload.stopped) delete next[payload.by];
            else next[payload.by] = { name: payload.name, until: Date.now() + NOTE_MS };
            return next;
          });
          break;
        case "end":
          setEnded(true);
          break;
        default:
          break;
      }
    });
  }, [subscribe, code, meId, applyHostState]);

  // Les réactions envolées se nettoient d'elles-mêmes : l'animation dure moins
  // de trois secondes, rien ne sert à les garder.
  useEffect(() => {
    if (!bursts.length) return undefined;
    const t = setTimeout(() => setBursts((prev) => prev.slice(1)), 3200);
    return () => clearTimeout(t);
  }, [bursts]);

  // Le bandeau du dernier geste s'efface tout seul.
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  // « … écrit » : les mentions expirent seules si le signal d'arrêt se perd.
  useEffect(() => {
    if (!Object.keys(typing).length) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (v.until > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [typing]);

  // --- Ce qu'on envoie -------------------------------------------------------

  const post = useCallback(
    (path, body) =>
      apiFetch(`/watchparty/${code}${path}`, { method: "POST", token, body }).catch(
        (err) => {
          // Une commande refusée ne casse pas la séance : on l'annonce, et la vie
          // continue (l'hôte a pu reprendre la télécommande entre-temps).
          setError(err.message);
          setTimeout(() => setError(null), 4000);
          throw err;
        }
      ),
    [code, token]
  );

  // L'ORDRE DE LECTURE PARTAGÉ. C'est ce point d'entrée que `useVideoSession`
  // appelle (via `sync.emit`), et il ne part que si l'on a le droit de piloter :
  // sans ce garde-fou, la fin d'un épisode chez un invité (enchaînement
  // automatique) enverrait toute la salle à l'épisode suivant.
  const emitControl = useCallback(
    ({ action = null, at = 0, playing = false, episodeIndex, sourceAt }) => {
      const p = partyRef.current;
      if (!p?.canControl) return;
      const next = {
        at: Math.max(0, Number(at) || 0),
        playing: !!playing,
        episodeIndex: episodeIndex ?? p.state.episodeIndex,
        sourceAt: sourceAt ?? p.state.sourceAt,
      };
      // Vu de la salle, c'est déjà fait (voir l'en-tête : sans ça le rattrapage
      // de dérive défait le geste qu'on vient tout juste de faire).
      hostState.current = { ...next, receivedAt: Date.now() };
      setParty((prev) => (prev ? { ...prev, state: { ...prev.state, ...next } } : prev));
      post("/state", { ...next, action }).catch(() => {});
    },
    [post]
  );

  const chat = useMemo(
    () => ({
      send: ({ text, media: att }) => post("/messages", { text, media: att }),
      react: (messageId, emoji) => post(`/messages/${messageId}/react`, { emoji }),
      typing: (stopped) => post("/typing", { stopped }).catch(() => {}),
    }),
    [post]
  );

  const burst = useCallback((emoji) => post("/burst", { emoji }).catch(() => {}), [post]);

  const startCue = useCallback(
    (at) => post("/cue", { at, delay: 3600 }).catch(() => {}),
    [post]
  );

  const setContent = useCallback(
    async (body) => {
      const d = await post("/content", body);
      setParty((p) => (p ? { ...p, ...d.party } : d.party));
      setMedia(d.media || null);
      applyHostState(d.party.state);
      setCue(null);
      return d;
    },
    [post, applyHostState]
  );

  const setOpenControl = useCallback(
    (open) => post("/control-mode", { open }).catch(() => {}),
    [post]
  );

  const invite = useCallback((userIds, text) => post("/invite", { userIds, text }), [post]);

  const leave = useCallback(
    () => apiFetch(`/watchparty/${code}/leave`, { method: "POST", token }).catch(() => {}),
    [code, token]
  );

  const join = useCallback(() => load(true), [load]);

  return {
    me,
    // Le jeton part avec la trousse : le composeur du salon en a besoin pour
    // déposer ses images et ses GIF (il réutilise l'upload de la messagerie).
    token,
    party,
    media,
    messages,
    status,
    error,
    ended,
    isHost: !!party?.isHost,
    canControl: !!party?.canControl,
    members: party?.members || [],
    typingNames: Object.values(typing).map((t) => t.name),
    bursts,
    cue,
    setCue,
    note,
    order,
    hostState,
    post,
    chat,
    burst,
    startCue,
    setContent,
    setOpenControl,
    invite,
    join,
    leave,
    emitControl,
  };
}

// ======================================================================
//  L'horloge de la salle, branchée sur le lecteur
// ======================================================================
// Se monte une fois la séance vidéo créée (`useVideoSession`). Trois règles, et
// elles se déduisent toutes de « l'hôte est l'horloge » :
//
//   1. L'HÔTE BAT LA MESURE et ne se corrige jamais tout seul — il EST la
//      référence. Se recaler sur son propre battement (vieux de quatre secondes)
//      le ferait bégayer à chaque fois que son tampon se vide ;
//   2. LES INVITÉS SE RECALENT en continu, sans jamais rien renvoyer : on passe
//      par `applyRemote`, la porte de `useVideoSession` qui pilote le lecteur
//      SANS repartir dans le tunnel (sinon deux navigateurs se renverraient
//      l'ordre à l'infini) ;
//   3. UN ORDRE VENU D'AILLEURS s'applique tout de suite, chez tout le monde —
//      l'hôte compris. C'est ce qui fait marcher « tout le monde peut piloter »
//      sans que l'hôte reste seul à jouer pendant que les autres sont en pause.
//
// Rien de tout ça ne vaut pour un lecteur qu'on ne pilote pas : il n'y a alors ni
// position à lire ni position à imposer (mode guidé, voir la page).
export function usePartyClock({ session, party, hostState, order, isHost, post, meId }) {
  const piloted = !!session?.piloted;
  const settleUntil = useRef(0);

  // Ce qui est courant, lu en ref : le battement ne doit pas se réinscrire à
  // chaque tick d'horloge du lecteur.
  const live = useRef({ cur: 0, playing: false });
  live.current = { cur: session?.cur || 0, playing: !!session?.isPlaying };

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Où en est l'hôte MAINTENANT : sa dernière position connue, plus le temps
  // écoulé depuis (seulement si ça joue chez lui).
  const hostClockAt = useCallback(() => {
    const h = hostState.current;
    if (!h.receivedAt) return 0;
    return h.at + (h.playing ? (Date.now() - h.receivedAt) / 1000 : 0);
  }, [hostState]);

  // Remet le lecteur d'accord avec la salle. L'ordre des corrections compte :
  // l'épisode et la source d'abord (ils remontent le lecteur), la lecture
  // ensuite, la position en dernier.
  const reconcile = useCallback(() => {
    const s = sessionRef.current;
    const h = hostState.current;
    if (!s?.piloted || !h.receivedAt) return;
    if (Date.now() < settleUntil.current) return;

    if (Number.isFinite(h.episodeIndex) && h.episodeIndex !== s.index) {
      s.applyRemote({ type: "episode", index: h.episodeIndex });
      settleUntil.current = Date.now() + SETTLE_MS;
      return;
    }
    if (Number.isFinite(h.sourceAt) && h.sourceAt !== s.sourceAt) {
      s.applyRemote({ type: "source", at: h.sourceAt });
      settleUntil.current = Date.now() + SETTLE_MS;
      return;
    }
    if (h.playing !== s.isPlaying) {
      s.applyRemote({ type: "toggle" });
      settleUntil.current = Date.now() + SETTLE_MS;
      return;
    }
    const target = hostClockAt();
    if (s.duration > 0 && Math.abs(s.cur - target) > DRIFT_TOLERANCE) {
      s.applyRemote({ type: "seek", at: Math.max(0, target) });
      settleUntil.current = Date.now() + SETTLE_MS;
    }
  }, [hostState, hostClockAt]);

  // 1. L'hôte bat la mesure — inutile de le faire quand il est encore seul.
  const alone = (party?.members?.length || 0) < 2;
  useEffect(() => {
    if (!isHost || !piloted || alone || !post) return undefined;
    const beat = () => {
      const { cur, playing } = live.current;
      post("/state", { at: cur, playing, silent: true }).catch(() => {});
    };
    const id = setInterval(beat, BEAT_MS);
    beat();
    return () => clearInterval(id);
  }, [isHost, piloted, alone, post]);

  // 2. Les invités se recalent en continu.
  useEffect(() => {
    if (isHost || !piloted) return undefined;
    const id = setInterval(reconcile, CHECK_MS);
    return () => clearInterval(id);
  }, [isHost, piloted, reconcile]);

  // 3. Un ordre venu d'ailleurs s'applique tout de suite (l'hôte aussi, quand il
  //    a lâché la télécommande). Le temps de repos d'un recalage précédent ne
  //    doit pas l'avaler : un ordre explicite passe devant.
  useEffect(() => {
    if (!order || String(order.by) === String(meId)) return;
    settleUntil.current = 0;
    reconcile();
  }, [order, meId, reconcile]);

  return { hostClockAt, reconcile };
}
