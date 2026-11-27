#!/usr/bin/env node
// Browser test for the admin Bonus audit and Late & extra time tabs. Stand-in database only.
//   node tools/app/test_bonus.js <index.html> <folder with node_modules react, react-dom, @babel/standalone>
const H = require('./harness.js');
const [built, mods] = process.argv.slice(2);
if (!built || !mods) { console.log('usage: node test_bonus.js <index.html> <dir with node_modules>'); process.exit(1); }
const { work, page } = H.prepare(built, mods);
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const D = (d, hm) => `2026-10-${String(d).padStart(2, '0')}T${hm}Z`;
const wd = d => new Date(Date.UTC(2026, 9, d)).getUTCDay();
const workdays = []; for (let d = 1; d <= 26; d++) if (wd(d) >= 1 && wd(d) <= 5) workdays.push(d);   // 18 working days before "today" (27 Oct)

let id = 1; const clocks = [], logs = [], sl = [];
const clock = (name, d, i, o) => clocks.push({ id: id++, user_id: name, agent_name: name, clock_in: D(d, i), clock_out: o ? D(d, o) : null, date: `2026-10-${String(d).padStart(2, '0')}` });
const brk = (name, d, a, b) => logs.push({ id: id++, user_id: name, agent_name: name, start_time: D(d, a), end_time: D(d, b), duration_secs: (Date.parse(D(d, b)) - Date.parse(D(d, a))) / 1000, break_type: 'Break' });
// Jane: one day off (6th), late on the 2nd (exactly 60 s) and stays 15 min late; 30 s late on the 1st and 30 s past 17:30 on the 5th do NOT count
workdays.forEach(d => { if (d === 6) return; if (d === 2) clock('Jane Doe', d, '08:31:00', '17:45:00'); else if (d === 1) clock('Jane Doe', d, '08:30:30', '17:00:00'); else if (d === 5) clock('Jane Doe', d, '08:20:00', '17:30:30'); else clock('Jane Doe', d, '08:25:00', '17:25:00'); });
brk('Jane Doe', 1, '12:00:00', '13:02:00');                       // lunch 62 min: over by 2
brk('Jane Doe', 1, '10:00:00', '10:16:00');                       // break 16 min: over by 1
brk('Jane Doe', 1, '15:00:00', '15:14:00');                       // 14 min: fine
brk('Jane Doe', 1, '09:00:00', '09:05:00'); brk('Jane Doe', 1, '11:00:00', '11:09:00');   // short ones: 14 min together: fine
brk('Jane Doe', 5, '09:00:00', '09:06:00'); brk('Jane Doe', 5, '11:00:00', '11:06:00'); brk('Jane Doe', 5, '14:00:00', '14:06:00');   // short ones: 18 min together: over by 3
brk('Jane Doe', 7, '12:00:00', '12:59:30');                       // lunch 59m30: fine
// Sam: two days absent (8th, 9th)
workdays.forEach(d => { if (d === 8 || d === 9) return; clock('Sam Lee', d, '08:25:00', '17:25:00'); });
// Kay: perfect attendance, 610 calls on the 1st and 10 ignored rings on the 2nd
workdays.forEach(d => clock('Kay Kim', d, '08:25:00', '17:25:00'));
const row = (t, a, b, c) => sl.push({ id: id++, changed_at: t, extension: '701', agent: 'Kim, Kay', old_status: b, new_status: c });
row(D(1, '07:00:00'), 0, null, 'Available');
for (let i = 0; i < 610; i++) { const t0 = Date.parse(D(1, '08:00:00')) + i * 40000; const f = ms => new Date(ms).toISOString(); row(f(t0), 0, 'Available', 'Ringing'); row(f(t0 + 3000), 0, 'Ringing', 'On call'); row(f(t0 + 33000), 0, 'On call', 'Available'); }
for (let i = 0; i < 10; i++) { const t0 = Date.parse(D(2, '09:00:00')) + i * 120000; const f = ms => new Date(ms).toISOString(); row(f(t0), 0, 'Available', 'Ringing'); row(f(t0 + 15000), 0, 'Ringing', 'Available'); }

(async () => {
  const b = await H.launch(); const open = H.opener(b, page, errs);
  const db = H.mkdb({ bt_clocklogs: clocks, bt_logs: logs, status_log: sl, bt_bonus_inputs: [{ month: '2026-10', agent_name: 'Kay Kim', qa_rate: 1, absent_override: null, punct_adj: 0 }] });
  let p = await open({ user: H.admin, db, side: '0', w: 1700, h: 1000 }); await p.waitForSelector('.sb');
  const items = (await p.locator('.sb-nav .sb-i').allInnerTexts()).map(x => x.trim());
  check('B0 the sidebar has Bonus Audit and Late & Extra Time (under More)', items.includes('Bonus Audit') && items.includes('Late & Extra Time'), items.join('|'));
  await p.click('[data-nav=bonus]'); await p.waitForSelector('tr[data-agent="Kay Kim"]', { timeout: 60000 }); await p.waitForTimeout(1500);
  const cell = async (name, i) => (await p.locator(`tr[data-agent="${name}"] td`).nth(i).innerText()).replace(/\s+/g, ' ').trim();
  const inVal = async (name, i) => p.locator(`tr[data-agent="${name}"] td`).nth(i).locator('input').inputValue();
  check('B1 Kay: no absences, no events, 610 calls, ignored 1.6 %', await inVal('Kay Kim', 1) === '0' && /^0/.test(await cell('Kay Kim', 2)) && await cell('Kay Kim', 4) === '610' && /^1\.6%/.test(await cell('Kay Kim', 5)), [await inVal('Kay Kim', 1), await cell('Kay Kim', 2), await cell('Kay Kim', 4), await cell('Kay Kim', 5)].join(' / '));
  check('B2 Kay\'s bonus follows the sheet: attendance 200, QA (100 %) 150, productivity (600+ calls, 2 % or less ignored) 150 = 500', [6, 7, 8, 9].map(async i => 0) && (await cell('Kay Kim', 6)) === '200' && (await cell('Kay Kim', 7)) === '150' && (await cell('Kay Kim', 8)) === '150' && (await cell('Kay Kim', 9)) === '500', [6, 7, 8, 9].length ? await cell('Kay Kim', 9) : '');
  check('B3 Jane: 1 day absent (the 6th); 4 punctuality events (late start, lunch +2, break +1, short breaks +3); a start 30 s late and a lunch of 59m30 do not count', await inVal('Jane Doe', 1) === '1' && /^4/.test(await cell('Jane Doe', 2)), await inVal('Jane Doe', 1) + ' / ' + await cell('Jane Doe', 2));
  check('B4 three or more events means no bonus at all', (await cell('Jane Doe', 9)) === '0');
  check('B5 Sam: two days absent means no bonus', await inVal('Sam Lee', 1) === '2' && (await cell('Sam Lee', 9)) === '0');
  // type a QA rate
  const qa = p.locator('tr[data-agent="Kay Kim"] td').nth(3).locator('input'); await qa.fill('90'); await qa.press('Enter'); await p.waitForTimeout(500);
  check('B6 typing a QA pass rate of 90 % gives the 75 MAD QA bonus (total 425) and is saved', (await cell('Kay Kim', 7)) === '75' && (await cell('Kay Kim', 9)) === '425' && (await p.evaluate(() => window.__DB.bt_bonus_inputs.find(r => r.agent_name === 'Kay Kim').qa_rate)) === 0.9);
  const ab = p.locator('tr[data-agent="Sam Lee"] td').nth(1).locator('input'); await ab.fill('1'); await ab.press('Enter'); await p.waitForTimeout(500);
  check('B7 days absent can be corrected by hand (flagged as edited), and it is saved', /edited/.test(await cell('Sam Lee', 1)) && (await p.evaluate(() => window.__DB.bt_bonus_inputs.find(r => r.agent_name === 'Sam Lee').absent_override)) === 1);
  await p.click('button:has-text("Month settings")'); await p.waitForSelector('#bn-set');
  await p.fill('#bn-set input[aria-label="Holidays"]', '2026-10-06'); await p.locator('#bn-set input[aria-label="Holidays"]').blur(); await p.waitForTimeout(500);
  check('B8 a holiday removes that working day: Jane\'s day off on the 6th no longer counts', await inVal('Jane Doe', 1) === '0');
  const csv = p.waitForEvent('download'); await p.click('button:has-text("Export CSV")'); const dl = await csv;
  check('B9 the table exports to CSV', /bonus-audit-2026-10\.csv/.test(dl.suggestedFilename()));
  await p.click('button[aria-label="Previous month"]'); await p.waitForTimeout(1500);
  check('B10 another month has nobody in it', /No agents/.test(await p.locator('#tab-bonus').innerText()));
  await p.context().close();

  // before the setup SQL is run
  p = await open({ user: H.admin, db, side: '0' }); await p.addInitScript(() => { window.__ERRORS = { bt_bonus_inputs: "Could not find the table 'public.bt_bonus_inputs' in the schema cache" }; });
  await p.reload(); await p.waitForSelector('.sb'); await p.click('[data-nav=bonus]'); await p.waitForSelector('tr[data-agent="Kay Kim"]', { timeout: 60000 });
  check('B11 before the SQL is run the page still works and offers the setup SQL', /One-time setup/.test(await p.locator('#tab-bonus').innerText()));
  await p.context().close();

  /* ───────────── late & extra time ───────────── */
  p = await open({ user: H.admin, db, side: '0', w: 1700, h: 1000 }); await p.waitForSelector('.sb');
  await p.click('[data-nav=late]'); await p.waitForSelector('#tab-late tr[data-ev]'); await p.waitForTimeout(500);
  const types = async () => (await p.locator('#tab-late tr[data-ev]').evaluateAll(r => r.map(x => x.dataset.ev + ':' + x.children[1].innerText))).sort();
  let t = await types();
  const want = ['late_start:Jane Doe', 'stayed_late:Jane Doe', 'late_lunch:Jane Doe', 'late_break:Jane Doe', 'flex_over:Jane Doe'];
  check('L1 this month: Jane\'s late start, 15 minutes extra, lunch, break and short-break overruns are listed; the on-time ones are not', want.every(x => t.includes(x)) && t.length === 5, t.join(' | '));
  check('L2 late starters include nobody else (Sam and Kay were on time)', !t.some(x => /Sam|Kay/.test(x)));
  check('L3 tiles: 1 late start, 3 break and lunch overruns, 15m extra time', (await p.locator('#lt-k-start').innerText()) === '1' && (await p.locator('#lt-k-brk').innerText()) === '3' && (await p.locator('#lt-k-extra').innerText()) === '15m', [await p.locator('#lt-k-start').innerText(), await p.locator('#lt-k-brk').innerText(), await p.locator('#lt-k-extra').innerText()].join('/'));
  await p.fill('#tab-late input[aria-label="From date"]', '2026-10-02'); await p.fill('#tab-late input[aria-label="To date"]', '2026-10-02'); await p.waitForTimeout(800);
  t = await types();
  check('L4 the date filter narrows it to one day: only the 2nd (late start and extra time)', t.join('|') === 'late_start:Jane Doe|stayed_late:Jane Doe', t.join('|'));
  await p.fill('#tab-late input[aria-label="From date"]', '2026-10-01'); await p.fill('#tab-late input[aria-label="To date"]', '2026-10-27'); await p.waitForTimeout(800);
  await p.click('#tab-late [data-type=stayed_late]'); await p.waitForTimeout(300);
  check('L5 the type chips filter the list', (await types()).join('|') === 'stayed_late:Jane Doe');
  await p.click('#tab-late button:has-text("Clear")'); await p.selectOption('#tab-late select[aria-label="Agent"]', 'Jane Doe'); await p.waitForTimeout(300);
  check('L6 the agent filter works', (await types()).length === 5);
  const csv2 = p.waitForEvent('download'); await p.click('#tab-late button:has-text("Export CSV")'); const d2 = await csv2;
  check('L7 the list exports to CSV', /late-and-extra-time-2026-10-01-to-2026-10-27\.csv/.test(d2.suggestedFilename()));
  check('L8 no page errors', errs.length === 0, errs.join(' | '));
  await p.context().close();
  await b.close(); require('fs').rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
