import { useRef, useState } from "react";
import {
  Gamepad2,
  Loader2,
  Check,
  AlertTriangle,
  Microchip,
  ImagePlus,
  X,
  ShieldCheck,
  ShieldAlert,
  Save,
} from "lucide-react";
import { apiUpload } from "../lib/api";
import { CONSOLE, LICENCES } from "../lib/collection";
import { Modal, Section } from "./AdminSheet";
import { shrinkImageFile, fmtBytes } from "../lib/imageFile";

// ======================================================================
//  Poser un jeu Game Boy Advance sur l'étagère
// ======================================================================
// CE FORMULAIRE DEMANDE PLUS QUE CELUI D'AVANT, ET C'EST VOULU.
//
// La version DS était la plus courte des trois modales : une cartouche DS porte
// une BANNIÈRE — le titre du jeu dans sept langues joliment écrit, son éditeur,
// et l'icône 32×32 du menu de la console. On déposait le fichier, la fiche
// s'écrivait.
//
// UNE CARTOUCHE GBA N'A RIEN DE TOUT ÇA. Le format est de 2001, il n'y a pas de
// menu système à décorer : son en-tête donne un code de jeu, une région, une
// révision et un contrôle d'intégrité — et un titre interne de DOUZE CARACTÈRES
// EN CAPITALES, tronqué (« ZELDA MC », « POKEMON RUBY »). Ni éditeur, ni icône.
//
// Faire semblant de deviner aurait posé des boîtiers nus intitulés « Zelda Mc ».
// On demande donc VRAIMENT le titre et la jaquette, et on le dit clairement —
// c'est plus honnête, et ça prend trente secondes.

const ROM_RE = /\.(gba|agb|bin)$/i;

export default function GameModal({ token, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [cover, setCover] = useState(null); // { file, url }
  const [draft, setDraft] = useState({
    title: "",
    franchise: "",
    publisher: "",
    authors: "",
    synopsis: "",
    year: "",
    players: "",
    licence: "official",
    color: "#f2b70b",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [read, setRead] = useState(null); // ce que la cartouche a dit d'elle
  const fileRef = useRef(null);
  const coverRef = useRef(null);
  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  function take(f) {
    if (!f) return;
    if (!ROM_RE.test(f.name)) {
      setError("Il faut un fichier .gba (une cartouche Game Boy Advance).");
      return;
    }
    setError(null);
    setFile(f);
    // LE NOM DU FICHIER EST LE MEILLEUR TITRE DISPONIBLE, et il vaut mieux que
    // l'en-tête (voir l'en-tête de ce fichier). On le propose donc D'AVANCE, dans
    // le champ, plutôt que de laisser le serveur s'en arranger en silence :
    // l'admin voit ce qui va être écrit et le corrige d'un geste.
    setDraft((d) =>
      d.title
        ? d
        : {
            ...d,
            title: f.name
              .replace(ROM_RE, "")
              .replace(/[[(][^\])]*[\])]/g, " ")
              .replace(/[_.]+/g, " ")
              .replace(/\s{2,}/g, " ")
              .trim(),
          }
    );
  }

  // La jaquette est fortement conseillée : rien dans le fichier ne pourra la
  // remplacer. Elle est allégée avant l'envoi comme partout ailleurs — un scan de
  // jaquette pèse couramment plusieurs mégaoctets.
  async function takeCover(f) {
    if (!f) return;
    let picked = f;
    try {
      // `shrinkImageFile` rend un compte rendu, pas un fichier : il renvoie
      // l'original tel quel quand il tient déjà dans le budget.
      picked = (await shrinkImageFile(f)).file;
    } catch {
      /* format que ce navigateur ne décode pas : le serveur tranchera */
    }
    setCover({ file: picked, url: URL.createObjectURL(picked) });
  }

  async function save() {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("rom", file, file.name);
      if (cover) fd.append("cover", cover.file, cover.file.name || "cover.jpg");
      for (const [k, v] of Object.entries(draft)) {
        if (v === "" || v === null) continue;
        fd.append(k, String(v));
      }
      const d = await apiUpload("/collection/game", fd, token);
      // On ne referme pas tout de suite : ce que la cartouche a dit d'elle-même
      // mérite d'être VU une seconde — c'est la seule occasion de remarquer qu'un
      // en-tête ne passe pas le contrôle, ou qu'une ROM ne sait pas sauvegarder.
      setRead({ ...d.read, title: d.media?.title, poster: d.media?.poster });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (read)
    return (
      <Modal
        title="Le jeu est sur l'étagère"
        subtitle="Voilà ce que la cartouche a dit d'elle-même."
        Icon={Check}
        onClose={onDone}
        footer={
          <div className="adm-coll-foot-btns">
            <button className="btn btn-primary clickable" onClick={onDone}>
              <Check size={16} /> Terminé
            </button>
          </div>
        }
      >
        <div className="adm-rom-read">
          <span className="adm-rom-icon">
            {read.poster ? <img src={read.poster} alt="" /> : <Gamepad2 size={24} />}
          </span>
          <div>
            <strong>{read.title}</strong>
            <ul>
              <li>
                {read.recognized ? (
                  <>
                    <ShieldCheck size={13} /> En-tête valide — somme de contrôle du
                    BIOS vérifiée
                  </>
                ) : (
                  <>
                    <ShieldAlert size={13} /> En-tête inhabituel — homebrew,
                    traduction de fans, ou fichier à vérifier
                  </>
                )}
              </li>
              {read.code && (
                <li>
                  Code de jeu : {read.code}
                  {read.version ? ` (révision ${read.version})` : ""}
                </li>
              )}
              {read.region && <li>Région : {read.region}</li>}
              {read.internalTitle && <li>Titre interne : {read.internalTitle}</li>}
              <li>
                <Save size={13} />
                {read.saveType
                  ? `Sauvegarde de la cartouche : ${read.saveType}`
                  : "Aucune puce de sauvegarde détectée dans la ROM"}
              </li>
            </ul>
            <p>
              Les joueurs sauvegardent de toute façon sur leur compte, en états de
              machine : la puce de la cartouche ne les concerne pas. Tout se
              corrige depuis le tiroir d'édition — y compris la jaquette dépliée
              et les dimensions du boîtier.
            </p>
          </div>
        </div>
      </Modal>
    );

  return (
    <Modal
      title={`Ajouter un jeu ${CONSOLE}`}
      subtitle="Une cartouche, un titre, une jaquette."
      Icon={Gamepad2}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="adm-coll-error">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : (
            <p className="adm-coll-hint">
              La cartouche donne son code de jeu et sa région. Le titre et la
              jaquette, elle ne les a pas.
            </p>
          )}
          <div className="adm-coll-foot-btns">
            <button className="btn btn-ghost clickable" onClick={onClose}>
              Annuler
            </button>
            <button
              className="btn btn-primary clickable"
              onClick={save}
              disabled={!file || saving}
              title={file ? undefined : "Il faut une cartouche."}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Poser sur l'étagère
            </button>
          </div>
        </>
      }
    >
      <Section
        step={1}
        title="La cartouche"
        hint="Un fichier .gba. Il est servi tel quel au navigateur, qui le fait tourner dans mGBA — rien n'est converti."
      >
        <div
          className={`adm-drop ${over ? "over" : ""} ${file ? "filled" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <Microchip size={26} />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{fmtBytes(file.size)} — clique pour en choisir une autre</span>
            </>
          ) : (
            <>
              <strong>Glisse la cartouche ici</strong>
              <span>ou clique pour la choisir — .gba, 32 Mo au maximum</span>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".gba,.agb,.bin"
          hidden
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Section>

      <Section
        step={2}
        title="La jaquette"
        hint="À déposer : une cartouche GBA ne porte aucune icône, contrairement à une cartouche DS. Sans jaquette, le boîtier est peint à partir de sa seule teinte."
      >
        <div className="adm-rom-cover">
          <button
            type="button"
            className="adm-rom-cover-slot clickable"
            onClick={() => coverRef.current?.click()}
          >
            {cover ? <img src={cover.url} alt="" /> : <ImagePlus size={20} />}
          </button>
          <div>
            <p className="adm-coll-hint">
              Une boîte de GBA est haute et étroite (95 × 135 mm). La jaquette
              DÉPLIÉE — dos, tranche et couverture d'un seul tenant — se pose
              ensuite dans le tiroir d'édition, avec l'outil de mesure.
            </p>
            {cover && (
              <button
                type="button"
                className="btn btn-ghost clickable"
                onClick={() => setCover(null)}
              >
                <X size={14} /> Retirer
              </button>
            )}
          </div>
        </div>
        <input
          ref={coverRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            takeCover(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Section>

      <Section
        step={3}
        title="La fiche"
        hint="Le titre est proposé d'après le nom du fichier — corrige-le. Le reste est facultatif et se rattrape depuis le tiroir d'édition."
      >
        <label className="adm-coll-field">
          <span>Titre</span>
          <input
            value={draft.title}
            onChange={(e) => set("title")(e.target.value)}
            placeholder="The Legend of Zelda: The Minish Cap"
          />
        </label>

        <div className="adm-coll-grid">
          <label className="adm-coll-field">
            <span>Saga</span>
            <input
              value={draft.franchise}
              onChange={(e) => set("franchise")(e.target.value)}
              placeholder="Mario, Zelda…"
            />
          </label>
          <label className="adm-coll-field">
            <span>Développement</span>
            <input
              value={draft.authors}
              onChange={(e) => set("authors")(e.target.value)}
              placeholder="Studio, séparés par des virgules"
            />
          </label>
          <label className="adm-coll-field">
            <span>Éditeur</span>
            <input
              value={draft.publisher}
              onChange={(e) => set("publisher")(e.target.value)}
              placeholder="Nintendo"
            />
          </label>
          <label className="adm-coll-field">
            <span>Année</span>
            <input
              type="number"
              value={draft.year}
              onChange={(e) => set("year")(e.target.value)}
            />
          </label>
          {/* Le nombre de joueurs est imprimé au dos de la boîte et NULLE PART
              dans le fichier : c'est le seul champ que la cartouche ne pourra
              jamais remplir. */}
          <label className="adm-coll-field">
            <span>Joueurs (au dos de la boîte)</span>
            <input
              type="number"
              min="1"
              max="16"
              value={draft.players}
              onChange={(e) => set("players")(e.target.value)}
              placeholder="1"
            />
          </label>
          <label className="adm-coll-field">
            <span>Provenance</span>
            <select
              value={draft.licence}
              onChange={(e) => set("licence")(e.target.value)}
            >
              {Object.entries(LICENCES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="adm-coll-field">
          <span>Synopsis</span>
          <textarea
            rows={3}
            value={draft.synopsis}
            onChange={(e) => set("synopsis")(e.target.value)}
          />
        </label>
      </Section>
    </Modal>
  );
}
