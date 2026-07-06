// Client VNDB (https://api.vndb.org/kana) — best-effort, sans clé d'API.
// Sert à récupérer les personnages des visual novels, souvent absents d'IGDB.
// En cas d'échec (réseau, format, rate-limit), on renvoie null / [].

const BASE = "https://api.vndb.org/kana";

async function post(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Normalise un titre pour une comparaison tolérante (casse, ponctuation, accents).
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

// Toutes les variantes de titre d'un VN (titre principal, alt, alias, et titres
// traduits). Indispensable car VNDB stocke souvent le titre anglais (celui
// d'IGDB) comme simple alias, le titre principal étant le romaji japonais.
function titleVariants(v) {
  return [
    v.title,
    v.alttitle,
    ...(v.aliases || []),
    ...(v.titles || []).map((t) => t.title),
  ]
    .map(norm)
    .filter(Boolean);
}

// Trouve l'ID VNDB d'un visual novel à partir de son titre.
// VNDB classe déjà ses résultats par pertinence : on garde cet ordre et on
// retient le 1er résultat dont une variante de titre correspond vraiment, pour
// éviter d'attraper un VN fan-made au titre voisin.
export async function findVnId(title) {
  if (!title) return null;
  const j = await post("/vn", {
    filters: ["search", "=", title],
    fields: "id, title, alttitle, aliases, titles.title",
    results: 10,
  });
  const results = j?.results || [];
  if (!results.length) return null;

  const target = norm(title);
  if (!target) return null;

  // 1) Correspondance exacte sur une variante (ordre de pertinence VNDB conservé).
  const exact = results.find((v) => titleVariants(v).includes(target));
  if (exact) return exact.id;

  // 2) Sinon inclusion nette (sous-titre en plus/en moins), sans matchs trop courts.
  const loose = results.find((v) =>
    titleVariants(v).some(
      (t) => t.length >= 6 && (t.includes(target) || target.includes(t))
    )
  );
  return loose?.id || null;
}

// Priorité d'affichage selon le rôle du personnage dans le VN.
const ROLE_ORDER = { main: 0, primary: 1, side: 2, appears: 3 };

// Récupère les personnages d'un VN (portraits d'abord, triés par importance).
// NB : l'API VNDB n'expose que le nom romaji (`name`), le nom natif (`original`)
// et des alias informels/traduits — pas les noms officiels localisés (FR/EN)
// affichés sur le site. On remonte donc `name` en principal + les alternatives.
export async function fetchVnCharacters(vnId, max = 100) {
  if (!vnId) return [];
  const j = await post("/character", {
    filters: ["vn", "=", ["id", "=", vnId]],
    fields: "id, name, original, aliases, image.url, image.sexual, vns.id, vns.role",
    results: max,
  });
  const results = j?.results || [];
  const hasLatin = (s) => /[a-zA-Z]/.test(s);

  return results
    .map((c) => {
      const rel = (c.vns || []).find((v) => v.id === vnId);
      const role = rel?.role || "appears";
      // On masque les portraits explicitement sexuels (niveau VNDB >= 2).
      const image = c.image && (c.image.sexual ?? 0) < 2 ? c.image.url : null;

      // Noms alternatifs : natif (toujours utile) + alias lisibles (latins),
      // dédoublonnés, sans répéter le nom principal, limités pour rester lisibles.
      const alt = [];
      const push = (s) => {
        const t = (s || "").trim();
        if (t && t !== c.name && !alt.includes(t)) alt.push(t);
      };
      push(c.original);
      (c.aliases || []).filter(hasLatin).forEach(push);

      return {
        id: `vndb-${c.id}`,
        name: c.name || c.original || "?",
        image,
        source: "vndb",
        altNames: alt.slice(0, 8),
        _role: ROLE_ORDER[role] ?? 3,
      };
    })
    .sort((a, b) => a._role - b._role)
    .map(({ _role, ...c }) => c);
}
