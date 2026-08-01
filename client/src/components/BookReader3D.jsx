import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Loader2,
  ArrowRight,
  Glasses,
} from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import useMediaQuery from "../hooks/useMediaQuery";
import BookTutorial, { tutorialSeen } from "./BookTutorial";
import { apiFetch } from "../lib/api";
import { playBookOpenSound, playPageTurnSound, primePaperSounds } from "../lib/sfx";
import { useAuth } from "../context/AuthContext";
import { boxOf, isRtl, loadImage, pageRatio, spreadTest } from "../lib/collection";
import { caseArt, HI_QUALITY } from "../lib/caseTextures";
import {
  ribbonGeometry,
  ribbonUpdate,
  blockOf,
  COVER,
  pageEdgeTexture,
} from "../lib/caseGeometry";

// ======================================================================
//  Le volume ouvert — lire un manga DANS l'objet
// ======================================================================
// On ne quitte pas l'étagère pour aller lire ailleurs : le volume qu'on vient
// de désigner sort du rayon, se retourne, S'OUVRE, et on lit dedans. Pas de
// fiche à traverser, pas de lecteur qui se substitue à l'objet — c'est le même
// livre du début à la fin, et c'est tout l'intérêt.
//
// TROIS IDÉES PORTENT TOUTE LA SCÈNE.
//
//   1. UN SEUL RUBAN POUR LA COUVERTURE. Le plat verso, le dos et le plat recto
//      sont une même feuille de matière, de longueur CONSTANTE. Ouvrir le
//      volume ne fait que la plier autrement : le dos passe de la demi-lune
//      (fermé) au méplat couché au fond de la gouttière (ouvert), sans jamais
//      s'allonger. C'est pour ça que le volume fermé de cette scène est
//      exactement celui du rayon — l'échange ne se voit pas.
//
//   2. LA PAGE QUI SE TOURNE EST LE MÊME RUBAN. Son profil est INTÉGRÉ pas à
//      pas le long de sa propre courbure : le papier ne s'étire donc jamais, il
//      se cintre. C'est ce qui sépare une page qui se tourne d'une image qu'on
//      fait pivoter.
//
//   3. DEUX MOITIÉS, PAS UNE GAUCHE ET UNE DROITE. La moitié LUE porte le plat
//      recto et s'articule sur le dos ; la moitié À LIRE porte le plat verso et
//      ne bouge jamais. De quel côté de l'écran elles tombent est une question
//      de sens de lecture (un manga est le même objet dans un miroir), et cette
//      question se règle en UN endroit : le miroir posé sur la scène entière.
//      Aucun `if (rtl)` ne traîne dans la géométrie.

const FOV = 30;
const FLY_OUT = 0.5; // le volume quitte l'étagère
const FLY_BACK = 0.34; // et s'y range
const OPEN_TIME = 0.95;
const SHUT_TIME = 0.42;
const TURN_TIME = 0.62;
// La reprise en main depuis la vitrine : le volume se redresse. Court — ce n'est
// pas un voyage, c'est le poignet qui remet l'objet d'aplomb avant de l'ouvrir.
const HAND_TIME = 0.45;

// Segments d'une page en vol. Vingt suffisent : la courbure est douce, et
// au-delà on paie des triangles pour un galbe que l'œil ne distingue plus.
const SEG = 20;

// Le cintre d'une page en plein vol, en radians. C'est un dosage, pas une
// mesure : trop peu, la page est une planche de bois ; trop, elle s'enroule sur
// elle-même comme une affiche.
const CURL = 0.9;

// De combien les pages mordent sur la gouttière. Un bloc broché est collé sur
// toute la largeur du dos : les pages plongent dedans, elles ne s'arrêtent pas
// à son bord.
//
// À 1, les deux planches SE REJOIGNENT au milieu de la gouttière. C'est la
// seule valeur juste : en deçà, il reste entre elles une fente de la largeur du
// dos — deux affiches posées côte à côte, et depuis que le contreplat ne
// comble plus le fond, on voit carrément à travers. Ce qui sépare les deux
// pages n'est pas un écart mais un PLI : elles se touchent en x et plongent
// chacune de son côté (voir `dip`).
const GUT_PULL = 1;

// Le creux de la reliure. Une page n'arrive pas à plat jusqu'au dos : elle est
// COLLÉE TOUT AU FOND, au niveau du plat, et remonte jusqu'à sa place dans la
// pile. Sa profondeur n'est donc pas un réglage — c'est exactement la hauteur de
// la pile qui la porte, et c'est ce qui fait que le creux se prononce à mesure
// qu'on avance dans le volume.
//
// Le plafond n'est là que pour les gros volumes : passé 6 % de la largeur de
// page, le pli devient une falaise. La course de redressement suit la
// profondeur — un creux profond se rattrape plus loin, comme du vrai papier.
const BIND_MAX = 0.06;
const BIND_SPAN = 0.075;
const PAGE_SEG = 16;

// Part de la planche que couvre l'ombre de la reliure.
const GUT_SHADE = 0.17;

// ---------------------------------------------------------- lecture guidée --
//
// LIRE UNE PLANCHE À L'ÉCRAN, C'EST UN TRAJET : zoomer sur le haut d'une page,
// descendre, dézoomer, aller à la page d'à côté, rezoomer, tourner, recommencer.
// Le mode guidé fait ce trajet à notre place. Il cadre UNE page en pleine
// largeur, descend d'une hauteur d'écran à chaque appui, passe à la page d'à
// côté quand il n'y a plus rien dessous, et tourne quand il n'y a plus rien à
// côté. On ne pilote plus une caméra : on avance dans une lecture.
//
// Les stations ne sont écrites nulle part — elles se DÉDUISENT du cadrage du
// moment (taille de la fenêtre, format de la page). Le clavier ne manipule donc
// jamais que deux entiers : quelle page, quelle bande.
const GUIDE_FILL = 0.94; // ce que la page occupe de la largeur cadrée
const GUIDE_OVERLAP = 0.1; // ce qu'on garde de la bande précédente en descendant
const GUIDE_MAX = 6; // garde-fou : au-delà on n'est plus en train de lire

// COMBIEN DE BANDES PAR PAGE, AU PLUS. C'est cette contrainte qui fixe le
// cadrage, et non la largeur de la page : cadrer une planche haute sur sa
// largeur oblige à la balayer en quatre fois, ce qui n'est plus de la lecture
// mais de l'inspection. Deux bandes = un seul mouvement par page, ce qu'on peut
// suivre des yeux sans perdre le fil.
const GUIDE_ROWS = 2;

// Le temps d'un trajet d'une station à l'autre. Assez long pour qu'on suive le
// mouvement des yeux, assez court pour ne pas attendre — et calé sur le vol
// d'une page (TURN_TIME), pour que le changement de double page et le
// recadrage soient un seul geste et non deux qui se courent après.
const GUIDE_MOVE = 0.55;

// ---------------------------------------------------- qui fait quoi au clavier
//
// TROIS GESTES, TROIS TOUCHES, ET AUCUNE NE FAIT LE TRAVAIL D'UNE AUTRE.
//
//   ← → — AVANCER DANS LA LECTURE. Une hauteur d'écran à chaque appui ; arrivé
//         au bas de la page, la même touche passe à celle d'à côté, puis tourne.
//         C'est le geste qui lit un volume entier sans jamais changer de doigt.
//   ↑ ↓ — DÉFILER, et rien de plus. Par petits pas, pour rattraper une bulle
//         coupée en deux sans se retrouver une demi-page plus bas.
//   espace — VOIR LA DOUBLE PAGE EN ENTIER. On recule d'un coup, on regarde, on
//         revient d'un second appui exactement où l'on en était.
//
// DEUX RÉGIMES DE CAMÉRA, ET C'EST TOUTE LA DIFFÉRENCE ENTRE « DES CRANS » ET
// « DU DÉFILEMENT ».
//
//   • LE TRAJET (`travel`) — on VA quelque part : la bande suivante, la page
//     d'à côté. La caméra démarre à l'arrêt, prend de la vitesse et se pose.
//   • LE SUIVI (`glide`) — on AJUSTE : on fait défiler, on approche à la
//     molette. La caméra n'a plus de destination, elle colle à ce qu'on
//     demande, avec le même amortisseur que le zoom à la main.
//
// Tout passait par le premier, et c'est ce qui rendait le défilement et le zoom
// si mauvais : chaque cran de molette, chaque répétition du clavier annulait le
// trajet en cours pour en redemander un neuf — donc la caméra repartait à
// chaque fois de sa vitesse nulle et n'avançait qu'en sautillant.
//
// `GUIDE_NUDGE` : ce que vaut UNE pression sur une flèche du bas, en fraction
// d'une bande. Un cinquième d'écran — de quoi rattraper une bulle coupée.
const GUIDE_NUDGE = 0.22;

// `GUIDE_SPEED` : la vitesse de la flèche MAINTENUE, en bandes par seconde —
// une hauteur d'écran en un peu moins d'une seconde, le rythme auquel on
// balaye une planche des yeux.
const GUIDE_SPEED = 1.15;

// Le temps qu'on laisse à l'appui avant de passer du petit pas au défilement
// continu : en dessous, un clic sur les chevrons partirait tout seul.
const HOLD_MS = 300;

// Et celui qu'on laisse au CURSEUR avant de l'effacer. Une seconde : assez pour
// qu'une main hésitante ne le fasse pas clignoter, assez court pour qu'il ne
// traîne pas en travers de la planche qu'on est en train de lire.
const CURSOR_IDLE = 1000;

// ------------------------------------------------------------- au doigt --
//
// `TAP_SLOP` : ce qu'on tolère de tremblement avant qu'un appui devienne un
// glissement. Un doigt ne se pose jamais parfaitement immobile.
const TAP_SLOP = 10;

// LE BALAYAGE COMPTE AUTANT QUE LA TRACTION. Une page tirée se juge à la
// distance parcourue (passé la moitié, elle part) ; une page CHASSÉE d'un coup
// sec ne traverse pas la moitié de l'écran, et sans ces deux seuils elle
// revenait se poser — le geste semblait ignoré. En deçà de `FLICK_MS`, tout
// glissement de plus de `SWIPE_MIN` pixels vaut donc une page tournée.
const FLICK_MS = 350;
const SWIPE_MIN = 42;

// LA VUE D'ENSEMBLE. La double page prend toute la hauteur du cadre, et même un
// cheveu de plus : on vient voir une planche en grand, pas l'admirer dans ses
// marges. La largeur n'est là qu'en garde-fou — sur un écran étroit, remplir la
// hauteur sortirait les deux pages du cadre.
const FILL_H = 1.04;
const FILL_W = 1.15;

// L'AVANCE RAPIDE. Flèche MAINTENUE : les doubles pages défilent au lieu de se
// tourner une à une. Le clavier répète bien plus vite qu'une page ne vole
// (TURN_TIME), donc rien ne s'anime — on cherche une planche, on ne la lit pas.
const RUSH_MS = 110;

// LA MOLETTE EST PROPORTIONNELLE AU GESTE. Un facteur fixe par cran, c'était un
// escalier : trois crans et la planche sautait au nez, et un pavé tactile (qui
// envoie des miettes de pixels) zoomait aussi fort qu'une souris. Ces taux-là
// valent pour UN CRAN de molette (≈ 100 px) ; en dessous on approche d'un
// cheveu, au-dessus franchement.
const ZOOM_RATE = 0.09;
const GUIDE_ZOOM_RATE = 0.06;

// CE QU'EN GARDE LA PAGE DE GAUCHE. Les deux pages plongent dans la même
// reliure, donc les deux portent l'ombre — mais la lumière de la scène vient du
// haut à droite (voir `Lights`), et le creux de gauche est bien moins fermé
// qu'elle. Une seule des deux ombrée faisait une page collée sur l'autre ; les
// deux au même noir feraient un pli symétrique, ce qu'aucun livre ouvert n'a.
const GUT_SHADE_LEFT = 0.55;

// L'épaisseur d'une feuille. Purement technique : de quoi qu'aucune page ne
// soit jamais coplanaire avec la pile qui la porte.
const SHEET = 0.0016;

// Le cadre, en hauteurs de volume. Il sert DEUX FOIS — au cadrage de la caméra
// et au calcul du point de départ du vol, qui doit tomber au pixel près sur la
// place du volume dans le rayon. Deux valeurs qui divergeraient feraient partir
// le vol à la mauvaise échelle, donc une seule constante.
const FRAME = 1.26;

const mix = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Le volume découpé en DOUBLES PAGES. La première en porte deux — c'est la
// demande, et ça tombe juste : le verso du plat recto EST la planche 1, donc
// ouvrir la couverture découvre bien les deux premières planches d'un coup.
//
// Une planche double (voir `spreadTest`) occupe une vue À ELLE SEULE : elle est
// déjà deux pages, l'apparier décalerait toute la pagination qui suit. Ici,
// contrairement à la lecture à plat, elle ne reste pas pour autant sur une
// seule moitié du volume — elle s'étale sur les deux, chacune n'en montrant que
// sa part (voir `Half`).
function buildSpreads(pages, wide) {
  const out = [];
  let i = 0;
  while (i < pages.length) {
    const a = pages[i];
    const b = pages[i + 1];
    if (wide(a) || !b || wide(b)) {
      out.push([a]);
      i += 1;
    } else {
      out.push([a, b]);
      i += 2;
    }
  }
  return out;
}

// ------------------------------------------------------------- profils --

// LE DOS QUI SE DÉPLIE. `open` : 0 = fermé, 1 = ouvert à plat.
//
// Le dos est un arc de longueur CONSTANTE (celle de la matière : la demi-lune
// du volume fermé) dont on ne fait varier que l'angle total. Fermé, il tourne
// d'un demi-tour et relie donc le plat verso au plat recto, qui se retrouvent
// face à face à `w` l'un de l'autre. Ouvert, il ne tourne plus du tout : il
// s'allonge au fond de la gouttière, et les deux plats regardent la table.
// Entre les deux, l'arc passe par tous les rayons intermédiaires — c'est
// exactement le geste du dos d'un livre broché qu'on ouvre.
function spinePath(out, w, open) {
  const n = out.length - 1;
  const len = (Math.PI * w) / 2; // la matière du dos, une fois pour toutes
  const phi = -Math.PI * (1 - open);

  if (Math.abs(phi) < 1e-3) {
    for (let i = 0; i <= n; i++) {
      out[i][0] = -(len * i) / n;
      out[i][1] = 0;
    }
    return out;
  }
  const r = len / Math.abs(phi);
  const sgn = Math.sign(phi);
  // Le centre est à un quart de tour du cap, du côté vers lequel on tourne.
  const cx = r * Math.cos(Math.PI + sgn * (Math.PI / 2));
  const cz = r * Math.sin(Math.PI + sgn * (Math.PI / 2));
  const b0 = Math.PI - sgn * (Math.PI / 2);
  for (let i = 0; i <= n; i++) {
    const b = b0 + (phi * i) / n;
    out[i][0] = cx + Math.cos(b) * r;
    out[i][1] = cz + Math.sin(b) * r;
  }
  return out;
}

// LA PAGE EN VOL. On part de la charnière et on AVANCE le long de la feuille en
// faisant tourner le cap au fil du chemin. Le pas est constant, donc la longueur
// parcourue aussi : la page se cintre sans jamais s'étirer, ce qu'une simple
// rotation par sommet ne sait pas faire.
//
// ET ELLE RESTE COLLÉE AU FOND DE LA GOUTTIÈRE. Une feuille en vol est une page
// du bloc comme les autres : elle est COUSUE tout au fond, et ce n'est pas
// parce qu'on la soulève par son bord libre que son autre bord remonte. Sans le
// pli, la feuille partait de la SURFACE de la pile alors que la page qu'elle
// recouvre plonge d'un `dip` (jusqu'à 6 % de la largeur de page, cf. BIND_MAX) :
// elle flottait donc, décollée du volume près du dos, et retombait d'un coup en
// se posant — le petit saut qu'on voyait en lâchant, et le décollement qu'on
// voyait en soulevant.
//
// Le pli est appliqué à la SORTIE, jamais à l'intégrateur : celui-ci avance à
// pas constant et c'est ce qui garantit que le papier ne s'étire pas. Il décroît
// exactement comme celui d'une page posée (même exponentielle, même `span`), de
// sorte qu'à plat les deux profils se superposent — et que le relais entre la
// feuille et la page qu'elle devient ne se voit plus.
function sheetPath(out, ox, oz, r0, len, theta, curl, dip = 0, span = 1) {
  const n = out.length - 1;
  let x = ox + Math.cos(theta) * r0;
  let z = oz + Math.sin(theta) * r0;
  out[0][0] = x;
  out[0][1] = z - dip;
  const step = len / n;
  for (let i = 1; i <= n; i++) {
    // Le cintre est nul aux deux bouts : la page quitte sa pile à plat et se
    // repose à plat. Entre les deux, elle bombe.
    const a = theta + curl * Math.sin(Math.PI * ((i - 0.5) / n));
    x += Math.cos(a) * step;
    z += Math.sin(a) * step;
    out[i][0] = x;
    // `i * step` : la distance PARCOURUE depuis la couture, et non l'écart en
    // x — dressée, la feuille n'avance plus en x du tout, et un pli mesuré sur
    // x se déploierait alors sur toute sa hauteur.
    out[i][1] = z - dip * Math.exp(-(i * step) / span);
  }
  return out;
}

// LA PAGE POSÉE, ET SON PLI DE RELIURE. Elle est plate sur presque toute sa
// longueur et plonge vers le dos sur les derniers millimètres — une exponentielle
// plutôt qu'une pente, parce que c'est la forme d'une feuille tenue à un bout et
// libre partout ailleurs.
//
// Les points sont RESSERRÉS près de la reliure (répartition quadratique) : c'est
// le seul endroit qui courbe, en répartir seize à intervalle régulier n'en
// mettrait que deux dans le pli et le creux se lirait comme un angle.
function pagePath(out, len, dip, span, sign) {
  const n = out.length - 1;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const x = len * f * f;
    out[i][0] = x;
    out[i][1] = sign * dip * Math.exp(-x / span);
  }
  return out;
}

// Les UV suivent la MÊME répartition que les points, sinon la planche se tasse
// vers la reliure.
const pageUvs = (n) => Array.from({ length: n + 1 }, (_, i) => (i / n) ** 2);

const profile = (n) => Array.from({ length: n + 1 }, () => [0, 0]);

// LES DEUX FACES D'UNE FEUILLE, ET POURQUOI CE N'EST PAS LA MÊME.
//
// Une face vue de dos n'inverse RIEN : elle montre le même texel au même point
// de l'espace, on le regarde simplement de l'autre côté. Or le recto et le verso
// d'une feuille n'ont pas la même reliure — le recto est cousu du côté où il
// repose, le verso du côté où il va se poser, c'est-à-dire à l'opposé. Leurs UV
// courent donc en sens contraire.
//
// (Le verso montré avec les UV du recto, c'est la planche imprimée en miroir
// pendant toute la rotation, qui se remet d'aplomb en se posant : le symptôme
// exact de cette confusion.)
//
// Les deux géométries PARTAGENT leurs sommets : une seule déformation par image
// suffit à les mettre toutes les deux à jour, il n'y a pas deux profils à tenir
// synchronisés.
function sheetPair(pts, uv, height) {
  const s = Array.from({ length: pts.length }, (_, i) => i / (pts.length - 1));
  const sheet = ribbonGeometry(pts, uv(s), height);
  const sheetBack = ribbonGeometry(pts, uv(s.map((v) => 1 - v)), height);
  sheetBack.setAttribute("position", sheet.attributes.position);
  sheetBack.setAttribute("normal", sheet.attributes.normal);
  // ET SON OMBRE DE RELIURE. La feuille en vol est une page comme les autres :
  // sans cette bande, elle se posait toute nue et l'ombre n'apparaissait qu'au
  // moment où la feuille s'effaçait — le petit saut qu'on voyait en lâchant.
  // Elle ne passe PAS par `uv` : le pli est du côté de la charnière, quel que
  // soit le sens de lecture, et `s` court déjà de la charnière vers le bord.
  const sheetShade = ribbonGeometry(
    pts,
    s.map((v) => Math.min(1, v / GUT_SHADE)),
    height
  );
  sheetShade.setAttribute("position", sheet.attributes.position);
  sheetShade.setAttribute("normal", sheet.attributes.normal);
  return { sheet, sheetBack, sheetShade };
}

// ---------------------------------------------------------- matériaux --

// Le matériau est monté À LA MAIN : passer une texture par JSX à un matériau qui
// n'en avait pas ne recompile pas son programme, et la page reste blanche.
//
// Et une planche pas encore arrivée NE REMPLACE RIEN : on garde celle qu'on
// avait. Sauter à la planche 32 avec la règle, c'est demander des images qu'on
// n'a pas encore ; les effacer en attendant laissait deux rectangles de papier
// nu à la place du volume. Mieux vaut la double-page précédente une demi-seconde
// de plus.
//
// `crop` : la MOITIÉ du scan que porte cette face, quand la planche est une
// double page étalée sur les deux pages du volume (0 = la gauche, 0,5 = la
// droite). Le recadrage se fait dans la TEXTURE et non dans la géométrie —
// c'est la même image qui sert aux deux moitiés, chacune avec son décalage, et
// un clone de texture partage l'image sans la retéléverser.
function usePaper(map, { side = THREE.FrontSide, color = 0xffffff, crop = null } = {}) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, side, roughness: 0.95, metalness: 0 }),
    [side, color]
  );
  // Le clone qui nous appartient, s'il y en a un : lui seul se libère, et
  // seulement quand un autre le remplace. Le libérer dans le nettoyage de
  // l'effet le retirerait aussi quand la planche suivante n'est pas encore
  // arrivée — c'est-à-dire exactement quand on tient à garder la précédente.
  const own = useRef(null);

  // LA TEXTURE SE POSE PENDANT LE RENDU, PAS DANS UN EFFET. Les effets passifs
  // de React sont différés : rien ne garantit qu'ils passent avant la prochaine
  // image de three, qui tourne sur son propre rAF. Le volume était donc dessiné
  // une image ou deux avec une matière SANS IMAGE — un grand rectangle blanc à
  // la place de la jaquette, le temps d'un battement, à chaque ouverture.
  // Ce n'est pas la texture qui est rechargée (c'est la même que la vitrine,
  // three la garde sur le GPU) : c'est la matière qui la recevait trop tard.
  //
  // La pose est IDEMPOTENTE — on ne touche au matériau que si la demande a
  // changé —, donc le double rendu de StrictMode n'y change rien.
  const applied = useRef({ map: undefined, crop: undefined });
  if (map && (applied.current.map !== map || applied.current.crop !== crop)) {
    const t = crop == null ? map : map.clone();
    if (crop != null) {
      t.repeat.set(0.5, 1);
      t.offset.set(crop, 0);
      t.needsUpdate = true;
    }
    if (own.current && own.current !== t) own.current.dispose();
    own.current = crop == null ? null : t;
    mat.map = t;
    mat.needsUpdate = true;
    applied.current = { map, crop };
  }

  useEffect(
    () => () => {
      own.current?.dispose();
      mat.dispose();
    },
    [mat]
  );
  return mat;
}

// L'ombre de la gouttière : le seul artifice de la scène, et le plus rentable.
// Deux planches posées côte à côte sont deux images ; les mêmes avec ce creux
// d'ombre au milieu sont un livre ouvert.
function gutterTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(24, 18, 10, 0.6)");
  g.addColorStop(0.4, "rgba(24, 18, 10, 0.2)");
  g.addColorStop(1, "rgba(24, 18, 10, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// LES SIX FACES D'UNE PILE DE PAGES NE MONTRENT PAS LA MÊME CHOSE. Les CHANTS
// montrent la tranche des feuilles, donc le grain strié ; le DESSUS montre la
// première page de la pile, donc du papier uni. Une seule matière pour les six,
// et ce grain se retrouvait étalé sur le dessus — d'où la bande de faux bois qui
// débordait tout autour des planches.
//
// ET LE CHANT CÔTÉ GOUTTIÈRE EST UN CAS À LUI SEUL. Il est au fond du pli, sous
// les deux planches qui plongent vers le dos : dans un vrai volume on n'y voit
// rien, c'est l'endroit le plus sombre de l'objet. Peint comme la tranche
// extérieure, il rendait le moindre jour entre les deux planches en TRAIT CLAIR
// — c'est-à-dire en trou, là où l'œil attend un creux.
//
// Ce jour existe : les deux moitiés se rejoignent bien en x, mais leurs bords
// intérieurs ne tombent à la même hauteur que si les deux piles sont d'égale
// épaisseur. Au début (ou à la fin) d'un volume, tout est d'un seul côté, et le
// pli — plafonné à BIND_MAX — ne descend pas assez pour rattraper l'écart. On ne
// le voit que de biais, donc zoomé sur une seule des deux pages. Faute de le
// fermer, on le rend à ce qu'il est : une ombre.
function useStackFaces(faces) {
  const mats = useMemo(() => {
    const kinds = {
      edge: new THREE.MeshStandardMaterial({
        map: pageEdgeTexture(),
        color: "#f8f1e0",
        roughness: 0.96,
        metalness: 0,
      }),
      flat: new THREE.MeshStandardMaterial({
        color: "#f7f1e3",
        roughness: 0.97,
        metalness: 0,
      }),
      // Le fond du pli : la teinte de l'ombre de gouttière (voir
      // `gutterTexture`), poussée à fond puisqu'il n'y a rien à travers quoi la
      // voir. Mate, elle n'attrape aucun reflet et ne se signale jamais.
      gutter: new THREE.MeshStandardMaterial({
        color: "#1b1610",
        roughness: 1,
        metalness: 0,
      }),
    };
    // L'ordre des groupes d'une BoxGeometry : +X, -X, +Y, -Y, +Z, -Z.
    return { all: Object.values(kinds), six: faces.map((k) => kinds[k]) };
  }, [faces]);
  // On libère TOUTES les matières créées, y compris celles qu'aucune face n'a
  // demandées : elles ont bel et bien été allouées.
  useEffect(() => () => mats.all.forEach((m) => m.dispose()), [mats]);
  return mats.six;
}

// Ouvert, les pages s'empilent selon Z : seuls les deux chants latéraux montrent
// leur tranche, et le dessus est du papier. La boîte va de la GOUTTIÈRE (-X, au
// fond du pli) au BORD D'OUVERTURE (+X, celui qu'on a sous les doigts).
const OPEN_FACES = ["edge", "gutter", "flat", "flat", "flat", "flat"];

// LA PAGE DU VOLUME, une fois pour toutes. Son format est celui du titre (voir
// `pageRatio`), pas celui de la planche du moment : toutes les pages d'un livre
// sont coupées à la même taille, et c'est cette égalité qui fait que les deux
// moitiés s'alignent au pli et qu'une feuille se pose exactement sur celle
// qu'elle recouvrait. Dimensionner chaque page sur son propre scan, c'était le
// petit décalage à chaque page tournée.
//
// Elle est CONTENUE dans le gabarit du bloc, jamais débordante : ce qui reste
// est de la marge, comme dans un vrai volume.
function fitPage(ratio, w, h) {
  const r = ratio > 0 ? ratio : w / h;
  const pw = Math.min(w, h * r);
  return { w: pw, h: pw / r };
}

// ------------------------------------------------------------- moitiés --

// Une moitié du volume : sa pile de pages et la planche posée dessus. La moitié
// LUE et la moitié À LIRE sont le MÊME composant — seul le sens dans lequel la
// pile monte les distingue, et c'est leur parent qui décide où elles tombent.
//
// Elle ne s'anime pas elle-même : elle prête ses nœuds au `slot` que lui passe
// le volume. Un `useFrame` par moitié s'exécuterait AVANT celui du parent (les
// abonnements suivent l'ordre de montage, donc les enfants d'abord), et chaque
// moitié travaillerait sur la gouttière de l'image précédente.
function Half({ page, tex, fit, flip, split, gutter, slot }) {
  const stack = useRef(null);
  const sheet = useRef(null);
  // Double face : la moitié lue est retournée par sa charnière, c'est donc son
  // dos qu'on regarde une fois le volume ouvert.
  //
  // `flip` dit déjà de quel CÔTÉ du volume tombe cette moitié : des UV qui
  // courent de la gouttière vers l'extérieur, c'est une page de droite ; à
  // l'envers, une page de gauche. La moitié du scan à prendre s'en déduit donc
  // sans qu'aucun `if (rtl)` n'ait à revenir ici — le miroir de la scène est
  // déjà passé par là.
  const mat = usePaper(tex, {
    side: THREE.DoubleSide,
    color: 0xfffdf7,
    crop: split ? (flip ? 0 : 0.5) : null,
  });
  const faces = useStackFaces(OPEN_FACES);

  // UNE PLANCHE SANS IMAGE N'EST PAS UNE PLANCHE. Le matériau garde la dernière
  // planche peinte quand la suivante n'est pas encore là (voir `usePaper`) —
  // mais tant qu'il n'y en a JAMAIS eu, il n'a que sa couleur de papier, et le
  // ruban se dessine alors en grand rectangle blanc, posé sur la couverture.
  // On ne montre donc la feuille qu'une fois qu'il y a quelque chose dessus ;
  // d'ici là, on voit la pile de papier, ce qui est la vérité.
  const painted = useRef(false);
  if (tex) painted.current = true;

  // La planche est un RUBAN, pas un plan : elle doit pouvoir plonger dans la
  // gouttière. Son profil est reposé à chaque image par le volume, qui seul
  // connaît l'épaisseur de la pile et l'ouverture du moment. Sa TAILLE, elle,
  // vient du volume aussi : c'est le format du titre, commun à toutes ses pages.
  const paper = useMemo(() => {
    const u = pageUvs(PAGE_SEG);
    const pts = profile(PAGE_SEG);
    const geo = ribbonGeometry(pts, flip ? u.map((v) => 1 - v) : u, fit.h);
    // L'ombre de reliure PARTAGE les sommets de la planche : c'est la même
    // feuille, vue par son creux. Posée à plat comme avant, elle flottait
    // au-dessus du pli au lieu de l'épouser. `polygonOffset` la décolle d'un
    // cheveu en profondeur, ce qui évite d'entretenir un second profil.
    const shade = ribbonGeometry(pts, u.map((v) => Math.min(1, v / GUT_SHADE)), fit.h);
    shade.setAttribute("position", geo.attributes.position);
    shade.setAttribute("normal", geo.attributes.normal);
    return { pts, geo, shade };
  }, [flip, fit.h]);
  useEffect(
    () => () => {
      paper.geo.dispose();
      paper.shade.dispose();
    },
    [paper]
  );

  useEffect(() => {
    slot.current = { stack, sheet, ...paper, w: fit.w, h: fit.h };
    return () => {
      slot.current = {};
    };
  }, [slot, paper, fit.w, fit.h]);

  return (
    <group>
      {/* LA PILE NAÎT INVISIBLE. Sa boîte est unitaire : tant que le volume ne
          l'a pas mise à SES dimensions (voir `place`, à chaque image), c'est un
          cube d'une unité de côté — soit, au cadrage de la scène, un grand
          carré beige posé en plein milieu, sa tranche crème sur le côté. Et il
          y a bien une image pour ça : les `useFrame` tournent sur rAF, les
          effets qui publient les nœuds sont différés par React, et rien ne
          garantit l'ordre des deux. C'est le voile beige qui apparaissait à
          l'ouverture. `place` la rallume dès qu'elle a une taille. */}
      <mesh ref={stack} material={faces} visible={false}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>
      {page && painted.current && (
        // La planche est calée sur la GOUTTIÈRE : c'est là qu'elle est cousue.
        // Le jeu de format part vers le bord d'ouverture, comme sur un volume
        // imprimé.
        <group ref={sheet}>
          <mesh geometry={paper.geo} material={mat} frustumCulled={false} />
          {/* L'OMBRE DE RELIURE, SUR LES DEUX FACES. La moitié lue est
              retournée par sa charnière : c'est son DOS qu'on regarde (voir le
              matériau de la planche, double face lui aussi). En face avant
              seulement, son ombre était éliminée au culling — d'où le pli
              marqué à droite et la page de gauche posée à plat, sans rien.
              `flip` dit laquelle des deux tombe à gauche de l'écran, sens de
              lecture compris : c'est elle qui garde l'ombre la plus légère. */}
          <mesh geometry={paper.shade} frustumCulled={false} renderOrder={2}>
            <meshBasicMaterial
              map={gutter}
              transparent
              opacity={flip ? GUT_SHADE_LEFT : 1}
              side={THREE.DoubleSide}
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------- le volume --

function Volume({
  box,
  cuts,
  wrap,
  views,
  wide,
  ratio,
  index,
  turn,
  tex,
  ctl,
  rtl,
  from,
  pose,
  onTurnEnd,
  onLanded,
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);

  const b = useMemo(() => blockOf(box), [box]);
  const P = box.d - box.w / 2; // le plat, du dos au bord d'ouverture
  const D = b.d; // la largeur du gabarit de page
  const H = b.h; // sa hauteur
  const T = b.w; // l'épaisseur du bloc

  // LA PAGE DU VOLUME. Une seule taille pour tout le titre : les deux moitiés,
  // la feuille en vol et les piles la partagent, et c'est ce qui garantit qu'il
  // n'y a rien à rattraper quand une feuille se pose sur une autre.
  const fit = useMemo(() => fitPage(ratio, D, H), [ratio, D, H]);

  const gutter = useMemo(() => gutterTexture(), []);
  useEffect(() => () => gutter.dispose(), [gutter]);

  // ---- les rubans. Le dos et la page en vol sont refaits à chaque image ; les
  //      deux plats ne bougent jamais dans leur repère, ils sont montés une fois.
  const spinePts = useMemo(() => profile(16), []);
  const sheetPts = useMemo(() => profile(SEG), []);

  const geo = useMemo(() => {
    const back = cuts?.x ?? 0.45;
    const spine = cuts?.w ?? 0.1;
    // LE MIROIR DU SENS DE LECTURE. La scène entière est retournée pour un
    // manga : toutes les UV le sont donc aussi, sans quoi les planches se
    // liraient à l'envers. C'est le seul endroit où `rtl` touche la géométrie.
    const uv = (arr) => (rtl ? arr.map((v) => 1 - v) : arr);
    const ramp = (a, c) =>
      Array.from({ length: spinePts.length }, (_, i) =>
        mix(a, c, i / (spinePts.length - 1))
      );
    return {
      // Le plat verso se parcourt du bord d'ouverture VERS le dos : c'est le
      // sens de la feuille imprimée, donc celui des UV.
      back: ribbonGeometry(
        [
          [P, -COVER],
          [0, -COVER],
        ],
        uv([0, back]),
        box.h
      ),
      front: ribbonGeometry(
        [
          [0, 0],
          [P, 0],
        ],
        uv([back + spine, 1]),
        box.h
      ),
      // L'arc est échantillonné à pas d'angle constant et à rayon constant :
      // ses points sont donc équidistants, et une rampe linéaire répartit bien
      // le dos imprimé par longueur d'arc.
      spine: ribbonGeometry(spinePts, uv(ramp(back, back + spine)), box.h),
      ...sheetPair(sheetPts, uv, H),
    };
  }, [P, box.h, H, cuts, rtl, spinePts, sheetPts]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);

  // RIEN DERRIÈRE LES PAGES. Ni contreplat crème, ni jaquette repassée en
  // double face : le volume ouvert, ce sont DEUX PLANCHES, et c'est tout.
  //
  // La jaquette reste donc simple face, comme elle l'a toujours été — ses plats
  // ne se voient que du dehors, quand le volume est fermé ou qu'on le retourne.
  // Ouvert, on regarde leur envers : rien n'y est dessiné, donc rien ne s'y
  // dessine. C'était la seule raison d'être du contreplat, et c'était un
  // mauvais échange — un cadre de papier autour de chaque page contre un
  // « trou » que personne ne regarde.
  const wrapMat = usePaper(wrap);

  // LES DEUX DOUBLES PAGES EN PRÉSENCE. Pendant qu'une feuille vole, les deux
  // moitiés ne montrent pas la même : la moitié lue garde celle qu'on quitte,
  // la moitié à lire découvre déjà celle qui arrive. Chacune est donc jugée
  // pour son compte — et une planche double s'étale sur les deux pages du
  // volume au lieu d'être écrasée sur une seule.
  const readSpread = views[turn ? turn.a : index];
  const restSpread = views[turn ? turn.a + 1 : index];
  const readWide = readSpread?.length === 1 && wide(readSpread[0]);
  const restWide = restSpread?.length === 1 && wide(restSpread[0]);

  // Les deux faces de la page en vol partagent le MÊME ruban : le recto est vu
  // de face, le verso par derrière — donc à l'envers, ce qui est exactement la
  // bonne orientation pour la planche qui va se poser sur l'autre pile.
  //
  // Leurs UV suivent la même règle que les moitiés : le recto court de la
  // charnière vers l'extérieur (page de droite en lecture occidentale), le
  // verso à l'envers. D'où le côté du scan que chacun emporte quand la planche
  // est une double page.
  const sheetFront = turn ? views[turn.a]?.[views[turn.a].length - 1] : null;
  const sheetBack = turn ? views[turn.a + 1]?.[0] : null;
  const frontWide = !!turn && readWide;
  const backWide = !!turn && restWide;
  const frontMat = usePaper(sheetFront ? tex[sheetFront.index] : null, {
    color: 0xfffdf7,
    crop: frontWide ? (rtl ? 0 : 0.5) : null,
  });
  const backMat = usePaper(sheetBack ? tex[sheetBack.index] : null, {
    side: THREE.BackSide,
    color: 0xfffdf7,
    crop: backWide ? (rtl ? 0.5 : 0) : null,
  });

  // ---- les nœuds pilotés à la main : leur transformation change à chaque
  //      image, un rendu React par image ferait ramer la scène.
  const rig = useRef(null);
  const slide = useRef(null);
  const hinge = useRef(null);
  const flying = useRef(null);
  const flyShade = useRef(null);
  const restSlot = useRef({});
  const readSlot = useRef({});
  const landed = useRef(false);
  const cracked = useRef(false); // le dos a déjà craqué : on n'ouvre qu'une fois

  // Le point de départ du vol : la place EXACTE qu'occupait le volume sur
  // l'étagère, en unités de scène. Tout se passe dans la 3D — déformer le
  // canvas en CSS ferait mesurer à R3F un cadre faussé, et la scène partirait
  // de travers.
  const startFit = useRef(null);
  useEffect(() => {
    if (!from) return;
    const vTan = Math.tan((FOV * Math.PI) / 180 / 2);
    const aspect = Math.max(0.4, size.width / size.height);
    const d = Math.max((box.h * FRAME) / (2 * vTan), (P * 1.5) / (2 * vTan * aspect));
    const perPx = (2 * d * vTan) / Math.max(1, size.height);
    const rect = gl.domElement.getBoundingClientRect();
    startFit.current = {
      x: (from.x - (rect.left + rect.width / 2)) * perPx,
      y: (rect.top + rect.height / 2 - from.y) * perPx,
      s: Math.max(0.05, (from.h * perPx) / box.h),
    };
  }, [from, size, gl, box.h, P]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const s = ctl.current;

    // LA FEUILLE NE DISPARAÎT QU'UNE FOIS LA DOUBLE-PAGE RENDUE. Elle se pose au
    // milieu d'une image, mais React ne re-rend qu'ensuite : la retirer tout de
    // suite découvrait, le temps d'une image ou deux, la planche qu'elle venait
    // précisément de recouvrir — le clignotement qu'on voyait en la lâchant.
    // Posée à plat sur sa pile d'arrivée, elle est indiscernable de la planche
    // qui va la remplacer : on peut donc l'y laisser autant qu'il faut.
    //
    // `done` EST TOUTE LA CONDITION, et son absence coûtait cher. « Pas de page
    // dans l'état, mais une dans la boucle » a DEUX causes opposées : la feuille
    // vient de se poser (il faut la retirer), ou elle vient d'être LANCÉE et le
    // rendu n'a pas encore suivi. Sans distinguer les deux, un clic sur une
    // flèche voyait sa page tournée annulée dans l'image même où elle partait —
    // il ne restait que la page de droite qui changeait toute seule, et il
    // fallait cliquer une seconde fois (l'état, lui, avait fini par se poser)
    // pour voir enfin la feuille voler. Le glissement, lui, s'en sortait sans
    // qu'on s'en aperçoive : il relance le geste à chaque mouvement de souris.
    if (!turn && s.turn?.done) s.turn = null;

    // ---- 1. l'arrivée, puis l'ouverture, et l'inverse au retour. Les deux
    //      gestes ne se chevauchent JAMAIS : on n'ouvre pas un livre en le
    //      sortant du rayon, et on ne le range pas grand ouvert. Le volume se
    //      referme d'abord, puis s'en va — les délais de `close` comptent
    //      d'ailleurs les deux temps bout à bout.
    const shutting = s.leaving && s.open > 0.02;
    s.arrive = Math.max(
      0,
      Math.min(
        1,
        s.arrive + (s.leaving ? (shutting ? 0 : -dt / FLY_BACK) : dt / FLY_OUT)
      )
    );
    const arrive = easeInOut(s.arrive);
    // La reprise en main : venu de la vitrine, le volume n'arrive pas, il EST
    // déjà là — dans la pose exacte où on le tenait. Il se redresse d'abord, il
    // s'ouvre ensuite.
    s.hand = Math.min(1, s.hand + dt / HAND_TIME);
    const hand = easeInOut(s.hand);
    // UN VOLUME OUVERT NE SE REFERME QUE SI ON LE REFERME. `ready` ne commande
    // que la PREMIÈRE ouverture : une fois ouvert, il le reste, quoi qu'il
    // arrive aux planches suivantes. Branché en permanence dessus, il claquait
    // dès qu'on sautait à une double-page dont les images n'étaient pas encore
    // arrivées — et se rouvrait derrière. C'est ce battement qu'on voyait.
    const wants =
      !s.leaving && (s.opened || (s.ready && arrive > 0.62 && s.hand > 0.8));
    // LE SON SUIT LA COUVERTURE, PAS LE CLIC. Un volume ne s'ouvre pas quand on
    // le demande : il s'ouvre quand il est arrivé et qu'il a de quoi montrer.
    // Entre les deux il se passe une bonne demi-seconde de vol, et un craquement
    // de dos joué au clic tomberait sur un livre encore fermé, en train de
    // traverser l'écran. Cette image-ci est la seule à savoir que le dos
    // commence à se déplier — c'est donc ici, et une fois par volume.
    if (wants && !cracked.current) {
      cracked.current = true;
      playBookOpenSound();
    }
    s.open = Math.max(
      0,
      Math.min(1, s.open + (wants ? dt / OPEN_TIME : -dt / SHUT_TIME))
    );
    if (s.open >= 1) s.opened = true;
    const open = easeInOut(s.open);

    // ---- 2. la page en vol. `t` est SA POSITION, pas l'avancement d'une
    //      animation : 0 = couchée sur la pile à lire, 1 = retournée sur la pile
    //      lue. Elle y va toute seule — sauf quand un doigt la tient, et là
    //      c'est la main qui commande.
    if (s.turn && !s.turn.grab) {
      const way = s.turn.dir > 0 ? 1 : -1;
      s.turn.t = Math.max(0, Math.min(1, s.turn.t + (way * dt) / TURN_TIME));
      const home = way > 0 ? s.turn.t >= 1 : s.turn.t <= 0;
      if (home && !s.turn.done) {
        s.turn.done = true;
        onTurnEnd(way > 0 ? s.turn.a + 1 : s.turn.a, way);
      }
    }
    const sPos = s.turn ? s.turn.t : 0;

    // ---- 3. la géométrie du moment
    spinePath(spinePts, box.w, open);
    for (const p of spinePts) p[1] -= COVER;
    const hx = spinePts[spinePts.length - 1][0];
    const hz = spinePts[spinePts.length - 1][1];
    const gut = -hx; // la gouttière : nulle tant que le volume est fermé
    const x0 = (-GUT_PULL * gut) / 2;
    ribbonUpdate(geo.spine, spinePts, box.h);

    if (hinge.current) {
      hinge.current.position.set(hx, 0, hz);
      hinge.current.rotation.y = -Math.PI * open;
    }
    // Fermé, le volume est cadré sur lui-même ; ouvert, sur sa gouttière.
    if (slide.current) slide.current.position.x = -mix(P / 2, -gut / 2, open);

    // LES DEUX PILES SONT ÉGALES, TOUJOURS. Elles se partageaient l'épaisseur du
    // bloc au prorata de ce qui avait été lu — le volume s'épaississait du côté
    // lu à mesure qu'on avançait, et ça se voyait. C'était joli et c'était faux
    // partout ailleurs : les deux planches sont cousues sur la MÊME ligne, mais
    // chacune plonge vers elle depuis le dessus de SA pile, et le pli est
    // plafonné (BIND_MAX) pour ne pas devenir une falaise. Deux piles d'inégale
    // hauteur laissaient donc entre leurs bords intérieurs une fente de la
    // hauteur de leur écart — d'où le jour qu'on voyait au ras du dos, à gauche
    // au début du volume, à droite à la fin, jamais au milieu.
    //
    // À égalité, les deux bords tombent à la même profondeur : la gouttière se
    // referme d'elle-même, à tous les endroits du volume. Et le vol d'une page
    // n'a plus de charnière qui glisse d'une hauteur à l'autre — elle reste au
    // fond du pli, ce qu'elle n'aurait jamais dû quitter.
    //
    // Fermé, en revanche, tout est d'un seul côté : c'est ce qui fait qu'un
    // volume rangé a l'épaisseur d'un volume, et non de deux demis.
    const readT = (T / 2) * open;
    const restT = T - readT;

    // LA PILE EST À LA TAILLE DE SES PAGES, et son dessus s'arrête au point le
    // plus BAS de la planche qui la couvre. Deux règles, deux bogues :
    //
    //   • à la taille du gabarit, elle débordait de la planche sur les quatre
    //     côtés — d'où ce liseré de papier nu tout autour de chaque image ;
    //   • à fond plat, la planche PLONGEAIT DEDANS en approchant de la reliure,
    //     et disparaissait derrière le dessus de sa propre pile. C'était la
    //     grande bande blanche au ras de la gouttière.
    // `base` : de combien la pile décolle du plat qui la porte. Sans lui, la
    // pile lue démarrait DANS LE PLAN de la couverture — et comme elle existe
    // même vide (au tout début du volume, il n'y a rien de lu), son dessus se
    // disputait la profondeur avec la couverture : c'était le grand rectangle
    // de papier posé au milieu du plat recto.
    const place = (slot, zDir, thick, base) => {
      const t = Math.max(0, thick);
      const n = slot.current;
      const w = n.w || D;
      const h = n.h || H;
      // Volume fermé, les pages sont à plat ; ouvert, chacune replonge vers le
      // dos de toute la hauteur de sa pile — elle y est collée.
      const dip = open * Math.min(t, w * BIND_MAX);
      if (n.stack?.current) {
        const body = t - dip;
        // Une pile vide ne se dessine pas. Un pavé d'épaisseur nulle, lui, se
        // dessine toujours — à plat, exactement là où il ne faut pas.
        n.stack.current.visible = body > SHEET;
        n.stack.current.scale.set(w, h, Math.max(SHEET, body));
        n.stack.current.position.set(x0 + w / 2, 0, zDir * (base + body / 2));
      }
      if (n.sheet?.current) n.sheet.current.position.set(x0, 0, zDir * (base + t));
      if (n.geo) {
        pagePath(n.pts, w, dip, w * BIND_SPAN + dip * 0.9, -zDir);
        ribbonUpdate(n.geo, n.pts, h);
      }
    };
    // La pile à lire repose sur le plat verso, déjà posé une épaisseur de
    // couverture plus bas ; la pile lue repose sur le plat recto, dont le repère
    // EST le plan de la couverture — d'où le décalage explicite.
    place(restSlot, 1, restT, 0);
    // Une feuille de plus : refermé, la planche du dessus de la pile lue et
    // celle de la pile à lire sont deux feuilles voisines, pas la même.
    place(readSlot, -1, readT, COVER + SHEET);

    // ---- 4. la page en vol : sa charnière suit le sommet des deux piles, et
    //      son profil se recalcule entièrement. Deux feuilles d'écart avec la
    //      planche qu'elle recouvre : de quoi ne jamais bagarrer en profondeur.
    if (flying.current) {
      const on = !!s.turn && !!sheetFront;
      flying.current.visible = on;
      if (on) {
        // L'OMBRE DE RELIURE NE VAUT QUE POSÉE. Une feuille dressée en l'air
        // n'a plus de creux où se plier : son pli s'efface à mesure qu'elle se
        // lève et revient plein quand elle se repose. Et il revient AU NOIR DE
        // LA PILE OÙ ELLE ATTERRIT — sinon la feuille se posait plus sombre que
        // la page qu'elle devient, et c'est ce raccord-là qui sautait.
        //   sPos = 0 : couchée sur la pile à lire · 1 : sur la pile lue.
        if (flyShade.current)
          flyShade.current.opacity =
            mix(rtl ? GUT_SHADE_LEFT : 1, rtl ? 1 : GUT_SHADE_LEFT, sPos) *
            (1 - Math.sin(Math.PI * sPos));
        // SON PLI EST CELUI DES PAGES POSÉES, et il le reste d'un bout à l'autre
        // du vol : une feuille qu'on tourne est cousue au fond de la gouttière,
        // et ce n'est pas parce qu'on la soulève par son bord libre que son bord
        // relié en sort. Le creux se calcule donc exactement comme celui d'une
        // planche posée (voir `place`), au mot près — deux formules qui
        // divergeraient rouvriraient l'écart qu'on vient de fermer.
        //
        // Les deux piles étant d'égale épaisseur, ce creux est le même des deux
        // côtés et la charnière ne glisse plus : la feuille épouse au point près
        // la planche qu'elle recouvre, puis celle qu'elle devient, sans jamais
        // rien croiser entre les deux.
        const dipFly = open * Math.min(restT, fit.w * BIND_MAX);
        sheetPath(
          sheetPts,
          -gut / 2,
          mix(restT, readT, sPos) + SHEET * 2,
          ((1 - GUT_PULL) * gut) / 2,
          fit.w,
          Math.PI * sPos,
          CURL * Math.sin(Math.PI * sPos),
          dipFly,
          fit.w * BIND_SPAN + dipFly * 0.9
        );
        ribbonUpdate(geo.sheet, sheetPts, fit.h);
      }
    }

    // ---- 5. le cadrage. La caméra recule à mesure que le volume s'ouvre :
    //      fermé il tient dans un plat, ouvert il en fait deux.
    const vTan = Math.tan((FOV * Math.PI) / 180 / 2);
    const aspect = Math.max(0.4, size.width / size.height);
    const spanW = mix(P * 1.5, (2 * D + gut) * 1.08, open);
    const d = Math.max((box.h * FRAME) / (2 * vTan), spanW / (2 * vTan * aspect));
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    // Ce que vaut un pixel d'écran en unités de scène : le taux de change du
    // déplacement à la souris, et il change avec le recul de la caméra.
    s.perPx = (2 * d * vTan) / Math.max(1, size.height);

    // ---- 5 bis. LES CADRAGES CALCULÉS — la lecture guidée et la vue
    //      d'ensemble. Ils se règlent ICI, et nulle part ailleurs : c'est le
    //      seul endroit qui connaisse à la fois le format de la page et ce que
    //      la caméra montre à cet instant. Le clavier, lui, ne déplace qu'un
    //      NOMBRE ENTRE 0 ET 1 — il n'a aucune coordonnée à manipuler, donc
    //      rien à recalculer quand la fenêtre change de taille : le cadrage
    //      suit tout seul.
    //
    //      Le volume doit être GRAND OUVERT : à mi-ouverture, les deux pages ne
    //      sont pas encore à leur place et la station viserait à côté.
    const view = s.perPx * size.height; // la hauteur cadrée, en unités
    s.view = view; // le clavier s'en sert pour doser un défilement

    // LE TRAJET EST TENU, PAS AMORTI. L'amortissement exponentiel qui sert au
    // reste de la scène (une valeur qui court après sa cible) démarre à pleine
    // vitesse et finit en traînant : sur un petit rattrapage ça ne se voit pas,
    // mais sur un saut du bas d'une page au haut de l'autre, ça part d'un
    // coup — la secousse qu'on voyait en tournant.
    //
    // Ici la caméra fait un VRAI trajet : elle démarre à l'arrêt, prend de la
    // vitesse et se pose. Et elle écrit directement les valeurs affichées, de
    // sorte que l'amortisseur d'après ne rattrape plus rien et n'ajoute pas sa
    // propre traîne par-dessus.
    const travel = (tx, ty, tz) => {
      const same = s.gTo && s.gTo.x === tx && s.gTo.y === ty && s.gTo.z === tz;
      if (!same) {
        s.gFrom = { x: s.panAtX, y: s.panAtY, z: s.zoomAt };
        s.gTo = { x: tx, y: ty, z: tz };
        s.gT = 0;
      }
      s.gT = Math.min(1, s.gT + dt / GUIDE_MOVE);
      const k = easeInOut(s.gT);
      s.panX = s.panAtX = mix(s.gFrom.x, tx, k);
      s.panY = s.panAtY = mix(s.gFrom.y, ty, k);
      s.zoom = s.zoomAt = mix(s.gFrom.z, tz, k);
    };

    // ... ET LE SUIVI, l'autre régime. On ne VA nulle part : on déroule la
    // planche, on approche à la molette. La cible est simplement posée, et
    // l'amortisseur commun (étape 6, celui du zoom à la main) la rattrape —
    // c'est ce qui fait qu'un geste continu se sent continu. Le trajet en
    // cours est oublié, pour que le prochain reparte d'ici et non d'une
    // destination qu'on a quittée en route.
    const aim = (tx, ty, tz) => {
      if (!s.glide) return travel(tx, ty, tz);
      s.gTo = null;
      s.panX = tx;
      s.panY = ty;
      s.zoom = tz;
      return undefined;
    };

    if (s.fill && open > 0.98) {
      // LA VUE D'ENSEMBLE (barre d'espace). On recule jusqu'à ce que la double
      // page tienne toute la hauteur du cadre — et un cheveu de plus, pour
      // qu'elle morde sur les deux bords. Elle passe donc DEVANT la lecture
      // guidée sans l'annuler : le mode attend, la station est reprise telle
      // quelle au second appui.
      const zH = (view / Math.max(0.01, fit.h)) * FILL_H;
      const zW =
        (s.perPx * size.width * FILL_W) / Math.max(0.01, 2 * fit.w + gut);
      travel(0, 0, Math.max(1, Math.min(zH, zW)));
    } else if (s.guide && open > 0.98) {
      // Filet de sécurité : une double page qui n'a pas de seconde planche (la
      // dernière d'un volume impair) ramène la station sur la première. Le
      // clavier le sait déjà, mais lui seul — un saut à la règle, lui, peut
      // tomber ici sans prévenir.
      if (s.guide.step === 1 && !restWide && !restSpread?.[1]) s.guide.step = 0;
      // DEUX CADRAGES POSSIBLES, ON PREND LE PLUS LARGE DES DEUX : la page en
      // pleine largeur, ou la page en deux bandes. Sur une planche haute, c'est
      // le second qui l'emporte — mieux vaut un peu de marge sur les côtés
      // qu'une page à balayer en quatre fois.
      const byWidth = (s.perPx * size.width * GUIDE_FILL) / Math.max(0.01, fit.w);
      const byRows = (view * (GUIDE_ROWS - GUIDE_OVERLAP)) / Math.max(0.01, fit.h);
      // `guideZoom` est la part du lecteur : la molette la fait varier sans
      // sortir du mode, et la course se recompte en conséquence.
      const z = Math.min(
        GUIDE_MAX,
        Math.max(1, Math.min(byWidth, byRows) * s.guideZoom)
      );
      const win = view / z; // ce que la fenêtre montre de la page
      const span = Math.max(0, fit.h - win); // ce qui dépasse, à parcourir

      // LA POSITION EST CONTINUE, PLUS UN NUMÉRO DE BANDE. C'est ce qui permet
      // aux deux familles de touches de coexister : les flèches gauche/droite
      // avancent d'une BANDE (une hauteur d'écran moins le recouvrement), celles
      // du haut et du bas d'une fraction de cette bande. Un cran discret ne
      // savait faire que la première, et la flèche du bas tombait donc une demi-
      // page plus loin à chaque appui.
      //
      // ET LE CAS OÙ IL N'Y A RIEN À PARCOURIR. Une page qui tient tout entière
      // dans le cadre (planche courte, grand écran, molette reculée) n'a pas de
      // course : sans le dire au clavier, les flèches dépensaient un appui à
      // « descendre » d'un néant avant de daigner changer de page, et celles du
      // haut et du bas ne faisaient rien du tout sans qu'on sache pourquoi.
      s.scroll = span > 1e-4;
      s.band = s.scroll ? Math.min(1, (win * (1 - GUIDE_OVERLAP)) / span) : 1;

      // CE QU'UN PIXEL DE DOIGT VAUT DANS LA COURSE DE LA PAGE. Le glisser
      // tactile a besoin du même taux de change que la molette, et seule cette
      // boucle connaît à la fois le cadrage et ce qu'il reste à parcourir.
      //
      // Le zoom et l'échelle de la scène disparaissent du calcul, et ce n'est
      // pas une approximation : ils sont DÉJÀ dans `band` d'un côté et dans la
      // hauteur cadrée de l'autre, et ils s'annulent. Il ne reste que la
      // hauteur de l'écran — autrement dit, le doigt et la planche avancent
      // exactement du même nombre de pixels.
      s.atPerPx = s.scroll ? s.band / (size.height * (1 - GUIDE_OVERLAP)) : 0;

      // MAINTENUE, LA FLÈCHE FAIT DÉFILER POUR DE BON. C'est une VITESSE qu'on
      // intègre ici, image par image — la répétition du clavier, elle, ne sait
      // qu'empiler des petits sauts, et trente sauts par seconde ne font pas un
      // défilement, ils font un tremblement.
      if (s.vy && s.scroll) s.guide.at += s.vy * GUIDE_SPEED * s.band * dt;

      // La position est bornée ICI et RÉÉCRITE : le clavier peut donc demander
      // « tout en bas » sans savoir où c'est (il vise large, la boucle range).
      const at = s.scroll ? Math.min(1, Math.max(0, s.guide.at)) : 0;
      s.guide.at = at;

      // De l'ordre de lecture au côté de l'écran : la seule ligne où le sens
      // de lecture intervienne. Le repère du volume, lui, n'est jamais
      // retourné — c'est le miroir de la scène qui l'est, plus bas.
      const onLeft = (rtl ? 1 - s.guide.step : s.guide.step) === 0;
      const y = span / 2 - span * at;
      // Centrer un point du livre, c'est déplacer le livre de l'opposé : à ce
      // stade l'échelle d'arrivée vaut 1 (le volume est posé), le zoom fait
      // donc tout le change.
      aim(-z * (onLeft ? -fit.w / 2 : fit.w / 2), -z * y, z);
    }

    // ---- 6. le vol depuis l'étagère, le zoom et le déplacement. Les trois se
    //      composent sur le même nœud : on regarde de plus près UN objet qui est
    //      en train d'arriver, pas trois choses différentes.
    s.zoomAt += (s.zoom - s.zoomAt) * Math.min(1, dt * 9);
    s.panAtX += (s.panX - s.panAtX) * Math.min(1, dt * 10);
    s.panAtY += (s.panY - s.panAtY) * Math.min(1, dt * 10);
    if (rig.current) {
      const f = startFit.current;
      const left = 1 - arrive;
      const rest = 1 - hand; // ce qu'il reste de la pose héritée de la vitrine
      // DEUX REPÈRES, DEUX MOMENTS, ET ILS SE COMPOSENT PLUTÔT QUE DE SE
      // CHOISIR. Le volume peut avoir les deux à la fois : une POSE, héritée de
      // la vitrine, qui dit d'où il vient (il était déjà dans la main), et une
      // PLACE sur la planche, qui dit où il retourne. En les mettant en
      // alternative, la place l'emportait dès qu'elle existait et la reprise en
      // main sautait d'un cran d'échelle ; en les multipliant, chacun ne parle
      // que de ce qu'il sait — la main pour arriver, le rayon pour repartir.
      const held = pose ? mix(pose.height * FRAME, 1, hand) : 1;
      const flight = f ? mix(f.s, 1, arrive) : mix(pose ? 1 : 0.84, 1, arrive);
      const size = held * flight;
      rig.current.position.set(
        (f ? f.x * left : 0) + (pose ? pose.panX * box.h * FRAME * rest : 0) + s.panAtX,
        (f ? f.y * left : 0) + (pose ? pose.panY * box.h * FRAME * rest : 0) + s.panAtY,
        0
      );
      rig.current.scale.setScalar(size * s.zoomAt);
      // Venu du rayon, le volume arrive DE TRANCHE, comme on le voyait rangé, et
      // ne se présente qu'ensuite (les deux mouvements menés ensemble donneraient
      // une toupie). Venu de la vitrine, il part de l'assiette où on l'avait
      // laissé et se redresse.
      //
      // Et il S'EN RETOURNE DE TRANCHE : le quart de tour se compose avec ce qui
      // reste de la pose, au lieu de l'exclure. Sans ça, un volume ouvert depuis
      // la vitrine rentrait au rayon de face — une couverture qui recule dans la
      // planche au lieu d'un livre qui se range.
      const face = f ? Math.max(0, (arrive - 0.28) / 0.72) : 1;
      rig.current.rotation.y =
        (pose ? pose.spinY * rest : 0) + (Math.PI / 2) * (1 - face);
      // On le regarde d'un rien au-dessus : de quoi que les piles et le dos
      // existent, pas au point de rendre les planches fuyantes. Et on se remet
      // droit dès qu'on zoome — à ce moment-là on vient LIRE, et la moindre
      // fuyante rend une bulle de texte pénible.
      const tilt = -0.12 * open * Math.max(0, 2 - s.zoomAt);
      rig.current.rotation.x = pose ? mix(pose.tilt, tilt, hand) : tilt;
    }

    // Cette image-ci contient le volume, à sa place et dans sa pose : c'est
    // maintenant, et pas au montage, qu'on peut le retirer de l'étagère.
    //
    // À CONDITION QUE LES PILES SOIENT LÀ. Elles arrivent par un effet, donc
    // possiblement après cette image : rendre la main avant, c'est retirer la
    // vitrine pour découvrir un volume encore sans ses pages.
    if (!landed.current && restSlot.current.stack) {
      landed.current = true;
      onLanded?.();
    }
  });

  // Pendant qu'une feuille vole, les deux moitiés montrent DÉJÀ ce qu'il y aura
  // dessous : la pile à lire découvre la planche suivante, la pile lue garde la
  // sienne, et la feuille recouvre exactement ce qui change.
  //
  // Une double page n'a pas de seconde planche à donner à la moitié à lire :
  // c'est la MÊME image qui revient, recadrée sur son autre moitié.
  const read = readSpread?.[0] || null;
  const rest = (restWide ? restSpread[0] : restSpread?.[1]) || null;

  return (
    <group ref={rig}>
      <group scale-x={rtl ? -1 : 1}>
        <group ref={slide}>
          {/* ---- le dos, et la moitié qui ne bouge jamais ---- */}
          <mesh geometry={geo.spine} material={wrapMat} />
          <mesh geometry={geo.back} material={wrapMat} />
          <Half
            page={rest}
            tex={rest ? tex[rest.index] : null}
            fit={fit}
            flip={rtl}
            split={restWide}
            gutter={gutter}
            slot={restSlot}
          />

          {/* ---- la moitié lue : le plat recto et tout ce qui s'est empilé
                  dessus. Elle s'articule sur le DERNIER POINT DU DOS, donc elle
                  suit son dépliage sans qu'on ait rien à recaler. ---- */}
          <group ref={hinge}>
            <mesh geometry={geo.front} material={wrapMat} />
            <Half
              page={read}
              tex={read ? tex[read.index] : null}
              fit={fit}
              flip={!rtl}
              split={readWide}
              gutter={gutter}
              slot={readSlot}
            />
          </group>

          {/* ---- la feuille en vol. Hors sélection : ses sommets changent à
                  chaque image, sa sphère englobante ne vaut donc rien — et le
                  verso, qui partage ces sommets, n'a même pas la sienne. ---- */}
          <group ref={flying} visible={false}>
            <mesh geometry={geo.sheet} material={frontMat} frustumCulled={false} />
            <mesh geometry={geo.sheetBack} material={backMat} frustumCulled={false} />
            {/* Son pli de reliure, dosé à chaque image : plein quand la feuille
                est couchée, nul quand elle est en l'air (voir la boucle). */}
            <mesh geometry={geo.sheetShade} frustumCulled={false} renderOrder={3}>
              <meshBasicMaterial
                ref={flyShade}
                map={gutter}
                transparent
                side={THREE.DoubleSide}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={-3}
                polygonOffsetUnits={-3}
              />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

// ------------------------------------------------------------- lumières --
// Une planche est une IMAGE : on vient la lire, pas admirer l'éclairage. Le
// dosage vise donc un rendu quasi fidèle de face (somme ≈ 0,8 en éclairement
// diffus, three divisant par π), et aucune source n'est posée sur l'axe de la
// caméra — une frontale se refléterait pile au milieu de la planche.
function Lights() {
  return (
    <>
      <ambientLight intensity={1.55} />
      <directionalLight position={[2.1, 2.4, 3.4]} intensity={0.8} color="#fff6ea" />
      <directionalLight position={[-2.8, -0.6, 2.2]} intensity={0.32} color="#dde5ff" />
    </>
  );
}

// ================================================================= page ==

export default function BookReader3D({
  media,
  art,
  from,
  pose,
  startPage,
  onClose,
  onProgress,
  onLanded,
  onSettle,
}) {
  const { token } = useAuth();
  useScrollLock(true);
  // Les froissements de papier descendent PENDANT LE VOL du volume : le dos
  // craque une demi-seconde plus tard, la première page une seconde après. À la
  // demande, le craquement d'ouverture serait tombé dans le silence.
  useEffect(() => {
    primePaperSounds();
  }, []);

  const box = boxOf(media);
  const rtl = isRtl(media);

  const [pages, setPages] = useState(media.pages || []);
  // La planche où l'on s'était arrêté, relue au serveur à l'ouverture (voir plus
  // bas). Trois valeurs, et la distinction compte : `undefined` = la réponse est
  // EN ROUTE (on ne place rien, on attend), `null` = le serveur n'a rien à dire,
  // un nombre = la planche. C'est un point de départ, jamais un suivi.
  const [mark, setMark] = useState(undefined);
  const [paint, setPaint] = useState(art || null);
  const [tex, setTex] = useState({});
  const [tries, setTries] = useState(0); // reprises après une planche manquée
  const [index, setIndex] = useState(0);
  const [turn, setTurn] = useState(null); // { a, dir } — la feuille en vol
  const [leaving, setLeaving] = useState(false);
  // Le voile ne se pose qu'une fois le volume dessiné ICI, et le cartouche
  // s'écarte dès qu'on zoome : deux seuils franchis une fois, pas deux rendus
  // par image.
  const [veiled, setVeiled] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  // La lecture guidée est-elle en cours ? L'état de navigation, lui, vit dans
  // `ctl` (il change soixante fois par seconde) : celui-ci n'est là que pour
  // l'écran — le bouton allumé, les commandes de défilement, la ligne d'aide.
  const [guided, setGuided] = useState(false);
  const [filled, setFilled] = useState(false); // la double page à pleine hauteur
  // LE CURSEUR S'EFFACE QUAND ON LIT. Une flèche posée en travers d'une planche
  // est la seule chose de l'écran qui n'appartienne pas au volume ; au bout
  // d'une seconde sans le moindre mouvement, on ne vise plus rien — on lit. Le
  // premier geste la ramène.
  const [idle, setIdle] = useState(false);

  // ---- LE TUTORIEL DE LA PREMIÈRE FOIS. Au clavier et à la souris seulement :
  //      ses cinq gestes sont des touches, et il n'aurait rien à dire à un
  //      pouce. La décision est prise UNE FOIS, au montage — sans quoi rouvrir
  //      un volume dans la même session le ramènerait tant que la dernière
  //      étape n'a pas été franchie.
  const desktop = useMediaQuery("(min-width: 900px) and (pointer: fine)");
  const [tuto, setTuto] = useState(() => !tutorialSeen());
  // Ce que le lecteur a VU faire. Les deux autres preuves (lecture guidée, vue
  // d'ensemble) sont déjà des états à part entière, on ne les double pas.
  const [did, setDid] = useState({ turned: false, scrolled: false, advanced: 0 });
  const noted = useCallback(
    (what) => setDid((d) => (d[what] ? d : { ...d, [what]: true })),
    []
  );
  // Certains gestes ne s'apprennent pas en UNE fois : la flèche de lecture
  // descend d'abord dans la page, puis passe à celle d'à côté, puis tourne. Un
  // seul appui n'en montre que le premier tiers, et on croit que c'est tout ce
  // qu'elle fait. Ceux-là se comptent.
  const counted = useCallback(
    (what) => setDid((d) => ({ ...d, [what]: (d[what] || 0) + 1 })),
    []
  );

  // PENDANT LE TUTORIEL, SEUL LE GESTE DEMANDÉ RÉPOND. Un guide qu'on peut
  // quitter par le côté n'apprend rien : on tape une touche au hasard, il ne se
  // passe pas ce qui est écrit à l'écran, et on décroche en se disant que c'est
  // cassé. Le tutoriel pose donc ici la liste de ce qui est ouvert, et tout le
  // reste devient un geste sans effet — le temps de six touches.
  //
  // `null` = rien n'est bridé, ce qui est l'état de tout le monde sauf pendant
  // ces quelques secondes. Le bouton « Passer » et la croix, eux, ne passent
  // jamais par ici : on ne s'enferme pas dans un tutoriel.
  const [gate, setGate] = useState(null);
  // Mémorisé sur `gate` et non refait à chaque rendu : le clavier s'abonne avec
  // lui, et une fonction neuve à chaque image ferait poser et retirer l'écouteur
  // soixante fois par seconde.
  const allow = useCallback((what) => !gate || gate.includes(what), [gate]);

  const texRef = useRef({});
  const gone = useRef(false);
  const placed = useRef(false);

  // Le test des doubles pages se fait sur TOUT le volume à la fois (voir
  // `spreadTest`) : c'est la planche courante du titre qui dit ce qui est
  // large, pas un rapport choisi une fois pour toutes.
  const wide = useMemo(() => spreadTest(pages), [pages]);

  // LA COUVERTURE N'EST PAS UNE PLANCHE DU BLOC. Le premier fichier d'une
  // archive EST la couverture — c'est la convention de l'import, qui en fait la
  // jaquette du titre. Elle est donc déjà sous les yeux, imprimée sur le plat
  // qu'on vient d'ouvrir : la garder dans le bloc, c'est la lire deux fois, une
  // fois sur l'objet et une fois sur sa première page.
  //
  // Et ça remet les paires d'aplomb sur l'impression : le bloc commence à la
  // planche 1, donc 1 fait face à 2, 3 à 4 — exactement le découpage de la
  // lecture à plat, où la couverture s'ouvre seule. Les deux lecteurs montrent
  // enfin les mêmes planches côte à côte.
  //
  // Un volume d'une seule planche garde la sienne : mieux vaut la voir deux
  // fois que pas du tout.
  const leaves = useMemo(() => (pages.length > 1 ? pages.slice(1) : pages), [pages]);
  const views = useMemo(() => buildSpreads(leaves, wide), [leaves, wide]);

  // Le format de page du volume : une seule taille pour toutes ses planches
  // (voir `pageRatio`), sans quoi chaque page a la sienne et rien ne s'aligne.
  const ratio = useMemo(() => pageRatio(pages), [pages]);

  const ctl = useRef({
    // Venu de la vitrine, le volume est DÉJÀ arrivé : il n'a pas de vol à faire,
    // seulement une pose à quitter.
    arrive: pose ? 1 : 0,
    hand: pose ? 0 : 1,
    open: 0,
    opened: false,
    ready: false,
    leaving: false,
    turn: null,
    // Zoom et déplacement : la valeur VOULUE et la valeur AFFICHÉE. La seconde
    // court après la première à chaque image — une molette qui téléporte, c'est
    // un saut ; amortie, c'est un mouvement de caméra.
    zoom: 1,
    zoomAt: 1,
    panX: 0,
    panY: 0,
    panAtX: 0,
    panAtY: 0,
    perPx: 0.002,
    view: 1, // la hauteur cadrée, en unités de scène (posée par la boucle)
    // La lecture guidée : `{ step, at }` quand elle est en cours, null sinon.
    // `step` est une page DANS L'ORDRE DE LECTURE (0 = la première du couple),
    // pas un côté d'écran — c'est ce qui la fait marcher en manga sans un seul
    // test de sens. `at` est la position dans la hauteur de cette page, de 0
    // (le haut) à 1 (le bas) ; elle est bornée par la boucle, qui seule connaît
    // le cadrage du moment.
    guide: null,
    // Ce que vaut une BANDE (une hauteur d'écran) ramené à la course totale de
    // la page : de quoi que le clavier avance d'un écran sans rien savoir du
    // cadrage. Posé par la boucle, lu par les flèches — comme `scroll`, qui dit
    // simplement s'il y a quelque chose à parcourir.
    band: 1,
    scroll: false,
    // Le régime de caméra du moment (voir GUIDE_NUDGE) : `glide` pour un
    // ajustement qu'on suit, sinon un trajet d'une station à l'autre. `vy` est
    // le défilement demandé, en bandes par seconde — non nul tant que la
    // flèche (ou le chevron) reste enfoncée.
    glide: false,
    vy: 0,
    // La vue d'ensemble : la double page à pleine hauteur, le temps de la
    // regarder. Elle SUSPEND la lecture guidée sans l'éteindre.
    fill: false,
    // Le cadrage guidé est calculé, mais pas imposé : la molette applique ce
    // facteur par-dessus, et les bandes se recomptent en conséquence. 1 = le
    // cadrage que le mode a choisi tout seul.
    guideZoom: 1,
    // Le trajet en cours d'une station à l'autre : d'où l'on part, où l'on va,
    // et où l'on en est. `gTo` à null = aucun trajet, la prochaine station en
    // ouvrira un depuis la position du moment.
    gFrom: { x: 0, y: 0, z: 1 },
    gTo: null,
    gT: 1,
  });

  // ---- LE CURSEUR S'EFFACE AU BOUT D'UNE SECONDE D'IMMOBILITÉ, et le moindre
  //      geste le ramène. Le seuil est franchi UNE FOIS, pas à chaque pixel : un
  //      `setIdle(false)` par mouvement de souris, c'est soixante rendus par
  //      seconde d'une scène 3D pour repeindre une flèche. La ref garde donc
  //      l'état réel, et React n'en entend parler qu'aux deux passages.
  const awake = useRef(true);
  useEffect(() => {
    let t = null;
    const wake = () => {
      if (!awake.current) {
        awake.current = true;
        setIdle(false);
      }
      clearTimeout(t);
      t = setTimeout(() => {
        awake.current = false;
        setIdle(true);
      }, CURSOR_IDLE);
    };
    wake();
    // `pointermove` couvre la souris comme le stylet ; le doigt, lui, n'a pas de
    // curseur à effacer, et l'effacer ne lui coûte rien.
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("wheel", wake, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("wheel", wake);
    };
  }, []);

  // ---- les planches. La liste de l'étagère ne les porte pas (une centaine
  //      d'URL par titre pèserait pour rien) : on va les chercher à l'ouverture,
  //      pendant que le volume fait son vol.
  //
  //      ET ELLE PART À CHAQUE OUVERTURE, MÊME QUAND LES PLANCHES SONT DÉJÀ LÀ,
  //      parce que ce n'est pas pour elles qu'on y va : c'est pour LA
  //      PROGRESSION. Personne d'autre ne la connaît à jour —
  //
  //        • la carte du rayon a été chargée en arrivant sur la page et n'a plus
  //          bougé depuis ;
  //        • la vitrine précharge bien les planches pendant qu'on retourne le
  //          volume, mais une seule fois, et elle les garde en cache : à la
  //          deuxième ouverture elle ne redemande plus rien.
  //
  //      Le lecteur recevait donc des planches fraîches et une progression
  //      vieille de toute la session. On lisait, on refermait, on rouvrait — et
  //      on retombait exactement là où l'on en était en ARRIVANT SUR LA PAGE.
  //      C'est le seul endroit traversé par tous les chemins d'ouverture :
  //      la question se pose ici, et nulle part ailleurs.
  useEffect(() => {
    let alive = true;
    apiFetch(`/collection/${media.slug}`, { token })
      .then((d) => {
        if (!alive || !d?.media) return;
        // Les planches ne sont reprises que si on ne les avait pas : les
        // remplacer par une liste identique relancerait tout le chargeur de
        // textures pour rien.
        if (!media.pages?.length) setPages(d.media.pages || []);
        setMark(d.media.progress?.page ?? null);
      })
      // Serveur muet : on n'attend pas indéfiniment une réponse qui ne viendra
      // pas — le volume s'ouvre sur ce qu'on sait, c'est-à-dire la carte.
      .catch(() => alive && setMark(null));
    return () => {
      alive = false;
    };
  }, [media.slug, media.pages, token]);

  // ---- la jaquette. Elle arrive peinte quand on vient de l'étagère (les deux
  //      scènes partagent la texture, three gardant son état GPU par renderer) ;
  //      ouvert depuis la fiche, on la peint ici.
  // Et si l'étagère envoie MIEUX en cours de route — elle repeint en grand le
  // volume qu'on tient pendant qu'il vole (voir HI_QUALITY côté rayon) —, la
  // couverture se met à jour ici. Sans ça, le volume gardait la définition du
  // rayon : suffisante sur une tranche de cent pixels, molle sur une couverture
  // qui tient l'écran.
  useEffect(() => {
    if (art) setPaint(art);
  }, [art]);

  useEffect(() => {
    if (art) return undefined;
    let alive = true;
    // Par le magasin, et non par un exemplaire à soi : si l'étagère a déjà peint
    // ce volume, il ne se repeint pas — et la texture, appartenant au magasin,
    // n'est pas non plus abandonnée ici au démontage (elle l'était).
    caseArt(media, HI_QUALITY)
      .then((got) => alive && setPaint(got))
      .catch(() => {
        /* volume sans couverture : le lecteur ouvre quand même */
      });
    return () => {
      alive = false;
    };
  }, [art, media]);

  // ---- ON OUVRE LÀ OÙ L'ON S'ÉTAIT ARRÊTÉ, et les trois sources sont classées
  //      de la plus sûre à la plus vieille :
  //
  //        1. la planche DEMANDÉE (`startPage`) — depuis la fiche, on peut poser
  //           le doigt au milieu du volume, et c'est là qu'il doit s'ouvrir ;
  //        2. la progression qui vient d'être relue avec les planches (`mark`) ;
  //        3. celle que portait la carte du rayon, qui peut dater de l'arrivée
  //           sur la page.
  //
  //      ET ON NE SE POSE QU'UNE FOIS. C'est pour ça qu'il faut ATTENDRE la
  //      réponse du serveur : quand les planches sont préchargées par la vitrine,
  //      elles sont là dès le premier rendu — le volume se posait donc sur la
  //      progression périmée, verrouillait `placed`, et la vraie réponse arrivait
  //      trois cents millisecondes trop tard pour servir à quelque chose. Une
  //      planche demandée à la main (`startPage`) n'attend rien, elle : elle est
  //      déjà la réponse.
  useEffect(() => {
    if (placed.current || !views.length) return;
    if (startPage == null && mark === undefined) return;
    placed.current = true;
    const at = startPage ?? mark ?? media.progress?.page ?? 0;
    const found = views.findIndex((v) => v.some((p) => p.index === at));
    if (found > 0) setIndex(found);
  }, [views, startPage, mark, media.progress]);

  // ---- la vie du lecteur. DÉCLARÉ AVANT LE CHARGEUR, et ce n'est pas un
  //      détail de rangement : `gone` doit être baissé avant que le chargeur
  //      ne puisse le lire, et les effets s'exécutent dans l'ordre où ils sont
  //      écrits. Au démontage, il se lève et les planches sont rendues.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      // Lues en ref : une liste capturée à la déclaration ne verrait que
      // l'objet vide du premier rendu.
      for (const t of Object.values(texRef.current)) t?.dispose?.();
    };
  }, []);

  // ---- les textures des planches, celles d'à côté comprises : tourner une
  //      page ne doit jamais donner un rectangle vide le temps du chargement.
  //
  //      L'ORDRE ET LE PARALLÉLISME FONT TOUT. Une file d'attente unique, prise
  //      dans l'ordre des index, faisait attendre la double page qu'on REGARDE
  //      derrière celle d'avant : au bout d'une page tournée, la planche posée
  //      montrait encore la précédente une bonne demi-seconde, le temps que la
  //      sienne descende (le matériau garde la dernière image reçue, voir
  //      `usePaper`). On sert donc la double page courante d'abord, ses deux
  //      planches EN MÊME TEMPS, puis la suivante — celle vers laquelle on va —,
  //      puis les autres.
  useEffect(() => {
    if (!views.length) return undefined;
    let alive = true;
    let timer = null;
    let missed = false;

    const fetchOne = async (p) => {
      if (texRef.current[p.index] !== undefined) return;
      texRef.current[p.index] = null; // réservé : jamais deux fois la même
      const img = await loadImage(p.src);
      // UNE RÉSERVATION NE SURVIT JAMAIS À LA PASSE QUI L'A POSÉE. `alive` ne
      // dit pas « ça n'a plus d'intérêt », il dit « une autre passe a pris la
      // suite » — et celle-là voit la réservation, donc elle ne redemandera
      // PAS la planche. Abandonner ici en la laissant réservée, c'est la
      // condamner : plus personne ne la charge, et le volume attend pour
      // toujours une image qui n'arrivera jamais.
      //
      // C'est exactement ce que faisait le double montage de StrictMode sur la
      // TOUTE PREMIÈRE planche : la passe 1 la réservait, la passe 2 la
      // sautait, la passe 1 rendait la main sans rien poser. D'où le
      // « On charge les planches… » éternel, sur la première double page et
      // sur elle seule.
      //
      // On pose donc la texture dans tous les cas — elle est valable pour
      // n'importe quelle passe.
      //
      // `gone`, lui, dit que le lecteur N'EXISTE PLUS — et il se rebaisse à
      // chaque montage (voir l'effet juste au-dessus). Levé une fois pour
      // toutes, il jetterait chaque planche à son arrivée : le volume
      // attendrait alors des images qu'il vient lui-même de mettre à la
      // poubelle, ce qui donne le même « On charge les planches… » éternel,
      // mais cette fois sur TOUTES les planches.
      if (gone.current) return; // le lecteur est fermé : plus rien à garder
      if (!img) {
        delete texRef.current[p.index]; // qu'un autre passage puisse réessayer
        missed = true;
        return;
      }
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      texRef.current[p.index] = t;
      setTex({ ...texRef.current });
    };

    (async () => {
      // La double page qu'on regarde, ses deux planches ensemble : c'est elle
      // qui décide si le volume s'ouvre, et rien ne doit passer devant.
      // Ensuite la suivante, la précédente, et une d'avance.
      for (const k of [index, index + 1, index - 1, index + 2]) {
        await Promise.all((views[k] || []).map(fetchOne));
        // Une autre passe a pris la suite (on a tourné, ou sauté ailleurs) :
        // ce qui est déjà descendu est gardé, le reste la regarde.
        if (!alive || gone.current) return;
      }
      // Une planche qui n'est pas descendue (coupure, fichier manquant) laisse
      // le volume fermé sur son message d'attente : rien, ensuite, ne
      // redemande l'image. On repasse donc — trois fois, à intervalle poli.
      // Au-delà, c'est que l'image n'est pas là, et une boucle de requêtes
      // n'y changerait rien.
      if (missed && tries < 3) timer = setTimeout(() => setTries((n) => n + 1), 1200);
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [views, index, tries]);

  // Le volume ne s'ouvre que quand il a de quoi montrer : une couverture qui se
  // lève sur deux rectangles blancs, c'est le contraire de l'effet cherché.
  const here = views[index];
  const ready = !!paint && !!here?.length && here.every((p) => !!tex[p.index]);
  ctl.current.ready = ready;

  // ---- progression : différée, comme dans le lecteur à plat. Tourner dix
  //      pages d'affilée ne doit pas déclencher dix requêtes.
  //      Ouvert depuis la fiche, c'est ELLE qui enregistre : elle tient l'état
  //      affiché (« lu jusqu'à la 12 »), et deux écritures concurrentes le
  //      laisseraient en retard d'une page.
  const save = useRef(null);
  const page = here?.[0]?.index ?? 0;
  // La planche courante, lisible depuis la fermeture — qui ne se refait pas à
  // chaque page tournée et ne verrait donc qu'une position périmée.
  const pageRef = useRef(page);
  pageRef.current = page;

  // L'écriture elle-même, hors du différé : la fermeture s'en sert pour poser la
  // position TOUT DE SUITE. Sans ça, refermer dans les huit dixièmes de seconde
  // qui suivent une page tournée annulait l'enregistrement en même temps que le
  // lecteur — et c'est exactement ce qu'on fait en refermant un livre : on tourne
  // une dernière page, on regarde, on ferme.
  const put = useCallback(
    (at) => {
      if (onProgress) return onProgress(at);
      return apiFetch(`/collection/${media.slug}/page`, {
        method: "POST",
        token,
        body: { page: at },
      }).catch(() => {
        /* la reprise n'est pas critique : on ne dérange pas le lecteur */
      });
    },
    [onProgress, media.slug, token]
  );

  useEffect(() => {
    if (!views.length) return undefined;
    clearTimeout(save.current);
    save.current = setTimeout(() => put(page), 800);
    return () => clearTimeout(save.current);
  }, [page, views.length, put]);

  // ---- tourner une page --------------------------------------------------
  // `a` désigne la FEUILLE, pas la double-page : celle qui sépare la double `a`
  // de la double `a + 1`. En avant comme en arrière c'est la même feuille, ce
  // qui évite d'écrire deux fois la même animation.
  // Renvoie si la page part VRAIMENT : au bout du volume, il n'y a rien à
  // tourner, et la lecture guidée doit le savoir pour ne pas se recadrer sur
  // une page suivante qui n'existe pas.
  const start = useCallback(
    (dir) => {
      const s = ctl.current;
      if (s.turn || s.open < 0.98 || s.leaving) return false;
      const a = dir > 0 ? index : index - 1;
      if (a < 0 || a + 1 >= views.length) return false;
      s.turn = { a, dir, t: dir > 0 ? 0 : 1, grab: false, done: false };
      setTurn({ a, dir });
      // LE FROISSEMENT PART AVEC LA FEUILLE, et seulement si elle part vraiment
      // (les deux sorties ci-dessus, bout du volume compris, sont muettes). Tout
      // passe par ici — clavier, chevrons, page tirée à la souris —, donc le son
      // n'a qu'un seul endroit où vivre.
      playPageTurnSound();
      noted("turned");
      return true;
    },
    [index, views.length, noted]
  );

  // La feuille s'est posée. C'est le SEUL endroit où l'on change de double
  // page — une fois par page tournée, pas soixante fois par seconde.
  //
  // La feuille elle-même n'est PAS retirée ici : la scène la garde posée à plat
  // jusqu'à ce que ce rendu-ci soit à l'écran (voir la boucle d'image).
  const land = useCallback((next, way) => {
    setTurn(null);
    setIndex(next);
    // La lecture guidée repart en tête de la double page découverte — et, si
    // l'on est revenu en arrière, sur SA SECONDE page : c'est celle qu'on
    // lisait juste avant, pas celle d'il y a deux pages.
    const g = ctl.current.guide;
    if (g) {
      ctl.current.glide = false;
      ctl.current.vy = 0;
      g.step = way > 0 ? 0 : 1;
      // En avant on arrive en tête de page, en arrière par le bas : dans les
      // deux cas, là où la lecture reprend.
      g.at = way > 0 ? 0 : 1;
    }
  }, []);

  const advance = useCallback(() => start(1), [start]);
  const back = useCallback(() => start(-1), [start]);

  // La double page courante montre-t-elle DEUX pages ? Deux planches côte à
  // côte, oui ; une planche double étalée sur les deux plats, oui aussi (c'est
  // le même geste de lecture) ; une planche seule en fin de volume, non.
  const twoUp = !!here && (here.length > 1 || wide(here[0]));

  // ---- la lecture guidée ---------------------------------------------------
  // Trois gestes, et ils suffisent à lire un volume entier :
  //
  //   • CHANGER DE PAGE (`guidePage`) — la page d'à côté, ou la suivante quand
  //     il n'y a plus de côté ;
  //   • AVANCER (`guideAdvance`) — une hauteur d'écran vers le bas et, une fois
  //     la page épuisée, la page d'à côté. C'est la flèche gauche/droite, et
  //     elle seule suffit à lire un volume du début à la fin ;
  //   • DÉFILER (`guideScroll`) — par petits pas, sans jamais changer de page.
  //     C'est la flèche du haut ou du bas, et elle ne fait QUE ça : rattraper
  //     une bulle coupée, revenir de trois lignes.
  const guidePage = useCallback(
    (dir) => {
      const s = ctl.current;
      const g = s.guide;
      if (!g) return;
      // Changer de page, c'est ALLER quelque part : on quitte le suivi pour un
      // vrai trajet, et le défilement en cours s'arrête avec.
      s.glide = false;
      s.vy = 0;
      if (dir > 0) {
        // La seconde page n'existe pas toujours : la dernière planche d'un
        // volume impair est seule sur sa double. Sans ce test, « suite »
        // cadrerait un vide, puis renverrait à la première page — et on
        // n'arriverait jamais à tourner.
        if (g.step === 0 && twoUp) {
          g.step = 1;
          g.at = 0;
          return;
        }
        // Plus rien à côté : on tourne. La caméra part vers la tête de la page
        // suivante PENDANT que la feuille vole — les deux gestes n'en font
        // qu'un, et `land` confirmera la même station. Au bout du volume, rien
        // ne part : on reste où l'on est plutôt que de remonter au début.
        if (advance()) {
          g.step = 0;
          g.at = 0;
        }
        return;
      }
      // En arrière, on arrive PAR LE BAS de la page précédente : c'est ce qu'on
      // venait d'y lire, pas son titre de chapitre.
      if (g.step === 1) {
        g.step = 0;
        g.at = 1;
        return;
      }
      if (back()) {
        g.step = 1;
        g.at = 1;
      }
    },
    [advance, back, twoUp]
  );

  const guideAdvance = useCallback(
    (dir) => {
      const s = ctl.current;
      const g = s.guide;
      if (!g) return;
      // Le geste compte même au bout du volume, où il ne reste rien à
      // parcourir : c'est le GESTE qu'on apprend, pas son résultat. Et seule
      // l'avance compte — revenir en arrière n'enseigne pas à lire.
      if (dir > 0) counted("advanced");
      // Reste-t-il de la page dans cette direction ? On la descend (ou on la
      // remonte) d'une hauteur d'écran avant de songer à changer de page. Une
      // page qui tient tout entière dans le cadre n'a rien à parcourir : on
      // change de page tout de suite, sans dépenser un appui pour rien.
      if (s.scroll && (dir > 0 ? g.at < 1 - 1e-3 : g.at > 1e-3)) {
        // Une bande entière, c'est une STATION : on y va d'un trajet tenu, pas
        // en collant au geste — il n'y a pas de geste, il y a un appui.
        s.glide = false;
        s.vy = 0;
        g.at = Math.min(1, Math.max(0, g.at + dir * (s.band || 1)));
        return;
      }
      guidePage(dir);
    },
    [guidePage, counted]
  );

  // ---- défiler : le petit pas, et le maintien -------------------------------
  // Une pression déplace d'un cinquième d'écran ; l'appui gardé passe en
  // VITESSE (voir la boucle) et déroule la planche tant qu'on ne lâche pas.
  // Les deux passent par le suivi : ici la caméra n'a pas de destination, elle
  // colle à ce qu'on lui demande.
  const guideScroll = useCallback((dir) => {
    const s = ctl.current;
    if (!s.guide || !s.scroll) return;
    s.glide = true;
    s.guide.at = Math.min(
      1,
      Math.max(0, s.guide.at + dir * (s.band || 1) * GUIDE_NUDGE)
    );
  }, []);

  const guideRoll = useCallback((dir) => {
    const s = ctl.current;
    if (!s.guide || !s.scroll) return;
    s.glide = true;
    s.vy = dir;
  }, []);

  const guideStop = useCallback(() => {
    ctl.current.vy = 0;
  }, []);

  // Les chevrons de l'écran se tiennent comme la flèche du clavier : un appui
  // fait un pas, l'appui GARDÉ déroule. Le pointeur est capturé — on peut donc
  // sortir du bouton en tenant sans que le défilement s'arrête net.
  const holdT = useRef(null);
  useEffect(() => () => clearTimeout(holdT.current), []);

  const holdOn = useCallback(
    (dir) => (e) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      noted("scrolled");
      guideScroll(dir);
      clearTimeout(holdT.current);
      holdT.current = setTimeout(() => guideRoll(dir), HOLD_MS);
    },
    [guideScroll, guideRoll, noted]
  );

  const holdOff = useCallback(() => {
    clearTimeout(holdT.current);
    guideStop();
  }, [guideStop]);

  // Entrer, c'est cadrer la première page ; sortir, c'est reposer le volume à
  // plat comme on l'avait trouvé.
  const toggleGuide = useCallback(() => {
    const s = ctl.current;
    s.fill = false; // on ne guide pas une vue d'ensemble
    s.gTo = null; // le trajet en cours meurt avec le mode
    s.glide = false;
    s.vy = 0;
    setFilled(false);
    if (s.guide) {
      s.guide = null;
      s.zoom = 1;
      s.panX = 0;
      s.panY = 0;
      setGuided(false);
      setZoomed(false);
    } else {
      s.guide = { step: 0, at: 0 };
      s.guideZoom = 1; // on entre toujours au cadrage du mode, pas au dernier
      setGuided(true);
      setZoomed(true); // le cartouche s'écarte, comme quand on zoome à la main
    }
  }, []);

  // LA VUE D'ENSEMBLE — la barre d'espace. Devant une double page, le geste
  // n'est pas de descendre d'un cran : c'est de RECULER pour la voir en entier.
  // Elle prend alors toute la hauteur du cadre, un cheveu de plus même, et un
  // second appui rend la lecture exactement là où on l'avait laissée (la
  // station guidée n'a pas bougé, elle attendait).
  const toggleFill = useCallback(() => {
    const s = ctl.current;
    s.gTo = null;
    // Reculer d'un coup, c'est un trajet : on coupe le suivi et le défilement.
    s.glide = false;
    s.vy = 0;
    if (s.fill) {
      s.fill = false;
      setFilled(false);
      // Hors lecture guidée, rien ne reprend le cadrage derrière : on repose
      // donc le volume au milieu, comme le fait un double-clic.
      if (!s.guide) {
        s.zoom = 1;
        s.panX = 0;
        s.panY = 0;
        setZoomed(false);
      }
      return;
    }
    s.fill = true;
    setFilled(true);
    setZoomed(true);
  }, []);

  // L'AVANCE RAPIDE. Flèche maintenue : le volume DÉFILE. Aucune feuille ne vole
  // (au rythme du clavier, une page mettrait TURN_TIME à se poser et on
  // n'irait nulle part) et les stations de la lecture guidée sont sautées — on
  // cherche une planche, on ne la lit plus.
  const rushAt = useRef(0);
  // Où l'on en est, lisible SANS refaire la fonction à chaque double page. Le
  // défilé rapide n'a pas d'animation qui dise qu'on avance : son seul retour
  // est le feuilletage, et il doit donc se taire là où plus rien ne bouge —
  // au bout du volume, où l'index bute. Une fermeture sur `index` ne le saurait
  // pas (elle verrait celui d'il y a dix pages), d'où la ref.
  const indexRef = useRef(index);
  indexRef.current = index;
  const rush = useCallback(
    (dir) => {
      const s = ctl.current;
      if (s.leaving || s.open < 0.98) return;
      const now = performance.now();
      if (now - rushAt.current < RUSH_MS) return;
      rushAt.current = now;
      const next = Math.max(0, Math.min(views.length - 1, indexRef.current + dir));
      if (next === indexRef.current) return; // le volume est fini : rien ne défile
      indexRef.current = next;
      s.turn = null;
      setTurn(null);
      setIndex(next);
      // Feuilleté au pouce, pas tourné : le froissement court et discret.
      playPageTurnSound({ soft: true });
      noted("turned");
      // On repart en tête de double page : pendant qu'on défile, ce qu'on
      // regarde est le haut des planches, pas la bande où l'on lisait.
      if (s.guide) {
        s.glide = false;
        s.vy = 0;
        s.guide.step = 0;
        s.guide.at = 0;
      }
    },
    [views.length, noted]
  );

  // Hors lecture guidée, les flèches du haut et du bas font ce qu'elles disent :
  // elles font DÉFILER ce que le zoom fait dépasser du cadre. Rien à parcourir
  // quand le volume tient tout entier à l'écran — la touche ne fait alors rien,
  // ce qui est la vérité.
  const panBy = useCallback(
    (dir) => {
      const s = ctl.current;
      const over = Math.max(0, s.zoomAt - 1);
      if (over < 0.02) return;
      const ly = over * box.h * 0.9;
      s.panY = Math.max(-ly, Math.min(ly, s.panY + dir * s.view * 0.3));
    },
    [box.h]
  );

  // ---- fermeture : le volume se referme et rentre au rayon. L'écran ne
  //      s'efface qu'une fois qu'il y est presque — celui de l'étagère reprend
  //      alors la main dans la même pose, et le relais ne se voit pas.
  const close = useCallback(() => {
    const s = ctl.current;
    if (s.leaving) return;
    s.leaving = true;
    s.turn = null;
    setTurn(null);
    setLeaving(true);
    // ON POSE LE MARQUE-PAGE AVANT DE RANGER LE VOLUME, sans attendre le différé
    // — qui serait annulé avec le lecteur. La planche où l'on referme est
    // justement celle qu'on veut retrouver.
    clearTimeout(save.current);
    put(pageRef.current);
    // ON REPOSE LE VOLUME AVANT DE LE RANGER. Une lecture guidée laissée en
    // place tient le cadrage sur une demi-page : le volume s'en irait de
    // travers, et à moitié hors de l'écran. Le temps qu'il se referme (SHUT),
    // le zoom et le déplacement reviennent à zéro — puis il s'en va.
    s.guide = null;
    s.fill = false;
    s.gTo = null;
    s.zoom = 1;
    s.panX = 0;
    s.panY = 0;
    setGuided(false);
    setFilled(false);
    setZoomed(false);
    // Le temps du retour, mesuré sur ce qu'il reste À FAIRE : refermé pendant
    // le vol d'arrivée, le volume n'a pas de couverture à rabattre, et l'écran
    // n'a aucune raison d'attendre une animation qui n'aura pas lieu.
    const trip = Math.round((s.open * SHUT_TIME + FLY_BACK) * 1000);
    setTimeout(() => onSettle?.(), Math.max(0, trip - 80));
    setTimeout(() => onClose(), trip);
  }, [onClose, onSettle, put]);

  useBackClose(close, "book3d");

  useEffect(() => {
    const onKey = (e) => {
      const s = ctl.current;
      if (e.key === "Escape") {
        if (!allow("escape")) return undefined;
        // ÉCHAP SORT, IL NE RECULE PAS D'UN CRAN. Il défaisait la vue
        // d'ensemble d'abord, la lecture guidée ensuite : depuis la double page
        // en grand, la première frappe RAPPROCHAIT donc la caméra sur une demi-
        // planche avant que la seconde ne repose enfin le volume. On demandait à
        // sortir et ça zoomait — le contraire du geste.
        //
        // Et ce cran-là faisait doublon : la barre d'espace mène déjà tout le
        // va-et-vient de la lecture (s'approcher, reculer, revenir). Échap n'a
        // donc qu'un seul rôle, et deux frappes suffisent à tout : la première
        // repose le volume à plat, la seconde le referme.
        if (s.guide) return toggleGuide(); // éteint la vue d'ensemble avec
        if (s.fill) return toggleFill();
        return close();
      }
      // LA RÈGLE GARDE SES PROPRES FLÈCHES. Tenue au clavier, elle avance déjà
      // d'une double page à chaque appui : la lecture ne doit pas en ajouter
      // une seconde par-dessus, ou l'on saute deux fois d'un seul geste.
      if (e.target?.tagName === "INPUT") return undefined;

      // La vue d'ensemble met la lecture guidée en attente : le temps qu'on
      // regarde la planche, les flèches redeviennent celles du volume entier.
      const guiding = !!s.guide && !s.fill;

      // LES FLÈCHES GAUCHE ET DROITE MÈNENT LA LECTURE. Elles suivent l'ÉCRAN,
      // donc s'inversent en lecture japonaise, comme dans tout lecteur de
      // manga. En lecture guidée elles descendent d'abord d'une hauteur
      // d'écran, et ne changent de page qu'une fois la page épuisée : c'est le
      // seul geste dont on ait besoin pour lire un volume entier.
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        if (!allow(guiding ? "advance" : "turn")) return undefined;
        const fwd = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
        // MAINTENUE, ELLE FAIT DÉFILER. Le clavier répète : dès la deuxième
        // frappe on ne lit plus, on cherche — les doubles pages passent d'un
        // coup, sans station ni feuille en vol.
        if (e.repeat) return rush(fwd ? 1 : -1);
        return guiding ? guideAdvance(fwd ? 1 : -1) : fwd ? advance() : back();
      }

      // CELLES DU HAUT ET DU BAS NE FONT QUE DÉFILER — dans la page guidée,
      // dans ce que le zoom fait dépasser du cadre sinon. Elles ne changent
      // jamais de page : c'est le travail des deux autres.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); // sinon la page derrière le lecteur défile
        if (!allow("scroll")) return undefined;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        // Le geste compte même s'il ne déplace rien : une planche qui tient
        // tout entière dans le cadre n'a pas de course, et le tutoriel
        // attendrait alors éternellement un défilement impossible.
        noted("scrolled");
        if (!guiding) return panBy(dir);
        // MAINTENUE, ELLE DÉROULE. La répétition du clavier ne sert qu'à dire
        // « c'est toujours enfoncé » : c'est la boucle qui déroule, à vitesse
        // constante, jusqu'à ce qu'on lâche.
        return e.repeat ? guideRoll(dir) : guideScroll(dir);
      }

      // LA BARRE D'ESPACE MÈNE LA LECTURE, EN DEUX TEMPS — et c'est le seul
      // geste à connaître pour lire un volume ouvert.
      //
      //   1er appui : ON SE PENCHE. Un volume qu'on vient d'ouvrir demande
      //      qu'on s'approche, pas qu'on recule : la lecture guidée s'allume
      //      d'elle-même, cadrée sur la première page.
      //   ensuite : ON RECULE. La double page en entier, à pleine hauteur, le
      //      temps de la regarder — et l'appui suivant rend la lecture
      //      exactement là où on l'avait laissée.
      //
      // Échap défait dans l'autre sens (la vue d'ensemble, puis le mode, puis
      // le volume), donc rien ne s'enferme.
      //
      // ENTRÉE FAIT PAREIL. C'est elle qui a ouvert le volume depuis la vitrine
      // (avec l'espace, déjà) : la main est encore dessus, et lui demander de
      // changer de touche une fois le livre ouvert n'a aucune raison d'être.
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!allow(s.guide ? "fill" : "guide")) return undefined;
        return s.guide ? toggleFill() : toggleGuide();
      }
      return undefined;
    };
    // ON LÂCHE, ÇA S'ARRÊTE. Et le retour au bureau compte comme un
    // relâchement : une fenêtre qui perd le focus ne reçoit plus le `keyup`,
    // et la planche défilerait toute seule jusqu'au bas de la page.
    const onUp = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") guideStop();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", guideStop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", guideStop);
    };
  }, [
    advance,
    allow,
    back,
    close,
    rtl,
    guideAdvance,
    guideRoll,
    guideScroll,
    guideStop,
    noted,
    panBy,
    rush,
    toggleFill,
    toggleGuide,
  ]);

  // ---- le geste, et il est le même que dans la vitrine : le BOUTON GAUCHE
  //      attrape l'objet (ici : la page, qu'on tire pour la tourner), le BOUTON
  //      DROIT le déplace dans le cadre, la molette approche. Un seul
  //      vocabulaire pour les deux scènes.
  //
  //      Tirer la page commande sa POSITION, pas une animation : lâchée avant la
  //      moitié, elle repart d'où elle vient — on ne tourne pas une page à
  //      moitié.
  const drag = useRef({ on: false, pan: false, x0: 0, x: 0, y: 0, moved: false });

  // La page qu'on tire, et son relâchement : les mêmes deux gestes à la souris
  // et au doigt, écrits une fois. Seule la manière de les DÉCLENCHER diffère.
  function pullPage(gx) {
    const s = ctl.current;
    if (!allow("turn")) return;
    // Tirer vers la droite de l'écran, c'est reculer en lecture occidentale.
    if (!s.turn) start(gx > 0 ? (rtl ? 1 : -1) : rtl ? -1 : 1);
    if (!s.turn) return;
    s.turn.grab = true;
    const span = Math.max(140, window.innerWidth * 0.35);
    const gone = Math.min(1, Math.abs(gx) / span);
    s.turn.t = s.turn.dir > 0 ? gone : 1 - gone;
  }

  // `force` : le balayage, qui fait partir la page quelle que soit la distance
  // parcourue (voir SWIPE_MIN).
  function release(force = false) {
    const s = ctl.current;
    if (!s.turn?.grab) return;
    s.turn.grab = false;
    s.turn.done = false;
    const passed = force || (s.turn.dir > 0 ? s.turn.t > 0.4 : s.turn.t < 0.6);
    if (!passed) s.turn.dir = -s.turn.dir;
  }

  // ---- LE GESTE AU DOIGT, et il n'a rien à voir avec celui de la souris : pas
  //      de bouton droit, pas de molette, pas de survol. Quatre gestes, qui se
  //      décident tout seuls au premier millimètre parcouru.
  //
  //        • TAP — la case suivante, OÙ QU'IL TOMBE. C'est le geste de tous les
  //          lecteurs de comics, et en lecture guidée il fait exactement ce que
  //          fait la flèche : une bande vers le bas, puis la page d'à côté, puis
  //          la page suivante. Pas de moitié gauche qui recule : on tient le
  //          téléphone d'une main et on tape là où le pouce arrive, pas là où
  //          l'écran voudrait.
  //        • GLISSER À L'HORIZONTALE — la page se tourne et SUIT le doigt.
  //        • GLISSER À LA VERTICALE — on descend dans la planche, le contenu
  //          suit le doigt comme partout ailleurs.
  //        • PINCER — on approche.
  //
  //      L'AXE SE CHOISIT UNE FOIS, au franchissement du seuil, et ne change
  //      plus. Sans ça, une main qui dérive en descendant fait partir une page à
  //      mi-parcours, et on se retrouve deux planches plus loin sans savoir
  //      pourquoi.
  const touch = useRef({ pts: new Map(), mode: null, x0: 0, y0: 0, at: 0, gap: 0, zoom: 1 });
  const byFinger = useRef(false); // le dernier geste venait-il d'un doigt ?

  const spread = (pts) => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function touchDown(e) {
    // Les commandes POSÉES SUR la scène (les chevrons de défilement) gardent
    // leurs propres gestes : l'événement remonte jusqu'ici, il ne faut pas le
    // compter une seconde fois.
    if (e.target?.closest?.("button, a, input")) return;
    const t = touch.current;
    const s = ctl.current;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    t.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (t.pts.size === 2) {
      // Deux doigts : on pince. La page en vol est lâchée — on ne tourne pas
      // une page en zoomant, et la garder en main ferait les deux à la fois.
      release();
      t.mode = "pinch";
      t.gap = spread(t.pts);
      t.zoom = s.guide ? s.guideZoom : s.zoom;
      return;
    }
    if (t.pts.size > 2) return;
    t.mode = "tap";
    t.x0 = e.clientX;
    t.y0 = e.clientY;
    t.at = performance.now();
  }

  function touchMove(e) {
    const t = touch.current;
    const p = t.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const s = ctl.current;

    if (t.mode === "pinch") {
      if (t.pts.size < 2 || !t.gap || !allow("zoom")) return;
      const k = spread(t.pts) / t.gap;
      // Le pincer est un RAPPORT, pas une distance : il se compose donc avec
      // le zoom qu'on avait en posant les doigts, et rapprocher puis écarter
      // revient exactement au point de départ.
      if (s.guide) {
        s.glide = true;
        s.guideZoom = Math.max(0.6, Math.min(2.4, t.zoom * k));
      } else {
        s.zoom = Math.max(1, Math.min(4, t.zoom * k));
        if (s.zoom <= 1.02) {
          s.panX = 0;
          s.panY = 0;
        }
        setZoomed(s.zoom > 1.08);
      }
      return;
    }

    const gx = e.clientX - t.x0;
    if (t.mode === "tap") {
      const gy = e.clientY - t.y0;
      if (Math.hypot(gx, gy) < TAP_SLOP) return;
      t.mode = Math.abs(gx) > Math.abs(gy) ? "turn" : "scroll";
    }

    if (t.mode === "turn") return pullPage(gx);

    // ---- ON DESCEND DANS LA PLANCHE. En lecture guidée c'est la STATION qu'on
    //      déplace et non la caméra : le mode repose le cadrage à chaque image,
    //      un déplacement posé à côté serait effacé aussitôt.
    if (!allow("scroll")) return undefined;
    if (s.guide && !s.fill) {
      if (!s.scroll) return undefined;
      s.glide = true;
      s.vy = 0;
      s.guide.at = Math.min(1, Math.max(0, s.guide.at - dy * s.atPerPx));
      noted("scrolled");
      return undefined;
    }
    // Hors lecture guidée, il n'y a de course que si le zoom fait dépasser la
    // planche du cadre — sinon le volume tient à l'écran et il n'y a rien à
    // faire défiler.
    const over = Math.max(0, s.zoomAt - 1);
    if (over < 0.02) return undefined;
    const lx = over * box.d * 1.3;
    const ly = over * box.h * 0.9;
    s.panX = Math.max(-lx, Math.min(lx, s.panX + dx * s.perPx));
    s.panY = Math.max(-ly, Math.min(ly, s.panY - dy * s.perPx));
    return undefined;
  }

  function touchUp(e) {
    const t = touch.current;
    // Un doigt qu'on ne suivait pas (l'événement de sortie qui suit un
    // relâchement, par exemple) ne doit rien déclencher du tout.
    if (!t.pts.delete(e.pointerId)) return;
    const s = ctl.current;

    if (t.mode === "pinch") {
      // Le geste se termine quand les DEUX doigts sont levés : sinon celui qui
      // reste repartirait en glissement au milieu d'un pincer.
      if (!t.pts.size) t.mode = null;
      return;
    }

    if (t.mode === "turn") {
      const gx = e.clientX - t.x0;
      const flick = Math.abs(gx) > SWIPE_MIN && performance.now() - t.at < FLICK_MS;
      release(flick);
      t.mode = null;
      return;
    }

    if (t.mode === "tap") {
      // La vue d'ensemble se referme d'un tap : on est venu la regarder, pas
      // s'y installer.
      if (s.fill) {
        if (allow("fill")) toggleFill();
      } else if (s.guide) {
        if (allow("advance")) guideAdvance(1);
      } else if (allow("turn")) advance();
    }
    t.mode = null;
  }

  function down(e) {
    byFinger.current = e.pointerType === "touch";
    if (byFinger.current) return touchDown(e);
    drag.current = {
      on: true,
      pan: e.button === 2,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    return undefined;
  }
  function move(e) {
    if (e.pointerType === "touch") return touchMove(e);
    const d = drag.current;
    if (!d.on) return undefined;
    const gx = e.clientX - d.x0;
    if (!d.moved && Math.hypot(gx, e.clientY - d.y0) < 6) return undefined;
    d.moved = true;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const s = ctl.current;

    if (d.pan) {
      // En lecture guidée comme en vue d'ensemble, le cadrage appartient au
      // mode : un déplacement à la main serait effacé à l'image suivante,
      // autant ne pas le prendre.
      if (s.guide || s.fill || !allow("scroll")) return undefined;
      // Bridé sur ce que le zoom fait dépasser du cadre : on atteint n'importe
      // quel coin d'une planche, jamais le vide.
      const over = Math.max(0, s.zoomAt - 1);
      const lx = over * box.d * 1.3;
      const ly = over * box.h * 0.9;
      s.panX = Math.max(-lx, Math.min(lx, s.panX + dx * s.perPx));
      s.panY = Math.max(-ly, Math.min(ly, s.panY - dy * s.perPx));
      return undefined;
    }

    pullPage(gx);
    return undefined;
  }
  function up(e) {
    if (e?.pointerType === "touch") return touchUp(e);
    drag.current.on = false;
    release();
    return undefined;
  }
  function wheel(e) {
    const s = ctl.current;
    if (!allow("zoom")) return;
    // LA MOLETTE SUIT LE GESTE, PAS LE CRAN. Un facteur fixe par événement,
    // c'était un escalier : trois crans et la planche sautait au nez, tandis
    // qu'un pavé tactile — qui envoie des dizaines de miettes de pixels —
    // zoomait comme un fou. On lit donc la DISTANCE parcourue et on l'applique
    // en exposant : petit mouvement, petit pas ; grand coup, grand pas ; et la
    // composition reste juste quel que soit le découpage des événements.
    // (`deltaMode` : certains navigateurs comptent en lignes ou en pages.)
    const px =
      e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const mag = Math.min(2.5, Math.abs(px) / 100); // 1 = un cran de molette
    const way = px < 0 ? 1 : -1;

    // La vue d'ensemble rend la main dès qu'on touche à la molette : on repart
    // de la taille qu'on a sous les yeux, sans le saut d'un zoom qu'on avait
    // quitté trois gestes plus tôt.
    if (s.fill) {
      s.fill = false;
      s.gTo = null;
      s.zoom = s.zoomAt;
      setFilled(false);
    }

    // EN LECTURE GUIDÉE, LA MOLETTE CORRIGE LE CADRAGE — elle ne le remplace
    // pas. Elle agit sur un facteur que le mode applique par-dessus le sien :
    // on peut donc approcher une case ou reculer d'un pas sans quitter les
    // stations, et la course dans la page s'ajuste toute seule. Bornée serré :
    // au-delà, on ne corrige plus, on part ailleurs — c'est le rôle du bouton.
    if (s.guide) {
      // Et c'est un SUIVI, pas un trajet : la molette est un geste continu, la
      // caméra doit coller au doigt. En trajet, chaque cran annulait le
      // précédent et le zoom avançait par à-coups sans jamais arriver.
      s.glide = true;
      s.guideZoom = Math.max(
        0.6,
        Math.min(2.4, s.guideZoom * Math.exp(way * mag * GUIDE_ZOOM_RATE))
      );
      return;
    }
    s.zoom = Math.max(1, Math.min(4, s.zoom * Math.exp(way * mag * ZOOM_RATE)));
    // Revenu au cadre, le volume se recentre : on ne laisse pas un volume
    // dézoomé de travers dans un coin.
    if (s.zoom <= 1.02) {
      s.panX = 0;
      s.panY = 0;
    }
    // Zoomer, c'est venir lire : le cartouche s'écarte pour laisser tout
    // l'écran à la planche, comme dans la vitrine.
    setZoomed(s.zoom > 1.08);
  }
  function reset() {
    // AU DOIGT, LE DOUBLE-TAP N'EST PAS UN DOUBLE-CLIC : c'est deux taps, donc
    // deux cases d'avance, et le navigateur émet quand même un `dblclick`
    // par-dessus. Le laisser remettre le volume à plat effacerait le pincer
    // qu'on venait de faire — le zoom se règle aux doigts, il se défait aux
    // doigts.
    if (byFinger.current) return;
    const s = ctl.current;
    if (s.fill) {
      s.fill = false;
      s.gTo = null;
      setFilled(false);
    }
    // En lecture guidée, « remettre à plat » veut dire revenir au cadrage que
    // le mode avait choisi — pas déposer le volume au milieu de l'écran.
    if (s.guide) {
      s.guideZoom = 1;
      return;
    }
    s.zoom = 1;
    s.panX = 0;
    s.panY = 0;
    setZoomed(false);
  }

  // Un glissement se termine par un « click » que le navigateur envoie quand
  // même : sans ce garde-fou, promener le volume jusqu'au bord de l'écran
  // tournerait la page en le lâchant.
  const tap = (fn) => () => {
    if (!drag.current.moved) fn();
  };

  // ---------------------------------------------------------- l'écran ----
  const total = pages.length;
  const shown = here
    ? here.length > 1
      ? `${here[0].index + 1}–${here[1].index + 1}`
      : `${here[0].index + 1}`
    : "—";
  const pct = total > 1 ? ((page + 1) / total) * 100 : 0;
  const atFirst = index <= 0;
  const atLast = index >= views.length - 1;

  // ON NE CHANGE PAS DE LIEU. Le volume vient d'être pris en main dans la
  // vitrine : il s'y ouvre. Même voile, même croix, même cartouche posé en bas —
  // c'est littéralement la coquille de la vitrine (`coll-inspect`), à quoi le
  // lecteur n'ajoute que ce qui lui est propre. Un décor de salle de lecture,
  // aussi joli soit-il, faisait sauter d'une scène à une autre au pire moment.
  return createPortal(
    <div
      className={`coll-inspect b3d ${veiled ? "veiled" : ""} ${
        pose ? "warm" : ""
      } ${leaving ? "leaving" : ""} ${zoomed ? "zoomed" : ""} ${
        idle ? "unseen" : ""
      } ${gate ? "tuto" : ""}`}
      role="dialog"
      aria-label={`Lecture — ${media.title}`}
      style={{ "--tint": media.color || "var(--orange)" }}
    >
      <button
        className="coll-inspect-close clickable"
        onClick={close}
        aria-label="Refermer le volume"
      >
        <X size={18} />
      </button>

      <div
        className="coll-inspect-stage b3d-stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        // Un appel qui arrive, une notification qui passe : le système reprend
        // le doigt sans prévenir. Sans ça, le geste resterait « en cours » pour
        // toujours et la page ne se poserait jamais.
        onPointerCancel={up}
        onWheel={wheel}
        onDoubleClick={reset}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Canvas
          dpr={[1, 1.75]}
          // `flat` : pas de courbe cinéma sur des planches. C'est une image déjà
          // étalonnée, elle doit sortir comme elle a été scannée.
          flat
          gl={{ alpha: true, antialias: true }}
          camera={{ fov: FOV, position: [0, 0, 3] }}
        >
          <Lights />
          {paint && (
            <Volume
              box={box}
              cuts={paint.cuts}
              wrap={paint.sheet}
              views={views}
              wide={wide}
              ratio={ratio}
              index={index}
              turn={turn}
              tex={tex}
              ctl={ctl}
              rtl={rtl}
              from={from}
              pose={pose}
              onTurnEnd={land}
              onLanded={() => {
                setVeiled(true);
                onLanded?.();
              }}
            />
          )}
        </Canvas>

        {/* Les deux moitiés de l'écran tournent les pages : c'est le geste du
            lecteur de comics, et il marche au doigt comme à la souris. Les
            chevrons ne sont là que pour montrer où appuyer.

            Elles font EXACTEMENT ce que font les flèches gauche et droite,
            leurs jumelles : en lecture guidée, une hauteur d'écran vers le bas,
            puis la page d'à côté, puis la suivante. Rien à réapprendre en
            changeant de mode, et plus de fin de course à désactiver — le mode
            s'arrête tout seul au bout du volume. */}
        <button
          className="b3d-half left clickable"
          onClick={tap(
            guided && !filled ? () => guideAdvance(rtl ? 1 : -1) : rtl ? advance : back
          )}
          disabled={guided && !filled ? false : rtl ? atLast : atFirst}
          aria-label={rtl ? "Suite" : "Précédent"}
        >
          <ChevronLeft size={30} />
        </button>
        <button
          className="b3d-half right clickable"
          onClick={tap(
            guided && !filled ? () => guideAdvance(rtl ? -1 : 1) : rtl ? back : advance
          )}
          disabled={guided && !filled ? false : rtl ? atFirst : atLast}
          aria-label={rtl ? "Précédent" : "Suite"}
        >
          <ChevronRight size={30} />
        </button>

        {/* LES DEUX SEULES COMMANDES PROPRES AU MODE : défiler, dans un sens ou
            dans l'autre. Posées à droite, à hauteur d'œil, là où le pouce et le
            curseur tombent — et assez discrètes pour ne pas manger la planche.
            Tout le reste (page suivante, page précédente) se fait déjà avec les
            gestes du lecteur normal. Effacées le temps d'une vue d'ensemble :
            il n'y a plus rien à faire défiler. */}
        {guided && !filled && (
          <div className="b3d-guide" aria-label="Lecture guidée">
            <button
              className="clickable"
              onPointerDown={holdOn(-1)}
              onPointerUp={holdOff}
              onPointerCancel={holdOff}
              aria-label="Défiler vers le haut"
              title="Défiler vers le haut (↑ — maintenir pour dérouler)"
            >
              <ChevronUp size={18} />
            </button>
            <button
              className="clickable"
              onPointerDown={holdOn(1)}
              onPointerUp={holdOff}
              onPointerCancel={holdOff}
              aria-label="Défiler vers le bas"
              title="Défiler vers le bas (↓ — maintenir pour dérouler)"
            >
              <ChevronDown size={18} />
            </button>
          </div>
        )}

        {!ready && (
          <div className="b3d-wait">
            <Loader2 size={20} className="coll-spin" />
            <span>{total ? "On charge les planches…" : "On sort le volume…"}</span>
          </div>
        )}

        {/* LA PREMIÈRE FOIS, ET UNE SEULE. Il n'arrive qu'une fois les planches
            là (`ready`) : un tutoriel qui demande de tourner une page pendant
            que le volume est encore fermé demande l'impossible. `freed` — la
            dernière étape — se lit sur l'état : plus de vue d'ensemble, plus de
            lecture guidée, c'est qu'Échap a fait son travail. */}
        {tuto && desktop && ready && (
          <BookTutorial
            state={{ ...did, guided, filled, freed: !guided && !filled }}
            onGate={setGate}
            onDone={() => setTuto(false)}
          />
        )}
      </div>

      {/* ---------------- le cartouche ----------------
          IL DIT OÙ L'ON EN EST, ET RIEN D'AUTRE. Où l'on en est, deux boutons,
          et la règle : pas de mode d'emploi, et PAS DE TITRE non plus.

          Le titre était la seule chose qui donnait de la hauteur à cette barre —
          une ligne de typo d'affichage, plus la saga au-dessus — et il ne
          servait à rien : on vient de prendre ce volume en main, sa couverture
          est encore sous les yeux, et il occupe tout l'écran. Nommer l'objet
          qu'on tient, c'est le nommer deux fois. (Il reste dans l'étiquette du
          dialogue, pour qui l'écoute plutôt qu'il ne le voit.)

          DEUX ÉTAGES, ET LA RÈGLE EN BAS SUR TOUTE LA LARGEUR. Coincée entre
          deux blocs de texte, elle n'avait ni la place d'être précise ni celle
          d'être discrète : elle court donc sur sa propre ligne, filet posé sous
          le cartouche, qui ne s'épaissit et ne sort sa pastille que si l'on va
          vers lui. */}
      <footer className="coll-inspect-info">
        <div className="coll-inspect-card b3d-card">
          <div className="b3d-card-top">
            <span className="coll-inspect-meta">
              Planche{shown.includes("–") ? "s" : ""} {shown}
              <i> / {total || "…"}</i>
              {rtl ? " · lecture japonaise" : ""}
            </span>

            <div className="coll-inspect-acts b3d-acts">
              <button
                className={`b3d-icon clickable ${guided ? "on" : ""}`}
                onClick={toggleGuide}
                title={
                  guided
                    ? "Quitter la lecture guidée"
                    : "Lecture guidée : la caméra suit la lecture, page par page"
                }
                aria-label="Lecture guidée"
                aria-pressed={guided}
              >
                {/* Une paire de lunettes, et pas une loupe à balayage : ce
                    bouton ne cherche rien dans la page, il s'installe pour la
                    LIRE. C'est le seul objet que tout le monde associe à ça. */}
                <Glasses size={17} />
              </button>
              <Link
                to={`/collection/${media.slug}`}
                className="b3d-icon clickable"
                title="Ouvrir la fiche"
                aria-label="Ouvrir la fiche"
              >
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>

          {/* LA RÈGLE NE SE RETOURNE PAS, MÊME EN MANGA. Les planches, oui —
              c'est le sens de lecture. Mais une barre de progression n'est pas
              une page : c'est une jauge, et une jauge qui se remplit vers la
              gauche se lit comme une jauge qui se VIDE. On garde donc le sens
              de l'écran, celui de toutes les autres barres de l'app. */}
          <div className="b3d-rule">
            <input
              type="range"
              min={0}
              max={Math.max(0, views.length - 1)}
              value={index}
              onChange={(e) => {
                ctl.current.turn = null;
                setTurn(null);
                setIndex(Number(e.target.value));
                // La règle tirée, c'est la tranche qui défile sous le pouce :
                // le même feuilletage que l'avance rapide (le son se plafonne
                // tout seul, sans quoi un aller-retour en ferait cent).
                playPageTurnSound({ soft: true });
              }}
              aria-label="Aller à une double page"
            />
            <span className="b3d-rule-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </footer>
    </div>,
    document.body
  );
}
