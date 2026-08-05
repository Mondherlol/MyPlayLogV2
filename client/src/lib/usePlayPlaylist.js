import { useState } from "react";
import { apiFetch } from "./api";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { playlistItemToTrack } from "./lists";

// Lecture directe d'une playlist depuis une card (page Listes, feed…) : on
// charge les pistes puis le mini-lecteur global prend la main, avec un lien
// de retour vers la playlist. Signale aussi l'écoute au serveur (notif au
// propriétaire + carte du fil), best-effort.
// `list` : { id, title } minimum.
export function usePlayPlaylist(list) {
  const { token } = useAuth();
  const player = usePlayer();
  const [launching, setLaunching] = useState(false);

  async function playPlaylist(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (launching) return;
    setLaunching(true);
    try {
      const d = await apiFetch(`/lists/${list.id}`, { token });
      const tracks = (d.list?.items || [])
        .filter((i) => i.videoId || i.url)
        .map(playlistItemToTrack);
      if (tracks.length) {
        player.playFromList(tracks[0], tracks, {
          source: { href: `/lists/${list.id}`, label: list.title },
        });
        apiFetch(`/lists/${list.id}/listen`, { method: "POST", token }).catch(
          () => {}
        );
      }
    } catch {
      /* best-effort */
    } finally {
      setLaunching(false);
    }
  }

  return { launching, playPlaylist };
}
