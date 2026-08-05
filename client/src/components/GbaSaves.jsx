import {
  Save,
  Trash2,
  Play,
  Loader2,
  Clock,
  AlertTriangle,
  Cpu,
  X,
} from "lucide-react";
import { AUTO_SLOT, fmtWhen } from "../lib/gbaSaves";
import { fmtDuration } from "../lib/collection";

// ======================================================================
//  Le tiroir de sauvegardes
// ======================================================================
// C'EST LE CŒUR DE CE QUI CHANGE. Le rayon DS laissait la partie dans l'IndexedDB
// du navigateur : perdue au premier nettoyage d'historique, jamais partagée entre
// deux appareils, et le modèle de progression l'écrivait noir sur blanc — « rien
// à reprendre ». Autrement dit, on laissait le joueur perdre sa partie et on le
// documentait. Ici, la partie est sur le serveur, à son nom.
//
// UNE VIGNETTE PAR EMPLACEMENT, ET C'EST TOUT LE SUJET. Une liste de
// « Emplacement 3 — 14:22 » ne dit rien de ce qu'on va retrouver ; l'écran figé
// de la console, lui, se reconnaît instantanément — la salle où l'on était, le
// combat en cours, le menu ouvert. C'est ce qui fait la différence entre un
// tiroir qu'on utilise et un tiroir qu'on n'ouvre jamais.
//
// L'AUTOMATIQUE EST À PART, EN HAUT, EN GRAND. C'est celui dont on se sert dans
// 95 % des cas (« reprends où j'en étais »), et il n'a pas à se chercher au
// milieu de six cases identiques. Les six manuels servent à autre chose : garder
// un avant-boss, un embranchement, une partie à montrer.
//
// UN ÉTAT APPARTIENT À SON CŒUR, et le tiroir le dit. Un état écrit par mGBA ne
// se relit pas dans VBA : la mémoire n'y est pas disposée pareil, et le charger
// quand même rendrait une bouillie. On le signale sur la vignette concernée
// plutôt que d'échouer au moment du clic.

export default function GbaSaves({
  saves,
  slots,
  core,
  busy, // le numéro de l'emplacement en cours d'écriture / lecture
  error,
  playSeconds,
  onLoad,
  onSave,
  onDelete,
  onClose,
}) {
  const bySlot = new Map(saves.map((s) => [s.slot, s]));
  const auto = bySlot.get(AUTO_SLOT);
  const manual = Array.from({ length: slots }, (_, i) => i + 1);

  return (
    <div className="gba-saves" role="dialog" aria-label="Sauvegardes">
      <header>
        <div>
          <strong>Sauvegardes</strong>
          <em>
            Elles vivent sur ton compte : tu reprends cette partie depuis
            n'importe quel appareil.
          </em>
        </div>
        <button className="clickable" onClick={onClose} aria-label="Fermer">
          <X size={15} />
        </button>
      </header>

      {error && (
        <p className="gba-saves-error">
          <AlertTriangle size={13} /> {error}
        </p>
      )}

      {/* ---------------- la reprise ---------------- */}
      <section className="gba-saves-auto">
        {auto ? (
          <>
            <Shot save={auto} core={core} />
            <div>
              <strong>Reprise automatique</strong>
              <span>
                <Clock size={11} /> {fmtWhen(auto.at)}
                {auto.playSeconds > 60 && ` · ${fmtDuration(auto.playSeconds)} de jeu`}
              </span>
              <Mismatch save={auto} core={core} />
            </div>
            <button
              className="btn btn-primary clickable"
              onClick={() => onLoad(AUTO_SLOT)}
              disabled={busy !== null || !sameCore(auto, core)}
            >
              {busy === AUTO_SLOT ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Play size={15} />
              )}
              Reprendre
            </button>
          </>
        ) : (
          <p className="gba-saves-empty">
            <Save size={15} />
            La console sauvegardera toute seule pendant que tu joues, et en
            t'éteignant. Il n'y a rien à faire.
          </p>
        )}
      </section>

      {/* ---------------- les emplacements ---------------- */}
      <p className="gba-saves-title">
        Emplacements
        <em>
          {playSeconds > 60
            ? `${fmtDuration(playSeconds)} sur cette cartouche`
            : "les tiens, à poser quand tu veux"}
        </em>
      </p>

      <div className="gba-saves-grid">
        {manual.map((slot) => {
          const save = bySlot.get(slot);
          const working = busy === slot;
          return (
            <div key={slot} className={`gba-slot ${save ? "filled" : ""}`}>
              {save ? (
                <>
                  <Shot save={save} core={core} />
                  <span className="gba-slot-when">{fmtWhen(save.at)}</span>
                  {/* Les actions ne sortent qu'au survol : six vignettes
                      surchargées de trois boutons chacune, ce n'est plus un
                      tiroir, c'est un tableau de bord. */}
                  <div className="gba-slot-acts">
                    <button
                      className="clickable"
                      onClick={() => onLoad(slot)}
                      disabled={busy !== null || !sameCore(save, core)}
                      title={
                        sameCore(save, core)
                          ? "Charger"
                          : `Écrite avec ${save.core} — passe sur ce moteur pour la charger`
                      }
                      aria-label={`Charger l'emplacement ${slot}`}
                    >
                      {working ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                    </button>
                    <button
                      className="clickable"
                      onClick={() => onSave(slot)}
                      disabled={busy !== null}
                      title="Écraser avec la partie en cours"
                      aria-label={`Écraser l'emplacement ${slot}`}
                    >
                      <Save size={14} />
                    </button>
                    <button
                      className="clickable danger"
                      onClick={() => onDelete(slot)}
                      disabled={busy !== null}
                      title="Vider"
                      aria-label={`Vider l'emplacement ${slot}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <Mismatch save={save} core={core} compact />
                </>
              ) : (
                <button
                  className="gba-slot-free clickable"
                  onClick={() => onSave(slot)}
                  disabled={busy !== null}
                  aria-label={`Sauvegarder dans l'emplacement ${slot}`}
                >
                  {working ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  <em>{slot}</em>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="gba-saves-note">
        Une sauvegarde garde l'état exact de la console, pas seulement ce que le
        jeu voulait bien noter : tu reprends au pixel où tu t'es arrêté.
      </p>
    </div>
  );
}

// Deux états ne sont interchangeables que s'ils viennent du même moteur. Une
// sauvegarde d'avant ce champ (`core` vide) est laissée passer : refuser de
// charger sur un doute serait pire que d'essayer.
const sameCore = (save, core) => !save?.core || save.core === core;

function Shot({ save, core }) {
  return (
    <span className={`gba-shot ${sameCore(save, core) ? "" : "stale"}`}>
      {save.thumb ? (
        <img src={save.thumb} alt="" loading="lazy" />
      ) : (
        <Save size={16} />
      )}
    </span>
  );
}

// Le mot qui explique pourquoi ce bouton est éteint. Sans lui, une vignette
// grisée passe pour un bogue.
function Mismatch({ save, core, compact }) {
  if (sameCore(save, core)) return null;
  return (
    <span className={`gba-stale ${compact ? "compact" : ""}`} title={`Écrite avec ${save.core}`}>
      <Cpu size={11} /> {compact ? save.core : `Écrite avec ${save.core}`}
    </span>
  );
}
