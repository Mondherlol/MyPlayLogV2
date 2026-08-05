import { useState } from "react";
import { createPortal } from "react-dom";
import { Star, User, Plus, Search, X, Pencil, Trash2 } from "lucide-react";
import { apiFetch } from "../lib/api";
import ScrollRow from "./ScrollRow";
import AddCharacterModal from "./AddCharacterModal";

// Rangée de personnages : recherche, ajout, et clic droit (modifier/retirer)
// sur ceux ajoutés par soi.
export default function CharacterPicker({
  gameId,
  token,
  characters,
  favChar,
  onSelect,
  onCharsChange,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(null); // { x, y, char }
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = query
    ? characters.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : characters;

  async function removeChar(c) {
    setMenu(null);
    onCharsChange(characters.filter((x) => x.id !== c.id));
    if (favChar?.name === c.name) onSelect(null);
    try {
      await apiFetch(`/games/${gameId}/character/${c.id}`, { method: "DELETE", token });
    } catch {
      /* best-effort */
    }
  }

  return (
    <>
      <div className="ost-head">
        <span className="field-label" style={{ margin: 0 }}>
          Personnage favori
        </span>
        <div className={`ost-search ${searchOpen ? "open" : ""}`}>
          <input
            className="ost-search-input"
            placeholder="Filtrer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="ost-search-btn clickable"
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery("");
            }}
            aria-label="Rechercher"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>
        </div>
      </div>

      <ScrollRow className="char-row">
        {filtered.map((c) => {
          const active = favChar?.name === c.name;
          return (
            <button
              key={c.id}
              className={`char-card clickable ${active ? "active" : ""}`}
              onClick={() =>
                onSelect(active ? null : { name: c.name, image: c.image })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                if (c.mine) setMenu({ x: e.clientX, y: e.clientY, char: c });
              }}
              title={c.mine ? `${c.name} (clic droit pour modifier)` : c.name}
            >
              <div className="char-card-img">
                {c.image ? (
                  <img src={c.image} alt={c.name} loading="lazy" />
                ) : (
                  <User size={24} />
                )}
              </div>
              <span className="char-card-name">{c.name}</span>
              {active && (
                <span className="char-card-star">
                  <Star size={13} fill="currentColor" strokeWidth={0} />
                </span>
              )}
              {c.mine && (
                <span className="char-card-mine" title="Ajouté par toi">
                  <Pencil size={10} />
                </span>
              )}
            </button>
          );
        })}
        <button
          className="char-card add clickable"
          onClick={() => setAdding(true)}
          title="Ajouter un personnage"
        >
          <div className="char-card-img add">
            <Plus size={22} />
          </div>
          <span className="char-card-name">Ajouter</span>
        </button>
      </ScrollRow>

      {menu &&
        createPortal(
          <>
            <div
              className="ctx-backdrop"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(null);
              }}
            />
            <div className="ctx-menu" style={{ top: menu.y, left: menu.x }}>
              <button
                className="ctx-item clickable"
                onClick={() => {
                  setEditing(menu.char);
                  setMenu(null);
                }}
              >
                <Pencil size={15} /> Modifier
              </button>
              <button
                className="ctx-item danger clickable"
                onClick={() => removeChar(menu.char)}
              >
                <Trash2 size={15} /> Retirer
              </button>
            </div>
          </>,
          document.body
        )}

      {adding && (
        <AddCharacterModal
          gameId={gameId}
          onClose={() => setAdding(false)}
          onAdded={(c) => onCharsChange([...characters, c])}
        />
      )}
      {editing && (
        <AddCharacterModal
          gameId={gameId}
          character={editing}
          onClose={() => setEditing(null)}
          onAdded={(c) => {
            onCharsChange(characters.map((x) => (x.id === c.id ? c : x)));
            if (favChar && favChar.name === editing.name)
              onSelect({ name: c.name, image: c.image });
          }}
        />
      )}
    </>
  );
}
