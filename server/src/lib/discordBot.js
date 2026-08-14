import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} from "discord.js";
import { generateDiscordReply, BOT_USERNAME } from "./bot.js";

// ======================================================================
//  Le bot, côté Discord
// ======================================================================
// Le MÊME personnage que dans la messagerie du site (lib/bot.js en garde la
// seule définition) posé sur un salon Discord. Ce fichier ne connaît que trois
// choses : quand ouvrir la bouche, quoi donner à lire au modèle, et comment
// ne pas se faire bannir pour spam.
//
// QUAND IL PARLE — et c'est volontairement étroit :
//
//   1. on le MENTIONNE (@Gérard) ;
//   2. on RÉPOND à un de ses messages ;
//   3. on lui écrit en message privé Discord (là, tout message compte : il n'y
//      a personne d'autre dans le fil, exiger un ping serait absurde).
//
// Il ne réagit donc JAMAIS à la conversation générale. C'est ce qui fait la
// différence entre un bot qu'on invite et un bot qu'on expulse au bout d'une
// heure : sur un serveur actif, un troll qui s'invite tout seul dans chaque
// discussion devient insupportable en une soirée.
//
// LE CAS QUI COMPTE VRAIMENT est le ping nu. « @Gérard » sans autre mot n'est
// pas une erreur de manipulation : c'est quelqu'un qui lit une bêtise et qui
// convoque le bot dessus. Il faut donc lui donner à lire ce qui précède —
// sans ça il répond « quoi ? », et la blague tombe à plat (voir
// generateDiscordReply).

// Ce qu'on remonte du salon pour donner le contexte. Dix messages : de quoi
// comprendre la vanne en cours sans envoyer un roman au modèle à chaque ping.
const CONTEXT_MESSAGES = 10;

// Un ping toutes les 4 s par salon au maximum. Deux raisons, et la seconde est
// la vraie : ça calme les guerres de pings entre deux copains, et surtout
// chaque réponse est une requête sur le quota gratuit de Gemini — un salon de
// vingt personnes qui découvre le bot peut en brûler la journée en dix minutes.
const CHANNEL_COOLDOWN_MS = 4000;
const lastReplyAt = new Map(); // channelId -> instant

// Un salon à la fois : une deuxième réponse lancée pendant qu'on rédige la
// première arriverait dans le désordre (même règle que dans la messagerie).
const busy = new Set();

let client = null;

export function isDiscordBotConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN);
}

// Le lien « Ajouter le bot à un serveur ». Les permissions demandées sont le
// strict minimum pour tenir une conversation : lire, écrire, répondre en
// citant, et lire l'historique (sans quoi le ping nu n'a rien à lire).
// En demander plus, c'est se faire refuser par les administrateurs prudents —
// et à raison.
export function inviteUrl() {
  const id = process.env.DISCORD_CLIENT_ID;
  if (!id) return null;
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.SendMessagesInThreads,
    PermissionsBitField.Flags.ReadMessageHistory,
  ]);
  const params = new URLSearchParams({
    client_id: id,
    scope: "bot",
    permissions: String(perms.bitfield),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// Le texte utile d'un message : on retire les mentions, sinon le modèle reçoit
// « <@1537…> ferme la » et croit que c'est un mot du vocabulaire.
const clean = (msg) =>
  (msg.content || "")
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const nameOf = (msg) =>
  msg.member?.displayName || msg.author?.globalName || msg.author?.username || "quelqu'un";

async function onMessage(msg) {
  try {
    // Jamais de bot à bot : deux instances qui se répondent font une boucle
    // infinie, et c'est la façon classique de se faire bannir de l'API.
    if (msg.author?.bot) return;
    if (!msg.content && !msg.reference) return;

    const meId = client.user.id;
    const isDm = !msg.guild;
    const mentioned = msg.mentions.users.has(meId);
    // @everyone / @here ne sont PAS une convocation : le bot n'a pas à répondre
    // à chaque annonce du serveur.
    const everyone = msg.mentions.everyone;

    let replyingTo = null;
    if (msg.reference?.messageId) {
      const parent = await msg.channel.messages
        .fetch(msg.reference.messageId)
        .catch(() => null);
      if (parent?.author?.id === meId) replyingTo = clean(parent);
    }

    if (!isDm && (everyone || (!mentioned && replyingTo === null))) return;

    const now = Date.now();
    const key = msg.channelId;
    if (busy.has(key)) return;
    if (now - (lastReplyAt.get(key) || 0) < CHANNEL_COOLDOWN_MS) return;
    lastReplyAt.set(key, now);
    busy.add(key);

    try {
      // Le témoin « écrit… » : une réponse met une à deux secondes, et sans lui
      // on croit que le ping n'a servi à rien.
      msg.channel.sendTyping().catch(() => {});

      const fetched = await msg.channel.messages
        .fetch({ limit: CONTEXT_MESSAGES, before: msg.id })
        .catch(() => null);
      const history = fetched
        ? [...fetched.values()]
            .reverse()
            .map((m) => ({
              author: m.author?.id === meId ? BOT_USERNAME : nameOf(m),
              text: clean(m),
            }))
        : [];

      const reply = await generateDiscordReply({
        askedBy: nameOf(msg),
        text: clean(msg),
        history,
        replyingTo,
      });

      await msg.reply({
        content: reply,
        // On répond EN CITANT sans re-notifier : la citation suffit à savoir à
        // qui il parle, et une notification de plus pour une vanne agace.
        allowedMentions: { repliedUser: false, parse: [] },
      });
    } finally {
      busy.delete(key);
    }
  } catch (err) {
    console.error("discord bot message error:", err.message);
  }
}

// Démarre la connexion à la Gateway. Sans jeton, on ne fait RIEN et on le dit
// une fois : le site doit tourner exactement pareil sans bot Discord.
export async function startDiscordBot() {
  if (!isDiscordBotConfigured()) {
    console.log("· bot Discord non configuré (DISCORD_BOT_TOKEN absent) — ignoré");
    return null;
  }
  if (client) return client;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      // PRIVILÉGIÉ : à cocher dans l'onglet « Bot » du portail développeur
      // (« Message Content Intent »). Sans lui, `msg.content` arrive VIDE et le
      // bot répond à côté de tout, sans la moindre erreur pour l'expliquer.
      GatewayIntentBits.MessageContent,
    ],
    // Un message privé arrive sur un canal que le client n'a pas en cache :
    // sans ces partials, l'évènement n'est tout simplement jamais émis.
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, (c) =>
    console.log(`🤖 Bot Discord connecté : ${c.user.tag}`)
  );
  client.on(Events.MessageCreate, onMessage);
  client.on(Events.Error, (err) => console.error("discord bot error:", err.message));

  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error("❌ Connexion du bot Discord impossible :", err.message);
    client = null;
  }
  return client;
}

export function discordBotStatus() {
  return {
    configured: isDiscordBotConfigured(),
    online: !!client?.isReady?.(),
    tag: client?.user?.tag || null,
    guilds: client?.guilds?.cache?.size ?? 0,
    invite: inviteUrl(),
  };
}
