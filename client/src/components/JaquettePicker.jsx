import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Check, X, Search, AlertTriangle, Disc3 } from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Aller chercher une jaquette dépliée chez Cinéma Passion
// ======================================================================
// LE GESTE. On pose un boîtier, il lui manque sa jaquette : on clique
// « Chercher », on regarde les éditions proposées, on désigne la bonne, et le
// mesureur s'ouvre dessus. Rien à copier, rien à coller — c'est le seul écran
// de l'admin où l'on choisit une image À L'ŒIL, parce que c'est la seule
// question qui se pose (« Matrix » en a trente et une : DVD, Blu-ray, SLIM,
// coffret, v2, v3…).
//
// DEUX APPELS, ET C'EST VOULU. La recherche revient en une requête et affiche
// les TITRES tout de suite ; les vignettes arrivent après, parce qu'il faut
// relire une page par résultat pour les connaître. Tout attendre d'un coup
// laisserait trois secondes d'écran vide là où l'on a déjà de quoi lire.
//
// La liste garde la forme de chaque objet (une jaquette dépliée est large, une
// affiche est haute) : c'est souvent à ça qu'on repère celle qui n'est pas la
// bonne.

// Combien de vignettes on demande à la fois. Une par page à relire côté
// serveur : assez pour remplir le haut de la grille d'un coup, assez peu pour
// que la tranche suivante ne se fasse pas attendre.
const CHUNK = 8;

export default function JaquettePicker({ title = "", token, onCancel, onPick }) {
  const [q, setQ] = useState(title);
  const [results, setResults] = useState(null); // null = rien encore cherché
  const [images, setImages] = useState({}); // page → { image, ratio } | null
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState(false); // les vignettes sont en route
  const [error, setError] = useState(null);
  // La recherche en cours : celle d'avant ne doit pas écraser la réponse de la
  // dernière (on retape volontiers pendant qu'elle tourne).
  const run = useRef(0);
  // Vivant ? Le drapeau est REPOSÉ à chaque montage, pas seulement à la
  // déclaration : en StrictMode, React monte l'écran, le démonte et le remonte
  // aussitôt. Le nettoyage du premier passage le mettait à `false` et plus
  // rien ne le relevait — toutes les réponses étaient alors jetées, et la
  // recherche tournait dans le vide indéfiniment alors que le serveur avait
  // répondu du premier coup.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const search = useCallback(
    async (term) => {
      const text = String(term || "").trim();
      if (text.length < 2) return;
      const mine = ++run.current;
      setBusy(true);
      setError(null);
      setPicked(null);
      setImages({});
      try {
        const d = await apiFetch(`/collection/jaquettes?q=${encodeURIComponent(text)}`, { token });
        if (!alive.current || mine !== run.current) return;
        setResults(d.results || []);
        setBusy(false);

        const pages = (d.results || []).map((r) => r.page);
        if (!pages.length) return;
        setThumbs(true);
        // PAR PAQUETS, dans l'ordre de la liste. Une recherche large tire une
        // trentaine de pages : les demander d'un bloc, c'est une grille de
        // spinners pendant tout le temps que dure la plus lente. Par tranches,
        // les premières vignettes — celles qu'on regarde — sont là tout de
        // suite, et le reste se remplit en descendant.
        for (let i = 0; i < pages.length; i += CHUNK) {
          const img = await apiFetch("/collection/jaquettes/images", {
            method: "POST",
            token,
            body: { pages: pages.slice(i, i + CHUNK) },
          });
          if (!alive.current || mine !== run.current) return;
          setImages((prev) => ({ ...prev, ...(img.images || {}) }));
        }
        setThumbs(false);
      } catch (e) {
        if (!alive.current || mine !== run.current) return;
        setError(e.message);
        setBusy(false);
        setThumbs(false);
      }
    },
    [token]
  );

  // On cherche le titre du boîtier d'emblée : neuf fois sur dix c'est la bonne
  // requête, et l'écran s'ouvre déjà rempli.
  useEffect(() => {
    if (title) search(title);
  }, [title, search]);

  const chosen = picked && images[picked]?.image;

  return (
    <div className="wrapcrop" onClick={onCancel}>
      <div
        className="wrapcrop-sheet pdfpick jaqpick"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h3>Chercher une jaquette</h3>
            <p>
              <Disc3 size={12} /> Cinéma Passion — jaquettes DVD et Blu-ray
              dépliées
              {results && ` · ${results.length} résultat${results.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <button className="adm-coll-icon clickable" onClick={onCancel} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>

        <form
          className="jaqpick-search"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Titre du film ou de la série"
            autoFocus
          />
          <button
            type="submit"
            className="btn btn-ghost clickable"
            disabled={busy || q.trim().length < 2}
          >
            {busy ? <Loader2 size={14} className="spin" /> : "Chercher"}
          </button>
        </form>

        {error ? (
          <p className="adm-coll-error">
            <AlertTriangle size={14} /> {error}
          </p>
        ) : busy ? (
          <div className="pdfpick-state">
            <Loader2 size={20} className="spin" /> Recherche…
          </div>
        ) : results && results.length === 0 ? (
          <div className="pdfpick-state">
            Aucune jaquette sous ce nom. Le fonds est francophone : essaie le
            titre français, ou un mot de moins.
          </div>
        ) : results ? (
          <div className="pdfpick-grid">
            {results.map((r) => {
              const img = images[r.page];
              return (
                <button
                  key={r.page}
                  type="button"
                  className={`pdfpick-page clickable ${picked === r.page ? "on" : ""}`}
                  onClick={() => setPicked(r.page)}
                  onDoubleClick={() => img?.image && onPick(img.image)}
                  title={r.title}
                  // Une page dont l'image n'a pas pu être relue ne mène nulle
                  // part : on la laisse voir (elle dit ce qui existe) mais on
                  // ne la propose pas.
                  disabled={images[r.page] === null}
                >
                  <span
                    className="pdfpick-shot"
                    style={{ aspectRatio: img?.ratio || 1.49 }}
                  >
                    {img?.image ? (
                      <img src={img.image} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="jaqpick-wait">
                        {images[r.page] === null ? (
                          <AlertTriangle size={14} />
                        ) : (
                          <Loader2 size={14} className="spin" />
                        )}
                      </span>
                    )}
                  </span>
                  <em>{r.title}</em>
                  {r.edition && <i className="jaqpick-tag">{r.edition}</i>}
                  {picked === r.page && (
                    <span className="pdfpick-check">
                      <Check size={13} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}

        <footer className="adm-coll-foot">
          <p className="adm-coll-hint">
            {thumbs
              ? "Les aperçus arrivent…"
              : "L'image choisie est rapatriée chez nous, puis mesurée — c'est la mesure qui donne ses dimensions au boîtier."}
          </p>
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onCancel}>
              Annuler
            </button>
            <button
              className="btn btn-primary clickable"
              onClick={() => chosen && onPick(chosen)}
              disabled={!chosen}
            >
              <Check size={16} /> Utiliser cette jaquette
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
