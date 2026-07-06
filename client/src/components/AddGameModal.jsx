import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Loader2, Check, Plus, Gamepad2, Star } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";

// Ajouter des jeux à sa bibliothèque en cherchant dans TOUT le catalogue IGDB.
//  - mode "status"   : range le jeu dans un statut (en cours, terminé, …)
//  - mode "favorite" : bascule le coup de cœur
export default function AddGameModal({ mode = "status", status, title, onClose }) {
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  const [q, setQ] = useState("");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const term = q.trim();
    const id = ++reqRef.current;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: 30, sort: "popularity" });
      if (term) params.set("search", term);
      apiFetch(`/games?${params}`, { token })
        .then((d) => id === reqRef.current && setGames(d.games || []))
        .catch(() => id === reqRef.current && setGames([]))
        .finally(() => id === reqRef.current && setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, token]);

  function isActive(g) {
    const entry = map[g.id];
    return mode === "favorite" ? !!entry?.favorite : entry?.status === status;
  }

  async function onPick(g) {
    if (busyId) return;
    setBusyId(g.id);
    const entry = map[g.id];
    const exists = !!entry;
    try {
      if (mode === "favorite") {
        const next = !entry?.favorite;
        upsertLocal(g.id, { favorite: next, status: entry?.status || "wishlist" });
        const body = { favorite: next };
        if (!exists) {
          body.name = g.name;
          body.cover = g.cover;
          body.status = "wishlist";
        }
        await apiFetch(`/library/${g.id}`, { method: "PUT", token, body });
      } else if (entry?.status === status) {
        // déjà dans ce statut → on le retire de la bibliothèque
        await apiFetch(`/library/${g.id}`, { method: "DELETE", token });
        removeLocal(g.id);
      } else {
        upsertLocal(g.id, { status });
        const body = { status };
        if (!exists) {
          body.name = g.name;
          body.cover = g.cover;
        }
        await apiFetch(`/library/${g.id}`, { method: "PUT", token, body });
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          {mode === "favorite" ? <Star size={20} /> : <Plus size={20} />} {title}
        </h2>

        <div className="additems-search">
          <Search size={18} />
          <input
            autoFocus
            placeholder="Rechercher un jeu dans tout le catalogue…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {loading && <Loader2 size={16} className="spin" />}
        </div>

        <div className="additems-grid">
          {games.map((g) => {
            const active = isActive(g);
            return (
              <button
                key={g.id}
                className={`pick-card clickable ${active ? "added" : ""}`}
                onClick={() => onPick(g)}
                disabled={busyId === g.id}
                title={g.name}
              >
                <div className="pick-cover">
                  {g.cover ? (
                    <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
                  ) : (
                    <Gamepad2 size={24} />
                  )}
                  <span className={`pick-check ${mode === "favorite" && active ? "fav" : ""}`}>
                    {busyId === g.id ? (
                      <Loader2 size={15} className="spin" />
                    ) : active ? (
                      mode === "favorite" ? (
                        <Star size={15} fill="currentColor" strokeWidth={0} />
                      ) : (
                        <Check size={16} />
                      )
                    ) : (
                      <Plus size={16} />
                    )}
                  </span>
                </div>
                <span className="pick-name">{g.name}</span>
              </button>
            );
          })}
        </div>
        {!loading && games.length === 0 && (
          <p className="additems-hint font-fun">Aucun jeu trouvé.</p>
        )}

        <div className="additems-foot">
          <span className="additems-count">Clique sur un jeu pour l'ajouter/retirer</span>
          <button className="btn btn-primary" onClick={onClose}>
            <Check size={18} /> Terminé
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
