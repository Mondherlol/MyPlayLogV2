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
  ChevronDown,
  ChevronRight,
  PhoneCall,
} from "lucide-react";
import { apiFetch, API_BASE } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import RingtonePicker from "../components/RingtonePicker";
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

const TAB_KEYS = [
  "imports",
  "tracking",
  "feed",
  "account",
  "appearance",
  "notifications",
  "privacy",
  "calls",
];

// Onglets de la page Paramètres (façon Discord / Steam). Les onglets marqués
// `soon` sont là pour montrer la structure et restent désactivés.
const TABS = [
  { key: "imports", label: "Imports", Icon: DownloadCloud },
  { key: "tracking", label: "Tracking", Icon: Swords },
  { key: "feed", label: "Fil d'accueil", Icon: Newspaper },
  { key: "privacy", label: "Confidentialité", Icon: ShieldCheck },
  { key: "calls", label: "Appels", Icon: PhoneCall },
  { key: "account", label: "Compte", Icon: UserCog, soon: true },
  { key: "appearance", label: "Apparence", Icon: Palette, soon: true },
  { key: "notifications", label: "Notifications", Icon: Bell, soon: true },
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
  // Badge « demandes d'abonnement » sur l'onglet Confidentialité (compte privé).
  const [requestCount, setRequestCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    apiFetch("/psn/status", { token })
      .then((s) => setPendingCount(s?.pending || 0))
      .catch(() => {});
    apiFetch("/users/me/follow-requests", { token })
      .then((d) => setRequestCount(d?.count || 0))
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
      <p className="settings-section-sub">
        Choisis ce que tu entends quand quelqu'un t'appelle — en privé comme dans
        un groupe. Écoute avant de choisir : le bouton de gauche joue la sonnerie
        exactement comme elle sonnera.
      </p>
      <RingtonePicker />
    </div>
  );
}

// Interrupteur (façon iOS) réutilisé par les onglets Confidentialité et Fil
// d'accueil.
function PrivacySwitch({ Icon, title, desc, checked, disabled, busy, onChange }) {
  return (
    <label className={`pv-row ${disabled ? "off" : ""} ${checked ? "on" : ""}`}>
      <span className="pv-row-icon">
        <Icon size={18} />
      </span>
      <span className="pv-row-txt">
        <strong>{title}</strong>
        <span>{desc}</span>
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
        >
          <span className="pv-row-icon">
            <group.Icon size={18} />
          </span>
          <span className="pv-row-txt">
            <strong>{group.title}</strong>
            <span>
              {on === 0
                ? "Masqué de ton fil."
                : partial
                  ? `${on} famille${on > 1 ? "s" : ""} sur ${total} · ${group.desc}`
                  : group.desc}
            </span>
          </span>
          {total > 1 && (
            <span className="fg-chev">
              {open ? "Réduire" : "Détailler"} <Chevron size={16} />
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
              desc={it.desc}
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
      <h2 className="settings-section-title">
        <Newspaper size={20} /> Fil d'accueil
      </h2>
      <p className="settings-section-sub">
        Choisis ce que ton fil te raconte. Coupe un domaine entier d'un geste, ou
        déplie-le pour trier dans le détail. Ce que tu masques ne disparaît que de
        TON fil : les autres continuent de le voir, et l'onglet Feed des profils
        n'y touche pas.
      </p>

      <div className="fp-bar">
        <span>
          {off === 0
            ? "Tu vois tout ce qui se passe."
            : `${off} famille${off > 1 ? "s" : ""} masquée${off > 1 ? "s" : ""} sur ${FEED_KEYS.length}.`}
        </span>
        {off > 0 && (
          <button
            className="fp-reset clickable"
            onClick={() => save([], "*")}
            disabled={busyKey === "*"}
          >
            {busyKey === "*" ? (
              <Loader2 className="spin" size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
            Tout réafficher
          </button>
        )}
      </div>

      {allOff && (
        <p className="fp-warn">
          <AlertTriangle size={15} /> Tout est coupé : ton fil d'accueil sera
          vide.
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
      <p className="settings-section-sub">
        Choisis qui peut voir ton profil, tes jeux et tes reviews.
      </p>

      <div className="pv-block">
        <PrivacySwitch
          Icon={priv ? Lock : Globe}
          title="Compte privé"
          desc={
            priv
              ? "Seuls tes abonnés voient ton profil. S'abonner passe par une demande à valider."
              : "Ton profil est visible par tout le monde, même sans compte."
          }
          checked={priv}
          busy={busyKey === "isPrivate"}
          onChange={(v) => save("isPrivate", v)}
        />
      </div>

      {/* Sous-options : sans effet tant que le compte est public. */}
      <div className={`pv-block pv-sub ${priv ? "" : "locked"}`}>
        <div className="pv-sub-head">
          <EyeOff size={15} /> Masquer aux non-abonnés
          {!priv && <span className="pv-sub-hint">active le compte privé</span>}
        </div>
        <PrivacySwitch
          Icon={ImageOff}
          title="Ma photo de profil"
          desc="Les visiteurs non abonnés voient un avatar vide à la place."
          checked={!!privacy.hideAvatar}
          disabled={!priv}
          busy={busyKey === "hideAvatar"}
          onChange={(v) => save("hideAvatar", v)}
        />
        <PrivacySwitch
          Icon={ImageOff}
          title="Ma bannière"
          desc="La photo de couverture de ton profil reste réservée à tes abonnés."
          checked={!!privacy.hideCover}
          disabled={!priv}
          busy={busyKey === "hideCover"}
          onChange={(v) => save("hideCover", v)}
        />
        <PrivacySwitch
          Icon={MessageSquareText}
          title="Mes reviews"
          desc="Tes avis disparaissent des pages de jeux pour qui ne te suit pas."
          checked={!!privacy.hideReviews}
          disabled={!priv}
          busy={busyKey === "hideReviews"}
          onChange={(v) => save("hideReviews", v)}
        />
      </div>

      {/* Demandes d'abonnement en attente (comptes privés). */}
      <div className="pv-block">
        <div className="pv-sub-head">
          <Inbox size={15} /> Demandes d'abonnement
          {requests?.length > 0 && <span className="pv-count">{requests.length}</span>}
        </div>
        {requests === null ? (
          <div className="pv-empty">
            <Loader2 className="spin" size={18} />
          </div>
        ) : requests.length === 0 ? (
          <div className="pv-empty">
            <UserPlus size={20} />
            <p>
              {priv
                ? "Aucune demande en attente."
                : "Ton compte est public : on s'abonne à toi sans demander."}
            </p>
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
