using System;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MyPlayLog.Companion
{
    /// <summary>
    /// Relier ce PC à un compte : on tape le code à 6 chiffres affiché par
    /// l'app (Réglages › Compagnon PC › Relier un PC). Sombre et sobre, comme
    /// l'app : le doré ne sert qu'au bouton.
    /// </summary>
    public class PairForm : Form
    {
        static readonly Color Bg = Color.FromArgb(0x11, 0x11, 0x14);
        static readonly Color Surface = Color.FromArgb(0x1b, 0x1e, 0x26);
        static readonly Color Soft = Color.FromArgb(0x9a, 0x9d, 0xab);
        static readonly Color Gold = Color.FromArgb(0xf2, 0xb7, 0x0b);
        static readonly Color Ink = Color.FromArgb(0x3b, 0x2a, 0x02);

        readonly Func<string, Task<string>> pair;
        readonly TextBox code;
        readonly Button go;
        readonly Label status;

        public PairForm(Func<string, Task<string>> pair)
        {
            this.pair = pair;
            Text = "Relier MyPlayLog";
            Icon = TrayApp.AppIcon;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(380, 300);
            BackColor = Bg;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10f);
            ShowInTaskbar = true;
            TopMost = true;

            var title = new Label
            {
                Text = "Relier ce PC",
                Font = new Font("Segoe UI Semibold", 17f),
                ForeColor = Color.White,
                AutoSize = true,
                Location = new Point(24, 22),
            };
            var hint = new Label
            {
                Text = "Dans l'app MyPlayLog : Réglages › Compagnon PC ›\nRelier un PC, puis tape le code affiché.",
                ForeColor = Soft,
                AutoSize = true,
                Location = new Point(26, 64),
            };
            code = new TextBox
            {
                Font = new Font("Segoe UI Semibold", 26f),
                TextAlign = HorizontalAlignment.Center,
                MaxLength = 7,
                BackColor = Surface,
                ForeColor = Gold,
                BorderStyle = BorderStyle.FixedSingle,
                Location = new Point(26, 118),
                Width = 328,
            };
            code.KeyPress += (s, e) =>
            {
                if (!char.IsDigit(e.KeyChar) && !char.IsControl(e.KeyChar)) e.Handled = true;
            };
            code.TextChanged += (s, e) =>
            {
                go.Enabled = Digits.Length == 6;
                status.Text = "";
            };
            go = new Button
            {
                Text = "Relier",
                Enabled = false,
                FlatStyle = FlatStyle.Flat,
                BackColor = Gold,
                ForeColor = Ink,
                Font = new Font("Segoe UI Semibold", 11f),
                Location = new Point(26, 196),
                Size = new Size(328, 44),
                Cursor = Cursors.Hand,
            };
            go.FlatAppearance.BorderSize = 0;
            go.Click += async (s, e) => await Submit();
            status = new Label
            {
                ForeColor = Color.FromArgb(0xe0, 0x57, 0x4d),
                AutoSize = false,
                Location = new Point(26, 250),
                Size = new Size(328, 36),
            };
            AcceptButton = go;
            Controls.AddRange(new Control[] { title, hint, code, go, status });
        }

        string Digits
        {
            get { return new string(code.Text.Where(char.IsDigit).ToArray()); }
        }

        async Task Submit()
        {
            if (Digits.Length != 6) return;
            go.Enabled = false;
            go.Text = "Connexion…";
            status.Text = "";
            try
            {
                var error = await pair(Digits);
                if (error == null)
                {
                    DialogResult = DialogResult.OK;
                    Close();
                    return;
                }
                status.Text = error;
            }
            catch (Exception ex)
            {
                status.Text = "Connexion impossible : " + ex.Message;
            }
            go.Text = "Relier";
            go.Enabled = Digits.Length == 6;
        }
    }
}
