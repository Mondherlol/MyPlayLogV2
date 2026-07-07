import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Check, Loader2, ListPlus } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { typeMeta } from "../lib/lists";
import CreateListModal from "./CreateListModal";

// Modale « Ajouter à une liste » (quick-add depuis l'Explorer / une card).
// Montre les listes de JEUX de l'utilisateur, permet d'ajouter/retirer le jeu,
// et de créer une liste à la volée qui contiendra directement le jeu.
export default function AddToListModal({ game, onClose }) {
  const { token } = useAuth();
  const refId = String(game.id);
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // id de liste en cours de bascule
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/lists/mine/for-item?refId=${refId}&kind=game`, { token })
      .then((d) => alive && setLists(d.lists || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refId, token]);

  const itemBody = {
    kind: "game",
    refId,
    gameId: game.id,
    name: game.name,
    image: game.cover || null,
  };

  async function toggle(list) {
    if (busy) return;
    setBusy(list.id);
    const willAdd = !list.contains;
    // Optimiste
    setLists((prev) =>
      prev.map((l) =>
        l.id === list.id
          ? {
              ...l,
              contains: willAdd,
              itemCount: l.itemCount + (willAdd ? 1 : -1),
            }
          : l
      )
    );
    try {
      if (willAdd) {
        await apiFetch(`/lists/${list.id}/items`, {
          method: "POST",
          token,
          body: itemBody,
        });
      } else {
        await apiFetch(`/lists/${list.id}/items/${refId}`, {
          method: "DELETE",
          token,
        });
      }
    } catch (e) {
      // Rollback
      setLists((prev) =>
        prev.map((l) =>
          l.id === list.id
            ? {
                ...l,
                contains: !willAdd,
                itemCount: l.itemCount + (willAdd ? -1 : 1),
              }
            : l
        )
      );
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Nouvelle liste créée : on y ajoute le jeu, puis on l'affiche en tête.
  async function onCreated(list) {
    setCreating(false);
    // Une liste de personnages n'accepte pas un jeu : l'ajout échoue alors.
    let added = false;
    try {
      const d = await apiFetch(`/lists/${list.id}/items`, {
        method: "POST",
        token,
        body: itemBody,
      });
      added = !!d.added;
    } catch (e) {
      setError(e.message);
    }
    setLists((prev) => [
      {
        id: list.id,
        title: list.title,
        cover: list.cover || null,
        type: list.type,
        itemKind: list.itemKind || "game",
        visibility: list.visibility,
        itemCount: added ? 1 : 0,
        preview: added && game.cover ? [game.cover] : [],
        contains: added,
      },
      ...prev.filter((l) => l.id !== list.id),
    ]);
  }

  return createPortal(
    <>
      <div
        className="modal-overlay"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal addtolist-modal">
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>

          <h2 className="modal-title">
            <ListPlus size={20} /> Ajouter à une liste
          </h2>
          <p className="atl-game">{game.name}</p>

          <button className="atl-create clickable" onClick={() => setCreating(true)}>
            <Plus size={16} /> Créer une nouvelle liste
          </button>

          {error && <div className="alert alert-error">{error}</div>}

          {loading ? (
            <div className="atl-loading">
              <Loader2 size={20} className="spin" /> Chargement…
            </div>
          ) : lists.length === 0 ? (
            <p className="atl-empty font-fun">
              Tu n'as pas encore de liste de jeux. Crées-en une !
            </p>
          ) : (
            <div className="atl-list">
              {lists.map((l) => {
                const meta = typeMeta(l.type);
                return (
                  <button
                    key={l.id}
                    className={`atl-row clickable ${l.contains ? "on" : ""}`}
                    onClick={() => toggle(l)}
                    disabled={busy === l.id}
                  >
                    <span className="atl-thumb">
                      {l.cover ? (
                        <img src={l.cover} alt="" draggable="false" />
                      ) : l.preview?.[0] ? (
                        <img src={l.preview[0]} alt="" draggable="false" />
                      ) : (
                        <meta.Icon size={18} />
                      )}
                    </span>
                    <span className="atl-info">
                      <span className="atl-title">{l.title}</span>
                      <span className="atl-meta">
                        <meta.Icon size={12} /> {meta.label} · {l.itemCount} élément
                        {l.itemCount > 1 ? "s" : ""}
                      </span>
                    </span>
                    <span className="atl-toggle">
                      {busy === l.id ? (
                        <Loader2 size={16} className="spin" />
                      ) : l.contains ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateListModal onClose={() => setCreating(false)} onCreated={onCreated} />
      )}
    </>,
    document.body
  );
}
