import { Link } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Dices,
  Gamepad2,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { Rail } from "./Rail";
import { STATUS_LABEL, STATUS_TINT, pickReason } from "../../lib/home";

// ======================================================================
//  Les bandes : la semaine, le mot du jour, la proposition du soir
// ======================================================================
// Trois blocs pleine largeur, posés entre les rails. Ils se lisent en une
// seconde et ne réclament pas de titre à deux étages.

/**
 * « Cette semaine ».
 *
 * Posé JUSTE SOUS les parties en cours, et pas en tête de page : c'est un
 * regard en arrière, il vient après ce qu'on est en train de faire.
 *
 * ⚠️ L'EN-TÊTE EST UN LIEN, PAS UN TITRE. Un résumé doit ouvrir ce qu'il
 * résume : « 2 terminés · 7 jeux » appelle la question « lesquels, et quand ? »,
 * à laquelle le journal personnel répond déjà.
 */
export function WeekStrip({ recap }) {
  if (!recap) return null;
  return (
    <section className="mh-week">
      <Link to="/activity?t=mine" className="mh-week-head clickable">
        <span className="mh-week-dot" />
        <span className="mh-kicker">Cette semaine</span>
        <span className="mh-week-sum">{recap.summary}</span>
        <ChevronRight size={15} />
      </Link>

      <Rail snap={false} className="tight">
        {recap.games.map((e) => (
          <Link
            key={e.gameId}
            to={`/game/${e.gameId}`}
            className="mh-week-tile clickable"
            title={`${e.name} — ${STATUS_LABEL[e.status] || ""}`}
            style={{ "--tint": STATUS_TINT[e.status] || "var(--border-strong)" }}
          >
            {e.cover ? (
              <img src={e.cover} alt="" loading="lazy" draggable="false" />
            ) : (
              <span className="mh-week-blank">{e.name}</span>
            )}
          </Link>
        ))}
      </Rail>
    </section>
  );
}

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
      <span className="mh-mot-tail">
        {done
          ? `${mot.tries} essai${mot.tries > 1 ? "s" : ""} · ${mot.score} pts`
          : mot?.tries
            ? `${mot.tries} essai${mot.tries > 1 ? "s" : ""}`
            : "2 minutes, une fois par jour"}
      </span>
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
