import { useEffect, useState } from "react";
import { Volume2, X } from "lucide-react";
import { useChat } from "../context/ChatContext";
import { speakTts } from "../lib/botVoice";

// ======================================================================
//  Ce que le bot vient de gueuler, à l'écran
// ======================================================================
// Le message est PRONONCÉ (voir lib/botVoice.js) ; cette bannière l'écrit
// quand même, pour trois raisons qui se cumulent :
//
//   • Chrome refuse de parler tant qu'on n'a rien cliqué sur la page. Sans
//     texte à l'écran, le message serait purement et simplement perdu ;
//   • on peut être casque débranché, son coupé, ou tout simplement à côté ;
//   • une insulte qu'on n'a entendue qu'à moitié, on veut la relire — d'où le
//     bouton qui rejoue.
//
// Elle s'efface toute seule au bout de dix secondes : c'est une notification,
// pas un historique (le fil du bot, lui, garde tout).
export default function BotShout() {
  const { subscribe } = useChat();
  const [shout, setShout] = useState(null);

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "tts") return;
      setShout({ ...data, at: Date.now() });
    });
  }, [subscribe]);

  useEffect(() => {
    if (!shout) return undefined;
    const t = setTimeout(() => setShout(null), 10_000);
    return () => clearTimeout(t);
  }, [shout]);

  if (!shout) return null;

  return (
    <div className="bot-shout" role="status">
      <button
        type="button"
        className="bot-shout-replay clickable"
        onClick={() => speakTts(shout)}
        title="Réécouter"
      >
        <Volume2 size={18} />
      </button>
      <div className="bot-shout-body">
        <p className="bot-shout-text">{shout.text}</p>
        {shout.remark && <p className="bot-shout-remark">— {shout.remark}</p>}
        {/* Un message qui attendait depuis hier soir : le dire évite de croire
            que la personne vient de l'envoyer à l'instant. */}
        {shout.late && <span className="bot-shout-late">reçu pendant ton absence</span>}
      </div>
      <button
        type="button"
        className="bot-shout-close clickable"
        onClick={() => setShout(null)}
        aria-label="Fermer"
      >
        <X size={15} />
      </button>
    </div>
  );
}
