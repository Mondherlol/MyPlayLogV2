import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, Loader2, Gamepad2, Search, Check, Upload } from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useAuth } from "../context/AuthContext";

// Une image qui s'annonce avant d'arriver : la tuile scintille tant que le
// fichier n'est pas là, puis l'image se fond dedans.
//
// ⚠️ CHAQUE TUILE TIENT SON PROPRE ÉTAT. Un seul drapeau pour toute la grille
// aurait éteint le scintillement des vingt autres dès la première image
// reçue — or ce sont des artworks en pleine résolution, elles n'arrivent pas
// ensemble.
function CoverImg({ url }) {
  const [ready, setReady] = useState(false);
  const done = () => setReady(true);
  return (
    <>
      {!ready && <span className="coverpick-skel" aria-hidden="true" />}
      <img
        src={url}
        alt=""
        loading="lazy"
        draggable="false"
        className={ready ? "is-ready" : ""}
        onLoad={done}
        // Une image morte ne doit pas scintiller pour l'éternité.
        onError={done}
      />
    </>
  );
}

// Choisir une photo de couverture : on cherche un jeu dans TOUT le catalogue
// (ou parmi ses jeux quand la recherche est vide), puis on pioche une de ses
// images (jaquette ou artwork).
export default function CoverPickerModal({ entries, current, count = 0, onPick, onClose }) {
  const { token } = useAuth();
  const [game, setGame] = useState(null);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const reqRef = useRef(0);

  // Upload d'une image perso : on l'envoie au serveur, puis on la traite comme
  // n'importe quelle couverture choisie (onPick → recadrage).
  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("cover", file);
      const { url } = await apiUpload("/users/me/cover", fd, token);
      onPick(url);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Recherche IGDB (débouncée). Vide → jeux populaires.
  useEffect(() => {
    if (game) return;
    const term = q.trim();
    const id = ++reqRef.current;
    setSearching(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: 24, sort: "popularity" });
      if (term) params.set("search", term);
      apiFetch(`/games?${params}`, { token })
        .then((d) => id === reqRef.current && setResults(d.games || []))
        .catch(() => id === reqRef.current && setResults([]))
        .finally(() => id === reqRef.current && setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, token, game]);

  // Jeux de la bibliothèque (suggestions rapides quand pas de recherche)
  const myGames = [];
  const seen = new Set();
  for (const e of entries) {
    if (e.cover && !seen.has(e.gameId)) {
      seen.add(e.gameId);
      myGames.push({ id: e.gameId, name: e.name, cover: e.cover });
    }
  }

  const showMine = !q.trim() && myGames.length > 0;
  const list = showMine ? myGames : results;

  async function openGame(g) {
    setGame(g);
    setLoading(true);
    setImages([]);
    try {
      const d = await apiFetch(`/games/${g.id}/details`, { token });
      const imgs = (d.covers || []).map((c) => c.url);
      setImages(imgs.length ? imgs : g.cover ? [g.cover] : []);
    } catch {
      setImages(g.cover ? [g.cover] : []);
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal additems-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">Photo de couverture</h2>

        {game ? (
          <>
            <div className="additems-crumb">
              <button className="crumb-back clickable" onClick={() => setGame(null)}>
                <ArrowLeft size={16} /> Retour
              </button>
              <span className="crumb-current">{game.name}</span>
            </div>
            {loading ? (
              // ⚠️ LA FORME DE CE QUI ARRIVE, PAS UNE ROULETTE. Une ligne
              // « Chargement… » ne dit rien de ce qu'on va recevoir, et la
              // grille apparaissait d'un coup en repoussant tout. Les tuiles
              // sont là AVANT les images, à leur taille définitive.
              <div className="coverpick-grid">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="coverpick-img coverpick-ghost" aria-hidden="true">
                    <span className="coverpick-skel" />
                  </span>
                ))}
              </div>
            ) : images.length === 0 ? (
              <p className="additems-hint font-fun">Aucune image pour ce jeu.</p>
            ) : (
              <div className="coverpick-grid">
                {images.map((url) => (
                  <button
                    key={url}
                    className={`coverpick-img clickable ${current === url ? "active" : ""}`}
                    onClick={() => onPick(url)}
                  >
                    <CoverImg url={url} />
                    <span className="coverpick-check">
                      <Check size={16} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="additems-search">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Rechercher un jeu dans tout le catalogue…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {searching && <Loader2 size={16} className="spin" />}
            </div>
            <button
              className="btn btn-ghost coverpick-upload clickable"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{ width: "100%", justifyContent: "center", marginBottom: "0.6rem" }}
            >
              {uploading ? (
                <><Loader2 size={16} className="spin" /> Envoi…</>
              ) : (
                <><Upload size={16} /> Importer ma propre image</>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onFile}
            />
            <p className="additems-hint font-fun" style={{ marginTop: 0, marginBottom: "0.6rem" }}>
              {showMine ? "Tes jeux — ou cherche n'importe quel titre ci-dessus." : "Choisis un jeu, puis une de ses images."}
            </p>
            <div className="additems-grid">
              {list.map((g) => (
                <button
                  key={g.id}
                  className="pick-card clickable"
                  onClick={() => openGame(g)}
                  title={g.name}
                >
                  <div className="pick-cover">
                    {g.cover ? (
                      <img src={g.cover} alt={g.name} loading="lazy" draggable="false" />
                    ) : (
                      <Gamepad2 size={24} />
                    )}
                  </div>
                  <span className="pick-name">{g.name}</span>
                </button>
              ))}
            </div>
            {!searching && list.length === 0 && (
              <p className="additems-hint font-fun">Aucun jeu trouvé.</p>
            )}
          </>
        )}

        {count > 0 && !game && (
          <div className="additems-foot">
            <span className="additems-count">
              {count > 1
                ? `${count} photos de couverture définies`
                : "Une couverture est déjà définie"}
            </span>
            <button className="btn btn-ghost" onClick={() => onPick(null)}>
              {count > 1 ? "Tout retirer" : "Retirer la couverture"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
