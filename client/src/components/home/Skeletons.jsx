// ======================================================================
//  Les squelettes de l'accueil
// ======================================================================
// ⚠️ UN SQUELETTE A LA FORME DE CE QU'IL ANNONCE, AU PIXEL. Chacun reprend la
// classe de la vraie carte (`.mh-np`, `.mh-ev`, `.mh-tile`…) : mêmes largeur,
// hauteur, rayon et marges. Quand la donnée arrive, la carte prend exactement
// la place du squelette — rien ne saute sous les yeux.
//
// ⚠️ ET ON NE SQUELETTISE QUE CE QUI DÉPEND DU RÉSEAU. Le salut, les boutons,
// les titres des rayons et les raccourcis (documentaire, pépite, arcade, app)
// ne dépendent de rien : ils s'affichent tels quels, tout de suite. Un bouton
// « Explorer » qui clignote en gris avant d'apparaître, c'est faire attendre ce
// qui était déjà là.
//
// Tous sont `aria-hidden` : un lecteur d'écran n'a rien à lire dans un
// rectangle qui brille. Le rayon qui les porte reste annoncé par son titre.

function Bar({ w, h = 10, r, className = "" }) {
  return (
    <span
      className={`mh-skel ${className}`}
      style={{ width: w, height: h, ...(r != null ? { borderRadius: r } : null) }}
    />
  );
}

/** Une grande carte « tu joues à ». */
export function SkelNowPlaying() {
  return (
    <div className="mh-np mh-skel-card" aria-hidden="true">
      <div className="mh-skel-body">
        <div className="mh-skel-row">
          <Bar w={38} h={51} r={9} />
          <div className="mh-skel-stack">
            <Bar w="72%" h={14} />
            <Bar w="46%" h={9} />
          </div>
        </div>
        <div className="mh-skel-row">
          <Bar w="100%" h={28} r={999} />
          <Bar w={92} h={28} r={999} />
        </div>
      </div>
    </div>
  );
}

/** Une carte de rendez-vous : l'affiche en 16/9, puis la date, le nom, la cloche. */
export function SkelEvent() {
  return (
    <div className="mh-ev mh-skel-card" aria-hidden="true">
      <span className="mh-skel mh-skel-media" style={{ aspectRatio: "16 / 9" }} />
      <div className="mh-ev-body">
        <div className="mh-skel-row">
          <Bar w={54} h={18} r={999} />
          <Bar w="42%" h={9} />
        </div>
        <Bar w="86%" h={13} />
        <Bar w="38%" h={9} />
        <Bar w="100%" h={30} r={999} className="mh-skel-push" />
      </div>
    </div>
  );
}

/** Une liste de conférence. */
export function SkelEventList() {
  return (
    <div className="mh-elist" aria-hidden="true">
      <span className="mh-skel" style={{ aspectRatio: "16 / 10", borderRadius: 12 }} />
      <Bar w="86%" h={12} />
      <Bar w="36%" h={9} />
    </div>
  );
}

/** Une jaquette de rail. */
export function SkelTile() {
  return (
    <div className="mh-tile" aria-hidden="true">
      <span className="mh-skel" style={{ aspectRatio: "3 / 4", borderRadius: 11 }} />
      <Bar w="86%" h={10} />
      <Bar w="52%" h={8} />
    </div>
  );
}

/** Une sortie attendue : titre, date, et les trois blocs du compte à rebours. */
export function SkelAnticipated() {
  return (
    <div className="mh-antic mh-skel-card" aria-hidden="true">
      <div className="mh-antic-body">
        <Bar w="70%" h={15} />
        <Bar w="40%" h={9} />
        <div className="mh-skel-row mh-skel-push">
          <Bar w={42} h={36} r={10} />
          <Bar w={42} h={36} r={10} />
          <Bar w={42} h={36} r={10} />
        </div>
      </div>
    </div>
  );
}

/** La bande du mot du jour. */
export function SkelMot() {
  return (
    <div className="mh-mot mh-skel-mot" aria-hidden="true">
      <Bar w={34} h={34} r={999} />
      <div className="mh-skel-stack">
        <Bar w="32%" h={8} />
        <Bar w="64%" h={12} />
      </div>
    </div>
  );
}

/** La carte « tu joues à quoi ce soir ? ». */
export function SkelTonight() {
  return (
    <div className="mh-tonight mh-skel-tonight" aria-hidden="true">
      <Bar w={82} h={110} r={11} className="mh-skel-fixed" />
      <div className="mh-skel-stack mh-skel-fill">
        <Bar w="78%" h={9} />
        <Bar w="58%" h={15} />
        <div className="mh-skel-row mh-skel-bottom">
          <Bar w={112} h={33} r={999} />
          <Bar w={33} h={33} r={999} />
        </div>
      </div>
    </div>
  );
}

/**
 * N copies d'un squelette, à poser dans un rail.
 *
 * Un composant plutôt qu'une fonction utilitaire : ce fichier n'exporte ainsi
 * que des composants, ce qui garde le rechargement à chaud de Vite fonctionnel
 * pendant qu'on retouche les squelettes.
 */
export function SkelRepeat({ of: Component, count }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Component key={`skel-${i}`} />
      ))}
    </>
  );
}
