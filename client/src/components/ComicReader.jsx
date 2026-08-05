import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Keyboard, Mousewheel, Virtual, Zoom } from "swiper/modules";
import { Virtuoso } from "react-virtuoso";
import {
  X,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Columns2,
  Rows3,
  Maximize,
  Minimize,
  LayoutGrid,
  ArrowLeftRight,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { isRtl, spreadTest } from "../lib/collection";
import { playPageTurnSound, primePaperSounds } from "../lib/sfx";
import "swiper/css";
import "swiper/css/virtual";
import "swiper/css/zoom";

// ======================================================================
//  Le lecteur de comics et de mangas
// ======================================================================
// CE QUI EST À NOUS, ET CE QUI NE L'EST PAS.
//
// À nous : LE SENS DE LECTURE et LA RELIURE. Un manga se lit de droite à
// gauche — la première planche est à droite, et en mode double page c'est la
// paire elle-même qui doit être juste : la couverture ouvre SEULE, et une
// planche double (plus large que haute) se présente SEULE, sinon toutes les
// paires suivantes se décalent et le volume entier se lit de travers. Ce
// découpage-là (`buildViews`, `spreadTest`) est la donnée du volume, partagée
// avec le lecteur 3D : aucune bibliothèque ne le connaît à notre place.
//
// PAS À NOUS : le geste. Le glisser à l'inertie, le pincer-zoomer avec son
// recentrage, le déplacement dans une planche agrandie, le clavier qui sait
// s'inverser en RTL, et surtout NE MONTER QUE LES PLANCHES VOISINES — écrits
// à la main, ça faisait un zoom qui n'était qu'une classe CSS, un ruban qui
// montait deux cents images d'un coup, et pas un geste tactile qui tienne.
// Swiper (modules Virtual, Zoom, Keyboard, Mousewheel) tient les modes page et
// double ; react-virtuoso — déjà dans le projet — tient le ruban vertical.
//
// TROIS MODES, parce qu'un même volume ne se lit pas pareil selon l'écran :
//
//   • PAGE — une planche à la fois, la lecture par défaut sur téléphone ;
//   • DOUBLE — deux planches côte à côte comme un volume ouvert, avec la
//     reliure au centre. C'est la lecture juste sur un écran large, et la
//     seule qui rende les doubles pages telles qu'elles ont été dessinées ;
//   • RUBAN — tout à la verticale, en défilement continu : la lecture des
//     scans longs, et celle qu'on veut au pouce sur un téléphone.

// Ce que Swiper garde monté autour de la planche courante. Deux devant, une
// derrière : tourner une page ne doit jamais donner un carré vide, et revenir
// en arrière non plus — au-delà on télécharge le volume entier pour rien.
const AHEAD = 2;
const BEHIND = 1;

// Le temps qu'on laisse à un second tap avant de tourner la page. AU DOIGT
// SEULEMENT : un double tap, c'est le zoom, et sans cette attente il tournerait
// deux planches avant de zoomer. À la souris on tourne tout de suite — personne
// ne double-clique pour lire.
const TAP_WAIT = 230;

// Découpe le volume en VUES. Une vue est ce que l'écran montre d'un coup : une
// planche en mode page, une ou deux en mode double. C'est l'unité de
// navigation — la progression, elle, reste comptée en planches, parce que
// c'est ce qui a du sens quand on change de mode ou d'appareil.
//
// `isSpread` vient du volume ENTIER (voir `spreadTest`) et non d'un rapport
// fixe : une planche double se reconnaît à la taille des autres, et les deux
// lecteurs doivent en juger pareil — une planche présentée seule ici et
// appariée dans le volume 3D, c'est la même page lue de deux façons.
function buildViews(pages, double, isSpread) {
  if (!double) return pages.map((p) => [p]);
  const views = [];
  // La couverture ouvre SEULE, comme un vrai volume : c'est elle qui donne la
  // parité de toutes les paires suivantes. Appariée avec la planche 2, tout le
  // volume se retrouve décalé d'une page par rapport à l'impression.
  let i = 0;
  if (pages.length) {
    views.push([pages[0]]);
    i = 1;
  }
  while (i < pages.length) {
    const a = pages[i];
    const b = pages[i + 1];
    if (isSpread(a) || !b || isSpread(b)) {
      views.push([a]);
      i += 1;
    } else {
      views.push([a, b]);
      i += 2;
    }
  }
  return views;
}

export default function ComicReader({ media, startPage = 0, onClose, onProgress }) {
  const pages = useMemo(() => media.pages || [], [media.pages]);
  const rtl = isRtl(media);

  const [mode, setMode] = useState(() => {
    const saved = localStorage.getItem("mpl-comic-mode");
    if (saved) return saved;
    // Le mode double n'a de sens que sur un écran large : proposé d'office sur
    // un téléphone, il donnerait deux planches illisibles.
    return window.innerWidth >= 900 ? "double" : "page";
  });
  const [page, setPage] = useState(() => Math.min(startPage, Math.max(0, pages.length - 1)));
  const [zoomed, setZoomed] = useState(false);
  const [thumbs, setThumbs] = useState(false);
  const [full, setFull] = useState(false);
  const [chrome, setChrome] = useState(true); // barres visibles
  const stageRef = useRef(null);

  // L'instance Swiper : c'est elle qu'on pilote depuis les vignettes, la règle
  // et le clavier. Jamais en state — la toucher soixante fois par seconde
  // pendant un glisser redessinerait la page à chaque pixel.
  const sw = useRef(null);

  useScrollLock(true);
  useBackClose(onClose, "comic");
  useEffect(() => localStorage.setItem("mpl-comic-mode", mode), [mode]);
  // Les prises de papier descendent à l'ouverture : ici on peut glisser vers la
  // planche suivante dans la seconde, il n'y a pas de vol pour couvrir
  // l'attente. Demandées au premier geste, elles le laisseraient muet.
  useEffect(() => {
    primePaperSounds();
  }, []);

  const isSpread = useMemo(() => spreadTest(pages), [pages]);
  const views = useMemo(
    () => buildViews(pages, mode === "double", isSpread),
    [pages, mode, isSpread]
  );

  // La vue qui CONTIENT la planche courante. C'est ce passage par la planche
  // (et non par un index de vue) qui permet de changer de mode sans perdre sa
  // place : on retrouve la vue où l'on était, quelle que soit la découpe.
  const viewIndex = useMemo(() => {
    const at = views.findIndex((v) => v.some((p) => p.index === page));
    return at < 0 ? 0 : at;
  }, [views, page]);

  // Les vues telles que les verront les rappels de Swiper. Ses écouteurs sont
  // posés à l'initialisation : lus dans la portée du rendu, ils tourneraient
  // sur un découpage périmé dès le premier changement de mode.
  const viewsRef = useRef(views);
  viewsRef.current = views;

  // --- LES DEUX SENS D'AVANCE. `slideNext` avance TOUJOURS dans la lecture :
  //     en RTL, Swiper retourne son axe, pas l'ordre des vues. Tout le reste du
  //     composant peut donc ignorer le sens de lecture.
  const advance = useCallback(() => sw.current?.slideNext(), []);
  const back = useCallback(() => sw.current?.slidePrev(), []);

  // --- LE FROISSEMENT SUIT LA PLANCHE, PAS LA VUE. Changer de mode (page ↔
  //     double) redécoupe le volume et remonte le carrousel sans qu'on ait
  //     tourné quoi que ce soit : comparer des numéros de vue ferait claquer
  //     une page à chaque bascule, et une autre à l'ouverture. On ne joue donc
  //     que si la PLANCHE change — ce qui est la définition d'une page tournée,
  //     quel que soit le chemin (glisser, tap, clavier, règle, vignettes).
  const heard = useRef(page);
  const turned = useCallback((p) => {
    if (p === heard.current) return;
    heard.current = p;
    playPageTurnSound();
  }, []);

  // --- progression : enregistrée en différé. Tourner dix pages d'affilée ne
  //     doit pas déclencher dix requêtes ; seule la dernière compte.
  const save = useRef(null);
  useEffect(() => {
    if (!onProgress) return undefined;
    clearTimeout(save.current);
    save.current = setTimeout(() => onProgress(page), 700);
    return () => clearTimeout(save.current);
  }, [page, onProgress]);

  // La position est aussi poussée à la FERMETURE, sans attendre le délai : sur
  // la dernière planche lue, c'est précisément celle qu'on veut retrouver.
  const close = useCallback(() => {
    clearTimeout(save.current);
    onProgress?.(page);
    onClose();
  }, [onProgress, page, onClose]);

  // --- La planche demandée d'AILLEURS que du glisser (les vignettes, la règle,
  //     Début/Fin) : on emmène le carrousel là où le reste de l'écran dit qu'on
  //     est. Sans transition, parce qu'un saut de trente planches en fondu de
  //     trente pages n'est plus une transition, c'est une attente.
  useEffect(() => {
    const s = sw.current;
    if (!s || s.destroyed || s.activeIndex === viewIndex) return;
    s.slideTo(viewIndex, 0);
  }, [viewIndex]);

  // --- clavier. Les flèches gauche/droite appartiennent à Swiper : son module
  //     Keyboard les inverse déjà en lecture japonaise, comme le fait tout
  //     lecteur de manga. On ne garde ici que ce qu'il ne connaît pas.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") return thumbs ? setThumbs(false) : close();
      // La règle, quand on la tient, garde ses propres touches — Swiper
      // s'écarte pareil. Deux gestes pour une frappe, ce serait deux planches.
      const on = document.activeElement;
      if (on && (on.nodeName === "INPUT" || on.isContentEditable)) return undefined;
      if (e.key === "ArrowDown" || e.key === " ") {
        if (mode === "ribbon") return undefined;
        e.preventDefault();
        return advance();
      }
      if (e.key === "ArrowUp") return mode === "ribbon" ? undefined : back();
      if (e.key === "Home") return setPage(0);
      if (e.key === "End") return setPage(pages.length - 1);
      if (e.key.toLowerCase() === "d") return setMode((m) => (m === "double" ? "page" : "double"));
      if (e.key.toLowerCase() === "f") return setFull((f) => !f);
      return undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, back, close, mode, thumbs, pages.length]);

  // --- plein écran réel. Le mode « lecture pure » demandé : plus de barre du
  //     navigateur, plus rien que la planche.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    if (full && !document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    if (!full && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [full]);
  useEffect(() => {
    const sync = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // --- TAPER POUR TOURNER. Les tiers extérieurs de l'écran tournent la page,
  //     celui du milieu escamote le mobilier : c'est le geste de tous les
  //     lecteurs de comics, et il marche au doigt comme à la souris. Il passe
  //     par Swiper (et non par deux boutons posés sur les côtés) pour que le
  //     GLISSER reste possible partout — deux zones cliquables sur les bords,
  //     c'est justement là qu'on attrape la page au pouce.
  const tapT = useRef(null);
  useEffect(() => () => clearTimeout(tapT.current), []);

  const onTap = useCallback(
    (s, e) => {
      // Planche agrandie : le doigt sert à s'y déplacer, pas à en changer.
      if (s.zoom?.scale > 1) return;
      const box = s.el.getBoundingClientRect();
      const x = e.clientX - box.left;
      const w = box.width;
      const fire = () => {
        if (x < w * 0.32) return rtl ? s.slideNext() : s.slidePrev();
        if (x > w * 0.68) return rtl ? s.slidePrev() : s.slideNext();
        return setChrome((c) => !c);
      };
      if (e.pointerType !== "touch") return fire();
      // Un second tap dans la foulée : c'était un double tap, donc le zoom —
      // on annule la page qu'on s'apprêtait à tourner.
      if (tapT.current) {
        clearTimeout(tapT.current);
        tapT.current = null;
        return undefined;
      }
      tapT.current = setTimeout(() => {
        tapT.current = null;
        fire();
      }, TAP_WAIT);
      return undefined;
    },
    [rtl]
  );

  const toggleZoom = useCallback(() => {
    const s = sw.current;
    if (!s || s.destroyed) return;
    if (s.zoom.scale > 1) s.zoom.out();
    else s.zoom.in();
  }, []);

  // --- le ruban. Virtuoso ne monte que ce qui est à l'écran : deux cents
  //     planches en pleine définition dans le DOM, c'était l'onglet qui
  //     s'étouffe au bout du troisième volume.
  const ribbonEnd = useCallback(
    () => <div className="creader-ribbon-end">Fin — {pages.length} planches</div>,
    [pages.length]
  );

  // ON N'ÉCOUTE PAS LE RUBAN AVANT QU'IL SE POSE. Il annonce sa première
  // fenêtre depuis le haut du volume, avant même d'avoir sauté au marque-page :
  // s'y fier, c'est ramener la progression à la planche 1 rien qu'en ouvrant le
  // mode. On lui laisse le temps d'arriver, puis on le suit.
  const settled = useRef(false);
  useEffect(() => {
    if (mode !== "ribbon") return undefined;
    settled.current = false;
    const t = setTimeout(() => {
      settled.current = true;
    }, 500);
    return () => clearTimeout(t);
  }, [mode]);

  if (!pages.length) return null;
  const view = views[viewIndex] || [pages[0]];
  const pct = pages.length > 1 ? (page / (pages.length - 1)) * 100 : 100;

  return createPortal(
    <div
      ref={stageRef}
      className={`creader ${full ? "is-full" : ""} ${chrome ? "" : "bare"} ${
        zoomed ? "is-zoomed" : ""
      } mode-${mode}`}
      style={{ "--tint": media.color || "var(--orange)" }}
      role="dialog"
      aria-label={`Lecture — ${media.title}`}
    >
      {/* ---------------- barre du haut ---------------- */}
      <header className="creader-bar">
        <button className="creader-icon clickable" onClick={close} aria-label="Fermer">
          <X size={18} />
        </button>
        <div className="creader-id">
          <strong>{media.title}</strong>
          <span>
            {media.franchise ? `${media.franchise} · ` : ""}
            {rtl ? "lecture japonaise" : "lecture occidentale"}
          </span>
        </div>

        <div className="creader-tools">
          <button
            className={`creader-icon clickable ${mode === "page" ? "on" : ""}`}
            onClick={() => setMode("page")}
            title="Une planche à la fois"
          >
            <BookOpen size={17} />
          </button>
          <button
            className={`creader-icon clickable ${mode === "double" ? "on" : ""}`}
            onClick={() => setMode("double")}
            title="Volume ouvert, deux planches (D)"
          >
            <Columns2 size={17} />
          </button>
          <button
            className={`creader-icon clickable ${mode === "ribbon" ? "on" : ""}`}
            onClick={() => setMode("ribbon")}
            title="Ruban vertical, défilement continu"
          >
            <Rows3 size={17} />
          </button>
          <span className="creader-sep" />
          {/* Le zoom à la souris : au doigt il se fait au pincer, et personne
              ne va chercher un bouton pour ça. */}
          {mode !== "ribbon" && (
            <button
              className={`creader-icon clickable ${zoomed ? "on" : ""}`}
              onClick={toggleZoom}
              title={zoomed ? "Revenir à la planche entière" : "Agrandir (double-clic, pincer)"}
              aria-label="Agrandir la planche"
            >
              {zoomed ? <ZoomOut size={17} /> : <ZoomIn size={17} />}
            </button>
          )}
          <button
            className={`creader-icon clickable ${thumbs ? "on" : ""}`}
            onClick={() => setThumbs((t) => !t)}
            title="Toutes les planches"
          >
            <LayoutGrid size={17} />
          </button>
          <button
            className="creader-icon clickable"
            onClick={() => setFull((f) => !f)}
            title="Lecture pure (F)"
          >
            {full ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
      </header>

      {/* ---------------- la planche ---------------- */}
      {mode === "ribbon" ? (
        // L'enveloppe porte la hauteur (elle est l'étage du milieu, entre les
        // deux barres) et Virtuoso la remplit : il lui faut une hauteur
        // DÉFINIE pour savoir ce qu'il doit monter.
        <div className="creader-ribbon">
          <Virtuoso
            data={pages}
            // On rouvre le ruban là où l'on en était, et la planche courante
            // suit le défilement : sans marge en haut, la première montée est
            // exactement la première visible.
            initialTopMostItemIndex={Math.max(0, page)}
            increaseViewportBy={{ top: 0, bottom: 900 }}
            rangeChanged={(r) => {
              if (!settled.current) return;
              setPage(r.startIndex);
              // Le ruban DÉFILE, il ne tourne pas : pas de froissement. Mais on
              // note où il en est — sans quoi le retour au mode page, qui
              // remonte le carrousel sur cette planche, s'entendrait comme une
              // page tournée qu'on n'a jamais tournée.
              heard.current = r.startIndex;
            }}
            itemContent={(i, p) => (
              <img
                className="creader-strip"
                src={p.src}
                alt={`Planche ${i + 1}`}
                draggable={false}
                // Le format vient du serveur : la place de la planche est donc
                // réservée AVANT son chargement, et le ruban ne sursaute pas
                // sous le pouce à chaque image qui arrive.
                style={p.w && p.h ? { aspectRatio: `${p.w} / ${p.h}` } : undefined}
              />
            )}
            components={{ Footer: ribbonEnd }}
          />
        </div>
      ) : (
        <Swiper
          // Le découpage change avec le mode : on remonte le carrousel plutôt
          // que de lui faire avaler une autre liste sous les pieds.
          key={`${mode}-${rtl ? "rtl" : "ltr"}`}
          className="creader-swiper"
          modules={[Virtual, Zoom, Keyboard, Mousewheel, A11y]}
          // LE SENS DE LECTURE EST PORTÉ PAR LE CONTENEUR. Swiper retourne son
          // axe, son clavier et sa règle d'un coup — et la paire de planches,
          // rangée dans l'ordre de lecture, s'affiche du même coup à l'endroit.
          dir={rtl ? "rtl" : "ltr"}
          virtual={{ addSlidesBefore: BEHIND, addSlidesAfter: AHEAD }}
          zoom={{ maxRatio: 4 }}
          keyboard={{ enabled: true, onlyInViewport: false }}
          mousewheel={{ thresholdDelta: 25 }}
          slidesPerView={1}
          spaceBetween={28}
          speed={260}
          initialSlide={viewIndex}
          onSwiper={(s) => {
            sw.current = s;
          }}
          onSlideChange={(s) => {
            const v = viewsRef.current[s.activeIndex];
            if (!v) return;
            setPage(v[0].index);
            turned(v[0].index);
          }}
          onZoomChange={(s, scale) => {
            setZoomed(scale > 1);
            // Agrandi, la molette sert à parcourir la planche : la laisser
            // tourner les pages ferait sauter le volume sous les yeux.
            if (scale > 1) s.mousewheel?.disable();
            else s.mousewheel?.enable();
          }}
          onClick={onTap}
        >
          {views.map((v, i) => (
            <SwiperSlide key={v[0].index} virtualIndex={i} zoom>
              {/* La cible du zoom, c'est LA VUE — les deux planches d'un
                  volume ouvert s'agrandissent ensemble, sinon on zoomerait
                  sur une demi-double page. */}
              <div
                className={`creader-sheet swiper-zoom-target ${v.length > 1 ? "spread" : ""}`}
              >
                {v.map((p) => (
                  <img
                    key={p.index}
                    src={p.src}
                    alt={`Planche ${p.index + 1}`}
                    draggable={false}
                  />
                ))}
              </div>
            </SwiperSlide>
          ))}

          {/* Les chevrons ne sont qu'un repère : ils montrent où appuyer, et
              ne prennent rien au doigt — c'est Swiper qui reçoit le geste. */}
          <span className="creader-half left" aria-hidden="true">
            <ChevronLeft size={30} />
          </span>
          <span className="creader-half right" aria-hidden="true">
            <ChevronRight size={30} />
          </span>
        </Swiper>
      )}

      {/* ---------------- barre du bas ---------------- */}
      <footer className="creader-foot">
        <span className="creader-count">
          {view.length > 1
            ? `${view[0].index + 1}–${view[1].index + 1}`
            : page + 1}{" "}
          <em>/ {pages.length}</em>
        </span>

        {/* La règle suit le SENS DE LECTURE : en manga, la progression va de
            droite à gauche, comme les planches. Une barre qui se remplit à
            l'envers du volume qu'on lit est une petite trahison permanente. */}
        <div className={`creader-rule ${rtl ? "rtl" : ""}`}>
          <input
            type="range"
            min={0}
            max={Math.max(0, pages.length - 1)}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            aria-label="Aller à une planche"
          />
          <span style={{ width: `${pct}%` }} />
        </div>

        {rtl && (
          <span className="creader-dir" title="Ce titre se lit de droite à gauche">
            <ArrowLeftRight size={13} /> ← lecture
          </span>
        )}
      </footer>

      {/* ---------------- planches en vignettes ---------------- */}
      {thumbs && (
        <div className="creader-thumbs" onClick={() => setThumbs(false)}>
          <div className="creader-thumbs-grid" onClick={(e) => e.stopPropagation()}>
            {pages.map((p) => (
              <button
                key={p.index}
                className={`creader-thumb clickable ${p.index === page ? "on" : ""}`}
                onClick={() => {
                  setPage(p.index);
                  setThumbs(false);
                }}
              >
                {/* La vignette légère fabriquée à l'import, comme sur la
                    fiche : la planche-contact d'un volume entier ne peut pas
                    être faite de planches en pleine définition. */}
                <img src={p.thumb || p.src} alt="" loading="lazy" decoding="async" />
                <em>{p.index + 1}</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
