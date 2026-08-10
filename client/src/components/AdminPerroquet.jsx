import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import AudioTrimmer from "./AudioTrimmer";
import { niceSoundName } from "../lib/soundTake";

// ======================================================================
//  Onglet « Perroquet » — la banque de sons
// ======================================================================
// Le seul endroit où la banque se garnit (cf. server/src/routes/
// perroquetAdmin.js). Il y avait un script de seed, il a été retiré : deux
// chemins vers la même collection, c'était deux jeux de règles à garder
// d'accord, et celui du script exigeait un accès au serveur pour ajouter un cri.
//
// L'écran est fait pour une tâche répétitive — on ajoute des sons en série — et
// pour une seule décision à chaque fois : est-ce que ce son est IMITABLE ? D'où
// deux partis pris :
//
//   1. Le dépôt tient en un geste et deux champs : on choisit un fichier, on le
//      rogne, le nom se pré-remplit tout seul. Rien à ressaisir entre deux sons.
//   2. Chaque ligne montre « % voisé » et la moyenne des scores obtenus. Le
//      premier dit si le son a une mélodie à imiter, le second si les joueurs y
//      arrivent. Un clip à 15 % voisé ou dont la moyenne plafonne à 25 est un
//      mauvais clip — et c'est invisible à l'écoute.

// « Communauté » n'est pas un filtre comme les autres : c'est un AUTRE monde.
// Les sons déposés par les joueurs (client/src/components/SoundLibrary.jsx) ne
// sortent que sur les tables qui ont coché « sons personnalisés », donc ils ne
// concurrencent pas la banque officielle — mais un administrateur doit pouvoir
// les écouter et en retirer un qui n'a rien à faire là.
const FILTERS = [
  { key: "all", label: "Tous" },
  { key: "active", label: "En service" },
  { key: "off", label: "Éteints" },
  { key: "community", label: "Communauté" },
];


export default function AdminPerroquet({ token }) {
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/admin/perroquet?filter=${filter}`, { token });
      setData(d);
      setErr("");
    } catch (e) {
      setErr(e.message || "Banque illisible.");
    }
  }, [token, filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(item, body) {
    setBusy(item.id);
    try {
      const d = await apiFetch(`/admin/perroquet/${item.id}`, {
        method: "PATCH",
        token,
        body,
      });
      setData((s) => ({
        ...s,
        items: s.items.map((x) => (x.id === item.id ? d.item : x)),
      }));
      setErr("");
    } catch (e) {
      setErr(e.message || "Modification impossible.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item) {
    setBusy(item.id);
    try {
      await apiFetch(`/admin/perroquet/${item.id}`, { method: "DELETE", token });
      setData((s) => ({ ...s, items: s.items.filter((x) => x.id !== item.id) }));
      setErr("");
    } catch (e) {
      // 409 = le son a déjà été joué. Le serveur refuse pour ne pas rendre des
      // parties muettes ; on relaie la raison plutôt qu'un « échec » sec, et on
      // propose le geste qu'il faut faire à la place.
      setErr(e.message || "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }

  async function demo(method) {
    setBusy("demo");
    try {
      await apiFetch("/admin/perroquet/demo", { method, token });
      await load();
      setErr("");
    } catch (e) {
      setErr(e.message || "Action impossible.");
    } finally {
      setBusy("");
    }
  }

  const c = data?.counts;

  return (
    <div className="admin-section admin-perroquet">
      <header className="admin-section-head">
        <h2>Banque de sons du Perroquet</h2>
        <p>
          Les sons que les joueurs doivent imiter à la voix. Un bon son est{" "}
          <b>court</b> (0,3 à 2 s), <b>mélodique</b> — un cri, pas un fracas — et
          reconnaissable. Le serveur refuse à l'envoi ce qui n'a pas de hauteur
          à imiter&nbsp;: le barème n'aurait rien à mesurer et distribuerait les
          points au hasard.
        </p>
      </header>

      {err && <p className="admin-error">{err}</p>}

      {c && (
        <div className="admin-stats-row">
          <span className="admin-stat">
            <b>{c.active}</b> en service
          </span>
          <span className="admin-stat">
            <b>{c.off}</b> éteints
          </span>
          <span className="admin-stat">
            <b>{c.community || 0}</b> déposés par des joueurs
          </span>
          {c.active < 5 && (
            <span className="admin-stat warn">
              <AlertTriangle size={13} /> il en faut au moins 5 pour une partie
            </span>
          )}
        </div>
      )}

      <AddForm token={token} onAdded={load} />

      <div className="admin-filters">
        <div className="admin-seg">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`admin-seg-opt clickable ${filter === f.key ? "on" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="pq-admin-demo">
          <button
            className="admin-btn clickable"
            onClick={() => demo("POST")}
            disabled={busy === "demo"}
            title="Six mélodies de synthèse, pour tester la boucle sans avoir sourcé de vrais sons"
          >
            {busy === "demo" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            Sons de démo
          </button>
          <button
            className="admin-btn clickable"
            onClick={() => demo("DELETE")}
            disabled={busy === "demo"}
          >
            <Trash2 size={14} /> Retirer la démo
          </button>
        </div>
      </div>

      {!data ? (
        <p className="admin-loading">
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : !data.items.length ? (
        <p className="admin-empty">
          Aucun son ici. Ajoute-en un ci-dessus, ou fabrique les sons de
          démonstration pour pouvoir jouer tout de suite.
        </p>
      ) : (
        <ul className="pq-admin-list">
          {data.items.map((it) => (
            <ClipRow
              key={it.id}
              item={it}
              busy={busy === it.id}
              onToggle={() => patch(it, { active: !it.active })}
              onDelete={() => remove(it)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
//  Ajouter un son
// ============================================================
// Deux champs seulement : le nom — pré-rempli depuis le nom du fichier — et une
// image facultative, montrée à la révélation. Le jeu et la difficulté ont été
// retirés : le premier répétait le nom neuf fois sur dix, la seconde demandait
// de noter à l'aveugle un son qu'on n'a pas encore fait jouer.
//
// Le rogneur s'ouvre dès qu'un fichier est choisi : la banque ne veut que des
// extraits de 0,3 à 2 s, et un fichier sourcé ailleurs les respecte rarement du
// premier coup. En faire l'étape normale évite le refus du serveur suivi d'un
// aller-retour dans un éditeur audio.
function AddForm({ token, onAdded }) {
  const fileRef = useRef(null);
  const imgRef = useRef(null);
  const [file, setFile] = useState(null);
  // L'extrait rogné, quand on est passé par le rogneur : c'est LUI qu'on envoie
  // à la place du fichier d'origine. Le même outil que les joueurs
  // (components/AudioTrimmer.jsx) — un « wahoo » se découpe de la même façon
  // qu'on soit administrateur ou non.
  const [trimmed, setTrimmed] = useState(null); // { blob, seconds }
  const [trimming, setTrimming] = useState(false);
  const [image, setImage] = useState(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const imgUrl = useMemo(() => (image ? URL.createObjectURL(image) : ""), [image]);
  useEffect(
    () => () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    },
    [imgUrl]
  );

  function pickFile(f) {
    setFile(f);
    setTrimmed(null);
    setTrimming(!!f);
    setLabel(f ? niceSoundName(f.name) : "");
    setOk("");
    setErr("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!file || !label.trim()) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const fd = new FormData();
      if (trimmed) fd.append("clip", trimmed.blob, "extrait.wav");
      else fd.append("clip", file);
      fd.append("label", label.trim());
      if (image) fd.append("image", image, image.name);
      const d = await apiUpload("/admin/perroquet", fd, token);
      // Le contour revient dans la réponse : on affiche ce que le serveur a
      // mesuré. La confirmation qui compte n'est pas « ajouté », c'est « voilà
      // ce qu'il en a compris ».
      setOk(
        `« ${d.item.label} » ajouté — ${d.item.durationMs} ms, ${Math.round(
          d.item.voicedRatio * 100
        )} % mélodique.`
      );
      setFile(null);
      setTrimmed(null);
      setTrimming(false);
      setImage(null);
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      onAdded();
    } catch (e2) {
      setErr(e2.message || "Impossible d'ajouter ce son.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pq-admin-add" onSubmit={submit}>
      <label className={`pq-admin-file clickable ${file ? "has" : ""}`}>
        <Upload size={16} />
        <span>{file ? file.name : "Choisir un fichier audio"}</span>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          onChange={(e) => pickFile(e.target.files?.[0] || null)}
        />
      </label>

      {/* ---------- La découpe ----------
          Repliée dès qu'un extrait est validé : ce qui compte ensuite, c'est de
          nommer le son, pas de continuer à regarder la forme d'onde. */}
      {file && trimming && (
        <div className="pq-admin-trim">
          <AudioTrimmer
            file={file}
            // Quatre secondes : la borne que le serveur refuse au-delà
            // (routes/perroquetAdmin.js). Le rogneur ne doit pas pouvoir
            // fabriquer un extrait que l'envoi rejettera derrière.
            maxSeconds={4}
            onCancel={() => setTrimming(false)}
            onConfirm={(blob, seconds) => {
              setTrimmed({ blob, seconds });
              setTrimming(false);
            }}
          />
        </div>
      )}

      {file && !trimming && (
        <div className="pq-admin-idcard">
          <button
            type="button"
            className={`pq-admin-img clickable ${imgUrl ? "has" : ""}`}
            onClick={() => imgRef.current?.click()}
            title={imgUrl ? "Changer l'image" : "Ajouter une image (montrée à la révélation)"}
          >
            {imgUrl ? <img src={imgUrl} alt="" /> : <ImagePlus size={20} />}
          </button>
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
          <input
            className="pq-admin-in"
            placeholder="Nom — la réponse affichée (ex. « Le wahoo de Mario »)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
          <span className="pq-admin-cut">
            <Scissors size={13} />
            {trimmed ? <b>{trimmed.seconds.toFixed(2)} s</b> : "fichier entier"}
            <button type="button" className="admin-btn clickable" onClick={() => setTrimming(true)}>
              {trimmed ? "Redécouper" : "Rogner"}
            </button>
            {trimmed && (
              <button type="button" className="admin-btn clickable" onClick={() => setTrimmed(null)}>
                Annuler la découpe
              </button>
            )}
          </span>
        </div>
      )}

      <button className="admin-btn ok clickable" disabled={busy || !file || !label.trim()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
        Ajouter
      </button>

      {err && <p className="pq-admin-msg bad">{err}</p>}
      {ok && (
        <p className="pq-admin-msg good">
          <Check size={14} /> {ok}
        </p>
      )}
    </form>
  );
}

// ============================================================
//  Une ligne de la banque
// ============================================================
function ClipRow({ item, busy, onToggle, onDelete }) {
  const audioRef = useRef(null);
  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    []
  );

  // Sous 40 %, le son n'a pas grand-chose à imiter : accepté à l'envoi mais
  // signalé ici, parce qu'il donnera des scores erratiques.
  const thin = item.voicedRatio < 0.4;
  // Une moyenne basse sur un nombre de parties significatif : les joueurs n'y
  // arrivent pas. Sous 10 parties, c'est du bruit statistique.
  const hard = item.timesPlayed >= 10 && item.avgScore != null && item.avgScore < 30;

  return (
    <li className={`pq-admin-row ${item.active ? "" : "off"}`}>
      <button
        className="pq-admin-play clickable"
        onClick={() => {
          if (!audioRef.current) audioRef.current = new Audio(item.url);
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        }}
        aria-label={`Écouter ${item.label}`}
      >
        <Play size={15} />
      </button>

      {item.image && <img className="pq-admin-thumb" src={item.image} alt="" loading="lazy" />}

      <div className="pq-admin-main">
        <b>{item.label}</b>
        {item.game && <em>{item.game}</em>}
        {item.owner && <span className="pq-admin-owner">par {item.owner}</span>}
        <span className="pq-admin-meta">
          {(item.durationMs / 1000).toFixed(1)} s ·{" "}
          <i className={thin ? "warn" : ""}>{Math.round(item.voicedRatio * 100)} % mélodique</i>
          {item.timesPlayed > 0 && (
            <>
              {" "}
              · jouée {item.timesPlayed}×, moyenne{" "}
              <i className={hard ? "warn" : ""}>{item.avgScore}</i>
            </>
          )}
        </span>
        {(thin || hard) && (
          <span className="pq-admin-flag">
            <AlertTriangle size={12} />
            {thin
              ? "peu de hauteur à imiter — le score sera erratique"
              : "personne n'y arrive : le clip est peut-être mal découpé"}
          </span>
        )}
      </div>

      <button
        className="admin-btn clickable"
        onClick={onToggle}
        disabled={busy}
        title={item.active ? "Retirer du tirage" : "Remettre en service"}
      >
        {busy ? (
          <Loader2 size={14} className="spin" />
        ) : item.active ? (
          <Eye size={14} />
        ) : (
          <EyeOff size={14} />
        )}
      </button>
      <button
        className="admin-btn danger clickable"
        onClick={onDelete}
        disabled={busy}
        title="Supprimer définitivement"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
