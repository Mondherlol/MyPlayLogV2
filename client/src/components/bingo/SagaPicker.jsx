import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Loader2, Search, X } from "lucide-react";
import { apiFetch } from "../../lib/api";

// ======================================================================
//  CHERCHER UNE SAGA, POUR HABILLER UNE CASE
// ======================================================================
// Port web de myplaylog-mobile/src/components/bingo/SagaPicker.jsx.
//
// ⚠️ ON CHERCHE UNE SAGA D'ABORD, UN JEU SEULEMENT EN REPLI. Une case de bingo
// dit rarement « Metroid Prime 4 » ; elle dit « quelque chose Metroid », parce
// qu'on ne sait justement pas ce qui va être annoncé. Chercher par JEU
// obligerait à choisir un titre précis pour illustrer un pronostic qui n'en
// vise aucun — et à parcourir vingt épisodes pour trouver celui dont l'artwork
// fait une jolie case. On cherche donc la LICENCE, et on montre d'un coup tous
// ses visuels, tous épisodes confondus.
//
// Mais « Katana Zero » n'est la licence de rien : répondre « aucun résultat »
// sur un jeu qui existe donne une recherche qu'on croit cassée. Le serveur
// descend donc d'un cran quand aucune licence ne porte le nom cherché
// (cf. server/lib/franchises, `searchSagas`), et la ligne dit alors qu'elle est
// un jeu — pas une licence.
//
// Deux temps, dans la même surface : la liste des sagas, puis leurs images.

// La recherche part sur Entrée, ou quand la frappe s'arrête. Jamais à la
// lettre : chaque requête coûte un appel IGDB, qui n'en accepte que quatre par
// seconde pour tout le site.
const DEBOUNCE_MS = 650;

export default function SagaPicker({ token, initialQuery = "", initialSaga = null, onPick, onBack }) {
  // ⚠️ LE TEXTE DE LA CASE SERT DE PREMIÈRE RECHERCHE. On vient d'écrire
  // « Metroid Prime 4 » et on cherche une image de Metroid : retaper le mot
  // était un travail qu'on venait de faire. Ce n'est qu'un DÉPART — la croix
  // l'efface d'un geste quand ce n'était pas ça.
  const [q, setQ] = useState(initialQuery);
  const [term, setTerm] = useState(initialQuery);
  const [sagas, setSagas] = useState([]);
  // Une image déjà prise dans une saga rouvre sur CETTE saga : changer l'image
  // d'une case, c'est neuf fois sur dix en prendre une autre du même rayon.
  const [saga, setSaga] = useState(initialSaga);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ⚠️ UN JETON DE REQUÊTE, PARCE QUE LA FRAPPE VA PLUS VITE QUE LE RÉSEAU.
  // « zel » part, « zeld » part, « zelda » part ; si la première réponse arrive
  // en dernier, la liste affiche les résultats de « zel » sous le mot « zelda ».
  // On ne garde que la réponse de la dernière demande partie.
  const seq = useRef(0);

  // La frappe s'arrête → le terme devient la recherche.
  useEffect(() => {
    const id = setTimeout(() => setTerm(q), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    // Une saga est ouverte : c'est sa grille d'images qu'on regarde. Chercher
    // pendant ce temps serait une requête pour un écran qu'on n'affiche pas.
    if (saga) return;
    const mine = ++seq.current;
    const needle = term.trim();
    if (needle.length < 2) {
      setSagas([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    apiFetch(`/games/sagas?q=${encodeURIComponent(needle)}`, { token })
      .then((res) => mine === seq.current && setSagas(res.sagas || []))
      .catch((err) => {
        if (mine !== seq.current) return;
        setError(err.message || "Recherche indisponible.");
        setSagas([]);
      })
      .finally(() => mine === seq.current && setLoading(false));
  }, [term, token, saga]);

  const loadImages = useCallback(
    (s) => {
      const mine = ++seq.current;
      setImages([]);
      setLoading(true);
      setError("");
      apiFetch(`/games/sagas/${s.kind}/${s.id}/images`, { token })
        .then((res) => mine === seq.current && setImages(res.images || []))
        .catch((err) => mine === seq.current && setError(err.message || "Images indisponibles."))
        .finally(() => mine === seq.current && setLoading(false));
    },
    [token]
  );

  // La saga mémorisée s'ouvre à l'affichage, sans passer par la liste.
  useEffect(() => {
    if (initialSaga) loadImages(initialSaga);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Deuxième temps : les visuels de la saga choisie ------------------
  if (saga) {
    return (
      <div className="bgs">
        <button
          type="button"
          className="bgs-back clickable"
          onClick={() => {
            setSaga(null);
            setImages([]);
            setError("");
          }}
        >
          <ChevronLeft size={17} />
          <span>{saga.name}</span>
        </button>

        {loading && (
          <div className="bgs-state">
            <Loader2 size={20} className="spin" />
          </div>
        )}
        {!loading && !images.length && (
          <p className="bgs-state">{error || "Aucune image pour cette saga."}</p>
        )}

        {images.length > 0 && (
          <div className="bgs-grid">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                className="bgs-thumb clickable"
                title={img.gameName || saga.name}
                // La saga part AVEC l'image : c'est elle qui permettra de
                // rouvrir ici la prochaine fois.
                onClick={() =>
                  onPick({
                    url: img.url,
                    gameId: img.gameId ?? null,
                    gameName: img.gameName || "",
                    saga: { id: saga.id, kind: saga.kind, name: saga.name },
                  })
                }
              >
                <img src={img.thumb || img.url} alt="" loading="lazy" draggable="false" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Premier temps : la recherche ------------------------------------
  const tooShort = q.trim().length < 2;

  return (
    <div className="bgs">
      <button type="button" className="bgs-back clickable" onClick={onBack}>
        <ChevronLeft size={17} />
        <span>Choisir une image</span>
      </button>

      <div className="bgc-search">
        <Search size={15} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setTerm(q);
            }
          }}
          placeholder="Une saga : Zelda, Metroid, Final Fantasy…"
          aria-label="Chercher une saga"
        />
        {loading ? (
          <Loader2 size={14} className="spin" />
        ) : (
          // La croix, parce que le champ arrive PRÉREMPLI : effacer le texte de
          // la case lettre par lettre pour chercher autre chose rendrait le
          // préremplissage plus pénible que pratique.
          !!q && (
            <button
              type="button"
              className="bgc-search-clear clickable"
              onClick={() => setQ("")}
              aria-label="Effacer la recherche"
            >
              <X size={13} />
            </button>
          )
        )}
      </div>

      {tooShort && <p className="bgs-state">Tape le nom d'une licence ou d'un jeu.</p>}
      {!tooShort && !loading && term === q && !sagas.length && (
        <p className="bgs-state">{error || "Aucune saga trouvée."}</p>
      )}

      {sagas.length > 0 && (
        <div className="bgs-list">
          {sagas.map((s) => (
            <button
              key={`${s.kind}-${s.id}`}
              type="button"
              className="bgs-row clickable"
              onClick={() => {
                setSaga(s);
                loadImages(s);
              }}
            >
              <span className="bgs-row-name">{s.name}</span>
              {/* Ce qui est à droite dit de quelle NATURE est la ligne : un
                  nombre de jeux, c'est une licence ; une année, c'est un jeu
                  isolé (le repli du serveur). Sans cette distinction, « Katana
                  Zero » et « Zelda » auraient l'air d'être la même chose et on
                  ne comprendrait pas pourquoi l'un donne trente images et
                  l'autre quatre. */}
              {s.kind === "game" ? (
                <span className="bgs-row-meta game">{s.year ? `Jeu · ${s.year}` : "Jeu"}</span>
              ) : (
                s.gameCount > 0 && (
                  <span className="bgs-row-meta">
                    {s.gameCount} jeu{s.gameCount > 1 ? "x" : ""}
                  </span>
                )
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
