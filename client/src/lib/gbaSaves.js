import { API_BASE } from "./api";

// ======================================================================
//  Les sauvegardes, côté navigateur
// ======================================================================
// POURQUOI CE FICHIER N'UTILISE PAS `apiFetch`. Le wrapper maison parle JSON —
// il sérialise ce qu'on lui donne et lit du JSON en retour. Un état de machine,
// c'est quatre cents kilo-octets d'octets bruts : passé en base64 dans du JSON,
// il grossit d'un tiers et se fait recopier trois fois au passage, à chaque
// sauvegarde automatique. On envoie donc du multipart et on lit de l'ArrayBuffer,
// directement.
//
// LES QUATRE GESTES, et rien de plus : lister, lire un état, en écrire un, vider
// un emplacement. Toute la logique de quand sauvegarder vit dans GbaPlayer — ici
// on ne fait que parler au serveur.

export const AUTO_SLOT = 0;

const url = (slug, tail = "") =>
  `${API_BASE}/collection/${encodeURIComponent(slug)}/saves${tail}`;

const auth = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

// Le message d'erreur du serveur quand il en donne un, le code sinon. Une
// sauvegarde qui échoue doit pouvoir se DIRE — c'est le seul moment où le joueur
// risque de perdre quelque chose.
async function fail(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse sans corps JSON */
  }
  const err = new Error(data?.error || `Erreur ${res.status}.`);
  err.status = res.status;
  return err;
}

// La liste des emplacements occupés, et combien il y en a en tout. Sert au
// tiroir, et à savoir dès l'allumage s'il y a une partie à reprendre.
//
// LE NOMBRE D'EMPLACEMENTS VIENT DU SERVEUR, il n'est pas recopié ici : c'est lui
// qui refuse un emplacement hors bornes, et deux constantes à tenir d'accord
// finissent toujours par diverger — le tiroir proposerait alors une case que
// l'API rejette.
export async function listSaves(slug, token) {
  const res = await fetch(url(slug), { headers: auth(token) });
  if (!res.ok) throw await fail(res);
  const data = await res.json();
  return { saves: data.saves || [], slots: data.slots || 0 };
}

// L'état d'un emplacement, en octets. C'est CETTE fonction qui rend la promesse
// de la reprise : ce qu'elle rapporte part tel quel dans l'iframe.
export async function readSave(slug, slot, token) {
  const res = await fetch(url(slug, `/${slot}/state`), { headers: auth(token) });
  if (!res.ok) throw await fail(res);
  return res.arrayBuffer();
}

// L'image de la vignette, telle que l'iframe l'a rendue (une URL `data:`), en
// fichier. Un `data:` ne s'envoie pas en multipart, et le convertir par `fetch`
// est la façon la plus courte de le faire sans découper du base64 à la main.
async function shotFile(dataUrl) {
  if (!dataUrl?.startsWith("data:")) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], "shot.jpg", { type: "image/jpeg" });
  } catch {
    return null; // pas de vignette : l'emplacement reste utilisable
  }
}

// Écrire un emplacement. `buf` est l'ArrayBuffer rendu par l'iframe ; le reste
// est ce qui s'affichera sous la vignette.
//
// LA VIGNETTE EST FACULTATIVE, l'état non. Si la capture d'écran a échoué, on
// envoie quand même la partie : perdre une image est sans conséquence, perdre la
// partie est tout ce qu'on essaie d'éviter.
export async function writeSave(slug, slot, { buf, shot, core, playSeconds, label }, token) {
  const fd = new FormData();
  fd.append("state", new Blob([buf], { type: "application/octet-stream" }), "state.bin");
  const picture = await shotFile(shot);
  if (picture) fd.append("shot", picture, picture.name);
  if (core) fd.append("core", core);
  fd.append("playSeconds", String(Math.max(0, Math.round(playSeconds || 0))));
  if (label) fd.append("label", label);

  const res = await fetch(url(slug, `/${slot}`), {
    method: "PUT",
    headers: auth(token),
    body: fd,
  });
  if (!res.ok) throw await fail(res);
  const data = await res.json();
  return data.save;
}

export async function deleteSave(slug, slot, token) {
  const res = await fetch(url(slug, `/${slot}`), {
    method: "DELETE",
    headers: auth(token),
  });
  if (!res.ok) throw await fail(res);
  return res.json();
}

// « il y a 3 minutes », « hier à 21:04 », « le 12 mars ». Sous une vignette,
// c'est la DISTANCE dans le temps qui parle, pas la date exacte : « il y a deux
// heures » situe une partie, « 30/07 18:12 » demande un calcul.
export function fmtWhen(at) {
  if (!at) return "";
  const then = new Date(at);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const time = then.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (hours < 48) return `hier à ${time}`;
  return then.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
