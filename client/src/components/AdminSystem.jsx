import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Clock,
  Cpu,
  Database,
  Film,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  MemoryStick,
  Music2,
  RefreshCw,
  Users,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Onglet Système du panel Admin — santé du VPS (disque, RAM, CPU) et
//  stockage de l'app (uploads par dossier / par utilisateur, base Mongo).
// ======================================================================

function fmtBytes(b) {
  if (b == null || Number.isNaN(b)) return "—";
  if (b < 1024) return `${b} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
}

function fmtDuration(sec) {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${min} min`;
  return `${min} min`;
}

const fmtInt = (n) => (n == null ? "—" : n.toLocaleString("fr-FR"));

// Niveau d'alerte d'une jauge (vert → orange → rouge).
const barLevel = (pct) => (pct >= 90 ? "danger" : pct >= 75 ? "warn" : "ok");

// Petits noms lisibles pour les dossiers d'uploads.
const FOLDER_LABELS = {
  avatars: "Avatars",
  covers: "Bannières de profil",
  comments: "Images de commentaires",
  reposts: "Fan arts repostés",
  gamemedia: "Mur média (posts)",
  lists: "Images de listes",
  patchnotes: "Patch notes",
  platforms: "Consoles",
  arcade: "Arcade",
};

function Gauge({ pct, level }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div className="sys-bar">
      <span className={`sys-bar-fill ${level || barLevel(p)}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function StatTile({ Icon, label, value, sub, pct, level }) {
  return (
    <div className="sys-stat">
      <span className="sys-stat-label">
        <Icon size={15} /> {label}
      </span>
      <strong className="sys-stat-value">{value}</strong>
      {pct != null && <Gauge pct={pct} level={level} />}
      {sub && <span className="sys-stat-sub">{sub}</span>}
    </div>
  );
}

export default function SystemPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      apiFetch("/admin/system", { token })
        .then((d) => {
          setData(d);
          setErr(null);
        })
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    },
    [token]
  );

  // Rafraîchissement automatique tant que l'onglet est ouvert.
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="admin-card">
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Relevé des stats du serveur…
        </div>
      </div>
    );
  }

  if (err && !data) {
    return (
      <div className="admin-card">
        <p className="psn-err">{err}</p>
      </div>
    );
  }

  const { disk, memory, cpu, host, process: proc, db, uploads, audioCache, users } = data;

  const diskPct = disk ? (disk.used / disk.total) * 100 : null;
  const memPct = memory ? (memory.used / memory.total) * 100 : null;
  // Charge CPU : loadavg 1 min ramené au nombre de cœurs (0 sous Windows en dev).
  const load1 = cpu?.load?.[0] || 0;
  const cpuPct = cpu?.cores ? Math.min(100, (load1 / cpu.cores) * 100) : null;
  const hasLoad = load1 > 0;

  const maxFolder = Math.max(1, ...(uploads?.folders || []).map((f) => f.bytes));
  const maxUser = Math.max(1, ...(users || []).map((u) => u.bytes));
  const shownCols = (db?.collections || []).slice(0, 10);
  const hiddenCols = (db?.collections || []).length - shownCols.length;

  return (
    <div className="admin-stack">
      {/* --- Santé de la machine --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Activity size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>État du serveur</h2>
            <p>
              {host?.hostname ? `${host.hostname} · ` : ""}
              {host?.platform === "linux" ? "Linux" : host?.platform} {host?.arch} · relevé{" "}
              {data.generatedAt
                ? new Date(data.generatedAt).toLocaleTimeString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—"}{" "}
              (auto toutes les 30 s)
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => load()} disabled={loading}>
            {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{" "}
            Rafraîchir
          </button>
        </div>

        {err && <p className="psn-err">{err}</p>}

        <div className="sys-grid">
          <StatTile
            Icon={HardDrive}
            label="Disque"
            value={disk ? `${Math.round(diskPct)} %` : "—"}
            pct={diskPct}
            sub={
              disk
                ? `${fmtBytes(disk.used)} utilisés · ${fmtBytes(disk.free)} libres sur ${fmtBytes(disk.total)}`
                : "Indisponible sur ce système."
            }
          />
          <StatTile
            Icon={MemoryStick}
            label="Mémoire vive"
            value={memory ? `${Math.round(memPct)} %` : "—"}
            pct={memPct}
            sub={
              memory
                ? `${fmtBytes(memory.used)} / ${fmtBytes(memory.total)} · dont API : ${fmtBytes(proc?.rss)}`
                : null
            }
          />
          <StatTile
            Icon={Cpu}
            label="Processeur"
            value={hasLoad ? `${Math.round(cpuPct)} %` : "—"}
            pct={hasLoad ? cpuPct : 0}
            sub={
              `${cpu?.cores || "?"} cœur${(cpu?.cores || 0) > 1 ? "s" : ""}` +
              (hasLoad ? ` · charge ${load1.toFixed(2)} (1 min)` : " · charge indisponible")
            }
          />
          <StatTile
            Icon={Clock}
            label="En ligne depuis"
            value={fmtDuration(host?.uptime)}
            sub={`API relancée il y a ${fmtDuration(proc?.uptime)} · Node ${proc?.node || "?"}`}
          />
        </div>
      </section>

      {/* --- Stockage des fichiers uploadés --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <FolderOpen size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Fichiers de l'app</h2>
            <p>
              Tout ce que les utilisateurs ont uploadé (dossier <code>uploads/</code>) et le
              cache audio des OST.
            </p>
          </div>
          <span className="psn-status on">
            {fmtBytes((uploads?.bytes || 0) + (audioCache?.bytes || 0))}
          </span>
        </div>

        <div className="sys-folders">
          {(uploads?.folders || []).map((f) => (
            <div className="sys-folder-row" key={f.name}>
              <span className="sys-folder-name">{FOLDER_LABELS[f.name] || f.name}</span>
              <div className="sys-folder-bar">
                <Gauge pct={(f.bytes / maxFolder) * 100} level="neutral" />
                <span className="sys-folder-detail">
                  {f.files} fichier{f.files > 1 ? "s" : ""}
                  {f.videos > 0 && (
                    <>
                      {" · "}
                      <ImageIcon size={11} /> {fmtBytes(f.images)} · <Film size={11} />{" "}
                      {fmtBytes(f.videos)}
                    </>
                  )}
                </span>
              </div>
              <strong className="sys-folder-size">{fmtBytes(f.bytes)}</strong>
            </div>
          ))}

          {audioCache && (
            <div className="sys-folder-row cache">
              <span className="sys-folder-name">
                <Music2 size={13} /> Cache audio OST
              </span>
              <div className="sys-folder-bar">
                <Gauge pct={(audioCache.bytes / audioCache.maxBytes) * 100} />
                <span className="sys-folder-detail">
                  {audioCache.files} morceau{audioCache.files > 1 ? "x" : ""} · quota{" "}
                  {fmtBytes(audioCache.maxBytes)} (purge auto au-delà)
                </span>
              </div>
              <strong className="sys-folder-size">{fmtBytes(audioCache.bytes)}</strong>
            </div>
          )}
        </div>
      </section>

      {/* --- Base de données --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Database size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Base de données</h2>
            <p>
              {fmtInt(db?.objects)} documents · {fmtBytes(db?.dataBytes)} de données ·{" "}
              {fmtBytes(db?.indexBytes)} d'index
            </p>
          </div>
          <span className="psn-status on">{fmtBytes(db?.storageBytes)} sur disque</span>
        </div>

        {shownCols.length > 0 && (
          <div className="sys-table-wrap">
            <table className="sys-table">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Documents</th>
                  <th>Données</th>
                  <th>Index</th>
                </tr>
              </thead>
              <tbody>
                {shownCols.map((c) => (
                  <tr key={c.name}>
                    <td>
                      <code>{c.name}</code>
                    </td>
                    <td>{fmtInt(c.count)}</td>
                    <td>{fmtBytes(c.dataBytes)}</td>
                    <td>{fmtBytes(c.indexBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hiddenCols > 0 && (
              <p className="sys-table-more">
                + {hiddenCols} autre{hiddenCols > 1 ? "s" : ""} collection
                {hiddenCols > 1 ? "s" : ""} plus légère{hiddenCols > 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}
      </section>

      {/* --- Poids par utilisateur --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Users size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Stockage par utilisateur</h2>
            <p>
              Avatars, bannières, fan arts repostés et posts du mur média. Les images de
              commentaires et de listes ne sont pas attribuables à un compte.
            </p>
          </div>
        </div>

        {(users || []).length === 0 ? (
          <p className="pn-admin-empty">Aucun fichier attribuable pour l'instant.</p>
        ) : (
          <div className="sys-users">
            {users.map((u, i) => (
              <div className="sys-user-row" key={u.id}>
                <span className="sys-user-rank">{i + 1}</span>
                <span className="au-avatar sm">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" />
                  ) : (
                    <span className="au-avatar-fallback">
                      {(u.username || "?")[0].toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="sys-user-main">
                  {u.username ? (
                    <Link to={`/u/${u.username}`} className="sys-user-name clickable">
                      {u.username}
                    </Link>
                  ) : (
                    <span className="sys-user-name deleted">Compte supprimé</span>
                  )}
                  <Gauge pct={(u.bytes / maxUser) * 100} level="neutral" />
                  <span className="sys-user-detail">
                    {u.files} fichier{u.files > 1 ? "s" : ""} · <ImageIcon size={11} />{" "}
                    {fmtBytes(u.images)}
                    {u.videos > 0 && (
                      <>
                        {" · "}
                        <Film size={11} /> {fmtBytes(u.videos)}
                      </>
                    )}
                  </span>
                </div>
                <strong className="sys-user-size">{fmtBytes(u.bytes)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
