import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Disc3,
  DownloadCloud,
  ImagePlus,
  Image as ImageIcon,
  Save,
  Check,
  Barcode,
  Type,
  Tag,
  Ban,
  Wand2,
  Upload,
  Layers,
  Baseline,
  Diamond,
  ChevronUp,
  ChevronDown,
  Undo2,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { paintCase } from "../lib/collection";
import { FONTS } from "../lib/dvdSkin";
import { shrinkImageFile } from "../lib/imageFile";

// ======================================================================
//  LE STUDIO DE JAQUETTE — fabriquer la jaquette d'un boîtier vidéo
// ======================================================================
// ON NE JUGE PAS UNE JAQUETTE SUR UN FORMULAIRE. C'est le point de départ de
// cet écran : les réglages du boîtier existaient déjà, éparpillés dans la fiche
// (la teinte, l'affiche, le bandeau), mais leur effet ne se voyait qu'après
// avoir enregistré, quitté le panneau, retrouvé le titre sur l'étagère et pris
// l'objet en main. Autant dire jamais.
//
// Ici la jaquette est PEINTE À CHAQUE CHANGEMENT, avec exactement le peintre du
// rayon (`paintCase`) : ce qu'on voit est la texture qui habillera le boîtier
// 3D, aux mêmes plis, à la même définition près. Pas de rendu d'aperçu à part —
// un aperçu qui n'est pas l'objet finit toujours par mentir.
//
// L'ÉCRAN EST DÉCOUPÉ COMME L'OBJET : un onglet par face, plus un onglet pour
// le matériel. On choisit la face, on voit la face, on règle la face.
//
// ------------------------------------------------ LES EXPLICATIONS SONT DANS
// ------------------------------------------------ LES BULLES, PAS SUR L'ÉCRAN
// La première version écrivait sous chaque réglage un paragraphe qui disait
// pourquoi il existe. Mis bout à bout, ça faisait plus de texte que de
// commandes : la colonne se lisait comme une notice, et il fallait la parcourir
// entière pour trouver le bouton qu'on cherchait — dans un atelier où l'on
// revient VINGT FOIS régler le même détail.
//
// Tout ce texte est passé en `title=` (bulle au survol). Rien n'est perdu pour
// qui découvre, et l'écran redevient ce qu'il doit être : une planche de
// boutons à côté de l'objet.
//
// ------------------------------------------------ LA TRANCHE SE RÈGLE BLOC À
// ------------------------------------------------ BLOC, COMME UNE MAQUETTE
// C'est la face qu'on VOIT dans le rayon (les deux autres ne se regardent
// qu'une fois l'objet en main), et elle n'avait qu'un seul réglage — le fond —
// là où la couverture en a dix. Elle a maintenant sa liste de blocs : la photo,
// la saga, le titre, le pied, la marque. Chacun s'allume, s'éteint, se règle,
// et les trois blocs de texte se DÉPLACENT l'un par rapport à l'autre.

// La définition de la peinture d'aperçu. Plus basse que celle de la vitrine
// (1408) : on repeint à chaque frappe dans le champ d'édition, et la feuille
// entière fait trois fois la largeur d'une face.
const PREVIEW_QUALITY = 620;

// Le temps qu'on laisse aux doigts avant de repeindre. Une peinture complète
// coûte entre 80 et 300 ms : lancée à chaque caractère, elle transforme le
// champ « mention d'édition » en machine à saccades.
const SETTLE = 220;

// Les trois états d'un bloc. « Auto » n'est pas « allumé » : c'est le gabarit
// qui décide, et c'est ce qui fait qu'un titre jamais réglé garde exactement
// l'allure qu'il avait.
const STATES = [
  { v: "auto", l: "Auto", t: "Le gabarit décide (le comportement d'origine)." },
  { v: "on", l: "Oui", t: "Toujours affiché." },
  { v: "off", l: "Non", t: "Jamais affiché." },
];

const SUMMARIES = [
  { v: "auto", l: "Auto", t: "Les épisodes, les saisons ou des photos, selon le titre." },
  { v: "episodes", l: "Épisodes", t: "Le sommaire, deux colonnes (22 au plus)." },
  { v: "seasons", l: "Saisons", t: "Le sommaire d'un coffret." },
  { v: "stills", l: "Photos", t: "Trois photos d'exploitation." },
];

const LOGO_TINTS = [
  {
    v: "auto",
    l: "Auto",
    t: "Ne repeint qu'un logo monochrome qui se perdrait sur le fond. Un logo en couleur n'est jamais touché.",
  },
  { v: "none", l: "Tel quel", t: "Le fichier d'origine, sans retouche." },
  { v: "white", l: "Blanc", t: "Silhouette blanche — pour un fond sombre." },
  { v: "black", l: "Noir", t: "Silhouette noire — pour un fond clair." },
];

const SPINE_BGS = [
  { v: "image", l: "Image", t: "Le fond tiré des couleurs de la vignette (le défaut)." },
  { v: "flat", l: "Uni", t: "Un aplat franc, sans tons tirés du visuel." },
  { v: "fade", l: "Dégradé", t: "La vignette en tête, qui se perd vers le bas dans la couleur." },
];

const SPINE_FOOTS = [
  { v: "auto", l: "Auto", t: "L'année, à défaut le compte d'épisodes." },
  { v: "year", l: "Année", t: "Les dates de diffusion seules." },
  { v: "count", l: "Compte", t: "Le nombre d'épisodes, de planches, ou la région d'une cartouche." },
  { v: "custom", l: "Texte", t: "Ce que tu écris — un numéro de volume, un éditeur, une édition." },
  { v: "none", l: "Rien", t: "Le pied reste nu ; le titre récupère la course." },
];

const MARKS = [
  { v: "auto", l: "Auto", t: "Le logo du support s'il a été déposé, le losange sinon." },
  { v: "none", l: "Aucune", t: "Rien tout en bas de la tranche." },
];

const ART_POS = [
  { v: "top", l: "En tête", t: "Sous le capuchon, comme sur un boîtier du commerce." },
  { v: "bottom", l: "En pied", t: "La vignette ferme la tranche par le bas." },
];

const TABS = [
  { value: "stock", label: "Matériel", view: "sheet" },
  { value: "front", label: "Couverture", view: "front" },
  { value: "spine", label: "Tranche", view: "spine" },
  { value: "back", label: "Dos", view: "back" },
];

const VIEWS = [
  { value: "sheet", label: "Dépliée" },
  { value: "front", label: "Couverture" },
  { value: "spine", label: "Tranche" },
  { value: "back", label: "Dos" },
];

// L'ordre d'origine des blocs de texte de la tranche. Le même que côté peintre
// (`SPINE_BLOCKS` dans lib/collection.js) — et pour la même raison : ce sont
// des clés, donc une liste incomplète se complète au lieu de perdre un bloc.
const BLOCKS = ["saga", "title", "foot"];

function orderOf(list) {
  const keep = (list || []).filter((k) => BLOCKS.includes(k));
  return [...new Set([...keep, ...BLOCKS])];
}

// Les réglages tels qu'ils partent au serveur. Un objet vide en base (le cas de
// tous les titres d'avant) doit donner exactement le comportement d'avant :
// tout en automatique, logo et code-barres allumés.
function formOf(media) {
  const c = media.caseArt || {};
  return {
    front: c.front || "auto",
    back: c.back || "auto",
    spine: c.spine || "auto",
    summary: c.summary || "auto",
    logoPick: c.logoPick || "auto",
    frontFull: !!c.frontFull,
    backFull: !!c.backFull,
    frontCrop: c.frontCrop ?? null,
    backCrop: c.backCrop ?? null,
    spineBg: c.spineBg || "image",
    logoX: c.logoX ?? 50,
    logoY: c.logoY ?? 72,
    logoSize: c.logoSize ?? 100,
    logoTint: c.logoTint || "auto",
    fontTitle: c.fontTitle || "",
    fontText: c.fontText || "",
    color: c.color || "",
    logo: c.logo !== false,
    barcode: c.barcode !== false,
    edition: c.edition || "",
    discs: c.discs || 0,
    // La tranche, bloc à bloc.
    spineColor: c.spineColor || "",
    spineArt: c.spineArt || "auto",
    spineArtH: c.spineArtH ?? null,
    spineArtPos: c.spineArtPos || "top",
    spineLogo: c.spineLogo || "auto",
    spineLogoPick: c.spineLogoPick || "",
    spineSaga: c.spineSaga || "auto",
    spineFoot: c.spineFoot || "auto",
    spineFootText: c.spineFootText || "",
    spineMark: c.spineMark || "auto",
    spineOrder: orderOf(c.spineOrder),
  };
}

// TOUT LE FONDS, pas seulement les visuels du moment.
//
// La première version listait l'affiche, le bandeau et les photos EN PLACE :
// après un rafraîchissement, les belles images d'avant avaient disparu de la
// liste — elles étaient pourtant toujours sur le disque, simplement plus
// référencées. Le fonds (`media.pool`) les garde toutes, dans l'ordre où elles
// sont arrivées, et c'est lui qu'on montre ici.
function imagesOf(media) {
  const out = [
    { spec: "auto", label: "Auto", src: null },
    { spec: "none", label: "Aucune", src: null },
  ];
  const role = new Map();
  if (media.poster) role.set(media.poster, "Affiche");
  if (media.backdrop) role.set(media.backdrop, "Bandeau");
  (media.stills || []).forEach((s, i) => !role.has(s) && role.set(s, `Photo ${i + 1}`));

  const pool = media.pool || [];
  pool.forEach((src, i) =>
    out.push({ spec: `pool:${i}`, label: role.get(src) || `Image ${i + 1}`, src })
  );

  // Repli pour les fiches d'avant le fonds : tant qu'un rafraîchissement n'a
  // pas eu lieu, `pool` est vide et il n'y aurait rien à choisir.
  if (!pool.length) {
    if (media.poster) out.push({ spec: "poster", label: "Affiche", src: media.poster });
    if (media.backdrop) out.push({ spec: "backdrop", label: "Bandeau", src: media.backdrop });
    (media.stills || []).forEach((src, i) =>
      out.push({ spec: `still:${i}`, label: `Photo ${i + 1}`, src })
    );
  }
  return out;
}

// ----------------------------------------------------------- les commandes --
// Toutes construites sur le même patron : un intitulé COURT à gauche, la
// commande à droite, et l'explication dans la bulle. Une commande qui prend
// deux lignes de haut est une commande qu'on ne peut pas aligner avec les
// autres — et c'est la colonne entière qui devient illisible.

// Un choix parmi trois ou quatre. Remplace les `<select>` : sur un réglage à
// trois valeurs, dérouler une liste pour lire ce qui s'y trouve coûte deux
// gestes là où trois boutons n'en coûtent aucun.
function Seg({ label, value, options, onChange, title }) {
  return (
    <div className="cs-line" title={title}>
      {label && <span className="cs-lab">{label}</span>}
      <div className="cs-seg">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`clickable ${value === o.v ? "on" : ""}`}
            onClick={() => onChange(o.v)}
            title={o.t}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

// Un curseur. On règle en REGARDANT la face à côté, qui se repeint toute seule,
// et la valeur reste lisible pour la retrouver d'un titre à l'autre.
function Slide({ label, value, onChange, min = 0, max = 100, title }) {
  return (
    <label className="cs-line slide" title={title}>
      <span className="cs-lab">
        {label}
        <b>{value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange, title, icon: Icon }) {
  return (
    <label className="cs-line check" title={title}>
      <span className="cs-lab">
        {Icon && <Icon size={12} />}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Text({ label, value, onChange, placeholder, title, max = 40 }) {
  return (
    <label className="cs-line" title={title}>
      <span className="cs-lab">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={max}
      />
    </label>
  );
}

// UNE COULEUR, ET LE MOYEN DE LA RENDRE. Le bouton de retour compte autant que
// le nuancier : sans lui, poser une couleur est un aller sans retour (il n'y a
// pas de « vide » dans un `<input type="color">`), et on n'ose plus y toucher.
function Swatch({ label, value, fallback, onChange, title }) {
  return (
    <div className="cs-line" title={title}>
      <span className="cs-lab">{label}</span>
      <div className="cs-swatch">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
        />
        {value && (
          <button
            type="button"
            className="clickable cs-undo"
            onClick={() => onChange("")}
            title="Revenir à la valeur héritée"
          >
            <Undo2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// Le choix d'une image : les vignettes en grille, la retenue cerclée. Un
// `<select>` de noms de fichiers ne dirait rien — on choisit une image en la
// REGARDANT.
function ImagePick({ images, value, onPick, onDrop, busy }) {
  return (
    <div className="cs-pick">
      <div className="cs-thumbs">
        {images.map((im) => (
          <button
            key={im.spec}
            type="button"
            className={`cs-thumb clickable ${value === im.spec ? "on" : ""} ${
              im.src ? "" : "flat"
            }`}
            onClick={() => onPick(im.spec)}
            title={im.label}
          >
            {im.src ? (
              <img src={im.src} alt="" loading="lazy" />
            ) : im.spec === "auto" ? (
              <Wand2 size={14} />
            ) : (
              <Ban size={14} />
            )}
          </button>
        ))}
        {onDrop && (
          <button
            type="button"
            className="cs-thumb clickable flat drop"
            onClick={onDrop}
            disabled={busy}
            title="Déposer une image à soi (elle entre au fonds)"
          >
            <Upload size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// UN BLOC DE LA MAQUETTE. Le rang se replie : ouverts, les cinq blocs de la
// tranche font trois écrans de haut, et on ne voit plus l'objet qu'on règle.
// L'interrupteur, lui, reste TOUJOURS visible sur le rang fermé — c'est le
// geste le plus fréquent, il ne doit jamais demander un clic de plus.
function Block({
  icon: Icon,
  label,
  states = STATES,
  state,
  onState,
  open,
  onOpen,
  onMove,
  children,
  title,
}) {
  return (
    <div className={`cs-block ${open ? "open" : ""}`}>
      <div className="cs-block-head">
        <button
          type="button"
          className="cs-block-name clickable"
          onClick={() => onOpen(!open)}
          title={title}
          disabled={!children}
        >
          <Icon size={13} />
          {label}
          {children && (open ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
        {onMove && (
          <span className="cs-move">
            <button
              type="button"
              className="clickable"
              onClick={() => onMove(-1)}
              title="Monter ce bloc"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              className="clickable"
              onClick={() => onMove(1)}
              title="Descendre ce bloc"
            >
              <ChevronDown size={12} />
            </button>
          </span>
        )}
        <div className="cs-seg tiny">
          {states.map((o) => (
            <button
              key={o.v}
              type="button"
              className={`clickable ${state === o.v ? "on" : ""}`}
              onClick={() => onState(o.v)}
              title={o.t}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
      {open && children && <div className="cs-block-body">{children}</div>}
    </div>
  );
}

export default function CaseStudioModal({ media, token, onClose, onChanged }) {
  const [form, setForm] = useState(() => formOf(media));
  const [tab, setTab] = useState("stock");
  const [view, setView] = useState("sheet");
  const [open, setOpen] = useState("");
  const [art, setArt] = useState(null);
  const [painting, setPainting] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const dropRef = useRef(null);
  const dropFace = useRef("front");

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Changer d'onglet TOURNE L'OBJET. C'est le geste qu'on ferait avec un vrai
  // boîtier en main, et ça évite d'avoir à régler la tranche en regardant la
  // couverture. Les boutons de vue restent là pour comparer sans quitter
  // l'onglet.
  function goTab(next) {
    setTab(next);
    setView(TABS.find((t) => t.value === next)?.view || "sheet");
  }

  const images = useMemo(() => imagesOf(media), [media]);
  const ink = media.color || "#f2b70b";

  // Le média tel qu'il serait EN BASE avec les réglages du moment : c'est lui
  // qu'on peint, et c'est ce qui rend l'aperçu honnête — le peintre ne sait pas
  // qu'il travaille pour une modale.
  const preview = useMemo(() => ({ ...media, caseArt: form }), [media, form]);

  // ------------------------------------------------------------ peinture --
  useEffect(() => {
    let alive = true;
    setPainting(true);
    const timer = setTimeout(() => {
      paintCase(preview, PREVIEW_QUALITY)
        .then((got) => alive && setArt(got))
        .catch(() => alive && setArt(null))
        .finally(() => alive && setPainting(false));
    }, SETTLE);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [preview]);

  // La feuille est UNE image de trois faces cousues ; `cuts` dit où tombent les
  // plis. Montrer une face, c'est donc recopier la bonne tranche de la feuille —
  // et surtout pas repeindre cette face à part, ce qui donnerait un aperçu qui
  // n'est plus l'objet.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !art?.sheet) return;
    const sheet = art.sheet;
    const sw = sheet.width || sheet.naturalWidth;
    const sh = sheet.height || sheet.naturalHeight;
    const { x, w } = art.cuts;

    const crop =
      view === "front"
        ? { sx: (x + w) * sw, sw: (1 - x - w) * sw }
        : view === "spine"
          ? { sx: x * sw, sw: w * sw }
          : view === "back"
            ? { sx: 0, sw: x * sw }
            : { sx: 0, sw };

    canvas.width = Math.max(2, Math.round(crop.sw));
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sheet, crop.sx, 0, crop.sw, sh, 0, 0, canvas.width, canvas.height);
  }, [art, view]);

  useEffect(draw, [draw]);

  // ------------------------------------------------------- le matériel --
  async function grab() {
    setFetching(true);
    setNote("");
    try {
      const d = await apiFetch(`/collection/${media.slug}/case-meta`, {
        method: "POST",
        token,
      });
      const f = d.found;
      setNote(
        [
          f.logo ? "logo" : null,
          f.stills ? `${f.stills} photo${f.stills > 1 ? "s" : ""}` : null,
          f.studios ? `${f.studios} studio${f.studios > 1 ? "s" : ""}` : null,
          f.seasons ? `${f.seasons} saison${f.seasons > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "TMDB n'avait rien de plus pour ce titre."
      );
      onChanged(d.media);
    } catch (e) {
      setNote(e.message);
    } finally {
      setFetching(false);
    }
  }

  // Le logo posé à la main : le seul visuel qu'on remplace depuis ici, parce
  // que c'est le seul dont l'absence se voit sur la face — et que TMDB n'en a
  // pour aucune web-série.
  async function putLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setFetching(true);
    setNote("");
    try {
      const { file: light } = await shrinkImageFile(file).catch(() => ({ file }));
      const fd = new FormData();
      fd.append("file", light);
      fd.append("which", "logo");
      const d = await apiUpload(`/collection/${media.slug}/artwork`, fd, token);
      onChanged(d.media);
    } catch (err) {
      setNote(err.message);
    } finally {
      setFetching(false);
    }
  }

  // DÉPOSER UNE IMAGE POUR UNE FACE. Elle entre au FONDS — pas dans l'affiche
  // ni dans le bandeau : une couverture toute faite n'est ni l'une ni l'autre,
  // et la faire passer pour une affiche la ferait apparaître dans les grilles et
  // sur la fiche du titre, où elle n'a rien à faire.
  function drop(face) {
    dropFace.current = face;
    dropRef.current?.click();
  }

  async function onDropFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const face = dropFace.current;
    setFetching(true);
    setNote("");
    try {
      const { file: light } = await shrinkImageFile(file).catch(() => ({ file }));
      const fd = new FormData();
      fd.append("file", light);
      fd.append("which", "pool");
      const d = await apiUpload(`/collection/${media.slug}/artwork`, fd, token);
      // Elle est la dernière du fonds : c'est ce rang qu'on désigne.
      const rank = Math.max(0, (d.media.pool?.length || 1) - 1);
      set(face, `pool:${rank}`);
      onChanged(d.media);
    } catch (err) {
      setNote(err.message);
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const d = await apiFetch(`/collection/${media.slug}/case-art`, {
        method: "PUT",
        token,
        body: {
          ...form,
          discs: Number(form.discs) || 0,
          spineArtH: form.spineArtH === null ? "" : Number(form.spineArtH),
        },
      });
      onChanged(d.media);
      onClose();
    } catch (e) {
      setNote(e.message);
      setSaving(false);
    }
  }

  // Déplacer un bloc de texte de la tranche. La liste est toujours complète
  // (`orderOf`), donc un échange de deux voisins suffit — pas de trou possible.
  function move(key, dir) {
    setForm((f) => {
      const list = orderOf(f.spineOrder);
      const i = list.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return f;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, spineOrder: next };
    });
  }

  // Ce dont la face dispose vraiment. C'est la première question qu'on se pose
  // devant un dos vide (« il manque quoi ? »).
  const has = {
    logo: !!media.logo,
    stills: media.stills?.length || 0,
    studios: media.studios?.length || 0,
    seasons: media.seasons?.length || 0,
    episodes: media.caseEpisodes?.length || 0,
  };

  const logos = media.logos || [];

  // Les rangs de la tranche, dans l'ordre choisi. Chacun sait se peindre :
  // c'est la même liste que celle du peintre, à la même place.
  const spineBlocks = {
    saga: (
      <Block
        key="saga"
        icon={Tag}
        label="Saga"
        state={form.spineSaga}
        onState={(v) => set("spineSaga", v)}
        onMove={(d) => move("saga", d)}
        open={false}
        onOpen={() => {}}
        title={
          media.franchise
            ? `« ${media.franchise} », en petites capitales sous le filet de tête.`
            : "Aucune saga sur ce titre : le bloc reste vide."
        }
      />
    ),
    title: (
      <Block
        key="title"
        icon={Type}
        label="Titre"
        states={[
          { v: "auto", l: "Auto", t: "Le logo s'il tient dans la course, la didone sinon." },
          { v: "on", l: "Logo", t: "Le logo du titre, toujours." },
          { v: "off", l: "Texte", t: "Le titre composé en didone, toujours." },
        ]}
        state={form.spineLogo}
        onState={(v) => set("spineLogo", v)}
        onMove={(d) => move("title", d)}
        open={open === "title"}
        onOpen={(o) => setOpen(o ? "title" : "")}
        title="Le bloc principal : le logo du titre, ou le titre composé. Il prend toute la course que les autres blocs laissent."
      >
        {/* LE LOGO DE LA TRANCHE N'EST PAS CELUI DE LA COUVERTURE. Un lettrage
            large tient sur une face de 620 px et devient un trait gris dans une
            colonne de 55 : il faut pouvoir en désigner un autre, sans toucher à
            la couverture. */}
        <div className="cs-pick">
          <span className="cs-lab">Lequel</span>
          <div className="cs-thumbs logos">
            <button
              type="button"
              className={`cs-thumb clickable flat ${form.spineLogoPick ? "" : "on"}`}
              onClick={() => set("spineLogoPick", "")}
              title="Le même que la couverture"
            >
              <Wand2 size={14} />
            </button>
            {logos.map((src, i) => (
              <button
                key={src}
                type="button"
                className={`cs-thumb clickable ${
                  form.spineLogoPick === `logos:${i}` ? "on" : ""
                }`}
                onClick={() => set("spineLogoPick", `logos:${i}`)}
                title={`Logo ${i + 1}`}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </Block>
    ),
    foot: (
      <Block
        key="foot"
        icon={Baseline}
        label="Pied"
        states={SPINE_FOOTS}
        state={form.spineFoot}
        onState={(v) => set("spineFoot", v)}
        onMove={(d) => move("foot", d)}
        open={form.spineFoot === "custom"}
        onOpen={() => {}}
        title="La mention du bas : l'année, le compte, un texte à soi, ou rien."
      >
        {form.spineFoot === "custom" && (
          <Text
            label="Texte"
            value={form.spineFootText}
            onChange={(v) => set("spineFootText", v)}
            placeholder="VOL. 3"
            max={30}
            title="Écrit en capitales espacées, comme l'année qu'il remplace."
          />
        )}
      </Block>
    ),
  };

  return (
    <div className="casestudio" onClick={onClose}>
      <div
        className="casestudio-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Studio de jaquette"
      >
        <header>
          <span className="casestudio-icon">
            <Disc3 size={18} />
          </span>
          <div className="casestudio-titles">
            <h3>Studio de jaquette</h3>
            <p>{media.title}</p>
          </div>
          <button className="adm-coll-icon clickable" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>

        <div className="casestudio-body">
          {/* ---------------------------------------------------- l'objet -- */}
          <div className="casestudio-stage">
            <div className="casestudio-views">
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  className={`clickable ${view === v.value ? "on" : ""}`}
                  onClick={() => setView(v.value)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className={`casestudio-view ${view}`}>
              <canvas ref={canvasRef} />
              {painting && (
                <span className="casestudio-wait">
                  <Loader2 size={18} className="spin" />
                </span>
              )}
            </div>
            {media.wrap && (
              <p className="casestudio-warn">
                Une jaquette dépliée est en place : c'est ELLE qui habille le boîtier, et le
                gabarit ci-contre ne s'applique pas.
              </p>
            )}
          </div>

          {/* -------------------------------------------------- les leviers -- */}
          <div className="casestudio-panel">
            <div className="casestudio-tabs">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  className={`clickable ${tab === t.value ? "on" : ""}`}
                  onClick={() => goTab(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "stock" && (
              <section>
                <ul className="casestudio-stock">
                  <li className={has.logo ? "on" : ""} title="Le lettrage du titre, détouré">
                    {has.logo ? <Check size={13} /> : <X size={13} />} Logo
                  </li>
                  <li className={has.stills ? "on" : ""} title="Les photos d'exploitation">
                    {has.stills ? <Check size={13} /> : <X size={13} />} {has.stills} photo
                    {has.stills > 1 ? "s" : ""}
                  </li>
                  <li className={has.studios ? "on" : ""} title="Les marques de studio du pied">
                    {has.studios ? <Check size={13} /> : <X size={13} />} {has.studios} studio
                    {has.studios > 1 ? "s" : ""}
                  </li>
                  <li className={has.seasons ? "on" : ""} title="Le sommaire d'un coffret">
                    {has.seasons ? <Check size={13} /> : <X size={13} />} {has.seasons} saison
                    {has.seasons > 1 ? "s" : ""}
                  </li>
                  <li className={has.episodes ? "on" : ""} title="Les titres d'épisodes du dos">
                    {has.episodes ? <Check size={13} /> : <X size={13} />} {has.episodes} épisode
                    {has.episodes > 1 ? "s" : ""}
                  </li>
                </ul>

                <div className="casestudio-row">
                  <button
                    className="btn btn-ghost clickable"
                    onClick={grab}
                    disabled={fetching}
                    title="Logo, photos, studios et saisons, récupérés sur TMDB. Rien n'est effacé : tout entre au fonds."
                  >
                    {fetching ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <DownloadCloud size={14} />
                    )}
                    TMDB
                  </button>
                  <button
                    className="btn btn-ghost clickable"
                    onClick={() => fileRef.current?.click()}
                    disabled={fetching}
                    title="Poser un logo détouré à la main (PNG transparent)"
                  >
                    <ImagePlus size={14} /> Logo
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={putLogo} />
                </div>
                {note && <p className="casestudio-note">{note}</p>}

                {/* Les logos déjà récupérés : TMDB en rend un différent d'une
                    fois sur l'autre, ils sont tous gardés. */}
                {logos.length > 1 && (
                  <div className="cs-pick">
                    <span className="cs-lab">Logo du titre</span>
                    <div className="cs-thumbs logos">
                      {logos.map((src, i) => (
                        <button
                          key={src}
                          type="button"
                          className={`cs-thumb clickable ${
                            form.logoPick === `logos:${i}` ||
                            (form.logoPick === "auto" && src === media.logo)
                              ? "on"
                              : ""
                          }`}
                          onClick={() => set("logoPick", `logos:${i}`)}
                          title={`Logo ${i + 1}`}
                        >
                          <img src={src} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <Swatch
                  label="Couleur du boîtier"
                  value={form.color}
                  fallback={ink}
                  onChange={(v) => set("color", v)}
                  title="Un aplat servi tel quel : le fond des faces sans image, et l'encre des filets et des petites mentions. Vide = la teinte de la fiche, assombrie."
                />

                {/* Deux fontes, jamais trois : celle des titres et celle du
                    texte. La didone du gabarit va bien à un drame et très mal à
                    une comédie potache. */}
                <div className="cs-line" title="La fonte des titres et des grandes mentions.">
                  <span className="cs-lab">
                    <Baseline size={12} /> Titres
                  </span>
                  <select value={form.fontTitle} onChange={(e) => set("fontTitle", e.target.value)}>
                    <option value="">Didone</option>
                    {Object.entries(FONTS).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cs-line" title="La fonte du résumé, du sommaire et du cartouche.">
                  <span className="cs-lab">
                    <Baseline size={12} /> Texte
                  </span>
                  <select value={form.fontText} onChange={(e) => set("fontText", e.target.value)}>
                    <option value="">Neutre</option>
                    {Object.entries(FONTS).map(([k, f]) => (
                      <option key={k} value={k}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            )}

            {tab === "front" && (
              <section>
                <ImagePick
                  images={images}
                  value={form.front}
                  onPick={(v) => set("front", v)}
                  onDrop={() => drop("front")}
                  busy={fetching}
                />
                {form.front === "none" && (
                  <Swatch
                    label="Couleur"
                    value={form.color}
                    fallback={ink}
                    onChange={(v) => set("color", v)}
                    title="Le fond de la face, servi tel quel."
                  />
                )}

                <Toggle
                  icon={Layers}
                  label="Image toute faite"
                  checked={form.frontFull}
                  onChange={(v) => set("frontFull", v)}
                  title="L'image couvre la face entière et RIEN n'est composé dessus — ni logo, ni pied, ni mention. C'est ce qu'il faut à une couverture trouvée ailleurs."
                />

                {!form.frontFull && (
                  <>
                    <Slide
                      label="Cadrage"
                      value={form.frontCrop === null ? 28 : form.frontCrop}
                      onChange={(v) => set("frontCrop", v)}
                      title="Ce qu'on garde en hauteur : 0 colle en haut de l'image, 100 en bas. C'est ce réglage, et pas l'image, qui rend la plupart des visuels moches."
                    />

                    <Toggle
                      icon={Type}
                      label="Logo du titre"
                      checked={form.logo}
                      onChange={(v) => set("logo", v)}
                      title="Coupé, le titre est composé dans la police choisie."
                    />

                    {form.logo && (
                      <>
                        <Slide
                          label="Gauche / droite"
                          value={form.logoX}
                          onChange={(v) => set("logoX", v)}
                        />
                        <Slide
                          label="Haut / bas"
                          value={form.logoY}
                          onChange={(v) => set("logoY", v)}
                        />
                        <Slide
                          label="Taille"
                          min={20}
                          max={160}
                          value={form.logoSize}
                          onChange={(v) => set("logoSize", v)}
                        />
                        <Seg
                          label="Détourage"
                          value={form.logoTint}
                          options={LOGO_TINTS}
                          onChange={(v) => set("logoTint", v)}
                          title="Faut-il repeindre le logo pour qu'il se détache du fond ?"
                        />
                      </>
                    )}

                    <Text
                      label="Édition"
                      value={form.edition}
                      onChange={(v) => set("edition", v)}
                      placeholder="L'intégrale · 26 épisodes"
                      title="La mention imprimée en tête de couverture. Vide = déduite du contenu."
                    />
                  </>
                )}
              </section>
            )}

            {/* ============================================ LA TRANCHE ====== */}
            {tab === "spine" && (
              <section>
                <Seg
                  label="Fond"
                  value={form.spineBg}
                  options={SPINE_BGS}
                  onChange={(v) => set("spineBg", v)}
                  title="D'où vient la couleur du fond de la tranche."
                />
                <Swatch
                  label="Couleur"
                  value={form.spineColor}
                  fallback={form.color || ink}
                  onChange={(v) => set("spineColor", v)}
                  title="La couleur de la TRANCHE SEULE — une étagère se range à ces couleurs-là, et rien n'oblige celle-ci à être l'encre du dos. Vide = celle du boîtier."
                />

                <div className="cs-blocks">
                  {/* La photo est épinglée : ce n'est pas un bloc de texte, elle
                      se pose à fond perdu contre un bord. Elle choisit LEQUEL. */}
                  <Block
                    icon={ImageIcon}
                    label="Photo"
                    state={form.spineArt}
                    onState={(v) => set("spineArt", v)}
                    open={open === "art"}
                    onOpen={(o) => setOpen(o ? "art" : "")}
                    title="La vignette à fond perdu — la seule chose qu'on reconnaisse de loin dans un rayon."
                  >
                    <ImagePick
                      images={images}
                      value={form.spine}
                      onPick={(v) => set("spine", v)}
                      onDrop={() => drop("spine")}
                      busy={fetching}
                    />
                    <Slide
                      label="Hauteur"
                      min={4}
                      max={60}
                      value={form.spineArtH ?? 22}
                      onChange={(v) => set("spineArtH", v)}
                      title="En pour-cent de la tranche. Un gros plan tient en 12 %, un plan large n'est lisible qu'à 35 %."
                    />
                    <Seg
                      label="Place"
                      value={form.spineArtPos}
                      options={ART_POS}
                      onChange={(v) => set("spineArtPos", v)}
                    />
                  </Block>

                  {orderOf(form.spineOrder).map((k) => spineBlocks[k])}

                  <Block
                    icon={Diamond}
                    label="Marque"
                    states={MARKS}
                    state={form.spineMark}
                    onState={(v) => set("spineMark", v)}
                    open={false}
                    onOpen={() => {}}
                    title="Le logo du support (déposé dans client/public/case/) ou, à défaut, le losange de collection."
                  />
                </div>
              </section>
            )}

            {tab === "back" && (
              <section>
                <ImagePick
                  images={images}
                  value={form.back}
                  onPick={(v) => set("back", v)}
                  onDrop={() => drop("back")}
                  busy={fetching}
                />
                {form.back === "none" && (
                  <Swatch
                    label="Couleur"
                    value={form.color}
                    fallback={ink}
                    onChange={(v) => set("color", v)}
                    title="Le fond du dos, servi tel quel."
                  />
                )}

                <Toggle
                  icon={Layers}
                  label="Image toute faite"
                  checked={form.backFull}
                  onChange={(v) => set("backFull", v)}
                  title="L'image couvre la face entière : ni résumé, ni sommaire, ni cartouche, ni code-barres."
                />

                {!form.backFull && (
                  <>
                    <Slide
                      label="Cadrage"
                      value={form.backCrop === null ? 40 : form.backCrop}
                      onChange={(v) => set("backCrop", v)}
                      title="Ce qu'on garde en hauteur dans la bande photo du haut."
                    />
                    <Seg
                      label="Sommaire"
                      value={form.summary}
                      options={SUMMARIES}
                      onChange={(v) => set("summary", v)}
                      title="Ce qui s'imprime au milieu du dos."
                    />
                    <div className="cs-line" title="0 = déduit du nombre d'épisodes (six par galette).">
                      <span className="cs-lab">Disques</span>
                      <input
                        type="number"
                        min="0"
                        max="12"
                        value={form.discs}
                        onChange={(e) => set("discs", e.target.value)}
                      />
                    </div>
                    <Toggle
                      icon={Barcode}
                      label="Code-barres"
                      checked={form.barcode}
                      onChange={(v) => set("barcode", v)}
                      title="Un numéro dérivé du slug, stable, qui ne prétend rien encoder."
                    />
                  </>
                )}
              </section>
            )}
          </div>
        </div>

        <input ref={dropRef} type="file" accept="image/*" hidden onChange={onDropFile} />

        <footer className="casestudio-foot">
          <button className="btn btn-ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary clickable" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  );
}
