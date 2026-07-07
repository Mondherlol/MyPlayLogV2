import { useNavigate } from "react-router-dom";
import { User } from "lucide-react";
import AnnotationBubble from "./AnnotationBubble";

// Card d'un personnage dans une liste (mode lecture). Cliquable vers le jeu
// d'origine (si connu), avec la bulle d'annotation de l'auteur.
export default function ListCharacterCard({ item, rank }) {
  const navigate = useNavigate();
  const clickable = !!item.gameId;
  return (
    <article
      className={`lg-card char ${clickable ? "clickable" : ""}`}
      onClick={() => clickable && navigate(`/game/${item.gameId}`)}
    >
      {rank != null && <span className="lg-rank">{rank}</span>}

      <div className="lg-cover">
        {item.image ? (
          <img src={item.image} alt={item.name} loading="lazy" draggable="false" />
        ) : (
          <div className="game-nocover">
            <User size={30} />
          </div>
        )}
        <div className="lg-overlay">
          <h3 className="lg-title">{item.name}</h3>
          {item.gameName && <span className="lg-sub">{item.gameName}</span>}
        </div>
      </div>

      <AnnotationBubble note={item.note} media={item.media} />
    </article>
  );
}
