// Télécharge une image : on la récupère en blob puis on déclenche une ancre
// `download` (marche pour nos médias hébergés en propre : uploads, fan arts).
// Repli si la requête échoue (CORS d'un CDN tiers type IGDB, réseau…) : on
// ouvre l'image dans un nouvel onglet, où l'utilisateur peut l'enregistrer.
export async function downloadImage(url, name = "image") {
  if (!url) return;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("fetch");
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = safeName(name, blob.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function safeName(name, mime = "") {
  const ext = /png/.test(mime)
    ? "png"
    : /webp/.test(mime)
      ? "webp"
      : /gif/.test(mime)
        ? "gif"
        : "jpg";
  const base = String(name || "image").replace(/[^\w-]+/g, "_").slice(0, 60) || "image";
  return `${base}.${ext}`;
}
