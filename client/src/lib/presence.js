import { timeAgo } from "./lists";

// Libellé de présence d'un interlocuteur (en-tête d'une discussion à deux).
// En ligne → « en ligne » ; sinon « vu <il y a X> » si on connaît son dernier
// passage, à défaut « hors ligne ».
export function presenceText(other, online) {
  if (!other) return "";
  if (online?.has?.(String(other.id))) return "en ligne";
  if (other.lastSeenAt) return `vu ${timeAgo(other.lastSeenAt)}`;
  return "hors ligne";
}
