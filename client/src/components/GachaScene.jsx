import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, ContactShadows, Sparkles, useGLTF } from "@react-three/drei";
import { boxOf, isRtl } from "../lib/collection";
import { caseArt, HI_QUALITY } from "../lib/caseTextures";
import { CaseModel, useCasePaper } from "./CaseObject";

// ======================================================================
//  La caisse — une lootbox, pas une sphère
// ======================================================================
// LA SPHÈRE EST MORTE. Une boule de verre pleine de boules, ça décrivait bien
// une machine à capsules et ça ne procurait rien : on regardait un bocal, on
// payait, un pois en sortait par un trou. Le plaisir d'un tirage ne vient pas
// du récipient, il vient de la RUPTURE — quelque chose de fermé, lourd, qui
// tremble, qui cède d'un coup et qui crache de la lumière.
//
// D'OÙ LA CAISSE, ET C'EST UNE VRAIE — le modèle CS:GO de `public/`, pas une
// boîte à angles arrondis bâtie à la main. Celle-là avait le défaut de tout ce
// qu'on modélise en trois primitives : elle était juste, et elle était moche.
// Le modèle apporte ses charnières, ses ferrures, son loquet et ses textures,
// et il arrive DÉJÀ ENTREBÂILLÉ (son couvercle est posé à 30° dans le fichier,
// voir `useCaseModel`) — ce qui est exactement la pose qu'on voulait : la
// caisse est pleine à ras bord, et ça se voit par la fente.
//
// Elle flotte au centre de l'écran. On l'ATTRAPE pour la tourner, on la
// CLIQUE pour l'ouvrir, et les deux ne se confondent pas : un glissé fait
// pivoter, un clic net paie et déclenche. Au survol elle frissonne — c'est ce
// frisson, et rien d'autre, qui dit qu'elle est cliquable.
//
// Ensuite : elle encaisse le coup, elle tremble de plus en plus fort, sa fente
// chauffe jusqu'au blanc — puis le couvercle s'ouvre en grand, une colonne de
// lumière monte, et la caisse crache ses boules par dizaines. C'est le geste
// d'Overwatch, et il tient en trois temps que n'importe qui reconnaît : ça
// charge, ça claque, ça retombe.
//
// ET UNE SEULE BOULE COMPTE. Le reste de la volée retombe hors cadre en une
// seconde ; celle-là est projetée vers l'œil, grossit, et vient se tenir au
// milieu de l'écran. C'est elle qu'on secoue, c'est elle qui s'ouvre, c'est
// elle qui contient le boîtier. Les autres n'étaient là que pour dire « il y
// en avait plein, tu as eu celle-ci ».
//
// CE QUI A ÉTÉ RETIRÉ, ET POURQUOI (c'est la moitié du travail) :
//   • LA LUMIÈRE DANS LA BOULE. Deux sprites additifs plus une coque de brume
//     à l'intérieur d'une capsule translucide : trois surfaces transparentes
//     l'une derrière l'autre, triées à chaque image, sur l'objet le plus gros
//     de l'écran. Ça ramait, et pour rien — la lueur est désormais AUTOUR,
//     posée derrière la boule : le plastique opaque en masque le cœur et il
//     n'en reste qu'un halo qui déborde de la silhouette. C'est ce qu'on
//     voulait voir, et ça coûte un sprite.
//   • LA PASSE D'OMBRES. Le rendu portait une carte d'ombre complète pour une
//     ombre qu'on ne voyait pas : les ombres de contact (leur propre cible)
//     posent l'objet à elles seules.
//   • LE TAS RELAXÉ. Cent vingt boules démêlées par un solveur en n² à chaque
//     ouverture de la modale. Les boules sont maintenant rangées dans une
//     grille secouée au hasard : c'est un décor au fond d'une caisse, personne
//     n'ira vérifier qu'aucune ne se chevauche.

const FOV = 32;
// CADRAGE. La caisse fait 1,62 de large et se tient au centre ; l'objet
// présenté, lui, vient bien plus près de l'œil (voir STAGE). Le point visé est
// SOUS le centre de la caisse : viser haut la fait descendre dans l'image, et
// le bas de l'écran appartient au bouton et aux invites.
const EYE = [0, 0.85, 6.4];
const LOOK = [0, 0.42, 0];

// LE RECUL DES ÉCRANS ÉTROITS : en dessous de ce rapport c'est la LARGEUR qui
// borne, et la caisse sortirait du cadre par les côtés sur un téléphone tenu
// debout.
const NARROW = 0.95;
const NARROW_PULL = 3.9;

// Où la caisse se tient, et où elle recule quand la boule prend la vedette.
const CRATE_HOME = { y: 0, z: 0, s: 1 };
const CRATE_BACK = { y: -0.95, z: -2.3, s: 0.58 };

// LA SCÈNE DE PRÉSENTATION — et elle a été RAPPROCHÉE. L'objet gagné se
// regardait de loin, à 3,4 unités de l'œil : il tenait sur 60 % de la hauteur,
// c'est-à-dire à peu près la taille d'une vignette. Il est maintenant à 2,9,
// où il occupe presque toute l'image — le cadrage de la vitrine de l'étagère,
// puisque c'est exactement le même geste : on tient l'objet et on le regarde.
//
// `y` est posé un cheveu AU-DESSUS du rayon qui passe par le centre de l'écran
// (0,655 à cette distance) : un objet exactement centré paraît toujours un peu
// bas, et surtout la carte du titre vient se ranger dessous.
const STAGE = new THREE.Vector3(0, 0.78, 3.5);

// LA CAISSE. Ses proportions ne sont PAS choisies : ce sont celles du modèle,
// mesurées dans le fichier (3,2888 × 1,6262 × 2,1153) et ramenées à une largeur
// qui tient dans le cadre. Les écrire en dur serait la garantie que la doublure
// intérieure, le tas de boules et le liseré de la fente flottent à côté de la
// caisse qu'ils sont censés habiller.
const CASE_URL = "/csgo_case.glb";
// Le fichier fait 4,7 Mo : on le demande dès que ce morceau de code est chargé
// (c'est-à-dire quand on ouvre la modale), sans attendre le premier rendu.
useGLTF.preload(CASE_URL);

const MODEL_SIZE = { w: 3.2888, h: 1.6262, d: 2.1153 };
// La largeur imposée au modèle. 1,85 et non 2,3 : à 2,3 la caisse mangeait le
// tiers de l'écran et paraissait posée sur l'objectif — une caisse doit tenir
// dans la main du regard, pas remplir le cadre.
const BOX_W = 1.85;
const BOX_H = (BOX_W * MODEL_SIZE.h) / MODEL_SIZE.w;
const BOX_D = (BOX_W * MODEL_SIZE.d) / MODEL_SIZE.w;
// À quelle hauteur elle flotte — et elle est posée SUR LE RAYON DE VISÉE
// (l'œil est à 0,85 et regarde 0,42 : à z = 0 le centre de l'image est
// exactement à 0,42). Elle était à 0,55, c'est-à-dire un huitième de hauteur
// d'écran au-dessus du centre : assez peu pour qu'on n'en accuse pas le
// réglage, assez pour que toute l'image paraisse déséquilibrée.
//
// Son fond reste à un demi-mètre du sol : c'est cet écart-là qui fait lire la
// lévitation (voir `Floor`, dont l'ombre et le halo se posent à FLOOR − BOX_Y,
// sous le groupe de la caisse).
const BOX_Y = 0.42;

// LA FENTE : la ligne où le couvercle s'articule, c'est-à-dire le haut du
// corps. Tout ce qui doit avoir l'air de sortir de la caisse part de là.
const RIM = BOX_H / 2;
// LE VOLUME QU'ON A LE DROIT DE REMPLIR, et il est nettement plus petit que la
// caisse. On ne connaît pas la forme exacte de la cavité du modèle : ses parois
// sont épaisses, ses angles sont congés, et elle se resserre vers le fond. Une
// doublure et un tas réglés sur l'ENCOMBREMENT extérieur en sortaient — d'où
// les boules qu'on voyait dépasser sur les côtés, et c'est le genre de défaut
// qui casse l'objet d'un coup d'œil.
//
// Ces trois fractions sont donc des marges de sécurité, pas des mesures : on
// range le tas bien à l'intérieur, quitte à ce qu'il paraisse un rien plus
// étroit que l'ouverture. Un tas légèrement trop petit ne se remarque pas ;
// une boule qui traverse une paroi, si.
const IN_W = BOX_W * 0.84;
const IN_D = BOX_D * 0.76;
const IN_H = BOX_H * 0.8;
// Le couvercle grand ouvert, en plus de sa pose d'origine. 1,85 rad de plus que
// les 30° du fichier, soit ~136° : une caisse qui s'ouvre à plat se referme
// visuellement (on ne voit plus que le fond), celle-ci reste un objet.
const LID_SWING = 1.85;
// L'OUVERTURE AU REPOS — et c'est une FENTE, pas un bâillement. Le fichier
// livre le couvercle à 30°, ce qui montrait tout le tas de face : une caisse
// dont on voit déjà le contenu n'a plus rien à ouvrir. À 0,12 rad (7°) il ne
// reste qu'un jour entre le couvercle et le corps — juste de quoi voir que ça
// déborde.
//
// CETTE VALEUR N'EST PAS QUE DÉCORATIVE : c'est elle qui dit jusqu'où les
// boules ont le droit de dépasser sans traverser le couvercle (voir `pileSeats`
// et `LID_SLOPE`). En la changeant, on change la hauteur du tas.
const LID_GAP = 0.12;
// La pente du couvercle entrouvert, au-dessus du plan de la fente : il est
// articulé au bord ARRIÈRE, donc le jour s'ouvre en biais et il n'y a de place
// pour déborder que vers l'avant.
const LID_SLOPE = Math.sin(LID_GAP);

// L'ASSIETTE AU REPOS. La caisse ne se tient pas parfaitement à plat : elle
// pique du nez de quatre degrés, comme un objet qu'on tiendrait devant soi.
// C'est peu, et c'est ce peu qui fait la différence entre un objet et une
// maquette posée sur un présentoir. (Positif = l'avant descend : une rotation
// autour de X envoie +Z vers le bas.)
const TILT_REST = 0.07;

// LE SOL. Rien ne s'y pose — la caisse flotte — mais il existe : c'est là que
// se peint l'ombre et là que s'étale le halo. Les deux doivent lire le même
// plan.
const FLOOR = -0.52;

const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// ============================================================
//  Les couleurs
// ============================================================
// UNE PALETTE CHOISIE, PAS LA ROUE DES TEINTES. Répartir les boules sur les
// 360° du cercle donne un tas terne : un sixième du cercle est occupé par des
// olives et des kakis, qui sont des couleurs très bien mais qui ne sont pas des
// couleurs de JOUET. Ces douze-là sont franches et saturées.
const CANDY = [340, 12, 28, 45, 62, 96, 152, 176, 196, 218, 262, 300];

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const candyHue = (s) => CANDY[hashOf(s) % CANDY.length];

// La lumière de la caisse : l'or de l'accent du site, et son blanc chaud quand
// elle chauffe. La caisse, elle, n'a plus de couleur à nous — c'est le modèle
// qui la porte, avec ses propres textures.
const GOLD = "#f2b70b";
const GOLD_HOT = "#fff3c4";
const COLD_SEAM = new THREE.Color(GOLD);
const HOT_SEAM = new THREE.Color(GOLD_HOT);

// ============================================================
//  Le tas, au fond de la caisse
// ============================================================
// PLEINE À RAS BORD, TOUJOURS. C'est ce qu'on doit lire par la fente, et c'est
// pour ça que le RAYON DES BOULES SUIT LEUR NOMBRE : quarante grosses ou cent
// vingt petites, la caisse est pleine dans les deux cas. Sans ça, une
// collection presque complète donnerait une caisse aux trois quarts vide —
// ce qui est exact, et ce qui donne surtout l'impression d'un décor raté.
// Le tas baisse quand même à la toute fin (le rayon est borné), et c'est bien :
// les dernières boules roulent au fond.
//
// Une grille secouée au hasard, pas un solveur : la pile est vue par une fente,
// ce qu'on doit en lire c'est « il y en a plein », jamais « il en reste dix-sept ».
const PILE_MAX = 120;
// Le volume intérieur qu'on veut occuper. À 0,55 les boules se pressent sans
// qu'on voie le fond ; au-delà elles ont l'air de se traverser.
const FILL = 0.55;

function pileSeats(balls) {
  const left = balls.filter((b) => !b.owned).slice(0, PILE_MAX);
  const n = left.length;
  if (!n) return { seats: [], r: 0 };

  const iw = IN_W;
  const id = IN_D;
  const ih = IN_H;
  // Le rayon qui remplit la caisse avec CE nombre de boules, borné des deux
  // côtés : au-delà ce sont des ballons, en deçà du gravier. Le plafond est
  // aussi une sécurité — une boule ne doit jamais faire plus du tiers de la
  // profondeur utile, sinon la rangée du fond touche celle de devant.
  let r = Math.min(id / 3, Math.cbrt((iw * id * ih * FILL * 3) / (4 * Math.PI * n)));
  // LE VOLUME DIT UNE TAILLE, LA GRILLE DIT SI ELLE TIENT — et c'est la grille
  // qui a le dernier mot. Le calcul par le volume ignore qu'on range les boules
  // en rangées et en couches : à effectif égal il donnait de quoi faire QUATRE
  // couches là où la caisse n'en accepte que trois, et la dernière débordait
  // au-dessus de la fente — des boules en lévitation devant le couvercle. On
  // rétrécit donc jusqu'à ce que le compte y soit.
  const cols = () => Math.max(1, Math.floor(iw / (r * 2)));
  const rows = () => Math.max(1, Math.floor(id / (r * 2)));
  const layers = () => Math.max(1, Math.floor(ih / (r * 1.72)));
  for (let i = 0; i < 30 && r > 0.05; i++) {
    if (cols() * rows() * layers() >= n) break;
    r *= 0.93;
  }
  const nx = cols();
  const nz = rows();
  const ny = layers();
  const ax = nx > 1 ? (iw - r * 2) / (nx - 1) : 0;
  const az = nz > 1 ? (id - r * 2) / (nz - 1) : 0;
  const floor = RIM - ih + r;
  // COMBIEN DE COUCHES SONT RÉELLEMENT OCCUPÉES. On empile désormais PAR LE
  // HAUT : la couche pleine affleure la fente et les suivantes descendent vers
  // le fond. Empilé par le bas, un catalogue à moitié pris donnait un tas tassé
  // au fond d'une caisse — exact, et parfaitement inintéressant à regarder. Par
  // le haut, la caisse déborde toujours, et c'est ça qu'on doit voir par le jour
  // du couvercle.
  const used = Math.max(1, Math.ceil(n / (nx * nz)));

  const seats = left.map((b, i) => {
    const h = hashOf(b.slug);
    // ON REMPLIT LA COUCHE DU HAUT EN PREMIER, et c'est tout le sujet : la
    // dernière couche servie est forcément incomplète (40 boules dans une
    // grille de 15, c'est deux couches pleines et une aux deux tiers), et si
    // c'est celle du dessus, il manque des boules PILE là où on regarde — des
    // trous sur les côtés, en haut, par le jour du couvercle. Servie en
    // premier, la couche du dessus est toujours pleine et c'est la couche du
    // FOND qui est trouée : personne ne la verra jamais.
    const deep = Math.floor(i / (nx * nz));
    const layer = Math.max(0, Math.min(ny - 1, used - 1 - deep));
    const k = i % (nx * nz);
    // Une couche sur deux est décalée d'une demi-case : des boules empilées en
    // colonnes bien droites, ça se voit tout de suite, et ça ne ressemble à
    // rien de versé dans une caisse.
    const shift = layer % 2 ? 0.5 : 0;
    const cx = (k % nx) + shift;
    const cz = Math.floor(k / nx) % nz;
    // Le désordre vient du slug, pas du hasard : la caisse est la même d'une
    // visite à l'autre, ce qui en fait un objet et pas un économiseur d'écran.
    const jx = (((h >> 3) % 100) / 100 - 0.5) * r * 0.45;
    const jz = (((h >> 9) % 100) / 100 - 0.5) * r * 0.45;
    const z = -id / 2 + r + cz * az + jz;
    // LE PLAFOND SUIT LE COUVERCLE. Il est articulé au bord arrière : le jour
    // est nul contre la charnière et maximal à l'avant. Une boule a donc le
    // droit de dépasser d'autant plus qu'elle est près de la façade — c'est
    // exactement là qu'on la voit, et nulle part elle ne traverse le
    // couvercle.
    // La marge se compte SUR LE HAUT DE LA BOULE (donc un rayon entier, plus
    // un cheveu), et le couvercle a une lèvre qui descend un peu sous le plan
    // de la fente : d'où les trois centièmes. Résultat : la boule de devant
    // effleure le couvercle par en dessous et déborde du corps — la caisse ne
    // ferme plus parce qu'elle est trop pleine, ce qui est exactement l'histoire
    // qu'on veut raconter.
    const ceil = RIM - 0.03 + (z + BOX_D / 2) * LID_SLOPE - r * 1.05;
    const y = Math.min(
      ceil - (used - 1 - layer) * r * 1.72 + (((h >> 15) % 40) / 100) * r * 0.25,
      ceil
    );
    return {
      slug: b.slug,
      pos: new THREE.Vector3(
        -iw / 2 + r + Math.min(cx, nx - 1) * ax + jx,
        // Jamais sous le fond de la cavité : avec beaucoup de boules, la pile
        // par le haut finirait par sortir par en bas.
        Math.max(floor, y),
        z
      ),
      hue: candyHue(b.slug),
      lum: 0.54 + ((h >> 5) % 5) * 0.035,
      spin: (h % 628) / 100,
    };
  });
  return { seats, r };
}

function Pile({ balls }) {
  const mesh = useRef(null);
  const { seats, r } = useMemo(() => pileSeats(balls), [balls]);

  useEffect(() => {
    const m = mesh.current;
    if (!m || !seats.length) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    seats.forEach((s, i) => {
      dummy.position.copy(s.pos);
      dummy.scale.setScalar(r);
      // Chacune posée dans un sens différent : un tas de boules toutes
      // orientées pareil se voit tout de suite (les coutures s'alignent).
      dummy.rotation.set(s.spin, s.spin * 1.7, s.spin * 0.6);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      color.setHSL(s.hue / 360, 0.95, s.lum);
      m.setColorAt(i, color);
    });
    m.count = seats.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [seats, r]);

  if (!seats.length) return null;
  return (
    <instancedMesh
      ref={mesh}
      // `key` : le nombre d'instances est figé à la construction du tampon.
      // Sans lui, gagner une boule laissait la dernière place dessinée sur
      // l'ancienne matrice — un fantôme au milieu du tas.
      key={seats.length}
      args={[undefined, undefined, seats.length]}
    >
      <sphereGeometry args={[1, 14, 10]} />
      {/* `standard` et non `physical` : cent boules au fond d'une caisse n'ont
          besoin ni de vernis ni d'indice de réfraction, et le vernis se paie
          sur chacune. */}
      <meshStandardMaterial roughness={0.24} metalness={0.05} envMapIntensity={1.3} />
    </instancedMesh>
  );
}

// ============================================================
//  La volée
// ============================================================
// CE QUI FAIT « IL Y EN AVAIT PLEIN ». Dix-huit boules crachées par la caisse
// au moment où le couvercle saute : elles montent en cône, la pesanteur les
// reprend, elles sortent du cadre. Aucune n'est à gagner, aucune n'est
// cliquable — c'est de la matière projetée, et ça ne dure qu'une seconde.
//
// Une seule instance pour les dix-huit, et leur position est une formule
// balistique : rien à stocker, rien à faire tourner entre deux ouvertures.
const SPRAY = 18;
// La volée a sa propre taille de boule : celle du tas suit son effectif (voir
// `pileSeats`), et une boule crachée qui change de calibre selon l'avancement
// de la collection serait un détail que personne ne formule et que tout le
// monde verrait.
const SPRAY_R = 0.13;

function Spray({ anim }) {
  const mesh = useRef(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: SPRAY }, (_, i) => {
        const a = (i / SPRAY) * Math.PI * 2 + (i % 3) * 0.4;
        const spread = 0.55 + ((i * 7) % 5) * 0.16;
        return {
          vx: Math.cos(a) * spread,
          vz: Math.sin(a) * spread * 0.8,
          vy: 2.3 + ((i * 13) % 7) * 0.22,
          r: SPRAY_R * (0.72 + ((i * 5) % 4) * 0.13),
          hue: CANDY[i % CANDY.length],
          spin: 3 + (i % 5),
        };
      }),
    []
  );

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const color = new THREE.Color();
    seeds.forEach((s, i) => {
      color.setHSL(s.hue / 360, 0.95, 0.58);
      m.setColorAt(i, color);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [seeds]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const a = anim.current;
    // Elles ne partent qu'au claquement du couvercle, et elles ont fini de
    // vivre bien avant que la boule choisie arrive à l'œil.
    const t = clamp01((a.fall - 0.08) / 0.92) * 1.35;
    m.visible = t > 0.001 && a.rise < 0.9;
    if (!m.visible) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < SPRAY; i++) {
      const s = seeds[i];
      dummy.position.set(
        s.vx * t,
        BOX_Y + RIM * 0.6 + s.vy * t - 4.2 * t * t,
        s.vz * t
      );
      dummy.rotation.set(t * s.spin, t * s.spin * 0.7, 0);
      dummy.scale.setScalar(s.r);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SPRAY]} visible={false}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial roughness={0.25} metalness={0.05} envMapIntensity={1.4} />
    </instancedMesh>
  );
}

// ============================================================
//  Le modèle
// ============================================================
// LE FICHIER EST LA RÉFÉRENCE, PAS NOS CHIFFRES. On le charge, on MESURE son
// corps, et on le pose dans un groupe qui le recentre et le met à l'échelle :
// le reste de la scène (doublure, tas, liseré, colonne) se cale sur des cotes
// dérivées de cette mesure. Recopier les dimensions à la main, c'est signer
// pour un décalage à la première version du modèle.
//
// LE COUVERCLE EST DÉJÀ ENTREBÂILLÉ dans le fichier : son nœud porte une
// rotation de −30° autour de X, charnière au bord arrière. On garde donc sa
// pose d'origine comme pose de repos, et on ne fait qu'AJOUTER à cet angle.
// C'est aussi ce qui rend l'ouverture crédible : c'est la vraie charnière du
// modèle qui travaille, pas un couvercle qu'on ferait léviter.
function useCaseModel() {
  const { scene } = useGLTF(CASE_URL);
  return useMemo(() => {
    // Cloné : la scène rendue par le cache de drei est partagée, et on lui
    // écrit dessus (l'angle du couvercle, à chaque image).
    const root = scene.clone(true);
    const lid = root.getObjectByName("Case_Top") || null;
    const body = root.getObjectByName("Case_Btm_CSGO_Case_Btm_0") || root;
    const rest = lid ? lid.rotation.x : 0;

    root.traverse((o) => {
      if (!o.isMesh) return;
      // Aucune ombre portée dans cette scène (voir le Canvas) ; et un rien de
      // studio en plus sur les ferrures, qui sont ce qui fait l'objet.
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
      if (o.material) o.material.envMapIntensity = 1.6;
    });

    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = BOX_W / size.x;

    // Un groupe intermédiaire plutôt que des transformations posées sur le
    // modèle : le recentrage et l'échelle ne doivent pas se battre avec les
    // poses des pièces, dont celle du couvercle qui est un enfant.
    const holder = new THREE.Group();
    holder.scale.setScalar(k);
    holder.position.set(-center.x * k, -center.y * k, -center.z * k);
    holder.add(root);
    return { holder, lid, rest };
  }, [scene]);
}

// Combien de pixels de glissé font un tour complet, et en deçà de combien de
// pixels un appui reste un CLIC. Huit : de quoi absorber le tremblement d'une
// main sur un bouton de souris, pas assez pour qu'un geste de rotation
// déclenche un tirage à cinq cents points.
const SPIN_PX = 620;
const TAU = Math.PI * 2;
const CLICK_SLOP = 8;

// ============================================================
//  La caisse
// ============================================================
// TROIS TEMPS, ET C'EST TOUTE LA MISE EN SCÈNE :
//
//   1. ELLE ATTEND. Elle flotte, respire, et on peut l'ATTRAPER pour la
//      tourner — elle continue sur son erre quand on la lâche. Au survol elle
//      FRISSONNE : c'est le seul signe qu'elle se clique, et il vaut mieux
//      qu'un curseur, parce qu'il existe aussi pour qui regarde par-dessus
//      l'épaule. Un glissé n'ouvre RIEN : seul un clic net paie.
//   2. ELLE CHARGE (`capsule`, dès qu'on a payé). Elle tremble de plus en plus
//      fort, le couvercle se rabat d'un cheveu — comme quelque chose qui prend
//      son élan — et la fente monte au blanc. Six dixièmes de seconde.
//   3. ELLE CLAQUE (`fall`). Le couvercle s'ouvre en grand sur sa charnière,
//      une colonne de lumière jaillit, la volée sort. Puis elle recule au fond
//      du plateau (`back`), toujours ouverte : c'est le décor de ce qui vient
//      d'en sortir.
function Crate({ balls, anim, onLaunch, live }) {
  const group = useRef(null);
  // CE QUI NE TREMBLE PAS. La caisse peut vibrer, sursauter, s'ébrouer — la
  // poussière lumineuse qui flotte autour, l'ombre au sol et le halo, non :
  // ce sont de l'air et de la lumière, ils n'ont aucune raison d'épouser les
  // secousses d'un objet. Vus en vrai, ils faisaient trembler l'écran entier,
  // ce qui ressemble à un défaut d'affichage plutôt qu'à une caisse qui charge.
  // Ce groupe-ci reçoit donc le mouvement LISSE (le recul, le souffle) et rien
  // du bruit.
  const calm = useRef(null);
  const spin = useRef(null);
  const seam = useRef(null);
  const column = useRef(null);
  const mouth = useRef(null);
  const [hot, setHot] = useState(false);
  const glow = useGlow();
  const beam = useBeam();
  const frame = useFrameGlow();
  const { holder, lid, rest } = useCaseModel();
  const charge = useRef(0);
  const warm = useRef(0); // le survol, lissé
  const turn = useRef({ free: 0, tilt: TILT_REST, vel: 0, at: null, moved: 0 });

  // On ne l'attrape et on ne la clique qu'AVANT le tirage. Une fois payée, le
  // pointeur appartient à la boule, et lui disputer le glissé casserait le
  // secouage — qui est le seul vrai moment de jeu.
  const holdable = () => live && anim.current.capsule < 0.5;

  // Le curseur dit que ça se prend en main. Nettoyé au démontage : une modale
  // fermée en plein survol laisserait la page entière en « grab ».
  useEffect(() => {
    document.body.style.cursor = hot && live ? "grab" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hot, live]);

  function down(e) {
    if (!holdable()) return;
    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    const t = turn.current;
    t.at = { x: e.clientX, y: e.clientY };
    t.moved = 0;
    t.vel = 0;
    document.body.style.cursor = "grabbing";
  }

  function move(e) {
    const t = turn.current;
    if (!t.at) return;
    e.stopPropagation();
    const dx = e.clientX - t.at.x;
    const dy = e.clientY - t.at.y;
    t.at = { x: e.clientX, y: e.clientY };
    // La DISTANCE PARCOURUE, pas le déplacement net : un aller-retour revient
    // au point de départ et n'en est pas moins un glissé.
    t.moved += Math.abs(dx) + Math.abs(dy);
    // Le basculement, borné : au-delà on regarde la caisse par le fond. Les
    // bornes sont posées AUTOUR de l'assiette de repos, pas autour de zéro.
    t.tilt = Math.max(TILT_REST - 0.34, Math.min(TILT_REST + 0.3, t.tilt + dy * 0.004));
    t.vel = (dx / SPIN_PX) * TAU * 9; // la vitesse résiduelle, pour l'erre
    t.free += (dx / SPIN_PX) * TAU;
  }

  function up() {
    const t = turn.current;
    if (!t.at) return;
    const clicked = t.moved < CLICK_SLOP;
    t.at = null;
    document.body.style.cursor = hot && live ? "grab" : "";
    // UN CLIC OUVRE, UN GLISSÉ NON. C'est tout le contrat de la caisse : on
    // peut la tourner dans tous les sens sans jamais déclencher un tirage.
    if (clicked && holdable() && onLaunch) onLaunch();
  }

  useFrame((state, raw) => {
    const g = group.current;
    if (!g) return;
    const a = anim.current;
    const dt = Math.min(raw, 0.05);
    const t = state.clock.elapsedTime;
    const armed = a.capsule > 0.5;

    // La charge monte vite mais pas d'un coup : `a.capsule` bascule de 0 à 1
    // sur une image au moment où l'on paie, et une caisse qui se met à trembler
    // instantanément se lit comme un défaut d'affichage.
    charge.current += (a.capsule - charge.current) * Math.min(1, dt * 6);
    const wanted = hot && holdable() && onLaunch ? 1 : 0;
    warm.current += (wanted - warm.current) * Math.min(1, dt * 8);

    const back = easeInOut(a.back);
    const burst = a.fall;
    const opened = clamp01(burst / 0.22);
    const hover = warm.current;

    // ---- LA MAIN. L'erre, le redressement, et la remise en place quand la
    // caisse est payée : elle doit être de face au moment où elle s'ouvre.
    const s = turn.current;
    if (!s.at) {
      s.free += s.vel * dt;
      // Amortissement exponentiel (et non linéaire) : le même freinage quel que
      // soit le nombre d'images par seconde.
      s.vel *= Math.pow(0.1, dt);
      if (Math.abs(s.vel) < 1e-3) s.vel = 0;
      // Elle revient à son assiette, pas à l'horizontale.
      s.tilt += (TILT_REST - s.tilt) * Math.min(1, dt * 1.4);
    }
    if (armed) {
      if (s.at) {
        s.at = null;
        document.body.style.cursor = "";
      }
      s.vel = 0;
      const home = Math.round(s.free / TAU) * TAU;
      s.free += (home - s.free) * Math.min(1, dt * 10);
    }
    if (spin.current) {
      spin.current.rotation.y = s.free;
      spin.current.rotation.x = s.tilt;
    }

    // ---- LA PLACE. Le recul : la caisse ne disparaît pas quand la boule sort,
    // elle s'efface EN PROFONDEUR et reste au fond comme le décor du moment.
    // Rien à faire fondre, donc rien qui clignote.
    //
    // Le mouvement lisse est calculé UNE FOIS et posé sur les deux groupes ;
    // seul celui de la caisse reçoit ensuite les secousses.
    const z = THREE.MathUtils.lerp(CRATE_HOME.z, CRATE_BACK.z, back);
    const y =
      THREE.MathUtils.lerp(CRATE_HOME.y, CRATE_BACK.y, back) +
      // Elle respire, et le souffle s'arrête quand elle charge : une caisse qui
      // continue de flotter tranquillement pendant qu'elle vibre ne vibre pas.
      Math.sin(t * 0.9) * 0.03 * (1 - back) * (1 - charge.current);
    const k = THREE.MathUtils.lerp(CRATE_HOME.s, CRATE_BACK.s, back);
    const swing = Math.sin(t * 0.24) * 0.1 * (1 - back) * (1 - charge.current);

    if (calm.current) {
      calm.current.position.set(0, y, z);
      calm.current.scale.setScalar(k);
    }

    g.position.set(0, y, z);
    g.scale.setScalar(k * (1 + hover * 0.02));
    g.rotation.set(0, swing, 0);

    // ---- LE FRISSON DU SURVOL. Minuscule, rapide, et il s'ajoute au reste :
    // c'est ce qui dit « je suis un bouton » sans écrire un mot. Il cède la
    // place au vrai tremblement dès que la caisse charge.
    if (hover > 0.01 && !armed) {
      const w = hover * (1 - charge.current);
      g.position.x += (Math.random() - 0.5) * 0.014 * w;
      g.position.y += (Math.random() - 0.5) * 0.01 * w;
      g.rotation.z += (Math.random() - 0.5) * 0.008 * w;
    }

    // ---- LE TREMBLEMENT DE LA CHARGE. Il croît en carré, et il est BRUTAL à
    // la fin : c'est lui qui fait attendre le claquement.
    const q = charge.current * (1 - opened);
    if (q > 0.002) {
      const hard = q * q;
      g.position.x += (Math.random() - 0.5) * 0.12 * hard;
      g.position.y += (Math.random() - 0.5) * 0.09 * hard;
      g.rotation.z += (Math.random() - 0.5) * 0.09 * hard;
      g.rotation.y += (Math.random() - 0.5) * 0.08 * hard;
    }

    // ---- LE COUVERCLE, sur sa vraie charnière. Il se rabat d'un cheveu
    // pendant la charge (il prend son élan), s'ouvre en grand au claquement,
    // et rebondit une fois en fin de course.
    if (lid) {
      // La tension ne peut PAS refermer plus que le jour disponible : au-delà,
      // le couvercle rentrerait dans le corps de la caisse.
      const tension = q * LID_GAP * 0.75;
      const bounce = Math.sin(clamp01((burst - 0.22) / 0.78) * Math.PI) * 0.14;
      const shiver =
        Math.sin(t * 46) * 0.012 * q +
        hover * (1 - charge.current) * Math.sin(t * 34) * 0.005;
      // La pose de repos est absolue (une fente de LID_GAP) ; la pose grande
      // ouverte, elle, se compte à partir de celle du FICHIER — c'est sa
      // charnière, et elle seule sait où elle bute.
      lid.rotation.x =
        THREE.MathUtils.lerp(
          -LID_GAP + tension,
          rest - LID_SWING - bounce,
          easeOut(opened)
        ) + shiver;
    }

    // ---- LA FENTE. Elle rougeoie à l'arrêt, s'allume au survol, monte au
    // blanc pendant la charge, éclate au claquement, puis reste braise.
    if (seam.current) {
      const heat =
        0.32 + hover * 0.4 + q * 1.6 + opened * 0.9 * (1 - burst * 0.5);
      // Les deux couleurs sont pré-mélangées dans une teinte de travail : un
      // `new THREE.Color()` par image, c'est soixante objets jetables par
      // seconde pour une nuance qu'on peut calculer sur place.
      seam.current.material.color
        .copy(COLD_SEAM)
        .lerp(HOT_SEAM, clamp01(q + opened * 0.4));
      seam.current.material.opacity = Math.min(1.6, heat) * (1 - back * 0.55);
    }

    // ---- LA COLONNE DE LUMIÈRE. Elle jaillit de la caisse ouverte, très fort,
    // puis retombe à une lueur qui tient tant que la caisse est là : une boîte
    // ouverte et éteinte au fond du plateau ressemble à une boîte vide.
    if (column.current) {
      const shot = burst < 0.18 ? burst / 0.18 : Math.max(0.16, 1 - (burst - 0.18) / 0.5);
      column.current.visible = burst > 0.001;
      column.current.material.opacity = shot * 0.85 * (1 - back * 0.6);
      column.current.scale.set(BOX_W * (0.5 + shot * 0.35), BOX_H * (0.6 + shot * 3.4), 1);
      column.current.position.y = RIM + column.current.scale.y * 0.42;
    }
    // La flaque de lumière posée DANS l'ouverture. Elle dit qu'il y a quelque
    // chose là-dedans, sans rien éclairer (aucune source, aucun recalcul de
    // matériau) — et elle est déjà là avant le tirage, parce que la caisse est
    // entrebâillée depuis le début.
    if (mouth.current) {
      mouth.current.material.opacity =
        (0.12 + hover * 0.1 + q * 0.35 + Math.max(0, 0.5 - burst)) * (1 - back * 0.5);
    }
  });

  return (
    <>
      {/* L'AIR AUTOUR — et il ne tremble pas. Le halo, la poussière lumineuse
          et l'ombre au sol suivent la caisse quand elle recule, et l'ignorent
          quand elle vibre.

          LE HALO, DERRIÈRE, c'est le faux bloom : aucune passe de rendu en plus
          (le paquet de post-traitement n'est pas dans l'application, et il ne
          le sera pas pour une modale), juste une grande tache de lumière posée
          en arrière de la caisse. C'est LUI qui fait qu'elle a l'air de
          rayonner au lieu d'être découpée sur du noir. */}
      <group ref={calm}>
        <Bloom anim={anim} />

        {/* LES ÉTINCELLES. Rien ne dit « lot à gagner » aussi vite qu'une
            poussière qui scintille autour de l'objet, et c'est un shader déjà
            écrit dans drei. */}
        <Sparkles
          position={[0, 0.1, 0]}
          count={28}
          scale={[3.1, 2.2, 3.1]}
          size={2.4}
          speed={0.3}
          noise={0.5}
          opacity={0.6}
          color="#fff6df"
        />

        <Floor anim={anim} />
      </group>

    <group ref={group}>
      {/* CE QUI TOURNE À LA MAIN : la caisse et tout ce qui vit dedans. La
          colonne de lumière, elle, reste dehors — c'est un panneau tourné vers
          la caméra, le faire pivoter avec l'objet n'aurait aucun sens. */}
      <group ref={spin}>
        <primitive object={holder} />

        {/* LA DOUBLURE. Une boîte retournée (faces internes) glissée dans le
            modèle : elle garantit qu'on ne voit jamais le vide de la scène par
            la fente, quelle que soit la façon dont le fichier modélise son
            intérieur. Sombre et mate — c'est le fond sur lequel les boules
            ressortent. */}
        <mesh position={[0, RIM - IN_H / 2, 0]}>
          <boxGeometry args={[IN_W * 1.04, IN_H, IN_D * 1.06]} />
          <meshStandardMaterial color="#0d0913" roughness={0.9} side={THREE.BackSide} />
        </mesh>

        <Pile balls={balls} />

        {/* LA FLAQUE, à hauteur de fente. */}
        <mesh
          ref={mouth}
          position={[0, RIM - 0.05, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[BOX_W * 0.85, BOX_D * 0.85, 1]}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={glow}
            color={GOLD_HOT}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* LE LISERÉ DE LA FENTE. Un rectangle de lumière peint au pinceau et
            non une arête : le fil qui court à la jonction du couvercle et du
            corps doit DÉBORDER quand il chauffe, ce qu'une arête ne fait pas —
            une arête a un bord net, et un bord net ne rayonne pas. */}
        <mesh ref={seam} position={[0, RIM, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BOX_W * 1.5, BOX_D * 1.6]} />
          <meshBasicMaterial
            map={frame}
            color={GOLD}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>

        {/* LA PRISE. Une boîte invisible, un peu plus large que la caisse : on
            attrape un coffre à pleine main, pas au pixel près. */}
        <mesh
          visible={false}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (live) setHot(true);
          }}
          onPointerOut={() => setHot(false)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        >
          <boxGeometry args={[BOX_W * 1.1, BOX_H * 1.35, BOX_D * 1.1]} />
        </mesh>
      </group>

      {/* LA COLONNE. Un panneau tourné vers la caméra, dégradé vers le haut :
          c'est le rai de lumière des ouvertures de caisse, et il ne coûte rien.
          `depthWrite` désactivé, sinon il découperait la volée qui le traverse. */}
      <mesh ref={column} position={[0, RIM, 0]} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={beam}
          color={GOLD_HOT}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

    </group>
    </>
  );
}

// ============================================================
//  Le halo — du bloom sans passe de rendu
// ============================================================
// UNE TACHE DE LUMIÈRE, POSÉE DERRIÈRE. Deux couches : une large et chaude qui
// auréole toute la caisse, une plus serrée qui la fait rayonner par le cœur.
// Toutes deux en additif, donc sans contour possible — et c'est ce qu'on veut :
// ce n'est pas une pièce de la caisse, c'est de la lumière.
function Bloom({ anim }) {
  const wide = useRef(null);
  const core = useRef(null);
  const glow = useGlow();

  useFrame((state) => {
    const a = anim.current;
    const back = easeInOut(a.back);
    const beat = 0.85 + Math.sin(state.clock.elapsedTime * 0.8) * 0.09;
    // Il enfle avec la charge et éclate avec le couvercle : le halo est la
    // partie la moins chère de l'explosion, et la plus lisible.
    const swell = a.capsule * (1 - clamp01(a.fall / 0.25)) * 0.5;
    const pop = Math.max(0, 1 - a.fall * 2.4) * clamp01(a.fall / 0.12);
    if (wide.current) wide.current.material.opacity = (0.3 * beat + swell + pop) * (1 - back);
    if (core.current)
      core.current.material.opacity = (0.18 * beat + swell * 0.8 + pop * 1.2) * (1 - back);
  });

  return (
    <group position={[0, 0.2, -0.7]}>
      <sprite ref={wide} scale={BOX_W * 3.6}>
        <spriteMaterial
          map={glow}
          color="#ffb877"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>
      <sprite ref={core} scale={BOX_W * 2.1}>
        <spriteMaterial
          map={glow}
          color={GOLD_HOT}
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
//  Le sol — ce qui POSE un objet qui ne touche rien
// ============================================================
// SANS ÇA, LA CAISSE EST COLLÉE SUR L'ÉCRAN. Un objet qui ne repose sur rien
// n'a aucune profondeur : il faut lui dire où est le sol pour que la lévitation
// se lise comme de la lévitation et non comme une image. Deux choses le disent,
// et aucune n'est un meuble — une ombre portée, et un halo qui la soutient.
function Floor({ anim }) {
  const pool = useRef(null);
  const glow = useGlow();

  useFrame((state) => {
    const m = pool.current;
    if (!m) return;
    const a = anim.current;
    const back = easeInOut(a.back);
    const beat = 0.86 + Math.sin(state.clock.elapsedTime * 0.9) * 0.14;
    m.material.opacity = (0.24 * beat + Math.max(0, 1 - a.fall * 3) * a.capsule * 0.3) * (1 - back);
  });

  return (
    <group>
      <mesh ref={pool} position={[0, FLOOR + 0.004 - BOX_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 48]} />
        <meshBasicMaterial
          map={glow}
          color="#ffd58f"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* DANS le groupe de la caisse, pas à côté : elle recule quand la boule
          prend la vedette, et une ombre restée en place serait une tache noire
          suspendue en l'air. Douce et pâle — la caisse flotte à un demi-mètre
          du sol, une ombre franche la recollerait dessus. */}
      <ContactShadows
        position={[0, FLOOR - BOX_Y, 0]}
        opacity={0.4}
        scale={5}
        blur={3.2}
        far={2.6}
        // 256 et non 512 : c'est une tache floue de deux mètres, personne n'y
        // lira la moitié des pixels, et c'est une cible de rendu par image.
        resolution={256}
        color="#140a18"
      />
    </group>
  );
}

// ============================================================
//  La boule choisie
// ============================================================
// LE MÊME OBJET DU DÉBUT À LA FIN : elle naît au fond de la caisse, elle est
// projetée avec la volée, elle monte vers l'œil, on la secoue, elle se fend.
// Les deux coquilles sont deux demi-sphères SÉPARÉES depuis toujours — ce n'est
// pas une sphère qu'on remplace au moment de l'ouverture, c'est une capsule qui
// a toujours eu deux moitiés, et elles s'écartent.
// Elle sort du tas, elle a donc le calibre d'une boule de tas — celui d'une
// caisse bien remplie, pas celui qu'aurait le tas d'une collection presque
// finie (où les boules grossissent, voir `pileSeats`) : une capsule dont la
// taille dépendrait de l'avancement se remarquerait au deuxième tirage.
const CAP_R = SPRAY_R;
// De combien elle grossit en montant vers l'œil. Présentée à sa taille réelle,
// elle serait un pois au milieu de l'écran.
const CAP_PRESENT = 3.6;
// L'opacité du couvercle dépoli. Nommée parce qu'elle sert DEUX FOIS — à le
// peindre, et à le faire disparaître à l'ouverture — et que les deux valeurs
// doivent être la même.
const TOP_ALPHA = 0.42;

// SON TRAJET. Elle part du fond de la caisse, franchit l'ouverture DROIT (les
// deux premiers points sont sur l'axe vertical, l'un dedans l'autre dehors :
// c'est la seule façon d'être sûr qu'elle ne traverse pas une paroi), puis la
// pesanteur la reprend et elle vient se tenir en l'air devant la caisse.
const EJECT_PATH = [
  new THREE.Vector3(0, BOX_Y - 0.2, 0),
  new THREE.Vector3(0, BOX_Y + RIM + 0.3, 0.04),
  new THREE.Vector3(0, BOX_Y + 1.35, 0.55),
  new THREE.Vector3(0, BOX_Y + 1.15, 1.15),
  new THREE.Vector3(0, BOX_Y + 0.62, 1.5),
];
const APEX = EJECT_PATH[EJECT_PATH.length - 1];

function Capsule({ hue, anim }) {
  const group = useRef(null);
  const aura = useRef(null);
  const halo = useRef(null);
  const spark = useRef(null);
  const top = useRef(null);
  const bot = useRef(null);
  const seam = useRef(null);
  const glow = useGlow();
  const curve = useMemo(() => new THREE.CatmullRomCurve3(EJECT_PATH), []);
  const at = useMemo(() => new THREE.Vector3(), []);

  // DEUX TONS, ET UNE COULEUR DIFFÉRENTE À CHAQUE TOUR. La capsule prenait la
  // teinte du boîtier gagné : comme la plupart des jaquettes tirent vers les
  // mêmes tons, toutes les boules se ressemblaient. Elle est tirée au sort à
  // chaque tirage — et elle n'annonce donc rien du contenu.
  const shell = useMemo(() => {
    const h = ((hue ?? CANDY[0]) % 360) / 360;
    return {
      base: new THREE.Color().setHSL(h, 0.98, 0.53), // le fond, plein et vif
      frost: new THREE.Color().setHSL(h, 0.78, 0.8), // le couvercle, dépoli
      light: new THREE.Color().setHSL(h, 0.9, 0.68), // ce qui rayonne autour
    };
  }, [hue]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const a = anim.current;
    const shown = a.capsule > 0.001;
    g.visible = shown;
    // Le halo n'existe qu'une fois la boule SORTIE : allumé pendant la charge,
    // il rougeoierait à l'intérieur d'une caisse fermée, et un additif finit
    // toujours par fuir par une couture.
    if (aura.current) aura.current.visible = shown && a.fall > 0.06 && a.crack < 0.35;
    if (!shown) return;
    const t = state.clock.elapsedTime;

    let scale;
    if (a.rise < 0.001) {
      // ---- ELLE EST PROJETÉE. On suit le trajet ; elle part vite et ralentit
      // en fin de course, et elle tourne sur elle-même comme un objet lancé.
      const p = easeOut(a.fall) * 0.88 + a.fall * 0.12;
      curve.getPointAt(clamp01(p), at);
      g.rotation.set(a.fall * 11, a.fall * 6, a.fall * 4);
      scale = 1;
    } else {
      // ---- ELLE VIENT À L'ŒIL, en arc, et grossit. C'est le geste de
      // quelqu'un qui attrape sa boule au vol et la lève pour la regarder.
      const r = easeOut(a.rise);
      at.lerpVectors(APEX, STAGE, r);
      at.y -= Math.sin(r * Math.PI) * 0.3; // un arc, pas une ligne
      scale = 1 + r * (CAP_PRESENT - 1);

      // ---- ON LA SECOUE. Le tremblement suit l'énergie du geste, et il n'est
      // PAS régulier : trois fréquences premières entre elles plus un grain
      // aléatoire, et ça devient un objet qu'on agite.
      const s = a.rattle;
      g.rotation.set(
        Math.sin(t * 37) * 0.3 * s + (Math.random() - 0.5) * 0.1 * s,
        r * Math.PI * 2.5 + t * 0.35,
        Math.sin(t * 23) * 0.34 * s + (Math.random() - 0.5) * 0.1 * s
      );
      at.x += (Math.random() - 0.5) * 0.07 * s;
      at.y += (Math.random() - 0.5) * 0.07 * s + Math.sin(t * 1.6) * 0.02;
    }

    g.position.copy(at);
    g.scale.setScalar(scale);

    // LA LUEUR EST AUTOUR, PAS DEDANS. Elle suit la boule mais NE TOURNE PAS
    // avec elle : un halo qui tourne, ça se voit, et de toute façon un sprite
    // regarde toujours la caméra. Le plastique opaque en masque le cœur, il
    // n'en reste qu'un anneau qui déborde de la silhouette — exactement ce que
    // les trois surfaces transparentes de l'ancienne version essayaient de
    // faire, pour le prix d'un quad.
    if (aura.current) {
      aura.current.position.copy(at);
      aura.current.scale.setScalar(scale);
      const beat = 0.82 + Math.sin(t * 3.4) * 0.08;
      const heat = 0.55 + a.rattle * 0.9;
      if (halo.current) halo.current.material.opacity = beat * heat * 0.75;
      if (spark.current) spark.current.material.opacity = beat * heat * 0.4;
    }

    // LA COUTURE CHAUFFE, PUIS ELLE MEURT. À mesure qu'on secoue, la ligne de
    // jointure s'allume : c'est ELLE la jauge sur l'objet — rien à lire pour
    // savoir qu'on y est presque. Elle disparaît vite à l'ouverture, sinon
    // l'anneau reste à flotter autour du boîtier comme un élastique oublié.
    if (seam.current) {
      const lit = a.crack > 0 ? Math.max(0, 1 - a.crack * 5) : a.rattle;
      seam.current.visible = lit > 0.01;
      seam.current.material.opacity = Math.min(1, lit);
      seam.current.scale.setScalar(1 + lit * 0.06);
    }

    // ---- L'OUVERTURE. Les deux moitiés s'écartent, basculent et partent
    // chacune de leur côté en tournant. Elles ne disparaissent pas : elles
    // sortent du cadre, ce qu'elles feraient vraiment.
    //
    // `born` : elle se forme AU FOND DE LA CAISSE. Sans ce fondu, on la verrait
    // apparaître d'un coup au milieu du tas au moment du claquement.
    const born = clamp01(a.fall / 0.12);
    const c = easeOut(a.crack);
    if (top.current && bot.current) {
      // Le fondu est RELATIF à l'opacité de chaque moitié, pas absolu : le
      // couvercle est dépoli (0,42), et lui écrire « 1 » au début de
      // l'ouverture le rendait brusquement opaque — la capsule se refermait à
      // l'instant précis où elle était censée s'ouvrir.
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
  });

  return (
    <>
      {/* LE HALO, hors du groupe qui tourne. */}
      <group ref={aura} visible={false}>
        <sprite ref={halo} scale={CAP_R * 5.2}>
          <spriteMaterial
            map={glow}
            color={shell.light}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite ref={spark} scale={CAP_R * 2.6}>
          <spriteMaterial
            map={glow}
            color="#fffaf0"
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
      </group>

      <group ref={group} visible={false}>
        {/* LE COUVERCLE — dépoli. Rugueux et à peine opaque : on voit qu'il y a
            quelque chose dedans, jamais quoi. `depthWrite` désactivé pour qu'il
            ne cache pas ce qu'il est justement censé laisser deviner. */}
        <mesh ref={top}>
          <sphereGeometry args={[CAP_R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial
            color={shell.frost}
            transparent
            opacity={TOP_ALPHA}
            roughness={0.6}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.32}
            envMapIntensity={1.7}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>

        {/* LE FOND — plastique plein, saturé. C'est lui qui donne sa couleur à
            la boule, et c'est sur lui que se lit la lumière du studio. */}
        <mesh ref={bot}>
          <sphereGeometry args={[CAP_R, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshPhysicalMaterial
            color={shell.base}
            roughness={0.13}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.06}
            envMapIntensity={2.2}
            transparent
            opacity={1}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* La couture lumineuse, à l'équateur : la jauge du secouage. */}
        <mesh ref={seam} rotation={[Math.PI / 2, 0, 0]} visible={false}>
          <torusGeometry args={[CAP_R * 1.006, 0.012, 6, 44]} />
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
    </>
  );
}

// ============================================================
//  L'éclat
// ============================================================
// Un éclair, deux ondes qui s'ouvrent à des vitesses différentes, une couronne
// de rais qui tourne, et une centaine d'éclats qui retombent. Tout en additif :
// ça n'assombrit jamais rien, ça n'ajoute que de la lumière.
const SPARKS = 110;

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
    // après l'éclair — c'est ce qui fait qu'on regarde encore. Posés EN RETRAIT
    // de la scène de présentation : centrés dessus, le test de profondeur les
    // laissait passer PAR-DESSUS le boîtier chaque fois qu'un de ses coins
    // reculait en tournant.
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

// Les images peintes UNE FOIS pour toute l'application (elles vivent dans des
// variables de module, pas dans un état) : le halo, la couronne de rais, et la
// colonne de lumière.
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

// LA COLONNE. Claire et pleine en bas, éteinte en haut, et estompée sur les
// côtés : c'est ce dégradé-là qui fait « rai de lumière » plutôt que « panneau
// jaune ». Un rectangle uni aurait deux arêtes verticales, et deux arêtes
// nettes suffisent à trahir un quad.
let beamTex = null;
function useBeam() {
  return useMemo(() => {
    if (beamTex) return beamTex;
    const W = 128;
    const H = 256;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const up = g.createLinearGradient(0, H, 0, 0);
    up.addColorStop(0, "rgba(255,255,255,1)");
    up.addColorStop(0.35, "rgba(255,255,255,0.5)");
    up.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = up;
    g.fillRect(0, 0, W, H);
    // Les bords s'éteignent : on efface par les côtés au lieu de dessiner.
    const side = g.createLinearGradient(0, 0, W, 0);
    side.addColorStop(0, "rgba(0,0,0,1)");
    side.addColorStop(0.3, "rgba(0,0,0,0)");
    side.addColorStop(0.7, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = side;
    g.fillRect(0, 0, W, H);
    beamTex = new THREE.CanvasTexture(c);
    beamTex.minFilter = THREE.LinearMipmapLinearFilter;
    beamTex.magFilter = THREE.LinearFilter;
    return beamTex;
  }, []);
}

// LA COUTURE. Un rectangle de lumière peint au pinceau, pas une géométrie :
// le fil qui court à la jonction du couvercle et du corps doit DÉBORDER de la
// caisse quand il chauffe, ce qu'une arête ne fait pas — une arête a un bord
// net, et un bord net ne rayonne pas. Le tracé occupe les deux tiers de
// l'image, le tiers restant est la marge où la lumière s'étale.
let frameTex = null;
function useFrameGlow() {
  return useMemo(() => {
    if (frameTex) return frameTex;
    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const m = S * 0.18;
    const w = S - m * 2;
    const r = 14;
    // Trois passes du même tracé, de la plus large et sourde à la plus fine et
    // blanche : c'est ce qui fait un fil incandescent plutôt qu'un trait.
    for (const [width, blur, alpha] of [
      [16, 26, 0.35],
      [7, 14, 0.6],
      [2.5, 6, 1],
    ]) {
      g.strokeStyle = `rgba(255,255,255,${alpha})`;
      g.lineWidth = width;
      g.shadowColor = "rgba(255,255,255,0.9)";
      g.shadowBlur = blur;
      g.beginPath();
      // `roundRect` manque encore sur quelques navigateurs de 2022 : un
      // rectangle à angles vifs y fait parfaitement l'affaire, il est de toute
      // façon noyé sous le flou.
      if (g.roundRect) g.roundRect(m, m, w, w, r);
      else g.rect(m, m, w, w);
      g.stroke();
    }
    frameTex = new THREE.CanvasTexture(c);
    frameTex.minFilter = THREE.LinearMipmapLinearFilter;
    frameTex.magFilter = THREE.LinearFilter;
    return frameTex;
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

    // ON LE RANGE : il descend hors du cadre en rapetissant, comme s'il partait
    // se poser sur l'étagère. Il ne s'efface PAS — un boîtier qui s'évapore au
    // milieu de l'écran ne va nulle part, et « Relancer » doit se lire comme
    // « celui-là est à moi, au suivant ».
    const away = a.away || 0;
    if (away > 0) {
      const g0 = easeIn(away);
      g.position.y -= g0 * 3.2;
      g.position.z -= g0 * 0.6;
      g.scale.multiplyScalar(1 - g0 * 0.45);
      g.rotation.z = g0 * 0.5;
    } else {
      g.rotation.z = 0;
    }

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
// avancements se CHEVAUCHENT volontairement (la caisse recule pendant que la
// boule monte, l'objet grandit pendant que les coquilles s'écartent) : c'est ce
// recouvrement qui fait une scène plutôt qu'un diaporama.
//
// Les noms d'étapes datent de la sphère et sont restés : `falling` est
// désormais le CLAQUEMENT (le couvercle part, la volée sort), `rising` la
// montée de la boule vers l'œil. Les renommer aurait touché la modale, les
// sons et la scène pour ne rien changer à l'écran.
const PHASES = ["idle", "arming", "falling", "rising", "waiting", "cracking", "revealed"];

function Clock({ phase, anim }) {
  useFrame((_, raw) => {
    const a = anim.current;
    const dt = Math.min(raw, 0.05);
    const to = (v, target, secs) =>
      target > v ? Math.min(target, v + dt / secs) : Math.max(target, v - dt / secs);
    const after = (p) => PHASES.indexOf(phase) >= PHASES.indexOf(p);

    // ON RANGE. « stowing » n'est pas une étape de la séquence — c'est
    // l'entre-deux de « Relancer » : le boîtier sort de l'écran par le bas
    // pendant que la caisse revient au premier plan, et TOUT LE RESTE garde sa
    // valeur (le boîtier doit continuer d'exister pendant qu'il s'en va).
    // D'où la sortie sèche : `after()` répondrait faux à tout (la phase n'est
    // pas dans la liste) et remettrait la scène à zéro sur une image.
    if (phase === "stowing") {
      a.away = to(a.away, 1, 0.5);
      a.back = to(a.back, 0, 0.5);
      return;
    }
    a.away = 0;

    // `capsule` bascule DÈS L'ARMEMENT, avant que rien ne bouge : c'est lui qui
    // dit à la caisse qu'elle ne se clique plus et qu'elle doit charger.
    a.capsule = after("arming") ? 1 : 0;
    a.fall = after("falling") ? to(a.fall, 1, 0.9) : 0;
    a.rise = after("rising") ? to(a.rise, 1, 0.62) : 0;
    // La caisse commence à reculer DÈS que la boule monte : les deux gestes
    // n'en font qu'un, c'est le regard qui change de sujet.
    a.back = after("rising") ? to(a.back, 1, 0.85) : to(a.back, 0, 0.7);
    a.crack = after("cracking") ? to(a.crack, 1, 0.9) : 0;
    // L'énergie du secouage retombe toute seule : arrêter de bouger, c'est
    // laisser la boule se calmer. C'est ce qui fait qu'il faut SECOUER et pas
    // seulement bouger un peu. Le couple (gain par pixel, cette fuite) fixe la
    // durée de l'épreuve — comptée pour environ deux secondes d'agitation
    // franche, voir GachaModal. Elle valait cinq : c'était trop long, on
    // secouait en regardant ailleurs.
    if (phase === "waiting") a.rattle = Math.max(0, a.rattle - dt * 0.2);
  });
  return null;
}

// ============================================================
//  L'éclairage
// ============================================================
// UN STUDIO, pas un plafonnier. L'environnement est bâti sur place avec des
// panneaux lumineux (aucun HDR à télécharger, rien qui puisse manquer hors
// ligne) : c'est LUI qui donne à la laque sa profondeur, à l'or sa brillance et
// au plastique de la boule son reflet. Sans lui, tout est en pâte à modeler.
//
// DEUX COULEURS QUI S'OPPOSENT, et c'est ça le « rendu de jeu » : une clé
// chaude en haut à droite, un contre froid en bas à gauche. C'est le partage
// chaud/froid qui décolle la silhouette du fond noir.
function Rig() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3.2, 5, 4]} intensity={1.6} color="#ffe9d2" />
      <directionalLight position={[-4.5, 1.2, 2.4]} intensity={0.8} color="#8fd4ff" />
      <directionalLight position={[0, -1.6, -4]} intensity={0.9} color="#ffb07a" />
      {/* 128 et non 256 : c'est une carte d'environnement, elle est floutée par
          la rugosité de tous les matériaux qui la lisent — sa définition ne se
          voit nulle part, son coût de cuisson se voit à l'ouverture. */}
      <Environment resolution={128}>
        {/* Le grand diffuseur du dessus : c'est lui qui pose la brillance
            allongée sur le couvercle. */}
        <Lightformer form="rect" intensity={3.4} position={[0, 4.5, 2]} scale={[9, 4, 1]} />
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
          color="#ffd0a0"
        />
        {/* L'anneau de face : le reflet circulaire qu'on voit sur toute laque
            de vitrine. */}
        <Lightformer form="ring" intensity={3} position={[0, 0.8, 5]} scale={3.6} color="#fff0d2" />
      </Environment>
    </>
  );
}

// L'ÉCLAIRAGE DE L'OUVERTURE. Trois sources, montées une fois et jamais
// démontées : les allumer en cours de route AJOUTERAIT une lumière à la scène,
// ce qui oblige three à recompiler le programme de chaque matériau — un
// à-coup d'une demi-seconde, pile au moment de la révélation. On ne fait donc
// que monter et descendre leur intensité.
//
//   • LE COUP. Un flash violent au centre, qui retombe en une demi-seconde.
//   • LA CLÉ. Une lampe chaude qui reste sur le boîtier, en avant et un peu
//     au-dessus — sans elle il est présenté dans le noir.
//   • LE CONTRE. Une lumière froide derrière lui, qui détache sa silhouette.
function RevealLight({ anim, tint }) {
  const burst = useRef(null);
  const key = useRef(null);
  const rim = useRef(null);

  useFrame(() => {
    const c = anim.current.crack;
    const hit = Math.max(0, 1 - c * 3.2);
    if (burst.current) burst.current.intensity = c > 0.005 ? hit * 26 : 0;
    const held = Math.min(1, c * 2.2);
    if (key.current) key.current.intensity = held * 2.6;
    if (rim.current) rim.current.intensity = held * 3.4;
  });

  return (
    <>
      <pointLight ref={burst} position={STAGE} color="#fff4de" distance={12} decay={2} intensity={0} />
      <pointLight
        ref={key}
        position={[STAGE.x + 1.1, STAGE.y + 1.3, STAGE.z + 1.8]}
        color="#fff0d6"
        distance={9}
        decay={2}
        intensity={0}
      />
      <pointLight
        ref={rim}
        position={[STAGE.x - 0.9, STAGE.y + 0.4, STAGE.z - 1.6]}
        color={tint || "#9ec6ff"}
        distance={7}
        decay={2}
        intensity={0}
      />
    </>
  );
}

function Fit() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    // Sur un écran étroit (téléphone en portrait), c'est la LARGEUR qui borne :
    // on recule pour que la caisse tienne entière plutôt que de la rogner. Le
    // recul est posé AVANT le cadrage — viser puis reculer laisserait la caméra
    // pointée pour l'ancienne distance, donc un peu trop haut.
    const aspect = size.width / Math.max(1, size.height);
    const pull = aspect < NARROW ? (NARROW - aspect) * NARROW_PULL : 0;
    camera.position.set(EYE[0], EYE[1], EYE[2] + pull);
    camera.lookAt(...LOOK);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

export default function GachaScene({ phase, balls, won, hue, onSettled, anim, onLaunch }) {
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
      // 1,75 et non 1,9 : sur un téléphone à forte densité, c'est 15 % de
      // pixels en moins pour une différence que personne ne voit sur des
      // formes floues et lumineuses.
      dpr={[1, 1.75]}
      // PAS DE CARTE D'OMBRES. Rien ne se pose sur rien dans cette scène : ce
      // qui « pose » la caisse est l'ombre de contact, qui a sa propre cible de
      // rendu. La passe d'ombres du moteur ne dessinait donc rien, chaque
      // image, pour tous les objets de la scène.
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

      <group position={[0, BOX_Y, 0]}>
        {/* LE MODÈLE SUSPEND LE RENDU LE TEMPS DE SON TÉLÉCHARGEMENT (4,7 Mo).
            La barrière est ICI et pas autour du canevas : sans elle, c'est la
            modale entière qui se remonterait à l'arrivée du fichier — canevas
            compris, donc scène reconstruite. En attendant, le halo seul : un
            écran noir dirait « cassé », une lueur dit « ça arrive ». */}
        <Suspense fallback={<Bloom anim={anim} />}>
          <Crate balls={balls} anim={anim} onLaunch={onLaunch} live={phase === "idle"} />
        </Suspense>
      </group>
      <Spray anim={anim} />
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
