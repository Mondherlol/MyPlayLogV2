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
    /// L'application elle-même : l'icône de la barre des tâches, sa fenêtre,
    /// ses notifications, et ce qui tourne derrière — la surveillance des
    /// dossiers des émulateurs, le suivi du temps de jeu, l'envoi au serveur.
    ///
    /// La fenêtre (MainWindow) lit l'état ici et appelle les actions
    /// publiques ; Changed la prévient (sur le fil de l'interface) quand
    /// quelque chose bouge.
    /// </summary>
    public class TrayApp : ApplicationContext
    {
        public static readonly Icon AppIcon = LoadIcon();
        public const string Site = "https://myplaylog.cc";
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
        bool startup;
        string[] emulators = new string[0];
        LocalGame[] detected = new LocalGame[0];
        string lastReport;
        DateTime lastReportAt;
        int ticks;
        MainWindow window;
        EventWaitHandle showSignal;
        RegisteredWaitHandle showWait;

        public event Action Changed;

        public TrayApp(Config config, bool background)
        {
            cfg = config;
            api = new Api(cfg);

            menu = new ContextMenuStrip();
            DarkMenu.Apply(menu);
            menu.Opening += (s, e) => BuildMenu();
            tray = new NotifyIcon
            {
                Icon = AppIcon,
                Text = "MyPlayLog Compagnon",
                Visible = true,
                ContextMenuStrip = menu,
            };
            tray.MouseUp += (s, e) =>
            {
                if (e.Button == MouseButtons.Left) ShowWindow();
            };
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            Images.Init(ui);
            Online = true;

            startup = IsStartup();
            // La clé « lancer avec Windows » suit l'exécutable (déplacé, mis à jour).
            if (startup) SetStartup(true);
            emulators = DetectEmulators();

            // Les dossiers de jeux : cherchés une fois tout seuls (D:Games…),
            // ensuite c'est le joueur qui les tient, depuis la fenêtre.
            if (!cfg.LibrariesInit)
            {
                cfg.Libraries = Library.AutoDetect();
                cfg.LibrariesInit = true;
                cfg.Save();
            }
            Fire(Task.Run(() => Rescan()));

            tracker = new PlayTracker();
            // Un jeu écarté sur le site (« pas un jeu ») ne compte plus.
            tracker.Skip = key => cfg.StateOf(key) == "ignored";
            tracker.Chunk += OnChunk;
            tracker.Started += appId => ui.Post(_ => OnStarted(appId), null);
            tracker.Stopped += () => ui.Post(_ =>
            {
                UpdateTooltip();
                RaiseChanged();
            }, null);

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
                var found = DetectEmulators();
                if (!found.SequenceEqual(emulators))
                {
                    emulators = found;
                    RaiseChanged();
                }
                UpdateTooltip();
                Fire(SendPending());
                if (needsFullSync) Fire(FullSync());
                // Toutes les 6 min : ce qui a été validé ou écarté sur le site.
                // Toutes les 30 min : les dossiers de jeux, relus.
                ticks++;
                if (ticks % 15 == 0) Fire(ReportGames(false));
                else if (ticks % 3 == 0) Fire(RefreshStates());
            };
            housekeeping.Start();

            Application.ApplicationExit += (s, e) => Shutdown();
            ListenForShow();
            UpdateTooltip();
            Images.Prune();

            // Pas relié : la fenêtre s'ouvre sur le code. Relié : elle ne s'ouvre
            // que si on a lancé l'exe soi-même (pas au démarrage de Windows).
            if (!cfg.Linked || !background) ui.Post(_ => ShowWindow(), null);
            if (cfg.Linked) Fire(Startup());
        }

        // ------------------------------------------------------------------
        //  Ce que lit la fenêtre
        // ------------------------------------------------------------------
        public Config Cfg { get { return cfg; } }
        public bool Linked { get { return cfg.Linked; } }
        public bool Exiting { get { return closed; } }
        public bool Online { get; private set; }
        public bool Syncing { get; private set; }
        public string SyncNote { get; private set; }
        public DateTime SyncNoteUntil { get; private set; }
        public string[] EmulatorLabels { get { return emulators; } }
        public LocalGame[] Detected { get { return detected; } }
        public int PendingReview { get { return cfg.PendingReview; } }
        public KeyValuePair<string, DateTime>[] Sessions { get { return tracker.Sessions; } }

        public bool StartWithWindows
        {
            get { return startup; }
            set
            {
                SetStartup(value);
                startup = IsStartup();
                RaiseChanged();
            }
        }

        void RaiseChanged()
        {
            ui.Post(_ =>
            {
                if (Changed != null) Changed();
            }, null);
        }

        void MarkOnline(bool on)
        {
            if (Online == on) return;
            Online = on;
            RaiseChanged();
        }

        // ------------------------------------------------------------------
        //  La fenêtre
        // ------------------------------------------------------------------
        public void ShowWindow()
        {
            if (closed) return;
            if (window == null || window.IsDisposed) window = new MainWindow(this);
            if (!window.Visible) window.Show();
            if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
            window.Activate();
            // Ce qui a pu être validé sur le site depuis.
            if (cfg.Linked) Fire(RefreshStates());
        }

        /// <summary>La première fois qu'on ferme la fenêtre : « je suis toujours là ».</summary>
        public void WindowHidden()
        {
            if (!cfg.Linked || cfg.TrayHintShown) return;
            cfg.TrayHintShown = true;
            cfg.Save();
            ShowToast(new ToastInfo
            {
                Kicker = "TOUJOURS LÀ",
                Title = "Le compagnon continue",
                Text = "Il suit tes jeux depuis la barre des tâches.",
                Image = Theme.Logo,
                HoldMs = 4500,
                Click = ShowWindow,
            });
        }

        /// <summary>Un second lancement de l'exe ouvre la fenêtre du premier.</summary>
        void ListenForShow()
        {
            try
            {
                showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
                showWait = ThreadPool.RegisterWaitForSingleObject(showSignal,
                    (s, timedOut) => ui.Post(_ => ShowWindow(), null), null, -1, false);
            }
            catch
            {
            }
        }

        void ShowToast(ToastInfo info)
        {
            ui.Post(_ =>
            {
                if (closed) return;
                try
                {
                    Toast.Push(info);
                }
                catch
                {
                    // Une notification ratée ne doit rien casser.
                }
            }, null);
        }

        // ------------------------------------------------------------------
        //  Démarrage : le jeton vaut-il encore ? puis une synchro silencieuse
        // ------------------------------------------------------------------
        async Task Startup()
        {
            try
            {
                var me = await api.Get("/companion/me");
                MarkOnline(true);
                var name = Api.Str(me, "username");
                if (!string.IsNullOrEmpty(name)) cfg.Username = name;
                cfg.Avatar = Api.Str(me, "avatar");
                cfg.Save();
                RaiseChanged();
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
                MarkOnline(false); // hors ligne : la synchro réessaiera
            }
            await ReportGames(true);
            await FullSync();
            await SendPending();
            await RefreshRecent();
        }

        /// <summary>Les derniers succès selon le serveur (tous les PC du compte).</summary>
        async Task RefreshRecent()
        {
            if (!cfg.Linked) return;
            try
            {
                var res = await api.Get("/companion/recent");
                var items = Api.List(res, "items").Select(d =>
                {
                    long at;
                    long.TryParse(Api.Str(d, "at"), out at);
                    return new RecentUnlock
                    {
                        AppId = Api.Str(d, "appid"),
                        ApiName = Api.Str(d, "apiName"),
                        Name = Api.Str(d, "name"),
                        Game = Api.Str(d, "game"),
                        GameId = Api.Str(d, "gameId"),
                        Icon = Api.Str(d, "icon"),
                        At = at,
                        Pending = Api.Bool(d, "pending"),
                    };
                }).ToList();
                int total;
                int.TryParse(Api.Str(res, "total"), out total);
                cfg.ReplaceRecent(items, total);
                int pending;
                if (int.TryParse(Api.Str(res, "pending"), out pending)) cfg.PendingReview = pending;
                cfg.Save();
                RaiseChanged();
            }
            catch
            {
                // Serveur plus ancien ou hors ligne : la liste locale reste.
            }
        }

        // ------------------------------------------------------------------
        //  Les jeux du PC (dossiers de jeux, sauvegardes des émulateurs)
        // ------------------------------------------------------------------
        List<LocalGame> Rescan()
        {
            var found = Library.Scan(cfg.Libraries.ToList());
            detected = found.ToArray();
            RaiseChanged();
            return found;
        }

        static Dictionary<string, object> Payload(LocalGame g)
        {
            var d = new Dictionary<string, object>();
            if (g.AppId != null) d["appid"] = long.Parse(g.AppId);
            if (g.Name != null) d["name"] = g.Name;
            if (g.Folder != null) d["folder"] = g.Folder;
            if (g.Emulator != null) d["emulator"] = g.Emulator;
            return d;
        }

        /// <summary>
        /// Signale au serveur les jeux trouvés : un jeu jamais vu y arrive « à
        /// valider ». Rien n'est renvoyé si la liste n'a pas bougé (sauf toutes
        /// les 6 h, ou à la demande).
        /// </summary>
        async Task ReportGames(bool force)
        {
            if (!cfg.Linked) return;
            var found = await Task.Run(() => Rescan());
            var sig = string.Join("|", found.Select(g => g.Key + ">" + g.Folder + ">" + g.Emulator).OrderBy(x => x));
            if (!force && sig == lastReport && DateTime.UtcNow - lastReportAt < TimeSpan.FromHours(6))
            {
                await RefreshStates();
                return;
            }
            try
            {
                var res = await api.Post("/companion/games", new Dictionary<string, object>
                {
                    { "games", found.Take(300).Select(Payload).ToList() },
                });
                MarkOnline(true);
                lastReport = sig;
                lastReportAt = DateTime.UtcNow;
                ApplyStates(res);
            }
            catch (ApiException ex)
            {
                if (ex.Unlinked) HandleUnlinked();
            }
            catch
            {
                MarkOnline(false);
            }
        }

        /// <summary>Ce qui a été validé, écarté ou reconnu sur le site.</summary>
        async Task RefreshStates()
        {
            if (!cfg.Linked) return;
            try
            {
                ApplyStates(await api.Get("/companion/games"));
                MarkOnline(true);
            }
            catch (ApiException ex)
            {
                if (ex.Unlinked) HandleUnlinked();
            }
            catch
            {
                MarkOnline(false);
            }
        }

        void ApplyStates(Dictionary<string, object> res)
        {
            foreach (var g in Api.List(res, "games"))
            {
                var appid = Api.Str(g, "appid");
                var folder = Api.Str(g, "folder");
                // Même clé que la bibliothèque locale : l'appid, sinon le dossier.
                var key = !string.IsNullOrEmpty(appid) ? appid : folder != null ? "dir:" + folder.ToLowerInvariant() : null;
                if (key == null) continue;
                cfg.SetState(key, Api.Str(g, "state"));
                cfg.Learn(key, Api.Str(g, "name"), Api.Str(g, "cover"), Api.Str(g, "gameId"));
            }
            int pending;
            if (int.TryParse(Api.Str(res, "pending"), out pending)) cfg.PendingReview = pending;
            cfg.Save();
            ui.Post(_ => UpdateTooltip(), null);
            RaiseChanged();
        }

        public void AddLibrary(string path)
        {
            if (string.IsNullOrEmpty(path) || cfg.Libraries.Contains(path, StringComparer.OrdinalIgnoreCase)) return;
            cfg.Libraries.Add(path);
            cfg.Save();
            Fire(ReportGames(true));
        }

        public void RemoveLibrary(string path)
        {
            cfg.Libraries.RemoveAll(p => string.Equals(p, path, StringComparison.OrdinalIgnoreCase));
            cfg.Save();
            Fire(ReportGames(true));
        }

        // ------------------------------------------------------------------
        //  Les succès
        // ------------------------------------------------------------------
        static string[] DetectEmulators()
        {
            return Emulators.Sources().Where(s => s.Exists).Select(s => s.Label).Distinct().ToArray();
        }

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
                    if (syncNew && cfg.Linked) Fire(SyncSource(src, true));
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

        /// <summary>Relit tous les dossiers. Rend (jeux envoyés, nouveaux succès).</summary>
        async Task<Tuple<int, int>> FullSync()
        {
            if (!cfg.Linked) return Tuple.Create(0, 0);
            needsFullSync = false;
            int games = 0;
            int fresh = 0;
            foreach (var source in Emulators.Sources())
            {
                var r = await SyncSource(source, true);
                games += r.Item1;
                fresh += r.Item2;
            }
            return Tuple.Create(games, fresh);
        }

        async Task<Tuple<int, int>> SyncSource(Source source, bool quiet)
        {
            int games = 0;
            int fresh = 0;
            foreach (var hit in Emulators.Scan(source).ToList())
            {
                var n = await SyncFile(hit.Key, hit.Value, quiet);
                if (n >= 0)
                {
                    games++;
                    fresh += n;
                }
            }
            return Tuple.Create(games, fresh);
        }

        /// <summary>
        /// Envoie les succès d'un fichier s'il contient du nouveau. Rend le
        /// nombre de succès nouveaux pour le serveur, ou -1 si rien n'est parti.
        /// </summary>
        async Task<int> SyncFile(string appId, string file, bool quiet)
        {
            if (!cfg.Linked) return -1;
            if (cfg.IsUnmatched(appId)) return -1;

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
                // Le dossier du jeu, s'il est dans un dossier de jeux : il aide
                // le site à le montrer (et à le reconnaître).
                var local = Library.ByKey(appId);
                if (local != null && local.Name != null) body["name"] = local.Name;
                if (local != null && local.Folder != null) body["folder"] = local.Folder;
                var res = await api.Post("/companion/achievements", body);
                MarkOnline(true);
                // Un serveur d'avant la validation manuelle jetait les jeux non
                // reconnus ; l'actuel les garde (« stored »), à valider sur le site.
                if (!Api.Bool(res, "matched") && !Api.Bool(res, "stored"))
                {
                    cfg.MarkUnmatched(appId);
                    cfg.Save();
                    return -1;
                }
                var name = Api.Str(res, "name") ?? (local != null ? local.Name : null) ?? ("appid " + appId);
                var gameId = Api.Str(res, "gameId");
                var state = Api.Str(res, "state");
                bool waiting = Api.Bool(res, "pending");
                cfg.Learn(appId, name, Api.Str(res, "cover"), gameId);
                if (state != null) cfg.SetState(appId, state);
                if (waiting) cfg.PendingReview = Math.Max(cfg.PendingReview, 1);
                cfg.MarkSent(appId, unlocks.Select(u => u.Name));

                var fresh = Api.List(res, "newly").ToList();
                if (fresh.Count > 0)
                {
                    // L'heure de déblocage vient du fichier de l'émulateur.
                    var times = new Dictionary<string, long>();
                    foreach (var u in unlocks) times[u.Name] = Math.Max(u.At, times.ContainsKey(u.Name) ? times[u.Name] : 0);
                    long now = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
                    cfg.AddRecent(fresh.Select(f =>
                    {
                        var apiName = Api.Str(f, "apiName") ?? "";
                        long at;
                        times.TryGetValue(apiName, out at);
                        return new RecentUnlock
                        {
                            AppId = appId,
                            ApiName = apiName,
                            Name = Api.Str(f, "name") ?? apiName,
                            Game = name,
                            GameId = gameId,
                            Icon = Api.Str(f, "icon"),
                            At = at > 0 ? at : now,
                            Pending = waiting,
                        };
                    }).ToList());
                }
                cfg.Save();
                RaiseChanged();

                if (!quiet && cfg.Notify && fresh.Count > 0) AnnounceUnlocks(appId, name, fresh, waiting);
                return fresh.Count;
            }
            catch (ApiException ex)
            {
                if (ex.Unlinked) HandleUnlinked();
                return -1;
            }
            catch
            {
                needsFullSync = true; // hors ligne : on reprendra
                MarkOnline(false);
                return -1;
            }
            finally
            {
                syncGate.Release();
            }
        }

        /// <summary>Une notification par succès ; au-delà de trois, une seule pour le lot.</summary>
        void AnnounceUnlocks(string appId, string game, List<Dictionary<string, object>> fresh, bool waiting)
        {
            // En attente : le clic mène là où on valide ; sinon, au profil.
            Action open = () => OpenSite(waiting ? "/companion" : "/u/" + cfg.Username + "?tab=achievements");
            var sub = waiting ? game + " · à valider" : game;
            if (fresh.Count <= 3)
            {
                foreach (var f in fresh)
                {
                    ShowToast(new ToastInfo
                    {
                        Kicker = "SUCCÈS DÉBLOQUÉ",
                        Title = Api.Str(f, "name") ?? Api.Str(f, "apiName"),
                        Text = sub,
                        ImageUrl = Api.Str(f, "icon"),
                        Click = open,
                    });
                }
                return;
            }
            ShowToast(new ToastInfo
            {
                Kicker = fresh.Count + " SUCCÈS DÉBLOQUÉS",
                Title = sub,
                Text = string.Join(", ", fresh.Take(3).Select(f => Api.Str(f, "name"))) + "…",
                ImageUrl = cfg.CoverOf(appId),
                Click = open,
            });
        }

        // ------------------------------------------------------------------
        //  Synchroniser à la demande
        // ------------------------------------------------------------------
        /// <summary>
        /// Depuis la fenêtre, le résultat s'affiche sur le bouton ; depuis le
        /// menu de l'icône, dans une notification.
        /// </summary>
        public void SyncNow(bool fromWindow)
        {
            Fire(ManualSync(fromWindow));
        }

        async Task ManualSync(bool fromWindow)
        {
            if (Syncing || !cfg.Linked) return;
            Syncing = true;
            SyncNote = null;
            RaiseChanged();
            Tuple<int, int> r;
            try
            {
                await ReportGames(true);
                r = await FullSync();
                await SendPending();
                await RefreshRecent();
            }
            finally
            {
                Syncing = false;
            }
            int fresh = r.Item2;
            SyncNote = !Online ? "Hors ligne" : fresh > 0 ? fresh + " nouveau" + (fresh > 1 ? "x" : "") : "À jour";
            SyncNoteUntil = DateTime.UtcNow.AddSeconds(3);
            RaiseChanged();
            if (!fromWindow)
            {
                int games = cfg.Sent.Count;
                ShowToast(new ToastInfo
                {
                    Kicker = "SYNCHRONISÉ",
                    Title = !Online ? "Hors ligne pour l'instant"
                        : fresh > 0 ? fresh + " nouveau" + (fresh > 1 ? "x" : "") + " succès"
                        : "Tout est à jour",
                    Text = games + " jeu" + (games > 1 ? "x" : "") + " suivi" + (games > 1 ? "s" : ""),
                    Glyph = "refresh-cw",
                    HoldMs = 3500,
                    Click = ShowWindow,
                });
            }
        }

        // ------------------------------------------------------------------
        //  Le temps de jeu
        // ------------------------------------------------------------------
        void OnStarted(string appId)
        {
            UpdateTooltip();
            RaiseChanged();
            Fire(Lookup(appId));
        }

        /// <summary>Le jeu qui vient de se lancer : son nom, sa jaquette, et un signe.</summary>
        readonly HashSet<string> lookedUp = new HashSet<string>();

        /// <summary>La recherche du jeu a abouti (trouvé ou non) : la fenêtre cesse d'attendre.</summary>
        public bool LookedUp(string appId)
        {
            lock (lookedUp) return lookedUp.Contains(appId);
        }

        async Task Lookup(string appId)
        {
            if (!cfg.Linked) return;
            if (cfg.NameOf(appId) == null || cfg.StateOf(appId) == null)
            {
                // Le jeu est signalé au serveur (il arrive « à valider » s'il
                // est nouveau), qui répond ce qu'il en sait.
                var local = Library.ByKey(appId);
                long id;
                var payload = local != null ? Payload(local)
                    : long.TryParse(appId, out id) ? new Dictionary<string, object> { { "appid", id } }
                    : null;
                bool legacy = false;
                try
                {
                    if (payload != null)
                    {
                        ApplyStates(await api.Post("/companion/games", new Dictionary<string, object>
                        {
                            { "games", new List<object> { payload } },
                        }));
                    }
                    MarkOnline(true);
                }
                catch (ApiException ex)
                {
                    if (ex.Unlinked)
                    {
                        HandleUnlinked();
                        return;
                    }
                    // Serveur d'avant la validation manuelle : l'ancienne route
                    // (C# 5 : pas d'await dans un catch, on le fait juste après).
                    legacy = ex.Status == 404 && payload != null && payload.ContainsKey("appid");
                }
                catch
                {
                    MarkOnline(false);
                }
                if (legacy) await LegacyLookup(appId);
                UpdateTooltip();
            }
            lock (lookedUp) lookedUp.Add(appId);
            RaiseChanged();
            var name = cfg.NameOf(appId);
            var state = cfg.StateOf(appId);
            if (name == null || !cfg.Notify || state == "ignored") return;
            ShowToast(new ToastInfo
            {
                Kicker = "EN JEU",
                KickerColor = Theme.Green,
                Title = name,
                Text = state == "approved" ? "Temps de jeu suivi par MyPlayLog" : "Temps noté · à valider sur le site",
                ImageUrl = cfg.CoverOf(appId),
                Glyph = "gamepad-2",
                GlyphColor = Theme.Green,
                HoldMs = 3500,
                Click = ShowWindow,
            });
        }

        async Task LegacyLookup(string appId)
        {
            try
            {
                var res = await api.Get("/companion/app/" + appId);
                if (Api.Bool(res, "matched")) cfg.Learn(appId, Api.Str(res, "name"), Api.Str(res, "cover"), Api.Str(res, "gameId"));
                else cfg.MarkUnmatched(appId);
                cfg.Save();
            }
            catch
            {
            }
        }

        void OnChunk(PlayChunk chunk)
        {
            lock (cfg.Pending) cfg.Pending.Add(chunk);
            cfg.Save();
            Fire(SendPending());
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
                        // Un jeu sans appid voyage avec son dossier : c'est par son
                        // nom que le serveur le reconnaît.
                        var body = new Dictionary<string, object>
                        {
                            { "seconds", c.Seconds },
                            { "id", c.Id },
                        };
                        if (c.AppId > 0) body["appid"] = c.AppId;
                        if (c.Name != null) body["name"] = c.Name;
                        if (c.Folder != null) body["folder"] = c.Folder;
                        var res = await api.Post("/companion/playtime", body);
                        MarkOnline(true);
                        var key = c.Key ?? c.AppId.ToString();
                        cfg.Learn(key, Api.Str(res, "name"), Api.Str(res, "cover"), Api.Str(res, "gameId"));
                        var state = Api.Str(res, "state");
                        if (state != null) cfg.SetState(key, state);
                        if (Api.Bool(res, "pending")) cfg.PendingReview = Math.Max(cfg.PendingReview, 1);
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
                        MarkOnline(false);
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
        /// <summary>Relie ce PC avec le code de l'app. Rend null, ou le message d'erreur.</summary>
        public async Task<string> Pair(string code)
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
                cfg.Avatar = Api.Str(res, "avatar");
                cfg.Unmatched.Clear();
                cfg.UnlockedTotal = -1;
                cfg.Save();
                MarkOnline(true);
                // Relier, c'est vouloir que ça tourne : on lance avec Windows.
                SetStartup(true);
                startup = IsStartup();
                UpdateTooltip();
                RaiseChanged();
                ShowToast(new ToastInfo
                {
                    Kicker = "RELIÉ",
                    KickerColor = Theme.Green,
                    Title = "@" + cfg.Username,
                    Text = "Ce PC remonte tes succès et tes heures.",
                    Image = Theme.Logo,
                    Click = ShowWindow,
                });
                Fire(AfterPair());
                return null;
            }
            catch (ApiException ex)
            {
                return ex.Message;
            }
            catch
            {
                return "Connexion impossible. Vérifie ta connexion internet.";
            }
        }

        async Task AfterPair()
        {
            Syncing = true;
            RaiseChanged();
            try
            {
                await ReportGames(true);
                await FullSync();
                await SendPending();
                await RefreshRecent();
            }
            finally
            {
                Syncing = false;
                RaiseChanged();
            }
        }

        public void UnlinkNow()
        {
            Fire(Unlink());
        }

        async Task Unlink()
        {
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
            ui.Post(_ => UpdateTooltip(), null);
            RaiseChanged();
        }

        void HandleUnlinked()
        {
            if (!cfg.Linked) return;
            cfg.Unlink();
            ui.Post(_ => UpdateTooltip(), null);
            RaiseChanged();
            ShowToast(new ToastInfo
            {
                Kicker = "DÉLIÉ",
                KickerColor = Theme.Red,
                Title = "Ce PC n'est plus relié",
                Text = "Clique ici pour le relier à nouveau.",
                Glyph = "link-2-off",
                GlyphColor = Theme.Red,
                Click = ShowWindow,
            });
        }

        // ------------------------------------------------------------------
        //  Réglages
        // ------------------------------------------------------------------
        public void SetNotify(bool on)
        {
            cfg.Notify = on;
            cfg.Save();
            RaiseChanged();
        }

        public void OpenSite(string path)
        {
            Open(Site + path);
        }

        public void Quit()
        {
            ExitThread();
        }

        // ------------------------------------------------------------------
        //  Le menu de l'icône (clic droit)
        // ------------------------------------------------------------------
        /// <summary>Le nom d'un jeu pour l'affichage, quelle que soit sa clé.</summary>
        public string DisplayName(string key)
        {
            var name = cfg.NameOf(key);
            if (name != null) return name;
            var local = Library.ByKey(key);
            if (local != null && local.Name != null) return local.Name;
            return key.StartsWith("dir:") ? "Jeu" : "appid " + key;
        }

        void BuildMenu()
        {
            menu.Items.Clear();
            float s = Theme.SystemScale;
            Add(new ToolStripMenuItem(cfg.Linked ? "@" + cfg.Username : "Non relié")
            {
                Enabled = false,
                Tag = "head",
                Font = Theme.Semi(13.5f * s),
            });
            var playing = tracker == null ? new string[0] : tracker.Running;
            if (playing.Length > 0)
            {
                Add(new ToolStripMenuItem("En jeu · " + DisplayName(playing[0])) { Enabled = false });
            }
            menu.Items.Add(new ToolStripSeparator());

            Add(new ToolStripMenuItem(cfg.Linked ? "Ouvrir le compagnon" : "Relier mon compte…", null, (o, e) => ShowWindow()));
            if (cfg.Linked)
            {
                Add(new ToolStripMenuItem("Synchroniser maintenant", null, (o, e) => SyncNow(false)) { Enabled = !Syncing });
                if (cfg.PendingReview > 0)
                {
                    Add(new ToolStripMenuItem(cfg.PendingReview + " à valider sur le site", null, (o, e) => OpenSite("/companion")));
                }
                Add(new ToolStripMenuItem("Mon profil MyPlayLog", null, (o, e) => OpenSite("/u/" + cfg.Username)));
                menu.Items.Add(new ToolStripSeparator());

                var notify = new ToolStripMenuItem("Notifications") { Checked = cfg.Notify, CheckOnClick = true };
                notify.CheckedChanged += (o, e) => SetNotify(notify.Checked);
                Add(notify);
                var boot = new ToolStripMenuItem("Lancer avec Windows") { Checked = startup, CheckOnClick = true };
                boot.CheckedChanged += (o, e) => StartWithWindows = boot.Checked;
                Add(boot);
            }
            menu.Items.Add(new ToolStripSeparator());
            Add(new ToolStripMenuItem("Quitter", null, (o, e) => Quit()) { Tag = "danger" });
        }

        void Add(ToolStripItem item)
        {
            DarkMenu.Style(item);
            menu.Items.Add(item);
        }

        void UpdateTooltip()
        {
            var playing = tracker == null ? new string[0] : tracker.Running;
            var text = playing.Length > 0
                ? "MyPlayLog · En jeu : " + DisplayName(playing[0])
                : cfg.Linked ? "MyPlayLog Compagnon · @" + cfg.Username : "MyPlayLog Compagnon · non relié";
            // Une info-bulle d'icône ne dépasse pas 63 caractères.
            tray.Text = text.Length > 63 ? text.Substring(0, 62) + "…" : text;
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
            // Mode test (--data) : on ne touche jamais au vrai démarrage.
            if (Program.Sandbox) return;
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (key == null) return;
                    // --tray : lancé par Windows, il reste discret (pas de fenêtre).
                    if (on) key.SetValue(RunName, "\"" + Application.ExecutablePath + "\" --tray");
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
            if (showWait != null) showWait.Unregister(null);
            if (showSignal != null) showSignal.Dispose();
            if (window != null && !window.IsDisposed) window.Close();
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
