import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Loader2,
  Check,
  Search,
  AlertTriangle,
  FileArchive,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react";
import { apiUpload, apiFetch } from "../lib/api";
import { LICENCES } from "../lib/collection";
import { Modal, Section } from "./AdminSheet";

// ======================================================================
//  Poser un comic ou un manga sur l'étagère
// ======================================================================
// Le rayon vidéo part d'un LIEN ; le papier part d'un FICHIER. Tout le reste
// de la modale en découle : pas d'aperçu de playlist à vérifier, pas de liste
// d'épisodes à coller — une archive, un titre, et la fiche.
//
// L'archive fait la moitié du travail toute seule : elle porte les planches ET
// la couverture (sa première page). La recherche de métadonnées ne sert donc
// qu'à remplir le reste, et son échec n'empêche rien — ces one-shots
// promotionnels ne sont, par nature, catalogués nulle part.

const ARCHIVE_RE = /\.(cbz|cbr|zip|rar)$/i;

// CE QU'UNE FICHE TROUVÉE VERSE DANS LE FORMULAIRE — et c'est le même tableau
// des deux côtés. Poser un titre et le corriger ne doivent pas remplir les
// mêmes champs différemment, sans quoi corriger revient à ressaisir.
//
// `overwrite` dit qui l'emporte, et les deux cas sont opposés :
//   • à la CRÉATION, ce qui a été saisi à la main gagne — on a tapé le titre
//     avant de chercher, la fiche trouvée COMPLÈTE, elle n'écrase pas ;
//   • à la CORRECTION, c'est l'inverse : on va justement chercher de quoi
//     REMPLACER ce qui est là — un synopsis anglais, par exemple. Rien n'est
//     écrit en base tant qu'on n'a pas enregistré, et fermer sans enregistrer
//     annule le tout.
//
// Dans les deux cas, une valeur VIDE ne remplace jamais rien : Wikipédia ne
// connaît ni éditeur ni auteurs, et sa fiche ne doit pas effacer ceux que
// MangaDex venait de donner une ligne plus haut.
export function applyComicPick(d, r, { overwrite = false } = {}) {
  const pick = (mine, found) => (overwrite ? found || mine : mine || found);
  const both = (mine, found) =>
    overwrite ? (found?.length ? found : mine) : mine?.length ? mine : found || [];
  return {
    ...d,
    title: pick(d.title, r.title),
    originalTitle: pick(d.originalTitle, r.originalTitle),
    synopsis: pick(d.synopsis, r.synopsis),
    year: pick(d.year, r.year || ""),
    publisher: pick(d.publisher, r.publisher),
    authors: pick(d.authors, (r.authors || []).join(", ")),
    genres: both(d.genres, r.genres),
    rating: pick(d.rating, r.rating || ""),
    // PAS LA COUVERTURE. Celle du volume est sa première planche, et rien
    // d'autre : l'affiche trouvée en ligne est une AUTRE image du même titre
    // (autre édition, autre langue, autre cadrage). Le bandeau, lui, n'est le
    // portrait de rien — on le prend.
    backdrop: r.backdrop || d.backdrop,
    // Le sens de lecture EST écrasé dès que la source le connaît : elle le sait
    // mieux que le réglage par défaut, et c'est ce qu'on vient chercher en
    // cliquant. Wikipédia ne le donne pas — d'où le garde-fou.
    readDirection: r.readDirection || d.readDirection,
  };
}

// LE SENS DE LECTURE, EN GRAND ET EN PREMIER. C'est le seul réglage qu'on ne
// peut pas rattraper à l'œil une fois le volume publié : à l'envers, le lecteur
// l'ouvre par la fin. Partagé entre la pose d'un titre et sa correction — deux
// écrans qui poseraient la question différemment finiraient par y répondre
// différemment.
export function ReadDirection({ value, onChange }) {
  return (
    <div className="adm-coll-field">
      <span>Sens de lecture</span>
      <div className="adm-coll-sources">
        {[
          {
            v: "ltr",
            label: "Occidental",
            hint: "De gauche à droite — comics, manhwa, BD",
          },
          {
            v: "rtl",
            label: "Japonais",
            hint: "De droite à gauche — manga : la première page est à droite",
          },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            className={`adm-coll-source clickable ${value === o.v ? "on" : ""}`}
            onClick={() => onChange(o.v)}
          >
            <ArrowLeftRight size={16} />
            <strong>{o.label}</strong>
            <em>{o.hint}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

const fmtSize = (n) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`
    : `${Math.round(n / 1024)} ko`;

export default function ComicModal({ token, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false); // survol du dépôt
  const [draft, setDraft] = useState({
    title: "",
    originalTitle: "",
    franchise: "",
    publisher: "",
    authors: "",
    synopsis: "",
    year: "",
    genres: [],
    licence: "official",
    readDirection: "ltr",
    color: "#f2b70b",
    backdrop: "",
    rating: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  function take(f) {
    if (!f) return;
    if (!ARCHIVE_RE.test(f.name)) {
      setError("Il faut un CBZ ou un CBR (une archive zip ou rar d'images).");
      return;
    }
    setError(null);
    setFile(f);
    // Le nom du fichier est un point de départ honnête pour le titre : on
    // enlève l'extension et les balises de team entre crochets, qui n'ont rien
    // à faire sur une couverture.
    if (!draft.title) {
      const guess = f.name
        .replace(ARCHIVE_RE, "")
        .replace(/[[(][^\])]*[\])]/g, " ")
        .replace(/[_.]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (guess) set("title")(guess);
    }
  }

  async function save() {
    if (!file || !draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("archive", file, file.name);
      for (const [k, v] of Object.entries(draft)) {
        if (v === "" || v === null) continue;
        fd.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
      }
      await apiUpload("/collection/comic", fd, token);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const ready = !!file && !!draft.title.trim();

  return (
    <Modal
      title="Ajouter un comic ou un manga"
      subtitle="Une archive CBZ ou CBR, et le volume se range tout seul."
      Icon={BookOpen}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="adm-coll-error">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : (
            <p className="adm-coll-hint">
              Les planches sont extraites à l'envoi ; la première devient la
              couverture.
            </p>
          )}
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onClose}>
              Annuler
            </button>
            <button
              className="btn btn-primary clickable"
              onClick={save}
              disabled={!ready || saving}
              title={ready ? undefined : "Il faut une archive et un titre."}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Poser sur l'étagère
            </button>
          </div>
        </>
      }
    >
      <Section
        step={1}
        title="L'archive"
        hint="Un CBZ (zip) ou un CBR (rar) contenant les planches. Elles sont triées par leur numéro, pas par leur nom."
      >
        <div
          className={`adm-drop ${over ? "over" : ""} ${file ? "filled" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <FileArchive size={26} />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{fmtSize(file.size)} — clique pour en choisir une autre</span>
            </>
          ) : (
            <>
              <strong>Glisse l'archive ici</strong>
              <span>ou clique pour la choisir — .cbz, .cbr</span>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".cbz,.cbr,application/zip,application/vnd.comicbook+zip,application/x-cbr"
          hidden
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Section>

      <Section
        step={2}
        title="La fiche"
        hint="Le titre suffit. Le reste s'imprime sur le volume et sur sa fiche."
      >
        <label className="adm-coll-field">
          <span>Titre</span>
          <input value={draft.title} onChange={(e) => set("title")(e.target.value)} />
        </label>

        <ReadDirection value={draft.readDirection} onChange={set("readDirection")} />

        <div className="adm-coll-grid">
          <label className="adm-coll-field">
            <span>Saga</span>
            <input
              value={draft.franchise}
              onChange={(e) => set("franchise")(e.target.value)}
              placeholder="Sonic, Marvel…"
            />
          </label>
          <label className="adm-coll-field">
            <span>Éditeur</span>
            <input
              value={draft.publisher}
              onChange={(e) => set("publisher")(e.target.value)}
              placeholder="Shueisha, Marvel Comics…"
            />
          </label>
          <label className="adm-coll-field">
            <span>Auteurs (séparés par des virgules)</span>
            <input
              value={draft.authors}
              onChange={(e) => set("authors")(e.target.value)}
              placeholder="Scénario, dessin"
            />
          </label>
          <label className="adm-coll-field">
            <span>Année</span>
            <input
              type="number"
              value={draft.year}
              onChange={(e) => set("year")(e.target.value)}
            />
          </label>
          <label className="adm-coll-field">
            <span>Provenance</span>
            <select
              value={draft.licence}
              onChange={(e) => set("licence")(e.target.value)}
            >
              {Object.entries(LICENCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="adm-coll-field">
          <span>Synopsis</span>
          <textarea
            rows={4}
            value={draft.synopsis}
            onChange={(e) => set("synopsis")(e.target.value)}
          />
        </label>
      </Section>

      <Section
        step={3}
        title="Le rattachement"
        hint="MangaDex et Wikipédia répondent en français, AniList et ComicVine en anglais. Facultatif : un one-shot promotionnel ne figure généralement nulle part."
      >
        <ComicLookup
          token={token}
          query={draft.title}
          onPick={(r) => setDraft((d) => applyComicPick(d, r))}
        />
      </Section>
    </Modal>
  );
}

// ------------------------------------------------------------ recherche ----

const SOURCES = {
  mangadex: "MangaDex",
  wikipedia: "Wikipédia",
  anilist: "AniList",
  comicvine: "ComicVine",
};

export function ComicLookup({ token, query, onPick }) {
  const [q, setQ] = useState(query || "");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comicvine, setComicvine] = useState(true);
  const [picked, setPicked] = useState(null);
  const [failed, setFailed] = useState([]);
  const [french, setFrench] = useState(0);
  // Un filtre local sur ce qui est DÉJÀ remonté : à soixante résultats, la
  // bonne ligne est là mais noyée, et refaire une requête plus précise coûte
  // un aller-retour pour un tri que le navigateur fait instantanément.
  const [sieve, setSieve] = useState("");

  // Le champ suit le titre tant qu'on n'y a pas touché : on tape le titre une
  // fois, pas deux.
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setQ(query || "");
  }, [query]);

  async function search() {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/collection/comic-lookup?q=${encodeURIComponent(q)}`, {
        token,
      });
      setResults(d.results || []);
      setComicvine(d.comicvine);
      setFailed(d.failed || []);
      setFrench(d.french || 0);
      setSieve("");
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  // Le tamis porte sur tout ce qui identifie une entrée : on cherche parfois
  // par éditeur (« Panini ») ou par auteur quand le titre est ambigu.
  const needle = sieve.trim().toLowerCase();
  const shown = !needle
    ? results || []
    : (results || []).filter((r) =>
        [r.title, r.publisher, r.hint, ...(r.authors || [])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      );

  return (
    <>
      <div className="adm-coll-inline">
        <input
          value={q}
          onChange={(e) => {
            touched.current = true;
            setQ(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), search())}
          placeholder="Chercher — MangaDex, Wikipédia, AniList, ComicVine…"
        />
        <button
          className="btn btn-ghost clickable"
          onClick={search}
          disabled={busy || q.trim().length < 2}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
          Chercher
        </button>
      </div>

      {/* CE QUI PARLE FRANÇAIS EST EN TÊTE, et on le dit plutôt que de laisser
          chercher les pastilles à l'œil. Zéro fiche française est une
          information en soi : ce titre n'est traduit nulle part, il faudra
          écrire le synopsis à la main. */}
      {results?.length > 0 && (
        <p className="adm-coll-hint">
          {french > 0 ? (
            <>
              <Sparkles size={12} /> {french} fiche{french > 1 ? "s" : ""} en
              français, en tête de liste.
            </>
          ) : (
            <>
              Aucune fiche française pour ce titre — les résultats ci-dessous sont
              en anglais.
            </>
          )}
        </p>
      )}

      {!comicvine && (
        <p className="adm-coll-hint">
          <Sparkles size={12} /> Sans <code>COMICVINE_API_KEY</code>, les comics
          américains ne remontent que via Wikipédia. La clé se pose dans l'onglet
          Secrets.
        </p>
      )}

      {failed.length > 0 && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {failed.join(" et ")} n'a pas répondu — les
          résultats ci-dessous sont incomplets.
        </p>
      )}

      {results?.length > 0 && (
        <div className="adm-coll-inline adm-comic-sieve">
          <input
            value={sieve}
            onChange={(e) => setSieve(e.target.value)}
            placeholder="Filtrer ces résultats (titre, éditeur, auteur)…"
          />
          <span className="adm-coll-hint">
            {shown.length === results.length
              ? `${results.length} résultats`
              : `${shown.length} sur ${results.length}`}
          </span>
        </div>
      )}

      {results && results.length === 0 && (
        <p className="adm-coll-hint">
          Rien trouvé — c'est le cas courant pour un tirage promotionnel. La
          fiche se remplit à la main, l'archive fournit déjà la couverture.
        </p>
      )}

      {results?.length > 0 && (
        <div className="adm-comic-hits">
          {shown.map((r) => (
            <button
              key={r.ref}
              type="button"
              className={`adm-comic-hit clickable ${picked === r.ref ? "on" : ""}`}
              onClick={() => {
                setPicked(r.ref);
                onPick(r);
              }}
            >
              <span className="adm-comic-hit-cover">
                {r.cover ? <img src={r.cover} alt="" loading="lazy" /> : <BookOpen size={16} />}
              </span>
              <span className="adm-comic-hit-text">
                <strong>
                  {r.title}
                  {/* La langue du RÉSUMÉ, pas celle de la fiche : c'est le seul
                      champ assez long pour qu'on tienne à savoir dans quelle
                      langue il arrive. */}
                  {r.lang === "fr" && <span className="adm-comic-fr">FR</span>}
                </strong>
                <em>{[SOURCES[r.source] || r.source, r.hint].filter(Boolean).join(" · ")}</em>
                {r.authors?.length > 0 && <i>{r.authors.join(", ")}</i>}
              </span>
              {picked === r.ref && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
