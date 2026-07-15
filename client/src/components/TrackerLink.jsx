import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Link2,
  Search,
  Trophy,
  AlertTriangle,
  ArrowLeft,
  X,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Briques partagées de liaison d'un compte de tracking (Marvel Rivals, LoL) :
// helpers visuels + formulaires « rechercher → aperçu → confirmer » + modale.
// Réutilisés par la page Paramètres ET par l'onglet Tracking d'un profil.

// Logo de carte : jaquette IGDB du jeu (repli : icône passée en children).
export function CoverLogo({ cover, className = "", children }) {
  return (
    <div className={`import-logo ${className} ${cover ? "has-cover" : ""}`}>
      {cover ? (
        <img className="import-logo-cover" src={cover} alt="" draggable="false" />
      ) : (
        children
      )}
    </div>
  );
}

// Emblème de rang (ou icône) avec repli propre si l'image échoue.
export function Emblem({ src, size = 34 }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="trk-emblem fb" style={{ width: size, height: size }}>
        <Trophy size={Math.round(size * 0.5)} />
      </span>
    );
  }
  return (
    <img
      className="trk-emblem"
      src={src}
      alt=""
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
    />
  );
}

// Avatar rond (icône d'invocateur / joueur), repli sur l'initiale du pseudo.
export function TrackerAvatar({ src, name, size = 46 }) {
  const [broken, setBroken] = useState(false);
  const ok = src && !broken;
  return (
    <span className="trk-av" style={{ width: size, height: size }}>
      {ok ? (
        <img src={src} alt="" onError={() => setBroken(true)} draggable="false" />
      ) : (
        <span className="trk-av-fb">{(name || "?")[0].toUpperCase()}</span>
      )}
    </span>
  );
}

// Aperçu du compte trouvé (avant liaison) : avatar + pseudo + rang + confirmation.
function TrackerPreview({ preview, meta, onConfirm, onCancel, busy }) {
  const hasRank = preview.rank?.image || preview.rank?.tier;
  return (
    <div className="trk-preview">
      <div className="trk-preview-id">
        <TrackerAvatar src={preview.icon} name={preview.name} size={54} />
        <div className="trk-preview-info">
          <span className="trk-preview-name">{preview.name}</span>
          <span className="trk-preview-meta">{meta}</span>
          {preview.takenByOther && (
            <span className="trk-preview-warn">
              <AlertTriangle size={12} /> Déjà lié à un autre compte
            </span>
          )}
        </div>
        {hasRank && (
          <div className="trk-preview-rank">
            <Emblem src={preview.rank.image} size={44} />
            {preview.rank.tier && <span>{preview.rank.tier}</span>}
          </div>
        )}
      </div>
      <div className="trk-preview-actions">
        <button className="trk-preview-cancel clickable" onClick={onCancel} disabled={busy}>
          <ArrowLeft size={15} /> Ce n'est pas moi
        </button>
        <button className="trk-preview-confirm clickable" onClick={onConfirm} disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <Link2 size={16} />}
          C'est bien moi
        </button>
      </div>
    </div>
  );
}

// Formulaire de liaison Marvel Rivals : recherche par PSEUDO (liste de candidats,
// pseudos non uniques) / identifiant / URL rivalsmeta → aperçu → confirmation.
export function MarvelLinkForm({ onLinked, autoFocus }) {
  const { token } = useAuth();
  const [input, setInput] = useState("");
  const [candidates, setCandidates] = useState(null); // null = pas cherché, [] = aucun
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Aperçu (rang + héros) d'un joueur choisi, avant liaison.
  async function loadPreview(uid) {
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch("/trackers/marvel-rivals/preview", {
        method: "POST",
        token,
        body: { input: uid },
      });
      setPreview(d.preview);
      setCandidates(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setCandidates(null);
    try {
      const d = await apiFetch("/trackers/marvel-rivals/search", {
        method: "POST",
        token,
        body: { input: input.trim() },
      });
      const list = d.players || [];
      // Résultat unique (uid/URL, ou un seul homonyme) : on enchaîne l'aperçu.
      if (list.length === 1) await loadPreview(list[0].uid);
      else setCandidates(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/trackers/marvel-rivals/link", {
        method: "POST",
        token,
        body: { username: preview?.uid || input.trim() },
      });
      onLinked?.("marvel-rivals");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="trk-form">
      {error && (
        <div className="import-error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {preview ? (
        <TrackerPreview
          preview={preview}
          meta={preview.rank?.tier ? `Rang : ${preview.rank.tier}` : "Compte Marvel Rivals"}
          onConfirm={confirm}
          onCancel={() => setPreview(null)}
          busy={busy}
        />
      ) : candidates ? (
        <div className="trk-candidates">
          <div className="trk-candidates-head">
            <button
              className="trk-candidates-back clickable"
              onClick={() => setCandidates(null)}
              disabled={busy}
            >
              <ArrowLeft size={14} /> Nouvelle recherche
            </button>
            <span className="trk-candidates-count">
              {candidates.length} résultat{candidates.length > 1 ? "s" : ""}
            </span>
          </div>
          {candidates.length === 0 ? (
            <p className="trk-candidates-empty">
              Aucun joueur trouvé. Vérifie l'orthographe, ou colle ton identifiant /
              l'URL de ton profil rivalsmeta.
            </p>
          ) : (
            <ul className="trk-candidates-list">
              {candidates.map((c) => (
                <li key={c.uid}>
                  <button
                    className="trk-candidate clickable"
                    onClick={() => loadPreview(c.uid)}
                    disabled={busy}
                  >
                    <TrackerAvatar src={c.icon} name={c.name} size={40} />
                    <span className="trk-candidate-name">{c.name}</span>
                    <span className="trk-candidate-id">#{c.uid}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="import-manual" style={{ marginTop: 0 }}>
          <input
            type="text"
            autoFocus={autoFocus}
            placeholder="Pseudo, identifiant, ou URL rivalsmeta"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            disabled={busy}
          />
          <button
            className="btn-steam-primary clickable"
            onClick={search}
            disabled={busy || !input.trim()}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            Rechercher
          </button>
        </div>
      )}
    </div>
  );
}

// Formulaire de liaison League of Legends (Riot ID + région).
export function LeagueLinkForm({ status, onLinked, autoFocus }) {
  const { token } = useAuth();
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("euw1");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const regions = status?.lolRegions || [];
  const notConfigured = !status?.lolConfigured;

  async function search() {
    if (!riotId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch("/trackers/league-of-legends/preview", {
        method: "POST",
        token,
        body: { riotId: riotId.trim(), region },
      });
      setPreview(d.preview);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/trackers/league-of-legends/link", {
        method: "POST",
        token,
        body: { riotId: riotId.trim(), region },
      });
      onLinked?.("league-of-legends");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const regionLabel = regions.find((r) => r.value === region)?.label || region;

  return (
    <div className="trk-form">
      {notConfigured && (
        <div className="import-error">
          <AlertTriangle size={15} /> League of Legends n'est pas configuré côté
          serveur (RIOT_API_KEY).
        </div>
      )}
      {error && (
        <div className="import-error">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {preview ? (
        <TrackerPreview
          preview={preview}
          meta={[preview.level ? `Niveau ${preview.level}` : null, regionLabel]
            .filter(Boolean)
            .join(" · ")}
          onConfirm={confirm}
          onCancel={() => setPreview(null)}
          busy={busy}
        />
      ) : (
        <div className="import-manual lol-link" style={{ marginTop: 0 }}>
          <select
            className="lol-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={busy || notConfigured}
            aria-label="Région"
          >
            {regions.length === 0 && <option value="euw1">EUW</option>}
            {regions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            autoFocus={autoFocus}
            placeholder="Pseudo#TAG"
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            disabled={busy || notConfigured}
          />
          <button
            className="btn-steam-primary clickable"
            onClick={search}
            disabled={busy || notConfigured || !riotId.trim()}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            Rechercher
          </button>
        </div>
      )}
    </div>
  );
}

// Métadonnées d'affichage des jeux liables (nom + libellé court).
export const TRACK_GAMES = {
  "marvel-rivals": { name: "Marvel Rivals", tag: "Suivre mon rang & mes héros" },
  "league-of-legends": { name: "League of Legends", tag: "Suivre mon rang & mes champions" },
};

// Modale de liaison : bannière (jaquette du jeu) + formulaire. Réutilisable
// depuis l'onglet Tracking d'un profil. `status` fourni par l'appelant.
export function TrackerLinkModal({ provider, cover, banner, status, onClose, onLinked }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const meta = TRACK_GAMES[provider] || { name: provider, tag: "" };
  const Form = provider === "league-of-legends" ? LeagueLinkForm : MarvelLinkForm;
  // Bannière « sexy » : artwork paysage du jeu (comme le fond de sa page),
  // repli sur la jaquette si aucun artwork n'est disponible.
  const hero = banner || cover;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal trk-link-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <div
          className="trk-link-hero"
          style={hero ? { backgroundImage: `url(${hero})` } : undefined}
        >
          <div className="trk-link-hero-veil" />
          <div className="trk-link-hero-txt">
            <h2>{meta.name}</h2>
            <p>{meta.tag}</p>
          </div>
        </div>

        <div className="trk-link-body">
          <Form status={status} onLinked={onLinked} autoFocus />
        </div>
      </div>
    </div>,
    document.body
  );
}
