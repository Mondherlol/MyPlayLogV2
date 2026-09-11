// Le sélecteur de note, dans l'échelle réglée par l'utilisateur.
//
// Un seul composant à appeler partout où l'on note (la modale de suivi, la
// fiche du jeu, le panneau des avis) : il choisit entre la jauge sur 100 et les
// cinq étoiles. Les deux parlent la MÊME valeur — une note sur 100 —, donc
// changer d'échelle ne demande rien aux appelants et ne touche à aucune donnée
// (cf. lib/ratingScale.js).

import RatingGauge from "./RatingGauge";
import StarRating from "./StarRating";
import { useRatingScale, SCALE_STARS } from "../lib/ratingScale";

export default function RatingInput(props) {
  const scale = useRatingScale();
  return scale === SCALE_STARS ? <StarRating {...props} /> : <RatingGauge {...props} />;
}
