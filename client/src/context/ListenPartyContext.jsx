import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import { useChat } from "./ChatContext";
import { usePlayer, usePlayerProgress } from "./PlayerContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";

// ======================================================================
//  Écouter à plusieurs — le mini-lecteur en réseau
// ======================================================================
// « Viens écouter ça » n'avait aucune traduction dans l'app : on partageait un
// lien en message privé, et chacun lançait la piste de son côté à trente
// secondes d'écart. Ici, quelqu'un ouvre sa séance depuis le mini-lecteur, ses
// abonnés la voient dans l'onglet Activité, et un bouton suffit — la même piste
// démarre, à la même seconde, dans le lecteur qu'ils ont déjà.
//
// ------------------------------------------------- pourquoi ici et pas ailleurs
// LE LECTEUR EST DÉJÀ GLOBAL (PlayerContext, monté au-dessus des routes pour
// survivre à toute navigation). Une séance d'écoute n'est donc PAS une page :
// c'en serait une pour la watchparty, où il faut un écran ; ici il n'y a rien à
// montrer que le lecteur n'affiche déjà. On se branche depuis le rail
// d'activité, on continue à naviguer, la musique suit. C'est ce qui fait la
// différence entre « rejoindre une séance » et « ouvrir une page ».
//
// ------------------------------------------------------- ce qui circule vraiment
// AUCUN AUDIO. Chacun lit la piste de son côté (même vidéo, même flux extrait) ;
// le serveur ne transporte qu'un repère — « piste X, position Y, ça joue ».
// Voir server/src/lib/listenRooms.js.
//
// ------------------------------------------------------------- l'hôte mène
// UN SEUL VOLANT. Laisser les auditeurs mettre en pause chez les autres semble
// généreux et devient ingérable à trois : personne ne sait plus qui vient
// d'arrêter la musique. La règle tient en une phrase — c'est sa séance, il
// choisit ; on suit, ou on part (le bouton est à côté).

const ListenPartyContext = createContext(null);

// L'hôte pose un repère toutes les 20 s même sans rien faire : c'est aussi son
// battement de cœur côté serveur (une séance sans nouvelles meurt à 65 s).
const HOST_BEAT = 20_000;
// Et il se surveille toutes les 2 s : changement de piste, pause, saut dans la
// barre — tout ce qui n'attend pas le prochain battement.
const TICK = 2000;
// Un saut dans la piste, c'est un écart entre où l'on est et où l'on DEVRAIT
// être si la lecture avait simplement continué. En dessous, c'est le jeu normal
// du buffering et des arrondis : y réagir enverrait des repères en boucle.
const JUMP_MS = 2500;
// Ce que l'auditeur tolère avant de se recaler. Plus bas, on saute pour un rien
// (et un saut s'entend) ; plus haut, on écoute décalé.
const DRIFT_MS = 3000;

// « Ça joue » du point de vue de l'hôte — chargement compris. Une piste qui
// démarre n'est pas encore `playing` (l'iframe met une seconde à répondre) : en
// s'en tenant au strict `playing`, chaque changement de morceau annoncerait
// d'abord une pause à tous les auditeurs, qui s'arrêteraient une seconde avant
// de repartir. Ce qu'on diffuse, c'est l'INTENTION.
const intendsToPlay = (p) => !!(p.playing || p.loading);

// Une piste réduite à ce qui voyage. Le lecteur trimballe d'autres champs selon
// d'où la piste vient ; on n'envoie que ce que l'autre côté saura rejouer.
const wire = (t) =>
  t && {
    id: t.id,
    videoId: t.videoId,
    name: t.name,
    artist: t.artist || "",
    artwork: t.artwork || null,
    gameId: t.gameId || null,
    gameName: t.gameName || null,
  };

// ----------------------------------------------------------------------
//  La sonde de position
// ----------------------------------------------------------------------
// LA POSITION DE LECTURE CHANGE 2 À 4 FOIS PAR SECONDE. S'y abonner depuis le
// provider re-rendrait toute l'application à ce rythme — c'est exactement ce
// que PlayerContext a séparé en deux contextes pour éviter. Ce composant
// minuscule est donc le seul abonné : il ne rend rien, il ne fait que déposer
// la position dans un ref que la mécanique consulte quand ELLE le décide (deux
// fois par seconde au plus). Ses re-rendus ne touchent que lui-même.
function ProgressProbe({ into }) {
  const p = usePlayerProgress();
  into.current = p;
  return null;
}

export function ListenPartyProvider({ children }) {
  const { token } = useAuth();
  const { subscribe } = useChat();
  const player = usePlayer();

  // { code, host, listeners, isHost, source } — la séance en cours, la mienne
  // ou celle de quelqu'un d'autre. Les deux ne coexistent jamais : on n'écoute
  // pas quelqu'un tout en diffusant.
  const [party, setParty] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const progressRef = useRef({ current: 0, duration: 0 });
  const partyRef = useRef(null);
  partyRef.current = party;

  // Miroir de l'état du lecteur : la boucle de l'hôte tourne dans un effet qui
  // ne se relance pas (sinon on redémarrerait le minuteur à chaque piste), elle
  // lirait donc une version figée.
  const playerRef = useRef(player);
  playerRef.current = player;

  // Le dernier repère envoyé (hôte) ou reçu (auditeur), pour savoir où l'on
  // devrait en être sans redemander à personne.
  const markRef = useRef(null); // { videoId, positionMs, at, playing }

  // ====================================================================
  //  « Écoute · Aerith's Theme » — visible sans même ouvrir de séance
  // ====================================================================
  // C'EST LA MOITIÉ DE LA FONCTIONNALITÉ, et la plus discrète : dès que
  // quelqu'un lance une piste, ses amis le voient dans le rail « en ce moment »,
  // séance ou pas. Sans ça, l'écoute en groupe serait une porte que personne ne
  // penserait à pousser — on ne rejoint que ce qu'on voit.
  //
  // ANNONCE FAIBLE (`weak`) : le lecteur est monté en permanence, une page de
  // jeu ne l'est que le temps qu'on y reste. « Joue à Pixel Rush » dit toujours
  // mieux ce qu'on fait qu'une musique de fond, donc le lecteur se tait tant
  // qu'une page parle (voir lib/presence.js).
  useLiveStatus("listen", player.current?.name || "", {
    token,
    active: !!player.current,
    weak: true,
  });

  // ====================================================================
  //  Côté hôte : poser des repères
  // ====================================================================
  const pushState = useCallback(
    async (code) => {
      const p = playerRef.current;
      const track = p.current;
      if (!track) return;
      const positionMs = Math.round((progressRef.current.current || 0) * 1000);
      markRef.current = {
        videoId: track.videoId,
        positionMs,
        at: Date.now(),
        playing: intendsToPlay(p),
      };
      try {
        await apiFetch(`/listen/${code}/state`, {
          method: "POST",
          token,
          body: {
            track: wire(track),
            // La file part avec : l'auditeur voit ce qui vient, et le serveur la
            // taille s'il le faut.
            queue: (p.queue || []).map(wire),
            index: p.index,
            playing: intendsToPlay(p),
            positionMs,
            source: p.source || null,
          },
        });
      } catch {
        // Séance perdue (serveur redémarré, expiration) : on s'arrête là plutôt
        // que de continuer à parler dans le vide.
        setParty((cur) => (cur?.code === code && cur.isHost ? null : cur));
      }
    },
    [token]
  );

  // La boucle de l'hôte. UN SEUL MINUTEUR pour trois questions : la piste a-t-
  // elle changé, la lecture s'est-elle arrêtée, a-t-on sauté ailleurs — plus le
  // battement de survie. Tout est lu dans des refs, donc rien ne le relance.
  useEffect(() => {
    if (!party?.isHost || !token) return undefined;
    const code = party.code;
    let last = 0;

    const tick = () => {
      const p = playerRef.current;
      // Le lecteur a été fermé : la séance n'a plus d'objet.
      if (!p.current) {
        apiFetch(`/listen/${code}/end`, { method: "POST", token }).catch(() => {});
        setParty(null);
        return;
      }
      const mark = markRef.current;
      const now = Date.now();
      const pos = Math.round((progressRef.current.current || 0) * 1000);
      // Où l'on devrait être si rien n'avait bougé depuis le dernier repère.
      const expected =
        mark && mark.playing ? mark.positionMs + (now - mark.at) : mark?.positionMs ?? 0;

      const changed =
        !mark ||
        mark.videoId !== p.current.videoId ||
        mark.playing !== intendsToPlay(p) ||
        Math.abs(expected - pos) > JUMP_MS;

      if (changed || now - last >= HOST_BEAT) {
        last = now;
        pushState(code);
      }
    };

    tick();
    const id = setInterval(tick, TICK);
    return () => clearInterval(id);
  }, [party?.isHost, party?.code, token, pushState]);

  // ====================================================================
  //  Côté auditeur : suivre
  // ====================================================================
  // Applique un état reçu. Trois cas, et un seul geste chacun :
  //   • pas la même piste → on charge la sienne, à SA position ;
  //   • la même, mais décalée → on se recale ;
  //   • ça joue / ça ne joue pas → on s'aligne.
  const applyState = useCallback((room) => {
    const p = playerRef.current;
    const track = room?.track;
    if (!track) return;
    const arrivedAt = Date.now();
    markRef.current = {
      videoId: track.videoId,
      positionMs: room.positionMs || 0,
      at: arrivedAt,
      playing: !!room.playing,
    };
    const seconds = (room.positionMs || 0) / 1000;

    if (p.current?.videoId !== track.videoId) {
      p.playFromList(track, room.queue?.length ? room.queue : [track], {
        source: room.source || null,
        startAt: seconds,
      });
      return; // le chargement démarre déjà en lecture, inutile d'en rajouter
    }

    const mine = (progressRef.current.current || 0) * 1000;
    if (Math.abs(mine - (room.positionMs || 0)) > DRIFT_MS) p.seekTo(seconds);
    if (room.playing) p.play();
    else p.pause();
  }, []);

  // Le recalage tranquille : rien n'est arrivé du serveur, mais l'écoute glisse
  // toute seule (mise en mémoire tampon, onglet endormi, piste qui s'enchaîne
  // chez nous et pas chez l'hôte). On vérifie de temps en temps, et on ne
  // bouge que si l'écart s'entend.
  //
  // C'EST AUSSI LUI QUI RATTRAPE LE DÉMARRAGE : une piste chargée démarre
  // toujours en lecture (c'est le lecteur qui le veut ainsi), y compris quand
  // on se branche sur quelqu'un qui est EN PAUSE. Plutôt qu'un minuteur posé à
  // l'aveugle après le chargement, on laisse cette boucle constater l'écart et
  // le corriger — un seul endroit qui compare ce qu'on fait à ce qu'on devrait
  // faire, quelle qu'en soit la cause.
  const followedCode = party && !party.isHost ? party.code : null;
  useEffect(() => {
    if (!followedCode) return undefined;
    const id = setInterval(() => {
      const mark = markRef.current;
      const p = playerRef.current;
      if (!mark || !p.current) return;

      // Piste différente = on a dérivé pour de bon (notre morceau s'est
      // enchaîné, pas le sien). On redemande l'état plutôt que d'attendre son
      // prochain repère en écoutant autre chose.
      if (p.current.videoId !== mark.videoId) {
        apiFetch(`/listen/${followedCode}`, { token })
          .then((d) => applyState(d.room))
          .catch(() => {});
        return;
      }
      if (!mark.playing) {
        if (p.playing) p.pause();
        return;
      }
      const expected = mark.positionMs + (Date.now() - mark.at);
      const mine = (progressRef.current.current || 0) * 1000;
      if (Math.abs(mine - expected) > DRIFT_MS) p.seekTo(expected / 1000);
    }, 2500);
    return () => clearInterval(id);
  }, [followedCode, token, applyState]);

  // Le battement de l'auditeur : le « je m'en vais » part au moment où l'onglet
  // se ferme, c'est-à-dire au pire moment pour une requête. Sans ce battement,
  // les partis resteraient affichés indéfiniment dans la liste des auditeurs.
  useEffect(() => {
    if (!followedCode || !token) return undefined;
    const id = setInterval(() => {
      apiFetch(`/listen/${followedCode}/ping`, { method: "POST", token }).catch(() => {
        setParty((cur) => (cur?.code === followedCode ? null : cur));
      });
    }, HOST_BEAT);
    return () => clearInterval(id);
  }, [followedCode, token]);

  // L'auditeur qui ferme le lecteur quitte la séance : garder le lien alors
  // qu'on a coupé le son n'aurait aucun sens (et le prochain repère relancerait
  // la musique tout seul, ce qui serait franchement pénible).
  useEffect(() => {
    if (!followedCode || player.current) return;
    apiFetch(`/listen/${followedCode}/leave`, { method: "POST", token }).catch(() => {});
    setParty(null);
  }, [followedCode, player.current, token]);

  // --- Le direct : tout arrive par le flux SSE déjà ouvert (ChatContext) ---
  // L'abonnement ne dépend que de l'EXISTENCE d'une séance : le branchait-on
  // sur `party`, chaque arrivée d'un auditeur le refermerait et le rouvrirait.
  const inParty = !!party;
  useEffect(() => {
    if (!inParty) return undefined;
    return subscribe((event, payload) => {
      if (event !== "listen" || payload?.code !== partyRef.current?.code) return;
      if (payload.kind === "end") {
        // On NE COUPE PAS la musique : l'hôte est parti, la piste en cours n'y
        // est pour rien. On se contente de rendre la main — c'est moins brutal
        // qu'un silence soudain, et l'auditeur décide de la suite.
        setParty(null);
        return;
      }
      if (payload.kind === "room" && payload.room) {
        setParty((cur) =>
          cur ? { ...cur, listeners: payload.room.listeners || [] } : cur
        );
        return;
      }
      if (payload.kind === "state" && payload.room) {
        setParty((cur) =>
          cur ? { ...cur, listeners: payload.room.listeners || cur.listeners } : cur
        );
        if (!partyRef.current?.isHost) applyState(payload.room);
      }
    });
  }, [inParty, subscribe, applyState]);

  // ====================================================================
  //  Les trois gestes
  // ====================================================================
  const start = useCallback(async () => {
    const p = playerRef.current;
    if (!p.current || !token) return;
    setBusy(true);
    setError("");
    try {
      const d = await apiFetch("/listen", {
        method: "POST",
        token,
        body: {
          track: wire(p.current),
          queue: (p.queue || []).map(wire),
          index: p.index,
          playing: intendsToPlay(p),
          positionMs: Math.round((progressRef.current.current || 0) * 1000),
          source: p.source || null,
        },
      });
      markRef.current = {
        videoId: p.current.videoId,
        positionMs: Math.round((progressRef.current.current || 0) * 1000),
        at: Date.now(),
        playing: intendsToPlay(p),
      };
      setParty({
        code: d.room.code,
        host: d.room.host,
        listeners: d.room.listeners || [],
        isHost: true,
        source: d.room.source || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [token]);

  const join = useCallback(
    async (code) => {
      if (!token || !code) return;
      setBusy(true);
      setError("");
      try {
        // On quitte proprement la précédente : on ne peut pas suivre deux
        // personnes, et une séance qu'on a oubliée continuerait de nous compter
        // parmi ses auditeurs.
        const cur = partyRef.current;
        if (cur && cur.code !== code) {
          const route = cur.isHost ? "end" : "leave";
          apiFetch(`/listen/${cur.code}/${route}`, { method: "POST", token }).catch(
            () => {}
          );
        }
        const d = await apiFetch(`/listen/${code}/join`, { method: "POST", token });
        applyState(d.room);
        setParty({
          code: d.room.code,
          host: d.room.host,
          listeners: d.room.listeners || [],
          isHost: !!d.host,
          source: d.room.source || null,
        });
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [token, applyState]
  );

  const stop = useCallback(async () => {
    const cur = partyRef.current;
    if (!cur || !token) return;
    setParty(null);
    const route = cur.isHost ? "end" : "leave";
    apiFetch(`/listen/${cur.code}/${route}`, { method: "POST", token }).catch(() => {});
  }, [token]);

  // Plus de session (déconnexion) : on ne garde pas une séance fantôme.
  useEffect(() => {
    if (!token) setParty(null);
  }, [token]);

  const value = useMemo(
    () => ({
      party,
      busy,
      error,
      // Vrai quand on suit quelqu'un : le mini-lecteur verrouille alors ses
      // commandes (c'est l'hôte qui mène) et propose de quitter.
      following: !!party && !party.isHost,
      hosting: !!party && party.isHost,
      start,
      join,
      stop,
      clearError: () => setError(""),
    }),
    [party, busy, error, start, join, stop]
  );

  return (
    <ListenPartyContext.Provider value={value}>
      <ProgressProbe into={progressRef} />
      {children}
    </ListenPartyContext.Provider>
  );
}

// Hors de l'espace connecté, le provider n'est pas monté : on rend un objet
// inerte plutôt que de faire planter l'appelant (même parti pris que useChat).
const EMPTY = {
  party: null,
  busy: false,
  error: "",
  following: false,
  hosting: false,
  start: () => {},
  join: () => {},
  stop: () => {},
  clearError: () => {},
};

export const useListenParty = () => useContext(ListenPartyContext) || EMPTY;
