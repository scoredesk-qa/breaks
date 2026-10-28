#!/usr/bin/env node
// Browser test for the 3CX test page (a local copy of the app; no real database is used).
//   node tools/3cx/page/test_page.js <built test page .html> <folder that has node_modules/react, react-dom, @babel/standalone>
// Needs Playwright with Chromium (set PLAYWRIGHT_CHROMIUM if it is not found automatically).
const fs = require('fs'), path = require('path');
const [built, mods] = process.argv.slice(2);
if (!built || !mods) { console.log('usage: node test_page.js <BreakTrack_TEST_3cx.html> <dir with node_modules>'); process.exit(1); }
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

// make a runnable copy: local React/Babel and the mock Supabase instead of the CDN scripts
const work = fs.mkdtempSync(path.join(mods, 'run_'));
let html = fs.readFileSync(built, 'utf8').replace(/\r\n/g, '\n').split('\n');
const i = html.findIndex(l => l.includes('unpkg.com/react@'));
if (i < 0 || !html[i + 3].includes('supabase-js')) throw new Error('CDN script lines not found');
html.splice(i, 4,
  `<script src="${path.join(mods, 'node_modules/react/umd/react.development.js')}"></script>`,
  `<script src="${path.join(mods, 'node_modules/react-dom/umd/react-dom.development.js')}"></script>`,
  `<script src="${path.join(mods, 'node_modules/@babel/standalone/babel.min.js')}"></script>`,
  `<script src="${path.join(__dirname, 'mock_supabase.js')}"></script>`);
const page = path.join(work, 'app.html'); fs.writeFileSync(page, html.join('\n'));

const TODAY = '2026-10-27';
let fails = 0; const errs = [];
const check = (l, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + l + (x ? '  → ' + x : '')); if (!c) fails++; };
const iso = (hm) => TODAY + 'T' + hm + ':00.000Z';
const mkdb = (extra = {}) => Object.assign({
  bt_settings: [{ id: 1, max_concurrent_breaks: 5, lunch_start: 12, slot_schedule: [], slot_tz: 'UTC', trainees: [], trainee_lunch: '12:00', shift_end: '16:30' }],
  bt_clocklogs: ['Jane Doe', 'Rick Roe', 'Pat Poe', 'Kay Kim'].map((n, k) => ({ id: k + 1, user_id: 'u' + k, agent_name: n, clock_in: iso('08:00'), clock_out: null, date: TODAY })),
  bt_logs: [], bt_lunch_schedule: [], bt_swap_requests: [],
}, extra);

(async () => {
  const b = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
  // open the app as admin on the 3CX page; `now` = the PC/server clock for this test
  const open = async ({ cfg, w = 1500, now = TODAY + 'T13:10:00.000Z', db, errors, cxdb } = {}) => {
    const c = await b.newContext({ timezoneId: 'UTC', viewport: { width: w, height: 1000 } });
    const q = await c.newPage(); q.on('pageerror', e => errs.push(e.message));
    await q.addInitScript(([d, cf, er, cd]) => { if (cd) window.BT_CX_DB = cd; window.__USER = { id: 'adm', email: 'b@x.com', user_metadata: { role: 'admin', display_name: 'Boss' } }; window.__DB = d; if (er) window.__ERRORS = er; if (cf) localStorage.setItem('bt_cx_cfg', cf); }, [db || mkdb(), cfg || null, errors || null, cxdb || null]);
    await q.clock.setFixedTime(new Date(now));
    await q.goto('file://' + page);
    await q.waitForSelector('text=3CX (test)', { timeout: 20000 });
    await q.locator('text=3CX (test)').first().evaluate(el => el.click()); await q.waitForSelector('.acts input[type=date]');   // works when the menu is collapsed (phone width)
    return q;
  };
  const text = q => q.locator('body').innerText();
  const flat = async q => (await text(q)).replace(/\s+/g, ' ');

  let p = await open();
  check('N1 banner says this is a test copy', (await p.locator('.testribbon').innerText()).includes('TEST COPY'));
  const ys = await Promise.all(['Home', '3CX (test)', 'Live Rack', 'Trainees'].map(async t => (await p.locator(`aside >> text=${t}`).first().boundingBox().catch(() => null))?.y ?? (await p.locator(`text=${t}`).first().boundingBox()).y));
  check('N2 the 3CX item sits directly under Home, above Live Rack', ys[0] < ys[1] && ys[1] < ys[2] && ys[2] < ys[3], ys.map(Math.round).join(' < '));
  const ic = await p.evaluate(() => { const t = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent === 'Trainees'); const svg = t.parentElement.querySelector('svg'); const b = svg.getBBox(); return [b.y, b.y + b.height, b.x, b.x + b.width]; });
  check('N3 the Trainees icon is no longer cut off at the top (its drawing sits inside the 24x24 box)', ic[0] >= 0 && ic[1] <= 24 && ic[2] >= 0 && ic[3] <= 24, ic.map(v => v.toFixed(1)).join(' '));
  let body = await text(p);
  check('P1 it reads live on its own: an empty table shows the empty state, no cards', /No rows in the log for|Reading the status_log table/.test(body) && await p.locator('.cx-card').count() === 0);
  check('P2 Home-style header (title, subtitle, action buttons)', await p.locator('.hello').count() === 1 && await p.locator('.acts input[type=date]').count() === 1);
  check('P3 a calendar is there from the start, set to today', await p.locator('.acts input[type=date]').inputValue() === TODAY);

  await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('.cx-card');
  body = await text(p);
  check('S1 loading a log keeps today selected: subtitle shows the day, calls and alerts', /Tuesday, October 27 \(today\) · 3 calls · 5 alerts/.test(body), (body.match(/Tuesday[^\n]*/) || [''])[0]);
  check('R1 a "Right now" strip sits at the top with 4 tiles, and the status chips under Agents are gone', await p.locator('.cx-live .cx-lt').count() === 4 && await p.locator('.cx-chip:has-text("on a call")').count() === 0);
  check('S2 the day strip is gone; the calendar is the only day picker', await p.locator('.cx-day').count() === 0 && await p.locator('.acts input[type=date]').inputValue() === TODAY);
  check('S3 Statistics card with tiles and a chart with two lines', /\nStatistics\n/.test(body) && await p.locator('.cx-chart svg').count() === 1 && await p.locator('.cx-chart svg path[stroke]').count() === 2);
  check('S4 one profile card per matching agent (8; Ada is not in the app)', await p.locator('.cx-card').count() === 8, String(await p.locator('.cx-card').count()));
  check('S5 hidden extension explained', /1 other 3CX extension isn't in the app and is hidden/.test(body));
  check('S6 no card for Ada Ash', !/Ada Ash/.test(body));
  check('S7 no dots anywhere', await p.locator('.cx-dot, .cx-tl').count() === 0);
  const rick = p.locator('.cx-card:has-text("Rick Roe")');
  const rt = (await rick.innerText()).replace(/\s+/g, ' ');
  check('C1 card shows name, ext, status and stats', /Rick Roe/.test(rt) && /ext 602/.test(rt) && /Calls 0/.test(rt) && /Ignored 3/.test(rt), rt);
  check('C2 cards have initials avatars with a status ring', await rick.locator('.cx-av').innerText() === 'RR');
  check('C3 alerts card lists reasons', /Rang 25s, not answered/.test(body) && /Lasted 35s/.test(body) && /Repeated/.test(body));
  await p.screenshot({ path: path.join(mods, 'cx_team.png'), fullPage: true });

  // alerts can be marked as dealt with
  check('A1 5 open alerts', /5\s*open/.test(await flat(p)));
  await p.locator('.onb-row.link button[aria-label="Mark as dealt with"]').first().click(); await p.waitForTimeout(150);
  check('A2 dealing with one leaves 4 open and shows "Dealt with (1)"', /4\s*open/.test(await flat(p)) && /Dealt with \(1\)/.test(await text(p)));
  check('A3 the choice is remembered in this browser', Object.keys(JSON.parse(await p.evaluate(() => localStorage.getItem('bt_cx_dismissed') || '{}'))).length === 1);
  await p.click('text=Dealt with (1)'); await p.click('button:has-text("Restore")'); await p.waitForTimeout(150);
  check('A4 restore brings it back (5 open)', /5\s*open/.test(await flat(p)));
  await p.click('button:has-text("Clear all")'); await p.waitForTimeout(150);
  body = await text(p);
  check('A5 Clear all: nothing open, "All alerts dealt with"', /0\s*open/.test(await flat(p)) && /All alerts dealt with/.test(body) && /Dealt with \(5\)/.test(body));
  check('A6 the subtitle count follows', /3 calls · 0 alerts/.test(body));
  for (let i = 0; i < 5; i++) await p.locator('button:has-text("Restore")').first().click();
  await p.waitForTimeout(150);
  check('A7 all restored again', /5\s*open/.test(await flat(p)));

  // break check: 3CX against what the agents entered
  body = await text(p);
  check('K1 Break check section: 3 differ, 0 match (and nothing about a final check or notifications)', /Break check/.test(body) && /3\s*differ/.test(await flat(p)) && /0\s*match/.test(await flat(p)) && !/Final check|Run break check/.test(body));
  const kr = async n => (await p.locator(`.cxr tr:has-text("${n}")`).innerText()).replace(/\s+/g, ' ');
  check('K2 the break check is a small table: agent, agent\'s log, 3CX, difference (no sentences)', /Agent's log 3CX Difference/.test((await p.locator('.cxr thead').last().innerText()).replace(/\s+/g, ' ')) && !/that is not in the agent's log|that 3CX doesn't show|Totals differ/.test(body));
  check('K2b Kay: log 2 · 1h 05m, 3CX 2 · 1h 15m, difference −10m 00s', /Kay Kim 2 · 1h 05m 2 · 1h 15m −10m 00s/.test(await kr('Kay Kim')), await kr('Kay Kim'));
  check('K2c Finn: log 0 · 0s, 3CX 1 · 10m 00s, difference −10m 00s', /Finn Fox 0 · 0s 1 · 10m 00s −10m 00s/.test(await kr('Finn Fox')), await kr('Finn Fox'));
  check('K2d Jane: log 1 · 10m 00s, 3CX 0 · 0s, difference +10m 00s', /Jane Doe 1 · 10m 00s 0 · 0s \+10m 00s/.test(await kr('Jane Doe')), await kr('Jane Doe'));
  check('K3 break-check differences are NOT added to the alerts: still 5 open, no "Break check" badge', /5\s*open/.test(await flat(p)) && await p.locator('.cx-alerts .badge:has-text("Break check")').count() === 0);
  check('K4 before the check time (16:20) there is no notification yet and no "Run check" button', !/breaks in 3CX differ from what they logged/.test(await text(p)) && await p.locator('button:has-text("Run break check")').count() === 0);
  // profile
  await rick.click(); await p.waitForSelector('text=All agents');
  body = await text(p);
  check('R1 profile opens: name, ext, tiles, time split', /Rick Roe/.test(body) && /ext 602/.test(body) && /Ignored rings\n3/.test(body) && /Where the time went/.test(body));
  check('R2 profile lists the 3 rings as not answered, flagged Ignored', (await p.locator('.badge:text-is("Ignored")').count()) >= 3);
  check('R3 time split is a bar with a legend, not dots', await p.locator('.cx-bar i').count() >= 2 && await p.locator('.cx-dot').count() === 0);
  await p.screenshot({ path: path.join(mods, 'cx_profile.png'), fullPage: true });
  await p.click('text=All agents'); await p.waitForSelector('.cx-card');
  await p.click('.cx-card:has-text("Kay Kim")'); await p.waitForSelector('text=Where the time went');
  body = await text(p);
  check('R4 Kay\'s profile lists her breaks in 3CX next to her log, no explanations', /Breaks: agent's log and 3CX/.test(body) && /3CX\s*log 11:00 – 11:15/.test(body.replace(/\n/g, ' ')) && !/Totals differ/.test(body));
  await p.click('text=All agents');
  await p.click('.cx-card:has-text("Finn Fox")'); await p.waitForSelector('text=Where the time went');
  check('R5 Finn\'s profile: 3CX only, not in the agent\'s log', /3CX only/.test(await text(p)) && await p.locator('.badge:has-text("Not in agent\'s log")').count() === 1);
  await p.click('text=All agents');
  await p.click('.onb-row.link >> nth=0'); await p.waitForSelector('text=Where the time went');
  check('R6 clicking an alert opens that agent\'s profile', /Rick Roe/.test(await text(p)));
  await p.click('text=All agents');

  // choosing another day (chips and calendar)
  await p.fill('.acts input[type=date]','2026-10-26'); await p.waitForTimeout(250);
  body = await text(p);
  check('D1 choosing 26 Mon shows that day, with a Today button', /Monday, October 26/.test(body) && await p.locator('.cx-card').count() === 1 && /Gail Gray/.test(body) && await p.locator('button:text-is("Today")').count() === 1, String(await p.locator('.cx-card').count()));
  await p.click('button:text-is("Today")'); await p.waitForTimeout(150);
  check('D2 Today goes back to today', /Tuesday, October 27 \(today\)/.test(await text(p)));
  await p.fill('.acts input[type=date]', '2026-10-26'); await p.waitForTimeout(250);
  check('D3 the calendar picks a day too', /Monday, October 26/.test(await text(p)));
  await p.fill('.acts input[type=date]', TODAY); await p.waitForTimeout(150);

  // settings
  await p.click('text=Settings >> nth=0'); await p.waitForSelector('text=3CX call alerts');
  const box = p.locator('h2:has-text("3CX call alerts")').locator('xpath=..');
  const inputs = box.locator('input[type=number]');
  check('T1 Settings has the 3CX section with seven values and the defaults (incl. tolerance 3 and notification 10 minutes before shift end)', await inputs.count() === 7 && await inputs.nth(0).inputValue() === '0' && await inputs.nth(1).inputValue() === '10' && await inputs.nth(5).inputValue() === '3' && await inputs.nth(6).inputValue() === '10');
  await inputs.nth(1).fill('30'); await inputs.nth(5).fill('15'); await box.locator('button.bp').click(); await p.waitForTimeout(300);
  const saved = JSON.parse(await p.evaluate(() => localStorage.getItem('bt_cx_cfg') || '{}'));
  check('T2 saved in this browser', saved.ignoreRingSec === 30 && saved.breakToleranceMin === 15);
  await p.click('text=3CX (test)'); await p.waitForSelector('.acts input[type=date]'); await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('.cx-card');
  check('T3 the new limits are used: ignored after 30s (2 call alerts) and totals within 15 min are fine for Kay (Finn and Jane still differ)', /3 calls · 2 alerts/.test(await text(p)) && /2\s*differ/.test(await flat(p)), (await flat(p)).match(/\d+\s*differ/)[0]);
  await p.context().close();

  // the day follows today, not the log
  p = await open({ now: '2026-10-29T13:10:00.000Z' });
  await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('text=No 3CX activity on');
  body = await text(p);
  check('D4 a log with nothing for today still shows today, and says where the activity is', /Thursday, October 29 \(today\)/.test(body) && /No 3CX activity on Thursday, October 29/.test(body) && /The log has activity on (26 Oct, 27 Oct|Oct 26, Oct 27)/.test(body), (body.match(/The log has[^\n]*/) || [''])[0]);
  check('D5 the calendar shows today', await p.locator('.acts input[type=date]').inputValue() === '2026-10-29');
  await p.fill('.acts input[type=date]','2026-10-27'); await p.waitForSelector('.cx-card');
  check('D6 picking 27 shows that day, then Today returns', /Tuesday, October 27 · 3 calls/.test(await text(p)));
  await p.click('button:text-is("Today")'); await p.waitForSelector('text=No 3CX activity on');
  await p.context().close();

  // the notification: once a day, 10 minutes before shift end (16:30 - 10 = 16:20), only if something differs, never in the alerts
  p = await open({ now: TODAY + 'T16:19:00.000Z' });
  await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('.cx-card'); await p.waitForTimeout(500);
  check('E1 at 16:19 nothing has been sent', !/breaks in 3CX differ from what they logged/.test(await text(p)));
  await p.context().close();
  p = await open({ now: TODAY + 'T16:21:00.000Z' });
  await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('.cx-card'); await p.waitForSelector('text=breaks in 3CX differ from what they logged', { timeout: 5000 });
  body = await text(p);
  check('E2 at 16:21 one notification names the agents who differ', /Finn Fox, Jane Doe, Kay Kim: breaks in 3CX differ from what they logged/.test(body), (body.match(/[^\n]*breaks in 3CX differ[^\n]*/) || [''])[0]);
  check('E3 it is NOT added to the alerts: still 5 open, no "Break check" badge', /5\s*open/.test(await flat(p)) && await p.locator('.cx-alerts .badge:has-text("Break check")').count() === 0);
  check('E4 it is sent only once a day', await p.evaluate(() => localStorage.getItem('bt_cx_notified_2026-10-27')) === '1');
  await p.context().close();

  // with a real log (not the sample), the agents' entries come from the database, read-only
  const logsDb = mkdb({ bt_logs: [
    { id: 'l1', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('11:00'), end_time: iso('11:15'), break_type: 'Break' },
    { id: 'l2', user_id: 'u3', agent_name: 'Kay Kim', start_time: iso('11:30'), end_time: iso('12:30'), break_type: 'Lunch Break' }] });
  const csv = path.join(work, 'logger.csv'); fs.copyFileSync(path.join(__dirname, '..', 'fixtures', 'status_log.sample.csv'), csv);
  const t = Date.UTC(2026, 9, 27, 14, 20, 1) / 1000; fs.utimesSync(csv, t, t);       // saved right after its last row (14:20:00), logger PC on UTC+0
  p = await open({ db: logsDb });
  await p.evaluate(t=>window.__CX_TEST.csv(t[0],'logger.csv',t[1]), [fs.readFileSync(csv,'utf8'), fs.statSync(csv).mtimeMs]); await p.waitForSelector('.cx-card'); await p.waitForTimeout(300);
  body = await text(p);
  check('F1 a log from the app\'s own agents: 4 cards (Jane, Rick, Pat, Kay)', await p.locator('.cx-card').count() === 4, String(await p.locator('.cx-card').count()));
  check('F2 Kay\'s entries in the database match 3CX exactly: difference 0s, 0 differ', /0\s*differ/.test(await flat(p)) && /Kay Kim 2 · 1h 15m 2 · 1h 15m 0s/.test((await p.locator('.cxr tr:has-text("Kay Kim")').innerText()).replace(/\s+/g, ' ')));
  check('F3 logger clock UTC+0 matches the file: no warning', !/suggests the 3CX logger PC runs on/.test(body));
  const dbAfter = await p.evaluate(() => window.__DB.bt_logs);
  check('F4 the agents\' entries were not changed', dbAfter.length === 2 && dbAfter[1].end_time === iso('12:30'));
  await p.context().close();
  p = await open({ db: logsDb, now: TODAY + 'T16:21:00.000Z' });
  await p.evaluate(t=>window.__CX_TEST.csv(t[0],'logger.csv',t[1]), [fs.readFileSync(csv,'utf8'), fs.statSync(csv).mtimeMs]); await p.waitForSelector('.cx-card'); await p.waitForTimeout(1200);
  check('F5 when nothing differs there is no notification', /0\s*differ/.test(await flat(p)) && !/breaks in 3CX differ from what they logged/.test(await text(p)));
  await p.context().close();
  p = await open({ cfg: JSON.stringify({ logTz: 1 }) });
  await p.evaluate(t=>window.__CX_TEST.csv(t[0],'logger.csv',t[1]), [fs.readFileSync(csv,'utf8'), fs.statSync(csv).mtimeMs]); await p.waitForSelector('.cx-card'); await p.waitForTimeout(200);
  check('Z1 logger clock set to UTC+1: a warning says the logger PC looks like UTC+0', /suggests the 3CX logger PC runs on UTC\+0, but Settings says UTC\+1/.test(await text(p)));
  await p.click('button:has-text("Open Settings")'); await p.waitForSelector('text=3CX call alerts');
  check('Z2 the warning\'s button opens Settings', true);
  await p.context().close();

  // live from Supabase: the table the logger uploads to (status_log), read-only
  const AZ = require(path.join(__dirname, '..', 'analyze.js'));
  const fx = AZ.parseCsv(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'status_log.sample.csv'), 'utf8'));
  const tbl = fx.map(r => ({ changed_at: new Date(AZ.parseStamp(r.timestamp, 0)).toISOString(), extension: r.extension, agent: r.agent, old_status: r.old_status || null, new_status: r.new_status, detail: r.detail || null }));
  tbl.push({ changed_at: iso('09:00'), extension: '000', agent: 'connection test', old_status: null, new_status: 'Test', detail: 'delete me' });
  p = await open({ db: mkdb({ status_log: tbl }) });
  check('L0 no Load log / Live / Sample buttons and no file input: the page only reads live', await p.locator('button:has-text("Load log"), button:has-text("Live from Supabase"), button:has-text("Use sample data"), input[type=file]').count() === 0 && await p.locator('.acts input[type=date]').count() === 1);
  await p.waitForSelector('.cx-card');
  body = await text(p);
  check('L1 live: reads the table and shows today\'s agents that exist in the app (4 cards), 3 calls, 5 alerts', await p.locator('.cx-card').count() === 4 && /Tuesday, October 27 \(today\) · 3 calls · 5 alerts/.test(body), (body.match(/Tuesday[^\n]*/) || [''])[0]);
  check('L2 the page shows the same Live / synced pill as Home, and the old "Supabase · live · updated" text is gone', await p.locator('.acts-r .instr').count() === 1 && /synced/.test(await p.locator('.acts-r .instr').innerText()) && !/Supabase · live/.test(body));
  check('L3 the logger\'s connection-test row never shows up', !/connection test/.test(body));
  check('L4 nothing was written to the table', (await p.evaluate(() => window.__DB.status_log.length)) === tbl.length);
  check('L5 no clock warning for live data', !/suggests the 3CX logger PC runs on/.test(body));
  await p.context().close();
  p = await open({ cfg: JSON.stringify({ logTz: 1 }), db: mkdb({ status_log: tbl }) });
  await p.waitForSelector('.cx-card');
  check('L6 the logger-clock setting does not move live data (rows are real instants): same 3 calls · 5 alerts even with the setting at UTC+1', /3 calls · 5 alerts/.test(await text(p)));
  await p.context().close();
  p = await open({ db: mkdb(), errors: { status_log: 'permission denied for table status_log' } });
  await p.waitForSelector("text=Couldn't read the status_log table");
  body = await text(p);
  check('L7 if Supabase refuses, the page says why and offers the SQL to let admins read it', /permission denied for table status_log/.test(body) && await p.locator('button:has-text("Copy SQL to allow admins to read it")').count() === 1);
  await p.context().close();
  p = await open({ db: mkdb({ status_log: [] }) });
  await p.waitForSelector('text=No rows in the log for');
  check('L8 an empty table says so instead of "no agents match", and offers the admin-read SQL (a table that only lets the logger insert looks empty to admins)', /logger has not uploaded anything for this period yet, or admins are not allowed to read the table/.test(await text(p)) && !/No agents in this log match/.test(await text(p)) && await p.locator('button:has-text("Copy SQL to allow admins to read it")').count() === 1);
  await p.context().close();

  // people who are offline / out of office are not monitored
  const off = [{ changed_at: iso('08:00'), extension: '700', agent: 'Zoe, Zed', old_status: null, new_status: 'Offline', detail: null }, { changed_at: iso('09:00'), extension: '700', agent: 'Zoe, Zed', old_status: 'Offline', new_status: 'Holiday - OUT OF OFFICE', detail: null }];
  p = await open({ db: mkdb({ status_log: tbl.concat(off), bt_clocklogs: ['Jane Doe', 'Rick Roe', 'Pat Poe', 'Kay Kim', 'Zed Zoe'].map((n, k) => ({ id: k + 1, user_id: 'u' + k, agent_name: n, clock_in: iso('08:00'), clock_out: null, date: TODAY })) }) });
  await p.waitForSelector('.cx-card');
  check('O1 an agent who was only offline / out of office all day gets no card and is not counted (Zed Zoe: still the 4 cards, and a "logged in" count)', await p.locator('.cx-card').count() === 4 && !/Zed Zoe/.test(await text(p)) && /\d+ logged in/.test(await text(p)));
  await p.context().close();

  // the logger can upload to a different Supabase project than the one the app uses
  const LOGGER = { url: 'https://logger-project.supabase.co', key: 'k'.repeat(60), table: 'status_log' };
  p = await open({ db: mkdb({ status_log: tbl }) });
  await p.waitForSelector('.cx-card');
  check('X1 with nothing set, the page reads from the app\'s own project (one connection only)', (await p.evaluate(() => window.__CLIENTS.length)) === 1);
  await p.context().close();
  p = await open({ db: mkdb({ status_log: tbl }), cxdb: LOGGER });
  await p.waitForSelector('.cx-card');
  const cl = await p.evaluate(() => window.__CLIENTS);
  check('X2 with the logger\'s project pre-filled, live data comes through a second connection to that project', cl.length === 2 && cl[1].url === LOGGER.url && cl[1].key === LOGGER.key, JSON.stringify(cl.map(c => c.url)));
  check('X3 the live pill is still shown with a separate logger project', await p.locator('.acts-r .instr').count() === 1);
  check('X4 the app itself still uses its own project (first connection unchanged)', cl[0].url !== LOGGER.url);
  await p.click('text=Settings >> nth=0'); await p.waitForSelector('text=Where the 3CX logger uploads');
  check('X5 Settings shows the logger\'s project, pre-filled', await p.locator('input[aria-label="3CX data Supabase URL"]').inputValue() === LOGGER.url && await p.locator('input[aria-label="3CX data table"]').inputValue() === 'status_log');
  await p.fill('input[aria-label="3CX data Supabase URL"]', 'not a url'); await p.waitForTimeout(100);
  check('X6 a bad URL cannot be saved', await p.locator('h2:has-text("3CX call alerts")').locator('xpath=..').locator('button.bp').isDisabled());
  await p.context().close();
  p = await open({ db: mkdb(), cxdb: LOGGER, errors: { status_log: 'permission denied for table status_log' } });
  await p.waitForSelector("text=Couldn't read the status_log table");
  check('X7 if that project refuses, the message names it and offers the SQL for the public key', /in logger-project\.supabase\.co/.test(await text(p)) && await p.locator('button:has-text("Copy SQL to allow reading it")').count() === 1);
  await p.context().close();

  // the table isn't there yet (e.g. a fresh local Supabase): the page offers the setup SQL
  p = await open({ db: mkdb(), errors: { status_log: "Could not find the table 'public.status_log' in the schema cache" } });
  await p.waitForSelector("text=Couldn't read the status_log table");
  body = await text(p);
  check('X8 a missing table: the page says so and offers the SQL that creates it (and sets who can add/read rows)', /doesn't exist in this project yet/.test(body) && await p.locator('button:has-text("Copy SQL to create the table")').count() === 1 && await p.locator('button:has-text("Copy SQL to allow")').count() === 0);
  const copied = await p.evaluate(async () => { let got = ''; navigator.clipboard.writeText = async t => { got = t; }; [...document.querySelectorAll('button')].find(b => /Copy SQL to create/.test(b.textContent)).click(); await new Promise(r => setTimeout(r, 50)); return got; });
  check('X9 the copied SQL creates status_log, lets the logger insert and admins read', /create table if not exists public\.status_log/.test(copied) && /for insert to anon/.test(copied) && /for select to authenticated/.test(copied) && !/__CX_SETUP_SQL__/.test(copied));
  await p.context().close();

  // narrow screen
  p = await open({ w: 520 });
  await p.evaluate(()=>window.__CX_TEST.sample()); await p.waitForSelector('.cx-card');
  check('M1 phone width: no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await p.screenshot({ path: path.join(mods, 'cx_phone.png') });
  const dbNow = await p.evaluate(() => window.__DB);
  check('W1 nothing was written to the database', dbNow.bt_logs.length === 0 && dbNow.bt_clocklogs.length === 4);
  check('E9 no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.rmSync(work, { recursive: true, force: true });
  console.log(fails ? 'FAILED ' + fails : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
