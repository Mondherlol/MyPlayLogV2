import { useEffect, useState } from "react";
import { Loader2, Save, RotateCcw, Award, Coins, Lock, Check } from "lucide-react";
import { apiFetch } from "../lib/api";
import { MISSION_ICONS, MissionIcon } from "./ProfileBadges";

// ======================================================================
//  Onglet Missions du panel admin — habillage & barème uniquement.
// ======================================================================
// On retouche titre, description, icône et points. On ne crée ni ne supprime
// de mission, et on ne touche pas à sa CONDITION : elle vit dans le code
// (server/src/lib/missions.js) parce que c'est du comportement, pas de la
// configuration. La condition et le palier sont donc affichés en lecture seule.

const ICON_NAMES = Object.keys(MISSION_ICONS).sort();
const TIER_LABEL = { bronze: "Bronze", silver: "Argent", gold: "Or", platinum: "Platine" };

export default function AdminMissions({ token }) {
  const [missions, setMissions] = useState(null);
  const [err, setErr] = useState(null);

  function load() {
    apiFetch("/admin/missions", { token })
      .then((d) => setMissions(d.missions || []))
      .catch((e) => setErr(e.message));
  }
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remplace une mission dans la liste après enregistrement / réinitialisation.
  const patch = (m) =>
    setMissions((list) => list.map((x) => (x.key === m.key ? m : x)));

  const editedCount = (missions || []).filter((m) => m.edited).length;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <Award size={18} />
        </span>
        <div className="admin-card-titles">
          <h2>Missions & badges</h2>
          <p>
            Retouche le titre, la description, l'icône et la récompense de chaque
            badge. La <strong>condition</strong> d'obtention et le palier sont
            définis dans le code et ne se modifient pas ici — on ne peut ni en
            créer ni en supprimer.
          </p>
        </div>
        {missions && (
          <span className="psn-status on">
            {missions.length} mission{missions.length > 1 ? "s" : ""}
            {editedCount > 0 && ` · ${editedCount} modifiée${editedCount > 1 ? "s" : ""}`}
          </span>
        )}
      </div>

      {err && <p className="psn-err">{err}</p>}

      {!missions ? (
        <div className="gp-troph-state">
          <Loader2 size={18} className="spin" /> Chargement…
        </div>
      ) : (
        <div className="am-list">
          {missions.map((m) => (
            <MissionRow key={m.key} token={token} mission={m} onSaved={patch} />
          ))}
        </div>
      )}
    </section>
  );
}

function MissionRow({ token, mission, onSaved }) {
  const [form, setForm] = useState({
    title: mission.title,
    description: mission.description,
    icon: mission.icon,
    points: String(mission.points),
  });
  const [busy, setBusy] = useState(null); // "save" | "reset"
  const [msg, setMsg] = useState(null);

  // Resynchronise si la liste est rechargée depuis le serveur.
  useEffect(() => {
    setForm({
      title: mission.title,
      description: mission.description,
      icon: mission.icon,
      points: String(mission.points),
    });
  }, [mission]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty =
    form.title !== mission.title ||
    form.description !== mission.description ||
    form.icon !== mission.icon ||
    Number(form.points) !== mission.points;

  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const { mission: next } = await apiFetch(`/admin/missions/${mission.key}`, {
        method: "PUT",
        token,
        body: {
          title: form.title,
          description: form.description,
          icon: form.icon,
          points: form.points,
        },
      });
      onSaved(next);
      setMsg({ ok: true, text: "Enregistré." });
      setTimeout(() => setMsg(null), 1800);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm(`Remettre « ${mission.title} » aux valeurs d'origine ?`)) return;
    setBusy("reset");
    setMsg(null);
    try {
      const { mission: next } = await apiFetch(`/admin/missions/${mission.key}`, {
        method: "DELETE",
        token,
      });
      onSaved(next);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`am-row ${mission.tier}`}>
      <div className="am-row-head">
        <span className="am-medal">
          <MissionIcon name={form.icon} size={22} />
        </span>
        <div className="am-row-id">
          <code className="am-key">{mission.key}</code>
          <span className="am-cond">
            <Lock size={11} /> {mission.defaults.description}
            {mission.target > 1 && ` · palier ${mission.target}`}
          </span>
        </div>
        <span className="am-tier">{TIER_LABEL[mission.tier] || mission.tier}</span>
        {mission.claimedBy > 0 && (
          <span className="am-claimed" title="Joueurs ayant récupéré ce badge">
            <Check size={12} /> {mission.claimedBy}
          </span>
        )}
        {mission.edited && <span className="am-edited">modifiée</span>}
      </div>

      <div className="am-grid">
        <label className="am-field">
          <span>Nom</span>
          <input
            value={form.title}
            maxLength={60}
            onChange={(e) => set("title", e.target.value)}
            placeholder={mission.defaults.title}
          />
        </label>

        <label className="am-field am-field-icon">
          <span>Icône</span>
          <div className="am-icon-picker">
            <span className="am-icon-preview">
              <MissionIcon name={form.icon} size={16} />
            </span>
            <select value={form.icon} onChange={(e) => set("icon", e.target.value)}>
              {ICON_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="am-field am-field-pts">
          <span>
            <Coins size={12} /> Points
          </span>
          <input
            type="number"
            min="0"
            step="10"
            value={form.points}
            onChange={(e) => set("points", e.target.value)}
            placeholder={String(mission.defaults.points)}
          />
        </label>

        <label className="am-field am-field-desc">
          <span>Description</span>
          <input
            value={form.description}
            maxLength={200}
            onChange={(e) => set("description", e.target.value)}
            placeholder={mission.defaults.description}
          />
        </label>
      </div>

      <div className="am-row-foot">
        {msg && <p className={msg.ok ? "admin-ok" : "psn-err"}>{msg.text}</p>}
        {mission.edited && (
          <button
            className="btn btn-ghost sm"
            onClick={reset}
            disabled={!!busy}
            title="Revenir aux valeurs définies dans le code"
          >
            {busy === "reset" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            Réinitialiser
          </button>
        )}
        <button className="btn btn-primary sm" onClick={save} disabled={!dirty || !!busy}>
          {busy === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}
