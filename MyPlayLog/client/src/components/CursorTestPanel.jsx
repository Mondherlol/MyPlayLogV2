import { useEffect } from "react";
import { MousePointer2, Hand, Grab, Square, X } from "lucide-react";

// ======================================================================
//  Banc d'essai d'un curseur : une zone par rôle, à survoler.
// ======================================================================
// Un curseur ne se juge pas sur une vignette : il faut le voir bouger, et
// surtout vérifier CHAQUE état. Chaque zone ci-dessous déclenche la variable
// CSS d'un rôle — c'est la même cascade que dans le reste de l'app, donc ce
// qu'on voit ici est exactement ce que verront les joueurs.
export default function CursorTestPanel({ label, onStop }) {
  // Échap coupe le test, où qu'on ait le focus.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onStop();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStop]);

  return (
    <aside className="ctest" role="dialog" aria-label="Test du curseur">
      <div className="ctest-head">
        <MousePointer2 size={15} />
        <span className="ctest-title" title={label}>
          {label || "Test du curseur"}
        </span>
        <button
          type="button"
          className="ctest-close clickable"
          onClick={onStop}
          aria-label="Arrêter le test"
        >
          <X size={15} />
        </button>
      </div>
      <p className="ctest-sub">Promène la souris sur chaque zone.</p>

      <div className="ctest-zone normal">
        <MousePointer2 size={13} /> Normal
      </div>
      <button type="button" className="ctest-zone link clickable">
        <Hand size={13} /> Survol lien
      </button>
      <input className="ctest-zone text" placeholder="Champ de texte…" />
      <div className="ctest-zone grab">
        <Grab size={13} /> Saisir — maintiens pour glisser
      </div>

      <button type="button" className="ctest-stop clickable" onClick={onStop}>
        <Square size={13} /> Arrêter <kbd>Échap</kbd>
      </button>
    </aside>
  );
}
