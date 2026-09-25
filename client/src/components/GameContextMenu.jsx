import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bookmark,
  Check,
  EyeOff,
  Gamepad,
  Heart,
  Image as ImageIcon,
  ListPlus,
  Pause,
  Play,
  SquareArrowOutUpRight,
  Trash2,
  X,
  Infinity as InfinityIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { writeCover } from "../lib/gameCover";
import { useAuth } from "../context/AuthContext";
import { useLibrary } from "../context/LibraryContext";
import PlayedModal from "./PlayedModal";
import AddToListModal from "./AddToListModal";
import GameCoverPicker from "./GameCoverPicker";

// ======================================================================
//  Le menu contextuel d'un jeu
// ======================================================================
// LE GESTE DE L'APPLI, AU NAVIGATEUR. Sur Android, garder le doigt sur une
// jaquette ouvre un menu : wishlist, suivi, coup de cœur, listes. Sur le
// site, il n'y avait rien — ranger un jeu voulait dire ouvrir sa fiche, ou
// viser le petit « + » qui n'existe que sur les cartes de l'Explorer. Le clic
// droit est LE geste que tout le monde essaie ; il tombait sur le menu de
// Chrome.
//
// ---------------------------------------------------- un seul écouteur
// ⚠️ ON NE BRANCHE RIEN SUR LES VIGNETTES. Le site affiche des jaquettes dans
// une centaine d'endroits (rails de l'accueil, grilles de profil, listes,
// classements, fil d'activité, résultats de quiz…) : passer un `onContextMenu`
// à chacun, c'était garantir que la moitié l'oublie et que le geste marche
// « parfois ». Un seul écouteur sur le document remonte l'arbre DOM depuis
// l'endroit cliqué et cherche ce qui désigne un jeu :
//
//   • un lien vers /game/<id> — ce que sont déjà la plupart des vignettes ;
//   • un `data-game-id` — pour celles qui naviguent au clic sans être un lien.
//
// Le nom et la jaquette se lisent dans la vignette elle-même (son `<img>`), et
// à défaut on les demande au serveur : le menu n'a pas besoin que l'appelant
// pense à quoi que ce soit.
//
// ---------------------------------------------------- le doigt compris
// Android envoie `contextmenu` sur un appui long, exactement comme la souris
// envoie le clic droit. Le même écouteur sert donc les deux gestes, et le menu
// du système ne s'affiche pas puisqu'on annule l'événement.

const GAME_PATH = /^\/game\/(\d+)/;

// Ce qu'on a déjà appris d'un jeu — nom, jaquette, date de sortie — pour ne
// pas le redemander à chaque clic droit. `full` marque les fiches qui viennent
// du serveur : la page, elle, ne sait jamais dire si un jeu est sorti.
const META = new Map();

// Le jeu désigné par l'endroit cliqué, en remontant l'arbre.
function gameFromNode(start) {
  let node = start instanceof Element ? start : null;
  while (node) {
    const el = node.closest("[data-game-id], a[href]");
    if (!el) return null;
    const id = idOf(el);
    if (id) return { id, el };
    // Un lien qui ne mène pas à un jeu (le pseudo d'un auteur sur une carte du
    // fil, par exemple) ne doit pas arrêter la recherche : la vignette qui
    // l'entoure, elle, en est peut-être une.
    node = el.parentElement;
  }
  return null;
}

function idOf(el) {
  const attr = el.dataset?.gameId;
  if (attr) return Number(attr) || null;
  const href = el.getAttribute?.("href");
  if (!href) return null;
  try {
    const m = GAME_PATH.exec(new URL(href, window.location.origin).pathname);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// Le nom et la jaquette, lus dans la vignette. L'`alt` d'une image de jaquette
// porte le nom du jeu presque partout sur le site, et l'infobulle (`title`) le
// porte là où l'image est décorative — c'est ce qui permet au menu de
// s'afficher complet dès l'ouverture, sans attendre le serveur.
function metaFromNode(el, id) {
  const img = el.querySelector?.("img");
  const name =
    el.dataset?.gameName ||
    (img?.alt || "").trim() ||
    (el.getAttribute?.("title") || "").trim() ||
    (el.getAttribute?.("aria-label") || "").trim() ||
    null;
  const cover = el.dataset?.gameCover || img?.currentSrc || img?.src || null;
  const known = META.get(id) || {};
  const meta = { id, name: name || known.name || null, cover: cover || known.cover || null };
  if (meta.name) META.set(id, meta);
  return meta;
}

export function GameMenuProvider({ children }) {
  const { token } = useAuth();
  const { map, upsertLocal } = useLibrary();
  const [menu, setMenu] = useState(null); // { x, y, game }
  const [sheet, setSheet] = useState(null); // { kind, game }
  const close = useCallback(() => setMenu(null), []);

  const openAt = useCallback((pt, game) => {
    setMenu({ x: pt.clientX, y: pt.clientY, game });
  }, []);

  useEffect(() => {
    function onContextMenu(e) {
      // Maj + clic droit rend la main au navigateur : c'est la convention
      // (Firefox la câble en dur), et c'est le seul moyen de récupérer
      // « Copier l'adresse du lien » ou « Inspecter » sur une jaquette.
      if (e.shiftKey || e.defaultPrevented) return;
      const hit = gameFromNode(e.target);
      if (!hit) return;
      e.preventDefault();
      // Une vignette dans un rayon de recommandations (`.reco-rail`) : le menu
      // y ajoute « Pas intéressé ».
      openAt(e, { ...metaFromNode(hit.el, hit.id), reco: !!hit.el.closest(".reco-rail") });
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, [openAt]);

  // ⚠️ LA PAGE NE SAIT PAS SI UN JEU EST SORTI. Aucune vignette ne porte sa
  // date, et c'est elle qui décide si « marquer comme joué » a un sens. On
  // demande donc la fiche minimale au premier clic droit sur un jeu — puis
  // plus jamais, le cache de module la garde pour la session. Elle complète du
  // même coup le nom et la jaquette des vignettes qui n'en portent pas.
  const pendingId = menu && !META.get(menu.game.id)?.full ? menu.game.id : null;
  useEffect(() => {
    if (!pendingId) return undefined;
    let alive = true;
    apiFetch(`/games/list-details?ids=${pendingId}`)
      .then((d) => {
        const g = d.games?.[0];
        if (!g) return;
        const known = META.get(pendingId) || {};
        const meta = {
          id: pendingId,
          // La jaquette VUE dans la page l'emporte : c'est celle que la
          // personne vient de désigner du doigt.
          name: known.name || g.name || null,
          cover: known.cover || g.cover || null,
          releaseDate: g.releaseDate ?? null,
          full: true,
        };
        META.set(pendingId, meta);
        if (alive)
          setMenu((m) =>
            m && m.game.id === pendingId ? { ...m, game: { ...meta, reco: m.game.reco } } : m
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pendingId]);

  const openSheet = useCallback((kind, game) => {
    setMenu(null);
    setSheet({ kind, game });
  }, []);

  // La jaquette choisie : retenue sur cet appareil, et poussée dans l'entrée
  // de bibliothèque quand le jeu y est — c'est CELLE-LÀ que montrent les
  // grilles d'un profil, ici comme sur le téléphone. Sans ce second geste, la
  // nouvelle jaquette n'aurait changé que sur la fiche.
  const pickCover = useCallback(
    async (game, url) => {
      writeCover(game.id, url);
      const known = META.get(game.id);
      if (known) META.set(game.id, { ...known, cover: url });
      if (!token || !map[game.id]) return;
      try {
        await apiFetch(`/library/${game.id}`, {
          method: "PUT",
          token,
          // ⚠️ LE NOM SEULEMENT SI ON LE CONNAÎT : `name: null` l'effacerait
          // sur une entrée qui existe déjà.
          body: { cover: url, ...(game.name ? { name: game.name } : {}) },
        });
        upsertLocal(game.id, { cover: url });
      } catch (err) {
        alert(err.message);
      }
    },
    [map, token, upsertLocal]
  );

  return (
    <>
      {children}

      {menu && <Menu menu={menu} onClose={close} onSheet={openSheet} />}

      {/* Les feuilles vivent ICI, pas dans le menu : le menu se referme au
          moment où l'une s'ouvre, et une modale démontée avec son parent ne
          s'afficherait jamais. */}
      {sheet?.kind === "played" && (
        <PlayedModal game={sheet.game} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === "list" && (
        <AddToListModal game={sheet.game} onClose={() => setSheet(null)} />
      )}
      {/* La jaquette d'un jeu, changée depuis n'importe quelle vignette — le
          même choix que sur sa fiche (où l'on clique la jaquette), et le même
          rangement : retenue sur cet appareil, et poussée dans la
          bibliothèque quand le jeu y est (cf. lib/gameCover). */}
      {sheet?.kind === "cover" && (
        <GameCoverPicker
          gameId={sheet.game.id}
          token={token}
          currentCover={sheet.game.cover}
          onPick={(url) => pickCover(sheet.game, url)}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

// Le libellé et l'icône du suivi, comme sur la carte d'un jeu et sur sa fiche.
const STATUS_META = {
  playing: { label: "Modifier mon suivi : en cours", Icon: Play },
  finished: { label: "Modifier mon suivi : terminé", Icon: Check },
  paused: { label: "Modifier mon suivi : en pause", Icon: Pause },
  dropped: { label: "Modifier mon suivi : abandonné", Icon: X },
  endless: { label: "Modifier mon suivi : sans fin", Icon: InfinityIcon },
};
const PLAYED = Object.keys(STATUS_META);

function Menu({ menu, onClose, onSheet }) {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { map, upsertLocal, removeLocal } = useLibrary();
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y, ready: false });
  const [busy, setBusy] = useState(false);

  const game = menu.game;
  const entry = map[game.id];
  const wished = entry?.status === "wishlist";
  const played = entry && PLAYED.includes(entry.status);
  const favorite = !!entry?.favorite;
  // ⚠️ PAS DE « MARQUER COMME JOUÉ » SUR UN JEU QUI N'EST PAS SORTI. On ne
  // peut pas avoir joué à ce qui n'existe pas encore, et la ligne ouvrait une
  // feuille de suivi qui demandait une note et une date de fin. Tant qu'on ne
  // connaît pas la date (la fiche minimale arrive), on la laisse : la cacher
  // puis la remettre serait pire que de l'afficher.
  const unreleased = game.releaseDate != null && game.releaseDate * 1000 > Date.now();
  const url = `/game/${game.id}`;

  // ⚠️ ON MESURE AVANT DE PLACER. Un menu posé au pixel du curseur déborde dès
  // qu'on clique droit en bas de l'écran — et ce qui dépasse (« retirer de mes
  // jeux ») est justement ce qu'on ne peut plus atteindre. On le pose donc une
  // fois sa taille connue : il bascule au-dessus du curseur s'il le faut.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const M = 8;
    const x = Math.max(M, Math.min(menu.x, window.innerWidth - box.width - M));
    const y =
      menu.y + box.height + M > window.innerHeight
        ? Math.max(M, menu.y - box.height)
        : menu.y;
    setPos({ x, y, ready: true });
  }, [menu.x, menu.y, game.id]);

  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    // Un menu ancré à un point ne peut pas suivre la page : on le referme
    // plutôt que de le laisser flotter loin de la jaquette dont il parle.
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    // Le clic fantôme de l'appui long : au doigt, le relâchement qui suit le
    // menu déclenche encore le lien de la vignette. Sans ce garde, ouvrir le
    // menu au doigt ouvrait la fiche dans la foulée.
    const swallow = (e) => {
      if (ref.current?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("click", swallow, true);
    const t = setTimeout(() => window.removeEventListener("click", swallow, true), 700);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("click", swallow, true);
    };
  }, [onClose]);

  function requireLogin() {
    if (user) return true;
    onClose();
    navigate("/login");
    return false;
  }

  // Toutes les écritures passent par là : le suivi du jeu est fusionné côté
  // serveur, donc un PUT partiel ne perd ni le statut ni la note.
  //
  // ⚠️ LE NOM PART AVEC. Une entrée de bibliothèque CRÉÉE sans nom est refusée
  // par le serveur — et l'envoyer à `null` l'enregistrerait sans titre, ce qui
  // donne un trou dans la grille au prochain chargement. Tant qu'on ne le
  // connaît pas (le temps que la fiche minimale revienne), les lignes qui
  // écrivent sont désactivées : cf. `ready` plus bas.
  async function put(patch, mapPatch) {
    if (busy || !game.name || !requireLogin()) return;
    setBusy(true);
    try {
      await apiFetch(`/library/${game.id}`, {
        method: "PUT",
        token,
        body: { ...patch, name: game.name, cover: game.cover || undefined },
      });
      upsertLocal(game.id, mapPatch || patch);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(silent = false) {
    if (busy || !requireLogin()) return;
    if (
      !silent &&
      !window.confirm(
        "Retirer ce jeu de mes jeux ? Ta note, ton avis et ton suivi seront supprimés."
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/library/${game.id}`, { method: "DELETE", token });
      removeLocal(game.id);
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  // « Pas intéressé » : le moteur ne le proposera plus (même liste que le swipe
  // gauche des pépites), et les rayons de la page le retirent tout de suite.
  async function dismiss() {
    if (busy || !requireLogin()) return;
    setBusy(true);
    try {
      await apiFetch(`/reco/dismiss/${game.id}`, { method: "POST", token });
      window.dispatchEvent(new CustomEvent("mpl:reco-dismiss", { detail: game.id }));
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleWish() {
    // Retirer de la wishlist, c'est retirer l'entrée : elle ne porte rien
    // d'autre qu'une intention, il n'y a pas de note à protéger d'où la
    // suppression sans confirmation.
    if (wished) return remove(true);
    put({ status: "wishlist" }, { status: "wishlist" });
  }

  const statusMeta = played ? STATUS_META[entry.status] : null;
  // Le nom est connu : tout ce qui touche à la bibliothèque peut partir.
  const ready = !!game.name;

  const items = [
    // Pas de « ouvrir la fiche » : c'est ce que fait déjà le clic gauche, et
    // une ligne de menu pour redire le geste qu'on vient de ne pas faire ne
    // sert qu'à éloigner les autres.
    {
      key: "tab",
      Icon: SquareArrowOutUpRight,
      label: "Ouvrir dans un nouvel onglet",
      onClick: () => window.open(url, "_blank", "noopener"),
    },
    { sep: true, key: "s1" },
    // La wishlist ne se propose qu'avant d'y avoir joué : ranger dans « à
    // jouer » un jeu qu'on a terminé n'a aucun sens.
    !played && {
      key: "wish",
      Icon: Bookmark,
      label: wished ? "Retirer de la wishlist" : "Ajouter à ma wishlist",
      on: wished,
      off: !ready,
      onClick: toggleWish,
    },
    !unreleased && {
      key: "played",
      Icon: statusMeta ? statusMeta.Icon : Gamepad,
      label: statusMeta ? statusMeta.label : "Marquer comme joué",
      off: !ready,
      onClick: () => requireLogin() && onSheet("played", game),
    },
    // Le coup de cœur suppose d'y avoir joué : c'est ce que veut dire le cœur
    // sur une jaquette, et le proposer sur un jeu jamais lancé le viderait.
    played && {
      key: "fav",
      Icon: Heart,
      label: favorite ? "Retirer des coups de cœur" : "Ajouter aux coups de cœur",
      like: favorite,
      off: !ready,
      onClick: () => put({ favorite: !favorite }, { favorite: !favorite }),
    },
    {
      key: "list",
      Icon: ListPlus,
      label: "Ajouter à une liste",
      off: !ready,
      onClick: () => requireLogin() && onSheet("list", game),
    },
    { sep: true, key: "s2" },
    // La jaquette : le même choix que sur la fiche du jeu (où on la change en
    // cliquant dessus), mais sans avoir à y aller.
    {
      key: "cover",
      Icon: ImageIcon,
      label: "Changer la jaquette",
      onClick: () => onSheet("cover", game),
    },
    // Sur une recommandation seulement : ailleurs, « pas intéressé » ne
    // voudrait rien dire (le jeu n'a été proposé par personne).
    game.reco && !entry && { sep: true, key: "s-reco" },
    game.reco &&
      !entry && {
        key: "dismiss",
        Icon: EyeOff,
        label: "Pas intéressé",
        onClick: dismiss,
      },
    !!entry && { sep: true, key: "s3" },
    !!entry && {
      key: "remove",
      Icon: Trash2,
      label: "Retirer de mes jeux",
      danger: true,
      onClick: () => remove(),
    },
  ].filter(Boolean);

  return createPortal(
    <div
      ref={ref}
      className="gmenu"
      role="menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.ready ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="gmenu-head">
        {game.cover && <img src={game.cover} alt="" />}
        <b>{game.name || "Ce jeu"}</b>
      </span>

      {items.map((it) =>
        it.sep ? (
          <hr className="gmenu-sep" key={it.key} />
        ) : (
          <button
            type="button"
            role="menuitem"
            key={it.key}
            className={`gmenu-item clickable ${it.danger ? "danger" : ""} ${it.on ? "on" : ""} ${
              it.like ? "like" : ""
            }`}
            disabled={busy || it.off}
            onClick={it.onClick}
          >
            <it.Icon
              size={15}
              fill={it.on || it.like ? "currentColor" : "none"}
              strokeWidth={2}
            />
            {it.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
