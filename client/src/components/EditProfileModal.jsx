import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Loader2, AtSign, Sparkles, Smile, User } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useClickOutside } from "../hooks/useClickOutside";
import AddItemsModal from "./AddItemsModal";
import EmojiPanel from "./EmojiPanel";

const BIO_MAX = 50;

// Modal d'édition des infos de profil : identifiant (verrouillé), bio (émojis,
// 50 car.), et alter ego = un personnage de jeu vidéo existant (recherche).
export default function EditProfileModal({ profile, onSaved, onClose }) {
  const { token, updateUser } = useAuth();
  const [bio, setBio] = useState(profile.bio || "");
  const [tagline, setTagline] = useState(profile.tagline || "");
  const [taglineImg, setTaglineImg] = useState(profile.taglineImage || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [showEmoji, setShowEmoji] = useState(false);
  const bioRef = useRef(null);
  const emojiRef = useRef(null);
  useClickOutside(emojiRef, () => setShowEmoji(false), showEmoji);

  // ⚠️ L'ALTER EGO SE CHOISIT DANS LA MÊME MODALE QUE PARTOUT AILLEURS.
  // Il y avait ici un champ d'auto-complétion maison : une ligne de texte, une
  // liste déroulante de noms. Chercher un personnage dont on ne retient que le
  // visage — ou le jeu — n'y marchait pas. `AddItemsModal` le fait déjà, avec
  // les portraits et la recherche par jeu (c'est celle de l'appli mobile), et
  // son mode « un seul » se referme au premier clic.
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Insère un émoji à la position du curseur, en respectant la limite.
  function insertEmoji(emoji) {
    const el = bioRef.current;
    const start = el ? el.selectionStart : bio.length;
    const end = el ? el.selectionEnd : bio.length;
    const next = (bio.slice(0, start) + emoji + bio.slice(end)).slice(0, BIO_MAX);
    setBio(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + emoji.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  }

  function selectChar(c) {
    setTagline(c.name);
    setTaglineImg(c.image || null);
    setPicking(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await apiFetch("/users/me", {
        method: "PUT",
        token,
        body: { bio, tagline, taglineImage: taglineImg },
      });
      updateUser(user);
      onSaved(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal item-edit-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <form className="modal-form" onSubmit={submit}>
          <h2 className="modal-title">Modifier le profil</h2>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="field">
            <label htmlFor="ep-username">Identifiant</label>
            <div className="ep-input-icon disabled">
              <AtSign size={16} />
              <input id="ep-username" value={profile.username || ""} disabled readOnly />
            </div>
            <span className="ep-help">L'identifiant ne peut pas être modifié.</span>
          </div>

          <div className="field">
            <label htmlFor="ep-bio">
              Bio
              <span className="ep-counter">
                {bio.length}/{BIO_MAX}
              </span>
            </label>
            <div className="ep-bio-wrap" ref={emojiRef}>
              <textarea
                id="ep-bio"
                ref={bioRef}
                className="modal-textarea"
                placeholder="Parle un peu de toi, de tes jeux préférés…"
                value={bio}
                maxLength={BIO_MAX}
                rows={2}
                onChange={(e) => setBio(e.target.value)}
              />
              <button
                type="button"
                className={`ep-emoji-btn clickable ${showEmoji ? "on" : ""}`}
                onClick={() => setShowEmoji((v) => !v)}
                title="Émoji"
              >
                <Smile size={18} />
              </button>
              {showEmoji && (
                <div className="ep-emoji-pop">
                  <EmojiPanel onPick={insertEmoji} />
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <label>
              <Sparkles size={13} style={{ verticalAlign: "-2px" }} /> Si j'étais un perso de
              jeu vidéo, je serais…
            </label>
            {/* ⚠️ LE PERSONNAGE EST LE BOUTON. Un « Changer » posé à côté de
                lui disait deux fois la même chose : on clique le visage qu'on
                veut remplacer, c'est le geste qu'on fait de toute façon en
                premier. Le seul bouton qui reste est celui qui fait autre
                chose — retirer. */}
            <div className="ep-char-selected">
              <button
                type="button"
                className={`ep-char-chip clickable ${tagline ? "" : "is-empty"}`}
                onClick={() => setPicking(true)}
                title={tagline ? "Changer de personnage" : "Choisir un personnage"}
              >
                <span className="ep-char-chip-img">
                  {taglineImg ? <img src={taglineImg} alt="" /> : <User size={15} />}
                </span>
                {tagline || "Choisir un personnage"}
              </button>
              {tagline && (
                <button
                  type="button"
                  className="ep-char-clear clickable"
                  onClick={() => {
                    setTagline("");
                    setTaglineImg(null);
                  }}
                >
                  <X size={14} /> Retirer
                </button>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Enregistrer
            </button>
          </div>
        </form>
      </div>

      {picking && (
        <AddItemsModal
          kind="character"
          single
          title="Si j'étais un perso…"
          existing={new Set()}
          onToggle={selectChar}
          onClose={() => setPicking(false)}
        />
      )}
    </div>,
    document.body
  );
}
