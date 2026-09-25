using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace MyPlayLog.Companion
{
    /// <summary>Un jeu trouvé sur le PC.</summary>
    public class LocalGame
    {
        // Clé locale : l'appid ("2531310") s'il y en a un, sinon
        // "dir:<dossier en minuscules>". Côté serveur : steam:<appid> / dir:<nom>.
        public string Key;
        public string AppId;
        public string Name;     // nom du dossier (null pour un jeu vu seulement par ses sauvegardes)
        public string Folder;   // chemin complet du dossier du jeu
        public string Emulator; // RUNE, GSE, Ubisoft…
    }

    /// <summary>
    /// Les jeux du PC, repérés sans qu'ils tournent :
    ///
    /// - les DOSSIERS DE JEUX (D:\Games…) : chaque sous-dossier qui contient un
    ///   exécutable de jeu est un jeu. Son appid Steam, s'il en a un, est lu dans
    ///   les fichiers de l'émulateur (steam_appid.txt, steam_emu.ini…) ; sinon
    ///   (émulateur Ubisoft, jeu sans DRM…), c'est le NOM du dossier qui le fera
    ///   reconnaître côté serveur ;
    /// - les SAUVEGARDES des émulateurs (…\RUNE\2531310) : un jeu lancé au moins
    ///   une fois, même sans succès débloqué.
    ///
    /// Rien n'est envoyé au profil pour autant : ces jeux arrivent « à valider »
    /// sur le site, où l'on écarte ce qui n'est pas un jeu.
    /// </summary>
    public static class Library
    {
        static readonly object gate = new object();
        static List<LocalGame> games = new List<LocalGame>();

        public static LocalGame[] Games
        {
            get { lock (gate) return games.ToArray(); }
        }

        /// <summary>Les dossiers de jeux usuels présents sur les disques du PC.</summary>
        public static List<string> AutoDetect()
        {
            var found = new List<string>();
            var names = new[] { "Games", "Jeux", "Jeux PC", "PC Games", "Games PC", "Jeux video", "Jeux vidéo" };
            foreach (var d in DriveInfo.GetDrives())
            {
                try
                {
                    if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                    foreach (var n in names)
                    {
                        var p = Path.Combine(d.RootDirectory.FullName, n);
                        if (Directory.Exists(p) && !found.Contains(p, StringComparer.OrdinalIgnoreCase)) found.Add(p);
                    }
                }
                catch
                {
                    // Disque qui ne répond pas : on passe.
                }
            }
            return found;
        }

        /// <summary>Relit les dossiers de jeux et les sauvegardes des émulateurs.</summary>
        public static List<LocalGame> Scan(IEnumerable<string> roots)
        {
            var list = new List<LocalGame>();
            foreach (var root in roots)
            {
                string[] dirs;
                try
                {
                    dirs = Directory.GetDirectories(root);
                }
                catch
                {
                    continue;
                }
                foreach (var dir in dirs)
                {
                    try
                    {
                        var g = Detect(dir);
                        if (g != null && !list.Any(x => x.Key == g.Key)) list.Add(g);
                    }
                    catch
                    {
                    }
                }
            }

            // Les sauvegardes d'émulateurs : un appid déjà vu dans un dossier de
            // jeux garde ce dossier (et son nom).
            foreach (var source in Emulators.Sources())
            {
                // Ubisoft : des identifiants de produit, pas des appid Steam ; le
                // jeu est déjà là par son dossier (cf. UbisoftGame).
                if (!source.Exists || source.Ubisoft) continue;
                string[] dirs;
                try
                {
                    dirs = Directory.GetDirectories(source.Root);
                }
                catch
                {
                    continue;
                }
                foreach (var dir in dirs)
                {
                    var id = Path.GetFileName(dir);
                    long n;
                    if (id.Length < 2 || !id.All(char.IsDigit) || !long.TryParse(id, out n) || n <= 0) continue;
                    var known = list.FirstOrDefault(x => x.Key == id);
                    if (known != null)
                    {
                        if (known.Emulator == null) known.Emulator = source.Label;
                        continue;
                    }
                    list.Add(new LocalGame { Key = id, AppId = id, Emulator = source.Label });
                }
            }

            lock (gate) games = list;
            return list;
        }

        /// <summary>Le jeu dont le dossier contient cet exécutable.</summary>
        public static LocalGame GameAt(string exePath)
        {
            lock (gate)
            {
                foreach (var g in games)
                    if (g.Folder != null && exePath.StartsWith(g.Folder + "\\", StringComparison.OrdinalIgnoreCase))
                        return g;
            }
            return null;
        }

        /// <summary>
        /// Le jeu d'un dossier de sauvegarde Ubisoft (…\Goldberg UplayEmu Saves\66088) :
        /// ses sauvegardes portent le nom de l'exécutable (ACBlackFlag[AutoSave01].save
        /// ↔ ACBlackFlag.exe), ce qui le relie au bon dossier de jeu. Rend aussi
        /// ce préfixe, qui sert de nom à défaut de mieux.
        /// </summary>
        public static LocalGame UbisoftGame(string saveDir, out string prefix)
        {
            prefix = null;
            try
            {
                foreach (var f in Directory.GetFiles(saveDir, "*.save"))
                {
                    var n = Path.GetFileNameWithoutExtension(f);
                    int cut = n.IndexOf('[');
                    prefix = (cut > 0 ? n.Substring(0, cut) : n).Trim();
                    if (prefix.Length > 0) break;
                }
            }
            catch
            {
            }
            if (string.IsNullOrEmpty(prefix)) return null;
            LocalGame[] snapshot;
            lock (gate) snapshot = games.Where(g => g.Folder != null).ToArray();
            var exe = prefix + ".exe";
            // D'abord à la racine des jeux (le cas courant), puis deux niveaux
            // plus bas (Binaries\Win64\…) — jamais tout le dossier d'un jeu.
            foreach (var g in snapshot)
                if (File.Exists(Path.Combine(g.Folder, exe))) return g;
            foreach (var g in snapshot)
            {
                try
                {
                    foreach (var sub in Directory.GetDirectories(g.Folder))
                    {
                        if (File.Exists(Path.Combine(sub, exe))) return g;
                        foreach (var sub2 in Directory.GetDirectories(sub))
                            if (File.Exists(Path.Combine(sub2, exe))) return g;
                    }
                }
                catch
                {
                }
            }
            return null;
        }

        public static LocalGame ByKey(string key)
        {
            lock (gate) return games.FirstOrDefault(g => g.Key == key);
        }

        // --- Reconnaître un dossier de jeu -------------------------------------
        // Ce qui n'est PAS l'exécutable d'un jeu : désinstalleurs, installeurs,
        // bibliothèques redistribuables, rapporteurs de plantage.
        static readonly Regex NotGame = new Regex(
            @"^(unins\d*|setup.*|install(er)?|.*redist.*|dxsetup|dotnet.*|ue\dprereq.*|.*crash.*|easyanticheat_(eos_)?setup|quicksfv|.*updater.*|vcredist.*|oalinst|physx.*|dxwebsetup)$",
            RegexOptions.IgnoreCase);

        static readonly HashSet<string> AppIdFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "steam_appid.txt", "steam_emu.ini", "cream_api.ini", "OnlineFix.ini", "steam_api.ini",
            "SmartSteamEmu.ini", "ColdClientLoader.ini", "ds.ini", "tenoke.ini", "codex.ini",
        };

        static readonly HashSet<string> Skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "_CommonRedist", "Redist", "Redistributables", "DirectX", "Support", "__Installer", "vcredist", "Engine",
        };

        static LocalGame Detect(string dir)
        {
            string appId = null;
            bool hasExe = false;
            var signals = new HashSet<string>();
            var queue = new Queue<KeyValuePair<string, int>>();
            queue.Enqueue(new KeyValuePair<string, int>(dir, 0));
            int visited = 0;
            // Trois niveaux, 80 dossiers au plus : les fichiers qui comptent sont
            // près de l'exécutable (Binaries\Win64\…), pas au fond des données.
            while (queue.Count > 0 && visited < 80)
            {
                var cur = queue.Dequeue();
                visited++;
                string[] files;
                try
                {
                    files = Directory.GetFiles(cur.Key);
                }
                catch
                {
                    continue;
                }
                foreach (var f in files)
                {
                    var name = Path.GetFileName(f);
                    if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                        && !NotGame.IsMatch(Path.GetFileNameWithoutExtension(name)))
                        hasExe = true;
                    if (appId == null && AppIdFiles.Contains(name)) appId = PlayTracker.ReadAppId(f);
                    Signal(name, f, signals);
                }
                var settings = Path.Combine(cur.Key, @"steam_settings\steam_appid.txt");
                if (File.Exists(settings))
                {
                    signals.Add("goldberg");
                    if (appId == null) appId = PlayTracker.ReadAppId(settings);
                }
                if (cur.Value >= 2) continue;
                try
                {
                    foreach (var sub in Directory.GetDirectories(cur.Key))
                    {
                        var n = Path.GetFileName(sub);
                        if (Skip.Contains(n)) continue;
                        var lower = n.ToLowerInvariant();
                        if (lower.Contains("rune")) signals.Add("rune");
                        if (lower.Contains("codex")) signals.Add("codex");
                        queue.Enqueue(new KeyValuePair<string, int>(sub, cur.Value + 1));
                    }
                }
                catch
                {
                }
            }
            if (!hasExe) return null;
            return new LocalGame
            {
                Key = appId ?? ("dir:" + dir.ToLowerInvariant()),
                AppId = appId,
                Name = Path.GetFileName(dir),
                Folder = dir,
                Emulator = EmulatorOf(signals),
            };
        }

        static void Signal(string name, string path, HashSet<string> signals)
        {
            var lower = name.ToLowerInvariant();
            if (lower == "steam_emu.ini")
            {
                // CODEX et RUNE écrivent tous deux un steam_emu.ini : l'en-tête dit lequel.
                var head = Head(path);
                if (head.IndexOf("RUNE", StringComparison.OrdinalIgnoreCase) >= 0) signals.Add("rune");
                else if (head.IndexOf("CODEX", StringComparison.OrdinalIgnoreCase) >= 0) signals.Add("codex");
                else signals.Add("steamemu");
            }
            else if (lower.StartsWith("onlinefix")) signals.Add("onlinefix");
            else if (lower.StartsWith("upc_r") || lower.StartsWith("uplay_r") || lower == "uplay.ini") signals.Add("ubisoft");
            else if (lower == "cream_api.ini") signals.Add("creamapi");
            else if (lower == "tenoke.ini") signals.Add("tenoke");
            else if (lower == "steam_interfaces.txt" || lower == "coldclientloader.ini") signals.Add("goldberg");
        }

        static string Head(string path)
        {
            try
            {
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    var buf = new byte[4096];
                    int n = fs.Read(buf, 0, buf.Length);
                    return Encoding.UTF8.GetString(buf, 0, n);
                }
            }
            catch
            {
                return "";
            }
        }

        static readonly string[][] Labels =
        {
            new[] { "rune", "RUNE" }, new[] { "codex", "CODEX" }, new[] { "tenoke", "TENOKE" },
            new[] { "onlinefix", "OnlineFix" }, new[] { "ubisoft", "Ubisoft" }, new[] { "creamapi", "CreamAPI" },
            new[] { "goldberg", "Goldberg" }, new[] { "steamemu", "Steam emu" },
        };

        static string EmulatorOf(HashSet<string> signals)
        {
            foreach (var l in Labels)
                if (signals.Contains(l[0])) return l[1];
            return null;
        }
    }
}
