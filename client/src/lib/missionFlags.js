import { apiFetch } from "./api";

// ======================================================================
//  Gestes accomplis côté CLIENT et invisibles en base.
// ======================================================================
// Passer au thème sombre, essayer la vue liste de l'Explorer… : rien de tout
// ça ne laisse de trace côté serveur, alors que ce sont des missions. On le
// signale donc une fois via POST /api/missions/event, et on note localement
// que c'est fait pour ne pas rappeler l'API à chaque geste.
//
// Le serveur dédoublonne de toute façon ($addToSet) et n'accepte que les
// drapeaux de sa liste blanche : ce cache local n'est qu'une politesse réseau.

const key = (flag) => `mpl_flag_${flag}`;

export function reportMissionFlag(flag, token) {
  let already = false;
  try {
    already = localStorage.getItem(key(flag)) === "1";
  } catch {
    /* stockage indisponible : on tente quand même l'appel */
  }
  if (already) return;

  const t =
    token ||
    localStorage.getItem("mpl_token") ||
    sessionStorage.getItem("mpl_token");
  if (!t) return; // visiteur non connecté : rien à créditer

  apiFetch("/missions/event", { method: "POST", token: t, body: { flag } })
    .then(() => {
      try {
        localStorage.setItem(key(flag), "1");
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      /* best-effort : on retentera au prochain geste */
    });
}
