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
export default function useFollowingRail({ top, bottom = 24 } = {}) {
  const [el, setEl] = useState(null);

  useEffect(() => {
    if (!el) return;
    let lastY = Math.max(0, window.scrollY);
    let rest = 0; // position de repos, en px
    let offset = 0;
    let sticky = false;

    // (Re)lit la position de repos dans le CSS : on vide d'abord notre `top`
    // en ligne, sinon on relirait notre propre valeur.
    const measure = () => {
      el.style.top = "";
      const cs = getComputedStyle(el);
      sticky = cs.position === "sticky";
      rest = top != null ? top : parseFloat(cs.top) || 76;
      offset = rest;
    };

    const clamp = (dy = 0) => {
      if (!sticky) return;
      // Plus bas que le rail peut remonter : son bas contre le bas du viewport.
      const floor = Math.min(rest, window.innerHeight - el.offsetHeight - bottom);
      offset = Math.min(rest, Math.max(floor, offset - dy));
      el.style.top = `${offset}px`;
    };

    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      const dy = y - lastY;
      lastY = y;
      clamp(dy);
    };
    // Le CSS de repos peut changer avec la largeur (media queries) : on
    // remesure avant de re-borner.
    const onResize = () => {
      measure();
      clamp();
    };

    measure();
    clamp();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // Le contenu arrive en asynchrone : la hauteur du rail change sous nos
    // pieds, il faut re-borner sans quoi il reste figé trop haut ou trop bas.
    const ro = new ResizeObserver(() => clamp());
    ro.observe(el);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      el.style.top = "";
    };
  }, [el, top, bottom]);

  return setEl;
}
