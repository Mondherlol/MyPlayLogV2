import { memo, useEffect, useRef } from "react";
import { Star, Users } from "lucide-react";
import { PiTriangleBold, PiCircleBold, PiXBold, PiSquareBold } from "react-icons/pi";
import {
  TYPES,
  CARD_RARITIES,
  cardStats,
  cardCover,
  fmtVotes,
  raritySymbol,
  isHolo,
  isFullArt,
} from "../../lib/cards";
import { TYPE_ICONS } from "./TypeIcons";

// ======================================================================
//  Une carte : face (le jeu), dos (le logo), holo qui suit le pointeur
// ======================================================================
// Toutes les tailles internes sont en `cqw` (largeur de la carte) : la même
// carte se dessine à 120 px dans le classeur et à 420 px en grand, sans une
// ligne de CSS en plus. On lui donne une largeur, elle fait le reste.

// L'inclinaison 3D et la position du reflet, pilotées par le pointeur. Écrit
// directement dans le style (variables CSS), jamais dans l'état React : une
// carte qui suit la souris ne doit pas se re-rendre 60 fois par seconde.
export function useCardTilt(enabled = true, strength = 1) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    let last = null;
    const set = (k, v) => el.style.setProperty(k, v);
    const apply = () => {
      raf = 0;
      if (!last) return;
      const px = Math.min(1, Math.max(0, last.x));
      const py = Math.min(1, Math.max(0, last.y));
      set("--mx", `${px * 100}%`);
      set("--my", `${py * 100}%`);
      set("--hx", `${20 + px * 60}%`);
      set("--hy", `${20 + py * 60}%`);
      set("--rx", `${(0.5 - py) * 20 * strength}deg`);
      set("--ry", `${(px - 0.5) * 24 * strength}deg`);
      set("--hyp", String(Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2)));
    };
    const move = (e) => {
      const r = el.getBoundingClientRect();
      last = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const enter = (e) => {
      el.classList.add("live");
      move(e);
    };
    const leave = () => {
      el.classList.remove("live");
      last = null;
      for (const k of ["--mx", "--my", "--hx", "--hy", "--rx", "--ry", "--hyp"])
        el.style.removeProperty(k);
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointercancel", leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointercancel", leave);
    };
  }, [enabled, strength]);
  return ref;
}

export function TypeBadge({ type, className = "" }) {
  const key = TYPES[type] ? type : "arcade";
  const t = TYPES[key];
  const Icon = TYPE_ICONS[key];
  return (
    <span className={`tcg-type ${className}`} style={{ "--tc": t.color }} title={t.label}>
      <Icon />
    </span>
  );
}

export function CardBack() {
  return (
    <div className="tcg-back-in">
      {/* Pas de logo (il viendra) : les quatre symboles de manette, en blason. */}
      <span className="tcg-back-ring">
        <span className="tcg-back-glyphs">
          <PiTriangleBold />
          <PiCircleBold />
          <PiXBold />
          <PiSquareBold />
        </span>
      </span>
      <span className="tcg-back-word">
        My<b>PlayLog</b>
      </span>
    </div>
  );
}

function TcgCard({
  card,
  faceDown = false,
  tilt = true,
  className = "",
  big = false,
  // Images chargées tout de suite (carte en grand) plutôt qu'à l'approche de
  // l'écran : une carte qui arrive ne doit jamais montrer son fond vide.
  eager = false,
  lite = false,
  onClick,
  style,
  children,
}) {
  const ref = useCardTilt(tilt && !faceDown);
  const back = !card;
  const stats = back ? null : cardStats(card);
  const r = card?.rarity || "common";
  const full = !back && isFullArt(r);
  const holo = !back && isHolo(r);
  const t1 = stats ? TYPES[stats.types[0]] : null;
  const t2 = stats ? TYPES[stats.types[1] || stats.types[0]] : null;
  const nameLen = card?.name?.length || 0;

  return (
    <div
      ref={ref}
      className={`tcg r-${r} ${full ? "full" : ""} ${holo ? "holo" : ""} ${
        faceDown || back ? "down" : ""
      } ${lite ? "lite" : ""} ${onClick ? "clickable" : ""} ${className}`}
      style={{
        "--t1": t1?.color,
        "--t2": t2?.color,
        "--rc": CARD_RARITIES[r]?.color,
        ...style,
      }}
      onClick={onClick}
    >
      <div className="tcg-tilt">
        <div className="tcg-flip">
          {!back && (
            <div className="tcg-face tcg-front">
              <div className="tcg-body">
                <div className={`tcg-art ${!full && !card.focus ? "fit" : ""}`}>
                  {full ? (
                    // Pleine illustration : la carte est en portrait, comme la
                    // jaquette — elle y tient entière.
                    <img src={cardCover(card.cover)} alt="" loading={eager ? "eager" : "lazy"} decoding={eager ? "sync" : "async"} draggable="false" />
                  ) : card.focus ? (
                    // La jaquette cadrée sur sa zone d'intérêt (visage, héros,
                    // véhicule…), calculée une fois côté serveur (lib/cardFocus).
                    <img
                      className="tcg-art-crop"
                      src={cardCover(card.cover)}
                      alt=""
                      loading={eager ? "eager" : "lazy"}
                      decoding={eager ? "sync" : "async"}
                      draggable="false"
                      style={{
                        width: `${100 / card.focus.w}%`,
                        left: `${(-card.focus.x / card.focus.w) * 100}%`,
                        top: `${(-card.focus.y / card.focus.h) * 100}%`,
                      }}
                    />
                  ) : (
                    // Rien à viser (jaquette grise, au trait) : la jaquette
                    // ENTIÈRE sur un fond flouté d'elle-même.
                    <>
                      <img className="tcg-art-blur" src={cardCover(card.cover, "t_cover_small")} alt="" loading={eager ? "eager" : "lazy"} draggable="false" />
                      <img className="tcg-art-fit" src={cardCover(card.cover)} alt="" loading={eager ? "eager" : "lazy"} decoding={eager ? "sync" : "async"} draggable="false" />
                    </>
                  )}
                  {holo && <i className="tcg-art-holo" />}
                </div>

                <div className="tcg-head">
                  <span
                    className={`tcg-name ${nameLen > 30 ? "xs" : nameLen > 20 ? "sm" : ""}`}
                  >
                    {card.name}
                  </span>
                  {card.variant && (
                    <em className={`tcg-var v-${card.variant}`}>
                      {card.variant === "ex" ? "EX" : "HD"}
                    </em>
                  )}
                  <span className="tcg-hp">
                    <small>PV</small>
                    {stats.hp}
                  </span>
                  <TypeBadge type={stats.types[0]} />
                </div>

                <div className="tcg-strip">
                  {[card.studio, card.year].filter(Boolean).join(" · ")}
                </div>

                <div className="tcg-moves">
                  {stats.moves.map((m, i) => (
                    <div className="tcg-move" key={i}>
                      <span className="tcg-cost">
                        {Array.from({ length: m.cost }, (_, k) => (
                          <TypeBadge key={k} type={m.type} className="mini" />
                        ))}
                      </span>
                      <span className={`tcg-mname ${m.name.length > 19 ? "sm" : ""}`}>{m.name}</span>
                      <span className="tcg-dmg">
                        {m.dmg}
                        {m.plus ? "+" : ""}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="tcg-foot">
                  <span className="tcg-stat" title="Note">
                    <Star strokeWidth={2.6} />
                    {card.rating != null ? Math.round(card.rating) : "—"}
                  </span>
                  <span className="tcg-stat" title="Votes">
                    <Users strokeWidth={2.6} />
                    {fmtVotes(card.votes)}
                  </span>
                  {stats.types[1] && <TypeBadge type={stats.types[1]} className="mini" />}
                  <span className="tcg-rar" title={CARD_RARITIES[r]?.label}>
                    {raritySymbol(r)}
                  </span>
                  <span className="tcg-no">{String(card.no).padStart(3, "0")}</span>
                </div>
              </div>
              {holo && <i className="tcg-holo" />}
              {full && <i className="tcg-sparkle" />}
              {r === "mythic" && <i className="tcg-shimmer" />}
              <i className="tcg-glare" />
            </div>
          )}
          <div className="tcg-face tcg-back">
            <CardBack />
            <i className="tcg-glare" />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

export default memo(TcgCard);
