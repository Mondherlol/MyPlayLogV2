import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  Search,
  Users,
  X,
  Check,
  AlertTriangle,
  ChevronLeft,
  ArrowRight,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// Création d'un GROUPE en deux temps : on choisit d'abord les membres, puis on
// donne (facultativement) un nom au groupe. Les discussions à deux ne passent
// plus par ici : tous nos abonnés ont déjà un fil prêt dans la liste.
// Sert aussi à AJOUTER des gens à un groupe existant (`mode="add"`, une seule
// étape : pas de nom à redonner).
export default function NewChatModal({
  token,
  mode = "new",
  excludeIds = [],
  onClose,
  onCreate,
  onOpenExisting,
}) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState("");
  const [step, setStep] = useState("pick"); // "pick" | "name"
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Groupe déjà existant avec les mêmes membres, signalé par le serveur (409).
  const [duplicate, setDuplicate] = useState(null);

  const nameRef = useRef(null);
  const excluded = useMemo(() => new Set(excludeIds.map(String)), [excludeIds]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      apiFetch(`/chat/contacts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`, {
        token,
      })
        .then((d) => setContacts(d.contacts || []))
        .catch(() => setContacts([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q, token]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Étape « nom » : on met le curseur dans le champ.
  useEffect(() => {
    if (step === "name") nameRef.current?.focus();
  }, [step]);

  const visible = contacts.filter((c) => !excluded.has(String(c.id)));

  function toggle(u) {
    setDuplicate(null);
    setPicked((prev) =>
      prev.some((p) => p.id === u.id)
        ? prev.filter((p) => p.id !== u.id)
        : [...prev, u]
    );
  }

  // Ajout à un groupe existant : une seule personne suffit. Nouveau groupe : au
  // moins deux (à une, la discussion existe déjà dans la liste).
  const enoughPicked = mode === "add" ? picked.length >= 1 : picked.length >= 2;

  async function create(force = false) {
    setBusy(true);
    setError(null);
    try {
      await onCreate(picked.map((p) => p.id), name.trim(), force);
      onClose();
    } catch (err) {
      if (err.data?.duplicate) setDuplicate(err.data.duplicate);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Bouton principal : « Ajouter » (mode add) ; sinon « Suivant » puis « Créer ».
  function onPrimary() {
    if (mode === "add") return create(false);
    if (step === "pick") return setStep("name");
    return create(false);
  }

  const onNameStep = mode === "new" && step === "name";

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal chat-new-modal">
        <button className="modal-close clickable" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>
        <h2 className="modal-title">
          {onNameStep ? (
            <button
              type="button"
              className="chat-new-back clickable"
              onClick={() => setStep("pick")}
              aria-label="Retour"
            >
              <ChevronLeft size={20} />
            </button>
          ) : (
            <Users size={18} />
          )}
          {mode === "add"
            ? "Ajouter au groupe"
            : onNameStep
            ? "Nommer le groupe"
            : "Nouveau groupe"}
        </h2>

        {/* ---------------- Étape 1 : choix des membres ---------------- */}
        {!onNameStep && (
          <>
            {picked.length > 0 && (
              <div className="chat-picked">
                {picked.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="chat-chip clickable"
                    onClick={() => toggle(p)}
                    title={`Retirer ${p.username}`}
                  >
                    <span className="chat-chip-av">
                      {p.avatar ? (
                        <img src={p.avatar} alt="" />
                      ) : (
                        p.username[0].toUpperCase()
                      )}
                    </span>
                    {p.username}
                    <X size={13} />
                  </button>
                ))}
              </div>
            )}

            <label className="chat-search">
              <Search size={15} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Rechercher un joueur…"
              />
              {loading && <Loader2 size={14} className="spin" />}
            </label>

            <div className="chat-contacts">
              {!loading && visible.length === 0 && (
                <p className="chat-contacts-empty font-fun">
                  {q.trim()
                    ? "Personne à ce nom parmi tes abonnés."
                    : "Seuls tes abonnés peuvent rejoindre un groupe."}
                </p>
              )}
              {visible.map((u) => {
                const on = picked.some((p) => p.id === u.id);
                return (
                  <button
                    type="button"
                    key={u.id}
                    className={`chat-contact clickable ${on ? "on" : ""}`}
                    onClick={() => toggle(u)}
                  >
                    <span className="chat-contact-av">
                      {u.avatar ? (
                        <img src={u.avatar} alt="" />
                      ) : (
                        u.username[0].toUpperCase()
                      )}
                    </span>
                    <span className="chat-contact-name">{u.username}</span>
                    {u.relation === "mutual" && <span className="chat-rel">Ami</span>}
                    {u.relation === "follower" && <span className="chat-rel">Abonné</span>}
                    {on && <Check size={16} className="chat-contact-check" />}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ---------------- Étape 2 : nom du groupe ---------------- */}
        {onNameStep && (
          <div className="chat-name-step">
            <p className="chat-name-members">
              {picked.length} membre{picked.length > 1 ? "s" : ""} :{" "}
              <strong>{picked.map((p) => p.username).join(", ")}</strong>
            </p>
            <input
              ref={nameRef}
              className="chat-name-input"
              placeholder="Nom du groupe (facultatif)"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && create(false)}
            />
            <p className="chat-name-hint font-fun">
              Sans nom, le groupe portera les pseudos de ses membres.
            </p>
          </div>
        )}

        {error && <p className="chat-error">{error}</p>}

        {duplicate && (
          <div className="chat-dup-warn">
            <AlertTriangle size={17} />
            <div className="chat-dup-body">
              <strong>Tu as déjà ce groupe</strong>
              <span>
                «&nbsp;{duplicate.title}&nbsp;» réunit exactement les mêmes membres.
              </span>
            </div>
            <div className="chat-dup-actions">
              <button
                type="button"
                className="btn btn-ghost clickable"
                onClick={() => {
                  onOpenExisting?.(duplicate.id);
                  onClose();
                }}
              >
                Ouvrir
              </button>
              <button
                type="button"
                className="btn btn-primary clickable"
                disabled={busy}
                onClick={() => create(true)}
              >
                Créer quand même
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost clickable" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary clickable"
            disabled={!enoughPicked || busy}
            title={enoughPicked ? undefined : "Sélectionne au moins deux personnes"}
            onClick={onPrimary}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : mode === "add" ? (
              "Ajouter"
            ) : onNameStep ? (
              "Créer le groupe"
            ) : (
              <>
                Suivant <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
