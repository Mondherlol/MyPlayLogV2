import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { GEO, PCT } from "../lib/gbaShell";
import { BUTTONS, DEFAULT_KEYS, assign, keyLabel } from "../lib/gbaInput";

// ======================================================================
//  La console : la coque, son écran, ses touches
// ======================================================================
// LA COQUE EST UN SVG, dessiné ici. Le rayon DS reposait sur un PNG percé de
// deux trous : il fallait mesurer les trous au décodeur pour y glisser les
// dalles, relever chaque pastille de touche sur des agrandissements gradués, et
// tout se décalait dès qu'on retouchait l'image. Ici, les mêmes nombres servent
// au tracé ET aux zones cliquables (voir gbaShell.js) : ils ne peuvent pas se
// contredire, la console est nette à toutes les tailles, et elle ne pèse rien.
//
// L'ÉCRAN EST UN TROU, LITTÉRALEMENT. Le SVG s'arrête au bord de la dalle et
// l'iframe est posée derrière, à la place exacte (GbaPlayer). Comme la GBA n'a
// qu'un écran, en 3/2 comme la fenêtre, il n'y a rien à recopier ni à mettre à
// l'échelle — c'est ce qui rend cette console fluide là où l'autre ramait.
//
// CLIQUER OU TOUCHER NE VEUT PAS DIRE LA MÊME CHOSE, et c'est la seule vraie
// idée de ce fichier :
//
//   • À LA SOURIS, appuyer sur un bouton dessiné n'a aucun intérêt pour JOUER —
//     un jeu de réflexes à la souris, un doigt à la fois, ne se joue pas. Si
//     quelqu'un clique sur le A, c'est qu'il veut savoir ou changer la touche
//     qui lui correspond. Le clic ouvre donc le réglage.
//
//   • AU DOIGT, il n'y a pas de clavier : les boutons dessinés SONT les
//     commandes. Le toucher appuie, tout simplement.
//
// Le type de pointeur suffit à trancher, sans mode ni bascule à comprendre.

export default function GbaConsole({
  shell,
  keys,
  onKeys,
  onPress,
  onCapture,
  lit,
  disabled,
}) {
  const [editing, setEditing] = useState(null); // id du bouton en réglage
  const [waiting, setWaiting] = useState(false); // on attend la frappe
  const [hover, setHover] = useState(null); // la touche survolée
  const [held, setHeld] = useState(() => new Set()); // ce qui est enfoncé
  const pressed = useRef(new Set());

  const close = useCallback(() => {
    setEditing(null);
    setWaiting(false);
  }, []);

  // Le réglage MET LA PARTIE EN RETRAIT : la touche qu'on apprend ne doit pas
  // aussi faire sauter le personnage. Le parent tient l'écoute du clavier, on lui
  // demande de se taire.
  useEffect(() => {
    onCapture?.(!!editing || waiting);
  }, [editing, waiting, onCapture]);

  // La frappe qui apprend la touche. En capture (troisième argument), donc AVANT
  // que quoi que ce soit d'autre ne la voie, et arrêtée net : une partie ne doit
  // pas recevoir la touche qu'on est en train de lui assigner.
  useEffect(() => {
    if (!waiting || !editing) return undefined;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return close();
      onKeys(assign(keys, editing, e.code, keyLabel(e)));
      return close();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [waiting, editing, keys, onKeys, close]);

  // Clic à côté, ou Échap : on referme.
  useEffect(() => {
    if (!editing) return undefined;
    function onDown(e) {
      if (!e.target.closest?.(".gba-keypop, .gba-spot")) close();
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [editing, close]);

  // ------------------------------------------------------------ les touches --
  function spotDown(e, btn) {
    if (disabled) return;
    // Au doigt : on joue. À la souris : on règle.
    if (e.pointerType === "touch") {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      pressed.current.add(btn.id);
      setHeld(new Set(pressed.current));
      onPress(btn, true);
      return;
    }
    setEditing((cur) => (cur === btn.id ? null : btn.id));
    setWaiting(false);
  }

  function spotUp(btn) {
    if (!pressed.current.has(btn.id)) return;
    pressed.current.delete(btn.id);
    setHeld(new Set(pressed.current));
    onPress(btn, false);
  }

  // Un doigt qui glisse hors du bouton l'a relâché : sans ça, la croix reste
  // enfoncée et le personnage part tout droit.
  useEffect(() => {
    const lift = () => {
      if (!pressed.current.size) return;
      for (const id of pressed.current) {
        const btn = BUTTONS.find((b) => b.id === id);
        if (btn) onPress(btn, false);
      }
      pressed.current.clear();
      setHeld(new Set());
    };
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
    window.addEventListener("blur", lift);
    return () => {
      window.removeEventListener("pointerup", lift);
      window.removeEventListener("pointercancel", lift);
      window.removeEventListener("blur", lift);
    };
  }, [onPress]);

  // -------------------------------------------------------- sans la coque --
  // L'écran seul. Il garde sa lueur et son cadre, mais plus rien à cliquer : au
  // clavier tout marche pareil, et au doigt on revient à la console.
  //
  // DANS LES DEUX DISPOSITIONS, LA DALLE EST UNE BOÎTE VIDE de classe
  // `gba-screen-slot`. Elle ne montre rien : c'est le parent qui la MESURE et
  // vient poser l'iframe dessus (voir GbaPlayer). Sans ce détour, l'iframe serait
  // enfant de la coque — et changer de disposition la démonterait, donc
  // relancerait le jeu en cours de partie.
  if (!shell) {
    return (
      <div className="gba-plain">
        <div className={`gba-screen-slot plain ${lit ? "lit" : ""}`} />
      </div>
    );
  }

  // ------------------------------------------------------------ la console --
  const btn = editing && BUTTONS.find((b) => b.id === editing);
  const tip = hover && BUTTONS.find((b) => b.id === hover);
  const bound = btn && keys[btn.id];
  const spotOf = (id) => PCT.spots[id];

  return (
    <div className={`gba-tpl ${lit ? "lit" : ""}`} style={{ aspectRatio: GEO.ratio }}>
      <Shell lit={lit} held={held} />

      {/* La dalle : une boîte vide, aux cotes de la géométrie. L'iframe vient s'y
          poser depuis le parent (voir plus haut). */}
      <div
        className="gba-screen-slot"
        style={{
          left: `${PCT.screen.left}%`,
          top: `${PCT.screen.top}%`,
          width: `${PCT.screen.width}%`,
          height: `${PCT.screen.height}%`,
        }}
      />

      <div className="gba-spots">
        {BUTTONS.map((b) => {
          const s = spotOf(b.id);
          const k = keys[b.id];
          return (
            <button
              key={b.id}
              type="button"
              className={`gba-spot clickable ${s.round ? "round" : ""} ${
                editing === b.id ? "on" : ""
              }`}
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: `${s.width}%`,
                height: `${s.height}%`,
              }}
              onPointerDown={(e) => spotDown(e, b)}
              onPointerUp={() => spotUp(b)}
              onPointerEnter={() => setHover(b.id)}
              onPointerLeave={() => setHover((h) => (h === b.id ? null : h))}
              onFocus={() => setHover(b.id)}
              onBlur={() => setHover((h) => (h === b.id ? null : h))}
              // Le clic natif ne sert à rien ici — tout se joue à l'appui — mais
              // sans lui le bouton resterait inatteignable au clavier.
              onClick={(e) => e.preventDefault()}
              aria-label={`${b.label}, touche ${k?.label || "non assignée"}`}
            />
          );
        })}
      </div>

      {/* L'ÉTIQUETTE SORT DU BOUTON, elle ne se pose pas dessus. Écrire « A »
          par-dessus le A gravé de la coque, c'est salir le dessin pour dire une
          chose qu'on ne lit qu'une fois. Une bulle au survol le dit aussi bien et
          laisse la console intacte. */}
      {tip && !editing && (
        <Bubble spot={spotOf(tip.id)} className="gba-tip">
          <span className="gba-tip-name">{tip.label}</span>
          <kbd className="gba-tip-key">{keys[tip.id]?.label || "—"}</kbd>
          <span className="gba-tip-hint">clic pour changer</span>
        </Bubble>
      )}

      {/* Le réglage d'une touche : une bulle sur le bouton, pas une modale. On y
          vient pour trois secondes et on veut voir la console pendant. */}
      {btn && (
        <Bubble
          spot={spotOf(btn.id)}
          className="gba-keypop"
          role="dialog"
          label={`Touche du bouton ${btn.label}`}
        >
          <div className="gba-keypop-head">
            <strong>{btn.label}</strong>
            <button className="clickable" onClick={close} aria-label="Fermer">
              <X size={13} />
            </button>
          </div>

          <button
            className={`gba-keypop-key clickable ${waiting ? "waiting" : ""}`}
            onClick={() => setWaiting(true)}
          >
            {waiting ? "Appuie sur une touche…" : bound?.label || "Non assignée"}
          </button>

          <div className="gba-keypop-foot">
            {waiting ? (
              <span>Échap pour annuler</span>
            ) : (
              <>
                <span>Clique pour réassigner</span>
                {bound?.code !== DEFAULT_KEYS[btn.id]?.code && (
                  <button
                    className="clickable"
                    onClick={() =>
                      onKeys(
                        assign(
                          keys,
                          btn.id,
                          DEFAULT_KEYS[btn.id].code,
                          DEFAULT_KEYS[btn.id].label
                        )
                      )
                    }
                  >
                    <RotateCcw size={11} /> Par défaut
                  </button>
                )}
              </>
            )}
          </div>
        </Bubble>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- la bulle --
//
// Près d'un bord, une bulle centrée sortirait du cadre : elle s'aligne alors sur
// le côté qui reste, et son bec suit. Les gâchettes, tout en haut de la coque,
// la font passer dessous. Ces trois cas se décidaient à la main en trois endroits
// — ils se décident ici une fois.
function Bubble({ spot, className, children, role, label }) {
  const side = spot.left > 55 ? "right" : spot.left < 20 ? "left" : "";
  const below = spot.top < 25 ? "below" : "";
  return (
    <div
      className={`${className} ${side} ${below}`}
      style={{ left: `${spot.left + spot.width / 2}%`, top: `${spot.top}%` }}
      role={role}
      aria-label={label}
      aria-hidden={role ? undefined : "true"}
    >
      {children}
    </div>
  );
}

// ====================================================================== SVG ==
//  Le dessin de la coque
// ==============================================================================
// UNE AGB-001 GRISE, vue de face. Les cotes viennent de gbaShell.js (dixièmes de
// millimètre de la vraie console) : on ne place rien « à l'œil » ici, on trace ce
// que le fichier de géométrie déclare.
//
// CE QUI FAIT QU'ON Y CROIT, et ce n'est pas la forme : ce sont les DEGRÉS DE
// MATIÈRE. Le plastique de la coque est mat et prend la lumière du haut ; le
// panneau de l'écran est brillant et la reflète en biais ; les boutons ont un
// capuchon bombé posé dans un puits creux. Trois matières, trois traitements —
// sans ça, un dessin vectoriel de console reste un schéma.
//
// LES BOUTONS S'ENFONCENT VRAIMENT (`held`) : c'est le seul retour visuel qu'a un
// joueur au doigt, et sans lui on ne sait pas si son appui a été pris.
function Shell({ lit, held }) {
  const { body, bezel, screen, led, spots } = GEO;
  const down = (id) => (held.has(id) ? "down" : "");

  return (
    <svg
      className="gba-svg"
      viewBox={`0 0 ${GEO.w} ${GEO.h}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Le plastique : plus clair en haut, la lumière vient de là. */}
        <linearGradient id="gba-body" x1="0" y1="0" x2="0.15" y2="1">
          <stop offset="0" stopColor="#8f95a6" />
          <stop offset="0.42" stopColor="#767c8d" />
          <stop offset="1" stopColor="#565b6a" />
        </linearGradient>
        {/* Les poignées, plus sombres : c'est là que la coque s'arrondit et
            échappe à la lumière. Posé en surimpression sur les deux bouts. */}
        <linearGradient id="gba-grip" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.30" />
          <stop offset="0.22" stopColor="#000" stopOpacity="0" />
          <stop offset="0.78" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.30" />
        </linearGradient>
        {/* Le panneau de l'écran : noir brillant, un reflet en diagonale. */}
        <linearGradient id="gba-bezel" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#2b2e37" />
          <stop offset="0.5" stopColor="#14161c" />
          <stop offset="1" stopColor="#0a0b0f" />
        </linearGradient>
        <linearGradient id="gba-gloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* Le capuchon d'un bouton : bombé, donc éclairé en haut à gauche. */}
        <radialGradient id="gba-cap" cx="0.36" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#5d6373" />
          <stop offset="0.55" stopColor="#3c4150" />
          <stop offset="1" stopColor="#23262f" />
        </radialGradient>
        <radialGradient id="gba-cap-lit" cx="0.36" cy="0.3" r="0.85">
          <stop offset="0" stopColor="#7b8294" />
          <stop offset="0.55" stopColor="#4e5464" />
          <stop offset="1" stopColor="#2b2f39" />
        </radialGradient>
        {/* Le puits dans lequel le bouton est posé : une ombre, pas un trait. */}
        <radialGradient id="gba-well" cx="0.5" cy="0.42" r="0.6">
          <stop offset="0.6" stopColor="#000" stopOpacity="0.34" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        {/* UNE OMBRE A DES BORDS FLOUS, sinon ce n'est pas une ombre. L'ombre de
            la croix était un décalage net de huit unités : à l'écran, elle se
            lisait comme une SECONDE CROIX plus claire posée derrière la première,
            et c'était le défaut le plus visible de tout le dessin. */}
        <filter id="gba-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* --- les gâchettes, DERRIÈRE la coque : de face, seule leur arête dépasse
              du haut. Elles sont donc tracées d'abord, et débordent largement
              vers le bas — le plastique en recouvre tout ce qui dépasse.

              SANS LETTRE GRAVÉE, et c'est fidèle : sur une vraie GBA, les L et R
              sont sur la tranche supérieure, invisibles de face. Les écrire ici
              aurait demandé de faire dépasser les gâchettes deux fois plus haut
              qu'elles ne dépassent. La bulle de survol les nomme, elle. --- */}
      {["l", "r"].map((id) => {
        const s = spots[id];
        return (
          <g key={id} className={`gba-trigger ${down(id)}`}>
            <rect
              x={s.x}
              y={s.y - 2}
              width={s.w}
              height={s.h + 120}
              rx="30"
              fill="url(#gba-cap)"
              stroke="#000"
              strokeOpacity="0.35"
              strokeWidth="3"
            />
            {/* L'arête éclairée : c'est la seule partie qu'on verra, autant
                qu'elle dise qu'il y a un relief. */}
            <rect
              x={s.x + 14}
              y={s.y + 6}
              width={s.w - 28}
              height="11"
              rx="5"
              fill="#fff"
              fillOpacity="0.14"
            />
          </g>
        );
      })}

      {/* --- le plastique --- */}
      <rect
        x={body.x}
        y={body.y}
        width={body.w}
        height={body.h}
        rx={body.r}
        fill="url(#gba-body)"
      />
      <rect
        x={body.x}
        y={body.y}
        width={body.w}
        height={body.h}
        rx={body.r}
        fill="url(#gba-grip)"
      />
      {/* L'arête vive du haut : un filet clair d'un pixel. C'est ce qui donne
          l'épaisseur, et il ne coûte qu'une ligne. */}
      <path
        d={`M ${body.r} ${body.y + 2} H ${body.w - body.r}`}
        stroke="#fff"
        strokeOpacity="0.28"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />

      {/* --- le panneau de l'écran --- */}
      <rect
        x={bezel.x}
        y={bezel.y}
        width={bezel.w}
        height={bezel.h}
        rx={bezel.r}
        fill="url(#gba-bezel)"
      />
      <rect
        x={bezel.x}
        y={bezel.y}
        width={bezel.w}
        height={bezel.h}
        rx={bezel.r}
        fill="url(#gba-gloss)"
      />
      {/* Le liseré interne de la dalle. La dalle elle-même n'est PAS dessinée :
          c'est un trou, l'iframe est derrière (voir GbaPlayer). En peindre le
          fond ici la masquerait. */}
      <rect
        x={screen.x - 3}
        y={screen.y - 3}
        width={screen.w + 6}
        height={screen.h + 6}
        rx="4"
        fill="none"
        stroke="#000"
        strokeOpacity="0.9"
        strokeWidth="6"
      />

      {/* Le témoin d'alimentation, à gauche de l'écran. Il ne s'allume que quand
          la partie tourne — c'est la différence entre une console et une photo de
          console. */}
      <circle
        cx={led.x}
        cy={led.y}
        r={led.r}
        className={`gba-led-dot ${lit ? "lit" : ""}`}
      />
      <text x={led.x} y={led.y + 34} className="gba-mark" fontSize="15" textAnchor="middle">
        POWER
      </text>

      {/* La sérigraphie sous l'écran. C'est elle qui dit à quelle machine on
          joue — d'où sa place, celle qu'elle occupe sur l'objet. */}
      <text x={bezel.x + 6} y={bezel.y + bezel.h + 58} className="gba-wordmark" fontSize="38">
        GAME BOY
      </text>
      <text
        x={bezel.x + 240}
        y={bezel.y + bezel.h + 58}
        className="gba-wordmark adv"
        fontSize="38"
      >
        ADVANCE
      </text>

      {/* --- la croix --- */}
      <g className="gba-dpad">
        <path
          d={crossPath(spots, 6)}
          fill="#000"
          fillOpacity="0.34"
          filter="url(#gba-soft)"
        />
        {["up", "down", "left", "right"].map((id) => {
          const s = spots[id];
          return (
            <rect
              key={id}
              className={`gba-pad-arm ${down(id)}`}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx="16"
            />
          );
        })}
        {/* Le moyeu : il recouvre la jonction des quatre bras, sinon on voit
            quatre rectangles au lieu d'une croix. */}
        <rect
          x={spots.left.x + spots.left.w - 8}
          y={spots.up.y + spots.up.h - 8}
          width={spots.up.w + 16}
          height={spots.left.h + 16}
          rx="6"
          fill="url(#gba-cap)"
        />
        {/* Le creux central, qui donne le basculement. */}
        <circle
          cx={spots.up.x + spots.up.w / 2}
          cy={spots.left.y + spots.left.h / 2}
          r="19"
          fill="#000"
          fillOpacity="0.22"
        />
      </g>

      {/* --- A et B. Les caractères sont GRAVÉS dans la coque, sous le bouton,
              pas écrits dessus : c'est ainsi sur l'objet, et ça laisse le
              capuchon propre. --- */}
      {["b", "a"].map((id) => {
        const s = spots[id];
        const cx = s.x + s.w / 2;
        const cy = s.y + s.h / 2;
        return (
          <g key={id} className={`gba-face ${down(id)}`}>
            <circle cx={cx} cy={cy} r={s.w / 2 + 16} fill="url(#gba-well)" />
            {/* LA LETTRE VA SOUS SON BOUTON, centrée. Posée en bas à gauche
                comme sur l'objet, celle du A tombait dans l'espace ENTRE les deux
                boutons — et semblait alors nommer le B. Sur un dessin, la
                fidélité qui rend une commande ambiguë ne vaut rien. */}
            <text
              x={cx}
              y={cy + s.h / 2 + 34}
              className="gba-mark"
              fontSize="36"
              textAnchor="middle"
            >
              {id.toUpperCase()}
            </text>
            <circle className="gba-face-cap" cx={cx} cy={cy} r={s.w / 2} />
            <ellipse
              cx={cx - s.w * 0.08}
              cy={cy - s.h * 0.2}
              rx={s.w * 0.2}
              ry={s.h * 0.11}
              fill="#fff"
              fillOpacity="0.09"
            />
          </g>
        );
      })}

      {/* --- START et SELECT, deux pastilles couchées. Leur libellé est SOUS
              elles : elles sont trop petites pour le porter. --- */}
      {["select", "start"].map((id) => {
        const s = spots[id];
        return (
          <g key={id} className={`gba-tiny ${down(id)}`}>
            <rect
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={s.h / 2}
              fill="url(#gba-well)"
            />
            <rect
              className="gba-tiny-cap"
              x={s.x + 6}
              y={s.y + 6}
              width={s.w - 12}
              height={s.h - 12}
              rx={(s.h - 12) / 2}
            />
            <text
              x={s.x + s.w / 2}
              y={s.y + s.h + 30}
              className="gba-mark"
              fontSize="24"
              textAnchor="middle"
            >
              {id.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// L'ombre portée de la croix, d'un seul tenant. Quatre ombres de rectangles se
// chevaucheraient à la jonction et y feraient une tache plus sombre — sur une
// croix, c'est exactement l'endroit qu'on regarde.
function crossPath(spots, d) {
  const { up, down: dn, left, right } = spots;
  const x1 = left.x + d;
  const x2 = right.x + right.w + d;
  const y1 = up.y + d;
  const y2 = dn.y + dn.h + d;
  const ax1 = up.x + d;
  const ax2 = up.x + up.w + d;
  const ay1 = left.y + d;
  const ay2 = left.y + left.h + d;
  return `M ${ax1} ${y1} H ${ax2} V ${ay1} H ${x2} V ${ay2} H ${ax2} V ${y2} H ${ax1} V ${ay2} H ${x1} V ${ay1} H ${ax1} Z`;
}
