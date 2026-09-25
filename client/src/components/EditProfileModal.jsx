import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Loader2, AtSign, Sparkles, Smile, User, CircleAlert } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useClickOutside } from "../hooks/useClickOutside";
import AddItemsModal from "./AddItemsModal";
import EmojiPanel from "./EmojiPanel";

const BIO_MAX = 50;
// Les bornes du pseudo : les mêmes que le serveur (server/lib/username.js), qui
// reste seul juge — on les reprend ici pour bloquer la saisie au bon endroit.
const USERNAME_MAX = 20;
const USERNAME_COOLDOWN_DAYS = 30;

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Les trois pronoms proposés. Pas de quatrième puce « ne pas dire » : c'est
// l'état de départ, et on y revient en recliquant celle qu'on avait prise. Une
// case à cocher pour dire qu'on ne répond pas transforme le silence en
// déclaration.
const PRONOUNS = [
  { value: "il", label: "Il" },
  { value: "elle", label: "Elle" },
  { value: "iel", label: "Iel" },
];

// La phrase d'exemple, accordée comme le fera l'app (cf. server/lib/notify.js
// et client/components/Topbar). On montre CELLE qu'on est en train de régler
// plutôt que de l'expliquer.
const sample = (pronoun) =>
  `s'est abonné${pronoun === "il" ? "" : pronoun === "elle" ? "e" : "·e"} à toi`;

// Modal d'édition des infos de profil : pseudo (un changement tous les 30
// jours), bio (émojis, 50 car.), et alter ego = un personnage de jeu vidéo
// existant (recherche).
export default function EditProfileModal({ profile, onSaved, onClose }) {
  const { token, user: me, updateUser } = useAuth();
  const [username, setUsername] = useState(profile.username || "");
  // Le serveur dit jusqu'à quand le pseudo est figé (null : libre).
  const lockedUntil =
    me?.usernameNextChangeAt && new Date(me.usernameNextChangeAt) > new Date()
      ? me.usernameNextChangeAt
      : null;
  const nameChanged =
    username.trim().toLowerCase() !== String(profile.username || "").toLowerCase();
  // "idle" | "checking" | "ok" | message d'erreur
  const [nameState, setNameState] = useState("idle");
  const [bio, setBio] = useState(profile.bio || "");
  const [tagline, setTagline] = useState(profile.tagline || "");
  const [taglineImg, setTaglineImg] = useState(profile.taglineImage || null);
  // "il" | "elle" | "iel" | null — null étant « je ne le dis pas », qui est le
  // cas par défaut et une réponse parfaitement valable.
  const [pronoun, setPronoun] = useState(profile.pronoun || null);
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

  // Vérifie le pseudo pendant la saisie, une fois la frappe posée : le format,
  // le délai, et si la place est libre — le serveur répond pour les trois.
  useEffect(() => {
    const name = username.trim();
    if (!nameChanged) {
      setNameState("idle");
      return undefined;
    }
    setNameState("checking");
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const d = await apiFetch(`/users/me/username-check?name=${encodeURIComponent(name)}`, {
          token,
        });
        if (alive) setNameState(d.ok ? "ok" : d.error || "Pseudo indisponible.");
      } catch {
        // Vérification impossible (réseau) : on laisse le serveur trancher à
        // l'enregistrement plutôt que de bloquer le bouton.
        if (alive) setNameState("idle");
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [username, nameChanged, token]);

  const nameError = nameState !== "idle" && nameState !== "checking" && nameState !== "ok";

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
    if (busy || nameError || nameState === "checking") return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await apiFetch("/users/me", {
        method: "PUT",
        token,
        body: {
          bio,
          tagline,
          taglineImage: taglineImg,
          pronoun,
          ...(username.trim() !== profile.username ? { username: username.trim() } : {}),
        },
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
            <label htmlFor="ep-username">Pseudo</label>
            <div className={`ep-input-icon ${lockedUntil ? "disabled" : ""} ${nameError ? "invalid" : ""}`}>
              <AtSign size={16} />
              <input
                id="ep-username"
                value={username}
                maxLength={USERNAME_MAX}
                autoComplete="off"
                spellCheck={false}
                disabled={!!lockedUntil}
                readOnly={!!lockedUntil}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
              />
              {nameState === "checking" && <Loader2 size={15} className="spin" />}
              {nameState === "ok" && <Check size={15} className="ep-name-ok" />}
              {nameError && <CircleAlert size={15} className="ep-name-bad" />}
            </div>
            <span className={`ep-help ${nameError ? "is-error" : ""}`}>
              {lockedUntil
                ? `Prochain changement possible le ${fmtDate(lockedUntil)}.`
                : nameError
                  ? nameState
                  : nameChanged
                    ? `Après ça, plus de changement pendant ${USERNAME_COOLDOWN_DAYS} jours. L'ancien lien de ton profil ne marchera plus.`
                    : `Un changement tous les ${USERNAME_COOLDOWN_DAYS} jours. Lettres, chiffres, _ . -`}
            </span>
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

          {/* --- Le pronom ---
              ⚠️ IL NE S'AFFICHE NULLE PART SUR LE PROFIL, et ce n'est pas un
              oubli. Ce réglage ne sert pas à se présenter, il sert à ce que
              l'application PARLE JUSTE : « Mael s'est abonnée à toi » plutôt
              que « s'est abonné ». C'est de la grammaire, pas une étiquette de
              plus sur une fiche.

              Ne rien choisir est la valeur par défaut et une réponse valable :
              l'app écrit alors en inclusif, qui n'affirme rien de personne. */}
          <div className="field">
            <label>Pronom</label>
            <div className="ep-pronouns">
              {PRONOUNS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`ep-pronoun clickable ${pronoun === p.value ? "on" : ""}`}
                  aria-pressed={pronoun === p.value}
                  // Recliquer celui qui est pris le retire : c'est le seul
                  // geste qui ramène à « je ne le dis pas ».
                  onClick={() => setPronoun((v) => (v === p.value ? null : p.value))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="ep-sample">
              {profile.username} {sample(pronoun)}
            </span>
            <span className="ep-help">
              Sert uniquement à accorder les phrases qui parlent de toi. Sans choix,
              l'app écrit en inclusif.
            </span>
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || nameError || nameState === "checking"}
            >
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
