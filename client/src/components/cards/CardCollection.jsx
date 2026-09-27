import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, Gem, Clock, Star, Hash, Package, X, Loader2 } from "lucide-react";
import {
  TYPES,
  CARD_RARITIES,
  CARD_RARITY_ORDER,
  cardRarityRank,
  cardTypes,
  raritySymbol,
  fmtChance,
  oneIn,
} from "../../lib/cards";
import TcgCard, { TypeBadge } from "./TcgCard";
import BoosterPack from "./BoosterPack";
import CardInspector from "./CardInspector";

// ======================================================================
//  Un classeur : les chiffres du set, puis les cartes, puis la carte en grand
// ======================================================================
// Le même pour mon classeur et pour celui d'un ami. Ce qui change se passe en
// props : les chances par booster et le booster doré n'ont de sens que chez
// soi (`drops`), et `focusRecent` (un compteur) ramène aux dernières cartes
// tirées quand on sort d'une ouverture.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

const SORTS = [
  { key: "rarity", Icon: Gem, label: "Rareté" },
  { key: "recent", Icon: Clock, label: "Récentes" },
  { key: "rating", Icon: Star, label: "Note" },
  { key: "no", Icon: Hash, label: "Numéro" },
];

export default function CardCollection({
  cards,
  rarities = [],
  setSize = 0,
  loading = false,
  drops = false,
  goldenChance = null,
  focusRecent = 0,
  between = null,
}) {
  const [inspect, setInspect] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rarity");
  const [rarity, setRarity] = useState(null);
  const [type, setType] = useState(null);
  const binderRef = useRef(null);

  // Sortie d'une ouverture : les dernières cartes en tête, et on y descend.
  useEffect(() => {
    if (!focusRecent) return;
    setSort("recent");
    setRarity(null);
    setType(null);
    setQ("");
    requestAnimationFrame(() =>
      binderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, [focusRecent]);

  const ownedBy = useMemo(() => {
    const o = Object.fromEntries(CARD_RARITY_ORDER.map((r) => [r, 0]));
    for (const c of cards) o[c.rarity]++;
    return o;
  }, [cards]);
  const typesOwned = useMemo(() => {
    const s = new Set();
    for (const c of cards) for (const t of cardTypes(c)) s.add(t);
    return Object.keys(TYPES).filter((t) => s.has(t));
  }, [cards]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = cards.filter(
      (c) =>
        (!rarity || c.rarity === rarity) &&
        (!type || cardTypes(c).includes(type)) &&
        (!needle || c.name.toLowerCase().includes(needle))
    );
    const cmp = {
      rarity: (a, b) => cardRarityRank(b.rarity) - cardRarityRank(a.rarity) || a.no - b.no,
      recent: (a, b) => new Date(b.firstAt || 0) - new Date(a.firstAt || 0) || a.no - b.no,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      no: (a, b) => a.no - b.no,
    }[sort];
    return list.sort(cmp);
  }, [cards, q, rarity, type, sort]);

  const owned = cards.length;
  const pct = setSize ? owned / setSize : 0;

  return (
    <>
      {/* ---------- Les chiffres du set ---------- */}
      <section className="cd-stats">
        <div className="cd-ring" title={`${owned} / ${setSize}`}>
          <svg viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="19" className="cd-ring-bg" />
            <circle
              cx="22"
              cy="22"
              r="19"
              className="cd-ring-fg"
              style={{ strokeDasharray: `${Math.max(0.5, pct * 119.4)} 119.4` }}
            />
          </svg>
          <span className="cd-ring-num">
            <b>{fmt(owned)}</b>
            <small>/ {fmt(setSize)}</small>
          </span>
        </div>

        <div className={`cd-rars ${drops ? "" : "no-drops"}`}>
          {[...CARD_RARITY_ORDER].reverse().map((r) => {
            const info = rarities.find((x) => x.key === r);
            const meta = CARD_RARITIES[r];
            const n = info?.total || 0;
            const has = ownedBy[r] || 0;
            const one = oneIn(info?.chance);
            return (
              <button
                key={r}
                className={`cd-rar clickable ${rarity === r ? "on" : ""} ${rarity && rarity !== r ? "dim" : ""}`}
                style={{ "--rc": meta.color }}
                onClick={() => setRarity((v) => (v === r ? null : r))}
                title={`${meta.label} — ${has}/${n}${drops ? ` — ${fmtChance(info?.chance)} par booster` : ""}`}
              >
                <span className="cd-rar-sym">{raritySymbol(r)}</span>
                <span className="cd-rar-name">{meta.label}</span>
                <span className="cd-rar-count">
                  <b>{fmt(has)}</b>/{fmt(n)}
                </span>
                <span className="cd-rar-bar">
                  <i style={{ width: `${n ? (has / n) * 100 : 0}%` }} />
                </span>
                {drops && (
                  <span className="cd-rar-drop">
                    <Package size={12} />
                    {one && one > 1 ? `1/${one}` : fmtChance(info?.chance)}
                  </span>
                )}
              </button>
            );
          })}
          {drops && (
            <div className="cd-rar golden" title="Booster doré : que des cartes Épique ou mieux">
              <span className="cd-rar-mini">
                <BoosterPack golden />
              </span>
              <span className="cd-rar-name">Doré</span>
              <span className="cd-rar-drop">
                <Package size={12} />
                1/{oneIn(goldenChance) || 250}
              </span>
            </div>
          )}
        </div>
      </section>

      {between}

      {/* ---------- Le classeur ---------- */}
      <section className="cd-binder" ref={binderRef}>
        <div className="cd-tools">
          <label className="cd-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher" />
            {q && (
              <button className="clickable" onClick={() => setQ("")} aria-label="Effacer">
                <X size={14} />
              </button>
            )}
          </label>
          <div className="cd-types">
            {typesOwned.map((t) => (
              <button
                key={t}
                className={`cd-type clickable ${type === t ? "on" : ""} ${type && type !== t ? "dim" : ""}`}
                onClick={() => setType((v) => (v === t ? null : t))}
                title={TYPES[t].label}
              >
                <TypeBadge type={t} />
              </button>
            ))}
          </div>
          <div className="cd-sorts">
            {SORTS.map(({ key, Icon, label }) => (
              <button
                key={key}
                className={`cd-sort clickable ${sort === key ? "on" : ""}`}
                onClick={() => setSort(key)}
                title={label}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="cd-state">
            <Loader2 size={22} className="spin" />
          </div>
        ) : cards.length === 0 ? (
          <div className="cd-empty">
            <span className="cd-empty-slot" />
            <span className="cd-empty-slot" />
            <span className="cd-empty-slot" />
          </div>
        ) : (
          <VirtualGrid
            items={shown}
            renderItem={(c, i) => (
              <div className="cd-cell" key={c.id}>
                <TcgCard card={c} lite onClick={() => setInspect(i)} />
                {c.fresh && <span className="cd-new">NEW</span>}
                {c.count > 1 && <span className="cd-count">×{c.count}</span>}
              </div>
            )}
          />
        )}
      </section>

      {inspect != null && shown[inspect] && (
        <CardInspector
          list={shown}
          index={inspect}
          onIndex={setInspect}
          onClose={() => setInspect(null)}
        />
      )}
    </>
  );
}

// ======================================================================
//  La grille du classeur, virtualisée
// ======================================================================
// Seules les rangées à l'écran (plus deux de marge de chaque côté) existent
// dans la page ; le conteneur garde la hauteur de TOUTES les rangées, donc la
// barre de défilement dit la vérité. Toutes les cartes ont le même format
// (63 × 88), ce qui rend la hauteur d'une rangée exacte sans rien mesurer.
function VirtualGrid({ items, renderItem }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [win, setWin] = useState({ first: 0, last: 6 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Les mêmes gabarits que la grille en CSS (téléphone / reste).
  const small = width > 0 && width < 600;
  const minCol = small ? 104 : 158;
  const gapX = small ? 10 : 16;
  const gapY = small ? 14 : 19;
  const cols = Math.max(1, Math.floor((width + gapX) / (minCol + gapX)));
  const cellW = width ? (width - gapX * (cols - 1)) / cols : minCol;
  const rowH = (cellW * 88) / 63 + gapY;
  const rows = Math.ceil(items.length / cols);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / rowH) - 2);
      const last = Math.min(rows, Math.ceil((window.innerHeight - top) / rowH) + 2);
      setWin((w) => (w.first === first && w.last === last ? w : { first, last }));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    // En capture : on entend le défilement de la fenêtre comme celui du
    // conteneur de l'app, quel que soit celui qui défile.
    document.addEventListener("scroll", on, { capture: true, passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("scroll", on, { capture: true });
      window.removeEventListener("resize", on);
    };
  }, [rowH, rows]);

  const start = win.first * cols;
  const end = Math.min(items.length, win.last * cols);
  return (
    <div ref={ref} className="cd-grid-v" style={{ height: rows ? rows * rowH - gapY : 0 }}>
      <div
        className="cd-grid"
        style={{
          transform: `translateY(${win.first * rowH}px)`,
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          columnGap: gapX,
          rowGap: gapY,
        }}
      >
        {items.slice(start, end).map((it, k) => renderItem(it, start + k))}
      </div>
    </div>
  );
}
