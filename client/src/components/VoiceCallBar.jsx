import { Loader2, Mic, MicOff, PhoneCall, PhoneOff, Volume2, VolumeX } from "lucide-react";
import PeerMenu, { usePeerMenu } from "./CallPeerMenu";

// ======================================================================
//  La barre d'appel — « on est tous dedans »
// ======================================================================
// Une bande de têtes, un bouton de micro, un bouton pour raccrocher. Elle vit
// SOUS l'écran de jeu et ne bouge plus : un appel qui change de place au fil des
// phases, c'est un bouton de micro qu'on cherche au moment où on en a besoin.
//
// CE QU'ELLE DOIT DIRE AVANT TOUT : pourquoi on ne s'entend plus. La coupure
// automatique pendant l'imitation est le cœur du mode, mais sans un mot à
// l'écran elle passe pour une panne — on tape « allô ? », on recharge la page,
// on rouvre Discord. La bande prend donc une couleur et un libellé explicites
// pendant la coupure, et le bouton de micro se désarme visiblement.
//
// LES PASTILLES S'ALLUMENT QUAND ON PARLE (cf. makeSpeakingWatch). Dans un appel
// où l'on ne voit personne, c'est ce qui remplace le fait de se regarder : sans
// ça, à six, on se coupe la parole en permanence.
export default function VoiceCallBar({ call, silent, silentLabel }) {
  const {
    inCall,
    connecting,
    error,
    muted,
    participants,
    join,
    leave,
    toggleMute,
    volumes,
    setUserVolume,
    maxGain,
  } = call;
  // LE VOLUME PAR JOUEUR, ici aussi. C'est même le mode où il sert le plus :
  // une partie de Perroquet consiste à écouter les autres crier, et quelqu'un
  // dont le micro est trop bas rend sa manche inaudible — donc invisible dans
  // le classement, puisqu'on n'a rien entendu de sa performance.
  const { menu, tileProps } = usePeerMenu();

  if (!inCall)
    return (
      <div className="pq-call idle">
        <button className="pq-call-join clickable" onClick={join} disabled={connecting}>
          {connecting ? <Loader2 size={16} className="spin" /> : <PhoneCall size={16} />}
          Rejoindre l'appel
        </button>
        <span className="pq-call-pitch">
          On s'entend en jouant — et le jeu coupe les micros pendant les imitations.
        </span>
        {error && <span className="pq-call-err">{error}</span>}
      </div>
    );

  return (
    <div className={`pq-call ${silent ? "gagged" : ""}`}>
      <span className="pq-call-state">
        {silent ? <VolumeX size={15} /> : <Volume2 size={15} />}
        {silent ? silentLabel || "Cabine fermée" : "En appel"}
      </span>

      <ul className="pq-call-heads">
        {participants.map((p) => (
          <li
            key={p.peerId}
            className={`${p.speaking ? "talking" : ""} ${p.muted ? "muted" : ""} ${
              p.isMe ? "me" : ""
            } ${p.state === "connecting" ? "wait" : ""}`}
            title={
              p.isMe
                ? "toi"
                : `${p.username || "…"} — clic droit (ou appui long) pour le volume`
            }
            // On ne règle pas son propre volume : on ne s'écoute pas soi-même.
            {...(p.isMe || !p.userId
              ? {}
              : tileProps({ id: p.userId, username: p.username }))}
          >
            {p.avatar ? (
              <img src={p.avatar} alt="" loading="lazy" />
            ) : (
              <span className="ph">{(p.isMe ? "•" : p.username || "?")[0].toUpperCase()}</span>
            )}
            {p.muted && <MicOff size={11} className="pq-call-off" />}
          </li>
        ))}
      </ul>

      <button
        className={`pq-call-mic clickable ${muted ? "off" : ""}`}
        onClick={toggleMute}
        disabled={silent}
        title={silent ? "Le jeu a coupé les micros" : muted ? "Reprendre la parole" : "Couper mon micro"}
      >
        {muted || silent ? <MicOff size={16} /> : <Mic size={16} />}
      </button>
      <button className="pq-call-hang clickable" onClick={leave} title="Quitter l'appel">
        <PhoneOff size={15} />
      </button>

      {error && <span className="pq-call-err">{error}</span>}

      <PeerMenu
        menu={menu}
        volumes={volumes}
        maxGain={maxGain}
        onVolume={setUserVolume}
      />
    </div>
  );
}
