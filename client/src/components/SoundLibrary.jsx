import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ImagePlus,
  Loader2,
  Music,
  Play,
  Plus,
  Scissors,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { niceSoundName } from "../lib/soundTake";
import { playableAudioFile } from "../lib/playableAudio";
import AudioTrimmer from "./AudioTrimmer";
import VoiceFxPicker, { FxTag } from "./VoiceFxPicker";

// ======================================================================
//  « Ma librairie de sons » — le dépôt communautaire du Perroquet
// ======================================================================
// Jusqu'ici la banque ne se garnissait que depuis le panneau d'admin. C'était
// le bon réglage pour lancer le jeu — quelqu'un écoute avant d'accepter — mais
// ça plafonne : le Perroquet vit de sons que les joueurs reconnaissent, et
// personne ne connaît mieux ces sons-là que la communauté qui joue.
//
// LA RÈGLE QUI REND L'OUVERTURE POSSIBLE (cf. server/src/routes/
// perroquetSounds.js) : un son déposé ici ne part JAMAIS tout seul en partie.
// Il n'entre dans le tirage que si la table a coché « sons personnalisés », et
// seuls les sons des joueurs présents à cette table sont ajoutés. Un son raté
// n'embête donc que ceux qui ont demandé à jouer avec — pas la banque commune,
// pas les inconnus. C'est ce qui évite d'avoir à modérer un flux de dépôts.
//
// Le reste de l'écran découle d'une seule contrainte : cinq secondes. Elle
// n'est tenable que si on peut rogner ICI (components/AudioTrimmer.jsx) — sinon
// on renvoie chaque déposant vers un éditeur audio, c'est-à-dire nulle part.


export default function SoundLibrary({ token, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  // Le dépôt en cours : { file } pendant le rognage, puis { blob, seconds }.
  const [draft, setDraft] = useState(null);
  // Le temps de rendre un mémo vocal décodable (aller-retour serveur + ffmpeg) :
  // sans ce voyant, cliquer sur un .amr ne fait rien de visible pendant deux
  // secondes, et on reclique.
  const [converting, setConverting] = useState(false);
  const fileRef = useRef(null);

  // Le fichier choisi doit d'abord être DÉCODABLE PAR LE NAVIGATEUR : le rogneur
  // dessine sa forme d'onde depuis un AudioBuffer. L'AMR des mémos vocaux ne
  // l'est pas — le serveur le transcode alors en mp3 (cf. lib/playableAudio.js),
  // et le reste du dépôt se déroule comme d'habitude.
  async function pick(file) {
    setErr("");
    setConverting(false);
    try {
      const ready = await playableAudioFile(file, token, {
        onConverting: () => setConverting(true),
      });
      setDraft({ file: ready });
    } catch (e) {
      setErr(e.message || "Impossible de lire ce fichier audio.");
    } finally {
      setConverting(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const d = await apiFetch("/perroquet/sounds", { token });
      setData(d);
    } catch (e) {
      setErr(e.message || "Librairie illisible.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    onChanged?.();
  }, [load, onChanged]);

  async function toggle(item) {
    setBusy(item.id);
    try {
      const d = await apiFetch(`/perroquet/sounds/${item.id}`, {
        method: "PATCH",
        token,
        body: { active: !item.active },
      });
      setData((s) => ({
        ...s,
        items: s.items.map((x) => (x.id === item.id ? d.item : x)),
      }));
      setErr("");
      onChanged?.();
    } catch (e) {
      setErr(e.message || "Modification impossible.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item) {
    if (!window.confirm(`Supprimer « ${item.label} » de ta librairie ?`)) return;
    setBusy(item.id);
    try {
      const d = await apiFetch(`/perroquet/sounds/${item.id}`, {
        method: "DELETE",
        token,
      });
      // Un son déjà joué n'est pas effacé mais éteint : les récaps des parties
      // où il est sorti doivent rester audibles. Le serveur le dit, on relaie.
      if (d.kept) {
        setErr(d.message || "");
        setData((s) => ({
          ...s,
          items: s.items.map((x) => (x.id === item.id ? d.item : x)),
        }));
      } else {
        setData((s) => ({ ...s, items: s.items.filter((x) => x.id !== item.id) }));
        setErr("");
      }
      onChanged?.();
    } catch (e) {
      setErr(e.message || "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }

  const full = data && data.items.length >= data.max;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pq-lib">
        <header className="pq-lib-head">
          <span>
            <b>
              <Music size={16} /> Ma librairie de sons
            </b>
            <em>
              {data ? `${data.items.length}/${data.max} sons` : "…"} · 5 secondes
              maximum
            </em>
          </span>
          <button className="geo-icon-btn clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="pq-lib-body">
          <p className="pq-lib-rule">
            Tes sons sortent seulement dans les parties où <b>les sons
            personnalisés</b> sont activés.
          </p>

          {err && <p className="pq-err">{err}</p>}

          {/* ---------- Le dépôt ---------- */}
          {!draft ? (
            <>
              <input
                ref={fileRef}
                type="file"
                // `audio/*` laisse de côté les mémos vocaux que certains
                // téléphones déclarent en `application/octet-stream` : les
                // extensions sont listées à côté pour qu'ils restent
                // sélectionnables dans l'explorateur de fichiers.
                accept="audio/*,.amr,.3gp,.3gpp,.awb,.m4a,.wma,.aiff"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pick(f);
                  e.target.value = "";
                }}
              />
              <button
                className="pq-lib-add clickable"
                onClick={() => fileRef.current?.click()}
                disabled={full || converting}
              >
                {converting ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
                {full
                  ? "Librairie pleine"
                  : converting
                    ? "Conversion du fichier…"
                    : "Ajouter un son"}
              </button>
              {!full && (
                <p className="pq-lib-tip">
                  N'importe quel fichier audio — <b>mémo vocal .amr</b> compris,
                  il est converti tout seul. Tu le rognes juste après. Il faut un{" "}
                  <b>cri</b> ou une <b>mélodie</b> : un bruit sourd n'a rien à
                  imiter.
                </p>
              )}
            </>
          ) : draft.blob ? (
            <DraftForm
              draft={draft}
              token={token}
              // Revenir à la découpe garde le FICHIER : rater son cadrage ne
              // doit pas obliger à rouvrir l'explorateur de fichiers.
              onRecut={() => setDraft((d) => ({ file: d.file }))}
              onCancel={() => setDraft(null)}
              onDone={async () => {
                setDraft(null);
                setErr("");
                await refresh();
              }}
            />
          ) : (
            <AudioTrimmer
              file={draft.file}
              maxSeconds={5}
              onCancel={() => setDraft(null)}
              onConfirm={(blob, seconds) =>
                setDraft((d) => ({ ...d, blob, seconds }))
              }
            />
          )}

          {/* ---------- Ce que j'ai déjà déposé ---------- */}
          {!data ? (
            <p className="pq-lib-load">
              <Loader2 size={16} className="spin" /> Chargement…
            </p>
          ) : !data.items.length ? (
            <p className="pq-lib-empty">Rien pour l'instant.</p>
          ) : (
            <ul className="pq-lib-list">
              {data.items.map((it) => (
                <LibRow
                  key={it.id}
                  item={it}
                  busy={busy === it.id}
                  onToggle={() => toggle(it)}
                  onDelete={() => remove(it)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
//  La fiche du son qu'on vient de rogner
// ============================================================
// Deux champs, pas cinq. Le nom — pré-rempli depuis le nom du fichier, parce
// qu'il est presque toujours le bon — et une image facultative. Le jeu et la
// difficulte ont ete retires : le premier faisait doublon avec le nom neuf fois
// sur dix, la seconde demandait a quelqu'un qui n'a pas encore joue le son de
// noter a quel point il est dur a imiter.
function DraftForm({ draft, token, onCancel, onRecut, onDone }) {
  const [label, setLabel] = useState(() => niceSoundName(draft.file?.name));
  const [image, setImage] = useState(null);
  const [effect, setEffect] = useState("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urlRef = useRef(null);
  const imgRef = useRef(null);

  // L'URL locale de l'extrait, pour le reecouter avant d'envoyer. Revoquee au
  // demontage : un objet-URL qui traine garde le blob en memoire.
  if (!urlRef.current) urlRef.current = URL.createObjectURL(draft.blob);
  useEffect(
    () => () => {
      URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const imgUrl = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(
    () => () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    },
    [imgUrl]
  );

  async function submit(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("clip", draft.blob, "extrait.wav");
      fd.append("label", label.trim());
      fd.append("effect", effect);
      if (image) fd.append("image", image, image.name);
      await apiUpload("/perroquet/sounds", fd, token);
      await onDone();
    } catch (e2) {
      setErr(e2.message || "Impossible d'ajouter ce son.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pq-lib-form" onSubmit={submit}>
      <div className="pq-lib-form-top">
        <button
          type="button"
          className="pq-lib-preview clickable"
          onClick={() => new Audio(urlRef.current).play().catch(() => {})}
        >
          <Play size={15} /> Reecouter
        </button>
        <span className="pq-lib-dur">{draft.seconds.toFixed(2)} s</span>
        <button type="button" className="pq-lib-recut clickable" onClick={onRecut}>
          <Scissors size={14} /> Redecouper
        </button>
      </div>

      <div className="pq-lib-idcard">
        {/* L'image n'est montree qu'a la revelation, jamais pendant qu'on
            imite : elle donnerait la reponse. */}
        <button
          type="button"
          className={`pq-lib-img clickable ${imgUrl ? "has" : ""}`}
          onClick={() => imgRef.current?.click()}
          title={imgUrl ? "Changer l'image" : "Ajouter une image"}
        >
          {imgUrl ? <img src={imgUrl} alt="" /> : <ImagePlus size={20} />}
        </button>
        {imgUrl && (
          <button
            type="button"
            className="pq-lib-img-x clickable"
            onClick={() => setImage(null)}
            aria-label="Retirer l'image"
          >
            <X size={12} />
          </button>
        )}
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            setImage(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />

        <label className="pq-lib-field">
          <span>Nom du son</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Le cri de Yoshi"
            maxLength={60}
            autoFocus
          />
        </label>
      </div>

      {/* L'effet passé sur la voix de CELUI QUI IMITE, à la révélation. Le son
          déposé, lui, n'est jamais touché : c'est le son du jeu. */}
      <VoiceFxPicker value={effect} onChange={setEffect} />

      {err && (
        <p className="pq-err">
          <AlertTriangle size={13} /> {err}
        </p>
      )}

      <div className="pq-lib-form-actions">
        <button type="button" className="pq-lib-cancel clickable" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="pq-lib-send clickable" disabled={busy || !label.trim()}>
          {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
          Ajouter
        </button>
      </div>
    </form>
  );
}

// ============================================================
//  Une ligne de la librairie
// ============================================================
function LibRow({ item, busy, onToggle, onDelete }) {
  const audioRef = useRef(null);
  return (
    <li className={`pq-lib-row ${item.active ? "" : "off"}`}>
      <button
        className="pq-lib-play clickable"
        onClick={() => {
          if (!audioRef.current) audioRef.current = new Audio(item.url);
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        }}
        aria-label={`Écouter ${item.label}`}
      >
        <Play size={14} />
      </button>
      {item.image && <img className="pq-lib-thumb" src={item.image} alt="" loading="lazy" />}
      <span className="pq-lib-main">
        <b>{item.label}</b>
        <FxTag id={item.effect} />
        <span className="pq-lib-meta">
          {(item.durationMs / 1000).toFixed(1)} s
          {item.timesPlayed > 0 && ` · joué ${item.timesPlayed}× (moy. ${item.avgScore})`}
        </span>
      </span>
      <button
        className={`pq-lib-toggle clickable ${item.active ? "on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        title={item.active ? "Retirer du tirage" : "Remettre dans le tirage"}
      >
        {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
        {item.active ? "dans le tirage" : "en pause"}
      </button>
      <button
        className="pq-lib-del clickable"
        onClick={onDelete}
        disabled={busy}
        aria-label="Supprimer"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
