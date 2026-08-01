import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, ContactShadows, Sparkles } from "@react-three/drei";
import { boxOf, isRtl } from "../lib/collection";
import { caseArt, HI_QUALITY } from "../lib/caseTextures";
import { CaseModel, useCasePaper } from "./CaseObject";

// ======================================================================
//  La machine à capsules — tout est dans la scène
// ======================================================================
// IL N'Y A PLUS DE MACHINE — IL Y A UNE SPHÈRE. Toutes les versions
// précédentes ont buté sur la même chose : un socle. Plaque de façade et
// monnayeur d'abord, puis un tambour écrasé, puis un calice avec sa manivelle —
// à chaque fois un meuble sous le verre, et à chaque fois c'est le meuble qui
// était laid. Il n'y en a plus. Plus de socle, plus de manivelle, plus de
// carrosserie.
//
// Reste UNE BOULE DE VERRE EN LÉVITATION, pleine de bonbons, PERCÉE d'une
// bouche par où la capsule sort. Le trou est une vraie perce dans la coque (la
// calotte sud du verre manque, voir `Orb`), pas un disque noir peint dessus :
// on voit dedans par le trou, on voit les boules s'y presser, et on voit la
// capsule le franchir.
//
// ET IL N'Y A PLUS UN SEUL MÉTAL. Le chrome puis l'or ont été essayés, et les
// deux ratent la cible de la même façon : ils tirent l'objet vers la bijouterie
// ou vers l'électroménager, alors qu'on veut une machine À JOUETS. Ce qui
// habille la bulle est donc entièrement fait de LUMIÈRE — un halo derrière, une
// couronne lumineuse au bord du trou, des étincelles qui flottent autour, une
// clé rose et un contre cyan qui découpent la silhouette. Rien de tout cela n'a
// de contour, donc rien de tout cela ne peut être laid : ce ne sont pas des
// objets.
//
// ET ON LA TOURNE À LA MAIN, TOUT LE TEMPS. On l'attrape, on la fait rouler,
// on la lâche et elle continue sur son erre — c'est ce qui fait un objet plutôt
// qu'une image. Quand la machine est armée, ce même roulement compte : un tour
// complet ramène la bouche face à soi, et elle lâche sa capsule.
//
// LES BOULES SONT ENTASSÉES, pas suspendues. Elles tombent et se poussent les
// unes les autres jusqu'à former un tas au fond du bol (voir `settle`), et
// SEULES CELLES QU'ON N'A PAS ENCORE sont dedans : le tas baisse à vue d'œil à
// mesure qu'on complète la collection. C'est la seule jauge de tout l'écran.

const FOV = 32;
// CADRAGE MESURÉ, PAS ESTIMÉ. La façade est en avant du centre, donc la
// perspective la grossit : le calcul à plat ment d'une quinzaine de points.
// Projection réelle des huit coins de l'encombrement, à 16:9 → la machine
// occupe 78 % de la hauteur et s'étend de −0,64 à +0,92 en coordonnées écran :
// posée au centre, entière, de l'air au-dessus, et surtout LE BAS DÉGAGÉ —
// c'est là que vivent le bouton « Lancer » et les invites, et une machine qui
// descend jusqu'à −0,97 (ce qu'elle faisait) se pose dessus.
//
// Le point visé est SOUS le centre de l'objet : viser haut fait descendre la
// machine dans l'image, et c'était toute l'erreur du premier réglage.
const EYE = [0, 0.95, 6.4];
const LOOK = [0, 0.5, 0];

// LE RECUL DES ÉCRANS ÉTROITS. En dessous de ce rapport, c'est la LARGEUR qui
// borne : la sphère fait 1,90 de large, et sans recul elle sort du cadre par
// les côtés sur un téléphone tenu debout. Le coefficient suit sa largeur — il
// valait 5,2 pour deux unités, donc 4,9 pour celle-ci. (Les étincelles, elles,
// débordent volontiers : ce sont des points, et qu'il en sorte quelques-unes du
// cadre est exactement ce qu'on veut.)
const NARROW = 0.95;
const NARROW_PULL = 4.9;

// Où la machine se tient, et où elle recule quand l'objet prend la vedette.
const MACHINE_HOME = { y: 0, z: 0, s: 1 };
const MACHINE_BACK = { y: -1.05, z: -2.1, s: 0.6 };

// La scène de présentation : bien devant la machine, dans l'axe. `y` suit le
// rayon qui passe par le centre de l'écran — il descend de 0,45 sur 6,4, donc
// à z = 3 il est à 0,71 — et on se pose un cheveu au-dessus : un objet
// exactement au centre géométrique paraît toujours un peu bas, et le nom vient
// se ranger dessous.
const STAGE = new THREE.Vector3(0, 0.74, 3.0);

// LA SPHÈRE — et il n'y a rien d'autre. Elle occupe à elle seule la hauteur que
// se partageaient le globe et le socle : c'est ce qu'on gagne à supprimer le
// meuble. L'encombrement total ne bouge pas d'un millimètre (le cadrage est
// mesuré dessus, voir EYE/LOOK) : haut du verre à +1,90, sol à −0,52.
const DOME_R = 0.95;
const DOME_Y = 0.95;

// LE SOL. Rien ne s'y pose — la sphère flotte un demi-mètre au-dessus — mais il
// existe : c'est là que se peint l'ombre, là que s'étale le halo, et là que la
// capsule vient se coucher en sortant. Les trois doivent lire le même plan.
const FLOOR = -0.52;

// LA BOUCHE — le trou, celui qu'on veut voir. Le verre est une sphère OUVERTE :
// sa calotte sud manque (`thetaLength`), et on incline la coque pour que
// l'ouverture regarde vers l'avant et vers le bas, là où le regard tombe.
//
// Tout le reste se DÉDUIT de ces deux angles — l'axe par où sort la capsule, le
// rayon du trou, l'endroit où poser la bague d'or. Écrire ces trois valeurs à
// la main serait la garantie que la bague ne colle jamais tout à fait au trou.
const MOUTH_TILT = 0.5; // de combien la bouche remonte vers le spectateur
const MOUTH_ARC = 0.38; // demi-ouverture angulaire de la perce
const MOUTH_DIR = new THREE.Vector3(0, -Math.cos(MOUTH_TILT), Math.sin(MOUTH_TILT));
const MOUTH_R = DOME_R * Math.sin(MOUTH_ARC);
const MOUTH_AT = new THREE.Vector3(0, DOME_Y, 0).addScaledVector(
  MOUTH_DIR,
  DOME_R * Math.cos(MOUTH_ARC)
);

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// ============================================================
//  Les couleurs de bonbon
// ============================================================
// UNE PALETTE CHOISIE, PAS LA ROUE DES TEINTES. Répartir les boules sur les
// 360° du cercle chromatique paraît juste et donne un tas terne : un sixième
// du cercle est occupé par des olives, des moutardes et des kakis, qui sont des
// couleurs très bien mais qui ne sont pas des couleurs de JOUET. Ces douze-là
// sont toutes franches et saturées — c'est la boîte de bonbons acidulés, et
// c'est exactement ce qu'on veut voir derrière une vitre.
//
// Teintes en degrés ; la saturation et la clarté sont posées à l'usage (le
// couvercle dépoli est plus clair et moins saturé que le fond).
const CANDY = [340, 12, 28, 45, 62, 96, 152, 176, 196, 218, 262, 300];

// Couleur STABLE d'une boule, tirée de son slug : le tas est le même d'une
// visite à l'autre, ce qui en fait un objet et pas un économiseur d'écran.
function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const candyHue = (s) => CANDY[hashOf(s) % CANDY.length];

// ============================================================
//  Le tas
// ============================================================
// LES BOULES TOMBENT ET SE POUSSENT. Trois règles répétées : chacune descend,
// deux qui se chevauchent s'écartent, et aucune ne sort du bol. Ça suffit à
// faire un vrai tas — surface irrégulière, cuvette au milieu, boules calées les
// unes sur les autres — là où n'importe quelle formule de répartition donne une
// constellation flottante.
//
// LE DOSAGE EST TOUT, et le premier jet était faux : une gravité de 0,3·r par
// passe faisait descendre les boules trente fois plus vite que la séparation ne
// pouvait les démêler, et le tas finissait écrasé avec des dizaines de boules
// l'une DANS l'autre. Il faut une gravité douce (0,09·r), DEUX passes de
// séparation par pas de chute, et une trentaine de passes de séparation seule à
// la fin pour laisser le tas se ranger. À ce réglage il ne reste aucun
// chevauchement, quel que soit l'effectif.
//
// Le calcul tourne UNE FOIS, hors rendu, et coûte ~30 ms pour cent vingt
// boules — le prix de deux images, payé une seule fois à l'ouverture.
function settle(n, R, r) {
  const p = [];
  for (let i = 0; i < n; i++) {
    // Départ dispersé dans le haut du bol : elles « tombent » de là.
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const rad = Math.sqrt((i + 0.5) / n) * (R - r) * 0.9;
    p.push(
      new THREE.Vector3(
        Math.cos(a) * rad,
        (R - r) * (0.1 + Math.random() * 0.85),
        Math.sin(a) * rad
      )
    );
  }
  const inner = R - r;
  const min = r * 2;

  const separate = () => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = p[i];
        const b = p[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > min) continue;
        if (d < 1e-5) {
          // Deux boules exactement au même point : aucune direction ne les
          // sépare, on en pousse une au hasard plutôt que de diviser par zéro.
          a.x += r * 0.2;
          b.x -= r * 0.2;
          continue;
        }
        const push = (min - d) / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.y += dy * push;
        b.z += dz * push;
      }
    }
    // Le bol : personne ne sort de la sphère. C'est cette contrainte-là qui
    // creuse le tas en cuvette au lieu de l'aplatir comme sur un plancher.
    for (const v of p) {
      const d = v.length();
      if (d > inner) v.multiplyScalar(inner / d);
    }
  };

  for (let it = 0; it < 90; it++) {
    for (const v of p) v.y -= r * 0.09;
    separate();
    separate();
  }
  for (let it = 0; it < 30; it++) separate();
  return p;
}

// Au-delà, le tas ne se compte plus à l'œil et la mise en place devient chère
// (elle est en n²). Un catalogue plus gros montre donc un tas de cent vingt
// boules — c'est un décor et une jauge, pas un inventaire.
const MAX_PILE = 120;

function Capsules({ balls }) {
  const mesh = useRef(null);

  const seats = useMemo(() => {
    // SEULES LES BOULES QU'ON N'A PAS. Une machine ne garde pas ce qu'elle a
    // déjà distribué — et le tas qui baisse dit l'avancement mieux qu'un
    // compteur : à la fin il n'en reste que deux qui roulent au fond.
    const left = balls.filter((b) => !b.owned).slice(0, MAX_PILE);
    const n = left.length;
    if (!n) return [];
    // Le rayon suit le nombre pour que le tas remplisse toujours à peu près la
    // moitié du bol : vingt grosses boules ou deux cents petites, ça reste un
    // tas. Borné des deux côtés — au-delà ce sont des ballons ou du gravier.
    const r = Math.max(0.055, Math.min(0.19, DOME_R * Math.cbrt(0.3 / n)));
    const pos = settle(n, DOME_R, r);
    return left.map((b, i) => ({
      slug: b.slug,
      r,
      pos: pos[i],
      hue: candyHue(b.slug),
      // Un rien de clarté en plus ou en moins d'une boule à l'autre : douze
      // teintes exactement identiques d'un bout à l'autre du tas se lisent
      // comme douze gommettes imprimées, pas comme des objets.
      lum: 0.54 + ((hashOf(b.slug) >> 5) % 5) * 0.035,
    }));
  }, [balls]);

  useEffect(() => {
    const m = mesh.current;
    if (!m || !seats.length) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      dummy.position.copy(s.pos);
      dummy.scale.setScalar(s.r);
      // Chacune posée dans un sens différent : un tas de boules toutes
      // orientées pareil se voit tout de suite (les coutures s'alignent).
      dummy.rotation.set(s.hue, s.hue * 1.7, s.hue * 0.6);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      // Saturation poussée : ce sont des bonbons, pas des galets.
      color.setHSL(s.hue / 360, 0.95, s.lum);
      m.setColorAt(i, color);
    });
    m.count = seats.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [seats]);

  if (!seats.length) return null;
  return (
    <group position={[0, DOME_Y, 0]}>
      <instancedMesh
        ref={mesh}
        // `key` : le nombre d'instances est figé à la construction du tampon.
        // Sans lui, gagner une boule laissait la dernière place dessinée sur
        // l'ancienne matrice — un fantôme au milieu du tas.
        key={seats.length}
        args={[undefined, undefined, seats.length]}
        castShadow
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshPhysicalMaterial
          roughness={0.22}
          metalness={0}
          clearcoat={0.8}
          clearcoatRoughness={0.15}
          envMapIntensity={1.4}
        />
      </instancedMesh>
    </group>
  );
}

// ============================================================
//  La machine — une sphère, et rien dessous
// ============================================================
// PLUS UN SEUL MÉTAL. Le chrome puis l'or ont été essayés, et les deux ratent
// la cible de la même façon : ils tirent l'objet vers la bijouterie ou vers
// l'électroménager, alors qu'on veut une MACHINE À JOUETS. Une bague dorée
// autour d'un trou, un jonc doré à l'équateur — c'est de l'orfèvrerie, ça n'a
// jamais eu sa place dans une boutique de gachapon.
//
// CE QUI FAIT LE RENDU, ICI, CE N'EST PAS DE LA GÉOMÉTRIE, C'EST DE LA LUMIÈRE.
// Un jeu ne dessine pas des ornements autour d'une bulle : il met du halo
// derrière, une bordure lumineuse sur le trou, des étincelles qui flottent, et
// deux sources colorées (une chaude, une froide) qui décollent la silhouette du
// fond. Il ne reste donc qu'un seul volume — le verre — et tout le reste est
// additif : ça n'ajoute que de la lumière, ça n'a pas de bord, et ça ne peut pas
// être laid parce que ce n'est pas un objet.
const GLASS = "#eef8ff"; // le verre, à peine bleuté
const HALO = "#ffc7e6"; // le rose qui l'auréole par-derrière
const LIGHT = "#fff0c4"; // la lumière qui borde la bouche et flaque au sol

function Machine({ balls, anim, onNotch, onRelease, armed }) {
  const group = useRef(null);
  // De quel calme la sphère est gagnée. `a.capsule` bascule de 0 à 1 D'UN COUP
  // au moment où l'on paie ; couper la dérive dessus la ferait sauter de son
  // décalage courant à zéro sur une image. Elle s'immobilise donc en un tiers
  // de seconde, ce qui se lit comme « elle se met en place ».
  const calm = useRef(0);

  useFrame((state, raw) => {
    const g = group.current;
    if (!g) return;
    const a = anim.current;
    calm.current += (a.capsule - calm.current) * Math.min(1, Math.min(raw, 0.05) * 3);

    // Le recul. La machine ne disparaît pas quand l'objet sort : elle s'efface
    // EN PROFONDEUR et reste au fond comme le décor du moment. Rien à faire
    // fondre, donc rien qui clignote.
    const back = easeInOut(a.back);
    g.position.y = THREE.MathUtils.lerp(MACHINE_HOME.y, MACHINE_BACK.y, back);
    g.position.z = THREE.MathUtils.lerp(MACHINE_HOME.z, MACHINE_BACK.z, back);
    g.scale.setScalar(THREE.MathUtils.lerp(MACHINE_HOME.s, MACHINE_BACK.s, back));

    // Elle respire, et dérive très lentement sur elle-même : une sphère
    // parfaitement immobile est une maquette.
    //
    // La dérive s'ARRÊTE dès que la partie commence (`a.capsule` passe à 1 en
    // même temps que la sphère devient manœuvrable). Ce n'est pas du confort :
    // la capsule ne fait PAS partie de ce groupe (elle recalcule sa place
    // elle-même, voir `Capsule`), donc une sphère qui continuerait de rouler de
    // ±0,12 déplacerait sa bouche de onze centièmes pendant que la capsule, qui
    // ne le sait pas, viserait le trou à sa place d'origine. La marge est de
    // quinze centièmes : ça passait de justesse, ce qui veut dire que ça ne
    // passait pas.
    const t = state.clock.elapsedTime;
    g.position.y += Math.sin(t * 0.8) * 0.014 * (1 - back);
    g.rotation.y = Math.sin(t * 0.28) * 0.12 * (1 - back) * (1 - calm.current);

    // La secousse, quand la sphère lâche sa capsule.
    if (a.shake > 0.001) {
      g.position.x = (Math.random() - 0.5) * 0.035 * a.shake;
      g.rotation.z = (Math.random() - 0.5) * 0.022 * a.shake;
    } else {
      g.position.x = 0;
      g.rotation.z = 0;
    }
  });

  return (
    <group ref={group}>
      {/* LE HALO, DERRIÈRE. C'est le faux bloom : aucune passe de rendu en plus
          (le paquet de post-traitement n'est pas dans l'application, et il ne le
          sera pas pour une modale), juste une grande tache de lumière posée en
          arrière de la bulle. C'est LUI qui fait que le verre a l'air d'émettre
          au lieu d'être découpé sur du noir. */}
      <Bloom anim={anim} armed={armed} />

      <Orb balls={balls} anim={anim} armed={armed} onNotch={onNotch} onRelease={onRelease} />

      {/* LES ÉTINCELLES. Rien ne dit « gachapon » aussi vite qu'une poussière
          qui scintille autour de la bulle — et c'est trente lignes de shader
          déjà écrites dans drei. Elles vivent DANS le groupe : elles reculent
          avec la sphère au lieu de rester en suspens à l'avant-plan. */}
      <Sparkles
        position={[0, DOME_Y, 0]}
        count={44}
        scale={[3.1, 3.1, 3.1]}
        size={2.6}
        speed={0.32}
        noise={0.5}
        opacity={0.65}
        color="#fff6df"
      />

      <Floor anim={anim} />
    </group>
  );
}

// ============================================================
//  Le halo — du bloom sans passe de rendu
// ============================================================
// UNE TACHE DE LUMIÈRE, POSÉE DERRIÈRE. Deux couches : une large et rose qui
// auréole toute la bulle, une plus serrée et chaude qui la fait rayonner par le
// cœur. Toutes deux en additif, donc sans contour possible — et c'est ce qu'on
// veut : ce n'est pas une pièce de la machine, c'est de la lumière.
//
// Elles s'intensifient quand la sphère devient manœuvrable : l'objet s'allume
// au moment où il attend un geste, ce qui vaut mieux que n'importe quelle
// flèche clignotante.
function Bloom({ anim, armed }) {
  const wide = useRef(null);
  const core = useRef(null);
  const glow = useGlow();

  useFrame((state) => {
    const back = easeInOut(anim.current.back);
    const t = state.clock.elapsedTime;
    const call = armed ? 1 : 0;
    // Une respiration lente, plus ample quand on attend le geste.
    const beat = 0.85 + Math.sin(t * (armed ? 1.9 : 0.8)) * (armed ? 0.15 : 0.09);
    if (wide.current) {
      wide.current.material.opacity = (0.34 + call * 0.16) * beat * (1 - back);
    }
    if (core.current) {
      core.current.material.opacity = (0.2 + call * 0.14) * beat * (1 - back);
    }
  });

  return (
    <group position={[0, DOME_Y, -0.85]}>
      <sprite ref={wide} scale={DOME_R * 5.4}>
        <spriteMaterial
          map={glow}
          color={HALO}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={core} scale={DOME_R * 3.1}>
        <spriteMaterial
          map={glow}
          color={LIGHT}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

// ============================================================
//  Le sol — ce qui POSE une sphère qui ne touche rien
// ============================================================
// SANS ÇA, ELLE EST COLLÉE SUR L'ÉCRAN. Un objet qui ne repose sur rien n'a
// aucune profondeur : il faut lui dire où est le sol pour que la lévitation se
// lise comme de la lévitation et non comme une image. Deux choses le disent,
// et aucune n'est un meuble — une ombre portée, et un halo qui la soutient.
//
// Le halo joue le second rôle : il remplit le noir que l'ombre creuse, et c'est
// LUI qui donne l'impression que quelque chose la retient en l'air.
function Floor({ anim }) {
  const pool = useRef(null);
  const glow = useGlow();

  // Le halo respire au même rythme que la sphère, et il s'éteint quand elle
  // recule : une flaque de lumière restée à l'avant-plan pendant que l'objet
  // est au fond, c'est une lampe oubliée sur le plateau.
  useFrame((state) => {
    const m = pool.current;
    if (!m) return;
    const back = easeInOut(anim.current.back);
    const beat = 0.86 + Math.sin(state.clock.elapsedTime * 0.9) * 0.14;
    m.material.opacity = 0.26 * beat * (1 - back);
  });

  return (
    <group>
      <mesh ref={pool} position={[0, FLOOR + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.6, 64]} />
        <meshBasicMaterial
          map={glow}
          color={LIGHT}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* DANS le groupe de la machine, pas à côté : la sphère recule quand
          l'objet prend la vedette, et une ombre restée en place serait une
          tache noire suspendue en l'air.
          Une ombre DOUCE et pâle : la bulle flotte à un demi-mètre du sol, une
          ombre franche la recollerait dessus. */}
      <ContactShadows
        position={[0, FLOOR, 0]}
        opacity={0.34}
        scale={5}
        blur={3.4}
        far={2.6}
        resolution={512}
        color="#1a0a18"
      />
    </group>
  );
}

// ============================================================
//  La sphère — le verre, le trou, et la main dessus
// ============================================================
// LE VERRE EST PERCÉ POUR DE BON. `thetaLength` retire la calotte sud de la
// coque, et on bascule le tout pour que le manque regarde vers l'avant et vers
// le bas. C'est ce qui fait la crédibilité du trou : on voit DANS la sphère par
// l'ouverture, sans verre entre deux, et les bonbons s'y pressent. Un disque
// sombre peint sur une sphère fermée se lit toujours comme un autocollant.
//
// LE BORD DU TROU EST DE LA LUMIÈRE, PAS UNE BAGUE. C'était l'erreur d'avant :
// un tore doré autour de la perce, c'est un bijou posé sur un jouet. À la place
// une couronne lumineuse peinte au dégradé — aucun contour, aucun matériau,
// juste un liseré qui rougeoie autour de l'ouverture. C'est ce que ferait un
// jeu, et c'est ce qui rend le trou lisible d'un coup d'œil.
//
// ON LA TOURNE À LA MAIN, TOUT LE TEMPS. Elle se manipule dès qu'elle est à
// l'écran : on l'attrape, on la fait rouler, on la lâche et elle continue sur
// son erre. Ce n'est pas un ornement — c'est ce qui transforme une image en
// objet, et c'est aussi le geste de la partie : quand la machine est armée, ce
// même roulement compte, et UN TOUR COMPLET ramène la bouche face à soi et lâche
// la capsule. La fin du geste se lit sur l'objet, sans aucune jauge.
const NOTCHES = 12; // crans par tour : assez pour que ça craque, pas pour râper
const SPIN_PX = 560; // pixels de glissé pour un tour complet
const TAU = Math.PI * 2;

function Orb({ balls, anim, armed, onNotch, onRelease }) {
  const shell = useRef(null);
  const lip = useRef(null);
  const notch = useRef(0);
  const [hot, setHot] = useState(false);
  const ring = useRingGlow();

  // LE ROULEMENT LIBRE, en un seul endroit. `free` est l'angle où le joueur a
  // laissé la sphère, `spin` sa vitesse résiduelle, `tilt` le basculement.
  // `way` est le sens du tour en cours (voir plus bas).
  const turn = useRef({ free: 0, spin: 0, tilt: 0, way: 0, at: null });

  // On ne peut attraper la sphère qu'à deux moments : AVANT le tirage (elle
  // n'est qu'un objet, on la regarde) et PENDANT l'armement (elle est le
  // geste). Entre les deux — la chute, la montée, le secouage, l'ouverture —
  // le pointeur appartient à la capsule, et lui disputer le glissé casserait le
  // secouage, qui est le seul vrai moment de jeu.
  const holdable = () => armed || anim.current.capsule < 0.5;

  // Le curseur dit que ça se tourne. Nettoyé au démontage : une modale fermée
  // en plein survol laisserait la page entière en « grab ».
  useEffect(() => {
    document.body.style.cursor = hot ? "grab" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hot]);

  function down(e) {
    if (!holdable() || anim.current.crank >= 1) return;
    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    const t = turn.current;
    // Le sens ne se reprend qu'au DÉPART d'un tour. Relâcher au milieu et
    // ressaisir doit continuer le même mouvement, pas rouvrir le choix : sinon
    // il suffit de lâcher et de reprendre pour avancer dans les deux sens, et
    // le garde-fou ne garde plus rien.
    if (anim.current.crank <= 0) t.way = 0;
    t.at = { x: e.clientX, y: e.clientY };
    t.spin = 0;
    document.body.style.cursor = "grabbing";
  }

  function move(e) {
    const t = turn.current;
    if (!t.at) return;
    e.stopPropagation();
    const dx = e.clientX - t.at.x;
    const dy = e.clientY - t.at.y;
    t.at = { x: e.clientX, y: e.clientY };

    // Le basculement, borné : au-delà on voit le tas de bonbons défier la
    // pesanteur, ce qui n'arrive pas dans une vraie bulle.
    t.tilt = Math.max(-0.34, Math.min(0.34, t.tilt + dy * 0.005));
    // La vitesse résiduelle, pour que le lâcher ait une suite.
    t.spin = (dx / SPIN_PX) * TAU * 9;

    if (!armed) {
      // Hors partie, elle roule pour le plaisir : rien à compter.
      t.free += (dx / SPIN_PX) * TAU;
      return;
    }

    if (!t.way) {
      // Le premier mouvement franc décide du sens. Un pixel ne suffit pas : un
      // doigt qui se pose tremble toujours un peu, et il choisirait à notre
      // place. UN SEUL SENS ensuite — revenir en arrière défait le tour au lieu
      // de l'avancer, sans quoi secouer la souris de gauche à droite suffirait
      // à ouvrir la machine, ce qui n'est pas un geste mais une triche.
      if (Math.abs(dx) < 2) return;
      t.way = Math.sign(dx);
    }

    const a = anim.current;
    a.crank = clamp01(a.crank + (dx * t.way) / SPIN_PX);

    const n = Math.floor(a.crank * NOTCHES);
    if (n !== notch.current) {
      notch.current = n;
      onNotch?.(a.crank);
    }
    if (a.crank >= 1) {
      t.at = null;
      t.spin = 0;
      document.body.style.cursor = "";
      onRelease?.();
    }
  }

  const up = () => {
    const t = turn.current;
    if (!t.at) return;
    t.at = null;
    document.body.style.cursor = hot ? "grab" : "";
  };

  useFrame((state, raw) => {
    const dt = Math.min(raw, 0.05);
    const a = anim.current;
    const t = turn.current;

    if (!t.at) {
      // L'ERRE. On lâche, elle continue et s'éteint — c'est ce qui donne du
      // poids à un objet qu'on ne peut pas toucher. Amortissement exponentiel
      // (et non linéaire) : le même freinage quel que soit le nombre d'images.
      //
      // Elle ne pousse PAS le même compteur selon le moment. Hors partie elle
      // fait tourner l'angle libre ; pendant l'armement elle pousse le TOUR,
      // sans quoi les deux se disputeraient le même angle (l'erre pousse dans
      // un sens, la remise en place tire dans l'autre, la sphère vibre). Et
      // c'est bien mieux ainsi : un lancer franc termine le tour tout seul.
      if (armed) {
        if (t.way && Math.sign(t.spin) === t.way && a.crank > 0 && a.crank < 1) {
          a.crank = clamp01(a.crank + (Math.abs(t.spin) * dt) / TAU);
          const n = Math.floor(a.crank * NOTCHES);
          if (n !== notch.current) {
            notch.current = n;
            onNotch?.(a.crank);
          }
          if (a.crank >= 1) onRelease?.();
        }
      } else {
        t.free += t.spin * dt;
      }
      t.spin *= Math.pow(0.1, dt);
      if (Math.abs(t.spin) < 1e-3) t.spin = 0;
      // Elle se redresse toute seule, doucement.
      t.tilt += (0 - t.tilt) * Math.min(1, dt * 1.4);
      // Et elle dérive, tant qu'on ne lui demande rien : une sphère
      // parfaitement immobile est une maquette.
      if (!armed && a.capsule < 0.5 && !t.spin) t.free += dt * 0.14;
    }

    // LA REMISE EN PLACE. La capsule sort par un trajet FIXE dans l'espace de la
    // machine (voir FALL_PATH) : au moment où elle passe, la bouche doit donc
    // être là où ce trajet l'attend. Dès que la sphère est armée, l'angle libre
    // revient au tour entier le plus proche — ce qui, à un tour près, est
    // exactement « bouche devant ». Le tour du joueur s'ajoute par-dessus, et
    // comme il vaut 2π pile, il l'y ramène.
    if (armed) {
      const home = Math.round(t.free / TAU) * TAU;
      t.free += (home - t.free) * Math.min(1, dt * 5);
    }

    if (shell.current) {
      // Elle suit la main, dans le sens de la main : tirer à gauche et voir
      // l'objet partir à droite est la façon la plus sûre de casser un geste.
      shell.current.rotation.y = t.free + (t.way || 1) * a.crank * TAU;
      shell.current.rotation.x = t.tilt;
    }

    // LE LISERÉ DE LA BOUCHE. C'est la seule invite de tout l'écran : il
    // rougeoie doucement en permanence (le trou doit se voir), et il BAT quand
    // la sphère attend un tour.
    if (lip.current) {
      const call = armed && a.crank < 1 ? 1 : 0;
      const beat = 0.5 + Math.sin(state.clock.elapsedTime * 2.4) * 0.5;
      lip.current.material.opacity =
        (0.42 + call * (0.2 + beat * 0.38) + (hot ? 0.18 : 0)) *
        (1 - easeInOut(a.back));
    }
  });

  return (
    <group>
      {/* CE QUI TOURNE : le verre, les bonbons et le liseré de la bouche, d'un
          seul bloc — le liseré EST le bord du trou, il ne peut pas s'en
          détacher. */}
      <group ref={shell}>
        <Capsules balls={balls} />

        {/* Pas de `transmission` sur ce verre : elle demande une passe de rendu
            par image et, sur un canvas transparent, elle capte le vide derrière
            la scène plutôt que la page. Un physique bien réglé sur un
            environnement de studio donne le même verre — reflets courbes,
            liseré lumineux au bord — pour rien. */}
        <mesh position={[0, DOME_Y, 0]} rotation={[-MOUTH_TILT, 0, 0]}>
          <sphereGeometry args={[DOME_R, 64, 44, 0, Math.PI * 2, 0, Math.PI - MOUTH_ARC]} />
          <meshPhysicalMaterial
            color={GLASS}
            transparent
            opacity={0.17}
            roughness={0.02}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.02}
            ior={1.5}
            envMapIntensity={3.4}
            side={THREE.DoubleSide}
            // Sans ça, la face avant du verre efface dans le tampon de
            // profondeur les boules qui sont derrière elle.
            depthWrite={false}
          />
        </mesh>

        {/* LA COURONNE DE LA BOUCHE. Un dégradé peint, posé à plat sur le plan
            du trou : sa place, sa taille et son axe se déduisent des deux angles
            de la découpe (MOUTH_AT, MOUTH_R) — d'où ce π/2 − inclinaison, qui
            redresse un plan couché dans XY pour l'aligner sur l'axe de la perce.
            Recopier ces cotes à la main serait la garantie qu'elle flotte à
            côté du trou qu'elle est censée border. */}
        <mesh
          ref={lip}
          position={MOUTH_AT}
          rotation={[Math.PI / 2 - MOUTH_TILT, 0, 0]}
          scale={MOUTH_R * 2.9}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={ring}
            color={LIGHT}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* La prise : une sphère invisible, à peine plus large que le verre. On
          attrape une boule à pleine main, pas au pixel près. */}
      <mesh
        position={[0, DOME_Y, 0]}
        visible={false}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (holdable()) setHot(true);
        }}
        onPointerOut={() => setHot(false)}
      >
        <sphereGeometry args={[DOME_R * 1.06, 24, 18]} />
      </mesh>
    </group>
  );
}

// LA COURONNE, peinte une fois pour toute l'application : un anneau flou, très
// clair sur son cercle et éteint des deux côtés. Un `ringGeometry` aurait donné
// deux arêtes nettes — et une arête nette, c'est exactement ce qui faisait lire
// les bagues dorées comme des pièces rapportées.
let ringTex = null;
function useRingGlow() {
  return useMemo(() => {
    if (ringTex) return ringTex;
    const S = 256;
    const R = S / 2;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(R, R, 0, R, R, R);
    // Le trou reste NOIR au milieu : c'est une ouverture, pas une lampe.
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.55, "rgba(255,255,255,0)");
    grad.addColorStop(0.68, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.72, "rgba(255,255,255,1)");
    grad.addColorStop(0.8, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    ringTex = new THREE.CanvasTexture(c);
    ringTex.minFilter = THREE.LinearMipmapLinearFilter;
    ringTex.magFilter = THREE.LinearFilter;
    return ringTex;
  }, []);
}

// ============================================================
//  La boule
// ============================================================
// LE MÊME OBJET DU DÉBUT À LA FIN : elle naît dans le mécanisme, tombe, roule,
// monte vers l'œil, se fait secouer, puis se fend. Les deux coquilles sont
// deux demi-sphères SÉPARÉES depuis toujours — ce n'est pas une sphère qu'on
// remplace au moment de l'ouverture, c'est une capsule qui a toujours eu deux
// moitiés, et elles s'écartent.
// LA BOULE QUI SORT EST UNE BOULE DU TAS, à la même échelle : elle a passé le
// trou, elle ne peut pas être plus grosse que celles d'à côté. C'est un détail
// que personne ne formulera et que tout le monde verrait.
// Elle est à l'échelle des boules du tas — c'est un détail que personne ne
// formule et que tout le monde verrait. Et elle passe le trou avec de la marge
// (0,15 de jeu de chaque côté) : c'est cette marge-là qui a fixé l'ouverture de
// la perce, et non l'inverse.
const CAP_R = 0.2;
// De combien elle grossit en montant vers l'œil. Présentée à sa taille réelle,
// elle serait un pois au milieu de l'écran. (Le produit `CAP_R × CAP_PRESENT`
// est ce qui compte, et il n'a pas bougé d'une version à l'autre : l'objet
// présenté fait toujours la même taille.)
const CAP_PRESENT = 2.5;
// L'opacité du couvercle dépoli. Nommée parce qu'elle sert DEUX FOIS — à le
// peindre, et à le faire disparaître à l'ouverture — et que les deux valeurs
// doivent être la même.
const TOP_ALPHA = 0.4;

// CE QU'IL Y A DEDANS : DE LA LUMIÈRE, ET ELLE NE BOUGE PAS.
//
// Deux idées ont été essayées ici et retirées. Une forme noire qui rebondit :
// une tache sombre TROUE une boule translucide au lieu de la remplir. Puis une
// braise mobile avec sa propre lampe : joli, mais une source dynamique de plus
// oblige à recompiler l'éclairage de tous les matériaux de la scène, et ça
// ramait — pour un détail qu'on regarde deux secondes.
//
// Ce qui reste fait le même effet pour rien : un halo additif POSÉ AU CENTRE,
// immobile, qui traverse le couvercle dépoli. Aucune lumière, aucun calcul par
// image, et la boule a l'air allumée de l'intérieur — ce qui était toute la
// demande.
function Ember({ glow, color }) {
  return (
    <group>
      {/* Le cœur : petit, franc, presque blanc. `toneMapped` désactivé — c'est
          une SOURCE, elle doit pouvoir être plus claire que le blanc ambiant. */}
      <sprite scale={CAP_R * 1.5}>
        <spriteMaterial
          map={glow}
          color="#fffdf4"
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      {/* La lueur, large et douce, teintée de la couleur de la boule : c'est
          elle qui remplit le volume et donne l'impression que ça rayonne. */}
      {/* Elle DÉBORDE de la coquille, exprès : de la lumière qui s'arrête pile
          au bord du plastique ne rayonne pas, elle est peinte dessus. */}
      <sprite scale={CAP_R * 3.6}>
        <spriteMaterial
          map={glow}
          color={color}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

// LE TRAJET SORT DU TROU, ET IL EN SORT DROIT. Les deux premiers points sont
// posés SUR L'AXE de la bouche, l'un en dedans l'autre en dehors : c'est la
// seule façon d'être sûr qu'elle franchit la perce en son milieu, quels que
// soient les angles qu'on donne à la découpe. Ensuite la pesanteur reprend ses
// droits — elle tombe, et vient se coucher au sol devant la sphère.
//
// Le premier point est à 0,72 du centre : la coque est à 0,95, la capsule fait
// 0,20, donc elle est ENTIÈREMENT dans le verre avant de partir. Un centième de
// plus et on la verrait dépasser de la sphère avant même que le tour soit fini.
const FALL_PATH = [
  MOUTH_AT.clone().addScaledVector(MOUTH_DIR, -0.16),
  MOUTH_AT.clone().addScaledVector(MOUTH_DIR, 0.12),
  new THREE.Vector3(0, -0.04, 0.66),
  new THREE.Vector3(0, -0.34, 0.82),
  new THREE.Vector3(0, FLOOR + CAP_R, 0.98),
];
// Là où elle s'immobilise — et donc d'où part la montée vers l'œil.
const LANDING = FALL_PATH[FALL_PATH.length - 1];

function Capsule({ hue, anim }) {
  const group = useRef(null);
  const top = useRef(null);
  const bot = useRef(null);
  const haze = useRef(null);
  const seam = useRef(null);
  const lit = useRef(null);
  const glow = useGlow();
  const curve = useMemo(() => new THREE.CatmullRomCurve3(FALL_PATH), []);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  // DEUX TONS, ET UNE COULEUR DIFFÉRENTE À CHAQUE TOUR. La capsule prenait la
  // teinte du boîtier gagné : comme la plupart des jaquettes tirent vers les
  // mêmes tons, toutes les boules se ressemblaient. Elle est maintenant tirée
  // au sort à chaque tirage — et elle n'annonce donc rien du contenu.
  const shell = useMemo(() => {
    const h = ((hue ?? CANDY[0]) % 360) / 360;
    return {
      base: new THREE.Color().setHSL(h, 0.98, 0.53), // le fond, plein et vif
      frost: new THREE.Color().setHSL(h, 0.75, 0.78), // le couvercle, dépoli
    };
  }, [hue]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const a = anim.current;
    g.visible = a.capsule > 0.001;
    if (!g.visible) return;
    const t = state.clock.elapsedTime;

    if (a.rise < 0.001) {
      // ---- DANS LA MACHINE. On suit le conduit ; elle accélère (une chute
      // accélère) et tourne sur elle-même en cognant les parois.
      const p = easeOut(a.fall) * 0.82 + a.fall * 0.18;
      curve.getPointAt(clamp01(p), scratch);
      const back = easeInOut(a.back);
      g.position.set(
        scratch.x,
        THREE.MathUtils.lerp(MACHINE_HOME.y, MACHINE_BACK.y, back) + scratch.y,
        THREE.MathUtils.lerp(MACHINE_HOME.z, MACHINE_BACK.z, back) + scratch.z
      );
      g.rotation.set(a.fall * 9, a.fall * 5, a.fall * 3);
      if (a.fall > 0.94) {
        const w = (a.fall - 0.94) / 0.06;
        g.rotation.z += Math.sin(w * Math.PI * 3) * 0.3 * (1 - w);
      }
      g.scale.setScalar(1);
    } else {
      // ---- ELLE MONTE, puis reste en l'air à hauteur d'œil : c'est le geste
      // de quelqu'un qui ramasse sa boule et la lève pour la regarder.
      const r = easeOut(a.rise);
      const from = scratch.set(
        LANDING.x,
        MACHINE_BACK.y * easeInOut(a.back) + LANDING.y,
        MACHINE_BACK.z * easeInOut(a.back) + LANDING.z
      );
      g.position.lerpVectors(from, STAGE, r);
      g.position.y -= Math.sin(r * Math.PI) * 0.35; // un arc, pas une ligne
      g.scale.setScalar(1 + r * (CAP_PRESENT - 1));

      // ---- ON LA SECOUE. Le tremblement suit l'énergie du geste, et il n'est
      // PAS régulier : une oscillation propre ferait un métronome. Trois
      // fréquences premières entre elles + un grain aléatoire, et ça devient
      // un objet qu'on agite.
      const s = a.rattle;
      g.rotation.set(
        Math.sin(t * 37) * 0.3 * s + (Math.random() - 0.5) * 0.1 * s,
        r * Math.PI * 2.5 + t * 0.35,
        Math.sin(t * 23) * 0.34 * s + (Math.random() - 0.5) * 0.1 * s
      );
      g.position.x += (Math.random() - 0.5) * 0.07 * s;
      g.position.y += (Math.random() - 0.5) * 0.07 * s + Math.sin(t * 1.6) * 0.02;
    }

    // ---- LA COUTURE CHAUFFE, PUIS ELLE MEURT. À mesure qu'on secoue, la ligne
    // de jointure s'allume : la lumière du dedans cherche à sortir, et c'est
    // ELLE la jauge — rien à lire pour savoir qu'on y est presque.
    //
    // Elle DISPARAÎT à l'ouverture, et vite. Elle restait allumée à pleine
    // intensité une fois la capsule ouverte : l'anneau lumineux flottait alors
    // autour du boîtier comme un élastique oublié là.
    if (seam.current) {
      const glow = a.crack > 0 ? Math.max(0, 1 - a.crack * 5) : a.rattle;
      seam.current.visible = glow > 0.01;
      seam.current.material.opacity = Math.min(1, glow);
      seam.current.scale.setScalar(1 + glow * 0.06);
    }

    // ---- L'OUVERTURE. Les deux moitiés s'écartent, basculent et partent
    // chacune de leur côté en tournant. Elles ne disparaissent pas : elles
    // sortent du cadre, ce qu'elles feraient vraiment.
    // ---- ELLE SE FORME DANS LE VERRE. Le premier point du trajet est à
    // l'intérieur de la sphère, au milieu du tas : sans ce fondu, on verrait la
    // capsule APPARAÎTRE parmi les bonbons au moment où le tour s'achève. Elle
    // monte donc en opacité sur le premier dixième de la chute — le temps qu'il
    // faut pour franchir la bouche, et pas une image de plus.
    const born = clamp01(a.fall / 0.1);
    const c = easeOut(a.crack);
    if (top.current && bot.current) {
      // Le fondu est RELATIF à l'opacité de chaque moitié, pas absolu : le
      // couvercle est dépoli (0,4), et lui écrire « 1 » au début de l'ouverture
      // le rendait brusquement opaque — la capsule se refermait à l'instant
      // précis où elle était censée s'ouvrir.
      const fade = (1 - clamp01((c - 0.5) / 0.5)) * born;
      top.current.position.y = c * 1.7;
      top.current.position.x = -c * 0.8;
      top.current.rotation.z = c * 2.6;
      top.current.material.opacity = TOP_ALPHA * fade;
      bot.current.position.y = -c * 1.35;
      bot.current.position.x = c * 0.85;
      bot.current.rotation.z = -c * 2.2;
      bot.current.material.opacity = fade;
    }
    // La brume et la lueur n'appartiennent qu'à la boule FERMÉE : elles
    // resteraient sinon suspendues entre les deux coquilles qui s'écartent.
    // Elles attendent aussi qu'elle soit née — une lueur additive ne se fond
    // pas, elle est là ou elle n'y est pas.
    if (haze.current) haze.current.visible = a.crack < 0.05 && born > 0.9;
    if (lit.current) lit.current.visible = a.crack < 0.05 && born > 0.9;
  });

  return (
    <group ref={group} visible={false}>
      {/* LE COUVERCLE — dépoli. Rugueux et à peine opaque : on voit qu'il y a
          quelque chose dedans, jamais quoi. `depthWrite` désactivé pour qu'il
          ne cache pas ce qu'il est justement censé laisser deviner. */}
      <mesh ref={top}>
        <sphereGeometry args={[CAP_R, 44, 22, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial
          color={shell.frost}
          transparent
          opacity={TOP_ALPHA}
          roughness={0.62}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.35}
          envMapIntensity={1.6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* La brume : une coque de plus, presque rien, juste sous le couvercle.
          C'est elle qui « remplit » le vide et empêche l'œil de faire le point
          sur la forme noire — sans elle, le dépoli ne fait que teinter. */}
      <mesh ref={haze}>
        <sphereGeometry args={[CAP_R * 0.9, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        <meshBasicMaterial
          color={shell.frost}
          transparent
          opacity={0.16}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* LE FOND — plastique plein, saturé. C'est lui qui donne sa couleur à la
          boule, et c'est sur lui que se lit la lumière du studio. */}
      <mesh ref={bot}>
        <sphereGeometry args={[CAP_R, 44, 22, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
        <meshPhysicalMaterial
          color={shell.base}
          transparent
          opacity={1}
          roughness={0.13}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.06}
          envMapIntensity={2.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* La lueur ne survit pas à l'ouverture : c'est le vrai boîtier qu'on
          regarde ensuite, et l'éclat prend le relais. */}
      <group ref={lit}>
        <Ember glow={glow} color={shell.frost} />
      </group>

      {/* La couture lumineuse, à l'équateur. */}
      <mesh ref={seam} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[CAP_R * 1.005, 0.016, 8, 56]} />
        <meshBasicMaterial
          color="#fff6dc"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ============================================================
//  L'éclat
// ============================================================
// Un éclair, deux ondes qui s'ouvrent à des vitesses différentes, une couronne
// de rais qui tourne, et cent quarante éclats qui retombent. Tout en additif :
// ça n'assombrit jamais rien, ça n'ajoute que de la lumière.
const SPARKS = 140;

function Burst({ tint, anim }) {
  const flash = useRef(null);
  const rays = useRef(null);
  const ringA = useRef(null);
  const ringB = useRef(null);
  const points = useRef(null);
  const glow = useGlow();
  const star = useStar();

  const { geometry, dirs } = useMemo(() => {
    const list = [];
    const pos = new Float32Array(SPARKS * 3);
    for (let i = 0; i < SPARKS; i++) {
      const y = 1 - (2 * (i + 0.5)) / SPARKS;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * Math.PI * (3 - Math.sqrt(5));
      list.push(
        new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad).multiplyScalar(
          0.6 + Math.random() * 1.1
        )
      );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry: geo, dirs: list };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const c = anim.current.crack;
    const on = c > 0.001;
    const t = state.clock.elapsedTime;

    if (flash.current) {
      flash.current.visible = on;
      // Un éclair, c'est-à-dire quelque chose de TRÈS bref : monté en 10 % du
      // temps de l'ouverture, éteint bien avant la fin.
      const f = c < 0.1 ? c / 0.1 : Math.max(0, 1 - (c - 0.1) / 0.34);
      flash.current.material.opacity = f;
      flash.current.scale.setScalar(0.5 + easeOut(clamp01(c / 0.45)) * 7);
      flash.current.position.copy(STAGE);
    }
    // LES RAIS, ET ILS RESTENT DERRIÈRE. Ils tournent lentement et tiennent
    // après l'éclair — c'est ce qui fait qu'on regarde encore.
    //
    // Posés EN RETRAIT de la scène de présentation, pas dessus. Une image de
    // ce genre est un panneau tourné vers la caméra : centré sur l'objet, sa
    // profondeur valait celle de l'objet, et le test de profondeur laissait
    // donc passer les rais PAR-DESSUS le boîtier chaque fois qu'un de ses coins
    // reculait en tournant. Un mètre en arrière, la question ne se pose plus :
    // le boîtier les masque toujours, et ils rayonnent autour de lui.
    if (rays.current) {
      rays.current.visible = on;
      const r = easeOut(clamp01(c / 0.55));
      rays.current.material.opacity = r * Math.max(0, 1 - (c - 0.5) / 0.9) * 0.7;
      rays.current.scale.setScalar(1.2 + r * 4.6);
      rays.current.material.rotation = t * 0.14;
      rays.current.position.set(STAGE.x, STAGE.y, STAGE.z - 1);
    }
    for (const [ref, speed, width] of [
      [ringA, 0.6, 0.5],
      [ringB, 1.0, 0.85],
    ]) {
      const m = ref.current;
      if (!m) continue;
      m.visible = on;
      const r = easeOut(clamp01(c / speed));
      m.scale.setScalar(0.2 + r * 5.4 * width);
      m.material.opacity = (1 - r) * 0.5;
      m.position.copy(STAGE);
    }
    if (points.current) {
      points.current.visible = on;
      const p = easeOut(c);
      const arr = points.current.geometry.attributes.position;
      for (let i = 0; i < SPARKS; i++) {
        const d = dirs[i];
        arr.setXYZ(
          i,
          STAGE.x + d.x * p * 2.6,
          // Les éclats retombent : sans gravité c'est un feu d'artifice de
          // synthèse, avec elle c'est de la matière projetée.
          STAGE.y + d.y * p * 2.6 - p * p * 1.1,
          STAGE.z + d.z * p * 2.6
        );
      }
      arr.needsUpdate = true;
      points.current.material.opacity = Math.max(0, 1 - c * 1.2);
      points.current.material.size = 0.08 * (1 - c * 0.5);
    }
  });

  const additive = {
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  };

  return (
    <group>
      <sprite ref={rays} visible={false}>
        <spriteMaterial map={star} color={tint || "#ffffff"} {...additive} />
      </sprite>
      <sprite ref={flash} visible={false}>
        <spriteMaterial map={glow} color="#ffffff" {...additive} />
      </sprite>
      <mesh ref={ringA} visible={false}>
        <ringGeometry args={[0.44, 0.5, 64]} />
        <meshBasicMaterial color={tint || "#ffffff"} side={THREE.DoubleSide} {...additive} />
      </mesh>
      <mesh ref={ringB} visible={false}>
        <ringGeometry args={[0.47, 0.49, 64]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} {...additive} />
      </mesh>
      <points ref={points} geometry={geometry} visible={false}>
        <pointsMaterial
          color={tint || "#ffffff"}
          size={0.08}
          map={glow}
          sizeAttenuation
          {...additive}
        />
      </points>
    </group>
  );
}

// Les deux images peintes une fois pour toute l'application : le halo (éclair
// et grain d'étincelle) et la couronne de rais.
let glowTex = null;
function useGlow() {
  return useMemo(() => {
    if (glowTex) return glowTex;
    // 256 plutôt que 128 : l'éclair est étiré sur sept unités de scène, et un
    // dégradé trop petit y montre ses paliers.
    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.18, "rgba(255,255,255,0.82)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.minFilter = THREE.LinearMipmapLinearFilter;
    glowTex.magFilter = THREE.LinearFilter;
    return glowTex;
  }, []);
}

// LA COURONNE DE RAIS. Peinte en 1024 et non en 256 : elle est étirée sur cinq
// unités de scène, c'est-à-dire la moitié de l'écran — à 256 chaque pixel de
// l'image en couvrait quatre, et les bords des rais crénelaient franchement.
//
// Et des rais FLOUS plutôt que des triangles nets : chacun est tracé au pinceau
// (un trait épais adouci par `shadowBlur`) au lieu d'être un polygone. Un
// triangle a deux arêtes droites qui se voient toujours, si fin soit-il ; un
// trait estompé n'a pas d'arête du tout, et c'est ce qui fait la différence
// entre « de la lumière » et « une roue dentée ».
let starTex = null;
function useStar() {
  return useMemo(() => {
    if (starTex) return starTex;
    const S = 1024;
    const R = S / 2;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    g.translate(R, R);
    g.lineCap = "round";
    g.shadowColor = "rgba(255,255,255,0.75)";

    // Longueurs et épaisseurs irrégulières : des rais tous identiques se lisent
    // comme un motif imprimé, jamais comme un éclat.
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (i % 2) * 0.03;
      const len = R * (0.5 + ((i * 7) % 5) * 0.1);
      const wide = 3 + ((i * 3) % 4) * 5;
      const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      grad.addColorStop(0, "rgba(255,255,255,0.85)");
      grad.addColorStop(0.28, "rgba(255,255,255,0.42)");
      grad.addColorStop(0.7, "rgba(255,255,255,0.1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.strokeStyle = grad;
      g.lineWidth = wide;
      g.shadowBlur = wide * 2.4;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.stroke();
    }

    // Le cœur, pour que les rais partent de quelque chose plutôt que du vide.
    g.shadowBlur = 0;
    const core = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.3);
    core.addColorStop(0, "rgba(255,255,255,0.7)");
    core.addColorStop(0.4, "rgba(255,255,255,0.22)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.fillRect(-R, -R, S, S);

    starTex = new THREE.CanvasTexture(c);
    starTex.anisotropy = 8;
    starTex.minFilter = THREE.LinearMipmapLinearFilter;
    starTex.magFilter = THREE.LinearFilter;
    starTex.generateMipmaps = true;
    return starTex;
  }, []);
}

// ============================================================
//  Le boîtier, à l'intérieur
// ============================================================
// C'EST LE MÊME OBJET QUE SUR L'ÉTAGÈRE — même coque, même papier, même dos de
// volume (voir CaseObject.jsx). Une vignette ou un rendu « spécial gacha »
// aurait fait mentir la machine : on aurait gagné une image, et découvert
// l'objet ailleurs, plus tard.
function Prize({ media, anim, onSettled }) {
  const group = useRef(null);
  const [art, setArt] = useState(null);
  const paper = useCasePaper(art);
  const told = useRef(false);
  const face = useMemo(() => (isRtl(media) ? Math.PI : 0), [media]);
  const box = useMemo(() => boxOf(media), [media]);

  // HAUTE DÉFINITION : l'objet occupe tout le cadre et se laisse zoomer, la
  // feuille du rayon (640) y baverait. Le magasin la garde pour la session.
  useEffect(() => {
    let alive = true;
    setArt(null);
    caseArt(media, HI_QUALITY)
      .then((a) => alive && setArt(a))
      .catch(() => {
        /* jaquette impeignable : la coque nue vaut mieux qu'un trou */
      });
    return () => {
      alive = false;
    };
  }, [media]);

  useFrame((state, raw) => {
    const g = group.current;
    if (!g) return;
    const a = anim.current;
    const dt = Math.min(raw, 0.05);
    const c = a.crack;
    g.visible = c > 0.02;
    if (!g.visible) return;

    g.position.copy(STAGE);
    g.position.y += Math.sin(state.clock.elapsedTime * 1.3) * 0.03;

    // LA SORTIE, AVEC UN DÉPASSEMENT. Il grandit depuis l'intérieur de la
    // capsule, franchit un peu sa taille finale puis y revient : ce petit
    // rebond est ce qui fait « surgir » au lieu de « grandir ».
    const out = easeOut(clamp01((c - 0.06) / 0.7));
    const overshoot = Math.sin(clamp01((c - 0.06) / 0.9) * Math.PI) * 0.12;
    g.scale.setScalar((0.1 + out * 0.9 + overshoot) * a.zoomView);

    if (a.free) {
      // EN MAIN. Le présentoir tourne tout seul tant qu'on n'y touche pas ;
      // dès qu'on l'attrape il obéit, et ne repart qu'après un temps.
      if (performance.now() - a.touched > 2400) {
        a.spinY += dt * 0.4;
        a.spinX += (-0.06 - a.spinX) * Math.min(1, dt * 2.5);
      }
      a.zoomView += (a.zoom - a.zoomView) * Math.min(1, dt * 8);
    } else {
      // PENDANT LA SORTIE : deux tours et demi, qui se posent pile sur la face
      // de présentation.
      a.spinY = face + (1 - out) * Math.PI * 5;
      a.spinX = (1 - out) * 0.5 - 0.06;
      if (out >= 1 && !told.current) {
        told.current = true;
        a.free = true;
        a.touched = performance.now() - 3000; // il repart tourner tout de suite
        onSettled?.();
      }
    }

    g.rotation.y = -Math.PI / 2 + a.spinY;
    g.rotation.x = a.spinX;
  });

  return (
    <group ref={group} visible={false}>
      <CaseModel media={media} box={box} paper={paper} cuts={art?.cuts} />
    </group>
  );
}

// ============================================================
//  L'horloge
// ============================================================
// UN SEUL ENDROIT FAIT AVANCER LE TEMPS, et toutes les pièces y lisent. Les
// avancements se CHEVAUCHENT volontairement (la machine recule pendant que la
// boule monte, l'objet grandit pendant que les coquilles s'écartent) : c'est
// ce recouvrement qui fait une scène plutôt qu'un diaporama.
const PHASES = ["idle", "cranking", "falling", "rising", "waiting", "cracking", "revealed"];

function Clock({ phase, anim }) {
  useFrame((_, raw) => {
    const a = anim.current;
    const dt = Math.min(raw, 0.05);
    const to = (v, target, secs) =>
      target > v ? Math.min(target, v + dt / secs) : Math.max(target, v - dt / secs);
    const after = (p) => PHASES.indexOf(phase) >= PHASES.indexOf(p);

    // `crank` n'est PLUS piloté par le temps : c'est la main qui le fait
    // avancer (voir `Orb`). L'horloge se contente de le remettre à zéro quand
    // la sphère n'est pas manœuvrable.
    if (!after("cranking")) a.crank = 0;
    // La secousse ne dure qu'un instant, au moment où le rochet lâche.
    a.shake = Math.max(0, a.shake - dt * 3.2);
    a.capsule = after("cranking") ? 1 : 0;
    a.fall = after("falling") ? to(a.fall, 1, 1.25) : 0;
    a.rise = after("rising") ? to(a.rise, 1, 0.7) : 0;
    // La machine commence à reculer DÈS que la boule monte : les deux gestes
    // n'en font qu'un, c'est le regard qui change de sujet.
    a.back = after("rising") ? to(a.back, 1, 0.9) : to(a.back, 0, 0.7);
    a.crack = after("cracking") ? to(a.crack, 1, 0.9) : 0;
    // L'énergie du secouage retombe toute seule : arrêter de bouger, c'est
    // laisser la boule se calmer. C'est ce qui fait qu'il faut SECOUER et pas
    // seulement bouger un peu. Le couple (gain par pixel, cette fuite) fixe la
    // durée de l'épreuve — comptée pour environ cinq secondes d'agitation
    // franche, voir GachaModal.
    if (phase === "waiting") a.rattle = Math.max(0, a.rattle - dt * 0.3);
  });
  return null;
}

// ============================================================
//  L'éclairage
// ============================================================
// UN STUDIO, pas un plafonnier. L'environnement est bâti sur place avec des
// panneaux lumineux (aucun HDR à télécharger, rien qui puisse manquer hors
// ligne) : c'est LUI qui donne au verre ses reflets courbes, au chrome sa
// brillance et à la laque sa profondeur. Sans lui, la machine est en plastique
// de synthèse.
// L'ÉCLAIRAGE DE L'OUVERTURE. La scène était réglée pour la machine — bien pour
// du chrome et de la laque, trop plat pour un objet qui surgit d'une explosion
// de lumière. Trois sources s'allument le temps de la révélation :
//
//   • LE COUP. Un flash violent au centre, qui retombe en une demi-seconde :
//     c'est lui qui fait sursauter, et il éclaire tout ce qui l'entoure (les
//     éclats, les coquilles qui s'écartent, la machine au fond).
//   • LA CLÉ. Une lampe chaude qui reste allumée sur le boîtier, en avant et
//     un peu au-dessus — sans elle il est présenté dans le noir.
//   • LE CONTRE. Une lumière froide derrière lui, qui détache sa silhouette du
//     fond sombre. C'est ce qui manquait le plus : un objet sans contre-jour
//     se confond avec l'arrière-plan quel que soit l'éclairage de face.
function RevealLight({ anim, tint }) {
  const burst = useRef(null);
  const key = useRef(null);
  const rim = useRef(null);

  useFrame(() => {
    const c = anim.current.crack;
    const on = c > 0.005;
    // Le coup : instantané, puis extinction en un tiers de l'ouverture.
    const hit = Math.max(0, 1 - c * 3.2);
    if (burst.current) {
      burst.current.visible = on;
      burst.current.intensity = on ? hit * 26 : 0;
    }
    // La clé et le contre montent avec l'objet et RESTENT.
    const held = Math.min(1, c * 2.2);
    if (key.current) {
      key.current.visible = on;
      key.current.intensity = held * 2.6;
    }
    if (rim.current) {
      rim.current.visible = on;
      rim.current.intensity = held * 3.4;
    }
  });

  return (
    <>
      <pointLight
        ref={burst}
        position={STAGE}
        color="#fff4de"
        distance={12}
        decay={2}
        intensity={0}
        visible={false}
      />
      <pointLight
        ref={key}
        position={[STAGE.x + 1.1, STAGE.y + 1.3, STAGE.z + 1.8]}
        color="#fff0d6"
        distance={9}
        decay={2}
        intensity={0}
        visible={false}
      />
      <pointLight
        ref={rim}
        position={[STAGE.x - 0.9, STAGE.y + 0.4, STAGE.z - 1.6]}
        color={tint || "#9ec6ff"}
        distance={7}
        decay={2}
        intensity={0}
        visible={false}
      />
    </>
  );
}

// DEUX COULEURS QUI S'OPPOSENT, ET C'EST ÇA LE « RENDU DE JEU ». L'éclairage
// d'avant était un studio blanc : correct pour du chrome, mortellement neutre
// pour une bulle de bonbons. Ici une clé ROSE en haut à droite, un contre CYAN
// en bas à gauche — c'est le partage chaud/froid qui décolle la silhouette du
// fond noir et donne au verre ses deux liserés colorés. Sans lui, aucune
// quantité de halo ne sauve l'image.
function Rig() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3.2, 5, 4]} intensity={1.7} color="#ffe6f2" castShadow />
      <directionalLight position={[-4.5, 1.2, 2.4]} intensity={0.9} color="#8fd4ff" />
      <directionalLight position={[0, -1.6, -4]} intensity={1.1} color="#ff9ec8" />
      <Environment resolution={256}>
        {/* Le grand diffuseur du dessus : c'est lui qui pose la brillance
            allongée sur le haut de la bulle. */}
        <Lightformer form="rect" intensity={3.6} position={[0, 4.5, 2]} scale={[9, 4, 1]} />
        <Lightformer
          form="rect"
          intensity={2.2}
          position={[-5, 1, 1]}
          scale={[4, 7, 1]}
          rotation={[0, Math.PI / 2, 0]}
          color="#a9dcff"
        />
        <Lightformer
          form="rect"
          intensity={2}
          position={[5, 0.5, -1]}
          scale={[4, 7, 1]}
          rotation={[0, -Math.PI / 2, 0]}
          color="#ffc0dd"
        />
        {/* L'anneau de face : le reflet circulaire dans le verre, celui qu'on
            voit sur toutes les bulles de vitrine. */}
        <Lightformer form="ring" intensity={3} position={[0, 0.8, 5]} scale={3.6} color="#fff0d2" />
      </Environment>
    </>
  );
}

function Fit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    // Sur un écran étroit (téléphone en portrait), c'est la LARGEUR qui borne :
    // on recule pour que la machine tienne entière plutôt que de la rogner.
    // Le recul est posé AVANT le cadrage — viser puis reculer laisserait la
    // caméra pointée pour l'ancienne distance, donc un peu trop haut.
    const aspect = size.width / Math.max(1, size.height);
    const pull = aspect < NARROW ? (NARROW - aspect) * NARROW_PULL : 0;
    camera.position.set(EYE[0], EYE[1], EYE[2] + pull);
    camera.lookAt(...LOOK);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function GachaScene({
  phase,
  balls,
  won,
  hue,
  onSettled,
  onNotch,
  onRelease,
  anim,
}) {
  const drag = useRef({ down: false, x: 0, y: 0 });
  // L'éclat prend la couleur du BOÎTIER (c'est lui qu'on célèbre) ; la capsule,
  // elle, a sa propre teinte tirée au sort — elle ne doit rien annoncer.
  const tint = won?.color || "#f2b70b";

  // Attraper l'objet pour le retourner — seulement une fois qu'il est libre.
  // Pendant l'attente, le même geste SECOUE : c'est la modale qui l'écoute
  // (elle seule connaît le seuil et le bruitage du contenu).
  function down(e) {
    if (!anim.current.free) return;
    drag.current = { down: true, x: e.clientX, y: e.clientY };
    anim.current.touched = performance.now();
  }
  function move(e) {
    const d = drag.current;
    if (!d.down || !anim.current.free) return;
    const a = anim.current;
    a.spinY += (e.clientX - d.x) * 0.012;
    a.spinX = Math.max(-0.7, Math.min(0.7, a.spinX + (e.clientY - d.y) * 0.009));
    d.x = e.clientX;
    d.y = e.clientY;
    a.touched = performance.now();
  }
  const up = () => {
    drag.current.down = false;
  };
  function wheel(e) {
    const a = anim.current;
    if (!a.free) return;
    a.zoom = Math.max(0.65, Math.min(2.2, a.zoom - Math.sign(e.deltaY) * 0.12));
    a.touched = performance.now();
  }

  return (
    <Canvas
      className="gch-canvas"
      dpr={[1, 1.9]}
      shadows
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: FOV, position: EYE }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      onWheel={wheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Fit />
      <Clock phase={phase} anim={anim} />
      <Rig />

      <Machine
        balls={balls}
        anim={anim}
        armed={phase === "cranking"}
        onNotch={onNotch}
        onRelease={onRelease}
      />
      <Capsule hue={hue} anim={anim} />
      <RevealLight anim={anim} tint={tint} />
      <Burst tint={tint} anim={anim} />
      {/* `key` : chaque lot est un NOUVEAU présentoir. Sans lui le composant
          survivait d'un tirage à l'autre avec son drapeau « posé » déjà levé —
          le deuxième boîtier ne devenait jamais manipulable et son nom ne
          s'affichait plus. */}
      {won && <Prize key={won.slug} media={won} anim={anim} onSettled={onSettled} />}
    </Canvas>
  );
}
