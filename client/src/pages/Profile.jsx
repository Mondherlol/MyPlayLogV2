import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Plus,
  Star,
  Heart,
  Trophy,
  Gamepad2,
  CalendarDays,
  Sparkles,
  Quote,
  Camera,
  Pencil,
  UserPlus,
  UserCheck,
  Loader2,
  Lock,
  MessageCircle,
  MessageSquareText,
  LayoutGrid,
  List,
  Music,
  Send,
  Move,
  Image as ImageIcon,
  ChevronDown,
  ArrowRight,
  Repeat2,
  Film,
} from "lucide-react";
import twemoji from "@twemoji/api";
import { apiFetch, apiUpload } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { typeMeta, timeAgo } from "../lib/lists";
import PlayedModal from "../components/PlayedModal";
import AddGameModal from "../components/AddGameModal";
import ProfileAllGames from "../components/ProfileAllGames";
import GameAddFan from "../components/GameAddFan";
import ProfileActivity from "../components/ProfileActivity";
import ProfileOST from "../components/ProfileOST";
import ProfileFeed from "../components/ProfileFeed";
import ProfileRecommendations from "../components/ProfileRecommendations";
import ProfileVideos from "../components/ProfileVideos";
import EditProfileModal from "../components/EditProfileModal";
import CoverPickerModal from "../components/CoverPickerModal";
import ReframeCoverModal from "../components/ReframeCoverModal";
import FollowListModal from "../components/FollowListModal";
import { useClickOutside } from "../hooks/useClickOutside";

// Cache du dernier profil chargé (par pseudo) : on réaffiche instantanément la
// dernière version connue, puis on rafraîchit en fond (stale-while-revalidate).
const profileCache = makeCache("mpl_profile_", 10 * 60 * 1000);

// Rend un texte avec les emojis en style Twitter (twemoji), comme les commentaires.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function twemojiHtml(text) {
  return { __html: twemoji.parse(escapeHtml(text), { folder: "svg", ext: ".svg" }) };
}

const SECTIONS = [
  { key: "playing", label: "En cours" },
  { key: "finished", label: "Terminés" },
  { key: "paused", label: "En pause" },
  { key: "dropped", label: "Abandonnés" },
  { key: "wishlist", label: "À jouer" },
];

// Sous-onglets de filtrage de l'onglet « Listes » (par type).
const LIST_FILTERS = [
  { key: "all", label: "Toutes", Icon: LayoutGrid },
  { key: "classic", label: "Listes", Icon: typeMeta("classic").Icon },
  { key: "ranked", label: "Classées", Icon: typeMeta("ranked").Icon },
  { key: "tier", label: "Tier lists", Icon: typeMeta("tier").Icon },
];

const LIST_SORTS = [
  { key: "recent", label: "Plus récentes" },
  { key: "liked", label: "Plus aimées" },
];

function CoverTile({ entry, fav }) {
  const navigate = useNavigate();
  return (
    <div
      className="cover-tile clickable"
      onClick={() => navigate(`/game/${entry.gameId}`)}
      title={entry.name}
    >
      {entry.cover ? (
        <img src={entry.cover} alt={entry.name} loading="lazy" />
      ) : (
        <div className="cover-ph">{entry.name}</div>
      )}
      {fav && (
        <span className="cover-fav">
          <Star size={13} fill="currentColor" strokeWidth={0} />
        </span>
      )}
      <GameAddFan
        game={{ id: entry.gameId, name: entry.name, cover: entry.cover }}
        hoverOnly
      />
    </div>
  );
}

// Dernière tuile d'une rangée d'aperçu quand la liste dépasse 6 jeux :
// aperçu empilé des jeux restants + « Voir le reste » → onglet Tous les jeux.
function ShowMoreTile({ rest, onClick }) {
  const preview = rest.slice(0, 3);
  return (
    <button className="cover-more clickable" onClick={onClick} title="Voir le reste des jeux">
      <span className="cover-more-stack" aria-hidden="true">
        {preview.map((e) => (
          <span className="cover-more-cover" key={e.gameId}>
            {e.cover ? (
              <img src={e.cover} alt="" loading="lazy" draggable="false" />
            ) : (
              <span className="cover-more-ph" />
            )}
          </span>
        ))}
      </span>
      <span className="cover-more-veil" aria-hidden="true" />
      <span className="cover-more-body">
        <span className="cover-more-count">+{rest.length}</span>
        <span className="cover-more-text">
          Voir le reste <ArrowRight size={13} />
        </span>
      </span>
    </button>
  );
}

// Bandeau défilant "TV Time" : les infos glissent en boucle.
function Marquee({ facts }) {
  if (!facts.length) return null;
  const track = (
    <div className="pf-marquee-track">
      {facts.map((f, i) => (
        <span className="pf-fact" key={i}>
          <f.Icon size={14} />{" "}
          {f.html ? (
            <span dangerouslySetInnerHTML={twemojiHtml(f.text)} />
          ) : (
            f.text
          )}
          <span className="pf-fact-sep">◆</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="pf-marquee" aria-hidden="true">
      <div className="pf-marquee-inner">
        {track}
        {track}
      </div>
    </div>
  );
}

function ProfileListCard({ list }) {
  const meta = typeMeta(list.type);
  return (
    <Link to={`/lists/${list.id}`} className="list-card clickable">
      <div className={`list-preview ${list.preview?.length ? "" : "empty"}`}>
        {list.preview?.length ? (
          list.preview.map((src, i) => (
            <span className="list-preview-cover" key={i} style={{ "--i": i }}>
              <img src={src} alt="" loading="lazy" draggable="false" />
            </span>
          ))
        ) : (
          <meta.Icon size={30} />
        )}
      </div>
      <div className="list-card-body">
        <div className="list-card-badges">
          <span className={`list-type-badge t-${list.type}`}>
            <meta.Icon size={13} /> {meta.label}
          </span>
          {list.visibility === "private" && (
            <span className="list-priv-badge" title="Privée">
              <Lock size={12} />
            </span>
          )}
        </div>
        <h3 className="list-card-title">{list.title}</h3>
        <div className="list-card-foot">
          <span className={`list-stat ${list.liked ? "liked" : ""}`}>
            <Heart size={14} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
          </span>
          <span className="list-stat">
            <MessageCircle size={14} /> {list.commentCount}
          </span>
          <span className="list-stat time">màj {timeAgo(list.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export default function Profile() {
  const { username: routeUsername } = useParams();
  const { user, token, updateUser } = useAuth();
  const { map } = useLibrary();
  const targetUsername = routeUsername || user?.username;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Onglet + filtres persistés dans l'URL (survivent au refresh, partageables).
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "overview";
  const openOst = searchParams.get("ost"); // deep-link : ouvre le fil d'une OST
  const listFilter = searchParams.get("lf") || "all";
  const listSort = searchParams.get("ls") || "recent";
  const setParam = (key, value, def) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value === def) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true }
    );
  const setTab = (t) => setParam("tab", t, "overview");
  const setListFilter = (v) => setParam("lf", v, "all");
  const setListSort = (v) => setParam("ls", v, "recent");
  // Bascule vers l'onglet « Tous les jeux » avec des filtres pré-appliqués
  // (depuis les cartes « Voir le reste » de l'aperçu). On repart d'un jeu de
  // filtres propre pour ne pas mélanger avec une recherche précédente.
  const goAllGames = (preset) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      ["q", "st", "fav", "rop", "rv", "sort", "dir", "plat", "platm", "gen", "genm", "mod", "modm", "thm", "thmm"].forEach(
        (k) => p.delete(k)
      );
      p.set("tab", "allgames");
      Object.entries(preset || {}).forEach(([k, v]) => p.set(k, v));
      return p;
    });
    window.scrollTo({ top: 0 });
  };
  const [modalGame, setModalGame] = useState(null);
  const [addModal, setAddModal] = useState(null); // { mode, status, title }
  const [editing, setEditing] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [reframing, setReframing] = useState(false);
  const [pendingCover, setPendingCover] = useState(null);
  const [coverMenu, setCoverMenu] = useState(false);
  const [followModal, setFollowModal] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const avatarInput = useRef(null);
  const coverMenuRef = useRef(null);
  useClickOutside(coverMenuRef, () => setCoverMenu(false), coverMenu);

  const profile = data?.profile;
  const isMe = profile?.isMe;

  // Chargement principal (changement de profil).
  // On affiche d'abord la dernière version en cache (nom, avatar, sections…)
  // pour un rendu immédiat, puis on revalide en fond.
  useEffect(() => {
    if (!targetUsername) return;
    let alive = true;
    const cached = profileCache.get(targetUsername);
    if (cached) {
      setData(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    apiFetch(`/users/${targetUsername}`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        profileCache.set(targetUsername, d);
      })
      // Si la revalidation échoue mais qu'on a déjà du cache, on garde le cache.
      .catch((e) => alive && !cached && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [targetUsername, token]);

  // Rafraîchit discrètement mon profil quand ma bibliothèque change
  useEffect(() => {
    if (!data?.profile?.isMe) return;
    apiFetch(`/users/${targetUsername}`, { token })
      .then((d) => {
        setData(d);
        profileCache.set(targetUsername, d);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const facts = useMemo(() => {
    if (!profile) return [];
    const c = profile.counts;
    const f = [];
    if (profile.tagline)
      f.push({ Icon: Sparkles, text: `Si j'étais un perso de jeu vidéo, je serais ${profile.tagline}` });
    f.push({ Icon: Gamepad2, text: `${c.games} jeu${c.games > 1 ? "x" : ""} dans la collection` });
    if (c.finished) f.push({ Icon: Trophy, text: `${c.finished} terminé${c.finished > 1 ? "s" : ""}` });
    if (c.favorites) f.push({ Icon: Heart, text: `${c.favorites} coup${c.favorites > 1 ? "s" : ""} de cœur` });
    f.push({ Icon: CalendarDays, text: `Membre depuis ${new Date(profile.createdAt).getFullYear()}` });
    if (profile.bio) f.push({ Icon: Quote, text: profile.bio, html: true });
    return f;
  }, [profile]);

  async function toggleFollow() {
    if (followBusy || !profile) return;
    setFollowBusy(true);
    const was = profile.isFollowing;
    setData((d) => ({
      ...d,
      profile: {
        ...d.profile,
        isFollowing: !was,
        counts: { ...d.profile.counts, followers: d.profile.counts.followers + (was ? -1 : 1) },
      },
    }));
    try {
      const r = await apiFetch(`/users/${profile.id}/follow`, { method: "POST", token });
      setData((d) => ({
        ...d,
        profile: { ...d.profile, isFollowing: r.following, counts: { ...d.profile.counts, followers: r.followersCount } },
      }));
    } catch {
      setData((d) => ({
        ...d,
        profile: {
          ...d.profile,
          isFollowing: was,
          counts: { ...d.profile.counts, followers: d.profile.counts.followers + (was ? 1 : -1) },
        },
      }));
    } finally {
      setFollowBusy(false);
    }
  }

  async function onAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("avatar", file);
    try {
      const r = await apiUpload("/users/me/avatar", fd, token);
      updateUser({ avatar: r.avatar });
      setData((d) => ({ ...d, profile: { ...d.profile, avatar: r.avatar } }));
    } catch (err) {
      alert(err.message);
    }
    e.target.value = "";
  }

  // Applique une nouvelle image de couverture à MON profil (cadrage recentré).
  // Ne met à jour la bannière affichée que si on est sur son propre profil
  // (on peut définir sa couverture depuis le feed d'un autre joueur).
  async function applyCover(url, posStr = null) {
    const { user: u } = await apiFetch("/users/me", {
      method: "PUT",
      token,
      body: { cover: url, coverPos: posStr },
    });
    updateUser({ cover: u.cover, coverPos: u.coverPos });
    if (isMe) {
      setData((d) => {
        const next = { ...d, profile: { ...d.profile, cover: u.cover, coverPos: u.coverPos } };
        profileCache.set(targetUsername, next);
        return next;
      });
    }
  }

  async function pickCover(url) {
    setPickingCover(false);
    setPendingCover(url);
    setReframing(true);
  }

  async function saveCoverPos(posStr) {
    try {
      if (pendingCover) {
        await applyCover(pendingCover, posStr);
      } else {
        const { user: u } = await apiFetch("/users/me", {
          method: "PUT",
          token,
          body: { coverPos: posStr },
        });
        updateUser({ coverPos: u.coverPos });
        setData((d) => {
          const next = { ...d, profile: { ...d.profile, coverPos: u.coverPos } };
          profileCache.set(targetUsername, next);
          return next;
        });
      }
      setPendingCover(null);
      setReframing(false);
    } catch (err) {
      alert(err.message);
    }
  }

  // Enregistre l'ordre de préférence des OST favorites (drag & drop de l'onglet OST).
  async function saveOstOrder(gameIds) {
    // MAJ optimiste : on met à jour le profil local + le cache tout de suite.
    setData((d) => {
      const next = { ...d, profile: { ...d.profile, ostOrder: gameIds } };
      profileCache.set(targetUsername, next);
      return next;
    });
    try {
      await apiFetch("/users/me", { method: "PUT", token, body: { ostOrder: gameIds } });
    } catch (err) {
      alert(err.message);
    }
  }

  if (loading)
    return (
      <div className="lists-loading">
        <Loader2 size={20} className="spin" /> Chargement du profil…
      </div>
    );
  if (error)
    return (
      <div className="explorer-error card" style={{ maxWidth: 520, margin: "3rem auto" }}>
        <h3>Profil introuvable</h3>
        <p>{error}</p>
        <Link to="/lists" className="btn btn-ghost">Retour</Link>
      </div>
    );
  if (!data) return null;

  const { favorites, library, lists } = data;
  const c = profile.counts;
  const ostCount = library.filter((e) => e.favoriteOst?.name).length;
  const shownLists = (listFilter === "all" ? lists : lists.filter((l) => l.type === listFilter))
    .slice()
    .sort((a, b) =>
      listSort === "liked"
        ? b.likeCount - a.likeCount
        : new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  const openGame = (e, opts) =>
    setModalGame({ id: e.gameId, name: e.name, cover: e.cover, openReview: !!opts?.review });

  return (
    <div className="profile pf">
      {/* ---------- Bannière ---------- */}
      <header className="pf-banner">
        <div
          className="pf-cover"
          style={
            profile.cover
              ? {
                  backgroundImage: `url(${profile.cover})`,
                  backgroundPosition: profile.coverPos || "center",
                }
              : undefined
          }
        >
          <div className="pf-cover-scrim" />
          {isMe && (
            <div className={`pf-cover-menu ${coverMenu ? "open" : ""}`} ref={coverMenuRef}>
              <button
                className="pf-cover-edit clickable"
                onClick={() => setCoverMenu((v) => !v)}
              >
                <Camera size={15} /> Couverture
                <ChevronDown size={14} className="pf-cover-caret" />
              </button>
              {coverMenu && (
                <div className="pf-cover-pop">
                  <button
                    className="clickable"
                    onClick={() => {
                      setCoverMenu(false);
                      setPickingCover(true);
                    }}
                  >
                    <ImageIcon size={15} /> Changer l'image
                  </button>
                  <button
                    className="clickable"
                    onClick={() => {
                      setCoverMenu(false);
                      setReframing(true);
                    }}
                    disabled={!profile.cover}
                  >
                    <Move size={15} /> Recadrer
                  </button>
                </div>
              )}
            </div>
          )}
          <Marquee facts={facts} />
        </div>

        <div className="pf-identity">
          <div className="pf-avatar-wrap">
            <div className="pf-avatar">
              {profile.avatar ? (
                <img src={profile.avatar} alt={profile.username} />
              ) : (
                <span className="pf-avatar-fallback">
                  {(profile.username || "?")[0].toUpperCase()}
                </span>
              )}
            </div>
            {isMe && (
              <>
                <button
                  className="pf-avatar-edit clickable"
                  onClick={() => avatarInput.current?.click()}
                  title="Changer la photo"
                >
                  <Camera size={15} />
                </button>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={onAvatarFile}
                />
              </>
            )}
          </div>

          <div className="pf-idmain">
            <h1 className="pf-username">{profile.username}</h1>
            {profile.bio && (
              <p className="pf-bio" dangerouslySetInnerHTML={twemojiHtml(profile.bio)} />
            )}
            <div className="pf-stats">
              <button
                className="pf-stat clickable"
                onClick={() => setFollowModal("followers")}
              >
                <strong>{c.followers}</strong> abonnés
              </button>
              <button
                className="pf-stat clickable"
                onClick={() => setFollowModal("following")}
              >
                <strong>{c.following}</strong> abonnements
              </button>
            </div>
          </div>

          <div className="pf-actions">
            {isMe ? (
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                <Pencil size={16} /> Modifier le profil
              </button>
            ) : (
              <button
                className={`follow-btn clickable ${profile.isFollowing ? "following" : ""}`}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                {profile.isFollowing ? (
                  <><UserCheck size={17} /> Suivi(e)</>
                ) : (
                  <><UserPlus size={17} /> Suivre</>
                )}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Onglets ---------- */}
      <nav className="profile-tabs">
        <button
          className={`profile-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
        >
          <LayoutGrid size={16} /> Aperçu
        </button>
        <button
          className={`profile-tab ${tab === "feed" ? "active" : ""}`}
          onClick={() => setTab("feed")}
        >
          <Repeat2 size={16} /> Feed
        </button>
        <button
          className={`profile-tab ${tab === "allgames" ? "active" : ""}`}
          onClick={() => setTab("allgames")}
        >
          <Gamepad2 size={16} /> Tous les jeux
          <span className="tab-count">{c.games}</span>
        </button>
        <button
          className={`profile-tab ${tab === "lists" ? "active" : ""}`}
          onClick={() => setTab("lists")}
        >
          <List size={16} /> Listes
          <span className="tab-count">{lists.length}</span>
        </button>
        <button
          className={`profile-tab ${tab === "ost" ? "active" : ""}`}
          onClick={() => setTab("ost")}
        >
          <Music size={16} /> OST
          {ostCount > 0 && <span className="tab-count">{ostCount}</span>}
        </button>
        <button
          className={`profile-tab ${tab === "videos" ? "active" : ""}`}
          onClick={() => setTab("videos")}
        >
          <Film size={16} /> Vidéos
          {c.videos > 0 && <span className="tab-count">{c.videos}</span>}
        </button>
        <button
          className={`profile-tab ${tab === "activity" ? "active" : ""}`}
          onClick={() => setTab("activity")}
        >
          <MessageSquareText size={16} /> Reviews & commentaires
        </button>
        <button
          className={`profile-tab ${tab === "reco" ? "active" : ""}`}
          onClick={() => setTab("reco")}
        >
          <Send size={16} /> Recommandations
          {c.recommendations > 0 && <span className="tab-count">{c.recommendations}</span>}
        </button>
      </nav>

      {/* ---------- Aperçu ---------- */}
      {tab === "overview" && (
        <>
          <section className="profile-section">
            <h2 className="profile-section-title">
              <Heart size={18} /> Jeux favoris
              {favorites.length > 0 && <span className="section-count">{favorites.length}</span>}
            </h2>
            <div className="cover-row">
              {favorites.slice(0, 6).map((e) => (
                <CoverTile key={e.gameId} entry={e} fav />
              ))}
              {favorites.length > 6 && (
                <ShowMoreTile
                  rest={favorites.slice(6)}
                  onClick={() => goAllGames({ fav: "1" })}
                />
              )}
              {isMe &&
                favorites.length <= 6 &&
                Array.from({ length: Math.max(1, 6 - favorites.length) }).map((_, i) => (
                  <button
                    key={`add-${i}`}
                    className="cover-add clickable"
                    onClick={() =>
                      setAddModal({ mode: "favorite", title: "Ajouter aux favoris" })
                    }
                    title="Ajouter un favori"
                  >
                    <Plus size={26} />
                  </button>
                ))}
              {!favorites.length && !isMe && (
                <p className="pf-section-empty font-fun">Aucun favori pour l'instant.</p>
              )}
            </div>
          </section>

          {SECTIONS.map(({ key, label }) => {
            const list = library.filter((e) => e.status === key);
            // Chez soi : on montre toutes les sections (même vides) pour pouvoir
            // ajouter. Chez les autres : on masque les sections vides.
            if (!list.length && !isMe) return null;
            return (
              <section className="profile-section" key={key}>
                <h2 className="profile-section-title">
                  {label}
                  {list.length > 0 && <span className="section-count">{list.length}</span>}
                </h2>
                <div className="cover-row">
                  {list.slice(0, 6).map((e) => (
                    <CoverTile key={e.gameId} entry={e} />
                  ))}
                  {list.length > 6 && (
                    <ShowMoreTile
                      rest={list.slice(6)}
                      onClick={() => goAllGames({ st: key })}
                    />
                  )}
                  {isMe &&
                    list.length <= 6 &&
                    Array.from({ length: Math.max(1, 6 - list.length) }).map((_, i) => (
                      <button
                        key={`add-${i}`}
                        className="cover-add clickable"
                        onClick={() =>
                          setAddModal({ mode: "status", status: key, title: `Ajouter à « ${label} »` })
                        }
                        title={`Ajouter à ${label}`}
                      >
                        <Plus size={26} />
                      </button>
                    ))}
                </div>
              </section>
            );
          })}

          {library.length === 0 && !isMe && (
            <div className="profile-empty font-fun">Ce joueur n'a pas encore de jeux.</div>
          )}
        </>
      )}

      {/* ---------- Feed (fan arts republiés) ---------- */}
      {tab === "feed" && (
        <ProfileFeed
          username={targetUsername}
          isMe={isMe}
          token={token}
          profile={profile}
          onSetCover={applyCover}
        />
      )}

      {/* ---------- Tous les jeux ---------- */}
      {tab === "allgames" &&
        (library.length === 0 ? (
          <div className="profile-empty font-fun">
            {isMe
              ? "Ta bibliothèque est vide — ajoute des jeux depuis l'Explorer !"
              : "Ce joueur n'a pas encore de jeux."}
          </div>
        ) : (
          <ProfileAllGames library={library} onOpen={openGame} />
        ))}

      {/* ---------- Listes ---------- */}
      {tab === "lists" && (
        <section className="profile-section">
          {lists.length === 0 ? (
            <div className="profile-empty font-fun">
              {isMe ? (
                <>
                  Aucune liste pour l'instant.{" "}
                  <Link to="/lists" className="pf-inline-link">En créer une</Link>
                </>
              ) : (
                "Aucune liste publique."
              )}
            </div>
          ) : (
            <>
              <div className="act-head">
                <div className="act-subtabs">
                  {LIST_FILTERS.map((f) => {
                    const n =
                      f.key === "all"
                        ? lists.length
                        : lists.filter((l) => l.type === f.key).length;
                    return (
                      <button
                        key={f.key}
                        className={`act-subtab clickable ${listFilter === f.key ? "active" : ""}`}
                        onClick={() => setListFilter(f.key)}
                      >
                        <f.Icon size={16} /> {f.label}
                        <span className="act-subtab-count">{n}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="act-head-tools">
                  <label className="act-sort">
                    <span className="act-sort-label">Trier</span>
                    <select value={listSort} onChange={(e) => setListSort(e.target.value)}>
                      {LIST_SORTS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {shownLists.length === 0 ? (
                <div className="profile-empty font-fun">Aucune liste de ce type.</div>
              ) : (
                <div className="lists-grid">
                  {shownLists.map((l) => (
                    <ProfileListCard key={l.id} list={l} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ---------- OST favorites ---------- */}
      {tab === "ost" && (
        <ProfileOST
          library={library}
          isMe={isMe}
          ownerId={profile.id}
          token={token}
          ostOrder={profile.ostOrder || []}
          onOrderChange={saveOstOrder}
          openGameId={openOst ? Number(openOst) : null}
          onOpenConsumed={() => setParam("ost", null, null)}
        />
      )}

      {/* ---------- Vidéos (documentaires) ---------- */}
      {tab === "videos" && (
        <ProfileVideos username={targetUsername} isMe={isMe} token={token} />
      )}

      {/* ---------- Reviews & commentaires ---------- */}
      {tab === "activity" && (
        <ProfileActivity
          username={targetUsername}
          token={token}
          isMe={isMe}
          libraryMap={map}
          onOpenGame={openGame}
        />
      )}

      {/* ---------- Recommandations ---------- */}
      {tab === "reco" && (
        <ProfileRecommendations username={targetUsername} token={token} isMe={isMe} />
      )}

      {/* ---------- Modals ---------- */}
      {modalGame && (
        <PlayedModal
          game={modalGame}
          openReview={modalGame.openReview}
          onClose={() => setModalGame(null)}
        />
      )}
      {addModal && (
        <AddGameModal
          mode={addModal.mode}
          status={addModal.status}
          title={addModal.title}
          onClose={() => setAddModal(null)}
        />
      )}
      {editing && (
        <EditProfileModal
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={(u) => {
            setEditing(false);
            setData((d) => {
              const next = {
                ...d,
                profile: {
                  ...d.profile,
                  username: u.username,
                  bio: u.bio,
                  tagline: u.tagline,
                  taglineImage: u.taglineImage,
                },
              };
              profileCache.set(targetUsername, next);
              return next;
            });
          }}
        />
      )}
      {pickingCover && (
        <CoverPickerModal
          entries={library}
          current={profile.cover}
          onPick={pickCover}
          onClose={() => setPickingCover(false)}
        />
      )}
      {reframing && profile.cover && (
        <ReframeCoverModal
          cover={pendingCover || profile.cover}
          pos={profile.coverPos}
          onSave={saveCoverPos}
          onClose={() => {
            setPendingCover(null);
            setReframing(false);
          }}
        />
      )}
      {followModal && (
        <FollowListModal
          userId={profile.id}
          mode={followModal}
          title={followModal === "followers" ? "Abonnés" : "Abonnements"}
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}
