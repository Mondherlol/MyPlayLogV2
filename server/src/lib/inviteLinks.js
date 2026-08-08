import BlindTestVersus, { MAX_PLAYERS as BT_MAX } from "../models/BlindTestVersus.js";
import GeoVersus, { MAX_PLAYERS as GEO_MAX } from "../models/GeoVersus.js";
import MotSession from "../models/MotSession.js";
import MotTeam from "../models/MotTeam.js";
import WatchParty from "../models/WatchParty.js";
import User from "../models/User.js";
import { activePlayers } from "./versusRoom.js";

// ======================================================================
//  Un lien collé dans une conversation devient l'invitation qu'il désigne
// ======================================================================
// LE GESTE NATUREL N'ÉTAIT PAS CELUI QU'ON AVAIT PRÉVU. Les modales « Inviter »
// existent (VersusInvite, celle du mot du jour, celle de la watchparty), mais
// dans la vraie vie on copie le lien du salon et on le colle dans le groupe —
// c'est plus rapide que de cocher cinq noms, et ça marche même pour qui n'est
// pas encore abonné. Le groupe recevait alors une URL nue : personne ne voit
// combien de places restent, ni si la partie a déjà commencé, et il faut
// changer d'onglet pour le savoir.
//
// On rattrape donc le lien à l'envoi et on l'échange contre la MÊME carte que
// le bouton « Inviter » aurait déposée — vivante, avec les têtes des joueurs et
// une porte qui ne s'ouvre que si le salon accepte encore du monde
// (cf. VersusCard dans client/src/components/ChatThread.jsx).
//
// TROIS RÈGLES, et elles comptent :
//   1. On ne fabrique une carte QUE si le salon existe encore et qu'il est
//      rejoignable. Un lien mort reste un lien mort : mentir avec une belle
//      carte serait pire que de ne rien faire.
//   2. L'URL DISPARAÎT DU TEXTE, comme si le bouton « Inviter » avait servi.
//      La carte porte déjà le bouton qui mène au même endroit ; laisser l'URL
//      dessous ferait doublon et trahirait la mécanique. Ce que la personne a
//      écrit AUTOUR du lien (« venez, il reste une place ! ») est conservé.
//   3. On ne vérifie PAS que l'expéditeur est dans le salon. Il a le lien ;
//      quiconque a le lien peut déjà entrer et le transmettre. Exiger d'être
//      membre n'ajouterait aucune sécurité, seulement une surprise.
//
// Une seule carte par message : c'est le premier lien reconnu qui gagne.

// Les chemins qu'on sait reconnaître, dans l'ordre où on les essaie. Le domaine
// est ignoré volontairement (myplaylog.cc, localhost, une IP de test…) : ce qui
// identifie une invitation, c'est le chemin et le code.
const PATTERNS = [
  { kind: "blindtest", re: /\/blindtest\/versus\/([a-z0-9]{4,12})\b/i },
  { kind: "geo", re: /\/geo\/versus\/([a-z0-9]{4,12})\b/i },
  { kind: "party", re: /\/watchparty\/([a-z0-9]{4,16})\b/i },
  // Le mot du jour se partage par SESSION (?s=) ou par ÉQUIPE (?t=) — la
  // seconde ne périme jamais (cf. MotCard côté client).
  { kind: "motSession", re: /\/mot\?(?:[^\s]*&)?s=([a-z0-9]{4,16})\b/i },
  { kind: "motTeam", re: /\/mot\?(?:[^\s]*&)?t=([a-z0-9]{4,16})\b/i },
];

const nameOf = async (userId) => {
  const u = await User.findById(userId).select("username").lean();
  return u?.username || "";
};

// Un salon de versus (blind test ou GeoGamer) : on n'invite que sur un salon
// qui n'a pas encore démarré — c'est exactement la condition que POST
// /:code/invite s'impose, et celle que le serveur appliquera au join.
async function versusCard(Model, kind, code, max, fromId) {
  const room = await Model.findOne({ code: String(code).toLowerCase() }).lean();
  if (!room || room.startedAt || room.endedAt) return null;
  const card = {
    kind,
    code: room.code,
    hostName: await nameOf(fromId),
    players: activePlayers(room).length,
    maxPlayers: max,
    rounds: room.roundCount,
  };
  if (kind === "geo") card.mode = room.mode;
  return { versus: card };
}

async function partyCard(code, fromId, origin) {
  const party = await WatchParty.findOne({
    code: String(code).toLowerCase(),
    endedAt: null,
  }).lean();
  if (!party) return null;
  const poster = party.content?.poster || null;
  return {
    party: {
      code: party.code,
      title: party.content?.title || "Watchparty",
      subtitle: party.content?.subtitle || "",
      poster: poster?.startsWith("/uploads/") ? `${origin}${poster}` : poster,
      hostName: await nameOf(fromId),
    },
  };
}

async function motSessionCard(code, fromId) {
  const s = await MotSession.findOne({ code: String(code).toLowerCase() }).lean();
  if (!s) return null;
  // `session.team` est une RÉFÉRENCE (ObjectId), pas un code : c'est le code de
  // l'équipe qui part dans la carte, puisque c'est lui qui ouvre `/mot?t=…`.
  const team = s.team ? await MotTeam.findById(s.team).select("code name").lean() : null;
  return {
    mot: {
      code: s.code,
      date: s.date,
      hostName: await nameOf(fromId),
      players: (s.members || []).filter((m) => !m.leftAt).length,
      tries: s.tries || 0,
      team: team?.code || "",
      teamName: team?.name || "",
    },
  };
}

// Le lien d'ÉQUIPE ne porte pas de partie : il ouvre celle du jour, quel que
// soit le jour. La carte n'annonce donc ni essais ni joueurs — elle n'aurait
// aucun moyen honnête de les connaître avant que la partie du jour n'existe.
async function motTeamCard(code, fromId) {
  const team = await MotTeam.findOne({ code: String(code).toLowerCase() }).lean();
  if (!team) return null;
  return {
    mot: {
      code: "",
      date: "",
      hostName: await nameOf(fromId),
      team: team.code,
      teamName: team.name || "",
    },
  };
}

// Retire du texte le MOT ENTIER qui contenait le lien (l'URL complète, protocole
// et paramètres compris) : le motif, lui, ne reconnaît qu'un bout de chemin.
function stripLink(text, at) {
  let start = at;
  let end = at;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return `${text.slice(0, start)}${text.slice(end)}`.replace(/\s+/g, " ").trim();
}

// Renvoie `{ card, text }` — la carte à fusionner dans le message et le texte
// débarrassé du lien — ou `null` si le texte ne contient aucune invitation
// vivante. N'ÉCHOUE JAMAIS : un envoi de message ne doit pas tomber parce
// qu'une base tousse sur une jolie carte en bonus.
export async function cardFromLinks(text, fromId, origin = "") {
  if (!text || !text.includes("/")) return null;
  try {
    for (const { kind, re } of PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const code = m[1];
      let card = null;
      if (kind === "blindtest")
        card = await versusCard(BlindTestVersus, "blindtest", code, BT_MAX, fromId);
      else if (kind === "geo") card = await versusCard(GeoVersus, "geo", code, GEO_MAX, fromId);
      else if (kind === "party") card = await partyCard(code, fromId, origin);
      else if (kind === "motSession") card = await motSessionCard(code, fromId);
      else if (kind === "motTeam") card = await motTeamCard(code, fromId);
      // Salon mort : on laisse le message tel quel plutôt que d'en amputer le
      // lien — c'est encore la seule chose qui reste à cliquer.
      if (!card) return null;
      return { card, text: stripLink(text, m.index) };
    }
  } catch (err) {
    console.error("inviteLinks:", err.message);
  }
  return null;
}
