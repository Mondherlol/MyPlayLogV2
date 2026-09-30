import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Anvil, Check, Coins, Loader2, Lock, Minus, Recycle, Search, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { CARD_RARITIES, CARD_RARITY_ORDER, cardCover, cardRarityRank, raritySymbol } from "../../lib/cards";
import { playBattleChips, playBattleShatter, playCardCharge, playCardReveal } from "../../lib/sfx";
import Burst from "../Burst";
import TcgCard from "./TcgCard";

// ======================================================================
//  L'atelier : recycler des cartes contre des points, forger celle qu'on veut
// ======================================================================
// Deux onglets. RECYCLER : on touche les cartes à fondre (une touche = un
// exemplaire), « Doubles » les prend toutes d'un coup ; les favoris n'y
// sont pas, les cartes en échange (ou reçues il y a peu) sont verrouillées.
// FORGER : on cherche une carte qu'on n'a pas, et on la forge.
// Chaque geste a sa scène : les cartes éclatent en pièces qui filent au
// compteur ; à la forge, les pièces convergent et la carte apparaît.
// Les règles (barèmes, verrous) sont côté serveur (lib/cardRecycle.js).

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

export function Points({ n, className = "" }) {
  return (
    <span className={`ws-points ${className}`}>
      <Coins />
      <b>{fmt(n)}</b>
    </span>
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

// --- recycler ---------------------------------------------------------------------
function RecycleTab({ cards, info, pick, setPick }) {
  const [rarity, setRarity] = useState(null);
  const locks = info?.locks || {};
  const rates = info?.recycle || {};
  // Les doubles d'abord, puis de la moins rare à la plus rare.
  const list = useMemo(
    () =>
      cards
        .filter((c) => !c.fav && (!rarity || c.rarity === rarity))
        .sort(
          (a, b) =>
            Number(b.count > 1) - Number(a.count > 1) ||
            cardRarityRank(a.rarity) - cardRarityRank(b.rarity) ||
            a.no - b.no
        ),
    [cards, rarity]
  );
  const doubles = useMemo(() => cards.filter((c) => !c.fav && c.count > 1 && !locks[c.id]), [cards, locks]);
  const allDoubles = doubles.length > 0 && doubles.every((c) => (pick.get(c.id) || 0) >= c.count - 1);
  const favs = cards.filter((c) => c.fav).length;

  const add = (c, d) =>
    setPick((m) => {
      const next = new Map(m);
      const v = Math.max(0, Math.min(c.count, (next.get(c.id) || 0) + d));
      if (v) next.set(c.id, v);
      else next.delete(c.id);
      return next;
    });
  function toggleDoubles() {
    setPick((m) => {
      const next = new Map(m);
      for (const c of doubles) {
        if (allDoubles) next.delete(c.id);
        else next.set(c.id, Math.max(next.get(c.id) || 0, c.count - 1));
      }
      return next;
    });
  }

  return (
    <>
      <div className="ws-tools">
        <button className={`ws-chip clickable ${allDoubles ? "on" : ""}`} onClick={toggleDoubles} disabled={!doubles.length}>
          {allDoubles ? <Check /> : <Recycle />}
          Doubles
          <b>{doubles.reduce((a, c) => a + c.count - 1, 0)}</b>
        </button>
        <span className="ws-rars">
          {CARD_RARITY_ORDER.map((r) => (
            <button
              key={r}
              className={`ws-rar clickable ${rarity === r ? "on" : ""}`}
              style={{ "--rc": CARD_RARITIES[r].color }}
              onClick={() => setRarity((v) => (v === r ? null : r))}
              title={`${CARD_RARITIES[r].label} · ${rates[r] ?? "?"} points`}
            >
              {raritySymbol(r)}
            </button>
          ))}
        </span>
      </div>
      <div className="ws-grid">
        {list.length === 0 && <p className="bd-none">{favs ? "Tes favoris ne se recyclent pas." : "Rien à recycler."}</p>}
        {list.map((c) => {
          const n = pick.get(c.id) || 0;
          const lock = locks[c.id];
          const last = n >= c.count;
          return (
            <div
              key={c.id}
              className={`ws-cell ${n ? "on" : ""} ${lock ? "locked" : ""} ${last ? "last" : ""}`}
              style={{ "--rc": CARD_RARITIES[c.rarity]?.color }}
              title={lock ? (lock.why === "trade" ? "Dans un échange en cours" : "Reçue par échange il y a moins de 7 jours") : c.name}
            >
              <button className="ws-cell-art clickable" onClick={() => !lock && add(c, 1)} disabled={!!lock}>
                <img src={cardCover(c.cover, "t_cover_big")} alt="" loading="lazy" draggable="false" />
                <span className="ws-cell-val">
                  +{rates[c.rarity] ?? "?"}
                </span>
                {c.count > 1 && <span className="ws-cell-count">×{c.count}</span>}
                {lock && (
                  <span className="ws-cell-lock">
                    <Lock />
                  </span>
                )}
                {n > 0 && <span className="ws-cell-n">{last ? "Toutes" : `−${n}`}</span>}
              </button>
              {n > 0 && (
                <button className="ws-cell-minus clickable" onClick={() => add(c, -1)} aria-label="Un de moins">
                  <Minus />
                </button>
              )}
              <span className="ws-cell-name">{c.name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// --- forger ------------------------------------------------------------------------
function ForgeTab({ token, info, points, onChoose }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const dq = useDebounced(q.trim());
  useEffect(() => {
    if (dq.length < 2) {
      setFound(null);
      return undefined;
    }
    let alive = true;
    apiFetch(`/cards/find?q=${encodeURIComponent(dq)}`, { token })
      .then((d) => alive && setFound(d.cards.filter((c) => !c.owned)))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [dq, token]);
  const cost = info?.forge || {};
  return (
    <>
      <label className="bd-search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Une carte qui te manque" autoFocus />
      </label>
      <div className="ws-list">
        {found === null ? (
          <div className="ws-costs">
            {CARD_RARITY_ORDER.map((r) => (
              <span key={r} className="ws-cost-row" style={{ "--rc": CARD_RARITIES[r].color }}>
                <i>{raritySymbol(r)}</i>
                {cost[r] ? <Points n={cost[r]} className={points >= cost[r] ? "ok" : ""} /> : <Lock className="ws-no" />}
              </span>
            ))}
          </div>
        ) : found.length === 0 ? (
          <p className="bd-none">Aucune carte à forger sous ce nom.</p>
        ) : (
          found.map((c) => {
            const price = cost[c.rarity];
            return (
              <button key={c.id} className="ws-row clickable" onClick={() => onChoose(c)} disabled={!price}>
                <img src={cardCover(c.cover, "t_cover_small")} alt="" loading="lazy" draggable="false" />
                <span className="ws-row-name">{c.name}</span>
                <i className="ws-row-rar" style={{ color: CARD_RARITIES[c.rarity]?.color }}>
                  {raritySymbol(c.rarity)}
                </i>
                {price ? <Points n={price} className={points >= price ? "ok" : "short"} /> : <Lock className="ws-no" />}
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function ForgeConfirm({ card, cost, loading, points, busy, err, onForge, onBack }) {
  const enough = cost != null && points >= cost;
  return (
    <div className="ws-confirm">
      <div className="ws-confirm-card">
        <TcgCard card={card} eager tilt />
      </div>
      <div className="ws-confirm-side">
        <b className="ws-confirm-name">{card.name}</b>
        <span className="ws-confirm-rar" style={{ color: CARD_RARITIES[card.rarity]?.color }}>
          {raritySymbol(card.rarity)} {CARD_RARITIES[card.rarity]?.label}
        </span>
        {loading ? (
          <Loader2 size={18} className="spin" />
        ) : cost == null ? (
          <p className="bd-err">Les cartes mythiques ne se forgent pas.</p>
        ) : (
          <div className="ws-confirm-cost">
            <Points n={cost} />
            <span className={`ws-confirm-after ${enough ? "" : "short"}`}>
              {enough ? <>reste {fmt(points - cost)}</> : <>il en manque {fmt(cost - points)}</>}
            </span>
          </div>
        )}
        {err && <p className="bd-err">{err}</p>}
        <div className="ws-confirm-actions">
          {onBack && (
            <button className="bd-btn ghost clickable" onClick={onBack}>
              Retour
            </button>
          )}
          <button className="bd-btn gold clickable" onClick={onForge} disabled={!enough || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Anvil size={17} />}
            Forger
          </button>
        </div>
      </div>
    </div>
  );
}

// --- les scènes ----------------------------------------------------------------------
// Recycler : les cartes éclatent l'une après l'autre, leurs pièces filent au
// compteur, qui monte.
// Une scène ne se referme qu'une fois (le bouton ET le fond sont cliquables).
function useOnce(fn) {
  const done = useRef(false);
  return (e) => {
    e?.stopPropagation?.();
    if (done.current) return;
    done.current = true;
    fn();
  };
}

function RecycleScene({ cards, gained, total, onDone: done0 }) {
  const onDone = useOnce(done0);
  const shown = cards.slice(0, 10);
  const [broken, setBroken] = useState(0);
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const counterRef = useRef(null);
  const cellRefs = useRef([]);
  const [flights, setFlights] = useState([]);

  useEffect(() => {
    const timers = [];
    const step = Math.max(110, Math.min(260, 1500 / shown.length));
    shown.forEach((_, i) =>
      timers.push(
        setTimeout(() => {
          setBroken(i + 1);
          if (i < 4 || i % 3 === 0) playBattleShatter();
          // Les pièces de cette carte partent vers le compteur.
          const a = cellRefs.current[i]?.getBoundingClientRect();
          const b = counterRef.current?.getBoundingClientRect();
          if (a && b) {
            const parts = Array.from({ length: 7 }, (_, k) => ({
              id: `${i}-${k}`,
              x: a.left + a.width / 2 + (Math.random() - 0.5) * a.width * 0.6,
              y: a.top + a.height / 2 + (Math.random() - 0.5) * a.height * 0.5,
              tx: b.left + b.width / 2,
              ty: b.top + b.height / 2,
              d: 120 + Math.random() * 260,
            }));
            setFlights((f) => [...f, ...parts]);
          }
        }, 450 + i * step)
      )
    );
    const end = 450 + shown.length * step + 500;
    timers.push(
      setTimeout(() => {
        playBattleChips();
        const t0 = performance.now();
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / 700);
          setCount(Math.round(gained * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(tick);
          else setDone(true);
        };
        requestAnimationFrame(tick);
      }, end)
    );
    return () => timers.forEach(clearTimeout);
    // Une scène par recyclage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className={`ws-scene recycle ${done ? "done" : ""}`} onClick={done ? onDone : undefined}>
      <div className="ws-counter" ref={counterRef}>
        <Coins />
        <b>+{fmt(count)}</b>
      </div>
      <div className="ws-pile">
        {shown.map((c, i) => (
          <span
            key={`${c.id}-${i}`}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            className={`ws-piece ${i < broken ? "broken" : ""}`}
            style={{ "--i": i, "--n": shown.length, "--rc": CARD_RARITIES[c.rarity]?.color }}
          >
            <img src={cardCover(c.cover, "t_cover_big")} alt="" draggable="false" />
          </span>
        ))}
        {cards.length > shown.length && <span className="ws-more">+{cards.length - shown.length}</span>}
      </div>
      {flights.map((p) => (
        <i
          key={p.id}
          className="ws-flight"
          style={{ left: p.x, top: p.y, "--tx": `${p.tx - p.x}px`, "--ty": `${p.ty - p.y}px`, animationDelay: `${p.d}ms` }}
        />
      ))}
      {done && (
        <div className="ws-scene-foot">
          <Points n={total} />
          <button className="bd-btn gold clickable" onClick={onDone}>
            OK
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}

// Forger : les pièces convergent, un éclair, la carte est là.
function ForgeScene({ card, onDone: done0 }) {
  const onDone = useOnce(done0);
  const [stage, setStage] = useState("gather"); // gather → reveal
  const parts = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * Math.PI * 2 + Math.random() * 0.4;
        const r = 0.36 + Math.random() * 0.22;
        return { id: i, x: Math.cos(a) * r, y: Math.sin(a) * r, d: Math.random() * 520, s: 0.6 + Math.random() * 0.9 };
      }),
    []
  );
  useEffect(() => {
    playCardCharge(1.1);
    const t = setTimeout(() => {
      setStage("reveal");
      playCardReveal(card.rarity);
    }, 1250);
    return () => clearTimeout(t);
  }, [card.rarity]);
  const meta = CARD_RARITIES[card.rarity] || CARD_RARITIES.common;
  return createPortal(
    <div className={`ws-scene forge st-${stage}`} style={{ "--rc": meta.color }} onClick={stage === "reveal" ? onDone : undefined}>
      {parts.map((p) => (
        <i
          key={p.id}
          className="ws-spark"
          style={{ "--x": `${p.x * 100}vmin`, "--y": `${p.y * 100}vmin`, "--s": p.s, animationDelay: `${p.d}ms` }}
        />
      ))}
      <span className="ws-core" />
      <div className="ws-forged">
        {stage === "reveal" && (
          <span className="ws-forged-burst">
            <Burst colors={[meta.color, "#ffffff", "#f2b70b"]} count={30} spread={240} />
          </span>
        )}
        <div className="ws-forged-card">
          <TcgCard card={card} big eager faceDown={stage !== "reveal"} tilt={stage === "reveal"} />
        </div>
        {stage === "reveal" && (
          <div className="ws-forged-foot">
            <b>{card.name}</b>
            <span style={{ color: meta.color }}>
              {raritySymbol(card.rarity)} {meta.label}
            </span>
            <button className="bd-btn gold clickable" onClick={onDone}>
              Dans le classeur
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// --- la fenêtre -----------------------------------------------------------------------
export default function Workshop({ token, cards, points, forgeCard = null, onClose, onRecycled, onForged }) {
  useScrollLock(true);
  useBackClose(onClose, "workshop");
  const [tab, setTab] = useState(forgeCard ? "forge" : "recycle");
  const [info, setInfo] = useState(null);
  const [pick, setPick] = useState(() => new Map());
  const [chosen, setChosen] = useState(forgeCard);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [scene, setScene] = useState(null); // { kind, … }
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    apiFetch("/cards/workshop", { token })
      .then((d) => alive && setInfo(d))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token]);
  useEffect(() => {
    const on = (e) => e.key === "Escape" && !scene && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose, scene]);
  useLayoutEffect(() => setErr(""), [tab]);

  const balance = info?.points ?? points ?? 0;
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const picked = [...pick].map(([id, n]) => ({ card: byId.get(id), n })).filter((x) => x.card);
  const nPicked = picked.reduce((a, x) => a + x.n, 0);
  const gain = picked.reduce((a, x) => a + (info?.recycle?.[x.card.rarity] || 0) * x.n, 0);
  const lastCopies = picked.filter((x) => x.n >= x.card.count).length;

  // ⚠️ UNE REQUÊTE À LA FOIS (double clic, double rendu).
  async function recycle() {
    if (busyRef.current || !nPicked) return;
    busyRef.current = true;
    setBusy(true);
    setErr("");
    try {
      const res = await apiFetch("/cards/recycle", {
        method: "POST",
        token,
        body: { items: picked.map((x) => ({ card: x.card.id, n: x.n })) },
      });
      const flat = picked.flatMap((x) => Array.from({ length: x.n }, () => x.card));
      flat.sort((a, b) => cardRarityRank(a.rarity) - cardRarityRank(b.rarity));
      setScene({ kind: "recycle", res, cards: flat, picked });
    } catch (e) {
      setErr(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function forge() {
    if (busyRef.current || !chosen) return;
    busyRef.current = true;
    setBusy(true);
    setErr("");
    try {
      const res = await apiFetch("/cards/forge", { method: "POST", token, body: { card: chosen.id } });
      setScene({ kind: "forge", res });
    } catch (e) {
      setErr(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (scene?.kind === "recycle")
    return (
      <RecycleScene
        cards={scene.cards}
        gained={scene.res.gained}
        total={scene.res.points}
        onDone={() => onRecycled(scene.res, scene.picked)}
      />
    );
  if (scene?.kind === "forge") return <ForgeScene card={scene.res.card} onDone={() => onForged(scene.res)} />;

  return createPortal(
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-sheet wide ws">
        <header className="bd-sheet-head">
          <span className="ws-tabs">
            <button className={`ws-tab clickable ${tab === "recycle" ? "on" : ""}`} onClick={() => setTab("recycle")}>
              <Recycle />
              Recycler
            </button>
            <button className={`ws-tab clickable ${tab === "forge" ? "on" : ""}`} onClick={() => setTab("forge")}>
              <Anvil />
              Forger
            </button>
          </span>
          <Points n={balance} className="ws-balance" />
          <button className="bd-x clickable" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>

        {tab === "recycle" ? (
          <>
            <RecycleTab cards={cards} info={info} pick={pick} setPick={setPick} />
            {err && <p className="bd-err">{err}</p>}
            <footer className="ws-foot">
              {lastCopies > 0 && (
                <span className="ws-warn">
                  {lastCopies} carte{lastCopies > 1 ? "s" : ""} quitte{lastCopies > 1 ? "nt" : ""} le classeur
                </span>
              )}
              <button className="bd-btn gold clickable" onClick={recycle} disabled={!nPicked || busy || !info}>
                {busy ? <Loader2 size={16} className="spin" /> : <Recycle size={17} />}
                Recycler {nPicked > 0 && <b className="ws-foot-n">{nPicked}</b>}
                {gain > 0 && <Points n={gain} className="ws-gain" />}
              </button>
            </footer>
          </>
        ) : chosen ? (
          <ForgeConfirm
            card={chosen}
            cost={info?.forge?.[chosen.rarity] ?? null}
            loading={!info}
            points={balance}
            busy={busy || !info}
            err={err}
            onForge={forge}
            onBack={() => setChosen(null)}
          />
        ) : (
          <ForgeTab token={token} info={info} points={balance} onChoose={setChosen} />
        )}
      </div>
    </div>,
    document.body
  );
}
