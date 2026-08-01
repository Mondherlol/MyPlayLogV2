import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Loader2,
  Check,
  Clock,
  Tv,
  Film,
  Gamepad2,
  ExternalLink,
  Users,
  MonitorPlay,
  BookOpen,
  Cpu,
  ChevronDown,
  ChevronUp,
  Unplug,
  Lock,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import CollectionViewer from "../components/CollectionViewer";
import CollectionComments from "../components/CollectionComments";
import GachaModal from "../components/GachaModal";

// Le lecteur à plat embarque son carrousel (Swiper) : comme le volume 3D, il
// ne descend qu'à l'ouverture d'un titre de papier — la fiche, elle, n'en a
// pas besoin pour s'afficher.
const ComicReader = lazy(() => import("../components/ComicReader"));
// Le volume en 3D embarque three.js : il ne descend que si l'on ouvre un titre
// de papier, jamais avec la fiche.
const BookReader3D = lazy(() => import("../components/BookReader3D"));
// La console embarque l'émulateur : elle ne descend que si l'on appuie sur
// « Jouer », jamais avec la fiche.
const GbaPlayer = lazy(() => import("../components/GbaPlayer"));
import {
  CONSOLE,
  FORMATS,
  LICENCES,
  PROVIDERS,
  fmtDuration,
  fmtYears,
  hostOf,
  isComic,
  isGame,
  isRtl,
} from "../lib/collection";

// ======================================================================
//  Fiche d'un média de la collection
// ======================================================================
// La fiche fait le service minimum et le fait bien : de quoi ça parle, qui
// joue dedans, quels épisodes, et le gros bouton qui lance la séance. Le
// visionnage lui-même vit dans CollectionViewer (plein écran, par-dessus la
// page).
//
// LES COMMENTAIRES ferment la colonne principale, sous la liste d'épisodes (ou
// les planches, ou la cartouche) — pas dans la colonne latérale, qui est faite
// de blocs qu'on consulte et non d'une conversation qu'on suit.

export default function CollectionDetail() {
  const { slug } = useParams();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [media, setMedia] = useState(null);
  const [status, setStatus] = useState("loading");
  const [watching, setWatching] = useState(null); // { index, at } | null
  // Lecteur de papier : « volume » (l'objet en 3D, qu'on ouvre et dont on
  // tourne les pages) ou « plat » (la planche pleine page, pour zoomer sur une
  // bulle ou dérouler un scan long). Deux façons de lire le même titre, pas un
  // lecteur et son repli.
  const [reading, setReading] = useState(null); // "volume" | "plat" | null
  const [openAt, setOpenAt] = useState(null); // planche demandée à l'ouverture
  const [season, setSeason] = useState(null);
  const [playing, setPlaying] = useState(false); // la console est allumée
  // Ce que coûterait un tour de sphère, quand le boîtier n'est pas à nous.
  const [price, setPrice] = useState(0);
  const [showGacha, setShowGacha] = useState(false);

  // Reprise demandée par l'URL (rangée « Reprendre » de la page Collection).
  const askedEpisode = Number(params.get("ep"));
  const autoPlay = params.get("play") === "1";
  const autoStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    apiFetch(`/collection/${slug}`, { token })
      .then((d) => {
        if (!alive) return;
        setMedia(d.media);
        setPrice(d.price || 0);
        setSeason(d.media.episodes?.[0]?.season ?? null);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [slug, token]);

  // Le papier n'enregistre qu'un nombre : la planche où l'on en est. Route
  // séparée de celle de la vidéo, parce qu'y faire transiter une position en
  // secondes et un index d'épisode rendrait les deux illisibles.
  const savePage = useCallback(
    (page) => {
      apiFetch(`/collection/${slug}/page`, {
        method: "POST",
        token,
        body: { page },
      })
        .then((d) =>
          setMedia((m) =>
            m
              ? { ...m, progress: { ...(m.progress || {}), page: d.page, completed: d.completed } }
              : m
          )
        )
        .catch(() => {});
    },
    [slug, token]
  );

  // Le jeu n'enregistre qu'un cumul : la console envoie ce qu'elle vient de
  // faire jouer, le serveur additionne. La PARTIE, elle, passe par un autre
  // chemin — la console parle directement aux emplacements de sauvegarde (voir
  // lib/gbaSaves.js), qui pèsent trop pour transiter par cette fiche.
  const savePlayed = useCallback(
    (seconds) => {
      apiFetch(`/collection/${slug}/played`, {
        method: "POST",
        token,
        body: { seconds },
      })
        .then((d) =>
          setMedia((m) =>
            m
              ? { ...m, progress: { ...(m.progress || {}), playSeconds: d.playSeconds } }
              : m
          )
        )
        .catch(() => {
          /* un compteur de temps de jeu ne mérite pas d'alerte */
        });
    },
    [slug, token]
  );

  // Enregistrement de la progression : la télé nous prévient, on relaie à
  // l'API et on garde l'état local à jour (les coches de la liste d'épisodes).
  const saveProgress = useCallback(
    (payload) => {
      apiFetch(`/collection/${slug}/progress`, {
        method: "PUT",
        token,
        body: payload,
      })
        .then((d) => setMedia((m) => (m ? { ...m, progress: d.progress } : m)))
        .catch(() => {
          /* la reprise n'est pas critique : on ne dérange pas l'utilisateur */
        });
    },
    [slug, token]
  );

  // --- Ouvrir une séance à plusieurs ----------------------------------------
  // La salle est créée SUR L'ÉPISODE OÙ L'ON EN EST : reprendre à trois avec la
  // même touche qu'on reprendrait seul. Elle s'ouvre directement sur la fenêtre
  // d'invitation (`?invite=1`) — une salle sans personne dedans n'a rien à
  // proposer d'autre.
  const [partyBusy, setPartyBusy] = useState(false);
  async function openParty() {
    if (partyBusy) return;
    setPartyBusy(true);
    try {
      const d = await apiFetch("/watchparty", {
        method: "POST",
        token,
        body: { slug, episodeIndex: media?.progress?.episodeIndex || 0 },
      });
      navigate(`/watchparty/${d.party.code}?invite=1`);
    } catch (e) {
      alert(e.message);
      setPartyBusy(false);
    }
  }

  function toggleWatched(index) {
    apiFetch(`/collection/${slug}/watched`, { method: "POST", token, body: { index } })
      .then((d) =>
        setMedia((m) =>
          m
            ? {
                ...m,
                progress: {
                  ...(m.progress || { episodeIndex: 0, positionSeconds: 0 }),
                  watched: d.watched,
                  completed: d.completed,
                },
              }
            : m
        )
      )
      .catch(() => {});
  }

  // L'URL ne garde pas « play » : revenir en arrière ne doit rallumer ni le
  // poste ni la console tout seuls.
  const dropPlayParam = useCallback(() => {
    if (!params.has("play")) return;
    const next = new URLSearchParams(params);
    next.delete("play");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const watch = useCallback(
    (index, at = 0) => {
      setWatching({ index, at });
      dropPlayParam();
    },
    [dropPlayParam]
  );

  // Lancement automatique quand on arrive depuis « Reprendre ». Jamais sur un
  // boîtier qu'on ne possède pas : il n'y a rien à lancer (le serveur n'a
  // envoyé ni épisode, ni planche, ni cartouche), et `?play=1` collé à un lien
  // partagé ouvrirait un lecteur vide.
  useEffect(() => {
    if (!media || autoStarted.current || !autoPlay || media.owned === false) return;
    autoStarted.current = true;
    if (isGame(media)) {
      setPlaying(true);
      dropPlayParam();
      return;
    }
    // Un volume ne s'allume pas dans le poste : il s'OUVRE, à la planche où le
    // marque-page est resté. Sans cette branche, une reprise de lecture montait
    // le téléviseur sur un titre sans le moindre épisode — un écran noir.
    if (isComic(media)) {
      setOpenAt(media.progress?.page || 0);
      setReading("volume");
      dropPlayParam();
      return;
    }
    const index = Number.isFinite(askedEpisode) ? askedEpisode : 0;
    watch(index, media.progress?.positionSeconds || 0);
  }, [media, autoPlay, askedEpisode, watch, dropPlayParam]);

  const seasons = useMemo(() => {
    const set = [...new Set((media?.episodes || []).map((e) => e.season || 1))];
    return set.length > 1 ? set : [];
  }, [media]);

  const episodes = useMemo(() => {
    if (!media) return [];
    return season == null || !seasons.length
      ? media.episodes
      : media.episodes.filter((e) => (e.season || 1) === season);
  }, [media, season, seasons]);

  if (status === "loading")
    return (
      <div className="coll-state">
        <Loader2 size={26} className="coll-spin" />
        <p>Chargement de la fiche…</p>
      </div>
    );

  if (status === "error" || !media)
    return (
      <div className="coll-state">
        <p>Ce titre n'est pas (ou plus) sur l'étagère.</p>
        <Link to="/collection" className="btn btn-ghost clickable">
          Retour à la collection
        </Link>
      </div>
    );

  const licence = LICENCES[media.licence] || LICENCES.official;
  const format = FORMATS[media.format] || FORMATS.dvd;
  const comic = isComic(media);
  const game = isGame(media);
  // Le serveur ne renseigne `owned` que sur cette route ; `!== false` plutôt
  // que `=== true` pour que rien ne se verrouille si le champ venait à manquer
  // (client plus récent que serveur, réponse en cache) — dans le doute, on ne
  // retire jamais l'accès à quelqu'un.
  const owned = media.owned !== false;
  const played = media.progress?.playSeconds || 0;
  const isSeries =
    !comic && !game && media.kind === "series" && media.episodes.length > 1;
  const pageAt = media.progress?.page || 0;
  const watched = new Set(media.progress?.watched || []);
  const current = media.progress?.episodeIndex ?? 0;
  const resumePos = media.progress?.positionSeconds || 0;
  // UN FILM N'A PAS DE RAYON. Sa « liste d'épisodes » tenait une seule ligne
  // qui redisait la fiche juste au-dessus — même vignette, même titre, même
  // résumé — pour un bouton que le grand « Regarder » lance déjà. Seule la
  // coche y était utile : elle remonte dans les actions du bandeau, et la
  // discussion prend la place laissée libre (voir .coll-detail-body.no-eps).
  //
  // UN FILM EN DEUX PARTIES GARDE SA LISTE : elle est alors le seul chemin vers
  // la seconde, et le raccourci du bandeau ne mène qu'à la première.
  const soloFilm = !comic && !game && media.kind === "film" && media.episodes.length <= 1;
  // Un film ne se coche qu'entier, et son unique entrée est forcément la 0 (le
  // serveur borne l'index au nombre d'épisodes) — vrai aussi quand toutes ses
  // sources sont mortes : on peut l'avoir vu ailleurs.
  const filmSeen = soloFilm && watched.has(0);
  // COCHER N'EST PAS S'ÊTRE ARRÊTÉ EN COURS. Une coche vaut reprise sur un titre
  // à plusieurs entrées — l'épisode suivant reste à voir — mais sur un film
  // cochée à la main, elle dit le contraire : il est fini. Sans cette nuance, le
  // bouton « Marquer comme vu » retournait le bandeau en « Reprendre » +
  // « Repartir du début » alors qu'il n'y a aucune minute où revenir.
  const hasResume = resumePos > 30 || (watched.size > 0 && !soloFilm);
  // Reste-t-il quelque chose à regarder ? Un titre dont toutes les sources ont
  // été purgées garde sa fiche (synopsis, casting, jaquette) mais n'a plus un
  // seul épisode à lancer.
  const playable = comic || game || media.episodes.length > 0;

  return (
    // Le format habille la fiche : une boîte de DS est presque carrée, et le
    // gabarit d'affiche du rayon vidéo lui couperait le haut.
    <div
      className={`coll-detail fmt-${media.format || "dvd"}`}
      style={{ "--tint": media.color || "var(--orange)" }}
    >
      {/* ---------------- bandeau ---------------- */}
      <header className="coll-hero">
        {media.backdrop && (
          <img className="coll-hero-bg" src={media.backdrop} alt="" />
        )}
        <span className="coll-hero-scrim" aria-hidden="true" />
        <span className="coll-hero-grain" aria-hidden="true" />

        <Link to="/collection" className="coll-hero-back clickable">
          <ArrowLeft size={16} /> Collection
        </Link>

        <div className="coll-hero-body">
          <div className="coll-hero-poster">
            {media.poster && <img src={media.poster} alt={media.title} />}
            <span className="coll-hero-fmt">{format.label}</span>
          </div>

          <div className="coll-hero-info">
            {media.franchise && (
              <span className="coll-hero-franchise">{media.franchise}</span>
            )}
            <h1>{media.title}</h1>
            {media.originalTitle && media.originalTitle !== media.title && (
              <p className="coll-hero-original">{media.originalTitle}</p>
            )}

            <div className="coll-hero-meta">
              <span className="coll-hero-kind">
                {comic ? (
                  <BookOpen size={13} />
                ) : game ? (
                  <Gamepad2 size={13} />
                ) : isSeries ? (
                  <Tv size={13} />
                ) : (
                  <Film size={13} />
                )}
                {comic ? "Comic" : game ? CONSOLE : isSeries ? "Série" : "Film"}
              </span>
              {fmtYears(media) && <span>{fmtYears(media)}</span>}
              {isSeries && <span>{media.episodes.length} épisodes</span>}
              {comic && <span>{media.pageCount} planches</span>}
              {game && media.cartridge?.region && (
                <span title="Région de la cartouche">{media.cartridge.region}</span>
              )}
              {game && media.cartridge?.players > 1 && (
                <span>Jusqu'à {media.cartridge.players} joueurs</span>
              )}
              {game && played > 60 && (
                <span title="Ton temps de jeu sur cette cartouche">
                  <Clock size={13} /> {fmtDuration(played)} de jeu
                </span>
              )}
              {isRtl(media) && (
                <span title="Se lit de droite à gauche, comme un manga">
                  ← lecture japonaise
                </span>
              )}
              {comic && media.authors?.length > 0 && <span>{media.authors.join(" · ")}</span>}
              {comic && media.publisher && <span>{media.publisher}</span>}
              {media.runtime && (
                <span>
                  <Clock size={13} /> {fmtDuration(media.runtime * 60)}
                </span>
              )}
              {media.rating && <span className="coll-hero-rating">{media.rating}/10</span>}
              <span className={`coll-lic lic-${media.licence}`} title={licence.hint}>
                {licence.label}
              </span>
            </div>

            {media.genres?.length > 0 && (
              <div className="coll-hero-genres">
                {media.genres.slice(0, 5).map((g) => (
                  <span key={g}>{g}</span>
                ))}
              </div>
            )}

            {media.synopsis && <p className="coll-hero-syn">{media.synopsis}</p>}

            <div className="coll-hero-actions">
              {/* LE BOÎTIER N'EST PAS À NOUS. On laisse la fiche entière ouverte
                  — jaquette, résumé, casting, tout ce qui donne envie — mais on
                  ne promet pas de le lire : le serveur ne nous a d'ailleurs
                  envoyé ni épisode, ni planche, ni cartouche (voir `lockSources`,
                  routes/collection.js). À la place, la porte vers la machine.
                  C'est le seul écran où l'on convoite un objet précis, donc le
                  seul où l'appel à faire tourner la sphère est mérité. */}
              {!owned ? (
                <>
                  <button
                    className="btn btn-primary clickable"
                    onClick={() => setShowGacha(true)}
                  >
                    <Sparkles size={17} /> Le débloquer
                    {price > 0 && ` — ${price} points`}
                  </button>
                  <span className="coll-hero-channel" title="Il n'est pas encore sur ton étagère">
                    <Lock size={15} /> Ce boîtier n'est pas dans ta collection
                  </span>
                </>
              ) : game ? (
                <>
                  <button
                    className="btn btn-primary clickable"
                    onClick={() => setPlaying(true)}
                    disabled={!media.cartridge?.rom}
                    title={
                      media.cartridge?.rom
                        ? "Allumer la console"
                        : "Aucune cartouche dans ce boîtier"
                    }
                  >
                    <Gamepad2 size={17} />
                    {played > 60 ? "Rejouer" : "Jouer"}
                  </button>
                  <span className="coll-hero-channel" title="Émulation dans le navigateur">
                    <Cpu size={15} /> Se joue ici, sans rien installer
                  </span>
                </>
              ) : comic ? (
                <>
                  <button
                    className="btn btn-primary clickable"
                    onClick={() => {
                      setOpenAt(pageAt);
                      setReading("volume");
                    }}
                  >
                    <BookOpen size={17} />
                    {pageAt > 0 ? `Reprendre page ${pageAt + 1}` : "Ouvrir"}
                  </button>
                  {pageAt > 0 && (
                    <button
                      className="btn btn-ghost clickable"
                      onClick={() => {
                        savePage(0);
                        setOpenAt(0);
                        setReading("volume");
                      }}
                    >
                      Repartir du début
                    </button>
                  )}
                  <button
                    className="btn btn-ghost clickable"
                    onClick={() => {
                      setOpenAt(pageAt);
                      setReading("plat");
                    }}
                    title="Planche pleine page : zoom, planche-contact, ruban vertical"
                  >
                    Lecture à plat
                  </button>
                </>
              ) : (
                <>
                  {/* UN BOÎTIER PEUT ÊTRE VIDE. Le rayon vidéo ne s'héberge pas
                      lui-même : quand tous les hébergeurs d'un titre ont fermé,
                      le vérificateur de liens retire les sources mortes et il ne
                      reste plus un seul épisode à lire. Le bouton le dit plutôt
                      que d'ouvrir le lecteur sur du noir. */}
                  <button
                    className="btn btn-primary clickable"
                    onClick={() => watch(hasResume ? current : 0, hasResume ? resumePos : 0)}
                    disabled={!playable}
                    title={
                      playable
                        ? undefined
                        : "Plus aucune source disponible pour ce titre"
                    }
                  >
                    <Play size={17} fill="currentColor" />
                    {!playable
                      ? "Indisponible"
                      : hasResume
                        ? "Reprendre"
                        : isSeries
                          ? "Lancer l'épisode 1"
                          : "Regarder"}
                  </button>
                  {playable && hasResume && (
                    <button className="btn btn-ghost clickable" onClick={() => watch(0, 0)}>
                      Repartir du début
                    </button>
                  )}
                  {soloFilm && (
                    <button
                      className={`btn btn-ghost clickable coll-hero-seen ${filmSeen ? "on" : ""}`}
                      onClick={() => toggleWatched(0)}
                      title={
                        filmSeen
                          ? "Retirer ce film des titres vus"
                          : "Marquer ce film comme vu"
                      }
                    >
                      <Check size={16} strokeWidth={3} />
                      {filmSeen ? "Vu" : "Marquer comme vu"}
                    </button>
                  )}
                  {/* REGARDER À PLUSIEURS. Le bouton n'apparaît que là où il
                      tient sa promesse : il faut quelque chose à jouer, et un
                      titre qui se regarde (le papier se lit à son rythme, une
                      cartouche ne se pilote pas à distance — les deux autres
                      branches de ce `if` n'ont donc rien de tel). */}
                  {playable && (
                    <button
                      className="btn btn-ghost clickable coll-hero-party"
                      onClick={openParty}
                      disabled={partyBusy}
                      title="Ouvrir une salle et inviter des amis à regarder en même temps"
                    >
                      {partyBusy ? (
                        <Loader2 size={16} className="coll-spin" />
                      ) : (
                        <Users size={16} />
                      )}
                      Watchparty
                    </button>
                  )}
                  {!playable && (
                    <span className="coll-hero-channel" title="Les hébergeurs de ce titre ne répondent plus">
                      <Unplug size={15} /> Les sources de ce titre se sont éteintes
                    </span>
                  )}
                </>
              )}
              {media.source?.channel && (
                <a
                  className="coll-hero-channel clickable"
                  href={media.source.channelUrl || media.source.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Voir la source sur YouTube"
                >
                  <MonitorPlay size={15} /> {media.source.channel}
                </a>
              )}
              {/* PAS D'HÉBERGEUR ICI. Le nom de domaine du lecteur tiers
                  (« french-stream.one ») tenait la place d'une information
                  alors qu'il n'en est pas une à ce moment-là : on choisit son
                  lecteur DANS la visionneuse, où chaque source est nommée.
                  L'aveu que rien n'est rehébergé, lui, reste — il est dans la
                  pastille de licence et au bas de la page Collection. */}
            </div>

            {media.games?.length > 0 && (
              <div className="coll-hero-games">
                <Gamepad2 size={14} />
                {media.games.map((g) => (
                  <Link key={g.igdbId} to={`/game/${g.igdbId}`} className="clickable">
                    {g.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* `no-eps` remonte la discussion à la place de la liste d'épisodes — sur
          un film, elle n'en a pas. Un boîtier verrouillé, LUI, a bien un bloc
          en première colonne (le panneau ci-dessous) : appliquer la règle du
          film ferait alors chevaucher les deux. */}
      <div className={`coll-detail-body ${owned && soloFilm ? "no-eps" : ""}`}>
        {/* ---------------- le boîtier verrouillé ----------------
            À LA PLACE DU CONTENU, PAS PAR-DESSUS. Un titre qu'on ne possède pas
            n'a ni liste d'épisodes, ni planches, ni cartouche — le serveur ne
            les a pas envoyés. Afficher les sections vides donnerait « 0 épisode »
            et « boîtier vide », c'est-à-dire un titre CASSÉ là où il est
            simplement pas encore à nous. Ce panneau dit la vraie raison et
            montre la sortie.

            Tout le reste de la fiche demeure : résumé, casting, fiche technique,
            discussion. C'est ce qui fait qu'on a envie de l'obtenir. */}
        {!owned && (
          <section className="coll-locked">
            <span className="coll-locked-ic">
              <Lock size={22} />
            </span>
            <h2>
              {comic
                ? "Ce volume n'est pas sur ton étagère"
                : game
                  ? "Cette cartouche n'est pas sur ton étagère"
                  : "Ce boîtier n'est pas sur ton étagère"}
            </h2>
            <p>
              {comic
                ? `Les ${media.pageCount || 0} planches s'ouvriront dès qu'il sera à toi.`
                : game
                  ? "La console démarrera dès que la cartouche sera à toi."
                  : media.episodeCount > 0
                    ? `Les ${media.episodeCount} épisode${
                        media.episodeCount > 1 ? "s" : ""
                      } se lanceront dès qu'il sera à toi.`
                    : "Il se lancera dès qu'il sera à toi."}{" "}
              Un tour de sphère sort un boîtier au hasard parmi ceux qui te
              manquent — celui-ci en fait partie.
            </p>
            <button className="btn btn-primary clickable" onClick={() => setShowGacha(true)}>
              <Sparkles size={16} /> Tourner la sphère
              {price > 0 && ` — ${price} points`}
            </button>
            <Link to="/collection" className="coll-locked-link clickable">
              Voir mon étagère <ArrowRight size={14} />
            </Link>
          </section>
        )}

        {/* ---------------- planches ---------------- */}
        {owned && comic && (
          <section className="coll-eps">
            <div className="coll-eps-head">
              <h2 className="coll-section-title">
                Planches
                <em>
                  {media.pageCount}
                  {pageAt > 0 ? ` · lu jusqu'à la ${pageAt + 1}` : ""}
                </em>
              </h2>
            </div>
            {/* Un aperçu cliquable : on ouvre le volume À LA PLANCHE qu'on
                désigne, comme on pose le doigt au milieu d'un livre. */}
            <Plates
              pages={media.pages || []}
              pageAt={pageAt}
              onOpen={(index) => {
                setOpenAt(index);
                setReading("volume");
              }}
            />
          </section>
        )}

        {/* ---------------- la cartouche ---------------- */}
        {owned && game && (
          <section className="coll-eps">
            <div className="coll-eps-head">
              <h2 className="coll-section-title">
                La cartouche
                {media.cartridge?.code && <em>{media.cartridge.code}</em>}
              </h2>
            </div>
            <div className="coll-cart">
              <span className="coll-cart-icon">
                {media.poster ? (
                  <img src={media.poster} alt="" />
                ) : (
                  <Gamepad2 size={22} />
                )}
              </span>
              <span className="coll-cart-text">
                <strong>
                  {media.cartridge?.rom
                    ? "Prête à démarrer"
                    : "Boîtier vide — la cartouche n'a pas été déposée"}
                </strong>
                <span>
                  {[
                    CONSOLE,
                    media.cartridge?.region,
                    media.cartridge?.saveType,
                    media.cartridge?.bytes
                      ? `${Math.round(media.cartridge.bytes / 1024 / 1024)} Mo`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {/* CE QUI SE DIT ICI A CHANGÉ DE SENS avec le rayon. Du temps de
                    la DS, la sauvegarde restait dans le navigateur — on le disait,
                    et c'était une limite qu'on présentait en fonctionnalité. Elle
                    est maintenant sur le compte, ce qui est la vraie promesse :
                    on reprend d'où on veut. */}
                <span>
                  La partie tourne dans ton navigateur, mais ta sauvegarde est sur
                  ton compte : tu la retrouves depuis n'importe quel appareil.
                </span>
              </span>
            </div>
          </section>
        )}

        {/* ---------------- épisodes ---------------- */}
        {owned && !comic && !game && !soloFilm && (
        <section className="coll-eps">
          <div className="coll-eps-head">
            <h2 className="coll-section-title">
              {isSeries ? "Épisodes" : "Le film"}
              {isSeries && (
                <em>
                  {watched.size}/{media.episodes.length} vus
                </em>
              )}
            </h2>
            {seasons.length > 1 && (
              <div className="coll-seasons">
                {seasons.map((s) => (
                  <button
                    key={s}
                    className={`clickable ${season === s ? "active" : ""}`}
                    onClick={() => setSeason(s)}
                  >
                    Saison {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ul className="coll-eps-list">
            {episodes.map((ep) => {
              const isWatched = watched.has(ep.index);
              return (
                <li
                  key={ep.index}
                  className={`coll-ep ${isWatched ? "seen" : ""} ${
                    ep.index === current && resumePos > 30 ? "current" : ""
                  }`}
                >
                  <button
                    className="coll-ep-main clickable"
                    onClick={() => watch(ep.index, ep.index === current ? resumePos : 0)}
                  >
                    {/* Un lecteur tiers ne sert pas de vignette : on retombe
                        sur le bandeau du titre, puis sur l'affiche. */}
                    <span className="coll-ep-thumb">
                      <img
                        src={ep.thumb || media.backdrop || media.poster}
                        alt=""
                        loading="lazy"
                      />
                      <i className="coll-ep-thumb-play">
                        <Play size={14} fill="currentColor" />
                      </i>
                      {ep.duration && (
                        <em className="coll-ep-dur">{fmtDuration(ep.duration)}</em>
                      )}
                      {ep.provider && ep.provider !== "youtube" && (
                        <em className="coll-ep-src" title={PROVIDERS[ep.provider]?.hint}>
                          {hostOf(ep.url)}
                          {ep.mirrors?.length > 0 ? ` +${ep.mirrors.length}` : ""}
                        </em>
                      )}
                    </span>
                    <span className="coll-ep-text">
                      <strong>
                        {isSeries && (
                          <span className="coll-ep-num">
                            {String(ep.number ?? ep.index + 1).padStart(2, "0")}
                          </span>
                        )}
                        {ep.title}
                      </strong>
                      {ep.synopsis && <span>{ep.synopsis}</span>}
                    </span>
                  </button>
                  <button
                    className={`coll-ep-check clickable ${isWatched ? "on" : ""}`}
                    onClick={() => toggleWatched(ep.index)}
                    title={isWatched ? "Marquer comme non vu" : "Marquer comme vu"}
                    aria-label={isWatched ? "Marquer comme non vu" : "Marquer comme vu"}
                  >
                    <Check size={14} strokeWidth={3} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        )}

        {/* ---------------- colonne latérale ---------------- */}
        <aside className="coll-aside">
          {media.cast?.length > 0 && (
            <section className="coll-cast card">
              <h3>
                <Users size={14} /> Casting
              </h3>
              <ul>
                {media.cast.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <span className="coll-cast-face">
                      {c.photo ? (
                        <img src={c.photo} alt="" loading="lazy" />
                      ) : (
                        <i>{c.name.slice(0, 1)}</i>
                      )}
                    </span>
                    <span className="coll-cast-text">
                      <strong>{c.character || c.name}</strong>
                      {c.character && <em>{c.name}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="coll-facts card">
            <h3>Fiche technique</h3>
            <dl>
              {game && (
                <>
                  <dt>Console</dt>
                  <dd>{CONSOLE}</dd>
                </>
              )}
              {game && media.authors?.length > 0 && (
                <>
                  <dt>Développement</dt>
                  <dd>{media.authors.join(", ")}</dd>
                </>
              )}
              {game && media.publisher && (
                <>
                  <dt>Éditeur</dt>
                  <dd>{media.publisher}</dd>
                </>
              )}
              {media.studio && (
                <>
                  <dt>Réalisation</dt>
                  <dd>{media.studio}</dd>
                </>
              )}
              {media.network && (
                <>
                  <dt>Diffusion</dt>
                  <dd>{media.network}</dd>
                </>
              )}
              {media.country && (
                <>
                  <dt>Pays</dt>
                  <dd>{media.country}</dd>
                </>
              )}
              <dt>Support</dt>
              <dd>{format.hint}</dd>
              <dt>Accès</dt>
              <dd>{licence.hint}</dd>
            </dl>

            {media.sources?.length > 0 && (
              <p className="coll-sources">
                Métadonnées : {media.sources.join(", ")}
                {media.links?.wikipedia && (
                  <a href={media.links.wikipedia} target="_blank" rel="noreferrer">
                    Wikipédia <ExternalLink size={11} />
                  </a>
                )}
              </p>
            )}
          </section>
        </aside>

        {/* ---------------- discussion ----------------
            APRÈS la colonne latérale dans le code, mais dessous à l'écran : la
            grille place ses enfants dans l'ordre, et le fil posé avant l'aside
            atterrirait dans la colonne de 300 px. Il reprend sa place à la
            ligne suivante de la colonne principale (voir .coll-comments). */}
        <div className="coll-comments">
          <CollectionComments slug={slug} kind={media.kind} token={token} />
        </div>
      </div>

      {/* Le lecteur de papier et le téléviseur ne cohabitent jamais : un titre
          est l'un ou l'autre. Ils sont montés côte à côte plutôt qu'en
          alternative, parce que chacun garde son propre état d'ouverture. */}
      {reading === "plat" && (
        <Suspense fallback={null}>
          <ComicReader
            media={media}
            startPage={openAt ?? pageAt}
            onProgress={savePage}
            onClose={() => setReading(null)}
          />
        </Suspense>
      )}

      {reading === "volume" && (
        <Suspense fallback={null}>
          <BookReader3D
            media={media}
            startPage={openAt ?? pageAt}
            onProgress={savePage}
            onClose={() => setReading(null)}
          />
        </Suspense>
      )}

      {playing && (
        <Suspense fallback={null}>
          <GbaPlayer
            media={media}
            token={token}
            onPlayed={savePlayed}
            onClose={() => setPlaying(false)}
          />
        </Suspense>
      )}

      {/* La visionneuse : l'image au centre, un titre en haut, une barre en
          bas. Plus de décor à choisir (voir CollectionViewer). */}
      {watching && (
        <CollectionViewer
          media={media}
          startIndex={watching.index}
          startAt={watching.at}
          onClose={() => setWatching(null)}
          onProgress={saveProgress}
        />
      )}

      {/* La machine depuis la fiche d'un boîtier qu'on convoite. Le tirage
          reste ALÉATOIRE — on ne choisit pas ce qu'on obtient, c'est le principe
          d'une machine à capsules — mais si c'est justement celui-ci qui sort,
          la fiche se déverrouille sous nos yeux, sans rechargement. */}
      {showGacha && (
        <GachaModal
          token={token}
          onClose={() => setShowGacha(false)}
          onDrawn={(res) => {
            if (res.media?.slug !== slug) return;
            setMedia((m) => (m ? { ...m, owned: true } : m));
            // La fiche complète (épisodes, planches, cartouche) n'était pas dans
            // la réponse du serveur : on la redemande maintenant qu'on y a droit.
            apiFetch(`/collection/${slug}`, { token })
              .then((d) => {
                setMedia(d.media);
                setSeason(d.media.episodes?.[0]?.season ?? null);
              })
              .catch(() => {
                /* la fiche se remplira au prochain chargement */
              });
          }}
        />
      )}
    </div>
  );
}

// ======================================================================
//  La planche-contact
// ======================================================================
// DEUX RANGÉES, PUIS ON DÉPLIE. Un tome relié fait trois cents planches : la
// grille complète poussait tout ce qui suit — la fiche technique, et surtout la
// discussion — à plusieurs écrans de défilement, et personne ne descend
// jusque-là. Deux rangées suffisent à montrer de quoi le volume a l'air ; le
// reste se demande.
//
// COMBIEN DE VIGNETTES DANS UNE RANGÉE ? Ça dépend de la largeur : la grille est
// en `auto-fill`, et une planche fait 96 px au minimum (voir app-29-comics.css).
// Plutôt que de refaire ce calcul à la main — il faudrait connaître le gap, les
// marges, la colonne latérale, et le refaire à chaque changement de feuille de
// style — on lit ce que la grille a DÉCIDÉ : une fois appliquée,
// `grid-template-columns` se lit en pixels (« 96.5px 96.5px … »), et compter ses
// pistes donne la réponse exacte. Le calcul reste juste même si la grille change
// un jour d'allure, et il vaut aussi quand on n'affiche qu'une poignée de
// vignettes : `auto-fill` résout toutes ses pistes, y compris les vides.
const PLATE_ROWS = 2;

// Le repli quand la grille n'est pas MESURABLE (pas encore mise en page) : la
// mesure ayant lieu avant la peinture, ce cas ne se voit pas à l'ouverture
// normale d'un volume. Une largeur plausible plutôt que tout le tome — un défaut
// trop généreux ferait réapparaître exactement ce qu'on cherche à éviter.
const PLATES_FALLBACK = 12;

function Plates({ pages, pageAt, onOpen }) {
  const gridRef = useRef(null);
  const [perRow, setPerRow] = useState(0);
  const [open, setOpen] = useState(false);

  // AVANT LA PEINTURE, pas après : mesurer dans un `useEffect` laisserait le
  // premier rendu montrer le repli par défaut (deux rangées supposées larges),
  // que la mesure viendrait raccourcir sous les yeux. `useLayoutEffect` mesure
  // et recadre dans la même image — la grille n'apparaît qu'une fois, juste.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns;
      // Non mise en page (onglet caché, feuille pas encore là) : la valeur
      // revient telle qu'écrite, « repeat(auto-fill, minmax(…)) ». On ne
      // compte que des pistes résolues, jamais une formule.
      const resolved = tracks && tracks !== "none" && !tracks.includes("(");
      setPerRow(resolved ? tracks.split(/\s+/).filter(Boolean).length : 0);
    };
    measure();
    // Le rayon se replie aussi quand la fenêtre change de taille ou que la
    // colonne latérale disparaît — la largeur ne dépend pas que de la fenêtre.
    // Replier change la hauteur de la grille, donc rappelle l'observateur :
    // la deuxième mesure trouve le même nombre de colonnes et React s'arrête là.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const limit = (perRow || PLATES_FALLBACK) * PLATE_ROWS;
  const shown = open ? pages : pages.slice(0, limit);
  const rest = pages.length - shown.length;

  function fold() {
    setOpen(false);
    // Replier depuis le bas d'un tome de trois cents planches laisserait le
    // lecteur devant un écran vide, très loin sous la section qui vient de se
    // refermer. On le ramène à ses vignettes.
    requestAnimationFrame(() =>
      gridRef.current?.scrollIntoView({ block: "nearest" })
    );
  }

  return (
    <>
      <div className="coll-plates" ref={gridRef}>
        {shown.map((pg) => (
          <button
            key={pg.index}
            className={`coll-plate clickable ${pg.index === pageAt && pageAt > 0 ? "on" : ""}`}
            onClick={() => onOpen(pg.index)}
            title={`Ouvrir à la planche ${pg.index + 1}`}
          >
            {/* LA VIGNETTE, JAMAIS LA PLANCHE. Un volume de cent pages, c'est
                cent scans de deux mégaoctets à décoder pour les montrer larges
                de cent pixels : l'onglet ne s'en relève pas. `thumb` est nulle
                sur les titres importés avant qu'elles n'existent — d'où le
                repli, qui reste lent mais juste. */}
            <img src={pg.thumb || pg.src} alt="" loading="lazy" decoding="async" />
            <em>{pg.index + 1}</em>
          </button>
        ))}
      </div>

      {(rest > 0 || open) && (
        <button
          className="coll-plates-more clickable"
          onClick={open ? fold : () => setOpen(true)}
        >
          {open ? (
            <>
              <ChevronUp size={15} /> Replier les planches
            </>
          ) : (
            <>
              <ChevronDown size={15} /> Voir les {rest} planche
              {rest > 1 ? "s" : ""} suivante{rest > 1 ? "s" : ""}
            </>
          )}
        </button>
      )}
    </>
  );
}
