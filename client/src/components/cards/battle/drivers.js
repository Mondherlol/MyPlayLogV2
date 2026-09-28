import { apiFetch } from "../../../lib/api";

// ======================================================================
//  Qui est en face : le bot, ou un pote en direct
// ======================================================================
// L'arène (Arena.jsx) ne parle jamais au serveur elle-même : elle passe par un
// « pilote » qui sait jouer une carte, tenter un sauvetage, abandonner. Contre
// le bot, chaque requête rend aussitôt le verdict. Contre un pote, le verdict
// arrive quand LES DEUX ont posé — par le direct (évènement « cardduel »), ou
// par la réponse de la requête quand on est le second à jouer.

export function botDriver(token) {
  return {
    mode: "bot",
    opponent: null,
    ready: () => Promise.resolve(),
    play: (v, card) => apiFetch(`/cards/battle/${v.id}/play`, { method: "POST", token, body: { card } }),
    rescue: (v, card) => apiFetch(`/cards/battle/${v.id}/rescue`, { method: "POST", token, body: { card } }),
    oppRescue: () => Promise.resolve(null),
    quit: (v) => apiFetch(`/cards/battle/${v.id}/quit`, { method: "POST", token }),
    on: () => () => {},
    picked: () => false,
  };
}

// Un duel : chaque étape attendue (« go » de la manche 3, verdict de la
// manche 3…) est une clé. Ce qui arrive avant qu'on l'attende est gardé ; ce
// qu'on attend et qui tarde est redemandé au serveur toutes les quelques
// secondes (le direct peut décrocher : la partie, elle, continue).
export function duelDriver({ token, code, opponent, subscribe }) {
  const got = new Map();
  const waiters = new Map();
  const listeners = new Map();
  const base = `/cards/duel/${code}`;

  const emit = (ev, data) => listeners.get(ev)?.forEach((fn) => fn(data));
  function settle(key, value) {
    if (got.has(key)) return;
    got.set(key, value);
    const w = waiters.get(key);
    if (w) {
      waiters.delete(key);
      w.resolve(value);
    }
  }
  function wait(key) {
    if (got.has(key)) return Promise.resolve(got.get(key));
    let w = waiters.get(key);
    if (!w) {
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      w = { promise, resolve };
      waiters.set(key, w);
    }
    return w.promise;
  }

  let ended = false;
  function endWith(state) {
    if (ended || !state?.end) return;
    ended = true;
    emit("end", state);
  }

  // Un instantané de la partie : tout ce qu'il prouve est acquis.
  function absorb(state) {
    if (!state) return;
    const r = state.round;
    if (r?.go) settle(`go:${r.n}`, { left: r.left, at: Date.now() });
    if (r?.his) {
      if (!got.has(`picked:${r.n}`)) emit("picked", r.n);
      settle(`picked:${r.n}`, true);
    }
    const last = state.last;
    if (last) {
      settle(`round:${last.n}`, state);
      if (last.rescue) settle(`rescue:${last.n}`, state);
    }
    // Fin brutale (abandon, partie annulée) : l'arène coupe court.
    if (state.end && (state.end.forfeit || state.end.cancelled)) endWith(state);
  }

  const off = subscribe((event, data) => {
    if (event !== "cardduel" || data?.code !== code) return;
    switch (data.kind) {
      case "go":
        settle(`go:${data.n}`, { left: data.left ?? null, at: Date.now() });
        break;
      case "picked":
        if (!got.has(`picked:${data.n}`)) emit("picked", data.n);
        settle(`picked:${data.n}`, true);
        break;
      case "round":
        settle(`round:${data.n}`, data.state);
        break;
      case "rescue":
        settle(`rescue:${data.n}`, data.state);
        break;
      case "end":
        endWith(data.state);
        break;
      case "rematch":
        emit("rematch", data);
        break;
      default:
    }
  });

  // Le filet : on attend quelque chose depuis un moment → on redemande.
  const poll = setInterval(() => {
    if (!waiters.size || document.visibilityState === "hidden") return;
    apiFetch(base, { token })
      .then((d) => absorb(d.state))
      .catch(() => {});
  }, 4000);

  return {
    mode: "pvp",
    code,
    opponent,
    async ready(n) {
      try {
        const d = await apiFetch(`${base}/ready`, { method: "POST", token, body: { n } });
        // Le serveur est ailleurs (reprise, manche déjà close) : on n'attend pas
        // un « go » qui ne viendra pas.
        if (d.go || d.n !== n) settle(`go:${n}`, { left: d.left ?? null, at: Date.now() });
      } catch {
        /* le filet prendra le relais */
      }
      return wait(`go:${n}`);
    },
    async play(v, card) {
      const n = v.round.n;
      try {
        const d = await apiFetch(`${base}/pick`, { method: "POST", token, body: { n, card } });
        if (d.state) settle(`round:${n}`, d.state);
      } catch (e) {
        // 409 : la manche s'est jouée sans nous (chrono du serveur) — le
        // verdict arrive quand même. Le reste est une vraie erreur.
        if (e.status !== 409) throw e;
      }
      const state = await wait(`round:${n}`);
      return { result: state.last.result, state };
    },
    async rescue(v, card) {
      const n = v.last?.n ?? v.n;
      let state;
      try {
        state = (await apiFetch(`${base}/rescue`, { method: "POST", token, body: { card } })).state;
        settle(`rescue:${n}`, state);
      } catch (e) {
        if (e.status !== 409) throw e;
        state = await wait(`rescue:${n}`);
      }
      return { rescue: state.last?.rescue || { saved: false, answers: [] }, state };
    },
    async oppRescue(n) {
      const state = await wait(`rescue:${n}`);
      return { rescue: state.last?.rescue || null, state };
    },
    quit: () => apiFetch(`${base}/quit`, { method: "POST", token }),
    picked: (n) => got.has(`picked:${n}`),
    absorb,
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
    destroy() {
      off?.();
      clearInterval(poll);
      listeners.clear();
    },
  };
}
