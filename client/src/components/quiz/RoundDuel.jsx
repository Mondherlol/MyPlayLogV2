import { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Building2, Tag, Gamepad2, Music2, Check, X, Undo2 } from "lucide-react";
import { API_BASE } from "../../lib/api";

// ======================================================================
//  Épreuve « Duel » — deux jeux, des cartes à ranger
// ======================================================================
// « JEU A vs JEU B », et une poignée de cartes à déposer sous le bon : une
// date, un studio, un genre, une plateforme, parfois un extrait d'OST.
//
// ------------------------------------------------- pourquoi PAS de HTML5 drag
// L'API `draggable` native ne marche pas au doigt. Comme la moitié du site est
// consultée sur téléphone, elle aurait voulu dire écrire l'épreuve deux fois.
// On passe donc par les POINTER EVENTS, qui couvrent souris, doigt et stylet
// avec le même code — la carte suit le curseur, et la colonne survolée
// s'allume.
//
// Et parce qu'un glisser reste pénible sur un petit écran, TOUT MARCHE AUSSI
// AU CLIC : on touche une carte pour la sélectionner, on touche une colonne
// pour l'y poser. Les deux gestes écrivent dans la même fonction `place()`.
//
// ------------------------------------------------------------ le retour arrière
// Une carte déposée peut être reprise. C'est important : l'épreuve se joue à
// la déduction (« si celle-là est à droite, alors celle-ci… »), et une
// déduction se révise. Rien n'est validé avant la sonnerie ou le bouton.
const CARD_ICONS = {
  year: Calendar,
  studio: Building2,
  genre: Tag,
  platform: Gamepad2,
  ost: Music2,
};

export default function RoundDuel({ round, locked, reveal, onAttempt, onProgress, sfx }) {
  // cardId → index du jeu (0 ou 1). Les cartes absentes sont encore en main.
  const [placement, setPlacement] = useState({});
  // Carte sélectionnée au clic, en attente d'une colonne.
  const [picked, setPicked] = useState(null);
  // Glisser en cours : { id, x, y, over }.
  const [drag, setDrag] = useState(null);
  const sentRef = useRef(false);
  // « Armée » = la manche a réellement été jouable au moins un instant. Sans ce
  // garde-fou, un `locked` encore à `true` au montage (hérité de la manche
  // précédente) faisait rendre une copie vide et affichait le verdict avant
  // même d'avoir commencé.
  const armedRef = useRef(false);
  const placementRef = useRef({});
  placementRef.current = placement;
  const zonesRef = useRef([]);
  const handRef = useRef(null);

  const cards = round.cards || [];
  const games = round.games || [];

  useEffect(() => {
    setPlacement({});
    setPicked(null);
    setDrag(null);
    sentRef.current = false;
    armedRef.current = false;
  }, [round?.index]);

  useEffect(() => {
    if (!locked && !reveal) armedRef.current = true;
  }, [locked, reveal]);

  // L'envoi part une seule fois : à la sonnerie (le parent verrouille) ou quand
  // toutes les cartes sont posées et que le joueur valide.
  const send = useCallback(() => {
    if (sentRef.current || !armedRef.current) return;
    sentRef.current = true;
    onAttempt({ placement: placementRef.current });
  }, [onAttempt]);

  useEffect(() => {
    if (reveal) return;
    if (locked) send();
  }, [locked, reveal, send]);

  // ------------------------------------------------------------ le dépôt
  // UNE SEULE CARTE DE CHAQUE NATURE PAR JEU. Un jeu n'a pas deux dates de
  // sortie ni deux développeurs : empiler « 2015 » et « 2020 » sous le même
  // titre ne veut rien dire, et laissait proposer une réponse absurde.
  //
  // Quand la place est déjà prise, on ne refuse pas le geste — on ÉCHANGE.
  // Dans un duel, une nature compte deux cartes pour deux jeux : poser l'une
  // détermine l'autre. Envoyer l'occupante en face est donc à la fois le geste
  // le plus utile et le plus prévisible. Elle ne retombe en main que si la
  // place d'en face est elle aussi occupée (le cas de l'OST, seule de sa
  // nature).
  const place = useCallback(
    (cardId, gameIndex) => {
      if (locked || sentRef.current) return;
      const card = cards.find((c) => c.id === cardId);
      setPlacement((p) => {
        const next = { ...p };
        if (gameIndex == null) {
          delete next[cardId];
          onProgress?.(Object.keys(next).length, "");
          return next;
        }
        if (card) {
          const occupant = cards.find(
            (c) => c.id !== cardId && c.kind === card.kind && next[c.id] === gameIndex
          );
          if (occupant) {
            const other = gameIndex === 0 ? 1 : 0;
            const otherTaken = cards.some(
              (c) =>
                c.id !== cardId && c.id !== occupant.id && c.kind === card.kind && next[c.id] === other
            );
            if (!otherTaken && games.length > 1) next[occupant.id] = other;
            else delete next[occupant.id];
          }
        }
        next[cardId] = gameIndex;
        onProgress?.(Object.keys(next).length, "");
        return next;
      });
      setPicked(null);
      sfx?.play?.(gameIndex == null ? "tick" : "hint");
    },
    [locked, sfx, onProgress, cards, games.length]
  );

  // --- Glisser (pointer events) ---
  function onPointerDown(e, cardId) {
    if (locked || reveal) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: cardId, x: e.clientX, y: e.clientY, over: null });
  }
  function onPointerMove(e) {
    if (!drag) return;
    // Quelle zone est sous le doigt ? On relit les rectangles à chaque
    // mouvement plutôt que de les mémoriser : la page peut défiler pendant
    // qu'on glisse, et un rectangle périmé fait déposer la carte à côté.
    const inside = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return (
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      );
    };
    let over = null;
    zonesRef.current.forEach((el, idx) => {
      if (inside(el)) over = idx;
    });
    // La main est une zone de dépôt à part entière : c'est ce qui permet de
    // REPRENDRE une carte déjà déposée en la ramenant en bas, sans passer par
    // la petite flèche de retour.
    if (over === null && inside(handRef.current)) over = "hand";
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over } : d));
  }
  function onPointerUp() {
    if (!drag) return;
    if (drag.over === "hand") place(drag.id, null);
    else if (drag.over != null) place(drag.id, drag.over);
    setDrag(null);
  }

  const inHand = cards.filter((c) => placement[c.id] == null);
  const allPlaced = inHand.length === 0;

  // Les cartes encore en main, rangées par nature, dans l'ordre où les
  // gabarits les produisent (année, studio, genre, plateforme, OST) — c'est
  // l'ordre du plus facile au plus retors, et il vaut mieux que l'alphabet.
  const groups = (() => {
    const by = new Map();
    for (const c of inHand) {
      if (!by.has(c.kind)) by.set(c.kind, []);
      by.get(c.kind).push(c);
    }
    return [...by.entries()];
  })();

  return (
    <div className="qz-duel" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* Les deux jeux, face à face. Ce sont les zones de dépôt. */}
      <div className="qz-duel-board">
        {games.map((g, idx) => {
          const mine = cards.filter((c) => placement[c.id] === idx);
          return (
            <div
              key={g.gameId}
              ref={(el) => {
                zonesRef.current[idx] = el;
              }}
              className={`qz-duel-col ${drag?.over === idx ? "over" : ""} ${
                picked ? "targetable" : ""
              }`}
              onClick={() => picked && place(picked, idx)}
            >
              <div className="qz-duel-head">
                {g.cover ? (
                  <img src={g.cover} alt="" loading="lazy" draggable="false" />
                ) : (
                  <span className="qz-slot-ph">
                    <Gamepad2 size={18} />
                  </span>
                )}
                <b>{g.name}</b>
              </div>

              <div className="qz-duel-drop">
                {mine.length === 0 && <span className="qz-duel-hint">Dépose ici</span>}
                {mine.map((c) => {
                  const ok = reveal && Number(round.solution?.[c.id]) === idx;
                  const ko = reveal && !ok;
                  return (
                    <DuelCard
                      key={c.id}
                      card={c}
                      placed
                      picked={picked === c.id}
                      dragging={drag?.id === c.id}
                      good={ok}
                      bad={ko}
                      disabled={locked || reveal}
                      // Une carte posée se REPREND : on la glisse vers l'autre
                      // colonne (ou vers la main), ou on la touche puis on
                      // touche la colonne visée. Sans ça, la moindre hésitation
                      // obligeait à repasser par la petite flèche de retour —
                      // or l'épreuve se joue justement à la déduction, et une
                      // déduction se révise en permanence.
                      onPick={() => setPicked((prev) => (prev === c.id ? null : c.id))}
                      onPointerDown={(e) => onPointerDown(e, c.id)}
                      onTake={() => place(c.id, null)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Le « VS », posé entre les deux colonnes. Décoratif, mais c'est lui
            qui fait lire l'écran comme un affrontement plutôt que comme deux
            listes côte à côte. */}
        <span className="qz-duel-vs" aria-hidden="true">
          VS
        </span>
      </div>

      {/* ---- La main, RANGÉE PAR CATÉGORIE ----
          En vrac, on avait six étiquettes mélangées et il fallait lire chacune
          pour comprendre laquelle répondait à laquelle. Groupées, la déduction
          saute aux yeux : « Année de sortie : 2015 ou 2020 » se tranche d'un
          regard, alors que « 2015 » perdu entre un genre et une plateforme ne
          dit rien. C'est le même contenu, et une épreuve deux fois plus lisible.

          Une catégorie dont les deux cartes sont déjà posées disparaît : ce qui
          reste à l'écran est exactement ce qui reste à faire. */}
      {!reveal && (
        <div className="qz-duel-hand" ref={handRef}>
          <span className={`qz-duel-hand-drop ${drag?.over === "hand" ? "on" : ""}`}>
            Ramène une carte ici pour la reprendre
          </span>

          {groups.map(([kind, list]) => (
            <div key={kind} className="qz-duel-group">
              <span className="qz-duel-group-h">{list[0].label}</span>
              <div className="qz-duel-group-cards">
                {list.map((c) => (
                  <DuelCard
                    key={c.id}
                    card={c}
                    picked={picked === c.id}
                    dragging={drag?.id === c.id}
                    disabled={locked}
                    hideKind
                    onPick={() => setPicked((p) => (p === c.id ? null : c.id))}
                    onPointerDown={(e) => onPointerDown(e, c.id)}
                  />
                ))}
              </div>
            </div>
          ))}

          {allPlaced && (
            <button type="button" className="qz-duel-validate clickable" onClick={send} disabled={locked}>
              <Check size={16} /> Je valide
            </button>
          )}
        </div>
      )}

      {/* Le fantôme qui suit le curseur pendant le glisser. */}
      {drag && (
        <div className="qz-duel-ghost" style={{ left: drag.x, top: drag.y }}>
          <DuelCard card={cards.find((c) => c.id === drag.id)} ghost />
        </div>
      )}

      {!reveal && !allPlaced && (
        <span className="qz-duel-tip">
          Glisse une carte sur un jeu, ou touche-la puis touche le jeu. Une carte
          déjà posée se déplace de la même façon.
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- une carte
// La carte OST est la seule qui « fait » quelque chose : elle joue l'extrait.
// On passe par le flux m4a extrait par le serveur (/api/audio/:videoId), le
// même que le mini-lecteur et le blind test — une iframe YouTube ici serait
// impossible à démarrer dans les délais (cf. l'en-tête de pages/BlindTest.jsx).
function DuelCard({
  card,
  placed,
  picked,
  dragging,
  ghost,
  good,
  bad,
  disabled,
  // En main, la nature de la carte est déjà écrite au-dessus du groupe : la
  // répéter sur chaque carte n'ajoute que du bruit. Déposée, en revanche, elle
  // redevient nécessaire — la carte a quitté son groupe.
  hideKind,
  onPick,
  onTake,
  onPointerDown,
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  if (!card) return null;
  const Icon = CARD_ICONS[card.kind] || Tag;

  function toggleOst(e) {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    a.currentTime = 30; // pas l'intro : on veut le thème
    a.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    );
  }

  return (
    <div
      className={`qz-card k-${card.kind} ${placed ? "placed" : ""} ${picked ? "picked" : ""} ${
        dragging ? "dragging" : ""
      } ${ghost ? "ghost" : ""} ${good ? "good" : ""} ${bad ? "bad" : ""}`}
      onPointerDown={disabled ? undefined : onPointerDown}
      // On coupe la propagation : une carte POSÉE vit dans une colonne qui est
      // elle-même une zone de dépôt cliquable. Sans ça, la toucher pour la
      // sélectionner déclenchait aussi le dépôt de la colonne — on ne pouvait
      // donc pas la saisir au doigt pour l'envoyer ailleurs.
      onClick={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
              onPick?.();
            }
      }
      role={onPick ? "button" : undefined}
    >
      {hideKind ? (
        <Icon size={12} className="qz-card-ic" />
      ) : (
        <span className="qz-card-kind">
          <Icon size={12} /> {card.label}
        </span>
      )}

      {card.kind === "ost" ? (
        <>
          <button type="button" className="qz-card-ost clickable" onClick={toggleOst}>
            <Music2 size={14} />
            {playing ? "Pause" : "Écouter"}
          </button>
          <audio
            ref={audioRef}
            src={`${API_BASE}/audio/${card.videoId}`}
            preload="none"
            playsInline
            onEnded={() => setPlaying(false)}
          />
        </>
      ) : (
        <b className="qz-card-value">{card.value}</b>
      )}

      {placed && onTake && !good && !bad && (
        <button
          type="button"
          className="qz-card-take clickable"
          onClick={(e) => {
            e.stopPropagation();
            onTake();
          }}
          title="Reprendre la carte"
        >
          <Undo2 size={12} />
        </button>
      )}
      {good && <Check size={14} className="qz-card-mark" />}
      {bad && <X size={14} className="qz-card-mark" />}
    </div>
  );
}
