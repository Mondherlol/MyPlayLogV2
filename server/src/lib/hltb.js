// Récupération best-effort des temps "how long to beat" depuis HowLongToBeat.
// ⚠️ HLTB n'a pas d'API publique : on extrait dynamiquement l'endpoint de
// recherche depuis leur bundle JS. C'est fragile (peut casser à tout moment).
// En cas d'échec, on renvoie null (l'appelant met alors le cache en "none").

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let endpointCache = null;
let endpointCheckedAt = 0;

async function findEndpoint() {
  // re-tente au plus une fois par heure
  if (endpointCache && Date.now() - endpointCheckedAt < 3_600_000) {
    return endpointCache;
  }
  endpointCheckedAt = Date.now();
  try {
    const home = await fetch("https://howlongtobeat.com/", {
      headers: { "User-Agent": UA },
    }).then((r) => r.text());

    const srcs = [...home.matchAll(/src="([^"]*_next[^"]+\.js)"/g)].map((m) => m[1]);
    for (const s of srcs) {
      const url = s.startsWith("http") ? s : "https://howlongtobeat.com" + s;
      const js = await fetch(url, { headers: { "User-Agent": UA } })
        .then((r) => r.text())
        .catch(() => "");
      // Motif classique : "/api/xxx/".concat("a").concat("b")...
      const m = js.match(/"(\/api\/[a-z_]+\/?)"((?:\.concat\("[a-zA-Z0-9]+"\))+)/i);
      if (m) {
        const tokens = [...m[2].matchAll(/concat\("([a-zA-Z0-9]+)"\)/g)]
          .map((x) => x[1])
          .join("");
        endpointCache = "https://howlongtobeat.com" + m[1] + tokens;
        return endpointCache;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchHltbTimes(name) {
  try {
    const endpoint = await findEndpoint();
    if (!endpoint) return null;

    const body = JSON.stringify({
      searchType: "games",
      searchTerms: name.split(" ").filter(Boolean),
      searchPage: 1,
      size: 5,
      searchOptions: {
        games: {
          userId: 0,
          platform: "",
          sortCategory: "popular",
          rangeCategory: "main",
          rangeTime: { min: null, max: null },
          gameplay: { perspective: "", flow: "", genre: "" },
          rangeYear: { min: "", max: "" },
          modifier: "",
        },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0,
      },
    });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Origin: "https://howlongtobeat.com",
        Referer: "https://howlongtobeat.com/",
      },
      body,
    });
    if (!r.ok) return null;
    const j = await r.json();
    const g = (j.data || [])[0];
    if (!g) return null;

    const toH = (s) => (s ? Math.round(s / 3600) : null);
    // Mapping HLTB -> nos 3 valeurs
    return {
      hastily: toH(g.comp_main),
      normally: toH(g.comp_plus),
      completely: toH(g.comp_100),
    };
  } catch {
    return null;
  }
}
