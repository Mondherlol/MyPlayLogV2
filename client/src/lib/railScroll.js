// ======================================================================
//  Les flèches d'une rangée : une page plus loin, calée sur une carte
// ======================================================================
// ⚠️ PLUS D'AIMANTATION (`scroll-snap`) SUR LES RANGÉES. Au doigt comme à la
// souris, chaque glissé finissait « rattrapé » par la carte la plus proche :
// la rangée repartait toute seule d'un demi-cran, à contresens du geste. On
// laisse donc le défilement libre, et seules les FLÈCHES calent : elles
// avancent d'environ une largeur de rangée, puis s'arrêtent pile au début de
// la carte la plus proche — ce qui était le seul vrai intérêt de
// l'aimantation.

/**
 * Fait défiler `el` d'une « page » dans la direction `dir` (-1 ou 1), en
 * s'arrêtant au début d'un enfant.
 */
export function scrollRailBy(el, dir, ratio = 0.8) {
  if (!el) return;
  const cs = getComputedStyle(el);
  // Le bord de calage : `scroll-padding` s'il y en a un (rangées qui débordent
  // jusqu'au bord de l'écran), sinon le `padding` de la rangée.
  const pad = parseFloat(cs.scrollPaddingLeft) || parseFloat(cs.paddingLeft) || 0;
  const target = el.scrollLeft + dir * el.clientWidth * ratio;
  const base = el.getBoundingClientRect().left - el.scrollLeft;

  let best = target;
  let bestDist = Infinity;
  for (const child of el.children) {
    if (!child.offsetWidth) continue;
    const left = child.getBoundingClientRect().left - base - pad;
    const dist = Math.abs(left - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = left;
    }
  }
  // On avance toujours dans le sens demandé, même d'une seule carte.
  if (dir > 0 && best <= el.scrollLeft + 1) best = target;
  if (dir < 0 && best >= el.scrollLeft - 1) best = target;

  const max = el.scrollWidth - el.clientWidth;
  el.scrollTo({ left: Math.max(0, Math.min(max, best)), behavior: "smooth" });
}
