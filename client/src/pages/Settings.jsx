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
  Trophy,
  Swords,
} from "lucide-react";
import { apiFetch, API_BASE } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import SteamIcon from "../components/SteamIcon";
import SteamImportModal from "../components/SteamImportModal";
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
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab = TAB_KEYS.includes(urlTab) ? urlTab : "imports";
  const setTab = (key) => setParams({ tab: key }, { replace: true });

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
      <SteamCard />
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

// Carte de liaison générique (Marvel Rivals / LoL) : logo (jaquette du jeu) +
// titre, état connecté (avatar + rang, bouton Délier à droite) ou formulaire de
// recherche/liaison en dessous. `Form` = MarvelLinkForm | LeagueLinkForm.
function TrackerCard({ status, reload, cover, provider, name, desc, Form }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const tracker = status?.trackers?.find((t) => t.provider === provider);
  const connected = !!tracker;
  const snap = tracker?.snapshot;
  const avatar = snap?.icon || snap?.heroes?.[0]?.thumb;

  async function unlink() {
    setBusy(true);
    try {
      await apiFetch(`/trackers/${provider}`, { method: "DELETE", token });
      await reload();
    } catch {
      /* best-effort */
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
                </span>
              )}
            </div>
            {connected ? (
              <div className="trk-connected">
                <TrackerAvatar src={avatar} name={tracker.externalName} size={36} />
                <div className="trk-connected-txt">
                  <strong>{tracker.externalName || "Compte lié"}</strong>
                  {snap?.rank?.tier && (
                    <span className="trk-connected-rank">
                      {snap.rank.image && <Emblem src={snap.rank.image} size={18} />}
                      {snap.rank.tier}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="import-card-desc">{desc}</p>
            )}
          </div>
        </div>
        {connected && (
          <button
            className="btn-ghost-danger clickable trk-unlink"
            onClick={unlink}
            disabled={busy}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Link2Off size={16} />}
            <span>Délier</span>
          </button>
        )}
      </div>

      {!connected && <Form status={status} onLinked={reload} />}
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
        <div className="import-soon-chip">
          <Trophy size={14} /> PlayStation — bientôt
        </div>
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
