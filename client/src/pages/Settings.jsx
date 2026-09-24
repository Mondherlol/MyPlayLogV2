import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DownloadCloud,
  Download,
  Monitor,
  UserCog,
  Palette,
  Star,
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
  Lock,
  Globe,
  EyeOff,
  ImageOff,
  MessageSquareText,
  UserPlus,
  UserCheck,
  UserX,
  Inbox,
  Newspaper,
  Users,
  ListMusic,
  Image,
  Repeat2,
  Music,
  Zap,
  SpellCheck,
  PackageOpen,
  Boxes,
  Library,
  Video,
  Sparkles,
  Send,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  PhoneCall,
  Bot,
  MessageCircle,
  KeyRound,
} from "lucide-react";
import { apiFetch, API_BASE } from "../lib/api";
import BackloggdImportModal from "../components/BackloggdImportModal";
import {
  getRatingScale,
  setRatingScale,
  SCALE_100,
  SCALE_STARS,
} from "../lib/ratingScale";
import { useAuth } from "../context/AuthContext";
import RingtonePicker from "../components/RingtonePicker";
import FontPicker from "../components/FontPicker";
import { useLibrary } from "../context/LibraryContext";
import SteamIcon from "../components/SteamIcon";
import DiscordIcon from "../components/DiscordIcon";
import GoogleIcon from "../components/GoogleIcon";
import BackloggdIcon from "../components/BackloggdIcon";
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

const TAB_KEYS = [
  "imports",
  "tracking",
  "feed",
  "account",
  "appearance",
  "notifications",
  "privacy",
  "calls",
  "discord",
  "appearance",
];

// Onglets de la page Paramètres (façon Discord / Steam). Les onglets marqués
// `soon` sont là pour montrer la structure et restent désactivés.
const TABS = [
  { key: "imports", label: "Imports", Icon: DownloadCloud },
  { key: "tracking", label: "Tracking", Icon: Swords },
  { key: "feed", label: "Fil d'accueil", Icon: Newspaper },
  { key: "privacy", label: "Confidentialité", Icon: ShieldCheck },
  { key: "calls", label: "Appels", Icon: PhoneCall },
  { key: "discord", label: "Discord & bot", Icon: Bot },
  { key: "account", label: "Compte", Icon: UserCog },
  { key: "appearance", label: "Apparence", Icon: Palette },
  { key: "notifications", label: "Notifications", Icon: Bell, soon: true },
];

// Ouvre une pop-up centrée (flux OpenID « Sign in through Steam »).
function openCentered(url, w = 720, h = 720, name = "mpl-oauth") {
  const y = window.top.outerHeight / 2 + window.top.screenY - h / 2;
  const x = window.top.outerWidth / 2 + window.top.screenX - w / 2;
  return window.open(
    url,
    name,
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

  // Badge « à valider » sur l'onglet Imports : jeux détectés par une synchro
  // PSN, et ce que le compagnon PC a envoyé.
  const [psnPending, setPsnPending] = useState(0);
  const [companionPending, setCompanionPending] = useState(0);
  const pendingCount = psnPending + companionPending;
  // Badge « demandes d'abonnement » sur l'onglet Confidentialité (compte privé).
  const [requestCount, setRequestCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    apiFetch("/psn/status", { token })
      .then((s) => setPsnPending(s?.pending || 0))
      .catch(() => {});
    apiFetch("/companion/devices", { token })
      .then((d) => setCompanionPending(d?.pending || 0))
      .catch(() => {});
    apiFetch("/users/me/follow-requests", { token })
      .then((d) => setRequestCount(d?.count || 0))
      .catch(() => {});
  }, [token]);

  return (
    <div className="settings-page">
      <header className="settings-head">
        <h1>Paramètres</h1>
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
              {key === "privacy" && requestCount > 0 && (
                <span className="settings-tab-badge">{requestCount}</span>
              )}
              {soon && <span className="settings-soon">bientôt</span>}
            </button>
          ))}
        </nav>

        <section className="settings-panel">
          {tab === "imports" && <ImportsPanel />}
          {tab === "tracking" && <TrackingPanel />}
          {tab === "feed" && <FeedPanel />}
          {tab === "privacy" && <PrivacyPanel onCount={setRequestCount} />}
          {tab === "calls" && <CallsPanel />}
          {tab === "discord" && <DiscordPanel />}
          {tab === "account" && <ConnectionsPanel />}
          {tab === "appearance" && <AppearancePanel />}
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
      <div className="import-cards">
        <SteamCard />
        <PsnCard />
        <BackloggdCard />
        <CompanionCard />
      </div>
      <div className="import-soon-row">
        <span className="import-soon-chip">Xbox · bientôt</span>
      </div>
    </div>
  );
}

// Carte en cours de chargement : la place d'une ligne, sans texte.
function CardLoading() {
  return (
    <div className="import-card is-loading">
      <Loader2 className="spin" size={16} />
    </div>
  );
}

// --- Backloggd : pas de liaison de compte, juste une adresse ---
// Contrairement à Steam et PSN, il n'y a rien à relier : Backloggd n'a ni API
// ni connexion tierce. On lit les pages PUBLIQUES du profil, ce qui veut dire
// deux choses — l'utilisateur n'a aucun jeton à donner, et sa bibliothèque doit
// être publique.
function BackloggdCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="import-card">
        <div className="import-card-main">
          <div className="import-logo bl-logo">
            <BackloggdIcon size={22} />
          </div>
          <div className="import-card-info">
            <div className="import-card-title">Backloggd</div>
            <p className="import-card-desc">Notes, avancement et avis</p>
          </div>
        </div>
        <div className="import-actions">
          <button className="btn-set-primary clickable" onClick={() => setOpen(true)}>
            <DownloadCloud size={15} /> Importer
          </button>
        </div>
      </div>
      {open &&
        createPortal(
          <BackloggdImportModal onClose={() => setOpen(false)} />,
          document.body
        )}
    </>
  );
}

// --- Compagnon PC : les jeux hors boutique -------------------------------
// Une petite application Windows (companion/ dans le dépôt) qui lit les
// fichiers des émulateurs de succès et compte le temps passé dans les jeux
// lancés hors de Steam. On la relie avec un code à 6 chiffres, valable dix
// minutes : le PC reçoit SON jeton, limité à ses envois et révocable ici.
// Pendant qu'un code est affiché, on regarde toutes les 4 s si un PC est
// arrivé — la liaison se voit ici sans recharger.
//
// Le fichier est servi par le SITE (client/public/downloads, copié par
// companion/build.ps1) : le conteneur de l'API ne voit pas le dossier companion/.
const COMPANION_EXE = "/downloads/MyPlayLogCompagnon.exe";
const relTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function seenAgo(date) {
  const min = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (min < 60) return relTime.format(-Math.max(min, 0), "minute");
  if (min < 48 * 60) return relTime.format(-Math.round(min / 60), "hour");
  return relTime.format(-Math.round(min / 1440), "day");
}

function CompanionCard() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [devices, setDevices] = useState(null);
  const [pending, setPending] = useState(0);
  const [code, setCode] = useState(null); // { code, exp }
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const known = useRef(null);

  async function load() {
    try {
      const d = await apiFetch("/companion/devices", { token });
      const list = d.devices || [];
      // Un PC de plus alors qu'un code attendait : c'est lui, le code a servi.
      if (known.current && list.some((x) => !known.current.has(x.id))) setCode(null);
      known.current = new Set(list.map((x) => x.id));
      setDevices(list);
      setPending(d.pending || 0);
    } catch {
      setDevices((prev) => prev || []);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!code) return undefined;
    const poll = setInterval(load, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function newCode() {
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch("/companion/code", { method: "POST", token });
      setCode({ code: d.code, exp: new Date(d.expiresAt).getTime() });
      setNow(Date.now());
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  async function unlink(d) {
    if (!window.confirm(`Délier ${d.name} ? Les succès déjà envoyés restent sur ton profil.`)) return;
    await apiFetch(`/companion/devices/${d.id}`, { method: "DELETE", token }).catch(() => {});
    load();
  }

  if (!devices) return <CardLoading />;

  const left = code ? Math.max(0, code.exp - now) : 0;
  const expired = !!code && left === 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
  const linked = devices.length > 0;

  return (
    <div className={`import-card companion ${linked ? "connected" : ""}`}>
      <div className="import-card-main">
        <div className="import-logo companion-logo">
          <Monitor size={20} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            Compagnon PC
            {linked && (
              <span className="import-badge">
                <CheckCircle2 size={12} /> {devices.length} PC relié{devices.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="import-card-desc">Succès et heures des jeux hors boutique · Windows</p>
        </div>
      </div>

      <div className="import-actions">
        <a className="btn-ghost-link clickable" href={COMPANION_EXE} download>
          <Download size={15} /> Télécharger
        </a>
        <button
          className={`${linked ? "btn-ghost" : "btn-set-primary"} clickable`}
          onClick={newCode}
          disabled={busy}
        >
          {busy ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}
          {linked ? "Relier un autre PC" : "Relier un PC"}
        </button>
        {linked && (
          <button className="btn-set-primary clickable" onClick={() => navigate("/companion")}>
            <Inbox size={15} />
            {pending > 0 ? `${pending} à valider` : "Envois et historique"}
          </button>
        )}
      </div>

      {code && !expired && (
        <div className="companion-code">
          <span className="companion-code-label">Tape ce code dans le compagnon</span>
          <strong className="companion-code-digits">
            {code.code.slice(0, 3)} {code.code.slice(3)}
          </strong>
          <span className="companion-code-wait">
            <Loader2 className="spin" size={13} /> En attente du PC · expire dans {mmss}
          </span>
        </div>
      )}
      {expired && (
        <div className="import-error">
          <AlertTriangle size={14} /> Code expiré : génère-en un autre.
        </div>
      )}
      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {linked && (
        <ul className="companion-devices">
          {devices.map((d) => (
            <li key={d.id}>
              <Monitor size={14} />
              <span className="companion-device-name">{d.name}</span>
              <span className="companion-device-seen">
                {d.lastSeenAt ? `vu ${seenAgo(d.lastSeenAt)}` : "jamais vu"}
              </span>
              <button
                className="btn-ghost-danger set-icon clickable"
                onClick={() => unlink(d)}
                title="Délier"
                aria-label={`Délier ${d.name}`}
              >
                <Link2Off size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="companion-note">
        Télécharge-le sur ton PC Windows, lance-le, puis relie-le ici. Ce qu'il
        trouve attend ta validation avant d'arriver sur ton profil. Ses succès
        s'affichent « PC · hors boutique » et ne comptent pas dans les classements.
      </p>
    </div>
  );
}

// ============================================================
//  Appels — la sonnerie
// ============================================================
// Un onglet à part plutôt qu'une ligne noyée dans « Notifications » : une
// sonnerie ne se règle pas comme on coche une case, ça s'ÉCOUTE, et il faut la
// place pour une liste avec un bouton d'aperçu sur chaque ligne.
function CallsPanel() {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <PhoneCall size={20} /> Appels
      </h2>
      <RingtonePicker />
    </div>
  );
}

// Interrupteur (façon iOS) réutilisé par les onglets Confidentialité et Fil
// d'accueil. `desc` s'affiche sous le titre ; `hint` ne vit qu'en infobulle.
function PrivacySwitch({ Icon, title, desc, hint, checked, disabled, busy, onChange }) {
  return (
    <label
      className={`pv-row ${disabled ? "off" : ""} ${checked ? "on" : ""}`}
      title={hint}
    >
      <span className="pv-row-icon">
        <Icon size={16} />
      </span>
      <span className="pv-row-txt">
        <strong>{title}</strong>
        {desc && <span>{desc}</span>}
      </span>
      <span className="pv-switch">
        {busy && <Loader2 className="spin pv-row-busy" size={14} />}
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || busy}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="pv-switch-track" />
      </span>
    </label>
  );
}

// Le fil d'accueil vu par le joueur : des DOMAINES (ce qu'il coupe d'un geste,
// « je ne veux plus rien de l'arcade ») qui se déplient sur leurs familles
// fines (« … sauf les caisses »). Les clés des feuilles doivent correspondre à
// FEED_CATEGORIES (server/src/lib/feedCategories.js) : c'est le serveur qui
// coupe, ici on ne fait que nommer, illustrer et regrouper. Un domaine n'est
// jamais enregistré tel quel — le couper masque toutes ses feuilles, ce qui
// évite d'avoir deux réglages qui se contredisent.
const FEED_GROUPS = [
  {
    key: "library",
    Icon: Gamepad2,
    title: "Bibliothèque & avis",
    desc: "Ce que les autres jouent, notent et racontent.",
    items: [
      {
        key: "games",
        Icon: Gamepad2,
        title: "Jeux & avis",
        desc: "Statuts, notes, reviews et heures de jeu.",
      },
      {
        key: "lists",
        Icon: ListMusic,
        title: "Listes & playlists",
        desc: "Listes créées ou complétées, likes et commentaires dessus.",
      },
      {
        key: "trackers",
        Icon: Swords,
        title: "Parties & rangs classés",
        desc: "Sessions des jeux suivis (Marvel Rivals, League of Legends) et montées de rang.",
      },
    ],
  },
  {
    key: "social",
    Icon: Users,
    title: "Social",
    desc: "Abonnements, réactions et recommandations entre joueurs.",
    items: [
      {
        key: "follows",
        Icon: UserPlus,
        title: "Abonnements",
        desc: "« X s'est abonné à Y ».",
      },
      {
        key: "reactions",
        Icon: MessageSquareText,
        title: "Réactions & commentaires d'avis",
        desc: "Cœurs, bravos et discussions sous les reviews.",
      },
      {
        key: "recos",
        Icon: Send,
        title: "Recommandations",
        desc: "Jeux recommandés à quelqu'un, +1 et commentaires dessus.",
      },
    ],
  },
  {
    key: "gamepages",
    Icon: Image,
    title: "Pages de jeux",
    desc: "Ce qui se publie sur les fiches : mur média, fan arts, patchs.",
    items: [
      {
        key: "media",
        Icon: Image,
        title: "Mur média",
        desc: "Posts et commentaires publiés sur le mur d'une fiche de jeu.",
      },
      {
        key: "fanarts",
        Icon: Repeat2,
        title: "Fan arts republiés",
        desc: "Les images repartagées depuis l'onglet Feed d'un jeu.",
      },
      {
        key: "downloads",
        Icon: DownloadCloud,
        title: "Téléchargements",
        desc: "Les cartes « avis de recherche » qui moquent les téléchargements.",
      },
    ],
  },
  {
    key: "minigames",
    Icon: Trophy,
    title: "Mini-jeux",
    desc: "Résultats de parties, défis et versus.",
    items: [
      {
        key: "blindtest",
        Icon: Music,
        title: "Blind test",
        desc: "Parties, défis et versus de blind test musical.",
      },
      {
        key: "pixel",
        Icon: Zap,
        title: "Pixel Rush",
        desc: "Parties et défis de Pixel Rush.",
      },
      {
        key: "geo",
        Icon: Globe,
        title: "GeoGamer",
        desc: "Parties et versus de GeoGamer.",
      },
      {
        key: "quiz",
        Icon: Trophy,
        title: "Le Grand Quiz",
        desc: "Parties, défis et plateaux à plusieurs.",
      },
      {
        key: "mot",
        Icon: SpellCheck,
        title: "Mot du jour",
        desc: "Résultats quotidiens, en solo comme en équipe.",
      },
    ],
  },
  {
    key: "arcade",
    Icon: PackageOpen,
    title: "Arcade",
    desc: "Tout ce qui sort des machines : caisses et capsules.",
    items: [
      {
        key: "cases",
        Icon: PackageOpen,
        title: "Caisses ouvertes",
        desc: "Les lots décrochés en dépensant ses points.",
      },
      {
        key: "drops",
        Icon: Boxes,
        title: "Machine à capsules",
        desc: "Les boîtiers tirés au sort pour la collection.",
      },
    ],
  },
  {
    key: "collection",
    Icon: Library,
    title: "Collection",
    desc: "Ce qui se dit dans les rayons.",
    items: [
      {
        key: "collectiontalk",
        Icon: Library,
        title: "Discussions du rayon",
        desc: "Commentaires laissés sur un film, une série, un comics.",
      },
    ],
  },
  {
    key: "discovery",
    Icon: Sparkles,
    title: "Découverte",
    desc: "Ce que les autres dénichent pour toi.",
    items: [
      {
        key: "videos",
        Icon: Video,
        title: "Vidéos & documentaires",
        desc: "Documentaires recommandés, regardés, aimés ou commentés.",
      },
      {
        key: "gems",
        Icon: Sparkles,
        title: "Pépites",
        desc: "Les jeux dénichés par les autres dans le module de pépites.",
      },
    ],
  },
];

const FEED_KEYS = FEED_GROUPS.flatMap((g) => g.items.map((i) => i.key));

// Un domaine : interrupteur maître + repli sur ses familles. L'interrupteur
// maître ne connaît que trois états — tout, rien, ou « en partie » (le
// navigateur dessine alors une case indéterminée). Un domaine réglé en partie
// s'ouvre tout seul : sinon on lirait « en partie » sans voir sur quoi.
function FeedGroup({ group, hidden, busyKey, onGroup, onLeaf }) {
  const on = group.items.filter((i) => !hidden.includes(i.key)).length;
  const total = group.items.length;
  const partial = on > 0 && on < total;
  const [open, setOpen] = useState(partial);
  const Chevron = open ? ChevronDown : ChevronRight;
  // Un enregistrement en vol fige les autres interrupteurs : deux bascules
  // simultanées enverraient deux listes complètes concurrentes.
  const busy = busyKey === group.key || busyKey === "*";
  const frozen = !!busyKey;

  return (
    <div className={`fg ${on === 0 ? "off" : ""}`}>
      <div className="fg-head">
        <button
          className="fg-open clickable"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={group.desc}
        >
          <span className="pv-row-icon">
            <group.Icon size={16} />
          </span>
          <span className="pv-row-txt">
            <strong>{group.title}</strong>
          </span>
          {(on === 0 || partial) && (
            <span className="fg-count">{on === 0 ? "Masqué" : `${on}/${total}`}</span>
          )}
          {total > 1 && (
            <span className="fg-chev">
              <Chevron size={16} />
            </span>
          )}
        </button>
        <label className="pv-switch fg-switch">
          {busy && <Loader2 className="spin pv-row-busy" size={14} />}
          <input
            type="checkbox"
            checked={on > 0}
            disabled={frozen}
            // Trois états sur une seule case : le « en partie » n'existe qu'en
            // JS, d'où la ref plutôt qu'un attribut.
            ref={(el) => {
              if (el) el.indeterminate = partial;
            }}
            onChange={(e) => onGroup(group, e.target.checked)}
            aria-label={`Tout ${on > 0 ? "masquer" : "afficher"} : ${group.title}`}
          />
          <span className="pv-switch-track" />
        </label>
      </div>

      {open && total > 1 && (
        <div className="fg-kids">
          {group.items.map((it) => (
            <PrivacySwitch
              key={it.key}
              Icon={it.Icon}
              title={it.title}
              hint={it.desc}
              checked={!hidden.includes(it.key)}
              busy={busyKey === it.key || busy}
              disabled={frozen}
              onChange={(v) => onLeaf(it.key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Onglet « Apparence » : pour l'instant une seule question, mais elle revient
// à chaque note posée — sur 100, ou sur cinq étoiles.
//
// ⚠️ LE RÉGLAGE NE CONVERTIT RIEN. La note reste enregistrée sur 100 en base :
// c'est une façon de l'afficher et de la saisir, pas une autre donnée (cf.
// lib/ratingScale.js). Passer aux étoiles et revenir ne perd donc aucune
// précision — un 83 reste un 83, même après l'avoir vu en 4,15 étoiles.
function AppearancePanel() {
  const [scale, setScale] = useState(getRatingScale);

  function pick(next) {
    setScale(next);
    setRatingScale(next); // prévient les composants déjà à l'écran
  }

  const OPTIONS = [
    { value: SCALE_100, title: "Sur 100" },
    { value: SCALE_STARS, title: "Sur 5 étoiles" },
  ];

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <Palette size={20} /> Apparence
      </h2>

      <h3 className="settings-sub-title">Notation</h3>
      <div className="scale-picker">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            className={`scale-opt clickable ${scale === o.value ? "active" : ""}`}
            onClick={() => pick(o.value)}
            aria-pressed={scale === o.value}
          >
            <span className="scale-opt-head">
              <span className="scale-opt-title">{o.title}</span>
              {scale === o.value && (
                <span className="scale-opt-check">
                  <Check size={14} strokeWidth={3} />
                </span>
              )}
            </span>
            {/* L'aperçu vaut mieux qu'une explication : on voit ce qu'on choisit. */}
            <span className="scale-opt-demo">
              {o.value === SCALE_100 ? (
                <span className="scale-demo-100">
                  <span className="scale-demo-bar">
                    <span style={{ width: "78%" }} />
                  </span>
                  <b>78</b>
                </span>
              ) : (
                <span className="scale-demo-stars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star
                      key={i}
                      size={16}
                      fill={i < 4 ? "currentColor" : "none"}
                      strokeWidth={i < 4 ? 0 : 2}
                    />
                  ))}
                  <b>4</b>
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* La police du site : texte et titres, appliquée dès le clic. */}
      <h3 className="settings-sub-title">Police</h3>
      <FontPicker />
    </div>
  );
}

// Onglet « Fil d'accueil » : quelles familles de cartes apparaissent dans le
// fil. On envoie au serveur la liste COMPLÈTE de ce qui est masqué (c'est ce
// qu'il stocke) et chaque bascule est enregistrée aussitôt — pas de bouton
// « Enregistrer », comme l'onglet Confidentialité.
function FeedPanel() {
  const { token, user, updateUser } = useAuth();
  const [hidden, setHidden] = useState(() => user?.feedHidden || []);
  const [busyKey, setBusyKey] = useState(null); // clé de feuille, de domaine, ou "*"

  async function save(next, key) {
    const before = hidden;
    setHidden(next);
    setBusyKey(key);
    try {
      const d = await apiFetch("/users/me/feed-prefs", {
        method: "PUT",
        token,
        body: { hidden: next },
      });
      const saved = d.user.feedHidden || [];
      setHidden(saved);
      updateUser({ feedHidden: saved });
    } catch {
      setHidden(before); // échec : on remet l'interrupteur comme avant
    } finally {
      setBusyKey(null);
    }
  }

  const toggleLeaf = (key, visible) =>
    save(visible ? hidden.filter((k) => k !== key) : [...hidden, key], key);

  // Couper un domaine masque toutes ses familles d'un coup ; le rallumer les
  // rend toutes, même celles qui avaient été décochées une à une avant.
  const toggleGroup = (group, visible) => {
    const keys = group.items.map((i) => i.key);
    const rest = hidden.filter((k) => !keys.includes(k));
    save(visible ? rest : [...rest, ...keys], group.key);
  };

  const off = hidden.filter((k) => FEED_KEYS.includes(k)).length;
  const allOff = off === FEED_KEYS.length;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">
          <Newspaper size={20} /> Fil d'accueil
        </h2>
        {off > 0 && (
          <button
            className="fp-reset clickable"
            onClick={() => save([], "*")}
            disabled={busyKey === "*"}
          >
            {busyKey === "*" ? (
              <Loader2 className="spin" size={13} />
            ) : (
              <RotateCcw size={13} />
            )}
            Tout réafficher
          </button>
        )}
      </div>

      {allOff && (
        <p className="fp-warn">
          <AlertTriangle size={14} /> Ton fil sera vide
        </p>
      )}

      {FEED_GROUPS.map((g) => (
        <FeedGroup
          key={g.key}
          group={g}
          hidden={hidden}
          busyKey={busyKey}
          onGroup={toggleGroup}
          onLeaf={toggleLeaf}
        />
      ))}
    </div>
  );
}

// Onglet « Confidentialité » : compte privé + sous-options, et validation des
// demandes d'abonnement en attente. Chaque bascule est enregistrée aussitôt
// (PUT /users/me/privacy) — pas de bouton « Enregistrer ».
function PrivacyPanel({ onCount }) {
  const { token, user, updateUser } = useAuth();
  const [privacy, setPrivacy] = useState(
    () =>
      user?.privacy || {
        isPrivate: false,
        hideAvatar: false,
        hideCover: false,
        hideReviews: false,
      }
  );
  const [busyKey, setBusyKey] = useState(null);
  const [requests, setRequests] = useState(null); // null = chargement
  const [busyId, setBusyId] = useState(null);

  async function loadRequests() {
    try {
      const d = await apiFetch("/users/me/follow-requests", { token });
      setRequests(d.requests || []);
      onCount?.(d.count || 0);
    } catch {
      setRequests([]);
    }
  }
  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(key, value) {
    const before = privacy;
    setPrivacy((p) => ({ ...p, [key]: value }));
    setBusyKey(key);
    try {
      const d = await apiFetch("/users/me/privacy", {
        method: "PUT",
        token,
        body: { [key]: value },
      });
      setPrivacy(d.user.privacy);
      updateUser({ privacy: d.user.privacy });
      // Repasser en public accepte les demandes en attente côté serveur : la
      // liste locale doit suivre.
      if (key === "isPrivate" && !value) {
        setRequests([]);
        onCount?.(0);
      }
    } catch {
      setPrivacy(before); // échec : on remet l'interrupteur comme avant
    } finally {
      setBusyKey(null);
    }
  }

  async function answer(id, action) {
    setBusyId(id);
    try {
      const d = await apiFetch(`/users/me/follow-requests/${id}/${action}`, {
        method: "POST",
        token,
      });
      setRequests((r) => (r || []).filter((x) => x.id !== id));
      onCount?.(d.count || 0);
    } catch {
      /* best-effort */
    } finally {
      setBusyId(null);
    }
  }

  const priv = !!privacy.isPrivate;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <ShieldCheck size={20} /> Confidentialité
      </h2>

      <div className="pv-block">
        <PrivacySwitch
          Icon={priv ? Lock : Globe}
          title="Compte privé"
          desc={priv ? "Abonnés uniquement" : "Visible par tous"}
          hint={
            priv
              ? "S'abonner passe par une demande à valider."
              : "Ton profil est visible même sans compte."
          }
          checked={priv}
          busy={busyKey === "isPrivate"}
          onChange={(v) => save("isPrivate", v)}
        />
      </div>

      {/* Sous-options : sans effet tant que le compte est public. */}
      <div className={`pv-block pv-sub ${priv ? "" : "locked"}`}>
        <div className="pv-sub-head">
          <EyeOff size={14} /> Masquer aux non-abonnés
          {!priv && <span className="pv-sub-hint">compte privé requis</span>}
        </div>
        <PrivacySwitch
          Icon={ImageOff}
          title="Photo de profil"
          hint="Les visiteurs non abonnés voient un avatar vide à la place."
          checked={!!privacy.hideAvatar}
          disabled={!priv}
          busy={busyKey === "hideAvatar"}
          onChange={(v) => save("hideAvatar", v)}
        />
        <PrivacySwitch
          Icon={ImageOff}
          title="Bannière"
          hint="La photo de couverture de ton profil reste réservée à tes abonnés."
          checked={!!privacy.hideCover}
          disabled={!priv}
          busy={busyKey === "hideCover"}
          onChange={(v) => save("hideCover", v)}
        />
        <PrivacySwitch
          Icon={MessageSquareText}
          title="Reviews"
          hint="Tes avis disparaissent des pages de jeux pour qui ne te suit pas."
          checked={!!privacy.hideReviews}
          disabled={!priv}
          busy={busyKey === "hideReviews"}
          onChange={(v) => save("hideReviews", v)}
        />
      </div>

      {/* Demandes d'abonnement en attente (comptes privés). */}
      <div className="pv-block">
        <div className="pv-sub-head">
          <Inbox size={14} /> Demandes d'abonnement
          {requests?.length > 0 && <span className="pv-count">{requests.length}</span>}
        </div>
        {requests === null ? (
          <div className="pv-empty">
            <Loader2 className="spin" size={16} />
          </div>
        ) : requests.length === 0 ? (
          <div className="pv-empty">
            <UserPlus size={15} />
            <p>{priv ? "Aucune demande" : "Compte public"}</p>
          </div>
        ) : (
          <div className="pv-req-list">
            {requests.map((r) => (
              <div key={r.id} className="pv-req">
                <span className="pv-req-avatar">
                  {r.avatar ? (
                    <img src={r.avatar} alt="" />
                  ) : (
                    (r.username || "?")[0].toUpperCase()
                  )}
                </span>
                <div className="pv-req-txt">
                  <strong>{r.username}</strong>
                  {r.bio && <span>{r.bio}</span>}
                </div>
                <div className="pv-req-actions">
                  <button
                    className="pv-req-ok clickable"
                    onClick={() => answer(r.id, "accept")}
                    disabled={busyId === r.id}
                    title="Accepter"
                  >
                    {busyId === r.id ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <UserCheck size={15} />
                    )}
                    <span>Accepter</span>
                  </button>
                  <button
                    className="pv-req-no clickable"
                    onClick={() => answer(r.id, "reject")}
                    disabled={busyId === r.id}
                    title="Refuser"
                  >
                    <UserX size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        <Swords size={20} /> Tracking
      </h2>
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
      <TrackerAvatar src={avatar} name={tracker.externalName} size={28} />
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
            {snap.rank.image && <Emblem src={snap.rank.image} size={16} />}
            {snap.rank.tier}
          </span>
        )}
      </div>
      <button
        className="btn-ghost-danger set-icon clickable trk-unlink"
        onClick={onUnlink}
        disabled={busy}
        title="Délier ce compte"
        aria-label="Délier ce compte"
      >
        {busy ? <Loader2 className="spin" size={15} /> : <Link2Off size={15} />}
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

  if (!status) return <CardLoading />;

  return (
    <div className={`import-card trk-card ${provider} ${connected ? "connected" : ""}`}>
      <div className="import-card-head">
        <div className="import-card-main">
          <CoverLogo cover={cover} className={`${provider}-logo`}>
            <Swords size={18} />
          </CoverLogo>
          <div className="import-card-info">
            <div className="import-card-title">
              {name}
              {connected && (
                <span className="import-badge">
                  <CheckCircle2 size={12} /> Lié
                  {accounts.length > 1 && ` · ${accounts.length}`}
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
      desc="Pseudo ou lien rivalsmeta"
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
      desc="Riot ID et région"
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

  if (!status) return <CardLoading />;

  const connected = status.connected;
  const steam = status.steam;

  return (
    <div className={`import-card steam ${connected ? "connected" : ""}`}>
      <div className="import-card-main">
        <div className="import-logo steam-logo">
          <SteamIcon size={22} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            Steam
            {connected && (
              <span className="import-badge">
                <CheckCircle2 size={12} /> {status.self ? "Connecté" : "Lié"}
              </span>
            )}
          </div>
          {connected && steam ? (
            <div className="import-steam-user">
              {steam.avatar && <img src={steam.avatar} alt="" />}
              <strong>{steam.personaName || "Compte Steam"}</strong>
            </div>
          ) : (
            <p className="import-card-desc">Jeux et succès · profil public</p>
          )}
        </div>
      </div>

      <div className="import-actions">
        {connected ? (
          <>
            <button
              className="btn-set-primary clickable"
              onClick={() => setImporting(true)}
              disabled={busy}
            >
              <DownloadCloud size={15} /> Importer
            </button>
            <button
              className="btn-ghost-danger set-icon clickable"
              onClick={() => setUnlinkOpen(true)}
              disabled={busy}
              title="Délier"
              aria-label="Délier Steam"
            >
              <Link2Off size={15} />
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-ghost-link clickable"
              onClick={() => setManualOpen((v) => !v)}
            >
              Lien manuel
            </button>
            <button
              className="btn-set-primary clickable"
              onClick={connectSteam}
              disabled={busy || !status.configured}
            >
              {busy ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}
              Connecter
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!status.configured && (
        <div className="import-error">
          <AlertTriangle size={14} /> Steam non configuré sur le serveur
        </div>
      )}

      {manualOpen && !connected && (
        <div className="import-manual">
          <input
            type="text"
            placeholder="Lien du profil ou SteamID64"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && linkManual()}
          />
          <button className="btn-set-primary clickable" onClick={linkManual} disabled={busy}>
            Lier
          </button>
        </div>
      )}

      {/* Confirmation de déliaison : retirer ou garder les jeux importés. */}
      {unlinkOpen && (
        <div className="import-unlink">
          <label
            className="import-check"
            title="Tes jeux ajoutés ou modifiés à la main sont conservés."
          >
            <input
              type="checkbox"
              checked={removeGames}
              onChange={(e) => setRemoveGames(e.target.checked)}
            />
            <span>Retirer aussi les jeux importés</span>
          </label>
          <div className="import-unlink-actions">
            <button className="btn-ghost clickable" onClick={() => setUnlinkOpen(false)}>
              Annuler
            </button>
            <button className="btn-ghost-danger clickable" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <Link2Off size={14} />}
              Délier
            </button>
          </div>
        </div>
      )}

      {importing &&
        createPortal(
          <SteamImportModal
            onClose={() => setImporting(false)}
            onDone={async () => {
              await refresh();
            }}
          />,
          document.body
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
  // Le jeton que Sony affiche au joueur connecté (cf. le parcours ci-dessous).
  const [npsso, setNpsso] = useState("");
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
  // bloquée par Sony). Une RE-synchro : le compte est déjà lié, le worker sait
  // avec quel jeton le lire (celui du joueur s'il s'est connecté).
  async function requestSync() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/psn/request", { method: "POST", token, body: {} });
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

  if (!status) return <CardLoading />;

  const connected = status.connected;
  // ⚠️ SE CONNECTER, PAS SE DÉCLARER. Entrer un pseudo ne donnait accès qu'au
  // profil PUBLIC d'un joueur, lu par le compte de service : pas de temps de
  // jeu, et un profil fermé restait invisible. En se connectant, le joueur
  // ouvre SON compte — c'est son jeton, scellé chez nous, qui fait le travail.
  async function connectSelf() {
    const value = npsso.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/psn/session", { method: "POST", token, body: { npsso: value } });
      setNpsso("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const psn = status.psn;
  const req = status.request; // { status } en cours, ou null
  const scan = status.scan; // { games, unmatched, total } prêt à importer, ou null

  return (
    <div className={`import-card psn ${connected ? "connected" : ""}`}>
      <div className="import-card-main">
        <div className="import-logo psn-logo">
          <PsnIcon size={22} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            PlayStation
            {connected && (
              <span className="import-badge">
                <CheckCircle2 size={12} /> Lié
              </span>
            )}
          </div>
          {connected && psn ? (
            <div className="import-steam-user">
              {psn.avatar && <img src={psn.avatar} alt="" />}
              <strong>{psn.onlineId || "Compte PSN"}</strong>
              {psn.lastSyncAt && (
                <span title="Dernière synchro">
                  ·{" "}
                  {new Date(psn.lastSyncAt).toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              )}
            </div>
          ) : (
            <p className="import-card-desc">Jeux, heures et trophées</p>
          )}
        </div>
      </div>

      <div className="import-actions">
        {connected ? (
          <>
            {scan && scan.total > 0 && !req && (
              <button
                className="btn-set-primary clickable"
                onClick={() => setImporting(true)}
              >
                <DownloadCloud size={15} /> Importer · {scan.total}
              </button>
            )}
            {!req && (
              <button
                className="btn-ghost set-icon clickable"
                onClick={() => requestSync()}
                disabled={busy}
                title="Relancer une synchro"
                aria-label="Relancer une synchro PlayStation"
              >
                {busy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
              </button>
            )}
            <button
              className="btn-ghost-danger set-icon clickable"
              onClick={() => setUnlinkOpen(true)}
              disabled={busy}
              title="Délier"
              aria-label="Délier PlayStation"
            >
              <Link2Off size={15} />
            </button>
          </>
        ) : (
          !req && (
            <button
              className="btn-set-primary clickable"
              onClick={() => setConnectOpen((v) => !v)}
              disabled={busy}
            >
              <Link2 size={15} /> Connecter
            </button>
          )
        )}
      </div>

      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Bannière : demande en attente / en cours de traitement par le worker. */}
      {req ? (
        <div className="psn-request-banner">
          <Loader2 size={14} className="spin" />
          {req.status === "processing"
            ? "Synchro en cours…"
            : "Demande envoyée · tu seras notifié"}
        </div>
      ) : sent ? (
        <div className="psn-request-banner ok">
          <CheckCircle2 size={14} /> Demande envoyée
        </div>
      ) : null}

      {/* Modale d'import : l'utilisateur valide jeu par jeu (statut, console,
          trophées). Alimentée par le scan mis en cache par le worker maison. */}
      {importing &&
        createPortal(
          <PsnImportModal
            onClose={() => {
              setImporting(false);
              load();
            }}
            onDone={async () => {
              await refresh();
              await load();
            }}
          />,
          document.body
        )}

      {/* PREMIÈRE LIAISON : le joueur se connecte À SON COMPTE.
          Sony ne propose aucun « Se connecter avec PlayStation » exploitable
          depuis un navigateur : pas de redirection lisible, pas d'appel
          possible à son API. Le seul pont est celui qu'il affiche lui-même à
          un joueur déjà identifié — d'où ces trois pas, et un seul
          copier-coller. On ne voit jamais son mot de passe. */}
      {connectOpen && !connected && !req && (
        <div className="psn-connect">
          {/* Le même vocabulaire que le rappel NPSSO du panel admin : une
              liste numérotée et deux liens. Pas la peine d'inventer une autre
              mise en page pour le même geste. */}
          <ol className="psn-steps">
            <li>
              Connecte-toi sur{" "}
              <a href="https://my.playstation.com" target="_blank" rel="noreferrer">
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
              et copie ce qu'il affiche (<code>{'{"npsso":"…"}'}</code>)
            </li>
            <li>Colle-le ci-dessous : on s'occupe du reste.</li>
          </ol>

          <div className="import-manual">
            <input
              type="text"
              placeholder={'{"npsso":"…"}'}
              value={npsso}
              onChange={(e) => setNpsso(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connectSelf()}
            />
            <button
              className="btn-set-primary clickable"
              onClick={connectSelf}
              disabled={busy || !npsso.trim()}
            >
              {busy ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}
              Se connecter
            </button>
          </div>

          <p className="psn-note">
            Ton compte, tes données : le temps de jeu et les trophées d'un profil
            privé deviennent lisibles, ce qu'un simple pseudo ne permettait pas.
            Le jeton est chiffré chez nous et s'efface si tu délies ton compte.
          </p>
        </div>
      )}

      {/* Confirmation de déliaison : retirer ou garder les jeux importés. */}
      {unlinkOpen && (
        <div className="import-unlink">
          <label
            className="import-check"
            title="Tes jeux ajoutés ou modifiés à la main sont conservés."
          >
            <input
              type="checkbox"
              checked={removeGames}
              onChange={(e) => setRemoveGames(e.target.checked)}
            />
            <span>Retirer aussi les jeux importés</span>
          </label>
          <div className="import-unlink-actions">
            <button className="btn-ghost clickable" onClick={() => setUnlinkOpen(false)}>
              Annuler
            </button>
            <button className="btn-ghost-danger clickable" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <Link2Off size={14} />}
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

// ============================================================
//  Compte — les clés qui ouvrent ce compte
// ============================================================
// UN COMPTE, PLUSIEURS CLÉS. Le mot de passe, Google et Discord ne sont pas
// trois comptes : ce sont trois façons d'ouvrir la même porte, rapprochées par
// l'adresse email (cf. server/src/lib/oauthAccounts.js). C'est exactement ce
// que cet écran doit rendre évident — d'où une liste de clés, et non une page
// de « connexions » où chaque ligne aurait l'air d'un service à part.
//
// ⚠️ ON NE RETIRE PAS SA DERNIÈRE CLÉ. Le serveur refuse (et c'est lui qui
// fait foi) ; ici on grise le bouton et on dit pourquoi, parce qu'un refus
// qu'on ne comprend qu'après avoir cliqué est un refus raté.
const OAUTH_CARDS = [
  {
    key: "google",
    label: "Google",
    logoClass: "google-logo",
    Logo: GoogleIcon,
    title: (info) => info?.name || info?.email || "Compte Google",
    sub: (info) => info?.email || "",
  },
  {
    key: "discord",
    label: "Discord",
    logoClass: "discord-logo",
    Logo: DiscordIcon,
    title: (info) => info?.globalName || info?.username || "Compte Discord",
    sub: (info) => (info?.username ? "@" + info.username : ""),
  },
];

function ConnectionsPanel() {
  const { token, updateUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState("");
  // Le retour de liaison arrive par une REDIRECTION, pas par un appel : le
  // serveur nous repose ici avec ?linked= ou ?link_error=. On les lit une fois,
  // on les affiche, et on les efface de l'URL — sinon le message ressusciterait
  // à chaque retour en arrière du navigateur.
  const [error, setError] = useState(params.get("link_error") || "");
  const [linked, setLinked] = useState(params.get("linked") || "");

  useEffect(() => {
    if (!params.get("link_error") && !params.get("linked")) return;
    setParams({ tab: "account" }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      setStatus(await apiFetch("/auth/oauth/status", { token }));
    } catch {
      setStatus({ providers: {}, methods: {}, google: null, discord: null });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Une vraie navigation : le départ est une redirection vers un autre domaine,
  // qu'aucun fetch ne pourrait suivre. Au retour, le serveur nous ramène sur
  // cet onglet — d'où la lecture de ?linked= plus haut.
  function connect(provider) {
    setError("");
    setBusy(provider);
    const url =
      API_BASE +
      "/auth/oauth/" +
      provider +
      "/start?token=" +
      encodeURIComponent(token);
    window.location.href = url;
  }

  async function unlink(provider) {
    setBusy(provider);
    setError("");
    setLinked("");
    try {
      await apiFetch("/auth/oauth/" + provider, { method: "DELETE", token });
      if (provider === "discord") updateUser({ discordConnected: false, discord: null });
      else updateUser({ googleConnected: false, google: null });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  if (!status) {
    return (
      <div className="settings-section">
        <CardLoading />
      </div>
    );
  }

  const methods = status.methods || {};
  const keyCount = Object.values(methods).filter(Boolean).length;

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <UserCog size={20} /> Compte
      </h2>

      {linked && (
        <div className="import-ok">
          <CheckCircle2 size={14} /> {linked === "google" ? "Google" : "Discord"} lié
        </div>
      )}
      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="import-cards">
        {/* Le mot de passe est une clé comme les autres : le montrer dans la
            même liste évite qu'on croie l'avoir perdu en liant Google. */}
        <div className={"import-card " + (methods.password ? "connected" : "")}>
          <div className="import-card-main">
            <div className="import-logo">
              <KeyRound size={18} />
            </div>
            <div className="import-card-info">
              <div className="import-card-title">
                Mot de passe
                {methods.password && (
                  <span className="import-badge">
                    <CheckCircle2 size={12} /> Actif
                  </span>
                )}
              </div>
              <p className="import-card-desc">{status.email}</p>
            </div>
          </div>
          {/* Pas encore de mot de passe : on passe par « oublié », le lien
              part sur l'adresse du compte. */}
          {!methods.password && (
            <div className="import-actions">
              <a className="btn-ghost clickable" href="/forgot-password">
                Définir
              </a>
            </div>
          )}
        </div>

        {OAUTH_CARDS.map((card) => {
          const configured = !!status.providers?.[card.key];
          const info = status[card.key];
          const connected = !!info;
          // La dernière clé ne se retire pas : on le dit AVANT le clic.
          const lastKey = connected && keyCount <= 1;
          const Logo = card.Logo;
          return (
            <div
              key={card.key}
              className={
                "import-card " + card.key + (connected ? " connected" : "")
              }
            >
              <div className="import-card-main">
                <div className={"import-logo " + card.logoClass}>
                  <Logo size={20} />
                </div>
                <div className="import-card-info">
                  <div className="import-card-title">
                    {card.label}
                    {connected && (
                      <span className="import-badge">
                        <CheckCircle2 size={12} /> Lié
                      </span>
                    )}
                  </div>
                  {connected ? (
                    <div className="import-steam-user">
                      {info.avatar && <img src={info.avatar} alt="" />}
                      <strong>{card.title(info)}</strong>
                      {card.sub(info) && <span>{card.sub(info)}</span>}
                    </div>
                  ) : (
                    <p className="import-card-desc">Non lié</p>
                  )}
                </div>
              </div>

              <div className="import-actions">
                {connected ? (
                  <button
                    className="btn-ghost-danger set-icon clickable"
                    onClick={() => unlink(card.key)}
                    disabled={busy === card.key || lastKey}
                    title="Délier"
                    aria-label={"Délier " + card.label}
                  >
                    {busy === card.key ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Link2Off size={15} />
                    )}
                  </button>
                ) : (
                  <button
                    className="btn-set-primary clickable"
                    onClick={() => connect(card.key)}
                    disabled={!!busy || !configured}
                  >
                    {busy === card.key ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Link2 size={15} />
                    )}
                    Lier
                  </button>
                )}
              </div>

              {!configured && (
                <div className="import-error">
                  <AlertTriangle size={14} /> {card.label} non configuré sur le serveur
                </div>
              )}

              {lastKey && (
                <div className="import-hint">
                  Seule méthode de connexion : ajoute un mot de passe pour la retirer.
                </div>
              )}
            </div>
          );
        })}

        <ReplayIntroCard />
      </div>
    </div>
  );
}

// ======================================================================
//  « Revoir l'intro »
// ======================================================================
// Le tour du propriétaire que l'on voit à l'inscription (cf. pages/Onboarding).
// Il vit ICI, dans « Compte », et pas dans « Apparence » : ce n'est pas un
// réglage d'affichage, c'est un état du compte — la date à laquelle il a fait
// le tour. La remettre à zéro suffit à le relancer.
//
// ⚠️ ON N'EFFACE RIEN POUR LE REJOUER, ON Y VA. Vider la date remettrait le
// compte dans l'état « n'a jamais fait le tour » : fermer l'onglet au milieu
// suffirait alors à s'y retrouver renvoyé à la visite suivante, sans l'avoir
// demandé. La page du parcours s'ouvre très bien sur un compte qui l'a déjà
// fait — elle repose simplement la date en sortant.
function ReplayIntroCard() {
  const navigate = useNavigate();

  return (
    <div className="import-card">
      <div className="import-card-main">
        <div className="import-logo">
          <Sparkles size={18} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">Revoir l'intro</div>
        </div>
      </div>
      <div className="import-actions">
        <button
          className="btn-ghost clickable"
          onClick={() => navigate("/onboarding?replay=1")}
        >
          Lancer
        </button>
      </div>
    </div>
  );
}

// ============================================================
//  Discord & bot
// ============================================================
// Deux choses différentes dans le même onglet, et c'est volontaire : lier son
// Discord ne sert À RIEN aujourd'hui si ce n'est pour le bot (points des
// mini-jeux Discord, messages privés depuis un serveur). Les séparer aurait
// donné un onglet « Discord » dont personne ne comprend l'intérêt, et un onglet
// « Bot » qui renvoie au premier.
function DiscordPanel() {
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        <Bot size={20} /> Discord & bot
      </h2>
      <div className="import-cards">
        <DiscordCard />
        <BotCard />
      </div>
    </div>
  );
}

// La liaison Discord. Même chorégraphie que Steam : une pop-up part chez le
// fournisseur et prévient la page au retour (voir routes/discord.js).
function DiscordCard() {
  const { token, updateUser } = useAuth();
  const [status, setStatus] = useState(null); // { configured, connected, discord }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const popupRef = useRef(null);

  async function load() {
    try {
      setStatus(await apiFetch("/discord/status", { token }));
    } catch {
      setStatus({ configured: true, connected: false });
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMsg(e) {
      if (e.data?.type !== "mpl-discord") return;
      setBusy(false);
      if (e.data.ok) {
        setError(null);
        load();
        updateUser({ discordConnected: true });
      } else {
        setError(e.data.error || "La liaison Discord a échoué.");
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connect() {
    setError(null);
    setBusy(true);
    popupRef.current = openCentered(
      `${API_BASE}/discord/login?token=${encodeURIComponent(token)}`,
      720,
      820,
      "discord-login"
    );
    // Pop-up fermée en cours de route : on relâche l'état occupé.
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

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/discord", { method: "DELETE", token });
      setUnlinkOpen(false);
      updateUser({ discordConnected: false, discord: null });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <CardLoading />;

  const { connected, discord } = status;

  return (
    <div className={`import-card discord ${connected ? "connected" : ""}`}>
      <div className="import-card-main">
        <div className="import-logo discord-logo">
          <DiscordIcon size={20} />
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            Discord
            {connected && (
              <span className="import-badge">
                <CheckCircle2 size={12} /> Lié
              </span>
            )}
          </div>
          {connected && discord ? (
            <div className="import-steam-user">
              {discord.avatar && <img src={discord.avatar} alt="" />}
              <strong>{discord.globalName || discord.username || "Compte Discord"}</strong>
              {discord.username && <span>@{discord.username}</span>}
            </div>
          ) : (
            <p className="import-card-desc">Points des mini-jeux Discord</p>
          )}
        </div>
      </div>

      <div className="import-actions">
        {connected ? (
          <button
            className="btn-ghost-danger set-icon clickable"
            onClick={() => setUnlinkOpen(true)}
            disabled={busy}
            title="Délier"
            aria-label="Délier Discord"
          >
            <Link2Off size={15} />
          </button>
        ) : (
          <button
            className="btn-set-primary clickable"
            onClick={connect}
            disabled={busy || !status.configured}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />}
            Lier
          </button>
        )}
      </div>

      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {!status.configured && (
        <div className="import-error">
          <AlertTriangle size={14} /> Discord non configuré sur le serveur
        </div>
      )}

      {unlinkOpen && (
        <div className="import-unlink">
          <p>Délier Discord ?</p>
          <div className="import-unlink-actions">
            <button className="btn-ghost clickable" onClick={() => setUnlinkOpen(false)}>
              Annuler
            </button>
            <button className="btn-ghost-danger clickable" onClick={unlink} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <Link2Off size={14} />}
              Délier
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Le bot : ai-je le droit de lui parler, et le raccourci pour ouvrir le fil.
//
// L'ACCÈS NE SE DEMANDE PAS ICI, et il n'y a volontairement aucun bouton pour
// ça : le droit se donne depuis le panel d'administration, compte par compte
// (le personnage est grossier — voir server/src/lib/bot.js). Cette carte se
// contente de dire où on en est, parce qu'un bot dont on ignore l'existence
// passerait pour une panne le jour où quelqu'un en entend parler.
function BotCard() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null); // { exists, allowed, bot }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch("/chat/bot", { token })
      .then(setInfo)
      .catch(() => setInfo({ exists: false, allowed: false, bot: null }));
  }, [token]);

  // Ouvre (ou retrouve) le fil avec le bot, puis va dessus : la messagerie sait
  // déjà faire les deux, on ne réimplémente rien.
  async function talk() {
    if (!info?.bot) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch("/chat/conversations", {
        method: "POST",
        token,
        body: { userIds: [info.bot.id] },
      });
      navigate(`/messages?c=${d.conversation.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!info) return <CardLoading />;

  return (
    <div className={`import-card bot ${info.allowed ? "connected" : ""}`}>
      <div className="import-card-main">
        <div className="import-logo bot-logo">
          {info.bot?.avatar ? <img src={info.bot.avatar} alt="" /> : <Bot size={20} />}
        </div>
        <div className="import-card-info">
          <div className="import-card-title">
            {info.bot?.username || "Le bot"}
            {info.allowed && (
              <span className="import-badge">
                <CheckCircle2 size={12} /> Accès ouvert
              </span>
            )}
          </div>
          {!info.allowed && (
            <p className="import-card-desc">
              {info.exists ? "Accès sur demande à un admin" : "Indisponible"}
            </p>
          )}
        </div>
      </div>

      {/* Le fil sur le site : c'est là que le bot vit d'abord. */}
      {info.exists && info.allowed && (
        <div className="import-actions">
          <button className="btn-set-primary clickable" onClick={talk} disabled={busy}>
            {busy ? <Loader2 className="spin" size={15} /> : <MessageCircle size={15} />}
            Écrire
          </button>
        </div>
      )}

      {error && (
        <div className="import-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
