import { useEffect, useMemo, useRef, useState } from "react";
import {
  Orbit,
  Download,
  Copy,
  Check,
  Loader2,
  Crown,
  Code2,
  Building2,
  Gamepad2,
  Joystick,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { platformLabel } from "../lib/platforms";
import {
  CIRCLE_SIZE,
  CIRCLE_THEMES,
  renderCircle,
  loadCircleImage,
  circleToBlob,
} from "../lib/statsCircle";

// Le « cercle » de l'onglet Stats : le profil au centre, ses sagas (ou
// studios, éditeurs, genres, consoles) autour, classées par temps de jeu, note
// ou nombre de jeux — une image à télécharger ou copier telle quelle.

const KINDS = [
  { key: "franchises", label: "Sagas", Icon: Crown },
  { key: "developers", label: "Studios", Icon: Code2, logos: true },
  { key: "publishers", label: "Éditeurs", Icon: Building2, logos: true },
  { key: "genres", label: "Genres", Icon: Gamepad2 },
  { key: "platforms", label: "Consoles", Icon: Joystick, logos: true },
];

const METRICS = [
  { key: "hours", label: "Temps de jeu", caption: "par temps de jeu" },
  { key: "rating", label: "Notes", caption: "par note" },
  { key: "games", label: "Jeux joués", caption: "par jeux joués" },
];

const TOPS = [8, 25, 50];

const nf = new Intl.NumberFormat("fr-FR");
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const SITE = "myplaylog.cc";

const fmtHours = (h) => (h >= 1000 ? `${nf.format(Math.round(h / 100) / 10)} k h` : `${nf.format(Math.round(h))} h`);
const fmtGames = (n) => `${nf.format(n)} jeu${n > 1 ? "x" : ""}`;

const METRIC_VALUE = {
  hours: (it) => fmtHours(it.hours),
  rating: (it) => `${it.rating}/100`,
  games: (it) => fmtGames(it.games),
};

// Classement selon la mesure choisie. Une saga sans heures (ou sans note)
// n'a rien à faire dans le classement correspondant.
const RANK = {
  hours: (items) =>
    items.filter((i) => i.hours > 0).sort((a, b) => b.hours - a.hours || b.games - a.games),
  rating: (items) =>
    items
      .filter((i) => i.rating != null)
      .sort((a, b) => b.rating - a.rating || b.rated - a.rated || b.hours - a.hours),
  games: (items) => items.slice().sort((a, b) => b.games - a.games || b.hours - a.hours),
};

// Préférences d'affichage retenues d'une visite à l'autre (confort local).
const PREFS_KEY = "mpl_circle_prefs";
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function writePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* navigation privée : tant pis */
  }
}

const dataCache = new Map(); // `${username}:${kind}` -> réponse

export default function StatsCircle({ username, token, onPick }) {
  const initial = useMemo(readPrefs, []);
  const [kind, setKind] = useState(KINDS.some((k) => k.key === initial.kind) ? initial.kind : "franchises");
  const [metric, setMetric] = useState(METRICS.some((m) => m.key === initial.metric) ? initial.metric : "hours");
  const [top, setTop] = useState(TOPS.includes(initial.top) ? initial.top : 50);
  const [themeKey, setThemeKey] = useState(CIRCLE_THEMES[initial.theme] ? initial.theme : "rose");
  const [data, setData] = useState(() => dataCache.get(`${username}:${kind}`) || null);
  const [error, setError] = useState(null);
  const [drawing, setDrawing] = useState(true);
  const [hover, setHover] = useState(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const placedRef = useRef([]);

  useEffect(() => {
    writePrefs({ kind, metric, top, theme: themeKey });
  }, [kind, metric, top, themeKey]);

  // Données de la facette (une requête par facette, gardée en mémoire).
  useEffect(() => {
    const key = `${username}:${kind}`;
    const cached = dataCache.get(key);
    setData(cached || null);
    setError(null);
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

  const kindMeta = KINDS.find((k) => k.key === kind);
  const metricMeta = METRICS.find((m) => m.key === metric);

  const items = useMemo(() => {
    if (!data?.items) return [];
    return RANK[metric](data.items)
      .slice(0, top)
      .map((it) => {
        const useLogo = kindMeta.logos && it.logo;
        return {
          ...it,
          name: kind === "platforms" ? platformLabel(it.name) : it.name,
          image: useLogo ? it.logo : it.cover,
          logo: !!useLogo,
          value: METRIC_VALUE[metric](it),
        };
      });
  }, [data, metric, top, kind, kindMeta]);

  // Dessin : on attend toutes les images, puis un seul rendu.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    let alive = true;
    setDrawing(true);
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
        caption: `${kindMeta.label} ${metricMeta.caption} · ${dateFmt.format(new Date())}`,
        site: SITE,
        theme: CIRCLE_THEMES[themeKey],
        images: new Map(pairs),
      });
      setDrawing(false);
    });
    return () => {
      alive = false;
    };
  }, [data, items, themeKey, token, username, kindMeta, metricMeta]);

  // Survol / clic : quelle bulle est sous le pointeur ?
  const bubbleAt = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CIRCLE_SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * CIRCLE_SIZE;
    const b = placedRef.current.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= p.r ** 2);
    return b ? { b, rect } : null;
  };
  const onMove = (e) => {
    const hit = bubbleAt(e);
    if (!hit) return setHover(null);
    const { b, rect } = hit;
    const k = rect.width / CIRCLE_SIZE;
    setHover({ b, left: b.x * k, top: (b.y - b.r) * k });
  };
  const onClick = (e) => {
    const hit = bubbleAt(e);
    if (hit && onPick) onPick(hit.b.item, kindMeta.Icon);
  };

  const fileName = `cercle-${kindMeta.label.toLowerCase()}-${username}.png`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const download = async () => {
    const blob = await circleToBlob(canvasRef.current);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canCopy = typeof window !== "undefined" && !!window.ClipboardItem && !!navigator.clipboard?.write;
  const copy = async () => {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": circleToBlob(canvasRef.current) }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* presse-papiers refusé : le bouton Télécharger reste là */
    }
  };

  const empty = data && items.length < 3;
  const hb = hover?.b;

  return (
    <section className="ps-card wide ps-circle-card">
      <header className="ps-card-head">
        <h3 className="ps-card-title">
          <span className="ps-card-icon">
            <Orbit size={15} />
          </span>
          Le cercle
        </h3>
      </header>

      <div className="ps-circle">
        <div className="ps-circle-stage" style={{ background: CIRCLE_THEMES[themeKey].bg }}>
          <canvas
            ref={canvasRef}
            className={`ps-circle-canvas ${hb ? "pointing" : ""} ${empty ? "hidden" : ""}`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={onClick}
            role="img"
            aria-label={`${kindMeta.label} ${metricMeta.caption} : ${items
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
                  hb.item.hours > 0 && fmtHours(hb.item.hours),
                  fmtGames(hb.item.games),
                  hb.item.rating != null && `${hb.item.rating}/100`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
          {(error || empty) && (
            <div className="ps-circle-empty">
              {error || `Pas assez de ${kindMeta.label.toLowerCase()} pour dessiner un cercle.`}
            </div>
          )}
          {!error && !empty && (drawing || !data) && (
            <div className="ps-circle-loading">
              <Loader2 size={22} className="spin" />
            </div>
          )}
        </div>

        <div className="ps-circle-side">
          <div className="ps-circle-field">
            <span className="ps-circle-label">Quoi</span>
            <div className="ps-circle-chips">
              {KINDS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`ps-circle-chip clickable ${kind === key ? "active" : ""}`}
                  onClick={() => setKind(key)}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ps-circle-field">
            <span className="ps-circle-label">Classé par</span>
            <div className="ps-circle-chips">
              {METRICS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`ps-circle-chip clickable ${metric === key ? "active" : ""}`}
                  onClick={() => setMetric(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ps-circle-row">
            <div className="ps-circle-field">
              <span className="ps-circle-label">Bulles</span>
              <span className="ps-seg">
                {TOPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`clickable ${top === n ? "active" : ""}`}
                    onClick={() => setTop(n)}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <div className="ps-circle-field">
              <span className="ps-circle-label">Fond</span>
              <div className="ps-circle-swatches">
                {Object.entries(CIRCLE_THEMES).map(([key, th]) => (
                  <button
                    key={key}
                    type="button"
                    className={`ps-circle-swatch clickable ${themeKey === key ? "active" : ""}`}
                    style={{ background: th.bg }}
                    onClick={() => setThemeKey(key)}
                    title={th.label}
                    aria-label={th.label}
                  />
                ))}
              </div>
            </div>
          </div>

          <ol className="ps-circle-list">
            {items.slice(0, 5).map((it, i) => (
              <li key={it.name}>
                <button type="button" className="clickable" onClick={() => onPick?.(it, kindMeta.Icon)}>
                  <span className="ps-circle-rank">{i + 1}</span>
                  <span className="ps-circle-name">{it.name}</span>
                  <span className="ps-circle-value">{it.value}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="ps-circle-actions">
            <button
              type="button"
              className="btn btn-primary clickable"
              onClick={download}
              disabled={drawing || empty || !!error}
            >
              <Download size={16} /> Télécharger
            </button>
            {canCopy && (
              <button
                type="button"
                className="btn btn-ghost clickable"
                onClick={copy}
                disabled={drawing || empty || !!error}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiée" : "Copier"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
