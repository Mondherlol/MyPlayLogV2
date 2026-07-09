import { useRef, useState } from "react";
import { Plus, X, Check, Bookmark, ListPlus, Gamepad } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { apiFetch } from "../lib/api";
import PlayedModal from "./PlayedModal";
import AddToListModal from "./AddToListModal";

const PLAYED = ["playing", "finished", "paused", "dropped", "endless"];

// Bouton radial « + » d'ajout rapide (repris de GameCard), réutilisable sur les
// vignettes. `hoverOnly` : le « + » n'apparaît qu'au survol de la vignette.
export default function GameAddFan({ game, hoverOnly = false }) {
  const { token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  const entry = map[game.id];

  const [fanOpen, setFanOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showListModal, setShowListModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const fanRef = useRef(null);
  useClickOutside(fanRef, () => setFanOpen(false), fanOpen);

  const inLibrary = !!entry;
  const isWishlist = entry?.status === "wishlist";
  const isPlayed = entry && PLAYED.includes(entry.status);

  async function toggleWishlist(e) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (isWishlist) {
        await apiFetch(`/library/${game.id}`, { method: "DELETE", token });
        removeLocal(game.id);
      } else {
        await apiFetch(`/library/${game.id}`, {
          method: "PUT",
          token,
          body: { status: "wishlist", name: game.name, cover: game.cover },
        });
        upsertLocal(game.id, { status: "wishlist" });
      }
      setFanOpen(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={`add-fan ${hoverOnly ? "hover-only" : ""} ${fanOpen ? "open" : ""}`}
        ref={fanRef}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="fan-btn b1"
          title="Ajouter à une liste"
          onClick={(e) => {
            e.stopPropagation();
            setShowListModal(true);
            setFanOpen(false);
          }}
        >
          <ListPlus size={19} />
        </button>
        <button
          className={`fan-btn b2 ${isPlayed ? "active" : ""}`}
          title="J'y ai joué"
          onClick={(e) => {
            e.stopPropagation();
            setShowModal(true);
            setFanOpen(false);
          }}
        >
          <Gamepad size={19} />
        </button>
        <button
          className={`fan-btn b3 ${isWishlist ? "active" : ""}`}
          title="Je veux y jouer"
          onClick={toggleWishlist}
        >
          <Bookmark size={19} fill={isWishlist ? "currentColor" : "none"} />
        </button>

        <button
          className={`game-add ${inLibrary ? "added" : ""} ${fanOpen ? "open" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setFanOpen((v) => !v);
          }}
          title="Ajouter"
          aria-label="Ajouter le jeu"
        >
          {fanOpen ? <X size={20} /> : inLibrary ? <Check size={20} /> : <Plus size={20} />}
        </button>
      </div>

      {showModal && <PlayedModal game={game} onClose={() => setShowModal(false)} />}
      {showListModal && (
        <AddToListModal game={game} onClose={() => setShowListModal(false)} />
      )}
    </>
  );
}
