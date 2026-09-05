import "dotenv/config";
import mongoose from "mongoose";
import { syncEventCalendar } from "../lib/eventCalendar.js";

// ======================================================================
//  Synchro du CALENDRIER — les rendez-vous à venir
// ======================================================================
//   npm run sync:calendar          → met à jour la base
//   npm run sync:calendar -- --dry → montre ce qui serait fait, sans écrire
//
// ⚠️ NE PAS CONFONDRE AVEC `npm run sync:events`. Celui-là construit les LISTES
// des conférences PASSÉES (ce qui y a été montré, depuis IGDB). Celui-ci
// annonce ce qui ARRIVE, avec un compte à rebours, depuis l'agenda de
// gameconfguide.com (flux iCal) et IGDB.
// Cf. lib/eventCalendar pour pourquoi les deux ne peuvent pas être la même
// chose.
//
// Le serveur fait déjà ce travail tout seul deux fois par jour
// (startEventCalendarSync, appelé depuis index.js) : ce script sert à le
// déclencher à la main juste après l'annonce d'un Direct, sans attendre.

const dry = process.argv.includes("--dry");

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI manquant dans server/.env");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const summary = await syncEventCalendar({ dry, log: (l) => console.log(l) });

  console.log(
    `\n${dry ? "(à blanc) " : ""}agenda ${summary.gcg} · IGDB ${summary.igdb} → ` +
      `${summary.kept} retenus : ${summary.created} créés, ${summary.updated} mis à jour, ` +
      `${summary.pruned} retirés`
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("❌", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
