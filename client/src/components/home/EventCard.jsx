import { Link } from "react-router-dom";
import { Bell, BellRing, Radio, Tv } from "lucide-react";
import {
  brandTheme,
  countdown,
  durationLabel,
  localTime,
  preciseCountdown,
  shortWhen,
} from "../../lib/homeEvents";

/**
 * Un rendez-vous à venir : Direct, State of Play, showcase.
 *
 * ⚠️ LE TEXTE EST SOUS L'IMAGE, PAS DESSUS. Une affiche de Direct PORTE DÉJÀ DU
 * TEXTE — c'est même à peu près tout ce qu'elle contient : le logo, le nom, la
 * date. Deux textes superposés, l'un net et l'autre à travers un voile, ça ne
 * se lit ni l'un ni l'autre, et ça abîme une image que quelqu'un a composée
 * pour être vue entière.
 *
 * Le bouton du bas fait deux choses selon l'état : il propose de suivre, puis
 * il DEVIENT le compte à rebours. Cocher « ça m'intéresse » n'a pas besoin
 * d'une confirmation écrite — la cloche qui s'allume et le décompte qui démarre
 * disent la même chose, en plus utile.
 */
export default function EventCard({ event, now, onToggleInterest }) {
  const theme = brandTheme(event.brand);
  const { big, live, over } = countdown(event, now || Date.now());

  const time = localTime(event.startsAt, event.precision);
  const duration = durationLabel(event.durationMin);
  const when = [shortWhen(event.startsAt), time].filter(Boolean).join(" · ");

  const ticker = event.interested
    ? preciseCountdown(event.startsAt, event.precision, now || Date.now())
    : null;

  // ⚠️ LA CARTE MÈNE À LA FICHE, PAS À LA DIFFUSION. Elle ouvrait le lien du
  // live dans un onglet : on quittait le site pour une page YouTube qui, trois
  // jours avant l'émission, ne montre qu'un compte à rebours. La fiche, elle, a
  // le compte à rebours ET tout ce qu'on ne peut pas mettre sur une carte : la
  // description, les grilles de bingo, ce qui avait été annoncé la dernière
  // fois. Le lien du live y est, à un clic.
  return (
    <article className="mh-ev">
      <Link
        className="mh-ev-art clickable"
        to={`/event/${event.id}`}
        title={event.name}
      >
        {event.image ? (
          <img src={event.image} alt="" loading="lazy" draggable="false" />
        ) : (
          // Le repli : le logo de la marque, entier et centré, sur son dégradé.
          // C'est le seul cas où l'on dessine soi-même le cadre, donc le seul
          // où l'on a le droit d'y poser quelque chose.
          <span
            className="mh-ev-fallback"
            style={{ background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}
          >
            {event.logo ? (
              <img className="mh-ev-logo" src={event.logo} alt="" loading="lazy" />
            ) : (
              <Tv size={44} />
            )}
          </span>
        )}
        <span className="mh-ev-go">{live ? "Regarder" : "Voir la fiche"}</span>
      </Link>

      <div className="mh-ev-body">
        <div className="mh-ev-when">
          {/* ⚠️ TROIS ÉTATS, PAS DEUX. Doré plein quand ça se passe MAINTENANT,
              doré léger pour un décompte, et gris éteint quand c'est fini : une
              émission terminée n'a plus rien à réclamer de l'œil, mais elle
              reste là — c'est justement l'heure où l'on vient voir ce qui a été
              annoncé. */}
          <span className={`mh-ev-chip ${live ? "live" : ""} ${over ? "over" : ""}`}>
            {live && <Radio size={11} />} {big}
          </span>
          <span className="mh-ev-date">{when}</span>
        </div>

        <h3 className="mh-ev-name">{event.name}</h3>

        <div className="mh-ev-meta">
          {!!event.location && <span>{event.location}</span>}
          {!!duration && <span>{duration}</span>}
        </div>

        <button
          className={`mh-ev-bell clickable ${event.interested ? "on" : ""}`}
          onClick={() => onToggleInterest?.(!event.interested)}
          aria-pressed={!!event.interested}
        >
          {event.interested ? <BellRing size={14} /> : <Bell size={14} />}
          <span className={ticker ? "tick" : ""}>
            {ticker || (event.interested ? "J'y serai" : "Ça m'intéresse")}
          </span>
        </button>
      </div>
    </article>
  );
}
