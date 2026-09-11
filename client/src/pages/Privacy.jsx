import LegalPage, { CONTACT_EMAIL } from "../components/LegalPage";

// ======================================================================
//  Politique de confidentialité — /privacy
// ======================================================================
// ⚠️ CE TEXTE DÉCRIT CE QUE LE CODE FAIT, PAS CE QU'IL SERAIT BIEN QU'IL
// FASSE. Chaque affirmation ci-dessous a été vérifiée dans le serveur au moment
// de l'écriture (champs de models/User.js, journaux de lib/audit.js effacés au
// bout de 14 jours, jetons OAuth jamais conservés, aucun outil de mesure
// d'audience côté client…). Ajouter un service tiers, un traceur, ou changer
// une durée de conservation SANS mettre cette page à jour, c'est la rendre
// fausse — et c'est elle que Google et Discord lisent pour autoriser la
// connexion par leurs comptes.
//
// La section « Données Google » n'est pas décorative : Google exige qu'elle
// dise noir sur blanc ce qu'on fait des données obtenues par ses API, et
// qu'on s'engage sur sa politique d'« usage limité ».

const UPDATED = "12 septembre 2026";

const SECTIONS = [
  {
    id: "qui",
    title: "Qui s'occupe de tes données ?",
    body: (
      <>
        <p>
          MyPlayLog est un journal de jeux vidéo : tu y ranges ta bibliothèque,
          tes notes, tes listes, et tu échanges avec d'autres joueurs. Le site{" "}
          <strong>myplaylog.cc</strong> et l'application Android sont édités par
          l'équipe MyPlayLog, responsable du traitement de tes données.
        </p>
        <p>
          Pour toute question ou demande, un seul contact :{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "collecte",
    title: "Qu'est-ce qu'on garde ?",
    body: (
      <>
        <p>Uniquement ce dont le site a besoin pour fonctionner :</p>
        <ul>
          <li>
            <strong>Ton compte</strong> : ton adresse email, ton pseudo et ton
            mot de passe — que l'on ne connaît pas : seule une empreinte
            chiffrée (bcrypt) est stockée. Un compte ouvert avec Google ou
            Discord n'a pas de mot de passe du tout.
          </li>
          <li>
            <strong>Ton profil</strong> : photo, bannière, bio, et tout ce que tu
            choisis d'y afficher.
          </li>
          <li>
            <strong>Ce que tu publies</strong> : ta bibliothèque, tes notes, tes
            heures de jeu, tes avis, tes listes, tes commentaires, tes clips.
          </li>
          <li>
            <strong>Tes messages</strong> : les conversations privées et de
            groupe (texte, images, messages vocaux), pour qu'elles te
            suivent d'un appareil à l'autre.
          </li>
          <li>
            <strong>Les comptes que tu relies</strong> : pour Google, ton
            identifiant, ton adresse, ton nom et ta photo ; pour Discord, ton
            identifiant, ton pseudo et ton avatar ; pour Steam et PlayStation,
            ton identifiant public et ton pseudo, afin d'importer tes jeux.
          </li>
          <li>
            <strong>Ton activité sur le site</strong> : ta dernière visite
            (le « en ligne il y a… » du profil), ta série de connexions, tes
            points et objets gagnés aux mini-jeux.
          </li>
          <li>
            <strong>Ton téléphone</strong>, si tu installes l'app : un jeton de
            notification, qui ne sert qu'à t'envoyer tes notifications.
          </li>
          <li>
            <strong>Des journaux techniques</strong> : adresse IP et type de
            navigateur lors des connexions et de certaines actions, pour
            détecter les tentatives d'intrusion. Ils s'effacent
            automatiquement au bout de 14 jours.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "usage",
    title: "À quoi ça sert ?",
    body: (
      <>
        <p>
          À faire fonctionner MyPlayLog, et à rien d'autre : t'identifier,
          afficher ton profil et ta bibliothèque, livrer tes messages et tes
          notifications, t'envoyer un lien si tu oublies ton mot de passe,
          protéger les comptes contre les abus.
        </p>
        <p>
          <strong>
            Pas de publicité, pas de revente, pas de profilage commercial.
          </strong>{" "}
          Aucun outil de mesure d'audience ni traceur publicitaire n'est
          installé sur le site.
        </p>
        <p>
          Ces traitements reposent sur l'exécution du service que tu utilises
          (ton compte, tes contenus) et sur notre intérêt légitime à le
          sécuriser (journaux techniques).
        </p>
      </>
    ),
  },
  {
    id: "google",
    title: "Données obtenues via Google",
    body: (
      <>
        <p>
          Si tu te connectes avec Google, nous demandons uniquement les accès{" "}
          <code>openid</code>, <code>email</code> et <code>profile</code>. Nous
          recevons ton identifiant Google, ton adresse email (et le fait
          qu'elle est vérifiée), ton nom et ta photo de profil.
        </p>
        <p>Ces informations servent exclusivement à :</p>
        <ul>
          <li>te connecter à ton compte MyPlayLog ;</li>
          <li>
            retrouver ton compte existant s'il porte la même adresse email,
            pour que Google, Discord et ton mot de passe ouvrent le même
            compte ;
          </li>
          <li>créer ton compte si tu n'en as pas, avec ta photo comme avatar.</li>
        </ul>
        <p>
          Nous n'avons accès ni à ta boîte mail, ni à tes contacts, ni à tes
          fichiers. Le jeton d'accès fourni par Google est utilisé une seule
          fois pour lire ton profil, puis abandonné : il n'est jamais stocké.
        </p>
        <p>
          L'utilisation et le transfert des informations reçues des API Google
          respectent la{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="link-accent"
          >
            politique relative aux données utilisateur des services d'API Google
          </a>
          , y compris les exigences d'usage limité (« Limited Use »). Ces
          données ne sont ni vendues, ni utilisées à des fins publicitaires, ni
          transmises à des tiers.
        </p>
      </>
    ),
  },
  {
    id: "tiers",
    title: "Avec qui on les partage ?",
    body: (
      <>
        <p>
          Personne n'achète tes données. Certains services extérieurs
          interviennent toutefois quand tu utilises une fonction précise, et
          reçoivent alors le strict nécessaire :
        </p>
        <ul>
          <li>
            <strong>Google et Discord</strong> — quand tu choisis de te
            connecter ou de relier ton compte avec eux.
          </li>
          <li>
            <strong>Steam et PlayStation Network</strong> — ton identifiant
            public, quand tu importes tes jeux ou tes trophées.
          </li>
          <li>
            <strong>Groq et Google Gemini</strong> — les messages que tu
            adresses au bot du site, pour qu'il puisse répondre. Rien d'autre
            ne leur est envoyé, et si tu ne parles pas au bot, rien du tout.
          </li>
          <li>
            <strong>Expo</strong> — ton jeton de notification et le contenu
            de la notification, pour la livrer sur ton téléphone.
          </li>
          <li>
            <strong>Gmail</strong> — ton adresse, quand le site t'envoie un
            email (réinitialisation du mot de passe).
          </li>
          <li>
            <strong>YouTube</strong> — les vidéos et bandes-son intégrées sont
            lues via le lecteur YouTube, qui peut déposer ses propres cookies
            lorsque tu lances une lecture.
          </li>
          <li>
            <strong>Appels vocaux</strong> — ils passent de préférence
            directement entre les participants ; pour établir la connexion, ton
            adresse IP est visible de ton correspondant et d'un serveur de
            Google (STUN). À défaut, l'appel transite par notre propre relais.
          </li>
        </ul>
        <p>
          Les informations sur les jeux (jaquettes, dates, studios) viennent de
          bases publiques comme IGDB : ces requêtes ne contiennent aucune
          donnée te concernant.
        </p>
        <p>
          Enfin, nous pourrions être tenus de communiquer des données sur
          demande d'une autorité judiciaire, dans le cadre prévu par la loi.
        </p>
      </>
    ),
  },
  {
    id: "visible",
    title: "Qu'est-ce que les autres voient ?",
    body: (
      <>
        <p>
          Par défaut, ton profil est public : ton pseudo, ta photo, ta
          bibliothèque, tes notes et tes listes peuvent être vus par tous, y
          compris sans compte. Ton adresse email, elle, n'est jamais affichée.
        </p>
        <p>
          Dans <strong>Paramètres → Confidentialité</strong>, tu peux passer ton
          compte en privé (seuls tes abonnés acceptés voient ton contenu),
          masquer ta photo, ta bannière ou tes avis.
        </p>
      </>
    ),
  },
  {
    id: "stockage",
    title: "Cookies et stockage local",
    body: (
      <>
        <p>
          MyPlayLog ne dépose pas de cookie. Ta session et tes préférences
          (thème, réglages d'affichage, caches) sont rangées dans le stockage
          local de ton navigateur : elles restent sur ton appareil et
          disparaissent quand tu te déconnectes ou vides les données du site.
        </p>
        <p>
          Seul le lecteur YouTube, lorsque tu lances une vidéo, peut déposer
          des cookies qui lui sont propres.
        </p>
      </>
    ),
  },
  {
    id: "duree",
    title: "Combien de temps ?",
    body: (
      <ul>
        <li>
          <strong>Ton compte et tes contenus</strong> : tant que ton compte
          existe. Ils sont supprimés quand tu le fermes.
        </li>
        <li>
          <strong>Les journaux techniques</strong> : 14 jours, puis effacement
          automatique.
        </li>
        <li>
          <strong>Un lien de réinitialisation de mot de passe</strong> : valable
          1 heure.
        </li>
        <li>
          <strong>Un compte relié</strong> (Google, Discord, Steam, PlayStation)
          : jusqu'à ce que tu le délies.
        </li>
      </ul>
    ),
  },
  {
    id: "securite",
    title: "Comment on les protège ?",
    body: (
      <p>
        Les échanges avec le site sont chiffrés (HTTPS). Les mots de passe ne
        sont conservés que sous forme d'empreinte, les liens de réinitialisation
        sous forme hachée, et aucun jeton d'accès Google ou Discord n'est
        stocké. Les tentatives de connexion répétées sont limitées et
        journalisées. Aucun système n'étant infaillible, nous te prévenons si
        une faille venait à toucher tes données.
      </p>
    ),
  },
  {
    id: "droits",
    title: "Tes droits",
    body: (
      <>
        <p>
          Conformément au RGPD, tu peux à tout moment accéder à tes données, les
          corriger, les récupérer, t'opposer à un traitement ou demander leur
          suppression.
        </p>
        <ul>
          <li>
            <strong>Corriger ton profil</strong> : directement depuis le site.
          </li>
          <li>
            <strong>Délier Google ou Discord</strong> : Paramètres → Compte. Tu
            peux aussi retirer l'accès depuis{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="link-accent"
            >
              ton compte Google
            </a>
            .
          </li>
          <li>
            <strong>Supprimer ton compte ou obtenir une copie de tes données</strong>{" "}
            : écris à{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link-accent">
              {CONTACT_EMAIL}
            </a>{" "}
            depuis l'adresse de ton compte. La demande est traitée sous 30 jours
            au plus.
          </li>
        </ul>
        <p>
          Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la{" "}
          <a
            href="https://www.cnil.fr/fr/plaintes"
            target="_blank"
            rel="noreferrer"
            className="link-accent"
          >
            CNIL
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "mineurs",
    title: "Et les plus jeunes ?",
    body: (
      <p>
        MyPlayLog s'adresse aux personnes de 15 ans et plus. En dessous, la
        création d'un compte nécessite l'accord d'un parent ou d'un tuteur. Si
        tu penses qu'un enfant nous a confié des données sans cet accord,
        préviens-nous et nous les supprimerons.
      </p>
    ),
  },
  {
    id: "changements",
    title: "Si ce texte change",
    body: (
      <p>
        MyPlayLog évolue vite, et cette page suivra. La date en haut indique la
        dernière modification ; en cas de changement important sur l'usage de
        tes données, tu seras prévenu sur le site avant qu'il ne s'applique.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      eyebrow="Confidentialité"
      title="Politique de confidentialité"
      intro="Ce qu'on garde sur toi, pourquoi, avec qui c'est partagé, et comment tout reprendre. Sans jargon quand c'est possible."
      updated={UPDATED}
      sections={SECTIONS}
      other={{ to: "/services", label: "Lire les conditions d'utilisation" }}
    />
  );
}
