import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  UserPlus,
  Users,
  LogOut,
  Loader2,
  Unplug,
  Radio,
  Play,
  Clapperboard,
  MessageCircle,
  Lock,
  Unlock,
  Copy,
  Check,
  Popcorn,
  Zap,
  Timer,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import useMediaQuery from "../hooks/useMediaQuery";
import { useWatchParty } from "../hooks/useWatchParty";
import WatchPartyStage from "../components/WatchPartyStage";
import WatchPartyChat from "../components/WatchPartyChat";
import WatchPartyPicker from "../components/WatchPartyPicker";
import WatchPartyInvite from "../components/WatchPartyInvite";

// ======================================================================
//  /watchparty/:code — la salle
// ======================================================================
// Trois zones, et l'ordre de lecture est celui de l'importance : l'IMAGE au
// centre, le SALON à droite, la salle elle-même (qui est là, qui pilote, quoi
// regarder) dans une barre en haut.
//
// LA PAGE PREND TOUT L'ÉCRAN. `wp-open` annule le rembourrage de `.app-content`
// (même mécanique que la messagerie) et la sidebar se replie d'elle-même : une
// séance partagée est une page immersive, pas un contenu dans une colonne.
//
// TROIS ÉTATS, ET IL FAUT LES TROIS :
//   • LE SALON D'ATTENTE, avant d'entrer. On ne tombe pas dans une séance en
//     cours sans savoir ce qu'on regarde ni avec qui — d'autant qu'un lecteur
//     qui démarre tout seul, son plein volume avec, est une petite agression ;
//   • LA SALLE, une fois entré ;
//   • LA FIN, quand l'hôte est parti. Sans elle, l'image se figerait sans un mot.

export default function WatchParty() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const compact = useMediaQuery("(max-width: 1000px)");
  const { docks, closeDock } = useChat();

  const pt = useWatchParty({ code, token, me: user });
  const { party, media, status, ended, isHost, canControl, members } = pt;

  // Ouvrir la fenêtre d'invitation dès l'arrivée : c'est le chemin normal quand
  // on vient de créer la salle depuis une fiche (`?invite=1`).
  const [invite, setInvite] = useState(false);
  const [picker, setPicker] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [copied, setCopied] = useState(false);
  // CE QUI EST VRAI TOUT LE TEMPS N'A RIEN À FAIRE SUR L'IMAGE. Le mode de
  // synchro et le nom du pilote étaient posés en pastilles par-dessus la vidéo :
  // ils y masquaient le coin du film pendant deux heures pour une information
  // qui ne change que trois fois par séance. Ils remontent donc ici, dans la
  // barre d'état — et c'est l'écran qui, lui, les fait connaître (`onMode`),
  // puisque le lecteur branché n'est connu que de la séance vidéo.
  const [mode, setMode] = useState(null); // { piloted, label, host }
  const onMode = useCallback((m) => setMode(m), []);

  useEffect(() => {
    if (params.get("invite") !== "1" || status !== "ready") return;
    setInvite(true);
    const next = new URLSearchParams(params);
    next.delete("invite");
    setParams(next, { replace: true });
  }, [params, setParams, status]);

  // Page immersive : plus de rembourrage, sidebar repliée le temps de la séance.
  useEffect(() => {
    document.body.classList.add("wp-open");
    window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: true }));
    return () => {
      document.body.classList.remove("wp-open");
      window.dispatchEvent(new CustomEvent("mpl:sidebar-force", { detail: false }));
    };
  }, []);

  // ON ARRIVE DANS LA SALLE SANS SA VALISE. Les fenêtres de discussion flottantes
  // survivent aux changements de page : accepter une invitation depuis un DM
  // amenait donc la conversation avec soi, posée par-dessus le film. On les
  // referme À L'ARRIVÉE, une fois — et une seule : les rouvrir pendant la séance
  // reste possible (par la topbar), parce que c'est alors un geste voulu et non
  // un reste de la page précédente.
  const docksRef = useRef({ docks, closeDock });
  docksRef.current = { docks, closeDock };
  useEffect(() => {
    const { docks: open, closeDock: shut } = docksRef.current;
    open.forEach((d) => shut(d.id));
  }, []);

  // Le lecteur est remonté quand ON CHANGE DE TITRE, et seulement là : changer
  // d'épisode se fait DANS la séance (elle sait le faire, et le remontage
  // couperait l'image pour rien).
  const stageKey = useMemo(() => {
    const c = party?.content;
    if (!c) return "none";
    return c.type === "youtube" ? `yt-${c.videoId}` : `co-${c.slug}`;
  }, [party?.content]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("?")[0]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papier refusé : la fenêtre d'invitation a un champ à copier */
    }
  }

  // --- Sortir de la salle ----------------------------------------------------
  // PARTIR EST UN GESTE, MÊME QUAND ON NE LE DIT PAS. Cliquer sur la sidebar,
  // revenir en arrière, ouvrir un autre titre : pour la salle, c'est pareil que
  // d'appuyer sur « Quitter » — et les autres doivent le voir (la tête qui
  // s'éteint en haut, la ligne dans le fil). Sans ça, un invité parti restait
  // affiché toute la soirée et on l'attendait pour lancer la suite.
  //
  // TROIS PRÉCAUTIONS, et chacune répare un cas vécu :
  //   • L'HÔTE NE PART PAS EN NAVIGUANT. Sa sortie FERME la salle : la déclencher
  //     sur un clic de travers tuerait la séance de tout le monde. Lui doit
  //     passer par le bouton, qui dit « Fermer » et pas « Quitter » ;
  //   • UNE FOIS SUFFIT (`left`) : le bouton quitte déjà avant de naviguer, le
  //     démontage ne doit pas repasser derrière lui ;
  //   • RECHARGER N'EST PAS PARTIR. Un rafraîchissement ne démonte pas React :
  //     rien n'est envoyé, et c'est voulu — on revient dans la même salle. Le
  //     flux temps réel tombe une seconde, la tête s'éteint puis se rallume.
  const left = useRef(false);
  const leaveRef = useRef(null);
  leaveRef.current = { isHost, member: !!party?.member, leave: pt.leave };
  useEffect(
    () => () => {
      const { isHost: host, member, leave: doLeave } = leaveRef.current;
      if (left.current || host || !member) return;
      left.current = true;
      doLeave();
    },
    []
  );

  async function quit() {
    left.current = true;
    await pt.leave();
    navigate("/collection");
  }

  // ---------------------------------------------------------------- états
  if (status === "loading")
    return (
      <div className="wp-state">
        <Loader2 size={26} className="spin" />
        <p>On ouvre la salle…</p>
      </div>
    );

  if (status === "gone" || !party)
    return (
      <div className="wp-state">
        <span className="wp-state-icon">
          <Unplug size={24} />
        </span>
        <strong>Cette séance n'existe plus</strong>
        <p>
          L'hôte l'a fermée, ou le lien a expiré. Une salle s'efface quelques
          heures après le dernier signe de vie.
        </p>
        <Link to="/collection" className="btn btn-ghost clickable">
          <ArrowLeft size={15} /> Retour à la collection
        </Link>
      </div>
    );

  if (ended)
    return (
      <div className="wp-state">
        <span className="wp-state-icon">
          <Popcorn size={24} />
        </span>
        <strong>La séance est terminée</strong>
        <p>L'hôte a fermé la salle. C'était bien.</p>
        <div className="wp-state-row">
          <Link to="/collection" className="btn btn-ghost clickable">
            <ArrowLeft size={15} /> La collection
          </Link>
          {party.content?.slug && (
            <Link to={`/collection/${party.content.slug}`} className="btn btn-primary clickable">
              Revoir « {party.content.title} » seul
            </Link>
          )}
        </div>
      </div>
    );

  // LE SALON D'ATTENTE. Volontairement calme : une affiche, qui invite, qui est
  // déjà là, et un seul bouton.
  if (!party.member)
    return (
      <div className="wp-lobby">
        {party.content.poster && (
          <img className="wp-lobby-bg" src={party.content.poster} alt="" />
        )}
        <span className="wp-lobby-veil" aria-hidden="true" />
        <div className="wp-lobby-card">
          <span className="wp-live">
            <i /> Séance en cours
          </span>
          {party.content.poster && (
            <img className="wp-lobby-art" src={party.content.poster} alt="" />
          )}
          <p className="wp-lobby-who">
            <strong>{party.host?.username}</strong> t'invite à regarder
          </p>
          <h1>{party.content.title}</h1>
          {party.content.subtitle && <p className="wp-lobby-sub">{party.content.subtitle}</p>}

          <div className="wp-lobby-faces">
            {members.slice(0, 6).map((m) => (
              <span key={m.id} className={`wp-face ${m.online ? "on" : ""}`} title={m.username}>
                {m.avatar ? <img src={m.avatar} alt="" /> : <i>{m.username.slice(0, 1)}</i>}
              </span>
            ))}
            <em>
              {members.length} {members.length > 1 ? "personnes" : "personne"} dans la salle
            </em>
          </div>

          <button className="btn btn-primary clickable wp-lobby-go" onClick={pt.join}>
            <Play size={17} fill="currentColor" /> Rejoindre la séance
          </button>
          <Link to="/collection" className="wp-lobby-back clickable">
            Non merci, retour à la collection
          </Link>
        </div>
      </div>
    );

  // ---------------------------------------------------------------- la salle
  const online = members.filter((m) => m.online).length;

  return (
    <div className={`wp-page ${showChat ? "" : "no-chat"}`}>
      <header className="wp-top">
        <div className="wp-top-left">
          <Link to="/collection" className="wp-top-back clickable" title="Quitter l'écran">
            <ArrowLeft size={17} />
          </Link>
          <span className="wp-live" title={`${online} en ligne`}>
            <i /> Watchparty
          </span>
          <div className="wp-top-title">
            <strong>{party.content.title}</strong>
            {party.content.subtitle && <em>{party.content.subtitle}</em>}
          </div>

          {/* L'état de la séance, à sa place : dans la barre d'état. */}
          {mode && (
            <div className="wp-top-state">
              <span className={`wp-badge ${mode.piloted ? "auto" : "guided"}`}>
                {mode.piloted ? <Zap size={12} /> : <Timer size={12} />}
                {mode.piloted ? "Synchro auto" : "Synchro guidée"}
              </span>
              {!canControl && (
                <span className="wp-badge lock">
                  <Lock size={12} />
                  {members.find((m) => m.isHost)?.username || "L'hôte"} pilote
                </span>
              )}
              {canControl && !isHost && (
                <span className="wp-badge open">
                  <Radio size={12} /> Tu peux piloter
                </span>
              )}
            </div>
          )}
        </div>

        <div className="wp-top-right">
          {/* Les têtes : qui est là, et qui pilote (l'anneau doré). */}
          <div className="wp-faces">
            {members.slice(0, 5).map((m) => (
              <span
                key={m.id}
                className={`wp-face ${m.online ? "on" : ""} ${m.isHost ? "host" : ""}`}
                title={`${m.username}${m.isHost ? " — hôte" : ""}`}
              >
                {m.avatar ? <img src={m.avatar} alt="" /> : <i>{m.username.slice(0, 1)}</i>}
              </span>
            ))}
            {members.length > 5 && <span className="wp-face more">+{members.length - 5}</span>}
          </div>

          {isHost && (
            <button
              className={`wp-top-btn clickable ${party.openControl ? "on" : ""}`}
              onClick={() => pt.setOpenControl(!party.openControl)}
              title={
                party.openControl
                  ? "Reprendre la télécommande"
                  : "Laisser tout le monde piloter la lecture"
              }
            >
              {party.openControl ? <Unlock size={15} /> : <Lock size={15} />}
              <span>{party.openControl ? "Libre" : "Hôte"}</span>
            </button>
          )}

          {canControl && (
            <button
              className="wp-top-btn clickable"
              onClick={() => setPicker(true)}
              title="Changer de film / série / vidéo"
            >
              <Clapperboard size={15} />
              <span>Changer</span>
            </button>
          )}

          <button className="wp-top-btn clickable" onClick={copyLink} title="Copier le lien">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>

          <button className="wp-top-btn accent clickable" onClick={() => setInvite(true)}>
            <UserPlus size={15} />
            <span>Inviter</span>
          </button>

          <button
            className={`wp-top-btn clickable only-compact ${showChat ? "on" : ""}`}
            onClick={() => setShowChat((v) => !v)}
            title="Le salon"
          >
            <MessageCircle size={15} />
          </button>

          <button
            className="wp-top-btn danger clickable"
            onClick={quit}
            title={isHost ? "Fermer la séance pour tout le monde" : "Quitter la séance"}
          >
            <LogOut size={15} />
            <span>{isHost ? "Fermer" : "Quitter"}</span>
          </button>
        </div>
      </header>

      {pt.error && <p className="wp-alert">{pt.error}</p>}

      <main className="wp-main">
        {media ? (
          <WatchPartyStage
            key={stageKey}
            pt={pt}
            media={media}
            onOpenPicker={() => setPicker(true)}
            onMode={onMode}
          />
        ) : (
          <div className="wp-state inline">
            <Unplug size={22} />
            <strong>Rien à jouer</strong>
            <p>Ce titre n'a plus de source disponible.</p>
            {canControl && (
              <button className="btn btn-primary clickable" onClick={() => setPicker(true)}>
                <Clapperboard size={15} /> Choisir autre chose
              </button>
            )}
          </div>
        )}

        {(showChat || !compact) && (
          <WatchPartyChat
            pt={pt}
            compact={compact}
            onClose={compact ? () => setShowChat(false) : null}
          />
        )}
      </main>

      {/* Un rappel discret quand on est encore seul : une séance sans personne
          est le seul cas où l'invitation est LA prochaine chose à faire. */}
      {members.length < 2 && (
        <button className="wp-alone clickable" onClick={() => setInvite(true)}>
          <Users size={15} />
          <span>
            Tu es seul dans la salle — <strong>invite du monde</strong>
          </span>
        </button>
      )}

      {picker && (
        <WatchPartyPicker
          token={token}
          current={party.content}
          onPick={pt.setContent}
          onClose={() => setPicker(false)}
        />
      )}

      {invite && (
        <WatchPartyInvite
          token={token}
          onInvite={pt.invite}
          onClose={() => setInvite(false)}
        />
      )}

      {/* Le mode « tout le monde pilote » se voit : sinon on ne comprend pas
          pourquoi la lecture bouge sans qu'on ait touché à rien. */}
      {party.openControl && (
        <span className="wp-open-note">
          <Radio size={12} /> Tout le monde peut piloter
        </span>
      )}
    </div>
  );
}
