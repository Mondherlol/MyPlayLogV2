import { Link } from "react-router-dom";
import { Heart, MessageCircle } from "lucide-react";
import BingoGrid from "./BingoGrid";

/**
 * La grille de quelqu'un, en vignette.
 *
 * ⚠️ LA GRILLE EST LE SUJET, PAS L'AUTEUR. On parcourt ce rail pour voir CE QUE
 * les autres ont pronostiqué — un rail d'avatars avec un compteur ne donnerait
 * envie d'en ouvrir aucune. D'où la miniature de la grille en grand, et le nom
 * en dessous, en petit.
 */
export default function BingoCard({ grid }) {
  return (
    <Link to={`/bingo/${grid.id}`} className="bg-card clickable" title={grid.title || "Grille"}>
      <div className="bg-card-grid">
        <BingoGrid cells={grid.cells} size={grid.size} compact />
      </div>

      <div className="bg-card-foot">
        <span className="bg-card-av">
          {grid.author?.avatar ? (
            <img src={grid.author.avatar} alt="" loading="lazy" />
          ) : (
            (grid.author?.username || "?").charAt(0).toUpperCase()
          )}
        </span>
        <span className="bg-card-name">{grid.author?.username || "Quelqu'un"}</span>
        {grid.likeCount > 0 && (
          <span className="bg-card-stat">
            <Heart size={11} fill={grid.liked ? "currentColor" : "none"} /> {grid.likeCount}
          </span>
        )}
        {grid.commentCount > 0 && (
          <span className="bg-card-stat">
            <MessageCircle size={11} /> {grid.commentCount}
          </span>
        )}
      </div>
    </Link>
  );
}
