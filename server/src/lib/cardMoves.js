// ======================================================================
//  Les attaques des cartes, tirées des TAGS du jeu (mots-clés IGDB)
// ======================================================================
// Un genre dit « jeu de tir » ; un tag dit « zombies », « voyage dans le
// temps », « pirates ». C'est lui qui donne une attaque qui ressemble au jeu.
//
// Chaque règle reconnaît des mots-clés et propose :
//   - `names` : des attaques écrites à la main (la signature de la carte) ;
//   - `of`    : un complément qui se greffe derrière un mot du GENRE, côté
//               client — « Rafale » + « des morts-vivants », « Sort » +
//               « du dragon ». Il commence par du/de la/des/de l'/d', ou c'est
//               un mot invariable : il doit aller derrière n'importe quel nom.
//
// L'ORDRE COMPTE : les règles du haut sont les plus parlantes. Un jeu qui a
// « zombies » ET « exploration » doit sortir « Horde affamée », pas « Carte
// au trésor ». Les tags génériques (sang, trésor, rétro) sont tout en bas.

// Les règles de sport, de course et de ferme ne valent QUE pour les jeux de ce
// genre (ids IGDB) : une « batte de baseball » ramassée dans Fallout 3 ne fait
// pas de Fallout un jeu de baseball.
const SPORT = [14];
const RACING = [10, 14];
const SIM = [13];

const RULES = [
  // --- Ce qui DÉFINIT le jeu : un sport, une course, une ferme. Passe avant
  //     tout le reste (une princesse dans Mario Golf reste un détail). ---
  { re: /football|soccer/, names: ["Frappe enroulée", "Petit pont", "Lucarne"], of: "du stade", when: SPORT },
  { re: /basketball/, names: ["Dunk", "Panier à trois points"], of: "du parquet", when: SPORT },
  { re: /\bgolf/, names: ["Trou en un", "Swing parfait"], of: "du green", when: SPORT },
  { re: /tennis/, names: ["Ace", "Revers foudroyant"], of: "du court", when: SPORT },
  { re: /baseball/, names: ["Home run", "Balle courbe"], of: "du terrain", when: SPORT },
  { re: /hockey/, names: ["Mise en échec", "Lancer frappé"], of: "de la patinoire", when: SPORT },
  { re: /skateboard|\bskate/, names: ["Ollie", "Kickflip"], of: "du skatepark", when: SPORT },
  { re: /\bski(ing)?\b|snowboard/, names: ["Slalom", "Triple salto"], of: "des pistes", when: SPORT },
  { re: /motorcycle|\bbike\b|motocross/, names: ["Roue arrière", "Wheeling"], of: "des deux-roues", when: RACING },
  { re: /drift|street racing|sports cars|licensed cars|motorsport|burnout|nitro/, names: ["Nitro", "Drift parfait", "Ligne droite"], of: "du bitume", when: RACING },
  { re: /farming|\bfarm\b|agricultur|crops/, names: ["Récolte", "Semailles"], of: "de la ferme", when: SIM },
  { re: /party game|board game/, names: ["Case bonus", "Étoile volée", "Mini-jeu surprise"], of: "de la fête" },

  // --- Créatures et figures marquantes ---
  { re: /zombie|walking dead|undead/, names: ["Horde affamée", "Morsure contagieuse", "Réveil des morts"], of: "des morts-vivants" },
  { re: /vampire/, names: ["Morsure nocturne", "Soif de sang", "Nuée de chauves-souris"], of: "du vampire" },
  { re: /werewolf|lycanthrop/, names: ["Pleine lune", "Griffe lunaire"], of: "du loup-garou" },
  { re: /dragon/, names: ["Souffle du dragon", "Écaille ardente", "Rugissement draconique"], of: "du dragon" },
  { re: /dinosaur/, names: ["Charge jurassique", "Mâchoire de T-Rex"], of: "des dinosaures" },
  { re: /cthulhu|lovecraft|eldritch|cosmic horror/, names: ["Appel des Grands Anciens", "Folie cosmique"], of: "des abysses" },
  { re: /kaiju|giant monster|titan|colossus|giants/, names: ["Écrasement titanesque", "Pas du colosse"], of: "des titans" },
  { re: /^(?!bullet hell).*(demon|\bhell\b|satan)/, names: ["Flammes infernales", "Pacte démoniaque"], of: "des enfers" },
  { re: /ghost|haunt|poltergeist|\bspirits?\b/, names: ["Hantise", "Frisson spectral", "Possession"], of: "d'outre-tombe" },
  { re: /mummy|pharaoh|egypt/, names: ["Malédiction du pharaon", "Bandelettes"], of: "du pharaon" },
  { re: /skeleton/, names: ["Danse macabre", "Os brisés"], of: "des squelettes" },
  { re: /alien|ufo|extraterrestrial/, names: ["Rayon extraterrestre", "Enlèvement", "Invasion"], of: "venue d'ailleurs" },
  { re: /mutant|mutation/, names: ["Mutation", "Rayon mutagène"], of: "des mutants" },
  { re: /\bmechs?\b|\bmecha\b|giant robot/, names: ["Missiles en essaim", "Poing du mécha"], of: "du mécha" },
  { re: /robot|android|cyborg/, names: ["Poing mécanique", "Surcharge", "Protocole Oméga"], of: "des machines" },
  { re: /creature collect|monster tam|pocket monster/, names: ["Capture", "Évolution"], of: "des créatures" },
  { re: /spider/, names: ["Toile collante", "Venin paralysant"], of: "de l'araignée" },
  { re: /tentacle/, names: ["Étreinte tentaculaire", "Encre noire"], of: "des profondeurs" },
  { re: /shark/, names: ["Mâchoires", "Frénésie"], of: "des requins" },
  { re: /fairy|fairies/, names: ["Poussière de fée", "Enchantement"], of: "des fées" },
  { re: /\belves\b|\belf\b/, names: ["Flèche elfique", "Chant sylvestre"], of: "des elfes" },
  { re: /dwarves|\bdwarf/, names: ["Marteau de la montagne", "Coup de hache"], of: "des nains" },
  { re: /\borcs?\b|goblins?\b|\btrolls?\b/, names: ["Massue de troll", "Coup fourbe", "Horde sauvage"], of: "des orcs" },
  { re: /\bwitch|wizard|sorcer|spellcast|\bmagic\b|\bmages?\b/, names: ["Boule de feu", "Arcane interdit", "Éclair runique"], of: "des arcanes" },
  { re: /\bgods?\b|mythology|olymp|norse|greek myth|deity/, names: ["Colère divine", "Foudre de l'Olympe", "Jugement céleste"], of: "des dieux" },
  { re: /clown|circus/, names: ["Tarte à la crème", "Rire glaçant"], of: "du cirque" },

  // --- Figures, métiers, époques ---
  { re: /pirate/, names: ["Abordage", "Bordée de canons", "Coup de sabre"], of: "des pirates" },
  { re: /ninja/, names: ["Shuriken", "Pas de l'ombre", "Clone d'ombre"], of: "du ninja" },
  { re: /samurai|katana|ronin/, names: ["Iaijutsu", "Lame du ronin"], of: "du samouraï" },
  { re: /viking/, names: ["Rage berserker", "Hache du Nord"], of: "du Nord" },
  { re: /cowboy|western|wild west|outlaw/, names: ["Duel au soleil", "Dégainer"], of: "du Far West" },
  { re: /assassin/, names: ["Lame secrète", "Saut de la foi", "Frappe dans l'ombre"], of: "de l'assassin" },
  { re: /superhero|super hero|superpower/, names: ["Coup héroïque", "Pouvoir ultime"], of: "du héros" },
  { re: /lightsaber|jedi|\bthe force\b/, names: ["Sabre laser", "Poussée de Force"], of: "de la Force" },
  { re: /knight|chivalry/, names: ["Charge du chevalier", "Estoc"], of: "des chevaliers" },
  { re: /detective|investigation|crime scene/, names: ["Interrogatoire", "Preuve accablante", "Déduction"], of: "du détective" },
  { re: /mafia|organized crime|gang|mob boss|yakuza/, names: ["Racket", "Règlement de comptes", "Offre irrefusable"], of: "de la pègre" },
  { re: /heist|robbery|theft|bank robbery|carjack/, names: ["Braquage", "Coup du siècle", "Vol à l'arraché"], of: "des voleurs" },
  { re: /espionage|\bspy\b|spies|secret agent|infiltration/, names: ["Infiltration", "Agent double", "Code secret"], of: "de l'espion" },
  { re: /prison|escaping imprisonment|jailbreak/, names: ["Évasion", "Barreaux sciés"], of: "de l'évadé" },
  { re: /mad scientist|scientist|laborator/, names: ["Expérience ratée", "Formule instable"], of: "du savant fou" },
  { re: /royalty|princess|\bking\b|\bqueen\b/, names: ["Décret royal", "Garde royale"], of: "du royaume" },
  { re: /world war ii|ww2|nazi/, names: ["Débarquement", "Tir de mortier"], of: "de la Résistance" },
  { re: /terrorist|hostage|counter-terror/, names: ["Libération d'otages", "Brèche"], of: "des forces spéciales" },
  { re: /special forces|military|soldier|modern warfare|\bwar\b|guerilla/, names: ["Frappe aérienne", "Tir de suppression", "Assaut éclair"], of: "du front" },

  // --- Pouvoirs et phénomènes ---
  { re: /time travel|time manipulation|time loop|rewind/, names: ["Distorsion temporelle", "Retour en arrière", "Paradoxe"], of: "du temps" },
  { re: /teleport|portal|dimension travel|parallel world/, names: ["Portail", "Téléportation", "Saut dimensionnel"], of: "des dimensions" },
  { re: /gravity/, names: ["Apesanteur", "Inversion gravitationnelle"], of: "de la gravité" },
  { re: /bullet time|slow-motion|slow motion/, names: ["Bullet time", "Ralenti mortel"], of: "au ralenti" },
  { re: /telekinesis|mind control|psychic|telepath/, names: ["Télékinésie", "Contrôle mental", "Onde psychique"], of: "de l'esprit" },
  { re: /fire manipulation|pyrokines|\bflamethrower/, names: ["Déluge de flammes", "Combustion"], of: "des flammes" },
  { re: /shape-shift|shapeshift|transformation/, names: ["Métamorphose", "Forme cachée"], of: "du métamorphe" },
  { re: /invisibility/, names: ["Invisibilité", "Coup fantôme"], of: "de l'invisible" },
  { re: /clone/, names: ["Armée de clones", "Double maléfique"], of: "des clones" },
  { re: /super speed|speedster/, names: ["Supervitesse", "Éclair humain"], of: "de l'éclair" },
  { re: /dream|nightmare/, names: ["Rêve lucide", "Cauchemar"], of: "des songes" },
  { re: /insanity|madness|sanity/, names: ["Folie", "Démence"], of: "de la folie" },
  { re: /\bcults?\b|religion|ritual/, names: ["Rituel interdit", "Ferveur"], of: "du culte" },
  { re: /disease|virus|pandemic|plague|infection/, names: ["Épidémie", "Contagion"], of: "de la peste" },
  { re: /poison/, names: ["Poison lent", "Toxine"], of: "du poison" },

  // --- Mondes et décors ---
  { re: /cyberpunk/, names: ["Implant chromé", "Néon brûlant"], of: "de la mégalopole" },
  { re: /hacking|hacker/, names: ["Piratage", "Virus", "Surcharge système"], of: "du réseau" },
  { re: /steampunk/, names: ["Engrenage", "Vapeur sous pression"], of: "à vapeur" },
  { re: /post-apocalyptic|apocalypse|nuclear|radiation|wasteland|fallout shelter/, names: ["Retombées", "Champignon atomique", "Survie"], of: "des terres désolées" },
  { re: /spaceship|space combat|starship|galaxy|outer space|\bspace\b|space station/, names: ["Hyperpropulsion", "Canon à plasma", "Saut spatial"], of: "des étoiles" },
  { re: /submarine|naval|underwater|ocean|deep sea/, names: ["Raz-de-marée", "Torpille", "Plongée"], of: "des abysses" },
  { re: /volcano|lava/, names: ["Éruption", "Coulée de lave"], of: "du volcan" },
  { re: /desert/, names: ["Tempête de sable", "Mirage"], of: "du désert" },
  { re: /jungle/, names: ["Liane", "Embuscade"], of: "de la jungle" },
  { re: /ice stage|\bsnow|winter|blizzard|frozen/, names: ["Blizzard", "Souffle glacé"], of: "des glaces" },
  { re: /\bmoon\b|lunar/, names: ["Éclipse", "Rayon lunaire"], of: "de la lune" },
  { re: /mushroom/, names: ["Super champignon", "Spore géante"], of: "des champignons" },
  { re: /medieval|castle/, names: ["Assaut du donjon", "Pont-levis"], of: "du royaume" },
  { re: /darkness|dark fantasy|shadow/, names: ["Ténèbres", "Voile d'ombre"], of: "des ténèbres" },

  // --- Gestes et styles de jeu ---
  { re: /survival horror|psychological horror|\bhorror\b/, names: ["Jumpscare", "Terreur", "Cri dans la nuit"], of: "de l'effroi" },
  { re: /parkour|free running|acrobatic|wall run|wall jump/, names: ["Saut de la foi", "Course libre", "Salto arrière"], of: "des toits" },
  { re: /stealth|sneak|vent crawl|hiding/, names: ["Assassinat furtif", "Frappe silencieuse"], of: "de l'ombre" },
  { re: /martial arts|kung fu|karate|hand-to-hand|brawler|beat 'em up/, names: ["Coup de pied retourné", "Poing du dragon", "Enchaînement"], of: "des arts martiaux" },
  { re: /boxing|boxer/, names: ["Crochet du droit", "K.-O. technique"], of: "du ring" },
  { re: /wrestling/, names: ["Suplex", "Prise du catcheur"], of: "du ring" },
  { re: /sniping|sniper/, names: ["Tir de précision", "Balle perforante"], of: "du sniper" },
  { re: /\btanks?\b/, names: ["Obus perforant", "Char d'assaut"], of: "des blindés" },
  { re: /dual wield/, names: ["Double détente", "Ambidextre"], of: "à deux mains" },
  { re: /bow and arrow|archery|archer/, names: ["Flèche perçante", "Pluie de flèches"], of: "de l'archer" },
  { re: /grappl|grappling hook/, names: ["Grappin", "Attraction"], of: "du grappin" },
  { re: /helicopter|airplane|aircraft|dogfight|flight|gliding|jetpack/, names: ["Piqué", "Tonneau", "Rase-mottes"], of: "des airs" },
  { re: /sword/, names: ["Lame tournoyante", "Taille croisée"], of: "de la lame" },
  { re: /hunting|hunter/, names: ["Traque", "Piège à loup"], of: "du chasseur" },
  { re: /lock ?picking/, names: ["Crochetage", "Passe-partout"], of: "du cambrioleur" },
  { re: /revenge|vengeance|betrayal/, names: ["Vengeance", "Trahison"], of: "de la vengeance" },

  // --- Véhicules et métiers du quotidien ---
  { re: /tournament/, names: ["Finale", "K.-O."], of: "du tournoi" },
  { re: /police chase|car chase|vehicular combat|vehicle combat/, names: ["Course-poursuite", "Carambolage"], of: "de la poursuite" },
  { re: /horse/, names: ["Galop", "Charge montée"], of: "du cavalier" },
  { re: /fishing/, names: ["Prise du jour", "Lancer"], of: "du pêcheur" },
  { re: /cooking|restaurant|chef|pizza|bread|food/, names: ["Coup de poêle", "Recette secrète", "Service express"], of: "du chef" },
  { re: /mining|\bminer\b/, names: ["Coup de pioche", "Filon"], of: "de la mine" },
  { re: /base building|building|construction|crafting/, names: ["Grand chantier", "Fabrication", "Plan d'architecte"], of: "de l'artisan" },
  { re: /management|economy|\btrading\b(?! cards)|business|tycoon/, names: ["Bonne affaire", "Investissement", "Monopole"], of: "du marché" },
  { re: /guitar|singing|dancing|rock music|\bband\b|concert/, names: ["Solo de guitare", "Note parfaite", "Pas de danse"], of: "de la scène" },
  { re: /playing cards|card game|deck ?building|\bdice\b|poker|gambling|casino/, names: ["Main parfaite", "Joker", "Lancer de dés"], of: "du croupier" },
  { re: /romance|dating|\blove\b/, names: ["Coup de foudre", "Déclaration"], of: "du cœur" },
  { re: /high school|school|teenager|student/, names: ["Colle", "Devoir surprise"], of: "du lycée" },

  // --- Animaux ---
  { re: /\bwolf|wolves/, names: ["Hurlement", "Appel de la meute"], of: "de la meute" },
  { re: /\bcat\b|\bcats\b|kitten/, names: ["Coup de griffe", "Ronron"], of: "du chat" },
  { re: /\bdog\b|\bdogs\b|puppy/, names: ["Aboiement", "Rapporte !"], of: "du chien" },
  { re: /\bbees?\b|\bhive\b/, names: ["Essaim", "Dard"], of: "de la ruche" },
  { re: /snake/, names: ["Venin", "Constriction"], of: "du serpent" },
  { re: /\brats?\b/, names: ["Invasion de rats", "Rongeur"], of: "des égouts" },
  { re: /monkey|\bape\b|gorilla/, names: ["Lancer de banane", "Rage du gorille"], of: "du singe" },
  { re: /chicken/, names: ["Nuée de poules", "Coup de bec"], of: "du poulailler" },
  { re: /turtle/, names: ["Carapace", "Repli"], of: "de la tortue" },
  { re: /\bbats?\b/, names: ["Nuée de chauves-souris", "Écholocation"], of: "de la nuit" },
  { re: /\bcrows?\b|raven/, names: ["Vol de corbeaux", "Présage"], of: "des corbeaux" },
  { re: /frog/, names: ["Coup de langue", "Saut de grenouille"], of: "de la mare" },
  { re: /\bbird|eagle|owl/, names: ["Piqué", "Envol"], of: "des oiseaux" },
  { re: /talking animals|anthropomorph/, names: ["Instinct sauvage", "Charge sauvage"], of: "de la jungle" },

  // --- Tout en bas : les tags larges, faute de mieux ---
  { re: /metroidvania|backtracking/, names: ["Double saut", "Passage secret"], of: "du labyrinthe" },
  { re: /roguelike|roguelite|permadeath/, names: ["Nouvelle tentative", "Mort permanente"], of: "sans retour" },
  { re: /speedrun/, names: ["Speedrun", "Skip"], of: "chronométré" },
  { re: /arcade cabinet|high score/, names: ["High score", "Insert coin"], of: "d'arcade" },
  { re: /pixel art|8-bit|16-bit|\bretro\b/, names: ["Pixel parfait", "Blaster 8-bit"], of: "rétro" },
  { re: /dark humor|self-referential humor|breaking the fourth wall|funny|parody/, names: ["Blague douteuse", "Quatrième mur"], of: "du bouffon" },
  // Le « jump scare » seul (Firewatch en a un) : un frisson, pas de l'horreur.
  { re: /jump scare/, names: ["Sursaut", "Frisson"], of: "de l'effroi" },
  // L'explosion est partout (un jeu sur six) : elle ne passe qu'en dernier.
  { re: /explosi|grenade|bomb|dynamite/, names: ["Déflagration", "Grenade", "Mise à feu"], of: "de la poudre" },
  { re: /treasure|\bloot\b(?! box)/, names: ["Trésor caché", "Butin"], of: "du trésor" },
  { re: /exploration|open world/, names: ["Carte au trésor", "Terre inconnue"], of: "des explorateurs" },
  { re: /gore|bloody|extreme violence|dismember|severed/, names: ["Carnage", "Effusion de sang"], of: "du carnage" },
];

// Petit hachage stable : un jeu choisit toujours les mêmes attaques.
function hash(a, b = 0) {
  let x = (Number(a) | 0) ^ Math.imul(b + 1, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Les deux tags qui feront les attaques d'une carte : `{ a, b }`, où `a` est
 * la règle la plus parlante et `b` la suivante (ou null). Chacun porte un nom
 * d'attaque déjà choisi et son complément.
 */
/**
 * Les règles qu'un mot-clé déclenche (leurs rangs dans RULES). À calculer UNE
 * fois par mot-clé : 26 000 cartes × 30 mots-clés × 130 règles, c'était des
 * secondes de regex à chaque chargement du catalogue.
 */
export function rulesForKeyword(name) {
  const w = String(name).toLowerCase();
  const out = [];
  for (let i = 0; i < RULES.length; i++) if (RULES[i].re.test(w)) out.push(i);
  return out;
}

/** Les attaques d'une carte, à partir des règles touchées par ses mots-clés. */
export function movesFromRules(gameId, ruleSet, genres = []) {
  const hits = [];
  for (const i of [...ruleSet].sort((x, y) => x - y)) {
    const r = RULES[i];
    if (r.when && !r.when.some((g) => genres.includes(g))) continue;
    hits.push(i);
    if (hits.length === 2) break;
  }
  const pick = (i) => {
    const r = RULES[i];
    return { name: r.names[hash(gameId, i) % r.names.length], of: r.of };
  };
  return hits.length ? { a: pick(hits[0]), b: hits[1] != null ? pick(hits[1]) : null } : null;
}

/** Version directe (quelques jeux) : mots-clés en clair → attaques. */
export function tagMoves(gameId, keywordNames, genres = []) {
  const set = new Set(keywordNames.flatMap(rulesForKeyword));
  return movesFromRules(gameId, set, genres);
}
