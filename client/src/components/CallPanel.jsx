import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ShieldQuestion,
  Users,
} from "lucide-react";
import useDraggable from "../hooks/useDraggable";
import { startOutgoingTone } from "../lib/ringtone";

// ======================================================================
//  Le panneau d'appel
// ======================================================================
// Un appel en cours, posé par-dessus l'app — PAS en plein écran. C'est le choix
// central : on appelle justement pour parler EN FAISANT autre chose (regarder
// une fiche ensemble, lancer une partie, chercher un truc). Un appel qui prend
// l'écran force à raccrocher pour faire ce pour quoi on avait appelé.
//
// ------------------------------------------------------- ON LE DÉPLACE
// Et c'est ce qui manquait. Un panneau vissé en bas à droite finit toujours par
// tomber sur ce qu'on veut lire — le champ d'écriture d'un message, la manette
// de la console, le bas d'une liste. Plutôt que de chercher le coin qui ne gêne
// jamais (il n'existe pas), on laisse le poser où l'on veut, et la place est
// retenue d'un appel à l'autre (hooks/useDraggable.js).
//
// ------------------------------------------- LE MICRO, PENDANT QU'ON ATTEND
// Le navigateur ouvre sa fenêtre d'autorisation TOUT EN HAUT, souvent très loin
// du bouton qu'on vient de cliquer, et parfois derrière la fenêtre. Sans un mot
// à l'écran, on regarde un panneau qui ne fait rien en attendant que l'app se
// décide, pendant que l'app attend un clic. D'où un écran d'attente qui dit
// exactement quoi chercher — et, en cas de refus, comment revenir en arrière
// (une autorisation refusée ne se redemande PAS toute seule : le navigateur
// s'en souvient, il faut passer par la barre d'adresse).
//
// LE CHRONO N'EST PAS DÉCORATIF : c'est la seule chose qui distingue « l'appel
// se connecte » de « l'appel tourne depuis vingt minutes et tout le monde a
// oublié de raccrocher ».
export default function CallPanel({ call, conversation, roster, note, me, onHangUp }) {
  const {
    participants,
    muted,
    toggleMute,
    connecting,
    micState,
    error,
    inCall,
    join,
  } = call;
  const [folded, setFolded] = useState(false);
  const seconds = useElapsed(inCall);
  const drag = useDraggable({ storageKey: "mpl_call_pos", width: 288, height: 300 });

  const title = conversation?.title || "Appel";

  // ======================================================================
  //  DEUX SOURCES, ET CHACUNE SON RÔLE
  // ======================================================================
  // C'est la correction du bogue le plus déroutant de ce panneau : quelqu'un
  // qui avait bel et bien décroché restait affiché « en attente », et parfois
  // en double.
  //
  //   LE SERVEUR dit QUI EST DANS L'APPEL (`roster`). C'est la seule vérité sur
  //   la présence, et elle ne dépend d'aucune connexion pair-à-pair.
  //   LE MAILLAGE dit SI JE L'ENTENDS (`call.participants`). C'est une question
  //   de tuyau, pas de présence.
  //
  // On mélangeait les deux : la liste des têtes venait du maillage. Résultat,
  // une connexion qui n'aboutit pas faisait DISPARAÎTRE la personne de l'écran,
  // qui repassait dans les « pas encore décroché » — le symptôme ressemblait à
  // « elle n'a pas répondu » alors que le vrai problème était « je n'arrive pas
  // à l'entendre ». Deux pannes très différentes, un seul affichage.
  const p2p = new Map(
    participants.filter((p) => p.userId).map((p) => [String(p.userId), p])
  );
  const myTile = participants.find((p) => p.isMe);
  const meId = String(me?.id || "");

  // Le serveur d'abord ; à défaut (le premier évènement n'est pas encore
  // arrivé), le maillage, pour ne jamais afficher une fenêtre vide.
  const seen = new Set();
  const tiles = (roster || [])
    .filter((r) => {
      // Un même compte ouvert dans deux onglets est UNE personne à l'écran.
      const k = String(r.userId);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const mine = String(r.userId) === meId;
      const link = p2p.get(String(r.userId));
      return {
        key: String(r.userId),
        isMe: mine,
        username: r.username,
        avatar: mine ? me?.avatar : r.avatar,
        muted: mine ? muted : r.muted,
        speaking: mine ? myTile?.speaking : link?.speaking,
        // Moi, je m'entends toujours. Les autres : l'état du tuyau.
        state: mine ? "connected" : link?.state || "connecting",
      };
    });

  const shown = tiles.length
    ? tiles
    : participants.map((p) => ({
        key: p.peerId,
        isMe: p.isMe,
        username: p.username,
        avatar: p.isMe ? me?.avatar : p.avatar,
        muted: p.muted,
        speaking: p.speaking,
        state: p.state,
      }));

  const others = shown.filter((p) => !p.isMe);
  const waiting = inCall && others.length === 0;
  // Quelqu'un dont la connexion a lâché. On le NOMME plutôt que de le faire
  // disparaître : « je n'entends plus Untel » se règle, « il n'y a plus
  // personne » laisse chercher pendant dix minutes.
  const broken = others.find((p) => p.state === "failed");

  // CEUX QU'ON APPELLE ET QUI N'ONT PAS ENCORE DÉCROCHÉ. Ils ne sont dans
  // aucune liste du serveur — ils ne sont pas dans l'appel, par définition.
  // Sans eux, un appel qui sonne n'affiche qu'une seule tête, la sienne, ce qui
  // ressemble à un appel raté plutôt qu'à un appel en cours.
  const here = new Set(shown.map((p) => p.key));
  const ghosts = (conversation?.others || [])
    .filter((o) => !here.has(String(o.id)))
    // Plafonné : dans un groupe de douze, onze fantômes ne racontent plus rien
    // et poussent les boutons hors de la fenêtre.
    .slice(0, Math.max(0, 6 - shown.length));

  // LA TONALITÉ D'APPEL, tant qu'on est seul en ligne. Sans elle, un appel qui
  // sonne chez l'autre est indiscernable d'un appel en panne — et on raccroche
  // au bout de quatre secondes en croyant que ça n'a pas marché.
  useEffect(() => {
    if (!waiting) return undefined;
    const stop = startOutgoingTone();
    return stop;
  }, [waiting]);

  const asking = micState === "asking";
  const denied = micState === "denied";

  return (
    <section
      ref={drag.ref}
      className={`call-panel ${folded ? "folded" : ""} ${drag.dragging ? "dragging" : ""}`}
      style={drag.style}
    >
      {/* La poignée EST l'en-tête : on saisit la fenêtre par sa barre de titre,
          comme partout ailleurs, plutôt que par une zone dédiée qu'il faudrait
          apprendre à viser. */}
      <header className="call-head" {...drag.handleProps}>
        <GripHorizontal size={14} className="call-grip" />
        <span className={`call-dot ${waiting ? "wait" : ""}`} aria-hidden="true" />
        <span className="call-title">
          {conversation?.isGroup && <Users size={13} />}
          {title}
        </span>
        {/* COMBIEN ON EST, DANS LA BARRE DE TITRE. C'est l'information qu'on
            vient chercher d'un coup d'œil, et elle doit rester lisible quand le
            panneau est REPLIÉ — c'est même là qu'elle compte le plus, puisque
            les têtes ne sont plus visibles. */}
        {inCall && (
          <span className="call-count" title={`${others.length + 1} en ligne`}>
            {others.length + 1}
          </span>
        )}
        <span className="call-time">
          {asking ? "micro…" : connecting ? <Loader2 size={13} className="spin" /> : fmt(seconds)}
        </span>
        <button
          type="button"
          className="call-fold clickable"
          // Un clic qui termine un déplacement ne replie pas la fenêtre :
          // sinon elle se referme à chaque fois qu'on la range.
          onClick={() => !drag.didDrag() && setFolded((v) => !v)}
          title={folded ? "Déplier" : "Replier"}
          aria-expanded={!folded}
        >
          {folded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </header>

      {!folded && (
        <div className="call-body">
          {asking || denied ? (
            <MicGate denied={denied} message={error} onRetry={join} />
          ) : (
            <>
              <ul className="call-people">
                {shown.map((p) => (
                  <li
                    key={p.key}
                    className={`${p.speaking ? "talking" : ""} ${p.muted ? "muted" : ""} ${
                      !p.isMe && (p.state === "connecting" || p.state === "new")
                        ? "linking"
                        : ""
                    } ${p.state === "failed" ? "broken" : ""}`}
                    // L'état brut du tuyau, au survol. Invisible au quotidien,
                    // mais c'est la première chose qu'on veut savoir quand
                    // quelqu'un est là sans qu'on l'entende.
                    title={p.isMe ? "toi" : `${p.username || "…"} · ${p.state}`}
                  >
                    <span className="call-av">
                      {p.avatar ? (
                        <img src={p.avatar} alt="" loading="lazy" />
                      ) : (
                        <i>{(p.isMe ? me?.username || "?" : p.username || "?")[0].toUpperCase()}</i>
                      )}
                      {p.muted && <MicOff size={10} className="call-av-off" />}
                    </span>
                    <em>{p.isMe ? "toi" : p.username || "…"}</em>
                  </li>
                ))}

                {ghosts.map((o) => (
                  <li key={`ghost-${o.id}`} className="ghost">
                    <span className="call-av">
                      {o.avatar ? (
                        <img src={o.avatar} alt="" loading="lazy" />
                      ) : (
                        <i>{(o.username || "?")[0].toUpperCase()}</i>
                      )}
                    </span>
                    <em>{o.username || "…"}</em>
                  </li>
                ))}
              </ul>

              {/* Ce qui se passe, en une ligne. « Ça sonne… » compte autant que
                  le reste : c'est ce qui dit que l'appel est parti. */}
              {/* La ligne d'état ne dit QUE ce qui ne se voit pas ailleurs.
                  Pas le décompte (il est dans la barre de titre), et surtout
                  PAS qui parle : l'anneau autour de la tête le montre déjà, en
                  temps réel et sans lire. Doubler une information visuelle par
                  du texte, c'est du bruit qui clignote à chaque syllabe. */}
              {(error || note || waiting || broken) && (
                <p className={`call-note ${error || broken ? "bad" : ""}`}>
                  {error ||
                    note ||
                    (broken
                      ? `Connexion perdue avec ${broken.username || "un participant"} — nouvelle tentative…`
                      : "Ça sonne…")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="call-actions">
        <button
          type="button"
          className={`call-btn ${muted ? "off" : ""} clickable`}
          onClick={toggleMute}
          disabled={!inCall}
          title={muted ? "Reprendre la parole" : "Couper mon micro"}
          aria-label={muted ? "Reprendre la parole" : "Couper mon micro"}
        >
          {muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button
          type="button"
          className="call-btn hang clickable"
          onClick={onHangUp}
          title="Raccrocher"
          aria-label="Raccrocher"
        >
          <PhoneOff size={17} />
        </button>
      </div>
    </section>
  );
}

// ============================================================
//  « Autorise ton micro »
// ============================================================
// Deux moments, deux textes, et la différence est capitale : tant que la
// fenêtre du navigateur est ouverte, il n'y a rien à faire d'autre que cliquer
// dedans — on montre donc OÙ elle est. Une fois refusée, elle ne reviendra
// jamais toute seule (le navigateur retient la réponse), et le seul chemin
// passe par l'icône de la barre d'adresse : le dire évite dix minutes de clics
// sur un bouton qui ne fera plus rien.
function MicGate({ denied, message, onRetry }) {
  return (
    <div className={`call-gate ${denied ? "bad" : ""}`}>
      <span className="call-gate-ico" aria-hidden="true">
        {denied ? <MicOff size={22} /> : <ShieldQuestion size={22} />}
        {!denied && <i className="call-gate-ping" />}
      </span>
      <b>{denied ? "Micro refusé" : "Autorise ton micro"}</b>
      <p>
        {denied
          ? message ||
            "Clique sur l'icône de cadenas dans la barre d'adresse, remets le micro sur « Autoriser », puis réessaie."
          : "Ton navigateur demande la permission, tout en haut de la fenêtre. Clique sur « Autoriser » — sans micro, personne ne t'entendra."}
      </p>
      {denied && (
        <button type="button" className="call-gate-retry clickable" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

// Le compteur repart de zéro à la connexion effective, pas à l'ouverture du
// panneau : compter les cinq secondes de poignée de main comme du temps d'appel
// donnerait un chrono déjà en retard au démarrage.
function useElapsed(running) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!running) {
      setN(0);
      return undefined;
    }
    const t0 = Date.now();
    const id = setInterval(() => setN(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return n;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
