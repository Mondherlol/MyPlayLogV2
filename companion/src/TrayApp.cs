using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// L'application elle-même : l'icône de la barre des tâches, son menu, et
    /// ce qui tourne derrière — la surveillance des dossiers des émulateurs,
    /// le suivi du temps de jeu, et l'envoi au serveur.
    /// </summary>
    public class TrayApp : ApplicationContext
    {
        public static readonly Icon AppIcon = LoadIcon();
        const string Site = "https://myplaylog.cc";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = "MyPlayLogCompagnon";

        readonly Config cfg;
        readonly Api api;
        readonly NotifyIcon tray;
        readonly ContextMenuStrip menu;
        readonly SynchronizationContext ui;
        readonly PlayTracker tracker;
        readonly Dictionary<string, FileSystemWatcher> watchers = new Dictionary<string, FileSystemWatcher>();
        readonly Dictionary<string, System.Threading.Timer> debounce = new Dictionary<string, System.Threading.Timer>();
        readonly SemaphoreSlim syncGate = new SemaphoreSlim(1, 1);
        readonly System.Windows.Forms.Timer housekeeping;

        bool sendingPending;
        bool closed;
        bool needsFullSync;
        PairForm pairForm;

        public TrayApp(Config config)
        {
            cfg = config;
            api = new Api(cfg);

            menu = new ContextMenuStrip();
            menu.Opening += (s, e) => BuildMenu();
            tray = new NotifyIcon
            {
                Icon = AppIcon,
                Text = "MyPlayLog Compagnon",
                Visible = true,
                ContextMenuStrip = menu,
            };
            tray.DoubleClick += (s, e) =>
            {
                if (cfg.Linked) Open(Site);
                else ShowPair();
            };
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            BuildMenu();

            tracker = new PlayTracker();
            tracker.Chunk += OnChunk;
            tracker.Started += appId => ui.Post(_ => UpdateTooltip(), null);

            // Au lancement, la synchro de démarrage lit déjà tous les dossiers :
            // les surveillances se posent sans relire.
            StartWatchers(false);

            // Toutes les deux minutes : renvoyer ce qui attend, surveiller les
            // dossiers d'émulateurs apparus depuis, et reprendre une synchro
            // ratée (réseau absent au démarrage de Windows).
            housekeeping = new System.Windows.Forms.Timer { Interval = 120000 };
            housekeeping.Tick += (s, e) =>
            {
                StartWatchers(true);
                UpdateTooltip();
                Fire(SendPending());
                if (needsFullSync) Fire(FullSync(true, false));
            };
            housekeeping.Start();

            Application.ApplicationExit += (s, e) => Shutdown();

            if (!cfg.Linked)
            {
                ui.Post(_ =>
                {
                    Balloon("Relie ton compte MyPlayLog", "Tape le code affiché dans l'app pour commencer.");
                    ShowPair();
                }, null);
            }
            else
            {
                Fire(Startup());
            }
        }

        // ------------------------------------------------------------------
        //  Démarrage : le jeton vaut-il encore ? puis une synchro silencieuse
        // ------------------------------------------------------------------
        async Task Startup()
        {
            try
            {
                var me = await api.Get("/companion/me");
                var name = Api.Str(me, "username");
                if (!string.IsNullOrEmpty(name) && name != cfg.Username)
                {
                    cfg.Username = name;
                    cfg.Save();
                }
            }
            catch (ApiException ex)
            {
                if (ex.Unlinked)
                {
                    HandleUnlinked();
                    return;
                }
            }
            catch
            {
                // Hors ligne : la synchro réessaiera.
            }
            await FullSync(true, false);
            await SendPending();
        }

        // ------------------------------------------------------------------
        //  Les succès
        // ------------------------------------------------------------------
        void StartWatchers(bool syncNew)
        {
            foreach (var source in Emulators.Sources())
            {
                if (!source.Exists || watchers.ContainsKey(source.Root)) continue;
                try
                {
                    var src = source;
                    var w = new FileSystemWatcher(source.Root)
                    {
                        IncludeSubdirectories = true,
                        NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                        InternalBufferSize = 64 * 1024,
                    };
                    FileSystemEventHandler onChange = (s, e) => OnFileEvent(src, e.FullPath);
                    w.Changed += onChange;
                    w.Created += onChange;
                    w.Renamed += (s, e) => OnFileEvent(src, e.FullPath);
                    w.EnableRaisingEvents = true;
                    watchers[source.Root] = w;
                    // Un dossier apparu en cours de route : on le lit tout de suite.
                    if (syncNew && cfg.Linked) Fire(SyncSource(src, false));
                }
                catch
                {
                    // Dossier inaccessible : on retentera au prochain passage.
                }
            }
        }

        void OnFileEvent(Source source, string path)
        {
            if (!Emulators.IsAchievementFile(source, path)) return;
            var appId = Emulators.AppIdFromPath(source.Root, path);
            if (appId == null) return;
            // Un jeu réécrit son fichier plusieurs fois d'affilée : on attend
            // qu'il ait fini (1,5 s de calme) avant de le lire.
            lock (debounce)
            {
                System.Threading.Timer t;
                if (debounce.TryGetValue(path, out t)) t.Dispose();
                debounce[path] = new System.Threading.Timer(_ =>
                {
                    lock (debounce) debounce.Remove(path);
                    Fire(SyncFile(appId, path, false));
                }, null, 1500, Timeout.Infinite);
            }
        }

        async Task FullSync(bool quiet, bool summary)
        {
            if (!cfg.Linked) return;
            needsFullSync = false;
            int games = 0;
            int unlocked = 0;
            foreach (var source in Emulators.Sources())
            {
                var r = await SyncSource(source, quiet || summary);
                games += r.Item1;
                unlocked += r.Item2;
            }
            if (summary)
            {
                Balloon(
                    games > 0 ? "Synchronisation terminée" : "Rien à synchroniser pour l'instant",
                    games > 0
                        ? games + " jeu" + (games > 1 ? "x" : "") + " · " + unlocked + " succès envoyé" + (unlocked > 1 ? "s" : "")
                        : "Les succès apparaîtront dès qu'un jeu hors boutique en débloquera.");
            }
        }

        async Task<Tuple<int, int>> SyncSource(Source source, bool quiet)
        {
            int games = 0;
            int unlocked = 0;
            foreach (var hit in Emulators.Scan(source).ToList())
            {
                var n = await SyncFile(hit.Key, hit.Value, quiet);
                if (n >= 0)
                {
                    games++;
                    unlocked += n;
                }
            }
            return Tuple.Create(games, unlocked);
        }

        /// <summary>
        /// Envoie les succès d'un fichier s'il contient du nouveau. Rend le
        /// nombre de succès débloqués du jeu, ou -1 si rien n'est parti.
        /// </summary>
        async Task<int> SyncFile(string appId, string file, bool quiet)
        {
            if (!cfg.Linked) return -1;
            long seenUnmatched;
            if (cfg.Unmatched.TryGetValue(appId, out seenUnmatched)
                && DateTime.UtcNow.Ticks - seenUnmatched < TimeSpan.FromDays(1).Ticks)
                return -1;

            var unlocks = Emulators.Parse(file);
            if (unlocks.Count == 0) return -1;
            var sent = cfg.SentFor(appId);
            if (unlocks.All(u => sent.Contains(u.Name))) return -1;

            await syncGate.WaitAsync();
            try
            {
                // Relu APRÈS l'attente : un envoi concurrent du même fichier a
                // pu passer entre-temps.
                sent = cfg.SentFor(appId);
                if (unlocks.All(u => sent.Contains(u.Name))) return -1;

                var body = new Dictionary<string, object>
                {
                    { "appid", long.Parse(appId) },
                    {
                        "unlocked",
                        unlocks.Select(u => new Dictionary<string, object> { { "name", u.Name }, { "at", u.At } }).ToList()
                    },
                };
                var res = await api.Post("/companion/achievements", body);
                if (!Api.Bool(res, "matched"))
                {
                    cfg.Unmatched[appId] = DateTime.UtcNow.Ticks;
                    cfg.Save();
                    return -1;
                }
                var name = Api.Str(res, "name") ?? ("appid " + appId);
                cfg.Names[appId] = name;
                cfg.MarkSent(appId, unlocks.Select(u => u.Name));
                cfg.Save();

                var fresh = Api.List(res, "newly").ToList();
                if (!quiet && cfg.Notify && fresh.Count > 0)
                {
                    if (fresh.Count == 1) Balloon("🏆 Succès débloqué", Api.Str(fresh[0], "name") + " — " + name);
                    else Balloon("🏆 " + fresh.Count + " succès débloqués", name);
                }
                return unlocks.Count;
            }
            catch (ApiException ex)
            {
                if (ex.Unlinked) HandleUnlinked();
                return -1;
            }
            catch
            {
                needsFullSync = true; // hors ligne : on reprendra
                return -1;
            }
            finally
            {
                syncGate.Release();
            }
        }

        // ------------------------------------------------------------------
        //  Le temps de jeu
        // ------------------------------------------------------------------
        void OnChunk(PlayChunk chunk)
        {
            lock (cfg.Pending) cfg.Pending.Add(chunk);
            cfg.Save();
            Fire(SendPending());
            ui.Post(_ => UpdateTooltip(), null);
        }

        async Task SendPending()
        {
            if (!cfg.Linked || sendingPending) return;
            sendingPending = true;
            try
            {
                while (true)
                {
                    PlayChunk c;
                    lock (cfg.Pending) c = cfg.Pending.FirstOrDefault();
                    if (c == null) break;
                    try
                    {
                        var res = await api.Post("/companion/playtime", new Dictionary<string, object>
                        {
                            { "appid", c.AppId },
                            { "seconds", c.Seconds },
                            { "id", c.Id },
                        });
                        var name = Api.Str(res, "name");
                        if (name != null) cfg.Names[c.AppId.ToString()] = name;
                    }
                    catch (ApiException ex)
                    {
                        if (ex.Unlinked)
                        {
                            HandleUnlinked();
                            return;
                        }
                        // Erreur serveur : on garde le morceau pour plus tard.
                        if (ex.Status >= 500) break;
                        // Refus (4xx) : ce morceau ne passera jamais, on le lâche.
                    }
                    catch
                    {
                        break; // hors ligne : on garde tout, on réessaiera
                    }
                    lock (cfg.Pending) cfg.Pending.Remove(c);
                    cfg.Save();
                }
            }
            finally
            {
                sendingPending = false;
            }
        }

        // ------------------------------------------------------------------
        //  Relier, délier
        // ------------------------------------------------------------------
        void ShowPair()
        {
            if (pairForm != null && !pairForm.IsDisposed)
            {
                pairForm.Activate();
                return;
            }
            pairForm = new PairForm(Pair);
            pairForm.FormClosed += (s, e) => pairForm = null;
            pairForm.Show();
            pairForm.Activate();
        }

        async Task<string> Pair(string code)
        {
            try
            {
                var res = await api.Post("/companion/pair", new Dictionary<string, object>
                {
                    { "code", code },
                    { "name", Environment.MachineName },
                });
                cfg.Token = Api.Str(res, "token");
                cfg.Username = Api.Str(res, "username");
                cfg.Unmatched.Clear();
                cfg.Save();
                // Relier, c'est vouloir que ça tourne : on lance avec Windows.
                SetStartup(true);
                BuildMenu();
                Balloon(
                    "Relié à @" + cfg.Username,
                    "Tes succès et tes heures hors boutique remontent maintenant sur MyPlayLog.");
                Fire(FullSync(false, true));
                return null;
            }
            catch (ApiException ex)
            {
                return ex.Message;
            }
        }

        async Task Unlink()
        {
            var answer = MessageBox.Show(
                "Délier ce PC de @" + cfg.Username + " ?\nLes succès déjà envoyés restent sur ton profil.",
                "MyPlayLog Compagnon",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (answer != DialogResult.Yes) return;
            tracker.FlushAll();
            await SendPending();
            try
            {
                await api.Post("/companion/unlink", new Dictionary<string, object>());
            }
            catch
            {
                // Hors ligne : le jeton reste valable côté serveur, mais ce PC
                // l'oublie. On peut le révoquer depuis l'app.
            }
            cfg.Unlink();
            BuildMenu();
        }

        void HandleUnlinked()
        {
            if (!cfg.Linked) return;
            cfg.Unlink();
            ui.Post(_ =>
            {
                BuildMenu();
                Balloon("Ce PC n'est plus relié", "Relie-le à nouveau depuis le menu pour reprendre.");
            }, null);
        }

        // ------------------------------------------------------------------
        //  Le menu
        // ------------------------------------------------------------------
        void BuildMenu()
        {
            menu.Items.Clear();
            var head = new ToolStripMenuItem("MyPlayLog Compagnon") { Enabled = false };
            head.Font = new Font(head.Font, FontStyle.Bold);
            menu.Items.Add(head);
            menu.Items.Add(new ToolStripMenuItem(cfg.Linked ? "Relié à @" + cfg.Username : "Non relié") { Enabled = false });

            var playing = tracker == null ? new string[0] : tracker.Running;
            if (playing.Length > 0)
            {
                menu.Items.Add(new ToolStripMenuItem("En jeu : " + (cfg.NameOf(playing[0]) ?? "appid " + playing[0])) { Enabled = false });
            }

            var found = Emulators.Sources().Where(s => s.Exists).Select(s => s.Label).Distinct().ToList();
            menu.Items.Add(new ToolStripMenuItem(
                found.Count > 0 ? "Émulateurs trouvés : " + string.Join(", ", found) : "Aucun émulateur de succès trouvé")
            { Enabled = false });

            menu.Items.Add(new ToolStripSeparator());
            if (cfg.Linked)
            {
                menu.Items.Add("Synchroniser maintenant", null, (s, e) => Fire(FullSync(false, true)));
                menu.Items.Add("Délier ce PC…", null, (s, e) => Fire(Unlink()));
            }
            else
            {
                menu.Items.Add("Relier mon compte…", null, (s, e) => ShowPair());
            }

            var notify = new ToolStripMenuItem("Notifications") { Checked = cfg.Notify, CheckOnClick = true };
            notify.CheckedChanged += (s, e) =>
            {
                cfg.Notify = notify.Checked;
                cfg.Save();
            };
            menu.Items.Add(notify);
            var startup = new ToolStripMenuItem("Lancer avec Windows") { Checked = IsStartup(), CheckOnClick = true };
            startup.CheckedChanged += (s, e) => SetStartup(startup.Checked);
            menu.Items.Add(startup);

            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Ouvrir MyPlayLog", null, (s, e) => Open(Site));
            menu.Items.Add("Quitter", null, (s, e) => ExitThread());
            UpdateTooltip();
        }

        void UpdateTooltip()
        {
            var playing = tracker == null ? new string[0] : tracker.Running;
            var text = playing.Length > 0
                ? "MyPlayLog · En jeu : " + (cfg.NameOf(playing[0]) ?? "appid " + playing[0])
                : cfg.Linked ? "MyPlayLog Compagnon · @" + cfg.Username : "MyPlayLog Compagnon · non relié";
            // Une info-bulle d'icône ne dépasse pas 63 caractères.
            tray.Text = text.Length > 63 ? text.Substring(0, 62) + "…" : text;
        }

        void Balloon(string title, string text)
        {
            ui.Post(_ =>
            {
                try
                {
                    tray.ShowBalloonTip(5000, title, text, ToolTipIcon.None);
                }
                catch
                {
                }
            }, null);
        }

        // ------------------------------------------------------------------
        //  Démarrage avec Windows
        // ------------------------------------------------------------------
        static bool IsStartup()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
            {
                return key != null && key.GetValue(RunName) != null;
            }
        }

        static void SetStartup(bool on)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key == null) return;
                    if (on) key.SetValue(RunName, "\"" + Application.ExecutablePath + "\"");
                    else key.DeleteValue(RunName, false);
                }
            }
            catch
            {
            }
        }

        // ------------------------------------------------------------------
        static void Open(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
            }
        }

        /// <summary>Lance une tâche sans l'attendre, sans laisser filer d'exception.</summary>
        static void Fire(Task task)
        {
            task.ContinueWith(t =>
            {
                var ignored = t.Exception;
            }, TaskContinuationOptions.OnlyOnFaulted);
        }

        static Icon LoadIcon()
        {
            try
            {
                return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        void Shutdown()
        {
            if (closed) return;
            closed = true;
            try
            {
                housekeeping.Stop();
                tracker.FlushAll();
                // Un dernier essai d'envoi, bref : Windows n'attend pas.
                SendPending().Wait(3000);
            }
            catch
            {
            }
            tracker.Dispose();
            foreach (var w in watchers.Values) w.Dispose();
            cfg.Save();
            tray.Visible = false;
            tray.Dispose();
        }

        protected override void ExitThreadCore()
        {
            Shutdown();
            base.ExitThreadCore();
        }
    }
}
