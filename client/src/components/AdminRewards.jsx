import { useEffect, useRef, useState } from "react";
import {
  Gift,
  Package,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Check,
  X,
  ImagePlus,
  Coins,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { RARITIES, RARITY_ORDER, REWARD_TYPES, rarityColor, rarityLabel } from "../lib/rarity";
import { parseCursorFile, dataUrlToBlob } from "../lib/cursorFile";
import RewardArt from "./RewardArt";

// ======================================================================
//  Admin — les lots et les caisses de l'arcade.
// ======================================================================
// AJOUTER UN LOT : « Nouveau lot » → famille (Curseur), nom, rareté, image.
// Puis l'ajouter au pool d'une caisse pour qu'il soit tirable. Les chances de
// tirage se déduisent des raretés — aucun pourcentage à saisir.
//
// AJOUTER UNE FAMILLE DE LOTS (ornement, badge…) : elle existe déjà côté
// serveur (REWARD_TYPES) ; il faut lui donner un rendu dans RewardArt.jsx et
// décider où l'app la peint. Le reste (tirage, inventaire, admin) suit tout seul.

const blankReward = () => ({
  type: "cursor",
  name: "",
  description: "",
  rarity: "common",
  weight: "",
  enabled: true,
  data: { url: "", hotspotX: 0, hotspotY: 0 },
});

const blankCase = () => ({
  name: "",
  description: "",
  price: 1000,
  image: "",
  rewardIds: [],
  enabled: true,
  order: 0,
});

export default function RewardsPanel({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [editReward, setEditReward] = useState(null);
  const [editCase, setEditCase] = useState(null);

  function load() {
    setLoading(true);
    apiFetch("/arcade/admin/data", { token })
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  async function removeReward(r) {
    if (
      !confirm(
        `Supprimer le lot « ${r.name} » ?\n\n` +
          `Il sera retiré des caisses ET des inventaires des joueurs qui l'ont gagné.\n` +
          `Pour le sortir des tirages sans déposséder personne, désactive-le plutôt.`
      )
    )
      return;
    try {
      await apiFetch(`/arcade/admin/rewards/${r.id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function removeCase(c) {
    if (!confirm(`Supprimer la caisse « ${c.name} » ?\n\nLes lots déjà gagnés restent acquis.`))
      return;
    try {
      await apiFetch(`/arcade/admin/cases/${c.id}`, { method: "DELETE", token });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading && !data) {
    return (
      <div className="gp-troph-state">
        <Loader2 size={18} className="spin" /> Chargement…
      </div>
    );
  }

  const rewards = data?.rewards || [];
  const cases = data?.cases || [];

  return (
    <div className="admin-stack">
      {err && <p className="psn-err">{err}</p>}

      {/* ---------- Les lots ---------- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Gift size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Lots</h2>
            <p>
              Les cosmétiques gagnables. La <strong>rareté</strong> décide de la couleur
              ET de la chance de tirage — un lot n'est tirable qu'une fois ajouté au
              pool d'une caisse.
            </p>
          </div>
          {!editReward && (
            <button className="btn btn-primary" onClick={() => setEditReward(blankReward())}>
              <Plus size={16} /> Nouveau lot
            </button>
          )}
        </div>

        {editReward && (
          <RewardEditor
            token={token}
            initial={editReward}
            onCancel={() => setEditReward(null)}
            onSaved={() => {
              setEditReward(null);
              load();
            }}
          />
        )}

        {rewards.length === 0 && !editReward ? (
          <p className="pn-admin-empty">Aucun lot pour l'instant.</p>
        ) : (
          <div className="arw-grid">
            {rewards.map((r) => (
              <div
                className={`arw-card ${r.enabled ? "" : "off"}`}
                key={r.id}
                style={{ "--arc-rarity": rarityColor(r.rarity) }}
              >
                <div className="arw-card-art">
                  <RewardArt reward={r} size={40} />
                </div>
                <div className="arw-card-info">
                  <strong>{r.name}</strong>
                  <span className="arw-card-meta">
                    {REWARD_TYPES[r.type]?.label || r.type} · {rarityLabel(r.rarity)}
                    {r.weight != null ? ` · poids ${r.weight}` : ""}
                    {r.enabled ? "" : " · désactivé"}
                  </span>
                </div>
                <div className="pn-admin-actions">
                  <button
                    className="icon-btn clickable"
                    onClick={() =>
                      setEditReward({
                        ...r,
                        weight: r.weight ?? "",
                        data: { hotspotX: 0, hotspotY: 0, ...(r.data || {}) },
                      })
                    }
                    title="Modifier"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn clickable danger"
                    onClick={() => removeReward(r)}
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Les caisses ---------- */}
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Package size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Caisses</h2>
            <p>
              Ce que les joueurs achètent avec leurs points. Coche les lots à mettre
              dedans : les chances affichées se calculent toutes seules.
            </p>
          </div>
          {!editCase && (
            <button className="btn btn-primary" onClick={() => setEditCase(blankCase())}>
              <Plus size={16} /> Nouvelle caisse
            </button>
          )}
        </div>

        {editCase && (
          <CaseEditor
            token={token}
            initial={editCase}
            rewards={rewards}
            onCancel={() => setEditCase(null)}
            onSaved={() => {
              setEditCase(null);
              load();
            }}
          />
        )}

        {cases.length === 0 && !editCase ? (
          <p className="pn-admin-empty">Aucune caisse pour l'instant.</p>
        ) : (
          <div className="pn-admin-list">
            {cases.map((c) => (
              <div className="pn-admin-row" key={c.id}>
                <span className={`pn-admin-ver ${c.enabled ? "live" : ""}`}>
                  {c.price}
                </span>
                <div className="pn-admin-info">
                  <strong>{c.name}</strong>
                  <span>
                    {c.rewardIds.length} lot{c.rewardIds.length > 1 ? "s" : ""} ·{" "}
                    {c.enabled ? "En ligne" : "Masquée"}
                  </span>
                </div>
                <div className="pn-admin-actions">
                  <button
                    className="icon-btn clickable"
                    onClick={() => setEditCase({ ...c, image: c.image || "" })}
                    title="Modifier"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn clickable danger"
                    onClick={() => removeCase(c)}
                    title="Supprimer"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// --- Upload d'un visuel (lot ou caisse) ---
function ImageField({ token, value, onChange, label, hint }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const d = await apiUpload("/arcade/admin/upload", fd, token);
      onChange(d.url);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-field">
      <label>
        <ImagePlus size={14} /> {label}
      </label>
      <div className="arw-img-row">
        {value ? (
          <div className="arw-img-preview">
            <img src={value} alt="" />
            <button
              className="pn-shot-del clickable"
              onClick={() => onChange("")}
              aria-label="Retirer l'image"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            className="pn-shot-add clickable"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
            <span>Image</span>
          </button>
        )}
        {hint && <p className="admin-hint arw-hint">{hint}</p>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onUpload} />
    </div>
  );
}

// Aperçu qui rejoue une animation de curseur (cycle des images selon leurs durées).
function AnimatedFramePreview({ frames, durationsMs, size = 48 }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (!frames || frames.length < 2) return;
    let idx = 0;
    let timer;
    const tick = () => {
      idx = (idx + 1) % frames.length;
      setI(idx);
      timer = setTimeout(tick, durationsMs?.[idx] || 100);
    };
    timer = setTimeout(tick, durationsMs?.[0] || 100);
    return () => clearTimeout(timer);
  }, [frames, durationsMs]);
  const src = frames?.[i] || frames?.[0];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      style={{ maxWidth: size, maxHeight: size, imageRendering: "pixelated" }}
    />
  );
}

// --- Champ « image du curseur » : accepte PNG/SVG classiques ET les vrais
// fichiers curseur Windows (.cur / .ani). Les .cur/.ani sont décodés dans le
// navigateur et convertis en PNG (universellement acceptés par `cursor:url()`) ;
// le point actif est récupéré automatiquement, et un .ani devient une animation. ---
function CursorField({ token, data, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const frames = data.animated && data.frames?.length ? data.frames : data.url ? [data.url] : [];
  const animated = !!data.animated && (data.frames?.length || 0) > 1;

  async function uploadDataUrl(dataUrl) {
    const fd = new FormData();
    fd.append("image", dataUrlToBlob(dataUrl), "cursor.png");
    const d = await apiUpload("/arcade/admin/upload", fd, token);
    return d.url;
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      const isCursorFile =
        /\.(cur|ani|ico)$/i.test(file.name) || !file.type.startsWith("image/");
      if (isCursorFile) {
        const parsed = await parseCursorFile(file); // { animated, frames:[dataUrl], durationsMs, hotspotX, hotspotY }
        if (parsed.frames.length > 240)
          throw new Error("Curseur trop long (trop d'images).");
        // Dédup des uploads : deux étapes identiques pointent vers le même fichier.
        const cache = new Map();
        const urls = [];
        for (const f of parsed.frames) {
          if (!cache.has(f)) cache.set(f, await uploadDataUrl(f));
          urls.push(cache.get(f));
        }
        onChange({
          url: urls[0],
          frames: parsed.animated ? urls : undefined,
          durationsMs: parsed.animated ? parsed.durationsMs : undefined,
          animated: parsed.animated || undefined,
          hotspotX: parsed.hotspotX,
          hotspotY: parsed.hotspotY,
        });
      } else {
        // Image PNG/SVG classique : comportement d'origine.
        const fd = new FormData();
        fd.append("image", file);
        const d = await apiUpload("/arcade/admin/upload", fd, token);
        onChange({ url: d.url, frames: undefined, durationsMs: undefined, animated: undefined });
      }
    } catch (e2) {
      setErr(e2.message || "Fichier de curseur non pris en charge.");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    onChange({ url: "", frames: undefined, durationsMs: undefined, animated: undefined });
  }

  return (
    <div className="admin-field">
      <label>
        <ImagePlus size={14} /> Image du curseur
      </label>
      <div className="arw-img-row">
        {data.url ? (
          <div className="arw-img-preview arw-cursor-preview">
            {animated ? (
              <AnimatedFramePreview frames={frames} durationsMs={data.durationsMs} />
            ) : (
              <img src={data.url} alt="" style={{ imageRendering: "pixelated" }} />
            )}
            {animated && <span className="arw-cursor-badge">GIF · {data.frames.length}</span>}
            <button
              className="pn-shot-del clickable"
              onClick={clear}
              aria-label="Retirer le curseur"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            className="pn-shot-add clickable"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}
            <span>{busy ? "Conversion…" : "Curseur"}</span>
          </button>
        )}
        <p className="admin-hint arw-hint">
          <strong>.cur</strong> et <strong>.ani</strong> (curseurs Windows) acceptés — un
          .ani devient un curseur animé, le point actif est repris tout seul. Aussi PNG /
          SVG à fond transparent (32×32 idéal, 128 px max).
        </p>
      </div>
      {err && <p className="psn-err arw-hint">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept=".cur,.ani,.ico,image/*"
        hidden
        onChange={onFile}
      />
    </div>
  );
}

// --- Créer / modifier un lot ---
function RewardEditor({ token, initial, onCancel, onSaved }) {
  const [r, setR] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const isEdit = !!initial.id;
  const set = (patch) => setR((v) => ({ ...v, ...patch }));
  const setData = (patch) => setR((v) => ({ ...v, data: { ...v.data, ...patch } }));

  async function save() {
    setErr(null);
    if (!r.name.trim()) return setErr("Le nom est obligatoire.");
    if (r.type === "cursor" && !r.data.url)
      return setErr("Un curseur a besoin de son image.");
    setSaving(true);
    try {
      const body = {
        type: r.type,
        name: r.name.trim(),
        description: r.description.trim(),
        rarity: r.rarity,
        weight: r.weight === "" ? null : Number(r.weight),
        enabled: r.enabled,
        data: r.data,
      };
      if (isEdit) await apiFetch(`/arcade/admin/rewards/${initial.id}`, { method: "PUT", token, body });
      else await apiFetch("/arcade/admin/rewards", { method: "POST", token, body });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pn-editor">
      <div className="pn-editor-grid">
        <label className="pn-field">
          <span>Famille</span>
          <select value={r.type} onChange={(e) => set({ type: e.target.value })}>
            {Object.entries(REWARD_TYPES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pn-field grow">
          <span>Nom</span>
          <input
            value={r.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Curseur Master Sword"
          />
        </label>
      </div>

      <div className="pn-editor-grid">
        <label className="pn-field">
          <span>Rareté</span>
          <select value={r.rarity} onChange={(e) => set({ rarity: e.target.value })}>
            {RARITY_ORDER.map((k) => (
              <option key={k} value={k}>
                {RARITIES[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="pn-field">
          <span>Poids de tirage (optionnel)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={r.weight}
            onChange={(e) => set({ weight: e.target.value })}
            placeholder="auto"
          />
        </label>
      </div>
      <p className="admin-hint arw-hint">
        Laisse le poids vide dans 99 % des cas : la rareté s'en charge. Ne le remplis
        que pour truquer une caisse événementielle (plus le poids est haut, plus le lot
        sort souvent, relativement aux autres lots de la MÊME caisse).
      </p>

      <label className="pn-field">
        <span>Description (optionnel)</span>
        <textarea
          rows={2}
          value={r.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Une phrase pour situer le lot…"
        />
      </label>

      {r.type === "cursor" ? (
        <CursorField token={token} data={r.data} onChange={(patch) => setData(patch)} />
      ) : (
        <ImageField
          token={token}
          value={r.data.url}
          onChange={(url) => setData({ url })}
          label="Image du lot"
          hint="PNG ou SVG à fond transparent."
        />
      )}

      {r.type === "cursor" && (
        <div className="pn-editor-grid">
          <label className="pn-field">
            <span>Point actif X</span>
            <input
              type="number"
              min="0"
              value={r.data.hotspotX}
              onChange={(e) => setData({ hotspotX: Number(e.target.value) })}
            />
          </label>
          <label className="pn-field">
            <span>Point actif Y</span>
            <input
              type="number"
              min="0"
              value={r.data.hotspotY}
              onChange={(e) => setData({ hotspotY: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
      {r.type === "cursor" && (
        <p className="admin-hint arw-hint">
          Le point actif est le pixel qui clique vraiment, compté depuis le coin haut
          gauche de l'image. Pour une flèche classique, c'est sa pointe — souvent 0,0
          ou 2,2.
        </p>
      )}

      <div className="admin-toggle-row">
        <span>
          {r.enabled
            ? "Actif : le lot peut sortir des caisses."
            : "Désactivé : plus tirable, mais ceux qui l'ont le gardent."}
        </span>
        <button
          className={`admin-switch clickable ${r.enabled ? "on" : ""}`}
          onClick={() => set({ enabled: !r.enabled })}
          role="switch"
          aria-checked={r.enabled}
        >
          <span className="admin-switch-knob" />
        </button>
      </div>

      {err && <p className="psn-err">{err}</p>}

      <div className="pn-editor-foot">
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {isEdit ? "Enregistrer" : "Créer le lot"}
        </button>
      </div>
    </div>
  );
}

// --- Créer / modifier une caisse ---
function CaseEditor({ token, initial, rewards, onCancel, onSaved }) {
  const [c, setC] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const isEdit = !!initial.id;
  const set = (patch) => setC((v) => ({ ...v, ...patch }));

  function toggleReward(id) {
    setC((v) => ({
      ...v,
      rewardIds: v.rewardIds.includes(id)
        ? v.rewardIds.filter((x) => x !== id)
        : [...v.rewardIds, id],
    }));
  }

  async function save() {
    setErr(null);
    if (!c.name.trim()) return setErr("Le nom est obligatoire.");
    if (!c.rewardIds.length) return setErr("Choisis au moins un lot à mettre dedans.");
    setSaving(true);
    try {
      const body = {
        name: c.name.trim(),
        description: c.description.trim(),
        price: Number(c.price),
        image: c.image || null,
        rewardIds: c.rewardIds,
        enabled: c.enabled,
        order: Number(c.order) || 0,
      };
      if (isEdit) await apiFetch(`/arcade/admin/cases/${initial.id}`, { method: "PUT", token, body });
      else await apiFetch("/arcade/admin/cases", { method: "POST", token, body });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pn-editor">
      <div className="pn-editor-grid">
        <label className="pn-field grow">
          <span>Nom</span>
          <input
            value={c.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Caisse rétro"
          />
        </label>
        <label className="pn-field">
          <span>Prix (points)</span>
          <input
            type="number"
            min="0"
            value={c.price}
            onChange={(e) => set({ price: e.target.value })}
          />
        </label>
        <label className="pn-field">
          <span>Ordre</span>
          <input
            type="number"
            value={c.order}
            onChange={(e) => set({ order: e.target.value })}
          />
        </label>
      </div>

      <label className="pn-field">
        <span>Description (optionnel)</span>
        <textarea
          rows={2}
          value={c.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Ce qu'on trouve dedans, en une phrase…"
        />
      </label>

      <ImageField
        token={token}
        value={c.image}
        onChange={(image) => set({ image })}
        label="Visuel de la caisse"
        hint="Optionnel — sans image, une icône de caisse dorée s'affiche."
      />

      <div className="admin-field">
        <label>
          <Coins size={14} /> Contenu de la caisse ({c.rewardIds.length} sélectionné
          {c.rewardIds.length > 1 ? "s" : ""})
        </label>
        {rewards.length === 0 ? (
          <p className="admin-hint arw-hint">
            Crée d'abord des lots ci-dessus, puis reviens les cocher ici.
          </p>
        ) : (
          <div className="arw-pick">
            {rewards.map((r) => {
              const on = c.rewardIds.includes(r.id);
              return (
                <button
                  key={r.id}
                  className={`arw-pick-item clickable ${on ? "on" : ""} ${
                    r.enabled ? "" : "off"
                  }`}
                  style={{ "--arc-rarity": rarityColor(r.rarity) }}
                  onClick={() => toggleReward(r.id)}
                  title={r.enabled ? undefined : "Lot désactivé : il ne sortira pas"}
                >
                  <span className="arw-pick-art">
                    <RewardArt reward={r} size={26} />
                  </span>
                  <span className="arw-pick-name">{r.name}</span>
                  <span className="arw-pick-rarity">{rarityLabel(r.rarity)}</span>
                  {on && <Check size={14} className="arw-pick-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="admin-toggle-row">
        <span>
          {c.enabled ? "En ligne : visible dans l'arcade." : "Masquée aux joueurs."}
        </span>
        <button
          className={`admin-switch clickable ${c.enabled ? "on" : ""}`}
          onClick={() => set({ enabled: !c.enabled })}
          role="switch"
          aria-checked={c.enabled}
        >
          <span className="admin-switch-knob" />
        </button>
      </div>

      {err && <p className="psn-err">{err}</p>}

      <div className="pn-editor-foot">
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {isEdit ? "Enregistrer" : "Créer la caisse"}
        </button>
      </div>
    </div>
  );
}
