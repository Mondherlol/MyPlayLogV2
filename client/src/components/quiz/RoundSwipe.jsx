import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Gamepad2, X } from "lucide-react";

// ======================================================================
//  Épreuve « Le tri » — trente secondes, une pile, une seule question
// ======================================================================
// « Ce jeu est sorti sur Switch ? » et on balaie la pile : à gauche non, à
// droite oui. C'est la seule épreuve du lot qui ne demande aucune réflexion
// sur une carte donnée — tout se joue sur la cadence.
//
// ------------------------------------------------------------- trois entrées
// On peut répondre de trois façons, et ce n'est pas du luxe : à une seconde
// par carte, l'entrée qu'on n'a pas sous la main est une entrée qui coûte des
// points.
//   • au doigt / à la souris, en faisant glisser la carte ;
//   • aux flèches ← → du clavier, sur PC (c'est de LOIN le plus rapide) ;
//   • aux deux gros boutons, pour qui ne veut ni l'un ni l'autre.
//
// ------------------------------------------------------------- le verdict
// EN SOLO, on dit tout de suite si la carte était bien classée : un liseré vert
// ou rouge sur la carte qui s'envole, et le côté choisi qui s'allume de la même
// couleur. Sans ce retour, on trie vingt-quatre jaquettes à l'aveugle pendant
// trente secondes et on découvre son score à la fin — on ne peut ni se
// corriger, ni savoir si on a compris le critère.
//
// EN VERSUS, c'est impossible et c'est voulu : le serveur ne transmet pas le
// verdict des cartes avant la révélation (il donnerait la solution à qui
// ouvre la console). Les cartes arrivent alors sans `yes`, et l'épreuve se
// joue à l'aveugle pour tout le monde — donc équitablement. Le composant
// s'adapte tout seul à ce que la carte contient.
const SWIPE_THRESHOLD = 90;

// Durée de sortie d'une carte. C'EST AUSSI LA CADENCE MAXIMALE : tant qu'une
// carte est en vol, la suivante n'accepte pas de réponse.
//
// Sans ce verrou, une rafale de flèches traversait la pile en deux secondes
// sans qu'aucune carte n'ait eu le temps de s'afficher — on répondait à des
// jeux qu'on n'avait pas vus, et le score n'avait plus de sens. 210 ms, c'est
// assez pour voir la jaquette partir et la suivante arriver, et ça laisse
// largement le temps de traiter la pile entière dans les trente secondes.
const FLY_MS = 210;

// « juste » / « faux » / rien du tout (versus, où le verdict est inconnu).
const verdictClass = (v) => (v === null || v === undefined ? "" : v ? "ok" : "ko");

export default function RoundSwipe({ round, locked, reveal, onAttempt, onProgress, sfx }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [drag, setDrag] = useState({ x: 0, active: false });
  // LA CARTE QUI S'EN VA, rendue à part et avec sa propre image.
  //
  // Elle partageait auparavant son élément DOM avec la carte suivante : on
  // faisait voler l'élément, puis on incrémentait l'index, et le même nœud
  // revenait au centre — en affichant désormais la jaquette du jeu SUIVANT.
  // D'où l'impression que la carte qu'on venait d'écarter revenait se poser sur
  // le tas avec une autre image.
  //
  // Elle vit donc maintenant dans son propre calque, et l'index avance
  // IMMÉDIATEMENT : la carte du dessous devient celle de devant sans attendre,
  // exactement comme dans un vrai paquet.
  const [flying, setFlying] = useState(null);
  // Le côté qu'on vient de choisir, brièvement allumé. C'est le retour qui
  // manquait au clavier : à la souris on voit la carte suivre le curseur, aux
  // flèches on n'avait rien du tout.
  const [pulse, setPulse] = useState(null);
  const sentRef = useRef(false);
  // « Armée » = la manche a réellement été jouable au moins un instant. Tant
  // qu'elle ne l'a pas été, on refuse de rendre quoi que ce soit : sans ce
  // garde-fou, un `locked` encore à `true` au montage (hérité de la manche
  // précédente) faisait envoyer une pile vide et affichait le verdict avant
  // même d'avoir commencé.
  const armedRef = useRef(false);
  const answersRef = useRef([]);
  answersRef.current = answers;

  const deck = round.deck || [];
  const card = deck[i] || null;
  const done = i >= deck.length;

  useEffect(() => {
    setI(0);
    setAnswers([]);
    setDrag({ x: 0, active: false });
    setFlying(null);
    setPulse(null);
    sentRef.current = false;
    armedRef.current = false;
  }, [round?.index]);

  useEffect(() => {
    if (!pulse) return undefined;
    const t = setTimeout(() => setPulse(null), FLY_MS + 120);
    return () => clearTimeout(t);
  }, [pulse]);

  // Le compte des bonnes réponses, quand on le connaît (solo). Il monte en
  // direct : c'est lui qui donne envie de pousser la pile jusqu'au bout.
  const scored = answers.reduce((n, a) => {
    const c = deck.find((x) => Number(x.gameId) === Number(a.gameId));
    return typeof c?.yes === "boolean" ? n + (c.yes === a.yes ? 1 : 0) : n;
  }, 0);
  const knowsVerdict = deck.some((c) => typeof c.yes === "boolean");

  useEffect(() => {
    if (!locked && !reveal) armedRef.current = true;
  }, [locked, reveal]);

  // L'envoi. Il part UNE SEULE FOIS, quand la pile est épuisée ou quand la
  // manche se verrouille (chrono écoulé). D'où le garde `sentRef` : le
  // verrouillage et la fin de pile peuvent tomber dans le même rendu.
  const send = useCallback(() => {
    if (sentRef.current || !armedRef.current) return;
    sentRef.current = true;
    onAttempt({ answers: answersRef.current });
  }, [onAttempt]);

  useEffect(() => {
    if (reveal) return;
    if (done || locked) send();
  }, [done, locked, reveal, send]);

  const answer = useCallback(
    (yes) => {
      // `flying` sert de verrou de cadence : voir FLY_MS.
      if (locked || !card || sentRef.current || flying) return;
      // `yes` n'existe sur la carte qu'en solo (cf. l'en-tête) : `null` = on ne
      // sait pas, donc on ne dit rien.
      const verdict = typeof card.yes === "boolean" ? card.yes === yes : null;

      setFlying({ card, yes, verdict });
      setPulse({ side: yes ? "yes" : "no", verdict });
      setAnswers((a) => [...a, { gameId: card.gameId, yes }]);
      setDrag({ x: 0, active: false });
      // Le son suit le VERDICT quand on le connaît, le côté sinon.
      sfx?.play?.(verdict === null ? (yes ? "hint" : "tick") : verdict ? "correct" : "wrong");
      onProgress?.(answers.length + 1, "");

      // La suivante passe devant TOUT DE SUITE ; seule la carte sortante
      // continue son vol dans son calque.
      setI((n) => n + 1);
      setTimeout(() => setFlying(null), FLY_MS);
    },
    [locked, card, sfx, onProgress, answers.length, flying]
  );

  // --- Clavier : les flèches, et rien d'autre. ---
  useEffect(() => {
    if (locked || reveal || done) return undefined;
    function onKey(e) {
      if (e.repeat) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        answer(false);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        answer(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, locked, reveal, done]);

  // --- Glisser. Pointer events : une seule implémentation pour la souris,
  //     le doigt et le stylet. ---
  const startX = useRef(0);
  function onPointerDown(e) {
    if (locked || !card) return;
    startX.current = e.clientX;
    setDrag({ x: 0, active: true });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!drag.active) return;
    setDrag({ x: e.clientX - startX.current, active: true });
  }
  function onPointerUp() {
    if (!drag.active) return;
    if (Math.abs(drag.x) >= SWIPE_THRESHOLD) answer(drag.x > 0);
    else setDrag({ x: 0, active: false });
  }

  const good = answers.length;

  if (reveal) {
    // À la révélation, on montre le décompte, pas la pile : personne n'a envie
    // de revoir vingt-quatre jaquettes défiler.
    return (
      <div className="qz-swipe done">
        <span className="qz-swipe-crit">{round.criterion?.label}</span>
        <div className="qz-swipe-tally">
          <b>{knowsVerdict ? scored : good}</b>
          <em>
            {knowsVerdict
              ? `bien classé${scored > 1 ? "s" : ""} sur ${good} traité${good > 1 ? "s" : ""}`
              : `carte${good > 1 ? "s" : ""} traitée${good > 1 ? "s" : ""}`}
          </em>
        </div>
      </div>
    );
  }

  const tilt = Math.max(-14, Math.min(14, drag.x / 9));
  const intent = Math.abs(drag.x) >= SWIPE_THRESHOLD ? (drag.x > 0 ? "yes" : "no") : "";

  return (
    <div className="qz-swipe">
      {/* La question, une seule pour toute la pile : elle reste plantée en
          haut de l'écran pendant les trente secondes. */}
      <span className="qz-swipe-crit">{round.criterion?.label}</span>

      <div className="qz-swipe-stage">
        <span
          className={`qz-swipe-tag no ${intent === "no" ? "on" : ""} ${
            pulse?.side === "no" ? `hit ${verdictClass(pulse.verdict)}` : ""
          }`}
        >
          <X size={15} /> {round.criterion?.no || "Non"}
        </span>

        <div className="qz-swipe-pile">
          {/* LE PAQUET, EN UNE SEULE LISTE.
              Le tas et la carte de devant étaient rendus par deux boucles
              séparées : quand celle de devant partait, la suivante était
              DÉMONTÉE d'un côté et REMONTÉE de l'autre — elle réapparaissait
              d'un coup au centre au lieu d'avancer d'un cran.

              Ici, une seule liste dont la première entrée est la carte active.
              Comme la `key` porte le jeu et non la position, React réutilise le
              même nœud : la carte du dessous est PROMUE, et le glissement
              s'anime tout seul. C'est ce qui donne enfin l'impression d'un vrai
              paquet qu'on effeuille. */}
          {deck.slice(i, i + 4).map((c, k) => {
            const front = k === 0;
            return (
              <div
                key={c.gameId}
                className={`qz-swipe-card ${front ? "front" : "behind"}`}
                style={
                  front
                    ? {
                        transform: `translateX(${drag.x}px) rotate(${tilt}deg)`,
                        transition: drag.active ? "none" : undefined,
                      }
                    : { "--k": k }
                }
                onPointerDown={front ? onPointerDown : undefined}
                onPointerMove={front ? onPointerMove : undefined}
                onPointerUp={front ? onPointerUp : undefined}
                onPointerCancel={front ? onPointerUp : undefined}
              >
                {c.cover ? (
                  <img src={c.cover} alt="" draggable="false" />
                ) : (
                  <span className="qz-swipe-ph">
                    <Gamepad2 size={front ? 30 : 26} />
                  </span>
                )}
                {front && <span className="qz-swipe-name">{c.name}</span>}
              </div>
            );
          })}

          {/* LA CARTE QUI S'EN VA, dans son propre calque et avec SA jaquette.
              Voir le commentaire de `flying` : c'est ce découpage qui corrige
              l'animation, où la carte écartée revenait se poser en affichant
              l'image du jeu suivant. */}
          {flying && (
            <div
              key={`out-${flying.card.gameId}`}
              className={`qz-swipe-card outgoing ${flying.yes ? "fly-yes" : "fly-no"} ${verdictClass(
                flying.verdict
              )}`}
            >
              {flying.card.cover ? (
                <img src={flying.card.cover} alt="" draggable="false" />
              ) : (
                <span className="qz-swipe-ph">
                  <Gamepad2 size={30} />
                </span>
              )}
              <span className="qz-swipe-name">{flying.card.name}</span>
              {/* Le verdict, en solo seulement. */}
              {flying.verdict !== null && (
                <span className={`qz-swipe-verdict ${flying.verdict ? "good" : "bad"}`}>
                  {flying.verdict ? <Check size={22} /> : <X size={22} />}
                </span>
              )}
            </div>
          )}

          {done && !flying && <div className="qz-swipe-empty">Pile terminée&nbsp;!</div>}
        </div>

        <span
          className={`qz-swipe-tag yes ${intent === "yes" ? "on" : ""} ${
            pulse?.side === "yes" ? `hit ${verdictClass(pulse.verdict)}` : ""
          }`}
        >
          <Check size={15} /> {round.criterion?.yes || "Oui"}
        </span>
      </div>

      {/* Le tas qui fond, en une barre. « 12/24 » se lit, mais ne se SENT pas ;
          une barre qui se remplit, si. */}
      <i
        className="qz-swipe-progress"
        style={{ transform: `scaleX(${deck.length ? good / deck.length : 0})` }}
        aria-hidden="true"
      />

      <div className="qz-swipe-actions">
        <button
          type="button"
          className={`qz-swipe-btn no clickable ${
            pulse?.side === "no" ? `hit ${verdictClass(pulse.verdict)}` : ""
          }`}
          onClick={() => answer(false)}
          disabled={locked || done}
        >
          <X size={20} />
        </button>
        <span className="qz-swipe-count">
          {knowsVerdict ? scored : good}
          <em>/{deck.length}</em>
          {knowsVerdict && <i className="qz-swipe-count-lbl">justes</i>}
        </span>
        <button
          type="button"
          className={`qz-swipe-btn yes clickable ${
            pulse?.side === "yes" ? `hit ${verdictClass(pulse.verdict)}` : ""
          }`}
          onClick={() => answer(true)}
          disabled={locked || done}
        >
          <Check size={20} />
        </button>
      </div>
      <span className="qz-swipe-keys">
        <kbd>←</kbd> {round.criterion?.no || "Non"} · <kbd>→</kbd> {round.criterion?.yes || "Oui"}
      </span>
    </div>
  );
}
