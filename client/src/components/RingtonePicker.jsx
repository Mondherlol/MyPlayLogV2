import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, Loader2, Pause, Play, Trash2, Upload } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch, apiUpload } from "../lib/api";
import { startRingtone } from "../lib/ringtone";

// ======================================================================
//  Choisir sa sonnerie
// ======================================================================
// Trois familles dans une seule liste, parce qu'elles répondent à la même
// question — « qu'est-ce que j'entends quand on m'appelle ? » :
//
//   la sonnerie par défaut de l'app (celle que l'administration a désignée) ;
//   les autres sonneries de la banque commune ;
//   la sienne.
//
// ---------------------------------------------------- ON ÉCOUTE AVANT DE CHOISIR
// Chaque ligne a son bouton d'écoute, et c'est le cœur de l'écran : personne ne
// choisit une sonnerie sur son nom. L'aperçu passe par LE MÊME CODE que la vraie
// sonnerie (lib/ringtone.js), boucle comprise — écouter un extrait joué
// autrement que ce qu'on entendra vraiment ne prouverait rien.
//
// UN SEUL APERÇU À LA FOIS. Deux sonneries qui se superposent, c'est du bruit,
// et on n'entend plus celle qu'on est en train d'essayer.
//
// ------------------------------------------------------- le choix est immédiat
// Pas de bouton « Enregistrer ». Cliquer une ligne LA choisit — c'est un
// réglage unique parmi une liste, exactement le geste d'un bouton radio, et une
// confirmation en plus n'apporterait qu'un état « modifié, pas encore appliqué »
// à tenir et à expliquer.
export default function RingtonePicker() {
  const { token, user, updateUser } = useAuth();
  const [presets, setPresets] = useState([]);
  const [fallback, setFallback] = useState(null); // la sonnerie par défaut de l'app
  const [mine, setMine] = useState(user?.ringtone || { source: "default" });
  const [maxSeconds, setMaxSeconds] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(null);
  const stopRef = useRef(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch("/ringtones", { token });
      setPresets(d.presets || []);
      setFallback(d.fallback || null);
      setMine(d.mine || { source: "default" });
      setMaxSeconds(d.maxSeconds || 30);
    } catch (e) {
      setErr(e.message || "Impossible de charger les sonneries.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // L'aperçu ne survit pas à la sortie de l'écran : une sonnerie qui continue
  // de jouer après qu'on a changé d'onglet est le genre de détail qu'on met dix
  // minutes à comprendre.
  const stopPreview = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => () => stopRef.current?.(), []);

  const preview = useCallback(
    (id, pref) => {
      if (playing === id) return stopPreview();
      stopRef.current?.();
      stopRef.current = startRingtone(pref);
      setPlaying(id);
    },
    [playing, stopPreview]
  );

  const choose = useCallback(
    async (source, presetId) => {
      setBusy(presetId || source);
      setErr("");
      try {
        const d = await apiFetch("/ringtones/mine", {
          method: "PUT",
          token,
          body: { source, presetId },
        });
        setMine(d.ringtone);
        // Le compte en mémoire suit : c'est LUI que lit la modale d'appel
        // (context/CallContext.jsx), pas cet écran.
        updateUser({ ringtone: d.ringtone });
      } catch (e) {
        setErr(e.message || "Réglage impossible.");
      } finally {
        setBusy("");
      }
    },
    [token, updateUser]
  );

  const sendFile = useCallback(
    async (file) => {
      if (!file) return;
      setBusy("upload");
      setErr("");
      try {
        const fd = new FormData();
        fd.append("ringtone", file);
        const d = await apiUpload("/ringtones/mine", fd, token);
        setMine(d.ringtone);
        updateUser({ ringtone: d.ringtone });
      } catch (e) {
        setErr(e.message || "Envoi impossible.");
      } finally {
        setBusy("");
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [token, updateUser]
  );

  const dropFile = useCallback(async () => {
    setBusy("drop");
    try {
      const d = await apiFetch("/ringtones/mine/file", { method: "DELETE", token });
      setMine(d.ringtone);
      updateUser({ ringtone: d.ringtone });
    } catch (e) {
      setErr(e.message || "Suppression impossible.");
    } finally {
      setBusy("");
    }
  }, [token, updateUser]);

  if (loading)
    return (
      <div className="rt-state">
        <Loader2 size={20} className="spin" />
      </div>
    );

  return (
    <div className="rt-wrap">
      {err && <p className="rt-err">{err}</p>}

      <ul className="rt-list">
        {/* La sonnerie par défaut de l'app, en tête. C'est une VRAIE sonnerie
            de la banque : elle s'écoute comme les autres, et son nom est celui
            que l'administration lui a donné. */}
        <RingRow
          title={fallback ? `Par défaut · ${fallback.name}` : "Par défaut"}
          sub={
            fallback
              ? "La sonnerie de MyPlayLog, choisie par l'équipe."
              : "Aucune sonnerie disponible pour l'instant — les appels arriveront sans son."
          }
          picked={mine.source === "default"}
          busy={busy === "default"}
          playing={playing === "default"}
          onPlay={() => fallback && preview("default", { url: fallback.url })}
          onPick={() => choose("default")}
          Icon={Bell}
        />

        {presets
          .filter((p) => !fallback || p.id !== fallback.id)
          .map((p) => (
          <RingRow
            key={p.id}
            title={p.name}
            sub={p.duration ? `${p.duration.toFixed(1)} s` : "Sonnerie proposée"}
            picked={mine.source === "preset" && mine.preset === p.id}
            busy={busy === p.id}
            playing={playing === p.id}
            onPlay={() => preview(p.id, { url: p.url })}
            onPick={() => choose("preset", p.id)}
            Icon={Bell}
          />
        ))}

        {mine.file && (
          <RingRow
            title={mine.name || "Ma sonnerie"}
            sub="Ton fichier"
            picked={mine.source === "custom"}
            busy={busy === "custom"}
            playing={playing === "custom"}
            onPlay={() => preview("custom", { url: mine.file })}
            onPick={() => choose("custom")}
            onDelete={dropFile}
            deleting={busy === "drop"}
            Icon={Bell}
          />
        )}
      </ul>

      <div className="rt-upload">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => sendFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="rt-upload-btn clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy === "upload"}
        >
          {busy === "upload" ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          {mine.file ? "Remplacer ma sonnerie" : "Envoyer ma sonnerie"}
        </button>
        <span className="rt-upload-hint">
          mp3, m4a, ogg ou wav · {maxSeconds} s et 3 Mo maximum · elle tourne en
          boucle tant que ça sonne
        </span>
      </div>

      <p className="rt-note">
        C'est ce que <b>tu</b> entends quand on t'appelle. Personne d'autre ne
        l'entend, et personne ne peut t'imposer la sienne.
      </p>
    </div>
  );
}

function RingRow({
  title,
  sub,
  picked,
  busy,
  playing,
  onPlay,
  onPick,
  onDelete,
  deleting,
  Icon,
}) {
  return (
    <li className={`rt-row ${picked ? "picked" : ""}`}>
      {/* Le bouton d'écoute est SÉPARÉ de la sélection : essayer une sonnerie
          ne doit pas la choisir, sinon on ne peut plus comparer sans changer
          de réglage à chaque essai. */}
      <button
        type="button"
        className={`rt-play clickable ${playing ? "on" : ""}`}
        onClick={onPlay}
        title={playing ? "Arrêter" : "Écouter"}
        aria-label={playing ? "Arrêter" : "Écouter"}
      >
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>

      <button type="button" className="rt-pick clickable" onClick={onPick} disabled={busy}>
        <span className="rt-ico">
          <Icon size={16} />
        </span>
        <span className="rt-txt">
          <b>{title}</b>
          <em>{sub}</em>
        </span>
        <span className="rt-mark">
          {busy ? <Loader2 size={15} className="spin" /> : picked ? <Check size={16} /> : null}
        </span>
      </button>

      {onDelete && (
        <button
          type="button"
          className="rt-del clickable"
          onClick={onDelete}
          disabled={deleting}
          title="Supprimer ce fichier"
          aria-label="Supprimer ce fichier"
        >
          {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
        </button>
      )}
    </li>
  );
}
