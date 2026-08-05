import { List, ListOrdered, LayoutGrid, Disc3 } from "lucide-react";

// Métadonnées des 4 types de listes (icône, libellés, description).
export const LIST_TYPES = {
  classic: {
    value: "classic",
    label: "Liste",
    long: "Liste classique",
    Icon: List,
    desc: "Un ensemble de jeux, sans ordre imposé.",
  },
  ranked: {
    value: "ranked",
    label: "Top",
    long: "Liste classée",
    Icon: ListOrdered,
    desc: "Un classement numéroté, du meilleur au moins bon.",
  },
  tier: {
    value: "tier",
    label: "Tier list",
    long: "Tier list",
    Icon: LayoutGrid,
    desc: "Range jeux et personnages par paliers (S, A, B…).",
  },
  playlist: {
    value: "playlist",
    label: "PlayList",
    long: "PlayList",
    Icon: Disc3,
    desc: "Une playlist d'OST à écouter, trier et partager.",
  },
};

export const typeMeta = (t) => LIST_TYPES[t] || LIST_TYPES.classic;

// Types proposés dans le sélecteur de type d'une liste EXISTANTE : une liste
// de jeux/persos ne peut pas devenir une playlist (contenus incompatibles).
export const GAME_LIST_TYPES = ["classic", "ranked", "tier"].map(
  (t) => LIST_TYPES[t]
);

// Options de tri de la page Listes (valeur = param `sort` du backend).
export const LIST_SORTS = [
  { value: "recent", label: "Dernière modif" },
  { value: "likes", label: "Popularité" },
];

// Options de filtre par type (null = tous).
export const LIST_TYPE_FILTERS = [
  { value: "", label: "Tous les types" },
  { value: "classic", label: "Classiques" },
  { value: "ranked", label: "Classées" },
  { value: "tier", label: "Tier lists" },
  { value: "playlist", label: "PlayLists" },
];

// Options de filtre par contenu (jeux / personnages / OST).
export const LIST_KIND_FILTERS = [
  { value: "", label: "Tout contenu" },
  { value: "game", label: "Jeux" },
  { value: "character", label: "Personnages" },
  { value: "ost", label: "OST" },
];

// Paliers par défaut (doit rester aligné avec le serveur).
export const DEFAULT_TIERS = [
  { id: "s", label: "S", color: "#ff5470" },
  { id: "a", label: "A", color: "#ff8b3d" },
  { id: "b", label: "B", color: "#f2b70b" },
  { id: "c", label: "C", color: "#3dd68c" },
  { id: "d", label: "D", color: "#4aa8ff" },
];

// "il y a 3 min", "il y a 2 j", etc. — format court FR.
export function timeAgo(date) {
  if (!date) return "";
  const d = new Date(date);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j < 7) return `il y a ${j} j`;
  const sem = Math.floor(j / 7);
  if (sem < 5) return `il y a ${sem} sem`;
  const mo = Math.floor(j / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.floor(j / 365)} an${j >= 730 ? "s" : ""}`;
}

let seq = 0;
// Id local unique pour un nouveau palier / élément côté client.
export const localId = (p = "id") => `${p}-${Date.now().toString(36)}-${seq++}`;

// "1 h 12 min" / "24 min" — durée d'écoute totale d'une playlist.
export function fmtDuration(sec) {
  if (!sec || sec <= 0) return "";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, "0")}` : `${h} h`;
}

// Durée totale d'une playlist côté client (mêmes règles que le serveur :
// durées iTunes connues + 4 min par piste inconnue, estimée dès qu'il en manque).
export function playlistDuration(items) {
  if (!items.length) return { durationSec: 0, durationEstimated: false };
  const known = items.filter((i) => i.durationSec > 0);
  return {
    durationSec:
      known.reduce((s, i) => s + i.durationSec, 0) +
      (items.length - known.length) * 240,
    durationEstimated: known.length < items.length,
  };
}

// Item de playlist (List.items, kind "track") → piste jouable par le
// PlayerContext (mini-lecteur global).
export const playlistItemToTrack = (it) => ({
  id: it.refId,
  videoId: it.videoId,
  url: it.url,
  name: it.name,
  artist: it.artist,
  artwork: it.image,
  gameId: it.gameId,
  gameName: it.gameName,
});
