import { useEffect } from "react";
import { Phone, PhoneOff, Users } from "lucide-react";
import { startRingtone, startBuzz } from "../lib/ringtone";

// ======================================================================
//  Ça sonne
// ======================================================================
// La modale qui arrive par-dessus tout le reste. Elle a UNE responsabilité :
// être impossible à rater, et se répondre en un geste.
//
// TROIS CANAUX, PARCE QU'AUCUN N'EST FIABLE SEUL :
//   - le son, que le navigateur peut refuser tant qu'on n'a rien cliqué dans la
//     page (lib/ringtone.js explique pourquoi c'est justement le cas ici) ;
//   - la vibration, qui n'existe pas sur ordinateur ni sur iOS ;
//   - l'image, qui pulse — le seul canal toujours disponible, d'où l'animation
//     appuyée et l'écran assombri derrière.
//
// PAS DE FERMETURE AU CLIC EXTÉRIEUR, ni à Échap. Une modale ordinaire se ferme
// d'un clic à côté ; celle-ci porte deux décisions dont l'une prévient
// l'appelant. La fermer par mégarde en cliquant sur la page laisserait sonner
// dans le vide chez l'autre — on répond, ou on refuse.
export default function IncomingCall({ call, ringtone, onAccept, onDecline }) {
  useEffect(() => {
    // La sonnerie de CELUI QUI REÇOIT (lib/ringtone.js). Elle est lue au montage
    // et jamais relue : changer de sonnerie pendant qu'on sonne n'aurait aucun
    // sens, et remettre le fichier à zéro en plein milieu le ferait bégayer.
    const stopRing = startRingtone(ringtone);
    const stopBuzz = startBuzz();
    return () => {
      stopRing();
      stopBuzz();
    };
  }, []);

  const who = call.group ? call.title || "Groupe" : call.from?.username || "Quelqu'un";
  const avatar = call.avatar || call.from?.avatar || null;

  return (
    <div className="ring-veil" role="dialog" aria-modal="true" aria-label={`Appel de ${who}`}>
      <div className="ring-card">
        <span className="ring-av">
          {/* Les ondes sont DERRIÈRE la photo et décalées dans le temps : c'est
              ce qui donne l'impression que ça sonne, plutôt qu'une photo qui
              grossit et rétrécit bêtement. */}
          <i className="ring-wave w1" />
          <i className="ring-wave w2" />
          <i className="ring-wave w3" />
          {avatar ? (
            <img src={avatar} alt="" draggable="false" />
          ) : (
            <span className="ring-ph">
              {call.group ? <Users size={30} /> : who[0].toUpperCase()}
            </span>
          )}
        </span>

        <b className="ring-who">{who}</b>
        <span className="ring-what">
          {call.group ? (
            <>
              {call.from?.username || "Quelqu'un"} lance un appel
              {call.members ? ` · ${call.members} membres` : ""}
            </>
          ) : (
            "Appel entrant"
          )}
        </span>

        <div className="ring-actions">
          {/* Refuser à GAUCHE, décrocher à DROITE, et pas l'inverse : c'est
              l'ordre de tous les téléphones. On répond à un appel sans lire les
              boutons. */}
          <button type="button" className="ring-btn no clickable" onClick={onDecline}>
            <PhoneOff size={22} />
            <em>Refuser</em>
          </button>
          <button type="button" className="ring-btn yes clickable" onClick={onAccept}>
            <Phone size={22} />
            <em>Décrocher</em>
          </button>
        </div>
      </div>
    </div>
  );
}
