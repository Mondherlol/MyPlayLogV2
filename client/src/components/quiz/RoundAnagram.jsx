import { useEffect, useMemo, useState } from "react";
import { Heart, Shuffle } from "lucide-react";
import GameSearch from "./GameSearch";

// ======================================================================
//  Épreuve « Lettres mêlées » — l'anagramme
// ======================================================================
// Le titre d'un jeu, lettres dans le désordre : MINECRAFT s'affiche CARFTEMIN.
// On le retape pour marquer.
//
// ------------------------------------------------------- les lettres barrées
// À mesure qu'on écrit, les lettres de la grille se grisent : elles sont
// « consommées ». C'est ce qui rend l'épreuve jouable au lieu de pénible — on
// voit ce qu'il reste à caser, et on repère immédiatement qu'on a inventé une
// lettre qui n'existe pas dans le tas (elle s'affiche alors en rouge sous le
// champ).
//
// Le décompte se fait PAR OCCURRENCE, pas par lettre : si le titre contient
// deux N et qu'on en a tapé un seul, il reste un N disponible. Une simple
// appartenance à un ensemble aurait grisé les deux d'un coup et donné une
// fausse indication.
//
// On peut aussi CLIQUER les lettres pour composer la réponse : sur téléphone,
// où le clavier virtuel mange la moitié de l'écran, c'est souvent plus
// confortable que de taper.
export default function RoundAnagram({
  round,
  locked,
  reveal,
  lives,
  candidates,
  onAttempt,
  sfx,
}) {
  const [tries, setTries] = useState(0);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  // Ce que le joueur a composé, uniquement pour griser les lettres. La réponse
  // envoyée reste celle du champ de recherche.
  const [typed, setTyped] = useState("");

  useEffect(() => {
    setTries(0);
    setFlash(null);
    setTyped("");
  }, [round?.index]);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // Quelles tuiles sont consommées par la saisie, et quelles lettres tapées
  // n'existent pas dans le tas.
  const { used, extra } = useMemo(() => {
    const pool = [...(round.letters || [])];
    const taken = new Set();
    const surplus = [];
    const norm = [...String(typed).toUpperCase().normalize("NFD")]
      .filter((c) => /[A-Z0-9]/.test(c));
    for (const ch of norm) {
      const idx = pool.findIndex((l, i) => l === ch && !taken.has(i));
      if (idx >= 0) taken.add(idx);
      else surplus.push(ch);
    }
    return { used: taken, extra: surplus };
  }, [typed, round.letters]);

  const left = (round.letters || []).length - used.size;

  async function submit(cand) {
    if (locked || busy) return;
    setBusy(true);
    try {
      const out = await onAttempt({ ...cand, misses: tries });
      if (!out?.correct) {
        setTries((t) => t + 1);
        setFlash(cand.name);
        setTyped("");
        sfx?.play?.("wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qz-anagram">
      <span className="qz-anagram-kicker">
        <Shuffle size={13} /> Les lettres du titre, dans le désordre
      </span>

      {/* La grille de lettres. C'est l'énigme entière : elle contient déjà tout
          ce qu'il faut pour répondre. */}
      <div className={`qz-tiles ${reveal ? "revealed" : ""}`}>
        {(round.letters || []).map((l, i) => (
          <span
            key={i}
            className={`qz-tile ${used.has(i) ? "used" : ""}`}
            style={{ animationDelay: `${i * 45}ms` }}
          >
            {l}
          </span>
        ))}
      </div>

      {/* La forme du titre : le nombre de mots et leur longueur. Ça ne donne
          aucune lettre, et ça transforme une bouillie de quatorze signes en
          énigme abordable. */}
      {round.words?.length > 0 && !reveal && (
        <span className="qz-anagram-shape">
          {round.words.length > 1
            ? `${round.words.length} mots · ${round.words.join(" + ")} lettres`
            : `${round.words[0]} lettres`}
        </span>
      )}

      {reveal && round.gameName && (
        <div className="qz-anagram-answer">
          {round.cover && <img src={round.cover} alt="" draggable="false" />}
          <span>
            <em>C'était</em>
            <b>{round.gameName}</b>
          </span>
        </div>
      )}

      {!reveal && (
        <>
          <div className="qz-lives-row">
            <div className="qz-lives" aria-label={`${lives} essais restants`}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Heart
                  key={i}
                  size={16}
                  className={i < lives ? "on" : "off"}
                  fill={i < lives ? "currentColor" : "none"}
                />
              ))}
            </div>
            <span className="qz-anagram-left">
              {left > 0 ? `${left} lettre${left > 1 ? "s" : ""} à caser` : "Toutes casées !"}
            </span>
            {extra.length > 0 && (
              <span className="qz-anagram-extra">
                pas dans le tas : {[...new Set(extra)].join(" ")}
              </span>
            )}
            {flash && (
              <span className="qz-wrong" key={flash}>
                Raté — <s>{flash}</s>
              </span>
            )}
          </div>

          <GameSearch
            candidates={candidates}
            onSubmit={submit}
            onType={setTyped}
            disabled={locked || busy}
            resetKey={`${round.index}-${tries}`}
            placeholder="Quel jeu se cache dans ces lettres ?"
          />
        </>
      )}
    </div>
  );
}
