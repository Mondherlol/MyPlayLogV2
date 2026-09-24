using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// L'habillage du compagnon : les couleurs de l'app (fond presque noir, le
    /// doré #f2b70b à sa valeur exacte), ses polices (Space Grotesk pour les
    /// titres, Inter pour le texte, embarquées dans l'exe), les formes arrondies
    /// et les icônes Lucide recolorées à la demande.
    ///
    /// Tout se dessine en unités « 96 dpi » : chaque fenêtre applique son
    /// facteur d'échelle (Graphics.ScaleTransform), le trait reste net sur un
    /// écran 150 %.
    /// </summary>
    public static class Theme
    {
        public static readonly Color Bg = Hex(0x111114);
        public static readonly Color Surface = Hex(0x1a1b21);
        public static readonly Color Surface2 = Hex(0x23252d);
        public static readonly Color Border = Hex(0x2c2f39);
        public static readonly Color Text = Hex(0xf2f3f6);
        public static readonly Color Soft = Hex(0x9a9dab);
        public static readonly Color Faint = Hex(0x5d6070);
        public static readonly Color Gold = Hex(0xf2b70b);
        public static readonly Color Ink = Hex(0x3b2a02);
        public static readonly Color Green = Hex(0x3dd68c);
        public static readonly Color Red = Hex(0xe0574d);

        static Color Hex(int rgb)
        {
            return Color.FromArgb(255, (rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
        }

        // --- Les polices embarquées ------------------------------------------
        static readonly PrivateFontCollection Fonts = new PrivateFontCollection();
        static readonly List<IntPtr> FontMemory = new List<IntPtr>();
        static FontFamily display, body, bodySemi;
        static readonly Dictionary<string, Font> FontCache = new Dictionary<string, Font>();

        public static void Init()
        {
            display = LoadFont("SpaceGrotesk_700Bold.ttf");
            body = LoadFont("Inter_400Regular.ttf");
            bodySemi = LoadFont("Inter_600SemiBold.ttf");
        }

        static FontFamily LoadFont(string file)
        {
            try
            {
                var bytes = Resource("font." + file);
                if (bytes == null) return null;
                // GDI+ lit la police en mémoire : elle doit y rester tant que
                // l'application tourne.
                IntPtr mem = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, mem, bytes.Length);
                FontMemory.Add(mem);
                // Families est trié par nom : la nouvelle famille est celle
                // qu'on n'avait pas encore.
                var known = new HashSet<string>();
                foreach (var f in Fonts.Families) known.Add(f.Name);
                Fonts.AddMemoryFont(mem, bytes.Length);
                // GDI aussi (TextRenderer, le menu) : sans ça il la remplace
                // par une police système.
                uint added = 0;
                AddFontMemResourceEx(mem, (uint)bytes.Length, IntPtr.Zero, ref added);
                foreach (var f in Fonts.Families)
                    if (!known.Contains(f.Name)) return f;
                return null;
            }
            catch
            {
                return null;
            }
        }

        static Font Make(FontFamily family, string fallback, float px, FontStyle preferred)
        {
            var key = (family != null ? family.Name : fallback) + "|" + px + "|" + preferred;
            Font f;
            if (FontCache.TryGetValue(key, out f)) return f;
            try
            {
                if (family != null)
                {
                    // Une police statique n'a souvent qu'UN style (Space Grotesk
                    // Bold n'a pas de « Regular ») : on prend celui qui existe.
                    FontStyle style = family.IsStyleAvailable(preferred) ? preferred
                        : family.IsStyleAvailable(FontStyle.Regular) ? FontStyle.Regular
                        : FontStyle.Bold;
                    f = new Font(family, px, style, GraphicsUnit.Pixel);
                }
            }
            catch
            {
                f = null;
            }
            if (f == null) f = new Font(fallback, px, preferred, GraphicsUnit.Pixel);
            FontCache[key] = f;
            return f;
        }

        public static Font Display(float px) { return Make(display, "Segoe UI Semibold", px, FontStyle.Bold); }
        public static Font Body(float px) { return Make(body, "Segoe UI", px, FontStyle.Regular); }
        public static Font Semi(float px) { return Make(bodySemi, "Segoe UI Semibold", px, FontStyle.Regular); }

        // --- Ressources embarquées --------------------------------------------
        public static byte[] Resource(string name)
        {
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            {
                if (s == null) return null;
                var ms = new MemoryStream();
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }

        static Image logo;
        /// <summary>L'icône du site, en PNG (plus nette que l'.ico à grande taille).</summary>
        public static Image Logo
        {
            get
            {
                if (logo == null)
                {
                    var bytes = Resource("icon.png");
                    logo = bytes != null ? Image.FromStream(new MemoryStream(bytes)) : null;
                }
                return logo;
            }
        }

        // --- Les icônes Lucide, recolorées ------------------------------------
        static readonly Dictionary<string, Image> Glyphs = new Dictionary<string, Image>();

        /// <summary>Une icône Lucide (assets/glyphs) dans la couleur voulue.</summary>
        public static Image Glyph(string name, Color color)
        {
            var key = name + "|" + color.ToArgb();
            Image img;
            if (Glyphs.TryGetValue(key, out img)) return img;
            var bytes = Resource("glyph." + name + ".png");
            if (bytes == null) return null;
            using (var src = Image.FromStream(new MemoryStream(bytes)))
            {
                var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
                // Le blanc devient la couleur voulue ; la transparence reste.
                var cm = new ColorMatrix(new[]
                {
                    new float[] { 0, 0, 0, 0, 0 },
                    new float[] { 0, 0, 0, 0, 0 },
                    new float[] { 0, 0, 0, 0, 0 },
                    new float[] { 0, 0, 0, color.A / 255f, 0 },
                    new float[] { color.R / 255f, color.G / 255f, color.B / 255f, 0, 1 },
                });
                using (var ia = new ImageAttributes())
                using (var g = Graphics.FromImage(bmp))
                {
                    ia.SetColorMatrix(cm);
                    g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, ia);
                }
                Glyphs[key] = bmp;
                return bmp;
            }
        }

        // --- Dessin -----------------------------------------------------------
        public static void Prepare(Graphics g, float scale)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.ScaleTransform(scale, scale);
        }

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0.5f)
            {
                p.AddRectangle(r);
                return p;
            }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Fill(Graphics g, RectangleF r, float radius, Color color)
        {
            using (var p = Round(r, radius))
            using (var b = new SolidBrush(color))
                g.FillPath(b, p);
        }

        public static void Stroke(Graphics g, RectangleF r, float radius, Color color, float width)
        {
            float h = width / 2;
            using (var p = Round(new RectangleF(r.X + h, r.Y + h, r.Width - width, r.Height - width), radius))
            using (var pen = new Pen(color, width))
                g.DrawPath(pen, p);
        }

        /// <summary>Une image dans un cadre arrondi, recadrée pour le remplir.</summary>
        public static void Picture(Graphics g, Image img, RectangleF r, float radius)
        {
            var state = g.Save();
            using (var p = Round(r, radius))
            {
                g.SetClip(p, CombineMode.Intersect); // croisé avec le masque en cours (liste qui défile)
                float ratio = Math.Max(r.Width / img.Width, r.Height / img.Height);
                float w = img.Width * ratio, h = img.Height * ratio;
                g.DrawImage(img, r.X + (r.Width - w) / 2, r.Y + (r.Height - h) / 2, w, h);
            }
            g.Restore(state);
        }

        static readonly StringFormat Left = Format(StringAlignment.Near);
        static readonly StringFormat Center = Format(StringAlignment.Center);
        static readonly StringFormat Right = Format(StringAlignment.Far);

        // Typographique : sans la marge que GDI+ ajoute autour du texte, pour
        // que ce qui est mesuré (Width) soit ce qui est dessiné.
        static StringFormat Format(StringAlignment align)
        {
            var f = (StringFormat)StringFormat.GenericTypographic.Clone();
            f.FormatFlags |= StringFormatFlags.NoWrap;
            f.Alignment = align;
            f.LineAlignment = StringAlignment.Center;
            f.Trimming = StringTrimming.EllipsisCharacter;
            return f;
        }

        /// <summary>Une ligne de texte, coupée d'une ellipse si elle déborde.</summary>
        public static void Text1(Graphics g, string text, Font font, Color color, RectangleF r, StringAlignment align = StringAlignment.Near)
        {
            using (var b = new SolidBrush(color))
                g.DrawString(text ?? "", font, b, r, align == StringAlignment.Center ? Center : align == StringAlignment.Far ? Right : Left);
        }

        /// <summary>Un paragraphe qui passe à la ligne dans sa boîte.</summary>
        public static void Paragraph(Graphics g, string text, Font font, Color color, RectangleF r, StringAlignment align = StringAlignment.Near)
        {
            using (var b = new SolidBrush(color))
            using (var f = (StringFormat)StringFormat.GenericTypographic.Clone())
            {
                f.Alignment = align;
                f.LineAlignment = StringAlignment.Near;
                f.Trimming = StringTrimming.EllipsisWord;
                g.DrawString(text ?? "", font, b, r, f);
            }
        }

        public static float Width(Graphics g, string text, Font font)
        {
            return g.MeasureString(text ?? "", font, int.MaxValue, StringFormat.GenericTypographic).Width;
        }

        public static void Icon(Graphics g, string glyph, Color color, RectangleF r)
        {
            var img = Glyph(glyph, color);
            if (img != null) g.DrawImage(img, r);
        }

        /// <summary>Une icône tournée autour de son centre (la roue de synchro).</summary>
        public static void Icon(Graphics g, string glyph, Color color, RectangleF r, float angle)
        {
            var state = g.Save();
            g.TranslateTransform(r.X + r.Width / 2, r.Y + r.Height / 2);
            g.RotateTransform(angle);
            Icon(g, glyph, color, new RectangleF(-r.Width / 2, -r.Height / 2, r.Width, r.Height));
            g.Restore(state);
        }

        /// <summary>Un mélange de deux couleurs (t = 0 → a, 1 → b).</summary>
        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb(
                (int)(a.A + (b.A - a.A) * t),
                (int)(a.R + (b.R - a.R) * t),
                (int)(a.G + (b.G - a.G) * t),
                (int)(a.B + (b.B - a.B) * t));
        }

        /// <summary>Un rond : l'image recadrée dedans, ou la couleur.</summary>
        public static void Circle(Graphics g, RectangleF r, Color color)
        {
            using (var b = new SolidBrush(color)) g.FillEllipse(b, r);
        }

        public static void CirclePicture(Graphics g, Image img, RectangleF r)
        {
            var state = g.Save();
            using (var p = new GraphicsPath())
            {
                p.AddEllipse(r);
                g.SetClip(p, CombineMode.Intersect); // croisé avec le masque en cours (liste qui défile)
                float ratio = Math.Max(r.Width / img.Width, r.Height / img.Height);
                float w = img.Width * ratio, h = img.Height * ratio;
                g.DrawImage(img, r.X + (r.Width - w) / 2, r.Y + (r.Height - h) / 2, w, h);
            }
            g.Restore(state);
        }

        // --- Fenêtres Windows 11 : barre de titre sombre, coins arrondis -------
        [DllImport("gdi32.dll")]
        static extern IntPtr AddFontMemResourceEx(IntPtr font, uint length, IntPtr reserved, ref uint count);

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("user32.dll")]
        static extern uint GetDpiForWindow(IntPtr hwnd);

        static int ColorRef(Color c)
        {
            return c.R | (c.G << 8) | (c.B << 16);
        }

        /// <summary>
        /// Barre de titre sombre, et sous Windows 11 : de la couleur exacte du
        /// fond (elle se fond dans la fenêtre), bordure discrète, coins arrondis.
        /// </summary>
        public static void DarkChrome(IntPtr hwnd, bool round)
        {
            try
            {
                int on = 1;
                DwmSetWindowAttribute(hwnd, 20, ref on, 4); // mode sombre (Windows 10 20H1+)
                int caption = ColorRef(Bg), text = ColorRef(Soft), border = ColorRef(Border);
                DwmSetWindowAttribute(hwnd, 35, ref caption, 4); // Windows 11 : couleur de la barre
                DwmSetWindowAttribute(hwnd, 36, ref text, 4);
                DwmSetWindowAttribute(hwnd, 34, ref border, 4);
                if (round)
                {
                    int pref = 2;
                    DwmSetWindowAttribute(hwnd, 33, ref pref, 4);
                }
            }
            catch
            {
                // Windows plus ancien : on garde l'apparence par défaut.
            }
        }

        /// <summary>Le facteur d'échelle de l'écran où se trouve la fenêtre (1 = 96 dpi).</summary>
        public static float ScaleOf(IntPtr hwnd)
        {
            try
            {
                uint dpi = GetDpiForWindow(hwnd);
                if (dpi > 0) return dpi / 96f;
            }
            catch
            {
                // Avant Windows 10 1607 : le dpi du système.
            }
            return SystemScale;
        }

        public static float SystemScale
        {
            get
            {
                using (var g = Graphics.FromHwnd(IntPtr.Zero))
                    return g.DpiX / 96f;
            }
        }

        /// <summary>« il y a 3 min », « hier », « il y a 4 j ».</summary>
        public static string Ago(DateTime utc)
        {
            var span = DateTime.UtcNow - utc;
            if (span.TotalMinutes < 1) return "à l'instant";
            if (span.TotalMinutes < 60) return "il y a " + (int)span.TotalMinutes + " min";
            if (span.TotalHours < 24) return "il y a " + (int)span.TotalHours + " h";
            if (span.TotalDays < 2) return "hier";
            if (span.TotalDays < 30) return "il y a " + (int)span.TotalDays + " j";
            return utc.ToLocalTime().ToString("d MMM yyyy", new System.Globalization.CultureInfo("fr-FR"));
        }
    }
}
