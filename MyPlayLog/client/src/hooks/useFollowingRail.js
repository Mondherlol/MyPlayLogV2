import { useEffect, useState } from "react";

// Rail latéral « qui suit le scroll » : il défile avec la page jusqu'à montrer
// son dernier widget, puis se fige là ; et dès qu'on remonte, il redescend
// vers son haut (comme les navbars qui réapparaissent au scroll vers le haut).
// Le rail doit être en `position: sticky` : on ne fait que piloter son `top`,
// qu'on déplace à l'inverse du scroll entre sa position de repos (haut visible)
// et la valeur qui aligne son bas sur le bas du viewport. Sans effet si le rail
// tient déjà à l'écran, ni s'il n'est pas sticky (mobile : le CSS le repasse en
// statique et on ne touche à rien).
//
// Renvoie une ref à poser sur le rail : c'est une callback ref, donc l'effet
// s'accroche dès que l'élément apparaît (page encore en chargement, colonne
// affichée sous condition…) et se détache quand il disparaît.
//
// `top` : position de repos. Par défaut celle du CSS — utile quand elle dépend
// de media queries ou de la hauteur de la barre du haut ; 76 en repli si le CSS
// laisse `top: auto`.
//
// Perf : le gestionnaire de scroll ne fait QUE cumuler un delta. Les mesures
// (hauteur du rail, du viewport) sont mises en cache et rafraîchies par le
// ResizeObserver / l'événement resize, et l'écriture du `top` est repoussée
// dans une frame d'animation. Sans ça, chaque événement de scroll lisait
// `offsetHeight` puis écrivait un style : un aller-retour de layout forcé par
// événement, sur une page aussi longue que le fil d'actualité.
export default function useFollowingRail({ top, bottom = 24 } = {}) {
  const [el, setEl] = useState(null);

  useEffect(() => {
    if (!el) return;
    let lastY = Math.max(0, window.scrollY);
    let rest = 0; // position de repos, en px
    let offset = 0;
    let sticky = false;
    let railH = 0; // hauteur du rail, tenue à jour par le ResizeObserver
    let viewH = window.innerHeight;
    let pendingDy = 0; // scroll accumulé depuis la dernière frame
    let applied = null; // dernier `top` réellement écrit (évite les écritures inutiles)
    let frame = 0;

    // (Re)lit la position de repos dans le CSS : on vide d'abord notre `top`
    // en ligne, sinon on relirait notre propre valeur.
    const measure = () => {
      el.style.top = "";
      const cs = getComputedStyle(el);
      sticky = cs.position === "sticky";
      rest = top != null ? top : parseFloat(cs.top) || 76;
      offset = rest;
      applied = null;
      railH = el.offsetHeight;
      viewH = window.innerHeight;
    };

    const write = () => {
      frame = 0;
      const dy = pendingDy;
      pendingDy = 0;
      if (!sticky) return;
      // Plus bas que le rail peut remonter : son bas contre le bas du viewport.
      const floor = Math.min(rest, viewH - railH - bottom);
      offset = Math.min(rest, Math.max(floor, offset - dy));
      const px = Math.round(offset);
      if (px === applied) return;
      applied = px;
      el.style.top = `${px}px`;
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };

    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      pendingDy += y - lastY;
      lastY = y;
      if (sticky) schedule();
    };
    // Le CSS de repos peut changer avec la largeur (media queries) : on
    // remesure avant de re-borner.
    const onResize = () => {
      measure();
      schedule();
    };

    measure();
    schedule();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // Le contenu arrive en asynchrone : la hauteur du rail change sous nos
    // pieds, il faut re-borner sans quoi il reste figé trop haut ou trop bas.
    // On lit la hauteur DANS l'entrée observée : aucun accès au layout ici.
    const ro = new ResizeObserver(([entry]) => {
      railH = entry?.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      schedule();
    });
    ro.observe(el);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      el.style.top = "";
    };
  }, [el, top, bottom]);

  return setEl;
}
