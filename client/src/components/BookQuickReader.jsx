import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Loader2, Lock, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { FLAT_FIRST } from "../lib/collection";
import useMediaQuery from "../hooks/useMediaQuery";

// Le volume est un portail plein écran qui emporte three.js avec lui : il ne
// descend que si l'on ouvre vraiment un passage, jamais à l'ouverture d'un fil.
const BookReader3D = lazy(() => import("./BookReader3D"));
// Et sur un téléphone, c'est la lecture à plat qui s'ouvre (voir FLAT_FIRST) —
// une planche reçue en message se regarde au pouce, pas en perspective. Elle
// n'embarque que son carrousel, donc rien de three.js ne descend là-bas.
const ComicReader = lazy(() => import("./ComicReader"));

// ======================================================================
//  Ouvrir un bouquin SANS QUITTER LA CONVERSATION
// ======================================================================
// ON NE DÉPLACE PAS QUELQU'UN QUI EST EN TRAIN DE PARLER. Une capture reçue en
// message, c'est « regarde ça » au milieu d'un échange : y répondre en emmenant
// la personne sur la fiche du bouquin, c'est fermer la conversation pour lui
// montrer la page — elle lit trois planches, revient, et la discussion a
// continué sans elle.
//
// Le volume s'ouvre donc PAR-DESSUS le fil, exactement comme il s'ouvre
// par-dessus une fiche : même lecteur, même marque-page (ce qu'on lit depuis un
// message avance la lecture pour de bon, ce serait absurde autrement), et
// « fermer » rend la conversation là où on l'avait laissée.
//
// LE BOÎTIER PEUT NE PAS ÊTRE À NOUS. Le rayon est commun mais l'étagère est
// personnelle : on peut très bien recevoir la planche d'un volume qu'on n'a pas
// encore sorti de la machine. Le serveur ne rend alors aucune planche — et
// plutôt que d'ouvrir un lecteur vide, on le dit, avec le seul chemin qui mène
// quelque part : la fiche, et la machine derrière elle.
export default function BookQuickReader({ slug, page = 0, onClose }) {
  const { token } = useAuth();
  const flatFirst = useMediaQuery(FLAT_FIRST);
  const [media, setMedia] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | locked | error

  useEffect(() => {
    let alive = true;
    setState("loading");
    apiFetch(`/collection/${slug}`, { token })
      .then((d) => {
        if (!alive) return;
        const m = d.media;
        setMedia(m);
        // « Verrouillé » se lit sur les PLANCHES, pas seulement sur `owned` : un
        // volume qu'on possède mais dont le rayon n'a plus les images ne
        // s'ouvre pas davantage, et un lecteur sans page est un écran noir.
        setState(m?.owned === false || !m?.pages?.length ? "locked" : "ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [slug, token]);

  // Le marque-page suit, comme depuis la fiche : c'est la même lecture.
  const savePage = useCallback(
    (at) => {
      apiFetch(`/collection/${slug}/page`, {
        method: "POST",
        token,
        body: { page: at },
      }).catch(() => {});
    },
    [slug, token]
  );

  if (state === "ready" && media) {
    const Reader = flatFirst ? ComicReader : BookReader3D;
    return (
      <Suspense fallback={null}>
        <Reader
          media={media}
          startPage={page}
          onProgress={savePage}
          onClose={onClose}
        />
      </Suspense>
    );
  }

  // Les trois autres états tiennent dans le même petit panneau posé sur le
  // fil : attendre, ne pas pouvoir, ne pas y arriver.
  return createPortal(
    <div
      className="bqr-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bqr-panel">
        <button className="bqr-x clickable" onClick={onClose} aria-label="Fermer">
          <X size={17} />
        </button>
        {state === "loading" && (
          <>
            <Loader2 size={22} className="spin" />
            <strong>On sort le volume…</strong>
          </>
        )}
        {state === "locked" && (
          <>
            <span className="bqr-ic">
              <Lock size={20} />
            </span>
            <strong>Ce boîtier n'est pas sur ton étagère</strong>
            <p>
              {media?.title
                ? `« ${media.title} » se débloque à la machine à capsules.`
                : "Ce volume se débloque à la machine à capsules."}
            </p>
            <Link
              to={`/collection/${slug}`}
              className="btn btn-primary clickable"
              onClick={onClose}
            >
              Voir la fiche
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <strong>Le volume n'a pas voulu s'ouvrir.</strong>
            <Link
              to={`/collection/${slug}`}
              className="btn btn-ghost clickable"
              onClick={onClose}
            >
              Aller à la fiche
            </Link>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
