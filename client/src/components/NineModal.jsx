import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Globe, Loader2, Lock, Search, X } from "lucide-react";

import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { NINE_CUSTOM, NINE_MAX, NINE_PREFIX, nineTheme, nineTitle } from "../lib/nines";

// ======================================================================
//  Choisir SES neuf jeux sur un thème
// ======================================================================
// Le pendant de l'écran du téléphone (myplaylog-mobile/src/app/nine.jsx).
// Tout tient dans une fenêtre : à gauche le thème et les neuf cases, qui se
// remplissent au fil des choix ; à droite sa bibliothèque, rangée par coups de
// cœur, notes, heures, et la recherche pour le reste. Neuf, pas un de plus —
// le dixième fait trembler la grille.

// Les rangements de sa bibliothèque, pour trouver ses neuf jeux sans rien
// taper : on pioche d'abord dans ce qu'on a aimé.
const SHELVES = [
  {
    key: "favorites",
    label: "Coups de cœur",
    pick: (e) => e.favorite,
    sort: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
  },
  { key: "rated", label: "Mieux notés", pick: (e) => e.rating != null, sort: (a, b) => b.rating - a.rating },
  {
    key: "played",
    label: "Plus joués",
    pick: (e) => (e.playtimeHours || 0) > 0,
    sort: (a, b) => (b.playtimeHours || 0) - (a.playtimeHours || 0),
  },
  {
    key: "recent",
    label: "Récents",
    pick: () => true,
    sort: (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  },
];

const asGame = (e) => ({
  id: Number(e.gameId ?? e.id),
  name: e.name,
  cover: e.cover || e.image || null,
});

export default function NineModal({ themeKey, library, onClose, onPublished }) {
  const { token } = useAuth();
  const custom = themeKey === NINE_CUSTOM;
  const { Icon, color } = nineTheme(themeKey);

  const [ending, setEnding] = useState("");
  const [picked, setPicked] = useState([]);
  const [priv, setPriv] = useState(false);
  const [shelfKey, setShelfKey] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // --- La recherche : au silence, deux lettres au moins -------------------
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      return undefined;
    }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      apiFetch(`/games?search=${encodeURIComponent(term)}&limit=30`, { token })
        .then((d) => alive && setResults((d.games || []).map(asGame)))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 320);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, token]);

  const shelves = useMemo(() => {
    const owned = (library || []).filter((e) => e.status !== "wishlist");
    return SHELVES.map((s) => ({
      ...s,
      games: owned.filter(s.pick).sort(s.sort).slice(0, 90).map(asGame),
    })).filter((s) => s.games.length);
  }, [library]);
  const shelf = shelves.find((s) => s.key === shelfKey) || shelves[0];
  const grid = results ?? shelf?.games ?? [];

  const toggle = (g) => {
    if (!g.id) return;
    const at = picked.findIndex((x) => x.id === g.id);
    if (at >= 0) {
      setPicked((p) => p.filter((x) => x.id !== g.id));
      return;
    }
    if (picked.length >= NINE_MAX) {
      setFull(false);
      requestAnimationFrame(() => setFull(true));
      return;
    }
    setPicked((p) => [...p, g]);
  };

  // Le message « 9 jeux, pas un de plus » s'efface tout seul.
  useEffect(() => {
    if (!full) return undefined;
    const t = setTimeout(() => setFull(false), 1800);
    return () => clearTimeout(t);
  }, [full]);

  const title = custom ? `${NINE_PREFIX} ${ending.trim()}`.trim() : nineTitle(themeKey);
  const missing = NINE_MAX - picked.length;
  const ready = missing === 0 && (!custom || ending.trim().length >= 3);

  async function publish() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/lists", {
        method: "POST",
        token,
        body: {
          title,
          nine: themeKey,
          type: "classic",
          itemKind: "game",
          visibility: priv ? "private" : "public",
          items: picked.map((g) => ({
            kind: "game",
            refId: String(g.id),
            gameId: g.id,
            name: g.name,
            image: g.cover || null,
          })),
        },
      });
      onPublished(res.list);
    } catch (e) {
      setError(e.message || "Impossible d'enregistrer la liste.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nine-modal" style={{ "--nc": color }}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        {/* --- À gauche : le thème, les neuf cases, publier -------------- */}
        <div className="nine-m-left">
          <div className="nine-m-hero">
            <span className="nine-m-mark" aria-hidden="true">
              9
              <span className="nine-m-badge">
                <Icon size={16} strokeWidth={2.4} />
              </span>
            </span>
            {custom ? (
              <div className="nine-m-custom">
                <span>{NINE_PREFIX}</span>
                <input
                  autoFocus
                  value={ending}
                  maxLength={90}
                  placeholder="qui m'ont appris l'anglais"
                  onChange={(e) => setEnding(e.target.value)}
                />
              </div>
            ) : (
              <h2 className="nine-m-title">{title}</h2>
            )}
          </div>

          <div className={`nine-m-slots ${full ? "shake" : ""}`}>
            {Array.from({ length: NINE_MAX }, (_, i) => {
              const g = picked[i];
              if (!g) {
                return (
                  <span key={`e${i}`} className={`nine-m-slot empty ${i === picked.length ? "next" : ""}`}>
                    {i + 1}
                  </span>
                );
              }
              return (
                <button
                  key={g.id}
                  type="button"
                  className="nine-m-slot filled clickable"
                  onClick={() => toggle(g)}
                  title={`Retirer ${g.name}`}
                >
                  {g.cover ? <img src={g.cover} alt={g.name} /> : <span className="nine-m-noart">{g.name}</span>}
                  <span className="nine-m-slot-x">
                    <X size={14} strokeWidth={3} />
                  </span>
                </button>
              );
            })}
          </div>

          <p className={`nine-m-hint ${full ? "warn" : ""}`}>
            {full
              ? "9 jeux, pas un de plus !"
              : picked.length
                ? "Clique une case pour la vider"
                : "Choisis tes 9 jeux"}
          </p>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="nine-m-actions">
            <button
              type="button"
              className={`nine-m-vis clickable ${priv ? "is-private" : ""}`}
              onClick={() => setPriv((v) => !v)}
              title={priv ? "Seul toi la vois" : "Tout le monde la voit"}
            >
              {priv ? <Lock size={15} /> : <Globe size={15} />}
              {priv ? "Privée" : "Publique"}
            </button>
            <button
              type="button"
              className="btn btn-primary nine-m-publish"
              disabled={!ready || saving}
              onClick={publish}
            >
              {saving ? (
                <Loader2 size={17} className="spin" />
              ) : missing > 0 ? (
                `Encore ${missing} jeu${missing > 1 ? "x" : ""}`
              ) : custom && ending.trim().length < 3 ? (
                "Termine la phrase"
              ) : (
                <>
                  <Check size={17} /> Publier mes 9
                </>
              )}
            </button>
          </div>
        </div>

        {/* --- À droite : sa bibliothèque, la recherche ------------------ */}
        <div className="nine-m-right">
          <div className="nine-m-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un jeu"
            />
            {searching && <Loader2 size={15} className="spin" />}
            {!!query && !searching && (
              <button type="button" className="clickable" onClick={() => setQuery("")} aria-label="Effacer">
                <X size={15} />
              </button>
            )}
          </div>

          {!results && shelves.length > 0 && (
            <div className="nine-m-shelves" role="tablist">
              {shelves.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={s.key === shelf?.key}
                  className={`nine-m-shelf clickable ${s.key === shelf?.key ? "on" : ""}`}
                  onClick={() => setShelfKey(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="nine-m-grid">
            {grid.map((g) => {
              const at = picked.findIndex((x) => x.id === g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`nine-m-game clickable ${at >= 0 ? "on" : ""}`}
                  onClick={() => toggle(g)}
                  title={g.name}
                >
                  {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : <span className="nine-m-noart">{g.name}</span>}
                  {at >= 0 && <span className="nine-m-pos">{at + 1}</span>}
                </button>
              );
            })}
            {!grid.length && (
              <p className="nine-m-empty">
                {results ? "Aucun jeu trouvé." : "Cherche tes jeux juste au-dessus."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
