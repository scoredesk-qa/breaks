import { useState, useEffect, useRef } from "react";
import {
  LogOut, Play, Square, Trash2, Plus, Users, LayoutDashboard,
  Settings, Clock, Eye, EyeOff, RefreshCw, Shield, X, Timer,
  Activity, Coffee, FileDown, CheckCircle2, AlertCircle,
  ChevronRight, UserRound, Zap, TrendingUp, ArrowUpRight
} from "lucide-react";

// ── Seed admin ─────────────────────────────────────────────────────────────────
const SEED_ADMIN = { id: "sa-001", name: "Administrator", email: "admin@company.com", password: "Admin2024!", role: "admin" };

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmt    = d => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtD   = d => new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const pad    = n => String(n).padStart(2, "0");
const tStr   = ms => { const s = Math.floor(ms/1000); return `${pad(Math.floor(s/60))}:${pad(s%60)}`; };
const durStr = ms => {
  if (!ms) return "—";
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  return h > 0 ? `${h}h ${m%60}m ${s%60}s` : m > 0 ? `${m}m ${s%60}s` : `${s}s`;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const initials = name => name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

// ── Storage ────────────────────────────────────────────────────────────────────
const sg = async k => { try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; } catch { return null; } };
const ss = async (k, v) => { try { await window.storage.set(k, JSON.stringify(v), true); } catch {} };

// ── Teams notify ───────────────────────────────────────────────────────────────
async function notifyTeams(webhook, entry) {
  if (!webhook) return;
  const body = {
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
      type: "AdaptiveCard", version: "1.4",
      body: [
        { type: "TextBlock", text: entry.end ? "✅ Break Ended" : "⏸ Break Started", weight: "Bolder", size: "Medium" },
        { type: "FactSet", facts: [
          { title: "Agent",   value: entry.agent },
          { title: "Started", value: fmt(entry.start) },
          { title: "Ended",   value: entry.end ? fmt(entry.end) : "Still on break" },
          { title: "Duration",value: entry.end ? durStr(entry.end - entry.start) : "—" },
        ]}
      ]
    }}]
  };
  try { await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), mode: "no-cors" }); } catch {}
}

// ── Export CSV ─────────────────────────────────────────────────────────────────
function exportCSV(logs) {
  const hdr = "Agent,Date,Break Start,Return Time,Duration,Status\n";
  const rows = logs.map(l =>
    `"${l.agent}","${fmtD(l.start)}","${fmt(l.start)}","${l.end ? fmt(l.end) : ""}","${l.end ? durStr(l.end - l.start) : ""}","${l.end ? "Returned" : "On Break"}"`
  ).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([hdr + rows], { type: "text/csv" }));
  a.download = `break-logs-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ══════════════════════════════════════════════════════════════════════════════
//  ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [session, setSession] = useState(null);
  const [users,   setUsers]   = useState([]);
  const [logs,    setLogs]    = useState([]);
  const [webhook, setWebhook] = useState("");
  const [ready,   setReady]   = useState(false);

  useEffect(() => {
    (async () => {
      let u = await sg("bt_users");
      if (!u?.length) { u = [SEED_ADMIN]; await ss("bt_users", u); }
      setUsers(u);
      setLogs(await sg("bt_logs") || []);
      setWebhook(await sg("bt_webhook") || "");
      setReady(true);
    })();
  }, []);

  const login = (email, password) => {
    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase() && x.password === password);
    if (u) { setSession(u); return null; }
    return "Invalid email or password";
  };
  const logout = () => setSession(null);

  const syncUsers = async u => { setUsers(u); await ss("bt_users", u); };
  const syncLogs  = async l => { setLogs(l);  await ss("bt_logs",  l); };

  if (!ready) return <Splash />;
  if (!session) return <Login onLogin={login} />;
  if (session.role === "admin")
    return <Admin session={session} users={users} syncUsers={syncUsers} logs={logs} syncLogs={syncLogs} webhook={webhook} setWebhook={setWebhook} onLogout={logout} />;
  return <Agent session={session} logs={logs} syncLogs={syncLogs} webhook={webhook} onLogout={logout} />;
}

// ── Splash ─────────────────────────────────────────────────────────────────────
function Splash() {
  return (
    <div className="splash">
      <div className="spinner" />
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  const [show,  setShow]  = useState(false);
  const [err,   setErr]   = useState("");
  const [busy,  setBusy]  = useState(false);

  const submit = () => {
    if (!email || !pass) return;
    setBusy(true);
    setTimeout(() => {
      const e = onLogin(email, pass);
      if (e) { setErr(e); setBusy(false); }
    }, 400);
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="logo-mark"><Zap size={18} strokeWidth={2.5} /></div>
          <span className="logo-text">BreakTrack</span>
        </div>
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">Sign in to your workspace</p>

        <div className="field-group">
          <label className="field-label">Email address</label>
          <input className="field-input" type="email" placeholder="you@company.com"
            value={email} onChange={e => { setEmail(e.target.value); setErr(""); }}
            onKeyDown={e => e.key === "Enter" && submit()} autoFocus />
        </div>
        <div className="field-group">
          <label className="field-label">Password</label>
          <div className="input-wrap">
            <input className="field-input" type={show ? "text" : "password"} placeholder="••••••••"
              value={pass} onChange={e => { setPass(e.target.value); setErr(""); }}
              onKeyDown={e => e.key === "Enter" && submit()} style={{ paddingRight: 44 }} />
            <button className="eye-btn" onClick={() => setShow(!show)}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        {err && (
          <div className="alert-error">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <button className="btn-primary w-full" onClick={submit} disabled={busy || !email || !pass}>
          {busy ? <span className="spinner-sm" /> : "Sign in"}
        </button>

        <div className="login-hint">
          <Shield size={12} /> Default admin: <code>admin@company.com</code> / <code>Admin2024!</code>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  AGENT VIEW
// ══════════════════════════════════════════════════════════════════════════════
function Agent({ session, logs, syncLogs, webhook, onLogout }) {
  const [active,  setActive]  = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const myLogs = logs.filter(l => l.agentId === session.id).sort((a,b) => b.start - a.start);

  useEffect(() => {
    if (active) {
      timerRef.current = setInterval(() => setElapsed(Date.now() - active.start), 1000);
    } else { clearInterval(timerRef.current); setElapsed(0); }
    return () => clearInterval(timerRef.current);
  }, [active]);

  const startBreak = async () => {
    const entry = { id: uid(), agentId: session.id, agent: session.name, start: Date.now(), end: null };
    setActive({ id: entry.id, start: entry.start });
    const next = [entry, ...logs];
    await syncLogs(next);
    await notifyTeams(webhook, entry);
  };

  const endBreak = async () => {
    if (!active) return;
    const endTime = Date.now();
    const next = logs.map(l => l.id === active.id ? { ...l, end: endTime } : l);
    setActive(null);
    await syncLogs(next);
    await notifyTeams(next.find(l => l.id === active.id), webhook);
  };

  return (
    <div className="agent-root">
      {/* Top bar */}
      <header className="agent-header">
        <div className="flex-center gap-8">
          <div className="logo-mark sm"><Zap size={14} strokeWidth={2.5} /></div>
          <span className="logo-text">BreakTrack</span>
        </div>
        <div className="flex-center gap-10">
          <div className="avatar-sm">{initials(session.name)}</div>
          <span className="header-name">{session.name}</span>
          <button className="icon-btn" onClick={onLogout} title="Sign out"><LogOut size={15} /></button>
        </div>
      </header>

      <div className="agent-body">
        {/* Break Control Card */}
        <div className="break-card">
          <div className="break-card-top">
            <div className={`pulse-ring ${active ? "active" : ""}`}>
              <div className={`break-icon-wrap ${active ? "on" : ""}`}>
                {active ? <Timer size={28} strokeWidth={1.5} /> : <Coffee size={28} strokeWidth={1.5} />}
              </div>
            </div>
            {active ? (
              <>
                <div className="timer-display">{tStr(elapsed)}</div>
                <div className="timer-label">Currently on break</div>
                <div className="timer-since">Started at {fmt(active.start)}</div>
              </>
            ) : (
              <>
                <div className="idle-label">Ready to take a break?</div>
                <div className="idle-sub">Your break time will be recorded</div>
              </>
            )}
          </div>
          <div className="break-card-btns">
            {!active
              ? <button className="btn-start" onClick={startBreak}><Play size={16} strokeWidth={2.5} /> Start Break</button>
              : <button className="btn-stop"  onClick={endBreak}><Square size={16} strokeWidth={2.5} fill="currentColor" /> Return from Break</button>
            }
          </div>
        </div>

        {/* My History */}
        <div className="section-card">
          <div className="section-header">
            <Clock size={15} className="section-icon" />
            <h2 className="section-title">My Break History</h2>
          </div>
          {myLogs.length === 0
            ? <div className="empty-state"><Coffee size={32} className="empty-icon" /><p>No breaks logged yet</p></div>
            : (
              <table className="data-table">
                <thead><tr>
                  <th>Date</th><th>Start Time</th><th>Return Time</th><th>Duration</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {myLogs.map(l => (
                    <tr key={l.id}>
                      <td>{fmtD(l.start)}</td>
                      <td>{fmt(l.start)}</td>
                      <td>{l.end ? fmt(l.end) : "—"}</td>
                      <td>{l.end ? durStr(l.end - l.start) : "—"}</td>
                      <td><StatusBadge done={!!l.end} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN VIEW
// ══════════════════════════════════════════════════════════════════════════════
function Admin({ session, users, syncUsers, logs, syncLogs, webhook, setWebhook, onLogout }) {
  const [tab, setTab] = useState("dashboard");

  const agents = users.filter(u => u.role === "agent");
  const active  = logs.filter(l => !l.end);
  const done    = logs.filter(l => l.end);
  const avgMs   = done.length ? done.reduce((s,l) => s + (l.end - l.start), 0) / done.length : 0;

  const navItems = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { id: "logs",      icon: Clock,           label: "Break Logs" },
    { id: "users",     icon: Users,           label: "Users"      },
    { id: "settings",  icon: Settings,        label: "Settings"   },
  ];

  return (
    <div className="admin-root">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-mark sm"><Zap size={14} strokeWidth={2.5} /></div>
          <span className="logo-text">BreakTrack</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(({ id, icon: Icon, label }) => (
            <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              <Icon size={16} strokeWidth={1.8} />
              <span>{label}</span>
              {tab === id && <ChevronRight size={14} className="nav-arrow" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar-sm">{initials(session.name)}</div>
          <div className="sidebar-user">
            <span className="sidebar-name">{session.name}</span>
            <span className="sidebar-role">Administrator</span>
          </div>
          <button className="icon-btn" onClick={onLogout} title="Sign out"><LogOut size={15} /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="admin-main">
        {tab === "dashboard" && (
          <AdminDashboard logs={logs} users={users} active={active} done={done} avgMs={avgMs} agents={agents} />
        )}
        {tab === "logs" && (
          <AdminLogs logs={logs} syncLogs={syncLogs} />
        )}
        {tab === "users" && (
          <AdminUsers users={users} syncUsers={syncUsers} session={session} />
        )}
        {tab === "settings" && (
          <AdminSettings webhook={webhook} setWebhook={setWebhook} />
        )}
      </main>
    </div>
  );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────
function AdminDashboard({ logs, users, active, done, avgMs, agents }) {
  const today = logs.filter(l => new Date(l.start).toDateString() === new Date().toDateString());

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h1 className="panel-title">Dashboard</h1>
          <p className="panel-sub">Live overview of agent breaks</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon={Activity}       label="Total Breaks"    value={logs.length}           accent={false} />
        <StatCard icon={Timer}          label="Active Now"      value={active.length}          accent={!!active.length} />
        <StatCard icon={TrendingUp}     label="Breaks Today"    value={today.length}           accent={false} />
        <StatCard icon={Clock}          label="Avg Duration"    value={avgMs ? tStr(avgMs) : "—"} accent={false} />
      </div>

      {active.length > 0 && (
        <div className="section-card mt-20">
          <div className="section-header">
            <span className="live-dot" />
            <h2 className="section-title">Currently on Break</h2>
          </div>
          <table className="data-table">
            <thead><tr><th>Agent</th><th>Break Started</th><th>Elapsed</th></tr></thead>
            <tbody>
              {active.map(l => (
                <tr key={l.id}>
                  <td><AvatarCell name={l.agent} /></td>
                  <td>{fmt(l.start)}</td>
                  <td><LiveElapsed start={l.start} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-card mt-20">
        <div className="section-header">
          <Clock size={15} className="section-icon" />
          <h2 className="section-title">Recent Breaks</h2>
        </div>
        {logs.length === 0
          ? <div className="empty-state"><Coffee size={32} className="empty-icon" /><p>No breaks recorded yet</p></div>
          : (
            <table className="data-table">
              <thead><tr><th>Agent</th><th>Date</th><th>Start</th><th>Return</th><th>Duration</th><th>Status</th></tr></thead>
              <tbody>
                {[...logs].sort((a,b) => b.start - a.start).slice(0, 10).map(l => (
                  <tr key={l.id}>
                    <td><AvatarCell name={l.agent} /></td>
                    <td>{fmtD(l.start)}</td>
                    <td>{fmt(l.start)}</td>
                    <td>{l.end ? fmt(l.end) : "—"}</td>
                    <td>{l.end ? durStr(l.end - l.start) : "—"}</td>
                    <td><StatusBadge done={!!l.end} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}

// ── Admin Logs ─────────────────────────────────────────────────────────────────
function AdminLogs({ logs, syncLogs }) {
  const [filter,  setFilter]  = useState("");
  const [confirm, setConfirm] = useState(null);

  const filtered = [...logs]
    .sort((a,b) => b.start - a.start)
    .filter(l => !filter || l.agent.toLowerCase().includes(filter.toLowerCase()));

  const deleteEntry = async id => {
    await syncLogs(logs.filter(l => l.id !== id));
    setConfirm(null);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h1 className="panel-title">Break Logs</h1>
          <p className="panel-sub">{logs.length} total entries</p>
        </div>
        <div className="flex-center gap-10">
          <input className="search-input" placeholder="Filter by agent…" value={filter} onChange={e => setFilter(e.target.value)} />
          <button className="btn-secondary" onClick={() => exportCSV(logs)}>
            <FileDown size={15} /> Export CSV
          </button>
        </div>
      </div>

      {filtered.length === 0
        ? <div className="empty-state"><Coffee size={32} className="empty-icon" /><p>No entries found</p></div>
        : (
          <table className="data-table">
            <thead><tr><th>Agent</th><th>Date</th><th>Break Start</th><th>Return Time</th><th>Duration</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id}>
                  <td><AvatarCell name={l.agent} /></td>
                  <td>{fmtD(l.start)}</td>
                  <td>{fmt(l.start)}</td>
                  <td>{l.end ? fmt(l.end) : "—"}</td>
                  <td>{l.end ? durStr(l.end - l.start) : "—"}</td>
                  <td><StatusBadge done={!!l.end} /></td>
                  <td>
                    {confirm === l.id
                      ? (
                        <div className="flex-center gap-6">
                          <button className="icon-btn danger" onClick={() => deleteEntry(l.id)}><CheckCircle2 size={14} /></button>
                          <button className="icon-btn" onClick={() => setConfirm(null)}><X size={14} /></button>
                        </div>
                      )
                      : <button className="icon-btn muted" onClick={() => setConfirm(l.id)} title="Delete"><Trash2 size={14} /></button>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ── Admin Users ────────────────────────────────────────────────────────────────
function AdminUsers({ users, syncUsers, session }) {
  const [modal,  setModal]  = useState(false);
  const [form,   setForm]   = useState({ name: "", email: "", password: "", role: "agent" });
  const [err,    setErr]    = useState("");
  const [show,   setShow]   = useState(false);
  const [delId,  setDelId]  = useState(null);

  const saveUser = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) { setErr("All fields are required."); return; }
    if (users.find(u => u.email.toLowerCase() === form.email.toLowerCase())) { setErr("Email already exists."); return; }
    const next = [...users, { id: uid(), ...form, name: form.name.trim(), email: form.email.trim() }];
    await syncUsers(next);
    setModal(false); setForm({ name: "", email: "", password: "", role: "agent" }); setErr("");
  };

  const deleteUser = async id => {
    await syncUsers(users.filter(u => u.id !== id));
    setDelId(null);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h1 className="panel-title">Users</h1>
          <p className="panel-sub">{users.length} accounts · {users.filter(u => u.role === "agent").length} agents</p>
        </div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={15} /> Add User</button>
      </div>

      <table className="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td><AvatarCell name={u.name} /></td>
              <td style={{ color: "var(--muted)", fontSize: 13 }}>{u.email}</td>
              <td><RoleBadge role={u.role} /></td>
              <td>
                {u.id !== session.id && (
                  delId === u.id
                    ? (
                      <div className="flex-center gap-6">
                        <button className="icon-btn danger" onClick={() => deleteUser(u.id)}><CheckCircle2 size={14} /></button>
                        <button className="icon-btn" onClick={() => setDelId(null)}><X size={14} /></button>
                      </div>
                    )
                    : <button className="icon-btn muted" onClick={() => setDelId(u.id)} title="Delete user"><Trash2 size={14} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && (
        <Modal title="Add New User" onClose={() => { setModal(false); setErr(""); }}>
          <div className="field-group">
            <label className="field-label">Full Name</label>
            <input className="field-input" placeholder="Jane Smith" value={form.name} onChange={e => { setForm({...form, name: e.target.value}); setErr(""); }} />
          </div>
          <div className="field-group">
            <label className="field-label">Email Address</label>
            <input className="field-input" type="email" placeholder="jane@company.com" value={form.email} onChange={e => { setForm({...form, email: e.target.value}); setErr(""); }} />
          </div>
          <div className="field-group">
            <label className="field-label">Password</label>
            <div className="input-wrap">
              <input className="field-input" type={show ? "text" : "password"} placeholder="Set a password" value={form.password} onChange={e => { setForm({...form, password: e.target.value}); setErr(""); }} style={{ paddingRight: 44 }} />
              <button className="eye-btn" onClick={() => setShow(!show)}>{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">Role</label>
            <select className="field-input" value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {err && <div className="alert-error"><AlertCircle size={14} /> {err}</div>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => { setModal(false); setErr(""); }}>Cancel</button>
            <button className="btn-primary" onClick={saveUser}>Create User</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Admin Settings ─────────────────────────────────────────────────────────────
function AdminSettings({ webhook, setWebhook }) {
  const [val,   setVal]   = useState(webhook);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setWebhook(val);
    await ss("bt_webhook", val);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h1 className="panel-title">Settings</h1>
          <p className="panel-sub">Configure integrations and preferences</p>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-heading">Microsoft Teams Webhook</h2>
        <p className="settings-desc">
          Break events are posted to your Teams channel automatically. Paste your incoming webhook URL below.
        </p>
        <div className="field-group">
          <label className="field-label">Webhook URL</label>
          <input className="field-input mono" placeholder="https://your-org.webhook.office.com/webhookb2/…"
            value={val} onChange={e => { setVal(e.target.value); setSaved(false); }} />
        </div>
        <div className="flex-center gap-10 mt-12">
          <button className="btn-primary" onClick={save}>Save Webhook</button>
          {saved && <span className="saved-badge"><CheckCircle2 size={14} /> Saved</span>}
        </div>
        <div className="info-box mt-20">
          <p style={{ fontWeight: 600, marginBottom: 8 }}>How to create a webhook:</p>
          <ol className="info-list">
            <li>Open the target Teams channel → click ···</li>
            <li>Connectors → Incoming Webhook → Configure</li>
            <li>Name it "BreakTrack", click Create, copy the URL</li>
          </ol>
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: 32 }}>
        <h2 className="settings-heading">Admin Credentials</h2>
        <p className="settings-desc">
          The default admin account is seeded automatically. Add additional admins via the Users tab and delete the default once set up.
        </p>
        <div className="info-box">
          <span className="mono" style={{ fontSize: 13 }}>admin@company.com</span>
          <span style={{ margin: "0 8px", color: "var(--muted)" }}>/</span>
          <span className="mono" style={{ fontSize: 13 }}>Admin2024!</span>
        </div>
      </div>
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-icon-wrap"><Icon size={16} strokeWidth={1.8} /></div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function StatusBadge({ done }) {
  return <span className={`badge ${done ? "badge-done" : "badge-active"}`}>{done ? "Returned" : "On Break"}</span>;
}

function RoleBadge({ role }) {
  return <span className={`badge ${role === "admin" ? "badge-admin" : "badge-agent"}`}>{role}</span>;
}

function AvatarCell({ name }) {
  return (
    <div className="flex-center gap-10">
      <div className="avatar-sm">{initials(name)}</div>
      <span>{name}</span>
    </div>
  );
}

function LiveElapsed({ start }) {
  const [e, setE] = useState(Date.now() - start);
  useEffect(() => { const id = setInterval(() => setE(Date.now() - start), 1000); return () => clearInterval(id); }, [start]);
  return <span className="mono accent-text">{tStr(e)}</span>;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  GLOBAL CSS
// ══════════════════════════════════════════════════════════════════════════════
const _css = document.createElement("style");
_css.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0d0d0d;
    --surface:  #171717;
    --card:     #1c1c1c;
    --border:   #2d2d2d;
    --accent:   #3ECF8E;
    --acc-dim:  rgba(62,207,142,0.10);
    --acc-ring: rgba(62,207,142,0.20);
    --text:     #eeeeee;
    --muted:    #888888;
    --danger:   #f05252;
    --danger-dim: rgba(240,82,82,0.10);
    --yellow:   #eab308;
    --font:     'Manrope', sans-serif;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; }

  /* ── Splash ── */
  .splash { display:flex; align-items:center; justify-content:center; min-height:100vh; background:var(--bg); }
  .spinner { width:28px; height:28px; border:2.5px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin .7s linear infinite; }
  .spinner-sm { width:16px; height:16px; border:2px solid rgba(0,0,0,0.2); border-top-color:#000; border-radius:50%; animation:spin .7s linear infinite; display:inline-block; }
  @keyframes spin { to { transform:rotate(360deg); } }

  /* ── Login ── */
  .login-bg { min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); padding:20px; background-image: radial-gradient(ellipse 60% 40% at 50% 0%, rgba(62,207,142,0.07) 0%, transparent 70%); }
  .login-card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:40px 36px; width:100%; max-width:400px; box-shadow:0 32px 80px rgba(0,0,0,0.5); }
  .login-logo { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
  .login-title { font-size:22px; font-weight:800; letter-spacing:-.5px; margin-bottom:6px; }
  .login-sub { color:var(--muted); font-size:13px; margin-bottom:28px; }
  .login-hint { margin-top:20px; font-size:11px; color:var(--muted); display:flex; align-items:center; gap:6px; line-height:1.6; }
  .login-hint code { background:var(--card); padding:1px 5px; border-radius:4px; font-size:11px; color:var(--accent); }

  /* ── Logo ── */
  .logo-mark { background:var(--accent); color:#000; border-radius:8px; display:flex; align-items:center; justify-content:center; width:30px; height:30px; flex-shrink:0; }
  .logo-mark.sm { width:24px; height:24px; border-radius:6px; }
  .logo-text { font-size:16px; font-weight:800; letter-spacing:-.3px; }

  /* ── Fields ── */
  .field-group { display:flex; flex-direction:column; gap:6px; margin-bottom:16px; }
  .field-label { font-size:12px; font-weight:600; color:var(--muted); letter-spacing:.3px; text-transform:uppercase; }
  .field-input { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:10px 14px; color:var(--text); font-size:14px; font-family:var(--font); outline:none; transition:border .18s, box-shadow .18s; width:100%; }
  .field-input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--acc-ring); }
  .field-input::placeholder { color:#3a3a3a; }
  .field-input option { background:var(--card); }
  .input-wrap { position:relative; }
  .eye-btn { position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--muted); cursor:pointer; display:flex; padding:4px; }
  .eye-btn:hover { color:var(--text); }

  /* ── Buttons ── */
  .btn-primary { background:var(--accent); color:#000; border:none; border-radius:8px; padding:10px 18px; font-size:14px; font-weight:700; font-family:var(--font); cursor:pointer; display:inline-flex; align-items:center; gap:7px; transition:opacity .15s, transform .12s; white-space:nowrap; }
  .btn-primary:hover:not(:disabled) { opacity:.88; transform:translateY(-1px); }
  .btn-primary:disabled { opacity:.4; cursor:not-allowed; }
  .btn-primary.w-full { width:100%; justify-content:center; margin-top:4px; }
  .btn-secondary { background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; font-family:var(--font); cursor:pointer; display:inline-flex; align-items:center; gap:7px; transition:border-color .15s; white-space:nowrap; }
  .btn-secondary:hover { border-color:var(--accent); }
  .icon-btn { background:none; border:1px solid transparent; border-radius:6px; color:var(--muted); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; padding:6px; transition:color .15s, background .15s; }
  .icon-btn:hover { color:var(--text); background:var(--card); }
  .icon-btn.danger:hover { color:var(--danger); }
  .icon-btn.muted { opacity:.5; } .icon-btn.muted:hover { opacity:1; }

  /* ── Alert ── */
  .alert-error { display:flex; align-items:center; gap:7px; color:var(--danger); font-size:13px; background:var(--danger-dim); border:1px solid rgba(240,82,82,0.2); border-radius:8px; padding:9px 12px; margin-bottom:12px; }

  /* ── Agent layout ── */
  .agent-root { min-height:100vh; display:flex; flex-direction:column; background:var(--bg); }
  .agent-header { background:var(--surface); border-bottom:1px solid var(--border); padding:0 24px; height:54px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:10; }
  .agent-body { flex:1; max-width:700px; margin:0 auto; width:100%; padding:32px 20px; display:flex; flex-direction:column; gap:24px; }

  /* ── Break card ── */
  .break-card { background:var(--surface); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  .break-card-top { padding:48px 32px 32px; display:flex; flex-direction:column; align-items:center; gap:16px; text-align:center; }
  .break-card-btns { border-top:1px solid var(--border); padding:20px 32px; display:flex; justify-content:center; }
  .pulse-ring { padding:12px; border-radius:50%; background:var(--card); border:2px solid var(--border); transition:all .3s; }
  .pulse-ring.active { background:var(--acc-dim); border-color:var(--acc-ring); animation:pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 var(--acc-ring)} 50%{box-shadow:0 0 0 12px transparent} }
  .break-icon-wrap { color:var(--muted); transition:color .3s; }
  .break-icon-wrap.on { color:var(--accent); }
  .timer-display { font-size:52px; font-weight:800; letter-spacing:-2px; color:var(--accent); font-variant-numeric:tabular-nums; }
  .timer-label { font-size:14px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
  .timer-since { font-size:13px; color:var(--muted); }
  .idle-label { font-size:18px; font-weight:700; color:var(--text); }
  .idle-sub { font-size:13px; color:var(--muted); }
  .btn-start { background:var(--accent); color:#000; border:none; border-radius:10px; padding:13px 36px; font-size:15px; font-weight:700; font-family:var(--font); cursor:pointer; display:flex; align-items:center; gap:8px; transition:opacity .15s, transform .12s; }
  .btn-start:hover { opacity:.88; transform:translateY(-1px); }
  .btn-stop { background:var(--danger-dim); color:var(--danger); border:1px solid rgba(240,82,82,0.25); border-radius:10px; padding:13px 36px; font-size:15px; font-weight:700; font-family:var(--font); cursor:pointer; display:flex; align-items:center; gap:8px; transition:all .15s; }
  .btn-stop:hover { background:rgba(240,82,82,0.2); }

  /* ── Section card ── */
  .section-card { background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden; }
  .section-card.mt-20 { margin-top:20px; }
  .section-header { padding:16px 20px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:8px; }
  .section-title { font-size:13px; font-weight:700; letter-spacing:.2px; }
  .section-icon { color:var(--muted); }
  .live-dot { width:8px; height:8px; border-radius:50%; background:var(--accent); animation:pulse 1.5s ease-in-out infinite; flex-shrink:0; }

  /* ── Admin layout ── */
  .admin-root { display:flex; min-height:100vh; background:var(--bg); }
  .sidebar { width:220px; min-height:100vh; background:var(--surface); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; position:sticky; top:0; height:100vh; }
  .sidebar-logo { padding:18px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:10px; }
  .sidebar-nav { flex:1; padding:12px 8px; display:flex; flex-direction:column; gap:2px; }
  .nav-item { background:none; border:none; border-radius:8px; padding:9px 12px; display:flex; align-items:center; gap:10px; color:var(--muted); font-size:13px; font-weight:600; font-family:var(--font); cursor:pointer; transition:background .15s, color .15s; text-align:left; width:100%; }
  .nav-item:hover { background:var(--card); color:var(--text); }
  .nav-item.active { background:var(--acc-dim); color:var(--accent); }
  .nav-arrow { margin-left:auto; }
  .sidebar-footer { padding:16px; border-top:1px solid var(--border); display:flex; align-items:center; gap:10px; }
  .sidebar-user { flex:1; min-width:0; }
  .sidebar-name { font-size:13px; font-weight:600; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sidebar-role { font-size:11px; color:var(--muted); display:block; }
  .admin-main { flex:1; min-width:0; overflow-x:auto; }

  /* ── Panel ── */
  .panel { padding:28px 32px; }
  .panel-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
  .panel-title { font-size:20px; font-weight:800; letter-spacing:-.4px; }
  .panel-sub { font-size:13px; color:var(--muted); margin-top:3px; }

  /* ── Stats ── */
  .stats-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:8px; }
  .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:20px; display:flex; flex-direction:column; gap:10px; transition:border-color .15s; }
  .stat-card.accent { border-color:var(--acc-ring); background:var(--acc-dim); }
  .stat-icon-wrap { color:var(--muted); }
  .stat-card.accent .stat-icon-wrap { color:var(--accent); }
  .stat-value { font-size:28px; font-weight:800; letter-spacing:-1px; }
  .stat-label { font-size:12px; color:var(--muted); font-weight:500; }

  /* ── Table ── */
  .data-table { width:100%; border-collapse:collapse; font-size:13.5px; }
  .data-table th { text-align:left; padding:11px 16px; font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid var(--border); white-space:nowrap; }
  .data-table td { padding:13px 16px; border-bottom:1px solid #1f1f1f; vertical-align:middle; }
  .data-table tbody tr:last-child td { border-bottom:none; }
  .data-table tbody tr:hover td { background:rgba(255,255,255,.02); }

  /* ── Avatar ── */
  .avatar-sm { width:28px; height:28px; border-radius:50%; background:var(--acc-dim); color:var(--accent); font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; border:1px solid var(--acc-ring); }
  .header-name { font-size:13px; font-weight:600; color:var(--muted); }

  /* ── Badges ── */
  .badge { display:inline-flex; align-items:center; font-size:11px; font-weight:700; padding:3px 9px; border-radius:20px; letter-spacing:.2px; }
  .badge-done { background:#0f2b1e; color:#3ECF8E; border:1px solid #1a4030; }
  .badge-active { background:#2b1e00; color:#eab308; border:1px solid #3d2e00; }
  .badge-admin { background:var(--acc-dim); color:var(--accent); border:1px solid var(--acc-ring); }
  .badge-agent { background:var(--card); color:var(--muted); border:1px solid var(--border); }

  /* ── Modal ── */
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px; backdrop-filter:blur(4px); }
  .modal-box { background:var(--surface); border:1px solid var(--border); border-radius:16px; width:100%; max-width:440px; box-shadow:0 32px 80px rgba(0,0,0,.6); animation:slideUp .2s ease; }
  @keyframes slideUp { from{transform:translateY(16px);opacity:0} to{transform:none;opacity:1} }
  .modal-head { display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1px solid var(--border); }
  .modal-title { font-size:15px; font-weight:700; }
  .modal-body { padding:24px; }
  .modal-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }

  /* ── Search ── */
  .search-input { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:8px 14px; color:var(--text); font-size:13px; font-family:var(--font); outline:none; width:200px; transition:border .18s; }
  .search-input:focus { border-color:var(--accent); }
  .search-input::placeholder { color:#3a3a3a; }

  /* ── Settings ── */
  .settings-section { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:24px; }
  .settings-heading { font-size:15px; font-weight:700; margin-bottom:8px; }
  .settings-desc { font-size:13px; color:var(--muted); margin-bottom:20px; line-height:1.6; }
  .info-box { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 18px; font-size:13px; color:var(--muted); }
  .info-list { padding-left:18px; line-height:2; }
  .saved-badge { display:flex; align-items:center; gap:5px; font-size:13px; color:var(--accent); font-weight:600; }

  /* ── Misc ── */
  .flex-center { display:flex; align-items:center; }
  .gap-6 { gap:6px; } .gap-8 { gap:8px; } .gap-10 { gap:10px; }
  .mt-12 { margin-top:12px; } .mt-20 { margin-top:20px; }
  .empty-state { padding:48px 24px; text-align:center; color:var(--muted); display:flex; flex-direction:column; align-items:center; gap:12px; font-size:13px; }
  .empty-icon { opacity:.3; }
  .mono { font-family:'Courier New', monospace; }
  .accent-text { color:var(--accent); }

  @media (max-width:900px) {
    .stats-grid { grid-template-columns:repeat(2,1fr); }
    .sidebar { width:56px; }
    .sidebar-logo span, .sidebar-name, .sidebar-role, .nav-item span, .sidebar-user { display:none; }
    .nav-item { justify-content:center; padding:12px; }
    .nav-arrow { display:none; }
    .sidebar-footer { justify-content:center; padding:12px; }
    .panel { padding:20px 16px; }
  }
`;
document.head.appendChild(_css);
