import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
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
  MessageSquareText,
  LayoutGrid,
  List,
  Music,
  Send,
  Move,
  Image as ImageIcon,
  ChevronDown,
  Repeat2,
  Film,
  BarChart3,
} from "lucide-react";
import twemoji from "@twemoji/api";
import { apiFetch, apiUpload } from "../lib/api";
import { makeCache } from "../lib/cache";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import { timeAgo } from "../lib/lists";
import PlayedModal from "../components/PlayedModal";
import AddGameModal from "../components/AddGameModal";
import ProfileAllGames from "../components/ProfileAllGames";
import ProfileOverview from "../components/ProfileOverview";
import ProfileActivity from "../components/ProfileActivity";
import ProfileOST from "../components/ProfileOST";
import ProfileFeed from "../components/ProfileFeed";
import ProfileRecommendations from "../components/ProfileRecommendations";
import ProfileVideos from "../components/ProfileVideos";
import ProfileStats from "../components/ProfileStats";
import ProfileLists from "../components/ProfileLists";
import EditProfileModal from "../components/EditProfileModal";
import CoverPickerModal from "../components/CoverPickerModal";
import ReframeCoverModal from "../components/ReframeCoverModal";
import FollowListModal from "../components/FollowListModal";
import { useClickOutside } from "../hooks/useClickOutside";
import { useTabSwipe } from "../hooks/useTabSwipe";

// Ordre des onglets (pour le swipe gauche/droite et le recentrage de la nav).
const TAB_ORDER = [
  "overview",
  "feed",
  "allgames",
  "stats",
  "lists",
  "ost",
  "videos",
  "activity",
  "reco",
];

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

// Présence façon réseau social : point vert pulsant si vu il y a < 10 min,
// sinon « Dernière activité il y a … » (alimenté par User.lastSeenAt).
function Presence({ lastSeenAt }) {
  if (!lastSeenAt) return null;
  const online = Date.now() - new Date(lastSeenAt).getTime() < 10 * 60 * 1000;
  return (
    <span
      className={`pf-presence ${online ? "online" : ""}`}
      title={new Date(lastSeenAt).toLocaleString()}
    >
      <span className="pf-presence-dot" />
      {online ? "En ligne" : `Dernière activité ${timeAgo(lastSeenAt)}`}
    </span>
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
  const setTab = (t) => {
    setParam("tab", t, "overview");
    scrollTabsToTop();
  };
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
  const tabsTopRef = useRef(null);
  const tabsNavRef = useRef(null);
  useClickOutside(coverMenuRef, () => setCoverMenu(false), coverMenu);

  // Au changement d'onglet, ramène le contenu au début : on remonte juste sous
  // les onglets (collés en haut) si on était plus bas — sinon on ne bouge pas
  // (on ne veut pas redescendre quand on est déjà en haut).
  function scrollTabsToTop() {
    requestAnimationFrame(() => {
      const el = tabsTopRef.current;
      if (!el) return;
      const y = window.scrollY + el.getBoundingClientRect().top - 60;
      window.scrollTo({ top: Math.min(window.scrollY, y) });
    });
  }

  // Recentre horizontalement la barre d'onglets sur l'onglet actif (le met en
  // tête), pour qu'il ne reste pas coupé sur le bord. Le navigateur borne le
  // scroll : le dernier onglet ne force pas de défilement inutile.
  useEffect(() => {
    const nav = tabsNavRef.current;
    const active = nav?.querySelector(".profile-tab.active");
    if (active) nav.scrollTo({ left: active.offsetLeft - 12, behavior: "smooth" });
  }, [tab]);

  // Swipe gauche/droite (mobile) → onglet précédent / suivant.
  const swipeTab = (dir) => {
    const i = TAB_ORDER.indexOf(tab);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= TAB_ORDER.length) return;
    setTab(TAB_ORDER[j]);
  };
  const swipe = useTabSwipe({
    onPrev: () => swipeTab(-1),
    onNext: () => swipeTab(1),
  });

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

  // Supprime une de mes listes depuis l'onglet Listes du profil.
  async function deleteList(list) {
    if (!confirm(`Supprimer la liste « ${list.title} » ? Cette action est définitive.`))
      return;
    const snapshot = data;
    setData((d) => {
      const next = { ...d, lists: d.lists.filter((l) => l.id !== list.id) };
      profileCache.set(targetUsername, next);
      return next;
    });
    try {
      await apiFetch(`/lists/${list.id}`, { method: "DELETE", token });
    } catch (e) {
      alert(e.message);
      setData(snapshot); // rollback
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

  // Enregistre la personnalisation de l'aperçu (ordre des sections / détails des
  // jaquettes). MAJ optimiste du profil local + cache, puis persistance serveur.
  async function saveOverviewPrefs(prefs) {
    setData((d) => {
      const next = { ...d, profile: { ...d.profile, ...prefs } };
      profileCache.set(targetUsername, next);
      return next;
    });
    try {
      await apiFetch("/users/me/overview", { method: "PUT", token, body: prefs });
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
  const openGame = (e, opts) =>
    setModalGame({ id: e.gameId, name: e.name, cover: e.cover, openReview: !!opts?.review });

  return (
    <div className="profile pf" {...swipe}>
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
            <div className="pf-namerow">
              <h1 className="pf-username">{profile.username}</h1>
              {!isMe && <Presence lastSeenAt={profile.lastSeenAt} />}
            </div>
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
      {/* Ancre (hors flux sticky) pour recaler le scroll au changement d'onglet. */}
      <div ref={tabsTopRef} aria-hidden="true" />
      <nav className="profile-tabs" ref={tabsNavRef}>
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
          className={`profile-tab ${tab === "stats" ? "active" : ""}`}
          onClick={() => setTab("stats")}
        >
          <BarChart3 size={16} /> Stats
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

      {/* Enveloppe des onglets : une hauteur minimale garantit que la page ne se
          « ratatine » pas pendant qu'un onglet asynchrone charge (spinner court).
          Sans ça, le document rétrécit d'un coup et le navigateur ramène le scroll
          tout en haut (on repasse au-dessus des onglets collés → on revoit la pp). */}
      <div className="pf-tabpanel">
      {/* ---------- Aperçu ---------- */}
      {tab === "overview" && (
        <ProfileOverview
          favorites={favorites}
          library={library}
          lists={lists}
          profile={profile}
          isMe={isMe}
          username={targetUsername}
          token={token}
          onAddFavorite={() =>
            setAddModal({ mode: "favorite", title: "Ajouter aux favoris" })
          }
          onAddStatus={(key, label) =>
            setAddModal({ mode: "status", status: key, title: `Ajouter à « ${label} »` })
          }
          goAllGames={goAllGames}
          onSavePrefs={saveOverviewPrefs}
          onOpenTab={setTab}
        />
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

      {/* ---------- Stats ---------- */}
      {tab === "stats" && <ProfileStats username={targetUsername} token={token} />}

      {/* ---------- Listes ---------- */}
      {tab === "lists" && (
        <ProfileLists lists={lists} isMe={isMe} onDelete={deleteList} />
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
      </div>

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
