// node tools/fingerprint/core_test.js
const FP = require('./core.js'), rota = require('./rota.json');
let fails = 0; const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const off = 1;                                    // company clock UTC+1
const at = (key, hm) => Date.parse(key + 'T' + hm + ':00Z') - off * 3600000;
const P = (badge, key, hm, type) => ({ badge_id: badge, punched_at: new Date(at(key, hm)).toISOString(), punch_type: type || null });
const sched = FP.rotaLookup(rota), schedB = (b, k) => sched({ '101': 'Youness', '102': 'Yousra', '103': 'Ziad', '104': 'Khalil' }[b], k);

// 1 rota
check('R1 rota lookup: Yousra Mon 2 Nov 15:00-22:00', JSON.stringify(sched('Yousra', '2026-11-02')) === '{"start":"15:00","end":"22:00"}');
check('R2 rota: day off is null, names are case-insensitive', sched('yousra', '2026-11-04') === null && !!sched('YOUSRA', '2026-11-02'));
check('R3 rota covers all four weeks (2-29 Nov)', !!sched('Khalil', '2026-11-29') && !sched('Khalil', '2026-11-30'));

// 2 no punch types: order decides
let r = FP.buildShifts([P('102', '2026-11-02', '15:06'), P('102', '2026-11-02', '18:00'), P('102', '2026-11-02', '18:15'), P('102', '2026-11-02', '20:00'), P('102', '2026-11-02', '20:30'), P('102', '2026-11-02', '22:01')], { off, sched: schedB });
let s = r.shifts[0], m = FP.metrics(s, at('2026-11-03', '09:00'));
check('S1 six untyped scans = one shift, two breaks', r.shifts.length === 1 && s.breaks.length === 2 && s.state === 'done' && s.inferred);
check('S2 times: break 15m + 30m, on shift 6h55m, worked 6h10m', m.breakSecs === 2700 && m.onShift === 6 * 3600 + 55 * 60 && m.worked === 6 * 3600 + 10 * 60, JSON.stringify(m));
check('S3 shift belongs to the company day 2 Nov', s.dayKey === '2026-11-02');
const c = FP.compare(s, schedB('102', '2026-11-02'), { off });
check('S4 6 min after 15:00 = late 6 (grace is 5); left 1 min after the end = on time', c.lateMin === 6 && c.earlyMin === 0 && c.overtimeMin === 0, JSON.stringify(c));

// 3 open states
r = FP.buildShifts([P('103', '2026-11-03', '05:55'), P('103', '2026-11-03', '09:00')], { off, sched: schedB });
check('O1 clocked in then one scan 3h later = on a break right now', r.shifts[0].state === 'brk');
m = FP.metrics(r.shifts[0], at('2026-11-03', '09:10'));
check('O2 open break counts up to now: 10m break, 3h15m on shift', m.breakSecs === 600 && m.onShift === 3 * 3600 + 15 * 60);
r = FP.buildShifts([P('103', '2026-11-03', '05:55')], { off });
check('O3 only a clock-in = on shift', r.shifts[0].state === 'on' && FP.metrics(r.shifts[0], at('2026-11-03', '07:55')).onShift === 7200);

// 4 clock-out guessed near the rota end even when the shift is short of 6h
r = FP.buildShifts([P('102', '2026-11-05', '17:00'), P('102', '2026-11-05', '21:40')], { off, sched: () => ({ start: '17:00', end: '22:00' }) });
check('G1 a scan within 45 min of the rota end is the clock-out', r.shifts[0].state === 'done');
r = FP.buildShifts([P('102', '2026-11-05', '17:00'), P('102', '2026-11-05', '19:00')], { off, sched: () => ({ start: '17:00', end: '22:00' }) });
check('G2 a scan 2h in (rota end far away) is a break', r.shifts[0].state === 'brk');

// 5 explicit punch types win over the guess
r = FP.buildShifts([P('104', '2026-11-03', '06:00', 'in'), P('104', '2026-11-03', '06:30', 'out')], { off });
check('E1 an explicit "out" 30 min in is a clock-out (not guessed as a break)', r.shifts[0].state === 'done' && !r.shifts[0].inferred);
r = FP.buildShifts([P('104', '2026-11-03', '06:00', 'in'), P('104', '2026-11-03', '12:30', 'break_start'), P('104', '2026-11-03', '13:00', 'break_end'), P('104', '2026-11-03', '14:00', 'out')], { off });
check('E2 explicit break_start 6h30m in stays a break', r.shifts[0].breaks.length === 1 && r.shifts[0].state === 'done');

// 6 bad data
r = FP.buildShifts([P('101', '2026-11-02', '06:00'), P('101', '2026-11-02', '06:00')], { off });
check('B1 a double scan in the same second is ignored', r.shifts.length === 1 && r.ignored.length === 1 && r.shifts[0].state === 'on');
r = FP.buildShifts([P('101', '2026-10-29', '06:00'), P('101', '2026-10-29', '09:30'), P('101', '2026-10-29', '09:45'), P('101', '2026-10-30', '06:02')], { off, sched: schedB });
check('B2 a forgotten clock-out is closed as "no clock-out" when the next shift starts', r.shifts.length === 2 && r.shifts[0].state === 'no_out' && r.shifts[0].flags.includes('no_out') && r.shifts[1].state === 'on');
check('B3 a shift with no clock-out has no invented duration', FP.metrics(r.shifts[0], at('2026-11-03', '10:00')).onShift === null);
r = FP.buildShifts([P('101', '2026-11-02', '13:00', 'out')], { off });
check('B4 a clock-out with no clock-in is ignored and listed', r.shifts.length === 0 && r.ignored.length === 1 && r.log[0].ignored.includes('no clock-in'));
r = FP.buildShifts([{ badge_id: '101', punched_at: 'garbage' }, P('101', '2026-11-02', '06:00')], { off });
check('B5 unreadable timestamps are skipped', r.shifts.length === 1);

// 7 two agents never mix
r = FP.buildShifts([P('101', '2026-11-02', '06:00'), P('102', '2026-11-02', '06:00:30'.slice(0, 5)), P('101', '2026-11-02', '13:00'), P('102', '2026-11-02', '13:00')], { off });
check('X1 two agents scanning at once get one shift each', r.shifts.length === 2 && r.shifts.every(x => x.state === 'done'));

// 8 weekly report
const agents = [{ badge_id: '101', name: 'Youness' }, { badge_id: '102', name: 'Yousra' }];
r = FP.buildShifts([P('101', '2026-11-02', '05:58'), P('101', '2026-11-02', '09:40'), P('101', '2026-11-02', '09:55'), P('101', '2026-11-02', '13:02'),
  P('102', '2026-11-02', '15:06'), P('102', '2026-11-02', '18:00'), P('102', '2026-11-02', '18:15'), P('102', '2026-11-02', '22:01')], { off, sched });
const now = at('2026-11-03', '17:15');
const wk = agents.map(a => FP.weekFor(a, r.shifts, '2026-11-02', now, sched, { off }));
const mon = wk[0].days[0];
check('W1 Youness Monday: in 05:58, out 13:02, 1 break of 15m, worked 6h49m', FP.hm(mon.in, off) === '05:58' && FP.hm(mon.out, off) === '13:02' && mon.breaks === 1 && mon.breakSecs === 900 && Math.round(mon.worked / 60) === 409, JSON.stringify([mon.onShift, mon.worked]));
check('W2 Yousra Monday is late 6 min', wk[1].days[0].lateMin === 6);
check('W3 Youness Thursday: rota says work, nobody clocked in, the day is over -> "never clocked in"', wk[0].days[3].absent === false && wk[0].days[3].sched !== null);   // Thu 5 Nov has not happened yet at "now"
const later = at('2026-11-06', '12:00');
check('W4 once the day has passed the same row is marked absent', FP.weekFor(agents[0], r.shifts, '2026-11-02', later, sched, { off }).days[3].absent === true);
check('W5 week totals add up (Youness 6h49m worked)', Math.round(wk[0].totals.worked / 60) === 409 && wk[1].totals.shifts === 1);
const csv = FP.weeklyCsv(wk, '2026-11-02', off);
check('C1 CSV starts with a BOM, has the header and one line per working day', csv.startsWith('﻿Weekly report') && /Agent,Date,Day,Scheduled,Clock in,Clock out/.test(csv) && /Youness,2026-11-02,Mon,06:00-13:00,05:58,13:02,1,00:15,07:04,06:49/.test(csv), csv.split('\r\n').slice(3, 5).join(' | '));
check('C2 CSV quotes commas and quotes in names', FP.weeklyCsv([{ agent: { name: 'O"Neil, Pat', badge_id: '9' }, days: [{ key: '2026-11-02', sched: null, shifts: [{}], in: at('2026-11-02', '06:00'), out: null, breaks: 0, breakSecs: 0, onShift: 0, worked: 0, noOut: false, open: true }], totals: { scheduledMin: 0, break: 0, onShift: 0, worked: 0, late: 0, noOut: 0 } }], '2026-11-02', off).includes('"O""Neil, Pat"'));
check('F1 formatting: dur and durHM and mondayOf', FP.dur(3725) === '1h 02m' && FP.dur(75) === '1m 15s' && FP.durHM(3725) === '01:02' && FP.mondayOf('2026-11-08') === '2026-11-02' && FP.mondayOf('2026-11-02') === '2026-11-02');
console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
