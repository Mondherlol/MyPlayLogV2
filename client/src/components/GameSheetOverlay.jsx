import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import GamePage from "../pages/GamePage";

// ======================================================================
//  La fiche d'un jeu, par-dessus ce qu'on est en train de faire
// ======================================================================
// On est un site de jeux vidéo : quand un mini-jeu montre un titre, on doit
// pouvoir aller le regarder. Mais PAS AU PRIX DE LA PARTIE EN COURS — d'où
// cette surcouche plutôt qu'un lien : la page en dessous reste montée, son flux
// SSE continue d'arriver, les chronos tournent, et fermer rend la main
// exactement où on en était.
//
// Trois emplacements sont laissés à l'appelant, et c'est ce qui permet à la
// fiche d'être une VRAIE fenêtre secondaire plutôt qu'un cul-de-sac :
//   - `hud`    : le bandeau du haut, qui rappelle ce qui continue derrière ;
//   - `footer` : la barre du bas, où l'appelant met de quoi CONTINUER À JOUER
//                sans fermer (à l'Imposteur : le champ d'indice) ;
//   - `pill`   : ce qu'on voit quand la fiche est réduite.
//
// -------------------------------------------------- la navigation confisquée
// C'est TOUTE la difficulté. La fiche est truffée de liens (studios,
// plateformes, similaires, profils, boutiques) et le moindre clic distrait
// démonterait la page en dessous : on se retrouverait sorti de sa partie sans
// l'avoir voulu. Deux garde-fous, l'un pour chaque façon de naviguer :
//
//   - les BOUTONS passent tous par le `navigate` local de la fiche, que
//     `embedded` remplace par une version inoffensive (voir GamePage) ;
//   - les <Link> passent par le routeur, donc on intercepte le clic ICI, en
//     phase de capture, avant que React Router ne le voie.
//
// Ce qu'on laisse vivre, et rien d'autre :
//   - un lien vers UN AUTRE JEU (`/game/:id`) : il ne sort pas, il remplace la
//     fiche affichée — c'est même le geste le plus utile (« c'est quoi ce
//     remake ? ») ;
//   - un lien `target="_blank"` (Steam, site officiel) : il s'ouvre à côté et
//     ne démonte rien.
//
// ---------------------------------------------------------------- le retour
// La surcouche n'empile PAS d'entrée d'historique : le bouton « précédent » du
// téléphone doit ramener au salon, pas fermer une fiche qu'il croirait être une
// page. Échap ferme, le bouton « Fermer » de la fiche aussi.
export default function GameSheetOverlay({
  gameId,
  onClose,
  hud = null,
  footer = null,
  pill = null,
  minimized = false,
  originRect = null,
}) {
  // La fiche affichée peut changer sans fermer la surcouche (jeux similaires,
  // remakes). D'où cet état local plutôt que la seule prop.
  const [id, setId] = useState(String(gameId || ""));
  useEffect(() => setId(String(gameId || "")), [gameId]);

  // Le défilement de la page en dessous n'est bloqué que fiche OUVERTE : une
  // fois réduite, elle n'est plus qu'une pastille dans un coin, et bloquer le
  // salon derrière elle n'aurait aucun sens.
  useEffect(() => {
    if (minimized) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [minimized]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---------- L'ouverture ----------
  // La fiche jaillit de la jaquette qu'on vient de toucher : on part de sa
  // position et de sa taille exactes, et on se déplie jusqu'au plein écran. Une
  // surcouche qui apparaît de nulle part fait perdre le fil de ce qu'on
  // regardait ; celle-ci dit « c'est CETTE image que tu ouvres ».
  //
  // Tout est calculé une fois, à l'ouverture, et confié au CSS : animer en JS
  // une pleine page qui charge en même temps ses images donnerait une saccade
  // là où l'on veut précisément de la fluidité.
  const zoom = useMemo(() => {
    if (!originRect) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.max(0.08, Math.min(1, originRect.width / vw));
    return {
      "--gs-dx": `${originRect.left + originRect.width / 2 - vw / 2}px`,
      "--gs-dy": `${originRect.top + originRect.height / 2 - vh / 2}px`,
      "--gs-s": s,
    };
  }, [originRect]);

  // Le filet des <Link> : en capture, donc avant le routeur.
  const guard = useCallback((e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    if (a.target === "_blank") return; // s'ouvre à côté, ne démonte rien
    const to = a.getAttribute("href") || "";
    e.preventDefault();
    e.stopPropagation();
    const game = to.match(/^\/game\/([^/?#]+)/);
    if (game) setId(game[1]);
  }, []);

  return createPortal(
    <div
      className={`gsheet ${minimized ? "min" : ""} ${zoom ? "zoomed" : ""}`}
      style={zoom}
      role="dialog"
      aria-modal={!minimized}
    >
      {/* Réduite, la fiche N'EST PAS démontée : elle est cachée. GamePage garde
          son jeu chargé, son onglet, ses images — rouvrir est instantané, alors
          qu'un démontage relancerait tout et donnerait l'impression d'avoir
          perdu sa place. */}
      {!minimized && hud}
      <div className="gsheet-scroll" onClickCapture={guard}>
        <GamePage
          gameId={id}
          embedded
          onClose={onClose}
          onOpenGame={(next) => setId(String(next))}
        />
      </div>
      {!minimized && footer}
      {minimized && pill}
    </div>,
    document.body
  );
}
