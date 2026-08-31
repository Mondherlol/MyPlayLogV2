// Notifications push mobiles, via le service d'Expo.
//
// Pas de SDK : l'API d'Expo est un simple POST JSON, et une dépendance de plus
// pour construire un objet ne se justifie pas. Le service accepte 100 messages
// par requête, d'où le découpage.
//
// Le jeton de chaque appareil est enregistré par l'app (POST /users/me/push-token).
// Un jeton peut mourir (app désinstallée, réinstallée) : Expo le signale avec
// `DeviceNotRegistered`, et on le retire alors de l'utilisateur — sinon la liste
// grossit indéfiniment et chaque envoi traîne des adresses mortes.

import User from "../models/User.js";

const ENDPOINT = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

// Un jeton Expo a toujours cette forme. On filtre en amont : envoyer une chaîne
// quelconque fait échouer TOUT le lot, pas seulement la ligne fautive.
const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function isExpoPushToken(token) {
  return typeof token === "string" && TOKEN_RE.test(token.trim());
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Envoie une notification aux appareils d'une liste d'utilisateurs, et rend
 * compte du résultat appareil par appareil.
 *
 * C'est la version détaillée : elle sert au panel admin, qui doit pouvoir dire
 * « 42 appareils touchés, 3 refusés » plutôt qu'un simple nombre. Les appels
 * courants (une notification d'activité) passent par `pushToUsers` juste en
 * dessous, qui n'en garde que le compte.
 *
 * @param {string[]} userIds   destinataires
 * @param {object}   payload   { title, body, data, channelId }
 * @returns {Promise<{devices:number, accepted:number, failed:number, removed:number, errors:object[]}>}
 */
export async function sendPush(
  userIds,
  { title, body, data = {}, channelId = "messages", silent = false, categoryId } = {}
) {
  const empty = { devices: 0, accepted: 0, failed: 0, removed: 0, errors: [] };
  const ids = [...new Set((userIds || []).map(String))].filter(Boolean);
  if (!ids.length) return empty;

  const users = await User.find({ _id: { $in: ids }, "pushTokens.0": { $exists: true } })
    .select("pushTokens")
    .lean();

  // On garde le lien jeton -> utilisateur : sans lui, impossible de savoir chez
  // qui retirer un jeton refusé par Expo.
  const owners = new Map();
  const messages = [];
  for (const u of users) {
    for (const t of u.pushTokens || []) {
      if (!isExpoPushToken(t.token)) continue;
      owners.set(t.token, String(u._id));
      messages.push({
        to: t.token,
        // ⚠️ `silent` : un message SANS titre ni corps. Android le remet alors
        // à l'application au lieu de l'afficher lui-même — c'est la seule
        // façon de réveiller du code quand l'app est fermée, et donc de faire
        // sonner un appel entrant comme un vrai téléphone (cf. la tâche de
        // fond de l'app mobile). Une notification ordinaire, elle, resterait
        // sagement dans la barre d'état à attendre qu'on la touche.
        ...(silent ? {} : { title, body, sound: "default" }),
        data,
        channelId,
        // Les boutons de la notification (« Répondre »/« Refuser » d'un
        // appel) : c'est le client qui les décrit, on ne fait que désigner
        // laquelle de ses catégories s'applique.
        ...(categoryId ? { categoryId } : {}),
        priority: "high",
        // iOS : réveille l'app en arrière-plan. Sans effet sur Android, sans
        // danger non plus.
        _contentAvailable: silent || undefined,
      });
    }
  }
  if (!messages.length) return empty;

  let accepted = 0;
  const dead = [];
  // Motifs de refus regroupés (« DeviceNotRegistered × 3 ») : une liste de
  // tickets bruts n'apprendrait rien à qui lit le panel admin.
  const errors = new Map();
  const noteError = (reason) => errors.set(reason, (errors.get(reason) || 0) + 1);

  for (const batch of chunk(messages, CHUNK)) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(batch),
      });
      const json = await res.json().catch(() => null);

      // Erreur globale du lot (jeton d'API invalide, credentials FCM absentes) :
      // Expo répond `errors` au lieu de `data`, et aucun ticket n'existe.
      if (!json?.data && json?.errors?.length) {
        noteError(json.errors[0]?.message || "Requête refusée par Expo");
        continue;
      }

      const tickets = json?.data || [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === "ok") {
          accepted += 1;
          return;
        }
        noteError(ticket?.details?.error || ticket?.message || "Erreur inconnue");
        if (ticket?.details?.error === "DeviceNotRegistered") {
          dead.push(batch[i].to);
        }
      });
    } catch (err) {
      // Une notification perdue n'est pas un message perdu : le message est
      // déjà en base et arrivera à l'ouverture de l'app. On ne remonte pas.
      console.error("push send error:", err.message);
      noteError(err.message || "Réseau injoignable");
    }
  }

  // Ménage des jetons morts, chez leur propriétaire respectif.
  if (dead.length) {
    const byUser = new Map();
    for (const token of dead) {
      const uid = owners.get(token);
      if (!uid) continue;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(token);
    }
    await Promise.all(
      [...byUser.entries()].map(([uid, tokens]) =>
        User.updateOne({ _id: uid }, { $pull: { pushTokens: { token: { $in: tokens } } } })
      )
    );
  }

  return {
    devices: messages.length,
    accepted,
    failed: messages.length - accepted,
    removed: dead.length,
    errors: [...errors.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/**
 * Même envoi, mais on ne garde que le nombre de messages acceptés — la forme
 * qu'attendent les appels courants (notifications d'activité, messages privés).
 *
 * @returns {Promise<number>}
 */
export async function pushToUsers(userIds, payload) {
  const report = await sendPush(userIds, payload);
  return report.accepted;
}

// Coupe le texte d'aperçu d'une notification : au-delà, le système tronque de
// toute façon, autant le faire proprement.
export function preview(text, max = 140) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
