using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace MyPlayLog.Companion
{
    public class ApiException : Exception
    {
        public int Status;
        public bool Unlinked;
        public ApiException(int status, string message, bool unlinked) : base(message)
        {
            Status = status;
            Unlinked = unlinked;
        }
    }

    /// <summary>
    /// Les quelques appels du compagnon. Le jeton du PC voyage dans
    /// `Authorization: Companion &lt;jeton&gt;` — jamais celui du compte.
    /// </summary>
    public class Api
    {
        static readonly HttpClient Http = CreateClient();
        readonly Config config;

        public Api(Config config)
        {
            this.config = config;
        }

        static HttpClient CreateClient()
        {
            var http = new HttpClient();
            http.Timeout = TimeSpan.FromSeconds(25);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("MyPlayLogCompagnon/1.0");
            return http;
        }

        public Task<Dictionary<string, object>> Get(string path)
        {
            return Send(HttpMethod.Get, path, null);
        }

        public Task<Dictionary<string, object>> Post(string path, object body)
        {
            return Send(HttpMethod.Post, path, body);
        }

        async Task<Dictionary<string, object>> Send(HttpMethod method, string path, object body)
        {
            var json = new JavaScriptSerializer();
            var req = new HttpRequestMessage(method, config.ApiBase + path);
            if (config.Linked) req.Headers.TryAddWithoutValidation("Authorization", "Companion " + config.Token);
            if (body != null)
            {
                req.Content = new StringContent(json.Serialize(body), Encoding.UTF8, "application/json");
            }

            HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
            string text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            Dictionary<string, object> data = null;
            try
            {
                data = json.Deserialize<Dictionary<string, object>>(text);
            }
            catch
            {
                // Une page d'erreur HTML (proxy, maintenance) : pas du JSON.
            }
            if (data == null) data = new Dictionary<string, object>();

            if (!res.IsSuccessStatusCode)
            {
                object err;
                string message = data.TryGetValue("error", out err) && err != null
                    ? err.ToString()
                    : "Erreur " + (int)res.StatusCode;
                object unlinked;
                bool gone = res.StatusCode == HttpStatusCode.Unauthorized
                    && data.TryGetValue("unlinked", out unlinked) && unlinked is bool && (bool)unlinked;
                throw new ApiException((int)res.StatusCode, message, gone);
            }
            return data;
        }

        // --- Petits lecteurs pour les réponses ---------------------------------
        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString() : null;
        }

        public static bool Bool(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v is bool && (bool)v;
        }

        public static IEnumerable<Dictionary<string, object>> List(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v)) yield break;
            var arr = v as System.Collections.ArrayList;
            if (arr == null) yield break;
            foreach (var item in arr)
            {
                var obj = item as Dictionary<string, object>;
                if (obj != null) yield return obj;
            }
        }
    }
}
