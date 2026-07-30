import { useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { apiFetch } from "../lib/api";
import { CommentThread } from "./ListComments";

// ======================================================================
//  Le fil d'un titre de la collection
// ======================================================================
// Enveloppe autour de CommentThread (le fil des listes) branchée sur les routes
// /collection/:slug/comments. Tout le reste — composer, mentions, médias,
// réponses, likes, lightbox, historique — est celui des listes : un fil de
// discussion n'avait aucune raison d'être réécrit pour cette page.
//
// LE FIL SE CHARGE À PART, après la fiche. La fiche porte déjà les planches ou
// la liste d'épisodes : lui attacher les commentaires retarderait l'affichage du
// bouton « Lire » pour une conversation qu'on ne voit qu'en bas de page.

// De quoi on parle, selon ce qu'on a devant soi. Le fil est le même pour les
// quatre supports, mais l'invitation à écrire ne peut pas l'être : on ne
// « regarde » pas un manga, et « cet épisode » ne veut rien dire sur une
// cartouche.
const WORDING = {
  series: {
    placeholder: "Un avis sur cette série, un épisode à conseiller…",
    empty: "Personne n'a encore parlé de cette série. À toi de lancer le sujet.",
  },
  film: {
    placeholder: "Un avis sur ce film…",
    empty: "Personne n'a encore parlé de ce film. À toi de lancer le sujet.",
  },
  comic: {
    placeholder: "Un avis sur ce volume, une planche marquante…",
    empty: "Personne n'a encore parlé de ce titre. À toi d'ouvrir la discussion.",
  },
  game: {
    placeholder: "Un avis sur ce jeu, une astuce, un passage bloquant…",
    empty: "Personne n'a encore parlé de ce jeu. À toi d'ouvrir la discussion.",
  },
};

export default function CollectionComments({ slug, kind, token }) {
  const [comments, setComments] = useState(null); // null = pas encore chargé
  const [moderator, setModerator] = useState(false); // admin : peut tout effacer
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setComments(null);
    setError(null);
    apiFetch(`/collection/${slug}/comments`, { token })
      .then((d) => {
        if (!alive) return;
        setComments(d.comments || []);
        setModerator(!!d.moderator);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [slug, token]);

  const words = WORDING[kind] || WORDING.film;

  // L'attente et l'erreur gardent l'en-tête du fil : la section ne doit pas
  // apparaître d'un coup au milieu de la page une fois la requête revenue.
  if (comments === null || error) {
    return (
      <section className="ld-comments card">
        <h3 className="ld-comments-title">
          <MessageCircle size={18} /> Discussion
        </h3>
        {error ? (
          <p className="lc-error">{error}</p>
        ) : (
          <div className="modal-loading">
            <Loader2 size={20} className="spin" /> Chargement des commentaires…
          </div>
        )}
      </section>
    );
  }

  return (
    <CommentThread
      base={`/collection/${slug}`}
      comments={comments}
      moderatorMine={moderator}
      token={token}
      title="Discussion"
      placeholder={words.placeholder}
      emptyText={words.empty}
    />
  );
}
