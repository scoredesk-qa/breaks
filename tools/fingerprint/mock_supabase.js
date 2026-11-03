/* a stand-in for supabase-js for the browser test: just enough for the fingerprint pages */
(function () {
  const user = window.__USER || {}, now = Date.now();
  const hm = (h, m) => { const d = new Date(now); d.setUTCHours(h, m, 0, 0); return d.toISOString(); };
  const DB = { fp_agents: [{ badge_id: '7', name: 'Zed', active: true, code_hash: 'x' }, { badge_id: '8', name: 'Amal', active: true, code_hash: 'y' }],
    fp_punches: [{ id: 1, badge_id: '7', punched_at: new Date(now - 3 * 3600000).toISOString(), punch_type: null }, { id: 2, badge_id: '8', punched_at: new Date(now - 2 * 3600000).toISOString(), punch_type: null }] };
  window.__RT = []; window.__RPC = []; window.__READS = { punches: 0, agents: 0 };
  const client = () => ({
    auth: {
      async signInWithPassword() { window.__SESSION = { user: { email: user.email || 'a@b.c', app_metadata: user.app_metadata || {} } }; return { error: null }; },
      async getSession() { return { data: { session: window.__SESSION || null } }; }, async signOut() { window.__SESSION = null; },
    },
    from(t) {
      const q = { f: [], t, select() { return q; }, order() { return q; }, range() { return q; }, limit() { return q; },
        gte(c, v) { q.f.push(r => r[c] >= v); return q; }, lt(c, v) { q.f.push(r => r[c] < v); return q; },
        then(res) { if (t === 'fp_punches') window.__READS.punches++; if (t === 'fp_agents') window.__READS.agents++; res({ data: DB[t].filter(r => q.f.every(f => f(r))), error: null }); } };
      return q;
    },
    async rpc(fn, args) {
      window.__RPC.push({ fn, args });
      if (fn === 'fp_agent_view') { if (args.p_code !== '1234') return { data: { ok: false, error: 'bad_code' }, error: null }; return { data: { ok: true, name: 'Zed', punches: DB.fp_punches.filter(p => p.badge_id === args.p_badge).map(p => ({ punched_at: p.punched_at, punch_type: p.punch_type })) }, error: null }; }
      return { data: null, error: null };
    },
    channel() { const c = { on(t, f, cb) { window.__RT.push({ f, cb }); return c; }, subscribe() { return c; } }; return c; }, removeChannel() {},
  });
  window.supabase = { createClient: client };
})();
