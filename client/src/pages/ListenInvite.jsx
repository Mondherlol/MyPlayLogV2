import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Headphones,
  Music,
  Loader2,
  Play,
  Check,
  UserRound,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useListenParty } from "../context/ListenPartyContext";

// ======================================================================
//  /listen/:code — la page au bout du lien de séance
// ======================================================================
// C'EST LA PORTE D'ENTRÉE DEPUIS L'EXTÉRIEUR : le lien se colle dans un salon
// Discord, donc il tombe entre les mains de gens pas connectés, et même de gens
// sans compte. Trois publics, trois réponses :
//
//   • connecté → un bouton, un seul : « Écouter avec untel » ;
//   • pas connecté → ce qui se joue, et la connexion qui ramène ici ;
//   • séance finie → on le dit franchement, plutôt qu'un lecteur muet.
//
// LE BOUTON EST INDISPENSABLE, il n'est pas là par politesse : le navigateur
// n'autorise le son que sur un geste. Une page qui se brancherait toute seule à
// l'arrivée resterait silencieuse — exactement le bogue qu'on vient de corriger
// ailleurs (voir `prime` dans PlayerContext).
export default function ListenInvite() {
  const { code } = useParams();
  const { user, token } = useAuth();
  const listen = useListenParty();
  const [info, setInfo] = useState(undefined); // undefined = on demande
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch(`/listen/${code}/preview`, { token })
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setInfo({ state: "gone" }));
    return () => {
      alive = false;
    };
  }, [code, token]);

  const joined = listen.party?.code === code;
  const gone = info?.state === "gone";

  async function join() {
    setBusy(true);
    try {
      await listen.join(code);
    } finally {
      setBusy(false);
    }
  }

  if (info === undefined)
    return (
      <div className="linv">
        <div className="linv-card">
          <Loader2 size={22} className="spin" />
        </div>
      </div>
    );

  return (
    <div className="linv">
      <div className={`linv-card ${gone ? "off" : ""}`}>
        <span className="linv-kicker">
          <Headphones size={13} /> Écoute en groupe
        </span>

        {gone ? (
          <>
            <h1>Cette séance est terminée</h1>
            <p>
              Une séance d'écoute ne vit que tant que son hôte a l'onglet ouvert —
              celle-ci s'est éteinte. Le lien ne mène plus à rien, mais la musique,
              elle, est toujours là.
            </p>
            <Link to={user ? "/activity" : "/"} className="linv-btn ghost clickable">
              {user ? "Voir qui écoute quoi" : "Découvrir MyPlayLog"}
              <ArrowRight size={15} />
            </Link>
          </>
        ) : (
          <>
            <div className="linv-track">
              <span className={`linv-art ${info.playing ? "spin" : ""}`}>
                {info.track?.artwork ? (
                  <img src={info.track.artwork} alt="" />
                ) : (
                  <Music size={26} />
                )}
                <i className="linv-hole" aria-hidden="true" />
              </span>
              <div className="linv-meta">
                <strong>{info.track?.name || "Sans titre"}</strong>
                {(info.track?.artist || info.track?.gameName) && (
                  <em>{info.track.artist || info.track.gameName}</em>
                )}
                <span className="linv-live">
                  <i aria-hidden="true" />
                  {info.playing ? "En cours" : "En pause"}
                  {info.listeners > 0 &&
                    ` · ${info.listeners} à l'écoute`}
                </span>
              </div>
            </div>

            <h1>
              <span className="linv-host">
                {info.host?.avatar ? (
                  <img src={info.host.avatar} alt="" />
                ) : (
                  <UserRound size={14} />
                )}
                {info.host?.username}
              </span>{" "}
              t'invite à écouter avec lui
            </h1>
            <p>
              Vous entendrez la même piste, à la même seconde. Tu peux continuer à
              naviguer dans l'app : la musique suit.
            </p>

            {user ? (
              joined ? (
                <div className="linv-done">
                  <Check size={16} /> Tu écoutes avec {info.host?.username}.
                  <Link to="/activity" className="clickable">
                    Voir l'activité
                  </Link>
                </div>
              ) : (
                <button
                  type="button"
                  className="linv-btn clickable"
                  onClick={join}
                  disabled={busy || listen.busy}
                >
                  {busy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                  Écouter avec {info.host?.username}
                </button>
              )
            ) : (
              <>
                <Link
                  to={`/login?next=${encodeURIComponent(`/listen/${code}`)}`}
                  className="linv-btn clickable"
                >
                  Se connecter pour écouter
                </Link>
                <Link to="/register" className="linv-sub clickable">
                  Pas encore de compte ? En créer un
                </Link>
              </>
            )}
            {listen.error && <p className="linv-error">{listen.error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
