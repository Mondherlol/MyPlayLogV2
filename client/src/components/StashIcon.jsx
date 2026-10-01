// Le logo de Stash, repris tel quel de leur SVG officiel
// (stash.games/images/logo-dark.svg) : la barre oblique jaune et les lettres.
// Les lettres suivent `currentColor` (blanches sur fond sombre, encre sur fond
// clair) ; la barre garde le jaune de la marque.
//
// Deux formes : `StashMark`, le « /s » carré de l'icône de leur appli (tuiles,
// pastilles), et `StashWordmark`, le logo en entier (en-tête de la modale).

const SLASH = "4.5,29.7 0,29.7 8.6,0.3 13.1,0.3";
const SLASH_COLOR = "#F7BF00";

const S =
  "M14.4,11.8c0-3.4,3-5.7,7.5-5.7c4.6,0,7.5,2.4,7.6,5.9H25c-0.2-1.5-1.2-2.4-3.1-2.4c-1.7,0-2.8,0.8-2.8,2" +
  "c0,0.9,0.7,1.5,2.5,1.9l3.1,0.7c3.8,0.8,5.3,2.3,5.3,4.9c0,3.5-3.2,5.9-7.9,5.9c-5,0-7.8-2.3-8.1-5.9h4.8" +
  "c0.3,1.6,1.4,2.4,3.4,2.4c1.8,0,3-0.8,3-1.9c0-1-0.6-1.5-2.4-1.9L19.6,17C16.2,16.2,14.4,14.5,14.4,11.8z";
const T =
  "M33.7,2.4h4.9v4.1h3.3v3.7h-3.3v8.6c0,1.4,0.7,2,2.1,2c0.4,0,0.9,0,1.2-0.1v3.6c-0.5,0.1-1.3,0.2-2.3,0.2" +
  "c-4.2,0-5.9-1.4-5.9-4.9v-9.4h-2.5V6.5h2.5V2.4z";
const A =
  "M52.6,6.1c-4.8,0-7.7,2.4-7.9,5.9h4.5c0.2-1.3,1.4-2.2,3.2-2.2c1.8,0,3,1,3,2.6v1.2l-4.5,0.3c-4.5,0.3-7,2.2-7,5.4" +
  "c0,3.2,2.6,5.4,6,5.4c2.2,0,4.5-1.1,5.5-3h0.1v2.7h4.7V12.1C60.2,8.5,57.2,6.1,52.6,6.1z M55.4,17.9c0,1.9-1.8,3.3-3.9,3.3" +
  "c-1.7,0-2.8-0.8-2.8-2.2c0-1.3,1-2.1,2.9-2.2l3.8-0.2V17.9z";
const S2 =
  "M63.1,11.8c0-3.4,3-5.7,7.5-5.7c4.6,0,7.5,2.4,7.6,5.9h-4.5c-0.2-1.5-1.2-2.4-3.1-2.4c-1.7,0-2.8,0.8-2.8,2" +
  "c0,0.9,0.7,1.5,2.5,1.9l3.1,0.7c3.8,0.8,5.3,2.3,5.3,4.9c0,3.5-3.2,5.9-7.9,5.9c-5,0-7.8-2.3-8.1-5.9h4.8" +
  "c0.3,1.6,1.4,2.4,3.4,2.4c1.8,0,3-0.8,3-1.9c0-1-0.6-1.5-2.4-1.9L68.3,17C64.8,16.2,63.1,14.5,63.1,11.8z";
const H =
  "M81.2,24.5V0.3H86v9.4h0.1c1-2.3,2.9-3.5,5.7-3.5c4,0,6.3,2.6,6.3,6.7v11.6h-4.9V14c0-2.3-1.1-3.7-3.4-3.7" +
  "c-2.3,0-3.7,1.6-3.7,4v10.3H81.2z";

/** Le « /s » de l'icône de l'appli Stash. */
export function StashMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="-1 -0.5 31.5 31" aria-hidden="true">
      <polygon points={SLASH} fill={SLASH_COLOR} />
      <path d={S} fill="currentColor" />
    </svg>
  );
}

/** Le logo complet, « /stash ». `height` en pixels ; la largeur suit. */
export function StashWordmark({ height = 20 }) {
  return (
    <svg
      width={Math.round((height * 98) / 30)}
      height={height}
      viewBox="0 0 98 30"
      role="img"
      aria-label="Stash"
    >
      <polygon points={SLASH} fill={SLASH_COLOR} />
      <path d={`${S}${T}${A}${S2}${H}`} fill="currentColor" />
    </svg>
  );
}
