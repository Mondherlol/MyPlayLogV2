import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { isComic } from "../lib/collection";
import {
  paperGeometry,
  shellGeometry,
  bookCoverGeometry,
  bookBlockGeometry,
  pageEdgeTexture,
} from "../lib/caseGeometry";

// ======================================================================
//  L'OBJET LUI-MÊME — la carrosserie d'un boîtier, sans scène autour
// ======================================================================
// Trois endroits présentent le MÊME objet : l'étagère (rangé, de tranche), la
// vitrine (pris en main, qui tourne) et la machine à capsules (qui vient de le
// cracher). Ils n'ont ni la même caméra, ni le même éclairage, ni les mêmes
// gestes — mais l'objet, lui, doit être exactement le même partout : un manga
// sorti de la capsule montre le chant de ses pages comme sur l'étagère, sinon
// c'est un autre objet qu'on gagne.
//
// D'où ce fichier, qui ne contient QUE la matière et la géométrie. Aucune
// notion de survol, de vol, de rangement : ces trois-là appartiennent à la
// scène qui les met en œuvre, pas à l'objet qu'elle montre.

// Le matériau est construit À LA MAIN plutôt que déclaré en JSX : un matériau
// JSX qui passe de `color` à `map` garde sa couleur, et une texture est
// MULTIPLIÉE par elle — boîtier noir, sans erreur. Ici la couleur est toujours
// explicite.
export function useCasePaper(art) {
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

// Le boîtier lui-même, sans interaction. Deux pièces, et deux seulement :
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
// que le choix se fait — tout le reste de la scène (survol, vol, vitrine,
// capsule) ne sait pas de quel objet il s'occupe, et n'a pas à le savoir.
export function CaseModel({ media, box, paper, cuts }) {
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
export function BookModel({ box, paper, cuts }) {
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
export function DiscCase({ box, paper, cuts }) {
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
