import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Plus,
  Pin,
  Sparkles,
  ListMusic,
  Music,
  Film,
  ListChecks,
  Joystick,
  Users,
  Disc3,
  Play,
  Pause,
  Search,
  Building2,
  Loader2,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { extractVideoId } from "../lib/youtube";
import { apiFetch } from "../lib/api";

// Spécification de configuration par type de carte de la colonne latérale.
// `select` : single (radio), multi (liste), multi3 (max 3). Les cartes non
// listées ici ne sont pas configurables (review, avis de recherche, stats…).
const SPEC = {
  playlist: {
    Icon: ListMusic,
    title: "Playlist",
    auto: "Toujours la plus récente",
    pin: "Choisir une playlist",
    select: "single",
  },
  ost: {
    Icon: Music,
    title: "OST likée",
    auto: "Ta dernière OST likée",
    pin: "Épingler une OST",
    select: "single",
  },
  video: {
    Icon: Film,
    title: "Vidéo reco",
    auto: "Ta dernière reco vidéo",
    pin: "Épingler une vidéo",
    select: "single",
  },
  lists: {
    Icon: ListChecks,
    title: "Listes",
    auto: "Les 3 plus récentes",
    pin: "Choisir jusqu'à 3 listes",
    select: "multi3",
  },
  console: {
    Icon: Joystick,
    title: "Console favorite",
    auto: "La plus jouée",
    pin: "Choisir une console",
    select: "single",
  },
  characters: {
    Icon: Users,
    title: "Personnages favoris",
    auto: "Les plus récents",
    pin: "Choisir mes persos",
    select: "multi",
  },
  studios: {
    Icon: Building2,
    title: "Studios favoris",
    auto: "Tes studios favoris",
    pin: "Choisir jusqu'à 3 studios",
    select: "search3", // recherche live dans tout le catalogue IGDB
  },
};

export function isConfigurable(widget) {
  return !!SPEC[widget];
}

// Normalisation pour la recherche : minuscules + sans accents (marques
// combinantes U+0300–U+036F retirées après décomposition NFD).
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Construit la liste d'options sélectionnables selon le type de carte.
function buildOptions(widget, data) {
  switch (widget) {
    case "playlist":
      return (data.playlists || []).map((pl) => ({
        value: pl.id,
        label: pl.title,
        thumb: pl.cover || pl.preview?.[0] || null,
        meta: "Playlist",
        FB: ListMusic,
      }));
    case "ost":
      return (data.ostGames || []).map((e) => {
        const track = { ...e.favoriteOst, gameId: e.gameId, gameName: e.name };
        return {
          value: e.gameId,
          label: e.favoriteOst?.name,
          thumb: e.favoriteOst?.artwork || null,
          meta: [e.name, e.favoriteOst?.artist].filter(Boolean).join(" · "),
          FB: Disc3,
          track,
          playable: !!(extractVideoId(e.favoriteOst?.url || "") || e.favoriteOst?.videoId),
        };
      });
    case "video":
      return (data.videos || []).map((v) => ({
        value: v.videoId,
        label: v.title,
        thumb: v.thumb || null,
        meta: v.author || null,
        FB: Film,
      }));
    case "lists":
      return (data.listCandidates || []).map((l) => ({
        value: l.id,
        label: l.title,
        thumb: l.cover || l.preview?.[0] || null,
        meta: l.typeLabel || "Liste",
        FB: ListChecks,
      }));
    case "console":
      return (data.platforms || []).map((p) => ({
        value: p.platform,
        label: p.platform,
        thumb: data.platformLogos?.[p.platform] || null,
        thumbContain: true,
        meta: `${p.count} jeu${p.count > 1 ? "x" : ""}`,
        FB: Joystick,
      }));
    case "characters":
      return (data.characters || []).map((c) => ({
        value: `${c.gameId}::${c.name}`,
        label: c.name,
        thumb: c.image || null,
        meta: c.game || null,
        FB: Users,
      }));
    default:
      return [];
  }
}

// Valeur(s) sélectionnée(s) initiale(s) d'après la config enregistrée.
function initialSelection(widget, config) {
  const c = config || {};
  switch (widget) {
    case "playlist":
      return c.id ?? null;
    case "ost":
      return c.gameId ?? null;
    case "video":
      return c.videoId ?? null;
    case "console":
      return c.platform ?? null;
    case "lists":
      return Array.isArray(c.ids) ? c.ids : [];
    case "characters":
      return Array.isArray(c.keys) ? c.keys : [];
    case "studios":
      return Array.isArray(c.companies) ? c.companies : [];
    default:
      return null;
  }
}

// Reconstruit l'objet config à partir du mode + sélection courante.
function buildConfig(widget, mode, sel) {
  if (mode !== "pin") return { mode: "auto" };
  switch (widget) {
    case "playlist":
      return sel != null ? { mode: "pin", id: sel } : { mode: "auto" };
    case "ost":
      return sel != null ? { mode: "pin", gameId: sel } : { mode: "auto" };
    case "video":
      return sel != null ? { mode: "pin", videoId: sel } : { mode: "auto" };
    case "console":
      return sel != null ? { mode: "pin", platform: sel } : { mode: "auto" };
    case "lists":
      return sel?.length ? { mode: "pin", ids: sel } : { mode: "auto" };
    case "characters":
      return sel?.length ? { mode: "pin", keys: sel } : { mode: "auto" };
    case "studios":
      return sel?.length ? { mode: "pin", companies: sel } : { mode: "auto" };
    default:
      return { mode: "auto" };
  }
}

// Modale de configuration d'une carte de l'aperçu (clic droit en édition).
// « Automatique » (comportement par défaut) vs « Épinglé » (sélection manuelle).
export default function ProfileAsideCardModal({ widget, config, data, token, onSave, onClose }) {
  const spec = SPEC[widget];
  const options = useMemo(() => buildOptions(widget, data), [widget, data]);
  const [mode, setMode] = useState(config?.mode === "pin" ? "pin" : "auto");
  const [sel, setSel] = useState(() => initialSelection(widget, config));
  const [query, setQuery] = useState("");
  const player = usePlayer();
  // Recherche live de studios (carte « Studios favoris » uniquement).
  const [studioResults, setStudioResults] = useState([]);
  const [studioSearching, setStudioSearching] = useState(false);
  const isStudios = spec?.select === "search3";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recherche de studios débouncée (IGDB) quand la modale « studios » est en pin.
  useEffect(() => {
    if (!isStudios || mode !== "pin") return;
    const q = query.trim();
    if (q.length < 2) {
      setStudioResults([]);
      setStudioSearching(false);
      return;
    }
    let alive = true;
    setStudioSearching(true);
    const t = setTimeout(() => {
      apiFetch(`/companies/search?q=${encodeURIComponent(q)}`, { token })
        .then((d) => alive && setStudioResults(d.companies || []))
        .catch(() => alive && setStudioResults([]))
        .finally(() => alive && setStudioSearching(false));
    }, 280);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, isStudios, mode, token]);

  if (!spec) return null;
  const multi = spec.select === "multi" || spec.select === "multi3";
  const max = spec.select === "multi3" ? 3 : Infinity;
  const showSearch = options.length > 3;
  const filtered =
    showSearch && query.trim()
      ? options.filter(
          (o) => norm(o.label).includes(norm(query)) || norm(o.meta).includes(norm(query))
        )
      : options;
  const playPreview = (o) => {
    if (o.track) player.toggleTrack(o.track, [o.track], {});
  };

  // --- Studios : sélection par objets { name, logo, country } (max 3). ---
  const studioHas = (name) => sel.some((s) => norm(s.name) === norm(name));
  function toggleStudio(c) {
    setSel((prev) => {
      if (prev.some((s) => norm(s.name) === norm(c.name)))
        return prev.filter((s) => norm(s.name) !== norm(c.name));
      if (prev.length >= 3) return prev;
      return [...prev, { name: c.name, logo: c.logo || null, country: c.country || null }];
    });
  }
  // Résultats affichés : la recherche si ≥2 lettres, sinon les favoris existants.
  const studioList =
    query.trim().length >= 2 ? studioResults : data.favorites || [];

  const isSel = (v) => (multi ? sel.includes(v) : sel === v);
  function toggle(v) {
    if (!multi) {
      setSel(v);
      return;
    }
    setSel((prev) => {
      if (prev.includes(v)) return prev.filter((x) => x !== v);
      if (prev.length >= max) return prev;
      return [...prev, v];
    });
  }

  function save() {
    onSave(buildConfig(widget, mode, sel));
    onClose();
  }

  const Icon = spec.Icon;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal pac-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <h2 className="modal-title">
          <Icon size={20} /> Configurer · {spec.title}
        </h2>
        <p className="pac-sub">Choisis comment cette carte se remplit sur ton profil.</p>

        <div className="pac-modes">
          <button
            type="button"
            className={`pac-mode clickable ${mode === "auto" ? "on" : ""}`}
            onClick={() => setMode("auto")}
          >
            <span className="pac-mode-ic">
              <Sparkles size={17} />
            </span>
            <span className="pac-mode-txt">
              <b>Automatique</b>
              <i>{spec.auto}</i>
            </span>
            {mode === "auto" && <Check size={16} className="pac-mode-check" />}
          </button>
          <button
            type="button"
            className={`pac-mode clickable ${mode === "pin" ? "on" : ""}`}
            onClick={() => setMode("pin")}
          >
            <span className="pac-mode-ic">
              <Pin size={17} />
            </span>
            <span className="pac-mode-txt">
              <b>{spec.pin}</b>
              <i>{multi ? "Tu choisis les éléments à afficher." : "Tu choisis l'élément à afficher."}</i>
            </span>
            {mode === "pin" && <Check size={16} className="pac-mode-check" />}
          </button>
        </div>

        {mode === "pin" && isStudios && (
          <div className="pac-picker">
            <p className="pac-count">{sel.length}/3 sélectionné{sel.length > 1 ? "s" : ""}</p>
            {sel.length > 0 && (
              <div className="pac-studio-chips">
                {sel.map((s) => (
                  <button
                    type="button"
                    key={s.name}
                    className="pac-studio-chip clickable"
                    onClick={() => toggleStudio(s)}
                    title="Retirer"
                  >
                    <span className="pac-studio-chip-logo">
                      {s.logo ? <img src={s.logo} alt="" /> : <Building2 size={12} />}
                    </span>
                    {s.name}
                    <X size={12} />
                  </button>
                ))}
              </div>
            )}
            <div className="pac-search">
              <Search size={15} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un studio ou éditeur…"
                autoFocus
              />
              {studioSearching ? (
                <Loader2 size={15} className="spin" />
              ) : query ? (
                <button
                  type="button"
                  className="pac-search-clear clickable"
                  onClick={() => setQuery("")}
                  aria-label="Effacer"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {query.trim().length < 2 && (
              <p className="pac-hint-lite">
                {studioList.length ? "Tes studios favoris — ou tape pour chercher." : "Tape le nom d'un studio pour le chercher."}
              </p>
            )}
            {studioList.length ? (
              <div className="pac-opts">
                {studioList.map((o) => {
                  const on = studioHas(o.name);
                  const full = !on && sel.length >= 3;
                  return (
                    <div
                      key={o.name}
                      role="button"
                      tabIndex={0}
                      className={`pac-opt clickable ${on ? "on" : ""} ${full ? "disabled" : ""}`}
                      onClick={() => !full && toggleStudio(o)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && !full) {
                          e.preventDefault();
                          toggleStudio(o);
                        }
                      }}
                    >
                      <span className="pac-opt-thumb contain">
                        {o.logo ? <img src={o.logo} alt="" loading="lazy" /> : <Building2 size={18} />}
                      </span>
                      <span className="pac-opt-body">
                        <span className="pac-opt-title">{o.name}</span>
                        {o.country && <span className="pac-opt-meta">{o.country}</span>}
                      </span>
                      <span className="pac-opt-check">{on ? <Check size={16} /> : <Plus size={15} />}</span>
                    </div>
                  );
                })}
              </div>
            ) : query.trim().length >= 2 && !studioSearching ? (
              <p className="pac-empty font-fun">Aucun studio trouvé pour « {query} ».</p>
            ) : null}
          </div>
        )}

        {mode === "pin" && !isStudios && (
          <div className="pac-picker">
            {spec.select === "multi3" && (
              <p className="pac-count">{sel.length}/3 sélectionnée{sel.length > 1 ? "s" : ""}</p>
            )}
            {showSearch && (
              <div className="pac-search">
                <Search size={15} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher…"
                  autoFocus
                />
                {query && (
                  <button
                    type="button"
                    className="pac-search-clear clickable"
                    onClick={() => setQuery("")}
                    aria-label="Effacer"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {!options.length ? (
              <p className="pac-empty font-fun">
                Rien à épingler ici pour l'instant — remplis ton profil et reviens !
              </p>
            ) : !filtered.length ? (
              <p className="pac-empty font-fun">Aucun résultat pour « {query} ».</p>
            ) : (
              <div className="pac-opts">
                {filtered.map((o) => {
                  const playing = o.playable && player.isPlaying(o.track);
                  return (
                    <div
                      key={String(o.value)}
                      role="button"
                      tabIndex={0}
                      className={`pac-opt clickable ${isSel(o.value) ? "on" : ""}`}
                      onClick={() => toggle(o.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(o.value);
                        }
                      }}
                    >
                      {o.playable ? (
                        <button
                          type="button"
                          className={`pac-opt-thumb play ${playing ? "playing" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            playPreview(o);
                          }}
                          title={playing ? "Pause" : "Écouter un extrait"}
                        >
                          {o.thumb ? <img src={o.thumb} alt="" loading="lazy" /> : <o.FB size={18} />}
                          <span className="pac-opt-play-ic">
                            {playing ? (
                              <Pause size={15} />
                            ) : (
                              <Play size={15} fill="currentColor" strokeWidth={0} />
                            )}
                          </span>
                        </button>
                      ) : (
                        <span className={`pac-opt-thumb ${o.thumbContain ? "contain" : ""}`}>
                          {o.thumb ? <img src={o.thumb} alt="" loading="lazy" /> : <o.FB size={18} />}
                        </span>
                      )}
                      <span className="pac-opt-body">
                        <span className="pac-opt-title">{o.label || "Sans titre"}</span>
                        {o.meta && <span className="pac-opt-meta">{o.meta}</span>}
                      </span>
                      <span className="pac-opt-check">
                        {isSel(o.value) ? <Check size={16} /> : <Plus size={15} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="pac-actions">
          <button className="btn btn-ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary clickable" onClick={save}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
