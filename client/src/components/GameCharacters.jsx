import { useEffect, useState } from "react";
import {
  User,
  Plus,
  Search,
  X,
  Pencil,
  Trash2,
  Star,
  Loader2,
  Users,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import AddCharacterModal from "./AddCharacterModal";

// Onglet « Personnages » de la page jeu : galerie de tous les personnages
// (IGDB + communauté), avec ajout / modification / suppression des siens.
// Le personnage favori (défini via la modale « Joué ») est mis en avant.
export default function GameCharacters({ gameId, token, favoriteName }) {
  const [loading, setLoading] = useState(true);
  const [chars, setChars] = useState([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch(`/games/${gameId}/details`, { token })
      .then((d) => alive && setChars(d.characters || []))
      .catch(() => alive && setChars([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  const filtered = query
    ? chars.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : chars;
  const mineCount = chars.filter((c) => c.mine).length;

  async function removeChar(c) {
    if (!confirm(`Retirer « ${c.name} » ? Ce personnage disparaîtra pour tout le monde.`))
      return;
    setChars((list) => list.filter((x) => x.id !== c.id));
    try {
      await apiFetch(`/games/${gameId}/character/${c.id}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  if (loading) {
    return (
      <div className="gpc">
        <div className="gpc-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="gpc-card is-sk" key={i}>
              <div className="gpc-card-img" />
              <span className="gpc-sk-line" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="gpc">
      <div className="gpc-head">
        <span className="gpc-count">
          <Users size={15} />
          {chars.length} personnage{chars.length > 1 ? "s" : ""}
          {mineCount > 0 && <em className="gpc-count-mine">· {mineCount} ajouté{mineCount > 1 ? "s" : ""} par toi</em>}
        </span>
        <div className="gpc-tools">
          <div className="gpc-search">
            <Search size={15} className="gpc-search-icon" />
            <input
              className="gpc-search-input"
              placeholder="Rechercher un personnage…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="gpc-search-clear clickable"
                onClick={() => setQuery("")}
                aria-label="Effacer"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button className="gpc-add-btn clickable" onClick={() => setAdding(true)}>
            <Plus size={16} /> Ajouter
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="gpc-empty">
          <Users size={30} />
          <p className="font-fun">
            {query
              ? "Aucun personnage ne correspond à ta recherche."
              : "Aucun personnage pour ce jeu pour l'instant."}
          </p>
          {!query && (
            <button className="btn btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} /> Ajouter le premier
            </button>
          )}
        </div>
      ) : (
        <div className="gpc-grid">
          {filtered.map((c) => {
            const isFav = favoriteName && c.name === favoriteName;
            // Au survol : le nom + ses noms alternatifs (natif / traductions VNDB).
            const tip = c.altNames?.length
              ? `${c.name}\nAussi connu comme : ${c.altNames.join(" · ")}`
              : c.name;
            return (
              <div
                key={c.id}
                className={`gpc-card ${isFav ? "is-fav" : ""} ${c.mine ? "is-mine" : ""}`}
                title={tip}
              >
                <div className="gpc-card-img">
                  {c.image ? (
                    <img src={c.image} alt={c.name} loading="lazy" draggable="false" />
                  ) : (
                    <User size={30} />
                  )}

                  {isFav && (
                    <span className="gpc-fav-badge" title="Ton personnage favori">
                      <Star size={13} fill="currentColor" strokeWidth={0} />
                    </span>
                  )}

                  {c.mine && (
                    <div className="gpc-card-actions">
                      <button
                        className="gpc-act clickable"
                        onClick={() => setEditing(c)}
                        title="Modifier"
                        aria-label="Modifier"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="gpc-act danger clickable"
                        onClick={() => removeChar(c)}
                        title="Retirer"
                        aria-label="Retirer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                <span className="gpc-card-name">{c.name}</span>
                {c.mine && <span className="gpc-mine-tag">Ajouté par toi</span>}
              </div>
            );
          })}

          <button
            className="gpc-card gpc-add-card clickable"
            onClick={() => setAdding(true)}
            title="Ajouter un personnage"
          >
            <div className="gpc-card-img gpc-add-tile">
              <Plus size={26} />
            </div>
            <span className="gpc-card-name">Ajouter</span>
          </button>
        </div>
      )}

      {adding && (
        <AddCharacterModal
          gameId={gameId}
          onClose={() => setAdding(false)}
          onAdded={(c) => setChars((list) => [c, ...list])}
        />
      )}
      {editing && (
        <AddCharacterModal
          gameId={gameId}
          character={editing}
          onClose={() => setEditing(null)}
          onAdded={(c) =>
            setChars((list) => list.map((x) => (x.id === c.id ? c : x)))
          }
        />
      )}
    </div>
  );
}
