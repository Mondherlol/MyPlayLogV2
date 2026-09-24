using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// Les images venues du web (icônes de succès Steam, jaquettes IGDB,
    /// avatar) : en mémoire, et sur disque dans %AppData%\MyPlayLog\cache pour
    /// que la fenêtre s'affiche complète même hors ligne.
    ///
    /// Get() rend l'image si on l'a, sinon null et la télécharge : Loaded
    /// prévient (sur le fil de l'interface) quand elle arrive.
    /// </summary>
    public static class Images
    {
        public static event Action Loaded;

        static readonly HttpClient Http = CreateClient();
        static readonly Dictionary<string, Image> Memory = new Dictionary<string, Image>();
        static readonly HashSet<string> Pending = new HashSet<string>();
        static readonly HashSet<string> Failed = new HashSet<string>();
        static SynchronizationContext ui;

        static HttpClient CreateClient()
        {
            var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(20);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("MyPlayLogCompagnon/" + Program.Version);
            return http;
        }

        public static void Init(SynchronizationContext context)
        {
            ui = context;
        }

        static string Folder
        {
            get { return Path.Combine(Config.Folder, "cache"); }
        }

        static string FileOf(string url)
        {
            using (var sha = SHA1.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(url));
                return Path.Combine(Folder, BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant());
            }
        }

        public static Image Get(string url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            if (url.StartsWith("//")) url = "https:" + url;
            if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return null;
            lock (Memory)
            {
                Image img;
                if (Memory.TryGetValue(url, out img)) return img;
                if (Failed.Contains(url) || Pending.Contains(url)) return null;
                Pending.Add(url);
            }
            Task.Run(() => Fetch(url));
            return null;
        }

        static async Task Fetch(string url)
        {
            Image img = null;
            try
            {
                var file = FileOf(url);
                byte[] bytes = null;
                if (File.Exists(file)) bytes = File.ReadAllBytes(file);
                if (bytes == null)
                {
                    bytes = await Http.GetByteArrayAsync(url).ConfigureAwait(false);
                    try
                    {
                        Directory.CreateDirectory(Folder);
                        File.WriteAllBytes(file, bytes);
                    }
                    catch
                    {
                        // Pas de cache disque : tant pis, on garde l'image en mémoire.
                    }
                }
                img = Shrink(bytes);
            }
            catch
            {
                img = null;
            }
            lock (Memory)
            {
                Pending.Remove(url);
                if (img != null) Memory[url] = img;
                else Failed.Add(url);
            }
            if (img != null && ui != null)
            {
                ui.Post(_ =>
                {
                    if (Loaded != null) Loaded();
                }, null);
            }
        }

        /// <summary>Une copie de 192 px au plus : on n'affiche jamais plus grand.</summary>
        static Image Shrink(byte[] bytes)
        {
            using (var src = Image.FromStream(new MemoryStream(bytes)))
            {
                const int max = 192;
                float ratio = Math.Min(1f, (float)max / Math.Max(src.Width, src.Height));
                int w = Math.Max(1, (int)Math.Round(src.Width * ratio));
                int h = Math.Max(1, (int)Math.Round(src.Height * ratio));
                var bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.DrawImage(src, 0, 0, w, h);
                }
                return bmp;
            }
        }

        /// <summary>Garde le cache disque sous ~400 fichiers (les plus récents).</summary>
        public static void Prune()
        {
            try
            {
                var dir = new DirectoryInfo(Folder);
                if (!dir.Exists) return;
                var files = dir.GetFiles();
                if (files.Length <= 400) return;
                Array.Sort(files, (a, b) => b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc));
                for (int i = 400; i < files.Length; i++) files[i].Delete();
            }
            catch
            {
            }
        }
    }
}
