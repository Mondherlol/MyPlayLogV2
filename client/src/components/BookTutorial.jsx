import { useCallback, useEffect, useState } from "react";
import { Check, MousePointer2 } from "lucide-react";

// ======================================================================
//  La première fois qu'on ouvre un volume — les cinq gestes, et c'est tout
// ======================================================================
// UN TUTORIEL QUI SE VALIDE AU GESTE, PAS AU BOUTON « SUIVANT ». Une étape ne
// passe que quand on a VRAIMENT fait ce qu'elle demande : on n'a donc pas lu
// cinq écrans, on a tourné une page, on s'est approché, on a défilé, on a
// reculé, on a repris la main. À la fin, la main sait faire — ce qu'aucune
// légende posée sous le volume n'obtient (c'est d'ailleurs celle qu'on a
// retirée).
//
// TROIS RÈGLES POUR NE PAS ÊTRE PÉNIBLE.
//   • Il ne bloque RIEN. Le panneau ne prend pas le clic (`pointer-events`),
//     seul son « Passer » le prend : on peut lire par-dessus, l'ignorer, faire
//     les gestes dans le désordre.
//   • Il ne revient JAMAIS. Une fois vu (ou passé), c'est écrit dans le
//     navigateur et le sujet est clos.
//   • Il tient en une ligne par étape. Si une consigne demande deux phrases,
//     c'est le geste qui est mauvais, pas le texte.

const SEEN_KEY = "mpl_b3d_tuto";

// « Déjà vu ? » — et en cas de navigation privée on répond OUI : mieux vaut ne
// pas montrer un tutoriel que le remontrer à chaque ouverture.
export function tutorialSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* navigation privée : il se remontrera, tant pis */
  }
}

// Les six gestes, dans l'ordre où l'on s'en sert VRAIMENT — et non dans celui
// où ils sont écrits dans le code. On tourne d'abord (c'est un livre), on
// s'approche ensuite (c'est petit), puis on LIT : et lire, c'est la flèche
// gauche/droite, pas la molette ni le défilement. Le haut/bas ne vient qu'après,
// pour ce qu'il est — un rattrapage. On recule pour admirer, on reprend la main.
//
// `done` lit l'état réel du lecteur : aucune étape ne peut être validée par
// erreur, et aucune ne peut l'être sans avoir eu lieu.
//
// `allow` est ce que le lecteur laisse passer PENDANT cette étape, et rien
// d'autre. Un tutoriel qu'on peut quitter par le côté n'apprend rien : on tape
// une touche au hasard, il ne se passe pas ce qui est écrit, et on décroche.
const STEPS = [
  {
    key: "turn",
    keys: ["←", "→"],
    also: "ou attrape-la à la souris",
    title: "Tourne une page",
    line: "Elle se tire, comme une vraie.",
    cheer: "Et voilà.",
    allow: ["turn"],
    done: (s) => s.turned,
  },
  {
    key: "guide",
    keys: ["Espace"],
    title: "Approche-toi",
    line: "La caméra se cale sur la page et suit ta lecture.",
    cheer: "Installé.",
    allow: ["guide"],
    done: (s) => s.guided,
  },
  {
    key: "read",
    keys: ["←", "→"],
    title: "Lis",
    line: "Une hauteur d'écran, la page d'à côté, puis la suivante.",
    cheer: "C'est tout le geste.",
    allow: ["advance"],
    // QUATRE FOIS, ET PAS UNE. Un seul appui ne montre que le premier tiers du
    // geste — la caméra descend d'un cran dans la page — et on repart en
    // croyant que c'est tout ce que fait cette touche. Il en faut quatre pour
    // voir la suite : le bas de la page, la page d'à côté, puis la feuille qui
    // tourne. C'est là qu'on comprend qu'il n'y a rien d'autre à apprendre.
    times: 4,
    count: (s) => s.advanced || 0,
    done: (s) => (s.advanced || 0) >= 4,
  },
  {
    key: "scroll",
    keys: ["↑", "↓"],
    also: "maintiens pour dérouler",
    title: "Ajuste",
    line: "Par petits pas, pour rattraper une bulle coupée.",
    cheer: "Ça déroule.",
    allow: ["scroll"],
    done: (s) => s.scrolled,
  },
  {
    key: "fill",
    keys: ["Espace"],
    title: "Prends du recul",
    line: "La double page en entier, le temps de l'admirer.",
    cheer: "Joli, non ?",
    allow: ["fill"],
    done: (s) => s.filled,
  },
  {
    key: "free",
    keys: ["Échap"],
    also: "et la molette pour zoomer",
    title: "Reprends la main",
    line: "Le volume se repose à plat. Une seconde fois, il se referme.",
    cheer: "Bonne lecture.",
    allow: ["escape"],
    done: (s) => s.freed,
  },
];

// Le temps qu'on laisse au « c'est ça » avant d'enchaîner. Assez pour qu'on
// voie qu'on a réussi, trop court pour qu'on attende.
const CHEER_MS = 800;

export default function BookTutorial({ state, onGate, onDone }) {
  const [step, setStep] = useState(0);
  const [hit, setHit] = useState(false); // l'étape vient d'être réussie

  const finish = useCallback(() => {
    markSeen();
    onGate(null); // le lecteur reprend tous ses gestes
    onDone();
  }, [onGate, onDone]);

  // CE QUE LE LECTEUR LAISSE PASSER, étape par étape. Pendant la félicitation on
  // ferme tout : le geste vient d'être fait, le répéter pendant qu'on le
  // félicite ferait sauter deux pages d'un coup.
  //
  // ET LE PORTILLON SE ROUVRE SI CE COMPOSANT DISPARAÎT, quelle qu'en soit la
  // raison — le lecteur qui attend une planche, par exemple, le démonte le temps
  // du chargement. Sans ce nettoyage, il resterait bridé sur une étape que plus
  // personne n'affiche : un lecteur qui ne répond plus, et aucun moyen de
  // comprendre pourquoi.
  useEffect(() => {
    onGate(hit ? [] : STEPS[step]?.allow || null);
    return () => onGate(null);
  }, [step, hit, onGate]);

  // L'ÉTAPE SE VALIDE TOUTE SEULE. On regarde l'état du lecteur à chaque rendu :
  // dès qu'il porte la preuve du geste, on félicite.
  useEffect(() => {
    if (hit || step >= STEPS.length) return;
    if (STEPS[step].done(state)) setHit(true);
  }, [state, step, hit]);

  // ...ET C'EST UN AUTRE EFFET QUI ENCHAÎNE, à n'écouter QUE la félicitation.
  //
  // Les deux tenaient dans un seul, et il se sabotait lui-même : `state` est un
  // objet neuf à chaque rendu du lecteur, donc l'effet se refaisait sans arrêt —
  // et se refaire, pour un effet, c'est d'abord passer son NETTOYAGE. Le
  // `clearTimeout` tombait ainsi sur le minuteur qu'on venait d'armer, une
  // fraction de seconde plus tôt, dans le rendu déclenché par `setHit`. Le
  // tutoriel affichait « Et voilà. » et s'arrêtait là, pour toujours.
  //
  // Ici la seule dépendance est `hit` : le minuteur n'est nettoyé que lorsque la
  // félicitation se termine (ou que le lecteur se ferme), ce qui est exactement
  // ce qu'on veut annuler.
  useEffect(() => {
    if (!hit) return undefined;
    const t = setTimeout(() => {
      setHit(false);
      setStep((n) => n + 1);
    }, CHEER_MS);
    return () => clearTimeout(t);
  }, [hit]);

  useEffect(() => {
    if (step >= STEPS.length) finish();
  }, [step, finish]);

  const now = STEPS[step];
  if (!now) return null;

  return (
    <aside className={`b3d-tuto ${hit ? "hit" : ""}`} role="note">
      <div className="b3d-tuto-rail" aria-hidden="true">
        {STEPS.map((s, i) => (
          <i key={s.key} className={i < step ? "done" : i === step ? "now" : ""} />
        ))}
      </div>

      {/* LA `KEY` PORTE L'ANIMATION. Elle change à chaque étape ET au passage en
          félicitation : React remonte donc le bloc, ce qui relance l'entrée et
          ramène l'œil dessus sans qu'on ait à le lui dire. */}
      <div className="b3d-tuto-keys" key={`${now.key}${hit ? "-ok" : ""}`}>
        {hit ? (
          <span className="b3d-tuto-ok">
            <Check size={20} strokeWidth={3} />
          </span>
        ) : (
          now.keys.map((k) => (
            <kbd key={k} className={k.length > 2 ? "wide" : ""}>
              {k}
            </kbd>
          ))
        )}
      </div>

      <div className="b3d-tuto-text" key={`t${now.key}${hit ? "-ok" : ""}`}>
        <strong>
          {hit ? now.cheer : now.title}
          {/* COMBIEN IL EN RESTE. Une étape qui demande quatre appuis et n'en
              montre aucun compte donne l'impression de ne pas répondre : on
              appuie, il ne se passe « rien », on essaie autre chose. Les pastilles
              se remplissent, et l'appui suivant devient évident. */}
          {!hit && now.times > 1 && (
            <span className="b3d-tuto-times" aria-hidden="true">
              {Array.from({ length: now.times }, (_, i) => (
                <i key={i} className={i < now.count(state) ? "on" : ""} />
              ))}
            </span>
          )}
        </strong>
        {!hit && (
          <span>
            {now.line}
            {now.also && (
              <em>
                {now.key === "turn" && <MousePointer2 size={11} />}
                {now.also}
              </em>
            )}
          </span>
        )}
      </div>

      <button type="button" className="b3d-tuto-skip clickable" onClick={finish}>
        Passer
      </button>
    </aside>
  );
}
