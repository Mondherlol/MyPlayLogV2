import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Check,
  Link2,
  Copy,
  Send,
  Loader2,
  UserPlus,
  Info,
  MessageCircle,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useScrollLock } from "../hooks/useScrollLock";

// ======================================================================
//  Inviter — deux chemins, et ils ne se remplacent pas
// ======================================================================
//   1. LE DM. On coche des abonnés, ils reçoivent une CARTE dans leur messagerie
//      (affiche, titre, bouton « Rejoindre ») avec la pop-up et le son que la
//      messagerie sait déjà faire. C'est le chemin normal ;
//   2. LE LIEN. À copier et coller où l'on veut — Discord, SMS, à voix haute. Qui
//      l'a peut entrer, comme une invitation Discord.
//
// POURQUOI LES DEUX : la messagerie n'autorise à écrire qu'à quelqu'un qui est
// abonné à soi (règle du site, pas la nôtre). La liste ci-dessous ne montre donc
// QUE des gens à qui l'on peut écrire — et le lien reste la porte pour tous les
// autres. On ne cache pas cette limite, on la contourne dans la même fenêtre.

export default function WatchPartyInvite({ token, onInvite, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(() => new Set());
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { sent: [...] }
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useScrollLock();
  const link = window.location.href.split("?")[0];

  useEffect(() => {
    let alive = true;
    apiFetch("/chat/contacts", { token })
      .then((d) => {
        if (!alive) return;
        setContacts(d.contacts || []);
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.username.toLowerCase().includes(q));
  }, [contacts, query]);

  function toggle(id) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Presse-papier refusé (navigateur ancien, page non sécurisée) : on
      // sélectionne le champ, l'utilisateur fait Ctrl+C — jamais d'impasse.
      document.querySelector(".wp-inv-link input")?.select();
    }
  }

  async function send() {
    if (!chosen.size) return;
    setBusy(true);
    setError(null);
    try {
      const d = await onInvite([...chosen], word.trim());
      setDone(d);
      setChosen(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="wp-modal" role="dialog" aria-label="Inviter à la séance">
      <button className="wp-modal-veil" onClick={onClose} aria-label="Fermer" />
      <div className="wp-modal-box wp-inv">
        <header className="wp-modal-head">
          <div>
            <span className="wp-modal-over">Watchparty</span>
            <h2>Invite du monde</h2>
          </div>
          <button className="wp-modal-x clickable" onClick={onClose} aria-label="Fermer">
            <X size={18} />
          </button>
        </header>

        {/* Le lien d'abord : c'est celui qui marche pour tout le monde. */}
        <div className="wp-inv-link">
          <Link2 size={15} />
          <input value={link} readOnly onFocus={(e) => e.target.select()} />
          <button className={`clickable ${copied ? "done" : ""}`} onClick={copy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
        <p className="wp-inv-note">
          <Info size={12} /> Qui a ce lien peut entrer dans la salle.
        </p>

        <div className="wp-inv-sep">
          <span>ou par message</span>
        </div>

        <label className="wp-pick-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher un abonné…"
          />
        </label>

        {status === "loading" && (
          <div className="wp-pick-wait">
            <Loader2 size={18} className="spin" /> Chargement…
          </div>
        )}

        {status === "ready" && contacts.length === 0 && (
          <p className="wp-inv-empty">
            <MessageCircle size={15} />
            Personne à qui écrire pour l'instant — la messagerie n'autorise le
            message qu'aux gens abonnés à toi. Le lien du haut, lui, marche avec
            n'importe qui.
          </p>
        )}

        {shown.length > 0 && (
          <ul className="wp-inv-list">
            {shown.map((c) => {
              const on = chosen.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    className={`wp-inv-row clickable ${on ? "on" : ""}`}
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                  >
                    <span className="wp-inv-face">
                      {c.avatar ? (
                        <img src={c.avatar} alt="" loading="lazy" />
                      ) : (
                        <i>{c.username.slice(0, 1).toUpperCase()}</i>
                      )}
                    </span>
                    <span className="wp-inv-name">{c.username}</span>
                    <span className="wp-inv-check">{on && <Check size={14} strokeWidth={3} />}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {chosen.size > 0 && (
          <input
            className="wp-inv-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Un mot avec l'invitation (facultatif)"
            maxLength={300}
          />
        )}

        {error && <p className="wp-modal-err">{error}</p>}

        {done && (
          <p className="wp-inv-done">
            <Check size={14} />
            {done.sent?.length
              ? `Invitation envoyée à ${done.sent.map((s) => s.username).join(", ")}.`
              : "Aucune invitation envoyée."}
            {done.skipped?.length > 0 &&
              ` ${done.skipped.map((s) => s.username).join(", ")} n'est pas abonné(e) à toi : passe-lui le lien.`}
          </p>
        )}

        <button
          className="btn btn-primary clickable wp-inv-send"
          disabled={!chosen.size || busy}
          onClick={send}
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          {chosen.size > 1 ? `Inviter ${chosen.size} personnes` : "Envoyer l'invitation"}
        </button>

        {!chosen.size && !done && (
          <p className="wp-inv-foot">
            <UserPlus size={12} /> Coche qui tu veux : chacun reçoit une carte
            dans sa messagerie.
          </p>
        )}
      </div>
    </div>,
    document.body
  );
}
