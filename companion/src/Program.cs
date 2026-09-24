// ======================================================================
//  MyPlayLog Compagnon — point d'entrée
// ======================================================================
//
// Une application de la barre des tâches : une icône près de l'horloge, une
// petite fenêtre quand on clique dessus. Elle lit les succès que notent les
// émulateurs (jeux hors boutique) et compte le temps de jeu, puis les remonte
// sur le compte MyPlayLog auquel le PC est relié.
//
// ⚠️ C# 5 ET .NET FRAMEWORK 4.8, EXPRÈS. C'est ce que Windows 10 et 11
// embarquent d'office : l'exécutable ne demande aucune installation, et se
// compile avec le compilateur fourni par Windows (cf. build.ps1). Pas de
// `$"..."`, pas de `?.` : ce compilateur-là ne les connaît pas.
//
// Arguments :
//   --tray          lancé par Windows au démarrage : pas de fenêtre
//   --api <url>     un autre serveur (tests en local)
//   --data <dir>    une autre config (tests) — ne touche ni à la vraie, ni
//                   au démarrage avec Windows

using System;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("MyPlayLog Compagnon")]
[assembly: AssemblyProduct("MyPlayLog Compagnon")]
[assembly: AssemblyDescription("Succès et temps de jeu des jeux hors boutique, remontés sur MyPlayLog")]
[assembly: AssemblyCompany("MyPlayLog")]
[assembly: AssemblyCopyright("MyPlayLog")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace MyPlayLog.Companion
{
    static class Program
    {
        public const string Version = "1.2.0";
        public static string ShowEventName = "MyPlayLogCompagnon.Show";
        public static bool Sandbox;

        [DllImport("user32.dll")]
        static extern bool AllowSetForegroundWindow(int processId);

        [STAThread]
        static void Main(string[] args)
        {
            string mutexName = "MyPlayLogCompagnon.SingleInstance";
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--data")
                {
                    Config.Override = args[i + 1];
                    Sandbox = true;
                    mutexName += ".Sandbox";
                    ShowEventName += ".Sandbox";
                }
            }

            bool created;
            using (var mutex = new Mutex(true, mutexName, out created))
            {
                // Déjà lancé : on demande à l'autre d'ouvrir sa fenêtre.
                if (!created)
                {
                    try
                    {
                        AllowSetForegroundWindow(-1);
                        using (var ev = EventWaitHandle.OpenExisting(ShowEventName)) ev.Set();
                    }
                    catch
                    {
                    }
                    return;
                }

                // TLS 1.2 : le minimum qu'accepte le serveur.
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Theme.Init();

                var config = Config.Load();
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--api") config.ApiBase = args[i + 1].TrimEnd('/');
                }

                Application.Run(new TrayApp(config, args.Contains("--tray")));
                GC.KeepAlive(mutex);
            }
        }
    }
}
