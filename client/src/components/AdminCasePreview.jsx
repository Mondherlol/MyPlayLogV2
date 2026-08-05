import { Suspense, lazy, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { caseArt, HI_QUALITY } from "../lib/caseTextures";
import { isComic, isGame } from "../lib/collection";
import { CaseInspector } from "./CollectionShelf";

// ======================================================================
//  ESSAYER UN BOÎTIER, DEPUIS LE PANNEAU D'ADMINISTRATION
// ======================================================================
// LE FORMULAIRE MONTRE DES IMAGES, LE RAYON MONTRE UN OBJET. Entre les deux il
// se passe tout ce qui compte : la jaquette est pliée sur trois faces, la
// tranche tombe où l'on a dit qu'elle tombait (ou pas), le titre imprimé sur le
// dos se lit (ou déborde), la teinte choisie jure avec l'affiche. Rien de tout
// ça ne se voit sur une vignette de 240 px — il fallait enregistrer, quitter le
// panneau, aller sur la page, et espérer posséder le boîtier pour le trouver.
//
// D'où ce bouton « Tester » : le MÊME geste que sur l'étagère (on prend l'objet
// en main, on le retourne, on le lit de près), lancé depuis la ligne du
// catalogue. La vitrine est celle du rayon, importée telle quelle — un second
// exemplaire aurait fini par montrer un autre objet que celui des joueurs.
//
// Deux différences avec le rayon, et deux seulement :
//
//   • PAS DE VOL. Le boîtier ne décolle de nulle part : il n'y a pas d'étagère
//     derrière, donc pas de place d'origine à quitter ni à retrouver ;
//   • L'ADMIN VOIT TOUT. La possession ne joue pas ici : un volume s'ouvre et
//     un jeu se lance même si le boîtier n'est pas encore sorti de la machine.

// Le lecteur de volumes et l'émulateur descendent à la demande, comme sur la
// page publique : ce sont plusieurs mégaoctets qui n'ont rien à faire dans le
// paquet du panneau d'administration.
const BookReader3D = lazy(() => import("./BookReader3D"));
const GbaPlayer = lazy(() => import("./GbaPlayer"));

export default function AdminCasePreview({ media, token, onClose }) {
  // La jaquette est peinte en HAUTE DÉFINITION d'emblée : ici on vient
  // justement regarder l'objet de près, il n'y a pas d'étagère à habiller vite
  // avant de le prendre en main.
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState(null); // la pose passée au lecteur
  const [landed, setLanded] = useState(false); // le volume est dessiné là-bas
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    caseArt(media, HI_QUALITY)
      .then((got) => alive && setArt(got))
      // Une jaquette illisible ne doit pas laisser un écran vide : on montre la
      // coque nue, c'est déjà un résultat d'essai (« mon image ne passe pas »).
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [media]);

  // Le temps de peindre : un voile et rien d'autre. Monter la vitrine sans
  // jaquette ferait apparaître une coque blanche qui se peindrait ensuite —
  // c'est-à-dire exactement le défaut qu'on regarde ailleurs pour l'éviter.
  if (!art && !failed)
    return createPortal(
      <div className="adm-coll-try-wait" role="status">
        <Loader2 size={22} className="spin" />
        <span>Peinture de la jaquette…</span>
      </div>,
      document.body
    );

  return (
    <>
      {/* La vitrine reste montée pendant que le lecteur de volumes s'allume :
          les deux montrent le même objet dans la même pose, et le relais ne se
          voit pas. La console, elle, n'a rien à voir avec un boîtier qui
          tourne — on la laisse prendre tout l'écran. */}
      {!playing && !landed && (
        <CaseInspector
          media={media}
          art={art}
          from={null}
          onClose={onClose}
          onOpen={() =>
            window.open(`/collection/${media.slug}`, "_blank", "noopener")
          }
          onRead={isComic(media) ? (pose) => setReading(pose) : null}
          onPlay={
            isGame(media) && media.cartridge?.rom ? () => setPlaying(true) : null
          }
        />
      )}

      {reading && (
        <Suspense fallback={null}>
          <BookReader3D
            media={media}
            art={art}
            from={null}
            pose={reading}
            // UN ESSAI NE LAISSE PAS DE TRACE. Sans ce rapporteur muet, le
            // lecteur enregistrerait la planche courante comme une lecture — et
            // feuilleter trois volumes pour vérifier leurs jaquettes poserait
            // trois signets qu'on n'a jamais posés.
            onProgress={() => {}}
            onLanded={() => setLanded(true)}
            onClose={onClose}
          />
        </Suspense>
      )}

      {playing && (
        <Suspense fallback={null}>
          <GbaPlayer media={media} token={token} onClose={onClose} />
        </Suspense>
      )}
    </>
  );
}
