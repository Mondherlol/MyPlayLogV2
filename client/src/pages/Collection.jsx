import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Library,
  LayoutGrid,
  Rows3,
  Search,
  X,
  Play,
  Sparkles,
  Info,
  RotateCw,
  Unplug,
  BookOpen,
  Gamepad2,
  Power,
  Clock3,
  Move,
  Check,
  Undo2,
  ArrowLeft,
  Lock,
  PartyPopper,
  Bug,
  PackagePlus,
  Dices,
  Trash2,
  Coins,
  Loader2,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import useMediaQuery from "../hooks/useMediaQuery";
import CollectionCase from "../components/CollectionCase";
import GachaModal from "../components/GachaModal";
import { ShelfSkeleton, GridSkeleton } from "../components/CollectionSkeleton";
import { KINDS, isComic, resumeLabel, fmtDuration } from "../lib/collection";

// L'étagère 3D (three.js + R3F) ne part que si on la demande : même politique
// que Playtopia, le bundle principal ne doit pas la porter.
const CollectionShelf = lazy(() => import("../components/CollectionShelf"));

// Les listes de réglages viennent de la scène elle-même — mais la scène est en
// chargement paresseux, et la barre d'outils, elle, doit s'afficher tout de
// suite. Elles sont donc recopiées ici, à la seule fin de dessiner les boutons ;
// la valeur choisie n'a de sens que pour la scène (voir `plankSkin`).
const SHELF_SKINS = [
  { value: "", label: "Selon le thème" },
  { value: "chene", label: "Chêne" },
  { value: "noyer", label: "Noyer" },
  { value: "laque", label: "Laqué" },
];

const SHELF_DENSITIES = [
  { value: 10, label: "Large" },
  { value: 20, label: "Normal" },
  { value: 34, label: "Serré" },
];

// Quand un boîtier est entré dans MA collection. C'est cette date-là qui compte
// pour ranger « par ajout », pas celle où l'admin l'a posé au catalogue : le
// rayon est commun, l'étagère est à moi, et son histoire commence à la machine.
const gotAt = (m) => new Date(m.obtainedAt || m.createdAt || 0);

// RANGER D'UN COUP. Déplacer cent boîtiers à la main pour les mettre par ordre
// alphabétique, personne ne le fera : ces quatre boutons écrivent l'ordre d'un
// seul geste, et l'on retouche ensuite à la main ce qui doit l'être. Ce ne sont
// donc PAS des « modes de tri » (il n'y en a qu'un, le sien) : ce sont des
// coups de main, et leur résultat devient l'ordre personnel.
const TIDY = [
  {
    value: "title",
    label: "Titre",
    cmp: (a, b) => (a.title || "").localeCompare(b.title || "", "fr"),
  },
  {
    value: "saga",
    label: "Saga",
    // Les titres sans saga passent après, et se rangent entre eux par titre :
    // sinon ils s'intercalent au hasard entre deux séries qu'ils coupent.
    cmp: (a, b) =>
      (a.franchise || "￿").localeCompare(b.franchise || "￿", "fr") ||
      (a.year || 0) - (b.year || 0) ||
      (a.title || "").localeCompare(b.title || "", "fr"),
  },
  {
    value: "year",
    label: "Année",
    cmp: (a, b) => (a.year || 9999) - (b.year || 9999),
  },
  {
    value: "added",
    label: "Obtention",
    cmp: (a, b) => gotAt(b) - gotAt(a),
  },
];

// ======================================================================
//  Collection — MON étagère de boîtiers
// ======================================================================
// LE RAYON EST COMMUN, L'ÉTAGÈRE EST À MOI. Le catalogue (séries, films,
// animés, comics, cartouches) est garni par l'admin et il est le même pour
// tout le monde — mais on ne le reçoit pas, on le GAGNE, boîtier par boîtier,
// à la machine à capsules de l'arcade. Cette page ne montre donc que ce qu'on
// possède, et le reste du catalogue est une promesse : c'est le compteur
// « 12 / 40 » en tête de page, et le bouton qui mène à la sphère.
//
// La même page sert à regarder celle de quelqu'un d'autre (`/collection/u/:
// pseudo`) : mêmes boîtiers, mêmes vues, mais en lecture seule — on ne range
// pas le meuble d'un autre, et ses reprises en cours ne nous regardent pas.
// Ce qu'on y voit en plus, c'est ce qu'IL a et qu'on n'a pas.

const VIEW_KEY = "mpl_collection_view";

const KIND_FILTERS = [
  { value: "", label: "Tout" },
  { value: "series", label: "Séries" },
  { value: "film", label: "Films" },
  { value: "comic", label: "Comics & mangas" },
  { value: "game", label: "Jeux GBA" },
];

export default function Collection() {
  const { token, user, updateUser } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const compact = useMediaQuery("(max-width: 900px)");

  // `/collection/u/:pseudo` : l'étagère de quelqu'un d'autre. Absent = la
  // mienne. Un pseudo qui est le mien retombe sur la mienne (le serveur le dit
  // dans `owner.isMe`), pour qu'un lien partagé à soi-même ne donne pas une
  // page bridée.
  const { username } = useParams();
  const [owner, setOwner] = useState(null);
  const visiting = !!username && !owner?.isMe;

  const [media, setMedia] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [attempt, setAttempt] = useState(0); // « Réessayer » : relance la requête
  // Combien de boîtiers on possède sur combien il en existe : la jauge de
  // complétion, et la seule chose qui donne un sens à une étagère à moitié vide.
  const [tally, setTally] = useState({ owned: 0, total: 0, price: 0 });
  const [showGacha, setShowGacha] = useState(false);
  // L'établi de mise au point (admin) : replié par défaut, il n'a rien à faire
  // dans la page tant qu'on ne le demande pas.
  const [debug, setDebug] = useState(false);

  // MON MEUBLE. L'ordre où j'ai rangé mes boîtiers, l'essence de la planche, le
  // nombre de boîtiers par rangée. Ça arrive avec le rayon (même requête) et ça
  // repart tout seul, sans bouton « enregistrer » : ranger une étagère, ça se
  // fait en la rangeant.
  const [shelf, setShelf] = useState({ order: [], skin: "", perPlank: 0 });
  const [arranging, setArranging] = useState(false);
  // Ce qui a été touché À LA MAIN : sans ce garde-fou, la première réponse du
  // serveur se réenregistrerait aussitôt elle-même.
  const tuned = useRef(false);

  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") || "";
  const query = params.get("q") || "";

  // La vue 3D est un choix qu'on garde d'une visite à l'autre, mais elle ne
  // s'impose jamais sur un petit écran.
  const [view, setView] = useState(() => {
    if (typeof window === "undefined") return "shelf";
    return localStorage.getItem(VIEW_KEY) || "shelf";
  });
  const effectiveView = compact ? "grid" : view;

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function pickView(v) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* navigation privée : la préférence n'est pas vitale */
    }
  }

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    // Changer d'étagère (la mienne → celle d'un ami) ne doit pas laisser un
    // instant l'ancienne à l'écran sous le nouveau nom.
    tuned.current = false;
    setOwner(null);
    apiFetch(username ? `/collection/u/${encodeURIComponent(username)}` : "/collection", {
      token,
    })
      .then((d) => {
        if (!alive) return;
        setMedia(d.media || []);
        setOwner(d.owner || null);
        if (d.gacha) setTally(d.gacha);
        if (d.shelf)
          setShelf({
            order: d.shelf.order || [],
            skin: d.shelf.skin || "",
            perPlank: d.shelf.perPlank || 0,
          });
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [token, username, attempt]);

  // MON ORDRE D'ABORD, celui du rayon ensuite. Un boîtier que je n'ai jamais
  // rangé (débloqué depuis) n'a pas de place à moi : il garde celle que lui
  // donne le rayon, à la suite — rien à migrer, rien à réparer.
  const ordered = useMemo(() => {
    if (!shelf.order.length) return media;
    const rank = new Map(shelf.order.map((slug, i) => [slug, i]));
    // Deux titres non rangés se comparent à ÉGALITÉ, jamais par soustraction :
    // `Infinity - Infinity` vaut NaN, et un comparateur qui répond NaN range la
    // liste au hasard.
    const at = (m) => rank.get(m.slug) ?? Infinity;
    return media.slice().sort((a, b) => {
      const [ra, rb] = [at(a), at(b)];
      return ra === rb ? 0 : ra - rb;
    });
  }, [media, shelf.order]);

  // Un réglage touché part au serveur, mais pas à chaque frémissement : on
  // déplace un boîtier, puis un autre, puis on change de meuble — c'est une
  // seule séance de rangement, pas dix enregistrements. (Jamais chez les
  // autres : on ne range pas le meuble de quelqu'un d'autre.)
  useEffect(() => {
    if (!tuned.current || visiting) return undefined;
    const t = setTimeout(() => {
      apiFetch("/collection/shelf", { method: "PUT", token, body: shelf }).catch(
        () => {
          /* le rangement se perdra à la prochaine visite, rien de plus */
        }
      );
    }, 700);
    return () => clearTimeout(t);
  }, [shelf, token, visiting]);

  function tune(patch) {
    tuned.current = true;
    setShelf((s) => ({ ...s, ...patch }));
  }

  // On ne range que devant SA PROPRE étagère : passer en grille (ou réduire la
  // fenêtre, ce qui revient au même, ou aller voir celle d'un ami) referme
  // l'établi plutôt que de laisser un mode actif sans rien à quoi l'appliquer.
  useEffect(() => {
    if (effectiveView !== "shelf" || visiting) setArranging(false);
  }, [effectiveView, visiting]);

  // L'ORDRE VIENT DE CE QU'ON VOIT, ET IL DOIT REPARTIR SUR TOUT. Un filtre
  // actif, c'est une étagère dont on ne déplace qu'une partie des boîtiers : les
  // titres masqués n'ont pas bougé, ils gardent donc exactement les places
  // qu'ils occupaient, et les visibles se redistribuent dans les places qui leur
  // restaient. Sans ça, ranger trois séries pendant un filtre réécrirait tout le
  // rayon en trois boîtiers.
  const reorder = useCallback(
    (visible) => {
      tuned.current = true;
      setShelf((s) => {
        const full = ordered.map((m) => m.slug);
        const moving = new Set(visible);
        let i = 0;
        const next = full.map((slug) =>
          moving.has(slug) ? visible[i++] : slug
        );
        return { ...s, order: next };
      });
    },
    [ordered]
  );

  // Un coup de rangement d'ensemble : on écrit l'ordre COMPLET, filtre ou pas.
  // Ranger « par titre » en ne voyant que les films donnerait une étagère rangée
  // par endroits, ce qui n'est pas ranger.
  function tidy(kindOfSort) {
    const rule = TIDY.find((t) => t.value === kindOfSort);
    if (!rule) return;
    tune({ order: ordered.slice().sort(rule.cmp).map((m) => m.slug) });
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((m) => {
      if (kind && m.kind !== kind) return false;
      if (
        q &&
        ![m.title, m.originalTitle, m.franchise, ...(m.genres || [])]
          .filter(Boolean)
          .some((s) => s.toLowerCase().includes(q))
      )
        return false;
      return true;
    });
    // `ordered`, PAS `media` : c'est de lui que sort la liste. Avec `media` en
    // dépendance, ce filtre gardait son résultat tant que la collection
    // elle-même ne changeait pas — donc un rangement (glissé-déposé ou « ranger
    // d'un coup ») mettait bien l'ordre à jour dans la page, mais l'étagère,
    // elle, continuait de recevoir l'ancienne liste. D'où deux symptômes qui
    // n'en font qu'un : les boutons de rangement « ne faisaient rien », et un
    // déplacement ne tenait que dans l'aperçu de la scène — le premier rendu
    // qui le lâchait faisait réapparaître l'ordre d'origine.
  }, [ordered, kind, query]);

  // LES REPRISES, EN TROIS RAYONS SÉPARÉS. Une seule rangée mélangée mentait
  // sur ce qu'elle proposait : « Reprendre » à côté d'un manga veut dire ouvrir
  // un volume, à côté d'une cartouche rallumer une console, et les trois gestes
  // n'ont ni la même unité de progression (minutes / planches / heures de jeu)
  // ni la même promesse. Chaque support a donc sa section, sa formulation et
  // son objet — et elles suivent le filtre du rayon, pour qu'un rayon « Séries »
  // ne propose pas de reprendre une partie.
  const resuming = useMemo(() => {
    const started = shown
      .filter((m) => m.progress && !m.progress.completed)
      .sort(
        (a, b) =>
          new Date(b.progress.lastWatchedAt) - new Date(a.progress.lastWatchedAt)
      );
    return {
      // `episodeCount` est ici une CONDITION, pas une décoration. Le rayon vidéo
      // ne s'héberge pas lui-même : quand tous les hébergeurs d'un titre ont
      // fermé, le vérificateur de liens retire les sources mortes (panneau
      // d'admin) et il ne reste parfois plus rien à lire. Proposer « Reprendre »
      // sur un boîtier vide, c'est promettre une séance qui s'ouvre sur du noir.
      watch: started
        .filter((m) => (m.kind === "series" || m.kind === "film") && m.episodeCount > 0)
        .slice(0, 4),
      read: started.filter((m) => m.kind === "comic").slice(0, 4),
      play: started.filter((m) => m.kind === "game").slice(0, 4),
    };
  }, [shown]);

  const counts = useMemo(
    () => ({
      series: media.filter((m) => m.kind === "series").length,
      film: media.filter((m) => m.kind === "film").length,
      comic: media.filter((m) => m.kind === "comic").length,
      game: media.filter((m) => m.kind === "game").length,
      episodes: media.reduce((n, m) => n + (m.episodeCount || 0), 0),
      // Les planches sont comptées SUR LE PAPIER seulement. Un titre entré comme
      // manga puis rebasculé en film garde ses planches dans sa fiche : elles ne
      // s'affichent plus nulle part, mais elles gonflaient ce compteur-là — le
      // rayon annonçait des centaines de planches pour des films.
      pages: media.reduce((n, m) => n + (isComic(m) ? m.pageCount || 0 : 0), 0),
      // Sur l'étagère d'un autre : ce qu'il a et que je n'ai pas. C'est la seule
      // chose qu'on vienne vraiment y chercher.
      envy: media.filter((m) => m.mine === false).length,
    }),
    [media]
  );

  const left = Math.max(0, (tally.total || 0) - (tally.owned || 0));
  const complete = tally.total > 0 && left === 0;

  // L'ÉTABLI PREND LA PLACE DE L'EN-TÊTE. Pendant qu'on range, la carte de
  // visite du rayon (« Rayon vidéo », le titre, la phrase de présentation, les
  // compteurs) n'a plus rien à dire : on sait où l'on est, on y travaille. Elle
  // cède donc son bloc aux outils, au lieu de les faire tenir dans une bande de
  // plus qui pousserait l'étagère hors de l'écran — et l'étagère est exactement
  // ce qu'on regarde en rangeant.
  const workbench =
    arranging && !compact && effectiveView === "shelf" && shown.length > 0;

  return (
    <div className="coll-page">
      {/* ---------------- en-tête ---------------- */}
      {workbench ? (
        <header className="coll-head coll-arrange-head">
          <div className="coll-head-main">
            <span className="coll-head-icon">
              <Move size={22} strokeWidth={2.4} />
            </span>
            <div>
              <span className="coll-head-over">Mode rangement</span>
              <h1 className="coll-head-title">Range ton étagère</h1>
              <p className="coll-head-sub">
                Attrape un boîtier et pose-le où tu veux — Échap repose celui que
                tu tiens.
              </p>
            </div>
          </div>

          <div className="coll-arrange-tools">
            <div className="coll-arrange-group">
              <span className="coll-arrange-label">Ranger d'un coup</span>
              <div className="coll-arrange-btns">
                {TIDY.map((t) => (
                  <button
                    key={t.value}
                    className="coll-chip clickable"
                    onClick={() => tidy(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="coll-arrange-group">
              <span className="coll-arrange-label">Meuble</span>
              <div className="coll-arrange-btns">
                {SHELF_SKINS.map((s) => (
                  <button
                    key={s.value}
                    className={`coll-chip clickable ${
                      shelf.skin === s.value ? "active" : ""
                    }`}
                    onClick={() => tune({ skin: s.value })}
                  >
                    <i className={`coll-skin-dot is-${s.value || "auto"}`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="coll-arrange-group">
              {/* Plus « combien par planche » : une rangée remplit la largeur
                  de la page, ce compte-là ne dépend donc plus d'un réglage
                  (voir shelfFit). Ce qui se règle, c'est la TAILLE. */}
              <span className="coll-arrange-label">Taille</span>
              <div className="coll-arrange-btns">
                {SHELF_DENSITIES.map((d) => (
                  <button
                    key={d.value}
                    className={`coll-chip clickable ${
                      (shelf.perPlank || 20) === d.value ? "active" : ""
                    }`}
                    onClick={() => tune({ perPlank: d.value })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {shelf.order.length > 0 && (
              <button
                className="btn btn-ghost clickable coll-arrange-reset"
                onClick={() => tune({ order: [] })}
                title="Revenir à l'ordre du rayon"
              >
                <Undo2 size={14} /> Ordre d'origine
              </button>
            )}
          </div>
        </header>
      ) : (
      <header className="coll-head">
        <div className="coll-head-main">
          <span className="coll-head-icon">
            {visiting && owner?.avatar ? (
              <img src={owner.avatar} alt="" className="coll-head-av" />
            ) : (
              <Library size={22} strokeWidth={2.4} />
            )}
          </span>
          <div>
            <span className="coll-head-over">
              {visiting ? `Collection de ${owner?.username || username}` : "Ma collection"}
            </span>
            <h1 className="coll-head-title">
              {visiting ? owner?.username || username : "Collection"}
            </h1>
            <p className="coll-head-sub">
              {visiting
                ? "Les boîtiers qu'il ou elle a sortis de la machine — séries, films, comics et cartouches."
                : "Les boîtiers que tu as sortis de la machine à capsules, rangés comme au vidéoclub et jouables sur place."}
            </p>
          </div>
        </div>

        {/* Les compteurs ne se remplissent qu'une fois le rayon connu : d'ici
            là, trois pastilles vides plutôt que trois zéros — un « 0 film »
            fugace se lit comme une collection vide. */}
        <div className="coll-head-stats">
          {status === "loading" ? (
            <>
              <span className="coll-skel-pill" />
              <span className="coll-skel-pill" />
              <span className="coll-skel-pill wide" />
            </>
          ) : (
            <>
              {counts.series > 0 && (
                <span>
                  <strong>{counts.series}</strong> série{counts.series > 1 ? "s" : ""}
                </span>
              )}
              {counts.film > 0 && (
                <span>
                  <strong>{counts.film}</strong> film{counts.film > 1 ? "s" : ""}
                </span>
              )}
              {counts.comic > 0 && (
                <span>
                  <strong>{counts.comic}</strong> comic{counts.comic > 1 ? "s" : ""}
                </span>
              )}
              {counts.game > 0 && (
                <span>
                  <strong>{counts.game}</strong> jeu{counts.game > 1 ? "x" : ""} GBA
                </span>
              )}
              {/* CE QU'IL A ET QUE JE N'AI PAS. Sur l'étagère de quelqu'un
                  d'autre, c'est LE chiffre — celui pour lequel on est venu. */}
              {visiting && counts.envy > 0 && (
                <span className="coll-head-envy">
                  <Lock size={12} /> <strong>{counts.envy}</strong> qui te manque
                  {counts.envy > 1 ? "nt" : ""}
                </span>
              )}
            </>
          )}
        </div>
      </header>
      )}

      {/* ---------------- la jauge de complétion ----------------
          UNE COLLECTION SE MESURE. Sans ce bandeau, une étagère de douze
          boîtiers est juste une étagère de douze boîtiers ; avec, c'est
          « 12 sur 40 », et les vingt-huit qui manquent existent. C'est aussi
          le seul chemin vers la machine depuis cette page — et il doit être
          là, parce que c'est ici qu'on se rend compte qu'il manque quelque
          chose. */}
      {status === "ready" && tally.total > 0 && !workbench && (
        <section className={`coll-quest ${complete ? "done" : ""}`}>
          <div className="coll-quest-text">
            <strong>
              {complete ? (
                <>
                  <PartyPopper size={15} /> Collection complète
                </>
              ) : (
                <>
                  {tally.owned} boîtier{tally.owned > 1 ? "s" : ""} sur {tally.total}
                </>
              )}
            </strong>
            <span>
              {complete
                ? visiting
                  ? "Tous les boîtiers du rayon sont sur cette étagère."
                  : "Tu as sorti tous les boîtiers du rayon. Rien ne manque."
                : visiting
                  ? `Il lui reste ${left} boîtier${left > 1 ? "s" : ""} à débloquer.`
                  : `Encore ${left} boîtier${left > 1 ? "s" : ""} dans la machine.`}
            </span>
          </div>
          <span className="coll-quest-gauge" aria-hidden="true">
            <i
              style={{
                width: tally.total ? `${(tally.owned / tally.total) * 100}%` : 0,
              }}
            />
          </span>
          {visiting ? (
            <Link to="/collection" className="coll-quest-btn clickable">
              <Library size={15} /> Mon étagère
            </Link>
          ) : (
            !complete && (
              <button className="coll-quest-btn clickable" onClick={() => setShowGacha(true)}>
                <Sparkles size={15} /> Tourner la sphère
                {tally.price > 0 && <em>{tally.price} pts</em>}
              </button>
            )
          )}
        </section>
      )}

      {/* ---------------- filtres + bascule de vue ---------------- */}
      <div className="coll-toolbar">
        {/* LES RAYONS NE SE FILTRENT PAS PENDANT QU'ON RANGE. Ranger, c'est
            décider de l'ordre du meuble ENTIER : une rangée réduite à un genre
            ne montre plus le voisinage qu'on est en train de composer, et
            « Ranger d'un coup » écrit de toute façon l'ordre complet. Le bloc
            reste, vide, pour que la barre garde sa géométrie et que la recherche
            ne saute pas à gauche. */}
        <div className="coll-chips">
          {!workbench &&
            KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                className={`coll-chip clickable ${kind === f.value ? "active" : ""}`}
                onClick={() => setParam("kind", f.value)}
              >
                {f.label}
              </button>
            ))}
          {/* Plus de filtre par support : tout est en boîtier DVD. */}
        </div>

        <div className="coll-toolbar-right">
          <label className="coll-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setParam("q", e.target.value)}
              placeholder="Chercher un titre, une saga…"
              aria-label="Chercher dans la collection"
            />
            {query && (
              <button
                className="clickable"
                onClick={() => setParam("q", "")}
                aria-label="Effacer"
              >
                <X size={14} />
              </button>
            )}
          </label>

          {!compact && (
            <div className="coll-views" role="group" aria-label="Affichage">
              <button
                className={`clickable ${view === "shelf" ? "active" : ""}`}
                onClick={() => pickView("shelf")}
                title="Étagère 3D"
              >
                <Rows3 size={15} /> Étagère
              </button>
              <button
                className={`clickable ${view === "grid" ? "active" : ""}`}
                onClick={() => pickView("grid")}
                title="Grille de boîtiers"
              >
                <LayoutGrid size={15} /> Grille
              </button>
            </div>
          )}

          {/* RANGER N'EST PAS UN MODE D'AFFICHAGE, c'est un geste qu'on fait sur
              celui-ci : le bouton est donc à côté de la bascule, pas dedans. Il
              n'existe que devant SA PROPRE étagère — une grille CSS ne se range
              pas à la main, sur téléphone on ne déplace pas un boîtier de 8 mm,
              et on ne range pas le meuble de quelqu'un d'autre. */}
          {!compact && !visiting && effectiveView === "shelf" && shown.length > 0 && (
            <button
              className={`btn btn-ghost clickable coll-arrange-toggle ${
                arranging ? "active" : ""
              }`}
              onClick={() => {
                // Entrer en rangement REND LE MEUBLE ENTIER : puisque les
                // filtres de rayon disparaissent de la barre, un filtre resté
                // actif serait un rayon amputé sans rien pour le dire.
                if (!arranging && kind) setParam("kind", "");
                setArranging((a) => !a);
              }}
              title="Déplacer les boîtiers sur l'étagère"
            >
              {arranging ? <Check size={15} /> : <Move size={15} />}
              {arranging ? "Terminer" : "Ranger"}
            </button>
          )}

          {/* L'ÉTABLI DE MISE AU POINT. Devant sa propre étagère et pour un
              admin seulement : c'est ici qu'on pose l'état de collection qu'on
              veut essayer, plutôt que de tourner quarante fois la manivelle. */}
          {!visiting && user?.isAdmin && (
            <button
              className={`btn btn-ghost clickable coll-debug-toggle ${
                debug ? "active" : ""
              }`}
              onClick={() => setDebug((d) => !d)}
              title="Outils de mise au point"
            >
              <Bug size={15} /> Debug
            </button>
          )}
        </div>
      </div>

      {debug && !visiting && user?.isAdmin && (
        <CollectionDebug
          owned={tally.owned}
          total={tally.total}
          onReload={() => setAttempt((n) => n + 1)}
          onResetShelf={() => tune({ order: [], skin: "", perPlank: 0 })}
        />
      )}

      {/* ---------------- le rayon ----------------
          L'attente a la forme de ce qu'on attend : la rangée de tranches si
          l'on va vers l'étagère, la grille de boîtiers sinon. */}
      {status === "loading" &&
        (effectiveView === "shelf" ? <ShelfSkeleton /> : <GridSkeleton />)}

      {status === "error" && (
        <div className="coll-state">
          <span className="coll-state-icon">
            <Unplug size={22} />
          </span>
          <strong>
            {username
              ? "Cette collection n'a pas voulu s'ouvrir."
              : "La collection n'a pas voulu se charger."}
          </strong>
          <p>
            {username
              ? "Le compte est peut-être privé, ou le pseudo n'existe plus."
              : "Le rayon est bien là — c'est la liaison qui a lâché."}
          </p>
          <button
            className="btn btn-ghost clickable"
            onClick={() => setAttempt((n) => n + 1)}
          >
            <RotateCw size={15} /> Réessayer
          </button>
        </div>
      )}

      {/* L'ÉTAGÈRE VIDE N'EST PAS UNE ERREUR, C'EST UN DÉPART. Elle ne dit pas
          « rien ici » mais « voilà ce qu'il y a à prendre », et elle porte la
          machine : c'est le seul écran où l'appel à jouer a vraiment sa
          place. Chez quelqu'un d'autre, en revanche, il n'y a rien à proposer —
          c'est son étagère, pas la nôtre. */}
      {status === "ready" && shown.length === 0 && (
        <div className="coll-state">
          <span className="coll-state-icon">
            <Sparkles size={22} />
          </span>
          <strong>
            {media.length === 0
              ? visiting
                ? "Cette étagère est encore vide"
                : "Ton étagère est encore vide"
              : "Rien sous ce filtre"}
          </strong>
          <p>
            {media.length === 0
              ? visiting
                ? `${owner?.username || username} n'a pas encore sorti de boîtier de la machine.`
                : tally.total > 0
                  ? `${tally.total} boîtiers attendent dans la machine à capsules. Fais-la tourner pour en sortir un premier.`
                  : "Aucun boîtier n'a encore été posé au rayon."
              : "Aucun titre ne correspond à cette recherche."}
          </p>
          {media.length === 0 && !visiting && tally.total > 0 && (
            <button className="btn btn-primary clickable" onClick={() => setShowGacha(true)}>
              <Sparkles size={15} /> Tourner la sphère
              {tally.price > 0 && ` — ${tally.price} points`}
            </button>
          )}
          {media.length > 0 && (kind || query) && (
            <button
              className="btn btn-ghost clickable"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              <X size={15} /> Tout afficher
            </button>
          )}
        </div>
      )}

      {status === "ready" && shown.length > 0 && effectiveView === "shelf" && (
        <Suspense fallback={<ShelfSkeleton label="Chargement de l'étagère…" />}>
          <CollectionShelf
            media={shown}
            // TOUT le rayon, en plus de ce qu'on en montre : une fois l'étagère
            // habillée, la scène va peindre au ralenti les titres que le filtre
            // écarte, pour que les retirer n'attende plus rien. Elle seule peut
            // s'en charger — la peinture vit dans le paquet de three.js, et la
            // page n'a pas à le faire descendre pour une grille CSS.
            all={ordered}
            theme={theme}
            skin={shelf.skin}
            perPlank={shelf.perPlank || undefined}
            arranging={arranging}
            onReorder={reorder}
            onSelect={(m) => navigate(`/collection/${m.slug}`)}
          />
        </Suspense>
      )}

      {status === "ready" && shown.length > 0 && effectiveView === "grid" && (
        <div className="coll-grid">
          {shown.map((m) => (
            <CollectionCase key={m.slug} media={m} />
          ))}
        </div>
      )}

      {/* ---------------- reprendre ----------------
          Placées APRÈS la collection : on vient d'abord sur cette page pour
          voir l'étagère. La reprise est un raccourci, pas l'entrée principale.
          Et une section par support, de haut en bas : ce qui se regarde, ce qui
          se lit, ce qui se joue.

          Jamais chez quelqu'un d'autre : là où il en est de sa lecture ne nous
          regarde pas, et « Reprendre » n'aurait de toute façon rien à
          reprendre. */}

      {/* 1. L'ÉCRAN. Une vignette large, comme l'arrêt sur image d'une cassette
             qu'on remet en marche : c'est le seul des trois qui reprend à la
             SECONDE près, donc le seul qui porte une jauge de temps. */}
      {!visiting && resuming.watch.length > 0 && (
        <section className="coll-resume">
          <h2 className="coll-section-title">
            <Play size={15} /> Reprendre <em>Séries &amp; films</em>
          </h2>
          <div className="coll-resume-row">
            {resuming.watch.map((m) => {
              const pct =
                m.progress.durationSeconds > 0
                  ? Math.min(
                      100,
                      (m.progress.positionSeconds / m.progress.durationSeconds) * 100
                    )
                  : 0;
              return (
                <Link
                  key={m.slug}
                  to={`/collection/${m.slug}?ep=${m.progress.episodeIndex}&play=1`}
                  className="coll-resume-card clickable"
                  style={{ "--tint": m.color }}
                >
                  {m.backdrop && <img src={m.backdrop} alt="" loading="lazy" />}
                  <span className="coll-resume-grad" />
                  <span className="coll-resume-play">
                    <Play size={16} fill="currentColor" />
                  </span>
                  <span className="coll-resume-info">
                    <strong>{m.title}</strong>
                    <em>{resumeLabel(m) || "Reprendre"}</em>
                  </span>
                  <span className="coll-resume-bar">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. LE PAPIER. Rien à voir avec une vignette d'écran : une fiche de
             papier crème, la couverture debout à gauche, un ruban de
             marque-page qui pend du haut. La progression se compte en PLANCHES,
             jamais en minutes. */}
      {!visiting && resuming.read.length > 0 && (
        <section className="coll-resume coll-read">
          <h2 className="coll-section-title">
            <BookOpen size={15} /> Marque-pages <em>Comics &amp; mangas</em>
          </h2>
          <div className="coll-read-row">
            {resuming.read.map((m) => {
              const page = (m.progress.page || 0) + 1;
              const pct = m.pageCount
                ? Math.min(100, (page / m.pageCount) * 100)
                : 0;
              return (
                <Link
                  key={m.slug}
                  // `play=1` rouvre le volume à la planche enregistrée (voir la
                  // reprise automatique dans CollectionDetail).
                  to={`/collection/${m.slug}?play=1`}
                  className="coll-read-card clickable"
                  style={{ "--tint": m.color }}
                >
                  <span className="coll-read-cover">
                    {m.poster ? (
                      <img src={m.poster} alt="" loading="lazy" />
                    ) : (
                      <BookOpen size={18} />
                    )}
                  </span>
                  <span className="coll-read-body">
                    {m.franchise && (
                      <span className="coll-read-saga">{m.franchise}</span>
                    )}
                    <strong>{m.title}</strong>
                    <span className="coll-read-gauge" aria-hidden="true">
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <em>
                      Planche {page}
                      {m.pageCount ? ` sur ${m.pageCount}` : ""}
                    </em>
                  </span>
                  {/* Le ruban : la seule chose qui dépasse d'un livre fermé. */}
                  <span className="coll-read-mark" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. LA CARTOUCHE. Ni vignette ni fiche : la carte de jeu elle-même,
             coin biseauté et contacts dorés. On la RALLUME, et ce qu'on affiche
             dessous est le temps déjà passé dessus — c'est lui qui SITUE la
             cartouche dans la rangée, là où une barre de progression ne voudrait
             rien dire. La partie, elle, est reprise par la console au démarrage
             (voir GbaPlayer). */}
      {!visiting && resuming.play.length > 0 && (
        <section className="coll-resume coll-play">
          <h2 className="coll-section-title">
            <Gamepad2 size={15} /> Console encore chaude <em>Jeux GBA</em>
          </h2>
          <div className="coll-play-row">
            {resuming.play.map((m) => (
              <Link
                key={m.slug}
                to={`/collection/${m.slug}?play=1`}
                className="coll-play-card clickable"
                style={{ "--tint": m.color }}
              >
                <span className="coll-play-cart" aria-hidden="true">
                  <span className="coll-play-label">
                    {m.poster ? (
                      <img src={m.poster} alt="" loading="lazy" />
                    ) : (
                      <Gamepad2 size={16} />
                    )}
                  </span>
                  <span className="coll-play-teeth" />
                </span>
                <span className="coll-play-body">
                  <strong>{m.title}</strong>
                  <em>
                    <Clock3 size={11} />
                    {m.progress.playSeconds > 60
                      ? `${fmtDuration(m.progress.playSeconds)} de jeu`
                      : "Partie entamée"}
                  </em>
                  <span className="coll-play-cta">
                    <Power size={12} /> Rallumer
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {visiting && (
        <p className="coll-note">
          <ArrowLeft size={13} />
          <Link to="/collection">Revenir à ton étagère</Link> — les boîtiers se
          débloquent un par un à la machine à capsules de l'arcade.
        </p>
      )}

      {status === "ready" && !visiting && media.length > 0 && (
        <p className="coll-note">
          <Info size={13} />
          Chaque titre est lu depuis sa source d'origine (chaîne officielle,
          diffusion promotionnelle, œuvre du domaine public) — rien n'est
          rehébergé ici. {KINDS.series.plural} et {KINDS.film.plural.toLowerCase()}{" "}
          s'ouvrent dans le poste cathodique ; les {KINDS.game.plural.toLowerCase()}{" "}
          se lancent dans une console émulée, directement dans le navigateur.
        </p>
      )}

      {/* La machine, depuis l'étagère : c'est ici qu'on se rend compte qu'il
          manque quelque chose, donc ici qu'il faut pouvoir tourner. Le boîtier
          gagné rejoint la page sans rechargement. */}
      {showGacha && (
        <GachaModal
          token={token}
          onClose={() => setShowGacha(false)}
          onDrawn={(res) => {
            if (res.media) setMedia((list) => [...list, res.media]);
            setTally((t) => ({ ...t, owned: res.owned, total: res.total }));
            updateUser({ points: res.points });
          }}
        />
      )}
    </div>
  );
}

// ======================================================================
//  L'établi de mise au point — poser un état de collection (admin)
// ======================================================================
// UNE ÉTAGÈRE NE SE MET PAS AU POINT EN Y JOUANT. Tout ce que cette page
// raconte — la jauge qui progresse, les rangées de reprise, un meuble plein
// qu'on range à la main, une machine qui n'a plus rien à sortir — demande un
// ÉTAT PRÉCIS de la collection ; et l'obtenir pour de vrai, c'est quarante tours
// de manivelle à cinq cents points pièce, puis plus aucun moyen de revenir en
// arrière. Ces boutons posent l'état directement, dans les deux sens.
//
// LE SERVEUR NE CONNAÎT QUE LE DEMANDEUR. Aucune de ces routes ne prend
// d'utilisateur en paramètre : on ne garnit et on ne vide que SA PROPRE
// étagère, jamais celle de quelqu'un d'autre (voir routes/collection.js). Un
// outil de débogage qui peut déposséder un joueur est une trappe — et celui-ci
// finira par rester en place.
const DEBUG_POINTS = 10_000;
const DEBUG_SAMPLE = 10;

function CollectionDebug({ owned, total, onReload, onResetShelf }) {
  const { token, user, updateUser } = useAuth();
  // Le bouton qui travaille, pour n'en désactiver qu'un seul — et le compte
  // rendu de la dernière action, parce qu'un outil qui agit sans rien dire
  // laisse toujours douter qu'il ait agi.
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const left = Math.max(0, (total || 0) - (owned || 0));

  // Un seul chemin pour toutes les actions : ce qui les distingue tient dans
  // l'appel, le reste (le bouton qui tourne, le mot de fin, le rayon qu'on
  // relit) est rigoureusement identique.
  async function run(id, call, say) {
    if (busy) return;
    setBusy(id);
    setNote("");
    try {
      const d = await call();
      setNote(say(d));
      onReload();
    } catch (e) {
      setNote(e.message || "Raté.");
    } finally {
      setBusy("");
    }
  }

  const fill = (count) =>
    run(
      count ? "sample" : "all",
      () =>
        apiFetch("/collection/gacha/mine/fill", {
          method: "POST",
          token,
          body: count ? { count } : {},
        }),
      (d) =>
        d.added
          ? `${d.added} boîtier${d.added > 1 ? "s" : ""} posé${d.added > 1 ? "s" : ""} — ${d.owned}/${d.total}.`
          : "Rien à poser : tout est déjà là."
    );

  function wipe() {
    if (
      !confirm(
        `Vider ton étagère ?\n\n${owned} boîtier${owned > 1 ? "s" : ""} retourneront dans la machine.\n` +
          "Tes points ne sont PAS rendus, et ta progression sur les titres est conservée."
      )
    )
      return;
    run(
      "wipe",
      () => apiFetch("/collection/gacha/mine", { method: "DELETE", token }),
      (d) => `Étagère vidée (${d.removed || 0}).`
    );
  }

  const credit = () =>
    run(
      "points",
      async () => {
        const d = await apiFetch("/collection/gacha/mine/points", {
          method: "POST",
          token,
          body: { amount: DEBUG_POINTS },
        });
        // Le solde affiché partout ailleurs (barre du haut, prix du tirage)
        // vient du contexte : sans ce report, la machine continuerait d'annoncer
        // qu'il manque des points qui sont déjà là.
        updateUser({ points: d.points });
        return d;
      },
      (d) => `Solde : ${Number(d.points || 0).toLocaleString("fr-FR")} points.`
    );

  // Une fonction, pas un composant : déclaré dans le corps de celui-ci, il
  // changerait d'identité à chaque rendu et se remonterait pour rien.
  const spin = (id) => (busy === id ? <Loader2 size={14} className="spin" /> : null);

  return (
    <section className="coll-debug">
      <header>
        <span className="coll-debug-ic">
          <Bug size={15} />
        </span>
        <div>
          <strong>Mise au point</strong>
          <span>
            Ces boutons n'agissent que sur TON étagère. {owned}/{total} boîtiers
            {left > 0 ? `, ${left} encore dans la machine` : ", collection complète"} ·{" "}
            {Number(user?.points || 0).toLocaleString("fr-FR")} points.
          </span>
        </div>
      </header>

      <div className="coll-debug-btns">
        <button
          className="coll-chip clickable"
          onClick={() => fill(0)}
          disabled={!!busy || left === 0}
          title="Débloquer tout le catalogue d'un coup"
        >
          {spin("all")}
          <PackagePlus size={14} /> Tout débloquer
        </button>

        <button
          className="coll-chip clickable"
          onClick={() => fill(DEBUG_SAMPLE)}
          disabled={!!busy || left === 0}
          title="L'état le plus utile : une collection à moitié pleine"
        >
          {spin("sample")}
          <Dices size={14} /> {DEBUG_SAMPLE} au hasard
        </button>

        <button
          className="coll-chip clickable danger"
          onClick={wipe}
          disabled={!!busy || owned === 0}
          title="Tout renvoyer dans la machine"
        >
          {spin("wipe")}
          <Trash2 size={14} /> Vider l'étagère
        </button>

        <button
          className="coll-chip clickable"
          onClick={() => {
            onResetShelf();
            setNote("Rangement oublié : le rayon reprend son ordre d'origine.");
          }}
          disabled={!!busy}
          title="Oublier l'ordre personnel, l'essence et la densité"
        >
          <Undo2 size={14} /> Rangement à zéro
        </button>

        <button
          className="coll-chip clickable"
          onClick={credit}
          disabled={!!busy}
          title="De quoi faire tourner la machine"
        >
          {spin("points")}
          <Coins size={14} /> +{DEBUG_POINTS.toLocaleString("fr-FR")} points
        </button>
      </div>

      {note && <p className="coll-debug-note">{note}</p>}
    </section>
  );
}
