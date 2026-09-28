import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Search, X, Loader2, Plus, Heart } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { cardRarityRank } from "../../lib/cards";
import TcgCard from "./TcgCard";

// ======================================================================
//  Proposer un échange : ses cartes contre les miennes
// ======================================================================
// En haut, les deux plateaux : « Tu donnes » (3 places) ⇄ « Tu reçois »
// (3 places). En dessous, de quoi les remplir : ses cartes — celles que je
// cherche d'abord — ou les miennes — mes doubles d'abord.
//
// Il sert aussi à RETOUCHER un échange (`replaces`) : une proposition reçue
// (« je préfère te donner ça contre ça ») ou la mienne. Les plateaux partent
// alors de l'échange en cours (`startGive` / `startWant`).

const MAX = 3;

function Slots({ cards, label, onRemove, side }) {
  return (
    <div className={`tc-side ${side}`}>
      <span className="tc-label">{label}</span>
      <div className="tc-slots">
        {Array.from({ length: MAX }, (_, i) => {
          const c = cards[i];
          return c ? (
            <button key={c.id} className="tc-slot full clickable" onClick={() => onRemove(c)} title="Retirer">
              <TcgCard card={c} lite tilt={false} />
              <span className="tc-x">
                <X />
              </span>
            </button>
          ) : (
            <span key={i} className="tc-slot" />
          );
        })}
      </div>
    </div>
  );
}

export default function TradeComposer({
  token,
  friend,
  theirCards,
  wants,
  initialWant,
  startGive = null,
  startWant = null,
  replaces = null,
  reply = false,
  onClose,
  onSent,
}) {
  useScrollLock(true);
  useBackClose(onClose, "trade");
  const [mine, setMine] = useState(null);
  const [give, setGive] = useState(() => startGive || []);
  const [want, setWant] = useState(() => startWant || (initialWant ? [initialWant] : []));
  const [tab, setTab] = useState(initialWant || replaces ? "mine" : "theirs");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    apiFetch("/cards", { token })
      .then((d) => alive && setMine(d.cards || []))
      .catch(() => alive && setMine([]));
    return () => {
      alive = false;
    };
  }, [token]);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const src = tab === "theirs" ? theirCards || [] : mine || [];
    const out = src.filter((c) => !needle || c.name.toLowerCase().includes(needle));
    // Chez lui : ce que je cherche d'abord. Chez moi : mes doubles d'abord.
    const key =
      tab === "theirs"
        ? (c) => (wants?.has(c.id) ? 0 : 1)
        : (c) => (c.count > 1 ? 0 : 1);
    return out.sort((a, b) => key(a) - key(b) || cardRarityRank(b.rarity) - cardRarityRank(a.rarity) || a.no - b.no).slice(0, 120);
  }, [tab, theirCards, mine, q, wants]);

  const picked = new Set((tab === "theirs" ? want : give).map((c) => c.id));
  function pick(c) {
    const set = tab === "theirs" ? setWant : setGive;
    set((cur) => (cur.some((x) => x.id === c.id) ? cur.filter((x) => x.id !== c.id) : cur.length >= MAX ? cur : [...cur, c]));
  }

  async function send() {
    setBusy(true);
    setErr("");
    try {
      const t = await apiFetch("/cards/trades", {
        method: "POST",
        token,
        body: { to: friend.username, give: give.map((c) => c.id), want: want.map((c) => c.id), replaces },
      });
      onSent(t);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-sheet wide tc">
        <header className="bd-sheet-head">
          <h3>
            {reply ? "Contre-proposition à" : replaces ? "Modifier l'échange avec" : "Échange avec"}{" "}
            <span className="tc-friend">{friend.username}</span>
          </h3>
          <button className="bd-x clickable" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>

        <div className="tc-board">
          <Slots cards={give} label="Tu donnes" side="give" onRemove={(c) => setGive((g) => g.filter((x) => x.id !== c.id))} />
          <span className="tc-swap" aria-hidden="true">
            <ArrowLeftRight />
          </span>
          <Slots cards={want} label="Tu reçois" side="want" onRemove={(c) => setWant((w) => w.filter((x) => x.id !== c.id))} />
        </div>

        <div className="tc-tools">
          <div className="tc-tabs" role="tablist">
            <button className={`bd-tab clickable ${tab === "theirs" ? "on" : ""}`} onClick={() => setTab("theirs")} role="tab">
              <span className="bd-tab-name">Ses cartes</span>
              <small>{want.length}/{MAX}</small>
            </button>
            <button className={`bd-tab clickable ${tab === "mine" ? "on" : ""}`} onClick={() => setTab("mine")} role="tab">
              <span className="bd-tab-name">Tes cartes</span>
              <small>{give.length}/{MAX}</small>
            </button>
          </div>
          <label className="bd-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher" />
          </label>
        </div>

        <div className="bd-found tc-list">
          {(tab === "mine" ? mine : theirCards) === null ? (
            <p className="bd-none">
              <Loader2 size={16} className="spin" />
            </p>
          ) : list.length === 0 ? (
            <p className="bd-none">Aucune carte.</p>
          ) : (
            list.map((c) => {
              const on = picked.has(c.id);
              const wanted = tab === "theirs" && wants?.has(c.id);
              return (
                <button key={c.id} className={`bd-found-cell clickable ${on ? "on" : ""}`} onClick={() => pick(c)}>
                  <TcgCard card={c} lite tilt={false} />
                  <span className="bd-found-mark">{on ? <X /> : <Plus />}</span>
                  {wanted && (
                    <span className="bd-found-tag want">
                      <Heart />
                      Je cherche
                    </span>
                  )}
                  {tab === "mine" && c.count > 1 && <span className="bd-found-tag">×{c.count}</span>}
                </button>
              );
            })
          )}
        </div>

        {err && <p className="bd-err">{err}</p>}
        <footer className="bd-sheet-foot">
          <button className="bd-btn ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="bd-btn gold clickable" onClick={send} disabled={busy || !give.length || !want.length || theirCards === null}>
            {busy ? <Loader2 size={16} className="spin" /> : <ArrowLeftRight size={16} />}
            {replaces ? "Envoyer" : "Proposer l'échange"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
