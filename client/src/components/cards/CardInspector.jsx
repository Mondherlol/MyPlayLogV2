import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Info, X, Heart, Layers, Check, Loader2, ArrowLeftRight, Recycle, Diamond } from "lucide-react";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import { CARD_RARITIES, raritySymbol, cardCover } from "../../lib/cards";
import { playCardDeal } from "../../lib/sfx";
import TcgCard from "./TcgCard";
import GameDrawer, { useGameDrawer, siteModalOpen } from "./GameDrawer";
import { BINDER_COLORS } from "./Binders";

// ======================================================================
//  Une carte en grand, par-dessus tout — du classeur, d'un ami ou du fil
// ======================================================================
// La carte en grand : on la fait tourner sous le pointeur, on passe à la
// voisine avec les flèches, et on tire la fiche du jeu depuis la droite.
const typing = (e) => !!e.target.closest?.("input, textarea, select, [contenteditable]");

// Ranger la carte dans ses classeurs : une petite liste à cocher.
function BinderPicker({ card, binders, onToggle }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const on = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, [open]);
  const count = binders.filter((b) => b.cards?.includes(card.id)).length;
  return (
    <span className="cd-insp-binders" ref={ref}>
      <button className={`cd-insp-game clickable ${open ? "on" : ""}`} onClick={() => setOpen((v) => !v)}>
        <Layers size={16} /> Classeurs{count ? <b>{count}</b> : null}
      </button>
      {open && (
        <span className="cd-insp-pop">
          {binders.length === 0 && <span className="cd-insp-pop-none">Crée un classeur depuis l'étagère.</span>}
          {binders.map((b) => {
            const inside = b.cards?.includes(card.id);
            return (
              <button
                key={b.id}
                className={`cd-insp-pop-row clickable ${inside ? "on" : ""}`}
                style={{ "--bc": BINDER_COLORS[b.color] || BINDER_COLORS.gold }}
                onClick={async () => {
                  setBusy(b.id);
                  try {
                    await onToggle(b, card, !inside);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <i className="cd-insp-pop-dot" />
                <span>{b.name}</span>
                {busy === b.id ? <Loader2 size={14} className="spin" /> : inside ? <Check size={15} /> : null}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

export default function CardInspector({
  list,
  index,
  onIndex,
  onClose,
  onFav = null,
  binders = null,
  onToggleBinder = null,
  onRequest = null,
  // Chez soi : recycler un exemplaire (`rates` : les Éclats par rareté).
  onRecycle = null,
  rates = null,
}) {
  useScrollLock(true);
  useBackClose(onClose, "card");
  const card = list[index];
  const drawer = useGameDrawer();
  // Le passage à la voisine : un simple glissé — l'ancienne carte file d'un
  // côté, la nouvelle arrive de l'autre. Pas de retournement : sur une carte
  // en grand, holo compris, il saccadait et faisait bizarre.
  const [swap, setSwap] = useState(null); // { dir, prev, k }
  const swapTimer = useRef(0);
  const go = useCallback(
    (d) => {
      const next = Math.min(list.length - 1, Math.max(0, index + d));
      if (next === index) return;
      setSwap({ dir: d, prev: list[index], k: Date.now() });
      // Fin du glissé à l'horloge, pas sur « animationend » : ceux des calques
      // de la carte (reflet, holo) remontent jusqu'ici et le coupaient net.
      clearTimeout(swapTimer.current);
      swapTimer.current = setTimeout(() => setSwap(null), 360);
      playCardDeal(0);
      onIndex(next);
    },
    [onIndex, list, index]
  );
  useEffect(() => () => clearTimeout(swapTimer.current), []);

  // Les voisines sont chargées d'avance : au glissé, leur image est déjà là
  // (c'était l'éclair noir — la carte arrivait avant sa jaquette).
  useEffect(() => {
    for (const c of [list[index - 1], list[index + 1]]) {
      if (!c?.cover) continue;
      new Image().src = cardCover(c.cover);
      if (!c.focus) new Image().src = cardCover(c.cover, "t_cover_small");
    }
  }, [list, index]);
  const drawerOpen = drawer.open;
  const setDrawer = drawer.setOpen;
  useEffect(() => {
    const on = (e) => {
      // Une saisie, ou une modale du site par-dessus (bande-annonce, liste,
      // visionneuse) : ses touches sont les siennes.
      if (typing(e) || siteModalOpen()) return;
      if (e.key === "Escape") return drawerOpen ? setDrawer(false) : onClose();
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [go, onClose, drawerOpen, setDrawer]);

  // Au doigt : glisser = carte voisine ; glisser DEPUIS LE BORD DROIT = tirer
  // la fiche du jeu, comme un tiroir.
  const touch = useRef(null);
  const meta = CARD_RARITIES[card.rarity];

  // La languette : un clic l'ouvre, la tirer vers la gauche aussi.
  const pull = useRef(null);
  function onPullDown(e) {
    e.stopPropagation();
    pull.current = { x: e.clientX, done: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPullMove(e) {
    const p = pull.current;
    if (!p || p.done) return;
    const dx = p.x - e.clientX;
    e.currentTarget.style.transform = `translateX(${-Math.max(0, Math.min(dx, 60))}px)`;
    if (dx > 50) {
      p.done = true;
      setDrawer(true);
    }
  }
  function onPullUp(e) {
    const p = pull.current;
    pull.current = null;
    e.currentTarget.style.transform = "";
    if (p && !p.done && Math.abs(p.x - e.clientX) < 6) setDrawer(true);
  }

  return createPortal(
    <div
      className={`cd-insp ${drawerOpen ? "with-drawer" : ""}`}
      onClick={onClose}
      onTouchStart={(e) => {
        const x = e.touches[0].clientX;
        touch.current = { x, edge: x > window.innerWidth - 36 };
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        if (t.edge && dx < -40) setDrawer(true);
        else if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
      }}
    >
      <button className="cd-insp-close clickable" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <button
        className="cd-insp-nav prev clickable"
        disabled={index === 0}
        onClick={(e) => {
          e.stopPropagation();
          go(-1);
        }}
        aria-label="Précédente"
      >
        <ChevronLeft size={26} />
      </button>
      <div className="cd-insp-main" onClick={(e) => e.stopPropagation()}>
        <div className="cd-insp-stage">
          {swap && (
            <div key={`out-${swap.k}`} className="cd-insp-slide out" style={{ "--dir": swap.dir }}>
              <TcgCard card={swap.prev} big eager tilt={false} className="cd-insp-card" />
            </div>
          )}
          <div
            key={card.id}
            className={`cd-insp-slide ${swap ? "in" : ""}`}
            style={swap ? { "--dir": swap.dir } : undefined}
          >
            <TcgCard card={card} big eager className="cd-insp-card" />
          </div>
        </div>
        <div className="cd-insp-bar">
          <span className="cd-insp-rar" style={{ color: meta.color }}>
            {raritySymbol(card.rarity)} <span>{meta.label}</span>
          </span>
          {card.count > 1 && <span className="cd-insp-count">×{card.count}</span>}
          {onFav && (
            <button
              className={`cd-insp-fav clickable ${card.fav ? "on" : ""}`}
              onClick={() => onFav(card)}
              aria-label={card.fav ? "Retirer des favoris" : "Ajouter aux favoris"}
              aria-pressed={!!card.fav}
            >
              <Heart size={17} />
            </button>
          )}
          {binders && onToggleBinder && <BinderPicker card={card} binders={binders} onToggle={onToggleBinder} />}
          {onRequest && (
            <button
              className="cd-insp-game cd-insp-trade clickable"
              // Par-dessus la carte en grand (pas à sa place) : fermer l'une
              // puis ouvrir l'autre faisait « retour » sur la nouvelle.
              onClick={() => onRequest(card)}
            >
              <ArrowLeftRight size={16} /> Échanger
            </button>
          )}
          {onRecycle && !card.fav && (
            <button
              className="cd-insp-game cd-insp-recycle clickable"
              onClick={() => onRecycle(card)}
              title={card.count > 1 ? "Recycler un exemplaire" : "Recycler (la carte quitte le classeur)"}
            >
              <Recycle size={16} /> Recycler
              {rates?.[card.rarity] != null && (
                <b className="cd-insp-shards">
                  <Diamond size={11} />+{rates[card.rarity]}
                </b>
              )}
            </button>
          )}
          <button
            className={`cd-insp-game clickable ${drawerOpen ? "on" : ""}`}
            onClick={drawer.toggle}
          >
            <Info size={16} /> Infos
          </button>
        </div>
      </div>
      <button
        className="cd-insp-nav next clickable"
        disabled={index === list.length - 1}
        onClick={(e) => {
          e.stopPropagation();
          go(1);
        }}
        aria-label="Suivante"
      >
        <ChevronRight size={26} />
      </button>

      {!drawerOpen && (
        <button
          className="cd-insp-pull clickable"
          onPointerDown={onPullDown}
          onPointerMove={onPullMove}
          onPointerUp={onPullUp}
          onPointerCancel={onPullUp}
          onClick={(e) => e.stopPropagation()}
          aria-label="Infos du jeu"
        >
          <ChevronLeft size={18} />
          <Info size={16} />
        </button>
      )}
      {drawerOpen && <GameDrawer card={card} onClose={() => setDrawer(false)} />}
    </div>,
    document.body
  );
}
