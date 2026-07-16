import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shield,
  ShieldCheck,
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
  Eye,
  ImagePlus,
  X,
  Send,
  Users,
  Search,
  Crown,
  Gamepad2,
  RefreshCw,
  KeyRound,
  Mail,
  Lock,
  UserMinus,
  Save,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PN_ICONS } from "../components/PatchnotePopup";

// ======================================================================
//  Page Admin — shell à onglets verticaux (façon Discord).
// ======================================================================
const TAB_KEYS = ["users", "psn", "secrets", "patchnotes"];

export default function Admin() {
  const { token, user, loading, updateUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab = TAB_KEYS.includes(urlTab) ? urlTab : "users";
  const setTab = (key) => setParams({ tab: key }, { replace: true });

  const isSuper = !!user?.isSuperAdmin;

  // Badge « demandes PSN à traiter » sur l'onglet PSN.
  const [psnActive, setPsnActive] = useState(0);
  useEffect(() => {
    if (!token || !user?.isAdmin) return;
    apiFetch("/psn/requests", { token })
      .then((d) => setPsnActive(d?.active || 0))
      .catch(() => {});
  }, [token, user?.isAdmin, tab]);

  const TABS = [
    { key: "users", label: "Utilisateurs", Icon: Users },
    { key: "psn", label: "PlayStation", Icon: Trophy, badge: psnActive },
    ...(isSuper ? [{ key: "secrets", label: "Secrets", Icon: KeyRound }] : []),
    { key: "patchnotes", label: "Patch notes", Icon: Sparkles },
  ];
  // Onglet Secrets réservé au super-admin : on retombe sur Utilisateurs sinon.
  const safeTab = tab === "secrets" && !isSuper ? "users" : tab;

  if (loading) {
    return (
      <div className="admin-wrap">
        <div className="gp-troph-state">
          <Loader2 size={20} className="spin" /> Chargement…
        </div>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="admin-wrap">
        <div className="admin-denied">
          <Shield size={30} />
          <h1>Accès réservé</h1>
          <p>Cette section est réservée aux administrateurs.</p>
          <Link to="/app" className="btn btn-primary">
            Retour à l'accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-wrap">
      <header className="admin-topbar">
        <span className="admin-head-icon">
          <Shield size={22} />
        </span>
        <div>
          <h1>Administration</h1>
          <p>Gestion des utilisateurs, du PlayStation et de la configuration.</p>
        </div>
        {isSuper && (
          <span className="admin-super-badge" title="Super-administrateur (ADMIN_EMAIL)">
            <Crown size={13} /> Super-admin
          </span>
        )}
      </header>

      <div className="admin-layout">
        <nav className="admin-rail">
          {TABS.map(({ key, label, Icon, badge }) => (
            <button
              key={key}
              className={`admin-tab clickable ${safeTab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {badge > 0 && <span className="admin-tab-badge">{badge}</span>}
            </button>
          ))}
        </nav>

        <section className="admin-panel">
          {safeTab === "users" && <UsersPanel token={token} me={user} />}
          {safeTab === "psn" && <PsnPanel token={token} updateUser={updateUser} />}
          {safeTab === "secrets" && isSuper && <SecretsPanel token={token} />}
          {safeTab === "patchnotes" && <PatchnoteManager token={token} />}
        </section>
      </div>
    </div>
  );
}

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

// ======================================================================
//  Onglet Utilisateurs — liste + recherche + filtres + fiche détaillée.
// ======================================================================
const USER_FILTERS = [
  { key: "all", label: "Tous" },
  { key: "admin", label: "Admins" },
];

function UsersPanel({ token, me }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null); // fiche ouverte

  function load(search = "") {
    setLoading(true);
    apiFetch(`/admin/users${search ? `?q=${encodeURIComponent(search)}` : ""}`, { token })
      .then((d) => setUsers(d.users || []))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const shown = users.filter((u) => (filter === "admin" ? u.isAdmin : true));

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Users size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Utilisateurs</h2>
          <p>
            Recherche, consulte, édite ou supprime les comptes. Clique une ligne pour
            gérer email, mot de passe, rôle et abonnements.
          </p>
        </div>
        {!loading && (
          <span className="psn-status on">
            {users.length} compte{users.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="au-toolbar">
        <div className="au-search">
          <Search size={16} />
          <input
            type="search"
            name="mpl-admin-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un pseudo ou un email…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
          />
          {q && (
            <button className="au-search-clear clickable" onClick={() => setQ("")}>
              <X size={15} />
            </button>
          )}
        </div>
        <div className="au-filters">
          {USER_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`au-filter clickable ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="psn-err">{err}</p>}

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : shown.length === 0 ? (
        <p className="pn-admin-empty">Aucun utilisateur trouvé.</p>
      ) : (
        <div className="au-list">
          {shown.map((u) => (
            <button
              type="button"
              className="au-row clickable"
              key={u.id}
              onClick={() => setOpenId(u.id)}
            >
              <span className="au-avatar">
                {u.avatar ? (
                  <img src={u.avatar} alt="" />
                ) : (
                  <span className="au-avatar-fallback">
                    {u.username?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </span>
              <div className="au-info">
                <div className="au-name-row">
                  <span className="au-name">{u.username}</span>
                  {u.isSuper ? (
                    <span className="au-admin-badge super" title="Super-administrateur">
                      <Crown size={12} /> Super
                    </span>
                  ) : u.isAdmin ? (
                    <span className="au-admin-badge" title="Administrateur">
                      <ShieldCheck size={12} /> Admin
                    </span>
                  ) : null}
                </div>
                <span className="au-email">{u.email}</span>
                <span className="au-meta">
                  <Gamepad2 size={12} /> {u.gameCount} jeu{u.gameCount > 1 ? "x" : ""}
                  {" · "}
                  {u.followersCount} abonné{u.followersCount > 1 ? "s" : ""}
                  {" · "}
                  {u.followingCount} abonnement{u.followingCount > 1 ? "s" : ""}
                  {u.lastSeenAt ? ` · vu ${timeAgo(u.lastSeenAt)}` : ""}
                </span>
              </div>
              <span className="au-chevron">Gérer →</span>
            </button>
          ))}
        </div>
      )}

      {openId && (
        <UserDrawer
          token={token}
          userId={openId}
          me={me}
          onClose={() => setOpenId(null)}
          onDirty={() => load(q.trim())}
        />
      )}
    </div>
  );
}

// --- Fiche détaillée d'un utilisateur (drawer latéral) ---
function UserDrawer({ token, userId, me, onClose, onDirty }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  function load() {
    setLoading(true);
    apiFetch(`/admin/users/${userId}`, { token })
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fermeture à la touche Échap.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = data?.user;
  const isSuperMe = !!me?.isSuperAdmin;

  async function remove() {
    if (
      !confirm(
        `Supprimer définitivement « ${u.username} » ?\n\nToutes ses données seront effacées. Action irréversible.`
      )
    )
      return;
    try {
      await apiFetch(`/admin/users/${u.id}`, { method: "DELETE", token });
      onDirty();
      onClose();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="admin-drawer-overlay" onClick={onClose}>
      <aside className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="admin-drawer-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        {loading ? (
          <div className="gp-troph-state">
            <Loader2 size={18} className="spin" /> Chargement…
          </div>
        ) : err ? (
          <p className="psn-err">{err}</p>
        ) : (
          <>
            <div className="admin-drawer-head">
              <span className="au-avatar lg">
                {u.avatar ? (
                  <img src={u.avatar} alt="" />
                ) : (
                  <span className="au-avatar-fallback">
                    {u.username?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </span>
              <div className="admin-drawer-id">
                <div className="au-name-row">
                  <strong>{u.username}</strong>
                  {u.isSuper ? (
                    <span className="au-admin-badge super">
                      <Crown size={12} /> Super
                    </span>
                  ) : u.isAdmin ? (
                    <span className="au-admin-badge">
                      <ShieldCheck size={12} /> Admin
                    </span>
                  ) : null}
                </div>
                <span className="au-email">{u.email}</span>
                <span className="au-meta">
                  <Gamepad2 size={12} /> {u.gameCount} jeu{u.gameCount > 1 ? "x" : ""}
                  {" · inscrit le "}
                  {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                  {u.lastSeenAt ? ` · vu ${timeAgo(u.lastSeenAt)}` : ""}
                </span>
                <Link to={`/u/${u.username}`} className="admin-drawer-profile clickable">
                  <ExternalLink size={13} /> Voir le profil public
                </Link>
              </div>
            </div>

            <div className="admin-drawer-body">
              {/* --- Compte --- */}
              <h3 className="admin-drawer-sec">Compte</h3>

              <EmailForm token={token} user={u} onSaved={load} onDirty={onDirty} />
              <PasswordForm token={token} user={u} />

              {isSuperMe && !u.isSuper && (
                <AdminToggle token={token} user={u} onSaved={load} onDirty={onDirty} />
              )}

              {!u.isSuper && (
                <button className="admin-danger-btn clickable" onClick={remove}>
                  <Trash2 size={15} /> Supprimer ce compte
                </button>
              )}
              {u.isSuper && (
                <p className="admin-hint">
                  <Shield size={13} /> Compte super-admin (défini par <code>ADMIN_EMAIL</code>) —
                  non modifiable ni supprimable.
                </p>
              )}

              {/* --- Abonnements --- */}
              <RelationList
                token={token}
                title="Abonnements"
                empty="Ne suit personne."
                items={data.following}
                userId={u.id}
                mode="following"
                onDirty={() => {
                  load();
                  onDirty();
                }}
              />

              {/* --- Abonnés --- */}
              <RelationList
                token={token}
                title="Abonnés"
                empty="Aucun abonné."
                items={data.followers}
                userId={u.id}
                mode="followers"
                onDirty={() => {
                  load();
                  onDirty();
                }}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function EmailForm({ token, user, onSaved, onDirty }) {
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const changed = email.trim().toLowerCase() !== user.email;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/admin/users/${user.id}/email`, {
        method: "PATCH",
        token,
        body: { email: email.trim() },
      });
      setMsg({ ok: true, text: "Email mis à jour." });
      onSaved();
      onDirty();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-field">
      <label>
        <Mail size={14} /> Email
      </label>
      <div className="admin-field-row">
        <input
          type="text"
          inputMode="email"
          name="mpl-admin-email"
          value={email}
          disabled={user.isSuper}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <button
          className="btn btn-primary sm"
          onClick={save}
          disabled={busy || !changed || user.isSuper}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Enregistrer
        </button>
      </div>
      {msg && <p className={msg.ok ? "admin-ok" : "psn-err"}>{msg.text}</p>}
    </div>
  );
}

function PasswordForm({ token, user }) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save() {
    if (pw.length < 3) {
      setMsg({ ok: false, text: "Au moins 3 caractères." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/admin/users/${user.id}/password`, {
        method: "PATCH",
        token,
        body: { password: pw },
      });
      setPw("");
      setMsg({ ok: true, text: "Mot de passe changé." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-field">
      <label>
        <Lock size={14} /> Nouveau mot de passe
      </label>
      <div className="admin-field-row">
        <div className="admin-pw-input">
          <input
            type={show ? "text" : "password"}
            name="mpl-admin-newpw"
            value={pw}
            placeholder="Laisse vide pour ne pas changer…"
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
          />
          <button
            className="admin-pw-eye clickable"
            onClick={() => setShow((s) => !s)}
            type="button"
            aria-label={show ? "Masquer" : "Afficher"}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button className="btn btn-primary sm" onClick={save} disabled={busy || !pw}>
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Changer
        </button>
      </div>
      {msg && <p className={msg.ok ? "admin-ok" : "psn-err"}>{msg.text}</p>}
    </div>
  );
}

function AdminToggle({ token, user, onSaved, onDirty }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await apiFetch(`/admin/users/${user.id}/admin`, {
        method: "PATCH",
        token,
        body: { isAdmin: !user.isAdmin },
      });
      onSaved();
      onDirty();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-field">
      <label>
        <ShieldCheck size={14} /> Rôle administrateur
      </label>
      <div className="admin-toggle-row">
        <span>{user.isAdmin ? "Cet utilisateur est administrateur." : "Utilisateur standard."}</span>
        <button
          className={`admin-switch clickable ${user.isAdmin ? "on" : ""}`}
          onClick={toggle}
          disabled={busy}
          role="switch"
          aria-checked={user.isAdmin}
        >
          <span className="admin-switch-knob">
            {busy && <Loader2 size={11} className="spin" />}
          </span>
        </button>
      </div>
    </div>
  );
}

function RelationList({ token, title, empty, items, userId, mode, onDirty }) {
  const [busyId, setBusyId] = useState(null);

  async function remove(target) {
    const label =
      mode === "following"
        ? `Retirer l'abonnement à « ${target.username} » ?`
        : `Retirer « ${target.username} » des abonnés ?`;
    if (!confirm(label)) return;
    setBusyId(target.id);
    try {
      if (mode === "following") {
        await apiFetch(`/admin/users/${userId}/unfollow`, {
          method: "POST",
          token,
          body: { targetId: target.id },
        });
      } else {
        await apiFetch(`/admin/users/${userId}/remove-follower`, {
          method: "POST",
          token,
          body: { followerId: target.id },
        });
      }
      onDirty();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-rel">
      <h3 className="admin-drawer-sec">
        {title} <span className="admin-rel-count">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="admin-rel-empty">{empty}</p>
      ) : (
        <div className="admin-rel-list">
          {items.map((r) => (
            <div className="admin-rel-row" key={r.id}>
              <Link to={`/u/${r.username}`} className="admin-rel-user clickable">
                <span className="au-avatar sm">
                  {r.avatar ? (
                    <img src={r.avatar} alt="" />
                  ) : (
                    <span className="au-avatar-fallback">
                      {r.username?.[0]?.toUpperCase() || "?"}
                    </span>
                  )}
                </span>
                <span className="admin-rel-name">{r.username}</span>
                {r.isAdmin && <ShieldCheck size={12} className="admin-rel-admin" />}
              </Link>
              <button
                className="icon-btn clickable danger"
                onClick={() => remove(r)}
                disabled={busyId === r.id}
                title={mode === "following" ? "Retirer l'abonnement" : "Retirer l'abonné"}
              >
                {busyId === r.id ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <UserMinus size={15} />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ======================================================================
//  Onglet PlayStation — NPSSO de service + demandes de synchro.
// ======================================================================
function PsnPanel({ token, updateUser }) {
  return (
    <div className="admin-stack">
      <PsnManager token={token} updateUser={updateUser} />
      <PsnRequestsManager token={token} />
    </div>
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
    if (!confirm("Déconnecter le compte PSN de service ?")) return;
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
          <h2>Token NPSSO (compte de service)</h2>
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
        <p className="psn-err">Section réservée à l'administrateur.</p>
      ) : status.connected ? (
        <div className="psn-connected-row">
          <p>
            Le compte PSN de service est connecté
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
              La session PSN a expiré — colle un nouveau NPSSO pour te reconnecter.
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
              name="mpl-npsso"
              placeholder="Token NPSSO…"
              value={npsso}
              onChange={(e) => setNpsso(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
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

const PSN_REQ_STATUS = {
  pending: "En attente",
  processing: "En cours",
  done: "Traité",
  error: "Échec",
};

function PsnRequestsManager({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch("/psn/requests", { token })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

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
//  Onglet Secrets — variables du .env (super-admin uniquement).
// ======================================================================
function SecretsPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);

  function load() {
    setLoading(true);
    apiFetch("/admin/secrets", { token })
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <KeyRound size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Secrets & configuration (.env)</h2>
          <p>
            Variables d'environnement du serveur. Modifie une valeur ou ajoute-en une.
            Prend effet immédiatement pour la plupart des réglages ; certains (port, base,
            clés lues au démarrage) nécessitent un redémarrage.
          </p>
        </div>
        {!adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Ajouter
          </button>
        )}
      </div>

      {data && (!data.exists || !data.writable) && (
        <p className="admin-warn">
          <AlertTriangle size={14} />
          {!data.exists ? (
            <span>
              Le fichier <code>{data.path}</code> est introuvable dans le conteneur. En
              production (Docker), le <code>.env</code> n'est pas embarqué dans l'image :
              monte-le dans <code>docker-compose.yml</code> (
              <code>- ./server/.env:/app/.env</code>) puis redéploie pour l'éditer ici.
            </span>
          ) : (
            <span>
              Le fichier <code>{data.path}</code> n'est pas modifiable sur ce serveur — les
              écritures échoueront. Vérifie les permissions du fichier sur l'hôte.
            </span>
          )}
        </p>
      )}

      {err && <p className="psn-err">{err}</p>}

      {adding && (
        <SecretAddForm
          token={token}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : !data?.entries?.length ? (
        <p className="pn-admin-empty">Aucune variable trouvée.</p>
      ) : (
        <div className="sec-list">
          {data.entries.map((e) => (
            <SecretRow key={e.key} token={token} entry={e} onChanged={load} />
          ))}
        </div>
      )}
    </section>
  );
}

function SecretRow({ token, entry, onChanged }) {
  const [value, setValue] = useState(entry.value);
  const [reveal, setReveal] = useState(!entry.secret);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const changed = value !== entry.value;

  // Resynchronise si la liste est rechargée (valeur externe modifiée).
  useEffect(() => {
    setValue(entry.value);
  }, [entry.value]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/admin/secrets/${encodeURIComponent(entry.key)}`, {
        method: "PUT",
        token,
        body: { value },
      });
      setMsg("ok");
      onChanged();
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer la variable « ${entry.key} » ?`)) return;
    try {
      await apiFetch(`/admin/secrets/${encodeURIComponent(entry.key)}`, {
        method: "DELETE",
        token,
      });
      onChanged();
    } catch (e) {
      alert(e.message);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(entry.value).catch(() => {});
  }

  return (
    <div className="sec-row">
      <div className="sec-key">
        <code>{entry.key}</code>
        {entry.secret && <span className="sec-tag">secret</span>}
      </div>
      <div className="sec-val">
        <input
          type={reveal ? "text" : "password"}
          name={`mpl-secret-${entry.key}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="new-password"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <button
          className="icon-btn clickable"
          onClick={() => setReveal((r) => !r)}
          title={reveal ? "Masquer" : "Révéler"}
        >
          {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button className="icon-btn clickable" onClick={copy} title="Copier la valeur">
          <Copy size={15} />
        </button>
        <button
          className="btn btn-primary sm"
          onClick={save}
          disabled={busy || !changed}
          title="Enregistrer"
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
        </button>
        <button className="icon-btn clickable danger" onClick={remove} title="Supprimer">
          <Trash2 size={15} />
        </button>
      </div>
      {msg && (
        <p className={msg === "ok" ? "admin-ok" : "psn-err"}>
          {msg === "ok" ? "Enregistré." : msg}
        </p>
      )}
    </div>
  );
}

function SecretAddForm({ token, onCancel, onAdded }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch("/admin/secrets", {
        method: "POST",
        token,
        body: { key: key.trim(), value },
      });
      onAdded();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sec-add">
      <div className="sec-add-grid">
        <input
          className="sec-add-key"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="NOM_DE_LA_VARIABLE"
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="valeur"
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
      </div>
      {err && <p className="psn-err">{err}</p>}
      <div className="sec-add-foot">
        <button className="btn btn-ghost sm" onClick={onCancel} disabled={busy}>
          Annuler
        </button>
        <button className="btn btn-primary sm" onClick={save} disabled={busy || !key.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Ajouter
        </button>
      </div>
    </div>
  );
}

// ======================================================================
//  Onglet Patch notes (inchangé — nouveautés affichées aux utilisateurs).
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
  const [editing, setEditing] = useState(null); // note en cours d'édition/création
  const [err, setErr] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/patchnotes", { token })
      .then((d) => setNotes(d.patchnotes || []))
      .catch((e) => setErr(e.message))
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
