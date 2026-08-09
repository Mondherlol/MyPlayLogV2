import {
  Suspense,
  lazy,
  memo,
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
  fmtYears,
  isComic,
  isGame,
  isRtl,
  KINDS,
} from "../lib/collection";
import {
  caseArt,
  dressAll,
  isReady,
  prefetch,
  readyArt,
  trim,
  HI_QUALITY,
} from "../lib/caseTextures";
import { plankTextures, shadeTexture } from "../lib/caseGeometry";
// L'objet lui-même (coque, jaquette, bloc de pages) vit à part : la vitrine
// d'ici et la machine à capsules de l'arcade doivent montrer EXACTEMENT le même
// boîtier. Voir CaseObject.jsx.
import { CaseModel, useCasePaper } from "./CaseObject";

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
// La densité par défaut. Ce n'est PLUS un nombre de boîtiers par planche (une
// rangée en prend autant que la page est large, voir `shelfFit`) mais la
// densité non réglée, celle dont `CASE_PX` tire une taille de boîtier.
const PER_PLANK = 20;
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

// Le geste du RANGEMENT, qui n'est pas celui du survol : là on ne présente pas
// l'objet, on le porte. Il sort franchement de la rangée (assez pour passer
// DEVANT ses voisins sans les traverser), se soulève de la planche, et se penche
// à peine — juste ce qu'il faut pour qu'il ait l'air décollé et non posé.
const CARRY = { lift: 0.05, out: 0.42, tilt: 0.1 };

// Cadrage du rayon. Le vide autour de la pile de planches est une MARGE FIXE,
// en unités de scène — jamais une fraction de la hauteur.
//
// C'était une fraction (74 % de la hauteur visible pour la rangée) et c'est
// précisément ce qui rendait le rayon illisible : à deux planches, le quart de
// vide devenait deux fois plus grand, la caméra reculait d'autant, et les
// tranches partaient au loin. Une marge fixe ne dépend pas du nombre de
// rangées, donc un boîtier fait la même taille qu'il y en ait une ou six.
//
// SKY est le ciel au-dessus de la rangée du haut : c'est là que sort la bulle
// de survol, elle a juste besoin de sa hauteur. FLOOR est le peu d'air sous la
// planche du bas, pour son ombre portée.
const SKY = 0.42;
const FLOOR = 0.18;

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

  // ---- LES BOIS, choisis à la main ----------------------------------------
  // Les deux premières entrées SUIVENT LA PAGE : elles sont neutres parce
  // qu'elles n'ont pas le droit d'avoir un avis, le thème décidant pour elles.
  // Celles-ci sont un choix, donc elles ont le droit d'en être un — un vrai ton
  // de bois, assez présent pour qu'on voie qu'on a changé de meuble. La texture
  // de fibres (`plankTextures`) est peinte en gris clair puis TEINTÉE par ces
  // couleurs : elle tient donc n'importe quelle essence sans être repeinte.
  //
  // Le dessus est toujours plus sombre que le bec : le premier reçoit la lumière
  // du plafond en rasant, le second est l'arête que les mains polissent.
  chene: {
    top: "#d9bd8d",
    nose: "#e8cfa4",
    body: "#ab8757",
    contact: 0.42,
    shadow: 0.22,
  },
  noyer: {
    top: "#7a5539",
    nose: "#8d6444",
    body: "#4d3222",
    contact: 0.5,
    shadow: 0.26,
  },
  // Le meuble de vidéoclub : stratifié noir, mat, celui qui disparaît derrière
  // ce qu'il porte.
  laque: {
    top: "#26262c",
    nose: "#33333c",
    body: "#141418",
    contact: 0.52,
    shadow: 0.3,
  },
};

// Ce que la barre d'outils propose. Ici et pas dans la page : la liste des
// meubles disponibles est une propriété de la scène, la page ne fait que la
// donner à choisir.
export const SHELF_SKINS = [
  { value: "", label: "Selon le thème" },
  { value: "chene", label: "Chêne" },
  { value: "noyer", label: "Noyer" },
  { value: "laque", label: "Laqué" },
];

// La densité du rayon : de grosses tranches sur peu d'étages, ou le mur du
// vidéoclub. Ce n'est plus un COMPTE par planche (voir `shelfFit` : combien de
// boîtiers tiennent sur une planche dépend de la largeur de la page, pas d'un
// réglage), mais la TAILLE d'un boîtier à l'écran.
//
// Les valeurs restent 10 / 20 / 34 : ce sont celles déjà enregistrées dans les
// rayons réglés, et les changer aurait demandé une migration pour un libellé
// qui, lui, ne bouge pas.
export const SHELF_DENSITIES = [
  { value: 10, label: "Large" },
  { value: 20, label: "Normal" },
  { value: 34, label: "Serré" },
];

// Hauteur d'un boîtier à l'écran, en pixels, pour chaque densité.
const CASE_PX = { 10: 470, 20: 385, 34: 288 };
// Au-delà, le rayon fait plusieurs écrans de haut et la scène peint un canvas
// démesuré à chaque image : les boîtiers se resserrent (voir `shelfFit`).
const MAX_ROWS = 6;

export function plankSkin(name, theme) {
  return PLANK[name] || PLANK[theme] || PLANK.light;
}

// ------------------------------------------------------ LA TAILLE DU RAYON --
//
// UNE RANGÉE REMPLIT LA LARGEUR DE LA PAGE, PUIS ON PASSE À LA PLANCHE
// SUIVANTE. C'est toute la règle, et elle tient à ce calcul.
//
// Avant, le nombre de boîtiers par planche était un compte fixe et le cadre
// avait une hauteur fixe : dès la deuxième rangée, la caméra reculait pour
// faire tenir la pile, et les deux planches se retrouvaient au fond de la
// pièce. Le rapport s'est inversé — le boîtier a une taille à l'écran, elle ne
// bouge jamais, et c'est le CADRE qui s'allonge d'une rangée quand il en faut
// une de plus.
//
// Tout est calculé en « unités de scène » (1 ≈ 16 cm) puis converti en pixels
// par `unit`, et les marges sont exactement celles que `useFraming` appliquera
// — sinon le cadre et la caméra ne parleraient pas de la même étagère.
function shelfFit(media, density, availPx, viewH) {
  const count = Math.max(1, media.length);
  const tallest = media.reduce((h, m) => Math.max(h, boxOf(m).h), BOX.dvd.h);
  // Largeur MOYENNE d'une place : les boîtiers n'ont pas tous la même tranche
  // (un volume est mince, une boîte de jeu épaisse), et prendre le plus large
  // laisserait un trou au bout de chaque rangée.
  const step = media.reduce((w, m) => w + boxOf(m).w + GAP, 0) / count;

  let casePx = Math.min(
    CASE_PX[density] || Math.max(220, Math.min(560, (CASE_PX[20] * 20) / (density || 20))),
    // Sur un écran bas (ou un portable posé à plat), un boîtier plus haut que
    // la moitié de la fenêtre oblige à faire défiler pour voir une seule
    // rangée : le rayon ne se lit plus d'un coup d'œil.
    Math.round(viewH * 0.52)
  );

  const rowsAt = (px) => {
    const unit = px / BOX.dvd.h;
    // La place vraiment disponible dans le cadre : `useFraming` garde 6 % de
    // marge en largeur, et la rangée s'arrête à EDGE de chaque bord.
    const room = availPx / unit / 1.06 - EDGE * 2;
    const per = Math.max(1, Math.min(count, Math.floor(room / step) || 1));
    return { unit, per, rows: Math.ceil(count / per) };
  };

  let f = rowsAt(casePx);
  // LE SEUL CAS OÙ L'ON RÉTRÉCIT : une collection assez grosse pour empiler
  // plus de MAX_ROWS planches. Le cadre ferait alors plusieurs écrans de haut
  // et la scène peindrait un canvas démesuré à chaque image. On serre les
  // boîtiers jusqu'à retomber sous la limite — jamais avant, et jamais parce
  // qu'il y a « deux rangées au lieu d'une ».
  for (let i = 0; i < 6 && f.rows > MAX_ROWS && casePx > 150; i += 1) {
    casePx = Math.max(150, Math.round(casePx * Math.sqrt(MAX_ROWS / f.rows)));
    f = rowsAt(casePx);
  }

  // La pile, du dessous de la planche du bas au sommet des boîtiers du haut.
  const stack = (f.rows - 1) * (tallest + PLANK_AIR) + tallest + THICK;

  return {
    perPlank: f.per,
    rows: f.rows,
    height: Math.round((stack + SKY + FLOOR) * f.unit),
    // La largeur ne dépasse jamais ce que la rangée occupe vraiment : six
    // titres dans un cadre pleine page seraient perdus au milieu du vide.
    // Plancher à MIN_W, la largeur cadrée minimale de la scène : en dessous,
    // c'est elle qui commanderait le recul de la caméra et les deux boîtiers
    // d'un rayon presque vide repartiraient au fond.
    width: Math.min(
      availPx,
      Math.round(Math.max(f.per * step + EDGE * 2, MIN_W) * 1.06 * f.unit)
    ),
  };
}

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

// ------------------------------------------------------ le rayon (repos) --

function ShelfCase({
  media,
  x,
  baseY,
  art,
  hovered,
  held,
  taken,
  arranging,
  carry,
  onHover,
  onPick,
  onGrab,
}) {
  const group = useRef(null);
  const box = boxOf(media);
  const paper = useCasePaper(art);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  // Alignés sur leur FACE AVANT (tranches affleurantes) : front au même plan =
  // mêmes proportions à l'écran, et c'est comme ça qu'on range des boîtiers.
  const baseZ = -box.d / 2;
  const homeX = x + box.w / 2;

  // LA PLACE N'EST PLUS POSÉE SUR LE GROUPE, elle est REJOINTE. Tant que le
  // rayon était figé, écrire `position` en JSX suffisait ; mais dès qu'on range
  // (glisser un boîtier, trier la rangée), les voisins doivent s'écarter — et un
  // `position` réécrit à chaque rendu les téléporte. Ici la position de départ
  // est posée une fois au montage, et tout le reste est rattrapé image par image
  // (voir `useFrame`) : changer l'ordre fait donc GLISSER la rangée, sans une
  // ligne d'animation à écrire.
  useLayoutEffect(() => {
    group.current?.position.set(homeX, baseY, baseZ);
    // Au montage seulement : un boîtier qui arrive (changement de filtre) se
    // pose à sa place, il n'y vient pas depuis l'ancienne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // AU BOUT DES DOIGTS. Le boîtier qu'on déplace ne rejoint rien : il EST au
    // curseur, sans amorti — un objet qu'on tient et qui traîne derrière la main
    // ne se tient pas, il se remorque. Il monte aussi devant la rangée, sinon il
    // disparaît derrière les tranches qu'il traverse.
    if (carry) {
      g.position.x = carry.x;
      g.position.y = carry.y;
      g.position.z += (baseZ + CARRY.out - g.position.z) * k;
      g.rotation.x += (CARRY.tilt - g.rotation.x) * k;
      return;
    }

    g.position.x += (homeX - g.position.x) * k;
    g.position.z += (baseZ + (hovered && !arranging ? HOVER.out : 0) - g.position.z) * k;
    g.position.y +=
      (baseY + (hovered ? (arranging ? CARRY.lift : HOVER.lift) : 0) - g.position.y) * k;
    // Penché vers nous en pivotant sur son arête du bas — le geste du doigt
    // qui accroche le haut de la tranche. En rangement, il ne se penche pas :
    // là on ne regarde pas les boîtiers, on les déplace, et une rangée qui
    // s'incline sous le curseur donne un rayon qui gigote.
    g.rotation.x += ((hovered && !arranging ? HOVER.tilt : 0) - g.rotation.x) * k;
  });

  return (
    <group
      ref={group}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(media.slug);
      }}
      onPointerOut={() => onHover(null)}
      // En rangement, le boîtier ne s'ouvre plus : il se prend. Le geste part au
      // DOIGT POSÉ et non au clic — attendre le relâchement pour commencer à
      // déplacer, c'est un premier centimètre de glissement perdu, et l'objet
      // qui saute pour rattraper la main.
      onPointerDown={
        arranging
          ? (e) => {
              e.stopPropagation();
              onGrab(media, e);
            }
          : undefined
      }
      onClick={
        arranging
          ? undefined
          : (e) => {
              e.stopPropagation();
              onPick(media, snapshot());
            }
      }
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
  const forH = (height + SKY + FLOOR) / (2 * vTan);
  const forW = (width * 1.06) / (2 * vTan * aspect);
  // Le plafond de recul est haut : une collection sur six planches est une pile
  // haute, et le brider ici la ferait rétrécir — exactement ce qu'on cherche à
  // éviter. C'est le CADRE qui grandit (voir `shelfFit`), pas la caméra qui
  // recule.
  const d = Math.min(80, Math.max(1.7, Math.max(forH, forW)));

  // La caméra se contente de MONTER (regard toujours horizontal) : décaler le
  // point visé donnerait une perspective penchée, et les boîtiers verseraient.
  // Le ciel demandé est plus haut que le plancher : l'œil monte donc de la
  // moitié de leur écart, et la pile se pose dans le bas du cadre. (Tout vide
  // EN PLUS — quand c'est la largeur qui commande le recul — se répartit de
  // lui-même à parts égales, ce qui est très bien : là, la rangée est au
  // milieu parce qu'il n'y a rien d'autre à en faire.)
  const eyeY = centerY + (SKY - FLOOR) / 2;

  useLayoutEffect(() => {
    camera.position.set(0, eyeY, d);
    camera.lookAt(0, eyeY, 0);
    camera.updateProjectionMatrix();
  }, [camera, d, eyeY]);

  return 2 * d * vTan * aspect;
}

// LA PLACE VISÉE PAR LA MAIN. Où le boîtier porté veut-il être reposé, dans
// l'ordre courant ? La question se règle en deux temps, dans l'ordre où l'œil la
// pose : quelle PLANCHE (la plus proche en hauteur), puis quelle place dans
// cette rangée (combien de tranches sont passées à gauche du curseur).
//
// Le boîtier porté est SORTI du compte : il occupe encore une place dans la
// liste, mais plus dans la rangée — l'y compter ferait osciller la place visée
// entre deux valeurs dès qu'il passe au-dessus de son propre trou.
function slotAt(list, slug, px, py, layout, perPlank) {
  const from = list.findIndex((m) => m.slug === slug);
  if (from < 0) return null;

  let r = 0;
  let best = Infinity;
  layout.planks.forEach((p, i) => {
    const gap = Math.abs(py - (p.y + layout.tallest / 2));
    if (gap < best) {
      best = gap;
      r = i;
    }
  });

  let k = 0;
  for (const it of layout.planks[r].items) {
    if (it.media.slug === slug) continue;
    if (it.x + boxOf(it.media).w / 2 < px) k += 1;
  }

  // La rangée commence à `r * perPlank` dans la liste — mais on compte dans la
  // liste PRIVÉE du boîtier porté, puisque c'est là qu'on va le réinsérer.
  const rowStart = r * perPlank - (from < r * perPlank ? 1 : 0);
  const target = Math.max(0, Math.min(list.length - 1, rowStart + k));
  if (target === from) return null;

  const next = list.slice();
  const [carried] = next.splice(from, 1);
  next.splice(target, 0, carried);
  return next;
}

// LA MONTÉE SUR LA CARTE GRAPHIQUE, ÉTALÉE. Une jaquette peinte n'est encore
// qu'une image en mémoire vive : elle ne part sur le GPU qu'au premier rendu qui
// s'en sert. Toutes les découvrir dans la même image — ce que fait forcément une
// étagère qui s'habille d'un coup — c'est quarante envois de deux mégaoctets
// dans la même frame, donc un accroc pile au moment du fondu.
//
// Alors on les envoie AU FUR ET À MESURE, deux par image, pendant que le rayon
// est encore caché derrière son squelette : le temps de peinture est du temps
// d'attente réseau, la carte graphique n'y fait rien. Quand l'étagère se montre,
// tout est déjà en place et le fondu est lisse.
//
// La file est une `ref` remplie hors de React : personne n'a à se redessiner
// parce qu'une texture vient d'être poussée sur le GPU.
function Warmer({ queue }) {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    for (let i = 0; i < 2 && queue.current.length; i += 1) {
      const art = queue.current.shift();
      try {
        gl.initTexture(art.sheet);
      } catch {
        /* pas de contexte, ou une texture déjà libérée : le rendu la montera
           lui-même le moment venu. */
      }
    }
  });
  return null;
}

// `memo` : pendant que les jaquettes se peignent, la page compte les boîtiers
// prêts pour la jauge du squelette — une dizaine de rendus par seconde qui n'ont
// RIEN à dire à la scène. Sans cette barrière, chacun redescendait jusqu'aux
// boîtiers. Les fonctions qui arrivent d'en haut sont donc toutes stables
// (`useCallback`), sinon la barrière ne tient pas.
const ShelfScene = memo(function ShelfScene({
  media,
  art,
  hovered,
  held,
  taken,
  arranging,
  perPlank,
  onHover,
  onPick,
  onAnchor,
  onReorder,
  skin,
}) {
  // L'ORDRE DE TRAVAIL. Pendant qu'on déplace un boîtier, la rangée affichée
  // n'est plus celle de la page : c'est celle qu'on est en train de composer.
  // Elle vit ici, au plus près de la scène (la page ne saurait rien en faire
  // avant qu'on ait lâché), et s'efface dès que la page reprend la main avec
  // l'ordre validé — d'où le retour à `null` sur tout changement de liste.
  const [order, setOrder] = useState(null);
  const items = order || media;
  useEffect(() => setOrder(null), [media]);

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
    for (let i = 0; i < items.length; i += perPlank)
      chunks.push(items.slice(i, i + perPlank));
    const widthOf = (row) => row.reduce((w, m) => w + boxOf(m).w + GAP, 0) - GAP;
    const width = Math.max(MIN_W, Math.max(...chunks.map(widthOf), 0) + EDGE * 2);

    const tallest = Math.max(BOX.dvd.h, ...items.map((m) => boxOf(m).h));
    const pitch = tallest + PLANK_AIR;

    const planks = chunks.map((row, r) => {
      const y = ((chunks.length - 1) * pitch) / 2 - r * pitch - tallest / 2;
      let x = -widthOf(row) / 2;
      const slots = row.map((m) => {
        const at = x;
        x += boxOf(m).w + GAP;
        return { media: m, x: at, baseY: y };
      });
      return { items: slots, y };
    });

    const bottomY = planks[planks.length - 1].y - THICK;
    const topY = planks[0].y + tallest;
    return {
      planks,
      width,
      topY,
      // `tallest` ressort : c'est le repère qui dit à quelle hauteur se trouve
      // le milieu d'une rangée, donc quelle planche vise la main qui range.
      tallest,
      centerY: (bottomY + topY) / 2,
      height: topY - bottomY,
    };
  }, [items, perPlank]);

  const frameW = useFraming(layout);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);

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

  // ------------------------------------------------------- le rangement --
  //
  // DÉPLACER UN BOÎTIER, C'EST LE SUIVRE DU DOIGT. Pas de zone de dépôt, pas de
  // silhouette fantôme : l'objet est au bout du curseur et la rangée s'ouvre
  // devant lui. Trois pièces pour ça :
  //
  //   • un PLAN DE TRAVAIL — le plan des tranches (z = 0), sur lequel on projette
  //     le curseur pour savoir où il est DANS LA SCÈNE, en unités du monde. Sans
  //     lui, on ne saurait comparer des pixels qu'à des pixels, et la rangée est
  //     en mètres ;
  //   • une POSITION PORTÉE, tenue en `ref` et relue à chaque image par le
  //     boîtier (voir `carry` dans ShelfCase) : la faire passer par un état
  //     redessinerait toute la scène soixante fois par seconde ;
  //   • l'ORDRE DE TRAVAIL, lui bien en état — c'est le seul des trois qui change
  //     ce qu'on voit d'autre que le boîtier porté.
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const caster = useMemo(() => new THREE.Raycaster(), []);
  const carried = useRef({ x: 0, y: 0 });
  const gesture = useRef(null);
  const [carrying, setCarrying] = useState(null);

  // Les listeners du glissement vivent sur la fenêtre (on peut très bien sortir
  // du canvas en déplaçant) : ils ne doivent PAS se réabonner à chaque image de
  // la rangée. Ce que le geste a besoin de lire passe donc par des refs.
  const live = useRef(null);
  live.current = { items, layout, perPlank, onReorder };

  const hitAt = useCallback(
    (clientX, clientY) => {
      const r = gl.domElement.getBoundingClientRect();
      caster.setFromCamera(
        new THREE.Vector2(
          ((clientX - r.left) / r.width) * 2 - 1,
          -((clientY - r.top) / r.height) * 2 + 1
        ),
        camera
      );
      const out = new THREE.Vector3();
      return caster.ray.intersectPlane(dragPlane, out) ? out : null;
    },
    [camera, caster, dragPlane, gl]
  );

  // LE GESTE S'ARME AU DOIGT POSÉ, PAS AU RENDU SUIVANT. Poser ses écouteurs
  // dans un effet, c'est les poser une image trop tard : un clic vif — appui et
  // relâchement dans la même image — se relevait avant que le `pointerup` ne
  // soit écouté. Le boîtier restait alors collé au curseur, et la rangée se
  // recomposait au moindre mouvement de souris, sans qu'on ait rien demandé.
  // Tout le geste vit donc ici, du premier contact au dépôt.
  const onGrab = useCallback(
    (m, e) => {
      if (gesture.current) return; // un boîtier à la fois
      const hit = hitAt(e.clientX, e.clientY);
      const slot = live.current.layout.planks
        .flatMap((p) => p.items)
        .find((i) => i.media.slug === m.slug);
      if (!hit || !slot) return;

      // L'ÉCART ENTRE LE DOIGT ET L'OBJET EST CONSERVÉ : on a attrapé le boîtier
      // quelque part, pas en son centre. Sans ça il saute sous le curseur à la
      // première image, et le geste commence par une secousse.
      const c = { x: slot.x + boxOf(m).w / 2, y: slot.baseY };
      const off = { dx: hit.x - c.x, dy: hit.y - c.y };
      carried.current.x = c.x;
      carried.current.y = c.y;
      let moved = false;

      const move = (ev) => {
        const at = hitAt(ev.clientX, ev.clientY);
        if (!at) return;
        carried.current.x = at.x - off.dx;
        carried.current.y = at.y - off.dy;
        const next = slotAt(
          live.current.items,
          m.slug,
          carried.current.x,
          carried.current.y,
          live.current.layout,
          live.current.perPlank
        );
        if (!next) return;
        moved = true;
        setOrder(next);
      };

      const end = (commit) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", drop);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        gesture.current = null;
        setCarrying(null);
        // UN CLIC N'EST PAS UN DÉPLACEMENT. Effleurer un boîtier sans le sortir
        // de son rang ne doit RIEN écrire : sinon le moindre clic renvoyait un
        // ordre à la page, qui le renvoyait à la scène, et toute la rangée
        // repassait par ce circuit pour ne rien changer.
        if (commit && moved)
          live.current.onReorder?.(live.current.items.map((x) => x.slug));
        // L'ordre de travail n'est lâché QUE si rien n'a été validé : quand on
        // valide, c'est la page qui renvoie la rangée par le haut, et la rendre
        // maintenant ferait réapparaître l'ancienne le temps d'un aller-retour.
        else setOrder(null);
      };

      const drop = () => end(true);
      const cancel = () => end(false);
      // Échap RENONCE — et referme le geste : le doigt qui se relève ensuite ne
      // doit pas valider ce qu'on vient d'annuler.
      const key = (ev) => ev.key === "Escape" && end(false);

      gesture.current = { end };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", drop);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
      setCarrying(m.slug);
    },
    [hitAt]
  );

  // Un geste encore en cours quand la scène s'en va (on quitte la page un
  // boîtier en main) laisserait ses écouteurs sur la fenêtre.
  useEffect(() => () => gesture.current?.end(false), []);

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
        <Plank key={r} width={plankW} y={plank.y} skin={skin} />
      ))}

      {/* LES BOÎTIERS NE SONT PAS RANGÉS SOUS LEUR PLANCHE, mais tous à plat, à
          côté d'elles. Leur place est de toute façon en coordonnées du monde
          (une planche n'est pas un repère, c'est un objet posé comme un autre) —
          et surtout : monté sous sa planche, un boîtier qui change de rangée
          change de PARENT, donc React le démonte et le remonte. Il repartait
          alors de zéro en plein déplacement — matériau recréé, position reposée
          — au moment précis où on le tenait à la main. */}
      {layout.planks
        .flatMap((p) => p.items)
        .map(({ media: m, x, baseY }) => (
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
            arranging={arranging}
            // Le même objet à chaque rendu, et muté hors de React : c'est ce
            // qui permet au boîtier de suivre le curseur sans rendu.
            carry={carrying === m.slug ? carried.current : null}
            onHover={onHover}
            onPick={onPick}
            onGrab={onGrab}
          />
        ))}
    </>
  );
});

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

// Exportée : le panneau d'administration s'en sert pour ESSAYER un boîtier qu'on
// vient de poser (voir AdminCasePreview). Une jaquette ne se juge pas sur une
// vignette de formulaire — elle se juge sur l'objet, retourné dans la main,
// exactement comme le verra celui qui l'aura. Un seul exemplaire de cette
// vitrine, donc, sinon l'essai finirait par montrer autre chose que le rayon.
export function CaseInspector({
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
    // `onSettle` est facultatif : hors du rayon (l'essai du panneau d'admin), il
    // n'y a aucune place à rallumer derrière la vitrine.
    setTimeout(() => onSettle?.(), Math.max(0, trip - 60));
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

export default function CollectionShelf({
  media,
  // La collection entière, filtre compris — `media` n'en est que la part
  // visible. Elle ne sert qu'au préchargement des jaquettes masquées.
  all,
  onSelect,
  theme = "light",
  // Le rayon RÉGLÉ : le meuble, la densité, et le mode rangement. Trois réglages
  // qui appartiennent au lecteur, pas à la collection — c'est la page qui les
  // tient et les enregistre (voir Collection.jsx).
  skin: skinName = "",
  perPlank = PER_PLANK,
  arranging = false,
  onReorder,
}) {
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
  const [pages, setPages] = useState({}); // planches déjà rapatriées, par slug
  const [missingArt, setMissingArt] = useState(0);
  const wrapRef = useRef(null);
  const skin = plankSkin(skinName, theme);

  // Stable : la scène la garde en dépendance d'effet, une nouvelle identité à
  // chaque rendu la ferait tourner en boucle.
  const onAnchor = useCallback((a) => setAnchor(a), []);

  // ------------------------------------------------- la taille du cadre --
  //
  // On mesure le PARENT, jamais le cadre lui-même : c'est nous qui posons sa
  // largeur, et se mesurer soi-même après l'avoir fait ne mesure plus que sa
  // propre décision (et boucle sur le premier rayon un peu étroit).
  const [room, setRoom] = useState(() => ({
    w: 0,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  useLayoutEffect(() => {
    const host = wrapRef.current?.parentElement;
    if (!host) return undefined;
    const read = () => {
      // Sans retirer le padding, la page en donnerait plus qu'elle n'en a et
      // la dernière tranche de chaque rangée passerait sous la marge.
      const cs = getComputedStyle(host);
      const w = Math.max(
        240,
        host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      );
      setRoom((r) => (r.w === w && r.h === window.innerHeight ? r : { w, h: window.innerHeight }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    // La hauteur de fenêtre borne la taille des boîtiers, et un
    // ResizeObserver posé sur un bloc en largeur pleine ne la voit pas bouger.
    window.addEventListener("resize", read);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

  const fit = useMemo(
    () => shelfFit(media, perPlank, room.w || 960, room.h || 800),
    [media, perPlank, room.w, room.h]
  );

  // ------------------------------------------------------ les jaquettes --
  //
  // TOUT ARRIVE ENSEMBLE, OU RIEN N'ARRIVE. L'ancienne peinture partait boîtier
  // par boîtier, chacun attendant que le précédent ait fini son aller-retour
  // réseau, et poussait sa texture dans l'état dès qu'elle était prête : on
  // voyait donc le squelette, puis une rangée de coques BLANCHES (la scène se
  // dévoilait à la première jaquette venue), puis les visuels se poser un par
  // un pendant plusieurs secondes. Trois attentes à la suite, dont deux qui
  // montraient un objet inachevé.
  //
  // Désormais : les jaquettes partent par front de six, le magasin les garde
  // d'une visite à l'autre (voir lib/caseTextures.js), et l'étagère ne se montre
  // qu'une fois HABILLÉE. Ce qui reste à l'écran pendant ce temps, c'est le
  // squelette — avec sa jauge, puisque l'attente est maintenant bornée et connue.
  //
  // `art` démarre sur ce que le magasin a déjà : revenir sur la page, changer de
  // filtre ou de tri n'attend plus rien du tout.
  const [art, setArt] = useState(() => readyArt(media));
  const [dressed, setDressed] = useState(() => isReady(media));
  const [done, setDone] = useState(0);
  // Les jaquettes peintes qui attendent leur montée sur le GPU (voir `Warmer`).
  const warm = useRef([]);

  // LE RESTE DU RAYON, PENDANT QU'ON REGARDE CELUI-CI. Une fois l'étagère
  // habillée, les titres que le filtre écarte se peignent au ralenti, quand le
  // navigateur n'a rien de mieux à faire : retirer un filtre ne fait alors plus
  // attendre. Jamais AVANT, sinon ce travail-là dispute le réseau à ce qu'on est
  // en train de regarder.
  const rest = useRef(null);
  rest.current = all;
  const fillIn = useCallback(() => {
    if (rest.current?.length) prefetch(rest.current);
  }, []);

  useEffect(() => {
    // Déjà peint : on ne repasse même pas par un rendu d'attente.
    if (isReady(media)) {
      const got = readyArt(media);
      setArt(got);
      setDressed(true);
      setMissingArt(Object.values(got).filter((a) => !a.artwork).length);
      fillIn();
      return undefined;
    }

    let alive = true;
    setDressed(false);
    setDone(0);

    // LE FILET. Une image qui ne répond ni par sa charge ni par son erreur (un
    // hébergeur qui laisse la connexion ouverte) garderait l'étagère cachée
    // pour toujours. Passé ce délai, on montre ce qui est prêt : mieux vaut un
    // boîtier nu qu'un rayon qui n'arrive jamais.
    const bail = setTimeout(() => alive && setDressed(true), 12000);

    dressAll(media, {
      onProgress: (n) => alive && setDone(n),
      // Chaque jaquette prête part dans la file du GPU : elle y sera montée
      // pendant qu'on peint les suivantes (voir `Warmer`).
      onPainted: (a) => warm.current.push(a),
      alive: () => alive,
    }).then((got) => {
      if (!alive) return;
      clearTimeout(bail);
      setArt((prev) => ({ ...prev, ...got }));
      setDressed(true);
      setMissingArt(Object.values(got).filter((a) => !a.artwork).length);
      fillIn();
    });

    return () => {
      alive = false;
      clearTimeout(bail);
    };
  }, [media, fillIn]);

  // Le magasin ne se vide pas au démontage — c'est tout l'intérêt — mais il se
  // borne : au retour, ce qu'on ne regarde plus laisse la place. Les jaquettes
  // à l'écran sont épargnées, lues en ref (le nettoyage ne verrait sinon que
  // l'objet vide du premier rendu).
  const liveArt = useRef({});
  liveArt.current = art;
  useEffect(() => () => trim(Object.values(liveArt.current)), []);

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

  // LA HAUTE DÉFINITION N'EST PAS POUR LE RAYON. Une tranche fait cent pixels
  // de large à l'écran : la peindre en 1024 remplissait la mémoire vidéo d'une
  // finesse que personne ne pouvait voir, et coûtait la moitié du temps de
  // chargement. Le rayon se contente donc du nécessaire (SHELF_QUALITY) — et
  // c'est le boîtier PRIS EN MAIN, lui seul, qui se fait repeindre en grand
  // pendant qu'il vole vers la vitrine, où il tient tout l'écran et se laisse
  // zoomer. Le relais est invisible : même dessin, même feuille, même pliure.
  const [hi, setHi] = useState(null);
  useEffect(() => {
    const m = inspected?.media || reading?.media;
    if (!m) return undefined;
    let alive = true;
    caseArt(m, HI_QUALITY)
      .then((got) => alive && setHi({ slug: m.slug, art: got }))
      .catch(() => {
        /* la définition du rayon fait très bien l'affaire */
      });
    return () => {
      alive = false;
    };
  }, [inspected, reading]);
  const bestArt = (m) => (hi?.slug === m.slug ? hi.art : art[m.slug]);

  // La bulle garde le dernier titre survolé le temps de sa disparition : la
  // vider dès la sortie du curseur ferait clignoter une carte vide.
  const held = useRef(null);
  if (anchor) {
    const m = media.find((x) => x.slug === anchor.slug);
    if (m) held.current = { media: m, anchor };
  }
  const tip = held.current;
  // Pas de bulle quand on range : à ce moment-là on ne lit pas les titres, on
  // déplace des objets — et une carte qui suit le curseur masque la rangée.
  const showTip = !!anchor && !inspected && !reading && !arranging;

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

  // `useCallback` : la scène est mémoïsée, une fonction neuve à chaque rendu
  // ferait tomber la barrière (voir `memo` sur ShelfScene).
  const pick = useCallback((m, origin) => {
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
  }, []);

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

  // Le squelette tient jusqu'à ce que le rayon soit HABILLÉ, puis s'efface en
  // fondu par-dessus la scène qui monte. Il reste monté le temps du fondu, sinon
  // il disparaît d'un coup sur une scène encore transparente.
  const [skelGone, setSkelGone] = useState(dressed);
  useEffect(() => {
    if (!dressed) {
      setSkelGone(false);
      return undefined;
    }
    const t = setTimeout(() => setSkelGone(true), 500);
    return () => clearTimeout(t);
  }, [dressed]);

  return (
    // Le cadre est TAILLÉ pour le rayon (voir `shelfFit`) : sa largeur ne
    // dépasse pas ce que la rangée occupe, et sa hauteur vaut une rangée —
    // deux, trois… — à taille de boîtier constante.
    <div
      ref={wrapRef}
      className={`coll-shelf3d ${hovered ? "is-hover" : ""} ${
        dressed ? "is-dressed" : ""
      } ${arranging ? "is-arranging" : ""}`}
      style={{
        width: `${fit.width}px`,
        height: `${fit.height}px`,
        "--rows": fit.rows,
      }}
    >
      {!skelGone && (
        <ShelfSkeleton
          label="Chargement de l'étagère…"
          count={Math.min(14, media.length)}
          // L'attente a une fin, et elle se voit avancer : sans jauge, deux
          // secondes de rangée grise se lisent comme une page qui a lâché.
          progress={media.length ? done / media.length : 1}
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
        <Warmer queue={warm} />
        <ShelfScene
          media={media}
          art={art}
          hovered={hovered}
          held={inspected?.media.slug || reading?.media.slug}
          taken={taken}
          arranging={arranging}
          perPlank={fit.perPlank}
          onHover={setHovered}
          onPick={pick}
          onAnchor={onAnchor}
          onReorder={onReorder}
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

      {/* La consigne suit le mode : en rangement, prendre un boîtier ne l'ouvre
          plus, et le dire vaut mieux que de laisser essayer. */}
      <span className="coll-shelf-hint" aria-hidden="true">
        {arranging
          ? "Attrape un boîtier et pose-le où tu veux — Échap pour renoncer au déplacement en cours"
          : "Survole un titre · clique pour le prendre en main — un volume s'ouvre et se lit, un jeu se lance"}
      </span>

      {/* Le volume ouvert descend à la demande : sa scène (une page déformée à
          chaque image, les textures des planches) n'a rien à faire dans le
          paquet du rayon. Le repli est vide — l'étagère reste sous les yeux, et
          le volume, lui, ne quitte sa place qu'une fois le lecteur dessiné. */}
      {reading && (
        <Suspense fallback={null}>
          <BookReader3D
            media={readMedia}
            art={bestArt(reading.media)}
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
          art={bestArt(inspected.media)}
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
