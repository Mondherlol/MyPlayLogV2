import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Heart,
  ImageDown,
  Lock,
  PenLine,
  Sparkles,
  Trash2,
} from "lucide-react";

import NineModal from "../components/NineModal";
import NinePhrase, { useNineFonts } from "../components/NinePhrase";
import NineRail from "../components/home/NineRail";
import ListComments from "../components/ListComments";
import ListExportModal from "../components/ListExportModal";
import { apiFetch } from "../lib/api";
import { apiCached } from "../lib/query";
import { NINE_CUSTOM, NINE_MAX, nineTheme } from "../lib/nines";

// ======================================================================
//  La page d'une liste des 9
// ======================================================================
// Une liste des 9 n'est pas une liste comme les autres, et sa page ne doit
// pas en avoir l'air : pas de barre d'outils, pas de vue en lignes, pas de
// réordonnancement. Une affiche.
//
//   • la phrase du thème en grand, sa police et sa couleur — et son 9 en
//     autocollant doré géant, qui flotte ;
//   • la grille : TROIS PAR LIGNE, neuf cases — c'est le principe même, une
//     grille qui se remplit exactement ;
//   • « Fais la tienne » (ou « Voir la mienne ») : on vient ici pour se
//     demander ce qu'on aurait mis ;
//   • ce que les autres ont répondu au même thème, puis d'autres thèmes.
//
// Le propriétaire retouche ses 9 dans la même fenêtre que celle de la
// création (cf. components/NineModal).

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";

const gameIdOf = (it) => it.gameId ?? it.refId;

/** Une réponse d'un autre joueur au même thème : sa grille en miniature. */
function OtherNine({ l }) {
  const faces = l.preview || [];
  return (
    <Link to={`/lists/${l.id}`} className="nd-other clickable">
      <span className="nd-other-grid">
        {Array.from({ length: 9 }, (_, i) =>
          faces[i] ? <img key={i} src={faces[i]} alt="" loading="lazy" /> : <span key={i} />
        )}
      </span>
      <span className="nd-other-by">
        {l.author?.avatar ? (
          <img src={l.author.avatar} alt="" />
        ) : (
          <span className="nd-other-letter">{(l.author?.username || "?")[0].toUpperCase()}</span>
        )}
        <span className="nd-other-name">{l.author?.username}</span>
        {l.likeCount > 0 && (
          <span className="nd-other-likes">
            <Heart size={11} /> {l.likeCount}
          </span>
        )}
      </span>
    </Link>
  );
}

export default function NineDetail({ list, items, token, onLike, onDelete, onChanged }) {
  const navigate = useNavigate();
  const fontsReady = useNineFonts();
  const meta = nineTheme(list.nine);
  const custom = list.nine === NINE_CUSTOM;
  const { Icon, color } = meta;

  const [themes, setThemes] = useState({});
  const [others, setOthers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [making, setMaking] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Ma propre réponse à ce thème, s'il y en a une : le bouton devient
  // « Voir la mienne » au lieu d'en faire une seconde.
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    apiCached("/lists/nines", { token, maxAge: 5 * 60000 })
      .then((d) => alive && setThemes(d?.themes || {}))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  // Les autres réponses au même thème.
  useEffect(() => {
    let alive = true;
    apiFetch(`/lists?nine=${encodeURIComponent(list.nine)}&limit=30`, { token })
      .then((d) => alive && setOthers((d.lists || []).filter((l) => String(l.id) !== String(list.id))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [list.nine, list.id, token]);

  const myNine = !custom ? themes[list.nine]?.mine : null;
  const cells = items.slice(0, NINE_MAX);

  return (
    <div className="nd-page" style={{ "--nc": color }}>
      <div className="nd-top">
        <button className="nd-back clickable" onClick={() => navigate(-1)}>
          <ArrowLeft size={17} /> Retour
        </button>
        <div className="nd-tools">
          <button className="nd-tool clickable" onClick={() => setExporting(true)} title="Exporter en image">
            <ImageDown size={16} />
          </button>
          {list.mine && (
            <>
              <span className="nd-vis" title={list.visibility === "private" ? "Privée" : "Publique"}>
                {list.visibility === "private" ? <Lock size={14} /> : <Globe size={14} />}
              </span>
              <button className="nd-tool danger clickable" onClick={onDelete} title="Supprimer">
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="nd-layout">
        {/* --- L'affiche : la phrase, l'auteur, les boutons --------------- */}
        <header className="nd-hero">
          <span className="nd-hero-ic" aria-hidden="true">
            <Icon size={18} strokeWidth={2.4} />
          </span>

          <h1 className="nd-title">
            <NinePhrase themeKey={list.nine} title={list.title} inner={352} scale={1.7} ready={fontsReady} big />
          </h1>

          {!!list.description && <p className="nd-desc">{list.description}</p>}

          <div className="nd-by">
            <Link to={`/u/${list.author?.username}`} className="nd-author clickable">
              {list.author?.avatar ? (
                <img src={list.author.avatar} alt="" />
              ) : (
                <span className="nd-author-letter">{(list.author?.username || "?")[0].toUpperCase()}</span>
              )}
              <span>{list.author?.username}</span>
            </Link>
            <span className="nd-date">{fmtDate(list.createdAt || list.updatedAt)}</span>
          </div>

          <div className="nd-actions">
            {list.mine ? (
              <button className="btn btn-primary nd-cta clickable" onClick={() => setEditing(true)}>
                <PenLine size={17} /> Modifier mes 9
              </button>
            ) : myNine ? (
              <Link to={`/lists/${myNine.id}`} className="btn btn-primary nd-cta clickable">
                Voir la mienne <ArrowRight size={17} />
              </Link>
            ) : (
              token && (
                <button className="btn btn-primary nd-cta clickable" onClick={() => setMaking(true)}>
                  <Sparkles size={17} /> Fais la tienne
                </button>
              )
            )}
            {token && (
              <button
                className={`nd-like clickable ${list.liked ? "on" : ""}`}
                onClick={onLike}
                aria-pressed={!!list.liked}
                title={list.liked ? "Je n'aime plus" : "J'aime"}
              >
                <Heart size={17} fill={list.liked ? "currentColor" : "none"} />
                {list.likeCount > 0 && <span>{list.likeCount}</span>}
              </button>
            )}
          </div>
        </header>

        {/* --- La grille : trois par ligne, neuf cases -------------------- */}
        <ol className="nd-grid">
          {Array.from({ length: NINE_MAX }, (_, i) => {
            const it = cells[i];
            if (!it) {
              return (
                <li key={`e${i}`} className="nd-cell empty">
                  <span className="nd-cell-art">
                    <span className="nd-cell-empty">{i + 1}</span>
                  </span>
                </li>
              );
            }
            const gid = gameIdOf(it);
            const body = (
              <>
                <span className="nd-cell-art">
                  {it.image ? <img src={it.image} alt="" loading="lazy" /> : <span className="nd-cell-noart">{it.name}</span>}
                  <span className="nd-cell-num">{i + 1}</span>
                </span>
                <span className="nd-cell-name" title={it.name}>{it.name}</span>
              </>
            );
            return (
              <li key={it._id || it.key || i} className="nd-cell" style={{ animationDelay: `${i * 45}ms` }}>
                {gid ? (
                  <Link to={`/game/${gid}`} className="nd-cell-link clickable">
                    {body}
                  </Link>
                ) : (
                  <span className="nd-cell-link">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* --- Ce que les autres ont répondu -------------------------------- */}
      {others.length > 0 && (
        <section className="nd-others">
          <div className="mh-head">
            <div className="mh-head-main">
              <span className="mh-head-text">
                <span className="mh-kicker">{custom ? "D'autres thèmes inventés" : "Les autres ont répondu"}</span>
                <span className="mh-head-title">
                  {custom ? "Leurs 9 jeux à eux" : `Leurs 9 jeux ${meta.short}`}
                </span>
              </span>
            </div>
          </div>
          <div className="nd-others-row">
            {others.map((l) => (
              <OtherNine key={l.id} l={l} />
            ))}
          </div>
        </section>
      )}

      {/* --- D'autres thèmes à faire -------------------------------------- */}
      {token && (
        <div className="nd-more">
          <NineRail
            token={token}
            kicker="Le principe des 9"
            title="D'autres thèmes à faire"
            exclude={custom ? null : list.nine}
          />
        </div>
      )}

      <ListComments listId={list.id} list={list} token={token} />

      {editing && (
        <NineModal
          themeKey={list.nine}
          list={{ ...list, items }}
          onClose={() => setEditing(false)}
          onPublished={(updated) => {
            setEditing(false);
            if (updated) onChanged(updated);
          }}
        />
      )}
      {making && (
        <NineModal
          themeKey={list.nine}
          onClose={() => setMaking(false)}
          onPublished={(created) => {
            setMaking(false);
            navigate(`/lists/${created.id}`);
          }}
        />
      )}
      {exporting && (
        <ListExportModal list={list} items={items} tiers={[]} token={token} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}
