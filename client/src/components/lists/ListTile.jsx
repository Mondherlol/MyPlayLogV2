import { Link } from "react-router-dom";
import { BadgeCheck, Heart, IdCard, Lock, Play, Trash2 } from "lucide-react";
import { typeMeta } from "../../lib/lists";
import { boardOf } from "../../lib/boards";
import { NINE_CUSTOM } from "../../lib/nines";
import { splitTopTitle, topTheme } from "../../lib/topThemes";
import NinePhrase, { useNineFonts } from "../NinePhrase";

// ======================================================================
//  La carte de liste de la page Listes : l'image d'abord
// ======================================================================
// L'image porte la carte ; le titre et l'auteur sont posés dessus. Chaque
// sorte de liste a son visuel, pour qu'on la reconnaisse avant de lire :
//
//   · liste simple ou classée → les jaquettes coupées en biais, séparées d'un
//     filet doré (la carte « étagère » de l'app, components/ListShelfCard) ;
//   · tier list → ses premiers paliers ;
//   · liste des 9 → l'affiche du thème : « Ces 9 jeux… » dans sa police ;
//   · carte de joueur → une carte d'identité : l'auteur, et sa grille 5 × 4 ;
//   · top officiel → une affiche : un aplat de couleur, « TOP 100 » en grand,
//     la console ou le héros de la saga détouré à droite (cf. lib/topThemes) ;
//   · conférence ou palmarès → son affiche entière, le titre SOUS l'image.

// Le cadre des tranches, en unités SVG. ⚠️ PLUS LE 4:3 DE .lt-media : les
// tranches s'arrêtent maintenant au ras du bandeau du titre au lieu de passer
// dessous (les jaquettes y perdaient leur bas, logos compris). La zone qui
// reste est à peu près deux fois plus large que haute ; le SVG la remplit
// (`slice`) quelle que soit la hauteur du titre, sur une ou deux lignes.
const W = 400;
const H = 200;
// De combien la coupe se décale entre le haut et le bas (fraction de H), et
// l'épaisseur du filet doré — les valeurs de l'app.
const LEAN = 0.32;
const GAP = 6;

/** Les images coupées en oblique ; le fond doré fait le filet. */
function Slices({ id, images }) {
  const n = images.length;
  if (n === 1) return <img className="lt-cover" src={images[0]} alt="" loading="lazy" draggable="false" />;

  const slice = W / n;
  const lean = H * LEAN;
  const shape = (i) => {
    const l = i * slice + GAP / 2;
    const r = (i + 1) * slice - GAP / 2;
    const left = i === 0 ? [-lean, -lean] : [l + lean / 2, l - lean / 2];
    const right = i === n - 1 ? [W + lean, W + lean] : [r + lean / 2, r - lean / 2];
    return `${left[0]},0 ${right[0]},0 ${right[1]},${H} ${left[1]},${H}`;
  };
  // Chaque image couvre exactement sa tranche, pas plus : plus large, elle
  // serait agrandie, donc rognée en haut et en bas.
  const box = (i) => {
    const x0 = i === 0 ? 0 : i * slice + GAP / 2 - lean / 2;
    const x1 = i === n - 1 ? W : (i + 1) * slice - GAP / 2 + lean / 2;
    return { x: x0, w: x1 - x0 };
  };

  return (
    <svg
      className="lt-slices"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width={W} height={H} fill="#f2b70b" />
      <defs>
        {images.map((_, i) => (
          <clipPath key={i} id={`lt-${id}-${i}`}>
            <polygon points={shape(i)} />
          </clipPath>
        ))}
      </defs>
      {images.map((src, i) => (
        <image
          key={i}
          href={src}
          x={box(i).x}
          y={0}
          width={box(i).w}
          height={H}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#lt-${id}-${i})`}
        />
      ))}
    </svg>
  );
}

/** Les premiers paliers d'une tier list. */
function Tiers({ tiers }) {
  return (
    <span className="lt-tiers">
      {tiers.map((t, r) => (
        <span className="ltp-row" key={r}>
          <span className="ltp-label" style={{ "--tier": t.color }}>
            {t.label}
          </span>
          <span className="ltp-cells">
            {t.images.slice(0, 6).map((src, i) => (
              <span className="ltp-cell" key={i}>
                <img src={src} alt="" loading="lazy" draggable="false" />
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/** L'affiche d'une liste des 9 : ses jaquettes en fond, la phrase du thème. */
function NinePoster({ list }) {
  const ready = useNineFonts();
  const imgs = (list.preview || []).filter(Boolean);
  return (
    <span className="lt-nine">
      {imgs.length > 0 && (
        <span className="lt-nine-mosaic" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <img key={i} src={imgs[i % imgs.length]} alt="" loading="lazy" draggable="false" />
          ))}
        </span>
      )}
      <span className="lt-nine-mark" aria-hidden="true">
        9
      </span>
      <NinePhrase
        themeKey={list.nine}
        title={list.nine === NINE_CUSTOM ? list.title : undefined}
        inner={200}
        scale={0.9}
        ready={ready}
      />
    </span>
  );
}

/**
 * L'affiche d'un top officiel.
 *
 * ⚠️ PAS DE BANDEAU NOIR. Les listes de joueurs posent leur titre sur un aplat
 * sombre ; un top officiel est une vitrine de la maison, il a sa couleur et son
 * visuel, et c'est ce qui le fait repérer dans un rail de listes.
 *
 * Le fond garde sa couleur unique, mais il n'est plus nu : un semis de points
 * blancs, et les jaquettes du top en mosaïque penchée, fondues dans la couleur
 * — on devine les jeux sans qu'ils mangent l'aplat.
 */
function TopPoster({ list }) {
  const ready = useNineFonts();
  // Une image choisie par un admin (page de la liste) passe devant le visuel
  // par défaut : c'est elle qu'on voulait voir.
  const theme = topTheme(list.official?.key);
  const color = theme.color;
  const art = list.cover || theme.art;
  const { n, subject } = splitTopTitle(list.title, list.itemCount);
  const imgs = (list.preview || []).filter(Boolean);
  // Sans visuel, les trois premières jaquettes font l'éventail à droite.
  const fan = art ? [] : imgs.slice(0, 3);
  // La mosaïque du fond : 18 cases, on reboucle sur ce qu'on a.
  const mosaic = imgs.length ? Array.from({ length: 18 }, (_, i) => imgs[i % imgs.length]) : [];
  return (
    <span className={`lt-top ${ready ? "fonts-ready" : ""}`} style={{ "--tc": color }}>
      {mosaic.length > 0 && (
        <span className="lt-top-mosaic" aria-hidden="true">
          {mosaic.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" draggable="false" />
          ))}
        </span>
      )}
      <span className="lt-top-dots" aria-hidden="true" />
      {art ? (
        <img className="lt-top-art" src={art} alt="" loading="lazy" draggable="false" />
      ) : (
        fan.length > 0 && (
          <span className="lt-top-fan" aria-hidden="true">
            {fan.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" draggable="false" style={{ "--i": i }} />
            ))}
          </span>
        )
      )}
      <span className="lt-top-text">
        {n != null && (
          <span className="lt-top-num">
            Top <b>{n}</b>
          </span>
        )}
        <span className="lt-top-subject">{subject}</span>
        <span className="lt-top-by">
          MyPlayLog <BadgeCheck size={12} aria-label="Compte officiel" />
          {list.likeCount > 0 && (
            <span className={`lt-likes ${list.liked ? "on" : ""}`}>
              <Heart size={12} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

/** Une carte de joueur : l'auteur à gauche, sa grille à droite. */
function BoardId({ list }) {
  const board = boardOf(list.board);
  const by = Object.fromEntries((list.boardItems || []).map((it) => [it.slot, it]));
  const a = list.author;
  return (
    <span className="lt-board">
      <span className="lt-board-who">
        <IdCard size={16} className="lt-board-ic" />
        <span className="lt-board-pp">
          {a?.avatar ? (
            <img src={a.avatar} alt="" loading="lazy" draggable="false" />
          ) : (
            a?.username?.[0]?.toUpperCase() || "?"
          )}
        </span>
        <span className="lt-board-name">{a?.username || "—"}</span>
        {list.likeCount > 0 && (
          <span className={`lt-likes ${list.liked ? "on" : ""}`}>
            <Heart size={12} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
          </span>
        )}
      </span>
      <span className="lt-board-grid" aria-hidden="true">
        {board.slots.map((s) =>
          by[s.key]?.image ? (
            <img key={s.key} src={by[s.key].image} alt="" loading="lazy" draggable="false" />
          ) : (
            <span key={s.key} />
          )
        )}
      </span>
    </span>
  );
}

export default function ListTile({ list, onDelete }) {
  const meta = typeMeta(list.type);
  const author = list.author;
  const byline = (
    <span className="lt-meta">
      <span className="lt-pp" aria-hidden="true">
        {author?.avatar ? (
          <img src={author.avatar} alt="" loading="lazy" draggable="false" />
        ) : (
          author?.username?.[0]?.toUpperCase() || "?"
        )}
      </span>
      <span className="lt-author">{author?.username || "—"}</span>
      {author?.isSystem && <BadgeCheck size={12} className="lt-check" aria-label="Compte officiel" />}
      {list.likeCount > 0 && (
        <span className={`lt-likes ${list.liked ? "on" : ""}`}>
          <Heart size={12} fill={list.liked ? "currentColor" : "none"} /> {list.likeCount}
        </span>
      )}
    </span>
  );

  const kind = list.board
    ? "board"
    : list.official?.kind === "top"
      ? "top"
      : list.event && list.cover
        ? "event"
      : list.nine
      ? "nine"
      : !list.cover && list.type === "tier" && list.tierPreview?.length
        ? "tier"
        : "slices";
  // Une liste officielle garde son affiche entière ; les autres mettent la
  // couverture de l'auteur en tête des tranches.
  const images =
    kind !== "slices"
      ? []
      : list.cover && list.official
        ? [list.cover]
        : [...(list.cover ? [list.cover] : []), ...(list.preview || [])].slice(0, 3);

  return (
    <Link
      to={`/lists/${list.id}`}
      className={`lt is-${kind} clickable`}
      style={kind === "top" ? { "--tc": topTheme(list.official?.key).color } : undefined}
    >
      <span className="lt-media">
        {kind === "board" ? (
          <BoardId list={list} />
        ) : kind === "top" ? (
          <TopPoster list={list} />
        ) : kind === "event" ? (
          <img className="lt-cover" src={list.cover} alt="" loading="lazy" draggable="false" />
        ) : kind === "nine" ? (
          <NinePoster list={list} />
        ) : kind === "tier" ? (
          <Tiers tiers={list.tierPreview.slice(0, 4)} />
        ) : images.length ? (
          <Slices id={list.id} images={images} />
        ) : (
          <span className="lt-empty">
            <meta.Icon size={28} />
          </span>
        )}

        {kind === "slices" && list.type === "ranked" && (
          <span className="lt-type" title={meta.long}>
            <meta.Icon size={13} />
          </span>
        )}
        <span className="lt-badges">
          {list.mine && onDelete && (
            <button
              type="button"
              className="lt-pill lt-del clickable"
              title="Supprimer la liste"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(list);
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
          {list.event?.videoId && (
            <span className="lt-pill" title="Rediffusion disponible">
              <Play size={11} fill="currentColor" strokeWidth={0} />
            </span>
          )}
          {list.visibility === "private" && (
            <span className="lt-pill" title="Privée">
              <Lock size={11} />
            </span>
          )}
          {kind !== "board" && kind !== "nine" && kind !== "top" && (
            <span className="lt-pill">{list.itemCount}</span>
          )}
        </span>

        {/* Le nom de la liste, sous l'image. La carte de joueur n'en a pas
            besoin (c'est l'auteur qui la nomme), ni l'affiche des 9 (la phrase
            du thème EST son titre), ni un top officiel (son affiche le dit). */}
        {kind !== "board" && kind !== "top" && kind !== "event" && (
          <span className="lt-caption">
            {kind !== "nine" && <span className="lt-title">{list.title}</span>}
            {byline}
          </span>
        )}
      </span>

      {/* Conférence ou palmarès : l'affiche a déjà son logo et ses titres,
          on n'écrit rien PAR-DESSUS — le nom de la liste passe dessous. */}
      {kind === "event" && (
        <span className="lt-under">
          <span className="lt-title">{list.title}</span>
          {byline}
        </span>
      )}
    </Link>
  );
}
