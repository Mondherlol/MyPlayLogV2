import {
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
import { RoundedBox } from "@react-three/drei";
import { X, ArrowRight } from "lucide-react";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import { ShelfSkeleton } from "./CollectionSkeleton";
import { BOX, paintCase, fmtYears } from "../lib/collection";

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
const PITCH = 1.66; // écart vertical entre deux planches
// Épaisseur : à l'échelle (1 unité ≈ 16 cm), 0,09 fait une planche d'environ
// 1,5 cm — celle d'une vraie étagère.
const THICK = 0.09;
const DEPTH = 0.9; // profondeur : juste de quoi porter le boîtier

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
// `lip` / `shade` : les deux filets qui courent sur le chant, en haut et en
// bas. Sans eux, la planche est un ruban de couleur ; avec, elle a une
// épaisseur et une arête — c'est tout ce qui la fait lire comme une planche.
const PLANK = {
  light: { body: "#dcd8d0", front: "#eeece5", lip: "#fbfaf6", shade: "#b6b1a6" },
  dark: { body: "#23242c", front: "#32333d", lip: "#474956", shade: "#16171d" },
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

// Les matériaux sont construits À LA MAIN plutôt que déclarés en JSX : un
// matériau JSX qui passe de `color` à `map` garde sa couleur, et une texture
// est MULTIPLIÉE par elle — boîtier noir, sans erreur. Ici la couleur est
// toujours explicite.
function useCaseMaterials(textures) {
  const paper = useMemo(() => {
    // Du PAPIER, pas du vernis : rugueux (0,82) et sans métal, donc sans lobe
    // spéculaire serré. Une jaquette de boîtier est imprimée sur du carton
    // mat ; à 0,36 elle renvoyait un éclat de plastique en plein milieu de
    // l'affiche, et c'est l'affiche qu'on vient voir.
    const sheet = (map) =>
      map &&
      new THREE.MeshStandardMaterial({
        map,
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0,
      });
    return {
      sleeve: sheet(textures?.sleeve),
      back: sheet(textures?.back),
      spine: sheet(textures?.spine),
    };
  }, [textures]);

  // R3F ne détruit que ce qu'il a créé lui-même : à nous de libérer.
  useEffect(() => () => Object.values(paper).forEach((m) => m?.dispose()), [paper]);
  return paper;
}

// ------------------------------------------------------------ le boîtier --

// Le boîtier lui-même, sans interaction : partagé entre le rayon et la
// vitrine. Deux fabrications, parce que ce ne sont pas les mêmes objets :
//
//   • jaquette COMPOSÉE par nos soins (affiche + titre peints face par face) —
//     une coque de plastique blanc aux arêtes arrondies, la jaquette glissée
//     dessus en léger retrait, ce qui laisse voir le liseré de plastique tout
//     autour, comme sur un boîtier de location ;
//
//   • jaquette FOURNIE, dépliée d'un seul tenant (`media.wrap`) — elle se plie
//     autour du boîtier d'une arête à l'autre, exactement comme à l'impression.
//     Elle est donc posée en TEXTURE DE FACE sur une boîte à arêtes vives : dos,
//     tranche et couverture s'enchaînent SANS LE MOINDRE BORD BLANC. Un plan
//     rapporté en retrait, lui, couperait le dessin à chaque pli.
function CaseModel({ format = "dvd", paper, full = false }) {
  const box = BOX[format] || BOX.dvd;

  // La coque est la MÊME pour tous : plastique blanc, arêtes arrondies. Seule
  // change la façon dont le papier est posé dessus.
  //
  //   • jaquette composée par nos soins → panneaux en léger retrait, le liseré
  //     de plastique se voit tout autour, comme sur un boîtier de location ;
  //   • jaquette FOURNIE d'un seul tenant (`media.wrap`) → elle se plie autour
  //     du boîtier, donc ses trois panneaux se TOUCHENT aux arêtes : plus de
  //     bord blanc entre la tranche et les faces, le dessin est continu. Seule
  //     la hauteur garde un cheveu de plastique, comme sur l'objet réel.
  const wide = full ? 1 : 0.955; // couverture et dos
  const edge = full ? 1 : 0.86; // tranche
  const high = full ? 0.985 : 0.972;

  return (
    <group>
      <RoundedBox args={[box.w, box.h, box.d]} radius={0.013} smoothness={4}>
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
      </RoundedBox>

      {paper.sleeve && (
        <mesh position={[box.w / 2 + 0.0016, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[box.d * wide, box.h * high]} />
          <primitive object={paper.sleeve} attach="material" />
        </mesh>
      )}
      {paper.back && (
        <mesh position={[-box.w / 2 - 0.0016, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[box.d * wide, box.h * high]} />
          <primitive object={paper.back} attach="material" />
        </mesh>
      )}
      {paper.spine && (
        <mesh position={[0, 0, box.d / 2 + 0.0016]}>
          <planeGeometry args={[box.w * edge, box.h * high]} />
          <primitive object={paper.spine} attach="material" />
        </mesh>
      )}

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

function ShelfCase({ media, x, baseY, textures, hovered, held, taken, onHover, onPick }) {
  const group = useRef(null);
  const box = BOX[media.format] || BOX.dvd;
  const paper = useCaseMaterials(textures);
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
          <CaseModel format={media.format} paper={paper} full={textures?.full} />
        </group>
      )}
    </group>
  );
}

function Plank({ width, y, skin }) {
  // Caméra à niveau : on ne voit jamais le dessus, seulement le chant. À
  // l'écran c'est un rectangle fin sous les boîtiers, rien d'autre.
  return (
    <group position={[0, y, -DEPTH / 2 + 0.02]}>
      <mesh position={[0, -THICK / 2, 0]}>
        <boxGeometry args={[width, THICK, DEPTH]} />
        <meshStandardMaterial color={skin.body} roughness={0.62} metalness={0.05} />
      </mesh>
      <mesh position={[0, -THICK / 2, DEPTH / 2 + 0.002]}>
        <boxGeometry args={[width, THICK, 0.004]} />
        <meshStandardMaterial color={skin.front} roughness={0.5} metalness={0.05} />
      </mesh>
      {/* Les deux arêtes du chant : un filet clair sous les boîtiers (le bord
          que la lumière de la pièce accroche), une ombre sous la planche. */}
      <mesh position={[0, -THICK * 0.08, DEPTH / 2 + 0.005]}>
        <boxGeometry args={[width, THICK * 0.16, 0.004]} />
        <meshStandardMaterial color={skin.lip} roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, -THICK * 0.89, DEPTH / 2 + 0.005]}>
        <boxGeometry args={[width, THICK * 0.22, 0.004]} />
        <meshStandardMaterial color={skin.shade} roughness={0.72} metalness={0.02} />
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
  textures,
  hovered,
  held,
  taken,
  onHover,
  onPick,
  onAnchor,
  skin,
}) {
  // Une rangée centrée par planche, les tranches presque jointives.
  const layout = useMemo(() => {
    const chunks = [];
    for (let i = 0; i < media.length; i += PER_PLANK)
      chunks.push(media.slice(i, i + PER_PLANK));
    const widthOf = (row) =>
      row.reduce((w, m) => w + (BOX[m.format] || BOX.dvd).w + GAP, 0) - GAP;
    const width = Math.max(MIN_W, Math.max(...chunks.map(widthOf), 0) + EDGE * 2);

    const planks = chunks.map((row, r) => {
      const y = ((chunks.length - 1) * PITCH) / 2 - r * PITCH - BOX.dvd.h / 2;
      let x = -widthOf(row) / 2;
      const items = row.map((m) => {
        const at = x;
        x += (BOX[m.format] || BOX.dvd).w + GAP;
        return { media: m, x: at, baseY: y };
      });
      return { items, y };
    });

    const bottomY = planks[planks.length - 1].y - THICK;
    const topY = planks[0].y + BOX.dvd.h;
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
    const box = BOX[item.media.format] || BOX.dvd;
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
              textures={textures[m.slug]}
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
function caseFit(width, height) {
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const vTan = Math.tan((FOV * Math.PI) / 180 / 2);
  const d = Math.max(
    (BOX.dvd.h * 1.32) / (2 * vTan),
    (BOX.dvd.d * 1.32) / (2 * vTan * aspect)
  );
  const visible = 2 * d * vTan;
  // La scène prend tout l'écran, mais le cartouche flotte en bas : on regarde
  // donc un peu plus bas que le boîtier, ce qui le remonte dans l'image et lui
  // dégage cette bande. Un point visé décalé, et non la caméra penchée : la
  // perspective ne doit pas basculer.
  return { d, vTan, visible, eye: -0.06 * visible };
}

function InspectorFit({ spin, from }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const { d, visible, eye } = caseFit(size.width, size.height);
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
        s: Math.max(0.05, (from.h * perPx) / BOX.dvd.h),
      };
    }
  }, [camera, size, gl, spin, from]);
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

function SpinningCase({ media, textures, spin, drag, onOpen, onReady, onZoom }) {
  const group = useRef(null);
  const close = useRef(false); // regarde-t-on le boîtier de près ?
  // Sans vol (tactile : pas de survol, donc pas de place d'origine connue), le
  // boîtier se contente de grandir un peu en arrivant.
  const pop = useRef(spin.current.intro < 1 ? 1 : 0.72);
  const told = useRef(false);
  const paper = useCaseMaterials(textures);

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
      s.intro = Math.min(1, s.intro + dt / (s.fly ? FLY_OUT : 0.75));
      const turn = s.fly ? Math.max(0, (s.intro - 0.3) / 0.7) : s.intro;
      s.y = (Math.PI / 2) * (1 - easeOut(Math.min(1, turn)));
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
      <CaseModel format={media.format} paper={paper} full={textures?.full} />
    </group>
  );
}

// Le bouton droit sert à déplacer l'objet : il ne doit ni ouvrir la fiche, ni
// refermer la vitrine. On ne réagit donc qu'au bouton principal.
function mainButton(e) {
  return (e?.nativeEvent?.button ?? e?.button ?? 0) === 0;
}

function CaseInspector({ media, textures, from, onClose, onOpen, onReady, onSettle }) {
  useScrollLock(true);

  // Rotation, zoom et déplacement en ref, pas en state : ils bougent à chaque
  // frame et à chaque pixel de souris — un rendu React à ce rythme ferait
  // ramer la scène.
  const spin = useRef({
    // Venu de l'étagère, il arrive exactement aussi penché qu'il l'était au
    // clic — et c'est là qu'il devra revenir pour se ranger.
    x: from ? from.tilt : -0.05,
    home: from ? from.tilt : HOVER.tilt,
    // Venu de l'étagère, le boîtier arrive DE TRANCHE, exactement comme on le
    // voyait rangé ; sinon (tactile, pas de survol) il se présente de face.
    y: from ? Math.PI / 2 : 0.35,
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

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

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
          <InspectorFit spin={spin} from={from} />
          <InspectorLights spin={spin} />
          <SpinningCase
            media={media}
            textures={textures}
            spin={spin}
            drag={drag}
            onOpen={onOpen}
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
              {media.kind === "series"
                ? `Série · ${media.episodeCount} épisodes`
                : "Film"}
              {fmtYears(media) ? ` · ${fmtYears(media)}` : ""}
            </span>
          </div>
          <button className="btn btn-primary clickable" onClick={onOpen}>
            <ArrowRight size={16} /> Ouvrir la fiche
          </button>
        </div>
        <span className="coll-inspect-hint">
          Attrape-le pour le retourner · clic droit pour le déplacer · molette
          pour zoomer · clique-le pour ouvrir · Échap pour le reposer
        </span>
      </footer>
    </div>,
    document.body
  );
}

// ------------------------------------------------------------------ page --

export default function CollectionShelf({ media, onSelect, theme = "light" }) {
  const [hovered, setHovered] = useState(null);
  const [anchor, setAnchor] = useState(null); // position écran du survolé
  const [inspected, setInspected] = useState(null); // { media, from }
  // Le boîtier retiré du rayon. Volontairement distinct de `inspected` : sa
  // place ne se vide qu'une fois que la vitrine a vraiment dessiné le sien,
  // et se remplit à nouveau juste avant qu'elle ne s'efface.
  const [taken, setTaken] = useState(null);
  const [textures, setTextures] = useState({});
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
        const mk = (canvas) => {
          const t = new THREE.CanvasTexture(canvas);
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          return t;
        };
        setTextures((prev) => ({
          ...prev,
          [m.slug]: {
            spine: mk(painted.spine),
            sleeve: mk(painted.sleeve),
            back: mk(painted.back),
            // Jaquette d'un seul tenant : le boîtier se monte sans liseré.
            full: !!painted.full,
          },
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
  liveTextures.current = textures;
  useEffect(
    () => () => {
      for (const set of Object.values(liveTextures.current)) {
        for (const t of Object.values(set)) t?.dispose?.();
      }
    },
    []
  );

  // La bulle garde le dernier titre survolé le temps de sa disparition : la
  // vider dès la sortie du curseur ferait clignoter une carte vide.
  const held = useRef(null);
  if (anchor) {
    const m = media.find((x) => x.slug === anchor.slug);
    if (m) held.current = { media: m, anchor };
  }
  const tip = held.current;
  const showTip = !!anchor && !inspected;

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

  // Les jaquettes se peignent en série : tant que la première n'est pas prête,
  // le rayon n'est qu'une rangée de coques blanches. On garde donc le squelette
  // par-dessus jusque-là, et la scène se révèle en fondu — l'étagère se garnit
  // au lieu d'apparaître nue puis de se remplir sous les yeux. Le squelette
  // reste monté le temps du fondu, sinon il disparaît d'un coup sur une scène
  // encore transparente.
  const dressed = Object.keys(textures).length > 0;
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
          label="On garnit l'étagère…"
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
          textures={textures}
          hovered={hovered}
          held={inspected?.media.slug}
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
                <b>{tip.media.kind === "series" ? "Série" : "Film"}</b>
                {fmtYears(tip.media) ? ` · ${fmtYears(tip.media)}` : ""}
                {tip.media.kind === "series" && tip.media.episodeCount
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
        Survole un boîtier · clique pour le prendre en main
      </span>

      {inspected && (
        <CaseInspector
          media={inspected.media}
          textures={textures[inspected.media.slug]}
          from={inspected.from}
          onReady={() => setTaken(inspected.media.slug)}
          onSettle={() => setTaken(null)}
          onClose={() => {
            setTaken(null);
            setInspected(null);
          }}
          onOpen={() => onSelect(inspected.media)}
        />
      )}
    </div>
  );
}
