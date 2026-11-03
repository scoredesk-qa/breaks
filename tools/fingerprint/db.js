/* Data layer for the test pages. Two modes behind one interface:
     demo  — made-up agents and punches kept in this browser (shared by the agent and admin pages), with a clock you can move forward
     live  — your Supabase project (tables and functions from fp_setup.sql)
   Needs core.js (FP) and rota.json (FP_ROTA) to be loaded first. */
(function () {
  const H = 3600000, MIN = 60000, CONN_KEY = 'fp_conn', DEMO_KEY = 'fp_demo_v1', COMPANY_OFF = 1;   // the demo story is told on the company clock, UTC+1
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } } };
  const mem = {};

  /* ── settings the user can change on either page ───────────────── */
  const getConn = () => { try { return JSON.parse(store.get(CONN_KEY) || 'null'); } catch (e) { return null; } };
  const setConn = c => store.set(CONN_KEY, c ? JSON.stringify(c) : 'null');
  const live = () => { const c = getConn(); return !!(c && c.url && c.key); };
  const getOff = () => { const n = Number(store.get('fp_off')); return store.get('fp_off') != null && Number.isFinite(n) ? n : COMPANY_OFF; };
  const setOff = n => store.set('fp_off', String(n));

  /* ── demo data ─────────────────────────────────────────────────── */
  const DEMO_AGENTS = [
    { badge_id: '101', name: 'Youness', code: '482913', active: true },
    { badge_id: '102', name: 'Yousra', code: '735018', active: true },
    { badge_id: '103', name: 'Ziad', code: '194627', active: true },
    { badge_id: '104', name: 'Khalil', code: '607351', active: true },
  ];
  const rnd = seed => { let a = 0; for (const c of seed) a = (a * 31 + c.charCodeAt(0)) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const DEMO_NOW_KEY = '2026-11-03', DEMO_NOW_HM = '17:15';
  const atKey = (key, hm, off) => FP.dayStart(key, off) + FP.toMin(hm) * MIN;
  // the rota only starts on 2 Nov; the week before reuses week 1's pattern so there is some history
  const baseRota = FP.rotaLookup(FP_ROTA);
  const rotaFrom = FP_ROTA.weeks[0].start;
  const demoSched = (name, key) => baseRota(name, key) || (key < rotaFrom ? baseRota(name, FP.addDays(key, 7)) : null);
  function demoPunches(off) {
    const out = []; let id = 1; const nowMs = atKey(DEMO_NOW_KEY, DEMO_NOW_HM, off);
    const add = (b, t, type) => { if (t <= nowMs) out.push({ id: id++, badge_id: b, punched_at: new Date(t).toISOString(), punch_type: type || null, device: 'demo' }); };
    for (const a of DEMO_AGENTS) for (let d = -8; d <= 0; d++) {
      const key = FP.addDays(DEMO_NOW_KEY, d), s = demoSched(a.name, key); if (!s) continue;
      const r = rnd(a.badge_id + key), a0 = atKey(key, s.start, off), a1 = atKey(key, s.end, off), L = (a1 - a0) / H;
      if (a.name === 'Khalil' && key === '2026-10-29') continue;                                  // never clocked in
      let tIn = a0 + Math.round(-6 + r() * 16) * MIN, tOut = a1 + Math.round(-3 + r() * 11) * MIN;
      if (a.name === 'Yousra' && key === '2026-11-02') tIn = a0 + 6 * MIN;                            // late
      if (a.name === 'Ziad' && key === '2026-11-03') { tIn = atKey(key, '05:55', off); tOut = atKey(key, '13:34', off); }
      if (a.name === 'Yousra' && key === '2026-11-03') tIn = atKey(key, '15:07', off);
      const br = []; if (L >= 6) br.push([tIn + Math.round(2.5 * 60 + r() * 60) * MIN, 15]); if (L >= 8) br.push([tIn + 5 * H, 30]);
      if (a.name === 'Yousra' && key === '2026-11-03') { br.length = 0; br.push([atKey(key, '17:10', off), null]); }           // on a break right now
      if (a.name === 'Ziad' && key === '2026-11-03') { br.length = 0; br.push([atKey(key, '09:00', off), 15]); }
      add(a.badge_id, tIn);
      for (const [bs, len] of br) { add(a.badge_id, bs); if (len) add(a.badge_id, bs + len * MIN); }
      const stillOn = key === DEMO_NOW_KEY && a1 > nowMs, forgot = a.name === 'Youness' && key === '2026-10-29';
      if (!stillOn && !forgot) add(a.badge_id, tOut);
    }
    out.sort((x, y) => Date.parse(x.punched_at) - Date.parse(y.punched_at)); out.forEach((p, i) => p.id = i + 1);
    return out;
  }

  let demo = null; const listeners = new Set();
  function demoLoad() {
    if (demo) return demo;
    try { demo = JSON.parse(store.get(DEMO_KEY) || 'null'); } catch (e) { demo = null; }
    if (!demo) demoReset(true);
    return demo;
  }
  function demoSave() { store.set(DEMO_KEY, JSON.stringify(demo)); }
  function demoReset(quiet) {
    const off = getOff();
    demo = { skew: atKey(DEMO_NOW_KEY, DEMO_NOW_HM, off) - Date.now(), agents: DEMO_AGENTS.map(a => ({ ...a })), punches: demoPunches(off) };
    demoSave(); if (!quiet) emit();
  }
  const emit = () => listeners.forEach(f => { try { f(); } catch (e) {} });
  if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === DEMO_KEY) { demo = null; emit(); } });

  /* ── live (Supabase) ───────────────────────────────────────────── */
  let sb = null, sbKey = '';
  async function client() {
    const c = getConn(); const k = c.url + '|' + c.key;
    if (sb && sbKey === k) return sb;
    if (!window.supabase) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.52.1/dist/umd/supabase.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Supabase library (are you online?)')); document.head.appendChild(s); });
    sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'fp-admin-auth' } }); sbKey = k; return sb;
  }
  const errMsg = e => (e && (e.message || e.error_description)) || String(e);

  /* ── the interface both pages use ──────────────────────────────── */
  const DB = {
    live, getConn, setConn, getOff, setOff,
    now: () => live() ? Date.now() : demoLoad().skew + Date.now(),
    rota: () => live() ? baseRota : demoSched,      // the demo repeats week 1 of the rota for the week before it, so there is history to look at
    demoAgents: () => demoLoad().agents.map(a => ({ ...a })),

    async agentView(badge, code, fromMs, toMs) {
      if (!live()) {
        const d = demoLoad(), a = d.agents.find(x => x.badge_id === String(badge).trim() && x.active);
        if (!a || a.code !== String(code).trim()) return { ok: false, error: 'bad_code' };
        return { ok: true, name: a.name, punches: d.punches.filter(p => { const t = Date.parse(p.punched_at); return p.badge_id === a.badge_id && t >= fromMs && t < toMs; }).map(p => ({ punched_at: p.punched_at, punch_type: p.punch_type })) };
      }
      const c = await client(); const { data, error } = await c.rpc('fp_agent_view', { p_badge: String(badge).trim(), p_code: String(code).trim(), p_from: new Date(fromMs).toISOString(), p_to: new Date(toMs).toISOString() });
      if (error) return { ok: false, error: 'error', message: errMsg(error) };
      return data;
    },

    async adminSession() {
      if (!live()) { const e = store.get('fp_admin_demo'); return e ? { email: e, isAdmin: true } : null; }
      const c = await client(); const { data } = await c.auth.getSession(); const u = data && data.session && data.session.user;
      return u ? { email: u.email, isAdmin: !!(u.app_metadata && u.app_metadata.fp_admin === true) } : null;
    },
    async adminSignIn(email, pw) {
      if (!live()) { if (String(email).trim().toLowerCase() === 'admin@demo.test' && pw === 'admin123') { store.set('fp_admin_demo', 'admin@demo.test'); return { ok: true }; } return { ok: false, message: 'Wrong email or password.' }; }
      const c = await client(); const { error } = await c.auth.signInWithPassword({ email: String(email).trim(), password: pw });
      return error ? { ok: false, message: errMsg(error) } : { ok: true };
    },
    async adminSignOut() { if (!live()) { store.set('fp_admin_demo', ''); return; } const c = await client(); await c.auth.signOut(); },

    async listAgents() {
      if (!live()) return demoLoad().agents.map(a => ({ badge_id: a.badge_id, name: a.name, active: a.active, has_code: !!a.code }));
      const c = await client(); const { data, error } = await c.from('fp_agents').select('badge_id,name,active,code_hash').order('name');
      if (error) throw new Error(errMsg(error)); return (data || []).map(a => ({ badge_id: a.badge_id, name: a.name, active: a.active, has_code: !!a.code_hash }));
    },
    async listPunches(fromMs, toMs) {
      if (!live()) return demoLoad().punches.filter(p => { const t = Date.parse(p.punched_at); return t >= fromMs && t < toMs; }).map(p => ({ ...p }));
      const c = await client(); let all = [], i = 0, last = false;
      while (!last && i < 60) {
        const { data, error } = await c.from('fp_punches').select('id,badge_id,punched_at,punch_type').gte('punched_at', new Date(fromMs).toISOString()).lt('punched_at', new Date(toMs).toISOString()).order('punched_at', { ascending: true }).range(i * 1000, i * 1000 + 999);
        if (error) throw new Error(errMsg(error)); all = all.concat(data || []); last = !data || data.length < 1000; i++;
      }
      return all;
    },
    async upsertAgent(a) {
      if (!live()) {
        const d = demoLoad(), i = d.agents.findIndex(x => x.badge_id === a.badge_id);
        if (a.code != null && a.code !== '' && !/^[0-9]{4,8}$/.test(a.code)) throw new Error('The code must be 4 to 8 digits');
        const row = { badge_id: a.badge_id, name: a.name, active: a.active !== false, code: (a.code || (i >= 0 ? d.agents[i].code : '')) };
        if (i >= 0) d.agents[i] = row; else d.agents.push(row); demoSave(); emit(); return;
      }
      const c = await client(); const { error } = await c.rpc('fp_upsert_agent', { p_badge: a.badge_id, p_name: a.name, p_code: a.code ? a.code : null, p_active: a.active !== false });
      if (error) throw new Error(errMsg(error));
    },

    // call back whenever a punch arrives. live: Supabase Realtime (instant) + a slow re-read as a safety net; demo: any scan on any open page
    onPunch(cb) {
      if (!live()) { listeners.add(cb); return () => listeners.delete(cb); }
      let ch = null, dead = false, timer = setInterval(cb, 15000);
      client().then(c => { if (dead) return; ch = c.channel('fp-' + Math.random().toString(36).slice(2)).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fp_punches' }, () => cb()).subscribe(); }).catch(() => {});
      return () => { dead = true; clearInterval(timer); if (ch && sb) try { sb.removeChannel(ch); } catch (e) {} };
    },

    /* demo only */
    scan(badge, type) { const d = demoLoad(), t = DB.now(); d.punches.push({ id: d.punches.length + 1, badge_id: String(badge), punched_at: new Date(t).toISOString(), punch_type: type || null, device: 'demo' }); demoSave(); emit(); },
    skip(minutes) { const d = demoLoad(); d.skew += minutes * MIN; demoSave(); emit(); },
    reset() { demoReset(); },
    // the scanner app writes punches to fp_punches itself; this is only for trying the live board from the admin page
    async livePing() { const c = await client(); const { error } = await c.from('fp_punches').select('id').limit(1); return error ? errMsg(error) : ''; },
  };
  window.FPDB = DB;
})();
