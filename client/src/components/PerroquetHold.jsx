import { useEffect, useRef, useState } from "react";
import { Loader2, Mic } from "lucide-react";

// ======================================================================
//  Le bouton de maintien, avec sa forme d'onde en direct
// ======================================================================
// Partagé par le solo (pages/Perroquet.jsx) et le versus
// (pages/PerroquetVersus.jsx). Il ne connaît RIEN du jeu : il reçoit un niveau
// de micro et prévient quand on appuie et quand on relâche. Toute la logique
// (quand on a le droit d'enregistrer, où part le fichier) reste dans les pages.
//
// ------------------------------------------------------- pourquoi une onde
// Il y avait un simple anneau qui grossissait avec la voix. Il disait « ça
// capte » mais pas « ça capte QUOI » — or ce qu'on note ici est précisément une
// FORME (la montée, la retombée, les syllabes). Voir sa propre courbe se
// dessiner pendant qu'on crie, c'est voir ce sur quoi on va être jugé.
//
// Les barres défilent de droite à gauche, comme un sismographe : la dernière
// mesure entre par la droite. L'ordre compte — une onde symétrique qui grandit
// depuis le centre serait jolie et ne dirait rien du temps qui passe.

const BARS = 40;

export default function PerroquetHold({
  recording,
  level,
  busy,
  disabled,
  onStart,
  onEnd,
  hint,
  label,
}) {
  // L'historique des niveaux, gardé en ref : il change 60 fois par seconde et
  // n'a aucune raison de provoquer un rendu de plus que celui du niveau courant.
  const barsRef = useRef(new Array(BARS).fill(0));
  const [, force] = useState(0);

  useEffect(() => {
    if (!recording) {
      barsRef.current = new Array(BARS).fill(0);
      return;
    }
    barsRef.current = [...barsRef.current.slice(1), level];
    force((n) => n + 1);
  }, [level, recording]);

  return (
    <div className="pq-mic">
      <button
        type="button"
        className={`pq-hold clickable ${recording ? "on" : ""}`}
        disabled={disabled || busy}
        // `onPointerDown/Up` plutôt que souris et tactile séparés : un seul jeu
        // de gestionnaires couvre doigt, souris et stylet. `setPointerCapture`
        // garantit qu'on reçoit le relâchement même si le doigt a glissé hors du
        // bouton — sans quoi l'enregistrement ne s'arrêterait jamais.
        onPointerDown={(e) => {
          if (disabled || busy) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onStart();
        }}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
      >
        <span className="pq-hold-halo" aria-hidden="true" />

        {/* La forme d'onde. Masquée au repos : un rang de barres plates
            ressemblerait à un égaliseur en panne. */}
        {recording && (
          <span className="pq-wave" aria-hidden="true">
            {barsRef.current.map((v, i) => (
              <i key={i} style={{ height: `${Math.max(3, Math.min(100, v))}%` }} />
            ))}
          </span>
        )}

        {!recording && (
          <span className="pq-hold-ic">
            {busy ? <Loader2 size={30} className="spin" /> : <Mic size={30} />}
          </span>
        )}

        <em className="pq-hold-lbl">
          {busy ? "On écoute ça…" : recording ? label || "Vas-y !" : hint || "Maintiens et imite"}
        </em>
      </button>
    </div>
  );
}
