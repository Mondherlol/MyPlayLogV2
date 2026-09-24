using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// Un morceau de session de jeu, en attente d'envoi. `Id` est choisi ici
    /// et rend l'envoi rejouable : le serveur ne le compte qu'une fois.
    /// </summary>
    public class PlayChunk
    {
        public string Id { get; set; }
        public long AppId { get; set; } // 0 : jeu sans appid (reconnu par son dossier)
        public int Seconds { get; set; }
        // Clé locale (appid ou dir:<dossier>), nom et chemin du dossier de jeu.
        public string Key { get; set; }
        public string Name { get; set; }
        public string Folder { get; set; }
    }

    /// <summary>Un succès récent, pour la liste de la fenêtre.</summary>
    public class RecentUnlock
    {
        public string AppId { get; set; }
        public string ApiName { get; set; }
        public string Name { get; set; }
        public string Game { get; set; }
        public string GameId { get; set; }
        public string Icon { get; set; }
        public long At { get; set; } // horodatage Unix
        public bool Pending { get; set; } // en attente de validation sur le site
    }

    /// <summary>
    /// Ce que le compagnon retient entre deux lancements, dans
    /// %AppData%\MyPlayLog\compagnon.json. Le jeton n'ouvre que les routes du
    /// compagnon, et se révoque depuis l'app.
    /// </summary>
    public class Config
    {
        public string ApiBase { get; set; }
        public string Token { get; set; }
        public string Username { get; set; }
        public bool Notify { get; set; }
        // appid → succès déjà envoyés (pour ne renvoyer que ce qui change).
        public Dictionary<string, List<string>> Sent { get; set; }
        // appid → nom du jeu, appris des réponses du serveur.
        public Dictionary<string, string> Names { get; set; }
        // appid → jeu inconnu d'IGDB : on ne réessaie qu'une fois par jour.
        public Dictionary<string, long> Unmatched { get; set; }
        public List<PlayChunk> Pending { get; set; }
        public string Avatar { get; set; }
        // appid → jaquette et identifiant MyPlayLog du jeu (la fenêtre les affiche).
        public Dictionary<string, string> Covers { get; set; }
        public Dictionary<string, string> GameIds { get; set; }
        // Les 20 derniers succès, du plus récent au plus ancien.
        public List<RecentUnlock> Recent { get; set; }
        // Succès hors boutique du compte, d'après le serveur (-1 : pas encore su).
        public int UnlockedTotal { get; set; }
        // « Il reste dans la barre des tâches » : dit une seule fois.
        public bool TrayHintShown { get; set; }
        // Les dossiers de jeux parcourus (D:\Games…). Cherchés une fois tout
        // seuls (LibrariesInit), puis tenus à la main depuis la fenêtre.
        public List<string> Libraries { get; set; }
        public bool LibrariesInit { get; set; }
        // clé locale → état sur le site : pending | approved | ignored.
        public Dictionary<string, string> States { get; set; }
        // Jeux qui attendent une validation sur le site.
        public int PendingReview { get; set; }

        public Config()
        {
            ApiBase = "https://myplaylog.cc/api";
            Notify = true;
            Sent = new Dictionary<string, List<string>>();
            Names = new Dictionary<string, string>();
            Unmatched = new Dictionary<string, long>();
            Pending = new List<PlayChunk>();
            Covers = new Dictionary<string, string>();
            GameIds = new Dictionary<string, string>();
            Recent = new List<RecentUnlock>();
            UnlockedTotal = -1;
            Libraries = new List<string>();
            States = new Dictionary<string, string>();
        }

        public bool Linked { get { return !string.IsNullOrEmpty(Token); } }

        static readonly object Gate = new object();

        // `--data <dossier>` (tests) : une config à part, sans toucher à la vraie.
        public static string Override;

        public static string Folder
        {
            get
            {
                if (!string.IsNullOrEmpty(Override)) return Override;
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "MyPlayLog");
            }
        }

        static string FilePath { get { return Path.Combine(Folder, "compagnon.json"); } }

        public static Config Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    var c = new JavaScriptSerializer().Deserialize<Config>(File.ReadAllText(FilePath));
                    if (c != null)
                    {
                        if (c.Sent == null) c.Sent = new Dictionary<string, List<string>>();
                        if (c.Names == null) c.Names = new Dictionary<string, string>();
                        if (c.Unmatched == null) c.Unmatched = new Dictionary<string, long>();
                        if (c.Pending == null) c.Pending = new List<PlayChunk>();
                        if (c.Covers == null) c.Covers = new Dictionary<string, string>();
                        if (c.GameIds == null) c.GameIds = new Dictionary<string, string>();
                        if (c.Recent == null) c.Recent = new List<RecentUnlock>();
                        if (c.Libraries == null) c.Libraries = new List<string>();
                        if (c.States == null) c.States = new Dictionary<string, string>();
                        if (string.IsNullOrEmpty(c.ApiBase)) c.ApiBase = "https://myplaylog.cc/api";
                        return c;
                    }
                }
            }
            catch
            {
                // Fichier abîmé : on repart de zéro plutôt que de ne pas démarrer.
            }
            return new Config();
        }

        /// <summary>Écriture atomique : un fichier à moitié écrit ne survit pas à une coupure.</summary>
        public void Save()
        {
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(Folder);
                    var tmp = FilePath + ".tmp";
                    File.WriteAllText(tmp, new JavaScriptSerializer().Serialize(this));
                    if (File.Exists(FilePath)) File.Replace(tmp, FilePath, null);
                    else File.Move(tmp, FilePath);
                }
                catch
                {
                    // Disque plein, droits : on réessaiera au prochain enregistrement.
                }
            }
        }

        public HashSet<string> SentFor(string appId)
        {
            lock (Gate)
            {
                List<string> list;
                return Sent.TryGetValue(appId, out list) ? new HashSet<string>(list) : new HashSet<string>();
            }
        }

        public void MarkSent(string appId, IEnumerable<string> names)
        {
            lock (Gate)
            {
                var set = SentFor(appId);
                foreach (var n in names) set.Add(n);
                Sent[appId] = new List<string>(set);
            }
        }

        public string NameOf(string appId)
        {
            lock (Gate)
            {
                string n;
                return Names.TryGetValue(appId, out n) ? n : null;
            }
        }

        /// <summary>Jeu inconnu de MyPlayLog, vu il y a moins d'un jour ?</summary>
        public bool IsUnmatched(string appId)
        {
            lock (Gate)
            {
                long seen;
                return Unmatched.TryGetValue(appId, out seen)
                    && DateTime.UtcNow.Ticks - seen < TimeSpan.FromDays(1).Ticks;
            }
        }

        public void MarkUnmatched(string appId)
        {
            lock (Gate) Unmatched[appId] = DateTime.UtcNow.Ticks;
        }

        public string StateOf(string key)
        {
            lock (Gate)
            {
                string s;
                return States.TryGetValue(key, out s) ? s : null;
            }
        }

        public void SetState(string key, string state)
        {
            lock (Gate) States[key] = state;
        }

        public string CoverOf(string appId)
        {
            lock (Gate)
            {
                string c;
                return Covers.TryGetValue(appId, out c) ? c : null;
            }
        }

        public string GameIdOf(string appId)
        {
            lock (Gate)
            {
                string id;
                return GameIds.TryGetValue(appId, out id) ? id : null;
            }
        }

        /// <summary>Ce que le serveur nous apprend d'un jeu : nom, jaquette, fiche.</summary>
        public void Learn(string appId, string name, string cover, string gameId)
        {
            lock (Gate)
            {
                if (!string.IsNullOrEmpty(name)) Names[appId] = name;
                if (!string.IsNullOrEmpty(cover)) Covers[appId] = cover;
                if (!string.IsNullOrEmpty(gameId)) GameIds[appId] = gameId;
            }
        }

        public void AddRecent(IEnumerable<RecentUnlock> items)
        {
            lock (Gate)
            {
                foreach (var r in items)
                {
                    Recent.RemoveAll(x => x.AppId == r.AppId && x.ApiName == r.ApiName);
                    Recent.Add(r);
                    // Des succès NOUVEAUX pour le serveur : le total grimpe d'autant.
                    if (UnlockedTotal >= 0) UnlockedTotal++;
                }
                Recent.Sort((a, b) => b.At.CompareTo(a.At));
                if (Recent.Count > 20) Recent.RemoveRange(20, Recent.Count - 20);
            }
        }

        /// <summary>La liste du serveur fait foi (elle couvre tous les PC du compte).</summary>
        public void ReplaceRecent(List<RecentUnlock> items, int total)
        {
            lock (Gate)
            {
                Recent = items;
                UnlockedTotal = total;
            }
        }

        public RecentUnlock[] RecentSnapshot()
        {
            lock (Gate) return Recent.ToArray();
        }

        /// <summary>Le total du serveur si on l'a, sinon ce que ce PC a envoyé.</summary>
        public int SentTotal()
        {
            lock (Gate)
            {
                if (UnlockedTotal >= 0) return UnlockedTotal;
                int n = 0;
                foreach (var list in Sent.Values) n += list.Count;
                return n;
            }
        }

        public void Unlink()
        {
            lock (Gate)
            {
                Token = null;
                Username = null;
                Avatar = null;
                Sent.Clear();
                Pending.Clear();
                Recent.Clear();
                States.Clear();
                PendingReview = 0;
                UnlockedTotal = -1;
            }
            Save();
        }
    }
}
