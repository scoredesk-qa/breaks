/* a stand-in for supabase-js for the browser test: just enough for the fingerprint pages */
(function () {
  const user = window.__USER || {}, now = Date.now();
  const hm = (h, m) => { const d = new Date(now); d.setUTCHours(h, m, 0, 0); return d.toISOString(); };
  const iso = h => new Date(now - h * 3600000).toISOString();
  const DB = { pt_agents: [{ name: 'Zed', active: true, code_hash: 'x' }, { name: 'Amal', active: true, code_hash: 'y' }],
    pt_punches: [{ emp: 7, ts: iso(3), name: 'Zed', kind: 'shift', dir: 'IN' }, { emp: 8, ts: iso(0.2), name: 'Zed', kind: 'break', dir: 'IN' },
                 { emp: 9, ts: iso(2), name: 'Amal', kind: 'shift', dir: 'IN' }, { emp: 10, ts: iso(1), name: 'Newbie', kind: 'shift', dir: 'IN' }] };
  window.__RT = []; window.__RPC = []; window.__READS = { punches: 0, agents: 0 };
  const client = () => ({
    auth: {
      async signInWithPassword() { window.__SESSION = { user: { email: user.email || 'a@b.c', app_metadata: user.app_metadata || {} } }; return { error: null }; },
      async getSession() { return { data: { session: window.__SESSION || null } }; }, async signOut() { window.__SESSION = null; },
    },
    from(t) {
      const q = { f: [], t, select() { return q; }, order() { return q; }, range() { return q; }, limit() { return q; },
        gte(c, v) { q.f.push(r => r[c] >= v); return q; }, lt(c, v) { q.f.push(r => r[c] < v); return q; },
        then(res) { if (t === 'pt_punches') window.__READS.punches++; if (t === 'pt_agents') window.__READS.agents++; res({ data: DB[t].filter(r => q.f.every(f => f(r))), error: null }); } };
      return q;
    },
    async rpc(fn, args) {
      window.__RPC.push({ fn, args });
      if (fn === 'pt_agent_view') { if (args.p_code !== '1234' || args.p_name.toLowerCase() !== 'zed') return { data: { ok: false, error: 'bad_code' }, error: null }; return { data: { ok: true, name: 'Zed', punches: DB.pt_punches.filter(p => p.name === 'Zed').map(p => ({ ts: p.ts, kind: p.kind, dir: p.dir })) }, error: null }; }
      return { data: null, error: null };
    },
    channel() { const c = { on(t, f, cb) { window.__RT.push({ f, cb }); return c; }, subscribe() { return c; } }; return c; }, removeChannel() {},
  });
  window.supabase = { createClient: client };
})();
