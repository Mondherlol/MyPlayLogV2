// ======================================================================
//  Les rangées qu'on fait glisser à la souris ne sélectionnent plus rien
// ======================================================================
// Rayons de l'accueil, onglets, captures, succès… le site a une bonne demi-
// douzaine de rangées qu'on fait défiler en les tirant à la souris, chacune
// avec sa propre implémentation. Aucune n'empêchait le navigateur de faire ce
// qu'il fait d'un appui suivi d'un glissé : SÉLECTIONNER le texte et les images
// traversés — d'où les jaquettes surlignées en bleu et le menu « Rechercher /
// Copier / Traduire » d'Edge qui surgit au lâcher.
//
// Plutôt que de corriger sept rangées (et d'oublier la huitième), une seule
// garde, pour tout le document :
//
//  • un appui à la souris DANS une zone qui défile horizontalement devient un
//    glissé dès que le curseur a bougé de quelques pixels, surtout en largeur ;
//  • à partir de là, la sélection en cours est effacée et `html.drag-scrolling`
//    interdit d'en commencer une autre (cf. app-02-content.css) ;
//  • le glisser-déposer natif d'une image ou d'un lien (la vignette fantôme qui
//    suit le curseur) est refusé dans ces zones — il volait le geste.
//
// Les champs de saisie gardent leur sélection, les éléments marqués
// `draggable="true"` gardent leur glisser-déposer, et le doigt n'est pas
// concerné (le défilement tactile ne sélectionne pas).

const THRESHOLD = 5;
const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

// La zone qui défile horizontalement la plus proche, s'il y en a une.
function hScroller(el) {
  for (let n = el instanceof Element ? el : el?.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") return n;
    }
  }
  return null;
}

export function installDragScrollGuard() {
  if (typeof window === "undefined" || window.__dragScrollGuard) return;
  window.__dragScrollGuard = true;

  const root = document.documentElement;
  let start = null; // { x, y } tant qu'un appui candidat est en cours
  let active = false;

  const clearSelection = () => {
    const sel = window.getSelection?.();
    if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges();
  };

  const end = () => {
    start = null;
    if (!active) return;
    active = false;
    // Au tick suivant : le clic qui suit le lâcher doit encore voir le glissé
    // (les rangées l'avalent), et la sélection ne doit pas renaître au lâcher.
    setTimeout(() => root.classList.remove("drag-scrolling"), 0);
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (e.target.closest?.(EDITABLE)) return;
      if (!hScroller(e.target)) return;
      start = { x: e.clientX, y: e.clientY };
    },
    true
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!start) return;
      if (!active) {
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx < THRESHOLD || dx < dy) return;
        active = true;
        root.classList.add("drag-scrolling");
      }
      clearSelection();
    },
    true
  );

  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", end, true);
  window.addEventListener("blur", end);

  document.addEventListener(
    "dragstart",
    (e) => {
      const t = e.target instanceof Element ? e.target : e.target?.parentElement;
      if (!t || t.closest?.('[draggable="true"]')) return;
      if (hScroller(t)) e.preventDefault();
    },
    true
  );
}
