import { useState } from "react";

// Une gerbe d'éclats qui part du centre de son parent (qui doit être
// positionné). Purement décorative : elle ne se rejoue qu'en la remontant —
// on lui passe donc une `key` qui change à chaque déclenchement.
//
// ⚠️ LES TIRAGES SE FONT UNE FOIS, AU MONTAGE. Recalculés à chaque rendu, les
// éclats changeraient de trajectoire en plein vol dès que le parent re-rend
// (une frappe dans un autre champ suffit).
export default function Burst({ colors = ["#f2b70b", "#ffffff"], count = 16, spread = 46 }) {
  const [parts] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      a: (i / count) * 360 + (Math.random() * 24 - 12),
      d: spread * (0.55 + Math.random() * 0.6),
      s: 3 + Math.random() * 3.5,
      c: colors[i % colors.length],
      delay: Math.round(Math.random() * 70),
      star: i % 3 === 0,
    }))
  );

  return (
    <span className="burst" aria-hidden="true">
      {parts.map((p, i) => (
        <i
          key={i}
          className={p.star ? "star" : ""}
          style={{
            "--a": `${p.a}deg`,
            "--d": `${p.d}px`,
            "--s": `${p.s}px`,
            "--c": p.c,
            animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </span>
  );
}
