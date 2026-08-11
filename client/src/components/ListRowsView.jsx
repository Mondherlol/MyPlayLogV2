import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Clock,
  Gamepad2,
  Languages,
  Layers,
  Loader2,
  Play,
  Star,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";
import { useBackClose } from "../hooks/useBackClose";
import GameAddFan from "./GameAddFan";
import AnnotationBubble from "./AnnotationBubble";
import MediaLightbox from "./MediaLightbox";
import YouTubePlayer from "./YouTubePlayer";

// ======================================================================
//  Vue « liste » d'une liste de jeux — une ligne par jeu, avec les détails
// ======================================================================
// L'affichage en cartes montre des jaquettes ; celui-ci sert à SE DÉCIDER :
// plateformes, langues, compte à rebours avant la sortie, captures en grand et
// bande-annonce, sans quitter la page.
//
// Les détails ne sont PAS chargés d'avance : une liste de conférence fait
// soixante-douze jeux, et tout demander à l'ouverture serait absurde. Chaque
// ligne signale son identifiant en approchant de l'écran, et le lot part en une
// seule requête (cf. GET /games/list-details).

const MAX_PER_REQUEST = 60;
const fmtDate = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// File d'attente partagée par toutes les lignes : ce qui apparaît dans la même
// fenêtre de 150 ms part groupé.
// Exporté avec `GameRow` et `TrailerModal` : l'Explorer affiche EXACTEMENT les
// mêmes lignes, mais dans une liste virtualisée à défilement infini — il lui
// faut donc les pièces, pas le composant complet.
export function useGameDetails(token) {
  const [details, setDetails] = useState({});
  const pending = useRef(new Set());
  const asked = useRef(new Set());
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const flush = useCallback(async () => {
    const all = [...pending.current];
    pending.current = new Set();
    for (let i = 0; i < all.length; i += MAX_PER_REQUEST) {
      const ids = all.slice(i, i + MAX_PER_REQUEST);
      try {
        const d = await apiFetch(`/games/list-details?ids=${ids.join(",")}`, { token });
        setDetails((prev) => {
          const next = { ...prev };
          for (const g of d.games || []) next[g.id] = g;
          // Jeu qu'IGDB ne renvoie plus : on le marque pour ne pas le
          // redemander à chaque défilement.
          for (const id of ids) if (next[id] === undefined) next[id] = null;
          return next;
        });
      } catch {
        for (const id of ids) asked.current.delete(id); // on retentera
      }
    }
  }, [token]);

  const request = useCallback(
    (id) => {
      if (!id || asked.current.has(id)) return;
      asked.current.add(id);
      pending.current.add(id);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 150);
    },
    [flush]
  );

  return [details, request];
}

// Compte à rebours jusqu'à la sortie — même découpage que la fiche de jeu.
function Countdown({ ts }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((ts * 1000 - now) / 1000));
  const pad = (n) => String(n).padStart(2, "0");
  const units = [
    { v: Math.floor(s / 86400), l: "j" },
    { v: pad(Math.floor((s % 86400) / 3600)), l: "h" },
    { v: pad(Math.floor((s % 3600) / 60)), l: "min" },
    { v: pad(s % 60), l: "s" },
  ];
  return (
    <span className="lr-cd" title="Temps restant avant la sortie">
      <Clock size={13} />
      {units.map((u, i) => (
        <span className="lr-cd-unit" key={i}>
          <b>{u.v}</b>
          <i>{u.l}</i>
        </span>
      ))}
    </span>
  );
}

// Bande-annonce en modale. Lecteur jeté à la fermeture — pas de suivi de
// progression ici, contrairement au lecteur social de l'onglet Vidéos.
export function TrailerModal({ trailer, gameName, onClose }) {
  useScrollLock();
  useBackClose(onClose, "listTrailer");
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="modal-overlay lr-trailer-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="lr-trailer">
        <div className="lr-trailer-head">
          <strong>{gameName}</strong>
          <span>{trailer.name}</span>
          <button className="lr-trailer-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="lr-trailer-frame">
          <YouTubePlayer videoId={trailer.videoId} title={trailer.name} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// Une langue avec son drapeau.
function Lang({ lang, label }) {
  return (
    <span className="lr-lang">
      {lang.cc && /^[a-z]{2}$/.test(lang.cc) && (
        <img
          src={`https://flagcdn.com/20x15/${lang.cc}.png`}
          alt=""
          loading="lazy"
          draggable="false"
        />
      )}
      {label || lang.name}
    </span>
  );
}

// Langue d'origine + français (s'il est là), et le décompte du reste.
function Langs({ detail: d }) {
  const orig = d.originalLanguage;
  const fr = d.french;
  const shown = [orig, fr && fr.name !== orig?.name ? fr : null].filter(Boolean);
  const others = d.languages.length - shown.length;

  return (
    <div className="lr-langs" title={d.languages.map((l) => l.name).join(", ")}>
      <Languages size={13} />
      {shown.map((l) => (
        <Lang key={l.name} lang={l} />
      ))}
      {!fr && <span className="lr-lang nofr">Pas de français</span>}
      {others > 0 && (
        <span className="lr-lang more">
          +{others} autre{others > 1 ? "s" : ""} langue{others > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

// L'id IGDB d'un élément. `gameId` est renseigné depuis toujours côté ajout,
// mais `refId` porte la même valeur pour un jeu : de quoi rester debout sur une
// vieille liste où il manquerait.
const idOf = (item) => item.gameId || Number(item.refId) || null;

// --- Une ligne ---
export function GameRow({ item, rank, detail, onNeedDetail, onShots, onTrailer }) {
  const rowRef = useRef(null);
  const gameId = idOf(item);

  // Signale l'id quand la ligne approche de l'écran (400 px d'avance : les
  // détails sont là avant qu'on n'y arrive).
  useEffect(() => {
    const el = rowRef.current;
    if (!el || !gameId) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        onNeedDetail(gameId);
        io.disconnect();
      },
      { rootMargin: "400px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [gameId, onNeedDetail]);

  const d = detail;
  const loading = d === undefined;
  const upcoming = d?.releaseDate && !d.released;
  const cover = item.image || d?.cover;

  return (
    <article className={`lr-row ${rank != null ? "is-ranked" : ""}`} ref={rowRef}>
      {rank != null && <span className="lr-rank">{rank}</span>}

      <div className="lr-cover">
        <Link to={`/game/${gameId}`} title={item.name}>
          {cover ? (
            <img src={cover} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="lr-cover-ph">
              <Gamepad2 size={22} />
            </span>
          )}
        </Link>
      </div>

      <div className="lr-main">
        <div className="lr-title-row">
          <Link to={`/game/${gameId}`} className="lr-title">
            {item.name}
          </Link>
          {/* DLC, remaster, bundle… : savoir qu'on ne regarde pas un jeu de
              base change tout dans une liste de conférence. */}
          {d?.kind && (
            <span
              className="lr-kind"
              title={
                d.kind.parent
                  ? `${d.kind.label} de ${d.kind.parent.name}`
                  : d.kind.label
              }
            >
              <Layers size={11} />
              {d.kind.label}
              {d.kind.parent && (
                <>
                  {" de "}
                  <Link to={`/game/${d.kind.parent.id}`} className="lr-kind-parent">
                    {d.kind.parent.name}
                  </Link>
                </>
              )}
            </span>
          )}
          {d?.rating != null && (
            <span className="lr-score" title={`${d.ratingCount} avis`}>
              <Star size={12} fill="currentColor" strokeWidth={0} />
              {d.rating}
            </span>
          )}
          <AnnotationBubble note={item.note} media={item.media} />
        </div>

        <div className="lr-meta">
          {d?.releaseDate ? (
            <span className="lr-date">{fmtDate.format(new Date(d.releaseDate * 1000))}</span>
          ) : loading ? (
            <span className="gp-skel gp-skel-bar" style={{ width: 120, height: 12 }} />
          ) : (
            <span className="lr-date tbd">Date inconnue</span>
          )}
          {d?.genres?.length > 0 && (
            <span className="lr-genres">{d.genres.slice(0, 3).join(" · ")}</span>
          )}
        </div>

        {upcoming && <Countdown ts={d.releaseDate} />}

        {d?.platforms?.length > 0 && (
          <div className="lr-plats">
            {d.platforms.slice(0, 7).map((p) => (
              <Link
                key={p.id}
                to={`/platform/${p.id}`}
                className="lr-plat clickable"
                title={p.name}
              >
                {p.abbr}
              </Link>
            ))}
            {d.platforms.length > 7 && (
              <span className="lr-plat more">+{d.platforms.length - 7}</span>
            )}
          </div>
        )}

        {d?.summary && <p className="lr-summary">{d.summary}</p>}

        {/* Langues : la langue d'origine et le français, rien de plus. La liste
            complète noyait la ligne sous quinze drapeaux dont on n'a rien à
            faire ; ce qu'on veut savoir, c'est « c'est en VO quoi ? » et
            « est-ce jouable en français ? ». */}
        {d?.languages?.length > 0 && <Langs detail={d} />}

      </div>

      {/* Wishlist / joué / ajouter à une liste, en clair : sur une ligne on a la
          largeur, inutile de les cacher derrière un « + ». Zone de grille à
          part (et non dans .lr-main) pour pouvoir passer pleine largeur sous la
          jaquette sur téléphone. */}
      <div className="lr-actions">
        {d?.trailer && (
          <button
            type="button"
            className="lr-act clickable"
            onClick={() => onTrailer({ trailer: d.trailer, gameName: item.name })}
          >
            <Play size={14} fill="currentColor" strokeWidth={0} /> Bande-annonce
          </button>
        )}
        <GameAddFan
          game={{ id: gameId, name: item.name, cover }}
          variant="row"
          upcoming={upcoming}
        />
      </div>

      {/* Bande de captures : le coup d'œil qui donne envie, cliquable en grand.
          Toutes sont là — en grille sur large écran, en rail qui glisse au
          doigt sur téléphone (cf. CSS), plutôt que d'en jeter la moitié. */}
      {d?.screenshots?.length > 0 && (
        <div className="lr-shots">
          {d.screenshots.map((s, i) => (
            <button
              type="button"
              key={s.id}
              className="lr-shot clickable"
              onClick={() => onShots({ items: d.screenshots, index: i, title: item.name })}
              aria-label="Voir la capture en grand"
            >
              <img src={s.thumb} alt="" loading="lazy" draggable="false" />
            </button>
          ))}
        </div>
      )}

      {loading && gameId && (
        <span className="lr-loading" aria-hidden="true">
          <Loader2 size={14} className="spin" />
        </span>
      )}
    </article>
  );
}

export default function ListRowsView({ items, ranked, token }) {
  const [details, request] = useGameDetails(token);
  const [shots, setShots] = useState(null); // { items, index, title }
  const [trailer, setTrailer] = useState(null); // { trailer, gameName }

  const rows = useMemo(() => items.filter(idOf), [items]);

  return (
    <div className="lr-list">
      {rows.map((it, i) => (
        <GameRow
          key={it.key || it._id || it.refId}
          item={it}
          rank={ranked ? i + 1 : null}
          detail={details[idOf(it)]}
          onNeedDetail={request}
          onShots={setShots}
          onTrailer={setTrailer}
        />
      ))}

      {shots && (
        <MediaLightbox
          items={shots.items}
          index={shots.index}
          onIndex={(index) => setShots((s) => ({ ...s, index }))}
          onClose={() => setShots(null)}
          title={shots.title}
        />
      )}

      {trailer && (
        <TrailerModal
          trailer={trailer.trailer}
          gameName={trailer.gameName}
          onClose={() => setTrailer(null)}
        />
      )}
    </div>
  );
}
