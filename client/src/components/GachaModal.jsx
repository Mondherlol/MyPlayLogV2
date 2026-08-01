import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X, Coins, Loader2, RotateCcw, ArrowRight, Sparkles } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import {
  playCoinDrop,
  playCrankNotch,
  playCrankRelease,
  playCapsuleRoll,
  playCapsuleLand,
  playCapsuleCrack,
  playRattle,
  playGachaReveal,
  playGachaComplete,
} from "../lib/sfx";

// La scène fait descendre three.js, R3F et drei : elle n'arrive qu'au moment
// où l'on ouvre la machine, jamais avec la page qui porte le bouton.
const GachaScene = lazy(() => import("./GachaScene"));

// ======================================================================
//  La machine à capsules — la coquille autour de la scène
// ======================================================================
// IL N'Y A PAS DE MODALE : la page est floutée, la machine est POSÉE DESSUS en
// 3D. Ce fichier ne garde que la chronologie, l'aller-retour avec le serveur,
// et trois éléments d'interface — le bouton qui lance, l'invite à secouer, et
// le nom de ce qu'on a sorti.
//
// LA BOULE NE S'OUVRE PAS TOUTE SEULE. Elle arrive dans la main, fermée, et
// c'est le joueur qui la SECOUE pour la faire céder : la souris qu'on agite, le
// téléphone qu'on remue, ou des clics répétés. Pendant qu'on secoue on entend
// ce qu'il y a dedans — un boîtier claque, du papier froisse, une cartouche
// cogne — et la couture s'allume à mesure qu'on approche. C'est le seul moment
// où le joueur FAIT quelque chose, et c'est celui qu'on retient.

const T = { fall: 1250, rise: 700, crack: 900 };

// LA SPHÈRE NE TOURNE PAS TOUTE SEULE — mais elle ne doit jamais coincer la
// séance non plus. Passé ce délai sans qu'on y touche, le mécanisme se
// débloque de lui-même : le boîtier est déjà payé et acquis côté serveur, et
// laisser quelqu'un devant une machine qui ne répond pas (souris capricieuse,
// clavier seulement, geste pas compris) serait le pire des dénouements.
const CRANK_PATIENCE = 7000;

// Ce qu'un geste ajoute à la jauge de secouage — et donc LA DURÉE DE
// L'ÉPREUVE, qui se lit sur la différence entre ce gain et la fuite de 0,30/s
// posée côté scène (`Clock`).
//
// Le compte : on agite une souris à ~1200 px/s ; à 1/2400 ça remplit 0,50/s,
// moins 0,30 de fuite = 0,20/s net, soit CINQ SECONDES d'agitation franche.
// C'était trois avant, et trois ne se sentait pas — on a le temps d'entendre
// ce qu'il y a dans la boule et de la voir cogner, ce qui est tout l'intérêt.
const SHAKE_PER_PX = 1 / 2400;
const SHAKE_PER_CLICK = 0.09;
const SHAKE_PER_G = 0.04;

// Deux bruits de contenu à moins de 90 ms l'un de l'autre, ce n'est plus un
// objet qui remue : c'est un grésillement.
const RATTLE_GAP = 90;

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// L'état de la scène, en une seule référence partagée. Il change à chaque
// image : le passer par React ferait ramer la 3D, et empêcherait surtout les
// mouvements de se chevaucher (voir `Clock`, côté scène).
const freshAnim = () => ({
  crank: 0,
  shake: 0,
  capsule: 0,
  fall: 0,
  rise: 0,
  back: 0,
  crack: 0,
  rattle: 0,
  spinY: 0,
  spinX: 0,
  zoom: 1,
  zoomView: 1,
  free: false,
  touched: 0,
});

export default function GachaModal({ token, onClose, onDrawn }) {
  useScrollLock(true);
  const navigate = useNavigate();

  // idle | cranking | falling | rising | waiting | cracking | revealed
  const [phase, setPhase] = useState("idle");
  const [data, setData] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [posed, setPosed] = useState(false);
  // Uniquement pour animer l'anneau de progression du secouage : il change à
  // chaque geste, pas à chaque image.
  const [heat, setHeat] = useState(0);
  // La teinte de la CAPSULE, tirée au sort à chaque tour. Elle n'a rien à voir
  // avec le boîtier qui est dedans — sinon toutes les boules se ressemblent
  // (les jaquettes tirent vers les mêmes tons) et, pire, la couleur vendrait la
  // mèche avant l'ouverture.
  const [hue, setHue] = useState(() => Math.floor(Math.random() * 360));

  const anim = useRef(freshAnim());
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const timers = useRef([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms));

  const resultRef = useRef(null);
  resultRef.current = result;
  const done = useRef(false);
  const crackAt = useRef(0);
  const lastRattle = useRef(0);

  useEffect(() => () => clearTimers(), []);

  const load = useCallback(() => {
    apiFetch("/collection/gacha", { token })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);
  useEffect(load, [load]);

  const busy = phase !== "idle" && phase !== "revealed";
  const waiting = phase === "waiting";

  const close = useCallback(() => {
    clearTimers();
    onClose();
  }, [onClose]);
  useBackClose(close, "gacha");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, close]);

  // LE SEUL ENDROIT QUI APPLIQUE LE RÉSULTAT. Il recale le dôme au passage : la
  // boule gagnée quitte le tas, le compteur avance, le solde suit — sans quoi
  // « Relancer » repartirait sur l'état d'avant.
  const reveal = useCallback(() => {
    const res = resultRef.current;
    if (!res || done.current) return;
    done.current = true;
    if (!res.media) {
      setError("Le boîtier est à toi, mais sa fiche n'a pas suivi.");
      setPhase("idle");
      onDrawn?.(res);
      return;
    }
    setPhase("revealed");
    if (res.left <= 0) playGachaComplete();
    else playGachaReveal();
    setData((d) =>
      d
        ? {
            ...d,
            points: res.points,
            owned: res.owned,
            balls: d.balls.map((b) =>
              b.slug === res.media?.slug ? { ...b, owned: true } : b
            ),
          }
        : d
    );
    onDrawn?.(res);
  }, [onDrawn]);

  const crackOpen = useCallback(() => {
    if (phaseRef.current === "cracking" || phaseRef.current === "revealed") return;
    clearTimers();
    setPhase("cracking");
    playCapsuleCrack();
  }, []);

  // L'ouverture dure `T.crack` À PARTIR DE SON DÉBUT : une réponse lente ne
  // doit pas ajouter une ouverture entière à une attente déjà sensible.
  useEffect(() => {
    if (!result || phase !== "cracking") return undefined;
    const spent = performance.now() - (crackAt.current || performance.now());
    const t = setTimeout(reveal, Math.max(0, T.crack - spent));
    return () => clearTimeout(t);
  }, [result, phase, reveal]);

  useEffect(() => {
    if (phase === "cracking") crackAt.current = performance.now();
  }, [phase]);

  // ---------------------------------------------------------- secouer --
  //
  // Toute l'énergie passe par ici, d'où qu'elle vienne (souris, doigt,
  // accéléromètre, clic). Un seul endroit qui fasse le bruit du contenu, un
  // seul qui décide que ça a cédé.
  const bump = useCallback(
    (force) => {
      if (phaseRef.current !== "waiting" || !force) return;
      const a = anim.current;
      a.rattle = Math.min(1, a.rattle + force);
      setHeat(a.rattle);
      const now = performance.now();
      if (now - lastRattle.current > RATTLE_GAP) {
        lastRattle.current = now;
        // Ce qu'on entend est ce qu'il y a DEDANS : le serveur a déjà répondu,
        // on connaît la nature du boîtier avant même de l'avoir vu.
        playRattle(resultRef.current?.media?.kind || "film", 0.35 + a.rattle * 0.65);
      }
      if (a.rattle >= 1) crackOpen();
    },
    [crackOpen]
  );

  // Le geste à la souris / au doigt : on compte la DISTANCE parcourue, pas les
  // évènements — bouger vite et bouger beaucoup sont la même chose, alors que
  // compter les évènements récompenserait les souris à haute fréquence.
  const lastPt = useRef(null);
  const onMove = useCallback(
    (e) => {
      if (phaseRef.current !== "waiting") return;
      const p = lastPt.current;
      lastPt.current = { x: e.clientX, y: e.clientY };
      if (!p) return;
      bump(Math.hypot(e.clientX - p.x, e.clientY - p.y) * SHAKE_PER_PX);
    },
    [bump]
  );

  // Le téléphone qu'on remue. On mesure la VARIATION d'accélération et non sa
  // valeur : sinon la gravité, qui vaut 9,8 en permanence, ouvrirait la boule
  // toute seule sur un appareil posé à plat.
  useEffect(() => {
    if (!waiting || typeof window === "undefined" || !window.DeviceMotionEvent)
      return undefined;
    let prev = null;
    const onMotion = (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g) return;
      if (prev) {
        const d = Math.hypot((g.x || 0) - prev.x, (g.y || 0) - prev.y, (g.z || 0) - prev.z);
        // Seuil : marcher avec son téléphone ne doit pas ouvrir la capsule.
        if (d > 2.2) bump(Math.min(0.14, d * SHAKE_PER_G));
      }
      prev = { x: g.x || 0, y: g.y || 0, z: g.z || 0 };
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [waiting, bump]);

  // ------------------------------------------------- tourner la manivelle --

  // Un cran franchi : le rochet claque, et il durcit vers la fin du tour.
  const notch = useCallback((p) => playCrankNotch(p), []);

  // LE TOUR EST FAIT — le mécanisme lâche sa boule, et la suite s'enchaîne.
  // Appelé par la manivelle quand on l'a tournée en entier, ou par le filet de
  // sécurité si personne ne l'a touchée.
  const release = useCallback(() => {
    if (phaseRef.current !== "cranking") return;
    clearTimers();
    const a = anim.current;
    a.crank = 1;
    a.shake = 1; // la machine encaisse le déclic
    playCrankRelease();

    if (prefersReducedMotion()) {
      a.fall = 1;
      a.rise = 1;
      a.back = 1;
      setPhase("waiting");
      return;
    }
    setPhase("falling");
    after(120, playCapsuleRoll);
    after(T.fall - 150, playCapsuleLand);
    after(T.fall, () => setPhase("rising"));
    after(T.fall + T.rise, () => setPhase("waiting"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ tirer --

  async function draw() {
    if (busy) return;
    clearTimers();
    setError("");
    setResult(null);
    resultRef.current = null;
    done.current = false;
    crackAt.current = 0;
    setPosed(false);
    setHeat(0);
    // Une couleur qui n'est pas la précédente : deux boules identiques d'affilée
    // donneraient l'impression que la teinte ne veut rien dire (elle ne veut
    // effectivement rien dire, mais ça ne doit pas SE VOIR).
    setHue((h) => (h + 90 + Math.floor(Math.random() * 180)) % 360);
    anim.current = freshAnim();

    // LA SCÈNE PART TOUT DE SUITE, la requête aussi : elles courent ensemble.
    // Attendre la réponse pour tourner la manivelle mettrait un temps mort pile
    // là où le geste doit répondre au doigt — et le serveur a largement le
    // temps de répondre avant que la boule arrive dans la main.
    setPhase("cranking");
    playCoinDrop();

    const skipAll = prefersReducedMotion();
    // La suite n'est PAS lancée ici : c'est la manivelle qui la déclenche
    // (`release`). On n'arme que le filet de sécurité — et en mouvement réduit,
    // où l'on ne demande aucun geste, on la tourne pour l'utilisateur.
    if (skipAll) after(0, release);
    else after(CRANK_PATIENCE, release);

    try {
      const d = await apiFetch("/collection/gacha/draw", { method: "POST", token });
      resultRef.current = d;
      setResult(d);
      if (skipAll) {
        setPhase("cracking");
        reveal();
      }
    } catch (e) {
      clearTimers();
      setError(e.message || "La machine s'est enrayée.");
      setPhase("idle");
      anim.current = freshAnim();
      load();
    }
  }

  // SAUTER LA MISE EN SCÈNE. Au vingtième tour, ce qu'on adorait la première
  // fois devient une attente : un clic pose la boule dans la main tout de
  // suite. On ne saute NI la manivelle NI l'ouverture — ce sont les deux gestes
  // du joueur, et c'est ce qu'il est venu faire ; seule la chute, qu'il ne fait
  // que regarder, s'abrège.
  function toHand() {
    if (!busy || waiting || phase === "cranking") return;
    clearTimers();
    const a = anim.current;
    a.crank = 1;
    a.fall = 1;
    a.rise = 1;
    a.back = 1;
    a.shake = 0;
    setPhase("waiting");
  }

  const won = result?.media || null;
  const left = result?.left ?? Math.max(0, (data?.total || 0) - (data?.owned || 0));
  const price = result?.price ?? data?.price ?? 0;
  const points = result?.points ?? data?.points ?? 0;
  const owned = result?.owned ?? data?.owned ?? 0;
  const total = data?.total ?? 0;
  const complete = total > 0 && left <= 0;
  const canDraw = !complete && total > 0 && points >= price;
  const revealed = phase === "revealed";

  return createPortal(
    <div
      className={`gch-veil ${revealed ? "revealed" : ""} ${waiting ? "shaking" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Machine à capsules"
      onPointerMove={onMove}
      onPointerDown={(e) => {
        // Pendant l'attente, chaque clic secoue un peu : c'est le repli pour
        // qui ne comprend pas le geste, ou n'a pas envie de le faire.
        if (waiting) {
          bump(SHAKE_PER_CLICK);
          return;
        }
        if (busy) toHand();
        else if (e.target === e.currentTarget && !revealed) close();
      }}
    >
      <Suspense
        fallback={
          <div className="gch-wait">
            <Loader2 size={26} className="spin" />
          </div>
        }
      >
        {data && (
          <GachaScene
            phase={phase}
            balls={data.balls}
            won={won}
            hue={hue}
            anim={anim}
            onNotch={notch}
            onRelease={release}
            onSettled={() => setPosed(true)}
          />
        )}
      </Suspense>

      <button className="gch-x clickable" onClick={close} aria-label="Fermer">
        <X size={20} />
      </button>

      {/* ---------------- LANCER ----------------
          Un vrai bouton, gros, au centre en bas : la première version comptait
          sur un clic dans la machine et « y a pas de bouton lancer pour 500 »
          était la première chose qu'on remarquait. */}
      {!revealed && !busy && (
        <div className="gch-launch">
          <button
            className="gch-go clickable"
            onClick={draw}
            disabled={!canDraw || !data}
            title={
              complete
                ? "Tu as déjà tous les boîtiers"
                : canDraw
                  ? undefined
                  : `Il te manque ${fmt(price - points)} points`
            }
          >
            <Sparkles size={18} />
            {complete ? "Collection complète" : "Lancer"}
            {!complete && (
              <span className="gch-go-price">
                <Coins size={14} /> {fmt(price)}
              </span>
            )}
          </button>
          {data && !complete && (
            <span className={`gch-purse ${canDraw ? "" : "short"}`}>
              <Coins size={12} /> {fmt(points)}
            </span>
          )}
        </div>
      )}

      {/* ---------------- TOURNE ----------------
          La machine est payée et armée : plus rien ne se passe tant qu'on n'a
          pas tourné. L'anneau d'or qui bat autour de la sphère est l'invite,
          ces deux lignes sont la confirmation qu'on ne s'est pas trompé
          d'écran. */}
      {phase === "cranking" && (
        <div className="gch-shake">
          <span className="gch-turn-ic" aria-hidden="true">
            <RotateCcw size={22} />
          </span>
          <b>Fais tourner la sphère</b>
          <em>attrape-la et fais-lui faire un tour complet</em>
        </div>
      )}

      {/* ---------------- SECOUE ----------------
          L'anneau se remplit à mesure qu'on agite ; la couture de la boule
          s'allume en même temps dans la scène. Deux jauges pour un seul geste,
          l'une sur l'objet, l'autre sous la main. */}
      {waiting && (
        <div className="gch-shake" style={{ "--heat": heat }}>
          <span className="gch-shake-ring" aria-hidden="true">
            <svg viewBox="0 0 44 44">
              <circle className="track" cx="22" cy="22" r="19" />
              <circle
                className="fill"
                cx="22"
                cy="22"
                r="19"
                style={{ strokeDashoffset: 119.4 * (1 - heat) }}
              />
            </svg>
            <i />
          </span>
          <b>Secoue&nbsp;!</b>
          <em>agite la souris, ton téléphone, ou clique</em>
        </div>
      )}

      {/* ---------------- CE QU'ON A SORTI ---------------- */}
      {revealed && won && (
        <div className={`gch-won ${posed ? "in" : ""}`}>
          {won.franchise && <em>{won.franchise}</em>}
          <h2>{won.title}</h2>

          <span className="gch-bar" aria-label={`${owned} sur ${total}`}>
            <i style={{ width: total ? `${(owned / total) * 100}%` : 0 }} />
          </span>
          <span className="gch-count">
            {fmt(owned)} <s>/</s> {fmt(total)}
          </span>

          <div className="gch-acts">
            {!complete && (
              <button
                className="gch-round clickable"
                onClick={draw}
                disabled={!canDraw}
                aria-label="Relancer"
                title={canDraw ? "Relancer" : `Il te manque ${fmt(price - points)} points`}
              >
                <RotateCcw size={19} />
              </button>
            )}
            <button
              className="gch-round clickable"
              onClick={() => {
                close();
                navigate(`/collection/${won.slug}`);
              }}
              aria-label="Voir la fiche"
              title="Voir la fiche"
            >
              <ArrowRight size={19} />
            </button>
          </div>
        </div>
      )}

      {error && <p className="gch-oops">{error}</p>}
    </div>,
    document.body
  );
}
