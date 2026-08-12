import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, UserRound, Activity as ActivityIcon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTabSwipe } from "../hooks/useTabSwipe";
import HomeFeed, { FeedUserFilter } from "../components/HomeFeed";
import ProfileFeed from "../components/ProfileFeed";
import FriendsNow from "../components/FriendsNow";

// ======================================================================
//  Activité — ce que font les autres, et ce que j'ai fait
// ======================================================================
// DEUX FILS QUI EXISTAIENT DÉJÀ, mais nulle part ensemble : celui des joueurs
// suivis vivait au milieu de l'accueil (entre les sorties, les pépites et les
// jeux gratuits), le mien était un onglet perdu au fond de mon profil. Or c'est
// la MÊME question posée deux fois — « qu'est-ce qui s'est passé » — et on passe
// son temps à sauter de l'un à l'autre. Ils sont donc côte à côte, à un onglet
// de distance, et l'accueil pourra redevenir une page d'accueil.
//
// ET UN TROISIÈME TEMPS, celui qui n'existait pas : le rail « en ce moment ».
// Un fil, par construction, est au passé — il ne dit jamais qu'un ami est DEVANT
// une partie à la seconde où on le lit. C'est pourtant la seule information qui
// appelle une action immédiate, d'où sa place : en haut à droite, visible sans
// scroller, avec un bouton pour rejoindre (voir FriendsNow).
//
// L'ONGLET EST DANS L'URL (`?t=mine`) : partageable, et surtout il survit au
// rafraîchissement — revenir sur « Amis » alors qu'on lisait ses propres
// activités est le genre de détail qui fait quitter une page.

const TABS = [
  {
    key: "friends",
    label: "Amis",
    hint: "Ce que font les joueurs que tu suis",
    Icon: Users,
  },
  {
    key: "mine",
    label: "Mes activités",
    hint: "Tout ce que tu as fait, dans l'ordre",
    Icon: UserRound,
  },
];

export default function Activity() {
  const { token, user } = useAuth();
  const [params, setParams] = useSearchParams();

  const raw = params.get("t") || "friends";
  const tab = TABS.some((t) => t.key === raw) ? raw : "friends";
  // Le filtre par joueur du fil des amis vit AUSSI dans l'URL : c'est un état de
  // lecture, il n'a pas de raison de disparaître au retour arrière.
  const feedUser = params.get("u") || null;

  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (!value) p.delete(key);
        else p.set(key, value);
        // Changer d'onglet emporte le filtre : il ne veut rien dire sur mon
        // propre fil, et le laisser traîner ferait revenir un fil filtré sans
        // qu'aucun avatar ne soit allumé.
        if (key === "t") p.delete("u");
        return p;
      },
      { replace: true }
    );

  // Sur téléphone, les deux fils se balaient du doigt — même geste que l'accueil.
  const swipe = useTabSwipe({
    onPrev: () => tab === "mine" && setParam("t", null),
    onNext: () => tab === "friends" && setParam("t", "mine"),
  });

  const heading = useMemo(() => TABS.find((t) => t.key === tab), [tab]);

  return (
    <div className="acty" {...swipe}>
      <div className="acty-main">
        <header className="acty-head">
          <div className="acty-title">
            <span className="acty-kicker">
              <ActivityIcon size={13} /> Activité
            </span>
            <h1>{heading.label}</h1>
            <p>{heading.hint}</p>
          </div>

          <nav className="acty-tabs" role="tablist" aria-label="Activité">
            <span
              className="acty-tabs-ink"
              style={{ transform: `translateX(${tab === "mine" ? "100%" : "0%"})` }}
              aria-hidden="true"
            />
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`acty-tab clickable ${tab === t.key ? "on" : ""}`}
                onClick={() => setParam("t", t.key === "friends" ? null : t.key)}
              >
                <t.Icon size={16} />
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {tab === "friends" ? (
          <>
            {/* La rangée d'avatars filtre le fil sur une personne. Elle est SOUS
                les onglets et non dedans : elle n'appartient qu'au fil des amis
                et disparaît avec lui. */}
            <div className="acty-filter">
              <FeedUserFilter
                token={token}
                myId={user?.id}
                value={feedUser}
                onChange={(id) => setParam("u", id)}
              />
            </div>
            <HomeFeed token={token} me={user?.username} filterUser={feedUser} />
          </>
        ) : (
          // Le fil du profil, tel quel — mêmes cartes, mêmes modales, mêmes
          // sous-onglets. Il n'y avait aucune raison d'en écrire un second.
          //
          // On attend de savoir QUI on est : monté sans nom d'utilisateur, il
          // partirait chercher « /feed/user/undefined » et afficherait un fil
          // vide qu'il ne rechargerait jamais.
          user?.username && (
            <ProfileFeed username={user.username} isMe token={token} />
          )
        )}
      </div>

      {/* Le direct : à droite sur grand écran, remonté AU-DESSUS du fil sur
          téléphone (`order` dans la feuille de style — le balisage, lui, garde
          l'ordre de lecture naturel). */}
      <FriendsNow token={token} />
    </div>
  );
}
