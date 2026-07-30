import { useEffect } from "react";
import { X } from "lucide-react";

// ======================================================================
//  La coquille des modales d'administration
// ======================================================================
// Sortie du panneau Collection le jour où le papier a eu la sienne : deux
// écrans qui partagent une ossature n'ont pas à en garder chacun une copie,
// sous peine de diverger au premier réglage.
//
// L'ossature partagée par « Ajouter » et « Modifier ». Trois zones, et une
// seule qui défile :
//
//   • l'EN-TÊTE porte l'objet du moment (une vignette quand on modifie : on
//     sait alors quel boîtier on a ouvert sans relire le titre) ;
//   • le CORPS défile ;
//   • le PIED reste. C'est le point qui change tout : le bouton
//     d'enregistrement vivait dans le flux, donc il descendait avec le contenu
//     — sur un formulaire long, il fallait dérouler jusqu'en bas pour valider,
//     et on ne savait jamais s'il restait quelque chose à remplir dessous.

export function Modal({ title, subtitle, thumb, Icon, onClose, children, footer, wide }) {
  // Échap ferme : une modale qui ne se ferme qu'au clic sur la croix est une
  // impasse dès qu'on a le clavier sous les mains.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="adm-coll-modal" onClick={onClose}>
      <div
        className={`adm-coll-sheet ${wide ? "wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header>
          {thumb ? (
            <span className="adm-coll-sheet-thumb">
              <img src={thumb} alt="" />
            </span>
          ) : Icon ? (
            <span className="adm-coll-sheet-icon">
              <Icon size={18} />
            </span>
          ) : null}
          <div className="adm-coll-sheet-titles">
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="adm-coll-icon clickable" onClick={onClose} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>
        <div className="adm-coll-body">{children}</div>
        {footer && <footer className="adm-coll-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Un bloc du formulaire : un numéro, un titre, une phrase qui dit à quoi ça
// sert. Les modales étaient une seule coulée de champs — on ne voyait pas où
// finissait « d'où vient la vidéo » et où commençait « ce qu'on raconte
// dessus », alors que ce sont deux gestes différents.
export function Section({ step, title, hint, children }) {
  return (
    <section className="adm-coll-sec">
      <div className="adm-coll-sec-head">
        <span className="adm-coll-sec-step">{step}</span>
        <div>
          <h4>{title}</h4>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      <div className="adm-coll-sec-body">{children}</div>
    </section>
  );
}
