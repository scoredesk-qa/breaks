/* shared bits of the two test pages: escaping, the connection panel, the demo tools */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (t, off) => { const d = new Date(t + off * 3600000), p = n => String(n).padStart(2, '0'); return `${d.getUTCHours()}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };   // 3:12:04
const since = secs => { secs = Math.max(0, Math.floor(secs)); const p = n => String(n).padStart(2, '0'); return `${Math.floor(secs / 3600)}:${p(Math.floor(secs % 3600 / 60))}:${p(secs % 60)}`; };
const dayLabel = key => new Date(key + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const ACT = { in: 'Clock in', out: 'Clock out', break_start: 'Break start', break_end: 'Break end' };
function copyText(t, btn) { const done = () => { if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1500); } }; try { navigator.clipboard.writeText(t).then(done, done); } catch (e) { done(); } }

function connPanel(onChange) {
  const c = FPDB.getConn() || {}, live = FPDB.live();
  return `<details class="conn"><summary>${live ? 'Connected to your Supabase project' : 'Using demo data'} · company time UTC${FPDB.getOff() >= 0 ? '+' : ''}${FPDB.getOff()} <span class="mut">(change)</span></summary>
    <div class="card" style="margin-top:8px"><div class="row" style="align-items:flex-end">
      <label class="f" style="flex:2 1 260px">Supabase URL (empty = demo data)<input class="fi" id="cn-url" spellcheck="false" placeholder="https://your-project.supabase.co" value="${esc(c.url || '')}"></label>
      <label class="f" style="flex:3 1 300px">Public (anon) key<input class="fi" id="cn-key" spellcheck="false" placeholder="eyJ…" value="${esc(c.key || '')}"></label>
      <label class="f" style="flex:0 1 130px">Company time UTC+<input class="fi" id="cn-off" type="number" step="0.5" min="-12" max="14" value="${FPDB.getOff()}"></label>
      <button class="btn p" id="cn-save">Save</button></div>
      <p class="mut" style="margin:10px 0 0;font-size:13px">Nothing here is sent anywhere except to the Supabase project you type in. The key stays in this browser. Use the public (anon) key, never a secret one.</p></div></details>`;
}
function connWire(onChange) {
  const b = $('#cn-save'); if (!b) return;
  b.onclick = () => {
    const url = $('#cn-url').value.trim().replace(/\/+$/, ''), key = $('#cn-key').value.trim(), off = Number($('#cn-off').value);
    if (Number.isFinite(off) && off >= -12 && off <= 14) FPDB.setOff(off);
    FPDB.setConn(url && key ? { url, key } : null); onChange();
  };
}
