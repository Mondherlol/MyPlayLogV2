import AppSetting from "../models/AppSetting.js";

// ======================================================================
//  La victime du jour
// ======================================================================
// Chaque jour, le premier qui parle dans le serveur est désigné victime. Il se
// fait vanner au hasard toute la journée, et se fait parfois renommer d'office.
// C'était le rituel de l'ancien bot, et la meilleure idée de son lot : ça crée
// un running gag quotidien que personne ne déclenche volontairement.
//
// STOCKÉ DANS AppSetting plutôt que dans un modèle à lui : c'est une ligne par
// serveur Discord (« qui, quel jour »), le magasin clé/valeur existe pour
// exactement ça, et inventer une collection pour deux champs serait du bruit.

const key = (guildId) => `discord.victim.${guildId}`;

const today = () => new Date().toISOString().split("T")[0];

// Le tirage se fait sur le PREMIER MESSAGE du jour, sans que personne ne
// choisisse — c'est ce qui le rend acceptable : on ne peut ni se porter
// volontaire, ni désigner quelqu'un.
export async function pickVictim(guildId, { discordId, username }) {
  const row = await AppSetting.findOne({ key: key(guildId) }).lean().catch(() => null);
  if (row?.value?.date === today()) return null; // déjà désignée aujourd'hui

  await AppSetting.findOneAndUpdate(
    { key: key(guildId) },
    { value: { date: today(), discordId: String(discordId), username } },
    { upsert: true }
  );
  return { discordId: String(discordId), username };
}

export async function currentVictim(guildId) {
  const row = await AppSetting.findOne({ key: key(guildId) }).lean().catch(() => null);
  if (!row?.value || row.value.date !== today()) return null;
  return row.value;
}

// L'annonce. Volontairement franche : tout le salon doit comprendre que c'est
// un jeu et qui est concerné, sinon les vannes qui suivent tombent de nulle
// part.
const ANNOUNCE = [
  "🔪 **{u}** est la victime du jour, bon courage",
  "victime du jour : **{u}**. ça va être long pour toi",
  "aujourdhui on sacrifie **{u}**, désolé pas désolé",
  "**{u}** tu vas morfler aujourdhui",
  "jaime vraiment pas ta tete aujourdhui **{u}**",
  "jsuis pas dhumeur a supporter **{u}** aujourdhui",
  "tirage au sort... **{u}** ! quelle surprise",
];

export const announceVictim = (username) =>
  ANNOUNCE[Math.floor(Math.random() * ANNOUNCE.length)].replace("{u}", username);

// Les surnoms imposés.
//
// LA LISTE DE L'ANCIEN BOT N'A PAS ÉTÉ REPRISE TELLE QUELLE, et c'est un choix
// que j'assume : elle contenait des insultes homophobes, des références au
// handicap et à la Shoah. Sur un serveur privé entre potes c'est une chose ;
// portées dans le code d'un site public, avec un bot que n'importe quel serveur
// peut inviter, ce sont exactement les trois lignes rouges du personnage
// (cf. PERSONA, lib/bot.js) — et le genre de capture d'écran qui coûte un
// hébergement. Le rituel est identique, le vocabulaire est nettoyé.
const VICTIM_NAMES = [
  "Victime",
  "Victime du jour",
  "Souffre-douleur",
  "Le clown de service",
  "Le boulet",
  "Bouffon officiel",
  "Cassos n°1",
  "Le maillon faible",
  "Sac de frappe",
  "Tocard certifié",
  "Le raté du serveur",
  "Fan n°1 de Gérard",
  "Je paye ma tournée",
  "Jsuis nul aux jeux",
  "Le pire de tous",
  "Champion de rien",
  "Détecteur de defaite",
  "Larbin",
];

export const victimNickname = () =>
  VICTIM_NAMES[Math.floor(Math.random() * VICTIM_NAMES.length)];

// Les probabilités, reprises de l'ancien : assez rares pour rester une
// surprise, assez fréquentes pour qu'on sente qu'on est la victime.
export const HARASS_CHANCE = 0.15;
export const RENAME_CHANCE = 0.06;
