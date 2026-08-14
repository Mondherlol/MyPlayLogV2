import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionsBitField,
} from "discord.js";
import { generateDiscordReply, BOT_USERNAME } from "./bot.js";
import {
  DAILY_WINS,
  WIN_POINTS,
  activePuzzle,
  addHint,
  leaderboard,
  newPuzzle,
  puzzleText,
  tryGuess,
} from "./discordPuzzle.js";
import {
  addToWishlist,
  gameById,
  searchGames,
  userOfDiscord,
  wishlistCount,
} from "./discordLibrary.js";

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
//   1. on le MENTIONNE (@Gérard) — ou on dit simplement son NOM dans la phrase
//      (« gérard il raconte n'importe quoi »), ce qui est de loin le cas le
//      plus fréquent : personne n'écrit une vraie mention pour parler de
//      quelqu'un ;
//   2. on RÉPOND à un de ses messages ;
//   3. on lui écrit en message privé Discord (là, tout message compte : il n'y
//      a personne d'autre dans le fil, exiger un ping serait absurde).
//
//   4. et, DE TEMPS EN TEMPS ET SANS PRÉVENIR, il s'invite tout seul dans la
//      conversation (voir shouldInterject plus bas).
//
// Le point 4 est la seule entorse au principe, et elle est calibrée pour ça :
// un troll qui commenterait chaque message serait expulsé du serveur en une
// soirée, un troll qui débarque une fois par heure est un membre du serveur.
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

// ============================================================
//  L'intrusion : il s'invite tout seul, de temps en temps
// ============================================================
// Un bot qui n'ouvre la bouche que sur commande est un distributeur. Celui-ci
// débarque sans prévenir dans une conversation en cours pour placer sa
// remarque — c'est ce qui le fait passer pour un membre du serveur plutôt que
// pour un outil.
//
// TOUTE LA DIFFICULTÉ EST DANS LA FRÉQUENCE, et elle se règle en trois nombres :
//
//   • UN SEUIL TIRÉ AU HASARD à chaque fois (entre 25 et 90 messages). Un seuil
//     fixe se repère en une soirée — « il parle tous les 30 messages » — et la
//     surprise, qui est tout l'intérêt, disparaît.
//   • UN PLANCHER DE TEMPS (20 min). Sans lui, un salon de dix personnes qui
//     s'emballe atteint 90 messages en dix minutes et le bot devient le
//     bavard qu'on coupe.
//   • UN FILET QUOTIDIEN (20 h). C'est la demande explicite : au moins une fois
//     par jour. Dans un salon calme qui ne fera jamais 25 messages, c'est ce
//     filet qui le fait parler — dès qu'il y a un minimum de vie (5 messages),
//     pour ne pas répondre dans le vide à un salon mort depuis un mois.
const INTRUSION_MIN = 25;
const INTRUSION_MAX = 90;
const INTRUSION_QUIET_MS = 20 * 60 * 1000;
const INTRUSION_DAILY_MS = 20 * 60 * 60 * 1000;
const INTRUSION_DAILY_MIN_MSG = 5;

// channelId -> { seen, target, lastAt }
const intrusion = new Map();

const nextTarget = () =>
  INTRUSION_MIN + Math.floor(Math.random() * (INTRUSION_MAX - INTRUSION_MIN + 1));

// Compte le message qui passe et dit s'il faut s'inviter maintenant.
//
// L'état est en MÉMOIRE et pas en base : ce n'est qu'un compteur d'ambiance,
// le perdre à un redéploiement ne coûte rien. On initialise `lastAt` à
// l'instant présent au premier message vu, sinon chaque redémarrage
// déclencherait aussitôt le filet quotidien dans tous les salons à la fois.
function shouldInterject(channelId) {
  const now = Date.now();
  let st = intrusion.get(channelId);
  if (!st) {
    st = { seen: 0, target: nextTarget(), lastAt: now };
    intrusion.set(channelId, st);
  }
  st.seen += 1;

  const quiet = now - st.lastAt;
  const reached = st.seen >= st.target && quiet >= INTRUSION_QUIET_MS;
  const daily = quiet >= INTRUSION_DAILY_MS && st.seen >= INTRUSION_DAILY_MIN_MSG;
  if (!reached && !daily) return false;

  st.seen = 0;
  st.target = nextTarget();
  st.lastAt = now;
  return true;
}

// Le bot vient de parler, quelle qu'en soit la raison (on l'a mentionné, il a
// annoncé une manche gagnée…). Ça repousse l'intrusion suivante : s'inviter
// dans une conversation où l'on vient déjà de prendre la parole, ce n'est plus
// une surprise, c'est de la présence permanente.
function noteBotSpoke(channelId) {
  const st = intrusion.get(channelId);
  if (st) st.lastAt = Date.now();
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

// --- « Gérard », dit à voix haute, vaut une mention ---
// Personne n'écrit « @Gérard » quand il parle DE quelqu'un : on dit « gérard il
// raconte n'importe quoi », et le bot restait muet alors qu'on venait
// littéralement de l'appeler par son nom. C'est le cas le plus naturel de tous,
// et c'était le seul qu'il ne voyait pas.
//
// Deux précautions dans cette regex :
//   • les ACCENTS SONT NEUTRALISÉS des deux côtés (personne ne tape « Gérard »
//     avec son accent dans un salon) ;
//   • des LIMITES DE MOT, sinon « bot » attraperait « robot », « botte » ou
//     « sabotage » et il s'inviterait dans une conversation sur rien.
const deaccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NAME_RE = new RegExp(
  `(^|[^\\p{L}])(${escapeRe(deaccent(BOT_USERNAME))}|le bot|ce bot)($|[^\\p{L}])`,
  "u"
);

// Exportée : c'est le genre de règle qui se trompe en silence (un « robot » pris
// pour un appel, un « Gérard » manqué à cause d'un accent), et on veut pouvoir
// la vérifier sur une liste de phrases sans lancer de bot.
export const calledByName = (text) => NAME_RE.test(deaccent(text));

// ============================================================
//  Les lettres mêlées
// ============================================================
// La partie du bot qui ne coûte RIEN : pas un jeton de modèle de langage. Le
// titre vient d'IGDB, le mélange est un shuffle, la correction est une
// comparaison de chaînes (voir lib/discordPuzzle.js).
//
// DEUX RÈGLES D'ERGONOMIE, et elles se complètent :
//
//   • ON RÉPOND DANS LE SALON, PAS À CHACUN. Une manche est un moment collectif :
//     le titre trouvé s'annonce à tout le monde, sinon la moitié du salon
//     cherche encore quelque chose que quelqu'un a déjà trouvé.
//   • ON SE TAIT SUR LES MAUVAISES RÉPONSES. Le bot lit tous les messages du
//     salon pendant une manche ; s'il commentait chaque tentative ratée, jouer
//     à dix rendrait le salon illisible. Silence, donc — et une seule prise de
//     parole : la bonne réponse.

const PREFIX = "!";

// L'adresse du site, pour le lien « lie ton compte ». En prod c'est SITE_URL ;
// à défaut la première origine autorisée (celle du client en dev).
const siteUrl = () =>
  (process.env.SITE_URL || (process.env.CLIENT_ORIGIN || "").split(",")[0] || "")
    .trim()
    .replace(/\/$/, "");

const HELP = [
  `**${BOT_USERNAME}**, à votre service (façon de parler).`,
  `\`${PREFIX}jeu\` — une nouvelle grille de lettres mêlées (${WIN_POINTS} pts au premier qui trouve)`,
  `\`${PREFIX}indice\` — une lettre de plus, pour les faibles`,
  `\`${PREFIX}classement\` — le classement du serveur`,
  `\`${PREFIX}add <jeu>\` — ajoute un jeu à ta liste de souhaits sur MyPlayLog`,
  `Mentionne-moi ou réponds à un de mes messages si tu veux te faire insulter.`,
].join("\n");

// Poser une manche. Si une est déjà en cours dans ce salon, on la RAPPELLE au
// lieu d'en tirer une autre : sinon il suffit de spammer la commande pour faire
// défiler les titres jusqu'à en trouver un facile.
async function cmdPuzzle(msg) {
  const existing = await activePuzzle(msg.channelId);
  if (existing) {
    await msg.channel.send(`Y'en a déjà une en cours, suis un peu 💀\n${puzzleText(existing)}`);
    return;
  }
  const p = await newPuzzle({ guildId: msg.guildId || null, channelId: msg.channelId });
  if (!p) {
    await msg.channel.send("j'ai plus de jeux sous la main, réessaie dans deux minutes");
    return;
  }
  const sent = await msg.channel.send(puzzleText(p));
  p.messageId = sent.id;
  await p.save();
}

async function cmdHint(msg) {
  const p = await activePuzzle(msg.channelId);
  if (!p) {
    await msg.channel.send(`aucune manche en cours, lance \`${PREFIX}jeu\` avant de réclamer`);
    return;
  }
  const updated = await addHint(p);
  await msg.channel.send(
    updated
      ? puzzleText(updated)
      : "j'en ai déjà trop dit, cherche un peu 🤡"
  );
}

async function cmdBoard(msg) {
  if (!msg.guildId) {
    await msg.channel.send("le classement, c'est par serveur. Ici on est que tous les deux.");
    return;
  }
  const rows = await leaderboard(msg.guildId);
  if (!rows.length) {
    await msg.channel.send(`personne n'a encore rien gagné ici. \`${PREFIX}jeu\` pour commencer.`);
    return;
  }
  const medal = (i) => ["🥇", "🥈", "🥉"][i] || `\`${String(i + 1).padStart(2, " ")}\``;
  const embed = new EmbedBuilder()
    .setColor(0x7c5cf0)
    .setTitle("Classement des lettres mêlées")
    .setDescription(
      rows
        .map(
          (r, i) =>
            `${medal(i)} **${r.username || "?"}** — ${r.wins} trouvé${r.wins > 1 ? "s" : ""} · ${r.points} pts` +
            // On signale l'ardoise : c'est le rappel le plus efficace, il
            // arrive au moment où la personne regarde son propre score.
            (r.pending > 0 ? ` *(${r.pending} en attente, compte non lié)*` : "")
        )
        .join("\n")
    )
    .setFooter({ text: `${WIN_POINTS} pts par grille · ${DAILY_WINS} grilles payantes par jour` });
  await msg.channel.send({ embeds: [embed] });
}

// ============================================================
//  « !add <jeu> » — la liste de souhaits
// ============================================================
// La recherche PROPOSE, l'humain CHOISIT. Un bouton par résultat : c'est le
// seul moyen d'ajouter le bon jeu quand quelqu'un tape « zelda » (IGDB en
// connaît une trentaine). Les boutons ne transportent que l'identifiant IGDB et
// celui du demandeur — rien qui périme, donc un bouton reste cliquable même
// après un redéploiement du serveur.
const WISH_PREFIX = "mplwish";

// Le lien à donner à quelqu'un dont le Discord n'est rattaché à aucun compte.
const linkLine = () =>
  `Ton Discord n'est lié à aucun compte MyPlayLog : ${siteUrl()}/settings?tab=discord`;

async function cmdAdd(msg, term) {
  if (!term) {
    await msg.reply(`\`${PREFIX}add <nom du jeu>\`, c'est pas compliqué pourtant`);
    return;
  }

  const me = await userOfDiscord(msg.author.id);
  if (!me) {
    await msg.reply(`je sais même pas qui t'es 🤡\n${linkLine()}`);
    return;
  }

  const found = await searchGames(term, 5);
  if (!found.length) {
    await msg.reply(`« ${term} » ça existe pas, réessaie en écrivant correctement 💀`);
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    found.map((g, i) =>
      new ButtonBuilder()
        .setCustomId(`${WISH_PREFIX}:${g.gameId}:${msg.author.id}`)
        .setLabel(`${i + 1}`)
        .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );

  await msg.reply({
    content:
      `Lequel, ${nameOf(msg)} ?\n` +
      found
        .map((g, i) => `**${i + 1}.** ${g.name}${g.year ? ` *(${g.year})*` : ""}`)
        .join("\n"),
    components: [row],
  });
}

// Le clic sur un des boutons.
async function onWishButton(inter) {
  const [, rawId, requesterId] = inter.customId.split(":");

  // Le bouton appartient à celui qui a tapé la commande. Sans ça, le premier
  // farceur venu remplit la wishlist des autres depuis leur propre message.
  if (inter.user.id !== requesterId) {
    await inter.reply({
      content: "c'est pas ta commande, lâche ça 🤡",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await inter.deferUpdate();

  const me = await userOfDiscord(inter.user.id);
  if (!me) {
    await inter.followUp({ content: linkLine(), flags: MessageFlags.Ephemeral });
    return;
  }

  const game = await gameById(rawId);
  if (!game) {
    await inter.editReply({ content: "IGDB me répond plus, réessaie", components: [] });
    return;
  }

  const res = await addToWishlist(me._id, game);
  if (res.already) {
    await inter.editReply({
      content: `**${res.name}** est déjà dans ta liste (${res.status}). Suis un peu 💀`,
      components: [],
    });
    return;
  }

  const total = await wishlistCount(me._id);
  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setTitle(`${game.name} ajouté aux souhaits`)
    .setDescription(`sur le compte de **${me.username}** — ça t'en fait ${total} que tu joueras jamais`)
    .setThumbnail(game.cover || null);
  await inter.editReply({ content: "", embeds: [embed], components: [] });
}

// Une proposition pendant une manche. Rend `true` si le message a été « pris »
// par le jeu (bonne réponse) — auquel cas le bot n'a plus à faire autre chose.
async function handleGuess(msg) {
  const p = await activePuzzle(msg.channelId);
  if (!p) return false;

  const res = await tryGuess(p, clean(msg), {
    discordId: msg.author.id,
    username: nameOf(msg),
  });
  if (!res.correct) return false;
  if (res.tooLate) return true; // quelqu'un a coiffé celui-ci au poteau

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`${res.answer} ✅`)
    .setDescription(`**${nameOf(msg)}** a trouvé.`)
    .setThumbnail(p.cover || null);

  if (res.points > 0 && res.linked) {
    embed.addFields({
      name: `+${res.points} points`,
      value: `crédités sur le compte MyPlayLog de **${res.siteUsername}**`,
    });
  } else if (res.points > 0) {
    // Le cas qui compte : on ne dit pas « tant pis », on dit « ça t'attend ».
    embed.addFields({
      name: `${res.points} points t'attendent`,
      value:
        `mais ton Discord n'est lié à aucun compte MyPlayLog, donc pour l'instant ils dorment.\n` +
        `Lie-le ici et ils tombent direct : ${siteUrl()}/settings?tab=discord`,
    });
  } else if (res.capped) {
    embed.addFields({
      name: "0 point",
      value: `t'as déjà pris tes ${DAILY_WINS} grilles du jour, va jouer dehors`,
    });
  }

  await msg.channel.send({ embeds: [embed] });
  return true;
}

async function onMessage(msg) {
  try {
    // Jamais de bot à bot : deux instances qui se répondent font une boucle
    // infinie, et c'est la façon classique de se faire bannir de l'API.
    if (msg.author?.bot) return;
    if (!msg.content && !msg.reference) return;

    // --- Le jeu passe AVANT le troll, et l'ordre n'est pas anodin ---
    // Les commandes et les propositions ne coûtent aucun jeton de modèle : les
    // traiter d'abord, c'est garantir qu'une partie animée ne consomme pas le
    // quota de Gemini, et qu'une bonne réponse ne se fasse pas manger par le
    // cooldown des réponses trollesques (deux compteurs séparés, exprès).
    const raw = (msg.content || "").trim();
    if (raw.startsWith(PREFIX)) {
      const cmd = raw.slice(PREFIX.length).split(/\s+/)[0].toLowerCase();
      if (cmd === "jeu" || cmd === "mot") return void (await cmdPuzzle(msg));
      if (cmd === "indice") return void (await cmdHint(msg));
      if (cmd === "classement" || cmd === "leaderboard") return void (await cmdBoard(msg));
      if (cmd === "add" || cmd === "souhait")
        return void (await cmdAdd(msg, raw.slice(PREFIX.length + cmd.length).trim()));
      if (cmd === "aide" || cmd === "help") return void (await msg.channel.send(HELP));
      // Commande inconnue : on ne dit rien. Le salon n'est pas à nous, et un
      // « commande inconnue » à chaque « !truc » d'un autre bot serait pénible.
    } else if (await handleGuess(msg)) {
      return;
    }

    const meId = client.user.id;
    const isDm = !msg.guild;
    // Une vraie mention Discord, OU son nom prononcé dans la phrase.
    const mentioned = msg.mentions.users.has(meId) || calledByName(msg.content);
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

    // Personne ne l'appelle : c'est peut-être le moment où il s'invite quand
    // même. Le compteur n'avance QUE sur les messages ordinaires — une salve
    // de commandes ou de propositions de jeu ne doit pas précipiter
    // l'intrusion, ce n'est pas de la conversation.
    let spontaneous = false;
    if (!isDm && (everyone || (!mentioned && replyingTo === null))) {
      if (!msg.guild || everyone || !clean(msg)) return;
      if (!shouldInterject(msg.channelId)) return;
      spontaneous = true;
    }

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
        spontaneous,
      });

      await msg.reply({
        content: reply,
        // On répond EN CITANT sans re-notifier : la citation suffit à savoir à
        // qui il parle, et une notification de plus pour une vanne agace.
        // C'est encore plus vrai quand il s'invite : se faire notifier par un
        // bot qu'on n'a pas appelé, c'est le début de la fin.
        allowedMentions: { repliedUser: false, parse: [] },
      });
      noteBotSpoke(key);
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
  // Les boutons de « !add ». Aucune portée `applications.commands` nécessaire :
  // les composants de message arrivent par la Gateway comme le reste.
  client.on(Events.InteractionCreate, (inter) => {
    if (!inter.isButton() || !inter.customId.startsWith(`${WISH_PREFIX}:`)) return;
    onWishButton(inter).catch((err) =>
      console.error("discord wish button error:", err.message)
    );
  });
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
