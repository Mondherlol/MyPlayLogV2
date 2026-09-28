import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, Package, Joystick, Shuffle, X } from "lucide-react";
import { EDITIONS, raritySymbol } from "../../lib/cards";
import { playCrankNotch } from "../../lib/sfx";
import BoosterPack from "./BoosterPack";
import TcgCard, { TypeBadge } from "./TcgCard";
import CardInspector from "./CardInspector";

// ======================================================================
//  La vitrine des boosters : choisir, voir ce qu'il y a dedans, ouvrir
// ======================================================================
// Un clic sur un sachet le SÉLECTIONNE (il monte, son contenu s'affiche en
// dessous), un second clic l'ouvre. Rien de sélectionné : « Ouvrir » fait
// tourner une petite roulette sur les trois sachets et ouvre celui où elle
// s'arrête. Le survol montre aussi le contenu, sans rien sélectionner.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// « change dans 3 j » / « dans 5 h »
function untilLabel(date) {
  const ms = new Date(date) - Date.now();
  if (!(ms > 0)) return "bientôt";
  const h = Math.ceil(ms / 3600000);
  return h >= 24 ? `${Math.ceil(h / 24)} j` : `${h} h`;
}

export default function PackShop({ data, covers, canBuy, points, price, onOpen }) {
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [spin, setSpin] = useState(null); // sachet éclairé par la roulette
  const [inspect, setInspect] = useState(null); // { list, index }
  const packRefs = useRef({});
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const focus = spin || hovered || selected;
  const info = data?.editions?.find((e) => e.key === focus) || null;
  const meta = EDITIONS.find((e) => e.key === focus) || null;
  const chosen = EDITIONS.find((e) => e.key === selected) || null;

  function clickPack(key) {
    if (spin) return;
    if (selected === key && canBuy) onOpen(key, packRefs.current[key]);
    else setSelected(key);
  }

  // La roulette : deux tours qui ralentissent, puis l'arrêt sur un sachet tiré
  // au hasard — qu'on ouvre aussitôt.
  function roulette() {
    if (spin || !canBuy) return;
    const order = EDITIONS.map((e) => e.key);
    const target = order[Math.floor(Math.random() * order.length)];
    const start = Math.floor(Math.random() * order.length);
    const total = 2 * order.length + ((order.indexOf(target) - start + order.length) % order.length);
    let i = 0;
    const step = () => {
      setSpin(order[(start + i) % order.length]);
      playCrankNotch(i / total);
      if (i >= total) {
        timers.current.push(
          setTimeout(() => {
            setSpin(null);
            setSelected(target);
            onOpen(target, packRefs.current[target]);
          }, 380)
        );
        return;
      }
      i++;
      timers.current.push(setTimeout(step, 70 + (i / total) ** 2 * 260));
    };
    step();
  }

  return (
    // L'aperçu du survol TIENT jusqu'à ce qu'on quitte la vitrine : on doit
    // pouvoir descendre du sachet jusqu'à ses cartes à l'affiche sans le perdre.
    <section className="cd-shop" onMouseLeave={() => setHovered(null)}>
      <div className={`cd-packs ${canBuy ? "" : "poor"} ${focus ? "has-focus" : ""}`}>
        {EDITIONS.map((ed, i) => (
          <button
            key={ed.key}
            className={`cd-pack p${i} clickable ${selected === ed.key ? "sel" : ""} ${
              // ⚠️ PAS « spin » : c'est la classe globale des icônes qui tournent.
              spin === ed.key ? "rolling" : ""
            } ${focus && focus !== ed.key ? "dim" : ""}`}
            onClick={() => clickPack(ed.key)}
            onMouseEnter={() => setHovered(ed.key)}
            disabled={!data}
            aria-pressed={selected === ed.key}
            aria-label={`Booster ${ed.name} — ${ed.label}`}
          >
            <span className="cd-pack-in" ref={(el) => (packRefs.current[ed.key] = el)}>
              <BoosterPack edition={ed.key} covers={covers} />
            </span>
          </button>
        ))}
      </div>

      {canBuy ? (
        <button
          className="cd-buy clickable"
          disabled={!data || !!spin}
          onClick={() => (chosen ? onOpen(chosen.key, packRefs.current[chosen.key]) : roulette())}
        >
          {chosen ? <Package size={18} /> : <Shuffle size={18} />}
          {chosen ? `Ouvrir ${chosen.name}` : "Ouvrir"}
          <span className="cd-buy-price">
            <Coins size={15} /> {fmt(price)}
          </span>
        </button>
      ) : (
        <Link to="/arcade" className="cd-buy poor clickable">
          <Joystick size={18} /> Il manque
          <span className="cd-buy-price">
            <Coins size={15} /> {fmt(price - points)}
          </span>
        </Link>
      )}

      {/* Le contenu du sachet en vue — sinon, les trois familles côte à côte. */}
      <div className="cd-edinfo">
        {info && meta ? (
          <div className={`cd-ed ed-${meta.key}`}>
            <div className="cd-ed-head">
              <b className="cd-ed-name">{meta.name}</b>
              <span className="cd-ed-label">{meta.label}</span>
              <span className="cd-ed-types">
                {meta.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
              </span>
              <span className="cd-ed-size">
                {fmt(info.size)} cartes · <b>{fmt(info.counts.mythic)}</b> {raritySymbol("mythic")}
              </span>
              {selected && !spin && (
                <button className="cd-ed-x clickable" onClick={() => setSelected(null)} aria-label="Désélectionner">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="cd-ed-feat">
              <span
                className="cd-ed-feat-tag"
                title={`Chances ×${info.boost} cette semaine — changent dans ${untilLabel(info.endsAt)}`}
              >
                ×{info.boost} <small>{untilLabel(info.endsAt)}</small>
              </span>
              <div className="cd-ed-feat-cards">
                {info.featured.map((c, k) => (
                  <button
                    key={c.id}
                    className="cd-ed-card clickable"
                    onClick={() => setInspect({ list: info.featured, index: k })}
                    title={c.name}
                  >
                    <TcgCard card={c} lite tilt={false} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="cd-ed-all">
            {EDITIONS.map((ed) => (
              <div key={ed.key} className={`cd-ed-mini ed-${ed.key}`}>
                <b>{ed.name}</b>
                <span className="cd-ed-types">
                  {ed.types.map((t) => (
                    <TypeBadge key={t} type={t} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {inspect && (
        <CardInspector
          list={inspect.list}
          index={inspect.index}
          onIndex={(next) =>
            setInspect((s) => ({ ...s, index: typeof next === "function" ? next(s.index) : next }))
          }
          onClose={() => setInspect(null)}
        />
      )}
    </section>
  );
}
