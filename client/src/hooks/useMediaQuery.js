import { useEffect, useState } from "react";

// `true` tant que la media query passe. Sert aux bascules de STRUCTURE, quand
// le CSS seul ne suffit pas (rendre un composant différent, pas juste le
// repeindre) — par ex. l'accueil qui passe en onglets sous 1240 px.
// La valeur initiale est lue en synchrone : pas de flash de la mauvaise mise
// en page au premier rendu.
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches); // la largeur a pu changer avant l'abonnement
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
