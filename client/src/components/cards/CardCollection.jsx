import { useEffect, useMemo, useRef, useState } from "react";
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
          <div className="cd-grid">
            {shown.map((c, i) => (
              <div className="cd-cell" key={c.id}>
                <TcgCard card={c} onClick={() => setInspect(i)} />
                {c.fresh && <span className="cd-new">NEW</span>}
                {c.count > 1 && <span className="cd-count">×{c.count}</span>}
              </div>
            ))}
          </div>
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
