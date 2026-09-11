import { apiFetch } from "./api";

// Les chiffres et les jaquettes de la page publique (GET /api/stats).
//
// ⚠️ UNE SEULE REQUÊTE POUR TOUTE LA PAGE, ET C'EST TOUT L'OBJET DE CE FICHIER.
// Deux composants la veulent — la page d'accueil pour ses totaux, le décor pour
// ses jaquettes — et ils ne se connaissent pas : chacun de son côté, ça faisait
// deux appels identiques au chargement. La promesse est gardée ici, donc le
// second arrivant attend le premier au lieu de redemander.
let pending = null;

const EMPTY = {
  games: 0,
  players: 0,
  lists: 0,
  osts: 0,
  characters: 0,
  hours: 0,
  covers: [],
};

export function loadPublicStats() {
  if (!pending) {
    // Un échec ne doit pas condamner la page : on retombe sur des zéros, que
    // l'accueil sait masquer et dont le décor sait se passer.
    pending = apiFetch("/stats").catch(() => EMPTY);
  }
  return pending;
}
