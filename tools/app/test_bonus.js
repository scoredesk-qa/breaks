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

let id = 1; const sl = [];
const r = (ext, agent, d, hm, from, to) => sl.push({ id: id++, changed_at: D(d, hm), extension: ext, agent, old_status: from, new_status: to });
const day = (ext, agent, d, on = '08:25:00', off = '17:25:00') => { r(ext, agent, d, on, 'Offline', 'Available'); r(ext, agent, d, off, 'Available', 'Offline'); };
const away = (ext, agent, d, a, b, status) => { r(ext, agent, d, a, 'Available', status); r(ext, agent, d, b, status, 'Available'); };
const call = (ext, agent, d, a, b) => { const x = Date.parse(D(d, a)); const f = ms => new Date(ms).toISOString(); sl.push({ id: id++, changed_at: f(x - 3000), extension: ext, agent, old_status: 'Available', new_status: 'Ringing' }, { id: id++, changed_at: D(d, a), extension: ext, agent, old_status: 'Ringing', new_status: 'On call' }, { id: id++, changed_at: D(d, b), extension: ext, agent, old_status: 'On call', new_status: 'Available' }); };
const J = ['601', 'Doe, Jane'], S = ['602', 'Lee, Sam'], K = ['701', 'Kim, Kay'];
// Jane: one day off (6th); online 08:31:00 on the 2nd (exactly 60 s late) and on calls until 17:45; online 08:30:30 on the 1st does NOT count
workdays.forEach(d => { if (d === 6) return; if (d === 12) day(...J, d, '08:35:00'); else if (d === 2) day(...J, d, '08:31:00', '17:46:00'); else if (d === 1) day(...J, d, '08:30:30'); else day(...J, d); });
call(...J, 2, '17:28:00', '17:45:00');                              // 15 minutes of it after 17:30
call(...J, 5, '17:30:10', '17:30:50');                              // 40 s after 17:30: not enough to count
away(...J, 1, '12:00:00', '13:02:00', 'Lunch');                     // lunch 62 min: over by 2
away(...J, 1, '10:00:00', '10:16:00', 'Break');                     // break 16 min: over by 1
away(...J, 1, '15:00:00', '15:14:00', 'Break');                     // 14 min: fine
away(...J, 1, '09:00:00', '09:05:00', 'Bathroom'); away(...J, 1, '11:00:00', '11:09:00', 'Bathroom');   // 14 min together: fine
away(...J, 5, '09:00:00', '09:06:00', 'Bathroom'); away(...J, 5, '11:00:00', '11:06:00', 'Bathroom'); away(...J, 5, '14:00:00', '14:06:00', 'Bathroom');   // 18 min together: over by 3
away(...J, 7, '12:00:00', '12:59:30', 'Lunch');                     // lunch 59m30: fine
workdays.forEach(d => { if (d !== 8 && d !== 9) day(...S, d); });
away(...S, 15, '12:00:00', '13:02:00', 'Lunch');                     // Sam: lunch 62 min and nothing else: total fine, so it is the lunch that is flagged   // Sam: two days absent
const A = ['801', 'Ben, Ali'];
day(...A, 14); away(...A, 14, '12:00:00', '13:00:50', 'Lunch'); away(...A, 14, '10:00:00', '10:15:50', 'Break'); away(...A, 14, '15:00:00', '15:15:50', 'Break'); away(...A, 14, '11:00:00', '11:15:50', 'Bathroom');   // each 50 s over its limit (not flagged alone), 108m20s in all
workdays.forEach(d => day(...K, d));                                // Kay: perfect, 610 calls on the 1st, 10 ignored rings on the 2nd
for (let i = 0; i < 610; i++) { const t0 = Date.parse(D(1, '08:30:00')) + i * 40000; call(...K, 1, new Date(t0 + 3000).toISOString().slice(11, 19), new Date(t0 + 33000).toISOString().slice(11, 19)); }
for (let i = 0; i < 10; i++) { const t0 = Date.parse(D(2, '09:00:00')) + i * 120000; const f = ms => new Date(ms).toISOString(); sl.push({ id: id++, changed_at: f(t0), extension: K[0], agent: K[1], old_status: 'Available', new_status: 'Ringing' }, { id: id++, changed_at: f(t0 + 15000), extension: K[0], agent: K[1], old_status: 'Ringing', new_status: 'Available' }); }
sl.sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));

(async () => {
  const b = await H.launch(); const open = H.opener(b, page, errs);
  const db = H.mkdb({ status_log: sl, bt_bonus_inputs: [{ month: '2026-10', agent_name: 'Kay Kim', qa_rate: 1, absent_override: null, punct_adj: 0 }] });
  let p = await open({ user: H.admin, db, side: '0', w: 1700, h: 1000 }); await p.waitForSelector('.sb');
  const items = (await p.locator('.sb-nav .sb-i').allInnerTexts()).map(x => x.trim());
  check('B0 the sidebar has Bonus Audit and Late & Extra Time (under More)', items.includes('Bonus Audit') && items.includes('Late & Extra Time'), items.join('|'));
  await p.click('[data-nav=bonus]'); await p.waitForSelector('tr[data-agent="Kay Kim"]', { timeout: 60000 }); await p.waitForTimeout(1500);
  const cell = async (name, i) => (await p.locator(`tr[data-agent="${name}"] td`).nth(i).innerText()).replace(/\s+/g, ' ').trim();
  const inVal = async (name, i) => p.locator(`tr[data-agent="${name}"] td`).nth(i).locator('input').inputValue();
  check('B1 Kay: no absences, no events, 610 calls, ignored 1.6 %', await inVal('Kay Kim', 1) === '0' && /^0/.test(await cell('Kay Kim', 2)) && await cell('Kay Kim', 4) === '610' && /^1\.6%/.test(await cell('Kay Kim', 5)), [await inVal('Kay Kim', 1), await cell('Kay Kim', 2), await cell('Kay Kim', 4), await cell('Kay Kim', 5)].join(' / '));
  check('B2 Kay\'s bonus follows the sheet: attendance 200, QA (100 %) 150, productivity (600+ calls, 2 % or less ignored) 150 = 500', [6, 7, 8, 9].map(async i => 0) && (await cell('Kay Kim', 6)) === '200' && (await cell('Kay Kim', 7)) === '150' && (await cell('Kay Kim', 8)) === '150' && (await cell('Kay Kim', 9)) === '500', [6, 7, 8, 9].length ? await cell('Kay Kim', 9) : '');
  check('B3 Jane: 1 day absent (the 6th, nothing in 3CX); 3 punctuality events (late starts on the 2nd and 12th, and the 1st counted once for its total, with lunch and break over folded into it); 18 minutes of short breaks on the 5th are fine on their own; a start 30 s late and a lunch of 59m30 do not count', await inVal('Jane Doe', 1) === '1' && /^3/.test(await cell('Jane Doe', 2)), await inVal('Jane Doe', 1) + ' / ' + await cell('Jane Doe', 2));
  check('B3b Jane\'s total-over day (the 1st) is one event, not three; Ali has 1 (total only)', /^3/.test(await cell('Jane Doe', 2)) && /^1/.test(await cell('Ali Ben', 2)), await cell('Ali Ben', 2));
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
  check('B10 another month has nobody in it', /No 3CX activity/.test(await p.locator('#tab-bonus').innerText()));
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
  const want = ['late_start:Jane Doe', 'stayed_late:Jane Doe', 'total_over:Jane Doe', 'total_over:Ali Ben', 'late_lunch:Sam Lee'];
  check('L1 this month: Jane\'s two late starts, her 15 minutes on calls, her over-total day (lunch and break over are folded into it, not listed again), Ali\'s total and Sam\'s lunch', want.every(x => t.includes(x)) && t.length === 6 && !t.some(x => /late_break|flex_over/.test(x)) && t.filter(x => x === 'late_lunch:Jane Doe').length === 0, t.join(' | '));
  check('L1b the total-over event fires for Ali (every part within a minute of its limit, but 1h48m in all) and for Jane (106 minutes)', t.includes('total_over:Ali Ben') && t.includes('total_over:Jane Doe'));
  check('L2 Kay (on time, normal breaks) has no events', !t.some(x => /Kay/.test(x)));
  const det = await p.locator('tr[data-ev=total_over]:has-text("Jane Doe")').innerText();
  check('L2b the over-total day names what went over, in one line', /Breaks added up to 1h 46m/.test(det) && /Lunch 12:00–13:02 took 1h 2m/.test(det) && /Break 10:00–10:16 took 16m/.test(det), det.replace(/\s+/g, ' '));
  check('L3 tiles: 2 late starts, 3 break and lunch overruns, 15m on calls after 17:30 (the 40 s call does not count)', (await p.locator('#lt-k-start').innerText()) === '2' && (await p.locator('#lt-k-brk').innerText()) === '3' && (await p.locator('#lt-k-extra').innerText()) === '15m', [await p.locator('#lt-k-start').innerText(), await p.locator('#lt-k-brk').innerText(), await p.locator('#lt-k-extra').innerText()].join('/'));
  await p.fill('#tab-late input[aria-label="From date"]', '2026-10-02'); await p.fill('#tab-late input[aria-label="To date"]', '2026-10-02'); await p.waitForTimeout(800);
  t = await types();
  check('L4 the date filter narrows it to one day: only the 2nd (late start and extra time)', t.join('|') === 'late_start:Jane Doe|stayed_late:Jane Doe', t.join('|'));
  await p.fill('#tab-late input[aria-label="From date"]', '2026-10-01'); await p.fill('#tab-late input[aria-label="To date"]', '2026-10-27'); await p.waitForTimeout(800);
  await p.click('#tab-late [data-type=stayed_late]'); await p.waitForTimeout(300);
  check('L5 the type chips filter the list', (await types()).join('|') === 'stayed_late:Jane Doe');
  await p.click('#tab-late button:has-text("Clear")'); await p.selectOption('#tab-late select[aria-label="Agent"]', 'Jane Doe'); await p.waitForTimeout(300);
  check('L6 the agent filter works', (await types()).length === 4);
  const csv2 = p.waitForEvent('download'); await p.click('#tab-late button:has-text("Export CSV")'); const d2 = await csv2;
  check('L7 the list exports to CSV', /late-and-extra-time-2026-10-01-to-2026-10-27\.csv/.test(d2.suggestedFilename()));
  check('L8 no page errors', errs.length === 0, errs.join(' | '));
  await p.context().close();
  /* ───────────── cache: switching tabs does not load again ───────────── */
  p = await open({ user: H.admin, db, side: '0', w: 1700, h: 1000 }); await p.waitForSelector('.sb');
  await p.click('[data-nav=bonus]'); await p.waitForSelector('tr[data-agent="Kay Kim"]', { timeout: 60000 });
  await p.evaluate(() => { window.__Q = 0; const f = window.__DB; });
  await p.click('[data-nav=late]'); await p.waitForSelector('#tab-late tr[data-ev]'); await p.waitForTimeout(300);
  await p.click('[data-nav=bonus]');
  const quick = await p.waitForSelector('tr[data-agent="Kay Kim"]', { timeout: 400 }).then(() => true, () => false);
  check('C1 going back to Bonus Audit shows the table at once (no loading spinner)', quick);
  await p.click('[data-nav=late]');
  const quick2 = await p.waitForSelector('#tab-late tr[data-ev]', { timeout: 400 }).then(() => true, () => false);
  check('C2 going back to Late & Extra Time shows the list at once', quick2 && await p.locator('#tab-late .spin').count() === 0);
  await p.context().close();
  await b.close(); require('fs').rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
