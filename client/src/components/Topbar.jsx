import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Bell,
  User,
  Settings,
  LogOut,
  ChevronDown,
  X,
  AtSign,
  Reply,
  Heart,
  MessageSquare,
  Loader2,
  Send,
  Plus,
  Gamepad2,
  Users,
  CornerDownLeft,
  Music,
  Repeat2,
  Headphones,
  Sun,
  Moon,
  Megaphone,
  History,
  Trash2,
  Shield,
  Award,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useClickOutside } from "../hooks/useClickOutside";
import { apiFetch } from "../lib/api";
import { safeSetItem } from "../lib/storage";
import { timeAgo } from "../lib/lists";

// Libellé + icône selon le type de notification.
const NOTIF_META = {
  mention: { Icon: AtSign, verb: "t'a mentionné" },
  gamemedia_mention: { Icon: AtSign, verb: "t'a mentionné sur" },
  gamemedia_like: { Icon: Heart, verb: "a aimé ton post sur" },
  gamemedia_comment: { Icon: MessageSquare, verb: "a commenté ton post sur" },
  gamemedia_comment_reply: { Icon: Reply, verb: "a répondu à ton commentaire sur" },
  gamemedia_comment_like: { Icon: Heart, verb: "a aimé ton commentaire sur" },
  comment_reply: { Icon: Reply, verb: "a répondu à ton commentaire" },
  comment_like: { Icon: Heart, verb: "a aimé ton commentaire" },
  list_comment: { Icon: MessageSquare, verb: "a commenté ta liste" },
  list_like: { Icon: Heart, verb: "a aimé ta liste" },
  playlist_listen: { Icon: Headphones, verb: "a écouté ta playlist" },
  review_comment: { Icon: MessageSquare, verb: "a répondu à ta review" },
  review_comment_reply: { Icon: Reply, verb: "a répondu à ton commentaire" },
  review_comment_like: { Icon: Heart, verb: "a aimé ton commentaire" },
  ost_comment: { Icon: Music, verb: "a commenté ton OST" },
  repost_comment: { Icon: Repeat2, verb: "a commenté ton fan art republié" },
  repost_like: { Icon: Heart, verb: "a aimé ton fan art republié" },
  video_comment: { Icon: MessageSquare, verb: "a commenté une vidéo que tu as recommandée" },
  recommendation: { Icon: Send, verb: "t'a recommandé" },
  recommendation_boost: { Icon: Plus, verb: "a fait +1 sur ta reco de" },
  recommendation_comment: { Icon: MessageSquare, verb: "a commenté la reco de" },
  download_react: { Icon: Megaphone, verb: "se moque de ton téléchargement de" },
  // Notif système (pas d'acteur) : le titre vient de `title`, le détail du snippet.
  import_pending: { Icon: Gamepad2, verb: "", system: true, title: "Jeux à valider" },
  psn_ready: { Icon: Gamepad2, verb: "", system: true, title: "Jeux à valider" },
  psn_request: { Icon: Gamepad2, verb: "", system: true, title: "Jeux à valider" },
  // Badge de mission débloqué : le nom du badge est dans `gameName`.
  mission_unlocked: { Icon: Award, verb: "", system: true, badge: true, title: "Badge débloqué" },
};

// Historique local des derniers jeux ouverts depuis la recherche : affiché
// dès l'ouverture de la barre, avant de taper quoi que ce soit.
const SEARCH_HISTORY_KEY = "mpl_search_history";
const SEARCH_HISTORY_MAX = 8;

function loadSearchHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function Topbar() {
  const { user, token, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState("games"); // 'games' | 'users'
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(null); // 'notif' | 'profile' | null

  // Notifications
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  const searchRef = useRef(null);
  const searchInput = useRef(null);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  useClickOutside(searchRef, () => closeSearch(), searchOpen);
  useClickOutside(notifRef, () => setMenu(null), menu === "notif");
  useClickOutside(profileRef, () => setMenu(null), menu === "profile");

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // Recherche instantanée (debounce) : jeux via IGDB, joueurs via username.
  useEffect(() => {
    const term = query.trim();
    if (!searchOpen || !term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        if (searchMode === "games") {
          const d = await apiFetch(
            `/games?search=${encodeURIComponent(term)}&limit=6`,
            { token }
          );
          setResults(d.games || []);
        } else {
          const d = await apiFetch(
            `/users/search/mentions?q=${encodeURIComponent(term)}`,
            { token }
          );
          setResults(d.users || []);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchMode, searchOpen, token]);

  function closeSearch() {
    setSearchOpen(false);
    setResults([]);
  }

  // Jeux : Entrée / clic « plus de résultats » → page Explorer.
  function goExplore() {
    const term = query.trim();
    navigate(term ? `/explore?q=${encodeURIComponent(term)}` : "/explore");
    closeSearch();
  }

  // --- Historique des derniers jeux cherchés (localStorage) ---
  const [history, setHistory] = useState(loadSearchHistory);

  function pushHistory(g) {
    const next = [
      { id: g.id, name: g.name, cover: g.cover || null },
      ...history.filter((h) => h.id !== g.id),
    ].slice(0, SEARCH_HISTORY_MAX);
    setHistory(next);
    safeSetItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  }

  function removeFromHistory(id) {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    safeSetItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  }

  function clearHistory() {
    setHistory([]);
    safeSetItem(SEARCH_HISTORY_KEY, "[]");
  }

  function openHistoryGame(g) {
    pushHistory(g); // remonte le jeu en tête de l'historique
    navigate(`/game/${g.id}`);
    closeSearch();
  }

  function openResult(r) {
    if (searchMode === "games") {
      pushHistory(r);
      navigate(`/game/${r.id}`);
    } else navigate(`/u/${r.username}`);
    setQuery("");
    closeSearch();
  }

  // Compteur de non-lues : au montage + toutes les 45s.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const poll = () =>
      apiFetch("/notifications/unread-count", { token })
        .then((d) => alive && setUnread(d.unread || 0))
        .catch(() => {});
    poll();
    const id = setInterval(poll, 45000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  // Ouverture du panneau : charge les notifs et marque comme lues.
  const openNotifs = useCallback(async () => {
    setNotifLoading(true);
    try {
      const d = await apiFetch("/notifications", { token });
      setNotifs(d.notifications || []);
      if ((d.unread || 0) > 0) {
        await apiFetch("/notifications/read", { method: "POST", token });
      }
      setUnread(0);
    } catch {
      /* silencieux */
    } finally {
      setNotifLoading(false);
    }
  }, [token]);

  function toggleNotif() {
    setMenu((m) => {
      const next = m === "notif" ? null : "notif";
      if (next === "notif") openNotifs();
      return next;
    });
  }

  function openNotifTarget(n) {
    setMenu(null);
    // Notif système : jeux à valider après une synchro → Paramètres > Imports.
    if (n.type === "import_pending" || n.type === "psn_ready") {
      navigate("/settings?tab=imports");
      return;
    }
    // Admin : une demande de synchro PSN à traiter → panel Admin.
    if (n.type === "psn_request") {
      navigate("/admin");
      return;
    }
    // Badge de mission débloqué → onglet Badges de mon profil.
    if (n.type === "mission_unlocked") {
      navigate("/profile?tab=badges");
      return;
    }
    // OST : ouvre l'onglet OST du profil concerné, sur la bonne piste.
    if (n.ostOwner) {
      navigate(`/u/${n.ostOwner}?tab=ost${n.game ? `&ost=${n.game}` : ""}`);
    } else if (n.repostOwner) {
      // Repost : ouvre l'onglet Feed du profil dont vient la republication.
      navigate(`/u/${n.repostOwner}?tab=feed`);
    } else if (n.videoOwner) {
      // Vidéo : ouvre l'onglet Vidéos du profil dont vient la recommandation.
      navigate(`/u/${n.videoOwner}?tab=videos`);
    } else if (n.type?.startsWith("recommendation")) {
      if (n.type === "recommendation" && n.game) navigate(`/game/${n.game}`);
      else navigate("/profile?tab=reco");
    } else if (n.type === "download_react") {
      // On se moque de mon délit : mon propre feed (card + avis de recherche).
      navigate("/profile?tab=feed");
    } else if (n.type?.startsWith("review") && n.game) {
      navigate(`/game/${n.game}?tab=reviews`);
    } else if (n.type?.startsWith("gamemedia") && n.game) {
      // Mention / like / commentaire du mur média → onglet Feed du jeu, ancré
      // sur le post concerné quand on le connaît.
      navigate(`/game/${n.game}?tab=feed${n.postId ? `&post=${n.postId}` : ""}`);
    } else if (n.listId) navigate(`/lists/${n.listId}`);
    // Mention dans une réponse de review : pas de liste, mais un jeu ciblé.
    else if (n.game) navigate(`/game/${n.game}?tab=reviews`);
  }

  function onSearchSubmit(e) {
    e.preventDefault();
    // Un seul résultat : Entrée l'ouvre directement.
    if (results.length === 1) {
      openResult(results[0]);
      return;
    }
    // Pas de page « recherche de joueurs » : Entrée ne fait rien de plus en mode users.
    if (searchMode === "users") return;
    goExplore();
  }

  // Tab : bascule entre les onglets Jeux/Joueurs.
  function onSearchKeyDown(e) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    if (!query.trim()) return;
    setSearchMode((m) => (m === "games" ? "users" : "games"));
  }

  return (
    <header className="topbar">
      <div className="topbar-actions">
        {/* Thème (mobile uniquement : sur desktop il vit dans la sidebar) */}
        <button
          className="icon-btn theme-btn-mobile clickable"
          onClick={toggleTheme}
          aria-label={theme === "light" ? "Thème sombre" : "Thème clair"}
          title={theme === "light" ? "Thème sombre" : "Thème clair"}
        >
          {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
        </button>

        {/* Recherche */}
        <div className={`search ${searchOpen ? "open" : ""}`} ref={searchRef}>
          <form onSubmit={onSearchSubmit} className="search-form">
            <button
              type="button"
              className="icon-btn clickable"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label="Rechercher"
              title="Rechercher"
            >
              {searchOpen ? <X size={19} /> : <Search size={19} />}
            </button>
            <input
              ref={searchInput}
              className="search-input"
              type="text"
              placeholder={
                searchMode === "games"
                  ? "Rechercher un jeu…"
                  : "Rechercher un joueur…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
          </form>

          {/* Historique : la barre vient d'être ouverte, rien n'est encore tapé */}
          {searchOpen && !query.trim() && history.length > 0 && (
            <div className="search-panel card">
              <div className="search-hist-head">
                <span className="search-hist-title">
                  <History size={14} /> Derniers jeux cherchés
                </span>
                <button
                  type="button"
                  className="search-hist-clear clickable"
                  onClick={clearHistory}
                  title="Effacer l'historique"
                >
                  <Trash2 size={13} /> Effacer
                </button>
              </div>
              <div className="search-results">
                {history.map((g) => (
                  <div
                    key={g.id}
                    className="search-res search-res-hist clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => openHistoryGame(g)}
                    onKeyDown={(e) => e.key === "Enter" && openHistoryGame(g)}
                  >
                    <span className="search-res-cover">
                      {g.cover ? (
                        <img src={g.cover} alt="" loading="lazy" />
                      ) : (
                        <Gamepad2 size={16} />
                      )}
                    </span>
                    <span className="search-res-name">{g.name}</span>
                    <button
                      type="button"
                      className="search-res-x clickable"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromHistory(g.id);
                      }}
                      aria-label="Retirer de l'historique"
                      title="Retirer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {searchOpen && query.trim() && (
            <div className="search-panel card">
              <div className="search-tabs">
                <button
                  type="button"
                  className={`search-tab clickable ${
                    searchMode === "games" ? "active" : ""
                  }`}
                  onClick={() => setSearchMode("games")}
                >
                  <Gamepad2 size={15} /> Jeux
                </button>
                <button
                  type="button"
                  className={`search-tab clickable ${
                    searchMode === "users" ? "active" : ""
                  }`}
                  onClick={() => setSearchMode("users")}
                >
                  <Users size={15} /> Joueurs
                </button>
              </div>

              <div className="search-results">
                {searching ? (
                  <div className="search-state">
                    <Loader2 size={18} className="spin" />
                  </div>
                ) : results.length === 0 ? (
                  <div className="search-state">Aucun résultat.</div>
                ) : searchMode === "games" ? (
                  results.map((g) => (
                    <button
                      key={g.id}
                      className="search-res clickable"
                      onClick={() => openResult(g)}
                    >
                      <span className="search-res-cover">
                        {g.cover ? (
                          <img src={g.cover} alt="" loading="lazy" />
                        ) : (
                          <Gamepad2 size={16} />
                        )}
                      </span>
                      <span className="search-res-name">{g.name}</span>
                    </button>
                  ))
                ) : (
                  results.map((u) => (
                    <button
                      key={u.id}
                      className="search-res clickable"
                      onClick={() => openResult(u)}
                    >
                      <span className="search-res-av">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" loading="lazy" />
                        ) : (
                          (u.username || "?")[0].toUpperCase()
                        )}
                      </span>
                      <span className="search-res-name">{u.username}</span>
                    </button>
                  ))
                )}
              </div>

              {searchMode === "games" && !searching && results.length > 0 && (
                <button className="search-more clickable" onClick={goExplore}>
                  <CornerDownLeft size={13} /> Entrée pour plus de résultats
                </button>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="dd" ref={notifRef}>
          <button
            className="icon-btn clickable"
            onClick={toggleNotif}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={19} />
            {unread > 0 && (
              <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>
            )}
          </button>
          {menu === "notif" && (
            <div className="dd-menu card notif-menu">
              <div className="dd-title">Notifications</div>
              {notifLoading && notifs.length === 0 ? (
                <div className="notif-empty">
                  <Loader2 size={20} className="spin" />
                </div>
              ) : notifs.length === 0 ? (
                <div className="notif-empty">
                  <Bell size={22} />
                  <p>Pas de notification pour l'instant.</p>
                </div>
              ) : (
                <div className="notif-list">
                  {notifs.map((n) => {
                    const meta = NOTIF_META[n.type] || NOTIF_META.list_like;
                    // Une action sur une playlist se dit « playlist », pas « liste ».
                    let verb =
                      n.listType === "playlist"
                        ? meta.verb.replace("ta liste", "ta playlist")
                        : meta.verb;
                    // « … sur « Jeu » » : sans nom de jeu (vieux posts), on
                    // laisse tomber la préposition orpheline.
                    if (!n.gameName && verb.endsWith(" sur")) verb = verb.slice(0, -4);
                    return (
                      <button
                        key={n.id}
                        className={`notif-item clickable ${n.read ? "" : "unread"}`}
                        onClick={() => openNotifTarget(n)}
                      >
                        <span className="notif-avatar">
                          {meta.system ? (
                            <meta.Icon size={16} />
                          ) : n.actor?.avatar ? (
                            <img src={n.actor.avatar} alt="" />
                          ) : (
                            (n.actor?.username || "?")[0].toUpperCase()
                          )}
                          {!meta.system && (
                            <span className={`notif-type t-${n.type}`}>
                              <meta.Icon size={11} />
                            </span>
                          )}
                        </span>
                        <span className="notif-body">
                          {meta.system ? (
                            <span className="notif-text">
                              <strong>{meta.title || "Notification"}</strong>
                              {/* Badge de mission : son nom vit dans gameName. */}
                              {meta.badge && n.gameName && (
                                <> «&nbsp;{n.gameName}&nbsp;»</>
                              )}
                            </span>
                          ) : (
                            <span className="notif-text">
                              <strong>{n.actor?.username || "Quelqu'un"}</strong> {verb}
                              {n.listTitle && <> «&nbsp;{n.listTitle}&nbsp;»</>}
                              {n.gameName && <> «&nbsp;{n.gameName}&nbsp;»</>}
                            </span>
                          )}
                          {n.snippet && (
                            <span className="notif-snippet">{n.snippet}</span>
                          )}
                          <span className="notif-time">{timeAgo(n.createdAt)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Profil */}
        <div className="dd" ref={profileRef}>
          <button
            className="profile-btn clickable"
            onClick={() => setMenu((m) => (m === "profile" ? null : "profile"))}
            aria-label="Menu du profil"
          >
            <span className="avatar">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.username} />
              ) : (
                <User size={18} strokeWidth={2.2} />
              )}
            </span>
            <span className="profile-name">{user?.username}</span>
            <ChevronDown
              size={16}
              className={`profile-caret ${menu === "profile" ? "up" : ""}`}
            />
          </button>
          {menu === "profile" && (
            <div className="dd-menu card profile-menu">
              <div className="profile-head">
                <span className="avatar avatar-lg">
                  {user?.avatar ? (
                    <img src={user.avatar} alt={user.username} />
                  ) : (
                    <User size={20} strokeWidth={2.2} />
                  )}
                </span>
                <div className="profile-head-info">
                  <strong>{user?.username}</strong>
                  <span>{user?.email}</span>
                </div>
              </div>
              <div className="dd-sep" />
              <button
                className="dd-item clickable"
                onClick={() => {
                  setMenu(null);
                  navigate("/profile");
                }}
              >
                <User size={17} /> Mon profil
              </button>
              {user?.isAdmin && (
                <button
                  className="dd-item clickable"
                  onClick={() => {
                    setMenu(null);
                    navigate("/admin");
                  }}
                >
                  <Shield size={17} /> Administration
                </button>
              )}
              <button
                className="dd-item clickable"
                onClick={() => {
                  setMenu(null);
                  navigate("/settings");
                }}
              >
                <Settings size={17} /> Paramètres
              </button>
              <button
                className="dd-item danger clickable"
                onClick={() => {
                  setMenu(null);
                  logout();
                  navigate("/");
                }}
              >
                <LogOut size={17} /> Déconnexion
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
