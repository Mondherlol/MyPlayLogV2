import { useEffect, useRef, useSyncExternalStore } from "react";
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

// CE QU'ON A DÉJÀ ANNONCÉ, en une chaîne. Une fonction plutôt que deux gabarits
// recopiés : les deux endroits qui la calculent DOIVENT produire exactement la
// même chose, sinon on se croit périmé à chaque tour et l'on réenvoie son statut
// toutes les trois secondes pour rien. Le séparateur est explicite pour la même
// raison — un caractère invisible entre les deux, et la comparaison ment sans
// que rien ne le montre (c'est arrivé : un octet nul y avait été écrit).
const signature = (detail, path) => `${detail || ""}||${path || ""}`;

// `path` est le lien de rejointe montré dans le rail « en ce moment » de
// l'onglet Activité (« Rejoindre »). On ne le déduit PAS de l'URL courante, et
// c'est délibéré : un salon privé a une adresse secrète (le code EST
// l'invitation), et la déduire reviendrait à publier ce code à tous ses
// abonnés. Une page qui veut être rejointe le dit ; les autres se taisent.
// ----------------------------------------------------------------------
//  Deux annonceurs, un seul statut : qui parle en premier
// ----------------------------------------------------------------------
// LE MINI-LECTEUR ANNONCE LUI AUSSI (« Écoute · Aerith's Theme »), et il est
// monté en permanence — pas le temps d'une page, mais tout le temps qu'on
// écoute, où qu'on aille. Il est donc en concurrence permanente avec la page
// sous les yeux, et le serveur ne garde qu'un statut par personne : sans règle,
// les deux se réécrivent l'un l'autre toutes les trois secondes et le libellé
// clignote entre « Joue au Mot du jour » et « Écoute ».
//
// LA RÈGLE : une PAGE prime sur le lecteur. « Il joue à ça » vaut toujours mieux
// que « il écoute quelque chose » — la musique est un fond, pas une activité, et
// c'est la partie en cours qu'on veut rejoindre. Le lecteur s'annonce donc en
// FAIBLE (`weak`) : il se tait tant qu'une page parle, et reprend la parole
// quand elle se ferme.
const strong = new Set(); // les activités annoncées par une page, en cours
const watchers = new Set();

function markStrong(kind, on) {
  if (on) strong.add(kind);
  else strong.delete(kind);
  for (const w of [...watchers]) w();
}

const subscribeStrong = (fn) => {
  watchers.add(fn);
  return () => watchers.delete(fn);
};

// Vrai si une page annonce déjà quelque chose. `useSyncExternalStore` plutôt
// qu'un état maison : il rend un booléen stable, donc aucun rendu inutile.
export const usePageIsAnnouncing = () =>
  useSyncExternalStore(
    subscribeStrong,
    () => strong.size > 0,
    () => false
  );

export function useLiveStatus(
  kind,
  detail = "",
  { token, active = true, path = "", weak = false } = {}
) {
  // Un annonceur faible se tait tant qu'une page parle (voir plus haut).
  const pageSpeaking = usePageIsAnnouncing();
  const allowed = active && (!weak || !pageSpeaking);

  // Les annonceurs forts se déclarent : c'est ce que lisent les faibles.
  // Déclaré dans son propre effet, AVANT celui qui envoie : au changement de
  // page, le faible doit apprendre qu'il doit se taire avant que le fort ne
  // pousse son statut, sinon il le recouvre une dernière fois.
  useEffect(() => {
    if (weak || !kind || !allowed) return undefined;
    markStrong(kind, true);
    return () => markStrong(kind, false);
  }, [weak, kind, allowed]);

  // Refs plutôt que dépendances : le détail change à chaque essai, on ne veut
  // pas relancer l'effet (donc le battement) à chaque fois.
  const detailRef = useRef(detail);
  const pathRef = useRef(path);
  const sentRef = useRef(null);
  detailRef.current = detail;
  pathRef.current = path;

  useEffect(() => {
    if (!token || !kind || !allowed) return undefined;

    const push = () => {
      const body = {
        kind,
        detail: detailRef.current || "",
        path: pathRef.current || "",
      };
      // ON RETIENT CE QU'ON A ENVOYÉ, LE LIEN COMPRIS. À ne surveiller que le
      // détail, un lien qui change en cours de route (la console qui se met à
      // DIFFUSER : le « Rejoindre » de ses amis doit passer de la fiche du jeu à
      // la diffusion) attendait le battement suivant — jusqu'à 45 secondes
      // pendant lesquelles le bouton menait au mauvais endroit.
      sentRef.current = signature(body.detail, body.path);
      apiFetch("/presence", { method: "POST", token, body }).catch(() => {});
    };

    push();
    const beat = setInterval(push, BEAT_MS);

    // Le détail bouge plus vite que le battement : on le surveille de près,
    // mais on n'envoie que s'il a réellement changé.
    const watch = setInterval(() => {
      const now = signature(detailRef.current, pathRef.current);
      if (now !== sentRef.current) push();
    }, 3000);

    return () => {
      clearInterval(beat);
      clearInterval(watch);
      // On s'éteint en partant. `keepalive` pour que la requête survive à la
      // navigation qui la déclenche.
      //
      // `was` DIT CE QU'ON ÉTEINT, et ce n'est pas une politesse : deux
      // annonceurs coexistent (la page et le mini-lecteur), leurs requêtes se
      // croisent, et une extinction en retard effacerait le statut que l'autre
      // vient de poser. Le serveur ne l'applique donc que si le statut affiché
      // est bien celui-ci (voir lib/liveStatus.js).
      apiFetch("/presence", {
        method: "POST",
        token,
        body: { kind: null, was: kind },
        keepalive: true,
      }).catch(() => {});
    };
  }, [token, kind, allowed]);
}
