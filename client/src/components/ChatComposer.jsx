import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import EmojiPanel from "./EmojiPanel";
import { GifPanel, renderHighlight } from "./ListComments";
import { apiUpload } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { useClickOutside } from "../hooks/useClickOutside";

const MAX_MEDIA = 4;
const MAX_CHARS = 2000;
const EMPTY_MENTIONS = new Set();

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

  // Dès qu'on écrit (ou qu'on a joint un média), les boutons GIF/image se
  // rangent dans un « + » et l'input gagne de la largeur.
  const collapsed = text.length > 0 || media.length > 0;

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

      <div
        className={`chat-composer-row ${collapsed ? "is-collapsed" : ""}`}
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
      </div>
    </div>
  );
}
