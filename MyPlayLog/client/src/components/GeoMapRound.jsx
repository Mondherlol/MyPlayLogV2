import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  Plus,
  Minus,
  Maximize2,
  Ruler,
  Check,
  Loader2,
  Crown,
  ChevronUp,
} from "lucide-react";
import { estimateMapPoints, MAP_MAX_POINTS } from "../lib/guessGame";

// ============================================================
//  La manche bonus — « où sur la carte ? »
// ============================================================
// Extrait de pages/GeoGamer.jsx pour être partagé avec le mode versus
// (pages/GeoVersus.jsx). UNE SEULE implémentation : la mécanique de pointage
// (zoom, glisser, conversion en fraction) est délicate et n'avait aucune raison
// d'exister en deux exemplaires qui dérivent l'un de l'autre.
//
// Deux régimes, et c'est la présence de `map.answer` qui les distingue :
//
//   SOLO      la réponse arrive avec la manche. On valide, on calcule sur place,
//             on montre le trait entre le clic et la vérité. Tout est local.
//   VERSUS    la réponse est restée au serveur (c'est lui l'arbitre, cf.
//             routes/geoVersus.js). On valide, l'épingle part, et on attend
//             que tout le monde ait posé la sienne : la vérité — et les
//             épingles des autres — n'arrivent qu'à la révélation.
//
// Toutes les coordonnées circulent dans le repère de la carte D'ORIGINE (celui
// du point de réponse). L'affichage n'est qu'une mise à l'échelle : le conteneur
// porte le `aspect-ratio` exact de l'image, donc un pourcentage de largeur
// correspond au même pourcentage de pixels, et la conversion tient en une règle
// de trois — quelle que soit la taille de l'écran.
export const MAP_SEC = 25;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

// ------------------------------------------------------------ la feuille mobile
// Sur téléphone, la carte n'est pas un panneau posé dans un coin : c'est une
// FEUILLE qui monte du bas, façon Instagram. Elle démarre repliée, et c'est tout
// l'intérêt — la première chose à faire sur une manche carte, c'est de tourner
// la tête dans le panorama pour reconnaître l'endroit. Un panneau qui mange
// d'emblée la moitié de l'écran oblige à choisir entre regarder et se situer.
//
// Repliée, il ne reste que la poignée, le titre et le chrono : 100 px environ,
// et le décor reste entièrement manipulable derrière.
const SHEET_PEEK = 100;
// Au-delà de ce déplacement, le geste est un glissement et non une tape.
const SHEET_TAP = 7;

// Les couleurs des épingles rivales, dans l'ordre des joueurs. La mienne garde
// toujours la couleur d'accent du jeu : sur une carte constellée de cinq
// épingles, il faut retrouver la sienne sans lire les étiquettes.
const RIVAL_HUES = [200, 280, 40, 330, 160];

// Contraint la translation pour que la carte couvre toujours le cadre : on ne
// doit jamais pouvoir la faire sortir et se retrouver devant du vide.
function clampView(v, box) {
  const w = box.width * v.z;
  const h = box.height * v.z;
  return {
    z: v.z,
    x: w <= box.width ? (box.width - w) / 2 : Math.min(0, Math.max(box.width - w, v.x)),
    y: h <= box.height ? (box.height - h) / 2 : Math.min(0, Math.max(box.height - h, v.y)),
  };
}

// ============================================================
//  Le chrono — l'objet le plus regardé de l'écran
// ============================================================
// Un anneau SVG qui se vide, le nombre de secondes au centre. Rien d'autre en
// haut de l'écran ne doit lui disputer l'attention : c'est la seule information
// qui change en continu et qui coûte des points.
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

export function TimerRing({ seconds, progress, hot, idle }) {
  return (
    <div className={`geo-timer ${hot ? "hot" : ""} ${idle ? "idle" : ""}`}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle className="geo-timer-track" cx="36" cy="36" r={RING_R} />
        <circle
          className="geo-timer-fill"
          cx="36"
          cy="36"
          r={RING_R}
          strokeDasharray={RING_C}
          // On décompte : l'anneau est plein au départ et se vide.
          strokeDashoffset={RING_C * progress}
        />
      </svg>
      <span className="geo-timer-num">{idle ? "—" : seconds}</span>
    </div>
  );
}

export default function MapRound({
  map,
  gameName,
  onDone,
  sfx,
  // ---- versus ----
  // Fin de la phase carte imposée par le serveur (ms d'horloge). Quand elle est
  // là, c'est elle qui mène le décompte : les joueurs doivent voir le MÊME
  // chiffre, pas chacun le sien parti à l'affichage de son propre écran.
  deadline = null,
  // Appelé à la validation, à la place du calcul local.
  onPin = null,
  // L'épingle est partie, on attend les autres.
  waiting = false,
  // { answer, entries: [{ id, name, avatar, x, y, distance, rank, points, isMe }] }
  reveal = null,
  // Faux quand je n'ai pas le droit de pointer sur cette manche (classique :
  // je n'ai pas trouvé le jeu). Je regarde les autres jouer.
  eligible = true,
  // Texte de l'en-tête, pour dire « le plus proche gagne » en buzzer.
  hint = null,
}) {
  const versus = !!onPin;
  const [pin, setPin] = useState(null);
  const [result, setResult] = useState(null);
  const [left, setLeft] = useState(MAP_SEC);
  // Filet de sécurité : si la carte ne se charge pas, on ne bloque pas le
  // joueur sur un cadre vide — on lui offre une sortie propre.
  const [imgError, setImgError] = useState(false);
  // Vue courante : facteur de zoom + translation EN PIXELS du cadre.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });

  // Feuille mobile : repliée au départ (cf. SHEET_PEEK). `dragY` n'est posé que
  // PENDANT un glissement — au repos c'est la classe CSS qui place la feuille,
  // pour que la transition d'ouverture soit gérée par le navigateur.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dragY, setDragY] = useState(null);

  const boxRef = useRef(null);
  const sheetRef = useRef(null);
  const sheetDrag = useRef(null);
  const pinRef = useRef(null);
  pinRef.current = pin;
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const validateRef = useRef(() => {});
  const sentRef = useRef(false);

  // Verrouillé : plus de clic possible. En versus dès que l'épingle est partie
  // (on ne se ravise pas), en solo dès que le résultat est affiché.
  const locked = versus ? waiting || !!reveal || !eligible : !!result;

  const validate = useCallback(() => {
    if (locked) return;
    const p = pinRef.current;
    if (versus) {
      // Une épingle ne part qu'une fois : le serveur refuse la seconde, autant
      // ne pas la lui envoyer.
      if (!p || sentRef.current) return;
      sentRef.current = true;
      onPin(p);
      sfx?.play?.("pin");
      return;
    }
    const r = estimateMapPoints(map, p);
    setResult({ ...r, guess: p });
    sfx?.play?.(r.points > MAP_MAX_POINTS * 0.5 ? "correct" : "wrong");
  }, [map, locked, sfx, versus, onPin]);
  validateRef.current = validate;

  // Chrono. Sans épingle posée à zéro, la manche vaut zéro — on ne bloque pas le
  // joueur indéfiniment sur une carte qu'il ne reconnaît pas.
  //
  // En versus le serveur ferme la phase de son côté : on ne fait qu'AFFICHER le
  // temps qu'il reste, et on envoie l'épingle en cours au dernier moment plutôt
  // que de la laisser mourir dans le navigateur.
  useEffect(() => {
    if (reveal) return undefined;
    if (versus && !deadline) return undefined;
    const end = deadline || Date.now() + MAP_SEC * 1000;
    const iv = setInterval(() => {
      const s = Math.ceil((end - Date.now()) / 1000);
      setLeft(Math.max(0, s));
      if (s <= 0) {
        clearInterval(iv);
        validateRef.current();
      }
    }, 200);
    return () => clearInterval(iv);
  }, [reveal, deadline, versus]);

  // Une fois le résultat affiché, on recadre sur l'ensemble pour que le joueur
  // voie son erreur en entier plutôt qu'un zoom sur son seul clic — et la
  // feuille s'ouvre d'elle-même : la réponse est ce qu'on est venu voir, on ne
  // va pas demander un geste de plus pour la découvrir.
  useEffect(() => {
    if (result || reveal) {
      setView({ z: 1, x: 0, y: 0 });
      setSheetOpen(true);
    }
  }, [result, reveal]);

  // ---------- La feuille : glisser pour ouvrir / replier ----------
  // Ce qui reste caché quand elle est repliée. Mesuré à chaud plutôt que figé :
  // la hauteur du panneau dépend du contenu (podium de fin de manche, message
  // d'attente…) et d'un écran à l'autre.
  const hiddenPx = useCallback(
    () => Math.max(0, (sheetRef.current?.offsetHeight || 0) - SHEET_PEEK),
    []
  );

  function sheetDown(e) {
    // Un bouton dans la poignée (aucun aujourd'hui, mais la zone est large)
    // ne doit pas démarrer un glissement.
    if (e.target.closest("button")) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    sheetDrag.current = {
      y: e.clientY,
      base: sheetOpen ? 0 : hiddenPx(),
      moved: 0,
      last: sheetOpen ? 0 : hiddenPx(),
    };
  }

  function sheetMove(e) {
    const d = sheetDrag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dy));
    d.last = Math.min(hiddenPx(), Math.max(0, d.base + dy));
    setDragY(d.last);
  }

  function sheetUp(e) {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragY(null);
    if (!d) return;
    // Tape franche : bascule. Glissement : on va là où on penche.
    if (d.moved < SHEET_TAP) setSheetOpen((o) => !o);
    else setSheetOpen(d.last < hiddenPx() / 2);
  }

  const applyZoom = useCallback((factor, cx, cy) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setView((v) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * factor));
      const k = z / v.z;
      // Point d'ancrage : ce qui est sous le curseur ne doit pas bouger.
      const ax = cx ?? box.width / 2;
      const ay = cy ?? box.height / 2;
      return clampView({ z, x: ax - k * (ax - v.x), y: ay - k * (ay - v.y) }, box);
    });
  }, []);

  function onWheel(e) {
    if (reveal) return;
    const box = boxRef.current.getBoundingClientRect();
    applyZoom(e.deltaY < 0 ? 1.25 : 1 / 1.25, e.clientX - box.left, e.clientY - box.top);
  }

  // Un même geste sert à déplacer ET à pointer : on ne tranche qu'au relâché,
  // selon la distance parcourue. En dessous du seuil c'est un clic, au-dessus
  // c'était un déplacement — sinon poser une épingle deviendrait impossible dès
  // qu'on bouge d'un pixel.
  function onPointerDown(e) {
    if (reveal) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ox: viewRef.current.x,
      oy: viewRef.current.y,
      moved: 0,
    };
  }

  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.moved < 4) return;
    const box = boxRef.current.getBoundingClientRect();
    setView((v) => clampView({ ...v, x: d.ox + dx, y: d.oy + dy }, box));
  }

  // Pincement à deux doigts = zoom. IL MANQUAIT PUREMENT ET SIMPLEMENT : la
  // molette est le seul zoom du bureau, et sur téléphone il n'y en avait aucun
  // — on ne pouvait donc pas s'approcher pour situer un point précis, ce qui
  // est pourtant tout le geste de cette manche. Les pointer events ne
  // fournissent pas le geste tout fait, on suit les deux touches nous-mêmes
  // (même approche que PanoViewer).
  function onTouchMove(e) {
    if (reveal || e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const box = boxRef.current?.getBoundingClientRect();
    if (box && pinchRef.current) {
      applyZoom(
        dist / pinchRef.current,
        (a.clientX + b.clientX) / 2 - box.left,
        (a.clientY + b.clientY) / 2 - box.top
      );
    }
    pinchRef.current = dist;
    // Un pincement n'est pas un pointage : on disqualifie le geste en cours
    // pour qu'un relâché ne pose pas d'épingle au milieu de l'écran.
    if (dragRef.current) dragRef.current.moved = Infinity;
  }

  const endPinch = useCallback(() => {
    pinchRef.current = null;
  }, []);

  function onPointerUp(e) {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d || d.moved >= 4 || locked || reveal) return;
    // Clic franc : on convertit en FRACTION de la carte, en défaisant la vue
    // courante. C'est le repère dans lequel le point de réponse est stocké, et
    // le seul qui survive à un zoom ou à un changement d'écran.
    const box = boxRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const x = (e.clientX - box.left - v.x) / (box.width * v.z);
    const y = (e.clientY - box.top - v.y) / (box.height * v.z);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setPin({ x, y });
    sfx?.play?.("pin");
  }

  const answer = reveal?.answer || (result ? map.answer : null);
  const mine = reveal?.entries?.find((e) => e.isMe) || null;
  const shown = result?.guess || (versus ? mine || pin : pin);
  // Rangées par distance : c'est l'ordre d'affichage ET le classement montré.
  // En buzzer le serveur a déjà posé un `rank` (il paie dessus) ; en classique
  // le barème est absolu et il n'y a pas de rang — on le calcule ici, pour
  // l'affichage seulement, afin que les deux modes se lisent pareil.
  const ordered = [...(reveal?.entries || [])]
    .filter((e) => e.x != null)
    .sort((a, b) => a.distance - b.distance);
  const closestId = ordered[0]?.id;
  const rivals = ordered.filter((e) => !e.isMe);

  const at = (p) => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });
  // Les épingles gardent leur taille à l'écran : on annule le zoom du calque.
  const pinScale = { transform: `translate(-50%, -100%) scale(${1 / view.z})` };

  return (
    <div
      className={`geo-map ${versus ? "versus" : ""} sheet ${sheetOpen ? "open" : ""}`}
      ref={sheetRef}
      // Le style en ligne n'existe QUE pendant le glissement : au repos, c'est
      // la classe `open` qui place la feuille, avec sa transition.
      style={dragY != null ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
    >
      {/* La zone d'attrape : la poignée ET l'en-tête. Attraper un trait de
          4 px au doigt est une épreuve ; toute la barre du haut répond. */}
      <div
        className="geo-map-grab"
        onPointerDown={sheetDown}
        onPointerMove={sheetMove}
        onPointerUp={sheetUp}
        onPointerCancel={sheetUp}
      >
        <span className="geo-map-grip" aria-hidden="true" />
        <div className="geo-map-head">
          <span className="geo-map-title">
            <MapPin size={15} />
            {gameName ? (
              <>
                Où étais-tu dans <b>{gameName}</b> ?
              </>
            ) : (
              <>Où était-ce ?</>
            )}
          </span>
          {reveal ? (
            <span className="geo-map-score">
              {mine ? (
                <>
                  +{mine.points}
                  <em>pts</em>
                </>
              ) : (
                <em>aucune épingle</em>
              )}
            </span>
          ) : result ? (
            <span className="geo-map-score">
              +{result.points}
              <em>pts</em>
            </span>
          ) : (
            <span className={`geo-map-timer ${left <= 8 ? "hot" : ""}`}>{left}s</span>
          )}
        </div>
        {/* Visible seulement quand la feuille est repliée (CSS) : sans elle,
            rien ne dit que ce bandeau se tire vers le haut. */}
        <span className="geo-map-pull">
          <ChevronUp size={14} /> Glisse pour ouvrir la carte
        </span>
      </div>

      <div
        className={`geo-map-stage ${result || reveal ? "done" : ""} ${
          view.z > 1 ? "zoomed" : ""
        }`}
        ref={boxRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchMove={onTouchMove}
        onTouchEnd={endPinch}
        onTouchCancel={endPinch}
      >
        <div
          className="geo-map-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
        >
          <img src={map.image} alt="" draggable="false" onError={() => setImgError(true)} />

          {/* Le trait entre le clic et la vérité : c'est lui qui fait
              comprendre l'erreur d'un coup d'œil. Le viewBox est en centièmes
              et `preserveAspectRatio: none` le fait s'étirer exactement comme
              l'image. */}
          {answer && (
            <svg
              className="geo-map-link"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {rivals.map((r) => (
                <line
                  key={r.id}
                  className="rival"
                  style={{ stroke: `hsl(${RIVAL_HUES[r.hue % RIVAL_HUES.length]} 80% 62% / .5)` }}
                  x1={r.x * 100}
                  y1={r.y * 100}
                  x2={answer.x * 100}
                  y2={answer.y * 100}
                />
              ))}
              {shown && (
                <line x1={shown.x * 100} y1={shown.y * 100} x2={answer.x * 100} y2={answer.y * 100} />
              )}
            </svg>
          )}

          {/* Les épingles rivales, sous la mienne et sous la vérité : c'est le
              moment où l'on voit qui connaissait vraiment le coin. */}
          {rivals.map((r) => (
            <span
              key={r.id}
              className={`geo-map-pin rival ${r.id === closestId ? "best" : ""}`}
              style={{
                ...at(r),
                ...pinScale,
                "--rival-hue": RIVAL_HUES[r.hue % RIVAL_HUES.length],
              }}
              title={`${r.name} · ${Math.round(r.distance * 100)}%`}
            >
              <MapPin size={22} />
              <i className="geo-map-pin-tag">{r.name}</i>
            </span>
          ))}

          {answer && (
            <span className="geo-map-pin truth" style={{ ...at(answer), ...pinScale }}>
              <i className="geo-map-halo" />
              <MapPin size={26} />
            </span>
          )}
          {shown && (
            <span className="geo-map-pin mine" style={{ ...at(shown), ...pinScale }}>
              <MapPin size={26} />
            </span>
          )}
        </div>

        {/* Commandes de vue, posées sur le cadre. */}
        <div className="geo-map-zoom">
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              applyZoom(1.4);
            }}
            title="Zoomer"
          >
            <Plus size={15} />
          </button>
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              applyZoom(1 / 1.4);
            }}
            title="Dézoomer"
          >
            <Minus size={15} />
          </button>
          <button
            className="clickable"
            onClick={(e) => {
              e.stopPropagation();
              setView({ z: 1, x: 0, y: 0 });
            }}
            title="Recadrer"
            disabled={view.z === 1}
          >
            <Maximize2 size={14} />
          </button>
        </div>

        {/* Carte illisible : plutôt qu'un cadre noir muet, une sortie claire.
            En versus il n'y a rien à fuir — le serveur enchaîne tout seul. */}
        {imgError && !versus && (
          <div className="geo-map-broken">
            <MapPin size={26} />
            <span>Carte indisponible</span>
            <button className="geo-rv-next clickable" onClick={() => onDone(null)}>
              Continuer
            </button>
          </div>
        )}
      </div>

      <div className="geo-map-foot">
        {reveal ? (
          <MapPodium ordered={ordered} />
        ) : result ? (
          <>
            <span className="geo-map-verdict">
              {result.guess ? (
                <>
                  <Ruler size={14} /> à <b>{Math.round(result.distance * 100)}%</b> de la carte
                </>
              ) : (
                <>Aucune réponse</>
              )}
            </span>
            <button className="geo-rv-next clickable" onClick={() => onDone(result)}>
              Continuer
            </button>
          </>
        ) : !eligible ? (
          <span className="geo-map-help">
            Tu n'as pas trouvé le jeu — cette carte se joue sans toi.
            <em>Regarde où ils se placent</em>
          </span>
        ) : waiting ? (
          <span className="geo-map-wait">
            <Loader2 size={14} className="spin" /> Épingle posée — on attend les autres…
          </span>
        ) : (
          <>
            <span className="geo-map-help">
              {pin ? "Déplace ton épingle ou valide" : "Touche la carte pour te situer"}
              <em>{hint || "molette ou pincement pour zoomer · glisser pour déplacer"}</em>
            </span>
            <button className="geo-rv-next clickable" onClick={validate} disabled={!pin}>
              Valider
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Le classement de la carte ----------
// N'a de sens qu'en versus : en solo il n'y a personne à départager. On affiche
// la distance parce que c'est elle qui fait la discussion (« tu étais à 3 % ! »).
function MapPodium({ ordered = [] }) {
  if (!ordered.length)
    return <span className="geo-map-verdict">Personne n'a posé d'épingle</span>;
  return (
    <ol className="geo-map-podium">
      {ordered.map((e, i) => (
        <li key={e.id} className={`${e.isMe ? "me" : ""} ${i === 0 ? "best" : ""}`}>
          <span className="geo-map-podium-rank">
            {i === 0 ? <Crown size={12} /> : i + 1}
          </span>
          <span className="geo-map-podium-name">{e.name}</span>
          <span className="geo-map-podium-dist">
            <Ruler size={11} /> {Math.round(e.distance * 100)}%
          </span>
          <span className="geo-map-podium-pts">
            {e.points > 0 ? `+${e.points}` : <Check size={12} />}
          </span>
        </li>
      ))}
    </ol>
  );
}
