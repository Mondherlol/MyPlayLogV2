// ======================================================================
//  « Ma console favorite » / « mon studio favori »
// ======================================================================
//
// La transposition de src/components/settings/TastePicker.jsx de l'application
// mobile, qui était la SEULE à savoir poser ces deux choix : le site affichait
// la console et le studio d'un profil sans jamais permettre de les choisir.
//
// ⚠️ ON PROPOSE AVANT DE FAIRE CHERCHER. La première page n'est pas un champ
// vide mais ce que la bibliothèque raconte déjà (GET /users/me/taste) : les
// consoles sur lesquelles on joue vraiment, les studios dont on a le plus de
// jeux. La recherche reste là pour le reste, dès deux lettres.
//
// Le choix s'enregistre DÈS LE CLIC (PUT /users/me) : on vient de désigner une
// tuile, il n'y a rien à se relire.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Code2, Gamepad2, Loader2, Search, Trash2, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const KINDS = {
  console: {
    title: "Ma console favorite",
    placeholder: "Chercher une console…",
    Icon: Gamepad2,
    field: "favoriteConsole",
    search: (q) => `/platforms/search?q=${encodeURIComponent(q)}`,
    read: (d) => d.platforms || [],
    suggest: (d) => d.platforms || [],
  },
  studio: {
    title: "Mon studio favori",
    placeholder: "Chercher un studio…",
    Icon: Code2,
    field: "favoriteStudio",
    search: (q) => `/companies/search?q=${encodeURIComponent(q)}`,
    read: (d) => d.companies || [],
    suggest: (d) => d.studios || [],
  },
};

// Une console et un studio peuvent porter le même nom, et IGDB renvoie parfois
// deux fois le même nom sous deux identifiants.
const keyOf = (item) => `${item.platformId ?? ""}|${item.name}`;

export default function TastePickerModal({ kind = "console", onClose }) {
  const { token, user, updateUser } = useAuth();
  const spec = KINDS[kind] || KINDS.console;
  const current = user?.[spec.field] || null;

  const [q, setQ] = useState("");
  const [suggested, setSuggested] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null); // le nom en cours d'enregistrement
  const [error, setError] = useState(null);
  const req = useRef(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    apiFetch("/users/me/taste", { token })
      .then((d) => alive && setSuggested(spec.suggest(d)))
      .catch(() => alive && setSuggested([]));
    return () => {
      alive = false;
    };
  }, [token, spec]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return undefined;
    }
    const id = ++req.current;
    setLoading(true);
    const timer = setTimeout(() => {
      apiFetch(spec.search(term), { token })
        .then((d) => id === req.current && setResults(spec.read(d)))
        .catch(() => id === req.current && setResults([]))
        .finally(() => id === req.current && setLoading(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [q, token, spec]);

  /**
   * Le choix part avec SON VISUEL. Une console trouvée par la recherche n'a
   * que son logo IGDB ; la vraie photo du boîtier — celle de la bannière — se
   * demande ici, pour ce seul nom (même geste que l'application).
   */
  async function choose(item) {
    setBusy(item?.name || "clear");
    setError(null);
    try {
      const picked = item ? { ...item } : null;
      if (picked && kind === "console" && !picked.image) {
        try {
          const d = await apiFetch("/platforms/images", {
            method: "POST",
            token,
            body: { names: [picked.name] },
          });
          picked.image = d.images?.[picked.name] || null;
        } catch {
          /* best-effort : le logo fera l'affaire */
        }
      }
      const { user: fresh } = await apiFetch("/users/me", {
        method: "PUT",
        token,
        body: { [spec.field]: picked },
      });
      updateUser(fresh);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  }

  const searching = q.trim().length >= 2;
  const list = searching ? results : suggested;

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal taste-modal" data-kind={kind} onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title taste-title">
          <spec.Icon size={20} /> {spec.title}
        </h2>

        <div className="taste-search">
          <Search size={16} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={spec.placeholder}
          />
          {loading && <Loader2 className="spin" size={16} />}
        </div>

        {current?.name && (
          <button
            className="taste-clear clickable"
            onClick={() => choose(null)}
            disabled={!!busy}
          >
            <Trash2 size={14} /> Retirer {current.name}
          </button>
        )}
        {error && <p className="taste-error">{error}</p>}

        {list === null ? (
          <div className="taste-empty">
            <Loader2 className="spin" size={22} />
          </div>
        ) : !list.length ? (
          <p className="taste-empty">{searching ? "Rien trouvé." : "Cherche par nom."}</p>
        ) : (
          <div className="taste-grid">
            {list.map((item) => {
              const on = current?.name === item.name;
              const visual = item.image || item.logo;
              return (
                <button
                  key={keyOf(item)}
                  className={`taste-item clickable ${on ? "is-on" : ""}`}
                  onClick={() => choose(item)}
                  disabled={!!busy}
                >
                  <span className="taste-visual">
                    {visual ? <img src={visual} alt="" loading="lazy" /> : <spec.Icon size={26} />}
                    {busy === item.name && (
                      <span className="taste-busy">
                        <Loader2 className="spin" size={18} />
                      </span>
                    )}
                  </span>
                  <span className="taste-name">{item.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
