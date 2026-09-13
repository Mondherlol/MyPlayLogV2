// Le logo de Backloggd : le « B » souligné, tracé d'après la marque. `evenodd`
// creuse les deux boucles du B. Monochrome (`currentColor`) : c'est au
// conteneur de poser le rose de la marque. Partagé par le parcours d'accueil
// et les Paramètres.
const VIEWBOX = "290 176 445 672";
const PATH =
  "M290 176H520C640 176 720 232 720 320C720 380 690 425 640 452C705 476 735 530 735 592C735 690 652 745 530 745H290Z" +
  "M428 280V412H508C558 412 585 388 585 346C585 304 558 280 508 280Z" +
  "M428 502V640H518C570 640 598 614 598 571C598 528 570 502 518 502Z" +
  "M296 797H727Q733 797 733 803V842Q733 848 727 848H296Q290 848 290 842V803Q290 797 296 797Z";

export default function BackloggdIcon({ size = 20 }) {
  return (
    <svg
      width={Math.round((size * 445) / 672)}
      height={size}
      viewBox={VIEWBOX}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={PATH} fillRule="evenodd" />
    </svg>
  );
}
