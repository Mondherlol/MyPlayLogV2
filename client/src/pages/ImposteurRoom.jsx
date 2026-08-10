import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Eye,
  Gamepad2,
  Gavel,
  Loader2,
  Maximize2,
  Minus,
  Play,
  Send,
  Sparkles,
  Timer,
  UserPlus,
  Users,
  VenetianMask,
  Vote,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { apiFetch } from "../lib/api";
import { VersusInvite } from "../components/VersusRoom";
import GameSheetOverlay from "../components/GameSheetOverlay";
import { ImposteurDecor } from "./Imposteur";

// ======================================================================
//  L'Imposteur — le salon
// ======================================================================
// Le client n'arbitre RIEN : les phases, le tour de parole et le dépouillement
// tombent du serveur par le flux SSE (routes/imposteur.js). Cette page les
// met en scène, et c'est tout — le compte à rebours affiché est décoratif,
// exactement comme dans les cinq autres salons.
//
// ------------------------------------------------------- la frappe en direct
// C'EST L'IDÉE DU MODE, et elle vit entièrement ici. Celui qui a la parole
// envoie son texte en cours à chaque frappe (limité à une requête toutes les
// 120 ms) ; les autres le voient s'écrire, hésiter, effacer. Rien de tout ça
// n'est stocké nulle part.
//
// Deux détails qui font toute la différence entre « drôle » et « cassé » :
//   - on n'affiche JAMAIS sa propre frappe renvoyée par le réseau (le champ
//     ferait des sauts de curseur) : le serveur ne la rediffuse pas à
//     l'expéditeur, et le champ reste maître chez lui ;
//   - le tampon se vide au changement de locuteur, sinon le mot à moitié tapé
//     du joueur précédent s'affiche sous le nom du suivant.

const PHASE_LABEL = {
  card: "Ta carte",
  clue: "Les indices",
  vote: "Le vote",
  steal: "Dernière chance",
  result: "Révélation",
};

// ============================================================
//  Le départ différé
// ============================================================
// Quitter la page, C'EST quitter le salon : sans ça, celui qui revient à
// l'accueil depuis l'écran d'invitation reste affiché parmi les joueurs, et
// l'hôte attend quelqu'un qui est parti depuis dix minutes.
//
// Mais le nettoyage d'un effet React ne veut pas toujours dire « il s'en va » :
// en développement, StrictMode monte, démonte et remonte la page aussitôt. Un
// départ envoyé sec ferait sortir le joueur de son propre salon à l'ouverture.
// D'où ce petit délai, annulé si la page se remonte dans la foulée. Ce registre
// vit hors du composant, justement parce qu'il doit survivre à son démontage.
const pendingLeave = new Map();

export default function ImposteurRoom() {
  const { code } = useParams();
  const { token, user } = useAuth();
  const { subscribe } = useChat();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // La fiche d'un jeu ouverte par-dessus la partie (jamais à la place).
  // `rect` est la position de la jaquette touchée : la fiche s'en déplie.
  const [sheet, setSheet] = useState(null);
  const [sheetMin, setSheetMin] = useState(false);
  // Ce que les autres sont en train de taper : { userId: texte }. Volatile par
  // nature — jamais persisté, vidé à chaque changement de locuteur.
  const [typed, setTyped] = useState({});
  const [word, setWord] = useState("");

  const skewRef = useRef(0);
  const inputRef = useRef(null);
  const dockRef = useRef(null);

  const phase = room?.phase || "lobby";
  const round = room?.round || null;
  const meId = String(user?.id || "");

  const applyRoom = useCallback((r) => {
    if (!r) return;
    if (r.now) skewRef.current = r.now - Date.now();
    setRoom(r);
  }, []);

  // ---------- Chargement, adhésion, et départ en partant ----------
  useEffect(() => {
    let alive = true;
    // On revient (ou StrictMode a remonté la page) : le départ programmé n'a
    // plus lieu d'être.
    clearTimeout(pendingLeave.get(code));
    pendingLeave.delete(code);

    (async () => {
      try {
        const d = await apiFetch(`/imposteur/${code}/join`, { method: "POST", token });
        if (alive) applyRoom(d.room);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Impossible de rejoindre ce salon.");
        try {
          const d = await apiFetch(`/imposteur/${code}`, { token });
          if (alive) applyRoom(d.room);
        } catch {
          /* le message d'erreur suffit */
        }
      }
    })();

    // Onglet fermé / rechargé : `keepalive` laisse l'adieu partir alors que la
    // page est déjà en train de disparaître.
    const bye = () =>
      apiFetch(`/imposteur/${code}/leave`, {
        method: "POST",
        token,
        keepalive: true,
      }).catch(() => {});
    window.addEventListener("pagehide", bye);

    return () => {
      alive = false;
      window.removeEventListener("pagehide", bye);
      pendingLeave.set(
        code,
        setTimeout(() => {
          pendingLeave.delete(code);
          bye();
        }, 400)
      );
    };
  }, [code, token, applyRoom]);

  // ---------- Le direct ----------
  useEffect(() => {
    if (!subscribe || !code) return undefined;
    return subscribe((event, data) => {
      if (event !== "imposteur" || data?.code !== code) return;
      // La frappe ne porte pas de salon sérialisé : c'est un simple filet de
      // texte, traité à part et sans jamais toucher à l'état de la partie.
      if (data.kind === "typing") {
        setTyped((prev) => ({ ...prev, [data.userId]: data.text }));
        return;
      }
      if (data.room) applyRoom(data.room);
      if (data.kind === "turn" || data.kind === "clue" || data.kind === "card") setErr("");
    });
  }, [subscribe, code, applyRoom]);

  // ---------- Changement de locuteur : on repart propre ----------
  const speaker = round?.speaker || null;
  useEffect(() => {
    setTyped({});
    setWord("");
  }, [speaker, room?.index]);

  // Le champ prend le focus dès que la parole m'arrive : sans ça, on perd trois
  // des vingt-cinq secondes à cliquer dans une boîte. Fiche ouverte, c'est
  // celui de la barre du bas — c'est là qu'on regarde.
  const sheetOpen = !!sheet && !sheetMin;
  useEffect(() => {
    if (phase !== "clue" || !round?.myTurn) return;
    (sheetOpen ? dockRef : inputRef).current?.focus();
  }, [phase, round?.myTurn, sheetOpen]);

  // ---------- Ouvrir la fiche ----------
  // On retient le rectangle de la jaquette touchée : la surcouche se déplie
  // depuis elle (components/GameSheetOverlay.jsx). Sans ce repère, la fiche
  // surgirait de nulle part et on perdrait le fil de ce qu'on regardait.
  const openSheet = useCallback((id, e) => {
    if (!id) return;
    const el = e?.currentTarget;
    const r = el?.getBoundingClientRect?.();
    setSheet({
      id: String(id),
      rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
    });
    setSheetMin(false);
  }, []);

  // ---------- Compte à rebours (décoratif : le serveur décide) ----------
  const [remain, setRemain] = useState(0);
  useEffect(() => {
    if (!room?.phaseEndsAt) {
      setRemain(0);
      return undefined;
    }
    const end = new Date(room.phaseEndsAt).getTime();
    const tick = () => setRemain(Math.max(0, (end - (Date.now() + skewRef.current)) / 1000));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [room?.phaseEndsAt]);

  const total = room?.timings?.[phase] || 1;
  const pct = Math.max(0, Math.min(100, (remain / total) * 100));

  // ---------- La frappe en direct ----------
  // Limitée à une requête toutes les 120 ms, avec un envoi de fin garanti :
  // sans ce dernier, le mot s'arrêterait d'apparaître au milieu dès qu'on tape
  // vite puis qu'on s'arrête — le pire des deux mondes.
  const beat = useRef({ last: 0, timer: null, pending: null });
  const sendTyping = useCallback(
    (text) => {
      const fire = (t) => {
        beat.current.last = Date.now();
        apiFetch(`/imposteur/${code}/typing`, {
          method: "POST",
          token,
          body: { text: t },
        }).catch(() => {
          /* une frappe perdue n'est rien : la suivante rattrape */
        });
      };
      const now = Date.now();
      beat.current.pending = text;
      if (now - beat.current.last >= 120) {
        fire(text);
        return;
      }
      if (beat.current.timer) return;
      beat.current.timer = setTimeout(() => {
        beat.current.timer = null;
        fire(beat.current.pending);
      }, 120);
    },
    [code, token]
  );
  useEffect(
    () => () => {
      if (beat.current.timer) clearTimeout(beat.current.timer);
    },
    []
  );

  // L'espace est autorisé (« game over », « chat botté ») : c'est une règle de
  // table, pas une règle de logiciel. Seule la longueur est bornée, pour que
  // l'indice reste un indice et non une explication.
  const onWord = useCallback(
    (e) => {
      const v = e.target.value.slice(0, 24);
      setWord(v);
      sendTyping(v);
    },
    [sendTyping]
  );

  const submitWord = useCallback(
    async (e) => {
      e?.preventDefault?.();
      const w = word.trim();
      if (!w || busy) return;
      setBusy(true);
      try {
        await apiFetch(`/imposteur/${code}/clue`, { method: "POST", token, body: { word: w } });
        setWord("");
        setErr("");
      } catch (e2) {
        // Le tour n'est PAS consommé : le message explique, le champ garde le
        // mot, il reste du temps pour en trouver un autre.
        setErr(e2.message || "Indice non retenu.");
      } finally {
        setBusy(false);
      }
    },
    [word, busy, code, token]
  );

  const act = useCallback(
    async (path, body) => {
      setBusy(true);
      try {
        const d = await apiFetch(`/imposteur/${code}/${path}`, {
          method: "POST",
          token,
          body,
        });
        if (d?.room) applyRoom(d.room);
        setErr("");
      } catch (e) {
        setErr(e.message || "Action impossible.");
      } finally {
        setBusy(false);
      }
    },
    [code, token, applyRoom]
  );

  const byId = useMemo(() => {
    const m = new Map();
    for (const p of room?.players || []) m.set(p.id, p);
    return m;
  }, [room?.players]);

  const quit = useCallback(() => navigate("/arcade"), [navigate]);

  if (!room)
    return (
      <div className="imp-page">
        <div className="imp-stage imp-center">
          {err ? <p className="imp-err">{err}</p> : <Loader2 size={22} className="spin" />}
        </div>
      </div>
    );

  const live = phase !== "lobby" && phase !== "done";

  return (
    <div className={`imp-page imp-room ${live ? "in-game" : ""} ph-${phase}`}>
      <ImposteurDecor />

      <header className="imp-top">
        {/* Retour à l'arcade : l'Imposteur n'a pas de mode solo, il n'y a donc
            pas de « page parente » du jeu où revenir. */}
        <Link to="/arcade" className="imp-back clickable">
          <ArrowLeft size={17} /> <span>Arcade</span>
        </Link>
        <span className="imp-title">
          <VenetianMask size={15} /> L&apos;Imposteur
        </span>
        {live ? (
          <span className="imp-progress">
            {(round?.index ?? 0) + 1}
            <em>/{round?.total ?? room.roundCount}</em>
          </span>
        ) : (
          <span className="imp-progress ghost" />
        )}
      </header>

      <div className="imp-stage">
        {err && <p className="imp-err">{err}</p>}

        {live && (
          <div className={`imp-phase ph-${phase}`}>
            <span className="imp-phase-name">
              {phase === "card" ? (
                <Eye size={15} />
              ) : phase === "clue" ? (
                <Send size={15} />
              ) : phase === "vote" ? (
                <Vote size={15} />
              ) : phase === "steal" ? (
                <Sparkles size={15} />
              ) : (
                <Gavel size={15} />
              )}
              {PHASE_LABEL[phase]}
            </span>
            <span className="imp-phase-bar">
              <i style={{ width: `${pct}%` }} />
            </span>
            <span className="imp-phase-sec">
              <Timer size={12} /> {Math.ceil(remain)}s
            </span>
          </div>
        )}

        {phase === "lobby" && (
          <Lobby
            room={room}
            code={code}
            busy={busy}
            copied={copied}
            onInvite={() => setShowInvite(true)}
            onOptions={(o) => act("options", o)}
            onReady={(v) => act("ready", { ready: v })}
            onStart={() => act("start")}
            onLeave={quit}
            onCopy={() => {
              navigator.clipboard?.writeText(window.location.href).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          />
        )}

        {/* MA CARTE, PENDANT TOUTE LA PARTIE. Elle ne servait qu'aux huit
            premières secondes : passé la phase de découverte, il fallait se
            souvenir de son jeu — et l'oublier au troisième tour, ça arrive.
            Elle reste donc collée en haut, et c'est aussi la porte d'entrée de
            la fiche à n'importe quel moment. Jamais pendant la révélation :
            les deux jeux y sont déjà en grand. */}
        {(phase === "clue" || phase === "vote" || phase === "steal") && round && (
          <MyGamePanel round={round} onOpen={openSheet} />
        )}

        {phase === "card" && (
          <CardStage round={round} remain={remain} onOpenSheet={openSheet} />
        )}

        {phase === "clue" && round && (
          <ClueStage
            room={room}
            round={round}
            byId={byId}
            typed={typed}
            word={word}
            busy={busy}
            inputRef={inputRef}
            onWord={onWord}
            onSubmit={submitWord}
            onCallVote={() => act("callvote")}
          />
        )}

        {phase === "vote" && round && (
          <VoteStage
            room={room}
            round={round}
            byId={byId}
            meId={meId}
            busy={busy}
            onVote={(target) => act("vote", { target })}
          />
        )}

        {phase === "steal" && round && (
          <StealStage
            round={round}
            byId={byId}
            busy={busy}
            onPick={(pick) => act("steal", { pick })}
          />
        )}

        {phase === "result" && round?.result && (
          <ResultStage round={round} byId={byId} meId={meId} onOpenSheet={openSheet} />
        )}

        {phase === "done" && <Final room={room} onQuit={quit} />}
      </div>

      {showInvite && (
        <VersusInvite
          token={token}
          meId={user?.id}
          room={room}
          endpoint={`/imposteur/${room.code}/invite`}
          title="Inviter à l'Imposteur"
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* La fiche d'un jeu, PAR-DESSUS la partie : la page reste montée
          derrière, le flux SSE continue d'arriver et les chronos tournent.
          Trois emplacements lui sont fournis — le bandeau qui rappelle la
          partie, la barre du bas qui permet de CONTINUER À JOUER sans fermer,
          et la pastille de la fiche réduite. */}
      {sheet && (
        <GameSheetOverlay
          gameId={sheet.id}
          originRect={sheet.rect}
          minimized={sheetMin}
          onClose={() => {
            setSheet(null);
            setSheetMin(false);
          }}
          hud={
            <div className="imp-hud">
              <span className="imp-hud-dot" aria-hidden="true" />
              <b>
                <VenetianMask size={13} /> Partie en cours
              </b>
              <em>
                {PHASE_LABEL[phase] || "Salon"}
                {live ? ` · ${Math.ceil(remain)}s` : ""}
              </em>
              <button
                className="imp-hud-min clickable"
                onClick={() => setSheetMin(true)}
                title="Réduire la fiche"
              >
                <Minus size={15} /> Réduire
              </button>
              <button className="imp-hud-back clickable" onClick={() => setSheet(null)}>
                Revenir au jeu
              </button>
            </div>
          }
          footer={
            <ImpDock
              phase={phase}
              round={round}
              byId={byId}
              typed={typed}
              word={word}
              busy={busy}
              remain={remain}
              inputRef={dockRef}
              onWord={onWord}
              onSubmit={submitWord}
              onBack={() => setSheet(null)}
            />
          }
          pill={
            <button className="gsheet-pill clickable" onClick={() => setSheetMin(false)}>
              {round?.myGameCover ? (
                <img src={round.myGameCover} alt="" draggable="false" />
              ) : (
                <Gamepad2 size={18} />
              )}
              <span>
                <b>Fiche réduite</b>
                <em>Rouvrir</em>
              </span>
              <Maximize2 size={15} />
            </button>
          }
        />
      )}
    </div>
  );
}

// ============================================================
//  Le salon d'attente
// ============================================================
function Lobby({
  room,
  code,
  busy,
  copied,
  onCopy,
  onInvite,
  onOptions,
  onReady,
  onStart,
  onLeave,
}) {
  const active = room.players.filter((p) => !p.left);
  const missing = Math.max(0, room.minPlayers - active.length);
  const canStart = room.isHost && active.length >= room.minPlayers;
  const me = active.find((p) => p.isMe);
  // Les invités seulement : l'hôte n'a pas à se déclarer prêt à lui-même, c'est
  // lui qui appuie sur le bouton.
  const guests = active.filter((p) => !p.isHost);
  const readyCount = guests.filter((p) => p.ready).length;

  return (
    <section className="imp-lobby">
      <div className="imp-code" onClick={onCopy} role="button" tabIndex={0}>
        <span className="imp-code-lbl">Code du salon</span>
        <b>{code}</b>
        <span className="imp-code-copy">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Lien copié" : "Copier le lien"}
        </span>
      </div>

      <ul className="imp-lobby-list">
        {active.map((p) => (
          <li key={p.id} className={p.ready || p.isHost ? "ok" : ""}>
            <Avatar p={p} />
            <b>
              {p.username}
              {p.isHost && <Crown size={13} className="imp-crown" />}
            </b>
            {p.isHost ? (
              <span className="imp-state">hôte</span>
            ) : (
              <span className={`imp-state ${p.ready ? "on" : ""}`}>
                {p.ready ? "prêt" : "en attente"}
              </span>
            )}
          </li>
        ))}
        {Array.from({ length: missing }).map((_, i) => (
          <li key={`e${i}`} className="empty">
            <Users size={16} /> il manque un joueur…
          </li>
        ))}
      </ul>

      <button className="imp-go alt clickable" onClick={onInvite}>
        <UserPlus size={17} /> Inviter des amis
      </button>

      {/* Le nombre de manches est le seul réglage : « mots par joueur » a été
          retiré, aucune de ses valeurs n'était jouable sauf celle par défaut. */}
      <div className="imp-settings">
        <div className="imp-setting">
          <span>Manches</span>
          <div className="imp-chips">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                className={`imp-chip clickable ${room.roundCount === n ? "on" : ""}`}
                onClick={() => onOptions({ rounds: n })}
                disabled={!room.isHost || busy}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {room.isHost ? (
        <button className="imp-go clickable" onClick={onStart} disabled={!canStart || busy}>
          {busy ? <Loader2 size={17} className="spin" /> : <Play size={17} />}
          {canStart
            ? `Lancer la partie${guests.length ? ` (${readyCount}/${guests.length} prêts)` : ""}`
            : `Encore ${missing} joueur${missing > 1 ? "s" : ""}`}
        </button>
      ) : (
        <>
          {/* Le bouton « prêt » de l'invité. Il ne lance rien et ne bloque
              rien : il dit à l'hôte qu'il peut y aller. */}
          <button
            className={`imp-go ${me?.ready ? "alt" : ""} clickable`}
            onClick={() => onReady(!me?.ready)}
            disabled={busy}
          >
            {me?.ready ? <Check size={17} /> : <Play size={17} />}
            {me?.ready ? "Je suis prêt — annuler" : "Je suis prêt"}
          </button>
          <p className="imp-lobby-wait">
            <Loader2 size={14} className="spin" /> L&apos;hôte lance la partie.
          </p>
        </>
      )}

      <button className="imp-quiet clickable" onClick={onLeave}>
        Quitter le salon
      </button>
    </section>
  );
}

// ============================================================
//  Ma carte, en permanence
// ============================================================
// La jaquette de MON jeu, collée en haut de l'écran tant que la manche dure.
// Elle répond à deux besoins qui n'en font qu'un : ne pas oublier son jeu au
// troisième tour (ça arrive, et c'est rageant), et pouvoir ouvrir sa fiche À
// N'IMPORTE QUEL MOMENT — pas seulement pendant les huit secondes de la carte.
//
// Elle ne divulgue rien : chacun ne reçoit que son propre titre du serveur
// (cf. roundView), donc l'afficher en continu n'apprend rien à personne.
function MyGamePanel({ round, onOpen }) {
  if (!round?.myGame) return null;
  const clickable = !!round.myGameId;
  const body = (
    <>
      {round.myGameCover ? (
        <img src={round.myGameCover} alt="" draggable="false" />
      ) : (
        <span className="imp-mine-ph" aria-hidden="true">
          <Gamepad2 size={20} />
        </span>
      )}
      <span className="imp-mine-txt">
        <em>Ton jeu</em>
        <b>{round.myGame}</b>
        {clickable && (
          <span className="imp-mine-open">
            <Gamepad2 size={11} /> ouvrir la fiche
          </span>
        )}
      </span>
    </>
  );
  return clickable ? (
    <button className="imp-mine clickable" onClick={(e) => onOpen(round.myGameId, e)}>
      {body}
    </button>
  ) : (
    <div className="imp-mine">{body}</div>
  );
}

// ============================================================
//  La barre du bas de la fiche : jouer sans fermer
// ============================================================
// C'est elle qui fait de la fiche une fenêtre secondaire plutôt qu'un
// cul-de-sac. Avant, ouvrir la fiche pendant son tour revenait à quitter la
// partie des yeux — on avait donc programmé sa fermeture d'office quand la
// parole arrivait, ce qui était une rustine : on arrachait la page des mains
// du joueur. Désormais on lui donne le champ ICI, et il choisit.
//
// Le champ partage l'état `word` avec celui du salon : la frappe en direct part
// exactement pareil, les autres voient les mêmes hésitations, et passer de l'un
// à l'autre ne perd rien.
function ImpDock({
  phase,
  round,
  byId,
  typed,
  word,
  busy,
  remain,
  inputRef,
  onWord,
  onSubmit,
  onBack,
}) {
  if (!round || phase === "lobby" || phase === "done") return null;

  if (phase === "clue" && round.myTurn)
    return (
      <div className="imp-dock act">
        <span className="imp-dock-lbl">
          <Send size={14} /> À toi — {Math.ceil(remain)}s
        </span>
        <form className="imp-dock-form" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            value={word}
            onChange={onWord}
            placeholder="ton indice"
            maxLength={24}
            autoComplete="off"
            spellCheck="false"
            enterKeyHint="send"
          />
          <button className="imp-send clickable" disabled={!word.trim() || busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    );

  if (phase === "clue") {
    const who = byId.get(round.speaker);
    const live = typed[round.speaker] || "";
    return (
      <div className="imp-dock">
        <span className="imp-dock-lbl">
          <Send size={14} /> {who?.username || "…"} tape
        </span>
        <span className={`imp-dock-live ${live ? "on" : ""}`}>
          {live || "…"}
          <i className="imp-caret" aria-hidden="true" />
        </span>
        <span className="imp-dock-sec">{Math.ceil(remain)}s</span>
      </div>
    );
  }

  // Vote et dernière chance : ça se passe sur le plateau, pas ici. On ne
  // duplique pas les boutons — on ramène. Les autres phases n'attendent rien
  // de personne : la barre se contente de dire où en est la partie.
  const need =
    (phase === "vote" && !round.myVote) || (phase === "steal" && round.steal?.mine);
  const label =
    phase === "vote"
      ? need
        ? "C'est l'heure de voter"
        : "Vote enregistré"
      : phase === "steal"
        ? need
          ? "À toi de deviner leur jeu"
          : "Dernière chance en cours"
        : phase === "card"
          ? "Mémorise ta carte"
          : "Révélation de la manche";
  return (
    <div className={`imp-dock ${need ? "act" : ""}`}>
      <span className="imp-dock-lbl">
        {phase === "vote" ? (
          <Vote size={14} />
        ) : phase === "card" ? (
          <Eye size={14} />
        ) : phase === "steal" ? (
          <Sparkles size={14} />
        ) : (
          <Gavel size={14} />
        )}
        {label}
      </span>
      <span className="imp-dock-sec">{Math.ceil(remain)}s</span>
      {need && (
        <button className="imp-dock-back clickable" onClick={onBack}>
          Revenir au jeu
        </button>
      )}
    </div>
  );
}

// ============================================================
//  La carte — le seul moment où l'on est seul
// ============================================================
// Elle se retourne une fois, et ce qu'elle montre n'appartient qu'à celui qui
// la regarde : le serveur n'a envoyé que SON titre (cf. roundView). L'imposteur
// voit une carte rigoureusement identique à celle des autres — c'est tout le
// mode. Rien ici, ni couleur, ni mot, ni jaquette, ne doit distinguer les deux
// cas : c'est aussi pour ça que le serveur résout les DEUX jaquettes avant
// d'ouvrir la manche (une carte illustrée face à une carte nue serait un aveu).
function CardStage({ round, remain, onOpenSheet }) {
  return (
    <section className="imp-card-stage">
      <div className="imp-card">
        <div className="imp-card-inner">
          <span className="imp-card-face back">
            <VenetianMask size={34} />
            <em>ton jeu</em>
          </span>
          <span className="imp-card-face front">
            {/* LA JAQUETTE EST LE SUJET, pas une vignette d'appoint : c'est
                elle qu'on retient, bien plus qu'un titre lu en huit secondes.
                Elle s'ouvre d'un doigt, et la fiche se déplie depuis elle. */}
            {round?.myGameCover ? (
              <button
                className="imp-card-cover clickable"
                onClick={(e) => onOpenSheet(round.myGameId, e)}
                disabled={!round.myGameId}
                title="Ouvrir la fiche du jeu"
              >
                <img src={round.myGameCover} alt="" draggable="false" />
                {round.myGameId ? (
                  <span className="imp-card-cover-open">
                    <Gamepad2 size={13} /> ouvrir
                  </span>
                ) : null}
              </button>
            ) : null}
            <b>{round?.myGame}</b>
            <span className="imp-card-foot">garde-le pour toi</span>
          </span>
        </div>
      </div>

      <p className="imp-card-note">
        Mémorise-le. Il ne sera plus affiché — {Math.ceil(remain)}s
      </p>
    </section>
  );
}

// ============================================================
//  Les indices — le tour de parole
// ============================================================
// L'écran est construit autour d'UNE chose : le mot en train de s'écrire. Le
// reste (la file d'attente, les mots déjà tombés) l'entoure sans lui disputer
// la vedette, parce que c'est là que se joue le mode — on rit de l'hésitation
// bien avant de rire du mot.
function ClueStage({
  room,
  round,
  byId,
  typed,
  word,
  busy,
  inputRef,
  onWord,
  onSubmit,
  onCallVote,
}) {
  const speaker = byId.get(round.speaker);
  const mine = round.myTurn;
  const liveText = mine ? word : typed[round.speaker] || "";
  const need = Math.floor(room.players.filter((p) => !p.left).length / 2) + 1;

  return (
    <section className="imp-clue-stage">
      {/* La scène : qui parle, et ce qu'il est en train de taper. */}
      <div className={`imp-mic ${mine ? "mine" : ""}`}>
        <span className="imp-mic-who">
          {speaker ? <Avatar p={speaker} big /> : null}
          <b>{mine ? "À toi." : `${speaker?.username || "…"} cherche ses mots`}</b>
          <em>
            tour {round.turn}/{round.turns}
          </em>
        </span>

        <div className={`imp-live ${liveText ? "typing" : ""}`}>
          <span className="imp-live-text">{liveText}</span>
          <i className="imp-caret" aria-hidden="true" />
          {!liveText && <span className="imp-live-ph">…</span>}
        </div>

        {mine ? (
          <form className="imp-form" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              value={word}
              onChange={onWord}
              placeholder="ton indice"
              maxLength={24}
              autoComplete="off"
              spellCheck="false"
              enterKeyHint="send"
            />
            <button className="imp-send clickable" disabled={!word.trim() || busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </form>
        ) : (
          <p className="imp-mic-note">Ils te voient taper, alors ne te trahis pas.</p>
        )}
      </div>

      {/* La file : qui a parlé, qui parle, qui vient. */}
      <ul className="imp-queue">
        {round.order.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          const said = round.clues.filter((c) => c.userId === id).length;
          return (
            <li
              key={id}
              className={`${id === round.speaker ? "now" : ""} ${p.left ? "gone" : ""}`}
            >
              <Avatar p={p} />
              <span>{p.username}</span>
              <em>{said}</em>
            </li>
          );
        })}
      </ul>

      {/* Les mots déjà tombés : la matière du vote. */}
      {round.clues.length > 0 && (
        <ul className="imp-clues">
          {round.clues.map((c, i) => {
            const p = byId.get(c.userId);
            return (
              <li key={`${c.userId}-${i}`} className={c.missed ? "missed" : ""}>
                <Avatar p={p} small />
                <b>{c.missed ? "— rien —" : c.word}</b>
                <em>{p?.username}</em>
              </li>
            );
          })}
        </ul>
      )}

      <button
        className={`imp-callvote clickable ${round.called ? "on" : ""}`}
        onClick={onCallVote}
        disabled={round.called}
      >
        <Vote size={15} />
        {round.called ? "Tu as demandé le vote" : "Passer au vote"}
        <em>
          {round.calls.length}/{need}
        </em>
      </button>
    </section>
  );
}

// ============================================================
//  Le vote
// ============================================================
// On voit QUI a voté, jamais POUR QUI : le serveur ne l'envoie pas (roundView).
// Sans cette règle, le premier vote entraînerait tous les autres et le mode
// deviendrait un sondage.
function VoteStage({ room, round, byId, meId, busy, onVote }) {
  const active = room.players.filter((p) => !p.left);
  return (
    <section className="imp-vote-stage">
      <h2 className="imp-h2">Qui n&apos;a pas le même jeu ?</h2>

      <ul className="imp-clues recap">
        {round.clues.map((c, i) => (
          <li key={`${c.userId}-${i}`} className={c.missed ? "missed" : ""}>
            <b>{c.missed ? "— rien —" : c.word}</b>
            <em>{byId.get(c.userId)?.username}</em>
          </li>
        ))}
      </ul>

      <ul className="imp-ballots">
        {active.map((p) => {
          const isMe = p.id === meId;
          const picked = round.myVote === p.id;
          return (
            <li key={p.id}>
              <button
                className={`imp-ballot clickable ${picked ? "picked" : ""} ${
                  round.voted.includes(p.id) ? "done" : ""
                }`}
                onClick={() => onVote(p.id)}
                disabled={isMe || !!round.myVote || busy}
              >
                <Avatar p={p} big />
                <b>{isMe ? "toi" : p.username}</b>
                {round.voted.includes(p.id) && (
                  <span className="imp-ballot-done">
                    <Check size={11} /> a voté
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="imp-vote-note">
        {round.myVote
          ? `Vote enregistré · ${round.voted.length}/${active.length} ont voté`
          : "Un seul vote, pas de retour en arrière."}
      </p>
    </section>
  );
}

// ============================================================
//  La dernière chance
// ============================================================
// Démasqué, l'imposteur tente de nommer le jeu des autres. C'est ce qui évite
// qu'une manche perdue soit une humiliation muette — et ça donne à la table
// quinze secondes à regarder en retenant son souffle.
function StealStage({ round, byId, busy, onPick }) {
  const mine = round.steal?.mine;
  const who = byId.get(round.steal?.accused) || null;
  if (!mine)
    return (
      <section className="imp-steal-stage">
        <span className="imp-steal-ring" aria-hidden="true">
          <Sparkles size={32} />
        </span>
        <h2 className="imp-h2">Démasqué !</h2>
        <p className="imp-steal-note">
          {who ? who.username : "L'imposteur"} n&apos;avait pas le même jeu que vous… et il
          tente à l&apos;instant de deviner lequel vous aviez. S&apos;il trouve, il rafle
          la manche.
        </p>
      </section>
    );

  return (
    <section className="imp-steal-stage mine">
      <h2 className="imp-h2">Tu étais l&apos;imposteur.</h2>
      <p className="imp-steal-note">
        Ton jeu n&apos;était pas le leur. Devine le leur et tu leur reprends la manche.
      </p>
      <ul className="imp-steal-options">
        {(round.steal.options || []).map((o) => (
          <li key={o}>
            <button className="imp-steal-opt clickable" onClick={() => onPick(o)} disabled={busy}>
              {o}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================
//  La révélation
// ============================================================
function ResultStage({ round, byId, meId, onOpenSheet }) {
  const r = round.result;
  const imp = byId.get(r.imposteur);
  const iWasImposteur = r.imposteur === meId;
  const gains = new Map(r.gains.map((g) => [g.userId, g.points]));
  const votesFor = (id) => r.votes.filter((v) => v.target === id).map((v) => byId.get(v.voter));

  const verdict = r.stolen
    ? { tone: "steal", txt: "Démasqué… mais il a deviné votre jeu. Manche volée." }
    : r.caught
      ? { tone: "caught", txt: "Démasqué. La table gagne la manche." }
      : { tone: "escape", txt: "Personne ne l'a vu venir. L'imposteur s'échappe." };

  return (
    <section className={`imp-result-stage v-${verdict.tone}`}>
      <div className="imp-unmask">
        <span className="imp-unmask-face">
          {imp ? <Avatar p={imp} big /> : <VenetianMask size={28} />}
        </span>
        <b>{iWasImposteur ? "C'était toi." : `L'imposteur, c'était ${imp?.username || "…"}`}</b>
        <span className="imp-verdict">{verdict.txt}</span>
      </div>

      {/* Les deux jaquettes côte à côte : c'est LE moment où l'on comprend la
          manche (« ah, c'était ça la différence »). Cliquer ouvre la fiche
          par-dessus — on découvre souvent un jeu ici. */}
      <div className="imp-games">
        <GameReveal
          label="La table avait"
          name={r.gameA}
          cover={r.gameACover}
          gameId={r.gameAId}
          onOpen={onOpenSheet}
        />
        <GameReveal
          label={`${imp?.username || "L'imposteur"} avait`}
          name={r.gameB}
          cover={r.gameBCover}
          gameId={r.gameBId}
          odd
          onOpen={onOpenSheet}
        />
      </div>

      {r.hadSteal && (
        <p className={`imp-stealline ${r.stolen ? "ok" : "ko"}`}>
          Dernière chance : il a répondu <b>{r.stealPick || "—"}</b>
          {r.stolen ? " — et c'était ça." : " — raté."}
        </p>
      )}

      <ul className="imp-tally">
        {[...byId.values()]
          .filter((p) => !p.left)
          .sort((a, b) => (gains.get(b.id) || 0) - (gains.get(a.id) || 0))
          .map((p) => {
            const voters = votesFor(p.id);
            const g = gains.get(p.id) || 0;
            return (
              <li key={p.id} className={p.id === r.imposteur ? "imp" : ""}>
                <Avatar p={p} />
                <span className="imp-tally-who">
                  {p.username}
                  {p.id === r.imposteur && <VenetianMask size={12} />}
                </span>
                <span className="imp-tally-votes">
                  {voters.length > 0 ? (
                    voters.map((v, i) => <Avatar key={v?.id || i} p={v} small />)
                  ) : (
                    <em>aucune voix</em>
                  )}
                </span>
                <span className={`imp-tally-pts ${g > 0 ? "up" : ""}`}>
                  {g > 0 ? `+${g}` : "—"}
                </span>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// Un des deux jeux de la manche, à la révélation. Cliquable quand IGDB a
// reconnu le titre — sinon c'est une simple vignette, et surtout pas un bouton
// mort qui ne répondrait pas.
function GameReveal({ label, name, cover, gameId, odd, onOpen }) {
  const body = (
    <>
      {cover ? (
        <img src={cover} alt="" loading="lazy" draggable="false" />
      ) : (
        <span className="imp-game-ph" aria-hidden="true">
          <Gamepad2 size={20} />
        </span>
      )}
      <em>{label}</em>
      <b>{name}</b>
      {gameId ? (
        <span className="imp-game-open">
          <Gamepad2 size={12} /> voir la fiche
        </span>
      ) : null}
    </>
  );
  const cls = `imp-game ${odd ? "imp" : ""}`;
  return gameId ? (
    <button className={`${cls} clickable`} onClick={(e) => onOpen(gameId, e)}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

// ============================================================
//  Le tableau final
// ============================================================
function Final({ room, onQuit }) {
  const table = [...room.players].filter((p) => !p.left).sort((a, b) => b.score - a.score);
  const champ = table[0];
  return (
    <section className="imp-final">
      {champ && (
        <div className="imp-champ">
          <Crown size={22} />
          <Avatar p={champ} big />
          <b>{champ.username}</b>
          <span>{champ.escapes > 0 ? `${champ.escapes} évasion(s)` : "meilleur enquêteur"}</span>
        </div>
      )}

      <ol className="imp-final-list">
        {table.map((p, i) => (
          <li key={p.id} className={p.isMe ? "me" : ""}>
            <span className={`imp-rank r${i + 1}`}>{i + 1}</span>
            <Avatar p={p} />
            <span className="imp-tally-who">{p.username}</span>
            <span className="imp-final-esc">
              <VenetianMask size={12} /> {p.escapes}
            </span>
            <span className="imp-tally-pts up">{p.score}</span>
          </li>
        ))}
      </ol>

      <div className="imp-final-actions">
        <Link to="/imposteur" className="imp-go clickable">
          Rouvrir un salon
        </Link>
        <button className="imp-quiet clickable" onClick={onQuit}>
          Retour à l&apos;arcade
        </button>
      </div>
    </section>
  );
}

// ============================================================
//  Communs
// ============================================================
function Avatar({ p, big, small }) {
  const cls = `imp-av ${big ? "big" : ""} ${small ? "small" : ""}`;
  if (!p) return <span className={`${cls} ph`}>?</span>;
  return p.avatar ? (
    <img className={cls} src={p.avatar} alt="" loading="lazy" draggable="false" />
  ) : (
    <span className={`${cls} ph`}>{(p.username || "?")[0].toUpperCase()}</span>
  );
}
