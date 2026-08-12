import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Radio,
  Gamepad2,
  Tv,
  BookOpen,
  ArrowRight,
  Loader2,
  Users,
  RefreshCw,
  Eye,
  Music,
  Headphones,
  LogOut,
  Loader2 as Spinner,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useChat } from "../context/ChatContext";
import { useListenParty } from "../context/ListenPartyContext";

// ======================================================================
//  « En ce moment » — ce que font les joueurs suivis, à la seconde près
// ======================================================================
// LE FIL RACONTE CE QUI S'EST PASSÉ ; CE RAIL DIT CE QUI SE PASSE. C'est toute
// la différence, et c'est ce qui manquait : savoir qu'un ami a fait 82° au Mot
// du jour hier soir n'appelle aucune action, savoir qu'il y est EN CE MOMENT en
// appelle une seule — y aller. D'où le bouton « Rejoindre » sur chaque ligne,
// qui est la raison d'être du rail.
//
// TROIS FAMILLES, PAS UNE LISTE. Jouer, regarder, lire ne se rejoignent pas de
// la même façon : à huit personnes en ligne, une liste plate ne se lit plus.
// Le serveur donne la famille avec le statut (lib/liveStatus.js).
//
// DEUX SOURCES, ET ELLES SE COMPLÈTENT :
//
//   • un relevé toutes les 25 secondes (`/presence/following`) — c'est la
//     source de vérité, elle couvre TOUS les gens qu'on suit ;
//   • les évènements `presence` du flux SSE déjà ouvert par la messagerie, qui
//     rafraîchissent instantanément — mais seulement pour les personnes avec
//     qui on a une conversation (c'est la portée de leur rediffusion).
//
// La première seule suffirait, mais avec 25 secondes de retard sur un ami avec
// qui on discute ; la seconde seule laisserait des trous. Ensemble, on a le
// direct là où il compte et l'exhaustivité partout.

const FAMILIES = [
  { key: "play", label: "Jouent", Icon: Gamepad2 },
  { key: "watch", label: "Regardent", Icon: Tv },
  { key: "read", label: "Lisent", Icon: BookOpen },
  // Écouter est la SEULE activité qu'on annonce sans y être : le mini-lecteur
  // suit partout, on peut donc « écouter » en lisant une fiche de jeu. C'est
  // aussi la plus facile à partager — d'où la section des séances, juste
  // au-dessus, où celles-ci se rejoignent d'un bouton.
  { key: "listen", label: "Écoutent", Icon: Music },
];

const POLL = 25000;

// « depuis 12 min ». Sous la minute on ne dit rien : « depuis 4 s » est du bruit,
// et le nombre aurait changé avant d'être lu.
function since(at) {
  if (!at) return "";
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `depuis ${mins} min`;
  const h = Math.floor(mins / 60);
  return `depuis ${h} h`;
}

export default function FriendsNow({ token }) {
  const [people, setPeople] = useState(null); // null = premier chargement
  const [streams, setStreams] = useState([]); // les diffusions GBA en cours
  const [sessions, setSessions] = useState([]); // les séances d'écoute ouvertes
  const [refreshing, setRefreshing] = useState(false);
  const { statuses } = useChat();
  const listen = useListenParty();
  const alive = useRef(true);

  const load = useCallback(
    async ({ quiet = true } = {}) => {
      if (!token) return;
      if (!quiet) setRefreshing(true);
      // Les diffusions en direct partent avec le relevé de présence : c'est la
      // même question (« qui fait quoi maintenant »), et deux minuteurs
      // décalés feraient apparaître le direct une demi-seconde après la ligne
      // du joueur qui le tient.
      apiFetch("/gba-stream/live", { token })
        .then((d) => alive.current && setStreams(d.rooms || []))
        .catch(() => {
          /* rayon vidéo éteint, ou route absente : le rail marche sans */
        });
      // Les séances d'écoute, pour la même raison et au même moment : c'est
      // toujours la question « qui fait quoi maintenant ».
      apiFetch("/listen/live", { token })
        .then((d) => alive.current && setSessions(d.rooms || []))
        .catch(() => {
          /* le rail marche sans */
        });
      try {
        const d = await apiFetch("/presence/following", { token });
        if (alive.current) setPeople(d.people || []);
      } catch {
        // Un relevé raté ne vide pas le rail : on garde le dernier connu et on
        // retentera dans 25 secondes. Un rail qui clignote à chaque hoquet
        // réseau est pire qu'un rail avec 25 secondes de retard.
        if (alive.current && people === null) setPeople([]);
      } finally {
        if (alive.current) setRefreshing(false);
      }
    },
    // `people` n'est lu que pour le tout premier échec : le mettre en
    // dépendance recréerait le minuteur à chaque relevé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  useEffect(() => {
    alive.current = true;
    load();
    const id = setInterval(load, POLL);
    // Un onglet laissé de côté puis repris doit être à jour TOUT DE SUITE :
    // c'est le moment exact où l'on regarde qui est là.
    const onFocus = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Le direct de la messagerie par-dessus le relevé : pour les gens avec qui on
  // discute, le statut change sous les yeux sans attendre le prochain tour.
  const merged = (people || []).map((p) => {
    const fresh = statuses?.[p.user.id];
    return fresh ? { ...p, status: fresh } : p;
  });

  // Celui qui diffuse est déjà annoncé par sa carte « en direct », en plus
  // grand et avec sa jaquette : le laisser AUSSI dans « Jouent » afficherait la
  // même personne deux fois dans un rail de dix lignes.
  const hosts = new Set(streams.map((s) => String(s.host?.id)));
  // Celui qui tient une séance d'écoute est déjà annoncé par sa carte, avec sa
  // pochette et le titre du morceau : le laisser AUSSI dans « Écoutent » le
  // ferait apparaître deux fois de suite. En revanche, s'il est en train de
  // JOUER pendant que sa séance tourne, sa ligne « Joue à… » reste — les deux
  // ne disent pas la même chose.
  const djs = new Set(sessions.map((s) => String(s.host?.id)));
  const doubled = (p) =>
    hosts.has(p.user.id) ||
    (djs.has(p.user.id) && (!p.status || p.status.family === "listen"));
  const busy = merged.filter((p) => p.status && !doubled(p));
  const idle = merged.filter((p) => !p.status && !doubled(p));

  if (people === null)
    return (
      <aside className="fnow">
        <div className="fnow-head">
          <h2>
            <Radio size={15} /> En ce moment
          </h2>
        </div>
        <div className="fnow-load">
          <Loader2 size={18} className="spin" />
        </div>
      </aside>
    );

  return (
    <aside className="fnow">
      <div className="fnow-head">
        <h2>
          <span className="fnow-pulse" aria-hidden="true" />
          En ce moment
        </h2>
        <button
          className="fnow-refresh clickable"
          onClick={() => load({ quiet: false })}
          title="Rafraîchir"
          aria-label="Rafraîchir"
        >
          <RefreshCw size={13} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {/* ---------------- EN DIRECT, EN PREMIER ET EN GRAND ----------------
          Une diffusion n'est pas une ligne de plus : c'est la seule chose du
          rail qu'on peut rejoindre EN TANT QUE PUBLIC, tout de suite, sans rien
          demander à personne. Elle a donc sa jaquette, son compteur de
          spectateurs et un bouton qui prend toute la largeur. */}
      {streams.length > 0 && (
        <section className="fnow-group fam-live">
          <h3 className="fnow-group-title">
            <Radio size={13} /> En direct
            <em>{streams.length}</em>
          </h3>
          {streams.map((s) => (
            <Link key={s.code} to={`/gba/${s.code}`} className="fnow-live clickable">
              <span className="fnow-live-art">
                {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <Gamepad2 size={18} />}
                <i className="fnow-live-dot" aria-hidden="true" />
              </span>
              <span className="fnow-live-txt">
                <strong>{s.host?.username}</strong>
                <em>{s.title}</em>
              </span>
              <span className="fnow-live-n">
                <Eye size={12} /> {s.viewers}
              </span>
            </Link>
          ))}
        </section>
      )}

      {/* ------------------- LES SÉANCES D'ÉCOUTE, JUSTE APRÈS -------------
          Comme le direct : ce n'est pas une ligne de plus, c'est quelque chose
          qu'on peut REJOINDRE tout de suite. Et sans quitter la page — le
          lecteur est global, se brancher ne fait que changer ce qui sort des
          enceintes. D'où le bouton qui agit sur place, là où « en direct »
          emmène sur une autre page. */}
      {sessions.length > 0 && (
        <section className="fnow-group fam-listen">
          <h3 className="fnow-group-title">
            <Headphones size={13} /> À l'écoute
            <em>{sessions.length}</em>
          </h3>
          {sessions.map((s) => (
            <Session
              key={s.code}
              session={s}
              party={listen.party}
              busy={listen.busy}
              onJoin={() => listen.join(s.code)}
              onLeave={listen.stop}
            />
          ))}
        </section>
      )}

      {!merged.length && !streams.length && !sessions.length ? (
        <div className="fnow-empty">
          <Users size={20} />
          <p>
            Personne en ligne parmi les joueurs que tu suis. Dès que l'un d'eux
            lance une partie, ouvre une séance ou une lecture, il apparaît ici —
            avec de quoi le rejoindre.
          </p>
        </div>
      ) : (
        <>
          {FAMILIES.map(({ key, label, Icon }) => {
            const group = busy.filter((p) => p.status?.family === key);
            if (!group.length) return null;
            return (
              <section key={key} className={`fnow-group fam-${key}`}>
                <h3 className="fnow-group-title">
                  <Icon size={13} /> {label}
                  <em>{group.length}</em>
                </h3>
                {group.map((p) => (
                  <Row key={p.user.id} person={p} />
                ))}
              </section>
            );
          })}

          {/* Les autres : en ligne, mais on ne sait pas ce qu'ils font. Ils
              tiennent en une rangée d'avatars — les nommer un par un donnerait
              autant de place à « il est là » qu'à « il joue à ça », alors que
              seul le second se rejoint. */}
          {idle.length > 0 && (
            <section className="fnow-group">
              <h3 className="fnow-group-title">
                <Users size={13} /> En ligne
                <em>{idle.length}</em>
              </h3>
              <div className="fnow-idle">
                {idle.map((p) => (
                  <Link
                    key={p.user.id}
                    to={`/u/${p.user.username}`}
                    className="fnow-idle-av clickable"
                    title={p.user.username}
                  >
                    {p.user.avatar ? (
                      <img src={p.user.avatar} alt={p.user.username} loading="lazy" />
                    ) : (
                      <span>{p.user.username[0].toUpperCase()}</span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

// ----------------------------------------------------------------------
//  Une séance d'écoute : la pochette, le morceau, et le bouton
// ----------------------------------------------------------------------
// LE BOUTON NE NAVIGUE PAS, il agit. Rejoindre une séance ne change rien à
// l'écran — c'est le son qui change. On reste donc exactement où l'on était,
// et la barre de lecture en bas prend le relais (c'est elle qui affiche « Avec
// untel » et le bouton pour quitter).
function Session({ session, party, busy, onJoin, onLeave }) {
  const mine = party?.code === session.code;
  const track = session.track || {};
  return (
    <div className={`fnow-sess ${mine ? "on" : ""}`}>
      <span className={`fnow-sess-art ${session.playing ? "spin" : ""}`}>
        {track.artwork ? (
          <img src={track.artwork} alt="" loading="lazy" draggable="false" />
        ) : (
          <Music size={16} />
        )}
        <i className="fnow-sess-hole" aria-hidden="true" />
      </span>
      <Link to={`/u/${session.host?.username}`} className="fnow-sess-txt clickable">
        <strong>{session.host?.username}</strong>
        <em title={`${track.name}${track.artist ? ` — ${track.artist}` : ""}`}>
          {track.name || "Sans titre"}
        </em>
      </Link>
      {session.listeners > 0 && (
        <span className="fnow-sess-n" title={`${session.listeners} à l'écoute`}>
          <Headphones size={11} /> {session.listeners}
        </span>
      )}
      <button
        type="button"
        className={`fnow-join clickable ${mine ? "leave" : ""}`}
        onClick={mine ? onLeave : onJoin}
        disabled={busy}
        title={
          mine
            ? "Quitter la séance"
            : `Écouter la même chose que ${session.host?.username}`
        }
      >
        {busy ? (
          <Spinner size={13} className="spin" />
        ) : mine ? (
          <>
            Quitter <LogOut size={12} />
          </>
        ) : (
          <>
            Écouter <Headphones size={12} />
          </>
        )}
      </button>
    </div>
  );
}

// Une ligne : qui, ce qu'il fait, depuis quand — et le bouton pour y aller.
function Row({ person }) {
  const { user, status } = person;
  const what = status.detail ? `${status.label} · ${status.detail}` : status.label;
  return (
    <div className="fnow-row">
      <Link to={`/u/${user.username}`} className="fnow-who clickable">
        <span className="fnow-av">
          {user.avatar ? (
            <img src={user.avatar} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="fnow-av-fb">{user.username[0].toUpperCase()}</span>
          )}
          <i className="fnow-dot" aria-hidden="true" />
        </span>
        <span className="fnow-txt">
          <strong>{user.username}</strong>
          <em title={what}>{what}</em>
        </span>
      </Link>
      {status.path ? (
        <Link
          to={status.path}
          className="fnow-join clickable"
          title={`Rejoindre ${user.username}`}
        >
          Rejoindre <ArrowRight size={13} />
        </Link>
      ) : (
        <span className="fnow-since">{since(status.since)}</span>
      )}
    </div>
  );
}
