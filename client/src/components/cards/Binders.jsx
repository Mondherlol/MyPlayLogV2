import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, LayoutGrid, Plus, Search, Check, X, Loader2, Lock } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { CARD_RARITIES, raritySymbol, cardCover } from "../../lib/cards";
import TcgCard from "./TcgCard";

// ======================================================================
//  Les classeurs perso : l'étagère, l'éditeur, l'ajout de cartes
// ======================================================================
// Des onglets fins au-dessus des cartes (Toutes, Favoris, mes classeurs) ;
// un classeur perso liste aussi les cartes qu'on n'a pas encore, en creux.

export const BINDER_COLORS = {
  gold: "#f2b70b",
  pink: "#ff5470",
  violet: "#a97cea",
  blue: "#4f8cff",
  teal: "#3dbba6",
  green: "#82c957",
  orange: "#f39a3d",
  grey: "#9aa3ad",
};
const colorOf = (k) => BINDER_COLORS[k] || BINDER_COLORS.gold;
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// Un onglet : une pastille de couleur (la tranche du classeur), le nom, le
// compte ; pour un classeur perso, une fine barre de progression dessous.
function BinderTab({ name, color, icon: Icon, owned, total, count, active, onClick }) {
  const pct = total ? owned / total : null;
  return (
    <button
      className={`bd-tab clickable ${active ? "on" : ""}`}
      style={{ "--bc": colorOf(color) }}
      onClick={onClick}
      role="tab"
      aria-selected={active}
    >
      {Icon ? <Icon className="bd-tab-ico" /> : <i className="bd-tab-dot" aria-hidden="true" />}
      <span className="bd-tab-name">{name}</span>
      <small>{pct != null ? `${fmt(owned)}/${fmt(total)}` : fmt(count)}</small>
      {pct != null && <i className="bd-tab-prog" style={{ "--p": pct }} aria-hidden="true" />}
    </button>
  );
}

/** Les onglets du classeur : Toutes, Favoris, mes classeurs, et « + ». */
export function BinderShelf({ view, onView, total, favs, binders, onCreate }) {
  return (
    <div className="bd-tabs" role="tablist">
      <BinderTab name="Toutes" icon={LayoutGrid} count={total} active={view === "all"} onClick={() => onView("all")} />
      <BinderTab name="Favoris" color="pink" icon={Heart} count={favs} active={view === "fav"} onClick={() => onView("fav")} />
      {binders.map((b) => (
        <BinderTab
          key={b.id}
          name={b.name}
          color={b.color}
          owned={b.owned}
          total={b.total}
          active={view === b.id}
          onClick={() => onView(b.id)}
        />
      ))}
      <button className="bd-tab bd-tab-new clickable" onClick={onCreate} title="Nouveau classeur">
        <Plus className="bd-tab-ico" />
        <span className="bd-tab-name">Classeur</span>
      </button>
    </div>
  );
}

/** Une carte du classeur qu'on n'a pas encore : en creux. */
export const MissingCell = memo(function MissingCell({ card }) {
  const meta = CARD_RARITIES[card.rarity] || CARD_RARITIES.common;
  return (
    <div className="cd-cell bd-missing" title={`${card.name} — à trouver`}>
      <span className="bd-miss-art" aria-hidden="true">
        <img src={cardCover(card.cover, "t_cover_big")} alt="" loading="lazy" draggable="false" />
      </span>
      <span className="bd-miss-lock" aria-hidden="true">
        <Lock />
      </span>
      <span className="bd-miss-foot">
        <span className="bd-miss-name">{card.name}</span>
        <span className="bd-miss-rar" style={{ color: meta.color }}>
          {raritySymbol(card.rarity)}
        </span>
      </span>
    </div>
  );
});

// --- les fenêtres ---------------------------------------------------------------
function Modal({ title, onClose, children, wide = false }) {
  useScrollLock(true);
  useBackClose(onClose, "binder");
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return createPortal(
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bd-sheet ${wide ? "wide" : ""}`}>
        <header className="bd-sheet-head">
          <h3>{title}</h3>
          <button className="bd-x clickable" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body
  );
}

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Créer (ou renommer / recolorer) un classeur. À la création, on peut le
 * remplir d'un coup avec une série : « Ace Attorney » → toutes ses cartes.
 */
export function BinderEditor({ token, binder = null, onClose, onSaved }) {
  const [name, setName] = useState(binder?.name || "");
  const [color, setColor] = useState(binder?.color || "gold");
  const [q, setQ] = useState("");
  const [series, setSeries] = useState(null);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dq = useDebounced(q);
  const nameRef = useRef(null);
  useEffect(() => nameRef.current?.focus(), []);

  useEffect(() => {
    if (binder || dq.trim().length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    apiFetch(`/cards/series?q=${encodeURIComponent(dq.trim())}`, { token })
      .then((d) => alive && setFound(d.series))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [dq, token, binder]);

  function choose(s) {
    if (series?.key === s.key) {
      setSeries(null);
      return;
    }
    setSeries(s);
    if (!name.trim() || name === series?.name) setName(s.name);
  }

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const res = binder
        ? await apiFetch(`/cards/binders/${binder.id}`, { method: "PATCH", token, body: { name, color } })
        : await apiFetch("/cards/binders", {
            method: "POST",
            token,
            body: { name, color, series: series?.key, seriesName: series?.name },
          });
      onSaved(res, { created: !binder, before: binder });
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={binder ? "Modifier le classeur" : "Nouveau classeur"} onClose={onClose}>
      <div className="bd-form">
        <div className="bd-fields">
          <input
            ref={nameRef}
            className="bd-input"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
            placeholder="Nom du classeur"
          />
          <div className="bd-colors" role="radiogroup" aria-label="Couleur">
            {Object.entries(BINDER_COLORS).map(([k, c]) => (
              <button
                key={k}
                className={`bd-color clickable ${color === k ? "on" : ""}`}
                style={{ "--c": c }}
                onClick={() => setColor(k)}
                role="radio"
                aria-checked={color === k}
                aria-label={k}
              />
            ))}
          </div>
        </div>
      </div>

      {!binder && (
        <div className="bd-series">
          <label className="bd-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Remplir avec une série (Ace Attorney, Zelda…)" />
          </label>
          {found && (
            <div className="bd-series-list">
              {found.length === 0 && <p className="bd-none">Aucune série avec des cartes.</p>}
              {found.map((s) => (
                <button
                  key={s.key}
                  className={`bd-series-row clickable ${series?.key === s.key ? "on" : ""}`}
                  onClick={() => choose(s)}
                >
                  <span className="bd-series-fan" aria-hidden="true">
                    {s.covers.map((c, i) => (
                      <img key={i} src={cardCover(c, "t_cover_small")} alt="" loading="lazy" draggable="false" />
                    ))}
                  </span>
                  <span className="bd-series-name">{s.name}</span>
                  <span className="bd-series-count">
                    <b>{s.owned}</b>/{s.total}
                  </span>
                  <span className="bd-series-check">{series?.key === s.key && <Check />}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {err && <p className="bd-err">{err}</p>}
      <footer className="bd-sheet-foot">
        <button className="bd-btn ghost clickable" onClick={onClose}>
          Annuler
        </button>
        <button className="bd-btn gold clickable" onClick={save} disabled={busy || !name.trim()}>
          {busy ? <Loader2 size={16} className="spin" /> : binder ? "Enregistrer" : series ? `Créer · ${series.total} cartes` : "Créer"}
        </button>
      </footer>
    </Modal>
  );
}

/**
 * Ajouter des cartes à un classeur : on cherche dans TOUT le set (celles qu'on
 * n'a pas encore deviennent des objectifs), un clic ajoute ou retire.
 */
export function BinderAddCards({ token, binder, onClose, onToggle }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(null);
  const dq = useDebounced(q);
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (dq.trim().length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    apiFetch(`/cards/find?q=${encodeURIComponent(dq.trim())}`, { token })
      .then((d) => alive && setFound(d.cards))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [dq, token]);
  const inside = new Set(binder.cards || []);

  async function toggle(c) {
    setBusy(c.id);
    try {
      await onToggle(c, !inside.has(c.id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Ajouter à « ${binder.name} »`} onClose={onClose} wide>
      <label className="bd-search">
        <Search size={16} />
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un jeu" />
      </label>
      <div className="bd-found">
        {found === null && <p className="bd-none">Tape le nom d'un jeu : toutes les cartes du set, même celles que tu n'as pas.</p>}
        {found?.length === 0 && <p className="bd-none">Aucune carte.</p>}
        {found?.map((c) => {
          const on = inside.has(c.id);
          return (
            <button key={c.id} className={`bd-found-cell clickable ${on ? "on" : ""} ${c.owned ? "" : "missing"}`} onClick={() => toggle(c)}>
              <TcgCard card={c} lite tilt={false} />
              <span className="bd-found-mark">{busy === c.id ? <Loader2 className="spin" /> : on ? <Check /> : <Plus />}</span>
              {!c.owned && <span className="bd-found-tag">À trouver</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
