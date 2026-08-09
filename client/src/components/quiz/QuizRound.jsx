import RoundQcm from "./RoundQcm";
import RoundEmoji from "./RoundEmoji";
import RoundStudio from "./RoundStudio";
import RoundDuel from "./RoundDuel";
import RoundPixel from "./RoundPixel";
import RoundSwipe from "./RoundSwipe";
import RoundAnagram from "./RoundAnagram";
import RoundMotus from "./RoundMotus";

// ======================================================================
//  L'aiguillage des épreuves
// ======================================================================
// Un seul point d'entrée pour les huit épreuves, et le SEUL endroit du client
// qui sache lesquelles existent. La page solo et la page versus lui passent
// exactement le même contrat :
//
//   round      la manche telle que le serveur l'a servie (publicRound)
//   elapsedMs  temps écoulé depuis le départ de la manche
//   locked     ce joueur n'a plus rien à faire (trouvé, ou plus d'essais)
//   reveal     la manche est finie et la solution est affichée
//   lives      essais restants
//   candidates la liste de recherche (épreuves à saisie libre)
//   onAttempt  (given) => Promise<{ correct, ratio, lives, settled, detail }>
//   onProgress (n, texte) => void — facultatif, versus seulement
//
// `onAttempt` est LA charnière du système. En solo, la page corrige elle-même
// (elle a la solution) et résout la promesse immédiatement ; en versus, elle
// poste au serveur et résout avec sa réponse. Les composants d'épreuve ne
// savent pas dans quel mode ils tournent, et c'est exactement ce qu'on veut :
// une épreuve écrite une fois se joue seul comme à six.
const ROUNDS = {
  qcm: RoundQcm,
  emoji: RoundEmoji,
  studio: RoundStudio,
  duel: RoundDuel,
  pixel: RoundPixel,
  swipe: RoundSwipe,
  anagram: RoundAnagram,
  motus: RoundMotus,
};

export default function QuizRound(props) {
  const Component = ROUNDS[props.round?.type];
  if (!Component) {
    // Un type inconnu ne doit pas casser la partie : le serveur peut servir
    // une épreuve plus récente que le client (déploiement en cours, onglet
    // resté ouvert). On saute la manche proprement.
    return (
      <div className="qz-unknown">
        <p>Cette épreuve n'est pas reconnue par ta version du site.</p>
        <em>Recharge la page pour la mettre à jour.</em>
      </div>
    );
  }
  return (
    <div className={`qz-round t-${props.round.type}`}>
      <Component {...props} />
    </div>
  );
}

export { ROUNDS };
