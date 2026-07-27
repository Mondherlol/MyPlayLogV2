import { useEffect, useRef, useState } from "react";
import {
  Library,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  RefreshCw,
  Search,
  Check,
  X,
  Link2,
  ImagePlus,
  ExternalLink,
  Save,
  Crop,
  AlertTriangle,
  ListVideo,
  CirclePlay,
  MonitorPlay,
  Antenna,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { FORMATS, LICENCES, KINDS } from "../lib/collection";
import WrapCropModal from "./WrapCropModal";

// Les deux façons d'alimenter un boîtier. YouTube se scrape (une URL suffit,
// les épisodes suivent) ; tout le reste se colle à la main, ligne par ligne —
// c'est la contrepartie d'un lecteur qu'on ne pilote pas.
const SOURCE_MODES = [
  {
    value: "youtube",
    label: "YouTube",
    hint: "Une vidéo ou une playlist — les épisodes sont récupérés tout seuls",
    Icon: CirclePlay,
  },
  {
    value: "embed",
    label: "Autre lecteur",
    hint: "Une liste de liens : cadre du site d'origine, ou fichier vidéo direct",
    Icon: MonitorPlay,
  },
];

// ======================================================================
//  Onglet Collection — gestion des boîtiers (séries, films, animés)
// ======================================================================
// Tout part d'un LIEN de streaming : on le colle, on vérifie l'aperçu YouTube
// (bonne playlist ? bon nombre d'épisodes ?), on rattache éventuellement le
// titre à une fiche externe (TVmaze pour les séries, Wikipédia pour les films),
// et l'enrichissement fait le reste — synopsis, casting, visuels, titres
// d'épisodes.
//
// Ensuite chaque boîtier reste modifiable à la main : le support (VHS/DVD), la
// teinte de la tranche, la provenance affichée, les visuels. Les épisodes et la
// progression des joueurs, eux, ne se touchent que par « rafraîchir ».

const TINTS = [
  "#f2b70b",
  "#e0342b",
  "#2f6bf2",
  "#16a34a",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#f97316",
  "#64748b",
  "#111827",
];

const EMPTY_DRAFT = {
  // `provider` décide de la façon d'alimenter le boîtier : une URL YouTube qu'on
  // scrape, ou une LISTE de liens qu'on colle (une ligne par épisode). Voir
  // lib/collection.js côté serveur.
  provider: "youtube",
  url: "",
  episodesText: "",
  poster: "", // affiche rapatriée à l'enregistrement (import d'un répertoire)
  synopsis: "",
  genres: [],
  year: "",
  tmdbRef: "", // fiche TMDB choisie à la main (« tv:1399 »)
  langs: [], // pistes annoncées par la source (« vf », « vostfr »)
  title: "",
  kind: "series",
  format: "dvd",
  licence: "official",
  franchise: "",
  color: "#f2b70b",
  tagline: "",
  tvmazeQuery: "",
  wikiTitle: "",
};

// Ce qu'on écrit dans la zone de liste quand elle est vide : le format y est
// plus clair qu'en le décrivant.
const LIST_PLACEHOLDER = `S01E01 Le premier épisode — https://hebergeur/embed/aaa | https://miroir/embed/aaa
S01E02 — https://hebergeur/embed/bbb
https://hebergeur/embed/ccc`;

// L'interrupteur de la section. Éteinte, la page n'apparaît nulle part et
// l'API la refuse — sauf pour l'admin, qui doit bien pouvoir la garnir avant de
// l'ouvrir. C'est la même règle des deux côtés (lib/features.js côté serveur).
function VisibilitySwitch({ token }) {
  const { features, updateFeatures } = useAuth();
  const [busy, setBusy] = useState(false);
  const on = !!features.collection;

  async function toggle() {
    setBusy(true);
    try {
      const d = await apiFetch("/settings/features/collection", {
        method: "PATCH",
        token,
        body: { enabled: !on },
      });
      // La barre latérale suit tout de suite : pas de rechargement pour voir
      // le lien apparaître ou disparaître.
      updateFeatures(d.features);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`adm-coll-visib ${on ? "on" : ""}`}>
      <span className="adm-coll-visib-icon">
        {on ? <Eye size={17} /> : <EyeOff size={17} />}
      </span>
      <div className="adm-coll-visib-text">
        <strong>{on ? "Page ouverte à tous" : "Page masquée"}</strong>
        <span>
          {on
            ? "Le rayon vidéo apparaît dans la barre latérale de tout le monde."
            : "Personne ne voit le rayon, ni le lien ni la page. Toi si : c'est ici qu'on le garnit avant de l'ouvrir."}
        </span>
      </div>
      <button
        className={`admin-switch clickable ${on ? "on" : ""}`}
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
        aria-label="Afficher la page Collection"
      >
        <span className="admin-switch-knob">
          {busy && <Loader2 size={11} className="spin" />}
        </span>
      </button>
    </div>
  );
}

export default function CollectionPanel({ token }) {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // slug en cours d'édition
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    apiFetch("/collection", { token })
      .then((d) => setMedia(d.media || []))
      .catch(() => setMedia([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  const target = media.find((m) => m.slug === editing) || null;

  return (
    <div className="adm-coll">
      <VisibilitySwitch token={token} />

      <header className="adm-coll-head">
        <div>
          <h2>
            <Library size={18} /> Collection
          </h2>
          <p>
            {media.length} boîtier{media.length > 1 ? "s" : ""} sur l'étagère ·{" "}
            {media.reduce((n, m) => n + (m.episodeCount || 0), 0)} épisodes
          </p>
        </div>
        <button
          className="btn btn-primary clickable"
          onClick={() => setCreating(true)}
        >
          <Plus size={16} /> Ajouter un titre
        </button>
      </header>

      {loading ? (
        <div className="adm-coll-state">
          <Loader2 size={20} className="spin" /> Chargement…
        </div>
      ) : media.length === 0 ? (
        <div className="adm-coll-state">
          L'étagère est vide. Colle un lien YouTube pour poser le premier boîtier.
        </div>
      ) : (
        <ul className="adm-coll-list">
          {media.map((m) => (
            <Row
              key={m.slug}
              media={m}
              token={token}
              onEdit={() => setEditing(m.slug)}
              onChanged={load}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CreateModal
          token={token}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {target && (
        <EditDrawer
          media={target}
          token={token}
          onClose={() => setEditing(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ligne --

function Row({ media, token, onEdit, onChanged }) {
  const [busy, setBusy] = useState(null); // "refresh" | "delete"

  async function refresh() {
    setBusy("refresh");
    try {
      await apiFetch(`/collection/${media.slug}/refresh`, { method: "POST", token });
      onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Retirer « ${media.title} » de la collection ?\nLa progression des joueurs sur ce titre sera perdue.`
      )
    )
      return;
    setBusy("delete");
    try {
      await apiFetch(`/collection/${media.slug}`, { method: "DELETE", token });
      onChanged();
    } catch (e) {
      alert(e.message);
      setBusy(null);
    }
  }

  return (
    <li className="adm-coll-row" style={{ "--tint": media.color }}>
      <span className="adm-coll-thumb">
        {media.poster ? <img src={media.poster} alt="" /> : <Library size={18} />}
        <i className="adm-coll-spine" />
      </span>

      <div className="adm-coll-main">
        <strong>{media.title}</strong>
        <span className="adm-coll-meta">
          <em className="adm-coll-pill">{FORMATS[media.format]?.label}</em>
          <em className="adm-coll-pill">{KINDS[media.kind]?.label}</em>
          <em className="adm-coll-pill">{LICENCES[media.licence]?.label}</em>
          {media.provider && media.provider !== "youtube" && (
            <em className="adm-coll-pill ext" title="Lecteur externe : liste tenue à la main">
              <MonitorPlay size={11} /> Externe
            </em>
          )}
          {media.franchise && <span>{media.franchise}</span>}
          <span>
            {media.episodeCount} épisode{media.episodeCount > 1 ? "s" : ""}
          </span>
          {media.year && <span>{media.year}</span>}
        </span>
      </div>

      <div className="adm-coll-actions">
        <a
          className="adm-coll-icon clickable"
          href={`/collection/${media.slug}`}
          target="_blank"
          rel="noreferrer"
          title="Voir la fiche"
        >
          <ExternalLink size={15} />
        </a>
        <button
          className="adm-coll-icon clickable"
          onClick={refresh}
          disabled={!!busy}
          title="Ré-enrichir depuis les sources (nouveaux épisodes, métadonnées)"
        >
          {busy === "refresh" ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
        <button className="adm-coll-icon clickable" onClick={onEdit} title="Modifier">
          <Pencil size={15} />
        </button>
        <button
          className="adm-coll-icon danger clickable"
          onClick={remove}
          disabled={!!busy}
          title="Retirer"
        >
          {busy === "delete" ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Trash2 size={15} />
          )}
        </button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------- création ----

function CreateModal({ token, onClose, onDone }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const manual = draft.provider !== "youtube";

  // Aperçu de l'URL : on vérifie AVANT d'enregistrer que le lien pointe bien
  // sur ce qu'on croit (une playlist de 78 épisodes, pas une seule vidéo).
  async function check() {
    setChecking(true);
    setError(null);
    try {
      const d = await apiFetch(`/collection/preview?url=${encodeURIComponent(draft.url)}`, {
        token,
      });
      setPreview(d);
      setDraft((prev) => ({
        ...prev,
        title: prev.title || d.playlistTitle || d.title,
        kind: d.playlistId ? "series" : "film",
      }));
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setChecking(false);
    }
  }

  // Même geste pour une liste collée : on la relit et on montre ce qui en sort
  // (combien d'épisodes, chez qui, combien de miroirs) avant d'enregistrer quoi
  // que ce soit. Une ligne mal formée se voit au décompte.
  async function checkList() {
    setChecking(true);
    setError(null);
    try {
      const d = await apiFetch("/collection/preview-list", {
        method: "POST",
        token,
        body: { text: draft.episodesText },
      });
      setPreview({ ...d, list: true });
      if (!d.count) setError("Aucune ligne lisible : il faut un lien http par épisode.");
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/collection", { method: "POST", token, body: draft });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Ajouter un titre" onClose={onClose} wide>
      {/* D'où vient l'image ? Tout le reste de la modale en découle. */}
      <div className="adm-coll-field">
        <span>Lecteur</span>
        <div className="adm-coll-sources">
          {SOURCE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`adm-coll-source clickable ${
                draft.provider === m.value ? "on" : ""
              }`}
              onClick={() => {
                set("provider")(m.value);
                setPreview(null);
              }}
            >
              <m.Icon size={16} />
              <strong>{m.label}</strong>
              <em>{m.hint}</em>
            </button>
          ))}
        </div>
      </div>

      {!manual ? (
        <label className="adm-coll-field">
          <span>Lien de streaming (YouTube — vidéo ou playlist)</span>
          <div className="adm-coll-inline">
            <input
              value={draft.url}
              onChange={(e) => set("url")(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…&list=…"
            />
            <button
              className="btn btn-ghost clickable"
              onClick={check}
              disabled={!draft.url || checking}
            >
              {checking ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />}
              Vérifier
            </button>
          </div>
        </label>
      ) : (
        <>
          <ListImport
            token={token}
            onImported={(d) => {
              // L'import REMPLIT le formulaire, il ne l'enregistre pas : tout
              // reste relisible (et corrigeable) avant de poser le boîtier.
              setDraft((prev) => ({
                ...prev,
                url: d.sourceUrl || prev.url,
                title: prev.title || d.title || "",
                episodesText: d.list || prev.episodesText,
                poster: d.cover || prev.poster,
                synopsis: d.synopsis || prev.synopsis,
                genres: d.genres?.length ? d.genres : prev.genres,
                year: d.year || prev.year,
                // Les pistes réellement trouvées : elles s'impriment au dos du
                // boîtier, on ne les invente donc pas.
                langs: [...new Set(d.seasons.map((s) => s.lang).filter(Boolean))],
                tvmazeQuery: prev.tvmazeQuery || d.title || "",
              }));
              setPreview(null);
            }}
          />

          <label className="adm-coll-field">
            <span>Page d'origine (facultatif — affichée sur la fiche)</span>
            <input
              value={draft.url}
              onChange={(e) => set("url")(e.target.value)}
              placeholder="https://site-d-origine/la-serie"
            />
          </label>

          <label className="adm-coll-field">
            <span>
              Épisodes — une ligne par épisode : <code>S01E02 Titre — lien</code>, et
              les liens suivants sur la même ligne sont des miroirs
            </span>
            <textarea
              className="adm-coll-list"
              rows={9}
              spellCheck={false}
              value={draft.episodesText}
              onChange={(e) => set("episodesText")(e.target.value)}
              placeholder={LIST_PLACEHOLDER}
            />
          </label>
          <div className="adm-coll-inline">
            <button
              className="btn btn-ghost clickable"
              onClick={checkList}
              disabled={!draft.episodesText.trim() || checking}
            >
              {checking ? <Loader2 size={15} className="spin" /> : <ListVideo size={15} />}
              Relire la liste
            </button>
            <span className="adm-coll-hint">
              Un lien direct (.mp4, .m3u8) est lu par le poste comme YouTube ;
              tout autre lien s'affiche dans le cadre du site d'origine, sans
              progression suivie.
            </span>
          </div>
        </>
      )}

      {preview && !preview.list && (
        <div className="adm-coll-preview">
          {preview.thumb && <img src={preview.thumb} alt="" />}
          <div>
            <strong>{preview.playlistTitle || preview.title}</strong>
            <span>
              {preview.channel && `${preview.channel} · `}
              {preview.count} vidéo{preview.count > 1 ? "s" : ""}
              {preview.playlistId ? " (playlist)" : " (vidéo seule)"}
            </span>
            {preview.episodes.length > 0 && (
              <ul>
                {preview.episodes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {preview?.list && <ListPreview preview={preview} />}

      <Fields draft={draft} set={set} />

      <ExternalMatch
        token={token}
        kind={draft.kind}
        query={draft.title}
        onPick={(r) => {
          if (r.source === "tmdb") {
            // La fiche TMDB commande tout le reste : titres d'épisodes,
            // images, casting, année. On la retient telle quelle.
            setDraft((d) => ({
              ...d,
              tmdbRef: r.ref,
              title: d.title || r.title,
              kind: r.kind || d.kind,
              year: d.year || r.year || "",
            }));
          } else if (r.source === "tvmaze") {
            setDraft((d) => ({ ...d, tvmazeQuery: r.ref, title: d.title || r.title }));
          } else {
            setDraft((d) => ({ ...d, wikiTitle: r.ref }));
          }
        }}
        picked={{
          tmdb: draft.tmdbRef,
          tvmaze: draft.tvmazeQuery,
          wiki: draft.wikiTitle,
        }}
      />

      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <footer className="adm-coll-foot">
        <button className="btn btn-ghost clickable" onClick={onClose}>
          Annuler
        </button>
        <button
          className="btn btn-primary clickable"
          onClick={save}
          disabled={
            (manual ? !draft.episodesText.trim() : !draft.url) || !draft.title || saving
          }
        >
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          Enrichir et poser sur l'étagère
        </button>
      </footer>
      <p className="adm-coll-hint">
        L'enrichissement interroge {manual ? "" : "YouTube, "}TVmaze et Wikipédia :
        compte quelques secondes pour une longue série.
      </p>
    </Modal>
  );
}

// ------------------------------------------------ import d'un répertoire ----
//
// Certains sites ne sont qu'un INDEX de liens : la page liste les saisons, et
// chaque saison porte les adresses des hébergeurs. Plutôt que de recopier 80
// lignes à la main, on lit la fiche et on REMPLIT la zone de liste — ce qui en
// sort est du texte, relu et corrigé avant d'être enregistré. L'import fait la
// frappe, pas le choix.

const IMPORT_LANGS = [
  { value: "vf", label: "VF" },
  { value: "vostfr", label: "VOSTFR" },
];

function ListImport({ token, onImported }) {
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("vf");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const d = await apiFetch(
        `/collection/import/anime-sama?url=${encodeURIComponent(url)}&lang=${lang}`,
        { token }
      );
      setReport(d);
      onImported(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-coll-import">
      <div className="adm-coll-field">
        <span>
          <Download size={13} /> Importer depuis un répertoire de liens
          (anime-sama) — remplit la liste ci-dessous
        </span>
        <div className="adm-coll-inline">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://anime-sama.xx/catalogue/mon-titre/"
            onKeyDown={(e) => e.key === "Enter" && url && !busy && run()}
          />
          <select
            className="adm-coll-lang"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Langue préférée"
          >
            {IMPORT_LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost clickable"
            onClick={run}
            disabled={!url.trim() || busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            Récupérer
          </button>
        </div>
      </div>

      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {report && (
        <div className="adm-coll-import-report">
          {report.cover && <img src={report.cover} alt="" />}
          <div>
            <strong>{report.title}</strong>
            <span>
              {report.count} épisode{report.count > 1 ? "s" : ""} ·{" "}
              {report.seasons.filter((s) => s.count).length} saison
              {report.seasons.filter((s) => s.count).length > 1 ? "s" : ""}
              {report.year ? ` · ${report.year}` : ""}
            </span>
            <ul>
              {report.seasons.map((s) => (
                <li key={s.path} className={s.count ? "" : "empty"}>
                  {s.label}
                  {s.lang ? ` · ${s.lang.toUpperCase()}` : ""} —{" "}
                  {s.count
                    ? `${s.count} épisode${s.count > 1 ? "s" : ""}`
                    : "rien trouvé dans cette langue"}
                </li>
              ))}
            </ul>
            <span className="adm-coll-import-hosts">
              {report.hosts.slice(0, 6).map((h) => (
                <em key={h.host}>
                  {h.host} <b>{h.count}</b>
                </em>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Ce que la liste collée a donné, avant d'enregistrer : le décompte d'abord
// (c'est lui qui trahit une ligne oubliée), puis les hébergeurs et les premières
// entrées telles qu'elles seront rangées.
function ListPreview({ preview }) {
  const missed = preview.lines - preview.count;
  return (
    <div className="adm-coll-listprev">
      <div className="adm-coll-listprev-head">
        <strong>
          {preview.count} épisode{preview.count > 1 ? "s" : ""} lu
          {preview.count > 1 ? "s" : ""}
        </strong>
        {missed > 0 && (
          <span className="adm-coll-listprev-warn">
            <AlertTriangle size={13} /> {missed} ligne{missed > 1 ? "s" : ""} sans lien —
            ignorée{missed > 1 ? "s" : ""}
          </span>
        )}
        <span className="adm-coll-listprev-hosts">
          {preview.hosts.map((h) => (
            <em key={h.host} title={`${h.count} lien${h.count > 1 ? "s" : ""}`}>
              {h.host} <b>{h.count}</b>
            </em>
          ))}
        </span>
      </div>

      <ul>
        {preview.episodes.map((e, i) => (
          <li key={i}>
            <span className="adm-coll-listprev-num">
              S{String(e.season || 1).padStart(2, "0")}E
              {String(e.number ?? i + 1).padStart(2, "0")}
            </span>
            <span className="adm-coll-listprev-title">{e.title || <em>sans titre</em>}</span>
            <span className="adm-coll-listprev-host">
              {e.provider === "file" ? "fichier" : e.host}
              {e.mirrors > 0 && (
                <b title={`${e.mirrors} miroir${e.mirrors > 1 ? "s" : ""}`}>
                  <Antenna size={11} /> {e.mirrors + 1}
                </b>
              )}
            </span>
          </li>
        ))}
        {preview.count > preview.episodes.length && (
          <li className="adm-coll-listprev-more">
            … et {preview.count - preview.episodes.length} de plus
          </li>
        )}
      </ul>
    </div>
  );
}

// -------------------------------------------------------------- édition ----

function EditDrawer({ media, token, onClose, onChanged }) {
  const [draft, setDraft] = useState({
    title: media.title,
    kind: media.kind,
    format: media.format,
    licence: media.licence,
    franchise: media.franchise || "",
    color: media.color || "#f2b70b",
    tagline: media.tagline || "",
    year: media.year || "",
    endYear: media.endYear || "",
    synopsis: media.synopsis || "",
    sourceUrl: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = { ...draft };
      body.year = body.year === "" ? null : Number(body.year);
      body.endYear = body.endYear === "" ? null : Number(body.endYear);
      if (!body.sourceUrl) delete body.sourceUrl;
      const d = await apiFetch(`/collection/${media.slug}`, {
        method: "PATCH",
        token,
        body,
      });
      onChanged();
      if (d.needsRefresh)
        alert(
          "Lien mis à jour. Lance « rafraîchir » sur la ligne pour recharger les épisodes."
        );
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={media.title} onClose={onClose} wide>
      <div className="adm-coll-split">
        <div>
          <Fields draft={draft} set={set} withYears withSynopsis />

          <label className="adm-coll-field">
            <span>Changer le lien de streaming (facultatif)</span>
            <input
              value={draft.sourceUrl}
              onChange={(e) => set("sourceUrl")(e.target.value)}
              placeholder={media.source?.url || "https://www.youtube.com/…"}
            />
          </label>

          {/* Les titres servis par un lecteur tiers n'ont rien à re-scraper :
              leur entretien, c'est cette liste. */}
          {media.provider && media.provider !== "youtube" && (
            <EpisodesEditor media={media} token={token} onChanged={onChanged} />
          )}
        </div>

        <div className="adm-coll-aside">
          <BoxPreview media={{ ...media, ...draft }} />
          <Artwork media={media} token={token} which="wrap" onChanged={onChanged} />
          <Artwork media={media} token={token} which="poster" onChanged={onChanged} />
          <Artwork media={media} token={token} which="backdrop" onChanged={onChanged} />
        </div>
      </div>

      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <footer className="adm-coll-foot">
        <button className="btn btn-ghost clickable" onClick={onClose}>
          Fermer
        </button>
        <button className="btn btn-primary clickable" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
          Enregistrer
        </button>
      </footer>
    </Modal>
  );
}

// ------------------------------------------------------ liste d'épisodes ----
//
// L'entretien d'un titre servi ailleurs : la liste telle qu'elle a été écrite,
// rouverte pour être corrigée. Un hébergeur tombe, on remplace la ligne — le
// reste (titres, résumés, vignettes) est reporté par saison/numéro côté serveur.

function EpisodesEditor({ media, token, onChanged }) {
  const [text, setText] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/collection/${media.slug}/episodes-text`, { token })
      .then((d) => alive && setText(d.text || ""))
      .catch(() => alive && setText(""));
    return () => {
      alive = false;
    };
  }, [media.slug, token]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const d = await apiFetch(`/collection/${media.slug}/episodes`, {
        method: "PUT",
        token,
        body: { text },
      });
      setMsg({
        ok: true,
        text: `${d.media.episodes.length} épisode${
          d.media.episodes.length > 1 ? "s" : ""
        } enregistré${d.media.episodes.length > 1 ? "s" : ""}.${
          d.shifted
            ? " La liste a changé de longueur : les épisodes déjà cochés par les joueurs ne pointent plus au même endroit."
            : ""
        }`,
      });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-coll-field">
      <span>
        <ListVideo size={13} /> Épisodes ({media.episodeCount}) — une ligne par
        épisode, miroirs séparés par « | »
      </span>
      {text === null ? (
        <div className="adm-coll-state">
          <Loader2 size={16} className="spin" /> Lecture de la liste…
        </div>
      ) : (
        <>
          <textarea
            className="adm-coll-list"
            rows={10}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={LIST_PLACEHOLDER}
          />
          <div className="adm-coll-inline">
            <button
              className="btn btn-ghost clickable"
              onClick={save}
              disabled={saving || !text.trim()}
            >
              {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
              Enregistrer la liste
            </button>
            {msg && (
              <span className={msg.ok ? "adm-coll-picked" : "adm-coll-error"}>
                {msg.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------- champs ----

function Fields({ draft, set, withYears, withSynopsis }) {
  return (
    <>
      <label className="adm-coll-field">
        <span>Titre</span>
        <input value={draft.title} onChange={(e) => set("title")(e.target.value)} />
      </label>

      <div className="adm-coll-grid">
        <label className="adm-coll-field">
          <span>Nature</span>
          <select value={draft.kind} onChange={(e) => set("kind")(e.target.value)}>
            {Object.entries(KINDS).map(([v, k]) => (
              <option key={v} value={v}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        {/* Pas de sélecteur de support : tout est en boîtier DVD. Le champ
            existe toujours en base pour le jour où un autre support arrivera. */}

        <label className="adm-coll-field">
          <span>Provenance</span>
          <select value={draft.licence} onChange={(e) => set("licence")(e.target.value)}>
            {Object.entries(LICENCES).map(([v, l]) => (
              <option key={v} value={v}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-coll-field">
          <span>Saga</span>
          <input
            value={draft.franchise}
            onChange={(e) => set("franchise")(e.target.value)}
            placeholder="Sonic, Super Mario…"
          />
        </label>

        {withYears && (
          <>
            <label className="adm-coll-field">
              <span>Année</span>
              <input
                type="number"
                value={draft.year}
                onChange={(e) => set("year")(e.target.value)}
              />
            </label>
            <label className="adm-coll-field">
              <span>Fin (séries)</span>
              <input
                type="number"
                value={draft.endYear}
                onChange={(e) => set("endYear")(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <label className="adm-coll-field">
        <span>Accroche</span>
        <input
          value={draft.tagline}
          onChange={(e) => set("tagline")(e.target.value)}
          placeholder="Une phrase, affichée sur la fiche"
        />
      </label>

      {withSynopsis && (
        <label className="adm-coll-field">
          <span>Synopsis</span>
          <textarea
            rows={5}
            value={draft.synopsis}
            onChange={(e) => set("synopsis")(e.target.value)}
          />
        </label>
      )}

      <div className="adm-coll-field">
        <span>Teinte de la tranche</span>
        <div className="adm-coll-tints">
          {TINTS.map((c) => (
            <button
              key={c}
              className={`adm-coll-tint clickable ${draft.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => set("color")(c)}
              title={c}
              type="button"
            >
              {draft.color === c && <Check size={13} />}
            </button>
          ))}
          <input
            type="color"
            className="adm-coll-tint-pick"
            value={draft.color}
            onChange={(e) => set("color")(e.target.value)}
            title="Teinte personnalisée"
          />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------- rattachement externe ----

function ExternalMatch({ token, kind, query, onPick, picked }) {
  const [q, setQ] = useState(query || "");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  // Le serveur dit s'il a une clé TMDB : sans elle, pas d'images ni de résumés
  // par épisode, et ça se voit à l'arrivée — autant prévenir ici.
  const [tmdbOn, setTmdbOn] = useState(true);
  const lastQuery = useRef("");

  useEffect(() => {
    if (query && !lastQuery.current) setQ(query);
  }, [query]);

  async function search() {
    setBusy(true);
    lastQuery.current = q;
    try {
      const d = await apiFetch(
        `/collection/lookup?q=${encodeURIComponent(q)}&kind=${kind}`,
        { token }
      );
      setResults(d.results || []);
      setTmdbOn(d.tmdb !== false);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-coll-match">
      <div className="adm-coll-field">
        <span>Rattacher à une fiche existante (synopsis, casting, épisodes)</span>
        <div className="adm-coll-inline">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom de la série ou du film"
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button
            className="btn btn-ghost clickable"
            onClick={search}
            disabled={q.length < 2 || busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            Chercher
          </button>
        </div>
      </div>

      {(picked.tmdb || picked.tvmaze || picked.wiki) && (
        <p className="adm-coll-picked">
          <Check size={13} />
          {picked.tmdb && <>TMDB : {picked.tmdb}. </>}
          {picked.tvmaze && <>TVmaze : {picked.tvmaze}. </>}
          {picked.wiki && <>Wikipédia : {picked.wiki}.</>}
        </p>
      )}

      {results?.length === 0 && (
        <p className="adm-coll-hint">
          Aucune fiche trouvée — l'enrichissement se fera avec les seules données
          de la source.
        </p>
      )}

      {/* Sans clé TMDB, on n'a ni les images d'épisodes ni les fiches de films :
          autant le dire là où ça se voit. */}
      {results && !tmdbOn && (
        <p className="adm-coll-hint">
          <AlertTriangle size={13} /> Aucune clé TMDB configurée : pas d'images ni de
          résumés par épisode. Ajoute <code>TMDB_API_KEY</code> dans l'onglet Secrets.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="adm-coll-results">
          {results.map((r) => (
            <li key={`${r.source}-${r.ref}`}>
              <button className="clickable" onClick={() => onPick(r)} type="button">
                {r.poster ? (
                  <img src={r.poster} alt="" />
                ) : (
                  <span className="adm-coll-noimg" />
                )}
                <span className="adm-coll-res-text">
                  <strong>
                    {r.title}
                    {r.year ? ` (${r.year})` : ""}
                  </strong>
                  <em>
                    {r.source === "tmdb"
                      ? `TMDB · ${KINDS[r.kind]?.label || ""}`
                      : r.source === "tvmaze"
                        ? "TVmaze"
                        : "Wikipédia"}
                    {r.network ? ` · ${r.network}` : ""}
                  </em>
                  {r.summary && <span>{r.summary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- visuels ----

const ARTWORKS = {
  wrap: {
    label: "Jaquette complète (dos · tranche · couverture)",
    hint: "Dépliée comme à l'impression. Elle habille le boîtier 3D à elle seule.",
  },
  poster: { label: "Affiche (portrait)", hint: "Vue en grille et fiche." },
  backdrop: { label: "Bandeau (paysage)", hint: "Haut de la fiche." },
};

function Artwork({ media, token, which, onChanged }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(null); // source à aligner
  const fileRef = useRef(null);
  const { label, hint } = ARTWORKS[which];
  const current = media[which];

  async function push(body) {
    setBusy(true);
    try {
      if (body instanceof FormData)
        await apiUpload(`/collection/${media.slug}/artwork`, body, token);
      else
        await apiFetch(`/collection/${media.slug}/artwork`, {
          method: "POST",
          token,
          body,
        });
      setUrl("");
      onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // permet de re-choisir le même fichier
    // La jaquette dépliée passe par l'alignement : c'est là que se joue la
    // position de la tranche, et une jaquette mal calée se voit sur l'étagère.
    if (which === "wrap") {
      setCropping(URL.createObjectURL(file));
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("which", which);
    push(fd);
  }

  // Une URL distante ne peut pas être alignée telle quelle : le canvas refuse
  // d'exporter une image d'un autre domaine. On la fait donc d'abord rapatrier
  // par le serveur, puis on aligne NOTRE copie, qui est de la même origine.
  async function fromUrl() {
    if (which !== "wrap") return push({ which, url });
    setBusy(true);
    try {
      const d = await apiFetch(`/collection/${media.slug}/artwork`, {
        method: "POST",
        token,
        body: { which, url },
      });
      setUrl("");
      onChanged();
      setCropping(d.media.wrap);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyCrop(blob) {
    const fd = new FormData();
    fd.append("file", blob, "wrap.jpg");
    fd.append("which", "wrap");
    await push(fd);
    URL.revokeObjectURL(cropping);
    setCropping(null);
  }

  return (
    <div className="adm-coll-art">
      <span className="adm-coll-art-label" title={hint}>
        {label}
      </span>
      <div className={`adm-coll-art-box ${which}`}>
        {current ? <img src={current} alt="" /> : <ImagePlus size={18} />}
        {/* Repères de pliage : on voit d'un coup d'œil si la tranche tombe au
            bon endroit sur la jaquette qu'on vient de coller. */}
        {which === "wrap" && current && (
          <span className="adm-coll-folds" aria-hidden="true">
            <i />
            <i />
          </span>
        )}
        {busy && (
          <span className="adm-coll-art-busy">
            <Loader2 size={16} className="spin" />
          </span>
        )}
      </div>
      <div className="adm-coll-inline">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="URL de l'image"
        />
        <button className="btn btn-ghost clickable" onClick={fromUrl} disabled={!url || busy}>
          OK
        </button>
      </div>
      <div className="adm-coll-inline">
        <button
          className="adm-coll-upload clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <ImagePlus size={14} /> Déposer un fichier
        </button>
        {which === "wrap" && current && (
          <button
            className="adm-coll-upload clickable"
            onClick={() => setCropping(current)}
            disabled={busy}
            title="Repositionner la tranche"
          >
            <Crop size={14} /> Aligner
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      {cropping && (
        <WrapCropModal
          src={cropping}
          onCancel={() => setCropping(null)}
          onApply={applyCrop}
        />
      )}
    </div>
  );
}

// Aperçu de la tranche telle qu'elle sera sur l'étagère : la teinte et le
// support se jugent sur l'objet, pas dans un sélecteur.
function BoxPreview({ media }) {
  return (
    <div className="adm-coll-boxprev">
      <span className="adm-coll-art-label">Aperçu de la tranche</span>
      <span
        className={`adm-coll-spine-prev fmt-${media.format}`}
        style={{ "--tint": media.color }}
      >
        <i className="cap">{FORMATS[media.format]?.label}</i>
        <b>{media.title}</b>
        <i className="foot">{media.year || ""}</i>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- modale ----

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="adm-coll-modal" onClick={onClose}>
      <div
        className={`adm-coll-sheet ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3>{title}</h3>
          <button className="adm-coll-icon clickable" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="adm-coll-body">{children}</div>
      </div>
    </div>
  );
}
