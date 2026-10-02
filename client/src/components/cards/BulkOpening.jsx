import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X, Coins, GalleryVerticalEnd, ChevronsRight, Info } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { CARD_RARITIES, CARD_RARITY_ORDER, cardRarityRank, raritySymbol } from "../../lib/cards";
import { playPackGrab, playPackTear, playCardFlip, playCardReveal, playGoldenPack } from "../../lib/sfx";
import TcgCard from "./TcgCard";
import GameDrawer, { useGameDrawer, siteModalOpen } from "./GameDrawer";

// ======================================================================
//  Plusieurs boosters d'un coup
// ======================================================================
// Pas de sachet à déchirer un par un : toutes les cartes tombent face cachée
// dans une grille, les plus rares en tête, et « Tout retourner » les révèle en
// cascade. Un clic retourne une carte seule ; une carte retournée s'agrandit.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const STAGGER = 45; // ms entre deux cartes de la cascade

export default function BulkOpening({ token, edition, count, price, onClose, onOpened, onAgain, onBinder }) {
  useScrollLock(true);
  useBackClose(onClose, "pack");

  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [up, setUp] = useState([]);
  const [zoom, setZoom] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ⚠️ UN SEUL ACHAT PAR MONTAGE (double montage du mode développement) : la
  // requête vit dans une ref, le second passage se rebranche dessus.
  const buyRef = useRef(null);
  useEffect(() => {
    if (!buyRef.current) {
      playPackGrab();
      buyRef.current = apiFetch("/cards/open", {
        method: "POST",
        token,
        body: { edition: edition || undefined, count },
      });
    }
    let cancelled = false;
    buyRef.current
      .then((d) => {
        if (cancelled) return;
        // Les plus rares d'abord : c'est ce qu'on veut voir en premier.
        const cards = (d.packs || [d])
          .flatMap((p, pi) => p.cards.map((c, ci) => ({ ...c, key: `${pi}-${ci}` })))
          .sort((a, b) => cardRarityRank(b.rarity) - cardRarityRank(a.rarity) || a.no - b.no);
        setRes({ ...d, cards, golden: (d.packs || [d]).filter((p) => p.golden).length });
        setUp(cards.map(() => false));
        onOpened?.(d);
        playPackTear();
        if ((d.packs || [d]).some((p) => p.golden)) playGoldenPack();
      })
      .catch((e) => !cancelled && setErr(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = res?.cards || [];
  const upRef = useRef([]);
  upRef.current = up;
  const allUp = cards.length > 0 && up.every(Boolean);

  const flipOne = useCallback(
    (i) => {
      const c = cards[i];
      if (!c || upRef.current[i]) return;
      upRef.current = upRef.current.map((v, k) => (k === i ? true : v));
      setUp((u) => u.map((v, k) => (k === i ? true : v)));
      playCardFlip();
      if (cardRarityRank(c.rarity) >= 3) setTimeout(() => alive.current && playCardReveal(c.rarity), 200);
    },
    [cards]
  );

  // La cascade suit la grille, donc commence par les plus rares.
  const flipping = useRef(false);
  async function flipAll() {
    if (flipping.current) return;
    flipping.current = true;
    for (let i = 0; i < cards.length; i++) {
      if (!alive.current) break;
      if (upRef.current[i]) continue;
      flipOne(i);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, STAGGER));
    }
    flipping.current = false;
  }

  const drawer = useGameDrawer();
  const drawerOpen = drawer.open && zoom != null;
  const setDrawer = drawer.setOpen;

  useEffect(() => {
    const on = (e) => {
      if (e.target.closest?.("input, textarea, select, [contenteditable]") || siteModalOpen()) return;
      if (e.key === "Escape") {
        if (drawerOpen) setDrawer(false);
        else if (zoom != null) setZoom(null);
        else onClose();
      } else if ((e.key === " " || e.key === "Enter") && res && !allUp) {
        e.preventDefault();
        flipAll();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, drawerOpen, res, allUp, onClose, setDrawer]);

  // Le bilan, une fois tout retourné : nouvelles et raretés.
  const news = cards.filter((c) => c.isNew).length;
  const tally = CARD_RARITY_ORDER.slice()
    .reverse()
    .map((r) => [r, cards.filter((c) => c.rarity === r).length])
    .filter(([r, n]) => n > 0 && cardRarityRank(r) >= 2);

  const content = (
    <div className={`po bo ${res?.golden ? "golden" : ""}`}>
      <header className="bo-head">
        <b>
          {count} boosters · {cards.length || count * 5} cartes
        </b>
        {allUp && (
          <span className="bo-tally">
            {news > 0 && <span className="bo-new">{news} NEW</span>}
            {tally.map(([r, n]) => (
              <span key={r} style={{ color: CARD_RARITIES[r].color }}>
                {n} {raritySymbol(r)}
              </span>
            ))}
          </span>
        )}
      </header>

      <div className="bo-scroll">
        {!res && !err && <span className="po-wait" />}
        {res && (
          <div className="bo-grid">
            {cards.map((c, i) => (
              <div
                key={c.key}
                className={`bo-slot ${up[i] ? "is-up" : ""}`}
                style={{ "--rc": CARD_RARITIES[c.rarity].color, animationDelay: `${Math.min(i, 40) * 18}ms` }}
              >
                <TcgCard card={c} faceDown={!up[i]} tilt={up[i]} onClick={() => (up[i] ? setZoom(i) : flipOne(i))} />
                {up[i] && (
                  <div className="po-tags">
                    {c.isNew ? <span className="po-new">NEW</span> : <span className="po-dup">×{c.count}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="po-bar">
        {res && !allUp && (
          <button className="po-btn ghost clickable" onClick={flipAll}>
            <ChevronsRight size={18} /> Tout retourner
          </button>
        )}
        {allUp && (
          <>
            <button className="po-btn clickable" onClick={onBinder || onClose}>
              <GalleryVerticalEnd size={18} /> Classeur
            </button>
            <button
              className="po-btn gold clickable"
              onClick={onAgain}
              disabled={(res?.points ?? 0) < price * count}
            >
              Encore ×{count} <Coins size={16} /> {fmt(price * count)}
            </button>
          </>
        )}
      </div>

      <button className="po-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>

      {err && (
        <div className="po-err">
          <p>{err.message}</p>
          {err.status === 402 ? (
            <Link to="/arcade" className="po-btn gold clickable" onClick={onClose}>
              <Coins size={16} /> Arcade
            </Link>
          ) : (
            <button className="po-btn clickable" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      )}

      {zoom != null && cards[zoom] && (
        <div
          className={`po-zoom ${drawerOpen ? "with-drawer" : ""}`}
          onClick={() => {
            setDrawer(false);
            setZoom(null);
          }}
        >
          <div className="po-zoom-main" onClick={(e) => e.stopPropagation()}>
            <TcgCard card={cards[zoom]} big style={{ width: "min(400px, 82vw, calc((100dvh - 150px) * 0.716))" }} />
            <button className={`cd-insp-game clickable ${drawerOpen ? "on" : ""}`} onClick={drawer.toggle}>
              <Info size={16} /> Infos
            </button>
          </div>
        </div>
      )}
      {drawerOpen && cards[zoom] && <GameDrawer card={cards[zoom]} onClose={() => setDrawer(false)} />}
    </div>
  );

  return createPortal(content, document.body);
}
