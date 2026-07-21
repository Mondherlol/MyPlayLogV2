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
  MousePointer2,
  Hand,
  TextCursor,
  Grab,
  Move,
  FileArchive,
  Frame,
  Award,
  Sparkles,
  Link2,
  Play,
  Square,
  PackageOpen,
  Layers,
  Maximize2,
  Download,
  Upload,
  ArrowLeftRight,
  Copy,
  Clipboard,
  LayoutGrid,
  List,
  Undo2,
} from "lucide-react";
import { apiFetch, apiUpload } from "../lib/api";
import { useCosmetics } from "../context/CosmeticsContext";
import CaseOpeningModal from "./CaseOpeningModal";
import CursorTestPanel from "./CursorTestPanel";
import { RARITIES, RARITY_ORDER, REWARD_TYPES, rarityColor, rarityLabel } from "../lib/rarity";
import {
  parseCursorFile,
  parseCursorBuffer,
  parseImageBytes,
  readCursorZip,
  dataUrlToBlob,
} from "../lib/cursorFile";
import { CURSOR_ROLES, CURSOR_ROLE_KEYS, guessRole } from "../lib/cursorRoles";
import RewardArt from "./RewardArt";

// Icône lucide par famille de lots et par rôle de curseur (habillage seulement).
const FAMILY_ICON = { cursor: MousePointer2, ornament: Frame, badge: Award };
const ROLE_ICON = {
  normal: MousePointer2,
  pointer: Hand,
  text: TextCursor,
  grab: Grab,
  grabbing: Move,
};

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
  const [testingId, setTestingId] = useState(null);
  const [tryBox, setTryBox] = useState(null);
  const [busyIO, setBusyIO] = useState(null); // "export" | "import" | null
  const [ioMsg, setIoMsg] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [bf, setBf] = useState(null); // aperçu du rattrapage de points
  const [bfBusy, setBfBusy] = useState(false);
  // Vue des lots : grille (visuelle) ou liste (édition rapide). Le choix est
  // gardé d'une session à l'autre — on travaille rarement dans les deux modes.
  const [listView, setListView] = useState(
    () => localStorage.getItem("mpl_arw_view") === "list"
  );
  // Modifications en attente : { [id]: { rarity?, description?, … } }.
  const [edits, setEdits] = useState({});
  const [savingEdits, setSavingEdits] = useState(false);
  const dirtyCount = Object.keys(edits).length;

  function toggleView() {
    setListView((v) => {
      localStorage.setItem("mpl_arw_view", v ? "grid" : "list");
      return !v;
    });
  }
  const setEdit = (id, field, value) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [field]: value } }));

  // Un seul PATCH pour toutes les lignes touchées. Les images ne transitent
  // pas : cette route ne connaît que les métadonnées.
  async function saveEdits() {
    setSavingEdits(true);
    try {
      const updates = Object.entries(edits).map(([id, patch]) => ({ id, ...patch }));
      await apiFetch("/arcade/admin/rewards", {
        method: "PATCH",
        token,
        body: { updates },
      });
      setEdits({});
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingEdits(false);
    }
  }
  const transferRef = useRef(null);

  // Rattrapage des points de blind test gagnés avant l'arcade. Deux temps :
  // on regarde d'abord (rien n'est écrit), on crédite ensuite.
  async function runBackfill(apply) {
    setBfBusy(true);
    try {
      const d = await apiFetch("/arcade/admin/backfill", {
        method: "POST",
        token,
        body: { apply },
      });
      setBf(d);
    } catch (e) {
      alert(e.message);
    } finally {
      setBfBusy(false);
    }
  }
  const { testCursor, endTest } = useCosmetics();

  // Télécharge tout l'arcade (lots + caisses + images embarquées) en un fichier.
  async function doExport() {
    setBusyIO("export");
    setIoMsg(null);
    try {
      const d = await apiFetch("/arcade/admin/export", { token });
      const blob = new Blob([JSON.stringify(d)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `arcade-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(href);
      setIoMsg(
        `Exporté : ${d.rewards?.length || 0} lot(s), ${d.cases?.length || 0} caisse(s), ` +
          `${Object.keys(d.assets || {}).length} image(s) embarquée(s).`
      );
    } catch (e) {
      setIoMsg(e.message || "Export impossible.");
    } finally {
      setBusyIO(null);
    }
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyIO("import");
    setIoMsg(null);
    try {
      const payload = JSON.parse(await file.text());
      const d = await apiFetch("/arcade/admin/import", {
        method: "POST",
        token,
        body: { payload, overwrite },
      });
      setIoMsg(
        `Import terminé — lots : ${d.rewardsCreated} créé(s), ${d.rewardsUpdated} mis à jour, ` +
          `${d.rewardsSkipped} ignoré(s) · caisses : ${d.casesCreated} créée(s), ` +
          `${d.casesUpdated} mise(s) à jour, ${d.casesSkipped} ignorée(s).`
      );
      load();
    } catch (e2) {
      setIoMsg(e2.message || "Import impossible.");
    } finally {
      setBusyIO(null);
    }
  }

  // Construit la « caisse » que la modale d'ouverture attend, à partir des
  // données admin — avec les chances calculées (le serveur nous a donné les
  // poids de rareté dans data.rarities). Sert au mode ESSAI (dry-run).
  function buildTryBox(c) {
    const rar = data?.rarities || {};
    const weightOf = (r) => {
      const own = Number(r.weight);
      return Number.isFinite(own) && own > 0 ? own : rar[r.rarity]?.weight ?? 1;
    };
    const pool = (c.rewardIds || [])
      .map((id) => (data?.rewards || []).find((r) => r.id === id))
      .filter((r) => r && r.enabled);
    const total = pool.reduce((a, r) => a + weightOf(r), 0) || 1;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      price: c.price,
      openable: true,
      rewards: pool.map((r) => ({ ...r, chance: weightOf(r) / total })),
    };
  }

  // Applique un curseur à la page le temps de le sentir bouger, sans rien
  // équiper ni persister. Recliquer (ou Échap) rend le curseur normal.
  function toggleTest(r) {
    if (testingId === r.id) {
      endTest();
      setTestingId(null);
    } else {
      testCursor(r);
      setTestingId(r.id);
    }
  }
  // On rend toujours son curseur au démontage (Échap est géré par le panneau).
  useEffect(() => () => endTest(), [endTest]);

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

  // Suppression de masse : on exige une saisie exacte plutôt qu'un simple OK.
  // Ça dépossède les joueurs, donc un clic de trop ne doit pas suffire.
  async function wipeRewards() {
    const n = rewards.length;
    const typed = prompt(
      `Supprimer les ${n} lots ?\n\n` +
        `Ils seront retirés des caisses ET des inventaires des joueurs : les ` +
        `curseurs déjà gagnés seront perdus. C'est irréversible.\n\n` +
        `Pense à « Exporter » d'abord (section Transfert).\n\n` +
        `Tape SUPPRIMER pour confirmer :`
    );
    if (typed !== "SUPPRIMER") return;
    try {
      await apiFetch("/arcade/admin/rewards", { method: "DELETE", token });
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
  const testing = rewards.find((x) => x.id === testingId);
  // Mode FOCUS : pendant une édition, tout ce qui n'est pas l'objet édité est
  // du bruit (liste des autres lots, caisses, transfert) — on le retire.
  const focus = !!editReward || !!editCase;

  return (
    <div className="admin-stack">
      {err && <p className="psn-err">{err}</p>}

      {/* Banc d'essai : le curseur de la page a changé, on donne de quoi
          éprouver chaque état et un moyen évident de revenir en arrière. */}
      {testingId && (
        <CursorTestPanel
          label={testing?.name}
          onStop={() => {
            endTest();
            setTestingId(null);
          }}
        />
      )}

      {/* ---------- Les lots ---------- */}
      {!editCase && (
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Gift size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>
              {editReward
                ? editReward.id
                  ? `Modifier « ${editReward.name || "le lot"} »`
                  : "Nouveau lot"
                : "Lots"}
            </h2>
            {!editReward && (
              <p>
                Les cosmétiques gagnables. La <strong>rareté</strong> décide de la
                couleur ET de la chance de tirage — un lot n'est tirable qu'une fois
                ajouté au pool d'une caisse.
              </p>
            )}
          </div>
          {!editReward && rewards.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={toggleView}
              title={
                listView
                  ? "Revenir à la grille"
                  : "Vue liste : éditer rareté et description à la volée"
              }
            >
              {listView ? <LayoutGrid size={16} /> : <List size={16} />}
              {listView ? "Grille" : "Édition rapide"}
            </button>
          )}
          {!editReward && rewards.length > 0 && (
            <button className="btn btn-ghost arw-wipe" onClick={wipeRewards}>
              <Trash2 size={16} /> Effacer tout
            </button>
          )}
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

        {/* ---- Vue liste : édition rapide rareté / description ---- */}
        {!editReward && listView && rewards.length > 0 && (
          <div className="arw-list">
            <div className="arw-list-head">
              <span />
              <span>Nom</span>
              <span>Rareté</span>
              <span>Description</span>
              <span>Actif</span>
              <span />
            </div>
            {rewards.map((r) => {
              const e = edits[r.id] || {};
              const rarity = e.rarity ?? r.rarity;
              const enabled = e.enabled ?? r.enabled;
              return (
                <div
                  className={`arw-list-row ${edits[r.id] ? "dirty" : ""} ${
                    enabled ? "" : "off"
                  }`}
                  key={r.id}
                  style={{ "--arc-rarity": rarityColor(rarity) }}
                >
                  <span className="arw-list-art">
                    <RewardArt reward={r} size={26} />
                  </span>
                  <input
                    className="arw-list-name"
                    value={e.name ?? r.name}
                    onChange={(ev) => setEdit(r.id, "name", ev.target.value)}
                    aria-label={`Nom de ${r.name}`}
                  />
                  <select
                    className="arw-list-rarity"
                    value={rarity}
                    onChange={(ev) => setEdit(r.id, "rarity", ev.target.value)}
                    aria-label={`Rareté de ${r.name}`}
                  >
                    {RARITY_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {RARITIES[k].label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="arw-list-desc"
                    value={e.description ?? r.description ?? ""}
                    placeholder="Une phrase pour situer le lot…"
                    maxLength={200}
                    onChange={(ev) => setEdit(r.id, "description", ev.target.value)}
                    aria-label={`Description de ${r.name}`}
                  />
                  <button
                    className={`admin-switch clickable sm ${enabled ? "on" : ""}`}
                    onClick={() => setEdit(r.id, "enabled", !enabled)}
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`Activer ${r.name}`}
                  >
                    <span className="admin-switch-knob" />
                  </button>
                  <span className="pn-admin-actions">
                    {r.type === "cursor" && (
                      <button
                        className={`icon-btn clickable arw-test-btn ${
                          testingId === r.id ? "on" : ""
                        }`}
                        onClick={() => toggleTest(r)}
                        title={testingId === r.id ? "Arrêter le test" : "Tester"}
                      >
                        {testingId === r.id ? <Square size={15} /> : <Play size={15} />}
                      </button>
                    )}
                    <button
                      className="icon-btn clickable"
                      onClick={() =>
                        setEditReward({
                          ...r,
                          weight: r.weight ?? "",
                          data: { hotspotX: 0, hotspotY: 0, ...(r.data || {}) },
                        })
                      }
                      title="Ouvrir l'éditeur complet"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-btn clickable danger"
                      onClick={() => removeReward(r)}
                      title="Supprimer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Barre d'enregistrement, visible dès qu'une ligne est touchée. */}
        {dirtyCount > 0 && (
          <div className="arw-save-bar">
            <span>
              {dirtyCount} lot{dirtyCount > 1 ? "s" : ""} modifié
              {dirtyCount > 1 ? "s" : ""}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => setEdits({})}
              disabled={savingEdits}
            >
              <Undo2 size={15} /> Annuler
            </button>
            <button className="btn btn-primary" onClick={saveEdits} disabled={savingEdits}>
              {savingEdits ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              Enregistrer
            </button>
          </div>
        )}

        {editReward || listView ? null : rewards.length === 0 ? (
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
                  {r.type === "cursor" && (
                    <button
                      className={`icon-btn clickable arw-test-btn ${
                        testingId === r.id ? "on" : ""
                      }`}
                      onClick={() => toggleTest(r)}
                      title={testingId === r.id ? "Arrêter le test" : "Tester ce curseur"}
                    >
                      {testingId === r.id ? <Square size={16} /> : <Play size={16} />}
                    </button>
                  )}
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
      )}

      {/* ---------- Les caisses ---------- */}
      {!editReward && (
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <Package size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>
              {editCase
                ? editCase.id
                  ? `Modifier « ${editCase.name || "la caisse"} »`
                  : "Nouvelle caisse"
                : "Caisses"}
            </h2>
            {!editCase && (
              <p>
                Ce que les joueurs achètent avec leurs points. Coche les lots à mettre
                dedans : les chances affichées se calculent toutes seules.
              </p>
            )}
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

        {editCase ? null : cases.length === 0 ? (
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
                    onClick={() => setTryBox(buildTryBox(c))}
                    title="Essayer l'ouverture (sans rien débiter)"
                    disabled={!c.rewardIds.length}
                  >
                    <PackageOpen size={16} />
                  </button>
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
      )}

      {/* ---------- Rattrapage des points ---------- */}
      {!focus && (
        <section className="admin-card">
          <div className="admin-card-head">
            <span className="admin-card-icon">
              <Coins size={18} />
            </span>
            <div className="admin-card-titles">
              <h2>Points</h2>
              <p>
                L'arcade ne crédite que les parties finies depuis sa mise en ligne. Si
                des joueurs ont un score au classement mais <strong>0 point</strong>,
                c'est qu'ils ont joué avant : ce rattrapage comble l'écart.
              </p>
            </div>
          </div>

          <div className="arw-transfer">
            <button
              className="btn btn-ghost"
              onClick={() => runBackfill(false)}
              disabled={bfBusy}
            >
              {bfBusy ? <Loader2 size={16} className="spin" /> : <Coins size={16} />}
              Analyser
            </button>
            {bf && !bf.applied && bf.users.length > 0 && (
              <button
                className="btn btn-primary"
                onClick={() => runBackfill(true)}
                disabled={bfBusy}
              >
                <Check size={16} /> Créditer {bf.total.toLocaleString("fr-FR")} points
              </button>
            )}
          </div>

          {bf && (
            <div className="arw-bf">
              {bf.users.length === 0 ? (
                <p className="admin-hint arw-hint">
                  Tout le monde est à jour — rien à créditer ({bf.upToDate} joueur
                  {bf.upToDate > 1 ? "s" : ""} vérifié{bf.upToDate > 1 ? "s" : ""}).
                </p>
              ) : (
                <>
                  <p className="admin-hint arw-hint">
                    {bf.applied
                      ? `✅ ${bf.total.toLocaleString("fr-FR")} points crédités à ${bf.users.length} joueur(s).`
                      : `${bf.users.length} joueur(s) à créditer — rien n'a encore été écrit.`}
                  </p>
                  <ul className="arw-bf-list">
                    {bf.users.map((u) => (
                      <li key={u.username}>
                        <strong>{u.username}</strong>
                        <span>
                          {u.games} partie{u.games > 1 ? "s" : ""}
                        </span>
                        <em>+{u.missing.toLocaleString("fr-FR")}</em>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <p className="admin-hint arw-hint">
            Sans danger à relancer : on ne calcule pas « combien ajouter » mais
            « combien il devrait y avoir », donc un crédit n'est jamais doublé. Les
            points déjà dépensés en caisses ne faussent rien.
          </p>
        </section>
      )}

      {/* ---------- Transfert entre instances ---------- */}
      {!focus && (
      <section className="admin-card">
        <div className="admin-card-head">
          <span className="admin-card-icon">
            <ArrowLeftRight size={18} />
          </span>
          <div className="admin-card-titles">
            <h2>Transfert</h2>
            <p>
              Emporte les lots ET les caisses vers une autre instance (local ⇄ prod).
              Les images sont <strong>embarquées dans le fichier</strong> : rien ne
              pointe plus vers le serveur d'origine.
            </p>
          </div>
        </div>

        <div className="arw-transfer">
          <button className="btn btn-ghost" onClick={doExport} disabled={!!busyIO}>
            {busyIO === "export" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Download size={16} />
            )}
            Exporter
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => transferRef.current?.click()}
            disabled={!!busyIO}
          >
            {busyIO === "import" ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Upload size={16} />
            )}
            Importer
          </button>
          <label className="arw-transfer-opt">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Écraser les entrées déjà présentes (même clé)
          </label>
          <input
            ref={transferRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportFile}
          />
        </div>

        {ioMsg && <p className="admin-hint arw-hint">{ioMsg}</p>}
        <p className="admin-hint arw-hint">
          À l'import, lots et caisses sont retrouvés par leur <strong>clé</strong> :
          sans la case cochée, ceux qui existent déjà sont laissés intacts. Les caisses
          retrouvent leur contenu par clé de lot, donc importe-les avec leurs lots.
        </p>
      </section>
      )}

      {/* Ouverture à blanc d'une caisse (mode admin, rien n'est débité). */}
      {tryBox && (
        <CaseOpeningModal
          box={tryBox}
          token={token}
          dryRun
          onClose={() => setTryBox(null)}
        />
      )}
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

// ======================================================================
//  Segmenté générique — remplace les <select> ternes par des boutons.
// ======================================================================
function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`seg-item clickable ${on ? "on" : ""}`}
            style={o.color ? { "--seg-color": o.color } : undefined}
            onClick={() => onChange(o.value)}
            title={o.label}
          >
            {o.icon ? <o.icon size={15} /> : null}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ======================================================================
//  CursorField — un THÈME de curseur multi-états (normal, survol, texte…).
// ======================================================================
// Accepte un .zip (pack complet), plusieurs .cur/.ani/.ico/PNG d'un coup, OU
// un fichier déposé sur un rôle précis. Les .cur/.ani sont décodés côté client
// et convertis en PNG (point actif repris tout seul, un .ani devient animé).
//
// Stockage : le rôle « normal » reste à la racine de `data` (rétro-compat avec
// les anciens curseurs et le seed) ; les rôles en plus vont dans `data.roles`.
// buildCursorData est le SEUL endroit qui écrit cette forme.

let itemSeq = 0;
const makeItem = (name, desc) => ({ id: `it-${itemSeq++}`, name, desc, role: guessRole(name) });

// Un rôle = UN curseur (c'est un slot unique). La détection par nom de fichier
// peut coller le même rôle à plusieurs entrées d'un pack : on garde la première
// et on repasse les suivantes en « Ignorer », plutôt que de les laisser
// s'écraser silencieusement à la validation.
function dedupeRoles(items) {
  const taken = new Set();
  return items.map((it) => {
    if (!it.role) return it;
    if (taken.has(it.role)) return { ...it, role: null };
    taken.add(it.role);
    return it;
  });
}

// Uint8Array (vue) → ArrayBuffer exact (DataView/canvas veulent un buffer net).
const toArrayBuffer = (u8) =>
  u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer;

const isZipFile = (f) => /\.zip$/i.test(f.name) || /zip/i.test(f.type || "");

// Nom de lot proposé à partir d'un nom de fichier .zip ou d'un titre de pack.
// « sailor-moon_cursors (1).zip » → « Sailor moon ». On retire l'extension, le
// « (1) » des téléchargements en double, les séparateurs et le vocabulaire de
// remplissage qui n'apprend rien (« cursor », « pack », « free »…).
function prettyName(raw) {
  const s = String(raw || "")
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[_+-]+/g, " ")
    .replace(/\b(cursors?|curseurs?|pack|theme|th[eè]mes?|free|download|hd|set)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// Un data URL → URL hébergée (upload multipart).
async function uploadDataUrl(token, dataUrl) {
  const fd = new FormData();
  fd.append("image", dataUrlToBlob(dataUrl), "cursor.png");
  return (await apiUpload("/arcade/admin/upload", fd, token)).url;
}

// Charge une image en autorisant l'export canvas (l'en-tête CORS d'/uploads le
// permet). Le « ?cors » évite qu'un cache non-CORS déjà posé par un <img> ne
// vienne « tainter » le canvas.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible pour le redimensionnement."));
    img.src = url + (url.includes("?") ? "&" : "?") + "cors=1";
  });
}

// Redimensionne une image (URL) pour que sa plus grande dimension = targetPx,
// en nearest-neighbor (pixel art net). Renvoie { dataUrl, scale }.
async function resizeImageUrl(url, targetPx) {
  const img = await loadImage(url);
  const nat = Math.max(img.naturalWidth, img.naturalHeight) || targetPx;
  const scale = targetPx / nat;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false; // net, façon pixel-art
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: c.toDataURL("image/png"), scale };
}

// Descripteur { animated, frames:[dataUrl], durationsMs, hotspotX, hotspotY }
// → état stockable, en uploadant ses images. `cache` dédoublonne : une image
// partagée entre étapes/rôles n'est envoyée qu'une fois.
async function descriptorToState(desc, token, cache) {
  const urls = [];
  for (const f of desc.frames) {
    if (!cache.has(f)) cache.set(f, await uploadDataUrl(token, f));
    urls.push(cache.get(f));
  }
  return {
    url: urls[0],
    frames: desc.animated ? urls : undefined,
    durationsMs: desc.animated ? desc.durationsMs : undefined,
    animated: desc.animated || undefined,
    hotspotX: desc.hotspotX || 0,
    hotspotY: desc.hotspotY || 0,
  };
}

// `data` (forme stockée) → map { role: état } manipulable par l'éditeur.
function rolesFromData(data = {}) {
  const roles = {};
  if (data.roles && typeof data.roles === "object")
    for (const k of CURSOR_ROLE_KEYS) if (data.roles[k]?.url) roles[k] = data.roles[k];
  if (!roles.normal && data.url)
    roles.normal = {
      url: data.url,
      hotspotX: data.hotspotX || 0,
      hotspotY: data.hotspotY || 0,
      frames: data.frames,
      durationsMs: data.durationsMs,
      animated: data.animated,
      size: data.size,
      base: data.base,
    };
  return roles;
}

// map { role: état } → `data`. On n'attache `roles` que s'il existe au moins un
// état EN PLUS du normal, pour laisser les curseurs simples dans leur forme
// d'origine (aucune migration, seed intact).
function buildCursorData(roles) {
  const n = roles.normal;
  const top = n
    ? {
        url: n.url,
        hotspotX: n.hotspotX || 0,
        hotspotY: n.hotspotY || 0,
        frames: n.animated ? n.frames : undefined,
        durationsMs: n.animated ? n.durationsMs : undefined,
        animated: n.animated || undefined,
        // Persistés pour pouvoir re-redimensionner depuis la source (base).
        size: n.size,
        base: n.base,
      }
    : { url: "" };
  const extras = CURSOR_ROLE_KEYS.filter((k) => k !== "normal" && roles[k]?.url);
  const roleMap = extras.length
    ? Object.fromEntries(CURSOR_ROLE_KEYS.filter((k) => roles[k]?.url).map((k) => [k, roles[k]]))
    : undefined;
  return { ...top, roles: roleMap };
}

// Un fichier isolé (hors zip) → descripteur, en aiguillant curseur vs image.
async function fileToDescriptor(file) {
  const isCursor = /\.(cur|ani|ico)$/i.test(file.name) || !file.type.startsWith("image/");
  if (isCursor) return parseCursorFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseImageBytes(bytes, file.type || "image/png");
}

// Aperçu d'un état (rejoue l'animation d'un .ani).
function RoleThumb({ state, size = 40 }) {
  const frames = state.animated && state.frames?.length ? state.frames : [state.url];
  return <AnimatedFramePreview frames={frames} durationsMs={state.durationsMs} size={size} />;
}

function CursorField({ token, data, onChange, onSuggestName }) {
  const importRef = useRef(null);
  const slotRef = useRef(null);
  const slotTarget = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [urlValue, setUrlValue] = useState("");
  // Élément de revue : { id, name, role, desc, ready? }. `ready` = état déjà
  // hébergé (import par URL, rien à uploader) ; sinon `desc` sera uploadé.
  const [review, setReview] = useState(null);
  const [clipboard, setClipboard] = useState(null); // curseur copié
  const [menu, setMenu] = useState(null); // { x, y, role } — menu contextuel

  const roles = rolesFromData(data);
  // Bibliothèque du pack : tous les curseurs importés, gardés dispo pour
  // (ré)assigner un rôle même en modifiant le lot plus tard.
  const library = Array.isArray(data?.library) ? data.library : [];

  // Émet le `data` complet (rôles + bibliothèque) vers le parent.
  const emit = (nextRoles, nextLibrary) => {
    const d = buildCursorData(nextRoles);
    const lib = nextLibrary ?? library;
    if (lib.length) d.library = lib;
    onChange(d);
  };
  const applyRoles = (next) => emit(next);
  const setLibrary = (lib) => emit(roles, lib);

  // Import depuis une page custom-cursor.com : le serveur va chercher la page,
  // télécharge le(s) curseur(s) et nous renvoie leurs URLs + rôles devinés.
  async function importFromUrl() {
    const url = urlValue.trim();
    if (!url) return;
    setErr(null);
    setBusy(true);
    try {
      const d = await apiFetch("/arcade/admin/cursor-from-url", {
        method: "POST",
        token,
        body: { url },
      });
      const items = (d.cursors || []).map((c, i) => ({
        id: `url-${itemSeq++}`,
        name: c.slug || d.name || `curseur ${i + 1}`,
        role: c.role || guessRole(c.slug || "") || (i === 0 ? "normal" : null),
        ready: { url: c.url, hotspotX: 0, hotspotY: 0 },
        desc: { animated: false, frames: [c.url], durationsMs: [100] },
      }));
      if (!items.length) throw new Error("Aucun curseur récupéré.");
      // Le serveur renvoie le titre du pack (og:title) : il fait un bien
      // meilleur nom de lot que « curseur 1 ».
      if (d.name) onSuggestName?.(prettyName(d.name));
      setReview(dedupeRoles(items));
      setUrlValue("");
    } catch (e2) {
      setErr(e2.message || "Import de l'URL impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Déplie un .zip / une sélection multiple en descripteurs, puis ouvre la revue
  // d'assignation (rien n'est uploadé tant que l'admin n'a pas validé).
  async function handleImport(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    setErr(null);
    setBusy(true);
    try {
      const items = [];
      const problems = [];
      for (const file of files) {
        try {
          if (isZipFile(file)) {
            for (const e of await readCursorZip(file)) {
              const desc = e.isCursor
                ? await parseCursorBuffer(toArrayBuffer(e.bytes))
                : await parseImageBytes(e.bytes, e.mime);
              items.push(makeItem(e.name, desc));
            }
          } else {
            items.push(makeItem(file.name, await fileToDescriptor(file)));
          }
        } catch (inner) {
          problems.push(`${file.name} : ${inner.message}`);
        }
      }
      if (!items.length) throw new Error(problems[0] || "Aucun curseur exploitable trouvé.");
      if (items.length === 1 && !items[0].role) items[0].role = "normal";
      // Nom proposé : celui du .zip (il porte le nom du pack), sinon celui du
      // fichier s'il n'y en avait qu'un. Une sélection multiple ne donne aucun
      // nom évident, on n'invente rien.
      const zip = files.find(isZipFile);
      const guess = prettyName(zip ? zip.name : files.length === 1 ? files[0].name : "");
      if (guess) onSuggestName?.(guess);
      setReview(dedupeRoles(items));
      if (problems.length) setErr(`${problems.length} fichier(s) ignoré(s).`);
    } catch (e2) {
      setErr(e2.message || "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Valide la revue : upload des états retenus, remplissage des slots.
  async function confirmReview() {
    setBusy(true);
    setErr(null);
    try {
      const next = { ...roles };
      const lib = [...library];
      const cache = new Map();
      for (const it of review) {
        // `ready` = déjà hébergé (import URL) ; sinon on uploade les images.
        const state = it.ready || (await descriptorToState(it.desc, token, cache));
        // TOUT ce qui est importé va dans la bibliothèque (même « Ignorer ») pour
        // rester réassignable ; seuls les rôles choisis remplissent un slot.
        const name = (it.name || "").split(/[\\/]/).pop();
        if (!lib.some((e) => e.url === state.url)) lib.push({ ...state, name });
        if (it.role) next[it.role] = state;
      }
      emit(next, lib.slice(0, 80));
      setReview(null);
    } catch (e2) {
      setErr(e2.message || "Enregistrement des curseurs impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Upload direct d'un fichier sur un rôle donné (clic sur un slot vide).
  async function onSlotFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const role = slotTarget.current;
    if (!file || !role) return;
    setErr(null);
    setBusy(true);
    try {
      const desc = await fileToDescriptor(file);
      const state = await descriptorToState(desc, token, new Map());
      applyRoles({ ...roles, [role]: state });
    } catch (e2) {
      setErr(e2.message || "Fichier non pris en charge.");
    } finally {
      setBusy(false);
    }
  }

  function pickForSlot(role) {
    slotTarget.current = role;
    slotRef.current?.click();
  }
  function clearRole(role) {
    const next = { ...roles };
    delete next[role];
    applyRoles(next);
  }

  // --- Copier / coller / propager un curseur d'un rôle à l'autre ---
  // Les rôles partagent alors les mêmes images déjà hébergées : rien n'est
  // réuploadé, et chacun reste redimensionnable indépendamment ensuite.
  function copyRole(role) {
    if (roles[role]) setClipboard({ ...roles[role], from: role });
  }
  function pasteRole(role) {
    if (!clipboard) return;
    const { from: _f, ...state } = clipboard;
    applyRoles({ ...roles, [role]: state });
  }
  function applyToAll(role) {
    const src = roles[role];
    if (!src) return;
    const next = { ...roles };
    for (const r of CURSOR_ROLES) if (r.key !== role) next[r.key] = { ...src };
    applyRoles(next);
  }
  function setNormalHotspot(patch) {
    if (!roles.normal) return;
    applyRoles({ ...roles, normal: { ...roles.normal, ...patch } });
  }

  // Redimensionne un rôle : on repart TOUJOURS de la base (source d'origine,
  // jamais re-dégradée), on rend en nearest-neighbor à `px`, on réuploade, et on
  // décale le point actif d'autant.
  async function resizeRole(key, px) {
    const st = roles[key];
    if (!st) return;
    setErr(null);
    setBusy(true);
    try {
      const base = st.base || {
        url: st.url,
        frames: st.frames,
        durationsMs: st.durationsMs,
        animated: st.animated,
        hotspotX: st.hotspotX,
        hotspotY: st.hotspotY,
      };
      const srcFrames = base.animated && base.frames?.length ? base.frames : [base.url];
      const cache = new Map();
      const sized = [];
      let scale = 1;
      for (const f of srcFrames) {
        if (!cache.has(f)) {
          const r = await resizeImageUrl(f, px);
          scale = r.scale;
          cache.set(f, await uploadDataUrl(token, r.dataUrl));
        }
        sized.push(cache.get(f));
      }
      applyRoles({
        ...roles,
        [key]: {
          url: sized[0],
          frames: base.animated ? sized : undefined,
          durationsMs: base.animated ? base.durationsMs : undefined,
          animated: base.animated || undefined,
          hotspotX: Math.round((base.hotspotX || 0) * scale),
          hotspotY: Math.round((base.hotspotY || 0) * scale),
          size: px,
          base,
        },
      });
    } catch (e2) {
      setErr(e2.message || "Redimensionnement impossible.");
    } finally {
      setBusy(false);
    }
  }

  // Depuis la bibliothèque : place un curseur importé sur un rôle.
  function assignFromLibrary(entry, role) {
    const { name: _n, ...state } = entry; // le nom ne fait pas partie de l'état
    applyRoles({ ...roles, [role]: state });
  }
  function removeFromLibrary(i) {
    setLibrary(library.filter((_, idx) => idx !== i));
  }

  const onDrop = (e) => {
    e.preventDefault();
    if (busy || review) return;
    if (e.dataTransfer?.files?.length) handleImport(e.dataTransfer.files);
  };

  // Fermeture du menu contextuel. On écoute `pointerdown` et on ne ferme que si
  // le geste a lieu HORS du menu — surtout pas un simple « fermer sur le
  // prochain événement » : React peut vider ses effets passifs pendant la
  // propagation du clic droit, l'écouteur serait alors posé assez tôt pour
  // capter ce même clic et refermer le menu dans la foulée (donc « rien ne se
  // passe »). Un test de cible rend le comportement indépendant de ce timing.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (!e.target?.closest?.(".cur-menu")) setMenu(null);
    };
    const onKey = (e) => e.key === "Escape" && setMenu(null);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Les actions du menu le referment explicitement (il n'y a plus d'écouteur
  // « ferme sur le prochain clic » pour le faire à leur place).
  const runMenu = (fn) => {
    fn();
    setMenu(null);
  };

  // Ouvre le menu sur un slot, en gardant la carte visible à l'écran.
  function openMenu(e, role) {
    e.preventDefault();
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 190),
      role,
    });
  }

  return (
    <div className="admin-field">
      <label>
        <MousePointer2 size={14} /> Thème de curseur
      </label>

      {/* Coller un lien custom-cursor.com : le serveur importe le pack. */}
      {!review && (
        <div className="cur-url">
          <Link2 size={15} />
          <input
            type="url"
            value={urlValue}
            placeholder="Lien custom-cursor.com d'UN curseur (pas d'une collection)…"
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                importFromUrl();
              }
            }}
            disabled={busy}
          />
          <button
            type="button"
            className="btn btn-primary cur-url-go"
            onClick={importFromUrl}
            disabled={busy || !urlValue.trim()}
          >
            {busy ? <Loader2 size={15} className="spin" /> : "Importer"}
          </button>
        </div>
      )}

      {!review && <div className="cur-or">ou</div>}

      {/* Barre d'import : .zip ou plusieurs fichiers d'un coup. */}
      {!review && (
        <button
          type="button"
          className="cur-drop clickable"
          onClick={() => importRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          disabled={busy}
        >
          {busy ? <Loader2 size={20} className="spin" /> : <FileArchive size={20} />}
          <span className="cur-drop-main">
            {busy ? "Lecture…" : "Importer un pack .zip ou des fichiers"}
          </span>
          <span className="cur-drop-sub">
            Glisse-dépose ou clique — .zip, .cur, .ani, PNG (plusieurs à la fois)
          </span>
        </button>
      )}

      {/* Revue d'assignation : chaque curseur détecté → un rôle (pré-deviné). */}
      {review && (
        <div className="cur-review">
          <div className="cur-review-head">
            <Sparkles size={15} />
            <span>
              {review.length} curseur{review.length > 1 ? "s" : ""} détecté
              {review.length > 1 ? "s" : ""} — vérifie les rôles devinés
            </span>
          </div>
          <div className="cur-review-grid">
            {review.map((it) => (
              <div className={`cur-rev-card ${it.role ? "" : "ignored"}`} key={it.id}>
                <div className="cur-rev-thumb">
                  <RoleThumb
                    state={{
                      animated: it.desc.animated,
                      frames: it.desc.frames,
                      durationsMs: it.desc.durationsMs,
                      url: it.desc.frames[0],
                    }}
                    size={44}
                  />
                  {it.desc.animated && (
                    <span className="arw-cursor-badge">{it.desc.frames.length}</span>
                  )}
                </div>
                <div className="cur-rev-name" title={it.name}>
                  {it.name.split(/[\\/]/).pop()}
                </div>
                <select
                  className="cur-rev-role"
                  value={it.role || ""}
                  onChange={(ev) => {
                    const role = ev.target.value || null;
                    setReview((rv) =>
                      rv.map((x) => {
                        if (x.id === it.id) return { ...x, role };
                        // Le rôle est exclusif : celui qui l'avait le perd.
                        return role && x.role === role ? { ...x, role: null } : x;
                      })
                    );
                  }}
                >
                  <option value="">Ignorer</option>
                  {CURSOR_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="cur-review-foot">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => setReview(null)}
              disabled={busy}
            >
              Annuler
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={confirmReview}
              disabled={busy}
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Assigner aux rôles
            </button>
          </div>
        </div>
      )}

      {/* Les slots par rôle. */}
      {!review && (
        <div className="cur-slots">
          {CURSOR_ROLES.map((role) => {
            const st = roles[role.key];
            const Icon = ROLE_ICON[role.key];
            return (
              <div
                className={`cur-slot ${st ? "filled" : ""} ${
                  menu?.role === role.key ? "menued" : ""
                }`}
                key={role.key}
                onContextMenu={(e) => openMenu(e, role.key)}
                title="Clic droit : copier / coller / appliquer à tous"
              >
                <div className="cur-slot-head">
                  <Icon size={14} />
                  <strong>{role.label}</strong>
                  {role.required && <span className="cur-slot-req">requis</span>}
                </div>
                <p className="cur-slot-desc">{role.desc}</p>
                {st ? (
                  <div className="cur-slot-body">
                    <div className="arw-img-preview cur-slot-preview">
                      <RoleThumb state={st} size={48} />
                      {st.animated && <span className="arw-cursor-badge">{st.frames?.length}</span>}
                      <button
                        type="button"
                        className="pn-shot-del clickable"
                        onClick={() => clearRole(role.key)}
                        aria-label={`Retirer ${role.label}`}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {role.key === "normal" && (
                      <div className="cur-hotspot">
                        <span title="Le pixel qui clique vraiment, depuis le coin haut-gauche">
                          Point actif
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={st.hotspotX || 0}
                          onChange={(e) => setNormalHotspot({ hotspotX: Number(e.target.value) })}
                          aria-label="Point actif X"
                        />
                        <input
                          type="number"
                          min="0"
                          value={st.hotspotY || 0}
                          onChange={(e) => setNormalHotspot({ hotspotY: Number(e.target.value) })}
                          aria-label="Point actif Y"
                        />
                      </div>
                    )}
                    <div className="cur-size">
                      <span title="Taille d'affichage du curseur (px)">
                        <Maximize2 size={12} /> Taille
                      </span>
                      <div className="cur-size-chips">
                        {[24, 32, 48, 64, 96].map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`cur-size-chip clickable ${st.size === s ? "on" : ""}`}
                            onClick={() => resizeRole(role.key, s)}
                            disabled={busy}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cur-slot-add clickable"
                    onClick={() => pickForSlot(role.key)}
                    disabled={busy}
                  >
                    <Plus size={16} /> Ajouter
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bibliothèque du pack : tous les curseurs importés, réassignables. */}
      {!review && library.length > 0 && (
        <div className="cur-lib">
          <div className="cur-lib-head">
            <Layers size={14} /> Bibliothèque du pack ({library.length})
            <span className="cur-lib-sub">choisis un rôle pour placer un curseur</span>
          </div>
          <div className="cur-lib-grid">
            {library.map((e, i) => (
              <div className="cur-lib-item" key={e.url}>
                <div className="cur-lib-thumb">
                  <RoleThumb state={e} size={38} />
                  {e.animated && <span className="arw-cursor-badge">{e.frames?.length}</span>}
                  <button
                    type="button"
                    className="pn-shot-del clickable"
                    onClick={() => removeFromLibrary(i)}
                    aria-label="Retirer de la bibliothèque"
                  >
                    <X size={11} />
                  </button>
                </div>
                {e.name && (
                  <div className="cur-lib-name" title={e.name}>
                    {e.name}
                  </div>
                )}
                <select
                  className="cur-rev-role"
                  value=""
                  onChange={(ev) => {
                    if (ev.target.value) assignFromLibrary(e, ev.target.value);
                    ev.target.value = "";
                  }}
                >
                  <option value="">→ Rôle…</option>
                  {CURSOR_ROLES.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {!review && (
        <p className="admin-hint arw-hint">
          Seul <strong>Normal</strong> est requis. <strong>Survol lien</strong> (sur un
          bouton) et <strong>Survol déplaçable</strong> (sur une zone attrapable) sont
          deux curseurs <em>distincts</em> : règle-les séparément. Un rôle laissé vide
          garde son curseur d'origine — aucun ne recopie la flèche Normale.{" "}
          <strong>.cur/.ani</strong> gardent leur point actif ; un <strong>.ani</strong>{" "}
          devient animé. PNG 32×32 idéal, 128 px max.{" "}
          <strong>Clic droit</strong> sur un rôle pour le copier, le coller ailleurs ou
          l'appliquer à tous.
        </p>
      )}

      {err && <p className="psn-err arw-hint">{err}</p>}

      <input
        ref={importRef}
        type="file"
        accept=".zip,.cur,.ani,.ico,image/*"
        multiple
        hidden
        onChange={(e) => {
          // On COPIE avant de réinitialiser : `e.target.files` est la FileList
          // vivante de l'input, et remettre `value = ""` (pour pouvoir re-choisir
          // le même fichier ensuite) la viderait avant qu'on l'ait lue.
          const files = [...(e.target.files || [])];
          e.target.value = "";
          if (files.length) handleImport(files);
        }}
      />
      <input
        ref={slotRef}
        type="file"
        accept=".cur,.ani,.ico,image/*"
        hidden
        onChange={onSlotFile}
      />

      {/* Menu contextuel d'un slot (clic droit). Les actions se referment
          d'elles-mêmes via l'écouteur global. */}
      {menu && (
        <div className="cur-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <span className="cur-menu-title">
            {CURSOR_ROLES.find((r) => r.key === menu.role)?.label}
          </span>
          <button
            type="button"
            className="cur-menu-item clickable"
            onClick={() => runMenu(() => copyRole(menu.role))}
            disabled={!roles[menu.role]}
          >
            <Copy size={14} /> Copier
          </button>
          <button
            type="button"
            className="cur-menu-item clickable"
            onClick={() => runMenu(() => pasteRole(menu.role))}
            disabled={!clipboard}
          >
            <Clipboard size={14} /> Coller
            {clipboard && (
              <span className="cur-menu-chip">
                <RoleThumb state={clipboard} size={16} />
              </span>
            )}
          </button>
          <button
            type="button"
            className="cur-menu-item clickable"
            onClick={() => runMenu(() => applyToAll(menu.role))}
            disabled={!roles[menu.role]}
          >
            <Layers size={14} /> Appliquer à tous
          </button>
          <button
            type="button"
            className="cur-menu-item clickable danger"
            onClick={() => runMenu(() => clearRole(menu.role))}
            disabled={!roles[menu.role]}
          >
            <X size={14} /> Retirer
          </button>
        </div>
      )}
    </div>
  );
}

// --- Créer / modifier un lot ---
function RewardEditor({ token, initial, onCancel, onSaved }) {
  const [r, setR] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [testing, setTesting] = useState(false);
  const { testCursor, endTest } = useCosmetics();
  const isEdit = !!initial.id;

  // Tant que le test tourne, on rejoue le curseur À CHAQUE modification du
  // brouillon : assigner un rôle ou changer une taille se voit tout de suite,
  // sans rien enregistrer ni relancer.
  useEffect(() => {
    if (testing) testCursor({ data: r.data });
  }, [testing, r.data, testCursor]);
  // Le test ne survit pas à la fermeture de l'éditeur.
  useEffect(() => () => endTest(), [endTest]);

  function toggleTest() {
    if (testing) {
      endTest();
      setTesting(false);
    } else setTesting(true);
  }
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
      {/* La famille ne se choisit qu'à la création : sur un lot existant, elle
          est acquise (le contenu de `data` en dépend), donc on ne l'affiche
          même pas. */}
      {!isEdit && (
        <div className="pn-field">
          <span>Famille</span>
          <Segmented
            ariaLabel="Famille"
            value={r.type}
            onChange={(type) => set({ type })}
            options={Object.entries(REWARD_TYPES).map(([k, t]) => ({
              value: k,
              label: t.label,
              icon: FAMILY_ICON[k],
            }))}
          />
        </div>
      )}

      <div className="pn-editor-grid">
        <label className="pn-field grow">
          <span>Nom</span>
          <input
            value={r.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Curseur Master Sword"
          />
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

      <div className="pn-field">
        <span>Rareté</span>
        <Segmented
          ariaLabel="Rareté"
          value={r.rarity}
          onChange={(rarity) => set({ rarity })}
          options={RARITY_ORDER.map((k) => ({
            value: k,
            label: RARITIES[k].label,
            color: RARITIES[k].color,
          }))}
        />
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
        <CursorField
          token={token}
          data={r.data}
          onChange={(data) => set({ data })}
          // Ne remplit que si le champ est encore vide : un nom déjà saisi
          // n'est jamais écrasé par un import.
          onSuggestName={(name) =>
            setR((v) => (v.name.trim() ? v : { ...v, name }))
          }
        />
      ) : (
        <ImageField
          token={token}
          value={r.data.url}
          onChange={(url) => setData({ url })}
          label="Image du lot"
          hint="PNG ou SVG à fond transparent."
        />
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
        {/* Essayer le brouillon sans l'enregistrer (curseurs uniquement). */}
        {r.type === "cursor" && r.data?.url && (
          <button
            type="button"
            className={`btn btn-ghost pn-foot-left ${testing ? "on" : ""}`}
            onClick={toggleTest}
          >
            {testing ? <Square size={15} /> : <Play size={15} />}
            {testing ? "Arrêter le test" : "Tester"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          {isEdit ? "Enregistrer" : "Créer le lot"}
        </button>
      </div>

      {testing && (
        <CursorTestPanel
          label={r.name?.trim() || "Brouillon"}
          onStop={() => {
            endTest();
            setTesting(false);
          }}
        />
      )}
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
