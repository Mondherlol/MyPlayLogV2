import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, X } from "lucide-react";
import twemoji from "@twemoji/api";

import Section from "./Rail";
import NineModal from "../NineModal";
import NinePhrase, { useNineFonts } from "../NinePhrase";
import { apiCached } from "../../lib/query";
import { NINE_CUSTOM, NINE_THEMES, nineTheme } from "../../lib/nines";

// ======================================================================
//  Le principe des 9 — le rail des thèmes
// ======================================================================
// Repris de l'app (myplaylog-mobile/src/components/nine/NineCards.jsx). Une
// carte donne l'idée ; un clic ouvre directement la sélection, et neuf jeux
// plus tard la liste est publiée. Un thème déjà fait mène à SA liste, et passe
// en fin de rail : on vient chercher une idée, pas revoir ce qu'on a publié.
//
// Sert sur l'accueil et en pied de la page d'une liste des 9 (« d'autres
// thèmes »), où `exclude` retire le thème qu'on est en train de lire.

// La largeur utile d'une carte (cf. .nine-card dans app-55-nine.css).
const CARD_INNER = 172 - 2 * 15;

function Avatar({ user }) {
  return user.avatar ? (
    <img src={user.avatar} alt="" loading="lazy" />
  ) : (
    <span className="nine-face-letter">{user.username[0]?.toUpperCase()}</span>
  );
}

/**
 * Les visages des amis qui ont fait le thème. ⚠️ C'EST UN BOUTON : les voir
 * sans pouvoir ouvrir LEURS neuf jeux, c'était toute la frustration du rail.
 */
function Faces({ faces, onOpen }) {
  if (!onOpen) {
    return (
      <span className="nine-faces">
        {faces.map((f) => (
          <Avatar key={f.username} user={f} />
        ))}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="nine-faces clickable"
      title="Voir leurs listes"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {faces.map((f) => (
        <Avatar key={f.username} user={f} />
      ))}
    </button>
  );
}

/** L'emoji du thème, en twemoji : le même dessin sur tous les systèmes. */
function Emoji({ char }) {
  if (!char) return null;
  return (
    <span
      className="nine-card-emoji"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: twemoji.parse(char, { folder: "svg", ext: ".svg" }) }}
    />
  );
}

/** Les listes des amis pour un thème : qui, et ses neuf jaquettes. */
function FriendsModal({ themeKey, friends, onClose }) {
  const { short } = nineTheme(themeKey);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal nine-friends-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">Ces 9 jeux {short}</h2>
        <div className="nine-friends">
          {friends.map((f) => (
            <Link key={f.id} to={`/lists/${f.id}`} className="nine-friend clickable" onClick={onClose}>
              <span className="nine-friend-who">
                <span className="nine-friend-pp">
                  <Avatar user={f} />
                </span>
                <span className="nine-friend-name">{f.username}</span>
                <ArrowRight size={14} className="nine-friend-go" />
              </span>
              <span className="nine-friend-grid" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) =>
                  f.preview?.[i] ? <img key={i} src={f.preview[i]} alt="" loading="lazy" /> : <span key={i} />
                )}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Un thème, en carte, façon affiche : la phrase calée en haut, un grand 9 en
 * filigrane dans le coin, l'icône et le compteur en pied. Quand ta liste est faite, ses neuf jaquettes tapissent le fond, en
 * mosaïque assombrie — la carte devient TA liste, sans qu'on ait à lire le
 * pied pour le savoir.
 */
function NineCard({ themeKey, stats, onOpen, onFriends, fontsReady }) {
  const custom = themeKey === NINE_CUSTOM;
  const { color, short, emoji } = nineTheme(themeKey);
  const mine = !custom && stats?.mine;
  const count = stats?.count || 0;
  const faces = stats?.faces || [];
  const mosaic = (mine?.preview || []).filter(Boolean).slice(0, 9);

  return (
    // ⚠️ UNE `div`, PAS UN `button` : la carte porte le bouton des visages, et
    // un bouton dans un bouton n'est pas du HTML valide (le clic intérieur
    // partait sur la carte).
    <div
      role="button"
      tabIndex={0}
      className={`nine-card clickable ${custom ? "is-custom" : ""} ${mine ? "is-mine" : ""} ${
        mosaic.length ? "has-mosaic" : ""
      }`}
      style={{ "--nc": color }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title={custom ? "Invente ton propre thème" : `Ces 9 jeux ${short}`}
    >
      {mosaic.length > 0 && (
        <span className="nine-card-mosaic" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => {
            // Moins de neuf aperçus : on reboucle plutôt que de laisser des trous.
            const src = mosaic[i % mosaic.length];
            return <img key={i} src={src} alt="" loading="lazy" />;
          })}
        </span>
      )}

      {/* Le 9 en filigrane, coupé par le coin : la signature du principe. */}
      {!mosaic.length && (
        <span className="nine-card-mark" aria-hidden="true">
          9
        </span>
      )}

      <NinePhrase themeKey={themeKey} inner={CARD_INNER} ready={fontsReady} prompt={custom} />

      <Emoji char={emoji} />

      <span className="nine-card-foot">
        {mine ? (
          <span className="nine-card-done">
            <Check size={13} strokeWidth={3} /> Ta liste est faite
          </span>
        ) : custom ? (
          <span className="nine-card-count">Ces 9 jeux qui…</span>
        ) : (
          <>
            {faces.length > 0 && <Faces faces={faces} onOpen={onFriends} />}
            <span className="nine-card-count">
              {count
                ? `${count.toLocaleString("fr-FR")} ${count > 1 ? "l'ont faite" : "l'a faite"}`
                : "Sois le premier"}
            </span>
          </>
        )}
        <span className="nine-card-go" aria-hidden="true">
          <ArrowRight size={14} strokeWidth={2.6} />
        </span>
      </span>
    </div>
  );
}

export default function NineRail({
  token,
  library,
  kicker = "Le principe des 9",
  title = "Et toi, ce serait lesquels ?",
  exclude = null,
}) {
  const navigate = useNavigate();
  const fontsReady = useNineFonts();
  const [themes, setThemes] = useState({});
  const [open, setOpen] = useState(null); // clé du thème en cours de sélection
  const [friendsOf, setFriendsOf] = useState(null); // clé du thème dont on lit les listes d'amis

  useEffect(() => {
    let alive = true;
    apiCached("/lists/nines", { token, maxAge: 5 * 60000 })
      .then((d) => alive && setThemes(d?.themes || {}))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  const keys = NINE_THEMES.map((t) => t.key).filter((k) => k !== exclude);
  const order = [
    ...keys.filter((k) => !themes[k]?.mine),
    NINE_CUSTOM,
    ...keys.filter((k) => themes[k]?.mine),
  ];

  const openTheme = (key) => {
    const mine = key !== NINE_CUSTOM && themes[key]?.mine;
    if (mine) navigate(`/lists/${mine.id}`);
    else setOpen(key);
  };

  return (
    <>
      <Section kicker={kicker} title={title} className="s-nine">
        {order.map((key) => (
          <NineCard
            key={key}
            themeKey={key}
            stats={themes[key]}
            fontsReady={fontsReady}
            onOpen={() => openTheme(key)}
            onFriends={themes[key]?.friends?.length ? () => setFriendsOf(key) : null}
          />
        ))}
      </Section>

      {friendsOf && (
        <FriendsModal
          themeKey={friendsOf}
          friends={themes[friendsOf].friends}
          onClose={() => setFriendsOf(null)}
        />
      )}

      {open && (
        <NineModal
          themeKey={open}
          library={library}
          onClose={() => setOpen(null)}
          onPublished={(list) => {
            setOpen(null);
            navigate(`/lists/${list.id}`);
          }}
        />
      )}
    </>
  );
}
