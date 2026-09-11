import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";

// ======================================================================
//  Le rayon : un titre, et une rangée qui défile
// ======================================================================
// C'est la brique de toute la page d'accueil. Elle vient du téléphone
// (myplaylog-mobile/src/components/home/Section.jsx) et garde exactement la
// même grammaire visuelle :
//
//   • une ÉTIQUETTE en petites capitales dorées (ce que c'est) ;
//   • le titre en grand (ce qu'il contient) ;
//   • une ligne d'appoint, facultative (pourquoi c'est là).
//
// C'est ce décrochage à deux étages qui donne à l'accueil son rythme de
// magazine — un seul niveau de titre, répété douze fois, donne une liste de
// dossiers.

/**
 * L'en-tête d'un rayon.
 *
 * ⚠️ `cover` N'EST PAS UNE DÉCORATION. Sur « Parce que tu as adoré … », le
 * titre du rayon EST le nom d'un jeu — et un nom de jeu au milieu d'une page de
 * noms de jeux ne se distingue de rien. La jaquette, elle, dit en un coup d'œil
 * DUQUEL on parle, ce qui est toute la promesse de la section.
 */
export function SectionHead({
  kicker,
  title,
  hint,
  cover,
  titleTo,
  onRefresh,
  refreshLabel,
  moreTo,
  moreLabel = "Tout voir",
}) {
  const inner = (
    <>
      {!!cover && <img className="mh-head-cover" src={cover} alt="" loading="lazy" />}
      <span className="mh-head-text">
        {!!kicker && <span className="mh-kicker">{kicker}</span>}
        <span className="mh-head-title">{title}</span>
        {!!hint && <span className="mh-head-hint">{hint}</span>}
      </span>
    </>
  );

  return (
    <div className="mh-head">
      {titleTo ? (
        <Link to={titleTo} className="mh-head-main clickable">
          {inner}
        </Link>
      ) : (
        <div className="mh-head-main">{inner}</div>
      )}

      {!!onRefresh && <RefreshButton onPress={onRefresh} label={refreshLabel} />}

      {!!moreTo && (
        <Link to={moreTo} className="mh-head-more clickable">
          {moreLabel} <ChevronRight size={15} />
        </Link>
      )}
    </div>
  );
}

/**
 * « Montre-m'en d'autres ».
 *
 * ⚠️ IL TOURNE, ET CE N'EST PAS QUE JOLI. Le contenu qu'il change est un rail
 * d'affiches : si rien ne bouge à l'appui, on ne sait pas si le geste a été
 * pris — surtout quand les jeux proposés se ressemblent.
 */
function RefreshButton({ onPress, label = "Actualiser" }) {
  const [spin, setSpin] = useState(0);
  return (
    <button
      className="mh-head-refresh clickable"
      title={label}
      aria-label={label}
      onClick={() => {
        setSpin((n) => n + 1);
        onPress?.();
      }}
    >
      <span style={{ display: "grid", transform: `rotate(${spin * 360}deg)` }}>
        <RotateCw size={15} />
      </span>
    </button>
  );
}

/**
 * Une rangée horizontale.
 *
 * Trois façons d'en sortir, parce qu'on n'a pas tous la même souris : les deux
 * flèches (qui n'apparaissent que s'il reste quelque chose de ce côté-là), le
 * glissé à la souris, et la molette horizontale d'un pavé tactile — celle-là
 * marche déjà toute seule, il suffit de ne pas la casser.
 *
 * ⚠️ LE GLISSÉ AVALE LE CLIC QUI LE SUIT. Sans ça, lâcher le bouton après avoir
 * fait défiler quatre jaquettes ouvre la fiche de celle qui se trouve sous le
 * curseur — le geste le plus frustrant qu'un carrousel puisse avoir.
 */
export function Rail({ children, className = "", snap = true }) {
  const ref = useRef(null);
  const drag = useRef({ down: false, startX: 0, left: 0, moved: false });
  const [dragging, setDragging] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 6,
      right: el.scrollLeft < el.scrollWidth - el.clientWidth - 6,
    });
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, update]);

  const nudge = (dir) =>
    ref.current?.scrollBy({
      left: dir * ref.current.clientWidth * 0.8,
      behavior: "smooth",
    });

  return (
    <div className="mh-rail-wrap">
      <button
        className={`mh-rail-arrow left clickable ${edges.left ? "" : "off"}`}
        onClick={() => nudge(-1)}
        aria-label="Défiler vers la gauche"
        tabIndex={edges.left ? 0 : -1}
      >
        <ChevronLeft size={22} />
      </button>

      <div
        ref={ref}
        className={`mh-rail ${snap ? "snap" : ""} ${dragging ? "dragging" : ""} ${className}`}
        onScroll={update}
        onMouseDown={(e) => {
          drag.current = {
            down: true,
            startX: e.pageX,
            left: ref.current.scrollLeft,
            moved: false,
          };
        }}
        onMouseMove={(e) => {
          const d = drag.current;
          if (!d.down) return;
          const dx = e.pageX - d.startX;
          if (!d.moved && Math.abs(dx) > 6) {
            d.moved = true;
            setDragging(true);
          }
          if (d.moved) {
            e.preventDefault();
            ref.current.scrollLeft = d.left - dx;
          }
        }}
        onMouseUp={() => {
          drag.current.down = false;
          setDragging(false);
        }}
        onMouseLeave={() => {
          drag.current.down = false;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          if (drag.current.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current.moved = false;
          }
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>

      <button
        className={`mh-rail-arrow right clickable ${edges.right ? "" : "off"}`}
        onClick={() => nudge(1)}
        aria-label="Défiler vers la droite"
        tabIndex={edges.right ? 0 : -1}
      >
        <ChevronRight size={22} />
      </button>
    </div>
  );
}

/** Un rayon complet : l'en-tête, puis la rangée. */
export default function Section({
  kicker,
  title,
  hint,
  cover,
  titleTo,
  moreTo,
  moreLabel,
  onRefresh,
  refreshLabel,
  rail = true,
  snap = true,
  className = "",
  children,
}) {
  return (
    <section className={`mh-sec ${className}`}>
      <SectionHead
        kicker={kicker}
        title={title}
        hint={hint}
        cover={cover}
        titleTo={titleTo}
        moreTo={moreTo}
        moreLabel={moreLabel}
        onRefresh={onRefresh}
        refreshLabel={refreshLabel}
      />
      {rail ? <Rail snap={snap}>{children}</Rail> : children}
    </section>
  );
}
