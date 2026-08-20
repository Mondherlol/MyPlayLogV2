import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X, Coins, Loader2, RotateCcw, ArrowRight, Sparkles } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { isComic, isGame, CONSOLE, fmtYears } from "../lib/collection";
import {
  playCoinDrop,
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
//  La caisse — la coquille autour de la scène
// ======================================================================
// IL N'Y A PAS DE MODALE : la page est floutée, la caisse est POSÉE DESSUS en
// 3D. Ce fichier ne garde que la chronologie, l'aller-retour avec le serveur,
// et trois éléments d'interface — le bouton qui lance, l'invite à secouer, et
// le nom de ce qu'on a sorti.
//
// ON CLIQUE LA CAISSE, ET C'EST TOUT LE GESTE. Elle est au milieu de l'écran,
// elle s'allume quand la souris passe dessus, on clique, on paie. Le bouton du
// bas reste — il porte le prix, et un écran tactile n'a pas de survol pour
// deviner qu'un objet est cliquable — mais il n'est plus le seul chemin.
//
// TROIS TEMPS, ET PAS UN DE PLUS : elle charge (elle tremble, la couture monte
// au blanc), elle claque (le couvercle part, la lumière jaillit, les boules
// giclent), une seule boule vient à l'œil. Le reste de la volée retombe hors
// cadre — elle n'était là que pour dire « il y en avait plein ».
//
// LA BOULE NE S'OUVRE PAS TOUTE SEULE. Elle arrive fermée, et c'est le joueur
// qui la SECOUE pour la faire céder : la souris qu'on agite, le téléphone qu'on
// remue, ou des clics répétés. Pendant qu'on secoue on entend ce qu'il y a
// dedans — un boîtier claque, du papier froisse, une cartouche cogne — et la
// couture s'allume à mesure qu'on approche. C'est le seul moment où le joueur
// FAIT quelque chose, et c'est celui qu'on retient.

// LA CHRONOLOGIE, RESSERRÉE. `arm` est le temps de charge de la caisse : assez
// pour qu'on retienne son souffle (elle tremble de plus en plus fort), pas
// assez pour qu'on se demande si le clic a été pris. `fall` est le claquement
// et la volée, `rise` l'arrivée de la boule à l'œil.
//
// Le tout dure 2,1 s au lieu de 2,3 — mais surtout il ne contient plus une
// seule seconde où l'on ne fait que REGARDER une bille rouler dans un tube.
const T = { arm: 620, fall: 900, rise: 620, crack: 900 };

// Ce qu'un geste ajoute à la jauge de secouage — et donc LA DURÉE DE
// L'ÉPREUVE, qui se lit sur la différence entre ce gain et la fuite (0,20/s,
// posée côté scène dans `Clock`).
//
// CINQ SECONDES, C'ÉTAIT TROP. Le compte d'avant : 1/2400 par pixel, soit
// 0,50/s à la souris agitée franchement, moins 0,30 de fuite — cinq secondes de
// poignet. Sur le papier c'était « on a le temps d'entendre ce qu'il y a
// dedans » ; en vrai, au bout de deux secondes on a compris, et le reste est
// une corvée qu'on fait en regardant ailleurs. Le nouveau compte : 0,75/s de
// gain, 0,20 de fuite, DEUX SECONDES. Assez pour que ce soit un geste, trop
// court pour qu'on s'en lasse.
const SHAKE_PER_PX = 1 / 1600;
// Le repli au clic doit rester une vraie option : sept ou huit clics, pas
// quinze. C'est le chemin de qui joue au trackpad, ou n'a pas envie du geste.
const SHAKE_PER_CLICK = 0.16;
// Le téléphone, lui, se secoue DEUX FOIS PLUS LONGTEMPS que la souris ne
// s'agite : le geste du bras est ample et amusant, il valait la peine de durer
// (et il remplissait la jauge avant même qu'on ait senti la capsule bouger).
// Gain par secousse et plafond par évènement divisés par deux — le seuil de
// déclenchement, lui, ne bouge pas : marcher n'ouvre toujours rien.
const SHAKE_PER_G = 0.035;
const SHAKE_G_CAP = 0.07;

// Deux bruits de contenu à moins de 90 ms l'un de l'autre, ce n'est plus un
// objet qui remue : c'est un grésillement.
const RATTLE_GAP = 90;

// Le temps que met le boîtier à sortir de l'écran quand on relance. Doit rester
// égal à la durée de rangement posée côté scène (`Clock`, phase « stowing ») :
// tirer avant la fin ferait sauter l'objet, tirer trop tard laisserait un temps
// mort devant une caisse déjà revenue.
const STOW = 520;

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// LA SECONDE LIGNE DE LA CARTE, mot pour mot celle de la vitrine de l'étagère
// (`CaseInspector`, CollectionShelf.jsx). C'est le même objet présenté de la
// même façon : « Volume · 117 planches », « Game Boy Advance · PAL »,
// « Série · 24 épisodes ». La recopier ici plutôt que d'extraire la fonction
// est un choix — la vitrine peut faire évoluer sa ligne sans que la caisse
// suive, ce sont deux moments différents.
function metaOf(m) {
  const head = isComic(m)
    ? `Volume${m.pageCount ? ` · ${m.pageCount} planches` : ""}`
    : isGame(m)
      ? `${CONSOLE}${m.cartridge?.region ? ` · ${m.cartridge.region}` : ""}`
      : m.kind === "series"
        ? `Série · ${m.episodeCount} épisodes`
        : "Film";
  const years = fmtYears(m);
  return years ? `${head} · ${years}` : head;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// L'état de la scène, en une seule référence partagée. Il change à chaque
// image : le passer par React ferait ramer la 3D, et empêcherait surtout les
// mouvements de se chevaucher (voir `Clock`, côté scène).
const freshAnim = () => ({
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
  // ON RANGE L'OBJET. Il glisse vers le bas pendant que la caisse revient au
  // premier plan — c'est le mouvement de « Relancer ». Piloté à part du reste
  // parce qu'il ne suit AUCUNE étape : il se joue entre deux tirages, sur un
  // boîtier qui existe encore et une caisse qui n'est pas encore repartie.
  away: 0,
});

export default function GachaModal({ token, onClose, onDrawn }) {
  useScrollLock(true);
  const navigate = useNavigate();

  // idle | arming | falling | rising | waiting | cracking | revealed | stowing
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
        if (d > 2.2) bump(Math.min(SHAKE_G_CAP, d * SHAKE_PER_G));
      }
      prev = { x: g.x || 0, y: g.y || 0, z: g.z || 0 };
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [waiting, bump]);

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
    // Attendre la réponse pour lâcher la boule mettrait un temps mort pile là
    // où la machine doit répondre au clic — et le serveur a largement le temps
    // de répondre avant que la capsule arrive dans la main.
    setPhase("arming");
    playCoinDrop();

    const skipAll = prefersReducedMotion();
    if (skipAll) {
      // Aucun trajet à regarder : la boule est dans la main, il ne reste que le
      // secouage (et lui aussi sera abrégé plus bas, dès que la réponse est là).
      // Le déclic, lui, se joue quand même — c'est le mouvement qu'on a coupé,
      // pas le son.
      const a = anim.current;
      a.fall = 1;
      a.rise = 1;
      a.back = 1;
      playCrankRelease();
      setPhase("waiting");
    } else {
      // ELLE CHARGE, PUIS ELLE CLAQUE. Le grondement de la charge est le bruit
      // du mécanisme qui se tend ; le claquement emprunte celui d'une capsule
      // qui se fend — sec, net, un peu creux, exactement ce qu'il faut — parce
      // qu'un fichier de son de plus pour une demi-seconde ne se justifie pas.
      after(Math.max(0, T.arm - 300), playCrankRelease);
      after(T.arm, () => {
        playCapsuleCrack();
        setPhase("falling");
      });
      // La volée qui retombe, juste après le claquement.
      after(T.arm + 130, playCapsuleRoll);
      after(T.arm + T.fall, () => setPhase("rising"));
      after(T.arm + T.fall + T.rise - 120, playCapsuleLand);
      after(T.arm + T.fall + T.rise, () => setPhase("waiting"));
    }

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
  // suite. On ne saute PAS l'ouverture — c'est le geste du joueur, et c'est ce
  // qu'il est venu faire ; seul le trajet de la capsule, qu'il ne fait que
  // regarder, s'abrège.
  //
  function toHand() {
    // Ni pendant l'armement (ce sont les trois dixièmes du double clic sur
    // « Ouvrir »), ni pendant qu'on range (le boîtier est en train de sortir de
    // l'écran, l'y ramener en pleine glissade n'a aucun sens).
    if (!busy || waiting || phase === "arming" || phase === "stowing") return;
    clearTimers();
    const a = anim.current;
    a.fall = 1;
    a.rise = 1;
    a.back = 1;
    setPhase("waiting");
  }

  // RELANCER, ET LE FAIRE VOIR. Repartir sec sur un nouveau tirage faisait
  // disparaître le boîtier et réapparaître la caisse sur la même image : on
  // range donc l'objet (il glisse par le bas) pendant que la caisse revient au
  // premier plan, et le tour suivant ne part qu'après. Une demi-seconde, le
  // temps d'un geste — c'est ce qui fait la différence entre « un autre » et
  // « la page a changé ».
  function relaunch() {
    if (phase !== "revealed" || !canDraw) return;
    setPhase("stowing");
    // `draw` capturé ICI est celui du rendu « revealed », donc celui qui se
    // croit libre de tirer : le lire depuis l'état « stowing » le ferait
    // renoncer (voir `busy`).
    after(STOW, draw);
  }

  const won = result?.media || null;
  const left = result?.left ?? Math.max(0, (data?.total || 0) - (data?.owned || 0));
  const price = result?.price ?? data?.price ?? 0;
  const points = result?.points ?? data?.points ?? 0;
  const total = data?.total ?? 0;
  const complete = total > 0 && left <= 0;
  const canDraw = !complete && total > 0 && points >= price;
  const revealed = phase === "revealed";

  return createPortal(
    <div
      className={`gch-veil ${revealed ? "revealed" : ""} ${waiting ? "shaking" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Caisse de collection"
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
            // LA CAISSE EST LE BOUTON. Elle ne s'allume et ne se clique que si
            // le tirage est possible : une caisse qui appelle le clic et répond
            // « il te manque 200 points » est une porte peinte sur un mur.
            onLaunch={canDraw ? draw : undefined}
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
            {complete ? "Collection complète" : "Ouvrir la caisse"}
            {!complete && (
              <span className="gch-go-price">
                <Coins size={14} /> {fmt(price)}
              </span>
            )}
          </button>
          {data && !complete && (
            <span className={`gch-purse ${canDraw ? "" : "short"}`}>
              <Coins size={12} /> {fmt(points)}
              {canDraw && <i>clique la caisse · attrape-la pour la tourner</i>}
            </span>
          )}
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

      {/* ---------------- CE QU'ON A SORTI ----------------
          LA MÊME CARTE QUE DANS LA VITRINE DE L'ÉTAGÈRE, aux mêmes classes
          (`coll-inspect-card`) : on vient de gagner un objet, on doit le voir
          comme on le verra en le reprenant en main dans dix minutes.

          MAIS PAS LES MÊMES BOUTONS, et c'est la différence entre les deux
          moments. Devant son étagère on vient CONSULTER : on ouvre le volume,
          on lit ce qu'on en dit. Ici on vient TIRER — on regarde ce qu'on a
          eu, et la seule question est « on en refait un ? ». Ne reste donc
          qu'un chemin vers l'objet, sa fiche (qui porte de toute façon la
          lecture et la discussion), et à côté les deux issues de la séance.

          Pas de jauge « 10 / 39 » non plus : elle est sur la page qui a ouvert
          la caisse, et elle y sera encore dans trois secondes. */}
      {(revealed || phase === "stowing") && won && (
        <footer
          className={`gch-won ${posed && phase === "revealed" ? "in" : ""}`}
          style={{ "--tint": won.color || "var(--orange)" }}
        >
          <div className="coll-inspect-card">
            <div className="coll-inspect-text">
              {won.franchise && (
                <em className="coll-inspect-franchise">{won.franchise}</em>
              )}
              <strong>{won.title}</strong>
              <span className="coll-inspect-meta">{metaOf(won)}</span>
            </div>

            <div className="coll-inspect-acts">
              <button
                className="btn btn-ghost clickable"
                onClick={() => {
                  close();
                  navigate(`/collection/${won.slug}`);
                }}
              >
                <ArrowRight size={16} /> La fiche
              </button>

              {!complete && (
                <button
                  className="gch-again clickable"
                  onClick={relaunch}
                  disabled={!canDraw}
                  title={
                    canDraw
                      ? "Ranger celui-ci et rouvrir une caisse"
                      : `Il te manque ${fmt(price - points)} points`
                  }
                >
                  <RotateCcw size={15} /> Relancer
                  <span className="gch-again-price">
                    <Coins size={12} /> {fmt(price)}
                  </span>
                </button>
              )}

              <button className="gch-stop clickable" onClick={close}>
                Arrêter
              </button>
            </div>
          </div>
        </footer>
      )}

      {error && <p className="gch-oops">{error}</p>}
    </div>,
    document.body
  );
}
