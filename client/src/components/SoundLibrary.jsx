import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  Loader2,
  Music,
  Play,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import AudioTrimmer from "./AudioTrimmer";

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

const DIFF_HINT = {
  1: "une note tenue",
  2: "deux syllabes",
  3: "une inflexion",
  4: "une vraie mélodie",
  5: "tordu",
};

export default function SoundLibrary({ token, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  // Le dépôt en cours : { file } pendant le rognage, puis { blob, seconds }.
  const [draft, setDraft] = useState(null);
  const fileRef = useRef(null);

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
            Tes sons n'entrent en partie que si <b>les sons personnalisés sont
            activés</b> — par toi en solo, par l'hôte en versus. Et seuls ceux
            des joueurs présents à la table sont tirés.
          </p>

          {err && <p className="pq-err">{err}</p>}

          {/* ---------- Le dépôt ---------- */}
          {!draft ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setDraft({ file: f });
                  e.target.value = "";
                }}
              />
              <button
                className="pq-lib-add clickable"
                onClick={() => fileRef.current?.click()}
                disabled={full}
              >
                <Plus size={17} />
                {full ? "Librairie pleine" : "Ajouter un son"}
              </button>
              {!full && (
                <p className="pq-lib-tip">
                  Prends n'importe quel fichier audio : tu le rogneras juste
                  après. Un <b>cri</b> ou une <b>mélodie</b> — un fracas ou un
                  bruit sourd n'a pas de hauteur à imiter, et sera refusé.
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
            <p className="pq-lib-empty">
              Rien pour l'instant. Le premier son que tu déposes sera jouable
              dès la prochaine partie où les sons personnalisés sont activés.
            </p>
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
// Le nom est demandé APRÈS la découpe, pas avant : on ne sait comment appeler
// un extrait qu'une fois qu'on l'a entendu.
function DraftForm({ draft, token, onCancel, onRecut, onDone }) {
  const [label, setLabel] = useState("");
  const [game, setGame] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const urlRef = useRef(null);

  // L'URL locale de l'extrait, pour le réécouter avant d'envoyer. Révoquée au
  // démontage : un objet-URL qui traîne garde le blob en mémoire.
  if (!urlRef.current) urlRef.current = URL.createObjectURL(draft.blob);
  useEffect(
    () => () => {
      URL.revokeObjectURL(urlRef.current);
    },
    []
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
      fd.append("game", game.trim());
      fd.append("difficulty", String(difficulty));
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
          <Play size={15} /> Réécouter
        </button>
        <span className="pq-lib-dur">{draft.seconds.toFixed(2)} s</span>
        <button type="button" className="pq-lib-recut clickable" onClick={onRecut}>
          Recommencer la découpe
        </button>
      </div>

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
      <label className="pq-lib-field">
        <span>Jeu (facultatif)</span>
        <input
          value={game}
          onChange={(e) => setGame(e.target.value)}
          placeholder="Super Mario World"
          maxLength={80}
        />
      </label>
      <label className="pq-lib-field">
        <span>Difficulté à imiter</span>
        <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((d) => (
            <option key={d} value={d}>
              {d} — {DIFF_HINT[d]}
            </option>
          ))}
        </select>
      </label>

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
          Ajouter à ma librairie
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
      <span className="pq-lib-main">
        <b>{item.label}</b>
        {item.game && <em>{item.game}</em>}
        <span className="pq-lib-meta">
          {(item.durationMs / 1000).toFixed(1)} s · difficulté {item.difficulty}
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
