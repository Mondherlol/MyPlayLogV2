// ======================================================================
//  Pas de survol pendant que la page défile
// ======================================================================
// La souris reste immobile, mais la page glisse dessous : chaque jaquette qui
// passe sous le curseur prend puis perd son `:hover`, et lance au passage ses
// transitions (relevé, ombre, zoom, voile…) ; une rangée survolée fait même
// recalculer tout son contenu. Mesuré sur l'accueil : c'était l'essentiel du
// travail du navigateur au défilement.
//
// Tant que la page défile, un voile transparent couvre l'écran : c'est lui qui
// est « survolé », et plus rien dessous ne bouge. Il s'efface 150 ms après le
// dernier cran de molette. La molette, elle, traverse : le voile ne défile pas,
// donc le défilement passe à la page.
//
// ⚠️ PAS DE `pointer-events: none` SUR LE CONTENU. La propriété s'hérite : la
// poser sur `#root` recalculait les styles de TOUTE la page à chaque début et
// fin de défilement — pire que le mal. Le voile, lui, est un seul élément.
//
// Seulement sur un appareil à souris (au doigt, il n'y a pas de survol), et
// seulement pour le défilement de LA PAGE : une rangée qu'on tire à la souris
// garde ses évènements.

const IDLE_MS = 150;

export function installScrollHoverGuard() {
  if (typeof window === "undefined" || !window.matchMedia?.("(hover: hover)").matches) return;
  let shield = null;
  let timer = null;
  const settle = () => {
    timer = null;
    shield.style.display = "none";
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!shield) {
        shield = document.createElement("div");
        shield.setAttribute("aria-hidden", "true");
        shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:none";
        document.body.appendChild(shield);
      }
      if (timer) clearTimeout(timer);
      else shield.style.display = "block";
      timer = setTimeout(settle, IDLE_MS);
    },
    { passive: true }
  );
}
