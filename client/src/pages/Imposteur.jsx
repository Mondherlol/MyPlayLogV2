import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, Users, VenetianMask } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../lib/api";

// ======================================================================
//  L'Imposteur — le hall
// ======================================================================
// LA SEULE PAGE DU SITE QUI N'A RIEN À JOUER. Les six autres mini-jeux ouvrent
// sur une partie ; celui-ci ne peut pas — à un joueur il n'y a ni majorité, ni
// imposteur, ni vote. On ne fait donc pas semblant : ce hall sert à ouvrir un
// salon ou à en rejoindre un. Point.
//
// Il expliquait aussi la règle, en trois cartes. RETIRÉ : personne n'arrive ici
// pour lire. Une phrase suffit à poser le principe (« tout le monde reçoit le
// même jeu, sauf un »), le reste s'apprend en une manche — et le règlement
// complet entre les deux boutons ne faisait que repousser le moment de cliquer.

export default function Imposteur() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [rounds, setRounds] = useState(3);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const create = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      const d = await apiFetch("/imposteur", { method: "POST", token, body: { rounds } });
      navigate(`/imposteur/${d.room.code}`);
    } catch (e) {
      setErr(e.message || "Impossible d'ouvrir un salon.");
      setBusy(false);
    }
  }, [token, rounds, navigate]);

  const join = useCallback(
    (e) => {
      e.preventDefault();
      const c = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
      if (c.length < 4) {
        setErr("Un code de salon fait six caractères.");
        return;
      }
      navigate(`/imposteur/${c}`);
    },
    [code, navigate]
  );

  return (
    <div className="imp-page imp-hall">
      <ImposteurDecor />

      {/* Le retour à l'arcade, en haut à gauche : c'est de là qu'on arrive, et
          c'est la seule sortie évidente d'un jeu qui n'a pas de page parente. */}
      <header className="imp-top">
        <Link to="/arcade" className="imp-back clickable">
          <ArrowLeft size={17} /> <span>Arcade</span>
        </Link>
        <span className="imp-progress ghost" />
      </header>

      <section className="imp-hero">
        <span className="imp-hero-mask" aria-hidden="true">
          <VenetianMask size={44} />
        </span>
        <span className="imp-kicker">
          <Users size={13} /> À partir de 3 joueurs
        </span>
        <h1 className="imp-hero-title">L&apos;Imposteur</h1>
        <p className="imp-hero-sub">
          Tout le monde reçoit le même jeu. <b>Sauf un.</b> Et il ne le sait pas.
        </p>
      </section>

      {err && <p className="imp-err">{err}</p>}

      <section className="imp-hall-actions">
        <div className="imp-panel">
          <h2 className="imp-panel-title">Ouvrir un salon</h2>

          <div className="imp-setting">
            <span>Manches</span>
            <div className="imp-chips">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  className={`imp-chip clickable ${rounds === n ? "on" : ""}`}
                  onClick={() => setRounds(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <button className="imp-go clickable" onClick={create} disabled={busy}>
            {busy ? <Loader2 size={17} className="spin" /> : <VenetianMask size={17} />}
            Ouvrir un salon
          </button>
        </div>

        <div className="imp-panel">
          <h2 className="imp-panel-title">Rejoindre</h2>
          <form className="imp-joinbox" onSubmit={join}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="code du salon"
              maxLength={8}
              autoComplete="off"
              spellCheck="false"
            />
            <button className="imp-go alt clickable" type="submit">
              Entrer <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

// Le décor : des masques qui flottent très en arrière-plan. Purement CSS —
// aucun état, aucun rendu conditionnel, il n'a rien à faire dans le cycle de
// React (même parti pris que PerroquetDecor).
export function ImposteurDecor() {
  return (
    <div className="imp-decor" aria-hidden="true">
      <i className="imp-decor-mask a" />
      <i className="imp-decor-mask b" />
      <i className="imp-decor-mask c" />
      <span className="imp-decor-spot" />
    </div>
  );
}
