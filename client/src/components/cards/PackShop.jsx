import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, Package, Joystick, Shuffle } from "lucide-react";
import { EDITIONS } from "../../lib/cards";
import { playCrankNotch } from "../../lib/sfx";
import BoosterPack from "./BoosterPack";

// ======================================================================
//  La vitrine des boosters : choisir, puis ouvrir
// ======================================================================
// Chaque sachet porte son thème écrit dessus (Action, Arcade & indé…) : pas
// besoin d'en dire plus. Un clic sur un sachet le SÉLECTIONNE (il monte, le
// bouton devient « Ouvrir Braise »), un second l'ouvre ; un clic ailleurs ou
// Échap le relâche. Rien de sélectionné : « Ouvrir » fait tourner une petite
// roulette sur les trois sachets et ouvre celui où elle s'arrête.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

export default function PackShop({ data, covers, canBuy, points, price, onOpen }) {
  const [selected, setSelected] = useState(null);
  const [spin, setSpin] = useState(null); // sachet éclairé par la roulette
  const packRefs = useRef({});
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Relâcher le sachet : un clic sur autre chose qu'un sachet ou que le
  // bouton (la vitrine fait toute la largeur — « dehors » ne suffisait pas),
  // ou Échap.
  useEffect(() => {
    if (!selected || spin) return undefined;
    const onDown = (e) => {
      if (!e.target.closest?.(".cd-pack, .cd-buy")) setSelected(null);
    };
    const onKey = (e) => e.key === "Escape" && setSelected(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected, spin]);

  const focus = spin || selected;
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
    <section className="cd-shop">
      <div className={`cd-packs ${canBuy ? "" : "poor"}`}>
        {EDITIONS.map((ed, i) => (
          <button
            key={ed.key}
            className={`cd-pack p${i} clickable ${selected === ed.key ? "sel" : ""} ${
              // ⚠️ PAS « spin » : c'est la classe globale des icônes qui tournent.
              spin === ed.key ? "rolling" : ""
            } ${focus && focus !== ed.key ? "dim" : ""}`}
            onClick={() => clickPack(ed.key)}
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
    </section>
  );
}
