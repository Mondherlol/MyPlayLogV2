import { useState } from "react";
import { Search, ChevronDown } from "lucide-react";

// Interrupteur ET / OU (segmented, désactivé si < 2 sélections)
function AndOrToggle({ mode, onChange, disabled }) {
  return (
    <div className={`andor ${disabled ? "andor-disabled" : ""}`}>
      <button
        type="button"
        className={`andor-opt ${mode === "or" ? "active" : ""}`}
        onClick={() => onChange("or")}
        title="Au moins un (OU)"
      >
        OU
      </button>
      <button
        type="button"
        className={`andor-opt ${mode === "and" ? "active" : ""}`}
        onClick={() => onChange("and")}
        title="Tous à la fois (ET)"
      >
        ET
      </button>
    </div>
  );
}

export default function FilterSection({
  title,
  options,
  selected,
  mode,
  onToggleOption,
  onSetMode,
  searchable = true,
  noMode = false,
  defaultOpen = true,
  search = "",
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");

  // La recherche globale (dans "Filtres") prime sur la recherche locale
  const globalQuery = (search || "").trim();
  const effectiveQuery = globalQuery || query;

  const filtered = effectiveQuery
    ? options.filter((o) =>
        o.name.toLowerCase().includes(effectiveQuery.toLowerCase())
      )
    : options;

  // Recherche globale : on masque la section qui n'a aucun résultat
  if (globalQuery && filtered.length === 0) return null;

  const count = selected.length;
  const isOpen = open || !!globalQuery; // forcée ouverte en recherche globale
  const showSearch = !globalQuery && searchable && options.length > 8;
  const showToggle = !noMode && !globalQuery;

  return (
    <section className={`filter-section ${isOpen ? "" : "closed"}`}>
      <div className="filter-head">
        <button
          type="button"
          className="filter-title clickable"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={15} className="filter-caret" />
          {title}
          {count > 0 && <span className="filter-count">{count}</span>}
        </button>
      </div>

      {isOpen && (
        <div className="filter-body">
          {(showSearch || showToggle) && (
            <div className="filter-controls">
              {showSearch && (
                <div className="filter-search">
                  <Search size={14} />
                  <input
                    type="text"
                    placeholder="Filtrer…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              )}
              {showToggle && (
                <AndOrToggle
                  mode={mode}
                  onChange={onSetMode}
                  disabled={count < 2}
                />
              )}
            </div>
          )}
          <div className="filter-options">
            {filtered.map((o) => (
              <label key={o.id} className="filter-option clickable">
                <input
                  type="checkbox"
                  checked={selected.includes(o.id)}
                  onChange={() => onToggleOption(o.id)}
                />
                <span className="filter-check" />
                <span className="filter-label">{o.name}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="filter-empty">Aucun résultat</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
