import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ExternalLink, Download, ImageIcon, Check, Moon, Sun } from "lucide-react";
import {
  ensureFonts,
  loadImages,
  collectImageUrls,
  renderList,
  defaultExportOpts,
} from "../lib/listExport";

const slugify = (s) =>
  String(s || "liste")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "liste";

// Cases à cocher proposées selon le type de liste.
function optionGroups(list) {
  const common = [
    { key: "showTitle", label: "Titre" },
    { key: "showDescription", label: "Description", disabled: !list.description },
    { key: "showAuthor", label: "Auteur" },
    { key: "showDate", label: "Date" },
    { key: "showCover", label: "Couverture", disabled: !list.cover },
    { key: "showWatermark", label: "Filigrane MyPlayLog" },
  ];
  if (list.type === "tier")
    return [
      { title: "Contenu", opts: common },
      {
        title: "Paliers",
        opts: [
          { key: "showPool", label: "Éléments non classés" },
          { key: "showCounts", label: "Nombre par palier" },
        ],
      },
    ];
  return [
    { title: "Contenu", opts: common },
    {
      title: "Cartes",
      opts: [
        { key: "showNames", label: "Noms" },
        { key: "showNotes", label: "Annotations" },
        ...(list.type === "ranked" ? [{ key: "showRank", label: "Numéros de rang" }] : []),
      ],
    },
  ];
}

export default function ListExportModal({ list, items, tiers, token, onClose }) {
  const [opts, setOpts] = useState(() => defaultExportOpts(list));
  const [imageMap, setImageMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pngUrl, setPngUrl] = useState(null);
  const canvasRef = useRef(null);
  const pngUrlRef = useRef(null);

  // `list` habillé avec le compte réel d'éléments (toFull ne porte pas itemCount).
  const exportList = useMemo(() => ({ ...list, itemCount: items.length }), [list, items.length]);

  // Chargement des polices + images (une seule fois).
  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureFonts();
      const map = await loadImages(collectImageUrls(list, items), token);
      if (!alive) return;
      setImageMap(map);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape + blocage du scroll de fond.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // (Re)dessine l'aperçu à chaque changement d'options / d'images, puis prépare
  // un blob PNG frais (pour ouvrir/télécharger sans re-générer au clic).
  useEffect(() => {
    if (!imageMap || !canvasRef.current) return;
    renderList(canvasRef.current, { list: exportList, items, tiers, opts, imageMap });
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;
      const u = URL.createObjectURL(blob);
      if (pngUrlRef.current) URL.revokeObjectURL(pngUrlRef.current);
      pngUrlRef.current = u;
      setPngUrl(u);
    }, "image/png");
  }, [opts, imageMap, exportList, items, tiers]);

  // Révoque le dernier blob au démontage.
  useEffect(
    () => () => {
      if (pngUrlRef.current) URL.revokeObjectURL(pngUrlRef.current);
    },
    []
  );

  const toggle = (key) => setOpts((o) => ({ ...o, [key]: !o[key] }));

  function openInTab() {
    if (pngUrlRef.current) window.open(pngUrlRef.current, "_blank", "noopener");
  }
  function download() {
    if (!pngUrlRef.current) return;
    const a = document.createElement("a");
    a.href = pngUrlRef.current;
    a.download = `${slugify(list.title)}.png`;
    a.click();
  }

  const groups = optionGroups(list);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal le-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
        <h2 className="modal-title">
          <ImageIcon size={18} /> Exporter en image
        </h2>

        <div className="le-body">
          {/* Aperçu */}
          <div className="le-preview">
            {loading ? (
              <div className="le-preview-loading">
                <Loader2 size={24} className="spin" />
                <span className="font-fun">Préparation de l'aperçu…</span>
              </div>
            ) : (
              <canvas ref={canvasRef} className="le-canvas" />
            )}
          </div>

          {/* Options */}
          <div className="le-side">
            <div className="le-theme" role="group" aria-label="Thème">
              <button
                className={`le-theme-opt clickable ${opts.theme === "dark" ? "active" : ""}`}
                onClick={() => setOpts((o) => ({ ...o, theme: "dark" }))}
              >
                <Moon size={15} /> Sombre
              </button>
              <button
                className={`le-theme-opt clickable ${opts.theme === "light" ? "active" : ""}`}
                onClick={() => setOpts((o) => ({ ...o, theme: "light" }))}
              >
                <Sun size={15} /> Clair
              </button>
            </div>

            {groups.map((g) => (
              <div className="le-group" key={g.title}>
                <span className="le-group-title">{g.title}</span>
                <div className="le-checks">
                  {g.opts.map((o) => (
                    <button
                      key={o.key}
                      className={`le-check clickable ${opts[o.key] ? "on" : ""} ${
                        o.disabled ? "disabled" : ""
                      }`}
                      onClick={() => !o.disabled && toggle(o.key)}
                      disabled={o.disabled}
                      role="checkbox"
                      aria-checked={!!opts[o.key]}
                    >
                      <span className="le-check-box">{opts[o.key] && <Check size={13} />}</span>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="le-actions">
              <button
                className="btn btn-primary clickable"
                onClick={openInTab}
                disabled={loading || !pngUrl}
              >
                <ExternalLink size={16} /> Ouvrir dans un onglet
              </button>
              <button
                className="btn btn-ghost clickable"
                onClick={download}
                disabled={loading || !pngUrl}
              >
                <Download size={16} /> Télécharger
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
