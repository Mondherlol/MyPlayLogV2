import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Orbit, Download, Copy, Check, Loader2, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import {
  CIRCLE_SIZE,
  CIRCLE_BG,
  renderCircle,
  loadCircleImage,
  circleToBlob,
} from "../lib/statsCircle";

// Le « cercle » de l'onglet Stats : un bouton, et une modale qui dessine le
// profil au centre avec ses sagas (ou ses studios) autour — une image à
// télécharger ou copier telle quelle. Le classement vient du serveur : un
// seul score qui mêle jeux joués, heures, notes, coups de cœur et statuts.

const KINDS = [
  { key: "franchises", label: "Sagas" },
  { key: "studios", label: "Studios" },
];

const nf = new Intl.NumberFormat("fr-FR");
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const SITE = "myplaylog.cc";

const fmtHours = (h) => (h >= 1000 ? `${nf.format(Math.round(h / 100) / 10)} k h` : `${nf.format(Math.round(h))} h`);
const fmtGames = (n) => `${nf.format(n)} jeu${n > 1 ? "x" : ""}`;

const dataCache = new Map(); // `${username}:${kind}` -> réponse

function CircleModal({ username, token, title, onClose }) {
  const [kind, setKind] = useState("franchises");
  const [data, setData] = useState(() => dataCache.get(`${username}:franchises`) || null);
  const [error, setError] = useState(null);
  const [drawing, setDrawing] = useState(true);
  const [hover, setHover] = useState(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const placedRef = useRef([]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Données de la facette (une requête par facette, gardée en mémoire).
  useEffect(() => {
    const key = `${username}:${kind}`;
    const cached = dataCache.get(key);
    setData(cached || null);
    setError(null);
    setHover(null);
    if (cached) return;
    let alive = true;
    apiFetch(`/users/${username}/circle?kind=${kind}`, { token })
      .then((d) => {
        dataCache.set(key, d);
        if (alive) setData(d);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [username, kind, token]);

  const kindLabel = KINDS.find((k) => k.key === kind).label;

  // Dessin : on attend toutes les images, puis un seul rendu.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    let alive = true;
    setDrawing(true);
    const items = (data.items || []).map((it) => ({
      ...it,
      image: it.logo || it.cover,
      logo: !!it.logo,
      value: it.hours > 0 ? `${fmtGames(it.games)} · ${fmtHours(it.hours)}` : fmtGames(it.games),
    }));
    const avatar = data.user?.avatar || null;
    const urls = [avatar, ...items.map((i) => i.image)].filter(Boolean);
    Promise.all([
      document.fonts?.ready,
      ...urls.map((u) => loadCircleImage(u, token).then((img) => [u, img])),
    ]).then(([, ...pairs]) => {
      if (!alive) return;
      placedRef.current = renderCircle(canvas, {
        items,
        avatar,
        username: data.user?.username || username,
        caption: `${kindLabel} · ${dateFmt.format(new Date())}`,
        site: SITE,
        images: new Map(pairs),
      });
      setDrawing(false);
    });
    return () => {
      alive = false;
    };
  }, [data, token, username, kindLabel]);

  // Survol : quelle bulle est sous le pointeur ?
  const onMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CIRCLE_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * CIRCLE_SIZE;
    const b = placedRef.current.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= p.r ** 2);
    if (!b) return setHover(null);
    const k = rect.width / CIRCLE_SIZE;
    setHover({ b, left: b.x * k, top: (b.y - b.r) * k });
  };

  const empty = data && (data.items || []).length < 3;
  const busy = drawing || empty || !!error;
  const blob = () => circleToBlob(canvasRef.current);

  const download = async () => {
    const b = await blob();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cercle-${kindLabel.toLowerCase()}-${username}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canCopy = !!window.ClipboardItem && !!navigator.clipboard?.write;
  const copy = async () => {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob() })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* presse-papiers refusé : le bouton Télécharger reste là */
    }
  };

  const hb = hover?.b;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ps-circle-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <div className="ps-circle-head">
          <h2 className="modal-title">
            <Orbit size={20} /> {title}
          </h2>
          <span className="ps-seg">
            {KINDS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`clickable ${kind === key ? "active" : ""}`}
                onClick={() => setKind(key)}
              >
                {label}
              </button>
            ))}
          </span>
        </div>

        <div className="ps-circle-stage" style={{ background: CIRCLE_BG }}>
          <canvas
            ref={canvasRef}
            className={`ps-circle-canvas ${hb ? "pointing" : ""} ${empty ? "hidden" : ""}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${kindLabel} : ${(data?.items || [])
              .slice(0, 10)
              .map((i, n) => `${n + 1}. ${i.name}`)
              .join(", ")}`}
          />
          {hb && (
            <div className="ps-circle-tip" style={{ left: hover.left, top: hover.top }}>
              <strong>
                #{hb.rank} {hb.item.name}
              </strong>
              <span>
                {[
                  fmtGames(hb.item.games),
                  hb.item.hours > 0 && fmtHours(hb.item.hours),
                  hb.item.rating != null && `${hb.item.rating}/100`,
                  hb.item.favorites > 0 &&
                    `${hb.item.favorites} coup${hb.item.favorites > 1 ? "s" : ""} de cœur`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
          {(error || empty) && (
            <div className="ps-circle-empty">
              {error || `Pas encore assez de ${kindLabel.toLowerCase()} pour dessiner un cercle.`}
            </div>
          )}
          {!error && !empty && (drawing || !data) && (
            <div className="ps-circle-loading">
              <Loader2 size={24} className="spin" />
            </div>
          )}
        </div>

        <div className="ps-circle-actions">
          <button type="button" className="btn btn-primary clickable" onClick={download} disabled={busy}>
            <Download size={16} /> Télécharger
          </button>
          {canCopy && (
            <button type="button" className="btn btn-ghost clickable" onClick={copy} disabled={busy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiée" : "Copier"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function StatsCircleButton({ username, token, isMe }) {
  const [open, setOpen] = useState(false);
  const title = isMe ? "Mon cercle" : `Le cercle de ${username}`;
  return (
    <>
      <button type="button" className="ps-circle-btn clickable" onClick={() => setOpen(true)}>
        <Orbit size={16} /> {title}
      </button>
      {open && (
        <CircleModal username={username} token={token} title={title} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
