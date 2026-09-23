// ======================================================================
//  MyPlayLog Compagnon — point d'entrée
// ======================================================================
//
// Une application de la barre des tâches, rien d'autre : pas de fenêtre au
// démarrage, une icône près de l'horloge. Elle lit les succès que notent les
// émulateurs (jeux hors boutique) et compte le temps de jeu, puis les remonte
// sur le compte MyPlayLog auquel le PC est relié.
//
// ⚠️ C# 5 ET .NET FRAMEWORK 4.8, EXPRÈS. C'est ce que Windows 10 et 11
// embarquent d'office : l'exécutable pèse une centaine de Ko, ne demande
// aucune installation, et se compile avec le compilateur fourni par Windows
// (cf. build.ps1). Pas de `$"..."`, pas de `?.` : ce compilateur-là ne les
// connaît pas.

using System;
using System.Net;
using System.Threading;
using System.Windows.Forms;

namespace MyPlayLog.Companion
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "MyPlayLogCompagnon.SingleInstance", out created))
            {
                // Déjà lancé : une seule icône dans la barre des tâches.
                if (!created) return;

                // TLS 1.2 : le minimum qu'accepte le serveur.
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                var config = Config.Load();
                // `--api http://localhost:4000/api` : pour tester contre un
                // serveur local sans toucher au réglage enregistré.
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (args[i] == "--api") config.ApiBase = args[i + 1].TrimEnd('/');
                }

                Application.Run(new TrayApp(config));
                GC.KeepAlive(mutex);
            }
        }
    }
}
