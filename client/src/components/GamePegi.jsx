import { PEGI_AGE_COLOR, PEGI_ICONS, PEGI_LABEL } from "../lib/pegi";

// La classification PEGI d'un jeu, comme au dos de la boîte : la pastille
// d'âge, puis un picto par contenu signalé. Une seule rangée, compacte ; le
// nom de chaque picto s'affiche au survol (et reste lisible par un lecteur
// d'écran).

const COLOR = { w: "#fff", k: "#000" };

function Shape({ el }) {
  const common = {
    fill: el.f ? COLOR[el.f] : "none",
    stroke: el.s ? COLOR[el.s] : undefined,
    strokeWidth: el.s ? el.sw : undefined,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    transform: el.g ? `rotate(${el.g} 16 16)` : undefined,
  };
  switch (el.t) {
    case "rect":
      return <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={el.rx} {...common} />;
    case "circle":
      return <circle cx={el.cx} cy={el.cy} r={el.r} {...common} />;
    case "ellipse":
      return <ellipse cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...common} />;
    case "text":
      return (
        <text
          x={el.x}
          y={el.y}
          fontSize={el.size}
          fontWeight="900"
          fontFamily="Arial, Helvetica, sans-serif"
          textAnchor="middle"
          fill={COLOR[el.f]}
        >
          {el.text}
        </text>
      );
    default:
      return <path d={el.d} {...common} />;
  }
}

export function PegiDescriptor({ kind }) {
  const shapes = PEGI_ICONS[kind];
  if (!shapes) return null;
  const label = PEGI_LABEL[kind];
  return (
    <span className="pegi-tile pegi-desc" title={label}>
      <svg viewBox="0 0 32 32" role="img" aria-label={label}>
        {shapes.map((el, i) => (
          <Shape key={i} el={el} />
        ))}
      </svg>
    </span>
  );
}

export function PegiAge({ age }) {
  return (
    <span
      className="pegi-tile pegi-age"
      style={{ background: PEGI_AGE_COLOR[age] }}
      title={`PEGI ${age}`}
      aria-label={`PEGI ${age}`}
    >
      <b>{age}</b>
      <small>PEGI</small>
    </span>
  );
}

export default function GamePegi({ pegi }) {
  if (!pegi?.age) return null;
  return (
    <div className="pegi-row">
      <PegiAge age={pegi.age} />
      {pegi.descriptors.map((d) => (
        <PegiDescriptor key={d} kind={d} />
      ))}
    </div>
  );
}
