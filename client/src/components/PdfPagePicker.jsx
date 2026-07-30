import { useEffect, useRef, useState } from "react";
import { Loader2, Check, X, FileText, AlertTriangle } from "lucide-react";
import { MAX_UPLOAD, canvasToJpegUnder } from "../lib/imageFile";

// ======================================================================
//  Choisir une page dans un PDF, et la transformer en image
// ======================================================================
// Les jaquettes qui circulent en qualité d'impression sont des PDF : c'est le
// format dans lequel un éditeur livre une couverture, et souvent le seul où
// elle existe dépliée et à la bonne définition. Or ni le navigateur ni WebGL ne
// savent texturer un PDF — il faut le RASTERISER.
//
// Deux partis pris :
//
//   • ÇA SE PASSE DANS LE NAVIGATEUR. Convertir côté serveur voudrait dire
//     embarquer Ghostscript ou MuPDF dans l'image Docker pour un geste
//     d'administration occasionnel. Ici, la page est rendue là où l'admin est
//     déjà, et ce qui part vers le serveur est un JPEG ordinaire — la route
//     d'envoi n'a pas à savoir qu'un PDF a existé.
//
//   • ON CHOISIT LA PAGE. Un PDF de jaquette en contient rarement une seule :
//     la couverture dépliée, le disque, le livret, les repères d'impression.
//     Deviner laquelle est la bonne serait se tromper une fois sur deux, donc
//     on les montre toutes et l'admin désigne.
//
// pdf.js pèse lourd : il n'est chargé QUE lorsqu'un PDF est réellement déposé
// (import dynamique), et se retrouve donc dans un fragment à part que la
// plupart des visiteurs ne téléchargent jamais.

// Au-delà, on ne fabrique plus de vignettes : un PDF de cent pages n'est pas
// une jaquette, et les rendre toutes bloquerait l'écran pour rien.
const MAX_PAGES = 60;

// Définition du rendu final. La jaquette est découpée en trois faces d'environ
// 1024 px de haut (voir paintCase), donc 1500 px de haut laissent une marge
// confortable sans fabriquer un canvas que le navigateur refusera d'allouer.
const OUT_H = 2000;
const OUT_W_MAX = 6000;

export const isPdf = (file) =>
  file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");

// Le module et son ouvrier ne sont chargés qu'une fois pour toute la session.
let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      // L'ouvrier est SERVI PAR NOUS, jamais par un CDN : l'app tourne derrière
      // son propre domaine et doit fonctionner sans accès au reste du monde.
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
  }
  return pdfjsPromise;
}

// Rend une page dans un canvas neuf.
//
// Le fond est peint en blanc AVANT le rendu. pdf.js le fait déjà de son côté,
// mais on ne s'en remet pas à lui : le canvas garde une couche alpha, et un
// JPEG n'en a pas — la moindre zone restée transparente ressortirait NOIRE à la
// conversion. Deux lignes contre une jaquette au fond noir, le compte est bon.
//
// On ne passe QUE `canvas` : depuis la v6, `canvasContext` est purement et
// simplement ignoré dès que `canvas` est fourni (pdf.js reprend le contexte
// lui-même), et transmettre un paramètre sans effet ne ferait que tromper le
// prochain lecteur.
async function renderPage(page, targetH, maxW) {
  const base = page.getViewport({ scale: 1 });
  let scale = targetH / base.height;
  if (base.width * scale > maxW) scale = maxW / base.width;
  const viewport = page.getViewport({ scale: Math.max(0.05, scale) });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

export default function PdfPagePicker({ file, onCancel, onPick }) {
  const [pages, setPages] = useState([]); // { n, url, w, h }
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState(1);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const doc = useRef(null);
  // La libération passe par la TÂCHE DE CHARGEMENT, pas par le document : en
  // v6, `PDFDocumentProxy` n'a plus de `destroy()`, seul le loading task en a
  // un — et c'est lui qui arrête l'ouvrier et rend la mémoire.
  const task = useRef(null);
  // Les URL des vignettes sont révoquées au démontage : autrement, soixante
  // images de plusieurs mégaoctets restent en mémoire tant que l'onglet vit.
  const urls = useRef([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const data = await file.arrayBuffer();
        if (!alive) return;
        const loading = pdfjs.getDocument({ data });
        task.current = loading;
        const pdf = await loading.promise;
        if (!alive) return;
        doc.current = pdf;
        setTotal(pdf.numPages);

        // Une page après l'autre, et l'affichage se garnit au fur et à mesure :
        // tout rendre avant d'afficher quoi que ce soit donnerait un écran vide
        // pendant plusieurs secondes sur un PDF d'impression.
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
          const page = await pdf.getPage(n);
          const canvas = await renderPage(page, 320, 900);
          page.cleanup();
          if (!alive) return;
          const url = await new Promise((res) =>
            canvas.toBlob((b) => res(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.8)
          );
          if (!alive) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          if (url) urls.current.push(url);
          setPages((prev) => [
            ...prev,
            { n, url, w: canvas.width, h: canvas.height },
          ]);
        }
      } catch (e) {
        if (alive) setError(e?.message || "PDF illisible.");
      }
    })();

    return () => {
      alive = false;
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
      task.current?.destroy();
    };
  }, [file]);

  // La page retenue, rendue cette fois en pleine définition. On ne réutilise
  // pas la vignette : elle fait 320 px de haut, c'est un repère visuel, pas une
  // jaquette.
  async function use() {
    if (!doc.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const page = await doc.current.getPage(picked);
      const canvas = await renderPage(page, OUT_H, OUT_W_MAX);
      page.cleanup();
      const blob = await canvasToJpegUnder(canvas, MAX_UPLOAD);
      if (!blob) throw new Error("Conversion impossible.");
      const name = `${(file.name || "jaquette").replace(/\.pdf$/i, "")}-p${picked}.jpg`;
      await onPick(new File([blob], name, { type: "image/jpeg" }));
    } catch (e) {
      setError(e?.message || "Conversion impossible.");
      setBusy(false);
    }
  }

  const shown = Math.min(total, MAX_PAGES);
  const done = pages.length >= shown && shown > 0;

  return (
    <div className="wrapcrop" onClick={onCancel}>
      <div className="wrapcrop-sheet pdfpick" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>Choisir la page à utiliser</h3>
            <p>
              <FileText size={12} /> {file.name}
              {total > 0 && ` · ${total} page${total > 1 ? "s" : ""}`}
              {total > MAX_PAGES && ` (les ${MAX_PAGES} premières sont affichées)`}
            </p>
          </div>
          <button className="adm-coll-icon clickable" onClick={onCancel} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>

        {error ? (
          <p className="adm-coll-error">
            <AlertTriangle size={14} /> {error}
          </p>
        ) : pages.length === 0 ? (
          <div className="pdfpick-state">
            <Loader2 size={20} className="spin" /> Lecture du PDF…
          </div>
        ) : (
          <div className="pdfpick-grid">
            {pages.map((p) => (
              <button
                key={p.n}
                type="button"
                className={`pdfpick-page clickable ${picked === p.n ? "on" : ""}`}
                onClick={() => setPicked(p.n)}
                onDoubleClick={use}
                title={`Page ${p.n} — ${p.w} × ${p.h}`}
              >
                <span className="pdfpick-shot" style={{ aspectRatio: p.w / p.h }}>
                  {p.url && <img src={p.url} alt="" draggable={false} />}
                </span>
                <em>Page {p.n}</em>
                {picked === p.n && (
                  <span className="pdfpick-check">
                    <Check size={13} />
                  </span>
                )}
              </button>
            ))}
            {!done && (
              <span className="pdfpick-more">
                <Loader2 size={16} className="spin" />
              </span>
            )}
          </div>
        )}

        <footer className="adm-coll-foot">
          <p className="adm-coll-hint">
            La page choisie est convertie en JPEG (jusqu'à {OUT_H} px de haut) —
            c'est elle qui sera mesurée juste après.
          </p>
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onCancel}>
              Annuler
            </button>
            <button
              className="btn btn-primary clickable"
              onClick={use}
              disabled={busy || !pages.length}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Utiliser cette page
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
