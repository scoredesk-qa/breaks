// shared test harness for the app's index.html: a runnable copy (local React/Babel + the stand-in database) and helpers
const fs = require('fs'), path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const MOCK = path.join(__dirname, '..', '3cx', 'page', 'mock_supabase.js');
const TODAY = '2026-10-27', NOW = TODAY + 'T13:10:00.000Z';
const at = hm => TODAY + 'T' + hm + 'Z';

function prepare(built, mods) {
  const work = fs.mkdtempSync(path.join(mods, 'run_'));
  let html = fs.readFileSync(built, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const i = html.findIndex(l => l.includes('unpkg.com/react@'));
  if (i < 0 || !html[i + 3].includes('supabase-js')) throw new Error('CDN script lines not found');
  html.splice(i, 4,
    `<script src="${path.join(mods, 'node_modules/react/umd/react.development.js')}"></script>`,
    `<script src="${path.join(mods, 'node_modules/react-dom/umd/react-dom.development.js')}"></script>`,
    `<script src="${path.join(mods, 'node_modules/@babel/standalone/babel.min.js')}"></script>`,
    `<script src="${MOCK}"></script>`);
  const page = path.join(work, 'app.html'); fs.writeFileSync(page, html.join('\n'));
  return { work, page };
}
const settingsRow = extra => Object.assign({ id: 1, max_concurrent_breaks: 5, lunch_start: 12, slot_schedule: [], slot_tz: 'UTC', trainees: [], trainee_lunch: '12:00', shift_end: '16:30', break_allowance_min: 105, full_shift_hours: 8, cx_config: {} }, extra || {});
const mkdb = (extra = {}) => Object.assign({
  bt_settings: [settingsRow()],
  bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('08:10:00'), clock_out: null, date: TODAY }],
  bt_logs: [
    { id: 11, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('11:00:00'), end_time: at('11:15:00'), duration_secs: 900, break_type: 'Break' },
    { id: 12, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('12:00:00'), end_time: at('12:10:00'), duration_secs: 600, break_type: 'Break' }],
  bt_lunch_schedule: [], bt_swap_requests: [], status_log: [], bt_requests: [], bt_request_msgs: [],
}, extra);
const agent = { id: 'u1', email: 'jane@x.com', user_metadata: { role: 'agent', display_name: 'Jane Doe' } };
const agent2 = { id: 'u2', email: 'sam@x.com', user_metadata: { role: 'agent', display_name: 'Sam Lee' } };
const admin = { id: 'adm', email: 'boss@x.com', user_metadata: { role: 'admin', display_name: 'Boss' } };

async function launch() { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch()); }
function opener(b, page, errs) {
  return async ({ user, db, rpc, now = NOW, w = 1500, h = 1000, theme, side, ls } = {}) => {
    const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: h } });
    const q = await c.newPage(); q.on('pageerror', e => errs.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1,3).join(' ')));
    await q.addInitScript(([u, d, r, th, sd, l]) => {
      window.__USER = u; window.__DB = d; if (r != null) window.__RPC_FN = { cx_team_day: () => r };
      try { if (th) localStorage.setItem('bt_theme', th); if (sd) localStorage.setItem('bt_side', sd); for (const k in (l || {})) localStorage.setItem(k, l[k]); } catch (e) {}
    }, [user, db || mkdb(), rpc, theme || null, side || null, ls || null]);
    await q.clock.setFixedTime(new Date(now));
    await q.goto('file://' + page);
    return q;
  };
}
module.exports = { prepare, mkdb, settingsRow, agent, agent2, admin, launch, opener, TODAY, NOW, at };
