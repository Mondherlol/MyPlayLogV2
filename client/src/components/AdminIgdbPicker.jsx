import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X, Gamepad2, Star, Check } from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Désigner LE jeu sur IGDB
// ======================================================================
// UNE CARTOUCHE NE SAIT PAS CE QU'ELLE CONTIENT. Un fichier .gba porte un code
// de jeu, une région et douze caractères en capitales — ni jaquette, ni résumé,
// ni éditeur, ni année. Tout le reste se tapait à la main, fiche par fiche.
//
// ON NE DEVINE PAS, ON DEMANDE. Rapprocher automatiquement « ZELDA MC » d'une
// entrée d'IGDB marcherait neuf fois sur dix — et la dixième poserait la
// jaquette d'un autre jeu sans que personne ne s'en aperçoive. L'admin voit une
// liste et désigne le bon titre : c'est un clic, et c'est certain.
//
// LA RECHERCHE EST LIMITÉE À LA CONSOLE (identifiant 24 chez IGDB, la Game Boy
// Advance). « Zelda » rend soixante jeux sur quinze machines ; sur GBA il en
// reste quatre, et le bon est visible sans faire défiler.

const GBA_PLATFORM = 24;

export default function IgdbPicker({ token, current, onPick, onClear }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(null); // id en cours de chargement
  const [error, setError] = useState(null);
  const seq = useRef(0);

  // La recherche part quand la frappe s'arrête. Le compteur `seq` jette les
  // réponses arrivées dans le désordre : sans lui, une requête lente lancée sur
  // « zel » écrase le résultat de « zelda » deux secondes plus tard.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows([]);
      return undefined;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      apiFetch(
        `/games?search=${encodeURIComponent(term)}&platform=${GBA_PLATFORM}&limit=12`,
        { token }
      )
        .then((d) => {
          if (mine !== seq.current) return;
          setRows(d.games || []);
          setError(null);
        })
        .catch((e) => mine === seq.current && setError(e.message))
        .finally(() => mine === seq.current && setLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [q, token]);

  // On rend la FICHE COMPLÈTE, pas la ligne de résultat : c'est elle qui porte le
  // résumé, l'éditeur, la saga et le grand visuel — tout ce qu'on est venu
  // chercher. Le résultat de recherche n'a qu'un nom et une jaquette.
  async function take(row) {
    setPicking(row.id);
    setError(null);
    try {
      const full = await apiFetch(`/games/${row.id}/full`, { token });
      onPick({ ...full, id: row.id });
      setQ("");
      setRows([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setPicking(null);
    }
  }

  return (
    <div className="adm-igdb">
      {current ? (
        <div className="adm-igdb-picked">
          <span className="adm-igdb-cover">
            {current.cover ? (
              <img src={current.cover} alt="" />
            ) : (
              <Gamepad2 size={18} />
            )}
          </span>
          <div>
            <strong>
              <Check size={13} /> {current.name}
            </strong>
            <em>
              Rattaché à la fiche du jeu · IGDB {current.id}
              {current.year ? ` · ${current.year}` : ""}
            </em>
          </div>
          {onClear && (
            <button type="button" className="clickable" onClick={onClear} aria-label="Détacher">
              <X size={15} />
            </button>
          )}
        </div>
      ) : (
        <div className="au-search adm-igdb-search">
          <Search size={16} />
          <input
            type="search"
            name="mpl-igdb-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher le jeu sur IGDB (Game Boy Advance)…"
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore="true"
          />
          {loading && <Loader2 size={15} className="spin" />}
        </div>
      )}

      {error && <p className="adm-coll-error">{error}</p>}

      {rows.length > 0 && (
        <ul className="adm-igdb-list">
          {rows.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="adm-igdb-row clickable"
                onClick={() => take(g)}
                disabled={picking !== null}
              >
                <span className="adm-igdb-cover">
                  {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : <Gamepad2 size={16} />}
                </span>
                <span className="adm-igdb-txt">
                  <strong>{g.name}</strong>
                  <em>
                    {[g.year, (g.genres || []).slice(0, 2).join(", ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                </span>
                {g.rating != null && (
                  <span className="adm-igdb-note">
                    <Star size={11} /> {g.rating}
                  </span>
                )}
                {picking === g.id && <Loader2 size={15} className="spin" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!current && q.trim().length >= 2 && !loading && !rows.length && !error && (
        <p className="adm-coll-hint">
          Rien sur Game Boy Advance à ce nom. Une traduction de fans ou un
          homebrew n'est pas dans IGDB : remplis la fiche à la main, c'est prévu.
        </p>
      )}
    </div>
  );
}
