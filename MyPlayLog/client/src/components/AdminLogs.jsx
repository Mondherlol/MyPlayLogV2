import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  LogIn,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Users,
  Wifi,
  X,
  Zap,
  ScrollText,
  Server,
  User as UserIcon,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useChat } from "../context/ChatContext";

// ======================================================================
//  Onglet « Logs » du panel Admin — le journal du serveur
// ======================================================================
// Ce qui s'est passé, par qui, quand. Deux vues :
//   Journal          tout ce que le serveur enregistre (lib/audit.js)
//   Messages privés  la modération des MP, réservée au super-admin
//
// LE DIRECT EST LE CŒUR DE LA PAGE. Les nouvelles lignes n'arrivent pas par
// interrogation régulière mais par le flux SSE de la messagerie (évènement
// `adminlog`), déjà ouvert dans l'onglet : elles se posent en tête de liste à
// la seconde où elles se produisent. Le bouton « pause » n'arrête pas le
// serveur, il arrête l'affichage — indispensable pour lire une ligne pendant
// qu'il s'en écrit trente.

const KIND_META = {
  auth: { label: "Connexions", Icon: LogIn },
  presence: { label: "Présence", Icon: Wifi },
  action: { label: "Actions", Icon: Zap },
  message: { label: "Messages", Icon: MessageSquare },
  admin: { label: "Admin", Icon: Shield },
  error: { label: "Erreurs", Icon: AlertTriangle },
  system: { label: "Système", Icon: Server },
};

const RANGES = [
  { key: "15m", label: "15 min" },
  { key: "1h", label: "1 h" },
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 j" },
  { key: "", label: "Tout" },
];

// L'heure à la seconde : dans un journal, deux lignes à la même minute ne
// disent pas laquelle a précédé l'autre.
function stamp(at) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const hms = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return today
    ? hms
    : `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${hms}`;
}

const fmtMs = (ms) =>
  ms == null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// Durée d'une session de présence (« est reparti · 2 h 14 »).
function fmtSpan(ms) {
  if (ms == null) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export default function LogsPanel({ token, isSuper }) {
  const [view, setView] = useState("logs");

  return (
    <section className="admin-card log-panel">
      <div className="admin-card-head">
        <span className="admin-card-icon">
          <ScrollText size={20} />
        </span>
        <div className="admin-card-titles">
          <h2>Journal du serveur</h2>
          <p>
            Tout ce que le serveur enregistre, en direct : arrivées, actions,
            erreurs. Les lectures ne sont pas journalisées — seulement ce qui écrit
            en base ou ce qui échoue.
          </p>
        </div>
        {isSuper && (
          <div className="log-views">
            <button
              className={`log-view clickable ${view === "logs" ? "on" : ""}`}
              onClick={() => setView("logs")}
            >
              <ScrollText size={14} /> Journal
            </button>
            <button
              className={`log-view clickable ${view === "dm" ? "on" : ""}`}
              onClick={() => setView("dm")}
            >
              <MessageSquare size={14} /> Messages privés
            </button>
          </div>
        )}
      </div>

      {view === "dm" && isSuper ? (
        <MessagesView token={token} />
      ) : (
        <JournalView token={token} isSuper={isSuper} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------
//  Le journal
// ----------------------------------------------------------------------
function JournalView({ token, isSuper }) {
  const { subscribe } = useChat();

  const [kinds, setKinds] = useState(() => new Set());
  const [range, setRange] = useState("24h");
  const [q, setQ] = useState("");
  const [user, setUser] = useState("");
  const [live, setLive] = useState(true);

  const [entries, setEntries] = useState(null);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(() => new Set()); // lignes dépliées
  const [pending, setPending] = useState(0); // lignes retenues en pause

  // Le texte tapé ne part pas à chaque touche : on laisse retomber la frappe.
  const [debounced, setDebounced] = useState({ q: "", user: "" });
  useEffect(() => {
    const id = setTimeout(() => setDebounced({ q, user }), 350);
    return () => clearTimeout(id);
  }, [q, user]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (kinds.size) p.set("kind", [...kinds].join(","));
    if (range) p.set("since", range);
    if (debounced.q) p.set("q", debounced.q);
    if (debounced.user) p.set("user", debounced.user);
    return p;
  }, [kinds, range, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/admin/logs?${params.toString()}`, { token });
      setEntries(d.entries || []);
      setCounts(d.counts || {});
      setTotal(d.total || 0);
      setHasMore(!!d.hasMore);
      setPending(0);
      setErr("");
    } catch (e) {
      setErr(e.message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [params, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!entries?.length || more) return;
    setMore(true);
    try {
      const p = new URLSearchParams(params);
      p.set("before", entries[entries.length - 1].at);
      const d = await apiFetch(`/admin/logs?${p.toString()}`, { token });
      setEntries((l) => [...l, ...(d.entries || [])]);
      setHasMore(!!d.hasMore);
    } catch (e) {
      setErr(e.message);
    } finally {
      setMore(false);
    }
  }

  // --- Le direct ---
  // Une ligne qui arrive ne doit apparaître que si elle appartient à la vue
  // courante : sinon filtrer sur « erreurs » laisserait quand même défiler tout
  // le reste. Le test rejoue les mêmes critères que le serveur, en plus simple.
  const fits = useCallback(
    (e) => {
      if (kinds.size && !kinds.has(e.kind)) return false;
      if (debounced.user) {
        const u = debounced.user.toLowerCase();
        const mine =
          e.actor?.username?.toLowerCase() === u ||
          e.actorName?.toLowerCase() === u ||
          e.targetName?.toLowerCase() === u ||
          e.actor?.id === debounced.user ||
          e.target === debounced.user;
        if (!mine) return false;
      }
      if (debounced.q) {
        const needle = debounced.q.toLowerCase();
        const hay = `${e.label} ${e.path} ${e.actorName} ${e.targetName} ${e.ip}`;
        if (!hay.toLowerCase().includes(needle)) return false;
      }
      return true;
    },
    [kinds, debounced]
  );

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe((event, data) => {
      if (event !== "adminlog" || !data?.entry) return;
      const e = data.entry;
      // Le décompte des pastilles bouge même en pause : c'est l'indicateur
      // qu'il se passe quelque chose, il ne doit pas se figer.
      setCounts((c) => ({ ...c, [e.kind]: (c[e.kind] || 0) + 1 }));
      if (!fits(e)) return;
      if (!live) {
        setPending((n) => n + 1);
        return;
      }
      setTotal((t) => t + 1);
      // Plafond dur : un journal en direct qui tourne une nuit entière ne doit
      // pas finir avec 200 000 nœuds dans le DOM.
      setEntries((l) => (l ? [e, ...l].slice(0, 400) : l));
    });
  }, [subscribe, fits, live]);

  function toggleKind(k) {
    setKinds((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function purge() {
    if (
      !window.confirm(
        "Vider tout le journal ? Les lignes sont définitivement perdues (elles s'effacent de toute façon d'elles-mêmes au bout de quelques jours)."
      )
    )
      return;
    try {
      await apiFetch("/admin/logs", { method: "DELETE", token });
      load();
    } catch (e) {
      setErr(e.message);
    }
  }

  const filtered = kinds.size > 0 || !!debounced.q || !!debounced.user;

  return (
    <>
      <div className="log-bar">
        <label className="log-search">
          <Search size={15} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Chercher une action, un chemin, une adresse IP…"
          />
          {q && (
            <button className="log-clear clickable" onClick={() => setQ("")}>
              <X size={13} />
            </button>
          )}
        </label>

        <label className="log-search user">
          <UserIcon size={15} />
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Filtrer par joueur (pseudo)"
          />
          {user && (
            <button className="log-clear clickable" onClick={() => setUser("")}>
              <X size={13} />
            </button>
          )}
        </label>

        <div className="log-ranges">
          {RANGES.map((r) => (
            <button
              key={r.key || "all"}
              className={`log-range clickable ${range === r.key ? "on" : ""}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <button
          className={`log-live clickable ${live ? "on" : ""}`}
          onClick={() => {
            if (!live && pending) load();
            setLive((v) => !v);
          }}
          title={live ? "Mettre le direct en pause" : "Reprendre le direct"}
        >
          {live ? <Pause size={14} /> : <Play size={14} />}
          {live ? "En direct" : pending ? `${pending} en attente` : "En pause"}
        </button>

        <button className="log-icbtn clickable" onClick={load} title="Rafraîchir">
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
        {isSuper && (
          <button
            className="log-icbtn danger clickable"
            onClick={purge}
            title="Vider le journal"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="log-kinds">
        {Object.entries(KIND_META).map(([key, { label, Icon }]) => (
          <button
            key={key}
            className={`log-kind k-${key} clickable ${kinds.has(key) ? "on" : ""}`}
            onClick={() => toggleKind(key)}
          >
            <Icon size={13} /> {label}
            <em>{counts[key] || 0}</em>
          </button>
        ))}
        {filtered && (
          <button
            className="log-reset clickable"
            onClick={() => {
              setKinds(new Set());
              setQ("");
              setUser("");
            }}
          >
            Tout afficher
          </button>
        )}
        <span className="log-total">
          {total.toLocaleString("fr-FR")} ligne{total > 1 ? "s" : ""}
        </span>
      </div>

      {err && <p className="psn-err">{err}</p>}

      {entries === null ? (
        <div className="log-state">
          <Loader2 size={20} className="spin" /> Lecture du journal…
        </div>
      ) : entries.length === 0 ? (
        <div className="log-state empty">
          <ScrollText size={22} />
          <p>Rien à afficher sur cette période.</p>
        </div>
      ) : (
        <>
          <ul className="log-list">
            {entries.map((e) => (
              <LogRow
                key={e.id}
                entry={e}
                open={open.has(e.id)}
                onToggle={() =>
                  setOpen((s) => {
                    const next = new Set(s);
                    if (next.has(e.id)) next.delete(e.id);
                    else next.add(e.id);
                    return next;
                  })
                }
                onUser={(name) => setUser(name)}
              />
            ))}
          </ul>
          {hasMore && (
            <button className="log-more clickable" onClick={loadMore} disabled={more}>
              {more ? <Loader2 size={15} className="spin" /> : <ChevronDown size={15} />}
              Remonter plus loin
            </button>
          )}
        </>
      )}
    </>
  );
}

function LogRow({ entry: e, open, onToggle, onUser }) {
  const { Icon } = KIND_META[e.kind] || KIND_META.action;
  const name = e.actor?.username || e.actorName || "—";
  const failed = e.status >= 400;
  // La durée d'une session de présence est plus parlante que « 8 100 000 ms ».
  const span = e.kind === "presence" && e.ms != null ? fmtSpan(e.ms) : null;

  return (
    <li className={`log-row k-${e.kind} ${failed ? "failed" : ""} ${open ? "open" : ""}`}>
      {/* La ligne entière déplie le détail — sauf le nom, qui filtre sur son
          auteur. D'où un <div> et non un <button> : un bouton dans un bouton
          n'est pas du HTML valide. */}
      <div
        className="log-main clickable"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="log-time">{stamp(e.at)}</span>
        <span className={`log-badge k-${e.kind}`}>
          <Icon size={12} />
        </span>

        {e.actor ? (
          <button
            type="button"
            className="log-who clickable"
            onClick={(ev) => {
              ev.stopPropagation();
              onUser(name);
            }}
            title={`Ne montrer que ${name}`}
          >
            {e.actor.avatar ? (
              <img src={e.actor.avatar} alt="" loading="lazy" draggable="false" />
            ) : (
              <i>{name[0]?.toUpperCase() || "?"}</i>
            )}
            {name}
          </button>
        ) : (
          <span className="log-who anon">{e.actorName || "serveur"}</span>
        )}

        <span className="log-label">
          {e.label}
          {e.targetName && <b> · {e.targetName}</b>}
          {span && <b> · {span}</b>}
        </span>

        {e.status != null && (
          <span className={`log-status ${failed ? "bad" : ""}`}>{e.status}</span>
        )}
        {e.ms != null && e.kind !== "presence" && (
          <span className="log-ms">{fmtMs(e.ms)}</span>
        )}
      </div>

      {open && (
        <div className="log-detail">
          {e.path && (
            <code>
              {e.method} {e.path}
            </code>
          )}
          <dl>
            {e.ip && (
              <>
                <dt>Adresse</dt>
                <dd>{e.ip}</dd>
              </>
            )}
            {e.actor && (
              <>
                <dt>Compte</dt>
                <dd>
                  <Link to={`/u/${name}`} className="clickable">
                    {name}
                  </Link>{" "}
                  <span className="log-dim">{e.actor.id}</span>
                </dd>
              </>
            )}
            {e.ua && (
              <>
                <dt>Navigateur</dt>
                <dd className="log-ua">{e.ua}</dd>
              </>
            )}
            {e.meta && (
              <>
                <dt>Détail</dt>
                <dd>
                  <pre>{JSON.stringify(e.meta, null, 2)}</pre>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}


// ----------------------------------------------------------------------
//  Les messages privés
// ----------------------------------------------------------------------
// Lire les conversations des autres n'est pas un geste anodin : c'est l'outil
// des situations graves, et le serveur inscrit CHAQUE ouverture de fil dans le
// journal — celui qui regarde est regardé. On le dit ici plutôt que de le
// cacher dans le code.
//
// LA VUE EST CELLE D'UNE MESSAGERIE, pas d'une table de base de données : la
// liste des fils à gauche, la discussion à droite, dans l'ordre où elle s'est
// écrite. Un empilement de lignes plates ne se lit pas — on ne sait ni qui
// répond à qui, ni ce qui s'est dit entre deux phrases, et c'est précisément ce
// qu'on vient chercher quand on modère.
//
// Une seule barre de recherche pour deux choses : les fils (par pseudo ou nom
// de groupe) ET le contenu des messages. Les deux résultats cohabitent dans la
// colonne de gauche ; ouvrir un message trouvé ouvre sa conversation.
function MessagesView({ token }) {
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState(null);
  const [hits, setHits] = useState([]); // messages trouvés par la recherche
  const [activeId, setActiveId] = useState(null);
  const [err, setErr] = useState("");

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 400);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let alive = true;
    setConvs(null);
    const p = new URLSearchParams();
    if (debounced) p.set("q", debounced);
    apiFetch(`/admin/conversations?${p.toString()}`, { token })
      .then((d) => alive && setConvs(d.conversations || []))
      .catch((e) => {
        if (!alive) return;
        setErr(e.message);
        setConvs([]);
      });
    return () => {
      alive = false;
    };
  }, [debounced, token]);

  // La recherche de contenu ne part qu'à partir de deux caractères : en
  // dessous, elle ramènerait la moitié de la base pour rien.
  useEffect(() => {
    if (debounced.length < 2) {
      setHits([]);
      return undefined;
    }
    let alive = true;
    apiFetch(`/admin/messages?q=${encodeURIComponent(debounced)}&limit=40`, { token })
      .then((d) => alive && setHits(d.messages || []))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [debounced, token]);

  return (
    <>
      <p className="log-warn">
        <Shield size={14} /> Ouvrir une discussion inscrit une ligne dans le journal,
        avec les personnes concernées. À réserver à la modération de situations
        graves.
      </p>

      {err && <p className="psn-err">{err}</p>}

      <div className="logdm">
        <aside className="logdm-side">
          <label className="log-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Un pseudo, un groupe, ou des mots du message…"
            />
            {q && (
              <button className="log-clear clickable" onClick={() => setQ("")}>
                <X size={13} />
              </button>
            )}
          </label>

          <div className="logdm-scroll">
            {hits.length > 0 && (
              <>
                <h4 className="logdm-sub">
                  <Search size={12} /> Dans les messages
                </h4>
                <ul className="logdm-hits">
                  {hits.map((m) => (
                    <li key={m.id}>
                      <button
                        className="logdm-hit clickable"
                        onClick={() => setActiveId(m.conversation.id)}
                      >
                        <span className="logdm-hit-top">
                          <b>{m.author?.username || "—"}</b>
                          <span>{stamp(m.at)}</span>
                        </span>
                        <span className="logdm-hit-text">{m.text || "(média)"}</span>
                        <span className="logdm-hit-conv">{m.conversation.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h4 className="logdm-sub">
              <MessageSquare size={12} /> Discussions
            </h4>
            {convs === null ? (
              <div className="log-state" style={{ minHeight: 120 }}>
                <Loader2 size={18} className="spin" />
              </div>
            ) : convs.length === 0 ? (
              <p className="logdm-empty">Aucune discussion.</p>
            ) : (
              <ul className="logdm-convs">
                {convs.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`logdm-conv clickable ${activeId === c.id ? "on" : ""}`}
                      onClick={() => setActiveId(c.id)}
                    >
                      <span className="logdm-faces">
                        {c.people.slice(0, 3).map((p) => (
                          <Face key={p.id} user={p} />
                        ))}
                      </span>
                      <span className="logdm-conv-txt">
                        <b>
                          {c.group && <Users size={11} />} {c.title}
                        </b>
                        <em>
                          {c.lastMessage?.authorName && `${c.lastMessage.authorName} : `}
                          {c.lastMessage?.text || "—"}
                        </em>
                      </span>
                      <span className="logdm-conv-meta">
                        <i>{c.lastMessage?.at ? shortDate(c.lastMessage.at) : ""}</i>
                        <b>{c.messages}</b>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="logdm-thread">
          {activeId ? (
            <Thread key={activeId} id={activeId} token={token} />
          ) : (
            <div className="log-state empty">
              <MessageSquare size={22} />
              <p>Choisis une discussion pour la lire.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Face({ user, size = 24 }) {
  return user.avatar ? (
    <img
      className="logdm-face"
      src={user.avatar}
      alt=""
      title={user.username}
      style={{ width: size, height: size }}
      loading="lazy"
      draggable="false"
    />
  ) : (
    <span
      className="logdm-face letters"
      title={user.username}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {user.username?.[0]?.toUpperCase() || "?"}
    </span>
  );
}

const shortDate = (at) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

function dayLabel(at) {
  const d = new Date(at);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

// Deux messages du même auteur à moins de cinq minutes forment un bloc : on ne
// répète ni la tête ni le nom, exactement comme dans la vraie messagerie.
const GROUP_MS = 5 * 60 * 1000;

// ----------------------------------------------------------------------
//  Un fil, reconstitué
// ----------------------------------------------------------------------
function Thread({ id, token }) {
  const [data, setData] = useState(null);
  const [older, setOlder] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    apiFetch(`/admin/conversations/${id}`, { token })
      .then((d) => {
        if (!alive) return;
        setData(d);
        setErr("");
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [id, token]);

  // Une discussion s'ouvre sur son DERNIER message, comme une vraie messagerie :
  // c'est la fin qui intéresse, pas le premier bonjour d'il y a six mois.
  useEffect(() => {
    if (data && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [data?.conversation?.id]);

  async function loadOlder() {
    if (!data?.messages?.length || older) return;
    setOlder(true);
    const el = box.current;
    const before = el ? el.scrollHeight : 0;
    try {
      const d = await apiFetch(
        `/admin/conversations/${id}?before=${encodeURIComponent(data.messages[0].at)}`,
        { token }
      );
      setData((cur) => ({
        ...cur,
        messages: [...(d.messages || []), ...cur.messages],
        hasMore: !!d.hasMore,
      }));
      // On garde l'œil là où il était : sans ça, charger le passé fait sauter
      // la lecture en arrière de vingt messages.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setOlder(false);
    }
  }

  if (err) return <p className="psn-err">{err}</p>;
  if (!data)
    return (
      <div className="log-state">
        <Loader2 size={20} className="spin" />
      </div>
    );

  const c = data.conversation;
  // Dans un tête-à-tête, chacun son côté : c'est ce qui fait qu'une discussion
  // se lit d'un coup d'œil. Le camp de gauche est le premier participant, choisi
  // une fois pour toutes — un fil ne doit pas changer de sens d'une visite à
  // l'autre. Dans un groupe, tout le monde est à gauche : le lecteur n'est
  // partie prenante d'aucun camp.
  const leftId = c.group ? null : c.people[0]?.id;

  return (
    <>
      <header className="logdm-head">
        <span className="logdm-faces">
          {c.people.slice(0, 4).map((p) => (
            <Face key={p.id} user={p} size={28} />
          ))}
        </span>
        <span className="logdm-head-txt">
          <b>{c.title}</b>
          <em>
            {c.group ? `Groupe · ${c.people.length} membres` : "Tête-à-tête"} ·{" "}
            {c.messages || data.messages.length} message
            {(c.messages || data.messages.length) > 1 ? "s" : ""}
          </em>
        </span>
        {!c.group && c.people[1] && (
          <span className="logdm-legend">
            <i className="left" /> {c.people[0]?.username}
            <i className="right" /> {c.people[1]?.username}
          </span>
        )}
      </header>

      <div className="logdm-box" ref={box}>
        {data.hasMore && (
          <button className="logdm-older clickable" onClick={loadOlder} disabled={older}>
            {older ? <Loader2 size={14} className="spin" /> : <ChevronUp size={14} />}
            Messages plus anciens
          </button>
        )}

        {data.messages.map((m, i) => {
          const prev = data.messages[i - 1];
          const newDay =
            !prev || new Date(m.at).toDateString() !== new Date(prev.at).toDateString();
          const grouped =
            !newDay &&
            !m.system &&
            prev &&
            !prev.system &&
            prev.author?.id === m.author?.id &&
            new Date(m.at) - new Date(prev.at) < GROUP_MS;
          const right = leftId && m.author?.id && m.author.id !== leftId;

          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="logdm-day">
                  <span>{dayLabel(m.at)}</span>
                </div>
              )}
              {m.system ? (
                <div className="logdm-sys">— {m.system} —</div>
              ) : (
                <div
                  className={`logdm-row ${right ? "right" : ""} ${grouped ? "grouped" : ""}`}
                >
                  <span className="logdm-row-av">
                    {!grouped && m.author && <Face user={m.author} size={26} />}
                  </span>
                  <div className="logdm-bubble-wrap">
                    {!grouped && (
                      <span className="logdm-name">
                        {m.author?.username || "compte supprimé"}
                        <i>{stamp(m.at)}</i>
                      </span>
                    )}
                    <div className={`logdm-bubble ${m.deleted ? "gone" : ""}`}>
                      {m.replyTo && (
                        <span className="logdm-quote">
                          <b>{m.replyTo.author || "—"}</b>
                          {m.replyTo.text || "message supprimé"}
                        </span>
                      )}
                      {m.deleted ? (
                        <em>Message supprimé</em>
                      ) : (
                        <>
                          {m.text && <p>{m.text}</p>}
                          {m.media.length > 0 && (
                            <span className="logdm-media">
                              {m.media.map((md, k) => (
                                <a
                                  key={k}
                                  href={md.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="clickable"
                                >
                                  <img src={md.url} alt="" loading="lazy" />
                                </a>
                              ))}
                            </span>
                          )}
                          {m.card && <span className="logdm-card">carte {m.card}</span>}
                          {m.edited && <i className="logdm-edited">modifié</i>}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
