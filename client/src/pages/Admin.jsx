import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Shield,
  Trophy,
  Check,
  Loader2,
  ExternalLink,
  Link2Off,
  Sparkles,
  Plus,
  Trash2,
  Pencil,
  EyeOff,
  ImagePlus,
  X,
  Send,
  Users,
  Search,
  Crown,
  Gamepad2,
  RefreshCw,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PN_ICONS } from "../components/PatchnotePopup";

export default function Admin() {
  const { token, updateUser } = useAuth();
  return (
    <div className="admin-page">
      <header className="admin-head">
        <span className="admin-head-icon">
          <Shield size={22} />
        </span>
        <div>
          <h1>Admin</h1>
          <p>Réglages avancés de ton compte.</p>
        </div>
      </header>

      <PsnManager token={token} updateUser={updateUser} />
      <PsnRequestsManager token={token} />
      <UsersManager token={token} />
      <PatchnoteManager token={token} />
    </div>
  );
}

// ======================================================================
//  Gestion des utilisateurs du site (liste + suppression) — admin only
// ======================================================================
function timeAgo(date) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(date).toLocaleDateString("fr-FR");
}

function UsersManager({ token }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [deleting, setDeleting] = useState(null); // id en cours de suppression

  function load(search = "") {
    setLoading(true);
    apiFetch(`/admin/users${search ? `?q=${encodeURIComponent(search)}` : ""}`, { token })
      .then((d) => {
        setUsers(d.users || []);
        setAllowed(true);
      })
      .catch((e) => {
        if (/administrateur/i.test(e.message)) setAllowed(false);
        else setErr(e.message);
      })
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Recherche débattue (300 ms) côté serveur.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function remove(u) {
    if (
      !confirm(
        `Supprimer définitivement « ${u.username} » ?\n\nToutes ses données (jeux, listes, avis, republications, notifications, abonnements…) seront effacées. Cette action est irréversible.`
      )
    )
      return;
    setDeleting(u.id);
    setErr(null);
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: "DELETE", token });
      setUsers((list) => list.filter((x) => x.id !== u.id));
    } catch (e) {
      setErr(e.message);
    } finally {
      setDeleting(null);
    }
  }

  if (!allowed) return null;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Users size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Utilisateurs</h2>
          <p>
            Tous les comptes inscrits sur le site. Recherche par pseudo ou email,
            consulte un profil ou supprime un compte.
          </p>
        </div>
        {!loading && (
          <span className="psn-status on">
            {users.length} compte{users.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="au-search">
        <Search size={16} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un pseudo ou un email…"
        />
        {q && (
          <button className="au-search-clear clickable" onClick={() => setQ("")}>
            <X size={15} />
          </button>
        )}
      </div>

      {err && <p className="psn-err">{err}</p>}

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : users.length === 0 ? (
        <p className="pn-admin-empty">Aucun utilisateur trouvé.</p>
      ) : (
        <div className="au-list">
          {users.map((u) => (
            <div className="au-row" key={u.id}>
              <Link to={`/u/${u.username}`} className="au-avatar clickable" title="Voir le profil">
                {u.avatar ? (
                  <img src={u.avatar} alt="" />
                ) : (
                  <span className="au-avatar-fallback">
                    {u.username?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </Link>
              <div className="au-info">
                <div className="au-name-row">
                  <Link to={`/u/${u.username}`} className="au-name clickable">
                    {u.username}
                  </Link>
                  {u.isAdmin && (
                    <span className="au-admin-badge" title="Administrateur">
                      <Crown size={12} /> Admin
                    </span>
                  )}
                </div>
                <span className="au-email">{u.email}</span>
                <span className="au-meta">
                  <Gamepad2 size={12} /> {u.gameCount} jeu{u.gameCount > 1 ? "x" : ""}
                  {" · "}
                  {u.followersCount} abonné{u.followersCount > 1 ? "s" : ""}
                  {" · inscrit le "}
                  {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                  {u.lastSeenAt ? ` · vu ${timeAgo(u.lastSeenAt)}` : ""}
                </span>
              </div>
              <div className="au-actions">
                <Link
                  to={`/u/${u.username}`}
                  className="icon-btn clickable"
                  title="Voir le profil"
                >
                  <ExternalLink size={16} />
                </Link>
                {u.isAdmin ? (
                  <span
                    className="icon-btn au-locked"
                    title="Un administrateur ne peut pas être supprimé"
                  >
                    <Shield size={16} />
                  </span>
                ) : (
                  <button
                    className="icon-btn clickable danger"
                    onClick={() => remove(u)}
                    disabled={deleting === u.id}
                    title="Supprimer ce compte"
                  >
                    {deleting === u.id ? (
                      <Loader2 size={16} className="spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PsnManager({ token, updateUser }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ connected: false });
  const [npsso, setNpsso] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/users/me/psn", { token })
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function connect() {
    const val = npsso.trim();
    if (!val || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Certains collent le JSON entier {"npsso":"..."} → on extrait la valeur.
      const m = val.match(/"npsso"\s*:\s*"([^"]+)"/);
      await apiFetch("/users/me/psn", {
        method: "POST",
        token,
        body: { npsso: m ? m[1] : val },
      });
      setNpsso("");
      updateUser?.({ psnConnected: true });
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Déconnecter ton compte PSN ?")) return;
    try {
      await apiFetch("/users/me/psn", { method: "DELETE", token });
      updateUser?.({ psnConnected: false });
      setStatus({ connected: false });
    } catch (e) {
      alert(e.message);
    }
  }

  const state = status.connected ? "on" : status.expired ? "warn" : "off";

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Trophy size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Gestion du PSN</h2>
          <p>
            Le compte PlayStation connecté ici sert de <strong>source des trophées</strong> :
            la liste des trophées à débloquer devient visible par tous les utilisateurs sur
            les pages de jeux.
          </p>
        </div>
        {!loading && status.isAdmin && (
          <span className={`psn-status ${state}`}>
            {status.connected ? "Connecté" : status.expired ? "Session expirée" : "Non connecté"}
          </span>
        )}
      </div>

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : !status.isAdmin ? (
        <p className="psn-err">
          Section réservée à l'administrateur (défini par <code>ADMIN_EMAIL</code> côté serveur).
        </p>
      ) : status.connected ? (
        <div className="psn-connected-row">
          <p>
            Ton compte PSN est connecté
            {status.connectedAt
              ? ` depuis le ${new Date(status.connectedAt).toLocaleDateString("fr-FR")}`
              : ""}
            .
          </p>
          <button className="btn btn-ghost" onClick={disconnect}>
            <Link2Off size={16} /> Déconnecter
          </button>
        </div>
      ) : (
        <>
          {status.expired && (
            <p className="psn-err">
              Ta session PSN a expiré — colle un nouveau NPSSO pour te reconnecter.
            </p>
          )}
          <ol className="psn-steps">
            <li>
              Connecte-toi sur{" "}
              <a href="https://www.playstation.com" target="_blank" rel="noreferrer">
                playstation.com <ExternalLink size={12} />
              </a>
            </li>
            <li>
              Dans le même navigateur, ouvre{" "}
              <a
                href="https://ca.account.sony.com/api/v1/ssocookie"
                target="_blank"
                rel="noreferrer"
              >
                ce lien <ExternalLink size={12} />
              </a>
            </li>
            <li>
              Copie la valeur de <code>npsso</code> et colle-la ci-dessous
            </li>
          </ol>
          <div className="psn-connect-form">
            <input
              type="password"
              placeholder="Ton token NPSSO…"
              value={npsso}
              onChange={(e) => setNpsso(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <button
              className="btn btn-primary"
              onClick={connect}
              disabled={busy || !npsso.trim()}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Connecter
            </button>
          </div>
          {err && <p className="psn-err">{err}</p>}
        </>
      )}
    </section>
  );
}

// ======================================================================
//  Demandes de synchro PSN (traitées par le worker maison) — admin only
// ======================================================================
const PSN_REQ_STATUS = {
  pending: "En attente",
  processing: "En cours",
  done: "Traité",
  error: "Échec",
};

function PsnRequestsManager({ token }) {
  const [data, setData] = useState(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch("/psn/requests", { token })
      .then((d) => {
        setData(d);
        setAllowed(true);
      })
      .catch((e) => {
        if (/administrateur/i.test(e.message)) setAllowed(false);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  if (!allowed) return null;

  const requests = data?.requests || [];
  const active = data?.active || 0;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Gamepad2 size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Demandes de synchro PSN</h2>
          <p>
            Les utilisateurs demandent leur synchro ici. Lance{" "}
            <code>run-psn-worker.bat</code> sur ton PC pour les traiter (l'IP du
            serveur est bloquée par Sony).
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{" "}
          Rafraîchir
        </button>
      </div>

      {active > 0 && (
        <p className="psn-req-hint">
          {active} demande{active > 1 ? "s" : ""} à traiter — lance le worker sur ton PC.
        </p>
      )}

      {loading && !data ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : requests.length === 0 ? (
        <p className="pn-admin-empty">Aucune demande pour l'instant.</p>
      ) : (
        <div className="psn-req-list">
          {requests.map((r) => (
            <div className={`psn-req-row ${r.status}`} key={r.id}>
              <div className="psn-req-main">
                <strong>{r.username}</strong>
                <span className="psn-req-sub">
                  {r.psnId ? r.psnId : "re-synchro"} ·{" "}
                  {new Date(r.createdAt).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {r.status === "done" && r.summary && (
                  <span className="psn-req-detail">
                    {r.summary.games} jeux détectés · {r.summary.pending} à reconnaître
                  </span>
                )}
                {r.status === "error" && r.error && (
                  <span className="psn-req-detail err">{r.error}</span>
                )}
              </div>
              <span className={`psn-req-badge ${r.status}`}>
                {PSN_REQ_STATUS[r.status] || r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ======================================================================
//  Gestionnaire de patch notes (nouveautés affichées aux utilisateurs)
// ======================================================================
const ICON_NAMES = Object.keys(PN_ICONS);
const blankItem = () => ({ icon: "Sparkles", title: "", description: "", images: [] });
const blankNote = () => ({
  version: "",
  title: "",
  intro: "",
  items: [blankItem()],
});

function PatchnoteManager({ token }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(true);
  const [editing, setEditing] = useState(null); // note en cours d'édition/création
  const [err, setErr] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/patchnotes", { token })
      .then((d) => {
        setNotes(d.patchnotes || []);
        setAllowed(true);
      })
      .catch((e) => {
        if (/administrateur/i.test(e.message)) setAllowed(false);
        else setErr(e.message);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function togglePublish(note) {
    try {
      await apiFetch(`/patchnotes/${note.id}/publish`, {
        method: "POST",
        token,
        body: { published: !note.published },
      });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function remove(note) {
    if (!confirm(`Supprimer le patch note v${note.version} ?`)) return;
    try {
      await apiFetch(`/patchnotes/${note.id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (!allowed) return null;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Sparkles size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Patch notes</h2>
          <p>
            Rédige les nouveautés de l'app : le dernier patch note{" "}
            <strong>publié</strong> s'affiche en pop-up à chaque utilisateur,{" "}
            <strong>une seule fois</strong>, à sa prochaine visite.
          </p>
        </div>
        {!editing && (
          <button className="btn btn-primary" onClick={() => setEditing(blankNote())}>
            <Plus size={16} /> Nouveau
          </button>
        )}
      </div>

      {err && <p className="psn-err">{err}</p>}

      {editing ? (
        <PatchnoteEditor
          token={token}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      ) : loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : notes.length === 0 ? (
        <p className="pn-admin-empty">Aucun patch note pour l'instant.</p>
      ) : (
        <div className="pn-admin-list">
          {notes.map((n) => (
            <div className="pn-admin-row" key={n.id}>
              <span className={`pn-admin-ver ${n.published ? "live" : ""}`}>
                v{n.version}
              </span>
              <div className="pn-admin-info">
                <strong>{n.title}</strong>
                <span>
                  {n.items.length} nouveauté{n.items.length > 1 ? "s" : ""} ·{" "}
                  {n.published ? "En ligne" : "Brouillon"}
                </span>
              </div>
              <div className="pn-admin-actions">
                <button
                  className="icon-btn clickable"
                  onClick={() => togglePublish(n)}
                  title={n.published ? "Dépublier" : "Publier"}
                >
                  {n.published ? <EyeOff size={17} /> : <Send size={17} />}
                </button>
                <button
                  className="icon-btn clickable"
                  onClick={() => setEditing(n)}
                  title="Modifier"
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-btn clickable danger"
                  onClick={() => remove(n)}
                  title="Supprimer"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PatchnoteEditor({ token, initial, onCancel, onSaved }) {
  const [note, setNote] = useState(() => ({
    ...blankNote(),
    ...initial,
    items: initial.items?.length ? initial.items.map((it) => ({ ...it })) : [blankItem()],
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const isEdit = !!initial.id;

  function setField(k, v) {
    setNote((n) => ({ ...n, [k]: v }));
  }
  function setItem(i, patch) {
    setNote((n) => ({
      ...n,
      items: n.items.map((it, j) => (j === i ? { ...it, ...patch } : it)),
    }));
  }
  function addItem() {
    setNote((n) => ({ ...n, items: [...n.items, blankItem()] }));
  }
  function removeItem(i) {
    setNote((n) => ({ ...n, items: n.items.filter((_, j) => j !== i) }));
  }

  async function save() {
    setErr(null);
    if (!note.version.trim() || !note.title.trim()) {
      setErr("La version et le titre sont obligatoires.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        version: note.version.trim(),
        title: note.title.trim(),
        intro: note.intro.trim(),
        items: note.items.filter((it) => it.title.trim()),
      };
      if (isEdit) {
        await apiFetch(`/patchnotes/${initial.id}`, { method: "PUT", token, body });
      } else {
        await apiFetch("/patchnotes", { method: "POST", token, body });
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pn-editor">
      <div className="pn-editor-grid">
        <label className="pn-field">
          <span>Version</span>
          <input
            value={note.version}
            onChange={(e) => setField("version", e.target.value)}
            placeholder="1.1"
          />
        </label>
        <label className="pn-field grow">
          <span>Titre</span>
          <input
            value={note.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Ce qui change dans cette version"
          />
        </label>
      </div>

      <label className="pn-field">
        <span>Intro (optionnel)</span>
        <textarea
          rows={2}
          value={note.intro}
          onChange={(e) => setField("intro", e.target.value)}
          placeholder="Petit mot d'accroche affiché sous le titre…"
        />
      </label>

      <div className="pn-editor-items">
        {note.items.map((it, i) => (
          <PatchnoteItemEditor
            key={i}
            token={token}
            item={it}
            index={i}
            onChange={(patch) => setItem(i, patch)}
            onRemove={() => removeItem(i)}
            canRemove={note.items.length > 1}
          />
        ))}
      </div>

      <button className="pn-add-item clickable" onClick={addItem}>
        <Plus size={15} /> Ajouter une nouveauté
      </button>

      {err && <p className="psn-err">{err}</p>}

      <div className="pn-editor-foot">
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {isEdit ? "Enregistrer" : "Créer le brouillon"}
        </button>
      </div>
    </div>
  );
}

function PatchnoteItemEditor({ token, item, index, onChange, onRemove, canRemove }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const Icon = PN_ICONS[item.icon] || Sparkles;

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || item.images.length >= 2) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const d = await apiUpload("/patchnotes/upload", fd, token);
      onChange({ images: [...item.images, d.url] });
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pn-item-editor">
      <div className="pn-item-editor-head">
        <span className="pn-item-num">#{index + 1}</span>
        <div className="pn-icon-picker">
          <span className="pn-icon-current">
            <Icon size={17} />
          </span>
          <select
            value={item.icon}
            onChange={(e) => onChange({ icon: e.target.value })}
            aria-label="Icône"
          >
            {ICON_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {canRemove && (
          <button className="icon-btn clickable danger" onClick={onRemove} title="Retirer">
            <X size={16} />
          </button>
        )}
      </div>

      <input
        className="pn-item-title-input"
        value={item.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="Titre de la nouveauté"
      />
      <textarea
        rows={2}
        value={item.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="Décris ce qui a changé…"
      />

      <div className="pn-item-shots">
        {item.images.map((src, j) => (
          <div className="pn-shot" key={j}>
            <img src={src} alt="" />
            <button
              className="pn-shot-del clickable"
              onClick={() => onChange({ images: item.images.filter((_, k) => k !== j) })}
              aria-label="Retirer l'image"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {item.images.length < 2 && (
          <button
            className="pn-shot-add clickable"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
            <span>{item.images.length ? "Après" : "Image"}</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
      </div>
    </div>
  );
}
