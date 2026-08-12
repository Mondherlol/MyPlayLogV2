// ======================================================================
//  La sonnerie
// ======================================================================
// C'EST UN FICHIER, ET RIEN D'AUTRE. La sonnerie entrante joue la sonnerie
// choisie par la personne appelée (server/src/routes/ringtones.js) : la sienne,
// celle qu'elle a prise dans la banque, ou la sonnerie par défaut de l'app —
// qui est elle aussi un vrai fichier, déposé depuis le panel admin.
//
// PAS DE REPLI SYNTHÉTISÉ. Il y en a eu un, fait d'oscillateurs, et il a été
// retiré : il ne ressemblait à rien, et surtout il surgissait aux pires moments
// (à l'arrêt d'un aperçu, quand la balise audio signale une erreur en se
// vidant). Une sonnerie qu'on n'a pas choisie et qu'on n'attendait pas est pire
// qu'un appel silencieux.
//
// CONSÉQUENCE ASSUMÉE : tant qu'aucune sonnerie n'est déposée dans le panel
// admin, un appel arrive SANS SON. Ce n'est pas un appel perdu pour autant —
// la modale prend l'écran, pulse et fait vibrer le téléphone (cf.
// components/IncomingCall.jsx) ; c'est le son qui manque, pas l'appel. Les deux
// écrans le disent noir sur blanc plutôt que de le laisser découvrir.
//
// ------------------------------------------------------ le blocage de l'autoplay
// Un navigateur refuse de jouer un son tant que l'utilisateur n'a rien touché de
// la page, et une sonnerie est précisément le cas où l'on n'a rien touché. On ne
// peut donc PAS garantir qu'elle s'entende — raison de plus pour que la modale
// ne se repose pas dessus.

// `pref` est le réglage résolu par le serveur : { url }. Rend toujours une
// fonction d'arrêt, même quand il n'y a rien à jouer — l'appelant n'a pas à
// savoir s'il y avait une sonnerie.
export function startRingtone(pref) {
  const url = pref?.url;
  if (!url) return () => {};

  let el;
  try {
    el = new Audio(url);
  } catch {
    return () => {};
  }

  // EN BOUCLE : les sonneries déposées durent souvent trois secondes, et un
  // appel qui sonne une fois puis se tait ressemble à un appel raccroché.
  el.loop = true;
  el.volume = 0.85;
  el.play().catch(() => {
    /* autoplay refusé : la modale vibre et pulse, c'est elle qui rattrape */
  });

  return () => {
    el.pause();
    // ⚠️ ON NE TOUCHE PAS À `src`. Le vider (`el.src = ""`) fait échouer le
    // chargement et déclenche un évènement `error` sur la balise — c'est ce qui
    // faisait jouer un son parasite À CHAQUE PAUSE. Une balise mise en pause et
    // laissée telle quelle est ramassée avec le reste ; il n'y a rien à nettoyer.
    el.currentTime = 0;
  };
}

// ----------------------------------------------------------------------
//  La tonalité d'appel SORTANT
// ----------------------------------------------------------------------
// Le « tuuut … tuuut » qu'on entend en attendant que l'autre décroche. Il ne
// sert pas à faire joli : sans lui, lancer un appel donne exactement le même
// écran silencieux qu'un appel en panne, et on raccroche au bout de quatre
// secondes en croyant que ça n'a pas marché.
//
// Plus grave, plus long et plus espacé que la sonnerie entrante — c'est ainsi
// sur tous les téléphones, et ça évite de croire qu'on reçoit un appel alors
// qu'on en passe un. Volume plus bas aussi : celui-là, on l'entend au casque
// pendant qu'on attend, pas depuis la pièce d'à côté.
export function startOutgoingTone() {
  let ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return () => {};
  }
  ctx.resume?.().catch(() => {});

  const master = ctx.createGain();
  master.gain.value = 0.07;
  master.connect(ctx.destination);

  let timer = 0;
  let stopped = false;

  const beep = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    const dur = 1.1;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 400;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.03);
    gain.gain.setValueAtTime(1, t + dur - 0.06);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    timer = setTimeout(beep, 3400);
  };
  beep();

  return () => {
    stopped = true;
    clearTimeout(timer);
    try {
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
      setTimeout(() => ctx.close().catch(() => {}), 200);
    } catch {
      ctx.close?.().catch(() => {});
    }
  };
}

// La vibration, en boucle. `navigator.vibrate` n'existe que sur mobile (et pas
// sur iOS), et le motif ne se répète pas tout seul : on le relance nous-mêmes.
//
// C'est ce qui rattrape le son bloqué : un téléphone dans une poche ne compte
// pas sur ses haut-parleurs.
export function startBuzz() {
  if (typeof navigator === "undefined" || !navigator.vibrate) return () => {};
  const pattern = [420, 220, 420, 1400];
  const period = pattern.reduce((a, b) => a + b, 0);
  const fire = () => navigator.vibrate(pattern);
  fire();
  const id = setInterval(fire, period);
  return () => {
    clearInterval(id);
    navigator.vibrate(0);
  };
}
