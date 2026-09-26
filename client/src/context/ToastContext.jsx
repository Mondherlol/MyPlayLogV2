import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Check, Gamepad2, Loader2, Undo2, X } from "lucide-react";
import { coverAtSize } from "../lib/gameCover";

const ToastContext = createContext({ show: () => {} });

// Durée d'affichage : assez pour avoir le temps de cliquer « Annuler » quand
// on s'est trompé de bouton, pas au point d'encombrer l'écran.
const DURATION = 5000;
// Au-delà, les plus anciens s'effacent : on ne veut pas une pile de toasts.
const MAX = 3;

let seq = 0;

// Toasts de confirmation, communs à tout le site.
//   show({ title, text, cover, undo })
// `undo` (optionnel) : fonction async appelée par le bouton « Annuler ».
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast) => {
    const id = ++seq;
    setToasts((list) => [...list, { ...toast, id }].slice(-MAX));
    return id;
  }, []);

  // Valeur stable : un toast qui apparaît ne doit pas re-rendre tout le site.
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="mpl-toasts" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDone={() => dismiss(t.id)} onReplace={show} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onDone, onReplace }) {
  const [state, setState] = useState("idle"); // idle | undoing
  const [paused, setPaused] = useState(false);
  // Temps restant, pour reprendre là où on en était après un survol.
  const left = useRef(DURATION);
  const started = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (paused || state === "undoing") return;
    started.current = Date.now();
    const t = setTimeout(() => doneRef.current(), left.current);
    return () => {
      clearTimeout(t);
      left.current -= Date.now() - started.current;
    };
  }, [paused, state]);

  async function undo() {
    if (state === "undoing") return;
    setState("undoing");
    try {
      await toast.undo();
      onDone();
      onReplace({ title: toast.title, cover: toast.cover, text: "Action annulée" });
    } catch (err) {
      onDone();
      onReplace({ title: toast.title, cover: toast.cover, text: err.message || "Impossible d'annuler", error: true });
    }
  }

  return (
    <div
      className={`mpl-toast ${toast.error ? "is-error" : ""}`}
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="mpl-toast-cover">
        {toast.cover ? (
          <img src={coverAtSize(toast.cover)} alt="" draggable="false" />
        ) : (
          <Gamepad2 size={18} />
        )}
        <span className="mpl-toast-check">
          {toast.error ? <X size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}
        </span>
      </span>

      <span className="mpl-toast-txt">
        {toast.title && <strong>{toast.title}</strong>}
        <span>{toast.text}</span>
      </span>

      {toast.undo && (
        <button className="mpl-toast-undo" onClick={undo} disabled={state === "undoing"}>
          {state === "undoing" ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Undo2 size={15} />
          )}
          Annuler
        </button>
      )}

      <button className="mpl-toast-close" onClick={onDone} aria-label="Fermer">
        <X size={15} />
      </button>

      <span
        className="mpl-toast-bar"
        style={{
          animationDuration: `${DURATION}ms`,
          animationPlayState: paused || state === "undoing" ? "paused" : "running",
        }}
      />
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
