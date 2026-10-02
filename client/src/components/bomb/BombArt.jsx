import { PiSkullFill } from "react-icons/pi";
import { API_BASE } from "../../lib/api";

// ======================================================================
//  La bombe (La Bombe, pages/Bomb.jsx)
// ======================================================================
// Le modèle donné par l'utilisateur : une sphère ardoise à plat (ombre en
// croissant en bas à droite, reflet ovale en haut à gauche), un col sombre
// incliné, une mèche claire qui part en courbe, et au bout une étincelle en
// étoile rouge et jaune. Sur la panse : une tête de mort (Phosphor) — ou le
// dessin du joueur qui tient la bombe (components/bomb/BombStudio.jsx).
//
// `skin` : { color, v } de ce joueur (v = version de son dessin, 0 = aucun).
// La couleur du corps est une variable : l'ombre, le reflet et le col en sont
// dérivés (color-mix), donc toute couleur choisie garde le même modelé.
// `--heat` (0 → 1), posé par l'appelant, fait rougir la bombe.
export const DEFAULT_BOMB = "#34445b";

export { PiSkullFill as BombSkull };

export function skinUrl(ownerId, v) {
  return v ? `${API_BASE}/bombe/skin/${ownerId}.png?v=${v}` : null;
}

// `body` : ce qu'on met sur la panse à la place du motif (l'atelier y pose
// son canevas : on dessine directement sur la bombe).
export default function BombArt({ skin, ownerId, lit = true, drawing = null, body = null, className = "" }) {
  const color = skin?.color || DEFAULT_BOMB;
  const img = drawing === null ? skinUrl(ownerId, skin?.v) : drawing;
  return (
    <span className={`bba ${lit ? "lit" : ""} ${className}`} style={{ "--skin": color }} aria-hidden="true">
      <span className="bba-fuse" />
      <span className="bba-cap">
        <i />
      </span>
      {lit && (
        <span className="bba-spark">
          <i className="out" />
          <i className="in" />
        </span>
      )}
      <span className="bba-body">
        {body || (img ? <img src={img} alt="" draggable="false" /> : <PiSkullFill className="bba-skull" />)}
        <i className="bba-shade" />
        <i className="bba-shine" />
      </span>
    </span>
  );
}
