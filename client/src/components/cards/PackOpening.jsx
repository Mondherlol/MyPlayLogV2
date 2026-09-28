import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X, Coins, GalleryVerticalEnd, ChevronsRight, Pointer, Info } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useBackClose } from "../../hooks/useBackClose";
import {
  CARD_RARITIES,
  cardRarityRank,
  raritySymbol,
} from "../../lib/cards";
import {
  playPackGrab,
  playTearTick,
  playPackTear,
  playCardDeal,
  playCardFlip,
  playCardCharge,
  playCardReveal,
  playGoldenPack,
} from "../../lib/sfx";
import Burst from "../Burst";
import TcgCard from "./TcgCard";
import BoosterPack, { makeTearLine, tearClip } from "./BoosterPack";
import GameDrawer, { useGameDrawer, siteModalOpen } from "./GameDrawer";

// ======================================================================
//  L'ouverture d'un booster, plein écran
// ======================================================================
// 1. le sachet vole jusqu'au centre (depuis là où on l'a cliqué) ;
// 2. on le déchire en glissant le long du haut — ou d'un simple tap ;
// 3. les cartes sortent, se distribuent face cachée ;
// 4. on les retourne une par une. Plus c'est rare, plus ça charge avant.
//
// Le tirage est déjà fait côté serveur au moment où le sachet décolle : la
// mise en scène ne décide de rien, elle fait durer le plaisir.

const CHARGE = { epic: 0.55, legendary: 0.95, mythic: 1.35 };
const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function useStageLayout() {
  const calc = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const wide = vw >= 760;
    const pw = Math.round(Math.min(270, vw * 0.6, (vh - 170) / 1.72));
    let cw;
    let slots;
    if (wide) {
      const gap = 18;
      cw = Math.floor(Math.min(210, (vw - 80 - gap * 4) / 5, (vh - 210) / 1.4));
      const ch = cw * 1.397;
      slots = Array.from({ length: 5 }, (_, i) => ({
        x: (i - 2) * (cw + gap),
        y: -ch * 0.08,
        r: (i - 2) * 1.2,
      }));
    } else {
      const gap = 10;
      cw = Math.floor(Math.min(150, (vw - 28 - gap * 2) / 3, (vh - 190) / 2 / 1.4));
      const ch = cw * 1.397;
      slots = [0, 1, 2, 3, 4].map((i) => {
        const top = i < 3;
        const col = top ? i - 1 : i === 3 ? -0.5 : 0.5;
        return { x: col * (cw + gap), y: (top ? -0.5 : 0.5) * (ch + gap) - ch * 0.08, r: 0 };
      });
    }
    return { vw, vh, pw, ph: pw * 1.72, cw, slots };
  };
  const [lay, setLay] = useState(calc);
  useEffect(() => {
    const on = () => setLay(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return lay;
}

export default function PackOpening({
  token,
  edition,
  covers,
  origin,
  price,
  onClose,
  onOpened,
  onAgain,
  onBinder,
}) {
  useScrollLock(true);
  useBackClose(onClose, "pack");
  const lay = useStageLayout();

  // --- phases : fly → ready → torn → deal → reveal → done -------------------
  const [phase, setPhase] = useState("fly");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [flyIn, setFlyIn] = useState(!!origin);
  const [golden, setGolden] = useState(false);
  const [flipped, setFlipped] = useState([false, false, false, false, false]);
  const [charging, setCharging] = useState([false, false, false, false, false]);
  const [bursts, setBursts] = useState([0, 0, 0, 0, 0]);
  const [flash, setFlash] = useState(null);
  const [shake, setShake] = useState(0);
  const [zoom, setZoom] = useState(null);
  const [dragging, setDragging] = useState(false);
  const tearLine = useMemo(makeTearLine, []);
  const packRef = useRef(null);
  const tearRef = useRef({ p: 0, lastX: 0, moved: 0, tick: 0, id: null });
  const busy = useRef(false);
  // ⚠️ REMIS À VRAI À CHAQUE MONTAGE. En développement, React monte, démonte
  // puis remonte tout composant : un drapeau seulement éteint au démontage
  // restait faux pour de bon, et le sachet ne devenait jamais déchirable.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // --- l'achat, lancé dès l'ouverture ----------------------------------------
  const flewRef = useRef(false);
  const resRef = useRef(null);
  const maybeReady = useCallback(() => {
    if (!flewRef.current || !resRef.current || !alive.current) return;
    setPhase((p) => (p === "fly" ? "ready" : p));
    if (resRef.current.golden) {
      setGolden(true);
      setFlash({ color: "#f2b70b", k: Date.now() });
      playGoldenPack();
    }
  }, []);

  // ⚠️ UN SEUL ACHAT PAR SACHET. Le double montage du mode développement
  // relançait l'effet : deux requêtes, deux débits. La requête vit donc dans
  // une ref — le second passage se rebranche sur la même promesse.
  const buyRef = useRef(null);
  useEffect(() => {
    if (!buyRef.current) {
      playPackGrab();
      buyRef.current = apiFetch("/cards/open", { method: "POST", token, body: { edition } });
    }
    let cancelled = false;
    buyRef.current
      .then((d) => {
        if (cancelled) return;
        resRef.current = d;
        setRes(d);
        onOpened?.(d);
        maybeReady();
      })
      .catch((e) => !cancelled && setErr(e));
    return () => {
      cancelled = true;
    };
    // Une seule ouverture par montage : « Encore » remonte le composant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le vol depuis la page : on part de la place du sachet cliqué.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFlyIn(false)));
    const t = setTimeout(() => {
      flewRef.current = true;
      maybeReady();
    }, origin ? 620 : 380);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(t);
    };
  }, [origin, maybeReady]);

  const flyStyle = useMemo(() => {
    if (!origin) return null;
    const cx = origin.left + origin.width / 2 - lay.vw / 2;
    const cy = origin.top + origin.height / 2 - lay.vh / 2;
    return { transform: `translate(${cx}px, ${cy}px) scale(${origin.width / lay.pw})` };
  }, [origin, lay.vw, lay.vh, lay.pw]);

  // --- la déchirure ---------------------------------------------------------
  const setTear = (p) => {
    tearRef.current.p = p;
    packRef.current?.style.setProperty("--tp", String(Math.min(1, p)));
  };

  const doTear = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setTear(1);
    playPackTear();
    setPhase("torn");
    await wait(620);
    if (!alive.current) return;
    setPhase("deal");
    for (let i = 0; i < 5; i++) setTimeout(() => alive.current && playCardDeal(i), 380 + i * 90);
    await wait(380 + 5 * 90 + 520);
    if (!alive.current) return;
    setPhase("reveal");
    busy.current = false;
  }, []);

  const autoTear = useCallback(() => {
    if (busy.current) return;
    const start = performance.now();
    const from = tearRef.current.p;
    let lastTick = 0;
    const step = (now) => {
      const k = Math.min(1, (now - start) / 320);
      const p = from + (1 - from) * k;
      setTear(p);
      if (p - lastTick > 0.12) {
        lastTick = p;
        playTearTick(p);
      }
      if (k < 1) requestAnimationFrame(step);
      else doTear();
    };
    requestAnimationFrame(step);
  }, [doTear]);

  function onPackDown(e) {
    if (phase !== "ready" || busy.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    tearRef.current = { ...tearRef.current, lastX: e.clientX, moved: 0, id: e.pointerId };
    setDragging(true);
  }
  function onPackMove(e) {
    const t = tearRef.current;
    if (!dragging || t.id !== e.pointerId || busy.current) return;
    const dx = Math.abs(e.clientX - t.lastX);
    t.lastX = e.clientX;
    t.moved += dx;
    const p = t.p + dx / (lay.pw * 0.85);
    setTear(p);
    if (p - t.tick > 0.08) {
      t.tick = p;
      playTearTick(p);
    }
    if (p >= 1) {
      setDragging(false);
      doTear();
    }
  }
  function onPackUp(e) {
    const t = tearRef.current;
    if (t.id !== e.pointerId) return;
    setDragging(false);
    t.id = null;
    // Un tap (pas de glissé) : on déchire tout seul.
    if (t.moved < 8 && !busy.current) autoTear();
  }

  // --- les cartes -------------------------------------------------------------
  const cards = res?.cards || [];
  const allFlipped = cards.length > 0 && flipped.every(Boolean);
  const best = cards.reduce((b, c) => Math.max(b, cardRarityRank(c.rarity)), 0);
  const bestColor = best >= 3 ? CARD_RARITIES[cards.find((c) => cardRarityRank(c.rarity) === best)?.rarity]?.color : "#fff6d8";

  // La vérité sur « déjà retournée / en charge », lue sans attendre un rendu :
  // un clic pendant « Tout retourner » ne doit pas retourner deux fois.
  const upRef = useRef([false, false, false, false, false]);
  const chRef = useRef([false, false, false, false, false]);

  const reveal = useCallback(
    (i) => {
      const c = cards[i];
      if (!c) return;
      upRef.current[i] = true;
      setFlipped((f) => f.map((v, k) => (k === i ? true : v)));
      playCardFlip();
      const rank = cardRarityRank(c.rarity);
      setTimeout(() => {
        if (!alive.current) return;
        playCardReveal(c.rarity);
        setBursts((b) => b.map((v, k) => (k === i ? v + 1 : v)));
        if (rank >= 4) {
          setFlash({ color: CARD_RARITIES[c.rarity].color, k: Date.now() });
          setShake((s) => s + 1);
        }
      }, 200);
    },
    [cards]
  );

  const flip = useCallback(
    (i) =>
      new Promise((done) => {
        const c = cards[i];
        if (!c || upRef.current[i] || chRef.current[i]) return done();
        const dur = CHARGE[c.rarity];
        if (!dur) {
          reveal(i);
          return setTimeout(done, 260);
        }
        chRef.current[i] = true;
        setCharging((f) => f.map((v, k) => (k === i ? true : v)));
        playCardCharge(dur);
        setTimeout(() => {
          if (!alive.current) return done();
          chRef.current[i] = false;
          setCharging((f) => f.map((v, k) => (k === i ? false : v)));
          reveal(i);
          setTimeout(done, 700);
        }, dur * 1000);
      }),
    [cards, reveal]
  );

  const flippingAll = useRef(false);
  async function flipAll() {
    if (flippingAll.current) return;
    flippingAll.current = true;
    for (let i = 0; i < cards.length; i++) {
      if (!alive.current) break;
      if (!upRef.current[i] && !chRef.current[i]) {
        await flip(i);
        await wait(140);
      }
    }
    flippingAll.current = false;
  }

  // La fiche du jeu en panneau, depuis la carte agrandie.
  const drawer = useGameDrawer();
  const drawerOpen = drawer.open && zoom != null;
  const setDrawer = drawer.setOpen;

  // Clavier : espace / entrée = déchirer, puis retourner la suivante.
  useEffect(() => {
    const on = (e) => {
      // Une saisie dans une modale (liste, avis) n'est pas un ordre à la scène.
      if (e.target.closest?.("input, textarea, select, [contenteditable]") || siteModalOpen()) return;
      if (e.key === "Escape") {
        if (drawerOpen) setDrawer(false);
        else if (zoom != null) setZoom(null);
        else onClose();
        return;
      }
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (phase === "ready") autoTear();
      else if (phase === "reveal") {
        const next = upRef.current.findIndex((f, i) => !f && !chRef.current[i]);
        if (next >= 0) flip(next);
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [phase, flip, autoTear, zoom, onClose, drawerOpen, setDrawer]);

  // --- rendu ------------------------------------------------------------------
  const out = phase === "torn" || phase === "deal" || phase === "reveal";
  const dealt = phase === "deal" || phase === "reveal";
  const stackScale = (lay.pw * 0.84) / lay.cw;

  function slotStyle(i) {
    const s = lay.slots[i];
    if (!dealt) {
      // Dans le sachet, puis qui en sort par le haut.
      const lift = phase === "torn" ? -lay.ph * 0.46 : 0;
      return {
        transform: `translate(-50%, -50%) translate(${(i - 2) * 2}px, ${lift + (i - 2) * -2}px) rotate(${(i - 2) * 1.5}deg) scale(${stackScale})`,
        transitionDelay: phase === "torn" ? `${120 + (4 - i) * 30}ms` : "0ms",
        zIndex: 1 + i,
      };
    }
    return {
      transform: `translate(-50%, -50%) translate(${s.x}px, ${s.y}px) rotate(${s.r}deg)`,
      transitionDelay: phase === "deal" ? `${(4 - i) * 90}ms` : "0ms",
      zIndex: 10 + i,
    };
  }

  const content = (
    <div
      className={`po ${golden ? "golden" : ""} ph-${phase}`}
      style={{ "--pw": `${lay.pw}px`, "--cw": `${lay.cw}px`, "--best": bestColor }}
    >
      <div className={`po-stage ${shake ? `shake-${shake % 2}` : ""}`}>
        {/* Les cartes, face cachée tant qu'on ne les retourne pas */}
        {/* Les rayons des grosses cartes, SOUS toutes les cartes : dans leur
            propre emplacement, ils passeraient par-dessus la voisine. */}
        {res && dealt && (
          <div className="po-rayer">
            {cards.map((c, i) =>
              flipped[i] && cardRarityRank(c.rarity) >= 3 ? (
                <span
                  key={c.id}
                  className={`po-rays r-${c.rarity}`}
                  style={{
                    "--rc": CARD_RARITIES[c.rarity].color,
                    transform: `translate(${lay.slots[i].x}px, ${lay.slots[i].y}px)`,
                  }}
                >
                  <i />
                </span>
              ) : null
            )}
          </div>
        )}
        {res && (
          <div className="po-cards">
            {cards.map((c, i) => {
              const rank = cardRarityRank(c.rarity);
              return (
                <div
                  key={c.id}
                  className={`po-slot ${flipped[i] ? "is-up" : ""} ${charging[i] ? "charging" : ""} ${
                    rank >= 3 ? "hit" : ""
                  } r-${c.rarity}`}
                  style={{ ...slotStyle(i), "--rc": CARD_RARITIES[c.rarity].color, "--charge": `${CHARGE[c.rarity] || 0}s` }}
                >
                  <TcgCard
                    card={c}
                    faceDown={!flipped[i]}
                    tilt={phase === "reveal"}
                    onClick={
                      phase === "reveal"
                        ? () => (flipped[i] ? setZoom(i) : flip(i))
                        : undefined
                    }
                  />
                  {bursts[i] > 0 && (
                    <Burst
                      key={bursts[i]}
                      colors={[CARD_RARITIES[c.rarity].color, "#ffffff", "#f2b70b"]}
                      count={10 + rank * 6}
                      spread={60 + rank * 22}
                    />
                  )}
                  {flipped[i] && (
                    <div className="po-tags">
                      {c.isNew ? (
                        <span className="po-new">NEW</span>
                      ) : (
                        <span className="po-dup">×{c.count}</span>
                      )}
                      {rank >= 2 && (
                        <span className="po-rar" style={{ color: CARD_RARITIES[c.rarity].color }}>
                          {raritySymbol(c.rarity)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Le sachet : le corps, et le rabat qui s'arrache */}
        <div
          ref={packRef}
          className={`po-pack ${flyIn ? "fly" : ""} ${dragging ? "dragging" : ""}`}
          style={flyIn ? flyStyle || undefined : undefined}
          onPointerDown={onPackDown}
          onPointerMove={onPackMove}
          onPointerUp={onPackUp}
          onPointerCancel={onPackUp}
        >
          <BoosterPack
            edition={edition}
            covers={covers}
            golden={golden}
            className="po-body"
            style={{ clipPath: tearClip(tearLine, "body") }}
          />
          <BoosterPack
            edition={edition}
            covers={covers}
            golden={golden}
            className="po-flap"
            style={{ clipPath: tearClip(tearLine, "top") }}
          />
          <span className="po-cut" />
          {out && <span className="po-light" />}
          {phase === "ready" && !dragging && (
            <span className="po-hint" aria-hidden="true">
              <Pointer />
            </span>
          )}
        </div>

        {phase === "fly" && !res && !err && <span className="po-wait" />}
      </div>

      {flash && <span key={flash.k} className="po-flash" style={{ "--fc": flash.color }} />}

      {/* Barre du bas : tout retourner / encore / classeur */}
      <div className="po-bar">
        {phase === "reveal" && !allFlipped && (
          <button className="po-btn ghost clickable" onClick={flipAll}>
            <ChevronsRight size={18} /> Tout retourner
          </button>
        )}
        {allFlipped && (
          <>
            <button className="po-btn clickable" onClick={onBinder || onClose}>
              <GalleryVerticalEnd size={18} /> Classeur
            </button>
            <button
              className="po-btn gold clickable"
              onClick={onAgain}
              disabled={(res?.points ?? 0) < price}
            >
              Encore <Coins size={16} /> {fmt(price)}
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
            <TcgCard
              card={cards[zoom]}
              big
              style={{ width: "min(400px, 82vw, calc((100dvh - 150px) * 0.716))" }}
            />
            <button
              className={`cd-insp-game clickable ${drawerOpen ? "on" : ""}`}
              onClick={drawer.toggle}
            >
              <Info size={16} /> Infos
            </button>
          </div>
        </div>
      )}
      {drawerOpen && cards[zoom] && (
        <GameDrawer card={cards[zoom]} onClose={() => setDrawer(false)} />
      )}
    </div>
  );

  return createPortal(content, document.body);
}
