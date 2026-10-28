// A tiny in-memory stand-in for the Supabase client, used only to test the page in a browser.
// The test sets window.__DB (tables) and window.__USER (the signed-in user) before the page loads.
(function () {
  let idc = 1000;
  const clone = o => JSON.parse(JSON.stringify(o));
  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.rng = null; this.one = null; this.pl = null; this.conf = null; }
    select() { return this; }
    insert(p) { this.op = 'insert'; this.pl = p; return this; }
    update(p) { this.op = 'update'; this.pl = p; return this; }
    upsert(p, o) { this.op = 'upsert'; this.pl = p; this.conf = (o && o.onConflict) || 'id'; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push(r => r[c] === v || String(r[c]) === String(v)); return this; }
    neq(c, v) { this.f.push(r => r[c] !== v); return this; }
    is(c, v) { this.f.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c, op, v) { if (op === 'is' && v === null) this.f.push(r => r[c] != null); return this; }
    gte(c, v) { this.f.push(r => r[c] != null && r[c] >= v); return this; }
    gt(c, v) { this.f.push(r => r[c] != null && r[c] > v); return this; }
    lte(c, v) { this.f.push(r => r[c] != null && r[c] <= v); return this; }
    lt(c, v) { this.f.push(r => r[c] != null && r[c] < v); return this; }
    in(c, a) { this.f.push(r => a.includes(r[c])); return this; }
    contains(c, v) { this.f.push(r => Array.isArray(r[c]) && v.every(x => r[c].includes(x))); return this; }
    order(c, o) { this.ord = [c, !(o && o.ascending === false)]; return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    then(res, rej) { return Promise.resolve(this.exec()).then(res, rej); }
    exec() {
      const db = window.__DB; const tbl = db[this.t] || (db[this.t] = []);
      const match = r => this.f.every(fn => fn(r));
      let rows;
      if (this.op === 'insert') {
        const list = (Array.isArray(this.pl) ? this.pl : [this.pl]).map(p => Object.assign({ id: ++idc }, clone(p)));
        list.forEach(r => tbl.push(r)); rows = list;
      } else if (this.op === 'update') {
        rows = tbl.filter(match); rows.forEach(r => Object.assign(r, clone(this.pl)));
      } else if (this.op === 'upsert') {
        const list = Array.isArray(this.pl) ? this.pl : [this.pl]; rows = [];
        list.forEach(p => { const k = this.conf; const ex = tbl.find(r => r[k] === p[k]); if (ex) { Object.assign(ex, clone(p)); rows.push(ex); } else { const n = clone(p); tbl.push(n); rows.push(n); } });
      } else if (this.op === 'delete') {
        rows = tbl.filter(match); db[this.t] = tbl.filter(r => !match(r));
      } else {
        rows = tbl.filter(match);
      }
      if (this.ord) { const [c, asc] = this.ord; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim != null) rows = rows.slice(0, this.lim);
      rows = clone(rows);
      if (this.one) { if (!rows.length) return { data: null, error: this.one === 'single' ? { message: 'no rows' } : null }; return { data: rows[0], error: null }; }
      return { data: rows, error: null };
    }
  }
  const chan = () => { const c = { on: () => c, subscribe: cb => { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return c; }, send: async () => 'ok', unsubscribe: () => {} }; return c; };
  const client = {
    from: t => new Q(t),
    rpc: async n => ({ data: n === 'bt_slot_sync' ? (typeof window.__SYNC === 'function' ? window.__SYNC() : (window.__SYNC || { v: 4, ok: true, cron: true })) : null, error: null }),
    channel: () => chan(),
    removeChannel: () => {},
    realtime: { connectionState: () => 'connecting' },
    auth: {
      getSession: async () => ({ data: { session: window.__USER ? { user: window.__USER } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: { user: window.__USER }, error: null }),
      signOut: async () => ({ error: null }),
    },
  };
  window.supabase = { createClient: () => client };
})();
