import { useEffect, useState } from "react";
import { Download, X, Gamepad2, Share, Plus } from "lucide-react";

// Clé localStorage : si l'utilisateur ferme la pop-up, on ne la remontre pas
// avant cette date (en ms). Un refus « poli » de 14 jours.
const DISMISS_KEY = "mpl_install_dismissed";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// L'app tourne-t-elle déjà en mode installé (écran d'accueil) ?
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) &&
    !window.MSStream
  );
}

function isSnoozed() {
  const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() < until;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null); // event beforeinstallprompt (Android/Chrome)
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    // Déjà installée ou refusée récemment → on ne fait rien.
    if (isStandalone() || isSnoozed()) return;

    // Android / Chrome / Edge : le navigateur nous laisse déclencher l'install.
    function onBeforeInstall(e) {
      e.preventDefault(); // on garde la main pour proposer notre propre UI
      setDeferred(e);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Une fois installée : on cache et on ne réaffiche plus.
    function onInstalled() {
      setVisible(false);
      localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS * 100));
    }
    window.addEventListener("appinstalled", onInstalled);

    // iOS/Safari n'émet pas beforeinstallprompt : on montre des instructions
    // manuelles, après un court délai pour ne pas agresser à l'ouverture.
    let iosTimer;
    if (isIOS()) {
      iosTimer = setTimeout(() => {
        setIos(true);
        setVisible(true);
      }, 2500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS));
  }

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* peu importe le choix : on referme dans tous les cas */
    }
    setDeferred(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="install-prompt" role="dialog" aria-label="Installer MyPlayLog">
      <button className="install-close clickable" onClick={dismiss} aria-label="Fermer">
        <X size={18} />
      </button>

      <div className="install-icon">
        <Gamepad2 size={24} strokeWidth={2.5} />
      </div>

      <div className="install-body">
        <strong className="install-title">
          Installe My<span className="grad-text">PlayLog</span>
        </strong>

        {ios ? (
          <p className="install-text">
            Appuie sur <Share size={14} className="install-inline" /> puis «&nbsp;
            <Plus size={13} className="install-inline" />
            &nbsp;Sur l'écran d'accueil&nbsp;» pour l'ajouter comme une appli.
          </p>
        ) : (
          <p className="install-text">
            Ajoute l'app à ton écran d'accueil : plein écran, accès direct, comme
            une vraie appli.
          </p>
        )}
      </div>

      {!ios && (
        <button className="install-cta btn btn-primary clickable" onClick={install}>
          <Download size={16} /> Installer
        </button>
      )}
    </div>
  );
}
