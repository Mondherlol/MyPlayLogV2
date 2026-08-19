import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Library,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  RefreshCw,
  Search,
  SearchX,
  X,
  Check,
  Link2,
  ImagePlus,
  ExternalLink,
  Save,
  Crop,
  AlertTriangle,
  ListVideo,
  CirclePlay,
  MonitorPlay,
  Antenna,
  Download,
  Eye,
  EyeOff,
  Ruler,
  BookOpen,
  Gamepad2,
  ClipboardPaste,
  Languages,
  Radar,
  Link2Off,
  CircleSlash2,
  Unplug,
  Coins,
  Hand,
  Disc3,
  Dices,
  PackageX,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { CM, CONSOLE, LICENCES, KINDS, PROVIDERS, boxOf } from "../lib/collection";
import WrapCropModal from "./WrapCropModal";
import PdfPagePicker, { isPdf } from "./PdfPagePicker";
import JaquettePicker from "./JaquettePicker";
import { Modal, Section } from "./AdminSheet";
import ComicModal, {
  ComicLookup,
  ReadDirection,
  applyComicPick,
} from "./AdminComicModal";
import GameModal from "./AdminGameModal";
import IgdbPicker from "./AdminIgdbPicker";
import { shrinkImageFile, fmtBytes } from "../lib/imageFile";

// L'essai d'un boîtier (bouton « Tester » de la liste). Chargé à la demande :
// il traîne derrière lui toute la scène 3D du rayon.
const CasePreview = lazy(() => import("./AdminCasePreview"));
const CaseStudio = lazy(() => import("./CaseStudioModal"));

// ------------------------------------------------ d'où vient une adresse ----
//
// UN SEUL CHAMP, ET C'EST L'ADRESSE QUI DIT CE QU'ELLE EST. Il a fallu, un
// temps, choisir « YouTube » ou « Autre lecteur » sur deux grandes cartes AVANT
// de coller quoi que ce soit : une question posée à l'admin alors que le lien
// qu'il avait déjà dans le presse-papier portait la réponse. Le serveur, lui,
// ne l'a jamais posée — `/import/link` reconnaît la fiche à son adresse, et
// c'est exactement ce qu'on fait ici.
//
// Restent ces trois pastilles, qui ne se choisissent plus : elles DISENT CE QUI
// EST COMPATIBLE (la question qu'on se pose vraiment devant un champ vide :
// « qu'est-ce que je peux lui donner ? »), s'allument quand l'adresse collée
// leur correspond, et mènent au site quand on les clique — c'est de là qu'on
// revient avec le lien.
const SOURCE_SITES = [
  {
    value: "youtube",
    label: "YouTube",
    Icon: CirclePlay,
    href: "https://www.youtube.com",
    hint: "Une vidéo ou une playlist : les épisodes suivent tout seuls, et la progression se suit à la seconde.",
    test: (u) => /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(u),
  },
  {
    value: "animesama",
    label: "Anime-Sama",
    Icon: ListVideo,
    href: "https://anime-sama.fr",
    hint: "La fiche d'un animé : toutes ses saisons et leurs épisodes d'un coup, VF ou VOSTFR.",
    test: (u) => /\/\/(?:[a-z0-9-]+\.)*anime-sama\.[a-z]{2,6}(?:[/:?#]|$)/i.test(u),
  },
  {
    value: "stream",
    label: "Site de streaming",
    Icon: MonitorPlay,
    // Le domaine de ces sites change tous les six mois : le lien est une piste,
    // pas une adresse gravée. La reconnaissance, elle, ne dépend d'aucun nom de
    // site (voir lib/filmIndex.js côté serveur) — n'importe quelle fiche de film
    // ou de série passe par là.
    href: "https://french-stream.one",
    hint: "French Stream & compagnie : la fiche d'un film ou d'une série, dont on relève les lecteurs.",
    test: (u) => /^https?:\/\//i.test(u),
  },
];

// Laquelle de ces familles ? `null` tant qu'on n'a rien de reconnaissable —
// l'ordre compte, la dernière attrape tout ce qui ressemble à une adresse.
function detectSource(url) {
  const u = String(url || "").trim();
  return (u && SOURCE_SITES.find((s) => s.test(u))) || null;
}

// YouTube décide du LECTEUR (`provider`), donc de la forme du reste du
// formulaire : une playlist qu'on pilote d'un côté, une liste de liens vers des
// hébergeurs tiers de l'autre.
const isYoutubeUrl = (u) => detectSource(u)?.value === "youtube";

// Les pastilles de compatibilité, au-dessus du champ. Purement indicatives —
// rien ici ne se « sélectionne », l'adresse tranche toute seule.
function SourceSites({ url }) {
  const on = detectSource(url)?.value;
  return (
    <div className="adm-coll-sites">
      {SOURCE_SITES.map((s) => (
        <a
          key={s.value}
          className={`adm-coll-site clickable ${on === s.value ? "on" : ""}`}
          href={s.href}
          target="_blank"
          rel="noreferrer"
          title={`${s.hint}\n\nOuvrir le site pour y chercher le titre.`}
        >
          <s.Icon size={14} />
          {s.label}
          <ExternalLink size={11} className="adm-coll-site-out" />
        </a>
      ))}
    </div>
  );
}

// ======================================================================
//  Onglet Collection — gestion des boîtiers (séries, films, animés)
// ======================================================================
// Tout part d'un LIEN de streaming : on le colle, on vérifie l'aperçu YouTube
// (bonne playlist ? bon nombre d'épisodes ?), on rattache éventuellement le
// titre à une fiche externe (TVmaze pour les séries, Wikipédia pour les films),
// et l'enrichissement fait le reste — synopsis, casting, visuels, titres
// d'épisodes.
//
// Ensuite chaque boîtier reste modifiable à la main : le support (VHS/DVD), la
// teinte de la tranche, la provenance affichée, les visuels. Les épisodes et la
// progression des joueurs, eux, ne se touchent que par « rafraîchir ».

const TINTS = [
  "#f2b70b",
  "#e0342b",
  "#2f6bf2",
  "#16a34a",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#f97316",
  "#64748b",
  "#111827",
];

// ----------------------------------------------------- rechercher & filtrer --
//
// L'étagère se remplit vite, et un panneau d'admin sert justement à retrouver
// LE titre qu'on vient corriger. Tout se joue en mémoire : la liste complète
// est déjà là (une seule requête sert tout l'onglet), donc filtrer ne coûte
// rien et répond à la frappe — pas de requête par lettre tapée, pas d'attente.

// Normalisation pour la recherche : minuscules + sans accents (marques
// combinantes U+0300–U+036F retirées après décomposition NFD). Sans elle, un
// rayon francophone ne se cherche pas : « pokemon » ne trouverait pas
// « Pokémon », et personne ne tape les accents dans un champ de recherche.
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Ce dans quoi on cherche. Le SLUG en fait partie : c'est ce qu'on a sous les
// yeux quand on débogue une URL ou qu'on lit un journal du serveur, et c'est
// parfois la seule forme du titre qu'on ait sous la main. Le code de la
// cartouche aussi, pour la même raison.
const haystack = (m) =>
  norm(
    [
      m.title,
      m.originalTitle,
      m.franchise,
      m.slug,
      m.publisher,
      m.channel,
      m.year,
      m.cartridge?.code,
      ...(m.authors || []),
      ...(m.genres || []),
    ]
      .filter(Boolean)
      .join(" ")
  );

// Les supports, dans l'ordre où ils se lisent sur l'étagère.
const KIND_CHIPS = [
  { value: "", label: "Tout" },
  ...Object.entries(KINDS).map(([value, k]) => ({ value, label: k.plural })),
];

// Ce qui SE REGARDE, donc ce qui a des liens à contrôler : le papier est un
// dossier de planches chez nous, la cartouche un fichier sur notre disque — ni
// l'un ni l'autre ne dépend d'un hébergeur qui peut fermer du jour au lendemain.
const WATCHABLE = ["series", "film"];

// « il y a 3 j » — la fraîcheur du dernier contrôle, rien de plus précis : ce
// qu'on veut savoir, c'est si ça date d'hier ou de l'été dernier.
function sinceLabel(date) {
  if (!date) return null;
  const min = Math.round((Date.now() - new Date(date).getTime()) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 60 * 24) return `il y a ${Math.floor(min / 60)} h`;
  const days = Math.floor(min / 1440);
  if (days < 30) return `il y a ${days} j`;
  return `le ${new Date(date).toLocaleDateString("fr-FR")}`;
}

// CE QUI REND UN BOÎTIER BANCAL. Ce ne sont pas des catégories mais des
// DÉFAUTS RÉPARABLES, tous depuis ce panneau : le filtre sert à ouvrir sa
// liste de corrections, pas à ranger le rayon. Un catalogue de cent titres
// cache toujours trois boîtiers sans jaquette, et rien ne les signale tant
// qu'on ne tombe pas dessus par hasard.
const FLAWS = [
  { value: "", label: "Tous les états" },
  {
    value: "norom",
    label: "Sans cartouche",
    hint: "Boîtiers de jeu sans fichier .gba : ils se rangent, mais ne se lancent pas.",
    test: (m) => m.kind === "game" && !m.cartridge?.rom,
  },
  {
    value: "nowrap",
    label: "Sans jaquette",
    hint: "Aucune jaquette dépliée : le boîtier est peint à partir de l'affiche.",
    test: (m) => !m.wrap,
  },
  {
    value: "nobox",
    label: "Non mesuré",
    hint: "Aucune dimension relevée : le boîtier retombe sur le gabarit DVD.",
    test: (m) => !m.box?.w,
  },
  {
    value: "external",
    label: "Lecteur externe",
    hint: "Liste tenue à la main : c'est elle qui casse quand un hébergeur tombe.",
    test: (m) => m.provider && m.provider !== "youtube",
  },
  {
    value: "nosource",
    label: "Sans lecteur",
    hint: "Séries et films dont il ne reste aucun épisode lisible — le boîtier s'ouvre sur rien.",
    test: (m) => WATCHABLE.includes(m.kind) && !m.episodeCount,
  },
  {
    value: "unchecked",
    label: "Jamais vérifiés",
    hint: "Leurs liens n'ont jamais été contrôlés : c'est là que dorment les hébergeurs tombés.",
    test: (m) => WATCHABLE.includes(m.kind) && m.episodeCount > 0 && !m.sourceCheck,
  },
];

// ------------------------------------------------------------------ trier --
//
// L'ÉTAGÈRE SE LIT DANS UN SENS, CE PANNEAU DANS L'AUTRE. Le rayon public range
// par `order` puis par ancienneté : c'est une vitrine, elle se compose. Ici on
// vient FINIR ce qu'on vient de poser — la jaquette qu'on n'avait pas sous la
// main, la cartouche restée sur le disque, le rattachement qu'on remet à plus
// tard. Le dernier arrivé passe donc devant : autrement il faut faire défiler
// tout le catalogue pour retomber sur le boîtier d'il y a deux minutes.
//
// Les autres ordres ne sont pas là pour ranger mais pour OUVRIR UNE FILE DE
// TRAVAIL, comme les états plus haut : le plus vieux du rayon, le contrôle le
// plus ancien. Le tri n'est donc pas un filtre — « Tout afficher » ne le remet
// pas à zéro, il ne cache rien.

// Comparaison de titres à la française : « Émile » se range à E, et « Saison 2 »
// avant « Saison 10 » (`numeric`) — un catalogue plein de tomes et de saisons se
// trie faux sans ça.
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const at = (d) => (d ? new Date(d).getTime() : 0);

// Ce qui ne se regarde pas n'a aucun lien à contrôler (le papier est chez nous,
// la cartouche aussi) : ces boîtiers ferment la file du vérificateur au lieu de
// la remplir. Infinity plutôt qu'une grande valeur, et comparé à l'égalité —
// `Infinity - Infinity` vaut NaN, et un comparateur qui rend NaN trie au hasard.
const checkRank = (m) => (WATCHABLE.includes(m.kind) ? at(m.sourceCheck?.at) : Infinity);

const SORTS = [
  {
    value: "recent",
    label: "Derniers ajoutés",
    hint: "Le dernier boîtier posé en premier — l'ordre par défaut de ce panneau.",
    cmp: (a, b) => at(b.createdAt) - at(a.createdAt),
  },
  {
    value: "oldest",
    label: "Premiers ajoutés",
    hint: "Le fond du rayon d'abord : ceux dont les liens ont eu le temps de pourrir.",
    cmp: (a, b) => at(a.createdAt) - at(b.createdAt),
  },
  {
    value: "title",
    label: "Titre (A → Z)",
    hint: "Alphabétique, accents et numéros de tome compris.",
    cmp: (a, b) => collator.compare(a.title || "", b.title || ""),
  },
  {
    value: "year",
    label: "Année (récente d'abord)",
    hint: "L'année de l'œuvre, pas celle de l'ajout. Les titres sans année ferment la liste.",
    cmp: (a, b) => (b.year || 0) - (a.year || 0),
  },
  {
    value: "check",
    label: "Contrôle le plus ancien",
    hint: "La file d'attente du vérificateur de liens : jamais contrôlés en tête, papier et jeux à la fin.",
    cmp: (a, b) => {
      const ra = checkRank(a);
      const rb = checkRank(b);
      return ra === rb ? 0 : ra - rb;
    },
  },
];

const EMPTY_DRAFT = {
  // `provider` décide de la façon d'alimenter le boîtier : une URL YouTube qu'on
  // scrape, ou une LISTE de liens qu'on colle (une ligne par épisode). Voir
  // lib/collection.js côté serveur.
  //
  // Il ne se choisit plus : l'adresse collée le pose (voir `detectSource`). Au
  // départ, c'est donc la liste qui est ouverte — un formulaire vierge doit
  // laisser la possibilité de tout écrire à la main, sans rien avoir à coller.
  provider: "embed",
  url: "",
  episodesText: "",
  poster: "", // affiche rapatriée à l'enregistrement (import d'un répertoire)
  backdrop: "", // bandeau, quand la fiche d'origine en donne un
  synopsis: "",
  genres: [],
  year: "",
  tmdbRef: "", // fiche TMDB choisie à la main (« tv:1399 »)
  langs: [], // pistes annoncées par la source (« vf », « vostfr »)
  title: "",
  kind: "series",
  format: "dvd",

  licence: "official",
  franchise: "",
  color: "#f2b70b",
  tagline: "",
  tvmazeQuery: "",
  wikiTitle: "",
};

// UN FILM TIENT SUR UNE LIGNE : son titre, puis toutes ses adresses — la
// première est le lecteur par défaut, les suivantes ses miroirs. D'où cette
// fusion plutôt qu'un remplacement : une fiche qui ne monte ses lecteurs qu'au
// clic ne se laisse lire qu'un lecteur à la fois, et chaque import successif
// doit AJOUTER son adresse aux précédentes au lieu d'effacer les autres.
//
// SAUF QUAND LE FILM EN A DEUX. « The Dark Knight Returns » est sorti en deux
// parties, chacune avec sa fiche et ses lecteurs chez l'hébergeur : ce ne sont
// NI deux miroirs (ils ne montrent pas le même film, et le poste passerait de
// l'un à l'autre en croyant changer de source), NI deux titres (c'est un seul
// boîtier sur l'étagère). Ce sont deux PARTIES, rangées exactement comme les
// épisodes d'une série — la fiche sait déjà les afficher (voir `soloFilm` dans
// CollectionDetail : un film à plusieurs entrées garde sa liste).
//
// D'où le NUMÉRO DE PARTIE : il désigne LA LIGNE à écrire, et aucune autre ne
// bouge. Sur cette ligne, les adresses se cumulent comme avant.
const EP_MARK = /^s\s*(\d{1,2})\s*[·.\-–]?\s*e\s*\.?\s*(\d{1,3})\b/i;
// Une adresse, avec la marque de piste qui la précède parfois (« vf@https://… ») :
// la perdre en relisant la ligne effacerait la version d'à côté.
const TAGGED_URL_G = /(?:[a-z]{2,6}@)?https?:\/\/\S+/g;

function mergeFilmPart(text, title, urls, part = 1) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Une liste écrite avant les parties n'a pas de repère : sa position fait
  // office de numéro, et la première ligne reste donc la partie 1.
  const numOf = (line, i) => Number(line.match(EP_MARK)?.[2] ?? i + 1);
  const at = lines.findIndex((l, i) => numOf(l, i) === part);
  const old = at >= 0 ? lines[at] : "";
  const all = [...new Set([...(old.match(TAGGED_URL_G) || []), ...urls])];
  if (!all.length) return text;
  // L'étiquette déjà écrite l'emporte : elle a pu être corrigée à la main.
  const cut = old.search(/(?:[a-z]{2,6}@)?https?:\/\//i);
  const label =
    (cut < 0 ? old : old.slice(0, cut))
      .replace(EP_MARK, "")
      .replace(/[—–|:-]+\s*$/, "")
      .trim() ||
    (part > 1 ? `Partie ${part}` : title || "");
  const head = [`S01E${String(part).padStart(2, "0")}`, label].filter(Boolean).join(" ");
  const line = `${head} — ${all.join(" | ")}`;
  const out = [...lines];
  if (at >= 0) out[at] = line;
  else out.push(line);
  return out.join("\n");
}

// Ce qu'on écrit dans la zone de liste quand elle est vide : le format y est
// plus clair qu'en le décrivant.
const LIST_PLACEHOLDER = `S01E01 Le premier épisode — vf@https://hebergeur/embed/aaa | vostfr@https://autre/embed/aaa
S01E02 — https://hebergeur/embed/bbb
https://hebergeur/embed/ccc`;

// L'interrupteur de la section. Éteinte, la page n'apparaît nulle part et
// l'API la refuse — sauf pour l'admin, qui doit bien pouvoir la garnir avant de
// l'ouvrir. C'est la même règle des deux côtés (lib/features.js côté serveur).
function VisibilitySwitch({ token }) {
  const { features, updateFeatures } = useAuth();
  const [busy, setBusy] = useState(false);
  const on = !!features.collection;

  async function toggle() {
    setBusy(true);
    try {
      const d = await apiFetch("/settings/features/collection", {
        method: "PATCH",
        token,
        body: { enabled: !on },
      });
      // La barre latérale suit tout de suite : pas de rechargement pour voir
      // le lien apparaître ou disparaître.
      updateFeatures(d.features);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`adm-coll-visib ${on ? "on" : ""}`}>
      <span className="adm-coll-visib-icon">
        {on ? <Eye size={17} /> : <EyeOff size={17} />}
      </span>
      <div className="adm-coll-visib-text">
        <strong>{on ? "Page ouverte à tous" : "Page masquée"}</strong>
        <span>
          {on
            ? "Le rayon vidéo apparaît dans la barre latérale de tout le monde."
            : "Personne ne voit le rayon, ni le lien ni la page. Toi si : c'est ici qu'on le garnit avant de l'ouvrir."}
        </span>
      </div>
      <button
        className={`admin-switch clickable ${on ? "on" : ""}`}
        onClick={toggle}
        disabled={busy}
        role="switch"
        aria-checked={on}
        aria-label="Afficher la page Collection"
      >
        <span className="admin-switch-knob">
          {busy && <Loader2 size={11} className="spin" />}
        </span>
      </button>
    </div>
  );
}

// Le prix d'un tour de manivelle. RÉGLABLE DEPUIS ICI, et pas une constante du
// serveur : équilibrer une économie de points demande de l'essayer — un prix
// trop haut et personne ne joue, trop bas et la collection se complète en une
// soirée. Le bon chiffre se trouve en le bougeant, pas en le décidant.
function GachaPrice({ token }) {
  const [price, setPrice] = useState(null); // null = pas encore lu
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  // Combien de boîtiers J'AI, pour que le bouton de remise à zéro dise ce
  // qu'il va effacer — et disparaisse quand il n'y a rien à effacer.
  const [mine, setMine] = useState(0);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    apiFetch("/collection/gacha", { token })
      .then((d) => {
        setPrice(d.price);
        setDraft(String(d.price));
        setMine(d.owned || 0);
      })
      .catch(() => setPrice(0));
  }, [token]);

  // VIDER SA PROPRE ÉTAGÈRE. Un outil de mise au point : régler une machine à
  // capsules demande de la voir se remplir, et une fois le rayon complété il
  // n'y a plus rien à tirer ni à regarder. Le serveur ne vide QUE l'étagère de
  // celui qui demande — il n'y a pas de paramètre d'utilisateur, donc pas de
  // façon de déposséder quelqu'un d'autre avec ce bouton.
  async function wipe() {
    if (
      !confirm(
        `Vider ta collection ?\n\n${mine} boîtier${mine > 1 ? "s" : ""} retourneront dans la machine.\n` +
          "Tes points ne sont PAS rendus, et ta progression sur les titres est conservée."
      )
    )
      return;
    setWiping(true);
    try {
      await apiFetch("/collection/gacha/mine", { method: "DELETE", token });
      setMine(0);
    } catch (e) {
      alert(e.message);
    } finally {
      setWiping(false);
    }
  }

  async function save() {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(true);
    try {
      const d = await apiFetch("/collection/gacha/price", {
        method: "PUT",
        token,
        body: { price: n },
      });
      setPrice(d.price);
      setDraft(String(d.price));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = price !== null && String(price) !== draft.trim();

  return (
    <div className="adm-coll-gacha">
      <span className="adm-coll-gacha-ic">
        <Coins size={17} />
      </span>
      <div className="adm-coll-gacha-text">
        <strong>Machine à capsules</strong>
        <span>
          Ce que coûte un tour de manivelle. Chaque tour sort un boîtier que le
          joueur n'a pas encore — jamais de doublon, donc il faut exactement
          autant de tours que de boîtiers au rayon pour tout débloquer.
        </span>
      </div>
      <div className="adm-coll-gacha-field">
        <input
          type="number"
          min="0"
          step="10"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && !busy && save()}
          aria-label="Prix d'un tirage, en points"
          disabled={price === null}
        />
        <em>points</em>
        <button
          className="btn btn-primary clickable"
          onClick={save}
          disabled={!dirty || busy}
        >
          {busy ? <Loader2 size={15} className="spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
          {saved ? "Enregistré" : "Enregistrer"}
        </button>
        {/* Mise au point : remettre SA propre étagère à zéro pour rejouer la
            machine. Rien à afficher quand elle est déjà vide. */}
        {mine > 0 && (
          <button
            className="adm-coll-wipe clickable"
            onClick={wipe}
            disabled={wiping}
            title={`Vider ta collection (${mine} boîtier${mine > 1 ? "s" : ""}) pour retester la machine`}
          >
            {wiping ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
            Vider ma collection
            <em>{mine}</em>
          </button>
        )}
      </div>
    </div>
  );
}

export default function CollectionPanel({ token }) {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // slug en cours d'édition
  const [creating, setCreating] = useState(false);
  const [addingComic, setAddingComic] = useState(false);
  const [addingGame, setAddingGame] = useState(false);

  // Rechercher, filtrer & trier (en mémoire, voir plus haut). Le tri n'entre
  // pas dans `filtering` : il ne masque rien, il n'y a donc rien à « remettre à
  // plat » quand on le change.
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [flaw, setFlaw] = useState("");
  const [sort, setSort] = useState("recent");
  const filtering = !!(q.trim() || kind || flaw);

  // LE CATALOGUE ENTIER, pas une collection. Depuis que les étagères sont
  // personnelles, « /collection » ne rend que les boîtiers du demandeur : ce
  // panneau travaille sur le RAYON, il a donc sa route à lui (réservée à
  // l'admin, voir routes/collection.js).
  function load() {
    setLoading(true);
    apiFetch("/collection/catalog", { token })
      .then((d) => setMedia(d.media || []))
      .catch(() => setMedia([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  // Combien de boîtiers par support : le chiffre est sur la pastille, et il
  // compte TOUT le rayon, jamais ce qui reste après filtrage — sinon la
  // pastille d'à côté tomberait à zéro dès qu'on en choisit une, et on ne
  // saurait plus si le rayon est vide ou seulement masqué.
  const counts = useMemo(() => {
    const c = {};
    for (const m of media) c[m.kind] = (c[m.kind] || 0) + 1;
    return c;
  }, [media]);

  const shown = useMemo(() => {
    const needle = norm(q.trim());
    const flawed = FLAWS.find((f) => f.value === flaw)?.test;
    const cmp = (SORTS.find((s) => s.value === sort) || SORTS[0]).cmp;
    return (
      media
        .filter((m) => {
          if (kind && m.kind !== kind) return false;
          if (flawed && !flawed(m)) return false;
          return !needle || haystack(m).includes(needle);
        })
        // `filter` a déjà rendu un tableau neuf : on trie dessus sans toucher à
        // la liste chargée. Le tri de JS étant stable, les égalités (deux titres
        // sans année, deux boîtiers jamais contrôlés) gardent l'ordre de
        // l'étagère plutôt que de se mélanger à chaque frappe.
        .sort(cmp)
    );
  }, [media, q, kind, flaw, sort]);

  function clearFilters() {
    setQ("");
    setKind("");
    setFlaw("");
  }

  const target = media.find((m) => m.slug === editing) || null;

  return (
    <div className="adm-coll">
      <VisibilitySwitch token={token} />
      <GachaPrice token={token} />

      <header className="adm-coll-head">
        <div>
          <h2>
            <Library size={18} /> Collection
          </h2>
          <p>
            {media.length} boîtier{media.length > 1 ? "s" : ""} sur l'étagère ·{" "}
            {media.reduce((n, m) => n + (m.episodeCount || 0), 0)} épisodes ·{" "}
            {media.reduce((n, m) => n + (m.pageCount || 0), 0)} planches ·{" "}
            {media.filter((m) => m.kind === "game").length} jeux
          </p>
        </div>
        <div className="adm-coll-head-btns">
          <button className="btn btn-ghost clickable" onClick={() => setAddingGame(true)}>
            <Gamepad2 size={16} /> Jeu GBA
          </button>
          <button className="btn btn-ghost clickable" onClick={() => setAddingComic(true)}>
            <BookOpen size={16} /> Comic / manga
          </button>
          <button className="btn btn-primary clickable" onClick={() => setCreating(true)}>
            <Plus size={16} /> Ajouter un titre
          </button>
        </div>
      </header>

      {/* ---------------- rechercher & filtrer ----------------
          Masquée sur une étagère vide : il n'y a rien à trier, et le champ
          n'inviterait qu'à chercher ce qui n'existe pas encore. */}
      {!loading && media.length > 0 && (
        <div className="au-toolbar adm-coll-toolbar">
          <div className="au-search">
            <Search size={16} />
            <input
              type="search"
              name="mpl-coll-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Titre, saga, éditeur, auteur, slug…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
            />
            {q && (
              <button
                className="au-search-clear clickable"
                onClick={() => setQ("")}
                aria-label="Effacer la recherche"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <div className="au-filters" role="group" aria-label="Filtrer par support">
            {KIND_CHIPS.map((c) => (
              <button
                key={c.value}
                className={`au-filter clickable ${kind === c.value ? "active" : ""}`}
                onClick={() => setKind(c.value)}
              >
                {c.label}
                <em className="adm-coll-chip-n">
                  {c.value ? counts[c.value] || 0 : media.length}
                </em>
              </button>
            ))}
          </div>

          <select
            className="adm-coll-select"
            value={flaw}
            onChange={(e) => setFlaw(e.target.value)}
            aria-label="Filtrer par état"
            title={FLAWS.find((f) => f.value === flaw)?.hint || "Ne montrer que les boîtiers à corriger"}
          >
            {FLAWS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <select
            className="adm-coll-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Trier"
            title={SORTS.find((s) => s.value === sort)?.hint || "Changer l'ordre de la liste"}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {filtering && (
            <button className="adm-coll-clear clickable" onClick={clearFilters}>
              <X size={13} /> {shown.length} sur {media.length}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="adm-coll-state">
          <Loader2 size={20} className="spin" /> Chargement…
        </div>
      ) : media.length === 0 ? (
        <div className="adm-coll-state">
          L'étagère est vide. Colle un lien YouTube pour poser le premier boîtier.
        </div>
      ) : shown.length === 0 ? (
        <div className="adm-coll-state col">
          <SearchX size={22} />
          <span>
            {flaw
              ? "Aucun boîtier dans cet état — rien à corriger de ce côté."
              : `Aucun titre ne correspond${q.trim() ? ` à « ${q.trim()} »` : ""}.`}
          </span>
          <button className="btn btn-ghost clickable" onClick={clearFilters}>
            Tout afficher
          </button>
        </div>
      ) : (
        <ul className="adm-coll-list">
          {shown.map((m) => (
            <Row
              key={m.slug}
              media={m}
              token={token}
              onEdit={() => setEditing(m.slug)}
              onChanged={load}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CreateModal
          token={token}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {addingComic && (
        <ComicModal
          token={token}
          onClose={() => setAddingComic(false)}
          onDone={() => {
            setAddingComic(false);
            load();
          }}
        />
      )}

      {addingGame && (
        <GameModal
          token={token}
          onClose={() => setAddingGame(false)}
          onDone={() => {
            setAddingGame(false);
            load();
          }}
        />
      )}

      {target && (
        <EditDrawer
          media={target}
          token={token}
          onClose={() => setEditing(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ligne --

function Row({ media, token, onEdit, onChanged }) {
  const [busy, setBusy] = useState(null); // "refresh" | "delete"
  const [checking, setChecking] = useState(false); // le vérificateur de liens
  // L'ESSAI. Le boîtier pris en main, exactement comme sur l'étagère — la seule
  // façon de voir ce qu'on vient de poser (voir AdminCasePreview).
  const [trying, setTrying] = useState(false);
  // LE STUDIO DE JAQUETTE (voir CaseStudioModal).
  const [studio, setStudio] = useState(false);
  // Un titre qui se regarde et qui a quelque chose à regarder : sans épisode,
  // il n'y a aucune porte à laquelle frapper.
  const watchable = WATCHABLE.includes(media.kind) && media.episodeCount > 0;
  // Ce qui se FABRIQUE en boîtier de DVD : un film sans épisode enregistré a
  // lui aussi une jaquette à composer, donc pas le même test que ci-dessus.
  const printable = WATCHABLE.includes(media.kind);
  const check = media.sourceCheck;
  // DANS LA MACHINE, OU NON. Lu en `!== false` : les fiches d'avant ce champ
  // n'ont pas la clé et doivent rester tirables.
  const lootable = media.lootable !== false;

  // L'ALLUMER OU L'ÉTEINDRE. Un seul champ change, donc un PATCH ordinaire —
  // et surtout PAS une route à part : c'est un réglage de la fiche, au même
  // titre que sa licence ou sa saga.
  //
  // Aucune confirmation : le geste est réversible d'un clic, et demander
  // « êtes-vous sûr ? » pour quelque chose qu'on peut défaire aussitôt est le
  // meilleur moyen de rendre pénible ce qu'on va faire vingt fois.
  async function toggleLoot() {
    setBusy("loot");
    try {
      await apiFetch(`/collection/${media.slug}`, {
        method: "PATCH",
        token,
        body: { lootable: !lootable },
      });
      onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      await apiFetch(`/collection/${media.slug}/refresh`, { method: "POST", token });
      onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Retirer « ${media.title} » de la collection ?\nLa progression des joueurs sur ce titre sera perdue.`
      )
    )
      return;
    setBusy("delete");
    try {
      await apiFetch(`/collection/${media.slug}`, { method: "DELETE", token });
      onChanged();
    } catch (e) {
      alert(e.message);
      setBusy(null);
    }
  }

  return (
    <li
      className={`adm-coll-row ${lootable ? "" : "off"}`}
      style={{ "--tint": media.color }}
    >
      <span className="adm-coll-thumb">
        {media.poster ? <img src={media.poster} alt="" /> : <Library size={18} />}
        <i className="adm-coll-spine" />
      </span>

      <div className="adm-coll-main">
        <strong>{media.title}</strong>
        <span className="adm-coll-meta">
          {/* Les DIMENSIONS plutôt que le mot « DVD » : tous les boîtiers sont
              des DVD, l'étiquette ne distinguait donc rien. La taille, elle,
              dit d'un coup d'œil si le titre a été mesuré sur sa jaquette. */}
          <em
            className={`adm-coll-pill ${media.box?.w ? "sized" : ""}`}
            title={
              media.box?.w
                ? "Dimensions relevées sur la jaquette dépliée"
                : "Gabarit DVD standard"
            }
          >
            <Ruler size={11} /> {fmtCm(boxOf(media).h)} cm
          </em>
          <em className="adm-coll-pill">{KINDS[media.kind]?.label}</em>
          <em className="adm-coll-pill">{LICENCES[media.licence]?.label}</em>
          {media.provider && media.provider !== "youtube" && (
            <em className="adm-coll-pill ext" title="Lecteur externe : liste tenue à la main">
              <MonitorPlay size={11} /> Externe
            </em>
          )}
          {/* UN BOÎTIER QUI S'OUVRE SUR RIEN. Après une purge, une série dont
              tous les hébergeurs ont fermé n'a plus un seul épisode : elle se
              range encore sur l'étagère mais ne se regarde plus. Autant que ça
              saute aux yeux depuis la liste. */}
          {WATCHABLE.includes(media.kind) && !media.episodeCount && (
            <em className="adm-coll-pill ext" title="Aucun épisode lisible : il ne reste aucune source">
              <Unplug size={11} /> Sans lecteur
            </em>
          )}
          {/* Ce que le dernier contrôle n'a pas su trancher : ces liens-là ne
              sont jamais purgés (l'hébergeur nous bloque, ou il était en
              panne), donc c'est à la main qu'on va voir. */}
          {check?.unknown > 0 && (
            <em
              className="adm-coll-pill warn"
              title={`${check.unknown} source${check.unknown > 1 ? "s" : ""} au verdict incertain — à ouvrir dans un navigateur`}
            >
              <CircleSlash2 size={11} /> {check.unknown} à voir
            </em>
          )}
          {/* Une cartouche absente est le seul défaut qui rend un boîtier de
              jeu inutilisable : il se range, s'inspecte, mais ne se lance pas.
              Ça se voit donc depuis la liste, sans ouvrir la fiche. */}
          {media.kind === "game" && !media.cartridge?.rom && (
            <em className="adm-coll-pill ext" title="Aucun fichier .gba déposé">
              <AlertTriangle size={11} /> Sans cartouche
            </em>
          )}
          {/* HORS MACHINE. La pastille passe AVANT la saga et le compte : ce
              n'est pas un détail de la fiche, c'est ce qui décide si le
              boîtier existe pour les joueurs qui ne l'ont pas encore. */}
          {!lootable && (
            <em
              className="adm-coll-pill off"
              title="Retiré de la machine à capsules : plus personne ne peut le tirer. Ceux qui l'ont déjà le gardent."
            >
              <PackageX size={11} /> Hors machine
            </em>
          )}
          {media.franchise && <span>{media.franchise}</span>}
          <span>
            {media.kind === "comic"
              ? `${media.pageCount} planche${media.pageCount > 1 ? "s" : ""}`
              : media.kind === "game"
                ? [
                    media.cartridge?.region,
                    media.cartridge?.bytes
                      ? `${Math.round(media.cartridge.bytes / 1024 / 1024)} Mo`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || CONSOLE
                : `${media.episodeCount} épisode${media.episodeCount > 1 ? "s" : ""}`}
          </span>
          {media.year && <span>{media.year}</span>}
        </span>
      </div>

      <div className="adm-coll-actions">
        {/* DANS LA MACHINE, OU AU DÉPÔT. Le premier bouton de la rangée parce
            que c'est l'état de l'objet, pas une opération qu'on lui fait
            subir — et parce qu'il faut pouvoir sortir un titre du tirage sans
            avoir à ouvrir quoi que ce soit. */}
        <button
          className={`adm-coll-icon clickable ${lootable ? "" : "off"}`}
          onClick={toggleLoot}
          disabled={!!busy}
          title={
            lootable
              ? "Dans la machine à capsules — cliquer pour l'en retirer"
              : "Hors machine : plus personne ne peut le tirer. Cliquer pour l'y remettre."
          }
        >
          {busy === "loot" ? (
            <Loader2 size={15} className="spin" />
          ) : lootable ? (
            <Dices size={15} />
          ) : (
            <PackageX size={15} />
          )}
        </button>
        {/* TESTER — prendre le boîtier en main, sans quitter le panneau et sans
            avoir à le posséder. C'est le seul endroit où l'on voit ce qu'on
            vient de faire : la jaquette pliée sur ses trois faces, la tranche
            là où on l'a mise, le titre lisible ou non sur le dos. */}
        <button
          className="adm-coll-icon clickable"
          onClick={() => setTrying(true)}
          title="Tester — prendre le boîtier en main, comme sur l'étagère"
        >
          <Hand size={15} />
        </button>
        {/* LE STUDIO DE JAQUETTE. Réservé au rayon vidéo : le gabarit qu'il
            règle est celui d'un boîtier de DVD (logo, sommaire, zone, code-
            barres), et rien de tout ça n'a de sens sur un volume relié ou une
            boîte de cartouche. */}
        {printable && (
          <button
            className="adm-coll-icon clickable"
            onClick={() => setStudio(true)}
            title="Studio de jaquette — logo, sommaire, mentions du boîtier"
          >
            <Disc3 size={15} />
          </button>
        )}
        <a
          className="adm-coll-icon clickable"
          href={`/collection/${media.slug}`}
          target="_blank"
          rel="noreferrer"
          title="Voir la fiche"
        >
          <ExternalLink size={15} />
        </a>
        {/* LE VÉRIFICATEUR DE LIENS. Réservé à ce qui se regarde : c'est le
            seul rayon dont le contenu vit chez quelqu'un d'autre, et qui peut
            donc s'éteindre sans prévenir. */}
        {watchable && (
          <button
            className="adm-coll-icon clickable"
            onClick={() => setChecking(true)}
            disabled={!!busy}
            title={
              check?.at
                ? `Vérifier les sources — dernier contrôle ${sinceLabel(check.at)}`
                : "Vérifier les sources et retirer les liens morts"
            }
          >
            <Radar size={15} />
          </button>
        )}
        {/* Rien à ré-enrichir sur un jeu : sa fiche ne vient pas d'une source
            de streaming mais de la cartouche, et celle-ci se remplace dans le
            tiroir d'édition. Le bouton n'aurait fait qu'échouer. */}
        {media.kind !== "game" && (
          <button
            className="adm-coll-icon clickable"
            onClick={refresh}
            disabled={!!busy}
            title="Ré-enrichir depuis les sources (nouveaux épisodes, métadonnées)"
          >
            {busy === "refresh" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
          </button>
        )}
        <button className="adm-coll-icon clickable" onClick={onEdit} title="Modifier">
          <Pencil size={15} />
        </button>
        <button
          className="adm-coll-icon danger clickable"
          onClick={remove}
          disabled={!!busy}
          title="Retirer"
        >
          {busy === "delete" ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Trash2 size={15} />
          )}
        </button>
      </div>

      {checking && (
        <SourceCheck
          media={media}
          token={token}
          onClose={() => setChecking(false)}
          onChanged={onChanged}
        />
      )}

      {/* La vitrine 3D descend à la demande : la scène, three.js et le lecteur
          de volumes n'ont rien à faire dans le paquet d'un panneau d'admin. */}
      {trying && (
        <Suspense fallback={null}>
          <CasePreview media={media} token={token} onClose={() => setTrying(false)} />
        </Suspense>
      )}

      {/* Le studio descend lui aussi à la demande : il embarque le peintre de
          jaquettes, dont le panneau n'a pas besoin tant qu'on ne fabrique pas
          une couverture. */}
      {studio && (
        <Suspense fallback={null}>
          <CaseStudio
            media={media}
            token={token}
            onClose={() => setStudio(false)}
            onChanged={onChanged}
          />
        </Suspense>
      )}
    </li>
  );
}

// ------------------------------------------------- vérificateur de liens ----
//
// L'ENTRETIEN D'UN RAYON QU'ON N'HÉBERGE PAS. Une série posée il y a six mois
// a perdu la moitié de ses liens sans que rien ne le dise : les hébergeurs
// effacent, expirent, ferment. Ce panneau frappe à chaque porte et rend le
// compte des portes qui ne s'ouvrent plus.
//
// EN DEUX TEMPS, exprès. Le contrôle ne touche à rien : il montre. La purge ne
// part qu'ensuite, sur un bouton, une fois qu'on a lu ce qu'on s'apprête à
// perdre — « trois miroirs morts » et « douze épisodes qui n'auront plus aucun
// lecteur » ne se décident pas de la même façon.
//
// ET SEULEMENT CE QUI EST MORT SANS DISCUSSION (404, domaine éteint, « file
// was deleted » écrit dans la page). Un hébergeur qui nous bloque ou qui était
// en panne repart en « à vérifier » : il reste en place, et c'est à l'humain
// d'aller voir. Un lien mort de trop coûte un clic sur « source suivante », un
// lien vivant effacé coûte un épisode.

const STATES = {
  alive: { label: "vivante", Icon: Check, cls: "ok" },
  dead: { label: "morte", Icon: Link2Off, cls: "dead" },
  unknown: { label: "à vérifier", Icon: CircleSlash2, cls: "warn" },
};

function SourceCheck({ media, token, onClose, onChanged }) {
  const [phase, setPhase] = useState("checking"); // checking | ready | purging | done
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/collection/${media.slug}/sources/check`, { method: "POST", token })
      .then((d) => {
        if (!alive) return;
        setReport(d.report);
        setPhase("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setPhase("ready");
      });
    return () => {
      alive = false;
    };
  }, [media.slug, token]);

  async function purge() {
    setPhase("purging");
    setError(null);
    try {
      const d = await apiFetch(`/collection/${media.slug}/sources/purge`, {
        method: "POST",
        token,
      });
      setResult(d);
      setPhase("done");
      onChanged();
    } catch (e) {
      setError(e.message);
      setPhase("ready");
    }
  }

  const doomed = report?.doomed?.length || 0;
  const dead = report?.dead || 0;

  return (
    <Modal
      title="Vérifier les sources"
      subtitle={media.title}
      thumb={media.poster}
      Icon={Radar}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="adm-coll-error">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : (
            <p className="adm-coll-hint">
              Seules les sources mortes sans discussion sont retirées. Celles que
              le contrôle n'a pas su trancher restent en place.
            </p>
          )}
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onClose}>
              {phase === "done" ? "Fermer" : "Annuler"}
            </button>
            {phase !== "done" && (
              <button
                className="btn btn-primary clickable"
                onClick={purge}
                disabled={phase !== "ready" || !dead}
                title={
                  dead
                    ? "Retirer les liens morts, et les épisodes qui n'en ont plus aucun"
                    : "Rien à retirer"
                }
              >
                {phase === "purging" ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Link2Off size={16} />
                )}
                {phase === "checking"
                  ? "Vérification…"
                  : dead
                    ? `Retirer ${dead} source${dead > 1 ? "s" : ""} morte${dead > 1 ? "s" : ""}`
                    : "Rien à retirer"}
              </button>
            )}
          </div>
        </>
      }
    >
      {phase === "checking" && (
        <div className="adm-coll-state col">
          <Loader2 size={22} className="spin" />
          <span>
            On frappe à chaque porte — {media.episodeCount} épisode
            {media.episodeCount > 1 ? "s" : ""} et leurs miroirs. Un hébergeur
            silencieux prend jusqu'à neuf secondes à déclarer forfait : sur une
            longue série, compte une minute.
          </span>
        </div>
      )}

      {/* Le contrôle lui-même a échoué (serveur injoignable, titre supprimé
          entre-temps) : le pied porte déjà le message, la place ne doit pas
          rester vide pour autant. */}
      {phase === "ready" && !report && (
        <div className="adm-coll-state col">
          <Unplug size={22} />
          <span>Le contrôle n'a pas pu être mené. Referme et réessaie.</span>
        </div>
      )}

      {phase === "done" && result && (
        <div className="adm-src-done">
          <span className="adm-src-done-icon">
            <Check size={22} />
          </span>
          <div>
            <strong>
              {result.removedSources} source{result.removedSources > 1 ? "s" : ""} retirée
              {result.removedSources > 1 ? "s" : ""}
            </strong>
            <span>
              {result.removedEpisodes
                ? `${result.removedEpisodes} épisode${
                    result.removedEpisodes > 1 ? "s" : ""
                  } n'avai${result.removedEpisodes > 1 ? "ent" : "t"} plus aucun lecteur et ${
                    result.removedEpisodes > 1 ? "ont" : "a"
                  } quitté la liste. La progression des joueurs a été recalée dessus.`
                : "Aucun épisode perdu : chacun gardait au moins une source."}
            </span>
            <span>
              Il reste {result.left} épisode{result.left > 1 ? "s" : ""} sur ce titre
              {result.unknown
                ? ` · ${result.unknown} lien${result.unknown > 1 ? "s" : ""} au verdict incertain, laissé${result.unknown > 1 ? "s" : ""} en place`
                : ""}
              .
            </span>
          </div>
        </div>
      )}

      {report && phase !== "done" && (
        <>
          <div className="adm-src-tally">
            <span className="ok">
              <Check size={13} /> {report.alive} vivante{report.alive > 1 ? "s" : ""}
            </span>
            <span className="dead">
              <Link2Off size={13} /> {report.dead} morte{report.dead > 1 ? "s" : ""}
            </span>
            <span className="warn">
              <CircleSlash2 size={13} /> {report.unknown} à vérifier
            </span>
            <em>
              {report.checked} lien{report.checked > 1 ? "s" : ""} sondé
              {report.checked > 1 ? "s" : ""}
              {report.checked < report.total
                ? ` sur ${report.total} — contrôle écourté, relance-le pour finir`
                : ""}
            </em>
          </div>

          {/* CE QU'ON PERD VRAIMENT. Un miroir mort ne coûte rien — il en reste
              d'autres. Un épisode dont TOUTES les sources sont mortes quitte la
              liste, et c'est la seule chose de cet écran qui mérite un avis
              avant de cliquer. */}
          {doomed > 0 && (
            <p className="adm-src-doom">
              <AlertTriangle size={14} />
              <span>
                <strong>
                  {doomed} épisode{doomed > 1 ? "s" : ""} n'aura{doomed > 1 ? "ont" : ""}{" "}
                  plus aucun lecteur
                </strong>{" "}
                — {doomed > 1 ? "ils quitteront la liste" : "il quittera la liste"}, et la
                progression des joueurs sera recalée sur ce qui reste.{" "}
                {media.kind === "film" && "Ce film n'aura plus rien à jouer."}
              </span>
            </p>
          )}

          {report.episodes.length === 0 ? (
            <div className="adm-coll-state col">
              <Check size={22} />
              <span>Tous les liens répondent. Rien à retirer sur ce titre.</span>
            </div>
          ) : (
            <ul className="adm-src-list">
              {report.episodes.map((ep) => (
                <li key={ep.index} className={ep.left ? "" : "doomed"}>
                  <span className="adm-src-num">
                    S{String(ep.season).padStart(2, "0")}E
                    {String(ep.number).padStart(2, "0")}
                  </span>
                  <span className="adm-src-title">
                    {ep.title || <em>sans titre</em>}
                    {!ep.left && (
                      <b>
                        <Unplug size={11} /> plus aucun lecteur
                      </b>
                    )}
                  </span>
                  <span className="adm-src-hosts">
                    {ep.sources.map((s, i) => {
                      const st = STATES[s.state] || STATES.unknown;
                      return (
                        <em
                          key={`${s.url}-${i}`}
                          className={st.cls}
                          title={`${s.url}\n${st.label}${s.reason ? ` — ${s.reason}` : ""}`}
                        >
                          <st.Icon size={11} />
                          {s.host}
                          {s.reason && <i>{s.reason}</i>}
                        </em>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------- création ----

function CreateModal({ token, onClose, onDone }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [preview, setPreview] = useState(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const manual = draft.provider !== "youtube";

  // Aperçu de l'URL : on vérifie AVANT d'enregistrer que le lien pointe bien
  // sur ce qu'on croit (une playlist de 78 épisodes, pas une seule vidéo).
  //
  // Elle LÈVE plutôt que d'attraper : c'est le champ d'adresse qui l'appelle
  // (voir ListImport), et c'est donc lui qui montre l'attente et l'échec, au
  // même endroit que pour un scrape. Deux gestionnaires d'erreur pour un seul
  // bouton, c'était l'erreur affichée deux fois — ou pas du tout.
  async function checkYoutube(url) {
    const d = await apiFetch(`/collection/preview?url=${encodeURIComponent(url)}`, {
      token,
    });
    setPreview(d);
    setDraft((prev) => ({
      ...prev,
      // Le lecteur est ARRÊTÉ ICI, et non déduit de ce qui traîne dans le champ :
      // c'est la réponse de YouTube qui prouve qu'on a bien affaire à YouTube.
      provider: "youtube",
      url,
      title: prev.title || d.playlistTitle || d.title,
      kind: d.playlistId ? "series" : "film",
    }));
  }

  // Même geste pour une liste collée : on la relit et on montre ce qui en sort
  // (combien d'épisodes, chez qui, combien de miroirs) avant d'enregistrer quoi
  // que ce soit. Une ligne mal formée se voit au décompte.
  async function checkList() {
    setChecking(true);
    setError(null);
    try {
      const d = await apiFetch("/collection/preview-list", {
        method: "POST",
        token,
        body: { text: draft.episodesText },
      });
      setPreview({ ...d, list: true });
      if (!d.count) setError("Aucune ligne lisible : il faut un lien http par épisode.");
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/collection", { method: "POST", token, body: draft });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const ready = (manual ? draft.episodesText.trim() : draft.url) && draft.title;

  return (
    <Modal
      title="Ajouter un titre"
      subtitle="Un lien, une fiche, et le boîtier se pose sur l'étagère."
      Icon={Plus}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="adm-coll-error">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : (
            <p className="adm-coll-hint">
              L'enrichissement interroge {manual ? "" : "YouTube, "}TVmaze et
              Wikipédia : compte quelques secondes pour une longue série.
            </p>
          )}
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onClose}>
              Annuler
            </button>
            <button
              className="btn btn-primary clickable"
              onClick={save}
              disabled={!ready || saving}
              title={ready ? undefined : "Il faut au moins une source et un titre."}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Enrichir et poser sur l'étagère
            </button>
          </div>
        </>
      }
    >
      <Section
        step={1}
        title="La source"
        hint="Colle une adresse : ce qu'elle est se reconnaît tout seul, et le reste du formulaire suit."
      >
        <SourceSites url={draft.url} />

        <ListImport
          token={token}
          // La nature en cours de saisie : c'est elle qui ouvre le numéro de
          // partie, une fois qu'on sait qu'on remplit un film.
          kind={draft.kind}
          // Le lecteur SUIT L'ADRESSE, à la frappe : il n'y a plus personne à
          // qui poser la question, et le formulaire doit changer de forme
          // pendant qu'on colle, pas après.
          onUrl={(u) =>
            setDraft((d) => ({
              ...d,
              url: u,
              provider: isYoutubeUrl(u) ? "youtube" : "embed",
            }))
          }
          onYoutube={checkYoutube}
          onImported={(d) => {
            // L'import REMPLIT le formulaire, il ne l'enregistre pas : tout
            // reste relisible (et corrigeable) avant de poser le boîtier.
            const film = d.kind === "film";
            setDraft((prev) => ({
              ...prev,
              // Ce qui revient d'un scrape est une LISTE de liens vers des
              // hébergeurs tiers : le lecteur ne peut plus être YouTube, quoi
              // qu'il reste écrit dans le champ d'adresse.
              provider: "embed",
              url: d.sourceUrl || prev.url,
              title: prev.title || d.title || "",
              // UN FILM CHANGE LA NATURE DU BOÎTIER. C'est le seul champ que
              // l'import impose : tout le formulaire en dépend (le lecteur, la
              // fiche externe interrogée, la forme de la liste), et laisser
              // « Série » sur un long métrage se paie à l'enregistrement.
              kind: film ? "film" : prev.kind,
              // Un import téléchargé REMPLACE (il apporte tout le titre) ;
              // une source collée S'AJOUTE (elle n'apporte qu'une saison).
              // Un film, lui, tient sur UNE ligne — celle de sa partie — dont
              // les adresses se cumulent : c'est ainsi qu'on rattrape les
              // lecteurs qu'une fiche ne monte qu'au clic, et qu'un film en
              // deux volets se remplit fiche après fiche (voir mergeFilmPart).
              episodesText: film
                ? mergeFilmPart(
                    prev.episodesText,
                    prev.title || d.title,
                    (d.players || []).map((p) => p.url),
                    d.part || 1
                  )
                : d.appendList
                  ? [prev.episodesText.trim(), d.appendList].filter(Boolean).join("\n")
                  : d.list || prev.episodesText,
              poster: d.cover || prev.poster,
              backdrop: d.backdrop || prev.backdrop,
              synopsis: d.synopsis || prev.synopsis,
              genres: d.genres?.length ? d.genres : prev.genres,
              year: d.year || prev.year,
              // Les pistes réellement trouvées : elles s'impriment au dos du
              // boîtier, on ne les invente donc pas. Une fiche de film les
              // annonce en clair (« TrueFrench »), une fiche de série les
              // porte saison par saison.
              langs: d.langs?.length
                ? d.langs
                : [...new Set((d.seasons || []).map((s) => s.lang).filter(Boolean))],
              tvmazeQuery: film ? prev.tvmazeQuery : prev.tvmazeQuery || d.title || "",
            }));
            setPreview(null);
          }}
        />

        {/* LA LISTE NE S'OUVRE QUE POUR CE QUI EN A UNE. Une playlist YouTube se
            pilote, ses épisodes sont là-bas et n'ont rien à faire dans une zone
            de texte ; tout le reste — un scrape qu'on relit, des liens trouvés
            à la main — passe forcément par ici. Elle est donc là par défaut :
            c'est le champ vide, avant toute adresse, qui laisse encore le choix
            de tout coller soi-même. */}
        {manual && (
          <>
            <label className="adm-coll-field">
              <span>
                Épisodes — une ligne par épisode : <code>S01E02 Titre — lien</code>, et
                les liens suivants sur la même ligne sont des miroirs. Un lien peut
                dire sa version : <code>vostfr@https://…</code>
              </span>
              <textarea
                className="adm-coll-list"
                rows={9}
                spellCheck={false}
                value={draft.episodesText}
                onChange={(e) => set("episodesText")(e.target.value)}
                placeholder={LIST_PLACEHOLDER}
              />
            </label>
            <div className="adm-coll-inline">
              <button
                className="btn btn-ghost clickable"
                onClick={checkList}
                disabled={!draft.episodesText.trim() || checking}
              >
                {checking ? <Loader2 size={15} className="spin" /> : <ListVideo size={15} />}
                Relire la liste
              </button>
              <span className="adm-coll-hint">
                Un lien direct (.mp4, .m3u8) est lu par le poste comme YouTube ;
                tout autre lien s'affiche dans le cadre du site d'origine, sans
                progression suivie.
              </span>
            </div>
          </>
        )}

        {preview && !preview.list && (
          <div className="adm-coll-preview">
            {preview.thumb && <img src={preview.thumb} alt="" />}
            <div>
              <strong>{preview.playlistTitle || preview.title}</strong>
              <span>
                {preview.channel && `${preview.channel} · `}
                {preview.count} vidéo{preview.count > 1 ? "s" : ""}
                {preview.playlistId ? " (playlist)" : " (vidéo seule)"}
              </span>
              {preview.episodes.length > 0 && (
                <ul>
                  {preview.episodes.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {preview?.list && <ListPreview preview={preview} />}
      </Section>

      <Section
        step={2}
        title="La fiche"
        hint="Ce qui s'imprime sur le boîtier. L'enrichissement complétera le reste."
      >
        <Fields draft={draft} set={set} />
      </Section>

      <Section
        step={3}
        title="Le rattachement"
        hint="La fiche externe qui commandera les visuels, les résumés et les titres d'épisodes."
      >
      <ExternalMatch
        token={token}
        kind={draft.kind}
        query={draft.title}
        onPick={(r) => {
          if (r.source === "tmdb") {
            // La fiche TMDB commande tout le reste : titres d'épisodes,
            // images, casting, année. On la retient telle quelle.
            setDraft((d) => ({
              ...d,
              tmdbRef: r.ref,
              title: d.title || r.title,
              kind: r.kind || d.kind,
              year: d.year || r.year || "",
            }));
          } else if (r.source === "tvmaze") {
            setDraft((d) => ({ ...d, tvmazeQuery: r.ref, title: d.title || r.title }));
          } else {
            setDraft((d) => ({ ...d, wikiTitle: r.ref }));
          }
        }}
        picked={{
          tmdb: draft.tmdbRef,
          tvmaze: draft.tvmazeQuery,
          wiki: draft.wikiTitle,
        }}
      />
      </Section>
    </Modal>
  );
}

// ------------------------------------------------ import d'un répertoire ----
//
// Certains sites ne sont qu'un INDEX de liens : la page liste les saisons, et
// chaque saison porte les adresses des hébergeurs. Plutôt que de recopier 80
// lignes à la main, on lit la fiche et on REMPLIT la zone de liste — ce qui en
// sort est du texte, relu et corrigé avant d'être enregistré. L'import fait la
// frappe, pas le choix.
//
// SÉRIES ET FILMS PAR LA MÊME PORTE. Une fiche de film n'a ni saisons ni
// épisodes : elle a un programme et cinq boutons de lecteur, qui sont
// exactement ce que notre poste appelle des miroirs. Une fiche de série du même
// site, elle, rend ses épisodes (lib/serieIndex.js). Le geste de l'admin étant
// le même (coller une adresse), le champ l'est aussi — c'est le serveur qui
// reconnaît ce qu'on lui donne, et le rapport ci-dessous qui change de forme
// selon ce qui en revient.

// PLUS DE CHOIX DE LANGUE À L'IMPORT, et c'est un soulagement : il fallait
// trancher VF ou VOSTFR AVANT de savoir ce que la fiche avait, et l'autre
// version était perdue — la récupérer demandait de tout réimporter, ce qui
// effaçait la première. L'import prend maintenant TOUT ce qui existe, chaque
// adresse étiquetée de sa piste (« vostfr@https://… » dans la liste), et le
// choix revient à celui qui regarde, sur la fiche du titre.
//
// `vf` reste envoyé comme PRÉFÉRENCE : elle ne filtre plus rien, elle décide
// seulement de la version qui se branche en premier.
const IMPORT_LANG = "vf";

// `slug` change tout : sans lui, l'import REMPLIT le formulaire d'ajout (rien
// n'est enregistré, l'admin relit) ; avec lui, il SCRAPE ET REMPLACE la source
// du titre, d'un seul geste. C'est la différence entre poser un boîtier — où
// tout reste à décider — et réparer celui qui est déjà sur l'étagère, où l'on
// sait exactement ce qu'on veut : que ça rejoue.
//
// ET YOUTUBE PASSE PAR LE MÊME CHAMP. En édition c'était déjà le cas — le
// serveur reconnaît la playlist à son adresse et remplace les épisodes
// (routes/collection.js) — mais à l'ajout, il fallait d'abord annoncer son
// lecteur sur deux grandes cartes pour voir apparaître le bon champ. À l'ajout,
// c'est `onYoutube` qui prend le relais : la playlist ne se scrape pas comme
// une fiche, elle se VÉRIFIE (aperçu), et le formulaire s'en trouve changé.
function ListImport({ token, slug, kind, onImported, onApplied, onUrl, onYoutube }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  // LA PARTIE QU'ON EST EN TRAIN DE REMPLIR. Un film en deux volets a deux
  // fiches chez l'hébergeur : on colle la première, puis la seconde, et c'est ce
  // numéro qui les empêche de se prendre l'une pour un miroir de l'autre. Il
  // avance tout seul après chaque import réussi — l'ordre dans lequel on colle
  // est celui des parties, et le corriger reste possible avant de récupérer.
  const [part, setPart] = useState(1);
  // Le repli manuel. Il ne s'ouvre pas tout seul au premier échec : la plupart
  // des erreurs sont de simples fautes d'adresse, et l'ouvrir à chaque fois
  // reviendrait à proposer la corvée avant le remède.
  const [pasting, setPasting] = useState(false);
  const [source, setSource] = useState("");
  const [pasteSeason, setPasteSeason] = useState(1);
  const blocked = /anti-robots/i.test(error || "");
  // Ce que l'adresse dit d'elle-même, relu à chaque frappe : c'est lui qui
  // décide du libellé, du bouton, et de la présence du sélecteur de langue.
  const site = detectSource(url);
  // Une playlist ne se scrape pas : elle se vérifie. Uniquement à l'ajout —
  // sur un titre déjà posé, le serveur sait la reconnaître et la remplacer
  // lui-même, c'est donc le même bouton que pour une fiche.
  const yt = !slug && !!onYoutube && site?.value === "youtube";
  // Le numéro de partie ne s'ouvre que sur un FILM : ailleurs il ne désigne
  // rien (une série range ses épisodes toute seule, avec les repères de sa
  // fiche). `kind` vient du formulaire — ou du boîtier, en édition — et le
  // rapport prend le relais à l'ajout, où la nature du titre ne se sait qu'une
  // fois la première fiche récupérée.
  const film = !yt && (kind === "film" || report?.kind === "film");

  // Ce qu'on tape remonte au formulaire : c'est lui qui en déduit le lecteur.
  function typed(v) {
    setUrl(v);
    onUrl?.(v);
  }

  async function runPaste() {
    setBusy(true);
    setError(null);
    try {
      // L'adresse du champ du dessus part avec le collage quand elle est là :
      // c'est elle qui dit au lecteur quel hôte est LE SITE, donc lequel ne
      // peut pas être un lecteur (ses propres pages, ses images, ses scripts).
      // `lang` ne choisit plus rien : une source collée porte TOUTES les
      // versions de la fiche, et elles sont désormais toutes reprises. Il ne
      // reste qu'une préférence — celle qui se branchera en premier.
      // `part` ne sert qu'aux fiches de FILM : pour une série, c'est `season`
      // qui range ce qu'on colle. Les deux voyagent, le serveur lit celui qui
      // correspond à ce qu'il a reconnu dans la source.
      const body = {
        text: source,
        season: pasteSeason,
        part,
        url: url.trim(),
        lang: IMPORT_LANG,
      };
      // En édition, un collage COMPLÈTE la source en place : il n'apporte qu'un
      // lecteur (celui affiché au moment de la copie) ou qu'une saison.
      const d = slug
        ? await apiFetch(`/collection/${slug}/source/import`, {
            method: "POST",
            token,
            body: { ...body, merge: true },
          })
        : await apiFetch("/collection/import/paste", { method: "POST", token, body });
      setReport({ ...(d.report || d), part });
      if (slug) {
        onApplied(d);
        setSource("");
        return;
      }
      // `appendList` plutôt que `list` : on colle une saison à la fois, et
      // chacune doit S'AJOUTER aux précédentes. Passer par `list` aurait
      // remplacé la zone de texte, donc effacé la saison d'avant.
      // Une fiche de SÉRIE collée apporte elle aussi des épisodes (toute sa
      // saison d'un coup) : elle s'ajoute de la même façon. Ne restent à part
      // que les collages qui ne décrivent QUE la fiche, sans un lien.
      const brings = d.kind === "episodes" || d.kind === "series";
      onImported(
        brings ? { ...d, list: "", appendList: d.list } : { ...d, list: "", part }
      );
      if (brings) {
        setSource("");
        setPasteSeason((n) => n + 1); // la prochaine, la plus probable
      }
      // Le collage d'un film sert justement à rattraper un lecteur à la fois :
      // la partie, elle, ne change que lorsqu'on a fini d'en remplir une, donc
      // on la laisse où elle est.
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      // La playlist se VÉRIFIE : ce qui en revient (le nombre de vidéos, les
      // premiers titres) s'affiche dans l'aperçu du formulaire, pas dans le
      // rapport d'import ci-dessous — il n'y a ni saison ni hébergeur à
      // dénombrer. L'attente et l'échec, eux, restent ici : c'est ce bouton
      // qu'on a pressé.
      if (yt) {
        await onYoutube(url.trim());
        return;
      }
      const d = slug
        ? await apiFetch(`/collection/${slug}/source/import`, {
            method: "POST",
            token,
            // Un lien REMPLACE : il apporte la fiche entière, donc tous ses
            // lecteurs. C'est le geste qu'on attend d'un bouton qui dit
            // « remplacer » — mais il ne remplace QUE la partie visée, les
            // autres volets du film ne sont pas dans cette fiche-là.
            body: { url: url.trim(), lang: IMPORT_LANG, merge: false, part },
          })
        : await apiFetch(
            `/collection/import/link?url=${encodeURIComponent(url)}&lang=${IMPORT_LANG}`,
            { token }
          );
      // La partie voyage AVEC le rapport : le champ, lui, est déjà passé à la
      // suivante quand celui-ci s'affiche, et il annoncerait le mauvais volet.
      setReport({ ...(d.report || d), part });
      if (slug) onApplied(d);
      else onImported({ ...d, part });
      // Une fiche de film remplie, la suivante qu'on collera est la partie
      // d'après : c'est le cas le plus probable, et il ne coûte rien à défaire.
      if ((d.report || d).kind === "film") setPart((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Le rapport vient de DEUX imports différents (téléchargé, collé) et sa
  // forme a déjà divergé une fois — un `hosts` absent faisait planter tout le
  // panneau d'administration sur un `.slice` de undefined. On lit donc avec des
  // replis : un rapport incomplet doit s'afficher en partie, jamais tomber.
  const seasons = report?.seasons || [];
  const hosts = report?.hosts || [];
  const filled = seasons.filter((x) => x.count).length;
  // LES PISTES RAPPORTÉES, et elles le sont toutes. Cette ligne disait avant ce
  // qu'on N'AVAIT PAS pris (« cette fiche a aussi une VOSTFR — relance l'import
  // avec cette langue pour la prendre à la place ») : il n'y a plus rien à
  // relancer, tout est dans le boîtier et c'est le spectateur qui choisit sur la
  // fiche. Elle dit donc maintenant ce qu'on RAPPORTE.
  const tracks = report?.tracks?.length
    ? report.tracks
    : (report?.langs || []).map((lang) => ({ lang, count: 0 }));

  return (
    <div className="adm-coll-import">
      <div className="adm-coll-field">
        <span>
          {yt ? <CirclePlay size={13} /> : <Download size={13} />}{" "}
          {slug
            ? "Remplacer la source — colle l'adresse d'une fiche (série, film) ou d'une playlist YouTube"
            : yt
              ? "Playlist ou vidéo YouTube — vérifie-la, les épisodes suivront à l'enregistrement"
              : site
                ? "Fiche à récupérer — ses épisodes (ou ses lecteurs) remplissent la liste ci-dessous"
                : "L'adresse de la source — YouTube, anime-sama, ou la fiche d'un site de streaming"}
        </span>
        <div className="adm-coll-inline">
          <input
            value={url}
            onChange={(e) => typed(e.target.value)}
            placeholder="https://www.youtube.com/…&list=… · https://anime-sama.xx/catalogue/… · https://site-de-streaming/le-film"
            onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && run()}
          />
          {/* LA PARTIE VISÉE. Deux fiches pour un seul film (« Part 1 », « Part
              2 ») : sans ce numéro, la seconde s'ajoutait en miroir de la
              première et le poste croyait changer de source en changeant de
              film. Il avance tout seul d'un import à l'autre. */}
          {film && (
            <label className="adm-coll-part">
              Partie
              <input
                type="number"
                min={1}
                max={99}
                value={part}
                onChange={(e) => setPart(Math.max(1, Number(e.target.value) || 1))}
                title="Le volet du film que cette fiche remplit — les autres ne bougent pas."
              />
            </label>
          )}
          <button
            className={`btn clickable ${slug ? "btn-primary" : "btn-ghost"}`}
            onClick={run}
            disabled={!url.trim() || busy}
            title={
              slug
                ? "Scrape la fiche et remplace la source de ce titre, tout de suite"
                : yt
                  ? "Lit la playlist chez YouTube : bon titre ? bon nombre d'épisodes ?"
                  : undefined
            }
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : yt ? (
              <Link2 size={15} />
            ) : (
              <Download size={15} />
            )}
            {slug ? "Scraper et remplacer" : yt ? "Vérifier" : "Récupérer"}
          </button>
        </div>
      </div>

      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {/* Le recours quand le site refuse les robots : l'admin va chercher la
          source avec son navigateur, on se contente de la lire.
          OFFERT D'EMBLÉE, et non après un échec : les sites de streaming
          passent derrière un filtre du jour au lendemain, et découvrir le
          recours seulement après s'être pris l'erreur fait perdre un aller-
          retour à chaque fois. Le bouton se met simplement en avant quand
          l'échec ressemble à un blocage. */}
      {/* Rien à contourner du côté de YouTube : il répond toujours, et sa page
          ne contient de toute façon aucune liste à lire. */}
      {!pasting && !yt && (
        <button
          className={`adm-coll-upload clickable ${blocked ? "urge" : ""}`}
          onClick={() => setPasting(true)}
        >
          <ClipboardPaste size={14} />
          {blocked ? "Coller la source à la place" : "Le site bloque ? Coller la source"}
        </button>
      )}

      {pasting && !yt && (
        <div className="adm-coll-field">
          <span>
            <ClipboardPaste size={13} /> Ouvre la page dans ton navigateur, fais
            Ctrl+U puis Ctrl+A / Ctrl+C, et colle ici. Pour une série anime-sama,
            recommence avec chaque <code>episodes.js</code> de saison ; pour un
            film, choisis un lecteur puis recopie la page. La fiche d'une série
            de site de streaming, elle, rend sa saison entière. Dans tous les cas
            ce qui arrive S'AJOUTE {slug ? "à la source en place" : "à la liste"}{" "}
            au lieu de l'effacer.
          </span>
          <textarea
            className="adm-coll-list"
            rows={6}
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Colle ici la source d'une fiche (série ou film), ou le contenu d'un episodes.js…"
          />
          <div className="adm-coll-inline">
            <label className="adm-coll-lang" style={{ display: "flex", alignItems: "center", gap: ".3rem" }}>
              Saison
              <input
                type="number"
                min={1}
                value={pasteSeason}
                onChange={(e) => setPasteSeason(Number(e.target.value) || 1)}
                style={{ width: 56 }}
              />
            </label>
            <button
              className="btn btn-ghost clickable"
              onClick={runPaste}
              disabled={busy || source.trim().length < 40}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <ClipboardPaste size={15} />}
              Lire cette source
            </button>
            <button className="btn btn-ghost clickable" onClick={() => setPasting(false)}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {report?.kind === "film" && <FilmReport report={report} />}

      {report && report.kind !== "film" && (
        <div className="adm-coll-import-report">
          {report.cover && <img src={report.cover} alt="" />}
          <div>
            <strong>{report.title}</strong>
            <span>
              {report.count} épisode{report.count > 1 ? "s" : ""} ·{" "}
              {filled} saison{filled > 1 ? "s" : ""}
              {report.year ? ` · ${report.year}` : ""}
            </span>
            <ul>
              {seasons.map((s, i) => (
                <li key={s.path || i} className={s.count ? "" : "empty"}>
                  {s.label}
                  {/* Les pistes trouvées POUR CETTE SAISON : une série a souvent
                      ses premières saisons en VF et les dernières en VOSTFR
                      seulement, et ça se voit ici saison par saison. */}
                  {s.langs?.length
                    ? ` · ${s.langs.map((l) => l.toUpperCase()).join(" + ")}`
                    : s.lang
                      ? ` · ${s.lang.toUpperCase()}`
                      : ""}{" "}
                  —{" "}
                  {s.count
                    ? `${s.count} épisode${s.count > 1 ? "s" : ""}`
                    : "rien trouvé"}
                </li>
              ))}
            </ul>
            {tracks.length > 0 && (
              <span className="adm-coll-import-tracks">
                <Languages size={12} /> Pistes rapportées :{" "}
                {tracks
                  .map(
                    (t) =>
                      `${t.lang.toUpperCase()}${t.count ? ` (${t.count} ép.)` : ""}`
                  )
                  .join(", ")}{" "}
                — toutes enregistrées, le choix se fait sur la fiche du titre.
              </span>
            )}
            <span className="adm-coll-import-hosts">
              {hosts.slice(0, 6).map((h) => (
                <em key={h.host}>
                  {h.host} <b>{h.count}</b>
                </em>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Ce qu'une fiche de FILM a donné. Rien à voir avec le rapport d'une série :
// pas de saisons ni de décompte d'épisodes, mais LA LISTE DES LECTEURS, qui est
// tout ce qu'on est venu chercher. Le premier de la liste est celui que le poste
// branchera, les autres sont ses secours.
//
// ET CE QUI MANQUE, DIT AUSSI FRANCHEMENT. Beaucoup de ces fiches ne montent
// leurs lecteurs qu'au clic : on récupère alors trois adresses sur six, et rien
// à l'écran ne le dirait — l'admin croirait le film complet jusqu'au soir où la
// seule source enregistrée sera tombée.
function FilmReport({ report }) {
  const players = report.players || [];
  const missing = report.missing || [];
  return (
    <div className="adm-coll-import-report film">
      {report.cover && <img src={report.cover} alt="" />}
      <div>
        <strong>{report.title}</strong>
        <span>
          {/* OÙ CETTE FICHE EST ALLÉE. Sur un film en plusieurs volets, c'est la
              seule chose qu'on cherche à vérifier après un import : le second
              lien s'est-il rangé en partie 2, ou par-dessus la partie 1 ? */}
          {report.part > 1 ? `Partie ${report.part} · ` : ""}
          {players.length} lecteur{players.length > 1 ? "s" : ""}
          {report.year ? ` · ${report.year}` : ""}
          {report.runtime ? ` · ${report.runtime} min` : ""}
          {report.director ? ` · ${report.director}` : ""}
        </span>
        {players.length > 0 ? (
          <ul>
            {players.map((p) => (
              <li key={p.url} title={p.url}>
                <b>{p.label}</b> — {p.host}
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-coll-error">
            <AlertTriangle size={14} /> Aucun lecteur dans cette page : le site va
            les chercher au clic. Ouvre la fiche, choisis un lecteur, puis colle
            la source ici — recommence pour chacun, les adresses s'ajoutent.
          </p>
        )}
        {missing.length > 0 && (
          <span className="adm-coll-import-missing">
            <AlertTriangle size={12} /> Annoncé{missing.length > 1 ? "s" : ""} sans
            adresse exploitable : {missing.join(", ")} — à récupérer en collant la
            source, lecteur choisi.
          </span>
        )}
      </div>
    </div>
  );
}

// Ce que la liste collée a donné, avant d'enregistrer : le décompte d'abord
// (c'est lui qui trahit une ligne oubliée), puis les hébergeurs et les premières
// entrées telles qu'elles seront rangées.
function ListPreview({ preview }) {
  const missed = preview.lines - preview.count;
  return (
    <div className="adm-coll-listprev">
      <div className="adm-coll-listprev-head">
        <strong>
          {preview.count} épisode{preview.count > 1 ? "s" : ""} lu
          {preview.count > 1 ? "s" : ""}
        </strong>
        {missed > 0 && (
          <span className="adm-coll-listprev-warn">
            <AlertTriangle size={13} /> {missed} ligne{missed > 1 ? "s" : ""} sans lien —
            ignorée{missed > 1 ? "s" : ""}
          </span>
        )}
        <span className="adm-coll-listprev-hosts">
          {preview.hosts.map((h) => (
            <em key={h.host} title={`${h.count} lien${h.count > 1 ? "s" : ""}`}>
              {h.host} <b>{h.count}</b>
            </em>
          ))}
        </span>
      </div>

      <ul>
        {preview.episodes.map((e, i) => (
          <li key={i}>
            <span className="adm-coll-listprev-num">
              S{String(e.season || 1).padStart(2, "0")}E
              {String(e.number ?? i + 1).padStart(2, "0")}
            </span>
            <span className="adm-coll-listprev-title">{e.title || <em>sans titre</em>}</span>
            <span className="adm-coll-listprev-host">
              {e.provider === "file" ? "fichier" : e.host}
              {e.mirrors > 0 && (
                <b title={`${e.mirrors} miroir${e.mirrors > 1 ? "s" : ""}`}>
                  <Antenna size={11} /> {e.mirrors + 1}
                </b>
              )}
            </span>
          </li>
        ))}
        {preview.count > preview.episodes.length && (
          <li className="adm-coll-listprev-more">
            … et {preview.count - preview.episodes.length} de plus
          </li>
        )}
      </ul>
    </div>
  );
}

// -------------------------------------------------------------- édition ----

function EditDrawer({ media, token, onClose, onChanged }) {
  const [draft, setDraft] = useState({
    title: media.title,
    kind: media.kind,
    format: media.format,

    licence: media.licence,
    franchise: media.franchise || "",
    color: media.color || "#f2b70b",
    tagline: media.tagline || "",
    year: media.year || "",
    endYear: media.endYear || "",
    synopsis: media.synopsis || "",
    // Plus de `sourceUrl` ici : changer l'adresse sans recharger les épisodes
    // ne réparait rien et obligeait à ressortir presser « rafraîchir ». La
    // source se remplace maintenant d'un bouton, dans sa propre section.
    // Le papier. Ces champs n'existaient nulle part dans ce tiroir : un manga
    // posé avec un éditeur vide ou un sens de lecture erroné ne se corrigeait
    // qu'en le supprimant et en le reposant.
    originalTitle: media.originalTitle || "",
    publisher: media.publisher || "",
    authors: (media.authors || []).join(", "),
    genres: media.genres || [],
    readDirection: media.readDirection || "ltr",
    rating: media.rating ?? "",
    // Les deux seuls champs de cartouche qui se corrigent : le reste vient du
    // fichier et se refait en le remplaçant.
    region: media.cartridge?.region || "",
    players: media.cartridge?.players || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));
  const game = media.kind === "game";
  const comic = media.kind === "comic";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { region, players, ...body } = draft;
      body.year = body.year === "" ? null : Number(body.year);
      body.endYear = body.endYear === "" ? null : Number(body.endYear);
      // Les champs vides valent « rien », pas « zéro » : Mongoose refuserait la
      // chaîne vide sur un nombre, et la correction échouerait sans qu'on
      // comprenne pourquoi.
      body.rating = body.rating === "" ? null : Number(body.rating);
      if (game)
        body.cartridge = { region, players: players === "" ? null : Number(players) };
      await apiFetch(`/collection/${media.slug}`, { method: "PATCH", token, body });
      onChanged();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }


  return (
    <Modal
      title={media.title}
      subtitle={[
        KINDS[media.kind]?.label,
        media.episodeCount ? `${media.episodeCount} épisodes` : null,
        media.year || null,
      ]
        .filter(Boolean)
        .join(" · ")}
      thumb={media.poster}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="adm-coll-error">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : (
            <span />
          )}
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onClose}>
              Fermer
            </button>
            <button className="btn btn-primary clickable" onClick={save} disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              Enregistrer
            </button>
          </div>
        </>
      }
    >
      {/* LA MÊME MODALE QUE « AJOUTER », et ce n'est pas une coquetterie : on
          corrige un boîtier bien plus souvent qu'on n'en pose, et les deux
          écrans ne se ressemblaient en rien — colonnes contre pleine largeur,
          champs aux mêmes noms rangés autrement. Une seule forme, donc : des
          sections numérotées, pleine largeur, dans l'ordre où l'on s'en sert.
          Les visuels ferment la marche (section 3) : ils ne se touchent qu'une
          fois, et ils prenaient une colonne entière à l'écran pour ça. */}
      <Section step={1} title="La fiche" hint="Ce qui s'imprime sur le boîtier.">
        <Fields draft={draft} set={set} withYears withSynopsis />
      </Section>

      {game ? (
        <Section
          step={2}
          title="La cartouche"
          hint="Le fichier qui se joue, et les deux mentions qu'aucun en-tête ne porte."
        >
          <CartridgeEditor
            media={media}
            token={token}
            draft={draft}
            set={set}
            onChanged={onChanged}
          />
          <IgdbBox media={media} token={token} onChanged={onChanged} />
        </Section>
      ) : comic ? (
        /* LE PAPIER N'A PAS DE LIEN DE STREAMING — il avait pourtant le
           champ, et pas l'ombre d'un moyen de corriger son éditeur, ses
           auteurs ou son sens de lecture. Il a maintenant les siens, et
           surtout la RECHERCHE : c'est ici qu'on vient rattraper une fiche
           posée à la va-vite, ou remplacer un synopsis anglais par le
           français que MangaDex vient de publier. */
        <Section
          step={2}
          title="Le papier"
          hint="Ce qui ne se corrige nulle part ailleurs — et de quoi aller rechercher la fiche."
        >
          <ReadDirection
            value={draft.readDirection}
            onChange={set("readDirection")}
          />

          <div className="adm-coll-grid">
            <label className="adm-coll-field">
              <span>Titre original</span>
              <input
                value={draft.originalTitle}
                onChange={(e) => set("originalTitle")(e.target.value)}
                placeholder="ルックバック"
              />
            </label>
            <label className="adm-coll-field">
              <span>Éditeur</span>
              <input
                value={draft.publisher}
                onChange={(e) => set("publisher")(e.target.value)}
                placeholder="Kana, Glénat, Marvel…"
              />
            </label>
            <label className="adm-coll-field">
              <span>Auteurs (séparés par des virgules)</span>
              <input
                value={draft.authors}
                onChange={(e) => set("authors")(e.target.value)}
                placeholder="Scénario, dessin"
              />
            </label>
            <label className="adm-coll-field">
              <span>Genres (séparés par des virgules)</span>
              <input
                value={(draft.genres || []).join(", ")}
                onChange={(e) =>
                  set("genres")(
                    e.target.value
                      .split(",")
                      .map((g) => g.trim())
                      .filter(Boolean)
                  )
                }
                placeholder="Drame, Tranche de vie"
              />
            </label>
          </div>

          <ComicLookup
            token={token}
            query={draft.title}
            // ON ÉCRASE, ICI. À la création, la saisie à la main l'emporte
            // sur la fiche trouvée ; en correction on vient justement
            // chercher de quoi REMPLACER ce qui est là. Rien ne part en
            // base tant qu'on n'a pas enregistré.
            onPick={(r) => setDraft((d) => applyComicPick(d, r, { overwrite: true }))}
          />
        </Section>
      ) : (
        <Section
          step={2}
          title="La source"
          hint="Ce qui sert ce titre aujourd'hui. Colle l'adresse d'une fiche : le scrape remplace la source sur-le-champ, épisodes compris."
        >
          <SourceSection media={media} token={token} onChanged={onChanged} />
        </Section>
      )}

      {/* LES TROIS IMAGES, ET RIEN D'AUTRE. La colonne portait aussi un aperçu
          de la tranche avec ses cotes au millimètre — une vignette qui répétait
          le titre et l'année déjà écrits deux fois au-dessus, pour une mesure
          qu'on ne prend pas ici mais dans le mesureur de jaquette. Ce qu'on
          vient vraiment faire, c'est remplacer une jaquette, une affiche ou un
          bandeau : le bouton « Tester » de la liste montre l'objet fini bien
          mieux qu'un rectangle de CSS. */}
      <Section
        step={3}
        title="Les visuels"
        hint="La jaquette dépliée habille le boîtier 3D ; l'affiche et le bandeau servent la fiche et les grilles."
      >
        <div className="adm-coll-arts">
          <Artwork media={media} token={token} which="wrap" onChanged={onChanged} />
          <Artwork media={media} token={token} which="poster" onChanged={onChanged} />
          <Artwork media={media} token={token} which="backdrop" onChanged={onChanged} />
        </div>
      </Section>
    </Modal>
  );
}

// ------------------------------------------------------------- IGDB --------
//
// RATTACHER LA FICHE AU VRAI JEU, et la remplir avec ce qu'IGDB en sait. Deux
// choses en une, parce qu'elles n'ont de sens qu'ensemble :
//
//   • LE RATTACHEMENT rend le boîtier cliquable vers la fiche du jeu (note,
//     avis, OST, listes, jaquettes) — sans lui, le rayon jeu est un cul-de-sac
//     dans une application qui ne parle que de jeux ;
//   • LE REMPLISSAGE évite de taper à la main un résumé, un éditeur, une année
//     et une jaquette pour chaque cartouche.
//
// PAR DÉFAUT ON NE COMBLE QUE LES TROUS. Ce qui a été écrit à la main gagne —
// un titre français, un synopsis raccourci, une jaquette scannée. Le bouton
// « tout réécrire » existe pour le cas inverse, et il le dit.

function IgdbBox({ media, token, onChanged }) {
  const linked = media.games?.[0] || null;
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  async function link(game) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const d = await apiFetch(`/collection/${media.slug}/igdb`, {
        method: "POST",
        token,
        body: { igdbId: game.id, force },
      });
      setNote(
        d.filled?.length
          ? `Rempli : ${d.filled.join(", ")}.`
          : "Rattaché — rien à compléter, la fiche était déjà remplie."
      );
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-igdb-box">
      <div className="adm-igdb-head">
        <strong>
          <Gamepad2 size={14} /> La fiche du jeu
        </strong>
        <label className="adm-igdb-force">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          Tout réécrire
        </label>
      </div>

      {linked ? (
        <div className="adm-igdb-picked">
          <span className="adm-igdb-cover">
            {media.poster ? <img src={media.poster} alt="" /> : <Gamepad2 size={18} />}
          </span>
          <div>
            <strong>
              <Check size={13} /> {linked.name || `IGDB ${linked.igdbId}`}
            </strong>
            <em>
              Le boîtier renvoie vers cette fiche · IGDB {linked.igdbId}
            </em>
          </div>
          <a
            className="btn btn-ghost clickable"
            href={`/game/${linked.igdbId}`}
            target="_blank"
            rel="noreferrer"
          >
            Voir
          </a>
        </div>
      ) : (
        <p className="adm-coll-hint">
          Aucun jeu rattaché : le boîtier ne mène nulle part, et sa fiche n'a que
          ce qui a été tapé ici.
        </p>
      )}

      {busy ? (
        <p className="adm-coll-hint">
          <Loader2 size={13} className="spin" /> On demande à IGDB…
        </p>
      ) : (
        <IgdbPicker token={token} onPick={link} />
      )}

      {note && (
        <p className="adm-coll-hint">
          <Check size={12} /> {note}
        </p>
      )}
      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------- la cartouche ----
//
// L'entretien du rayon jeu, et il tient en un geste : REMPLACER LE FICHIER. Un
// meilleur dump paraît, une version française, une traduction de fans — on
// redépose, et la fiche ne bouge pas. C'est exactement ce que fait l'archive
// pour un comic, et pour la même raison : ce qui a été écrit à la main ne doit
// pas se perdre parce qu'on change la matière première.

function CartridgeEditor({ media, token, draft, set, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const fileRef = useRef(null);
  const cart = media.cartridge;

  async function replace(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append("rom", file, file.name);
      const d = await apiUpload(`/collection/${media.slug}/rom`, fd, token);
      setDone(d.read || {});
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="adm-rom-state">
        <span className="adm-rom-icon">
          {media.poster ? <img src={media.poster} alt="" /> : <Gamepad2 size={20} />}
        </span>
        <div>
          <strong>
            {cart?.rom ? "Cartouche en place" : "Aucune cartouche — le jeu ne se lance pas"}
          </strong>
          <span>
            {[
              cart?.code,
              cart?.region,
              cart?.bytes ? `${Math.round(cart.bytes / 1024 / 1024)} Mo` : null,
              cart && !cart.verified ? "en-tête inhabituel" : null,
            ]
              .filter(Boolean)
              .join(" · ") || CONSOLE}
          </span>
        </div>
        <button
          className="btn btn-ghost clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
          {cart?.rom ? "Remplacer" : "Déposer"}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".gba,.agb,.bin"
        hidden
        onChange={(e) => {
          replace(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="adm-coll-error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {done && (
        <p className="adm-coll-hint">
          <Check size={12} /> Cartouche remplacée
          {done.code ? ` — ${done.code}` : ""}
          {done.region ? ` · ${done.region}` : ""}. Les sauvegardes des joueurs
          sont conservées, mais un état de machine est lié à la ROM qui l'a écrit :
          après un changement de dump, elles peuvent ne plus se charger.
        </p>
      )}

      <div className="adm-coll-grid">
        <label className="adm-coll-field">
          <span>Région</span>
          <input
            value={draft.region}
            onChange={(e) => set("region")(e.target.value)}
            placeholder="Europe, Japon…"
          />
        </label>
        <label className="adm-coll-field">
          <span>Joueurs (au dos de la boîte)</span>
          <input
            type="number"
            min="1"
            max="16"
            value={draft.players}
            onChange={(e) => set("players")(e.target.value)}
          />
        </label>
      </div>
    </>
  );
}

// ------------------------------------------------------------ la source ----
//
// CE QUI SERT LE TITRE AUJOURD'HUI, PUIS DE QUOI LE RE-SERVIR. Le tiroir
// d'édition ne montrait rien de la source en place : il proposait de « changer
// le lien » en affichant l'adresse actuelle en simple texte grisé de champ
// vide — et encore, jamais, puisque la carte du rayon ne porte pas `source`
// (elle sert à peindre une étagère). On ouvrait donc une fiche sans savoir chez
// qui elle était hébergée, ni combien de lecteurs il lui restait.
//
// Trois temps, dans l'ordre où l'on s'en sert :
//
//   1. L'ÉTAT — le lecteur en place, la page d'origine, les hébergeurs
//      réellement utilisés et leur poids. C'est le diagnostic ;
//   2. LE RÉ-IMPORT — le même scraper qu'à l'ajout (série ou film), qui remplit
//      la liste ci-dessous sans rien enregistrer ;
//   3. LA LISTE — relue, corrigée à la main, puis enregistrée.
//
// Rien ne part en base avant « Enregistrer la liste » : un import raté se
// referme sans conséquence.

function SourceSection({ media, token, onChanged }) {
  const [info, setInfo] = useState(null); // état de la source (route /source)
  const [text, setText] = useState(null); // la liste, éditable
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    apiFetch(`/collection/${media.slug}/source`, { token })
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        // La zone de texte n'est remplie qu'à la PREMIÈRE lecture : recharger
        // l'état après un enregistrement ne doit pas écraser ce que l'admin est
        // en train de taper.
        setText((prev) => (prev === null ? d.text || "" : prev));
      })
      .catch(() => alive && setInfo({ error: true }));
    return () => {
      alive = false;
    };
  }, [media.slug, token]);
  useEffect(load, [load]);

  // LE SCRAPE A DÉJÀ ÉCRIT. Contrairement à l'ajout — où l'import remplit un
  // formulaire qu'on relit — ici le serveur a remplacé la source avant de
  // répondre : il ne reste qu'à remettre l'écran d'accord avec la base.
  function applyImport(d) {
    setInfo(d.source);
    setText(d.source?.text || "");
    const n = d.source?.count || 0;
    const hosts = (d.source?.hosts || []).map((h) => h.host).join(", ");
    setMsg({
      ok: true,
      text:
        `Source remplacée — ${n} épisode${n > 1 ? "s" : ""}` +
        (hosts ? ` chez ${hosts}` : "") +
        (d.report?.missing?.length
          ? `. Annoncés sans adresse : ${d.report.missing.join(", ")} — colle la source, lecteur choisi, pour les ajouter.`
          : ".") +
        (d.shifted
          ? " La liste a changé de longueur : les épisodes déjà cochés par les joueurs ne pointent plus au même endroit."
          : ""),
    });
    onChanged();
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const d = await apiFetch(`/collection/${media.slug}/episodes`, {
        method: "PUT",
        token,
        body: { text },
      });
      const n = d.media.episodes.length;
      setMsg({
        ok: true,
        text:
          `${n} épisode${n > 1 ? "s" : ""} enregistré${n > 1 ? "s" : ""}.` +
          (d.shifted
            ? " La liste a changé de longueur : les épisodes déjà cochés par les joueurs ne pointent plus au même endroit."
            : ""),
      });
      load();
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <CurrentSource info={info} />

      {/* LE GESTE PRINCIPAL, ET IL TIENT EN UN BOUTON. Une adresse — fiche de
          série, fiche de film, playlist YouTube — et la source est remplacée
          sur-le-champ : plus de « changer le lien ici, puis rafraîchir là-bas »,
          qui ne marchait de toute façon pas pour un titre servi par des
          hébergeurs tiers. */}
      <ListImport
        token={token}
        slug={media.slug}
        kind={media.kind}
        onApplied={applyImport}
      />

      {msg && (
        <p className={msg.ok ? "adm-src-done-msg" : "adm-coll-error"}>
          {msg.ok ? <Check size={14} /> : <AlertTriangle size={14} />} {msg.text}
        </p>
      )}

      {/* La liste reste modifiable À LA MAIN : c'est le dernier recours quand
          aucun scrape ne donne ce qu'on veut (un lien direct .mp4, un miroir
          trouvé ailleurs). Elle n'est plus le chemin normal, juste l'outil du
          dessous — d'où le bouton discret. */}
      <div className="adm-coll-field">
        <span>
          <ListVideo size={13} /> {media.kind === "film" ? "Lecteurs" : "Épisodes"} — une
          ligne par {media.kind === "film" ? "partie du film" : "épisode"}, miroirs
          séparés par « | », version en tête d'adresse (<code>vf@https://…</code>)
          {media.kind === "film" &&
            " — un film d'un seul tenant n'en a qu'une, un diptyque en a deux (S01E01, S01E02)."}
        </span>
        {text === null ? (
          <div className="adm-coll-state">
            <Loader2 size={16} className="spin" /> Lecture de la liste…
          </div>
        ) : (
          <>
            <textarea
              className="adm-coll-list"
              rows={media.kind === "film" ? 4 : 10}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={LIST_PLACEHOLDER}
            />
            <div className="adm-coll-inline">
              <button
                className="btn btn-ghost clickable"
                onClick={save}
                disabled={saving || !text.trim()}
              >
                {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                Enregistrer la liste
              </button>
              <span className="adm-coll-hint">
                Pour une correction à la main : le scrape ci-dessus enregistre déjà
                tout seul.
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// L'état de la source, en une carte qu'on lit avant de toucher à quoi que ce
// soit : le lecteur, le nombre d'épisodes, QUI les héberge (et combien de fois —
// un hébergeur présent sur trois épisodes sur vingt trahit une liste à moitié
// morte), et le lien vers la page d'origine.
function CurrentSource({ info }) {
  if (!info)
    return (
      <div className="adm-coll-state">
        <Loader2 size={16} className="spin" /> Lecture de la source…
      </div>
    );
  if (info.error)
    return (
      <p className="adm-coll-error">
        <AlertTriangle size={14} /> Impossible de lire la source de ce titre.
      </p>
    );

  return (
    <div className="adm-src-now">
      <div className="adm-src-now-head">
        <em className="adm-coll-pill ext">
          <MonitorPlay size={11} /> {PROVIDERS[info.provider]?.label || info.provider}
        </em>
        <strong>
          {info.count} épisode{info.count > 1 ? "s" : ""}
        </strong>
        {info.langs?.length > 0 && (
          <span className="adm-src-now-langs">
            {info.langs.map((l) => l.toUpperCase()).join(" · ")}
          </span>
        )}
      </div>

      {info.hosts?.length > 0 ? (
        <span className="adm-coll-import-hosts">
          {info.hosts.slice(0, 8).map((h) => (
            <em key={h.host} title={`${h.count} lien${h.count > 1 ? "s" : ""}`}>
              {h.host} <b>{h.count}</b>
            </em>
          ))}
        </span>
      ) : (
        <span className="adm-src-now-empty">
          <Unplug size={12} /> Aucun lecteur : ce boîtier ne joue plus rien.
        </span>
      )}

      {(info.url || info.channel) && (
        <span className="adm-src-now-links">
          {info.url && (
            <a href={info.url} target="_blank" rel="noreferrer" className="clickable">
              <ExternalLink size={11} /> {hostOfUrl(info.url) || "page d'origine"}
            </a>
          )}
          {info.channel && (
            <a
              href={info.channelUrl || info.url}
              target="_blank"
              rel="noreferrer"
              className="clickable"
            >
              <CirclePlay size={11} /> {info.channel}
            </a>
          )}
          {info.playlistId && <code>list={info.playlistId}</code>}
        </span>
      )}
    </div>
  );
}

const hostOfUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// --------------------------------------------------------------- champs ----

function Fields({ draft, set, withYears, withSynopsis }) {
  return (
    <>
      <label className="adm-coll-field">
        <span>Titre</span>
        <input value={draft.title} onChange={(e) => set("title")(e.target.value)} />
      </label>

      <div className="adm-coll-grid">
        <label className="adm-coll-field">
          <span>Nature</span>
          <select value={draft.kind} onChange={(e) => set("kind")(e.target.value)}>
            {Object.entries(KINDS).map(([v, k]) => (
              <option key={v} value={v}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        {/* Pas de sélecteur de support : tout est en boîtier DVD. Le champ
            existe toujours en base pour le jour où un autre support arrivera. */}

        {/* PLUS DE CHOIX DE LECTEUR. Il y en a eu un — poste cathodique ou
            lecteur sobre — et il posait à l'admin une question qui n'aidait
            personne à voir le film. Il n'y a plus qu'une visionneuse, et son
            seul réglage se prend en séance : quel hébergeur brancher en
            premier (l'étoile du sélecteur de source). */}

        <label className="adm-coll-field">
          <span>Provenance</span>
          <select value={draft.licence} onChange={(e) => set("licence")(e.target.value)}>
            {Object.entries(LICENCES).map(([v, l]) => (
              <option key={v} value={v}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-coll-field">
          <span>Saga</span>
          <input
            value={draft.franchise}
            onChange={(e) => set("franchise")(e.target.value)}
            placeholder="Sonic, Super Mario…"
          />
        </label>

        {withYears && (
          <>
            <label className="adm-coll-field">
              <span>Année</span>
              <input
                type="number"
                value={draft.year}
                onChange={(e) => set("year")(e.target.value)}
              />
            </label>
            <label className="adm-coll-field">
              <span>Fin (séries)</span>
              <input
                type="number"
                value={draft.endYear}
                onChange={(e) => set("endYear")(e.target.value)}
              />
            </label>
          </>
        )}
      </div>

      <label className="adm-coll-field">
        <span>Accroche</span>
        <input
          value={draft.tagline}
          onChange={(e) => set("tagline")(e.target.value)}
          placeholder="Une phrase, affichée sur la fiche"
        />
      </label>

      {withSynopsis && (
        <label className="adm-coll-field">
          <span>Synopsis</span>
          <textarea
            rows={5}
            value={draft.synopsis}
            onChange={(e) => set("synopsis")(e.target.value)}
          />
        </label>
      )}

      <div className="adm-coll-field">
        <span>Teinte de la tranche</span>
        <div className="adm-coll-tints">
          {TINTS.map((c) => (
            <button
              key={c}
              className={`adm-coll-tint clickable ${draft.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => set("color")(c)}
              title={c}
              type="button"
            >
              {draft.color === c && <Check size={13} />}
            </button>
          ))}
          <input
            type="color"
            className="adm-coll-tint-pick"
            value={draft.color}
            onChange={(e) => set("color")(e.target.value)}
            title="Teinte personnalisée"
          />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------- rattachement externe ----

function ExternalMatch({ token, kind, query, onPick, picked }) {
  const [q, setQ] = useState(query || "");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  // Le serveur dit s'il a une clé TMDB : sans elle, pas d'images ni de résumés
  // par épisode, et ça se voit à l'arrivée — autant prévenir ici.
  const [tmdbOn, setTmdbOn] = useState(true);
  const lastQuery = useRef("");

  useEffect(() => {
    if (query && !lastQuery.current) setQ(query);
  }, [query]);

  async function search() {
    setBusy(true);
    lastQuery.current = q;
    try {
      const d = await apiFetch(
        `/collection/lookup?q=${encodeURIComponent(q)}&kind=${kind}`,
        { token }
      );
      setResults(d.results || []);
      setTmdbOn(d.tmdb !== false);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-coll-match">
      <div className="adm-coll-field">
        <span>Rattacher à une fiche existante (synopsis, casting, épisodes)</span>
        <div className="adm-coll-inline">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nom de la série ou du film"
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button
            className="btn btn-ghost clickable"
            onClick={search}
            disabled={q.length < 2 || busy}
          >
            {busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
            Chercher
          </button>
        </div>
      </div>

      {(picked.tmdb || picked.tvmaze || picked.wiki) && (
        <p className="adm-coll-picked">
          <Check size={13} />
          {picked.tmdb && <>TMDB : {picked.tmdb}. </>}
          {picked.tvmaze && <>TVmaze : {picked.tvmaze}. </>}
          {picked.wiki && <>Wikipédia : {picked.wiki}.</>}
        </p>
      )}

      {results?.length === 0 && (
        <p className="adm-coll-hint">
          Aucune fiche trouvée — l'enrichissement se fera avec les seules données
          de la source.
        </p>
      )}

      {/* Sans clé TMDB, on n'a ni les images d'épisodes ni les fiches de films :
          autant le dire là où ça se voit. */}
      {results && !tmdbOn && (
        <p className="adm-coll-hint">
          <AlertTriangle size={13} /> Aucune clé TMDB configurée : pas d'images ni de
          résumés par épisode. Ajoute <code>TMDB_API_KEY</code> dans l'onglet Secrets.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="adm-coll-results">
          {results.map((r) => (
            <li key={`${r.source}-${r.ref}`}>
              <button className="clickable" onClick={() => onPick(r)} type="button">
                {r.poster ? (
                  <img src={r.poster} alt="" />
                ) : (
                  <span className="adm-coll-noimg" />
                )}
                <span className="adm-coll-res-text">
                  <strong>
                    {r.title}
                    {r.year ? ` (${r.year})` : ""}
                  </strong>
                  <em>
                    {r.source === "tmdb"
                      ? `TMDB · ${KINDS[r.kind]?.label || ""}`
                      : r.source === "tvmaze"
                        ? "TVmaze"
                        : "Wikipédia"}
                    {r.network ? ` · ${r.network}` : ""}
                  </em>
                  {r.summary && <span>{r.summary}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------- visuels ----

const ARTWORKS = {
  wrap: {
    label: "Jaquette complète (dos · tranche · couverture)",
    hint: "Dépliée comme à l'impression. Elle habille le boîtier 3D à elle seule.",
  },
  poster: { label: "Affiche (portrait)", hint: "Vue en grille et fiche." },
  backdrop: { label: "Bandeau (paysage)", hint: "Haut de la fiche." },
};

function Artwork({ media, token, which, onChanged }) {
  const [typed, setTyped] = useState(""); // l'adresse tapée à la main
  const [busy, setBusy] = useState(false);
  const [fitting, setFitting] = useState(null); // { src, file } — jaquette à mesurer
  const [pdf, setPdf] = useState(null); // PDF déposé, dont il faut choisir la page
  const [searching, setSearching] = useState(false); // sélecteur Cinéma Passion
  const [lighter, setLighter] = useState(null); // ce que l allègement a donné
  const fileRef = useRef(null);
  const { label, hint } = ARTWORKS[which];
  const current = media[which];

  async function push(body) {
    setBusy(true);
    try {
      if (body instanceof FormData)
        await apiUpload(`/collection/${media.slug}/artwork`, body, token);
      else
        await apiFetch(`/collection/${media.slug}/artwork`, {
          method: "POST",
          token,
          body,
        });
      setTyped("");
      onChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // permet de re-choisir le même fichier
    // Un PDF fait un détour : il faut le rasteriser, et surtout savoir LAQUELLE
    // de ses pages est la jaquette. Ce qui en ressort est un fichier image
    // ordinaire, qui reprend le chemin commun ci-dessous.
    if (isPdf(file)) {
      setPdf(file);
      return;
    }
    takeFile(file);
  }

  // Le chemin commun d'un vrai fichier image, d'où qu'il vienne (choisi tel
  // quel, ou sorti d'un PDF).
  async function takeFile(raw) {
    // ALLÈGEMENT AVANT TOUT. Une jaquette d'impression pèse couramment quinze
    // mégaoctets, pour des pixels que la texture finale (bornée à 4096 px) ne
    // montrera jamais. On réduit donc ici — et on le DIT, plutôt que de
    // rétrécir le fichier de quelqu'un en silence.
    setBusy(true);
    let file = raw;
    try {
      const out = await shrinkImageFile(raw);
      file = out.file;
      setLighter(
        out.changed ? `Allégée : ${fmtBytes(out.from)} → ${fmtBytes(out.to)}` : null
      );
    } catch {
      /* illisible ici : on laisse partir l'original, le serveur tranchera */
    } finally {
      setBusy(false);
    }
    // La jaquette dépliée passe d'abord par la MESURE : c'est elle qui donne
    // ses dimensions au boîtier, et le fichier ne part qu'une fois relevé.
    // On garde donc le fichier de côté plutôt que de l'envoyer tout de suite.
    if (which === "wrap") {
      setFitting({ src: URL.createObjectURL(file), file });
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("which", which);
    push(fd);
  }

  // Une URL distante ne peut pas être mesurée telle quelle : le canvas refuse
  // de lire les pixels d'une image d'un autre domaine. On la fait donc d'abord
  // rapatrier par le serveur, puis on mesure NOTRE copie, de la même origine.
  //
  // L'adresse peut venir de deux endroits — le champ, ou la jaquette désignée
  // dans le sélecteur Cinéma Passion. Le chemin est le même : c'est une URL, on
  // la fait rapatrier, on mesure.
  async function fromUrl(from) {
    const url = typeof from === "string" ? from : typed;
    // Le serveur ne rapatrie que des images : un lien vers un PDF revient avec
    // un « aucune image utilisable », ce qui n'explique rien. On le dit ici,
    // avec la marche à suivre — la conversion se fait dans le navigateur, il
    // faut donc le fichier sous la main.
    if (/\.pdf(\?|#|$)/i.test(url)) {
      alert(
        "Un PDF ne peut pas être rapatrié par son adresse : télécharge-le, puis dépose le fichier — tu pourras alors en choisir la page."
      );
      return;
    }
    if (which !== "wrap") return push({ which, url });
    setBusy(true);
    try {
      const d = await apiFetch(`/collection/${media.slug}/artwork`, {
        method: "POST",
        token,
        body: { which, url },
      });
      setTyped("");
      onChanged();
      setFitting({ src: d.media.wrap, file: null });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Les mesures et l'image partent ENSEMBLE : une jaquette enregistrée sans son
  // gabarit serait découpée selon l'ancien, le temps d'une requête — et ça se
  // verrait sur l'étagère. Quand seule la mesure change (on repositionne la
  // tranche sur la jaquette déjà en place), on n'envoie pas d'image du tout.
  async function applyBox(box) {
    const fd = new FormData();
    if (fitting.file) fd.append("file", fitting.file, fitting.file.name || "wrap.jpg");
    fd.append("which", "wrap");
    fd.append("box", JSON.stringify(box));
    await push(fd);
    if (fitting.file) URL.revokeObjectURL(fitting.src);
    setFitting(null);
  }

  return (
    <div className="adm-coll-art">
      <span className="adm-coll-art-label" title={hint}>
        {label}
      </span>
      <div className={`adm-coll-art-box ${which}`}>
        {current ? <img src={current} alt="" /> : <ImagePlus size={18} />}
        {/* Repères de pliage : on voit d'un coup d'œil si la tranche tombe au
            bon endroit sur la jaquette qu'on vient de coller. */}
        {which === "wrap" && current && (
          <span
            className="adm-coll-folds"
            aria-hidden="true"
            style={
              media.box?.spineW > 0
                ? {
                    "--fold-a": `${media.box.spineX * 100}%`,
                    "--fold-b": `${(media.box.spineX + media.box.spineW) * 100}%`,
                  }
                : undefined
            }
          >
            <i />
            <i />
          </span>
        )}
        {busy && (
          <span className="adm-coll-art-busy">
            <Loader2 size={16} className="spin" />
          </span>
        )}
      </div>
      {lighter && <span className="adm-coll-lighter">{lighter}</span>}
      <div className="adm-coll-inline">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="URL de l'image"
        />
        <button
          className="btn btn-ghost clickable"
          onClick={() => fromUrl()}
          disabled={!typed || busy}
        >
          OK
        </button>
      </div>
      <div className="adm-coll-inline">
        <button
          className="adm-coll-upload clickable"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Image ou PDF — un PDF est converti et tu choisis la page"
        >
          <ImagePlus size={14} /> Image ou PDF
        </button>
        {/* CHERCHER PLUTÔT QUE COLLER. Une jaquette dépliée ne se trouve ni sur
            TMDB ni sur TVmaze (eux n'ont que l'affiche portrait) : il fallait
            aller la pêcher à la main sur cinemapassion, puis copier l'adresse
            de l'image. Ce bouton fait les deux — on cherche, on désigne
            l'édition, et le mesureur s'ouvre dessus. */}
        {which === "wrap" && (
          <button
            className="adm-coll-upload clickable"
            onClick={() => setSearching(true)}
            disabled={busy}
            title="Chercher la jaquette dépliée sur Cinéma Passion"
          >
            <Search size={14} /> Chercher
          </button>
        )}
        {which === "wrap" && current && (
          <button
            className="adm-coll-upload clickable"
            onClick={() => setFitting({ src: current, file: null })}
            disabled={busy}
            title="Repositionner la tranche et régler les dimensions"
          >
            <Crop size={14} /> Mesurer
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        hidden
        onChange={onFile}
      />

      {pdf && (
        <PdfPagePicker
          file={pdf}
          onCancel={() => setPdf(null)}
          onPick={(image) => {
            setPdf(null);
            return takeFile(image);
          }}
        />
      )}

      {searching && (
        <JaquettePicker
          title={media.title}
          token={token}
          onCancel={() => setSearching(false)}
          onPick={(image) => {
            setSearching(false);
            // La suite est celle d'une adresse collée à la main : le serveur
            // rapatrie l'image, puis le mesureur s'ouvre sur NOTRE copie (un
            // canvas ne peut pas lire les pixels d'un autre domaine).
            fromUrl(image);
          }}
        />
      )}

      {fitting && (
        <WrapCropModal
          src={fitting.src}
          media={media}
          onCancel={() => {
            if (fitting.file) URL.revokeObjectURL(fitting.src);
            setFitting(null);
          }}
          onApply={applyBox}
        />
      )}
    </div>
  );
}

const fmtCm = (units) =>
  (units * CM).toFixed(1).replace(".", ",").replace(/,0$/, "");
