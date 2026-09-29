import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search, Gem, Clock, Star, Hash, Package, X, Loader2, Heart, Plus, Pencil, Trash2 } from "lucide-react";
import {
  TYPES,
  CARD_RARITIES,
  CARD_RARITY_ORDER,
  cardRarityRank,
  cardTypes,
  raritySymbol,
  fmtChance,
  oneIn,
  cardCover,
} from "../../lib/cards";
import { apiFetch } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import TcgCard, { TypeBadge } from "./TcgCard";
import BoosterPack from "./BoosterPack";
import CardInspector from "./CardInspector";
import { BinderShelf, BinderEditor, BinderAddCards, MissingCell, BINDER_COLORS } from "./Binders";

// ======================================================================
//  Un classeur : les chiffres du set, puis les cartes, puis la carte en grand
// ======================================================================
// Le même pour mon classeur et pour celui d'un ami. Ce qui change se passe en
// props : les chances par booster et le booster doré n'ont de sens que chez
// soi (`drops`), et `focusRecent` (un compteur) ramène aux dernières cartes
// tirées quand on sort d'une ouverture.
//
// Chez soi (`editable`), une ÉTAGÈRE au-dessus des cartes : Toutes, Favoris
// (les cœurs) et les classeurs perso — « Ace Attorney » liste les 14 jeux de
// la série, ceux qu'on n'a pas encore en creux.

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
  // Chez soi seulement : favoris et classeurs.
  editable = false,
  token = null,
  binders = [],
  onBinders = null,
  onFav = null,
  // Chez un ami : les cartes que je cherche, et proposer un échange.
  wants = null,
  onRequest = null,
  // Chez soi : l'atelier (forger une carte en creux, recycler).
  onForge = null,
  onRecycle = null,
  rates = null,
}) {
  const [inspect, setInspect] = useState(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rarity");
  const [rarity, setRarity] = useState(null);
  const [type, setType] = useState(null);
  const [view, setView] = useState("all"); // all | fav | <id de classeur>
  const [binderCards, setBinderCards] = useState({});
  const [editor, setEditor] = useState(null); // null | { binder }
  const [adding, setAdding] = useState(false);
  const [onlyWanted, setOnlyWanted] = useState(false);
  const binderRef = useRef(null);
  const toast = useToast();

  // Sortie d'une ouverture : les dernières cartes en tête, et on y descend.
  useEffect(() => {
    if (!focusRecent) return;
    setView("all");
    setSort("recent");
    setRarity(null);
    setType(null);
    setQ("");
    requestAnimationFrame(() =>
      binderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );
  }, [focusRecent]);

  const current = binders.find((b) => b.id === view) || null;
  // Un classeur supprimé ailleurs (ou pas encore chargé) : retour à « Toutes ».
  useEffect(() => {
    if (view !== "all" && view !== "fav" && !current && !editor) setView("all");
  }, [view, current, editor]);

  // Les cartes d'un classeur : chargées à l'ouverture, rechargées quand son
  // contenu change.
  const currentId = current?.id;
  const currentTotal = current?.total;
  useEffect(() => {
    if (!currentId || !token) return;
    let alive = true;
    apiFetch(`/cards/binders/${currentId}`, { token })
      .then((d) => alive && setBinderCards((m) => ({ ...m, [currentId]: d.cards })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentId, currentTotal, token]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const favCount = useMemo(() => cards.filter((c) => c.fav).length, [cards]);

  // La base de la vue : toutes, les favorites, ou le classeur (celles qu'on a
  // — à jour : cœur, nombre — et celles qu'on n'a pas encore).
  const base = useMemo(() => {
    if (onlyWanted && wants) return cards.filter((c) => wants.has(c.id));
    if (view === "fav") return cards.filter((c) => c.fav);
    if (current) {
      const list = binderCards[current.id];
      if (!list) return null;
      return list.map((c) => {
        const mine = byId.get(c.id);
        return mine ? { ...mine, owned: true } : { ...c, owned: false };
      });
    }
    return cards;
  }, [view, current, binderCards, cards, byId, onlyWanted, wants]);
  const wantedHere = useMemo(() => (wants ? cards.filter((c) => wants.has(c.id)).length : 0), [cards, wants]);

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
    if (!base) return [];
    const needle = q.trim().toLowerCase();
    const list = base.filter(
      (c) =>
        (!rarity || c.rarity === rarity) &&
        (current || !type || cardTypes(c).includes(type)) &&
        (!needle || c.name.toLowerCase().includes(needle))
    );
    // Un classeur perso garde SON ordre (une série : de la plus ancienne à la
    // plus récente).
    if (current) return list;
    const cmp = {
      rarity: (a, b) => cardRarityRank(b.rarity) - cardRarityRank(a.rarity) || a.no - b.no,
      recent: (a, b) => new Date(b.firstAt || 0) - new Date(a.firstAt || 0) || a.no - b.no,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      no: (a, b) => a.no - b.no,
    }[sort];
    return list.sort(cmp);
  }, [base, q, rarity, type, sort, current]);

  // La carte en grand ne défile que parmi celles qu'on possède.
  const inspectable = useMemo(() => shown.filter((c) => c.owned !== false), [shown]);
  const inspectIndex = useMemo(() => new Map(inspectable.map((c, i) => [c.id, i])), [inspectable]);

  // --- classeurs : modifier, avec « Annuler » -------------------------------
  const replaceBinder = useCallback(
    (b) => onBinders?.((list) => list.map((x) => (x.id === b.id ? b : x))),
    [onBinders]
  );

  const setMembership = useCallback(
    async (b, card, on, silent = false) => {
      const res = await apiFetch(`/cards/binders/${b.id}`, {
        method: "PATCH",
        token,
        body: on ? { add: [card.id] } : { remove: [card.id] },
      });
      replaceBinder(res);
      setBinderCards((m) => {
        const list = m[b.id];
        if (!list) return m;
        return { ...m, [b.id]: on ? [...list.filter((c) => c.id !== card.id), card] : list.filter((c) => c.id !== card.id) };
      });
      if (!silent)
        toast.show({
          title: b.name,
          cover: cardCover(card.cover, "t_cover_small"),
          text: on ? `${card.name} ajoutée` : `${card.name} retirée`,
          undo: () => setMembership(b, card, !on, true),
        });
      return res;
    },
    [token, replaceBinder, toast]
  );

  function onSaved(res, { created, before }) {
    setEditor(null);
    if (created) {
      onBinders?.((list) => [...list, res]);
      setView(res.id);
      toast.show({
        title: res.name,
        cover: res.covers?.[0] ? cardCover(res.covers[0], "t_cover_small") : undefined,
        text: res.total ? `Classeur créé · ${res.total} cartes` : "Classeur créé",
        undo: async () => {
          await apiFetch(`/cards/binders/${res.id}`, { method: "DELETE", token });
          onBinders?.((list) => list.filter((x) => x.id !== res.id));
          setView("all");
        },
      });
    } else {
      replaceBinder(res);
      toast.show({
        title: res.name,
        text: "Classeur modifié",
        undo: async () => {
          const back = await apiFetch(`/cards/binders/${res.id}`, {
            method: "PATCH",
            token,
            body: { name: before.name, color: before.color },
          });
          replaceBinder(back);
        },
      });
    }
  }

  async function removeBinder(b) {
    const saved = await apiFetch(`/cards/binders/${b.id}`, { method: "DELETE", token });
    onBinders?.((list) => list.filter((x) => x.id !== b.id));
    setView("all");
    toast.show({
      title: b.name,
      text: "Classeur supprimé",
      undo: async () => {
        const again = await apiFetch("/cards/binders", {
          method: "POST",
          token,
          body: { name: saved.name, color: saved.color, cards: saved.cards },
        });
        onBinders?.((list) => [...list, again]);
        setView(again.id);
      },
    });
  }

  const owned = cards.length;
  const pct = setSize ? owned / setSize : 0;
  const color = current ? BINDER_COLORS[current.color] || BINDER_COLORS.gold : null;

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
        {editable && (
          <BinderShelf
            view={view}
            onView={(v) => {
              setView(v);
              setInspect(null);
            }}
            total={cards.length}
            favs={favCount}
            binders={binders}
            onCreate={() => setEditor({ binder: null })}
          />
        )}

        {current && (
          <div className="bd-head" style={{ "--bc": color }}>
            <div className="bd-head-main">
              <h2 className="bd-head-name">{current.name}</h2>
              <div className="bd-head-prog">
                <span className="bd-bar">
                  <i style={{ "--p": current.total ? current.owned / current.total : 0 }} />
                </span>
                <b>
                  {fmt(current.owned)}/{fmt(current.total)}
                </b>
                {current.total > 0 && current.owned === current.total && <span className="bd-done">Complet</span>}
              </div>
            </div>
            <div className="bd-head-actions">
              <button className="bd-act clickable" onClick={() => setAdding(true)} title="Ajouter des cartes">
                <Plus />
                <span>Ajouter</span>
              </button>
              <button className="bd-act icon clickable" onClick={() => setEditor({ binder: current })} title="Modifier">
                <Pencil />
              </button>
              <button className="bd-act icon clickable" onClick={() => removeBinder(current)} title="Supprimer">
                <Trash2 />
              </button>
            </div>
          </div>
        )}

        <div className="cd-tools">
          {wantedHere > 0 && (
            <button className={`cd-want-filter clickable ${onlyWanted ? "on" : ""}`} onClick={() => setOnlyWanted((v) => !v)}>
              <Search size={15} />
              Je cherche
              <b>{wantedHere}</b>
            </button>
          )}
          <label className="cd-search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher" />
            {q && (
              <button className="clickable" onClick={() => setQ("")} aria-label="Effacer">
                <X size={14} />
              </button>
            )}
          </label>
          {!current && (
            <>
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
            </>
          )}
        </div>

        {loading || base === null ? (
          <div className="cd-state">
            <Loader2 size={22} className="spin" />
          </div>
        ) : shown.length === 0 ? (
          current ? (
            <div className="bd-empty">
              <button className="bd-empty-add clickable" onClick={() => setAdding(true)}>
                <Plus />
                <span>Ajouter des cartes</span>
              </button>
            </div>
          ) : view === "fav" ? (
            <div className="bd-empty">
              <span className="bd-empty-heart">
                <Heart />
              </span>
            </div>
          ) : (
            <div className="cd-empty">
              <span className="cd-empty-slot" />
              <span className="cd-empty-slot" />
              <span className="cd-empty-slot" />
            </div>
          )
        ) : (
          <VirtualGrid
            items={shown}
            renderItem={(c, w) =>
              c.owned === false ? (
                <MissingCell key={c.id} card={c} onForge={onForge} />
              ) : (
                <BinderCell
                  key={c.id}
                  card={c}
                  index={inspectIndex.get(c.id)}
                  onOpen={setInspect}
                  onFav={editable ? onFav : null}
                  wanted={!!wants?.has(c.id)}
                  size={w}
                />
              )
            }
          />
        )}
      </section>

      {inspect != null && inspectable[inspect] && (
        <CardInspector
          list={inspectable}
          index={inspect}
          onIndex={setInspect}
          onClose={() => setInspect(null)}
          onFav={editable ? onFav : null}
          binders={editable ? binders : null}
          onToggleBinder={editable ? setMembership : null}
          onRequest={onRequest}
          onRecycle={onRecycle}
          rates={rates}
        />
      )}

      {editor && (
        <BinderEditor token={token} binder={editor.binder} onClose={() => setEditor(null)} onSaved={onSaved} />
      )}
      {adding && current && (
        <BinderAddCards
          token={token}
          binder={current}
          onClose={() => setAdding(false)}
          onToggle={(card, on) => setMembership(current, card, on)}
        />
      )}
    </>
  );
}

// Une case du classeur. MÉMORISÉE : quand une rangée entre à l'écran, seules
// ses cartes se dessinent — celles déjà là ne bougent pas. (Une fonction de
// clic recréée à chaque rendu faisait tout redessiner à chaque cran.)
const BinderCell = memo(function BinderCell({ card, index, onOpen, onFav, wanted = false, size = 0 }) {
  const open = useCallback(() => onOpen(index), [onOpen, index]);
  return (
    <div className={`cd-cell ${wanted ? "wanted" : ""}`}>
      <TcgCard card={card} lite size={size} onClick={open} />
      {card.fresh && <span className="cd-new">NEW</span>}
      {wanted && <span className="cd-wanted">Je cherche</span>}
      {card.count > 1 && <span className="cd-count">×{card.count}</span>}
      {onFav && (
        <button
          className={`cd-heart clickable ${card.fav ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onFav(card);
          }}
          aria-label={card.fav ? "Retirer des favoris" : "Ajouter aux favoris"}
          aria-pressed={!!card.fav}
        >
          <Heart />
        </button>
      )}
    </div>
  );
});

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
  const minCol = small ? 92 : 158;
  const gapX = small ? 10 : 16;
  const gapY = small ? 14 : 19;
  const cols = Math.max(1, Math.floor((width + gapX) / (minCol + gapX)));
  const cellW = width ? (width - gapX * (cols - 1)) / cols : minCol;
  const cellH = (cellW * 88) / 63;
  const rowH = cellH + gapY;
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

  // Chaque case à SA place (absolue) : quand une rangée entre ou sort, les
  // cases déjà là ne bougent pas d'un pixel — rien à redessiner. (Avant, la
  // grille entière glissait d'une rangée et toutes ses cartes se repeignaient,
  // ce qui saccadait sur téléphone.)
  const start = win.first * cols;
  const end = Math.min(items.length, win.last * cols);
  const out = [];
  for (let i = start; i < end; i++) {
    const it = items[i];
    const x = (i % cols) * (cellW + gapX);
    const y = Math.floor(i / cols) * rowH;
    out.push(
      <div key={it.id} className="cd-vcell" style={{ width: cellW, height: cellH, transform: `translate(${x}px, ${y}px)` }}>
        {renderItem(it, cellW)}
      </div>
    );
  }
  return (
    <div ref={ref} className="cd-grid-v" style={{ height: rows ? rows * rowH - gapY : 0 }}>
      {out}
    </div>
  );
}
