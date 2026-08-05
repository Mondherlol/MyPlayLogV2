import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import {
  Send,
  Loader2,
  Crown,
  Trophy,
  Sparkles,
  X,
  History,
  Flag,
  Gamepad2,
  ArrowRight,
  Clock,
  Target,
  Users,
  UserPlus,
  LogOut,
  Link2,
  Check,
  Play,
  MessagesSquare,
  Pencil,
  Hourglass,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { playHeatTick, playRejectSound, playRewardSound } from "../lib/sfx";

// ======================================================================
//  Mot du jour — devine le mot par la proximité de sens.
// ======================================================================
// Un mot, le même pour tout le monde, de minuit à minuit. On propose des mots ;
// chacun revient avec une température (0-100 °) et, s'il fait partie des 1000
// plus proches, son rang.
//
// L'ERGONOMIE TIENT À UN POINT : le résultat du mot qu'on vient de taper doit
// être sous les yeux, immédiatement. La liste est triée par température, donc un
// mot plus froid que les précédents part tout en bas — sans panneau dédié, il
// faudrait scroller pour lire son propre essai. D'où .mdj-hero, juste sous le
// champ ; le meilleur essai n'est qu'une ligne secondaire.
//
// -------------------------------------------------------------- à plusieurs
// La même page sert les deux modes. En session, trois choses changent :
//   - les essais sont ceux du GROUPE (pot commun, cf. models/MotSession.js) ;
//   - chaque ligne porte la tête de celui qui l'a proposée ;
//   - on voit les autres taper, lettre à lettre.
// Tout le direct passe par le flux SSE de la messagerie (évènement « mot »),
// déjà ouvert pour le chat — aucun tunnel supplémentaire.
//
// ------------------------------------------------------------- les équipes
// Une session meurt à minuit avec son mot ; une ÉQUIPE (models/MotTeam.js) est
// la liste des gens avec qui on cherche, et elle, elle reste. Le rail affiche
// donc « Tes équipes » avec un bouton unique : le premier qui clique ouvre la
// partie du jour, les autres l'y rejoignent. Personne n'a rien à réinviter.
//
// La réponse n'est jamais envoyée au client avant d'être trouvée : tout le monde
// joue la même énigme toute la journée.

const fmt = (n) => Number(n || 0).toLocaleString("fr-FR");

// Les paliers, du plus froid au plus chaud. Les seuils sont ceux du serveur
// (lib/mots.js → heatBand) : on ne fait que les habiller.
//
// Les émojis sont un choix ASSUMÉ ici, alors que le reste de l'app s'en tient
// aux icônes Lucide : dans un jeu de chaud-froid, ils lisent d'un coup d'œil.
const BANDS = {
  glacial: { emoji: "🧊", label: "Glacial", cheer: "Tu gèles." },
  frais: { emoji: "❄️", label: "Frais", cheer: "Froid, mais tu bouges." },
  tiede: { emoji: "🌡️", label: "Tiède", cheer: "Tiède… tu tiens quelque chose." },
  chaud: { emoji: "🔥", label: "Chaud", cheer: "Ça chauffe !" },
  bouillant: { emoji: "🌋", label: "Bouillant", cheer: "Tu brûles !!" },
};
const BAND_ORDER = ["glacial", "frais", "tiede", "chaud", "bouillant"];

function bandOf(temp) {
  if (temp >= 90) return "bouillant";
  if (temp >= 75) return "chaud";
  if (temp >= 50) return "tiede";
  if (temp >= 25) return "frais";
  return "glacial";
}

// Au-delà de ce seuil, des flammes jaillissent du panneau.
const FLAME_AT = 90;
// Cadence d'envoi de « ce que je tape ». Assez serré pour qu'on voie les
// lettres arriver, assez lâche pour ne pas poster à chaque touche.
const TYPING_MS = 180;
// Un « X tape… » s'efface tout seul si plus rien n'arrive.
const TYPING_TTL = 3500;

function humanTime(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

function humanCountdown(ms) {
  if (ms == null || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}

export default function MotDuJour() {
  const { token, user, updateUser } = useAuth();
  const { subscribe } = useChat();
  const [params, setParams] = useSearchParams();

  const [state, setState] = useState(null);
  const [board, setBoard] = useState(null);
  const [openSessions, setOpenSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [fatal, setFatal] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [last, setLast] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showWin, setShowWin] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false); // création / entrée / sortie de partie
  const [invitation, setInvitation] = useState(null); // arrivée par un lien
  const [teamInvite, setTeamInvite] = useState(null); // arrivée par un lien d'équipe
  const [typers, setTypers] = useState({}); // userId → { user, text, at }
  const [toasts, setToasts] = useState([]); // arrivées / départs, éphémères

  const inputRef = useRef(null);
  const deadlineRef = useRef(null);
  const typingRef = useRef({ at: 0, timer: null });

  const session = state?.session || null;
  const inSession = Boolean(session);

  // Bandeaux éphémères des mouvements de table. Volontairement locaux à la page
  // plutôt que branchés sur les pop-up de la messagerie : ça ne concerne que
  // cette partie, et ça ne doit rien laisser dans l'historique des messages.
  const toast = useCallback((t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const d = await apiFetch("/mot/today", { token });
      setState(d);
      deadlineRef.current = Date.now() + (d.msUntilNext || 0);
      setErr("");
      return d;
    } catch (e) {
      if (e.status === 503) setFatal(e.message);
      else setErr(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Le classement du jour porte DEUX listes : ceux qui ont trouvé (`entries`,
  // le classement proprement dit) et ceux qui cherchent encore (`searching`,
  // avec leur compteur d'essais en direct).
  const loadBoard = useCallback(async () => {
    try {
      const d = await apiFetch("/mot/board", { token });
      setBoard({ entries: d.entries || [], searching: d.searching || [] });
    } catch {
      setBoard({ entries: [], searching: [] });
    }
  }, [token]);

  const loadOpenSessions = useCallback(async () => {
    try {
      const d = await apiFetch("/mot/sessions", { token });
      setOpenSessions(d.sessions || []);
    } catch {
      setOpenSessions([]);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadToday();
    loadBoard();
    loadOpenSessions();
  }, [token, loadToday, loadBoard, loadOpenSessions]);

  // Le tableau respire : les compteurs de ceux qui cherchent encore n'ont
  // d'intérêt qu'à jour. Une relève par minute suffit largement — c'est un jeu
  // qui se joue sur la journée, pas à la seconde — et l'onglet en arrière-plan
  // ne réveille personne.
  useEffect(() => {
    if (!token) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadBoard();
    }, 60000);
    return () => clearInterval(id);
  }, [token, loadBoard]);

  // --- Arrivée par un lien d'invitation (/mot?s=CODE) ---
  // On NE REJOINT PAS tout seul : entrer dans une partie, c'est y verser ses
  // essais solo, et c'est irréversible. On montre donc ce que ça coûte avant.
  const code = params.get("s");
  useEffect(() => {
    if (!token || !code) return;
    let alive = true;
    apiFetch(`/mot/session/${code}`, { token })
      .then((d) => {
        if (!alive) return;
        if (d.session?.joined) {
          // Déjà à cette table (rechargement de page) : on nettoie l'URL.
          setParams({}, { replace: true });
          loadToday();
        } else {
          setInvitation(d);
        }
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token, code, setParams, loadToday]);

  // --- Arrivée par un lien d'ÉQUIPE (/mot?t=CODE) ---
  // Contrairement au lien de session, celui-ci ne périme pas : il ouvre la
  // partie du jour, quel que soit le jour où on clique. Entrer dans l'équipe ne
  // coûte aucun essai — c'est le carnet d'adresses, pas la table — donc la
  // modale est une présentation, pas un avertissement.
  const teamCode = params.get("t");
  useEffect(() => {
    if (!token || !teamCode) return undefined;
    let alive = true;
    apiFetch(`/mot/team/${teamCode}`, { token })
      .then((d) => {
        if (!alive) return;
        if (d.member) {
          setParams({}, { replace: true });
          loadToday();
        } else setTeamInvite(d);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [token, teamCode, setParams, loadToday]);

  useEffect(() => {
    if (!deadlineRef.current) return undefined;
    const tick = () => setCountdown(deadlineRef.current - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state?.date]);

  const guesses = useMemo(
    () => (inSession ? session.guesses || [] : state?.guesses || []),
    [inSession, session, state]
  );
  const tries = inSession ? session.tries || 0 : state?.tries || 0;
  const done = Boolean(state?.solved || state?.gaveUp);

  // Le focus revient au champ après CHAQUE essai, y compris après un mot
  // inconnu : on enchaîne au clavier sans toucher la souris. C'est pour ça que
  // le champ n'est pas `disabled` pendant l'envoi — un input désactivé perd le
  // focus, et le focus() du finally arriverait avant que React ne l'ait
  // réactivé, donc dans le vide.
  useEffect(() => {
    if (!loading && !done && !invitation) inputRef.current?.focus();
  }, [loading, done, invitation, tries]);

  // --- Temps réel de la session ---
  useEffect(() => {
    if (!inSession || !subscribe) return undefined;
    const myCode = session.code;
    return subscribe((event, data) => {
      if (event !== "mot" || data?.code !== myCode) return;

      if (data.kind === "typing") {
        const id = data.by?.id;
        if (!id) return;
        setTypers((t) =>
          data.text
            ? { ...t, [id]: { user: data.by, text: data.text, at: Date.now() } }
            : Object.fromEntries(Object.entries(t).filter(([k]) => k !== id))
        );
        return;
      }

      if (data.kind === "guess") {
        playHeatTick(data.temp);
        // LE PANNEAU MONTRE LE DERNIER ESSAI DE LA TABLE, pas seulement les
        // miens. Sans ça, le mot d'un coéquipier se glissait silencieusement
        // quelque part dans une liste triée : on ne savait ni ce qu'il valait,
        // ni où le chercher. Il reste affiché jusqu'à la proposition suivante.
        setLast({
          word: data.word,
          temp: data.temp,
          rank: data.rank,
          by: data.by || null,
        });
        // On efface la frappe de l'auteur : son mot est parti.
        if (data.by?.id)
          setTypers((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== data.by.id)));
        setState((s) =>
          s?.session
            ? {
                ...s,
                session: {
                  ...s.session,
                  tries: data.tries,
                  guesses: [
                    ...s.session.guesses,
                    {
                      word: data.word,
                      temp: data.temp,
                      band: data.band,
                      rank: data.rank,
                      by: data.by || null,
                      at: new Date().toISOString(),
                    },
                  ],
                },
              }
            : s
        );
        return;
      }

      if (data.kind === "members") {
        // Une arrivée se fête, un départ se remarque : dans les deux cas le
        // total d'essais du groupe vient de bouger, et c'est l'information la
        // plus importante de la partie.
        if (data.joined && data.joined.id !== user?.id)
          toast({ kind: "join", user: data.joined, tries: data.tries });
        if (data.left && data.left.id !== user?.id)
          toast({ kind: "left", user: data.left });
        loadToday();
        return;
      }

      if (data.kind === "solved") {
        playRewardSound();
        setShowWin(true);
        loadToday();
        loadBoard();
      }
    });
  }, [inSession, session?.code, subscribe, loadToday, loadBoard, toast, user?.id]);

  // --- « Ton équipe vient de lancer la partie » ---
  // Écouté HORS session, contrairement au reste du direct : c'est justement
  // l'évènement qui fait entrer dans une partie qu'on n'a pas encore rejointe.
  // Il ne porte pas de `code` de session, donc l'écouteur de table ci-dessus
  // l'ignore de lui-même.
  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "mot" || data?.kind !== "team") return;
      toast({
        kind: "team",
        user: data.by,
        teamName: data.teamName,
        tries: data.tries,
      });
      loadToday();
    });
  }, [subscribe, loadToday, toast]);

  // Les indicateurs de frappe s'éteignent d'eux-mêmes : si un joueur ferme son
  // onglet en plein mot, personne ne doit rester avec son « CAR » à l'écran.
  useEffect(() => {
    if (!Object.keys(typers).length) return undefined;
    const id = setInterval(() => {
      const now = Date.now();
      setTypers((t) => {
        const next = Object.fromEntries(
          Object.entries(t).filter(([, v]) => now - v.at < TYPING_TTL)
        );
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [typers]);

  const best = guesses.reduce((m, g) => (g.temp > (m?.temp ?? -1) ? g : m), null);

  // « Joue au Mot du jour · 68° » dans la messagerie de ceux avec qui on
  // discute (cf. lib/presence.js). On annonce la MEILLEURE température, pas la
  // dernière : c'est la seule qui dit vraiment où on en est. Rien n'est
  // divulgué — un degré ne trahit aucun mot. Et on se tait une fois trouvé,
  // sinon le statut afficherait « 100° » toute la soirée.
  useLiveStatus(
    "mot",
    done ? "" : best ? `${Math.round(best.temp)}°${inSession ? " · à plusieurs" : ""}` : "",
    { token, active: !done }
  );

  // Diffusion de ce que je tape, à cadence bornée.
  function pushTyping(text) {
    if (!inSession) return;
    const now = Date.now();
    const t = typingRef.current;
    clearTimeout(t.timer);
    const fire = () => {
      t.at = Date.now();
      apiFetch(`/mot/session/${session.code}/typing`, {
        method: "POST",
        token,
        body: { text },
      }).catch(() => {});
    };
    if (now - t.at >= TYPING_MS) fire();
    else t.timer = setTimeout(fire, TYPING_MS - (now - t.at));
  }

  async function submit(e) {
    e?.preventDefault();
    const word = input.trim();
    if (!word || sending || done) return;
    setSending(true);
    setNotice("");
    try {
      const path = inSession ? `/mot/session/${session.code}/guess` : "/mot/guess";
      const r = await apiFetch(path, { method: "POST", token, body: { word } });
      setInput("");
      pushTyping("");

      if (r.repeat) {
        setLast({ word: r.word, temp: r.temp, rank: r.rank, by: r.by, again: true });
        setNotice(
          r.by && r.by.id !== user?.id
            ? `Déjà proposé par ${r.by.username}.`
            : "Déjà proposé, mais le voilà."
        );
        playRejectSound();
        return;
      }

      if (r.solved) {
        playRewardSound();
        setLast({ word: r.word, temp: 100, rank: 0, win: true });
        setShowWin(true);
        if (r.points != null) updateUser({ points: r.points });
        await Promise.all([loadToday(), loadBoard()]);
        return;
      }

      playHeatTick(r.temp);
      setLast({ word: r.word, temp: r.temp, rank: r.rank });

      if (r.session) {
        setState((s) => (s ? { ...s, session: r.session } : s));
      } else {
        setState((s) =>
          s
            ? {
                ...s,
                tries: r.tries,
                guesses: [
                  ...s.guesses,
                  { word: r.word, temp: r.temp, rank: r.rank, at: new Date().toISOString() },
                ],
              }
            : s
        );
      }
    } catch (e2) {
      if (/terminée/i.test(e2.message) || e2.data?.code === "in_session") loadToday();
      else {
        setNotice(e2.message);
        playRejectSound();
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function giveUp() {
    if (done) return;
    if (!window.confirm("Abandonner ? Le mot sera révélé et tu ne marqueras aucun point."))
      return;
    try {
      const d = await apiFetch("/mot/giveup", { method: "POST", token });
      setState((s) => ({ ...s, ...d }));
      setShowWin(true);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function openSession() {
    if (busy) return;
    setBusy(true);
    try {
      const d = await apiFetch("/mot/session", { method: "POST", token });
      setState((s) => (s ? { ...s, session: d.session } : s));
      setShowInvite(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinSession(joinCode) {
    if (busy) return;
    setBusy(true);
    try {
      const d = await apiFetch(`/mot/session/${joinCode}/join`, { method: "POST", token });
      setState((s) => (s ? { ...s, session: d.session } : s));
      setInvitation(null);
      setParams({}, { replace: true });
      loadOpenSessions();
    } catch (e) {
      setErr(e.message);
      setInvitation(null);
    } finally {
      setBusy(false);
    }
  }

  // La partie du jour d'une équipe : UN SEUL geste pour deux situations. Si
  // personne n'a encore lancé, on ouvre la table ; sinon on la rejoint. Le
  // joueur n'a pas à savoir lequel des deux il déclenche.
  async function playWithTeam(code) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const d = await apiFetch(`/mot/team/${code}/play`, { method: "POST", token });
      setState((s) => (s ? { ...s, session: d.session } : s));
      setTypers({});
      loadToday();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function joinTeam(code, { play = false } = {}) {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/mot/team/${code}/join`, { method: "POST", token });
      setTeamInvite(null);
      setParams({}, { replace: true });
      if (play) {
        setBusy(false);
        await playWithTeam(code);
        return;
      }
      await loadToday();
    } catch (e) {
      setErr(e.message);
      setTeamInvite(null);
    } finally {
      setBusy(false);
    }
  }

  async function renameTeam(code, current) {
    const name = window.prompt("Nom de l'équipe :", current || "");
    if (name === null) return;
    try {
      await apiFetch(`/mot/team/${code}`, { method: "PATCH", token, body: { name } });
      loadToday();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function leaveTeam(code) {
    if (busy) return;
    if (
      !window.confirm(
        "Quitter l'équipe ? Elle ne réapparaîtra plus dans ton rail les prochains jours."
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/mot/team/${code}/leave`, { method: "POST", token });
      await loadToday();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function leaveSession() {
    if (busy || !inSession) return;
    if (
      !window.confirm(
        "Quitter la partie ? Tu repars en solo avec le total d'essais du groupe."
      )
    )
      return;
    setBusy(true);
    try {
      await apiFetch(`/mot/session/${session.code}/leave`, { method: "POST", token });
      setTypers({});
      await loadToday();
      loadOpenSessions();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (fatal) {
    return (
      <div className="mdj-page">
        <div className="mdj-fatal">
          <span className="mdj-fatal-emoji">🌡️</span>
          <h1>Mot du jour indisponible</h1>
          <p>{fatal}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mdj-page">
      <div className="mdj-main">
        {/* Le bandeau se réduit à une ligne : le titre, et le compte à rebours.
            Sur petit écran, seul le titre reste — le sous-titre explique une
            règle qu'on connaît dès la deuxième visite, il ne vaut pas les
            150 px qu'il volait au champ de saisie. */}
        <header className="mdj-banner">
          <span className="mdj-banner-glow" aria-hidden="true" />
          <div className="mdj-banner-id">
            <h1 className="mdj-title">
              Mot du jour <span aria-hidden="true">🌡️</span>
            </h1>
            <p className="mdj-sub">
              Propose des mots&nbsp;: plus ils sont proches du sens cherché, plus ça chauffe.
            </p>
          </div>
          <Countdown ms={countdown} tz={state?.tz} />
        </header>

        {err && <p className="mdj-err">{err}</p>}

        {loading ? (
          <div className="mdj-state">
            <Loader2 size={22} className="spin" />
          </div>
        ) : done ? (
          <Reveal state={state} onShowWin={() => setShowWin(true)} />
        ) : (
          <>
            <section className="mdj-play">
              <form className="mdj-form" onSubmit={submit}>
                <input
                  ref={inputRef}
                  className="mdj-input"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    pushTyping(e.target.value.trim());
                  }}
                  placeholder={inSession ? "Propose un mot à l'équipe…" : "Propose un mot…"}
                  maxLength={24}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                  enterKeyHint="send"
                />
                <button
                  className="mdj-send clickable"
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Proposer ce mot"
                >
                  {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                </button>
              </form>

              {inSession && <Typers typers={typers} />}
              {notice && <p className="mdj-notice">{notice}</p>}

              <Hero last={last} neighbours={state?.neighbours || 1000} meId={user?.id} />

              <div className="mdj-play-foot">
                {best ? (
                  <span className="mdj-best">
                    <Trophy size={13} /> Meilleur&nbsp;: <b>{best.word}</b>{" "}
                    <em className={`b-${bandOf(best.temp)}`}>{best.temp}°</em>
                    {best.rank ? <i>#{best.rank}</i> : null}
                  </span>
                ) : (
                  <span className="mdj-best empty">
                    N'importe quel nom commun fait un bon premier essai.
                  </span>
                )}
                <span className="mdj-foot-right">
                  {/* Les têtes de la table, au ras du compteur d'essais : le
                      panneau de session vit dans le rail, donc sur mobile il
                      passe sous la liste. Sans ce rappel, rien n'indiquerait
                      en haut d'écran qu'on joue à plusieurs — ni à qui
                      profitent les essais qu'on brûle. */}
                  {inSession && (
                    <span className="mdj-sess-faces mini">
                      {(session.members || [])
                        .filter((m) => m.active)
                        .slice(0, 4)
                        .map((m) => (
                          <Face key={m.user.id} user={m.user} size={22} />
                        ))}
                    </span>
                  )}
                  <span className="mdj-tries">
                    {tries} essai{tries > 1 ? "s" : ""}
                  </span>
                  {!inSession && (
                    <button className="mdj-giveup clickable" onClick={giveUp}>
                      <Flag size={12} /> Abandonner
                    </button>
                  )}
                </span>
              </div>
            </section>

          </>
        )}

        <GuessList
          guesses={guesses}
          lastWord={last?.word}
          neighbours={state?.neighbours || 1000}
          team={inSession}
        />
      </div>

      <aside className="mdj-rail">
        {/* La table et ses commandes en tête du rail, au-dessus de l'archive :
            c'est le contexte de la partie en cours, pas une page à part. */}
        {inSession && !done ? (
          <SessionPanel
            session={session}
            busy={busy}
            onInvite={() => setShowInvite(true)}
            onLeave={leaveSession}
          />
        ) : done ? null : (
          <TeamUp
            busy={busy}
            sessions={openSessions}
            onOpen={openSession}
            onJoin={joinSession}
          />
        )}

        {/* Les équipes, juste sous la table du jour : c'est le raccourci de
            demain matin. Elles restent visibles même en session — on peut
            appartenir à deux bandes et changer d'avis. */}
        {!done && (
          <Teams
            teams={state?.teams || []}
            busy={busy}
            currentCode={session?.code}
            onPlay={playWithTeam}
            onRename={renameTeam}
            onLeave={leaveTeam}
          />
        )}

        <button className="mdj-archive-btn clickable" onClick={() => setShowArchive(true)}>
          <span className="mdj-archive-ic">
            <History size={17} />
          </span>
          <span className="mdj-archive-txt">
            Les mots passés
            <em>Leurs anecdotes, et tes résultats</em>
          </span>
          <ArrowRight size={16} />
        </button>

        <section className="mdj-board">
          <header className="mdj-board-head">
            <span className="mdj-board-ic">
              <Crown size={16} />
            </span>
            <h2>Aujourd'hui</h2>
            {state?.stats?.solved > 0 && (
              <span className="mdj-board-count">
                <Users size={12} /> {fmt(state.stats.solved)}
              </span>
            )}
          </header>
          {board === null ? (
            <div className="mdj-state" style={{ minHeight: 110 }}>
              <Loader2 size={18} className="spin" />
            </div>
          ) : board.entries.length === 0 ? (
            <div className="mdj-board-empty">
              <span aria-hidden="true">👑</span>
              <p>Personne n'a encore trouvé.</p>
              <span className="mdj-board-empty-sub">La première place est libre.</span>
            </div>
          ) : (
            <ol className="mdj-board-list">
              {board.entries.map((e, i) => (
                <BoardRow key={`${e.user.id}-${i}`} entry={e} rank={i + 1} />
              ))}
            </ol>
          )}

          {/* Ceux qui cherchent encore. C'est l'information qui manquait le
              plus : jusqu'au soir le classement est vide, alors que la moitié
              du cercle sue sur le même mot. Voir « Marine · 23 essais » quand
              on en est à 12 change tout le sel de la journée — et un compteur
              d'essais ne divulgue évidemment rien du mot. */}
          {board?.searching?.length > 0 && (
            <Searching rows={board.searching} />
          )}

          <p className="mdj-board-note">
            Classé au nombre d'essais, le temps de partie départage. Une équipe compte
            pour une ligne&nbsp;: le total du groupe vaut pour chacun.
          </p>
        </section>

        <p className="mdj-credits">
          Si tu trouve pas t'es vraiment nul·le. GENRE TROP GUEZ.
        </p>
      </aside>

      <Toasts list={toasts} />

      {invitation && (
        <JoinInvite
          data={invitation}
          busy={busy}
          onJoin={() => joinSession(invitation.session.code)}
          onDismiss={() => {
            setInvitation(null);
            setParams({}, { replace: true });
          }}
        />
      )}

      {teamInvite && (
        <TeamInvite
          data={teamInvite}
          busy={busy}
          onJoin={(play) => joinTeam(teamInvite.team.code, { play })}
          onDismiss={() => {
            setTeamInvite(null);
            setParams({}, { replace: true });
          }}
        />
      )}

      {showWin && state && <WinModal state={state} onClose={() => setShowWin(false)} />}
      {showArchive && <ArchiveModal token={token} onClose={() => setShowArchive(false)} />}
      {showInvite && session && (
        <InviteModal
          token={token}
          meId={user?.id}
          session={session}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

// ---------- Le compte à rebours ----------
// Il ne suffit pas d'afficher une durée : le mot bascule à minuit dans le fuseau
// du jeu, qui n'est pas forcément celui du joueur. Un compte à rebours de 8 h à
// 15 h passée est incompréhensible tant qu'on n'a pas dit « minuit à Paris, soit
// 23 h chez toi ».
function Countdown({ ms, tz }) {
  if (ms == null) return <span className="mdj-next" />;
  const city = tz ? tz.split("/").pop().replace(/_/g, " ") : null;
  const at = new Date(Date.now() + ms);
  const localHhmm = at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const shifted = localHhmm !== "00:00";
  return (
    <div className="mdj-next">
      <span className="mdj-next-lbl">
        <Clock size={12} /> Nouveau mot dans
      </span>
      <b className="mdj-next-num">{humanCountdown(ms)}</b>
      <span className="mdj-next-tz">
        minuit{city ? ` à ${city}` : ""}
        {shifted && <> · {localHhmm} chez toi</>}
      </span>
    </div>
  );
}

// ---------- Une pastille de joueur ----------
function Face({ user, size = 26, title }) {
  return user.avatar ? (
    <img
      className="mdj-face"
      src={user.avatar}
      alt={user.username}
      title={title || user.username}
      style={{ width: size, height: size }}
      loading="lazy"
      draggable="false"
    />
  ) : (
    <span
      className="mdj-face letters"
      title={title || user.username}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {user.username[0].toUpperCase()}
    </span>
  );
}

// ---------- Le panneau de session (en tête du rail droit) ----------
// Il vit dans le rail et non au-dessus du plateau : c'est du CONTEXTE, pas du
// jeu. Le champ de saisie et les essais gardent toute la colonne principale —
// et sur mobile, où le rail passe dessous, la partie commence directement par
// l'input au lieu de trois blocs d'explication.
function SessionPanel({ session, busy, onInvite, onLeave }) {
  const [copied, setCopied] = useState(false);
  const actives = (session.members || []).filter((m) => m.active);

  async function copyLink() {
    const url = `${window.location.origin}/mot?s=${session.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  }

  return (
    <section className="mdj-sess">
      <header className="mdj-sess-head">
        <span className="mdj-sess-faces">
          {actives.map((m) => (
            <Face
              key={m.user.id}
              user={m.user}
              size={28}
              title={`${m.user.username}${
                m.broughtTries ? ` · +${m.broughtTries} essais apportés` : ""
              }`}
            />
          ))}
        </span>
        <span className="mdj-sess-txt">
          <b>À {actives.length} sur le même mot</b>
          <em>
            {actives.length > 1
              ? "Chacun propose quand il veut"
              : "Invite quelqu'un, vos essais se cumulent"}
          </em>
        </span>
      </header>

      <div className="mdj-sess-actions">
        <button className="mdj-sess-btn primary clickable" onClick={onInvite}>
          <UserPlus size={14} /> Inviter
        </button>
        <button className="mdj-sess-btn clickable" onClick={copyLink} title="Copier le lien">
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copié" : "Lien"}
        </button>
        <button
          className="mdj-sess-btn ghost clickable"
          onClick={onLeave}
          disabled={busy}
          title="Repartir en solo avec le total d'essais du groupe"
        >
          <LogOut size={14} />
        </button>
      </div>
    </section>
  );
}

// ---------- Les notifications de table ----------
// Une arrivée ou un départ change le total d'essais du groupe : c'est
// l'information la plus lourde de conséquence de la partie, elle mérite mieux
// qu'un rafraîchissement silencieux du rail.
function Toasts({ list }) {
  if (!list.length) return null;
  return createPortal(
    <div className="mdj-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div className={`mdj-toast ${t.kind}`} key={t.id}>
          <Face user={t.user} size={30} />
          <span className="mdj-toast-txt">
            <b>{t.user.username}</b>
            {t.kind === "join" ? (
              <em>
                a rejoint la partie
                {t.tries != null && <> · {t.tries} essais en commun</>}
              </em>
            ) : t.kind === "team" ? (
              <em>
                a lancé la partie{t.teamName ? ` de ${t.teamName}` : " de ton équipe"}
              </em>
            ) : (
              <em>est reparti en solo</em>
            )}
          </span>
          <span className="mdj-toast-ic" aria-hidden="true">
            {t.kind === "join" ? "👋" : t.kind === "team" ? "🎯" : "🚪"}
          </span>
        </div>
      ))}
    </div>,
    document.body
  );
}

// ---------- « X est en train de taper CAR… » ----------
// LE PLAISIR DU MODE À PLUSIEURS EST LÀ : voir une piste se former chez l'autre,
// et parfois se retenir de proposer le même mot.
function Typers({ typers }) {
  const list = Object.values(typers).filter((t) => t.text);
  if (!list.length) return null;
  return (
    <div className="mdj-typers">
      {list.slice(0, 3).map((t) => (
        <span className="mdj-typer" key={t.user.id}>
          <Face user={t.user} size={20} />
          <span className="mdj-typer-name">{t.user.username}</span>
          <span className="mdj-typer-text">
            {t.text.toUpperCase().split("").map((c, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <i key={i}>{c}</i>
            ))}
            <b className="mdj-caret" aria-hidden="true" />
          </span>
        </span>
      ))}
    </div>
  );
}

// ---------- Proposer de jouer à plusieurs ----------
function TeamUp({ busy, sessions, onOpen, onJoin }) {
  return (
    <section className="mdj-teamup">
      <div className="mdj-teamup-head">
        <span className="mdj-teamup-ic">
          <Users size={17} />
        </span>
        <span className="mdj-teamup-txt">
          <b>Chercher à plusieurs</b>
          <em>Vos essais se cumulent, et le mot trouvé compte pour tout le monde.</em>
        </span>
        <button className="mdj-teamup-btn clickable" onClick={onOpen} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />}
          Ouvrir une partie
        </button>
      </div>

      {sessions.length > 0 && (
        <ul className="mdj-teamup-list">
          {sessions.map((s) => (
            <li className="mdj-teamup-row" key={s.code}>
              <span className="mdj-sess-faces">
                {s.players.slice(0, 4).map((p) => (
                  <Face key={p.id} user={p} size={26} />
                ))}
              </span>
              <span className="mdj-teamup-row-txt">
                <b>{s.players.map((p) => p.username).join(", ")}</b>
                <em>
                  {s.tries} essai{s.tries > 1 ? "s" : ""} en commun
                </em>
              </span>
              <button
                className="mdj-teamup-join clickable"
                onClick={() => onJoin(s.code)}
                disabled={busy}
              >
                Rejoindre
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Les équipes permanentes ----------
// La liste des bandes avec qui on cherche. Une session meurt à minuit, une
// équipe non : c'est ici qu'on retrouve les mêmes joueurs le lendemain, sans
// avoir à réinviter personne (cf. models/MotTeam.js).
function Teams({ teams, busy, currentCode, onPlay, onRename, onLeave }) {
  if (!teams.length) return null;
  return (
    <section className="mdj-teams">
      <header className="mdj-teams-head">
        <span className="mdj-teamup-ic">
          <Users size={17} />
        </span>
        <span className="mdj-teamup-txt">
          <b>Tes équipes</b>
          <em>Les mêmes joueurs chaque jour, rien à réinviter.</em>
        </span>
      </header>
      <ul className="mdj-teams-list">
        {teams.map((t) => (
          <TeamRow
            key={t.code}
            team={t}
            busy={busy}
            here={t.session?.code && t.session.code === currentCode}
            onPlay={() => onPlay(t.code)}
            onRename={() => onRename(t.code, t.name)}
            onLeave={() => onLeave(t.code)}
          />
        ))}
      </ul>
    </section>
  );
}

function TeamRow({ team, busy, here, onPlay, onRename, onLeave }) {
  const [copied, setCopied] = useState(false);
  const s = team.session;
  const label =
    team.name ||
    team.members
      .slice(0, 3)
      .map((m) => m.username)
      .join(", ") + (team.members.length > 3 ? ` +${team.members.length - 3}` : "");

  async function copyLink() {
    // LE LIEN DE L'ÉQUIPE, PAS CELUI DE LA PARTIE : il ouvrira encore la partie
    // du jour dans une semaine, alors qu'un lien de session meurt à minuit.
    const url = `${window.location.origin}/mot?t=${team.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  }

  return (
    <li className={`mdj-team ${here ? "here" : ""}`}>
      <span className="mdj-sess-faces">
        {team.members.slice(0, 4).map((m) => (
          <Face key={m.id} user={m} size={26} />
        ))}
      </span>
      <span className="mdj-team-txt">
        <b>{label || "Ton équipe"}</b>
        <em>
          {s?.solved
            ? "A trouvé le mot aujourd'hui"
            : here
              ? `Vous cherchez ensemble · ${s?.tries || 0} essais`
              : s
                ? `${s.players} en train de chercher · ${s.tries} essais`
                : "Personne n'a encore lancé aujourd'hui"}
        </em>
      </span>
      <span className="mdj-team-actions">
        {!s?.solved && !here && (
          <button className="mdj-team-play clickable" onClick={onPlay} disabled={busy}>
            {busy ? (
              <Loader2 size={13} className="spin" />
            ) : s ? (
              <Users size={13} />
            ) : (
              <Play size={13} />
            )}
            {s ? "Rejoindre" : "Lancer"}
          </button>
        )}
        <button
          className="mdj-team-ic clickable"
          onClick={copyLink}
          title="Copier le lien permanent de l'équipe"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />}
        </button>
        <button className="mdj-team-ic clickable" onClick={onRename} title="Renommer">
          <Pencil size={14} />
        </button>
        <button
          className="mdj-team-ic clickable"
          onClick={onLeave}
          disabled={busy}
          title="Quitter l'équipe"
        >
          <LogOut size={14} />
        </button>
      </span>
    </li>
  );
}

// ---------- Arrivée par un lien d'équipe ----------
// Rien à voir avec l'invitation à une session : entrer dans une équipe ne coûte
// AUCUN essai (c'est le carnet d'adresses, pas la table). On présente donc la
// bande, et on laisse le choix entre entrer simplement et jouer tout de suite.
function TeamInvite({ data, busy, onJoin, onDismiss }) {
  const t = data.team;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onDismiss();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  const canPlay = !data.alreadySolved && !t.session?.solved;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div className="mdj-join">
        <span className="mdj-join-glow" aria-hidden="true" />

        <span className="mdj-join-faces">
          {t.members.slice(0, 5).map((m) => (
            <Face key={m.id} user={m} size={54} />
          ))}
        </span>

        <h2 className="mdj-join-title">
          Rejoins l'équipe
          <br />
          {t.name || t.members.map((m) => m.username).join(" & ")}
        </h2>

        <p className="mdj-join-sub">
          Vous chercherez le mot ensemble <b>chaque jour</b>, sans avoir à vous
          réinviter. Entrer dans l'équipe ne coûte aucun essai.
        </p>

        {t.session && !t.session.solved && (
          <p className="mdj-join-warn">
            La partie du jour est déjà lancée&nbsp;: {t.session.players} joueur
            {t.session.players > 1 ? "s" : ""} et {t.session.tries} essai
            {t.session.tries > 1 ? "s" : ""} en commun. Les rejoindre y versera tes{" "}
            {data.myTries || 0} essais.
          </p>
        )}
        {data.alreadySolved && (
          <p className="mdj-join-sub">
            Tu as déjà trouvé le mot aujourd'hui — l'équipe te servira dès demain.
          </p>
        )}

        <div className="mdj-join-actions">
          {canPlay && (
            <button
              className="mdj-join-yes clickable"
              onClick={() => onJoin(true)}
              disabled={busy}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <Users size={15} />}
              {t.session ? "Rejoindre la partie" : "Entrer et lancer la partie"}
            </button>
          )}
          <button
            className="mdj-join-no clickable"
            onClick={() => onJoin(false)}
            disabled={busy}
          >
            Entrer dans l'équipe seulement
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- Arrivée par un lien : on annonce le prix à payer ----------
// Rejoindre verse ses essais solo au pot commun, et c'est irréversible. Le
// joueur doit le savoir AVANT de cliquer, pas après.
function JoinInvite({ data, busy, onJoin, onDismiss }) {
  const s = data.session;
  const actives = (s.members || []).filter((m) => m.active);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onDismiss();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}
    >
      <div className="mdj-join">
        <span className="mdj-join-glow" aria-hidden="true" />

        <span className="mdj-join-faces">
          {actives.slice(0, 5).map((m) => (
            <Face key={m.user.id} user={m.user} size={54} />
          ))}
        </span>

        <h2 className="mdj-join-title">
          {s.host?.username} t'invite
          <br />à chercher le mot du jour
        </h2>

        {data.alreadySolved ? (
          <p className="mdj-join-sub">
            Mais tu as déjà trouvé le mot aujourd'hui — trop tard pour les rejoindre.
          </p>
        ) : s.solved ? (
          <p className="mdj-join-sub">Ils ont déjà trouvé le mot. La partie est close.</p>
        ) : (
          <>
            <p className="mdj-join-sub">
              {actives.length} joueur{actives.length > 1 ? "s" : ""} en train de chercher.
            </p>

            {/* Le prix à payer, annoncé AVANT le clic : entrer verse ses essais
                solo au pot commun, et c'est irréversible. */}
            <div className="mdj-join-math">
              <span className="mdj-join-n">
                <b>{s.tries}</b>
                <em>leurs essais</em>
              </span>
              <span className="mdj-join-plus" aria-hidden="true">
                +
              </span>
              <span className="mdj-join-n">
                <b>{data.myTries || 0}</b>
                <em>les tiens</em>
              </span>
              <span className="mdj-join-plus" aria-hidden="true">
                =
              </span>
              <span className="mdj-join-n total">
                <b>{s.tries + (data.myTries || 0)}</b>
                <em>en commun</em>
              </span>
            </div>
            <p className="mdj-join-warn">
              Vos essais fusionnent définitivement. Si vous trouvez le mot, il comptera
              pour chacun de vous.
            </p>
          </>
        )}

        <div className="mdj-join-actions">
          {data.canJoin && (
            <button className="mdj-join-yes clickable" onClick={onJoin} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Users size={15} />}
              Rejoindre la partie
            </button>
          )}
          <button className="mdj-join-no clickable" onClick={onDismiss}>
            {data.canJoin ? "Continuer en solo" : "Fermer"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- Le panneau du dernier essai ----------
function Hero({ last, neighbours, meId }) {
  if (!last) {
    return (
      <div className="mdj-hero empty">
        <HeatTrack temp={0} />
        <p className="mdj-hero-hint">
          Ton essai s'affichera ici, avec sa température et son rang.
        </p>
      </div>
    );
  }

  const band = last.win ? "bouillant" : bandOf(last.temp);
  const b = BANDS[band];
  const hot = last.temp >= FLAME_AT;
  // On ne s'annonce pas à soi-même : l'auteur ne s'affiche que si c'est
  // quelqu'un d'autre (un doublon renvoie aussi l'auteur, qui peut être moi).
  const author = last.by && last.by.id !== meId ? last.by : null;

  return (
    <div className={`mdj-hero b-${band} ${last.win ? "win" : ""} ${hot ? "hot" : ""}`}>
      {/* Les flammes se rejouent à chaque essai brûlant : la clé change avec le
          mot, donc React remonte les nœuds et relance l'animation. */}
      {hot && (
        <span className="mdj-flames" aria-hidden="true" key={last.word}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ "--i": i }}>
              🔥
            </i>
          ))}
        </span>
      )}

      <div className="mdj-hero-top">
        <span className="mdj-hero-emoji" aria-hidden="true">
          {last.win ? "🎉" : b.emoji}
        </span>
        <span className="mdj-hero-id">
          <b className="mdj-hero-word">{last.word}</b>
          {/* L'auteur, quand ce n'est pas moi : le panneau montre le dernier
              essai de LA TABLE, il faut savoir de qui il vient. */}
          {author ? (
            <em className="mdj-hero-by">
              <Face user={author} size={18} /> {author.username}
              <span className="mdj-hero-sep">·</span>
              {last.win ? "a trouvé !" : b.cheer}
            </em>
          ) : (
            <em className="mdj-hero-cheer">
              {last.win ? "C'est le mot du jour !" : last.again ? "Déjà proposé" : b.cheer}
            </em>
          )}
        </span>
        <span className="mdj-hero-num">
          {last.temp}
          <sup>°</sup>
        </span>
      </div>

      <HeatTrack temp={last.temp} />

      <div className="mdj-hero-rank">
        {last.win ? (
          <span className="mdj-hero-rank-in">Trouvé</span>
        ) : last.rank ? (
          <span className="mdj-hero-rank-in">
            <Target size={12} /> {last.rank}
            <sup>e</sup> mot le plus proche
          </span>
        ) : (
          <span className="mdj-hero-rank-out">
            Hors des {fmt(neighbours)} mots les plus proches
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- La jauge de chaleur ----------
// Une piste horizontale plutôt qu'une colonne de mercure : elle se lit dans le
// même mouvement que la ligne de saisie juste au-dessus, tient sur toute la
// largeur (donc les paliers sont nommés) et ne mange pas 250 px au-dessus de la
// liste des essais.
function HeatTrack({ temp }) {
  const pos = Math.min(100, Math.max(0, temp));
  return (
    <div className="mdj-track">
      <div className="mdj-track-rail" aria-hidden="true">
        <span className="mdj-track-fill" style={{ width: `${pos}%` }} />
        <span className="mdj-track-head" style={{ left: `${pos}%` }} />
      </div>
      <div className="mdj-track-zones" aria-hidden="true">
        {BAND_ORDER.map((k) => (
          <span key={k} className={`mdj-track-zone ${bandOf(temp) === k ? "on" : ""}`}>
            <i>{BANDS[k].emoji}</i>
            {BANDS[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Fin de partie ----------
function Reveal({ state, onShowWin }) {
  return (
    <section className={`mdj-reveal ${state.solved ? "won" : "lost"}`}>
      <span className="mdj-reveal-emoji" aria-hidden="true">
        {state.solved ? "🎉" : "🏳️"}
      </span>
      <span className="mdj-reveal-kicker">
        {state.solved
          ? `Trouvé en ${state.tries} essai${state.tries > 1 ? "s" : ""} · ${humanTime(
              state.timeMs
            )}`
          : "Abandonné · le mot était"}
      </span>
      <h2 className="mdj-reveal-word">{state.word}</h2>
      {state.solved && (
        <span className="mdj-reveal-score">
          <Sparkles size={15} /> +{fmt(state.score)} points
        </span>
      )}
      <button className="mdj-reveal-more clickable" onClick={onShowWin}>
        <Gamepad2 size={14} /> Revoir l'anecdote du jour
      </button>
    </section>
  );
}

// ---------- La liste des essais ----------
// Triée du plus chaud au plus froid, et NUMÉROTÉE : le numéro n'est pas le rang
// du dictionnaire (colonne de droite) mais la place dans la liste — on voit d'un
// coup combien de mots sont déjà passés au-dessus du dernier.
//
// À plusieurs, chaque ligne porte la tête de son auteur : savoir QUI a trouvé la
// bonne piste fait la moitié du plaisir.
function GuessList({ guesses, lastWord, neighbours, team }) {
  const sorted = useMemo(() => [...guesses].sort((a, b) => b.temp - a.temp), [guesses]);
  if (!sorted.length) return null;
  return (
    <section className="mdj-list">
      <header className="mdj-list-head">
        <h2>
          {team ? "Les essais de l'équipe" : "Tes essais"} <em>{sorted.length}</em>
        </h2>
        <span className="mdj-list-hint">
          Le rang n'apparaît que pour les {fmt(neighbours)} mots les plus proches
        </span>
      </header>
      <ol className={`mdj-list-rows ${team ? "team" : ""}`}>
        {sorted.map((g, i) => {
          const band = bandOf(g.temp);
          return (
            <li
              key={g.word}
              className={`mdj-row b-${band} ${g.word === lastWord ? "just" : ""} ${
                g.temp >= 100 ? "win" : ""
              }`}
            >
              <span className="mdj-row-pos">{i + 1}</span>
              <span className="mdj-row-emoji" aria-hidden="true">
                {BANDS[band].emoji}
              </span>
              <span className="mdj-row-word">{g.word}</span>
              {team && (
                <span className="mdj-row-by">
                  {g.by ? (
                    <>
                      <Face user={g.by} size={20} />
                      <span className="mdj-row-by-name">{g.by.username}</span>
                    </>
                  ) : null}
                </span>
              )}
              <span className="mdj-row-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, g.temp)}%` }} />
              </span>
              <span className="mdj-row-rank">
                {/* Le mot du jour a un rang de 0 (c'est la cible elle-même) :
                    afficher « #0 » ou « — » serait absurde, on marque la trouvaille. */}
                {g.temp >= 100 ? <b>★</b> : g.rank ? <>#{g.rank}</> : <em>—</em>}
              </span>
              <span className="mdj-row-temp">{g.temp}°</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- Une ligne du classement du jour ----------
// Une victoire à plusieurs occupe UNE ligne, avec toutes les têtes côte à côte :
// c'est l'équipe qui a trouvé, pas trois joueurs qui auraient fait pareil.
function BoardRow({ entry, rank }) {
  const team = entry.team || [entry.user];
  const solo = team.length <= 1;
  return (
    <li className={`mdj-board-row ${entry.isMe ? "me" : ""} ${solo ? "" : "team"}`}>
      <span className={`mdj-rank r${rank}`}>{rank}</span>
      {solo ? (
        <Link to={`/u/${entry.user.username}`} className="mdj-board-user clickable">
          <Face user={entry.user} size={25} />
          <span className="mdj-board-who">{entry.user.username}</span>
        </Link>
      ) : (
        <span className="mdj-board-user team">
          <span className="mdj-sess-faces">
            {team.slice(0, 4).map((u) => (
              <Face key={u.id} user={u} size={25} />
            ))}
          </span>
          <span className="mdj-board-who">
            {team.length > 2
              ? `${team[0].username} +${team.length - 1}`
              : team.map((u) => u.username).join(" & ")}
          </span>
        </span>
      )}
      <span
        className="mdj-board-tries"
        title={`${entry.tries} essais en ${humanTime(entry.timeMs)} · ${fmt(
          entry.score
        )} points`}
      >
        {entry.tries}
      </span>
    </li>
  );
}

// ---------- Ceux qui cherchent encore ----------
// Volontairement SOUS le classement et sans numéro : ce n'est pas un palmarès,
// personne n'a fini. C'est l'état de la course, et son seul chiffre est le
// nombre d'essais brûlés — qui ne dit rien du mot, seulement de la peine.
function Searching({ rows }) {
  return (
    <div className="mdj-live">
      <h3 className="mdj-live-head">
        <Hourglass size={12} /> En train de chercher
      </h3>
      <ul className="mdj-live-list">
        {rows.map((r, i) => {
          const solo = (r.team || []).length <= 1;
          return (
            <li
              className={`mdj-live-row ${r.isMe ? "me" : ""} ${r.gaveUp ? "out" : ""}`}
              // Une table en cours n'a pas d'identifiant propre côté client :
              // la première tête suffit à distinguer les lignes.
              key={`${r.user.id}-${i}`}
            >
              {solo ? (
                <Link to={`/u/${r.user.username}`} className="mdj-live-who clickable">
                  <Face user={r.user} size={22} />
                  <span>{r.user.username}</span>
                </Link>
              ) : (
                <span className="mdj-live-who team">
                  <span className="mdj-sess-faces">
                    {r.team.slice(0, 3).map((u) => (
                      <Face key={u.id} user={u} size={22} />
                    ))}
                  </span>
                  <span>
                    {r.team.length > 2
                      ? `${r.team[0].username} +${r.team.length - 1}`
                      : r.team.map((u) => u.username).join(" & ")}
                  </span>
                </span>
              )}
              <span className="mdj-live-tries">
                {r.gaveUp ? "abandon" : `${r.tries} essai${r.tries > 1 ? "s" : ""}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Inviter des joueurs ----------
// DEUX DESTINATIONS, un seul geste : des personnes (carte en message privé) et
// des GROUPES de discussion (carte dans le fil commun). Inviter les cinq
// personnes d'un groupe une par une, c'était cinq messages privés pour une
// seule partie, et cinq endroits où répondre — alors que le groupe existe déjà.
//
// Inviter constitue aussi l'ÉQUIPE : les invités du jour sont les coéquipiers
// de demain, et le lien affiché ici devient permanent dès qu'elle existe.
function InviteModal({ token, meId, session, onClose }) {
  const [people, setPeople] = useState(null);
  const [groups, setGroups] = useState([]);
  // Une seule sélection pour les deux listes, préfixée : « u:<id> » pour une
  // personne, « g:<id> » pour un groupe.
  const [picked, setPicked] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState("");
  const [team, setTeam] = useState(session.team || null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // On ne peut écrire qu'à ses abonnés (règle de la messagerie) : ce sont eux
    // qu'on propose. Pour les autres, il y a le lien.
    // Les membres déjà à la table sont retirés de la liste.
    const already = new Set(
      (session.members || []).filter((m) => m.active).map((m) => m.user.id)
    );
    if (!meId) {
      setPeople([]);
      return undefined;
    }
    apiFetch(`/users/${meId}/followers`, { token })
      .then((d) => setPeople((d.users || []).filter((u) => !already.has(u.id))))
      .catch(() => setPeople([]));
    // Les groupes viennent de la messagerie : ce sont ceux où j'écris déjà.
    // Les conversations « virtuelles » (un abonné sans fil ouvert) n'en sont
    // pas, elles n'ont pas d'identifiant en base — d'où le filtre.
    apiFetch("/chat/conversations", { token })
      .then((d) =>
        setGroups((d.conversations || []).filter((c) => c.isGroup && !c.virtual))
      )
      .catch(() => setGroups([]));
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, token, meId, session.members]);

  function toggle(key) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function send() {
    if (!picked.size || sending) return;
    setSending(true);
    try {
      const keys = [...picked];
      const d = await apiFetch(`/mot/session/${session.code}/invite`, {
        method: "POST",
        token,
        body: {
          userIds: keys.filter((k) => k.startsWith("u:")).map((k) => k.slice(2)),
          conversationIds: keys.filter((k) => k.startsWith("g:")).map((k) => k.slice(2)),
        },
      });
      const bits = [];
      if (d.sent.length) bits.push(`${d.sent.length} joueur${d.sent.length > 1 ? "s" : ""}`);
      if (d.groups?.length)
        bits.push(`${d.groups.length} groupe${d.groups.length > 1 ? "s" : ""}`);
      setDone(
        bits.length
          ? `Invitation envoyée à ${bits.join(" et ")}.`
          : "Personne n'a pu être prévenu — partage le lien."
      );
      if (d.team) setTeam(d.team);
      setPicked(new Set());
    } catch (e) {
      setDone(e.message);
    } finally {
      setSending(false);
    }
  }

  // Dès qu'une équipe existe, c'est SON lien qu'on partage : il ouvrira encore
  // la partie du jour dans une semaine, là où un lien de session meurt à minuit.
  const link = team
    ? `${window.location.origin}/mot?t=${team.code}`
    : `${window.location.origin}/mot?s=${session.code}`;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mdj-inv">
        <div className="mdj-inv-head">
          <h2>
            <UserPlus size={18} /> Inviter à la partie
          </h2>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>

        <div className="mdj-inv-body">
          <label className="mdj-inv-link">
            <span>{team ? "Lien permanent de l'équipe" : "Lien de la partie"}</span>
            <input value={link} readOnly onFocus={(e) => e.target.select()} />
          </label>

          <p className="mdj-inv-note">
            {team
              ? "Ce lien ne périme pas : il ouvre la partie du jour, aujourd'hui comme dans un mois."
              : "L'invitation par message ne part qu'à tes abonnés. Pour les autres, le lien suffit — il ouvre la partie après connexion."}
          </p>

          {groups.length > 0 && (
            <>
              <h3 className="mdj-inv-sub">
                <MessagesSquare size={13} /> Tes groupes
              </h3>
              <ul className="mdj-inv-list">
                {groups.map((g) => {
                  const key = `g:${g.id}`;
                  return (
                    <li key={g.id}>
                      <button
                        className={`mdj-inv-row clickable ${picked.has(key) ? "on" : ""}`}
                        onClick={() => toggle(key)}
                      >
                        {g.avatar ? (
                          <img
                            className="mdj-face"
                            src={g.avatar}
                            alt=""
                            style={{ width: 30, height: 30 }}
                            loading="lazy"
                            draggable="false"
                          />
                        ) : (
                          <span
                            className="mdj-face letters"
                            style={{ width: 30, height: 30, fontSize: 13 }}
                          >
                            <MessagesSquare size={14} />
                          </span>
                        )}
                        <span className="mdj-inv-name">
                          {g.title}
                          <em>
                            {g.participants.length} membre
                            {g.participants.length > 1 ? "s" : ""}
                          </em>
                        </span>
                        {picked.has(key) && <Check size={16} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {people === null ? (
            <div className="mdj-state" style={{ minHeight: 90 }}>
              <Loader2 size={18} className="spin" />
            </div>
          ) : people.length === 0 ? (
            <p className="mdj-inv-empty">
              Personne à qui écrire pour l'instant — partage le lien.
            </p>
          ) : (
            <>
              {groups.length > 0 && (
                <h3 className="mdj-inv-sub">
                  <Users size={13} /> Une par une
                </h3>
              )}
              <ul className="mdj-inv-list">
                {people.map((p) => {
                  const key = `u:${p.id}`;
                  return (
                    <li key={p.id}>
                      <button
                        className={`mdj-inv-row clickable ${picked.has(key) ? "on" : ""}`}
                        onClick={() => toggle(key)}
                      >
                        <Face user={p} size={30} />
                        <span className="mdj-inv-name">{p.username}</span>
                        {picked.has(key) && <Check size={16} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {done && <p className="mdj-inv-done">{done}</p>}
        </div>

        <div className="mdj-inv-foot">
          <span className="mdj-inv-foot-note">
            Les invités deviennent ton équipe&nbsp;: demain, un clic suffira.
          </span>
          <button
            className="mdj-win-btn clickable"
            onClick={send}
            disabled={!picked.size || sending}
          >
            {sending ? <Loader2 size={15} className="spin" /> : null} Envoyer
            {picked.size > 0 ? ` (${picked.size})` : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- La modale de fin : le mot, le score, l'anecdote ----------
function WinModal({ state, onClose }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const a = state.anecdote;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`mdj-win ${state.solved ? "won" : "lost"}`}>
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        {state.solved && (
          <span className="mdj-win-flames" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <i key={i} style={{ "--i": i }}>
                🎉
              </i>
            ))}
          </span>
        )}

        <div className="mdj-win-top">
          <span className="mdj-win-kicker">
            {state.solved
              ? `Trouvé en ${state.tries} essai${state.tries > 1 ? "s" : ""} · ${humanTime(
                  state.timeMs
                )}`
              : "Le mot était"}
          </span>
          <h2 className="mdj-win-word">{state.word}</h2>
          {state.solved && (
            <span className="mdj-win-score">
              <Sparkles size={15} /> +{fmt(state.score)} points
            </span>
          )}
        </div>

        <div className="mdj-anecdote">
          <span className="mdj-anecdote-lead">En parlant de « {state.word} »…</span>
          {a?.pending ? (
            <p className="mdj-anecdote-pending">
              <Loader2 size={14} className="spin" /> L'anecdote du jour se prépare —
              repasse dans un instant.
            </p>
          ) : a?.text ? (
            <>
              {a.title && <h3 className="mdj-anecdote-title">{a.title}</h3>}
              <p className="mdj-anecdote-text">{a.text}</p>
              {a.game && <GameChip game={a.game} />}
            </>
          ) : (
            <p className="mdj-anecdote-pending">Pas d'anecdote pour ce mot-ci. À demain&nbsp;!</p>
          )}
        </div>

        <div className="mdj-win-actions">
          <Link to="/arcade" className="mdj-win-btn ghost clickable">
            Retour à l'arcade
          </Link>
          <button className="mdj-win-btn clickable" onClick={onClose}>
            Voir les essais
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function GameChip({ game }) {
  const inner = (
    <>
      {game.cover ? (
        <img src={game.cover} alt="" loading="lazy" draggable="false" />
      ) : (
        <span className="mdj-chip-noart">
          <Gamepad2 size={18} />
        </span>
      )}
      <span className="mdj-chip-txt">
        <b>{game.name}</b>
        {game.year && <em>{game.year}</em>}
      </span>
      {game.igdbId && <ArrowRight size={15} className="mdj-chip-arrow" />}
    </>
  );
  return game.igdbId ? (
    <Link to={`/game/${game.igdbId}`} className="mdj-chip clickable">
      {inner}
    </Link>
  ) : (
    <span className="mdj-chip static">{inner}</span>
  );
}

// ---------- L'archive ----------
function ArchiveModal({ token, onClose }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    apiFetch("/mot/archive", { token })
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]));
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, token]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mdj-arch">
        <div className="mdj-arch-head">
          <h2>
            <History size={18} /> Les mots passés
          </h2>
          <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        <div className="mdj-arch-body">
          {entries === null ? (
            <div className="mdj-state">
              <Loader2 size={20} className="spin" />
            </div>
          ) : entries.length === 0 ? (
            <p className="mdj-arch-empty">
              Rien encore — le premier mot rejoindra l'archive demain.
            </p>
          ) : (
            <ul className="mdj-arch-list">
              {entries.map((e) => (
                <li className="mdj-arch-item" key={e.date}>
                  <div className="mdj-arch-day">
                    <span className="mdj-arch-date">
                      {new Date(`${e.date}T12:00:00`).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "long",
                      })}
                    </span>
                    <b className="mdj-arch-word">{e.word}</b>
                    {e.me?.solved ? (
                      <span className="mdj-arch-me ok">
                        <Trophy size={12} /> {e.me.tries} essais
                      </span>
                    ) : e.me ? (
                      <span className="mdj-arch-me ko">abandonné</span>
                    ) : (
                      <span className="mdj-arch-me none">pas joué</span>
                    )}
                  </div>
                  {e.anecdote?.text && (
                    <div className="mdj-arch-anec">
                      <p>{e.anecdote.text}</p>
                      {e.anecdote.game && <GameChip game={e.anecdote.game} />}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
