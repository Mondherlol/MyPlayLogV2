using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// Compte le temps passé dans les jeux hors boutique.
    ///
    /// Toutes les 15 secondes : la liste des processus, le chemin de chaque
    /// exécutable, et l'appid Steam que l'émulateur a posé à côté du jeu
    /// (steam_appid.txt, steam_emu.ini…). Un jeu vu tourner ouvre une
    /// session ; toutes les 5 minutes, et quand il se ferme, le temps écoulé
    /// part en « morceau » — une coupure de courant ne coûte donc jamais plus
    /// de 5 minutes de jeu.
    ///
    /// ⚠️ LES JEUX LANCÉS DEPUIS STEAM NE COMPTENT PAS (dossier steamapps) :
    /// Steam les compte déjà, et l'import Steam de MyPlayLog les ramène.
    /// </summary>
    public class PlayTracker : IDisposable
    {
        const int TickMs = 15000;
        static readonly TimeSpan FlushEvery = TimeSpan.FromMinutes(5);

        public event Action<PlayChunk> Chunk;
        public event Action<string> Started;

        readonly Timer timer;
        readonly object gate = new object();
        // appid → dernier envoi (ou début de session)
        readonly Dictionary<string, DateTime> running = new Dictionary<string, DateTime>();
        // dossier d'un exécutable → appid ("" = aucun)
        readonly Dictionary<string, string> dirCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public PlayTracker()
        {
            timer = new Timer(_ => Tick(), null, 3000, TickMs);
        }

        public string[] Running
        {
            get { lock (gate) return running.Keys.ToArray(); }
        }

        int busy;

        void Tick()
        {
            // Une passe lente (disque endormi) ne doit pas se chevaucher avec la suivante.
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try
            {
                var seen = new HashSet<string>();
                foreach (var p in Process.GetProcesses())
                {
                    try
                    {
                        if (p.Id <= 4) continue;
                        var path = ImagePath(p.Id);
                        if (path == null) continue;
                        var appId = AppIdOf(path);
                        if (appId != null) seen.Add(appId);
                    }
                    finally
                    {
                        p.Dispose();
                    }
                }

                var now = DateTime.UtcNow;
                var started = new List<string>();
                var chunks = new List<PlayChunk>();
                lock (gate)
                {
                    foreach (var appId in seen)
                    {
                        if (!running.ContainsKey(appId))
                        {
                            running[appId] = now;
                            started.Add(appId);
                        }
                        else if (now - running[appId] >= FlushEvery)
                        {
                            chunks.Add(Make(appId, now - running[appId]));
                            running[appId] = now;
                        }
                    }
                    foreach (var appId in running.Keys.Where(k => !seen.Contains(k)).ToList())
                    {
                        chunks.Add(Make(appId, now - running[appId]));
                        running.Remove(appId);
                    }
                }
                foreach (var a in started) if (Started != null) Started(a);
                foreach (var c in chunks) if (c.Seconds >= 30 && Chunk != null) Chunk(c);
            }
            catch
            {
                // Une passe ratée n'arrête pas le suivi.
            }
            finally
            {
                Interlocked.Exchange(ref busy, 0);
            }
        }

        static PlayChunk Make(string appId, TimeSpan span)
        {
            return new PlayChunk
            {
                Id = Guid.NewGuid().ToString("N"),
                AppId = long.Parse(appId),
                Seconds = (int)Math.Min(span.TotalSeconds, 12 * 3600),
            };
        }

        /// <summary>Envoie tout de suite ce qui court (fermeture du compagnon).</summary>
        public void FlushAll()
        {
            var now = DateTime.UtcNow;
            var chunks = new List<PlayChunk>();
            lock (gate)
            {
                foreach (var appId in running.Keys.ToList())
                {
                    chunks.Add(Make(appId, now - running[appId]));
                    running[appId] = now;
                }
            }
            foreach (var c in chunks) if (c.Seconds >= 30 && Chunk != null) Chunk(c);
        }

        // --- L'appid d'un exécutable -------------------------------------------
        static readonly string WinDir = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        static readonly string[] AppIdFiles =
        {
            "steam_appid.txt", @"steam_settings\steam_appid.txt", "steam_emu.ini", "cream_api.ini",
            "OnlineFix.ini", "steam_api.ini", "SmartSteamEmu.ini", "ColdClientLoader.ini", "ds.ini",
        };
        static readonly Regex IniAppId = new Regex(@"(?im)^\s*(?:RealAppId|AppId|app_id)\s*=\s*(\d{2,10})\s*$");
        static readonly Regex BareId = new Regex(@"^\s*(\d{2,10})\s*$");

        string AppIdOf(string exePath)
        {
            if (exePath.StartsWith(WinDir, StringComparison.OrdinalIgnoreCase)) return null;
            var lower = exePath.ToLowerInvariant();
            if (lower.Contains(@"\steamapps\") || lower.Contains(@"\windowsapps\") || lower.Contains(@"\steam\steam.exe"))
                return null;

            var dir = Path.GetDirectoryName(exePath);
            if (dir == null) return null;
            lock (gate)
            {
                string cached;
                if (dirCache.TryGetValue(dir, out cached)) return cached.Length > 0 ? cached : null;
            }

            // Le fichier est souvent à côté de l'exe, parfois un ou deux dossiers
            // au-dessus (Binaries\Win64\Jeu.exe).
            string found = null;
            var probe = dir;
            for (int depth = 0; depth < 3 && probe != null && found == null; depth++)
            {
                foreach (var name in AppIdFiles)
                {
                    var f = Path.Combine(probe, name);
                    if (!File.Exists(f)) continue;
                    found = ReadAppId(f);
                    if (found != null) break;
                }
                probe = Path.GetDirectoryName(probe);
            }
            lock (gate) dirCache[dir] = found ?? "";
            return found;
        }

        static string ReadAppId(string file)
        {
            try
            {
                var info = new FileInfo(file);
                if (info.Length > 256 * 1024) return null;
                var text = File.ReadAllText(file);
                var m = file.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ? BareId.Match(text) : IniAppId.Match(text);
                return m.Success ? m.Groups[1].Value : null;
            }
            catch
            {
                return null;
            }
        }

        // --- Le chemin d'un processus, sans droits d'administrateur ------------
        // QueryFullProcessImageName se contente de PROCESS_QUERY_LIMITED_INFORMATION :
        // il répond pour les jeux (processus du même utilisateur) là où
        // Process.MainModule échoue souvent.
        const uint QueryLimited = 0x1000;

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr handle);

        static string ImagePath(int pid)
        {
            var h = OpenProcess(QueryLimited, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref size) ? sb.ToString() : null;
            }
            finally
            {
                CloseHandle(h);
            }
        }

        public void Dispose()
        {
            timer.Dispose();
        }
    }
}
