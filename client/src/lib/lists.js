import { List, ListOrdered, LayoutGrid } from "lucide-react";

// Métadonnées des 3 types de listes (icône, libellés, description).
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
};

export const typeMeta = (t) => LIST_TYPES[t] || LIST_TYPES.classic;

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
