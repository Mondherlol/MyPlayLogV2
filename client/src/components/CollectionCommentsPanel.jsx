import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackClose } from "../hooks/useBackClose";
import { KINDS } from "../lib/collection";
import CollectionComments from "./CollectionComments";

// ======================================================================
//  Le panneau de discussion de la vitrine
// ======================================================================
// On tient l'objet en main, on veut savoir ce qu'on en dit : le fil arrive PAR
// LA DROITE et se pose à côté, sans que l'objet quitte l'écran. Il continue de
// tourner derrière — c'est tout l'intérêt de ne pas avoir changé de page.
//
// PORTAIL À PART, et non un enfant de `.coll-inspect`. La vitrine porte
// `touch-action: none` (elle capte le doigt pour faire pivoter le boîtier), et
// cette propriété se calcule sur TOUTE la lignée d'un élément : un panneau posé
// dedans n'aurait pas pu défiler au doigt, quoi qu'il déclare pour lui-même. Il
// vit donc à côté, et reçoit la teinte du titre en clair plutôt que de
// l'hériter.

// Doit rester égale à la durée de `ccp-out` (app-26-collection.css) : on démonte
// quand le panneau a fini de sortir de l'écran, jamais avant — sinon il
// disparaît d'un coup au lieu de glisser.
const SLIDE_OUT = 300;

export default function CollectionCommentsPanel({ media, token, onClose }) {
  const [closing, setClosing] = useState(false);
  const going = useRef(false);

  const close = useCallback(() => {
    if (going.current) return;
    going.current = true;
    setClosing(true);
    setTimeout(onClose, SLIDE_OUT);
  }, [onClose]);

  // Le « retour » du téléphone referme le panneau et LUI SEUL : la vitrine a
  // empilé son entrée sous la nôtre (clé « case »), elle reste donc ouverte.
  useBackClose(close, "coll-comments");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // ÉCHAP APPARTIENT À CE QUI EST AU-DESSUS. Le fil ouvre ses propres
      // calques (l'agrandissement d'une image, l'historique d'un message, le
      // sélecteur d'émoji), chacun avec son Échap : refermer le panneau en même
      // temps ferait deux gestes pour une frappe. On ne prend la touche que si
      // personne ne nous surplombe — leur présence dans la page est le seul
      // signal commun qu'on ait, ces calques étant montés par des composants
      // qu'on ne pilote pas.
      if (document.querySelector(".mv-overlay, .modal-overlay, .lc-pop")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const kind = KINDS[media.kind]?.label || "Titre";

  return createPortal(
    <div
      className={`ccp-layer ${closing ? "closing" : ""}`}
      style={{ "--tint": media.color || "var(--orange)" }}
    >
      {/* Le boîtier reste visible et continue de tourner : le voile ne fait
          qu'assombrir son côté de l'écran pour que l'œil aille au fil. Il sert
          aussi d'attrape-clic — sans lui, cliquer à côté du panneau tomberait
          sur la scène 3D, qui prend ça pour « repose le boîtier » et refermerait
          toute la vitrine. */}
      <button className="ccp-scrim" onClick={close} aria-label="Fermer la discussion" />

      <aside className="ccp" role="dialog" aria-label={`Commentaires — ${media.title}`}>
        <header className="ccp-head">
          <span className="ccp-art">
            {media.poster ? (
              <img src={media.poster} alt="" />
            ) : (
              <i>{media.title.slice(0, 1)}</i>
            )}
          </span>
          <span className="ccp-id">
            <em>{kind}</em>
            <strong>{media.title}</strong>
          </span>
          <button className="ccp-close clickable" onClick={close} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <div className="ccp-body">
          <CollectionComments slug={media.slug} kind={media.kind} token={token} />
        </div>
      </aside>
    </div>,
    document.body
  );
}
