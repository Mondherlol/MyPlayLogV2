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
  ChevronLeft,
  ChevronRight,
  Trash2,
  Repeat2,
  Film,
  BarChart3,
  Swords,
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
import ProfileTrackers from "../components/ProfileTrackers";
import ProfileAchievements from "../components/ProfileAchievements";
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
  "tracking",
  "achievements",
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
      ["q", "st", "fav", "rop", "rv", "pf", "fmt", "ptv", "ptop", "rel", "sort", "dir", "plat", "platm", "gen", "genm", "mod", "modm", "thm", "thmm"].forEach(
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
  // Drag-to-scroll (souris) + flèches (desktop) de la barre d'onglets, qui
  // déborde dès qu'il y a beaucoup d'onglets.
  const tabDrag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 });
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });
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
  // scroll : le dernier onglet ne force pas de défilement inutile. `loading` en
  // dépendance : la <nav> n'existe pas tant que le profil charge (early return),
  // donc l'effet doit se rejouer quand elle apparaît.
  useEffect(() => {
    const nav = tabsNavRef.current;
    const active = nav?.querySelector(".profile-tab.active");
    if (active) nav.scrollTo({ left: active.offsetLeft - 12, behavior: "smooth" });
    updateTabArrows();
  }, [tab, loading]);

  // Visibilité des flèches selon la position de scroll (masquées aux extrémités).
  const updateTabArrows = () => {
    const el = tabsNavRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setTabScroll((s) => (s.left === left && s.right === right ? s : { left, right }));
  };

  // Recalcule les flèches à chaque changement de taille (contenu, polices, resize
  // fenêtre) ET au scroll. Un ResizeObserver garantit une 1re mesure une fois la
  // barre réellement mise en page. `loading` en dépendance : la <nav> apparaît
  // seulement après le chargement du profil (early return).
  useEffect(() => {
    const el = tabsNavRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateTabArrows());
    ro.observe(el);
    const raf = requestAnimationFrame(updateTabArrows);
    el.addEventListener("scroll", updateTabArrows, { passive: true });
    window.addEventListener("resize", updateTabArrows);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", updateTabArrows);
      window.removeEventListener("resize", updateTabArrows);
    };
  }, [loading]);

  // Drag-to-scroll de la barre d'onglets (SOURIS uniquement — le tactile garde le
  // scroll natif via overflow-x). On écoute pointermove/up sur window pour suivre
  // le drag même quand le curseur passe sur un onglet ou sort de la barre. Pas de
  // pointer capture (elle retargette le `click` et casse le clic des onglets).
  // `el` est capturé au montage → `loading` en dépendance pour rejouer l'effet
  // quand la <nav> apparaît.
  useEffect(() => {
    const el = tabsNavRef.current;
    if (!el) return;
    const onMove = (e) => {
      if (!tabDrag.current.down) return;
      const dx = e.clientX - tabDrag.current.startX;
      if (Math.abs(dx) > 4) tabDrag.current.moved = true;
      el.scrollLeft = tabDrag.current.startScroll - dx;
    };
    const onUp = () => {
      if (!tabDrag.current.down) return;
      tabDrag.current.down = false;
      el.classList.remove("dragging");
      setTimeout(() => (tabDrag.current.moved = false), 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [loading]);

  function onTabsPointerDown(e) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = tabsNavRef.current;
    if (!el) return;
    tabDrag.current = {
      down: true,
      moved: false,
      startX: e.clientX,
      startScroll: el.scrollLeft,
    };
    el.classList.add("dragging");
  }
  // Après un drag, on annule le clic pour ne pas changer d'onglet par erreur.
  function onTabsClickCapture(e) {
    if (tabDrag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function scrollTabs(dir) {
    const el = tabsNavRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: "smooth" });
  }

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

  // ---------- Carrousel de couvertures (max 6 photos) ----------
  // Couvertures affichées : le tableau `covers`, sinon l'ancienne couverture
  // unique (profils d'avant le carrousel).
  const covers = useMemo(() => {
    if (profile?.covers?.length) return profile.covers.slice(0, 6);
    return profile?.cover
      ? [{ url: profile.cover, pos: profile.coverPos || null }]
      : [];
  }, [profile]);
  const [coverIdx, setCoverIdx] = useState(0);
  const [coverDragging, setCoverDragging] = useState(false);
  const [coverDx, setCoverDx] = useState(0);
  const [coverHover, setCoverHover] = useState(false);
  const coverRef = useRef(null);
  const coverDrag = useRef(null); // { startX, width, dx, active }

  // Si une image est supprimée, on ne reste pas sur un index hors limites.
  useEffect(() => {
    if (coverIdx >= covers.length) setCoverIdx(Math.max(0, covers.length - 1));
  }, [covers.length, coverIdx]);

  // Défilement automatique : slide suivante toutes les 6 s. En pause pendant un
  // drag, au survol (comme le bandeau) ou quand le menu Couverture est ouvert.
  useEffect(() => {
    if (covers.length < 2 || coverDragging || coverHover || coverMenu) return;
    const t = setInterval(
      () => setCoverIdx((i) => (i + 1) % covers.length),
      6000
    );
    return () => clearInterval(t);
  }, [covers.length, coverDragging, coverHover, coverMenu, coverIdx]);

  // Glisser au doigt / à la souris : on suit le pointeur, puis on passe à la
  // slide voisine si le geste dépasse ~15 % de la largeur (sinon on recolle).
  function coverPointerDown(e) {
    if (covers.length < 2) return;
    if (e.target.closest("button, a, input")) return;
    coverDrag.current = {
      startX: e.clientX,
      width: coverRef.current?.offsetWidth || 1,
      dx: 0,
      active: false,
    };
  }
  function coverPointerMove(e) {
    const d = coverDrag.current;
    if (!d) return;
    let dx = e.clientX - d.startX;
    if (!d.active) {
      if (Math.abs(dx) < 8) return; // clic simple : on ne bouge pas
      d.active = true;
      setCoverDragging(true);
      coverRef.current?.setPointerCapture?.(e.pointerId);
    }
    // Résistance élastique aux extrémités (pas de boucle en glissant).
    if ((coverIdx === 0 && dx > 0) || (coverIdx === covers.length - 1 && dx < 0))
      dx *= 0.35;
    d.dx = dx;
    setCoverDx(dx);
  }
  function coverPointerUp() {
    const d = coverDrag.current;
    coverDrag.current = null;
    if (!d?.active) return;
    setCoverDragging(false);
    setCoverDx(0);
    if (Math.abs(d.dx) > d.width * 0.15)
      setCoverIdx((i) =>
        Math.min(covers.length - 1, Math.max(0, i + (d.dx < 0 ? 1 : -1)))
      );
  }

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

  // Couvertures de MON profil (celui affiché peut être celui d'un autre joueur :
  // on peut définir sa couverture depuis le feed de quelqu'un d'autre).
  const myCovers = () => {
    if (isMe) return covers;
    if (user?.covers?.length) return user.covers.slice(0, 6);
    return user?.cover ? [{ url: user.cover, pos: user.coverPos || null }] : [];
  };

  // Persiste le tableau complet des couvertures de MON profil, puis synchronise
  // le contexte auth + le profil affiché (si c'est le mien).
  async function saveCovers(nextCovers) {
    const { user: u } = await apiFetch("/users/me", {
      method: "PUT",
      token,
      body: { covers: nextCovers },
    });
    updateUser({ cover: u.cover, coverPos: u.coverPos, covers: u.covers });
    if (isMe) {
      setData((d) => {
        const next = {
          ...d,
          profile: { ...d.profile, cover: u.cover, coverPos: u.coverPos, covers: u.covers },
        };
        profileCache.set(targetUsername, next);
        return next;
      });
    }
    return u;
  }

  // Ajoute une image au carrousel (ou met à jour son cadrage si déjà présente).
  async function applyCover(url, posStr = null) {
    const base = myCovers();
    if (base.some((c) => c.url === url)) {
      await saveCovers(base.map((c) => (c.url === url ? { ...c, pos: posStr } : c)));
      return;
    }
    if (base.length >= 6) {
      alert("Maximum 6 photos de couverture — supprime-en une d'abord.");
      return;
    }
    await saveCovers([...base, { url, pos: posStr }]);
  }

  async function pickCover(url) {
    // « Tout retirer » depuis la modale : on vide le carrousel.
    if (!url) {
      setPickingCover(false);
      try {
        await saveCovers([]);
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (myCovers().length >= 6 && !myCovers().some((c) => c.url === url)) {
      alert("Maximum 6 photos de couverture — supprime-en une d'abord.");
      return;
    }
    setPickingCover(false);
    setPendingCover(url);
    setReframing(true);
  }

  async function saveCoverPos(posStr) {
    try {
      if (pendingCover) {
        // Nouvelle image : on l'ajoute puis on affiche sa slide.
        await applyCover(pendingCover, posStr);
        const i = covers.findIndex((c) => c.url === pendingCover);
        setCoverIdx(i >= 0 ? i : Math.min(covers.length, 5));
      } else {
        // Recadrage de la slide actuellement affichée.
        await saveCovers(
          covers.map((c, i) => (i === coverIdx ? { ...c, pos: posStr } : c))
        );
      }
      setPendingCover(null);
      setReframing(false);
    } catch (err) {
      alert(err.message);
    }
  }

  // Supprime la photo actuellement affichée dans le carrousel.
  async function removeCover() {
    if (!covers.length) return;
    if (!confirm("Supprimer cette photo de couverture ?")) return;
    try {
      await saveCovers(covers.filter((_, i) => i !== coverIdx));
      setCoverIdx((i) => Math.max(0, i - 1));
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
          className={`pf-cover ${covers.length > 1 ? "multi" : ""} ${coverDragging ? "dragging" : ""}`}
          ref={coverRef}
          onPointerDown={coverPointerDown}
          onPointerMove={coverPointerMove}
          onPointerUp={coverPointerUp}
          onPointerCancel={coverPointerUp}
          onMouseEnter={() => setCoverHover(true)}
          onMouseLeave={() => setCoverHover(false)}
          // Un swipe sur le carrousel ne doit pas changer d'onglet (useTabSwipe
          // écoute sur la racine de la page).
          onTouchStart={(e) => covers.length > 1 && e.stopPropagation()}
        >
          {covers.length > 0 && (
            <div
              className="pf-cover-track"
              style={{
                transform: `translateX(calc(${-coverIdx * 100}% + ${coverDx}px))`,
                transition: coverDragging ? "none" : undefined,
              }}
            >
              {covers.map((cv, i) => (
                <div
                  key={`${cv.url}-${i}`}
                  className="pf-cover-slide"
                  style={{
                    backgroundImage: `url(${cv.url})`,
                    backgroundPosition: cv.pos || "center",
                  }}
                />
              ))}
            </div>
          )}
          <div className="pf-cover-scrim" />
          {covers.length > 1 && (
            <div className="pf-cover-dots">
              {covers.map((_, i) => (
                <button
                  key={i}
                  className={`pf-cover-dot clickable ${i === coverIdx ? "active" : ""}`}
                  onClick={() => setCoverIdx(i)}
                  aria-label={`Photo ${i + 1}`}
                />
              ))}
            </div>
          )}
          <Marquee facts={facts} />
        </div>

        {/* Menu Couverture : hors de .pf-cover (qui a overflow:hidden) pour que
            la pop-up ne soit pas coupée par les bords de la couverture. */}
        {isMe && (
          <div className={`pf-cover-menu ${coverMenu ? "open" : ""}`} ref={coverMenuRef}>
            <button
              className="pf-cover-edit clickable"
              onClick={() => setCoverMenu((v) => !v)}
            >
              <Camera size={15} /> Couverture
              {covers.length > 1 && (
                <span className="pf-cover-count">{covers.length}/6</span>
              )}
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
                  disabled={covers.length >= 6}
                >
                  <ImageIcon size={15} />
                  {covers.length ? `Ajouter une photo (${covers.length}/6)` : "Choisir une photo"}
                </button>
                <button
                  className="clickable"
                  onClick={() => {
                    setCoverMenu(false);
                    setReframing(true);
                  }}
                  disabled={!covers.length}
                >
                  <Move size={15} /> Recadrer celle-ci
                </button>
                <button
                  className="clickable"
                  onClick={() => {
                    setCoverMenu(false);
                    removeCover();
                  }}
                  disabled={!covers.length}
                >
                  <Trash2 size={15} /> Supprimer celle-ci
                </button>
              </div>
            )}
          </div>
        )}

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
              {isMe ? (
                <button
                  className="pf-edit-icon clickable"
                  onClick={() => setEditing(true)}
                  title="Modifier le profil"
                  aria-label="Modifier le profil"
                >
                  <Pencil size={15} />
                </button>
              ) : (
                <Presence lastSeenAt={profile.lastSeenAt} />
              )}
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

          {!isMe && (
            <div className="pf-actions">
              {!user ? (
                // Visiteur non connecté : suivre nécessite un compte.
                <Link to="/login" className="follow-btn clickable">
                  <UserPlus size={17} /> Suivre
                </Link>
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
          )}
        </div>
      </header>

      {/* ---------- Onglets ---------- */}
      {/* Ancre (hors flux sticky) pour recaler le scroll au changement d'onglet. */}
      <div ref={tabsTopRef} aria-hidden="true" />
      <div className="profile-tabs-wrap">
        <button
          className={`profile-tabs-arrow left clickable ${tabScroll.left ? "show" : ""}`}
          onClick={() => scrollTabs(-1)}
          aria-label="Onglets précédents"
          tabIndex={-1}
        >
          <ChevronLeft size={20} />
        </button>
        <nav
          className="profile-tabs"
          ref={tabsNavRef}
          onPointerDown={onTabsPointerDown}
          onClickCapture={onTabsClickCapture}
          onDragStart={(e) => e.preventDefault()}
        >
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
        {(isMe || c.trackers > 0) && (
          <button
            className={`profile-tab ${tab === "tracking" ? "active" : ""}`}
            onClick={() => setTab("tracking")}
          >
            <Swords size={16} /> Tracking
            {c.trackers > 0 && <span className="tab-count">{c.trackers}</span>}
          </button>
        )}
        <button
          className={`profile-tab ${tab === "achievements" ? "active" : ""}`}
          onClick={() => setTab("achievements")}
        >
          <Trophy size={16} /> Succès
          {c.achievements > 0 && <span className="tab-count">{c.achievements}</span>}
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
        <button
          className={`profile-tabs-arrow right clickable ${tabScroll.right ? "show" : ""}`}
          onClick={() => scrollTabs(1)}
          aria-label="Onglets suivants"
          tabIndex={-1}
        >
          <ChevronRight size={20} />
        </button>
      </div>

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

      {/* ---------- Tracking in-game (Marvel Rivals…) ---------- */}
      {tab === "tracking" && (
        <ProfileTrackers
          username={targetUsername}
          token={token}
          isMe={isMe}
          providers={profile.trackers}
        />
      )}

      {/* ---------- Succès ---------- */}
      {tab === "achievements" && (
        <ProfileAchievements username={targetUsername} token={token} isMe={isMe} />
      )}

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
          current={covers[coverIdx]?.url || null}
          count={covers.length}
          onPick={pickCover}
          onClose={() => setPickingCover(false)}
        />
      )}
      {reframing && (pendingCover || covers[coverIdx]) && (
        <ReframeCoverModal
          cover={pendingCover || covers[coverIdx].url}
          pos={pendingCover ? null : covers[coverIdx].pos}
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
