import { Link } from "react-router-dom";
import {
  Check,
  Dices,
  Gamepad2,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { pickReason } from "../../lib/home";

// ======================================================================
//  Les bandes : le mot du jour, la proposition du soir
// ======================================================================
// Trois blocs pleine largeur, posés entre les rails. Ils se lisent en une
// seconde et ne réclament pas de titre à deux étages.

/**
 * Le mot du jour, réduit à une bande.
 *
 * Il garde sa couleur (c'est à ça qu'on le reconnaît) mais tient sur une ligne,
 * et dit d'un coup d'œil la seule chose qui change : est-ce que je l'ai fait
 * aujourd'hui ?
 */
export function MotStrip({ mot }) {
  const done = !!(mot?.solved || mot?.gaveUp);
  return (
    <Link to="/mot" className="mh-mot clickable">
      <span className="mh-mot-ic">{done ? <Check size={19} /> : <Sparkles size={19} />}</span>
      <span className="mh-mot-body">
        <span className="mh-mot-kicker">Le mot du jour</span>
        <span className="mh-mot-title">
          {done ? `C'était « ${mot.word} »` : "Trouve le jeu du jour"}
        </span>
      </span>
      {/* La traîne ne dit que ce qui a CHANGÉ aujourd'hui (essais, score) : pas
          encore joué, il n'y a rien à ajouter au titre. */}
      {(done || mot?.tries > 0) && (
        <span className="mh-mot-tail">
          {done
            ? `${mot.tries} essai${mot.tries > 1 ? "s" : ""} · ${mot.score} pts`
            : `${mot.tries} essai${mot.tries > 1 ? "s" : ""}`}
        </span>
      )}
    </Link>
  );
}

/**
 * « Bon, je joue à quoi ? »
 *
 * La question qui fait rester dix minutes devant sa console sans rien lancer.
 * Le site connaît déjà la réponse : il a la liste d'envies, les jeux en pause,
 * ceux qui dorment. Il n'en propose donc qu'UN — parce qu'une grille de vingt
 * jeux, c'est exactement le problème qu'on essaie de résoudre — avec la raison
 * pour laquelle c'est celui-là, et un dé pour dire « non, autre chose ».
 *
 * « Je m'y mets » passe le jeu EN COURS : il remonte alors tout en haut de
 * l'accueil, là où on le retrouvera demain. C'est ce lien-là qui fait que la
 * page n'est pas une vitrine mais un outil.
 */
export function TonightCard({ entry, busy, onStart, onReroll }) {
  return (
    <div className="mh-tonight">
      <Link to={`/game/${entry.gameId}`} className="mh-tonight-art clickable">
        {entry.cover ? (
          <img src={entry.cover} alt="" loading="lazy" draggable="false" />
        ) : (
          <span className="mh-tile-ph">
            <Gamepad2 size={24} />
          </span>
        )}
      </Link>
      <div className="mh-tonight-body">
        <span className="mh-tonight-reason">{pickReason(entry)}</span>
        <Link to={`/game/${entry.gameId}`} className="mh-tonight-name clickable">
          {entry.name}
        </Link>
        <div className="mh-tonight-actions">
          <button className="mh-pill gold solid clickable" onClick={onStart} disabled={busy}>
            {busy ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <>
                <Play size={13} fill="currentColor" strokeWidth={0} /> Je m'y mets
              </>
            )}
          </button>
          <button
            className="mh-tonight-dice clickable"
            onClick={onReroll}
            title="Une autre proposition"
            aria-label="Une autre proposition"
          >
            <Dices size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
