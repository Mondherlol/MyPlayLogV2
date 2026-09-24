using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// La fenêtre du compagnon (clic sur l'icône). Deux visages :
    ///
    /// - PAS RELIÉ : les six cases du code, qu'on tape ou qu'on colle ;
    ///   le sixième chiffre envoie tout seul.
    /// - RELIÉ : qui, ce qui tourne en ce moment (chrono en direct), les
    ///   derniers succès, les émulateurs trouvés, la synchro et les réglages.
    ///
    /// Tout est peint à la main (pas de contrôles WinForms) sur une grille de
    /// 400 × 600 « px à 96 dpi », mise à l'échelle de l'écran. Les zones
    /// cliquables sont notées pendant le dessin (hits) : ce qui est dessiné
    /// est exactement ce qui réagit.
    /// </summary>
    public class MainWindow : Form
    {
        const float W = 400, H = 612;

        readonly TrayApp app;
        float scale = 1;

        class Hit
        {
            public RectangleF R;
            public string Id;
            public Action Click;
        }

        readonly List<Hit> hits = new List<Hit>();
        string hover, press;

        readonly Timer clock; // 2 i/s : chrono, curseur du code, « il y a 3 min »
        readonly Timer anim;  // ~60 i/s, seulement pendant une animation
        bool caretOn = true;
        float spin;
        float notifyKnob, startupKnob;

        string code = "";
        bool pairing;
        string pairError;

        // « home » : le tableau de bord ; « games » : les jeux détectés.
        string view = "home";
        float scroll, scrollMax;

        DateTime confirmUnlinkUntil;

        public MainWindow(TrayApp app)
        {
            this.app = app;
            Text = "MyPlayLog Compagnon";
            Icon = TrayApp.AppIcon;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            // Juste la croix : fermer range la fenêtre, le compagnon continue.
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Theme.Bg;
            KeyPreview = true;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);

            notifyKnob = app.Cfg.Notify ? 1 : 0;
            startupKnob = app.StartWithWindows ? 1 : 0;

            clock = new Timer { Interval = 500 };
            clock.Tick += (s, e) =>
            {
                caretOn = !caretOn;
                Invalidate();
            };
            anim = new Timer { Interval = 15 };
            anim.Tick += (s, e) => Animate();

            app.Changed += OnChanged;
            Images.Loaded += Invalidate;
        }

        // --- Taille, dpi, barre de titre ------------------------------------
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Theme.DarkChrome(Handle, false);
            ApplyScale(Theme.ScaleOf(Handle));
            var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
            Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + (wa.Height - Height) / 2);
        }

        void ApplyScale(float s)
        {
            scale = s;
            ClientSize = new Size((int)Math.Round(W * s), (int)Math.Round(H * s));
            Invalidate();
        }

        [StructLayout(LayoutKind.Sequential)]
        struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        protected override void WndProc(ref Message m)
        {
            // Passée sur un écran d'une autre échelle : Windows propose un
            // cadre, on redessine à la nouvelle taille.
            if (m.Msg == 0x02E0) // WM_DPICHANGED
            {
                var r = (RECT)Marshal.PtrToStructure(m.LParam, typeof(RECT));
                scale = (m.WParam.ToInt64() & 0xFFFF) / 96f;
                SetBounds(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
                ApplyScale(scale);
                return;
            }
            base.WndProc(ref m);
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible)
            {
                clock.Start();
                Invalidate();
            }
            else
            {
                clock.Stop();
                anim.Stop();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // La croix range la fenêtre : le compagnon, lui, continue.
            if (e.CloseReason == CloseReason.UserClosing && !app.Exiting)
            {
                e.Cancel = true;
                Hide();
                app.WindowHidden();
                return;
            }
            base.OnFormClosing(e);
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            app.Changed -= OnChanged;
            Images.Loaded -= Invalidate;
            clock.Dispose();
            anim.Dispose();
            base.OnFormClosed(e);
        }

        void OnChanged()
        {
            if (IsDisposed) return;
            StartAnim();
            Invalidate();
        }

        void StartAnim()
        {
            if (!anim.Enabled) anim.Start();
        }

        void Animate()
        {
            bool busy = false;
            if (app.Syncing || pairing)
            {
                spin = (spin + 8) % 360;
                busy = true;
            }
            notifyKnob = Approach(notifyKnob, app.Cfg.Notify ? 1 : 0, ref busy);
            startupKnob = Approach(startupKnob, app.StartWithWindows ? 1 : 0, ref busy);
            if (!busy) anim.Stop();
            Invalidate();
        }

        static float Approach(float v, float target, ref bool busy)
        {
            if (Math.Abs(target - v) < 0.02f) return target;
            busy = true;
            return v + (target - v) * 0.3f;
        }

        // --- Souris ---------------------------------------------------------------
        string HitAt(Point p)
        {
            var q = new PointF(p.X / scale, p.Y / scale);
            for (int i = hits.Count - 1; i >= 0; i--)
                if (hits[i].R.Contains(q)) return hits[i].Id;
            return null;
        }

        bool Hot(string id)
        {
            return hover == id && (press == null || press == id);
        }

        bool Down(string id)
        {
            return press == id && hover == id;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            var id = HitAt(e.Location);
            if (id == hover) return;
            hover = id;
            Cursor = id != null ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover == null) return;
            hover = null;
            Cursor = Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            press = HitAt(e.Location);
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var id = HitAt(e.Location);
            var was = press;
            press = null;
            Invalidate();
            if (e.Button != MouseButtons.Left || id == null || id != was) return;
            var hit = hits.LastOrDefault(h => h.Id == id);
            if (hit != null && hit.Click != null) hit.Click();
        }

        // --- Clavier : le code à six chiffres ----------------------------------
        protected override void OnKeyPress(KeyPressEventArgs e)
        {
            base.OnKeyPress(e);
            if (app.Linked || pairing) return;
            char c = e.KeyChar;
            if (c < '0' || c > '9') return;
            e.Handled = true;
            // Après un refus, le premier chiffre repart d'une grille vide.
            if (pairError != null)
            {
                code = "";
                pairError = null;
            }
            if (code.Length >= 6) return;
            code += c;
            caretOn = true;
            Invalidate();
            if (code.Length == 6) Submit();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Escape)
            {
                if (view == "games")
                {
                    view = "home";
                    Invalidate();
                }
                else Close();
                return;
            }
            if (app.Linked || pairing) return;
            if (e.KeyCode == Keys.Back && code.Length > 0)
            {
                code = e.Control || pairError != null ? "" : code.Substring(0, code.Length - 1);
                pairError = null;
                caretOn = true;
                Invalidate();
            }
            else if (e.KeyCode == Keys.Delete)
            {
                code = "";
                pairError = null;
                Invalidate();
            }
            else if (e.KeyCode == Keys.Enter && code.Length == 6)
            {
                Submit();
            }
            else if (e.Control && e.KeyCode == Keys.V)
            {
                Paste();
            }
        }

        void Paste()
        {
            string text = "";
            try
            {
                text = Clipboard.GetText();
            }
            catch
            {
            }
            var digits = new string(text.Where(ch => ch >= '0' && ch <= '9').ToArray());
            if (digits.Length == 0) return;
            code = digits.Substring(0, Math.Min(6, digits.Length));
            pairError = null;
            Invalidate();
            if (code.Length == 6) Submit();
        }

        async void Submit()
        {
            if (pairing || code.Length != 6) return;
            pairing = true;
            pairError = null;
            StartAnim();
            Invalidate();
            string error;
            try
            {
                error = await app.Pair(code);
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
            pairing = false;
            if (error != null) pairError = error;
            else code = "";
            Invalidate();
        }

        // --- Dessin ---------------------------------------------------------------
        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // Tout est peint dans OnPaint, fond compris (pas de scintillement).
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Theme.Bg);
            Theme.Prepare(g, scale);
            hits.Clear();
            try
            {
                if (app.Linked && view == "games") PaintGames(g);
                else if (app.Linked) PaintHome(g);
                else PaintPair(g);
            }
            catch
            {
                // Une image abîmée ne doit pas faire tomber la fenêtre.
            }
        }

        protected override void OnActivated(EventArgs e)
        {
            base.OnActivated(e);
            Invalidate(); // le curseur du code n'apparaît que fenêtre active
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            Invalidate();
        }

        // ---- Relier ----
        void PaintPair(Graphics g)
        {
            var logo = Theme.Logo;
            if (logo != null) g.DrawImage(logo, new RectangleF((W - 68) / 2, 84, 68, 68));

            Theme.Text1(g, "Relie ton compte", Theme.Display(25), Theme.Text,
                new RectangleF(20, 174, W - 40, 34), StringAlignment.Center);
            Theme.Text1(g, "Dans l'app ou sur myplaylog.cc :", Theme.Body(13.5f), Theme.Soft,
                new RectangleF(20, 218, W - 40, 20), StringAlignment.Center);
            Theme.Text1(g, "Réglages › Compagnon PC › Relier un PC", Theme.Semi(13.5f), Theme.Text,
                new RectangleF(20, 239, W - 40, 20), StringAlignment.Center);

            // Six cases, un petit trait au milieu (3 + 3, comme le code affiché).
            const float bw = 46, bh = 58, gap = 8, mid = 22;
            float total = bw * 6 + gap * 4 + mid;
            float x0 = (W - total) / 2, y0 = 290;
            for (int i = 0; i < 6; i++)
            {
                float bx = x0 + i * (bw + gap) + (i >= 3 ? mid - gap : 0);
                var box = new RectangleF(bx, y0, bw, bh);
                bool active = !pairing && pairError == null && i == code.Length && ContainsFocus;
                Theme.Fill(g, box, 12, Theme.Surface);
                Color edge = pairError != null ? Theme.Red
                    : active ? Theme.Gold
                    : i < code.Length ? Theme.Mix(Theme.Border, Theme.Soft, 0.35f)
                    : Theme.Border;
                Theme.Stroke(g, box, 12, edge, active || pairError != null ? 2 : 1.5f);
                if (i < code.Length)
                {
                    Theme.Text1(g, code[i].ToString(), Theme.Display(27),
                        pairError != null ? Theme.Red : Theme.Text, box, StringAlignment.Center);
                }
                else if (active && caretOn)
                {
                    Theme.Fill(g, new RectangleF(box.X + bw / 2 - 1, box.Y + 17, 2, bh - 34), 1, Theme.Gold);
                }
            }
            Theme.Fill(g, new RectangleF(x0 + 3 * bw + 2 * gap + (mid - 8) / 2, y0 + bh / 2 - 1, 8, 2), 1, Theme.Faint);

            Button(g, new RectangleF(x0, 374, total, 48), "pair",
                pairing ? "Connexion…" : "Relier ce PC", pairing ? "refresh-cw" : null,
                true, code.Length == 6, pairing, Submit);

            if (pairError != null)
                Theme.Text1(g, pairError, Theme.Body(13), Theme.Red, new RectangleF(20, 436, W - 40, 20), StringAlignment.Center);
            else
                Theme.Text1(g, "Ctrl+V colle le code d'un coup", Theme.Body(12.5f), Theme.Faint,
                    new RectangleF(20, 436, W - 40, 20), StringAlignment.Center);

            Link(g, "settings", "Ouvrir les réglages du site", "external-link", W / 2, 552, true,
                () => app.OpenSite("/settings?tab=imports"));
        }

        // ---- Tableau de bord ----
        void PaintHome(Graphics g)
        {
            var cfg = app.Cfg;

            // Qui
            var av = new RectangleF(20, 18, 44, 44);
            var avatar = Images.Get(cfg.Avatar);
            if (avatar != null)
            {
                Theme.CirclePicture(g, avatar, av);
            }
            else
            {
                Theme.Circle(g, av, Theme.Gold);
                Theme.Text1(g, Initial(cfg.Username), Theme.Display(20), Theme.Ink, av, StringAlignment.Center);
            }
            Theme.Text1(g, string.IsNullOrEmpty(cfg.Username) ? "Relié" : "@" + cfg.Username,
                Theme.Display(19), Theme.Text, new RectangleF(76, 17, W - 96, 26));
            Theme.Circle(g, new RectangleF(77, 50, 7, 7), app.Online ? Theme.Green : Theme.Faint);
            Theme.Text1(g, app.Online ? "Relié · " + Environment.MachineName : "Hors ligne · envoi dès le retour du réseau",
                Theme.Body(12.5f), Theme.Soft, new RectangleF(91, 44, W - 111, 19));

            PaintNow(g, cfg);
            PaintRecent(g, cfg);
            PaintGamesRow(g);

            // Actions
            string syncLabel = "Synchroniser", syncGlyph = "refresh-cw";
            if (app.Syncing) syncLabel = "Synchro…";
            else if (app.SyncNote != null && DateTime.UtcNow < app.SyncNoteUntil)
            {
                syncLabel = app.SyncNote;
                syncGlyph = "check";
            }
            Button(g, new RectangleF(20, 426, 174, 44), "sync", syncLabel, syncGlyph, true, true, app.Syncing,
                () => app.SyncNow(true));
            Button(g, new RectangleF(206, 426, 174, 44), "profile", "Mon profil", "external-link", false, true, false,
                () => app.OpenSite("/u/" + cfg.Username));

            // Réglages
            Switch(g, new RectangleF(20, 482, 360, 40), "notify", "bell", "Notifications", notifyKnob,
                () => app.SetNotify(!cfg.Notify));
            Switch(g, new RectangleF(20, 522, 360, 40), "startup", "power", "Lancer avec Windows", startupKnob,
                () => app.StartWithWindows = !app.StartWithWindows);

            // Pied : délier (en deux clics), version, quitter
            bool armed = DateTime.UtcNow < confirmUnlinkUntil;
            Link(g, "unlink", armed ? "Sûr ? Clique pour délier" : "Délier ce PC", "link-2-off", 20, 588, false, () =>
            {
                if (DateTime.UtcNow < confirmUnlinkUntil)
                {
                    confirmUnlinkUntil = DateTime.MinValue;
                    app.UnlinkNow();
                }
                else
                {
                    confirmUnlinkUntil = DateTime.UtcNow.AddSeconds(4);
                }
                Invalidate();
            }, armed ? Theme.Red : (Color?)null);
            var quit = "Quitter";
            float qw = Theme.Width(g, quit, Theme.Body(12.5f));
            Link(g, "quit", quit, null, W - 20 - qw, 588, false, app.Quit);
            Theme.Text1(g, "v" + Program.Version, Theme.Body(12), Theme.Faint,
                new RectangleF(W - 20 - qw - 70, 579, 56, 18), StringAlignment.Far);
        }

        void PaintNow(Graphics g, Config cfg)
        {
            Label(g, "EN CE MOMENT", 80);
            var card = new RectangleF(20, 100, 360, 76);
            var sessions = app.Sessions;
            if (sessions.Length == 0)
            {
                Theme.Fill(g, card, 16, Theme.Surface);
                var ic = new RectangleF(34, 116, 44, 44);
                Theme.Circle(g, ic, Theme.Surface2);
                Theme.Icon(g, "gamepad-2", Theme.Soft, new RectangleF(ic.X + 12, ic.Y + 12, 20, 20));
                Theme.Text1(g, "Aucun jeu en cours", Theme.Semi(14.5f), Theme.Text, new RectangleF(92, 117, 272, 21));
                Theme.Text1(g, "Le temps se compte dès qu'un jeu se lance.", Theme.Body(12.5f), Theme.Soft,
                    new RectangleF(92, 139, 272, 19));
                return;
            }

            var s = sessions[0];
            string appId = s.Key;
            string name = cfg.NameOf(appId);
            var local = Library.ByKey(appId);
            if (name == null && local != null) name = local.Name;
            string state = cfg.StateOf(appId);
            string gameId = cfg.GameIdOf(appId);
            bool unknown = name == null && cfg.IsUnmatched(appId);
            // Un clic mène à la fiche du jeu, ou là où on le valide.
            string target = state == "pending" ? "/companion" : gameId != null ? "/game/" + gameId : null;
            Theme.Fill(g, card, 16, target != null && Hot("now") ? Theme.Surface2 : Theme.Surface);

            var cov = new RectangleF(32, 108, 45, 60);
            var cover = Images.Get(cfg.CoverOf(appId));
            if (cover != null)
            {
                Theme.Picture(g, cover, cov, 7);
            }
            else
            {
                Theme.Fill(g, cov, 7, Theme.Surface2);
                Theme.Icon(g, "gamepad-2", Theme.Faint, new RectangleF(cov.X + 12, cov.Y + 19, 21, 21));
            }

            float right = sessions.Length > 1 ? 318 : 364;
            string title = name ?? (unknown ? "Jeu non reconnu" : app.LookedUp(appId) ? "Jeu hors boutique" : "Recherche du jeu…");
            Theme.Text1(g, title, Theme.Display(16.5f), Theme.Text, new RectangleF(92, 114, right - 92, 24));
            if (unknown)
            {
                Theme.Text1(g, "appid " + appId + " · absent de MyPlayLog", Theme.Body(12.5f), Theme.Soft,
                    new RectangleF(92, 141, right - 92, 19));
            }
            else
            {
                Theme.Circle(g, new RectangleF(93, 147, 7, 7), Theme.Green);
                var line = "En jeu · " + Clock(DateTime.UtcNow - s.Value);
                var lf = Theme.Body(13);
                Theme.Text1(g, line, lf, Theme.Soft, new RectangleF(107, 141, right - 107, 19));
                // Jeu pas encore validé : ses heures attendent sur le site.
                if (state == "pending")
                {
                    float lw = Theme.Width(g, line, lf);
                    Theme.Text1(g, " · à valider", lf, Theme.Gold, new RectangleF(107 + lw, 141, right - 107 - lw, 19));
                }
            }
            if (sessions.Length > 1)
            {
                var more = new RectangleF(326, 126, 42, 24);
                Theme.Fill(g, more, 12, Theme.Surface2);
                Theme.Text1(g, "+" + (sessions.Length - 1), Theme.Semi(12), Theme.Soft, more, StringAlignment.Center);
            }
            if (target != null)
                hits.Add(new Hit { R = card, Id = "now", Click = () => app.OpenSite(target) });
        }

        void PaintRecent(Graphics g, Config cfg)
        {
            Label(g, "DERNIERS SUCCÈS", 192);
            int total = cfg.SentTotal();
            if (total > 0)
            {
                Theme.Text1(g, total + " envoyé" + (total > 1 ? "s" : ""), Theme.Body(12), Theme.Faint,
                    new RectangleF(200, 191, 180, 16), StringAlignment.Far);
            }

            var box = new RectangleF(20, 212, 360, 156);
            Theme.Fill(g, box, 16, Theme.Surface);
            var recent = cfg.RecentSnapshot();
            if (recent.Length == 0)
            {
                var ic = new RectangleF((W - 44) / 2, 232, 44, 44);
                Theme.Circle(g, ic, Theme.Surface2);
                Theme.Icon(g, "trophy", Theme.Soft, new RectangleF(ic.X + 12, ic.Y + 12, 20, 20));
                Theme.Text1(g, "Aucun succès pour l'instant", Theme.Semi(14.5f), Theme.Text,
                    new RectangleF(30, 288, 340, 21), StringAlignment.Center);
                Theme.Text1(g,
                    app.EmulatorLabels.Length > 0
                        ? "Ils s'afficheront ici dès qu'un jeu en débloque."
                        : "Aucun émulateur de succès trouvé sur ce PC.",
                    Theme.Body(12.5f), Theme.Soft, new RectangleF(30, 311, 340, 19), StringAlignment.Center);
                return;
            }

            string target = "/u/" + cfg.Username + "?tab=achievements";
            int n = Math.Min(3, recent.Length);
            for (int i = 0; i < n; i++)
            {
                var r = recent[i];
                var row = new RectangleF(box.X, box.Y + i * 52, box.Width, 52);
                string id = "recent" + i;
                if (Hot(id))
                {
                    var state = g.Save();
                    using (var clip = Theme.Round(box, 16))
                    {
                        g.SetClip(clip);
                        using (var b = new SolidBrush(Theme.Surface2)) g.FillRectangle(b, row);
                    }
                    g.Restore(state);
                }

                var pic = new RectangleF(32, row.Y + 8, 36, 36);
                var icon = Images.Get(r.Icon);
                if (icon != null)
                {
                    Theme.Picture(g, icon, pic, 8);
                }
                else
                {
                    Theme.Fill(g, pic, 8, Theme.Surface2);
                    Theme.Icon(g, "trophy", Theme.Gold, new RectangleF(pic.X + 9, pic.Y + 9, 18, 18));
                }
                // En attente de validation : on le dit, à la place de la date.
                string ago = r.Pending ? "à valider" : Theme.Ago(Epoch.AddSeconds(r.At));
                float agoW = Theme.Width(g, ago, Theme.Body(11.5f));
                Theme.Text1(g, r.Name, Theme.Semi(13.5f), Theme.Text, new RectangleF(80, row.Y + 8, 288 - agoW - 10, 19));
                Theme.Text1(g, r.Game, Theme.Body(12), Theme.Soft, new RectangleF(80, row.Y + 27, 288, 17));
                Theme.Text1(g, ago, Theme.Body(11.5f), r.Pending ? Theme.Gold : Theme.Faint, new RectangleF(368 - agoW, row.Y + 8, agoW + 1, 19));
                if (i < n - 1)
                {
                    using (var pen = new Pen(Theme.Border, 1)) g.DrawLine(pen, 80, row.Bottom - 0.5f, 368, row.Bottom - 0.5f);
                }
                hits.Add(new Hit { R = row, Id = id, Click = () => app.OpenSite(target) });
            }
        }

        // ---- La ligne « jeux détectés » de l'accueil ----
        void PaintGamesRow(Graphics g)
        {
            var row = new RectangleF(20, 380, 360, 36);
            Theme.Fill(g, row, 12, Hot("games") ? Theme.Surface2 : Theme.Surface);
            Theme.Icon(g, "gamepad-2", Theme.Soft, new RectangleF(32, 389, 18, 18));
            int n = app.Detected.Length;
            var label = n == 0 ? "Aucun jeu détecté" : n + " jeu" + (n > 1 ? "x" : "") + " détecté" + (n > 1 ? "s" : "");
            Theme.Text1(g, label, Theme.Semi(13.5f), Theme.Text, new RectangleF(58, 380, 200, 36));
            hits.Add(new Hit { R = row, Id = "games", Click = OpenGames });

            int pending = app.PendingReview;
            if (pending > 0)
            {
                // La pastille mène directement là où l'on valide.
                var text = pending + " à valider";
                var f = Theme.Semi(12);
                float w = Theme.Width(g, text, f) + 22;
                var pill = new RectangleF(row.Right - 34 - w, row.Y + 7, w, 22);
                Theme.Fill(g, pill, 11, Hot("review") ? Theme.Mix(Theme.Gold, Color.White, 0.14f) : Theme.Gold);
                Theme.Text1(g, text, f, Theme.Ink, pill, StringAlignment.Center);
                hits.Add(new Hit { R = pill, Id = "review", Click = () => app.OpenSite("/companion") });
            }
            Theme.Icon(g, "chevron-right", Theme.Soft, new RectangleF(row.Right - 28, row.Y + 9, 18, 18));
        }

        void OpenGames()
        {
            view = "games";
            scroll = 0;
            Invalidate();
        }

        // ---- La vue « jeux détectés » ----
        void PaintGames(Graphics g)
        {
            var cfg = app.Cfg;
            var back = new RectangleF(12, 14, 220, 40);
            if (Hot("back")) Theme.Fill(g, back, 10, Theme.Surface);
            Theme.Icon(g, "chevron-left", Theme.Text, new RectangleF(20, 25, 18, 18));
            Theme.Text1(g, "Jeux détectés", Theme.Display(19), Theme.Text, new RectangleF(44, 14, 186, 40));
            hits.Add(new Hit
            {
                R = back,
                Id = "back",
                Click = () =>
                {
                    view = "home";
                    Invalidate();
                },
            });

            // Les dossiers de jeux, en pastilles (× pour retirer), et « Ajouter ».
            Label(g, "DOSSIERS DE JEUX", 70);
            float x = 20, y = 90;
            var chipFont = Theme.Semi(12);
            foreach (var lib in cfg.Libraries.ToList())
            {
                var path = lib;
                float w = Math.Min(360, Theme.Width(g, path, chipFont) + 58);
                if (x + w > 380)
                {
                    x = 20;
                    y += 34;
                }
                var chip = new RectangleF(x, y, w, 28);
                string id = "lib:" + path;
                Theme.Fill(g, chip, 14, Theme.Surface);
                Theme.Icon(g, "folder", Theme.Gold, new RectangleF(x + 10, y + 7, 14, 14));
                Theme.Text1(g, path, chipFont, Theme.Text, new RectangleF(x + 30, y, w - 56, 28));
                var xr = new RectangleF(chip.Right - 24, y + 4, 20, 20);
                if (Hot(id)) Theme.Fill(g, xr, 10, Theme.Border);
                Theme.Icon(g, "x", Hot(id) ? Theme.Text : Theme.Soft, new RectangleF(xr.X + 4, xr.Y + 4, 12, 12));
                hits.Add(new Hit { R = xr, Id = id, Click = () => app.RemoveLibrary(path) });
                x += w + 6;
            }
            {
                var add = "Ajouter un dossier";
                float w = Theme.Width(g, add, chipFont) + 40;
                if (x + w > 380)
                {
                    x = 20;
                    y += 34;
                }
                var chip = new RectangleF(x, y, w, 28);
                Theme.Fill(g, chip, 14, Hot("addlib") ? Theme.Surface2 : Theme.Bg);
                Theme.Stroke(g, chip, 14, Theme.Border, 1);
                Theme.Icon(g, "folder-plus", Theme.Soft, new RectangleF(x + 10, y + 7, 14, 14));
                Theme.Text1(g, add, chipFont, Theme.Soft, new RectangleF(x + 30, y, w - 36, 28));
                hits.Add(new Hit
                {
                    R = chip,
                    Id = "addlib",
                    Click = () =>
                    {
                        var picked = FolderPicker.Pick(this, "Un dossier où tu ranges tes jeux");
                        if (picked != null) app.AddLibrary(picked);
                    },
                });
            }

            // La liste des jeux, qui défile.
            var games = app.Detected
                .OrderBy(lg => StateRank(cfg.StateOf(lg.Key)))
                .ThenBy(lg => app.DisplayName(lg.Key))
                .ToArray();
            float top = y + 56;
            Label(g, "JEUX · " + games.Length, top - 22);
            var list = new RectangleF(20, top, 360, H - 76 - top);
            Theme.Fill(g, list, 14, Theme.Surface);
            const float rowH = 50;
            scrollMax = Math.Max(0, games.Length * rowH - list.Height);
            if (scroll > scrollMax) scroll = scrollMax;

            if (games.Length == 0)
            {
                Theme.Text1(g, cfg.Libraries.Count == 0 ? "Ajoute le dossier où sont tes jeux." : "Aucun jeu trouvé pour l'instant.",
                    Theme.Body(13), Theme.Soft, list, StringAlignment.Center);
            }
            var saved = g.Save();
            using (var clip = Theme.Round(list, 14)) g.SetClip(clip);
            for (int i = 0; i < games.Length; i++)
            {
                float ry = list.Y + i * rowH - scroll;
                if (ry + rowH < list.Y || ry > list.Bottom) continue;
                var lg = games[i];
                var row = new RectangleF(list.X, ry, list.Width, rowH);
                string id = "game:" + lg.Key;
                if (Hot(id))
                    using (var b = new SolidBrush(Theme.Surface2)) g.FillRectangle(b, row);

                var pic = new RectangleF(32, ry + 7, 27, 36);
                var cover = Images.Get(cfg.CoverOf(lg.Key));
                if (cover != null)
                {
                    Theme.Picture(g, cover, pic, 5);
                }
                else
                {
                    Theme.Fill(g, pic, 5, Theme.Surface2);
                    Theme.Icon(g, "gamepad-2", Theme.Faint, new RectangleF(pic.X + 6, pic.Y + 11, 15, 15));
                }

                string st = cfg.StateOf(lg.Key);
                string tag = st == "approved" ? "Suivi" : st == "pending" ? "À valider" : st == "ignored" ? "Écarté" : "…";
                var tf = Theme.Semi(11);
                float tw = Theme.Width(g, tag, tf) + 16;
                var tagR = new RectangleF(368 - tw, ry + 15, tw, 20);
                Color tbg = st == "pending" ? Theme.Gold : st == "approved" ? Theme.Mix(Theme.Surface, Theme.Green, 0.18f) : Theme.Surface2;
                Color tfg = st == "pending" ? Theme.Ink : st == "approved" ? Theme.Green : Theme.Faint;
                Theme.Fill(g, tagR, 10, tbg);
                Theme.Text1(g, tag, tf, tfg, tagR, StringAlignment.Center);

                float nameW = 368 - tw - 8 - 70;
                Theme.Text1(g, app.DisplayName(lg.Key), Theme.Semi(13.5f), st == "ignored" ? Theme.Soft : Theme.Text,
                    new RectangleF(70, ry + 7, nameW, 19));
                string sub = lg.Folder ?? ("sauvegardes · appid " + lg.AppId);
                if (lg.Emulator != null) sub = lg.Emulator + " · " + sub;
                Theme.Text1(g, sub, Theme.Body(11.5f), Theme.Faint, new RectangleF(70, ry + 26, nameW, 17));
                if (i < games.Length - 1)
                    using (var pen = new Pen(Theme.Border, 1)) g.DrawLine(pen, 70, ry + rowH - 0.5f, 368, ry + rowH - 0.5f);

                var vis = RectangleF.Intersect(row, list);
                if (vis.Height > 4) hits.Add(new Hit { R = vis, Id = id, Click = () => app.OpenSite("/companion") });
            }
            g.Restore(saved);

            // Valider se fait sur le site.
            int pending = app.PendingReview;
            Button(g, new RectangleF(20, H - 62, 360, 44), "site",
                pending > 0 ? pending + " à valider sur le site" : "Historique et réglages sur le site",
                pending > 0 ? "inbox" : "external-link", pending > 0, true, false, () => app.OpenSite("/companion"));
        }

        static int StateRank(string state)
        {
            return state == "pending" ? 0 : state == "approved" ? 1 : state == null ? 2 : 3;
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            if (view != "games" || scrollMax <= 0) return;
            scroll = Math.Max(0, Math.Min(scrollMax, scroll - e.Delta / 120f * 50));
            Invalidate();
        }

        // --- Pièces -----------------------------------------------------------------
        void Label(Graphics g, string text, float y)
        {
            Theme.Text1(g, text, Theme.Semi(11), Theme.Faint, new RectangleF(22, y, 250, 16));
        }

        void Button(Graphics g, RectangleF r, string id, string label, string glyph,
            bool primary, bool enabled, bool busy, Action click)
        {
            bool live = enabled && !busy;
            Color bg, fg;
            if (primary && (enabled || busy))
            {
                bg = Theme.Gold;
                fg = Theme.Ink;
                if (live && Down(id)) bg = Theme.Mix(Theme.Gold, Theme.Ink, 0.14f);
                else if (live && Hot(id)) bg = Theme.Mix(Theme.Gold, Color.White, 0.14f);
            }
            else if (primary)
            {
                bg = Theme.Surface2;
                fg = Theme.Faint;
            }
            else
            {
                bg = live && Down(id) ? Theme.Surface : live && Hot(id) ? Theme.Border : Theme.Surface2;
                fg = Theme.Text;
            }
            Theme.Fill(g, r, 12, bg);

            var font = Theme.Semi(14);
            float tw = Theme.Width(g, label, font);
            float iw = glyph != null ? 26 : 0;
            float sx = r.X + (r.Width - tw - iw) / 2;
            if (glyph != null)
            {
                var ir = new RectangleF(sx, r.Y + (r.Height - 18) / 2, 18, 18);
                if (busy) Theme.Icon(g, glyph, fg, ir, spin);
                else Theme.Icon(g, glyph, fg, ir);
            }
            Theme.Text1(g, label, font, fg, new RectangleF(sx + iw, r.Y, tw + 2, r.Height));
            if (live) hits.Add(new Hit { R = r, Id = id, Click = click });
        }

        void Switch(Graphics g, RectangleF row, string id, string glyph, string label, float t, Action toggle)
        {
            if (Hot(id)) Theme.Fill(g, row, 10, Theme.Surface);
            Theme.Icon(g, glyph, Theme.Soft, new RectangleF(row.X + 12, row.Y + (row.Height - 18) / 2, 18, 18));
            Theme.Text1(g, label, Theme.Body(14), Theme.Text, new RectangleF(row.X + 42, row.Y, row.Width - 110, row.Height));

            var track = new RectangleF(row.Right - 12 - 38, row.Y + (row.Height - 22) / 2, 38, 22);
            Theme.Fill(g, track, 11, Theme.Mix(Theme.Border, Theme.Gold, t));
            float kx = track.X + 3 + t * (track.Width - 22);
            Theme.Circle(g, new RectangleF(kx, track.Y + 3, 16, 16), Theme.Mix(Theme.Soft, Theme.Bg, t));
            hits.Add(new Hit
            {
                R = row,
                Id = id,
                Click = () =>
                {
                    toggle();
                    StartAnim();
                },
            });
        }

        /// <summary>Un lien discret, avec ou sans icône ; centré sur x si `center`.</summary>
        void Link(Graphics g, string id, string text, string glyph, float x, float cy, bool center, Action click,
            Color? color = null)
        {
            var font = Theme.Body(12.5f);
            float tw = Theme.Width(g, text, font);
            float iw = glyph != null ? 20 : 0;
            float w = tw + iw;
            float left = center ? x - w / 2 : x;
            Color c = color ?? (Hot(id) ? Theme.Text : Theme.Soft);
            if (glyph != null) Theme.Icon(g, glyph, c, new RectangleF(left, cy - 7, 14, 14));
            Theme.Text1(g, text, font, c, new RectangleF(left + iw, cy - 10, tw + 2, 20));
            hits.Add(new Hit { R = new RectangleF(left - 6, cy - 14, w + 12, 28), Id = id, Click = click });
        }

        static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        static string Initial(string name)
        {
            return string.IsNullOrEmpty(name) ? "?" : name.Substring(0, 1).ToUpperInvariant();
        }

        static string Clock(TimeSpan t)
        {
            if (t < TimeSpan.Zero) t = TimeSpan.Zero;
            int h = (int)t.TotalHours;
            return h > 0
                ? string.Format("{0}:{1:00}:{2:00}", h, t.Minutes, t.Seconds)
                : string.Format("{0}:{1:00}", t.Minutes, t.Seconds);
        }
    }
}
