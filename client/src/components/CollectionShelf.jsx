import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { X, ArrowRight, BookOpen, Gamepad2, MessageCircle } from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ShelfSkeleton } from "./CollectionSkeleton";
import CollectionCommentsPanel from "./CollectionCommentsPanel";
import {
  BOX,
  boxOf,
  CONSOLE,
  paintCase,
  fmtYears,
  isComic,
  isGame,
  isRtl,
  KINDS,
} from "../lib/collection";
import {
  paperGeometry,
  shellGeometry,
  bookCoverGeometry,
  bookBlockGeometry,
  pageEdgeTexture,
  plankTextures,
  shadeTexture,
} from "../lib/caseGeometry";

// Le volume ouvert est une scène à lui tout seul (déformation de page à chaque
// image, textures de planches) : il ne descend qu'au moment où l'on ouvre un
// titre de papier, pas avec le rayon.
const BookReader3D = lazy(() => import("./BookReader3D"));

// La console fait descendre l'émulateur (plusieurs mégaoctets de WebAssembly) :
// elle n'arrive qu'au moment où l'on appuie sur « Jouer ».
const GbaPlayer = lazy(() => import("./GbaPlayer"));

// ======================================================================
//  La planche de collection + la vitrine
// ======================================================================
// Deux scènes, deux rôles :
//
//   • LA PLANCHE — le rayon au repos. Une simple planche qui sort de la page
//     (canvas transparent), les boîtiers debout dessus, tranche vers nous.
//     Survol : le boîtier se penche et une bulle sort AU-DESSUS de lui, comme
//     une bulle de bande dessinée — l'étiquette appartient à l'objet, pas à
//     la page, donc elle est ancrée sur SA position, projetée depuis la 3D.
//     Clic : on le prend en main.
//
//   • LA VITRINE (CaseInspector) — un boîtier pris en main. PLEIN ÉCRAN, par
//     portail au-dessus de toute l'app. Le fond n'est pas un décor rapporté :
//     c'est la page elle-même, floutée — on n'a pas changé de lieu, on s'est
//     penché sur un objet. Et le boîtier ne surgit pas du néant : il DÉCOLLE
//     de la place exacte qu'il occupait sur l'étagère (même centre, même
//     hauteur à l'écran), encore de tranche, puis pivote pour se présenter.
//     L'attraper le fait tourner ; le clic droit le déplace dans le cadre
//     (indispensable une fois zoomé sur un texte) ; le cliquer ouvre sa
//     fiche ; Échap / clic à côté le repose.
//
//   Présenter le boîtier dans le canvas du rayon était une impasse : coincé
//   dans un cadre de 500 px, il se cognait aux bords.
//
// Les faces sont peintes dans des canvas (lib/collection.js) et partagées par
// les deux scènes : three.js garde l'état GPU par renderer, une même texture
// peut donc servir aux deux canvas sans être repeinte.

const GAP = 0.016; // jeu entre deux boîtiers
const EDGE = 0.22; // air laissé de chaque côté de la rangée dans le cadre
const MIN_W = 1.3; // largeur cadrée minimale (deux titres = gros plan, pas nez à nez)
const PER_PLANK = 20; // au-delà, une seconde planche flotte sous la première
// Ciel laissé au-dessus du plus grand boîtier d'une planche. L'écart vertical
// entre deux planches n'est plus une constante : il se calcule à partir de la
// rangée, puisque les boîtiers n'ont plus tous la même hauteur.
const PLANK_AIR = 0.48;
// Épaisseur : à l'échelle (1 unité ≈ 16 cm), 0,09 fait une planche d'environ
// 1,5 cm — celle d'une vraie étagère.
const THICK = 0.09;
const DEPTH = 0.94; // profondeur : juste de quoi porter le boîtier le plus profond
// CE QUE LA PLANCHE AVANCE devant les tranches. Une tablette dépasse toujours un
// peu de ce qu'elle porte, et cette avancée est ce qui laisse voir son DESSUS
// alors que la caméra est presque à niveau — donc ce qui donne sa place à
// l'ombre de contact, au pied des boîtiers.
const NOSE = 0.05;
// Le chant est un demi-cylindre couché, de rayon égal à la demi-épaisseur : il
// fait tout le tour du chant, tangent au dessus et au dessous, sans laisser
// réapparaître d'arête vive. Mais APLATI — laissé rond, il donne un tube de
// plastique et non une tablette usinée.
const NOSE_FLAT = 0.62;
// Ce que la planche pose d'ombre sur la page, en hauteur (la force est dans
// PLANK, elle dépend du thème).
const SHADOW_H = 0.13;
// Longueur d'un carreau de fibres, en unités de scène (≈ 25 cm). Au-delà, le
// dessin s'étire et la planche redevient un aplat.
const FIBRE_TILE = 1.6;

// Le geste de survol : le boîtier s'avance, se soulève et se penche vers nous
// en pivotant sur son arête du bas. Chiffré ici parce que DEUX endroits en
// dépendent — l'animation, et la projection qui accroche la bulle sur le
// boîtier tel qu'on le voit vraiment (penché, il perd de la hauteur à l'écran).
const HOVER = { lift: 0.015, out: 0.05, tilt: 0.22 };

// Cadrage du rayon. FILL est la part de la hauteur visible que remplit la
// rangée : plus il est haut, plus les boîtiers sont gros. ABOVE dit où passe
// le vide restant.
//
// Le ciel au-dessus sert à la bulle de survol, mais il n'a jamais à être
// GRAND : au-delà d'une centaine de pixels, la rangée décroche du haut de la
// page et l'étagère a l'air posée par terre. On garde donc juste ce qu'il faut,
// et la bulle mord sur la marge de la barre d'outils quand elle est à l'étroit.
const FILL = 0.74;
const ABOVE = 0.62;

// La planche suit le thème de la page : claire sur fond blanc, sombre sur fond
// sombre. Discrète dans les deux cas — c'est un support, pas un décor.
//
// Trois teintes, une par pièce (voir `Plank`), parce qu'elles ne reçoivent pas
// la même lumière : le `top` vient du plafond, le `nose` de la pièce (il est
// donc le plus clair, comme une arête polie par les mains), le `body` ne se voit
// que par son dessous. Et deux forces d'ombre, qui ne sont pas une couleur mais
// ce que la planche pose de noir sur ce qu'il y a derrière.
const PLANK = {
  light: {
    top: "#e7e3d9",
    nose: "#eeeae1",
    body: "#d0cbc0",
    contact: 0.38,
    shadow: 0.2,
  },
  dark: {
    top: "#292a33",
    nose: "#32333d",
    body: "#1d1e25",
    // Sur fond sombre, une ombre noire ne se voit presque plus. Elle compte
    // encore au CONTACT (contre une tranche claire, elle se lit), mais sous la
    // planche elle laisse la main à la lueur de bord posée par la page
    // (voir app-26-collection.css).
    contact: 0.5,
    shadow: 0.26,
  },
};

// ------------------------------------------------------------- lumières --
//
// LE RAYON ET LA VITRINE SONT DEUX CANVAS, donc deux exemplaires du même
// boîtier : au moment où l'un prend le relais de l'autre, tout ce qui diffère
// se lit comme un objet qu'on aurait remplacé. La lumière est le pire de ces
// écarts — même objet, autre teinte. Les deux montages sont donc écrits ici,
// et la vitrine DÉMARRE sur celui du rayon avant de glisser vers le sien
// pendant le vol : la lumière voyage avec l'objet.
//
// Ce sont des lumières directionnelles visant l'origine : seule leur DIRECTION
// compte, jamais leur distance — d'où des vecteurs fixes, valables où que soit
// le boîtier dans sa scène.
//
// DOSAGE. Une jaquette est une IMAGE : on vient la regarder, pas admirer
// l'éclairage. Les deux montages sont donc calés pour que la face tournée vers
// nous reçoive tout juste de quoi se rendre telle qu'elle a été peinte —
// somme des apports ≈ 0,85 en éclairement diffus (three divise par π, d'où des
// intensités qui paraissent fortes). Au-delà, le papier part dans le blanc et
// l'affiche disparaît sous sa propre lumière.
//
// Et AUCUNE source n'est posée sur l'axe de la caméra : une lampe frontale se
// reflète pile au milieu de la face qu'on regarde — c'était la grosse tache
// blanche au centre des boîtiers. Toutes attaquent de biais, le reflet file
// donc hors champ et il ne reste que le modelé.
const SHELF_RIG = {
  ambient: 1.25,
  lights: [
    { at: [1.4, 1.3, 2.8], power: 1.25, tone: "#ffffff" },
    { at: [2.6, 0.5, 1.1], power: 0.5, tone: "#fff3e0" },
    { at: [-2.8, 1.2, 0.8], power: 0.42, tone: "#c7d2ff" },
  ],
};

const CASE_RIG = {
  ambient: 1.3,
  lights: [
    { at: [1.9, 1.6, 2.3], power: 1.4, tone: "#fff2dd" },
    { at: [-2.2, -0.6, -2.2], power: 0.55, tone: "#9fb0ff" },
    { at: [-1.4, 0.7, 2.6], power: 0.5, tone: "#ffffff" },
  ],
};

const mix = (a, b, t) => a + (b - a) * t;
// Un angle ramené au tour le plus proche, dans ]-π, π]. Le présentoir tourne en
// continu : sans ça, un angle accumulé pendant une minute se transmettrait tel
// quel, et l'objet ferait autant de tours qu'il en avait faits.
const normalizeTurn = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
const SCRATCH = new THREE.Color();

// Vitrine : cadence de la rotation automatique, délai avant qu'elle reprenne
// après qu'on a lâché le boîtier, et champ de la caméra (partagé avec le
// calcul du décollage, qui doit tomber au pixel près).
const IDLE_SPEED = 0.5; // rad/s ≈ un tour en 12 s
const IDLE_DELAY = 1500; // ms
const FOV = 34;

// Le voyage du boîtier, en secondes. Assez pour qu'on LE VOIE sortir du rayon,
// traverser et se poser — mais c'est un geste de la main, pas une cinématique :
// au-delà, on attend l'objet au lieu de le prendre. Le rangement est plus vif
// encore : on repose, on ne présente plus.
const FLY_OUT = 0.45;
const FLY_BACK = 0.34;

// Vitesse de remise en place de la rotation, calée sur la durée du retour : il
// doit rester moins d'un degré d'écart à l'arrivée, sinon le boîtier se range
// de travers juste avant que celui du rayon ne reprenne la main.
const HOME_RATE = 4.6 / FLY_BACK;

// Départ franc, arrivée posée — la courbe d'un objet qu'on déplace à la main.
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// Largeur de la bulle de survol, en pixels — connue ici pour la recadrer dans
// le canvas quand le boîtier survolé est tout au bord.
const BUBBLE_W = 268;

// ------------------------------------------------------------- matériaux --

// Le matériau est construit À LA MAIN plutôt que déclaré en JSX : un matériau
// JSX qui passe de `color` à `map` garde sa couleur, et une texture est
// MULTIPLIÉE par elle — boîtier noir, sans erreur. Ici la couleur est toujours
// explicite.
function useCasePaper(art) {
  const paper = useMemo(() => {
    if (!art?.sheet) return null;
    // Du PAPIER, pas du vernis : rugueux (0,82) et sans métal, donc sans lobe
    // spéculaire serré. Une jaquette de boîtier est imprimée sur du carton
    // mat ; à 0,36 elle renvoyait un éclat de plastique en plein milieu de
    // l'affiche, et c'est l'affiche qu'on vient voir.
    return new THREE.MeshStandardMaterial({
      map: art.sheet,
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0,
    });
  }, [art]);

  // R3F ne détruit que ce qu'il a créé lui-même : à nous de libérer.
  useEffect(() => () => paper?.dispose(), [paper]);
  return paper;
}

// ------------------------------------------------------------ le boîtier --

// Le boîtier lui-même, sans interaction : partagé entre le rayon et la vitrine.
// Deux pièces, et deux seulement :
//
//   • LA COQUE — le plastique. On n'en voit que le dessus, le dessous et le
//     chant d'ouverture : tout le reste est sous le papier.
//   • LA JAQUETTE — une feuille unique qui fait le tour en épousant les arêtes
//     arrondies (voir `paperGeometry`). Qu'elle ait été fournie dépliée ou
//     composée par nos soins ne change plus rien ici : elle arrive dans les
//     deux cas en une seule image, cousue à la peinture (voir paintCase).
//
// `box` arrive tout calculé (voir `boxOf`) : ce sont ses dimensions à LUI, pas
// celles d'un gabarit. Un titre dont la jaquette a été mesurée est donc à sa
// vraie taille sur l'étagère, à côté des autres.
//
// DEUX CARROSSERIES, ET UNE SEULE PORTE D'ENTRÉE. Un manga rangé à côté d'un
// DVD ne doit pas être le même objet repeint : le boîtier a une coque de
// plastique, une rainure d'ouverture et un dos plat ; le volume a un dos en
// demi-lune et montre le chant de ses pages. C'est ici, et nulle part ailleurs,
// que le choix se fait — tout le reste de la scène (survol, vol, vitrine) ne
// sait pas de quel objet il s'occupe, et n'a pas à le savoir.
function CaseModel({ media, box, paper, cuts }) {
  if (isComic(media)) return <BookModel box={box} paper={paper} cuts={cuts} />;
  return <DiscCase box={box} paper={paper} cuts={cuts} />;
}

// ------------------------------------------------------------- le volume --
// Deux pièces, aucun plastique :
//
//   • LE BLOC — les pages. En retrait de la couverture sur les trois côtés
//     ouverts (la « chasse »), et habillé du chant strié : c'est LUI qui fait
//     lire l'objet comme du papier, avant même qu'on ait vu la couverture.
//   • LA COUVERTURE — la même feuille unique que sur un boîtier, mais épousant
//     un dos en demi-lune plutôt qu'un dos plat à arêtes vives.
function BookModel({ box, paper, cuts }) {
  const geo = useMemo(
    () => ({ cover: bookCoverGeometry(box, cuts), block: bookBlockGeometry(box) }),
    [box, cuts]
  );
  useEffect(
    () => () => {
      geo.cover.dispose();
      geo.block.dispose();
    },
    [geo]
  );

  // Les six faces du bloc ne montrent pas la même chose : les trois CHANTS
  // montrent la tranche des feuilles (striée), les deux faces collées aux plats
  // et le dos montrent du papier uni — et personne ne les voit. Une seule
  // matière pour les six étalerait le grain de la tranche partout.
  const mats = useMemo(() => {
    // Du papier lu cent fois : mat, sans le moindre éclat. Un chant de bloc qui
    // brille, c'est du plastique, et on retombe sur le boîtier qu'on vient
    // justement de quitter.
    const edge = new THREE.MeshStandardMaterial({
      map: pageEdgeTexture(),
      color: "#f8f1e0",
      roughness: 0.96,
      metalness: 0,
    });
    const flat = new THREE.MeshStandardMaterial({
      color: "#f7f1e3",
      roughness: 0.97,
      metalness: 0,
    });
    // Ordre des groupes d'une BoxGeometry : +X, -X, +Y, -Y, +Z, -Z. Rangé, le
    // volume empile ses pages selon X : tête, pied et gouttière sont les chants.
    return [flat, flat, edge, edge, flat, edge];
  }, []);
  useEffect(() => () => new Set(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group>
      <mesh geometry={geo.block} material={mats} />
      {paper && <mesh geometry={geo.cover} material={paper} />}
    </group>
  );
}

// ------------------------------------------------------------ le boîtier --
function DiscCase({ box, paper, cuts }) {
  // Les deux géométries sont taillées sur mesure, donc refaites dès que les
  // dimensions ou les traits de coupe changent — et libérées avec eux : R3F ne
  // détruit que ce qu'il a créé lui-même.
  const geo = useMemo(
    () => ({ shell: shellGeometry(box), paper: paperGeometry(box, cuts) }),
    [box, cuts]
  );
  useEffect(
    () => () => {
      geo.shell.dispose();
      geo.paper.dispose();
    },
    [geo]
  );

  return (
    <group>
      <mesh geometry={geo.shell}>
        {/* clearcoat : le vernis du plastique, qui accroche un reflet — mais
            DOUX, et sur une coque à peine grise plutôt que blanche. Le liseré
            de plastique borde la jaquette : trop clair ou trop brillant, c'est
            un cadre lumineux autour de l'image, et l'œil ne voit plus que lui. */}
        <meshPhysicalMaterial
          color="#e9e7e1"
          roughness={0.55}
          metalness={0}
          clearcoat={0.3}
          clearcoatRoughness={0.55}
        />
      </mesh>

      {paper && <mesh geometry={geo.paper} material={paper} />}

      {/* L'interstice d'ouverture : la fine rainure d'ombre entre les deux
          valves, sur le chant opposé à la tranche. Un TRAIT, pas un panneau —
          le reste de ce chant est du plastique blanc, comme sur l'objet réel. */}
      <mesh position={[0, 0, -box.d / 2 - 0.001]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[box.w * 0.14, box.h * 0.9]} />
        <meshStandardMaterial color="#4a4b52" roughness={0.85} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------ le rayon (repos) --

function ShelfCase({ media, x, baseY, art, hovered, held, taken, onHover, onPick }) {
  const group = useRef(null);
  const box = boxOf(media);
  const paper = useCasePaper(art);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Alignés sur leur FACE AVANT (tranches affleurantes) : front au même plan =
  // mêmes proportions à l'écran, et c'est comme ça qu'on range des boîtiers.
  const baseZ = -box.d / 2;

  // La place EXACTE du boîtier à l'instant du clic — celle qu'il occupe pour de
  // vrai, pas celle qu'il aurait une fois son mouvement de survol terminé. On
  // peut cliquer un boîtier à peine effleuré : entre les deux, il y a plusieurs
  // dizaines de pixels, et c'est de là que la vitrine doit partir.
  function snapshot() {
    const g = group.current;
    if (!g) return null;
    g.updateMatrixWorld();
    const at = (y) => {
      const v = new THREE.Vector3(0, y, box.d / 2)
        .applyMatrix4(g.matrixWorld)
        .project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * size.width,
        y: (-v.y * 0.5 + 0.5) * size.height,
      };
    };
    const top = at(box.h);
    const bottom = at(0);
    return {
      x: (top.x + bottom.x) / 2,
      y: (top.y + bottom.y) / 2,
      h: Math.abs(bottom.y - top.y),
      tilt: g.rotation.x, // son inclinaison À CET INSTANT, pas celle du survol fini
    };
  }

  useFrame((_, dt) => {
    const g = group.current;
    // Pris en main : sa pose est GELÉE sur celle du clic. Sans ça, il se
    // rétractait pendant que l'autre canvas ouvrait son contexte — on le voyait
    // rentrer dans l'étagère avant d'en sortir.
    if (!g || held) return;
    const k = Math.min(1, dt * 8);
    g.position.z += (baseZ + (hovered ? HOVER.out : 0) - g.position.z) * k;
    g.position.y += (baseY + (hovered ? HOVER.lift : 0) - g.position.y) * k;
    // Penché vers nous en pivotant sur son arête du bas — le geste du doigt
    // qui accroche le haut de la tranche.
    g.rotation.x += ((hovered ? HOVER.tilt : 0) - g.rotation.x) * k;
  });

  return (
    <group
      ref={group}
      position={[x + box.w / 2, baseY, baseZ]}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(media.slug);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onPick(media, snapshot());
      }}
    >
      {/* Pris en main, le boîtier quitte VRAIMENT l'étagère : sa place reste
          vide derrière la vitrine, et plus rien ici ne répond au curseur. */}
      {!taken && (
        <group position={[0, box.h / 2, 0]}>
          <CaseModel media={media} box={box} paper={paper} cuts={art?.cuts} />
        </group>
      )}
    </group>
  );
}

// UNE TABLETTE, ET NON PLUS UN RUBAN. La planche était un rectangle plat, ses
// reliefs PEINTS dessus : un filet clair en haut, une ombre en bas, deux bandes
// qui ne pouvaient être justes que pour une seule hauteur de rangée — dès qu'une
// planche passait au-dessus du niveau de l'œil, la lumière y tombait du mauvais
// côté, et de près les trois bandes se lisaient comme trois marches.
//
// Ici, ces deux filets sont devenus de la MATIÈRE : le chant est un vrai bec
// arrondi, et c'est la lumière de la scène qui y trace le liseré clair et
// l'ombre sous la planche — donc juste pour chaque rangée, où qu'elle se trouve
// dans le cadre, et continu au lieu d'être en escalier.
//
// S'y ajoutent les deux ombres qui POSENT l'objet, et qu'aucune lampe ne donne
// ici (la scène n'a pas d'ombres portées, et n'en a pas besoin pour trois
// plans) : le liseré de contact au pied des boîtiers, et l'ombre que la tablette
// laisse tomber sur la page. Le canvas est transparent — cette dernière
// assombrit donc la PAGE elle-même, comme une vraie étagère posée dessus.
function Plank({ width, y, skin }) {
  // Le fil se répète le long de la planche : une tablette de plusieurs mètres ne
  // peut pas porter un dessin unique de plusieurs mètres. Le nombre de carreaux
  // dépend donc de SA largeur, d'où une copie par planche — les copies partagent
  // l'image, seul le repère change.
  const wood = useMemo(() => {
    const base = plankTextures();
    const top = base.top.clone();
    const nose = base.nose.clone();
    const tiles = Math.max(1, Math.round(width / FIBRE_TILE));
    top.repeat.set(tiles, 1);
    // Le chant a ses UV tournées d'un quart de tour : c'est la MÊME poignée qui
    // étire le dessin sur la longueur (voir `plankTextures`).
    nose.repeat.set(tiles, 1);
    return { top, nose };
  }, [width]);
  useEffect(
    () => () => {
      wood.top.dispose();
      wood.nose.dispose();
    },
    [wood]
  );

  // Repère : l'origine du groupe est le BEC de la planche, au niveau où posent
  // les boîtiers. Tout se mesure vers l'arrière et vers le bas depuis là.
  return (
    <group position={[0, y, NOSE]}>
      {/* LA MASSE. On ne la voit que par son dessous et ses côtés : le dessus et
          le chant sont couverts par les deux pièces suivantes. */}
      <mesh position={[0, -THICK / 2, -DEPTH / 2]}>
        <boxGeometry args={[width, THICK, DEPTH]} />
        <meshStandardMaterial color={skin.body} roughness={0.8} metalness={0.02} />
      </mesh>

      {/* LE DESSUS. Presque rasant (la caméra est à peine au-dessus de la
          rangée), donc réduit à un liseré de quelques pixels — mais c'est lui
          qui dit que les boîtiers sont POSÉS sur quelque chose. Mat : une
          tablette ne brille pas là où l'on pose les objets. */}
      <mesh position={[0, 0.0005, -DEPTH / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, DEPTH]} />
        <meshStandardMaterial
          map={wood.top}
          color={skin.top}
          roughness={0.88}
          metalness={0.02}
        />
      </mesh>

      {/* LE BEC. Un demi-cylindre couché et aplati, tangent au dessus comme au
          dessous. Un peu plus lisse que le reste — c'est le bord que les mains
          polissent — pour que la lumière y trace un filet clair CONTINU sur
          toute la longueur : c'est ce filet, et lui seul, qui donne son épaisseur
          à la planche. */}
      <mesh
        position={[0, -THICK / 2, 0]}
        rotation={[0, 0, Math.PI / 2]}
        scale={[1, 1, NOSE_FLAT]}
      >
        <cylinderGeometry
          args={[THICK / 2, THICK / 2, width, 24, 1, true, -Math.PI / 2, Math.PI]}
        />
        <meshStandardMaterial
          map={wood.nose}
          color={skin.nose}
          roughness={0.46}
          metalness={0.04}
        />
      </mesh>

      {/* LE CONTACT. Le liseré occupe exactement la bande de dessus laissée
          libre par l'avancée de la planche : sombre contre les tranches, éteint
          au bord. Sans lui, les boîtiers sont posés SUR UNE IMAGE de planche ;
          avec, ils la touchent. */}
      <mesh position={[0, 0.002, -NOSE / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, NOSE]} />
        <meshBasicMaterial
          map={shadeTexture()}
          color="#000000"
          transparent
          opacity={skin.contact}
          depthWrite={false}
        />
      </mesh>

      {/* L'OMBRE SUR LA PAGE, devant le bec (sinon la planche la mange). C'est
          ce qui donne son poids à la tablette — et, quand il y a plusieurs
          rangées, ce qui décolle chacune de celle du dessous. */}
      <mesh position={[0, -THICK - SHADOW_H / 2, (THICK / 2) * NOSE_FLAT + 0.004]}>
        <planeGeometry args={[width, SHADOW_H]} />
        <meshBasicMaterial
          map={shadeTexture()}
          color="#000000"
          transparent
          opacity={skin.shadow}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// Cadrage du rayon : plein axe et à niveau, la rangée posée dans le bas du
// cadre. Renvoie la largeur visible au plan des objets (pour la planche, qui
// doit déborder du cadre). Ne pas passer par `viewport` : cette valeur suit la
// caméra du <Canvas>, pas celle qu'on pose.
function useFraming({ width, height, centerY }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const aspect = Math.max(0.4, size.width / size.height);
  const vTan = Math.tan((camera.fov * Math.PI) / 180 / 2);
  const forH = height / FILL / (2 * vTan);
  const forW = (width * 1.06) / (2 * vTan * aspect);
  const d = Math.min(9, Math.max(1.7, Math.max(forH, forW)));

  // Hauteur réellement visible à ce recul : elle dit combien de vide il reste
  // autour de la rangée, donc de combien on peut la faire descendre. La caméra
  // se contente de MONTER (regard toujours horizontal) : décaler le point visé
  // donnerait une perspective penchée, et les boîtiers verseraient.
  const visible = 2 * d * vTan;
  const eyeY = centerY + (visible - height) * (ABOVE - 0.5);

  useLayoutEffect(() => {
    camera.position.set(0, eyeY, d);
    camera.lookAt(0, eyeY, 0);
    camera.updateProjectionMatrix();
  }, [camera, d, eyeY]);

  return 2 * d * vTan * aspect;
}

function ShelfScene({
  media,
  art,
  hovered,
  held,
  taken,
  onHover,
  onPick,
  onAnchor,
  skin,
}) {
  // Une rangée centrée par planche, les tranches presque jointives.
  //
  // Les boîtiers n'ont PAS tous la même taille : un Blu-ray est plus court
  // qu'un DVD, un coffret plus épais. C'est voulu — c'est ce qui fait une
  // étagère plutôt qu'un présentoir. Deux conséquences ici : l'écart entre
  // deux planches se règle sur le PLUS GRAND des boîtiers (sinon la rangée du
  // dessus mange celle du dessous), et le cadrage se mesure sur lui aussi.
  //
  // En revanche tout le monde POSE sur la planche : `baseY` est le pied du
  // boîtier, jamais son centre, donc les hauteurs se mélangent d'elles-mêmes.
  const layout = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < media.length; i += PER_PLANK)
      chunks.push(media.slice(i, i + PER_PLANK));
    const widthOf = (row) => row.reduce((w, m) => w + boxOf(m).w + GAP, 0) - GAP;
    const width = Math.max(MIN_W, Math.max(...chunks.map(widthOf), 0) + EDGE * 2);

    const tallest = Math.max(BOX.dvd.h, ...media.map((m) => boxOf(m).h));
    const pitch = tallest + PLANK_AIR;

    const planks = chunks.map((row, r) => {
      const y = ((chunks.length - 1) * pitch) / 2 - r * pitch - tallest / 2;
      let x = -widthOf(row) / 2;
      const items = row.map((m) => {
        const at = x;
        x += boxOf(m).w + GAP;
        return { media: m, x: at, baseY: y };
      });
      return { items, y };
    });

    const bottomY = planks[planks.length - 1].y - THICK;
    const topY = planks[0].y + tallest;
    return {
      planks,
      width,
      topY,
      centerY: (bottomY + topY) / 2,
      height: topY - bottomY,
    };
  }, [media]);

  const frameW = useFraming(layout);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // Où se trouve, EN PIXELS, le boîtier survolé ? On projette le haut et le
  // bas de sa tranche : la bulle s'accroche au premier, et le décollage vers
  // la vitrine part du milieu, à la bonne échelle. Le calcul est fait ici,
  // dans le canvas, parce que c'est le seul endroit qui connaît la caméra.
  useEffect(() => {
    const item = hovered
      ? layout.planks
          .flatMap((p) => p.items)
          .find((i) => i.media.slug === hovered)
      : null;
    if (!item) {
      onAnchor(null);
      return;
    }
    const box = boxOf(item.media);
    camera.updateMatrixWorld();
    // On vise le boîtier PENCHÉ, pas celui qui dort au repos : on repasse par
    // le même pivot que l'animation (arête du bas, boîtier avancé et soulevé)
    // et on projette les deux bouts de sa tranche.
    const cos = Math.cos(HOVER.tilt);
    const sin = Math.sin(HOVER.tilt);
    const at = (h) => {
      const v = new THREE.Vector3(
        item.x + box.w / 2,
        item.baseY + HOVER.lift + h * cos - (box.d / 2) * sin,
        -box.d / 2 + HOVER.out + h * sin + (box.d / 2) * cos
      ).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * size.width,
        y: (-v.y * 0.5 + 0.5) * size.height,
      };
    };
    const top = at(box.h);
    const bottom = at(0);
    onAnchor({
      slug: item.media.slug,
      x: top.x,
      top: top.y,
      bottom: bottom.y,
      w: size.width,
    });
  }, [hovered, layout, camera, size, onAnchor]);

  // La planche TRAVERSE le cadre : une planche entièrement visible se lit
  // comme un petit objet flottant, une planche qui déborde comme une étagère.
  const plankW = Math.max(layout.width + 0.6, frameW * 1.35);

  return (
    <>
      {/* Les tranches sont face caméra : l'essentiel vient d'une frontale
          douce, les deux autres sources sculptent les arêtes. */}
      <ambientLight intensity={SHELF_RIG.ambient} color="#ffffff" />
      {SHELF_RIG.lights.map((l, i) => (
        <directionalLight key={i} position={l.at} intensity={l.power} color={l.tone} />
      ))}

      {layout.planks.map((plank, r) => (
        <group key={r}>
          <Plank width={plankW} y={plank.y} skin={skin} />
          {plank.items.map(({ media: m, x, baseY }) => (
            <ShelfCase
              key={m.slug}
              media={m}
              x={x}
              baseY={baseY}
              art={art[m.slug]}
              hovered={hovered === m.slug || held === m.slug}
              // Figé dès le clic, rendu à la vie une fois la vitrine refermée :
              // il reprend alors sa place en se recalant tout seul dans le rang.
              held={held === m.slug}
              taken={taken === m.slug}
              onHover={onHover}
              onPick={onPick}
            />
          ))}
        </group>
      ))}
    </>
  );
}

// -------------------------------------------------- la vitrine (en main) --

// Cadre le boîtier pour qu'il occupe ~82 % de la hauteur de la scène, quel que
// soit le format de la fenêtre (sur un écran étroit, c'est la largeur de la
// couverture qui borne). Il doit être franchement PLUS GROS qu'au rayon :
// c'est ce saut d'échelle qui fait lire « la jaquette sort et vient devant ».
// Ce que l'objet occupe de la hauteur visible, au repos. Nommé parce qu'il sert
// AUSSI à passer la pose au lecteur de volumes : c'est le taux de change entre
// les deux scènes, et deux valeurs qui divergeraient feraient sauter l'objet
// d'échelle au moment du relais.
const CASE_FIT = 1.32;

function caseFit(width, height, box) {
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const vTan = Math.tan((FOV * Math.PI) / 180 / 2);
  // Sur les dimensions DE CE boîtier : cadrer un Blu-ray comme un DVD le
  // laisserait flotter, et un coffret déborderait du cadre.
  const d = Math.max(
    (box.h * CASE_FIT) / (2 * vTan),
    (box.d * CASE_FIT) / (2 * vTan * aspect)
  );
  const visible = 2 * d * vTan;
  // La scène prend tout l'écran, mais le cartouche flotte en bas : on regarde
  // donc un peu plus bas que le boîtier, ce qui le remonte dans l'image et lui
  // dégage cette bande. Un point visé décalé, et non la caméra penchée : la
  // perspective ne doit pas basculer.
  return { d, vTan, visible, eye: -0.06 * visible };
}

function InspectorFit({ spin, from, box }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const { d, visible, eye } = caseFit(size.width, size.height, box);
    camera.position.set(0, eye, d);
    camera.lookAt(0, eye, 0);
    camera.updateProjectionMatrix();
    // Ce que vaut un pixel d'écran en unités de scène : le taux de change du
    // déplacement au clic droit, et de tout ce qui se calcule en pixels ici.
    const perPx = visible / Math.max(1, size.height);
    spin.current.perPx = perPx;

    // LE POINT DE DÉPART DU VOL. Le boîtier commence exactement là où il était
    // sur l'étagère — même centre, même taille — puis rejoint le milieu de la
    // scène. Tout se passe DANS la 3D : transformer le canvas en CSS ferait
    // mesurer à R3F un cadre déformé, et la scène partirait de travers.
    if (from) {
      const rect = gl.domElement.getBoundingClientRect();
      // `eye` : le boîtier au repos n'est pas au centre de l'image mais un peu
      // au-dessus — le départ du vol se mesure depuis ce même repère.
      spin.current.fly = {
        x: (from.x - (rect.left + rect.width / 2)) * perPx,
        y: eye + (rect.top + rect.height / 2 - from.y) * perPx,
        s: Math.max(0.05, (from.h * perPx) / box.h),
      };
    }
  }, [camera, size, gl, spin, from, box]);
  return null;
}

// L'éclairage de la vitrine, qui part de celui du rayon et devient le sien au
// fil du vol. Il ne « rallume » donc jamais le boîtier au moment de l'échange.
function InspectorLights({ spin }) {
  const amb = useRef(null);
  const a = useRef(null);
  const b = useRef(null);
  const c = useRef(null);
  const beams = [a, b, c];

  useFrame(() => {
    const s = spin.current;
    const t = s.fly ? easeInOut(s.flyT) : 1;
    if (amb.current) amb.current.intensity = mix(SHELF_RIG.ambient, CASE_RIG.ambient, t);
    for (let i = 0; i < beams.length; i++) {
      const light = beams[i].current;
      if (!light) continue;
      const from = SHELF_RIG.lights[i];
      const to = CASE_RIG.lights[i];
      light.position.set(
        mix(from.at[0], to.at[0], t),
        mix(from.at[1], to.at[1], t),
        mix(from.at[2], to.at[2], t)
      );
      light.intensity = mix(from.power, to.power, t);
      light.color.set(from.tone).lerp(SCRATCH.set(to.tone), t);
    }
  });

  return (
    <>
      <ambientLight ref={amb} intensity={SHELF_RIG.ambient} />
      {SHELF_RIG.lights.map((l, i) => (
        <directionalLight
          key={i}
          ref={beams[i]}
          position={l.at}
          intensity={l.power}
          color={l.tone}
        />
      ))}
    </>
  );
}

function SpinningCase({ media, art, spin, drag, onOpen, onReady, onZoom }) {
  const group = useRef(null);
  const close = useRef(false); // regarde-t-on le boîtier de près ?
  // Sans vol (tactile : pas de survol, donc pas de place d'origine connue), le
  // boîtier se contente de grandir un peu en arrivant.
  const pop = useRef(spin.current.intro < 1 ? 1 : 0.72);
  const told = useRef(false);
  const paper = useCasePaper(art);

  useFrame((_, raw) => {
    const g = group.current;
    if (!g) return;
    const s = spin.current;
    // Delta plafonné : à la toute première image (ce canvas vient d'ouvrir son
    // contexte et de téléverser ses textures) comme au retour d'un onglet mis
    // en veille, il vaut plusieurs dixièmes de seconde. Sans ce plafond, le
    // boîtier démarrerait son vol déjà entamé — donc pas exactement sur celui
    // du rayon, ce qui suffit à faire voir l'échange.
    const dt = Math.min(raw, 0.05);
    const k = Math.min(1, dt * 8);

    // ---- Le voyage. 0 = rangé sur l'étagère, 1 = présenté au centre. Le même
    // trajet sert dans les deux sens : on le rembobine pour ranger le boîtier.
    if (s.fly) {
      const step = dt / (s.back ? FLY_BACK : FLY_OUT);
      s.flyT = Math.max(0, Math.min(1, s.flyT + (s.back ? -step : step)));
    }
    const trip = s.fly ? easeInOut(s.flyT) : 1;

    // ---- L'assiette
    if (s.back) {
      // On le range : la tranche revient face à nous par le plus court chemin,
      // et il retrouve l'inclinaison exacte qu'il avait dans le rayon — de quoi
      // reprendre sa place sans que rien ne saute au moment de l'échange.
      const aim =
        Math.PI / 2 + Math.round((s.y - Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI;
      s.y += (aim - s.y) * Math.min(1, dt * HOME_RATE);
      s.x += (s.home - s.x) * Math.min(1, dt * HOME_RATE);
    } else if (s.intro < 1) {
      // Présentation : le boîtier SORT d'abord, encore de tranche comme on le
      // voyait rangé, et ne se retourne qu'ensuite. Les deux mouvements menés
      // ensemble donnaient une toupie, pas un objet qu'on nous présente.
      //
      // ET IL NE TOURNE PAS DU MÊME CÔTÉ SELON LE SENS DE LECTURE. Un volume
      // rangé montre sa tranche ; sa couverture est de l'autre côté du dos
      // selon qu'il s'ouvre à gauche ou à droite. Un manga se retourne donc
      // dans l'autre sens pour se présenter — et c'est le geste qu'on ferait
      // avec l'objet en main.
      s.intro = Math.min(1, s.intro + dt / (s.fly ? FLY_OUT : 0.75));
      const turn = s.fly ? Math.max(0, (s.intro - 0.3) / 0.7) : s.intro;
      s.y = mix(Math.PI / 2, s.face, easeOut(Math.min(1, turn)));
      s.x = s.home + (-0.05 - s.home) * trip; // il se redresse en venant
      s.lastTouch = performance.now();
    } else if (performance.now() - s.lastTouch > IDLE_DELAY) {
      // Le présentoir : dès qu'on n'y touche plus, le boîtier reprend sa
      // rotation tout seul et son assiette se redresse en douceur.
      s.y += dt * IDLE_SPEED;
      s.x += (-0.05 - s.x) * Math.min(1, dt * 2.5);
    }

    g.rotation.y = -Math.PI / 2 + s.y; // -90° : la couverture regarde l'écran
    g.rotation.x = s.x;

    // ---- La place et la taille : ce qui reste du trajet s'ajoute au
    // déplacement au clic droit, amorti lui aussi.
    const rest = 1 - trip;
    s.panViewX += (s.panX - s.panViewX) * k;
    s.panViewY += (s.panY - s.panViewY) * k;
    g.position.set(
      s.panViewX + (s.fly ? s.fly.x * rest : 0),
      s.panViewY + (s.fly ? s.fly.y * rest : 0),
      0
    );

    pop.current += (1 - pop.current) * Math.min(1, dt * 5.5);
    const flight = s.fly ? s.fly.s + (1 - s.fly.s) * trip : 1;
    // Le zoom molette est un simple facteur d'échelle, amorti lui aussi pour
    // que la molette donne un mouvement de caméra et pas des à-coups.
    g.scale.setScalar(pop.current * flight * s.zoomView);
    s.zoomView += (s.zoom - s.zoomView) * Math.min(1, dt * 8);

    // Cette image-ci contient le boîtier, à sa place et dans sa pose : c'est
    // maintenant, et pas avant, qu'on peut retirer celui du rayon. Prévenir
    // dès le montage laissait un trou le temps que ce canvas ouvre son
    // contexte et téléverse ses textures — le fameux « il disparaît ».
    if (!told.current) {
      told.current = true;
      onReady?.();
    }

    // Zoomer, c'est examiner : le cartouche du bas s'écarte pour laisser tout
    // l'écran à l'objet. Le seuil n'est signalé qu'au franchissement.
    const near = s.zoom > 1.08;
    if (near !== close.current) {
      close.current = near;
      onZoom?.(near);
    }
  });

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        if (mainButton(e) && !drag.current.moved) onOpen();
      }}
    >
      <CaseModel media={media} box={boxOf(media)} paper={paper} cuts={art?.cuts} />
    </group>
  );
}

// Le bouton droit sert à déplacer l'objet : il ne doit ni ouvrir la fiche, ni
// refermer la vitrine. On ne réagit donc qu'au bouton principal.
function mainButton(e) {
  return (e?.nativeEvent?.button ?? e?.button ?? 0) === 0;
}

function CaseInspector({
  media,
  art,
  from,
  onClose,
  onOpen,
  onRead,
  onPlay,
  onReady,
  onSettle,
}) {
  useScrollLock(true);
  const { token } = useAuth();
  // La discussion du titre, glissée par la droite. L'objet reste en main et
  // continue de tourner derrière : on ne quitte pas la vitrine pour lire ce
  // qu'on dit de l'objet qu'on y tient.
  const [commenting, setCommenting] = useState(false);

  // QUELLE FACE EST LA COUVERTURE. Sur un volume qui se lit de droite à gauche,
  // la couverture est de l'AUTRE CÔTÉ du dos : ce que la jaquette range en
  // quatrième de couverture est, pour un manga, la première. On ne retourne
  // donc pas l'objet — on le présente par son autre face, d'un demi-tour, et
  // tout le reste (le vol, le présentoir, le rangement) suit sans rien savoir
  // du sens de lecture. Le lecteur 3D fait déjà le même raisonnement de son
  // côté (son miroir de scène) : les deux montrent enfin la même image.
  const face = isRtl(media) ? Math.PI : 0;

  // Rotation, zoom et déplacement en ref, pas en state : ils bougent à chaque
  // frame et à chaque pixel de souris — un rendu React à ce rythme ferait
  // ramer la scène.
  const spin = useRef({
    // Venu de l'étagère, il arrive exactement aussi penché qu'il l'était au
    // clic — et c'est là qu'il devra revenir pour se ranger.
    x: from ? from.tilt : -0.05,
    home: from ? from.tilt : HOVER.tilt,
    face,
    // Venu de l'étagère, le boîtier arrive DE TRANCHE, exactement comme on le
    // voyait rangé ; sinon (tactile, pas de survol) il se présente de face.
    y: from ? Math.PI / 2 : face + 0.35,
    intro: from ? 0 : 1,
    fly: null, // point de départ du vol, posé par InspectorFit
    flyT: 0,
    back: false, // on le range : le trajet se rembobine
    zoom: 1,
    zoomView: 1,
    panX: 0,
    panY: 0,
    panViewX: 0,
    panViewY: 0,
    perPx: 0.002,
    lastTouch: performance.now(),
  });
  const drag = useRef({ down: false, moved: false, pan: false, x: 0, y: 0 });

  // ON LE RANGE. Le boîtier ne disparaît pas : il se remet de tranche, repart
  // se glisser à sa place dans le rayon, et l'écran ne s'efface qu'une fois
  // qu'il y est presque — à la fin, celui de l'étagère reprend la main
  // exactement dans la même pose, l'échange ne se voit pas.
  const [leaving, setLeaving] = useState("");
  // Le voile ne se pose qu'une fois le boîtier dessiné ici, et le cartouche
  // s'écarte dès qu'on zoome : deux états, pas deux rendus par image (les
  // seuils sont franchis une fois, pas soixante fois par seconde).
  const [veiled, setVeiled] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const close = useCallback(() => {
    const s = spin.current;
    if (s.back) return; // déjà en train de se ranger
    if (s.fly) {
      s.back = true;
      s.intro = 1;
      s.zoom = 1;
      s.panX = 0;
      s.panY = 0;
    }
    setLeaving(s.fly ? "leaving" : "leaving fast");
    // Le temps du retour, plus un souffle : les durées suivent FLY_BACK, elles
    // ne doivent jamais être recopiées à la main.
    const trip = s.fly ? Math.round(FLY_BACK * 1000) + 40 : 220;
    // Le boîtier du rayon se rallume juste AVANT qu'on démonte celui-ci : ils
    // se superposent une poignée d'images, dans la même pose, et le relais ne
    // se voit pas. Démonter d'abord laisserait le même trou qu'à l'ouverture.
    setTimeout(onSettle, Math.max(0, trip - 60));
    setTimeout(onClose, trip);
  }, [onClose, onSettle]);

  useBackClose(close, "case");

  // LA POSE, AU MOMENT PRÉCIS OÙ L'ON DEMANDE À OUVRIR. Le lecteur de volumes
  // est une autre scène, avec sa caméra et son cadrage : lui passer des unités
  // de celle-ci n'aurait aucun sens. On lui passe donc des FRACTIONS DE LA
  // HAUTEUR VISIBLE, seul repère commun, et il repart exactement de là — même
  // assiette, même taille à l'écran. Sans ça, le volume qu'on tenait disparaît
  // et un autre surgit à sa place.
  const poseNow = useCallback(() => {
    const s = spin.current;
    const box = boxOf(media);
    const visible = box.h * CASE_FIT;
    return {
      // Ramené au tour le plus proche : le présentoir tourne en continu, `y`
      // vaut donc n'importe quoi, et le volume ferait autant de tours qu'il en
      // avait accumulés avant de se présenter.
      //
      // Et mesuré DEPUIS SA FACE DE PRÉSENTATION, pas depuis le zéro de cette
      // scène-ci : ce qu'on transmet, c'est « de combien l'objet est tourné
      // par rapport à nous », seule chose qui ait un sens dans une autre scène.
      // Un manga présenté bien en face vaut donc zéro, comme n'importe quel
      // volume — sinon le lecteur, qui a son propre repère, le prendrait pour
      // un demi-tour à rattraper et le ferait pivoter en s'ouvrant.
      spinY: normalizeTurn(s.y - s.face),
      tilt: s.x,
      height: s.zoomView / CASE_FIT,
      panX: s.panViewX / visible,
      panY: s.panViewY / visible,
    };
  }, [media]);

  // ENTRÉE — ET L'ESPACE — FONT LA CHOSE ÉVIDENTE : la même que le clic sur
  // l'objet. Un volume s'ouvre, un jeu se lance, un boîtier vidéo renvoie à sa
  // fiche. Prendre un livre en main pour devoir aller chercher un bouton à la
  // souris, c'est une marche de trop entre le rayon et la lecture.
  //
  // LES DEUX TOUCHES, parce que la main n'est pas au même endroit selon d'où
  // l'on vient : le pouce tombe sur la barre, l'index sur Entrée, et hésiter
  // entre les deux devant un livre qu'on tient déjà est absurde. L'espace
  // continue d'ailleurs la lecture une fois le volume ouvert (il y allume la
  // lecture guidée), donc c'est la même touche du début à la fin.
  //
  // ET LE CLAVIER PASSE LA MAIN quand la discussion est ouverte : on y écrit.
  // Échap doit refermer le panneau (il s'en charge) et non reposer le boîtier
  // sous le message en cours de frappe, et l'espace appartient au texte. Le
  // garde-fou plus bas ne couvre que le champ lui-même — il suffirait à protéger
  // la saisie, pas le reste du panneau, où une barre d'espace ouvrirait le
  // volume derrière.
  useEffect(() => {
    if (commenting) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") return close();
      if (e.key === "Enter" || e.key === " ") {
        // Sauf si le clavier est POSÉ SUR un bouton (croix, « la fiche ») : là,
        // la touche lui appartient, et ouvrir en même temps ferait deux gestes
        // pour une seule frappe.
        if (e.target?.closest?.("button, a, input, select, textarea")) return undefined;
        // L'espace fait défiler la page par défaut — ici il n'y a rien à faire
        // défiler, mais le navigateur ne le sait pas.
        e.preventDefault();
        return onRead ? onRead(poseNow()) : onPlay ? onPlay() : onOpen();
      }
      return undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, onRead, onPlay, onOpen, poseNow, commenting]);

  function down(e) {
    // Bouton droit : on déplace l'objet dans le cadre. Bouton gauche : on le
    // fait tourner. Toucher le boîtier interrompt sa présentation.
    drag.current = {
      down: true,
      moved: false,
      pan: e.button === 2,
      x: e.clientX,
      y: e.clientY,
    };
    spin.current.intro = 1;
  }

  function move(e) {
    const d = drag.current;
    if (!d.down) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true;
    if (!d.moved) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const s = spin.current;
    if (d.pan) {
      // Bridé large : de quoi amener n'importe quel coin de la jaquette au
      // centre une fois zoomé, sans pouvoir perdre l'objet hors du cadre.
      const lim = 0.6 * Math.max(1, s.zoomView || 1);
      s.panX = Math.max(-lim, Math.min(lim, s.panX + dx * s.perPx));
      s.panY = Math.max(-lim, Math.min(lim, s.panY - dy * s.perPx));
    } else {
      s.y += dx * 0.012;
      // Bridé : au-delà, on regarde le boîtier par le chant du haut.
      s.x = Math.max(-0.7, Math.min(0.7, s.x + dy * 0.009));
    }
    s.lastTouch = performance.now();
  }

  function up() {
    drag.current.down = false;
    // Le drapeau ne retombe qu'après le « click » que le navigateur va émettre
    // à la fin d'un cliquer-déplacer — sinon chaque rotation ouvrirait la fiche.
    setTimeout(() => (drag.current.moved = false), 0);
  }

  function wheel(e) {
    const s = spin.current;
    s.zoom = Math.max(0.55, Math.min(3, s.zoom - Math.sign(e.deltaY) * 0.12));
    // Zoomer, c'est examiner : la rotation automatique laisse la main.
    s.intro = 1;
    s.lastTouch = performance.now();
  }

  return createPortal(
    <div
      className={`coll-inspect ${leaving} ${veiled && !leaving ? "veiled" : ""} ${
        zoomed ? "zoomed" : ""
      }`}
      role="dialog"
      aria-label={media.title}
      style={{ "--tint": media.color || "var(--orange)" }}
    >
      <button
        className="coll-inspect-close clickable"
        onClick={close}
        aria-label="Reposer le boîtier"
      >
        <X size={18} />
      </button>

      <div
        className="coll-inspect-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onWheel={wheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Canvas
          // La même densité — et le même rendu des couleurs — que le rayon : au
          // moment du relais, les deux exemplaires doivent être dessinés
          // exactement pareil.
          dpr={[1, 1.75]}
          flat
          gl={{ alpha: true, antialias: true }}
          camera={{ fov: FOV, position: [0, 0, 2.8] }}
          onPointerMissed={(e) => {
            if (mainButton(e) && !drag.current.moved) close();
          }}
        >
          <InspectorFit spin={spin} from={from} box={boxOf(media)} />
          <InspectorLights spin={spin} />
          <SpinningCase
            media={media}
            art={art}
            spin={spin}
            drag={drag}
            // Cliquer l'objet fait la chose évidente : un volume s'ouvre, un
            // jeu se lance, un boîtier vidéo renvoie à sa fiche (son contenu
            // est ailleurs).
            onOpen={() => (onRead ? onRead(poseNow()) : onPlay ? onPlay() : onOpen())}
            onZoom={setZoomed}
            onReady={() => {
              setVeiled(true);
              onReady?.();
            }}
          />
        </Canvas>
      </div>

      <footer className="coll-inspect-info">
        <div className="coll-inspect-card">
          <div className="coll-inspect-text">
            {media.franchise && (
              <em className="coll-inspect-franchise">{media.franchise}</em>
            )}
            <strong>{media.title}</strong>
            <span className="coll-inspect-meta">
              {isComic(media)
                ? `Volume${media.pageCount ? ` · ${media.pageCount} planches` : ""}`
                : isGame(media)
                  ? `${CONSOLE}${
                      media.cartridge?.region ? ` · ${media.cartridge.region}` : ""
                    }`
                  : media.kind === "series"
                    ? `Série · ${media.episodeCount} épisodes`
                    : "Film"}
              {fmtYears(media) ? ` · ${fmtYears(media)}` : ""}
            </span>
          </div>
          {/* Le papier et le jeu ont DEUX suites : la bonne (l'ouvrir, le
              lancer — ce qu'on veut neuf fois sur dix) et sa fiche. Un boîtier
              vidéo n'en a qu'une, son contenu vit ailleurs. Et TOUS ont la
              discussion.

              L'ORDRE DIT OÙ ÇA MÈNE. D'abord ce pour quoi on a pris l'objet,
              puis la discussion — qui ne quitte pas la vitrine, elle glisse à
              côté de l'objet resté en main — et en dernier la fiche, la seule
              qui fasse vraiment sortir d'ici. On s'éloigne de l'objet en allant
              vers la droite. */}
          <div className="coll-inspect-acts">
            {(onRead || onPlay) && (
              <button
                className="btn btn-primary clickable"
                onClick={() => (onRead ? onRead(poseNow()) : onPlay())}
              >
                {onRead ? (
                  <>
                    <BookOpen size={16} /> Ouvrir
                  </>
                ) : (
                  <>
                    <Gamepad2 size={16} /> Jouer
                  </>
                )}
              </button>
            )}
            <button
              className="btn btn-ghost clickable coll-inspect-talk"
              onClick={() => setCommenting(true)}
              title="Ce qu'on dit de ce titre"
            >
              <MessageCircle size={16} /> <span>Commentaires</span>
            </button>
            {/* Sur un boîtier vidéo, la fiche est la SEULE suite : elle reprend
                alors le premier rôle, et son libellé le dit. */}
            <button
              className={`btn clickable ${onRead || onPlay ? "btn-ghost" : "btn-primary"}`}
              onClick={onOpen}
            >
              <ArrowRight size={16} /> {onRead || onPlay ? "La fiche" : "Ouvrir la fiche"}
            </button>
          </div>
        </div>
        <span className="coll-inspect-hint">
          Attrape-le pour le retourner · clic droit pour le déplacer · molette
          pour zoomer · clique-le ou Entrée pour{" "}
          {onRead ? "l'ouvrir" : onPlay ? "y jouer" : "ouvrir"} · Échap pour le
          reposer
        </span>
      </footer>

      {/* Monté à part, sur le corps de la page : il ne peut pas vivre dans la
          vitrine, qui capte le doigt pour faire pivoter le boîtier (voir le
          commentaire du panneau). */}
      {commenting && (
        <CollectionCommentsPanel
          media={media}
          token={token}
          onClose={() => setCommenting(false)}
        />
      )}
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------ page --

export default function CollectionShelf({ media, onSelect, theme = "light" }) {
  const { token } = useAuth();
  const [hovered, setHovered] = useState(null);
  const [anchor, setAnchor] = useState(null); // position écran du survolé
  const [inspected, setInspected] = useState(null); // { media, from } — boîtier
  const [reading, setReading] = useState(null); // { media, from } — volume
  const [playing, setPlaying] = useState(null); // le jeu en cours, console allumée
  // Le boîtier retiré du rayon. Volontairement distinct de `inspected` : sa
  // place ne se vide qu'une fois que la vitrine a vraiment dessiné le sien,
  // et se remplit à nouveau juste avant qu'elle ne s'efface.
  const [taken, setTaken] = useState(null);
  const [art, setTextures] = useState({});
  const [pages, setPages] = useState({}); // planches déjà rapatriées, par slug
  const [missingArt, setMissingArt] = useState(0);
  const wrapRef = useRef(null);
  const skin = PLANK[theme] || PLANK.light;

  // Stable : la scène la garde en dépendance d'effet, une nouvelle identité à
  // chaque rendu la ferait tourner en boucle.
  const onAnchor = useCallback((a) => setAnchor(a), []);

  // Peinture des boîtiers, au niveau page : les textures servent aux DEUX
  // canvas (rayon + vitrine), en série pour ne pas figer l'image.
  useEffect(() => {
    let alive = true;
    (async () => {
      let failures = 0;
      for (const m of media) {
        const painted = await paintCase(m);
        if (!alive) return;
        if (!painted.artwork) failures += 1;
        // `Texture` et non `CanvasTexture` : la feuille peut être un canvas
        // (jaquette composée) comme une image (jaquette fournie telle quelle,
        // qu'on ne recopie plus dans un canvas pour rien).
        const sheet = new THREE.Texture(painted.sheet);
        sheet.colorSpace = THREE.SRGBColorSpace;
        sheet.anisotropy = 8;
        sheet.needsUpdate = true;
        setTextures((prev) => ({
          ...prev,
          // `cuts` voyage avec la texture : c'est lui qui dit à la géométrie où
          // placer les deux plis sur le contour du boîtier.
          [m.slug]: { sheet, cuts: painted.cuts },
        }));
      }
      if (alive) setMissingArt(failures);
    })();
    return () => {
      alive = false;
    };
  }, [media]);

  // Libération au démontage — lues en ref, sinon le nettoyage ne verrait que
  // l'objet vide du premier rendu.
  const liveTextures = useRef({});
  liveTextures.current = art;
  useEffect(
    () => () => {
      for (const set of Object.values(liveTextures.current)) {
        for (const t of Object.values(set)) t?.dispose?.();
      }
    },
    []
  );

  // LES PLANCHES SE CHERCHENT PENDANT QU'ON RETOURNE LE VOLUME. Elles ne partent
  // pas avec la liste du rayon (une centaine d'URL par titre), et les demander
  // au moment du clic sur « ouvrir » plaçait une seconde d'attente exactement là
  // où l'on veut voir le volume s'ouvrir. La vitrine, elle, dure le temps qu'on
  // veut : c'est le bon moment pour aller les chercher.
  useEffect(() => {
    const m = inspected?.media;
    if (!m || !isComic(m) || pages[m.slug]) return undefined;
    let alive = true;
    apiFetch(`/collection/${m.slug}`, { token })
      .then((d) => {
        if (!alive) return;
        const got = d.media?.pages || [];
        setPages((p) => ({ ...p, [m.slug]: got }));
        // Et on tire les deux premières dans le cache du navigateur : c'est
        // elles qui décident si le volume s'ouvre tout de suite. `crossOrigin`
        // est obligatoire — sans lui, le navigateur garde une entrée de cache
        // SÉPARÉE de celle que réclamera la texture, et le préchargement n'aura
        // servi à rien (voir `loadImage`).
        for (const pg of got.slice(0, 2)) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = pg.src;
        }
      })
      .catch(() => {
        /* pas grave : le lecteur ira les chercher lui-même */
      });
    return () => {
      alive = false;
    };
  }, [inspected, token, pages]);

  // Le volume tel qu'on le passe au lecteur : le sien, plus ses planches si
  // elles sont déjà arrivées.
  const readMedia = useMemo(() => {
    if (!reading) return null;
    const got = pages[reading.media.slug];
    return got ? { ...reading.media, pages: got } : reading.media;
  }, [reading, pages]);

  // La bulle garde le dernier titre survolé le temps de sa disparition : la
  // vider dès la sortie du curseur ferait clignoter une carte vide.
  const held = useRef(null);
  if (anchor) {
    const m = media.find((x) => x.slug === anchor.slug);
    if (m) held.current = { media: m, anchor };
  }
  const tip = held.current;
  const showTip = !!anchor && !inspected && !reading;

  // Recadrage horizontal : la carte reste dans le canvas, la pointe reste sur
  // le boîtier — d'où le décalage `--tail` entre les deux.
  const half = BUBBLE_W / 2 + 10;
  const tipX = tip
    ? Math.min(Math.max(tip.anchor.x, half), Math.max(half, tip.anchor.w - half))
    : 0;

  const prog = tip?.media.progress;
  const pct =
    prog && prog.durationSeconds > 0
      ? Math.min(100, (prog.positionSeconds / prog.durationSeconds) * 100)
      : 0;

  function pick(m, origin) {
    // La vitrine s'ouvrira DEPUIS la place du boîtier sur l'étagère, et non
    // d'un point de fuite abstrait. `origin` est relevé dans la scène au moment
    // même du clic ; on le passe en repères de la fenêtre, seuls communs aux
    // deux canvas.
    const rect = wrapRef.current?.getBoundingClientRect();
    const from =
      rect && origin
        ? { x: rect.left + origin.x, y: rect.top + origin.y, h: origin.h, tilt: origin.tilt }
        : null;
    setInspected({ media: m, from });
  }

  // Le volume passe D'ABORD par la vitrine, comme un boîtier : on le retourne,
  // on regarde ses deux plats, on lit son dos. C'est seulement quand on demande
  // à l'ouvrir qu'il s'ouvre — un objet qu'on ne peut plus regarder sans
  // déclencher sa lecture n'est plus un objet, c'est un bouton.
  //
  // Il ne repart PAS au rayon entre les deux, et il ne disparaît pas non plus le
  // temps que l'autre scène s'allume : la vitrine RESTE MONTÉE jusqu'à ce que le
  // lecteur ait dessiné le volume dans la même pose (`onLanded`). Les deux se
  // superposent une poignée d'images, et le relais ne se voit pas — c'est déjà
  // ce que font le rayon et la vitrine entre eux.
  function read(m, pose) {
    // LA PLACE SUR LA PLANCHE VOYAGE AVEC LE VOLUME. `pose` dit d'où il vient
    // (la main, dans la vitrine) ; `from` dit où il RETOURNE — son emplacement
    // exact dans le rayon, relevé au moment du clic. Sans elle, refermer un
    // volume le faisait simplement disparaître de l'écran, là où un DVD, lui,
    // repart se ranger. Les deux repères ne se contredisent pas : le lecteur
    // se sert du premier pour arriver et du second pour repartir.
    setReading({ media: m, from: inspected?.from || null, pose });
  }

  // LE JEU, LUI, RANGE LE BOÎTIER D'ABORD. Le volume garde sa vitrine le temps
  // du relais parce que les deux scènes montrent le même objet et qu'on veut
  // voir passer l'une dans l'autre ; ici la console n'a rien à voir avec un
  // boîtier qui tourne — la laisser derrière, ce serait deux canvas WebGL et un
  // émulateur à faire tourner en même temps, pour une scène que personne ne
  // regarde.
  function play(m) {
    setInspected(null);
    setTaken(null);
    setPlaying(m);
  }

  // Le temps de jeu part directement d'ici : le rayon n'a pas d'état de
  // progression à tenir à jour, il le relira à la prochaine visite.
  function savePlayed(slug, seconds) {
    apiFetch(`/collection/${slug}/played`, {
      method: "POST",
      token,
      body: { seconds },
    }).catch(() => {
      /* un compteur de temps de jeu ne mérite pas d'alerte */
    });
  }

  // Les jaquettes se peignent en série : tant que la première n'est pas prête,
  // le rayon n'est qu'une rangée de coques blanches. On garde donc le squelette
  // par-dessus jusque-là, et la scène se révèle en fondu — l'étagère se garnit
  // au lieu d'apparaître nue puis de se remplir sous les yeux. Le squelette
  // reste monté le temps du fondu, sinon il disparaît d'un coup sur une scène
  // encore transparente.
  const dressed = Object.keys(art).length > 0;
  const [skelGone, setSkelGone] = useState(false);
  useEffect(() => {
    if (!dressed) return undefined;
    const t = setTimeout(() => setSkelGone(true), 500);
    return () => clearTimeout(t);
  }, [dressed]);

  return (
    // `--slots` borne la largeur du canvas selon le nombre d'objets : deux
    // titres dans un cadre pleine largeur seraient minuscules et perdus.
    <div
      ref={wrapRef}
      className={`coll-shelf3d ${hovered ? "is-hover" : ""} ${
        dressed ? "is-dressed" : ""
      }`}
      style={{ "--slots": media.length }}
    >
      {!skelGone && (
        <ShelfSkeleton
          label="Chargement de l'étagère…"
          count={Math.min(14, media.length)}
        />
      )}

      <Canvas
        dpr={[1, 1.75]}
        // `flat` : PAS de courbe cinéma (ACES) sur les boîtiers. Elle écrase les
        // hautes lumières et délave les couleurs — sur une jaquette, qui est une
        // image déjà étalonnée, c'est du voile blanc gratuit. Rendu direct, la
        // jaquette sort exactement comme elle a été peinte (lib/collection.js),
        // ce qui suppose un éclairage calé à ~1 : voir SHELF_RIG.
        flat
        // alpha : la page se voit à travers, la planche en sort vraiment.
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 2.6], fov: 36 }}
        onPointerMissed={() => setHovered(null)}
      >
        <ShelfScene
          media={media}
          art={art}
          hovered={hovered}
          held={inspected?.media.slug || reading?.media.slug}
          taken={taken}
          onHover={setHovered}
          onPick={pick}
          onAnchor={onAnchor}
          skin={skin}
        />
      </Canvas>

      {/* La bulle du boîtier survolé : en HTML par-dessus la scène, mais
          ancrée sur SA position à l'écran — la typographie du site y est bien
          plus lisible qu'une texture 3D, et l'étiquette reste à lui. */}
      <div
        className={`coll-shelf-bubble ${showTip ? "show" : ""}`}
        aria-hidden="true"
        style={
          tip
            ? {
                left: `${tipX}px`,
                top: `${tip.anchor.top}px`,
                "--tail": `${tip.anchor.x - tipX}px`,
                "--tint": tip.media.color || "var(--orange)",
              }
            : undefined
        }
      >
        {tip && (
          <>
            <span className="coll-bubble-shot">
              {tip.media.poster ? (
                <img src={tip.media.poster} alt="" loading="lazy" />
              ) : (
                <i>{tip.media.title.slice(0, 1)}</i>
              )}
            </span>
            <span className="coll-bubble-text">
              {tip.media.franchise && <em>{tip.media.franchise}</em>}
              <strong>{tip.media.title}</strong>
              <span className="coll-bubble-meta">
                <b>{isGame(tip.media) ? CONSOLE : KINDS[tip.media.kind]?.label || "Film"}</b>
                {fmtYears(tip.media) ? ` · ${fmtYears(tip.media)}` : ""}
                {isComic(tip.media) && tip.media.pageCount
                  ? ` · ${tip.media.pageCount} planches`
                  : isGame(tip.media) && tip.media.cartridge?.region
                    ? ` · ${tip.media.cartridge.region}`
                    : tip.media.kind === "series" && tip.media.episodeCount
                      ? ` · ${tip.media.episodeCount} ép.`
                      : ""}
              </span>
              {pct > 0 && (
                <span className="coll-bubble-bar">
                  <i style={{ width: `${pct}%` }} />
                </span>
              )}
            </span>
          </>
        )}
      </div>

      {missingArt > 0 && (
        <p className="coll-shelf-warn">
          {missingArt} visuel{missingArt > 1 ? "s" : ""} n'a pas pu être chargé sur les
          boîtiers.
        </p>
      )}

      <span className="coll-shelf-hint" aria-hidden="true">
        Survole un titre · clique pour le prendre en main — un volume s'ouvre et
        se lit, un jeu se lance
      </span>

      {/* Le volume ouvert descend à la demande : sa scène (une page déformée à
          chaque image, les textures des planches) n'a rien à faire dans le
          paquet du rayon. Le repli est vide — l'étagère reste sous les yeux, et
          le volume, lui, ne quitte sa place qu'une fois le lecteur dessiné. */}
      {reading && (
        <Suspense fallback={null}>
          <BookReader3D
            media={readMedia}
            art={art[reading.media.slug]}
            from={reading.from}
            pose={reading.pose}
            onLanded={() => {
              setTaken(reading.media.slug);
              // Le volume est dessiné ici, dans la pose de la vitrine, et le
              // lecteur pose son voile DANS LE MÊME RENDU : les deux scènes
              // partagent le décor, il n'y a donc rien à attendre — et deux
              // voiles empilés une seule image se verraient.
              setInspected(null);
            }}
            onSettle={() => setTaken(null)}
            onClose={() => {
              setTaken(null);
              setReading(null);
            }}
          />
        </Suspense>
      )}

      {inspected && (
        <CaseInspector
          media={inspected.media}
          art={art[inspected.media.slug]}
          from={inspected.from}
          onReady={() => setTaken(inspected.media.slug)}
          onSettle={() => setTaken(null)}
          onClose={() => {
            setTaken(null);
            setInspected(null);
          }}
          onOpen={() => onSelect(inspected.media)}
          // LA POSE VOYAGE. `poseNow()` dit où en est le volume dans la main —
          // son assiette, son quart de tour, son zoom — et le lecteur reprend
          // exactement là (voir `pose` dans BookReader3D). L'oublier, comme le
          // faisait cette flèche qui avalait son argument, faisait surgir le
          // volume à plat et à une autre échelle par-dessus celui qu'on tenait.
          onRead={isComic(inspected.media) ? (pose) => read(inspected.media, pose) : null}
          // Un boîtier de jeu sans cartouche déposée n'a rien à proposer :
          // mieux vaut sa fiche, qui le dit, qu'un bouton qui échoue.
          onPlay={
            isGame(inspected.media) && inspected.media.cartridge?.rom
              ? () => play(inspected.media)
              : null
          }
        />
      )}

      {playing && (
        <Suspense fallback={null}>
          <GbaPlayer
            media={playing}
            token={token}
            onPlayed={(seconds) => savePlayed(playing.slug, seconds)}
            onClose={() => setPlaying(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
