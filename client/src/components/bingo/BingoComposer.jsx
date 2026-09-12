import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  ImageIcon,
  ImagePlus,
  Library,
  Loader2,
  Lock,
  Move,
  PenLine,
  Shuffle,
  X,
} from "lucide-react";
import { apiUpload, apiFetch } from "../../lib/api";
import { compressImage } from "../../lib/imageCompress";
import {
  SIZES,
  blankCells,
  cellsForSave,
  filledCount,
  resizeCells,
  shuffleCells,
} from "../../lib/bingo";
import BingoGrid from "./BingoGrid";
import SagaPicker from "./SagaPicker";

// ======================================================================
//  Composer sa grille
// ======================================================================
// ⚠️ C'EST UN ÉDITEUR, PAS UN FORMULAIRE. On compose un OBJET — la grille — et
// elle doit occuper la scène. D'où la mise en page d'un éditeur :
//
//   • la barre du haut : de quoi il s'agit, la taille, le mélange ;
//   • la scène : la grille, en grand, sur un fond pointillé d'atelier ;
//   • l'inspecteur à droite : les réglages de la grille, ou de LA case qu'on
//     vient de toucher ;
//   • le pied : la progression et l'enregistrement.
//
// ⚠️ ET LA CASE SE COMPOSE COMME SUR LE TÉLÉPHONE (cf. mobile CellSheet) :
// aperçu en grand qui se recadre au glissé, image tirée d'une SAGA ou d'une
// photo à soi, texte en bandeau ou sur l'image. Deux écrans qui fabriquent le
// même objet de deux façons différentes, c'est une grille composée sur le
// téléphone qu'on ne sait plus retoucher sur le site.
//
// ⚠️ ON COMPOSE AVANT, JAMAIS PENDANT. Le serveur refuse tout enregistrement
// une fois l'émission commencée (cf. server/routes/bingo.js) : cet écran ne
// s'ouvre donc que tant que c'est permis, et la page du rendez-vous le sait.

const MAX_TEXT = 120;
const CENTER = "50% 50%";
// Les mêmes bornes que le serveur (cf. routes/bingo.js, `cellUpload`) : les
// vérifier ici donne un message clair AVANT d'envoyer six mégaoctets pour rien.
const MAX_UPLOAD = 6 * 1024 * 1024;
const UPLOAD_TYPES = /^image\/(jpe?g|png|webp|gif)$/;

/** Le recadrage vit en deux pourcentages, comme `object-position`. */
function parsePos(pos) {
  const parts = String(pos || CENTER).trim().split(/\s+/);
  const num = (s) => {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
  };
  return parts.length === 2 ? { x: num(parts[0]), y: num(parts[1]) } : { x: 50, y: 50 };
}
const formatPos = (x, y) => `${Math.round(x)}% ${Math.round(y)}%`;
const clamp = (n) => Math.min(100, Math.max(0, n));

export default function BingoComposer({ eventId, eventName, token, initial, onClose, onSaved }) {
  const [size, setSize] = useState(initial?.size || 3);
  const [cells, setCells] = useState(initial?.cells?.length ? initial.cells : blankCells(3));
  const [title, setTitle] = useState(initial?.title || "");
  const [published, setPublished] = useState(initial?.published ?? true);
  const [active, setActive] = useState(null); // index de la case en cours d'édition
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Le sélecteur de saga a sa propre marche arrière : Échap doit d'abord le
  // refermer, pas jeter la case. L'inspecteur le signale ici.
  const pickingRef = useRef(false);

  const total = size * size;
  const filled = filledCount(cells);

  // Échap recule d'UN cran : le sélecteur de saga, puis la case, puis la
  // fenêtre. Sinon, sortir d'une recherche au clavier jetait toute la grille.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (pickingRef.current) return; // l'inspecteur s'en occupe
      if (active != null) setActive(null);
      else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);

  function changeSize(next) {
    if (next === size) return;
    // ⚠️ ON GARDE CE QU'ON PEUT, PAR POSITION (cf. lib/bingo) : passer de 3×3 à
    // 4×4 ne doit pas envoyer le texte de la case du milieu dans un coin.
    setCells((c) => resizeCells(c, size, next));
    setSize(next);
    setActive(null);
  }

  function patchCell(index, patch) {
    setCells((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  // Passer d'une case à l'autre en boucle : on compose une grille d'une traite,
  // pas neuf fois « cliquer, écrire, fermer ».
  const step = (dir) => setActive((i) => ((i ?? 0) + dir + total) % total);

  async function save() {
    if (!filled) {
      setError("Écris au moins une case avant d'enregistrer.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const d = await apiFetch(`/bingo/event/${eventId}`, {
        method: "PUT",
        token,
        body: { size, title: title.trim(), published, cells: cellsForSave(cells) },
      });
      onSaved?.(d.grid);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cell = active == null ? null : cells[active];

  return createPortal(
    <div className="bgc-back" onClick={onClose} role="presentation">
      <div
        className="bgc"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Composer ma grille de bingo"
      >
        {/* --- La barre du haut ----------------------------------------- */}
        <header className="bgc-bar">
          <div className="bgc-bar-title">
            <span className="bgc-eyebrow">Mon bingo</span>
            <h2>{eventName}</h2>
          </div>

          <div className="bgc-seg" role="radiogroup" aria-label="Taille de la grille">
            {SIZES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={s === size}
                className={`bgc-seg-btn clickable ${s === size ? "on" : ""}`}
                onClick={() => changeSize(s)}
              >
                {s}×{s}
              </button>
            ))}
          </div>

          <button
            className="bgc-icon clickable"
            onClick={() => setCells((c) => shuffleCells(c))}
            title="Mélanger les cases"
            aria-label="Mélanger les cases"
          >
            <Shuffle size={16} />
          </button>
          <button className="bgc-icon clickable" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="bgc-main">
          {/* --- La scène ----------------------------------------------- */}
          <div
            className="bgc-stage"
            // Un clic dans le vide autour de la grille désélectionne : c'est
            // le geste de tous les éditeurs.
            onClick={(e) => e.target === e.currentTarget && setActive(null)}
          >
            <BingoGrid
              cells={cells}
              size={size}
              mode="edit"
              activeIndex={active}
              onCell={(i) => setActive(i)}
              className="bgc-grid"
            />
          </div>

          {/* --- L'inspecteur ------------------------------------------- */}
          <aside className="bgc-inspector">
            {cell ? (
              <CellInspector
                // Une case, un inspecteur : changer de case repart d'un état
                // propre (sélecteur de saga refermé, message d'erreur effacé).
                key={active}
                cell={cell}
                index={active}
                total={total}
                token={token}
                pickingRef={pickingRef}
                onPatch={(patch) => patchCell(active, patch)}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                onDone={() => setActive(null)}
              />
            ) : (
              <GridInspector
                title={title}
                setTitle={setTitle}
                published={published}
                setPublished={setPublished}
              />
            )}
          </aside>
        </div>

        {/* --- Le pied ------------------------------------------------- */}
        <footer className="bgc-foot">
          <div className="bgc-progress" aria-label={`${filled} cases remplies sur ${total}`}>
            <span className="bgc-progress-bar">
              <span style={{ width: `${(filled / total) * 100}%` }} />
            </span>
            <span className="bgc-progress-txt">
              <b>{filled}</b> / {total} cases
            </span>
          </div>

          {!!error && <span className="bgc-error">{error}</span>}

          <button className="bgc-btn ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button className="bgc-btn gold clickable" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
            Enregistrer ma grille
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

/** Les réglages de la grille entière — ce qu'on voit quand aucune case n'est prise. */
function GridInspector({ title, setTitle, published, setPublished }) {
  return (
    <div className="bgc-panel">
      <label className="bgc-label" htmlFor="bgc-title">
        Titre
      </label>
      <input
        id="bgc-title"
        className="bgc-input"
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 80))}
        placeholder="Mes pronostics"
      />

      {/* Un vrai interrupteur, pas une case à cocher : c'est un ÉTAT de la
          grille (visible ou non), pas une option qu'on valide. */}
      <button
        type="button"
        role="switch"
        aria-checked={published}
        className={`bgc-switch clickable ${published ? "on" : ""}`}
        onClick={() => setPublished((v) => !v)}
      >
        <span className="bgc-switch-txt">
          <b>Visible par les autres</b>
          <i>{published ? "Elle apparaîtra sur la page du rendez-vous" : "Brouillon, rien que pour toi"}</i>
        </span>
        <span className="bgc-switch-track">
          <span className="bgc-switch-knob" />
        </span>
      </button>

      <div className="bgc-howto">
        <span className="bgc-label">Comment ça marche</span>
        <p>
          <PenLine size={15} /> Clique une case et écris ce que tu espères voir.
        </p>
        <p>
          <ImageIcon size={15} /> Habille-la d'une image de saga, ou d'une photo à toi.
        </p>
        <p>
          <Lock size={15} /> Tout reste modifiable jusqu'au début de l'émission — ensuite, on coche.
        </p>
      </div>
    </div>
  );
}

/**
 * Les réglages d'UNE case — le pendant web de la feuille de case du téléphone.
 *
 * ⚠️ LA CASE EST MONTRÉE EN GRAND PENDANT QU'ON LA COMPOSE. Dans la grille, une
 * case fait quelques dizaines de pixels : on n'y voit ni si le texte tient, ni
 * si l'artwork choisi laisse le mot lisible. L'aperçu est le MÊME composant que
 * la grille (`BingoGrid`, une seule case) — pas une imitation : ce qu'on voit
 * ici est exactement ce qu'on aura.
 */
function CellInspector({ cell, index, total, token, pickingRef, onPatch, onPrev, onNext, onDone }) {
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const drag = useRef(null);
  const frame = useRef(0);
  const text = cell.text || "";

  // Le composer doit savoir qu'un sélecteur est ouvert (cf. Échap).
  useEffect(() => {
    pickingRef.current = picking;
    if (!picking) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setPicking(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      pickingRef.current = false;
    };
  }, [picking, pickingRef]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ------------------------------------------------------------------
  //  Le recadrage au glissé
  // ------------------------------------------------------------------
  // ⚠️ LE GLISSÉ VA DANS LE SENS DE L'IMAGE : tirer vers la droite fait
  // apparaître ce qui était à gauche, comme quand on pousse une photo sous un
  // cache. D'où le signe négatif — l'inverse donne un geste qu'on corrige sans
  // arrêt sans comprendre pourquoi. (Même règle que sur le téléphone.)
  //
  // ⚠️ UNE MISE À JOUR PAR IMAGE AFFICHÉE, PAS PAR ÉVÉNEMENT. Une souris envoie
  // plus de mouvements qu'un écran n'affiche d'images : chacun redessinait la
  // grille entière. On ne pousse que le dernier, au rythme de l'écran.
  function onPointerDown(e) {
    if (!cell.image || uploading) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = parsePos(cell.pos);
    drag.current = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, w: e.currentTarget.clientWidth };
    setDragging(true);
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const x = clamp(d.px - ((e.clientX - d.x) / d.w) * 100);
    const y = clamp(d.py - ((e.clientY - d.y) / d.w) * 100);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onPatch({ pos: formatPos(x, y) }));
  }
  function onPointerUp() {
    drag.current = null;
    setDragging(false);
  }

  // ------------------------------------------------------------------
  //  Une photo à soi
  // ------------------------------------------------------------------
  async function onFile(e) {
    const picked = e.target.files?.[0];
    // On vide le champ tout de suite : sans ça, choisir DEUX FOIS la même
    // photo (après l'avoir retirée) ne déclencherait aucun événement.
    e.target.value = "";
    if (!picked) return;
    if (!picked.type.startsWith("image/")) {
      setUploadError("Ce fichier n'est pas une image.");
      return;
    }
    setUploadError("");
    setUploading(true);
    try {
      // ⚠️ ON COMPRESSE AVANT DE VÉRIFIER LE POIDS, PAS APRÈS. Une photo de
      // téléphone pèse 4 à 8 Mo : la refuser pour dépasser les 6 Mo du serveur
      // alors qu'une case n'en affiche que quelques centaines de pixels, c'est
      // refuser la moitié des photos qu'on essaie d'envoyer. Redimensionnée à
      // 1920 px et ré-encodée, elle passe sous le quart. (Les GIF restent
      // intacts, pour garder l'animation — cf. lib/imageCompress.)
      const file = await compressImage(picked);
      if (!UPLOAD_TYPES.test(file.type)) {
        setUploadError("Formats acceptés : JPG, PNG, WebP ou GIF.");
        return;
      }
      if (file.size > MAX_UPLOAD) {
        setUploadError("Image trop lourde : 6 Mo maximum.");
        return;
      }
      const form = new FormData();
      form.append("media", file);
      const res = await apiUpload("/bingo/media", form, token);
      onPatch({
        image: res.url,
        pos: CENTER,
        // ⚠️ UNE PHOTO PERSO N'A PAS DE JEU DERRIÈRE. On efface le crédit d'un
        // visuel précédemment pris à une saga, sinon la case afficherait
        // « Metroid Prime 4 » sous une photo du chat.
        gameId: null,
        gameName: "",
        saga: null,
      });
    } catch (err) {
      setUploadError(err.message || "Envoi impossible.");
    } finally {
      setUploading(false);
    }
  }

  // --- Le sélecteur de saga prend toute la place de l'inspecteur ---------
  if (picking) {
    return (
      <div className="bgc-panel">
        <SagaPicker
          token={token}
          // Ce qu'on vient d'écrire dans la case sert de recherche de départ,
          // et la saga de l'image actuelle rouvre directement sur ses visuels.
          initialQuery={text.trim()}
          initialSaga={cell.saga || null}
          onBack={() => setPicking(false)}
          onPick={(img) => {
            onPatch({
              image: img.url,
              pos: CENTER,
              gameId: img.gameId,
              gameName: img.gameName,
              saga: img.saga,
            });
            setPicking(false);
          }}
        />
      </div>
    );
  }

  // Le choix « bandeau / sur l'image » ne s'affiche qu'avec une image ET un
  // texte : sans les deux, la question ne se pose pas, et un réglage sans effet
  // visible est un réglage qu'on croit cassé.
  const showStyle = !!cell.image && !!text.trim();

  return (
    <div className="bgc-panel">
      <div className="bgc-cellhead">
        <button className="bgc-icon small clickable" onClick={onPrev} aria-label="Case précédente">
          <ChevronLeft size={15} />
        </button>
        <span className="bgc-cellhead-txt">
          Case <b>{index + 1}</b> sur {total}
          {cell.free && <em>offerte</em>}
        </span>
        <button className="bgc-icon small clickable" onClick={onNext} aria-label="Case suivante">
          <ChevronRight size={15} />
        </button>
        <button className="bgc-done clickable" onClick={onDone}>
          <Check size={14} /> OK
        </button>
      </div>

      {/* --- L'aperçu, à l'échelle de ce qu'on fabrique ------------------ */}
      <div className="bgc-preview-wrap">
        <div
          className={`bgc-preview ${cell.image ? "can-drag" : ""} ${dragging ? "dragging" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <BingoGrid cells={[{ ...cell, index: 0, checked: false }]} size={1} />
          {uploading && (
            <span className="bgc-preview-busy">
              <Loader2 size={22} className="spin" />
            </span>
          )}
        </div>
        {!!cell.image && (
          <span className="bgc-preview-hint">
            <Move size={12} /> Glisse l'image pour la recadrer
          </span>
        )}
        {!!cell.gameName && <span className="bgc-credit">{cell.gameName}</span>}
      </div>

      {/* --- Le texte --------------------------------------------------- */}
      <label className="bgc-label" htmlFor="bgc-text">
        Ton pronostic
      </label>
      <div className="bgc-textwrap">
        <textarea
          id="bgc-text"
          className="bgc-input bgc-textarea"
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => onPatch({ text: e.target.value.slice(0, MAX_TEXT) })}
          // Entrée passe à la case suivante : on remplit une grille d'une
          // traite. Maj + Entrée garde le saut de ligne pour qui en veut un.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onNext();
            }
          }}
          placeholder={cell.free ? "FREE — ou ce que tu veux" : "Un nouveau F-ZERO…"}
        />
        <span className="bgc-count">
          {text.length}/{MAX_TEXT}
        </span>
      </div>

      {/* --- Où se pose le texte ---------------------------------------- */}
      {showStyle && (
        <>
          <span className="bgc-label">Place du texte</span>
          <div className="bgc-seg wide" role="radiogroup" aria-label="Place du texte">
            <button
              role="radio"
              aria-checked={cell.textStyle !== "overlay"}
              className={`bgc-seg-btn clickable ${cell.textStyle !== "overlay" ? "on" : ""}`}
              onClick={() => onPatch({ textStyle: "banner" })}
            >
              Bandeau
            </button>
            <button
              role="radio"
              aria-checked={cell.textStyle === "overlay"}
              className={`bgc-seg-btn clickable ${cell.textStyle === "overlay" ? "on" : ""}`}
              onClick={() => onPatch({ textStyle: "overlay" })}
            >
              Sur l'image
            </button>
          </div>
        </>
      )}

      {/* --- L'image ----------------------------------------------------- */}
      <span className="bgc-label">Image</span>
      <div className="bgc-imgbtns">
        <button type="button" className="bgc-imgbtn clickable" onClick={() => setPicking(true)}>
          <Library size={15} /> Une saga
        </button>
        <button
          type="button"
          className="bgc-imgbtn clickable"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          <ImagePlus size={15} /> Ma photo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          hidden
          onChange={onFile}
        />
      </div>
      {!!uploadError && <p className="bgc-err">{uploadError}</p>}

      {!!cell.image && (
        <div className="bgc-imglinks">
          <button type="button" className="bgc-link clickable" onClick={() => onPatch({ pos: CENTER })}>
            Recentrer
          </button>
          <button
            type="button"
            className="bgc-link clickable"
            onClick={() => onPatch({ image: null, pos: null, gameId: null, gameName: "", saga: null })}
          >
            Retirer l'image
          </button>
        </div>
      )}

      {!cell.free && (text || cell.image) && (
        <button
          className="bgc-link danger clickable"
          onClick={() =>
            onPatch({ text: "", image: null, pos: null, gameId: null, gameName: "", saga: null })
          }
        >
          <Eraser size={13} /> Vider la case
        </button>
      )}
    </div>
  );
}
