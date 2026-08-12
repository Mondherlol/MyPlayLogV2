import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Disc3,
  DownloadCloud,
  ImagePlus,
  Save,
  Check,
  Barcode,
  Type,
  Ban,
  Wand2,
  Upload,
  Layers,
  Baseline,
  X,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { paintCase } from "../lib/collection";
import { FONTS } from "../lib/dvdSkin";
import { shrinkImageFile } from "../lib/imageFile";

// ======================================================================
//  LE MINI-STUDIO — fabriquer la jaquette d'un boîtier vidéo
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
// le matériel. La première version alignait tous les réglages dans une seule
// colonne, et on ne savait pas lequel agissait sur quoi — « image de fond »,
// c'est le fond de QUELLE face ? Maintenant on choisit la face, on voit la
// face, on règle la face.
//
// CHAQUE FACE MONTRE LES IMAGES DISPONIBLES et laisse en désigner une. C'est le
// manque le plus criant de la première version : le matériel était récupéré, on
// voyait bien « 4 photos » écrit quelque part, mais rien ne disait à quoi elles
// ressemblaient ni comment en mettre une plutôt qu'une autre au dos.

// La définition de la peinture d'aperçu. Plus basse que celle de la vitrine
// (1408) : on repeint à chaque frappe dans le champ d'édition, et la feuille
// entière fait trois fois la largeur d'une face.
const PREVIEW_QUALITY = 620;

// Le temps qu'on laisse aux doigts avant de repeindre. Une peinture complète
// coûte entre 80 et 300 ms : lancée à chaque caractère, elle transforme le
// champ « mention d'édition » en machine à saccades.
const SETTLE = 220;

const SUMMARIES = [
  { value: "auto", label: "Automatique", hint: "Les épisodes, les saisons ou des photos, selon le titre." },
  { value: "episodes", label: "Les épisodes", hint: "Le sommaire, deux colonnes (22 au plus)." },
  { value: "seasons", label: "Les saisons", hint: "Le sommaire d'un coffret." },
  { value: "stills", label: "Des photos", hint: "Trois photos d'exploitation." },
];

const LOGO_TINTS = [
  {
    value: "auto",
    label: "Automatique",
    hint: "Ne repeint qu'un logo monochrome qui se perdrait sur le fond. Un logo en couleur n'est jamais touché.",
  },
  { value: "none", label: "Tel quel", hint: "Le fichier d'origine, sans retouche." },
  { value: "white", label: "Détouré en blanc", hint: "Silhouette blanche — pour un fond sombre." },
  { value: "black", label: "Détouré en noir", hint: "Silhouette noire — pour un fond clair." },
];

const SPINE_BGS = [
  {
    value: "image",
    label: "Tons de l'image",
    hint: "La vignette en tête, et le fond tiré de ses couleurs. Le réglage d'origine.",
  },
  { value: "flat", label: "Couleur unie", hint: "Un aplat franc, sans vignette ni tons." },
  {
    value: "fade",
    label: "Dégradé vers la couleur",
    hint: "La vignette en tête, qui se perd vers le bas dans la couleur du boîtier.",
  },
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
  };
}

// TOUT LE FONDS, pas seulement les visuels du moment.
//
// La première version listait l'affiche, le bandeau et les photos EN PLACE :
// après un rafraîchissement, les belles images d'avant avaient disparu de la
// liste — elles étaient pourtant toujours sur le disque, simplement plus
// référencées. Le fonds (`media.pool`) les garde toutes, dans l'ordre où elles
// sont arrivées, et c'est lui qu'on montre ici.
//
// Les visuels en place sont juste SIGNALÉS au passage (« Affiche », « Bandeau »)
// : ce sont les mêmes images, désignées par le même rang — pas des doublons.
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

// Le choix d'une image pour une face : les vignettes en grille, la retenue
// cerclée. Un `<select>` de noms de fichiers ne dirait rien — on choisit une
// image en la REGARDANT.
function ImagePick({ images, value, onPick, hint, onDrop, busy }) {
  return (
    <div className="casestudio-pick">
      <span className="casestudio-pick-head">
        Image de cette face
        {/* DÉPOSER SA PROPRE IMAGE, DEPUIS LA FACE QU'ON RÈGLE. Elle entre au
            fonds (elle n'est ni une affiche ni un bandeau : la faire passer
            pour tel fausserait la fiche) et se pose aussitôt ici. */}
        {onDrop && (
          <button className="casestudio-drop clickable" onClick={onDrop} disabled={busy}>
            <Upload size={12} /> Déposer
          </button>
        )}
      </span>
      <div className="casestudio-thumbs">
        {images.map((im) => (
          <button
            key={im.spec}
            className={`casestudio-thumb clickable ${value === im.spec ? "on" : ""} ${
              im.src ? "" : "flat"
            }`}
            onClick={() => onPick(im.spec)}
            title={im.label}
          >
            {im.src ? (
              <img src={im.src} alt="" loading="lazy" />
            ) : im.spec === "auto" ? (
              <Wand2 size={16} />
            ) : (
              <Ban size={16} />
            )}
            <em>{im.label}</em>
          </button>
        ))}
      </div>
      {hint && <p className="casestudio-hint">{hint}</p>}
    </div>
  );
}

// Un curseur, son intitulé et sa valeur. Trois curseurs valent mieux qu'un
// éditeur à la souris ici : on règle en REGARDANT la face à côté, qui se
// repeint toute seule, et un chiffre se retrouve d'un titre à l'autre.
function Slider({ label, value, onChange, min = 0, max = 100, hint }) {
  return (
    <label className="casestudio-slider">
      <span>
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
      {hint && <em>{hint}</em>}
    </label>
  );
}

// LA COULEUR UNIE. Servie AU PIXEL PRÈS par le peintre dès qu'elle est posée
// (voir `flatBg`) : c'est le fond des faces sans image, et l'encre des filets et
// des petites mentions partout ailleurs. Le texte bascule tout seul au noir si
// la couleur est claire — sans quoi « choisir sa couleur » aurait voulu dire
// « choisir parmi les teintes sombres ».
//
// Le champ apparaît à DEUX endroits : dans le matériel (c'est un réglage de
// l'objet entier) et sous le choix d'image d'une face passée à « Aucune » —
// c'est là qu'on se pose la question, et aller la chercher dans un autre onglet
// serait absurde.
function InkField({ value, fallback, onChange }) {
  return (
    <label className="casestudio-field">
      <span>Couleur unie du boîtier</span>
      <div className="casestudio-ink">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          maxLength={7}
        />
        {value && (
          <button className="btn btn-ghost clickable" onClick={() => onChange("")}>
            Teinte de la fiche
          </button>
        )}
      </div>
      <em>
        Un aplat, servi tel quel : le fond des faces sans image, et l'encre des filets et
        des petites mentions. Vide = la teinte de la fiche, assombrie.
      </em>
    </label>
  );
}

export default function CaseStudioModal({ media, token, onClose, onChanged }) {
  const [form, setForm] = useState(() => formOf(media));
  const [tab, setTab] = useState("stock");
  const [view, setView] = useState("sheet");
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

  // Le champ de couleur suit la face qu'on règle : il n'apparaît sous le choix
  // d'image que si cette face est passée à « Aucune », donc au moment précis où
  // la question se pose.
  const inkFor = (face) =>
    form[face] === "none" ? (
      <InkField value={form.color} fallback={ink} onChange={(v) => set("color", v)} />
    ) : null;

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
  // sur la fiche du titre, où elle n'a rien à faire. Elle est ensuite désignée
  // pour la face qu'on réglait, puisque c'est de là qu'on l'a déposée.
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
        body: { ...form, discs: Number(form.discs) || 0 },
      });
      onChanged(d.media);
      onClose();
    } catch (e) {
      setNote(e.message);
      setSaving(false);
    }
  }

  // Ce dont la face dispose vraiment. Affiché tel quel : c'est la première
  // question qu'on se pose devant un dos vide (« il manque quoi ? »), et la
  // réponse était jusqu'ici invisible.
  const has = {
    logo: !!media.logo,
    stills: media.stills?.length || 0,
    studios: media.studios?.length || 0,
    seasons: media.seasons?.length || 0,
    episodes: media.caseEpisodes?.length || 0,
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
                Une jaquette dépliée est en place sur ce titre : c'est ELLE qui habille le
                boîtier, et le gabarit ci-dessous ne s'applique pas. Retire-la pour repasser
                au gabarit.
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
                <h4>Le matériel</h4>
                <p className="casestudio-hint">
                  Le logo du titre, les photos d'exploitation et la marque du studio : c'est
                  ce qui fait la différence entre une affiche recadrée et un boîtier. Tout
                  vient de TMDB, en un clic.
                </p>
                <ul className="casestudio-stock">
                  <li className={has.logo ? "on" : ""}>
                    {has.logo ? <Check size={13} /> : <X size={13} />} Logo du titre
                  </li>
                  <li className={has.stills ? "on" : ""}>
                    {has.stills ? <Check size={13} /> : <X size={13} />} {has.stills} photo
                    {has.stills > 1 ? "s" : ""}
                  </li>
                  <li className={has.studios ? "on" : ""}>
                    {has.studios ? <Check size={13} /> : <X size={13} />} {has.studios} studio
                    {has.studios > 1 ? "s" : ""}
                  </li>
                  <li className={has.seasons ? "on" : ""}>
                    {has.seasons ? <Check size={13} /> : <X size={13} />} {has.seasons} saison
                    {has.seasons > 1 ? "s" : ""}
                  </li>
                  <li className={has.episodes ? "on" : ""}>
                    {has.episodes ? <Check size={13} /> : <X size={13} />} {has.episodes} titre
                    {has.episodes > 1 ? "s" : ""} d'épisode
                  </li>
                </ul>
                <div className="casestudio-row">
                  <button className="btn btn-ghost clickable" onClick={grab} disabled={fetching}>
                    {fetching ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <DownloadCloud size={14} />
                    )}
                    Récupérer sur TMDB
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

                {/* LES LOGOS DÉJÀ RÉCUPÉRÉS. TMDB en rend un différent d'une
                    fois sur l'autre — parfois celui d'une édition étrangère, ou
                    d'une saison précise. Ils sont tous gardés : on reprend celui
                    qui allait bien au lieu de relancer jusqu'à retomber dessus. */}
                {(media.logos?.length || 0) > 1 && (
                  <div className="casestudio-pick">
                    <span className="casestudio-pick-head">Logo du titre</span>
                    <div className="casestudio-thumbs logos">
                      {media.logos.map((src, i) => (
                        <button
                          key={src}
                          className={`casestudio-thumb clickable ${
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

                <InkField value={form.color} fallback={ink} onChange={(v) => set("color", v)} />

                {/* LES POLICES. Deux, jamais trois : celle des titres et celle
                    du texte. La didone du gabarit va bien à un drame et très mal
                    à une comédie potache, et personne ne pouvait en changer. */}
                <div className="casestudio-duo">
                  <label className="casestudio-field">
                    <span>
                      <Baseline size={12} /> Police des titres
                    </span>
                    <select
                      value={form.fontTitle}
                      onChange={(e) => set("fontTitle", e.target.value)}
                    >
                      <option value="">Didone (défaut)</option>
                      {Object.entries(FONTS).map(([k, f]) => (
                        <option key={k} value={k}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="casestudio-field">
                    <span>
                      <Baseline size={12} /> Police du texte
                    </span>
                    <select
                      value={form.fontText}
                      onChange={(e) => set("fontText", e.target.value)}
                    >
                      <option value="">Neutre (défaut)</option>
                      {Object.entries(FONTS).map(([k, f]) => (
                        <option key={k} value={k}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            )}

            {tab === "front" && (
              <section>
                <h4>La couverture</h4>
                <ImagePick
                  images={images}
                  value={form.front}
                  onPick={(v) => set("front", v)}
                  onDrop={() => drop("front")}
                  busy={fetching}
                  hint="Auto : le bandeau quand un logo est posé (sinon le titre serait écrit deux fois), l'affiche telle quelle sinon."
                />
                {inkFor("front")}

                {/* UNE COUVERTURE TOUTE FAITE SE POSE ET ON N'Y TOUCHE PAS.
                    C'est tout l'intérêt d'en déposer une : elle a été composée
                    ailleurs, avec son titre et ses mentions. */}
                <label className="casestudio-check">
                  <input
                    type="checkbox"
                    checked={form.frontFull}
                    onChange={(e) => set("frontFull", e.target.checked)}
                  />
                  <span>
                    <Layers size={13} /> Couverture toute faite
                  </span>
                  <em>
                    L'image couvre la face entière et RIEN n'est composé dessus — ni logo, ni
                    pied, ni mention.
                  </em>
                </label>

                {!form.frontFull && (
                  <>
                    <Slider
                      label="Cadrage de l'image"
                      value={form.frontCrop === null ? 28 : form.frontCrop}
                      onChange={(v) => set("frontCrop", v)}
                      hint="Ce qu'on garde en hauteur : 0 colle en haut de l'image, 100 en bas. C'est ce réglage, et pas l'image, qui rend la plupart des visuels moches."
                    />

                    <label className="casestudio-check">
                      <input
                        type="checkbox"
                        checked={form.logo}
                        onChange={(e) => set("logo", e.target.checked)}
                      />
                      <span>
                        <Type size={13} /> Poser le logo du titre
                      </span>
                      <em>Coupé, le titre est composé dans la police choisie.</em>
                    </label>

                    {form.logo && (
                      <>
                        <div className="casestudio-duo">
                          <Slider
                            label="Logo · gauche / droite"
                            value={form.logoX}
                            onChange={(v) => set("logoX", v)}
                          />
                          <Slider
                            label="Logo · haut / bas"
                            value={form.logoY}
                            onChange={(v) => set("logoY", v)}
                          />
                        </div>
                        <Slider
                          label="Logo · taille"
                          min={20}
                          max={160}
                          value={form.logoSize}
                          onChange={(v) => set("logoSize", v)}
                        />
                        <label className="casestudio-field">
                          <span>Traitement du logo</span>
                          <select
                            value={form.logoTint}
                            onChange={(e) => set("logoTint", e.target.value)}
                          >
                            {LOGO_TINTS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <em>{LOGO_TINTS.find((o) => o.value === form.logoTint)?.hint}</em>
                        </label>
                      </>
                    )}

                    <label className="casestudio-field">
                      <span>Mention d'édition</span>
                      <input
                        value={form.edition}
                        onChange={(e) => set("edition", e.target.value)}
                        placeholder="Déduite du contenu"
                        maxLength={40}
                      />
                      <em>
                        Ce qu'il y a dans la boîte, et rien d'autre. Vide = « L'intégrale · 26
                        épisodes », « Coffret · 3 saisons ».
                      </em>
                    </label>
                  </>
                )}
              </section>
            )}

            {tab === "spine" && (
              <section>
                <h4>La tranche</h4>
                <label className="casestudio-field">
                  <span>Fond de la tranche</span>
                  <select value={form.spineBg} onChange={(e) => set("spineBg", e.target.value)}>
                    {SPINE_BGS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <em>{SPINE_BGS.find((o) => o.value === form.spineBg)?.hint}</em>
                </label>

                {form.spineBg !== "flat" && (
                  <ImagePick
                    images={images}
                    value={form.spine}
                    onPick={(v) => set("spine", v)}
                    onDrop={() => drop("spine")}
                    busy={fetching}
                    hint="La vignette de tête, et les tons du fond. Auto : l'affiche — c'est le cadrage portrait le plus proche d'une colonne de 55 pixels."
                  />
                )}
                {form.spineBg === "flat" ? (
                  <InkField value={form.color} fallback={ink} onChange={(v) => set("color", v)} />
                ) : (
                  inkFor("spine")
                )}
                <p className="casestudio-hint">
                  Le logo du titre y court à la verticale dès qu'il est posé (onglet
                  Couverture), et le logo du support s'imprime en pied s'il a été déposé dans{" "}
                  <code>client/public/case/</code>.
                </p>
              </section>
            )}

            {tab === "back" && (
              <section>
                <h4>Le dos</h4>
                <ImagePick
                  images={images}
                  value={form.back}
                  onPick={(v) => set("back", v)}
                  onDrop={() => drop("back")}
                  busy={fetching}
                  hint="La photo de tête, à fond perdu. Auto : la première photo d'exploitation — les trois vignettes du sommaire prennent les suivantes, jamais celle-ci."
                />
                {inkFor("back")}

                <label className="casestudio-check">
                  <input
                    type="checkbox"
                    checked={form.backFull}
                    onChange={(e) => set("backFull", e.target.checked)}
                  />
                  <span>
                    <Layers size={13} /> Dos tout fait
                  </span>
                  <em>
                    L'image couvre la face entière : ni résumé, ni sommaire, ni cartouche, ni
                    code-barres.
                  </em>
                </label>

                {form.backFull ? null : (
                  <Slider
                    label="Cadrage de la photo de tête"
                    value={form.backCrop === null ? 40 : form.backCrop}
                    onChange={(v) => set("backCrop", v)}
                    hint="Ce qu'on garde en hauteur dans la bande du haut."
                  />
                )}

                <label className="casestudio-field">
                  <span>Sommaire</span>
                  <select value={form.summary} onChange={(e) => set("summary", e.target.value)}>
                    {SUMMARIES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <em>{SUMMARIES.find((o) => o.value === form.summary)?.hint}</em>
                </label>

                <label className="casestudio-field">
                  <span>Disques annoncés</span>
                  <input
                    type="number"
                    min="0"
                    max="12"
                    value={form.discs}
                    onChange={(e) => set("discs", e.target.value)}
                  />
                  <em>0 = déduit du nombre d'épisodes (six par galette).</em>
                </label>

                <label className="casestudio-check">
                  <input
                    type="checkbox"
                    checked={form.barcode}
                    onChange={(e) => set("barcode", e.target.checked)}
                  />
                  <span>
                    <Barcode size={13} /> Imprimer le code-barres
                  </span>
                  <em>Un numéro dérivé du slug, stable, qui ne prétend rien encoder.</em>
                </label>
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
            Enregistrer la jaquette
          </button>
        </footer>
      </div>
    </div>
  );
}
