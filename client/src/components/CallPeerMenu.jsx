import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneOutgoing, Volume2, VolumeX } from "lucide-react";

// ======================================================================
//  Le menu d'une tête, dans un appel
// ======================================================================
// Partagé par les DEUX appels du site — celui de la messagerie
// (components/CallPanel.jsx) et celui d'un salon du Perroquet
// (components/VoiceCallBar.jsx). Ce ne sont pas les mêmes écrans, mais c'est
// exactement le même geste et le même besoin : « je n'entends pas assez Untel ».
//
// Le réglage lui-même vit dans hooks/useVoiceCall.js, donc il est déjà commun
// aux deux ; n'y dupliquer que l'interface aurait garanti qu'elles divergent au
// premier ajustement — une avec l'appui long, l'autre sans, une qui se ferme à
// Échap, l'autre non.
//
// ---------------------------------------------------- souris ET doigt
// Clic droit à la souris, APPUI LONG au doigt. Sans le second, le réglage
// serait réservé aux ordinateurs, pour une gêne qui arrive au moins autant en
// mobilité — et le Perroquet se joue beaucoup au téléphone.

const LONG_PRESS_MS = 450;

export function usePeerMenu() {
  const [menu, setMenu] = useState(null);
  const timer = useRef(null);

  const close = useCallback(() => setMenu(null), []);

  // Un menu ouvert se ferme au premier geste ailleurs : c'est ce qu'on attend
  // d'un menu contextuel, et ne pas le faire laisse un panneau fantôme à
  // l'écran dès qu'on clique à côté.
  useEffect(() => {
    if (!menu) return undefined;
    const esc = (e) => e.key === "Escape" && setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu, close]);

  const openAt = useCallback((pt, user, kind) => {
    // On borne la position : ouvert sous le pouce en bas d'un téléphone, un
    // menu non contraint sort de l'écran et devient inatteignable.
    setMenu({
      x: Math.max(8, Math.min(pt.clientX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(pt.clientY, window.innerHeight - 160)),
      user,
      kind,
    });
  }, []);

  // À poser sur la tuile d'une personne. `user` = { id, username }.
  const tileProps = useCallback(
    (user, kind = "volume") => ({
      onContextMenu: (e) => {
        e.preventDefault();
        openAt(e, user, kind);
      },
      onPointerDown: (e) => {
        if (e.pointerType === "mouse") return;
        const { clientX, clientY } = e;
        timer.current = setTimeout(
          () => openAt({ clientX, clientY }, user, kind),
          LONG_PRESS_MS
        );
      },
      // Un doigt qui glisse ou se lève avant le délai annule : sans ça, tout
      // effleurement pendant un défilement ouvrirait un menu.
      onPointerUp: () => clearTimeout(timer.current),
      onPointerLeave: () => clearTimeout(timer.current),
      onPointerCancel: () => clearTimeout(timer.current),
    }),
    [openAt]
  );

  return { menu, close, tileProps };
}

// `onRecall` n'est fourni que par la messagerie : rappeler quelqu'un n'a de sens
// que dans un appel de groupe qu'on peut rater. Dans un salon de jeu, tout le
// monde est déjà là.
export default function PeerMenu({ menu, volumes, maxGain, onVolume, onRecall }) {
  if (!menu) return null;
  return (
    <div
      className="call-menu"
      style={{ left: menu.x, top: menu.y }}
      // Sans ça, le clic sur le menu remonterait jusqu'au gestionnaire qui le
      // referme, et l'action ne partirait jamais.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="call-menu-who">{menu.user.username}</span>

      {menu.kind === "recall" ? (
        <button type="button" className="clickable" onClick={() => onRecall?.(menu.user.id)}>
          <PhoneOutgoing size={14} /> Rappeler
        </button>
      ) : (
        <VolumeRow
          value={volumes?.[String(menu.user.id)] ?? 1}
          max={maxGain || 2}
          onChange={(v) => onVolume(menu.user.id, v)}
        />
      )}
    </div>
  );
}

// ============================================================
//  Le volume d'une personne
// ============================================================
// LE REPÈRE DES 100 % EST LE POINT IMPORTANT. Au-delà, on n'augmente plus un
// volume : on AMPLIFIE un signal, ce qui fait remonter le souffle et les
// craquements avec la voix. Le curseur le dit — la moitié haute de la piste est
// teintée, le pourcentage passe à l'accent — pour qu'on comprenne pourquoi la
// personne devient à la fois plus audible et plus sale.
//
// Un bouton « réinitialiser » plutôt que de viser le milieu du curseur au pixel
// près : c'est le geste qu'on fait juste après avoir trop poussé.
function VolumeRow({ value, max, onChange }) {
  return (
    <div className="call-vol">
      <span className="call-vol-head">
        {value === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <b className={value > 1 ? "boost" : ""}>{Math.round(value * 100)}%</b>
        {value !== 1 && (
          <button type="button" className="call-vol-reset clickable" onClick={() => onChange(1)}>
            réinitialiser
          </button>
        )}
      </span>
      <input
        className={`call-vol-slider ${value > 1 ? "boost" : ""}`}
        type="range"
        min="0"
        max={max}
        step="0.05"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Volume de cette personne"
      />
      <span className="call-vol-hint">
        {value > 1 ? "Amplifié — le souffle monte aussi." : "Glisse pour ajuster."}
      </span>
    </div>
  );
}
