import GameCard from "./GameCard";
import AnnotationBubble from "./AnnotationBubble";

// Card d'un jeu dans une liste (mode lecture, listes classiques/rankées).
// Réutilise entièrement GameCard (lien vers le jeu + menu d'actions radial :
// ajouter à une liste / j'y ai joué / wishlist), et superpose le rang et la
// bulle d'annotation de l'auteur.
export default function ListGameCard({ item, rank }) {
  const game = {
    id: item.gameId,
    name: item.name,
    cover: item.image,
  };
  return (
    <div className="lg-wrap">
      {rank != null && <span className="lg-rank">{rank}</span>}
      <GameCard game={game} variant="grid" />
      <AnnotationBubble note={item.note} media={item.media} />
    </div>
  );
}
