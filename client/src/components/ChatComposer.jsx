import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Smile,
  ImagePlus,
  Send,
  X,
  Loader2,
  Reply,
  Pencil,
  Plus,
  Film,
  Mic,
  Trash2,
  Check,
  Sparkles,
  Scissors,
  Bird,
  Ghost,
  Bot,
} from "lucide-react";
import EmojiPanel from "./EmojiPanel";
import { GifPanel, renderHighlight } from "./ListComments";
import { apiUpload } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { useClickOutside } from "../hooks/useClickOutside";
import { canRecord, startRecording } from "../lib/voiceRecorder";
import {
  VOICE_EFFECTS,
  renderVoice,
  sliceWaveform,
  canApplyEffects,
} from "../lib/voiceFx";
import VoiceDraft from "./VoiceDraft";

const MAX_MEDIA = 4;
const MAX_CHARS = 2000;
const EMPTY_MENTIONS = new Set();
// Au-delà, ce n'est plus un message vocal (et le serveur refuse : MAX_VOICE_SEC).
const MAX_VOICE_SEC = 300;
const fmtSec = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// L'icône d'un effet. La correspondance vit ICI et pas dans lib/voiceFx.js :
// la bibliothèque d'effets ne connaît que du son, elle n'a pas à importer des
// composants d'interface.
const FX_ICONS = { mic: Mic, bird: Bird, ghost: Ghost, bot: Bot };
function FxIcon({ id, size }) {
  const Ico = FX_ICONS[id] || Sparkles;
  return <Ico size={size} />;
}

// Sur écran tactile, Entrée doit passer à la ligne (le clavier virtuel n'a pas
// de Maj pratique) : l'envoi se fait au bouton. Sur clavier physique, Entrée
// envoie et Maj+Entrée saute une ligne — comme partout ailleurs.
const isTouch = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)")?.matches;

export default function ChatComposer({
  token,
  conversationId,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onSend,
  onEdit,
  onTyping,
  // Pseudos des participants : les @mentions du fil se colorent pendant la frappe.
  mentionNames,
  // Place le curseur dans le champ à l'ouverture (fenêtres flottantes).
  autoFocus,
}) {
  const [text, setText] = useState("");
  const [media, setMedia] = useState([]);
  const [panel, setPanel] = useState(null); // null | "emoji" | "gif"
  const [plusOpen, setPlusOpen] = useState(false); // menu « + » (GIF / image) replié
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // --- Message vocal ---------------------------------------------------
  // `rec` : null (rien en cours) | { sec, levels } pendant l'enregistrement.
  // `voiceBusy` : le fichier part vers le serveur.
  const [rec, setRec] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const recRef = useRef(null); // la poignée de lib/voiceRecorder
  const recTimerRef = useRef(null);
  const cancelRef = useRef(false); // le geste a été relâché « en annulation »

  // --- Le vocal enregistré, AVANT envoi ---------------------------------
  // On ne part plus directement : relâcher (ou cliquer sur stop) dépose le
  // message ICI, où on peut se réécouter, changer d'avis, ou lui coller une
  // voix de canard. Rien ne quitte le navigateur tant qu'on n'a pas envoyé.
  const [draft, setDraft] = useState(null); // { blob, mimeType, duration, waveform }
  const [fx, setFx] = useState("none"); // effet choisi
  const [fxBusy, setFxBusy] = useState(false);
  const [fxOpen, setFxOpen] = useState(false); // la liste des effets est ouverte
  // Bornes conservées, en FRACTIONS du message : elles survivent au changement
  // d'effet, qui change la durée (le canard parle plus vite).
  const [trim, setTrim] = useState({ a: 0, b: 1 });
  const [trimOn, setTrimOn] = useState(false); // les poignées sont demandées
  // Les rendus déjà calculés, par effet : réécouter « canard » après être passé
  // par « robot » ne relance aucun calcul.
  const fxCacheRef = useRef(new Map());
  const fxRef = useRef(null);
  const currentFx = VOICE_EFFECTS.find((e) => e.id === fx) || VOICE_EFFECTS[0];

  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const panelRef = useRef(null);
  const hlRef = useRef(null); // calque de rendu aligné sur le textarea
  const lastPing = useRef(0);

  // Un textarea ne sait afficher que les emojis SYSTÈME : pour retrouver ceux
  // du sélecteur (style Twitter), on rend le texte dans un calque en dessous
  // (twemoji) et on rend celui du textarea transparent — même technique que le
  // composer des commentaires.
  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Ouverture d'une fenêtre flottante : curseur direct dans le champ.
  useEffect(() => {
    if (autoFocus) focusInput();
  }, [autoFocus, focusInput]);

  function syncScroll() {
    if (hlRef.current && inputRef.current) {
      hlRef.current.scrollTop = inputRef.current.scrollTop;
      hlRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

  useClickOutside(
    panelRef,
    () => {
      setPanel(null);
      setPlusOpen(false);
    },
    !!panel || plusOpen
  );

  // La liste des effets se referme dès qu'on clique ailleurs — y compris sur
  // les poignées de rognage, juste au-dessus.
  useClickOutside(fxRef, () => setFxOpen(false), fxOpen);

  // Dès qu'on écrit (ou qu'on a joint un média), les boutons GIF/image se
  // rangent dans un « + » et l'input gagne de la largeur. Sur téléphone, ils y
  // restent TOUJOURS : la place est trop précieuse pour deux boutons de plus.
  const isPhone =
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 760px)")?.matches;
  const collapsed = isPhone || text.length > 0 || media.length > 0;

  // Changement de conversation : on repart d'un champ vierge.
  useEffect(() => {
    setText("");
    setMedia([]);
    setPanel(null);
    setPlusOpen(false);
    setError(null);
  }, [conversationId]);

  // Passage en mode édition : le message à corriger remplit le champ.
  useEffect(() => {
    if (!editing) return;
    setText(editing.text || "");
    inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Champ qui grandit avec le texte, jusqu'à une limite raisonnable. La barre
  // de défilement n'apparaît qu'une fois cette limite atteinte (sinon un
  // arrondi d'un pixel suffit à la faire surgir en permanence).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const full = el.scrollHeight;
    el.style.height = `${Math.min(full, 160)}px`;
    el.style.overflowY = full > 160 ? "auto" : "hidden";
    syncScroll();
  }, [text]);

  const canSend = (text.trim() || media.length) && !busy && !uploading;

  const uploadFiles = useCallback(
    async (fileList) => {
      const files = [...fileList]
        .filter((f) => f.type.startsWith("image/"))
        .slice(0, MAX_MEDIA - media.length);
      if (!files.length) return;
      setError(null);
      setUploading(true);
      try {
        const uploaded = await Promise.all(
          files.map(async (f) => {
            // Une photo de téléphone fait 4-8 Mo : on la réduit avant l'envoi
            // (les GIF passent intacts, pour garder l'animation).
            const small = await compressImage(f);
            const fd = new FormData();
            fd.append("media", small);
            const d = await apiUpload("/chat/media", fd, token);
            return d.media;
          })
        );
        setMedia((prev) => [...prev, ...uploaded].slice(0, MAX_MEDIA));
        // On enchaîne presque toujours sur une légende : le curseur revient
        // dans le champ tout seul.
        focusInput();
      } catch (err) {
        setError(err.message);
      } finally {
        setUploading(false);
      }
    },
    [media.length, token, focusInput]
  );

  function onPaste(e) {
    const imgs = [...(e.clipboardData?.items || [])]
      .filter((it) => it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter(Boolean);
    if (imgs.length) {
      e.preventDefault();
      uploadFiles(imgs);
    }
  }

  function insertEmoji(emo) {
    const el = inputRef.current;
    if (!el) return setText((t) => t + emo);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText((t) => t.slice(0, start) + emo + t.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emo.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onChange(e) {
    setText(e.target.value);
    // « … est en train d'écrire » : au plus un signal toutes les 2,5 s.
    const now = Date.now();
    if (now - lastPing.current > 2500) {
      lastPing.current = now;
      onTyping?.(false);
    }
  }

  async function submit() {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) await onEdit(editing.id, text.trim());
      else await onSend({ text: text.trim(), media });
      setText("");
      setMedia([]);
      setPanel(null);
      lastPing.current = 0;
      onTyping?.(true); // stop
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ============================================================
  //  Message vocal
  // ============================================================
  // DEUX GESTES POUR DEUX MAINS, et c'est délibéré.
  //
  //  - AU DOIGT, on MAINTIENT le micro : c'est le geste que tout le monde
  //    connaît, il n'y a rien à apprendre, et relâcher envoie. Glisser vers la
  //    gauche avant de relâcher annule — l'échappatoire, indispensable quand on
  //    se rate à mi-phrase.
  //  - À LA SOURIS, on CLIQUE pour démarrer et on clique pour envoyer. Tenir un
  //    bouton pendant trente secondes au clavier-souris est pénible, et rien
  //    n'oblige à copier une convention tactile sur un ordinateur.
  //
  // Le même bouton porte les deux : c'est l'évènement reçu (pointer grossier ou
  // fin) qui décide, pas une détection d'appareil.
  // Fin de l'enregistrement. `keep` = on garde le résultat (il passe en
  // relecture), sinon on jette tout de suite.
  const stopRecording = useCallback(async (keep) => {
    clearInterval(recTimerRef.current);
    const handle = recRef.current;
    recRef.current = null;
    setRec(null);
    if (!handle) return;
    if (!keep) return handle.cancel();

    const out = await handle.stop();
    // Moins d'une seconde : c'est un appui raté, pas un message. On le jette en
    // silence plutôt que d'imposer une relecture d'un « blip ».
    if (!out || out.duration < 1) return;

    fxCacheRef.current = new Map();
    setFx("none");
    setTrim({ a: 0, b: 1 });
    setTrimOn(false);
    setFxOpen(false);
    setDraft(out);
  }, []);

  // La version à envoyer/écouter pour l'effet choisi. Rendue à la demande, puis
  // gardée : c'est ce qui rend l'essai des effets instantané au second passage.
  const versionFor = useCallback(
    async (id) => {
      const hit = fxCacheRef.current.get(id);
      if (hit) return hit;
      if (!draft) return null;
      if (id === "none") {
        fxCacheRef.current.set(id, draft);
        return draft;
      }
      const done = await renderVoice(draft.blob, { effectId: id });
      // Effet impossible (navigateur trop vieux, décodage refusé) : on retombe
      // sur l'original plutôt que de bloquer l'envoi.
      const out = done ? { ...draft, ...done } : draft;
      fxCacheRef.current.set(id, out);
      return out;
    },
    [draft]
  );

  // Changer d'effet = s'écouter avec, tout de suite. On ne prépare rien à
  // l'avance : trois rendus systématiques pour un effet qu'on ne prendra
  // peut-être pas, c'est du travail pour rien sur un téléphone.
  const chooseFx = useCallback(
    async (id) => {
      if (fxBusy || id === fx) return;
      setFxBusy(true);
      setError(null);
      try {
        await versionFor(id);
        setFx(id);
      } catch {
        setError("Cet effet n'a pas pu être appliqué.");
      } finally {
        setFxBusy(false);
      }
    },
    [fx, fxBusy, versionFor]
  );

  const discardDraft = useCallback(() => {
    fxCacheRef.current = new Map();
    setDraft(null);
    setFx("none");
    setFxOpen(false);
    setTrim({ a: 0, b: 1 });
    setTrimOn(false);
  }, []);

  const sendDraft = useCallback(async () => {
    if (!draft || voiceBusy) return;
    setVoiceBusy(true);
    setError(null);
    try {
      // Le rognage n'est appliqué qu'ICI : pendant la relecture, il ne coûte
      // que des bornes de lecture. Le cuire à chaque déplacement de poignée
      // referait un rendu complet pour rien.
      const cut = trim.a > 0.001 || trim.b < 0.999;
      let out = (await versionFor(fx)) || draft;
      if (cut) {
        const done = await renderVoice(draft.blob, {
          effectId: fx,
          start: trim.a,
          end: trim.b,
        });
        // `renderVoice` ne rend que l'audio : on lui rattache la silhouette du
        // morceau gardé, sinon la bulle dessinerait le message entier au-dessus
        // d'un son raccourci.
        if (done)
          out = {
            ...out,
            ...done,
            waveform: sliceWaveform(draft.waveform, trim.a, trim.b),
          };
      }
      const ext = out.mimeType.includes("wav")
        ? ".wav"
        : out.mimeType.includes("mp4")
          ? ".m4a"
          : out.mimeType.includes("ogg")
            ? ".ogg"
            : ".webm";
      const fd = new FormData();
      fd.append("voice", out.blob, `voice${ext}`);
      fd.append("duration", String(out.duration));
      fd.append("waveform", JSON.stringify(out.waveform));
      const d = await apiUpload("/chat/voice", fd, token);
      await onSend({ voice: d.voice });
      discardDraft();
    } catch (err) {
      setError(err.message);
    } finally {
      setVoiceBusy(false);
    }
  }, [draft, fx, trim, voiceBusy, versionFor, token, onSend, discardDraft]);

  // L'URL locale que la bulle de relecture joue : celle de l'effet en cours.
  //
  // ⚠️ ELLE SE FABRIQUE DANS UN EFFET, JAMAIS PENDANT LE RENDU. Elle était
  // créée (et l'ancienne révoquée) dans un `useMemo`, et ça donnait « Vocal
  // indisponible » à la relecture : React réexécute librement un calcul
  // mémorisé — deux fois par rendu en mode strict, ou après avoir jeté son
  // cache — et chaque réexécution RÉVOQUAIT l'URL que la bulle était en train
  // de lire. Le fichier n'a jamais eu de problème : une fois envoyé, il se lit
  // depuis le serveur, sans URL locale, d'où « une fois envoyé c'est bon ».
  //
  // Dans un effet, création et révocation sont attachées au cycle de vie : le
  // nettoyage ne tourne qu'au démontage ou au changement d'enregistrement /
  // d'effet, donc toujours APRÈS que la bulle qui lisait l'URL a disparu.
  const [draftUrl, setDraftUrl] = useState(null);

  useEffect(() => {
    if (!draft) {
      setDraftUrl(null);
      return undefined;
    }
    const v = fxCacheRef.current.get(fx) || draft;
    const url = URL.createObjectURL(v.blob);
    setDraftUrl(url);
    return () => URL.revokeObjectURL(url);
    // Volontairement PAS `fxBusy` : `fx` ne change qu'une fois le rendu de
    // l'effet abouti, donc il suffit à lui seul.
  }, [draft, fx]);

  const draftVoice = useMemo(() => {
    if (!draft || !draftUrl) return null;
    const v = fxCacheRef.current.get(fx) || draft;
    return { url: draftUrl, duration: v.duration, waveform: v.waveform };
  }, [draft, fx, draftUrl]);

  // Y a-t-il vraiment une coupe, et que reste-t-il ? Sert au bouton « Rogner »,
  // qui doit annoncer l'état une fois les poignées rangées.
  const cutting = trim.a > 0.001 || trim.b < 0.999;
  const keptSec = (trim.b - trim.a) * (draftVoice?.duration || 0);

  const beginRecording = useCallback(async () => {
    if (recRef.current || voiceBusy) return;
    cancelRef.current = false;
    setError(null);
    try {
      const handle = await startRecording();
      // La personne a pu relâcher pendant que le navigateur demandait le micro.
      if (cancelRef.current) return handle.cancel();
      recRef.current = handle;
      setMicDenied(false);
      setRec({ sec: 0, levels: [] });
      navigator.vibrate?.(12);
      // Le chrono se LIT sur l'horloge, il ne s'additionne pas : un onglet en
      // arrière-plan ralentit les intervalles, et un compteur cumulé finirait
      // par mentir sur la durée réelle du message.
      const from = Date.now();
      recTimerRef.current = setInterval(() => {
        const sec = (Date.now() - from) / 1000;
        // Butée dure : on envoie ce qui est enregistré plutôt que de couper au
        // milieu d'une phrase sans rien dire.
        if (sec >= MAX_VOICE_SEC) return stopRecording(true);
        // Les niveaux récents seulement : c'est un vumètre, pas un historique.
        setRec({ sec, levels: handle.levels.slice(-56) });
      }, 100);
    } catch {
      // Micro refusé ou indisponible : on le dit UNE fois, sans modale.
      setMicDenied(true);
    }
  }, [voiceBusy, stopRecording]);

  // Le doigt glisse vers la gauche pendant l'enregistrement → zone d'annulation.
  const [slideCancel, setSlideCancel] = useState(false);
  const touchStartX = useRef(0);

  const onMicPointerDown = (e) => {
    // Souris : bascule (clic pour démarrer, clic pour envoyer).
    if (e.pointerType === "mouse") {
      if (recRef.current) stopRecording(true);
      else beginRecording();
      return;
    }
    touchStartX.current = e.clientX;
    setSlideCancel(false);
    beginRecording();
  };
  const onMicPointerMove = (e) => {
    if (e.pointerType === "mouse" || !recRef.current) return;
    setSlideCancel(touchStartX.current - e.clientX > 70);
  };
  const onMicPointerUp = (e) => {
    if (e.pointerType === "mouse") return;
    cancelRef.current = true; // couvre le relâchement pendant la demande de micro
    if (!recRef.current) return;
    stopRecording(!slideCancel);
    setSlideCancel(false);
  };

  // On quitte la conversation (ou la page) le micro ouvert : on coupe. Un
  // enregistrement orphelin garderait la pastille rouge du navigateur allumée.
  useEffect(
    () => () => {
      clearInterval(recTimerRef.current);
      recRef.current?.cancel();
      recRef.current = null;
    },
    []
  );

  function onKeyDown(e) {
    if (e.key === "Escape") {
      if (panel) return setPanel(null);
      if (editing) return onCancelEdit?.();
      if (replyTo) return onCancelReply?.();
    }
    if (e.key === "Enter" && !e.shiftKey && !isTouch()) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="chat-composer">
      {/* Bandeau contextuel : réponse citée ou message en cours de correction */}
      {(replyTo || editing) && (
        <div className={`chat-ctx ${editing ? "is-edit" : ""}`}>
          {editing ? <Pencil size={14} /> : <Reply size={14} />}
          <span className="chat-ctx-body">
            <strong>
              {editing
                ? "Modification"
                : `Réponse à ${replyTo.author?.username || "…"}`}
            </strong>
            <span className="chat-ctx-text">
              {editing
                ? editing.text
                : replyTo.text || (replyTo.media?.length ? "Photo" : "")}
            </span>
          </span>
          <button
            type="button"
            className="chat-ctx-x clickable"
            onClick={() => (editing ? onCancelEdit?.() : onCancelReply?.())}
            aria-label="Annuler"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Pièces jointes en attente */}
      {(media.length > 0 || uploading) && (
        <div className="chat-attach">
          {media.map((m, i) => (
            <div className="chat-attach-item" key={i}>
              <img src={m.url} alt="" />
              {m.kind === "gif" && <span className="chat-attach-tag">GIF</span>}
              <button
                type="button"
                className="chat-attach-x clickable"
                onClick={() => setMedia((prev) => prev.filter((_, k) => k !== i))}
                aria-label="Retirer"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {uploading && (
            <div className="chat-attach-item chat-attach-loading">
              <Loader2 size={16} className="spin" />
            </div>
          )}
        </div>
      )}

      {error && <p className="chat-error">{error}</p>}
      {micDenied && (
        <p className="chat-error">
          Micro indisponible — autorise-le dans les réglages du navigateur.
        </p>
      )}

      {/* ---- Enregistrement en cours : la barre remplace tout le reste ----
          Pendant qu'on parle, il n'y a plus qu'une chose à faire (parler) et
          deux issues (envoyer, jeter). Laisser le champ de texte, les émojis et
          les GIF à côté ne ferait qu'ajouter du bruit et des cibles à rater. */}
      {rec && (
        <div className={`chat-rec ${slideCancel ? "cancelling" : ""}`}>
          <button
            type="button"
            className="chat-rec-trash clickable"
            onClick={() => stopRecording(false)}
            aria-label="Annuler l'enregistrement"
          >
            <Trash2 size={17} />
          </button>

          <span className="chat-rec-dot" aria-hidden="true" />
          <span className="chat-rec-time">{fmtSec(rec.sec)}</span>

          {/* Vumètre en direct : la preuve visible que le micro entend. Sans
              lui, on parle dans le vide en espérant que ça marche. */}
          <span className="chat-rec-wave" aria-hidden="true">
            {rec.levels.map((l, i) => (
              <i key={i} style={{ height: `${Math.max(8, l)}%` }} />
            ))}
          </span>

          {/* Le vocal ne part plus au relâchement : il passe en relecture. On
              le dit ici, sinon on croit l'avoir envoyé. */}
          <span className="chat-rec-hint">
            {slideCancel ? "Relâche pour annuler" : "Relâche pour te réécouter"}
          </span>

          <button
            type="button"
            className="chat-rec-send clickable"
            onClick={() => stopRecording(true)}
            aria-label="Terminer l'enregistrement"
            title="Terminer et se réécouter"
          >
            <Check size={18} />
          </button>
        </div>
      )}

      {/* ---- Relecture avant envoi ----
          Rien n'a encore quitté le navigateur. On s'écoute, on essaie une voix,
          et ce n'est qu'au bouton d'envoi que le fichier part. */}
      {draft && (
        <div className="chat-draft">
          <div className="chat-draft-top">
            <button
              type="button"
              className="chat-rec-trash clickable"
              onClick={discardDraft}
              aria-label="Supprimer l'enregistrement"
            >
              <Trash2 size={17} />
            </button>

            {draftVoice && (
              <div className="chat-draft-play">
                <VoiceDraft
                  key={draftVoice.url}
                  url={draftVoice.url}
                  duration={draftVoice.duration}
                  waveform={draftVoice.waveform}
                  trim={trim}
                  onTrim={setTrim}
                  trimming={trimOn}
                />
              </div>
            )}

            <button
              type="button"
              className="chat-rec-send clickable"
              onClick={sendDraft}
              disabled={voiceBusy || fxBusy}
              aria-label="Envoyer le message vocal"
            >
              {voiceBusy ? <Loader2 size={18} className="spin" /> : <Send size={17} />}
            </button>
          </div>

          {/* Les effets sont RANGÉS derrière un bouton. Étalés en permanence,
              quatre pastilles occupaient la barre alors qu'on n'y touche
              qu'une fois sur dix — et le rognage, lui, sert à chaque message. */}
          {canApplyEffects() && (
            <div className="chat-fx-row" ref={fxRef}>
              <button
                type="button"
                className={`chat-fx-open clickable ${fxOpen ? "on" : ""} ${
                  fx !== "none" ? "picked" : ""
                }`}
                onClick={() => setFxOpen((v) => !v)}
                disabled={fxBusy}
              >
                {fxBusy ? (
                  <Loader2 size={14} className="spin" />
                ) : fx === "none" ? (
                  <Sparkles size={14} />
                ) : (
                  <FxIcon id={currentFx.icon} size={14} />
                )}
                {fx === "none" ? "Ajouter un effet" : currentFx.label}
              </button>

              {/* L'effet actif se retire d'un geste, sans rouvrir la liste. */}
              {fx !== "none" && !fxBusy && (
                <button
                  type="button"
                  className="chat-fx-clear clickable"
                  onClick={() => chooseFx("none")}
                  aria-label="Retirer l'effet"
                >
                  <X size={13} />
                </button>
              )}

              {/* Refermer les poignées GARDE la coupe — sinon régler puis
                  ranger la ferait perdre. Mais elle ne devient jamais
                  invisible pour autant : le bouton annonce alors ce qu'il
                  reste, et la croix la retire d'un geste. */}
              <button
                type="button"
                className={`chat-fx-open clickable ${trimOn || cutting ? "picked" : ""}`}
                onClick={() => {
                  setTrimOn((v) => !v);
                  setFxOpen(false);
                }}
              >
                <Scissors size={14} />
                {trimOn ? "Terminer" : cutting ? `Rogné · ${fmtSec(keptSec)}` : "Rogner"}
              </button>
              {cutting && !trimOn && (
                <button
                  type="button"
                  className="chat-fx-clear clickable"
                  onClick={() => setTrim({ a: 0, b: 1 })}
                  aria-label="Rétablir le message entier"
                >
                  <X size={13} />
                </button>
              )}

              {fxOpen && (
                <div className="chat-fx-pop">
                  {VOICE_EFFECTS.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className={`chat-fx-card clickable ${fx === e.id ? "on" : ""}`}
                      onClick={() => {
                        chooseFx(e.id);
                        setFxOpen(false);
                      }}
                      disabled={fxBusy}
                    >
                      <span className="chat-fx-ico">
                        <FxIcon id={e.icon} size={18} />
                      </span>
                      <span className="chat-fx-name">{e.label}</span>
                      <span className="chat-fx-hint">{e.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div
        className={`chat-composer-row ${collapsed ? "is-collapsed" : ""} ${
          rec || draft ? "is-hidden" : ""
        }`}
        ref={panelRef}
      >
        {panel && (
          <div className={`chat-pop chat-pop-${panel} ${panel === "emoji" ? "right" : ""}`}>
            {panel === "emoji" ? (
              <EmojiPanel onPick={insertEmoji} height={320} />
            ) : (
              <GifPanel
                token={token}
                onPick={(g) => {
                  setMedia((prev) =>
                    [
                      ...prev,
                      { kind: "gif", url: g.url, width: g.width, height: g.height },
                    ].slice(0, MAX_MEDIA)
                  );
                  setPanel(null);
                  focusInput();
                }}
              />
            )}
          </div>
        )}

        {/* GIF + image : visibles quand le champ est vide, rangés dans un « + »
            dès qu'on écrit. */}
        {collapsed ? (
          <div className="chat-plus-wrap">
            <button
              type="button"
              className={`chat-tool clickable ${plusOpen ? "on" : ""}`}
              onClick={() => setPlusOpen((v) => !v)}
              disabled={media.length >= MAX_MEDIA}
              title="Ajouter"
              aria-label="Ajouter un GIF ou une image"
            >
              <Plus size={20} />
            </button>
            {plusOpen && (
              <div className="chat-plus-menu">
                <button
                  type="button"
                  className="chat-plus-item clickable"
                  onClick={() => {
                    setPlusOpen(false);
                    setPanel((p) => (p === "gif" ? null : "gif"));
                  }}
                  disabled={media.length >= MAX_MEDIA}
                >
                  <Film size={17} /> GIF
                </button>
                <button
                  type="button"
                  className="chat-plus-item clickable"
                  onClick={() => {
                    setPlusOpen(false);
                    fileRef.current?.click();
                  }}
                  disabled={media.length >= MAX_MEDIA}
                >
                  <ImagePlus size={17} /> Image
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              className={`chat-tool chat-tool-gif clickable ${panel === "gif" ? "on" : ""}`}
              onClick={() => setPanel((p) => (p === "gif" ? null : "gif"))}
              disabled={media.length >= MAX_MEDIA}
              title="GIF"
            >
              GIF
            </button>
            <button
              type="button"
              className="chat-tool clickable"
              onClick={() => fileRef.current?.click()}
              disabled={media.length >= MAX_MEDIA}
              title="Image (ou Ctrl+V)"
            >
              <ImagePlus size={20} />
            </button>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Champ de saisie, avec le bouton émoji posé dedans (à droite). */}
        <div className="chat-input-box">
          <div className="chat-input-field">
            {/* Calque de rendu : c'est LUI qu'on voit (emojis twemoji, mentions
                et liens colorés). Le textarea au-dessus n'a plus que son
                curseur et sa sélection. */}
            <div className="chat-input-hl" ref={hlRef} aria-hidden="true">
              {renderHighlight(text, mentionNames || EMPTY_MENTIONS)}
              {"​"}
            </div>
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              maxLength={MAX_CHARS}
              placeholder={editing ? "Modifier le message…" : "Écris un message…"}
              value={text}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={syncScroll}
              onBlur={() => onTyping?.(true)}
            />
          </div>
          <button
            type="button"
            className={`chat-emoji-in clickable ${panel === "emoji" ? "on" : ""}`}
            onClick={() => setPanel((p) => (p === "emoji" ? null : "emoji"))}
            title="Émoji"
            aria-label="Émoji"
          >
            <Smile size={20} />
          </button>
        </div>

        {/* UN SEUL BOUTON À DROITE, qui dit ce qu'il fera : envoyer s'il y a
            quelque chose à envoyer, enregistrer sinon. Deux boutons côte à côte
            se disputeraient le pouce sur un téléphone, et l'un des deux serait
            toujours inutile. En édition, pas de micro : on corrige du texte. */}
        {canSend || editing || !canRecord() ? (
          <button
            type="button"
            className="chat-send clickable"
            onClick={submit}
            disabled={!canSend}
            aria-label="Envoyer"
            title="Envoyer"
          >
            {busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          </button>
        ) : (
          <button
            type="button"
            className="chat-send chat-mic clickable"
            onPointerDown={onMicPointerDown}
            onPointerMove={onMicPointerMove}
            onPointerUp={onMicPointerUp}
            onPointerCancel={onMicPointerUp}
            onContextMenu={(e) => e.preventDefault()}
            disabled={voiceBusy}
            aria-label="Enregistrer un message vocal"
            title="Message vocal (maintenir au doigt, cliquer à la souris)"
          >
            {voiceBusy ? <Loader2 size={18} className="spin" /> : <Mic size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}
