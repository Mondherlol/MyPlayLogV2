import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Shield,
  ShieldCheck,
  Library,
  Trophy,
  Check,
  Loader2,
  ExternalLink,
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
  Gift,
  Activity,
  Coins,
  Minus,
  Award,
  MousePointer2,
  Frame,
  Palette,
  Download,
  DownloadCloud,
  Globe2,
  CalendarDays,
  ScrollText,
  BellRing,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { applyGeoGlobe } from "../lib/geoGlobe";
import { rarityColor, rarityLabel } from "../lib/rarity";
import { useAuth } from "../context/AuthContext";
import { PN_ICONS } from "../components/PatchnotePopup";
import RewardsPanel from "../components/AdminRewards";
import RewardArt from "../components/RewardArt";
import SystemPanel from "../components/AdminSystem";
import MissionsPanel from "../components/AdminMissions";
import EventsPanel from "../components/AdminEvents";
import CollectionPanel from "../components/AdminCollection";
import LogsPanel from "../components/AdminLogs";
import PushPanel from "../components/AdminPush";

// ======================================================================
//  Page Admin — shell à onglets verticaux (façon Discord).
// ======================================================================
const TAB_KEYS = [
  "users",
  "push",
  "rewards",
  "missions",
  "psn",
  "geo",
  "quiz",
  "events",
  "collection",
  "system",
  "logs",
  "secrets",
  "patchnotes",
];

export default function Admin() {
  const { token, user, loading } = useAuth();
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
    { key: "push", label: "Notifications", Icon: BellRing },
    { key: "rewards", label: "Récompenses", Icon: Gift },
    { key: "missions", label: "Missions", Icon: Award },
    { key: "psn", label: "PlayStation", Icon: Trophy, badge: psnActive },
    { key: "geo", label: "GeoGamer", Icon: Globe2 },
    { key: "quiz", label: "Quiz", Icon: Trophy },
    { key: "events", label: "Événements", Icon: CalendarDays },
    { key: "collection", label: "Collection", Icon: Library },
    { key: "system", label: "Système", Icon: Activity },
    { key: "logs", label: "Logs", Icon: ScrollText },
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
          {safeTab === "push" && <PushPanel token={token} />}
          {safeTab === "rewards" && <RewardsPanel token={token} />}
          {safeTab === "missions" && <MissionsPanel token={token} />}
          {safeTab === "psn" && <PsnPanel token={token} />}
          {safeTab === "geo" && <GeoGlobePanel token={token} />}
          {safeTab === "quiz" && <QuizPanel token={token} />}
          {safeTab === "events" && <EventsPanel token={token} />}
          {safeTab === "collection" && <CollectionPanel token={token} />}
          {safeTab === "system" && <SystemPanel token={token} />}
          {safeTab === "logs" && <LogsPanel token={token} isSuper={isSuper} />}
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
  { key: "download", label: "Téléchargement" },
];

// Les gestes de masse. `danger` colore le bouton et déclenche une confirmation
// détaillée : supprimer une sélection entière est irréversible.
const BULK_ACTIONS = [
  {
    key: "grant-download",
    label: "Donner l'accès au téléchargement",
    Icon: Download,
    verb: (n) => `Donner l'accès au téléchargement à ${n} compte${n > 1 ? "s" : ""} ?`,
  },
  {
    key: "revoke-download",
    label: "Révoquer l'accès au téléchargement",
    Icon: DownloadCloud,
    verb: (n) => `Révoquer l'accès au téléchargement de ${n} compte${n > 1 ? "s" : ""} ?`,
  },
  {
    key: "delete",
    label: "Supprimer les comptes",
    Icon: Trash2,
    danger: true,
    verb: (n) =>
      `Supprimer définitivement ${n} compte${n > 1 ? "s" : ""} ?\n\n` +
      `Toutes leurs données seront effacées. Action irréversible.`,
  },
];

function UsersPanel({ token, me }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null); // fiche ouverte
  // Sélection pour les actions de masse (Set d'ids).
  const [picked, setPicked] = useState(() => new Set());
  const [action, setAction] = useState(BULK_ACTIONS[0].key);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);

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

  const shown = users.filter((u) =>
    filter === "admin" ? u.isAdmin : filter === "download" ? u.canDownload : true
  );

  // La sélection ne porte que sur ce qui est À L'ÉCRAN : cocher « tout » puis
  // affiner la recherche ne doit pas agir sur des comptes devenus invisibles.
  const shownIds = shown.map((u) => u.id);
  const pickedShown = shownIds.filter((id) => picked.has(id));
  const allPicked = shownIds.length > 0 && pickedShown.length === shownIds.length;

  const toggleOne = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (allPicked) shownIds.forEach((id) => next.delete(id));
      else shownIds.forEach((id) => next.add(id));
      return next;
    });

  async function runBulk() {
    const conf = BULK_ACTIONS.find((a) => a.key === action);
    const ids = pickedShown;
    if (!conf || !ids.length || bulkBusy) return;
    if (!confirm(conf.verb(ids.length))) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const d = await apiFetch("/admin/users/bulk", {
        method: "POST",
        token,
        body: { action, ids },
      });
      const skipped = d.skipped?.length || 0;
      setBulkMsg({
        ok: true,
        text:
          `${d.done} compte${d.done > 1 ? "s" : ""} traité${d.done > 1 ? "s" : ""}.` +
          (skipped ? ` ${skipped} ignoré${skipped > 1 ? "s" : ""} (compte protégé).` : ""),
      });
      setPicked(new Set());
      load(q.trim());
    } catch (e) {
      setBulkMsg({ ok: false, text: e.message });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Users size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Utilisateurs</h2>
          <p>
            Les plus récemment connectés en tête. Clique une ligne pour gérer email,
            mot de passe, rôle, accès au téléchargement et abonnements — ou coche
            plusieurs comptes pour agir en une fois.
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

      {/* --- Barre d'actions de masse --- */}
      {/* Toujours visible (et non surgissante) : la case « tout cocher » y vit,
          donc elle doit exister AVANT qu'on ait coché quoi que ce soit. */}
      <div className={`au-bulk ${pickedShown.length ? "armed" : ""}`}>
        <label className="au-bulk-all clickable">
          <input
            type="checkbox"
            checked={allPicked}
            // État « certains cochés » : la case affiche un tiret.
            ref={(el) => {
              if (el) el.indeterminate = pickedShown.length > 0 && !allPicked;
            }}
            onChange={toggleAll}
            disabled={!shownIds.length}
          />
          <span>
            {allPicked ? "Tout décocher" : "Tout cocher"}
            {shownIds.length > 0 && <em> ({shownIds.length})</em>}
          </span>
        </label>

        <span className="au-bulk-count">
          {pickedShown.length
            ? `${pickedShown.length} sélectionné${pickedShown.length > 1 ? "s" : ""}`
            : "Aucune sélection"}
        </span>

        <select
          className="au-bulk-select"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Action à appliquer"
        >
          {BULK_ACTIONS.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>

        <button
          className={`btn sm clickable ${
            BULK_ACTIONS.find((a) => a.key === action)?.danger ? "btn-danger" : "btn-primary"
          }`}
          onClick={runBulk}
          disabled={!pickedShown.length || bulkBusy}
        >
          {bulkBusy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Appliquer
        </button>
      </div>

      {bulkMsg && <p className={bulkMsg.ok ? "admin-ok" : "psn-err"}>{bulkMsg.text}</p>}
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
            <div className={`au-row ${picked.has(u.id) ? "picked" : ""}`} key={u.id}>
              {/* Hors du bouton « Gérer » : cocher ne doit pas ouvrir la fiche. */}
              <label
                className="au-pick clickable"
                onClick={(e) => e.stopPropagation()}
                title="Sélectionner pour une action de masse"
              >
                <input
                  type="checkbox"
                  checked={picked.has(u.id)}
                  onChange={() => toggleOne(u.id)}
                />
              </label>

              <button
                type="button"
                className="au-row-main clickable"
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
                    {u.canDownload && (
                      <span
                        className="au-dl-badge"
                        title={
                          u.downloadFlag
                            ? "Accès au téléchargement accordé"
                            : "Accès au téléchargement (via le rôle admin)"
                        }
                      >
                        <Download size={12} /> DL
                      </span>
                    )}
                  </div>
                  <span className="au-email">{u.email}</span>
                  <span className="au-meta">
                    <Gamepad2 size={12} /> {u.gameCount} jeu{u.gameCount > 1 ? "x" : ""}
                    {" · "}
                    <Coins size={12} /> {(u.points || 0).toLocaleString("fr-FR")} pt
                    {u.points > 1 ? "s" : ""}
                    {" · "}
                    {u.followersCount} abonné{u.followersCount > 1 ? "s" : ""}
                    {" · "}
                    {u.followingCount} abonnement{u.followingCount > 1 ? "s" : ""}
                    {u.lastSeenAt ? ` · vu ${timeAgo(u.lastSeenAt)}` : ""}
                  </span>
                </div>
                <span className="au-chevron">Gérer →</span>
              </button>
            </div>
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
  // Le compte super-admin n'est éditable que par le super-admin lui-même.
  const canEditAccount = isSuperMe || !u?.isSuper;

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

              {canEditAccount ? (
                <>
                  <EmailForm
                    token={token}
                    user={u}
                    canEdit={canEditAccount}
                    onSaved={load}
                    onDirty={onDirty}
                  />
                  <PasswordForm token={token} user={u} />
                </>
              ) : (
                <p className="admin-hint">
                  <Shield size={13} /> Compte super-administrateur — non modifiable par un
                  autre administrateur.
                </p>
              )}

              {/* Accès au téléchargement : le seul moyen d'ouvrir l'onglet
                  « Téléchargements » d'une fiche de jeu. Fermé par défaut. */}
              <DownloadToggle token={token} user={u} onSaved={load} onDirty={onDirty} />

              {isSuperMe && !u.isSuper && (
                <AdminToggle token={token} user={u} onSaved={load} onDirty={onDirty} />
              )}

              {isSuperMe && !u.isSuper && (
                <TransferSuperButton token={token} user={u} />
              )}

              {!u.isSuper && (
                <button className="admin-danger-btn clickable" onClick={remove}>
                  <Trash2 size={15} /> Supprimer ce compte
                </button>
              )}
              {u.isSuper && isSuperMe && (
                <p className="admin-hint">
                  <Crown size={13} /> C'est ton compte super-admin. Pour transférer ce rôle,
                  ouvre la fiche de l'utilisateur à qui le confier.
                </p>
              )}

              {/* --- Points d'arcade --- */}
              <h3 className="admin-drawer-sec">Points d'arcade</h3>
              <PointsForm token={token} user={u} onDirty={onDirty} />

              {/* --- Cosmétiques équipés (curseur en tête) --- */}
              <h3 className="admin-drawer-sec">Cosmétiques équipés</h3>
              <CosmeticsPanel cosmetics={data.cosmetics} ownedCount={data.ownedCount} />

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

// --- Cosmétiques équipés : curseur, ornement, badge ---
// Le curseur ouvre la marche : c'est celui qu'on cherche quand on se demande
// « il joue avec quoi ? ». Un slug équipé dont le lot n'existe plus est signalé
// comme tel plutôt que masqué.
const COSMETIC_FAMILIES = [
  { key: "cursor", label: "Curseur", Icon: MousePointer2, none: "Curseur par défaut" },
  { key: "theme", label: "Thème", Icon: Palette, none: "Thème par défaut" },
  { key: "ornament", label: "Ornement", Icon: Frame, none: "Aucun ornement" },
  { key: "badge", label: "Badge", Icon: Award, none: "Aucun badge" },
];

function CosmeticsPanel({ cosmetics, ownedCount }) {
  return (
    <div className="admin-cos-list">
      {COSMETIC_FAMILIES.map(({ key, label, Icon, none }) => {
        const c = cosmetics?.[key] || null;
        const owned = ownedCount?.[key] || 0;
        return (
          <div className={`admin-cos-row ${c ? "" : "empty"}`} key={key}>
            <span className="admin-cos-art">
              {c && !c.missing ? <RewardArt reward={c} size={40} /> : <Icon size={20} />}
            </span>
            <div className="admin-cos-info">
              <span className="admin-cos-fam">{label}</span>
              {c ? (
                c.missing ? (
                  <span className="admin-cos-name warn">
                    <AlertTriangle size={12} /> Lot introuvable — <code>{c.key}</code>
                  </span>
                ) : (
                  <>
                    <span className="admin-cos-name">{c.name}</span>
                    <span className="admin-cos-meta">
                      <span
                        className="admin-cos-rarity"
                        style={{ color: rarityColor(c.rarity) }}
                      >
                        {rarityLabel(c.rarity)}
                      </span>
                      {" · "}
                      <code>{c.key}</code>
                      {c.obtainedAt
                        ? ` · gagné le ${new Date(c.obtainedAt).toLocaleDateString("fr-FR")}`
                        : ""}
                      {c.enabled === false ? " · lot désactivé" : ""}
                    </span>
                  </>
                )
              ) : (
                <span className="admin-cos-name none">{none}</span>
              )}
            </div>
            <span className="admin-cos-owned" title={`${owned} possédé${owned > 1 ? "s" : ""}`}>
              {owned}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmailForm({ token, user, canEdit = true, onSaved, onDirty }) {
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
          disabled={!canEdit}
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
          disabled={busy || !changed || !canEdit}
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

// --- Solde d'arcade : créditer ou retirer des points à la main ---
// On ne pose jamais un solde absolu, on applique un ÉCART : le serveur passe par
// grantPoints/spendPoints, donc chaque geste laisse une ligne « admin » dans le
// grand livre du joueur (visible dans son historique de points).
const POINT_PRESETS = [100, 500, 1000, 5000];

function PointsForm({ token, user, onDirty }) {
  const [balance, setBalance] = useState(user.points || 0);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(null); // "add" | "sub"
  const [msg, setMsg] = useState(null);

  const n = Math.round(Number(amount));
  const valid = Number.isFinite(n) && n > 0;

  async function apply(sign) {
    if (!valid || busy) return;
    setBusy(sign > 0 ? "add" : "sub");
    setMsg(null);
    try {
      const d = await apiFetch("/arcade/admin/grant", {
        method: "POST",
        token,
        body: { userId: user.id, amount: sign * n },
      });
      setBalance(d.points);
      setAmount("");
      setMsg({
        ok: true,
        text: `${sign > 0 ? "+" : "−"}${n.toLocaleString("fr-FR")} — nouveau solde : ${d.points.toLocaleString("fr-FR")}.`,
      });
      onDirty(); // la liste derrière affiche le solde
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-field">
      <label>
        <Coins size={14} /> Solde — {balance.toLocaleString("fr-FR")} point
        {balance > 1 ? "s" : ""}
      </label>
      <div className="admin-field-row">
        <input
          type="number"
          min="1"
          step="1"
          name="mpl-admin-points"
          value={amount}
          placeholder="Combien ?"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply(1)}
          autoComplete="off"
        />
        <button
          className="btn btn-primary sm"
          onClick={() => apply(1)}
          disabled={!valid || !!busy}
          title="Créditer"
        >
          {busy === "add" ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
          Créditer
        </button>
        <button
          className="btn btn-ghost sm"
          onClick={() => apply(-1)}
          disabled={!valid || !!busy || n > balance}
          title={n > balance ? "Solde insuffisant" : "Retirer"}
        >
          {busy === "sub" ? <Loader2 size={14} className="spin" /> : <Minus size={14} />}
          Retirer
        </button>
      </div>
      <div className="au-points-presets">
        {POINT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="au-preset clickable"
            onClick={() => setAmount(String(p))}
          >
            +{p.toLocaleString("fr-FR")}
          </button>
        ))}
      </div>
      {msg && <p className={msg.ok ? "admin-ok" : "psn-err"}>{msg.text}</p>}
    </div>
  );
}

// --- Accès à l'onglet « Téléchargements » des fiches de jeu ---
// L'interrupteur porte sur le DRAPEAU du compte (`downloadFlag`), pas sur
// l'accès effectif : un administrateur y a droit par son rôle, et l'éteindre ne
// lui retirerait rien — on le dit plutôt que de laisser croire à une panne.
function DownloadToggle({ token, user, onSaved, onDirty }) {
  const [busy, setBusy] = useState(false);
  const viaRole = user.isAdmin && !user.downloadFlag;

  async function toggle() {
    setBusy(true);
    try {
      await apiFetch(`/admin/users/${user.id}/download`, {
        method: "PATCH",
        token,
        body: { canDownload: !user.downloadFlag },
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
        <Download size={14} /> Accès au téléchargement
      </label>
      <div className="admin-toggle-row">
        <span>
          {user.downloadFlag
            ? "L'onglet « Téléchargements » lui est ouvert."
            : viaRole
              ? "Ouvert d'office : c'est un administrateur."
              : "Onglet « Téléchargements » masqué et API refusée."}
        </span>
        <button
          className={`admin-switch clickable ${user.downloadFlag ? "on" : ""}`}
          onClick={toggle}
          disabled={busy}
          role="switch"
          aria-checked={user.downloadFlag}
        >
          <span className="admin-switch-knob">
            {busy && <Loader2 size={11} className="spin" />}
          </span>
        </button>
      </div>
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

function TransferSuperButton({ token, user }) {
  const [busy, setBusy] = useState(false);

  async function transfer() {
    if (
      !confirm(
        `Transférer le rôle de SUPER-ADMINISTRATEUR à « ${user.username} » ?\n\n` +
          `Tu perdras le contrôle total (secrets, gestion des admins) et deviendras ` +
          `administrateur simple. L'effet est immédiat.`
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/admin/users/${user.id}/transfer-super`, { method: "POST", token });
      alert(
        `« ${user.username} » est désormais le super-administrateur.\nTu es maintenant administrateur simple.`
      );
      // Recharge tout : /auth/me renverra le nouveau rôle (l'onglet Secrets disparaît…).
      window.location.reload();
    } catch (e) {
      alert(e.message);
      setBusy(false);
    }
  }

  return (
    <button className="admin-transfer-btn clickable" onClick={transfer} disabled={busy}>
      {busy ? <Loader2 size={15} className="spin" /> : <Crown size={15} />}
      Transférer le super-admin à cet utilisateur
    </button>
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
function PsnPanel({ token }) {
  return (
    <div className="admin-stack">
      <PsnTokenReminder />
      <PsnRequestsManager token={token} />
    </div>
  );
}

// ======================================================================
//  Onglet GeoGamer — choix de l'image du globe (arcade + fond du menu)
// ======================================================================
// L'admin cherche un jeu, choisit un de ses panoramas, le prévisualise DANS le
// vrai globe (même markup que la carte de l'arcade, image posée en variable
// CSS locale) puis l'applique. Côté serveur, /geo/admin/globe ré-encode l'image
// en 2:1 et retient le choix ; le client la relit ensuite via /geo/globe.
function GeoGlobePanel({ token }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [current, setCurrent] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(
    (search = "") => {
      setLoading(true);
      apiFetch(
        `/geo/admin/globe/search${search ? `?q=${encodeURIComponent(search)}` : ""}`,
        { token }
      )
        .then((d) => {
          setItems(d.items || []);
          setCurrent(d.current || null);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    },
    [token]
  );

  useEffect(() => {
    load();
    // Pour que l'aperçu (globe non sélectionné) montre l'image RÉELLE en cours.
    applyGeoGlobe(token);
  }, [load, token]);

  async function apply() {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const d = await apiFetch("/geo/admin/globe", {
        method: "POST",
        token,
        body: { panoramaId: selected.id },
      });
      setCurrent({ panoramaId: selected.id, gameName: d.gameName });
      setMsg({ ok: true, text: `Globe mis à jour avec « ${d.gameName} ».` });
      // La variable globale suit tout de suite : en ouvrant l'arcade dans la
      // foulée, le nouveau globe est déjà là (pas besoin de recharger).
      if (d.url)
        document.documentElement.style.setProperty("--geo-globe", `url("${d.url}")`);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-stack geo-pick">
      <div className="admin-card geo-pick-head">
        <div className="geo-pick-intro">
          <h2>Image du globe</h2>
          <p>
            L'image qui tourne dans le globe de l'arcade et derrière le menu de
            GeoGamer. Cherche un jeu, choisis un panorama, prévisualise dans le
            globe, puis applique — tu peux en tester autant que tu veux.
          </p>
          {current?.gameName && (
            <span className="geo-pick-current">
              <Check size={14} /> Actuel : <b>{current.gameName}</b>
            </span>
          )}
        </div>

        {/* Aperçu : le vrai globe, avec le panorama sélectionné posé en
            variable CSS locale (sinon il montre l'image en vigueur). */}
        <div
          className="geo-pick-preview"
          style={selected ? { "--geo-globe": `url("${selected.image}")` } : undefined}
        >
          <span className="arc-art-globe" aria-hidden="true">
            <span className="arc-art-world">
              <span className="arc-art-pano" />
              <span className="arc-art-shade" />
            </span>
            <i className="arc-art-mer a" />
            <i className="arc-art-mer b" />
            <i className="arc-art-eq" />
          </span>
        </div>
      </div>

      <form
        className="geo-pick-search"
        onSubmit={(e) => {
          e.preventDefault();
          load(q.trim());
        }}
      >
        <span className="geo-pick-field">
          <Search size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher un jeu (vide = échantillon)…"
          />
        </span>
        <button type="submit" className="btn btn-primary clickable">
          Chercher
        </button>
        {selected && (
          <button
            type="button"
            className="btn btn-primary clickable geo-pick-apply"
            onClick={apply}
            disabled={saving}
          >
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            Définir comme globe
          </button>
        )}
      </form>

      {msg && (
        <div className={`geo-pick-msg ${msg.ok ? "ok" : "err"}`}>
          {msg.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : items.length === 0 ? (
        <p className="geo-pick-empty">Aucun panorama pour cette recherche.</p>
      ) : (
        <div className="geo-pick-grid">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`geo-pick-tile clickable ${selected?.id === it.id ? "on" : ""}`}
              onClick={() => setSelected(it)}
              title={it.gameName}
            >
              <img src={it.image} alt="" loading="lazy" draggable="false" />
              <span className="geo-pick-name">{it.gameName}</span>
              {selected?.id === it.id && (
                <span className="geo-pick-check">
                  <Check size={14} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Le token NPSSO de service est configuré côté serveur (PSN_NPSSO). On garde ici
// juste un rappel de l'endroit où en récupérer un nouveau quand il expire.
function PsnTokenReminder() {
  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Trophy size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Token NPSSO</h2>
          <p>
            Le token de service (source des trophées) est configuré côté serveur via{" "}
            <code>PSN_NPSSO</code>. Pour en récupérer un nouveau quand il expire :
          </p>
        </div>
      </div>
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
            le lien ssocookie <ExternalLink size={12} />
          </a>{" "}
          et copie la valeur <code>npsso</code>
        </li>
      </ol>
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
  const [deleting, setDeleting] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/psn/requests", { token })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function remove(r) {
    if (!confirm(`Effacer la demande de synchro de « ${r.username} » ?`)) return;
    setDeleting(r.id);
    try {
      await apiFetch(`/psn/requests/${r.id}`, { method: "DELETE", token });
      setData((d) => {
        const requests = d.requests.filter((x) => x.id !== r.id);
        const active = requests.filter(
          (x) => x.status === "pending" || x.status === "processing"
        ).length;
        return { ...d, requests, active };
      });
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(null);
    }
  }

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
              <button
                className="icon-btn clickable danger psn-req-del"
                onClick={() => remove(r)}
                disabled={deleting === r.id}
                title="Effacer cette demande"
              >
                {deleting === r.id ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Trash2 size={15} />
                )}
              </button>
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

// ======================================================================
//  Onglet Quiz — la relecture de la banque du Grand Quiz
// ======================================================================
// Le Grand Quiz tire ses questions de trois sources (cf.
// server/src/models/QuizQuestion.js). Deux ne demandent rien : les faits IGDB
// sont exacts par construction, le seed est écrit à la main. La troisième —
// Gemini — produit du bon et du faux avec le même aplomb, et NE SORT JAMAIS EN
// JEU tant que personne ne l'a relue. C'est ici qu'on tranche.
//
// L'écran est volontairement une CHAÎNE : une pile, deux gros boutons, on
// enchaîne. Relire cinquante questions dans un formulaire à onglets, personne
// ne le fait ; relire cinquante questions en cliquant « garder / jeter », c'est
// dix minutes.
function QuizPanel({ token }) {
  const [kind, setKind] = useState("question");
  const [filter, setFilter] = useState("pending");
  const [data, setData] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [genQ, setGenQ] = useState(30);
  const [genE, setGenE] = useState(20);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/admin/quiz?kind=${kind}&filter=${filter}`, { token });
      setData(d);
      setJob(d.job || null);
      setErr("");
    } catch (e) {
      setErr(e.message || "Banque illisible.");
    }
  }, [token, kind, filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Tant qu'une tâche tourne, on suit son avancement. On interroge `/job` et
  // pas la banque entière : recompter tous les documents toutes les deux
  // secondes serait du gâchis pour une barre de progression.
  useEffect(() => {
    if (!job?.running) return undefined;
    const iv = setInterval(async () => {
      try {
        const d = await apiFetch("/admin/quiz/job", { token });
        setJob(d.job);
        // Terminée : on recharge les compteurs, qui viennent de changer.
        if (!d.job?.running) load();
      } catch {
        /* on réessaiera au prochain tour */
      }
    }, 1500);
    return () => clearInterval(iv);
  }, [job?.running, token, load]);

  async function run(path, body) {
    setBusy(path);
    try {
      const d = await apiFetch(`/admin/quiz/${path}`, { method: "POST", token, body });
      setJob(d.job);
      setErr("");
    } catch (e) {
      setErr(e.message || "Action impossible.");
    } finally {
      setBusy("");
    }
  }

  async function act(item, body, method = "POST") {
    setBusy(item.id);
    try {
      const path =
        method === "DELETE" ? `/admin/quiz/${item.id}?kind=${kind}` : `/admin/quiz/${item.id}`;
      await apiFetch(path, { method, token, body: method === "DELETE" ? undefined : body });
      // On retire la ligne de la pile sans recharger : la relecture est un
      // geste répétitif, un aller-retour serveur entre chaque casserait le
      // rythme (et ferait sauter la liste sous le curseur).
      setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== item.id) } : d));
    } catch (e) {
      setErr(e.message || "Action impossible.");
    } finally {
      setBusy("");
    }
  }

  const c = data?.counts;
  const running = !!job?.running;
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;

  return (
    // `admin-quiz` porte TOUT l'habillage de cet onglet (app-36-quizz.css).
    <div className="admin-section admin-quiz">
      <header className="admin-section-head">
        <h2>Banque du Grand Quiz</h2>
        <p>
          Le jeu tire ses questions de trois sources. Les <b>faits IGDB</b> sont
          calculés à la volée, infinis et toujours exacts — ils n'ont besoin de
          rien. Le <b>contenu local</b> (écrit à la main, versionné avec le code)
          s'importe ici en un clic. Ce que produit <b>l'IA</b> n'est jamais joué
          avant que tu l'aies relu.
        </p>
      </header>

      {/* ---- L'état de la banque, en un coup d'œil ---- */}
      {c && (
        <div className="admin-quiz-stats">
          <div className="admin-quiz-stat live">
            <b>{c.questionsLive}</b>
            <span>questions jouables</span>
            <em>
              {c.questionsSeed} écrites main · {c.questionsGemini} par IA
            </em>
          </div>
          <div className="admin-quiz-stat live">
            <b>{c.emojisLive}</b>
            <span>emojis jouables</span>
            <em>
              {c.emojisSeed} écrits main · {c.emojisGemini} par IA
            </em>
          </div>
          <div className={`admin-quiz-stat ${c.questionsPending + c.emojisPending ? "todo" : ""}`}>
            <b>{c.questionsPending + c.emojisPending}</b>
            <span>à relire</span>
            <em>rien de tout ça n'est joué</em>
          </div>
          {c.questionsFlagged > 0 && (
            <div className="admin-quiz-stat warn">
              <b>{c.questionsFlagged}</b>
              <span>signalées</span>
              <em>contestées en partie</em>
            </div>
          )}
        </div>
      )}

      {/* ---- Les deux façons de remplir ---- */}
      <div className="admin-quiz-actions-row">
        <div className="admin-quiz-action">
          <div className="admin-quiz-action-h">
            <Library size={17} />
            <b>Contenu local</b>
          </div>
          <p>
            Importe les {c ? c.questionsSeed || 157 : 157} questions et les emojis
            écrits à la main, livrés avec le code. Chaque titre d'emoji est
            retrouvé sur IGDB — compte environ une minute la première fois.
            Rejouable sans risque : rien n'est dupliqué, et ce qui vient de l'IA
            n'est jamais touché.
          </p>
          <button
            className="admin-btn ok clickable"
            disabled={running || busy === "seed"}
            onClick={() => run("seed")}
          >
            <Library size={15} /> Importer le contenu local
          </button>
        </div>

        <div className="admin-quiz-action">
          <div className="admin-quiz-action-h">
            <Sparkles size={17} />
            <b>Générer avec l'IA</b>
          </div>
          <p>
            Une fournée de questions de culture (anecdotes, personnages,
            répliques) et de nouvelles suites d'emojis. Tout arrive{" "}
            <b>en attente de relecture</b> : le jeu ne change pas tant que tu
            n'as rien validé.
          </p>
          <div className="admin-quiz-gen">
            <label>
              Questions
              <input
                type="number"
                min="0"
                max="100"
                value={genQ}
                onChange={(e) => setGenQ(Number(e.target.value))}
              />
            </label>
            <label>
              Emojis
              <input
                type="number"
                min="0"
                max="100"
                value={genE}
                onChange={(e) => setGenE(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            className="admin-btn clickable"
            disabled={running || busy === "generate" || !data?.geminiReady}
            onClick={() => run("generate", { questions: genQ, emojis: genE })}
            title={data?.geminiReady ? undefined : "GEMINI_API_KEY manquant (onglet Secrets)"}
          >
            <Sparkles size={15} /> Générer
          </button>
          {data && !data.geminiReady && (
            <span className="admin-quiz-note">
              Clé Gemini absente — ajoute-la dans l'onglet Secrets.
            </span>
          )}
        </div>
      </div>

      {/* ---- L'avancement de la tâche en cours, ou son compte rendu ---- */}
      {job && (
        <div className={`admin-quiz-job ${running ? "running" : job.error ? "bad" : "done"}`}>
          {running ? (
            <>
              <Loader2 size={16} className="spin" />
              <span>
                {job.kind === "seed" ? "Import en cours" : "Génération en cours"}
                {job.step ? ` · ${job.step}` : ""} {job.total ? `${job.done}/${job.total}` : ""}
              </span>
              <i className="admin-quiz-bar" style={{ transform: `scaleX(${pct / 100})` }} />
            </>
          ) : job.error ? (
            <>
              <X size={16} />
              <span>{job.error}</span>
            </>
          ) : (
            <>
              <Check size={16} />
              <span>{summarize(job)}</span>
            </>
          )}
        </div>
      )}

      {/* ---- La file de relecture ---- */}
      <div className="admin-filters">
        <div className="admin-seg">
          {[
            ["question", "Questions"],
            ["emoji", "Emojis"],
          ].map(([k, label]) => (
            <button
              key={k}
              className={`admin-seg-opt clickable ${kind === k ? "on" : ""}`}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="admin-seg">
          {[
            ["pending", "À relire"],
            ["flagged", "Signalées"],
            ["live", "En service"],
          ].map(([k, label]) => (
            <button
              key={k}
              className={`admin-seg-opt clickable ${filter === k ? "on" : ""}`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="admin-error">{err}</p>}

      {!data ? (
        <div className="admin-loading">
          <Loader2 size={20} className="spin" />
        </div>
      ) : data.items.length === 0 ? (
        <p className="admin-empty">
          {filter === "pending"
            ? "Rien à relire. Utilise « Générer » ci-dessus pour en produire."
            : filter === "flagged"
              ? "Aucun signalement en attente."
              : "Rien en service. Commence par « Importer le contenu local »."}
        </p>
      ) : (
        <ul className="admin-quiz-list">
          {data.items.map((it) => (
            <li key={it.id} className={`admin-quiz-row ${it.flags > 0 ? "flagged" : ""}`}>
              <div className="admin-quiz-main">
                {kind === "emoji" ? (
                  <>
                    <span className="admin-quiz-emojis">{it.emojis.join(" ")}</span>
                    <b className="admin-quiz-answer">{it.name}</b>
                  </>
                ) : (
                  <>
                    <b className="admin-quiz-q">{it.text}</b>
                    <span className="admin-quiz-answer">
                      <Check size={13} />{" "}
                      {typeof it.answer === "boolean"
                        ? it.answer
                          ? "Vrai"
                          : "Faux"
                        : it.answer}
                    </span>
                    {it.choices.length > 1 && (
                      <span className="admin-quiz-wrong">{it.choices.slice(1).join(" · ")}</span>
                    )}
                    {it.explain && <em className="admin-quiz-explain">{it.explain}</em>}
                  </>
                )}
                <span className="admin-quiz-meta">
                  {it.source} · difficulté {it.difficulty}
                  {it.theme ? ` · ${it.theme}` : ""}
                  {it.timesAsked > 0 &&
                    ` · posée ${it.timesAsked}×, réussie ${Math.round(
                      (it.timesCorrect / it.timesAsked) * 100
                    )}%`}
                  {it.flags > 0 && ` · ${it.flags} signalement(s)`}
                </span>
              </div>

              <div className="admin-quiz-actions">
                {!it.approved ? (
                  <button
                    className="admin-btn ok clickable"
                    disabled={busy === it.id}
                    onClick={() => act(it, { kind, approved: true })}
                  >
                    <Check size={15} /> Mettre en service
                  </button>
                ) : (
                  <button
                    className="admin-btn clickable"
                    disabled={busy === it.id}
                    onClick={() => act(it, { kind, approved: false })}
                  >
                    <X size={15} /> Retirer
                  </button>
                )}
                <button
                  className="admin-btn danger clickable"
                  disabled={busy === it.id}
                  onClick={() => act(it, null, "DELETE")}
                  title="Supprimer définitivement"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Le compte rendu d'une tâche terminée, en une phrase.
function summarize(job) {
  const r = job.result;
  if (!r) return "Terminé.";
  const bits = [];
  if (r.questions)
    bits.push(
      `${r.questions.created} question(s) ajoutée(s)` +
        (r.questions.updated ? `, ${r.questions.updated} mise(s) à jour` : "")
    );
  if (r.emojis)
    bits.push(
      `${r.emojis.created} emoji(s) ajouté(s)` +
        (r.emojis.updated ? `, ${r.emojis.updated} mis à jour` : "")
    );
  if (r.emojis?.retired) bits.push(`${r.emojis.retired} ancienne(s) entrée(s) retirée(s) du service`);
  if (r.unresolved?.length) bits.push(`${r.unresolved.length} titre(s) non retrouvé(s) sur IGDB`);
  if (r.problems?.length) bits.push(`${r.problems.length} entrée(s) mal formée(s)`);
  if (r.errors?.length) bits.push(r.errors[0]);
  return bits.join(" · ") || "Terminé, rien de nouveau.";
}
