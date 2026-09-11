import { Link } from "react-router-dom";
import LegalPage, { CONTACT_EMAIL } from "../components/LegalPage";

// ======================================================================
//  Conditions d'utilisation — /services
// ======================================================================
// Le contrat entre MyPlayLog et ceux qui l'utilisent. Même règle que la
// politique de confidentialité (pages/Privacy.jsx) : on n'y promet rien que le
// site ne tienne pas, et on n'y interdit rien qu'on ne soit prêt à faire
// respecter. Un texte d'avocat recopié d'ailleurs, plein de clauses qui ne
// correspondent à rien ici, protège moins qu'un texte court et juste.

const UPDATED = "12 septembre 2026";

const SECTIONS = [
  {
    id: "objet",
    title: "Ce qu'est MyPlayLog",
    body: (
      <>
        <p>
          MyPlayLog est un service gratuit, accessible sur{" "}
          <strong>myplaylog.cc</strong> et via l'application Android, qui permet
          de tenir le journal de ses jeux vidéo : bibliothèque, notes, heures de
          jeu, listes, avis — et d'échanger avec d'autres joueurs (messages,
          appels, mini-jeux).
        </p>
        <p>
          En créant un compte ou en utilisant le service, tu acceptes les
          présentes conditions ainsi que la{" "}
          <Link to="/privacy" className="link-accent">
            politique de confidentialité
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "alpha",
    title: "Un service en construction",
    body: (
      <p>
        MyPlayLog est en version alpha : des fonctions apparaissent, changent ou
        disparaissent régulièrement. Le service est fourni « en l'état », sans
        garantie de disponibilité permanente. Nous faisons de notre mieux pour
        préserver tes données, mais nous te conseillons de ne pas faire de
        MyPlayLog le seul endroit où vit une information à laquelle tu tiens.
      </p>
    ),
  },
  {
    id: "compte",
    title: "Ton compte",
    body: (
      <>
        <ul>
          <li>
            Il faut avoir au moins 15 ans, ou l'accord d'un parent ou d'un tuteur.
          </li>
          <li>
            Un compte correspond à une personne et à une adresse email. Tu peux
            t'y connecter avec ton mot de passe, avec Google ou avec Discord :
            dès lors que l'adresse est la même, c'est le même compte.
          </li>
          <li>
            Tu es responsable de ce qui se fait depuis ton compte. Garde ton mot
            de passe pour toi, et préviens-nous si tu penses que quelqu'un y a
            accédé.
          </li>
          <li>
            Ton pseudo ne doit pas usurper l'identité de quelqu'un d'autre, ni
            être injurieux.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "contenus",
    title: "Ce que tu publies",
    body: (
      <>
        <p>
          Tes avis, listes, commentaires, images, clips et messages restent à
          toi. En les publiant, tu autorises simplement MyPlayLog à les
          stocker, les afficher et les diffuser sur le site et l'application,
          dans la mesure nécessaire au fonctionnement du service et selon les
          réglages de confidentialité que tu as choisis. Cette autorisation
          prend fin lorsque tu supprimes le contenu ou ton compte.
        </p>
        <p>
          Tu t'engages à ne publier que des contenus que tu as le droit de
          partager, et qui ne sont pas :
        </p>
        <ul>
          <li>illégaux, haineux, discriminatoires ou violents ;</li>
          <li>du harcèlement, des menaces ou des propos visant une personne ;</li>
          <li>à caractère pornographique ou choquant ;</li>
          <li>
            de nature à porter atteinte aux droits d'autrui (droit d'auteur,
            marques, vie privée, données personnelles d'un tiers) ;
          </li>
          <li>du spam, de la publicité non sollicitée ou des liens malveillants.</li>
        </ul>
      </>
    ),
  },
  {
    id: "comportement",
    title: "Jouer le jeu",
    body: (
      <>
        <p>Pour que le site reste agréable pour tout le monde, il est interdit :</p>
        <ul>
          <li>
            de tricher aux mini-jeux, d'exploiter un bug ou d'utiliser un script
            pour gagner des points ;
          </li>
          <li>
            de créer plusieurs comptes pour contourner une sanction ou fausser un
            classement ;
          </li>
          <li>
            d'automatiser l'accès au service (robots, aspiration de données) ou
            de chercher à en perturber le fonctionnement ;
          </li>
          <li>
            de tenter d'accéder à un compte, une section ou des données qui ne te
            sont pas destinés.
          </li>
        </ul>
        <p>
          Si tu découvres une faille, signale-la à{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
            {CONTACT_EMAIL}
          </a>{" "}
          plutôt que de t'en servir : c'est apprécié.
        </p>
      </>
    ),
  },
  {
    id: "points",
    title: "Points, caisses et objets",
    body: (
      <p>
        Les points gagnés aux mini-jeux, les caisses et les objets cosmétiques
        (curseurs, thèmes, badges…) sont des éléments ludiques, sans aucune
        valeur monétaire. Ils ne s'achètent pas, ne se vendent pas, ne
        s'échangent pas contre de l'argent et ne sont pas remboursables. Nous
        pouvons en ajuster l'équilibre, ou retirer ceux obtenus par la triche.
      </p>
    ),
  },
  {
    id: "bot",
    title: "Le bot du site",
    body: (
      <p>
        MyPlayLog propose un bot conversationnel au caractère volontairement
        moqueur et grossier. Son accès est réservé aux comptes autorisés. Ses
        réponses sont générées automatiquement par une intelligence
        artificielle : elles peuvent être fausses, déplacées ou absurdes, et ne
        reflètent pas l'avis de l'équipe. Ne lui confie aucune information
        personnelle ou sensible.
      </p>
    ),
  },
  {
    id: "sections",
    title: "Sections réservées",
    body: (
      <p>
        Certaines sections du site ne sont ouvertes qu'à des comptes autorisés
        par l'administration. Cet accès est une faveur, pas un droit : il peut
        être accordé ou retiré à tout moment, et son usage reste soumis aux
        présentes conditions comme au respect de la loi et des droits d'autrui.
      </p>
    ),
  },
  {
    id: "tiers",
    title: "Contenus et services tiers",
    body: (
      <>
        <p>
          Les noms de jeux, jaquettes, logos et visuels affichés sur MyPlayLog
          appartiennent à leurs éditeurs et ayants droit respectifs ; les
          informations de jeux proviennent notamment d'IGDB. MyPlayLog n'est
          affilié à aucun d'entre eux.
        </p>
        <p>
          La connexion avec Google ou Discord, les imports Steam et PlayStation,
          et les vidéos YouTube sont fournis par ces services, dont les propres
          conditions s'appliquent. Nous ne sommes pas responsables de leur
          disponibilité.
        </p>
      </>
    ),
  },
  {
    id: "moderation",
    title: "Modération et sanctions",
    body: (
      <p>
        Nous pouvons retirer un contenu qui enfreint ces conditions, et
        suspendre ou supprimer un compte en cas de manquement grave ou répété —
        en principe après un avertissement, sauf urgence (contenu illégal,
        atteinte à la sécurité du service ou d'autres utilisateurs). Pour
        signaler un contenu ou contester une décision, écris à{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    ),
  },
  {
    id: "fermeture",
    title: "Fermer ton compte",
    body: (
      <p>
        Tu peux quitter MyPlayLog quand tu veux : écris à{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
          {CONTACT_EMAIL}
        </a>{" "}
        depuis l'adresse de ton compte, et nous le supprimons avec ses données
        sous 30 jours au plus (voir la{" "}
        <Link to="/privacy" className="link-accent">
          politique de confidentialité
        </Link>
        ).
      </p>
    ),
  },
  {
    id: "responsabilite",
    title: "Responsabilité",
    body: (
      <p>
        MyPlayLog est un service gratuit, fourni sans garantie. Dans les limites
        permises par la loi, nous ne pouvons être tenus responsables d'une
        interruption du service, d'une perte de données, ni des contenus publiés
        par les utilisateurs, dont chacun reste responsable. Rien dans ces
        conditions ne limite les droits que la loi te garantit en tant que
        consommateur.
      </p>
    ),
  },
  {
    id: "modifications",
    title: "Évolution des conditions",
    body: (
      <p>
        Ces conditions peuvent évoluer avec le service. La date en haut de la
        page indique la dernière modification ; en cas de changement important,
        tu seras prévenu sur le site avant son entrée en vigueur. Continuer à
        utiliser MyPlayLog après ce délai vaut acceptation.
      </p>
    ),
  },
  {
    id: "droit",
    title: "Droit applicable",
    body: (
      <p>
        Les présentes conditions sont soumises au droit français. En cas de
        désaccord, nous te proposons d'abord d'en discuter à l'amiable par
        email ; à défaut, les tribunaux compétents seront ceux prévus par la loi.
      </p>
    ),
  },
];

export default function Services() {
  return (
    <LegalPage
      eyebrow="Conditions"
      title="Conditions d'utilisation"
      intro="Les règles du jeu : ce que MyPlayLog te propose, ce qu'on attend de chacun, et ce qui se passe quand ça dérape."
      updated={UPDATED}
      sections={SECTIONS}
      other={{ to: "/privacy", label: "Lire la politique de confidentialité" }}
    />
  );
}
