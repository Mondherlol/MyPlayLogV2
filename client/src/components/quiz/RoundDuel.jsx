import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  CalendarClock,
  Check,
  Gamepad2,
  Hammer,
  Timer,
  Undo2,
  User,
  Users,
  Store,
  X,
} from "lucide-react";

// ======================================================================
//  Épreuve « Duel » — deux jeux, des affirmations à attribuer
// ======================================================================
// « JEU A vs JEU B », et une pile d'affirmations à déposer sur celui qu'elles
// désignent : « est sorti en premier », « a la meilleure note », « est sorti
// sur Switch », « a été joué par Léa ».
//
// Ce que ce composant affichait avant, c'étaient des VALEURS par paires
// (« 2015 » et « 2020 » à ranger). Le défaut était structurel et se voyait en
// jouant : poser une carte déterminait sa jumelle, donc six cartes ne posaient
// que trois questions. Le raisonnement derrière le changement est détaillé dans
// buildDuel (server/src/lib/quizRounds.js) ; ici, la conséquence est qu'une
// carte n'a plus de « nature » ni de jumelle, et que PLUSIEURS affirmations
// peuvent parfaitement désigner le même jeu.
//
// ------------------------------------------------- pourquoi PAS de HTML5 drag
// L'API `draggable` native ne marche pas au doigt. Comme la moitié du site est
// consultée sur téléphone, elle aurait voulu dire écrire l'épreuve deux fois.
// On passe donc par les POINTER EVENTS, qui couvrent souris, doigt et stylet
// avec le même code.
//
// Et parce qu'un glisser reste pénible sur un petit écran, TOUT MARCHE AUSSI
// AU CLIC : on touche une affirmation pour la sélectionner, on touche un jeu
// pour l'y poser. Les deux gestes écrivent dans la même fonction `place()`.
//
// ------------------------------------------------------------ le retour arrière
// Une carte déposée peut être reprise, ou envoyée directement sur l'autre jeu.
// C'est important : l'épreuve se joue à la déduction, et une déduction se
// révise. Rien n'est validé avant la sonnerie ou le bouton.

// Une icône par nature d'affirmation : elle se lit avant le texte et donne à la
// pile un peu de relief.
const CLAIM_ICONS = {
  first: CalendarClock,
  platform: Gamepad2,
  rating: Award,
  votes: Users,
  studio: Hammer,
  publisher: Store,
  modes: Users,
  time: Timer,
  player: User,
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
  // Aucune contrainte d'unicité : plusieurs affirmations peuvent désigner le
  // même jeu, c'est même le cas normal. L'ancienne règle « une carte de chaque
  // nature par jeu » (avec échange automatique) n'avait de sens que pour les
  // valeurs par paires, qui n'existent plus.
  const place = useCallback(
    (cardId, gameIndex) => {
      if (locked || sentRef.current) return;
      setPlacement((p) => {
        const next = { ...p };
        if (gameIndex == null) delete next[cardId];
        else next[cardId] = gameIndex;
        onProgress?.(Object.keys(next).length, "");
        return next;
      });
      setPicked(null);
      sfx?.play?.(gameIndex == null ? "tick" : "hint");
    },
    [locked, sfx, onProgress]
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
                      why={reveal ? round.why?.[c.id] : null}
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

      {/* ---- La pile d'affirmations ----
          Une liste, pas des groupes : chaque affirmation est indépendante, il
          n'y a plus de « catégorie » à regrouper. */}
      {!reveal && (
        <div className="qz-duel-hand" ref={handRef}>
          <span className={`qz-duel-hand-drop ${drag?.over === "hand" ? "on" : ""}`}>
            Ramène une carte ici pour la reprendre
          </span>

          {inHand.map((c) => (
            <DuelCard
              key={c.id}
              card={c}
              picked={picked === c.id}
              dragging={drag?.id === c.id}
              disabled={locked}
              onPick={() => setPicked((p) => (p === c.id ? null : c.id))}
              onPointerDown={(e) => onPointerDown(e, c.id)}
            />
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
// Une affirmation : une icône, le texte, et à la révélation la raison pour
// laquelle elle désignait ce jeu-là. Ce « pourquoi » n'est pas décoratif — sans
// lui on apprend qu'on s'est trompé, jamais pourquoi, et l'épreuve n'enseigne
// rien.
function DuelCard({
  card,
  placed,
  picked,
  dragging,
  ghost,
  good,
  bad,
  disabled,
  why,
  onPick,
  onTake,
  onPointerDown,
}) {
  if (!card) return null;
  const Icon = CLAIM_ICONS[card.kind] || Check;

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
      <span className="qz-card-claim">
        <Icon size={13} className="qz-card-ic" />
        <b>{card.label}</b>
      </span>

      {why && <em className="qz-card-why">{why}</em>}

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
