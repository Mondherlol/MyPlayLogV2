using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MyPlayLog.Companion
{
    /// <summary>Ce qu'affiche une notification.</summary>
    public class ToastInfo
    {
        public string Kicker;
        public Color KickerColor = Theme.Gold;
        public string Title;
        public string Text;
        // L'image : un fichier du web (icône du succès, jaquette), une image
        // en mémoire (le logo), ou à défaut une icône Lucide sur fond gris.
        public string ImageUrl;
        public Image Image;
        public bool Round;
        public string Glyph = "trophy";
        public Color GlyphColor = Theme.Gold;
        public int HoldMs = 5200;
        public Action Click;
    }

    /// <summary>
    /// La notification du compagnon, en bas à droite de l'écran, à la manière
    /// de celles de Steam : l'icône du succès, son nom, le jeu.
    ///
    /// Une fenêtre « à transparence par pixel » (UpdateLayeredWindow) : les
    /// coins arrondis sont lissés et le fondu se fait sans scintiller. Elle ne
    /// prend JAMAIS le focus (WS_EX_NOACTIVATE) : un jeu en plein écran ne perd
    /// pas la main quand un succès tombe. Trois au plus à la fois, la plus
    /// récente en bas ; le survol met le compte à rebours en pause.
    /// </summary>
    public class Toast : Form
    {
        const float W = 356, H = 84, Edge = 14, Gap = 10;
        const int MaxOpen = 3;

        static readonly List<Toast> Open = new List<Toast>(); // [0] = la plus basse
        static Timer clock;

        readonly ToastInfo info;
        float scale = 1;
        int pw, ph;
        float x, y, targetY;
        int phase; // 0 entrée, 1 affichée, 2 sortie
        double phaseMs;
        DateTime last;
        IntPtr hbitmap = IntPtr.Zero;
        bool waitingImage;

        public static void Push(ToastInfo info)
        {
            var t = new Toast(info);
            t.Start();
        }

        Toast(ToastInfo info)
        {
            this.info = info;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            var wa = Screen.PrimaryScreen.WorkingArea;
            // Posée d'abord sur l'écran principal : c'est son dpi qu'elle prend.
            Bounds = new Rectangle(wa.Right - 40, wa.Bottom - 40, 20, 20);
            Cursor = Cursors.Hand;
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                // calque | outil (pas d'Alt+Tab) | sans activation | au premier plan
                cp.ExStyle |= 0x80000 | 0x80 | 0x08000000 | 0x8;
                return cp;
            }
        }

        void Start()
        {
            CreateHandle();
            scale = Theme.ScaleOf(Handle);
            pw = (int)Math.Ceiling(W * scale);
            ph = (int)Math.Ceiling(H * scale);
            Render();

            // Les plus anciennes montent d'un cran ; au-delà de trois, elles sortent.
            Open.Insert(0, this);
            for (int i = MaxOpen; i < Open.Count; i++) Open[i].Dismiss();
            Restack();
            var wa = Screen.PrimaryScreen.WorkingArea;
            x = wa.Right - Edge * scale - pw;
            y = targetY;
            last = DateTime.UtcNow;
            Show();
            Present(0, 0);

            if (clock == null)
            {
                clock = new Timer { Interval = 15 };
                clock.Tick += (s, e) => TickAll();
            }
            clock.Start();
        }

        static void Restack()
        {
            if (Open.Count == 0) return;
            var wa = Screen.PrimaryScreen.WorkingArea;
            float bottom = wa.Bottom - Edge * Open[0].scale;
            foreach (var t in Open)
            {
                t.targetY = bottom - t.ph;
                bottom = t.targetY - Gap * t.scale;
            }
        }

        static void TickAll()
        {
            var now = DateTime.UtcNow;
            foreach (var t in Open.ToArray()) t.Step(now);
            if (Open.Count == 0) clock.Stop();
        }

        void Dismiss()
        {
            if (phase == 2) return;
            phase = 2;
            phaseMs = 0;
        }

        bool Hovered
        {
            get { return new Rectangle((int)x, (int)y, pw, ph).Contains(Cursor.Position); }
        }

        void Step(DateTime now)
        {
            double dt = (now - last).TotalMilliseconds;
            last = now;
            phaseMs += dt;

            // Glisse verticalement quand une voisine arrive ou part.
            if (Math.Abs(targetY - y) > 0.5f) y += (targetY - y) * 0.22f;
            else y = targetY;

            double alpha;
            float dx = 0;
            if (phase == 0)
            {
                double p = Math.Min(1, phaseMs / 260);
                double e = 1 - Math.Pow(1 - p, 3);
                alpha = e;
                dx = (float)((1 - e) * 28 * scale);
                if (p >= 1)
                {
                    phase = 1;
                    phaseMs = 0;
                }
            }
            else if (phase == 1)
            {
                alpha = 1;
                if (Hovered) phaseMs -= dt; // le temps s'arrête sous la souris
                if (phaseMs >= info.HoldMs) Dismiss();
            }
            else
            {
                double p = Math.Min(1, phaseMs / 200);
                alpha = 1 - p;
                dx = (float)(p * 16 * scale);
                if (p >= 1)
                {
                    Finish();
                    return;
                }
            }
            Present((byte)Math.Round(alpha * 255), dx);
        }

        void Finish()
        {
            Open.Remove(this);
            Restack();
            Close();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (phase == 2) return;
            if (e.Button == MouseButtons.Left && info.Click != null) info.Click();
            Dismiss();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (waitingImage) Images.Loaded -= OnImage;
            if (hbitmap != IntPtr.Zero) DeleteObject(hbitmap);
            hbitmap = IntPtr.Zero;
            base.OnFormClosed(e);
        }

        void OnImage()
        {
            if (IsDisposed || Images.Get(info.ImageUrl) == null) return;
            Images.Loaded -= OnImage;
            waitingImage = false;
            Render();
        }

        // --- Le dessin ----------------------------------------------------------
        void Render()
        {
            using (var bmp = new Bitmap(pw, ph, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.Transparent);
                    Theme.Prepare(g, scale);
                    Draw(g);
                }
                if (hbitmap != IntPtr.Zero) DeleteObject(hbitmap);
                hbitmap = bmp.GetHbitmap(Color.FromArgb(0));
            }
        }

        void Draw(Graphics g)
        {
            var card = new RectangleF(0, 0, W, H);
            Theme.Fill(g, card, 14, Theme.Surface);
            Theme.Stroke(g, card, 14, Theme.Border, 1);

            var pic = new RectangleF(14, 14, 56, 56);
            var img = info.Image;
            if (img == null && info.ImageUrl != null)
            {
                img = Images.Get(info.ImageUrl);
                if (img == null && !waitingImage)
                {
                    waitingImage = true;
                    Images.Loaded += OnImage;
                }
            }
            if (img != null)
            {
                if (info.Round) Theme.CirclePicture(g, img, pic);
                else Theme.Picture(g, img, pic, 10);
            }
            else
            {
                Theme.Fill(g, pic, 10, Theme.Surface2);
                Theme.Icon(g, info.Glyph, info.GlyphColor, new RectangleF(pic.X + 15, pic.Y + 15, 26, 26));
            }

            float tx = 84, tw = W - tx - 16;
            bool sub = !string.IsNullOrEmpty(info.Text);
            float top = sub ? 14 : 22;
            Theme.Text1(g, info.Kicker, Theme.Semi(10.5f), info.KickerColor, new RectangleF(tx, top, tw, 16));
            Theme.Text1(g, info.Title, Theme.Display(15.5f), Theme.Text, new RectangleF(tx, top + 17, tw, 24));
            if (sub) Theme.Text1(g, info.Text, Theme.Body(12.5f), Theme.Soft, new RectangleF(tx, top + 40, tw, 18));
        }

        void Present(byte alpha, float dx)
        {
            if (hbitmap == IntPtr.Zero || IsDisposed) return;
            IntPtr screen = GetDC(IntPtr.Zero);
            IntPtr mem = CreateCompatibleDC(screen);
            IntPtr old = SelectObject(mem, hbitmap);
            try
            {
                var size = new SIZE { cx = pw, cy = ph };
                var src = new POINT();
                var dst = new POINT { x = (int)Math.Round(x + dx), y = (int)Math.Round(y) };
                var blend = new BLENDFUNCTION { BlendOp = 0, BlendFlags = 0, SourceConstantAlpha = alpha, AlphaFormat = 1 };
                UpdateLayeredWindow(Handle, screen, ref dst, ref size, mem, ref src, 0, ref blend, 2);
            }
            finally
            {
                SelectObject(mem, old);
                DeleteDC(mem);
                ReleaseDC(IntPtr.Zero, screen);
            }
        }

        // --- Win32 ----------------------------------------------------------------
        [StructLayout(LayoutKind.Sequential)]
        struct POINT
        {
            public int x, y;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct SIZE
        {
            public int cx, cy;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        struct BLENDFUNCTION
        {
            public byte BlendOp, BlendFlags, SourceConstantAlpha, AlphaFormat;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
            IntPtr hdcSrc, ref POINT pprSrc, int crKey, ref BLENDFUNCTION pblend, int flags);

        [DllImport("user32.dll")]
        static extern IntPtr GetDC(IntPtr hwnd);

        [DllImport("user32.dll")]
        static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

        [DllImport("gdi32.dll")]
        static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);

        [DllImport("gdi32.dll")]
        static extern bool DeleteObject(IntPtr obj);
    }
}
