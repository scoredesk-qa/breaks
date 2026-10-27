#!/usr/bin/env node
// Tests for the 3CX analysis. Run:  node tools/3cx/test.js
// Uses a made-up log (fixtures/status_log.sample.csv). Nothing here touches the app or a database.
//
// Optional: CX_REAL_CSV=path/to/status_log.csv node tools/3cx/test.js   also runs sanity checks on a real log.
const fs = require('fs');
const path = require('path');
const A = require('./analyze');
const { statusFrom } = require('./logger');

let fails = 0;
const check = (label, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  → ' + extra : '')); if (!cond) fails++; };
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}${JSON.stringify(got) === JSON.stringify(want) ? '' : ', want ' + JSON.stringify(want)}`);

const rows = A.parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures', 'status_log.sample.csv'), 'utf8'));
const NOW = A.parseStamp('2026-10-27 13:10:00', 0);
const R = A.analyze(rows, { day: '2026-10-27', tzOffsetHours: 0, now: NOW });
const ag = ext => R.agents[ext];

// ── CSV + names ────────────────────────────────────────────────────
check('C1 parses every row of the sample log', rows.length === 37, rows.length);
eq('C2 quoted "Last, First" stays one field', rows[2].agent, 'Doe, Jane');
eq('C3 quoted commas and doubled quotes', A.parseCsv('a,b\n"x, ""y""",z\n')[0], { a: 'x, "y"', b: 'z' });
eq('C4 name order flipped', A.displayName('Sghir, Abdulkarim'), 'Abdulkarim Sghir');
check('C5 names match whatever the order, case or accents', A.nameKey('Sghir, Abdulkarim') === A.nameKey('abdulkarim  SGHIR') && A.nameKey('Élodie Roy') === A.nameKey('Roy, Elodie'));

// ── calls ──────────────────────────────────────────────────────────
eq('D1 Jane: 1 call', ag('601').calls, 1);
eq('D2 Jane: talk time 12m24s', ag('601').callSecs, 744);
eq('D3 Pat: 2 calls (35s and 20m)', [ag('603').calls, ag('603').callSecs], [2, 35 + 1200]);
eq('D4 Pat: average call', Math.round(ag('603').avgCallSecs), Math.round(1235 / 2));
eq('D5 Pat: longest call', ag('603').longestCallSecs, 1200);
eq('D6 Pat: one short call', ag('603').shortCalls, 1);
eq('D7 Jane: no short calls', ag('601').shortCalls, 0);
eq('D8 call that started yesterday is not counted today', ag('608').calls, 0);
eq('D9 ...but its time after midnight is (10 min)', ag('608').statusSecs['On call'], 600);

eq('D10 Ada\'s call was already running when the logger started: counted, but never called a dropped call',
  [ag('609').calls, ag('609').shortCalls, R.alerts.filter(a => a.ext === '609').length], [1, 0, 0]);
check('D11 ...and it is marked as a partial call', R.calls.find(c => c.ext === '609').partialStart === true && R.calls.find(c => c.ext === '601').partialStart === false);

// ── rings ──────────────────────────────────────────────────────────
eq('R1 Jane answered her ring', [ag('601').rings, ag('601').answered, ag('601').ignored], [1, 1, 0]);
eq('R2 Rick ignored 3 rings', [ag('602').rings, ag('602').ignored, ag('602').answered], [3, 3, 0]);
eq('R3 Max did not ignore: Pat picked up the same call', [ag('604').ignored, ag('604').takenByOther], [0, 1]);
eq('R4 a 4s ring that stopped is a short ring, not an ignore', [ag('605').ignored, ag('605').shortRings], [0, 1]);
eq('R5 Rick answer rate 0%', ag('602').answerRate, 0);
eq('R6 Jane answer rate 100%', ag('601').answerRate, 1);
eq('R7 an agent with no rings has no rate', ag('606').answerRate, null);
const ringRick = R.rings.filter(r => r.ext === '602');
eq('R8 ring that ended with the phone going offline is still an ignore, and says so', [ringRick[2].outcome, ringRick[2].endedAs], ['ignored', 'Offline']);

// ── admin time and breaks ─────────────────────────────────────────
eq('B1 Kay: 30 min admin', ag('606').adminSecs, 1800);
eq('B2 Kay: 2 breaks, 15 min + 60 min lunch = 75 min', [ag('606').breaks, ag('606').breakSecs], [2, 4500]);
eq('B3 Finn: break still open counts up to now (10 min)', [ag('607').breaks, ag('607').breakSecs], [1, 600]);
eq('B4 Jane never had admin or break', [ag('601').adminSecs, ag('601').breakSecs], [0, 0]);
const avail601 = R.intervals.filter(i => i.ext === '601' && i.status === 'Available');
eq('B5 a logger restart that repeats the same status makes no new interval (09:30 row merged into the 09:12:30 stretch)',
  [avail601.length, A.isoLocal(avail601[1].start, 0), avail601[1].end], [2, '2026-10-27 09:12:30', null]);

// ── alerts ─────────────────────────────────────────────────────────
const byType = t => R.alerts.filter(a => a.type === t);
eq('A1 three ignored-call alerts, all Rick', byType('ignored_call').map(a => a.agent), ['Rick Roe', 'Rick Roe', 'Rick Roe']);
eq('A2 one repeated-ignore alert for Rick, at the third ignore', byType('repeated_ignore').map(a => [a.agent, A.isoLocal(a.at, 0)]), [['Rick Roe', '2026-10-27 09:45:00']]);
eq('A3 one short-call alert: Pat, 35s', byType('short_call').map(a => [a.agent, a.secs]), [['Pat Poe', 35]]);
eq('A4 no alert for the call another agent answered', R.alerts.filter(a => a.ext === '604').length, 0);
eq('A5 no alert for the 4s ring', R.alerts.filter(a => a.ext === '605').length, 0);
eq('A6 5 alerts in total, in time order', [R.alerts.length, R.alerts.every((a, i, l) => !i || l[i - 1].at <= a.at)], [5, true]);
eq('A7 repeated alert is high severity', byType('repeated_ignore')[0].severity, 'high');

// ── thresholds are settings, not constants ─────────────────────────
const strict = A.analyze(rows, { day: '2026-10-27', now: NOW, ignoreRingSec: 30 });
eq('T1 with a 30s ignore threshold, Rick\'s 25s and 30s... only the 30s ring counts', strict.agents['602'].ignored, 1);
const loose = A.analyze(rows, { day: '2026-10-27', now: NOW, shortCallSec: 10 });
eq('T2 with a 10s short-call limit, Pat\'s 35s call is not flagged', loose.alerts.filter(a => a.type === 'short_call').length, 0);
const nobody = A.analyze(rows, { day: '2026-10-27', now: NOW, repeatIgnoreCount: 4 });
eq('T3 repeated alert needs 4 ignores → none', nobody.alerts.filter(a => a.type === 'repeated_ignore').length, 0);

// ── other days and clocks ──────────────────────────────────────────
const prev = A.analyze(rows, { day: '2026-10-26', now: NOW });
eq('Y1 the previous day has Gail\'s one call, running 10 min before midnight', [prev.agents['608'].calls, prev.agents['608'].statusSecs['On call']], [1, 600]);
eq('Y2 the previous day has none of the morning\'s alerts', prev.alerts.length, 0);
const tz1 = A.analyze(rows, { day: '2026-10-27', tzOffsetHours: 1, now: A.parseStamp('2026-10-27 13:10:00', 1) });
eq('Y3 a UTC+1 log gives the same totals', [tz1.agents['601'].callSecs, tz1.agents['606'].breakSecs], [744, 4500]);
eq('Y4 ...and shifts the alert times to real instants', new Date(tz1.alerts[0].at).toISOString(), '2026-10-27T08:05:00.000Z');
eq('Y5 isoLocal gives the clock reading back', A.isoLocal(tz1.alerts[0].at, 1), '2026-10-27 09:05:00');

// ── break records for the app ─────────────────────────────────────
const users = [{ id: 'u-kay', name: 'Kay Kim' }, { id: 'u-finn', name: 'Finn Fox' }, { id: 'u-jane', name: 'Jane Doe' }];
const B = A.toBreakLogs(R.intervals, users, { tzOffsetHours: 0 });
eq('L1 three break records (two for Kay, one open for Finn)', B.logs.map(l => [l.user_id, l.break_type]), [['u-kay', 'Break'], ['u-kay', 'Lunch Break'], ['u-finn', 'Bathroom Break']]);
eq('L2 closed break has start, end and seconds', [B.logs[0].start_time, B.logs[0].end_time, B.logs[0].duration_secs], ['2026-10-27T11:00:00.000Z', '2026-10-27T11:15:00.000Z', 900]);
eq('L3 open break has no end yet', [B.logs[2].end_time, B.logs[2].duration_secs], [null, null]);
eq('L4 app name is used, not the 3CX "Last, First"', B.logs[0].agent_name, 'Kay Kim');
eq('L5 every record says where it came from', [...new Set(B.logs.map(l => l.source))], ['3cx']);
const B2 = A.toBreakLogs(R.intervals, users.filter(u => u.id !== 'u-kay'));
eq('L6 an agent with no matching app user is reported, not guessed', [B2.logs.length, B2.unmatched], [1, ['Kim, Kay']]);
const B3 = A.toBreakLogs(A.buildIntervals(rows, { tzOffsetHours: 1 }), users, { tzOffsetHours: 1 });
eq('L7 a UTC+1 log stores real instants (11:00 on the clock = 10:00Z)', B3.logs[0].start_time, '2026-10-27T10:00:00.000Z');
const head0 = 'timestamp,extension,agent,old_status,new_status,detail\n';
const blip = A.buildIntervals(A.parseCsv('timestamp,extension,agent,old_status,new_status,detail\n2026-10-27 10:00:00,1,"A, B",Available,Break,"break"\n2026-10-27 10:00:04,1,"A, B",Break,Available,"Available"\n'), {});
eq('L8 a 4s accidental break toggle is ignored', A.toBreakLogs(blip, [{ id: 'x', name: 'B A' }]).logs.length, 0);
const midBreak = A.buildIntervals(A.parseCsv(head0 + '2026-10-27 10:00:00,1,"A, B",,Break,"break"\n2026-10-27 10:20:00,1,"A, B",Break,Available,"Available"\n'), {});
eq('L10 a break already running at logger start is marked partial', A.toBreakLogs(midBreak, [{ id: 'x', name: 'B A' }]).logs[0].partial_start, true);
eq('L9 break types from the status text', [A.breakType('Break', 'Bathroom break'), A.breakType('Lunch', ''), A.breakType('Break', 'break')], ['Bathroom Break', 'Lunch Break', 'Break']);

// ── edge cases ─────────────────────────────────────────────────────
const head = 'timestamp,extension,agent,old_status,new_status,detail\n';
const ringing = A.analyze(A.parseCsv(head + '2026-10-27 10:00:00,1,"A, B",Available,Ringing,"Ringing"\n'), { day: '2026-10-27', now: A.parseStamp('2026-10-27 10:00:20', 0) });
eq('E1 a phone that is ringing right now is not judged yet', [ringing.agents['1'].rings, ringing.alerts.length], [0, 0]);
const ongoing = A.analyze(A.parseCsv(head + '2026-10-27 10:00:00,1,"A, B",Available,On call,"On a Call"\n'), { day: '2026-10-27', now: A.parseStamp('2026-10-27 10:00:20', 0) });
eq('E2 a call still going is counted but not called "short"', [ongoing.agents['1'].calls, ongoing.agents['1'].shortCalls, ongoing.alerts.length], [1, 0, 0]);
eq('E3 empty log gives an empty report', Object.keys(A.analyze([], { day: '2026-10-27' }).agents).length, 0);
eq('E4 garbage rows are skipped', A.analyze(A.parseCsv(head + 'nonsense,1,"A, B",,Available,""\n'), { day: '2026-10-27' }).intervals.length, 0);
eq('E5 CRLF line endings work', A.parseCsv('a,b\r\n1,2\r\n')[0], { a: '1', b: '2' });
check('E6 the text report lists every agent and the alerts', /Rick Roe/.test(A.report(R)) && /Alerts \(5\)/.test(A.report(R)) && /possible dropped call/.test(A.report(R)));
check('E7 the report shows the day and the clock', /for 2026-10-27/.test(A.report(R)) && /UTC\+0/.test(A.report(R)));

// ── the logger's own status mapping (tools/3cx/logger.js) ─────────
eq('G1 ringing tile → Ringing', statusFrom({ state: 'ringing', inCall: false, text: '' }), 'Ringing');
eq('G2 in-call tile → On call', statusFrom({ state: 'busy', inCall: true, text: '' }), 'On call');
eq('G3 break text → Break', statusFrom({ state: 'away', inCall: false, text: 'Break' }), 'Break');
eq('G4 admin text → Admin', statusFrom({ state: 'dnd', inCall: false, text: 'Admin' }), 'Admin');
eq('G5 custom status is logged as written', statusFrom({ state: 'available', inCall: false, text: 'Lunch' }), 'Lunch');
eq('G6 not registered → Offline', statusFrom({ state: 'off', inCall: false, text: 'Not registered' }), 'Offline');

// ── optional: sanity checks on a real log ─────────────────────────
if (process.env.CX_REAL_CSV) {
  const real = A.parseCsv(fs.readFileSync(process.env.CX_REAL_CSV, 'utf8'));
  const day = real[real.length - 1].timestamp.slice(0, 10);
  const r = A.analyze(real, { day, now: A.parseStamp(real[real.length - 1].timestamp, 0) });
  check(`X1 real log: ${real.length} rows parse into agents and intervals`, Object.keys(r.agents).length > 0 && r.intervals.length > 0, `${Object.keys(r.agents).length} agents, ${r.intervals.length} intervals`);
  check('X2 real log: no negative durations', Object.values(r.agents).every(a => Object.values(a.statusSecs).every(v => v >= 0)));
  check('X3 real log: every ring has an outcome', r.rings.every(x => ['answered', 'ignored', 'short_ring', 'taken_by_other', 'ringing'].includes(x.outcome)));
  console.log('\n' + A.report(r));
}

console.log(fails ? `\nFAILED ${fails}` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
