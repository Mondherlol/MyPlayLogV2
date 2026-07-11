import { Lock } from "lucide-react";
import { typeMeta } from "../lib/lists";

// Pseudo + photo de profil de l'auteur (pastille ronde, initiale en repli).
export function Author({ author }) {
  if (!author) return <span className="list-card-author">—</span>;
  return (
    <span className="list-card-author">
      <span className="list-author-pp" aria-hidden="true">
        {author.avatar ? (
          <img src={author.avatar} alt="" loading="lazy" draggable="false" />
        ) : (
          author.username?.[0]?.toUpperCase() || "?"
        )}
      </span>
      {author.username}
    </span>
  );
}

// Montage d'aperçu d'une carte de liste. Le rendu change selon le type :
//  · classic → covers empilées en éventail
//  · ranked  → mini-podium (top 3, or/argent/bronze)
//  · tier    → mini-aperçu de la grille (paliers colorés + vignettes)
// `overlayTag` (défaut true) pose le tag de type + le cadenas privé sur l'image ;
// on le désactive quand la carte affiche déjà ces infos ailleurs (ex. profil).
export function Preview({ list, overlayTag = true }) {
  const meta = typeMeta(list.type);
  const images = list.preview;
  const overlay = overlayTag ? (
    <>
      <span className={`list-tag t-${list.type}`}>
        <meta.Icon size={12} /> {meta.label}
      </span>
      {list.visibility === "private" && (
        <span className="list-tag-priv" title="Privée">
          <Lock size={12} />
        </span>
      )}
    </>
  ) : null;

  // Couverture personnalisée : prioritaire sur le montage d'items.
  if (list.cover) {
    return (
      <div className="list-preview has-cover">
        {overlay}
        <img className="list-preview-img" src={list.cover} alt="" loading="lazy" draggable="false" />
      </div>
    );
  }

  // Tier list : aperçu de la grille (quelques paliers, vignettes zoomées).
  if (list.type === "tier" && list.tierPreview?.length) {
    return (
      <div className="list-preview tier">
        {overlay}
        <div className="ltp-grid">
          {list.tierPreview.slice(0, 4).map((t, r) => (
            <div className="ltp-row" key={r}>
              <span className="ltp-label" style={{ "--tier": t.color }}>
                {t.label}
              </span>
              <span className="ltp-cells">
                {t.images.slice(0, 5).map((src, i) => (
                  <span className="ltp-cell" key={i}>
                    <img src={src} alt="" loading="lazy" draggable="false" />
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!images || images.length === 0) {
    return (
      <div className="list-preview empty">
        {overlay}
        <meta.Icon size={30} />
      </div>
    );
  }

  // Liste classée : un éventail avec le #1 toujours au centre, les autres
  // alternant gauche/droite. Le podium (top 3) est flouté avec un « ? » — on
  // ne spoile pas les gagnants — et chaque carte porte son rang (à gauche pour
  // les cartes de gauche, à droite pour celles de droite).
  if (list.type === "ranked") {
    const total = list.itemCount || images.length;
    const shown = Math.min(total, 8);
    const cards = [];
    for (let r = 1; r <= shown; r++) {
      const hidden = r <= 3; // podium masqué (flou + « ? »)
      const img = images[r - 1] || null;
      if (!hidden && !img) continue; // pas de jaquette connue pour ce rang
      // Position latérale : #1 au centre (slot 0), puis alternance G/D.
      const slot = r === 1 ? 0 : r % 2 === 0 ? -(r / 2) : (r - 1) / 2;
      cards.push({ r, hidden, img, slot });
    }
    // Rendu du fond vers l'avant (les cartes centrales passent devant).
    cards.sort((a, b) => Math.abs(b.slot) - Math.abs(a.slot));
    const extra = total - cards.length;
    return (
      <div className="list-preview ranked">
        {overlay}
        <div className="rk-fan">
          {cards.map((c) => {
            const a = Math.abs(c.slot);
            const side = c.slot < 0 ? "left" : c.slot > 0 ? "right" : "center";
            const style = {
              "--x": `${c.slot * 44}%`,
              "--rot": `${c.slot * 5}deg`,
              "--y": `${a * 5}px`,
              "--sc": 1 - a * 0.05,
              zIndex: 20 - Math.round(a * 2),
            };
            return (
              <span
                className={`rk-card ${c.hidden ? "hidden" : ""} ${c.r === 1 ? "first" : ""}`}
                key={c.r}
                style={style}
              >
                {c.img && <img src={c.img} alt="" loading="lazy" draggable="false" />}
                {c.hidden && <span className="rk-q">?</span>}
                <span className={`rk-no rk-no-${side} ${c.r <= 3 ? `p-${c.r}` : ""}`}>
                  {c.r}
                </span>
              </span>
            );
          })}
        </div>
        {extra > 0 && <span className="rk-more">+{extra}</span>}
      </div>
    );
  }

  return (
    <div className="list-preview">
      {overlay}
      {images.slice(0, 5).map((src, i) => (
        <span className="list-preview-cover" key={i} style={{ "--i": i }}>
          <img src={src} alt="" loading="lazy" draggable="false" />
        </span>
      ))}
    </div>
  );
}
