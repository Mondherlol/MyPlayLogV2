import { apiFetch } from "./api";

// L'image qui tourne dans le globe (carte de l'arcade + fond du menu GeoGamer)
// est choisie par l'admin. On la lit sur /geo/globe et on la pose dans la
// variable CSS --geo-globe, que la carte et le fond utilisent via
// var(--geo-globe, url(asset-livré)). Tant que rien n'est réglé (url null), on
// efface la variable pour laisser le fallback CSS reprendre la main.
export async function applyGeoGlobe(token) {
  try {
    const data = await apiFetch("/geo/globe", { token });
    const root = document.documentElement;
    if (data?.url) root.style.setProperty("--geo-globe", `url("${data.url}")`);
    else root.style.removeProperty("--geo-globe");
  } catch {
    /* réseau/API en carafe : on garde l'asset livré. */
  }
}
