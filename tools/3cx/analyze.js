// 3CX status log analysis: turns the rows written by logger.js (status_log.csv) into
//   - per-agent time per status (Admin, Break, Available, On call, ...)
//   - call counts and talk time per agent
//   - ignored rings (the phone rang, the agent didn't answer)
//   - short calls (possible dropped calls)
//   - break records shaped like the app's bt_logs rows
//   - a list of alerts for the admin
//
// Pure functions, no dependencies and no network. Nothing here is connected to the app yet.

const DEFAULTS = {
  tzOffsetHours: 0,        // UTC offset of the PC that ran the logger (its clock wrote the log's timestamps)
  dayOffsetHours: null,    // UTC offset used to cut the log into days (the app's Settings → Clock); null = same as tzOffsetHours
  shortCallSec: 60,        // a call shorter than this is a possible dropped call
  ignoreRingSec: 10,       // a ring that ends unanswered after at least this long counts as ignored
  takenByOtherSec: 3,      // someone else answered within this many seconds of the ring ending → not ignored
  repeatIgnoreCount: 3,    // this many ignored rings ...
  repeatIgnoreWindowMin: 60, // ... inside this many minutes raises a "repeated" alert
  minBreakSec: 10,         // ignore break blips shorter than this when building break records
  quietCapMin: 30,         // a status with no change keeps running only this long after the log's last row (the logger may have stopped)
  breakToleranceSec: 180,  // break check: an agent's total break time may differ from 3CX by this much before it is flagged
};

const S = { CALL: 'On call', RING: 'Ringing', ADMIN: 'Admin', BREAK: 'Break', OFFLINE: 'Offline' };
// logger.js logs custom 3CX statuses as written, so Lunch / Bathroom / Break all count as breaks
const isBreak = status => /break|lunch|bathroom|toilet/i.test(status || '');

/* ── CSV ─────────────────────────────────────────────────────────── */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.length > 1 || row[0] !== '') rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// "2026-10-27 12:51:57" is written in the logger PC's clock. Convert it to a real instant (ms).
function parseStamp(str, tz) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(str || '');
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - tz * 3600000;
}
function dayRange(day, tz) {                     // [start, end) of a day on the company clock
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(day);
  if (!m) throw new Error('day must look like 2026-10-27');
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]) - tz * 3600000;
  return [start, start + 864e5];
}
function isoLocal(ms, tz) {                      // an instant as "YYYY-MM-DD HH:MM:SS" on the company clock
  return new Date(ms + tz * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}

/* ── rows uploaded by the logger to Supabase ────────────────────── */
// The logger can also post each status change to a Supabase table (status_log: changed_at, extension, agent, old_status,
// new_status, detail). changed_at is a real instant (UTC), so these rows do NOT depend on the logger PC's time zone.
// This turns them into the same rows the CSV gives, written in UTC: analyze them with tzOffsetHours: 0.
function rowsFromStatusLog(rows) {
  return (rows || []).filter(r => r && r.extension && r.extension !== '000' && r.changed_at && Number.isFinite(Date.parse(r.changed_at)))   // 000 = the logger's connection test
    .map(r => ({
      timestamp: new Date(r.changed_at).toISOString().slice(0, 19).replace('T', ' '),
      extension: String(r.extension), agent: r.agent || '', old_status: r.old_status || '', new_status: r.new_status || '', detail: r.detail || '',
    }));
}

/* ── names ───────────────────────────────────────────────────────── */
// 3CX shows "Sghir, Abdulkarim"; the app has "Abdulkarim Sghir". Compare ignoring order, case, accents.
function nameKey(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
}
function displayName(n) {                        // "Sghir, Abdulkarim" -> "Abdulkarim Sghir"
  const s = String(n || '').trim();
  const i = s.indexOf(',');
  return i < 0 ? s : `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.replace(/\s+/g, ' ');
}

/* ── status intervals ────────────────────────────────────────────── */
// Each log row says "this extension is now <new_status>". Turn that into intervals
// {ext, agent, status, detail, start, end}; the last interval of each extension stays open (end = null).
function buildIntervals(rows, opts = {}) {
  const tz = opts.tzOffsetHours ?? DEFAULTS.tzOffsetHours;
  const ev = rows.map(r => ({
    t: parseStamp(r.timestamp, tz), ext: r.extension, agent: r.agent,
    status: r.new_status, detail: r.detail || '', first: !r.old_status,
  })).filter(e => Number.isFinite(e.t) && e.ext && e.status).sort((a, b) => a.t - b.t);

  const out = []; const open = {};
  for (const e of ev) {
    const cur = open[e.ext];
    if (cur && cur.status === e.status) { cur.detail = cur.detail || e.detail; continue; }   // logger restart: same state, keep going
    if (cur) cur.end = e.t;
    // first = the logger had just started and only saw this status; it began earlier, so its length is understated
    const iv = { ext: e.ext, agent: e.agent, status: e.status, detail: e.detail, start: e.t, end: null, partialStart: e.first };
    open[e.ext] = iv; out.push(iv);
  }
  return out;
}

const endOf = (iv, now) => iv.end ?? now;
const secs = (a, b) => Math.max(0, (b - a) / 1000);

/* ── rings and calls ─────────────────────────────────────────────── */
function buildRings(intervals, now, o) {
  const byExt = {};
  for (const iv of intervals) (byExt[iv.ext] = byExt[iv.ext] || []).push(iv);
  const rings = [];
  for (const list of Object.values(byExt)) {
    list.forEach((iv, i) => {
      if (iv.status !== S.RING) return;
      const next = list[i + 1];
      rings.push({
        ext: iv.ext, agent: iv.agent, start: iv.start, end: iv.end, partialStart: iv.partialStart,
        secs: secs(iv.start, endOf(iv, now)),
        endedAs: next ? next.status : null,
        outcome: !next ? 'ringing' : next.status === S.CALL ? 'answered' : 'unanswered',
      });
    });
  }
  // A group ring stops for everybody when one agent picks up. If another agent answered at the
  // moment this ring ended, this agent did not ignore the call.
  const answered = rings.filter(r => r.outcome === 'answered');
  for (const r of rings) {
    if (r.outcome !== 'unanswered') continue;
    const other = answered.find(a => a.ext !== r.ext && a.start < r.end && Math.abs(a.end - r.end) <= o.takenByOtherSec * 1000);
    if (other) r.outcome = 'taken_by_other';
    else r.outcome = r.secs >= o.ignoreRingSec ? 'ignored' : 'short_ring';   // short_ring: caller probably hung up
  }
  return rings.sort((a, b) => a.start - b.start);
}

function buildCalls(intervals, now) {
  return intervals.filter(iv => iv.status === S.CALL).map(iv => ({
    ext: iv.ext, agent: iv.agent, start: iv.start, end: iv.end,
    secs: secs(iv.start, endOf(iv, now)), open: iv.end === null, partialStart: iv.partialStart,
  })).sort((a, b) => a.start - b.start);
}

/* ── alerts ──────────────────────────────────────────────────────── */
function buildAlerts(rings, calls, o, now) {
  const alerts = [];
  const name = a => displayName(a);
  for (const r of rings) {
    if (r.outcome !== 'ignored') continue;
    alerts.push({
      type: 'ignored_call', severity: 'warning', ext: r.ext, agent: name(r.agent), at: r.start, secs: Math.round(r.secs),
      message: `${name(r.agent)} let a call ring for ${Math.round(r.secs)}s without answering` + (r.endedAs ? ` (then ${r.endedAs})` : ''),
    });
  }
  // repeated ignores
  const byAgent = {};
  for (const r of rings) if (r.outcome === 'ignored') (byAgent[r.ext] = byAgent[r.ext] || []).push(r);
  for (const [ext, list] of Object.entries(byAgent)) {
    const win = o.repeatIgnoreWindowMin * 60000; let lastFlag = -Infinity;
    for (let i = o.repeatIgnoreCount - 1; i < list.length; i++) {
      const first = list[i - (o.repeatIgnoreCount - 1)];
      if (list[i].start - first.start <= win && list[i].start > lastFlag + win) {
        lastFlag = list[i].start;
        alerts.push({
          type: 'repeated_ignore', severity: 'high', ext, agent: name(list[i].agent), at: list[i].start, count: o.repeatIgnoreCount,
          message: `${name(list[i].agent)} ignored ${o.repeatIgnoreCount} calls within ${o.repeatIgnoreWindowMin} minutes`,
        });
      }
    }
  }
  for (const c of calls) {
    if (c.open || c.partialStart || c.secs >= o.shortCallSec) continue;
    alerts.push({
      type: 'short_call', severity: 'info', ext: c.ext, agent: name(c.agent), at: c.start, secs: Math.round(c.secs),
      message: `${name(c.agent)} had a ${Math.round(c.secs)}s call (possible dropped call)`,
    });
  }
  return alerts.sort((a, b) => a.at - b.at);
}

/* ── per-agent statistics for one day ────────────────────────────── */
function analyze(rows, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const intervals = buildIntervals(rows, o);
  // 3CX only writes a row when a status changes, so an unchanged status runs on until now. But if the log stopped growing
  // (logger off, a later day, nobody working), don't invent activity: stop at the last row plus a short allowance.
  const logEnd = intervals.reduce((m, iv) => Math.max(m, iv.start, iv.end ?? 0), -Infinity);
  const now = Math.min(opts.now ?? Date.now(), logEnd + o.quietCapMin * 60000);
  const rings = buildRings(intervals, now, o);
  const calls = buildCalls(intervals, now);
  const alerts = buildAlerts(rings, calls, o, now);

  let from = -Infinity, to = Infinity;
  if (o.day) [from, to] = dayRange(o.day, o.dayOffsetHours ?? o.tzOffsetHours);
  const inDay = t => t >= from && t < to;

  const agents = {};
  const A = (ext, agent) => agents[ext] || (agents[ext] = {
    ext, agent: displayName(agent), statusSecs: {}, calls: 0, callSecs: 0, shortCalls: 0, longestCallSecs: 0,
    rings: 0, answered: 0, ignored: 0, takenByOther: 0, shortRings: 0, breaks: 0, adminSecs: 0, breakSecs: 0,
  });
  for (const iv of intervals) {                      // time per status, clipped to the day
    const a = A(iv.ext, iv.agent);
    const s = Math.max(iv.start, from), e = Math.min(endOf(iv, now), to);
    if (e > s) a.statusSecs[iv.status] = (a.statusSecs[iv.status] || 0) + (e - s) / 1000;
    if (isBreak(iv.status)) { if (e > s) a.breakSecs += (e - s) / 1000; if (inDay(iv.start)) a.breaks++; }
  }
  for (const c of calls) {                           // a call belongs to the day it started
    if (!inDay(c.start)) continue;
    const a = A(c.ext, c.agent);
    a.calls++; a.callSecs += c.secs; a.longestCallSecs = Math.max(a.longestCallSecs, c.secs);
    if (!c.open && !c.partialStart && c.secs < o.shortCallSec) a.shortCalls++;
  }
  for (const r of rings) {
    if (!inDay(r.start)) continue;
    const a = A(r.ext, r.agent);
    if (r.outcome === 'ringing') continue;
    a.rings++;
    if (r.outcome === 'answered') a.answered++;
    else if (r.outcome === 'ignored') a.ignored++;
    else if (r.outcome === 'taken_by_other') a.takenByOther++;
    else if (r.outcome === 'short_ring') a.shortRings++;
  }
  for (const a of Object.values(agents)) {
    a.adminSecs = Object.entries(a.statusSecs).reduce((t, [st, v]) => t + (/admin/i.test(st) ? v : 0), 0);   // 'Admin' or 3CX's 'Do Not Disturb - ADMIN'
    a.avgCallSecs = a.calls ? a.callSecs / a.calls : 0;
    a.answerRate = a.answered + a.ignored ? a.answered / (a.answered + a.ignored) : null;
  }
  const dayAlerts = alerts.filter(a => inDay(a.at));
  return { agents, rings, calls, alerts: dayAlerts, intervals, options: o, now };
}

/* ── break records for the app ───────────────────────────────────── */
function breakType(status, detail) {
  const d = `${status || ''} ${detail || ''}`.toLowerCase();
  if (/lunch/.test(d)) return 'Lunch Break';
  if (/bathroom|toilet|\bwc\b/.test(d)) return 'Bathroom Break';
  return 'Break';
}
// Break intervals as rows shaped like bt_logs. `users` = [{id, name}] from the app.
// Returns {logs, unmatched}: agents the log mentions that no app user matches (match is by name).
function toBreakLogs(intervals, users, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const byKey = new Map(users.map(u => [nameKey(u.name), u]));
  const logs = []; const unmatched = new Set();
  for (const iv of intervals) {
    if (!isBreak(iv.status)) continue;
    if (iv.end !== null && secs(iv.start, iv.end) < o.minBreakSec) continue;
    const u = byKey.get(nameKey(iv.agent));
    if (!u) { unmatched.add(iv.agent); continue; }
    logs.push({
      user_id: u.id, agent_name: u.name,
      start_time: new Date(iv.start).toISOString(),
      end_time: iv.end === null ? null : new Date(iv.end).toISOString(),
      duration_secs: iv.end === null ? null : Math.round(secs(iv.start, iv.end)),
      break_type: breakType(iv.status, iv.detail), source: '3cx', ext: iv.ext, partial_start: !!iv.partialStart,
    });
  }
  return { logs, unmatched: [...unmatched] };
}


/* ── break check: 3CX against what the agents entered ────────────── */
// The agents' own break log (bt_logs) is the record. 3CX is never written into it: this only reads both and reports differences.
//   cxLogs  = toBreakLogs(...).logs        appLogs = rows of bt_logs ({user_id, agent_name, start_time, end_time})
// Breaks are paired by overlap (at least 30 s, or half of the shorter one). What is left over is "only in 3CX" or "only in the
// agent's log". An agent is flagged when something is left over, or the totals differ by more than breakToleranceSec.
function compareBreaks(cxLogs, appLogs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const now = opts.now ?? Date.now();
  const hm = ms => isoLocal(ms, o.tzOffsetHours).slice(11, 16);
  const span = x => ({ s: Date.parse(x.start_time), e: x.end_time ? Date.parse(x.end_time) : now, open: !x.end_time });
  const users = {};
  const add = (list, side) => (list || []).forEach(x => {
    const u = users[x.user_id] || (users[x.user_id] = { user_id: x.user_id, agent_name: x.agent_name, cx: [], app: [] });
    u[side].push(span(x));
  });
  add(cxLogs, 'cx'); add(appLogs, 'app');
  const overlap = (a, b) => Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s));
  const out = [];
  for (const u of Object.values(users)) {
    u.cx.sort((a, b) => a.s - b.s); u.app.sort((a, b) => a.s - b.s);
    const freeApp = new Set(u.app.map((_, i) => i)); const pairs = []; const onlyCx = [];
    for (const c of u.cx) {
      let best = -1, bo = 0;
      for (const i of freeApp) { const ov = overlap(c, u.app[i]); if (ov > bo) { bo = ov; best = i; } }
      const need = best < 0 ? Infinity : Math.min(30000, 0.5 * Math.min(c.e - c.s, u.app[best].e - u.app[best].s));
      if (best >= 0 && bo >= need) { freeApp.delete(best); pairs.push({ cx: c, app: u.app[best] }); } else onlyCx.push(c);
    }
    const onlyApp = [...freeApp].map(i => u.app[i]);
    const cxSecs = u.cx.reduce((t, x) => t + (x.e - x.s) / 1000, 0), appSecs = u.app.reduce((t, x) => t + (x.e - x.s) / 1000, 0);
    const diffSecs = appSecs - cxSecs;                       // positive: the agent logged more than 3CX shows
    const reasons = [];
    onlyCx.forEach(x => reasons.push(`3CX shows a break ${hm(x.s)} to ${x.open ? 'now' : hm(x.e)} that is not in the agent's log`));
    onlyApp.forEach(x => reasons.push(`The agent's log has a break ${hm(x.s)} to ${x.open ? 'now' : hm(x.e)} that 3CX doesn't show`));
    if (Math.abs(diffSecs) > o.breakToleranceSec)
      reasons.push(`Totals differ by ${fmtDur(Math.abs(diffSecs))}: agent's log ${fmtDur(appSecs)}, 3CX ${fmtDur(cxSecs)}`);
    out.push({ user_id: u.user_id, agent_name: u.agent_name, cxCount: u.cx.length, appCount: u.app.length, cxSecs, appSecs, diffSecs,
      pairs, onlyCx, onlyApp, reasons, flagged: reasons.length > 0 });
  }
  return out.sort((a, b) => String(a.agent_name).localeCompare(String(b.agent_name)));
}

/* ── text report ─────────────────────────────────────────────────── */
function fmtDur(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`;
}
function report(result) {
  const o = result.options, tz = o.tzOffsetHours;
  const L = [];
  L.push(`3CX report${o.day ? ' for ' + o.day : ''}  (clock UTC${tz >= 0 ? '+' : ''}${tz})`, '');
  const pad = (v, n) => String(v).padEnd(n);
  L.push([pad('Agent', 24), pad('Calls', 6), pad('Talk time', 11), pad('Avg', 8), pad('<' + o.shortCallSec + 's', 6),
    pad('Rings', 6), pad('Ignored', 8), pad('Admin', 9), pad('Breaks', 7), 'Break time'].join(' '));
  for (const a of Object.values(result.agents).sort((x, y) => x.agent.localeCompare(y.agent))) {
    L.push([pad(a.agent, 24), pad(a.calls, 6), pad(fmtDur(a.callSecs), 11), pad(fmtDur(a.avgCallSecs), 8), pad(a.shortCalls, 6),
      pad(a.rings, 6), pad(a.ignored, 8), pad(fmtDur(a.adminSecs), 9), pad(a.breaks, 7), fmtDur(a.breakSecs)].join(' '));
  }
  L.push('', `Alerts (${result.alerts.length})`);
  for (const a of result.alerts) L.push(`  ${isoLocal(a.at, tz)}  [${a.severity}] ${a.message}`);
  if (!result.alerts.length) L.push('  none');
  return L.join('\n');
}

module.exports = { DEFAULTS, parseCsv, rowsFromStatusLog, parseStamp, dayRange, isoLocal, nameKey, displayName, buildIntervals, buildRings, buildCalls,
  buildAlerts, analyze, toBreakLogs, compareBreaks, breakType, isBreak, fmtDur, report };
