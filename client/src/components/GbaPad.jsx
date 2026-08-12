import { useCallback, useEffect, useRef, useState } from "react";
import { BUTTONS } from "../lib/gbaInput";

// ======================================================================
//  La manette à l'écran
// ======================================================================
// ELLE REMPLACE LA COQUE DESSINÉE, et ce n'est pas le même objet. La coque était
// une image de Game Boy Advance dans laquelle un écran de 240 pixels finissait
// par occuper un quart de la fenêtre : joli une fois, gênant à chaque partie. Ici
// il n'y a plus de console à regarder — seulement DES COMMANDES, posées là où le
// pouce les trouve, et l'écran qui prend tout le reste.
//
// TROIS CHOSES QUE LA COQUE NE SAVAIT PAS FAIRE :
//
//   • LES DIAGONALES. Sur la coque, chaque bras de la croix était un bouton
//     séparé : on ne pouvait pas courir en biais dans Zelda, et c'est
//     rédhibitoire. Ici la croix est UNE SURFACE : c'est la position du pouce qui
//     dit la direction, en huit secteurs, et le pouce peut glisser de l'une à
//     l'autre sans lever.
//   • LE GLISSEMENT ENTRE A ET B. Rouler du B vers le A sans lever le doigt est
//     le geste de base d'un jeu de plateforme (courir puis sauter). Les boutons
//     capturent donc le pointeur mais surveillent aussi ce qui passe SOUS lui.
//   • LE RETOUR HAPTIQUE. Une vibration de huit millisecondes à l'appui : sur une
//     dalle de verre, c'est le seul moyen de savoir qu'on a touché le bouton et
//     pas le vide à côté.
//
// ET ELLE NE PREND RIEN QUAND ON N'Y TOUCHE PAS : la couche est transparente aux
// clics, seules les pastilles reprennent le pointeur. Sans ça elle volerait à
// l'écran son premier clic — celui dont l'iframe a besoin pour débloquer son son.

const INDEX = Object.fromEntries(BUTTONS.map((b) => [b.id, b.index]));
const DIRS = ["up", "right", "down", "left"];

// Les huit secteurs de la croix, dans l'ordre des angles rendus par `atan2`
// (0 = vers la droite, puis dans le sens horaire).
const SECTORS = [
  ["right"],
  ["right", "down"],
  ["down"],
  ["down", "left"],
  ["left"],
  ["left", "up"],
  ["up"],
  ["up", "right"],
];

const buzz = (ms) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* pas de vibreur : tant pis, ce n'était qu'un confort */
  }
};

export default function GbaPad({ onPress, disabled, stick = false }) {
  // Ce qui est enfoncé, pour l'affichage. La vérité, elle, est dans `down` —
  // un état de rendu ne peut pas servir à relâcher des boutons au démontage.
  const [lit, setLit] = useState(() => new Set());
  const down = useRef(new Set());
  // Ce que tient chaque doigt (voir plus bas : deux pouces sur A et B est le cas
  // normal, et chacun doit relâcher le sien et lui seul).
  const owner = useRef(new Map());

  const set = useCallback(
    (id, on) => {
      if (on === down.current.has(id)) return;
      if (on) down.current.add(id);
      else down.current.delete(id);
      setLit(new Set(down.current));
      onPress(INDEX[id], on);
    },
    [onPress]
  );

  // TOUT SE RELÂCHE AU DÉMONTAGE, et c'est indispensable : cacher la manette
  // pendant qu'une direction est tenue laisserait le personnage courir tout seul
  // contre un mur, sans plus aucun bouton pour l'arrêter.
  useEffect(
    () => () => {
      for (const id of down.current) onPress(INDEX[id], false);
      down.current.clear();
    },
    [onPress]
  );

  // Un doigt qui quitte la fenêtre, un onglet qui perd le focus : mêmes dégâts,
  // même remède.
  useEffect(() => {
    const lift = () => {
      if (!down.current.size) return;
      for (const id of down.current) onPress(INDEX[id], false);
      down.current.clear();
      owner.current.clear();
      setLit(new Set());
    };
    window.addEventListener("blur", lift);
    document.addEventListener("visibilitychange", lift);
    return () => {
      window.removeEventListener("blur", lift);
      document.removeEventListener("visibilitychange", lift);
    };
  }, [onPress]);

  // --------------------------------------------- la croix, ou le joystick --
  //
  // MÊME MATHÉMATIQUE, DEUX OBJETS. Dans les deux cas c'est la POSITION du pouce
  // par rapport au centre qui donne la direction, en huit secteurs. Ce qui
  // change est ce qu'on voit, et ça change tout à l'usage :
  //
  //   • LA CROIX est fixe. On sait où elle est, on y revient sans regarder —
  //     c'est ce que fait une vraie GBA, et les jeux sont dessinés pour ça.
  //   • LE JOYSTICK VIENT AU POUCE : il naît là où le doigt se pose et son
  //     champignon suit. Sur du verre, qui n'a aucun relief, c'est ce qui évite
  //     de « perdre » la croix au milieu d'un combat.
  const padRef = useRef(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, live: false });

  const aim = useCallback(
    (e) => {
      const el = padRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const mag = Math.hypot(x, y);
      // Le creux central : sans lui, poser le pouce pile au milieu déclenche une
      // direction au hasard, celle du bruit de la mesure.
      const dirs = mag < 0.24 ? [] : SECTORS[(Math.round((Math.atan2(y, x) / Math.PI) * 4) + 8) % 8];
      // La vibration marque le CHANGEMENT de direction, pas la présence d'une
      // direction : sans ça, le pouce posé au nord ferait vibrer le téléphone en
      // continu pendant qu'on avance.
      const moved = DIRS.some((d) => dirs.includes(d) !== down.current.has(d));
      for (const d of DIRS) set(d, dirs.includes(d));
      if (moved && dirs.length) buzz(4);
      // Le champignon suit le pouce, BORNÉ AU BORD : au-delà il sortirait de sa
      // cuvette, et un joystick dont le pouce dépasse ne ressemble plus à rien.
      if (stick) {
        const k = mag > 1 ? 1 / mag : 1;
        setKnob({ x: x * k, y: y * k, live: true });
      }
    },
    [set, stick]
  );

  function padDown(e) {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    buzz(6);
    aim(e);
  }

  function padMove(e) {
    if (disabled || !e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    aim(e);
  }

  function padUp(e) {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    for (const d of DIRS) set(d, false);
    setKnob({ x: 0, y: 0, live: false });
  }

  // ------------------------------------------------------------ un bouton --
  //
  // CHAQUE DOIGT TIENT SON BOUTON (table `owner`, plus haut). Deux pouces sur A
  // et B en même temps est le cas NORMAL, pas l'exception : relâcher « tous les
  // boutons » quand l'un des deux se lève couperait la course au moment du saut.
  const grab = useCallback(
    (pointerId, id) => {
      const cur = owner.current.get(pointerId);
      if (cur === id) return;
      if (cur) set(cur, false);
      if (id) {
        owner.current.set(pointerId, id);
        set(id, true);
        buzz(8);
      } else owner.current.delete(pointerId);
    },
    [set]
  );

  const key = (id, label, className = "") => (
    <button
      type="button"
      data-key={id}
      className={`gbx-key ${className} ${lit.has(id) ? "on" : ""}`}
      disabled={disabled}
      aria-label={BUTTONS.find((b) => b.id === id)?.label || id}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        grab(e.pointerId, id);
      }}
      // LE POINTEUR EST CAPTURÉ, mais on regarde quand même ce qu'il survole :
      // c'est ce qui permet de rouler du B vers le A sans lever le doigt. Le
      // bouton quitté se relâche, celui atteint s'enfonce.
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
        const under = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest?.(".gbx-key")?.dataset?.key;
        grab(e.pointerId, under && INDEX[under] !== undefined ? under : null);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        grab(e.pointerId, null);
      }}
      onPointerCancel={(e) => grab(e.pointerId, null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <div className={`gbx-pad ${disabled ? "off" : ""}`} aria-label="Manette">
      {/* --- à gauche : la croix, et L au-dessus --- */}
      <div className="gbx-pad-side left">
        {key("l", "L", "shoulder")}
        <div
          ref={padRef}
          className={`${stick ? "gbx-stick" : "gbx-dpad"} ${
            DIRS.some((d) => lit.has(d)) ? "on" : ""
          }`}
          role="group"
          aria-label={stick ? "Joystick" : "Croix directionnelle"}
          onPointerDown={padDown}
          onPointerMove={padMove}
          onPointerUp={padUp}
          onPointerCancel={padUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          {stick ? (
            <>
              {/* Les quatre repères de la cuvette : sans eux, un rond vide ne
                  dit pas qu'il commande des directions. */}
              {DIRS.map((d) => (
                <span key={d} className={`gbx-stick-tick ${d} ${lit.has(d) ? "on" : ""}`} />
              ))}
              <span
                className={`gbx-stick-knob ${knob.live ? "live" : ""}`}
                style={{ transform: `translate(${knob.x * 34}%, ${knob.y * 34}%)` }}
              />
            </>
          ) : (
            <>
              {DIRS.map((d) => (
                <span key={d} className={`gbx-dpad-arm ${d} ${lit.has(d) ? "on" : ""}`} />
              ))}
              <span className="gbx-dpad-hub" />
            </>
          )}
        </div>
      </div>

      {/* --- au centre, en bas : les deux pastilles. Elles sont petites et loin
              des pouces PARCE QU'ON S'EN SERT RAREMENT — une fois par partie pour
              START, presque jamais pour SELECT. Les mettre sous le pouce, c'est
              mettre un menu là où on appuie pour sauter. --- */}
      <div className="gbx-pad-mid">
        {key("select", "SELECT", "tiny")}
        {key("start", "START", "tiny")}
      </div>

      {/* --- à droite : A et B en diagonale, comme sur l'objet, et R au-dessus --- */}
      <div className="gbx-pad-side right">
        {key("r", "R", "shoulder")}
        <div className="gbx-face">
          {key("b", "B", "face b")}
          {key("a", "A", "face a")}
        </div>
      </div>
    </div>
  );
}
