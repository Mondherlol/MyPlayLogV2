import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  Clock,
  Globe,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Smartphone,
  UserCheck,
  Users,
} from "lucide-react";
import { apiFetch } from "../lib/api";

// ======================================================================
//  Onglet Notifications du panel Admin — écrire une annonce push et
//  l'envoyer à tout le monde ou à une poignée de comptes.
// ======================================================================
// Une push ne se rattrape pas : une fois partie, elle a sonné chez les gens.
// Toute l'ergonomie de cet écran découle de là — l'aperçu à côté du champ, le
// décompte des appareils réellement visés, l'essai sur son propre téléphone
// avant, et la confirmation obligatoire quand la cible est « tout le monde ».

const TITLE_MAX = 60;
const BODY_MAX = 300;

// Destinations proposées : uniquement des écrans qui existent dans l'app
// mobile (cf. myplaylog-mobile/app). Y mettre une route du site ouvrirait un
// écran vide sur le téléphone.
const DESTINATIONS = [
  { value: "", label: "Ouvrir l'app simplement" },
  { value: "/notifications", label: "Page Notifications" },
  { value: "/(tabs)", label: "Accueil" },
  { value: "/(tabs)/explorer", label: "Explorer" },
  { value: "/(tabs)/messages", label: "Messagerie" },
  { value: "/settings", label: "Réglages" },
];

function timeAgo(date) {
  if (!date) return "jamais";
  const min = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(date).toLocaleDateString("fr-FR");
}

// Aperçu façon bandeau de notification Android : c'est la seule façon honnête
// de juger une formulation, un titre de 60 signes ne « ressemble » à rien dans
// un champ de saisie.
function Preview({ title, body }) {
  return (
    <div className="push-preview">
      <span className="push-preview-label">Aperçu sur le téléphone</span>
      <div className="push-preview-card">
        <div className="push-preview-head">
          <span className="push-preview-icon">
            <BellRing size={11} />
          </span>
          MyPlayLog · maintenant
        </div>
        <strong className="push-preview-title">{title || "MyPlayLog"}</strong>
        <p className="push-preview-body">
          {body || "Le texte de ta notification s'affichera ici."}
        </p>
      </div>
    </div>
  );
}

export default function PushPanel({ token }) {
  const [audienceData, setAudienceData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [title, setTitle] = useState("MyPlayLog");
  const [body, setBody] = useState("");
  const [path, setPath] = useState("");
  const [customPath, setCustomPath] = useState(false);

  const [mode, setMode] = useState("all"); // all | selected
  const [picked, setPicked] = useState(() => new Set());
  const [q, setQ] = useState("");

  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch("/admin/push/audience", { token }),
      apiFetch("/admin/push/history", { token }),
    ])
      .then(([aud, hist]) => {
        setAudienceData(aud);
        setHistory(hist.items || []);
        setErr(null);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Mémoïsé : sans ça, le tableau change d'identité à chaque rendu et les deux
  // useMemo qui en dépendent recalculent pour rien.
  const users = useMemo(() => audienceData?.users || [], [audienceData]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) => u.username.toLowerCase().includes(needle));
  }, [users, q]);

  // Combien d'appareils vont réellement sonner : c'est ce chiffre-là qui compte
  // avant d'appuyer, pas le nombre de comptes.
  const targetDevices = useMemo(() => {
    if (mode === "all") return audienceData?.devices || 0;
    return users.reduce((n, u) => (picked.has(u.id) ? n + u.devices : n), 0);
  }, [mode, audienceData, users, picked]);

  const targetPeople = mode === "all" ? users.length : picked.size;

  const toggle = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  };

  const canSend = body.trim().length > 0 && targetPeople > 0 && !sending;

  async function send(audience) {
    setSending(true);
    setResult(null);
    setErr(null);
    try {
      const data = await apiFetch("/admin/push/send", {
        method: "POST",
        token,
        body: {
          title: title.trim(),
          body: body.trim(),
          path,
          audience,
          userIds: audience === "selected" ? [...picked] : undefined,
        },
      });
      setResult({ ...data, test: audience === "test" });
      setConfirming(false);
      // L'historique ne bouge pas sur un test : inutile de le recharger.
      if (audience !== "test") {
        apiFetch("/admin/push/history", { token })
          .then((h) => setHistory(h.items || []))
          .catch(() => {});
      }
    } catch (e) {
      setErr(e.message);
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  // Rejouer une annonce : on recharge le brouillon, sans envoyer. Le geste
  // courant est « la même chose, mais avec une correction ».
  function reuse(b) {
    setTitle(b.title || "MyPlayLog");
    setBody(b.body || "");
    setPath(b.path || "");
    setCustomPath(!!b.path && !DESTINATIONS.some((d) => d.value === b.path));
    if (b.audience === "selected" && b.recipients?.length) {
      setMode("selected");
      setPicked(new Set(b.recipients));
    } else {
      setMode("all");
    }
    setResult(null);
    setConfirming(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading && !audienceData) {
    return (
      <div className="admin-card">
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement de l'audience…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-stack">
      {/* --- Portée --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <BellRing size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Notifications push</h2>
            <p>
              Écris une annonce et envoie-la sur le téléphone des utilisateurs qui ont
              installé l'app mobile.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{" "}
            Rafraîchir
          </button>
        </div>

        <div className="push-reach">
          <div className="push-reach-stat">
            <Users size={15} />
            <strong>{audienceData?.reachable ?? 0}</strong>
            <span>
              joignable{(audienceData?.reachable ?? 0) > 1 ? "s" : ""} sur{" "}
              {audienceData?.totalUsers ?? 0} inscrits
            </span>
          </div>
          <div className="push-reach-stat">
            <Smartphone size={15} />
            <strong>{audienceData?.devices ?? 0}</strong>
            <span>appareil{(audienceData?.devices ?? 0) > 1 ? "s" : ""} enregistré(s)</span>
          </div>
        </div>

        {(audienceData?.reachable ?? 0) === 0 && (
          <p className="push-warn">
            <AlertTriangle size={14} /> Personne n'a encore l'app mobile installée : rien à
            envoyer pour l'instant.
          </p>
        )}
      </section>

      {/* --- Rédaction --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Send size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Le message</h2>
            <p>Court et clair : au-delà de deux lignes, le téléphone tronque.</p>
          </div>
        </div>

        <div className="push-compose">
          <div className="push-fields">
            <div className="admin-field">
              <label>Titre</label>
              <input
                type="text"
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setConfirming(false);
                }}
                placeholder="MyPlayLog"
              />
              <span className="push-count">
                {title.length}/{TITLE_MAX}
              </span>
            </div>

            <div className="admin-field">
              <label>Message</label>
              <textarea
                rows={4}
                value={body}
                maxLength={BODY_MAX}
                onChange={(e) => {
                  setBody(e.target.value);
                  setConfirming(false);
                }}
                placeholder="Le blind test passe en multijoueur : viens défier tes amis !"
              />
              <span className={`push-count ${body.length > 140 ? "warn" : ""}`}>
                {body.length}/{BODY_MAX}
                {body.length > 140 && " · sera tronqué sur certains téléphones"}
              </span>
            </div>

            <div className="admin-field">
              <label>
                <Link2 size={14} /> Au clic sur la notification
              </label>
              {customPath ? (
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/notifications"
                />
              ) : (
                <select
                  value={path}
                  onChange={(e) => {
                    if (e.target.value === "__custom") {
                      setCustomPath(true);
                      setPath("");
                    } else setPath(e.target.value);
                  }}
                >
                  {DESTINATIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                  <option value="__custom">Autre chemin…</option>
                </select>
              )}
              <p className="admin-hint">
                Un chemin de l'app mobile, pas du site. Laisse « ouvrir l'app simplement »
                dans le doute.
              </p>
            </div>
          </div>

          <Preview title={title} body={body} />
        </div>
      </section>

      {/* --- Destinataires --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Users size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Destinataires</h2>
            <p>Tout le monde, ou seulement les comptes que tu coches.</p>
          </div>
        </div>

        <div className="push-modes">
          <button
            className={`push-mode clickable ${mode === "all" ? "active" : ""}`}
            onClick={() => {
              setMode("all");
              setConfirming(false);
            }}
          >
            <Globe size={16} />
            <span>
              <strong>Tout le monde</strong>
              {audienceData?.reachable ?? 0} compte
              {(audienceData?.reachable ?? 0) > 1 ? "s" : ""}
            </span>
          </button>
          <button
            className={`push-mode clickable ${mode === "selected" ? "active" : ""}`}
            onClick={() => {
              setMode("selected");
              setConfirming(false);
            }}
          >
            <UserCheck size={16} />
            <span>
              <strong>Une sélection</strong>
              {picked.size} coché{picked.size > 1 ? "s" : ""}
            </span>
          </button>
        </div>

        {mode === "selected" && (
          <div className="push-picker">
            <div className="push-search">
              <Search size={15} />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher un compte…"
              />
              {picked.size > 0 && (
                <button className="btn btn-ghost sm" onClick={() => setPicked(new Set())}>
                  Tout décocher
                </button>
              )}
            </div>

            <div className="push-user-list">
              {filtered.length === 0 && (
                <p className="push-empty">Aucun compte joignable ne correspond.</p>
              )}
              {filtered.map((u) => (
                <button
                  key={u.id}
                  className={`push-user clickable ${picked.has(u.id) ? "on" : ""}`}
                  onClick={() => toggle(u.id)}
                >
                  <span className="push-check">{picked.has(u.id) && <Check size={12} />}</span>
                  {u.avatar ? (
                    <img src={u.avatar} alt="" loading="lazy" draggable="false" />
                  ) : (
                    <i>{u.username.slice(0, 1).toUpperCase()}</i>
                  )}
                  <span className="push-user-name">
                    {u.username}
                    {u.isAdmin && <em>admin</em>}
                  </span>
                  <span className="push-user-meta">
                    <Smartphone size={12} /> {u.devices} · vu {timeAgo(u.lastSeenAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* --- Envoi --- */}
      <section className="admin-card">
        <div className="push-send">
          <div className="push-send-info">
            <strong>
              {targetPeople} compte{targetPeople > 1 ? "s" : ""} · {targetDevices} appareil
              {targetDevices > 1 ? "s" : ""}
            </strong>
            <span>
              {mode === "all"
                ? "Tous les utilisateurs ayant l'app mobile recevront cette notification."
                : "Seuls les comptes cochés la recevront."}
            </span>
          </div>

          <div className="push-send-actions">
            <button
              className="btn btn-ghost"
              onClick={() => send("test")}
              disabled={!body.trim() || sending}
              title="Envoie la notification à toi seul, pour vérifier le rendu"
            >
              <Smartphone size={15} /> M'envoyer un test
            </button>

            {confirming ? (
              <>
                <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Annuler
                </button>
                <button
                  className="btn btn-primary push-confirm"
                  onClick={() => send(mode)}
                  disabled={sending}
                >
                  {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{" "}
                  Confirmer l'envoi à {targetDevices} appareil{targetDevices > 1 ? "s" : ""}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => setConfirming(true)}
                disabled={!canSend}
              >
                <Send size={15} /> Envoyer
              </button>
            )}
          </div>
        </div>

        {confirming && (
          <p className="push-warn">
            <AlertTriangle size={14} /> Une notification envoyée ne se rappelle pas. Relis le
            message avant de confirmer.
          </p>
        )}

        {err && <p className="psn-err">{err}</p>}

        {result && (
          <div className={`push-result ${result.failed ? "partial" : "ok"}`}>
            <Check size={15} />
            <div>
              <strong>
                {result.test ? "Test envoyé" : "Notification envoyée"} — {result.accepted}{" "}
                appareil{result.accepted > 1 ? "s" : ""} sur {result.devices}
              </strong>
              {result.failed > 0 && (
                <span>
                  {result.failed} échec{result.failed > 1 ? "s" : ""} :{" "}
                  {result.errors.map((e) => `${e.reason} × ${e.count}`).join(", ")}
                  {result.removed > 0 &&
                    ` · ${result.removed} jeton mort retiré${result.removed > 1 ? "s" : ""}`}
                </span>
              )}
              {result.devices === 0 && (
                <span>Aucun appareil enregistré chez les destinataires visés.</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* --- Historique --- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Clock size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Annonces passées</h2>
            <p>Les 30 dernières. Les essais envoyés à toi-même n'y figurent pas.</p>
          </div>
        </div>

        {history.length === 0 ? (
          <p className="push-empty">Aucune annonce envoyée pour l'instant.</p>
        ) : (
          <div className="push-history">
            {history.map((b) => (
              <div className="push-hist-row" key={b.id}>
                <div className="push-hist-main">
                  <strong>{b.title}</strong>
                  <p>{b.body}</p>
                  <span className="push-hist-meta">
                    {new Date(b.createdAt).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {b.sentBy && ` · ${b.sentBy.username}`} ·{" "}
                    {b.audience === "all" ? "tout le monde" : `${b.recipients.length} comptes`} ·{" "}
                    {b.accepted}/{b.devices} appareils
                    {b.path && ` · → ${b.path}`}
                  </span>
                </div>
                <button
                  className="btn btn-ghost sm"
                  onClick={() => reuse(b)}
                  title="Recharger ce texte dans le formulaire"
                >
                  <RotateCcw size={14} /> Réutiliser
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
