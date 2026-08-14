import DiscordPerson from "../models/DiscordPerson.js";

// ======================================================================
//  Le carnet d'adresses, côté lecture
// ======================================================================
// Ce fichier est sur le chemin de CHAQUE message reçu (il faut savoir comment
// nommer l'auteur avant même de décider si on répond), d'où le cache : une
// lecture Mongo par serveur et par minute, pas une par message. Le cache est
// vidé à l'écriture, donc une modification se voit tout de suite — ce qui
// compte quand on vient de taper la commande pour tester.

const TTL = 60_000;
const cache = new Map(); // guildId -> { at, people }

export const MAX_ALIASES = 8;

async function peopleOf(guildId) {
  if (!guildId) return [];
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < TTL) return hit.people;
  const people = await DiscordPerson.find({ guildId }).lean().catch(() => []);
  cache.set(guildId, { at: Date.now(), people });
  return people;
}

export const forgetGuild = (guildId) => cache.delete(guildId);

// Comment le bot doit appeler cette personne : son nom configuré, sinon son
// pseudo Discord.
export async function resolveName(guildId, discordId, fallback) {
  if (!guildId || !discordId) return fallback;
  const people = await peopleOf(guildId);
  const hit = people.find((p) => p.discordId === String(discordId));
  return hit?.name || fallback;
}

// Le nom À EMPLOYER dans une vanne — pas forcément le nom principal.
//
// L'ancien bot du serveur tirait au sort parmi une dizaine de surnoms par
// personne (« Mondher », « ce connard de mondher », « le grand manitou »…), et
// c'est une bonne part de ce qui le rendait vivant : la même personne n'est
// jamais nommée deux fois pareil. Un nom unique, aussi juste soit-il, donne un
// bot qui récite un annuaire.
//
// Le nom principal reste le plus probable (une fois sur deux) : les surnoms
// doivent rester une saillie, pas devenir la norme.
export async function nicknameFor(guildId, discordId, fallback) {
  if (!guildId || !discordId) return fallback;
  const people = await peopleOf(guildId);
  const hit = people.find((p) => p.discordId === String(discordId));
  if (!hit) return fallback;
  if (!hit.aliases?.length || Math.random() < 0.5) return hit.name;
  return hit.aliases[Math.floor(Math.random() * hit.aliases.length)];
}

// Le « qui est qui » injecté dans le prompt. Sans lui, le bot lit « eve » dans
// un message et « Aletheia » dans le suivant sans faire le rapprochement —
// c'est exactement ce que le carnet est censé réparer.
//
// Renvoie une chaîne vide quand rien n'est configuré : pas de section vide dans
// le prompt, pas de jetons gaspillés.
export async function glossary(guildId) {
  const people = await peopleOf(guildId);
  if (!people.length) return "";
  const lines = people
    .slice(0, 40)
    .map((p) =>
      p.aliases?.length
        ? `- ${p.name} (les gens l'appellent aussi : ${p.aliases.join(", ")})`
        : `- ${p.name}`
    )
    .join("\n");
  return `\nQUI EST QUI DANS CE SALON — appelle-les par leur VRAI nom (celui de gauche), même si quelqu'un emploie un de leurs surnoms :\n${lines}\n`;
}

// La fiche d'un membre (pour préremplir le formulaire).
export async function personOf(guildId, discordId) {
  const people = await peopleOf(guildId);
  return people.find((p) => p.discordId === String(discordId)) || null;
}

export const listPeople = (guildId) => peopleOf(guildId);

// Enregistre / met à jour une fiche. `name` vide = suppression (c'est le geste
// naturel dans un formulaire : on efface le champ pour retirer l'entrée, plutôt
// que d'aller chercher un bouton « supprimer » ailleurs).
export async function savePerson({ guildId, discordId = null, name, aliases = [], by = null }) {
  const clean = String(name || "").trim().slice(0, 60);
  const list = [
    ...new Set(
      aliases
        .map((a) => String(a).trim().slice(0, 40))
        .filter(Boolean)
        // Un surnom identique au nom principal n'apporte rien et alourdit le
        // prompt de tout le monde.
        .filter((a) => a.toLowerCase() !== clean.toLowerCase())
    ),
  ].slice(0, MAX_ALIASES);

  forgetGuild(guildId);

  if (!clean) {
    if (!discordId) return { removed: false };
    const r = await DiscordPerson.deleteOne({ guildId, discordId: String(discordId) });
    return { removed: r.deletedCount > 0 };
  }

  if (discordId) {
    const doc = await DiscordPerson.findOneAndUpdate(
      { guildId, discordId: String(discordId) },
      { $set: { name: clean, aliases: list, updatedBy: by } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return { person: doc };
  }

  // Quelqu'un d'extérieur : la clé est son nom (on ne peut pas faire mieux).
  const doc = await DiscordPerson.findOneAndUpdate(
    { guildId, discordId: null, name: clean },
    { $set: { name: clean, aliases: list, updatedBy: by } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return { person: doc };
}

// Suppression explicite par nom (pour les fiches sans identifiant Discord).
export async function removeByName(guildId, name) {
  forgetGuild(guildId);
  const r = await DiscordPerson.deleteOne({
    guildId,
    name: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });
  return r.deletedCount > 0;
}
