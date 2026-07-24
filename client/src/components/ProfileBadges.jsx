import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Award,
  Coins,
  Check,
  Lock,
  Sparkles,
  Loader2,
  Gift,
  UserPlus,
  Trophy,
  Star,
  Heart,
  PackageOpen,
  Music2,
  Repeat2,
  ListOrdered,
  ListMusic,
  Link2,
  Users,
  Library,
  PenLine,
  UserRound,
  Moon,
  MousePointer2,
  Clapperboard,
  Send,
  Joystick,
  Building2,
  Swords,
  CalendarCheck,
  Disc3,
  List,
  MessageSquare,
  Flame,
  ImagePlus,
  Images,
  ArrowUpDown,
  Grid2x2,
  Medal,
  Film,
  ThumbsUp,
  Reply,
  Quote,
  VenetianMask,
  MessagesSquare,
  CalendarDays,
  CalendarRange,
  Target,
  Zap,
  Megaphone,
  Stars,
  Feather,
  BookmarkCheck,
  Gauge,
  ScrollText,
  Rocket,
  Scale,
  NotebookPen,
  Crown,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { playRewardSound } from "../lib/sfx";
import { useAuth } from "../context/AuthContext";

// Onglet « Badges » du profil : les missions du joueur (cf.
// server/src/lib/missions.js). Une mission se joue en deux temps : elle
// s'accomplit toute seule (le serveur la passe « à récupérer »), puis le joueur
// vient encaisser ses points d'un clic — on ne remplit jamais sa cagnotte dans
// son dos.

// Les missions transportent un NOM d'icône lucide (string) : on le résout ici.
// Exporté pour que le panel admin propose exactement les mêmes choix.
export const MISSION_ICONS = {
  UserPlus,
  Trophy,
  Star,
  Heart,
  PackageOpen,
  Music2,
  Repeat2,
  ListOrdered,
  ListMusic,
  Link2,
  Users,
  Library,
  PenLine,
  UserRound,
  Moon,
  MousePointer2,
  Clapperboard,
  Send,
  Joystick,
  Building2,
  Swords,
  Disc3,
  List,
  MessageSquare,
  Flame,
  ImagePlus,
  Images,
  ArrowUpDown,
  Sparkles,
  Grid2x2,
  Medal,
  Film,
  ThumbsUp,
  Reply,
  Quote,
  VenetianMask,
  MessagesSquare,
  CalendarDays,
  CalendarRange,
  Target,
  Zap,
  Megaphone,
  Stars,
  Feather,
  BookmarkCheck,
  Gauge,
  ScrollText,
  Rocket,
  Scale,
  NotebookPen,
  Crown,
};

const TIER_LABEL = { bronze: "Bronze", silver: "Argent", gold: "Or", platinum: "Platine" };

export function MissionIcon({ name, size = 26 }) {
  const Ic = MISSION_ICONS[name] || Award;
  return <Ic size={size} />;
}

// « 14 mars 2026 » — la date à laquelle le badge a été décroché.
function claimDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Toast de récupération : glisse depuis le bas, disparaît tout seul.
function ClaimToast({ toast, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [toast.id, onDone]);

  return createPortal(
    <div className="pb-toast" role="status">
      <span className="pb-toast-medal">
        <MissionIcon name={toast.icon} size={20} />
      </span>
      <span className="pb-toast-txt">
        <strong>{toast.title}</strong>
        <em>Badge ajouté à ta collection</em>
      </span>
      <span className="pb-toast-pts">
        <Coins size={15} /> +{toast.points}
      </span>
    </div>,
    document.body
  );
}

// Une carte de mission : médaillon coloré selon la rareté (tier), titre,
// description, barre de progression (missions à paliers) et — quand la mission
// est accomplie mais pas encore encaissée — le bouton « Récupérer ».
function BadgeCard({ m, isMe, busy, bursting, onClaim }) {
  const pct = m.target > 1 ? Math.round((m.current / m.target) * 100) : m.done ? 100 : 0;
  const showBar = !m.done && m.target > 1;
  const state = m.claimed ? "done" : m.claimable ? "ready" : "locked";

  return (
    <article
      className={`pb-badge ${m.tier} ${state} ${bursting ? "bursting" : ""}`}
    >
      <div className="pb-medal">
        <span className="pb-medal-ring" aria-hidden="true" />
        <MissionIcon name={m.icon} />
        <span className="pb-medal-badge" aria-hidden="true">
          {m.claimed ? <Check size={13} /> : m.claimable ? <Gift size={12} /> : <Lock size={12} />}
        </span>
      </div>

      <div className="pb-info">
        <h3 className="pb-badge-title">{m.title}</h3>
        <p className="pb-badge-desc">{m.description}</p>

        {showBar && (
          <div className="pb-progress">
            <div className="pb-progress-track">
              <div className="pb-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="pb-progress-num">
              {m.current}/{m.target}
            </span>
          </div>
        )}

        {/* Accomplie et pas encore encaissée : c'est LE moment d'agir. */}
        {m.claimable && isMe ? (
          <button
            className="pb-claim clickable"
            onClick={() => onClaim(m)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <>
                <Gift size={15} /> Récupérer
                <b>+{m.points}</b>
              </>
            )}
          </button>
        ) : (
          <div className="pb-badge-foot">
            <span className="pb-reward">
              <Coins size={13} /> {m.points}
              <em>
                {m.claimed
                  ? isMe
                    ? "gagnés"
                    : "obtenus"
                  : m.claimable
                    ? "à récupérer"
                    : "à gagner"}
              </em>
            </span>
            <span className="pb-tier-tag">{TIER_LABEL[m.tier] || m.tier}</span>
          </div>
        )}

        {/* Badge décroché : depuis quand il trône dans la collection. */}
        {m.claimed && m.claimedAt && (
          <span className="pb-badge-date" title={new Date(m.claimedAt).toLocaleString("fr-FR")}>
            <CalendarCheck size={12} /> Obtenu le {claimDate(m.claimedAt)}
          </span>
        )}
      </div>
    </article>
  );
}

export default function ProfileBadges({ username, token, isMe }) {
  const { updateUser } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null); // mission en cours d'encaissement
  const [bursting, setBursting] = useState(null); // mission qui joue son animation
  const [toast, setToast] = useState(null);
  const burstTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/users/${username}/missions`, { token })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [username, token]);

  useEffect(() => () => clearTimeout(burstTimer.current), []);

  const dismissToast = useCallback(() => setToast(null), []);

  async function claim(m) {
    if (busyKey) return;
    setBusyKey(m.key);
    try {
      const { balance } = await apiFetch(`/missions/${m.key}/claim`, {
        method: "POST",
        token,
      });
      setData((d) => ({
        ...d,
        balance,
        claimed: d.claimed + 1,
        claimable: d.claimable - 1,
        missions: d.missions.map((x) =>
          x.key === m.key
            ? { ...x, claimed: true, claimable: false, claimedAt: new Date().toISOString() }
            : x
        ),
      }));
      // Le solde vit aussi dans le contexte auth (pastille de la barre du haut).
      updateUser({ points: balance });
      playRewardSound();
      setBursting(m.key);
      clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(() => setBursting(null), 900);
      setToast({ id: Date.now(), title: m.title, points: m.points, icon: m.icon });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading)
    return (
      <div className="act-loading">
        <Loader2 size={20} className="spin" /> Chargement des badges…
      </div>
    );
  if (error) return <div className="profile-empty font-fun">{error}</div>;
  if (!data) return null;

  const { missions, balance, claimed, claimable } = data;
  const total = missions.length;
  const pct = total ? Math.round((claimed / total) * 100) : 0;
  // Ce qu'il reste à faire d'abord : les récompenses à encaisser (l'action
  // saute aux yeux), puis les missions en cours triées par progression
  // décroissante (les plus proches d'aboutir en tête). Les badges déjà gagnés
  // ferment la marche — ils sont acquis, ils peuvent attendre.
  const rank = (m) => (m.claimable ? 0 : m.claimed ? 2 : 1);
  const sorted = [...missions].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 1) return b.current / b.target - a.current / a.target;
    // Badges gagnés : le plus récent en premier.
    if (rank(a) === 2) return new Date(b.claimedAt || 0) - new Date(a.claimedAt || 0);
    return 0;
  });

  return (
    <section className="pb">
      <header className="pb-hero card">
        <div
          className="pb-hero-ring"
          style={{ "--pb-pct": pct }}
          role="img"
          aria-label={`${claimed} badges sur ${total}`}
        >
          <div className="pb-hero-ring-in">
            <Award size={22} />
            <strong>
              {claimed}
              <span>/{total}</span>
            </strong>
          </div>
        </div>
        <div className="pb-hero-text">
          <h2 className="pb-hero-title">{isMe ? "Tes badges" : "Ses badges"}</h2>
          <p className="pb-hero-sub">
            {claimed === 0
              ? isMe
                ? "Accomplis des missions pour gagner des badges et des points."
                : "Aucun badge gagné pour l'instant."
              : `${claimed} badge${claimed > 1 ? "s" : ""} gagné${claimed > 1 ? "s" : ""} sur ${total}`}
          </p>
          <div className="pb-hero-tags">
            <span className="pb-hero-points">
              <Coins size={15} /> {balance.toLocaleString("fr-FR")} point
              {balance > 1 ? "s" : ""}
            </span>
            {isMe && claimable > 0 && (
              <span className="pb-hero-ready">
                <Gift size={14} /> {claimable} récompense{claimable > 1 ? "s" : ""} à
                récupérer
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="pb-grid">
        {sorted.map((m) => (
          <BadgeCard
            key={m.key}
            m={m}
            isMe={isMe}
            busy={busyKey === m.key}
            bursting={bursting === m.key}
            onClaim={claim}
          />
        ))}
      </div>

      {toast && <ClaimToast toast={toast} onDone={dismissToast} />}
    </section>
  );
}
