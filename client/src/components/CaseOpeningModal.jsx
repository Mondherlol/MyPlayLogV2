import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Sparkles, Coins, Copy, Check, RotateCcw } from "lucide-react";
import { apiFetch } from "../lib/api";
import { rarityColor, rarityLabel, formatChance } from "../lib/rarity";
import RewardArt from "./RewardArt";

// ======================================================================
//  Ouverture d'une caisse — la bobine qui défile, façon CS:GO.
// ======================================================================
// Le serveur a DÉJÀ décidé du gagnant et renvoie la bobine complète avec sa
// position dedans (`winnerIndex`). Tout ce qui se passe ici est de la mise en
// scène : on fait glisser la bande pour que la bonne case s'arrête sous le
// repère. Rien de ce que fait le client ne peut changer le lot obtenu.

// La géométrie de la bande vit dans le CSS (--co-item-w change sur mobile) : on
// la MESURE dans le DOM plutôt que de la redéclarer ici. Dupliquer ces valeurs
// ferait tomber le gagnant à côté du repère dès que la feuille de style bouge.
function measureStrip(strip) {
  const first = strip.children[0];
  const second = strip.children[1];
  if (!first) return null;
  return {
    itemW: first.offsetWidth,
    // Pas d'un lot au suivant = largeur + gouttière, lue telle qu'appliquée.
    pitch: second ? second.offsetLeft - first.offsetLeft : first.offsetWidth,
  };
}

// ---------------------------------------------------------------------
//  Le « juice » de la révélation, dosé par la rareté.
// ---------------------------------------------------------------------
// Un commun ne doit pas déclencher un feu d'artifice : l'intensité monte avec
// la rareté pour que l'œil sache AVANT de lire le nom que le lot est gros.
const FX = {
  common: { particles: 12, rays: false, shake: 0 },
  uncommon: { particles: 20, rays: false, shake: 0 },
  rare: { particles: 32, rays: true, shake: 3 },
  epic: { particles: 46, rays: true, shake: 5 },
  legendary: { particles: 62, rays: true, shake: 8 },
  mythic: { particles: 86, rays: true, shake: 11 },
};
const fxFor = (r) => FX[r] || FX.common;

// Les animations décoratives sont coupées si la personne a demandé moins de
// mouvement : la modale reste parfaitement utilisable sans elles.
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Gerbe de confettis : direction, distance, rotation et durée tirées au sort
// une fois par ouverture. Tout est ensuite joué par le CSS (aucune boucle JS).
function buildParticles(count, color) {
  const palette = [color, "#ffd24a", "#ffffff"];
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 90 + Math.random() * 200;
    return {
      id: i,
      tx: Math.round(Math.cos(angle) * dist),
      ty: Math.round(Math.sin(angle) * dist - 30), // léger biais vers le haut
      rot: Math.round(Math.random() * 720 - 360),
      delay: +(Math.random() * 0.14).toFixed(3),
      dur: +(0.75 + Math.random() * 0.65).toFixed(3),
      size: Math.round(5 + Math.random() * 7),
      shape: i % 3,
      color: palette[i % palette.length],
    };
  });
}

const SPIN_MS = 6200;
// Départ franc puis décélération très longue : la fin « hésite » entre deux
// lots, c'est là que se joue toute la tension.
const SPIN_EASE = "cubic-bezier(0.06, 0.72, 0.05, 1)";

// --- Bruitages synthétisés (WebAudio, zéro asset) — même approche que le
//     blind test : un clic par lot qui passe, une fanfare à la révélation. ---
function useSfx() {
  const ctxRef = useRef(null);

  const resume = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    ctxRef.current?.resume?.();
  }, []);

  const tone = useCallback((freq, dur, type = "sine", gain = 0.1, when = 0) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }, []);

  const tick = useCallback(() => tone(1250, 0.03, "square", 0.05), [tone]);

  // La fanfare monte avec la rareté : un commun fait « bip », un mythique
  // déroule un arpège. La récompense s'entend avant même de se lire.
  const reveal = useCallback(
    (rarity) => {
      const scores = {
        common: [440],
        uncommon: [523, 659],
        rare: [523, 659, 784],
        epic: [523, 659, 784, 1046],
        legendary: [523, 659, 784, 1046, 1318],
        mythic: [523, 659, 784, 1046, 1318, 1568],
      };
      (scores[rarity] || scores.common).forEach((f, i) =>
        tone(f, 0.34, "triangle", 0.12, i * 0.085)
      );
    },
    [tone]
  );

  return { resume, tick, reveal };
}

export default function CaseOpeningModal({ box, token, onClose, onResult, dryRun = false }) {
  // phase : preview | opening | spinning | revealed
  const [phase, setPhase] = useState("preview");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [offset, setOffset] = useState(0); // translateX de la bande
  const [spinning, setSpinning] = useState(false); // arme la transition CSS

  const trackRef = useRef(null);
  const stripRef = useRef(null);
  const revealedRef = useRef(false); // la révélation n'a lieu qu'une fois
  const sfx = useSfx();

  // Échap ferme — mais jamais pendant que la bande tourne : on ne quitte pas
  // une ouverture en cours (le lot est déjà acquis, mais le voir se poser fait
  // partie du contrat).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && phase !== "spinning" && phase !== "opening") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  async function open() {
    sfx.resume(); // l'AudioContext doit naître dans le geste utilisateur
    setError("");
    setPhase("opening");
    try {
      // Mode admin « essayer » : tirage à blanc, aucun débit ni gain.
      const url = dryRun
        ? `/arcade/admin/cases/${box.id}/try`
        : `/arcade/cases/${box.id}/open`;
      const d = await apiFetch(url, { method: "POST", token });
      setResult(d);
      setPhase("spinning");
    } catch (e) {
      setError(e.message || "Impossible d'ouvrir la caisse.");
      setPhase("preview");
    }
  }

  // Relance un essai (mode admin) : on remet la bande à zéro et on rouvre.
  function replay() {
    revealedRef.current = false;
    setResult(null);
    setSpinning(false);
    setOffset(0);
    setPhase("preview");
    setTimeout(open, 0);
  }

  // Lance la bande dès que le résultat est là et que la piste est mesurable.
  useEffect(() => {
    if (phase !== "spinning" || !result) return;
    const track = trackRef.current;
    const strip = stripRef.current;
    if (!track || !strip) return;
    const winnerEl = strip.children[result.winnerIndex];
    if (!winnerEl) return;

    // Où poser le gagnant : son centre doit tomber sur le repère central. On
    // lit sa position réelle dans la bande — aucune arithmétique à tenir
    // synchro avec le CSS. Le jitter décale l'arrêt DANS la case gagnante
    // (jamais pile au milieu) : sans lui, l'œil sent le truquage.
    const jitter = (Math.random() - 0.5) * winnerEl.offsetWidth * 0.62;
    const target =
      winnerEl.offsetLeft + winnerEl.offsetWidth / 2 - track.clientWidth / 2 + jitter;

    // Deux frames : la première pose la bande à 0 sans transition, la seconde
    // arme le glissement. Sans ça, le navigateur fusionne les deux états et
    // la bande apparaît déjà arrivée.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSpinning(true);
        setOffset(-target);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [phase, result]);

  // Le tic-tac : on lit la position RÉELLE de la bande à chaque frame et on
  // clique quand un nouveau lot passe le repère. Lire le transform calculé
  // plutôt que ré-simuler la courbe garantit que le son colle à l'image.
  useEffect(() => {
    if (!spinning || !result) return;
    const strip = stripRef.current;
    const track = trackRef.current;
    if (!strip || !track) return;
    const geo = measureStrip(strip);
    if (!geo) return;
    let raf = 0;
    let last = -1;
    const loop = () => {
      const t = getComputedStyle(strip).transform;
      if (t && t !== "none") {
        const x = new DOMMatrixReadOnly(t).m41;
        const idx = Math.round(
          (-x + track.clientWidth / 2 - geo.itemW / 2) / geo.pitch
        );
        if (idx !== last) {
          last = idx;
          sfx.tick();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [spinning, result, sfx]);

  // Passage à la révélation. Idempotent via un ref (et non un updater d'état,
  // qui rejouerait les effets en StrictMode) : la transition CSS et le filet de
  // sécurité peuvent tous deux nous appeler, seul le premier compte.
  const finish = useCallback(() => {
    if (revealedRef.current || !result) return;
    revealedRef.current = true;
    setPhase("revealed");
    sfx.reveal(result.reward.rarity);
    // Le parent met à jour solde + inventaire seulement maintenant : voir son
    // solde chuter avant le tirage vendrait la mèche.
    onResult?.(result);
  }, [result, sfx, onResult]);

  function onSpinEnd(e) {
    // L'évènement remonte depuis les lots (qui ont leurs propres transitions) :
    // on ne réagit qu'à la fin du glissement de la bande elle-même.
    if (e.target !== stripRef.current || e.propertyName !== "transform") return;
    finish();
  }

  // Filet : sans transition (prefers-reduced-motion, onglet en arrière-plan),
  // transitionend ne vient jamais et la modale resterait figée sur la bande.
  useEffect(() => {
    if (phase !== "spinning" || !result) return;
    const t = setTimeout(finish, SPIN_MS + 600);
    return () => clearTimeout(t);
  }, [phase, result, finish]);

  const reward = result?.reward;
  const color = reward ? rarityColor(reward.rarity) : null;
  const fx = fxFor(reward?.rarity);
  const revealed = phase === "revealed";
  // Regénérées à chaque ouverture (l'identité de `reward` change) : deux
  // tirages ne donnent jamais exactement la même gerbe.
  const particles = useMemo(
    () => (reward && !prefersReducedMotion() ? buildParticles(fx.particles, color) : []),
    [reward, fx.particles, color]
  );
  // Rouvrir tout de suite : en essai c'est gratuit, sinon il faut le prix.
  const canReopen = dryRun || (result?.points ?? 0) >= box.price;

  return (
    <div
      className="co-overlay"
      role="dialog"
      aria-modal="true"
      // Clic hors de la modale = fermeture, sauf pendant que la bande tourne :
      // on ne quitte pas une ouverture en cours (même règle que Échap).
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (phase === "spinning" || phase === "opening") return;
        onClose();
      }}
    >
      <div
        className={`co-modal ${revealed && fx.shake ? "shake" : ""}`}
        style={{
          ...(color ? { "--co-rarity": color } : null),
          ...(fx.shake ? { "--co-shake": fx.shake } : null),
        }}
      >
        {phase !== "spinning" && phase !== "opening" && (
          <button className="co-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        )}

        {/* ---------- APERÇU : le contenu et les chances, avant de payer ---------- */}
        {phase === "preview" || phase === "opening" ? (
          <div className="co-preview">
            <span className="co-kicker">Caisse</span>
            <h2 className="co-title">{box.name}</h2>
            {box.description && <p className="co-sub">{box.description}</p>}

            <div className="co-pool">
              {box.rewards.map((r) => (
                <div
                  className="co-pool-item"
                  key={r.id}
                  style={{ "--co-rarity": rarityColor(r.rarity) }}
                  title={`${r.name} · ${rarityLabel(r.rarity)}`}
                >
                  <span className="co-pool-art">
                    <RewardArt reward={r} size={40} />
                  </span>
                  <span className="co-pool-name">{r.name}</span>
                  <span className="co-pool-chance">{formatChance(r.chance)}</span>
                </div>
              ))}
            </div>

            {error && <p className="co-err">{error}</p>}

            <button
              className="co-open-btn clickable"
              onClick={open}
              disabled={phase === "opening" || (!dryRun && !box.openable)}
            >
              {phase === "opening" ? (
                <Loader2 size={18} className="spin" />
              ) : (
                <Sparkles size={18} />
              )}
              {dryRun ? "Essayer" : "Ouvrir"}
              {!dryRun && (
                <span className="co-price">
                  <Coins size={14} /> {box.price}
                </span>
              )}
            </button>
          </div>
        ) : null}

        {/* ---------- BOBINE + RÉVÉLATION ---------- */}
        {(phase === "spinning" || phase === "revealed") && result && (
          <div className={`co-stage ${phase === "revealed" ? "done" : ""}`}>
            <div className="co-track" ref={trackRef}>
              <span className="co-spot" aria-hidden="true" />
              <span className="co-marker" aria-hidden="true" />
              <div
                className="co-strip"
                ref={stripRef}
                style={{
                  transform: `translate3d(${offset}px, 0, 0)`,
                  transition: spinning
                    ? `transform ${SPIN_MS}ms ${SPIN_EASE}`
                    : "none",
                }}
                onTransitionEnd={onSpinEnd}
              >
                {result.reel.map((r, i) => (
                  <div
                    className="co-item"
                    key={i}
                    style={{ "--co-rarity": rarityColor(r.rarity) }}
                  >
                    <span className="co-item-art">
                      <RewardArt reward={r} size={54} />
                    </span>
                    <span className="co-item-name">{r.name}</span>
                  </div>
                ))}
              </div>
              <span className="co-fade left" aria-hidden="true" />
              <span className="co-fade right" aria-hidden="true" />
            </div>

            {phase === "revealed" && (
              <div className={`co-result r-${reward.rarity}`}>
                <span className="co-result-rarity">{rarityLabel(reward.rarity)}</span>
                <div className="co-result-art">
                  <RewardArt reward={reward} size={72} />
                </div>
                <h3 className="co-result-name">{reward.name}</h3>
                {reward.description && (
                  <p className="co-result-desc">{reward.description}</p>
                )}

                {dryRun ? (
                  <>
                    <p className="co-try-note">
                      <Sparkles size={14} /> Essai — rien n'a été dépensé ni gagné
                    </p>
                    <div className="co-result-foot">
                      <button className="co-again clickable" onClick={replay}>
                        <RotateCcw size={15} /> Relancer
                      </button>
                      <button className="co-stop clickable" onClick={onClose}>
                        Arrêter
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {result.duplicate ? (
                      <p className="co-dup">
                        <Copy size={14} /> Déjà dans ton inventaire — reconverti en{" "}
                        <b>+{result.refund}</b> points
                      </p>
                    ) : (
                      <p className="co-new">
                        <Check size={14} /> Nouveau ! Ajouté à ton inventaire
                      </p>
                    )}

                    <div className="co-result-foot">
                      <span className="co-balance">
                        <Coins size={14} /> {result.points} points
                      </span>
                      <button
                        className="co-again clickable"
                        onClick={replay}
                        disabled={!canReopen}
                        title={
                          canReopen ? "Rouvrir une caisse" : "Pas assez de points"
                        }
                      >
                        <RotateCcw size={15} /> Rouvrir
                        <span className="co-price">
                          <Coins size={13} /> {box.price}
                        </span>
                      </button>
                      <button className="co-stop clickable" onClick={onClose}>
                        Arrêter
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Couche décorative de la révélation. Sœur de la modale (et non enfant)
          pour que le tremblement, qui pose un `transform`, ne redéfinisse pas
          le référentiel de positionnement des effets. */}
      {revealed && color && (
        <div
          className="co-fx"
          aria-hidden="true"
          style={{ "--co-rarity": color }}
          key={reward.key || reward.id}
        >
          <span className="co-flash" />
          {fx.rays && <span className="co-rays" />}
          <span className="co-burst">
            {particles.map((p) => (
              <i
                key={p.id}
                className={`co-particle s${p.shape}`}
                style={{
                  "--tx": `${p.tx}px`,
                  "--ty": `${p.ty}px`,
                  "--rot": `${p.rot}deg`,
                  "--sz": `${p.size}px`,
                  "--pc": p.color,
                  animationDelay: `${p.delay}s`,
                  animationDuration: `${p.dur}s`,
                }}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
