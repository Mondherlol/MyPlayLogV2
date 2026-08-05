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
 * Envoie une notification aux appareils d'une liste d'utilisateurs.
 *
 * @param {string[]} userIds   destinataires
 * @param {object}   payload   { title, body, data }
 * @returns {Promise<number>}  nombre de messages acceptés par Expo
 */
export async function pushToUsers(userIds, { title, body, data = {} } = {}) {
  const ids = [...new Set((userIds || []).map(String))].filter(Boolean);
  if (!ids.length) return 0;

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
        title,
        body,
        data,
        sound: "default",
        channelId: "messages",
        priority: "high",
      });
    }
  }
  if (!messages.length) return 0;

  let accepted = 0;
  const dead = [];

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
      const tickets = json?.data || [];
      tickets.forEach((ticket, i) => {
        if (ticket?.status === "ok") {
          accepted += 1;
          return;
        }
        if (ticket?.details?.error === "DeviceNotRegistered") {
          dead.push(batch[i].to);
        }
      });
    } catch (err) {
      // Une notification perdue n'est pas un message perdu : le message est
      // déjà en base et arrivera à l'ouverture de l'app. On ne remonte pas.
      console.error("push send error:", err.message);
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

  return accepted;
}

// Coupe le texte d'aperçu d'une notification : au-delà, le système tronque de
// toute façon, autant le faire proprement.
export function preview(text, max = 140) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
