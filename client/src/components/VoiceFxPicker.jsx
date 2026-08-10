import { Bird, Bot, Ghost, Megaphone, Mic, Sparkles } from "lucide-react";
import { VOICE_EFFECTS } from "../lib/voiceFx";

// ======================================================================
//  Choisir l'effet de voix d'un son du Perroquet
// ======================================================================
// Une case à cocher au dépôt d'un son, et à la révélation la voix du joueur
// ressort en robot, en canard ou en monstre (cf. lib/clipFx.js). C'est le même
// jeu d'effets que les messages vocaux (lib/voiceFx.js) : une seule liste, un
// seul rendu à maintenir, et des noms que les joueurs reconnaissent d'un écran
// à l'autre.
//
// Le choix se fait AU SON, pas au joueur : c'est une propriété du son à imiter
// (« Wall-E » veut du robot), donc tout le monde s'entend pareil sur la même
// manche — et en versus la comparaison des six imitations reste juste.

const ICONS = { mic: Mic, bird: Bird, ghost: Ghost, bot: Bot, mega: Megaphone };

export function FxIcon({ id, size = 14 }) {
  const Ico = ICONS[id] || Sparkles;
  return <Ico size={size} />;
}

export const fxOf = (id) =>
  VOICE_EFFECTS.find((e) => e.id === (id || "none")) || VOICE_EFFECTS[0];

// L'étiquette montrée à la révélation, à côté du bouton « Toi ». Sans elle, on
// s'entend déformé sans comprendre pourquoi — et le premier réflexe est de
// croire que le micro a un problème, pas que c'est la blague.
export function FxTag({ id, children }) {
  if (!id || id === "none") return null;
  const fx = fxOf(id);
  return (
    <span className={`pq-fx-tag fx-${fx.id}`} title={fx.hint}>
      <FxIcon id={fx.icon} size={12} />
      {children || `voix de ${fx.label.toLowerCase()}`}
    </span>
  );
}

/**
 * La rangée de choix. `compact` réduit à des icônes (le libellé n'apparaît que
 * sur celle qui est active) : dans une liste d'extraits en attente, quatre
 * libellés par ligne noieraient le nom du son, qui est ce qui compte.
 */
export default function VoiceFxPicker({ value, onChange, compact = false, label = true }) {
  const cur = value || "none";
  return (
    <div className={`pq-fx-row ${compact ? "compact" : ""}`}>
      {label && (
        <span className="pq-fx-label">
          <Sparkles size={12} /> Effet à la révélation
        </span>
      )}
      <span className="pq-fx-opts">
        {VOICE_EFFECTS.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`pq-fx-btn clickable fx-${e.id} ${cur === e.id ? "on" : ""}`}
            onClick={() => onChange(e.id)}
            title={`${e.label} — ${e.hint}`}
            aria-pressed={cur === e.id}
          >
            <FxIcon id={e.icon} size={15} />
            {(!compact || cur === e.id) && <em>{e.label}</em>}
          </button>
        ))}
      </span>
    </div>
  );
}
