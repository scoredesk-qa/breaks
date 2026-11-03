/* Fingerprint punches -> shifts, breaks and weekly reports. Pure functions, no browser or database needed.
   A punch is { badge_id, punched_at (ISO string or ms), punch_type: 'in'|'out'|'break_start'|'break_end'|null }.
   When the scanner app does not say what a punch is (punch_type null) the type is worked out from the order of the punches. */
(function (root) {
  const H = 3600000, MIN = 60000;
  const DEFAULTS = {
    off: 0,              // company clock: UTC offset in hours (decides which calendar day a shift belongs to)
    dupSec: 60,          // a second scan within this many seconds of the last one is a double scan and is ignored
    maxShiftH: 16,       // a shift still open after this long is closed as "no clock-out" when the next punch arrives
    longShiftH: 6,       // with no punch type: a scan this long after clock-in is the clock-out, not a break
    outNearEndMin: 45,   // with no punch type: a scan within this many minutes of the rota end is the clock-out
    graceMin: 5,         // late / left early only counts beyond this
    overtimeMin: 15,
  };

  const ms = t => (typeof t === 'number' ? t : Date.parse(t));
  const pad = n => String(n).padStart(2, '0');
  const dayKey = (t, off) => new Date(ms(t) + off * H).toISOString().slice(0, 10);
  const hm = (t, off) => { const d = new Date(ms(t) + off * H); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  const hms = (t, off) => { const d = new Date(ms(t) + off * H); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
  const dayStart = (key, off) => Date.parse(key + 'T00:00:00Z') - off * H;      // the instant the company day begins
  const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const mondayOf = key => { const d = new Date(key + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; return addDays(key, -w); };
  const dur = s => {                    // 3725 -> "1h 02m"
    s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? `${h}h ${pad(m)}m` : m ? `${m}m ${pad(x)}s` : `${x}s`;
  };
  const durHM = s => { s = Math.max(0, Math.round(s / 60)); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };   // for reports: 07:05
  const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); return m ? +m[1] * 60 + +m[2] : null; };

  /* ── rota ────────────────────────────────────────────────────────── */
  // rotaJson = { weeks: [ { start:'2026-11-02', rows: { Name: ['06:00-13:00'|null x7] } } ] }
  function rotaLookup(rotaJson) {
    const map = new Map();
    for (const w of (rotaJson && rotaJson.weeks) || [])
      for (const [name, days] of Object.entries(w.rows))
        days.forEach((cell, i) => { if (!cell) return; const [a, b] = cell.split('-'); map.set(name.toLowerCase() + '|' + addDays(w.start, i), { start: a, end: b }); });
    return (name, key) => map.get(String(name || '').toLowerCase() + '|' + key) || null;
  }

  /* ── punches -> shifts ───────────────────────────────────────────── */
  // sched(badge, dayKey) -> {start:'HH:MM', end:'HH:MM'} | null   (optional, only used to guess a clock-out)
  function buildShifts(punches, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    const by = new Map();
    for (const p of punches || []) {
      const t = ms(p.punched_at); if (!Number.isFinite(t) || p.badge_id == null) continue;
      const k = String(p.badge_id); if (!by.has(k)) by.set(k, []);
      by.get(k).push({ t, type: p.punch_type || null });
    }
    const shifts = [], ignored = [];
    for (const [badge, list] of by) {
      list.sort((a, b) => a.t - b.t);
      let cur = null, last = null, state = 'off';
      const close = (out, flag) => { cur.out = out; if (flag) cur.flags.push(flag); const b = cur.breaks[cur.breaks.length - 1]; if (b && b.e == null && out != null) b.e = out; cur.open = false; shifts.push(cur); cur = null; state = 'off'; };
      for (const p of list) {
        if (last && p.t - last.t < o.dupSec * 1000 && (p.type === last.type || !p.type || !last.type)) { ignored.push({ badge, t: p.t, why: 'double scan' }); continue; }
        if (cur && p.t - cur.inMs > o.maxShiftH * H) { close(null, 'no_out'); }
        let act = p.type, inferred = false;
        if (!act) {
          inferred = true;
          if (state === 'off') act = 'in';
          else if (state === 'brk') act = 'break_end';
          else {
            const s = o.sched && o.sched(badge, dayKey(cur.inMs, o.off));
            const endMin = s ? toMin(s.end) : null;
            const nearEnd = endMin != null && (p.t - dayStart(dayKey(cur.inMs, o.off), o.off)) / MIN >= endMin - o.outNearEndMin;
            act = (p.t - cur.inMs >= o.longShiftH * H || nearEnd) ? 'out' : 'break_start';
          }
        }
        last = p;
        if (act === 'in') {
          if (state !== 'off') { ignored.push({ badge, t: p.t, why: 'clock-in while already on shift' }); continue; }
          cur = { badge, inMs: p.t, out: null, breaks: [], open: true, flags: [], inferred: false, dayKey: dayKey(p.t, o.off) }; state = 'on';
          if (inferred) cur.inferred = true;
        } else if (act === 'out') {
          if (state === 'off') { ignored.push({ badge, t: p.t, why: 'clock-out with no clock-in' }); continue; }
          if (inferred) cur.inferred = true; close(p.t);
        } else if (act === 'break_start') {
          if (state !== 'on') { ignored.push({ badge, t: p.t, why: 'break start while ' + (state === 'off' ? 'not on shift' : 'already on break') }); continue; }
          cur.breaks.push({ s: p.t, e: null }); state = 'brk'; if (inferred) cur.inferred = true;
        } else if (act === 'break_end') {
          if (state !== 'brk') { ignored.push({ badge, t: p.t, why: 'break end while not on break' }); continue; }
          cur.breaks[cur.breaks.length - 1].e = p.t; state = 'on'; if (inferred) cur.inferred = true;
        }
        if (cur) cur.lastAction = act;
        p.act = act; p.inferred = inferred;
      }
      if (cur) { cur.state = state; shifts.push(cur); }
    }
    shifts.sort((a, b) => a.inMs - b.inMs);
    for (const s of shifts) if (!s.state) s.state = s.out != null ? 'done' : 'no_out';
    // every punch with what it was taken to be (for the punch log)
    const log = [];
    for (const [badge, list] of by) for (const p of list) log.push({ badge, t: p.t, act: p.act || null, inferred: !!p.inferred, ignored: p.act ? null : (ignored.find(i => i.badge === badge && i.t === p.t) || {}).why || 'ignored' });
    log.sort((a, b) => a.t - b.t);
    return { shifts, ignored, log };
  }

  // time figures for one shift. `now` closes an open shift / break for display.
  function metrics(s, now) {
    const end = s.out != null ? s.out : (s.state === 'no_out' ? null : now);
    const breakSecs = s.breaks.reduce((t, b) => { const e = b.e != null ? b.e : (end != null ? end : now); return t + Math.max(0, (e - b.s) / 1000); }, 0);
    const onShift = end == null ? null : Math.max(0, (end - s.inMs) / 1000);
    return { end, onShift, breakSecs, worked: onShift == null ? null : Math.max(0, onShift - breakSecs), breaks: s.breaks.length };
  }

  /* ── rota comparison ─────────────────────────────────────────────── */
  function compare(s, sched, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    if (!sched) return { sched: null, lateMin: 0, earlyMin: 0, overtimeMin: 0 };
    const d0 = dayStart(s.dayKey, o.off), a = d0 + toMin(sched.start) * MIN, b = d0 + toMin(sched.end) * MIN;
    const late = Math.round((s.inMs - a) / MIN), early = s.out != null ? Math.round((b - s.out) / MIN) : 0, over = s.out != null ? Math.round((s.out - b) / MIN) : 0;
    return { sched, lateMin: late > o.graceMin ? late : 0, earlyMin: early > o.graceMin ? early : 0, overtimeMin: over > o.overtimeMin ? over : 0 };
  }

  /* ── one agent, one week ─────────────────────────────────────────── */
  function weekFor(agent, shifts, weekStart, now, sched, o) {
    o = Object.assign({}, DEFAULTS, o || {});
    const days = [], tot = { onShift: 0, break: 0, worked: 0, shifts: 0, late: 0, scheduledMin: 0, noOut: 0 };
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStart, i), mine = shifts.filter(s => s.badge === agent.badge_id && s.dayKey === key);
      const sc = sched ? sched(agent.name, key) : null;
      const row = { key, sched: sc, shifts: mine, in: null, out: null, breaks: 0, breakSecs: 0, onShift: 0, worked: 0, lateMin: 0, earlyMin: 0, overtimeMin: 0, noOut: false, open: false, absent: false };
      for (const s of mine) {
        const m = metrics(s, now), c = compare(s, sc, o);
        row.in = row.in == null ? s.inMs : Math.min(row.in, s.inMs);
        if (s.out != null) row.out = row.out == null ? s.out : Math.max(row.out, s.out);
        row.breaks += m.breaks; row.breakSecs += m.breakSecs;
        if (m.onShift != null) { row.onShift += m.onShift; row.worked += m.worked; }
        row.noOut = row.noOut || s.state === 'no_out'; row.open = row.open || s.state === 'on' || s.state === 'brk';
        row.lateMin = Math.max(row.lateMin, c.lateMin); row.earlyMin = Math.max(row.earlyMin, c.earlyMin); row.overtimeMin = Math.max(row.overtimeMin, c.overtimeMin);
      }
      if (sc && !mine.length && dayStart(key, o.off) + toMin(sc.end) * MIN < now) row.absent = true;   // rota says working, never clocked in
      if (mine.length) { tot.shifts++; tot.onShift += row.onShift; tot.break += row.breakSecs; tot.worked += row.worked; if (row.lateMin) tot.late++; if (row.noOut) tot.noOut++; }
      if (sc) tot.scheduledMin += toMin(sc.end) - toMin(sc.start);
      days.push(row);
    }
    return { agent, days, totals: tot };
  }

  /* ── CSV (opens in Excel) ────────────────────────────────────────── */
  const csvCell = v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function weeklyCsv(weeks, weekStart, off) {
    const rows = [['Agent', 'Date', 'Day', 'Scheduled', 'Clock in', 'Clock out', 'Breaks', 'Break time (hh:mm)', 'On shift (hh:mm)', 'Worked (hh:mm)', 'Late (min)', 'Left early (min)', 'Notes']];
    for (const w of weeks) {
      w.days.forEach((d, i) => {
        if (!d.shifts.length && !d.sched) return;
        const notes = [d.noOut ? 'No clock-out recorded' : '', d.open ? 'Still on shift' : '', d.absent ? 'Scheduled but never clocked in' : '', d.overtimeMin ? `Stayed ${d.overtimeMin} min after the rota end` : ''].filter(Boolean).join('; ');
        rows.push([w.agent.name, d.key, DOW[i], d.sched ? d.sched.start + '-' + d.sched.end : '', d.in != null ? hm(d.in, off) : '', d.out != null ? hm(d.out, off) : '', d.shifts.length ? d.breaks : '', d.shifts.length ? durHM(d.breakSecs) : '', d.shifts.length && !d.noOut ? durHM(d.onShift) : '', d.shifts.length && !d.noOut ? durHM(d.worked) : '', d.lateMin || '', d.earlyMin || '', notes]);
      });
      const t = w.totals;
      rows.push([w.agent.name + ' — week total', '', '', durHM(t.scheduledMin * 60), '', '', '', durHM(t.break), durHM(t.onShift), durHM(t.worked), t.late ? t.late + ' late day(s)' : '', '', t.noOut ? t.noOut + ' shift(s) without clock-out' : '']);
      rows.push([]);
    }
    return '﻿' + [['Weekly report', 'week of ' + weekStart + ' to ' + addDays(weekStart, 6)], []].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
  }

  root.FP = { DEFAULTS, ms, pad, dayKey, hm, hms, dayStart, addDays, mondayOf, dur, durHM, toMin, rotaLookup, buildShifts, metrics, compare, weekFor, weeklyCsv, DOW };
  if (typeof module !== 'undefined') module.exports = root.FP;
})(typeof window !== 'undefined' ? window : globalThis);
