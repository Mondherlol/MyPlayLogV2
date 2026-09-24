using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// Le menu de l'icône, aux couleurs du compagnon : fond sombre, survol en
    /// pastille arrondie, coches dorées, coins arrondis sous Windows 11.
    /// Les éléments marqués Tag = "head" s'affichent en titre (texte clair
    /// même désactivés), Tag = "danger" rougissent au survol.
    /// </summary>
    public class DarkMenu : ToolStripProfessionalRenderer
    {
        readonly float scale;

        public DarkMenu(float scale) : base(new Palette())
        {
            this.scale = scale;
            RoundedEdges = false;
        }

        /// <summary>Habille un menu : couleurs, police, marges, coins.</summary>
        public static void Apply(ContextMenuStrip menu)
        {
            float s = Theme.SystemScale;
            menu.Renderer = new DarkMenu(s);
            menu.Font = Theme.Body(13.5f * s);
            menu.ShowImageMargin = false;
            menu.ShowCheckMargin = true;
            menu.Padding = new Padding(0, (int)(5 * s), 0, (int)(5 * s));
            menu.HandleCreated += (o, e) => Theme.DarkChrome(menu.Handle, true);
        }

        public static void Style(ToolStripItem item)
        {
            float s = Theme.SystemScale;
            if (item is ToolStripSeparator) return;
            item.Padding = new Padding((int)(2 * s), (int)(6 * s), (int)(10 * s), (int)(6 * s));
        }

        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            using (var b = new SolidBrush(Theme.Surface)) e.Graphics.FillRectangle(b, e.AffectedBounds);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var r = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            using (var pen = new Pen(Theme.Border)) e.Graphics.DrawRectangle(pen, r);
        }

        protected override void OnRenderImageMargin(ToolStripRenderEventArgs e)
        {
            // Même fond que le reste : pas de bande grise à gauche.
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled) return;
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float inset = 5 * scale;
            var r = new RectangleF(inset, 1, e.Item.Width - inset * 2, e.Item.Height - 2);
            Theme.Fill(g, r, 6 * scale, "danger".Equals(e.Item.Tag) ? Theme.Mix(Theme.Surface, Theme.Red, 0.16f) : Theme.Border);
        }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (!e.Item.Enabled)
            {
                // Le rendu de base force le gris système sur un élément
                // désactivé : on dessine nous-mêmes (titre clair, infos grises).
                var color = "head".Equals(e.Item.Tag) ? Theme.Text : Theme.Soft;
                TextRenderer.DrawText(e.Graphics, e.Text, e.TextFont, e.TextRectangle, color, e.TextFormat);
                return;
            }
            e.TextColor = "danger".Equals(e.Item.Tag) && e.Item.Selected ? Theme.Red : Theme.Text;
            base.OnRenderItemText(e);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            var img = Theme.Glyph("check", Theme.Gold);
            if (img == null) return;
            var g = e.Graphics;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            float size = 15 * scale;
            var box = e.ImageRectangle;
            g.DrawImage(img, box.X + (box.Width - size) / 2, box.Y + (box.Height - size) / 2, size, size);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            int y = e.Item.Height / 2;
            int inset = (int)(12 * scale);
            using (var pen = new Pen(Theme.Border)) e.Graphics.DrawLine(pen, inset, y, e.Item.Width - inset, y);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = Theme.Soft;
            base.OnRenderArrow(e);
        }

        class Palette : ProfessionalColorTable
        {
            public override Color ToolStripDropDownBackground { get { return Theme.Surface; } }
            public override Color ImageMarginGradientBegin { get { return Theme.Surface; } }
            public override Color ImageMarginGradientMiddle { get { return Theme.Surface; } }
            public override Color ImageMarginGradientEnd { get { return Theme.Surface; } }
            public override Color MenuBorder { get { return Theme.Border; } }
            public override Color MenuItemBorder { get { return Theme.Surface2; } }
            public override Color MenuItemSelected { get { return Theme.Surface2; } }
            public override Color SeparatorDark { get { return Theme.Border; } }
            public override Color SeparatorLight { get { return Theme.Surface; } }
            public override Color CheckBackground { get { return Theme.Surface; } }
            public override Color CheckSelectedBackground { get { return Theme.Surface2; } }
            public override Color CheckPressedBackground { get { return Theme.Surface2; } }
        }
    }
}
