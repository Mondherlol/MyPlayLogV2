// ======================================================================
//  Le vivier des mots du jour.
// ======================================================================
// Le dictionnaire des mots ACCEPTÉS en saisie fait ~50 000 entrées et sort tout
// seul de la liste de fréquence (scripts/buildMotsDict.js). Mais le mot À
// DEVINER, lui, est choisi à la main. Trois raisons :
//
//   - Un mot du jour doit être CONCRET. « donjon », « orage », « cuisine » ont
//     un voisinage riche où l'on chauffe progressivement. « selon », « environ »,
//     « tel » n'ont aucun voisinage exploitable : la partie serait injouable.
//
//   - Il doit être CONNU DE TOUS. Prendre la liste de fréquence à l'aveugle
//     ferait tomber des formes fléchies rares et du vocabulaire technique.
//
//   - Il doit être DEVINABLE EN FRANÇAIS, sans ambiguïté de saisie : pas de
//     trait d'union, pas d'apostrophe, pas d'homographe piégeux.
//
// Les mots sont écrits avec leurs accents (le dictionnaire les conserve). Un mot
// absent du dictionnaire construit est signalé par le script de build et ne sera
// jamais tiré — ajouter un mot ici est donc sans risque.
//
// Ordre indifférent : le tirage est déterministe à partir de la date (voir
// lib/mots.js → wordForDate), et l'historique des mots déjà sortis empêche les
// répétitions.

export const MOTS_POOL = [
  // --- Animaux ---
  "chien", "chat", "cheval", "lion", "tigre", "ours", "loup", "renard", "lapin",
  "souris", "oiseau", "aigle", "corbeau", "hibou", "poule", "canard", "cygne",
  "pigeon", "poisson", "requin", "baleine", "dauphin", "pieuvre", "crabe",
  "serpent", "lézard", "crocodile", "tortue", "grenouille", "araignée",
  "fourmi", "abeille", "papillon", "mouche", "escargot", "vache", "taureau",
  "cochon", "mouton", "chèvre", "singe", "éléphant", "girafe", "zèbre",
  "chameau", "panda", "écureuil", "hérisson", "castor", "phoque", "pingouin",
  "autruche", "perroquet", "moineau", "hirondelle", "faucon", "vautour",
  "panthère", "guépard", "léopard", "lynx", "gazelle", "bison", "sanglier",
  "cerf", "biche", "renne", "loutre", "marmotte", "hamster", "saumon",
  "truite", "thon", "méduse", "corail", "huître", "homard", "chenille",
  "sauterelle", "libellule", "coccinelle", "scorpion", "limace", "essaim",
  "meute", "troupeau", "nid", "plume", "griffe", "crinière", "écaille",

  // --- Nature, paysages ---
  "forêt", "arbre", "feuille", "racine", "branche", "écorce", "fleur", "rose",
  "tulipe", "orchidée", "marguerite", "herbe", "mousse", "champignon", "fougère",
  "buisson", "haie", "verger", "prairie", "champ", "colline", "montagne",
  "sommet", "vallée", "falaise", "grotte", "caverne", "rocher", "pierre",
  "caillou", "sable", "dune", "désert", "oasis", "plage", "océan", "mer",
  "vague", "marée", "rivière", "fleuve", "ruisseau", "cascade", "lac", "étang",
  "marais", "source", "île",  "volcan", "lave", "cratère", "glacier",
  "banquise", "toundra", "savane", "jungle", "bambou", "cactus", "palmier",
  "chêne", "sapin", "bouleau", "saule", "olivier", "vigne", "blé", "maïs",
  "récolte", "moisson", "graine", "bourgeon", "épine", "pétale", "pollen",

  // --- Météo, ciel, temps ---
  "soleil", "lune", "étoile", "planète", "comète", "météore", "galaxie",
  "univers", "cosmos", "orbite", "éclipse", "aurore", "crépuscule", "aube",
  "nuit", "midi", "saison", "printemps", "été", "automne", "hiver", "pluie",
  "orage", "tonnerre", "éclair", "foudre", "tempête", "ouragan", "tornade",
  "vent", "brise", "nuage", "brouillard", "brume", "rosée", "neige", "flocon",
  "givre", "glace", "grêle", "verglas", "canicule", "sécheresse", "inondation",
   "horizon", "climat",

  // --- Corps, sens ---
  "corps", "tête", "visage", "front", "joue", "menton", "oreille", "bouche",
  "lèvre", "langue", "dent", "gorge", "cou", "épaule", "bras", "coude",
  "poignet", "main", "doigt", "pouce", "ongle", "poitrine", "ventre", "dos",
  "hanche", "jambe", "genou", "cheville", "pied", "talon", "peau", "cheveu",
  "barbe", "sourcil", "cil", "muscle", "tendon",  "squelette", "crâne",
  "cerveau", "coeur", "poumon", "foie", "rein", "estomac", "sang", "veine",
  "nerf", "souffle", "voix", "regard", "sourire", "larme", "sueur", "geste",

  // --- Émotions, esprit ---
  "amour", "amitié", "haine", "colère", "peur", "terreur", "angoisse", "joie",
  "bonheur", "tristesse", "chagrin", "nostalgie", "espoir", "désir", "envie",
  "jalousie", "honte", "orgueil", "fierté", "courage", "audace", "lâcheté",
  "patience", "curiosité", "surprise", "étonnement", "ennui", "fatigue",
  "solitude", "silence", "rêve", "cauchemar", "souvenir", "mémoire", "oubli",
  "pensée", "idée", "doute", "certitude", "secret", "mensonge", "vérité",
  "justice", "liberté", "destin", "hasard", "chance", "malheur", "folie",
  "sagesse", "génie", "talent", "instinct", "intuition", "conscience",

  // --- Maison, objets ---
  "maison", "cabane", "chalet", "château", "palais", "tour", "donjon",
  "muraille", "rempart", "pont", "porte", "fenêtre", "volet", "toit",
  "cheminée", "escalier", "couloir", "cave", "grenier", "chambre", "cuisine",
  "salon", "jardin", "balcon", "terrasse", "clôture", "serrure", "clé",
  "table", "chaise", "fauteuil", "canapé", "lit", "oreiller", "couverture",
  "armoire", "tiroir", "étagère", "miroir", "tapis", "rideau", "lampe",
  "bougie", "lanterne", "horloge", "pendule", "sablier", "coffre", "malle",
  "panier", "seau", "balai", "échelle", "marteau", "clou", "vis", "tournevis",
  "scie", "hache", "pelle", "corde", "chaîne", "crochet", "aiguille", "fil",
  "ciseaux", "couteau", "fourchette", "cuillère", "assiette", "bol", "tasse",
  "verre", "bouteille", "carafe", "casserole", "poêle", "four", "bocal",

  // --- Nourriture ---
  "pain", "beurre", "fromage", "lait", "oeuf", "farine", "sucre", "sel",
  "poivre", "épice", "huile", "vinaigre", "miel", "confiture", "chocolat",
  "gâteau", "tarte", "biscuit", "crêpe", "glace", "bonbon", "soupe", "salade",
  "riz", "pâtes", "viande", "poulet", "jambon", "saucisse", "pomme", "poire",
  "banane", "orange", "citron", "fraise", "framboise", "cerise", "raisin",
  "pêche", "abricot", "prune", "melon", "ananas", "mangue", "noix", "amande",
  "châtaigne", "carotte", "patate", "tomate", "oignon", "ail", "salade",
  "courgette", "aubergine", "poivron", "haricot",  "épinard",
  "chou", "navet", "radis", "concombre", "persil", "basilic", "menthe",
  "vin", "bière", "cidre", "café", "thé", "jus", "sirop", "eau",

  // --- Ville, société ---
  "ville", "village", "quartier", "rue", "ruelle", "avenue", "boulevard",
  "place", "marché", "boutique", "magasin", "usine", "atelier", "bureau",
  "école", "collège", "université", "bibliothèque", "musée", "théâtre",
  "cinéma", "stade", "piscine", "gare", "aéroport", "port", "phare", "hôpital",
  "pharmacie", "église", "cathédrale", "chapelle", "temple", "mosquée",
  "cimetière", "prison", "caserne", "mairie", "banque", "hôtel", "auberge",
  "restaurant", "cantine", "boulangerie", "librairie", "kiosque", "fontaine",
  "statue", "monument", "ruine", "vestige",

  // --- Transport ---
  "voiture", "camion", "autobus", "train", "métro", "tramway", "vélo",
  "moto", "scooter", "avion", "hélicoptère", "fusée", "navette", "bateau",
  "voilier", "barque", "canoë", "radeau",  "paquebot", "ferry",
  "traîneau", "charrette", "carrosse", "roue", "moteur", "volant", "frein",
  "pneu", "essence", "voile", "rame", "ancre", "mât", "hublot", "carte",
  "boussole", "voyage", "escale", "itinéraire", "sentier", "route", "autoroute",
  "tunnel", "viaduc", "carrefour", "trottoir", "passage",

  // --- Métiers ---
  "boulanger", "cuisinier", "serveur", "berger", "fermier", "pêcheur",
  "chasseur", "bûcheron", "mineur", "maçon", "charpentier", "menuisier",
  "forgeron", "serrurier", "plombier", "peintre", "sculpteur", "musicien",
  "chanteur", "danseur", "acteur", "clown", "magicien", "écrivain", "poète",
  "journaliste", "photographe", "libraire", "facteur", "policier", "pompier",
  "soldat", "marin", "pilote", "chauffeur", "médecin", "infirmier",
  "dentiste", "vétérinaire", "pharmacien", "avocat", "juge", "notaire",
  "banquier", "comptable", "ingénieur", "architecte", "informaticien",
  "professeur", "instituteur", "chercheur", "savant", "astronome", "biologiste",
  "archéologue", "explorateur", "aventurier", "espion", "détective", "voleur",
  "pirate", "bandit", "brigand", "mercenaire", "chevalier", "roi", "reine",
  "prince", "princesse", "empereur", "seigneur", "vassal", "paysan", "esclave",

  // --- Guerre, médiéval, fantasy ---
  "guerre", "bataille", "combat", "duel", "siège", "assaut", "embuscade",
  "victoire", "défaite", "trêve", "armée", "troupe", "légion", "bouclier",
  "épée", "lame", "dague", "poignard", "lance", "javelot", "hallebarde",
  "arc", "flèche", "arbalète", "carquois", "fronde", "catapulte", "bélier",
  "armure", "casque", "cuirasse", "gantelet", "éperon", "étendard",
  "bannière", "blason", "héraut", "tournoi", "joute", "arène", "gladiateur",
  "dragon", "griffon", "licorne", "sirène", "centaure", "minotaure", "sphinx",
  "gnome", "lutin", "elfe", "nain", "géant", "ogre", "troll", "gobelin",
  "orque", "zombie", "vampire",  "fantôme", "spectre", "démon",
  "ange", "titan", "sorcier", "sorcière", "mage", "druide", "prêtre",
  "oracle", "prophétie", "malédiction", "sortilège", "potion", "élixir",
  "grimoire", "parchemin", "runes", "amulette", "talisman", "relique",
  "trésor", "butin", "rançon", "quête", "légende", "mythe", "héros",
  "monstre", "bête", "créature", "labyrinthe", "piège", "énigme", "cachette",
  "crypte", "catacombe", "sanctuaire", "autel", "trône", "couronne", "sceptre",
  "royaume", "empire", "citadelle", "forteresse", "bastion", "cachot",

  // --- Jeu, jouet, hasard ---
  "jeu", "jouet", "poupée", "ballon", "toupie", "bille", 
  "puzzle", "domino", "échecs", "dames", "cartes", "atout",  "pion",
  "damier", "plateau", "manette", "console", "borne", "score", "manche",
  "tournoi", "champion", "trophée", "médaille", "podium", "record", "défi",
  "pari", "loterie", "tirage", "jackpot", "casino", "roulette", "bluff",

  // --- Sport ---
  "sport", "course", "sprint", "marathon", "relais", "saut", "escalade",
  "randonnée", "natation", "plongée", "surf", "voile", "aviron", "cyclisme",
  "football", "rugby", "basket", "handball", "tennis", "badminton", "golf",
  "hockey", "escrime", "boxe", "judo", "karaté", "lutte", "gymnastique",
  "danse", "patinage", "ski", "snowboard", "équitation", "tir", "pêche",
  "arbitre", "entraîneur", "équipe", "match", "penalty", "filet", "raquette",
  "crampon", "maillot", "vestiaire", "tribune", "supporter",

  // --- Art, musique, culture ---
  "art", "musique", "chanson", "mélodie", "rythme", "harmonie", "accord",
  "note", "gamme", "partition", "orchestre", "chorale", "concert", "récital",
  "guitare", "piano", "violon", "violoncelle", "harpe", "flûte", "clarinette",
  "trompette", "saxophone", "batterie", "tambour", "cymbale", "accordéon",
  "orgue", "synthétiseur", "microphone", "casque", "vinyle", "cassette",
  "peinture", "tableau", "toile", "pinceau", "palette", "esquisse", "fresque",
  "portrait", "paysage", "sculpture", "statuette", "poterie", "vitrail",
  "mosaïque", "gravure", "dessin", "croquis",  "roman", "nouvelle",
  "conte", "fable", "poème", "vers", "rime", "strophe", "chapitre", "prologue",
  "intrigue", "scénario", "réplique", "monologue", "tragédie", "comédie",
  "farce", "opéra", "ballet", "cirque", "spectacle", "coulisse", "décor",
  "costume", "masque", "maquillage", "projecteur", "caméra", "pellicule",

  // --- Vêtements ---
  "vêtement", "chemise", "pantalon", "jupe", "robe", "veste", "manteau",
  "blouson", "pull", "gilet", "écharpe", "bonnet", "chapeau", "casquette",
  "gant", "moufle", "ceinture", "bretelle", "chaussure", "botte", "sandale",
  "chausson", "chaussette", "lacet", "poche", "bouton", "fermeture", "tissu",
  "coton", "laine", "soie", "lin", "cuir", "dentelle", "velours", "broderie",
  "couture", "ourlet", "manche", "col", "capuche", "voile", "bijou",
  "bague", "collier", "bracelet", "boucle", "pendentif", "perle", "diadème",

  // --- Matériaux, couleurs ---
  "bois", "métal", "fer", "acier", "cuivre", "bronze", "laiton", "plomb",
  "étain", "zinc", "aluminium",  "argent", "platine", "diamant", "rubis",
  "saphir", "émeraude", "cristal", "quartz", "marbre", "granit", "ardoise",
  "argile", "béton", "ciment", "plâtre", "brique", "tuile", "papier", "carton",
  "plastique", "caoutchouc", "cire", "résine", "goudron", "charbon", "pétrole",
  "rouge", "bleu", "vert", "jaune", "orange", "violet", "rose", "brun",
  "noir", "blanc", "gris", "beige", "pourpre", "écarlate", "turquoise",
  "indigo", "ocre", "doré", "argenté", "sombre", "clair", "pâle", "vif",

  // --- Sciences, savoir ---
  "science", "physique", "chimie", "biologie", "géologie", "astronomie",
  "mathématique", "géométrie", "algèbre", "calcul", "chiffre", "nombre",
  "équation", "théorème", "formule", "hypothèse", "théorie", "expérience",
  "laboratoire", "microscope", "télescope", "éprouvette", "molécule", "atome",
  "électron", "noyau", "cellule", "gène", "microbe", "virus", "bactérie",
  "vaccin", "remède", "poison", "venin", "acide", "aimant", "électricité",
  "énergie", "chaleur", "lumière", "ombre", "reflet", "prisme", "spectre",
  "onde", "vitesse", "gravité", "pression", "poids", "masse", "volume",
  "densité", "température", "distance", "surface", "mesure", "balance",

  // --- Objets modernes, technique ---
  "machine", "outil", "engrenage", "levier", "ressort", "piston", "turbine",
  "moulin", "éolienne", "barrage", "pompe", "tuyau", "câble", "circuit",
  "batterie", "ampoule", "interrupteur", "antenne", "radar", "satellite",
  "ordinateur", "clavier", "écran", "souris", "imprimante", "téléphone",
  "radio", "télévision", "appareil", "montre", "réveil", "boussole",
  "jumelles", "loupe", "lunette", "thermomètre", "baromètre", "compteur",
  "robot", "drone", "capteur", "aimant", "moteur", "fusible", "écrou",

  // --- Actions, notions concrètes ---
  "chasse", "pêche", "cueillette", "récolte", "élevage", "culture", "labour",
  "construction", "démolition", "réparation", "invention", "découverte",
  "exploration", "expédition", "évasion", "poursuite", "enquête", "procès",
  "verdict", "sentence", "pardon", "vengeance", "trahison", "complot",
  "révolte", "révolution", "grève", "manifestation", "cortège", "défilé",
  "cérémonie", "mariage", "baptême", "anniversaire", "fête", "carnaval",
  "banquet", "festin", "veillée", "vacances", "voyage", "départ", "arrivée",
  "adieu", "retour", "rencontre", "promesse", "serment", "contrat", "traité",
  "alliance", "rivalité", "concurrence", "échange", "cadeau", "récompense",
  "punition", "épreuve", "entraînement", "leçon", "devoir", "examen",
  "diplôme", "métier", "carrière", "retraite", "héritage", "fortune",
  "richesse", "pauvreté", "dette", "impôt", "salaire", "monnaie", "pièce",
  "billet", "porte", "bourse", "marchandise", "cargaison", "entrepôt",

  // --- Abstractions parlantes ---
  "temps", "espace", "vide", "infini", "éternité", "instant", "durée",
  "début", "fin", "milieu", "bord", "centre", "sommet", "profondeur",
  "hauteur", "largeur", "longueur", "épaisseur", "forme", "figure", "cercle",
  "carré", "triangle", "losange", "sphère", "cube", "cône", "spirale",
  "ligne", "courbe", "angle", "pointe", "creux", "bosse", "trou", "fente",
  "fissure", "brèche", "frontière", "limite", "seuil", "obstacle", "barrière",
  "chemin", "direction", "sens", "ordre", "désordre", "chaos", "équilibre",
  "harmonie", "contraste", "symétrie", "motif", "modèle", "copie", "original",
  "détail", "ensemble", "partie", "fragment", "morceau", "miette", "poussière",
  "cendre", "fumée", "vapeur", "bulle", "goutte", "flaque", "torrent",
  "silence", "bruit", "écho", "murmure", "cri", "hurlement", "chuchotement",
  "parfum", "odeur", "saveur", "goût", "amertume", "douceur", "piquant",
  "chaleur", "froid", "tiédeur", "douleur", "plaisir", "faim", "soif",
];
