import { useEffect, useState } from "react";
import {
  Wrench,
  Download,
  Package,
  Gamepad2,
  HardDrive,
  Magnet,
  Users2,
  KeyRound,
  Trash2,
  ExternalLink,
  Languages,
  Calendar,
  ChevronDown,
  ChevronUp,
  Check,
  Send,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { apiFetch, API_BASE } from "../lib/api";
import { makeCache } from "../lib/cache";

// Patchs/mods : cache mémoire + localStorage (appels VNDB coûteux). TTL 30 min.
const patchCache = makeCache("mpl_patch_", 30 * 60 * 1000);

// En-tête compact d'un bloc : icône + titre + court indice (remplace les longs
// paragraphes d'intro par une seule ligne discrète alignée à droite).
function BlockHead({ Icon, title, hint, children }) {
  return (
    <div className="gp-pblock-head">
      <h2 className="gp-h2">
        <Icon size={16} /> {title}
      </h2>
      {hint && <span className="gp-pblock-hint">{hint}</span>}
      {children}
    </div>
  );
}

// Placeholder animé (shimmer) pendant le chargement des patchs.
function PatchSkeleton({ rows = 3 }) {
  return (
    <div className="gp-troph-skel" aria-busy="true">
      <div className="gp-troph-list">
        {Array.from({ length: rows }).map((_, i) => (
          <div className="gp-troph gp-troph-skelrow" key={i}>
            <span className="gp-skel gp-troph-icon" />
            <div className="gp-troph-body">
              <span className="gp-skel gp-skel-bar" style={{ width: "58%" }} />
              <span className="gp-skel gp-skel-bar sm" style={{ width: "82%" }} />
            </div>
            <span className="gp-skel gp-skel-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Octets -> « 1.2 Go » / « 340 Mo ». null si taille inconnue.
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} Go`;
  return `${Math.round(bytes / 1024 ** 2)} Mo`;
}

// Date RFC (pubDate C411) -> « mars 2026 ». null si invalide.
function shortMonth(s) {
  const d = new Date(s);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

// Détail d'un patch FR Switch (nxbrew) : sections Base / Update / DLC, chaque
// hébergeur donnant un ou plusieurs liens (via le raccourcisseur ouo.io).
function SwitchPatch({ patch }) {
  return (
    <div className="gp-swpatch">
      <div className="gp-swpatch-head">
        <span className="gp-patch-name">{patch.title}</span>
        <div className="gp-patch-badges">
          {patch.size && <span className="gp-patch-badge">{patch.size}</span>}
          {patch.updateVersion && (
            <span className="gp-patch-badge">v{patch.updateVersion}</span>
          )}
          <a
            href={patch.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="gp-patch-vndb clickable"
            title="Voir sur nxbrew.net"
          >
            nxbrew <ExternalLink size={12} />
          </a>
        </div>
      </div>
      {patch.sections.map((sec, si) => (
        <div className="gp-swsec" key={si}>
          <span className={`gp-swsec-label ${sec.kind}`}>{sec.label}</span>
          <div className="gp-patch-links">
            {sec.hosts.map((h) =>
              h.links.map((url, i) => (
                <a
                  key={`${h.host}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="gp-patch-dl clickable"
                  title={`${h.host} — ${sec.label}`}
                >
                  <Download size={14} /> {h.host}
                  {h.links.length > 1 ? ` #${i + 1}` : ""}
                </a>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Bloc « Patch FR Switch » : affiche le patch poussé par l'app locale, ou un
// bouton « Demander » (le scraping se fait hors serveur, sur une machine à IP
// résidentielle). Une demande sur un jeu déjà pourvu vaut demande de MAJ.
function SwitchPatchBlock({ data, gameId, token }) {
  const [requested, setRequested] = useState(!!data.switchPatchRequested);
  const [busy, setBusy] = useState(false);

  async function ask() {
    if (busy || !token) return;
    setBusy(true);
    try {
      await apiFetch(`/patches/switch/${gameId}/request`, {
        method: "POST",
        token,
        body: { name: data.name },
      });
      setRequested(true);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  const askBtn = (label) =>
    requested ? (
      <span className="gp-patch-asked">
        <Check size={14} /> Demande envoyée
      </span>
    ) : token ? (
      <button className="gp-patch-ask clickable" onClick={ask} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {label}
      </button>
    ) : (
      <span className="gp-patch-asked">Connecte-toi pour demander ce patch.</span>
    );

  return (
    <section className="gp-block">
      <BlockHead Icon={Gamepad2} title="Patch FR Switch" hint="Patch FR d'origine · nxbrew" />
      {data.switchPatch ? (
        <>
          <SwitchPatch patch={data.switchPatch} />
          <div className="gp-patch-askrow">{askBtn("Demander une mise à jour")}</div>
        </>
      ) : (
        <div className="gp-troph-empty">
          <Gamepad2 size={26} />
          <p className="font-fun">Aucun patch FR Switch pour ce jeu.</p>
          {askBtn("Demander le patch")}
        </div>
      )}
    </section>
  );
}

// --- Bloc « Pack HD » : torrents C411 correspondant au jeu (chargé à la
// demande), regroupés par plateforme, triables par seeders ou par poids.
// Chaque résultat = jaquette + titre + poids + seeders + lien page/.torrent. ---
function HdPacksBlock({ gameId, token }) {
  const [state, setState] = useState({ loading: true, data: null, error: false });
  // Tri : critère (seeders | size) + sens (desc | asc). Défaut : + seedés.
  const [sort, setSort] = useState({ by: "seeders", dir: "desc" });
  // Passkey C411 PERSONNEL, enregistré sur le COMPTE de l'utilisateur (jamais
  // sur un profil public). Sans lui, on ne propose QUE le lien vers la page
  // C411 ; avec lui, le serveur réécrit le .torrent → son ratio.
  const [passkey, setPasskey] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyErr, setKeyErr] = useState("");
  const [dling, setDling] = useState(null); // id du torrent en cours de DL
  // Plateforme active (mini-onglets). null = auto (1re plateforme la + seedée).
  const [activePlat, setActivePlat] = useState(null);

  // Charge le passkey du compte (seulement si connecté).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch(`/users/me/c411`, { token })
      .then((d) => alive && setPasskey(d.passkey || ""))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  const persistKey = async (pk) => {
    setKeyBusy(true);
    setKeyErr("");
    try {
      const d = await apiFetch(`/users/me/c411`, {
        method: "PUT",
        token,
        body: { passkey: pk },
      });
      setPasskey(d.passkey || "");
      setKeyOpen(false);
      setKeyDraft("");
    } catch (e) {
      setKeyErr(e?.message || "Passkey invalide.");
    } finally {
      setKeyBusy(false);
    }
  };
  const saveKey = () => {
    const k = keyDraft.trim();
    if (k) persistKey(k);
  };
  const clearKey = () => persistKey("");

  // Télécharge le .torrent réécrit (serveur) → passe par une requête authentifiée
  // (le header ne peut pas voyager dans un simple <a href>), puis déclenche le
  // téléchargement du blob côté navigateur.
  const downloadTorrent = async (p) => {
    if (!p.id || dling) return;
    setDling(p.id);
    try {
      const res = await fetch(`${API_BASE}/games/${gameId}/hd-packs/${p.id}/torrent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = "Téléchargement impossible.";
        try {
          msg = (await res.json())?.error || msg;
        } catch {
          /* pas de JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.title.slice(0, 120).replace(/[\\/:*?"<>|]+/g, "_")}.torrent`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setKeyErr(e?.message || "Téléchargement impossible.");
      setKeyOpen(true);
    } finally {
      setDling(null);
    }
  };
  const canDl = (p) => passkey && p.id;

  useEffect(() => {
    let alive = true;
    setState({ loading: true, data: null, error: false });
    apiFetch(`/games/${gameId}/hd-packs`, { token })
      .then((d) => alive && setState({ loading: false, data: d, error: false }))
      .catch(() => alive && setState({ loading: false, data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  const toggleSort = (by) =>
    setSort((s) =>
      s.by === by ? { by, dir: s.dir === "desc" ? "asc" : "desc" } : { by, dir: "desc" }
    );

  const packs = state.data?.packs || [];
  const cover = state.data?.cover || null;

  // Comparateur selon le tri courant.
  const cmp = (a, b) => {
    const va = sort.by === "size" ? a.size || 0 : a.seeders || 0;
    const vb = sort.by === "size" ? b.size || 0 : b.seeders || 0;
    return sort.dir === "asc" ? va - vb : vb - va;
  };
  // Regroupe par plateforme ; groupes ordonnés par seeders cumulés (le plus
  // « vivant » d'abord), chaque liste triée selon le critère choisi.
  const groups = {};
  for (const p of packs) (groups[p.platform] ||= []).push(p);
  const groupList = Object.entries(groups)
    .map(([plat, list]) => ({
      plat,
      list: [...list].sort(cmp),
      seed: list.reduce((n, p) => n + (p.seeders || 0), 0),
    }))
    .sort((a, b) => b.seed - a.seed);

  // Onglet actif : celui choisi s'il existe encore, sinon le plus seedé.
  const activeGroup =
    groupList.find((g) => g.plat === activePlat) || groupList[0] || null;

  const SortBtn = ({ by, label }) => (
    <button
      className={`gp-hd-sortbtn clickable ${sort.by === by ? "active" : ""}`}
      onClick={() => toggleSort(by)}
    >
      {label}
      {sort.by === by &&
        (sort.dir === "desc" ? <ChevronDown size={13} /> : <ChevronUp size={13} />)}
    </button>
  );

  return (
    <section className="gp-block">
      <BlockHead Icon={HardDrive} title="Pack HD" hint="Torrents C411 · par plateforme">
        {token && (
          <button
            className={`gp-hd-keybtn clickable ${passkey ? "set" : ""}`}
            onClick={() => {
              setKeyDraft(passkey);
              setKeyErr("");
              setKeyOpen((v) => !v);
            }}
            title="Ton passkey C411 pour le téléchargement direct"
          >
            {passkey ? <ShieldCheck size={13} /> : <KeyRound size={13} />}
            {passkey ? "Passkey actif" : "Passkey C411"}
          </button>
        )}
      </BlockHead>

      {keyOpen && (
        <div className="gp-hd-keypanel">
          <p className="gp-hd-keyinfo">
            Téléchargement direct avec <strong>ton</strong> ratio C411. Ton passkey
            reste privé.{" "}
            <a
              href="https://c411.org/user/integrations"
              target="_blank"
              rel="noreferrer"
              className="gp-hd-keylink"
            >
              Où le trouver ? <ExternalLink size={11} />
            </a>
          </p>
          <div className="gp-hd-keyrow">
            <input
              type="password"
              className="gp-hd-keyinput"
              placeholder="Colle ton passkey C411…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveKey()}
              disabled={keyBusy}
              autoFocus
            />
            <button
              className="gp-hd-keysave clickable"
              onClick={saveKey}
              disabled={keyBusy}
            >
              {keyBusy ? "…" : "Enregistrer"}
            </button>
            {passkey && (
              <button
                className="gp-hd-keyclear clickable"
                onClick={clearKey}
                disabled={keyBusy}
                title="Supprimer le passkey"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {keyErr && <p className="gp-hd-keyerr">{keyErr}</p>}
        </div>
      )}

      {state.loading ? (
        <PatchSkeleton rows={3} />
      ) : state.error ? (
        <div className="gp-troph-empty">
          <HardDrive size={26} />
          <p className="font-fun">Impossible de charger les packs pour l'instant.</p>
        </div>
      ) : !packs.length ? (
        <div className="gp-troph-empty">
          <HardDrive size={26} />
          <p className="font-fun">Aucun pack trouvé sur C411 pour ce jeu.</p>
        </div>
      ) : (
        <>
          {/* Mini-onglets par plateforme + tri sur la même ligne */}
          <div className="gp-hd-bar">
            <div className="gp-hd-tabs" role="tablist">
              {groupList.map(({ plat, list }) => (
                <button
                  key={plat}
                  role="tab"
                  aria-selected={activeGroup?.plat === plat}
                  className={`gp-hd-tab clickable ${activeGroup?.plat === plat ? "active" : ""}`}
                  onClick={() => setActivePlat(plat)}
                >
                  <Gamepad2 size={14} />
                  <span className="gp-hd-platname">{plat}</span>
                  <span className="gp-hd-groupcount">{list.length}</span>
                </button>
              ))}
            </div>
            <div className="gp-hd-sort">
              <SortBtn by="seeders" label="Seeders" />
              <SortBtn by="size" label="Poids" />
            </div>
          </div>

          {activeGroup && (
            <div className="gp-hd-list">
              {activeGroup.list.map((p, i) => (
                <div className="gp-hd-row" key={p.page || p.id || i}>
                  <div className="gp-hd-cover">
                    {cover ? (
                      <img src={cover} alt="" loading="lazy" />
                    ) : (
                      <HardDrive size={18} />
                    )}
                  </div>
                  <div className="gp-hd-main">
                    <span className="gp-hd-title" title={p.title}>
                      {p.title}
                    </span>
                    <div className="gp-hd-meta">
                      {formatSize(p.size) && (
                        <span className="gp-hd-badge">
                          <HardDrive size={11} /> {formatSize(p.size)}
                        </span>
                      )}
                      {p.seeders != null && (
                        <span
                          className={`gp-hd-badge seed ${p.seeders === 0 ? "dead" : ""}`}
                        >
                          <Users2 size={11} /> {p.seeders}
                        </span>
                      )}
                      {shortMonth(p.pubDate) && (
                        <span className="gp-hd-age">{shortMonth(p.pubDate)}</span>
                      )}
                    </div>
                  </div>
                  <div className="gp-hd-actions">
                    {canDl(p) && (
                      <button
                        className="gp-hd-dl clickable"
                        onClick={() => downloadTorrent(p)}
                        disabled={dling === p.id}
                        title="Télécharger le .torrent avec ton passkey C411"
                      >
                        {dling === p.id ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <Magnet size={14} />
                        )}
                        <span>.torrent</span>
                      </button>
                    )}
                    {p.page && (
                      <a
                        href={p.page}
                        target="_blank"
                        rel="noreferrer"
                        className="gp-hd-page clickable"
                        title="Voir sur C411"
                      >
                        <ExternalLink size={13} />
                        <span>C411</span>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// --- Onglet Patchs : Pack HD (C411) + patch FR Switch (nxbrew) + fan-traduction
// FR des visual novels non traduits (VNDB) + liens de recherche de mods. ---
export default function GamePatches({ gameId, token }) {
  const cached = patchCache.get(String(gameId));
  const [loading, setLoading] = useState(!cached);
  const [data, setData] = useState(cached?.data || null);

  useEffect(() => {
    // Vraie logique stale-while-revalidate : on affiche le cache instantanément
    // s'il existe, MAIS on revalide toujours en arrière-plan. Le patch Switch est
    // modifiable de l'extérieur (poussé par l'app locale nxbrew-manager) → il ne
    // faut jamais rester bloqué sur une vieille réponse « aucun patch ».
    const c = patchCache.get(String(gameId));
    let alive = true;
    if (c) setData(c.data); // affiche le cache (frais ou périmé) sans flash
    else setLoading(true);
    apiFetch(`/games/${gameId}/patches`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        patchCache.set(String(gameId), d);
      })
      .catch(() => alive && !c && setData({ error: true }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [gameId, token]);

  if (loading) return <PatchSkeleton rows={4} />;

  if (!data || data.error) {
    return (
      <div className="gp-troph-empty">
        <Wrench size={26} />
        <p className="font-fun">Impossible de charger les patchs pour l'instant.</p>
      </div>
    );
  }

  const vn = data.vnPatches; // null si non pertinent
  const dateLabel = (r) =>
    !r || r === "TBA" || /^0+/.test(r)
      ? null
      : new Date(`${r}`.length === 4 ? `${r}-01-01` : r).toLocaleDateString("fr-FR", {
          year: "numeric",
          month: "long",
          day: /^\d{4}-\d{2}-\d{2}$/.test(r) ? "numeric" : undefined,
        });

  return (
    <div className="gp-patches">
      {/* Pack HD (torrents C411) — pour tout jeu, toujours en premier */}
      <HdPacksBlock gameId={gameId} token={token} />

      {/* Patch FR Switch (nxbrew.net) — seulement si jeu Switch */}
      {data.isSwitch && <SwitchPatchBlock data={data} gameId={gameId} token={token} />}

      {/* Traduction FR (visual novels sans version française) */}
      {vn !== null && (
        <section className="gp-block">
          <BlockHead
            Icon={Languages}
            title="Traduction française"
            hint="Fan-traductions · VNDB"
          />
          {vn.length === 0 ? (
            <div className="gp-troph-empty">
              <Languages size={26} />
              <p className="font-fun">Aucun patch de traduction FR trouvé sur VNDB.</p>
            </div>
          ) : (
            <div className="gp-patch-list">
              {vn.map((r) => (
                <div className="gp-patch" key={r.id}>
                  <div className="gp-patch-body">
                    <span className="gp-patch-name">{r.title}</span>
                    <div className="gp-patch-badges">
                      <span className={`gp-patch-badge ${r.official ? "official" : "fan"}`}>
                        {r.official ? "Officiel" : "Fan-trad"}
                      </span>
                      {r.patch && <span className="gp-patch-badge">Patch</span>}
                      {r.mtl && <span className="gp-patch-badge warn">Auto-trad</span>}
                      {dateLabel(r.released) && (
                        <span className="gp-patch-date">
                          <Calendar size={12} /> {dateLabel(r.released)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="gp-patch-links">
                    {r.links.slice(0, 4).map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="gp-patch-dl clickable"
                        title={l.label}
                      >
                        <Download size={14} /> {l.label}
                      </a>
                    ))}
                    <a
                      href={r.vndbUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="gp-patch-vndb clickable"
                      title="Voir sur VNDB"
                    >
                      VNDB <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Mods : liens de recherche vers les grandes plateformes */}
      <section className="gp-block">
        <BlockHead Icon={Package} title="Mods" hint="Sur les grandes plateformes" />
        <div className="gp-links">
          {(data.modLinks || []).map((m) => (
            <a
              key={m.key}
              href={m.url}
              target="_blank"
              rel="noreferrer"
              className="gp-link clickable"
            >
              {m.label}
              <ExternalLink size={13} />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
