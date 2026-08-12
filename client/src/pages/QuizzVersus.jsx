import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Check,
  Copy,
  Crown,
  Flame,
  Gamepad2,
  Grid2x2,
  Keyboard,
  Layers,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Shuffle,
  Smile,
  Swords,
  Trophy,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { useLiveStatus } from "../lib/presence";
import { useGameSfx } from "../lib/useGameSfx";
import { triesFor, typeHint } from "../lib/quizGame";
import QuizRound from "../components/quiz/QuizRound";
import QuizTimer from "../components/quiz/QuizTimer";
import { VersusFace, VersusRail, VersusInvite, hueOf } from "../components/VersusRoom";
import GameChat from "../components/GameChat";

// ======================================================================
//  Le Grand Quiz — le plateau à plusieurs
// ======================================================================
// Le quatrième salon de versus du site, et il reprend sans discuter tout ce
// que les trois autres ont mis au point : le rail de joueurs, la carte
// d'invitation, les phases pilotées par une horloge SERVEUR (personne n'a à
// cliquer « suivant », et une partie survit à un onglet fermé).
//
// Deux choses lui sont propres, et ce sont elles qui changent l'ergonomie :
//
// 1. ON NE JOUE PAS DEUX MANCHES DE SUITE DE LA MÊME FAÇON. D'où l'annonce
//    d'épreuve pendant le « cue », qui est ici une nécessité et pas une
//    politesse : arriver sur un duel de cartes sans avoir vu qu'on jouait au
//    duel, c'est une manche perdue.
//
// 2. LE BUZZER N'EST PAS UNIVERSEL. Sur un QCM ou des emojis, le premier qui
//    trouve clôt la manche. Sur le studio, le duel et le tri, tout le monde
//    travaille jusqu'à la sonnerie et marque au prorata. Le serveur tranche
//    (`round.mode`), le client se contente d'afficher la bonne consigne — mais
//    il DOIT l'afficher, sinon on ne sait pas s'il faut se dépêcher.
//
// Ce que le client ne fait JAMAIS ici, contrairement au solo : corriger. La
// solution n'arrive qu'à la révélation. `onAttempt` poste au serveur et rend
// sa réponse — c'est tout.

// Les mêmes icônes qu'à l'accueil : le salon doit avoir l'air de la même
// application que la page d'où l'on vient.
const TYPE_ICONS = {
  qcm: ListChecks,
  emoji: Smile,
  studio: Building2,
  duel: Swords,
  pixel: Grid2x2,
  swipe: Layers,
  anagram: Shuffle,
  motus: Keyboard,
};

export default function QuizzVersus() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();
  const sfx = useGameSfx();

  const [room, setRoom] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ranking, setRanking] = useState(null);
  // Progression des autres pendant une manche parallèle (« 12 cartes »).
  const [progress, setProgress] = useState({});
  const [flash, setFlash] = useState(null);
  const [nowTick, setNowTick] = useState(0);

  const meId = String(user?._id || user?.id || "");
  const roomRef = useRef(null);
  roomRef.current = room;

  // Décalage entre l'horloge du serveur et celle du navigateur. Sans lui, un
  // client dont la pendule avance de dix secondes verrait tous les chronos à
  // zéro. Mesuré à chaque réception (`room.now`).
  const skewRef = useRef(0);

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (r.now) skewRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  const players = useMemo(() => room?.players || [], [room]);
  const me = players.find((p) => p.isMe) || null;
  const hueById = useMemo(
    () => new Map(players.filter((p) => !p.left).map((p, i) => [p.id, hueOf(i)])),
    [players]
  );

  useLiveStatus("quiz", room?.started ? `plateau ${room.index + 1}/${room.roundCount}` : "salon", {
    token,
  });

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted, sfx]);

  useEffect(() => {
    document.body.classList.add("bt-immersive");
    return () => document.body.classList.remove("bt-immersive");
  }, []);

  // Le contexte audio ne peut naître que dans un geste : on l'attrape au
  // premier clic ou à la première touche, quel qu'il soit.
  useEffect(() => {
    const wake = () => sfx.resume();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [sfx]);

  // Une horloge locale à 10 Hz : c'est elle qui fait descendre le chrono et
  // avancer le masque des emojis entre deux messages du serveur.
  useEffect(() => {
    if (phase !== "round" && phase !== "cue") return undefined;
    const iv = setInterval(() => setNowTick((n) => n + 1), 100);
    return () => clearInterval(iv);
  }, [phase]);

  // ---------- Chargement ----------
  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/quiz/versus/${code}`, { token });
      applyRoom(d.room);
      if (d.candidates) setCandidates(d.candidates);
      setErr("");
      if (!d.member && d.room && !d.room.started && !d.room.endedAt) {
        const j = await apiFetch(`/quiz/versus/${code}/join`, { method: "POST", token });
        applyRoom(j.room);
      }
    } catch (e) {
      setErr(e.message || "Plateau introuvable.");
    } finally {
      setLoading(false);
    }
  }, [code, token, applyRoom]);

  useEffect(() => {
    if (token && code) load();
  }, [token, code, load]);

  // La liste de recherche ne voyage que dans la réponse à /start, que seul
  // l'hôte reçoit. Sans ce rattrapage, les invités jouent les épreuves à
  // saisie libre sans suggestions. (Même correctif que les trois autres
  // salons, où le défaut avait été trouvé en jouant.)
  useEffect(() => {
    if (!token || !code) return undefined;
    if (!room?.started || phase === "done" || candidates.length) return undefined;
    let alive = true;
    apiFetch(`/quiz/versus/${code}`, { token })
      .then((d) => {
        if (alive && d.candidates?.length) setCandidates(d.candidates);
      })
      .catch(() => {
        /* on réessaiera au prochain changement de phase */
      });
    return () => {
      alive = false;
    };
  }, [token, code, room?.started, phase, candidates.length]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "quizversus" || data?.code !== code) return;
      if (data.room) applyRoom(data.room);

      switch (data.kind) {
        case "cue":
          setProgress({});
          setFlash(null);
          sfx.play("start");
          break;
        case "go":
          sfx.play("hint");
          break;
        case "answer":
          // En buzzer, on annonce qui a bien répondu et avec quoi : voir les
          // fausses pistes des autres fait partie du mode. En parallèle, le
          // serveur n'envoie rien du contenu, donc on n'a rien à dire non plus.
          if (data.buzzer) {
            if (data.correct && data.by !== meId) sfx.play("wrong");
            if (data.label)
              setFlash({
                by: data.by,
                label: data.correct ? "a trouvé !" : data.label,
                correct: data.correct,
              });
          }
          break;
        case "progress":
          setProgress((p) => ({ ...p, [data.by]: data.done }));
          break;
        // Quelqu'un a rendu une copie parfaite : le chrono vient d'être
        // raccourci pour tout le monde. Il FAUT le dire — sinon le temps
        // restant fond d'un coup sans explication et ça passe pour un bug.
        case "stretch":
          setFlash({ by: data.by, label: "a terminé ! Dernière ligne droite", correct: true });
          sfx.play("tick-hot");
          break;
        case "joker":
          sfx.play("hint");
          break;
        case "reveal":
          sfx.play(data.room?.round?.results?.find((r) => r.userId === meId)?.correct ? "correct" : "wrong");
          break;
        case "done":
          setRanking(data.ranking || []);
          sfx.play("finish");
          break;
        case "closed":
          setErr("L'hôte a fermé le plateau.");
          break;
        default:
          break;
      }
    });
  }, [subscribe, code, applyRoom, meId, sfx]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  // ---------- Chrono commun ----------
  // Toutes les horloges partent de `phaseEndsAt`, une date SERVEUR : c'est ce
  // qui garantit que les six écrans affichent la même seconde.
  const serverNow = Date.now() + skewRef.current;
  const durationMs = (round?.durationSec || 20) * 1000;
  const msLeft = room?.phaseEndsAt ? Math.max(0, room.phaseEndsAt - serverNow) : 0;
  const cueLeft = room?.phaseStartsAt ? Math.max(0, room.phaseStartsAt - serverNow) : 0;
  const elapsedMs = phase === "round" ? Math.max(0, durationMs - msLeft) : 0;
  const secondsLeft = Math.ceil(msLeft / 1000);
  // `nowTick` n'est pas lu, mais il force le recalcul du chrono à 10 Hz : sans
  // cette dépendance, l'affichage ne bougerait qu'à l'arrivée d'un message.
  void nowTick;

  // ---------- Actions ----------
  const call = useCallback(
    async (path, body, method = "POST") => {
      setBusy(true);
      try {
        const d = await apiFetch(`/quiz/versus/${code}${path}`, { method, token, body });
        if (d.room) applyRoom(d.room);
        if (d.candidates) setCandidates(d.candidates);
        setErr("");
        return d;
      } catch (e) {
        setErr(e.message || "Erreur.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [code, token, applyRoom]
  );

  // La tentative : ici, c'est le SERVEUR qui corrige (cf. l'en-tête).
  const attempt = useCallback(
    async (given) => {
      try {
        const d = await apiFetch(`/quiz/versus/${code}/answer`, {
          method: "POST",
          token,
          body: { given },
        });
        if (d.correct) sfx.play("correct");
        return d;
      } catch (e) {
        // Une manche déjà close ou un doublon : on le dit sans casser l'épreuve.
        setErr(e.message || "Réponse non enregistrée.");
        return { correct: false, settled: true, lives: 0 };
      }
    },
    [code, token, sfx]
  );

  const useJoker = useCallback(async () => {
    try {
      return await apiFetch(`/quiz/versus/${code}/joker`, { method: "POST", token });
    } catch (e) {
      setErr(e.message || "Joker indisponible.");
      return null;
    }
  }, [code, token]);

  // Diffusion de l'avancement pendant une manche parallèle. Volontairement
  // étranglée : sans ça, un tri de vingt-quatre cartes enverrait vingt-quatre
  // requêtes en trente secondes, par joueur.
  const lastProgressRef = useRef(0);
  const sendProgress = useCallback(
    (done) => {
      const now = Date.now();
      if (now - lastProgressRef.current < 700) return;
      lastProgressRef.current = now;
      apiFetch(`/quiz/versus/${code}/progress`, {
        method: "POST",
        token,
        body: { done },
      }).catch(() => {});
    },
    [code, token]
  );

  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/quiz/versus/${code}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {}
    );
  }

  const leave = useCallback(async () => {
    await apiFetch(`/quiz/versus/${code}/leave`, { method: "POST", token }).catch(() => {});
    navigate("/arcade");
  }, [code, token, navigate]);

  // ---------- Rendu ----------
  if (loading) {
    return (
      <div className="qz-page qzv">
        <div className="qz-loading">
          <Loader2 size={32} className="spin" />
          <p>On ouvre le plateau…</p>
        </div>
      </div>
    );
  }

  if (err && !room) {
    return (
      <div className="qz-page qzv">
        <div className="qz-loading qz-err">
          <p>{err}</p>
          <Link to="/arcade" className="qz-ghost clickable">
            Retour à l'arcade
          </Link>
        </div>
      </div>
    );
  }

  const active = players.filter((p) => !p.left);
  const settledById = round?.settledById || {};
  const iAmSettled = !!settledById[meId];
  const isBuzzer = (round?.mode || "buzzer") === "buzzer";
  // Essais autorisés sur l'épreuve en cours (miroir d'attemptsAllowed côté
  // serveur) : c'est lui qui dimensionne les cœurs du rail.
  const maxTries = round ? triesFor(round.type) : 3;

  // ---------- Rendre sa copie AVANT la sonnerie ----------
  // Sur une manche parallèle (le studio, le duel, le tri), la copie n'est
  // envoyée qu'une fois, et c'est le composant qui la déclenche en réaction à
  // `locked`. Or ici c'est le SERVEUR qui referme la manche à `phaseEndsAt` :
  // si on attendait sa notification pour verrouiller, l'envoi partirait après
  // le dépouillement et serait refusé — trente secondes de tri perdues.
  //
  // On gèle donc l'épreuve un peu avant l'heure. Ça coûte la dernière carte, ce
  // qui est très largement préférable à perdre la manche entière. Les manches
  // au buzzer ne sont pas concernées : elles envoient à chaque essai.
  const FLUSH_MS = 900;
  const nearEnd = phase === "round" && !isBuzzer && msLeft <= FLUSH_MS;

  return (
    <div className={`qz-page qzv ${phase === "round" ? "in-game" : ""}`}>
      <header className="qz-topbar">
        <button type="button" className="qz-back clickable" onClick={leave}>
          <ArrowLeft size={17} /> <span>Quitter</span>
        </button>
        <div className="qz-brand">
          <Trophy size={17} /> Plateau · <code>{code}</code>
        </div>
        <button
          type="button"
          className="qz-vol-btn clickable"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Réactiver les sons" : "Couper les sons"}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
      </header>

      <div className="qz-body">
        {err && room && <p className="qzv-err">{err}</p>}

        {/* ---------------- LE SALON ---------------- */}
        {phase === "lobby" && (
          <Lobby
            room={room}
            active={active}
            hueById={hueById}
            busy={busy}
            copied={copied}
            onCopy={copyLink}
            onInvite={() => setShowInvite(true)}
            onReady={(v) => call("/ready", { ready: v })}
            maxPlayers={room.maxPlayers || 6}
            onSettings={(body) => call("/settings", body)}
            onStart={() => call("/start", {})}
            me={me}
          />
        )}

        {/* ---------------- LA PARTIE ---------------- */}
        {(phase === "cue" || phase === "round" || phase === "reveal") && round && (
          <div className="qz-play qzv-play" data-qz-type={round.type}>
            <div className="qz-play-head">
              {/* Comme en solo : les manches franchies restent colorées. */}
              <div className="qz-pips" aria-hidden="true">
                {Array.from({ length: room.roundCount }).map((_, i) => (
                  <i
                    key={i}
                    className={i < room.index ? "done" : i === room.index ? "cur" : ""}
                    data-qz-type={i <= room.index ? round.type : undefined}
                  />
                ))}
              </div>
              <span className="qz-round-count">
                Épreuve <b>{room.index + 1}</b>
                <em>/ {room.roundCount}</em>
              </span>
              <span className="qz-head-right">
                <span className="qz-live-score">
                  <Trophy size={14} /> {me?.score ?? 0} pts
                  {me?.streak > 1 && (
                    <b className="qzv-streak">
                      <Flame size={12} /> ×{me.streak}
                    </b>
                  )}
                </span>
                <QuizTimer
                  seconds={phase === "cue" ? Math.ceil(cueLeft / 1000) : secondsLeft}
                  total={phase === "cue" ? 4 : round.durationSec}
                  hot={phase === "round" && secondsLeft <= 5}
                />
              </span>
            </div>

            {phase === "cue" && (
              <div className="qz-cue" key={room.index}>
                <span className="qz-cue-n">Épreuve {room.index + 1}</span>
                <b className="qz-cue-label">{round.label}</b>
                <em className="qz-cue-hint">{typeHint(round.type)}</em>
                {/* La consigne du mode : il FAUT la dire. « Le premier qui
                    trouve » et « chacun sa copie » ne se jouent pas pareil. */}
                <span className={`qzv-mode ${isBuzzer ? "buzzer" : "parallel"}`}>
                  {isBuzzer ? "Au buzzer — le premier rafle tout" : "Chacun sa copie, tout le monde marque"}
                </span>
              </div>
            )}

            {phase !== "cue" && (
              <QuizRound
                round={round}
                elapsedMs={elapsedMs}
                timeLeftMs={msLeft}
                locked={iAmSettled || phase === "reveal" || nearEnd}
                reveal={phase === "reveal" ? { correct: myResult(round, meId)?.correct } : null}
                lives={round.lives ?? 3}
                candidates={candidates}
                onAttempt={attempt}
                onProgress={sendProgress}
                jokers={me?.jokers ?? 0}
                onJoker={round.type === "qcm" ? useJoker : null}
                sfx={sfx}
              />
            )}

            {/* Ce que quelqu'un vient de proposer, en buzzer. */}
            {flash && (
              <span className={`qzv-flash ${flash.correct ? "good" : "bad"}`} key={flash.label}>
                <b>{players.find((p) => p.id === flash.by)?.username || "?"}</b>{" "}
                {flash.correct ? flash.label || "a trouvé !" : `: ${flash.label}`}
              </span>
            )}

            {iAmSettled && phase === "round" && (
              <p className="qzv-waiting">
                {isBuzzer ? "Ta manche est finie." : "Copie rendue."} On attend les autres…
              </p>
            )}

            {/* Le rail des pupitres. Il descend en bas d'écran pendant la
                manche : c'est le mobilier du plateau, pas un panneau latéral. */}
            <VersusRail
              players={players}
              found={round.found || []}
              out={Object.keys(settledById).filter(
                (id) => settledById[id] && !(round.found || []).some((f) => f.userId === id)
              )}
              livesById={round.livesById || {}}
              hueById={hueById}
              // Le nombre de cœurs suit L'ÉPREUVE, il n'est pas figé à trois.
              // Un QCM n'autorise qu'un essai : afficher « 1 cœur sur 3 » à tout
              // le monde dès le début donnait l'impression que la partie
              // commençait déjà mal engagée.
              lives={maxTries}
              row
              renderSub={(p) => {
                const res = phase === "reveal" ? myResult(round, p.id) : null;
                if (res)
                  return (
                    <em className={res.points > 0 ? "gv-rail-ok" : "gv-rail-out"}>
                      {res.points > 0 ? `+${res.points}` : "0"}
                      {res.ratio > 0 && res.ratio < 1 ? ` · ${Math.round(res.ratio * 100)}%` : ""}
                    </em>
                  );
                if (settledById[p.id])
                  return <em className="gv-rail-ok">{isBuzzer ? "a répondu" : "a rendu"}</em>;
                if (!isBuzzer && progress[p.id] != null)
                  return <em className="gv-rail-hearts">{progress[p.id]} placé(s)</em>;
                // Sur une épreuve à essai unique, il n'y a pas de « vies » à
                // montrer : soit on a répondu, soit on cherche encore.
                if (maxTries <= 1) return <em className="gv-rail-hearts">cherche…</em>;
                return null;
              }}
            />
          </div>
        )}

        {/* ---------------- LE CLASSEMENT ---------------- */}
        {phase === "done" && (
          <Final
            ranking={ranking || []}
            hueById={hueById}
            meId={meId}
            isHost={room?.isHost}
            busy={busy}
            onAgain={() => {
              setRanking(null);
              call("/again", {});
            }}
          />
        )}
      </div>

      {showInvite && room && (
        <VersusInvite
          token={token}
          meId={meId}
          room={room}
          endpoint={`/quiz/versus/${room.code}/invite`}
          title="Inviter sur le plateau"
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* Le chat du salon : réservé à ceux qui jouent (un curieux muni du lien
          n'a rien à souffler à la table). */}
      {room && me && (
        <GameChat
          token={token}
          code={code}
          event="quizversus"
          endpoint="/quiz/versus"
          players={players}
          meId={meId}
        />
      )}
    </div>
  );
}

const myResult = (round, id) => (round?.results || []).find((r) => r.userId === id) || null;

// ============================================================
//  Le salon d'avant-partie
// ============================================================
// Il faisait pauvre à côté de l'accueil, alors que c'est le premier écran que
// voient les invités. Trois choses le trahissaient :
//
//   • TROIS PLACES en dur, alors qu'on joue jusqu'à six. Le nombre vient
//     désormais du serveur (`room.maxPlayers`), seul à connaître la limite
//     qu'il fait respecter.
//   • Les places libres n'étaient que du décor. Ce sont maintenant des BOUTONS :
//     c'est le geste évident quand on regarde un siège vide, et ça évite de
//     chercher le bouton « inviter » ailleurs sur la page.
//   • Le choix des épreuves n'avait rien à voir avec celui de l'accueil. Il
//     réutilise exactement les mêmes pastilles à icône (.qz-type), au lieu
//     d'une seconde interface pour le même réglage.
function Lobby({
  room,
  active,
  hueById,
  busy,
  copied,
  onCopy,
  onInvite,
  onReady,
  onSettings,
  onStart,
  me,
  maxPlayers,
}) {
  const [types, setTypes] = useState([]);
  const { token } = useAuth();

  useEffect(() => {
    let alive = true;
    apiFetch("/quiz/types", { token })
      .then((d) => alive && setTypes(d.types || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  const picked = room.types?.length ? room.types : types.map((t) => t.key);
  const free = Math.max(0, maxPlayers - active.length);

  function toggleType(key) {
    if (!room.isHost) return;
    const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
    if (!next.length) return; // on ne décoche jamais tout
    onSettings({ types: next });
  }

  return (
    <div className="qzv-lobby">
      <h1 className="qz-logo qzv-logo">
        <span className="qz-logo-le">Le plateau</span>
        <span className="qz-logo-main">
          {room.code}
          <i className="qz-logo-q" aria-hidden="true">
            ?
          </i>
        </span>
      </h1>
      <p className="qz-sub">
        {active.length} candidat{active.length > 1 ? "s" : ""} sur {maxPlayers} ·{" "}
        {room.roundCount} épreuves
      </p>

      {/* Les pupitres. Occupés, ils montrent qui est là ; libres, ils invitent —
          au sens propre, ce sont des boutons. */}
      <ul className="qzv-desks">
        {active.map((p) => (
          <li
            key={p.id}
            className={`qzv-desk ${p.ready ? "ready" : ""}`}
            style={{ "--hue": hueById.get(p.id) }}
          >
            <VersusFace user={p} size={44} hue={hueById.get(p.id)} />
            <b>{p.username}</b>
            <em>
              {p.isHost ? "hôte" : p.ready ? "prêt" : "en attente"}
              {!p.online && " · absent"}
            </em>
            <span className="qzv-desk-light" aria-hidden="true" />
          </li>
        ))}
        {Array.from({ length: free }).map((_, i) => (
          <li key={`e${i}`} className="qzv-desk empty">
            <button type="button" className="qzv-desk-invite clickable" onClick={onInvite}>
              <span className="qzv-desk-ph">
                <Plus size={20} />
              </span>
              <em>Inviter</em>
            </button>
          </li>
        ))}
      </ul>

      <div className="qzv-lobby-actions">
        <button type="button" className="qz-ghost clickable" onClick={onCopy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? "Lien copié" : "Copier le lien"}
        </button>
        <button type="button" className="qz-ghost clickable" onClick={onInvite}>
          <UserPlus size={16} /> Inviter
        </button>
        <button
          type="button"
          className={`qz-ghost clickable ${me?.ready ? "on" : ""}`}
          onClick={() => onReady(!me?.ready)}
          disabled={busy}
        >
          {me?.ready ? <Check size={16} /> : <X size={16} />}
          {me?.ready ? "Prêt" : "Pas prêt"}
        </button>
      </div>

      {room.isHost ? (
        <div className="qzv-settings">
          <div className="qz-rounds-pick">
            <span className="qz-rounds-label">Nombre d'épreuves</span>
            <div className="qz-rounds-opts">
              {[5, 8, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`qz-round-opt clickable ${room.roundCount === n ? "on" : ""}`}
                  onClick={() => onSettings({ rounds: n })}
                  disabled={busy}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {types.length > 0 && (
            <div className="qz-types">
              <span className="qz-rounds-label">Au programme</span>
              <div className="qz-types-grid">
                {types.map((t) => {
                  const on = picked.includes(t.key);
                  const Icon = TYPE_ICONS[t.key] || ListChecks;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className={`qz-type clickable ${on ? "on" : ""}`}
                      data-qz-type={t.key}
                      onClick={() => toggleType(t.key)}
                      aria-pressed={on}
                      title={typeHint(t.key)}
                      disabled={busy}
                    >
                      <span className="qz-type-ic">
                        <Icon size={19} />
                      </span>
                      <b>{t.label}</b>
                      {on && (
                        <span className="qz-type-mark" aria-hidden="true">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Les invités voient le programme sans pouvoir y toucher : savoir à
           quoi on va jouer fait partie de l'attente. */
        types.length > 0 && (
          <div className="qzv-programme">
            <span className="qz-rounds-label">Au programme</span>
            <div className="qzv-programme-row">
              {types
                .filter((t) => picked.includes(t.key))
                .map((t) => {
                  const Icon = TYPE_ICONS[t.key] || ListChecks;
                  return (
                    <span key={t.key} className="qzv-prog-chip" data-qz-type={t.key}>
                      <Icon size={14} />
                      {t.label}
                    </span>
                  );
                })}
            </div>
          </div>
        )
      )}

      {room.isHost ? (
        <button
          type="button"
          className="qz-start clickable"
          onClick={onStart}
          disabled={busy || active.length < 2}
        >
          {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
          {active.length < 2 ? "Il faut être au moins deux" : "Lancer le plateau"}
        </button>
      ) : (
        <p className="qzv-wait-host">
          <Gamepad2 size={15} />
          {active.every((p) => p.ready)
            ? "Tout le monde est prêt."
            : "En attente des autres candidats…"}
          <em>L'hôte lance la partie.</em>
        </p>
      )}
    </div>
  );
}

// ============================================================
//  Le classement final
// ============================================================
function Final({ ranking, hueById, meId, isHost, busy, onAgain }) {
  const champ = ranking[0] || null;
  return (
    <div className="qzv-final">
      {champ && (
        <div className="qzv-champ">
          <Crown size={26} />
          <VersusFace user={champ.user} size={64} hue={hueById.get(champ.id)} />
          <b>{champ.user?.username}</b>
          <em>{champ.score} points</em>
        </div>
      )}

      <ol className="qzv-rank">
        {ranking.map((r) => (
          <li key={r.id} className={`qzv-rank-row ${r.id === meId ? "me" : ""}`} style={{ "--hue": hueById.get(r.id) }}>
            <span className={`qz-board-rank r${r.rank}`}>{r.rank}</span>
            <VersusFace user={r.user} size={30} hue={hueById.get(r.id)} />
            <span className="qzv-rank-id">
              <b>{r.user?.username}</b>
              <em>
                {r.correct} épreuve{r.correct > 1 ? "s" : ""} réussie{r.correct > 1 ? "s" : ""}
                {r.bestStreak > 1 && ` · série de ${r.bestStreak}`}
              </em>
            </span>
            <span className="qzv-rank-score">{r.score}</span>
          </li>
        ))}
      </ol>

      <div className="qz-done-actions">
        {isHost && (
          <button type="button" className="qz-start sm clickable" onClick={onAgain} disabled={busy}>
            <RotateCcw size={16} /> On remet ça
          </button>
        )}
        <Link to="/quiz" className="qz-ghost clickable">
          <Share2 size={16} /> Jouer en solo
        </Link>
        <Link to="/arcade" className="qz-ghost clickable">
          <Trophy size={16} /> Arcade
        </Link>
      </div>
    </div>
  );
}
