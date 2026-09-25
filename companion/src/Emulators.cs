using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MyPlayLog.Companion
{
    public class Unlock
    {
        public string Name;
        public long At; // horodatage Unix, 0 si l'émulateur ne le note pas
        public string Title; // nom lisible, quand l'émulateur le connaît (Ubisoft)
    }

    /// <summary>Un dossier où un émulateur range ses succès, un sous-dossier par appid.</summary>
    public class Source
    {
        public string Label;
        public string Root;
        public string[] Files;
        // Émulateur Ubisoft : le dossier porte l'identifiant de PRODUIT Ubisoft
        // (66088), pas un appid Steam — on ne doit jamais les confondre.
        public bool Ubisoft;

        public bool Exists { get { return Directory.Exists(Root); } }
    }

    /// <summary>
    /// Où les émulateurs de succès notent ce qui a été débloqué, et comment le lire.
    ///
    /// Tous rangent les fichiers sous l'appid Steam du jeu : c'est ce qui nous
    /// donne la fiche du jeu et la liste de ses succès côté serveur. Les
    /// formats varient d'un émulateur à l'autre (et d'une version à l'autre) :
    /// la lecture est volontairement tolérante — un JSON ou un INI, plusieurs
    /// façons d'écrire « débloqué » et la date.
    /// </summary>
    public static class Emulators
    {
        public static List<Source> Sources()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string pub = Environment.GetEnvironmentVariable("PUBLIC") ?? @"C:\Users\Public";
            string docs = Path.Combine(pub, "Documents");

            var json = new[] { "achievements.json" };
            var ini = new[] { "achievements.ini" };
            return new List<Source>
            {
                new Source { Label = "Goldberg", Root = Path.Combine(appData, "Goldberg SteamEmu Saves"), Files = json },
                new Source { Label = "GSE", Root = Path.Combine(appData, "GSE Saves"), Files = json },
                new Source { Label = "EMPRESS", Root = Path.Combine(appData, "EMPRESS"), Files = json },
                new Source { Label = "EMPRESS", Root = Path.Combine(docs, "EMPRESS"), Files = json },
                new Source { Label = "CODEX", Root = Path.Combine(docs, @"Steam\CODEX"), Files = ini },
                new Source { Label = "CODEX", Root = Path.Combine(appData, @"Steam\CODEX"), Files = ini },
                new Source { Label = "RUNE", Root = Path.Combine(docs, @"Steam\RUNE"), Files = ini },
                new Source { Label = "OnlineFix", Root = Path.Combine(docs, "OnlineFix"), Files = ini },
                new Source { Label = "SKIDROW", Root = Path.Combine(local, "SKIDROW"), Files = new[] { "achiev.ini" } },
                // upc_r2 (Goldberg UplayEmu) : même format que Goldberg, rangé par
                // produit Ubisoft ; il n'écrit que si Achievements = 1 dans upc_r2.ini.
                new Source { Label = "Ubisoft", Root = Path.Combine(appData, "Goldberg UplayEmu Saves"), Files = json, Ubisoft = true },
            };
        }

        /// <summary>
        /// L'appid, lu dans le chemin : le premier dossier tout en chiffres sous
        /// la racine de l'émulateur (…\CODEX\1245620\achievements.ini).
        /// </summary>
        public static string AppIdFromPath(string root, string file)
        {
            var rel = file.Substring(root.Length).TrimStart('\\', '/');
            foreach (var part in rel.Split('\\', '/'))
            {
                long id;
                if (part.Length >= 2 && part.All(char.IsDigit) && long.TryParse(part, out id) && id > 0)
                    return part;
            }
            return null;
        }

        public static bool IsAchievementFile(Source s, string file)
        {
            var name = Path.GetFileName(file);
            return s.Files.Any(f => string.Equals(f, name, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Tous les fichiers de succès d'une source, avec leur appid.</summary>
        public static IEnumerable<KeyValuePair<string, string>> Scan(Source s)
        {
            if (!s.Exists) yield break;
            IEnumerable<string> files;
            try
            {
                files = s.Files
                    .SelectMany(f => Directory.EnumerateFiles(s.Root, f, SearchOption.AllDirectories))
                    .ToList();
            }
            catch
            {
                yield break; // dossier illisible (droits) : on passe
            }
            foreach (var file in files)
            {
                var appId = AppIdFromPath(s.Root, file);
                if (appId != null) yield return new KeyValuePair<string, string>(appId, file);
            }
        }

        public static List<Unlock> Parse(string file)
        {
            string text = ReadShared(file);
            if (string.IsNullOrWhiteSpace(text)) return new List<Unlock>();
            // ⚠️ PAR L'EXTENSION, PAS PAR LE PREMIER CARACTÈRE : un INI commence
            // lui aussi par « [ » (sa première section), et se faisait lire
            // comme du JSON — qui échouait, donc « aucun succès ».
            bool json = file.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
            try
            {
                return json ? ParseJson(text) : ParseIni(text);
            }
            catch
            {
                // Fichier en cours d'écriture par le jeu : on relira au prochain changement.
                return new List<Unlock>();
            }
        }

        // Le jeu peut tenir le fichier ouvert en écriture : on le lit sans le bloquer.
        static string ReadShared(string file)
        {
            try
            {
                using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs, Encoding.UTF8, true))
                {
                    return sr.ReadToEnd();
                }
            }
            catch
            {
                return null;
            }
        }

        static readonly string[] DoneKeys = { "earned", "achieved", "unlocked", "state", "done" };
        static readonly string[] TimeKeys = { "earned_time", "unlocktime", "unlock_time", "timestamp", "time", "unlocked_time" };

        static bool Truthy(object v)
        {
            if (v == null) return false;
            if (v is bool) return (bool)v;
            var s = v.ToString().Trim().ToLowerInvariant();
            return s == "1" || s == "true" || s == "yes";
        }

        static long ToUnix(object v)
        {
            if (v == null) return 0;
            long n;
            if (!long.TryParse(v.ToString().Trim(), out n)) return 0;
            // Certains émulateurs écrivent des millisecondes.
            if (n > 100000000000L) n /= 1000;
            return n > 0 ? n : 0;
        }

        static object Pick(IDictionary<string, object> d, string[] keys)
        {
            foreach (var kv in d)
            {
                if (keys.Any(k => string.Equals(k, kv.Key, StringComparison.OrdinalIgnoreCase))) return kv.Value;
            }
            return null;
        }

        // Goldberg / GSE / EMPRESS : { "ACH_X": { "earned": true, "earned_time": 1700000000 } }
        // (et quelques variantes en tableau : [{ "name": "ACH_X", "achieved": 1 }]).
        static List<Unlock> ParseJson(string text)
        {
            var json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
            var root = json.DeserializeObject(text);
            var result = new List<Unlock>();

            var map = root as Dictionary<string, object>;
            if (map != null)
            {
                foreach (var kv in map)
                {
                    var entry = kv.Value as Dictionary<string, object>;
                    if (entry == null)
                    {
                        if (Truthy(kv.Value)) result.Add(new Unlock { Name = kv.Key });
                        continue;
                    }
                    if (Truthy(Pick(entry, DoneKeys)))
                    {
                        object title;
                        entry.TryGetValue("displayName", out title);
                        result.Add(new Unlock
                        {
                            Name = kv.Key,
                            At = ToUnix(Pick(entry, TimeKeys)),
                            Title = title as string,
                        });
                    }
                }
                return result;
            }

            // Un tableau arrive en object[] au premier niveau, en ArrayList
            // plus bas : on prend n'importe quelle liste.
            var arr = root as IEnumerable;
            if (arr != null && !(root is string))
            {
                foreach (var item in arr)
                {
                    var entry = item as Dictionary<string, object>;
                    if (entry == null) continue;
                    var name = Pick(entry, new[] { "name", "apiname", "id" });
                    if (name != null && Truthy(Pick(entry, DoneKeys)))
                        result.Add(new Unlock { Name = name.ToString(), At = ToUnix(Pick(entry, TimeKeys)) });
                }
            }
            return result;
        }

        // CODEX / RUNE / OnlineFix : une section par succès.
        //   [ACH_X]
        //   Achieved=1            (OnlineFix : achieved=true)
        //   UnlockTime=1700000000 (OnlineFix : timestamp=…)
        // SKIDROW : deux sections à plat.
        //   [SteamAchievements]      ACH_X=1
        //   [AchievementsUnlockTimes] ACH_X=1700000000
        static readonly Regex Section = new Regex(@"^\s*\[(.+?)\]\s*$");
        static readonly Regex Pair = new Regex(@"^\s*([^=;#]+?)\s*=\s*(.*?)\s*$");

        static List<Unlock> ParseIni(string text)
        {
            var sections = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, object> current = null;
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                var m = Section.Match(line);
                if (m.Success)
                {
                    var name = m.Groups[1].Value.Trim();
                    if (!sections.TryGetValue(name, out current))
                    {
                        current = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                        sections[name] = current;
                    }
                    continue;
                }
                var p = Pair.Match(line);
                if (p.Success && current != null) current[p.Groups[1].Value] = p.Groups[2].Value;
            }

            var result = new List<Unlock>();
            var seen = new HashSet<string>();
            // Une section par succès : c'est la forme la plus répandue.
            foreach (var kv in sections)
            {
                if (IsMetaSection(kv.Key)) continue;
                var done = Pick(kv.Value, DoneKeys);
                if (done == null) continue;
                if (Truthy(done) && seen.Add(kv.Key))
                    result.Add(new Unlock { Name = kv.Key, At = ToUnix(Pick(kv.Value, TimeKeys)) });
            }
            if (result.Count > 0) return result;

            // À plat (SKIDROW) : SteamAchievements liste NOM=1, les dates à part.
            Dictionary<string, object> flat, times;
            sections.TryGetValue("AchievementsUnlockTimes", out times);
            if (sections.TryGetValue("SteamAchievements", out flat))
            {
                foreach (var kv in flat)
                {
                    // CODEX y range un index (Count=, 00000=NOM) : ce n'est pas une liste de débloqués.
                    if (kv.Key.Equals("Count", StringComparison.OrdinalIgnoreCase) || kv.Key.All(char.IsDigit)) continue;
                    if (!Truthy(kv.Value) || !seen.Add(kv.Key)) continue;
                    object at = null;
                    if (times != null) times.TryGetValue(kv.Key, out at);
                    result.Add(new Unlock { Name = kv.Key, At = ToUnix(at) });
                }
            }
            return result;
        }

        static bool IsMetaSection(string name)
        {
            return name.Equals("SteamAchievements", StringComparison.OrdinalIgnoreCase)
                || name.Equals("AchievementsUnlockTimes", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Steam", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Settings", StringComparison.OrdinalIgnoreCase);
        }
    }
}
