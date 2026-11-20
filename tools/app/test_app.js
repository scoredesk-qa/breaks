#!/usr/bin/env node
// Browser test for the app's index.html (agent view: break time left + call stats, Settings clean-up). Uses a stand-in database, never a real one.
//   node tools/app/test_app.js <index.html> <folder that has node_modules/react, react-dom, @babel/standalone>
const fs = require('fs'), path = require('path');
const [built, mods] = process.argv.slice(2);
if (!built || !mods) { console.log('usage: node test_app.js <index.html> <dir with node_modules>'); process.exit(1); }
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const MOCK = path.join(__dirname, '..', '3cx', 'page', 'mock_supabase.js');

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

const TODAY = '2026-10-27', NOW = TODAY + 'T13:10:00.000Z';
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const at = hm => TODAY + 'T' + hm + 'Z';
const st = (hm, ext, agent, from, to) => ({ changed_at: at(hm), extension: ext, agent, old_status: from, new_status: to });

// the phone-system rows an agent is allowed to get from cx_team_day: their own, and everybody else's without names
const MINE = [
  st('09:00:00', '601', 'Doe, Jane', null, 'Available'),
  st('09:05:00', '601', 'Doe, Jane', 'Available', 'Ringing'), st('09:05:05', '601', 'Doe, Jane', 'Ringing', 'On call'), st('09:10:05', '601', 'Doe, Jane', 'On call', 'Available'),     // call 1: 5m
  st('09:30:00', '601', 'Doe, Jane', 'Available', 'Ringing'), st('09:30:03', '601', 'Doe, Jane', 'Ringing', 'On call'), st('09:30:33', '601', 'Doe, Jane', 'On call', 'Available'),   // call 2: 30s (short)
  st('10:00:00', '601', 'Doe, Jane', 'Available', 'Ringing'), st('10:00:15', '601', 'Doe, Jane', 'Ringing', 'Available'),                                                                 // ignored, rang 15s
  st('10:10:00', '601', 'Doe, Jane', 'Available', 'Do Not Disturb - ADMIN'), st('10:20:00', '601', 'Doe, Jane', 'Do Not Disturb - ADMIN', 'Available'),                                   // admin 10m
  st('10:30:00', '601', 'Doe, Jane', 'Available', 'Ringing'), st('10:30:04', '601', 'Doe, Jane', 'Ringing', 'On call'), st('10:40:04', '601', 'Doe, Jane', 'On call', 'Available'),   // call 3: 10m
];
const team = (x, rows) => rows.map(([hm, a, b]) => ({ changed_at: at(hm), extension: 'x' + x, agent: 'Colleague ' + x, old_status: a, new_status: b }));
const TEAM = [
  ...team(1, [['08:30:00', null, 'Available'], ['09:15:00', 'Available', 'Ringing'], ['09:15:04', 'Ringing', 'On call'], ['09:20:04', 'On call', 'Available'],
              ['10:15:00', 'Available', 'Ringing'], ['10:15:04', 'Ringing', 'On call'], ['10:25:04', 'On call', 'Available'], ['10:45:00', 'Available', 'Ringing'], ['10:45:04', 'Ringing', 'On call'], ['10:50:04', 'On call', 'Available']]),
  ...team(2, [['08:30:00', null, 'Available'], ['09:40:00', 'Available', 'Ringing'], ['09:40:04', 'Ringing', 'On call'], ['09:50:04', 'On call', 'Available'],
              ['09:55:00', 'Available', 'Ringing'], ['09:55:04', 'Ringing', 'On call'], ['10:05:04', 'On call', 'Available']]),
];
const cxPayload = { mine: MINE, team: TEAM };

const settingsRow = extra => Object.assign({ id: 1, max_concurrent_breaks: 5, lunch_start: 12, slot_schedule: [], slot_tz: 'UTC', trainees: [], trainee_lunch: '12:00', shift_end: '16:30' }, extra || {});
const mkdb = (extra = {}) => Object.assign({
  bt_settings: [settingsRow({ break_allowance_min: 105, full_shift_hours: 8, cx_config: {} })],
  bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('08:10:00'), clock_out: null, date: TODAY }],
  bt_logs: [
    { id: 11, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('11:00:00'), end_time: at('11:15:00'), duration_secs: 900, break_type: 'Break' },
    { id: 12, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('12:00:00'), end_time: at('12:10:00'), duration_secs: 600, break_type: 'Break' }],
  bt_lunch_schedule: [], bt_swap_requests: [], status_log: [],
}, extra);

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const open = async ({ user, db, rpc, noCols, now = NOW, w = 1500 } = {}) => {
    const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: 1100 } });
    const q = await c.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(([u, d, r, nc]) => { window.__USER = u; window.__DB = d; if (nc) window.__NO_COLS = nc; if (r !== undefined) window.__RPC_FN = { cx_team_day: () => r }; }, [user, db || mkdb(), rpc === undefined ? { data: cxPayload, error: null } : rpc, noCols || null]);
    await q.clock.setFixedTime(new Date(now));
    await q.goto('file://' + page);
    return q;
  };
  const flat = async p => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const agent = { id: 'u1', email: 'jane@x.com', user_metadata: { role: 'agent', display_name: 'Jane Doe' } };
  const admin = { id: 'adm', email: 'boss@x.com', user_metadata: { role: 'admin', display_name: 'Boss' } };

  /* ───────────── agent view ───────────── */
  let p = await open({ user: agent });
  await p.waitForSelector('#break-left'); await p.waitForSelector('#agent-calls');
  let t = await flat(p), left = await p.locator('#break-left').innerText();
  check('B1 "Break time left" has no explanation lines under it', /Break time left/.test(left) && !/for every hour you work/.test(left) && !/for a full 8-hour shift/.test(left), left.replace(/\s+/g, ' ').slice(0, 160));
  check('B2 on shift 08:10-13:10 (5h) with 25 min of breaks used: 1h 20m left of the full day, shown in whole minutes', /1h 20m/.test(left) && /Used today 25m(?! \d)/.test(left.replace(/\s+/g, ' ')) && /Full-day allowance 1h 45m/.test(left.replace(/\s+/g, ' ')), left.replace(/\s+/g, ' '));
  check('B3 earned so far after 5 hours = 5/8 of 1h 45m = 1h 5m', /Earned so far 1h 5m/.test(left.replace(/\s+/g, ' ')));
  check('B4 no "ahead of what you earned" warning (25m used, 65m earned)', !/more than you have earned/.test(left));
  const bar = await p.locator('#break-left .al-bar i').evaluate(e => e.style.width), mark = await p.locator('#break-left .al-bar b').evaluate(e => e.style.left);
  check('B5 the bar shows 25/105 used (23.8%) and a marker at the 62.5% earned', Math.abs(parseFloat(bar) - 23.81) < 0.2 && /62\.5/.test(mark), bar + ' / ' + mark);

  const calls = await p.locator('#agent-calls').innerText(), cf = calls.replace(/\s+/g, ' ');
  check('C1 call stats: 3 calls, talk time 15m 30s, average 5m 10s', /Calls taken 3/.test(cf) && /Talk time 15m 30s/.test(cf) && /Average call 5m 10s/.test(cf), cf.slice(0, 200));
  check('C2 admin time 10m (Do Not Disturb - ADMIN counts as admin), 1 ignored ring, 1 short call', /Admin time 10m 00s/.test(cf) && /Ignored rings 1/.test(cf) && /Short calls\s*(warning )?1/i.test(cf));
  check('C3 the short-call tile is marked with a Warning flag (no long explanation box)', await p.locator('#agent-calls .cx-tiles > div.warn').count() === 1 && /Short calls\s*Warning/i.test(calls) && !/can look like dropped calls/.test(cf));
  check('C4 the ignored-rings tile is marked, with no explanation box either', await p.locator('#agent-calls .cx-tiles > div.bad').count() === 1 && !/the phone rang for/.test(cf));
  check('C5 per-hour chart: 7 hours (07:00-13:00), one bar group each', await p.locator('#agent-calls .hb').count() === 7, String(await p.locator('#agent-calls .hb').count()));
  const titles = await p.locator('#agent-calls .hb title').allTextContents();
  check('C6 09:00 hour: you 2 calls, team average 1.5 per agent', titles[2] === '09:00–10:00: you 2 calls · team average 1.5 per agent', titles[2]);
  check('C7 10:00 hour: you 1 call, team average 1 per agent', titles[3] === '10:00–11:00: you 1 call · team average 1 per agent', titles[3]);
  check('C8 an hour with nobody else logged in has no average ("–"), and the current hour says "so far"', /team average – per agent/.test(titles[0]) && /\(so far\)/.test(titles[6]), titles[0] + ' | ' + titles[6]);
  check('C9 the summary compares you with the team: team average 2.5 calls per agent, above in 1 of 4 hours', /the team average is 2\.5 per agent/.test(cf) && /above the average in 1 of 4 hours and below it in 0/.test(cf), cf.slice(-220));
  check('C10 the agent only ever got other people\'s rows without names ("Colleague N"), and none of those names appear on the page', !/Colleague/.test(t));
  check('C11 no page errors', errs.length === 0, errs.join(' | '));
  await p.screenshot({ path: path.join(mods, 'app_agent.png'), fullPage: true });
  await p.context().close();

  // clocked out early / used more than earned
  const early = mkdb({ bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('11:10:00'), clock_out: null, date: TODAY }] });
  p = await open({ user: agent, db: early });
  await p.waitForSelector('#break-left'); left = (await p.locator('#break-left').innerText()).replace(/\s+/g, ' ');
  check('B6 only 2h on shift (earned 26m) but 25 min used: still 1h 20m left of the day', /1h 20m/.test(left) && /Earned so far 26m(?! \d)/.test(left), left);
  await p.context().close();
  const ahead = mkdb({ bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('12:10:00'), clock_out: null, date: TODAY }] });
  p = await open({ user: agent, db: ahead });
  await p.waitForSelector('#break-left'); left = (await p.locator('#break-left').innerText()).replace(/\s+/g, ' ');
  check('B7 1h on shift, 25 min used (more than earned): still 1h 20m left, and no explanation note', /1h 20m/.test(left) && !/more than you have earned/.test(left), left.slice(0, 300));
  await p.context().close();
  const out = mkdb({ bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('08:10:00'), clock_out: at('10:10:00'), date: TODAY }], bt_logs: [{ id: 11, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('09:00:00'), end_time: at('09:30:00'), duration_secs: 1800, break_type: 'Break' }] });
  p = await open({ user: agent, db: out });
  await p.waitForSelector('#break-left'); left = (await p.locator('#break-left').innerText()).replace(/\s+/g, ' ');
  check('B8 clocked out after 2h: the allowance is what was earned (26m), 30 min used = over by 3m, in whole minutes', /Allowance today 26m(?! \d)/.test(left) && /Over by 3m(?! \d)/.test(left), left.slice(0, 260));
  await p.context().close();
  const near = mkdb({ bt_clocklogs: [{ id: 1, user_id: 'u1', agent_name: 'Jane Doe', clock_in: at('08:00:00'), clock_out: at('13:00:00'), date: TODAY }], bt_logs: [{ id: 11, user_id: 'u1', agent_name: 'Jane Doe', start_time: at('09:00:00'), end_time: at('10:06:00'), duration_secs: 3960, break_type: 'Break' }] });
  p = await open({ user: agent, db: near });
  await p.waitForSelector('#break-left'); left = (await p.locator('#break-left').innerText()).replace(/\s+/g, ' ');
  check('B9 over the allowance by only 22 seconds: it says nothing about it (0m left, no "Over by", bar not red)', !/Over by/.test(left) && /^Break time left 0m/.test(left) && await p.locator('#break-left .al-bar i.over').count() === 0, left.slice(0, 120));
  await p.context().close();
  const cfgdb = mkdb({ bt_settings: [settingsRow({ break_allowance_min: 90, full_shift_hours: 7.5, cx_config: { shortCallSec: 20, timelineStart: 8, timelineEnd: 12 } })] });
  p = await open({ user: agent, db: cfgdb });
  await p.waitForSelector('#break-left'); await p.waitForSelector('#agent-calls'); t = await flat(p);
  check('S1 the admin\'s allowance (90 min per 7.5 h) and 3CX limits (short call = 20 s, hours 08-12) reach the agent page: earned 1h after 5 h, full day 1h 30m, no short-call warning, 4 hour bars', /Earned so far 1h(?! \d)/.test((await p.locator('#break-left').innerText()).replace(/\s+/g, ' ')) && /Full-day allowance 1h 30m/.test((await p.locator('#break-left').innerText()).replace(/\s+/g, ' ')) && await p.locator('#agent-calls .cx-tiles > div.warn').count() === 0 && await p.locator('#agent-calls .hb').count() === 4, String(await p.locator('#agent-calls .hb').count()));
  await p.context().close();

  // lunch group: visible without scrolling
  const lunch = grp => mkdb({ bt_lunch_schedule: [{ id: 1, date: TODAY, group_a: grp === 'A' ? ['Jane Doe'] : [], group_b: grp === 'B' ? ['Jane Doe'] : [] }] });
  p = await open({ user: agent, db: lunch('A') });
  await p.waitForSelector('#lunch-strip .lunch-pill b'); await p.waitForTimeout(300);
  let strip = (await p.locator('#lunch-strip').innerText()).replace(/\s+/g, ' ');
  const ly = (await p.locator('#lunch-strip').boundingBox()).y, vh = 1100;
  check('L1 the lunch group is right under the greeting: Group A 13:00-14:00, now, ends in 50m', /Lunch · Group A · 13:00–14:00 · now · ends in 50m/.test(strip), strip);
  check('L2 ...and it is inside the first screen (no scrolling)', ly < 400 && ly + 40 < vh, String(Math.round(ly)));
  check('L3 the existing Swap lunch button is still there, once (not duplicated by the strip)', await p.locator('button:has-text("Swap lunch")').count() === 1);
  await p.screenshot({ path: path.join(mods, 'app_lunch.png'), clip: { x: 0, y: 0, width: 1500, height: 520 } });
  const gy = (await p.locator('.grid3').boundingBox()).y, cy = (await p.locator('#agent-calls').boundingBox()).y;
  const gb = await p.locator('.grid3').boundingBox(), cb = await p.locator('#agent-calls').boundingBox();
  check('L4b room between the Shift/Lunch/Team cards and the call stats (at least 20px)', cb.y - (gb.y + gb.height) >= 20, String(Math.round(cb.y - (gb.y + gb.height))));
  check('L4 the Shift / Lunch / Team cards come before the call stats (calls are lower down)', gy < cy, Math.round(gy) + ' < ' + Math.round(cy));
  await p.context().close();
  p = await open({ user: agent, db: lunch('B'), now: TODAY + 'T11:30:00.000Z' });
  await p.waitForSelector('#lunch-strip .lunch-pill b'); await p.waitForTimeout(300);
  strip = (await p.locator('#lunch-strip').innerText()).replace(/\s+/g, ' ');
  check('L5 before lunch it says when it starts: Group B 12:00-13:00, starts in 30m', /Lunch · Group B · 12:00–13:00 · starts in 30m/.test(strip), strip);
  await p.context().close();
  p = await open({ user: agent, db: lunch('B') });
  await p.waitForSelector('#lunch-strip .lunch-pill b'); await p.waitForTimeout(300);
  check('L6 after lunch it says finished', /Group B · 12:00–13:00 · finished/.test((await p.locator('#lunch-strip').innerText()).replace(/\s+/g, ' ')));
  await p.context().close();
  p = await open({ user: agent, db: mkdb({ bt_settings: [settingsRow({ break_allowance_min: 105, full_shift_hours: 8, cx_config: {}, trainees: ['Jane Doe'], trainee_lunch: '12:30' })] }) });
  await p.waitForSelector('#lunch-strip .lunch-pill b'); await p.waitForTimeout(500);
  strip = (await p.locator('#lunch-strip').innerText()).replace(/\s+/g, ' ');
  check('L7 a trainee sees Trainee 12:30-13:30, with no swap button', /Lunch · Trainee · 12:30–13:30 · now · ends in 20m/.test(strip) && await p.locator('#lunch-strip button').count() === 0, strip);
  await p.context().close();
  p = await open({ user: agent, db: mkdb() });
  await p.waitForSelector('#lunch-strip .lunch-pill'); await p.waitForTimeout(300);
  check('L8 no lunch group assigned: it says Unassigned', /Lunch · Unassigned/.test((await p.locator('#lunch-strip').innerText()).replace(/\s+/g, ' ')));
  await p.context().close();

  // not set up yet / nothing to show: the break card still works, the call stats stay out of the way
  p = await open({ user: agent, rpc: { data: null, error: { message: 'Could not find the function public.cx_team_day' } } });
  await p.waitForSelector('#break-left'); await p.waitForTimeout(400);
  check('N1 before the setup SQL is run: no call-stats card and no error message for the agent; the break card still shows', await p.locator('#agent-calls').count() === 0 && !/cx_team_day/.test(await flat(p)) && /Break time left/.test(await flat(p)));
  await p.context().close();
  p = await open({ user: agent, rpc: { data: { mine: [], team: TEAM }, error: null } });
  await p.waitForSelector('#break-left'); await p.waitForTimeout(400);
  check('N2 an agent with no 3CX activity today (not matched in 3CX) gets no call-stats card', await p.locator('#agent-calls').count() === 0);
  await p.context().close();
  p = await open({ user: { id: 'u1', email: 'jane@x.com', user_metadata: { role: 'agent', display_name: 'Jane Doe' } }, db: mkdb({ bt_settings: [settingsRow({})] }) });
  await p.waitForSelector('#break-left');
  check('N3 settings without the new columns: the defaults (1h 45m, 8 h) are used', /Full-day allowance 1h 45m/.test(await flat(p)));
  await p.context().close();

  /* ───────────── Settings page (admin) ───────────── */
  p = await open({ user: admin, db: mkdb() });
  await p.waitForSelector('text=Settings'); await p.locator('text=Settings').first().evaluate(el => el.click()); await p.waitForSelector('text=3CX call alerts');
  t = await flat(p);
  check('G1 the old 3CX settings are gone: no logger PC clock, no "Where the 3CX logger uploads", no URL / key boxes', !/3CX logger PC clock/.test(t) && !/Where the 3CX logger uploads/.test(t) && !/UTC offset/.test(t) && await p.locator('input[aria-label^="3CX data"]').count() === 0);
  check('G2 the settings that still apply are all there', ['Ignored call: a call rings at least', 'Possible dropped call', 'Repeated ignores', 'Break check: an agent', 'Break check notification', 'Agent timeline shows the hours from', 'Break allowance', 'Break time for a full shift', 'A full shift is', 'Max concurrent breaks', 'Shift end', 'Lunch start time'].every(x => t.includes(x)));
  const box = p.locator('.sblk:has(h2:text-is("3CX call alerts"))'), nums = box.locator('input[type=number]');
  check('G3 3CX section has 8 number boxes (6 limits + timeline from/to)', await nums.count() === 8, String(await nums.count()));
  await nums.nth(1).fill('45'); await box.locator('button.bp').click(); await p.waitForTimeout(400);
  const saved = await p.evaluate(() => window.__DB.bt_settings[0].cx_config);
  check('G4 saving writes the 3CX limits to the database (shared), with only the current settings', saved.shortCallSec === 45 && Object.keys(saved).sort().join() === 'breakCheckLeadMin,breakToleranceMin,ignoreRingSec,repeatIgnoreCount,repeatIgnoreWindowMin,shortCallSec,timelineEnd,timelineStart', JSON.stringify(saved));
  const abox = p.locator('.sblk:has(h2:text-is("Break allowance"))');
  check('G5 break allowance shows 105 minutes / 8 hours and explains the rate', await abox.locator('input').nth(0).inputValue() === '105' && await abox.locator('input').nth(1).inputValue() === '8' && /about 13\.1 minutes for every hour on shift/.test(await abox.innerText()));
  await abox.locator('input').nth(0).fill('90'); await abox.locator('input').nth(1).fill('7.5'); await abox.locator('button.bp').click(); await p.waitForTimeout(400);
  const row = await p.evaluate(() => window.__DB.bt_settings[0]);
  check('G6 saving the allowance writes both numbers', row.break_allowance_min === 90 && Number(row.full_shift_hours) === 7.5, JSON.stringify([row.break_allowance_min, row.full_shift_hours]));
  await abox.locator('input').nth(0).fill('0'); await p.waitForTimeout(100);
  check('G7 an impossible allowance (0 minutes) cannot be saved', await abox.locator('button.bp').isDisabled());
  check('G8 no page errors', errs.length === 0, errs.join(' | '));
  await p.context().close();
  // before the setup SQL has been run
  p = await open({ user: admin, db: mkdb({ bt_settings: [settingsRow({})] }), noCols: { bt_settings: ['cx_config', 'break_allowance_min', 'full_shift_hours'] } });
  await p.waitForSelector('text=Settings'); await p.locator('text=Settings').first().evaluate(el => el.click()); await p.waitForSelector('text=Break allowance');
  await p.waitForSelector('text=One-time setup: copy this SQL, paste it into the Supabase SQL Editor, run it, then reload this page. It also lets agents');
  await p.locator('.sblk:has(h2:text-is("3CX call alerts")) button.bp').click(); await p.waitForTimeout(500);
  t = await flat(p);
  check('G9 without the new columns both sections offer the setup SQL, and the 3CX save says it only reached this browser', await p.locator('button:has-text("Copy setup SQL")').count() === 2 && /Saved in this browser only: Could not find the 'cx_config' column/.test(t), (t.match(/Saved in this browser only[^.]*/) || [''])[0]);
  const copied = await p.evaluate(async () => { let got = ''; navigator.clipboard.writeText = async x => { got = x; }; [...document.querySelectorAll('button')].find(b => /Copy setup SQL/.test(b.textContent)).click(); await new Promise(r => setTimeout(r, 50)); return got; });
  check('G10 the copied SQL adds the columns and the cx_team_day function, for signed-in users only', /break_allowance_min/.test(copied) && /cx_team_day/.test(copied) && /grant execute on function public\.cx_team_day\(timestamptz, timestamptz, text\) to authenticated/.test(copied) && !/to anon/.test(copied));
  await p.context().close();

  /* ───────────── the admin 3CX page still works without its removed settings ───────────── */
  const AZ = require(path.join(__dirname, '..', '3cx', 'analyze.js'));
  const fx = AZ.parseCsv(fs.readFileSync(path.join(__dirname, '..', '3cx', 'fixtures', 'status_log.sample.csv'), 'utf8'));
  const tbl = fx.map((r, k) => ({ id: k + 1, changed_at: new Date(AZ.parseStamp(r.timestamp, 0)).toISOString(), extension: r.extension, agent: r.agent, old_status: r.old_status || null, new_status: r.new_status, detail: r.detail || null }));
  const staff = ['Jane Doe', 'Rick Roe', 'Pat Poe', 'Kay Kim'];
  p = await open({ user: admin, db: mkdb({ status_log: tbl, bt_clocklogs: staff.map((n, k) => ({ id: k + 1, user_id: 'u' + k, agent_name: n, clock_in: at('08:00:00'), clock_out: null, date: TODAY })) }) });
  await p.waitForSelector('text=3CX'); await p.locator('aside >> text=3CX').first().evaluate(el => el.click());
  await p.waitForSelector('.cx-card', { timeout: 15000 });
  t = await flat(p);
  check('A1 the 3CX admin page reads status_log live and shows the agents (4 cards), without any connection settings', await p.locator('.cx-card').count() === 4 && /Right now/.test(t) && /3 calls/.test(t), (t.match(/\d+ calls/) || [''])[0]);
  check('A2 no page errors on the admin pages', errs.length === 0, errs.join(' | '));
  await p.context().close();

  await b.close(); fs.rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
