// Récupération best-effort des temps "how long to beat" depuis HowLongToBeat.
// ⚠️ HLTB n'a pas d'API publique. Depuis 2024 leur recherche est protégée : il
// faut d'abord récupérer un jeton de sécurité via /api/bleed/init, puis POSTer
// la recherche sur /api/bleed avec ce jeton (headers x-auth-token/x-hp-key/
// x-hp-val + un champ "honeypot" body[hpKey]=hpVal). C'est fragile (peut casser
// à tout moment) : en cas d'échec on renvoie null (l'appelant met alors le cache
// en "none").

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BASE = "https://howlongtobeat.com";
const COMMON_HEADERS = {
  "User-Agent": UA,
  Origin: BASE,
  Referer: BASE + "/",
};

// Jeton de sécurité anti-bot (valable un court instant, 403 à expiration).
async function fetchSecurityToken() {
  const r = await fetch(`${BASE}/api/bleed/init?t=${Date.now()}`, {
    headers: COMMON_HEADERS,
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.token) return null;
  return { token: j.token, hpKey: j.hpKey, hpVal: j.hpVal };
}

// Nom réduit à ses lettres/chiffres pour comparer sans se soucier de la casse,
// de la ponctuation ni des accents (choix du bon résultat parmi la liste).
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "");
}

export async function fetchHltbTimes(name) {
  try {
    const sec = await fetchSecurityToken();
    if (!sec) return null;

    const body = {
      searchType: "games",
      searchTerms: name.split(" ").filter(Boolean),
      searchPage: 1,
      size: 10,
      searchOptions: {
        games: {
          userId: 0,
          platform: "",
          sortCategory: "popular",
          rangeCategory: "main",
          rangeTime: { min: null, max: null },
          gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
          rangeYear: { min: "", max: "" },
          modifier: "",
        },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0,
      },
      useCache: true,
    };
    // Champ "honeypot" attendu dans le corps (nom de clé dynamique).
    if (sec.hpKey) body[sec.hpKey] = sec.hpVal;

    const r = await fetch(`${BASE}/api/bleed`, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/json",
        "x-auth-token": sec.token,
        "x-hp-key": sec.hpKey,
        "x-hp-val": sec.hpVal,
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const data = j.data || [];
    if (!data.length) return null;

    // Le meilleur résultat est en général le 1er (tri "popular"), mais on
    // privilégie une correspondance exacte de nom pour éviter un mauvais jeu.
    const target = normName(name);
    const g = data.find((x) => normName(x.game_name) === target) || data[0];

    const toH = (s) => (s ? Math.round(s / 3600) : null);
    // Mapping HLTB -> nos 3 valeurs (main / main+extra / complétionniste).
    const res = {
      hastily: toH(g.comp_main),
      normally: toH(g.comp_plus),
      completely: toH(g.comp_100),
    };
    // Si HLTB n'a aucune donnée chiffrée pour ce jeu, on considère l'échec.
    if (!res.hastily && !res.normally && !res.completely) return null;
    return res;
  } catch {
    return null;
  }
}
