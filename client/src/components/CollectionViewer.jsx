import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  X,
  Volume2,
  Volume1,
  VolumeX,
  ListVideo,
  Check,
  Star,
  ExternalLink,
  Loader2,
  Unplug,
  ChevronDown,
} from "lucide-react";
import { useVideoSession, SANDBOX, hostOfUrl } from "../hooks/useVideoSession";
import { useBackClose } from "../hooks/useBackClose";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";
import { fmtClock, langLabel } from "../lib/collection";

// ======================================================================
//  La visionneuse — l'image, et le strict nécessaire autour
// ======================================================================
// IL Y A EU DEUX DÉCORS ICI, ET AUCUN N'A SURVÉCU. Un poste cathodique avec ses
// molettes et son bruit de piste, une salle de projection avec rideau de
// velours. Jolis tous les deux, et faux pour la même raison : ON NE REGARDE PAS
// UN DÉCOR, ON REGARDE L'IMAGE. Le tube imposait en plus un cadre 4/3 qui
// rognait les lecteurs tiers — un cadre décoratif qui coupe la vidéo qu'il
// entoure, c'est le décor qui a gagné contre le film.
//
// Ce qui reste tient en trois plans :
//
//   1. LE LECTEUR, au centre, dans son rapport naturel. Aucun cadre, aucun
//      rognage, aucun réglage de format : la boîte s'adapte à la fenêtre, et
//      l'image occupe tout ce qu'elle peut sans jamais être coupée ;
//   2. UNE LIGNE EN HAUT — le titre, et de quoi sortir ;
//   3. UNE BARRE EN BAS — la lecture quand on la tient, la source toujours.
//
// Les deux barres s'effacent après trois secondes sans geste et reviennent au
// moindre mouvement. Rien d'autre ne bouge tout seul.
//
// CE QUI A ÉTÉ RETIRÉ, ET POURQUOI : le bouton « libérer le cadre » (un réglage
// de bac à sable posé au milieu d'un lecteur de films — voir useVideoSession,
// où sa vraie fonction tient désormais en une ligne de `referrerPolicy`), la
// bascule 4:3 / 16:9 (elle rognait au lieu d'ajuster) et le choix du décor.
// Trois questions posées au spectateur, dont aucune ne l'aidait à voir le film.

const IDLE_MS = 3000;

export default function CollectionViewer({
  media,
  startIndex = 0,
  startAt = 0,
  // La piste choisie sur la fiche (« vf », « vostfr »). La séance ne fait que
  // l'honorer : le choix se prend là où l'on voit ce qui existe, pas au milieu
  // d'un film.
  lang = "",
  onClose,
  onProgress,
}) {
  const { token, user } = useAuth();

  // LA FICHE EN SÉANCE. Une source retirée par un administrateur change les
  // épisodes sous le lecteur : on tient donc une copie vivante, que le serveur
  // renvoie à jour après chaque geste.
  const [live, setLive] = useState(media);
  const [busyHost, setBusyHost] = useState(null);

  const s = useVideoSession({
    media: live,
    startIndex,
    startAt,
    onClose,
    onProgress,
    defaultHost: live.defaultHost || "",
    lang,
    // Rien à ouvrir : on n'allume plus un poste, on lance une vidéo.
    warmupMs: 0,
    outroMs: 180,
  });

  // Le bouton « retour » du téléphone ferme la séance.
  const closeRef = useRef(null);
  closeRef.current = s.close;
  useBackClose(() => closeRef.current?.(), "viewer");

  // --- L'habillage qui s'efface ---------------------------------------------
  // Il ne part que si l'on ne s'en sert pas ET que ça joue : en pause, ou la
  // souris posée dessus, il reste — sinon on chercherait ses boutons dans le
  // noir.
  const [idle, setIdle] = useState(false);
  const [overChrome, setOverChrome] = useState(false);
  const idleTimer = useRef(null);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [wake]);
  const hidden = idle && s.isPlaying && !overChrome && !s.showList;

  const chrome = {
    onPointerEnter: () => setOverChrome(true),
    onPointerLeave: () => setOverChrome(false),
  };

  // --- L'hébergeur retenu, pour tout le monde -------------------------------
  // N'importe qui peut le poser : celui qui vient de trouver le lecteur qui
  // marche épargne la recherche aux suivants. Un second clic le retire.
  async function star(host) {
    const next = live.defaultHost === host ? "" : host;
    setLive((m) => ({ ...m, defaultHost: next })); // l'étoile répond tout de suite
    try {
      await apiFetch(`/collection/${live.slug}/default-source`, {
        method: "POST",
        token,
        body: { host: next },
      });
      s.flash(next ? `LECTEUR PAR DÉFAUT — ${next.toUpperCase()}` : "PLUS DE LECTEUR PAR DÉFAUT");
    } catch {
      setLive((m) => ({ ...m, defaultHost: media.defaultHost || "" }));
    }
  }

  // --- Retirer un hébergeur mort (administration) ---------------------------
  // Constaté en séance, réparé en séance : l'hôte part de TOUS les épisodes,
  // le miroir suivant prend sa place.
  async function drop(host) {
    if (
      !confirm(
        `Retirer « ${host} » de ce titre ?\n\n` +
          `Tous ses liens seront effacés, sur tous les épisodes. Les épisodes qui ` +
          `n'ont que celui-là quitteront la liste.`
      )
    )
      return;
    setBusyHost(host);
    try {
      const d = await apiFetch(`/collection/${live.slug}/sources/${encodeURIComponent(host)}`, {
        method: "DELETE",
        token,
      });
      // La fiche renvoyée par le serveur ne porte PAS la progression de qui
      // regarde (elle est servie sans utilisateur) : on garde la nôtre, sinon
      // les épisodes déjà vus se décocheraient sous les yeux du spectateur.
      setLive((m) => ({ ...m, ...d.media, progress: m.progress }));
      s.flash(`${host.toUpperCase()} RETIRÉ`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyHost(null);
    }
  }

  const vol = s.muted ? 0 : s.volume;
  const VolIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;

  // Le survol du rail annonce où l'on atterrirait : sur un film de deux heures,
  // viser à l'aveugle coûte cher.
  const [hover, setHover] = useState(null);
  const barRef = useRef(null);
  const ratioAt = (e) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
  };

  return createPortal(
    <div
      className={`vw phase-${s.phase} ${hidden ? "idle" : ""}`}
      role="dialog"
      aria-label={live.title}
      style={{ "--tint": live.color || "#f2b70b" }}
      onPointerMove={wake}
    >
      {/* Le seul ornement, et il est fonctionnel : la teinte du titre, très
          diluée, derrière l'image. Elle décolle l'écran du fond noir sans rien
          poser dessus. */}
      <span className="vw-glow" aria-hidden="true" />

      {/* ---------------- l'image ----------------
          Une boîte au rapport 16/9 qui prend tout ce que la fenêtre lui laisse,
          barres comprises. Aucun rognage : ce que le lecteur envoie est ce
          qu'on voit. */}
      <div className="vw-stage">
        <div className="vw-screen">
          {!s.source ? (
            <div className="vw-empty">
              <Unplug size={30} />
              <strong>Plus aucune source</strong>
              <span>
                {s.episodes.length
                  ? "Cet épisode n'a plus de lecteur."
                  : "Ce titre n'a plus rien à jouer."}
              </span>
            </div>
          ) : s.provider === "youtube" ? (
            <div className="vw-yt" ref={s.holderRef} />
          ) : s.provider === "file" ? (
            <video
              ref={s.videoRef}
              className="vw-video"
              src={s.source.url}
              playsInline
              controls={false}
              crossOrigin="anonymous"
            />
          ) : (
            <iframe
              key={s.source.url}
              className="vw-embed"
              src={s.source.url}
              title={s.episode?.title || live.title}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              // Notre origine part d'emblée : c'est ce que vérifient la plupart
              // des lecteurs qui « refusent de démarrer ». Le bac à sable, lui,
              // ne se lève jamais — il tient les pop-unders à distance.
              referrerPolicy="origin"
              sandbox={SANDBOX}
            />
          )}

          {/* Le clic sur l'image met en pause — mais seulement là où l'on tient
              vraiment la lecture. Sur un lecteur tiers, l'image est à lui. */}
          {s.piloted && s.source && (
            <button
              className="vw-tap"
              onClick={s.togglePlay}
              aria-label={s.isPlaying ? "Pause" : "Lecture"}
            />
          )}

          {s.osd && (
            <div key={s.osd.id} className="vw-osd">
              <span>{s.osd.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- en-tête ---------------- */}
      <header className="vw-top" {...chrome}>
        <button className="vw-icon clickable" onClick={s.close} title="Fermer (Échap)">
          <X size={19} />
        </button>
        <div className="vw-title">
          <strong>{live.title}</strong>
          {s.isSeries ? (
            <em>
              Épisode {s.channel}
              {s.episode?.title ? ` · ${s.episode.title}` : ""}
            </em>
          ) : (
            <em>{[live.year, live.studio].filter(Boolean).join(" · ")}</em>
          )}
        </div>
      </header>

      {/* ---------------- commandes ---------------- */}
      <footer className="vw-bar" {...chrome}>
        {/* Le rail n'existe QUE si l'on tient la lecture : une barre qui ne
            bouge pas se lit comme une panne. */}
        {s.piloted && (
          <div
            className="vw-rail clickable"
            ref={barRef}
            onPointerDown={(e) => s.duration && s.seekTo(ratioAt(e) * s.duration)}
            onPointerMove={(e) => setHover(ratioAt(e))}
            onPointerLeave={() => setHover(null)}
            role="slider"
            aria-label="Position dans la vidéo"
            aria-valuenow={Math.round(s.pct)}
            tabIndex={0}
          >
            <span className="vw-rail-bed" />
            <span className="vw-rail-cur" style={{ width: `${s.pct}%` }} />
            <span className="vw-rail-thumb" style={{ left: `${s.pct}%` }} />
            {hover != null && s.duration > 0 && (
              <span className="vw-rail-tip" style={{ left: `${hover * 100}%` }}>
                {fmtClock(hover * s.duration)}
              </span>
            )}
          </div>
        )}

        <div className="vw-row">
          <div className="vw-row-left">
            {s.piloted ? (
              <>
                <button
                  className="vw-play clickable"
                  onClick={s.togglePlay}
                  title={s.isPlaying ? "Pause (Espace)" : "Lecture (Espace)"}
                  aria-label={s.isPlaying ? "Pause" : "Lecture"}
                >
                  {s.isPlaying ? (
                    <Pause size={19} fill="currentColor" />
                  ) : (
                    <Play size={19} fill="currentColor" />
                  )}
                </button>
                <button
                  className="vw-icon clickable"
                  onClick={() => s.seekBy(-s.seekStep)}
                  title="Reculer de 10 secondes (←)"
                  aria-label="Reculer de 10 secondes"
                >
                  <RotateCcw size={17} />
                </button>
                <button
                  className="vw-icon clickable"
                  onClick={() => s.seekBy(s.seekStep)}
                  title="Avancer de 10 secondes (→)"
                  aria-label="Avancer de 10 secondes"
                >
                  <RotateCw size={17} />
                </button>
              </>
            ) : (
              // Un lecteur qu'on ne pilote pas ne dira jamais qu'il est arrivé
              // au bout : la seule façon honnête de cocher, c'est de demander.
              <button
                className="vw-play clickable"
                onClick={s.markWatched}
                title="Marquer comme vu"
                aria-label="Marquer comme vu"
              >
                <Check size={19} strokeWidth={3} />
              </button>
            )}

            {s.isSeries && (
              <>
                <span className="vw-sep" aria-hidden="true" />
                <button
                  className="vw-icon clickable"
                  onClick={() => s.goto(s.index - 1)}
                  disabled={s.index === 0}
                  title="Épisode précédent ([)"
                  aria-label="Épisode précédent"
                >
                  <SkipBack size={17} />
                </button>
                <button
                  className="vw-icon clickable"
                  onClick={() => s.goto(s.index + 1)}
                  disabled={s.index >= s.episodes.length - 1}
                  title="Épisode suivant (])"
                  aria-label="Épisode suivant"
                >
                  <SkipForward size={17} />
                </button>
              </>
            )}

            {s.piloted && (
              <>
                <span className="vw-sep" aria-hidden="true" />
                <div className="vw-vol">
                  <button
                    className="vw-icon clickable"
                    onClick={s.toggleMute}
                    title={vol === 0 ? "Rétablir le son" : "Couper le son"}
                    aria-label={vol === 0 ? "Rétablir le son" : "Couper le son"}
                  >
                    <VolIcon size={17} />
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={vol}
                    onChange={(e) => s.changeVolume(Number(e.target.value))}
                    aria-label="Volume"
                    style={{ "--fill": `${vol * 100}%` }}
                  />
                </div>
                <span className="vw-clock">
                  {fmtClock(s.cur)} <em>/ {fmtClock(s.duration)}</em>
                </span>
              </>
            )}
          </div>

          <div className="vw-row-right">
            <SourcePicker
              session={s}
              defaultHost={live.defaultHost || ""}
              onStar={star}
              onDrop={user?.isAdmin ? drop : null}
              busyHost={busyHost}
            />

            {s.isSeries && (
              <button
                className={`vw-pill clickable ${s.showList ? "on" : ""}`}
                onClick={() => s.setShowList((v) => !v)}
                title="Liste des épisodes"
              >
                <ListVideo size={15} />
                <span>Épisodes</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Le tiroir d'épisodes. C'est aussi l'emplacement prévu pour la
          conversation d'une séance à deux : même largeur, même empilement — les
          deux ne s'ouvriront jamais ensemble. */}
      {s.showList && s.isSeries && (
        <aside className="vw-list" {...chrome}>
          <header>
            <span>{live.title}</span>
            <button
              className="clickable"
              onClick={() => s.setShowList(false)}
              aria-label="Fermer"
            >
              <X size={15} />
            </button>
          </header>
          <ul>
            {s.episodes.map((ep, i) => (
              <li key={ep.index ?? i}>
                <button
                  className={`clickable ${i === s.index ? "current" : ""}`}
                  onClick={() => {
                    s.goto(i);
                    s.setShowList(false);
                  }}
                >
                  <span className="vw-list-num">
                    {String(ep.number ?? i + 1).padStart(2, "0")}
                  </span>
                  <span className="vw-list-title">{ep.title}</span>
                  {live.progress?.watched?.includes(i) && <Check size={13} />}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>,
    document.body
  );
}

// ---------------------------------------------------------- les sources ----
//
// LE SEUL ENDROIT OÙ L'ON CHOISIT QUELQUE CHOSE. Un titre est souvent servi par
// quatre hébergeurs dont un seul tient la route ce mois-ci ; la liste les pose
// à plat, celui qui joue est marqué, et deux gestes se greffent à côté :
//
//   ★  RETENIR ce lecteur pour tout le monde. Pas un favori personnel : le
//      réglage part en base et vaut pour les prochains spectateurs, y compris
//      aux épisodes suivants. Celui qui a cherché, les autres en profitent ;
//   ✕  RETIRER l'hébergeur (administration seulement), quand il ne rend plus
//      rien. Constaté en séance, réparé en séance.
//
// Un seul lecteur : pas de liste, juste son nom. Rien à choisir, rien à ouvrir.

function SourcePicker({ session: s, defaultHost, onStar, onDrop, busyHost }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => !boxRef.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  if (!s.source) return null;

  const lone = s.sources.length < 2;

  return (
    <div className="vw-src" ref={boxRef}>
      <button
        className={`vw-pill clickable ${open ? "on" : ""}`}
        onClick={() => !lone && setOpen((v) => !v)}
        title={lone ? s.source.label : "Changer de lecteur"}
        aria-haspopup={lone ? undefined : "menu"}
        aria-expanded={lone ? undefined : open}
      >
        {defaultHost && s.host === defaultHost && (
          <Star size={13} fill="currentColor" className="vw-src-star" />
        )}
        <span className="vw-src-name">{s.source.label}</span>
        {!lone && (
          <>
            <em>
              {s.sourceAt + 1}/{s.sources.length}
            </em>
            <ChevronDown size={14} />
          </>
        )}
      </button>

      {open && (
        <div className="vw-src-menu" role="menu">
          <p className="vw-src-head">Lecteurs disponibles</p>
          {s.sources.map((src, i) => {
            const host = hostOfUrl(src.url) || src.label;
            const starred = !!defaultHost && host === defaultHost;
            return (
              <div
                key={`${src.url}-${i}`}
                className={`vw-src-row ${i === s.sourceAt ? "current" : ""}`}
              >
                <button
                  className="vw-src-pick clickable"
                  onClick={() => {
                    s.pickSource(i);
                    setOpen(false);
                  }}
                  role="menuitem"
                >
                  <span className="vw-src-dot" aria-hidden="true" />
                  <span className="vw-src-label">{src.label}</span>
                  {/* La piste de CETTE adresse. Elle n'est pas un choix ici —
                      il se prend sur la fiche — mais elle dit pourquoi deux
                      lecteurs du même épisode ne donnent pas la même chose. */}
                  {src.lang && <em className="vw-src-lang">{langLabel(src.lang)}</em>}
                </button>

                <button
                  className={`vw-src-act clickable ${starred ? "on" : ""}`}
                  onClick={() => onStar(host)}
                  title={
                    starred
                      ? "Ne plus lancer ce lecteur en premier"
                      : "Lancer ce lecteur en premier, pour tout le monde"
                  }
                  aria-pressed={starred}
                >
                  <Star size={14} fill={starred ? "currentColor" : "none"} />
                </button>

                <a
                  className="vw-src-act clickable"
                  href={src.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Ouvrir chez l'hébergeur"
                >
                  <ExternalLink size={14} />
                </a>

                {onDrop && (
                  <button
                    className="vw-src-act danger clickable"
                    onClick={() => onDrop(host)}
                    disabled={busyHost === host}
                    title={`Retirer ${host} de ce titre (administration)`}
                  >
                    {busyHost === host ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <X size={14} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
          <p className="vw-src-foot">
            <Star size={11} /> L'étoile fixe le lecteur lancé en premier — pour tout
            le monde, et sur tous les épisodes.
          </p>
        </div>
      )}
    </div>
  );
}
