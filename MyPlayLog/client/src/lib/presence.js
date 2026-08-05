import { useEffect, useRef } from "react";
import { timeAgo } from "./lists";
import { apiFetch } from "./api";

// Libellé de présence d'un interlocuteur (en-tête d'une discussion à deux).
//
// Ordre de priorité : ce qu'il FAIT > en ligne > vu il y a X > hors ligne.
// Un « Joue au Mot du jour · 39° » remplace le « en ligne » plutôt que de s'y
// ajouter : les deux disent la même chose, mais le premier donne envie d'aller
// voir. Le statut vient du serveur (lib/liveStatus.js) et n'existe que tant que
// la personne a la page ouverte.
export function presenceText(other, online, statuses) {
  if (!other) return "";
  const st = statuses?.[String(other.id)] ?? other.status;
  if (st?.label) return st.detail ? `${st.label} · ${st.detail}` : st.label;
  if (online?.has?.(String(other.id))) return "en ligne";
  if (other.lastSeenAt) return `vu ${timeAgo(other.lastSeenAt)}`;
  return "hors ligne";
}

// Vrai si l'interlocuteur est en train de jouer : la messagerie s'en sert pour
// colorer le sous-titre (un statut d'activité n'a pas le ton d'un « hors ligne »).
export function isPlaying(other, statuses) {
  return Boolean(statuses?.[String(other?.id)] ?? other?.status);
}

// ----------------------------------------------------------------------
//  Annoncer ce qu'on est en train de faire
// ----------------------------------------------------------------------
// Une ligne à poser dans une page de jeu :
//
//     useLiveStatus("mot", best ? `${best.temp}°` : "");
//
// C'est la PAGE qui annonce, pas les routes de jeu : entre le /start et le
// /finish d'une partie de Pixel Rush le serveur ne reçoit aucun appel, une
// partie entière passerait inaperçue. Et seule la page peut formuler le détail
// juste (« 39° », « manche 3/5 »).
//
// Le hook se charge de tout : annonce à l'arrivée, mise à jour quand le détail
// change, battement pour rester en vie, et extinction en quittant la page.
const BEAT_MS = 45_000;

export function useLiveStatus(kind, detail = "", { token, active = true } = {}) {
  // Refs plutôt que dépendances : le détail change à chaque essai, on ne veut
  // pas relancer l'effet (donc le battement) à chaque fois.
  const detailRef = useRef(detail);
  const sentRef = useRef(null);
  detailRef.current = detail;

  useEffect(() => {
    if (!token || !kind || !active) return undefined;

    const push = () => {
      const body = { kind, detail: detailRef.current || "" };
      sentRef.current = body.detail;
      apiFetch("/presence", { method: "POST", token, body }).catch(() => {});
    };

    push();
    const beat = setInterval(push, BEAT_MS);

    // Le détail bouge plus vite que le battement : on le surveille de près,
    // mais on n'envoie que s'il a réellement changé.
    const watch = setInterval(() => {
      if ((detailRef.current || "") !== sentRef.current) push();
    }, 3000);

    return () => {
      clearInterval(beat);
      clearInterval(watch);
      // On s'éteint en partant. `keepalive` pour que la requête survive à la
      // navigation qui la déclenche.
      apiFetch("/presence", {
        method: "POST",
        token,
        body: { kind: null },
        keepalive: true,
      }).catch(() => {});
    };
  }, [token, kind, active]);
}
