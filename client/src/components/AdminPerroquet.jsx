import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Music,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import AudioTrimmer from "./AudioTrimmer";
import { niceSoundName } from "../lib/soundTake";
import { downloadFile } from "../lib/download";

// ======================================================================
//  Onglet « Perroquet » — deux mondes, deux sous-onglets
// ======================================================================
// LA BANQUE, ce qu'on fait écouter aux joueurs. Le seul endroit où elle se
// garnit (cf. server/src/routes/perroquetAdmin.js). Il y avait un script de
// seed, il a été retiré : deux chemins vers la même collection, c'était deux
// jeux de règles à garder d'accord, et celui du script exigeait un accès au
// serveur pour ajouter un cri.
//
// LES ESSAIS DES JOUEURS, ce qu'ils ont crié dedans. Rien à voir : on ne les
// modère pas, on les ARCHIVE (server/src/models/PerroquetTake.js). Ils sont là
// pour le wrapped annuel — « ton meilleur cri de l'année » suppose qu'on ait
// gardé les cris — et, en attendant, pour pouvoir écouter, récupérer ou effacer
// le fichier de quelqu'un sans aller fouiller dans quelle partie il était.
//
// Les deux listes ne se mélangent pas parce qu'on n'y vient pas pour la même
// raison : dans l'une on décide si un son est imitable, dans l'autre on écoute
// des gens.
const SUBS = [
  { key: "bank", label: "Banque de sons", Icon: Music },
  { key: "takes", label: "Sons des joueurs", Icon: Users },
];

export default function AdminPerroquet({ token }) {
  const [sub, setSub] = useState("bank");

  return (
    <div className="admin-section admin-perroquet">
      <header className="admin-section-head">
        <h2>Le Perroquet</h2>
        <p>
          Les sons à imiter d'un côté, ce que les joueurs en ont fait de l'autre.
        </p>
      </header>

      <div className="pq-admin-subs">
        {SUBS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`pq-admin-sub clickable ${sub === key ? "on" : ""}`}
            onClick={() => setSub(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {sub === "bank" ? <BankPanel token={token} /> : <TakesPanel token={token} />}
    </div>
  );
}

// ======================================================================
//  Sous-onglet 1 — la banque
// ======================================================================
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

function BankPanel({ token }) {
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const player = usePlayer();

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

  const replace = (item) =>
    setData((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === item.id ? item : x)),
    }));

  async function patch(item, body) {
    setBusy(item.id);
    try {
      const d = await apiFetch(`/admin/perroquet/${item.id}`, {
        method: "PATCH",
        token,
        body,
      });
      replace(d.item);
      setErr("");
    } catch (e) {
      setErr(e.message || "Modification impossible.");
    } finally {
      setBusy("");
    }
  }

  async function remove(item) {
    if (!window.confirm(`Supprimer « ${item.label} » de la banque ?`)) return;
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

  // Le recalcul de toute la banque. La route existait sans bouton, et il en
  // fallait un : les contours sont mesurés UNE FOIS puis stockés (cf.
  // models/SoundClip.js), donc chaque réglage de lib/soundContour.js laisse la
  // banque avec des mesures faites par l'ancienne version — les scores se
  // calculent alors contre des cibles périmées, sans que rien ne le signale.
  async function recompute() {
    if (!window.confirm("Remesurer tous les sons de la banque ? (un ffmpeg par son)"))
      return;
    setBusy("recompute");
    try {
      const d = await apiFetch("/admin/perroquet/recompute", { method: "POST", token });
      await load();
      setErr(
        d.failed?.length
          ? `${d.done} son(s) remesuré(s) ; échec sur : ${d.failed.join(", ")}`
          : ""
      );
    } catch (e) {
      setErr(e.message || "Recalcul impossible.");
    } finally {
      setBusy("");
    }
  }

  const c = data?.counts;

  return (
    <>
      <p className="pq-admin-lead">
        Les sons que les joueurs doivent imiter à la voix. Un bon son est{" "}
        <b>court</b> (0,3 à 2 s), <b>mélodique</b> — un cri, pas un fracas — et
        reconnaissable. Le serveur refuse à l'envoi ce qui n'a pas de hauteur à
        imiter&nbsp;: le barème n'aurait rien à mesurer et distribuerait les
        points au hasard.
      </p>

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
          <button
            className="admin-btn clickable"
            onClick={recompute}
            disabled={!!busy}
            title="Remesurer les contours de toute la banque : à faire après chaque réglage du barème"
          >
            {busy === "recompute" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Remesurer les contours
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
              token={token}
              busy={busy === it.id}
              player={player}
              onToggle={() => patch(it, { active: !it.active })}
              onDelete={() => remove(it)}
              onSaved={replace}
            />
          ))}
        </ul>
      )}
    </>
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
        <>
          {/* La fiche d'identité du son : image + nom, exactement celle que
              voient les joueurs dans leur librairie (components/SoundLibrary
              .jsx). Le même objet se remplit de la même façon des deux côtés. */}
          <IdCard image={image} onImage={setImage} label={label} onLabel={setLabel} />
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
        </>
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
//  Image + nom — la fiche d'identité d'un son
// ============================================================
// Partagée par le dépôt et l'édition, parce qu'un son se nomme et s'illustre de
// la même façon qu'on le crée ou qu'on le corrige. `image` vaut un File (on
// vient d'en choisir un), une chaîne (l'URL déjà en base) ou rien.
function IdCard({ image, onImage, label, onLabel, autoFocus = false }) {
  const imgRef = useRef(null);
  // Un File se prévisualise par objet-URL, révoqué au changement : sans ça
  // chaque essai d'image laisse son blob en mémoire jusqu'au rechargement.
  const preview = useMemo(
    () => (image instanceof File ? URL.createObjectURL(image) : image || ""),
    [image]
  );
  useEffect(
    () => () => {
      if (image instanceof File && preview) URL.revokeObjectURL(preview);
    },
    [image, preview]
  );

  return (
    <div className="pq-admin-idcard">
      <button
        type="button"
        className={`pq-admin-img clickable ${preview ? "has" : ""}`}
        onClick={() => imgRef.current?.click()}
        title={preview ? "Changer l'image" : "Ajouter une image (montrée à la révélation)"}
      >
        {preview ? <img src={preview} alt="" /> : <ImagePlus size={20} />}
        <span className="pq-admin-img-hint">
          <ImagePlus size={15} />
        </span>
      </button>
      {preview && (
        <button
          type="button"
          className="pq-admin-img-x clickable"
          // `null` (pas de fichier) et `""` (retirer celle qui est en base) ne
          // veulent pas dire la même chose à l'édition : le second doit atteindre
          // le serveur, le premier ne demande rien.
          onClick={() => onImage("")}
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
          const f = e.target.files?.[0];
          if (f) onImage(f);
          e.target.value = "";
        }}
      />
      <input
        className="pq-admin-in"
        placeholder="Nom — la réponse affichée (ex. « Le wahoo de Mario »)"
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        maxLength={80}
        autoFocus={autoFocus}
      />
    </div>
  );
}

// ============================================================
//  Une ligne de la banque
// ============================================================
function ClipRow({ item, token, busy, player, onToggle, onDelete, onSaved }) {
  const [editing, setEditing] = useState(false);
  const playing = player.url === item.url;

  // Sous 40 %, le son n'a pas grand-chose à imiter : accepté à l'envoi mais
  // signalé ici, parce qu'il donnera des scores erratiques.
  const thin = item.voicedRatio < 0.4;
  // Une moyenne basse sur un nombre de parties significatif : les joueurs n'y
  // arrivent pas. Sous 10 parties, c'est du bruit statistique.
  const hard = item.timesPlayed >= 10 && item.avgScore != null && item.avgScore < 30;

  return (
    <li className={`pq-admin-row ${item.active ? "" : "off"} ${editing ? "editing" : ""}`}>
      <div className="pq-admin-rowline">
        <button
          className={`pq-admin-play clickable ${playing ? "on" : ""}`}
          onClick={() => player.toggle(item.url)}
          aria-label={playing ? "Arrêter" : `Écouter ${item.label}`}
        >
          {playing ? <Square size={13} /> : <Play size={15} />}
        </button>

        {item.image ? (
          <img className="pq-admin-thumb" src={item.image} alt="" loading="lazy" />
        ) : (
          <span className="pq-admin-thumb none" title="Pas d'illustration">
            <ImagePlus size={15} />
          </span>
        )}

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

        <div className="pq-admin-acts">
          <button
            className="admin-btn icon clickable"
            onClick={() => downloadFile(item.url, item.label)}
            title="Télécharger le fichier"
          >
            <Download size={14} />
          </button>
          <button
            className={`admin-btn icon clickable ${editing ? "on" : ""}`}
            onClick={() => setEditing((v) => !v)}
            title="Modifier le nom, l'image, la difficulté"
          >
            <Pencil size={14} />
          </button>
          <button
            className="admin-btn icon clickable"
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
            className="admin-btn icon danger clickable"
            onClick={onDelete}
            disabled={busy}
            title="Supprimer définitivement"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <ClipEdit
          item={item}
          token={token}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            onSaved(saved);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

// ============================================================
//  Corriger une fiche
// ============================================================
// L'AUDIO N'EST PAS MODIFIABLE ICI, et ce n'est pas un oubli : changer le
// fichier obligerait à recalculer le contour, et les statistiques de terrain
// accumulées (« jouée 40×, moyenne 62 ») porteraient alors sur un son qui n'est
// plus celui qu'on écoute. Pour un autre son, on en ajoute un et on éteint
// l'ancien.
//
// Le reste, si : un son déposé sans illustration restait nu à vie, et la seule
// façon de lui en donner une était de le supprimer pour le redéposer — donc de
// perdre ses statistiques.
function ClipEdit({ item, token, onClose, onSaved }) {
  const [label, setLabel] = useState(item.label);
  // `null` = on ne touche pas à l'image ; un File = on la remplace ; "" = on la
  // retire. Trois états distincts, parce que « ne rien dire » et « effacer » ne
  // peuvent pas être le même message pour le serveur.
  const [image, setImage] = useState(null);
  const [game, setGame] = useState(item.game || "");
  const [difficulty, setDifficulty] = useState(item.difficulty || 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const shown = image === null ? item.image || "" : image;

  async function save(e) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("label", label.trim());
      fd.append("game", game.trim());
      fd.append("difficulty", String(difficulty));
      if (image instanceof File) fd.append("image", image, image.name);
      else if (image === "") fd.append("removeImage", "1");
      const d = await apiUpload(`/admin/perroquet/${item.id}`, fd, token, "PATCH");
      onSaved(d.item);
    } catch (e2) {
      setErr(e2.message || "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pq-admin-edit" onSubmit={save}>
      <IdCard image={shown} onImage={setImage} label={label} onLabel={setLabel} autoFocus />
      <div className="pq-admin-edit-row">
        <input
          className="pq-admin-in"
          placeholder="Jeu d'origine (facultatif)"
          value={game}
          onChange={(e) => setGame(e.target.value)}
          maxLength={80}
        />
        <label className="pq-admin-diff">
          Difficulté
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="pq-admin-edit-note">L'audio ne se remplace pas.</span>
        <button type="button" className="admin-btn clickable" onClick={onClose}>
          Annuler
        </button>
        <button className="admin-btn ok clickable" disabled={busy || !label.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
          Enregistrer
        </button>
      </div>
      {err && <p className="pq-admin-msg bad">{err}</p>}
    </form>
  );
}

// ======================================================================
//  Sous-onglet 2 — les essais des joueurs
// ======================================================================
// Un joueur par ligne, dépliable. Le serveur groupe (cf. GET /attempts) : rendre
// les essais à plat, ce sont des milliers de lignes dont on ne veut voir qu'une
// poignée, et le seul tri utile est « qui a joué récemment ».
//
// Pour l'instant on ne fait qu'écouter, récupérer et effacer. La suite, c'est le
// wrapped annuel : ces fichiers sont ce qui permettra de rendre à chacun son
// meilleur cri de l'année.
function TakesPanel({ token }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const player = usePlayer();

  const load = useCallback(async () => {
    try {
      const d = await apiFetch("/admin/perroquet/attempts", { token });
      setData(d);
      setErr("");
    } catch (e) {
      setErr(e.message || "Essais illisibles.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <p className="pq-admin-lead">
        Chaque imitation notée est archivée&nbsp;: le fichier, le son visé et le
        score. Le versus aussi — les salons s'auto-détruisent au bout de six
        heures, l'archive, non. Elle servira au <b>wrapped annuel</b>&nbsp;; en
        attendant, elle sert à écouter et à faire le ménage.
      </p>

      {err && <p className="admin-error">{err}</p>}

      {!data ? (
        <p className="admin-loading">
          <Loader2 size={16} className="spin" /> Chargement…
        </p>
      ) : !data.users.length ? (
        <p className="admin-empty">
          Personne n'a encore joué. Les essais apparaîtront ici dès la première
          manche notée.
        </p>
      ) : (
        <>
          <div className="admin-stats-row">
            <span className="admin-stat">
              <b>{data.users.length}</b> joueur{data.users.length > 1 ? "s" : ""}
            </span>
            <span className="admin-stat">
              <b>{data.total}</b> essai{data.total > 1 ? "s" : ""} archivé
              {data.total > 1 ? "s" : ""}
            </span>
          </div>

          <ul className="pq-admin-users">
            {data.users.map((u) => (
              <UserTakes
                key={u.id}
                user={u}
                token={token}
                player={player}
                open={open === u.id}
                onToggle={() => setOpen((s) => (s === u.id ? "" : u.id))}
                onPurged={load}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function UserTakes({ user, token, player, open, onToggle, onPurged }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  // Chargé à l'ouverture seulement, et une seule fois : déplier trente joueurs
  // pour en écouter un ferait trente requêtes dont vingt-neuf pour rien.
  useEffect(() => {
    if (!open || items) return;
    let alive = true;
    apiFetch(`/admin/perroquet/attempts/${user.id}`, { token })
      .then((d) => alive && setItems(d.items))
      .catch((e) => alive && setErr(e.message || "Essais illisibles."));
    return () => {
      alive = false;
    };
  }, [open, items, token, user.id]);

  async function remove(t) {
    setBusy(t.id);
    try {
      await apiFetch(`/admin/perroquet/attempts/${t.id}`, { method: "DELETE", token });
      setItems((s) => s.filter((x) => x.id !== t.id));
      setErr("");
    } catch (e) {
      setErr(e.message || "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }

  async function purge() {
    if (
      !window.confirm(
        `Effacer les ${user.takes} enregistrements de ${user.username} ? Les fichiers partent du serveur.`
      )
    )
      return;
    setBusy("all");
    try {
      await apiFetch(`/admin/perroquet/attempts/user/${user.id}`, {
        method: "DELETE",
        token,
      });
      await onPurged();
    } catch (e) {
      setErr(e.message || "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }

  return (
    <li className={`pq-admin-user ${open ? "open" : ""}`}>
      <button className="pq-admin-user-head clickable" onClick={onToggle}>
        <span className={`pq-admin-av ${user.gone ? "gone" : ""}`}>
          {user.avatar ? (
            <img src={user.avatar} alt="" loading="lazy" />
          ) : (
            user.username.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="pq-admin-user-main">
          <b>{user.username}</b>
          <span className="pq-admin-meta">
            {user.takes} essai{user.takes > 1 ? "s" : ""} · moyenne {user.avg} ·
            meilleur <i>{user.best}</i> · {ago(user.last)}
          </span>
        </span>
        <ChevronDown size={16} className="pq-admin-chev" />
      </button>

      {open && (
        <div className="pq-admin-user-body">
          {err && <p className="pq-admin-msg bad">{err}</p>}
          {!items ? (
            <p className="admin-loading">
              <Loader2 size={15} className="spin" /> Chargement…
            </p>
          ) : !items.length ? (
            <p className="admin-empty">Plus rien pour ce joueur.</p>
          ) : (
            <>
              <ul className="pq-admin-takes">
                {items.map((t) => (
                  <TakeRow
                    key={t.id}
                    take={t}
                    player={player}
                    busy={busy === t.id}
                    onDelete={() => remove(t)}
                  />
                ))}
              </ul>
              <button
                className="admin-btn danger clickable"
                onClick={purge}
                disabled={busy === "all"}
              >
                {busy === "all" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                Tout effacer pour ce joueur
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function TakeRow({ take, player, busy, onDelete }) {
  const playing = player.url === take.url;
  const refPlaying = player.url === take.clipUrl;

  return (
    <li className={`pq-admin-take band-${take.band}`}>
      <button
        className={`pq-admin-play clickable ${playing ? "on" : ""}`}
        onClick={() => player.toggle(take.url)}
        aria-label={playing ? "Arrêter" : "Écouter l'imitation"}
      >
        {playing ? <Square size={13} /> : <Play size={15} />}
      </button>

      {take.image ? (
        <img className="pq-admin-thumb" src={take.image} alt="" loading="lazy" />
      ) : null}

      <span className="pq-admin-main">
        <b>{take.label}</b>
        <span className="pq-admin-meta">
          {take.mode === "versus" ? "versus" : "solo"} · {ago(take.at)}
        </span>
      </span>

      <span className="pq-admin-score">{take.score}</span>

      {/* Le son d'origine : sans lui on entend un cri sans savoir ce qu'il
          visait, et c'est justement la comparaison qui dit si l'essai est bon. */}
      {take.clipUrl && (
        <button
          className={`admin-btn icon clickable ${refPlaying ? "on" : ""}`}
          onClick={() => player.toggle(take.clipUrl)}
          title="Écouter le son d'origine"
        >
          <Music size={14} />
        </button>
      )}
      <button
        className="admin-btn icon clickable"
        onClick={() => downloadFile(take.url, `${take.label}-essai`)}
        title="Télécharger l'enregistrement"
      >
        <Download size={14} />
      </button>
      <button
        className="admin-btn icon danger clickable"
        onClick={onDelete}
        disabled={busy}
        title="Effacer cet enregistrement"
      >
        {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
      </button>
    </li>
  );
}

// ============================================================
//  Un seul lecteur pour tout l'onglet
// ============================================================
// Un `new Audio()` par bouton, c'est ce qu'il y avait avant : cliquer sur trois
// lignes faisait crier trois sons en même temps, ce qui est exactement l'inverse
// de ce qu'on vient faire ici — comparer deux enregistrements. Une seule
// instance, et l'URL en cours sert aussi à colorer la ligne qui joue.
function usePlayer() {
  const ref = useRef(null);
  const [url, setUrl] = useState("");

  useEffect(
    () => () => {
      ref.current?.pause();
      ref.current = null;
    },
    []
  );

  const toggle = useCallback(
    (next) => {
      if (!next) return;
      if (!ref.current) {
        ref.current = new Audio();
        ref.current.addEventListener("ended", () => setUrl(""));
      }
      const a = ref.current;
      if (a.src === next && !a.paused) {
        a.pause();
        setUrl("");
        return;
      }
      if (a.src !== next) a.src = next;
      a.currentTime = 0;
      a.play().then(() => setUrl(next)).catch(() => setUrl(""));
    },
    []
  );

  return { url, toggle };
}

// Le même repère de temps que le reste du panneau : « il y a 3 j » suffit, une
// date complète ferait trois fois la largeur pour une information qu'on ne lit
// pas au jour près.
function ago(date) {
  if (!date) return "—";
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 2592000) return `il y a ${Math.floor(s / 86400)} j`;
  return new Date(date).toLocaleDateString("fr-FR");
}
