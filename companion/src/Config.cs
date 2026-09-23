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
        public long AppId { get; set; }
        public int Seconds { get; set; }
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

        public Config()
        {
            ApiBase = "https://myplaylog.cc/api";
            Notify = true;
            Sent = new Dictionary<string, List<string>>();
            Names = new Dictionary<string, string>();
            Unmatched = new Dictionary<string, long>();
            Pending = new List<PlayChunk>();
        }

        public bool Linked { get { return !string.IsNullOrEmpty(Token); } }

        static readonly object Gate = new object();

        public static string Folder
        {
            get
            {
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

        public void Unlink()
        {
            lock (Gate)
            {
                Token = null;
                Username = null;
                Sent.Clear();
                Pending.Clear();
            }
            Save();
        }
    }
}
