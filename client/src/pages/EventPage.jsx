import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  ExternalLink,
  Grid3x3,
  Link2,
  Loader2,
  Play,
  Radio,
  Tv,
} from "lucide-react";
import Section, { Rail } from "../components/home/Rail";
import { GameTile } from "../components/home/Tiles";
import BingoCard from "../components/bingo/BingoCard";
import BingoComposer from "../components/bingo/BingoComposer";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { bingoPhase, checkedCount, filledCount } from "../lib/bingo";
import {
  announcedAgo,
  brandTheme,
  countdown,
  durationLabel,
  fullWhen,
  interestLabel,
  isEventLive,
  kindLabel,
  preciseCountdown,
  useSecondsTicker,
} from "../lib/homeEvents";

// ======================================================================
//  La fiche d'un rendez-vous
// ======================================================================
// ⚠️ CE QUI JUSTIFIE CETTE PAGE, C'EST LE BAS. Une carte d'accueil dit déjà le
// nom, l'heure et le compte à rebours ; ouvrir une page pour relire la même
// chose en plus grand n'apprendrait rien à personne.
//
// Ce qu'elle apporte, c'est LE BINGO — écrire ce qu'on espère voir, cocher
// pendant l'émission, regarder les grilles des autres — et LA MÉMOIRE : les
// éditions précédentes du même rendez-vous et les jeux qui y ont été annoncés.
// « Le dernier Nintendo Direct avait sorti 72 jeux, en voilà les jaquettes » :
// c'est ça qui donne envie de bloquer jeudi soir.

export default function EventPage() {
  const { id } = useParams();
  const { token } = useAuth();

  const [event, setEvent] = useState(null);
  const [editions, setEditions] = useState([]);
  // Les grilles du rendez-vous : la mienne, et celles des autres.
  const [bingo, setBingo] = useState({ mine: null, grids: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setLoading(true);
    // Les trois partent ENSEMBLE : le bas de page est le cœur de l'écran, il ne
    // doit pas arriver une seconde après le haut.
    Promise.allSettled([
      apiFetch(`/events/${id}`, { token }),
      apiFetch(`/events/${id}/editions`, { token }),
      apiFetch(`/bingo/event/${id}`, { token }),
    ]).then(([ev, ed, bg]) => {
      if (!alive) return;
      if (ev.status === "fulfilled") setEvent(ev.value.event);
      if (ed.status === "fulfilled") setEditions(ed.value.editions || []);
      if (bg.status === "fulfilled")
        setBingo({ mine: bg.value.mine || null, grids: bg.value.grids || [] });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id, token]);

  // ⚠️ ICI L'HORLOGE TOURNE TOUJOURS (dès que l'heure est connue), pas seulement
  // dans les dernières 24 h comme sur les cartes de l'accueil : on n'ouvre pas
  // cette page en passant, on l'ouvre POUR voir le décompte.
  const ticking = useMemo(
    () => !!event && preciseCountdown(event.startsAt, event.precision) !== null,
    [event]
  );
  const tick = useSecondsTicker(ticking);

  // ⚠️ ON NE RAFRAÎCHIT QUE PENDANT LA FENÊTRE DU DIRECT, ET PAS À LA SECONDE.
  // Le serveur relève IGDB toutes les deux minutes : demander plus souvent ne
  // ferait que redemander la même chose.
  const broadcasting = isEventLive(event, tick || Date.now());
  useEffect(() => {
    if (!broadcasting || !id) return undefined;
    const pull = () =>
      apiFetch(`/events/${id}`, { token })
        .then((d) => setEvent((prev) => (prev ? { ...prev, ...d.event } : d.event)))
        .catch(() => {});
    const timer = setInterval(pull, 60000);
    return () => clearInterval(timer);
  }, [broadcasting, id, token]);

  const toggle = useCallback(async () => {
    if (!event || busy) return;
    const want = !event.interested;
    setBusy(true);
    const before = event;
    setEvent({
      ...event,
      interested: want,
      interestedCount: Math.max(0, (event.interestedCount || 0) + (want ? 1 : -1)),
    });
    try {
      const res = await apiFetch(`/events/${event.id}/interest`, {
        method: "POST",
        token,
        body: { interested: want },
      });
      setEvent((e) => ({ ...e, interested: res.interested, interestedCount: res.interestedCount }));
    } catch {
      setEvent(before);
    }
    setBusy(false);
  }, [event, busy, token]);

  const copyLink = useCallback(() => {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="mh-loading">
        <Loader2 size={26} className="spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="ep-missing">
        <p>Ce rendez-vous n'existe plus.</p>
        <Link to="/app" className="mh-pill ghost clickable">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  const theme = brandTheme(event.brand);
  const now = tick || Date.now();
  const { big, live, over } = countdown(event, now);
  const precise = preciseCountdown(event.startsAt, event.precision, now);
  const count = interestLabel(event.interestedCount);
  const duration = durationLabel(event.durationMin);
  const watchUrl = event.liveUrl || event.sourceUrl;
  const liveGames = event.liveGames || [];
  // ⚠️ `over`, PAS `past` — ET LA NUANCE EST TOUT LE BUG. `past` veut dire
  // « l'heure de début est derrière nous », ce qui est vrai dès la première
  // seconde du direct : s'en servir ici basculerait la section en mode bilan
  // pendant l'émission, c'est-à-dire pile quand le rail en direct sert.
  const onAirNow = !over;
  const phase = bingoPhase(event, now);

  return (
    <div className="ep">
      <Link to="/app" className="ep-back clickable">
        <ArrowLeft size={15} /> Accueil
      </Link>

      {/* --- L'affiche et ce qu'on a à en dire ------------------------- */}
      {/* ⚠️ RIEN N'EST ÉCRIT SUR L'AFFICHE (même raison que sur les cartes) :
          une affiche de Direct porte déjà son titre et sa date, et un texte
          posé par-dessus derrière un voile ne se lit ni ne la laisse se voir.
          Sur un écran large, il y a de la place pour la poser À CÔTÉ. */}
      <header className="ep-hero">
        <div className="ep-poster">
          {event.image ? (
            <img src={event.image} alt="" draggable="false" />
          ) : (
            <span
              className="ep-poster-fb"
              style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
            >
              {event.logo ? <img className="ep-logo" src={event.logo} alt="" /> : <Tv size={64} />}
            </span>
          )}
        </div>

        <div className="ep-head">
          <div className="ep-kicker-row">
            <span className="mh-kicker">{kindLabel(event.kind)}</span>
            <span className={`ep-count ${live ? "live" : ""} ${over ? "over" : ""}`}>
              {live && <Radio size={12} />} {precise || big}
            </span>
          </div>

          <h1 className="ep-name">{event.name}</h1>
          <p className="ep-when">{fullWhen(event.startsAt, event.precision)}</p>

          <div className="ep-facts">
            {!!duration && <span className="ep-fact">{duration}</span>}
            {!!event.location && <span className="ep-fact">{event.location}</span>}
            {!!count && <span className="ep-fact">{count}</span>}
          </div>

          <div className="ep-actions">
            <button
              className={`mh-pill ghost clickable ${event.interested ? "on" : ""}`}
              onClick={toggle}
              aria-pressed={!!event.interested}
            >
              {event.interested ? <BellRing size={15} /> : <Bell size={15} />}
              {event.interested ? "J'y serai" : "Ça m'intéresse"}
            </button>

            {!!watchUrl && (
              <a
                className="mh-pill gold solid clickable"
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {live ? <Play size={14} fill="currentColor" strokeWidth={0} /> : <ExternalLink size={14} />}
                {live ? "Regarder" : "Où regarder"}
              </a>
            )}

            <button className="mh-pill ghost clickable" onClick={copyLink}>
              {copied ? <Check size={15} /> : <Link2 size={15} />}
              {copied ? "Lien copié" : "Partager"}
            </button>
          </div>

          {/* ⚠️ ELLE AVAIT ÉTÉ RETIRÉE DES CARTES, PAS DE LA FICHE. Sur une
              carte de rail, le résumé volait la place au titre ; ici, c'est la
              seule ligne qui répond à « ça va parler de quoi ? ». */}
          {!!event.description && <p className="ep-desc">{event.description}</p>}

          {/* ⚠️ « 12 INTÉRESSÉS » NE DIT RIEN ; DES VISAGES, SI. On ne montre
              que les comptes qu'on suit — le compteur brut est déjà au-dessus,
              et exposer tous les inscrits n'apprendrait rien à personne. */}
          {!!event.friends?.length && (
            <div className="ep-friends">
              <span className="mh-faces">
                {event.friends.slice(0, 5).map((f) => (
                  <Link
                    key={f.id}
                    to={`/u/${f.username}`}
                    className="mh-face clickable"
                    title={f.username}
                  >
                    {f.avatar ? (
                      <img src={f.avatar} alt="" loading="lazy" />
                    ) : (
                      f.username.charAt(0).toUpperCase()
                    )}
                  </Link>
                ))}
              </span>
              <span>
                {event.friends.length === 1
                  ? `${event.friends[0].username} y sera`
                  : `${event.friends[0].username} et ${event.friends.length - 1} autre${
                      event.friends.length > 2 ? "s" : ""
                    } y seront`}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* --- Le bingo -------------------------------------------------- */}
      {/* ⚠️ CETTE SECTION EST TOUJOURS LÀ, MÊME VIDE, et c'est l'inverse de la
          règle du direct juste en dessous. Un rail « en direct » vide promet un
          flux qui ne coule pas ; une invitation à composer sa grille, elle, EST
          le contenu — c'est un geste à faire AVANT l'émission, et personne ne
          le devinerait s'il n'apparaissait qu'une fois que quelqu'un s'y est
          mis. */}
      <section className="mh-sec ep-bingo">
        <div className="mh-head">
          <div className="mh-head-main">
            <span className="mh-head-text">
              <span className="mh-kicker">Le bingo</span>
              <span className="mh-head-title">Tes pronostics</span>
              <span className="mh-head-hint">
                {bingo.grids.length
                  ? `${bingo.grids.length} grille${bingo.grids.length > 1 ? "s" : ""} à voir`
                  : "Écris ce que tu espères voir, coche pendant l'émission"}
              </span>
            </span>
          </div>

          {bingo.mine ? (
            <Link to={`/bingo/${bingo.mine.id}`} className="mh-pill gold solid clickable">
              <Grid3x3 size={14} />
              {phase.canCheck
                ? `Cocher (${checkedCount(bingo.mine.cells)}/${filledCount(bingo.mine.cells)})`
                : `Ma grille (${filledCount(bingo.mine.cells)}/${bingo.mine.size ** 2})`}
            </Link>
          ) : phase.started ? (
            // Une fois l'émission commencée, on ne compose plus (le serveur
            // refuse) : proposer d'en créer une mènerait à un écran qui dit non.
            <span className="ep-toolate">Trop tard pour composer</span>
          ) : (
            <button className="mh-pill gold solid clickable" onClick={() => setComposing(true)}>
              <Grid3x3 size={14} /> Créer ma grille
            </button>
          )}
        </div>

        {/* Ma grille passe devant celles des autres : c'est la sienne qu'on
            vient retoucher, et celle des autres qu'on vient regarder. */}
        {(bingo.mine || bingo.grids.length > 0) && (
          <Rail snap={false}>
            {bingo.mine && <BingoCard grid={bingo.mine} />}
            {bingo.grids.map((g) => (
              <BingoCard key={g.id} grid={g} />
            ))}
          </Rail>
        )}
      </section>

      {/* --- Ce qui tombe pendant l'émission --------------------------- */}
      {(broadcasting || liveGames.length > 0) && (
        <Section
          kicker={onAirNow ? "En direct" : "Ce soir-là"}
          title={onAirNow ? "Ce qui vient d'être annoncé" : "Ce qui a été annoncé"}
          hint={
            liveGames.length
              ? `${liveGames.length} jeu${liveGames.length > 1 ? "x" : ""} annoncé${
                  liveGames.length > 1 ? "s" : ""
                }`
              : "Rien encore — ça arrive"
          }
          rail={liveGames.length > 0}
        >
          {liveGames.length === 0 ? (
            <p className="ep-waiting">Les annonces apparaîtront ici pendant la diffusion.</p>
          ) : (
            liveGames.map((g) => {
              const mins = announcedAgo(g.addedAt, now);
              return (
                <GameTile
                  key={`live-${g.id}`}
                  game={g}
                  // Les annonces les plus fraîches se signalent en doré : sur un
                  // rail qui grandit pendant qu'on le regarde, c'est ce qui
                  // distingue « nouveau » de « déjà vu ».
                  sub={
                    !onAirNow || mins === null
                      ? null
                      : mins < 1
                        ? "à l'instant"
                        : `il y a ${mins} min`
                  }
                  subGold={onAirNow && mins !== null && mins < 10}
                />
              );
            })
          )}
        </Section>
      )}

      {/* --- La mémoire du rendez-vous --------------------------------- */}
      {editions.length > 0 && (
        <Section
          kicker="La dernière fois"
          title={`${editions[0].gameCount} jeux annoncés`}
          hint={editions[0].title}
          moreTo={`/lists/${editions[0].listId}`}
          moreLabel="La liste"
        >
          {editions[0].games.map((g) => (
            <GameTile key={`${editions[0].listId}-${g.id}`} game={g} />
          ))}
        </Section>
      )}

      {editions.length > 1 && (
        <section className="mh-sec">
          <div className="mh-head">
            <div className="mh-head-main">
              <span className="mh-head-text">
                <span className="mh-kicker">Avant</span>
                <span className="mh-head-title">Les éditions passées</span>
              </span>
            </div>
          </div>
          <div className="ep-past">
            {editions.slice(1).map((ed) => (
              <Link key={ed.listId} to={`/lists/${ed.listId}`} className="ep-past-row clickable">
                {!!ed.cover && <img src={ed.cover} alt="" loading="lazy" />}
                <span>
                  <b>{ed.title}</b>
                  <i>
                    {ed.gameCount} jeux{ed.videoId ? " · rediffusion" : ""}
                  </i>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* D'où vient l'information. Un compte à rebours qu'on ne peut pas
          vérifier ne vaut pas grand-chose. */}
      {!!event.sourceUrl && (
        <a
          className="ep-source clickable"
          href={event.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Source : {event.source === "igdb" ? "IGDB" : "Game Conference Guide"}
        </a>
      )}

      {composing && (
        <BingoComposer
          eventId={id}
          eventName={event.name}
          token={token}
          initial={bingo.mine}
          onClose={() => setComposing(false)}
          onSaved={(grid) => setBingo((b) => ({ ...b, mine: grid }))}
        />
      )}
    </div>
  );
}
