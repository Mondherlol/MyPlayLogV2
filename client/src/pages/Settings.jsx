import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DownloadCloud,
  UserCog,
  Palette,
  Bell,
  ShieldCheck,
  Link2,
  Link2Off,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Gamepad2,
  Swords,
  RefreshCw,
  Check,
  X,
  Trophy,
  RotateCcw,
  Plus,
  VenetianMask,
} from "lucide-react";
import { apiFetch, API_BASE } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import SteamIcon from "../components/SteamIcon";
import SteamImportModal from "../components/SteamImportModal";
import PsnIcon from "../components/PsnIcon";
import PsnImportModal, {
  ConsolePicker,
  GameSearchPicker,
  psConsolesFromPlatforms,
  PLAYED_STATUSES,
  fmtHours,
} from "../components/PsnImportModal";
import {
  CoverLogo,
  Emblem,
  TrackerAvatar,
  MarvelLinkForm,
  LeagueLinkForm,
} from "../components/TrackerLink";

const TAB_KEYS = ["imports", "tracking", "account", "appearance", "notifications", "privacy"];

// Onglets de la page Paramètres (façon Discord / Steam). Seul « Imports » est
// actif pour l'instant ; les autres sont là pour montrer la structure.
const TABS = [
  { key: "imports", label: "Imports", Icon: DownloadCloud },
  { key: "tracking", label: "Tracking", Icon: Swords },
  { key: "account", label: "Compte", Icon: UserCog, soon: true },
  { key: "appearance", label: "Apparence", Icon: Palette, soon: true },
  { key: "notifications", label: "Notifications", Icon: Bell, soon: true },
  { key: "privacy", label: "Confidentialité", Icon: ShieldCheck, soon: true },
];

// Ouvre une pop-up centrée (flux OpenID « Sign in through Steam »).
function openCentered(url, w = 720, h = 720) {
  const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
  const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
  return window.open(
    url,
    "steam-login",
    `width=${w},height=${h},left=${x},top=${y}`
  );
}

export default function Settings() {
  // L'onglet actif se lit dans l'URL (?tab=…) → liens profonds vers « Tracking ».
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab = TAB_KEYS.includes(urlTab) ? urlTab : "imports";
  const setTab = (key) => setParams({ tab: key }, { replace: true });

  // Badge « à valider » sur l'onglet Imports (jeux détectés par une synchro PSN).
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    apiFetch("/psn/status", { token })
      .then((s) => setPendingCount(s?.pending || 0))
      .catch(() => {});
  }, [token]);

  return (
    <div className="settings-page">
      <header className="settings-head">
        <h1>Paramètres</h1>
        <p>Gère tes imports, ton compte et l'apparence de MyPlayLog.</p>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map(({ key, label, Icon, soon }) => (
            <button
              key={key}
              className={`settings-tab clickable ${tab === key ? "active" : ""}`}
              onClick={() => !soon && setTab(key)}
              disabled={soon}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === "imports" && pendingCount > 0 && (
                <span className="settings-tab-badge">{pendingCount}</span>
              )}
              {soon && <span className="settings-soon">bientôt</span>}
            </button>
          ))}
        </nav>

        <section className="settings-panel">
          {tab === "imports" && <ImportsPanel />}
          {tab === "tracking" && <TrackingPanel />}
        </section>
      </div>
    </div>
  );
}

function ImportsPanel() {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <DownloadCloud size={20} /> Imports
      </h2>
      <p className="settings-section-sub">
        Relie tes plateformes pour importer ta bibliothèque et tes succès. Rien
        n'est ajouté sans ta validation.
      </p>
      <div className="import-cards">
        <SteamCard />
        <PsnCard />
      </div>
    </div>
  );
}

// Onglet « Tracking » : liaison des comptes de jeux compétitifs. Un seul appel
// /trackers/status partagé (état + config serveur) évite de charger deux fois.
function TrackingPanel() {
  const { token } = useAuth();
  const [status, setStatus] = useState(null);

  async function load() {
    try {
      const s = await apiFetch("/trackers/status", { token });
      setStatus(s);
    } catch {
      setStatus({ configured: false, lolConfigured: false, trackers: [] });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <Swords size={20} /> Tracking in-game
      </h2>
      <p className="settings-section-sub">
       Ton rang, champions et parties jouées sont synchronisés automatiquement.
      </p>
      <div className="trk-cards">
        <MarvelRivalsCard
          status={status}
          reload={load}
          cover={status?.games?.["marvel-rivals"]}
        />
        <LeagueCard
          status={status}
          reload={load}
          cover={status?.games?.["league-of-legends"]}
        />
      </div>
    </div>
  );
}

// Nombre max de comptes liés par jeu : le principal + 3 smurfs.
const MAX_TRACKER_ACCOUNTS = 4;

// Une ligne de compte lié (principal ou smurf) : avatar + pseudo + rang, badge
// « Smurf » quand slot > 0, bouton Délier propre à la ligne.
function TrackerAccountRow({ tracker, onUnlink, busy }) {
  const snap = tracker?.snapshot;
  const avatar = snap?.icon || snap?.heroes?.[0]?.thumb || snap?.champions?.[0]?.thumb;
  return (
    <div className="trk-connected trk-acc-row">
      <TrackerAvatar src={avatar} name={tracker.externalName} size={36} />
      <div className="trk-connected-txt">
        <strong>
          {tracker.externalName || "Compte lié"}
          {tracker.smurf && (
            <span className="trk-smurf-badge" title="Compte secondaire">
              <VenetianMask size={12} /> Smurf
            </span>
          )}
        </strong>
        {snap?.rank?.tier && (
          <span className="trk-connected-rank">
            {snap.rank.image && <Emblem src={snap.rank.image} size={18} />}
            {snap.rank.tier}
          </span>
        )}
      </div>
      <button
        className="btn-ghost-danger clickable trk-unlink"
        onClick={onUnlink}
        disabled={busy}
        title="Délier ce compte"
      >
        {busy ? <Loader2 className="spin" size={16} /> : <Link2Off size={16} />}
        <span>Délier</span>
      </button>
    </div>
  );
}

// Carte de liaison générique (Marvel Rivals / LoL) : logo (jaquette du jeu) +
// titre, puis la liste des comptes liés (principal + smurfs, jusqu'à 4) avec un
// bouton « Ajouter un smurf » qui déplie le formulaire de liaison sur le premier
// slot libre. `Form` = MarvelLinkForm | LeagueLinkForm.
function TrackerCard({ status, reload, cover, provider, name, desc, Form }) {
  const { token } = useAuth();
  const [busySlot, setBusySlot] = useState(null); // slot en cours de déliaison
  const [adding, setAdding] = useState(false); // formulaire smurf déplié
  const accounts = (status?.trackers || [])
    .filter((t) => t.provider === provider)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0));
  const connected = accounts.length > 0;
  // Premier slot libre (0..3) pour la prochaine liaison.
  const usedSlots = new Set(accounts.map((t) => t.slot || 0));
  let nextSlot = null;
  for (let s = 0; s < MAX_TRACKER_ACCOUNTS; s++) {
    if (!usedSlots.has(s)) {
      nextSlot = s;
      break;
    }
  }

  async function unlink(slot) {
    setBusySlot(slot);
    try {
      await apiFetch(`/trackers/${provider}?slot=${slot}`, { method: "DELETE", token });
      await reload();
    } catch {
      /* best-effort */
    } finally {
      setBusySlot(null);
    }
  }

  if (!status) {
    return (
      <div className="import-card">
        <Loader2 className="spin" size={20} /> Chargement…
      </div>
    );
  }

  return (
    <div className={`import-card trk-card ${provider} ${connected ? "connected" : ""}`}>
      <div className="import-card-glow" />
      <div className="import-card-head">
        <div className="import-card-main">
          <CoverLogo cover={cover} className={`${provider}-logo`}>
            <Swords size={26} />
          </CoverLogo>
          <div className="import-card-info">
            <div className="import-card-title">
              {name}
              {connected && (
                <span className="import-badge">
                  <CheckCircle2 size={13} /> Lié
                  {accounts.length > 1 && ` · ${accounts.length} comptes`}
                </span>
              )}
            </div>
            {!connected && <p className="import-card-desc">{desc}</p>}
          </div>
        </div>
      </div>

      {connected && (
        <div className="trk-acc-list">
          {accounts.map((t) => (
            <TrackerAccountRow
              key={t.slot || 0}
              tracker={t}
              busy={busySlot === (t.slot || 0)}
              onUnlink={() => unlink(t.slot || 0)}
            />
          ))}
        </div>
      )}

      {/* Liaison : directe quand rien n'est lié, dépliée via « Ajouter un
          smurf » ensuite (jusqu'à 3 smurfs en plus du compte principal). */}
      {!connected && <Form status={status} onLinked={reload} slot={0} />}
      {connected && nextSlot != null && !adding && (
        <button className="trk-add-smurf clickable" onClick={() => setAdding(true)}>
          <VenetianMask size={15} />
          <span>Ajouter un smurf</span>
          <Plus size={14} />
        </button>
      )}
      {connected && adding && nextSlot != null && (
        <div className="trk-add-form">
          <div className="trk-add-form-head">
            <span className="trk-smurf-badge">
              <VenetianMask size={12} /> Nouveau smurf
            </span>
            <button
              className="trk-add-cancel clickable"
              onClick={() => setAdding(false)}
              title="Annuler"
            >
              <X size={14} />
            </button>
          </div>
          <Form
            status={status}
            slot={nextSlot}
            autoFocus
            onLinked={async () => {
              setAdding(false);
              await reload();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MarvelRivalsCard({ status, reload, cover }) {
  return (
    <TrackerCard
      status={status}
      reload={reload}
      cover={cover}
      provider="marvel-rivals"
      name="Marvel Rivals"
      desc="Ton identifiant ou l'URL de ton profil rivalsmeta."
      Form={MarvelLinkForm}
    />
  );
}

function LeagueCard({ status, reload, cover }) {
  return (
    <TrackerCard
      status={status}
      reload={reload}
      cover={cover}
      provider="league-of-legends"
      name="League of Legends"
      desc="Ton Riot ID (Pseudo#TAG) + ta région. Synchro automatique."
      Form={LeagueLinkForm}
    />
  );
}

function SteamCard() {
  const { token, user, updateUser } = useAuth();
  const { refresh } = useLibrary();
  const [status, setStatus] = useState(null); // { configured, connected, steam }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [removeGames, setRemoveGames] = useState(false);
  const [importing, setImporting] = useState(false);
  const popupRef = useRef(null);

  async function load() {
    try {
      const s = await apiFetch("/steam/status", { token });
      setStatus(s);
    } catch (e) {
      setStatus({ configured: true, connected: false });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Écoute le message renvoyé par la pop-up OpenID à la fin de la liaison.
  useEffect(() => {
    function onMsg(e) {
      if (e.data?.type !== "mpl-steam") return;
      setBusy(false);
      if (e.data.ok) {
        setError(null);
        load();
        updateUser({ steamConnected: true });
      } else {
        setError(e.data.error || "La liaison Steam a échoué.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectSteam() {
    setError(null);
    setBusy(true);
    const url = `${API_BASE}/steam/login?token=${encodeURIComponent(token)}`;
    popupRef.current = openCentered(url);
    // Si la pop-up est fermée sans finir, on relâche l'état occupé.
    const timer = setInterval(() => {
      if (popupRef.current?.closed) {
        clearInterval(timer);
        setBusy((b) => {
          if (b) load();
          return false;
        });
      }
    }, 700);
  }

  async function linkManual() {
    if (!manualInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/steam/link-manual", {
        method: "POST",
        token,
        body: { input: manualInput.trim() },
      });
      setManualOpen(false);
      setManualInput("");
      updateUser({ steamConnected: true });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/steam?removeGames=${removeGames}`, {
        method: "DELETE",
        token,
      });
      setUnlinkOpen(false);
      setRemoveGames(false);
      updateUser({ steamConnected: false, steam: null });
      await load();
      if (removeGames) await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="import-card">
        <Loader2 className="spin" size={20} /> Chargement…
      </div>
    );
  }

  const connected = status.connected;
  const steam = status.steam;

  return (
    <div className={`import-card steam ${connected ? "connected" : ""}`}>
      <div className="import-card-glow" />
      <div className="import-card-main">
        <div className="import-logo steam-logo">
          <SteamIcon size={30} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            Steam
            {connected && (
              <span className="import-badge">
                <CheckCircle2 size={13} /> Lié
              </span>
            )}
          </div>
          {connected && steam ? (
            <div className="import-steam-user">
              {steam.avatar && <img src={steam.avatar} alt="" />}
              <div>
                <strong>{steam.personaName || "Compte Steam"}</strong>
                <span>
                  Lié{" "}
                  {steam.connectedAt
                    ? new Date(steam.connectedAt).toLocaleDateString("fr-FR")
                    : ""}
                </span>
              </div>
            </div>
          ) : (
            <p className="import-card-desc">
              Connecte-toi avec Steam pour importer tes jeux et tes succès. Ton
              profil Steam doit être <strong>public</strong>.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="import-error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {!status.configured && (
        <div className="import-error">
          <AlertTriangle size={15} /> Steam n'est pas configuré côté serveur
          (STEAM_API_KEY).
        </div>
      )}

      <div className="import-actions">
        {connected ? (
          <>
            <button
              className="btn-steam-primary clickable"
              onClick={() => setImporting(true)}
              disabled={busy}
            >
              <Gamepad2 size={17} /> Importer mes jeux
            </button>
            <button
              className="btn-ghost-danger clickable"
              onClick={() => setUnlinkOpen(true)}
              disabled={busy}
            >
              <Link2Off size={16} /> Délier
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-steam-primary clickable"
              onClick={connectSteam}
              disabled={busy || !status.configured}
            >
              {busy ? <Loader2 className="spin" size={17} /> : <Link2 size={17} />}
              Se connecter avec Steam
            </button>
            <button
              className="btn-ghost-link clickable"
              onClick={() => setManualOpen((v) => !v)}
            >
              ou coller mon profil
            </button>
          </>
        )}
      </div>

      {manualOpen && !connected && (
        <div className="import-manual">
          <input
            type="text"
            placeholder="steamcommunity.com/id/toi ou SteamID64"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && linkManual()}
          />
          <button className="btn-steam-primary clickable" onClick={linkManual} disabled={busy}>
            Lier
          </button>
        </div>
      )}

      {/* Confirmation de déliaison : retirer ou garder les jeux importés. */}
      {unlinkOpen && (
        <div className="import-unlink">
          <p>Délier ton compte Steam ?</p>
          <label className="import-check">
            <input
              type="checkbox"
              checked={removeGames}
              onChange={(e) => setRemoveGames(e.target.checked)}
            />
            <span>
              Retirer aussi les jeux ajoutés par l'import Steam (tes jeux
              existants et modifiés à la main sont conservés).
            </span>
          </label>
          <div className="import-unlink-actions">
            <button className="btn-ghost clickable" onClick={() => setUnlinkOpen(false)}>
              Annuler
            </button>
            <button className="btn-ghost-danger clickable" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="spin" size={15} /> : <Link2Off size={15} />}
              Délier
            </button>
          </div>
        </div>
      )}

      {/* Autres plateformes à venir */}
      <div className="import-soon-row">
        <div className="import-soon-chip">Xbox — bientôt</div>
      </div>

      {importing && (
        <SteamImportModal
          onClose={() => setImporting(false)}
          onDone={async () => {
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// Carte d'import PlayStation. La liaison se fait avec le PSN ID : le serveur lit
// les trophées PUBLICS via son propre compte (aucun secret côté utilisateur).
function PsnCard() {
  const { token, updateUser } = useAuth();
  const { refresh } = useLibrary();
  const [status, setStatus] = useState(null); // { configured, connected, psn }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [psnId, setPsnId] = useState("");
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [removeGames, setRemoveGames] = useState(false);
  const [sent, setSent] = useState(false);
  const [importing, setImporting] = useState(false);

  async function load() {
    try {
      const s = await apiFetch("/psn/status", { token });
      setStatus(s);
    } catch {
      setStatus({ configured: false, connected: false });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demande de synchro PSN, traitée par le worker maison (l'IP du serveur étant
  // bloquée par Sony). withId=true → 1re liaison (le PSN ID est fourni) ;
  // false → simple re-synchro d'un compte déjà lié.
  async function requestSync(withId) {
    if (withId && !psnId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/psn/request", {
        method: "POST",
        token,
        body: withId ? { psnId: psnId.trim() } : {},
      });
      setPsnId("");
      setConnectOpen(false);
      setSent(true);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/psn?removeGames=${removeGames}`, {
        method: "DELETE",
        token,
      });
      setUnlinkOpen(false);
      setRemoveGames(false);
      updateUser({ psnConnected: false, psn: null });
      await load();
      if (removeGames) await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="import-card">
        <Loader2 className="spin" size={20} /> Chargement…
      </div>
    );
  }

  const connected = status.connected;
  const psn = status.psn;
  const req = status.request; // { status } en cours, ou null
  const scan = status.scan; // { games, unmatched, total } prêt à importer, ou null

  return (
    <div className={`import-card psn ${connected ? "connected" : ""}`}>
      <div className="import-card-glow psn-glow" />
      <div className="import-card-main">
        <div className="import-logo psn-logo">
          <PsnIcon size={30} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            PlayStation
            {connected && (
              <span className="import-badge">
                <CheckCircle2 size={13} /> Lié
              </span>
            )}
          </div>
          {connected && psn ? (
            <div className="import-steam-user">
              {psn.avatar && <img src={psn.avatar} alt="" />}
              <div>
                <strong>{psn.onlineId || "Compte PSN"}</strong>
                <span>
                  Lié{" "}
                  {psn.connectedAt
                    ? new Date(psn.connectedAt).toLocaleDateString("fr-FR")
                    : ""}
                </span>
              </div>
            </div>
          ) : (
            <p className="import-card-desc">
              Relie ton compte PlayStation pour importer tes jeux, ton temps de
              jeu et tes trophées.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="import-error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {/* Bannière : demande en attente / en cours de traitement par le worker. */}
      {req ? (
        <div className="psn-request-banner">
          <Loader2 size={15} className="spin" />
          {req.status === "processing"
            ? "Synchro en cours de traitement…"
            : "Demande envoyée — en attente de traitement. Tu recevras une notification quand ton import sera prêt."}
        </div>
      ) : sent ? (
        <div className="psn-request-banner ok">
          <CheckCircle2 size={15} /> Demande envoyée.
        </div>
      ) : null}

      <div className="import-actions">
        {connected ? (
          <>
            {scan && scan.total > 0 && !req && (
              <button
                className="btn-psn-primary clickable"
                onClick={() => setImporting(true)}
              >
                <Gamepad2 size={17} /> Importer mes jeux ({scan.total})
              </button>
            )}
            {!req && (
              <button
                className="btn-ghost clickable"
                onClick={() => requestSync(false)}
                disabled={busy}
                title="Relancer un scan de ta bibliothèque PlayStation"
              >
                {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}{" "}
                Actualiser
              </button>
            )}
            <button
              className="btn-ghost-danger clickable"
              onClick={() => setUnlinkOpen(true)}
              disabled={busy}
            >
              <Link2Off size={16} /> Délier
            </button>
          </>
        ) : (
          !req && (
            <button
              className="btn-psn-primary clickable"
              onClick={() => setConnectOpen((v) => !v)}
              disabled={busy}
            >
              <Link2 size={17} /> Connecter mon compte PlayStation
            </button>
          )
        )}
      </div>

      {connected && psn?.lastSyncAt && (
        <div className="psn-sync-line">
          <span>
            Dernière synchro le{" "}
            {new Date(psn.lastSyncAt).toLocaleString("fr-FR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}

      {/* Modale d'import : l'utilisateur valide jeu par jeu (statut, console,
          trophées). Alimentée par le scan mis en cache par le worker maison. */}
      {importing && (
        <PsnImportModal
          onClose={() => {
            setImporting(false);
            load();
          }}
          onDone={async () => {
            await refresh();
            await load();
          }}
        />
      )}

      {/* Première liaison : on enregistre une DEMANDE (traitée par le worker). */}
      {connectOpen && !connected && !req && (
        <div className="psn-connect">
          <div className="import-manual">
            <input
              type="text"
              placeholder="Ton PSN ID (identifiant en ligne)"
              value={psnId}
              onChange={(e) => setPsnId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && requestSync(true)}
            />
            <button
              className="btn-psn-primary clickable"
              onClick={() => requestSync(true)}
              disabled={busy || !psnId.trim()}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Link2 size={16} />}
              Envoyer la demande
            </button>
          </div>
          <p className="psn-note">
            Ton profil PlayStation et tes trophées doivent être <strong>publics</strong>{" "}
            (réglages PSN → Confidentialité). Ta demande est traitée manuellement — tu
            seras notifié dès que ton import est prêt.
          </p>
        </div>
      )}

      {/* Confirmation de déliaison : retirer ou garder les jeux importés. */}
      {unlinkOpen && (
        <div className="import-unlink">
          <p>Délier ton compte PlayStation ?</p>
          <label className="import-check">
            <input
              type="checkbox"
              checked={removeGames}
              onChange={(e) => setRemoveGames(e.target.checked)}
            />
            <span>
              Retirer aussi les jeux ajoutés par l'import PSN (tes jeux existants
              et modifiés à la main sont conservés).
            </span>
          </label>
          <div className="import-unlink-actions">
            <button className="btn-ghost clickable" onClick={() => setUnlinkOpen(false)}>
              Annuler
            </button>
            <button className="btn-ghost-danger clickable" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="spin" size={15} /> : <Link2Off size={15} />}
              Délier
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// Gère les jeux « en attente de validation » (détectés par une synchro) et la
// liste des jeux « ignorés ». Rendu sous la carte PlayStation des Paramètres.
function PsnPendingManager({ token, reloadKey, onChanged }) {
  const [data, setData] = useState(null); // { pending, ignored }
  const [busyId, setBusyId] = useState(null);
  const [showIgnored, setShowIgnored] = useState(false);

  async function load() {
    try {
      const d = await apiFetch("/psn/pending", { token });
      setData(d);
    } catch {
      setData({ pending: [], ignored: [] });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  if (!data) return null;
  const { pending = [], ignored = [] } = data;
  if (!pending.length && !ignored.length) return null;

  async function act(id, path, body) {
    setBusyId(id);
    try {
      await apiFetch(`/psn/pending/${id}/${path}`, { method: "POST", token, body });
      await load();
      onChanged?.();
    } catch {
      /* best-effort */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="psn-pending">
      {pending.length > 0 && (
        <div className="psn-pending-block">
          <div className="psn-pending-head">
            <Gamepad2 size={16} /> {pending.length} jeu{pending.length > 1 ? "x" : ""} à
            valider
          </div>
          <div className="psn-pending-list">
            {pending.map((p) => (
              <PendingCard
                key={p.id}
                p={p}
                busy={busyId === p.id}
                token={token}
                onValidate={(body) => act(p.id, "validate", body)}
                onIgnore={() => act(p.id, "ignore")}
              />
            ))}
          </div>
        </div>
      )}

      {ignored.length > 0 && (
        <div className="psn-pending-block">
          <button
            className="psn-ignored-toggle clickable"
            onClick={() => setShowIgnored((v) => !v)}
          >
            {ignored.length} jeu{ignored.length > 1 ? "x" : ""} ignoré
            {ignored.length > 1 ? "s" : ""} {showIgnored ? "▲" : "▼"}
          </button>
          {showIgnored && (
            <div className="psn-ignored-list">
              {ignored.map((p) => (
                <div key={p.id} className="psn-ignored-row">
                  <span className="psn-ignored-name">{p.name || p.psnName}</span>
                  <button
                    className="btn-ghost clickable"
                    disabled={busyId === p.id}
                    onClick={() => act(p.id, "restore")}
                  >
                    {busyId === p.id ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}{" "}
                    Reproposer
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Carte d'un jeu en attente : jeu détecté (ou à choisir si non reconnu), statut,
// console, puis Valider / Ignorer.
function PendingCard({ p, busy, token, onValidate, onIgnore }) {
  const [sel, setSel] = useState({
    gameId: p.gameId,
    name: p.name,
    cover: p.cover,
    console: p.suggestedConsole || null,
    status: p.suggestedStatus || "paused",
    consoles: p.consoles || [],
  });

  function pickGame(game) {
    const cons = psConsolesFromPlatforms(game.platforms);
    setSel((s) => ({
      ...s,
      gameId: game.id,
      name: game.name,
      cover: game.cover,
      consoles: cons,
      console: cons[0]?.name || null,
    }));
  }

  const ready = !!sel.gameId;

  return (
    <div className="psn-pending-card">
      <div className="psn-pending-main">
        <div className="steam-game-cover psn-pending-cover">
          {sel.cover ? (
            <img src={sel.cover} alt="" />
          ) : p.icon ? (
            <img src={p.icon} alt="" />
          ) : (
            <PsnIcon size={18} />
          )}
        </div>
        <div className="psn-pending-info">
          <div className="steam-game-name">{sel.name || p.psnName}</div>
          <div className="steam-game-meta">
            {p.playtimeHours > 0 && <span>{fmtHours(p.playtimeHours)} de jeu</span>}
            {p.definedTrophies > 0 && (
              <span className="psn-unmatched-trophy">
                <Trophy size={12} />
                {p.trophyProgress != null ? `${p.trophyProgress}%` : "trophées"}
              </span>
            )}
          </div>
        </div>
        <button
          className="psn-pending-dismiss clickable"
          onClick={onIgnore}
          disabled={busy}
          title="Ignorer ce jeu"
        >
          <X size={15} />
        </button>
      </div>

      {ready ? (
        <>
          <div className="steam-status-pick">
            {PLAYED_STATUSES.map(({ key, label, Icon }) => (
              <button
                key={key}
                className={`steam-status-btn clickable ${sel.status === key ? "active" : ""}`}
                onClick={() => setSel((s) => ({ ...s, status: key }))}
                title={label}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {sel.consoles?.length > 0 && (
            <ConsolePicker
              options={sel.consoles}
              value={sel.console}
              onChange={(nm) => setSel((s) => ({ ...s, console: nm }))}
            />
          )}
          <div className="psn-pending-actions">
            <button
              className="psn-relink clickable"
              onClick={() => setSel((s) => ({ ...s, gameId: null }))}
              title="Choisir un autre jeu"
            >
              <RefreshCw size={13} /> Changer
            </button>
            <button
              className="btn-psn-primary clickable"
              disabled={busy}
              onClick={() =>
                onValidate({
                  gameId: sel.gameId,
                  name: sel.name,
                  cover: sel.cover,
                  platform: sel.console,
                  status: sel.status,
                  importTrophies: true,
                })
              }
            >
              {busy ? <Loader2 className="spin" size={15} /> : <Check size={15} />} Valider
            </button>
          </div>
        </>
      ) : (
        <div className="psn-pending-search">
          <GameSearchPicker
            query={(p.psnName || "").replace(/[™®©℠]/g, "").trim()}
            token={token}
            onPick={pickGame}
          />
        </div>
      )}
    </div>
  );
}
