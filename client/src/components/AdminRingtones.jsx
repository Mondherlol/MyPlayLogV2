import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  Loader2,
  Pause,
  Play,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { startRingtone } from "../lib/ringtone";

// ======================================================================
//  La banque de sonneries — administration
// ======================================================================
// Le seul endroit où l'on dépose les sonneries proposées à tout le monde
// (server/src/routes/ringtones.js). Les joueurs, eux, n'envoient que pour
// eux-mêmes : une banque commune ouverte à l'envoi deviendrait en trois jours
// une collection de sons désagréables à modérer.
//
// -------------------------------------------- DÉSACTIVER PLUTÔT QUE SUPPRIMER
// C'est la distinction que cet écran doit rendre évidente, parce qu'elle n'est
// pas rattrapable :
//
//   DÉSACTIVER  la sonnerie sort de la liste, mais continue de sonner chez ceux
//               qui l'avaient déjà choisie. C'est le geste normal.
//   SUPPRIMER   le fichier est effacé, et tous ceux qui l'avaient repassent à la
//               sonnerie par défaut. C'est pour les erreurs d'envoi.
//
// D'où l'interrupteur bien en vue, et la corbeille en retrait derrière une
// confirmation.
// La coquille est celle de TOUS les autres panneaux du panel (`admin-card`) :
// un écran d'administration qui invente sa propre carte se voit tout de suite,
// et pour rien.
export default function AdminRingtones({ token }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const stopRef = useRef(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch("/ringtones/admin", { token });
      setItems(d.items || []);
    } catch (e) {
      setErr(e.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => () => stopRef.current?.(), []);

  const preview = useCallback(
    (item) => {
      if (playing === item.id) {
        stopRef.current?.();
        stopRef.current = null;
        setPlaying(null);
        return;
      }
      stopRef.current?.();
      // Le MÊME code que la vraie sonnerie, boucle comprise : écouter un extrait
      // joué autrement que ce que les gens entendront ne prouverait rien.
      stopRef.current = startRingtone({ url: item.url });
      setPlaying(item.id);
    },
    [playing]
  );

  const send = useCallback(
    async (file) => {
      if (!file) return;
      setBusy("upload");
      setErr("");
      try {
        const fd = new FormData();
        fd.append("ringtone", file);
        const d = await apiUpload("/ringtones/admin", fd, token);
        setItems((cur) => [...cur, d.item]);
      } catch (e) {
        setErr(e.message || "Envoi impossible.");
      } finally {
        setBusy("");
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [token]
  );

  const patch = useCallback(
    async (id, body) => {
      setBusy(id);
      setErr("");
      try {
        const d = await apiFetch(`/ringtones/admin/${id}`, {
          method: "PATCH",
          token,
          body,
        });
        setItems((cur) => cur.map((x) => (x.id === id ? d.item : x)));
      } catch (e) {
        setErr(e.message || "Modification impossible.");
      } finally {
        setBusy("");
      }
    },
    [token]
  );

  const remove = useCallback(
    async (id) => {
      setBusy(id);
      try {
        await apiFetch(`/ringtones/admin/${id}`, { method: "DELETE", token });
        setItems((cur) => cur.filter((x) => x.id !== id));
        setConfirm(null);
      } catch (e) {
        setErr(e.message || "Suppression impossible.");
      } finally {
        setBusy("");
      }
    },
    [token]
  );

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Bell size={19} />
        </span>
        <div className="admin-card-titles">
          <h2>Sonneries</h2>
          <p>
            Les sonneries proposées à tout le monde dans Paramètres → Appels.
            30 s et 3 Mo maximum ; au-delà le fichier est refusé.
          </p>
        </div>
      </div>

      {err && <p className="rt-err">{err}</p>}

      <div className="rt-upload">
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => send(e.target.files?.[0])}
        />
        <button
          type="button"
          className="rt-upload-btn clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy === "upload"}
        >
          {busy === "upload" ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          Ajouter une sonnerie
        </button>
        <span className="rt-upload-hint">
          Le nom du fichier devient le titre — modifiable ensuite.
        </span>
      </div>

      {loading ? (
        <div className="rt-state">
          <Loader2 size={20} className="spin" />
        </div>
      ) : !items.length ? (
        <p className="rt-empty">
          <b>Aucune sonnerie déposée — les appels arrivent donc sans son.</b> La
          modale prend l'écran et fait vibrer les téléphones, mais rien ne se
          fait entendre tant que cette liste est vide. La première sonnerie
          envoyée devient automatiquement celle de l'app.
        </p>
      ) : (
        <ul className="rt-list admin">
          {items.map((it) => (
            <li key={it.id} className={`rt-row ${it.active ? "" : "off"}`}>
              <button
                type="button"
                className={`rt-play clickable ${playing === it.id ? "on" : ""}`}
                onClick={() => preview(it)}
                aria-label="Écouter"
              >
                {playing === it.id ? <Pause size={15} /> : <Play size={15} />}
              </button>

              {/* L'étoile désigne LA sonnerie de l'app : celle qu'entendent
                  tous ceux qui n'ont rien choisi. Une seule à la fois — cocher
                  celle-ci démarque l'autre côté serveur. */}
              <button
                type="button"
                className={`rt-star clickable ${it.isDefault ? "on" : ""}`}
                onClick={() => !it.isDefault && patch(it.id, { isDefault: true })}
                disabled={busy === it.id || it.isDefault}
                title={
                  it.isDefault
                    ? "C'est la sonnerie par défaut de l'app"
                    : "En faire la sonnerie par défaut"
                }
                aria-label="Sonnerie par défaut"
              >
                <Star size={15} />
              </button>

              <span className="rt-txt admin">
                {/* Le titre s'édite sur place : renommer une sonnerie est le
                    geste le plus fréquent de cet écran (les noms de fichiers
                    sont rarement présentables), et une modale pour un champ
                    unique serait trois clics de trop. */}
                <input
                  className="rt-name"
                  defaultValue={it.name}
                  maxLength={60}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== it.name &&
                    patch(it.id, { name: e.target.value.trim() })
                  }
                />
                <em>
                  {it.duration ? `${it.duration.toFixed(1)} s` : "durée inconnue"}
                  {it.isDefault && " · sonnerie de l'app"}
                  {!it.active && " · retirée de la liste"}
                </em>
              </span>

              <button
                type="button"
                className={`rt-sw clickable ${it.active ? "on" : ""}`}
                onClick={() => patch(it.id, { active: !it.active })}
                disabled={busy === it.id || it.isDefault}
                role="switch"
                aria-checked={it.active}
                title={it.active ? "Retirer de la liste" : "Proposer à nouveau"}
              >
                <i />
              </button>

              {confirm === it.id ? (
                <span className="rt-confirm">
                  <button
                    type="button"
                    className="rt-del yes clickable"
                    onClick={() => remove(it.id)}
                    disabled={busy === it.id}
                    title="Supprimer définitivement"
                  >
                    {busy === it.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  </button>
                  <button
                    type="button"
                    className="rt-del clickable"
                    onClick={() => setConfirm(null)}
                    title="Annuler"
                  >
                    <X size={14} />
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="rt-del clickable"
                  onClick={() => setConfirm(it.id)}
                  title="Supprimer (le fichier est effacé)"
                  aria-label="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
